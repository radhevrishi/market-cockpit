'use client';

// zzz403 — Nifty Smallcap 100 Scenario Simulator.
//
// A native, upgraded rebuild of TheWrap's public scenario simulator
// (thewrapniftysmallcapsimulator.tiiny.site). Full parity with the original:
//   • Historical-context tiles ("what happened after negative years")
//   • Step 1 — 6 probability sliders (Crash → Boom) with historical base rates
//   • Step 2 — probability-weighted 2026 + cascading 2027–2030 conditional paths
//   • Return-path bar chart (2023–2025 actual + 2026–2030 forecast)
//   • ₹1L wealth projection + 5Y CAGR
//   • Dynamic insights that read the user's implied probabilities
//
// Upgrades beyond the original ("better than them"):
//   • Monte Carlo engine (4,000 sims, seeded/stable) → P10–P90 outcome FAN
//     on the chart, so you see the RANGE of outcomes, not one tidy line.
//   • One-click presets (Historical base rates / Bull / Base / Bear / Normalise).
//   • Adjustable starting capital + SIP (monthly) mode alongside lumpsum.
//   • Real (inflation-adjusted) returns toggle.
//   • Nifty 50 largecap benchmark overlay for the risk/return trade-off.
//   • Risk panel: P(loss), P(2×), P(halve), P10/P50/P90 ending value + CAGR.
//   • Save to localStorage + copy a shareable link that restores the scenario.
//
// Pure client component. All model constants mirror the source deck's
// 22-year (2004–2025) Nifty Smallcap 100 dataset. Educational only.

import React, { useEffect, useMemo, useState, useCallback } from 'react';

const C = {
  bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937',
  text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', text4: '#475569',
  cyan: '#06B6D4', gold: '#FBBF24', purple: '#A78BFA', green: '#22C55E',
  amber: '#F59E0B', red: '#EF4444', blue: '#60A5FA',
};

// ── Scenario model (mirrors the source; band = plausible spread for MC draws) ──
interface Scenario {
  id: string; name: string; range: string; midpoint: number;
  band: [number, number]; color: string; histPct: number; defaultPct: number;
}
const SCENARIOS: Scenario[] = [
  { id: 'crash',   name: 'Crash',           range: '< −30%',        midpoint: -50, band: [-72, -30], color: '#ff2040', histPct: 0,  defaultPct: 3 },
  { id: 'bad',     name: 'Bad Year',        range: '−30% to −15%',  midpoint: -22, band: [-30, -15], color: '#ff4757', histPct: 0,  defaultPct: 5 },
  { id: 'mildneg', name: 'Mild Negative',   range: '−15% to 0%',    midpoint: -7,  band: [-15, 0],   color: '#e07020', histPct: 17, defaultPct: 12 },
  { id: 'modest',  name: 'Modest Positive', range: '0% to +20%',    midpoint: 10,  band: [0, 20],    color: '#6c9a8b', histPct: 0,  defaultPct: 20 },
  { id: 'good',    name: 'Good Year',       range: '+20% to +50%',  midpoint: 35,  band: [20, 50],   color: '#00d4aa', histPct: 33, defaultPct: 35 },
  { id: 'boom',    name: 'Boom',            range: '+50%+',         midpoint: 60,  band: [50, 92],   color: '#00ffcc', histPct: 50, defaultPct: 25 },
];

// After-scenario conditional paths (what historically followed each 2026 outcome).
type Path = { 2027: number; 2028: number; 2029: number; 2030: number };
const CONDITIONAL_PATHS: Record<string, Path> = {
  crash:   { 2027: 85, 2028: 15,  2029: -25, 2030: 35 }, // V-recovery like 2009
  bad:     { 2027: 45, 2028: -8,  2029: 50,  2030: 7 },  // 2011→12→13→14
  mildneg: { 2027: 55, 2028: 8,   2029: 2,   2030: 50 }, // 2013→…→2017
  modest:  { 2027: 45, 2028: -22, 2029: 35,  2030: 8 },  // standard cycle
  good:    { 2027: 35, 2028: -18, 2029: 40,  2030: 5 },  // peaking cycle
  boom:    { 2027: -5, 2028: -25, 2029: 55,  2030: 20 }, // mean reversion
};

const HISTORICAL_BARS = [
  { yr: 2023, ret: 55.6 }, { yr: 2024, ret: 23.9 }, { yr: 2025, ret: -5.6 },
];
const FORECAST_YEARS = [2026, 2027, 2028, 2029, 2030];

// Presets — each sums to 100.
const PRESETS: { id: string; label: string; probs: number[] }[] = [
  { id: 'hist',   label: '📊 Historical base rates', probs: SCENARIOS.map(s => s.histPct) }, // [0,0,17,0,33,50]
  { id: 'bull',   label: '🐂 Bull case',              probs: [0, 2, 8, 15, 40, 35] },
  { id: 'base',   label: '⚖ Base case',               probs: SCENARIOS.map(s => s.defaultPct) },
  { id: 'bear',   label: '🐻 Bear case',              probs: [15, 20, 25, 20, 15, 5] },
];

