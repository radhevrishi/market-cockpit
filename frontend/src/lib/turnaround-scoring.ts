// ════════════════════════════════════════════════════════════════════════════
// TURNAROUND SCORING — PATCH 1080
//
// Pure scorer for the Capex Tracker workbook's Fin series. Distinct from the
// existing `lib/turnaround.ts` (which scores a Row of Screener cells + concall
// narrative). This one consumes the same `Fin` shape MultibaggerStrips eats,
// so the Capex Tracker tab can render a per-company Turnaround view directly
// next to the Multibagger scorecard with no separate ingest.
//
// Framework synthesis from two reference docs uploaded by the user:
//   • Indian_Turnaround_Research.docx   (price/volume + 4-phase Wyckoff)
//   • Turnaround_Investor_Master_Playbook.docx  (6-section scorecard /42)
// ════════════════════════════════════════════════════════════════════════════

export type Fin = {
  years: string[];
  sales: (number | null)[];
  np: (number | null)[];
  pbt: (number | null)[];
  tax?: (number | null)[];
  oi: (number | null)[];
  dep: (number | null)[];
  intr: (number | null)[];
  div?: (number | null)[];
  eq: (number | null)[];
  res: (number | null)[];
  bor: (number | null)[];
  nb: (number | null)[];
  cwip?: (number | null)[];
  cash: (number | null)[];
  recv?: (number | null)[];
  inv?: (number | null)[];
  rm?: (number | null)[];
  chgInv?: (number | null)[];
  ocf?: (number | null)[];
  cfi?: (number | null)[];
  cff?: (number | null)[];
  shares?: (number | null)[];
  price?: (number | null)[];
  mcap?: number | null;
  capex?: (number | null)[];
};

export type TurnaroundPhase =
  | 'PHASE_1_COLLAPSE'
  | 'PHASE_2_STABILISATION'
  | 'PHASE_3_INFLECTION'
  | 'PHASE_4_RE_RATING'
  | 'UNCLASSIFIED';

export type TurnaroundArchetype =
  | 'CYCLICAL'
  | 'OPERATIONAL'
  | 'DISTRESSED'
  | 'UNCLASSIFIED';

export type GateStatus = 'PASS' | 'FAIL' | 'WARN' | 'NA';

export interface SurvivalGate {
  id: string;
  label: string;
  value: number | null;
  thresholdText: string;
  status: GateStatus;
  reason: string;
}

export interface SectionScore {
  id: string;
  label: string;
  score: number;
  max: number;
  pct: number;
  notes: string[];
  gate: boolean;
  status: GateStatus;
}

export interface RedFlag {
  id: string;
  label: string;
  tripped: boolean;
  reason: string;
}

export interface DerivedSeries {
  years: string[];
  sales: number[];
  expenses: number[];
  operatingProfit: number[];
  opmPct: number[];
  ebitda: number[];
  ebitdaMarginPct: number[];
  ebit: number[];
  npm: number[];
  netProfit: number[];
  borrowings: number[];
  cash: number[];
  netDebt: number[];
  equity: number[];
  debtToEquity: number[];
  netDebtToEbitda: number[];
  interestCoverage: number[];
  roce: number[];
  roe: number[];
  assetTurnover: number[];
  cfo: number[];
  cfoOverPat: number[];
  cfoOverEbitda: number[];
  receivableDays: number[];
  inventoryDays: number[];
  salesYoYPct: number[];
  salesAccelerationPct: number[];
  npYoYPct: number[];
  opmDeltaBps: number[];
}

export interface TurnaroundResult {
  company: string;
  asOfYear: string;
  windowYears: string[];
  derived: DerivedSeries;
  troughYearByMetric: { opm: string | null; np: string | null; sales: string | null };
  yearsSinceTrough: number | null;
  recoveryPctFromTrough: { opm: number | null; np: number | null; sales: number | null };
  sections: SectionScore[];
  totalScore: number;
  totalMax: number;
  pct: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'NR';
  gradeColor: string;
  phase: TurnaroundPhase;
  phaseLabel: string;
  phaseColor: string;
  archetype: TurnaroundArchetype;
  archetypeLabel: string;
  gates: SurvivalGate[];
  gateFailCount: number;
  thesisAlive: boolean;
  redFlags: RedFlag[];
  redFlagTrippedCount: number;
  action: 'BUY' | 'STARTER' | 'WATCH' | 'AVOID' | 'SKIP' | 'HEALTHY';
  actionColor: string;
  actionReason: string;
}

const n = (v: number | null | undefined): number => (v == null || !isFinite(v as number) ? NaN : (v as number));
const safe = (v: number): number => (isFinite(v) ? v : 0);
const div = (a: number, b: number): number => (isFinite(a) && isFinite(b) && b !== 0 ? a / b : NaN);

function lastFiniteIndex(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) if (isFinite(arr[i])) return i;
  return -1;
}

function pickWindow(fin: Fin): { idx: number[]; years: string[] } {
  const idx: number[] = [];
  const years: string[] = [];
  for (let i = 0; i < (fin.years || []).length; i++) {
    const s = n(fin.sales?.[i]);
    if (isFinite(s)) { idx.push(i); years.push(String(fin.years[i] || '')); }
  }
  return { idx, years };
}

function pull(arr: (number | null)[] | undefined, idx: number[]): number[] {
  if (!arr) return idx.map(() => NaN);
  return idx.map((i) => n(arr[i]));
}

