// zzz1060 — FII / DII page: foreign money by sector, as pictures. A ranked board (holding share bar, last-fortnight and 1-year
// diverging bars, a 12-fortnight sparkline per sector, sort chips), a sectors × fortnights heatmap and rotation call-outs.
'use client';

import { useMemo, useState } from 'react';
import { SparkBars } from './charts';
import { fmtCr, fmtPct, fmtDate, flowColor, GREEN, RED, FD, tint } from './format';
import { heatColor } from '@/lib/fii-dii/insights';

export interface SectorLineV { sector: string; aucCr: number; sharePct: number; fortnightCr: number; fortnightPctOfAuc: number | null; oneYearCr: number; oneYearPctOfAuc: number | null; reports1y: number }
export interface GridV { dates: string[]; rows: Array<{ sector: string; aucCr: number; net: Array<number | null>; momentumCr: number; momentumPct: number | null }>; maxAbs: number; maxAbsPct: number }
export interface RotationV {
  fortnightIn: Array<{ sector: string; cr: number; pctOfAuc: number | null }>; fortnightOut: Array<{ sector: string; cr: number; pctOfAuc: number | null }>;
  yearIn: Array<{ sector: string; cr: number; pctOfAuc: number | null }>; yearOut: Array<{ sector: string; cr: number; pctOfAuc: number | null }>;
  flips: Array<{ sector: string; prevCr: number; nowCr: number; to: 'buy' | 'sell' }>;
}
type SortBy = 'auc' | 'fortnight' | 'oneYear' | 'momentum';

const LINE = FD.line, SOFT = FD.soft, FAINT = FD.faint, ACCENT = FD.accent, CARD = FD.card, INK = FD.text;

