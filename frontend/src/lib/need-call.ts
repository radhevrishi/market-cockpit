// zzz1151 — graded India companies with NO guidance document on record ("No guidance on record — no earlier call read …"): the
// graded overlay lists them (lib/in-guide-check), the documents collector reads their last calls from screener.in's concall list
// a few per run. Pure helpers.
export const IN_NEED_CALL_KEY = 'guidance-priority:v1:IN:need-call';
export const NEED_CALL_PER_RUN = 12;
const SYM = /^[A-Z0-9][A-Z0-9&-]{0,19}$/;

/** A slice of the list that moves every two hours, newest filings first, so a long list is covered over a day. */
export function needCallSlice(map: Record<string, string> | null | undefined, now: Date, per = NEED_CALL_PER_RUN): string[] {
  const list = Object.entries(map || {}).filter(([t, d]) => SYM.test(t) && typeof d === 'string')
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0])).map(([t]) => t);
  if (list.length <= per) return list;
  const slot = Math.floor(now.getTime() / (2 * 3_600_000));
  const start = (slot * per) % list.length;
  return [...list.slice(start), ...list.slice(0, start)].slice(0, per);
}
