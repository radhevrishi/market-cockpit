// Options Ideas — price-structure setups (pure, no look-ahead: everything is read from bars[0..last]).
//
// Eight structures, four for calls and four for puts. Nothing here is an indicator crossover: every setup is anchored on a
// structure the portal's own engines find —
//   • trendlines with 3+ touches (lib/auto-lines: no close through the line between its first and last touch)
//   • horizontal levels with 3+ touches (same engine)
//   • cups / cups with handle (lib/chart-patterns), and INVERSE cups found by running the same cup detector on the price
//     turned upside down (1 / price keeps every percentage move, so a dome becomes a cup)
//
//   CALL  trend_bounce        rising support line, touched in the last 3 sessions, closing back up off it
//   CALL  downtrend_break     falling resistance line, first close above it in the last 5 sessions
//   CALL  breakout_retest     3+ touch resistance broken 4–40 sessions ago, pulled back to it, holding above
//   CALL  cup_retest          cup / cup-with-handle broke its rim, back near the rim and holding (or forming, ≤ 3% under the rim)
//   PUT   trend_breakdown     rising support line, first close below it in the last 5 sessions
//   PUT   downtrend_reject    falling resistance line, touched in the last 3 sessions, closing back down off it
//   PUT   breakdown_retest    3+ touch support broken 4–40 sessions ago, bounced back up to it, failing below
//   CALL  vcp_breakout        VCP (lib/chart-patterns) within 3% under its pivot, or broke the pivot ≤ 20 sessions ago and holding near it
//   PUT   inverse_cup         dome broke its rim (neckline) downwards, back near the rim and failing (or ≤ 3% above it)
//
// Each setup carries an entry trigger, a stop beyond the structure (with an ATR buffer), two targets (measured move / next
// level), the reward : risk to target 1, and a quality score built from the evidence (touches, volume on the break, trend
// alignment, how far price is from the trigger). Setups with reward : risk under MIN_RR are dropped.
import { autoLines, linePriceAt, type TrendLine } from '../auto-lines';
import { detectPatterns, type PBar } from '../chart-patterns';

export type SetupId = 'trend_bounce' | 'downtrend_break' | 'breakout_retest' | 'cup_retest' | 'trend_breakdown' | 'downtrend_reject' | 'breakdown_retest' | 'inverse_cup' | 'vcp_breakout';
export type Side = 'CALL' | 'PUT';
export const SETUP_META: Record<SetupId, { side: Side; label: string; short: string; why: string }> = {
  trend_bounce: { side: 'CALL', label: 'Uptrend support bounce', short: 'TL bounce', why: 'Price came back to a rising trendline that has held three or more times and is turning up off it again.' },
  downtrend_break: { side: 'CALL', label: 'Downtrend line breakout', short: 'TL breakout', why: 'Price closed above a falling trendline that had capped it three or more times — the downtrend is broken.' },
  breakout_retest: { side: 'CALL', label: 'Breakout + retest', short: 'BO retest', why: 'A resistance level tested three or more times was broken, price came back to it and it is now holding as support.' },
  cup_retest: { side: 'CALL', label: 'Cup breakout + retest', short: 'Cup retest', why: 'A rounded cup base broke above its rim; price is back near the rim and holding — the classic second chance entry.' },
  trend_breakdown: { side: 'PUT', label: 'Uptrend line breakdown', short: 'TL breakdown', why: 'Price closed below a rising trendline that had held three or more times — the uptrend is broken.' },
  downtrend_reject: { side: 'PUT', label: 'Downtrend line rejection', short: 'TL reject', why: 'Price rallied into a falling trendline that has capped it three or more times and is turning down off it again.' },
  breakdown_retest: { side: 'PUT', label: 'Breakdown + retest', short: 'BD retest', why: 'A support level tested three or more times broke, price bounced back up to it and it is now acting as resistance.' },
  vcp_breakout: { side: 'CALL', label: 'VCP breakout', short: 'VCP', why: 'A volatility contraction base (two to six pullbacks, each smaller than the last, volume drying up) — the entry is the break above its pivot.' },
  inverse_cup: { side: 'PUT', label: 'Inverse cup breakdown + retest', short: 'Inv. cup', why: 'A rounded top (inverse cup) broke below its rim; price is back near the rim from below and failing there.' },
};
export const SETUP_IDS = Object.keys(SETUP_META) as SetupId[];
export const SETUPS_VERSION = 'oi-3';   // zzz1307: VCP breakout added
/** reward : risk to target 1 below this = no trade */
export const MIN_RR = 1.5;

