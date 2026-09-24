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
//   `stale_rules` counts findings built under an older RULES_VERSION.
//
// POST { market, rescoreOnly: true, rows? }                          (zzz769)
//   Re-classifies and re-scores the day's EXISTING findings under the
//   current rules, from inputs stored with each finding or — for findings
//   stored before inputs were kept — the free filing/price fetches, with
//   model reads taken ONLY from the read cache (cacheOnly). It never makes a
//   model read, never adds a name, never touches the day's read count, so
//   the page may call it on open without a click.
//
// A finding is produced for EVERY name swept — none / routine_only / denied /
// negative / listing_artifact / source_failed are all findings — so coverage
// is a fraction that cannot lie.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchCompanyResearch, yahooReturns } from '@/lib/ai-gainers/screener-company';
import { fetchEdgarResearch, fetchEdgarText } from '@/lib/ai-gainers/edgar-research';
import { mergeAnnouncements, buildFinding, coverage, indiaSessionCloseIso, refreshFindingMove, pickReadCandidate, compactInputs, rescoreFromInputs, staleRuleTickers, RULES_VERSION, type Finding, type AnnouncementLite, type StoredSweepInputs, type Returns } from '@/lib/ai-gainers/catalyst-research';
import { presentFindings, presentErrorLines } from '@/lib/ai-gainers/research-present';
import { indiaSession, isLargeCap, LARGE_CAP_MIN_CR } from '@/lib/ai-gainers/screener-gainers';
import { readAnnouncementCached, type ReadAnnouncement } from '@/lib/ai-gainers/announcement-reader';
import { extractPdfText } from '@/lib/pdf-text-extractor';
import { readBookState } from '@/lib/book-store';
import { etToday, capTierUs } from '@/lib/ai-gainers/us-gainers';
import { buildResearchView, type ResearchView } from '@/lib/ai-gainers/research-view';
import { fetchGoogleNewsRSS } from '@/lib/indian-news-rss';
import { yahooChart } from '@/lib/us-prices';
import { fetchBseAnnouncementsLite } from '@/lib/thesis/evidence-discovery';
import { buildNewsContext, type NewsContext } from '@/lib/ai-gainers/news-context';

/** Press coverage for one gainer, cached for the day. Secondary evidence
 *  only: it explains where to look, it never scores. A failure is an empty
 *  context, never an error on the finding. (zzz773) */
