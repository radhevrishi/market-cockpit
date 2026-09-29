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
// zzz815 — stages 2 and 3 run in PARALLEL and render PROGRESSIVELY: the
// ledgers (a fast KV read) and the XBRL figures in batches of 15, three in
// flight, book first, each batch applied as it lands. A name is NOT assessed
// until its figures are in ("loading SEC figures…"); a failed SEC request is
// retried twice ("SEC request failed — retrying"), then offered as a Retry.
// Stage 4 fills structural rows READ WITHOUT AI (lib/us-thesis/det-evidence),
// a few names at a time, book first; the AI read stays on click.
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
import { isAiTypeRecord, type AiTypeRecord } from '@/lib/thesis/ai-type';
import { applyAiRecord } from '@/lib/thesis/ai-type-store';
import { US_AI_RECORDS, assessUsRow, applyUsLedger, newUsRow, usPromiseKey, autoPattern, usFiguresSettled, type UsRow } from './assess';
import { usDetQueue, type UsDetEvidence } from './det-evidence';
import { normalizeUsTicker } from '@/lib/us-book/import';
import { usFreshness } from './calendar';
import { usTickerKey } from './sanitize';
import type { UsUniverseEntry } from '@/lib/us-book/model';
import { type UsBenchName } from './us-bench';
import { selectUsCb, type CbCriteriaInfo, type CbSelection } from '@/lib/thesis/pc-bench';

export type { UsRow } from './assess';

type Batch = { running: boolean; done: number; total: number; resumable?: number; failed?: number; stopped?: boolean; retrying?: number };

/** A read that has not answered in this long is ended on the card (the
 *  server's own budget is 180 s; most reads take 20–60 s). */
export const US_READ_DEADLINE_MS = 170_000;
export const US_CB_SOURCE = 'Conviction Beats (US)';

/** zzz815: names per /facts request, requests in flight at once, retry pauses. */
export const US_FACTS_BATCH = 15;
export const US_FACTS_PARALLEL = 3;
export const US_FACTS_RETRY_DELAYS = [2_000, 6_000];
const US_FACTS_CLIENT_MS = 58_000;

/** The honest per-name failure words ("SEC request failed — retrying"). */
export function usFiguresFailNote(why: string | null | undefined, final: boolean): string {
  const w = String(why || '').replace(/^SEC request failed — retrying \(([^)]*)\).*$/, '$1').trim();
  return final
    ? `SEC request failed${w ? ` (${w})` : ''} — not a finding about the company. Retry below.`
    : `SEC request failed${w ? ` (${w})` : ''} — retrying`;
}

/**
 * Pure (zzz815): one /facts answer → the row. A retrieval failure (or no
 * answer at all) leaves the row NOT assessed and says so; a row or a stated
 * absence settles it and it is assessed — with its stored ledger when given.
 */
export function usFactsToRow(prev: UsRow, f: any | undefined, types: Record<string, AbfgPattern>, final: boolean,
  ledger?: { ledger: CompanyLedger | null; fresh: any | null } | null): UsRow {
  const attempts = (prev.figures?.attempts || 0) + 1;
  if (!f || f.retrieval_failed) {
    const note = usFiguresFailNote(f?.why || 'no answer from the server', final);
    return { ...prev, assessment: null, figures: { state: final ? 'failed' : 'retrying', note, attempts } };
  }
  const g = f.source === 'sec-xbrl' ? f : null;
  const sec = 'us_profile' in f ? (f.us_profile || null) : null;
  const base: UsRow = {
    ...prev, graded: g, gradedWhy: g ? null : (f.why || 'no quarterly figures in SEC XBRL'), dataSource: g ? 'sec-xbrl' : 'none', sec,
    pattern: autoPattern(g, sec), sourceUrl: prev.sourceUrl || g?.source_url || null,
    figures: { state: g ? 'ok' : 'none', note: g ? null : (f.why || null), attempts, noFiler: !!f.no_filer },
  };
  const keepState = prev.state === 'loading' ? { state: 'loading' as const } : {};
  const l = ledger && (ledger.ledger || ledger.fresh) ? ledger : null;
  const out = l ? applyUsLedger(base, l.ledger, types, l.fresh || null) : prev.ledger ? applyUsLedger(base, prev.ledger, types, prev.freshness || null) : assessUsRow(base, types);
  return { ...out, ...keepState };
}

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

