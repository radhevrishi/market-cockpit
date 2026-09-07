// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/earnings/graded-us?date=YYYY-MM-DD&days=N
//
// The US mirror of /api/v1/earnings/graded. Same payload contract, same tier
// vocabulary, same shared decideTier — fed entirely by FREE data:
//   SEC EDGAR full-text search  →  who filed an earnings 8-K (Item 2.02)
//   SEC EDGAR companyfacts XBRL →  revenue / operating income / net income /
//                                  EPS / cash flow, current + year-ago quarter
//   Yahoo chart v8              →  price, reaction, volume, 52w, moving averages
//
// WHY `days` EXISTS (this is the important design note)
// ──────────────────────────────────────────────────────
// A company announces results in an 8-K on day D, but the XBRL numbers only
// reach EDGAR when the 10-Q is filed — sometimes the same day, often days or
// weeks later. So a strict single-day view would only ever grade the subset
// that files both together, and would look broken on every other day. The
// endpoint therefore grades a ROLLING WINDOW ending on `date` (default 5
// sessions), de-duplicated per ticker with the newest filing winning. Filers
// whose XBRL has not landed yet are counted and reported in
// `pending_xbrl_total` rather than silently dropped, so the UI can say exactly
// how many names are still waiting on their numbers.
//
// STALE-QUARTER GUARD — the US analogue of India's PATCH 0182 attribution
// guard. If companyfacts still holds only the PREVIOUS quarter when the 8-K
// lands, grading it would attribute three-month-old numbers to today's filing.
// Any candidate whose newest quarter ends more than MAX_QUARTER_LAG_DAYS
// before the filing date is treated as "XBRL pending", never graded.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import {
  earningsFilersOn, companyFacts, cikTickerMap, tickerToCik, submissions, announcementDateFor,
  sharesOutstandingFromFacts, sectorFromSic, isFinancialSic,
  type EdgarFiling,
} from '@/lib/us-edgar';
import { usTechnicals, spyReturn12m, pooled, yahooLastError, type UsTechnicals } from '@/lib/us-prices';
import {
  extractFundamentals, gradeUsRow, assignRsRatings,
  US_TIER_ORDER, type UsGradedRow, type EarningsTier,
} from '@/lib/us-earnings-core';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Hard cap on companyfacts fetches per request (peak season can exceed 400 filers/day). */
const MAX_CANDIDATES = 240;
/** A quarter older than this relative to the filing date means XBRL hasn't caught up. */
const MAX_QUARTER_LAG_DAYS = 110;
const DEFAULT_WINDOW_DAYS = 5;

/** A company that announced in the window but could not be graded yet. Listed
 *  rather than silently dropped — "nothing was lost, the numbers just aren't
 *  on EDGAR yet" is very different information from "no results today". */
interface PendingFiler {
  ticker: string;
  company: string;
  form: string;
  filed: string;
  filing_url: string;
  reason: 'xbrl-not-posted' | 'quarter-stale' | 'no-price' | 'reported-earlier';
}

interface UsGradedPayload {
  filing_date: string | null;
  window_days: number;
  window_start: string | null;
  candidates_total: number;
  raw_items_total: number;
  pending_xbrl_total: number;
  no_price_total: number;
  by_tier: Record<EarningsTier, UsGradedRow[]>;
  pending: PendingFiler[];
  generated_at: string;
  sources_polled: number;
  truncated: boolean;
  notes: string[];
}

// ─── server-side cache ─────────────────────────────────────────────────────
// A completed past window never changes → hold it long. Windows that include
// today keep moving as prices tick and late 10-Qs land → 15 minutes, matching
// the India route.
const _cache = new Map<string, { at: number; ttl: number; data: UsGradedPayload }>();
const CACHE_MAX = 60;

