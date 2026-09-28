'use client';
// zzz812 — shared pieces of the Earnings Opportunities search (India + US):
// the ?q= URL state with a 150 ms debounce, and the result panel that always
// says WHERE a match is (in the window / hidden by filters / an earlier date /
// not on file). The matching itself lives in lib/earnings-search.ts.

import { useEffect, useRef, useState } from 'react';
import {
  readSearchParam, withSearchParam, hiddenNote, fmtSearchDate,
  type SearchOutcome, type SearchableRow, type WindowHit, type RankedHit,
} from '@/lib/earnings-search';

export const SEARCH_DEBOUNCE_MS = 150;

/**
 * Search text that lives in the URL (?q=), so it survives a refresh and can be
 * shared. The input updates instantly; `debounced` trails it by 150 ms and is
 * what the (memoised) search should run on. Polling and refetches re-render
 * the page but never touch this state, so they cannot reset the box.
 */
export function useUrlSearchQuery(delay = SEARCH_DEBOUNCE_MS) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const hydrated = useRef(false);
  // Read ?q= after mount (not during render) so SSR and the first client
  // render agree.
  useEffect(() => {
    try {
      const init = readSearchParam(window.location.search);
      if (init) { setQ(init); setDebounced(init); }
    } catch { /* no window */ }
    hydrated.current = true;
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), delay);
    return () => clearTimeout(t);
  }, [q, delay]);
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      const cur = window.location.pathname + window.location.search + window.location.hash;
      const next = withSearchParam(cur, debounced);
      if (next !== cur) window.history.replaceState(window.history.state, '', next);
    } catch { /* ignore */ }
  }, [debounced]);
  return { q, setQ, debounced };
}

const TIER_COLOR: Record<string, string> = {
  BLOCKBUSTER: '#F59E0B', STRONG: '#10B981', MIXED: '#94A3B8', AVOID: '#EF4444',
};

function Row({ r, note, onClick, action }: { r: SearchableRow; note?: string; onClick: () => void; action: string }) {
  const c = TIER_COLOR[String(r.tier || '')] || 'var(--mc-text-3)';
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', width: '100%', minWidth: 0,
        textAlign: 'left', padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
        border: '1px solid var(--mc-bg-4)', background: 'var(--mc-bg-2)', color: 'var(--mc-text-1)', fontSize: 12,
      }}>
      <b style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--mc-text-0)', fontSize: 13 }}>{r.ticker}</b>
      <span style={{ color: 'var(--mc-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{r.company || ''}</span>
      {r.tier && (
        <span style={{ fontSize: 9.5, fontWeight: 900, color: c, border: `1px solid ${c}`, borderRadius: 5, padding: '1px 6px' }}>{r.tier}</span>
      )}
      <span style={{ color: 'var(--mc-text-4)', fontSize: 11 }}>
        {[r.quarter, r.filing_date ? `filed ${fmtSearchDate(r.filing_date)}` : ''].filter(Boolean).join(' · ')}
      </span>
      <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 800, color: 'var(--mc-cyan)' }}>{action} →</span>
      {note && <span style={{ flexBasis: '100%', fontSize: 10.5, color: 'var(--mc-warn, #F59E0B)' }}>{note}</span>}
    </button>
  );
}

export interface SearchResultsPanelProps<T extends SearchableRow, H extends SearchableRow> {
  outcome: SearchOutcome<T, H> | null;
  loading?: boolean;
  windowLabel: string;
  onPickWindow: (hit: WindowHit<T>) => void;
  onPickHistory: (hit: RankedHit<H>) => void;
  gradeNow?: { label: string; onClick: () => void; busy?: boolean; message?: string | null } | null;
}

export function SearchResultsPanel<T extends SearchableRow, H extends SearchableRow>(p: SearchResultsPanelProps<T, H>) {
  const o = p.outcome;
  if (!o || o.kind === 'empty') {
    return p.loading ? <div style={box}><span style={muted}>Searching…</span></div> : null;
  }
  if (o.kind === 'window') {
    return (
      <div style={box} role="listbox" aria-label="Search results">
        <div style={muted}>
          {o.hits.length} match{o.hits.length === 1 ? '' : 'es'} in {p.windowLabel}
          {o.hiddenCount > 0 && <> · <b style={{ color: 'var(--mc-warn, #F59E0B)' }}>{o.note}</b> — click to show</>}
        </div>
        <div style={list}>
          {o.hits.map((h) => (
            <Row key={`${h.row.ticker}:${h.row.filing_date || ''}`} r={h.row}
              note={h.hiddenBy.length ? hiddenNote(h.hiddenBy) : undefined}
              action={h.hiddenBy.length ? 'show' : 'go to card'}
              onClick={() => p.onPickWindow(h)} />
          ))}
        </div>
      </div>
    );
  }
  if (o.kind === 'history') {
    return (
      <div style={box} role="listbox" aria-label="Search results">
        <div style={muted}><b style={{ color: 'var(--mc-text-1)' }}>{o.note}.</b> Not in {p.windowLabel}. Newest first — click to jump the page to that date.</div>
        <div style={list}>
          {o.hits.map((h) => (
            <Row key={`${h.row.ticker}:${h.row.filing_date || ''}:${h.row.quarter || ''}`} r={h.row}
              action={`jump to ${fmtSearchDate(h.row.filing_date)}`} onClick={() => p.onPickHistory(h)} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div style={box} role="status">
      <div style={{ fontSize: 12, color: 'var(--mc-text-2)', lineHeight: 1.55 }}>{o.message}</div>
      {p.gradeNow && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={p.gradeNow.onClick} disabled={p.gradeNow.busy}
            style={{ fontSize: 11, fontWeight: 800, padding: '6px 12px', borderRadius: 7, cursor: p.gradeNow.busy ? 'wait' : 'pointer', border: '1px solid var(--mc-cyan)', background: 'transparent', color: 'var(--mc-cyan)' }}>
            {p.gradeNow.busy ? 'grading…' : p.gradeNow.label}
          </button>
          {p.gradeNow.message && <span style={{ fontSize: 11, color: 'var(--mc-warn, #F59E0B)' }}>{p.gradeNow.message}</span>}
        </div>
      )}
    </div>
  );
}

const box: React.CSSProperties = {
  marginTop: 6, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mc-border-2, var(--mc-bg-4))',
  background: 'var(--mc-bg-1)', width: '100%', maxWidth: '100%', boxSizing: 'border-box', minWidth: 0,
};
const muted: React.CSSProperties = { fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 7, lineHeight: 1.5 };
const list: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 360, overflowY: 'auto' };