/** zzz797: where the bench came from, for the header and the empty state. */
export interface UsCbInfo {
  /** names on the US Conviction Beats list after removals (before de-dup against holdings) */
  total: number;
  server: number;
  local: number;
  localOnly: number;
  removed: number;
  updatedAt: string | null;
  serverSource: 'kv' | 'rebuilt' | 'empty' | null;
  serverNote: string | null;
  serverError: string | null;
}

/**
 * zzz811 — the US Conviction Beats page's OWN list under the owner's OWN
 * criteria, in the page's own source order: this browser's bench (IndexedDB,
 * hydrated) after the server bench is merged into it (mergeServerUsBench —
 * exactly what the page does on open), filtered by passesUsConvictionFilter
 * with his saved filters (usCbFiltersForOwner). If this browser holds no
 * list at all (a fresh phone), the server bench is used directly.
 * Membership only: the criteria may read price to CHOOSE names; the thesis
 * engine still reads no price.
 */
/** zzz828: the whole selection ends — a hung browser database or server
 *  answer becomes "not available", never "loading…" for ever. */
export const US_CB_SELECTION_DEADLINE_MS = 45_000;

/** What the US Conviction Beats page shows beyond the selection itself: the
 *  per-ticker "now MIXED under current rules" labels, company names (decoded)
 *  and how many names are still on an older grading engine. */
export interface UsCbExtras { nowTier: Record<string, string>; companies: Record<string, string>; staleEngine: number }

export function emptyCbSelection(): CbSelection {
  return { listTotal: 0, passing: [], unknown: [], failing: [], bench: [], benchFailing: [], heldPassing: [], labels: {}, companies: {} };
}

async function loadUsCbSelection(held: string[]): Promise<{ sel: CbSelection; info: CbCriteriaInfo; extras: UsCbExtras }> {
  let timer: any = null;
  const deadline = new Promise<{ sel: CbSelection; info: CbCriteriaInfo; extras: UsCbExtras }>((res) => {
    timer = setTimeout(() => res({
      sel: emptyCbSelection(), extras: { nowTier: {}, companies: {}, staleEngine: 0 },
      info: { market: 'US', listTotal: 0, passing: 0, failing: 0, heldPassing: 0, unknown: 0, criteria: 'not available', source: 'not available', error: `the US Conviction Beats list did not load within ${US_CB_SELECTION_DEADLINE_MS / 1000}s — not available this time (reload to try again)` },
    }), US_CB_SELECTION_DEADLINE_MS);
  });
  try { return await Promise.race([loadUsCbSelection0(held), deadline]); } finally { clearTimeout(timer); }
}

