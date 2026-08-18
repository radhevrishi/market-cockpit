'use client';

// zzz403/zzz406 — Nifty Smallcap 100 Scenario Simulator.
//
// zzz406 fix: the deterministic outputs (implied probabilities, expected
// returns, cascade, wealth path, insights) are now FULLY LIVE — they update
// the instant you move a slider, exactly like the reference tool. Only the
// Monte-Carlo ranges (P10–P90 bands + risk panel) wait for the Refresh button,
// because that is the actual "simulation run". This removes the confusing
// stale-state mismatch where sliders said one thing and results said another.

import React, { useEffect, useMemo, useState, useCallback } from 'react';

const C = {
  bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937',
  text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', text4: '#475569',
  cyan: '#06B6D4', gold: '#FBBF24', purple: '#A78BFA', green: '#22C55E',
  amber: '#F59E0B', red: '#EF4444', blue: '#60A5FA',
};

interface Scenario { id: string; name: string; range: string; midpoint: number; band: [number, number]; color: string; histPct: number; defaultPct: number; }
const SCENARIOS: Scenario[] = [
  { id: 'crash',   name: 'Crash',           range: '< −30%',        midpoint: -50, band: [-72, -30], color: '#ff2040', histPct: 0,  defaultPct: 3 },
  { id: 'bad',     name: 'Bad Year',        range: '−30% to −15%',  midpoint: -22, band: [-30, -15], color: '#ff4757', histPct: 0,  defaultPct: 5 },
  { id: 'mildneg', name: 'Mild Negative',   range: '−15% to 0%',    midpoint: -7,  band: [-15, 0],   color: '#e07020', histPct: 17, defaultPct: 12 },
  { id: 'modest',  name: 'Modest Positive', range: '0% to +20%',    midpoint: 10,  band: [0, 20],    color: '#6c9a8b', histPct: 0,  defaultPct: 20 },
  { id: 'good',    name: 'Good Year',       range: '+20% to +50%',  midpoint: 35,  band: [20, 50],   color: '#00d4aa', histPct: 33, defaultPct: 35 },
  { id: 'boom',    name: 'Boom',            range: '+50%+',         midpoint: 60,  band: [50, 92],   color: '#00ffcc', histPct: 50, defaultPct: 25 },
];
type Path = { 2027: number; 2028: number; 2029: number; 2030: number };
const CONDITIONAL_PATHS: Record<string, Path> = {
  crash:   { 2027: 85, 2028: 15,  2029: -25, 2030: 35 },
  bad:     { 2027: 45, 2028: -8,  2029: 50,  2030: 7 },
  mildneg: { 2027: 55, 2028: 8,   2029: 2,   2030: 50 },
  modest:  { 2027: 45, 2028: -22, 2029: 35,  2030: 8 },
  good:    { 2027: 35, 2028: -18, 2029: 40,  2030: 5 },
  boom:    { 2027: -5, 2028: -25, 2029: 55,  2030: 20 },
};
const HISTORICAL_BARS = [{ yr: 2023, ret: 55.6 }, { yr: 2024, ret: 23.9 }, { yr: 2025, ret: -5.6 }];
const FORECAST_YEARS = [2026, 2027, 2028, 2029, 2030];
const PRESETS: { id: string; label: string; probs: number[] }[] = [
  { id: 'hist', label: '📊 Historical base rates', probs: SCENARIOS.map(s => s.histPct) },
  { id: 'bull', label: '🐂 Bull case', probs: [0, 2, 8, 15, 40, 35] },
  { id: 'base', label: '⚖ Base case', probs: SCENARIOS.map(s => s.defaultPct) },
  { id: 'bear', label: '🐻 Bear case', probs: [15, 20, 25, 20, 15, 5] },
];
const LS_KEY = 'mc:smallcap-sim:v1';
const N_SIMS = 4000;
const BENCH_MEAN = 12, BENCH_VOL = 18;
const INFLATION = 5.5;

