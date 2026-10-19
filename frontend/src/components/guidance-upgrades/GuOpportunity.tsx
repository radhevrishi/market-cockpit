'use client';
// zzz929 — the Opportunity score and Implied EPS cells of the focus-list tables, and the click-open breakdown under a row.
// All figures come from lib/gu-opportunity (pure, no model call). Light colours only; no trade words, no score out of a hundred.
import React from 'react';
import { R, tint } from './gu-tokens';
import { OPP_BAND_WORDS, impliedCell, type Opportunity, type OppBand } from '@/lib/gu-opportunity';

export const OPP_COLS = 2;   // Implied EPS + Opportunity
export const OPP_BAND_COLOR: Record<OppBand, string> = { HIGH: R.green, GOOD: R.cyan, MIXED: R.amber, LOW: R.grey };
const TIER_COLOR = { 1: R.green, 2: R.green, 3: R.amber, 4: R.red } as const;

export function OppHead({ sort, onSort }: { sort: string; onSort: () => void }) {
  return (
    <button type="button" onClick={onSort} aria-pressed={sort === 'opp'} title="Sort by the Opportunity score; click again for the focus order"
      style={{ all: 'unset', cursor: 'pointer', color: sort === 'opp' ? R.green : R.dim, fontWeight: 800 }}>
      Opportunity {sort === 'opp' ? '▼' : '⇅'}
    </button>
  );
}

/** Two cells: Implied EPS and Opportunity. `o` is null while the company figures are still being read. */
export function OppCells({ o, waiting, open, onToggle, td }: { o: Opportunity | null; waiting: boolean; open: boolean; onToggle: () => void; td: React.CSSProperties }) {
  if (!o) {
    const w = waiting ? '…' : '—';
    return <><td data-c="eps" style={{ ...td, color: R.dim }}>{w}</td><td data-c="opp" style={{ ...td, color: R.dim, fontSize: 12 }}>{waiting ? 'reading figures…' : '—'}</td></>;
  }
  const ic = impliedCell(o);
  const col = o.band ? OPP_BAND_COLOR[o.band] : R.grey;
  const tip = `${o.summary}${o.capNote ? `. ${o.capNote}` : ''}. Click for every part.`;
  return (
    <>
      <td data-c="eps" style={{ ...td, whiteSpace: 'nowrap' }} title={o.implied.pct == null ? `Implied EPS growth not worked out: ${o.implied.reason}` : `${o.implied.basis}. EPS = net profit growth with the share count unchanged.`}>
        <b style={{ color: o.implied.pct != null && o.implied.pct >= 20 ? R.green : undefined }}>{ic.main}</b>
        <div style={{ fontSize: 10.5, color: R.dim }}>{o.implied.pct == null ? '' : o.implied.approx ? 'Model estimate · fixed shares' : 'Guidance-based · fixed shares'}</div>
        {o.implied.basis.includes('capped at 100%') ? <div style={{ fontSize: 10.5, color: R.amber }}>Growth capped in model</div> : null}
        {ic.sub ? <div style={{ fontSize: 10.5, color: R.dim }}>{ic.sub}</div> : null}
      </td>
      <td data-c="opp" style={td}>
        <button type="button" onClick={onToggle} aria-expanded={open} title={tip} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 2 }}>
          {o.score == null
            ? <span style={{ fontSize: 12, fontWeight: 700, color: R.grey, whiteSpace: 'nowrap' }}>not enough data</span>
            : <span style={{ whiteSpace: 'nowrap' }}><b style={{ fontSize: 16, color: col }}>{o.score}</b> <b style={{ fontSize: 11.5, color: col }}>{o.band}</b></span>}
          <span style={{ fontSize: 11, color: R.dim, whiteSpace: 'nowrap' }}>{o.summary.replace(' (no street data for India)', '')} {open ? '▴' : '▾'}</span>
        </button>
      </td>
    </>
  );
}