function deriveAll(fin: Fin): DerivedSeries {
  const { idx, years } = pickWindow(fin);
  const sales = pull(fin.sales, idx);
  const np = pull(fin.np, idx);
  const oi = pull(fin.oi, idx);
  const dep = pull(fin.dep, idx);
  const intr = pull(fin.intr, idx);
  const eq = pull(fin.eq, idx);
  const res = pull(fin.res, idx);
  const bor = pull(fin.bor, idx);
  const cash = pull(fin.cash, idx);
  const nb = pull(fin.nb, idx);
  const recv = pull(fin.recv, idx);
  const inv = pull(fin.inv, idx);
  const ocf = pull(fin.ocf, idx);
  const pbt = pull(fin.pbt, idx);

  const operatingProfit = sales.map((s, i) =>
    !isFinite(s) ? NaN : safe(pbt[i]) + safe(intr[i]) + safe(dep[i]) - safe(oi[i])
  );
  const expenses = sales.map((s, i) => (isFinite(s) ? s - operatingProfit[i] : NaN));
  const opmPct = sales.map((s, i) => (s > 0 ? (operatingProfit[i] / s) * 100 : NaN));
  const ebitda = operatingProfit.map((op, i) => (isFinite(op) ? op + safe(oi[i]) : NaN));
  const ebitdaMarginPct = sales.map((s, i) => (s > 0 ? (ebitda[i] / s) * 100 : NaN));
  const ebit = ebitda.map((e, i) => (isFinite(e) ? e - safe(dep[i]) : NaN));
  const npm = sales.map((s, i) => (s > 0 ? (np[i] / s) * 100 : NaN));
  const equity = eq.map((e, i) => safe(e) + safe(res[i]));
  const debtToEquity = bor.map((b, i) => div(b, equity[i]));
  const netDebt = bor.map((b, i) => b - safe(cash[i]));
  const netDebtToEbitda = netDebt.map((nd, i) => div(nd, ebitda[i]));
  const interestCoverage = ebit.map((e, i) => div(e, intr[i]));
  const capitalEmployed = equity.map((eq, i) => eq + safe(bor[i]));
  const roce = ebit.map((e, i) => (capitalEmployed[i] > 0 ? (e / capitalEmployed[i]) * 100 : NaN));
  const roe = np.map((p, i) => (equity[i] > 0 ? (p / equity[i]) * 100 : NaN));
  const assetTurnover = sales.map((s, i) => div(s, safe(nb[i]) + safe(inv[i]) + safe(recv[i]) + safe(cash[i])));
  const cfo = ocf;
  const cfoOverPat = cfo.map((c, i) => div(c, np[i]));
  const cfoOverEbitda = cfo.map((c, i) => div(c, ebitda[i]));
  const receivableDays = recv.map((r, i) => (sales[i] > 0 ? (r / sales[i]) * 365 : NaN));
  const inventoryDays = inv.map((iv, i) => (sales[i] > 0 ? (iv / sales[i]) * 365 : NaN));
  const salesYoYPct = sales.map((s, i) => (i > 0 && sales[i - 1] > 0 ? ((s / sales[i - 1]) - 1) * 100 : NaN));
  const salesAccelerationPct = salesYoYPct.map((y, i) => (i > 0 && isFinite(y) && isFinite(salesYoYPct[i - 1]) ? y - salesYoYPct[i - 1] : NaN));
  const npYoYPct = np.map((p, i) => (i > 0 && Math.abs(safe(np[i - 1])) > 0 ? ((p - np[i - 1]) / Math.abs(np[i - 1])) * 100 : NaN));
  const opmDeltaBps = opmPct.map((o, i) => (i > 0 && isFinite(o) && isFinite(opmPct[i - 1]) ? (o - opmPct[i - 1]) * 100 : NaN));

  return {
    years, sales, expenses, operatingProfit, opmPct, ebitda, ebitdaMarginPct, ebit, npm,
    netProfit: np, borrowings: bor, cash, netDebt, equity, debtToEquity, netDebtToEbitda,
    interestCoverage, roce, roe, assetTurnover, cfo, cfoOverPat, cfoOverEbitda,
    receivableDays, inventoryDays, salesYoYPct, salesAccelerationPct, npYoYPct, opmDeltaBps,
  };
}

function findTrough(values: number[], years: string[]): { year: string | null; idx: number } {
  let best = -1; let bestVal = Infinity;
  for (let i = 0; i < values.length; i++) {
    if (isFinite(values[i]) && values[i] < bestVal) { bestVal = values[i]; best = i; }
  }
  return { year: best >= 0 ? years[best] : null, idx: best };
}