async function newsFor(market: 'IN' | 'US', ticker: string, name: string | null, date: string, now: Date): Promise<NewsContext | null> {
  const key = `ag-news:v1:${market}:${ticker}:${date}`;
  try { const hit = await kvGet<NewsContext>(key); if (hit && Array.isArray(hit.items)) return hit; } catch { /* cache is optional */ }
  // A screen abbreviation ("Jay Bharat Maru.") loses its clipped last word;
  // the full page title ("Kavveri Defence & Wireless Technologies Ltd") is
  // searched as an exact phrase.
  const raw0 = String(name || '').trim();
  const abbreviated = /\.$/.test(raw0);
  const clean = raw0.replace(/\s+\S+\.$/, abbreviated ? '' : '$&').replace(/\b(ltd|limited|inc|corp|corporation|plc|holdings)\b\.?,?/gi, '').replace(/[.,]+$/, '').replace(/\s+/g, ' ').trim();
  const q = clean.length >= 4 ? `"${clean}"${abbreviated ? (market === 'IN' ? ' share' : ' stock') : ''} when:45d` : `${ticker} ${market === 'IN' ? 'share' : 'stock'} when:45d`;
  try {
    const raw = await Promise.race([fetchGoogleNewsRSS(q), new Promise<[]>((r) => setTimeout(() => r([]), 7_000))]);
    const ctx = buildNewsContext(raw, { ticker, company: clean || name, now, query: q });
    try { await kvSet(key, ctx, 12 * 3600); } catch { /* optional */ }
    return ctx;
  } catch { return null; }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_DAYS = 21;
const DEFAULT_BUDGET_MS = 40_000;
const MODEL_READS_PER_CALL = 6;

interface ResearchState {
  market: 'IN' | 'US';
  date: string;
  universe: UniverseEntry[];
  findings: Record<string, Finding>;
  /** What each finding was built from, so a rules change re-scores without
   *  a refetch or a model read. (zzz769) */
  inputs?: Record<string, StoredSweepInputs>;
  /** RULES_VERSION every finding in the state was built under, or the older
   *  stamp while any finding predates the current rules. (zzz769) */
  rules_version?: string | null;
  /** Names dropped from the universe (large caps found on the company page,
   *  US out-of-scope caps) — persisted, so the page does not count them as
   *  board names awaiting research forever. (zzz769) */
  excluded?: string[];
  started_at: string;
  updated_at: string;
  model_reads: number;
  errors: string[];
}

interface UniverseEntry { ticker: string; company: string | null; movePct: number | null; volume: number | null; price: number | null; marketCap: number | null; perf: any; filedResult?: boolean }

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
const MAX_MODEL_READS_PER_DAY: Record<'IN' | 'US', number> = { IN: 70, US: 30 };

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
async function cachedRead(market: 'IN' | 'US', ticker: string, a: AnnouncementLite, opts: { cacheOnly?: boolean } = {}): Promise<{ read: ReadAnnouncement | null; cached: boolean }> {
  return readAnnouncementCached(
    { symbol: ticker, subject: a.subject, attachment_url: a.url, filing_date: a.dateIso?.slice(0, 10) || null },
    async (url) => {
      if (market === 'US') return fetchEdgarText(url);
      const ext = await extractPdfText(url, { signal: AbortSignal.timeout(20_000) });
      return ext?.text || '';
    },
    opts,
  );
}

/** The response every handler answers with: findings decoded, errors as
 *  one short line per ticker, coverage, and the rules-version state. */
function statePayload(st: ResearchState, excluded: string[]) {
  const tickers = st.universe.map((u) => u.ticker);
  const cov = coverage(st.findings, tickers);
  const errs = presentErrorLines(st.errors, st.universe, 5);
  return {
    coverage: cov, remaining: cov.total - cov.researched, findings: presentFindings(st.findings), universe: st.universe,
    excluded_large_caps: Array.from(new Set([...excluded, ...(st.excluded || [])])), large_cap_min_cr: st.market === 'IN' ? LARGE_CAP_MIN_CR : null,
    updated_at: st.updated_at, model_reads: st.model_reads, model_reads_ceiling: MAX_MODEL_READS_PER_DAY[st.market],
    errors: errs.map((e) => e.short), error_details: errs.map((e) => e.full),
    rules_version: st.rules_version ?? null, rules_version_current: RULES_VERSION, stale_rules: staleRuleTickers(st.findings, tickers).length,
  };
}

/** The state's stamp: current only when every finding is. */
function stampRules(st: ResearchState) {
  const stale = staleRuleTickers(st.findings, st.universe.map((u) => u.ticker)).length;
  if (!stale) st.rules_version = RULES_VERSION;
}

// Both handlers answer JSON even when they throw. (zzz766)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = (searchParams.get('market') || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
    const date = searchParams.get('date') || todayFor(market);
    const session = market === 'IN' ? indiaSession() : null;
    const raw = await loadState(market, date);
    if (!raw) return NextResponse.json({ ok: true, market, date, session, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, universe: [], errors: [], error_details: [], rules_version: null, rules_version_current: RULES_VERSION, stale_rules: 0 });
    const { st, excluded } = smallMidOnly(raw);
    const payload = statePayload(st, excluded);
    const view = await viewFor(st, market, date, session);
    return NextResponse.json({ ok: true, market, date, session, ...payload, view });
  } catch (e) { return jsonError(e); }
}

// ── THE RESEARCH VIEW, SERVER-SIDE  (zzz770 AG-A) ───────────────────────────
// Built from what is already stored: the day's findings, its universe, the
// cached scan's filed-result rows and the book. KV reads only — opening the
// page never makes a model call or an upstream fetch here.

async function loadBook(): Promise<{ held: string[]; watch: string[] }> {
  try {
    const st: any = await readBookState(process.env.NEXT_PUBLIC_CHAT_ID || '5057319640');
    const rows: any[] = st?.tickers || st?.book?.tickers || [];
    return {
      held: rows.filter((x) => x?.held).map((x) => String(x.ticker || '').toUpperCase()),
      watch: rows.filter((x) => x?.watchlisted || x?.benched).map((x) => String(x.ticker || '').toUpperCase()),
    };
  } catch { return { held: [], watch: [] }; }
}

