'use client';
// zzz1041 — the Bought · Watchlist · Rejected control on every Conviction Beats
// card and table row (India and US). The marks are decision-logbook rows (see
// lib/cb-decisions.ts); this file only draws them and calls the lib.

import { useRef, useState, useSyncExternalStore } from 'react';
import {
  CB_MARKS, CB_MARK_META, CB_MARK_FILTERS, CB_MARK_FILTER_LABEL, cbMarkStamp, toggleCbMark, setCbMarkNote, attachCbMarkPrice,
  rejectedHiddenLine, type CbMark, type CbMarkFilter,
} from '@/lib/cb-decisions';
import { readDecisions, subscribeDecisions, type Decision, type DecisionMarket } from '@/lib/decisions';

/** The decision logbook, re-read whenever it changes (this tab or another).
 *  The snapshot is re-parsed only when the stored text changes, so React sees a
 *  stable object between changes; the server render sees an empty logbook. */
const EMPTY_DECISIONS: Record<string, Decision> = {};
let _snap: { raw: string | null; map: Record<string, Decision> } = { raw: null, map: EMPTY_DECISIONS };
function decisionsSnapshot(): Record<string, Decision> {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem('mc:decisions:v1'); } catch { raw = null; }
  if (raw !== _snap.raw) _snap = { raw, map: raw ? readDecisions() : EMPTY_DECISIONS };
  return _snap.map;
}
export function useDecisionsMap(): Record<string, Decision> {
  return useSyncExternalStore(subscribeDecisions, decisionsSnapshot, () => EMPTY_DECISIONS);
}

export interface CbMarkControlProps {
  ticker: string;
  market: DecisionMarket;
  mark: CbMark | null;
  decision?: Decision;
  company?: string | null;
  /** Price now, when the row carries one (US). India looks the price up once after marking. */
  price?: number | null;
  score?: number | null;
  grade?: string | null;
  /** 'card' = control + note + stamp on their own line; 'row' = compact, stamp on hover. */
  variant?: 'card' | 'row';
}

