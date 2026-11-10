'use client';
// zzz1231 — Portfolio (India) → 📒 Tradebook: upload Zerodha tradebook files (any number, any order; a file or trade seen
// before is ignored), then returns (XIRR overall / this year / by fiscal year, against Nifty Smallcap 100), holdings
// rebuilt from the trades (applied to the portfolio automatically, with Undo), estimated dividends, and trades / P&L.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { applyHoldingsDiff, holdingsDiff, parseTradebookRows, reconcilePortfolio, type HoldingChange, type Trade } from '@/lib/tradebook/core';
import type { TradebookAnalytics } from '@/lib/tradebook/server';

type H = { symbol: string; entryPrice: number; quantity: number; weight: number; addedAt: string; notes?: string };
const C = {
  panel: 'var(--mc-bg-1)', line: 'var(--mc-border-2)', txt: 'var(--mc-text-1)', mute: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#D97706', blue: '#3B82F6', violet: '#8B5CF6',
};
const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `₹${Math.round(v * 10 ** d) / 10 ** d >= 0 ? '' : '−'}${Math.abs(v) >= 1e7 ? `${(Math.abs(v) / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${(Math.abs(v) / 1e5).toFixed(2)} L` : Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: d })}`);
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v == null ? C.mute : v >= 0 ? C.green : C.red);

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.txt, letterSpacing: 0.3 }}>{title}</div>{right}
      </div>
      {children}
    </div>
  );
}
function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ minWidth: 150, padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: C.dim, fontWeight: 800, letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || C.txt, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.dim, fontWeight: 800, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
const thL: React.CSSProperties = { ...th, textAlign: 'left' };
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 12.5, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

/**
 * zzz1245 — time-weighted return of the book from the first day of `view`: each day's change in value with that day's buys and
 * sells taken out (money put in is not a gain), chained. Days that start from almost nothing are left flat (no huge % on ₹1,000).
 */
function twrSeries(view: TradebookAnalytics['growth']): number[] {
  const out = [0];
  let cum = 0;
  for (let i = 1; i < view.length; i++) {
    const prev = view[i - 1].value, flow = view[i].net - view[i - 1].net;
    const r = prev >= 10_000 ? (view[i].value - flow) / prev - 1 : 0;
    cum = (1 + cum) * (1 + (Number.isFinite(r) ? Math.max(-0.5, Math.min(0.5, r)) : 0)) - 1;
    out.push(cum);
  }
  return out;
}
const pctTxt = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);

