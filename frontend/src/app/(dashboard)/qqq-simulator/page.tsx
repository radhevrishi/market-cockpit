'use client';

// zzz404/zzz405 — QQQ (Nasdaq-100) Scenario Simulator.
//
// Calibrated end-to-end from the REAL 40-year Nasdaq-100 record (1986–2025):
// scenario buckets, default probabilities and the 2027–2030 cascade are all
// data-derived. Two Monte-Carlo engines (parametric + historical block-
// bootstrap), an S&P 500 benchmark, and an empirical histogram.
//
// zzz405 fixes (over-optimism + UX):
//   • Small-sample shrinkage (priorK) on the cascade — a bucket with one
//     member (e.g. "bad year" = only 1990) no longer lets one lucky
//     follow-year dominate the projection.
//   • Single-anchor buckets fall back to parametric in bootstrap (no
//     degenerate identical-window replay).
//   • Forward-return haircut control + reality-check banner (the model is
//     calibrated on the best index in history, so it is structurally rosy).
//   • Nominal AND real return shown on every year card.
//   • Not live: edit freely, then click Refresh to recompute.
//   • Wider layout, larger type.

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

const DEFS: BucketDef[] = [
  { id: 'crash',  label: 'Crash',       range: '< −20%',       min: -100, max: -20, color: '#ff2040' },
  { id: 'bad',    label: 'Bad Year',    range: '−20% to −5%',  min: -20,  max: -5,  color: '#ff6b4a' },
  { id: 'flat',   label: 'Flat / Mild', range: '−5% to +10%',  min: -5,   max: 10,  color: '#f0a500' },
  { id: 'modest', label: 'Modest',      range: '+10% to +20%', min: 10,   max: 20,  color: '#6c9a8b' },
  { id: 'good',   label: 'Good Year',   range: '+20% to +40%', min: 20,   max: 40,  color: '#00d4aa' },
  { id: 'boom',   label: 'Boom',        range: '+40%+',        min: 40,   max: 1000, color: '#00ffcc' },
];
const BUCKETS: Bucket[] = bucketize(NASDAQ100, DEFS);
const DEFAULT_PROBS = freqProbs(BUCKETS);
const PATHS = conditionalPaths(NASDAQ100, BUCKETS, 4, 4); // priorK=4 shrinkage
const STATS = computeStats(NASDAQ100);
const NDX_BY_YEAR = new Map(NASDAQ100.map(s => [s.year, s.ret]));
const NDX_RETS = NASDAQ100.map(s => s.ret);
const HIST_BARS = NASDAQ100.slice(-3).map(s => ({ yr: s.year, ret: s.ret }));
const FORECAST_YEARS = [2026, 2027, 2028, 2029, 2030];

const PRESETS: { id: string; label: string; probs: number[] }[] = [
  { id: 'hist',   label: '📊 Historical frequency', probs: DEFAULT_PROBS },
  { id: 'ai',     label: '🚀 AI supercycle',        probs: [3, 4, 8, 15, 30, 40] },
  { id: 'base',   label: '⚖ Balanced',              probs: [8, 7, 20, 20, 25, 20] },
  { id: 'recess', label: '🐻 Recession',            probs: [22, 18, 25, 15, 12, 8] },
];

const LS_KEY = 'mc:qqq-sim:v1';
const N_SIMS = 4000;
const BENCH_MEAN = 10.5, BENCH_VOL = 15.5;
const US_INFLATION = 3.0;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gaussian(rng: () => number): number { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }
function pctile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function usd(n: number): string { if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; return '$' + Math.round(n).toLocaleString('en-US'); }
function usdFull(n: number): string { return '$' + Math.round(n).toLocaleString('en-US'); }

interface Committed { probs: number[]; capital: number; mode: 'lumpsum' | 'sip'; monthlySip: number; realReturns: boolean; vol: number; engine: 'parametric' | 'bootstrap'; haircut: number; }
const DEFAULTS: Committed = { probs: DEFAULT_PROBS, capital: 10000, mode: 'lumpsum', monthlySip: 500, realReturns: false, vol: 28, engine: 'bootstrap', haircut: 0 };

interface MCResult {
  band: { p10: number; p25: number; p50: number; p75: number; p90: number }[];
  benchBand: { p50: number }[];
  ending: { p10: number; p25: number; p50: number; p75: number; p90: number };
  cagr: { p10: number; p50: number; p90: number };
  pLoss: number; pDouble: number; pTriple: number; pHalf: number; invested: number; benchMedianEnd: number;
}

