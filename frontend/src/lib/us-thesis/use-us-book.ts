// ═══════════════════════════════════════════════════════════════════════════
// ONE READER FOR THE US BOOK.                              (zzz790 → zzz793)
//
// The US twin of lib/thesis/use-book. Stages, each additive, each labelled:
//   1. the universe  — /api/v1/us-book?view=universe: tickers, origin and
//                      listing ONLY (no quantity, cost or price), plus the
//                      US Conviction Beats bench (server /api/v1/bench-us +
//                      this browser's US bench) — tickers and venue only,
//                      de-duplicated against the holdings, labelled
//                      "Conviction Beats (US)";
//   2. grader rows   — /api/v1/us-thesis/facts: strict XBRL figures and the
//                      SEC profile (no model); the automatic thesis type is
//                      India's exact / nearest fit, else the US nearest fit
//                      from the company's own SEC data (provisional);
//   3. the ledgers   — /api/v1/us-thesis/evidence: what was read before.
// Reads, checks and the prior-quarter backfill run only on a click.
//
// zzz793 — EVERY READ ENDS. Each read has its own AbortController and a
// client deadline; Stop aborts every read in flight at once; a card always
// lands in a terminal state (read / failed with the reason / no document),
// never "Reading…" forever. A response for another ticker is never applied.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readJson, humanError } from '@/lib/thesis/safe-json';
import { classifyWithFiling, type AbfgPattern } from '@/lib/earnings/pattern-abfg';
import { recordPromises } from '@/lib/thesis/guidance-ledger';
import { whatChanged, type CompanyLedger } from '@/lib/thesis/evidence-ledger';
import { previousPeriod } from '@/lib/thesis/prior-period';
import { evidenceReadLine, changesNote } from '@/lib/thesis/evidence-counts';
import { assessUsRow, applyUsLedger, newUsRow, usPromiseKey, autoPattern, type UsRow } from './assess';
import { usFreshness } from './calendar';
import { usTickerKey } from './sanitize';
import type { UsUniverseEntry } from '@/lib/us-book/model';

export type { UsRow } from './assess';

type Batch = { running: boolean; done: number; total: number; resumable?: number; failed?: number; stopped?: boolean; retrying?: number };

/** A read that has not answered in this long is ended on the card (the
 *  server's own budget is 180 s; most reads take 20–60 s). */
export const US_READ_DEADLINE_MS = 170_000;
export const US_CB_SOURCE = 'Conviction Beats (US)';

/** Pure: the US Conviction Beats names to add to the bench — tickers not
 *  already in the universe, US venue only, de-duplicated. */
