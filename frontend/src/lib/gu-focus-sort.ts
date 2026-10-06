// zzz927 — sort a focus-list table by the date the news was reported (the announcement / document date on the row).
// Pure. A row with no date goes last in both directions; rows with the same date keep the order they came in (the focus order).
export type DateDir = 'new' | 'old';
export function sortByReported<T>(rows: readonly T[], dateOf: (r: T) => string | null | undefined, dir: DateDir): T[] {
  const t = (r: T): number | null => { const d = dateOf(r); const v = d ? Date.parse(String(d).slice(0, 10)) : NaN; return Number.isFinite(v) ? v : null; };
  return rows.map((r, i) => ({ r, i, v: t(r) })).sort((a, b) => {
    if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
    return (dir === 'new' ? b.v - a.v : a.v - b.v) || a.i - b.i;
  }).map((x) => x.r);
}
/** 2026-09-18 → '18 Sep 2026' (the raw text when it is not a date; a dash when there is none). */
export function reportedLabel(d: string | null | undefined): string {
  if (!d) return '—';
  const t = Date.parse(String(d).slice(0, 10));
  if (!Number.isFinite(t)) return String(d);
  const dt = new Date(t);
  return `${String(dt.getUTCDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
