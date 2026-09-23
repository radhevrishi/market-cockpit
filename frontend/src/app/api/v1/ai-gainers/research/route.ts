// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/ai-gainers/research — THE SWEEP, IN CHUNKS, PERSISTED.    (zzz741)
//
// POST { market, rows: [{ticker, company, move_pct, volume, price, market_cap, perf}], budget_ms? }
//   Registers today's universe (idempotent), then researches as many
//   unresearched names as fit in the budget (~40s), most-moved first, and
//   saves every finding to KV as it lands. The page calls this repeatedly
//   until `remaining` is 0. A reload resumes from the store: nothing is
//   researched twice in a day, and an interrupted sweep is not lost.
//
// GET  ?market=IN
//   The day's findings and the coverage fraction. No research happens here.
//
// A finding is produced for EVERY name swept — none / routine_only / denied /
// negative / listing_artifact / source_failed are all findings — so coverage
// is a fraction that cannot lie.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchCompanyResearch } from '@/lib/ai-gainers/screener-company';
import { fetchEdgarResearch, fetchEdgarText } from '@/lib/ai-gainers/edgar-research';
import { buildFinding, coverage, classifyAnnouncement, chooseCandidate, ageDaysOf, indiaSessionCloseIso, refreshFindingMove, type Finding, type AnnouncementLite } from '@/lib/ai-gainers/catalyst-research';
import { indiaSession, isLargeCap, LARGE_CAP_MIN_CR } from '@/lib/ai-gainers/screener-gainers';
import { readAnnouncementCached, type ReadAnnouncement } from '@/lib/ai-gainers/announcement-reader';
import { extractPdfText } from '@/lib/pdf-text-extractor';
import { readBookState } from '@/lib/book-store';
import { etToday, capTierUs } from '@/lib/ai-gainers/us-gainers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_DAYS = 21;
const DEFAULT_BUDGET_MS = 40_000;
const MODEL_READS_PER_CALL = 4;

interface ResearchState {
  market: 'IN' | 'US';
  date: string;
  universe: Array<{ ticker: string; company: string | null; movePct: number | null; volume: number | null; price: number | null; marketCap: number | null; perf: any }>;
  findings: Record<string, Finding>;
  started_at: string;
  updated_at: string;
  model_reads: number;
  errors: string[];
}

const KEY = (m: string, d: string) => `ai-gainers:research:v1:${m}:${d}`;
// A session's research is read for a few days at most. Without a TTL every
// day's ~250 KB state lived in KV forever. (zzz766)
const STATE_TTL_S = 10 * 24 * 3600;
// Persisting the whole state after EVERY name was ~100 full-state writes per
// sweep. Every few names (and always at the end) loses at most those few if
// the function is killed, and they are simply re-researched. (zzz766)
const SAVE_EVERY_NAMES = 4;
const SAVE_EVERY_MS = 10_000;

// ── THE DAILY READ CEILING  (zzz747) ────────────────────────────────────────
// A sweep reads the best catalyst filing of every name that has one, most-
// moved first. On a busy day that is 60–70 model reads. The names that
// matter for a gainers brief are the top of the board; a read for the 90th
// biggest mover changes nothing anyone acts on. Past the ceiling a name is
// still researched from the filing list, the summary and the price history
// — only the verbatim-quote read is skipped (the response counts them in
// reads_skipped_for_ceiling). The
// ceiling counts PAID reads: a cached read is free and does not consume it.
const MAX_MODEL_READS_PER_DAY: Record<'IN' | 'US', number> = { IN: 40, US: 20 };

/** The store is keyed by the SESSION the screen describes, not the calendar
 *  day: after midnight IST, on a weekend or on a holiday the 1-day return is
 *  the last session's, and filing it under "today" merged two sessions'
 *  boards into one key (zzz766). */
