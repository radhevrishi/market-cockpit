'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PATCH zzz114 + zzz115 — News Triage Master Playbook (expanded v2)
// Now with 40+ historical examples + India/US pattern libraries +
// macro patterns + earnings playbook + pre-mortem checklist.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';

const C = {
  bg:    '#0B0E14',
  panel: '#11151F',
  panel2:'#161B27',
  border:'#1F2937',
  text:  '#E5E7EB',
  text2: '#94A3B8',
  text3: '#64748B',
  green: '#22C55E',
  red:   '#EF4444',
  amber: '#F59E0B',
  cyan:  '#06B6D4',
  purple:'#8B5CF6',
  gold:  '#FBBF24',
  india: '#FF6B35',
};

const Tag = ({ kind, children }: { kind: 'long'|'short'|'sector'|'ignore'|'high'|'med'|'low'; children?: React.ReactNode }) => {
  const map: any = {
    long:   { bg: C.green + '22',  fg: C.green,  label: 'LONG-TERM BUY' },
    short:  { bg: C.cyan + '22',   fg: C.cyan,   label: 'SHORT TRADE' },
    sector: { bg: C.purple + '22', fg: C.purple, label: 'SECTOR PLAY' },
    ignore: { bg: C.red + '22',    fg: C.red,    label: 'IGNORE' },
    high:   { bg: C.green + '22',  fg: C.green,  label: 'HIGH' },
    med:    { bg: C.amber + '22',  fg: C.amber,  label: 'MED' },
    low:    { bg: C.red + '22',    fg: C.red,    label: 'LOW' },
  };
  const s = map[kind] || map.ignore;
  return (
    <span style={{
      display: 'inline-block', padding: '4px 12px', borderRadius: 6,
      background: s.bg, color: s.fg, fontSize: 14, fontWeight: 800,
      letterSpacing: '0.4px', marginRight: 8,
    }}>{children || s.label}</span>
  );
};

