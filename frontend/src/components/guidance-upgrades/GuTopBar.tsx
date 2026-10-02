'use client';
// zzz843 — title, window chips, counts, filters, freshness.
import React from 'react';
import type { GuSummary, GuWindow } from '@/lib/guidance-upgrades-types';
import type { MetricFilter, ScopeFilter } from '@/lib/guidance-upgrades-format';
import { GU_WINDOWS, ageDays, countsLine, fmtConsensusAvail, fmtMarketCounts } from '@/lib/guidance-upgrades-format';
import { R, box, tint } from './gu-tokens';
import { eventCountsStrip, incompleteNote, partitionView } from './gu-ui';

export const WINDOWS: GuWindow[] = GU_WINDOWS;
const SCOPES: Array<[ScopeFilter, string]> = [['ALL', 'ALL'], ['INDIA', 'INDIA'], ['USA', 'USA'], ['MY_BOOK', 'MY BOOK'], ['HIGH', 'HIGH MATERIALITY']];
const METRICS: Array<[MetricFilter, string]> = [['ALL', 'All metrics'], ['REVENUE', 'Revenue'], ['EBITDA', 'EBITDA'], ['NET_PROFIT', 'Net profit'], ['EPS', 'EPS'], ['FCF', 'FCF'], ['MULTI_METRIC', 'Multi-metric'], ['MULTI_YEAR', 'Multi-year']];

const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
  border: `1px solid ${on ? R.cyan : R.border}`, background: on ? tint(R.cyan, 14) : 'transparent', color: on ? R.cyan : R.dim,
});

export function GuTitle({ newest, checkedAt }: { newest: string | null; checkedAt: string | null }) {
  const d = ageDays(newest);
  const hhmm = checkedAt ? new Date(checkedAt).toTimeString().slice(0, 5) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <h1 style={{ fontSize: 20, fontWeight: 900, letterSpacing: 0.8, margin: 0 }}>GUIDANCE UPGRADES</h1>
      <span style={{ fontSize: 12, color: R.dim }}>
        {newest ? `newest announcement ${d === 0 ? 'today' : `${d} days ago`}` : 'no announcement in this window'}{hhmm ? ` · checked ${hhmm}` : ''}
      </span>
    </div>
  );
}

export function GuTopBar(p: {
  summary: GuSummary | null; window: GuWindow; onWindow: (w: GuWindow) => void;
  scope: ScopeFilter; onScope: (s: ScopeFilter) => void; metric: MetricFilter; onMetric: (m: MetricFilter) => void;
  inBookCount: number; bookLoaded: boolean;
  /** zzz862: the scan did not read every source / day, so a 0 here is not proof that nothing was raised */ incomplete?: boolean;
}) {
  const s = p.summary;
  const bm = s?.byMarket;
  // zzz854: the exact pipeline partition replaces 'Detected / Verified' (those two never added up). Older payloads keep the older boxes.
  const part = partitionView(s?.pipeline, s?.pipelineByMarket);
  const counts: Array<[string, number | null, string, string | null]> = part ? [
    ...part.boxes.map((b) => [b.label, b.n, b.tip, null] as [string, number | null, string, string | null]),
    ['In my book', p.bookLoaded ? p.inBookCount : null, 'Companies you hold', null],
  ] : [
    ['Detected', s?.detected ?? null, 'Guidance mentions found in the feeds', fmtMarketCounts(bm, 'detected')],
    ['Verified', s?.verified ?? null, 'Backed by a company filing, release or transcript', fmtMarketCounts(bm, 'verified')],
    ['Material', s?.material ?? null, 'Big enough to change earnings in a way that matters', fmtMarketCounts(bm, 'material')],
    ['Expectation positive', s?.expectationPositive ?? null, 'Guidance is above what the market expected', fmtMarketCounts(bm, 'expectationPositive')],
    ['In my book', p.bookLoaded ? p.inBookCount : null, 'Companies you hold', null],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 14, fontWeight: 900, letterSpacing: 0.6, margin: 0 }}>🔄 RECENT GUIDANCE UPGRADES</h2>
        <div className="gu-noprint" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }} role="group" aria-label="Time window">
          {WINDOWS.map((w) => <button key={w} type="button" style={pill(p.window === w)} aria-pressed={p.window === w} onClick={() => p.onWindow(w)}>{w}</button>)}
        </div>
      </div>
      <div style={{ fontSize: 12, color: R.dim }}>The time window only filters these events. It does not filter the guidance universe above.</div>
      {p.incomplete && <div data-gu-incomplete-note role="note" style={{ fontSize: 12, color: R.amber, fontWeight: 700 }}>{incompleteNote(s?.pipeline, s?.pipelineByMarket)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>
        {counts.map(([label, n, tip, split]) => (
          <div key={label} title={tip} style={box({ padding: '8px 10px' })}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{n == null ? '·' : n}</div>
            <div style={{ fontSize: 11, color: R.dim, fontWeight: 700 }}>{label}</div>
            {split && <div style={{ fontSize: 10.5, color: R.faint }}>{split}</div>}
            {p.incomplete && label === 'Verified upgrades' && <div data-gu-incomplete style={{ fontSize: 10.5, color: R.amber, fontWeight: 700 }}>detection incomplete</div>}
          </div>
        ))}
      </div>
      {part && (
        <div style={{ display: 'grid', gap: 2, fontSize: 12, color: R.dim }} aria-label="How the counts add up" data-gu-partition>
          <div><b style={{ color: R.text }}>How these numbers add up:</b> {part.line}</div>
          <div style={{ color: part.listsHold ? R.dim : R.red, fontWeight: part.listsHold ? 400 : 700 }}>{part.listsHold ? '✓' : '✕'} {part.listsLine}{part.listsHold ? '' : ' — the lists do not add up; do not rely on these numbers until this is fixed'}</div>
          {part.byMarket && <div>{part.byMarket}</div>}
        </div>
      )}
      {!part && s?.counts && (
        <div style={{ display: 'grid', gap: 2, fontSize: 12, color: R.dim }} aria-label="Event counts">
          <div>{countsLine(s.counts)}</div>
          {eventCountsStrip(s.counts) && <div>{eventCountsStrip(s.counts)}</div>}
        </div>
      )}
      {(s?.today != null || s?.consensusAvailable) && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: R.dim }}>
          {s?.today != null && <span><b style={{ color: R.text }}>Today {s.today}</b></span>}
          {s?.consensusAvailable && <span title="Consensus is optional. An upgrade is detected without it.">{fmtConsensusAvail(s.consensusAvailable)}</span>}
        </div>
      )}
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filter by group">
        {SCOPES.map(([k, l]) => <button key={k} type="button" style={pill(p.scope === k)} aria-pressed={p.scope === k} onClick={() => p.onScope(k)}>{l}</button>)}
      </div>
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filter by metric">
        {METRICS.map(([k, l]) => <button key={k} type="button" style={pill(p.metric === k)} aria-pressed={p.metric === k} onClick={() => p.onMetric(k)}>{l}</button>)}
      </div>
    </div>
  );
}
