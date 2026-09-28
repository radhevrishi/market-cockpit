'use client';

// ═══════════════════════════════════════════════════════════════════════════
// "New · last 10 days" — the tab both Portfolio Catalysts pages share.
//                                                        (zzz808 → zzz813)
// Opening it should answer two questions at once: what actually happened,
// and does it matter. Each row is one event (filings of the same event within
// two days are merged — "3 filings", expandable), with the one line the
// document states, Material / Notable in words, and what it does to the
// thesis. Minor items and routine paperwork sit behind one toggle. ONE filter:
// event type. The data comes from lib/catalyst/recent-events (pure) and the
// deterministic document reader; this file only draws it.
// ═══════════════════════════════════════════════════════════════════════════

import { Fragment, useMemo, useState } from 'react';
import {
  EVENT_TYPES, filterByType, daysAgo, typeCounts, windowRange, groupByDay, topOfWindow, rowAnchor, dayLabel, inRange, WINDOW_SPANS,
  type RecentCatalystResult, type TypeFilter, type ThesisTouch, type RecentEvent, type Importance, type WindowSpan,
} from '@/lib/catalyst/recent-events';
import type { ReadProgress } from './use-filing-reads';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)',
  green: 'var(--mc-verdict-up, #34D399)', red: 'var(--mc-verdict-down, #F87171)', cyan: 'var(--tc-accent, #22D3EE)',
};

const TOUCH: Record<ThesisTouch, { label: string; color: string }> = {
  supports: { label: 'Supports', color: C.green },
  against: { label: 'Against', color: C.red },
  neutral: { label: 'Neutral', color: C.dim },
  'not assessed': { label: 'Not assessed', color: C.faint },
};
const IMP: Record<Importance, string> = { Material: C.text, Notable: C.dim, Minor: C.faint };

