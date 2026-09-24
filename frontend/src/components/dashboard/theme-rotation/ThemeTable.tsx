'use client';
// ═══════════════════════════════════════════════════════════════════════════
// THE RANKED THEME TABLE (zzz795) — the one primary view.
//
// Ranked by research priority (quality and materiality of evidence), sortable
// on every column, filterable by verdict / tier / flag / text, with an
// expandable evidence panel per theme. On a phone each row collapses into a
// card: rank, name, verdict, tier, the Why line and the seven layer badges.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import type { FlagKind, Tier } from '@/lib/theme-rotation/types';
import { TIER_LABEL } from '@/lib/theme-rotation/types';
import type { ThemeView } from '@/lib/theme-rotation/view-model';
import { LAYER_NAME, LAYER_ORDER, LAYER_SHORT } from '@/lib/theme-rotation/layers';
import { defaultDir, type SortDir, type SortKey, type TableFilter } from '@/lib/theme-rotation/table';
import { LayerBadge, LayerStrip, Pill, TierBadge, VerdictBadge } from './ui';
import { T, VERDICT_TONE, TIER_TONE, fmtPct, tint } from './tokens';

export interface ThemeTableProps {
  rows: ThemeView[];
  total: number;
  sortKey: SortKey; sortDir: SortDir;
  onSort: (k: SortKey, d: SortDir) => void;
  filter: TableFilter;
  onFilter: (f: TableFilter) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  yours: (id: string) => number;
  heldIn: (id: string) => number;
  renderPanel: (v: ThemeView) => React.ReactNode;
}

const VERDICTS = ['BUY', 'EARLY BUY', 'HOLD', 'WATCH', 'TRIM', 'AVOID'];
const TIERS: Tier[] = ['top', 'look', 'monitor', 'low'];
const FLAGS: Array<[FlagKind | 'mine', string]> = [['early-rotation', 'Early rotation'], ['crowded', 'Crowded'], ['breakdown', 'Breakdown'], ['short-term-break', 'Short-term break'], ['mine', 'Has my names']];
const COLS = 11;

function toggleSet<T>(s: Set<T>, x: T): Set<T> { const n = new Set(s); if (n.has(x)) n.delete(x); else n.add(x); return n; }