export interface SetupLine { kind: 'trend' | 'level' | 'rim'; from: [number, number]; to: [number, number] }
export interface Setup {
  id: SetupId; side: Side; label: string;
  /** bar index the signal is read on (the last bar) and the structure's own key index (touch / break bar) */
  at: number; keyIndex: number;
  /** price that confirms the trade (calls: a close / trade above it; puts: below) and whether it is already met */
  trigger: number; triggered: boolean;
  entry: number; stop: number; target1: number; target2: number;
  rr1: number; riskPct: number;
  /** 0–100 */
  quality: number;
  evidence: Record<string, number | string | boolean>;
  reasons: string[];
  lines: SetupLine[];
  /** bars the structure spans (used to size the expected time to target) */
  spanBars: number;
}

interface Ctx {
  b: PBar[]; n: number; L: number; c: number;
  atr: number; atrPct: number; avgV50: number;
  sma50: number | null; sma200: number | null; sma200Prev: number | null;
  hi: (from: number, to: number) => number; lo: (from: number, to: number) => number;
}
const last = <T,>(a: T[]) => a[a.length - 1];
const r2 = (x: number) => Math.round(x * 100) / 100;

function sma(b: PBar[], end: number, len: number): number | null {
  if (end + 1 < len) return null;
  let s = 0; for (let i = end - len + 1; i <= end; i++) s += b[i].c; return s / len;
}
function atr14(b: PBar[], end: number): number {
  const from = Math.max(1, end - 13); let s = 0, k = 0;
  for (let i = from; i <= end; i++) { const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); s += tr; k++; }
  return k ? s / k : b[end].h - b[end].l;
}
function makeCtx(b: PBar[]): Ctx {
  const n = b.length, L = n - 1, c = b[L].c;
  const a = atr14(b, L);
  let v = 0, vk = 0; for (let i = Math.max(0, L - 50); i < L; i++) if (b[i].v > 0) { v += b[i].v; vk++; }
  return {
    b, n, L, c, atr: a, atrPct: a / c, avgV50: vk ? v / vk : 0,
    sma50: sma(b, L, 50), sma200: sma(b, L, 200), sma200Prev: sma(b, L - 20, 200),
    hi: (f, t) => { let m = -Infinity; for (let i = Math.max(0, f); i <= Math.min(L, t); i++) m = Math.max(m, b[i].h); return m; },
    lo: (f, t) => { let m = Infinity; for (let i = Math.max(0, f); i <= Math.min(L, t); i++) m = Math.min(m, b[i].l); return m; },
  };
}
const volRatio = (x: Ctx, i: number) => (x.avgV50 > 0 && x.b[i].v > 0 ? x.b[i].v / x.avgV50 : 0);
/** trend context: +1 up (above a rising 200-day), −1 down (below a falling 200-day), 0 otherwise */
function trendOf(x: Ctx): number {
  if (x.sma200 == null || x.sma200Prev == null) return 0;
  if (x.c > x.sma200 && x.sma200 >= x.sma200Prev) return 1;
  if (x.c < x.sma200 && x.sma200 <= x.sma200Prev) return -1;
  return 0;
}

