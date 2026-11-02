'use client';
// ═══════════════════════════════════════════════════════════════════════════
// COMPANY LAB (zzz1208). Add one company or several (India or USA) and see, side by side:
//   • the FCF quality checklist (growth, margin, yield, cash vs profit, capex, debt, operating leverage, steadiness, share pay)
//   • revenue / EPS growth, FCF margin and FCF per share against the share price, year by year
//   • Stage 2 (weekly Stage Analysis), RS and Minervini's trend template rule by rule, and a volume breakout check
//   • the portal's own reads of the company: latest graded result, active guidance — with one-click links to the chart,
//     earnings, guidance, conviction and decision pages, and add-to-watchlist.
// The owner's old Python scripts (FCF checklist, growth vs price, Stage2.py), done from the portal's own data (lib/company-lab).
// ═══════════════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import NavLink from '@/components/NavLink';
import { R, tint } from '@/components/special-situations/radar-tokens';
import { WatchlistButton } from '@/app/(dashboard)/news/components';
import type { LabCard } from '@/lib/company-lab/server';

type Mkt = 'IN' | 'US';
const LIST_KEY = 'mc:company-lab:v1';
const parseEntry = (s: string, fallback: Mkt): { m: Mkt; t: string } | null => {
  const x = s.trim().toUpperCase();
  if (!x) return null;
  const m = /^(US|NASDAQ|NYSE|AMEX):/.test(x) ? 'US' : /^(IN|NSE|BSE):/.test(x) ? 'IN' : fallback;
  const t = x.replace(/^(US|IN|NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '').replace(/[^A-Z0-9&.\-]/g, '');
  return t ? { m, t } : null;
};
const key = (e: { m: Mkt; t: string }) => `${e.m}:${e.t}`;
const capText = (c: LabCard) => (c.cap == null ? 'size n/a' : c.market === 'IN' ? `₹${Math.round(c.cap).toLocaleString('en-IN')} Cr` : c.cap >= 1000 ? `$${(c.cap / 1000).toFixed(1)}B` : `$${Math.round(c.cap)}M`);
const num = (v: number | null | undefined, d = 1) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d }));
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const STATE = { pass: { c: R.green, m: '✓' }, fail: { c: R.red, m: '✗' }, unknown: { c: R.faint, m: '?' } } as const;
const STAGE_WORD: Record<number, string> = { 1: 'Stage 1 · base', 2: 'Stage 2 · uptrend', 3: 'Stage 3 · topping', 4: 'Stage 4 · downtrend' };
const STAGE_C: Record<number, string> = { 1: R.amber, 2: R.green, 3: R.amber, 4: R.red };
const HEALTH = ['weakening', 'losing momentum', 'healthy'];

const chip = (text: string, c: string, title?: string) => (
  <span title={title} style={{ fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 999, border: `1px solid ${tint(c, 55)}`, background: tint(c, 10), color: c, whiteSpace: 'nowrap' }}>{text}</span>
);
const label = (t: string) => <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '0.5px', color: R.faint, margin: '2px 0 6px' }}>{t}</div>;

