// ═══════════════════════════════════════════════════════════════════════════
// ONE READER FOR THE BOOK.                                          (zzz715)
//
// Portfolio Catalysts and Exit Radar answer different questions off the SAME
// evidence, and the one thing neither may do is disagree with the other about
// a holding. So the loading, the grading and the assessment live here, once,
// and both screens are views over this hook's output.
//
// The pipeline per holding:
//
//   conviction bench (local, instant)  →  graded row  →  A/B/F/G pattern
//                                                     ↓
//   AI summary (a model call, on demand) →  verified `structured`
//                                                     ↓
//   extractVariables → assessThesis → buildCapexChain → promise ledger
//
// Everything before the model call is free and instant, so the page paints
// immediately and the filings fill in behind it.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { normSymbol } from '@/lib/portfolio-symbols';
import { originCounts, type BookOrigin } from './universe';
import { resolveIndiaBook, bookUniverse, isBseCode, type ResolvedBook, type BseMatch } from './book-membership';
import { cachedBseMatches, lookupBseCodes } from './bse-nse-lookup';
import { readLocalBookInput, fetchSavedHoldings, fetchSyncedHeld } from './book-sources';
import { readConvictionBeats } from '@/lib/conviction-beats';
import { selectIndiaCb, cbTicker, heldKey, IN_CB_SOURCE, type PresetLabel, type CbCriteriaInfo } from './pc-bench';
import { tierNowLabel } from '@/lib/india-cb-view';
import {
  serverBenchToCbEntries, mergeCbEntries, cbFiltersForOwner, readCbPresetOptOut, cbCriteriaCheck,
} from '@/lib/conviction-filter-india';
import { classifyOrNearest, classifyWithFiling, type AbfgResult, manualPattern, type AbfgPattern } from '@/lib/earnings/pattern-abfg';
import { extractVariables } from './variables';
import { buildComparisons, historyDepth, type MetricComparison } from './comparison';
import { rowChangeLines, deepRupeeGlyph } from './variables';
import { readJson, humanError } from './safe-json';
import { businessProfileOf, type VarKey } from './taxonomy';
import { assessThesis, type ThesisAssessment } from './status';
import { buildCapexChain, type CapexChain } from './capex-chain';
import { recordPromises, checkPromises } from './guidance-ledger';
import { planRecentReads, type RecentPlan, type ReportedFact } from './recent-reporters';
import { priorBackfillPlan } from './prior-period';
import {
  freshnessOf, whatChanged, latestSummary, latestExpectedPeriod, needsVariableSnapshots, withVariableSnapshots,
  type CompanyLedger, type FreshnessState, type ChangeLine, type CompanyEvidenceState,
} from './evidence-ledger';
import { evidenceReadLine, changesNote } from './evidence-counts';
import { provisionalType, isProvisionalFallback, noTypeReason, promotionFromFilings, promotedType, financialProvisionalType, financialKindOf } from './provisional-type';
import { quickReadQueue, type QuickRowLike } from './quick-read';

export interface BookRow {
  symbol: string;
  /** Book, bench, or both. A bench name is a candidate, never a holding. */
  origin: BookOrigin;
  /** zzz811: the quality preset as a LABEL (pass / fail with reasons /
   *  not checked yet). It never removes a row. */
  preset?: PresetLabel | null;
  /** zzz811: which list put a bench name here ("Conviction Beats (India)"). */
  benchSource?: string | null;
  market: 'IN' | 'US';
  graded: any | null;
  tier: string | null;
  pattern: AbfgResult | null;
  radarScore: number | null;
  summary: any | null;
  sourceUrl: string | null;
  state: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  /** Where the grader-level numbers came from: this portal's own graded
   *  engine, the screener.in exports, or nothing yet. Shown on the card,
   *  because a screener figure and a filing-read figure are not the same
   *  evidence and must never look the same. */
  dataSource?: string | null;
  assessment: ThesisAssessment | null;
  /** Cross-period comparisons derived from the ledger. (zzz758) */
  comparisons?: Partial<Record<VarKey, MetricComparison>>;
  capex: CapexChain | null;
  promiseNote: string | null;
  /** The documents actually read, for the card's SOURCES block. (zzz737) */
  documentsRead?: Array<{ label: string; kind: string; source: string; period: string | null; url: string }>;
  /** Every retrieval attempt, successful or not. An empty structural field
   *  can now say which sources were searched instead of showing a bare
   *  circle — the owner's "empty symbols must mean something". */
  discoveryAttempts?: Array<{ source: string; outcome: string; detail: string; found: number }>;
  /** EVIDENCE_FOUND | SEARCH_EXHAUSTED | RETRIEVAL_FAILED. A failed search
   *  and an absence of disclosure are different facts and are kept apart. */
  discoveryState?: string | null;
  /** Every document the reader touched, INCLUDING the ones it could not read.
   *  The url travels with them: a scanned filing this reader cannot OCR is a
   *  dead end unless the card can hand the owner the document itself. (zzz760) */
  documentOutcomes?: Array<{ label: string; kind: string; outcome: string; chars: number; pages: number; detail?: string; url?: string }>;
  // ── THE PERSISTENT LEDGER.                                     (zzz740)
  /** The company's evidence ledger as loaded from the server. Null when the
   *  company has never been read. The card renders from THIS after a reload,
   *  not from a model call. */
  ledger?: CompanyLedger | null;
  freshness?: { state: FreshnessState; detail: string; evidence_state?: CompanyEvidenceState; evidence_detail?: string } | null;
  reportingPeriod?: string | null;
  changed?: ChangeLine[];
  changedFrom?: string | null;
  /** True when the last read landed in the store; false with the reason
   *  when it did not — the card must not say "updated" over a lost write. */
  persisted?: boolean | null;
  persistError?: string | null;
  /** One line from the reader: "No newer document…" / "read 3 documents". */
  readNote?: string | null;
}

/** Fold a server ledger into a row: the latest period's summary becomes the
 *  card's evidence, exactly as a fresh read would. */
export function applyLedger(row: BookRow, ledger0: CompanyLedger | null, freshness?: { state: FreshnessState; detail: string } | null): BookRow {
  // A ledger stored before zzz771 carries no per-period variable snapshots;
  // they are derived here from its facts (lossless, pure) so the card's
  // series and the thesis baseline exist for every holding on file without
  // a re-read. The server does the same on load; this is the client's guard.
  const ledger1 = ledger0 && needsVariableSnapshots(ledger0) ? withVariableSnapshots(ledger0) : ledger0;
  // "` 480+ Crore" — the PDF's rupee glyph — printed on cards. (zzz768)
  const ledger = ledger1 ? deepRupeeGlyph(ledger1) : ledger1;
  const fr = freshness || freshnessOf(ledger);
  const stored = latestSummary(ledger);
  if (!stored) {
    return { ...row, ledger, freshness: fr, reportingPeriod: null, changed: [], changedFrom: null };
  }
  const p = stored.period;
  const ch = whatChanged(ledger!);
  const readDocs = p.documents.filter((d) => d.outcome === 'read');
  // ── THE CARD IS A PROJECTION OF THE WHOLE PERIOD.                 (zzz765)
  //
  // `stored.summary.events` holds only the events of the LAST read of this
  // period; the period record holds every event ever read for it, deduped by
  // id (mergePeriod). AARTIPHARM's card was built from 9 of its 18 stored
  // events, so the presentation's "capacity expanded from 5,000 to 9,600+
  // MTPA" never reached the board. The board reads the period's events.
  const summary = Array.isArray(p.events) && p.events.length
    ? { ...stored.summary, events: p.events }
    : stored.summary;
  return assess({
    ...row,
    summary,
    state: 'done',
    error: undefined,
    sourceUrl: readDocs[0]?.url || row.sourceUrl,
    documentsRead: readDocs.map((d) => ({ label: d.label, kind: d.kind, source: d.source, period: d.period, url: d.url })),
    discoveryAttempts: p.discovery_attempts || undefined,
    discoveryState: p.discovery_state || null,
    documentOutcomes: p.documents.filter((d) => d.outcome !== 'not_selected').map((d) => ({ label: d.label, kind: d.kind, outcome: d.outcome, chars: d.chars || 0, pages: d.pages || 0, detail: d.detail, url: d.url })),
    // zzz775: an exact classification from the filing wins; else the row's
    // own type; else the nearest fit, labelled as such.
    pattern: classifyWithFiling(row.graded, summary) || row.pattern || classifyOrNearest(row.graded),
    ledger, freshness: fr, reportingPeriod: p.reporting_period,
    changed: ch.lines, changedFrom: ch.from,
    persisted: true, persistError: null,
  });
}

