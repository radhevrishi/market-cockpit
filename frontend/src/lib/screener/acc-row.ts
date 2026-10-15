// zzz1046a — the accumulation / distribution figures (lib/accumulation.ts) on the screener: what the build keeps per company, which
// fields a row carries, and the row back into the engine's shape for the plain explanation. Pure; client-safe.
//
// Read from the COMPLETED daily sessions only (the same bars as the daily pattern scan and the trader setups); big-volume weeks count
// completed exchange weeks only (lib/completed-weeks.ts). Every stored entry carries `accV` (ACC_VERSION): an entry without the current
// version shows NO accumulation figures (blank, never a stale zero) until the company's prices are read again.
// The 50-session up / down volume of the engine (udv50) is the same figure as the trader setups' `udv` (lib/setups.ts) — the row keeps
// `udv` only. India's delivery % (dlv10 / dlvChg) comes from NSE's price files, worked out at every build (in-build.ts), not from here.
import { accumulationFigures, accExplain, ACC_HONESTY, ACC_RULES, ACC_VERSION, type AccFigures, type AccGrade } from '../accumulation';
import { weekComplete } from '../completed-weeks';
import type { DailyBars } from './tech';
import type { ScreenMarket, ScreenRow } from './types';

/** Grade as a number for filters / sorting: A 5 · B 4 · C 3 · D 2 · E 1. */
export const ACC_RANK: Readonly<Record<AccGrade, number>> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
export const gradeOfRank = (r: unknown): AccGrade | null => (r === 5 ? 'A' : r === 4 ? 'B' : r === 3 ? 'C' : r === 2 ? 'D' : r === 1 ? 'E' : null);
/** The numeric figures stored per company and carried on a row (nulls left out). */
export const ACC_NUM_KEYS = ['accS', 'accR', 'accD', 'disD', 'chD', 'cmf21', 'cmf65', 'obvSlope', 'obvLead', 'bigUpW', 'bigDnW', 'vdu', 'vboD', 'vboX', 'distWarn'] as const;
/** Every accumulation field on a row: the numbers, the grade letter (`accG`) and the score's parts (`accP`, for the explanation). */
export const ACC_ROW_KEYS = [...ACC_NUM_KEYS, 'accG', 'accP', 'accM'] as const satisfies ReadonlyArray<keyof ScreenRow>;
/** India's delivery fields (from NSE's price files). */
export const DLV_ROW_KEYS = ['dlv10', 'dlvChg'] as const satisfies ReadonlyArray<keyof ScreenRow>;

