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
import { fetchCompanyResearch, yahooReturns, fetchNseAnnouncementsLite } from '@/lib/ai-gainers/screener-company';
import { chooseDocuments, readIndiaDocuments, relatedFilings, INDIA_HISTORY_BUDGET, type DocRead, type IndiaFacts } from '@/lib/ai-gainers/india-extract';
import { fetchEdgarResearch, fetchEdgarText, readUsFilingDocument, usFindingEvidence, type EdgarResearch, type UsDocReadResult } from '@/lib/ai-gainers/edgar-research';
import { mergeAnnouncements, buildFinding, classifyAnnouncement, coverage, ageDaysOf, isBackdropFiling, filedAfterClose, indiaSessionCloseIso, refreshFindingMove, pickReadCandidate, compactInputs, rescoreFromInputs, staleRuleTickers, RULES_VERSION, type Finding, type AnnouncementLite, type StoredSweepInputs, type Returns } from '@/lib/ai-gainers/catalyst-research';
import { presentFindings, presentErrorLines } from '@/lib/ai-gainers/research-present';
import { indiaSession, isLargeCap, LARGE_CAP_MIN_CR } from '@/lib/ai-gainers/screener-gainers';
import { readAnnouncementCached, type ReadAnnouncement } from '@/lib/ai-gainers/announcement-reader';
import { extractPdfText } from '@/lib/pdf-text-extractor';
import { readBookState } from '@/lib/book-store';
import { readUsBook } from '@/lib/us-book-store';
import { etToday, capTierUs, usPhaseAt, lastCompletedNyseSession } from '@/lib/ai-gainers/us-gainers';
import { buildResearchView, type ResearchView } from '@/lib/ai-gainers/research-view';
import { fetchGoogleNewsRSS } from '@/lib/indian-news-rss';
import { yahooChart } from '@/lib/us-prices';
import { fetchBseAnnouncementsLite } from '@/lib/thesis/evidence-discovery';
import { buildNewsContext, newsQueryFor, type NewsContext } from '@/lib/ai-gainers/news-context';
import { IN_BACKDROP_DAYS } from '@/lib/ai-gainers/in-event-taxonomy';
import { detectPersistentCatalysts, summarizePersistence, trackPotentialFromFinding, PERSIST_CATEGORIES, type PersistentCatalyst } from '@/lib/catalyst/persistence';
import { upsertDetections, loadCatalystRecords, rememberGainerCatalysts, catalystRecordsFor } from '@/lib/catalyst/persistence-store';
import { loadLedger } from '@/lib/thesis/evidence-store';
import { fetchUsCard, usMoveDate } from '@/lib/ai-gainers/us-card-fetch';
import { buildUsCard, withPressCatalysts, US_CARD_VERSION, type UsCard } from '@/lib/ai-gainers/us-card';
import { boardHash, droppedFromBoard } from '@/lib/ai-gainers/us-board-sync';

// ── zzz780: DAILY GAINER → EVENT → EVIDENCE → PERSISTENCE TEST ───────────
// The move is only the discovery trigger: the test reads the filing behind
// it plus the company's evidence ledger (when there is one). Price never
// enters. Detections worth remembering go to the shared persistence memory.
async function withPersistence(f: Finding, sink: PersistentCatalyst[], announcements?: AnnouncementLite[] | null): Promise<Finding> {
  // zzz782: an enabling step (MoU / JDA / LoI) is remembered as a TRACKED
  // potential catalyst with its conversion chain — never Special Focus.
  if (f && f.status === 'catalyst' && (f as any).stage === 'enabling') {
    try {
      const tp = trackPotentialFromFinding(f);
      if (tp) { sink.push(tp); return { ...f, persistence: summarizePersistence(tp, false) }; }
    } catch { /* tracking is best-effort */ }
  }
  if (!f || f.status !== 'catalyst' || !PERSIST_CATEGORIES.has(String(f.category || ''))) return f;
  try {
    const ledger = f.market === 'IN' ? await loadLedger(f.ticker).catch(() => null) : null;
    // zzz781: the OTHER catalyst filings in the window — a second order from
    // the same company is a repeat order, not a new catalyst.
    const extraFindings = (announcements || []).filter((a) => a.url !== f.sourceUrl).map((a) => {
      const c = classifyAnnouncement(a, f.market);
      return c.kind === 'catalyst' && c.category && PERSIST_CATEGORIES.has(String(c.category))
        ? { status: 'catalyst', category: c.category, stage: c.stage, valueStated: c.valueStated, headline: a.summary || a.subject, sourceDate: a.dateIso, sourceUrl: a.url, facts: null, modelRead: false }
        : null;
    }).filter(Boolean).slice(0, 8);
    const list = detectPersistentCatalysts({ ticker: f.ticker, ledger, finding: f, extraFindings, origin: 'gainers' });
    const mine = list.filter((p) => p.evidence.some((e) => e.origin === 'gainer'));
    const best = mine[0] || null;
    for (const p of list) if (p.specialFocus || p.confidence === 'HIGH' || p.confidence === 'MEDIUM') sink.push(p);
    return { ...f, persistence: best ? summarizePersistence(best, !!ledger) : null };
  } catch { return f; }
}

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
  // zzz789: one shared rule — a one-word name is searched with a stock word
  // ("Arvind" alone returns Arvind Kejriwal), and every headline must pass
  // the entity-identity check in buildNewsContext.
  const q = newsQueryFor(ticker, name, market);
  try {
    const raw = await Promise.race([fetchGoogleNewsRSS(q), new Promise<[]>((r) => setTimeout(() => r([]), 7_000))]);
    const ctx = buildNewsContext(raw, { ticker, company: clean || name, now, query: q });
    try { await kvSet(key, ctx, 12 * 3600); } catch { /* optional */ }
    return ctx;
  } catch { return null; }
}