function finish(x: Ctx, id: SetupId, p: { keyIndex: number; trigger: number; stop: number; t1: number; t2: number; ev: Setup['evidence']; reasons: string[]; lines: SetupLine[]; base: number; spanBars: number }): Setup | null {
  const meta = SETUP_META[id];
  const call = meta.side === 'CALL';
  const triggered = call ? x.c >= p.trigger : x.c <= p.trigger;
  const entry = triggered ? x.c : p.trigger;
  const risk = call ? entry - p.stop : p.stop - entry;
  if (!(risk > 0)) return null;
  // a stop tighter than half an ATR is noise; wider than 3.5 ATR (or 12 % of the price) is not a structural trade
  if (risk < 0.5 * x.atr || risk > 3.5 * x.atr || risk / entry > 0.12) return null;
  // the trigger must be within one ATR of today's close — a trigger far away is a different, later trade
  if (Math.abs(x.c - p.trigger) > 1.0 * x.atr) return null;
  const reward = call ? p.t1 - entry : entry - p.t1;
  if (!(reward > 0)) return null;
  const rr1 = reward / risk;
  if (rr1 < MIN_RR) return null;
  const trend = trendOf(x);
  const aligned = call ? trend > 0 : trend < 0;
  const against = call ? trend < 0 : trend > 0;
  let q = p.base;
  q += Math.min(10, (rr1 - MIN_RR) * 5);
  if (aligned) q += 12; else if (against) q -= 15;
  if (!triggered) q -= 6;
  const dist = Math.abs(x.c - p.trigger) / x.atr;
  if (dist > 1.5) q -= 8;
  const reasons = [...p.reasons];
  reasons.push(aligned ? (call ? 'Above a rising 200-day average (trend agrees)' : 'Below a falling 200-day average (trend agrees)')
    : against ? (call ? 'Against the trend: below a falling 200-day average' : 'Against the trend: above a rising 200-day average') : 'Long-term trend flat');
  return {
    id, side: meta.side, label: meta.label, at: x.L, keyIndex: p.keyIndex,
    trigger: r2(p.trigger), triggered, entry: r2(entry), stop: r2(p.stop), target1: r2(p.t1), target2: r2(p.t2),
    rr1: Math.round(rr1 * 10) / 10, riskPct: Math.round((risk / entry) * 1000) / 10,
    quality: Math.max(0, Math.min(100, Math.round(q))),
    evidence: { ...p.ev, trend, atrPct: Math.round(x.atrPct * 1000) / 10 },
    reasons, lines: p.lines, spanBars: p.spanBars,
  };
}

/** nearest swing level beyond price in a direction (for target 1 when the structure gives none) */
function nextLevelAbove(levels: { price: number }[], above: number): number | null {
  const c = levels.map((l) => l.price).filter((p) => p > above * 1.01).sort((a, b) => a - b);
  return c.length ? c[0] : null;
}
function nextLevelBelow(levels: { price: number }[], below: number): number | null {
  const c = levels.map((l) => l.price).filter((p) => p < below * 0.99).sort((a, b) => b - a);
  return c.length ? c[0] : null;
}