function TipRow({ color, label, value, sub, bold, dashed }: { color?: string; label: string; value: string; sub?: string; bold?: boolean; dashed?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <span style={{ width: 10, height: dashed ? 0 : 10, borderRadius: 3, background: dashed ? 'transparent' : color, borderTop: dashed ? `2px dashed ${color}` : undefined }} />
      <span style={{ color: 'var(--mc-text-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 900 : 700, color: 'var(--mc-text-1)' }}>{value}{sub && <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700 }}>{sub}</span>}</span>
    </div>
  );
}

// zzz1242 — day-by-day chart with periods (3M … Max), a hover read-out, value vs cost of the holdings, and the index line.
// zzz1245 — Value / % switch: in % the book is a time-weighted return from the period start (buys and sells taken out),
// against the index's own % move; the read-out is a card with colour keys, the gap to the index and the change in the period.
const RANGES = [['3M', 91], ['6M', 182], ['YTD', -1], ['1Y', 365], ['3Y', 1095], ['5Y', 1826], ['Max', 0]] as const;
function GrowthChart({ pts }: { pts: TradebookAnalytics['growth'] }) {
  const [range, setRange] = useState<string>('1Y');
  const [mode, setMode] = useState<'value' | 'pct'>('value');
  const [hover, setHover] = useState<number | null>(null);
  const [showBench, setShowBench] = useState(true);
  const view = useMemo(() => {
    if (!pts.length) return pts;
    const last = Date.parse(pts[pts.length - 1].d);
    const r = RANGES.find((x) => x[0] === range)!;
    const from = r[1] === 0 ? -Infinity : r[1] === -1 ? Date.UTC(new Date(last).getUTCFullYear(), 0, 1) : last - r[1] * 86_400_000;
    return pts.filter((p) => Date.parse(p.d) >= from);
  }, [pts, range]);
  const twr = useMemo(() => twrSeries(view), [view]);
  if (pts.length < 2) return null;
  if (view.length < 2) return <div style={{ fontSize: 12, color: C.mute }}>Not enough days in this period.</div>;
  const pct = mode === 'pct';
  const W = 1000, H = 320, L = 74, R = 14, T = 14, B = 28;
  // the index line for THIS period: the book's value on its first day put in the index, plus the same buys and sells after
  const i0 = view[0].ix, u0 = view[0].bench != null && i0 ? view[0].bench / i0 : null;
  const benchVal = view.map((p) => (p.bench != null && p.ix && i0 && u0 != null ? p.ix * (view[0].value / i0 + p.bench / p.ix - u0) : null));
  const benchPct = view.map((p) => (p.ix && i0 ? p.ix / i0 - 1 : null));
  const series = {
    main: (i: number) => (pct ? twr[i] : view[i].value),
    bench: (i: number) => (!showBench ? null : pct ? benchPct[i] : benchVal[i]),
    cost: (i: number) => (pct ? null : view[i].cost),
  };
  const vals: number[] = [];
  view.forEach((_, i) => { for (const f of [series.main, series.bench, series.cost]) { const v = f(i); if (v != null && Number.isFinite(v)) vals.push(v); } });
  let max = Math.max(...vals), min = Math.min(...vals);
  if (pct) { max = Math.max(max, 0); min = Math.min(min, 0); }
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.05 || 0.01; max += pad; min = pct ? min - pad : Math.max(0, min - pad);
  const x = (i: number) => L + (i / (view.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const line = (get: (i: number) => number | null) => view.map((_, i) => { const v = get(i); return v == null ? '' : `${i && get(i - 1) != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; }).join(' ');
  const base = pct ? y(0) : H - B;
  const area = `${line(series.main)} L${x(view.length - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => min + k * (max - min));
  const fmtY = (v: number) => (pct ? pctTxt(v, Math.abs(max - min) < 0.2 ? 1 : 0) : inr(v));
  const first = view[0], last = view[view.length - 1], n = view.length - 1;
  const gain = last.value - first.value - (last.net - first.net);
  const putIn = last.net - first.net;
  const bookP = twr[n], idxP = benchPct[n];
  const fmtD = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const labelIdx = [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n];
  const h = hover != null ? view[hover] : null;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n, Math.round(((px - L) / (W - L - R)) * n))));
  };
  const seg = (on: boolean) => ({ padding: '4px 12px', fontSize: 11.5, fontWeight: 800, border: 'none', cursor: 'pointer', background: on ? C.blue : 'transparent', color: on ? '#fff' : C.mute } as const);
  const tipLeft = hover != null ? (x(hover) / W) * 100 : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setMode('value')} style={seg(!pct)}>₹ Value</button>
            <button onClick={() => setMode('pct')} style={seg(pct)}>% Return</button>
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {RANGES.map(([k]) => <button key={k} onClick={() => { setRange(k); setHover(null); }} style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 800, borderRadius: 6, cursor: 'pointer', border: `1px solid ${range === k ? C.blue : C.line}`, background: range === k ? `${C.blue}22` : 'transparent', color: range === k ? C.blue : C.mute }}>{k}</button>)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {pct ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 900, color: tone(bookP) }}>{pctTxt(bookP)}</div>
              <div style={{ fontSize: 11.5, color: C.mute }}>your book over {range === 'Max' ? 'all years' : range} · <span style={{ color: C.violet }}>index {pctTxt(idxP)}</span>{idxP != null ? <> · <b style={{ color: tone(bookP - idxP) }}>{bookP - idxP >= 0 ? 'ahead' : 'behind'} by {Math.abs((bookP - idxP) * 100).toFixed(1)} pts</b></> : null}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 900, color: tone(gain) }}>{gain >= 0 ? '+' : ''}{inr(gain)}</div>
              <div style={{ fontSize: 11.5, color: C.mute }}>gain over {range === 'Max' ? 'all years' : range} · {putIn >= 0 ? `${inr(putIn)} put in` : `${inr(-putIn)} taken out`} · return {pctTxt(bookP)}</div>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: C.mute, alignItems: 'center', marginBottom: 4 }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 3, background: C.blue, verticalAlign: 'middle', marginRight: 5, borderRadius: 2 }} />{pct ? 'Your book (time-weighted — buys and sells taken out)' : 'Value'}</span>
        {!pct && <span><span style={{ display: 'inline-block', width: 14, borderTop: '2px dashed #94A3B8', verticalAlign: 'middle', marginRight: 5 }} />Invested (cost of the shares held)</span>}
        <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={showBench} onChange={(e) => setShowBench(e.target.checked)} style={{ verticalAlign: 'middle' }} /> <span style={{ color: C.violet }}>{pct ? 'Nifty Smallcap 100' : 'Same money in Nifty Smallcap 100'}</span></label>
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={pct ? 'Book return in % against the index' : 'Book value and invested amount over time'}>
          <defs>
            <linearGradient id="tbg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={0.24} /><stop offset="100%" stopColor={C.blue} stopOpacity={0.02} /></linearGradient>
          </defs>
          {ticks.map((v, i) => (<g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--mc-border-2)" strokeWidth={0.6} /><text x={L - 8} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--mc-text-3)">{fmtY(v)}</text></g>))}
          {pct && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--mc-text-4)" strokeWidth={1} />}
          <path d={area} fill="url(#tbg)" stroke="none" />
          {!pct && <path d={line(series.cost)} fill="none" stroke="#94A3B8" strokeWidth={1.4} strokeDasharray="5 4" />}
          {showBench && <path d={line(series.bench)} fill="none" stroke={C.violet} strokeWidth={1.6} />}
          <path d={line(series.main)} fill="none" stroke={C.blue} strokeWidth={2.2} strokeLinejoin="round" />
          {labelIdx.map((i, k) => <text key={k} x={x(i)} y={H - 8} fontSize={11} textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'} fill="var(--mc-text-3)">{fmtD(view[i].d)}</text>)}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--mc-text-4)" strokeDasharray="3 3" />
              {series.cost(hover) != null && <circle cx={x(hover)} cy={y(series.cost(hover)!)} r={3.5} fill="#94A3B8" stroke="var(--mc-bg-1)" strokeWidth={1.5} />}
              {series.bench(hover) != null && <circle cx={x(hover)} cy={y(series.bench(hover)!)} r={3.5} fill={C.violet} stroke="var(--mc-bg-1)" strokeWidth={1.5} />}
              <circle cx={x(hover)} cy={y(series.main(hover))} r={4.5} fill={C.blue} stroke="var(--mc-bg-1)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {h && hover != null && (() => {
          const unreal = h.value - h.cost, bv = benchVal[hover], bp = benchPct[hover], mp = twr[hover];
          const chg = h.value - first.value - (h.net - first.net);
          return (
            <div style={{ position: 'absolute', top: 10, ...(tipLeft > 55 ? { right: `${Math.max(1, 100 - tipLeft + 2)}%` } : { left: `${tipLeft + 2}%` }), background: 'var(--mc-bg-0)', border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 12px', fontSize: 12, pointerEvents: 'none', minWidth: 230, boxShadow: '0 8px 24px rgba(0,0,0,.28)' }}>
              <div style={{ color: C.txt, fontWeight: 800, fontSize: 12, marginBottom: 5 }}>{new Date(h.d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</div>
              {pct ? (
                <>
                  <TipRow color={C.blue} label="Your book" value={pctTxt(mp)} bold />
                  {showBench && <TipRow color={C.violet} label="Nifty Smallcap 100" value={pctTxt(bp)} />}
                  {showBench && bp != null && <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 5, paddingTop: 5 }}><TipRow label={mp - bp >= 0 ? 'Ahead of index' : 'Behind index'} value={`${Math.abs((mp - bp) * 100).toFixed(1)} pts`} /></div>}
                  <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>From {fmtD(first.d)} · value {inr(h.value)}</div>
                </>
              ) : (
                <>
                  <TipRow color={C.blue} label="Value" value={inr(h.value)} bold />
                  <TipRow color="#94A3B8" dashed label="Invested" value={inr(h.cost)} />
                  <TipRow label="Unrealised" value={`${unreal >= 0 ? '+' : ''}${inr(unreal)}`} sub={h.cost > 0 ? pctTxt(unreal / h.cost) : undefined} />
                  {showBench && bv != null && <TipRow color={C.violet} label="Same money in index" value={inr(bv)} />}
                  <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 5, paddingTop: 5 }}>
                    <TipRow label={`Gain since ${fmtD(first.d)}`} value={`${chg >= 0 ? '+' : ''}${inr(chg)}`} sub={pctTxt(mp)} />
                    {showBench && bv != null && <TipRow label={h.value - bv >= 0 ? 'Ahead of index' : 'Behind index'} value={inr(Math.abs(h.value - bv))} />}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function ReturnsTable({ rows, title }: { rows: TradebookAnalytics['byFy']; title: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={thL}>{title}</th><th style={th}>Value at start</th><th style={th}>Bought</th><th style={th}>Sold</th><th style={th}>Value at end</th><th style={th} title="Estimated cash dividends received in the period (in the gain and the XIRR)">Dividends</th><th style={th}>Gain</th><th style={th} title="Money-weighted return of the period (Modified Dietz) — not annualised">Return</th><th style={th} title="Money-weighted rate (XIRR). A year or longer: per year. A part year (marked 'period'): the rate for that part only, not stretched to a year.">XIRR</th><th style={th} title="The same money in Nifty Smallcap 100 on the same days, on the same basis">Nifty Smallcap 100</th><th style={th}>Beat index by</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.xirr != null && r.bench?.xirr != null ? r.xirr - r.bench.xirr : null;
            const isOpen = open === r.label;
            return (
              <Fragment key={r.label}>
                <tr onClick={() => setOpen(isOpen ? null : r.label)} style={{ cursor: r.top?.length ? 'pointer' : 'default' }} title="Click: what the value at the end is made of">
                  <td style={tdL}><b>{r.top?.length ? (isOpen ? '▾ ' : '▸ ') : ''}{r.label}</b><div style={{ fontSize: 10.5, color: C.dim }}>{r.from} → {r.to}{r.estimated ? ` · valued at last trade price (no price history): ${(r.estimatedSymbols || []).join(', ') || r.estimated}` : ''}</div></td>
                  <td style={td}>{inr(r.startValue)}</td><td style={td}>{inr(r.invested)}</td><td style={td}>{inr(r.withdrawn)}</td><td style={td}>{inr(r.endValue)}</td>
                  <td style={{ ...td, color: C.mute }}>{r.dividends ? inr(r.dividends) : '—'}</td>
                  <td style={{ ...td, color: tone(r.gain), fontWeight: 700 }}>{inr(r.gain)}</td>
                  <td style={{ ...td, color: tone(r.simple) }}>{pct(r.simple)}</td>
                  <td style={{ ...td, color: tone(r.xirr), fontWeight: 800 }}>{pct(r.xirr)}{r.xirr != null && r.annualised === false ? <div style={{ fontSize: 9.5, color: C.dim, fontWeight: 600 }}>period</div> : null}</td>
                  <td style={{ ...td, color: C.violet }}>{pct(r.bench?.xirr)}</td>
                  <td style={{ ...td, color: tone(diff), fontWeight: 700 }}>{diff == null ? '—' : `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} pts`}</td>
                </tr>
                {isOpen && r.top?.length ? (
                  <tr key={r.label + ':top'}><td colSpan={11} style={{ padding: '6px 10px 10px 22px', borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ fontSize: 11, color: C.dim, fontWeight: 800, marginBottom: 4 }}>LARGEST HOLDINGS ON {r.to} — check these against your broker&apos;s holdings for that day</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.top.map((h) => <span key={h.symbol} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 6, border: `1px solid ${h.estimated ? C.amber : C.line}`, color: C.txt }}><b>{h.symbol}</b> {h.qty} × {h.price != null ? `₹${h.price.toFixed(1)}` : '—'} = {inr(h.value)}{h.estimated ? <span style={{ color: C.amber }}> (last trade price)</span> : null}</span>)}
                    </div>
                  </td></tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TradebookTab({ holdings, onApply }: { holdings: H[]; onApply: (next: H[]) => Promise<boolean> | boolean }) {
  const [data, setData] = useState<TradebookAnalytics | null>(null);
  const [files, setFiles] = useState<TradebookAnalytics['files']>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [sub, setSub] = useState<'performance' | 'holdings' | 'pnl' | 'dividends' | 'files'>('performance');
  const [applied, setApplied] = useState<{ changes: HoldingChange[]; before: H[] } | null>(null);

  const load = useCallback(async (force = false) => {
    setBusy(force ? 'Recomputing with fresh prices… (about a minute)' : 'Loading your last result…'); setErr(null);
    try {
      const r = await fetch(`/api/v1/tradebook?analytics=1${force ? '&force=1' : ''}`, { signal: AbortSignal.timeout(280_000) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j); setFiles(j.files || []);
      return j as TradebookAnalytics;
    } catch (e: any) { setErr(String(e?.message || e)); return null; } finally { setBusy(null); }
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/v1/tradebook').then((x) => x.json()).catch(() => null);
      if (r?.files) setFiles(r.files);
      if (r?.files?.length) void load();
    })();
  }, [load]);

  const autoApply = useCallback(async (a: TradebookAnalytics) => {
    const diff = holdingsDiff({ positions: a.ledgerPositions, unmatchedIsins: a.unmatchedIsins, tradedSymbols: a.tradedSymbols }, holdings);
    const changes = diff.filter((d) => d.action !== 'keep');
    if (!changes.length) { setLog((l) => [...l, 'Portfolio already matches the tradebook — nothing to change.']); return; }
    const today = new Date().toISOString();
    const next = applyHoldingsDiff(holdings, diff, (c) => ({ symbol: c.symbol, entryPrice: c.entryPrice, quantity: c.quantity, weight: 0, addedAt: today, notes: 'from tradebook' }));
    const before = holdings;
    const ok = await onApply(next);
    setApplied({ changes, before });
    setLog((l) => [...l, `Portfolio updated from the tradebook: ${changes.filter((c) => c.action === 'add').length} added, ${changes.filter((c) => c.action === 'update').length} quantity / price changed, ${changes.filter((c) => c.action === 'remove').length} sold out and removed${ok ? '' : ' (saved on this device only)'}.`]);
  }, [holdings, onApply]);

  const onFiles = useCallback(async (list: File[]) => {   // zzz1238 — an array copied at once (a FileList empties when the input is cleared)
    if (!list.length) { setErr('No file picked.'); return; }
    setErr(null); setLog([]);
    const XLSX = await import('xlsx');
    const known = new Set(files.map((f) => f.hash));
    let total = 0;
    for (const file of list) {
      setBusy(`Reading ${file.name}…`);
      try {
        const buf = await file.arrayBuffer();
        const hash = await sha256(buf);
        if (known.has(hash)) { setLog((l) => [...l, `${file.name}: uploaded before — skipped.`]); continue; }
        const wb = XLSX.read(buf, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }) as unknown[][];
        const p = parseTradebookRows(rows);
        if (!p.trades.length) { setLog((l) => [...l, `${file.name}: no trades found (is it a Zerodha equity tradebook?).`]); continue; }
        let added = 0, dup = false;
        for (let i = 0; i < p.trades.length; i += 2000) {
          const chunk: Trade[] = p.trades.slice(i, i + 2000);
          setBusy(`Saving ${file.name} — ${Math.min(i + 2000, p.trades.length)} of ${p.trades.length} trades…`);
          const r = await fetch('/api/v1/tradebook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: { hash, name: file.name, from: p.from, to: p.to, rows: p.trades.length }, trades: chunk, last: i + 2000 >= p.trades.length }) });
          const j = await r.json().catch(() => null);
          if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
          if (j.duplicateFile) { dup = true; break; }
          added += j.added;
        }
        known.add(hash);
        total += added;
        setLog((l) => [...l, dup ? `${file.name}: uploaded before — skipped.` : `${file.name}: ${p.from} → ${p.to}, ${p.trades.length} trades, ${added} new${added < p.trades.length ? ` (${p.trades.length - added} already stored)` : ''}.`]);
      } catch (e: any) { setLog((l) => [...l, `${file.name}: failed — ${String(e?.message || e).slice(0, 120)}`]); }
    }
    setBusy(null);
    const a = await load(total > 0);
    if (a && total > 0) await autoApply(a);
  }, [files, load, autoApply]);

  const undo = useCallback(async () => {
    if (!applied) return;
    await onApply(applied.before);
    setLog((l) => [...l, 'Undone — the portfolio is back to what it was before the tradebook.']);
    setApplied(null);
  }, [applied, onApply]);

  const s = data?.summary;
  // zzz1240 — why the portfolio's invested value is not the tradebook's cost
  const recon = useMemo(() => (data ? reconcilePortfolio({ positions: data.ledgerPositions, unmatchedIsins: data.unmatchedIsins, tradedSymbols: data.tradedSymbols }, holdings) : null), [data, holdings]);
  const pending = useMemo(() => (data ? holdingsDiff({ positions: data.ledgerPositions, unmatchedIsins: data.unmatchedIsins, tradedSymbols: data.tradedSymbols }, holdings).filter((d) => d.action !== 'keep') : []), [data, holdings]);

  return (
    <div data-testid="tradebook-tab">
      <Card title="📒 Tradebook — upload your Zerodha equity tradebooks" right={data && <button onClick={() => load(true)} disabled={!!busy} style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.mute, cursor: 'pointer' }}>↻ Recompute with latest prices</button>}>
        {data && (
          <div style={{ fontSize: 11.5, color: (data as any).stale || (data as any).outdated ? C.amber : C.dim, marginBottom: 8 }}>
            Last computed {new Date(data.builtAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} with prices of {data.priceDate}. It is kept as it is — it recomputes only when you press ↻ Recompute or upload new trades.
            {(data as any).stale ? ' Trades have changed since then — press ↻ Recompute.' : (data as any).outdated ? ' The site\'s calculation has been improved since — press ↻ Recompute to apply it.' : ''}
          </div>
        )}
        <label style={{ display: 'block', border: `1.5px dashed ${C.line}`, borderRadius: 10, padding: 18, textAlign: 'center', cursor: busy ? 'wait' : 'pointer', color: C.mute, fontSize: 13 }}>
          <input type="file" accept=".xlsx,.xls,.csv" multiple disabled={!!busy} style={{ display: 'none' }} onChange={(e) => { const picked = Array.from(e.target.files || []); e.currentTarget.value = ''; void onFiles(picked); }} />
          <b style={{ color: C.txt }}>Choose tradebook files</b> (Console → Reports → Tradebook → Equity, one file per year is fine).<br />
          Upload all years once. After that, re-download and upload just this year's file whenever you trade — trades already stored are recognised (by exchange, date, trade and order number) and only the new ones are added; earlier years stay as they are. The portfolio list below shows any change before it is made.
        </label>
        {busy && <div style={{ marginTop: 10, color: C.blue, fontSize: 12.5 }}>⏳ {busy}</div>}
        {err && <div style={{ marginTop: 10, color: C.red, fontSize: 12.5 }}>⚠ {err}</div>}
        {log.length > 0 && <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: C.mute }}>{log.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {applied && (
          <div style={{ marginTop: 10, padding: 10, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><b>Changes made to your portfolio</b><button onClick={undo} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.amber}`, color: C.amber, background: 'transparent', cursor: 'pointer' }}>↶ Undo</button></div>
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, color: C.mute }}>
              {applied.changes.map((c) => <div key={c.symbol}>{c.action === 'add' ? '＋' : c.action === 'remove' ? '－' : '✎'} {c.symbol}: {c.before ? `${c.before.quantity} @ ₹${c.before.entryPrice}` : 'new'} → {c.action === 'remove' ? 'sold out' : `${c.quantity} @ ₹${c.entryPrice}`}</div>)}
            </div>
          </div>
        )}
        {!applied && data && pending.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: C.amber }}>
            {pending.length} holding{pending.length === 1 ? '' : 's'} differ from the tradebook. <button onClick={() => data && autoApply(data)} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.amber}`, color: C.amber, background: 'transparent', cursor: 'pointer' }}>Update portfolio from tradebook</button>
            {/* zzz1239 — what the button will change, before it is pressed (Undo stays available after) */}
            <div data-testid="tradebook-pending" style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, color: C.mute }}>
              {pending.map((c) => <div key={c.symbol}>{c.action === 'add' ? '＋ add' : c.action === 'remove' ? '－ remove (sold out)' : '✎ change'} <b>{c.symbol}</b>: {c.before ? `${c.before.quantity} @ ₹${c.before.entryPrice}` : 'not in portfolio'} → {c.action === 'remove' ? '0' : `${c.quantity} @ ₹${c.entryPrice}`}</div>)}
            </div>
          </div>
        )}
      </Card>

      {data && s && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi label="CURRENT VALUE" value={inr(s.value)} sub={`cost ${inr(s.invested)} · prices ${data.priceDate}`} />
            <Kpi label="UNREALISED" value={inr(s.unrealized)} color={tone(s.unrealized)} sub={pct(s.invested ? s.unrealized / s.invested : null)} />
            <Kpi label="REALISED (all years)" value={inr(s.realized)} color={tone(s.realized)} sub="before charges and tax" />
            <Kpi label="XIRR — OVERALL" value={pct(s.xirrAll)} color={tone(s.xirrAll)} sub={`Nifty Smallcap 100: ${pct(s.benchXirrAll)}`} />
            <Kpi label={`${new Date().getFullYear()} SO FAR`} value={pct(s.xirrYtd)} color={tone(s.xirrYtd)} sub={`this fiscal year so far: ${pct(s.xirrFytd)} · money-weighted, not stretched to a year`} />
            <Kpi label="DIVIDENDS (estimated)" value={inr(s.dividends)} sub={`${data.tradeCount.toLocaleString('en-IN')} trades · ${data.firstDate} → ${data.lastDate}`} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
            {([['performance', 'Performance'], ['holdings', 'Holdings'], ['pnl', 'Trades & P&L'], ['dividends', 'Dividends'], ['files', 'Files & notes']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSub(k)} style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${sub === k ? C.blue : C.line}`, background: sub === k ? `${C.blue}22` : 'transparent', color: sub === k ? C.blue : C.mute, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>{l}</button>
            ))}
          </div>

          {sub === 'performance' && (
            <>
              <Card title="Portfolio value" right={<span style={{ fontSize: 11, color: C.dim }}>point at the chart for any day</span>}>
                <GrowthChart pts={data.growth} />
              </Card>
              <Card title="Trailing returns"><ReturnsTable rows={data.trailing} title="Period" /></Card>
              <Card title="Returns by fiscal year (April – March)"><ReturnsTable rows={data.byFy} title="Fiscal year" /></Card>
              <Card title="Returns by calendar year"><ReturnsTable rows={data.byYear} title="Year" /></Card>
            </>
          )}

          {sub === 'holdings' && (
            <>
              {recon && (
                <Card title={`Your portfolio vs the tradebook — invested ${inr(recon.portfolioCost)} vs cost ${inr(recon.tradebookCost)} (difference ${inr(recon.portfolioCost - recon.tradebookCost)})`}>
                  <div style={{ fontSize: 12, color: C.mute, marginBottom: 8 }}>The portfolio's invested value is quantity × entry price of what you hold there. The tradebook's cost is what you paid for the shares still held (oldest bought, oldest sold). Rows that differ:</div>
                  {recon.rows.filter((x) => x.kind !== 'same').length === 0 ? <div style={{ fontSize: 12.5, color: C.green }}>They match, holding by holding.</div> : (
                    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={thL}>Stock</th><th style={th}>Portfolio qty</th><th style={th}>Portfolio invested</th><th style={th}>Tradebook qty</th><th style={th}>Tradebook cost</th><th style={th}>Difference</th><th style={thL}>Why</th></tr></thead>
                      <tbody>{recon.rows.filter((x) => x.kind !== 'same').map((x) => (
                        <tr key={x.symbol + x.kind}><td style={tdL}><b>{x.symbol}</b></td><td style={td}>{x.portfolioQty || '—'}</td><td style={td}>{inr(x.portfolioCost)}</td><td style={td}>{x.tradebookQty || '—'}</td><td style={td}>{inr(x.tradebookCost)}</td>
                          <td style={{ ...td, fontWeight: 700, color: tone(x.portfolioCost - x.tradebookCost) }}>{inr(x.portfolioCost - x.tradebookCost)}</td><td style={{ ...tdL, whiteSpace: 'normal', color: C.mute, fontSize: 11.5 }}>{x.note}</td></tr>
                      ))}</tbody></table></div>
                  )}
                </Card>
              )}
              <Card title={`Holdings rebuilt from the trades — ${data.holdings.length}`}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thL}>Stock</th><th style={th}>Qty</th><th style={th}>Avg cost</th><th style={th}>Price</th><th style={th}>Value</th><th style={th}>P&amp;L</th><th style={th}>P&amp;L %</th><th style={th}>Weight</th><th style={th}>Held since</th><th style={th} title="Share of the position held more than 12 months (long-term)">Long-term</th></tr></thead>
                    <tbody>{data.holdings.map((h) => (
                      <tr key={h.isin}><td style={tdL}><b>{h.symbol}</b></td><td style={td}>{h.qty.toLocaleString('en-IN')}</td><td style={td}>{h.avgCost.toFixed(2)}</td><td style={td}>{h.price?.toFixed(2) ?? '—'}</td>
                        <td style={td}>{inr(h.value)}</td><td style={{ ...td, color: tone(h.pnl) }}>{inr(h.pnl)}</td><td style={{ ...td, color: tone(h.pnlPct), fontWeight: 700 }}>{pct(h.pnlPct)}</td>
                        <td style={td}>{h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : '—'}</td><td style={td}>{h.firstBuy ?? '—'}{h.daysHeld != null ? <span style={{ color: C.dim }}> · {h.daysHeld}d</span> : null}</td><td style={td}>{Math.round(h.ltcgPct * 100)}%</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </Card>
              {data.turningLongTerm.length > 0 && (
                <Card title="Lots turning long-term in the next 60 days — selling after the date is taxed as LTCG">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Stock</th><th style={th}>Qty</th><th style={th}>Bought</th><th style={th}>Long-term from</th><th style={th}>Days left</th><th style={th}>Cost</th></tr></thead>
                    <tbody>{data.turningLongTerm.map((x, i) => <tr key={i}><td style={tdL}>{x.symbol}</td><td style={td}>{x.qty}</td><td style={td}>{x.boughtOn}</td><td style={td}>{x.longTermOn}</td><td style={{ ...td, color: C.amber, fontWeight: 700 }}>{x.daysLeft}</td><td style={td}>{inr(x.cost)}</td></tr>)}</tbody></table>
                </Card>
              )}
            </>
          )}

          {sub === 'pnl' && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <Kpi label="STCG" value={inr(data.pnl.stcg)} color={tone(data.pnl.stcg)} />
                <Kpi label="LTCG" value={inr(data.pnl.ltcg)} color={tone(data.pnl.ltcg)} />
                <Kpi label="INTRADAY" value={inr(data.pnl.intraday)} color={tone(data.pnl.intraday)} />
                <Kpi label="WIN RATE" value={data.pnl.winRate != null ? `${(data.pnl.winRate * 100).toFixed(0)}%` : '—'} sub={`${data.pnl.wins} won · ${data.pnl.losses} lost of ${data.pnl.trades}`} />
                <Kpi label="PROFIT FACTOR" value={data.pnl.profitFactor != null ? data.pnl.profitFactor.toFixed(2) : '—'} sub="gross wins ÷ gross losses" />
                <Kpi label="MEDIAN HOLD" value={data.pnl.medianHoldDays != null ? `${Math.round(data.pnl.medianHoldDays)} days` : '—'} sub={`avg win ${inr(data.pnl.avgWin)} · avg loss ${inr(data.pnl.avgLoss)}`} />
              </div>
              <Card title="Realised P&L by fiscal year">
                <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thL}>Fiscal year</th><th style={th}>STCG</th><th style={th}>LTCG</th><th style={th}>Intraday</th><th style={th}>Total</th><th style={th}>Trades</th><th style={th}>Win rate</th><th style={th}>Profit factor</th><th style={th}>Median hold</th></tr></thead>
                  <tbody>{data.pnlByFy.map((f) => <tr key={f.fy}><td style={tdL}><b>{f.fy}</b></td><td style={{ ...td, color: tone(f.stcg) }}>{inr(f.stcg)}</td><td style={{ ...td, color: tone(f.ltcg) }}>{inr(f.ltcg)}</td><td style={{ ...td, color: tone(f.intraday) }}>{inr(f.intraday)}</td><td style={{ ...td, color: tone(f.total), fontWeight: 800 }}>{inr(f.total)}</td><td style={td}>{f.trades}</td><td style={td}>{f.winRate != null ? `${(f.winRate * 100).toFixed(0)}%` : '—'}</td><td style={td}>{f.profitFactor?.toFixed(2) ?? '—'}</td><td style={td}>{f.medianHoldDays != null ? `${Math.round(f.medianHoldDays)}d` : '—'}</td></tr>)}</tbody>
                </table></div>
              </Card>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
                {([['Best trades', data.pnl.best], ['Worst trades', data.pnl.worst]] as const).map(([t, list]) => (
                  <Card key={t} title={t}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Stock</th><th style={th}>Sold</th><th style={th}>Type</th><th style={th}>P&amp;L</th><th style={th}>%</th></tr></thead>
                    <tbody>{list.map((x, i) => <tr key={i}><td style={tdL}>{x.symbol}</td><td style={td}>{x.date}</td><td style={td}>{x.kind}</td><td style={{ ...td, color: tone(x.pnl), fontWeight: 700 }}>{inr(x.pnl)}</td><td style={{ ...td, color: tone(x.pct) }}>{pct(x.pct)}</td></tr>)}</tbody></table></Card>
                ))}
              </div>
              <Card title="Realised P&L by stock (all years)">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
                  {[data.bySymbol.slice(0, 15), data.bySymbol.slice(-15).reverse()].map((list, k) => (
                    <table key={k} style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>{k ? 'Biggest losses' : 'Biggest gains'}</th><th style={th}>Realised</th><th style={th}>Sells</th></tr></thead>
                      <tbody>{list.filter((x) => (k ? x.realized < 0 : x.realized > 0)).map((x) => <tr key={x.symbol}><td style={tdL}>{x.symbol}</td><td style={{ ...td, color: tone(x.realized), fontWeight: 700 }}>{inr(x.realized)}</td><td style={td}>{x.trades}</td></tr>)}</tbody></table>
                  ))}
                </div>
              </Card>
            </>
          )}

          {sub === 'dividends' && (
            <>
              <Card title="Dividends by fiscal year (estimated)" right={<span style={{ fontSize: 11, color: C.dim }}>shares held before each ex-date × dividend per share</span>}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Fiscal year</th><th style={th}>Dividends</th><th style={th}>Payments</th></tr></thead>
                  <tbody>{data.dividends.byFy.map((d) => <tr key={d.fy}><td style={tdL}><b>{d.fy}</b></td><td style={{ ...td, color: C.green, fontWeight: 700 }}>{inr(d.amount)}</td><td style={td}>{d.payments}</td></tr>)}</tbody></table>
              </Card>
              <Card title="Every dividend">
                <div style={{ maxHeight: 420, overflowY: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Stock</th><th style={th}>Ex-date</th><th style={th}>Shares</th><th style={th}>Per share</th><th style={th}>Amount</th></tr></thead>
                  <tbody>{data.dividends.items.map((d, i) => <tr key={i}><td style={tdL}>{d.symbol}</td><td style={td}>{d.exDate}</td><td style={td}>{d.qty}</td><td style={td}>₹{d.perShare.toFixed(2)}</td><td style={td}>{inr(d.amount)}</td></tr>)}</tbody></table></div>
              </Card>
            </>
          )}

          {sub === 'files' && (
            <>
              <Card title="Notes on these numbers"><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.mute }}>{data.notes.map((n, i) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}</ul>
                {data.unmatched.symbols.length > 0 && <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>Sold without an earlier buy in the files: {data.unmatched.symbols.join(', ')}</div>}
              </Card>
              <Card title={`Uploaded files — ${files.length}`} right={<button onClick={async () => { if (!window.confirm('Forget every uploaded trade? Your portfolio is not changed.')) return; await fetch('/api/v1/tradebook?confirm=1', { method: 'DELETE' }); setData(null); setFiles([]); }} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.red}`, color: C.red, background: 'transparent', cursor: 'pointer' }}>Forget all trades</button>}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>File</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Trades</th><th style={th}>New</th><th style={th}>Uploaded</th></tr></thead>
                  <tbody>{files.map((f) => <tr key={f.hash}><td style={tdL}>{f.name}</td><td style={td}>{f.from}</td><td style={td}>{f.to}</td><td style={td}>{f.rows}</td><td style={td}>{f.added}</td><td style={td}>{f.at.slice(0, 10)}</td></tr>)}</tbody></table>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