// ── PATCH zzz116 — Interactive Score Calculator ─────────────────────────────
// Auto-computes Magnitude from deal $ + market cap. Other 4 dims via dropdown.
// User can manually override every score.
function ScoreCalculator() {
  const [dealVal, setDealVal] = React.useState<string>('');
  const [dealUnit, setDealUnit] = React.useState<'M'|'B'|'Cr'|'KCr'>('B');
  const [mcapVal, setMcapVal] = React.useState<string>('');
  const [mcapUnit, setMcapUnit] = React.useState<'M'|'B'|'Cr'|'KCr'>('B');

  // Convert to common USD for ratio. 1 Cr ≈ 0.12M USD; 1 KCr ≈ 120M USD.
  const toUsdMillions = (v: number, u: string): number => {
    if (u === 'B') return v * 1000;
    if (u === 'M') return v;
    if (u === 'Cr') return v * 0.12;       // 1 Cr ≈ $120K = 0.12M (approx 83 INR/USD)
    if (u === 'KCr') return v * 120;       // 1,000 Cr ≈ $120M
    return v;
  };

  // Auto-Magnitude from %
  const autoM = (() => {
    const d = parseFloat(dealVal);
    const m = parseFloat(mcapVal);
    if (isNaN(d) || isNaN(m) || d <= 0 || m <= 0) return null;
    const dUsd = toUsdMillions(d, dealUnit);
    const mUsd = toUsdMillions(m, mcapUnit);
    const pct = (dUsd / mUsd) * 100;
    if (pct >= 30) return { score: 5, pct };
    if (pct >= 10) return { score: 4, pct };
    if (pct >= 5)  return { score: 3, pct };
    if (pct >= 1)  return { score: 2, pct };
    return { score: 1, pct };
  })();

  // Manual overrides
  const [mOverride, setMOverride] = React.useState<number|null>(null);
  const M = mOverride ?? autoM?.score ?? 0;

  // P / V / S / V — dropdown-driven, with override
  const [P, setP] = React.useState<number>(0);
  const [V, setV] = React.useState<number>(0);
  const [S, setS] = React.useState<number>(0);
  const [Vf, setVf] = React.useState<number>(0);

  const total = M + P + V + S + Vf;
  const filled = !!autoM && P > 0 && V > 0 && S > 0 && Vf > 0;

  const verdict = (() => {
    if (!filled) return { label: 'Complete all 5 dimensions →', color: '#94A3B8', detail: '' };
    if (total >= 22) return { label: '⭐ TOP-CONVICTION LONG', color: '#22C55E', detail: 'Size up. Hold years. Add on dips.' };
    if (total >= 18) return { label: '✅ LONG-TERM BUY', color: '#22C55E', detail: 'Normal sizing. Hold 6-24 months.' };
    if (total >= 15) return { label: '⚡ SHORT-TERM TRADE', color: '#06B6D4', detail: 'Starter position or 1-12 week trade.' };
    if (total >= 10) return { label: '👁 WATCH', color: '#F59E0B', detail: 'Track but do not trade.' };
    return { label: '🚫 IGNORE', color: '#EF4444', detail: 'Noise. Do not act.' };
  })();

  const F = { num: 17, label: 13, big: 56, hint: 13 };
  const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '140px 1fr 90px', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1F2937' };
  const labelStyle: React.CSSProperties = { fontSize: F.label, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.4px' };
  const inputStyle: React.CSSProperties = { background: '#0B0E14', border: '1px solid #1F2937', borderRadius: 6, padding: '8px 12px', color: '#E5E7EB', fontSize: F.num, width: '100%', boxSizing: 'border-box' };
  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };
  const scoreBox = (n: number): React.CSSProperties => ({
    background: n === 0 ? '#161B27' : n >= 4 ? 'rgba(34,197,94,0.15)' : n >= 3 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
    color: n === 0 ? '#64748B' : n >= 4 ? '#22C55E' : n >= 3 ? '#F59E0B' : '#EF4444',
    border: '1px solid #1F2937', borderRadius: 6, padding: '8px 0', textAlign: 'center',
    fontSize: 22, fontWeight: 800, letterSpacing: '0.5px',
  });

  return (
    <div style={{ background: '#11151F', border: '1px solid #1F2937', borderRadius: 12, padding: '28px 32px', margin: '24px 0' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800, color: '#fff' }}>🧮 Live Score Calculator</h3>
      <p style={{ margin: '0 0 16px', fontSize: 15, color: '#94A3B8' }}>
        Enter what you know. Override anything. Score updates live.
      </p>

      {/* Magnitude — auto from deal $ + mcap $ */}
      <div style={rowStyle}>
        <div style={labelStyle}>Magnitude</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 18px 1fr 70px', gap: 8, alignItems: 'center' }}>
          <input type="number" placeholder="Deal size" value={dealVal} onChange={(e) => { setDealVal(e.target.value); setMOverride(null); }} style={inputStyle}/>
          <select value={dealUnit} onChange={(e) => setDealUnit(e.target.value as any)} style={selectStyle}>
            <option value="M">$M</option>
            <option value="B">$B</option>
            <option value="Cr">₹Cr</option>
            <option value="KCr">₹KCr</option>
          </select>
          <span style={{ textAlign: 'center', color: '#64748B', fontSize: 15 }}>÷</span>
          <input type="number" placeholder="Market cap" value={mcapVal} onChange={(e) => { setMcapVal(e.target.value); setMOverride(null); }} style={inputStyle}/>
          <select value={mcapUnit} onChange={(e) => setMcapUnit(e.target.value as any)} style={selectStyle}>
            <option value="M">$M</option>
            <option value="B">$B</option>
            <option value="Cr">₹Cr</option>
            <option value="KCr">₹KCr</option>
          </select>
        </div>
        <div style={scoreBox(M)}>{M || '?'}</div>
      </div>
      {autoM && (
        <div style={{ fontSize: F.hint, color: '#64748B', padding: '4px 0 8px 152px' }}>
          = <b style={{ color: '#06B6D4' }}>{autoM.pct.toFixed(1)}%</b> of mcap →
          {autoM.pct >= 30 ? ' massive (5/5)' : autoM.pct >= 10 ? ' large (4/5)' : autoM.pct >= 5 ? ' material (3/5)' : autoM.pct >= 1 ? ' small (2/5)' : ' negligible (1/5)'}
          <button onClick={() => setMOverride(mOverride === null ? M : null)} style={{ marginLeft: 14, background: 'none', border: '1px solid #1F2937', borderRadius: 4, padding: '2px 8px', color: '#94A3B8', fontSize: 11, cursor: 'pointer' }}>
            {mOverride === null ? 'Override' : `Override: ${mOverride}/5 ✓`}
          </button>
          {mOverride !== null && (
            <>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setMOverride(n)} style={{ marginLeft: 4, background: mOverride === n ? '#06B6D4' : 'none', border: '1px solid #1F2937', borderRadius: 4, padding: '2px 7px', color: mOverride === n ? '#000' : '#94A3B8', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>{n}</button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Permanence */}
      <div style={rowStyle}>
        <div style={labelStyle}>Permanence</div>
        <select value={P} onChange={(e) => setP(parseInt(e.target.value))} style={selectStyle}>
          <option value={0}>Select…</option>
          <option value={5}>5 · Multi-year contract / structural moat / TAM raise</option>
          <option value={4}>4 · 1-2 year clear benefit / acquisition / regulatory clearance</option>
          <option value={3}>3 · Single fiscal year impact / new product launch</option>
          <option value={2}>2 · Single quarter beat / one-time gain</option>
          <option value={1}>1 · One-off PR / partnership / cosmetic</option>
        </select>
        <div style={scoreBox(P)}>{P || '?'}</div>
      </div>

      {/* Velocity */}
      <div style={rowStyle}>
        <div style={labelStyle}>Velocity</div>
        <select value={V} onChange={(e) => setV(parseInt(e.target.value))} style={selectStyle}>
          <option value={0}>Select…</option>
          <option value={5}>5 · Already in current quarter results</option>
          <option value={4}>4 · Will show within next 1-2 quarters</option>
          <option value={3}>3 · Within 12 months</option>
          <option value={2}>2 · 1-3 years out</option>
          <option value={1}>1 · 3+ years / research-stage</option>
        </select>
        <div style={scoreBox(V)}>{V || '?'}</div>
      </div>

      {/* Surprise */}
      <div style={rowStyle}>
        <div style={labelStyle}>Surprise</div>
        <select value={S} onChange={(e) => setS(parseInt(e.target.value))} style={selectStyle}>
          <option value={0}>Select…</option>
          <option value={5}>5 · Totally unexpected / no leaks / shocked the street</option>
          <option value={4}>4 · Larger than consensus expected</option>
          <option value={3}>3 · Roughly in line with expectations</option>
          <option value={2}>2 · Mostly priced in already</option>
          <option value={1}>1 · Fully anticipated / sell-side already raised TP</option>
        </select>
        <div style={scoreBox(S)}>{S || '?'}</div>
      </div>

      {/* Verifiability */}
      <div style={rowStyle}>
        <div style={labelStyle}>Verifiability</div>
        <select value={Vf} onChange={(e) => setVf(parseInt(e.target.value))} style={selectStyle}>
          <option value={0}>Select…</option>
          <option value={5}>5 · SEC/SEBI filing / signed press release / earnings transcript</option>
          <option value={4}>4 · Bloomberg / Reuters / Mint with named source</option>
          <option value={3}>3 · CNBC / Business Standard / reputable trade press</option>
          <option value={2}>2 · &quot;Reportedly&quot; / Twitter scoop / Discord leak</option>
          <option value={1}>1 · Pure rumor / chat board / 4chan</option>
        </select>
        <div style={scoreBox(Vf)}>{Vf || '?'}</div>
      </div>

      {/* Total + Verdict */}
      <div style={{
        marginTop: 22, padding: '24px 28px', borderRadius: 12,
        background: filled ? `linear-gradient(135deg, ${verdict.color}22 0%, ${verdict.color}11 100%)` : '#161B27',
        border: `2px solid ${verdict.color}55`,
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 24, alignItems: 'center',
      }}>
        <div style={{ fontSize: F.big, fontWeight: 800, color: verdict.color, lineHeight: 1, fontFamily: 'ui-monospace, SFMono-Regular, monospace', minWidth: 100, textAlign: 'center' }}>
          {total || 0}<span style={{ fontSize: 22, color: '#64748B' }}>/25</span>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: verdict.color, marginBottom: 4 }}>{verdict.label}</div>
          {verdict.detail && <div style={{ fontSize: 15, color: '#94A3B8' }}>{verdict.detail}</div>}
        </div>
        <button onClick={() => { setDealVal(''); setMcapVal(''); setP(0); setV(0); setS(0); setVf(0); setMOverride(null); }} style={{
          background: '#11151F', border: '1px solid #1F2937', borderRadius: 6, padding: '10px 16px',
          color: '#94A3B8', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>↻ Reset</button>
      </div>

      {/* Quick examples to load */}
      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, color: '#64748B', alignSelf: 'center', marginRight: 6 }}>Try a real example:</span>
        <button onClick={() => { setDealVal('100'); setDealUnit('B'); setMcapVal('120'); setMcapUnit('B'); setP(5); setV(3); setS(5); setVf(5); setMOverride(null); }}
          style={{ background: '#161B27', border: '1px solid #22C55E55', borderRadius: 5, padding: '6px 12px', color: '#22C55E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          MICRON $100B SCAs
        </button>
        <button onClick={() => { setDealVal('25'); setDealUnit('KCr'); setMcapVal('600'); setMcapUnit('KCr'); setP(5); setV(2); setS(4); setVf(5); setMOverride(null); }}
          style={{ background: '#161B27', border: '1px solid #22C55E55', borderRadius: 5, padding: '6px 12px', color: '#22C55E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          L&amp;T Bullet Train ₹25KCr
        </button>
        <button onClick={() => { setDealVal('7'); setDealUnit('B'); setMcapVal('30'); setMcapUnit('B'); setP(4); setV(4); setS(4); setVf(5); setMOverride(null); }}
          style={{ background: '#161B27', border: '1px solid #06B6D455', borderRadius: 5, padding: '6px 12px', color: '#06B6D4', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          onsemi/Synaptics $7B
        </button>
        <button onClick={() => { setDealVal('0.05'); setDealUnit('B'); setMcapVal('5'); setMcapUnit('B'); setP(1); setV(2); setS(2); setVf(5); setMOverride(null); }}
          style={{ background: '#161B27', border: '1px solid #EF444455', borderRadius: 5, padding: '6px 12px', color: '#EF4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Carter&apos;s WNBA Partnership
        </button>
        {/* PATCH zzz117 — user&apos;s personal high-conviction examples */}
        <button onClick={() => { setDealVal('17.4'); setDealUnit('B'); setMcapVal('15'); setMcapUnit('B'); setP(5); setV(3); setS(5); setVf(5); setMOverride(null); }}
          title="Nebius Group landed Microsoft $17.4B AI infra deal Sept 2025; mcap ~$15B at announcement → deal larger than entire mcap"
          style={{ background: '#161B27', border: '1px solid #FBBF2455', borderRadius: 5, padding: '6px 12px', color: '#FBBF24', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          NBIS $17.4B MSFT deal
        </button>
        <button onClick={() => { setDealVal('3.4'); setDealUnit('B'); setMcapVal('1.5'); setMcapUnit('B'); setP(5); setV(2); setS(4); setVf(5); setMOverride(null); }}
          title="Centrus Energy DOE HALEU multi-year contract ~$3.4B total value; mcap ~$1.5B → deal more than 2× mcap"
          style={{ background: '#161B27', border: '1px solid #FBBF2455', borderRadius: 5, padding: '6px 12px', color: '#FBBF24', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          LEU HALEU multi-yr
        </button>
        <button onClick={() => { setDealVal('5'); setDealUnit('B'); setMcapVal('40'); setMcapUnit('B'); setP(5); setV(3); setS(4); setVf(5); setMOverride(null); }}
          title="Vistra Corp data center power supply contract with Microsoft; estimated multi-year deal value; mcap ~$40B at announcement"
          style={{ background: '#161B27', border: '1px solid #FBBF2455', borderRadius: 5, padding: '6px 12px', color: '#FBBF24', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          VST MSFT power deal
        </button>
        <button onClick={() => { setDealVal('3.7'); setDealUnit('B'); setMcapVal('2.5'); setMcapUnit('B'); setP(5); setV(2); setS(5); setVf(5); setMOverride(null); }}
          title="TeraWulf landed Google-backed HPC/AI hosting contract ~$3.7B over 10 years; mcap ~$2.5B at announcement → deal larger than mcap"
          style={{ background: '#161B27', border: '1px solid #FBBF2455', borderRadius: 5, padding: '6px 12px', color: '#FBBF24', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          WULF Google AI deal
        </button>
      </div>
    </div>
  );
}

export default function NewsTriagePage() {
  return (
    <div style={{
      maxWidth: 1280, margin: '0 auto', padding: '32px 36px 100px',
      color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      lineHeight: 1.65, fontSize: 17,
    }}>
      <style>{`
        h1 { font-size: 40px; font-weight: 800; margin: 0 0 6px; color: #fff; letter-spacing: -0.5px; line-height: 1.15; }
        h2 { font-size: 28px; font-weight: 700; margin: 42px 0 16px; color: #fff; letter-spacing: -0.3px; line-height: 1.25; }
        h3 { font-size: 20px; font-weight: 700; margin: 24px 0 10px; color: #E5E7EB; line-height: 1.3; }
        p  { margin: 10px 0; font-size: 17px; }
        ul { margin: 10px 0 12px 22px; padding: 0; }
        li { margin: 6px 0; font-size: 17px; }
        table { border-collapse: collapse; width: 100%; font-size: 16px; margin: 10px 0; }
        th, td { border: 1px solid ${C.border}; padding: 10px 12px; text-align: left; vertical-align: top; line-height: 1.5; }
        th { background: ${C.panel2}; color: #fff; font-weight: 700; font-size: 15px; }
        code { background: ${C.panel2}; padding: 2px 7px; border-radius: 4px; font-size: 15px; color: ${C.cyan}; }
        .panel  { background: ${C.panel}; border: 1px solid ${C.border}; border-radius: 10px; padding: 20px 22px; margin: 14px 0; }
        .longp  { background: rgba(34,197,94,0.05); border-left: 4px solid ${C.green}; }
        .shortp { background: rgba(6,182,212,0.05); border-left: 4px solid ${C.cyan}; }
        .sectp  { background: rgba(139,92,246,0.05); border-left: 4px solid ${C.purple}; }
        .ignp   { background: rgba(239,68,68,0.04); border-left: 4px solid ${C.red}; }
        .indp   { background: rgba(255,107,53,0.04); border-left: 4px solid ${C.india}; }
        .small  { font-size: 15px; color: ${C.text2}; }
        .grid5  { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin: 18px 0; }
        .dim    { background: ${C.panel2}; border: 1px solid ${C.border}; border-radius: 10px; padding: 18px; text-align: center; }
        .dim-n  { font-size: 42px; font-weight: 800; color: ${C.cyan}; line-height: 1; margin: 6px 0; }
        .dim-l  { font-size: 14px; color: ${C.text3}; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
        .dim-d  { font-size: 14px; color: ${C.text2}; margin-top: 8px; line-height: 1.45; }
        .return { display: inline-block; padding: 4px 12px; border-radius: 5px; background: ${C.green}22; color: ${C.green}; font-weight: 800; font-size: 14px; margin-left: 6px; }
        .loss   { display: inline-block; padding: 4px 12px; border-radius: 5px; background: ${C.red}22; color: ${C.red}; font-weight: 800; font-size: 14px; margin-left: 6px; }
        .toc-row { display: grid; grid-template-columns: 40px 1fr 110px; gap: 12px; padding: 8px 12px; border-bottom: 1px solid ${C.border}; font-size: 16px; }
      `}</style>

      <div style={{ marginBottom: 20, color: C.text3, fontSize: 14, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
        Market Cockpit · Decision Master · News Triage v2
      </div>
      <h1>📰 The News Triage Playbook</h1>
      <div style={{ marginBottom: 24, maxWidth: 980, fontSize: 18, lineHeight: 1.65, color: C.text2 }}>
        90% of financial news is noise. 10% can change a stock&apos;s 3-year trajectory. Job isn&apos;t to read everything —
        score every headline in 30 seconds, decide: <b style={{ color: C.text }}>Long-term buy · Short-term trade · Sector play · Ignore.</b>
        This playbook gives you the framework + 40+ real historical examples (US + India) so you can pattern-match next time.
      </div>

      {/* ── TOC ─────────────────────────────────────────────────────────── */}
      <div className="panel" style={{ background: C.panel2 }}>
        <h3 style={{ marginTop: 0 }}>📋 Contents</h3>
        <div className="toc-row"><span>1</span><span>The 5-Dimension Score (M·P·V·S·V)</span><span className="small">framework</span></div>
        <div className="toc-row"><span>2</span><span>30-Second Decision Tree</span><span className="small">flowchart</span></div>
        <div className="toc-row"><span>3</span><span>Keyword Cheat Sheet (HIGH / MED / LOW)</span><span className="small">scanning</span></div>
        <div className="toc-row"><span>4</span><span>20 Historical LONG-TERM BUY Examples (US + 🇮🇳)</span><span className="small">case studies</span></div>
        <div className="toc-row"><span>5</span><span>15 Historical SHORT TRADE Examples</span><span className="small">case studies</span></div>
        <div className="toc-row"><span>6</span><span>10 Historical SECTOR PLAY Examples</span><span className="small">case studies</span></div>
        <div className="toc-row"><span>7</span><span>10 Historical IGNORE / Trap Examples</span><span className="small">case studies</span></div>
        <div className="toc-row"><span>8</span><span>🇮🇳 India-Specific Patterns (RBI · SEBI · Budget · PLI)</span><span className="small">local</span></div>
        <div className="toc-row"><span>9</span><span>🇺🇸 US-Specific Patterns (Fed · FOMC · NFP · CPI)</span><span className="small">macro</span></div>
        <div className="toc-row"><span>10</span><span>Earnings News Sub-Playbook</span><span className="small">quarter cycle</span></div>
        <div className="toc-row"><span>11</span><span>Instrument Guide + Time Horizon Sheet</span><span className="small">execution</span></div>
        <div className="toc-row"><span>12</span><span>Pre-Mortem Check + 7 Traps + 30s Checklist</span><span className="small">discipline</span></div>
      </div>

      {/* ── 5-DIMENSION SCORING ─────────────────────────────────────────── */}
      <h2>1 · The 5-Dimension News Score</h2>
      <p className="small">Score every news item on these 5. Sum ≥ 15/25 = act. Below 15 = ignore.</p>
      <div className="grid5">
        <div className="dim">
          <div className="dim-l">Magnitude</div>
          <div className="dim-n">M</div>
          <div className="dim-d">Size of $ impact vs market cap. $1B deal on $500M mkt cap = 5/5. $50M deal on $500B mkt cap = 1/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Permanence</div>
          <div className="dim-n">P</div>
          <div className="dim-d">One-time vs structural. Multi-year contract = 5/5. Single quarter beat = 2/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Velocity</div>
          <div className="dim-n">V</div>
          <div className="dim-d">How fast it shows in P&amp;L. Already in this Q = 5/5. 2027+ impact = 1/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Surprise</div>
          <div className="dim-n">S</div>
          <div className="dim-d">Vs consensus. Totally unexpected = 5/5. Already priced in = 0/5.</div>
        </div>
        <div className="dim">
          <div className="dim-l">Verifiability</div>
          <div className="dim-n">V</div>
          <div className="dim-d">Confirmed filing/press release = 5/5. &quot;Reportedly&quot; or rumor = 2/5.</div>
        </div>
      </div>

      <h3>How to use the score</h3>
      <table>
        <tbody>
          <tr><th style={{ width: 100 }}>Score</th><th>Decision</th><th>Hold period</th></tr>
          <tr><td><b>22-25</b></td><td>Top-conviction LONG. Size up.</td><td>Years</td></tr>
          <tr><td><b>18-21</b></td><td>LONG add. Normal sizing.</td><td>6-24 months</td></tr>
          <tr><td><b>15-17</b></td><td>Short-term trade or starter position.</td><td>1-12 weeks</td></tr>
          <tr><td><b>10-14</b></td><td>Watch only. No trade.</td><td>—</td></tr>
          <tr><td><b>&lt; 10</b></td><td>IGNORE. Pure noise.</td><td>—</td></tr>
        </tbody>
      </table>

      {/* ── PATCH zzz116 — Interactive Calculator ───────────────────────── */}
      <ScoreCalculator />

      {/* ── DECISION TREE FLOWCHART ─────────────────────────────────────── */}
      <h2>2 · The 30-Second Decision Tree</h2>
      <div className="panel">
        <svg viewBox="0 0 1100 500" width="100%" style={{ display: 'block' }}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={C.text2}/>
            </marker>
          </defs>
          <rect x="410" y="15" width="280" height="65" rx="10" fill={C.panel2} stroke={C.cyan} strokeWidth="2"/>
          <text x="550" y="44" textAnchor="middle" fill={C.text} fontSize="20" fontWeight="800">NEW NEWS ITEM</text>
          <text x="550" y="66" textAnchor="middle" fill={C.text2} fontSize="15">Headline + first paragraph</text>

          <line x1="550" y1="80" x2="550" y2="105" stroke={C.text2} strokeWidth="2" markerEnd="url(#arr)"/>
          <rect x="350" y="105" width="400" height="64" rx="10" fill={C.panel2} stroke={C.amber} strokeWidth="2"/>
          <text x="550" y="135" textAnchor="middle" fill={C.text} fontSize="17" fontWeight="700">Q1: Is there a $ number, quantity, or % change?</text>
          <text x="550" y="156" textAnchor="middle" fill={C.text2} fontSize="14">e.g. &quot;$100B contracts&quot; / &quot;+50% YoY&quot;</text>

          <line x1="350" y1="137" x2="200" y2="137" stroke={C.red} strokeWidth="2" markerEnd="url(#arr)"/>
          <text x="270" y="128" textAnchor="middle" fill={C.red} fontSize="15" fontWeight="800">NO</text>
          <rect x="50" y="105" width="150" height="64" rx="10" fill="rgba(239,68,68,0.15)" stroke={C.red} strokeWidth="2"/>
          <text x="125" y="143" textAnchor="middle" fill={C.red} fontSize="18" fontWeight="800">IGNORE</text>

          <line x1="550" y1="169" x2="550" y2="195" stroke={C.text2} strokeWidth="2" markerEnd="url(#arr)"/>
          <text x="572" y="186" fill={C.green} fontSize="15" fontWeight="800">YES</text>
          <rect x="350" y="195" width="400" height="64" rx="10" fill={C.panel2} stroke={C.amber} strokeWidth="2"/>
          <text x="550" y="225" textAnchor="middle" fill={C.text} fontSize="17" fontWeight="700">Q2: Is it &gt; 5% of revenue OR mcap?</text>
          <text x="550" y="246" textAnchor="middle" fill={C.text2} fontSize="14">If no → score &lt; 15 → IGNORE</text>

          <line x1="550" y1="259" x2="550" y2="285" stroke={C.text2} strokeWidth="2" markerEnd="url(#arr)"/>
          <rect x="350" y="285" width="400" height="64" rx="10" fill={C.panel2} stroke={C.amber} strokeWidth="2"/>
          <text x="550" y="315" textAnchor="middle" fill={C.text} fontSize="17" fontWeight="700">Q3: Structural (multi-year) or one-time?</text>
          <text x="550" y="336" textAnchor="middle" fill={C.text2} fontSize="14">Contracts/TAM = structural. Buybacks/dividends = one-time.</text>

          <line x1="350" y1="350" x2="180" y2="410" stroke={C.cyan} strokeWidth="2" markerEnd="url(#arr)"/>
          <text x="240" y="385" fill={C.cyan} fontSize="15" fontWeight="800">ONE-TIME</text>
          <rect x="50" y="410" width="270" height="70" rx="10" fill="rgba(6,182,212,0.12)" stroke={C.cyan} strokeWidth="2"/>
          <text x="185" y="438" textAnchor="middle" fill={C.cyan} fontSize="19" fontWeight="800">SHORT TRADE</text>
          <text x="185" y="463" textAnchor="middle" fill={C.text2} fontSize="14">Buybacks · tariffs · dividends · M&amp;A pop</text>

          <line x1="750" y1="350" x2="920" y2="410" stroke={C.green} strokeWidth="2" markerEnd="url(#arr)"/>
          <text x="860" y="385" fill={C.green} fontSize="15" fontWeight="800">STRUCTURAL</text>
          <rect x="780" y="410" width="270" height="70" rx="10" fill="rgba(34,197,94,0.12)" stroke={C.green} strokeWidth="2"/>
          <text x="915" y="438" textAnchor="middle" fill={C.green} fontSize="19" fontWeight="800">LONG-TERM BUY</text>
          <text x="915" y="463" textAnchor="middle" fill={C.text2} fontSize="14">Contracts · TAM raises · regulatory shifts</text>
        </svg>
      </div>

      {/* ── KEYWORD CHEAT SHEET ─────────────────────────────────────────── */}
      <h2>3 · Keyword Cheat Sheet</h2>
      <table>
        <thead><tr><th style={{ width: 90 }}>Score</th><th>Keywords / Phrases</th><th style={{ width: 200 }}>Action</th></tr></thead>
        <tbody>
          <tr style={{ background: 'rgba(34,197,94,0.04)' }}>
            <td><Tag kind="high"/></td>
            <td>&quot;multi-year contract&quot;, &quot;$XB binding agreement&quot;, &quot;TAM raised to&quot;, &quot;first-ever&quot;, &quot;FDA approval&quot;, &quot;court ruling&quot;, &quot;sanction lifted&quot;, &quot;100% tariff&quot;, &quot;definitive agreement&quot;, &quot;regulatory clearance received&quot;, &quot;CDSCO approval&quot;, &quot;USFDA approval&quot;, &quot;successful PIII trial&quot;, &quot;commercial operations declared&quot;, &quot;capex commissioning&quot;</td>
            <td>Score 20+. LONG-TERM BUY or major macro hedge</td>
          </tr>
          <tr style={{ background: 'rgba(245,158,11,0.04)' }}>
            <td><Tag kind="med"/></td>
            <td>&quot;raised guidance&quot;, &quot;stress-test pass&quot;, &quot;dividend hike&quot;, &quot;$XB buyback authorized&quot;, &quot;agreement to acquire&quot;, &quot;LOI signed&quot;, &quot;qualification complete&quot;, &quot;design-win pipeline&quot;, &quot;PLI scheme approved&quot;, &quot;production-linked&quot;, &quot;CEO succession&quot;</td>
            <td>Score 15-19. Short trade or watch.</td>
          </tr>
          <tr style={{ background: 'rgba(239,68,68,0.04)' }}>
            <td><Tag kind="low"/></td>
            <td>&quot;exploring&quot;, &quot;considering&quot;, &quot;in talks&quot;, &quot;could&quot;, &quot;may&quot;, &quot;rumored&quot;, &quot;reportedly&quot;, &quot;hired XYZ to advise&quot;, &quot;weighing options&quot;, &quot;partnership announced&quot; (no $ number), &quot;memorandum of understanding&quot; (often), &quot;non-binding&quot;, &quot;may consider&quot;, &quot;evaluating&quot;</td>
            <td>Score &lt; 15. IGNORE.</td>
          </tr>
        </tbody>
      </table>

      <h3>The &quot;Edge Test&quot; — final filter</h3>
      <div className="panel">
        <p style={{ marginTop: 0 }}>Ask one question: <b>Does this news change my model of the company&apos;s 3-year EPS by &gt; 10%?</b></p>
        <ul>
          <li>If YES — react with conviction (size, direction, time horizon).</li>
          <li>If NO — even if interesting, ignore. Your time is the scarce resource.</li>
        </ul>
      </div>

      {/* ── HISTORICAL LONG EXAMPLES ────────────────────────────────────── */}
      <h2>4 · 20 Historical LONG-TERM BUY Examples</h2>
      <p className="small">Sized by actual historical return. Mix of US + India. Studied retrospectively to teach pattern recognition.</p>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>APPLE — &quot;Steve Jobs introduces iPhone, $499 starting price, exclusive 2-year AT&amp;T deal&quot; <span className="return">+58,000% (2007-2024)</span></h3>
        <p><b>Score: 24/25</b> · Date: Jan 9, 2007. New product category. Multi-year carrier exclusive. Software ecosystem moat. <b>The clearest structural buy in modern history.</b> Stock was $11 then.</p>
        <p className="small"><b>Pattern lesson:</b> New category + ecosystem control + binding multi-year distribution = decade-long compounder. AAPL went from 4% of S&amp;P weight to 7%+ over 17 years.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>RELIANCE JIO — &quot;Free voice, free data forever&quot; <span className="return">RELIANCE +400% (2016-2024)</span></h3>
        <p><b>Score: 25/25</b> · Date: Sept 1, 2016. Mukesh Ambani disrupted Indian telecom with $25B capex burn. RIL went from oil-only to oil+telecom+retail+digital. Created India&apos;s biggest data subscriber base in 18 months.</p>
        <p className="small"><b>Pattern lesson:</b> When India&apos;s richest man personally commits $25B to a new vertical, that vertical&apos;s economics change. AIRTEL/VODA stocks crashed 60%+ while RELIANCE doubled.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>PFIZER + BIONTECH — &quot;90% efficacy in Phase 3 COVID vaccine trial&quot; <span className="return">+85% BNTX in 6 weeks</span></h3>
        <p><b>Score: 24/25</b> · Date: Nov 9, 2020. Pre-market gap-up +15% on PFE. BNTX +14% in pre-market, then +85% within 6 weeks. S&amp;P 500 +8% on the day.</p>
        <p className="small"><b>Pattern lesson:</b> Successful binary-outcome announcements that unlock $10B+ in addressable market. Buy on the news, hold for the entire commercialization cycle (24+ months in this case).</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>NVIDIA — &quot;Acquiring Mellanox for $6.9B all-cash&quot; <span className="return">NVDA +2,800% (2019-2024)</span></h3>
        <p><b>Score: 21/25</b> · Date: Mar 11, 2019. NVDA was widely seen as overpaying for networking. <b>What investors missed:</b> Mellanox InfiniBand was the backbone that would later interconnect AI training clusters. Without this deal, the AI revenue ramp would have been split with Intel/Broadcom.</p>
        <p className="small"><b>Pattern lesson:</b> Strategic acquisitions that complete a value chain are worth more than the price suggests. Look for &quot;backwards integration into key supplier.&quot;</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>AMD — &quot;Acquiring Xilinx for $35B all-stock&quot; <span className="return">AMD +180% (2020-2024)</span></h3>
        <p><b>Score: 22/25</b> · Date: Oct 27, 2020. Filled AMD&apos;s FPGA/embedded gap, gave them auto/aerospace/networking exposure. Closed Feb 2022.</p>
        <p className="small"><b>Pattern lesson:</b> Mega-cap all-stock M&amp;A where buyer has rising multiple = often a win. AMD&apos;s P/E was elevated, so &quot;currency was strong&quot; for the deal.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 TATA — &quot;Wins bid for Air India, will pay ₹18,000 Cr&quot; <span className="return">TATAMOTORS +200% by 2024</span></h3>
        <p><b>Score: 22/25</b> · Date: Oct 8, 2021. Tata returning to civil aviation after 68 years. Massive group-level integration with Vistara, AirAsia India. Halo effect lifted all Tata stocks (TATAMOTORS, TATA STEEL, TCS).</p>
        <p className="small"><b>Pattern lesson:</b> Strategic acquisitions where buyer has both capital AND operational expertise. Don&apos;t just look at the acquired company — look at the buyer&apos;s ability to integrate.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 HDFC + HDFC BANK MERGER ANNOUNCEMENT <span className="return">HDFCBANK consolidated to India&apos;s largest bank</span></h3>
        <p><b>Score: 23/25</b> · Date: Apr 4, 2022. ₹40,000 Cr deal value. Created India&apos;s 2nd largest company by mcap. Cross-sell mortgage + bank product synergy. Long-dated thesis.</p>
        <p className="small"><b>Pattern lesson:</b> When financial conglomerates restructure to be simpler/more integrated, valuation re-rating follows. Even if short-term stock dipped on integration concerns.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 ADANI — &quot;Acquires Ambuja Cement + ACC from Holcim for $10.5B&quot; <span className="return">AMBUJACEM +75% in 12 months</span></h3>
        <p><b>Score: 21/25</b> · Date: May 16, 2022. Made Adani #2 cement player overnight. Vertical integration with logistics + power. Pre-Hindenburg, this was a true value-creation event.</p>
        <p className="small"><b>Pattern lesson:</b> Cross-border distressed-seller exits often produce value. Holcim was retreating from India; Adani got premium assets at decent multiple.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>MICROSOFT — &quot;Acquiring LinkedIn for $26.2B&quot; <span className="return">MSFT +500% (2016-2024)</span></h3>
        <p><b>Score: 20/25</b> · Date: Jun 13, 2016. Critics said overpaying 79× earnings. <b>What was actually bought:</b> the world&apos;s only B2B professional graph, deeply complementary to Azure + Office. Set up MSFT&apos;s Cloud era.</p>
        <p className="small"><b>Pattern lesson:</b> &quot;Expensive&quot; deals where the strategic adjacency is real (rather than financial engineering) tend to pay off over 5+ years. Look at strategic logic, not P/E.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 BAJAJ FINANCE — &quot;Cross 1 Cr customer milestone, AUM +30% YoY&quot; <span className="return">BAJFINANCE 1000-bagger 2009-2022</span></h3>
        <p><b>Score: 19/25</b> · Recurring milestone announcements. Each was a confirmation of the consumer-credit network effect. Stock compounded ~50% CAGR for a decade.</p>
        <p className="small"><b>Pattern lesson:</b> &quot;Same news repeated&quot; can BE the alpha — if each iteration confirms the moat is widening. AUM, customer count, branch count milestones at NBFCs are this.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>MICRON — &quot;16 strategic customer agreements, ~$100B revenue locked&quot; <span className="return">MU +95% (2024-25)</span></h3>
        <p><b>Score: 24/25</b> · Date: Jun 2026. Multi-year binding contracts eliminate boom-bust cycle. 40% of revenue at fixed/ceiling prices.</p>
        <p className="small"><b>Pattern lesson:</b> Commodities companies that move to contract pricing = re-rate from cyclical to growth multiples. Same playbook worked for ASML, TSMC.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>TESLA — &quot;Joining S&amp;P 500 effective Dec 21, 2020&quot; <span className="return">+70% in 5 weeks after announcement</span></h3>
        <p><b>Score: 19/25</b> · Date: Nov 16, 2020. Forced buying from $4.6 trillion in passive funds. One-time mechanical, but cleared the way for TSLA&apos;s narrative to become &quot;a real S&amp;P company.&quot;</p>
        <p className="small"><b>Pattern lesson:</b> Index inclusion / exclusion creates real forced buying. Track upcoming Russell/MSCI/S&amp;P rebalance announcements.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 L&amp;T — &quot;Wins Mumbai-Ahmedabad Bullet Train civil contract ₹25,000 Cr&quot; <span className="return">LT +180% (2021-2024)</span></h3>
        <p><b>Score: 21/25</b> · Multi-year mega-project. Showcases L&amp;T as preferred Indian infra partner. Set up for many more such mega-orders.</p>
        <p className="small"><b>Pattern lesson:</b> Single mega-contracts &gt;15% of company&apos;s order book = re-rating event. Watch Indian PSU + private infra winners in capex cycle.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>NETFLIX — &quot;Launching ad-supported tier, partnering with Microsoft for ad-tech&quot; <span className="return">NFLX +260% (2022-2024)</span></h3>
        <p><b>Score: 20/25</b> · Date: Jul 2022. New revenue stream + lower-priced subscriber acquisition channel. Reversed the &quot;market saturated&quot; narrative.</p>
        <p className="small"><b>Pattern lesson:</b> Companies pivoting business model when growth slows often re-rate sharply. Watch for &quot;pivot announcements&quot; from declining-growth companies.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 TCS — &quot;Wins $25B 10-year contract from Nielsen Holdings&quot; <span className="return">TCS +60% over 2 years</span></h3>
        <p><b>Score: 22/25</b> · Date: 2014. World&apos;s largest IT outsourcing deal at the time. 10% of TCS annual revenue locked for a decade.</p>
        <p className="small"><b>Pattern lesson:</b> Mega-deals from Indian IT majors are usually leaked early; confirmation announcement often triggers final leg of re-rating.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>NVIDIA — &quot;Q1 FY24: Data center revenue +427% YoY to $14.5B&quot; <span className="return">NVDA +24% in single day</span></h3>
        <p><b>Score: 24/25</b> · Date: May 24, 2023. The earnings call that confirmed AI demand was real, not hype. Forward guidance crushed estimates by 50%+.</p>
        <p className="small"><b>Pattern lesson:</b> When an earnings result is multiples above consensus AND comes with structural narrative, the stock&apos;s multiple AND earnings re-rate simultaneously. Both compound.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 TRENT — &quot;Adds Zudio to portfolio, opens 100+ stores in 12 months&quot; <span className="return">TRENT 10× (2020-2024)</span></h3>
        <p><b>Score: 21/25</b> · Each quarterly store-count update was incremental confirmation. Investors who pattern-matched after the FIRST 5-6 quarters got positioned for the bulk of the move.</p>
        <p className="small"><b>Pattern lesson:</b> Same-store sales + new store count are leading indicators of retailer success. When both compound 30%+ for 4+ quarters = generational compounder.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>QUALCOMM Investor Day — &quot;Data center: $0.3B → $15B by FY29&quot; <span className="return">QCOM +35% in 60 days</span></h3>
        <p><b>Score: 22/25</b> · 50× revenue growth target. $1T+ TAM declared. Even at 50% achievement, this is a step-change.</p>
        <p className="small"><b>Pattern lesson:</b> Investor Day TAM upgrades from credible management = long-term position trigger. Track quarterly progress to first milestone for confirmation.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>🇮🇳 ASIAN PAINTS — &quot;Backed Adoption of Decorative Tinting System&quot; <span className="return">ASIANPAINT 100× (2003-2023)</span></h3>
        <p><b>Score: 18/25 (slow burn)</b> · Date: Early 2003. Distribution moat formation. Took years to play out but the network effect was visible immediately if you read the press release carefully.</p>
        <p className="small"><b>Pattern lesson:</b> Some long-term winners look boring on the day of announcement. The clue is in the distribution + supply-chain investment, not headline P&amp;L.</p>
      </div>

      <div className="panel longp">
        <h3 style={{ marginTop: 0 }}><Tag kind="long"/>SK HYNIX — &quot;Plans $29B US listing&quot; <span className="return">+13% same day, sector +20% over 30 days</span></h3>
        <p><b>Score: 20/25</b> · Date: Jun 2026. One of largest dual listings in history. Validates HBM cycle. Korean tech revaluation thesis.</p>
        <p className="small"><b>Pattern lesson:</b> Major secondary listings unlock institutional access. Stocks of large foreign listings often outperform domestic peers in 6-12 months pre-listing.</p>
      </div>

      {/* ── HISTORICAL SHORT EXAMPLES ───────────────────────────────────── */}
      <h2>5 · 15 Historical SHORT TRADE Examples</h2>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>VOLKSWAGEN — &quot;EPA accuses VW of installing emissions cheating software&quot; <span className="loss">VW −30% in 4 days</span></h3>
        <p><b>Score: 20/25</b> · Date: Sept 18, 2015. Regulatory revelation. Immediate trade was short VW. Sector trade was long Tesla / other EV.</p>
        <p className="small"><b>Pattern lesson:</b> Regulatory enforcement actions = fastest velocity trades. Velocity = 5/5 because the regulator&apos;s release is the news itself.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>BOEING — &quot;FAA grounds 737 MAX worldwide after Ethiopian Airlines crash&quot; <span className="loss">BA −20% in 2 weeks</span></h3>
        <p><b>Score: 22/25</b> · Date: Mar 13, 2019. Operational grounding with no clear timeline. Forced production halt + customer compensation.</p>
        <p className="small"><b>Pattern lesson:</b> Aviation/auto/pharma operational risks = short-trade opportunities with clear catalyst. Cover when grounding lifts or first major customer reorders.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>🇮🇳 ADANI — &quot;Hindenburg Research releases short-seller report&quot; <span className="loss">ADANI GROUP −60% in 30 days</span></h3>
        <p><b>Score: 21/25</b> · Date: Jan 24, 2023. 88-question report on accounting/related-party. Triggered $150B+ wipeout.</p>
        <p className="small"><b>Pattern lesson:</b> Short-seller reports against highly-leveraged conglomerates = real catalyst. Even if narrative is contested, forced selling from margin calls/concerned banks creates the move.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>🇮🇳 DHFL — &quot;ICICI Securities downgrades to SELL on liquidity concerns&quot; <span className="loss">DHFL −60% in 1 week, eventually delisted</span></h3>
        <p><b>Score: 19/25</b> · Sept 2018. Cobrapost allegations + commercial paper rollover concerns. Cascaded into the NBFC liquidity crisis.</p>
        <p className="small"><b>Pattern lesson:</b> NBFC liquidity crises = short the whole sector + long defensive consumer. When ONE NBFC has rollover issues, contagion in NBFC index is days away.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>🇮🇳 PAYTM — &quot;Lists at ₹2,150 vs ₹2,150 issue price, closes ₹1,564&quot; <span className="loss">−27% on listing day</span></h3>
        <p><b>Score: 18/25</b> · Date: Nov 18, 2021. Worst large-IPO debut in Indian history at the time. Signal: extreme valuations + insider exits.</p>
        <p className="small"><b>Pattern lesson:</b> Late-cycle IPOs at peak valuations rarely work for retail. Wait 6-12 months post-IPO; many such stocks find a real base only after −60%.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>🇮🇳 YES BANK — &quot;RBI imposes moratorium, ₹50,000 withdrawal cap&quot; <span className="loss">YESBANK −85% in 3 days, then to ₹5</span></h3>
        <p><b>Score: 25/25</b> · Date: Mar 5, 2020. Regulatory intervention = ground zero. Stock froze, brokers had no liquidity. Capital structure rewired by RBI.</p>
        <p className="small"><b>Pattern lesson:</b> RBI/SEBI/SEC enforcement against single companies = immediate exits if you&apos;re long. Even at &quot;0%&quot; reassurance, never average down on regulatory crises.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>RUSSIA — &quot;Russian forces enter Ukraine, NATO sanctions imposed&quot; <span className="return">Brent +30%, NIFTY-50 −12% in 3 weeks</span></h3>
        <p><b>Score: 23/25</b> · Date: Feb 24, 2022. Geopolitical shock. Velocity 5/5. Markets reacted within minutes.</p>
        <p className="small"><b>Pattern lesson:</b> Geopolitical shocks → standardized playbook: long oil/gold/defense, short cyclicals, hedge equity beta. Read the playbook off historical war/Ukraine/COVID.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>BREXIT — &quot;UK votes to leave EU, pound crashes&quot; <span className="loss">GBP/USD −10% overnight, FTSE -5% then rallied</span></h3>
        <p><b>Score: 22/25</b> · Date: Jun 23, 2016. Surprise outcome despite polls. FX move was largest; equity rebounded.</p>
        <p className="small"><b>Pattern lesson:</b> Surprise referendum/election outcomes hit FX first (most efficient), equity second. Trade FX for clean exposure to political surprise.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>LEHMAN — &quot;Lehman Brothers files Chapter 11 bankruptcy&quot; <span className="loss">S&amp;P −500 bps in single session</span></h3>
        <p><b>Score: 25/25</b> · Date: Sept 15, 2008. Inflection point of the GFC. Best to NOT have been long anything that week.</p>
        <p className="small"><b>Pattern lesson:</b> Mega-bank failures = systemic risk events. Cover all shorts on commercial bank stocks at the announcement (they bottomed within days). Buy quality on Day 3-5.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>FACEBOOK — &quot;Apple iOS 14.5 launches ATT framework&quot; <span className="loss">META −37% in 3 months</span></h3>
        <p><b>Score: 20/25</b> · Date: Apr 2021. Ad attribution disruption. Took 6 months for full impact to show in META P&amp;L.</p>
        <p className="small"><b>Pattern lesson:</b> Platform changes by other companies that affect your target&apos;s monetization = slow-burn shorts. Hold position for 2-3 earnings cycles.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>🇮🇳 ZEEL — &quot;Sony cancels $10B merger after compliance concerns&quot; <span className="loss">ZEEL −33% in 1 day</span></h3>
        <p><b>Score: 21/25</b> · Date: Jan 22, 2024. Years-in-progress deal collapse. Trade: short on Day 1 (open at floor was avoidable), cover after capitulation week.</p>
        <p className="small"><b>Pattern lesson:</b> Merger-termination events = clean shorts with binary catalyst already done. Don&apos;t expect quick reversal — fundamentals are usually deteriorating.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>BAYER — &quot;Supreme Court shields from Roundup cancer warnings&quot; <span className="return">BAYR +8% in 5 days</span></h3>
        <p><b>Score: 17/25</b> · Date: Jun 2026. Legal liability removal. Direct EPS impact via reserves release. One-time but large.</p>
        <p className="small"><b>Pattern lesson:</b> Long position with short horizon — buy on news, exit after first upgrade cycle (2-8 weeks).</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>TRUMP — &quot;100% tariff threat on countries with Digital Services Tax&quot;</h3>
        <p><b>Score: 18/25</b> · Macro shock. High velocity. Truth-Social policy = often negotiating tactic; partial reversal likely.</p>
        <p className="small"><b>Pattern lesson:</b> Truth-Social/Twitter policy threats from politicians = trade the first move, take profit on first walkback. Time horizon 1-4 weeks max.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>XBOX — &quot;Console prices raised 25-30%, M-cost +2.5×&quot;</h3>
        <p><b>Score: 16/25</b> · Confirms memory cost inflation. Direct bullish read-through to MU and SK Hynix.</p>
        <p className="small"><b>Pattern lesson:</b> Downstream company price hikes = upstream commodity bullish read. Trade the supplier, not the consumer.</p>
      </div>

      <div className="panel shortp">
        <h3 style={{ marginTop: 0 }}><Tag kind="short"/>🇮🇳 PNB — &quot;Detects ₹11,400 Cr fraud at Mumbai branch (Nirav Modi)&quot; <span className="loss">PNB −20% in week</span></h3>
        <p><b>Score: 22/25</b> · Date: Feb 14, 2018. Massive forex fraud disclosure. Triggered PSU-bank sell-off sector-wide.</p>
        <p className="small"><b>Pattern lesson:</b> Fraud disclosures from PSU/private banks = exit the named bank, reduce sector. Don&apos;t catch the falling knife; wait for forensic investigation to complete.</p>
      </div>

      {/* ── HISTORICAL SECTOR EXAMPLES ──────────────────────────────────── */}
      <h2>6 · 10 Historical SECTOR PLAY Examples</h2>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>US — &quot;Inflation Reduction Act signed: $369B for energy/EV/solar&quot; <span className="return">Solar sector +25%, EV +18%</span></h3>
        <p><b>Score: 23/25</b> · Date: Aug 16, 2022. Decade-long subsidy framework. Trade: First Solar (FSLR), Enphase (ENPH), Sunrun (RUN), Tesla (TSLA), Rivian (RIVN), Lithium plays (ALB, LAC).</p>
        <p className="small"><b>Pattern lesson:</b> Mega-fiscal bills with decade-long subsidies are sector-wide tailwinds. Basket approach beats stock picking.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>US — &quot;CHIPS Act passes Senate: $52B for US semi manufacturing&quot; <span className="return">Semi-cap equipment +30%</span></h3>
        <p><b>Score: 22/25</b> · Date: Aug 2022. Direct subsidies for fab construction. Trade: AMAT, LRCX, KLAC, TSM, INTC, GFS.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>🇮🇳 PLI Scheme — &quot;Auto/Electronics PLI of ₹26,000 Cr approved&quot; <span className="return">Auto-ancillary names +60% over 18 months</span></h3>
        <p><b>Score: 22/25</b> · Date: Sept 2021. Production-linked incentive across 13 sectors. Trade: SUNDARMFAST, BHARATFORG, MOTHERSON, BOSCHLTD.</p>
        <p className="small"><b>Pattern lesson:</b> Indian PLI schemes = guaranteed subsidy = direct revenue impact. Track approved beneficiaries via Press Information Bureau releases.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>🇮🇳 GOI — &quot;Indian Railways: ₹2.65 trillion capex for FY24&quot; <span className="return">Railway theme stocks 5-10× in 18 months</span></h3>
        <p><b>Score: 22/25</b> · Date: Budget Feb 2023. Multi-year capex cycle. Trade: TITAGARH, RVNL, IRFC, IRCTC, BEML, HBL Power.</p>
        <p className="small"><b>Pattern lesson:</b> Indian Budget capex line-items = sector tailwind. Compare YoY allocation; double-digit% increase = sector basket play.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>CHINA — &quot;Reopening from zero-COVID, lifts all restrictions&quot; <span className="return">Commodities +15%, luxury +20%</span></h3>
        <p><b>Score: 21/25</b> · Date: Dec 2022. Macro regime change. Trade: copper miners (FCX), iron ore, luxury (LVMH, MC), aviation, casinos.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>🇮🇳 RBI — &quot;Demonetization announcement, ₹500/₹1000 notes invalid&quot; <span className="loss">Real estate −40%, NBFCs −25%</span></h3>
        <p><b>Score: 24/25</b> · Date: Nov 8, 2016. Cash-economy shock. Cash-dependent sectors crashed; payment companies (PAYTM, Visa, Mastercard) rallied 30%+ in months.</p>
        <p className="small"><b>Pattern lesson:</b> Monetary policy shocks = same playbook each time. Identify cash-dependent vs digital-payment beneficiaries.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>🇮🇳 BUDGET — &quot;Personal income tax exemption raised to ₹7L&quot; <span className="return">Consumer discretionary +12% in 2 weeks</span></h3>
        <p><b>Score: 18/25</b> · Date: Feb 2023. Direct income transfer to middle class = consumption tailwind. Trade: VBL, ITC, NESTLEIND, MARICO, HUL, basket of QSR (JUBLFOOD, WESTLIFE).</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>US PENTAGON — &quot;Critical minerals on Army bases for refining&quot;</h3>
        <p><b>Score: 22/25</b> · Date: Jun 2026. <b>Regime change for US critical-mineral supply chain.</b> Bipartisan policy. ~$2B investment. Trade: IONR, ALB, LAC, MP, USA Rare Earth.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>OPEC+ — &quot;Saudi Arabia + Russia announce 1.6M bpd voluntary production cut&quot; <span className="return">Brent +6% same day</span></h3>
        <p><b>Score: 20/25</b> · Recurring catalyst. Each cut announcement = oil ETF (XLE, OIH) trade for 1-3 weeks.</p>
      </div>

      <div className="panel sectp">
        <h3 style={{ marginTop: 0 }}><Tag kind="sector"/>EU — &quot;Carbon Border Adjustment Mechanism (CBAM) launches&quot; <span className="return">Steel/aluminum producers in EU re-rated, importers de-rated</span></h3>
        <p><b>Score: 19/25</b> · Date: Oct 2023. Permanent cost differential. EU-favored producers like SSAB, ArcelorMittal benefited; Indian/Chinese steel exporters disadvantaged.</p>
      </div>

      {/* ── HISTORICAL IGNORE EXAMPLES ──────────────────────────────────── */}
      <h2>7 · 10 Historical IGNORE / Trap Examples</h2>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;CEO holds town hall, says optimistic about Q3&quot;</h3>
        <p><b>Score: 6/25</b> · No numbers, no commitment. Senior management is always &quot;optimistic.&quot; CFO commentary on actual numbers is what matters.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Stock surges 8% on heavy volume&quot; (no news attached)</h3>
        <p><b>Score: 8/25</b> · Without identified catalyst, this is noise. 70% of such moves reverse within 3 sessions.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Goldman Sachs raises price target from $150 to $175&quot;</h3>
        <p><b>Score: 9/25</b> · Sell-side upgrade after the fact. Smart money positioned weeks ago. Trade it ONLY if it&apos;s a downgrade-to-upgrade switch with material thesis change.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Magazine cover declares end of bull market&quot;</h3>
        <p><b>Score: 3/25 as bearish, 18/25 as contrarian BUY</b>. Famous example: BusinessWeek &quot;Death of Equities&quot; Aug 1979 — before 20-year bull. Contrarian signal.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Company hires investment bank for strategic review&quot;</h3>
        <p><b>Score: 10/25</b> · &quot;Strategic review&quot; happens. Often nothing comes of it. Wait for actual announcement of action (sale, spin-off, dividend).</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Bumble exploring sale, hired Morgan Stanley&quot;</h3>
        <p><b>Score: 12/25</b> · &quot;Hired advisor&quot; = exploration phase. 60%+ never close. Wait for binding terms.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Mortgage rate edges up 2bps to 6.49%&quot;</h3>
        <p><b>Score: 4/25</b> · Statistical noise. Only matters when rate breaks 100bp range threshold.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Carter&apos;s WNBA partnership with Atlanta Dream, courtside signage&quot;</h3>
        <p><b>Score: 5/25</b> · Marketing partnership with no $ disclosed. Pure PR.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Tesla cars caught in flash flood, video viral on Twitter&quot;</h3>
        <p><b>Score: 5/25</b> · Anecdotal event. Does not change company fundamentals. Stock might dip 1% then recover by close.</p>
      </div>

      <div className="panel ignp">
        <h3 style={{ marginTop: 0 }}><Tag kind="ignore"/>&quot;Company files for bankruptcy&quot; (after 80% drop)</h3>
        <p><b>Score: Already lost</b>. By the time bankruptcy filing is public, equity is worth ~$0. Important: don&apos;t buy &quot;cheap&quot; bankrupt companies as &quot;turnaround plays.&quot;</p>
      </div>

      {/* ── INDIA-SPECIFIC PATTERNS ─────────────────────────────────────── */}
      <h2>8 · 🇮🇳 India-Specific News Patterns</h2>

      <div className="panel indp">
        <h3 style={{ marginTop: 0 }}>RBI Monetary Policy Committee (MPC) — bi-monthly</h3>
        <table>
          <tbody>
            <tr><th style={{ width: 200 }}>Signal</th><th>Reaction</th></tr>
            <tr><td>Repo rate hike (+25bps)</td><td>Bank stocks initially neutral; long-duration bonds sell. Trade: SHORT NBFC weak ones, LONG private banks (HDFCBANK, ICICIBANK).</td></tr>
            <tr><td>Repo rate cut (−25bps)</td><td>Auto, real estate, NBFCs rally. Bonds rally. Trade: M&amp;M, MARUTI, HDFC AMC, BAJAJFINANCE.</td></tr>
            <tr><td>CRR cut (+0.5% liquidity)</td><td>Bank lending capacity ↑. PSU banks (SBI, BANKBARODA) outperform on margin expansion.</td></tr>
            <tr><td>Stance change (Accommodative → Neutral, etc.)</td><td>This is the BIG signal. Stance change = direction change. Recalibrate sector exposure within 24h.</td></tr>
            <tr><td>Inflation forecast revision</td><td>If raised → bonds sell, bank short. If lowered → bonds rally, sector rotation to growth.</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel indp">
        <h3 style={{ marginTop: 0 }}>SEBI Announcements</h3>
        <table>
          <tbody>
            <tr><th style={{ width: 200 }}>Signal</th><th>Reaction</th></tr>
            <tr><td>Margin requirement changes (T+1, T+0)</td><td>Brokerages affected. ANGEL, MOTILALOFS. Liquidity providers and HFT players.</td></tr>
            <tr><td>Mutual fund REIT/InvIT allowance</td><td>REIT/InvIT yields rally. EMBASSY, MINDSPACE, POWERGRID InvIT.</td></tr>
            <tr><td>Promoter pledging changes</td><td>If promoter pledge crosses 50% — sell signal. If it falls to 0% — buy.</td></tr>
            <tr><td>Insider trading rules</td><td>Generally neutral. Watch enforcement actions for sector implications.</td></tr>
            <tr><td>F&amp;O ban list changes</td><td>Stocks moving in/out = liquidity event. Stocks dropping from ban = often dead money.</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel indp">
        <h3 style={{ marginTop: 0 }}>Union Budget (Feb 1 every year)</h3>
        <ul>
          <li><b>Fiscal deficit target</b> — if widened, bonds sell, defense/infra rally. If narrowed, bonds rally.</li>
          <li><b>Capex line-item YoY growth</b> — if &gt; 15%, sector basket play (railways, defense, water, power).</li>
          <li><b>Income tax slab changes</b> — direct consumption boost. ITC, HUL, MARICO, MUTHOOTFIN.</li>
          <li><b>STT/LTCG/STCG changes</b> — affects entire equity market. Even small changes cause 2-5% moves day of.</li>
          <li><b>Sector-specific allocations (solar, EV, hydrogen)</b> — basket play for 30 days post-budget.</li>
          <li><b>Disinvestment targets</b> — PSU stocks rally on aggressive targets. SBIN, ONGC, IOC, COAL INDIA.</li>
        </ul>
      </div>

      <div className="panel indp">
        <h3 style={{ marginTop: 0 }}>Quarterly Results Cycle (Indian)</h3>
        <ul>
          <li><b>Jan-Feb:</b> Q3 FY (Oct-Dec) results — captures festive demand. Watch FMCG, auto, paint.</li>
          <li><b>Apr-Jun:</b> Q4 FY + Annual results — biggest news cycle. Most material guidance + dividend announcements.</li>
          <li><b>Jul-Aug:</b> Q1 FY+1 results — early read on new FY trajectory.</li>
          <li><b>Oct-Nov:</b> Q2 FY+1 results — sets up the festive selling season narrative.</li>
        </ul>
        <p className="small">Best dates for trading: Apr-Jun cycle (volume + news density highest).</p>
      </div>

      {/* ── US-SPECIFIC PATTERNS ────────────────────────────────────────── */}
      <h2>9 · 🇺🇸 US-Specific Macro Patterns</h2>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Federal Reserve FOMC (8x per year)</h3>
        <table>
          <tbody>
            <tr><th style={{ width: 200 }}>Signal</th><th>Reaction</th></tr>
            <tr><td>Rate decision (hike/cut/hold)</td><td>First 30 min after release = volatility spike. Trade direction depends on dot-plot vs consensus.</td></tr>
            <tr><td>Dot plot changes (median fed funds)</td><td>If raised — equities sell, USD up, gold down. If lowered — equities rally, USD down, gold up.</td></tr>
            <tr><td>Powell press conference (30 min after release)</td><td>Tone matters more than words. Hawkish = market down. Dovish = market up.</td></tr>
            <tr><td>SEP (Summary of Economic Projections)</td><td>Quarterly. GDP/unemployment forecast changes = direction shifts.</td></tr>
            <tr><td>Balance sheet runoff pace changes</td><td>QT acceleration = bonds sell. QT pause/end = bonds rally.</td></tr>
          </tbody>
        </table>
        <p className="small"><b>Best practice:</b> NEVER trade in the 5 minutes around FOMC release. Volatility eats stops. Wait for 15 min post-release for direction to settle.</p>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Key US Data Releases (impact-ranked)</h3>
        <table>
          <tbody>
            <tr><th style={{ width: 130 }}>Release</th><th>Frequency</th><th>Reaction</th></tr>
            <tr><td>NFP (Non-farm Payrolls)</td><td>1st Fri/mo</td><td>Largest single market mover. Strong = USD up, equities down (rate fears).</td></tr>
            <tr><td>CPI</td><td>Monthly mid-month</td><td>2nd biggest mover. Hot = rate hike fears → equity sell.</td></tr>
            <tr><td>PCE</td><td>Monthly</td><td>Fed&apos;s preferred inflation gauge. Same direction as CPI.</td></tr>
            <tr><td>Retail Sales</td><td>Monthly</td><td>Consumer spending. Strong = good for AMZN/WMT, weak = recession fears.</td></tr>
            <tr><td>GDP (Advance/Prelim/Final)</td><td>Quarterly</td><td>Advance is biggest reaction. Revisions usually muted.</td></tr>
            <tr><td>ISM Manufacturing/Services</td><td>Monthly</td><td>Sub-50 = contraction. Above 50 = expansion.</td></tr>
            <tr><td>Initial Jobless Claims</td><td>Weekly Thursday</td><td>Below 200K = strong labor market.</td></tr>
            <tr><td>Housing Starts/Permits</td><td>Monthly</td><td>Watch for trend changes, not single prints.</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── EARNINGS NEWS ──────────────────────────────────────────────── */}
      <h2>10 · 📊 Earnings News Sub-Playbook</h2>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>The Earnings Beat Score (E score)</h3>
        <table>
          <tbody>
            <tr><th style={{ width: 200 }}>Metric</th><th>Reaction</th></tr>
            <tr><td>EPS beats by &gt;10% + Revenue beats + Guidance raised</td><td>Triple-beat. Stock typically +8-15% next session. Long.</td></tr>
            <tr><td>EPS beats but Revenue misses</td><td>Quality of beat is suspect. Likely buyback/tax benefit. Skip.</td></tr>
            <tr><td>EPS misses but Revenue beats + Guidance raised</td><td>Short-term pressure, long-term bullish. Add on dip.</td></tr>
            <tr><td>EPS beats but Guidance lowered</td><td>Trade DOWN — this is the &quot;rear-view mirror beat&quot; trap. Short.</td></tr>
            <tr><td>Both miss + Guidance cut</td><td>Triple-miss. Stock often −20%. Short or wait 3-5 days for capitulation.</td></tr>
            <tr><td>Margin compression (gross or operating) &gt;200bps</td><td>Demands explanation. If management says &quot;temporary,&quot; skeptical.</td></tr>
            <tr><td>One-time items in earnings</td><td>Strip them out for the &quot;clean&quot; number.</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Conference call &quot;words&quot; that move stocks</h3>
        <ul>
          <li><b>BULLISH:</b> &quot;at scale,&quot; &quot;double our capacity,&quot; &quot;multi-year commitment,&quot; &quot;positive operating leverage,&quot; &quot;deal velocity accelerating,&quot; &quot;robust pipeline&quot;</li>
          <li><b>NEUTRAL:</b> &quot;in line with expectations,&quot; &quot;measured growth,&quot; &quot;steady execution&quot;</li>
          <li><b>BEARISH:</b> &quot;cautious,&quot; &quot;challenging environment,&quot; &quot;cost optimization,&quot; &quot;reviewing our spend,&quot; &quot;temporary headwind,&quot; &quot;one-time charge,&quot; &quot;evaluating strategic alternatives&quot;</li>
        </ul>
        <p className="small"><b>Tell:</b> When CFO uses &quot;cautious&quot; or &quot;challenging&quot; without explaining root cause = sell.</p>
      </div>

      {/* ── INSTRUMENT + HORIZON ────────────────────────────────────────── */}
      <h2>11 · Instrument + Time Horizon</h2>

      <table>
        <thead>
          <tr><th style={{ width: 130 }}>Decision</th><th>Best instruments</th><th>Avoid</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><Tag kind="long"/></td>
            <td>Common stock. ATM/OTM call leaps (1-2 year expiry). SIP-style add on dips. For Indian: direct stock.</td>
            <td>Weekly options (decay). Leveraged ETFs (decay hurts long holds).</td>
          </tr>
          <tr>
            <td><Tag kind="short"/></td>
            <td>Weekly/monthly options. Stock + 5-8% stop. For broad: ETFs (XLE, XSD, ITA, NIFTYBEES).</td>
            <td>LEAPS (overpaid time value on short trades). Heavy single stock.</td>
          </tr>
          <tr>
            <td><Tag kind="sector"/></td>
            <td>Sector ETF (XLE, ITA, REMX, NIFTYAUTO, BANKBEES, IT). 5-10 stock basket if no ETF.</td>
            <td>Single stock when theme is sectoral — basket is safer.</td>
          </tr>
          <tr>
            <td><Tag kind="ignore"/></td>
            <td>Cash. Your existing positions.</td>
            <td>Each unnecessary trade taxes alpha by spread+slippage+stress.</td>
          </tr>
        </tbody>
      </table>

      <table>
        <thead><tr><th style={{ width: 130 }}>Horizon</th><th>News types that fit</th></tr></thead>
        <tbody>
          <tr><td><b>Hours-Days</b></td><td>Court rulings, earnings beats/misses, tariff announcements, sanctions, FDA approvals, M&amp;A pop (target).</td></tr>
          <tr><td><b>1-4 weeks</b></td><td>Capital returns, stress-test results, geopolitical de-escalation, commodity breakouts, RBI/Fed meeting decisions.</td></tr>
          <tr><td><b>1-6 months</b></td><td>Product launches, moderate contract wins, regulatory hearings, sector ETF flows, M&amp;A close completions.</td></tr>
          <tr><td><b>1-3 years</b></td><td>Multi-year customer agreements, TAM upgrades, IRA/CHIPS/PLI policies, industrial investment cycles.</td></tr>
          <tr><td><b>3-10 years</b></td><td>Architecture inventions, regulatory frameworks (EU AI Act), demographic shifts, capex super-cycles.</td></tr>
        </tbody>
      </table>

      {/* ── PRE-MORTEM ──────────────────────────────────────────────────── */}
      <h2>12 · ⚕ Pre-Mortem + 7 Traps + Checklist</h2>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>The Pre-Mortem Check (run before every trade)</h3>
        <p>Imagine it&apos;s 6 months from now and your trade has FAILED. What would have caused it?</p>
        <table>
          <tbody>
            <tr><th style={{ width: 200 }}>Possible Failure</th><th>Test</th></tr>
            <tr><td>News was a leak / already priced in</td><td>Look at 5-day price chart. If +20% pre-news, late to the trade.</td></tr>
            <tr><td>Company can&apos;t execute on opportunity</td><td>Check management history with similar inflections. CEO turnover in 3 years = high risk.</td></tr>
            <tr><td>Competitor responds with bigger announcement</td><td>Who is the 2nd / 3rd largest player? What is their next move?</td></tr>
            <tr><td>Macro regime change between now and 12 months</td><td>Recession risk, Fed pivot, sector rotation, geopolitical.</td></tr>
            <tr><td>Investor was wrong about magnitude</td><td>If the deal is $1B but company only converts $300M into revenue, &quot;beats&quot; can be smaller than expected.</td></tr>
            <tr><td>News reverses (lawsuit, regulatory backtrack)</td><td>Has this type of news been reversed in past?</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>7 Traps that Destroy Returns</h3>
        <ol>
          <li><b>Rumor trap.</b> &quot;Reportedly&quot;, &quot;in talks&quot;, &quot;considering&quot; — 30-40% follow-through. Wait for confirmation.</li>
          <li><b>Partnership trap.</b> Without a $ number = marketing, not finance. Ignore.</li>
          <li><b>Executive-shuffle trap.</b> New CFO/CEO matters in year 2, not week 2. Don&apos;t front-run leadership.</li>
          <li><b>Already-priced trap.</b> By the time news hits Discord/Twitter, smart money positioned. Check 5-day chart before acting.</li>
          <li><b>Headline misreads.</b> Read past the headline. &quot;Q1 GDP 2.1%&quot; could be revision up or down.</li>
          <li><b>Macro confirmation bias.</b> One data point doesn&apos;t flip a thesis. Wait for trend.</li>
          <li><b>FOMO on individual chats.</b> Discord pushes adrenaline. Step back. If score &lt; 15, walk away.</li>
        </ol>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>The 30-Second Triage Checklist</h3>
        <table>
          <thead><tr><th style={{ width: 32 }}>#</th><th>Step</th><th style={{ width: 80 }}>Time</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Read headline + first paragraph. Find the dollar number / % / quantity.</td><td>5s</td></tr>
            <tr><td>2</td><td>If no number → IGNORE.</td><td>1s</td></tr>
            <tr><td>3</td><td>Is the number &gt; 5% of company&apos;s annual revenue OR market cap?</td><td>5s</td></tr>
            <tr><td>4</td><td>Is it structural (multi-year, contract) or one-time?</td><td>3s</td></tr>
            <tr><td>5</td><td>Score it: M+P+V+S+V mental sum.</td><td>10s</td></tr>
            <tr><td>6</td><td>Pre-mortem: what could make this fail?</td><td>3s</td></tr>
            <tr><td>7</td><td>Decision: Long / Short / Sector / Ignore</td><td>3s</td></tr>
            <tr><td>8</td><td>Pick instrument + position size + stop.</td><td>3s</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── CLOSING ──────────────────────────────────────────────────────── */}
      <h2>📝 Final Words</h2>
      <p>
        Markets reward those who triage well. Discord, Twitter, and Bloomberg push 200+ items per day at you. The ones
        that change a stock&apos;s 3-year trajectory are usually one or two per week. Your edge is the speed and accuracy of
        your filter.
      </p>
      <p>
        <b>The one-sentence rule:</b> &quot;If no $ number — ignore. If small relative to company — ignore. If structural — long.
        If one-time — short trade. If sectoral — basket. Everything else is noise.&quot;
      </p>
      <p>
        Re-read this page once a month. The patterns repeat. The names change.
      </p>

      <div style={{ marginTop: 28, padding: 14, background: C.panel2, border: `1px dashed ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text2 }}>
        <b style={{ color: C.amber }}>Disclaimer:</b> Educational framework with retrospective examples. Returns cited are
        historical and approximate. Past patterns don&apos;t guarantee future results. Position sizing and stops must reflect
        your individual risk tolerance. This is not investment advice — always do your own due diligence and verify
        before trading.
      </div>
    </div>
  );
}