function buildGates(d: DerivedSeries): SurvivalGate[] {
  const li = lastFiniteIndex(d.sales);
  if (li < 0) return [];
  const gates: SurvivalGate[] = [];

  // PATCH 1080c+d FIX 5 — when EBITDA <= 0 the ratio is meaningless (negative/negative
  // gives a fake "positive" ratio). Fall back to absolute net-debt assessment.
  // PATCH 1080d (BUG B) — when in fallback mode, relabel the row so the user knows
  // the value is ₹ Cr absolute, not a x-multiple.
  const ndE = d.netDebtToEbitda[li];
  const ebitdaLatest = d.ebitda[li];
  const netDebtLatest = d.netDebt[li];
  let ndeStatus: GateStatus; let ndeReason: string; let ndeValue: number | null;
  let ndeLabel = 'Net Debt / EBITDA';
  let ndeThresh = '< 4x green · < 6x ok · > 8x fail';
  if (!isFinite(ebitdaLatest) || ebitdaLatest <= 0) {
    // EBITDA negative/zero — switch the label so the user knows we are reporting ₹ Cr.
    ndeLabel = 'Net Debt absolute (EBITDA negative — ratio not meaningful)';
    ndeThresh = '₹ Cr (negative = net cash · positive = operations cannot service debt)';
    ndeValue = isFinite(netDebtLatest) ? +netDebtLatest.toFixed(0) : null;
    if (!isFinite(netDebtLatest)) { ndeStatus = 'NA'; ndeReason = 'EBITDA <= 0 and net debt missing'; }
    else if (netDebtLatest <= 0) { ndeStatus = 'WARN'; ndeReason = 'EBITDA negative but net cash positive — runway depends on operations recovery'; }
    else { ndeStatus = 'FAIL'; ndeReason = `EBITDA negative AND net debt ${netDebtLatest.toFixed(0)} Cr positive — operations cannot service debt`; }
  } else if (!isFinite(ndE)) { ndeStatus = 'NA'; ndeValue = null; ndeReason = 'Net debt missing'; }
  else { ndeValue = +ndE.toFixed(2);
    ndeStatus = ndE <= 4 ? 'PASS' : ndE <= 6 ? 'WARN' : ndE > 10 ? 'FAIL' : 'WARN';
    ndeReason = ndE <= 4 ? 'Manageable leverage' : ndE > 10 ? 'Capital structure dangerously stretched' : 'Elevated but workable';
  }
  gates.push({ id: 'nd_ebitda', label: ndeLabel,
    value: ndeValue, thresholdText: ndeThresh,
    status: ndeStatus, reason: ndeReason });

  const ic = d.interestCoverage[li];
  gates.push({
    id: 'int_cov', label: 'Interest Coverage (EBIT / Interest)',
    value: isFinite(ic) ? +ic.toFixed(2) : null,
    thresholdText: '> 2.5x green · > 1.5x ok · < 1.0x fail',
    status: !isFinite(ic) ? 'NA' : ic >= 2.5 ? 'PASS' : ic >= 1.5 ? 'WARN' : ic >= 1.0 ? 'WARN' : 'FAIL',
    reason: !isFinite(ic) ? 'EBIT or interest missing' : ic < 1.0 ? 'Operating earnings cannot cover interest' : ic >= 2.5 ? 'Comfortable interest cover' : 'Tight cover',
  });

  // PATCH 1080c FIX 1 — Cash Runway only matters when the business is BURNING cash.
  // Original gate computed months-of-opex coverage, which is irrelevant for a cash-
  // generative business (e.g. AIA Engineering with 224 Cr cash + positive CFO + no
  // debt was flagged as "0.8mo · liquidity crisis"). The playbook concept is months-
  // until-broke-at-current-burn-rate; for profitable companies burn-rate is zero.
  const cash = d.cash[li];
  const cfoLatest = d.cfo[li];
  let runway: number | null = null; let runwayStatus: GateStatus = 'NA'; let runwayReason = '';
  if (!isFinite(cfoLatest)) {
    runwayStatus = 'NA'; runwayReason = 'CFO missing — cannot evaluate burn-rate';
    const monthlyExp = d.expenses[li] / 12;
    runway = monthlyExp > 0 && isFinite(cash) ? +(cash / monthlyExp).toFixed(1) : null;
  } else if (cfoLatest >= 0) {
    runwayStatus = 'PASS';
    runwayReason = `Cash-generative (CFO +${cfoLatest.toFixed(0)} Cr) — burn-rate not a survival concern`;
    const monthlyExp = d.expenses[li] / 12;
    runway = monthlyExp > 0 && isFinite(cash) ? +(cash / monthlyExp).toFixed(1) : null;
  } else {
    const monthlyBurn = -cfoLatest / 12;
    runway = monthlyBurn > 0 && isFinite(cash) ? +(cash / monthlyBurn).toFixed(1) : null;
    if (runway == null) { runwayStatus = 'NA'; runwayReason = 'Cash missing'; }
    else { runwayStatus = runway >= 12 ? 'PASS' : runway >= 6 ? 'WARN' : runway >= 3 ? 'WARN' : 'FAIL';
      runwayReason = runway < 3 ? `Burning ${monthlyBurn.toFixed(0)} Cr/mo — only ${runway.toFixed(1)} months left` :
        runway >= 12 ? `Burning but ${runway.toFixed(1)} months of cushion` : `${runway.toFixed(1)} months at current burn`;
    }
  }
  gates.push({ id: 'cash_runway', label: 'Cash Runway (vs burn rate)',
    value: runway, thresholdText: '≥ 12mo green · < 3mo fail · positive CFO → PASS (not burning)',
    status: runwayStatus, reason: runwayReason });

  // PATCH 1080c FIX 2 — relative debt change from a tiny base is misleading. KAYNES
  // went 28 Cr → 913 Cr (+3163%) but D/E is still 0.19 — that's growth-capex funded
  // by IPO proceeds, not distress. Only FAIL when growth AND D/E now elevated.
  const bor3 = li >= 3 ? d.borrowings[li - 3] : NaN;
  const dRed = isFinite(bor3) && bor3 > 0 ? ((d.borrowings[li] / bor3) - 1) * 100 : NaN;
  const deLatest = d.debtToEquity[li];
  let d3yStatus: GateStatus; let d3yReason: string;
  if (!isFinite(dRed)) { d3yStatus = 'NA'; d3yReason = '3y back data missing'; }
  else if (dRed <= -25) { d3yStatus = 'PASS'; d3yReason = 'Aggressive deleveraging'; }
  else if (dRed <= 0) { d3yStatus = 'WARN'; d3yReason = 'Modest debt change'; }
  else if (dRed > 25 && isFinite(deLatest) && deLatest > 1.5) {
    d3yStatus = 'FAIL'; d3yReason = `Debt up ${dRed.toFixed(0)}% AND D/E now ${deLatest.toFixed(2)} — leverage risk`;
  } else if (dRed > 50 && isFinite(deLatest) && deLatest > 0.75) {
    d3yStatus = 'WARN'; d3yReason = `Debt rising ${dRed.toFixed(0)}% — watch D/E (${deLatest.toFixed(2)})`;
  } else {
    d3yStatus = 'WARN'; d3yReason = `Debt up ${dRed.toFixed(0)}% from low base — D/E still ${isFinite(deLatest) ? deLatest.toFixed(2) : 'n/a'}`;
  }
  gates.push({ id: 'debt_3y', label: 'Debt change over 3 years',
    value: isFinite(dRed) ? +dRed.toFixed(1) : null,
    thresholdText: '≤ -25% green · FAIL only if up >25% AND D/E > 1.5',
    status: d3yStatus, reason: d3yReason });

  // PATCH 1080d (BUG C) — hair-trigger FAIL on CFO/PAT = -0.02 killed companies
  // whose CFO was effectively zero in latest year (AXISCADES, OBSC). FAIL only on
  // meaningful cash drainage (< -0.5) and average-window check: if CFO/PAT was
  // positive on average, the latest-year dip is a working-capital blip not distress.
  const cp = d.cfoOverPat[li];
  const cpWindow = d.cfoOverPat.slice(0, li + 1).filter(isFinite);
  const cpAvg = cpWindow.length > 0 ? cpWindow.reduce((a, b) => a + b, 0) / cpWindow.length : NaN;
  let cpStatus: GateStatus; let cpReason: string;
  if (!isFinite(cp)) { cpStatus = 'NA'; cpReason = 'CFO or PAT missing'; }
  else if (cp >= 0.8) { cpStatus = 'PASS'; cpReason = 'Cash-backed earnings'; }
  else if (cp >= 0.5) { cpStatus = 'WARN'; cpReason = 'Quality gap'; }
  else if (cp >= -0.2) { cpStatus = 'WARN'; cpReason = 'CFO near zero — working-capital blip'; }
  else if (cp < -0.5) { cpStatus = 'FAIL'; cpReason = `Cash flow contradicts reported profit (${cp.toFixed(2)})`; }
  else { cpStatus = 'WARN'; cpReason = 'Mild CFO weakness'; }
  // Downgrade to WARN if the latest-year fail is an outlier vs the multi-year average
  if (cpStatus === 'FAIL' && isFinite(cpAvg) && cpAvg > 0.5) {
    cpStatus = 'WARN'; cpReason = `Latest CFO/PAT ${cp.toFixed(2)} but window average ${cpAvg.toFixed(2)} — likely transient`;
  }
  gates.push({ id: 'cfo_pat', label: 'CFO / PAT (earnings quality)',
    value: isFinite(cp) ? +cp.toFixed(2) : null,
    thresholdText: '≥ 0.8 green · ≥ 0.5 ok · < -0.5 fail · transient blips → WARN',
    status: cpStatus, reason: cpReason });

  const de = d.debtToEquity[li];
  gates.push({
    id: 'de', label: 'Debt / Equity',
    value: isFinite(de) ? +de.toFixed(2) : null,
    thresholdText: '< 0.5 green · < 1.0 ok · > 2.0 fail',
    status: !isFinite(de) ? 'NA' : de < 0.5 ? 'PASS' : de < 1.0 ? 'WARN' : de > 3.0 ? 'FAIL' : 'WARN',
    reason: !isFinite(de) ? 'Equity or debt missing' : de > 3.0 ? 'Equity buffer too thin' : de < 0.5 ? 'Conservative balance sheet' : 'Manageable',
  });

  return gates;
}