/** The scan's filed-result rows from its 20-minute cache (the page scans
 *  with limit=15). A cold cache is an empty list, never a fresh scan. */
async function cachedFiledResults(market: 'IN' | 'US', date: string): Promise<{ rows: any[]; generatedAt: string | null }> {
  for (const limit of [15, 10, 25]) {
    try {
      const hit: any = await kvGet(market === 'IN' ? `ai-gainers:v3:IN:${date}:${limit}` : `ai-gainers:v3:US:${limit}`);
      if (hit && hit.ok) return { rows: Array.isArray(hit.filed_results) ? hit.filed_results : [], generatedAt: hit.generated_at || null };
    } catch { /* next */ }
  }
  return { rows: [], generatedAt: null };
}

async function viewFor(st: ResearchState, market: 'IN' | 'US', date: string, session: ReturnType<typeof indiaSession> | null): Promise<ResearchView | null> {
  try {
    const [book, filed] = await Promise.all([loadBook(), cachedFiledResults(market, date)]);
    const status = market === 'IN'
      ? (session && session.date !== date ? 'previous_session' : session?.state === 'open' ? 'live' : session?.state === 'closed' ? 'closed' : 'last_completed')
      : 'weekly_export';
    return buildResearchView({
      market,
      findings: presentFindings(st.findings),
      board: st.universe.map((u) => ({ ticker: u.ticker, company: u.company, move_pct: u.movePct, market_cap: u.marketCap, perf: u.perf })),
      filedResults: filed.rows,
      holdings: book.held,
      watchlist: book.watch,
      errors: st.errors,
      now: st.updated_at,
      session: {
        date, scanAt: st.updated_at || null, status, cached: true,
        // A stored day that is not the current session is never labelled today.
        label: market === 'IN' ? (session && session.date === date ? session.label : `Session ${date} (stored)`) : `US week to ${date}`,
        isToday: market === 'IN' ? (session ? session.isToday && session.date === date : null) : null,
      },
    });
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    // The no-spend path is decided FIRST and never falls through to the
    // sweep: `rescoreOnly` cannot make a model read whatever else is sent.
    if (body?.rescoreOnly === true) return await rescoreOnly(req, body);
    return await research(req, body);
  } catch (e) { return jsonError(e); }
}

