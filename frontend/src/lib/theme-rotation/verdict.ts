// ═══════════════════════════════════════════════════════════════════════════
// THEME VERDICT — the owner's vocabulary, with its reasons  (zzz795)
//
// BUY / EARLY BUY / HOLD / WATCH / TRIM / AVOID stay exactly as they were: they
// are the owner's established language on this tab. What changed:
//
//  1. A SHORT-TERM BREAK NOW BLOCKS A BUY. Gold Miners read BUY while down
//     13.5% over one month and 4.8% over one week, because the verdict only
//     looked at the three-month picture and the 50-day line. Strong three-month
//     relative strength was masking a break that was already under way. A BUY
//     (or EARLY BUY) now also requires that the last month and the last week
//     are not falling hard; otherwise the call is HOLD, and the note says why.
//
//  2. CROWDING IS NOT A SELL SIGNAL. Memory read TRIM while up almost 400% over
//     one year. Late-cycle crowding is its own flag (see detectors.ts). A
//     long-term leader that pulls back below its 50-day line while its
//     three-month trend is still positive is a HOLD ("stop adding, watch the
//     line"), not a TRIM. TRIM still fires when the tape confirms damage on
//     both the 50-day line and the three-month return.
//
// Pure and deterministic: the route calls it, the tests call it.
// ═══════════════════════════════════════════════════════════════════════════

export interface VerdictInput {
  quadrant: string;
  aboveSMA50: boolean;
  w1?: number | null;
  m1?: number | null;
  m3?: number | null;
  y1?: number | null;
  dd1y?: number | null;
}

export interface VerdictOut { verdict: string; color: string; note: string; shortTermBreak: boolean }

const C = {
  BUY: '#16A34A', 'EARLY BUY': '#22C55E', HOLD: '#F59E0B', WATCH: '#EAB308', TRIM: '#F97316', AVOID: '#EF4444',
} as const;

const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : 'n/a');

/** The last week and month are falling hard enough to override a strong 3M picture. */
export function isShortTermBreak(w1?: number | null, m1?: number | null): boolean {
  const W = typeof w1 === 'number' ? w1 : null;
  const M = typeof m1 === 'number' ? m1 : null;
  if (M != null && M <= -6) return true;
  if (W != null && M != null && W <= -3 && M < 0) return true;
  return false;
}

/** A long-term leader: well up over a year and not deeply off its high. */
export function isStructuralLeader(y1?: number | null, dd1y?: number | null): boolean {
  return typeof y1 === 'number' && y1 >= 30 && (typeof dd1y !== 'number' || dd1y > -25);
}

export function verdictFor(inp: VerdictInput): VerdictOut {
  const { quadrant, aboveSMA50, w1, m1, m3, y1, dd1y } = inp;
  const up1 = typeof m1 === 'number' ? m1 > 0 : false;
  const pos3 = typeof m3 === 'number' ? m3 > 0 : false;
  const deep = typeof m3 === 'number' ? m3 <= -12 : false;
  const brk = isShortTermBreak(w1, m1);
  const structural = isStructuralLeader(y1, dd1y);
  const out = (verdict: keyof typeof C, note: string): VerdictOut => ({ verdict, color: C[verdict], note, shortTermBreak: brk });

  if (quadrant === 'Leading') {
    if (aboveSMA50 && pos3 && !brk) return out('BUY', 'Ahead of the market and gaining, above its 50-day line, and up over 3 months. Price confirms the strength.');
    if (aboveSMA50 && pos3 && brk) return out('HOLD', `Strong over 3 months (${pct(m3)}), but the last month is ${pct(m1)} and the last week ${pct(w1)} — a short-term break. Hold; do not add until it steadies.`);
    return out('HOLD', 'Ahead of the market on relative strength, but its own price is not confirming (below the 50-day line or down over 3 months). Hold; wait for price to catch up.');
  }

  if (quadrant === 'Improving') {
    if (aboveSMA50 && up1 && !deep && !brk) return out('EARLY BUY', 'Turning up: above its 50-day line, up over the last month, and the 3-month decline has stopped. A real early turn.');
    if (deep) return out('WATCH', `Bouncing, but still ${pct(m3)} over 3 months — could be a dead-cat bounce. Watch; do not chase.`);
    return out('WATCH', 'Relative momentum is turning up, but price has not confirmed it yet. Watch for a move back above the 50-day line.');
  }

  if (quadrant === 'Weakening') {
    const priceDamage = !aboveSMA50 && typeof m3 === 'number' && m3 <= 0;
    if (priceDamage) return out('TRIM', `Relative strength is fading AND the price confirms it: below the 50-day line and ${pct(m3)} over 3 months. Trim; tighten stops; do not add.`);
    if (structural) {
      if (!aboveSMA50) return out('HOLD', `A long-term leader (${pct(y1)} over 1 year) pulling back below its 50-day line. Stop adding and watch whether it recovers the line. Crowding, if any, is flagged separately — it is not a sell signal on its own.`);
      if (typeof m3 === 'number' && m3 <= 0) return out('HOLD', `A long-term leader (${pct(y1)} over 1 year) that is ${pct(m3)} over 3 months but back above its 50-day line. Hold; do not add until the 3-month trend turns up again.`);
      return out('HOLD', 'A long-term leader whose lead over the market has stopped widening. Hold what you own; stop adding.');
    }
    if (!aboveSMA50 || (typeof m3 === 'number' && m3 <= 0)) return out('TRIM', 'Relative momentum is rolling over and the price agrees (below the 50-day line or down over 3 months). Trim; do not add.');
    return out('HOLD', 'Relative momentum is cooling, but the price is above its 50-day line and still up over 3 months. Hold; stop adding. Not a sell — the price has not confirmed a roll-over.');
  }

  // Lagging
  if (aboveSMA50 && (up1 || pos3) && !brk) {
    return out('WATCH', 'Relative strength is still weak, but the price is back above its 50-day line and rising. A turn may be starting — wait for relative strength to follow.');
  }
  return out('AVOID', 'Behind the market, momentum still falling, and the price is below its 50-day line or breaking lower. Avoid until it turns.');
}
