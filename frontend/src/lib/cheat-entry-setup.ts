// zzz1061 — the Cheat Entry setup rules (/cheat-entry), moved out of the page so the price alerts use the SAME rules.
//
// A cheat entry is a quality name sitting ON a rising moving average: the add point where the stop is nearest.
//   AT_200   — 200-day retest: price from 3% under to 5% over the 200-day average
//   AT_50    — 50-day pullback: price from 3% under to 5% over the 50-day average
//   EXTENDED — more than 15% above the 50-day average (chasing, not cheating)
//   DRIFT    — between the averages
// More than 3% under the 200-day average = a broken chart, not a dip (no setup at all, null).
// When both averages qualify, the NEAREST one wins, with a mild preference for the deeper (200-day) one.
// "At support now" = within 1% of that average. "Testing support" = 1–3% under it. The stop is 2% under the average bought
// against (risk floor 0.3%).
// The page also scores quality from the owner's browser data (Multibagger grades, Conviction Beats); that part stays on the page.
// Pure: no window, no fetch.

export type CheatSetupKind = 'AT_200' | 'AT_50' | 'DRIFT' | 'EXTENDED';
export type CheatStopMa = '200DMA' | '50DMA';

export interface CheatSetup {
  setup: CheatSetupKind;
  /** price vs the 50 / 200-day average, % */
  d50: number;
  d200: number;
  /** distance to the chosen pivot average, % (null for DRIFT / EXTENDED) */
  pivotD: number | null;
  /** within 1% of the pivot average (never for EXTENDED) */
  atSupportNow: boolean;
  /** 1–3% under the pivot average */
  testingSupport: boolean;
  stopMa: CheatStopMa | null;
  riskPct: number | null;
  /** 0–60 setup points (the page adds 0–40 quality points) */
  setupScore: number;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The setup for one stock, or null when the figures are missing or the chart is broken (> 3% under the 200-day). */
export function cheatSetup(price: number | null | undefined, sma50: number | null | undefined, sma200: number | null | undefined): CheatSetup | null {
  if (!fin(price) || price <= 0 || !fin(sma50) || !fin(sma200) || sma50 <= 0 || sma200 <= 0) return null;
  const d200 = (price - sma200) / sma200 * 100;
  const d50 = (price - sma50) / sma50 * 100;
  if (d200 < -3) return null;

  type Pivot = { kind: CheatSetupKind; stop: CheatStopMa; d: number; base: number; ma: number; pref: number };
  const pivots: Pivot[] = [];
  if (d200 >= -3 && d200 <= 5) pivots.push({ kind: 'AT_200', stop: '200DMA', d: d200, base: 60, ma: sma200, pref: 1.2 });
  if (d50 >= -3 && d50 <= 5) pivots.push({ kind: 'AT_50', stop: '50DMA', d: d50, base: 52, ma: sma50, pref: 0.6 });

  let setup: CheatSetupKind; let setupScore: number;
  let stopMa: CheatStopMa | null = null; let riskPct: number | null = null;
  let pivotD: number | null = null; let testingSupport = false;
  const nearestBelowStop = (): { stop: CheatStopMa; ma: number } | null => {
    const below: Array<{ stop: CheatStopMa; ma: number }> = [];
    if (sma50 < price) below.push({ stop: '50DMA', ma: sma50 });
    if (sma200 < price) below.push({ stop: '200DMA', ma: sma200 });
    if (!below.length) return null;
    below.sort((a, b) => b.ma - a.ma);
    return below[0];
  };
  if (d50 > 15) {
    setup = 'EXTENDED'; setupScore = 3;
    const nb = nearestBelowStop();
    if (nb) { stopMa = nb.stop; riskPct = Math.max(0.3, (price - nb.ma * 0.98) / price * 100); }
  } else if (pivots.length) {
    pivots.sort((a, b) => (Math.abs(a.d - 1) - a.pref) - (Math.abs(b.d - 1) - b.pref));
    const p = pivots[0];
    setup = p.kind; pivotD = p.d;
    setupScore = Math.max(20, p.base - Math.abs(p.d - 1) * 4);
    if (p.d < -1) { setupScore -= 3; testingSupport = true; }
    stopMa = p.stop;
    riskPct = Math.max(0.3, (price - p.ma * 0.98) / price * 100);
  } else {
    setup = 'DRIFT';
    const nearest = Math.min(Math.abs(d50), Math.abs(d200));
    setupScore = Math.max(0, 22 - nearest * 1.5);
    const nb = nearestBelowStop();
    if (nb) { stopMa = nb.stop; riskPct = Math.max(0.3, (price - nb.ma * 0.98) / price * 100); }
  }
  if (sma50 > sma200) setupScore += 4;      // golden structure
  if (d200 > 50) setupScore -= 4;           // very late-stage — give a little back
  setupScore = Math.max(0, Math.min(60, setupScore));
  const atSupportNow = pivotD != null && Math.abs(pivotD) <= 1 && setup !== 'EXTENDED';
  return { setup, d50, d200, pivotD, atSupportNow, testingSupport, stopMa, riskPct, setupScore };
}
