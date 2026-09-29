'use client';
// zzz837 — the click-driven runner for "Let AI choose the type" (both pages).
//
// AI is used ONLY when one of the buttons that call this is clicked. One
// request per name (three at a time), one progress line, a Stop button. The
// route validates and files each answer; this hook mirrors it into the page's
// state through `applyAiType`, and counts what happened.

import { useCallback, useRef, useState } from 'react';
import { aiTypeInputIndia, aiTypeInputUs, isAiTypeRecord, type AiTypeRecord } from './ai-type';

export type ResolvePhase = 'idle' | 'types' | 'details' | 'done';
export interface AiTypeRun {
  running: boolean; phase: ResolvePhase; done: number; total: number;
  set: number; undecided: number; failed: number; skipped: number;
  detailsFilled: number; stillIncomplete: number;
  summary: string | null; stopped: boolean;
}
const EMPTY: AiTypeRun = { running: false, phase: 'idle', done: 0, total: 0, set: 0, undecided: 0, failed: 0, skipped: 0, detailsFilled: 0, stillIncomplete: 0, summary: null, stopped: false };

/** "types set: X · undecided: Y · details filled: Z · still incomplete: W" */
export function resolveSummary(r: Pick<AiTypeRun, 'set' | 'undecided' | 'detailsFilled' | 'stillIncomplete' | 'failed'>): string {
  return `types set: ${r.set} · undecided: ${r.undecided} · details filled: ${r.detailsFilled} · still incomplete: ${r.stillIncomplete}${r.failed ? ` · AI calls that failed: ${r.failed}` : ''}`;
}

export function useAiTypeResolver(o: {
  market: 'IN' | 'US';
  getRow: (sym: string) => any | null;
  applyAiType: (sym: string, rec: AiTypeRecord) => boolean;
}) {
  const [run, setRun] = useState<AiTypeRun>(EMPTY);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const stopRef = useRef(false);
  const oRef = useRef(o); oRef.current = o;

  /** One name. Returns what happened; never throws. */
  const one = useCallback(async (sym: string, force = false): Promise<'set' | 'undecided' | 'skipped' | 'failed'> => {
    const row = oRef.current.getRow(sym);
    if (!row) return 'skipped';
    setBusy((b) => ({ ...b, [sym]: true }));
    setErrors((e) => { const n = { ...e }; delete n[sym]; return n; });
    try {
      const market = oRef.current.market;
      const input = market === 'US' ? aiTypeInputUs(row) : aiTypeInputIndia(row);
      const r = await fetch('/api/v1/thesis-ai/type', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ market, input, force }), signal: AbortSignal.timeout(55_000),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { setErrors((e) => ({ ...e, [sym]: String(j?.error || `HTTP ${r.status}`) })); return 'failed'; }
      if (j.skipped === 'user' || !j.record) return 'skipped';
      const applied = oRef.current.applyAiType(sym, j.record as AiTypeRecord);
      if (!applied) return 'skipped';
      return isAiTypeRecord(j.record) ? 'set' : 'undecided';
    } catch (e: any) {
      setErrors((x) => ({ ...x, [sym]: String(e?.message || e).slice(0, 120) }));
      return 'failed';
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[sym]; return n; });
    }
  }, []);

  /** Many names, three at a time. Resolves with the counts. */
  const many = useCallback(async (syms: string[], onProgress?: (d: number, t: number) => void, concurrency = 3) => {
    const c = { set: 0, undecided: 0, failed: 0, skipped: 0 };
    let i = 0, done = 0;
    const worker = async () => {
      while (!stopRef.current) {
        const k = i++;
        if (k >= syms.length) return;
        c[await one(syms[k])]++;
        done++;
        onProgress?.(done, syms.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, syms.length) }, worker));
    return c;
  }, [one]);

  /** The "✨ Let AI choose types" button. */
  const runTypes = useCallback(async (syms: string[]) => {
    if (!syms.length) return;
    stopRef.current = false;
    setRun({ ...EMPTY, running: true, phase: 'types', total: syms.length });
    const c = await many(syms, (d, t) => setRun((r) => ({ ...r, done: d, total: t, set: r.set, })));
    setRun((r) => ({ ...r, ...c, running: false, phase: 'done', stopped: stopRef.current, summary: `types set: ${c.set} · undecided: ${c.undecided}${c.failed ? ` · AI calls that failed: ${c.failed}` : ''}` }));
  }, [many]);

  /** "✨ Resolve everything": types first, then the existing missing-details fill. */
  const resolveAll = useCallback(async (p: {
    typeSyms: string[];
    /** Names with missing details, read AFTER the types are set (statuses change). */
    gapSyms: () => string[];
    /** The existing gap fill (bulk AI read); resolves when it ends. */
    fillGaps: (syms: string[]) => Promise<void>;
    /** Missing-detail count of one name right now. */
    gapsOf: (sym: string) => number;
    /** Names still incomplete right now. */
    stillIncomplete: () => number;
  }) => {
    stopRef.current = false;
    setRun({ ...EMPTY, running: true, phase: 'types', total: p.typeSyms.length });
    const c = p.typeSyms.length ? await many(p.typeSyms, (d, t) => setRun((r) => ({ ...r, done: d, total: t }))) : { set: 0, undecided: 0, failed: 0, skipped: 0 };
    let filled = 0;
    if (!stopRef.current) {
      await new Promise((r) => setTimeout(r, 400)); // let the rows re-assess with their new types
      const gaps = p.gapSyms();
      if (gaps.length) {
        const before: Record<string, number> = {};
        for (const s of gaps) before[s] = p.gapsOf(s);
        setRun((r) => ({ ...r, phase: 'details', ...c, done: 0, total: gaps.length }));
        await p.fillGaps(gaps);
        await new Promise((r) => setTimeout(r, 500));
        for (const s of gaps) if (p.gapsOf(s) < before[s]) filled++;
      }
    }
    const still = p.stillIncomplete();
    const fin = { ...c, detailsFilled: filled, stillIncomplete: still };
    setRun((r) => ({ ...r, ...fin, running: false, phase: 'done', stopped: stopRef.current, summary: resolveSummary(fin) }));
  }, [many]);

  const stop = useCallback(() => { stopRef.current = true; }, []);
  return { run, busy, errors, one, runTypes, resolveAll, stop };
}
