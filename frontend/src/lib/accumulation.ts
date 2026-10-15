// zzz1046 — INSTITUTIONAL ACCUMULATION / DISTRIBUTION from price and volume (the "big guys' footprint").
//
// What it is (and is not): volume cannot tell WHO bought. Large funds cannot fill a position in one day, so their buying leaves a
// pattern — heavy volume on up days that close near the high, light volume on pullbacks, money flow and On-Balance Volume rising,
// sometimes ahead of price. This is the classic O'Neil (accumulation / distribution days, A–E rating) and Wyckoff reading of that
// footprint. Every figure here is our own version of those published rules, read on COMPLETED bars only. India adds a better clue
// when the NSE file carries it: delivery % (shares actually taken into demat, not day-traded).
//
// Inputs: ascending bars (daily on the screener; whatever candles are on screen on the chart — the same rules then read "bars").
// Pure: no network, no React.
//
// ── per-bar readings (bar i; V = average volume of the 50 bars BEFORE i) ─────────────────────────────────────────────────────
//   CLV (close location)  ((c − l) − (h − c)) ÷ (h − l), −1 … +1 (0 when h = l)   — +1 = closed on the high
//   accumulation bar      change ≥ +1%, volume ≥ 1.25 × V, CLV ≥ 0
//   distribution bar      change ≤ −1%, volume ≥ 1.25 × V, CLV ≤ 0
//   stalling (churn)      |change| < 0.5%, volume ≥ 1.5 × V, CLV < −0.3 — heavy selling into strength, counted as distribution
//   volume breakout       up bar closing above every close of the prior 50 bars, volume ≥ 1.5 × V, CLV ≥ 0.25
//   CMF(n)                Σ(CLV × volume) ÷ Σ volume over n bars (Chaikin Money Flow)
//   OBV                   + volume on an up close, − volume on a down close, running total
//
// ── figures (last bar) ────────────────────────────────────────────────────────────────────────────────────────────────────────
//   accD / disD / chD     accumulation / distribution (incl. stalling) / stalling bars in the last 25
//   cmf21 / cmf65         money flow over 21 and 65 bars (65 ≈ 13 weeks, the A/D-rating window)
//   udv50                 up-bar volume ÷ down-bar volume, last 50 bars
//   obvSlope              OBV trend over 50 bars, in "average bars of volume per bar" (≈ −1 … +1)
//   obvLead               +1 OBV at its 120-bar high while price is not (stealth accumulation) · −1 price at its high while OBV
//                         is well below its own (unconfirmed high) · 0 otherwise
//   bigUpW / bigDnW       completed weeks (last 10) with volume ≥ 1.5 × the prior 10-week average closing up in the top half /
//                         down in the bottom half (daily input only)
//   vdu                   1 = quiet pullback: below the 50-bar high close, within 15% of it, and the down bars of the last 10
//                         averaged under 0.75 × V (sellers absent) · 0 = pullback on heavy down volume · null = not pulling back
//   vboD / vboX           bars since the latest volume breakout in the last 10 (null = none) and its volume ÷ V
//   accS / accG           score 0–100 and grade A–E (see accScore) · distWarn = 1 when distribution is piling up
//   dlv10 / dlvChg        India: average delivery % of the last 10 sessions, and minus the 40 before (percentage points)
export const ACC_VERSION = 1;
export const ACC_RULES = { avgN: 50, window: 25, accChg: 0.01, accVol: 1.25, churnChg: 0.005, churnVol: 1.5, churnClv: -0.3, vboVol: 1.5, vboClv: 0.25, minBars: 70 } as const;

