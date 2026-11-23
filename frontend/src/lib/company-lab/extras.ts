// ═══════════════════════════════════════════════════════════════════════════
// COMPANY LAB — valuation, capital efficiency, entry, catalysts, ownership, stage check (zzz1295). Pure.
//   • Valuation: trailing P/E (the stock screener's), P/S, EV / revenue, PEG = P/E ÷ EPS growth (TTM growth, else the
//     3-year EPS CAGR; only when growth is positive). No forward P/E: we keep no analyst estimates — said, never guessed.
//   • Capital efficiency: ROCE (TTM and last full year, and the year before), ROE.
//   • Entry: % above / below the 50-day and 30-week (150-day) average, % under the 52-week high, average day range.
//   • Catalysts: last result date, the next one ESTIMATED as last + ~91 days (companies file quarterly; said as an estimate),
//     guidance raised in the last 120 days.
//   • Ownership (India): promoter %, its change over the last four quarters, FII + DII; pledge is not in our data (said so).
//   • Stage check: a confirmed weekly Stage 2 is flagged when price is 5%+ under the 30-week line this week (broken, read as
//     Stage 3 in the score) or the stock lags its index over the year (RS vs index under 1.0 — lagging Stage 2).
// ═══════════════════════════════════════════════════════════════════════════

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const DAY = 86_400_000;

export interface LabExtras {
  pe: number | null; ps: number | null; evRev: number | null; peg: number | null; pegFrom: string | null;
  roce: number | null; roceFY: number | null; rocePrev: number | null; roe: number | null;
  ext50: number | null; ext150: number | null; ext200: number | null; fromHigh: number | null; adr: number | null;
  lastResult: string | null; nextResultEst: string | null; daysToNext: number | null; guidanceUp: string | null;
  prom: number | null; promChg: number | null; promFrom: string | null; inst: number | null;
  stageCheck: { effective: number | null; flag: 'broken' | 'lagging' | null; text: string | null };
}

export function labExtras(x: {
  row: any | null; epsCagr3: number | null; lastResult: string | null; guidanceUp: string | null;
  shpQ?: { h: string[]; prom: (number | null)[]; fii: (number | null)[]; dii: (number | null)[] } | null;
  stage: number | null; rsRatio: number | null; now?: number;
}): LabExtras {
  const r = x.row || {};
  const now = x.now ?? Date.now();
  const pe = fin(r.pe) && r.pe > 0 ? r1(r.pe) : null;
  const g = fin(r.epsTTMYoY) && r.epsTTMYoY > 0 && r.epsTTMYoY < 300 ? r.epsTTMYoY : fin(x.epsCagr3) && x.epsCagr3 > 0 ? x.epsCagr3 : null;
  const peg = pe != null && g != null ? Math.round((pe / g) * 100) / 100 : null;
  const pegFrom = peg == null ? null : fin(r.epsTTMYoY) && r.epsTTMYoY > 0 && r.epsTTMYoY < 300 ? `P/E ${pe} ÷ EPS growth ${r1(r.epsTTMYoY)}% (trailing 12 months)` : `P/E ${pe} ÷ EPS growth ${x.epsCagr3}% a year (3-year)`;
  const px = fin(r.px) ? r.px : null;
  const pctOf = (a: number | null, b: unknown) => (a != null && fin(b) && b > 0 ? r1((a / b - 1) * 100) : null);
  // latest result: the screener's results date (days since 1970) or the bench record's date
  const ld = fin(r.earnD) ? new Date(r.earnD * DAY).toISOString().slice(0, 10) : x.lastResult && /^\d{4}-\d{2}-\d{2}/.test(x.lastResult) ? x.lastResult.slice(0, 10) : null;
  let next: string | null = null, days: number | null = null;
  if (ld) {
    let t = Date.parse(ld) + 91 * DAY;
    while (t < now - 20 * DAY) t += 91 * DAY;   // a result missed in our data: roll on one quarter at a time
    next = new Date(t).toISOString().slice(0, 10); days = Math.round((t - now) / DAY);
  }
  // promoter holding change over the last four quarters (India)
  let prom: number | null = fin(r.prom) ? r.prom : null, promChg: number | null = null, promFrom: string | null = null, inst: number | null = null;
  const q = x.shpQ;
  if (q?.h?.length) {
    const idx = q.prom.map((v, i) => (fin(v) ? i : -1)).filter((i) => i >= 0);
    if (idx.length) {
      const L = idx[idx.length - 1], F = idx.find((i) => i >= L - 4) ?? idx[0];
      if (prom == null) prom = q.prom[L];
      if (F !== L) { promChg = r1(q.prom[L]! - q.prom[F]!); promFrom = `${q.h[F]} → ${q.h[L]}`; }
      const fi = q.fii[q.fii.length - 1], di = q.dii[q.dii.length - 1];
      if (fin(fi) || fin(di)) inst = r1((fin(fi) ? fi : 0) + (fin(di) ? di : 0));
    }
  }
  // stage check
  const ext150 = pctOf(px, r.sma150);
  let stageCheck: LabExtras['stageCheck'] = { effective: x.stage, flag: null, text: null };
  if (x.stage === 2 && ext150 != null && ext150 <= -5) stageCheck = { effective: 3, flag: 'broken', text: `confirmed Stage 2 on completed weeks, but the price is ${Math.abs(ext150)}% under the 30-week average now — read as breaking down` };
  else if (x.stage === 2 && fin(x.rsRatio) && x.rsRatio < 1) stageCheck = { effective: 2, flag: 'lagging', text: `Stage 2, but it has lagged its index over the year (RS vs index ${x.rsRatio.toFixed(2)}×) — a laggard, not a leader` };
  return {
    pe, ps: fin(r.ps) && r.ps > 0 ? r1(r.ps) : null, evRev: fin(r.evRev) && r.evRev > 0 ? r1(r.evRev) : null, peg, pegFrom,
    roce: fin(r.roceTTM) ? r.roceTTM : null, roceFY: fin(r.roceFY) ? r.roceFY : null, rocePrev: fin(r.roceP) ? r.roceP : null, roe: fin(r.roeTTM) ? r.roeTTM : fin(r.roeFY) ? r.roeFY : null,
    ext50: pctOf(px, r.sma50), ext150, ext200: pctOf(px, r.sma200), fromHigh: px != null && fin(r.hi52) && r.hi52 > 0 ? r1((px / r.hi52 - 1) * 100) : null, adr: fin(r.adrP) ? r1(r.adrP) : null,
    lastResult: ld, nextResultEst: next, daysToNext: days, guidanceUp: x.guidanceUp,
    prom, promChg, promFrom, inst, stageCheck,
  };
}