// ── zzz1210: one chart per script, each with its own colours (the old single chart made every view look the same) ──────
// x axis = time (shared by price and yearly figures); left axis = price (or the first group), right axis = the yearly figures.
// Yearly figures are drawn as dots at each fiscal year end joined by a line — the way the scripts plotted them — and every
// fiscal year with figures is inside the window (prices are read 10 years back).
type Pt = { t: string; v: number | null };
type Ser = { name: string; color: string; pts: Pt[]; axis: 'L' | 'R'; dots?: boolean; dash?: string; width?: number };
const PRICE_C = '#475569';
function LabChart({ title, note, series, unitL = '', unitR = '', logL = false, h = 230, zeroR = true, clipR }: { title: string; note?: string; series: Ser[]; unitL?: string; unitR?: string; logL?: boolean; h?: number; zeroR?: boolean; clipR?: number }) {
  const W = 680, H = h, P = { l: 54, r: 54, t: 12, b: 26 };
  const all = series.flatMap((s) => s.pts.filter((p) => p.v != null && Number.isFinite(p.v)));
  if (all.length < 2) return <div style={{ fontSize: 13, color: R.faint, padding: '6px 0' }}><b style={{ color: R.dim }}>{title}</b> — not enough figures to draw.</div>;
  const ts = all.map((p) => Date.parse(p.t));
  const t0 = Math.min(...ts) - 30 * 86_400_000, t1 = Math.max(...ts) + 30 * 86_400_000;
  const x = (d: string) => P.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const range = (axis: 'L' | 'R', log: boolean) => {
    const vs = series.filter((s) => s.axis === axis).flatMap((s) => s.pts.map((p) => p.v)).filter((v): v is number => v != null && Number.isFinite(v) && (!log || v > 0));
    if (!vs.length) return null;
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (!log && axis === 'R' && zeroR) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (axis === 'R' && clipR != null) { lo = Math.max(lo, -clipR); hi = Math.min(hi, clipR); }   // zzz1211: one wild year no longer flattens the rest
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = log ? 1.05 : (hi - lo) * 0.06;
    return log ? { lo: lo / pad, hi: hi * pad } : { lo: lo - pad, hi: hi + pad };
  };
  const rL = range('L', logL), rR = range('R', false);
  const yOf = (axis: 'L' | 'R') => (v: number) => {
    const r = axis === 'L' ? rL : rR; if (!r) return 0;
    const vv = Math.max(r.lo, Math.min(r.hi, v));
    const f = axis === 'L' && logL ? (Math.log(vv) - Math.log(r.lo)) / (Math.log(r.hi) - Math.log(r.lo)) : (vv - r.lo) / (r.hi - r.lo);
    return P.t + (1 - f) * (H - P.t - P.b);
  };
  const line = (s: Ser) => {
    const y = yOf(s.axis); let d = '', pen = false;
    for (const p of s.pts) { if (p.v == null || !Number.isFinite(p.v) || (s.axis === 'L' && logL && p.v <= 0)) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)} `; pen = true; }
    return d;
  };
  const years: number[] = [];
  for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) years.push(yr);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
  const ticks = (r: { lo: number; hi: number } | null, log: boolean) => (!r ? [] : [0, 0.5, 1].map((f) => (log ? Math.exp(Math.log(r.lo) + f * (Math.log(r.hi) - Math.log(r.lo))) : r.lo + f * (r.hi - r.lo))));
  const cL = series.find((s) => s.axis === 'L')?.color || PRICE_C, cR = series.find((s) => s.axis === 'R')?.color || R.dim;
  return (
    <div data-lab-chart={title}>
      <div style={{ fontSize: 13.5, fontWeight: 900, margin: '4px 0 2px' }}>{title}</div>
      {note && <div style={{ fontSize: 12, color: R.faint, marginBottom: 4 }}>{note}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: R.bg, border: `1px solid ${R.border}`, borderRadius: 8 }} role="img" aria-label={title}>
        {years.map((yr) => { const xx = x(`${yr}-01-01`); return <g key={yr}><line x1={xx} x2={xx} y1={P.t} y2={H - P.b} stroke="var(--mc-bg-4)" strokeWidth={0.6} /><text x={xx + 2} y={H - 9} fontSize={10} fill="var(--mc-text-3)">{yr}</text></g>; })}
        {rR && rR.lo < 0 && rR.hi > 0 && <line x1={P.l} x2={W - P.r} y1={yOf('R')(0)} y2={yOf('R')(0)} stroke={cR} strokeOpacity={0.45} strokeDasharray="4 3" />}
        {series.map((s) => <path key={s.name} d={line(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? (s.dots ? 2.2 : 1.6)} strokeDasharray={s.dash} />)}
        {series.filter((s) => s.dots).map((s) => s.pts.filter((p) => p.v != null && Number.isFinite(p.v)).map((p) => (
          <g key={`${s.name}-${p.t}`}>
            <circle cx={x(p.t)} cy={yOf(s.axis)(p.v!)} r={3.6} fill={s.color} stroke="#fff" strokeWidth={1}><title>{`${s.name} ${p.t.slice(0, 7)}: ${fmt(p.v!)}${s.axis === 'R' ? unitR : unitL}`}</title></circle>
            {s.axis === 'R' && clipR != null && Math.abs(p.v!) > clipR && <text x={x(p.t) + 5} y={yOf('R')(p.v!) + (p.v! > 0 ? 10 : -4)} fontSize={9.5} fontWeight={800} fill={s.color}>{p.v! > 0 ? '↑' : '↓'}{fmt(p.v!)}{unitR}</text>}
          </g>
        )))}
        {ticks(rL, logL).map((v, i) => <text key={`l${i}`} x={4} y={yOf('L')(v) + 3} fontSize={10} fill={cL}>{fmt(v)}{unitL}</text>)}
        {ticks(rR, false).map((v, i) => <text key={`r${i}`} x={W - P.r + 4} y={yOf('R')(v) + 3} fontSize={10} fill={cR}>{fmt(v)}{unitR}</text>)}
      </svg>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: R.dim, marginTop: 3 }}>
        {series.map((s) => <span key={s.name}><b style={{ color: s.color }}>{s.dots ? '●' : '━'}</b> {s.name} ({s.axis === 'L' ? 'left' : 'right'})</span>)}
      </div>
    </div>
  );
}
const pricePts = (c: LabCard): Pt[] => c.prices.map((p) => ({ t: p.t, v: p.c }));
const yearPts = (c: LabCard, f: (y: LabCard['years'][number]) => number | null): Pt[] => c.years.map((y) => ({ t: y.end, v: f(y) }));

// ── zzz1211: yearly bars for the checklist plots (owner: "can't really understand the charts"). One bar per year per
// series with its value printed on it, a zero line, a scale set by the ordinary values (a −2,689% year no longer
// squashes every other year: it is drawn to the edge with its real value written), and one plain sentence on top.
type BarSer = { name: string; color: string; unit: string; vals: Array<number | null> };
const fmtV = (v: number, unit: string) => `${v > 0 && unit === '%' ? '+' : ''}${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}${unit}`;
function YearBars({ title, take, labels, series, h = 210, signed = true }: { title: string; take?: string; labels: string[]; series: BarSer[]; h?: number; signed?: boolean }) {
  const known = series.flatMap((x) => x.vals).filter((v): v is number => v != null && Number.isFinite(v));
  if (known.length < 2) return <div style={{ fontSize: 13, color: R.faint, padding: '6px 0' }}><b style={{ color: R.dim }}>{title}</b> — not enough yearly figures to draw.</div>;
  const W = 640, H = h, P = { l: 44, r: 10, t: 22, b: 26 };
  // scale: the middle 80% of values decides it, so one wild year cannot flatten the rest
  const sorted = known.slice().sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))];
  let hi = Math.max(q(0.9), 0), lo = signed ? Math.min(q(0.1), 0) : 0;
  if (sorted.length <= 4) { hi = Math.max(sorted[sorted.length - 1], 0); lo = signed ? Math.min(sorted[0], 0) : 0; }
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.12; hi += pad; if (lo < 0) lo -= pad;
  const y = (v: number) => P.t + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - P.t - P.b);
  const n = labels.length, gw = (W - P.l - P.r) / Math.max(1, n), bw = Math.min(26, (gw - 8) / series.length);
  return (
    <div data-lab-bars={title}>
      <div style={{ fontSize: 13.5, fontWeight: 900, margin: '4px 0 2px' }}>{title}</div>
      {take && <div style={{ fontSize: 13, color: R.dim, marginBottom: 4 }}>{take}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: R.bg, border: `1px solid ${R.border}`, borderRadius: 8 }} role="img" aria-label={title}>
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--mc-text-3)" strokeWidth={1} />
        <text x={4} y={y(0) + 3} fontSize={10} fill="var(--mc-text-3)">0</text>
        {labels.map((lab, i) => {
          const gx = P.l + i * gw + (gw - bw * series.length) / 2;
          return (
            <g key={lab}>
              <text x={P.l + i * gw + gw / 2} y={H - 8} fontSize={10.5} textAnchor="middle" fill="var(--mc-text-2)">{lab.replace(/^FY/, "FY'").replace(/^(FY')20/, '$1').replace(/^([A-Z][a-z]{2}) 20(\d\d)$/, "$1 '$2")}</text>
              {series.map((sr, k) => {
                const v = sr.vals[i];
                if (v == null || !Number.isFinite(v)) return <text key={sr.name} x={gx + k * bw + bw / 2} y={y(0) - 3} fontSize={9} textAnchor="middle" fill="var(--mc-text-3)">–</text>;
                const top = y(Math.max(v, 0)), bot = y(Math.min(v, 0)), clipped = v > hi || v < lo;
                return (
                  <g key={sr.name}>
                    <rect x={gx + k * bw + 1} y={top} width={bw - 2} height={Math.max(1, bot - top)} fill={sr.color} opacity={v < 0 ? 0.55 : 0.9} rx={2}>
                      <title>{`${sr.name} ${lab}: ${fmtV(v, sr.unit)}`}</title>
                    </rect>
                    <text x={gx + k * bw + bw / 2} y={v >= 0 ? top - 3 : bot + 10} fontSize={9.5} fontWeight={clipped ? 900 : 600} textAnchor="middle" fill={sr.color}>{clipped ? (v > 0 ? '↑' : '↓') : ''}{fmtV(v, sr.unit)}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: R.dim, marginTop: 3 }}>
        {series.map((sr) => <span key={sr.name}><b style={{ color: sr.color }}>■</b> {sr.name}</span>)}
        {known.some((v) => v > hi || v < lo) && <span style={{ color: R.faint }}>↑↓ = bar cut at the edge, real value written</span>}
      </div>
    </div>
  );
}
// plain-English one-liners
const cntYears = (xs: Array<number | null>, f: (v: number) => boolean) => xs.filter((v): v is number => v != null && f(v)).length;
const knownN = (xs: Array<number | null>) => xs.filter((v) => v != null).length;
function takeFcfVsRev(y: LabCard['years']): string {
  const both = y.filter((p) => p.fcfG != null && p.revG != null);
  if (both.length < 2) return 'Growth in free cash flow against growth in sales, year by year.';
  const faster = both.filter((p) => p.fcfG! > p.revG!).length;
  return `Free cash flow grew faster than sales in ${faster} of ${both.length} years${faster * 2 > both.length ? ' — operating leverage.' : faster === 0 ? ' — the cash is not keeping up with sales.' : '.'}`;
}
function takeMargin(y: LabCard['years']): string {
  const m = y.map((p) => p.fcfM), pos = cntYears(m, (v) => v > 0), last = [...y].reverse().find((p) => p.fcfM != null);
  if (!last) return 'Free cash flow as a share of sales, and against the market value at each year end.';
  return `Free cash flow was positive in ${pos} of ${knownN(m)} years; latest ${last.label}: ${fmtV(last.fcfM!, '%')} of sales${last.fcfYield != null ? `, ${fmtV(last.fcfYield, '%')} of market value` : ''}. Above 10% of sales and above 5% of value are good.`;
}
function takeCapexDebt(y: LabCard['years'], india: boolean): string {
  const last = [...y].reverse().find((p) => p.debtToFcf != null || p.capexToFcf != null);
  const d = last?.debtToFcf, c = last?.capexToFcf;
  const parts = [c != null ? `capex took ${c.toFixed(0)}% of free cash flow (under 50% is good)` : india ? null : null,
    d != null ? `debt equals ${d.toFixed(1)} years of free cash flow (under 3 is good)` : null].filter(Boolean);
  return parts.length ? `${last!.label}: ${parts.join('; ')}.${india ? ' India: no capex line on screener.in, so only debt is shown.' : ''}` : 'Shown only in years when free cash flow was positive.';
}

function Card({ c, onRemove }: { c: LabCard; onRemove: () => void }) {
  const [open, setOpen] = useState<'fcf' | 'growth' | 'stage' | 'years'>('fcf');
  if (!c.ok) {
    return (
      <div style={{ border: `1px solid ${tint(R.red, 40)}`, borderRadius: 10, padding: 12, background: R.bg }}>
        <b>{c.ticker}</b> <span style={{ color: R.faint }}>({c.market === 'US' ? 'USA' : 'India'})</span> — <span style={{ color: R.red }}>{c.error || 'not found'}</span>
        <button type="button" onClick={onRemove} style={{ marginLeft: 8, border: 'none', background: 'none', color: R.faint, cursor: 'pointer' }}>✕ remove</button>
      </div>
    );
  }
  const st = c.stage.st;
  // the stock screener's count first (same as the Pine / stock screeners), else this page's recount of the daily series
  const tt = c.stage.tt ?? c.trend.filter((r) => r.ok).length;
  const ttKnown = c.stage.tt != null ? 6 : c.trend.filter((r) => r.ok != null).length;
  const sym = c.ticker;
  const links: Array<[string, string]> = [
    ['📈 Chart', `/charts?m=${c.market}&t=${encodeURIComponent(sym)}`],
    ['📅 Earnings', c.market === 'US' ? `/us-earnings-opportunities?q=${encodeURIComponent(sym)}` : `/earnings-opportunities?q=${encodeURIComponent(sym)}`],
    ['📈 Guidance', `/guidance-upgrades?q=${encodeURIComponent(sym)}`],
    ['🏆 Conviction', c.market === 'US' ? `/us-conviction-beats?q=${encodeURIComponent(sym)}` : `/watchlists?tab=conviction&q=${encodeURIComponent(sym)}`],
    ['📒 Decisions', '/decisions'],
  ];
  return (
    <div data-lab-card style={{ border: `1px solid ${R.border}`, borderRadius: 12, padding: 14, background: R.bg, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 19, fontWeight: 900 }}>{sym}</span>
        <span style={{ color: R.dim, fontSize: 14 }}>{c.name || ''}</span>
        <span style={{ color: R.faint, fontSize: 13 }}>{c.market === 'US' ? '🇺🇸' : '🇮🇳'} · {capText(c)}{c.price != null ? ` · ${c.currency}${num(c.price, 2)}` : ''}{c.industry ? ` · ${c.industry}` : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <WatchlistButton ticker={c.market === 'US' ? sym : sym} />
          <button type="button" onClick={onRemove} title="Remove from the lab" style={{ border: `1px solid ${R.border}`, background: 'transparent', color: R.faint, borderRadius: 6, cursor: 'pointer', padding: '2px 8px' }}>✕</button>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chip(`💵 FCF checks ${c.fcf.passed}/${c.fcf.known}`, c.fcf.known >= 4 && c.fcf.passed >= Math.ceil(c.fcf.known * 0.75) ? R.green : c.fcf.passed >= Math.ceil(c.fcf.known / 2) ? R.amber : R.red, 'Free-cash-flow quality checklist: checks passed of those that could be worked out')}
        {st != null && chip(`${STAGE_WORD[st]}${c.stage.weeks != null ? ` · ${c.stage.weeks} wk` : ''}${st === 2 && c.stage.health != null ? ` · ${HEALTH[c.stage.health]}` : ''}`, STAGE_C[st], 'Weekly Stage Analysis (completed weeks only)')}
        {ttKnown > 0 && chip(`Trend template ${tt}/6`, tt === 6 ? R.green : tt >= 4 ? R.amber : R.red, "Minervini's six rules on the daily chart")}
        {c.stage.rsR != null && chip(`RS ${c.stage.rsR}`, c.stage.rsR >= 80 ? R.green : c.stage.rsR >= 50 ? R.amber : R.red, 'RS Rating 1–99 against every company in the same market')}
        {c.breakout.ok && chip('Breakout on volume today', R.green, c.breakout.value)}
        {c.rs?.ratio != null && chip(`vs ${c.rs.index} ${c.rs.ratio.toFixed(2)}×`, c.rs.ratio > 1 ? R.green : R.red, `Stage2.py relative strength: stock return ÷ index return over the last year (${c.rs.stockRet}% vs ${c.rs.idxRet}%). Above 1 = beating the index.`)}
        {c.verdict?.all === true && chip('Meets all Stage 2 criteria', R.green, c.verdict.text)}
        {c.record?.tier && chip(`Last result ${c.record.tier}${c.record.resultDate ? ` · ${c.record.resultDate}` : ''}`, /BLOCKBUSTER|STRONG/.test(c.record.tier) ? R.green : /AVOID/.test(c.record.tier) ? R.red : R.amber, 'Latest graded result on the bench')}
        {c.record && c.record.guidance > 0 && chip(`Guidance on file ${c.record.guidance}`, R.cyan, 'Active company guidance in the guidance universe')}
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.5 }}>{c.summary}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
        {links.map(([t, h]) => <NavLink key={t} href={h} style={{ color: R.cyan, fontWeight: 700 }}>{t}</NavLink>)}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {([['fcf', '💵 FCF checklist'], ['growth', '📊 Price charts'], ['stage', '🧭 Stage 2 & trend'], ['years', '🗂 Yearly figures']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setOpen(k)} style={{ fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${open === k ? R.cyan : R.border}`, background: open === k ? tint(R.cyan, 12) : 'transparent', color: open === k ? R.cyan : R.dim }}>{l}</button>
        ))}
      </div>
      {open === 'fcf' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {label(`FREE CASH FLOW PICTURE · FCF = ${c.fcf.fcfBasis}`)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
            <YearBars title="FCF growth vs sales growth" take={takeFcfVsRev(c.years)} labels={c.years.map((p) => p.label)} series={[
              { name: 'FCF growth', color: '#16A34A', unit: '%', vals: c.years.map((p) => p.fcfG) },
              { name: 'Sales growth', color: '#2563EB', unit: '%', vals: c.years.map((p) => p.revG) },
            ]} />
            <YearBars title="FCF margin and FCF yield" take={takeMargin(c.years)} labels={c.years.map((p) => p.label)} series={[
              { name: 'FCF ÷ sales', color: '#EA580C', unit: '%', vals: c.years.map((p) => p.fcfM) },
              { name: 'FCF ÷ market value (year-end price)', color: '#7C3AED', unit: '%', vals: c.years.map((p) => p.fcfYield) },
            ]} />
            {c.years.some((p) => p.capexToFcf != null || p.debtToFcf != null) ? (
              <YearBars title={c.market === 'IN' ? 'Debt ÷ FCF (years to repay)' : 'Capex ÷ FCF and debt ÷ FCF'} take={takeCapexDebt(c.years, c.market === 'IN')} signed={false} labels={c.years.map((p) => p.label)} series={[
                ...(c.market === 'IN' ? [] : [{ name: 'Capex ÷ FCF', color: '#DC2626', unit: '%', vals: c.years.map((p) => p.capexToFcf) }]),
                { name: 'Debt ÷ FCF', color: '#0891B2', unit: '×', vals: c.years.map((p) => p.debtToFcf) },
              ]} />
            ) : <div style={{ fontSize: 13, color: R.faint }}><b style={{ color: R.dim }}>Capex ÷ FCF and debt ÷ FCF</b> — shown only in years with positive free cash flow; none here.</div>}
            {c.years.some((p) => p.sbcPct != null)
              ? <YearBars title="Share-based pay % of sales" take="Stock given to staff is a real cost the cash-flow statement adds back. Under 10% of sales is fine." signed={false} labels={c.years.map((p) => p.label)} series={[{ name: 'Share pay ÷ sales', color: '#DB2777', unit: '%', vals: c.years.map((p) => p.sbcPct) }]} />
              : <div style={{ fontSize: 13, color: R.faint }}><b style={{ color: R.dim }}>Share-based pay</b> — {c.market === 'IN' ? 'not reported on screener.in.' : 'not reported by the company.'}</div>}
          </div>
          {label(`CHECKLIST · ${c.fcf.passed} of ${c.fcf.known} checks passed`)}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <tbody>
              {c.fcf.checks.map((k) => (
                <tr key={k.id} style={{ borderTop: `1px solid ${R.border}` }} title={k.why}>
                  <td style={{ padding: '5px 6px', width: 24, color: STATE[k.state].c, fontWeight: 900 }}>{STATE[k.state].m}</td>
                  <td style={{ padding: '5px 6px' }}>{k.label}<div style={{ fontSize: 12, color: R.faint }}>{k.why}</div></td>
                  <td style={{ padding: '5px 6px', color: R.dim }}>{k.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: R.dim }}>
            {c.fcf.metrics.map((m) => <span key={m.label}>{m.label}: <b style={{ color: R.text }}>{m.value}</b></span>)}
          </div>
          <div style={{ fontSize: 12, color: R.faint }}>✓ passed · ✗ failed · ? could not be worked out (never counted as a fail).</div>
        </div>
      )}
      {open === 'growth' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 13, color: R.dim }}>How to read: the grey line is the share price (left scale). The coloured dots are one figure per financial year, placed at the year end (right scale). When the dots rise and the price does not, the business is running ahead of the share; when the price runs far ahead of the dots, the market is paying for future years. Growth above +150% or below −150% is drawn at the edge with its real value written.</div>
          <LabChart title="Share price vs revenue growth" clipR={150} note="FCF_and_Revenue_growth — revenue growth each fiscal year (dots at the year end)" unitR="%" series={[
            { name: `Price (${c.currency})`, color: PRICE_C, axis: 'L', pts: pricePts(c) },
            { name: 'Revenue growth', color: '#2563EB', axis: 'R', dots: true, pts: yearPts(c, (y) => y.revG) },
          ]} />
          <LabChart title="Share price vs revenue and EPS growth" clipR={150} note="EPS_and_Revenue_growth — year-on-year change of revenue and of EPS" unitR="%" series={[
            { name: `Price (${c.currency})`, color: PRICE_C, axis: 'L', pts: pricePts(c) },
            { name: 'Revenue growth', color: '#059669', axis: 'R', dots: true, pts: yearPts(c, (y) => y.revG) },
            { name: 'EPS growth', color: '#9333EA', axis: 'R', dots: true, dash: '5 3', pts: yearPts(c, (y) => y.epsG) },
          ]} />
          <LabChart title="Share price vs revenue growth and FCF margin" clipR={150} note="FCF_Margins_and_Revenue_growth" unitR="%" series={[
            { name: `Price (${c.currency})`, color: PRICE_C, axis: 'L', pts: pricePts(c) },
            { name: 'Revenue growth', color: '#0D9488', axis: 'R', dots: true, pts: yearPts(c, (y) => y.revG) },
            { name: 'FCF margin', color: '#EA580C', axis: 'R', dots: true, dash: '5 3', pts: yearPts(c, (y) => y.fcfM) },
          ]} />
          <LabChart title={`Share price vs free cash flow per share (${c.currency})`} note={`FCF.py — FCF ÷ shares each fiscal year; FCF = ${c.fcf.fcfBasis}`} unitR="" series={[
            { name: `Price (${c.currency})`, color: PRICE_C, axis: 'L', pts: pricePts(c) },
            { name: 'FCF per share', color: '#16A34A', axis: 'R', dots: true, width: 2.6, pts: yearPts(c, (y) => y.fcfPs) },
          ]} />
        </div>
      )}
      {open === 'stage' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {label(`STAGE 2 (WEEKLY STAGE ANALYSIS) · MINERVINI TREND TEMPLATE${c.stage.tt != null ? ` (screener count ${c.stage.tt}/6; rule detail below from the 5-year daily series, which can differ by a session)` : ''} · BREAKOUT`)}
          <div style={{ fontSize: 14 }}>
            {st == null ? 'No weekly stage on file yet.' : <>Weekly stage: <b style={{ color: STAGE_C[st] }}>{STAGE_WORD[st]}</b>{c.stage.weeks != null ? ` for ${c.stage.weeks} weeks` : ''}{st === 2 && c.stage.health != null ? ` — ${HEALTH[c.stage.health]}` : ''}.</>}
            {c.stage.mrs != null && <> Mansfield RS vs {c.market === 'US' ? 'S&P 500' : 'Nifty 50'}: <b>{num(c.stage.mrs, 1)}</b> ({c.stage.mrs > 0 ? 'beating' : 'lagging'} the index).</>}
          </div>
          {c.verdict?.text && <div style={{ fontSize: 14, fontWeight: 800, color: c.verdict.all ? R.green : c.verdict.trendAndRs ? R.amber : R.dim }}>{c.verdict.all ? '✓ ' : ''}{c.verdict.text}</div>}
          <div style={{ fontSize: 13.5 }}>
            Relative strength vs {c.rs?.index}: {c.rs?.ratio == null ? 'index history not available' : <><b style={{ color: c.rs.ratio > 1 ? R.green : R.red }}>{c.rs.ratio.toFixed(2)}×</b> (stock {pct(c.rs.stockRet)} vs index {pct(c.rs.idxRet)} since {c.rs.from}) — {c.rs.ratio > 1 ? 'beating' : 'trailing'} the index.</>}
          </div>
          <LabChart title="Price with 50 / 150 / 200-day averages (2 years)" unitL="" series={[
            { name: `Price (${c.currency})`, color: '#0F172A', axis: 'L', pts: (c.ma || []).map((p) => ({ t: p.t, v: p.c })), width: 1.8 },
            { name: '50-day', color: '#2563EB', axis: 'L', pts: (c.ma || []).map((p) => ({ t: p.t, v: p.m50 })) },
            { name: '150-day', color: '#F59E0B', axis: 'L', pts: (c.ma || []).map((p) => ({ t: p.t, v: p.m150 })) },
            { name: '200-day', color: '#DC2626', axis: 'L', pts: (c.ma || []).map((p) => ({ t: p.t, v: p.m200 })) },
          ]} />
          <LabChart title={`Relative strength vs ${c.rs?.index || 'the index'} (last year)`} note="Stock's cumulative return ÷ the index's. Above 1 (dashed line) = beating the index." unitR="×" h={180} zeroR={false} series={[
            { name: 'RS ratio', color: '#16A34A', axis: 'R', pts: (c.rs?.line || []).map((p) => ({ t: p.t, v: p.v })), width: 2 },
            { name: 'Index = 1', color: R.faint, axis: 'R', dash: '4 3', pts: (c.rs?.line || []).length ? [{ t: c.rs.line[0].t, v: 1 }, { t: c.rs.line[c.rs.line.length - 1].t, v: 1 }] : [] },
          ]} />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <tbody>
              {c.trend.map((r) => (
                <tr key={r.label} style={{ borderTop: `1px solid ${R.border}` }}>
                  <td style={{ padding: '5px 6px', width: 24, fontWeight: 900, color: r.ok == null ? R.faint : r.ok ? R.green : R.red }}>{r.ok == null ? '?' : r.ok ? '✓' : '✗'}</td>
                  <td style={{ padding: '5px 6px' }}>{r.label}</td>
                  <td style={{ padding: '5px 6px', color: R.dim }}>{r.value}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${R.border}` }}>
                <td style={{ padding: '5px 6px', fontWeight: 900, color: c.breakout.ok == null ? R.faint : c.breakout.ok ? R.green : R.faint }}>{c.breakout.ok ? '✓' : c.breakout.ok == null ? '?' : '–'}</td>
                <td style={{ padding: '5px 6px' }}>Breakout today (close above the 20-session high on 1.5× volume)</td>
                <td style={{ padding: '5px 6px', color: R.dim }}>{c.breakout.value}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {open === 'years' && (
        <div style={{ overflowX: 'auto' }}>
          {label(`YEARLY FIGURES (${c.unit}; EPS in ${c.currency})`)}
          <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
            <thead><tr>{['Year', 'Revenue', 'Growth', 'Net income', 'EPS', 'EPS growth', 'Op. cash', 'FCF', 'FCF margin', 'FCF / share', 'FCF yield', 'Debt'].map((h) => <th key={h} style={{ textAlign: 'right', padding: '4px 8px', color: R.faint, fontSize: 12 }}>{h}</th>)}</tr></thead>
            <tbody>
              {c.years.map((y, i) => (
                <tr key={y.end} style={{ borderTop: `1px solid ${R.border}` }}>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 800 }}>{y.label}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{num(y.revenue, 0)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{pct(y.revG)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{num(y.netIncome, 0)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{num(y.eps, 2)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{pct(y.epsG)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{num(c.rows[i]?.cfo, 0)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{num(y.fcf, 0)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{pct(y.fcfM)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{num(y.fcfPs, 2)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{pct(y.fcfYield)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{num(c.rows[i]?.debt, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: R.faint }}>Sources: {c.sources.join(' · ')}. Built {new Date(c.builtAt).toLocaleString()}. Research, not advice.</div>
    </div>
  );
}

// Multiple_FCF: each company's price and FCF per share, one panel each, on one screen; log scale optional.
function MultiFcf({ cards }: { cards: LabCard[] }) {
  const [log, setLog] = useState(false);
  const ok = cards.filter((c) => c.ok && c.prices.length > 1);
  if (ok.length < 2) return null;
  return (
    <div style={{ border: `1px solid ${R.border}`, borderRadius: 10, padding: 10, background: R.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {label('PRICE AND FREE CASH FLOW PER SHARE — EVERY COMPANY')}
        <label style={{ fontSize: 13, color: R.dim, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale for price
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12 }}>
        {ok.map((c) => (
          <LabChart key={`${c.market}:${c.ticker}`} title={`${c.ticker}${c.name ? ` · ${c.name}` : ''}`} h={190} logL={log} series={[
            { name: `Price (${c.currency})`, color: PRICE_C, axis: 'L', pts: pricePts(c) },
            { name: 'FCF per share', color: '#16A34A', axis: 'R', dots: true, width: 2.4, pts: yearPts(c, (y) => y.fcfPs) },
          ]} />
        ))}
      </div>
    </div>
  );
}

function Compare({ cards }: { cards: LabCard[] }) {
  const [sortI, setSortI] = useState(0);
  const ok = cards.filter((c) => c.ok);
  if (ok.length < 2) return null;
  const last = (c: LabCard) => c.years[c.years.length - 1];
  const yieldOf = (c: LabCard) => { const y = last(c); return y?.fcf != null && c.cap ? (y.fcf / c.cap) * 100 : null; };
  const cols: Array<[string, (c: LabCard) => React.ReactNode, (c: LabCard) => number]> = [
    ['FCF checks', (c) => `${c.fcf.passed}/${c.fcf.known}`, (c) => (c.fcf.known ? c.fcf.passed / c.fcf.known : -1)],
    ['FCF margin', (c) => pct(last(c)?.fcfM ?? null), (c) => last(c)?.fcfM ?? -999],
    ['FCF yield', (c) => pct(yieldOf(c)), (c) => yieldOf(c) ?? -999],
    ['Revenue growth (last yr)', (c) => pct(last(c)?.revG ?? null), (c) => last(c)?.revG ?? -999],
    ['EPS growth (last yr)', (c) => pct(last(c)?.epsG ?? null), (c) => last(c)?.epsG ?? -999],
    ['Stage', (c) => (c.stage.st != null ? `Stage ${c.stage.st}` : '—'), (c) => (c.stage.st === 2 ? 2 : c.stage.st === 1 ? 1 : 0)],
    ['Trend template', (c) => `${c.stage.tt ?? c.trend.filter((r) => r.ok).length}/6`, (c) => c.stage.tt ?? c.trend.filter((r) => r.ok).length],
    ['RS vs index', (c) => (c.rs?.ratio == null ? '—' : `${c.rs.ratio.toFixed(2)}×`), (c) => c.rs?.ratio ?? -1],
    ['RS', (c) => num(c.stage.rsR, 0), (c) => c.stage.rsR ?? -1],
  ];
  const rows = ok.slice().sort((a, b) => cols[sortI][2](b) - cols[sortI][2](a));
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${R.border}`, borderRadius: 10, background: R.bg }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead><tr style={{ background: R.bg2 }}>
          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Company</th>
          {cols.map(([h], i) => <th key={h} onClick={() => setSortI(i)} style={{ textAlign: 'right', padding: '6px 8px', cursor: 'pointer', color: i === sortI ? R.cyan : R.faint, whiteSpace: 'nowrap' }}>{h}{i === sortI ? ' ▾' : ''}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.market}:${c.ticker}`} style={{ borderTop: `1px solid ${R.border}` }}>
              <td style={{ padding: '6px 8px' }}><b>{c.ticker}</b> <span style={{ color: R.faint }}>{c.market === 'US' ? '🇺🇸' : '🇮🇳'} {capText(c)}</span></td>
              {cols.map(([h, f]) => <td key={h} style={{ textAlign: 'right', padding: '6px 8px' }}>{f(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: R.faint, padding: '4px 8px' }}>Click a column to sort. FCF yield uses today&apos;s market cap and the latest full year.</div>
    </div>
  );
}

export default function CompanyLabPage() {
  const [list, setList] = useState<Array<{ m: Mkt; t: string }>>([]);
  const [input, setInput] = useState('');
  const [mkt, setMkt] = useState<Mkt>('IN');
  const [cards, setCards] = useState<Record<string, LabCard>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let saved: Array<{ m: Mkt; t: string }> = [];
    try { const v = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); if (Array.isArray(v)) saved = v.filter((x) => x && (x.m === 'IN' || x.m === 'US') && typeof x.t === 'string'); } catch { /* fresh */ }
    // ?add=US:NVT,IN:AEROFLEX from other pages
    try {
      const add = new URLSearchParams(window.location.search).get('add');
      if (add) for (const s of add.split(',')) { const e = parseEntry(s, 'IN'); if (e && !saved.some((x) => key(x) === key(e))) saved.push(e); }
    } catch { /* no url */ }
    setList(saved);
  }, []);
  useEffect(() => { try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* not kept */ } }, [list]);

  const load = useCallback(async (entries: Array<{ m: Mkt; t: string }>) => {
    const need = entries.filter((e) => !cards[key(e)]);
    if (!need.length) return;
    setBusy(true); setErr(null);
    try {
      for (const m of ['IN', 'US'] as Mkt[]) {
        const ts = need.filter((e) => e.m === m).map((e) => e.t);
        for (let i = 0; i < ts.length; i += 8) {
          const r = await fetch(`/api/v1/company-lab?market=${m}&tickers=${encodeURIComponent(ts.slice(i, i + 8).join(','))}`).catch(() => null);
          const j: any = r ? await r.json().catch(() => null) : null;
          if (!j?.ok) { setErr(j?.error || `Could not load (HTTP ${r?.status ?? '—'})`); continue; }
          const got = j.cards as LabCard[];
          setCards((prev) => { const n = { ...prev }; for (const c of got) { n[`${m}:${c.ticker}`] = c; n[`${c.market}:${c.ticker}`] = c; } return n; });
          // typed under the wrong market (SPOT with India selected): keep it under the market it was found in
          const moved = got.filter((c) => c.ok && c.market !== m);
          if (moved.length) setList((l) => { const out: Array<{ m: Mkt; t: string }> = []; for (const e of l) { const mv = moved.find((c) => c.ticker === e.t && e.m === m); const ne = mv ? { m: mv.market as Mkt, t: e.t } : e; if (!out.some((x) => key(x) === key(ne))) out.push(ne); } return out; });
        }
      }
    } finally { setBusy(false); }
  }, [cards]);
  useEffect(() => { if (list.length) void load(list); }, [list]);   // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const parts = input.split(/[,\n;]+/).map((s) => parseEntry(s, mkt)).filter((x): x is { m: Mkt; t: string } => !!x);
    if (!parts.length) return;
    setList((l) => { const next = l.slice(); for (const p of parts) if (!next.some((x) => key(x) === key(p))) next.push(p); return next; });
    setInput('');
  };
  const remove = (e: { m: Mkt; t: string }) => setList((l) => l.filter((x) => key(x) !== key(e)));
  const shown = useMemo(() => list.map((e) => cards[key(e)]).filter(Boolean) as LabCard[], [list, cards]);

  return (
    <div style={{ padding: '16px 18px', display: 'grid', gap: 12, maxWidth: 1200 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>🧪 Company Lab</h1>
        <div style={{ fontSize: 14, color: R.dim, marginTop: 4 }}>Add one company or several — India or USA. Each gets the FCF checklist with its four plots, price charts against revenue / EPS growth, FCF margin and FCF per share, Stage 2 (trend template, relative strength vs the index, breakout), and links to everything else the portal knows about it. A ticker typed under the wrong market is found in the other one.</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', border: `1px solid ${R.border}`, borderRadius: 10, padding: 10, background: R.bg }}>
        {(['IN', 'US'] as Mkt[]).map((m) => (
          <button key={m} type="button" onClick={() => setMkt(m)} style={{ fontSize: 13, fontWeight: 800, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${mkt === m ? R.cyan : R.border}`, background: mkt === m ? tint(R.cyan, 12) : 'transparent', color: mkt === m ? R.cyan : R.dim }}>{m === 'IN' ? '🇮🇳 India' : '🇺🇸 USA'}</button>
        ))}
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder={mkt === 'IN' ? 'e.g. AEROFLEX, ACUTAAS, UNIMECH  (US:NVT works too)' : 'e.g. NVT, VICR, KLIC  (NSE:TARIL works too)'}
          aria-label="Companies to add" style={{ flex: '1 1 280px', fontSize: 14, padding: '7px 10px', borderRadius: 8, border: `1px solid ${R.border}`, background: 'transparent', color: R.text }} />
        <button type="button" onClick={add} disabled={!input.trim()} style={{ fontSize: 14, fontWeight: 900, padding: '7px 16px', borderRadius: 8, cursor: input.trim() ? 'pointer' : 'not-allowed', border: `1px solid ${R.green}`, background: tint(R.green, 12), color: R.green }}>＋ Add</button>
        {list.length > 0 && <button type="button" onClick={() => setList([])} style={{ fontSize: 12.5, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.border}`, background: 'transparent', color: R.faint }}>Clear all</button>}
        {busy && <span style={{ fontSize: 13, color: R.faint }}>Reading figures… (first look at a company takes up to half a minute)</span>}
      </div>
      {err && <div style={{ color: R.red, fontSize: 13 }}>{err}</div>}
      {list.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {list.map((e) => <span key={key(e)} style={{ fontSize: 12.5, padding: '2px 8px', borderRadius: 999, border: `1px solid ${R.border}`, color: cards[key(e)] ? R.text : R.faint }}>{e.m === 'US' ? '🇺🇸' : '🇮🇳'} {e.t}{!cards[key(e)] ? ' …' : ''} <button type="button" onClick={() => remove(e)} style={{ border: 'none', background: 'none', color: R.faint, cursor: 'pointer' }}>✕</button></span>)}
        </div>
      )}
      {!list.length && <div style={{ fontSize: 14, color: R.faint, padding: 20, border: `1px dashed ${R.border}`, borderRadius: 10 }}>No companies yet. Type one or several tickers above and press Add. Your list is kept on this browser.</div>}
      {shown.length >= 2 && <Fragment>{label('SIDE BY SIDE')}<Compare cards={shown} /><MultiFcf cards={shown} /></Fragment>}
      <div style={{ display: 'grid', gap: 12 }}>
        {shown.map((c) => <Card key={`${c.market}:${c.ticker}`} c={c} onRemove={() => remove({ m: c.market, t: c.ticker })} />)}
      </div>
    </div>
  );
}