function buildRedFlags(d: DerivedSeries, fin: Fin): RedFlag[] {
  const li = lastFiniteIndex(d.sales);
  const flags: RedFlag[] = [];
  if (li < 0) return flags;

  const ndE = d.netDebtToEbitda[li];
  const cfo = d.cfo[li];
  const yearIdx = fin.years.indexOf(d.years[li]);
  const intr = fin.intr && yearIdx >= 0 && fin.intr[yearIdx] != null ? (fin.intr[yearIdx] as number) : NaN;

  flags.push({ id: 'debt_unrefinanceable', label: 'Debt likely unrefinanceable',
    tripped: isFinite(ndE) && ndE > 8 && isFinite(cfo) && isFinite(intr) && cfo < intr,
    reason: 'NetDebt/EBITDA > 8x AND CFO < interest payable' });

  // PATCH 1080c FIX 4 — use TRIMMED peak (drop top 20%) so one-time OPM spikes
  // (e.g. KWALITY FY22 37.6%, NGL FY21 29.8%) don't make 22% OPM look "destroyed".
  const opmW = d.opmPct.slice(0, li + 1).filter(isFinite);
  const opmPrior = opmW.slice(0, opmW.length - 3);
  const opmPriorSorted = [...opmPrior].sort((a, b) => b - a);
  const trimmedPeak = opmPriorSorted.length >= 5
    ? opmPriorSorted[Math.max(1, Math.floor(opmPriorSorted.length * 0.2))]
    : opmPriorSorted.length > 0 ? opmPriorSorted[0] : NaN;
  flags.push({ id: 'permanent_margin_destruction', label: 'Permanent margin destruction',
    tripped: opmW.length >= 4 && isFinite(trimmedPeak) && opmW.slice(-3).every((v) => v < trimmedPeak - 5),
    reason: `Last 3y OPM all > 500bps below trimmed peak (${isFinite(trimmedPeak) ? trimmedPeak.toFixed(1) + '%' : 'n/a'})` });

  flags.push({ id: 'negative_equity', label: 'Negative equity / capital wipeout',
    tripped: isFinite(d.equity[li]) && d.equity[li] < 0,
    reason: 'Equity base eroded below zero' });

  const sharesArr = (fin.shares || []).map((v) => n(v));
  const liAll = lastFiniteIndex(sharesArr);
  if (liAll >= 3 && isFinite(sharesArr[liAll - 3]) && sharesArr[liAll - 3] > 0) {
    const dilut = ((sharesArr[liAll] / sharesArr[liAll - 3]) - 1) * 100;
    flags.push({ id: 'dilution', label: 'Heavy equity dilution', tripped: dilut > 50, reason: 'Share count up > 50% over 3y' });
  } else {
    flags.push({ id: 'dilution', label: 'Heavy equity dilution', tripped: false, reason: 'Share-count history thin' });
  }

  const cpW = d.cfoOverPat.slice(Math.max(0, li - 4), li + 1).filter(isFinite);
  flags.push({ id: 'cfo_below_pat', label: 'CFO chronically < PAT',
    tripped: cpW.length >= 3 && cpW.every((v) => v < 0.5),
    reason: 'CFO/PAT < 0.5 in each of last 3+ years' });

  if (li >= 2) {
    // PATCH 1080c FIX 7 — only flag receivable expansion when sales aren't growing.
    // For real channel-stuffing the receivables outpace sales; for growth companies
    // receivables grow proportionally and that's healthy.
    const recvGrowth = d.years.map((_, i) => (i > 0 && d.receivableDays[i - 1] > 0 ? d.receivableDays[i] - d.receivableDays[i - 1] : 0));
    const recvUp = recvGrowth.slice(-3).every((v) => v > 5);
    const salesRecent = d.salesYoYPct.slice(-3).filter(isFinite);
    const salesStagnant = salesRecent.length > 0 && salesRecent.every((y) => y < 10);
    flags.push({ id: 'receivables', label: 'Receivable days expanding',
      tripped: recvUp && salesStagnant,
      reason: 'Receivable days +5d/yr for 3y AND sales not growing > 10%' });
  } else {
    flags.push({ id: 'receivables', label: 'Receivable days expanding', tripped: false, reason: 'Insufficient history' });
  }

  flags.push({ id: 'op_below_int', label: 'Operating profit < Interest',
    tripped: isFinite(d.ebit[li]) && isFinite(intr) && d.ebit[li] < intr,
    reason: 'Cannot service debt from operations' });

  const sYoY = d.salesYoYPct[li];
  flags.push({ id: 'rev_collapse', label: 'Revenue collapsing',
    tripped: isFinite(sYoY) && sYoY < -25,
    reason: 'Sales down > 25% in latest year' });

  const cwip = fin.cwip && yearIdx >= 0 ? fin.cwip[yearIdx] : null;
  const nb = fin.nb && yearIdx >= 0 ? fin.nb[yearIdx] : null;
  const cwipPct = cwip != null && nb != null && (nb as number) > 0 ? ((cwip as number) / (nb as number)) * 100 : NaN;
  flags.push({ id: 'cwip_elevated', label: 'CWIP / Net Block elevated',
    tripped: isFinite(cwipPct) && cwipPct > 40,
    reason: 'CWIP > 40% of Net Block — capex stalled' });

  flags.push({ id: 'twin_op_loss', label: 'Two consecutive operating losses',
    tripped: li >= 1 && isFinite(d.operatingProfit[li]) && isFinite(d.operatingProfit[li - 1]) && d.operatingProfit[li] < 0 && d.operatingProfit[li - 1] < 0,
    reason: 'OperatingProfit negative in each of last 2 years' });

  return flags;
}