function trendSetups(x: Ctx, lines: TrendLine[], levels: { price: number }[], off: number): Setup[] {
  const out: Setup[] = [];
  const b = x.b, L = x.L;
  for (const ln of lines) {
    if (ln.touches.length < 3) continue;
    const g = (i: number) => linePriceAt(ln, i - off);
    const lineNow = g(L);
    const tol = Math.max(0.3 * x.atr, 0.005 * x.c);
    const touchesLine = { from: [b[ln.firstTouch + off].t, g(ln.firstTouch + off)] as [number, number], to: [b[L].t, lineNow] as [number, number] };
    const span = L - (ln.firstTouch + off);
    const ev = { touches: ln.touches.length, lineStrength: ln.strength, spanBars: span };
    if (ln.kind === 'support' && ln.dir === 'rising') {
      if (ln.state === 'intact') {
        // bounce: a low within tolerance of the line in the last 3 bars, close back above it and up on the day
        let k = -1; for (let i = L; i >= L - 2; i--) if (b[i].l <= g(i) + tol && b[i].c > g(i)) { k = i; break; }
        if (k < 0 || !(x.c > b[L - 1].c || x.c > b[k].c) || x.c > lineNow + 1.5 * x.atr) continue;
        const trigger = Math.max(b[k].h, x.c);
        const stop = Math.min(b[k].l, g(L)) - 0.6 * x.atr;
        const swingHi = x.hi(L - 60, L - 1);
        const t1 = Math.max(swingHi, trigger + 2 * (trigger - stop));
        const s = finish(x, 'trend_bounce', { keyIndex: k, trigger, stop, t1, t2: t1 + (t1 - trigger), ev: { ...ev, vr: Math.round(volRatio(x, L) * 10) / 10 }, reasons: [`Rising trendline with ${ln.touches.length} touches over ${span} sessions`, `Touched it ${L - k === 0 ? 'today' : `${L - k} session(s) ago`} and closed back above`], lines: [{ kind: 'trend', ...touchesLine }], base: 42 + Math.min(14, (ln.touches.length - 3) * 5) + ln.strength / 10, spanBars: span });
        if (s) out.push(s);
      } else if (ln.state === 'broken' && ln.breakIndex != null && L - (ln.breakIndex + off) <= 4) {
        const bi = ln.breakIndex + off;
        if (!(x.c < g(L))) continue;
        const vr = volRatio(x, bi);
        const trigger = Math.min(b[bi].l, x.c);
        const stop = Math.max(g(L), b[bi].h) + 0.4 * x.atr;
        const lvl = nextLevelBelow(levels, trigger);
        const t1 = Math.min(lvl ?? Infinity, trigger - 2 * (stop - trigger));
        const s = finish(x, 'trend_breakdown', { keyIndex: bi, trigger, stop, t1, t2: t1 - (trigger - t1), ev: { ...ev, vr: Math.round(vr * 10) / 10 }, reasons: [`Rising trendline with ${ln.touches.length} touches broke ${L - bi === 0 ? 'today' : `${L - bi} session(s) ago`}`, vr >= 1.4 ? `Break on ${vr.toFixed(1)}× normal volume` : 'Break volume not above normal'], lines: [{ kind: 'trend', ...touchesLine }], base: 40 + Math.min(12, (ln.touches.length - 3) * 4) + (vr >= 1.4 ? 10 : 0) + ln.strength / 12, spanBars: span });
        if (s) out.push(s);
      }
    }
    if (ln.kind === 'resistance' && ln.dir === 'falling') {
      if (ln.state === 'intact') {
        let k = -1; for (let i = L; i >= L - 2; i--) if (b[i].h >= g(i) - tol && b[i].c < g(i)) { k = i; break; }
        if (k < 0 || !(x.c < b[L - 1].c || x.c < b[k].c) || x.c < lineNow - 1.5 * x.atr) continue;
        const trigger = Math.min(b[k].l, x.c);
        const stop = Math.max(b[k].h, g(L)) + 0.6 * x.atr;
        const swingLo = x.lo(L - 60, L - 1);
        const t1 = Math.min(swingLo, trigger - 2 * (stop - trigger));
        const s = finish(x, 'downtrend_reject', { keyIndex: k, trigger, stop, t1, t2: t1 - (trigger - t1), ev: { ...ev, vr: Math.round(volRatio(x, L) * 10) / 10 }, reasons: [`Falling trendline with ${ln.touches.length} touches over ${span} sessions`, `Tested it ${L - k === 0 ? 'today' : `${L - k} session(s) ago`} and closed back below`], lines: [{ kind: 'trend', ...touchesLine }], base: 40 + Math.min(14, (ln.touches.length - 3) * 5) + ln.strength / 10, spanBars: span });
        if (s) out.push(s);
      } else if (ln.state === 'broken' && ln.breakIndex != null && L - (ln.breakIndex + off) <= 4) {
        const bi = ln.breakIndex + off;
        if (!(x.c > g(L))) continue;
        const vr = volRatio(x, bi);
        const trigger = Math.max(b[bi].h, x.c);
        const stop = Math.min(g(L), b[bi].l) - 0.4 * x.atr;
        const lvl = nextLevelAbove(levels, trigger);
        const t1 = Math.max(lvl ?? 0, trigger + 2 * (trigger - stop));
        const s = finish(x, 'downtrend_break', { keyIndex: bi, trigger, stop, t1, t2: t1 + (t1 - trigger), ev: { ...ev, vr: Math.round(vr * 10) / 10 }, reasons: [`Falling trendline with ${ln.touches.length} touches broke ${L - bi === 0 ? 'today' : `${L - bi} session(s) ago`}`, vr >= 1.4 ? `Breakout on ${vr.toFixed(1)}× normal volume` : 'Breakout volume not above normal'], lines: [{ kind: 'trend', ...touchesLine }], base: 40 + Math.min(12, (ln.touches.length - 3) * 4) + (vr >= 1.4 ? 10 : 0) + ln.strength / 12, spanBars: span });
        if (s) out.push(s);
      }
    }
  }
  return out;
}

