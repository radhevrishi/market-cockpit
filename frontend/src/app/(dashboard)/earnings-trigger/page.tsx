'use client';

// ============================================================================
// EARNINGS-TRIGGER ANALYZER (PATCH 1140)
// Upload a Screener.in export after earnings → the engine scores every stock on
// the institutional "earnings trigger" framework and ranks the best setups.
// Logic from the India Earnings-Trigger Masterclass — fundamentally different
// from the Multibagger/Fundamentals quality screens: this is about WHICH beats
// become multibaggers (speed of acceleration × margin trajectory × PE-cycle
// position × chart stage × earnings quality × sponsorship), classified into
// the five post-earnings scenarios (A–E). Self-contained (react + next/link).
// ============================================================================

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';

const C = {
  bg: '#090d13', panel: '#111722', panel2: '#0d131c', line: '#1e2733', line2: '#2b3a4d',
  txt: '#e6edf3', muted: '#8a98ab', dim: '#5b6677',
  green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#58a6ff', violet: '#a78bfa', cyan: '#39d0d8', teal: '#2dd4bf', gold: '#e3b341',
};
const F = { xs: 12, sm: 13, md: 15, base: 16, lg: 19, xl: 24, xxl: 32, hero: 38 };

// ---- CSV parse (quote-aware) ----
type Row = Record<string, string>;
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let i = 0, field = '', row: string[] = [], inQ = false;
  while (i < text.length) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    else { if (c === '"') { inQ = true; i++; continue; } if (c === ',') { row.push(field); field = ''; i++; continue; } if (c === '\r') { i++; continue; } if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; } field += c; i++; } }
  if (field.length || row.length) { row.push(field); rows.push(row); } return rows;
}
function toObjects(rows: string[][]): Row[] {
  if (!rows.length) return []; const head = rows[0].map((h) => h.trim()); const out: Row[] = [];
  for (let r = 1; r < rows.length; r++) { if (rows[r].length <= 3) continue; const o: Row = {}; head.forEach((h, idx) => (o[h] = rows[r][idx])); out.push(o); } return out;
}
const num = (v: any) => { if (v == null) return NaN; const s = String(v).trim().replace(/,/g, ''); if (!s || s === '-') return NaN; const n = parseFloat(s); return isNaN(n) ? NaN : n; };
const c01 = (x: number) => Math.max(0, Math.min(1, x));
const G = (g: number) => { if (isNaN(g)) return 0.15; if (g < 0) return Math.max(0, 0.15 + g / 300); if (g < 25) return 0.15 + (g / 25) * 0.45; if (g < 40) return 0.60 + ((g - 25) / 15) * 0.20; if (g < 60) return 0.80 + ((g - 40) / 20) * 0.20; return 1; };
const qoq = (a: number, b: number) => (isNaN(a) || isNaN(b) || Math.abs(b) < 1e-6) ? NaN : (a - b) / Math.abs(b);

type Scored = {
  name: string; nse: string; industry: string; mcap: number; price: number;
  composite: number; scenario: string;
  subs: { trigger: number; accel: number; margin: number; multiple: number; stage: number; quality: number; sponsor: number };
  flags: string[]; qp: number; qs: number; peg: number; pe: number; om0: number; om1: number; roce: number; cfo: number; prom: number; pledge: number; stage2: boolean; stage4: boolean;
};

