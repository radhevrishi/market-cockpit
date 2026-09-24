// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — DETECTORS  (zzz795)
//
// Each detector answers one question with its own evidence, and says why:
//
//   early rotation — are fundamentals (earnings, catalysts) and participation
//                    improving while relative strength is still Lagging or only
//                    Improving? That is the turn BEFORE price confirms it.
//   crowded        — is this a late-cycle, stretched move? Far above the 50-day
//                    line, an extreme 1-year gain, breadth narrowing while the
//                    price rises, momentum rolling. A FLAG, never a sell label.
//   breakdown      — below the 50-day line with participation collapsing.
//   short-term break — a strong 3-month picture with a falling week and month.
//   defensive      — "leading" only because it is falling less than the market.
//   cross-theme flow — one theme's relative momentum falling while a related
//                    theme's rises over the same weeks.
// ═══════════════════════════════════════════════════════════════════════════

import type { CrossFlow, Flag, LayerSet, ThemeRow } from './types';

const pct = (v: number | null | undefined, dp = 0) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(dp)}%` : 'n/a');

// ── EARLY ROTATION ─────────────────────────────────────────────────────────
export function detectEarlyRotation(t: ThemeRow, L: LayerSet): Flag | null {
  const q = t.quadrant || '';
  if (q !== 'Lagging' && q !== 'Improving') return null;
  const fundamentals = (['earnings', 'catalysts'] as const).filter((k) => L[k].state === 'improving');
  if (!fundamentals.length) return null;
  const participation = L.breadth.state === 'improving' || L.flow.state === 'improving';
  // Two independent confirmations, at least one of them a fundamental one.
  const confirmations = fundamentals.length + (participation ? 1 : 0);
  if (confirmations < 2) return null;
  // A theme in free fall is not turning, whatever its filings say.
  if (L.price.state === 'weakening' && L.breadth.state === 'weakening') return null;
  const bits = [
    ...fundamentals.map((k) => L[k].headline.toLowerCase()),
    ...(L.breadth.state === 'improving' ? [`breadth improving (${L.breadth.headline.toLowerCase()})`] : []),
    ...(L.flow.state === 'improving' ? ['volume leaning to up days (proxy)'] : []),
  ];
  return {
    kind: 'early-rotation',
    label: 'Early rotation',
    why: `Fundamentals improving before the price: ${bits.join('; ')} — while relative strength is still ${q.toLowerCase()}.`,
  };
}

// ── CROWDING / OVEREXTENSION ───────────────────────────────────────────────
export function detectCrowding(t: ThemeRow, L: LayerSet, benchY1?: number | null): Flag | null {
  const r = t.ret; if (!r) return null;
  const signals: string[] = [];
  let extension = false;
  // Far above the 50-day line, scaled to how volatile the theme normally is.
  const volTh = Math.max(12, (t.vol ?? 30) * 0.4);
  if (typeof t.dist50 === 'number' && t.dist50 >= volTh) { signals.push(`${pct(t.dist50)} above its 50-day line`); extension = true; }
  const b1 = typeof benchY1 === 'number' ? benchY1 : 0;
  if (r.y1 >= 100 || (r.y1 >= 60 && r.y1 >= b1 + 50)) { signals.push(`${pct(r.y1)} over 1 year`); extension = true; }
  const b = t.breadthStats;
  if (b && b.above50Prev != null && b.n >= 3 && b.above50Prev - b.above50 >= Math.max(1, Math.round(b.n * 0.15)) && r.m1 > 0) {
    signals.push(`fewer stocks carrying it (${b.above50} of ${b.n} above the 50-day line, from ${b.above50Prev}) while the price rose`);
  }
  if ((t.rsRatio ?? 0) >= 100 && ((t.rsMomentum ?? 100) < 100 || (t.momDelta1w ?? 0) <= -0.5)) signals.push('relative momentum rolling over');
  if (typeof t.rangePos === 'number' && t.rangePos >= 92 && extension) signals.push('at the top of its 1-year range');
  if (!extension || signals.length < 2) return null;
  return {
    kind: 'crowded',
    label: 'Crowded / stretched',
    why: `Late-cycle signs: ${signals.join('; ')}. This is a risk flag on a strong theme, not a sell call — size and entries matter more here.`,
  };
}

// ── BREAKDOWN ──────────────────────────────────────────────────────────────
export function detectBreakdown(t: ThemeRow, L: LayerSet): Flag | null {
  if (t.aboveSMA50 !== false) return null;
  const b = t.breadthStats;
  const r = t.ret;
  if (b && b.n >= 3) {
    const share = b.above50 / b.n;
    const fell = b.above50Prev != null ? (b.above50Prev - b.above50) / b.n : 0;
    // "Collapsing" means a CHANGE: a quarter of the names lost their 50-day
    // line in a month, or almost none hold it and the last month did fresh
    // damage. A theme that has sat at the bottom for months is Lagging, not
    // breaking down now — flagging it every week would be noise.
    const fresh = typeof r?.m1 === 'number' && r.m1 <= -5;
    if (fell >= 0.25 || (share <= 0.2 && fresh)) {
      return {
        kind: 'breakdown', label: 'Breakdown',
        why: `Below its 50-day line and participation is collapsing: ${b.above50} of ${b.n} stocks above their own 50-day line${b.above50Prev != null ? ` (was ${b.above50Prev} a month ago)` : ''}${fresh ? `, ${pct(r!.m1, 1)} over 1 month` : ''}${b.newLows > b.newHighs ? `, ${b.newLows} near 1-year lows` : ''}.`,
      };
    }
    return null;
  }
  // No breadth: only a hard price break qualifies, and it is labelled as price-only.
  if (r && r.m1 <= -10 && r.w1 < 0 && L.price.state === 'weakening') {
    return { kind: 'breakdown', label: 'Breakdown (price only)', why: `Below its 50-day line, ${pct(r.m1, 1)} in a month and still falling. Breadth could not be measured, so this rests on price alone.` };
  }
  return null;
}

export function detectShortTermBreak(t: ThemeRow): Flag | null {
  const r = t.ret; if (!r || !t.shortTermBreak) return null;
  if ((r.m3 ?? 0) <= 0) return null; // then it is not "masking" anything
  return { kind: 'short-term-break', label: 'Short-term break', why: `Strong over 3 months (${pct(r.m3, 1)}) but ${pct(r.m1, 1)} over 1 month and ${pct(r.w1, 1)} over 1 week. The 3-month strength is hiding a break that is under way.` };
}

export function detectDefensive(t: ThemeRow): Flag | null {
  // Only a theme actually AHEAD of the market can be "leading while falling".
  if (!t.fallingLeader || (t.rsRatio ?? 0) < 100) return null;
  return { kind: 'defensive', label: 'Falling less', why: `Leads on relative strength while its own price is down over 3 months (${pct(t.ret?.m3, 1)}). Falling less than the market is defence, not a buy signal.` };
}

export function detectFlags(t: ThemeRow, L: LayerSet, benchY1?: number | null): Flag[] {
  return [
    detectBreakdown(t, L),
    detectShortTermBreak(t),
    detectCrowding(t, L, benchY1),
    detectEarlyRotation(t, L),
    detectDefensive(t),
  ].filter(Boolean) as Flag[];
}

// ── CROSS-THEME FLOW ───────────────────────────────────────────────────────
/**
 * Pairs where one theme's relative momentum fell while a RELATED theme's rose
 * over the same weeks. "Related" means the same group on the board, or the
 * same correlation cluster ("moves with") — money rotating inside a
 * neighbourhood, which is what a reader can act on. Unrelated pairs are not
 * reported: a fall in Gold and a rise in Software on the same weeks is a
 * coincidence the data cannot tell apart from a rotation.
 *
 * @param subBeneficiaries names inside each theme most likely to benefit next
 *        (strongest sub-themes / leaders), used as second-order beneficiaries.
 */
export function detectCrossFlows(
  themes: ThemeRow[],
  subBeneficiaries: (themeId: string) => string[],
  opts: { weeks?: number; minMove?: number; max?: number } = {},
): CrossFlow[] {
  const weeks = opts.weeks ?? 4, minMove = opts.minMove ?? 1.2, max = opts.max ?? 5;
  const delta = (t: ThemeRow) => {
    const tr = t.trail || [];
    if (tr.length < weeks + 1) return null;
    return +(tr[tr.length - 1].y - tr[tr.length - 1 - weeks].y).toFixed(2);
  };
  const rsThen = (t: ThemeRow) => { const tr = t.trail || []; return tr.length > weeks ? tr[tr.length - 1 - weeks].x : null; };
  const withD = themes.filter((t) => t.ok !== false).map((t) => ({ t, d: delta(t) })).filter((x) => x.d != null) as Array<{ t: ThemeRow; d: number }>;
  const losers = withD.filter((x) => x.d <= -minMove);
  const gainers = withD.filter((x) => x.d >= minMove);
  const out: CrossFlow[] = [];
  for (const L of losers) for (const G of gainers) {
    if (L.t.id === G.t.id) continue;
    const sameGroup = !!L.t.group && L.t.group === G.t.group && L.t.group !== 'Broad Sectors';
    const sameCluster = L.t.cluster != null && L.t.cluster === G.t.cluster;
    if (!sameGroup && !sameCluster) continue;
    // Money leaves the stronger theme for the weaker one — that is rotation.
    const a = rsThen(L.t), b = rsThen(G.t);
    if (a != null && b != null && a < b) continue;
    const basis: CrossFlow['basis'] = sameGroup && sameCluster ? 'same group, moves together' : sameGroup ? 'same group' : 'moves together';
    out.push({
      from: L.t.id, to: G.t.id, fromDelta: L.d, toDelta: G.d, weeks, basis,
      beneficiaries: subBeneficiaries(G.t.id).slice(0, 4),
      why: `Over ${weeks} weeks ${L.t.name}'s relative momentum fell (${L.d.toFixed(1)}) while ${G.t.name}'s rose (+${G.d.toFixed(1)}); they are ${basis === 'moves together' ? 'in the same correlation group' : basis === 'same group' ? 'in the same group on the board' : 'in the same group and move together'}. A rotation proxy from relative momentum, not fund-flow data.`,
    });
  }
  out.sort((x, y) => (y.toDelta - y.fromDelta) - (x.toDelta - x.fromDelta));
  // One line per receiving theme and per source theme keeps it readable.
  const seenTo = new Set<string>(), seenFrom = new Set<string>();
  const dedup: CrossFlow[] = [];
  for (const f of out) {
    if (seenTo.has(f.to) || seenFrom.has(f.from)) continue;
    seenTo.add(f.to); seenFrom.add(f.from); dedup.push(f);
    if (dedup.length >= max) break;
  }
  return dedup;
}
