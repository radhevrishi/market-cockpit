'use client';

// zzz404 — QQQ (Nasdaq-100) Scenario Simulator.
//
// The USA counterpart to /smallcap-simulator, but calibrated end-to-end from
// the REAL 40-year Nasdaq-100 record (1986–2025) instead of hand-set numbers:
//   • Scenario buckets, midpoints and bands = the actual return distribution.
//   • Default probabilities = the true historical frequency of each bucket.
//   • Cascade (2027–2030) = the average of what ACTUALLY followed each bucket.
//   • Two Monte-Carlo engines: parametric (your weights + volatility) and a
//     historical block-bootstrap that replays real 5-year windows from history.
//   • S&P 500 benchmark overlay, USD, plus an empirical histogram of every year.
//
// Educational only. Pure client component; all maths run in-browser.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  NASDAQ100, computeStats, bucketize, freqProbs, conditionalPaths,
  type BucketDef, type Bucket,
} from '@/lib/market-history';

const C = {
  bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937',
  text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', text4: '#475569',
  cyan: '#06B6D4', gold: '#FBBF24', purple: '#A78BFA', green: '#22C55E',
  amber: '#F59E0B', red: '#EF4444', blue: '#60A5FA',
};

// ── data-driven scenario model (computed once at module load) ──
const DEFS: BucketDef[] = [
  { id: 'crash',  label: 'Crash',           range: '< −20%',       min: -100, max: -20, color: '#ff2040' },
  { id: 'bad',    label: 'Bad Year',        range: '−20% to −5%',  min: -20,  max: -5,  color: '#ff6b4a' },
  { id: 'flat',   label: 'Flat / Mild',     range: '−5% to +10%',  min: -5,   max: 10,  color: '#f0a500' },
  { id: 'modest', label: 'Modest',          range: '+10% to +20%', min: 10,   max: 20,  color: '#6c9a8b' },
  { id: 'good',   label: 'Good Year',       range: '+20% to +40%', min: 20,   max: 40,  color: '#00d4aa' },
  { id: 'boom',   label: 'Boom',            range: '+40%+',        min: 40,   max: 1000, color: '#00ffcc' },
];
const BUCKETS: Bucket[] = bucketize(NASDAQ100, DEFS);
const DEFAULT_PROBS = freqProbs(BUCKETS);
const PATHS = conditionalPaths(NASDAQ100, BUCKETS, 4);
const STATS = computeStats(NASDAQ100);
const NDX_BY_YEAR = new Map(NASDAQ100.map(s => [s.year, s.ret]));
const NDX_RETS = NASDAQ100.map(s => s.ret);

const HIST_BARS = NASDAQ100.slice(-3).map(s => ({ yr: s.year, ret: s.ret })); // 2023–2025
const FORECAST_YEARS = [2026, 2027, 2028, 2029, 2030];

const PRESETS: { id: string; label: string; probs: number[] }[] = [
  { id: 'hist',   label: '📊 Historical frequency', probs: DEFAULT_PROBS },
  { id: 'ai',     label: '🚀 AI supercycle',        probs: [3, 4, 8, 15, 30, 40] },
  { id: 'base',   label: '⚖ Balanced',              probs: [8, 7, 20, 20, 25, 20] },
  { id: 'recess', label: '🐻 Recession',            probs: [22, 18, 25, 15, 12, 8] },
];

const LS_KEY = 'mc:qqq-sim:v1';
const N_SIMS = 4000;
const BENCH_MEAN = 10.5, BENCH_VOL = 15.5; // S&P 500 nominal
const US_INFLATION = 3.0;

// ── helpers ──
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
  let u = 0, v = 0;
  while (u === 0) u = rng(); while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }
function pctile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function usd(n: number): string {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + Math.round(n).toLocaleString('en-US');
  return '$' + Math.round(n).toLocaleString('en-US');
}
function usdFull(n: number): string { return '$' + Math.round(n).toLocaleString('en-US'); }

interface MCResult {
  band: { p10: number; p25: number; p50: number; p75: number; p90: number }[];
  benchBand: { p50: number }[];
  ending: { p10: number; p25: number; p50: number; p75: number; p90: number };
  cagr: { p10: number; p50: number; p90: number };
  pLoss: number; pDouble: number; pTriple: number; pHalf: number;
  invested: number; benchMedianEnd: number;
}