// ── zzz785: INDIA — READ THE FILED DOCUMENTS, NOT ONLY THE SUBJECT ─────────
// Up to three documents per name (the top candidate, generic / unclassified
// subjects, the other substantive filings), each read once and cached by
// issuer + date + sequence id; then, when the event names a counterparty,
// programme or subsidiary, up to two OLDER related filings from a 365-day
// BSE list so the catalyst can be threaded into a timeline. Deterministic
// text extraction — no model call.
const kvAdapter = { get: (k: string) => kvGet<any>(k), set: (k: string, v: any, ttl: number) => kvSet(k, v, ttl) };
const pdfText = async (url: string) => { const ext = await extractPdfText(url, { timeoutMs: 12_000 }); return ext?.text || ''; };

async function indiaDocuments(ticker: string, announcements: AnnouncementLite[], opts: { now: Date; sessionCloseIso: string | null; marketCap: number | null; returns: Returns | null; bseCode: string | null; companyName: string | null; msLeft: number }): Promise<DocRead[]> {
  if (opts.msLeft < 8_000) return [];
  const t0 = Date.now();
  const inWindow = announcements
    .map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, opts.now) }))
    .filter((a) => (a.ageDays == null || a.ageDays <= WINDOW_DAYS) && !filedAfterClose(a.dateIso, opts.sessionCloseIso))
    .map((a) => classifyAnnouncement(a, 'IN'));
  const top = pickReadCandidate(announcements, 'IN', { marketCap: opts.marketCap, returns: opts.returns, windowDays: WINDOW_DAYS, now: opts.now, sessionCloseIso: opts.sessionCloseIso });
  const picks = chooseDocuments(inWindow, top?.url ?? null);
  const docs = await withDeadline(readIndiaDocuments(ticker, picks, pdfText, { ctx: { marketCapCr: opts.marketCap }, kv: kvAdapter, deadlineMs: Math.min(20_000, opts.msLeft - 6_000) }), Math.min(25_000, opts.msLeft - 4_000), [] as DocRead[]);
  // Related history: only for events that name who / what (an order, a plant, a deal) or cite an earlier disclosure.
  const current = docs.flatMap((d) => d.facts as IndiaFacts[]).filter((f) => f.polarity !== 'negative' && (f.continues || ['order', 'capacity', 'qualification', 'acquisition', 'partnership'].includes(f.event.kind)));
  const left = opts.msLeft - (Date.now() - t0);
  if (current.length && left > 14_000) {
    const wide = await withDeadline(fetchBseAnnouncementsLite(ticker, opts.bseCode, 365), 12_000, { items: [], code: null, error: 'BSE timed out' });
    const inUrls = new Set(announcements.map((a) => a.url));
    const cutoff = opts.now.getTime() - WINDOW_DAYS * 86_400_000;
    const older = wide.items.filter((b) => b.dateIso && Date.parse(b.dateIso) < cutoff && !inUrls.has(b.url));
    const rel = relatedFilings(current, older, { excludeUrls: inUrls, issuerName: opts.companyName, max: INDIA_HISTORY_BUDGET });
    if (rel.length && opts.msLeft - (Date.now() - t0) > 8_000) {
      const hist = await withDeadline(readIndiaDocuments(ticker, rel, pdfText, { relation: 'history', kv: kvAdapter, deadlineMs: 8_000 }), 10_000, [] as DocRead[]);
      const hashes = new Set(docs.map((d) => d.hash).filter(Boolean));
      for (const h of hist) if (h.access === 'DOCUMENT_READ' && !hashes.has(h.hash)) docs.push(h);
    }
  }
  return docs;
}

/** zzz803 (IN): the latest quarterly result beyond the 21-day window (≤ IN_BACKDROP_DAYS)
 *  is the fundamental backdrop. Its press release (else the outcome letter) is read once —
 *  deterministic, cached with the other documents — and its event sentences are kept on the
 *  announcement, so the card can say "PAT ₹0.24 Cr as against ₹(-) 8.41 Cr" in the company's words. */
