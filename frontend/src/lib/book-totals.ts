// zzz898 — My Book totals that never treat an unknown price as a value.
// A holding with no live price has no current value and no P&L: it is left out of
// every value total (current value, P&L, allocation weights) and counted instead,
// so the screen can say "N holdings without a price".

export interface BookRowLike {
  cmp?: number | null;
  investedValue?: number | null;
  currentValue?: number | null;
}

/** True only when the holding has a real, positive live price. */
export function isPricedRow(r: BookRowLike): boolean {
  const c = Number(r?.cmp);
  return Number.isFinite(c) && c > 0;
}

/** Current value of a priced holding; 0 weight for an unpriced one (it is excluded, not valued at cost). */
export function pricedValue(r: BookRowLike): number {
  if (!isPricedRow(r)) return 0;
  const v = Number(r.currentValue);
  return Number.isFinite(v) ? v : 0;
}

export interface BookTotals {
  /** Invested amount of priced holdings only (the base the P&L is measured on). */
  pricedInvested: number;
  /** Invested amount of every holding (cost is always known). */
  investedAll: number;
  /** Current value of priced holdings only. */
  current: number;
  /** P&L of priced holdings; null when nothing is priced. */
  pnl: number | null;
  /** P&L % on priced invested; null when nothing is priced. */
  pnlPct: number | null;
  pricedCount: number;
  unpricedCount: number;
}

export function bookTotals(rows: BookRowLike[]): BookTotals {
  let pricedInvested = 0, investedAll = 0, current = 0, pricedCount = 0, unpricedCount = 0;
  for (const r of rows || []) {
    const inv = Number(r?.investedValue);
    const invOk = Number.isFinite(inv) ? inv : 0;
    investedAll += invOk;
    if (isPricedRow(r)) {
      pricedCount++;
      pricedInvested += invOk;
      current += pricedValue(r);
    } else {
      unpricedCount++;
    }
  }
  const pnl = pricedCount > 0 ? current - pricedInvested : null;
  const pnlPct = pnl !== null && pricedInvested > 0 ? (pnl / pricedInvested) * 100 : null;
  return { pricedInvested, investedAll, current, pnl, pnlPct, pricedCount, unpricedCount };
}

/** Plain note for the screen; empty string when every holding is priced. */
export function unpricedNote(n: number): string {
  if (!(n > 0)) return '';
  return `${n} holding${n === 1 ? '' : 's'} without a price — left out of totals`;
}

/**
 * Neutral wording for a holding's evidence signal. My Book never tells the owner to
 * buy, add, trim or exit — the upstream action code is turned into a factual tone.
 */
export function neutralSignalLabel(action: string | null | undefined): string {
  const k = String(action || '').trim().toUpperCase();
  const map: Record<string, string> = {
    BUY: 'positive', ADD: 'positive', ACCUMULATE: 'positive',
    WATCH: 'watch', HOLD: 'neutral', NEUTRAL: 'neutral',
    TRIM: 'review', REDUCE: 'review', EXIT: 'negative', SELL: 'negative', AVOID: 'negative',
  };
  return map[k] || '';
}
