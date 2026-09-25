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
import {
  readHoldingSymbols, fetchServerBook, benchPassingPreset, mergeUniverse,
  originCounts, type BookOrigin,
} from './universe';
import { readConvictionBeats } from '@/lib/conviction-beats';
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
import { provisionalType, isProvisionalFallback, noTypeReason, promotionFromFilings, promotedType } from './provisional-type';

export interface BookRow {
  symbol: string;
  /** Book, bench, or both. A bench name is a candidate, never a holding. */
  origin: BookOrigin;
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
  const row: BookRow = ov
    ? { ...row0, pattern: manualPattern(ov) }
    : (!row0.pattern || isProvisionalFallback(row0.pattern))
      ? { ...row0, pattern: classifyWithFiling(row0.graded, row0.summary) || classifyOrNearest(row0.graded) || provisionalType(row0.graded, row0.summary) }
      : row0;
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
      retrievalFailed: row.discoveryState === 'RETRIEVAL_FAILED' || row.ledger?.last_attempt?.outcome === 'FAILED',
      // Services / software / financial businesses: capacity is N/A. (zzz770)
      business: businessProfileOf(row.graded, row.summary),
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
  /** Bench candidates that passed the preset and are shown. */
  bench: number;
  /** Held AND benched. Counted inside both figures above, never double-added
   *  to the total. */
  both: number;
  /** Bench candidates the preset rejected. Shown as a number so the page can
   *  say what it filtered rather than quietly shrinking. */
  benchFiltered: number;
  /** Bench candidates with no graded row anywhere — excluded because the
   *  preset could not be applied, NOT because it failed. */
  benchUnchecked: number;
  /** Non-null when the server book could not be read. */
  serverError: string | null;
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
    book: 0, bench: 0, both: 0, benchFiltered: 0, benchUnchecked: 0, serverError: null,
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
      const byNorm = new Map(Object.entries(bench).map(([k, v]) => [normSymbol(k), v]));

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
      const localHeld = readHoldingSymbols();
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

      let universe = mergeUniverse(localHeld, []);
      paint(universe);
      setNote((n) => ({ ...n, ...originCounts(universe.values()) }));

      // ── STAGE 2 — the server book. localStorage is per-browser; the book
      // is not. A name added on another machine is still a holding.
      const server = await fetchServerBook();
      if (cancelled) return;
      const held = new Set<string>([...localHeld, ...server.held]);
      universe = mergeUniverse(held, []);
      paint(universe);

      // Bench candidates: the server's bench list, plus anything in this
      // browser's local bench that the server has not heard of yet.
      const candidates = includeBench
        ? Array.from(new Set<string>([
          ...server.benched,
          ...Array.from(byNorm.keys()),
        ])).filter((s) => !held.has(s))
        : [];

      setNote((n) => ({
        ...n, ...originCounts(universe.values()), serverError: server.error,
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

      const gate = benchPassingPreset(candidates, got);
      universe = mergeUniverse(held, gate.passed);
      paint(universe);
      setNote((n) => ({
        ...n, ...originCounts(universe.values()),
        benchFiltered: gate.failed, benchUnchecked: gate.unchecked.length,
        serverError: server.error,
      }));

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
        const wantLive = Array.from(new Set([
          ...Array.from(universe.keys()).filter((s) => {
            const g = got[s.toUpperCase()] || rowsRef.current[s]?.graded;
            return (rowsRef.current[s]?.market !== 'US') && (!g || g.source === 'none' || g.source === 'screener');
          }),
          ...benchPassingPreset(candidates, got).unchecked,
        ]));
        const live: Record<string, any> = {};
        for (let i = 0; i < wantLive.length && !cancelled; i += 12) {
          try {
            const r = await fetch(`/api/v1/portfolio/screener-live?tickers=${encodeURIComponent(wantLive.slice(i, i + 12).join(','))}`, { cache: 'no-store' });
            if (!r.ok) continue;
            const j = await readJson(r);
            for (const [k, v] of Object.entries(j?.rows || {})) if (v) live[k.toUpperCase()] = v;
          } catch { /* one batch failing leaves those names as they were */ }
        }
        if (cancelled || !Object.keys(live).length) throw new Error('no live rows');
        for (const [k, v] of Object.entries(live)) {
          const cur = got[k];
          if (!cur || cur.source === 'none' || cur.source === 'screener' || richness(v) > richness(cur)) got[k] = v;
        }
        const gate2 = benchPassingPreset(candidates, got);
        const before = new Set(universe.keys());
        universe = mergeUniverse(held, gate2.passed);
        paint(universe);
        setNote((n) => ({
          ...n, ...originCounts(universe.values()),
          benchFiltered: gate2.failed, benchUnchecked: gate2.unchecked.length,
        }));
        // Ledgers for bench names admitted by this pass.
        const added = Array.from(universe.keys()).filter((s) => !before.has(s));
        const addedLedgers: Record<string, CompanyLedger> = {};
        for (let i = 0; i < added.length && !cancelled; i += 100) {
          try {
            const r = await fetch(`/api/v1/portfolio/evidence?tickers=${encodeURIComponent(added.slice(i, i + 100).join(','))}`, { cache: 'no-store' });
            if (r.ok) Object.assign(addedLedgers, (await readJson(r))?.ledgers || {});
          } catch { /* the card says NEVER READ */ }
        }
        setRows((cur) => {
          const out = { ...cur };
          for (const sym of Array.from(universe.keys())) {
            const hit = live[sym.toUpperCase()];
            const prev = out[sym];
            if (!prev) continue;
            let next = prev;
            if (hit && (got[sym.toUpperCase()] === hit)) {
              next = {
                ...next, graded: hit, dataSource: 'screener-live',
                pattern: classifyOrNearest(hit) || next.pattern,
                sourceUrl: next.sourceUrl || hit.source_url || null,
              };
            }
            const l = addedLedgers[sym.toUpperCase()];
            if (l) next = applyLedger(next, l);
            if (next !== prev) out[sym] = assess(next);
          }
          return out;
        });
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
  const readAll = useCallback(async (syms: string[], concurrency = 3, opts?: { reprocess?: boolean; exact?: boolean; filingDates?: Record<string, string> }) => {
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
        try { await readFiling(todo[k], opts?.reprocess ? 'force' : 'incremental', { filingDate: opts?.filingDates?.[todo[k]] || null }); }
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
  const checkAll = useCallback(async (syms: string[], concurrency = 4) => {
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
        done++;
        const found = Object.values(rowsRef.current).filter((r) => todo.includes(r.symbol) && (r.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' || r.freshness?.evidence_state === 'NEW_EVIDENCE_AVAILABLE')).length;
        setCheckBatch((b) => ({ ...b, done, found }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    setCheckBatch((b) => ({ ...b, running: false }));
  }, [readFiling]);

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

  return { symbols, origins, note, rows, loading, evidenceLoading, batch, readFiling, readAll, stop, recent, readRecentReporters, priorBatch, readPriorPeriods, checkAll, checkBatch, thesisTypes, setThesisType };
}