/** breakout / breakdown + retest of a horizontal level with 3+ touches */
function retestSetups(x: Ctx, levels: { price: number; touches: { i: number }[]; strength: number }[], off: number): Setup[] {
  const out: Setup[] = [];
  const b = x.b, L = x.L;
  for (const lv of levels) {
    if (lv.touches.length < 3) continue;
    const P = lv.price;
    const tol = Math.max(0.35 * x.atr, 0.006 * P);
    const firstTouch = lv.touches[0].i + off;
    for (const dir of [1, -1] as const) {
      // the break: first close beyond the level 4..40 bars ago, after at least 15 bars on the other side
      let bi = -1;
      for (let i = L - 3; i >= L - 40 && i > 16; i--) {
        const beyond = dir > 0 ? b[i].c > P + tol : b[i].c < P - tol;
        const prevSide = dir > 0 ? b[i - 1].c <= P + tol : b[i - 1].c >= P - tol;
        if (beyond && prevSide) {
          let side = 0; for (let j = i - 15; j < i; j++) if (dir > 0 ? b[j].c <= P + tol : b[j].c >= P - tol) side++;
          if (side >= 12) { bi = i; break; }
        }
      }
      if (bi < 0) continue;
      // after the break it moved away (≥ 1 ATR), then came back to the level in the last 3 bars, holding on a close basis
      const ext = dir > 0 ? x.hi(bi, L - 1) : x.lo(bi, L - 1);
      if (dir > 0 ? ext < P + tol + x.atr : ext > P - tol - x.atr) continue;
      let k = -1;
      for (let i = L; i >= L - 2; i--) { if (dir > 0 ? b[i].l <= P + tol && b[i].c > P - 0.2 * tol : b[i].h >= P - tol && b[i].c < P + 0.2 * tol) { k = i; break; } }
      if (k < 0) continue;
      // today's close must be on the holding side of the level (calls above, puts below)
      if (dir > 0 ? x.c < P : x.c > P) continue;
      // no close back through the level by more than the tolerance since the break
      let failed = false; for (let i = bi + 1; i <= L; i++) if (dir > 0 ? b[i].c < P - tol : b[i].c > P + tol) { failed = true; break; }
      if (failed) continue;
      const vr = volRatio(x, bi);
      const baseH = dir > 0 ? P - x.lo(bi - 60, bi - 1) : x.hi(bi - 60, bi - 1) - P;
      const id: SetupId = dir > 0 ? 'breakout_retest' : 'breakdown_retest';
      const trigger = dir > 0 ? Math.max(b[k].h, x.c) : Math.min(b[k].l, x.c);
      const stop = dir > 0 ? Math.min(b[k].l, P) - 0.6 * x.atr : Math.max(b[k].h, P) + 0.6 * x.atr;
      const t1 = dir > 0 ? Math.max(ext, P + Math.min(baseH, 0.35 * P)) : Math.min(ext, P - Math.min(baseH, 0.35 * P));
      const t2 = dir > 0 ? P + Math.min(2 * baseH, 0.6 * P) : P - Math.min(1.4 * baseH, 0.5 * P);
      const s = finish(x, id, {
        keyIndex: bi, trigger, stop, t1, t2,
        ev: { touches: lv.touches.length, levelStrength: lv.strength, vr: Math.round(vr * 10) / 10, breakAgo: L - bi, retestAgo: L - k },
        reasons: [`${dir > 0 ? 'Resistance' : 'Support'} at ${r2(P)} tested ${lv.touches.length} times`, `Broken ${L - bi} sessions ago${vr >= 1.4 ? ` on ${vr.toFixed(1)}× volume` : ''}, retested ${L - k === 0 ? 'today' : `${L - k} session(s) ago`} and ${dir > 0 ? 'holding above' : 'failing below'}`],
        lines: [{ kind: 'level', from: [b[Math.max(0, firstTouch)].t, P], to: [b[L].t, P] }],
        base: 46 + Math.min(12, (lv.touches.length - 3) * 4) + (vr >= 1.4 ? 8 : 0) + lv.strength / 12, spanBars: L - firstTouch,
      });
      if (s) out.push(s);
    }
  }
  return out;
}