// ---- THE ENGINE (validated against a 145-stock Screener export) ----
function scoreRow(d: Row): Scored {
  const f = (k: string) => num(d[k]);
  const qp = f('YOY Quarterly profit growth'), qs = f('YOY Quarterly sales growth');
  let trigger = G(qp) * 0.6 + G(qs) * 0.4;
  if (!isNaN(qp) && qp >= 25 && !isNaN(qs) && qs < 10) trigger *= 0.7;
  const p0 = f('Profit after tax latest quarter'), p1 = f('Profit after tax preceding quarter'), p2 = f('Net profit 2quarters back'), p3 = f('Net profit 3quarters back');
  const s0 = f('Sales latest quarter'), s1 = f('Sales preceding quarter'), s2 = f('Sales 2quarters back'), s3 = f('Sales 3quarters back');
  const accelOf = (g1: number, g2: number, g3: number) => { let a = 0.3; if (!isNaN(g1) && g1 > 0) a += 0.3; if (!isNaN(g1) && !isNaN(g2) && g1 >= g2) a += 0.25; if (!isNaN(g2) && !isNaN(g3) && g2 >= g3) a += 0.15; return c01(a); };
  const pAcc = accelOf(qoq(p0, p1), qoq(p1, p2), qoq(p2, p3));
  const sAcc = accelOf(qoq(s0, s1), qoq(s1, s2), qoq(s2, s3));
  const accel = 0.65 * pAcc + 0.35 * sAcc;
  const decel = (qoq(p0, p1) < qoq(p1, p2)) && (qoq(p1, p2) < qoq(p2, p3));
  const om0 = f('OPM latest quarter'), om1 = f('OPM preceding quarter'), omLY = f('OPM last year'), om5 = f('OPM 5Year');
  let margin = 0.4; if (!isNaN(om0) && !isNaN(om1) && om0 > om1) margin += 0.2; if (!isNaN(om0) && !isNaN(omLY) && om0 > omLY) margin += 0.2; if (!isNaN(om0) && !isNaN(om5) && om0 > om5) margin += 0.2;
  const marginCompression = (!isNaN(om0) && !isNaN(om1) && om0 < om1 && !isNaN(omLY) && om0 < omLY);
  if (marginCompression) margin -= 0.2; margin = c01(margin);
  const peg = f('PEG Ratio'), pe = f('Price to Earning'), pe5 = f('Historical PE 5Years'), ipe = f('Industry PE');
  let pegS; if (isNaN(peg) || (pe <= 0)) pegS = 0.4; else if (peg <= 0) pegS = 0.35; else if (peg < 1) pegS = 1; else if (peg < 1.5) pegS = 0.8; else if (peg < 2) pegS = 0.55; else if (peg < 3) pegS = 0.3; else pegS = 0.1;
  let peVs5 = 0.5; if (!isNaN(pe) && pe > 0 && !isNaN(pe5) && pe5 > 0) peVs5 = c01(1.0 - (pe / pe5 - 0.8) / 1.0);
  let peVsInd = 0.5; if (!isNaN(pe) && pe > 0 && !isNaN(ipe) && ipe > 0) peVsInd = pe < ipe ? 0.8 : 0.4;
  const multiple = 0.5 * pegS + 0.35 * peVs5 + 0.15 * peVsInd;
  const price = f('Current Price'), d50 = f('DMA 50'), d200 = f('DMA 200'), fromHi = f('From 52w high'), r1y = f('Return over 1year');
  let stage; if (!isNaN(price) && !isNaN(d200) && price < d200) stage = 0.15;
  else { stage = 0.3; if (!isNaN(price) && !isNaN(d200) && price > d200) stage += 0.25; if (!isNaN(price) && !isNaN(d50) && price > d50) stage += 0.1; if (!isNaN(d50) && !isNaN(d200) && d50 > d200) stage += 0.15; if (!isNaN(fromHi) && fromHi < 25) stage += 0.1; if (!isNaN(fromHi) && fromHi < 10) stage += 0.1; if (!isNaN(r1y) && r1y > 0) stage += 0.05; }
  stage = c01(stage);
  const stage2 = stage >= 0.6, stage4 = (!isNaN(price) && !isNaN(d200) && price < d200);
  const cfo = f('CFO to PAT'), roce = f('Return on capital employed'), de = f('Debt to equity'), ic = f('Interest Coverage Ratio');
  let cfoS; if (isNaN(cfo)) cfoS = 0.5; else if (cfo >= 1) cfoS = 1; else if (cfo >= 0.8) cfoS = 0.8; else if (cfo >= 0.6) cfoS = 0.5; else cfoS = 0.2;
  const roceS = isNaN(roce) ? 0.3 : c01(roce / 30);
  let deS; if (isNaN(de)) deS = 0.6; else if (de <= 0.3) deS = 1; else if (de <= 0.5) deS = 0.85; else if (de <= 1) deS = 0.6; else if (de <= 2) deS = 0.3; else deS = 0.1;
  const quality = 0.4 * cfoS + 0.35 * roceS + 0.25 * deS;
  const prom = f('Promoter holding'), dProm = f('Change in promoter holding 3Years'), dFII = f('Change in FII holding 3Years'), dDII = f('Change in DII holding 3Years'), pledge = f('Pledged percentage');
  let promS = prom >= 50 ? 1 : prom >= 35 ? 0.7 : prom >= 20 ? 0.5 : 0.3; if (isNaN(prom)) promS = 0.4;
  const flowS = (dFII > 0 ? 0.5 : 0) + (dDII > 0 ? 0.3 : 0) + (dProm > 0 ? 0.2 : 0);
  let sponsor = c01(0.55 * promS + 0.45 * c01(flowS));
  if (!isNaN(pledge) && pledge > 10) sponsor *= 0.6; if (!isNaN(pledge) && pledge > 25) sponsor *= 0.5;

  let composite = 100 * (0.20 * trigger + 0.18 * accel + 0.14 * margin + 0.18 * multiple + 0.12 * stage + 0.10 * quality + 0.08 * sponsor);
  const flags: string[] = [];
  if (!isNaN(cfo) && cfo < 0.6) { flags.push('CFO/PAT<0.6 earnings quality'); composite *= 0.7; }
  if (!isNaN(pledge) && pledge > 25) { flags.push('High pledge'); composite *= 0.6; }
  if (!isNaN(de) && de > 2 && !isNaN(ic) && ic < 1.5) { flags.push('Leveraged + low int-cover'); composite *= 0.7; }
  if (!isNaN(peg) && peg > 3 && pe > 0) flags.push('PEG>3 compression risk');
  if (marginCompression) flags.push('Margin compressing');
  if (!isNaN(qp) && qp >= 20 && decel) flags.push('Growth decelerating');

  const premium = multiple < 0.4, discount = multiple >= 0.6;
  const vetoFlag = flags.some((x) => /quality|pledge|Leveraged/i.test(x));
  let scenario;
  if (!isNaN(qp) && qp >= 40 && accel >= 0.65 && margin >= 0.6 && multiple >= 0.62 && stage2 && !vetoFlag) scenario = 'A';
  else if (premium && (decel || (!isNaN(qp) && qp < 15))) scenario = 'C';
  else if (stage4 && (isNaN(qp) || qp < 10) && quality < 0.5) scenario = 'E';
  else if (discount && !stage4 && quality >= 0.45 && (isNaN(qp) || qp < 25)) scenario = 'D';
  else scenario = 'B';

  composite = Math.round(c01(composite / 100) * 100);
  return {
    name: (d['Name'] || d['NSE Code'] || '').trim(), nse: (d['NSE Code'] || '').trim(), industry: (d['Industry'] || '').trim(),
    mcap: f('Market Capitalization'), price,
    composite, scenario, subs: { trigger, accel, margin, multiple, stage, quality, sponsor }, flags,
    qp, qs, peg, pe, om0, om1, roce, cfo, prom, pledge, stage2, stage4,
  };
}