function scoreMacro(d: DerivedSeries): SectionScore {
  const li = lastFiniteIndex(d.sales);
  if (li < 2) return { id: 'macro', label: 'A · Macro alignment', score: 0, max: 10, pct: 0, notes: ['series too thin'], gate: false, status: 'NA' };
  let pts = 4; const notes: string[] = [];
  const recent = d.salesYoYPct.slice(Math.max(0, li - 2), li + 1).filter(isFinite);
  if (recent.length >= 2 && recent[recent.length - 1] > recent[0]) { pts += 2; notes.push(`Sales-growth accelerating: ${recent[0].toFixed(0)}% → ${recent[recent.length - 1].toFixed(0)}%`); }
  const npHist = d.netProfit.slice(0, li + 1);
  const hasLossYear = npHist.some((p) => isFinite(p) && p < 0);
  const latestNPPos = isFinite(d.netProfit[li]) && d.netProfit[li] > 0;
  if (hasLossYear && latestNPPos) { pts += 3; notes.push('Profitability restored after a loss year — macro tailwind'); }
  else if (latestNPPos) pts += 1;
  const opmW = d.opmPct.slice(0, li + 1).filter(isFinite);
  if (opmW.length >= 3) {
    const trough = Math.min(...opmW);
    if (d.opmPct[li] - trough >= 2) { pts += 1; notes.push(`OPM ${d.opmPct[li].toFixed(1)}% vs trough ${trough.toFixed(1)}% — recovery in motion`); }
  }
  pts = Math.max(0, Math.min(10, pts));
  return { id: 'macro', label: 'A · Macro alignment', score: pts, max: 10, pct: pts / 10, notes, gate: false, status: pts >= 6 ? 'PASS' : pts >= 4 ? 'WARN' : 'FAIL' };
}

