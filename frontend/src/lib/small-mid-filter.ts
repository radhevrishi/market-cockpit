// zzz898 — "Small & mid only" for India tabs (Earnings Opportunities, Transformation Radar).
// Small/mid = market cap under ₹30,000 Cr (the same ceiling as the India Conviction Beats preset).
// A name whose size is unknown is KEPT and labelled — an unknown size is never treated as large or small.
// Kept equal to CB_SMALL_MID_MAX_CR in lib/conviction-filter-india (a test pins the two together);
// not imported so a page that only needs the ceiling does not pull the whole preset engine.
export const SMALL_MID_MAX_CR = 30_000;

/** Market cap in ₹ Cr when it is a real positive number, else null (unknown). */
export function knownCapCr(cr: unknown): number | null {
  const n = typeof cr === 'number' ? cr : typeof cr === 'string' && cr.trim() !== '' ? Number(cr) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Does this row pass the Small & mid toggle? Unknown size passes (shown, labelled). */
export function passesSmallMid(cr: unknown, on: boolean, maxCr: number = SMALL_MID_MAX_CR): boolean {
  if (!on) return true;
  const c = knownCapCr(cr);
  return c == null || c < maxCr;
}

/** How many rows the toggle hides (known large caps) and how many have an unknown size. */
export function smallMidCounts<T>(rows: T[], capOf: (r: T) => unknown, maxCr: number = SMALL_MID_MAX_CR): { hiddenLarge: number; unknown: number } {
  let hiddenLarge = 0, unknown = 0;
  for (const r of rows || []) {
    const c = knownCapCr(capOf(r));
    if (c == null) unknown++;
    else if (c >= maxCr) hiddenLarge++;
  }
  return { hiddenLarge, unknown };
}

/** Read the saved toggle (default ON). Never throws. */
export function readSmallMidPref(key: string): boolean {
  try {
    if (typeof window === 'undefined') return true;
    const v = window.localStorage.getItem(key);
    return v === null ? true : v !== '0';
  } catch { return true; }
}

export function writeSmallMidPref(key: string, on: boolean): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, on ? '1' : '0'); } catch { /* per-browser convenience only */ }
}