function mulberry32(seed: number) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussian(rng: () => number): number { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }
function pctile(sorted: number[], p: number): number { if (!sorted.length) return 0; const idx = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1); const lo = Math.floor(idx), hi = Math.ceil(idx); return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo); }
function inr(n: number): string { return '₹' + Math.round(n).toLocaleString('en-IN'); }
function inrCompact(n: number): string { if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L'; if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'k'; return '₹' + Math.round(n).toLocaleString('en-IN'); }

interface MCInputs { probs: number[]; capital: number; mode: 'lumpsum' | 'sip'; monthlySip: number; realReturns: boolean; vol: number; haircut: number; }
interface MCResult { band: { p10: number; p25: number; p50: number; p75: number; p90: number }[]; ending: { p10: number; p25: number; p50: number; p75: number; p90: number }; cagr: { p10: number; p50: number; p90: number }; pLoss: number; pDouble: number; pHalf: number; invested: number; benchMedianEnd: number; }

export default function SmallcapSimulatorPage() {
  const [probs, setProbs] = useState<number[]>(SCENARIOS.map(s => s.defaultPct));
  const [capital, setCapital] = useState<number>(100000);
  const [mode, setMode] = useState<'lumpsum' | 'sip'>('lumpsum');
  const [monthlySip, setMonthlySip] = useState<number>(10000);
  const [realReturns, setRealReturns] = useState<boolean>(false);
  const [showBench, setShowBench] = useState<boolean>(true);
  const [vol, setVol] = useState<number>(42);
  const [haircut, setHaircut] = useState<number>(0);
  const [savedFlash, setSavedFlash] = useState<string>('');
  // Monte-Carlo snapshot — only updates on Refresh.
  const [mcSnap, setMcSnap] = useState<MCInputs>({ probs: SCENARIOS.map(s => s.defaultPct), capital: 100000, mode: 'lumpsum', monthlySip: 10000, realReturns: false, vol: 42, haircut: 0 });

  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const snap: MCInputs = { probs: SCENARIOS.map(s => s.defaultPct), capital: 100000, mode: 'lumpsum', monthlySip: 10000, realReturns: false, vol: 42, haircut: 0 };
      const pRaw = qs.get('p'); const raw = localStorage.getItem(LS_KEY);
      if (pRaw) {
        const arr = pRaw.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        if (arr.length === 6) snap.probs = arr;
        if (qs.get('cap')) snap.capital = clamp(parseInt(qs.get('cap')!, 10) || 100000, 1000, 1e11);
        if (qs.get('mode') === 'sip') snap.mode = 'sip';
        if (qs.get('sip')) snap.monthlySip = clamp(parseInt(qs.get('sip')!, 10) || 10000, 100, 1e9);
        if (qs.get('real') === '1') snap.realReturns = true;
        if (qs.get('vol')) snap.vol = clamp(parseInt(qs.get('vol')!, 10) || 42, 20, 60);
        if (qs.get('hc')) snap.haircut = clamp(parseInt(qs.get('hc')!, 10) || 0, 0, 12);
      } else if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.probs) && s.probs.length === 6) snap.probs = s.probs;
        if (typeof s.capital === 'number') snap.capital = s.capital;
        if (s.mode === 'sip') snap.mode = 'sip';
        if (typeof s.monthlySip === 'number') snap.monthlySip = s.monthlySip;
        if (typeof s.realReturns === 'boolean') snap.realReturns = s.realReturns;
        if (typeof s.vol === 'number') snap.vol = s.vol;
        if (typeof s.haircut === 'number') snap.haircut = s.haircut;
      } else return;
      setProbs(snap.probs); setCapital(snap.capital); setMode(snap.mode); setMonthlySip(snap.monthlySip);
      setRealReturns(snap.realReturns); setVol(snap.vol); setHaircut(snap.haircut); setMcSnap(snap);
    } catch { /* ignore */ }
  }, []);

  // ── LIVE deterministic outputs (always reflect current sliders) ──
  const total = probs.reduce((a, b) => a + b, 0);
  const norm = useMemo(() => (total > 0 ? probs.map(p => p / total) : probs.map(() => 0)), [probs, total]);
  const { expNom, expReal } = useMemo(() => {
    const e2026 = SCENARIOS.reduce((acc, s, i) => acc + norm[i] * s.midpoint, 0);
    const eY = (y: 2027 | 2028 | 2029 | 2030) => SCENARIOS.reduce((acc, s, i) => acc + norm[i] * CONDITIONAL_PATHS[s.id][y], 0);
    const nom = [e2026, eY(2027), eY(2028), eY(2029), eY(2030)].map(r => r - haircut);
    return { expNom: nom, expReal: nom.map(r => r - INFLATION) };
  }, [norm, haircut]);
  const expected = realReturns ? expReal : expNom;

  const wealthPath = useMemo(() => {
    const annual = monthlySip * 12; let w = capital;
    const pts: { yr: string; val: number }[] = [{ yr: 'Dec 2025', val: w }];
    FORECAST_YEARS.forEach((yr, i) => { const g = 1 + expected[i] / 100; if (mode === 'sip') w = w * g + annual * (1 + expected[i] / 200); else w = w * g; pts.push({ yr: `Dec ${yr}`, val: w }); });
    return pts;
  }, [expected, capital, mode, monthlySip]);
  const invested = mode === 'sip' ? capital + monthlySip * 12 * 5 : capital;
  const finalDet = wealthPath[wealthPath.length - 1].val;
  const detCagr = (Math.pow(finalDet / Math.max(invested, 1), 1 / 5) - 1) * 100;
  const detTotalRet = (finalDet / Math.max(invested, 1) - 1) * 100;
  const pNeg = (norm[0] + norm[1] + norm[2]) * 100;
  const pPos = (norm[3] + norm[4] + norm[5]) * 100;
  const pWorse2025 = (norm[0] + norm[1]) * 100;

  // ── Monte-Carlo (from snapshot; Refresh commits) ──
  const live: MCInputs = { probs, capital, mode, monthlySip, realReturns, vol, haircut };
  const mcStale = JSON.stringify(live) !== JSON.stringify(mcSnap);
  const run = useCallback(() => setMcSnap({ probs: probs.slice(), capital, mode, monthlySip, realReturns, vol, haircut }), [probs, capital, mode, monthlySip, realReturns, vol, haircut]);
  const normMc = useMemo(() => { const t = mcSnap.probs.reduce((a, b) => a + b, 0); return t > 0 ? mcSnap.probs.map(p => p / t) : mcSnap.probs.map(() => 0); }, [mcSnap]);

  const mc = useMemo<MCResult>(() => {
    const rng = mulberry32(1234567);
    const cum: number[] = []; let acc = 0;
    for (let i = 0; i < normMc.length; i++) { acc += normMc[i]; cum.push(acc); }
    const annual = mcSnap.monthlySip * 12;
    const yearRet: number[][] = [[], [], [], [], []]; const endW: number[] = []; const endWBench: number[] = [];
    for (let s = 0; s < N_SIMS; s++) {
      const r = rng(); let si = cum.findIndex(c => r <= c); if (si < 0) si = SCENARIOS.length - 1;
      const sc = SCENARIOS[si]; const path = CONDITIONAL_PATHS[sc.id]; const seq: number[] = [];
      const band0sigma = (sc.band[1] - sc.band[0]) / 4;
      seq.push(clamp(sc.midpoint + gaussian(rng) * band0sigma, sc.band[0], sc.band[1]));
      ([2027, 2028, 2029, 2030] as const).forEach(y => seq.push(clamp(path[y] + gaussian(rng) * mcSnap.vol, -85, 260)));
      const bseq: number[] = []; for (let y = 0; y < 5; y++) bseq.push(clamp(BENCH_MEAN + gaussian(rng) * BENCH_VOL, -55, 90));
      let w = mcSnap.capital, wb = mcSnap.capital;
      for (let y = 0; y < 5; y++) {
        const nomRet = seq[y] - mcSnap.haircut; yearRet[y].push(nomRet);
        const rS = mcSnap.realReturns ? nomRet - INFLATION : nomRet; const rB = mcSnap.realReturns ? bseq[y] - INFLATION : bseq[y];
        const gS = 1 + rS / 100, gB = 1 + rB / 100;
        if (mcSnap.mode === 'sip') { w = w * gS + annual * (1 + rS / 200); wb = wb * gB + annual * (1 + rB / 200); } else { w = w * gS; wb = wb * gB; }
      }
      endW.push(w); endWBench.push(wb);
    }
    const band = yearRet.map(a => { const so = a.slice().sort((x, y) => x - y); return { p10: pctile(so, 10), p25: pctile(so, 25), p50: pctile(so, 50), p75: pctile(so, 75), p90: pctile(so, 90) }; });
    const soEnd = endW.slice().sort((x, y) => x - y); const soBench = endWBench.slice().sort((x, y) => x - y);
    const inv = mcSnap.mode === 'sip' ? mcSnap.capital + annual * 5 : mcSnap.capital;
    const cagrArr = soEnd.map(w => (Math.pow(w / Math.max(inv, 1), 1 / 5) - 1) * 100).sort((x, y) => x - y);
    return { band, ending: { p10: pctile(soEnd, 10), p25: pctile(soEnd, 25), p50: pctile(soEnd, 50), p75: pctile(soEnd, 75), p90: pctile(soEnd, 90) }, cagr: { p10: pctile(cagrArr, 10), p50: pctile(cagrArr, 50), p90: pctile(cagrArr, 90) }, pLoss: (endW.filter(w => w < inv).length / endW.length) * 100, pDouble: (endW.filter(w => w >= inv * 2).length / endW.length) * 100, pHalf: (endW.filter(w => w <= inv * 0.5).length / endW.length) * 100, invested: inv, benchMedianEnd: pctile(soBench, 50) };
  }, [normMc, mcSnap]);

  const setProb = useCallback((idx: number, val: number) => setProbs(prev => { const n = prev.slice(); n[idx] = clamp(Math.round(val), 0, 90); return n; }), []);
  const applyPreset = useCallback((p: number[]) => setProbs(p.slice()), []);
  const normalise = useCallback(() => setProbs(prev => { const t = prev.reduce((a, b) => a + b, 0); return t === 0 ? prev : prev.map(p => Math.round((p / t) * 100)); }), []);
  const save = useCallback(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(live)); setMcSnap(live); setSavedFlash('✓ Saved'); setTimeout(() => setSavedFlash(''), 2000); } catch { setSavedFlash('⚠ Could not save'); } }, [live]);
  const copyLink = useCallback(() => { try { const qs = new URLSearchParams(); qs.set('p', probs.join(',')); qs.set('cap', String(capital)); if (mode === 'sip') { qs.set('mode', 'sip'); qs.set('sip', String(monthlySip)); } if (realReturns) qs.set('real', '1'); qs.set('vol', String(vol)); if (haircut) qs.set('hc', String(haircut)); navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?${qs.toString()}`); setSavedFlash('🔗 Link copied'); setTimeout(() => setSavedFlash(''), 2000); } catch { setSavedFlash('⚠ Could not copy'); } }, [probs, capital, mode, monthlySip, realReturns, vol, haircut]);

  // chart geometry — expected line + historical bars are LIVE; fan is from snapshot
  const chart = useMemo(() => {
    const W = 980, H = 360, padL = 4, padR = 8, padTop = 12, padBot = 30; const plotH = H - padTop - padBot;
    const allVals = [...HISTORICAL_BARS.map(b => b.ret), ...mc.band.map(b => b.p90), ...mc.band.map(b => b.p10), ...expNom];
    const maxAbs = Math.max(80, ...allVals.map(v => Math.abs(v)));
    const zeroY = padTop + plotH / 2; const scale = (plotH / 2) / maxAbs; const yOf = (v: number) => zeroY - v * scale;
    const cols = HISTORICAL_BARS.length + FORECAST_YEARS.length; const colW = (W - padL - padR) / cols; const xOf = (i: number) => padL + colW * (i + 0.5);
    return { W, H, padL, padR, padTop, padBot, zeroY, scale, yOf, colW, xOf, maxAbs };
  }, [mc, expNom]);
  const forecastX = (fi: number) => chart.xOf(HISTORICAL_BARS.length + fi);
  const fanOp = mcStale ? 0.28 : 1;
  const fanPoly = [...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p90).toFixed(1)}`), ...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p10).toFixed(1)}`).reverse()].join(' ');
  const fanInner = [...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p75).toFixed(1)}`), ...mc.band.map((b, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(b.p25).toFixed(1)}`).reverse()].join(' ');
  const expLine = expNom.map((r, fi) => `${forecastX(fi).toFixed(1)},${chart.yOf(r).toFixed(1)}`).join(' ');

  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16 };
  const cardLabel: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 14, fontWeight: 700 };
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' };
  const chipBtn = (active: boolean, color: string): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', background: active ? `${color}22` : `${color}10`, color, border: `1px solid ${color}${active ? '77' : '33'}`, ...mono });

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '26px 24px' }}>
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, padding: '18px 22px', background: `linear-gradient(135deg, ${C.purple}18 0%, ${C.panel} 100%)`, border: `1px solid ${C.purple}33`, borderRadius: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.4px', margin: 0 }}>Nifty Smallcap 100 — Scenario Simulator</h1>
            <div style={{ ...mono, fontSize: 13, color: C.text3, marginTop: 6 }}>Expected returns update live with your sliders. The Monte-Carlo ranges recompute on Refresh.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="/historical-returns?m=india" style={chipBtn(false, C.blue)}>📈 History</a>
            <a href="/qqq-simulator" style={chipBtn(false, C.cyan)}>🇺🇸 QQQ</a>
            <button onClick={save} style={chipBtn(false, C.green)}>💾 Save</button>
            <button onClick={copyLink} style={chipBtn(false, C.cyan)}>🔗 Share</button>
          </div>
        </div>
        {savedFlash && <div style={{ ...mono, fontSize: 12, color: C.green, marginBottom: 12, marginTop: -6 }}>{savedFlash}</div>}

        <div style={card}>
          <div style={cardLabel}>Historical Context — what happened after negative years?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { label: '2025 Return', value: '−5.6%', color: C.red },
              { label: 'P(Neg after Neg)', value: '17%', color: C.amber },
              { label: 'P(Boom after Neg)', value: '50%', color: C.green },
              { label: 'Double-Neg Cases', value: '1 of 22', color: C.text2 },
              { label: 'After Mild Neg → Worse', value: '0 of 3', color: C.green },
              { label: '22Y Avg Return', value: '+22.6%', color: C.green },
            ].map(t => (
              <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: C.text3, marginBottom: 4 }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 18, fontWeight: 800, color: t.color }}>{t.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.65 }}>
            After the 6 historical negative years, the next year was: <span style={{ color: C.green, fontWeight: 700 }}>+107%</span>, <span style={{ color: C.green, fontWeight: 700 }}>+36.8%</span>, <span style={{ color: C.green, fontWeight: 700 }}>+55%</span>, <span style={{ color: C.red, fontWeight: 700 }}>−9.5%</span>, <span style={{ color: C.green, fontWeight: 700 }}>+21.5%</span>, <span style={{ color: C.green, fontWeight: 700 }}>+55.6%</span>. Only once (2018→2019) did back-to-back negatives occur — 2020–2024 then compounded at 26% CAGR.
          </div>
        </div>

        <div style={{ ...card, background: `${C.amber}0c`, border: `1px solid ${C.amber}33` }}>
          <div style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.65 }}>
            <strong style={{ color: C.amber }}>Read recovery paths with a pinch of salt.</strong> The 2027–2030 cascade uses the deck's post-drawdown analogues — Indian smallcaps did snap back violently after every crash, but 22 years is a short, mostly-bull sample. The P10 "unlucky" column is where a longer bear plays out. Use the <strong style={{ color: C.amber }}>forward-return haircut</strong> if you think the next cycle runs below history.
          </div>
        </div>

        {/* Step 1 */}
        <div style={card}>
          <div style={cardLabel}>Step 1 — set your 2026 scenario probabilities</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {PRESETS.map(p => <button key={p.id} onClick={() => applyPreset(p.probs)} style={chipBtn(false, C.purple)}>{p.label}</button>)}
            <button onClick={normalise} style={chipBtn(false, C.gold)}>↺ Normalise to 100%</button>
          </div>
          <div style={{ fontSize: 12.5, color: C.text3, marginBottom: 12 }}>Assign your probability to each outcome. Historical base rates (given 2025 was negative) shown as reference.</div>
          {SCENARIOS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderBottom: i < SCENARIOS.length - 1 ? `1px solid ${C.border}` : 'none', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 160 }}>
                <span style={{ color: s.color, fontWeight: 700, fontSize: 14 }}>{s.name}</span>
                <div style={{ fontSize: 11, color: C.text3 }}>{s.range}</div>
              </div>
              <div style={{ minWidth: 70, textAlign: 'center' }}>
                <span style={{ ...mono, fontSize: 10.5, padding: '2px 8px', borderRadius: 5, background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}30` }}>hist: {s.histPct}%</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 240 }}>
                <input type="range" min={0} max={80} value={probs[i]} onChange={e => setProb(i, parseInt(e.target.value, 10))} style={{ flex: 1, accentColor: s.color, cursor: 'pointer' }} />
                <div style={{ ...mono, minWidth: 48, textAlign: 'right', color: s.color, fontWeight: 700, fontSize: 15 }}>{probs[i]}%</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <span style={{ ...mono, fontSize: 14, fontWeight: 700, color: total === 100 ? C.green : total > 100 ? C.red : C.amber }}>Total: {total}% {total === 100 ? '✓' : total < 100 ? `(need ${100 - total}% more)` : `(${total - 100}% over)`}{total !== 100 && <span style={{ color: C.text3, fontWeight: 400 }}> — auto-normalised</span>}</span>
            <span style={{ ...mono, fontSize: 13, color: C.text2 }}>→ live: <strong style={{ color: expNom[0] >= 0 ? C.green : C.red }}>E[2026] {expNom[0] >= 0 ? '+' : ''}{expNom[0].toFixed(1)}%</strong> · <span style={{ color: pNeg > 40 ? C.red : C.amber }}>P(down) {pNeg.toFixed(0)}%</span> · <span style={{ color: C.green }}>P(up) {pPos.toFixed(0)}%</span></span>
          </div>
        </div>

        {/* Settings */}
        <div style={card}>
          <div style={cardLabel}>Investment settings</div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 12.5, color: C.text3 }}>{mode === 'sip' ? 'Initial lumpsum (₹)' : 'Amount invested (₹)'}
              <input type="number" min={1000} step={10000} value={capital} onChange={e => setCapital(clamp(parseInt(e.target.value, 10) || 0, 0, 1e11))} style={{ display: 'block', marginTop: 5, width: 160, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 11px', ...mono, fontSize: 14 }} /></label>
            <div><div style={{ fontSize: 12.5, color: C.text3, marginBottom: 5 }}>Mode</div><div style={{ display: 'flex', gap: 6 }}><button onClick={() => setMode('lumpsum')} style={chipBtn(mode === 'lumpsum', C.cyan)}>Lumpsum</button><button onClick={() => setMode('sip')} style={chipBtn(mode === 'sip', C.cyan)}>Monthly SIP</button></div></div>
            {mode === 'sip' && (<label style={{ fontSize: 12.5, color: C.text3 }}>Monthly SIP (₹)<input type="number" min={100} step={1000} value={monthlySip} onChange={e => setMonthlySip(clamp(parseInt(e.target.value, 10) || 0, 0, 1e9))} style={{ display: 'block', marginTop: 5, width: 130, background: C.panel2, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 11px', ...mono, fontSize: 14 }} /></label>)}
            <div><div style={{ fontSize: 12.5, color: C.text3, marginBottom: 5 }}>Wealth basis</div><button onClick={() => setRealReturns(v => !v)} style={chipBtn(realReturns, C.amber)}>{realReturns ? `Real (−${INFLATION}% infl.)` : 'Nominal'}</button></div>
            <div><div style={{ fontSize: 12.5, color: C.text3, marginBottom: 5 }}>Benchmark</div><button onClick={() => setShowBench(v => !v)} style={chipBtn(showBench, C.blue)}>{showBench ? '✓ Nifty 50' : 'Nifty 50'}</button></div>
            <label style={{ fontSize: 12.5, color: C.text3 }}>Forward haircut: <span style={{ ...mono, color: haircut > 0 ? C.amber : C.text2, fontWeight: 700 }}>−{haircut} pp/yr</span><input type="range" min={0} max={10} value={haircut} onChange={e => setHaircut(parseInt(e.target.value, 10))} style={{ display: 'block', marginTop: 7, width: 160, accentColor: C.amber, cursor: 'pointer' }} /></label>
            <label style={{ fontSize: 12.5, color: C.text3 }}>Volatility: <span style={{ ...mono, color: C.text2 }}>{vol}%</span><input type="range" min={20} max={60} value={vol} onChange={e => setVol(parseInt(e.target.value, 10))} style={{ display: 'block', marginTop: 7, width: 150, accentColor: C.purple, cursor: 'pointer' }} /></label>
          </div>
        </div>

        {/* Step 2 — LIVE year cards + chart */}
        <div style={card}>
          <div style={cardLabel}>Step 2 — probability-weighted 2026 &amp; cascading 2027–2030 (live)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 18 }}>
            {FORECAST_YEARS.map((yr, i) => {
              const ret = expNom[i]; const real = expReal[i]; const isPos = ret >= 0; const color = isPos ? C.green : C.red;
              return (
                <div key={yr} style={{ background: isPos ? `${C.green}10` : `${C.red}10`, border: `1px solid ${isPos ? C.green : C.red}28`, borderRadius: 10, padding: '13px 11px', textAlign: 'center' }}>
                  <div style={{ ...mono, fontSize: 14, color: yr === 2026 ? C.amber : color, fontWeight: 700 }}>{yr}</div>
                  <div style={{ ...mono, fontSize: 24, fontWeight: 800, color }}>{isPos ? '+' : ''}{ret.toFixed(1)}%</div>
                  <div style={{ ...mono, fontSize: 10.5, color: real >= 0 ? C.cyan : C.red, marginTop: 2 }}>real {real >= 0 ? '+' : ''}{real.toFixed(1)}%</div>
                  <div style={{ ...mono, fontSize: 10, color: C.text3, marginTop: 3 }}>{yr === 2026 ? 'Weighted Avg' : 'Conditional'}</div>
                  <div style={{ ...mono, fontSize: 9.5, color: mcStale ? C.amber : C.text4, marginTop: 3 }}>{mcStale ? '⟳ refresh range' : `P10 ${mc.band[i].p10.toFixed(0)}% · P90 ${mc.band[i].p90.toFixed(0)}%`}</div>
                </div>
              );
            })}
          </div>
          <div style={{ ...mono, fontSize: 11, color: C.text3, marginBottom: 8 }}>Nominal returns shown; <span style={{ color: C.cyan }}>real</span> = after −{INFLATION}% inflation. Shaded band = Monte-Carlo P10–P90 {mcStale ? <span style={{ color: C.amber }}>(stale — click Refresh)</span> : '(current)'}.</div>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
            {[-60, -40, -20, 20, 40, 60, 80].filter(v => Math.abs(v) <= chart.maxAbs).map(v => (<g key={v}><line x1={chart.padL} y1={chart.yOf(v)} x2={chart.W - chart.padR} y2={chart.yOf(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="2 4" /><text x={chart.W - chart.padR} y={chart.yOf(v) - 2} fill={C.text4} fontSize={9} textAnchor="end" style={mono}>{v > 0 ? '+' : ''}{v}%</text></g>))}
            <line x1={chart.padL} y1={chart.zeroY} x2={chart.W - chart.padR} y2={chart.zeroY} stroke={C.text3} strokeWidth={1} />
            <line x1={chart.xOf(HISTORICAL_BARS.length) - chart.colW / 2} y1={chart.padTop} x2={chart.xOf(HISTORICAL_BARS.length) - chart.colW / 2} y2={chart.H - chart.padBot} stroke={`${C.amber}55`} strokeWidth={1} strokeDasharray="4 4" />
            <text x={chart.xOf(HISTORICAL_BARS.length) - chart.colW / 2 + 5} y={chart.padTop + 10} fill={C.amber} fontSize={9.5} style={mono}>forecast →</text>
            <polygon points={fanPoly} fill={`${C.purple}1f`} opacity={fanOp} /><polygon points={fanInner} fill={`${C.purple}30`} opacity={fanOp} />
            {HISTORICAL_BARS.map((b, i) => { const isPos = b.ret >= 0; const x = chart.xOf(i); const barW = Math.min(34, chart.colW * 0.5); const y0 = chart.zeroY, y1 = chart.yOf(b.ret); const top = Math.min(y0, y1), h = Math.abs(y1 - y0); const col = isPos ? C.green : C.red; return (<g key={b.yr}><rect x={x - barW / 2} y={top} width={barW} height={h} rx={2} fill={`${col}88`} /><text x={x} y={isPos ? top - 5 : top + h + 11} fill={col} fontSize={10} textAnchor="middle" style={mono}>{isPos ? '+' : ''}{b.ret.toFixed(0)}%</text><text x={x} y={chart.H - chart.padBot + 15} fill={C.text3} fontSize={10} textAnchor="middle" style={mono}>{b.yr}</text></g>); })}
            <polyline points={expLine} fill="none" stroke={C.gold} strokeWidth={2.5} />
            {expNom.map((r, fi) => (<g key={fi}><circle cx={forecastX(fi)} cy={chart.yOf(r)} r={4} fill={C.gold} stroke={C.bg} strokeWidth={1.5} /><text x={forecastX(fi)} y={r >= 0 ? chart.yOf(r) - 9 : chart.yOf(r) + 16} fill={C.gold} fontSize={10} textAnchor="middle" style={mono}>{r >= 0 ? '+' : ''}{r.toFixed(0)}%</text><text x={forecastX(fi)} y={chart.H - chart.padBot + 15} fill={C.amber} fontSize={10} textAnchor="middle" style={mono}>{FORECAST_YEARS[fi]}</text></g>))}
          </svg>
        </div>

        {/* Wealth (live) */}
        <div style={card}>
          <div style={cardLabel}>{inrCompact(capital)}{mode === 'sip' ? ` + ${inrCompact(monthlySip)}/mo SIP` : ''} invested Dec 2025 → projected growth {realReturns ? '(real)' : '(nominal)'} · live</div>
          {wealthPath.map((v, i) => { const maxVal = Math.max(...wealthPath.map(p => p.val)); const pct = (v.val / maxVal) * 100; const up = v.val >= invested; const col = up ? C.green : C.red; return (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 7 }}><div style={{ ...mono, fontSize: 12, color: C.text3, minWidth: 74 }}>{v.yr}</div><div style={{ flex: 1, background: C.panel2, borderRadius: 6, height: 26, position: 'relative', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: `${col}25`, border: `1px solid ${col}45`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10, minWidth: 100 }}><span style={{ ...mono, fontSize: 12, color: col, fontWeight: 700 }}>{inr(v.val)}</span></div></div></div>); })}
          <div style={{ ...mono, fontSize: 13.5, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <span style={{ color: C.cyan, fontWeight: 700 }}>5Y CAGR (expected): {detCagr.toFixed(1)}%</span><span style={{ color: C.text3 }}> · Total return: {detTotalRet >= 0 ? '+' : ''}{detTotalRet.toFixed(0)}%</span><span style={{ color: C.text3 }}> · {inrCompact(invested)} → {inrCompact(finalDet)}</span>
          </div>
        </div>

        {/* Refresh + Monte-Carlo risk */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16, padding: '12px 16px', background: mcStale ? `${C.amber}12` : `${C.green}0c`, border: `1px solid ${mcStale ? C.amber : C.green}44`, borderRadius: 12 }}>
          <button onClick={run} disabled={!mcStale} style={{ ...chipBtn(false, mcStale ? C.amber : C.green), fontSize: 13.5, padding: '9px 18px', opacity: mcStale ? 1 : 0.6, cursor: mcStale ? 'pointer' : 'default' }}>⟳ {mcStale ? 'Refresh Monte-Carlo ranges' : 'Ranges up to date'}</button>
          <span style={{ ...mono, fontSize: 12, color: mcStale ? C.amber : C.text3 }}>{mcStale ? 'The P10–P90 bands & risk panel below reflect your PREVIOUS inputs. Click to re-run 4,000 simulations.' : 'Ranges match your current inputs.'}</span>
        </div>

        <div style={{ ...card, opacity: mcStale ? 0.6 : 1 }}>
          <div style={cardLabel}>Monte-Carlo outcome range · {N_SIMS.toLocaleString('en-IN')} paths {mcStale ? '· ⟳ stale' : ''}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[{ label: 'P10 · unlucky', val: inrCompact(mc.ending.p10), color: C.red }, { label: 'P25', val: inrCompact(mc.ending.p25), color: C.amber }, { label: 'P50 · median', val: inrCompact(mc.ending.p50), color: C.text }, { label: 'P75', val: inrCompact(mc.ending.p75), color: C.green }, { label: 'P90 · lucky', val: inrCompact(mc.ending.p90), color: C.green }].map(t => (<div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', textAlign: 'center' }}><div style={{ fontSize: 10, color: C.text3, marginBottom: 4, ...mono }}>{t.label}</div><div style={{ ...mono, fontSize: 15, fontWeight: 800, color: t.color }}>{t.val}</div></div>))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {[{ label: 'P(loses money)', val: `${mc.pLoss.toFixed(0)}%`, color: mc.pLoss > 25 ? C.red : C.amber }, { label: 'P(doubles+)', val: `${mc.pDouble.toFixed(0)}%`, color: C.green }, { label: 'P(halves)', val: `${mc.pHalf.toFixed(0)}%`, color: mc.pHalf > 10 ? C.red : C.text2 }, { label: 'CAGR P10 → P90', val: `${mc.cagr.p10.toFixed(0)}% → ${mc.cagr.p90.toFixed(0)}%`, color: C.cyan }, ...(showBench ? [{ label: 'Nifty 50 median end', val: inrCompact(mc.benchMedianEnd), color: C.blue }] : [])].map(t => (<div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 12px', textAlign: 'center' }}><div style={{ fontSize: 10, color: C.text3, marginBottom: 4, ...mono }}>{t.label}</div><div style={{ ...mono, fontSize: 14.5, fontWeight: 800, color: t.color }}>{t.val}</div></div>))}
          </div>
        </div>

        {/* Insights (live) */}
        <div style={card}>
          <div style={cardLabel}>Dynamic insights based on your assumptions (live)</div>
          <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 15 }}>
            <div style={{ ...mono, fontSize: 11.5, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Your implied probabilities</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, fontSize: 13.5, color: C.text2 }}>
              <div>P(2026 negative): <strong style={{ color: pNeg > 30 ? C.red : C.amber }}>{pNeg.toFixed(0)}%</strong></div>
              <div>P(2026 positive): <strong style={{ color: C.green }}>{pPos.toFixed(0)}%</strong></div>
              <div>P(worse than 2025): <strong style={{ color: pWorse2025 > 20 ? C.red : C.amber }}>{pWorse2025.toFixed(0)}%</strong></div>
              <div>E[2026]: <strong style={{ color: expNom[0] >= 0 ? C.green : C.red }}>{expNom[0] >= 0 ? '+' : ''}{expNom[0].toFixed(1)}%</strong> <span style={{ color: C.text4 }}>real {expReal[0] >= 0 ? '+' : ''}{expReal[0].toFixed(1)}%</span></div>
            </div>
          </div>
          {pNeg > 30 && (<div style={{ marginTop: 10, padding: '11px 13px', background: `${C.red}0e`, border: `1px solid ${C.red}22`, borderRadius: 8, fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}><strong style={{ color: C.red }}>Bearish vs history:</strong> you're assigning {pNeg.toFixed(0)}% to a negative 2026. Historically, after a negative year the next was negative only 17% of the time (1 of 6). After mild negatives like 2025, the next year was worse <strong>0 of 3 times</strong>.</div>)}
          {pWorse2025 > 15 && (<div style={{ marginTop: 10, padding: '11px 13px', background: `${C.red}0e`, border: `1px solid ${C.red}22`, borderRadius: 8, fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}><strong style={{ color: C.red }}>Deep correction:</strong> {pWorse2025.toFixed(0)}% odds to 2026 being worse than −15%. History suggests a violent snap-back — after every crash/bad year the recovery averaged +76% next year, which your 2027 reflects.</div>)}
          {pPos > 70 && (<div style={{ marginTop: 10, padding: '11px 13px', background: `${C.green}0e`, border: `1px solid ${C.green}22`, borderRadius: 8, fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}><strong style={{ color: C.green }}>Bullish alignment:</strong> your {pPos.toFixed(0)}% positive probability lines up with the 83% historical rate of positive years following negatives.</div>)}
          <div style={{ marginTop: 12, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 15 }}>
            <div style={{ ...mono, fontSize: 11.5, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>How the cascade works</div>
            <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.6 }}>Each 2026 scenario triggers a different conditional trajectory based on what historically followed:
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 6, marginTop: 10, ...mono, fontSize: 11 }}>
                <div style={{ color: '#ff2040' }}>If crash → +85, +15, −25, +35</div><div style={{ color: '#ff4757' }}>If bad → +45, −8, +50, +7</div><div style={{ color: '#e07020' }}>If mild neg → +55, +8, +2, +50</div><div style={{ color: '#6c9a8b' }}>If modest → +45, −22, +35, +8</div><div style={{ color: '#00d4aa' }}>If good → +35, −18, +40, +5</div><div style={{ color: '#00ffcc' }}>If boom → −5, −25, +55, +20</div>
              </div>
              <div style={{ marginTop: 10 }}>Expected 5Y CAGR of <strong style={{ color: C.cyan }}>{detCagr.toFixed(1)}%</strong> {Math.abs(detCagr - 14) < 4 ? 'sits near the long-run average (~14%).' : detCagr > 18 ? 'is above the long-run average — bullish or haircut too low.' : 'is below the long-run average — bearish or haircut-adjusted.'}</div>
            </div>
          </div>
        </div>

        <div style={{ background: `${C.amber}0c`, border: `1px solid ${C.amber}28`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.6 }}><strong style={{ color: C.amber }}>⚠ Important.</strong> Pattern-extrapolation from 22 data points (Nifty Smallcap 100, 2004–2025). Annual std deviation is ~42% — any single year can deviate massively. This is an analytical exercise, <strong>not investment advice</strong>.</div>
        </div>
        <div style={{ ...mono, fontSize: 11, color: C.text4, textAlign: 'center', paddingBottom: 20 }}>Source: Investing.com NIFTY Smallcap 100 monthly data (2004–2025) · Market Cockpit Monte-Carlo extension · educational only</div>
      </div>
    </div>
  );
}