function scoreSurvival(gates: SurvivalGate[]): SectionScore {
  const failCount = gates.filter((g) => g.status === 'FAIL').length;
  const warnCount = gates.filter((g) => g.status === 'WARN').length;
  const passCount = gates.filter((g) => g.status === 'PASS').length;
  const pts = failCount > 0 ? 0 : passCount + warnCount * 0.5;
  const score = Math.max(0, Math.min(8, pts));
  const notes = failCount > 0 ? [`${failCount} gate FAIL — thesis dead-on-arrival`] : warnCount > 0 ? [`${warnCount} gate WARN — partial cover`] : ['All survival gates pass'];
  return { id: 'survival', label: 'B · Survival [GATE]', score, max: 8, pct: score / 8, notes, gate: true, status: failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS' };
}

function scoreBusiness(d: DerivedSeries): SectionScore {
  const li = lastFiniteIndex(d.sales);
  if (li < 1) return { id: 'business', label: 'C · Business inflection', score: 0, max: 10, pct: 0, notes: ['series too thin'], gate: false, status: 'NA' };
  let pts = 0; const notes: string[] = [];
  const accel = d.salesAccelerationPct[li];
  if (isFinite(accel) && accel > 0) { pts += 3; notes.push(`Sales-growth accelerating (+${accel.toFixed(1)}pp)`); }
  else if (isFinite(accel) && accel > -2) pts += 1;
  const dOPM = d.opmDeltaBps[li];
  if (isFinite(dOPM) && dOPM >= 200) { pts += 2; notes.push(`OPM up ${(dOPM / 100).toFixed(1)}pp YoY`); }
  else if (isFinite(dOPM) && dOPM >= 50) pts += 1;
  if (isFinite(d.cfo[li]) && d.cfo[li] > 0) { pts += 2; notes.push('CFO positive in latest year'); }
  if (li > 0 && isFinite(d.receivableDays[li]) && isFinite(d.receivableDays[li - 1]) && d.receivableDays[li] < d.receivableDays[li - 1]) { pts += 1; notes.push('Receivable days easing'); }
  if (li > 0 && isFinite(d.inventoryDays[li]) && isFinite(d.inventoryDays[li - 1]) && d.inventoryDays[li] < d.inventoryDays[li - 1]) { pts += 1; notes.push('Inventory days easing'); }
  const np = d.netProfit; const npHist = np.slice(0, li + 1).filter(isFinite);
  if (npHist.length >= 3) {
    const trough = Math.min(...npHist);
    if (trough < 0 && np[li] > 0) { pts += 1; notes.push('NP turned positive from loss trough'); }
  }
  pts = Math.max(0, Math.min(10, pts));
  return { id: 'business', label: 'C · Business inflection', score: pts, max: 10, pct: pts / 10, notes, gate: false, status: pts >= 5 ? 'PASS' : pts >= 3 ? 'WARN' : 'FAIL' };
}

function scoreManagement(d: DerivedSeries): SectionScore {
  const li = lastFiniteIndex(d.sales);
  if (li < 2) return { id: 'management', label: 'D · Management', score: 0, max: 8, pct: 0, notes: ['series too thin'], gate: false, status: 'NA' };
  let pts = 2;
  const notes: string[] = ['Base · workbook lacks concall/promoter data — neutral'];
  const bor3 = li >= 3 ? d.borrowings[li - 3] : NaN;
  if (isFinite(bor3) && bor3 > 0) {
    const red = (d.borrowings[li] / bor3) - 1;
    if (red <= -0.25) { pts += 4; notes.push(`Borrowings down ${(red * -100).toFixed(0)}% over 3y — disciplined`); }
    else if (red <= -0.10) { pts += 2; notes.push(`Borrowings down ${(red * -100).toFixed(0)}% over 3y`); }
    else if (red >= 0.50) { pts -= 1; notes.push(`Borrowings UP ${(red * 100).toFixed(0)}% over 3y — leverage drift`); }
  }
  const cpHist = d.cfoOverPat.slice(0, li + 1).filter(isFinite);
  if (cpHist.length >= 2) {
    const half = Math.floor(cpHist.length / 2);
    const earlyAvg = cpHist.slice(0, Math.max(1, half)).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const lateAvg = cpHist.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, cpHist.length - half);
    if (lateAvg > earlyAvg + 0.15) { pts += 2; notes.push(`CFO/PAT quality improving (${earlyAvg.toFixed(2)} → ${lateAvg.toFixed(2)})`); }
  }
  pts = Math.max(0, Math.min(8, pts));
  return { id: 'management', label: 'D · Management', score: pts, max: 8, pct: pts / 8, notes, gate: false, status: pts >= 5 ? 'PASS' : pts >= 3 ? 'WARN' : 'FAIL' };
}

function scoreValuation(d: DerivedSeries, fin: Fin): SectionScore {
  const li = lastFiniteIndex(d.sales);
  let pts = 1; const notes: string[] = [];
  if (li < 0 || !fin.mcap || fin.mcap <= 0) return { id: 'valuation', label: 'E · Valuation', score: pts, max: 6, pct: pts / 6, notes: ['mcap missing — cannot value'], gate: false, status: 'NA' };
  const np = d.netProfit[li];
  const pe = np > 0 ? fin.mcap / np : NaN;
  if (isFinite(pe)) {
    if (pe <= 15) { pts += 3; notes.push(`P/E ${pe.toFixed(1)}x — cheap`); }
    else if (pe <= 25) { pts += 2; notes.push(`P/E ${pe.toFixed(1)}x — fair`); }
    else if (pe <= 40) { pts += 1; notes.push(`P/E ${pe.toFixed(1)}x — full`); }
    else notes.push(`P/E ${pe.toFixed(1)}x — rich`);
  }
  const cfo = d.cfo[li];
  const capex = fin.capex && fin.capex[li] != null ? fin.capex[li] : null;
  const fcf = isFinite(cfo) && capex != null ? cfo - (capex as number) : isFinite(cfo) ? cfo : NaN;
  if (isFinite(fcf) && fcf > 0 && fin.mcap > 0) {
    const fcfYield = (fcf / fin.mcap) * 100;
    if (fcfYield >= 8) { pts += 2; notes.push(`FCF yield ${fcfYield.toFixed(1)}% — generous`); }
    else if (fcfYield >= 4) { pts += 1; notes.push(`FCF yield ${fcfYield.toFixed(1)}% — adequate`); }
  }
  pts = Math.max(0, Math.min(6, pts));
  return { id: 'valuation', label: 'E · Valuation', score: pts, max: 6, pct: pts / 6, notes, gate: false, status: pts >= 3 ? 'PASS' : pts >= 2 ? 'WARN' : 'FAIL' };
}

