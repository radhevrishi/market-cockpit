'use client';

// ============================================================================
// zzz196 — PORTFOLIO PROBABILITY SIMULATOR
// Monte Carlo simulator for concentrated-investing strategies. Given win-rate,
// avg winner, avg loser, position count and size, holding period — runs N
// simulations and reports probability-weighted CAGR, best/base/worst-case
// outcomes, max drawdown estimate, and probability of hitting >20% CAGR.
// ============================================================================

import { useMemo, useState, useCallback } from 'react';

const COL = {
  bg: '#0B0F14',
  panel: '#0F141B',
  panel2: '#121821',
  line: '#1E2632',
  line2: '#2A3444',
  txt: '#E5ECF4',
  muted: '#7B8898',
  cyan: '#22D3EE',
  green: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  violet: '#A78BFA',
  blue: '#60A5FA',
};

// ── Types ────────────────────────────────────────────────────────────────────
type Inputs = {
  capital: number;
  positions: number;
  positionSize: number; // fraction, e.g. 0.10 for 10%
  winRate: number;      // fraction, e.g. 0.60
  avgWinner: number;    // fraction, e.g. 0.40
  avgLoser: number;     // fraction, e.g. -0.15 (negative)
  years: number;
  sims: number;
  rebalance: 'annual' | 'quarterly';
};

type SimResult = {
  finalValues: number[];   // final portfolio value each sim
  cagrs: number[];         // CAGR each sim
  maxDrawdowns: number[];  // worst peak-to-trough within each sim
  sampleEquity: number[][]; // a few equity curves for the chart
  years: number;
};

// ── Scenario presets ─────────────────────────────────────────────────────────
const SCENARIOS: { key: string; name: string; blurb: string; color: string; inputs: Partial<Inputs> }[] = [
  {
    key: 'conservative',
    name: 'Conservative',
    blurb: '55% win · +25% winners · -10% losers · steady compounding',
    color: COL.blue,
    inputs: { winRate: 0.55, avgWinner: 0.25, avgLoser: -0.10 },
  },
  {
    key: 'quality',
    name: 'Quality Growth',
    blurb: '60% win · +40% winners · -15% losers · your default framework',
    color: COL.green,
    inputs: { winRate: 0.60, avgWinner: 0.40, avgLoser: -0.15 },
  },
  {
    key: 'aggressive',
    name: 'Aggressive Multibagger',
    blurb: '45% win · +100% winners · -20% losers · high variance / high reward',
    color: COL.amber,
    inputs: { winRate: 0.45, avgWinner: 1.00, avgLoser: -0.20 },
  },
  {
    key: 'poor',
    name: 'Poor Edge',
    blurb: '45% win · +20% winners · -20% losers · negative expectancy trap',
    color: COL.red,
    inputs: { winRate: 0.45, avgWinner: 0.20, avgLoser: -0.20 },
  },
];

const DEFAULTS: Inputs = {
  capital: 100_000,
  positions: 10,
  positionSize: 0.10,
  winRate: 0.60,
  avgWinner: 0.40,
  avgLoser: -0.15,
  years: 5,
  sims: 10_000,
  rebalance: 'annual',
};

// ── Monte Carlo core ─────────────────────────────────────────────────────────
// Each period: for each position, sample winner (prob=winRate, return=avgWinner)
// else loser (return=avgLoser). Portfolio period return = positionSize * sum(returns).
// Rebalance = redistribute to equal weights each period.
// Note: with N positions × positionSize each, cash weight = 1 - N*positionSize.
// Cash earns 0 (conservative). We model exactly what the user typed.
function runMonteCarlo(inp: Inputs): SimResult {
  const { positions, positionSize, winRate, avgWinner, avgLoser, years, sims, rebalance, capital } = inp;
  const periodsPerYear = rebalance === 'annual' ? 1 : 4;
  const totalPeriods = years * periodsPerYear;
  // Per-period scaling of arithmetic returns: quarterly gets 1/periodsPerYear share.
  const perPeriodWin = Math.pow(1 + avgWinner, 1 / periodsPerYear) - 1;
  const perPeriodLoss = Math.pow(1 + avgLoser, 1 / periodsPerYear) - 1;

  const finalValues: number[] = new Array(sims);
  const cagrs: number[] = new Array(sims);
  const maxDrawdowns: number[] = new Array(sims);
  const sampleEquity: number[][] = [];
  const sampleIndices = new Set<number>();
  const nSamples = 25;
  for (let i = 0; i < nSamples; i++) sampleIndices.add(Math.floor((i / nSamples) * sims));

  for (let s = 0; s < sims; s++) {
    let value = capital;
    let peak = capital;
    let maxDd = 0;
    const curve: number[] = [];
    const collect = sampleIndices.has(s);
    if (collect) curve.push(value);
    for (let t = 0; t < totalPeriods; t++) {
      // Sample N position returns for this period.
      let sumReturns = 0;
      for (let p = 0; p < positions; p++) {
        const r = Math.random() < winRate ? perPeriodWin : perPeriodLoss;
        sumReturns += r;
      }
      // Portfolio return = positionSize * sum(positionReturns) (remaining cash returns 0)
      const portRet = positionSize * sumReturns;
      value = value * (1 + portRet);
      if (value > peak) peak = value;
      const dd = value / peak - 1; // <= 0
      if (dd < maxDd) maxDd = dd;
      if (collect) curve.push(value);
    }
    finalValues[s] = value;
    cagrs[s] = Math.pow(value / capital, 1 / years) - 1;
    maxDrawdowns[s] = maxDd;
    if (collect) sampleEquity.push(curve);
  }

  return { finalValues, cagrs, maxDrawdowns, sampleEquity, years };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}
