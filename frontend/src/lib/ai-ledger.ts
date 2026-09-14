// ═══════════════════════════════════════════════════════════════════════════
// THE PREDICTION LEDGER  (zzz611)
//
// This is the part almost every AI investing system leaves out, and it is the
// only part that makes the rest worth trusting.
//
// Every assessment the desk produces is a PREDICTION — implicitly, that a high
// composite score precedes outperformance. An unrecorded prediction cannot be
// wrong, which is exactly why unrecorded predictions feel so persuasive. So
// each one is written down at the moment it is made, with the deterministic
// inputs and the AI's own scores frozen alongside it, and marked later against
// what the price actually did at 7, 30, 90 and 180 days — measured RELATIVE to
// the benchmark, because a rising tide is not a signal.
//
// What this eventually buys: the ability to ask which components actually
// carried information. Not "is the AI good" — "does structural_score above 75
// add anything to PEAD above 80, or is it decoration?" That question can only
// be answered by a ledger nobody edited afterwards, which is why an entry is
// written once and its scores are never rewritten.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from './kv';
import type { AiAssessment } from './ai-analyst';

export const LEDGER_VERSION = 'v1';
const INDEX_KEY = `ai:pred-index:${LEDGER_VERSION}`;
const entryKey = (id: string) => `ai:pred:${LEDGER_VERSION}:${id}`;
const TTL_S = 3 * 365 * 24 * 3600;
/** How many entries the index holds. Beyond this the oldest fall off — the
 *  learning question needs hundreds of observations, not tens of thousands. */
const INDEX_MAX = 4000;

export interface LedgerEntry {
  id: string;                       // ticker|accession|filing_date
  ticker: string;
  company: string | null;
  filing_date: string;
  accession: string | null;
  made_at: string;
  /** The price the prediction was made against, and the benchmark's level. */
  price_at: number | null;
  bench_at: number | null;
  bench_symbol: string;
  // ── the inputs, frozen ──
  tier: string | null;
  engine_score: number | null;
  pead: number | null;
  rs: number | null;
  sales_yoy: number | null;
  eps_yoy: number | null;
  guidance_raised: boolean | null;
  // ── the AI's view, frozen ──
  structural_score: number | null;
  change_type: string | null;
  why_now_score: number | null;
  bear_severity: number | null;
  confidence: number | null;
  composite: number | null;
  // ── outcomes, filled in later ──
  out?: Partial<Record<'d7' | 'd30' | 'd90' | 'd180', {
    at: string; ret_pct: number; bench_ret_pct: number; excess_pct: number;
  }>>;
}

export const ledgerId = (ticker: string, accession: string | null, filingDate: string) =>
  `${ticker.toUpperCase()}|${accession || 'na'}|${filingDate}`;

async function readIndex(): Promise<string[]> {
  try { const v = await kvGet<string[]>(INDEX_KEY); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/**
 * Record a prediction — ONCE. A second call for the same filing is ignored on
 * purpose: if an entry could be rewritten after the fact, the ledger would
 * measure hindsight rather than foresight, which is the one failure that would
 * make every number downstream meaningless.
 */
export async function recordPrediction(e: Omit<LedgerEntry, 'made_at'>): Promise<'written' | 'exists' | 'failed'> {
  try {
    const existing = await kvGet<LedgerEntry>(entryKey(e.id));
    if (existing?.id) return 'exists';
    const entry: LedgerEntry = { ...e, made_at: new Date().toISOString() };
    await kvSet(entryKey(e.id), entry, TTL_S);
    const idx = await readIndex();
    if (!idx.includes(e.id)) {
      idx.unshift(e.id);
      await kvSet(INDEX_KEY, idx.slice(0, INDEX_MAX), TTL_S);
    }
    return 'written';
  } catch { return 'failed'; }
}

export async function readLedger(limit = 500): Promise<LedgerEntry[]> {
  const idx = await readIndex();
  const out: LedgerEntry[] = [];
  // Bounded concurrency: the index can hold thousands and a desk opening must
  // not turn into thousands of simultaneous Redis reads (the lesson from the
  // earnings sweep — a burst of large reads times out and looks like absence).
  const slice = idx.slice(0, limit);
  const CHUNK = 12;
  for (let i = 0; i < slice.length; i += CHUNK) {
    const part = await Promise.all(slice.slice(i, i + CHUNK).map((id) =>
      kvGet<LedgerEntry>(entryKey(id)).catch(() => null)));
    for (const e of part) if (e?.id) out.push(e);
  }
  return out;
}

export async function writeEntry(e: LedgerEntry): Promise<void> {
  try { await kvSet(entryKey(e.id), e, TTL_S); } catch { /* best effort */ }
}

/** Which horizons are due to be marked for an entry made on `madeAt`. */
export function dueHorizons(e: LedgerEntry, now = Date.now()): Array<'d7' | 'd30' | 'd90' | 'd180'> {
  const days = (now - Date.parse(e.made_at)) / 86_400_000;
  const want: Array<['d7' | 'd30' | 'd90' | 'd180', number]> = [['d7', 7], ['d30', 30], ['d90', 90], ['d180', 180]];
  return want.filter(([k, d]) => days >= d && !e.out?.[k]).map(([k]) => k);
}

// ─── what the ledger is for: which inputs actually carried information ─────

export interface FactorRead {
  label: string;
  n: number;
  hit_rate: number;        // share with positive excess return
  avg_excess: number;      // mean excess return, percentage points
}

/**
 * Compare the average excess return of entries that satisfy a condition with
 * those that do not, at one horizon. Deliberately simple and transparent —
 * this is a question about whether a signal is worth keeping, and a method the
 * reader cannot check by hand is not an answer they should act on. Reported
 * with `n` always visible, because a 3-observation edge is not an edge.
 */
export function factorRead(
  entries: LedgerEntry[],
  horizon: 'd7' | 'd30' | 'd90' | 'd180',
  label: string,
  pred: (e: LedgerEntry) => boolean,
): { yes: FactorRead; no: FactorRead } | null {
  const scored = entries.filter((e) => e.out?.[horizon]);
  if (scored.length < 5) return null;
  const mk = (rows: LedgerEntry[], lab: string): FactorRead => {
    const ex = rows.map((r) => r.out![horizon]!.excess_pct);
    return {
      label: lab,
      n: rows.length,
      hit_rate: ex.length ? +(ex.filter((x) => x > 0).length / ex.length * 100).toFixed(0) : 0,
      avg_excess: ex.length ? +(ex.reduce((a, b) => a + b, 0) / ex.length).toFixed(1) : 0,
    };
  };
  const yes = scored.filter(pred);
  const no = scored.filter((e) => !pred(e));
  if (!yes.length || !no.length) return null;
  return { yes: mk(yes, `${label} — yes`), no: mk(no, `${label} — no`) };
}
