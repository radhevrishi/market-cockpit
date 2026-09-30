'use client';
// zzz843 — title, window chips, counts, filters, freshness.
import React from 'react';
import type { GuSummary, GuWindow } from '@/lib/guidance-upgrades-types';
import type { MetricFilter, ScopeFilter } from '@/lib/guidance-upgrades-format';
import { ageDays } from '@/lib/guidance-upgrades-format';
import { R, box, tint } from './gu-tokens';

export const WINDOWS: GuWindow[] = ['24H', '3D', '7D', '14D', '30D'];
const SCOPES: Array<[ScopeFilter, string]> = [['ALL', 'ALL'], ['INDIA', 'INDIA'], ['USA', 'USA'], ['MY_BOOK', 'MY BOOK'], ['HIGH', 'HIGH MATERIALITY']];
const METRICS: Array<[MetricFilter, string]> = [['ALL', 'All metrics'], ['REVENUE', 'Revenue'], ['EBITDA', 'EBITDA'], ['EPS', 'EPS'], ['FCF', 'FCF'], ['MULTI_METRIC', 'Multi-metric'], ['MULTI_YEAR', 'Multi-year']];

const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
  border: `1px solid ${on ? R.cyan : R.border}`, background: on ? tint(R.cyan, 14) : 'transparent', color: on ? R.cyan : R.dim,
});

export function GuTopBar(p: {
  summary: GuSummary | null; window: GuWindow; onWindow: (w: GuWindow) => void;
  scope: ScopeFilter; onScope: (s: ScopeFilter) => void; metric: MetricFilter; onMetric: (m: MetricFilter) => void;
  newest: string | null; checkedAt: string | null; inBookCount: number; bookLoaded: boolean;
}) {
  const s = p.summary;
  const counts: Array<[string, number | null, string]> = [
    ['Detected', s?.detected ?? null, 'Guidance mentions found in the feeds'],
    ['Verified', s?.verified ?? null, 'Backed by a company filing, release or transcript'],
    ['Material', s?.material ?? null, 'Big enough to change earnings in a way that matters'],
    ['Expectation positive', s?.expectationPositive ?? null, 'Guidance is above what the market expected'],
    ['In my book', p.bookLoaded ? p.inBookCount : null, 'Companies you hold'],
  ];
  const d = ageDays(p.newest);
  const hhmm = p.checkedAt ? new Date(p.checkedAt).toTimeString().slice(0, 5) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, letterSpacing: 0.8, margin: 0 }}>GUIDANCE UPGRADES</h1>
        <span style={{ fontSize: 12, color: R.dim }}>
          {p.newest ? `newest announcement ${d === 0 ? 'today' : `${d} days ago`}` : 'no announcement in this window'}{hhmm ? ` · checked ${hhmm}` : ''}
        </span>
        <div className="gu-noprint" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }} role="group" aria-label="Time window">
          {WINDOWS.map((w) => <button key={w} type="button" style={pill(p.window === w)} aria-pressed={p.window === w} onClick={() => p.onWindow(w)}>{w}</button>)}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>
        {counts.map(([label, n, tip]) => (
          <div key={label} title={tip} style={box({ padding: '8px 10px' })}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{n == null ? '·' : n}</div>
            <div style={{ fontSize: 11, color: R.dim, fontWeight: 700 }}>{label}</div>
          </div>
        ))}
      </div>
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filter by group">
        {SCOPES.map(([k, l]) => <button key={k} type="button" style={pill(p.scope === k)} aria-pressed={p.scope === k} onClick={() => p.onScope(k)}>{l}</button>)}
      </div>
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filter by metric">
        {METRICS.map(([k, l]) => <button key={k} type="button" style={pill(p.metric === k)} aria-pressed={p.metric === k} onClick={() => p.onMetric(k)}>{l}</button>)}
      </div>
    </div>
  );
}