async function loadUsCbSelection0(held: string[]): Promise<{ sel: CbSelection; info: CbCriteriaInfo; extras: UsCbExtras }> {
  const m = await import('@/lib/conviction-beats-us');
  const { decodeHTMLEntities } = await import('@/lib/html-decode');
  let error: string | null = null;
  try { await m.hydrateUsConviction(); } catch { /* memory-only */ }
  let merged: { server_count: number; updatedAt: string | null; stale_engine: boolean } | null = null;
  try { merged = await m.mergeServerUsBench(); } catch (e: any) { error = humanError(e); }
  let list: any[] = m.getUsConvictionList();
  let source = `this browser's US bench ${list.length} (server bench ${merged?.server_count ?? 0} merged in${merged?.updatedAt ? `, updated ${String(merged.updatedAt).slice(0, 10)}` : ''}${merged?.stale_engine ? '; server list built by an older engine — not merged' : ''})`;
  if (!list.length) {
    try {
      const j = await readJson(await fetch('/api/v1/bench-us', { cache: 'no-store', signal: AbortSignal.timeout(20_000) }));
      const removed = new Set(m.readUsConvictionBin().map((e: any) => String(e?.ticker || '').toUpperCase()));
      list = (Array.isArray(j?.entries) ? j.entries : []).filter((e: any) => !removed.has(String(e?.ticker || '').toUpperCase()));
      source = `server bench ${list.length} (this browser holds no US list)`;
    } catch (e: any) { error = humanError(e); }
  }
  const get = (k: string) => { try { return typeof window === 'undefined' ? null : window.localStorage.getItem(k); } catch { return null; } };
  const filters = m.usCbFiltersForOwner(get);
  const win = m.computeUsNewWindow(list);
  const criteriaOff = !m.isUsPresetActive(filters) && get(m.US_CB_OPTOUT_KEY) === '1'
    && [filters.sales, filters.eps, filters.pead, filters.opmDelta, filters.cfoPatMin, filters.mktCapMin].every((v) => v == null)
    && !(filters.verdicts && filters.verdicts.length) && (!filters.cap || filters.cap === 'all');
  // zzz823: pass / fail / NOT CHECKED — the same shared check the US
  // Conviction Beats page applies (a missing figure is never a fail).
  const sel = selectUsCb({
    held, list, key: usTickerKey, criteriaOff,
    check: (e: any) => m.usCbCriteriaCheck(e, filters, win),
  });
  const criteria = m.isUsPresetActive(filters)
    ? `your US quality preset${filters.cap === 'smid' ? ' + small/mid caps' : ''}, incl. price above its 50- and 200-day averages`
    : criteriaOff ? 'your US preset is switched OFF on US Conviction Beats — every name is listed' : 'your saved US Conviction Beats filters';
  // zzz828: labels the page shows beside each name.
  const extras: UsCbExtras = { nowTier: {}, companies: {}, staleEngine: 0 };
  for (const e of list) {
    const t = usTickerKey(String(e?.ticker || '').split('@')[0]);
    if (!t) continue;
    if (e?.company && !extras.companies[t]) extras.companies[t] = decodeHTMLEntities(String(e.company));
    const nt = m.usNowTierText(e);
    if (nt && !String(e?.bench_key || '').includes('@')) extras.nowTier[t] = nt;
    if (m.usEngineStale(e)) extras.staleEngine++;
  }
  for (const t of Object.keys(sel.companies)) if (sel.companies[t]) sel.companies[t] = decodeHTMLEntities(sel.companies[t] as string);
  return {
    sel, extras,
    info: { market: 'US', listTotal: sel.listTotal, passing: sel.passing.length, failing: sel.failing.length, heldPassing: sel.heldPassing.length, unknown: sel.unknown.length,
      criteria: `${criteria}${filters.q ? ` (the search text "${filters.q}" is applied too)` : ''}`, source, error },
  };
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
  const [thesisAi, setThesisAi] = useState<Record<string, AiTypeRecord>>({});
  const [cbCount, setCbCount] = useState<number>(0);
  const [cbInfo, setCbInfo] = useState<UsCbInfo | null>(null);
  const [cbCriteria, setCbCriteria] = useState<CbCriteriaInfo | null>(null);
  const [cbPassing, setCbPassing] = useState<string[]>([]);
  const [cbExtras, setCbExtras] = useState<UsCbExtras | null>(null);
  // zzz823: the saved US book as read (holdings + his own bench list), for the Book check.
  const [usBook, setUsBook] = useState<{ updatedAt: string | null; universe: UsUniverseEntry[] } | null>(null);
  const rowsRef = useRef<Record<string, UsRow>>({});
  const typesRef = useRef<Record<string, AbfgPattern>>({});
  const stopRef = useRef(false);
  const inflight = useRef<Map<string, AbortController>>(new Map());
  // rowsRef is the source of truth for every write (commit / put); it is
  // never overwritten from a render snapshot, which could drop a newer put.

  const commit = (next: Record<string, UsRow>) => { rowsRef.current = next; setRows(next); };
  const put = (sym: string, r: UsRow) => { rowsRef.current = { ...rowsRef.current, [sym]: r }; setRows(rowsRef.current); };

  // zzz815: the stored ledgers, once read — applied to a row when its figures land.
  const ledgersRef = useRef<{ ledgers: Record<string, CompanyLedger>; fresh: Record<string, any> } | null>(null);
  const [detBatch, setDetBatch] = useState<{ running: boolean; done: number; total: number; found: number; failed: number }>({ running: false, done: 0, total: 0, found: 0, failed: 0 });
  const storedLedgerOf = (t: string) => {
    const L = ledgersRef.current;
    if (!L) return null;
    const l = L.ledgers[t] || null, fr = L.fresh[t] || null;
    return l || fr ? { ledger: l, fresh: fr } : null;
  };
  const withStoredLedger = (r: UsRow): UsRow => {
    const l = storedLedgerOf(r.symbol);
    if (!l || r.ledger) return r;
    const out = applyUsLedger(r, l.ledger, typesRef.current, l.fresh || null);
    return r.state === 'loading' ? { ...out, state: 'loading' } : out;
  };
  /** One pass of /facts over `list`: batches of `size`, several in flight,
   *  each applied as it lands. `final` turns a failure into 'failed'. */
  const factsPass = async (list: string[], size: number, final: boolean, stopped: () => boolean) => {
    const chunks: string[][] = [];
    for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
    let k = 0;
    const worker = async () => {
      while (k < chunks.length && !stopped()) {
        const chunk = chunks[k++];
        let rows: Record<string, any> = {};
        try {
          const res = await fetch(`/api/v1/us-thesis/facts?tickers=${encodeURIComponent(chunk.join(','))}`, { cache: 'no-store', signal: AbortSignal.timeout(US_FACTS_CLIENT_MS) });
          const j = await readJson(res);
          rows = j?.rows || {};
        } catch { rows = {}; }
        if (stopped()) return;
        const next: Record<string, UsRow> = { ...rowsRef.current };
        for (const t of chunk) {
          if (!next[t]) continue;
          const f = rows[t] ?? rows[normalizeUsTicker(t)] ?? rows[usTickerKey(t)];
          next[t] = usFactsToRow(next[t], f, typesRef.current, final, next[t].ledger ? null : storedLedgerOf(t));
        }
        commit(next);
      }
    };
    await Promise.all(Array.from({ length: Math.min(US_FACTS_PARALLEL, chunks.length) }, worker));
  };
  /** A row with its no-AI evidence attached (re-assessed only once its figures are in). */
  const withDet = (r: UsRow, det: UsDetEvidence): UsRow => {
    const x = { ...r, det };
    if (!usFiguresSettled(x) || x.summary) return x;
    const out = assessUsRow(x, typesRef.current);
    return r.state === 'loading' ? { ...out, state: 'loading' } : out;
  };
  const runDetEvidence = async (ordered: string[], stopped: () => boolean) => {
    try {
      for (let i = 0; i < ordered.length && !stopped(); i += 100) {
        const j = await readJson(await fetch(`/api/v1/us-thesis/det-evidence?tickers=${encodeURIComponent(ordered.slice(i, i + 100).join(','))}`, { cache: 'no-store', signal: AbortSignal.timeout(US_FACTS_CLIENT_MS) }));
        const recs: Record<string, UsDetEvidence> = j?.records || {};
        const next: Record<string, UsRow> = { ...rowsRef.current };
        for (const [t, rec] of Object.entries(recs)) if (next[t]) next[t] = withDet(next[t], rec);
        commit(next);
      }
    } catch { /* stored records are an optimisation; the queue below reads what is missing */ }
    const queue = usDetQueue(ordered.map((t) => rowsRef.current[t]).filter(Boolean));
    if (!queue.length || stopped()) return;
    let done = 0, found = 0, failed = 0;
    setDetBatch({ running: true, done: 0, total: queue.length, found: 0, failed: 0 });
    // Polite: two names per request, one request at a time, a pause between.
    for (let i = 0; i < queue.length && !stopped(); i += 2) {
      const chunk = queue.slice(i, i + 2);
      let recs: Record<string, UsDetEvidence> = {};
      try {
        const res = await fetch('/api/v1/us-thesis/det-evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tickers: chunk }), signal: AbortSignal.timeout(US_FACTS_CLIENT_MS) });
        recs = (await readJson(res))?.records || {};
      } catch { recs = {}; }
      if (stopped()) break;
      const next: Record<string, UsRow> = { ...rowsRef.current };
      for (const t of chunk) {
        const rec = recs[t] || recs[normalizeUsTicker(t)];
        done++;
        if (!rec) { failed++; continue; }
        if (rec.state === 'EVIDENCE_FOUND') found++;
        if (rec.state === 'RETRIEVAL_FAILED') failed++;
        if (next[t]) next[t] = withDet(next[t], rec);
      }
      commit(next);
      setDetBatch({ running: true, done, total: queue.length, found, failed });
      await new Promise((r) => setTimeout(r, 400));
    }
    setDetBatch((b) => ({ ...b, running: false }));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // thesis types first, so the first paint already honours them
      try {
        const j = await readJson(await fetch('/api/v1/us-thesis/evidence?thesis_types=1', { cache: 'no-store', signal: AbortSignal.timeout(20_000) }));
        typesRef.current = (j?.thesis_types || {}) as Record<string, AbfgPattern>;
        const aiMap = (j?.thesis_ai || {}) as Record<string, AiTypeRecord>;
        for (const k of Object.keys(US_AI_RECORDS)) delete US_AI_RECORDS[k];
        for (const [k, v] of Object.entries(aiMap)) US_AI_RECORDS[k.toUpperCase()] = v;
        if (!cancelled) { setThesisTypes(typesRef.current); setThesisAi(aiMap); }
      } catch { /* automatic classification stands */ }

      // ── STAGE 1 — the universe (no price in it) + US Conviction Beats
      let uni: UsUniverseEntry[] = [];
      try {
        const r = await fetch('/api/v1/us-book?view=universe', { cache: 'no-store', signal: AbortSignal.timeout(US_FACTS_CLIENT_MS) });
        const j = await readJson(r);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        uni = Array.isArray(j.universe) ? j.universe : [];
        if (!cancelled) setUsBook({ updatedAt: j.updatedAt || null, universe: uni });
      } catch (e: any) {
        if (!cancelled) { setUniverseError(humanError(e)); setLoading(false); setEvidenceLoading(false); }
        return;
      }
      if (cancelled) return;
      // zzz811: the bench is the US Conviction Beats page's list under his
      // own criteria (loadUsCbSelection). Names missing them join the
      // universe labelled, and the page hides them unless he asks.
      const heldTickers = uni.filter((u) => u.origin !== 'bench').map((u) => u.ticker);
      const { sel, info: crit, extras } = await loadUsCbSelection(heldTickers);
      if (cancelled) return;
      const cb: UsBenchName[] = [...sel.passing, ...sel.failing].map((t) => ({ ticker: t, tier: null, company: sel.companies[t] || null, filing_date: null, exchange: null }));
      const cbSet = new Set(cb.map((e) => e.ticker));
      const adds = convictionBenchAdds(uni, cb);
      setCbCount(sel.passing.length);
      setCbCriteria(crit);
      setCbPassing(sel.passing);
      setCbExtras(extras);
      setCbInfo({ total: sel.listTotal, server: 0, local: sel.listTotal, localOnly: 0, removed: 0, updatedAt: null, serverSource: null, serverNote: null, serverError: crit.error });
      const us = uni.filter((u) => u.listing === 'US');
      setExcluded(uni.filter((u) => u.listing !== 'US'));
      // zzz815: every row starts NOT assessed, "loading SEC figures…" — never
      // THESIS NOT SET / "no SEC filer" / NOT DISCLOSED before anything is read.
      const loadingRow = (r: UsRow): UsRow => ({ ...r, assessment: null, figures: { state: 'loading', note: null, attempts: 0 } });
      const first: Record<string, UsRow> = {};
      for (const u of us) {
        const k = usTickerKey(u.ticker);
        const onCb = cbSet.has(k);
        first[u.ticker] = loadingRow({ ...newUsRow(u.ticker, u.origin, null, null, u.exchange), benchSource: u.origin === 'book' ? (onCb ? US_CB_SOURCE : null) : onCb ? US_CB_SOURCE : 'US bench (your list)', preset: sel.labels[k] || null });
      }
      for (const a of adds) first[a.ticker] = loadingRow({ ...newUsRow(a.ticker, 'bench', null, null, a.exchange), benchSource: US_CB_SOURCE, preset: sel.labels[a.ticker] || null });
      commit(first);
      setLoading(false);

      // Book first, then the bench — the names he owns fill in first.
      const tickers = Object.keys(first);
      const ordered = [...tickers.filter((t) => first[t].origin !== 'bench').sort(), ...tickers.filter((t) => first[t].origin === 'bench').sort()];

      // ── STAGE 2 + 3, IN PARALLEL (zzz815). The ledgers are a fast KV read;
      // the XBRL figures come in batches, several at a time, and each batch
      // is applied the moment it lands (progressive). A row is assessed once
      // its figures are in, with its ledger if the ledger is already here.
      const ledgerP = (async () => {
        const ledgers: Record<string, CompanyLedger> = {};
        const fresh: Record<string, any> = {};
        let bi: any = null, pi: any = null;
        try {
          for (let i = 0; i < ordered.length && !cancelled; i += 100) {
            const j = await readJson(await fetch(`/api/v1/us-thesis/evidence?tickers=${encodeURIComponent(ordered.slice(i, i + 100).join(','))}`, { cache: 'no-store', signal: AbortSignal.timeout(US_FACTS_CLIENT_MS) }));
            Object.assign(ledgers, j?.ledgers || {});
            Object.assign(fresh, j?.freshness || {});
            if (j?.batch) bi = j.batch;
            if (j?.prior_batch) pi = j.prior_batch;
          }
        } catch { /* cards say NEVER READ */ }
        if (cancelled) return;
        ledgersRef.current = { ledgers, fresh };
        const next: Record<string, UsRow> = { ...rowsRef.current };
        for (const t of ordered) if (next[t] && usFiguresSettled(next[t])) next[t] = withStoredLedger(next[t]);
        commit(next);
        if (bi) setBatch({ running: false, done: bi.done + bi.skipped + bi.failed, total: bi.tickers.length, resumable: bi.finished_at ? 0 : bi.remaining, failed: bi.failed });
        if (pi) setPriorBatch({ running: false, done: pi.done + pi.skipped + pi.failed, total: pi.tickers.length, resumable: pi.finished_at ? 0 : pi.remaining, failed: pi.failed });
      })();
      const factsFirst = factsPass(ordered, US_FACTS_BATCH, false, () => cancelled);
      await Promise.all([ledgerP, factsFirst]);
      if (cancelled) return;
      setEvidenceLoading(false);
      {
        const toPost: UsRow[] = [];
        for (const t of ordered) {
          const r = rowsRef.current[t];
          const p = r?.ledger && r.ledger.latest_period ? r.ledger.periods[r.ledger.latest_period] : null;
          if (p && !p.status && r.assessment) toPost.push(r);
        }
        void (async () => { for (const r of toPost.slice(0, 60)) { if (cancelled) break; await postStatus(r); } })();
      }

      // ── RETRIES: a name SEC did not answer for is asked again, in small
      // batches, twice, with a pause; the card says "SEC request failed —
      // retrying" meanwhile and only then "SEC request failed" with a button.
      for (let k = 0; k < US_FACTS_RETRY_DELAYS.length && !cancelled; k++) {
        const again = ordered.filter((t) => rowsRef.current[t]?.figures?.state === 'retrying');
        if (!again.length) break;
        await new Promise((r) => setTimeout(r, US_FACTS_RETRY_DELAYS[k]));
        await factsPass(again, 5, k === US_FACTS_RETRY_DELAYS.length - 1, () => cancelled);
      }
      if (cancelled) return;

      // ── STAGE 4 — SEC evidence READ WITHOUT AI (zzz815): what is stored,
      // then the names still missing it, a few at a time, book first.
      await runDetEvidence(ordered, () => cancelled);
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

  /** zzz815: ask SEC again for one name's figures (the card's Retry). */
  const retryFigures = useCallback(async (syms: string[]) => {
    const list = syms.filter((s) => !!rowsRef.current[s]);
    if (!list.length) return;
    const next: Record<string, UsRow> = { ...rowsRef.current };
    for (const t of list) next[t] = { ...next[t], figures: { ...(next[t].figures || { attempts: 0 }), state: 'retrying', note: 'asking SEC again…' } as any };
    commit(next);
    await factsPass(list, 5, true, () => false);
  }, []);

  const setThesisType = useCallback(async (sym: string, p: AbfgPattern | null) => {
    const key = sym.toUpperCase();
    const map = { ...typesRef.current };
    if (p) map[key] = p; else delete map[key];
    delete US_AI_RECORDS[key]; // zzz837: the owner's own choice always wins over AI's
    setThesisAi((m) => { const n = { ...m }; delete n[key]; return n; });
    typesRef.current = map;
    setThesisTypes(map);
    const cur = rowsRef.current[sym];
    if (cur) put(sym, assessUsRow(p ? cur : { ...cur, pattern: autoPattern(cur.graded, cur.sec) }, map));
    try { await fetch('/api/v1/us-thesis/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'thesis_type', ticker: key, pattern: p }) }); } catch { /* kept for this session */ }
  }, []);

  /** zzz837: file an AI answer for one name (the route already saved it). A type the owner chose stands. */
  const applyAiType = useCallback((sym: string, rec: AiTypeRecord) => {
    const key = sym.toUpperCase();
    const r = applyAiRecord(typesRef.current as Record<string, string>, US_AI_RECORDS, key, rec);
    if (!r.applied) return false;
    US_AI_RECORDS[key] = rec;
    const map = { ...typesRef.current };
    if (isAiTypeRecord(rec)) map[key] = rec.type as AbfgPattern; else delete map[key];
    typesRef.current = map;
    setThesisTypes(map);
    setThesisAi((m) => ({ ...m, [key]: rec }));
    const cur = rowsRef.current[sym];
    if (cur) put(sym, assessUsRow(cur, map));
    return true;
  }, []);

  return { rows, excluded, universeError, loading, evidenceLoading, batch, priorBatch, checkBatch, readFiling, readAll, checkAll, readPriorPeriods, stop, thesisTypes, thesisAi, applyAiType, setThesisType, needsPrior, cbCount, cbInfo, cbCriteria, cbPassing, cbExtras, retryFigures, detBatch, usBook };
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