export default function QqqSimulatorPage() {
  const [probs, setProbs] = useState<number[]>(DEFAULT_PROBS);
  const [capital, setCapital] = useState<number>(10000);
  const [mode, setMode] = useState<'lumpsum' | 'sip'>('lumpsum');
  const [monthlySip, setMonthlySip] = useState<number>(500);
  const [realReturns, setRealReturns] = useState<boolean>(false);
  const [showBench, setShowBench] = useState<boolean>(true);
  const [vol, setVol] = useState<number>(28); // NDX annual std dev ≈ 27–28%
  const [engine, setEngine] = useState<'parametric' | 'bootstrap'>('bootstrap');
  const [savedFlash, setSavedFlash] = useState<string>('');

  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const pRaw = qs.get('p');
      if (pRaw) {
        const arr = pRaw.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        if (arr.length === 6) setProbs(arr);
        if (qs.get('cap')) setCapital(clamp(parseInt(qs.get('cap')!, 10) || 10000, 100, 1e11));
        if (qs.get('mode') === 'sip') setMode('sip');
        if (qs.get('sip')) setMonthlySip(clamp(parseInt(qs.get('sip')!, 10) || 500, 10, 1e9));
        if (qs.get('real') === '1') setRealReturns(true);
        if (qs.get('vol')) setVol(clamp(parseInt(qs.get('vol')!, 10) || 28, 12, 45));
        if (qs.get('eng') === 'parametric') setEngine('parametric');
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
        if (s.engine === 'parametric') setEngine('parametric');
      }
    } catch { /* ignore */ }
  }, []);

  const total = probs.reduce((a, b) => a + b, 0);
  const norm = useMemo(() => (total > 0 ? probs.map(p => p / total) : probs.map(() => 0)), [probs, total]);

  const expected = useMemo(() => {
    const e2026 = BUCKETS.reduce((acc, b, i) => acc + norm[i] * b.midpoint, 0);
    const eYear = (k: number) => BUCKETS.reduce((acc, b, i) => acc + norm[i] * PATHS[b.id][k], 0);
    let arr = [e2026, eYear(0), eYear(1), eYear(2), eYear(3)];
    if (realReturns) arr = arr.map(r => r - US_INFLATION);
    return arr;
  }, [norm, realReturns]);

  const wealthPath = useMemo(() => {
    const annual = monthlySip * 12;
    let w = capital;
    const pts: { yr: string; val: number }[] = [{ yr: 'Dec 2025', val: w }];
    FORECAST_YEARS.forEach((yr, i) => {
      const g = 1 + expected[i] / 100;
      if (mode === 'sip') w = w * g + annual * (1 + expected[i] / 200); else w = w * g;
      pts.push({ yr: `Dec ${yr}`, val: w });
    });
    return pts;
  }, [expected, capital, mode, monthlySip]);

  const invested = mode === 'sip' ? capital + monthlySip * 12 * 5 : capital;
  const finalDet = wealthPath[wealthPath.length - 1].val;
  const detCagr = (Math.pow(finalDet / Math.max(invested, 1), 1 / 5) - 1) * 100;
  const detTotalRet = (finalDet / Math.max(invested, 1) - 1) * 100;

  const mc = useMemo<MCResult>(() => {
    const rng = mulberry32(20260817);
    const cum: number[] = []; let run = 0;
    for (let i = 0; i < norm.length; i++) { run += norm[i]; cum.push(run); }
    const annual = monthlySip * 12;
    const yearRet: number[][] = [[], [], [], [], []];
    const benchRet: number[][] = [[], [], [], [], []];
    const endW: number[] = []; const endWBench: number[] = [];

    for (let s = 0; s < N_SIMS; s++) {
      const r = rng();
      let si = cum.findIndex(c => r <= c);
      if (si < 0) si = BUCKETS.length - 1;
      const b = BUCKETS[si];
      const seq: number[] = [];

      if (engine === 'bootstrap' && b.years.length) {
        // replay a real 5-year window that began in this bucket
        const anchor = b.years[Math.floor(rng() * b.years.length)];
        seq.push(NDX_BY_YEAR.get(anchor)!);
        for (let h = 1; h <= 4; h++) {
          const rr = NDX_BY_YEAR.get(anchor + h);
          seq.push(rr !== undefined ? rr : NDX_RETS[Math.floor(rng() * NDX_RETS.length)]);
        }
      } else {
        const sig = Math.max(4, (b.band[1] - b.band[0]) / 4);
        seq.push(clamp(b.midpoint + gaussian(rng) * sig, b.band[0], b.band[1]));
        const path = PATHS[b.id];
        for (let h = 0; h < 4; h++) seq.push(clamp(path[h] + gaussian(rng) * vol, -60, 130));
      }

      const bseq: number[] = [];
      for (let y = 0; y < 5; y++) bseq.push(clamp(BENCH_MEAN + gaussian(rng) * BENCH_VOL, -45, 60));

      let w = capital, wb = capital;
      for (let y = 0; y < 5; y++) {
        const rS = realReturns ? seq[y] - US_INFLATION : seq[y];
        const rB = realReturns ? bseq[y] - US_INFLATION : bseq[y];
        yearRet[y].push(rS); benchRet[y].push(rB);
        const gS = 1 + rS / 100, gB = 1 + rB / 100;
        if (mode === 'sip') { w = w * gS + annual * (1 + rS / 200); wb = wb * gB + annual * (1 + rB / 200); }
        else { w = w * gS; wb = wb * gB; }
      }
      endW.push(w); endWBench.push(wb);
    }

    const band = yearRet.map(a => {
      const so = a.slice().sort((x, y) => x - y);
      return { p10: pctile(so, 10), p25: pctile(so, 25), p50: pctile(so, 50), p75: pctile(so, 75), p90: pctile(so, 90) };
    });
    const benchBand = benchRet.map(a => ({ p50: pctile(a.slice().sort((x, y) => x - y), 50) }));
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
      pTriple: (endW.filter(w => w >= inv * 3).length / endW.length) * 100,
      pHalf: (endW.filter(w => w <= inv * 0.5).length / endW.length) * 100,
      invested: inv, benchMedianEnd: pctile(soBench, 50),
    };
  }, [norm, capital, mode, monthlySip, realReturns, vol, engine]);

  const pNeg = (norm[0] + norm[1]) * 100;
  const pBoom = norm[5] * 100;
  const e2026 = expected[0];
  const histNegPct = (STATS.negCount / STATS.n) * 100;

  // handlers
  const setProb = useCallback((idx: number, val: number) => {
    setProbs(prev => { const n = prev.slice(); n[idx] = clamp(Math.round(val), 0, 90); return n; });
  }, []);
  const applyPreset = useCallback((p: number[]) => setProbs(p.slice()), []);
  const normalise = useCallback(() => setProbs(prev => {
    const t = prev.reduce((a, b) => a + b, 0);
    return t === 0 ? prev : prev.map(p => Math.round((p / t) * 100));
  }), []);
  const save = useCallback(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ probs, capital, mode, monthlySip, realReturns, vol, engine })); setSavedFlash('✓ Saved to this browser'); setTimeout(() => setSavedFlash(''), 2200); }
    catch { setSavedFlash('⚠ Could not save'); }
  }, [probs, capital, mode, monthlySip, realReturns, vol, engine]);
  const copyLink = useCallback(() => {
    try {
      const qs = new URLSearchParams();
      qs.set('p', probs.join(',')); qs.set('cap', String(capital));
      if (mode === 'sip') { qs.set('mode', 'sip'); qs.set('sip', String(monthlySip)); }
      if (realReturns) qs.set('real', '1'); qs.set('vol', String(vol)); qs.set('eng', engine);
      navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?${qs.toString()}`);
      setSavedFlash('🔗 Shareable link copied'); setTimeout(() => setSavedFlash(''), 2200);
    } catch { setSavedFlash('⚠ Could not copy'); }
  }, [probs, capital, mode, monthlySip, realReturns, vol, engine]);

  // chart geometry
  const chart = useMemo(() => {
    const W = 780, H = 340, padL = 4, padR = 8, padTop = 10, padBot = 30;
    const plotH = H - padTop - padBot;
    const allVals = [...HIST_BARS.map(b => b.ret), ...mc.band.map(b => b.p90), ...mc.band.map(b => b.p10), ...expected];
    const maxAbs = Math.max(70, ...allVals.map(v => Math.abs(v)));
    const zeroY = padTop + plotH / 2;
    const scale = (plotH / 2) / maxAbs;
    const yOf = (v: number) => zeroY - v * scale;
    const cols = HIST_BARS.length + FORECAST_YEARS.length;
    const colW = (W - padL - padR) / cols;
    const xOf = (i: number) => padL + colW * (i + 0.5);
    return { W, H, padL, padR, padTop, padBot, zeroY, scale, yOf, colW, xOf, maxAbs };
  }, [mc, expected]);
  const forecastX = (fi: number) => chart.xOf(HIST_BARS.length + fi);
  const fanPoly = [...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p90).toFixed(1)}`),
    ...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p10).toFixed(1)}`).reverse()].join(' ');
  const fanInner = [...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p75).toFixed(1)}`),
    ...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p25).toFixed(1)}`).reverse()].join(' ');
  const expLine = expected.map((r, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(r).toFixed(1)}`).join(' ');
  const benchLine = mc.benchBand.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p50).toFixed(1)}`).join(' ');

  // styles
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 };
  const cardLabel: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12, fontWeight: 700 };
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' };
  const chip = (active: boolean, color: string): React.CSSProperties => ({
    fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
    background: active ? `${color}22` : `${color}10`, color, border: `1px solid ${color}${active ? '77' : '33'}`, ...mono,
  });

  const maxHistBucket = Math.max(...BUCKETS.map(b => b.count));

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20, padding: '16px 20px', background: `linear-gradient(135deg, ${C.cyan}18 0%, ${C.panel} 100%)`, border: `1px solid ${C.cyan}33`, borderRadius: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', margin: 0 }}>QQQ · Nasdaq-100 — Scenario Simulator</h1>
            <div style={{ ...mono, fontSize: 12, color: C.text3, marginTop: 5 }}>
              Calibrated from 40 real years (1986–2025). Set 2026 odds → cascading 2027–2030 with a Monte-Carlo outcome range.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="/historical-returns?m=usa" style={chip(false, C.blue)}>📈 40Y history</a>
            <button onClick={save} style={chip(false, C.green)}>💾 Save</button>
            <button onClick={copyLink} style={chip(false, C.cyan)}>🔗 Share</button>
          </div>
        </div>
        {savedFlash && <div style={{ ...mono, fontSize: 12, color: C.green, marginBottom: 12, marginTop: -8 }}>{savedFlash}</div>}

        {/* Historical context (computed) */}
        <div style={card}>
          <div style={cardLabel}>Nasdaq-100 — 40 years of reality (1986–2025)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
            {[
              { label: '40Y CAGR', value: `+${STATS.cagr.toFixed(1)}%`, color: C.green },
              { label: 'Avg year', value: `+${STATS.avg.toFixed(1)}%`, color: C.green },
              { label: 'Best year', value: `+${STATS.best.ret.toFixed(0)}% (${STATS.best.year})`, color: C.green },
              { label: 'Worst year', value: `${STATS.worst.ret.toFixed(0)}% (${STATS.worst.year})`, color: C.red },
              { label: 'Positive years', value: `${STATS.posPct.toFixed(0)}%`, color: C.green },
              { label: 'Std deviation', value: `${STATS.stdev.toFixed(0)}%`, color: C.amber },
              { label: 'Max year-end DD', value: `−${STATS.maxDrawdown.toFixed(0)}%`, color: C.red },
              { label: 'Longest win streak', value: `${STATS.longestUp} yrs`, color: C.cyan },
            ].map(t => (
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9.5, color: C.text3, marginBottom: 3 }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 15, fontWeight: 800, color: t.color }}>{t.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6 }}>
            The Nasdaq-100 is a two-regime beast: it compounded at{' '}
            <span style={{ color: C.green, fontWeight: 700 }}>~{STATS.cagr.toFixed(0)}%</span> for four decades, yet lived through the
            2000–2002 dot-com bust (−36.8% / −32.7% / −37.6% back-to-back-to-back), a −41.9% 2008, and a −33.0% 2022.
            The recoveries were violent — +49% in 2003, +53% in 2009, +54% in 2023. Every scenario below is weighted by how often it
            actually happened, and the cascade replays what genuinely followed.
          </div>
        </div>

        {/* Empirical histogram of scenarios */}
        <div style={card}>
          <div style={cardLabel}>How often each scenario actually happened (1986–2025)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {BUCKETS.map((b, i) => (
              <div key={b.id} style={{ background: C.panel2, border: `1px solid ${b.color}22`, borderRadius: 10, padding: '10px 11px' }}>
                <div style={{ color: b.color, fontWeight: 700, fontSize: 12.5 }}>{b.label}</div>
                <div style={{ ...mono, fontSize: 9.5, color: C.text3, marginBottom: 6 }}>{b.range} · avg {b.midpoint >= 0 ? '+' : ''}{b.midpoint.toFixed(0)}%</div>
                <div style={{ height: 8, background: C.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 5 }}>
                  <div style={{ width: `${(b.count / maxHistBucket) * 100}%`, height: '100%', background: b.color, borderRadius: 4, transition: 'width .3s' }} />
                </div>
                <div style={{ ...mono, fontSize: 11, color: C.text2 }}>
                  <span style={{ color: b.color, fontWeight: 700 }}>{b.count} yrs</span> · {b.freq.toFixed(0)}% of history
                </div>
                <div style={{ ...mono, fontSize: 9, color: C.text4, marginTop: 4, lineHeight: 1.5 }}>{b.years.join(' · ') || '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Step 1 sliders */}
        <div style={card}>
          <div style={cardLabel}>Step 1 — set your 2026 scenario probabilities</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {PRESETS.map(p => <button key={p.id} onClick={() => applyPreset(p.probs)} style={chip(false, C.purple)}>{p.label}</button>)}
            <button onClick={normalise} style={chip(false, C.gold)}>↺ Normalise to 100%</button>
          </div>
          <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 12 }}>
            Defaults are the <strong style={{ color: C.text2 }}>real historical frequencies</strong> — your starting point is what the Nasdaq-100 actually did, not a guess.
          </div>
          {BUCKETS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < BUCKETS.length - 1 ? `1px solid ${C.border}` : 'none', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 150 }}>
                <span style={{ color: s.color, fontWeight: 700, fontSize: 13 }}>{s.label}</span>
                <div style={{ fontSize: 10, color: C.text3 }}>{s.range}</div>
              </div>
              <div style={{ minWidth: 64, textAlign: 'center' }}>
                <span style={{ ...mono, fontSize: 10, padding: '2px 7px', borderRadius: 5, background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}30` }}>hist: {s.freq.toFixed(0)}%</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
                <input type="range" min={0} max={80} value={probs[i]} onChange={e => setProb(i, parseInt(e.target.value, 10))} style={{ flex: 1, accentColor: s.color, cursor: 'pointer' }} />
                <div style={{ ...mono, minWidth: 44, textAlign: 'right', color: s.color, fontWeight: 700, fontSize: 14 }}>{probs[i]}%</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 12, ...mono, fontSize: 13, fontWeight: 700, color: total === 100 ? C.green : total > 100 ? C.red : C.amber }}>
            Total: {total}% {total === 100 ? '✓' : total < 100 ? `(need ${100 - total}% more)` : `(${total - 100}% over)`}
            {total !== 100 && <span style={{ color: C.text3, fontWeight: 400 }}> — auto-normalised for the maths below</span>}
          </div>
        </div>

        {/* Settings */}
        <div style={card}>
          <div style={cardLabel}>Investment settings</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 11.5, color: C.text3 }}>
              {mode === 'sip' ? 'Initial lumpsum ($)' : 'Amount invested ($)'}
              <input type="number" min={100} step={1000} value={capital} onChange={e => setCapital(clamp(parseInt(e.target.value, 10) || 0, 0, 1e11))}
                style={{ display: 'block', marginTop: 4, width: 140, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '7px 10px', ...mono, fontSize: 13 }} />
            </label>
            <div>
              <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 4 }}>Mode</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setMode('lumpsum')} style={chip(mode === 'lumpsum', C.cyan)}>Lumpsum</button>
                <button onClick={() => setMode('sip')} style={chip(mode === 'sip', C.cyan)}>Monthly DCA</button>
              </div>
            </div>
            {mode === 'sip' && (
              <label style={{ fontSize: 11.5, color: C.text3 }}>
                Monthly ($)
                <input type="number" min={10} step={100} value={monthlySip} onChange={e => setMonthlySip(clamp(parseInt(e.target.value, 10) || 0, 0, 1e9))}
                  style={{ display: 'block', marginTop: 4, width: 110, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '7px 10px', ...mono, fontSize: 13 }} />
              </label>
            )}
            <div>
              <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 4 }}>MC engine</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEngine('bootstrap')} style={chip(engine === 'bootstrap', C.purple)}>Historical bootstrap</button>
                <button onClick={() => setEngine('parametric')} style={chip(engine === 'parametric', C.purple)}>Parametric</button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 4 }}>Returns</div>
              <button onClick={() => setRealReturns(v => !v)} style={chip(realReturns, C.amber)}>{realReturns ? `Real (−${US_INFLATION}%)` : 'Nominal'}</button>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 4 }}>Benchmark</div>
              <button onClick={() => setShowBench(v => !v)} style={chip(showBench, C.blue)}>{showBench ? '✓ S&P 500 overlay' : 'S&P 500 overlay'}</button>
            </div>
            {engine === 'parametric' && (
              <label style={{ fontSize: 11.5, color: C.text3 }}>
                Annual volatility: <span style={{ ...mono, color: C.text2 }}>{vol}%</span>
                <input type="range" min={15} max={40} value={vol} onChange={e => setVol(parseInt(e.target.value, 10))} style={{ display: 'block', marginTop: 6, width: 140, accentColor: C.purple, cursor: 'pointer' }} />
              </label>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: C.text4, marginTop: 10, lineHeight: 1.5 }}>
            {engine === 'bootstrap'
              ? `Historical bootstrap: each of the ${N_SIMS.toLocaleString('en-US')} paths samples a 2026 scenario from your weights, then replays a REAL 5-year window from Nasdaq-100 history — preserving actual sequencing (crashes cluster, recoveries snap back). This captures fat tails a normal curve can't.`
              : `Parametric: ${N_SIMS.toLocaleString('en-US')} paths sample your weights and add ${vol}% Gaussian volatility per year around the historical cascade.`}
          </div>
        </div>

        {/* Step 2 — year cards + chart */}
        <div style={card}>
          <div style={cardLabel}>Step 2 — probability-weighted 2026 &amp; cascading 2027–2030</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 18 }}>
            {FORECAST_YEARS.map((yr, i) => {
              const ret = expected[i]; const isPos = ret >= 0; const color = isPos ? C.green : C.red;
              return (
                <div key={yr} style={{ background: isPos ? `${C.green}10` : `${C.red}10`, border: `1px solid ${isPos ? C.green : C.red}28`, borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ ...mono, fontSize: 13, color: yr === 2026 ? C.amber : color, fontWeight: 700 }}>{yr}</div>
                  <div style={{ ...mono, fontSize: 22, fontWeight: 800, color }}>{isPos ? '+' : ''}{ret.toFixed(1)}%</div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.text3 }}>{yr === 2026 ? 'Weighted Avg' : 'Conditional'}</div>
                  <div style={{ ...mono, fontSize: 9, color: C.text4, marginTop: 3 }}>P10 {mc.band[i].p10.toFixed(0)}% · P90 {mc.band[i].p90.toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
          <div style={{ ...mono, fontSize: 10, color: C.text3, marginBottom: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span><span style={{ color: C.gold }}>━</span> expected return</span>
            <span><span style={{ color: C.purple }}>▒</span> Monte-Carlo P10–P90</span>
            <span><span style={{ color: C.purple }}>▓</span> P25–P75</span>
            {showBench && <span><span style={{ color: C.blue }}>┈</span> S&P 500 median</span>}
            <span style={{ color: C.text4 }}>| bars = actual 2023–2025</span>
          </div>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
            {[-60, -40, -20, 20, 40, 60].filter(v => Math.abs(v) <= chart.maxAbs).map(v => (
              <g key={v}>
                <line x1={chart.padL} y1={chart.yOf(v)} x2={chart.W - chart.padR} y2={chart.yOf(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="2 4" />
                <text x={chart.W - chart.padR} y={chart.yOf(v) - 2} fill={C.text4} fontSize={8} textAnchor="end" style={mono}>{v > 0 ? '+' : ''}{v}%</text>
              </g>
            ))}
            <line x1={chart.padL} y1={chart.zeroY} x2={chart.W - chart.padR} y2={chart.zeroY} stroke={C.text3} strokeWidth={1} />
            <line x1={chart.xOf(HIST_BARS.length) - chart.colW / 2} y1={chart.padTop} x2={chart.xOf(HIST_BARS.length) - chart.colW / 2} y2={chart.H - chart.padBot} stroke={`${C.amber}55`} strokeWidth={1} strokeDasharray="4 4" />
            <text x={chart.xOf(HIST_BARS.length) - chart.colW / 2 + 4} y={chart.padTop + 9} fill={C.amber} fontSize={8.5} style={mono}>forecast →</text>
            <polygon points={fanPoly} fill={`${C.purple}1f`} />
            <polygon points={fanInner} fill={`${C.purple}30`} />
            {HIST_BARS.map((b) => {
              const isPos = b.ret >= 0; const x = chart.xOf(HIST_BARS.indexOf(b)); const barW = Math.min(30, chart.colW * 0.5);
              const y0 = chart.zeroY, y1 = chart.yOf(b.ret); const top = Math.min(y0, y1), h = Math.abs(y1 - y0); const col = isPos ? C.green : C.red;
              return (
                <g key={b.yr}>
                  <rect x={x - barW / 2} y={top} width={barW} height={h} rx={2} fill={`${col}88`} />
                  <text x={x} y={isPos ? top - 4 : top + h + 10} fill={col} fontSize={9} textAnchor="middle" style={mono}>{isPos ? '+' : ''}{b.ret.toFixed(0)}%</text>
                  <text x={x} y={chart.H - chart.padBot + 14} fill={C.text3} fontSize={9} textAnchor="middle" style={mono}>{b.yr}</text>
                </g>
              );
            })}
            {showBench && <polyline points={benchLine} fill="none" stroke={C.blue} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85} />}
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
          <div style={cardLabel}>{usd(capital)}{mode === 'sip' ? ` + ${usd(monthlySip)}/mo DCA` : ''} invested Dec 2025 → projected growth</div>
          {wealthPath.map((v, i) => {
            const maxVal = Math.max(...wealthPath.map(p => p.val)); const pct = (v.val / maxVal) * 100;
            const up = v.val >= invested; const col = up ? C.green : C.red;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ ...mono, fontSize: 11, color: C.text3, minWidth: 68 }}>{v.yr}</div>
                <div style={{ flex: 1, background: C.panel2, borderRadius: 6, height: 24, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: `${col}25`, border: `1px solid ${col}45`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, minWidth: 90, transition: 'width .3s' }}>
                    <span style={{ ...mono, fontSize: 11, color: col, fontWeight: 700 }}>{usdFull(v.val)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ ...mono, fontSize: 12.5, marginTop: 12, marginBottom: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <span style={{ color: C.cyan, fontWeight: 700 }}>5Y CAGR (expected): {detCagr.toFixed(1)}%</span>
            <span style={{ color: C.text3 }}> · Total return: {detTotalRet >= 0 ? '+' : ''}{detTotalRet.toFixed(0)}%</span>
            <span style={{ color: C.text3 }}> · {usd(invested)} → {usd(finalDet)}</span>
          </div>
          <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 10, ...mono }}>
            Monte-Carlo outcome range · {N_SIMS.toLocaleString('en-US')} {engine} paths
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'P10 · unlucky', val: usd(mc.ending.p10), color: C.red },
              { label: 'P25', val: usd(mc.ending.p25), color: C.amber },
              { label: 'P50 · median', val: usd(mc.ending.p50), color: C.text },
              { label: 'P75', val: usd(mc.ending.p75), color: C.green },
              { label: 'P90 · lucky', val: usd(mc.ending.p90), color: C.green },
            ].map(t => (
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.text3, marginBottom: 3, ...mono }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 14, fontWeight: 800, color: t.color }}>{t.val}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            {[
              { label: 'P(loses money)', val: `${mc.pLoss.toFixed(0)}%`, color: mc.pLoss > 25 ? C.red : C.amber },
              { label: 'P(doubles+)', val: `${mc.pDouble.toFixed(0)}%`, color: C.green },
              { label: 'P(triples+)', val: `${mc.pTriple.toFixed(0)}%`, color: C.green },
              { label: 'P(halves)', val: `${mc.pHalf.toFixed(0)}%`, color: mc.pHalf > 10 ? C.red : C.text2 },
              { label: 'CAGR P10 → P90', val: `${mc.cagr.p10.toFixed(0)}% → ${mc.cagr.p90.toFixed(0)}%`, color: C.cyan },
              ...(showBench ? [{ label: 'S&P 500 median end', val: usd(mc.benchMedianEnd), color: C.blue }] : []),
            ].map(t => (
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: C.text3, marginBottom: 3, ...mono }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 13.5, fontWeight: 800, color: t.color }}>{t.val}</div>
              </div>
            ))}
          </div>
          {showBench && (
            <div style={{ fontSize: 11, color: C.text3, marginTop: 10, lineHeight: 1.5 }}>
              QQQ median {usd(mc.ending.p50)} vs S&P 500 median {usd(mc.benchMedianEnd)} —
              {mc.ending.p50 > mc.benchMedianEnd
                ? ` the extra ${usd(mc.ending.p50 - mc.benchMedianEnd)} is your reward for concentrated Nasdaq risk. The P10 (${usd(mc.ending.p10)}) is what a bad tech cycle costs you.`
                : ` the S&P median is higher — your bearish tech weights don't justify the extra concentration.`}
            </div>
          )}
        </div>

        {/* Insights */}
        <div style={card}>
          <div style={cardLabel}>Dynamic insights based on your assumptions</div>
          <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ ...mono, fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Your implied odds vs 40-year reality</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, fontSize: 12.5, color: C.text2 }}>
              <div>P(2026 down year): <strong style={{ color: pNeg > histNegPct + 10 ? C.red : C.amber }}>{pNeg.toFixed(0)}%</strong> <span style={{ color: C.text4 }}>vs {histNegPct.toFixed(0)}% historically</span></div>
              <div>P(2026 boom +40%): <strong style={{ color: C.green }}>{pBoom.toFixed(0)}%</strong> <span style={{ color: C.text4 }}>vs {BUCKETS[5].freq.toFixed(0)}% historically</span></div>
              <div>E[2026 return]: <strong style={{ color: e2026 >= 0 ? C.green : C.red }}>{e2026 >= 0 ? '+' : ''}{e2026.toFixed(1)}%</strong> <span style={{ color: C.text4 }}>vs +{STATS.avg.toFixed(0)}% avg</span></div>
              <div>Your 5Y CAGR: <strong style={{ color: C.cyan }}>{detCagr.toFixed(1)}%</strong> <span style={{ color: C.text4 }}>vs +{STATS.cagr.toFixed(0)}% actual</span></div>
            </div>
          </div>
          {pNeg > histNegPct + 12 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: `${C.red}0e`, border: `1px solid ${C.red}22`, borderRadius: 8, fontSize: 11.5, color: C.text2, lineHeight: 1.55 }}>
              <strong style={{ color: C.red }}>Bearish vs history:</strong> you're pricing {pNeg.toFixed(0)}% odds of a down 2026, well above the {histNegPct.toFixed(0)}% the Nasdaq-100 posted across 40 years. Down years were rare but brutal (−33% to −42%) — and every one was followed by a snap-back averaging +50%+, which your cascade reflects.
            </div>
          )}
          {pBoom > 35 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: `${C.green}0e`, border: `1px solid ${C.green}22`, borderRadius: 8, fontSize: 11.5, color: C.text2, lineHeight: 1.55 }}>
              <strong style={{ color: C.green }}>Aggressive bull:</strong> {pBoom.toFixed(0)}% odds on a +40% boom is {(pBoom / Math.max(BUCKETS[5].freq, 1)).toFixed(1)}× the historical base rate ({BUCKETS[5].freq.toFixed(0)}%). Booms did happen — 1998, 1999, 2023 — but back-to-back booms are rare; the cascade pulls 2027+ toward mean reversion.
            </div>
          )}
          <div style={{ marginTop: 12, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ ...mono, fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>How the cascade works (data-driven)</div>
            <div style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.6 }}>
              2027–2030 aren't guesses — for each 2026 bucket, they're the <strong>actual average of what followed</strong> similar years in Nasdaq-100 history:
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 5, marginTop: 10, ...mono, fontSize: 10.5 }}>
                {BUCKETS.map(b => (
                  <div key={b.id} style={{ color: b.color }}>
                    If {b.label.toLowerCase()} → {PATHS[b.id].map(v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`).join(', ')}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                Your weights blend these into the expected line; the {engine === 'bootstrap' ? 'historical-bootstrap band' : 'parametric band'} shows the real spread of outcomes. Expected 5Y CAGR of{' '}
                <strong style={{ color: C.cyan }}>{detCagr.toFixed(1)}%</strong>{' '}
                {Math.abs(detCagr - STATS.cagr) < 4 ? `sits near the 40-year actual (~${STATS.cagr.toFixed(0)}%) — balanced.` : detCagr > STATS.cagr ? 'is above the 40-year actual — you may be overweighting booms.' : 'is below the 40-year actual — you may be overweighting drawdowns.'}
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ background: `${C.amber}0c`, border: `1px solid ${C.amber}28`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.6 }}>
            <strong style={{ color: C.amber }}>⚠ Important.</strong> Projections extrapolate from 40 years of Nasdaq-100 history (1986–2025). The index is heavily concentrated in mega-cap tech; future regimes (rates, AI capex, concentration risk) may not rhyme with the past. Annual std deviation is ~{STATS.stdev.toFixed(0)}% — any single year can deviate hugely. This is an analytical exercise, <strong>not investment advice</strong>.
          </div>
        </div>
        <div style={{ ...mono, fontSize: 10.5, color: C.text4, textAlign: 'center', paddingBottom: 20 }}>
          Source: Nasdaq-100 calendar-year returns 1986–2025 (slickcharts / 1stock1) · Market Cockpit data-driven Monte-Carlo · educational only
        </div>
      </div>
    </div>
  );
}