export function convictionBenchAdds(universe: Array<{ ticker: string }>, cb: Array<{ ticker: string; exchange?: string | null }>): Array<{ ticker: string; exchange: string }> {
  const have = new Set(universe.map((u) => usTickerKey(u.ticker)));
  const out = new Map<string, { ticker: string; exchange: string }>();
  for (const e of cb) {
    const t = usTickerKey(String(e?.ticker || '').split('@')[0]);
    if (!t || !/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(t) || have.has(t) || out.has(t)) continue;
    out.set(t, { ticker: t, exchange: String(e?.exchange || '') });
  }
  return Array.from(out.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** The US Conviction Beats bench: the server copy and this browser's. */
async function loadUsConvictionBench(): Promise<Array<{ ticker: string; exchange?: string | null }>> {
  const out: Array<{ ticker: string; exchange?: string | null }> = [];
  try {
    const j = await readJson(await fetch('/api/v1/bench-us', { cache: 'no-store' }));
    for (const e of Array.isArray(j?.entries) ? j.entries : []) if (e?.ticker) out.push({ ticker: String(e.ticker), exchange: e.exchange ?? null });
  } catch { /* the local bench still counts */ }
  try {
    const m = await import('@/lib/conviction-beats-us');
    await m.hydrateUsConviction().catch(() => 0);
    for (const [k, e] of Object.entries(m.readUsConviction())) out.push({ ticker: String((e as any)?.ticker || k), exchange: (e as any)?.exchange ?? null });
  } catch { /* no local bench in this browser */ }
  return out;
}

export function useUsBook() {
  const [rows, setRows] = useState<Record<string, UsRow>>({});
  const [excluded, setExcluded] = useState<UsUniverseEntry[]>([]);
  const [universeError, setUniverseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [batch, setBatch] = useState<Batch>({ running: false, done: 0, total: 0 });
  const [priorBatch, setPriorBatch] = useState<Batch>({ running: false, done: 0, total: 0 });
  const [checkBatch, setCheckBatch] = useState<{ running: boolean; done: number; total: number; found: number }>({ running: false, done: 0, total: 0, found: 0 });
  const [thesisTypes, setThesisTypes] = useState<Record<string, AbfgPattern>>({});
  const [cbCount, setCbCount] = useState<number>(0);
  const rowsRef = useRef<Record<string, UsRow>>({});
  const typesRef = useRef<Record<string, AbfgPattern>>({});
  const stopRef = useRef(false);
  const inflight = useRef<Map<string, AbortController>>(new Map());
  // rowsRef is the source of truth for every write (commit / put); it is
  // never overwritten from a render snapshot, which could drop a newer put.

  const commit = (next: Record<string, UsRow>) => { rowsRef.current = next; setRows(next); };
  const put = (sym: string, r: UsRow) => { rowsRef.current = { ...rowsRef.current, [sym]: r }; setRows(rowsRef.current); };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // thesis types first, so the first paint already honours them
      try {
        const j = await readJson(await fetch('/api/v1/us-thesis/evidence?thesis_types=1', { cache: 'no-store' }));
        typesRef.current = (j?.thesis_types || {}) as Record<string, AbfgPattern>;
        if (!cancelled) setThesisTypes(typesRef.current);
      } catch { /* automatic classification stands */ }

      // ── STAGE 1 — the universe (no price in it) + US Conviction Beats
      let uni: UsUniverseEntry[] = [];
      try {
        const r = await fetch('/api/v1/us-book?view=universe', { cache: 'no-store' });
        const j = await readJson(r);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        uni = Array.isArray(j.universe) ? j.universe : [];
      } catch (e: any) {
        if (!cancelled) { setUniverseError(humanError(e)); setLoading(false); setEvidenceLoading(false); }
        return;
      }
      if (cancelled) return;
      const cb = await loadUsConvictionBench();
      if (cancelled) return;
      const cbSet = new Set(cb.map((e) => usTickerKey(String(e.ticker).split('@')[0])));
      const adds = convictionBenchAdds(uni, cb);
      setCbCount(cbSet.size);
      const us = uni.filter((u) => u.listing === 'US');
      setExcluded(uni.filter((u) => u.listing !== 'US'));
      const first: Record<string, UsRow> = {};
      for (const u of us) {
        const onCb = cbSet.has(usTickerKey(u.ticker));
        first[u.ticker] = { ...newUsRow(u.ticker, u.origin, null, null, u.exchange), benchSource: u.origin === 'book' ? (onCb ? US_CB_SOURCE : null) : onCb ? US_CB_SOURCE : 'US bench (your list)' };
      }
      for (const a of adds) first[a.ticker] = { ...newUsRow(a.ticker, 'bench', null, null, a.exchange), benchSource: US_CB_SOURCE };
      commit(first);
      setLoading(false);

      // ── STAGE 2 — deterministic XBRL grader rows + SEC profiles
      const tickers = Object.keys(first);
      const facts: Record<string, any> = {};
      for (let i = 0; i < tickers.length && !cancelled; i += 20) {
        try {
          const j = await readJson(await fetch(`/api/v1/us-thesis/facts?tickers=${encodeURIComponent(tickers.slice(i, i + 20).join(','))}`, { cache: 'no-store' }));
          Object.assign(facts, j?.rows || {});
        } catch { /* the card says no grader row */ }
      }
      if (cancelled) return;
      {
        const next: Record<string, UsRow> = { ...rowsRef.current };
        for (const t of tickers) {
          const f = facts[t];
          const g = f && f.source === 'sec-xbrl' ? f : null;
          const sec = f && 'us_profile' in f ? (f.us_profile || null) : undefined;
          const prev = next[t];
          next[t] = assessUsRow({ ...prev, graded: g, gradedWhy: g ? null : (f?.why || 'no XBRL row'), dataSource: g ? 'sec-xbrl' : 'none',
            ...(sec !== undefined ? { sec } : {}),
            pattern: autoPattern(g, sec), sourceUrl: prev.sourceUrl || g?.source_url || null }, typesRef.current);
        }
        commit(next);
      }

      // ── STAGE 3 — the ledgers
      try {
        const ledgers: Record<string, CompanyLedger> = {};
        const fresh: Record<string, any> = {};
        let bi: any = null, pi: any = null;
        for (let i = 0; i < tickers.length; i += 100) {
          const j = await readJson(await fetch(`/api/v1/us-thesis/evidence?tickers=${encodeURIComponent(tickers.slice(i, i + 100).join(','))}`, { cache: 'no-store' }));
          Object.assign(ledgers, j?.ledgers || {});
          Object.assign(fresh, j?.freshness || {});
          if (j?.batch) bi = j.batch;
          if (j?.prior_batch) pi = j.prior_batch;
        }
        if (cancelled) return;
        const next: Record<string, UsRow> = { ...rowsRef.current };
        const toPost: UsRow[] = [];
        for (const t of tickers) {
          const l = ledgers[t] || null;
          if (!l && !fresh[t]) continue;
          next[t] = applyUsLedger(next[t], l, typesRef.current, fresh[t] || null);
          const p = next[t].ledger && next[t].ledger!.latest_period ? next[t].ledger!.periods[next[t].ledger!.latest_period!] : null;
          if (p && !p.status && next[t].assessment) toPost.push(next[t]);
        }
        commit(next);
        if (bi) setBatch({ running: false, done: bi.done + bi.skipped + bi.failed, total: bi.tickers.length, resumable: bi.finished_at ? 0 : bi.remaining, failed: bi.failed });
        if (pi) setPriorBatch({ running: false, done: pi.done + pi.skipped + pi.failed, total: pi.tickers.length, resumable: pi.finished_at ? 0 : pi.remaining, failed: pi.failed });
        for (const r of toPost.slice(0, 60)) { if (cancelled) break; await postStatus(r); }
      } catch { /* cards say NEVER READ */ }
      finally { if (!cancelled) setEvidenceLoading(false); }
    })();
    return () => { cancelled = true; for (const c of Array.from(inflight.current.values())) c.abort(); };
  }, []);

  const readFiling = useCallback(async (sym: string, mode: 'incremental' | 'read' | 'force' | 'check' | 'prior' = 'incremental') => {
    const cur = rowsRef.current[sym];
    if (!cur) return;
    if (mode !== 'check') put(sym, { ...cur, state: 'loading', error: undefined, readNote: mode === 'prior' ? `Reading ${previousPeriod(cur.ledger?.latest_period) || 'the prior quarter'}…` : null });
    else put(sym, { ...cur, readNote: 'checking EDGAR…' });
    const ctl = new AbortController();
    inflight.current.get(sym)?.abort();
    inflight.current.set(sym, ctl);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, US_READ_DEADLINE_MS);
    try {
      const q = mode === 'force' ? 'mode=read&force=1' : `mode=${mode}`;
      const res = await fetch(`/api/v1/us-thesis/read?ticker=${encodeURIComponent(sym)}&${q}`, { cache: 'no-store', signal: ctl.signal });
      const j = await readJson(res);
      const prev = rowsRef.current[sym];
      // A response that names another company is never applied to this card.
      const other = (j?.ticker && usTickerKey(j.ticker) !== usTickerKey(sym)) || (j?.ledger?.ticker && usTickerKey(j.ledger.ticker) !== usTickerKey(sym));
      if (other) {
        put(sym, { ...prev, state: prev.summary ? 'done' : 'error', error: prev.summary ? undefined : 'The server answered for a different company — the answer was not applied. Read again.', readNote: prev.summary ? 'A response for a different company was ignored; evidence on file stands.' : null });
        return;
      }
      if (mode === 'check') {
        const ledger: CompanyLedger | null = j?.ledger || prev.ledger || null;
        const unseen: any[] = Array.isArray(j?.unseen_documents) ? j.unseen_documents : [];
        const note = j?.ok
          ? (j.new_evidence ? `New SEC filing found: ${(unseen.length ? unseen : (j.candidates || [])).slice(0, 2).map((c: any) => c.label).join('; ')} — not read yet (no model was called)` : 'No newer SEC filing. Evidence remains current.')
          : `Check failed: ${j?.error || res.status}`;
        put(sym, { ...prev, ledger, freshness: j?.freshness || usFreshness(ledger), readNote: note });
        return;
      }
      if (j?.skipped === 'SKIPPED_NO_NEW_EVIDENCE') {
        const next = j.ledger ? applyUsLedger(prev, j.ledger, typesRef.current) : prev;
        put(sym, { ...next, state: next.summary ? 'done' : 'idle', readNote: j.note || 'No newer SEC filing — evidence remains current.' });
        return;
      }
      if (!j?.ok || !j.structured) {
        const ledger: CompanyLedger | null = j?.ledger || prev.ledger || null;
        const keep = !!prev.summary;
        const failure = j?.error || (res.ok ? 'No readable SEC document for this company.' : `The read did not finish (HTTP ${res.status}) — nothing was saved. Read again.`);
        const base = ledger ? applyUsLedger({ ...prev, discoveryAttempts: j?.discovery_attempts || prev.discoveryAttempts, discoveryState: j?.state || prev.discoveryState }, ledger, typesRef.current) : prev;
        put(sym, { ...base, state: keep ? 'done' : 'error', error: keep ? undefined : failure,
          readNote: keep ? `Latest read found nothing usable (${failure}) — evidence on file stands.` : null, persisted: j?.persisted ?? null });
        return;
      }
      const ledger: CompanyLedger | null = j.ledger || null;
      const landed = !!ledger && !!ledger.latest_period && j.persisted !== false;
      const note = j.from_ledger ? 'Loaded from the US evidence ledger — no new read.'
        : j.persisted === false ? `Read ${(j.documents_read || []).length} SEC document(s) but the save FAILED: ${j.persist_error || 'unknown'} — this will not survive a reload.`
          : [evidenceReadLine(ledger), changesNote(j.changes)].filter(Boolean).join(' · ');
      const next = landed
        ? { ...applyUsLedger(prev, ledger, typesRef.current), readNote: note }
        : assessUsRow({ ...prev, summary: j.structured, state: 'done', documentsRead: j.documents_read, discoveryAttempts: j.discovery_attempts, documentOutcomes: j.document_outcomes,
            pattern: classifyWithFiling(prev.graded, j.structured) || prev.pattern, ledger: ledger || prev.ledger || null,
            freshness: usFreshness(ledger || prev.ledger || null), reportingPeriod: j.reporting_period || prev.reportingPeriod || null,
            changed: ledger ? whatChanged(ledger).lines : prev.changed, persisted: j.persisted ?? null, persistError: j.persist_error || null, readNote: note }, typesRef.current);
      put(sym, { ...next, state: next.state === 'loading' ? 'done' : next.state });
      if (mode !== 'prior') { try { recordPromises(usPromiseKey(sym), j.structured, j.source_url || null); } catch { /* best effort */ } }
      const pr = next.ledger && next.reportingPeriod ? next.ledger.periods[next.reportingPeriod] : null;
      if (!j.from_ledger || (pr && !pr.status)) void postStatus(next);
    } catch (e: any) {
      const prev = rowsRef.current[sym];
      const why = timedOut ? `The read did not answer within ${Math.round(US_READ_DEADLINE_MS / 1000)} s — stopped; nothing new was saved. Read again later.`
        : ctl.signal.aborted ? 'Stopped by you — this name was not read.'
          : humanError(e);
      put(sym, { ...prev, state: prev.summary ? 'done' : 'error', error: prev.summary ? undefined : why, readNote: prev.summary ? `Read ended: ${why} Evidence on file stands.` : null });
    } finally {
      clearTimeout(timer);
      if (inflight.current.get(sym) === ctl) inflight.current.delete(sym);
      // A card never stays "Reading…": whatever happened above, it ends.
      const r = rowsRef.current[sym];
      if (r && r.state === 'loading') put(sym, { ...r, state: r.summary ? 'done' : 'error', error: r.summary ? undefined : 'The read ended without an answer — nothing was saved. Read again.' });
    }
  }, []);

  const runPool = async (todo: string[], fn: (s: string) => Promise<void>, onDone: (n: number) => void, concurrency = 2) => {
    let i = 0, done = 0;
    const worker = async () => {
      while (!stopRef.current) {
        const k = i++;
        if (k >= todo.length) return;
        try { await fn(todo[k]); } catch { /* recorded on the row */ }
        onDone(++done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    return done;
  };

  const readAll = useCallback(async (syms: string[], opts?: { reprocess?: boolean }) => {
    const todo = syms.filter((s) => {
      const r = rowsRef.current[s];
      if (!r || r.state === 'loading') return false;
      if (opts?.reprocess || !r.summary) return true;
      const es = r.freshness?.evidence_state;
      return r.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' || r.freshness?.state === 'STALE' || es === 'NEW_EVIDENCE_AVAILABLE' || es === 'STALE' || es === 'RETRIEVAL_FAILED' || es === 'SOURCE_UNAVAILABLE';
    });
    if (!todo.length) return;
    stopRef.current = false;
    setBatch({ running: true, done: 0, total: todo.length });
    try { await fetch('/api/v1/us-thesis/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_start', tickers: todo }) }); } catch { /* ledgers still persist */ }
    let done = 0;
    try {
      done = await runPool(todo, (s) => readFiling(s, opts?.reprocess ? 'force' : 'incremental'), (n) => setBatch((b) => (b.running ? { ...b, done: n } : b)));
      // zzz793: a failed read is retried ONCE (EDGAR throttling and timeouts
      // are usually transient); a second failure stays on the card with its reason.
      const failed = stopRef.current ? [] : todo.filter((s) => rowsRef.current[s]?.state === 'error');
      if (failed.length) {
        setBatch((b) => (b.running ? { ...b, retrying: failed.length } : b));
        await runPool(failed, (s) => readFiling(s, opts?.reprocess ? 'force' : 'read'), () => undefined);
      }
    } finally {
      const stopped = stopRef.current;
      setBatch((b) => ({ ...b, running: false, done: Math.max(b.done, done), stopped, resumable: stopped ? Math.max(0, todo.length - done) : 0 }));
    }
    if (!stopRef.current) { try { await fetch('/api/v1/us-thesis/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_finish' }) }); } catch { /* see above */ } }
  }, [readFiling]);

  const checkAll = useCallback(async (syms: string[]) => {
    const todo = syms.filter((s) => !!rowsRef.current[s] && rowsRef.current[s].state !== 'loading');
    if (!todo.length) return;
    stopRef.current = false;
    setCheckBatch({ running: true, done: 0, total: todo.length, found: 0 });
    try {
      await runPool(todo, (s) => readFiling(s, 'check'), (n) => {
        const found = todo.filter((t) => rowsRef.current[t]?.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' || rowsRef.current[t]?.freshness?.evidence_state === 'NEW_EVIDENCE_AVAILABLE').length;
        setCheckBatch((b) => ({ ...b, done: n, found }));
      }, 2);
    } finally { setCheckBatch((b) => ({ ...b, running: false })); }
  }, [readFiling]);

  /** The quarter before the latest on file, for names that have only one period. */
  const needsPrior = (r: UsRow | undefined) => !!r?.ledger?.latest_period && Object.keys(r.ledger.periods || {}).length <= 1 && !!previousPeriod(r.ledger.latest_period);
  const readPriorPeriods = useCallback(async (syms: string[]) => {
    const todo = syms.filter((s) => needsPrior(rowsRef.current[s]) && rowsRef.current[s].state !== 'loading');
    if (!todo.length) return;
    stopRef.current = false;
    setPriorBatch({ running: true, done: 0, total: todo.length });
    try { await fetch('/api/v1/us-thesis/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_start', kind: 'prior', tickers: todo }) }); } catch { /* noop */ }
    let done = 0;
    try { done = await runPool(todo, (s) => readFiling(s, 'prior'), (n) => setPriorBatch((b) => (b.running ? { ...b, done: n } : b))); }
    finally {
      const stopped = stopRef.current;
      setPriorBatch((b) => ({ ...b, running: false, done: Math.max(b.done, done), stopped, resumable: stopped ? Math.max(0, todo.length - done) : 0 }));
    }
    if (!stopRef.current) { try { await fetch('/api/v1/us-thesis/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'batch_finish', kind: 'prior' }) }); } catch { /* noop */ } }
  }, [readFiling]);

  /** Stop means stop: no new read starts, every read in flight is aborted
   *  now (its card says "stopped by you"), and the progress line ends. */
  const stop = useCallback(() => {
    stopRef.current = true;
    for (const c of Array.from(inflight.current.values())) c.abort();
    setBatch((b) => (b.running ? { ...b, running: false, stopped: true } : b));
    setPriorBatch((b) => (b.running ? { ...b, running: false, stopped: true } : b));
    setCheckBatch((b) => (b.running ? { ...b, running: false } : b));
  }, []);

  const setThesisType = useCallback(async (sym: string, p: AbfgPattern | null) => {
    const key = sym.toUpperCase();
    const map = { ...typesRef.current };
    if (p) map[key] = p; else delete map[key];
    typesRef.current = map;
    setThesisTypes(map);
    const cur = rowsRef.current[sym];
    if (cur) put(sym, assessUsRow(p ? cur : { ...cur, pattern: autoPattern(cur.graded, cur.sec) }, map));
    try { await fetch('/api/v1/us-thesis/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'thesis_type', ticker: key, pattern: p }) }); } catch { /* kept for this session */ }
  }, []);

  return { rows, excluded, universeError, loading, evidenceLoading, batch, priorBatch, checkBatch, readFiling, readAll, checkAll, readPriorPeriods, stop, thesisTypes, setThesisType, needsPrior, cbCount };
}

async function postStatus(row: UsRow): Promise<void> {
  const a = row.assessment;
  if (!a || !row.reportingPeriod) return;
  try {
    await fetch('/api/v1/us-thesis/evidence', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'status', ticker: row.symbol, period: row.reportingPeriod, status: a.status, because: a.because,
        tallies: { mechanism: (a.coverage as any)?.mechanism, output: (a.coverage as any)?.output, forward: (a.coverage as any)?.forward } }),
    });
  } catch { /* history is best-effort */ }
}
