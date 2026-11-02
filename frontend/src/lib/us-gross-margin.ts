// zzz1205 — gross margin, this quarter vs the same quarter a year earlier, from the row's own quarterly series. NVT Q3 FY26:
// revenue +44% and operating margin +2.9 pts, but gross margin 37.4% → 35.8% — the release said so and the card did not.
// Informational (explains, never costs a grade point): a gross-margin fall with a wider operating margin is often mix or an
// acquisition. Pure.
export const GM_DOWN_TAG = 'gross margin fell 1.5+ pts year on year';
export interface GrossMarginMove { now: number; prev: number; delta: number; end: string; prevEnd: string }
interface Ser { ends?: string[]; revenue?: Array<number | null>; gross_profit?: Array<number | null> }
const yearBefore = (a: string, b: string): boolean => {
  const da = Date.parse(a), db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
  const days = (da - db) / 86_400_000;
  return days > 350 && days < 380;
};
export function grossMarginMove(s: Ser | null | undefined): GrossMarginMove | null {
  const ends = s?.ends, rev = s?.revenue, gp = s?.gross_profit;
  if (!Array.isArray(ends) || !Array.isArray(rev) || !Array.isArray(gp) || ends.length < 5) return null;
  const i = ends.length - 1;
  const j = ends.findIndex((e, k) => k < i && yearBefore(ends[i], e));
  if (j < 0) return null;
  const r1 = rev[i], g1 = gp[i], r0 = rev[j], g0 = gp[j];
  if (![r1, g1, r0, g0].every((x) => typeof x === 'number' && Number.isFinite(x)) || r1! <= 0 || r0! <= 0) return null;
  const now = (g1! / r1!) * 100, prev = (g0! / r0!) * 100;
  if (now <= 0 || now > 100 || prev <= 0 || prev > 100) return null;
  return { now: Math.round(now * 10) / 10, prev: Math.round(prev * 10) / 10, delta: Math.round((now - prev) * 10) / 10, end: ends[i], prevEnd: ends[j] };
}
/** Adds the figures (and the tag when it fell ≥ 1.5 pts) to a graded row. */
export function applyGrossMargin(row: any): void {
  const m = grossMarginMove(row?.series);
  if (!m) return;
  row.gross_margin = m;
  if (m.delta <= -1.5 && Array.isArray(row.caveat_tags) && !row.caveat_tags.includes(GM_DOWN_TAG)) row.caveat_tags.push(GM_DOWN_TAG);
}