const LS_KEY = 'mc:smallcap-sim:v1';
const N_SIMS = 4000;
const BENCH_MEAN = 12;   // Nifty 50 nominal expected annual %
const BENCH_VOL = 17;    // Nifty 50 annual std dev %

// ── Small stats helpers (seeded PRNG so the fan is stable across renders) ──
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number): number {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }
function pctile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function inrCompact(n: number): string {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'k';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

interface MCResult {
  // per forecast-year annual-return percentiles (index 0 = 2026)
  band: { p10: number; p25: number; p50: number; p75: number; p90: number }[];
  benchBand: { p10: number; p50: number; p90: number }[];
  ending: { p10: number; p25: number; p50: number; p75: number; p90: number };
  cagr: { p10: number; p50: number; p90: number };
  pLoss: number; pDouble: number; pHalf: number;
  invested: number; benchMedianEnd: number;
}

export default function SmallcapSimulatorPage() {
  const [probs, setProbs] = useState<number[]>(SCENARIOS.map(s => s.defaultPct));
  const [capital, setCapital] = useState<number>(100000);
  const [mode, setMode] = useState<'lumpsum' | 'sip'>('lumpsum');
  const [monthlySip, setMonthlySip] = useState<number>(10000);
  const [realReturns, setRealReturns] = useState<boolean>(false);
  const [inflation] = useState<number>(5.5);
  const [showBench, setShowBench] = useState<boolean>(true);
  const [vol, setVol] = useState<number>(42); // annual std dev, source-quoted
  const [savedFlash, setSavedFlash] = useState<string>('');

  // ── restore from URL (shareable link) → else localStorage → else defaults ──
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const pRaw = qs.get('p');
      if (pRaw) {
        const arr = pRaw.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        if (arr.length === 6) setProbs(arr);
        if (qs.get('cap')) setCapital(clamp(parseInt(qs.get('cap')!, 10) || 100000, 1000, 1e11));
        if (qs.get('mode') === 'sip') setMode('sip');
        if (qs.get('sip')) setMonthlySip(clamp(parseInt(qs.get('sip')!, 10) || 10000, 100, 1e9));
        if (qs.get('real') === '1') setRealReturns(true);
        if (qs.get('vol')) setVol(clamp(parseInt(qs.get('vol')!, 10) || 42, 10, 70));
        return;
      }
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.probs) && s.probs.length === 6) setProbs(s.probs);
        if (typeof s.capital === 'number') setCapital(s.capital);
        if (s.mode === 'sip') setMode('sip');
        if (typeof s.monthlySip === 'number') setMonthlySip(s.monthlySip);
        if (typeof s.realReturns === 'boolean') setRealReturns(s.realReturns);
        if (typeof s.vol === 'number') setVol(s.vol);
      }
    } catch { /* ignore */ }
  }, []);

  const total = probs.reduce((a, b) => a + b, 0);
  const norm = useMemo(() => (total > 0 ? probs.map(p => p / total) : probs.map(() => 0)), [probs, total]);

  // ── deterministic expected path (parity with the source) ──
  const expected = useMemo(() => {
    const e2026 = SCENARIOS.reduce((acc, s, i) => acc + norm[i] * s.midpoint, 0);
    const eYear = (y: 2027 | 2028 | 2029 | 2030) =>
      SCENARIOS.reduce((acc, s, i) => acc + norm[i] * CONDITIONAL_PATHS[s.id][y], 0);
    let arr = [e2026, eYear(2027), eYear(2028), eYear(2029), eYear(2030)];
    if (realReturns) arr = arr.map(r => r - inflation);
    return arr;
  }, [norm, realReturns, inflation]);

  // ── deterministic wealth path (parity) ──
  const wealthPath = useMemo(() => {
    const annual = monthlySip * 12;
    let w = capital;
    const pts: { yr: string; val: number }[] = [{ yr: 'Dec 2025', val: w }];
    FORECAST_YEARS.forEach((yr, i) => {
      const g = 1 + expected[i] / 100;
      if (mode === 'sip') w = w * g + annual * (1 + expected[i] / 200);
      else w = w * g;
      pts.push({ yr: `Dec ${yr}`, val: w });
    });
    return pts;
  }, [expected, capital, mode, monthlySip]);

  const invested = mode === 'sip' ? capital + monthlySip * 12 * 5 : capital;
  const finalDet = wealthPath[wealthPath.length - 1].val;
  const detCagr = (Math.pow(finalDet / Math.max(invested, 1), 1 / 5) - 1) * 100;
  const detTotalRet = (finalDet / Math.max(invested, 1) - 1) * 100;

  // ── Monte Carlo ──
  const mc = useMemo<MCResult>(() => {
    const rng = mulberry32(1234567); // fixed seed → stable, reproducible fan
    // cumulative distribution over scenarios
    const cum: number[] = [];
    let run = 0;
    for (let i = 0; i < norm.length; i++) { run += norm[i]; cum.push(run); }
    const annual = monthlySip * 12;

    const yearRet: number[][] = [[], [], [], [], []];     // smallcap annual returns per year
    const benchRet: number[][] = [[], [], [], [], []];    // benchmark annual returns per year
    const endW: number[] = [];
    const endWBench: number[] = [];

    for (let s = 0; s < N_SIMS; s++) {
      // sample 2026 scenario
      const r = rng();
      let si = cum.findIndex(c => r <= c);
      if (si < 0) si = SCENARIOS.length - 1;
      const sc = SCENARIOS[si];
      const path = CONDITIONAL_PATHS[sc.id];

      // draw the 5-year return sequence for this sim
      const seq: number[] = [];
      const band0sigma = (sc.band[1] - sc.band[0]) / 4;
      let r26 = sc.midpoint + gaussian(rng) * band0sigma;
      r26 = clamp(r26, sc.band[0], sc.band[1]);
      seq.push(r26);
      ([2027, 2028, 2029, 2030] as const).forEach(y => {
        let rr = path[y] + gaussian(rng) * vol;
        rr = clamp(rr, -85, 260);
        seq.push(rr);
      });

      // benchmark sequence
      const bseq: number[] = [];
      for (let y = 0; y < 5; y++) bseq.push(clamp(BENCH_MEAN + gaussian(rng) * BENCH_VOL, -55, 90));

      // apply inflation adjustment + compound
      let w = capital, wb = capital;
      for (let y = 0; y < 5; y++) {
        const rSmall = realReturns ? seq[y] - inflation : seq[y];
        const rBench = realReturns ? bseq[y] - inflation : bseq[y];
        yearRet[y].push(seq[y] - (realReturns ? inflation : 0));
        benchRet[y].push(bseq[y] - (realReturns ? inflation : 0));
        const gS = 1 + rSmall / 100, gB = 1 + rBench / 100;
        if (mode === 'sip') {
          w = w * gS + annual * (1 + rSmall / 200);
          wb = wb * gB + annual * (1 + rBench / 200);
        } else { w = w * gS; wb = wb * gB; }
      }
      endW.push(w); endWBench.push(wb);
    }

    const band = yearRet.map(a => {
      const so = a.slice().sort((x, y) => x - y);
      return { p10: pctile(so, 10), p25: pctile(so, 25), p50: pctile(so, 50), p75: pctile(so, 75), p90: pctile(so, 90) };
    });
    const benchBand = benchRet.map(a => {
      const so = a.slice().sort((x, y) => x - y);
      return { p10: pctile(so, 10), p50: pctile(so, 50), p90: pctile(so, 90) };
    });
    const soEnd = endW.slice().sort((x, y) => x - y);
    const soBench = endWBench.slice().sort((x, y) => x - y);
    const inv = mode === 'sip' ? capital + annual * 5 : capital;
    const cagrArr = soEnd.map(w => (Math.pow(w / Math.max(inv, 1), 1 / 5) - 1) * 100).sort((x, y) => x - y);

    return {
      band, benchBand,
      ending: { p10: pctile(soEnd, 10), p25: pctile(soEnd, 25), p50: pctile(soEnd, 50), p75: pctile(soEnd, 75), p90: pctile(soEnd, 90) },
      cagr: { p10: pctile(cagrArr, 10), p50: pctile(cagrArr, 50), p90: pctile(cagrArr, 90) },
      pLoss: (endW.filter(w => w < inv).length / endW.length) * 100,
      pDouble: (endW.filter(w => w >= inv * 2).length / endW.length) * 100,
      pHalf: (endW.filter(w => w <= inv * 0.5).length / endW.length) * 100,
      invested: inv,
      benchMedianEnd: pctile(soBench, 50),
    };
  }, [norm, capital, mode, monthlySip, realReturns, inflation, vol]);

  // ── implied probability read-outs (parity insights) ──
  const pNeg = (norm[0] + norm[1] + norm[2]) * 100;
  const pPos = (norm[3] + norm[4] + norm[5]) * 100;
  const pWorse2025 = (norm[0] + norm[1]) * 100;
  const e2026 = expected[0];

  // ── handlers ──
  const setProb = useCallback((idx: number, val: number) => {
    setProbs(prev => { const n = prev.slice(); n[idx] = clamp(Math.round(val), 0, 90); return n; });
  }, []);
  const applyPreset = useCallback((p: number[]) => setProbs(p.slice()), []);
  const normalise = useCallback(() => {
    setProbs(prev => {
      const t = prev.reduce((a, b) => a + b, 0);
      if (t === 0) return prev;
      return prev.map(p => Math.round((p / t) * 100));
    });
  }, []);
  const save = useCallback(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ probs, capital, mode, monthlySip, realReturns, vol }));
      setSavedFlash('✓ Saved to this browser');
      setTimeout(() => setSavedFlash(''), 2200);
    } catch { setSavedFlash('⚠ Could not save'); }
  }, [probs, capital, mode, monthlySip, realReturns, vol]);
  const copyLink = useCallback(() => {
    try {
      const qs = new URLSearchParams();
      qs.set('p', probs.join(','));
      qs.set('cap', String(capital));
      if (mode === 'sip') { qs.set('mode', 'sip'); qs.set('sip', String(monthlySip)); }
      if (realReturns) qs.set('real', '1');
      qs.set('vol', String(vol));
      const url = `${window.location.origin}${window.location.pathname}?${qs.toString()}`;
      navigator.clipboard?.writeText(url);
      setSavedFlash('🔗 Shareable link copied');
      setTimeout(() => setSavedFlash(''), 2200);
    } catch { setSavedFlash('⚠ Could not copy'); }
  }, [probs, capital, mode, monthlySip, realReturns, vol]);

  // ── chart geometry (SVG) ──
  const chart = useMemo(() => {
    const W = 780, H = 340, padL = 4, padR = 8, padTop = 10, padBot = 30;
    const plotH = H - padTop - padBot;
    const allVals = [
      ...HISTORICAL_BARS.map(b => b.ret),
      ...mc.band.map(b => b.p90), ...mc.band.map(b => b.p10), ...expected,
    ];
    const maxAbs = Math.max(80, ...allVals.map(v => Math.abs(v)));
    const zeroY = padTop + plotH / 2;
    const scale = (plotH / 2) / maxAbs;
    const yOf = (v: number) => zeroY - v * scale;
    const cols = HISTORICAL_BARS.length + FORECAST_YEARS.length; // 8
    const colW = (W - padL - padR) / cols;
    const xOf = (i: number) => padL + colW * (i + 0.5);
    return { W, H, padL, padR, padTop, padBot, plotH, zeroY, scale, yOf, colW, xOf, cols, maxAbs };
  }, [mc, expected]);

  // build fan polygon points for forecast (indices 3..7 across all 8 cols)
  const forecastX = (fi: number) => chart.xOf(HISTORICAL_BARS.length + fi);
  const fanUpper = mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p90).toFixed(1)}`);
  const fanLower = mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p10).toFixed(1)}`).reverse();
  const fanPoly = [...fanUpper, ...fanLower].join(' ');
  const fanInnerU = mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p75).toFixed(1)}`);
  const fanInnerL = mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p25).toFixed(1)}`).reverse();
  const fanInner = [...fanInnerU, ...fanInnerL].join(' ');
  const expLine = expected.map((r, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(r).toFixed(1)}`).join(' ');
  const benchLine = mc.benchBand.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p50).toFixed(1)}`).join(' ');

  // ── styles ──
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 };
  const cardLabel: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12, fontWeight: 700 };
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' };
  const chipBtn = (active: boolean, color: string): React.CSSProperties => ({
    fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
    background: active ? `${color}22` : `${color}10`, color, border: `1px solid ${color}${active ? '77' : '33'}`,
    ...mono,
  });

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20, padding: '16px 20px', background: `linear-gradient(135deg, ${C.purple}18 0%, ${C.panel} 100%)`, border: `1px solid ${C.purple}33`, borderRadius: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', margin: 0 }}>
              Nifty Smallcap 100 — Scenario Simulator
            </h1>
            <div style={{ ...mono, fontSize: 12, color: C.text3, marginTop: 5 }}>
              Set your 2026 probability assumptions → cascading projections for 2027–2030, with a Monte-Carlo outcome range
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={save} style={chipBtn(false, C.green)}>💾 Save</button>
            <button onClick={copyLink} style={chipBtn(false, C.cyan)}>🔗 Share</button>
          </div>
        </div>
        {savedFlash && (
          <div style={{ ...mono, fontSize: 12, color: C.green, marginBottom: 12, marginTop: -8 }}>{savedFlash}</div>
        )}

        {/* Historical context */}
        <div style={card}>
          <div style={cardLabel}>Historical Context — what happened after negative years?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
            {[
              { label: '2025 Return', value: '−5.6%', color: C.red },
              { label: 'P(Neg after Neg)', value: '17%', color: C.amber },
              { label: 'P(Boom after Neg)', value: '50%', color: C.green },
              { label: 'Double-Neg Cases', value: '1 of 22', color: C.text2 },
              { label: 'After Mild Neg → Worse', value: '0 of 3', color: C.green },
              { label: '22Y Avg Return', value: '+22.6%', color: C.green },
            ].map(t => (
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9.5, color: C.text3, marginBottom: 3 }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 17, fontWeight: 800, color: t.color }}>{t.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6 }}>
            After the 6 historical negative years, the next year was:{' '}
            <span style={{ color: C.green, fontWeight: 700 }}>+107%</span>,{' '}
            <span style={{ color: C.green, fontWeight: 700 }}>+36.8%</span>,{' '}
            <span style={{ color: C.green, fontWeight: 700 }}>+55%</span>,{' '}
            <span style={{ color: C.red, fontWeight: 700 }}>−9.5%</span>,{' '}
            <span style={{ color: C.green, fontWeight: 700 }}>+21.5%</span>,{' '}
            <span style={{ color: C.green, fontWeight: 700 }}>+55.6%</span>. Only once (2018→2019) did
            back-to-back negatives occur — and what followed was explosive: 2020–2024 compounded at 26% CAGR.
          </div>
        </div>

        {/* Step 1 — sliders + presets */}
        <div style={card}>
          <div style={cardLabel}>Step 1 — set your 2026 scenario probabilities</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => applyPreset(p.probs)} style={chipBtn(false, C.purple)}>{p.label}</button>
            ))}
            <button onClick={normalise} style={chipBtn(false, C.gold)}>↺ Normalise to 100%</button>
          </div>
          <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 12 }}>
            Adjust the sliders to assign your probability to each outcome. Historical base rates (given 2025 was negative) shown as reference.
          </div>

          {SCENARIOS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < SCENARIOS.length - 1 ? `1px solid ${C.border}` : 'none', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 150 }}>
                <span style={{ color: s.color, fontWeight: 700, fontSize: 13 }}>{s.name}</span>
                <div style={{ fontSize: 10, color: C.text3 }}>{s.range}</div>
              </div>
              <div style={{ minWidth: 64, textAlign: 'center' }}>
                <span style={{ ...mono, fontSize: 10, padding: '2px 7px', borderRadius: 5, background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}30` }}>hist: {s.histPct}%</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
                <input
                  type="range" min={0} max={80} value={probs[i]}
                  onChange={e => setProb(i, parseInt(e.target.value, 10))}
                  style={{ flex: 1, accentColor: s.color, cursor: 'pointer' }}
                />
                <div style={{ ...mono, minWidth: 44, textAlign: 'right', color: s.color, fontWeight: 700, fontSize: 14 }}>{probs[i]}%</div>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 12, ...mono, fontSize: 13, fontWeight: 700, color: total === 100 ? C.green : total > 100 ? C.red : C.amber }}>
            Total: {total}% {total === 100 ? '✓' : total < 100 ? `(need ${100 - total}% more)` : `(${total - 100}% over)`}
            {total !== 100 && <span style={{ color: C.text3, fontWeight: 400 }}> — probabilities are auto-normalised for the maths below</span>}
          </div>
        </div>

        {/* Controls: capital / mode / real / vol / benchmark */}
        <div style={card}>
          <div style={cardLabel}>Investment settings</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 11.5, color: C.text3 }}>
              {mode === 'sip' ? 'Initial lumpsum (₹)' : 'Amount invested (₹)'}
              <input type="number" min={1000} step={10000} value={capital}
                onChange={e => setCapital(clamp(parseInt(e.target.value, 10) || 0, 0, 1e11))}
                style={{ display: 'block', marginTop: 4, width: 150, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '7px 10px', ...mono, fontSize: 13 }} />
            </label>
            <div>
              <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 4 }}>Mode</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setMode('lumpsum')} style={chipBtn(mode === 'lumpsum', C.cyan)}>Lumpsum</button>
                <button onClick={() => setMode('sip')} style={chipBtn(mode === 'sip', C.cyan)}>Monthly SIP</button>
              </div>
            </div>
            {mode === 'sip' && (
              <label style={{ fontSize: 11.5, color: C.text3 }}>
                Monthly SIP (₹)
                <input type="number" min={100} step={1000} value={monthlySip}
                  onChange={e => setMonthlySip(clamp(parseInt(e.target.value, 10) || 0, 0, 1e9))}
                  style={{ display: 'block', marginTop: 4, width: 130, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '7px 10px', ...mono, fontSize: 13 }} />
              </label>
            )}
            <div>
              <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 4 }}>Returns</div>
              <button onClick={() => setRealReturns(v => !v)} style={chipBtn(realReturns, C.amber)}>
                {realReturns ? `Real (−${inflation}% infl.)` : 'Nominal'}
              </button>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 4 }}>Benchmark</div>
              <button onClick={() => setShowBench(v => !v)} style={chipBtn(showBench, C.blue)}>
                {showBench ? '✓ Nifty 50 overlay' : 'Nifty 50 overlay'}
              </button>
            </div>
            <label style={{ fontSize: 11.5, color: C.text3 }}>
              Annual volatility: <span style={{ ...mono, color: C.text2 }}>{vol}%</span>
              <input type="range" min={20} max={60} value={vol} onChange={e => setVol(parseInt(e.target.value, 10))}
                style={{ display: 'block', marginTop: 6, width: 150, accentColor: C.purple, cursor: 'pointer' }} />
            </label>
          </div>
          <div style={{ fontSize: 10.5, color: C.text4, marginTop: 10 }}>
            The Monte-Carlo engine runs {N_SIMS.toLocaleString('en-IN')} simulations, sampling a 2026 scenario from your probabilities and adding {vol}% annual volatility to every year — the source deck's own quoted figure. The shaded band on the chart is the resulting P10–P90 range of outcomes.
          </div>
        </div>

        {/* Step 2 — year cards */}
        <div style={card}>
          <div style={cardLabel}>Step 2 — probability-weighted 2026 &amp; cascading 2027–2030</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 18 }}>
            {FORECAST_YEARS.map((yr, i) => {
              const ret = expected[i];
              const isPos = ret >= 0;
              const color = isPos ? C.green : C.red;
              return (
                <div key={yr} style={{ background: isPos ? `${C.green}10` : `${C.red}10`, border: `1px solid ${isPos ? C.green : C.red}28`, borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ ...mono, fontSize: 13, color: yr === 2026 ? C.amber : color, fontWeight: 700 }}>{yr}</div>
                  <div style={{ ...mono, fontSize: 22, fontWeight: 800, color }}>{isPos ? '+' : ''}{ret.toFixed(1)}%</div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.text3 }}>{yr === 2026 ? 'Weighted Avg' : 'Conditional'}</div>
                  <div style={{ ...mono, fontSize: 9, color: C.text4, marginTop: 3 }}>
                    P10 {mc.band[i].p10.toFixed(0)}% · P90 {mc.band[i].p90.toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chart */}
          <div style={{ ...mono, fontSize: 10, color: C.text3, marginBottom: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span><span style={{ color: C.gold }}>━</span> expected return</span>
            <span><span style={{ color: C.purple }}>▒</span> Monte-Carlo P10–P90</span>
            <span><span style={{ color: C.purple }}>▓</span> P25–P75</span>
            {showBench && <span><span style={{ color: C.blue }}>┈</span> Nifty 50 median</span>}
            <span style={{ color: C.text4 }}>| solid bars = actual 2023–2025</span>
          </div>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
            {/* y grid */}
            {[-60, -40, -20, 20, 40, 60, 80].filter(v => Math.abs(v) <= chart.maxAbs).map(v => (
              <g key={v}>
                <line x1={chart.padL} y1={chart.yOf(v)} x2={chart.W - chart.padR} y2={chart.yOf(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="2 4" />
                <text x={chart.W - chart.padR} y={chart.yOf(v) - 2} fill={C.text4} fontSize={8} textAnchor="end" style={mono}>{v > 0 ? '+' : ''}{v}%</text>
              </g>
            ))}
            {/* zero line */}
            <line x1={chart.padL} y1={chart.zeroY} x2={chart.W - chart.padR} y2={chart.zeroY} stroke={C.text3} strokeWidth={1} />

            {/* forecast divider */}
            <line x1={chart.xOf(HISTORICAL_BARS.length) - chart.colW / 2} y1={chart.padTop} x2={chart.xOf(HISTORICAL_BARS.length) - chart.colW / 2} y2={chart.H - chart.padBot} stroke={`${C.amber}55`} strokeWidth={1} strokeDasharray="4 4" />
            <text x={chart.xOf(HISTORICAL_BARS.length) - chart.colW / 2 + 4} y={chart.padTop + 9} fill={C.amber} fontSize={8.5} style={mono}>forecast →</text>

            {/* MC fan */}
            <polygon points={fanPoly} fill={`${C.purple}1f`} stroke="none" />
            <polygon points={fanInner} fill={`${C.purple}30`} stroke="none" />

            {/* historical bars */}
            {HISTORICAL_BARS.map((b, i) => {
              const isPos = b.ret >= 0;
              const x = chart.xOf(i);
              const barW = Math.min(30, chart.colW * 0.5);
              const y0 = chart.zeroY;
              const y1 = chart.yOf(b.ret);
              const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
              const col = isPos ? C.green : C.red;
              return (
                <g key={b.yr}>
                  <rect x={x - barW / 2} y={top} width={barW} height={h} rx={2} fill={`${col}88`} />
                  <text x={x} y={(isPos ? top - 4 : top + h + 10)} fill={col} fontSize={9} textAnchor="middle" style={mono}>{isPos ? '+' : ''}{b.ret.toFixed(0)}%</text>
                  <text x={x} y={chart.H - chart.padBot + 14} fill={C.text3} fontSize={9} textAnchor="middle" style={mono}>{b.yr}</text>
                </g>
              );
            })}

            {/* benchmark line */}
            {showBench && <polyline points={benchLine} fill="none" stroke={C.blue} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85} />}

            {/* expected line + points */}
            <polyline points={expLine} fill="none" stroke={C.gold} strokeWidth={2} />
            {expected.map((r, fi) => (
              <g key={fi}>
                <circle cx={forecastX(fi)} cy={chart.yOf(r)} r={3.5} fill={C.gold} stroke={C.bg} strokeWidth={1.5} />
                <text x={forecastX(fi)} y={r >= 0 ? chart.yOf(r) - 8 : chart.yOf(r) + 14} fill={C.gold} fontSize={9} textAnchor="middle" style={mono}>{r >= 0 ? '+' : ''}{r.toFixed(0)}%</text>
                <text x={forecastX(fi)} y={chart.H - chart.padBot + 14} fill={C.amber} fontSize={9} textAnchor="middle" style={mono}>{FORECAST_YEARS[fi]}</text>
              </g>
            ))}
          </svg>
        </div>

        {/* Wealth + risk */}
        <div style={card}>
          <div style={cardLabel}>{inrCompact(capital)}{mode === 'sip' ? ` + ${inrCompact(monthlySip)}/mo SIP` : ''} invested Dec 2025 → projected growth</div>

          {/* deterministic bars */}
          {wealthPath.map((v, i) => {
            const maxVal = Math.max(...wealthPath.map(p => p.val));
            const pct = (v.val / maxVal) * 100;
            const up = v.val >= invested;
            const col = up ? C.green : C.red;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ ...mono, fontSize: 11, color: C.text3, minWidth: 68 }}>{v.yr}</div>
                <div style={{ flex: 1, background: C.panel2, borderRadius: 6, height: 24, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: `${col}25`, border: `1px solid ${col}45`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, minWidth: 90 }}>
                    <span style={{ ...mono, fontSize: 11, color: col, fontWeight: 700 }}>{inr(v.val)}</span>
                  </div>
                </div>
              </div>
            );
          })}

          <div style={{ ...mono, fontSize: 12.5, marginTop: 12, marginBottom: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <span style={{ color: C.cyan, fontWeight: 700 }}>5Y CAGR (expected): {detCagr.toFixed(1)}%</span>
            <span style={{ color: C.text3 }}> · Total return: {detTotalRet >= 0 ? '+' : ''}{detTotalRet.toFixed(0)}%</span>
            <span style={{ color: C.text3 }}> · {inrCompact(invested)} → {inrCompact(finalDet)}</span>
          </div>

          {/* Monte-Carlo outcome distribution */}
          <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 10, ...mono }}>
            Monte-Carlo outcome range · {N_SIMS.toLocaleString('en-IN')} paths ({mode === 'sip' ? `invested ${inrCompact(mc.invested)}` : 'lumpsum'})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'P10 · unlucky', val: inrCompact(mc.ending.p10), color: C.red },
              { label: 'P25', val: inrCompact(mc.ending.p25), color: C.amber },
              { label: 'P50 · median', val: inrCompact(mc.ending.p50), color: C.text },
              { label: 'P75', val: inrCompact(mc.ending.p75), color: C.green },
              { label: 'P90 · lucky', val: inrCompact(mc.ending.p90), color: C.green },
            ].map(t => (
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.text3, marginBottom: 3, ...mono }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 14, fontWeight: 800, color: t.color }}>{t.val}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {[
              { label: 'P(loses money over 5Y)', val: `${mc.pLoss.toFixed(0)}%`, color: mc.pLoss > 25 ? C.red : C.amber },
              { label: 'P(doubles or better)', val: `${mc.pDouble.toFixed(0)}%`, color: C.green },
              { label: 'P(halves — deep loss)', val: `${mc.pHalf.toFixed(0)}%`, color: mc.pHalf > 10 ? C.red : C.text2 },
              { label: 'CAGR P10 → P90', val: `${mc.cagr.p10.toFixed(0)}% → ${mc.cagr.p90.toFixed(0)}%`, color: C.cyan },
              ...(showBench ? [{ label: 'Nifty 50 median end', val: inrCompact(mc.benchMedianEnd), color: C.blue }] : []),
            ].map(t => (
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.text3, marginBottom: 3, ...mono }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 14, fontWeight: 800, color: t.color }}>{t.val}</div>
              </div>
            ))}
          </div>
          {showBench && (
            <div style={{ fontSize: 11, color: C.text3, marginTop: 10, lineHeight: 1.5 }}>
              Smallcap median {inrCompact(mc.ending.p50)} vs Nifty 50 median {inrCompact(mc.benchMedianEnd)} —
              {mc.ending.p50 > mc.benchMedianEnd
                ? ` the extra ${inrCompact(mc.ending.p50 - mc.benchMedianEnd)} is your reward for carrying smallcap volatility. The P10 (${inrCompact(mc.ending.p10)}) is the price of admission if the cycle turns.`
                : ` the largecap median is higher here — your bearish weights don't justify the extra smallcap risk.`}
            </div>
          )}
        </div>

        {/* Dynamic insights */}
        <div style={card}>
          <div style={cardLabel}>Dynamic insights based on your assumptions</div>

          <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ ...mono, fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Your implied probabilities</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 12.5, color: C.text2 }}>
              <div>P(2026 is negative): <strong style={{ color: pNeg > 30 ? C.red : C.amber }}>{pNeg.toFixed(0)}%</strong></div>
              <div>P(2026 is positive): <strong style={{ color: C.green }}>{pPos.toFixed(0)}%</strong></div>
              <div>P(2026 worse than 2025): <strong style={{ color: pWorse2025 > 20 ? C.red : C.amber }}>{pWorse2025.toFixed(0)}%</strong></div>
              <div>E[2026 return]: <strong style={{ color: e2026 >= 0 ? C.green : C.red }}>{e2026 >= 0 ? '+' : ''}{e2026.toFixed(1)}%</strong></div>
            </div>
          </div>

          {pNeg > 30 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: `${C.red}0e`, border: `1px solid ${C.red}22`, borderRadius: 8, fontSize: 11.5, color: C.text2, lineHeight: 1.55 }}>
              <strong style={{ color: C.red }}>Bearish vs history:</strong> you're assigning {pNeg.toFixed(0)}% to a negative 2026. Historically, after a negative year the next year was negative only 17% of the time (1 of 6 cases). After <em>mild</em> negatives (−5% to −15% like 2025), the next year was worse exactly <strong>0 of 3 times</strong>.
            </div>
          )}
          {pWorse2025 > 15 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: `${C.red}0e`, border: `1px solid ${C.red}22`, borderRadius: 8, fontSize: 11.5, color: C.text2, lineHeight: 1.55 }}>
              <strong style={{ color: C.red }}>Deep correction scenario:</strong> you're giving {pWorse2025.toFixed(0)}% odds to 2026 being worse than −15%. If it plays out, history suggests the snap-back is violent — after every crash/bad year the recovery averaged +76% the following year. Your 2027 projection reflects that bounce.
            </div>
          )}
          {pPos > 70 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: `${C.green}0e`, border: `1px solid ${C.green}22`, borderRadius: 8, fontSize: 11.5, color: C.text2, lineHeight: 1.55 }}>
              <strong style={{ color: C.green }}>Bullish alignment with history:</strong> your {pPos.toFixed(0)}% positive probability lines up with the 83% historical rate of positive years following negatives. The expected {e2026 >= 0 ? '+' : ''}{e2026.toFixed(1)}% return {Math.abs(e2026) > 30 ? 'implies a strong' : 'implies a moderate'} recovery.
            </div>
          )}

          <div style={{ marginTop: 12, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ ...mono, fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>How the cascade works</div>
            <div style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.6 }}>
              <strong>2027–2030 are not independent guesses</strong> — they're probability-weighted conditional paths. Each 2026 scenario triggers a different cycle trajectory based on what historically followed similar outcomes:
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 5, marginTop: 10, ...mono, fontSize: 10.5 }}>
                <div style={{ color: '#ff2040' }}>If crash → V-recovery: +85, +15, −25, +35</div>
                <div style={{ color: '#ff4757' }}>If bad → Recovery cycle: +45, −8, +50, +7</div>
                <div style={{ color: '#e07020' }}>If mild neg → Boom deferred: +55, +8, +2, +50</div>
                <div style={{ color: '#6c9a8b' }}>If modest → Standard cycle: +45, −22, +35, +8</div>
                <div style={{ color: '#00d4aa' }}>If good → Peaking: +35, −18, +40, +5</div>
                <div style={{ color: '#00ffcc' }}>If boom → Reversion: −5, −25, +55, +20</div>
              </div>
              <div style={{ marginTop: 10 }}>
                Your probability weights blend these into the single expected line above; the Monte-Carlo band shows how wide the real distribution is once {vol}% annual volatility is layered on. Expected 5Y CAGR of{' '}
                <strong style={{ color: C.cyan }}>{detCagr.toFixed(1)}%</strong>{' '}
                {Math.abs(detCagr - 14) < 4 ? 'sits near the long-run average (~14%) — balanced assumptions.' : detCagr > 18 ? 'is above the long-run average — you may be overweighting bullish scenarios.' : 'is below the long-run average — you may be overweighting bearish scenarios.'}
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ background: `${C.amber}0c`, border: `1px solid ${C.amber}28`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.6 }}>
            <strong style={{ color: C.amber }}>⚠ Important.</strong> All probabilities and projections are pattern-extrapolation from 22 data points (Nifty Smallcap 100 monthly data, 2004–2025). Real markets are driven by macro, liquidity, policy, and global events that no historical pattern can capture. Annual std deviation is ~42% — any single year can deviate massively from expectations. This is an analytical exercise, <strong>not investment advice</strong>.
          </div>
        </div>
        <div style={{ ...mono, fontSize: 10.5, color: C.text4, textAlign: 'center', paddingBottom: 20 }}>
          Source: Investing.com NIFTY Smallcap 100 monthly data (2004–2025) · 22 years of returns · Market Cockpit rebuild with Monte-Carlo extension · educational only
        </div>
      </div>
    </div>
  );
}