function todayFor(market: 'IN' | 'US'): string {
  if (market === 'IN') { try { return indiaSession().date; } catch { /* fall through */ } }
  // US Eastern, not UTC: at 8 pm ET the UTC date is already tomorrow, which
  // opened a fresh day — a full re-sweep and a fresh model-read allowance —
  // four hours before the US day ended. (zzz766)
  try { return etToday(); } catch { return new Date().toISOString().slice(0, 10); }
}

/** A US universe entry the page would no longer send: a large/mega cap
 *  registered before the small/mid screen existed (zzz766). */
const usOutOfScope = (u: { marketCap: number | null }) => {
  const t = capTierUs(u.marketCap);
  return t === 'large' || t === 'mega' || t === 'nano';
};

/** Hard ceiling for one POST — the function limit is 60 s and the proxy
 *  answers a non-JSON "upstream error" past it. (zzz766) */
const US_HARD_DEADLINE_MS = 52_000;

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (ms <= 0) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/** Small/mid caps only on the India side: a large cap registered before the
 *  filter existed is dropped on read, so coverage is never counted over it. */
function smallMidOnly(st: ResearchState): { st: ResearchState; excluded: string[] } {
  if (st.market !== 'IN') return { st, excluded: [] };
  const excluded = st.universe.filter((u) => isLargeCap(u.marketCap)).map((u) => u.ticker);
  if (!excluded.length) return { st, excluded };
  const drop = new Set(excluded);
  const findings: Record<string, Finding> = {};
  for (const [t, f] of Object.entries(st.findings)) if (!drop.has(t)) findings[t] = f;
  return { st: { ...st, universe: st.universe.filter((u) => !drop.has(u.ticker)), findings }, excluded };
}

const jsonError = (e: unknown, status = 500) =>
  NextResponse.json({ ok: false, error: `Catalyst research failed: ${String((e as any)?.message || e).slice(0, 300)}` }, { status });

async function loadState(market: 'IN' | 'US', date: string): Promise<ResearchState | null> {
  try {
    const s = await kvGet<ResearchState>(KEY(market, date));
    if (!s || !s.findings) return null;
    if (market === 'US') {
      s.universe = (s.universe || []).filter((u) => !usOutOfScope(u));
      const keep = new Set(s.universe.map((u) => u.ticker));
      s.findings = Object.fromEntries(Object.entries(s.findings).filter(([t]) => keep.has(t)));
    }
    return s;
  } catch { return null; }
}

async function loadHoldings(_origin: string): Promise<Set<string>> {
  // Read the book store directly: a self-fetch through `origin` resolved to
  // an internal host on Railway and answered nothing, so no gainer was ever
  // marked as held (MARKSANS sat in "unexplained" without its 📗).
  try {
    const st: any = await readBookState(process.env.NEXT_PUBLIC_CHAT_ID || '5057319640');
    const rows: any[] = st?.tickers || st?.book?.tickers || [];
    return new Set(rows.filter((x) => x?.held).map((x) => String(x.ticker || '').toUpperCase()));
  } catch { return new Set(); }
}

/** A model read of one filing, cached by URL for 30 days (shared with the scan route). */
async function cachedRead(market: 'IN' | 'US', ticker: string, a: AnnouncementLite): Promise<{ read: ReadAnnouncement | null; cached: boolean }> {
  return readAnnouncementCached(
    { symbol: ticker, subject: a.subject, attachment_url: a.url, filing_date: a.dateIso?.slice(0, 10) || null },
    async (url) => {
      if (market === 'US') return fetchEdgarText(url);
      const ext = await extractPdfText(url, { signal: AbortSignal.timeout(20_000) });
      return ext?.text || '';
    },
  );
}

/** What the page is shown: errors only for names still on today's board (the
 *  US state carried "RAYMOND: ticker not in the SEC company list" from an
 *  earlier India-contaminated export), and findings stored before a scoring
 *  rule tightened re-capped at read time. (zzz767) */
