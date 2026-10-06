// zzz919 — time budget + date ordering for the prewarm-earnings sweep.
//
// The sweep used to run bench refresh (<=110 s) + concall warm (<=120 s) + theme
// warm (<=90 s) BEFORE its date loop, then each date call could take 180 s, with
// a loop deadline of 250 s measured from the start. The scheduler gives the
// request 240 s, so a normal run was cut ("timeout") with no report. Now every
// step asks the budget how long it may take and refuses to start when too
// little is left; the whole run returns before HARD_MS.

export const HARD_MS = 200_000;      // return before this (scheduler allows 240 s)
export const MIN_STEP_MS = 15_000;   // never start a step with less than this left

export class Budget {
  constructor(private readonly startedAt: number, private readonly hardMs: number = HARD_MS, private readonly nowFn: () => number = Date.now) {}
  elapsed(): number { return this.nowFn() - this.startedAt; }
  remaining(): number { return this.hardMs - this.elapsed(); }
  /** can a step that needs at least `min` ms start? */
  canStart(min: number = MIN_STEP_MS): boolean { return this.remaining() >= min; }
  /** per-call timeout: the call's own cap, but never beyond what is left. */
  timeout(cap: number): number { return Math.max(1_000, Math.min(cap, this.remaining() - 2_000)); }
}

/** Newest dates are checked every run; older dates rotate through `cursor` so every slot makes progress. */
export const ALWAYS_OFFSETS = 12;

export function orderOffsets(windowDays: number, cursor: number): number[] {
  const head: number[] = [];
  for (let i = 0; i <= Math.min(ALWAYS_OFFSETS - 1, windowDays); i++) head.push(i);
  const tail: number[] = [];
  for (let i = ALWAYS_OFFSETS; i <= windowDays; i++) tail.push(i);
  if (tail.length === 0) return head;
  const c = (((Math.floor(cursor) || 0) % tail.length) + tail.length) % tail.length;
  return [...head, ...tail.slice(c), ...tail.slice(0, c)];
}

/** Cursor for the next run: the tail position of the first offset NOT reached (null = all reached). */
export function nextCursor(firstUnreachedOffset: number | null): number {
  if (firstUnreachedOffset === null) return 0;
  return Math.max(0, firstUnreachedOffset - ALWAYS_OFFSETS);
}