export function CbMarkControl({ ticker, market, mark, decision, company, price, score, grade, variant = 'card' }: CbMarkControlProps) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(decision?.reason ?? '');
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const choose = (m: CbMark) => {
    const d = toggleCbMark(ticker, market, m, { company, price, score, grade });
    if (d && !(typeof d.priceAtDecision === 'number' && d.priceAtDecision > 0)) void attachCbMarkPrice(ticker, market, d.date);
  };
  const doneRef = useRef(false);   // Enter / Esc already handled — the blur that follows must not save again
  const saveNote = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (note.trim() !== (decision?.reason ?? '')) setCbMarkNote(ticker, market, note.trim());
    setEditing(false);
  };
  const cancelNote = () => { doneRef.current = true; setNote(decision?.reason ?? ''); setEditing(false); };
  const startEdit = () => { doneRef.current = false; setNote(decision?.reason ?? ''); setEditing(true); };

  // Arrow keys move between the three options (radio-group convention).
  const onKey = (ev: React.KeyboardEvent, i: number) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    ev.preventDefault();
    const n = CB_MARKS.length;
    const j = ev.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
    btnRefs.current[j]?.focus();
  };

  const stamp = cbMarkStamp(decision, market);
  const small = variant === 'row';
  const label = `Your mark for ${ticker}`;
  return (
    <div data-testid="cb-mark" data-mark={mark ?? 'none'}
      style={{ display: 'flex', alignItems: 'center', gap: small ? 4 : 6, flexWrap: 'wrap', fontFamily: 'ui-sans-serif, system-ui' }}
      onClick={(ev) => ev.stopPropagation()}>
      <div role="radiogroup" aria-label={label}
        style={{ display: 'inline-flex', border: '1px solid var(--mc-bg-4)', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
        {CB_MARKS.map((m, i) => {
          const meta = CB_MARK_META[m];
          const on = mark === m;
          return (
            <button key={m} type="button" role="radio" aria-checked={on}
              ref={(el) => { btnRefs.current[i] = el; }}
              tabIndex={on || (mark == null && i === 0) ? 0 : -1}
              onKeyDown={(ev) => onKey(ev, i)}
              onClick={() => choose(m)}
              data-testid={`cb-mark-${m}`}
              title={on ? `${meta.label} — click again to clear the mark` : `Mark as ${meta.label}. ${meta.hint}`}
              style={{
                fontSize: small ? 9.5 : 10.5, fontWeight: 800, letterSpacing: '0.2px',
                padding: small ? '2px 6px' : '3px 9px', cursor: 'pointer', whiteSpace: 'nowrap',
                border: 'none', borderLeft: i === 0 ? 'none' : '1px solid var(--mc-bg-4)',
                background: on ? meta.color : 'transparent',
                color: on ? '#fff' : 'var(--mc-text-3)',
                outlineOffset: -2,
              }}>
              {meta.label}
            </button>
          );
        })}
      </div>
      {mark && !editing && (
        <button type="button" onClick={startEdit} data-testid="cb-mark-note-edit"
          aria-label={decision?.reason ? `Edit the note for ${ticker}` : `Add a note for ${ticker}`}
          title={decision?.reason ? `Note: ${decision.reason} — click to edit` : 'Add a one-line note (why)'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: small ? 11 : 12, color: decision?.reason ? 'var(--mc-text-2)' : 'var(--mc-text-4)' }}>✎</button>
      )}
      {mark && editing && (
        <input autoFocus value={note} maxLength={500} data-testid="cb-mark-note-input"
          aria-label={`Note for ${ticker}`} placeholder="one-line note — Enter to save, Esc to cancel"
          onChange={(ev) => setNote(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') saveNote(); if (ev.key === 'Escape') cancelNote(); }}
          onBlur={saveNote}
          style={{ flex: '1 1 160px', minWidth: 120, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--mc-bg-4)', background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)' }} />
      )}
      {mark && !editing && !small && (
        <span data-testid="cb-mark-stamp" style={{ fontSize: 10, color: 'var(--mc-text-4)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={decision?.reason ? `${stamp} — ${decision.reason}` : stamp}>
          {stamp}{decision?.reason ? <span style={{ color: 'var(--mc-text-3)' }}> · {decision.reason}</span> : null}
        </span>
      )}
      {mark && !editing && small && stamp && (
        <span title={decision?.reason ? `${stamp} — ${decision.reason}` : stamp} style={{ fontSize: 9.5, color: 'var(--mc-text-4)', cursor: 'help' }}>ⓘ</span>
      )}
    </div>
  );
}

/** Small badge at a card's top-right: Bought / Watchlist (and Rejected when the card is shown greyed). */
export function CbMarkBadge({ mark }: { mark: CbMark | null }) {
  if (!mark) return null;
  const meta = CB_MARK_META[mark];
  return (
    <span data-testid={`cb-mark-badge-${mark}`} title={meta.hint}
      style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.5px', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
        border: `1px solid ${meta.color}`, color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}>
      {meta.icon} {meta.label.toUpperCase()}
    </span>
  );
}

/** The greyed look of a Rejected name that is shown. */
export const CB_REJECTED_DIM: React.CSSProperties = { opacity: 0.45, filter: 'grayscale(0.85)' };

/** YOUR MARK: All · Bought · Watchlist · Rejected · Unmarked — AND with every other filter. */
export function CbMarkFilterRow({ value, onChange, counts, presetOn }: {
  value: CbMarkFilter; onChange: (v: CbMarkFilter) => void; counts: Record<CbMarkFilter, number>; presetOn: boolean;
}) {
  const colorOf = (f: CbMarkFilter) => (f === 'all' || f === 'unmarked' ? '#94A3B8' : CB_MARK_META[f].color);
  return (
    <div data-testid="cb-mark-filter" role="group" aria-label="Filter by your mark"
      style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Your mark</span>
      {CB_MARK_FILTERS.map((f) => {
        const on = value === f;
        const c = colorOf(f);
        const tip = f === 'all'
          ? (presetOn ? 'Every name that passes your other filters, without the names you marked Rejected (the Quality Preset is on).' : 'Every name that passes your other filters; names you marked Rejected are shown greyed.')
          : f === 'unmarked' ? 'Names you have not marked yet.'
          : f === 'rejected' ? 'Only the names you marked Rejected (shown greyed, even with the Quality Preset on).'
          : `Only the names you marked ${CB_MARK_FILTER_LABEL[f]}.`;
        return (
          <button key={f} type="button" aria-pressed={on} onClick={() => onChange(on && f !== 'all' ? 'all' : f)} title={tip}
            data-testid={`cb-mark-filter-${f}`}
            style={{
              fontSize: 10.5, fontWeight: 700, padding: '4px 9px', borderRadius: 14, cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${on ? c : '#2A3B4C'}`, background: on ? `color-mix(in srgb, ${c} 14%, transparent)` : 'transparent',
              color: on ? c : '#8BA3C1',
            }}>
            {CB_MARK_FILTER_LABEL[f]} <span style={{ color: on ? c : 'var(--mc-text-4)', marginLeft: 3 }}>({counts[f] ?? 0})</span>
          </button>
        );
      })}
    </div>
  );
}

/** "N rejected hidden · show" / "N rejected shown greyed · hide". */
export function CbRejectedToggle({ count, showing, onToggle }: { count: number; showing: boolean; onToggle: () => void }) {
  if (count <= 0) return null;
  return (
    <button type="button" data-testid="cb-rejected-toggle" aria-pressed={showing} onClick={onToggle}
      title={showing ? 'Hide the names you marked Rejected again (they stay out of the exports either way while the Quality Preset is on).' : 'The Quality Preset hides names you marked Rejected. Show them greyed — they stay out of the exports.'}
      style={{ fontSize: 10.5, fontWeight: 800, padding: '1px 8px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${CB_MARK_META.rejected.color}66`, background: 'transparent', color: 'var(--mc-text-2)' }}>
      {rejectedHiddenLine(count, showing)}
    </button>
  );
}
