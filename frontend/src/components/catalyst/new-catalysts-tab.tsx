'use client';

// ═══════════════════════════════════════════════════════════════════════════
// "New · last 10 days" — the tab both Portfolio Catalysts pages share. (zzz808)
//
// One ranked table, newest first, and ONE filter: event type. The data comes
// from lib/catalyst/recent-events (pure); this file only draws it.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  EVENT_TYPES, filterByType, daysAgo,
  type RecentCatalystResult, type TypeFilter, type ThesisTouch, type RecentEvent,
} from '@/lib/catalyst/recent-events';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)',
  green: 'var(--mc-verdict-up, #34D399)', red: 'var(--mc-verdict-down, #F87171)', cyan: 'var(--tc-accent, #22D3EE)',
};

const TOUCH: Record<ThesisTouch, { label: string; color: string; hint: string }> = {
  supports: { label: 'Supports', color: C.green, hint: 'The thesis engine already reads this variable as improving.' },
  against: { label: 'Against', color: C.red, hint: 'The thesis engine already reads this variable as getting worse.' },
  neutral: { label: 'Neutral', color: C.dim, hint: 'The thesis engine reads this variable as flat, a level only, or mixed.' },
  'not assessed': { label: 'Not assessed', color: C.faint, hint: 'No thesis check covers this item yet (not read, or not a thesis variable).' },
};

function when(date: string, today: string): string {
  const n = daysAgo(date, today);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

export interface NewCatalystsTabProps {
  result: RecentCatalystResult | null;
  /** Evidence still loading: counts would be wrong, so say so instead. */
  loading: boolean;
  /** How many names the page covers (book + bench on screen). */
  names: number;
  /** Plain-words notes about sources that failed or were not checked. */
  sourceNotes: string[];
  market: 'IN' | 'US';
  onJump?: (ticker: string) => void;
}

export default function NewCatalystsTab({ result, loading, names, sourceNotes, market, onJump }: NewCatalystsTabProps) {
  const [type, setType] = useState<TypeFilter>('All');
  const items = useMemo(() => (result ? filterByType(result.items, type) : []), [result, type]);

  if (loading || !result) {
    return (
      <div role="status" style={{ fontSize: 14, color: C.cyan, fontWeight: 700, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
        Loading the filings on file for {names} names… the list appears when it is in.
      </div>
    );
  }

  const today = result.window.to;
  const chips: TypeFilter[] = ['All', ...EVENT_TYPES.filter((t) => result.counts[t] > 0)];

  return (
    <div data-testid="new-catalysts-tab" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.55, maxWidth: 860 }}>
        <b style={{ color: C.text }}>What is new for your {names} names, {result.window.from} to {result.window.to}</b>, newest first:
        results, orders, capex, concalls{market === 'US' ? ', 8-Ks' : ''} and other filings already found for each name.
        A figure is shown only when the filing states it. &ldquo;Thesis&rdquo; is what the existing thesis check already says — nothing is judged here.
        This list only knows filings that have been found; to look for newer ones, use &ldquo;{market === 'US' ? 'Check EDGAR for new filings' : 'Check all for new evidence'}&rdquo; on the catalyst board.
      </div>

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
            }}>{t} ({result.counts[t]})</button>
          );
        })}
        {type !== 'All' && <span style={{ fontSize: 12.5, color: C.faint }}>Showing: {type}</span>}
      </div>

      {result.hidden.length > 0 && (
        <details style={{ fontSize: 12.5, color: C.faint }}>
          <summary style={{ cursor: 'pointer' }}>{result.hidden.length} routine filing{result.hidden.length === 1 ? '' : 's'} hidden (trading window, meet intimations, newspaper ads, duplicates)</summary>
          <div style={{ marginTop: 4, lineHeight: 1.5 }}>
            {result.hidden.map((e) => (
              <div key={e.id}>{e.date} · <b style={{ color: C.dim }}>{e.ticker}</b> · {e.routineWhy} — {e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ color: C.faint }}>{e.title || e.what}</a> : (e.title || e.what)}</div>
            ))}
          </div>
        </details>
      )}

      {result.items.length === 0 ? (
        <div data-testid="new-catalysts-empty" style={{ fontSize: 14, color: C.dim, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '12px 14px', lineHeight: 1.55 }}>
          <b style={{ color: C.text }}>No new catalysts in the last {result.window.days} days for your {names} names</b>
          {result.lastItem
            ? <> — last new item was {result.lastItem.date} ({result.lastItem.ticker}).</>
            : <> — no dated filing is on file for any of them yet.</>}
          {sourceNotes.length > 0 && <div style={{ color: C.amber, marginTop: 4 }}>Some sources failed (see above), so this may be incomplete.</div>}
        </div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13.5, color: C.dim }}>No {type} items in the window. <button onClick={() => setType('All')} style={{ fontSize: 13, color: C.cyan, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>Show all</button></div>
      ) : (
        <div className="mc-table-scroll" style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
          <table data-mc-table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ color: C.faint, textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <th style={{ padding: '6px 8px' }}>#</th>
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Name</th>
                <th style={{ padding: '6px 8px' }}>Type</th>
                <th style={{ padding: '6px 8px' }}>What it says</th>
                <th style={{ padding: '6px 8px' }}>Source</th>
                <th style={{ padding: '6px 8px' }}>Thesis</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e: RecentEvent, i) => {
                const tm = TOUCH[e.thesis];
                return (
                  <tr key={e.id} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }}>
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
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: C.dim, fontWeight: 700 }}>{e.type}</td>
                    <td style={{ padding: '6px 8px', color: C.dim, lineHeight: 1.4, minWidth: 240 }}>
                      {e.what}
                      {e.figure && !e.what.includes(e.figure) && <div style={{ fontSize: 12.5, color: C.text, fontWeight: 700 }}>{e.figure}</div>}
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
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: tm.color, fontWeight: 800, fontSize: 12.5 }} title={tm.hint}>{tm.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