function median(arr: number[]): number { return percentile(arr, 0.5); }
function mean(arr: number[]): number { return arr.reduce((a, b) => a + b, 0) / (arr.length || 1); }
function fmtPct(x: number, dp = 1): string { return (x * 100).toFixed(dp) + '%'; }
function fmtSignedPct(x: number, dp = 1): string {
  const s = (x * 100).toFixed(dp);
  return (x >= 0 ? '+' : '') + s + '%';
}
function fmtMoney(x: number): string {
  if (x >= 1e7) return '₹' + (x / 1e7).toFixed(2) + ' Cr';
  if (x >= 1e5) return '₹' + (x / 1e5).toFixed(2) + ' L';
  if (x >= 1000) return '₹' + Math.round(x).toLocaleString('en-IN');
  return '₹' + x.toFixed(0);
}

// Expected arithmetic annual return based on inputs (analytic, no simulation).
function expectancy(inp: Inputs): { annual: number; perPosition: number } {
  const perPos = inp.winRate * inp.avgWinner + (1 - inp.winRate) * inp.avgLoser;
  const annual = inp.positionSize * inp.positions * perPos; // arithmetic sum
  return { annual, perPosition: perPos };
}

// ── Small UI atoms ───────────────────────────────────────────────────────────
const card: React.CSSProperties = { background: COL.panel, border: `1px solid ${COL.line}`, borderRadius: 10, padding: 16 };
const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 999, background: COL.panel2, border: `1px solid ${COL.line2}`, color: COL.muted, fontSize: 11 };
const label: React.CSSProperties = { fontSize: 11, color: COL.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block' };
const input: React.CSSProperties = {
  width: '100%', background: COL.bg, border: `1px solid ${COL.line2}`, color: COL.txt,
  padding: '8px 10px', borderRadius: 6, fontSize: 13,
};

// ── Kpi card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, color }: { title: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ ...card, padding: 18, borderColor: color + '40', background: `linear-gradient(180deg, ${color}0F 0%, ${COL.panel} 60%)` }}>
      <div style={{ fontSize: 11, color: COL.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color, marginTop: 6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: COL.muted, marginTop: 8 }}>{sub}</div>
    </div>
  );
}

// ── Histogram (SVG) ──────────────────────────────────────────────────────────
function Histogram({ data, width = 560, height = 220 }: { data: number[]; width?: number; height?: number }) {
  const bins = 30;
  const { edges, counts, min, max } = useMemo(() => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const w = (max - min) / bins || 1;
    const edges = new Array(bins + 1).fill(0).map((_, i) => min + i * w);
    const counts = new Array(bins).fill(0);
    for (const v of data) {
      let idx = Math.floor((v - min) / w);
      if (idx < 0) idx = 0;
      if (idx >= bins) idx = bins - 1;
      counts[idx]++;
    }
    return { edges, counts, min, max };
  }, [data]);
  const maxCount = Math.max(...counts, 1);
  const pad = 32;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;
  const barW = chartW / bins;
  const zeroX = pad + ((0 - min) / (max - min || 1)) * chartW;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <rect x={0} y={0} width={width} height={height} fill={COL.panel2} rx={8} />
      {/* zero line */}
      {zeroX >= pad && zeroX <= pad + chartW && (
        <line x1={zeroX} y1={pad} x2={zeroX} y2={pad + chartH} stroke={COL.line2} strokeDasharray="3 3" />
      )}
      {counts.map((c, i) => {
        const barH = (c / maxCount) * chartH;
        const x = pad + i * barW;
        const y = pad + chartH - barH;
        const midVal = (edges[i] + edges[i + 1]) / 2;
        const color = midVal >= 0.20 ? COL.green : midVal >= 0 ? COL.blue : COL.red;
        return <rect key={i} x={x + 0.5} y={y} width={barW - 1} height={barH} fill={color} opacity={0.85} />;
      })}
      {/* x labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const val = min + t * (max - min);
        return (
          <text key={i} x={pad + t * chartW} y={height - 8} fill={COL.muted} fontSize={10} textAnchor="middle">
            {fmtSignedPct(val, 0)}
          </text>
        );
      })}
      <text x={width / 2} y={16} fill={COL.muted} fontSize={11} textAnchor="middle" style={{ letterSpacing: 0.5 }}>
        CAGR DISTRIBUTION · {data.length.toLocaleString()} SIMULATIONS
      </text>
    </svg>
  );
}

// ── Equity curves (SVG) ──────────────────────────────────────────────────────
function EquityCurves({ curves, years, capital, width = 560, height = 240 }: { curves: number[][]; years: number; capital: number; width?: number; height?: number }) {
  const pad = 40;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;
  const allValues = curves.flat();
  const minV = Math.min(...allValues, capital);
  const maxV = Math.max(...allValues, capital);
  const scaleY = (v: number) => pad + chartH - ((v - minV) / (maxV - minV || 1)) * chartH;
  const scaleX = (i: number, n: number) => pad + (i / (n - 1 || 1)) * chartW;
  // Compute median curve at each step
  const nSteps = curves[0]?.length || 0;
  const medianCurve: number[] = [];
  for (let i = 0; i < nSteps; i++) {
    const vs = curves.map(c => c[i]).sort((a, b) => a - b);
    medianCurve.push(vs[Math.floor(vs.length / 2)]);
  }
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <rect x={0} y={0} width={width} height={height} fill={COL.panel2} rx={8} />
      {/* baseline */}
      <line x1={pad} y1={scaleY(capital)} x2={pad + chartW} y2={scaleY(capital)} stroke={COL.line2} strokeDasharray="3 3" />
      {/* sample curves */}
      {curves.slice(0, 20).map((c, idx) => {
        const path = c.map((v, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i, c.length)} ${scaleY(v)}`).join(' ');
        const endV = c[c.length - 1];
        const stroke = endV / capital >= Math.pow(1.20, years) ? COL.green : endV < capital ? COL.red : COL.blue;
        return <path key={idx} d={path} stroke={stroke} strokeWidth={1} fill="none" opacity={0.35} />;
      })}
      {/* median curve */}
      {medianCurve.length > 0 && (
        <path
          d={medianCurve.map((v, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i, medianCurve.length)} ${scaleY(v)}`).join(' ')}
          stroke={COL.amber} strokeWidth={2.5} fill="none"
        />
      )}
      {/* y labels */}
      {[minV, (minV + maxV) / 2, maxV].map((v, i) => (
        <text key={i} x={pad - 6} y={scaleY(v) + 3} fill={COL.muted} fontSize={10} textAnchor="end">
          {fmtMoney(v)}
        </text>
      ))}
      {/* x labels (years) */}
      {Array.from({ length: years + 1 }, (_, i) => i).map((y) => (
        <text key={y} x={scaleX(y * ((nSteps - 1) / (years || 1)), nSteps)} y={height - 12} fill={COL.muted} fontSize={10} textAnchor="middle">
          Y{y}
        </text>
      ))}
      <text x={width / 2} y={16} fill={COL.muted} fontSize={11} textAnchor="middle" style={{ letterSpacing: 0.5 }}>
        EQUITY CURVES · SAMPLE PATHS + MEDIAN (AMBER)
      </text>
    </svg>
  );
}

