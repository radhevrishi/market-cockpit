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
// zzz199: Monthly-path Monte Carlo with correlated market factor.
// Previous version used yearly periods → drawdowns were often 0% because a
// single yearly draw with positive expectancy rarely dips below start. Real
// portfolios experience within-year peak-to-trough dips driven by correlated
// market shocks. We now step monthly and add a market factor (all positions
// move partially together each month), which produces realistic drawdowns
// without changing the user-specified expected return.
function runMonteCarlo(inp: Inputs): SimResult {
  const { positions, positionSize, winRate, avgWinner, avgLoser, years, sims, capital } = inp;
  const monthsPerYear = 12;
  const totalMonths = years * monthsPerYear;
  // Arithmetic scaling — preserves expected annual return exactly.
  const perMonthWin = avgWinner / monthsPerYear;
  const perMonthLoss = avgLoser / monthsPerYear;
  // Market factor: correlated shock across all positions each month. Roughly
  // matches ~15% annual small/mid-cap benchmark vol → produces realistic
  // 15-30% peak-to-trough drawdowns for concentrated books.
  const marketAnnualVol = 0.15;
  const marketMonthlyVol = marketAnnualVol / Math.sqrt(monthsPerYear);

  // Box-Muller standard normal sampler (mean 0, sd 1).
  const stdNormal = (): number => {
    let u = Math.random();
    if (u < 1e-12) u = 1e-12;
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

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
    for (let t = 0; t < totalMonths; t++) {
      // Correlated market shock this month (applies to every position).
      const marketShock = stdNormal() * marketMonthlyVol;
      let sumReturns = 0;
      for (let p = 0; p < positions; p++) {
        const idio = Math.random() < winRate ? perMonthWin : perMonthLoss;
        sumReturns += idio + marketShock;
      }
      const portRet = positionSize * sumReturns;
      value = value * (1 + portRet);
      if (value > peak) peak = value;
      const dd = value / peak - 1;
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

// ── zzz199: Three exit-discipline approaches × three market regimes ─────────
// Descriptive, not prescriptive. No approach wins by construction — each has
// scenarios where it shines and scenarios where it hurts. The Bull table
// deliberately includes a "SL stopped a would-be multibagger" case to show
// the opportunity cost. The No-Stop scenarios use a REALISTIC loss distribution
// (some -12%, some -25%, some -45%) not "every loser becomes -60%".
type ExitApproach = 'mechanical' | 'thesis' | 'none';
type ScenarioTrade = { ticker: string; ret: number; note?: string };
type RealScenario = {
  key: string;
  regime: 'bull' | 'normal' | 'bear';
  approach: ExitApproach;
  title: string;
  blurb: string;
  color: string;
  trades: ScenarioTrade[];
};

const APPROACH_META: Record<ExitApproach, { name: string; short: string; color: string; oneLine: string }> = {
  mechanical: { name: 'Mechanical stop-loss',  short: 'Mech SL',   color: '#22D3EE', oneLine: 'Exit at fixed % loss (e.g. -15%)' },
  thesis:     { name: 'Thesis-based exit',     short: 'Thesis',    color: '#A78BFA', oneLine: 'Exit only on fundamental break' },
  none:       { name: 'No predefined stop',    short: 'No stop',   color: '#F59E0B', oneLine: 'Hold on price alone; conviction-only' },
};

const REGIME_COLOR: Record<'bull' | 'normal' | 'bear', string> = { bull: '#10B981', normal: '#22D3EE', bear: '#EF4444' };

const REAL_SCENARIOS: RealScenario[] = [
  // ── BULL YEAR ────────────────────────────────────────────────────────────
  {
    key: 'bull-mech', regime: 'bull', approach: 'mechanical', color: '#22D3EE',
    title: 'Bull · Mechanical SL',
    blurb: 'Losers cut at -15%. Note T7: stopped at -15% — would-be +180% multibagger. This is the whipsaw cost.',
    trades: [
      { ticker: 'AZAD',       ret:  1.80, note: 'Order-book multibagger' },
      { ticker: 'DATAPATTNS', ret:  0.95 },
      { ticker: 'HAPPYFORGE', ret:  0.60 },
      { ticker: 'JNKINDIA',   ret:  0.45 },
      { ticker: 'RACLGEAR',   ret:  0.35 },
      { ticker: 'SYRMA',      ret:  0.25 },
      { ticker: 'INOXINDIA',  ret: -0.15, note: 'Stopped -15% · went on to +180% later ⚠️' },
      { ticker: 'DIVGIITTS',  ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'RISHABH',    ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'LLOYDSENGG', ret: -0.15, note: 'Stopped -15%' },
    ],
  },
  {
    key: 'bull-thesis', regime: 'bull', approach: 'thesis', color: '#A78BFA',
    title: 'Bull · Thesis exit',
    blurb: 'Hold unless fundamentals break. Winners run full course. Losers vary — some recover in the tape.',
    trades: [
      { ticker: 'AZAD',       ret:  1.80 },
      { ticker: 'DATAPATTNS', ret:  0.95 },
      { ticker: 'HAPPYFORGE', ret:  0.60 },
      { ticker: 'JNKINDIA',   ret:  0.45 },
      { ticker: 'RACLGEAR',   ret:  0.35 },
      { ticker: 'SYRMA',      ret:  0.25 },
      { ticker: 'INOXINDIA',  ret:  0.80, note: 'Recovered — thesis intact 🚀' },
      { ticker: 'DIVGIITTS',  ret: -0.18, note: 'Underperformed but held (thesis OK)' },
      { ticker: 'RISHABH',    ret: -0.30, note: 'Exited: management guidance cut ✗' },
      { ticker: 'LLOYDSENGG', ret: -0.12, note: 'Held — thesis unchanged' },
    ],
  },
  {
    key: 'bull-none', regime: 'bull', approach: 'none', color: '#F59E0B',
    title: 'Bull · No stop',
    blurb: 'Same tape, no discipline. Wide range of loser outcomes — some flat, some deeper.',
    trades: [
      { ticker: 'AZAD',       ret:  1.80 },
      { ticker: 'DATAPATTNS', ret:  0.95 },
      { ticker: 'HAPPYFORGE', ret:  0.60 },
      { ticker: 'JNKINDIA',   ret:  0.45 },
      { ticker: 'RACLGEAR',   ret:  0.35 },
      { ticker: 'SYRMA',      ret:  0.25 },
      { ticker: 'INOXINDIA',  ret:  0.80, note: 'Recovered (would\'ve been stopped)' },
      { ticker: 'DIVGIITTS',  ret: -0.18 },
      { ticker: 'RISHABH',    ret: -0.42, note: 'Rode it further down' },
      { ticker: 'LLOYDSENGG', ret: -0.25 },
    ],
  },

  // ── NORMAL YEAR ──────────────────────────────────────────────────────────
  {
    key: 'normal-mech', regime: 'normal', approach: 'mechanical', color: '#22D3EE',
    title: 'Normal · Mechanical SL',
    blurb: 'Sideways tape. SL keeps losers contained. Costs one recovery.',
    trades: [
      { ticker: 'KENNAMET',    ret:  0.42 },
      { ticker: 'ASTRAMICRO',  ret:  0.30 },
      { ticker: 'INOXINDIA',   ret:  0.22 },
      { ticker: 'MARKSANS',    ret:  0.18 },
      { ticker: 'AEROFLEX',    ret:  0.12 },
      { ticker: 'CGPOWER',     ret:  0.08 },
      { ticker: 'PARAS',       ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'DREDGECORP',  ret: -0.15, note: 'Stopped -15% · recovered to +15% later' },
      { ticker: 'NGLFINE',     ret: -0.15, note: 'Stopped -15%' },
      { ticker: 'SANGHVIMOV',  ret: -0.15, note: 'Stopped -15%' },
    ],
  },
  {
    key: 'normal-thesis', regime: 'normal', approach: 'thesis', color: '#A78BFA',
    title: 'Normal · Thesis exit',
    blurb: 'Hold on price weakness alone. Mix of quiet losers, some grind back to flat.',
    trades: [
      { ticker: 'KENNAMET',    ret:  0.42 },
      { ticker: 'ASTRAMICRO',  ret:  0.30 },
      { ticker: 'INOXINDIA',   ret:  0.22 },
      { ticker: 'MARKSANS',    ret:  0.18 },
      { ticker: 'AEROFLEX',    ret:  0.12 },
      { ticker: 'CGPOWER',     ret:  0.08 },
      { ticker: 'PARAS',       ret: -0.10, note: 'Held — thesis intact' },
      { ticker: 'DREDGECORP',  ret:  0.15, note: 'Recovered (would\'ve been stopped)' },
      { ticker: 'NGLFINE',     ret: -0.25, note: 'Held — margin compression' },
      { ticker: 'SANGHVIMOV',  ret: -0.35, note: 'Exited: capital allocation deteriorated ✗' },
    ],
  },
  {
    key: 'normal-none', regime: 'normal', approach: 'none', color: '#F59E0B',
    title: 'Normal · No stop',
    blurb: 'Realistic mixed outcomes. Not everything blows up — but nothing gets managed either.',
    trades: [
      { ticker: 'KENNAMET',    ret:  0.42 },
      { ticker: 'ASTRAMICRO',  ret:  0.30 },
      { ticker: 'INOXINDIA',   ret:  0.22 },
      { ticker: 'MARKSANS',    ret:  0.18 },
      { ticker: 'AEROFLEX',    ret:  0.12 },
      { ticker: 'CGPOWER',     ret:  0.08 },
      { ticker: 'PARAS',       ret: -0.12 },
      { ticker: 'DREDGECORP',  ret:  0.05, note: 'Ground back to flat' },
      { ticker: 'NGLFINE',     ret: -0.35 },
      { ticker: 'SANGHVIMOV',  ret: -0.45, note: 'Capital trapped' },
    ],
  },

  // ── BEAR MARKET ──────────────────────────────────────────────────────────
  {
    key: 'bear-mech', regime: 'bear', approach: 'mechanical', color: '#22D3EE',
    title: 'Bear · Mechanical SL',
    blurb: 'Small-cap slaughter. SL saves the book but locks in whipsaws.',
    trades: [
      { ticker: 'WOCKPHARMA',  ret:  0.20, note: 'Defensive held up' },
      { ticker: 'NGLFINE',     ret:  0.08 },
      { ticker: 'JAMNAAUTO',   ret: -0.15, note: 'Stopped · recovered +25% later' },
      { ticker: 'SKIPPER',     ret: -0.15, note: 'Stopped' },
      { ticker: 'OLECTRA',     ret: -0.15, note: 'Stopped · then fell to -45% (SL saved us)' },
      { ticker: 'KIRLOSENG',   ret: -0.15, note: 'Stopped' },
      { ticker: 'AVALON',      ret: -0.15, note: 'Stopped · then fell to -55% (SL saved us)' },
      { ticker: 'REFEX',       ret: -0.15, note: 'Stopped · recovered +18% later' },
      { ticker: 'MMTC',        ret: -0.15, note: 'Stopped' },
      { ticker: 'AZAD',        ret: -0.15, note: 'Stopped · recovered +35% later' },
    ],
  },
  {
    key: 'bear-thesis', regime: 'bear', approach: 'thesis', color: '#A78BFA',
    title: 'Bear · Thesis exit',
    blurb: 'Hold quality, exit only on fundamental breaks. Painful ride but survives.',
    trades: [
      { ticker: 'WOCKPHARMA',  ret:  0.20 },
      { ticker: 'NGLFINE',     ret:  0.08 },
      { ticker: 'JAMNAAUTO',   ret: -0.30, note: 'Held — cyclical, thesis intact' },
      { ticker: 'SKIPPER',     ret: -0.35, note: 'Held' },
      { ticker: 'OLECTRA',     ret: -0.45, note: 'Held — deep drawdown' },
      { ticker: 'KIRLOSENG',   ret: -0.25, note: 'Held' },
      { ticker: 'AVALON',      ret: -0.55, note: 'Exited: guidance cut + debt spike ✗' },
      { ticker: 'REFEX',       ret: -0.20 },
      { ticker: 'MMTC',        ret: -0.30 },
      { ticker: 'AZAD',        ret: -0.25 },
    ],
  },
  {
    key: 'bear-none', regime: 'bear', approach: 'none', color: '#F59E0B',
    title: 'Bear · No stop',
    blurb: 'No discipline. Losses vary — some catastrophic, some recover in year 2.',
    trades: [
      { ticker: 'WOCKPHARMA',  ret:  0.20 },
      { ticker: 'NGLFINE',     ret:  0.08 },
      { ticker: 'JAMNAAUTO',   ret: -0.35 },
      { ticker: 'SKIPPER',     ret: -0.40 },
      { ticker: 'OLECTRA',     ret: -0.55, note: 'Deep drawdown' },
      { ticker: 'KIRLOSENG',   ret: -0.30 },
      { ticker: 'AVALON',      ret: -0.65, note: 'Blow-up' },
      { ticker: 'REFEX',       ret: -0.25 },
      { ticker: 'MMTC',        ret: -0.32 },
      { ticker: 'AZAD',        ret: -0.28 },
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
    <div style={{ background: COL.panel, border: `1px solid ${sc.color}44`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: sc.color, letterSpacing: 0.3 }}>{sc.title}</div>
          <div style={{ fontSize: 10, color: COL.muted, marginTop: 2, lineHeight: 1.4 }}>{sc.blurb}</div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
          color: yearRet >= 0 ? COL.green : COL.red,
          background: yearRet >= 0 ? COL.green + '18' : COL.red + '18',
          border: `1px solid ${yearRet >= 0 ? COL.green : COL.red}55`, whiteSpace: 'nowrap',
        }}>{fmtSignedPct(yearRet, 1)}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
            <th style={{ textAlign: 'left', padding: '3px 5px', width: 18 }}>#</th>
            <th style={{ textAlign: 'left', padding: '3px 5px' }}>Ticker</th>
            <th style={{ textAlign: 'right', padding: '3px 5px' }}>Ret</th>
            <th style={{ textAlign: 'right', padding: '3px 5px' }}>Run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${COL.line}` }}>
              <td style={{ padding: '3px 5px', color: COL.muted }}>T{i + 1}</td>
              <td style={{ padding: '3px 5px', color: COL.txt, fontWeight: 600 }}>
                {r.ticker}
                {r.note && <div style={{ fontSize: 10, color: COL.muted, fontWeight: 400, lineHeight: 1.3 }}>{r.note}</div>}
              </td>
              <td style={{ padding: '3px 5px', textAlign: 'right', color: r.ret >= 0 ? COL.green : COL.red, fontWeight: 700 }}>
                {fmtSignedPct(r.ret, 0)}
              </td>
              <td style={{ padding: '3px 5px', textAlign: 'right', color: COL.txt, fontVariantNumeric: 'tabular-nums' }}>
                {(r.running * 100).toFixed(1)}%
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

// Approach pros/cons — descriptive, not prescriptive.
const APPROACH_TRADEOFFS: Record<ExitApproach, { pros: string[]; cons: string[]; suits: string }> = {
  mechanical: {
    pros: ['Limits catastrophic losses', 'Enforces position sizing', 'Easier psychologically', 'Removes emotion from exit'],
    cons: ['Whipsaws on volatile names', 'Triggers taxable events', 'Misses V-shaped recoveries', 'Cost of opportunity in bull tapes'],
    suits: 'Momentum, swing trading, high-volatility positions, novice discipline.',
  },
  thesis: {
    pros: ['Captures long compounders', 'Ignores noise, respects thesis', 'Middle ground on turnover', 'Aligns with quality investing'],
    cons: ['Requires deep fundamentals work', 'Anchoring bias risk', 'Hard to define thesis break objectively', 'Painful drawdowns before exit'],
    suits: 'Quality growth, long-term compounding, moat businesses (Buffett / Terry Smith / Nick Sleep style).',
  },
  none: {
    pros: ['Full participation in compounders', 'Lowest turnover / taxes', 'Rewards deep conviction', 'Avoids whipsaws entirely'],
    cons: ['Blow-up risk on broken theses', 'Capital trapped in dead-money', 'Large drawdowns test resolve', 'Easy to average into losers'],
    suits: 'Deep value with margin of safety, permanent-capital vehicles, portfolio ≥ 30 positions with wide diversification.',
  },
};

function RealWorldScenarios({ positionSize }: { positionSize: number }) {
  const regimes = ['bull', 'normal', 'bear'] as const;
  const approaches: ExitApproach[] = ['mechanical', 'thesis', 'none'];

  // 5-year cycle: 2 bull + 2 normal + 1 bear.
  const cycle = ['bull', 'bull', 'normal', 'normal', 'bear'] as const;
  const compoundCycle = (approach: ExitApproach) => {
    let v = 1;
    for (const regime of cycle) {
      const sc = REAL_SCENARIOS.find(s => s.regime === regime && s.approach === approach)!;
      const yr = scenarioYearReturn(sc, positionSize);
      v = v * (1 + yr);
    }
    return { finalMult: v, cagr: Math.pow(v, 1 / 5) - 1 };
  };
  const results = Object.fromEntries(approaches.map(a => [a, compoundCycle(a)])) as Record<ExitApproach, { finalMult: number; cagr: number }>;

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt }}>Exit-discipline scenarios · descriptive, not prescriptive</div>
        <div style={{ fontSize: 11, color: COL.muted, marginTop: 4, lineHeight: 1.5 }}>
          Three approaches — mechanical stop-loss, thesis-based exit, no predefined stop — across three regimes.
          No approach wins by construction. The Bull-Mechanical column deliberately includes a would-be multibagger stopped
          out (the whipsaw cost); the No-Stop column uses a realistic mixed loss distribution, not "every loser goes -60%".
        </div>
      </div>

      {/* 5-year cycle summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 16 }}>
        {approaches.map(a => (
          <div key={a} style={{ background: COL.panel2, border: `1px solid ${APPROACH_META[a].color}55`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: COL.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>5Y cycle · {APPROACH_META[a].short}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: APPROACH_META[a].color, marginTop: 4 }}>
              {fmtSignedPct(results[a].cagr, 1)}
            </div>
            <div style={{ fontSize: 11, color: COL.muted, marginTop: 2 }}>
              {results[a].finalMult.toFixed(2)}× capital · 2 bull + 2 normal + 1 bear
            </div>
          </div>
        ))}
      </div>

      {/* Regime rows */}
      {regimes.map(regime => (
        <div key={regime} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: REGIME_COLOR[regime], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontWeight: 700 }}>
            {regime.toUpperCase()} YEAR
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            {approaches.map(a => {
              const sc = REAL_SCENARIOS.find(s => s.regime === regime && s.approach === a)!;
              return <ScenarioTable key={sc.key} sc={sc} positionSize={positionSize} />;
            })}
          </div>
        </div>
      ))}

      {/* Pros/cons */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: COL.txt, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          Possible approaches — pros, cons, when each tends to fit
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {approaches.map(a => (
            <div key={a} style={{ background: COL.panel2, border: `1px solid ${APPROACH_META[a].color}44`, borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: APPROACH_META[a].color, marginBottom: 2 }}>{APPROACH_META[a].name}</div>
              <div style={{ fontSize: 11, color: COL.muted, marginBottom: 10 }}>{APPROACH_META[a].oneLine}</div>
              <div style={{ fontSize: 11, color: COL.green, fontWeight: 700, marginBottom: 4 }}>PROS</div>
              <ul style={{ margin: '0 0 10px', paddingLeft: 16, fontSize: 11, color: COL.txt, lineHeight: 1.6 }}>
                {APPROACH_TRADEOFFS[a].pros.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              <div style={{ fontSize: 11, color: COL.red, fontWeight: 700, marginBottom: 4 }}>CONS</div>
              <ul style={{ margin: '0 0 10px', paddingLeft: 16, fontSize: 11, color: COL.txt, lineHeight: 1.6 }}>
                {APPROACH_TRADEOFFS[a].cons.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              <div style={{ fontSize: 11, color: COL.muted, fontWeight: 700, marginBottom: 4 }}>WHERE IT TENDS TO FIT</div>
              <div style={{ fontSize: 11, color: COL.txt, lineHeight: 1.5 }}>{APPROACH_TRADEOFFS[a].suits}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Regime cheatsheet */}
      <div style={{ marginTop: 16, background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: COL.cyan, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          Market regime cheatsheet · what tends to work when
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Regime</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>What tends to work</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Caution</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${COL.line}` }}>
              <td style={{ padding: '8px', color: COL.green, fontWeight: 700 }}>Strong bull</td>
              <td style={{ padding: '8px', color: COL.txt }}>Let winners run · wider stops or thesis-only exits · trend-following </td>
              <td style={{ padding: '8px', color: COL.muted }}>Tight mechanical SL frequently whipsaws you out of eventual multibaggers</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COL.line}` }}>
              <td style={{ padding: '8px', color: COL.cyan, fontWeight: 700 }}>Sideways / normal</td>
              <td style={{ padding: '8px', color: COL.txt }}>Selective exits · valuation discipline · rebalance to fresh setups</td>
              <td style={{ padding: '8px', color: COL.muted }}>Both mechanical and thesis approaches acceptable; no-stop needs patience</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COL.line}` }}>
              <td style={{ padding: '8px', color: COL.red, fontWeight: 700 }}>Bear</td>
              <td style={{ padding: '8px', color: COL.txt }}>Risk control · raise cash · tighter loss management · protect capital</td>
              <td style={{ padding: '8px', color: COL.muted }}>No-stop with concentrated small/mid-caps is where portfolios blow up</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: COL.muted, marginTop: 10, lineHeight: 1.6 }}>
          Note: many of the best long-term investors (Buffett, Peter Lynch, Terry Smith, Nick Sleep) don't use mechanical
          stop-losses. They rely on thesis discipline instead. The right approach depends on your temperament, edge, and
          the concentration / diversification of your book — not a universal rule.
        </div>
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

