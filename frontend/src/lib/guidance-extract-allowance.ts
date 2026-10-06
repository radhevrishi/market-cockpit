// ═══════════════════════════════════════════════════════════════════════════
// zzz928 — a one-off, time-boxed, hard-capped EXTRA reading allowance for the
// AI guidance extractor (owner, 6 Oct 2026 22:47 Berlin: "India missing guidance
// — maximum permissible limit $15 … everything populated by tomorrow").
//
// The normal ceiling (GUIDANCE_EXTRACT_DAILY_USD, $0.25 a UTC day) is untouched.
// An allowance adds at most `usd` (never more than MAX_EXTRA_USD = $15) on top of
// it until `until` (never more than MAX_HOURS = 12 hours after it was first set).
// After `until`, or once its own spend counter reaches `usd`, it is ignored and the
// normal daily ceiling is the only one again — nothing has to be switched back.
//
// Spend is counted with the same atomic KV float counter as the daily ceiling, on a
// counter of its own (one per allowance id). A run is given the day budget left plus
// the allowance left MINUS a safety margin (a run can overshoot its own cap by the
// documents already in flight), so the allowance's counter cannot pass `usd`.
// Updating an active allowance keeps its id, spend counter and 12-hour window: it can
// lower / raise the amount (still ≤ $15 in total) or change concurrency, never reset
// what was already spent.
//
// Set only through a protected path: POST /api/v1/guidance-extract?action=allowance
// (service key / owner cookie). Pure helpers below are unit-tested.
// ═══════════════════════════════════════════════════════════════════════════

export const ALLOWANCE_KEY = 'guidance-extract:allowance:v1';
export const allowanceSpendKey = (id: string) => `guidance-extract:allowance-usd:v1:${id}`;
export const MAX_EXTRA_USD = 15;
export const MAX_HOURS = 12;
/** a run's in-flight documents may overshoot its cap; never hand out the last few cents */
export const SAFETY_MARGIN_USD = 0.15;
export const DEFAULT_ALLOWANCE_CONCURRENCY = 8;
export const MAX_ALLOWANCE_CONCURRENCY = 10;
/** per-request cap while an allowance is active (the route's normal per-request cap is also $2) */
export const ALLOWANCE_RUN_MAX_USD = 2;

export interface ExtractAllowance {
  id: string;
  usd: number;
  setAt: string;
  until: string;
  reason: string;
  concurrency: number;
}

export interface AllowanceInput { usd?: unknown; hours?: unknown; reason?: unknown; concurrency?: unknown }

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Build (or update) an allowance from untrusted input, clamped to ≤ $15 and ≤ 12 hours.
 *  `prev` (when still active) keeps its id, setAt and 12-hour window. usd ≤ 0 → null (clear). */
export function buildAllowance(input: AllowanceInput, now: Date, prev?: ExtractAllowance | null): ExtractAllowance | null {
  const usdIn = num(input.usd);
  if (!(usdIn > 0)) return null;
  const usd = round4(Math.min(MAX_EXTRA_USD, usdIn));
  const hoursIn = num(input.hours);
  const hours = Math.min(MAX_HOURS, hoursIn > 0 ? hoursIn : 6);
  const keep = prev && isLive(prev, now) ? prev : null;
  const setAt = keep ? keep.setAt : now.toISOString();
  const hardEnd = new Date(setAt).getTime() + MAX_HOURS * 3_600_000;
  const until = new Date(Math.min(hardEnd, now.getTime() + hours * 3_600_000)).toISOString();
  const cIn = Math.round(num(input.concurrency));
  const concurrency = Math.max(1, Math.min(MAX_ALLOWANCE_CONCURRENCY, cIn > 0 ? cIn : (keep?.concurrency || DEFAULT_ALLOWANCE_CONCURRENCY)));
  const reason = String(input.reason ?? keep?.reason ?? '').replace(/[^\w .,:;()$€%/+-]/g, '').slice(0, 200);
  return { id: keep ? keep.id : `a${now.getTime().toString(36)}`, usd, setAt, until, reason, concurrency };
}

/** inside its window (spend not considered) */
export function isLive(a: ExtractAllowance | null | undefined, now: Date): boolean {
  if (!a || typeof a !== 'object') return false;
  const until = Date.parse(a.until), setAt = Date.parse(a.setAt);
  if (!Number.isFinite(until) || !Number.isFinite(setAt)) return false;
  if (until - setAt > MAX_HOURS * 3_600_000 + 1_000) return false;   // a hand-edited record cannot stretch the window
  return now.getTime() < until && Number(a.usd) > 0;
}

export interface AllowanceState { active: boolean; usd: number; spentUsd: number; leftUsd: number; until: string | null; concurrency: number | null; id: string | null; reason: string | null }

/** what a run may still spend from the allowance (0 when expired / used up); the safety margin is held back */
export function allowanceState(a: ExtractAllowance | null | undefined, spent: unknown, now: Date): AllowanceState {
  const s = Math.max(0, num(spent) || 0);
  if (!a || !isLive(a, now)) return { active: false, usd: a ? Number(a.usd) || 0 : 0, spentUsd: round4(s), leftUsd: 0, until: a?.until || null, concurrency: null, id: a?.id || null, reason: a?.reason || null };
  const usd = Math.min(MAX_EXTRA_USD, Number(a.usd) || 0);
  const left = round4(Math.max(0, usd - s - SAFETY_MARGIN_USD));
  return { active: left >= 0.01, usd, spentUsd: round4(s), leftUsd: left >= 0.01 ? left : 0, until: a.until, concurrency: Math.max(1, Math.min(MAX_ALLOWANCE_CONCURRENCY, Number(a.concurrency) || DEFAULT_ALLOWANCE_CONCURRENCY)), id: a.id, reason: a.reason };
}

/** a run's spend is charged to the normal day budget first, the rest to the allowance */
export function splitSpend(spent: number, dayLeft: number): { day: number; extra: number } {
  const s = Math.max(0, Number(spent) || 0);
  const day = Math.min(s, Math.max(0, Number(dayLeft) || 0));
  return { day: round4(day), extra: round4(s - day) };
}

/** the USD cap handed to one request: day budget left + allowance left, never above the per-request cap */
export function runCapUsd(askedUsd: number, dayLeft: number, st: AllowanceState): number {
  const perReq = st.active ? ALLOWANCE_RUN_MAX_USD : askedUsd;
  return round4(Math.max(0, Math.min(askedUsd, perReq, Math.max(0, dayLeft) + (st.active ? st.leftUsd : 0))));
}