// ── Trade-by-trade illustrative example ──────────────────────────────────────
// Shows how a single year's individual trades compound. Uses winRate to
// deterministically pick winners (first Nwin) so it's reproducible.
function TradeByTradeExample({ inp }: { inp: Inputs }) {
  const nWinners = Math.round(inp.positions * inp.winRate);
  const nLosers = inp.positions - nWinners;
  const trades: { idx: number; type: 'W' | 'L'; ret: number; contrib: number; running: number }[] = [];
  let running = 1;
  for (let i = 0; i < nWinners; i++) {
    const contrib = inp.positionSize * inp.avgWinner;
    running = running * (1 + contrib);
    trades.push({ idx: i + 1, type: 'W', ret: inp.avgWinner, contrib, running });
  }
  for (let i = 0; i < nLosers; i++) {
    const contrib = inp.positionSize * inp.avgLoser;
    running = running * (1 + contrib);
    trades.push({ idx: nWinners + i + 1, type: 'L', ret: inp.avgLoser, contrib, running });
  }
  const yearlyReturn = running - 1;
  const cagrOver = Math.pow(running, 1) - 1;
  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt }}>Trade-by-trade example · 1 year</div>
        <span style={chip}>{nWinners} winners · {nLosers} losers · pos size {fmtPct(inp.positionSize, 0)}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>#</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Outcome</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Stock return</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Portfolio contribution</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Running portfolio</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.idx} style={{ borderBottom: `1px solid ${COL.line}` }}>
                <td style={{ padding: '6px 8px', color: COL.muted }}>T{t.idx}</td>
                <td style={{ padding: '6px 8px', color: t.type === 'W' ? COL.green : COL.red, fontWeight: 700 }}>
                  {t.type === 'W' ? 'WIN' : 'LOSS'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: t.type === 'W' ? COL.green : COL.red }}>
                  {fmtSignedPct(t.ret, 0)}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: t.type === 'W' ? COL.green : COL.red }}>
                  {fmtSignedPct(t.contrib, 2)}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: COL.txt, fontVariantNumeric: 'tabular-nums' }}>
                  {(t.running * 100).toFixed(2)}%
                </td>
              </tr>
            ))}
            <tr style={{ background: COL.panel2, fontWeight: 800 }}>
              <td style={{ padding: '8px' }} colSpan={3}>Year-end portfolio return</td>
              <td style={{ padding: '8px', textAlign: 'right', color: yearlyReturn >= 0 ? COL.green : COL.red }}>
                {fmtSignedPct(yearlyReturn, 2)}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', color: yearlyReturn >= 0 ? COL.green : COL.red }}>
                {(running * 100).toFixed(2)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: COL.muted, marginTop: 8, lineHeight: 1.55 }}>
        Deterministic illustration using expected mix — actual outcomes vary. In a real year the sequence and counts fluctuate,
        which is exactly what the Monte Carlo simulation above captures.
      </div>
    </div>
  );
}

// ── zzz197: Six real-world small/mid-cap scenarios (with/without stop-loss) ─
type ScenarioTrade = { ticker: string; ret: number; note?: string };
type RealScenario = {
  key: string;
  title: string;
  regime: 'bull' | 'normal' | 'bear';
  hasSL: boolean;
  blurb: string;
  color: string;
  trades: ScenarioTrade[];
};