// ── zzz200: Growth Ladder — path from 50L to 10Cr with Minervini-style rules ─
// Concentrated 10-position book, hard stop at avg loser %, winners in the
// specified range. Shows batch-by-batch capital growth, sample trade sequence
// with SEPA-style setups, and time-to-target under different assumptions.

type LadderInputs = {
  startCapital: number;
  targetCapital: number;
  positions: number;
  winRate: number;    // fraction
  minWinner: number;  // fraction (e.g. 0.10)
  maxWinner: number;  // fraction (e.g. 0.40)
  maxLoss: number;    // fraction NEGATIVE (e.g. -0.13)
  holdWeeks: number;  // avg weeks per trade cycle
};

const LADDER_DEFAULTS: LadderInputs = {
  startCapital: 50_00_000,       // 50 lakhs
  targetCapital: 10_00_00_000,   // 10 crores
  positions: 10,
  winRate: 0.55,                 // realistic Minervini live win rate
  minWinner: 0.10,
  maxWinner: 0.40,
  maxLoss: -0.13,
  holdWeeks: 6,
};

// Deterministic per-batch expected return: E[R_pos] = p*avgWin + (1-p)*maxLoss
// where avgWin is midpoint of the range. Portfolio full-invested = sum of positions
// weighted 1/N so E[batch] = E[R_pos] regardless of position count.
function ladderExpectedBatch(inp: LadderInputs): number {
  const avgWin = (inp.minWinner + inp.maxWinner) / 2;
  return inp.winRate * avgWin + (1 - inp.winRate) * inp.maxLoss;
}