function scoreTrapCheck(redFlags: RedFlag[]): SectionScore {
  const tripped = redFlags.filter((r) => r.tripped);
  const notes = tripped.length === 0 ? ['No traps tripped — clear'] : tripped.map((t) => t.label);
  return { id: 'trapcheck', label: 'F · Trap check', score: 0, max: 0, pct: 0, notes, gate: tripped.length >= 3, status: tripped.length === 0 ? 'PASS' : tripped.length >= 3 ? 'FAIL' : 'WARN' };
}

function classifyPhase(d: DerivedSeries): { phase: TurnaroundPhase; label: string; color: string } {
  const li = lastFiniteIndex(d.sales);
  if (li < 1) return { phase: 'UNCLASSIFIED', label: 'Unclassified', color: '#5a677d' };
  const sYoY = d.salesYoYPct[li];
  const accel = d.salesAccelerationPct[li];
  const dOPM = d.opmDeltaBps[li];
  const np = d.netProfit[li];
  const npPrev = d.netProfit[li - 1];
  const opmLatest = d.opmPct[li];
  const borTrend = li >= 3 && isFinite(d.borrowings[li - 3]) && d.borrowings[li - 3] > 0 ? (d.borrowings[li] / d.borrowings[li - 3]) - 1 : NaN;
  // PATCH 1080c FIX 4 — use trimmed peak (90th percentile) to ignore one-time spikes.
  const opmW = d.opmPct.slice(0, li + 1).filter(isFinite);
  const opmSorted = [...opmW].sort((a, b) => b - a);
  const peakOPM = opmSorted.length >= 5 ? opmSorted[Math.max(1, Math.floor(opmSorted.length * 0.1))] : opmSorted[0] ?? 0;
  const opmGap = isFinite(opmLatest) ? opmLatest - peakOPM : -100;

  if (isFinite(sYoY) && sYoY < -10 && isFinite(accel) && accel <= 0 && (np < 0 || (isFinite(npPrev) && np < npPrev))) return { phase: 'PHASE_1_COLLAPSE', label: 'PHASE 1 · COLLAPSE', color: '#e24b4a' };
  // PATCH 1080c FIX 3 — Phase 4 now also fires for mature high-margin companies even
  // with mild OPM dip if margins are still strong absolute (>15%) and growing sales.
  if (isFinite(sYoY) && sYoY > 5 && np > 0 && (opmGap > -3 || (isFinite(opmLatest) && opmLatest >= 15)) && (isFinite(borTrend) ? borTrend <= 0.1 : true)) return { phase: 'PHASE_4_RE_RATING', label: 'PHASE 4 · RE-RATING', color: '#4d8fcc' };
  if (isFinite(sYoY) && sYoY > 0 && ((isFinite(dOPM) && dOPM > 0) || (isFinite(opmLatest) && opmLatest >= 15)) && (isFinite(borTrend) ? borTrend <= 0.25 : true)) return { phase: 'PHASE_3_INFLECTION', label: 'PHASE 3 · INFLECTION', color: '#1d9e75' };
  // PATCH 1080c FIX 3 — loosen Phase 2 OPM threshold from -50bps to -300bps so mature
  // companies with normal margin fluctuation still classify (e.g. SUPRITA -200bps).
  if ((isFinite(accel) && accel > 0) || (isFinite(dOPM) && dOPM >= -300) || (isFinite(sYoY) && sYoY > 0)) return { phase: 'PHASE_2_STABILISATION', label: 'PHASE 2 · STABILISATION', color: '#ef9f27' };
  return { phase: 'UNCLASSIFIED', label: 'Unclassified', color: '#5a677d' };
}

function classifyArchetype(d: DerivedSeries): { archetype: TurnaroundArchetype; label: string } {
  const li = lastFiniteIndex(d.sales);
  if (li < 0) return { archetype: 'UNCLASSIFIED', label: 'Unclassified' };
  const ndE = d.netDebtToEbitda[li];
  const de = d.debtToEquity[li];
  if ((isFinite(ndE) && ndE > 6) || (isFinite(de) && de > 2.0)) return { archetype: 'DISTRESSED', label: 'DISTRESSED · capital structure stress' };
  const opmW = d.opmPct.slice(0, li + 1).filter(isFinite);
  if (opmW.length >= 4) {
    const peak = Math.max(...opmW);
    const recent = opmW.slice(-2);
    if (peak - Math.min(...recent) > 8) return { archetype: 'OPERATIONAL', label: 'OPERATIONAL · business model needs reset' };
  }
  return { archetype: 'CYCLICAL', label: 'CYCLICAL · macro-driven setback' };
}