async function indiaBackdropDocument(ticker: string, announcements: AnnouncementLite[], opts: { now: Date; msLeft: number }): Promise<void> {
  if (opts.msLeft < 12_000) return;
  const older = announcements
    .map((a) => ({ a, age: a.ageDays ?? ageDaysOf(a.dateIso, opts.now) }))
    .filter((x) => x.age != null && x.age > WINDOW_DAYS && x.age <= IN_BACKDROP_DAYS && !!x.a.url && !/corp-announcements\/?$/.test(x.a.url) && !x.a.docLines)
    .sort((x, y) => String(y.a.dateIso || '').localeCompare(String(x.a.dateIso || '')));
  const isRelease = (a: AnnouncementLite) => /press release|earnings release|investor (?:release|update)/i.test(`${a.subject} ${a.summary || ''}`) && /result|q[1-4]|quarter|earnings/i.test(`${a.subject} ${a.summary || ''}`);
  const pick = older.find((x) => isRelease(x.a)) || older.find((x) => isBackdropFiling(x.a));
  if (!pick) return;
  const got = await withDeadline(readIndiaDocuments(ticker, [{ url: pick.a.url, subject: pick.a.subject, dateIso: pick.a.dateIso }], pdfText, { relation: 'history', kv: kvAdapter, deadlineMs: 8_000 }), 10_000, [] as DocRead[]);
  const d = got.find((x) => x.access === 'DOCUMENT_READ');
  if (d?.eventLines?.length) pick.a.docLines = d.eventLines.slice(0, 6);
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
  /** zzz786 — US board window: '1D' live scan (default) or '1W' export fallback. */
  moveWindow?: '1D' | '1W';
  started_at: string;
  updated_at: string;
  model_reads: number;
  errors: string[];
  /** zzz798 (US): per-name timed-out attempts today — a name that times out
   *  is retried once on the next call, then recorded as failed with the reason. */
  attempts?: Record<string, number>;
  /** zzz799 (US): the board this state was registered from — a hash of its
   *  tickers, the scan time, and the board rows themselves (so the summary
   *  counts the same board the page shows). Research is tied to a scan, not
   *  just a date. */
  board_hash?: string | null;
  scan_at?: string | null;
  board_rows?: Array<{ ticker: string; company: string | null; move_pct: number | null; market_cap: number | null; perf: any }>;
  /** zzz799 (US): names researched on an earlier scan today that are no longer on the board. */
  dropped?: Array<{ ticker: string; company: string | null }>;
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
/** zzz798: one US name's clock (listing + SEC card + press + chart + read), and
 *  two names at a time — every SEC request is still spaced ≤10/s process-wide. */
const US_PER_NAME_MS = 30_000;
const US_WORKERS = 2;

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (ms <= 0) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/** zzz782: what EDGAR said about a name, as a finding note — so "the ticker
 *  is not in the SEC list" / "EDGAR refused" is never read as "checked,
 *  nothing filed", and "only insider Form 4s" is not "nothing at all". */
function edgarNote(er: Pick<EdgarResearch, 'failure' | 'cik' | 'insiderForms' | 'filingsInWindow'>, windowDays: number): string | null {
  if (er.failure === 'cik_not_found') return 'SEC EDGAR not checked: the ticker is not in the SEC company list (CIK not found — often a new listing or a foreign issuer filing under another symbol). This is not "no filing".';
  if (er.failure === 'ticker_map_failed') return 'SEC EDGAR not checked: the SEC ticker list could not be loaded. This is not "no filing".';
  if (er.failure === 'submissions_failed') return 'SEC EDGAR not checked: the company\'s filing list could not be fetched (SEC refused or timed out). This is not "no filing".';
  if (er.cik && er.insiderForms) return `SEC EDGAR checked (CIK ${String(parseInt(er.cik, 10))}): ${er.insiderForms} insider ownership report${er.insiderForms === 1 ? '' : 's'} (Form 3/4/5/144) in the last ${windowDays} days — counted, not scanned as events.`;
  if (er.cik) return `SEC EDGAR checked (CIK ${String(parseInt(er.cik, 10))}).`;
  return null;
}

/** zzz782: a free read of the candidate's own press release when no model
 *  read was made. A form-classified filing gets a verbatim document read; an
 *  item only a reader can classify gets the release's lead as its summary
 *  (written into the announcement, so a re-score reads it too). */
async function usDocFallback(announcements: AnnouncementLite[], cand: ReturnType<typeof pickReadCandidate>, ms: number, ticker?: string): Promise<{ read: { url: string; headline: string; quote: string; category: any; valueStated?: number | null; facts?: Record<string, string> | null; source?: 'model' | 'document_extract' } | null; announcements: AnnouncementLite[]; doc: UsDocReadResult | null }> {
  if (!cand || ms < 3_000) return { read: null, announcements, doc: null };
  const r = await withDeadline(readUsFilingDocument(cand, Math.min(8_000, ms), { ticker: ticker ?? null }), ms, null);
  if (!r) return { read: null, announcements, doc: null };
  if (r.summary) announcements = announcements.map((a) => (a.url === cand.url && !a.summary ? { ...a, summary: r.summary } : a));
  return { read: r.read, announcements, doc: r };
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

async function loadHoldings(_origin: string, market: 'IN' | 'US' = 'IN'): Promise<Set<string>> {
  // Read the book store directly: a self-fetch through `origin` resolved to
  // an internal host on Railway and answered nothing, so no gainer was ever
  // marked as held (MARKSANS sat in "unexplained" without its 📗).
  // zzz835: the US board is matched against the US book (its own KV key) — it
  // used to be matched against the India book, so no US gainer was ever "held".
  if (market === 'US') return new Set((await loadBook('US')).held);
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

/** zzz798: findings to re-score for free — older rules, and (US) findings
 *  built before the SEC-document card existed (or under an older card). */
function staleTickers(st: ResearchState): string[] {
  const tickers = st.universe.map((u) => u.ticker);
  const base = staleRuleTickers(st.findings, tickers);
  if (st.market !== 'US') return base;
  const more = tickers.filter((t) => { const f = st.findings[t]; return !!f && f.status !== 'unresearched' && f.status !== 'source_failed' && f.usCardV !== US_CARD_VERSION; });
  return Array.from(new Set([...base, ...more]));
}

/** zzz798 (US): how the sweep ended — researched, failed and why. */
function usProgress(st: ResearchState) {
  const tickers = st.universe.map((u) => u.ticker);
  const cov = coverage(st.findings, tickers);
  const lines = presentErrorLines(st.errors, st.universe, 60);
  const why = new Map(lines.filter((l) => l.ticker).map((l) => [l.ticker!, l.short.replace(/^[A-Z0-9.&-]+:\s*/, '')] as const));
  const failed = tickers.filter((t) => st.findings[t]?.status === 'source_failed').map((t) => ({ ticker: t, reason: why.get(t) || 'source could not be reached' }));
  const cards = tickers.filter((t) => st.findings[t]?.usCard).length;
  const quantified = tickers.filter((t) => st.findings[t]?.usCard?.quantified).length;
  const retrying = Object.entries(st.attempts || {}).filter(([t, n]) => n > 0 && !st.findings[t]).map(([t]) => t);
  return { researched: cov.researched, total: cov.total, failed, retrying, cards, quantified };
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
    rules_version: st.rules_version ?? null, rules_version_current: RULES_VERSION, stale_rules: staleTickers(st).length,
    ...(st.market === 'US' ? { progress: usProgress(st), board_hash: st.board_hash ?? null, scan_at: st.scan_at ?? null, dropped: st.dropped || [] } : {}),
  };
}

/** The state's stamp: current only when every finding is. */
function stampRules(st: ResearchState) {
  const stale = staleRuleTickers(st.findings, st.universe.map((u) => u.ticker)).length;
  if (!stale) st.rules_version = RULES_VERSION;
}

/** zzz798: press items for a press-only US card (news context first). */
function pressItemsOf(news: NewsContext | null | undefined): Array<{ title: string; url: string; date: string | null; source: string | null }> {
  return (news?.items || []).slice(0, 12).map((x: any) => ({ title: String(x.title || ''), url: String(x.url || ''), date: x.date ? String(x.date) : null, source: x.source ? String(x.source) : null }));
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
    // zzz799 (US): the page sends the hash of the board it shows. A state
    // registered from another scan answers without a view (the page builds
    // it from the board on screen) and says so — never an older board's
    // summary under a newer board.
    const wantBoard = market === 'US' ? searchParams.get('board') : null;
    const boardMatch = wantBoard ? (st.board_hash ?? null) === wantBoard : null;
    const view = boardMatch === false ? null : await viewFor(st, market, date, session);
    return NextResponse.json({ ok: true, market, date, session, ...payload, ...(market === 'US' ? { board_match: boardMatch } : {}), view });
  } catch (e) { return jsonError(e); }
}

// ── THE RESEARCH VIEW, SERVER-SIDE  (zzz770 AG-A) ───────────────────────────
// Built from what is already stored: the day's findings, its universe, the
// cached scan's filed-result rows and the book. KV reads only — opening the
// page never makes a model call or an upstream fetch here.

async function loadBook(market: 'IN' | 'US' = 'IN'): Promise<{ held: string[]; watch: string[] }> {
  if (market === 'US') {
    // zzz835: the US portfolio book (holdings + bench), kept apart from the India book.
    try {
      const { book } = await readUsBook();
      return { held: book.holdings.map((h) => String(h.ticker || '').toUpperCase()).filter(Boolean), watch: book.bench.map((b) => String(b.ticker || '').toUpperCase()).filter(Boolean) };
    } catch { return { held: [], watch: [] }; }
  }
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
      const hit: any = await kvGet(market === 'IN' ? `ai-gainers:v3:IN:${date}:${limit}` : `ai-gainers:v4:US:${date}:${usPhaseAt(new Date()) === 'regular' ? 'open' : usPhaseAt(new Date())}:${limit}`);
      if (hit && hit.ok) return { rows: Array.isArray(hit.filed_results) ? hit.filed_results : [], generatedAt: hit.generated_at || null };
    } catch { /* next */ }
  }
  return { rows: [], generatedAt: null };
}

