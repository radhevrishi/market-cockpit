// zzz961 — "extended" stocks: price already stretched far above its moving averages, where a fresh entry
// carries a big pull-back risk. Used to keep them out of Technicals → "Copy ALL BEST → TV".
//
// The owner's rule: more than 30% above the 50-day average, or more than 90% above the 200-day average.
// Added: the same stretch measured in the stock's own daily range (ATR). A quiet stock 25% above its 50-day
// average is as stretched as a wild one 40% above it, so "10 or more average daily ranges above the 50-day"
// also counts as extended.
export const EXT_MAX_ABOVE_50 = 30;
export const EXT_MAX_ABOVE_200 = 90;
export const EXT_MAX_ATR_ABOVE_50 = 10;

export interface ExtensionInput {
  pctVsSma50?: number; pctVsEma50?: number;
  pctVsSma200?: number; pctVsEma200?: number;
  adrPct?: number;           // ATR ÷ price × 100
}
export interface ExtensionVerdict { extended: boolean; reason: string | null }

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function extensionCheck(r: ExtensionInput | null | undefined): ExtensionVerdict {
  if (!r) return { extended: false, reason: null };
  const p50 = num(r.pctVsSma50) ? r.pctVsSma50 : num(r.pctVsEma50) ? r.pctVsEma50 : undefined;
  const p200 = num(r.pctVsSma200) ? r.pctVsSma200 : num(r.pctVsEma200) ? r.pctVsEma200 : undefined;
  if (num(p50) && p50 > EXT_MAX_ABOVE_50) return { extended: true, reason: `${p50.toFixed(0)}% above 50-day average` };
  if (num(p200) && p200 > EXT_MAX_ABOVE_200) return { extended: true, reason: `${p200.toFixed(0)}% above 200-day average` };
  if (num(p50) && num(r.adrPct) && r.adrPct > 0) {
    const atrs = p50 / r.adrPct;
    if (atrs >= EXT_MAX_ATR_ABOVE_50) return { extended: true, reason: `${atrs.toFixed(1)} daily ranges above 50-day average` };
  }
  return { extended: false, reason: null };
}