async function research(req: NextRequest, body: any) {
  const t0 = Date.now();
  const { origin } = new URL(req.url);
  const market: 'IN' | 'US' = String(body?.market || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
  const date = String(body?.date || todayFor(market));
  const budget = Math.max(5_000, Math.min(48_000, Number(body?.budget_ms) || DEFAULT_BUDGET_MS));
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];

  const now = new Date();
  const nowIso = now.toISOString();
  const loaded = (await loadState(market, date)) || { market, date, universe: [], findings: {}, started_at: nowIso, updated_at: nowIso, model_reads: 0, errors: [] };
  const { st, excluded } = smallMidOnly(loaded);
  st.inputs = st.inputs || {};
  st.excluded = st.excluded || [];
  const exclude = (t: string) => { if (!excluded.includes(t)) excluded.push(t); if (!st.excluded!.includes(t)) st.excluded!.push(t); };
  const sessionCloseIso = market === 'IN' ? indiaSessionCloseIso(date) : null;

  // US: the list the page sends IS today's universe. Names that fell off the
  // screen (or were never in scope — NSE rows, mega caps) leave it; the ones
  // that remain keep their findings and take the fresh move below. (zzz766)
  if (market === 'US' && rows.length) {
    const sent = new Set(rows.map((r) => String(r?.ticker || '').toUpperCase()));
    st.universe = st.universe.filter((u) => sent.has(u.ticker));
    st.findings = Object.fromEntries(Object.entries(st.findings).filter(([t]) => sent.has(t)));
    st.inputs = Object.fromEntries(Object.entries(st.inputs).filter(([t]) => sent.has(t)));
  }
  // Register the universe. A ticker already present keeps its finding but
  // takes the NEW move: a name registered at 10:00 on +6% that closed +19%
  // must not keep reading +6% all evening (zzz766).
  const have = new Map(st.universe.map((u) => [u.ticker, u] as const));
  for (const r of rows) {
    const t = String(r?.ticker || '').toUpperCase();
    if (!t) continue;
    if (market === 'IN' && isLargeCap(r?.market_cap)) { exclude(t); continue; }
    if (market === 'US' && !have.has(t) && usOutOfScope({ marketCap: r?.market_cap ?? null })) { exclude(t); continue; }
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
      if (typeof r?.filed_result === 'boolean') prev.filedResult = r.filed_result;
      continue;
    }
    const u: UniverseEntry = { ticker: t, company: r?.company || null, movePct: r?.move_pct ?? null, volume: r?.volume ?? null, price: r?.price ?? null, marketCap: r?.market_cap ?? null, perf: r?.perf ?? null, filedResult: r?.filed_result === true };
    have.set(t, u);
    st.universe.push(u);
  }

  const holdings = await loadHoldings(origin);
  // Explicit re-run of the day after a rule change. The day's model-read
  // count is KEPT: re-used reads come from the 30-day cache and cost nothing,
  // and the daily ceiling still bounds any new read. (zzz768)
  if (body?.reprocess === true) { st.findings = {}; st.inputs = {}; }
  const todo = st.universe
    .filter((u) => !st.findings[u.ticker] || st.findings[u.ticker].status === 'unresearched' || (st.findings[u.ticker].status === 'source_failed' && body?.retry_failed))
    .sort((a, b) => (b.movePct ?? -Infinity) - (a.movePct ?? -Infinity));

  let done = 0, modelReads = 0, readsSkippedForCeiling = 0;
  const usLeft = () => US_HARD_DEADLINE_MS - (Date.now() - t0);
  let unsaved = 0, lastSave = Date.now();
  const save = async () => {
    st.updated_at = new Date().toISOString();
    st.errors = st.errors.slice(-40);
    stampRules(st);
    try { await kvSet(KEY(market, date), st, STATE_TTL_S); unsaved = 0; lastSave = Date.now(); } catch { /* the next call re-does these names */ }
  };
  // zzz774: names are researched a few at a time (India) — one slow
  // screener.in answer no longer holds up the rest of the board.
  const one = async (u: typeof todo[number]): Promise<void> => {
    try {
      let announcements: AnnouncementLite[] = [];
      let marketCap = u.marketCap, turnover: number | null = null, returns = null as any, sources: string[] = [], sourceFailed = false, fullName: string | null = null;
      if (market === 'IN') {
        const cr = await fetchCompanyResearch(u.ticker, now);
        // zzz773: BSE's full filing list for the window, beside screener's
        // five newest — and the filing source when screener.in is down.
        const bse = await withDeadline(fetchBseAnnouncementsLite(u.ticker, cr.bseCode, WINDOW_DAYS + 1), 20_000, { items: [], code: null, error: 'BSE timed out' });
        announcements = mergeAnnouncements(cr.announcements, bse.items.map((b) => ({ subject: b.subject, summary: b.summary, url: b.url, dateIso: b.dateIso, ageDays: null })) as AnnouncementLite[]);
        if (bse.items.length || (bse.code && !bse.error)) cr.sources.push('BSE corporate announcements');
        else if (bse.error) cr.errors.push(bse.error);
        marketCap = cr.marketCapCr ?? u.marketCap;
        if (isLargeCap(marketCap)) {
          // The screen's cap was missing or stale; the company page says large.
          st.universe = st.universe.filter((x) => x.ticker !== u.ticker);
          exclude(u.ticker);
          return;
        }
        returns = cr.returns;
        fullName = cr.companyName ?? null;
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
        // zzz773: dated closes, so the reaction to a DATED filing can be
        // measured (the export carries trailing returns only). Best-effort:
        // no series leaves the pricing assessment at INSUFFICIENT EVIDENCE.
        if (usLeft() > 20_000) {
          const bars = await withDeadline(yahooChart(u.ticker, '6mo'), 8_000, null);
          if (bars && bars.close.length > 25) {
            const tail = bars.dates.map((d, k) => [d, bars.close[k]] as [string, number]).slice(-90);
            returns = { ...(returns || { m1: null, m3: null, m6: null, y1: null, history: bars.close.length }), tail };
          }
        }
        turnover = u.volume != null && u.price != null ? (u.volume * u.price) / 1e6 : null;  // $ M
        if (er.errors.length) st.errors.push(`${u.ticker}: ${er.errors.join('; ')}`);
      }

      const news = market === 'US' && usLeft() < 15_000 ? null : await newsFor(market, u.ticker, fullName || u.company, date, now);

      // Model-read the best catalyst candidate when the budget allows: a
      // verbatim quote is what turns "the summary says ₹279 Cr" into a fact.
      let read: { url: string; headline: string; quote: string; category: any; valueStated?: number | null; facts?: Record<string, string> | null } | null = null;
      // The SAME candidate the finding will score — the first version chose
      // "first catalyst in list order" here and "highest-scoring" in the
      // finding, so every verified quote was attached to the wrong filing
      // and dropped: 22 model reads, zero verified rows.
      const cand = pickReadCandidate(announcements, market, { marketCap, returns, windowDays: WINDOW_DAYS, now, sessionCloseIso });
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
        if (r) read = { url: cand.url, headline: r.headline, quote: r.evidenceQuote, category: r.catalyst, facts: r.facts ?? null };
      }

      st.findings[u.ticker] = { ...buildFinding({
        ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap, turnover,
        announcements, returns, holding: holdings.has(u.ticker), sources, sourceFailed, windowDays: WINDOW_DAYS, now, read, sessionCloseIso, filedResult: !!u.filedResult, news,
      }), rulesVersion: RULES_VERSION };
      st.inputs![u.ticker] = compactInputs({ announcements, returns, marketCap, turnover, sources, sourceFailed, fetchedAt: now.toISOString(), read, news }, WINDOW_DAYS, now);
      done++;
    } catch (e: any) {
      st.errors.push(`${u.ticker}: ${String(e?.message || e)}`);
      st.findings[u.ticker] = { ...buildFinding({ ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap: u.marketCap, turnover: null, announcements: [], returns: null, holding: holdings.has(u.ticker), sources: [], sourceFailed: true, windowDays: WINDOW_DAYS, now }), rulesVersion: RULES_VERSION };
    }
    st.model_reads += modelReads; modelReads = 0;
    unsaved++;
    if (unsaved >= SAVE_EVERY_NAMES || Date.now() - lastSave > SAVE_EVERY_MS) await save();
  };
  const queue = [...todo];
  const workers = Array.from({ length: market === 'IN' ? 3 : 1 }, async () => {
    while (queue.length) {
      if (Date.now() - t0 > budget) break;
      if (market === 'US' && usLeft() < 8_000) break;
      await one(queue.shift()!);
    }
  });
  await Promise.all(workers);
  // Always persist at the end — also when only the universe or moves changed.
  await save();

  return NextResponse.json({
    ok: true, market, date, session: market === 'IN' ? indiaSession(now) : null,
    researched_now: done, elapsed_ms: Date.now() - t0, reads_skipped_for_ceiling: readsSkippedForCeiling,
    ...statePayload(st, excluded),
    view: await viewFor(st, market, date, market === 'IN' ? indiaSession(now) : null),
  });
}