/** zzz782 — THESIS NOT SET. With no thesis type (none fits, none chosen) no
 *  thesis variable can move a status, so none is implied: no "intact", no
 *  "strengthening". A deterioration found in the figures is still named in
 *  the text so it is never hidden.
 *  zzz794: since every name with any figures now gets a provisional
 *  nearest-fit type, THESIS NOT SET means "no figures at all" — and the card
 *  says so in plain words. */
function withThesisSet(row: BookRow, a: ThesisAssessment): ThesisAssessment {
  if (row.pattern) return a;
  const seen = a.status === 'BROKEN' || a.status === 'WEAKENING'
    ? ` ⚠ The figures show a deterioration worth a look: ${String(a.because).slice(0, 260)}`
    : '';
  const reason = noTypeReason(row.graded, row.summary);
  const because = `THESIS NOT SET — ${reason}, so there is nothing to fit a thesis type from and no thesis variable can move a status: no intact, strengthening or weakening is implied. Set why you hold it with the thesis picker (A operating inflection · B demand explosion · F profit jump · G silent quality); it is saved and applies from then on.${seen}`;
  return {
    ...a,
    actionLine: because,
    status: 'THESIS_NOT_SET',
    action: 'THESIS NOT SET',
    because,
    catalystRank: null,
    verdict: a.verdict ? { ...a.verdict, direction: 'UNKNOWN', directionWhy: 'no thesis set — a direction is measured against a thesis' } : a.verdict,
  };
}

/** Record the status the engine assigned, so history accrues server-side.
 *  Best-effort and deduplicated: the store appends only on change. */
async function postStatus(row: BookRow): Promise<void> {
  const a = row.assessment;
  if (!a || !row.reportingPeriod) return;
  try {
    await fetch('/api/v1/portfolio/evidence', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'status', ticker: row.symbol, period: row.reportingPeriod,
        status: a.status, because: a.because,
        tallies: { mechanism: (a.coverage as any).mechanism, output: (a.coverage as any).output, forward: (a.coverage as any).forward },
      }),
    });
  } catch { /* history is best-effort; the status itself is recomputed deterministically */ }
}

/**
 * zzz811 — India Conviction Beats, as the Conviction Beats tab reads it:
 * the SERVER bench (/api/v1/bench, full cards; works on a fresh phone) plus
 * this browser's list, merged the tab's way (mergeCbEntries).
 * A failed server read is reported, never returned as an empty list.
 */