/** cup / inverse cup via the chart-pattern engine (inverse = cups on 1/price) */
function cupSetups(x: Ctx, bars: PBar[], inverse: boolean): Setup[] {
  const out: Setup[] = [];
  const K = 1e4;
  const src = inverse ? bars.map((q) => ({ t: q.t, o: K / q.o, h: K / q.l, l: K / q.h, c: K / q.c, v: q.v })) : bars;
  let hits: ReturnType<typeof detectPatterns> = [];
  try { hits = detectPatterns(src, { timeframe: 'D' }); } catch { return out; }
  const b = x.b, L = x.L;
  for (const h of hits) {
    if (h.id !== 'cup' && h.id !== 'cup_handle') continue;
    if (h.pivot == null || h.stage === 'failed') continue;
    const rim = inverse ? K / h.pivot : h.pivot;
    const depth = (h.depthPct ?? 0) / 100; // in the inverted space this is the dome's rise, close enough for the measured move
    if (!(depth >= 0.08 && depth <= 0.55)) continue;
    const call = !inverse;
    const dist = (x.c - rim) / rim;
    // breakout already: price back near the rim (−2 % … +4 % for calls, mirror for puts); forming: within 3 % of the rim
    const broke = h.stage === 'breakout' && (h.breakAgo ?? 99) <= 30;
    const near = call ? dist >= -0.02 && dist <= 0.04 : dist <= 0.02 && dist >= -0.04;
    const forming = h.stage === 'forming' && (call ? dist >= -0.03 && dist < 0 : dist <= 0.03 && dist > 0);
    if (!(broke && near) && !forming) continue;
    const id: SetupId = call ? 'cup_retest' : 'inverse_cup';
    const trigger = call ? Math.max(rim * 1.002, broke ? b[L].h : rim * 1.002) : Math.min(rim * 0.998, broke ? b[L].l : rim * 0.998);
    const stop = call ? Math.min(rim, x.lo(L - 5, L)) - 0.8 * x.atr : Math.max(rim, x.hi(L - 5, L)) + 0.8 * x.atr;
    const t1 = call ? rim * (1 + Math.min(depth, 0.3)) : rim * (1 - Math.min(depth / (1 + depth), 0.25));
    const t2 = call ? rim * (1 + Math.min(2 * depth, 0.6)) : rim * (1 - Math.min(1.6 * depth / (1 + depth), 0.4));
    const startI = Math.max(0, L - h.lengthBars);
    const s = finish(x, id, {
      keyIndex: L, trigger, stop, t1, t2,
      ev: { depthPct: Math.round(depth * 1000) / 10, lengthBars: h.lengthBars, confidence: Math.round(h.confidence * 100) / 100, stage: h.stage, handle: h.id === 'cup_handle', breakAgo: h.breakAgo ?? -1 },
      reasons: [`${inverse ? 'Inverse cup (rounded top)' : h.id === 'cup_handle' ? 'Cup with handle' : 'Cup'} ${h.lengthBars} sessions long, ${Math.round(depth * 100)}% deep`, broke ? `${call ? 'Broke above' : 'Broke below'} the rim ${h.breakAgo} session(s) ago and is retesting it` : `Within ${Math.abs(Math.round(dist * 1000) / 10)}% of the rim — trade only on the ${call ? 'break above' : 'break below'}`],
      lines: [{ kind: 'rim', from: [b[startI].t, rim], to: [b[L].t, rim] }],
      base: 44 + h.confidence * 22 + (broke ? 6 : 0) + (h.id === 'cup_handle' ? 4 : 0), spanBars: h.lengthBars,
    });
    if (s) out.push(s);
  }
  return out;
}

/** zzz1307 — VCP breakout via the chart-pattern engine: forming within 3% under the pivot, or broke it ≤ 20 sessions ago and is
 *  holding −2 … +5% of it. Stop under the last contraction low (the last 10 sessions) with an ATR buffer. */
