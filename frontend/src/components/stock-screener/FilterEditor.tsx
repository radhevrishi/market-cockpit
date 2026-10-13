'use client';
// zzz994 — the screener's filter editor, shared by the Stock Screener (every filter kind, including the new chart-pattern rule) and
// the Pine Screener's "Add rule" (number / comparison rules on the fields the Pine page actually receives — `fields` prop).
import React, { useState } from 'react';
import type { ScreenMarket } from '@/lib/screener/types';
import { PATTERN_META, PATTERN_IDS, type PatternId } from '@/lib/chart-patterns';
import {
  FIELDS, fieldOf, PATTERN_TFS, SHAPE_BANDS, ALL_STAGES, DEFAULT_PATTERN_RULE,
  type CmpOp, type FieldDef, type Filter, type NumKey, type NumOp, type PatTf, type PatStage, type PatternRule,
} from '@/lib/screener/filters';
import { TV_SECTORS } from '@/lib/screener/tv-sectors';

export const SC = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', dim: 'var(--mc-text-3, #6b7280)', border: 'var(--mc-border-1)',
  bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
const C = SC;
const STAGE_LABEL: Record<PatStage, string> = { f: 'Forming', b: 'Breakout', x: 'Failed' };

export function FilterEditor({ f, market, tvSecCount, onChange, onClose, fields }: {
  f: Filter; market: ScreenMarket; tvSecCount?: Map<string, number>; onChange: (f: Filter) => void; onClose: () => void;
  /** the fields offered (default: every field of the market) */
  fields?: readonly FieldDef[];
}) {
  const offered = (fields || FIELDS).filter((x) => x.markets.includes(market));
  const box: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: C.bg1, display: 'grid', gap: 8, fontSize: 13 };
  const inp: React.CSSProperties = { width: 110, padding: '4px 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.bg, color: C.text };
  const done = <>{f.off ? <span style={{ color: C.amber, fontSize: 12 }}>⏸ paused — not applied</span> : null}<button type="button" onClick={() => onChange({ ...f, off: !f.off } as Filter)} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>{f.off ? 'Turn on' : 'Pause'}</button><button type="button" onClick={onClose} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Done</button></>;
  const fieldSelect = (value: NumKey, set: (k: NumKey) => void, unit?: string, label?: string) => (
    <select value={value} onChange={(e) => set(e.target.value as NumKey)} style={{ ...inp, width: 'auto' }} aria-label={label || 'Field'}>
      {offered.some((x) => x.key === value) ? null : <option value={value}>{fieldOf(value)?.label || value} (not available here)</option>}
      {offered.filter((x) => !unit || x.unit === unit).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
    </select>
  );
  if (f.kind === 'pattern') return <PatternEditor f={f} onChange={(r) => onChange({ kind: 'pattern', ...r, ...(f.off ? { off: true } : {}) })} done={done} box={box} inp={inp} />;
  if (f.kind === 'sector') {
    const all = f.sectors.length === 0;
    return (
      <div style={box}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>Sectors</b><span style={{ color: C.dim }}>{all ? 'none ticked = all sectors' : `${f.sectors.length} ticked`}</span><span style={{ flex: 1 }} /><button type="button" onClick={() => onChange({ kind: 'sector', sectors: [] })} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Clear</button>{done}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {TV_SECTORS.map((s) => (
            <label key={s} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={f.sectors.includes(s)} onChange={(e) => onChange({ kind: 'sector', sectors: e.target.checked ? [...f.sectors, s] : f.sectors.filter((x) => x !== s) })} />
              {s} <span style={{ color: C.dim, fontSize: 11 }}>{tvSecCount?.get(s) || 0}</span>
            </label>
          ))}
        </div>
        <div style={{ color: C.dim, fontSize: 12 }}>≈ TradingView&apos;s sectors, worked out from each company&apos;s industry — right for about 4 companies in 5.</div>
      </div>
    );
  }
  if (f.kind === 'exch') {
    const all = market === 'US' ? ['NASDAQ', 'NYSE', 'AMEX'] : ['NSE', 'BSE'];
    return (
      <div style={{ ...box, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>Exchange</b>
        {all.map((e) => (
          <label key={e} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.ex.includes(e)} onChange={(ev) => onChange({ kind: 'exch', ex: ev.target.checked ? [...f.ex, e] : f.ex.filter((x) => x !== e) })} />{e}
          </label>
        ))}
        {market === 'IN' ? <span style={{ color: C.dim, fontSize: 12 }}>Every company here trades on NSE; BSE = also listed on BSE.</span> : null}
        {done}
      </div>
    );
  }
  if (f.kind === 'date') {
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{fieldOf(f.key)?.label}</b>
        <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as 'thisMonth' | 'pastYears' })} style={{ ...inp, width: 'auto' }}>
          <option value="thisMonth">this calendar month</option><option value="pastYears">within the last … years</option>
        </select>
        {f.op === 'pastYears' ? <input type="number" value={f.v ?? 5} onChange={(e) => onChange({ ...f, v: Number(e.target.value) })} style={inp} /> : null}
        {done}
      </div>
    );
  }
  if (f.kind === 'cmp') {
    const unit = fieldOf(f.key)?.unit;
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {fieldSelect(f.key, (k) => onChange({ ...f, key: k, other: fieldOf(k)?.unit === fieldOf(f.other)?.unit ? f.other : k }))}
        <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as CmpOp })} style={inp} aria-label="Comparison">
          <option value="above">above (&gt;)</option><option value="ge">at or above (≥)</option><option value="below">below (&lt;)</option><option value="le">at or below (≤)</option>
        </select>
        {fieldSelect(f.other, (k) => onChange({ ...f, other: k }), unit, 'Other field')}
        {done}
      </div>
    );
  }
  if (f.kind === 'near') {
    return (
      <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {fieldSelect(f.key, (k) => onChange({ ...f, key: k }))}
        <span>is</span>
        <input type="number" value={f.lo} onChange={(e) => onChange({ ...f, lo: Number(e.target.value) })} style={{ ...inp, width: 70 }} />
        <span>to</span>
        <input type="number" value={f.hi} onChange={(e) => onChange({ ...f, hi: Number(e.target.value) })} style={{ ...inp, width: 70 }} />
        <span>% above</span>
        {fieldSelect(f.other, (k) => onChange({ ...f, other: k }), fieldOf(f.key)?.unit, 'Other field')}
        {done}
      </div>
    );
  }
  const d = fieldOf(f.key);
  const unitWord = d?.unit === '%' ? '%' : d?.unit === 'money' ? (market === 'US' ? '$ million' : '₹ crore') : d?.unit === 'x' ? '×' : d?.unit === 'usd' ? '$' : d?.unit === 'price' ? (market === 'US' ? 'USD' : 'INR') : '';
  return (
    <div style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {fields ? fieldSelect(f.key, (k) => onChange({ ...f, key: k })) : <b>{d?.label}</b>}
      <select value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as NumOp, v2: e.target.value === 'between' ? (f.v2 ?? f.v) : undefined })} style={inp} aria-label="Operator">
        <option value="gt">greater than</option><option value="ge">at least</option><option value="lt">less than</option><option value="le">at most</option><option value="between">between</option>
      </select>
      <input type="number" aria-label="Value" value={Number.isFinite(f.v) ? f.v : ''} onChange={(e) => onChange({ ...f, v: Number(e.target.value) })} style={inp} />
      {f.op === 'between' ? <>and <input type="number" aria-label="Second value" value={Number.isFinite(f.v2 as number) ? f.v2 : ''} onChange={(e) => onChange({ ...f, v2: Number(e.target.value) })} style={inp} /></> : null}
      <span style={{ color: C.dim }}>{unitWord}</span>
      {d?.approxNote?.[market] ? <span style={{ color: C.amber, fontSize: 12 }}>≈ {d.approxNote[market]}</span> : null}
      {d?.sparse?.[market] ? <span style={{ color: C.dim, fontSize: 12 }}>few companies have this: {d.sparse[market]}</span> : null}
      {done}
    </div>
  );
}