/** Bar from a centre line: left red (selling), right green (buying); length and colour strength grow with size. */
function Diverging({ v, max, label, title }: { v: number; max: number; label: string; title: string }) {
  const f = max > 0 ? Math.min(1, Math.abs(v) / max) : 0;
  const pos = v >= 0;
  const alpha = 0.35 + 0.65 * Math.sqrt(f);
  return (
    <div title={title} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <div style={{ position: 'relative', flex: '1 1 auto', height: 14, minWidth: 80 }}>
        <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: FAINT }} />
        <div style={{
          position: 'absolute', top: 1, height: 12, borderRadius: pos ? '0 3px 3px 0' : '3px 0 0 3px',
          left: pos ? '50%' : `${50 - f * 50}%`, width: `${Math.max(f * 50, v === 0 ? 0 : 0.8)}%`,
          background: pos ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`,
        }} />
      </div>
      <span style={{ flex: '0 0 auto', width: 92, textAlign: 'right', fontSize: 12, fontWeight: 600, color: flowColor(v), fontVariantNumeric: 'tabular-nums' }}>{label}</span>
    </div>
  );
}

export function SectorBoard({ lines, grid, lastReport, reports1y, total }: {
  lines: SectorLineV[]; grid: GridV; lastReport: string | null; reports1y: number;
  total: { aucCr: number; fortnightCr: number; oneYearCr: number };
}) {
  const [by, setBy] = useState<SortBy>('fortnight');
  const [desc, setDesc] = useState(true);
  const gridBy = useMemo(() => new Map(grid.rows.map((r) => [r.sector, r])), [grid]);
  const spanDates = grid.dates.slice(-12);
  const sorted = useMemo(() => {
    const key = (l: SectorLineV) => by === 'auc' ? l.aucCr : by === 'fortnight' ? l.fortnightCr : by === 'oneYear' ? l.oneYearCr : (gridBy.get(l.sector)?.momentumCr ?? 0);
    return [...lines].sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
  }, [lines, by, desc, gridBy]);
  const maxShare = Math.max(1, ...lines.map((l) => l.sharePct));
  const maxF = Math.max(1, ...lines.map((l) => Math.abs(l.fortnightCr)));
  const maxY = Math.max(1, ...lines.map((l) => Math.abs(l.oneYearCr)));
  const sortBy = (k: SortBy) => { if (by === k) setDesc((d) => !d); else { setBy(k); setDesc(true); } };
  const ariaSort = (k: SortBy): 'ascending' | 'descending' | 'none' => (by === k ? (desc ? 'descending' : 'ascending') : 'none');
  /** zzz1067 — a real button inside each sortable column header, with aria-sort on the header (keyboard + screen readers). */
  const head = (k: SortBy | null, label: string) => (
    <span role="columnheader" aria-sort={k ? ariaSort(k) : undefined}>
      {k ? (
        <button type="button" onClick={() => sortBy(k)} title={`Sort by ${label.toLowerCase()}`}
          style={{ all: 'unset', cursor: 'pointer', color: by === k ? ACCENT : FAINT, fontWeight: 600, fontSize: 11 }}>
          {label}{by === k ? (desc ? ' ▼' : ' ▲') : ' ↕'}
        </button>
      ) : label}
    </span>
  );
  const chip = (k: SortBy, label: string, hint: string) => (
    <button key={k} type="button" title={hint} aria-pressed={by === k} onClick={() => sortBy(k)}
      style={{ padding: '4px 10px', borderRadius: 999, border: `1px solid ${by === k ? ACCENT : LINE}`, background: by === k ? tint(ACCENT, 12) : CARD, color: by === k ? ACCENT : SOFT, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
      {label}{by === k ? (desc ? ' ▼' : ' ▲') : ''}
    </button>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
        <span style={{ fontSize: 12, color: SOFT }}>Sort by</span>
        {chip('fortnight', 'Last fortnight', 'Net flow in the latest fortnight')}
        {chip('oneYear', '1 year', 'Net flow over the last 12 months')}
        {chip('momentum', 'Momentum', 'Net flow of the last 3 fortnights — where money is moving now')}
        {chip('auc', 'Holding size', 'How much foreigners own in the sector')}
      </div>
      <div className="fd-sec-head" role="row" style={{ fontSize: 11, color: FAINT, fontWeight: 600, padding: '0 0 4px', borderBottom: `1px solid ${LINE}` }}>
        {head(null, 'Sector')}{head('auc', 'Share of holdings')}{head('fortnight', `Last fortnight (${fmtDate(lastReport, true)})`)}{head('oneYear', `1-year net flow${reports1y && reports1y < 24 ? ` (${reports1y}/24 fortnights)` : ''}`)}{head('momentum', `Last ${spanDates.length} fortnights`)}
      </div>
      {sorted.map((l) => {
        const g = gridBy.get(l.sector);
        const spark = g ? g.net.slice(-12) : [];
        return (
          <div key={l.sector} className="fd-sec-row" style={{ borderBottom: `1px solid ${LINE}`, padding: '7px 0' }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.sector}>{l.sector}</div>
            <div title={`Foreign holding ${fmtCr(l.aucCr)} — ${l.sharePct.toFixed(1)}% of all FPI equity holdings`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="fd-sec-tag">Share</span>
              <div style={{ flex: 1, height: 10, background: FD.subtle, borderRadius: 3, minWidth: 50 }}>
                <div style={{ width: `${(l.sharePct / maxShare) * 100}%`, height: 10, background: '#93c5fd', borderRadius: 3 }} />
              </div>
              <span style={{ width: 42, textAlign: 'right', fontSize: 12, color: SOFT, fontVariantNumeric: 'tabular-nums' }}>{l.sharePct.toFixed(1)}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="fd-sec-tag">Fortnight</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Diverging v={l.fortnightCr} max={maxF} label={fmtCr(l.fortnightCr, { signed: true })}
                  title={`Last fortnight: ${fmtCr(l.fortnightCr, { signed: true })} (${fmtPct(l.fortnightPctOfAuc, true)} of the holding)`} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="fd-sec-tag">1 year{l.reports1y < 24 ? ` (${l.reports1y}/24)` : ""}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Diverging v={l.oneYearCr} max={maxY} label={`${fmtCr(l.oneYearCr, { signed: true })}`}
                  title={`1-year net flow: ${fmtCr(l.oneYearCr, { signed: true })} = ${fmtPct(l.oneYearPctOfAuc, true)} of the ${fmtCr(l.aucCr)} holding`} />
              </div>
              <span style={{ width: 48, textAlign: 'right', fontSize: 11, color: flowColor(l.oneYearPctOfAuc), fontVariantNumeric: 'tabular-nums' }}>{fmtPct(l.oneYearPctOfAuc, true)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={g ? `Momentum (last 3 fortnights): ${fmtCr(g.momentumCr, { signed: true })}` : ''}>
              <span className="fd-sec-tag">Trend</span>
              {spark.length ? <SparkBars vals={spark} dates={spanDates} width={120} height={26} /> : <span style={{ fontSize: 11, color: FAINT }}>—</span>}
            </div>
          </div>
        );
      })}
      <div className="fd-sec-row" style={{ padding: '8px 0', fontWeight: 700, fontSize: 13 }}>
        <div>All sectors</div>
        <div style={{ color: SOFT, fontWeight: 600 }}>{fmtCr(total.aucCr)} held</div>
        <div style={{ color: flowColor(total.fortnightCr) }}>{fmtCr(total.fortnightCr, { signed: true })}</div>
        <div style={{ color: flowColor(total.oneYearCr) }}>{fmtCr(total.oneYearCr, { signed: true })}</div>
        <div />
      </div>
    </div>
  );
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

export function SectorHeatmap({ grid }: { grid: GridV }) {
  const [mode, setMode] = useState<'cr' | 'pct'>('cr');
  const [hover, setHover] = useState<{ s: string; d: string; v: number | null; pct: number | null } | null>(null);
  if (!grid.dates.length) return null;
  const n = grid.dates.length;
  const val = (r: GridV['rows'][number], v: number | null) => (v == null ? null : mode === 'cr' ? v : r.aucCr > 0 ? (v / r.aucCr) * 100 : null);
  const max = mode === 'cr' ? grid.maxAbs : grid.maxAbsPct;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0 8px' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['cr', 'pct'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} style={{ padding: '3px 10px', borderRadius: 6, border: `1px solid ${mode === m ? ACCENT : LINE}`, background: mode === m ? tint(ACCENT, 12) : CARD, color: mode === m ? ACCENT : SOFT, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {m === 'cr' ? '₹ crore' : '% of holding'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: SOFT }}>
          <span style={{ color: RED, fontWeight: 600 }}>Selling</span>
          <div style={{ width: 120, height: 10, borderRadius: 3, background: `linear-gradient(90deg, ${heatColor(-1, 1)}, #ffffff, ${heatColor(1, 1)})`, border: `1px solid ${LINE}` }} />
          <span style={{ color: GREEN, fontWeight: 600 }}>Buying</span>
        </div>
      </div>
      <div style={{ minHeight: 18, fontSize: 12, color: SOFT, marginBottom: 4 }}>
        {hover ? <><b style={{ color: INK }}>{hover.s}</b> · fortnight to {fmtDate(hover.d)}: <b style={{ color: flowColor(hover.v) }}>{fmtCr(hover.v, { signed: true })}</b>{hover.pct != null ? ` (${fmtPct(hover.pct, true)} of holding)` : ''}</> : 'Hover a cell for the exact figure. Each column is one fortnight, newest on the right.'}
      </div>
      <div style={{ overflowX: 'auto' }} onMouseLeave={() => setHover(null)}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: CARD, textAlign: 'left', padding: '0 6px 0 0', color: SOFT, fontWeight: 600, minWidth: 130 }}>Sector</th>
              {grid.dates.map((d, i) => (
                <th key={d} style={{ color: FAINT, fontWeight: 500, padding: 0, height: 44, verticalAlign: 'bottom', width: 24 }}>
                  {(n - 1 - i) % 2 === 0 ? <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', margin: '0 auto' }}>{short(d)}{d.slice(5, 7) === '01' && Number(d.slice(8, 10)) <= 15 ? ` ${d.slice(2, 4)}` : ''}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.sector}>
                <td style={{ position: 'sticky', left: 0, background: CARD, padding: '0 6px 0 0', whiteSpace: 'nowrap', color: INK, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.sector}>{r.sector}</td>
                {r.net.map((v, i) => {
                  const shown = val(r, v);
                  const pct = v != null && r.aucCr > 0 ? (v / r.aucCr) * 100 : null;
                  return (
                    <td key={grid.dates[i]} onMouseEnter={() => setHover({ s: r.sector, d: grid.dates[i], v, pct })}
                      title={`${r.sector}, fortnight to ${fmtDate(grid.dates[i])}: ${fmtCr(v, { signed: true })}${pct != null ? ` (${fmtPct(pct, true)} of holding)` : ''}`}
                      style={{ width: 24, minWidth: 22, height: 20, borderRadius: 3, background: heatColor(shown, max), outline: hover && hover.s === r.sector && hover.d === grid.dates[i] ? `2px solid ${INK}` : undefined }} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CallList({ title, items, kind, hint }: { title: string; items: Array<{ sector: string; cr: number; pctOfAuc: number | null }>; kind: 'in' | 'out'; hint: string }) {
  if (!items.length) return null;
  const c = kind === 'in' ? GREEN : RED;
  return (
    <div style={{ flex: '1 1 220px', border: `1px solid ${tint(c, 35)}`, background: tint(c, 8), borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{kind === 'in' ? '▲' : '▼'} {title}</div>
      <div style={{ fontSize: 11, color: SOFT, marginBottom: 6 }}>{hint}</div>
      {items.map((it, i) => (
        <div key={it.sector} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0' }}>
          <span><b style={{ color: FAINT, marginRight: 6 }}>{i + 1}</b>{it.sector}</span>
          <span style={{ color: c, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} title={it.pctOfAuc != null ? `${fmtPct(it.pctOfAuc, true)} of the sector holding` : ''}>{fmtCr(it.cr, { signed: true })}</span>
        </div>
      ))}
    </div>
  );
}

export function RotationCallouts({ rot, reports1y = 24 }: { rot: RotationV; reports1y?: number }) {
  const part = reports1y > 0 && reports1y < 24 ? ` — only ${reports1y} of 24 fortnights stored` : '';
  const any = rot.fortnightIn.length + rot.fortnightOut.length + rot.yearIn.length + rot.yearOut.length + rot.flips.length;
  if (!any) return null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <CallList title="Buying into — last fortnight" items={rot.fortnightIn} kind="in" hint="Where new foreign money went" />
        <CallList title="Leaving — last fortnight" items={rot.fortnightOut} kind="out" hint="Where foreigners sold most" />
        <CallList title="Buying into — 1 year" items={rot.yearIn} kind="in" hint={`Steady adding over 12 months${part}`} />
        <CallList title="Leaving — 1 year" items={rot.yearOut} kind="out" hint={`Steady cutting over 12 months${part}`} />
      </div>
      {rot.flips.length ? (
        <div style={{ marginTop: 10, border: `1px solid ${tint(FD.warn, 40)}`, background: tint(FD.warn, 8), borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: FD.warn }}>↻ Turned this fortnight</div>
          <div style={{ fontSize: 11, color: SOFT, marginBottom: 6 }}>Sectors where foreigners switched from buying to selling (or back). Only moves of ₹250 Cr or more both times.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rot.flips.map((f) => (
              <span key={f.sector} title={`Previous fortnight ${fmtCr(f.prevCr, { signed: true })} → last fortnight ${fmtCr(f.nowCr, { signed: true })}`}
                style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: CARD, border: `1px solid ${tint(f.to === 'buy' ? GREEN : RED, 35)}` }}>
                <b>{f.sector}</b>: <span style={{ color: flowColor(f.prevCr) }}>{fmtCr(f.prevCr, { signed: true })}</span> → <b style={{ color: flowColor(f.nowCr) }}>{fmtCr(f.nowCr, { signed: true })}</b> {f.to === 'buy' ? 'now buying' : 'now selling'}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Responsive layout for the sector board (inline styles cannot hold media queries). */
export const SECTOR_CSS = `
.fd-sec-head, .fd-sec-row { display: grid; grid-template-columns: minmax(120px, 1.1fr) minmax(110px, 0.9fr) minmax(170px, 1.4fr) minmax(210px, 1.6fr) 132px; gap: 12px; align-items: center; }
.fd-sec-tag { display: none; font-size: 10px; color: ${FAINT}; width: 58px; flex: 0 0 58px; text-transform: uppercase; letter-spacing: 0.3px; }
@media (max-width: 820px) {
  .fd-sec-head { display: none; }
  .fd-sec-row { grid-template-columns: 1fr; gap: 4px; }
  .fd-sec-tag { display: inline-block; }
}
`;