async function loadIndiaConvictionBench(): Promise<{ server: any[]; local: any[]; updatedAt: string | null; error: string | null }> {
  // The FULL server bench (the Conviction Beats tab reads the same route in
  // full — its criteria need the graded fields, not just the names).
  let server: any[] = [];
  let updatedAt: string | null = null;
  let error: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch('/api/v1/bench', { cache: 'no-store' });
      const j = await readJson(r);
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`);
      server = Array.isArray(j?.entries) ? j.entries : [];
      updatedAt = j?.updatedAt || null;
      error = null;
      break;
    } catch (e: any) { error = humanError(e); }
  }
  let local: any[] = [];
  try {
    const m = await import('@/lib/conviction-beats');
    local = m.getConvictionList();
  } catch { /* no list in this browser (an installed app starts empty) */ }
  return { server, local, updatedAt, error };
}

/** zzz774: thesis types the owner set by hand, keyed by symbol. Loaded from
 *  the server once per page; every assessment reads it, so an assignment
 *  survives every later re-classification. */
const THESIS_OVERRIDES: Record<string, AbfgPattern | null> = {};

/** zzz790: the page's own row builder, for the QA harness (same path as a bench row with no ledger). */
export function assessBookRow(row0: BookRow): BookRow { return assess(row0); }
function assess(row0: BookRow): BookRow {
  const ov = THESIS_OVERRIDES[String(row0.symbol || '').toUpperCase()];
  // zzz794: the owner's type wins; else the classifier's own (exact, filing,
  // nearest); else a provisional nearest fit from the company's own figures.
  // A provisional fallback is re-derived on every pass, so it always reflects
  // the latest figures and never outranks a real classification.
  const row1: BookRow = ov
    ? { ...row0, pattern: manualPattern(ov) }
    : (!row0.pattern || isProvisionalFallback(row0.pattern))
      ? { ...row0, pattern: classifyWithFiling(row0.graded, row0.summary) || classifyOrNearest(row0.graded) || provisionalType(row0.graded, row0.summary) }
      : row0;
  // zzz816: A LENDER OR AN EXCHANGE IS NOT A PLANT. The auto types were
  // built for operating companies, so a bank / NBFC / exchange fell to
  // "nearest A · operating inflection" and was asked for capacity and
  // utilisation it can never have. For an India financial company the
  // auto type (never the owner's own choice, never an exact B / F / G) is
  // replaced by the nearest MEANINGFUL type, which says what it reads.
  const fin = !ov && row0.market !== 'US' ? financialProvisionalType(row0.graded, row0.summary) : null;
  const row: BookRow = fin && (!row1.pattern || row1.pattern.fit === 'nearest' || isProvisionalFallback(row1.pattern) || row1.pattern.pattern === 'A')
    ? { ...row1, pattern: fin } : row1;
  // ── THE LONGITUDINAL JOIN HAPPENS HERE.                          (zzz758)
  //
  // Every period this holding has ever had read is in `row.ledger`, and until
  // now nothing carried that history into the variable rows — `extractVariables`
  // saw one summary and could only ever produce levels. The comparisons are
  // built first and threaded through both the extractor and the status engine,
  // so a figure with an earlier figure behind it becomes a direction, and a
  // figure without one says PREVIOUS: NOT DISCLOSED and stops there.
  const comparisons = buildComparisons(row.ledger || null);
  const hist = historyDepth(row.ledger || null);
  const period = row.reportingPeriod || row.ledger?.latest_period || null;
  const vars = extractVariables(row.graded, row.summary, comparisons, {
    period,
    // Source lineage: every fact carries the document it came from. (zzz770)
    documents: (period && row.ledger?.periods?.[period]?.documents) || null,
    // The per-period snapshots and the frozen baseline ride with the ledger:
    // every quantitative row gets its time-series reading from them. (zzz771)
    ledger: row.ledger || null,
  });
  const check = row.summary ? checkPromises(row.symbol, row.summary) : null;
  // The status carried by the newest period that is NOT the one being
  // assessed — so a status change can name what it moved from.
  const prevStatus = (() => {
    const l = row.ledger;
    if (!l || hist.periods.length < 2) return null;
    for (let i = hist.periods.length - 2; i >= 0; i--) {
      const p = l.periods[hist.periods[i]];
      if (p?.status) return { status: p.status, period: hist.periods[i] };
    }
    return null;
  })();
  // zzz784: the capex chain first, so the status narrative reads the SAME
  // normalized build / economic state the capex row prints.
  const capex = buildCapexChain(row.summary, vars, row.ledger || null);
  const run = (pattern: BookRow['pattern']) => assessThesis({
      capexState: capex ? { build: capex.build || null, economic: capex.earning?.economic ?? null, earningState: capex.earning?.state ?? null } : null,
      pattern: pattern?.pattern ?? null,
      patternFit: (pattern as any)?.fit ?? null,
      // zzz802: India-only disclosure rules (utilisation alternates for A).
      indiaDisclosure: row.market !== 'US',
      variables: vars,
      comparisons,
      historyDepth: hist.depth,
      previousStatus: prevStatus,
      promiseGap: check ? {
        gap: check.gap, detail: check.detail, direction: check.direction || 'behind',
        plan: check.plan ?? null, actual: check.actual ?? null, variance: check.variance ?? null,
      } : null,
      // An evidence document has been read only when a summary came back.
      evidenceReviewed: !!row.summary,
      sourceUnavailable: row.ledger?.last_attempt?.outcome === 'SOURCE_UNAVAILABLE',
      // A failed read is RETRIEVAL_FAILED, never "not disclosed". (zzz770)
      retrievalFailed: row.discoveryState === 'RETRIEVAL_FAILED' || row.ledger?.last_attempt?.outcome === 'FAILED'
        || (!!row.ledger && !row.ledger.latest_period && freshnessOf(row.ledger).evidence_state === 'RETRIEVAL_FAILED'),
      // Services / software / financial businesses: capacity is N/A. (zzz770)
      business: businessProfileOf(row.graded, row.summary),
      // zzz816: a lender's cash conversion and working capital do not apply
      // (lending is an operating cash outflow) — N/A, with the reason.
      financialKind: row.market !== 'US' ? (financialKindOf(row.graded, row.summary)?.kind ?? null) : null,
      // zzz816: why the last search or read produced nothing, in its own words.
      unavailableReason: row.ledger && !row.ledger.latest_period ? (row.ledger.last_attempt?.error ?? null) : null,
      searchedNoDocuments: !!row.ledger && !row.ledger.latest_period && row.ledger.last_attempt?.outcome === 'NO_DISCLOSURE',
      // Without a graded or screener row the grader-computed variables can
      // never be filled, whatever is read. (zzz757)
      hasGraderRow: !!row.graded,
      // Evidence two years old must not confirm today's mechanism. (zzz769)
      evidencePeriod: row.ledger?.latest_period || row.reportingPeriod || null,
      // zzz790: a newer document known and not yet read.
      newerEvidenceUnread: row.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' || (row.freshness as any)?.evidence_state === 'NEW_EVIDENCE_AVAILABLE',
      expectedPeriod: latestExpectedPeriod().period,
    });
  // ── A NEAREST FIT THE FILINGS CONFIRM IS PROMOTED.                  (zzz802)
  // Judged on the assessment under the nearest-fit type itself (its own
  // mechanism checks, from filed facts). India only; the owner's type (manual)
  // and an exact classification are never touched. See promotionFromFilings.
  let pattern = row.pattern;
  let a0 = run(pattern);
  if (!ov && row.market !== 'US' && pattern?.fit === 'nearest') {
    const pr = promotionFromFilings(pattern, {
      structuralStates: (a0 as any).structuralStates || null,
      checked: (a0.checked || []) as any,
      freshnessState: (a0 as any).evidenceFreshness?.state ?? null,
      evidenceReviewed: !!row.summary,
    });
    if (pr.promoted) { pattern = promotedType(pattern, pr); a0 = run(pattern); }
  }
  const rowP: BookRow = pattern === row.pattern ? row : { ...row, pattern };
  return {
    ...rowP,
    comparisons,
    assessment: withThesisSet(rowP, a0),
    capex,
    promiseNote: check ? check.detail : null,
    // WHAT CHANGED comes from the same rows as the board. (zzz765)
    changed: row.ledger ? rowChangeLines(vars, row.reportingPeriod || row.ledger.latest_period || null) : row.changed,
  };
}

export interface UniverseNote {
  /** Held names, whatever they grade at. */
  book: number;
  /** Bench names on the page (every Conviction Beats name not held). */
  bench: number;
  /** Held AND benched. Counted inside both figures above, never double-added
   *  to the total. */
  both: number;
  /** zzz811: the India Conviction Beats list behind the bench, selected by
   *  the owner's own Conviction Beats criteria. Null until loaded (or on Exit Radar). */
  cb: CbCriteriaInfo | null;
  /** Conviction Beats names passing his criteria that he holds (shown once, as book). */
  heldOnCb: number;
  /** Tickers passing his criteria (what the Conviction Beats page lists). */
  cbPassing: string[];
  /** Non-null when the server book could not be read. */
  serverError: string | null;
  /** zzz823: the saved-holdings book, every source counted (the Book check). */
  resolved?: ResolvedBook | null;
}

/**
 * `includeBench` is false on Exit Radar and true on Portfolio Catalysts.
 *
 * Exiting a position you do not hold is not a thing that can happen, so the
 * radar stays strictly the book. Catalysts is the research surface and covers
 * both populations. The flag is read once, on mount, because the pipeline
 * runs once — a page does not change its mind about which question it asks.
 */
export function useBook(opts?: { includeBench?: boolean }) {
  const includeBench = opts?.includeBench !== false;
  const [symbols, setSymbols] = useState<string[]>([]);
  const [origins, setOrigins] = useState<Record<string, BookOrigin>>({});
  const [rows, setRows] = useState<Record<string, BookRow>>({});
  const [loading, setLoading] = useState(true);
  // Rows paint before the stored evidence arrives; until it does, every card
  // reads "evidence incomplete" and the counters are wrong (89 incomplete /
  // 0 strengthening for ten seconds). The page waits on this. (zzz768)
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [batch, setBatch] = useState<{ running: boolean; done: number; total: number; resumable?: number; failed?: number }>({ running: false, done: 0, total: 0 });
  // The prior-quarter backfill's own progress (zzz765). Same shape as `batch`,
  // its own server header, and — like every read here — started by a click.
  const [priorBatch, setPriorBatch] = useState<{ running: boolean; done: number; total: number; resumable?: number; failed?: number }>({ running: false, done: 0, total: 0 });
  // ── RECENT REPORTERS. On click only. (zzz763)
  //   idle → checking (feed) → planned (who is due) → reading → done/error.
  //   The plan is kept after the batch so the strip can say what was skipped
  //   and why, which is the part the owner asked for: "if already updated it
  //   should not be re-updated".
  const [recent, setRecent] = useState<{
    state: 'idle' | 'checking' | 'reading' | 'done' | 'error';
    days: number;
    plan: RecentPlan | null;
    error: string | null;
    feedNote: string | null;
    feed: { items: number; days_fetched: number; days_failed: string[]; cached: boolean } | null;
    usSkipped: number;
    at: string | null;
  }>({ state: 'idle', days: 10, plan: null, error: null, feedNote: null, feed: null, usSkipped: 0, at: null });
  const [note, setNote] = useState<UniverseNote>({
    book: 0, bench: 0, both: 0, cb: null, heldOnCb: 0, cbPassing: [], serverError: null,
  });
  const rowsRef = useRef<Record<string, BookRow>>({});
  const stopRef = useRef(false);
  const resumeRef = useRef<string[] | null>(null);

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // ── ONE PASS, IN THREE STAGES.                                   (zzz731)
  //
  // It runs once on mount rather than re-running as the universe grows,
  // because each stage ADDS to the universe: an effect keyed on the symbol
  // list would re-enter itself every time the server answered.
  //
  //   1. The local book paints immediately, from localStorage and the local
  //      conviction bench. No network, so the page is never blank.
  //   2. The server book is merged in — held names this browser has never
  //      seen, and the bench candidate list.
  //   3. The graded rows arrive for everything at once. Held names take the
  //      richer row; bench candidates are admitted only if that row passes
  //      the preset.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ── THE BOOK IS NOT THE BENCH.                             (zzz716)
      //
      // The local conviction bench is read FIRST because it is instant and
      // answers for the names on it. But it is a QUALITY SCREEN, so thirty of
      // fifty holdings were never on it and used to render as a bare ticker.
      // The server route below covers the rest from the graded bench and the
      // screener exports, and every holding is then populated regardless of
      // whether it would pass a conviction filter today.
      let bench: Record<string, any> = {};
      try { bench = readConvictionBeats(); } catch { bench = {}; }
      // zzz811: quarter-archive keys ("MTAR@Q3-2026") fold onto the bare
      // ticker; the bare entry (the latest quarter) wins.
      const byNorm = new Map<string, any>();
      for (const [k, v] of Object.entries(bench)) {
        const t = cbTicker(k);
        if (t && (!byNorm.has(t) || !k.includes('@'))) byNorm.set(t, v);
      }

      const build = (sym: string, g: any | null, src: string | null): BookRow => assess({
        symbol: sym,
        origin: 'book',
        market: g?.market === 'US' ? 'US' : 'IN',
        graded: g,
        tier: g?.tier || null,
        pattern: g ? classifyOrNearest(g) : null,
        radarScore: null,
        summary: null,
        sourceUrl: g?.filing_url || g?.source_url || null,
        state: 'idle',
        dataSource: src,
        assessment: null, capex: null, promiseNote: null,
      });

      // ── STAGE 1 — the local book, instantly.
      // zzz823: ONLY the Portfolio page's saved holdings (this browser's
      // copy now, the server copy next) — never the old lists or the synced
      // snapshot (see lib/thesis/book-membership).
      const local = readLocalBookInput();
      // zzz825: a holding saved as a BSE code is matched to its NSE symbol (cached answers now, the lookup next)
      const codesIn = (xs: string[]) => xs.map((x) => String(x || '').toUpperCase().trim().replace(/^(?:NSE|BSE|BOM):/, '').replace(/\.(?:NS|BO|BSE|NSE)$/, '')).filter(isBseCode);
      let bseMap: Record<string, BseMatch> = cachedBseMatches(codesIn(local.browser));
      let resolved = resolveIndiaBook({ server: null, browser: local.browser, legacy: local.legacy, bseMap });
      const paint = (universe: Map<string, BookOrigin>) => {
        if (cancelled) return;
        // zzz782: the rows ARE the universe — a name that left it (a bench
        // candidate that failed the second preset pass) is dropped, so "All",
        // the size filter and "N of N shown" count the same population
        // (130 − 12 hidden was printing 119 because of one stale row).
        const next: Record<string, BookRow> = {};
        for (const [sym, origin] of universe) {
          const had = rowsRef.current[sym];
          if (had) { next[sym] = { ...had, origin }; continue; }
          const g = byNorm.get(sym) || null;
          next[sym] = { ...build(sym, g, g ? 'graded' : null), origin };
        }
        rowsRef.current = next;
        setRows(next);
        setSymbols(Array.from(universe.keys()));
        setOrigins(Object.fromEntries(universe));
        setLoading(false);
      };

      let universe: Map<string, BookOrigin> = bookUniverse(resolved.names, []);
      paint(universe);
      setNote((n) => ({ ...n, ...originCounts(universe.values()), resolved }));

      // ── STAGE 2 — the saved holdings on the server (/api/portfolio, what
      // the Portfolio page saves). A name saved on another machine is still a
      // holding; a name only on an old list is not.
      const [serverSaved, synced] = await Promise.all([fetchSavedHoldings(), fetchSyncedHeld()]);
      if (cancelled) return;
      const codes = codesIn([...(serverSaved.ok ? serverSaved.symbols : []), ...local.browser]);
      if (codes.length) { try { bseMap = { ...bseMap, ...(await lookupBseCodes(codes)) }; } catch { /* stays flagged */ } }
      if (cancelled) return;
      resolved = resolveIndiaBook({ server: serverSaved, browser: local.browser, legacy: local.legacy, synced, bseMap });
      const held = new Set<string>(resolved.names.map((n) => n.symbol));
      const heldByKey = new Map(resolved.names.map((n) => [n.key, n.symbol] as const));
      universe = bookUniverse(resolved.names, []);
      paint(universe);

      // ── THE BENCH IS ALL OF INDIA CONVICTION BEATS.              (zzz811)
      // The server's list (/api/v1/bench) + this browser's list + the synced
      // book's bench flags, minus the owner's removals, minus what he holds.
      // No preset gate: every name joins; the preset is a label on its card.
      let candidates: string[] = [];
      let heldOnCb = 0;
      let cbInfo: CbCriteriaInfo | null = null;
      let cbPassing: string[] = [];
      if (includeBench) {
        // ── THE CONVICTION BEATS TAB'S OWN LIST, UNDER HIS OWN CRITERIA.
        // Same merge (this browser's list + the server bench), same filters
        // (the preset, or none when he switched it off there), same function.
        const cb = await loadIndiaConvictionBench();
        if (cancelled) return;
        const optedOut = readCbPresetOptOut();
        const filters = cbFiltersForOwner(optedOut);
        const list = mergeCbEntries(cb.local as any, serverBenchToCbEntries(cb.server));
        // zzz823: pass / fail / NOT CHECKED — the same shared check the
        // Conviction Beats tab now applies (unknown data is never a fail).
        const sel = selectIndiaCb({
          held, list, criteriaOff: optedOut,
          check: (e: any) => cbCriteriaCheck(e, filters),
        });
        // zzz827: a name the current grading puts below STRONG carries the
        // same "now MIXED under current rules" note it has on the tab.
        for (const e of list as any[]) {
          const tn = tierNowLabel(e);
          const t = cbTicker(e?.ticker);
          if (tn && sel.labels[t] && !sel.labels[t].text.includes(tn)) sel.labels[t] = { ...sel.labels[t], text: `${sel.labels[t].text} · ${tn}` };
        }
        // Every name joins the universe (evidence loads for all, batched);
        // the page shows the failing ones only when he asks.
        candidates = [...sel.bench, ...sel.benchFailing];
        heldOnCb = sel.heldPassing.length;
        cbInfo = {
          market: 'IN', listTotal: sel.listTotal, passing: sel.passing.length, failing: sel.failing.length, heldPassing: sel.heldPassing.length, unknown: sel.unknown.length,
          criteria: optedOut ? 'your quality preset is switched OFF on Conviction Beats — every name is listed' : 'your quality preset, as the Conviction Beats tab applies it',
          source: `this browser's list ${cb.local.length} + server bench ${cb.server.length}${cb.updatedAt ? ` (updated ${String(cb.updatedAt).slice(0, 10)})` : ''}${cb.error ? ` — server not read: ${cb.error}` : ''}`,
          error: cb.error,
        };
        universe = bookUniverse(resolved.names, candidates);
        paint(universe);
        setRows((cur) => {
          const out = { ...cur };
          for (const s of candidates) if (out[s]) out[s] = { ...out[s], benchSource: IN_CB_SOURCE, preset: sel.labels[s] || null };
          // A held name on the list under another spelling (ABC-BE / ABC) gets its label on the book row.
          for (const s of sel.heldPassing) { const h = heldByKey.get(heldKey(s)) || s; if (out[h]) out[h] = { ...out[h], preset: sel.labels[s] || null }; }
          return out;
        });
        cbPassing = sel.passing.map((s) => heldByKey.get(heldKey(s)) || s);
      }

      setNote((n) => ({
        ...n, ...originCounts(universe.values()), serverError: resolved.serverError, cb: cbInfo, heldOnCb, cbPassing, resolved,
      }));

      // ── STAGE 3 — graded rows for everything, and the preset gate.
      //
      // ASK THE SERVER FOR EVERY HOLDING, NOT ONLY THE MISSING ONES.
      //
      // The first version only filled holdings the LOCAL bench could not
      // answer for, on the assumption that a local hit was as good as a
      // server one. It is not. The localStorage bench stores a trimmed row —
      // HAPPYFORGE and UNIPARTS came back with cash conversion and nothing
      // else, no revenue, no margin, and therefore no A/B/F/G pattern — while
      // the SERVER bench holds the full graded row for the same two names,
      // including `opm_prev_pct`, which is the entire margin bridge.
      //
      // So every symbol is requested, and a server row replaces a local one
      // whenever it carries more of the fields the thesis engine reads. A
      // local row is a fast first paint, never the better evidence. (zzz719)
      const richness = (g: any): number => g ? [
        'sales_yoy_pct', 'eps_yoy_pct', 'net_profit_yoy_pct', 'opm_pct',
        'opm_prev_pct', 'opm_change_pp', 'opm_change_pp_qoq',
        'cfo_to_pat_ratio', 'ocf_to_pat_ratio',
      ].filter((k) => typeof g[k] === 'number' && Number.isFinite(g[k])).length : 0;

      // Chunked: the bench runs to three hundred names and a single query
      // string of that length is a request some proxies simply drop.
      const wanted = [...Array.from(held), ...candidates];
      const got: Record<string, any> = {};
      for (let i = 0; i < wanted.length; i += 100) {
        const slice = wanted.slice(i, i + 100);
        try {
          const r = await fetch(
            `/api/v1/portfolio/thesis-data?tickers=${encodeURIComponent(slice.join(','))}`,
            { cache: 'no-store' });
          if (!r.ok) continue;
          const j = await readJson(r);
          Object.assign(got, j?.rows || {});
        } catch { /* the filing path still answers for every holding */ }
        if (cancelled) return;
      }

      setRows((cur) => {
        const out = { ...cur };
        for (const sym of Array.from(universe.keys())) {
          const hit = got[sym.toUpperCase()];
          const prev = out[sym];
          if (!prev) continue;
          if (!hit || hit.source === 'none') {
            if (!prev.graded) out[sym] = { ...prev, dataSource: 'none' };
            continue;
          }
          // Keep whichever row the engine can actually read more of. A
          // graded row also wins a tie over a screener row, because it
          // was read from the filing rather than from a database.
          const keepLocal = richness(prev.graded) > richness(hit)
            || (richness(prev.graded) === richness(hit) && prev.dataSource === 'graded' && hit.source !== 'graded');
          if (keepLocal) continue;
          // The summary already read for this holding is preserved: a
          // filing beats every store and must not be discarded by a
          // background fill that lands after it.
          out[sym] = assess({
            ...prev,
            market: hit.market === 'US' ? 'US' : 'IN',
            graded: hit,
            tier: hit.tier || prev.tier || null,
            pattern: classifyOrNearest(hit) || prev.pattern,
            sourceUrl: prev.sourceUrl || hit.filing_url || hit.source_url || null,
            dataSource: hit.source,
          });
        }
        return out;
      });

      // ── STAGE 4 — THE EVIDENCE LEDGER.                          (zzz740)
      //
      // This is the stage that was missing. Everything the reader ever
      // persisted for these companies is loaded here and folded into the
      // rows, so a reload shows what the last read found — no click, no
      // model call. Chunked like the graded fetch; each ledger is a KV read.
      try {
        const all = Array.from(universe.keys());
        const ledgers: Record<string, CompanyLedger> = {};
        const fresh: Record<string, { state: FreshnessState; detail: string }> = {};
        let batchInfo: any = null;
        let priorInfo: any = null;
        for (let i = 0; i < all.length; i += 100) {
          const slice = all.slice(i, i + 100);
          const r = await fetch(`/api/v1/portfolio/evidence?tickers=${encodeURIComponent(slice.join(','))}`, { cache: 'no-store' });
          if (!r.ok) continue;
          const j = await readJson(r);
          Object.assign(ledgers, j?.ledgers || {});
          Object.assign(fresh, j?.freshness || {});
          if (j?.batch) batchInfo = j.batch;
          if (j?.prior_batch) priorInfo = j.prior_batch;
          if (cancelled) return;
        }
        // Folded outside the updater (updaters run lazily; see readFiling).
        // rowsRef is current here: stage 3's paint rendered while the
        // ledger fetch above was in flight.
        const cur = rowsRef.current;
        const updates: Record<string, BookRow> = {};
        const toPost: BookRow[] = [];
        for (const sym of Object.keys(cur)) {
          const l = ledgers[sym.toUpperCase()] || null;
          const f = fresh[sym.toUpperCase()] || null;
          if (!l && !f) continue;
          updates[sym] = applyLedger(cur[sym], l, f);
          const pr = l && l.latest_period ? l.periods[l.latest_period] : null;
          if (pr && !pr.status && updates[sym].assessment) toPost.push(updates[sym]);
        }
        setRows((r) => ({ ...r, ...updates }));
        setEvidenceLoading(false);
        // Back-fill: a period persisted before statuses were recorded gets
        // its status on first load. Sequential and best-effort.
        for (const r of toPost.slice(0, 60)) { if (cancelled) break; await postStatus(r); }
        if (batchInfo && !batchInfo.finished_at) {
          setBatch({ running: false, done: batchInfo.done + batchInfo.skipped + batchInfo.failed, total: batchInfo.tickers.length, resumable: batchInfo.remaining, failed: batchInfo.failed });
          // ── NOTHING SPENDS WITHOUT A CLICK.                        (zzz764)
          // An interrupted batch used to resume by itself on reload. Every
          // read is a model call, and the owner's rule is that reads run only
          // when he asks. The banner below offers Resume; it does not press it.
        } else if (batchInfo) {
          setBatch({ running: false, done: batchInfo.done + batchInfo.skipped + batchInfo.failed, total: batchInfo.tickers.length, resumable: 0, failed: batchInfo.failed });
        }
        // An interrupted prior-quarter backfill is offered for Resume, never
        // resumed on its own. (zzz765)
        if (priorInfo) {
          setPriorBatch({ running: false, done: priorInfo.done + priorInfo.skipped + priorInfo.failed, total: priorInfo.tickers.length, resumable: priorInfo.finished_at ? 0 : priorInfo.remaining, failed: priorInfo.failed });
        }
      } catch { /* the page still works from graded data; the cards say NEVER READ */ }
      finally { if (!cancelled) setEvidenceLoading(false); }
      if (cancelled) return;

      // ── STAGE 5 — THE NAMES NOBODY HAD A ROW FOR.                (zzz764)
      //
      // 18 holdings showed EVIDENCE INCOMPLETE and 68 bench names were
      // excluded from the preset because neither the graded bench nor the
      // static screener CSV carried them. screener.in's company page prints
      // the quarterly table for every listed company, so those rows are now
      // parsed from it — and names that had only the thin CSV row (a
      // sequential margin, no profit figures) get the year-on-year table
      // too. Background, batched, cached server-side for a day; no model.
      try {
        // Book names first, then the bench — one small request at a time,
        // so a 300-name bench never fans out into hundreds of calls.
        const needsLive = (s: string) => {
          const g = got[s.toUpperCase()] || rowsRef.current[s]?.graded;
          return (rowsRef.current[s]?.market !== 'US') && (!g || g.source === 'none' || g.source === 'screener');
        };
        const keys = Array.from(universe.keys());
        const wantLive = [
          ...keys.filter((s) => universe.get(s) !== 'bench' && needsLive(s)),
          ...keys.filter((s) => universe.get(s) === 'bench' && needsLive(s)),
        ];
        const live: Record<string, any> = {};
        const applyLive = (batchRows: Record<string, any>) => {
          const fresh: Record<string, any> = {};
          for (const [k, v] of Object.entries(batchRows)) {
            const cur = got[k];
            if (!cur || cur.source === 'none' || cur.source === 'screener' || richness(v) > richness(cur)) { got[k] = v; fresh[k] = v; }
          }
          if (!Object.keys(fresh).length) return;
          setRows((cur) => {
            const out = { ...cur };
            for (const [k, hit] of Object.entries(fresh)) {
              const sym = Object.prototype.hasOwnProperty.call(out, k) ? k : Object.keys(out).find((x) => x.toUpperCase() === k);
              if (!sym || !out[sym]) continue;
              const prev = out[sym];
              out[sym] = assess({
                ...prev, graded: hit, dataSource: 'screener-live',
                pattern: classifyOrNearest(hit) || prev.pattern,
                sourceUrl: prev.sourceUrl || hit.source_url || null,
              });
            }
            return out;
          });
        };
        for (let i = 0; i < wantLive.length && !cancelled; i += 12) {
          try {
            const r = await fetch(`/api/v1/portfolio/screener-live?tickers=${encodeURIComponent(wantLive.slice(i, i + 12).join(','))}`, { cache: 'no-store' });
            if (!r.ok) continue;
            const j = await readJson(r);
            const batchRows: Record<string, any> = {};
            for (const [k, v] of Object.entries(j?.rows || {})) if (v) { live[k.toUpperCase()] = v; batchRows[k.toUpperCase()] = v; }
            // Each batch lands as it arrives (progressive), not all at the end.
            applyLive(batchRows);
          } catch { /* one batch failing leaves those names as they were */ }
        }
        if (cancelled || !Object.keys(live).length) throw new Error('no live rows');
      } catch { /* enrichment only — every card still renders from what it had */ }
      if (cancelled) return;

      // The radar is an enrichment and never blocks the paint.
      try {
        const r = await fetch('/api/v1/concall-intel/transformation-screener?days=90&limit=200', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await readJson(r);
        const radar = new Map<string, number>();
        for (const e of (j?.entries || [])) radar.set(normSymbol(e.symbol), e.transformation_score);
        if (cancelled || !radar.size) return;
        setRows((cur) => {
          const out = { ...cur };
          for (const s of Object.keys(out)) {
            const v = radar.get(s);
            if (v != null) out[s] = { ...out[s], radarScore: v };
          }
          return out;
        });
      } catch { /* enrichment only */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Resume an interrupted batch once the rows are painted (see stage 4).
  useEffect(() => {
    if (loading) return;
    const syms = resumeRef.current;
    if (!syms || !syms.length) return;
    resumeRef.current = null;
    const t = setTimeout(() => { void readAll(syms); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  /**
   * Read a holding's evidence.
   *   mode 'incremental' (default) — read only if a source lists a document
   *     newer than the latest persisted period; else the store answers.
   *   mode 'read' — read unless a period is already on file.
   *   mode 'force' — re-read the current period (debug / manual refresh).
   *   mode 'check' — discovery only, no model: is there anything new?
   */
  const readFiling = useCallback(async (sym: string, mode: 'incremental' | 'read' | 'force' | 'check' = 'incremental', opts?: { filingDate?: string | null }) => {
    const cur = rowsRef.current[sym];
    if (!cur) return;
    const isUs = cur.market === 'US';
    // A check is discovery only and must never spend: the US reader has no
    // discovery mode (every call may be a model call), so a US check is a
    // note, not a request. (zzz770)
    if (isUs && mode === 'check') {
      setRows((r) => ({ ...r, [sym]: { ...r[sym], readNote: 'Check for new evidence searches India sources only — for a US name use Read evidence (one model call, on click).' } }));
      return;
    }
    setRows((r) => ({ ...r, [sym]: { ...r[sym], state: mode === 'check' ? r[sym].state : 'loading', error: undefined, readNote: mode === 'check' ? 'checking sources…' : null } }));
    try {
      // The graded row knows WHEN this holding last reported. Without it the
      // India reader searches only the rolling recent feed, which off-season
      // contains none of the book's results. (zzz724)
      // A caller that knows a NEWER filing date (the recent-reporters pass)
      // hands it in; otherwise the graded row's date is the best on file.
      const fd = String(opts?.filingDate || cur.graded?.filing_date || '').slice(0, 10);
      const dateQ = /^\d{4}-\d{2}-\d{2}$/.test(fd) ? `&filing_date=${fd}` : '';
      const modeQ = mode === 'force' ? '&force=1' : mode === 'check' ? '&mode=check' : mode === 'incremental' ? '&mode=incremental' : '';
      const url = isUs
        ? `/api/v1/us/ai-summary?ticker=${encodeURIComponent(sym)}${dateQ}${mode === 'force' ? '&force=1' : ''}`
        : `/api/v1/india/ai-summary?ticker=${encodeURIComponent(sym)}${dateQ}${modeQ}${mode === 'check' ? '' : '&ocr=1'}`;  // ocr=1: a clicked read may OCR a scanned filing (zzz765)
      const res = await fetch(url, { cache: 'no-store' });
      const j = await readJson(res);
      if (mode === 'check') {
        setRows((r) => {
          const prev = r[sym];
          const ledger: CompanyLedger | null = j?.ledger || prev.ledger || null;
          const fr = j?.freshness || freshnessOf(ledger);
          const unseen: any[] = Array.isArray(j?.unseen_documents) ? j.unseen_documents : [];
          const note = j?.ok
            ? (j.new_evidence
              ? `New evidence found: ${(unseen.length ? unseen : (j.candidates || [])).slice(0, 3).map((c: any) => c.label).join('; ')}${j.newest_period ? ` (${j.newest_period})` : ''} — not read yet (no model was called)`
              : (j.discovery_state === 'RETRIEVAL_FAILED' ? `Source unavailable — ${fr.detail}` : 'No newer relevant filing found. Evidence remains current.'))
            : `Check failed: ${j?.error || res.status}`;
          return { ...r, [sym]: { ...prev, ledger, freshness: fr, readNote: note, discoveryAttempts: j?.discovery_attempts || prev.discoveryAttempts, discoveryState: j?.discovery_state || prev.discoveryState } };
        });
        return;
      }
      if (j?.skipped === 'SKIPPED_NO_NEW_EVIDENCE') {
        setRows((r) => {
          const prev = r[sym];
          const next = j.ledger ? applyLedger(prev, j.ledger) : prev;
          return { ...r, [sym]: { ...next, state: next.summary ? 'done' : prev.state, readNote: j.note || 'No newer document at any source — evidence remains current.' } };
        });
        return;
      }
      if (!j?.ok || !j.structured) {
        // The failure carries its trail: which sources were tried and what
        // each answered. Previously this collapsed to one sentence and the
        // card could not distinguish "we could not reach it" from "the
        // company disclosed nothing". (zzz737)
        setRows((r) => {
          const prev = r[sym];
          // A failed read never erases evidence already on file: the ledger
          // carries the failure as `last_attempt` beside the periods.
          const ledger: CompanyLedger | null = j?.ledger || prev.ledger || null;
          const keepEvidence = !!prev.summary;
          // ── A FAILED RE-READ IS A NOTE, NOT AN ERROR BANNER.       (zzz762)
          //
          // MINDSPACE and MOREPENLAB rendered "No readable result on file for
          // this holding." in amber ABOVE a fully populated card, because a
          // later read that found nothing new wrote `error` over evidence
          // that was still on file and still current. When evidence is kept
          // the failure is filed where the read outcome belongs.
          const failure = j?.error || 'No readable result on file for this holding.';
          return { ...r, [sym]: { ...prev, state: keepEvidence ? 'done' : 'error',
            error: keepEvidence ? undefined : failure,
            readNote: keepEvidence ? `Latest read found nothing usable (${failure}) — evidence on file stands.` : prev.readNote,
            ledger, freshness: freshnessOf(ledger),
            persisted: j?.persisted ?? null,
            discoveryAttempts: j?.discovery_attempts || undefined,
            documentOutcomes: j?.document_outcomes || undefined,
            discoveryState: j?.state || null } };
        });
        return;
      }
      const src = j.source_url || j.filing_url || null;
      // The promise ledger is written BEFORE the check runs, and the check
      // excludes anything recorded in the last minute — so this quarter's
      // statements are recorded for next quarter without being used as
      // evidence against themselves.
      // Assessed OUTSIDE the state updater: React runs updater functions
      // lazily (during the next render), so anything captured inside one is
      // still null on the line after setRows. The first version posted the
      // status from inside the updater's closure and never posted anything —
      // every ledger had `status: null` and an empty history. (zzz742)
      const prev = rowsRef.current[sym];
      const ledger: CompanyLedger | null = j.ledger || null;
      // ── THE CARD AFTER A READ IS THE CARD AFTER A RELOAD.          (zzz770)
      // When the read landed in the store, the row is rebuilt from the
      // PERSISTED ledger through applyLedger — the exact path a page load
      // takes — so nothing on the card exists only in React state. Only a
      // read whose save failed is shown from the response, marked NOT SAVED.
      const landed = !!ledger && !!ledger.latest_period && j.persisted !== false;
      const base: BookRow = { ...prev, sourceUrl: src || prev.sourceUrl };
      const fromStore = landed ? applyLedger(base, ledger) : null;
      const ch = ledger ? whatChanged(ledger) : { lines: [], from: null };
      const note = j.from_ledger
        ? 'Loaded from the evidence ledger — no new read.'
        : j.persisted === false
          ? `Read ${(j.documents_read || []).length} document(s) but the save FAILED: ${j.persist_error || 'unknown'} — this will not survive a reload.`
          : [evidenceReadLine(ledger), changesNote(j.changes)].filter(Boolean).join(' · ');
      const assessed = fromStore
        ? { ...fromStore, persisted: j.from_ledger ? true : (j.persisted ?? true), persistError: j.persist_error || null, readNote: note }
        : assess({
          ...base, summary: j.structured, state: 'done' as const,
          documentsRead: j.documents_read || undefined,
          discoveryAttempts: j.discovery_attempts || undefined,
          documentOutcomes: j.document_outcomes || undefined,
          discoveryState: j.discovery_state || null,
          // zzz724 — re-classify with the filing in hand. Order-book growth
          // exists only in the document, so B can only ever fire here.
          pattern: classifyWithFiling(prev.graded, j.structured) || prev.pattern || classifyOrNearest(prev.graded),
          ledger: ledger || prev.ledger || null,
          freshness: freshnessOf(ledger || prev.ledger || null),
          reportingPeriod: j.reporting_period || prev.reportingPeriod || null,
          changed: ch.lines, changedFrom: ch.from,
          // `persisted` is the route's word, not ours. A read that did not
          // land is shown as such — never as "Evidence updated".
          persisted: j.from_ledger ? true : (j.persisted ?? null),
          persistError: j.persist_error || null,
          readNote: note,
        });
      setRows((r) => ({ ...r, [sym]: assessed }));
      try { recordPromises(sym, j.structured, src); } catch { /* ledger is best-effort */ }
      // Status history is recorded for a fresh read AND for a ledger load
      // whose period has no status yet (the first version never recorded
      // one, so existing ledgers are back-filled on their next load).
      const periodRec = assessed.ledger && assessed.reportingPeriod ? assessed.ledger.periods[assessed.reportingPeriod] : null;
      if ((!j.from_ledger && !j.cached) || (periodRec && !periodRec.status)) { void postStatus(assessed); }
    } catch (e: any) {
      setRows((r) => ({ ...r, [sym]: { ...r[sym], state: 'error', error: humanError(e) } }));
    }
  }, []);

  /** Read many filings, a few at a time. The summary routes are rate-limited
   *  upstream, so a fan-out of fifty becomes fifty failures. */
  /**
   * The batch is a PERSISTENCE JOB, not a UI loop. (zzz740)
   *   · Only names that need a read are queued: never read, failed, or with
   *     newer evidence available. A CURRENT name is skipped without a call
   *     unless `opts.reprocess` asks for a re-read.
   *   · The job header is recorded server-side before the first read, so a
   *     reload derives "37 updated · 77 remaining" from the ledgers.
   */
  const readAll = useCallback(async (syms: string[], concurrency = 3, opts?: { reprocess?: boolean; exact?: boolean; filingDates?: Record<string, string>; modeOf?: Record<string, 'incremental' | 'force'> }) => {
    const todo = syms.filter((s) => {
      const row = rowsRef.current[s];
      if (!row) return false;
      if (row.state === 'loading') return false;
      // `exact`: the caller has already decided who needs a read (the
      // recent-reporters planner) — the freshness filter must not second-
      // guess a list built from a newer fact than it holds. (zzz763)
      if (opts?.exact) return true;
      if (opts?.reprocess) return true;
      const fr = row.freshness?.state;
      const es = row.freshness?.evidence_state;
      if (!row.summary) return true;                                  // never read, or failed
      // Only the names that need it: new evidence, stale, or a failed last
      // attempt (retried). CURRENT names are skipped without a call; the
      // server's incremental check is the last guard either way. (zzz770)
      return fr === 'NEW_EVIDENCE_AVAILABLE' || fr === 'STALE'
        || es === 'NEW_EVIDENCE_AVAILABLE' || es === 'STALE' || es === 'RETRIEVAL_FAILED' || es === 'SOURCE_UNAVAILABLE';
    });
    if (!todo.length) return;
    stopRef.current = false;
    setBatch({ running: true, done: 0, total: todo.length });
    try {
      await fetch('/api/v1/portfolio/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_start', tickers: todo }) });
    } catch { /* progress then lives only in this tab; the ledgers still persist */ }
    let i = 0, done = 0;
    const worker = async () => {
      while (!stopRef.current) {
        const k = i++;
        if (k >= todo.length) return;
        // A throw here used to end the worker silently and the batch with it
        // — three names in, "finished". Every name is attempted; a failure is
        // recorded on its row and the loop continues. (zzz744)
        // zzz830: the bulk AI read names the mode per name (an AI-read but
        // incomplete name is re-read; the rest take the incremental read).
        try { await readFiling(todo[k], opts?.modeOf?.[todo[k]] || (opts?.reprocess ? 'force' : 'incremental'), { filingDate: opts?.filingDates?.[todo[k]] || null }); }
        catch (e: any) {
          const sym = todo[k];
          setRows((r) => (r[sym] ? { ...r, [sym]: { ...r[sym], state: r[sym].summary ? 'done' : 'error', error: `batch: ${humanError(e)}` } } : r));
        }
        done++;
        setBatch((b) => (b.running ? { ...b, done } : b));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    setBatch((b) => ({ ...b, running: false }));
    try {
      await fetch('/api/v1/portfolio/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_finish' }) });
    } catch { /* see above */ }
  }, [readFiling]);

  const stop = useCallback(() => { stopRef.current = true; }, []);

  /**
   * CHECK FOR NEW EVIDENCE — every name, discovery only, NO MODEL. (zzz770)
   * Each company's sources are searched and the documents no period lists
   * yet are filed as pending on ITS ledger, so a Q2 filing by one company
   * marks only that company NEW EVIDENCE AVAILABLE. Nothing is read.
   */
  const [checkBatch, setCheckBatch] = useState<{ running: boolean; done: number; total: number; found: number }>({ running: false, done: 0, total: 0, found: 0 });
  const checkAll = useCallback(async (syms: string[], concurrency = 3) => {
    const todo = syms.filter((s) => { const r = rowsRef.current[s]; return !!r && r.market !== 'US' && r.state !== 'loading'; });
    if (!todo.length) return;
    stopRef.current = false;
    setCheckBatch({ running: true, done: 0, total: todo.length, found: 0 });
    let i = 0, done = 0;
    const worker = async () => {
      while (!stopRef.current) {
        const k = i++;
        if (k >= todo.length) return;
        try { await readFiling(todo[k], 'check'); } catch { /* recorded on the row */ }
        // zzz811: with the full bench (300+ names) the check stays polite —
        // three at a time and a short pause between calls per worker.
        if (todo.length > 40 && !stopRef.current) await new Promise((res) => setTimeout(res, 200));
        done++;
        const found = Object.values(rowsRef.current).filter((r) => todo.includes(r.symbol) && (r.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' || r.freshness?.evidence_state === 'NEW_EVIDENCE_AVAILABLE')).length;
        setCheckBatch((b) => ({ ...b, done, found }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    setCheckBatch((b) => ({ ...b, running: false }));
  }, [readFiling]);

  // ══════════════════════════════════════════════════════════════════════
  // QUICK READ (NO AI) — ON PAGE LOAD, A FEW AT A TIME.             (zzz816)
  //
  // Every India name with no evidence on file for the latest expected
  // quarter is read WITHOUT AI: the server finds its latest concall
  // transcript, investor presentation and results filing, runs the
  // deterministic extractors and persists the facts to the same ledger the
  // AI read uses, marked "read without AI". Book first, then the bench
  // names passing his Conviction Beats criteria, then the rest. Three at a
  // time with a short pause; Stop works; a failure is recorded on the name
  // and never retried on every load (the server waits six hours). No model
  // is called — the AI read stays on its button.
  // ══════════════════════════════════════════════════════════════════════
  const [quick, setQuick] = useState<{ running: boolean; done: number; total: number; filled: number; failed: number; nothing: number; skipped: number; current: string[] }>({ running: false, done: 0, total: 0, filled: 0, failed: 0, nothing: 0, skipped: 0, current: [] });
  const quickStopRef = useRef(false);
  const quickStarted = useRef(false);
  const quickReadOne = useCallback(async (sym: string, force = false): Promise<string> => {
    const cur = rowsRef.current[sym];
    if (!cur || cur.market === 'US') return 'SKIPPED';
    const fd = String(cur.graded?.filing_date || '').slice(0, 10);
    const q = `/api/v1/portfolio/quick-read?ticker=${encodeURIComponent(sym)}${/^\d{4}-\d{2}-\d{2}$/.test(fd) ? `&filing_date=${fd}` : ''}${force ? '&force=1' : ''}`;
    let j: any = null;
    try {
      const r = await fetch(q, { cache: 'no-store', signal: AbortSignal.timeout(70_000) });
      j = await readJson(r);
    } catch (e: any) {
      j = { ok: false, outcome: 'FAILED', note: `Quick read (no AI) did not answer: ${humanError(e)}` };
    }
    const ledger: CompanyLedger | null = j?.ledger || null;
    const fold = (prev: BookRow): BookRow => {
      const base: BookRow = ledger ? applyLedger(prev, ledger) : prev;
      // applyLedger re-assesses only when a period is on file; a failed or
      // empty search changes the rows' words (searched / couldn't read), so
      // the row is assessed again either way.
      const next = ledger && !ledger.latest_period ? assess(base) : base;
      return { ...next, readNote: j?.note || next.readNote || null };
    };
    setRows((r) => (r[sym] ? { ...r, [sym]: fold(r[sym]) } : r));
    const after = rowsRef.current[sym] ? fold(rowsRef.current[sym]) : null;
    if (after && j?.outcome === 'READ' && after.reportingPeriod) void postStatus(after);
    return String(j?.outcome || 'FAILED');
  }, []);
  const quickReadAll = useCallback(async (opts?: { force?: boolean; symbols?: string[] }) => {
    const all = Object.values(rowsRef.current) as Array<BookRow & QuickRowLike>;
    const pool = opts?.symbols ? all.filter((r) => opts.symbols!.includes(r.symbol)) : all;
    const todo = quickReadQueue(pool).map((r) => r.symbol);
    if (!todo.length) return;
    quickStopRef.current = false;
    setQuick({ running: true, done: 0, total: todo.length, filled: 0, failed: 0, nothing: 0, skipped: 0, current: [] });
    let i = 0;
    const worker = async () => {
      while (!quickStopRef.current) {
        const k = i++;
        if (k >= todo.length) return;
        const sym = todo[k];
        setQuick((p) => ({ ...p, current: [...p.current, sym] }));
        const outcome = await quickReadOne(sym, !!opts?.force);
        setQuick((p) => ({
          ...p, done: p.done + 1, current: p.current.filter((x) => x !== sym),
          filled: p.filled + (outcome === 'READ' ? 1 : 0),
          failed: p.failed + (outcome === 'FAILED' ? 1 : 0),
          nothing: p.nothing + (outcome === 'NO_DOCUMENTS' ? 1 : 0),
          skipped: p.skipped + (outcome === 'SKIPPED' ? 1 : 0),
        }));
        // Polite: a short pause between names per worker.
        if (!quickStopRef.current) await new Promise((res) => setTimeout(res, 300));
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker));
    setQuick((p) => ({ ...p, running: false, current: [] }));
  }, [quickReadOne]);
  const stopQuick = useCallback(() => { quickStopRef.current = true; }, []);
  // Started once, automatically, when the stored evidence is in (Portfolio
  // Catalysts only — the research surface; Exit Radar reads what is on file).
  useEffect(() => {
    if (!includeBench || evidenceLoading || loading || quickStarted.current) return;
    const t = setTimeout(() => { if (quickStarted.current) return; quickStarted.current = true; void quickReadAll(); }, 1200);
    return () => clearTimeout(t);
  }, [includeBench, evidenceLoading, loading, quickReadAll]);
  useEffect(() => () => { quickStopRef.current = true; }, []);

  /**
   * READ THE PRIOR QUARTER — so a level gets a before. On click only. (zzz765)
   *
   * Queues only the India names whose ledger has a latest period, has NOT got
   * the period immediately before it, and already lists at least one
   * document for that quarter (priorBackfillPlan). One model call per name,
   * three at a time, with a server-side batch header of its own so an
   * interrupted run can be resumed — by a click, never on reload.
   *
   * After each name its ledger is re-loaded and folded back in through the
   * same applyLedger → assess path a page load uses, so the comparisons are
   * rebuilt from both periods and the card can print "72% → 80% · +8pp".
   */
  const readPriorPeriods = useCallback(async (syms: string[], concurrency = 3) => {
    const todo = syms.filter((s) => {
      const row = rowsRef.current[s];
      if (!row || row.market === 'US' || row.state === 'loading') return false;
      return !!priorBackfillPlan(row.ledger || null);
    });
    if (!todo.length) return;
    stopRef.current = false;
    setPriorBatch({ running: true, done: 0, total: todo.length });
    try {
      await fetch('/api/v1/portfolio/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_start', kind: 'prior', tickers: todo }) });
    } catch { /* progress then lives only in this tab; the ledgers still persist */ }

    const one = async (sym: string) => {
      const row = rowsRef.current[sym];
      const plan = row ? priorBackfillPlan(row.ledger || null) : null;
      if (!row || !plan) return;
      setRows((r) => (r[sym] ? { ...r, [sym]: { ...r[sym], readNote: `Reading ${plan.target} (prior quarter)…` } } : r));
      // The exchange day feed is only worth asking when the best document came
      // from it; screener.in dates are month labels, not filing days.
      const best = plan.candidates[0];
      const fd = best && best.source === 'exchange filing feed' && /^\d{4}-\d{2}-\d{2}/.test(String(best.date_iso || ''))
        ? `&filing_date=${String(best.date_iso).slice(0, 10)}` : '';
      let j: any = null;
      try {
        // ocr=1: a clicked prior-quarter read may OCR a scanned filing too. (zzz770)
        const res = await fetch(`/api/v1/india/ai-summary?ticker=${encodeURIComponent(sym)}&period=${encodeURIComponent(plan.target)}${fd}&ocr=1`, { cache: 'no-store' });
        j = await readJson(res);
      } catch (e: any) {
        j = { ok: false, error: humanError(e) };
      }
      // Reload the ledger from the store — what was PERSISTED is what the card
      // compares, not what this response claims.
      let ledger: CompanyLedger | null = j?.ledger || null;
      try {
        const r = await fetch(`/api/v1/portfolio/evidence?tickers=${encodeURIComponent(sym)}`, { cache: 'no-store' });
        if (r.ok) ledger = (await readJson(r))?.ledgers?.[sym.toUpperCase()] || ledger;
      } catch { /* the response's own ledger stands in */ }
      const prev = rowsRef.current[sym];
      if (!prev) return;
      const next = ledger ? applyLedger(prev, ledger) : prev;
      const landed = !!ledger?.periods?.[plan.target];
      const note = landed
        ? `Prior quarter ${plan.target} read · ${(j?.documents_read || []).length} document(s) · ${(j?.events || []).length} facts — before → after now available`
        : `Prior quarter ${plan.target} not read: ${j?.error || (j?.persisted === false ? `save failed (${j?.persist_error || 'unknown'})` : 'no result')}`;
      rowsRef.current = { ...rowsRef.current, [sym]: { ...next, readNote: note } };
      setRows((r) => ({ ...r, [sym]: { ...next, readNote: note } }));
      // The current period's status can move once it has a before; recorded
      // with history as any other status change. Best-effort, no model.
      const cp = next.ledger && next.reportingPeriod ? next.ledger.periods[next.reportingPeriod] : null;
      if (landed && next.assessment && cp && cp.status !== next.assessment.status) void postStatus(next);
    };

    let i = 0, done = 0;
    const worker = async () => {
      while (!stopRef.current) {
        const k = i++;
        if (k >= todo.length) return;
        try { await one(todo[k]); }
        catch (e: any) {
          const sym = todo[k];
          setRows((r) => (r[sym] ? { ...r, [sym]: { ...r[sym], readNote: `Prior quarter read failed: ${humanError(e)}` } } : r));
        }
        done++;
        setPriorBatch((b) => (b.running ? { ...b, done } : b));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    const stopped = stopRef.current;
    setPriorBatch((b) => ({ ...b, running: false, resumable: stopped ? Math.max(0, b.total - b.done) : 0 }));
    if (!stopped) {
      try {
        await fetch('/api/v1/portfolio/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_finish', kind: 'prior' }) });
      } catch { /* see above */ }
    }
  }, []);

  /**
   * Re-read ONLY the holdings that filed results in the last `days` days and
   * have not been read since that filing. Never runs on its own. (zzz763)
   *
   *   1. Ask the exchange feed who reported, and when (no model, no ledger).
   *   2. Plan against the ledgers already in the rows: a document on file or
   *      a read dated on/after the filing → CURRENT, skipped without a call.
   *   3. Read the rest, three at a time, in incremental mode — the route's
   *      own newer-than check is the last guard, so a name the feed flagged
   *      but whose sources list nothing new still costs no model call.
   *
   * The feed is NSE; US names are counted and skipped, never guessed.
   */
  const readRecentReporters = useCallback(async (days = 10) => {
    const all = Object.values(rowsRef.current);
    const india = all.filter((r) => r.market !== 'US').map((r) => r.symbol);
    const usSkipped = all.length - india.length;
    setRecent((r) => ({ ...r, state: 'checking', days, error: null, plan: null, feedNote: null, feed: null, usSkipped, at: null }));
    if (!india.length) {
      setRecent((r) => ({ ...r, state: 'done', at: new Date().toISOString(), plan: { days, from: '', due: [], current: [], not_reported: 0 } }));
      return;
    }
    let j: any;
    try {
      const res = await fetch(`/api/v1/thesis/recent-reporters?days=${days}&tickers=${encodeURIComponent(india.join(','))}`, { cache: 'no-store' });
      j = await readJson(res);
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
    } catch (e: any) {
      setRecent((r) => ({ ...r, state: 'error', error: `Could not ask the exchange feed who reported: ${humanError(e)}` }));
      return;
    }
    const reported: ReportedFact[] = Array.isArray(j.reported) ? j.reported : [];
    const ledgers: Record<string, CompanyLedger | null> = {};
    const loading = new Set<string>();
    for (const r of all) { ledgers[r.symbol] = r.ledger || null; if (r.state === 'loading') loading.add(r.symbol); }
    const plan = planRecentReads(reported, ledgers, india.length, days, String(j.from || ''), loading);
    const feed = j.feed ? { items: Number(j.feed.items || 0), days_fetched: Number(j.feed.days_fetched || 0), days_failed: Array.isArray(j.feed.days_failed) ? j.feed.days_failed : [], cached: !!j.feed.cached } : null;
    if (!plan.due.length) {
      setRecent((r) => ({ ...r, state: 'done', plan, feed, feedNote: j.note || null, at: new Date().toISOString() }));
      return;
    }
    setRecent((r) => ({ ...r, state: 'reading', plan, feed, feedNote: j.note || null }));
    const filingDates: Record<string, string> = {};
    for (const d of plan.due) filingDates[d.ticker] = d.reported_at;
    try {
      await readAll(plan.due.map((d) => d.ticker), 3, { exact: true, filingDates });
      setRecent((r) => ({ ...r, state: 'done', at: new Date().toISOString() }));
    } catch (e: any) {
      setRecent((r) => ({ ...r, state: 'error', error: humanError(e), at: new Date().toISOString() }));
    }
  }, [readAll]);

  // ── THESIS TYPES SET BY THE OWNER.                               (zzz774)
  const [thesisTypes, setThesisTypes] = useState<Record<string, AbfgPattern>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/v1/portfolio/evidence?thesis_types=1', { cache: 'no-store' });
        const j = await readJson(r);
        const map: Record<string, AbfgPattern> = j?.thesis_types || {};
        if (cancelled) return;
        for (const [k, v] of Object.entries(map)) THESIS_OVERRIDES[k.toUpperCase()] = v;
        setThesisTypes(map);
        if (Object.keys(map).length) setRows((rs) => { const out: Record<string, BookRow> = {}; for (const [k, v] of Object.entries(rs)) out[k] = assess(v); return out; });
      } catch { /* the automatic classification stands */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const setThesisType = useCallback(async (sym: string, p: AbfgPattern | null) => {
    const key = sym.toUpperCase();
    if (p) THESIS_OVERRIDES[key] = p; else delete THESIS_OVERRIDES[key];
    setThesisTypes((m) => { const n = { ...m }; if (p) n[key] = p; else delete n[key]; return n; });
    setRows((rs) => {
      const cur = rs[sym];
      if (!cur) return rs;
      // Clearing an override returns to the automatic classification.
      const auto = p ? cur : { ...cur, pattern: cur.graded ? classifyOrNearest(cur.graded) : null };
      return { ...rs, [sym]: assess(auto) };
    });
    try {
      await fetch('/api/v1/portfolio/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'thesis_type', ticker: key, pattern: p }) });
    } catch { /* kept locally for this session */ }
  }, []);

  return { symbols, origins, note, rows, loading, evidenceLoading, batch, readFiling, readAll, stop, recent, readRecentReporters, priorBatch, readPriorPeriods, checkAll, checkBatch, thesisTypes, setThesisType, quick, quickReadAll, quickReadOne, stopQuick };
}
