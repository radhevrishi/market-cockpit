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
import { usTechnicals, spyReturn12m, pooled, yahooLastError, yahooEarningsHistory, type UsTechnicals, type EpsHistoryRow } from '@/lib/us-prices';
import { nasdaqEarningsOn, type ExpectedReporter } from '@/lib/us-nasdaq';
import { guidanceFromFiling, releaseDocument, type Guidance } from '@/lib/us-guidance';
import { financialsFromReleaseHtml } from '@/lib/us-pr-financials';
import {
  extractFundamentals, gradeUsRow, assignRsRatings,
  fiscalPeriodFromFacts, usFiscalLabel, nextFiscalYear,
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
  /** Names Nasdaq expects to report on `filing_date` that have not filed yet —
   *  the India "scheduled today · results pending" list. Empties as 8-Ks land. */
  scheduled: ExpectedReporter[];
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

function fmtYoy(cur: number, prev: number): string {
  if (prev <= 0) return 'n/m';
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return `${p >= 0 ? '+' : ''}${Math.round(p)}%`;
}

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
      f: EdgarFiling; t: UsTechnicals; shares: number | null; facts: any;
      fundamentals: ReturnType<typeof extractFundamentals>;
    }
    const prepared: Prepared[] = [];
    const awaitingXbrl: Array<{ f: EdgarFiling; t: UsTechnicals; facts: any }> = [];   // candidates for a PRELIM grade
    let pendingXbrl = 0;
    for (let i = 0; i < withPrice.length; i++) {
      const fx = facts[i];
      const { f, t } = withPrice[i];
      if (!fx) { pendingXbrl++; addPending(f, 'xbrl-not-posted'); awaitingXbrl.push({ f, t, facts: null }); continue; }
      // For a 10-Q/10-K the reported period IS the fiscal period; for an 8-K,
      // `period_ending` is the event date, so let the extractor take the newest.
      const asOf = /^10-/.test(f.form) && f.period ? f.period : null;
      const fund = extractFundamentals(fx, asOf);
      if (!fund.q_end) { pendingXbrl++; addPending(f, 'xbrl-not-posted'); awaitingXbrl.push({ f, t, facts: fx }); continue; }
      // Stale-quarter guard — see header note. The 8-K is real but the XBRL on
      // file is last quarter's: a PRELIM candidate too.
      if (daysBetween(f.filed, fund.q_end) > MAX_QUARTER_LAG_DAYS) {
        pendingXbrl++; addPending(f, 'quarter-stale'); awaitingXbrl.push({ f, t, facts: fx }); continue;
      }
      // Already-public guard. If the quarter's figures reached EDGAR more than
      // 7 days BEFORE the filing we are crediting, this filing is not the
      // announcement. AIN's 1 Sep 8-K carried an Item 2.02 header for a
      // strategic-review update; its Q2 numbers had been on EDGAR since the
      // 4 Aug 10-Q, and the market had traded the print four weeks earlier.
      if (!explicit && fund.q_filed && daysBetween(f.filed, fund.q_filed) > 7) {
        addPending(f, 'reported-earlier'); continue;
      }
      prepared.push({ f, t, facts: fx, shares: sharesOutstandingFromFacts(fx, fund.q_end), fundamentals: fund });
    }

    // ── 4. cohort RS, consensus, then grade ──────────────────────────────
    assignRsRatings(prepared.map((p) => p.t), spy12);
    // Surprise must be like-for-like: Nasdaq's ADJUSTED actual vs ADJUSTED
    // consensus. Comparing the filing's GAAP EPS to a street estimate made
    // Toro look like a 38% miss on a quarter it beat on the basis analysts
    // actually use. The GAAP figure stays in the YoY tile; the surprise chip
    // is street vs street.
    const [surprises, guidances] = await Promise.all([
      pooled(prepared, 6, (p) => yahooEarningsHistory(p.f.ticker!)),
      // Guidance lives in the 8-K's press-release exhibit; a 10-Q-only filer
      // has no release to read.
      pooled(prepared, 4, (p) => (p.f.form === '8-K' && p.f.accession)
        ? guidanceFromFiling(p.f.cikNum, p.f.accession, p.f.filing_url)
        : Promise.resolve<Guidance>({ label: null, score: 0, snippets: [], source_url: null, fiscal_label: null, fiscal_q: null, fiscal_fy: null })),
    ]);

    const graded: UsGradedRow[] = [];
    for (let pi = 0; pi < prepared.length; pi++) {
      const p = prepared[pi];
      const sRows: EpsHistoryRow[] = surprises[pi] || [];
      const g = guidances[pi] || { label: null, score: 0, snippets: [], source_url: null, fiscal_label: null, fiscal_q: null, fiscal_fy: null };
      // Yahoo keys the row by fiscal-quarter END; take the row whose quarter is
      // within 45 days of the quarter we graded (52/53-week calendars shift it).
      const sLatest = sRows.find((r) => r.quarter && p.fundamentals.q_end && Math.abs(daysBetween(r.quarter, p.fundamentals.q_end)) <= 45 && r.eps_actual != null) || null;
      const fq = fiscalPeriodFromFacts(p.facts, p.fundamentals.q_end);
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
        positive_guidance: g.label === 'RAISED',
        // The filer's own words first (press-release headline), then SEC's
        // fy/fp — they disagree often enough to matter (NetApp's July quarter
        // is Q1 FY27 to NetApp and "fy 2026 Q1" to the API).
        fiscal_label: g.fiscal_label || usFiscalLabel(fq) || null,
        fiscal_year_own: g.fiscal_fy ?? fq.fy,
      });
      if (!row) { pendingXbrl++; addPending(p.f, 'xbrl-not-posted'); continue; }
      (row as any).guidance = g.label;
      (row as any).guidance_score = g.score;
      (row as any).guidance_snippets = g.snippets;
      (row as any).guidance_url = g.source_url;
      if (g.label === 'RAISED' && !row.methodology_tags.includes('guidance raised')) row.methodology_tags.push('guidance raised');
      if ((g.label === 'LOWERED' || g.label === 'WITHDRAWN') && !row.caveat_tags.includes('guidance cut')) row.caveat_tags.push('guidance cut');
      // CFO/PAT is a funding artefact for banks, insurers and REITs — flag the
      // sector so the client preset can skip that gate, exactly as India does
      // for NBFCs.
      (row as any).is_financial = isFinancialSic(p.f.sic);
      (row as any).close_30d = p.t.close_30d;
      (row as any).reaction_date = p.t.reaction_date;
      // Consensus surprise (street basis, both sides) — tagged so it shows up
      // beside the methodology / caveat chips like every other signal.
      if (sLatest && sLatest.eps_actual != null) {
        (row as any).eps_adj = sLatest.eps_actual;
        (row as any).eps_estimate = sLatest.eps_estimate;
        (row as any).eps_surprise_pct = sLatest.surprise_pct;
        if (sLatest.surprise_pct != null) {
          if (sLatest.surprise_pct >= 5 && !row.methodology_tags.includes('consensus beat')) row.methodology_tags.push('consensus beat');
          if (sLatest.surprise_pct <= -5 && !row.caveat_tags.includes('missed consensus')) row.caveat_tags.push('missed consensus');
        }
      }
      graded.push(row);
    }

    // ── 5. PRELIMINARY grades for fresh prints whose XBRL hasn't posted ───
    // DELL, AVGO, PANW report on day D; the 10-Q with the GAAP numbers can be
    // a week or more behind. Nasdaq's surprise table carries the street-basis
    // EPS the same evening, so we grade on EPS growth + surprise + reaction,
    // mark the row PRELIM, and let the full grade replace it when the filing
    // lands. Only for 8-K filers whose surprise row matches the filing date.
    if (!explicit && awaitingXbrl.length) {
      const sur = await pooled(awaitingXbrl, 6, (x) => yahooEarningsHistory(x.f.ticker!));
      const prelimCiks = new Set<number>();
      let dbgRows = 0, dbgMatch = 0, dbgEps = 0, dbgRow = 0;
      for (let i = 0; i < awaitingXbrl.length; i++) {
        const { f, t, facts: facts0 } = awaitingXbrl[i];
        const rows = sur[i] || [];
        if (rows.length) dbgRows++;
        if (!rows.length || f.form !== '8-K') continue;
        // The freshest row whose quarter ended in the ~110 days before the
        // filing and that already carries an actual — i.e. this print.
        const latest = rows.slice().reverse().find((r) => r.quarter && r.eps_actual != null
          && daysBetween(f.filed, r.quarter) >= 0 && daysBetween(f.filed, r.quarter) <= 110) || null;
        if (!latest) continue;
        dbgMatch++;
        dbgEps++;
        // ── the GAAP numbers, read from the press release ──────────────────
        // The 10-Q is days away, but the statement of operations is in the
        // 8-K's Exhibit 99.1 right now — and its PRIOR-YEAR column is a figure
        // we already hold from last year's XBRL. Every value is accepted only
        // when that prior-year column reproduces the XBRL year-ago number, so a
        // PRELIM card shows revenue, margin and GAAP EPS that have been checked
        // against a filing, or shows nothing at all.
        const yaEnd = isoAddDays(latest.quarter!, -365);
        const ya = facts0 ? extractFundamentals(facts0, yaEnd) : null;
        let pr: ReturnType<typeof financialsFromReleaseHtml> | null = null;
        let relUrl: string | null = null;
        if (ya && (ya.revenue != null || ya.net_income != null) && f.accession) {
          try {
            const doc = await releaseDocument(f.cikNum, f.accession, f.filing_url);
            relUrl = doc.url;
            if (doc.html) {
              pr = financialsFromReleaseHtml(doc.html, {
                revenue: ya.revenue, operating_income: ya.operating_income,
                net_income: ya.net_income, eps: ya.eps,
              });
            }
          } catch { pr = null; }
        }
        // Guidance first: it also carries the filer's own name for the quarter
        // ("Q2 FY27"), read from the release headline.
        let gPre: Guidance | null = null;
        try { gPre = f.accession ? await guidanceFromFiling(f.cikNum, f.accession, f.filing_url) : null; } catch { gPre = null; }
        const fiscalPrev = facts0 ? fiscalPeriodFromFacts(facts0, ya?.q_end || yaEnd) : { fy: null, q: null };
        const fiscalNow = nextFiscalYear(fiscalPrev);
        const fund = {
          q_end: latest.quarter, q_end_prev: ya?.q_end ?? null, q_filed: null,
          revenue: pr?.revenue ?? null, revenue_prev: pr?.revenue_prev ?? null,
          operating_income: pr?.operating_income ?? null, operating_income_prev: pr?.operating_income_prev ?? null,
          net_income: pr?.net_income ?? null, net_income_prev: pr?.net_income_prev ?? null,
          // GAAP diluted EPS from the release when it validated; the street
          // (adjusted) figure stays on `eps_adj`, never mixed into the YoY tile.
          eps: pr?.eps ?? null, eps_prev: pr?.eps_prev ?? null, eps_derived: false,
          cfo: null, cfo_prev: null, tags: {},
          quarters_revenue: null, quarters_eps: null, quarters_opm: null,
        };
        const row = gradeUsRow({
          ticker: f.ticker!, company: f.company, sector: sectorFromSic(f.sic),
          filing_date: f.filed, form: f.form, items: f.items, filing_url: f.filing_url,
          fundamentals: fund,
          price: {
            price: t.price, d1_pct: t.d1_pct, gap_pct: t.gap_pct, move_pct: t.move_pct,
            pct_from_52w_high: t.pct_from_52w_high, stage: t.stage, rs_rating: t.rs_rating,
            addv_musd: t.addv_musd, vol_ratio_20d: t.vol_ratio_20d,
          },
          // Cover-page share count — filed with every 10-Q/10-K/8-K wrapper, so
          // it is current even before this quarter's numbers land. Gives the
          // PRELIM card a real market cap instead of a blank.
          shares_outstanding: facts0 ? sharesOutstandingFromFacts(facts0, null) : null,
          prelim_surprise_pct: latest.surprise_pct,
          fiscal_label: gPre?.fiscal_label || usFiscalLabel(fiscalNow) || null,
          fiscal_year_own: gPre?.fiscal_fy ?? fiscalNow.fy,
        });
        if (!row) continue;
        if (pr && pr.matched.length) {
          (row as any).prelim_source = 'press release (EX-99), validated against the year-ago XBRL';
          (row as any).prelim_matched = pr.matched;
          (row as any).release_url = relUrl;
        }
        dbgRow++;
        // PRELIM never outranks a full GAAP grade.
        if (row.tier === 'BLOCKBUSTER') row.tier = 'STRONG';
        {
          const g = gPre;
          if (g) {
            (row as any).guidance = g.label; (row as any).guidance_score = g.score;
            (row as any).guidance_snippets = g.snippets; (row as any).guidance_url = g.source_url;
            if (g.label === 'RAISED' && !row.methodology_tags.includes('guidance raised')) row.methodology_tags.push('guidance raised');
            if ((g.label === 'LOWERED' || g.label === 'WITHDRAWN') && !row.caveat_tags.includes('guidance cut')) row.caveat_tags.push('guidance cut');
          }
        }
        (row as any).prelim = true;
        (row as any).is_financial = isFinancialSic(f.sic);
        (row as any).close_30d = t.close_30d;
        (row as any).reaction_date = t.reaction_date;
        (row as any).eps_basis = 'adjusted (street)';
        (row as any).eps_adj = latest.eps_actual;
        (row as any).eps_estimate = latest.eps_estimate;
        (row as any).eps_surprise_pct = latest.surprise_pct;
        if (latest.surprise_pct != null) {
          if (latest.surprise_pct >= 5 && !row.methodology_tags.includes('consensus beat')) row.methodology_tags.push('consensus beat');
          if (latest.surprise_pct <= -5 && !row.caveat_tags.includes('missed consensus')) row.caveat_tags.push('missed consensus');
        }
        if (!row.caveat_tags.includes('prelim · 10-Q pending')) row.caveat_tags.push('prelim · 10-Q pending');
        const adjLine = `adjusted EPS $${latest.eps_actual!.toFixed(2)}${latest.eps_estimate != null ? ` vs $${latest.eps_estimate.toFixed(2)} consensus (${latest.surprise_pct != null ? `${latest.surprise_pct >= 0 ? '+' : ''}${latest.surprise_pct.toFixed(0)}%` : 'n/a'})` : ''}`;
        row.narrative = (pr && pr.matched.length)
          // We have the release's own GAAP statement — keep the normal
          // narrative and add the street line plus what is still missing.
          ? `${row.narrative} Read from the earnings release and checked against last year's filing; ${adjLine}. Cash flow arrives with the 10-Q.`
          : `${f.company} reported ${row.quarter}: ${adjLine}. Revenue, margins and cash flow will fill in when the 10-Q posts to EDGAR.`;
        graded.push(row);
        prelimCiks.add(f.cikNum);
      }
      // A name with a PRELIM grade is no longer "pending".
      if (prelimCiks.size) {
        const prelimTickers = new Set(awaitingXbrl.filter((x) => prelimCiks.has(x.f.cikNum)).map((x) => x.f.ticker));
        for (let i = pending.length - 1; i >= 0; i--) {
          if (prelimTickers.has(pending[i].ticker) && (pending[i].reason === 'xbrl-not-posted' || pending[i].reason === 'quarter-stale')) {
            pending.splice(i, 1); pendingXbrl = Math.max(0, pendingXbrl - 1);
          }
        }
        notes.push(`${prelimCiks.size} fresh print(s) graded PRELIM on adjusted EPS + consensus + reaction — full GAAP grade follows when the 10-Q posts`);
      } else if (awaitingXbrl.length) {
        notes.push(`prelim: ${awaitingXbrl.length} awaiting XBRL, ${dbgRows} had a Nasdaq surprise history, ${dbgMatch} matched the filing date, ${dbgEps} with EPS, ${dbgRow} graded`);
      }
    }

    // Scheduled on `date` but not yet filed — the "results pending" list.
    let scheduled: ExpectedReporter[] = [];
    if (!explicit) {
      try {
        const filedSet = new Set(filings.map((f) => f.ticker).filter(Boolean) as string[]);
        const exp = await nasdaqEarningsOn(date);
        scheduled = exp.filter((e) => !filedSet.has(e.ticker));
        // A foreign private issuer (Grifols, NIO, Canaan…) reports on a 6-K, not
        // an 8-K, and files 20-F/40-F annually — it will NEVER move into a tier
        // off an 8-K, and leaving it sitting in "results pending" for ever looks
        // like the engine missed it. Mark them so the card can say why. Checked
        // for the largest names only; `submissions` is cached 6h.
        const probe = scheduled.slice()
          .sort((a, b) => (b.market_cap_musd ?? 0) - (a.market_cap_musd ?? 0)).slice(0, 20);
        const marks = await pooled(probe, 5, async (e) => {
          const cik = await tickerToCik(e.ticker);
          if (!cik) return { t: e.ticker, foreign: false };
          const s = await submissions(cik);
          if (!s) return { t: e.ticker, foreign: false };
          const recent = s.recent.slice(0, 250);
          const foreign = recent.some((r) => /^(6-K|20-F|40-F)/.test(r.form))
            && !recent.some((r) => r.form === '8-K' && r.items.includes('2.02'));
          return { t: e.ticker, foreign };
        });
        const foreignSet = new Set(marks.filter((m) => m?.foreign).map((m) => m!.t));
        if (foreignSet.size) {
          scheduled = scheduled.map((e) => foreignSet.has(e.ticker) ? { ...e, foreign_filer: true } as ExpectedReporter : e);
        }
      } catch { scheduled = []; }
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
      scheduled: scheduled.sort((a, b) => (b.market_cap_musd ?? 0) - (a.market_cap_musd ?? 0)),
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
      scheduled: [],
      generated_at: new Date().toISOString(),
      sources_polled: 0,
      truncated: false,
      notes: [`error: ${String(err?.message || err)}`],
      error: String(err?.message || err),
    }, { status: 502 });
  }
}