function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}
const dayMs = 86_400_000;
const isoAddDays = (iso: string, n: number) =>
  new Date(Date.parse(iso + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / dayMs);

function isWeekend(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6;
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === '1';
  const explicit = (searchParams.get('tickers') || '').trim();

  const today = etToday();
  let date = (searchParams.get('date') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
  if (date > today) date = today;                      // never grade the future

  let days = parseInt(searchParams.get('days') || '', 10);
  if (!Number.isFinite(days) || days < 1) days = DEFAULT_WINDOW_DAYS;
  days = Math.min(days, 15);

  const cacheKey = explicit ? `T:${explicit}` : `${date}|${days}`;
  if (!force) {
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() - hit.at < hit.ttl) {
      return NextResponse.json(hit.data, {
        headers: { 'x-mc-cache': 'hit', 'Cache-Control': 'private, max-age=60' },
      });
    }
  }

  const notes: string[] = [];
  let truncated = false;

  try {
    // ── 1. gather the filer set ──────────────────────────────────────────
    let filings: EdgarFiling[] = [];
    let windowStart: string | null = null;
    let reportedEarlier: EdgarFiling[] = [];

    if (explicit) {
      // Debug / verification path: grade an explicit ticker list off each
      // company's most recent filing. Used to eyeball the engine against a
      // known source without waiting for a filing day.
      const wanted = explicit.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
      const resolved = await pooled(wanted, 6, async (t) => ({ t, cik: await tickerToCik(t) }));
      const unresolved: string[] = [];
      const subs = await pooled(resolved.filter((r) => r?.cik), 5, async (r) => ({ r, s: await submissions(r!.cik!) }));
      for (const r of resolved) if (r && !r.cik) unresolved.push(r.t);
      for (const x of subs) {
        if (!x?.r?.cik) continue;
        // Use the company's most recent earnings 8-K as the event so the
        // reaction window is real, not today's date.
        let filed = date;
        const last202 = x.s?.recent.find((f) => f.form === '8-K' && f.items.includes('2.02'));
        if (last202?.filingDate) filed = last202.filingDate;
        filings.push({
          cik: String(x.r.cik).padStart(10, '0'), cikNum: x.r.cik!,
          ticker: x.r.t, company: x.s?.name || x.r.t, form: last202 ? '8-K' : '10-Q',
          items: last202?.items || [], accession: last202?.accession || '',
          filed, period: null, sic: x.s?.sic || null,
          filing_url: last202
            ? `https://www.sec.gov/Archives/edgar/data/${x.r.cik}/${last202.accession.replace(/-/g, '')}/${last202.accession}-index.htm`
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${x.r.t}&type=8-K`,
        });
      }
      if (unresolved.length) notes.push(`unresolved tickers (no SEC match): ${unresolved.join(', ')}`);
      notes.push('explicit-ticker mode: each name is graded off its most recent earnings 8-K');
    } else {
      const dates: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = isoAddDays(date, -i);
        if (!isWeekend(d)) dates.push(d);               // EDGAR generates nothing on weekends
      }
      windowStart = dates.length ? dates[dates.length - 1] : date;
      const perDay = await pooled(dates, 3, (d) => earningsFilersOn(d));
      const byCik = new Map<number, EdgarFiling>();
      for (const list of perDay) {
        for (const f of (list || [])) {
          const prev = byCik.get(f.cikNum);
          // An 8-K in the window beats a 10-Q in the window for the same company.
          if (!prev) { byCik.set(f.cikNum, f); continue; }
          const prevIs8K = prev.form === '8-K', curIs8K = f.form === '8-K';
          if (curIs8K && !prevIs8K) byCik.set(f.cikNum, f);
          else if (curIs8K === prevIs8K && f.filed > prev.filed) byCik.set(f.cikNum, f);
        }
      }
      filings = Array.from(byCik.values());

      // A 10-Q/10-K is usually NOT the announcement — the press release (8-K
      // Item 2.02) came days or weeks earlier. HD, CSCO and KEYS were showing
      // up 1–3 weeks after the market had traded their prints because their
      // 10-Q landed in the window. Re-date each periodic filer to its real
      // announcement; if that falls before the window, it was reported earlier
      // and is listed as such rather than graded as fresh.
      const periodic = filings.filter((f) => f.form !== '8-K');
      const redated = await pooled(periodic, 5, async (f) => ({ f, a: await announcementDateFor(f.cikNum, f.filed) }));
      const dropEarlier = new Set<number>();
      for (const x of redated) {
        if (!x) continue;
        if (x.a.via === '8-K') {
          if (x.a.date < windowStart!) { dropEarlier.add(x.f.cikNum); x.f.filed = x.a.date; }
          else { x.f.filed = x.a.date; x.f.form = '8-K'; x.f.items = ['2.02']; }
        }
      }
      reportedEarlier = filings.filter((f) => dropEarlier.has(f.cikNum));
      filings = filings.filter((f) => !dropEarlier.has(f.cikNum));
    }

    const rawTotal = filings.length;

    // Resolve any ticker the display name did not carry, then drop unlisted
    // filers (funds, trusts, private filers) — nothing to price or grade.
    const cikMap = await cikTickerMap();
    for (const f of filings) if (!f.ticker) f.ticker = cikMap.get(f.cikNum) || null;
    let listed = filings.filter((f) => !!f.ticker);
    listed.sort((a, b) => (b.filed.localeCompare(a.filed)) || a.company.localeCompare(b.company));
    if (listed.length > MAX_CANDIDATES) {
      listed = listed.slice(0, MAX_CANDIDATES);
      truncated = true;
      notes.push(`filer set truncated to the ${MAX_CANDIDATES} most recent listed filings`);
    }

    // ── 2. prices + technicals (cheap, parallel) ─────────────────────────
    const spy12 = await spyReturn12m();
    const techs = await pooled(listed, 8, (f) => usTechnicals(f.ticker!, f.filed));

    const pending: PendingFiler[] = [];
    const addPending = (f: EdgarFiling, reason: PendingFiler['reason']) => {
      pending.push({
        ticker: f.ticker || '', company: f.company, form: f.form,
        filed: f.filed, filing_url: f.filing_url, reason,
      });
    };
    for (const f of reportedEarlier) addPending(f, 'reported-earlier');

    const withPrice: Array<{ f: EdgarFiling; t: UsTechnicals }> = [];
    let noPrice = 0;
    for (let i = 0; i < listed.length; i++) {
      const t = techs[i];
      if (!t) { noPrice++; addPending(listed[i], 'no-price'); continue; }
      withPrice.push({ f: listed[i], t });
    }

    // ── 3. fundamentals from companyfacts ────────────────────────────────
    const facts = await pooled(withPrice, 5, (x) => companyFacts(x.f.cikNum));

    interface Prepared {
      f: EdgarFiling; t: UsTechnicals; shares: number | null;
      fundamentals: ReturnType<typeof extractFundamentals>;
    }
    const prepared: Prepared[] = [];
    let pendingXbrl = 0;
    for (let i = 0; i < withPrice.length; i++) {
      const fx = facts[i];
      const { f, t } = withPrice[i];
      if (!fx) { pendingXbrl++; addPending(f, 'xbrl-not-posted'); continue; }
      // For a 10-Q/10-K the reported period IS the fiscal period; for an 8-K,
      // `period_ending` is the event date, so let the extractor take the newest.
      const asOf = /^10-/.test(f.form) && f.period ? f.period : null;
      const fund = extractFundamentals(fx, asOf);
      if (!fund.q_end) { pendingXbrl++; addPending(f, 'xbrl-not-posted'); continue; }
      // Stale-quarter guard — see header note.
      if (daysBetween(f.filed, fund.q_end) > MAX_QUARTER_LAG_DAYS) {
        pendingXbrl++; addPending(f, 'quarter-stale'); continue;
      }
      // Already-public guard. If the quarter's figures reached EDGAR more than
      // 7 days BEFORE the filing we are crediting, this filing is not the
      // announcement. AIN's 1 Sep 8-K carried an Item 2.02 header for a
      // strategic-review update; its Q2 numbers had been on EDGAR since the
      // 4 Aug 10-Q, and the market had traded the print four weeks earlier.
      if (!explicit && fund.q_filed && daysBetween(f.filed, fund.q_filed) > 7) {
        addPending(f, 'reported-earlier'); continue;
      }
      prepared.push({ f, t, shares: sharesOutstandingFromFacts(fx, fund.q_end), fundamentals: fund });
    }

    // ── 4. cohort RS, then grade ─────────────────────────────────────────
    assignRsRatings(prepared.map((p) => p.t), spy12);

    const graded: UsGradedRow[] = [];
    for (const p of prepared) {
      const row = gradeUsRow({
        ticker: p.f.ticker!,
        company: p.f.company,
        sector: sectorFromSic(p.f.sic),
        filing_date: p.f.filed,
        form: p.f.form,
        items: p.f.items,
        filing_url: p.f.filing_url,
        fundamentals: p.fundamentals,
        price: {
          price: p.t.price, d1_pct: p.t.d1_pct, gap_pct: p.t.gap_pct,
          move_pct: p.t.move_pct, pct_from_52w_high: p.t.pct_from_52w_high,
          stage: p.t.stage, rs_rating: p.t.rs_rating,
          addv_musd: p.t.addv_musd, vol_ratio_20d: p.t.vol_ratio_20d,
        },
        shares_outstanding: p.shares,
      });
      if (!row) { pendingXbrl++; addPending(p.f, 'xbrl-not-posted'); continue; }
      // CFO/PAT is a funding artefact for banks, insurers and REITs — flag the
      // sector so the client preset can skip that gate, exactly as India does
      // for NBFCs.
      (row as any).is_financial = isFinancialSic(p.f.sic);
      (row as any).close_30d = p.t.close_30d;
      (row as any).reaction_date = p.t.reaction_date;
      graded.push(row);
    }

    const by_tier: Record<EarningsTier, UsGradedRow[]> = {
      BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [],
    };
    for (const r of graded) by_tier[r.tier].push(r);
    for (const t of US_TIER_ORDER) {
      by_tier[t].sort((a, b) =>
        (b.composite_score - a.composite_score) ||
        ((b.pead_score ?? 0) - (a.pead_score ?? 0)) ||
        b.filing_date.localeCompare(a.filing_date));
    }

    if (pendingXbrl > 0) {
      notes.push(`${pendingXbrl} filer${pendingXbrl > 1 ? 's' : ''} announced but XBRL not yet posted (the 10-Q usually follows the 8-K by days to weeks)`);
    }
    const earlierN = pending.filter((p) => p.reason === 'reported-earlier').length;
    if (earlierN > 0) notes.push(`${earlierN} filing(s) in the window were 10-Qs or follow-up 8-Ks for results already announced before the window — not re-graded as fresh`);
    if (noPrice > 0) {
      // Name the actual upstream failure. Without this, a Yahoo-side block from
      // the deploy host is indistinguishable from "these are all OTC tickers",
      // and diagnosing it costs a redeploy.
      const reasons = new Map<string, number>();
      for (let i = 0; i < listed.length; i++) {
        if (techs[i]) continue;
        const r = yahooLastError.get(listed[i].ticker!) || 'insufficient history';
        reasons.set(r, (reasons.get(r) || 0) + 1);
      }
      const top = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([r, n]) => `${r} ×${n}`).join(', ');
      notes.push(`${noPrice} filer(s) had no usable price history — ${top || 'OTC / newly listed / delisted'}`);
    }

    const payload: UsGradedPayload = {
      filing_date: date,
      window_days: days,
      window_start: windowStart,
      candidates_total: graded.length,
      raw_items_total: rawTotal,
      pending_xbrl_total: pendingXbrl,
      no_price_total: noPrice,
      by_tier,
      pending: pending
        .filter((p) => p.ticker)
        .sort((a, b) => b.filed.localeCompare(a.filed) || a.ticker.localeCompare(b.ticker)),
      generated_at: new Date().toISOString(),
      sources_polled: 3,
      truncated,
      notes,
    };

    const includesToday = date >= today;
    const ttl = explicit ? 15 * 60_000 : includesToday ? 15 * 60_000 : 90 * 24 * 3600_000;
    if (_cache.size >= CACHE_MAX) {
      const oldest = Array.from(_cache.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 15);
      for (const [k] of oldest) _cache.delete(k);
    }
    _cache.set(cacheKey, { at: Date.now(), ttl, data: payload });

    return NextResponse.json(payload, {
      headers: {
        'x-mc-cache': 'miss',
        'x-mc-ms': String(Date.now() - t0),
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err: any) {
    return NextResponse.json({
      filing_date: date,
      window_days: days,
      window_start: null,
      candidates_total: 0,
      raw_items_total: 0,
      pending_xbrl_total: 0,
      no_price_total: 0,
      by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
      pending: [],
      generated_at: new Date().toISOString(),
      sources_polled: 0,
      truncated: false,
      notes: [`error: ${String(err?.message || err)}`],
      error: String(err?.message || err),
    }, { status: 502 });
  }
}
