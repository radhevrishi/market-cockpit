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
import { readPortfolioSymbols, normSymbol } from '@/lib/portfolio-symbols';
import { readConvictionBeats } from '@/lib/conviction-beats';
import { classifyGradedRow, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import { extractVariables } from './variables';
import { assessThesis, type ThesisAssessment } from './status';
import { buildCapexChain, type CapexChain } from './capex-chain';
import { recordPromises, checkPromises } from './guidance-ledger';

export interface BookRow {
  symbol: string;
  market: 'IN' | 'US';
  graded: any | null;
  tier: string | null;
  pattern: AbfgResult | null;
  radarScore: number | null;
  summary: any | null;
  sourceUrl: string | null;
  state: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  assessment: ThesisAssessment | null;
  capex: CapexChain | null;
  promiseNote: string | null;
}

function assess(row: BookRow): BookRow {
  const vars = extractVariables(row.graded, row.summary);
  const check = row.summary ? checkPromises(row.symbol, row.summary) : null;
  return {
    ...row,
    assessment: assessThesis({
      pattern: row.pattern?.pattern ?? null,
      variables: vars,
      promiseGap: check ? { gap: check.gap, detail: check.detail } : null,
    }),
    capex: buildCapexChain(row.summary, vars),
    promiseNote: check ? check.detail : null,
  };
}

export function useBook() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, BookRow>>({});
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0 });
  const rowsRef = useRef<Record<string, BookRow>>({});
  const stopRef = useRef(false);

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  useEffect(() => {
    try { setSymbols(Array.from(readPortfolioSymbols())); } catch { setSymbols([]); }
  }, []);

  useEffect(() => {
    if (!symbols.length) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      let bench: Record<string, any> = {};
      try { bench = readConvictionBeats(); } catch { bench = {}; }
      const byNorm = new Map(Object.entries(bench).map(([k, v]) => [normSymbol(k), v]));
      const next: Record<string, BookRow> = {};
      for (const sym of symbols) {
        const g = byNorm.get(sym) || null;
        next[sym] = assess({
          symbol: sym,
          market: g?.market === 'US' ? 'US' : 'IN',
          graded: g,
          tier: g?.tier || null,
          pattern: g ? classifyGradedRow(g) : null,
          radarScore: null,
          summary: null,
          sourceUrl: g?.filing_url || g?.source_url || null,
          state: 'idle',
          assessment: null, capex: null, promiseNote: null,
        });
      }
      if (cancelled) return;
      setRows(next); setLoading(false);

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
  }, [symbols]);

  const readFiling = useCallback(async (sym: string) => {
    const cur = rowsRef.current[sym];
    if (!cur) return;
    const isUs = cur.market === 'US';
    setRows((r) => ({ ...r, [sym]: { ...r[sym], state: 'loading', error: undefined } }));
    try {
      const url = isUs
        ? `/api/v1/us/ai-summary?ticker=${encodeURIComponent(sym)}`
        : `/api/v1/india/ai-summary?ticker=${encodeURIComponent(sym)}`;
      const res = await fetch(url, { cache: 'no-store' });
      const j = await res.json();
      if (!j?.ok || !j.structured) {
        setRows((r) => ({ ...r, [sym]: { ...r[sym], state: 'error',
          error: j?.error || 'No readable result on file for this holding.' } }));
        return;
      }
      const src = j.source_url || j.filing_url || null;
      // The promise ledger is written BEFORE the check runs, and the check
      // excludes anything recorded in the last minute — so this quarter's
      // statements are recorded for next quarter without being used as
      // evidence against themselves.
      setRows((r) => {
        const base = { ...r[sym], summary: j.structured, sourceUrl: src || r[sym].sourceUrl, state: 'done' as const };
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

  return { symbols, rows, loading, batch, readFiling, readAll, stop };
}