export interface VolBars { d?: readonly string[]; o?: readonly number[]; h: readonly number[]; l: readonly number[]; c: readonly number[]; v: readonly number[]; dlv?: ReadonlyArray<number | null | undefined> }
export type AccKind = 'acc' | 'dist' | 'churn' | 'vbo';
export interface AccSeries { kind: Array<AccKind | null>; clv: number[]; avgV: Array<number | null>; volX: Array<number | null>; cmf21: Array<number | null>; obv: number[] }
export type AccGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export interface AccFigures {
  accV: number;
  accS: number | null; accG: AccGrade | null; distWarn: 0 | 1 | null;
  accD: number | null; disD: number | null; chD: number | null;
  cmf21: number | null; cmf65: number | null; udv50: number | null;
  obvSlope: number | null; obvLead: -1 | 0 | 1 | null;
  bigUpW: number | null; bigDnW: number | null;
  vdu: 0 | 1 | null; vboD: number | null; vboX: number | null;
  dlv10: number | null; dlvChg: number | null;
  /** the points behind accS (for the explanation) */
  parts?: { ad: number; days: number; udv: number; obv: number; weeks: number; pull: number };
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Close location value, −1 (closed on the low) … +1 (on the high); 0 for a bar with no range or bad data. */
export function closeLocation(h: number, l: number, c: number): number {
  if (!fin(h) || !fin(l) || !fin(c) || !(h > l)) return 0;
  const x = ((c - l) - (h - c)) / (h - l);
  return x > 1 ? 1 : x < -1 ? -1 : x;
}

/** Per-bar readings for the whole series (chart markers and the figures both use these). */
export function accumulationSeries(b: VolBars): AccSeries {
  const n = b.c.length;
  const kind: Array<AccKind | null> = new Array(n).fill(null);
  const clv = new Array<number>(n).fill(0), avgV: Array<number | null> = new Array(n).fill(null), volX: Array<number | null> = new Array(n).fill(null);
  const cmf21: Array<number | null> = new Array(n).fill(null), obv = new Array<number>(n).fill(0);
  const N = ACC_RULES.avgN;
  let vSum = 0, vCnt = 0;   // rolling sum of the previous N volumes
  let mfv = 0, vv = 0;      // rolling CMF(21) sums
  for (let i = 0; i < n; i++) {
    const v = fin(b.v[i]) && b.v[i] > 0 ? b.v[i] : 0;
    clv[i] = closeLocation(b.h[i], b.l[i], b.c[i]);
    if (vCnt >= N) avgV[i] = vSum / vCnt;
    // OBV
    if (i > 0) obv[i] = obv[i - 1] + (b.c[i] > b.c[i - 1] ? v : b.c[i] < b.c[i - 1] ? -v : 0);
    // CMF(21)
    mfv += clv[i] * v; vv += v;
    if (i >= 21) { const vo = fin(b.v[i - 21]) && b.v[i - 21] > 0 ? b.v[i - 21] : 0; mfv -= clv[i - 21] * vo; vv -= vo; }
    if (i >= 20 && vv > 0) cmf21[i] = r2(mfv / vv);
    // classify
    const A = avgV[i];
    if (A != null && A > 0 && i > 0 && b.c[i - 1] > 0 && v > 0) {
      const x = v / A, ch = b.c[i] / b.c[i - 1] - 1;
      volX[i] = r2(x);
      let hiPrev = -Infinity; for (let j = Math.max(0, i - N); j < i; j++) if (b.c[j] > hiPrev) hiPrev = b.c[j];
      if (ch > 0 && b.c[i] > hiPrev && x >= ACC_RULES.vboVol && clv[i] >= ACC_RULES.vboClv) kind[i] = 'vbo';
      else if (ch >= ACC_RULES.accChg && x >= ACC_RULES.accVol && clv[i] >= 0) kind[i] = 'acc';
      else if (ch <= -ACC_RULES.accChg && x >= ACC_RULES.accVol && clv[i] <= 0) kind[i] = 'dist';
      else if (Math.abs(ch) < ACC_RULES.churnChg && x >= ACC_RULES.churnVol && clv[i] < ACC_RULES.churnClv) kind[i] = 'churn';
    }
    // roll the previous-N window forward (this bar becomes "previous" for the next one)
    vSum += v; vCnt++;
    if (vCnt > N) { const vo = fin(b.v[i - N]) && b.v[i - N] > 0 ? b.v[i - N] : 0; vSum -= vo; vCnt--; }
  }
  return { kind, clv, avgV, volX, cmf21, obv };
}

function cmfOver(clv: readonly number[], v: readonly number[], from: number, to: number): number | null {
  let a = 0, s = 0;
  for (let i = Math.max(0, from); i <= to; i++) { const x = fin(v[i]) && v[i] > 0 ? v[i] : 0; a += clv[i] * x; s += x; }
  return s > 0 ? r2(a / s) : null;
}

/** Weekly volume reading from daily bars with dates: completed weeks only (`weekDone(mondayKey)`). */
function bigWeeks(b: VolBars, weekDone: ((mon: string) => boolean) | undefined): { up: number; dn: number } | null {
  if (!b.d || b.d.length !== b.c.length) return null;
  type W = { k: string; o: number; h: number; l: number; c: number; v: number };
  const weeks: W[] = [];
  for (let i = 0; i < b.c.length; i++) {
    const t = Date.parse(`${b.d[i]}T00:00:00Z`);
    if (!fin(t)) continue;
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    const k = new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
    const w = weeks[weeks.length - 1];
    const v = fin(b.v[i]) && b.v[i] > 0 ? b.v[i] : 0;
    if (w && w.k === k) { w.h = Math.max(w.h, b.h[i]); w.l = Math.min(w.l, b.l[i]); w.c = b.c[i]; w.v += v; }
    else weeks.push({ k, o: b.o?.[i] ?? b.c[i], h: b.h[i], l: b.l[i], c: b.c[i], v });
  }
  if (weeks.length && weekDone && !weekDone(weeks[weeks.length - 1].k)) weeks.pop();
  if (weeks.length < 21) return null;
  let up = 0, dn = 0;
  for (let i = weeks.length - 10; i < weeks.length; i++) {
    let s = 0; for (let j = i - 10; j < i; j++) s += weeks[j].v;
    const avg = s / 10, w = weeks[i], prev = weeks[i - 1].c, cl = closeLocation(w.h, w.l, w.c);
    if (!(avg > 0) || w.v < 1.5 * avg) continue;
    if (w.c > prev && cl >= 0) up++; else if (w.c < prev && cl <= 0) dn++;
  }
  return { up, dn };
}

/** The grade for a score: A ≥ 80 heavy accumulation · B ≥ 65 · C ≥ 45 neutral · D ≥ 30 · E < 30 heavy distribution. */
export function accGrade(s: number | null | undefined): AccGrade | null {
  if (!fin(s)) return null;
  return s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 45 ? 'C' : s >= 30 ? 'D' : 'E';
}

/** Score 0–100 from the figures: A/D money flow 25 · accumulation − distribution bars 20 · up/down volume 15 · OBV 15 ·
 *  big-volume weeks 15 · pullback volume 10. A part whose figure is unknown counts as neutral (half its points) and is named. */
export function accScore(f: Pick<AccFigures, 'cmf65' | 'accD' | 'disD' | 'udv50' | 'obvSlope' | 'obvLead' | 'bigUpW' | 'bigDnW' | 'vdu'>): { score: number; parts: NonNullable<AccFigures['parts']> } {
  const ad = fin(f.cmf65) ? clamp01((f.cmf65 + 0.2) / 0.4) * 25 : 12.5;
  const days = fin(f.accD) && fin(f.disD) ? clamp01((f.accD - f.disD + 5) / 10) * 20 : 10;
  const udv = fin(f.udv50) ? clamp01((f.udv50 - 0.7) / 0.9) * 15 : 7.5;
  let obv = fin(f.obvSlope) ? clamp01((f.obvSlope + 0.3) / 0.6) * 10 : 5;
  if (f.obvLead === 1) obv += 5; else if (f.obvLead === -1) obv -= 5; else obv += 2.5;
  obv = Math.max(0, Math.min(15, obv));
  const weeks = fin(f.bigUpW) && fin(f.bigDnW) ? clamp01((f.bigUpW - f.bigDnW + 2) / 4) * 15 : 7.5;
  const pull = f.vdu === 1 ? 10 : f.vdu === 0 ? 0 : 5;
  const parts = { ad: r1(ad), days: r1(days), udv: r1(udv), obv: r1(obv), weeks: r1(weeks), pull };
  return { score: Math.round(ad + days + udv + obv + weeks + pull), parts };
}

/** Figures on the last bar. `weekDone(mondayKey)` says whether a week has closed (pass completed-weeks; omit on non-daily bars). */
export function accumulationFigures(b: VolBars, opts: { weekDone?: (mon: string) => boolean; daily?: boolean } = {}): AccFigures {
  const n = b.c.length;
  const blank: AccFigures = { accV: ACC_VERSION, accS: null, accG: null, distWarn: null, accD: null, disD: null, chD: null, cmf21: null, cmf65: null, udv50: null, obvSlope: null, obvLead: null, bigUpW: null, bigDnW: null, vdu: null, vboD: null, vboX: null, dlv10: null, dlvChg: null };
  // volume must be real: a series without volume (an index, a bad feed) says nothing
  const volBars = b.v.reduce((k, x) => k + (fin(x) && x > 0 ? 1 : 0), 0);
  const out: AccFigures = { ...blank, ...deliveryFigures(b.dlv) };
  if (n < ACC_RULES.minBars || volBars < n * 0.8) return out;
  const s = accumulationSeries(b);
  const L = n - 1, W = ACC_RULES.window;
  let accD = 0, disD = 0, chD = 0;
  for (let i = n - W; i < n; i++) { const k = s.kind[i]; if (k === 'acc' || k === 'vbo') accD++; else if (k === 'dist') disD++; else if (k === 'churn') { disD++; chD++; } }
  out.accD = accD; out.disD = disD; out.chD = chD;
  out.cmf21 = s.cmf21[L];
  out.cmf65 = cmfOver(s.clv, b.v, n - 65, L);
  let upV = 0, dnV = 0;
  for (let i = n - 50; i < n; i++) { const v = fin(b.v[i]) ? b.v[i] : 0; if (b.c[i] > b.c[i - 1]) upV += v; else if (b.c[i] < b.c[i - 1]) dnV += v; }
  out.udv50 = dnV > 0 ? r2(upV / dnV) : null;
  // OBV slope (least squares over 50 bars) in units of the average volume
  const A = s.avgV[L];
  if (A != null && A > 0) {
    const m = 50; let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let k = 0; k < m; k++) { const y = s.obv[n - m + k]; sx += k; sy += y; sxy += k * y; sxx += k * k; }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    out.obvSlope = r2(Math.max(-2, Math.min(2, slope / A)));
  }
  // OBV lead / lag against price over 120 bars (or all, when shorter)
  const from = Math.max(0, n - 120);
  let oHi = -Infinity, oLo = Infinity, pHi = -Infinity;
  for (let i = from; i < n; i++) { if (s.obv[i] > oHi) oHi = s.obv[i]; if (s.obv[i] < oLo) oLo = s.obv[i]; if (b.c[i] > pHi) pHi = b.c[i]; }
  const range = oHi - oLo;
  if (range > 0) {
    const obvAtHigh = s.obv[L] >= oHi - 0.02 * range, priceAtHigh = b.c[L] >= pHi * 0.97;
    out.obvLead = obvAtHigh && !priceAtHigh ? 1 : priceAtHigh && s.obv[L] < oHi - 0.15 * range ? -1 : 0;
  }
  // weekly big-volume weeks (daily input with dates only)
  if (opts.daily !== false) { const w = bigWeeks(b, opts.weekDone); if (w) { out.bigUpW = w.up; out.bigDnW = w.dn; } }
  // quiet pullback
  let hi50 = -Infinity; for (let i = n - 50; i < n; i++) if (b.c[i] > hi50) hi50 = b.c[i];
  if (A != null && A > 0 && b.c[L] < hi50 && b.c[L] >= hi50 * 0.85) {
    let dv = 0, dk = 0;
    for (let i = n - 10; i < n; i++) if (b.c[i] < b.c[i - 1]) { dv += fin(b.v[i]) ? b.v[i] : 0; dk++; }
    out.vdu = dk === 0 || dv / dk < 0.75 * A ? 1 : 0;
  }
  // latest volume breakout in the last 10 bars
  for (let i = L; i >= n - 10; i--) if (s.kind[i] === 'vbo') { out.vboD = L - i; out.vboX = s.volX[i]; break; }
  const sc = accScore(out);
  out.accS = sc.score; out.accG = accGrade(sc.score); out.parts = sc.parts;
  out.distWarn = disD >= 5 || (out.obvLead === -1 && fin(out.cmf21) && out.cmf21 < -0.05) ? 1 : 0;
  return out;
}