// zzz201: simulate each batch with a realistic W/L split + running counters
// + milestone markers. Uses seeded PRNG so results are reproducible for the
// same input set (no jitter on every re-render).
type LadderRow = {
  batch: number;
  weeksElapsed: number;
  wins: number;
  losses: number;
  batchRet: number;
  portfolio: number;
  multiple: number;
  cumWins: number;
  cumLosses: number;
  cumTrades: number;      // zzz201: total trades executed so far
  bestWin: number;        // biggest winner % this batch
  worstLoss: number;      // biggest loser % this batch (negative)
  gainRs: number;         // absolute rupee gain this batch
  milestone: string | null;
};

function ladderProject(inp: LadderInputs): {
  batches: number;
  years: number;
  cagr: number;
  ladder: LadderRow[];
  cumWinsTotal: number;
  cumLossesTotal: number;
} {
  const rBatch = ladderExpectedBatch(inp);
  const growthNeeded = inp.targetCapital / inp.startCapital;
  const batches = rBatch > 0 ? Math.ceil(Math.log(growthNeeded) / Math.log(1 + rBatch)) : 999;
  const weeks = batches * inp.holdWeeks;
  const years = weeks / 52;
  const cagr = years > 0 ? Math.pow(growthNeeded, 1 / years) - 1 : 0;

  // Seeded PRNG — deterministic per input set.
  const seedBase = Math.round(inp.winRate * 1000)
    + Math.round(inp.minWinner * 10000)
    + Math.round(inp.maxWinner * 10000)
    + Math.round(inp.maxLoss * 10000)
    + inp.positions * 7
    + inp.holdWeeks * 13;
  let seed = seedBase || 1;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const avgWin = (inp.minWinner + inp.maxWinner) / 2;
  const targetMultiples = [2, 5, 10, 20, 50, 100];

  const ladder: LadderRow[] = [];
  let v = inp.startCapital;
  let cumWins = 0, cumLosses = 0;
  const hitMilestones = new Set<number>();

  const totalRowsToShow = Math.min(batches, 80);
  for (let b = 1; b <= totalRowsToShow; b++) {
    // Simulate this batch: N positions, each independently a winner or loser.
    // For deterministic-but-varied outcomes, use seeded PRNG.
    let wins = 0;
    let bestWin = 0;
    let worstLoss = 0;
    let sumWinRet = 0;
    let sumLossRet = 0;
    for (let p = 0; p < inp.positions; p++) {
      if (rand() < inp.winRate) {
        wins++;
        // Individual winner return spans [minWinner, maxWinner]
        const wr = inp.minWinner + rand() * (inp.maxWinner - inp.minWinner);
        sumWinRet += wr;
        if (wr > bestWin) bestWin = wr;
      } else {
        // Individual loser return spans [maxLoss, maxLoss * 0.4] (some smaller cuts)
        const lr = inp.maxLoss * (0.4 + rand() * 0.6);
        sumLossRet += lr;
        if (lr < worstLoss) worstLoss = lr;
      }
    }
    const losses = inp.positions - wins;
    const positionSize = 1 / inp.positions;
    const batchRet = positionSize * (sumWinRet + sumLossRet);
    const gainRs = v * batchRet;
    v = v * (1 + batchRet);
    cumWins += wins;
    cumLosses += losses;
    const mult = v / inp.startCapital;

    // Detect milestone: first time crossing 2x, 5x, 10x etc.
    let milestone: string | null = null;
    for (const m of targetMultiples) {
      if (mult >= m && !hitMilestones.has(m) && m <= growthNeeded) {
        hitMilestones.add(m);
        milestone = m >= growthNeeded ? '🎯 Target hit' : `⭐ ${m}× capital`;
        break;
      }
    }
    if (!milestone && mult >= growthNeeded && !hitMilestones.has(-1)) {
      hitMilestones.add(-1);
      milestone = '🎯 Target hit';
    }

    ladder.push({
      batch: b,
      weeksElapsed: b * inp.holdWeeks,
      wins,
      losses,
      batchRet,
      portfolio: v,
      multiple: mult,
      cumWins,
      cumLosses,
      cumTrades: b * inp.positions,
      bestWin,
      worstLoss,
      gainRs,
      milestone,
    });

    if (mult >= growthNeeded) break; // stop at target
  }
  return { batches: ladder.length, years: (ladder.length * inp.holdWeeks) / 52, cagr: Math.pow(v / inp.startCapital, 52 / (ladder.length * inp.holdWeeks || 1)) - 1, ladder, cumWinsTotal: cumWins, cumLossesTotal: cumLosses };
}