const SCEN: Record<string, { c: string; label: string; tip: string }> = {
  A: { c: C.green, label: 'A · Multibagger setup', tip: 'Beat + accelerating + margin expanding + PE at discount + Stage-2. Highest-probability multibagger. Buy full size, hold 18–36m.' },
  B: { c: C.blue, label: 'B · Hold / watch', tip: 'Beat with steady growth or premium multiple. Hold if owned; do not chase. Needs acceleration or a cheaper entry.' },
  C: { c: C.amber, label: 'C · Trim / sell', tip: 'Decelerating growth at a premium multiple. The market compresses the multiple to the new growth rate. Trim.' },
  D: { c: C.cyan, label: 'D · Pullback watch', tip: 'Soft quarter but trend intact + multiple compressed + quality sound. A potential pullback buy in a compounder.' },
  E: { c: C.red, label: 'E · Avoid', tip: 'Weak quarter + Stage-4 downtrend + poor quality. Capitulation zone. Avoid / exit.' },
};

const VARS: { k: keyof Scored['subs']; label: string; color: string }[] = [
  { k: 'trigger', label: 'Trigger', color: C.green }, { k: 'accel', label: 'Accel', color: C.teal }, { k: 'margin', label: 'Margin', color: C.cyan },
  { k: 'multiple', label: 'Multiple', color: C.violet }, { k: 'stage', label: 'Stage', color: C.blue }, { k: 'quality', label: 'Quality', color: C.gold }, { k: 'sponsor', label: 'Sponsor', color: C.amber },
];
const band = (r: number) => (r >= 0.66 ? C.green : r >= 0.45 ? C.amber : C.red);
const fmtCr = (n: number) => isNaN(n) ? '—' : n >= 100000 ? (n / 100000).toFixed(1) + 'L Cr' : Math.round(n).toLocaleString('en-IN') + ' Cr';