export default function QqqSimulatorPage() {
  // live inputs (edited freely; do NOT drive compute until Refresh)
  const [probs, setProbs] = useState<number[]>(DEFAULT_PROBS);
  const [capital, setCapital] = useState<number>(10000);
  const [mode, setMode] = useState<'lumpsum' | 'sip'>('lumpsum');
  const [monthlySip, setMonthlySip] = useState<number>(500);
  const [realReturns, setRealReturns] = useState<boolean>(false);
  const [showBench, setShowBench] = useState<boolean>(true); // display-only, live
  const [vol, setVol] = useState<number>(28);
  const [engine, setEngine] = useState<'parametric' | 'bootstrap'>('bootstrap');
  const [haircut, setHaircut] = useState<number>(0);
  const [savedFlash, setSavedFlash] = useState<string>('');
  const [committed, setCommitted] = useState<Committed>(DEFAULTS);

  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      let snap: Committed = { ...DEFAULTS };
      const pRaw = qs.get('p');
      const raw = localStorage.getItem(LS_KEY);
      if (pRaw) {
        const arr = pRaw.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        if (arr.length === 6) snap.probs = arr;
        if (qs.get('cap')) snap.capital = clamp(parseInt(qs.get('cap')!, 10) || 10000, 100, 1e11);
        if (qs.get('mode') === 'sip') snap.mode = 'sip';
        if (qs.get('sip')) snap.monthlySip = clamp(parseInt(qs.get('sip')!, 10) || 500, 10, 1e9);
        if (qs.get('real') === '1') snap.realReturns = true;
        if (qs.get('vol')) snap.vol = clamp(parseInt(qs.get('vol')!, 10) || 28, 12, 45);
        if (qs.get('eng') === 'parametric') snap.engine = 'parametric';
        if (qs.get('hc')) snap.haircut = clamp(parseInt(qs.get('hc')!, 10) || 0, 0, 12);
      } else if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.probs) && s.probs.length === 6) snap.probs = s.probs;
        if (typeof s.capital === 'number') snap.capital = s.capital;
        if (s.mode === 'sip') snap.mode = 'sip';
        if (typeof s.monthlySip === 'number') snap.monthlySip = s.monthlySip;
        if (typeof s.realReturns === 'boolean') snap.realReturns = s.realReturns;
        if (typeof s.vol === 'number') snap.vol = s.vol;
        if (s.engine === 'parametric') snap.engine = 'parametric';
        if (typeof s.haircut === 'number') snap.haircut = s.haircut;
      } else return;
      setProbs(snap.probs); setCapital(snap.capital); setMode(snap.mode); setMonthlySip(snap.monthlySip);
      setRealReturns(snap.realReturns); setVol(snap.vol); setEngine(snap.engine); setHaircut(snap.haircut);
      setCommitted(snap);
    } catch { /* ignore */ }
  }, []);

  const liveTotal = probs.reduce((a, b) => a + b, 0);
  const live: Committed = { probs, capital, mode, monthlySip, realReturns, vol, engine, haircut };
  const stale = JSON.stringify(live) !== JSON.stringify(committed);
  const run = useCallback(() => setCommitted({ probs: probs.slice(), capital, mode, monthlySip, realReturns, vol, engine, haircut }), [probs, capital, mode, monthlySip, realReturns, vol, engine, haircut]);

  // ── everything below computes from COMMITTED, not live ──
  const cTotal = committed.probs.reduce((a, b) => a + b, 0);
  const norm = useMemo(() => (cTotal > 0 ? committed.probs.map(p => p / cTotal) : committed.probs.map(() => 0)), [committed, cTotal]);

  const { expNom, expReal, expected } = useMemo(() => {
    const e2026 = BUCKETS.reduce((acc, b, i) => acc + norm[i] * b.midpoint, 0);
    const eY = (k: number) => BUCKETS.reduce((acc, b, i) => acc + norm[i] * PATHS[b.id][k], 0);
    const nom = [e2026, eY(0), eY(1), eY(2), eY(3)].map(r => r - committed.haircut);
    const real = nom.map(r => r - US_INFLATION);
    return { expNom: nom, expReal: real, expected: committed.realReturns ? real : nom };
  }, [norm, committed]);

  const wealthPath = useMemo(() => {
    const annual = committed.monthlySip * 12; let w = committed.capital;
    const pts: { yr: string; val: number }[] = [{ yr: 'Dec 2025', val: w }];
    FORECAST_YEARS.forEach((yr, i) => {
      const g = 1 + expected[i] / 100;
      if (committed.mode === 'sip') w = w * g + annual * (1 + expected[i] / 200); else w = w * g;
      pts.push({ yr: `Dec ${yr}`, val: w });
    });
    return pts;
  }, [expected, committed]);

  const invested = committed.mode === 'sip' ? committed.capital + committed.monthlySip * 12 * 5 : committed.capital;
  const finalDet = wealthPath[wealthPath.length - 1].val;
  const detCagr = (Math.pow(finalDet / Math.max(invested, 1), 1 / 5) - 1) * 100;
  const detTotalRet = (finalDet / Math.max(invested, 1) - 1) * 100;

  const mc = useMemo<MCResult>(() => {
    const rng = mulberry32(20260817);
    const cum: number[] = []; let run2 = 0;
    for (let i = 0; i < norm.length; i++) { run2 += norm[i]; cum.push(run2); }
    const annual = committed.monthlySip * 12;
    const yearRet: number[][] = [[], [], [], [], []]; const benchRet: number[][] = [[], [], [], [], []];
    const endW: number[] = []; const endWBench: number[] = [];

    for (let s = 0; s < N_SIMS; s++) {
      const r = rng(); let si = cum.findIndex(c => r <= c); if (si < 0) si = BUCKETS.length - 1;
      const b = BUCKETS[si]; const seq: number[] = [];
      if (committed.engine === 'bootstrap' && b.years.length >= 2) {
        const anchor = b.years[Math.floor(rng() * b.years.length)];
        seq.push(NDX_BY_YEAR.get(anchor)!);
        for (let h = 1; h <= 4; h++) { const rr = NDX_BY_YEAR.get(anchor + h); seq.push(rr !== undefined ? rr : NDX_RETS[Math.floor(rng() * NDX_RETS.length)]); }
      } else {
        const sig = Math.max(4, (b.band[1] - b.band[0]) / 4);
        seq.push(clamp(b.midpoint + gaussian(rng) * sig, b.band[0], b.band[1]));
        const path = PATHS[b.id];
        for (let h = 0; h < 4; h++) seq.push(clamp(path[h] + gaussian(rng) * committed.vol, -60, 130));
      }
      const bseq: number[] = [];
      for (let y = 0; y < 5; y++) bseq.push(clamp(BENCH_MEAN + gaussian(rng) * BENCH_VOL, -45, 60));

      let w = committed.capital, wb = committed.capital;
      for (let y = 0; y < 5; y++) {
        const nomRet = seq[y] - committed.haircut;        // nominal (for chart bands)
        yearRet[y].push(nomRet); benchRet[y].push(bseq[y]);
        const rS = committed.realReturns ? nomRet - US_INFLATION : nomRet;   // wealth honours toggle
        const rB = committed.realReturns ? bseq[y] - US_INFLATION : bseq[y];
        const gS = 1 + rS / 100, gB = 1 + rB / 100;
        if (committed.mode === 'sip') { w = w * gS + annual * (1 + rS / 200); wb = wb * gB + annual * (1 + rB / 200); }
        else { w = w * gS; wb = wb * gB; }
      }
      endW.push(w); endWBench.push(wb);
    }
    const band = yearRet.map(a => { const so = a.slice().sort((x, y) => x - y); return { p10: pctile(so, 10), p25: pctile(so, 25), p50: pctile(so, 50), p75: pctile(so, 75), p90: pctile(so, 90) }; });
    const benchBand = benchRet.map(a => ({ p50: pctile(a.slice().sort((x, y) => x - y), 50) }));
    const soEnd = endW.slice().sort((x, y) => x - y); const soBench = endWBench.slice().sort((x, y) => x - y);
    const inv = committed.mode === 'sip' ? committed.capital + annual * 5 : committed.capital;
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
  }, [norm, committed]);

  const pNeg = (norm[0] + norm[1]) * 100;
  const pBoom = norm[5] * 100;
  const histNegPct = (STATS.negCount / STATS.n) * 100;

  // handlers
  const setProb = useCallback((idx: number, val: number) => setProbs(prev => { const n = prev.slice(); n[idx] = clamp(Math.round(val), 0, 90); return n; }), []);
  const applyPreset = useCallback((p: number[]) => setProbs(p.slice()), []);
  const normalise = useCallback(() => setProbs(prev => { const t = prev.reduce((a, b) => a + b, 0); return t === 0 ? prev : prev.map(p => Math.round((p / t) * 100)); }), []);
  const save = useCallback(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(committed)); setSavedFlash('✓ Saved'); setTimeout(() => setSavedFlash(''), 2000); } catch { setSavedFlash('⚠ Could not save'); } }, [committed]);
  const copyLink = useCallback(() => {
    try {
      const qs = new URLSearchParams();
      qs.set('p', probs.join(',')); qs.set('cap', String(capital));
      if (mode === 'sip') { qs.set('mode', 'sip'); qs.set('sip', String(monthlySip)); }
      if (realReturns) qs.set('real', '1'); qs.set('vol', String(vol)); qs.set('eng', engine); if (haircut) qs.set('hc', String(haircut));
      navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?${qs.toString()}`);
      setSavedFlash('🔗 Link copied'); setTimeout(() => setSavedFlash(''), 2000);
    } catch { setSavedFlash('⚠ Could not copy'); }
  }, [probs, capital, mode, monthlySip, realReturns, vol, engine, haircut]);

  // chart geometry (nominal expected line + nominal bands)
  const chart = useMemo(() => {
    const W = 980, H = 360, padL = 4, padR = 8, padTop = 12, padBot = 30;
    const plotH = H - padTop - padBot;
    const allVals = [...HIST_BARS.map(b => b.ret), ...mc.band.map(b => b.p90), ...mc.band.map(b => b.p10), ...expNom];
    const maxAbs = Math.max(70, ...allVals.map(v => Math.abs(v)));
    const zeroY = padTop + plotH / 2; const scale = (plotH / 2) / maxAbs;
    const yOf = (v: number) => zeroY - v * scale;
    const cols = HIST_BARS.length + FORECAST_YEARS.length; const colW = (W - padL - padR) / cols;
    const xOf = (i: number) => padL + colW * (i + 0.5);
    return { W, H, padL, padR, padTop, padBot, zeroY, scale, yOf, colW, xOf, maxAbs };
  }, [mc, expNom]);
  const forecastX = (fi: number) => chart.xOf(HIST_BARS.length + fi);
  const fanPoly = [...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p90).toFixed(1)}`), ...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p10).toFixed(1)}`).reverse()].join(' ');
  const fanInner = [...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p75).toFixed(1)}`), ...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p25).toFixed(1)}`).reverse()].join(' ');
  const expLine = expNom.map((r, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(r).toFixed(1)}`).join(' ');
  const benchLine = mc.benchBand.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p50).toFixed(1)}`).join(' ');

  // styles
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16 };
  const cardLabel: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 14, fontWeight: 700 };
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' };
  const chip = (active: boolean, color: string): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', background: active ? `${color}22` : `${color}10`, color, border: `1px solid ${color}${active ? '77' : '33'}`, ...mono });
  const maxHistBucket = Math.max(...BUCKETS.map(b => b.count));

  const RefreshBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16, padding: '12px 16px', background: stale ? `${C.amber}12` : `${C.green}0c`, border: `1px solid ${stale ? C.amber : C.green}44`, borderRadius: 12 }}>
      <button onClick={run} disabled={!stale} style={{ ...chip(false, stale ? C.amber : C.green), fontSize: 13.5, padding: '9px 18px', opacity: stale ? 1 : 0.6, cursor: stale ? 'pointer' : 'default' }}>
        ⟳ {stale ? 'Refresh projections' : 'Up to date'}
      </button>
      <span style={{ ...mono, fontSize: 12, color: stale ? C.amber : C.text3 }}>
        {stale ? 'Inputs changed — click Refresh to recompute the projection & Monte-Carlo.' : 'Projection reflects your current inputs.'}
      </span>
    </div>
  );

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '26px 24px' }}>
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, padding: '18px 22px', background: `linear-gradient(135deg, ${C.cyan}18 0%, ${C.panel} 100%)`, border: `1px solid ${C.cyan}33`, borderRadius: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.4px', margin: 0 }}>QQQ · Nasdaq-100 — Scenario Simulator</h1>
            <div style={{ ...mono, fontSize: 13, color: C.text3, marginTop: 6 }}>Calibrated from 40 real years (1986–2025). Set 2026 odds → cascading 2027–2030 with a Monte-Carlo range. Edit, then Refresh.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="/historical-returns?m=usa" style={chip(false, C.blue)}>📈 40Y history</a>
            <a href="/smallcap-simulator" style={chip(false, C.purple)}>🇮🇳 Smallcap</a>
            <button onClick={save} style={chip(false, C.green)}>💾 Save</button>
            <button onClick={copyLink} style={chip(false, C.cyan)}>🔗 Share</button>
          </div>
        </div>
        {savedFlash && <div style={{ ...mono, fontSize: 12, color: C.green, marginBottom: 12, marginTop: -6 }}>{savedFlash}</div>}

        {/* Historical context */}
        <div style={card}>
          <div style={cardLabel}>Nasdaq-100 — 40 years of reality (1986–2025)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
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
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: C.text3, marginBottom: 4 }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 16, fontWeight: 800, color: t.color }}>{t.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.65 }}>
            The Nasdaq-100 is a two-regime beast: it compounded at <span style={{ color: C.green, fontWeight: 700 }}>~{STATS.cagr.toFixed(0)}%</span> for four decades, yet lived through the 2000–2002 dot-com bust (−36.8% / −32.7% / −37.6% back-to-back-to-back), a −41.9% 2008, and a −33.0% 2022. Recoveries were violent — +49% in 2003, +53% in 2009, +54% in 2023. Every scenario below is weighted by how often it actually happened, and the cascade replays what genuinely followed.
          </div>
        </div>

        {/* Reality check */}
        <div style={{ ...card, background: `${C.amber}0c`, border: `1px solid ${C.amber}33` }}>
          <div style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.65 }}>
            <strong style={{ color: C.amber }}>Is this too optimistic?</strong> Partly — and here's the honest answer. This tool is calibrated on the <strong>best-performing major index of the last 40 years</strong>. The Nasdaq-100 recovered from every drawdown within a few years, so even bearish 2026 inputs cascade back to a healthy long-run CAGR. That's <em>real</em>, but it's regime-dependent — a repeat of 2000–2012 (a lost decade) shows up in your <strong style={{ color: C.red }}>P10 "unlucky" column</strong>, not the median. Two guards are built in: (1) thin scenarios are shrunk toward the mean so one lucky year can't inflate the path, and (2) the <strong style={{ color: C.amber }}>forward-return haircut</strong> below lets you dial the whole future down if you think mega-cap tech won't repeat its history.
          </div>
        </div>

        {/* Histogram */}
        <div style={card}>
          <div style={cardLabel}>How often each scenario actually happened (1986–2025)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {BUCKETS.map(b => (
              <div key={b.id} style={{ background: C.panel2, border: `1px solid ${b.color}22`, borderRadius: 10, padding: '11px 12px' }}>
                <div style={{ color: b.color, fontWeight: 700, fontSize: 13.5 }}>{b.label}</div>
                <div style={{ ...mono, fontSize: 10, color: C.text3, marginBottom: 7 }}>{b.range} · avg {b.midpoint >= 0 ? '+' : ''}{b.midpoint.toFixed(0)}%</div>
                <div style={{ height: 8, background: C.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ width: `${(b.count / maxHistBucket) * 100}%`, height: '100%', background: b.color, borderRadius: 4 }} />
                </div>
                <div style={{ ...mono, fontSize: 11.5, color: C.text2 }}><span style={{ color: b.color, fontWeight: 700 }}>{b.count} yrs</span> · {b.freq.toFixed(0)}% of history</div>
                <div style={{ ...mono, fontSize: 9.5, color: C.text4, marginTop: 5, lineHeight: 1.5 }}>{b.years.join(' · ') || '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Step 1 */}
        <div style={card}>
          <div style={cardLabel}>Step 1 — set your 2026 scenario probabilities</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {PRESETS.map(p => <button key={p.id} onClick={() => applyPreset(p.probs)} style={chip(false, C.purple)}>{p.label}</button>)}
            <button onClick={normalise} style={chip(false, C.gold)}>↺ Normalise to 100%</button>
          </div>
          <div style={{ fontSize: 12.5, color: C.text3, marginBottom: 12 }}>Defaults are the <strong style={{ color: C.text2 }}>real historical frequencies</strong> — your starting point is what the Nasdaq-100 actually did, not a guess.</div>
          {BUCKETS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderBottom: i < BUCKETS.length - 1 ? `1px solid ${C.border}` : 'none', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 160 }}>
                <span style={{ color: s.color, fontWeight: 700, fontSize: 14 }}>{s.label}</span>
                <div style={{ fontSize: 11, color: C.text3 }}>{s.range}</div>
              </div>
              <div style={{ minWidth: 70, textAlign: 'center' }}>
                <span style={{ ...mono, fontSize: 10.5, padding: '2px 8px', borderRadius: 5, background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}30` }}>hist: {s.freq.toFixed(0)}%</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 240 }}>
                <input type="range" min={0} max={80} value={probs[i]} onChange={e => setProb(i, parseInt(e.target.value, 10))} style={{ flex: 1, accentColor: s.color, cursor: 'pointer' }} />
                <div style={{ ...mono, minWidth: 48, textAlign: 'right', color: s.color, fontWeight: 700, fontSize: 15 }}>{probs[i]}%</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 14, ...mono, fontSize: 14, fontWeight: 700, color: liveTotal === 100 ? C.green : liveTotal > 100 ? C.red : C.amber }}>
            Total: {liveTotal}% {liveTotal === 100 ? '✓' : liveTotal < 100 ? `(need ${100 - liveTotal}% more)` : `(${liveTotal - 100}% over)`}
            {liveTotal !== 100 && <span style={{ color: C.text3, fontWeight: 400 }}> — auto-normalised for the maths</span>}
          </div>
        </div>

        {/* Settings */}
        <div style={card}>
          <div style={cardLabel}>Investment settings</div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 12.5, color: C.text3 }}>
              {mode === 'sip' ? 'Initial lumpsum ($)' : 'Amount invested ($)'}
              <input type="number" min={100} step={1000} value={capital} onChange={e => setCapital(clamp(parseInt(e.target.value, 10) || 0, 0, 1e11))} style={{ display: 'block', marginTop: 5, width: 150, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 11px', ...mono, fontSize: 14 }} />
            </label>
            <div>
              <div style={{ fontSize: 12.5, color: C.text3, marginBottom: 5 }}>Mode</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setMode('lumpsum')} style={chip(mode === 'lumpsum', C.cyan)}>Lumpsum</button>
                <button onClick={() => setMode('sip')} style={chip(mode === 'sip', C.cyan)}>Monthly DCA</button>
              </div>
            </div>
            {mode === 'sip' && (
              <label style={{ fontSize: 12.5, color: C.text3 }}>Monthly ($)
                <input type="number" min={10} step={100} value={monthlySip} onChange={e => setMonthlySip(clamp(parseInt(e.target.value, 10) || 0, 0, 1e9))} style={{ display: 'block', marginTop: 5, width: 120, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 11px', ...mono, fontSize: 14 }} />
              </label>
            )}
            <div>
              <div style={{ fontSize: 12.5, color: C.text3, marginBottom: 5 }}>MC engine</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEngine('bootstrap')} style={chip(engine === 'bootstrap', C.purple)}>Historical bootstrap</button>
                <button onClick={() => setEngine('parametric')} style={chip(engine === 'parametric', C.purple)}>Parametric</button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, color: C.text3, marginBottom: 5 }}>Wealth basis</div>
              <button onClick={() => setRealReturns(v => !v)} style={chip(realReturns, C.amber)}>{realReturns ? `Real (−${US_INFLATION}% infl.)` : 'Nominal'}</button>
            </div>
            <div>
              <div style={{ fontSize: 12.5, color: C.text3, marginBottom: 5 }}>Benchmark</div>
              <button onClick={() => setShowBench(v => !v)} style={chip(showBench, C.blue)}>{showBench ? '✓ S&P 500' : 'S&P 500'}</button>
            </div>
            <label style={{ fontSize: 12.5, color: C.text3 }}>
              Forward haircut: <span style={{ ...mono, color: haircut > 0 ? C.amber : C.text2, fontWeight: 700 }}>−{haircut} pp/yr</span>
              <input type="range" min={0} max={10} value={haircut} onChange={e => setHaircut(parseInt(e.target.value, 10))} style={{ display: 'block', marginTop: 7, width: 160, accentColor: C.amber, cursor: 'pointer' }} />
            </label>
            {engine === 'parametric' && (
              <label style={{ fontSize: 12.5, color: C.text3 }}>
                Volatility: <span style={{ ...mono, color: C.text2 }}>{vol}%</span>
                <input type="range" min={15} max={40} value={vol} onChange={e => setVol(parseInt(e.target.value, 10))} style={{ display: 'block', marginTop: 7, width: 150, accentColor: C.purple, cursor: 'pointer' }} />
              </label>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: C.text4, marginTop: 12, lineHeight: 1.55 }}>
            {committed.engine === 'bootstrap'
              ? `Historical bootstrap: each of ${N_SIMS.toLocaleString('en-US')} paths samples a 2026 scenario from your weights, then replays a REAL 5-year window from history — preserving actual sequencing (crashes cluster, recoveries snap back).`
              : `Parametric: ${N_SIMS.toLocaleString('en-US')} paths sample your weights and add ${committed.vol}% Gaussian volatility per year.`}
            {haircut > 0 && <span style={{ color: C.amber }}> · Forward haircut −{haircut}pp/yr applied to every QQQ return.</span>}
          </div>
        </div>

        {RefreshBar}

        {/* Step 2 — year cards + chart */}
        <div style={card}>
          <div style={cardLabel}>Step 2 — probability-weighted 2026 &amp; cascading 2027–2030</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 18 }}>
            {FORECAST_YEARS.map((yr, i) => {
              const ret = expNom[i]; const real = expReal[i]; const isPos = ret >= 0; const color = isPos ? C.green : C.red;
              return (
                <div key={yr} style={{ background: isPos ? `${C.green}10` : `${C.red}10`, border: `1px solid ${isPos ? C.green : C.red}28`, borderRadius: 10, padding: '13px 11px', textAlign: 'center' }}>
                  <div style={{ ...mono, fontSize: 14, color: yr === 2026 ? C.amber : color, fontWeight: 700 }}>{yr}</div>
                  <div style={{ ...mono, fontSize: 24, fontWeight: 800, color }}>{isPos ? '+' : ''}{ret.toFixed(1)}%</div>
                  <div style={{ ...mono, fontSize: 10.5, color: real >= 0 ? C.cyan : C.red, marginTop: 2 }}>real {real >= 0 ? '+' : ''}{real.toFixed(1)}%</div>
                  <div style={{ ...mono, fontSize: 10, color: C.text3, marginTop: 3 }}>{yr === 2026 ? 'Weighted Avg' : 'Conditional'}</div>
                  <div style={{ ...mono, fontSize: 9.5, color: C.text4, marginTop: 3 }}>P10 {mc.band[i].p10.toFixed(0)}% · P90 {mc.band[i].p90.toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
          <div style={{ ...mono, fontSize: 11, color: C.text3, marginBottom: 8 }}>Nominal returns shown; <span style={{ color: C.cyan }}>real</span> = after −{US_INFLATION}% inflation. Wealth below honours the Nominal/Real toggle.</div>
          <div style={{ ...mono, fontSize: 11, color: C.text3, marginBottom: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><span style={{ color: C.gold }}>━</span> expected</span>
            <span><span style={{ color: C.purple }}>▒</span> P10–P90</span>
            <span><span style={{ color: C.purple }}>▓</span> P25–P75</span>
            {showBench && <span><span style={{ color: C.blue }}>┈</span> S&P 500 median</span>}
            <span style={{ color: C.text4 }}>| bars = actual 2023–2025</span>
          </div>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
            {[-60, -40, -20, 20, 40, 60].filter(v => Math.abs(v) <= chart.maxAbs).map(v => (
              <g key={v}>
                <line x1={chart.padL} y1={chart.yOf(v)} x2={chart.W - chart.padR} y2={chart.yOf(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="2 4" />
                <text x={chart.W - chart.padR} y={chart.yOf(v) - 2} fill={C.text4} fontSize={9} textAnchor="end" style={mono}>{v > 0 ? '+' : ''}{v}%</text>
              </g>
            ))}
            <line x1={chart.padL} y1={chart.zeroY} x2={chart.W - chart.padR} y2={chart.zeroY} stroke={C.text3} strokeWidth={1} />
            <line x1={chart.xOf(HIST_BARS.length) - chart.colW / 2} y1={chart.padTop} x2={chart.xOf(HIST_BARS.length) - chart.colW / 2} y2={chart.H - chart.padBot} stroke={`${C.amber}55`} strokeWidth={1} strokeDasharray="4 4" />
            <text x={chart.xOf(HIST_BARS.length) - chart.colW / 2 + 5} y={chart.padTop + 10} fill={C.amber} fontSize={9.5} style={mono}>forecast →</text>
            <polygon points={fanPoly} fill={`${C.purple}1f`} />
            <polygon points={fanInner} fill={`${C.purple}30`} />
            {HIST_BARS.map((b) => {
              const isPos = b.ret >= 0; const x = chart.xOf(HIST_BARS.indexOf(b)); const barW = Math.min(34, chart.colW * 0.5);
              const y0 = chart.zeroY, y1 = chart.yOf(b.ret); const top = Math.min(y0, y1), h = Math.abs(y1 - y0); const col = isPos ? C.green : C.red;
              return (<g key={b.yr}><rect x={x - barW / 2} y={top} width={barW} height={h} rx={2} fill={`${col}88`} /><text x={x} y={isPos ? top - 5 : top + h + 11} fill={col} fontSize={10} textAnchor="middle" style={mono}>{isPos ? '+' : ''}{b.ret.toFixed(0)}%</text><text x={x} y={chart.H - chart.padBot + 15} fill={C.text3} fontSize={10} textAnchor="middle" style={mono}>{b.yr}</text></g>);
            })}
            {showBench && <polyline points={benchLine} fill="none" stroke={C.blue} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85} />}
            <polyline points={expLine} fill="none" stroke={C.gold} strokeWidth={2.5} />
            {expNom.map((r, fi) => (<g key={fi}><circle cx={forecastX(fi)} cy={chart.yOf(r)} r={4} fill={C.gold} stroke={C.bg} strokeWidth={1.5} /><text x={forecastX(fi)} y={r >= 0 ? chart.yOf(r) - 9 : chart.yOf(r) + 16} fill={C.gold} fontSize={10} textAnchor="middle" style={mono}>{r >= 0 ? '+' : ''}{r.toFixed(0)}%</text><text x={forecastX(fi)} y={chart.H - chart.padBot + 15} fill={C.amber} fontSize={10} textAnchor="middle" style={mono}>{FORECAST_YEARS[fi]}</text></g>))}
          </svg>
        </div>

        {/* Wealth + risk */}
        <div style={card}>
          <div style={cardLabel}>{usd(committed.capital)}{committed.mode === 'sip' ? ` + ${usd(committed.monthlySip)}/mo DCA` : ''} invested Dec 2025 → projected growth {committed.realReturns ? '(real)' : '(nominal)'}</div>
          {wealthPath.map((v, i) => {
            const maxVal = Math.max(...wealthPath.map(p => p.val)); const pct = (v.val / maxVal) * 100; const up = v.val >= invested; const col = up ? C.green : C.red;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 7 }}>
                <div style={{ ...mono, fontSize: 12, color: C.text3, minWidth: 74 }}>{v.yr}</div>
                <div style={{ flex: 1, background: C.panel2, borderRadius: 6, height: 26, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: `${col}25`, border: `1px solid ${col}45`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10, minWidth: 100 }}>
                    <span style={{ ...mono, fontSize: 12, color: col, fontWeight: 700 }}>{usdFull(v.val)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ ...mono, fontSize: 13.5, marginTop: 14, marginBottom: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <span style={{ color: C.cyan, fontWeight: 700 }}>5Y CAGR (expected): {detCagr.toFixed(1)}%</span>
            <span style={{ color: C.text3 }}> · Total return: {detTotalRet >= 0 ? '+' : ''}{detTotalRet.toFixed(0)}%</span>
            <span style={{ color: C.text3 }}> · {usd(invested)} → {usd(finalDet)}</span>
          </div>
          <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 10, ...mono }}>Monte-Carlo outcome range · {N_SIMS.toLocaleString('en-US')} {committed.engine} paths</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[
              { label: 'P10 · unlucky', val: usd(mc.ending.p10), color: C.red },
              { label: 'P25', val: usd(mc.ending.p25), color: C.amber },
              { label: 'P50 · median', val: usd(mc.ending.p50), color: C.text },
              { label: 'P75', val: usd(mc.ending.p75), color: C.green },
              { label: 'P90 · lucky', val: usd(mc.ending.p90), color: C.green },
            ].map(t => (<div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', textAlign: 'center' }}><div style={{ fontSize: 10, color: C.text3, marginBottom: 4, ...mono }}>{t.label}</div><div style={{ ...mono, fontSize: 15, fontWeight: 800, color: t.color }}>{t.val}</div></div>))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            {[
              { label: 'P(loses money)', val: `${mc.pLoss.toFixed(0)}%`, color: mc.pLoss > 25 ? C.red : C.amber },
              { label: 'P(doubles+)', val: `${mc.pDouble.toFixed(0)}%`, color: C.green },
              { label: 'P(triples+)', val: `${mc.pTriple.toFixed(0)}%`, color: C.green },
              { label: 'P(halves)', val: `${mc.pHalf.toFixed(0)}%`, color: mc.pHalf > 10 ? C.red : C.text2 },
              { label: 'CAGR P10 → P90', val: `${mc.cagr.p10.toFixed(0)}% → ${mc.cagr.p90.toFixed(0)}%`, color: C.cyan },
              ...(showBench ? [{ label: 'S&P 500 median end', val: usd(mc.benchMedianEnd), color: C.blue }] : []),
            ].map(t => (<div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', textAlign: 'center' }}><div style={{ fontSize: 10, color: C.text3, marginBottom: 4, ...mono }}>{t.label}</div><div style={{ ...mono, fontSize: 14.5, fontWeight: 800, color: t.color }}>{t.val}</div></div>))}
          </div>
          {showBench && (
            <div style={{ fontSize: 12.5, color: C.text3, marginTop: 12, lineHeight: 1.55 }}>
              QQQ median {usd(mc.ending.p50)} vs S&P 500 median {usd(mc.benchMedianEnd)} —
              {mc.ending.p50 > mc.benchMedianEnd ? ` the extra ${usd(mc.ending.p50 - mc.benchMedianEnd)} is your reward for concentrated Nasdaq risk. The P10 (${usd(mc.ending.p10)}) is what a bad tech cycle costs you.` : ` the S&P median is higher — your bearish tech weights don't justify the extra concentration.`}
            </div>
          )}
        </div>

        {/* Insights */}
        <div style={card}>
          <div style={cardLabel}>Dynamic insights based on your assumptions</div>
          <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 15 }}>
            <div style={{ ...mono, fontSize: 11.5, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Your implied odds vs 40-year reality</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, fontSize: 13.5, color: C.text2 }}>
              <div>P(2026 down year): <strong style={{ color: pNeg > histNegPct + 10 ? C.red : C.amber }}>{pNeg.toFixed(0)}%</strong> <span style={{ color: C.text4 }}>vs {histNegPct.toFixed(0)}% historically</span></div>
              <div>P(2026 boom +40%): <strong style={{ color: C.green }}>{pBoom.toFixed(0)}%</strong> <span style={{ color: C.text4 }}>vs {BUCKETS[5].freq.toFixed(0)}% historically</span></div>
              <div>E[2026] nominal: <strong style={{ color: expNom[0] >= 0 ? C.green : C.red }}>{expNom[0] >= 0 ? '+' : ''}{expNom[0].toFixed(1)}%</strong> <span style={{ color: C.text4 }}>real {expReal[0] >= 0 ? '+' : ''}{expReal[0].toFixed(1)}%</span></div>
              <div>Your 5Y CAGR: <strong style={{ color: C.cyan }}>{detCagr.toFixed(1)}%</strong> <span style={{ color: C.text4 }}>vs +{STATS.cagr.toFixed(0)}% actual</span></div>
            </div>
          </div>
          {pNeg > histNegPct + 12 && (
            <div style={{ marginTop: 10, padding: '11px 13px', background: `${C.red}0e`, border: `1px solid ${C.red}22`, borderRadius: 8, fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}>
              <strong style={{ color: C.red }}>Bearish vs history:</strong> you're pricing {pNeg.toFixed(0)}% odds of a down 2026, above the {histNegPct.toFixed(0)}% the Nasdaq-100 posted across 40 years. Down years were rare but brutal — and every one snapped back +50%+ within a couple years, which your cascade reflects. If you doubt that recovery repeats, raise the forward haircut.
            </div>
          )}
          {pBoom > 35 && (
            <div style={{ marginTop: 10, padding: '11px 13px', background: `${C.green}0e`, border: `1px solid ${C.green}22`, borderRadius: 8, fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}>
              <strong style={{ color: C.green }}>Aggressive bull:</strong> {pBoom.toFixed(0)}% odds on a +40% boom is {(pBoom / Math.max(BUCKETS[5].freq, 1)).toFixed(1)}× the historical base rate ({BUCKETS[5].freq.toFixed(0)}%). Booms happened (1998, 1999, 2023) but back-to-back booms are rare; the cascade pulls 2027+ toward mean reversion.
            </div>
          )}
          <div style={{ marginTop: 12, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 15 }}>
            <div style={{ ...mono, fontSize: 11.5, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>How the cascade works (data-driven, shrunk)</div>
            <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.6 }}>
              For each 2026 bucket, 2027–2030 are the <strong>actual average of what followed</strong> similar years, shrunk toward the mean by sample size (so thin buckets can't be hijacked by one lucky year):
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 6, marginTop: 10, ...mono, fontSize: 11 }}>
                {BUCKETS.map(b => (
                  <div key={b.id} style={{ color: b.color }}>
                    If {b.label.toLowerCase()} → {PATHS[b.id].map(v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`).join(', ')}
                    <span style={{ color: C.text4 }}> (n={b.count}{b.count < 3 ? ' · low confidence, shrunk' : ''})</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                Expected 5Y CAGR of <strong style={{ color: C.cyan }}>{detCagr.toFixed(1)}%</strong> {Math.abs(detCagr - STATS.cagr) < 4 ? `sits near the 40-year actual (~${STATS.cagr.toFixed(0)}%).` : detCagr > STATS.cagr ? 'is above the 40-year actual — you may be overweighting booms (or haircut too low).' : 'is below the 40-year actual — bearish or haircut-adjusted.'}
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ background: `${C.amber}0c`, border: `1px solid ${C.amber}28`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.6 }}>
            <strong style={{ color: C.amber }}>⚠ Important.</strong> Projections extrapolate from 40 years of Nasdaq-100 history (1986–2025). The index is heavily concentrated in mega-cap tech; future regimes (rates, AI capex, concentration risk) may not rhyme with the past. Annual std deviation is ~{STATS.stdev.toFixed(0)}% — any single year can deviate hugely. This is an analytical exercise, <strong>not investment advice</strong>.
          </div>
        </div>
        <div style={{ ...mono, fontSize: 11, color: C.text4, textAlign: 'center', paddingBottom: 20 }}>Source: Nasdaq-100 calendar-year returns 1986–2025 (slickcharts / 1stock1) · Market Cockpit data-driven Monte-Carlo · educational only</div>
      </div>
    </div>
  );
}