export type AccStored = { accV: number } & Partial<Pick<ScreenRow, typeof ACC_ROW_KEYS[number]>>;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** What a stored entry keeps: the known figures and `accV` (also on a failure, so a company is not re-read on every run for it). */
export function accEntry(done: DailyBars, market?: ScreenMarket, now?: Date): AccStored {
  const out: AccStored = { accV: ACC_VERSION };
  try {
    const f = accumulationFigures(done, { daily: true, market: market === 'IN' ? 'IN' : market === 'US' ? 'US' : undefined, weekDone: (mon) => weekComplete(mon, market, now) });
    for (const k of ACC_NUM_KEYS) {
      const v = k === 'accR' ? (f.accG ? ACC_RANK[f.accG] : null) : (f as any)[k];
      if (fin(v)) (out as any)[k] = v;
    }
    if (f.accG) out.accG = f.accG;
    if (f.accG === 'C' && fin(f.accS) && f.accS >= 65 && f.accMiss?.length) out.accM = f.accMiss.join(' · ');   // zzz1047
    if (f.parts) { const p = f.parts; out.accP = [p.ad, p.days, p.udv, p.obv, p.weeks, p.pull]; }
  } catch { /* never costs the price figures */ }
  return out;
}
/** Is a stored entry's accumulation reading current? */
export const accCurrent = (tf: { accV?: number } | undefined | null): boolean => !!tf && tf.accV === ACC_VERSION;
/** The accumulation fields a row carries: only from a current reading (an older / missing one = blank). */
export function accRowFields(tf: ({ accV?: number } & Record<string, unknown>) | undefined): Partial<ScreenRow> {
  if (!accCurrent(tf)) return {};
  const o: Partial<ScreenRow> = {};
  for (const k of ACC_ROW_KEYS) { const v = (tf as any)[k]; if (v != null) (o as any)[k] = v; }
  return o;
}
/** A row (or a lean row) back into the engine's figures, for accExplain. `udv` stands in for the engine's udv50 (same figure). */
export function accFiguresOfRow(r: Partial<ScreenRow>): AccFigures {
  const n = (k: string): number | null => (fin((r as any)[k]) ? (r as any)[k] : null);
  const p = Array.isArray(r.accP) && r.accP.length === 6 && r.accP.every(fin) ? r.accP : null;
  const g = typeof r.accG === 'string' && /^[A-E]$/.test(r.accG) ? (r.accG as AccGrade) : gradeOfRank(r.accR);
  const s = n('accS');
  return {
    accV: ACC_VERSION, accS: s, accG: s == null ? null : g, distWarn: n('distWarn') === 1 ? 1 : n('distWarn') === 0 ? 0 : null,
    accD: n('accD'), disD: n('disD'), chD: n('chD'), cmf21: n('cmf21'), cmf65: n('cmf65'), udv50: n('udv'),
    obvSlope: n('obvSlope'), obvLead: (n('obvLead') as -1 | 0 | 1 | null), bigUpW: n('bigUpW'), bigDnW: n('bigDnW'),
    vdu: n('vdu') === 1 ? 1 : n('vdu') === 0 ? 0 : null, vboD: n('vboD'), vboX: n('vboX'), dlv10: n('dlv10'), dlvChg: n('dlvChg'),
    accMiss: typeof r.accM === 'string' && r.accM ? r.accM.split(' · ') : [],
    ...(p ? { parts: { ad: p[0], days: p[1], udv: p[2], obv: p[3], weeks: p[4], pull: p[5] } } : {}),
  };
}
/** The plain lines for a row (detail panel / tooltip). A row with no grade says why in words (not read yet, or too little history) —
 *  a row cannot tell the two apart — and still shows India's delivery % when known. */
export function accExplainRow(r: Partial<ScreenRow>, market?: ScreenMarket): string[] {
  const f = accFiguresOfRow(r);
  if (f.accS != null) return accExplain(f, 'session', market);
  const sg = (x: number) => `${x > 0 ? '+' : ''}${x}`;
  return [
    `No accumulation grade yet: not read for this company yet (it fills in with the next price read), or fewer than ${ACC_RULES.minBars} sessions with volume.`,
    market === 'IN' && f.dlv10 != null ? `Delivery ${f.dlv10}% of traded shares (10-session average)${f.dlvChg != null ? `, ${sg(f.dlvChg)} pts vs the 40 sessions before` : ''}` : '',
    ACC_HONESTY,
  ].filter(Boolean);
}
/** The build note on how many companies carry the current accumulation reading. */
export function accCoverageNote(store: ReadonlyMap<string, { accV?: number; accS?: number | null }>): string {
  let cur = 0, graded = 0;
  for (const v of store.values()) if (accCurrent(v)) { cur++; if (fin(v.accS)) graded++; }
  return `volume & accumulation (our own version of the published O'Neil / Wyckoff rules, completed sessions): ${cur} of ${store.size} companies read with version ${ACC_VERSION}, ${graded} with enough history for a grade${cur < store.size ? ` — ${store.size - cur} wait for their next price read (blank until then)` : ''}`;
}

/** Breakout volume: the volume of bar `i` ÷ the average volume of the 50 bars before it (null when fewer than 40 of them carry volume). */
export function barVolX(v: readonly number[], i: number): number | null {
  if (!(i >= 1 && i < v.length) || !fin(v[i]) || !(v[i] > 0)) return null;
  let s = 0, k = 0;
  for (let j = Math.max(0, i - 50); j < i; j++) if (fin(v[j]) && v[j] > 0) { s += v[j]; k++; }
  return k >= 40 ? Math.round((v[i] / (s / k)) * 10) / 10 : null;
}
/** "on 2.1× volume" / "on light volume (0.8×)" — '' when unknown. */
export function breakoutVolText(bx: unknown): string {
  if (!fin(bx)) return '';
  return bx < 1 ? `on light volume (${bx}× the 50-session average)` : `on ${bx}× the 50-session average volume`;
}