/** zzz994 (section B) — the chart-pattern rule: bias, pattern types, analysis timeframes (ANY / ALL), explicit stages, shape-score
 *  floor and pivot window. The same matcher as the Pine Screener. */
function PatternEditor({ f, onChange, done, box, inp }: { f: PatternRule; onChange: (r: PatternRule) => void; done: React.ReactNode; box: React.CSSProperties; inp: React.CSSProperties }) {
  const [find, setFind] = useState('');
  const set = (p: Partial<PatternRule>) => onChange({ ...DEFAULT_PATTERN_RULE, ...f, ...p });
  const ofBias = PATTERN_IDS.filter((id) => f.bias === 'both' || (PATTERN_META[id].bias === 'bullish') === (f.bias === 'U'));
  const visible = ofBias.filter((id) => !find.trim() || PATTERN_META[id].label.toLowerCase().includes(find.trim().toLowerCase()));
  const chip = (on: boolean, col = C.accent): React.CSSProperties => ({ padding: '3px 9px', borderRadius: 999, border: `1px solid ${on ? col : C.border}`, background: on ? col : C.bg, color: on ? '#fff' : C.text1, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' });
  const allStages = ALL_STAGES.every((s) => f.stages.includes(s));
  return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>Chart pattern</b>
        <span role="radiogroup" aria-label="Pattern bias" style={{ display: 'inline-flex', gap: 4 }}>
          {([['U', '▲ Bullish'], ['D', '▼ Bearish'], ['both', 'Both']] as const).map(([b, l]) => (
            <button key={b} type="button" role="radio" aria-checked={f.bias === b} style={chip(f.bias === b)} onClick={() => set({ bias: b, ids: f.ids.filter((id) => b === 'both' || (PATTERN_META[id].bias === 'bullish') === (b === 'U')) })}>{l}</button>
          ))}
        </span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} title="Analysis timeframe of the pattern scan: D daily, W weekly, M monthly bars">
          <span style={{ color: C.dim }}>Timeframe</span>
          {PATTERN_TFS.map((t) => <button key={t.id} type="button" aria-pressed={f.tfs.includes(t.id)} title={t.long} style={chip(f.tfs.includes(t.id))}
            onClick={() => { const next: PatTf[] = f.tfs.includes(t.id) ? f.tfs.filter((x) => x !== t.id) : [...f.tfs, t.id]; set({ tfs: next.length ? next : f.tfs }); }}>{t.label}</button>)}
          {f.tfs.length > 1 ? (
            <select value={f.tfMode} onChange={(e) => set({ tfMode: e.target.value === 'all' ? 'all' : 'any' })} style={{ ...inp, width: 'auto' }} aria-label="Timeframes combine">
              <option value="any">on ANY selected timeframe</option><option value="all">on ALL selected timeframes</option>
            </select>
          ) : null}
        </span>
        <span style={{ flex: 1 }} />{done}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: C.dim }}>Stage</span>
        {ALL_STAGES.map((s) => <button key={s} type="button" aria-pressed={f.stages.includes(s)} style={chip(f.stages.includes(s))} onClick={() => set({ stages: f.stages.includes(s) ? f.stages.filter((x) => x !== s) : [...f.stages, s] })}>{STAGE_LABEL[s]}</button>)}
        <button type="button" aria-pressed={allStages} style={chip(allStages)} onClick={() => set({ stages: allStages ? ['f', 'b'] : ALL_STAGES.slice() })} title="Forming, breakout and failed">All stages</button>
        {!f.stages.length ? <span style={{ color: C.amber, fontSize: 12 }}>no stage selected — this rule matches nothing</span> : null}
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><span style={{ color: C.dim }}>Shape score (0–100)</span>
          <select value={f.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} style={{ ...inp, width: 'auto' }} aria-label="Minimum shape score">
            {SHAPE_BANDS.map((b) => <option key={b.min} value={b.min}>{b.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title="Close against the pivot in the pattern's direction: − = not reached yet, + = beyond it">
          <input type="checkbox" checked={f.dist.on} onChange={(e) => set({ dist: { ...f.dist, on: e.target.checked } })} aria-label="Limit distance to pivot" /> <span style={{ color: C.dim }}>To pivot</span>
        </label>
        <input type="number" aria-label="Distance to pivot from %" value={f.dist.lo} disabled={!f.dist.on} onChange={(e) => set({ dist: { ...f.dist, lo: Number(e.target.value) } })} style={{ ...inp, width: 60 }} />
        <span>to</span>
        <input type="number" aria-label="Distance to pivot to %" value={f.dist.hi} disabled={!f.dist.on} onChange={(e) => set({ dist: { ...f.dist, hi: Number(e.target.value) } })} style={{ ...inp, width: 60 }} />
        <span style={{ color: C.dim }}>%</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="find a pattern" aria-label="Find a pattern type" style={{ ...inp, width: 140 }} />
        <button type="button" style={chip(false)} onClick={() => set({ ids: Array.from(new Set([...f.ids, ...visible])) })}>Select all</button>
        <button type="button" style={chip(false)} onClick={() => set({ ids: [] })}>Clear</button>
        <button type="button" style={chip(false)} onClick={() => set({ ids: ofBias.filter((id) => !f.ids.includes(id)) })}>Invert</button>
        <span style={{ color: C.dim, fontSize: 12 }}>{f.ids.length ? `${f.ids.length} type${f.ids.length > 1 ? 's' : ''} ticked (any of them)` : 'none ticked = every type of the bias'}</span>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {visible.map((id: PatternId) => {
          const on = f.ids.includes(id); const col = PATTERN_META[id].bias === 'bullish' ? C.green : C.red;
          return <button key={id} type="button" aria-pressed={on} title={PATTERN_META[id].short} style={chip(on, col)} onClick={() => set({ ids: on ? f.ids.filter((x) => x !== id) : [...f.ids, id] })}>{PATTERN_META[id].label}</button>;
        })}
      </div>
      <div style={{ color: C.dim, fontSize: 12 }}>A company whose selected timeframe has not been scanned (or was read by an older scan) cannot be evaluated and does not pass. Shape score = how closely the shape fits the definition — not a probability.</div>
    </div>
  );
}

// ── shared table helpers ───────────────────────────────────────────────────────────────────────────────────────────────
export type Density = 'comfortable' | 'compact';
const DENSITY_KEY = 'mc:screener-density:v1';
export function readDensity(): Density { try { return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'; } catch { return 'comfortable'; } }
export function writeDensity(d: Density): void { try { localStorage.setItem(DENSITY_KEY, d); } catch { /* this visit only */ } }
export function cellPad(d: Density): string { return d === 'compact' ? '3px 6px' : '6px 8px'; }
/** Pinned first column (company identity) on horizontal scroll. */
export const pinnedCell = (bg: string): React.CSSProperties => ({ position: 'sticky', left: 0, zIndex: 1, background: bg, boxShadow: `1px 0 0 ${C.border}` });
