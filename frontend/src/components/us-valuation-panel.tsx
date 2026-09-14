'use client';

// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT IS WORTH — the panel  (zzz628)
//
// The arithmetic lives in lib/us-valuation.ts and is reproducible from the
// filed quarters. This renders it, and it is built around one idea: the
// reader must be able to see WHICH ASSUMPTION is doing the work. So every
// scenario shows its growth basis and its multiple basis in words, and every
// upside is split into the half that comes from earnings (earned) and the half
// that comes from the multiple (borrowed). A target price with no visible
// assumptions is a number to be believed; this is one to be argued with.
//
// The multiples are editable because the multiple is the one input arithmetic
// cannot supply — it is a judgement about what the market will pay. Machines
// calculate, you decide, and this is exactly where the line falls.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { valuationFor, type ValuationOpts } from '@/lib/us-valuation';
import type { UsConvictionEntry } from '@/lib/conviction-beats-us';

const DIM = 'var(--mc-text-3)';
const MUT = 'var(--mc-text-2)';
const TXT = 'var(--mc-text-0)';

const mono: React.CSSProperties = { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' };

function NumBox({ label, value, onChange, suffix, title }: {
  label: string; value: number; onChange: (v: number) => void; suffix?: string; title?: string;
}) {
  return (
    <label title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: DIM }}>
      {label}
      <input type="number" value={Number.isFinite(value) ? value : ''} step={0.5}
        onChange={(ev) => { const n = parseFloat(ev.target.value); if (Number.isFinite(n)) onChange(n); }}
        style={{
          ...mono, width: 56, fontSize: 10.5, padding: '2px 5px', borderRadius: 5,
          border: '1px solid var(--mc-bg-4)', background: 'var(--mc-bg-2)', color: TXT,
        }} />
      {suffix ? <span>{suffix}</span> : null}
    </label>
  );
}

