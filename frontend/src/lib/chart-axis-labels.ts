// zzz1000 (improvement 4) — moving-average value tags on the right price axis used to overlap when two lines ended close
// together (EMA 21 under EMA 50, both unreadable). The tags are stacked instead: same top-to-bottom order as the lines, at least
// `gap` pixels apart, moved as little as possible and kept inside the axis. The value text itself is unchanged (exact).

/** New y positions (same order as `ys`) so that no two tags are closer than `gap`. */
export function stackAxisLabels(ys: number[], gap: number, min = -Infinity, max = Infinity): number[] {
  const order = ys.map((y, i) => ({ y: Number.isFinite(y) ? y : 0, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const pos = order.map((o) => o.y);
  for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + gap);           // push down
  if (pos.length && pos[pos.length - 1] > max) {
    pos[pos.length - 1] = max;
    for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - gap);    // push back up from the bottom
  }
  if (pos.length && pos[0] < min) {                                                            // no room for all: keep inside, allow overlap at the end
    pos[0] = min;
    for (let k = 1; k < pos.length; k++) pos[k] = Math.min(Math.max(pos[k], pos[k - 1] + gap), max);
  }
  const out = new Array<number>(ys.length);
  order.forEach((o, k) => { out[o.i] = pos[k]; });
  return out;
}