function vcpSetups(x: Ctx, hits: ReturnType<typeof detectPatterns>): Setup[] {
  const out: Setup[] = [];
  const b = x.b, L = x.L;
  for (const h of hits) {
    if (h.id !== 'vcp' || h.pivot == null || h.stage === 'failed') continue;
    const P = h.pivot, dist = (x.c - P) / P;
    const broke = h.stage === 'breakout' && (h.breakAgo ?? 99) <= 20;
    const near = broke && dist >= -0.02 && dist <= 0.05;
    const forming = h.stage === 'forming' && dist >= -0.03 && dist < 0;
    if (!near && !forming) continue;
    const depth = Math.max(0.08, Math.min(0.35, (h.depthPct ?? 20) / 100));
    const trigger = broke ? Math.max(P * 1.002, x.c) : P * 1.002;
    const stop = Math.min(P, x.lo(L - 10, L)) - 0.5 * x.atr;
    const t1 = P * (1 + Math.min(depth, 0.25)), t2 = P * (1 + Math.min(2 * depth, 0.5));
    const startI = Math.max(0, L - h.lengthBars);
    const cm = /(\d+) contractions/.exec(String(h.note || '')); const contractions = cm ? Number(cm[1]) : null;
    const s = finish(x, 'vcp_breakout', {
      keyIndex: L, trigger, stop, t1, t2,
      ev: { depthPct: Math.round(depth * 1000) / 10, lengthBars: h.lengthBars, confidence: Math.round(h.confidence * 100) / 100, stage: h.stage, breakAgo: h.breakAgo ?? -1, ...(contractions != null ? { contractions } : {}) },
      reasons: [`VCP ${h.lengthBars} sessions long, first pullback ${Math.round(depth * 100)}% deep${contractions != null ? `, ${contractions} contractions` : ''}${h.volumeOk === false ? ' (volume not confirmed)' : ''}`,
        broke ? `Broke above the pivot ${h.breakAgo} session(s) ago and is holding near it` : `Within ${Math.abs(Math.round(dist * 1000) / 10)}% under the pivot — trade only on the close above it`],
      lines: [{ kind: 'level', from: [b[startI].t, P], to: [b[L].t, P] }],
      base: 46 + h.confidence * 22 + (broke ? 4 : 0) + (h.volumeOk === false ? -6 : 0), spanBars: h.lengthBars,
    });
    if (s) out.push(s);
  }
  return out;
}

export interface FindOpts { cups?: boolean }
/** All setups present at the last bar. Bars: daily, oldest first, at least 260. */
export function findSetups(barsIn: PBar[], opts: FindOpts = {}): Setup[] {
  const bars = barsIn.filter((q) => q && q.l > 0 && q.h >= q.l && Number.isFinite(q.c));
  if (bars.length < 220) return [];
  const x = makeCtx(bars);
  if (!(x.atr > 0)) return [];
  const win = 260;
  const off = Math.max(0, bars.length - win);
  const lr = autoLines(bars.slice(off), { tf: 'D', maxLines: 8, maxLevelsPerSide: 4 });
  const levels = lr.levels.map((l) => ({ price: l.price, touches: l.touches, strength: l.strength }));
  const out: Setup[] = [
    ...trendSetups(x, lr.trend, levels, off),
    ...retestSetups(x, levels, off),
  ];
  if (opts.cups !== false) {
    const recent = bars.slice(-500);
    out.push(...cupSetups(x, recent, false), ...cupSetups(x, recent, true));
    let hits: ReturnType<typeof detectPatterns> = [];
    try { hits = detectPatterns(recent, { timeframe: 'D' }); } catch { /* patterns are optional */ }
    out.push(...vcpSetups(x, hits));
  }
  // one setup per id (the best), sorted by quality
  const best = new Map<SetupId, Setup>();
  for (const s of out) { const k = best.get(s.id); if (!k || s.quality > k.quality) best.set(s.id, s); }
  return [...best.values()].sort((a, b) => b.quality - a.quality);
}

export { last as _last };