const MARK = { known: { t: '●', c: R.green, w: 'known' }, unknown: { t: '?', c: R.grey, w: 'not known' }, na: { t: '–', c: R.grey, w: 'no source for this market' } } as const;

/** The breakdown under a row: every part with its points, then the detail lines the review asked for. */
export function OppBreakdownRow({ o, cols }: { o: Opportunity; cols: number }) {
  const box: React.CSSProperties = { margin: 0, padding: 0, display: 'grid', gap: 3, fontSize: 12.5 };
  const col = o.band ? OPP_BAND_COLOR[o.band] : R.grey;
  const q = o.quality;
  return (
    <tr><td colSpan={cols} style={{ padding: '6px 10px 12px 34px', borderBottom: `1px solid ${tint(R.grey, 18)}`, background: tint(R.cyan, 5) }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12.5 }}>
          {o.score == null ? <b>Not enough data for an Opportunity score</b> : <><b style={{ color: col }}>{o.score} {o.band}</b> — {o.band ? OPP_BAND_WORDS[o.band] : ''}</>}
          {o.capNote ? <span style={{ color: R.dim }}> · {o.capNote}</span> : null}
        </div>
        <div><b style={{ fontSize: 12 }}>Parts (points earned of the most each can give; a part not known earns nothing)</b>
          <ul style={box}>{o.parts.map((p) => (
            <li key={p.id} style={{ listStyle: 'none', display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <b style={{ color: MARK[p.status].c, width: 14, flex: 'none' }} title={MARK[p.status].w}>{MARK[p.status].t}</b>
              <span><b>{p.label}</b>{p.status === 'na' ? '' : ` (${p.points} of ${p.max})`} — {p.detail}</span>
            </li>))}
          </ul>
        </div>
        <div style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
          <span><b>Raise quality:</b> {q.tier == null ? <span style={{ color: R.dim }}>not rated — {q.detail}</span> : <><b style={{ color: TIER_COLOR[q.tier] }}>Tier {q.tier} · {q.label}</b> <span style={{ color: R.dim }}>— {q.detail}</span></>}</span>
          <span><b>Implied EPS:</b> {o.implied.pct == null ? <span style={{ color: R.dim }}>not worked out — {o.implied.reason}</span> : <>{o.implied.approx ? '~' : ''}{o.implied.pct >= 0 ? '+' : ''}{o.implied.pct}%{o.implied.perYear ? ' a year' : ''} <span style={{ color: R.dim }}>— {o.implied.basis}. EPS here means net profit growth with the share count unchanged.</span></>}</span>
          {o.implied.incremental ? <span><b>Old → new guidance:</b> <span style={{ color: R.dim }}>{o.implied.incremental.text}</span></span> : null}
          <span><b>Growth still needed:</b> <span style={{ color: o.required.far ? R.red : R.dim }}>{o.required.computed ? o.required.text : `not shown — ${o.required.reason}`}</span></span>
          <span><b>Duration:</b> <span style={{ color: R.dim }}>{o.duration.known ? `${o.duration.label} — ${o.duration.note}` : o.duration.note}</span></span>
          {o.street.available
            ? <span><b>Against the street (USA):</b> <b style={{ color: o.street.verdict === 'above' ? R.green : o.street.verdict === 'below' ? R.red : R.dim }}>{o.street.verdict} street</b> <span style={{ color: R.dim }}>— {o.street.text}</span></span>
            : <span><b>Against the street:</b> <span style={{ color: R.dim }}>not shown — {o.street.reason}</span></span>}
        </div>
        <div style={{ fontSize: 11.5, color: R.dim }}>
          The Opportunity score is separate from the Sky Gold score: Sky Gold asks whether the business can carry the plan; this asks how much the guidance changes profit and how supportive the setup is. It uses public figures only, no model call. Bands: 75+ HIGH · 60–74 GOOD · 40–59 MIXED · under 40 LOW. A high score needs most parts known and strong. An estimate, not advice.
        </div>
      </div>
    </td></tr>
  );
}