const REAL_SCENARIOS: RealScenario[] = [
  {
    key: 'bull-sl', title: 'Bull Year · with stop-loss',
    regime: 'bull', hasSL: true, color: '#10B981',
    blurb: 'Small-cap rip (like FY24 — Nifty Smallcap +55%). Winners run, losers stopped at -15%.',
    trades: [
      { ticker: 'AZAD',       ret:  1.80, note: 'Q3 order-book multibagger' },
      { ticker: 'DATAPATTNS', ret:  0.95, note: 'Defence order flow' },
      { ticker: 'HAPPYFORGE', ret:  0.65, note: 'Margin expansion' },
      { ticker: 'JNKINDIA',   ret:  0.50, note: 'Post-IPO re-rating' },
      { ticker: 'RACLGEAR',   ret:  0.40, note: 'EV supply chain' },
      { ticker: 'SYRMA',      ret:  0.30, note: 'PLI tailwind' },
      { ticker: 'DIVGIITTS',  ret: -0.15, note: 'Stopped out at -15%' },
      { ticker: 'RISHABH',    ret: -0.15, note: 'Stopped out at -15%' },
      { ticker: 'SASKEN',     ret: -0.15, note: 'Stopped out at -15%' },
      { ticker: 'LLOYDSENGG', ret: -0.15, note: 'Stopped out at -15%' },
    ],
  },
  {
    key: 'normal-sl', title: 'Normal Year · with stop-loss',
    regime: 'normal', hasSL: true, color: '#22D3EE',
    blurb: 'Steady mid-cap compounding (like FY22). No big moves, discipline on losers pays.',
    trades: [
      { ticker: 'KENNAMET',    ret:  0.45 },
      { ticker: 'ASTRAMICRO',  ret:  0.35 },
      { ticker: 'INOXINDIA',   ret:  0.30 },
      { ticker: 'MARKSANS',    ret:  0.22 },
      { ticker: 'AEROFLEX',    ret:  0.18 },
      { ticker: 'CGPOWER',     ret:  0.12 },
      { ticker: 'PARAS',       ret: -0.15, note: 'Stopped out at -15%' },
      { ticker: 'DREDGECORP',  ret: -0.15, note: 'Stopped out at -15%' },
      { ticker: 'NGLFINE',     ret: -0.15, note: 'Stopped out at -15%' },
      { ticker: 'SANGHVIMOV',  ret: -0.15, note: 'Stopped out at -15%' },
    ],
  },
  {
    key: 'bear-sl', title: 'Bear Market · with stop-loss',
    regime: 'bear', hasSL: true, color: '#F59E0B',
    blurb: 'Small-cap slaughter (like FY19 -20% / covid crash). Stop-losses save the book.',
    trades: [
      { ticker: 'WOCKPHARMA',  ret:  0.25, note: 'Defensive pharma held up' },
      { ticker: 'NGLFINE',     ret:  0.10, note: 'Specialty chem outlier' },
      { ticker: 'JAMNAAUTO',   ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'SKIPPER',     ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'OLECTRA',     ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'KIRLOSENG',   ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'AVALON',      ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'REFEX',       ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'MMTC',        ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'AZAD',        ret: -0.15, note: 'Stopped -15%' },
    ],
  },
  {
    key: 'bull-no-sl', title: 'Bull Year · NO stop-loss',
    regime: 'bull', hasSL: false, color: '#84cc16',
    blurb: 'Same bull tape but you hold losers hoping they turn around. Costs some of the win.',
    trades: [
      { ticker: 'AZAD',       ret:  1.80 },
      { ticker: 'DATAPATTNS', ret:  0.95 },
      { ticker: 'HAPPYFORGE', ret:  0.65 },
      { ticker: 'JNKINDIA',   ret:  0.50 },
      { ticker: 'RACLGEAR',   ret:  0.40 },
      { ticker: 'SYRMA',      ret:  0.30 },
      { ticker: 'DIVGIITTS',  ret: -0.30, note: 'Rode it down (no SL)' },
      { ticker: 'RISHABH',    ret: -0.35, note: 'Rode it down (no SL)' },
      { ticker: 'SASKEN',     ret: -0.25, note: 'Rode it down (no SL)' },
      { ticker: 'LLOYDSENGG', ret: -0.40, note: 'Rode it down (no SL)' },
    ],
  },
  {
    key: 'normal-no-sl', title: 'Normal Year · NO stop-loss',
    regime: 'normal', hasSL: false, color: '#60A5FA',
    blurb: 'Steady tape but no discipline. Winners compound; unmanaged losers eat most of it.',
    trades: [
      { ticker: 'KENNAMET',    ret:  0.45 },
      { ticker: 'ASTRAMICRO',  ret:  0.35 },
      { ticker: 'INOXINDIA',   ret:  0.30 },
      { ticker: 'MARKSANS',    ret:  0.22 },
      { ticker: 'AEROFLEX',    ret:  0.18 },
      { ticker: 'CGPOWER',     ret:  0.12 },
      { ticker: 'PARAS',       ret: -0.30, note: 'No SL — rode it -30%' },
      { ticker: 'DREDGECORP',  ret: -0.45, note: 'No SL — rode it -45%' },
      { ticker: 'NGLFINE',     ret: -0.35, note: 'No SL — rode it -35%' },
      { ticker: 'SANGHVIMOV',  ret: -0.25, note: 'No SL — rode it -25%' },
    ],
  },
  {
    key: 'bear-no-sl', title: 'Bear Market · NO stop-loss',
    regime: 'bear', hasSL: false, color: '#EF4444',
    blurb: 'Small-cap wreck with no discipline. This is how portfolios blow up.',
    trades: [
      { ticker: 'WOCKPHARMA',  ret:  0.25 },
      { ticker: 'NGLFINE',     ret:  0.10 },
      { ticker: 'JAMNAAUTO',   ret: -0.55, note: 'No SL — went -55%' },
      { ticker: 'SKIPPER',     ret: -0.50 },
      { ticker: 'OLECTRA',     ret: -0.45 },
      { ticker: 'KIRLOSENG',   ret: -0.40 },
      { ticker: 'AVALON',      ret: -0.60 },
      { ticker: 'REFEX',       ret: -0.35 },
      { ticker: 'MMTC',        ret: -0.30 },
      { ticker: 'AZAD',        ret: -0.25 },
    ],
  },
];