// ─── zzz1301g — structure on a chart with no tradable setup ──────────────────────────────────────────────────────────────
/** zzz1307 — bullish patterns shown in the chart structure (what would make it a setup) */
export const STRUCTURE_PATTERNS = new Set<string>(['cup', 'cup_handle', 'vcp', 'flat_base', 'ascending_base', 'base_on_base', 'high_tight_flag', 'bull_flag', 'ascending_triangle', 'double_bottom', 'inverse_hs']);
export interface WatchLevel { side: Side; price: number; distPct: number; what: string }
export interface Structure { lines: SetupLine[]; levels: Array<{ price: number; kind: 'support' | 'resistance'; touches: number }>; watch: WatchLevel[]; notes: string[] }
/** What the chart shows when no setup qualifies: the trendlines / levels / cups found, and what price would make each a setup. */
export function describeStructure(barsIn: PBar[]): Structure {
  const bars = barsIn.filter((q) => q && q.l > 0 && q.h >= q.l && Number.isFinite(q.c));
  const out: Structure = { lines: [], levels: [], watch: [], notes: [] };
  if (bars.length < 220) { out.notes.push(`Only ${bars.length} sessions of history — structure needs at least 220.`); return out; }
  const x = makeCtx(bars), L = x.L, c = x.c;
  const off = Math.max(0, bars.length - 260);
  const lr = autoLines(bars.slice(off), { tf: 'D', maxLines: 8, maxLevelsPerSide: 4 });
  const pct = (p: number) => Math.round(((p - c) / c) * 1000) / 10;
  const fmt = (p: number) => (Math.round(p * 100) / 100).toString();
  for (const ln of lr.trend) {
    if (ln.touches.length < 3) continue;
    const g = (i: number) => linePriceAt(ln, i - off);
    const now = g(L);
    out.lines.push({ kind: 'trend', from: [bars[ln.firstTouch + off].t, g(ln.firstTouch + off)], to: [bars[L].t, now] });
    const d = pct(now), atrs = Math.abs(now - c) / x.atr;
    const name = `${ln.dir === 'rising' ? 'Rising' : 'Falling'} ${ln.kind} line (${ln.touches.length} touches) at ${fmt(now)}, ${d > 0 ? '+' : ''}${d}% from the price`;
    if (ln.state === 'intact') {
      if (ln.kind === 'support' && ln.dir === 'rising') out.watch.push({ side: 'CALL', price: now, distPct: d, what: `${name}. Call setup if the stock pulls back to it and closes back up${atrs > 1.5 ? ` (now ${atrs.toFixed(1)} ATR away — too far)` : ''}; a close below it ends the uptrend (no calls then).` });
      else if (ln.kind === 'resistance' && ln.dir === 'falling') out.watch.push({ side: 'CALL', price: now, distPct: d, what: `${name}. Call setup on a close above it (downtrend broken)${atrs > 1.5 ? ` — ${atrs.toFixed(1)} ATR away` : ''}.` });
      else out.watch.push({ side: ln.kind === 'support' ? 'CALL' : 'PUT', price: now, distPct: d, what: `${name}. ${ln.kind === 'support' ? 'Falling support: no call setup type uses it' : 'Rising resistance (a channel top): no setup type uses it'}.` });
    } else out.notes.push(`${name} — already broken ${ln.breakIndex != null ? `${L - (ln.breakIndex + off)} sessions ago` : ''}; too long ago to trade the break, watch for a retest.`);
  }
  for (const lv of lr.levels) {
    if (lv.touches.length < 3) continue;
    out.levels.push({ price: lv.price, kind: lv.kind, touches: lv.touches.length });
    const d = pct(lv.price);
    out.watch.push(lv.price > c
      ? { side: 'CALL', price: lv.price, distPct: d, what: `Resistance at ${fmt(lv.price)} (${lv.touches.length} touches, ${d > 0 ? '+' : ''}${d}%). A close above it, then a pull-back that holds, is the breakout + retest call.` }
      : { side: 'CALL', price: lv.price, distPct: d, what: `Support at ${fmt(lv.price)} (${lv.touches.length} touches, ${d}%). Holding above keeps calls possible; a close below it turns the chart weak (no calls; puts are watch-only).` });
  }
  try {
    for (const h of detectPatterns(bars.slice(-500), { timeframe: 'D' })) {
      // zzz1307 — VCP and the other main bullish bases next to cups (pivot = the entry line)
      if (!STRUCTURE_PATTERNS.has(h.id) || h.pivot == null || h.stage === 'failed') continue;
      const d = pct(h.pivot);
      const cupLike = h.id === 'cup' || h.id === 'cup_handle';
      out.lines.push({ kind: cupLike ? 'rim' : 'level', from: [bars[Math.max(0, L - h.lengthBars)].t, h.pivot], to: [bars[L].t, h.pivot] });
      const name = h.id === 'cup_handle' ? 'Cup with handle' : h.id === 'cup' ? 'Cup' : h.label;
      out.watch.push({ side: 'CALL', price: h.pivot, distPct: d, what: `${name} (${h.lengthBars} sessions${h.depthPct != null ? `, ${Math.round(h.depthPct)}% deep` : ''}), ${cupLike ? 'rim' : 'pivot'} ${fmt(h.pivot)} (${d > 0 ? '+' : ''}${d}%) — ${h.stage === 'breakout' ? `broke out; a pull-back to the ${cupLike ? 'rim' : 'pivot'} that holds is the entry` : `a close above the ${cupLike ? 'rim' : 'pivot'} is the entry`}.` });
    }
  } catch { /* patterns are optional */ }
  out.watch.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
  out.watch = out.watch.slice(0, 8);
  if (!out.lines.length && !out.levels.length) out.notes.push('No trendline or level with 3+ touches in the last year, and no cup — the chart has no clean structure to trade against.');
  return out;
}