export function scoreTurnaround(fin: Fin | null | undefined, company = ''): TurnaroundResult | null {
  if (!fin || !Array.isArray(fin.years) || fin.years.length === 0) return null;
  const derived = deriveAll(fin);
  if (derived.years.length === 0) return null;

  const gates = buildGates(derived);
  const redFlags = buildRedFlags(derived, fin);
  const sections: SectionScore[] = [scoreMacro(derived), scoreSurvival(gates), scoreBusiness(derived), scoreManagement(derived), scoreValuation(derived, fin), scoreTrapCheck(redFlags)];

  const totalScore = sections.reduce((s, c) => s + c.score, 0);
  const totalMax = sections.reduce((s, c) => s + c.max, 0);
  const pct = totalMax > 0 ? totalScore / totalMax : 0;
  const gateFailCount = sections.filter((s) => s.gate && s.status === 'FAIL').length;
  const thesisAlive = gateFailCount === 0;
  const redFlagTrippedCount = redFlags.filter((r) => r.tripped).length;

  let grade: TurnaroundResult['grade'] = 'NR'; let gradeColor = '#5a677d';
  if (!thesisAlive) { grade = 'D'; gradeColor = '#e24b4a'; }
  else if (pct >= 0.75 && redFlagTrippedCount === 0) { grade = 'A'; gradeColor = '#1d9e75'; }
  else if (pct >= 0.60) { grade = 'B'; gradeColor = '#34d399'; }
  else if (pct >= 0.40) { grade = 'C'; gradeColor = '#ef9f27'; }
  else { grade = 'D'; gradeColor = '#e24b4a'; }

  const phaseInfo = classifyPhase(derived);
  const archInfo = classifyArchetype(derived);

  const troughOpm = findTrough(derived.opmPct, derived.years);
  const troughNp = findTrough(derived.netProfit, derived.years);
  const troughSales = findTrough(derived.sales, derived.years);
  const li = lastFiniteIndex(derived.sales);
  const refTroughIdx = troughOpm.idx >= 0 ? troughOpm.idx : troughNp.idx;
  const yearsSinceTrough = refTroughIdx >= 0 && li >= 0 ? li - refTroughIdx : null;

  const recoveryFromTrough = (curr: number, trough: number): number | null =>
    isFinite(curr) && isFinite(trough) && Math.abs(trough) > 0 ? ((curr - trough) / Math.abs(trough)) * 100 : null;

  const recoveryPctFromTrough = {
    opm: troughOpm.idx >= 0 && li >= 0 ? recoveryFromTrough(derived.opmPct[li], derived.opmPct[troughOpm.idx]) : null,
    np: troughNp.idx >= 0 && li >= 0 ? recoveryFromTrough(derived.netProfit[li], derived.netProfit[troughNp.idx]) : null,
    sales: troughSales.idx >= 0 && li >= 0 ? recoveryFromTrough(derived.sales[li], derived.sales[troughSales.idx]) : null,
  };

  // PATCH 1080c FIX 6 — recognize HEALTHY companies (cash compounders, not turnarounds).
  // A company that's been consistently profitable, low-debt, and has not had a real
  // distress episode isn't a turnaround setup at all — surface it as HEALTHY so the
  // user can quickly filter the growth compounders out of the turnaround universe.
  const npHist = derived.netProfit.filter(isFinite);
  const opmHist = derived.opmPct.filter(isFinite);
  const roceHist = derived.roce.filter(isFinite);
  const everHadLossYear = npHist.some((p) => p < 0);
  const everHadDistressMargin = opmHist.some((o) => o < 5);
  // ROCE distress year (< 8%) = real stumble. SAI Life FY22 ROCE 3.9% → not healthy.
  // AIA's worst ROCE is 16.6% → still healthy (cyclical bottom, not distress).
  const hadRoceDistress = roceHist.length > 0 && Math.min(...roceHist) < 8;
  const latestDE = derived.debtToEquity[li];
  const latestOPM = derived.opmPct[li];
  const isHealthyCompounder = thesisAlive
    && !everHadLossYear && !everHadDistressMargin && !hadRoceDistress
    && isFinite(latestDE) && latestDE < 0.5
    && isFinite(latestOPM) && latestOPM >= 15
    && npHist.length >= 5;

  let action: TurnaroundResult['action'] = 'SKIP'; let actionColor = '#5a677d'; let actionReason = '';
  if (!thesisAlive) { action = 'AVOID'; actionColor = '#e24b4a'; actionReason = `${gateFailCount} survival gate FAIL — capital impairment risk`; }
  else if (isHealthyCompounder) { action = 'HEALTHY'; actionColor = '#22d3ee'; actionReason = 'Cash-generative compounder — not a turnaround setup (no distress episode in the window)'; }
  else if (grade === 'A' && phaseInfo.phase === 'PHASE_3_INFLECTION') { action = 'BUY'; actionColor = '#1d9e75'; actionReason = 'A-grade · Phase 3 inflection — full-position zone'; }
  else if ((grade === 'A' || grade === 'B') && (phaseInfo.phase === 'PHASE_3_INFLECTION' || phaseInfo.phase === 'PHASE_4_RE_RATING')) { action = 'STARTER'; actionColor = '#34d399'; actionReason = `${grade}-grade · ${phaseInfo.label} — starter position`; }
  else if (grade === 'B' || phaseInfo.phase === 'PHASE_2_STABILISATION') { action = 'WATCH'; actionColor = '#ef9f27'; actionReason = 'Build the file — early signal, no position yet'; }
  else if (grade === 'C') { action = 'WATCH'; actionColor = '#ef9f27'; actionReason = 'Marginal score — keep on radar'; }
  else { action = 'SKIP'; actionColor = '#5a677d'; actionReason = 'Score too thin — different opportunity better'; }

  return {
    company, asOfYear: derived.years[li] || '', windowYears: derived.years, derived,
    troughYearByMetric: { opm: troughOpm.year, np: troughNp.year, sales: troughSales.year },
    yearsSinceTrough, recoveryPctFromTrough,
    sections, totalScore, totalMax, pct, grade, gradeColor,
    phase: phaseInfo.phase, phaseLabel: phaseInfo.label, phaseColor: phaseInfo.color,
    archetype: archInfo.archetype, archetypeLabel: archInfo.label,
    gates, gateFailCount, thesisAlive, redFlags, redFlagTrippedCount,
    action, actionColor, actionReason,
  };
}

export default scoreTurnaround;