// Realistic Minervini-style setups
const SEPA_SETUPS = ['VCP', 'Cup & Handle', 'Flat Base', 'Power-Play', 'Pivot Base', 'IPO Base', 'Flag'];
const SEPA_TICKERS = ['AZAD', 'DATAPATTNS', 'HAPPYFORGE', 'JNKINDIA', 'RACLGEAR', 'SYRMA', 'INOXINDIA', 'KENNAMET',
  'ASTRAMICRO', 'MARKSANS', 'AEROFLEX', 'CGPOWER', 'PARAS', 'DIVGIITTS', 'RISHABH', 'LLOYDSENGG',
  'DREDGECORP', 'NGLFINE', 'SANGHVIMOV', 'WOCKPHARMA', 'JAMNAAUTO', 'SKIPPER', 'OLECTRA',
  'KIRLOSENG', 'AVALON', 'REFEX', 'MMTC', 'AXTEL', 'KECL', 'FCL'];

// Deterministic sample trade sequence (30 trades) — expected outcome distribution
function buildSampleTrades(inp: LadderInputs): { i: number; ticker: string; setup: string; type: 'W' | 'L'; ret: number; days: number }[] {
  const winnersInBucket = Math.round(30 * inp.winRate);
  const losersInBucket = 30 - winnersInBucket;
  const rng = (seed: number) => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const trades: { i: number; ticker: string; setup: string; type: 'W' | 'L'; ret: number; days: number }[] = [];
  let seed = 42;
  for (let i = 0; i < winnersInBucket; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    const r = seed / 233280;
    const ret = inp.minWinner + r * (inp.maxWinner - inp.minWinner);
    const days = Math.round(20 + r * 45); // 3-9 weeks
    trades.push({
      i: i + 1,
      ticker: SEPA_TICKERS[i % SEPA_TICKERS.length],
      setup: SEPA_SETUPS[i % SEPA_SETUPS.length],
      type: 'W', ret, days,
    });
  }
  for (let i = 0; i < losersInBucket; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    const r = seed / 233280;
    // Losses usually smaller than max because SL trailing/anticipation
    const ret = inp.maxLoss * (0.6 + r * 0.4); // -60% to -100% of max
    const days = Math.round(5 + r * 20); // fast cuts, 1-4 weeks
    trades.push({
      i: winnersInBucket + i + 1,
      ticker: SEPA_TICKERS[(winnersInBucket + i) % SEPA_TICKERS.length],
      setup: SEPA_SETUPS[(winnersInBucket + i) % SEPA_SETUPS.length],
      type: 'L', ret, days,
    });
  }
  // Interleave winners and losers roughly
  const interleaved: typeof trades = [];
  const wArr = trades.filter(t => t.type === 'W');
  const lArr = trades.filter(t => t.type === 'L');
  let wi = 0, li = 0;
  for (let k = 0; k < 30; k++) {
    if ((k * inp.winRate) % 1 < inp.winRate && wi < wArr.length) { interleaved.push({ ...wArr[wi], i: k + 1 }); wi++; }
    else if (li < lArr.length) { interleaved.push({ ...lArr[li], i: k + 1 }); li++; }
    else if (wi < wArr.length) { interleaved.push({ ...wArr[wi], i: k + 1 }); wi++; }
  }
  return interleaved;
}