export default function UsValuationPanel({ e }: { e: UsConvictionEntry }) {
  const [horizon, setHorizon] = useState(3);
  const [over, setOver] = useState<ValuationOpts>({});
  const [showWork, setShowWork] = useState(false);

  const res = useMemo(() => valuationFor(e, { ...over, horizonYears: horizon }), [e, over, horizon]);

  if (!res.ok) {
    return (
      <div style={{ fontSize: 11, color: DIM, padding: '8px 0', lineHeight: 1.5 }}>
        <b style={{ color: MUT }}>What it is worth</b> — not computable here: {res.reason}.
        <div style={{ marginTop: 3 }}>No estimate is shown rather than one built on a guessed input.</div>
      </div>
    );
  }
  const v = res.value;
  const tx = v.threeX;
  const txCol = tx.score >= 70 ? '#22C55E' : tx.score >= 45 ? '#EAB308' : '#EF4444';

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--mc-bg-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
        <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 0.5, color: MUT }}>💰 WHAT IT IS WORTH — price = EPS × multiple</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {[2, 3, 5].map((h) => (
            <button key={h} onClick={() => setHorizon(h)} style={{
              fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${horizon === h ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
              background: horizon === h ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'transparent',
              color: horizon === h ? 'var(--mc-cyan)' : DIM,
            }}>{h}y</button>
          ))}
          {Object.keys(over).length > 0 && (
            <button onClick={() => setOver({})} style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--mc-bg-4)', background: 'transparent', color: DIM }}>reset assumptions</button>
          )}
        </div>
      </div>

      {/* The two facts everything below rests on, stated before anything is
          derived from them — so a wrong valuation can be traced to a wrong
          input rather than argued about as a conclusion. */}
      <div style={{ ...mono, fontSize: 10.5, color: DIM, marginBottom: 8, lineHeight: 1.6 }}>
        Trailing EPS <b style={{ color: TXT }}>${v.ttm.value.toFixed(2)}</b> <span title={v.ttm.note}>({v.ttm.parts.map((p) => p.toFixed(2)).join(' + ')})</span>
        {' · '}price <b style={{ color: TXT }}>${v.price.toFixed(2)}</b>
        {' · '}multiple <b style={{ color: TXT }}>{v.currentMultiple.toFixed(1)}×</b>
        {v.multipleDisagrees && <span style={{ color: '#F59E0B' }} title="Usually a GAAP-versus-adjusted EPS mismatch"> (feed says {v.feedMultiple?.toFixed(1)}× — different EPS basis)</span>}
        <div style={{ color: DIM }}>{v.growth.note}</div>
      </div>

      {/* ── THE THREE SCENARIOS ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 8 }}>
        {v.scenarios.map((s) => {
          const key = s.name.toLowerCase() as 'bear' | 'base' | 'bull';
          return (
            <div key={s.name} style={{
              background: `${s.color}0f`, border: `1px solid ${s.color}44`, borderRadius: 8, padding: '8px 9px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10.5, fontWeight: 900, color: s.color, letterSpacing: 0.4 }}>{s.name}</span>
                <span style={{ ...mono, fontSize: 13, fontWeight: 900, color: TXT }}>${s.targetPrice.toFixed(2)}</span>
              </div>
              <div style={{ ...mono, fontSize: 11, fontWeight: 800, color: (s.upsidePct ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>
                {(s.upsidePct ?? 0) >= 0 ? '+' : ''}{s.upsidePct?.toFixed(0)}% over {horizon}y
              </div>
              {/* EARNED versus BORROWED. A move that is mostly multiple is a
                  bet on sentiment; a move that is mostly earnings is a bet on
                  the business. The raw upside cannot tell them apart. */}
              {s.fromEarningsPct != null && s.fromMultiplePct != null && (
                <div style={{ ...mono, fontSize: 9, color: DIM, marginTop: 3 }}
                  title="How the move splits. Earnings growth is earned; multiple expansion is borrowed from sentiment and can be taken back.">
                  earnings <b style={{ color: '#34D399' }}>{s.fromEarningsPct >= 0 ? '+' : ''}{s.fromEarningsPct.toFixed(0)}%</b>
                  {' · '}multiple <b style={{ color: Math.abs(s.fromMultiplePct) > Math.abs(s.fromEarningsPct) ? '#F59E0B' : MUT }}>{s.fromMultiplePct >= 0 ? '+' : ''}{s.fromMultiplePct.toFixed(0)}%</b>
                </div>
              )}
              <div style={{ display: 'flex', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
                <NumBox label="g" value={s.growthPct} suffix="%/yr"
                  title={s.growthBasis}
                  onChange={(n) => setOver((p) => ({ ...p, [`${key}GrowthPct`]: n }))} />
                <NumBox label="×" value={s.multiple}
                  title={s.multipleBasis}
                  onChange={(n) => setOver((p) => ({ ...p, [`${key}Multiple`]: n }))} />
              </div>
              {showWork && (
                <div style={{ fontSize: 9, color: DIM, marginTop: 5, lineHeight: 1.45 }}>
                  <div><b style={{ color: MUT }}>growth:</b> {s.growthBasis}</div>
                  <div style={{ marginTop: 2 }}><b style={{ color: MUT }}>multiple:</b> {s.multipleBasis}</div>
                  <div style={{ ...mono, marginTop: 2 }}>${v.ttm.value.toFixed(2)} × (1+{(s.growthPct / 100).toFixed(2)})^{horizon} = ${s.forwardEps.toFixed(2)} × {s.multiple.toFixed(1)} = ${s.targetPrice.toFixed(2)}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── THE 3× TEST ─────────────────────────────────────────────────── */}
      <div style={{ marginTop: 9, background: `${txCol}0f`, border: `1px solid ${txCol}3d`, borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, color: txCol, letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
            3× POTENTIAL · {tx.score} · {tx.verdict}
          </span>
          <span style={{ fontSize: 11, color: MUT, flex: 1, minWidth: 220, lineHeight: 1.5 }}>{tx.sentence}</span>
        </div>
        {tx.caveats.length > 0 && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 10, color: '#F59E0B', lineHeight: 1.5 }}>
            {tx.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <button onClick={() => setShowWork((s) => !s)} style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--mc-bg-4)', background: 'transparent', color: DIM }}>
          {showWork ? 'hide the working' : 'show the working'}
        </button>
        <span style={{ fontSize: 9.5, color: DIM, flex: 1, minWidth: 240, lineHeight: 1.5 }}>
          Every growth rate here is one this company has printed, computed from its filed quarters — there is no consensus estimate and no model opinion in any of it. The multiples are assumptions, defaulted from what the market pays today; change them and everything recomputes. Nothing on this panel is a recommendation.
        </span>
      </div>
    </div>
  );
}