function ScenarioTable({ sc, positionSize }: { sc: RealScenario; positionSize: number }) {
  let running = 1;
  const rows = sc.trades.map((t) => {
    const contrib = positionSize * t.ret;
    running = running * (1 + contrib);
    return { ...t, contrib, running };
  });
  const yearRet = running - 1;
  return (
    <div style={{ background: COL.panel, border: `1px solid ${sc.color}44`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: sc.color, letterSpacing: 0.3 }}>{sc.title}</div>
          <div style={{ fontSize: 11, color: COL.muted, marginTop: 2 }}>{sc.blurb}</div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
          color: yearRet >= 0 ? COL.green : COL.red,
          background: yearRet >= 0 ? COL.green + '18' : COL.red + '18',
          border: `1px solid ${yearRet >= 0 ? COL.green : COL.red}55`, whiteSpace: 'nowrap',
        }}>
          Year-end {fmtSignedPct(yearRet, 1)}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
            <th style={{ textAlign: 'left', padding: '4px 6px', width: 22 }}>#</th>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Ticker</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>Return</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>Contribution</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>Running</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${COL.line}` }}>
              <td style={{ padding: '4px 6px', color: COL.muted }}>T{i + 1}</td>
              <td style={{ padding: '4px 6px', color: COL.txt, fontWeight: 600 }}>
                {r.ticker}
                {r.note && <div style={{ fontSize: 10, color: COL.muted, fontWeight: 400 }}>{r.note}</div>}
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: r.ret >= 0 ? COL.green : COL.red, fontWeight: 700 }}>
                {fmtSignedPct(r.ret, 0)}
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: r.contrib >= 0 ? COL.green : COL.red }}>
                {fmtSignedPct(r.contrib, 2)}
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right', color: COL.txt, fontVariantNumeric: 'tabular-nums' }}>
                {(r.running * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function scenarioYearReturn(sc: RealScenario, positionSize: number): number {
  let running = 1;
  for (const t of sc.trades) running = running * (1 + positionSize * t.ret);
  return running - 1;
}

function RealWorldScenarios({ positionSize }: { positionSize: number }) {
  const slScenarios = REAL_SCENARIOS.filter(s => s.hasSL);
  const noSlScenarios = REAL_SCENARIOS.filter(s => !s.hasSL);

  // 5-year cycle comparison: assume regime distribution 2 bull + 2 normal + 1 bear
  const cycle = ['bull', 'bull', 'normal', 'normal', 'bear'] as const;
  const compoundCycle = (hasSL: boolean) => {
    let v = 1;
    for (const regime of cycle) {
      const sc = REAL_SCENARIOS.find(s => s.regime === regime && s.hasSL === hasSL)!;
      const yr = scenarioYearReturn(sc, positionSize);
      v = v * (1 + yr);
    }
    return { finalMult: v, cagr: Math.pow(v, 1/5) - 1 };
  };
  const slResult = compoundCycle(true);
  const noSlResult = compoundCycle(false);

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt }}>
            Real-world scenarios · small/mid-cap investing · with vs without stop-loss
          </div>
          <div style={{ fontSize: 11, color: COL.muted, marginTop: 4 }}>
            10 positions × {fmtPct(positionSize, 0)} each. Same wins in each pair — only the loss discipline differs.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...chip, borderColor: COL.green + '55', color: COL.green }}>
            5Y with SL: {fmtSignedPct(slResult.cagr, 1)} CAGR · {slResult.finalMult.toFixed(2)}× capital
          </span>
          <span style={{ ...chip, borderColor: COL.red + '55', color: COL.red }}>
            5Y no SL: {fmtSignedPct(noSlResult.cagr, 1)} CAGR · {noSlResult.finalMult.toFixed(2)}× capital
          </span>
        </div>
      </div>

      {/* With stop-loss row */}
      <div style={{ fontSize: 11, color: COL.green, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontWeight: 700 }}>
        ✓ With stop-loss discipline (losers cut at -15%)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        {slScenarios.map(sc => <ScenarioTable key={sc.key} sc={sc} positionSize={positionSize} />)}
      </div>

      {/* Without stop-loss row */}
      <div style={{ fontSize: 11, color: COL.red, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontWeight: 700 }}>
        ✗ Without stop-loss (losers ride down)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        {noSlScenarios.map(sc => <ScenarioTable key={sc.key} sc={sc} positionSize={positionSize} />)}
      </div>

      {/* What Claude thinks */}
      <div style={{ background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: COL.cyan, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          What I think — stop-loss vs no stop-loss for concentrated small/mid-cap investing
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: COL.txt, lineHeight: 1.7 }}>
          <li>
            <b style={{ color: COL.green }}>In bull years</b> a stop-loss costs some upside (whipsaws — a name that would&apos;ve recovered gets sold at -15%).
            In this bull example: <b>+{(scenarioYearReturn(REAL_SCENARIOS[0], positionSize) * 100).toFixed(1)}%</b> with SL vs
            <b> +{(scenarioYearReturn(REAL_SCENARIOS[3], positionSize) * 100).toFixed(1)}%</b> without.
            The difference is small — the winners do most of the work.
          </li>
          <li>
            <b style={{ color: COL.amber }}>In normal years</b> stop-loss is neutral to slightly positive. The multibagger tail thin, the losers are the story.
            <b> +{(scenarioYearReturn(REAL_SCENARIOS[1], positionSize) * 100).toFixed(1)}%</b> with SL vs
            <b> +{(scenarioYearReturn(REAL_SCENARIOS[4], positionSize) * 100).toFixed(1)}%</b> without — that&apos;s the gap that decides whether the year compounds.
          </li>
          <li>
            <b style={{ color: COL.red }}>In bear years</b> stop-loss is portfolio-saving. In this bear example:
            <b> {(scenarioYearReturn(REAL_SCENARIOS[2], positionSize) * 100).toFixed(1)}%</b> with SL vs
            <b> {(scenarioYearReturn(REAL_SCENARIOS[5], positionSize) * 100).toFixed(1)}%</b> without.
            One bad year without stops erases 3-4 years of compounding.
          </li>
          <li>
            <b style={{ color: COL.violet }}>Compound over a 5-year cycle</b> (2 bull + 2 normal + 1 bear):
            with SL you compound to <b>{slResult.finalMult.toFixed(2)}×</b> capital ({fmtSignedPct(slResult.cagr, 1)} CAGR).
            Without SL you end up at <b>{noSlResult.finalMult.toFixed(2)}×</b> ({fmtSignedPct(noSlResult.cagr, 1)} CAGR).
            The asymmetry is the whole game — small-caps have fat left tails.
          </li>
          <li>
            <b>Practical recipe:</b> hard SL at -15% on thesis-break (fundamentals change) — not just price. For
            high-conviction compounders with intact thesis, tolerate 20-25% drawdowns; but scale out on rich valuations rather
            than let them re-rate down 40%+. Position sizing does the rest of the work — 10% max per name means one blow-up costs
            you 4-6% of the book with SL, 10%+ without.
          </li>
          <li>
            <b>Where I&apos;d be careful:</b> the &quot;no SL&quot; scenarios above assume you also don&apos;t double down. In reality most investors
            average into losers, which makes the no-SL path worse than shown. The bear-year -30% quickly becomes -50% when you
            keep adding to broken theses.
          </li>
        </ul>
      </div>
    </div>
  );
}