function GrowthLadder() {
  const [inp, setInp] = useState<LadderInputs>(LADDER_DEFAULTS);
  const proj = useMemo(() => ladderProject(inp), [inp]);
  const rBatch = ladderExpectedBatch(inp);
  const positionSize = 1 / inp.positions;
  const avgWin = (inp.minWinner + inp.maxWinner) / 2;
  const rewardRisk = Math.abs(avgWin / (inp.maxLoss || -0.0001));
  const posExpectancy = inp.winRate * avgWin + (1 - inp.winRate) * inp.maxLoss;

  const sampleTrades = useMemo(() => buildSampleTrades(inp), [inp]);
  const sampleContrib = sampleTrades.map(t => positionSize * t.ret);
  let sampleRunning = inp.startCapital;
  const sampleRows = sampleTrades.map((t, i) => {
    const contrib = sampleContrib[i];
    sampleRunning = sampleRunning * (1 + contrib);
    return { ...t, contrib, running: sampleRunning };
  });

  // Best-case Minervini presets — click to load
  const presets: { name: string; blurb: string; color: string; inp: Partial<LadderInputs> }[] = [
    { name: 'Minervini SEPA · realistic',   color: '#22D3EE', blurb: 'Live-book realism: 55% win, +10 to +40% winners, -13% max loss, 6-week hold', inp: { winRate: 0.55, minWinner: 0.10, maxWinner: 0.40, maxLoss: -0.13, holdWeeks: 6 } },
    { name: 'Minervini · peak execution',   color: '#10B981', blurb: 'Championship trader mode: 65% win, +15 to +50% winners, -7% max loss, 5-week hold', inp: { winRate: 0.65, minWinner: 0.15, maxWinner: 0.50, maxLoss: -0.07, holdWeeks: 5 } },
    { name: 'Conservative swing',           color: '#A78BFA', blurb: 'Selective swing: 60% win, +8 to +25% winners, -10% loss, 8-week hold', inp: { winRate: 0.60, minWinner: 0.08, maxWinner: 0.25, maxLoss: -0.10, holdWeeks: 8 } },
    { name: 'Poor discipline',              color: '#EF4444', blurb: 'What breaks the ladder: 45% win, +10 to +30% winners, -20% loss (SL slippage), 8-week hold', inp: { winRate: 0.45, minWinner: 0.10, maxWinner: 0.30, maxLoss: -0.20, holdWeeks: 8 } },
  ];

  return (
    <div style={{ ...card, marginBottom: 20, borderColor: '#22D3EE55', background: `linear-gradient(180deg, #22D3EE0F 0%, ${COL.panel} 60%)` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: COL.txt }}>
            Growth Ladder · <span style={{ color: COL.cyan }}>{fmtMoney(inp.startCapital)}</span> → <span style={{ color: COL.green }}>{fmtMoney(inp.targetCapital)}</span>
          </div>
          <div style={{ fontSize: 11, color: COL.muted, marginTop: 4, lineHeight: 1.5 }}>
            Concentrated 10-position book, Minervini-style rules — hard stop at max loss %, winners in the specified range.
            Assumes fully deployed capital each batch (10 concurrent trades roll every {inp.holdWeeks} weeks).
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...chip, borderColor: COL.cyan + '55', color: COL.cyan }}>
            {proj.batches} batches
          </span>
          <span style={{ ...chip, borderColor: COL.green + '55', color: COL.green }}>
            {proj.years.toFixed(1)} years
          </span>
          <span style={{ ...chip, borderColor: COL.amber + '55', color: COL.amber }}>
            {fmtSignedPct(proj.cagr, 1)} CAGR
          </span>
        </div>
      </div>

      {/* Preset shortcuts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 14 }}>
        {presets.map(p => (
          <button key={p.name}
            onClick={() => setInp(s => ({ ...s, ...p.inp }))}
            style={{ textAlign: 'left', cursor: 'pointer', background: COL.panel2, border: `1px solid ${p.color}55`, color: COL.txt, padding: 10, borderRadius: 6 }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: p.color }}>{p.name}</div>
            <div style={{ fontSize: 10, color: COL.muted, marginTop: 2, lineHeight: 1.4 }}>{p.blurb}</div>
          </button>
        ))}
      </div>

      {/* Inputs grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div><span style={label}>Start capital (₹)</span>
          <input type="number" style={input} value={inp.startCapital}
            onChange={e => setInp(s => ({ ...s, startCapital: Number(e.target.value) }))} />
        </div>
        <div><span style={label}>Target (₹)</span>
          <input type="number" style={input} value={inp.targetCapital}
            onChange={e => setInp(s => ({ ...s, targetCapital: Number(e.target.value) }))} />
        </div>
        <div><span style={label}>Positions</span>
          <input type="number" style={input} value={inp.positions}
            onChange={e => setInp(s => ({ ...s, positions: Math.max(1, Number(e.target.value)) }))} />
        </div>
        <div><span style={label}>Win rate (%)</span>
          <input type="number" style={input} value={Math.round(inp.winRate * 100)}
            onChange={e => setInp(s => ({ ...s, winRate: Math.max(0, Math.min(1, Number(e.target.value) / 100)) }))} />
        </div>
        <div><span style={label}>Min winner (%)</span>
          <input type="number" style={input} value={Math.round(inp.minWinner * 100)}
            onChange={e => setInp(s => ({ ...s, minWinner: Number(e.target.value) / 100 }))} />
        </div>
        <div><span style={label}>Max winner (%)</span>
          <input type="number" style={input} value={Math.round(inp.maxWinner * 100)}
            onChange={e => setInp(s => ({ ...s, maxWinner: Number(e.target.value) / 100 }))} />
        </div>
        <div><span style={label}>Max loss (%)</span>
          <input type="number" style={input} value={Math.round(inp.maxLoss * 100)}
            onChange={e => setInp(s => ({ ...s, maxLoss: Number(e.target.value) / 100 }))} />
        </div>
        <div><span style={label}>Hold (weeks)</span>
          <input type="number" style={input} value={inp.holdWeeks}
            onChange={e => setInp(s => ({ ...s, holdWeeks: Math.max(1, Number(e.target.value)) }))} />
        </div>
      </div>

      {/* Math summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 10, color: COL.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reward : Risk</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: COL.txt, marginTop: 2 }}>{rewardRisk.toFixed(2)} : 1</div>
        </div>
        <div style={{ background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 10, color: COL.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Per-trade expectancy</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: posExpectancy >= 0 ? COL.green : COL.red, marginTop: 2 }}>{fmtSignedPct(posExpectancy, 2)}</div>
        </div>
        <div style={{ background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 10, color: COL.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Per-batch return</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: rBatch >= 0 ? COL.green : COL.red, marginTop: 2 }}>{fmtSignedPct(rBatch, 2)}</div>
        </div>
        <div style={{ background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 10, color: COL.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Trades to target</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: COL.cyan, marginTop: 2 }}>{proj.batches * inp.positions}</div>
        </div>
      </div>

      {/* BATCH LADDER TABLE — zzz201: variable W/L mix + milestones */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: COL.txt, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Batch ladder · realistic per-batch W/L mix
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={chip}>Total wins <b style={{ color: COL.green }}>{proj.cumWinsTotal}</b></span>
            <span style={chip}>Total stops <b style={{ color: COL.red }}>{proj.cumLossesTotal}</b></span>
            <span style={chip}>Actual win-rate <b style={{ color: COL.txt }}>{proj.cumWinsTotal + proj.cumLossesTotal > 0 ? ((proj.cumWinsTotal / (proj.cumWinsTotal + proj.cumLossesTotal)) * 100).toFixed(1) + '%' : '—'}</b></span>
          </div>
        </div>
        <div style={{ overflowX: 'auto', background: COL.panel2, borderRadius: 8, border: `1px solid ${COL.line2}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Batch</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Trades done</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Elapsed</th>
                <th style={{ textAlign: 'center', padding: '6px 10px' }}>W / L this batch</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Best win</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Worst stop</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Batch return</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Gain (₹)</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Portfolio</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>×</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Milestone</th>
              </tr>
            </thead>
            <tbody>
              {proj.ladder.filter((row, i) =>
                i < 10 || i >= proj.ladder.length - 6 || row.milestone !== null || i % Math.max(1, Math.floor(proj.ladder.length / 14)) === 0
              ).map(row => (
                <tr key={row.batch} style={{ borderBottom: `1px solid ${COL.line}`, background: row.milestone ? '#F59E0B10' : 'transparent' }}>
                  <td style={{ padding: '6px 10px', color: COL.muted }}>#{row.batch}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: COL.cyan, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.cumTrades}</td>
                  <td style={{ padding: '6px 10px', color: COL.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {row.weeksElapsed >= 52 ? `${(row.weeksElapsed / 52).toFixed(1)}y` : `${row.weeksElapsed}w`}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center', color: COL.txt, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: COL.green, fontWeight: 700 }}>{row.wins}</span>
                    <span style={{ color: COL.muted, margin: '0 4px' }}>/</span>
                    <span style={{ color: COL.red, fontWeight: 700 }}>{row.losses}</span>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: row.bestWin > 0 ? COL.green : COL.muted }}>{row.bestWin > 0 ? fmtSignedPct(row.bestWin, 0) : '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: row.worstLoss < 0 ? COL.red : COL.muted }}>{row.worstLoss < 0 ? fmtSignedPct(row.worstLoss, 0) : '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: row.batchRet >= 0 ? COL.green : COL.red, fontWeight: 700 }}>{fmtSignedPct(row.batchRet, 2)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: row.gainRs >= 0 ? COL.green : COL.red, fontVariantNumeric: 'tabular-nums' }}>{row.gainRs >= 0 ? '+' : ''}{fmtMoney(Math.abs(row.gainRs))}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: COL.txt, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(row.portfolio)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: COL.cyan, fontWeight: 700 }}>{row.multiple.toFixed(2)}×</td>
                  <td style={{ padding: '6px 10px', color: row.milestone ? COL.amber : COL.muted, fontWeight: row.milestone ? 700 : 400 }}>
                    {row.milestone || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: COL.muted, marginTop: 8, lineHeight: 1.5 }}>
          Each batch simulates 10 concurrent trades independently at your win-rate — batch returns vary as they would in a live book.
          Occasionally you'll see batches with 3 wins / 7 stops (drawdown) and 8 wins / 2 stops (breakout). Cumulative win-rate converges to your assumption as batches compound.
        </div>
      </div>

      {/* SAMPLE TRADE SEQUENCE (30 trades) */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: COL.txt, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Sample trade sequence · first 30 trades (illustrative Minervini-style setups)
        </div>
        <div style={{ overflowX: 'auto', background: COL.panel2, borderRadius: 8, border: `1px solid ${COL.line2}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: COL.muted, borderBottom: `1px solid ${COL.line2}` }}>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>#</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Ticker</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Setup</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Result</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Return</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Days</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Contribution</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Running portfolio</th>
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COL.line}` }}>
                  <td style={{ padding: '4px 8px', color: COL.muted }}>T{r.i}</td>
                  <td style={{ padding: '4px 8px', color: COL.txt, fontWeight: 600 }}>{r.ticker}</td>
                  <td style={{ padding: '4px 8px', color: COL.muted }}>{r.setup}</td>
                  <td style={{ padding: '4px 8px', color: r.type === 'W' ? COL.green : COL.red, fontWeight: 700 }}>{r.type === 'W' ? 'WIN' : 'STOP'}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: r.ret >= 0 ? COL.green : COL.red }}>{fmtSignedPct(r.ret, 1)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: COL.muted }}>{r.days}d</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: r.contrib >= 0 ? COL.green : COL.red }}>{fmtSignedPct(r.contrib, 2)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: COL.txt, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: COL.muted, marginTop: 8, lineHeight: 1.5 }}>
          Deterministic sample using expected mix. Real Minervini-style trading has streaks — 5+ wins in a row and 4+ stops in a row are common;
          equity curve stair-steps with visible drawdowns. Use the Monte Carlo panel below to see how variance affects the path.
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginTop: 14, background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 8, padding: 12, fontSize: 11, color: COL.txt, lineHeight: 1.6 }}>
        <div style={{ color: COL.cyan, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>How to read this</div>
        Reward-to-risk of <b>{rewardRisk.toFixed(2)} : 1</b> with <b>{fmtPct(inp.winRate, 0)}</b> win-rate produces per-position expectancy of <b style={{ color: posExpectancy >= 0 ? COL.green : COL.red }}>{fmtSignedPct(posExpectancy, 2)}</b>.
        With 10 concurrent positions rolling every {inp.holdWeeks} weeks, that compounds to <b style={{ color: COL.amber }}>{fmtSignedPct(proj.cagr, 1)} CAGR</b>,
        turning {fmtMoney(inp.startCapital)} into {fmtMoney(inp.targetCapital)} in about <b style={{ color: COL.green }}>{proj.years.toFixed(1)} years</b>.
        That&apos;s <b>{proj.batches * inp.positions}</b> total trades. The math is only that clean if losses stay disciplined —
        one -30% instead of -13% eats a full batch of winners. That&apos;s why Minervini&apos;s hard rule is <i>never let a loser run</i>.
      </div>
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

        {/* zzz200: GROWTH LADDER — path from starting capital to target */}
        <GrowthLadder />

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

        {/* INPUTS + CHARTS row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) 1fr', gap: 16, marginBottom: 20 }}>
          {/* Inputs */}
          <div style={{ ...card }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COL.txt, marginBottom: 14 }}>Inputs</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 12 }}>
            <div style={{ ...card, padding: 8 }}>
              <Histogram data={result.cagrs} />
            </div>
            <div style={{ ...card, padding: 8 }}>
              <EquityCurves curves={result.sampleEquity} years={inp.years} capital={inp.capital} />
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
                  : p20 >= 0.35 ? 'Close to even odds on hitting >20% CAGR. A real edge, but variance is wide — plan for the P10 downside.'
                  : p20 >= 0.20 ? 'Roughly 1-in-4 shot at >20% CAGR. Meaningful, but requires discipline through drawdowns.'
                  : 'Achieving >20% CAGR is a low-probability outcome under these inputs. Improve win-rate or reward-to-risk before scaling.'}
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

        {/* Footer note */}
        <div style={{ ...card, fontSize: 12, color: COL.muted, lineHeight: 1.6 }}>
          <b style={{ color: COL.txt }}>Notes on the model.</b> Monthly Monte Carlo path with an additive market factor
          (~15% annual market vol) applied to every position each month, so drawdowns reflect realistic correlated selloffs
          rather than IID noise. Individual position win/loss is drawn from your win-rate assumption. Ignores transaction
          costs, taxes and dividends. Treat CAGR as the compounded arithmetic return; drawdowns are within-horizon peak-to-trough.
          Not a forecast — a sensitivity tool for win-rate and reward/risk.
        </div>
      </div>
    </div>
  );
}