const SAMPLE = 'Name, NSE Code, YOY Quarterly profit growth, YOY Quarterly sales growth, PEG Ratio, Price to Earning, Historical PE 5Years, OPM latest quarter, OPM preceding quarter, Profit after tax latest quarter … (a standard Screener.in export — all 62 columns supported)';

export default function EarningsTriggerPage({ scope: scopeProp = '' }: { scope?: string }) {
  let scope = scopeProp;
  if (!scope && typeof window !== 'undefined') { try { const qp = new URLSearchParams(window.location.search).get('scope'); if (qp === 'watchlist' || qp === 'portfolio') scope = qp; } catch {} }
  const KEY = scope ? 'mc:earnings-trigger:' + scope + ':data:v1' : 'mc:earnings-trigger:data:v1';
  const NKEY = scope ? 'mc:earnings-trigger:' + scope + ':name:v1' : 'mc:earnings-trigger:name:v1';

  const [data, setData] = useState<Row[]>([]);
  const [fname, setFname] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [scenFilter, setScenFilter] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [minScore, setMinScore] = useState(0);

  useEffect(() => { try { const raw = localStorage.getItem(KEY); if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) setData(p); } const nm = localStorage.getItem(NKEY); if (nm) setFname(nm); } catch {} }, []);

  const persist = (rows: Row[], name: string) => { try { localStorage.setItem(KEY, JSON.stringify(rows)); localStorage.setItem(NKEY, name); } catch (e) { setError("Couldn't save — the list is too large for browser storage. Try a smaller export."); } };

  const handleText = useCallback((text: string, name: string) => {
    try { const incoming = toObjects(parseCSV(text)); if (!incoming.length) { setError('No data rows found in that CSV.'); return; }
      if (!('YOY Quarterly profit growth' in incoming[0]) && !('Profit after tax latest quarter' in incoming[0])) { setError('This does not look like a Screener.in export — the earnings columns are missing. Export with the standard fields.'); return; }
      setData(incoming); setFname(name); persist(incoming, name); setError('');
    } catch (e: any) { setError('Could not parse that CSV: ' + (e?.message || e)); }
  }, [KEY, NKEY]);

  const onFile = useCallback((files?: FileList | File[] | null) => { if (!files) return; const arr = Array.from(files as any) as File[]; const f = arr[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => handleText(String(ev.target?.result || ''), f.name); r.readAsText(f); }, [handleText]);
  const clearAll = () => { setData([]); setFname(''); try { localStorage.removeItem(KEY); localStorage.removeItem(NKEY); } catch {} };

  const scored = useMemo(() => data.map(scoreRow).filter((s) => s.name).sort((a, b) => b.composite - a.composite), [data]);
  const counts = useMemo(() => { const m: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 }; scored.forEach((s) => m[s.scenario]++); return m; }, [scored]);
  const shown = useMemo(() => scored.filter((s) => (scenFilter === 'ALL' || s.scenario === scenFilter) && s.composite >= minScore && (!q || (s.name + ' ' + s.nse + ' ' + s.industry).toLowerCase().includes(q.toLowerCase()))), [scored, scenFilter, minScore, q]);

  const wrap = { maxWidth: 2100, margin: '0 auto', padding: '0 16px' } as const;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.txt, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: `${C.bg}f0`, borderBottom: `1px solid ${C.line}`, backdropFilter: 'blur(8px)' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 16px' }}>
          <Link href="/" style={{ fontSize: F.sm, color: C.muted, textDecoration: 'none', fontWeight: 700 }}>← Home</Link>
          <span style={{ fontSize: F.md, fontWeight: 900, color: C.gold, letterSpacing: 0.4 }}>⚡ EARNINGS-TRIGGER ANALYZER{scope ? ' · ' + scope.toUpperCase() : ''}</span>
          {fname ? <span style={{ fontSize: F.xs, color: C.dim }}>· {fname} · {scored.length} stocks</span> : null}
          <Link href="/investing-os#styles" style={{ marginLeft: 'auto', fontSize: F.xs, color: C.muted, textDecoration: 'none', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Investing OS →</Link>
        </div>
      </div>

      <div style={{ ...wrap, padding: '20px 16px 80px' }}>
        <div style={{ fontSize: F.xs, fontWeight: 800, color: C.gold, letterSpacing: 1.2, textTransform: 'uppercase' }}>Why some Q-beats become multibaggers and other beats get punished</div>
        <div style={{ fontSize: F.hero, fontWeight: 900, marginTop: 6, lineHeight: 1.1 }}>Earnings-Trigger Analyzer</div>
        <div style={{ fontSize: F.base, color: C.muted, lineHeight: 1.6, marginTop: 10, maxWidth: 1000 }}>
          After results, export your watchlist from Screener.in and drop the CSV below. The engine scores every stock on the institutional earnings-trigger framework and ranks the real setups. A beat alone is not a buy — what converts it is <b style={{ color: C.txt }}>acceleration × margin trajectory × PE-cycle position × chart stage × earnings quality × sponsorship</b>, classified into the five post-earnings scenarios.
        </div>

        {/* upload zone */}
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files); }}
          style={{ marginTop: 18, border: `2px dashed ${dragging ? C.gold : C.line2}`, background: dragging ? `${C.gold}10` : C.panel2, borderRadius: 14, padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.txt }}>{data.length ? `Loaded ${data.length} stocks${fname ? ' — ' + fname : ''}` : 'Drop your Screener.in CSV here'}</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{SAMPLE}</div>
          </div>
          <label style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, color: '#05231a', background: C.gold, borderRadius: 8, padding: '9px 16px' }}>
            Choose CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files)} />
          </label>
          {data.length ? <button onClick={clearAll} style={{ cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '6px 12px' }}>Clear</button> : null}
        </div>
        {error ? <div style={{ marginTop: 10, fontSize: F.sm, color: C.red, background: `${C.red}12`, border: `1px solid ${C.red}40`, borderRadius: 8, padding: '8px 12px' }}>{error}</div> : null}

        {!data.length ? (
          <div style={{ marginTop: 22, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: F.lg, fontWeight: 800, marginBottom: 10 }}>The seven variables it scores</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              {[
                ['Trigger (O’Neil C)', 'YoY quarterly PAT & sales growth — the ≥25% floor, ≥40% preferred; sales must back the profit (no cost-cut beats).'],
                ['Acceleration', 'Sequential QoQ trend of PAT & sales — 3 quarters of acceleration (Minervini). Deceleration is flagged (the Bajaj Finance trap).'],
                ['Margin trajectory', 'OPM latest vs preceding vs last-year vs 5-yr — expansion re-rates; compression on a revenue beat is punished.'],
                ['Multiple cycle (PEG)', 'PEG band + PE vs its 5-yr median + vs industry. Discount = re-rating room; PEG>2 = compression default (the HUL trap).'],
                ['Chart stage', 'Stage-2 = price above 50/200-DMA with 50>200, near 52-wk high. Below the 200-DMA (Stage-4) is penalised.'],
                ['Earnings quality', 'CFO/PAT (Buffett: <0.6 is a sell), ROCE, debt/equity, interest cover. Cash flow is fact; profit is opinion.'],
                ['Sponsorship', 'Promoter holding (>50%), pledge (penalised), and FII/DII accumulation over 3 years.'],
              ].map(([t, d], i) => (
                <div key={i} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: F.sm, fontWeight: 800, color: C.teal, marginBottom: 4 }}>{t}</div>
                  <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5 }}>{d}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: F.xs, color: C.dim, marginTop: 12, lineHeight: 1.55 }}>Two of the masterclass’s seven variables — <b style={{ color: C.muted }}>guidance language</b> and <b style={{ color: C.muted }}>sector flow</b> — can’t be read from a numbers export; apply the Concall Framework for those. This tool does the quantitative 5 of 7 and ranks accordingly.</div>
          </div>
        ) : (
          <>
            {/* scenario summary + filters */}
            <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => setScenFilter('ALL')} style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, padding: '6px 12px', borderRadius: 999, border: `1px solid ${scenFilter === 'ALL' ? C.txt : C.line2}`, background: scenFilter === 'ALL' ? C.panel : 'transparent', color: scenFilter === 'ALL' ? C.txt : C.muted }}>All {scored.length}</button>
              {(['A', 'B', 'C', 'D', 'E'] as const).map((k) => (
                <button key={k} onClick={() => setScenFilter(k)} style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, padding: '6px 12px', borderRadius: 999, border: `1px solid ${scenFilter === k ? SCEN[k].c : C.line2}`, background: scenFilter === k ? `${SCEN[k].c}1f` : 'transparent', color: scenFilter === k ? SCEN[k].c : C.muted }} title={SCEN[k].tip}>{SCEN[k].label} · {counts[k]}</button>
              ))}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / sector…" style={{ marginLeft: 'auto', fontSize: F.sm, background: C.panel2, border: `1px solid ${C.line2}`, color: C.txt, borderRadius: 8, padding: '7px 12px', minWidth: 200 }} />
              <label style={{ fontSize: F.xs, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>min score {minScore}<input type="range" min={0} max={90} value={minScore} onChange={(e) => setMinScore(+e.target.value)} /></label>
            </div>

            {/* leaderboard */}
            <div style={{ marginTop: 12, overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 12 }}>
              <div style={{ minWidth: 1280 }}>
                <div style={{ display: 'flex', background: C.panel2, borderBottom: `1px solid ${C.line2}`, fontSize: F.xs, fontWeight: 800, color: C.muted, position: 'sticky', top: 0 }}>
                  <div style={{ width: 44, padding: '10px 8px' }}>#</div>
                  <div style={{ flex: '0 0 220px', padding: '10px 8px' }}>Stock</div>
                  <div style={{ flex: '0 0 150px', padding: '10px 8px' }}>Scenario</div>
                  <div style={{ flex: '0 0 110px', padding: '10px 8px' }}>Score</div>
                  <div style={{ flex: '0 0 250px', padding: '10px 8px' }}>7-variable breakdown</div>
                  <div style={{ flex: '0 0 80px', padding: '10px 8px', textAlign: 'right' }}>YoY PAT</div>
                  <div style={{ flex: '0 0 80px', padding: '10px 8px', textAlign: 'right' }}>YoY Sales</div>
                  <div style={{ flex: '0 0 64px', padding: '10px 8px', textAlign: 'right' }}>PEG</div>
                  <div style={{ flex: '0 0 92px', padding: '10px 8px', textAlign: 'right' }}>OPM q-1→q</div>
                  <div style={{ flex: '0 0 70px', padding: '10px 8px', textAlign: 'right' }}>CFO/PAT</div>
                  <div style={{ flex: '0 0 64px', padding: '10px 8px', textAlign: 'right' }}>ROCE</div>
                  <div style={{ flex: '1 1 200px', padding: '10px 8px' }}>Flags</div>
                </div>
                {shown.map((s, i) => (
                  <div key={s.nse + i} style={{ display: 'flex', borderBottom: i < shown.length - 1 ? `1px solid ${C.line}` : 'none', background: i % 2 ? C.panel2 : 'transparent', alignItems: 'center' }}>
                    <div style={{ width: 44, padding: '9px 8px', fontSize: F.sm, fontWeight: 800, color: C.dim }}>{i + 1}</div>
                    <div style={{ flex: '0 0 220px', padding: '9px 8px' }}>
                      <div style={{ fontSize: F.sm, fontWeight: 800, color: C.txt }}>{s.name}</div>
                      <div style={{ fontSize: F.xs, color: C.dim }}>{s.nse} · {s.industry} · {fmtCr(s.mcap)}</div>
                    </div>
                    <div style={{ flex: '0 0 150px', padding: '9px 8px' }}><span title={SCEN[s.scenario].tip} style={{ fontSize: F.xs, fontWeight: 800, color: SCEN[s.scenario].c, border: `1px solid ${SCEN[s.scenario].c}66`, background: `${SCEN[s.scenario].c}14`, borderRadius: 6, padding: '2px 7px' }}>{SCEN[s.scenario].label}</span></div>
                    <div style={{ flex: '0 0 110px', padding: '9px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: F.md, fontWeight: 900, color: band(s.composite / 100), minWidth: 26 }}>{s.composite}</span>
                      <div style={{ flex: 1, height: 7, background: C.panel, borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.line}` }}><div style={{ width: `${s.composite}%`, height: '100%', background: band(s.composite / 100) }} /></div>
                    </div>
                    <div style={{ flex: '0 0 250px', padding: '9px 8px', display: 'flex', gap: 4 }}>
                      {VARS.map((v) => { const val = s.subs[v.k]; return (
                        <div key={v.k} title={`${v.label}: ${Math.round(val * 100)}`} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ height: 26, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}><div style={{ width: 12, height: `${Math.max(8, val * 26)}px`, background: v.color, opacity: 0.4 + val * 0.6, borderRadius: 2 }} /></div>
                          <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{v.label.slice(0, 4)}</div>
                        </div>
                      ); })}
                    </div>
                    <div style={{ flex: '0 0 80px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.qp) ? C.dim : s.qp >= 25 ? C.green : C.txt }}>{isNaN(s.qp) ? '—' : s.qp.toFixed(0) + '%'}</div>
                    <div style={{ flex: '0 0 80px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: C.muted }}>{isNaN(s.qs) ? '—' : s.qs.toFixed(0) + '%'}</div>
                    <div style={{ flex: '0 0 64px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.peg) ? C.dim : (s.peg > 0 && s.peg < 1.5) ? C.green : s.peg >= 2 ? C.red : C.muted }}>{isNaN(s.peg) ? '—' : s.peg.toFixed(2)}</div>
                    <div style={{ flex: '0 0 92px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: (!isNaN(s.om0) && !isNaN(s.om1)) ? (s.om0 > s.om1 ? C.green : s.om0 < s.om1 ? C.red : C.muted) : C.dim }}>{isNaN(s.om1) ? '—' : s.om1.toFixed(0)}→{isNaN(s.om0) ? '—' : s.om0.toFixed(0)}</div>
                    <div style={{ flex: '0 0 70px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.cfo) ? C.dim : s.cfo >= 0.8 ? C.green : s.cfo < 0.6 ? C.red : C.amber }}>{isNaN(s.cfo) ? '—' : s.cfo.toFixed(2)}</div>
                    <div style={{ flex: '0 0 64px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.roce) ? C.dim : s.roce >= 15 ? C.green : C.muted }}>{isNaN(s.roce) ? '—' : s.roce.toFixed(0) + '%'}</div>
                    <div style={{ flex: '1 1 200px', padding: '9px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>{s.flags.map((fl, j) => <span key={j} style={{ fontSize: 10, color: C.red, border: `1px solid ${C.red}40`, background: `${C.red}10`, borderRadius: 5, padding: '1px 5px' }}>{fl}</span>)}{!s.flags.length ? <span style={{ fontSize: 10, color: C.dim }}>—</span> : null}</div>
                  </div>
                ))}
                {!shown.length ? <div style={{ padding: 20, fontSize: F.sm, color: C.muted, textAlign: 'center' }}>No stocks match the current filter.</div> : null}
              </div>
            </div>
            <div style={{ marginTop: 14, fontSize: F.xs, color: C.dim, lineHeight: 1.6 }}>
              Ranking is a quantitative screen of 5 of the masterclass’s 7 variables — it tells you WHERE to do the work, not what to buy. Confirm guidance language + sector flow via the concall, and remember: never buy a new position on result day, never hold past two disappointing quarters. Not investment advice; figures are as per your uploaded sheet.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
