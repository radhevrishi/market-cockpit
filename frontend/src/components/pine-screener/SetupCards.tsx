'use client';
// zzz999 — the row of setup cards at the top of the Pine Screener: where to start. Each card is a built-in screen (or the portfolio
// check) with its count on today's data, and a small line drawing of the shape against its pivot (dashed).
import React from 'react';
import { SETUP_CARDS, type SetupCard, type SetupGlyph } from '@/lib/screener/pine-view';
import { C } from './pine-ui';

/** Small drawings: the dashed line is the pivot (the buy point; for a breakdown, the support level). */
function Glyph({ g, tone }: { g: SetupGlyph; tone: SetupCard['tone'] }) {
  const col = tone === 'up' ? C.green : tone === 'down' ? C.red : C.accent;
  const paths: Record<SetupGlyph, React.ReactNode> = {
    breakout: <><line x1="2" y1="12" x2="70" y2="12" strokeDasharray="3 3" /><path d="M2 20 L12 13 L20 18 L30 14 L40 19 L50 14 L56 13 L64 5 L70 2" /></>,
    ready: <><line x1="2" y1="9" x2="70" y2="9" strokeDasharray="3 3" /><path d="M2 21 L12 11 L22 19 L32 13 L42 17 L52 13 L60 14 L68 11" /></>,
    base: <><line x1="2" y1="7" x2="70" y2="7" strokeDasharray="3 3" /><path d="M2 7 C 14 9, 18 22, 36 22 C 52 22, 58 11, 68 8" /></>,
    breakdown: <><line x1="2" y1="15" x2="70" y2="15" strokeDasharray="3 3" /><path d="M2 14 L10 6 L18 13 L28 5 L36 13 L46 7 L54 14 L62 20 L70 23" /></>,
    weekly: <><line x1="2" y1="7" x2="70" y2="7" strokeDasharray="3 3" />{[6, 14, 22, 30, 38, 46, 54, 62].map((x, i) => { const y = [9, 14, 18, 20, 19, 15, 11, 8][i]; return <line key={x} x1={x} y1={y - 3} x2={x} y2={y + 3} strokeWidth={3} />; })}</>,
    monthly: <><line x1="2" y1="6" x2="70" y2="6" strokeDasharray="3 3" />{[8, 22, 36, 50, 64].map((x, i) => { const y = [9, 17, 21, 15, 8][i]; return <rect key={x} x={x - 4} y={y - 4} width={8} height={8} rx={1} strokeWidth={1.6} />; })}</>,
    portfolio: <><path d="M2 18 L14 15 L26 16 L38 11 L50 12 L62 7 L70 6" /><path d="M2 20 L70 12" strokeDasharray="2 3" opacity={0.7} /><path d="M2 23 L70 18" strokeDasharray="1 3" opacity={0.55} /></>,
  };
  return (
    <svg width="72" height="26" viewBox="0 0 72 26" aria-hidden style={{ display: 'block', marginBottom: 4 }}
      fill="none" stroke={col} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {paths[g]}
    </svg>
  );
}

export function SetupCards({ active, counts, onPick, loading }: { active: string | null; counts: Record<string, number | null>; onPick: (c: SetupCard) => void; loading: boolean }) {
  return (
    <div className="pnx-cards" role="group" aria-label="Start from a setup">
      {SETUP_CARDS.map((c) => {
        const n = counts[c.id];
        return (
          <button key={c.id} type="button" className="pnx-card" aria-pressed={active === c.id} onClick={() => onPick(c)} data-card={c.id}
            title={`${c.label}: ${c.sub}`}>
            <Glyph g={c.glyph} tone={c.tone} />
            <span className="pnx-card-count" aria-busy={n == null && loading} style={{ color: n == null ? C.faint : C.text }}>{n == null ? '…' : n.toLocaleString('en-US')}</span>
            <span className="pnx-card-label">{c.label}</span>
            <span className="pnx-card-sub">{c.sub}</span>
            {c.alt && counts[`${c.id}:alt`] != null ? <span className="pnx-card-sub" data-alt-count={c.alt.presetId} style={{ color: C.text1 }}>+ {counts[`${c.id}:alt`]!.toLocaleString('en-US')} {c.alt.label} (counted apart)</span> : null}
          </button>
        );
      })}
    </div>
  );
}
