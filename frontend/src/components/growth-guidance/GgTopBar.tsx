'use client';
// zzz846 — title, threshold chips, metric tabs, market toggle, cap and kind filters, sort, counts row.
import React from 'react';
import type { GgResponse } from '@/lib/growth-guidance-types';
import { CAP_OPTIONS, KIND_OPTIONS, MARKET_OPTIONS, METRIC_TABS, SORT_OPTIONS, THRESHOLDS, lastScanText, type GgFilters } from '@/lib/growth-guidance-format';
import { R, tint } from './gg-tokens';
import { btn } from './GgBits';

const seg = (on: boolean): React.CSSProperties => ({ ...btn(on ? R.cyan : R.dim, on), fontWeight: on ? 800 : 600 });
const lab: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: R.faint, textTransform: 'uppercase', marginRight: 2 };
const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };

function Count({ label, n, sub }: { label: string; n: number | null | undefined; sub?: { IN?: number; US?: number } }) {
  return (
    <div style={{ border: `1px solid ${R.border}`, borderRadius: 8, padding: '6px 10px', minWidth: 110, background: tint(R.cyan, 4) }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: R.faint, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: R.text }}>{n ?? '—'}</div>
      {sub && (sub.IN != null || sub.US != null) && <div style={{ fontSize: 10.5, color: R.dim }}>India {sub.IN ?? '—'} | USA {sub.US ?? '—'}</div>}
    </div>
  );
}

export function GgTopBar({ f, onChange, data, onRefresh, loading }: { f: GgFilters; onChange: (p: Partial<GgFilters>) => void; data: GgResponse | null; onRefresh: () => void; loading: boolean }) {
  const c = data?.counts;
  const by = c?.byMarket;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: R.text }}>📈 Growth Guidance</h1>
          <div style={{ fontSize: 12, color: R.dim }}>Companies where management says growth will be unusually high. A simple list first, the proof underneath.</div>
        </div>
        <div className="gg-noprint" style={row}>
          <span style={{ fontSize: 11, color: R.dim }}>{data?.scan?.lastScanAt ? lastScanText(data.scan.lastScanAt) : data?.asOf ? `As of ${String(data.asOf).slice(0, 16).replace('T', ' ')}` : ''}</span>
          <button type="button" style={btn(R.cyan, true)} onClick={onRefresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      <div className="gg-noprint" style={{ display: 'grid', gap: 8 }}>
        <div style={row}><span style={lab}>Growth at least</span>
          {THRESHOLDS.map((t) => <button key={t} type="button" style={seg(f.threshold === t)} aria-pressed={f.threshold === t} onClick={() => onChange({ threshold: t })}>≥{t}%</button>)}
        </div>
        <div style={row}><span style={lab}>Measure</span>
          {METRIC_TABS.map((m) => <button key={m.value} type="button" style={seg(f.metric === m.value)} aria-pressed={f.metric === m.value} onClick={() => onChange({ metric: m.value })}>{m.label}</button>)}
        </div>
        <div style={row}>
          <span style={lab}>Market</span>
          {MARKET_OPTIONS.map((m) => <button key={m.value} type="button" style={seg(f.market === m.value)} aria-pressed={f.market === m.value} onClick={() => onChange({ market: m.value })}>{m.label}</button>)}
          <span style={{ ...lab, marginLeft: 10 }}>Size</span>
          {CAP_OPTIONS.map((m) => <button key={m.value} type="button" style={seg(f.cap === m.value)} aria-pressed={f.cap === m.value} onClick={() => onChange({ cap: m.value })}>{m.label}</button>)}
          <span style={{ ...lab, marginLeft: 10 }}>Source</span>
          {KIND_OPTIONS.map((m) => <button key={m.value} type="button" style={seg(f.kind === m.value)} aria-pressed={f.kind === m.value} onClick={() => onChange({ kind: m.value })}>{m.label}</button>)}
        </div>
        <div style={row}>
          <label style={lab} htmlFor="gg-sort">Sort by</label>
          <select id="gg-sort" value={f.sort} onChange={(e) => onChange({ sort: e.target.value as GgFilters['sort'] })}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, border: `1px solid ${R.border}`, background: R.bg2, color: R.text }}>
            {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div style={row}>
        <Count label="Universe" n={c?.universe} sub={by} />
        <Count label="Verified" n={c?.verified} />
        <Count label="Partially verified" n={c?.partially} />
        <Count label="Discovery" n={c?.discovery} />
        <Count label="New today" n={c?.newToday} />
      </div>
    </div>
  );
}