export function ThemeTable(p: ThemeTableProps) {
  const { rows, sortKey, sortDir, onSort, filter, onFilter } = p;
  const th = (k: SortKey, label: React.ReactNode, title?: string, align: 'left' | 'right' | 'center' = 'right') => {
    const on = sortKey === k;
    return (
      <th scope="col" aria-sort={on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} style={{ padding: '6px 6px', textAlign: align, whiteSpace: 'nowrap', fontWeight: on ? 900 : 700 }}>
        <button type="button" title={title} onClick={() => onSort(k, on ? (sortDir === 'asc' ? 'desc' : 'asc') : defaultDir(k))}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: on ? T.text : T.faint, font: 'inherit', fontSize: 10.5, letterSpacing: 0.3 }}>
          {label}{on ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
        </button>
      </th>
    );
  };
  const chip = (on: boolean, color: string, label: string, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} aria-pressed={on}
      style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? color : T.border}`, background: on ? tint(color, 18) : 'transparent', color: on ? color : T.faint }}>{label}</button>
  );
  const anyFilter = filter.verdicts.size || filter.tiers.size || filter.flags.size || filter.query;

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'grid', gap: 5, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: T.faint, fontWeight: 900, width: 52 }}>VERDICT</span>
          {VERDICTS.map((v) => chip(filter.verdicts.has(v), VERDICT_TONE[v], v, () => onFilter({ ...filter, verdicts: toggleSet(filter.verdicts, v) })))}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: T.faint, fontWeight: 900, width: 52 }}>PRIORITY</span>
          {TIERS.map((t) => chip(filter.tiers.has(t), TIER_TONE[t], TIER_LABEL[t], () => onFilter({ ...filter, tiers: toggleSet(filter.tiers, t) })))}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: T.faint, fontWeight: 900, width: 52 }}>FLAGS</span>
          {FLAGS.map(([k, l]) => chip(filter.flags.has(k), k === 'early-rotation' ? T.accent : k === 'breakdown' ? T.down : k === 'mine' ? T.info : T.warn, l, () => onFilter({ ...filter, flags: toggleSet(filter.flags, k) })))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={filter.query} onChange={(e) => onFilter({ ...filter, query: e.target.value })} placeholder="Search themes…" aria-label="Search themes"
            style={{ flex: '1 1 160px', maxWidth: 260, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.border2}`, background: T.card2, color: T.text }} />
          {/* Sort control for phones, where the header row is hidden. */}
          <select className="trt-mobile-sort" aria-label="Sort by" value={`${sortKey}|${sortDir}`} onChange={(e) => { const [k, d] = e.target.value.split('|'); onSort(k as SortKey, d as SortDir); }}
            style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, border: `1px solid ${T.border2}`, background: T.card2, color: T.text }}>
            <option value="rank|asc">Priority</option>
            <option value="verdict|asc">Verdict</option>
            <option value="m1|desc">1M change</option>
            <option value="m3|desc">3M change</option>
            <option value="y1|desc">1Y change</option>
            <option value="trend|asc">Trend</option>
            <option value="yours|desc">My names</option>
            <option value="name|asc">Name</option>
          </select>
          <span style={{ fontSize: 11, color: T.faint }}>{rows.length} of {p.total} themes{anyFilter ? ' (filtered)' : ''}</span>
          {anyFilter ? <button type="button" onClick={() => onFilter({ verdicts: new Set(), tiers: new Set(), flags: new Set(), query: '' })} style={{ fontSize: 11, background: 'none', border: 'none', color: T.accent, cursor: 'pointer' }}>clear filters</button> : null}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={p.onExpandAll} style={smallBtn}>Expand all</button>
          <button type="button" onClick={p.onCollapseAll} disabled={!p.expanded.size} style={{ ...smallBtn, opacity: p.expanded.size ? 1 : 0.5 }}>Collapse all</button>
        </div>
      </div>

      {!rows.length ? (
        <div style={{ padding: 18, textAlign: 'center', color: T.faint, fontSize: 12, border: `1px dashed ${T.border2}`, borderRadius: 8 }}>
          {p.total ? 'No theme matches these filters.' : 'No themes could be priced right now.'}
        </div>
      ) : (
        <div className="trt-table-wrap" style={{ overflowX: 'auto' }}>
          <table className="trt-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border2}` }}>
                <th scope="col" style={{ padding: '6px 6px', textAlign: 'left', fontSize: 10.5, color: T.faint, fontWeight: 700 }}>#</th>
                {th('name', 'Theme', undefined, 'left')}
                {th('rank', 'Priority · Why', 'Research priority — by quality and materiality of evidence, not by price change', 'left')}
                {th('verdict', 'Verdict', 'The rotation call (BUY / EARLY BUY / HOLD / WATCH / TRIM / AVOID)', 'center')}
                <th scope="col" style={{ padding: '6px 6px', textAlign: 'left', fontSize: 10.5, color: T.faint, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  <div style={{ marginBottom: 2 }}>Evidence</div>
                  <span style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
                    {LAYER_ORDER.map((k) => (
                      <button key={k} type="button" title={`Sort by ${LAYER_NAME[k]}`} onClick={() => onSort(`layer:${k}`, sortKey === `layer:${k}` && sortDir === 'asc' ? 'desc' : 'asc')}
                        style={{ background: 'none', border: 'none', padding: 0, width: 22, textAlign: 'center', cursor: 'pointer', font: 'inherit', fontSize: 8.5, fontFamily: T.mono, color: sortKey === `layer:${k}` ? T.text : T.faint, fontWeight: sortKey === `layer:${k}` ? 900 : 700 }}>
                        {LAYER_SHORT[k]}
                      </button>
                    ))}
                  </span>
                </th>
                {th('w1', '1W')}{th('m1', '1M')}{th('m3', '3M')}{th('y1', '1Y')}
                {th('trend', 'Trend', 'Accelerating / continuing / reversing vs prior weeks', 'center')}
                {th('yours', 'Yours', 'Names on your lists in this theme (● = holdings)')}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const open = p.expanded.has(v.row.id);
                const r = v.row.ret;
                const trendC = v.trend.dir === 'up' ? T.up : v.trend.dir === 'down' ? T.down : T.flat;
                const flags = v.a.flags;
                const yours = p.yours(v.row.id), held = p.heldIn(v.row.id);
                const retCell = (x?: number) => <td className="trt-d" style={{ padding: '6px 6px', textAlign: 'right', fontFamily: T.mono, fontSize: 11.5, color: x == null ? T.faint : x >= 0 ? T.up : T.down }}>{fmtPct(x)}</td>;
                return (
                  <React.Fragment key={v.row.id}>
                    <tr id={`trt-row-${v.row.id}`} className="trt-row" onClick={() => p.onToggle(v.row.id)} aria-expanded={open}
                      style={{ borderTop: `1px solid ${T.border}`, cursor: 'pointer', background: open ? tint(T.accent, 6) : 'transparent' }}>
                      <td className="trt-d" style={{ padding: '6px 6px', color: T.faint, fontFamily: T.mono, fontSize: 11 }}>{v.rank}</td>
                      <td className="trt-d" style={{ padding: '6px 6px', minWidth: 150 }}>
                        <div style={{ fontWeight: 800, color: T.text, whiteSpace: 'nowrap' }}><span style={{ color: T.faint, fontSize: 9 }}>{open ? '▾' : '▸'}</span> {v.row.emoji} {v.row.name}</div>
                        {flags.length ? <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>{flags.map((f) => <Pill key={f.kind} title={f.why} color={f.kind === 'early-rotation' ? T.accent : f.kind === 'breakdown' ? T.down : T.warn} style={{ fontSize: 9 }}>{f.label}</Pill>)}</div> : null}
                      </td>
                      <td className="trt-d" style={{ padding: '6px 6px', minWidth: 220, maxWidth: 380 }}>
                        <TierBadge tier={v.a.tier} />
                        <div style={{ fontSize: 10.5, color: T.dim, marginTop: 2, lineHeight: 1.35 }}><b style={{ color: T.faint }}>Why:</b> {v.a.why}</div>
                      </td>
                      <td className="trt-d" style={{ padding: '6px 6px', textAlign: 'center' }}><VerdictBadge verdict={v.row.verdict} note={v.row.verdictNote} /></td>
                      <td className="trt-d" style={{ padding: '6px 6px' }}><LayerStrip layers={v.a.layers} compact /></td>
                      {retCell(r?.w1)}{retCell(r?.m1)}{retCell(r?.m3)}{retCell(r?.y1)}
                      <td className="trt-d" style={{ padding: '6px 6px', textAlign: 'center', fontSize: 10.5, color: trendC, whiteSpace: 'nowrap' }} title={v.trend.note}>
                        {v.trend.dir === 'up' ? '↗' : v.trend.dir === 'down' ? '↘' : '→'} {v.trend.word === 'unknown' ? '—' : v.trend.word}
                      </td>
                      <td className="trt-d" style={{ padding: '6px 6px', textAlign: 'right', fontFamily: T.mono, fontSize: 11, color: yours ? T.dim : T.faint }}>
                        {yours || '—'}{held ? <span style={{ color: T.info }}> ●{held}</span> : null}
                      </td>
                      {/* Phone card */}
                      <td className="trt-m" colSpan={COLS} style={{ padding: '8px 4px' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ color: T.faint, fontFamily: T.mono, fontSize: 11 }}>{v.rank}.</span>
                          <span style={{ fontWeight: 900, color: T.text }}>{v.row.emoji} {v.row.name}</span>
                          <VerdictBadge verdict={v.row.verdict} note={v.row.verdictNote} />
                          <TierBadge tier={v.a.tier} />
                          <span style={{ flex: 1 }} />
                          <span style={{ fontSize: 10, color: T.faint }}>{open ? '▾' : '▸'}</span>
                        </div>
                        {flags.length ? <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>{flags.map((f) => <Pill key={f.kind} color={f.kind === 'early-rotation' ? T.accent : f.kind === 'breakdown' ? T.down : T.warn} style={{ fontSize: 9 }}>{f.label}</Pill>)}</div> : null}
                        <div style={{ fontSize: 11, color: T.dim, marginTop: 3, lineHeight: 1.4 }}><b style={{ color: T.faint }}>Why:</b> {v.a.why}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                          {LAYER_ORDER.map((k) => <LayerBadge key={k} k={k} r={v.a.layers[k]} />)}
                        </div>
                        <div style={{ fontSize: 10.5, color: T.faint, marginTop: 3, fontFamily: T.mono }}>
                          1W {fmtPct(r?.w1)} · 1M {fmtPct(r?.m1)} · 3M {fmtPct(r?.m3)} · 1Y {fmtPct(r?.y1)} · <span style={{ color: trendC }}>{v.trend.word === 'unknown' ? 'trend n/a' : v.trend.word}</span>{yours ? ` · yours ${yours}` : ''}
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="trt-panel-row">
                        <td colSpan={COLS} style={{ padding: '0 8px', background: tint(T.accent, 3), borderTop: `1px dashed ${T.border}` }}>{p.renderPanel(v)}</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const smallBtn: React.CSSProperties = { fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.border2}`, background: 'transparent', color: T.dim };

/** Responsive rules for the table and the rest of the tab. */
export const THEME_ROTATION_CSS = `
.trt-table .trt-m { display: none; }
.trt-mobile-sort { display: none; }
@media (max-width: 720px) {
  .trt-table thead { display: none; }
  .trt-table .trt-d { display: none; }
  .trt-table .trt-m { display: table-cell; }
  .trt-mobile-sort { display: inline-block; }
  .trt-table-wrap { overflow-x: visible !important; }
  .trt-rrg-split { grid-template-columns: 1fr !important; }
}
@media (max-width: 480px) {
  .trt-root { padding: 10px !important; }
  .trt-summary { grid-template-columns: 1fr !important; }
  .trt-layer-grid { grid-template-columns: 1fr !important; }
  .trt-sub { grid-template-columns: minmax(90px, 130px) 1fr !important; }
  .trt-sub > span:last-child { grid-column: 1 / -1; }
  .trt-header { flex-direction: column; align-items: stretch !important; }
}
`;