function presentErrors(errors: string[], universe: Array<{ ticker: string }>): string[] {
  const on = new Set(universe.map((u) => u.ticker.toUpperCase()));
  return errors.filter((e) => { const t = String(e).split(':')[0].trim().toUpperCase(); return !t || !/^[A-Z0-9.&-]+$/.test(t) || on.has(t); }).slice(-5);
}
function presentFindings<T extends Record<string, any>>(findings: T): T {
  const out: Record<string, any> = {};
  for (const [k, f] of Object.entries(findings || {})) {
    if (f && f.status === 'catalyst' && f.category === 'fundraising'
      && /\bncds?\b|non[- ]convertible debenture|debentures?\b|commercial paper|term loan/i.test(String(f.headline || ''))
      && !/\bequity\b|preferential|\bqip\b|warrant|rights (issue|shares)/i.test(String(f.headline || ''))) {
      // Debt is financing, not a catalyst (zzz766) — findings stored before
      // that rule are re-read the same way here.
      out[k] = { ...f, status: 'routine_only', net: null, verdict: null, components: null, routine: [...(f.routine || []), String(f.headline)] };
      continue;
    }
    out[k] = f && f.category === 'management_change' && typeof f.net === 'number' && f.net > 15
      ? { ...f, net: 15, verdict: 'WEAK' } : f;
  }
  return out as T;
}

// Both handlers answer JSON even when they throw. (zzz766)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = (searchParams.get('market') || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
    const date = searchParams.get('date') || todayFor(market);
    const session = market === 'IN' ? indiaSession() : null;
    const raw = await loadState(market, date);
    if (!raw) return NextResponse.json({ ok: true, market, date, session, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, universe: [] });
    const { st, excluded } = smallMidOnly(raw);
    const cov = coverage(st.findings, st.universe.map((u) => u.ticker));
    return NextResponse.json({ ok: true, market, date, session, coverage: cov, findings: presentFindings(st.findings), remaining: cov.total - cov.researched, universe: st.universe, excluded_large_caps: excluded, large_cap_min_cr: market === 'IN' ? LARGE_CAP_MIN_CR : null, updated_at: st.updated_at, model_reads: st.model_reads, model_reads_ceiling: MAX_MODEL_READS_PER_DAY[market], errors: presentErrors(st.errors, st.universe) });
  } catch (e) { return jsonError(e); }
}

export async function POST(req: NextRequest) {
  try { return await research(req); } catch (e) { return jsonError(e); }
}

