'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo } from 'react';
import { pricedValue } from '@/lib/book-totals';
import { REGIME_PHASES_PF } from './constants';
import { classifyRegime } from './helpers';
import { type PortfolioRow, type RegimeBucket } from './types';

export function PortfolioRegimeExposure({ rows }: { rows: PortfolioRow[] }) {
  const [phaseKey, setPhaseKey] = useState<string>('stag');
  const phase = REGIME_PHASES_PF.find(p => p.key === phaseKey) || REGIME_PHASES_PF[3];
  const totalValue = useMemo(() => rows.reduce((a, r) => a + (pricedValue(r)), 0), [rows]);

  // buckets for the selected phase
  const buckets = useMemo(() => {
    const out: Record<RegimeBucket, { value: number; rows: PortfolioRow[] }> = {
      FAVORED: { value: 0, rows: [] }, NEUTRAL: { value: 0, rows: [] }, EXPOSED: { value: 0, rows: [] },
    };
    rows.forEach(r => {
      const b = classifyRegime(r.sector, phase);
      out[b].value += pricedValue(r);
      out[b].rows.push(r);
    });
    return out;
  }, [rows, phase]);

  // readiness across all 7 phases (% favored by value)
  const readiness = useMemo(() => REGIME_PHASES_PF.map(p => {
    let fav = 0, exp = 0;
    rows.forEach(r => {
      const b = classifyRegime(r.sector, p);
      if (b === 'FAVORED') fav += pricedValue(r);
      else if (b === 'EXPOSED') exp += pricedValue(r);
    });
    return { p, favPct: totalValue > 0 ? (fav / totalValue) * 100 : 0, expPct: totalValue > 0 ? (exp / totalValue) * 100 : 0 };
  }), [rows, totalValue]);

  const pct = (v: number) => totalValue > 0 ? (v / totalValue) * 100 : 0;
  const fmtCr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
  const BUCKET_META: Record<RegimeBucket, { c: string; label: string }> = {
    FAVORED: { c: '#10B981', label: 'FAVORED — owns the right things' },
    NEUTRAL: { c: '#94A3B8', label: 'NEUTRAL — no strong tilt' },
    EXPOSED: { c: '#EF4444', label: 'EXPOSED — in this phase’s avoid list' },
  };

  // dominant tilt + blind spot from readiness
  const bestPhase = readiness.reduce((a, b) => b.favPct > a.favPct ? b : a, readiness[0]);
  const worstPhase = readiness.reduce((a, b) => b.expPct > a.expPct ? b : a, readiness[0]);

  const card = { background: '#0D1B2E', border: '1px solid #2A3B4C', borderRadius: 12, padding: '16px 18px' };
  const hdr = { fontSize: 13, fontWeight: 800, color: '#60A5FA', letterSpacing: '0.3px', marginBottom: 12 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* intro */}
      <div style={{ ...card }}>
        <div style={hdr}>🌀 Regime Exposure — how your book leans if the macro regime turns</div>
        <div style={{ fontSize: 12.5, color: 'var(--mc-text-3)', lineHeight: 1.6 }}>
          Each holding&rsquo;s sector is mapped onto the 7-phase framework from{' '}
          <a href="/market-cycles" style={{ color: '#60A5FA' }}>Market Cycles → Regime Rotation</a>. Pick a phase to see which slice of your capital owns the right things and which sits in that phase&rsquo;s avoid list. This is scenario stress-testing, not a forecast.
        </div>
      </div>

      {/* phase selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {REGIME_PHASES_PF.map(p => (
          <button key={p.key} onClick={() => setPhaseKey(p.key)} style={{
            padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800,
            background: phaseKey === p.key ? `${p.c}22` : 'transparent',
            border: `1px solid ${phaseKey === p.key ? p.c : 'var(--mc-border-2)'}`,
            color: phaseKey === p.key ? p.c : 'var(--mc-text-3)',
          }}>{p.emoji} {p.name}</button>
        ))}
      </div>

      {/* selected phase result */}
      <div style={{ ...card, borderLeft: `4px solid ${phase.c}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: phase.c }}>{phase.emoji} {phase.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--mc-text-4)', maxWidth: 460, textAlign: 'right', lineHeight: 1.5 }}>{phase.note}</div>
        </div>
        {/* stacked bar */}
        <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--mc-border-2)' }}>
          {(['FAVORED', 'NEUTRAL', 'EXPOSED'] as RegimeBucket[]).map(b => {
            const p = pct(buckets[b].value);
            if (p < 0.5) return null;
            return (
              <div key={b} title={`${BUCKET_META[b].label}: ${p.toFixed(0)}%`} style={{ width: `${p}%`, background: BUCKET_META[b].c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {p >= 8 && <span style={{ fontSize: 11, fontWeight: 800, color: '#0A0E1A' }}>{p.toFixed(0)}%</span>}
              </div>
            );
          })}
        </div>
        {/* bucket detail */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
          {(['FAVORED', 'EXPOSED', 'NEUTRAL'] as RegimeBucket[]).map(b => (
            <div key={b} style={{ background: 'var(--mc-bg-1)', border: `1px solid ${BUCKET_META[b].c}44`, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: BUCKET_META[b].c, letterSpacing: '0.3px' }}>{b}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-text-2)' }}>{pct(buckets[b].value).toFixed(0)}%</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 2 }}>{fmtCr(buckets[b].value)} · {buckets[b].rows.length} holding{buckets[b].rows.length === 1 ? '' : 's'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                {buckets[b].rows.slice().sort((x, y) => (y.currentValue || 0) - (x.currentValue || 0)).slice(0, 12).map(r => (
                  <span key={r.symbol} title={`${r.sector || 'sector n/a'} · ${pct(pricedValue(r)).toFixed(1)}% of book`} style={{
                    fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                    background: `${BUCKET_META[b].c}18`, color: BUCKET_META[b].c, border: `1px solid ${BUCKET_META[b].c}33`,
                  }}>{r.symbol}</span>
                ))}
                {buckets[b].rows.length === 0 && <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>none</span>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginTop: 12, lineHeight: 1.6 }}>
          {pct(buckets.EXPOSED.value) >= 30
            ? `⚠ ${pct(buckets.EXPOSED.value).toFixed(0)}% of your book sits in this phase’s avoid list — a meaningful drawdown vector if ${phase.name} plays out.`
            : pct(buckets.FAVORED.value) >= 50
              ? `✓ ${pct(buckets.FAVORED.value).toFixed(0)}% of your book is positioned for ${phase.name}. Well-aligned to this scenario.`
              : `Your book is largely neutral to ${phase.name} — neither strongly positioned nor exposed.`}
        </div>
      </div>

      {/* readiness across all phases */}
      <div style={{ ...card }}>
        <div style={hdr}>Regime readiness — % of capital favored vs exposed, every phase</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {readiness.map(({ p, favPct, expPct }) => (
            <div key={p.key} onClick={() => setPhaseKey(p.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', opacity: phaseKey === p.key ? 1 : 0.85 }}>
              <span style={{ width: 150, fontSize: 11.5, fontWeight: 700, color: phaseKey === p.key ? p.c : 'var(--mc-text-3)', flexShrink: 0 }}>{p.emoji} {p.name}</span>
              <div style={{ flex: 1, height: 16, background: 'var(--mc-bg-1)', borderRadius: 4, overflow: 'hidden', display: 'flex', position: 'relative' }}>
                <div style={{ width: `${favPct}%`, background: '#10B981', height: '100%' }} />
                <div style={{ width: `${expPct}%`, background: '#EF4444', height: '100%' }} />
              </div>
              <span style={{ width: 92, fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: 'var(--mc-text-4)', textAlign: 'right', flexShrink: 0 }}>
                <span style={{ color: '#10B981', fontWeight: 700 }}>{favPct.toFixed(0)}%</span> / <span style={{ color: '#EF4444', fontWeight: 700 }}>{expPct.toFixed(0)}%</span>
              </span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginTop: 12, lineHeight: 1.6 }}>
          Best aligned: <b style={{ color: bestPhase.p.c }}>{bestPhase.p.name}</b> ({bestPhase.favPct.toFixed(0)}% favored).
          Biggest blind spot: <b style={{ color: worstPhase.p.c }}>{worstPhase.p.name}</b> ({worstPhase.expPct.toFixed(0)}% of book exposed).
          Green = favored, red = exposed. Holdings with no mapped sector count as neutral.
        </div>
      </div>
    </div>
  );
}