/** India delivery %: average of the last 10 known sessions and its change against the 40 before (needs ≥ 8 and ≥ 20 values). */
export function deliveryFigures(dlv: VolBars['dlv']): { dlv10: number | null; dlvChg: number | null } {
  if (!dlv || !dlv.length) return { dlv10: null, dlvChg: null };
  const vals = dlv.map((x) => (fin(x) && x >= 0 && x <= 100 ? x : null));
  const n = vals.length;
  const last = vals.slice(Math.max(0, n - 10)).filter(fin), prev = vals.slice(Math.max(0, n - 50), Math.max(0, n - 10)).filter(fin);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const d10 = last.length >= 8 ? r1(avg(last)) : null;
  return { dlv10: d10, dlvChg: d10 != null && prev.length >= 20 ? r1(d10 - avg(prev)) : null };
}

export const ACC_GRADE_WORD: Record<AccGrade, string> = {
  A: 'heavy accumulation', B: 'accumulation', C: 'neutral', D: 'distribution', E: 'heavy distribution',
};
export const ACC_HONESTY = 'Read from price and volume only: it shows heavy buying or selling, not who did it. Our own version of the published O\'Neil / Wyckoff rules, on completed bars.';

/** Plain-English lines for a detail panel / tooltip. `bar` = 'session' on daily, 'week' / 'month' on other candles. */
export function accExplain(f: AccFigures, bar = 'session', market?: 'US' | 'IN'): string[] {
  if (f.accS == null) return [`Not enough history: needs ${ACC_RULES.minBars} ${bar}s with volume.`];
  const p = f.parts;
  const sg = (x: number) => `${x > 0 ? '+' : ''}${x}`;
  const lines = [
    `Accumulation ${f.accG} (${ACC_GRADE_WORD[f.accG!]}) — score ${f.accS}/100`,
    `Last 25 ${bar}s: ${f.accD} accumulation ${bar}s (up ≥ 1% on ≥ 1.25× average volume) vs ${f.disD} distribution${f.chD ? ` (incl. ${f.chD} stalling)` : ''}${p ? ` · ${p.days}/20` : ''}`,
    f.cmf65 != null ? `Money flow 13 weeks ${sg(f.cmf65)}, 21 ${bar}s ${f.cmf21 != null ? sg(f.cmf21) : '—'} (closes near the high on volume = positive)${p ? ` · ${p.ad}/25` : ''}` : '',
    f.udv50 != null ? `Up-${bar} volume ÷ down-${bar} volume, 50 ${bar}s: ${f.udv50}${p ? ` · ${p.udv}/15` : ''}` : '',
    f.obvLead === 1 ? `On-Balance Volume at its 120-${bar} high while price is not — buying ahead of price (stealth accumulation)` : f.obvLead === -1 ? 'Price near its high but On-Balance Volume well below its own — the high is not confirmed by volume' : f.obvSlope != null ? `On-Balance Volume trend ${sg(f.obvSlope)}${p ? ` · ${p.obv}/15` : ''}` : '',
    f.bigUpW != null ? `Last 10 completed weeks: ${f.bigUpW} big-volume up weeks, ${f.bigDnW} big-volume down weeks${p ? ` · ${p.weeks}/15` : ''}` : '',
    f.vdu === 1 ? 'Pullback on light volume — sellers are not pressing (constructive)' : f.vdu === 0 ? 'Pullback on heavy down volume — sellers active' : '',
    f.vboD != null ? `Volume breakout ${f.vboD === 0 ? 'on the last' : `${f.vboD} ${bar}${f.vboD === 1 ? '' : 's'} ago`}: new 50-${bar} closing high on ${f.vboX}× average volume` : '',
    f.distWarn ? '⚠ Distribution is piling up — heavy selling days or a high that volume does not confirm' : '',
    market === 'IN' && f.dlv10 != null ? `Delivery ${f.dlv10}% of traded shares (10-session average)${f.dlvChg != null ? `, ${sg(f.dlvChg)} pts vs the 40 sessions before` : ''} — higher delivery = more shares kept, not day-traded` : '',
    ACC_HONESTY,
  ];
  return lines.filter(Boolean);
}