async function research(req: NextRequest) {
  const t0 = Date.now();
  const { origin } = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const market: 'IN' | 'US' = String(body?.market || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
  const date = String(body?.date || todayFor(market));
  const budget = Math.max(5_000, Math.min(48_000, Number(body?.budget_ms) || DEFAULT_BUDGET_MS));
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];

  const now = new Date();
  const nowIso = now.toISOString();
  const loaded = (await loadState(market, date)) || { market, date, universe: [], findings: {}, started_at: nowIso, updated_at: nowIso, model_reads: 0, errors: [] };
  const { st, excluded } = smallMidOnly(loaded);
  const sessionCloseIso = market === 'IN' ? indiaSessionCloseIso(date) : null;

  // US: the list the page sends IS today's universe. Names that fell off the
  // screen (or were never in scope — NSE rows, mega caps) leave it; the ones
  // that remain keep their findings and take the fresh move below. (zzz766)
  if (market === 'US' && rows.length) {
    const sent = new Set(rows.map((r) => String(r?.ticker || '').toUpperCase()));
    st.universe = st.universe.filter((u) => sent.has(u.ticker));
    st.findings = Object.fromEntries(Object.entries(st.findings).filter(([t]) => sent.has(t)));
  }
  // Register the universe. A ticker already present keeps its finding but
  // takes the NEW move: a name registered at 10:00 on +6% that closed +19%
  // must not keep reading +6% all evening (zzz766).
  const have = new Map(st.universe.map((u) => [u.ticker, u] as const));
  for (const r of rows) {
    const t = String(r?.ticker || '').toUpperCase();
    if (!t) continue;
    if (market === 'IN' && isLargeCap(r?.market_cap)) { if (!excluded.includes(t)) excluded.push(t); continue; }
    if (market === 'US' && !have.has(t) && usOutOfScope({ marketCap: r?.market_cap ?? null })) continue;
    const prev = have.get(t);
    if (prev) {
      const mv = typeof r?.move_pct === 'number' ? r.move_pct : prev.movePct;
      if (mv !== prev.movePct) {
        prev.movePct = mv;
        if (st.findings[t]) st.findings[t] = refreshFindingMove(st.findings[t], mv);
      }
      if (r?.volume != null) prev.volume = r.volume;
      if (r?.price != null) prev.price = r.price;
      if (r?.market_cap != null) prev.marketCap = r.market_cap;
      continue;
    }
    const u = { ticker: t, company: r?.company || null, movePct: r?.move_pct ?? null, volume: r?.volume ?? null, price: r?.price ?? null, marketCap: r?.market_cap ?? null, perf: r?.perf ?? null };
    have.set(t, u);
    st.universe.push(u);
  }

  const holdings = await loadHoldings(origin);
  if (body?.reprocess === true) { st.findings = {}; st.model_reads = 0; }   // explicit re-run of the day, e.g. after a rule change
  const todo = st.universe
    .filter((u) => !st.findings[u.ticker] || st.findings[u.ticker].status === 'unresearched' || (st.findings[u.ticker].status === 'source_failed' && body?.retry_failed))
    .sort((a, b) => (b.movePct ?? -Infinity) - (a.movePct ?? -Infinity));

  let done = 0, modelReads = 0, readsSkippedForCeiling = 0;
  const usLeft = () => US_HARD_DEADLINE_MS - (Date.now() - t0);
  let unsaved = 0, lastSave = Date.now();
  const save = async () => {
    st.updated_at = new Date().toISOString();
    st.errors = st.errors.slice(-40);
    try { await kvSet(KEY(market, date), st, STATE_TTL_S); unsaved = 0; lastSave = Date.now(); } catch { /* the next call re-does these names */ }
  };
  for (const u of todo) {
    if (Date.now() - t0 > budget) break;
    if (market === 'US' && usLeft() < 8_000) break;
    try {
      let announcements: AnnouncementLite[] = [];
      let marketCap = u.marketCap, turnover: number | null = null, returns = null as any, sources: string[] = [], sourceFailed = false;
      if (market === 'IN') {
        const cr = await fetchCompanyResearch(u.ticker, now);
        announcements = cr.announcements;
        marketCap = cr.marketCapCr ?? u.marketCap;
        if (isLargeCap(marketCap)) {
          // The screen's cap was missing or stale; the company page says large.
          st.universe = st.universe.filter((x) => x.ticker !== u.ticker);
          if (!excluded.includes(u.ticker)) excluded.push(u.ticker);
          continue;
        }
        returns = cr.returns;
        sources = cr.sources;
        sourceFailed = !cr.sources.length;
        const px = cr.lastClose ?? cr.price;
        turnover = u.volume != null && px != null ? (u.volume * px) / 1e7 : null;   // ₹ Cr
        if (cr.errors.length) st.errors.push(`${u.ticker}: ${cr.errors.join('; ')}`);
      } else {
        const er = await fetchEdgarResearch(u.ticker, WINDOW_DAYS, now, { timeoutMs: Math.max(2_000, Math.min(10_000, usLeft() / 3)) });
        announcements = er.announcements;
        sources = er.sources;
        sourceFailed = !er.sources.length;
        returns = u.perf ? { m1: u.perf.m1 ?? null, m3: u.perf.m3 ?? null, m6: u.perf.m6 ?? null, y1: u.perf.y1 ?? null, history: 999 } : null;
        turnover = u.volume != null && u.price != null ? (u.volume * u.price) / 1e6 : null;  // $ M
        if (er.errors.length) st.errors.push(`${u.ticker}: ${er.errors.join('; ')}`);
      }

      // Model-read the best catalyst candidate when the budget allows: a
      // verbatim quote is what turns "the summary says ₹279 Cr" into a fact.
      let read: { url: string; headline: string; quote: string; category: any; valueStated?: number | null } | null = null;
      const inWindow = announcements.map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, now) })).filter((a) => a.ageDays == null || a.ageDays <= WINDOW_DAYS);
      // The SAME candidate the finding will score — the first version chose
      // "first catalyst in list order" here and "highest-scoring" in the
      // finding, so every verified quote was attached to the wrong filing
      // and dropped: 22 model reads, zero verified rows.
      const cand = chooseCandidate(announcements, market, { marketCap, returns, windowDays: WINDOW_DAYS, now, sessionCloseIso })
        || (market === 'US' ? inWindow.map((a) => classifyAnnouncement(a, market)).find((c) => c.kind === 'unclassified' && (/item (1\.0[12]|2\.01|7\.01|8\.01)/i.test(c.subject) || /^6-K/i.test(c.subject))) : undefined);
      const underDailyCeiling = st.model_reads + modelReads < MAX_MODEL_READS_PER_DAY[market];
      if (cand && !underDailyCeiling) readsSkippedForCeiling++;
      if (cand && underDailyCeiling && modelReads < MODEL_READS_PER_CALL && Date.now() - t0 < budget - 12_000
        && (market !== 'US' || usLeft() > 25_000)) {
        // US: the read is raced against the function ceiling. A read that
        // outlives it still lands in the URL-keyed cache for the next call.
        const { read: r, cached } = market === 'US'
          ? await withDeadline(cachedRead(market, u.ticker, cand), usLeft() - 5_000, { read: null, cached: false })
          : await cachedRead(market, u.ticker, cand);
        if (!cached) modelReads++;
        if (r) read = { url: cand.url, headline: r.headline, quote: r.evidenceQuote, category: r.catalyst };
      }

      st.findings[u.ticker] = buildFinding({
        ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap, turnover,
        announcements, returns, holding: holdings.has(u.ticker), sources, sourceFailed, windowDays: WINDOW_DAYS, now, read, sessionCloseIso,
      });
      done++;
    } catch (e: any) {
      st.errors.push(`${u.ticker}: ${String(e?.message || e)}`);
      st.findings[u.ticker] = buildFinding({ ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap: u.marketCap, turnover: null, announcements: [], returns: null, holding: holdings.has(u.ticker), sources: [], sourceFailed: true, windowDays: WINDOW_DAYS, now });
    }
    st.model_reads += modelReads; modelReads = 0;
    unsaved++;
    if (unsaved >= SAVE_EVERY_NAMES || Date.now() - lastSave > SAVE_EVERY_MS) await save();
  }
  // Always persist at the end — also when only the universe or moves changed.
  await save();

  const cov = coverage(st.findings, st.universe.map((u) => u.ticker));
  return NextResponse.json({
    ok: true, market, date, session: market === 'IN' ? indiaSession(now) : null, excluded_large_caps: excluded, large_cap_min_cr: market === 'IN' ? LARGE_CAP_MIN_CR : null,
    researched_now: done, elapsed_ms: Date.now() - t0,
    coverage: cov, remaining: cov.total - cov.researched, findings: presentFindings(st.findings), updated_at: st.updated_at, model_reads: st.model_reads,
    model_reads_ceiling: MAX_MODEL_READS_PER_DAY[market], reads_skipped_for_ceiling: readsSkippedForCeiling, errors: presentErrors(st.errors, st.universe),
  });
}