function when(date: string, today: string): string {
  const n = daysAgo(date, today);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

export interface NewCatalystsTabProps {
  result: RecentCatalystResult | null;
  loading: boolean;
  names: number;
  sourceNotes: string[];
  market: 'IN' | 'US';
  progress?: ReadProgress | null;
  onJump?: (ticker: string) => void;
  /** zzz814: the selected days — controlled by the page so the tab label counts the same window. */
  win?: { span: WindowSpan; anchor: string | null };
  onWin?: (w: { span: WindowSpan; anchor: string | null }) => void;
}

const SPAN_LABEL: Record<number, string> = { 1: 'Today', 3: '3d', 5: '5d', 10: '10d' };
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default function NewCatalystsTab({ result, loading, names, sourceNotes, market, progress, onJump, win, onWin }: NewCatalystsTabProps) {
  const [type, setType] = useState<TypeFilter>('All');
  const [showMinor, setShowMinor] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ownWin, setOwnWin] = useState<{ span: WindowSpan; anchor: string | null }>({ span: 10, anchor: null });
  const w = win || ownWin;
  const setW = (x: { span: WindowSpan; anchor: string | null }) => { if (onWin) onWin(x); else setOwnWin(x); };
  const today0 = result?.window.to || '';
  const range = useMemo(() => (today0 ? windowRange(today0, w.span, w.anchor, result?.window.days) : { from: '', to: '', days: 0 }), [today0, w.span, w.anchor, result?.window.days]);
  const inWin = useMemo(() => (result ? result.items.filter((e) => inRange(e.date, range, today0)) : []), [result, range, today0]);
  const counts = useMemo(() => typeCounts(inWin), [inWin]);
  const days = useMemo(() => (result ? groupByDay({ items: filterByType(result.items, type), minor: filterByType(result.minor, type), hidden: type === 'All' ? result.hidden : [] }, range, today0) : []), [result, type, range, today0]);
  const top = useMemo(() => topOfWindow(filterByType(inWin, type), range, 5, today0), [inWin, type, range, today0]);

  if (loading || !result) {
    return (
      <div role="status" style={{ fontSize: 14, color: C.cyan, fontWeight: 700, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
        Loading the filings on file for {names} names… the list appears when it is in.
      </div>
    );
  }

  const today = result.window.to;
  const chips: TypeFilter[] = ['All', ...EVENT_TYPES.filter((t) => counts[t] > 0 || t === type)];
  const oldest = shift(today, -(result.window.days - 1));
  const rd = result.reading;
  const reading = rd.pending > 0 && (progress?.running ?? true);

  const row = (e: RecentEvent, i: number) => {
    const tm = TOUCH[e.thesis];
    const isOpen = !!open[e.id];
    return (
      <Fragment key={e.id}>
        <tr id={rowAnchor(e)} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top', scrollMarginTop: 80 }}>
          <td style={{ padding: '6px 8px', color: C.faint, fontWeight: 800 }}>{i + 1}</td>
          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: C.dim }}>
            {e.date}<div style={{ fontSize: 12, color: C.faint }}>{when(e.date, today)}</div>
          </td>
          <td style={{ padding: '6px 8px', minWidth: 110 }}>
            {onJump
              ? <a href="#" onClick={(ev) => { ev.preventDefault(); onJump(e.ticker); }} style={{ color: C.text, fontWeight: 900, textDecoration: 'none' }}>{e.ticker}</a>
              : <b style={{ color: C.text }}>{e.ticker}</b>}
            {e.company && <div style={{ fontSize: 12, color: C.faint }}>{e.company}</div>}
          </td>
          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
            <div style={{ color: C.dim, fontWeight: 800 }}>{e.type}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: IMP[e.importance] }}>{e.importance}</div>
          </td>
          <td style={{ padding: '6px 8px', lineHeight: 1.4, minWidth: 280 }}>
            <div style={{ color: C.text, fontWeight: e.importance === 'Material' ? 700 : 500 }}>{e.what}</div>
            {e.read === 'pending' && <div style={{ fontSize: 12, color: C.cyan }}>reading the document…</div>}
            {e.readNote && <div style={{ fontSize: 12, color: C.amber }}>{e.readNote} — showing the subject line</div>}
            {e.title && e.title !== e.what && <div style={{ fontSize: 11.5, color: C.faint }}>{e.title}</div>}
            {e.filings.length > 1 && (
              <button onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                style={{ fontSize: 12, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                {isOpen ? '▾' : '▸'} {e.filings.length} filings
              </button>
            )}
          </td>
          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
            <span title={e.badge === 'filed' ? `Filed document${e.source ? ` — ${e.source}` : ''}` : `Press / news only${e.source ? ` — ${e.source}` : ''}, not a filing`}
              style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 7px', borderRadius: 999, border: `1px solid ${e.badge === 'filed' ? C.cyan : C.amber}`, color: e.badge === 'filed' ? C.cyan : C.amber }}>
              {e.badge === 'filed' ? 'Filed' : 'Press only'}
            </span>
            <div style={{ marginTop: 3 }}>
              {e.url
                ? <a href={e.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: C.cyan }}>Open source ↗</a>
                : market === 'IN'
                  ? <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(e.ticker.replace(/-(BE|SM|ST|BZ|E1)$/i, ''))}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: C.cyan }}>NSE page ↗</a>
                  : <span style={{ fontSize: 12, color: C.faint }}>no link</span>}
            </div>
          </td>
          <td style={{ padding: '6px 8px', minWidth: 150 }}>
            <div style={{ color: tm.color, fontWeight: 800, fontSize: 12.5 }}>{tm.label}</div>
            <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.35 }}>{e.thesisWhy}</div>
          </td>
        </tr>
        {isOpen && e.filings.map((f, k) => (
          <tr key={`${e.id}-f${k}`}>
            <td />
            <td style={{ padding: '2px 8px', fontSize: 12, color: C.faint, whiteSpace: 'nowrap' }}>{f.date}</td>
            <td colSpan={3} style={{ padding: '2px 8px', fontSize: 12, color: C.dim }}>
              {f.url ? <a href={f.url} target="_blank" rel="noreferrer" style={{ color: C.dim }}>{f.title || 'filing'}</a> : f.title}
              {f.line && f.line !== e.what && <span style={{ color: C.faint }}> — {f.line}</span>}
              {f.readNote && <span style={{ color: C.amber }}> — {f.readNote}</span>}
            </td>
            <td colSpan={2} />
          </tr>
        ))}
      </Fragment>
    );
  };

  const table = (list: RecentEvent[]) => (
    <div className="mc-table-scroll" style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
      <table data-mc-table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead>
          <tr style={{ color: C.faint, textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <th style={{ padding: '6px 8px' }}>#</th>
            <th style={{ padding: '6px 8px' }}>Date</th>
            <th style={{ padding: '6px 8px' }}>Name</th>
            <th style={{ padding: '6px 8px' }}>Event</th>
            <th style={{ padding: '6px 8px' }}>What happened</th>
            <th style={{ padding: '6px 8px' }}>Source</th>
            <th style={{ padding: '6px 8px' }}>Thesis</th>
          </tr>
        </thead>
        <tbody>{list.map(row)}</tbody>
      </table>
    </div>
  );

  return (
    <div data-testid="new-catalysts-tab" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.55, maxWidth: 900 }}>
        <b style={{ color: C.text }}>What happened for your {names} names, {result.window.from} to {result.window.to}</b> — each filing is opened and read
        (no AI). Latest day first; within each day, most important first. A figure is shown only when the filing states it. &ldquo;Thesis&rdquo; maps the event onto the thesis type on the card.
        Only filings already found are here; to look for newer ones use &ldquo;{market === 'US' ? 'Check EDGAR for new filings' : 'Check all for new evidence'}&rdquo; on the catalyst board.
      </div>

      {rd.total > 0 && (
        <div data-testid="new-catalysts-reading" role="status" style={{ fontSize: 13, color: reading ? C.cyan : C.faint, fontWeight: reading ? 700 : 500 }}>
          {reading
            ? <>Reading {rd.read + rd.failed + 1 > rd.total ? rd.total : rd.read + rd.failed + 1} of {rd.total} filings… rows fill in as each document is read.</>
            : <>Read {rd.read} of {rd.total} filings{rd.failed ? ` · ${rd.failed} could not be opened (subject line shown)` : ''}{rd.pending ? ` · ${rd.pending} not read yet` : ''}.</>}
          {progress?.error && <span style={{ color: C.amber }}> · {progress.error}</span>}
        </div>
      )}

      {sourceNotes.length > 0 && (
        <div data-testid="new-catalysts-source-notes" style={{ fontSize: 13, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '7px 11px', lineHeight: 1.5 }}>
          {sourceNotes.map((n, i) => <div key={i}>⚠ {n}</div>)}
        </div>
      )}

      {/* ── THE ONE FILTER: event type. ─────────────────────────────────── */}
      <div className="mc-wrap-mobile" role="group" aria-label="Event type" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {chips.map((t) => {
          const on = type === t;
          return (
            <button key={t} onClick={() => setType(t)} aria-pressed={on} style={{
              fontSize: 13, fontWeight: 800, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${on ? C.cyan : C.border}`, color: on ? C.cyan : C.dim,
              background: on ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : C.bg,
            }}>{t} ({counts[t]})</button>
          );
        })}
        {type !== 'All' && <span style={{ fontSize: 12.5, color: C.faint }}>Showing: {type}</span>}
      </div>

      {/* ── WHICH DAYS. Like Earnings Opportunities: newest day on top. ─── */}
      <div className="mc-wrap-mobile" role="group" aria-label="Date window" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {WINDOW_SPANS.map((sp) => {
          const on = w.span === sp;
          return (
            <button key={sp} onClick={() => setW({ span: sp, anchor: w.anchor })} aria-pressed={on} style={{
              fontSize: 13, fontWeight: 800, padding: '4px 11px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${on ? C.cyan : C.border}`, color: on ? C.cyan : C.dim, background: C.bg,
            }}>{SPAN_LABEL[sp]}</button>
          );
        })}
        <button aria-label="One day earlier" disabled={range.to <= oldest} onClick={() => setW({ span: w.span, anchor: shift(range.to, -1) })}
          style={{ fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 8, cursor: range.to <= oldest ? 'default' : 'pointer', border: `1px solid ${C.border}`, color: range.to <= oldest ? C.faint : C.dim, background: C.bg }}>←</button>
        <input type="date" aria-label="Jump to date" min={oldest} max={today} value={range.to}
          onChange={(ev) => { const v = ev.target.value; if (v) setW({ span: w.span, anchor: v >= today ? null : v }); }}
          style={{ fontSize: 13, padding: '3px 6px', borderRadius: 8, border: `1px solid ${C.border}`, color: C.text, background: C.bg }} />
        <button aria-label="One day later" disabled={range.to >= today} onClick={() => { const nx = shift(range.to, 1); setW({ span: w.span, anchor: nx >= today ? null : nx }); }}
          style={{ fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 8, cursor: range.to >= today ? 'default' : 'pointer', border: `1px solid ${C.border}`, color: range.to >= today ? C.faint : C.dim, background: C.bg }}>→</button>
        <span data-testid="new-catalysts-range" style={{ fontSize: 12.5, color: C.faint }}>
          {range.from === range.to ? dayLabel(range.to) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`} · {inWin.length} event{inWin.length === 1 ? '' : 's'}
          {w.anchor && <> · <button onClick={() => setW({ span: w.span, anchor: null })} style={{ fontSize: 12.5, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>back to today</button></>}
        </span>
      </div>

      {/* ── TOP OF THE WINDOW: up to 5 Material items, newest first. ─────── */}
      {top.length > 0 && (
        <div data-testid="new-catalysts-top" style={{ border: `1px solid ${C.cyan}`, borderRadius: 8, padding: '8px 12px', background: C.bg }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: C.text, marginBottom: 4 }}>Top of the window — {top.length} Material</div>
          {top.map((e) => (
            <div key={e.id} style={{ fontSize: 13, lineHeight: 1.45, color: C.dim }}>
              <span style={{ color: C.faint }}>{dayLabel(e.date)}</span>{' · '}
              <a href={`#${rowAnchor(e)}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(rowAnchor(e))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                style={{ color: C.text, fontWeight: 800, textDecoration: 'none' }}>{e.ticker}</a>
              {' · '}{e.type}{' — '}<span style={{ color: C.text }}>{e.what.length > 150 ? `${e.what.slice(0, 149)}…` : e.what}</span>
              {e.thesis !== 'not assessed' && <span style={{ color: TOUCH[e.thesis].color, fontWeight: 800 }}> · {TOUCH[e.thesis].label}</span>}
            </div>
          ))}
        </div>
      )}

      {inWin.length === 0 && days.every((d) => !d.minor.length) ? (
        <div data-testid="new-catalysts-empty" style={{ fontSize: 14, color: C.dim, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '12px 14px', lineHeight: 1.55 }}>
          <b style={{ color: C.text }}>No new catalysts {range.from === range.to ? `on ${dayLabel(range.to)}` : `in the last ${range.days} days`} for your {names} names</b>
          {result.lastItem
            ? <> — last new item was {result.lastItem.date} ({result.lastItem.ticker}).</>
            : <> — no dated filing is on file for any of them yet.</>}
          {w.span < result.window.days && result.items.length > 0 && <div style={{ marginTop: 4 }}><button onClick={() => setW({ span: 10, anchor: null })} style={{ fontSize: 13, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>Show all 10 days ({result.items.length})</button></div>}
          {reading && <div style={{ color: C.cyan, marginTop: 4 }}>Filings are still being read — this may change.</div>}
          {sourceNotes.length > 0 && <div style={{ color: C.amber, marginTop: 4 }}>Some sources failed (see above), so this may be incomplete.</div>}
        </div>
      ) : days.map((d) => {
        const behind = d.minor.length + d.hidden.length;
        const on = !!showMinor[d.date];
        if (!d.items.length && !behind) return null;
        return (
          <div key={d.date} data-testid="new-catalysts-day" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: C.text, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginTop: 4 }}>
              {d.header}{d.date === today ? <span style={{ color: C.faint, fontWeight: 600 }}> · today</span> : null}
            </div>
            {d.items.length > 0 ? table(d.items) : <div style={{ fontSize: 12.5, color: C.faint }}>Nothing Material or Notable this day.</div>}
            {behind > 0 && (
              <div style={{ fontSize: 12.5, color: C.faint }}>
                <button onClick={() => setShowMinor((m) => ({ ...m, [d.date]: !m[d.date] }))} style={{ fontSize: 12.5, color: C.faint, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
                  {on ? 'Hide' : 'Show'} {d.minor.length} minor item{d.minor.length === 1 ? '' : 's'} and {d.hidden.length} routine filing{d.hidden.length === 1 ? '' : 's'}
                </button>
              </div>
            )}
            {on && d.minor.length > 0 && table(d.minor)}
            {on && d.hidden.length > 0 && (
              <div style={{ fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
                {d.hidden.map((e) => (
                  <div key={e.id}><b style={{ color: C.dim }}>{e.ticker}</b> · {e.routineWhy} — {e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ color: C.faint }}>{e.title || e.what}</a> : (e.title || e.what)}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