// ── RE-SCORE ONLY — no model read, ever.                             (zzz769)
async function rescoreOnly(req: NextRequest, body: any) {
  const t0 = Date.now();
  const { origin } = new URL(req.url);
  const market: 'IN' | 'US' = String(body?.market || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
  const date = String(body?.date || todayFor(market));
  const budget = Math.max(5_000, Math.min(45_000, Number(body?.budget_ms) || DEFAULT_BUDGET_MS));
  const loaded = await loadState(market, date);
  const session = market === 'IN' ? indiaSession() : null;
  if (!loaded) return NextResponse.json({ ok: true, market, date, session, rescored_now: 0, rescore_failed: 0, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, universe: [], errors: [], error_details: [], rules_version: null, rules_version_current: RULES_VERSION, stale_rules: 0 });
  const { st, excluded } = smallMidOnly(loaded);
  st.inputs = st.inputs || {};
  const sessionCloseIso = market === 'IN' ? indiaSessionCloseIso(date) : null;
  // Rows update what the scan knows about names ALREADY in the universe (the
  // filed-result flag, the latest move). A rescore adds and drops nothing.
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  const byTicker = new Map(st.universe.map((u) => [u.ticker, u] as const));
  for (const r of rows) {
    const u = byTicker.get(String(r?.ticker || '').toUpperCase());
    if (!u) continue;
    if (typeof r?.filed_result === 'boolean') u.filedResult = r.filed_result;
    if (typeof r?.move_pct === 'number') u.movePct = r.move_pct;
  }
  const holdings = await loadHoldings(origin);
  const stale = new Set(staleRuleTickers(st.findings, st.universe.map((u) => u.ticker)));
  let rescored = 0, failed = 0;
  for (const u of st.universe) {
    if (!stale.has(u.ticker)) continue;
    if (Date.now() - t0 > budget) break;
    try {
      let inputs: StoredSweepInputs | undefined = st.inputs[u.ticker];
      if (!inputs) {
        // Stored before inputs were kept: the FREE fetches only — the
        // screener.in company page / price history, or EDGAR submissions.
        const now = new Date();
        if (market === 'IN') {
          const cr = await fetchCompanyResearch(u.ticker, now);
          if (!cr.sources.length) { failed++; continue; }        // keep the old finding rather than a "source failed" one
          const px = cr.lastClose ?? cr.price;
          inputs = compactInputs({ announcements: cr.announcements, returns: cr.returns, marketCap: cr.marketCapCr ?? u.marketCap, turnover: u.volume != null && px != null ? (u.volume * px) / 1e7 : null, sources: cr.sources, sourceFailed: false, fetchedAt: now.toISOString() }, WINDOW_DAYS, now);
        } else {
          const er = await fetchEdgarResearch(u.ticker, WINDOW_DAYS, now, { timeoutMs: 8_000 });
          if (!er.sources.length) { failed++; continue; }
          const returns: Returns | null = u.perf ? { m1: u.perf.m1 ?? null, m3: u.perf.m3 ?? null, m6: u.perf.m6 ?? null, y1: u.perf.y1 ?? null, history: 999 } : null;
          inputs = compactInputs({ announcements: er.announcements, returns, marketCap: u.marketCap, turnover: u.volume != null && u.price != null ? (u.volume * u.price) / 1e6 : null, sources: er.sources, sourceFailed: false, fetchedAt: now.toISOString() }, WINDOW_DAYS, now);
        }
      }
      // The read for the filing the CURRENT rules choose: the stored one if
      // it is the same filing, else the read cache only. cacheOnly never
      // calls the model — a filing nobody has paid to read stays unread.
      const at = new Date(inputs.fetchedAt);
      const cand = pickReadCandidate(inputs.announcements, market, { marketCap: inputs.marketCap, returns: inputs.returns, windowDays: WINDOW_DAYS, now: at, sessionCloseIso });
      let read: StoredSweepInputs['read'] = null;
      if (cand) {
        if (inputs.read && inputs.read.url === cand.url) read = inputs.read;
        else {
          const { read: r } = await cachedRead(market, u.ticker, cand, { cacheOnly: true });
          if (r) read = { url: cand.url, headline: r.headline, quote: r.evidenceQuote, category: r.catalyst, facts: r.facts ?? null };
        }
      }
      inputs = { ...inputs, read };
      // zzz776: a first pass whose price history failed is not left blank —
      // the re-score fills it from Yahoo daily closes (free, no model).
      if (market === 'IN' && !inputs.returns && Date.now() - t0 < budget - 10_000) {
        const y = await yahooReturns(u.ticker).catch(() => null);
        if (y) inputs = { ...inputs, returns: y.returns, sources: [...(inputs.sources || []), y.source] };
      }
      st.inputs[u.ticker] = inputs;
      const f = rescoreFromInputs(inputs, { ticker: u.ticker, company: u.company, market, movePct: u.movePct, holding: holdings.has(u.ticker), filedResult: !!u.filedResult, windowDays: WINDOW_DAYS, sessionCloseIso });
      st.findings[u.ticker] = f;
      rescored++;
    } catch { failed++; }
  }
  if (rescored) {
    st.updated_at = new Date().toISOString();
    stampRules(st);
    try { await kvSet(KEY(market, date), st, STATE_TTL_S); } catch { /* the next open re-scores again — it is free */ }
  }
  return NextResponse.json({
    ok: true, market, date, session, rescore_only: true, model_reads_made: 0,
    rescored_now: rescored, rescore_failed: failed, elapsed_ms: Date.now() - t0,
    ...statePayload(st, excluded),
    view: await viewFor(st, market, date, session),
  });
}