// ── Compounding table across years ───────────────────────────────────────────
function YearByYearTable({ result, capital }: { result: SimResult; capital: number }) {
  const years = result.years;
  const nSteps = result.sampleEquity[0]?.length || 0;
  // Use median curve
  const medianCurve: number[] = [];
  for (let i = 0; i < nSteps; i++) {
    const vs = result.sampleEquity.map(c => c[i]).sort((a, b) => a - b);
    medianCurve.push(vs[Math.floor(vs.length / 2)]);
  }
  const stepsPerYear = (nSteps - 1) / (years || 1);
  const rows: { y: number; value: number; ytdRet: number; cumCagr: number }[] = [];
  for (let y = 1; y <= years; y++) {
    const idx = Math.round(y * stepsPerYear);
    const val = medianCurve[idx] ?? capital;
    const prevVal = medianCurve[Math.round((y - 1) * stepsPerYear)] ?? capital;
    const ytdRet = val / prevVal - 1;
    const cumCagr = Math.pow(val / capital, 1 / y) - 1;
    rows.push({ y, value: val, ytdRet, cumCagr });
  }
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt, marginBottom: 12 }}>
        Median compounding path · year by year
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Year</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Portfolio value</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>YTD return</th>
            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Cumulative CAGR</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: `1px solid ${COL.line}` }}>
            <td style={{ padding: '6px 8px', color: COL.muted }}>Y0</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', color: COL.txt }}>{fmtMoney(capital)}</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', color: COL.muted }}>—</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', color: COL.muted }}>—</td>
          </tr>
          {rows.map((r) => (
            <tr key={r.y} style={{ borderBottom: `1px solid ${COL.line}` }}>
              <td style={{ padding: '6px 8px', color: COL.muted }}>Y{r.y}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: COL.txt, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.value)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: r.ytdRet >= 0 ? COL.green : COL.red }}>{fmtSignedPct(r.ytdRet, 1)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: r.cumCagr >= 0 ? COL.green : COL.red, fontWeight: 700 }}>{fmtSignedPct(r.cumCagr, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function PortfolioSimulatorPage() {
  const [inp, setInp] = useState<Inputs>(DEFAULTS);

  const result = useMemo(() => runMonteCarlo(inp), [inp]);
  const exp = useMemo(() => expectancy(inp), [inp]);

  const medianCagr = median(result.cagrs);
  const meanCagr = mean(result.cagrs);
  const bestCagr = percentile(result.cagrs, 0.90);
  const worstCagr = percentile(result.cagrs, 0.10);
  const p20 = result.cagrs.filter(x => x > 0.20).length / result.cagrs.length;
  const pPositive = result.cagrs.filter(x => x > 0).length / result.cagrs.length;
  const medianDD = median(result.maxDrawdowns);
  const worstDD = percentile(result.maxDrawdowns, 0.10);
  const medianFinal = median(result.finalValues);

  const rewardRisk = Math.abs(inp.avgWinner / (inp.avgLoser || -0.0001));
  const positiveExp = exp.annual > 0;

  const set = (key: keyof Inputs) => (v: number | string) => setInp((s) => ({ ...s, [key]: v }));
  const applyScenario = useCallback((partial: Partial<Inputs>) => setInp((s) => ({ ...s, ...partial })), []);

  return (
    <div style={{ background: COL.bg, minHeight: '100vh', color: COL.txt, fontSize: 13, padding: '20px 22px 80px' }}>
      <div style={{ maxWidth: 1480, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ borderBottom: `1px solid ${COL.line}`, paddingBottom: 14, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 22, margin: 0, fontWeight: 700, letterSpacing: '-0.2px' }}>
                Portfolio Probability <span style={{ color: COL.cyan }}>Simulator</span>
              </h1>
              <div style={{ color: COL.muted, fontSize: 12, marginTop: 5, maxWidth: 900 }}>
                Monte Carlo simulator for concentrated investing. Model win-rate, average winner / loser, position count and
                horizon → get the CAGR distribution, best/base/worst-case outcomes, max drawdown estimate, and probability of
                hitting <b style={{ color: COL.green }}>&gt;20% CAGR</b> over your holding period.
              </div>
            </div>
            <span style={{ ...chip, color: positiveExp ? COL.green : COL.red, borderColor: positiveExp ? COL.green + '55' : COL.red + '55' }}>
              {positiveExp ? '● positive expectancy' : '● negative expectancy'} · R:R {rewardRisk.toFixed(2)} : 1
            </span>
          </div>
        </div>

        {/* KPI ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <KpiCard title="Expected CAGR" value={fmtSignedPct(medianCagr, 1)} sub={`Median scenario · mean ${fmtSignedPct(meanCagr, 1)}`} color={COL.cyan} />
          <KpiCard title="Best case (P90)" value={fmtSignedPct(bestCagr, 1)} sub="Top decile of simulations" color={COL.green} />
          <KpiCard title="Worst case (P10)" value={fmtSignedPct(worstCagr, 1)} sub="Bottom decile of simulations" color={COL.red} />
          <KpiCard title="Max drawdown" value={fmtSignedPct(medianDD, 0)} sub={`Median · worst 10th pctile ${fmtSignedPct(worstDD, 0)}`} color={COL.amber} />
          <KpiCard title="P( CAGR > 20% )" value={(p20 * 100).toFixed(1) + '%'} sub={`P(positive) ${(pPositive * 100).toFixed(1)}%`} color={COL.violet} />
        </div>

        {/* SCENARIOS */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COL.txt, textTransform: 'uppercase', letterSpacing: 0.5 }}>Preset scenarios</div>
            <div style={{ fontSize: 11, color: COL.muted }}>click to load</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => applyScenario(s.inputs)}
                style={{
                  textAlign: 'left', cursor: 'pointer', background: COL.panel, border: `1px solid ${s.color}55`,
                  color: COL.txt, padding: 12, borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: s.color, marginBottom: 4 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: COL.muted, lineHeight: 1.5 }}>{s.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        {/* INPUTS row (charts moved to bottom per zzz198) */}
        <div style={{ marginBottom: 20 }}>
          {/* Inputs */}
          <div style={{ ...card }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt, marginBottom: 14 }}>Inputs</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={label}>Portfolio capital (₹)</span>
                <input type="number" style={input} value={inp.capital}
                  onChange={(e) => set('capital')(Number(e.target.value))} />
              </div>
              <div>
                <span style={label}>Positions</span>
                <input type="number" style={input} value={inp.positions}
                  onChange={(e) => set('positions')(Math.max(1, Math.min(50, Number(e.target.value))))} />
              </div>
              <div>
                <span style={label}>Size each (%)</span>
                <input type="number" step={1} style={input} value={Math.round(inp.positionSize * 100)}
                  onChange={(e) => set('positionSize')(Math.max(0.01, Math.min(1, Number(e.target.value) / 100)))} />
              </div>
              <div>
                <span style={label}>Win rate (%)</span>
                <input type="number" step={1} style={input} value={Math.round(inp.winRate * 100)}
                  onChange={(e) => set('winRate')(Math.max(0, Math.min(1, Number(e.target.value) / 100)))} />
              </div>
              <div>
                <span style={label}>Avg winner (%)</span>
                <input type="number" step={1} style={input} value={Math.round(inp.avgWinner * 100)}
                  onChange={(e) => set('avgWinner')(Number(e.target.value) / 100)} />
              </div>
              <div>
                <span style={label}>Avg loser (%)</span>
                <input type="number" step={1} style={input} value={Math.round(inp.avgLoser * 100)}
                  onChange={(e) => set('avgLoser')(Number(e.target.value) / 100)} />
              </div>
              <div>
                <span style={label}>Horizon (years)</span>
                <input type="number" step={1} style={input} value={inp.years}
                  onChange={(e) => set('years')(Math.max(1, Math.min(20, Number(e.target.value))))} />
              </div>
              <div>
                <span style={label}>Simulations</span>
                <select style={input} value={inp.sims}
                  onChange={(e) => set('sims')(Number(e.target.value))}>
                  <option value={1000}>1,000</option>
                  <option value={2500}>2,500</option>
                  <option value={5000}>5,000</option>
                  <option value={10000}>10,000</option>
                </select>
              </div>
              <div>
                <span style={label}>Rebalance</span>
                <select style={input} value={inp.rebalance}
                  onChange={(e) => setInp((s) => ({ ...s, rebalance: e.target.value as 'annual' | 'quarterly' }))}>
                  <option value="annual">Annual</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
            </div>
            {/* Analytics summary */}
            <div style={{ marginTop: 16, borderTop: `1px solid ${COL.line}`, paddingTop: 14 }}>
              <div style={{ fontSize: 11, color: COL.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Analytics</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                <div><div style={{ color: COL.muted }}>Expectancy per position</div><div style={{ color: exp.perPosition >= 0 ? COL.green : COL.red, fontWeight: 700 }}>{fmtSignedPct(exp.perPosition, 2)}</div></div>
                <div><div style={{ color: COL.muted }}>Arithmetic annual</div><div style={{ color: exp.annual >= 0 ? COL.green : COL.red, fontWeight: 700 }}>{fmtSignedPct(exp.annual, 2)}</div></div>
                <div><div style={{ color: COL.muted }}>Reward / risk</div><div style={{ color: COL.txt, fontWeight: 700 }}>{rewardRisk.toFixed(2)} : 1</div></div>
                <div><div style={{ color: COL.muted }}>Median final</div><div style={{ color: COL.txt, fontWeight: 700 }}>{fmtMoney(medianFinal)}</div></div>
              </div>
            </div>
          </div>
        </div>

        {/* INTERPRETATION */}
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt, marginBottom: 10 }}>Interpretation</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, fontSize: 12, color: COL.txt, lineHeight: 1.6 }}>
            <div>
              <div style={{ color: positiveExp ? COL.green : COL.red, fontWeight: 700, marginBottom: 4 }}>
                {positiveExp ? '✓ Positive expectancy' : '✗ Negative expectancy — reconsider'}
              </div>
              <div style={{ color: COL.muted }}>
                Expected per-position return {fmtSignedPct(exp.perPosition, 2)}. Portfolio-level arithmetic drift {fmtSignedPct(exp.annual, 2)} per year
                before compounding. Reward-to-risk {rewardRisk.toFixed(2)} : 1.
              </div>
            </div>
            <div>
              <div style={{ color: p20 >= 0.5 ? COL.green : p20 >= 0.25 ? COL.amber : COL.red, fontWeight: 700, marginBottom: 4 }}>
                P( CAGR &gt; 20% over {inp.years}Y ) = {(p20 * 100).toFixed(1)}%
              </div>
              <div style={{ color: COL.muted }}>
                {p20 >= 0.5 ? 'Better than 50/50 to compound above 20% — a strong edge under these assumptions.'
                  : p20 >= 0.25 ? 'Roughly 1-in-4 shot at &gt;20% CAGR. Meaningful, but requires discipline through drawdowns.'
                  : 'Achieving &gt;20% CAGR is a low-probability outcome under these inputs. Improve win-rate or reward-to-risk before scaling.'}
              </div>
            </div>
            <div>
              <div style={{ color: COL.amber, fontWeight: 700, marginBottom: 4 }}>
                Drawdown budget: {fmtSignedPct(medianDD, 0)} typical · {fmtSignedPct(worstDD, 0)} worst
              </div>
              <div style={{ color: COL.muted }}>
                Median simulation sees a peak-to-trough drawdown of {fmtSignedPct(medianDD, 0)}. The rough downside is
                the 10th percentile at {fmtSignedPct(worstDD, 0)} — plan sizing so a drawdown of that magnitude doesn't
                force you off the strategy.
              </div>
            </div>
            <div>
              <div style={{ color: COL.blue, fontWeight: 700, marginBottom: 4 }}>Suitable for concentrated investing?</div>
              <div style={{ color: COL.muted }}>
                {inp.positions <= 12 && positiveExp && p20 >= 0.30
                  ? 'Yes — win-rate × R:R combination clears the bar for a concentrated 10-position book.'
                  : inp.positions > 20
                  ? 'The math still works, but with more than ~20 positions you dilute the edge; you\'re closer to an index.'
                  : 'Marginal. Concentration amplifies both the edge AND the drawdowns — get the win-rate up before sizing bigger.'}
              </div>
            </div>
          </div>
        </div>

        {/* TRADE-BY-TRADE + YEAR-BY-YEAR */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <TradeByTradeExample inp={inp} />
          <YearByYearTable result={result} capital={inp.capital} />
        </div>

        {/* zzz197: SIX REAL-WORLD SCENARIOS · with vs without stop-loss */}
        <RealWorldScenarios positionSize={inp.positionSize} />

        {/* Comparison table */}
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt, marginBottom: 12 }}>
            Scenario comparison · same portfolio, different assumptions
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 10px' }}>Scenario</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px' }}>Win rate</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px' }}>Avg win</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px' }}>Avg loss</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px' }}>Expected CAGR</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px' }}>P(&gt;20%)</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px' }}>Max DD</th>
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((s) => {
                  const merged = { ...DEFAULTS, ...s.inputs, sims: 1500 };
                  const r = runMonteCarlo(merged);
                  const medC = median(r.cagrs);
                  const p20s = r.cagrs.filter(x => x > 0.20).length / r.cagrs.length;
                  const medD = median(r.maxDrawdowns);
                  return (
                    <tr key={s.key} style={{ borderBottom: `1px solid ${COL.line}` }}>
                      <td style={{ padding: '8px 10px', color: s.color, fontWeight: 700 }}>{s.name}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: COL.txt }}>{fmtPct(merged.winRate, 0)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: COL.green }}>{fmtSignedPct(merged.avgWinner, 0)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: COL.red }}>{fmtSignedPct(merged.avgLoser, 0)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: medC >= 0 ? COL.green : COL.red, fontWeight: 700 }}>{fmtSignedPct(medC, 1)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: p20s >= 0.4 ? COL.green : p20s >= 0.2 ? COL.amber : COL.red }}>{(p20s * 100).toFixed(0)}%</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: COL.amber }}>{fmtSignedPct(medD, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: COL.muted, marginTop: 10 }}>
            All rows recomputed live with 1,500 simulations each · {DEFAULTS.positions} positions × {fmtPct(DEFAULTS.positionSize, 0)} · {DEFAULTS.years}-year horizon · annual rebalance.
          </div>
        </div>

        {/* zzz198: CHARTS moved to bottom — CAGR distribution + equity curves */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div style={{ ...card, padding: 8 }}>
            <Histogram data={result.cagrs} width={720} height={280} />
          </div>
          <div style={{ ...card, padding: 8 }}>
            <EquityCurves curves={result.sampleEquity} years={inp.years} capital={inp.capital} width={720} height={280} />
          </div>
        </div>

        {/* Footer note */}
        <div style={{ ...card, fontSize: 12, color: COL.muted, lineHeight: 1.6 }}>
          <b style={{ color: COL.txt }}>Notes on the model.</b> This is a Monte Carlo simulation with i.i.d. Bernoulli
          outcomes at the position level and equal-weight rebalancing at the chosen frequency. It ignores correlation between
          positions (so tail risk is understated when the market crashes together), transaction costs, taxes and dividends.
          Treat CAGR as the compounded arithmetic return; treat drawdowns as within-horizon peak-to-trough. The point isn&apos;t
          a precise forecast — it&apos;s to see how sensitive your outcomes are to win-rate and reward/risk.
        </div>
      </div>
    </div>
  );
}