async function viewFor(st: ResearchState, market: 'IN' | 'US', date: string, session: ReturnType<typeof indiaSession> | null): Promise<ResearchView | null> {
  try {
    const [book, filed, prior] = await Promise.all([loadBook(market), cachedFiledResults(market, date), loadCatalystRecords().catch(() => ({}))]);
    const status = market === 'IN'
      ? (session && session.date !== date ? 'previous_session' : session?.state === 'open' ? 'live' : session?.state === 'closed' ? 'closed' : 'last_completed')
      : st.moveWindow === '1W' ? 'weekly_export' : usPhaseAt(new Date()) === 'regular' ? 'live' : 'last_completed';
    const usLive = market === 'US' && status === 'live';
    const usPh = usPhaseAt(new Date());
    // The session whose moves the live scan shows: today once the US market has
    // opened, otherwise the last completed session (never labelled today).
    const usSess = usLive || usPh === 'after_hours' ? etToday() : lastCompletedNyseSession(new Date());
    return buildResearchView({
      moveWindow: market === 'US' ? (st.moveWindow || '1D') : '1D',
      market,
      findings: presentFindings(st.findings),
      // zzz799 (US): the board the page sent (same names, same count as on screen); India unchanged.
      board: market === 'US' && st.board_rows?.length ? st.board_rows.map((b) => { const u = st.universe.find((x) => x.ticker === b.ticker); return { ...b, move_pct: u?.movePct ?? b.move_pct }; })
        : st.universe.map((u) => ({ ticker: u.ticker, company: u.company, move_pct: u.movePct, market_cap: u.marketCap, perf: u.perf })),
      filedResults: filed.rows,
      holdings: book.held,
      watchlist: book.watch,
      errors: st.errors,
      now: st.updated_at,
      viewedAt: new Date().toISOString(),
      // zzz785 — earlier days' catalyst states (timeline + previous state).
      priorCatalysts: catalystRecordsFor(prior as any, st.universe.map((u) => u.ticker)),
      session: {
        date: market === 'US' && st.moveWindow !== '1W' ? usSess : date, scanAt: st.updated_at || null, status: market === 'US' && usPh === 'after_hours' && st.moveWindow !== '1W' ? 'today_final' : status, cached: true,
        // A stored day that is not the current session is never labelled today.
        label: market === 'IN' ? (session && session.date === date ? session.label : `Session ${date} (stored)`)
          : st.moveWindow === '1W' ? `US week to ${date}` : usLive ? `US session ${usSess} — live` : usPh === 'after_hours' ? `US session ${usSess} — today, final` : `US session ${usSess} — last completed session`,
        isToday: market === 'IN' ? (session ? session.isToday && session.date === date : null) : st.moveWindow === '1W' ? null : usLive || usPh === 'after_hours',
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
  const moveWindow: '1D' | '1W' | null = body?.move_window === '1W' ? '1W' : body?.move_window === '1D' ? '1D' : null;

  const now = new Date();
  const nowIso = now.toISOString();
  const loaded = (await loadState(market, date)) || { market, date, universe: [], findings: {}, started_at: nowIso, updated_at: nowIso, model_reads: 0, errors: [] };
  const { st, excluded } = smallMidOnly(loaded);
  st.inputs = st.inputs || {};
  st.excluded = st.excluded || [];
  if (market === 'US' && moveWindow && rows.length) st.moveWindow = moveWindow;
  const exclude = (t: string) => { if (!excluded.includes(t)) excluded.push(t); if (!st.excluded!.includes(t)) st.excluded!.push(t); };
  const sessionCloseIso = market === 'IN' ? indiaSessionCloseIso(date) : null;

  // US: the list the page sends IS today's universe. Names that fell off the
  // screen (or were never in scope — NSE rows, mega caps) leave it; the ones
  // that remain keep their findings and take the fresh move below. (zzz766)
  if (market === 'US' && rows.length) {
    const sent = new Set(rows.map((r) => String(r?.ticker || '').toUpperCase()));
    // zzz799: remember which scan this state now describes, and which names
    // were researched on an earlier scan today but are no longer on the board.
    st.dropped = droppedFromBoard(st.universe, sent, st.dropped || []);
    st.board_hash = boardHash(sent);
    st.scan_at = typeof body?.scan_at === 'string' ? body.scan_at.slice(0, 40) : nowIso;
    st.board_rows = rows.map((r) => ({ ticker: String(r?.ticker || '').toUpperCase(), company: r?.company ?? null, move_pct: typeof r?.move_pct === 'number' ? r.move_pct : null, market_cap: typeof r?.market_cap === 'number' ? r.market_cap : null, perf: r?.perf ?? null })).filter((r) => r.ticker).slice(0, 500);
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

  const holdings = await loadHoldings(origin, market);
  // Explicit re-run of the day after a rule change. The day's model-read
  // count is KEPT: re-used reads come from the 30-day cache and cost nothing,
  // and the daily ceiling still bounds any new read. (zzz768)
  if (body?.reprocess === true) { st.findings = {}; st.inputs = {}; }
  const persistSink: PersistentCatalyst[] = [];   // zzz780
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
      let usNote: string | null = null;
      let secondaryUnavailable: string | null = null;
      let docs: DocRead[] = [];
      let bseCode: string | null = null;
      let usListing: EdgarResearch | null = null;   // zzz785
      let usDoc: UsDocReadResult | null = null;
      let usCard: UsCard | null = null;              // zzz798
      if (market === 'IN') {
        const cr = await fetchCompanyResearch(u.ticker, now);
        // zzz773: BSE's full filing list for the window, beside screener's
        // five newest — and the filing source when screener.in is down.
        // zzz803: BSE list reaches back IN_BACKDROP_DAYS so the latest quarterly
        // result (filed 40+ days ago, still the latest fundamental news) is the
        // backdrop instead of "no catalyst". The finding's window stays 21 days.
        const bse = await withDeadline(fetchBseAnnouncementsLite(u.ticker, cr.bseCode, IN_BACKDROP_DAYS + 1), 20_000, { items: [], code: null, error: 'BSE timed out' });
        announcements = mergeAnnouncements(cr.announcements, bse.items.map((b) => ({ subject: b.subject, summary: b.summary, url: b.url, dateIso: b.dateIso, ageDays: null })) as AnnouncementLite[]);
        if (bse.items.length || (bse.code && !bse.error)) cr.sources.push('BSE corporate announcements');
        else if (bse.error) cr.errors.push(bse.error);
        // zzz785: screener.in and BSE both silent → NSE's own list for the symbol.
        if (!announcements.length && (cr.secondaryUnavailable || bse.error)) {
          const nse = await withDeadline(fetchNseAnnouncementsLite(u.ticker, IN_BACKDROP_DAYS + 1, now), 13_000, { items: [], error: 'NSE timed out' });
          if (nse.items.length) { announcements = mergeAnnouncements(announcements, nse.items); cr.sources.push('NSE corporate announcements'); }
          else if (nse.error) cr.errors.push(nse.error);
        }
        // Screener is secondary: with an exchange list in hand its failure is
        // "secondary source unavailable", never "source unavailable".
        if (cr.secondaryUnavailable && cr.sources.some((x) => /BSE|NSE/.test(x))) {
          secondaryUnavailable = cr.secondaryUnavailable;
          cr.errors = cr.errors.filter((e) => !/^company page/.test(e));
          cr.errors.unshift('secondary source unavailable (company page) — exchange filings were read directly');
        }
        marketCap = cr.marketCapCr ?? u.marketCap;
        if (isLargeCap(marketCap)) {
          // The screen's cap was missing or stale; the company page says large.
          st.universe = st.universe.filter((x) => x.ticker !== u.ticker);
          exclude(u.ticker);
          return;
        }
        returns = cr.returns;
        fullName = cr.companyName ?? null;
        bseCode = cr.bseCode ?? bse.code ?? null;
        sources = cr.sources;
        sourceFailed = !cr.sources.length;
        const px = cr.lastClose ?? cr.price;
        turnover = u.volume != null && px != null ? (u.volume * px) / 1e7 : null;   // ₹ Cr
        if (cr.errors.length) st.errors.push(`${u.ticker}: ${cr.errors.join('; ')}`);
      } else {
        const er = await fetchEdgarResearch(u.ticker, WINDOW_DAYS, now, { timeoutMs: Math.round(Math.max(2_000, Math.min(10_000, usLeft() / 3))), pressFallback: true, company: u.company });
        usListing = er;
        announcements = er.announcements;
        sources = er.sources;
        sourceFailed = !er.sources.length;
        usNote = edgarNote(er, WINDOW_DAYS);
        returns = u.perf ? { m1: u.perf.m1 ?? null, m3: u.perf.m3 ?? null, m6: u.perf.m6 ?? null, y1: u.perf.y1 ?? null, history: 999 } : null;
        // zzz798: SEC FIRST — the filed documents are read (no model) before
        // anything else, so the card carries the figures even when the price
        // chart, the press search or the model read run out of time.
        usCard = await withDeadline(fetchUsCard({ ticker: u.ticker, company: u.company, marketCapM: u.marketCap, listing: er, now, deadlineMs: Math.max(3_000, Math.min(14_000, usLeft() - 16_000)), windowDays: WINDOW_DAYS }), Math.max(3_500, Math.min(15_000, usLeft() - 15_000)), null);
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
      // zzz798: no SEC event document read → a PRESS-ONLY card, said plainly.
      if (market === 'US' && !usCard) usCard = buildUsCard({ ticker: u.ticker, company: u.company, marketCapM: u.marketCap, filing: null, docs: [], press: [...pressItemsOf(news), ...((usListing?.press?.items || []) as any[]).map((p) => ({ title: String(p.title || ''), url: String(p.url || ''), date: p.date ?? null, source: p.source ?? null }))], latestSec: usListing?.recentFilings?.[0] ? { form: usListing.recentFilings[0].form, date: usListing.recentFilings[0].date, items: usListing.recentFilings[0].items.filter((i) => i !== '9.01') } : null, secChecked: !!usListing && !usListing.failure, windowDays: WINDOW_DAYS, moveDate: usMoveDate(new Date()) });
      // zzz801: a card read from a filing also lists the catalysts the press
      // headlines name (press only — never merged into the filing's figures).
      else if (market === 'US' && usCard && usCard.source.tier === 'SEC') usCard = withPressCatalysts(usCard, pressItemsOf(news));
      if (market === 'IN') docs = await indiaDocuments(u.ticker, announcements, { now, sessionCloseIso, marketCap, returns, bseCode, companyName: fullName || u.company, msLeft: budget - (Date.now() - t0) });
      if (market === 'IN') await indiaBackdropDocument(u.ticker, announcements, { now, msLeft: budget - (Date.now() - t0) });

      // Model-read the best catalyst candidate when the budget allows: a
      // verbatim quote is what turns "the summary says ₹279 Cr" into a fact.
      let read: { url: string; headline: string; quote: string; category: any; valueStated?: number | null; facts?: Record<string, string> | null } | null = null;
      // The SAME candidate the finding will score — the first version chose
      // "first catalyst in list order" here and "highest-scoring" in the
      // finding, so every verified quote was attached to the wrong filing
      // and dropped: 22 model reads, zero verified rows.
      const cand = pickReadCandidate(announcements, market, { marketCap, returns, windowDays: WINDOW_DAYS, now, sessionCloseIso });
      // zzz799 (US): `no_model` = the free SEC pass the page runs on its own
      // when a newer scan brings new names — never a model read.
      const noModel = market === 'US' && body?.no_model === true;
      const underDailyCeiling = !noModel && st.model_reads + modelReads < MAX_MODEL_READS_PER_DAY[market];
      if (cand && !underDailyCeiling && !noModel) readsSkippedForCeiling++;
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
      // US, no model read: read the press release's own words (free). (zzz782)
      let docTried = false;
      if (market === 'US' && cand && !read && usLeft() > 14_000) {
        const fb = await usDocFallback(announcements, cand, Math.min(10_000, usLeft() - 10_000), u.ticker);
        announcements = fb.announcements; read = fb.read; docTried = true; usDoc = fb.doc;
      }
      // zzz785 (US): ownership reports, the 8-K body + exhibits and any press /
      // IR items become the finding's structured facts and one ref per document.
      const usEv = market === 'US' ? usFindingEvidence({ listing: usListing, doc: usDoc, issuer: u.ticker }) : null;

      st.findings[u.ticker] = { ...buildFinding({
        ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap, turnover,
        announcements, returns, holding: holdings.has(u.ticker), sources, sourceFailed, windowDays: WINDOW_DAYS, now, read, sessionCloseIso, filedResult: !!u.filedResult, news,
        docs, secondaryUnavailable,
        extraFacts: usEv?.extraFacts ?? null, extraRefs: usEv?.extraRefs ?? null,
      }), rulesVersion: RULES_VERSION };
      if (usNote) st.findings[u.ticker] = { ...st.findings[u.ticker], notes: [...st.findings[u.ticker].notes, usNote] };
      if (market === 'US') st.findings[u.ticker] = { ...st.findings[u.ticker], usCard, usCardV: US_CARD_VERSION };
      st.findings[u.ticker] = await withPersistence(st.findings[u.ticker], persistSink, announcements.filter((a) => { const d = a.ageDays ?? ageDaysOf(a.dateIso, now); return d == null || d <= WINDOW_DAYS; }));
      st.inputs![u.ticker] = compactInputs({ announcements, returns, marketCap, turnover, sources, sourceFailed, fetchedAt: now.toISOString(), read, news, ...(usNote ? { usNote } : {}), ...(docTried ? { docTried } : {}), ...(docs.length ? { docs } : {}), ...(secondaryUnavailable ? { secondaryUnavailable } : {}), ...(usEv && (usEv.extraFacts.length || usEv.extraRefs.length) ? { extraFacts: usEv.extraFacts, extraRefs: usEv.extraRefs } : {}), ...(market === 'US' ? { usCard, usCardV: US_CARD_VERSION } : {}) }, WINDOW_DAYS, now);
      if (market === 'US' && st.attempts) delete st.attempts[u.ticker];
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
  // zzz798 (US): every name has its own clock. A name that overruns it is
  // retried once on the next call; a second overrun is recorded as failed
  // with the reason — the sweep always finishes ("43/58 running…" stuck).
  st.attempts = st.attempts || {};
  const oneUs = async (u: typeof todo[number]): Promise<void> => {
    const perName = Math.max(6_000, Math.min(US_PER_NAME_MS, usLeft() - 4_000));
    const ok = await withDeadline(one(u).then(() => true), perName, false);
    if (ok || st.findings[u.ticker]) return;
    const n = (st.attempts![u.ticker] || 0) + 1;
    st.attempts![u.ticker] = n;
    if (n >= 2) {
      st.errors.push(`${u.ticker}: timed out twice (SEC / price / press sources slow) — press ↻ Retry research`);
      st.findings[u.ticker] = { ...buildFinding({ ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap: u.marketCap, turnover: null, announcements: [], returns: null, holding: holdings.has(u.ticker), sources: [], sourceFailed: true, windowDays: WINDOW_DAYS, now }), rulesVersion: RULES_VERSION, usCardV: US_CARD_VERSION };
      delete st.attempts![u.ticker];
    } else st.errors.push(`${u.ticker}: timed out after ${Math.round(perName / 1000)}s — will retry once`);
    unsaved++;
  };
  const workers = Array.from({ length: market === 'IN' ? 3 : US_WORKERS }, async () => {
    while (queue.length) {
      if (Date.now() - t0 > budget) break;
      if (market === 'US' && usLeft() < 8_000) break;
      const next = queue.shift()!;
      if (market === 'US') await oneUs(next); else await one(next);
    }
  });
  await Promise.all(workers);
  // Always persist at the end — also when only the universe or moves changed.
  await save();
  if (persistSink.length) await upsertDetections(persistSink, 'gainers').catch(() => null);
  await rememberGainerCatalysts(st.findings, date).catch(() => null);

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
  const holdings = await loadHoldings(origin, market);
  const stale = new Set(staleTickers(st));
  let rescored = 0, failed = 0;
  const persistSink: PersistentCatalyst[] = [];   // zzz780
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
          const usNote = edgarNote(er, WINDOW_DAYS);
          const ev = usFindingEvidence({ listing: er, issuer: u.ticker });
          inputs = compactInputs({ announcements: er.announcements, returns, marketCap: u.marketCap, turnover: u.volume != null && u.price != null ? (u.volume * u.price) / 1e6 : null, sources: er.sources, sourceFailed: false, fetchedAt: now.toISOString(), ...(usNote ? { usNote } : {}), ...(ev.extraFacts.length || ev.extraRefs.length ? { extraFacts: ev.extraFacts, extraRefs: ev.extraRefs } : {}) }, WINDOW_DAYS, now);
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
      // zzz782 (US): no read of the chosen filing — read its press release's
      // own words (free, no model), once; the result is stored with the inputs.
      if (market === 'US' && cand && !read && !inputs.docTried && Date.now() - t0 < budget - 12_000) {
        const fb = await usDocFallback(inputs.announcements, cand, Math.min(9_000, budget - (Date.now() - t0) - 10_000), u.ticker);
        inputs = { ...inputs, announcements: fb.announcements, docTried: true };
        read = fb.read;
        if (fb.doc?.facts?.length || fb.doc?.sources?.length) {
          const ev = usFindingEvidence({ doc: fb.doc, prior: { facts: inputs.extraFacts, refs: inputs.extraRefs }, issuer: u.ticker });
          inputs = { ...inputs, extraFacts: ev.extraFacts, extraRefs: ev.extraRefs };
        }
      }
      inputs = { ...inputs, read };
      // zzz798 (US): the SEC-document card, built once per card version (free,
      // no model): the stored findings of the day get their figures on open.
      if (market === 'US' && inputs.usCardV !== US_CARD_VERSION && Date.now() - t0 < budget - 10_000) {
        const now2 = new Date();
        const er2 = await withDeadline(fetchEdgarResearch(u.ticker, WINDOW_DAYS, now2, { timeoutMs: 6_000, readOwnership: false }), 8_000, null);
        let card: UsCard | null = null;
        if (er2 && !er2.failure) card = await withDeadline(fetchUsCard({ ticker: u.ticker, company: u.company, marketCapM: u.marketCap ?? inputs.marketCap, listing: er2, now: new Date(inputs.fetchedAt), deadlineMs: Math.min(12_000, budget - (Date.now() - t0) - 6_000), windowDays: WINDOW_DAYS }), Math.min(13_000, budget - (Date.now() - t0) - 5_000), null);
        if (card && card.source.tier === 'SEC') card = withPressCatalysts(card, pressItemsOf(inputs.news));   // zzz801
        if (!card) card = buildUsCard({ ticker: u.ticker, company: u.company, marketCapM: u.marketCap ?? inputs.marketCap, filing: null, docs: [], press: pressItemsOf(inputs.news), latestSec: er2?.recentFilings?.[0] ? { form: er2.recentFilings[0].form, date: er2.recentFilings[0].date, items: er2.recentFilings[0].items.filter((i) => i !== '9.01') } : null, secChecked: !!er2 && !er2.failure, windowDays: WINDOW_DAYS, moveDate: usMoveDate(new Date(inputs.fetchedAt)) });
        // an EDGAR outage is not "no card" — try again on the next open
        inputs = { ...inputs, usCard: card, usCardV: er2 && !er2.failure ? US_CARD_VERSION : inputs.usCardV };
      }
      // zzz782 (US): a first pass that skipped the daily chart (the function
      // clock ran short) gets it here — it is what the 1D column is built from.
      if (market === 'US' && inputs.returns && !inputs.returns.tail && Date.now() - t0 < budget - 10_000) {
        const bars = await withDeadline(yahooChart(u.ticker, '6mo'), 8_000, null);
        if (bars && bars.close.length > 25) {
          const tail = bars.dates.map((d, k) => [d, bars.close[k]] as [string, number]).slice(-90);
          inputs = { ...inputs, returns: { ...inputs.returns, tail } };
        }
      }
      // zzz776: a first pass whose price history failed is not left blank —
      // the re-score fills it from Yahoo daily closes (free, no model).
      if (market === 'IN' && !inputs.returns && Date.now() - t0 < budget - 10_000) {
        const y = await yahooReturns(u.ticker).catch(() => null);
        if (y) inputs = { ...inputs, returns: y.returns, sources: [...(inputs.sources || []), y.source] };
      }
      st.inputs[u.ticker] = inputs;
      const f0 = rescoreFromInputs(inputs, { ticker: u.ticker, company: u.company, market, movePct: u.movePct, holding: holdings.has(u.ticker), filedResult: !!u.filedResult, windowDays: WINDOW_DAYS, sessionCloseIso });
      const f1 = inputs.usNote ? { ...f0, notes: [...f0.notes, inputs.usNote] } : f0;
      const f = market === 'US' ? { ...f1, usCard: inputs.usCard ?? null, usCardV: inputs.usCardV } : f1;
      st.findings[u.ticker] = await withPersistence(f, persistSink, inputs.announcements);
      rescored++;
    } catch { failed++; }
  }
  if (persistSink.length) await upsertDetections(persistSink, 'gainers').catch(() => null);
  await rememberGainerCatalysts(st.findings, date).catch(() => null);
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
