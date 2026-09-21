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
import { classifyGradedRow, classifyWithFiling, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import { extractVariables } from './variables';
import { assessThesis, type ThesisAssessment } from './status';
import { buildCapexChain, type CapexChain } from './capex-chain';
import { recordPromises, checkPromises } from './guidance-ledger';

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
}

function assess(row: BookRow): BookRow {
  const vars = extractVariables(row.graded, row.summary);
  const check = row.summary ? checkPromises(row.symbol, row.summary) : null;
  return {
    ...row,
    assessment: assessThesis({
      pattern: row.pattern?.pattern ?? null,
      variables: vars,
      promiseGap: check ? {
        gap: check.gap, detail: check.detail, direction: check.direction || 'behind',
        plan: check.plan ?? null, actual: check.actual ?? null, variance: check.variance ?? null,
      } : null,
      // An evidence document has been read only when a summary came back.
      evidenceReviewed: !!row.summary,
    }),
    capex: buildCapexChain(row.summary, vars),
    promiseNote: check ? check.detail : null,
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
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0 });
  const [note, setNote] = useState<UniverseNote>({
    book: 0, bench: 0, both: 0, benchFiltered: 0, benchUnchecked: 0, serverError: null,
  });
  const rowsRef = useRef<Record<string, BookRow>>({});
  const stopRef = useRef(false);

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
        pattern: g ? classifyGradedRow(g) : null,
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
        const next: Record<string, BookRow> = { ...rowsRef.current };
        for (const [sym, origin] of universe) {
          if (next[sym]) { next[sym] = { ...next[sym], origin }; continue; }
          const g = byNorm.get(sym) || null;
          next[sym] = { ...build(sym, g, g ? 'graded' : null), origin };
        }
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
          const j = await r.json();
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
            pattern: classifyGradedRow(hit) || prev.pattern,
            sourceUrl: prev.sourceUrl || hit.filing_url || hit.source_url || null,
            dataSource: hit.source,
          });
        }
        return out;
      });

      // The radar is an enrichment and never blocks the paint.
      try {
        const r = await fetch('/api/v1/concall-intel/transformation-screener?days=90&limit=200', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
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

  const readFiling = useCallback(async (sym: string) => {
    const cur = rowsRef.current[sym];
    if (!cur) return;
    const isUs = cur.market === 'US';
    setRows((r) => ({ ...r, [sym]: { ...r[sym], state: 'loading', error: undefined } }));
    try {
      // The graded row knows WHEN this holding last reported. Without it the
      // India reader searches only the rolling recent feed, which off-season
      // contains none of the book's results. (zzz724)
      const fd = String(cur.graded?.filing_date || '').slice(0, 10);
      const dateQ = /^\d{4}-\d{2}-\d{2}$/.test(fd) ? `&filing_date=${fd}` : '';
      const url = isUs
        ? `/api/v1/us/ai-summary?ticker=${encodeURIComponent(sym)}`
        : `/api/v1/india/ai-summary?ticker=${encodeURIComponent(sym)}${dateQ}`;
      const res = await fetch(url, { cache: 'no-store' });
      const j = await res.json();
      if (!j?.ok || !j.structured) {
        // The failure carries its trail: which sources were tried and what
        // each answered. Previously this collapsed to one sentence and the
        // card could not distinguish "we could not reach it" from "the
        // company disclosed nothing". (zzz737)
        setRows((r) => ({ ...r, [sym]: { ...r[sym], state: 'error',
          error: j?.error || 'No readable result on file for this holding.',
          discoveryAttempts: j?.discovery_attempts || undefined,
          discoveryState: j?.state || null } }));
        return;
      }
      const src = j.source_url || j.filing_url || null;
      // The promise ledger is written BEFORE the check runs, and the check
      // excludes anything recorded in the last minute — so this quarter's
      // statements are recorded for next quarter without being used as
      // evidence against themselves.
      setRows((r) => {
        const prev = r[sym];
        const base = {
          ...prev, summary: j.structured, sourceUrl: src || prev.sourceUrl, state: 'done' as const,
          documentsRead: j.documents_read || undefined,
          discoveryAttempts: j.discovery_attempts || undefined,
          discoveryState: j.discovery_state || null,
          // zzz724 — re-classify with the filing in hand. Order-book growth
          // exists only in the document, so B can only ever fire here.
          pattern: classifyWithFiling(prev.graded, j.structured) || prev.pattern,
        };
        return { ...r, [sym]: assess(base) };
      });
      try { recordPromises(sym, j.structured, src); } catch { /* ledger is best-effort */ }
    } catch (e: any) {
      setRows((r) => ({ ...r, [sym]: { ...r[sym], state: 'error', error: String(e?.message || e) } }));
    }
  }, []);

  /** Read many filings, a few at a time. The summary routes are rate-limited
   *  upstream, so a fan-out of fifty becomes fifty failures. */
  const readAll = useCallback(async (syms: string[], concurrency = 3) => {
    const todo = syms.filter((s) => {
      const st = rowsRef.current[s]?.state;
      return st === 'idle' || st === 'error';
    });
    if (!todo.length) return;
    stopRef.current = false;
    setBatch({ running: true, done: 0, total: todo.length });
    let i = 0, done = 0;
    const worker = async () => {
      while (!stopRef.current) {
        const k = i++;
        if (k >= todo.length) return;
        await readFiling(todo[k]);
        done++;
        setBatch((b) => (b.running ? { ...b, done } : b));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    setBatch((b) => ({ ...b, running: false }));
  }, [readFiling]);

  const stop = useCallback(() => { stopRef.current = true; }, []);

  return { symbols, origins, note, rows, loading, batch, readFiling, readAll, stop };
}
