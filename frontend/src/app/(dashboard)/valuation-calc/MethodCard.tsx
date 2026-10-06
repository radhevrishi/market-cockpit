'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState } from 'react';
import { BORDER, TEXT, DIM } from './constants';
import { PRACTICE_EXAMPLES } from './constants2';
import { exSlug } from './helpers';
import { type GuidanceMethod } from './types';

export function MethodCard({ m, idx }: { m: GuidanceMethod; idx: number }) {
  const [open, setOpen] = useState(idx < 3);  // first 3 open by default
  return (
    <div style={{ background: '#0D1426', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', background: 'transparent', border: 'none',
        padding: '14px 18px', textAlign: 'left', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, minWidth: 40, fontFamily: 'ui-monospace, monospace' }}>#{String(idx + 1).padStart(2, '0')}</span>
        <span style={{ fontSize: 20 }}>{m.emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: TEXT, flex: 1 }}>{m.title}</span>
        <span style={{ fontSize: 14, color: DIM }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 18px 18px' }}>
          <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.6, marginBottom: 14 }}>{m.description}</div>

          {/* Example quotes */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 6 }}>REAL EXAMPLES FROM INDIAN COMPANIES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {m.examples.map((e, i) => (
                <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 3 }}>
                  <span style={{ fontWeight: 800, color: 'var(--mc-cyan)', marginRight: 8 }}>{e.company}:</span>
                  <span style={{ color: TEXT, fontStyle: 'italic' }}>"{e.quote}"</span>
                </div>
              ))}
            </div>
          </div>

          {/* Variables needed */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 6 }}>VARIABLES YOU NEED</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {m.variables.map((v, i) => (
                <span key={i} style={{ fontSize: 11, padding: '3px 10px', background: '#1F2940', color: TEXT, borderRadius: 12, border: `1px solid ${BORDER}` }}>{v}</span>
              ))}
            </div>
          </div>

          {/* Formula */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 6 }}>FORMULA</div>
            <div style={{ background: '#000', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.65, color: '#A7F3D0' }}>
              {m.formula.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>

          {/* Worked example */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px', marginBottom: 6 }}>WORKED EXAMPLE — {m.worked.company.toUpperCase()}</div>
            <div style={{ background: '#1A1F33', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: DIM, marginBottom: 5 }}>INPUTS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
                <tbody>
                  {m.worked.inputs.map((inp, i) => (
                    <tr key={i} style={{ borderBottom: i === m.worked.inputs.length - 1 ? 'none' : `1px solid ${BORDER}` }}>
                      <td style={{ padding: '5px 8px 5px 0', color: DIM }}>{inp.label}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{inp.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ fontSize: 11, fontWeight: 800, color: DIM, marginBottom: 5 }}>STEPS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {m.worked.steps.map((s, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '6px 8px 6px 0', color: TEXT, fontWeight: 700 }}>{s.label}</td>
                      <td style={{ padding: '6px 8px', color: DIM, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{s.calc}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{s.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 12, padding: '10px 12px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 3 }}>FAIR VALUE → {m.worked.fairValue}</div>
                <div style={{ fontSize: 12, color: TEXT }}>{m.worked.upside}</div>
              </div>
            </div>
          </div>

          {/* PATCH 0661 — Practice example shortcuts. Click any company chip
              to scroll directly to its full calculation in the Practice
              Examples section below. */}
          {(() => {
            const matches = PRACTICE_EXAMPLES.filter(ex => ex.methodIds.includes(m.id));
            if (matches.length === 0) return null;
            return (
              <div style={{ marginTop: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.5px', marginBottom: 6 }}>
                  → JUMP TO PRACTICE EXAMPLE ({matches.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {matches.map((ex, i) => (
                    <a key={i} href={`#${exSlug(ex.company)}`} style={{
                      fontSize: 11, padding: '4px 10px',
                      background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)',
                      color: 'var(--mc-bullish)', borderRadius: 4, fontWeight: 700,
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}>
                      {ex.company.replace(/ Ltd$/, '').replace(/ Industries$/, '')} ↓
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Tips */}
          {m.tips && m.tips.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.5px', marginBottom: 6 }}>TIPS</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: TEXT, lineHeight: 1.65 }}>
                {m.tips.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
