'use client';
// zzz1291 — Company Lab side-by-side table: column groups the owner can switch on and off (kept in this browser),
// Rule of 40, growth acceleration, margins, dilution, cash conversion, debt ÷ equity and the cash-squeeze score,
// plus the per-company squeeze panel and the one-button book loader.
import { useEffect, useMemo, useState } from 'react';
import { R, tint } from '@/components/special-situations/radar-tokens';
import type { LabCard } from '@/lib/company-lab/server';
import { fcfPriceGap, type QuarterReport } from '@/lib/company-lab/quarterly';
import { labScore, type LabScore } from '@/lib/company-lab/score';
import { labSignals, reinvestment, evFcf, impliedGrowth, type Signal } from '@/lib/company-lab/signals';
import { rejectState, type LabMark } from './marks';

const COLS_KEY = 'mc:company-lab:cols:v1';
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const capText = (c: LabCard) => (c.cap == null ? 'size n/a' : c.market === 'IN' ? `₹${Math.round(c.cap).toLocaleString('en-IN')} Cr` : c.cap >= 1000 ? `$${(c.cap / 1000).toFixed(1)}B` : `$${Math.round(c.cap)}M`);
const LEVEL_C: Record<string, string> = { Low: R.green, Watch: R.amber, High: R.red, Unknown: R.faint };
const ACC: Record<string, { t: string; c: string }> = { accelerating: { t: '▲ speeding up', c: R.green }, decelerating: { t: '▼ slowing', c: R.red }, steady: { t: '● steady', c: R.dim }, uneven: { t: '≈ uneven', c: R.amber }, unknown: { t: '—', c: R.faint } };
const GRADE_C: Record<string, string> = { A: R.green, B: R.cyan, C: R.amber, D: R.red, '—': R.faint };
/** zzz1293 — EPS growth said plainly when it crosses zero or comes off a tiny base */
export function epsGrowthOf(c: LabCard): { v: number | null; text: string; swing: 'loss-to-profit' | 'profit-to-loss' | null } {
  const ys = c.years.filter((y) => y.eps != null);
  const L = ys[ys.length - 1], P = ys[ys.length - 2];
  if (!L || !P) return { v: null, text: '—', swing: null };
  if (P.eps! > 0 && L.eps! <= 0) return { v: null, text: 'profit → loss', swing: 'profit-to-loss' };
  if (P.eps! <= 0 && L.eps! > 0) return { v: null, text: 'loss → profit', swing: 'loss-to-profit' };
  if (P.eps! <= 0 && L.eps! <= 0) return { v: null, text: L.eps! > P.eps! ? 'loss narrowed' : 'loss widened', swing: null };
  const v = L.epsG;
  if (v != null && v > 300) return { v, text: 'low base', swing: null };
  return { v, text: v == null ? '—' : pct(v), swing: null };
}
const scoreMemo = new WeakMap<LabCard, LabScore>();
/** zzz1293 — the one overall score (lib/company-lab/score.ts) from what the card already holds */
// zzz1297 — red-flag / positive combinations and the derived figures (reinvestment, EV/FCF, market-implied growth)
const sigMemo = new WeakMap<LabCard, Signal[]>();
export function signalsOf(c: LabCard): Signal[] {
  const hit = sigMemo.get(c); if (hit) return hit;
  const q = c.quarter, y = c.years[c.years.length - 1], e = epsGrowthOf(c);
  const s = labSignals({
    fcf: y?.fcf ?? null, cfoPat: q?.cfoPat.latest ?? null, squeeze: q?.squeeze.level ?? null,
    epsG: e.text === 'low base' ? 100 : e.v, epsSwing: e.swing ?? null, dilution: q?.dilution.pct ?? null,
    accel: q?.accel.state ?? null, gmChg: q?.gm.now != null && q.gm.yearAgo != null ? q.gm.now - q.gm.yearAgo : null, omChg: q?.om.now != null && q.om.yearAgo != null ? q.om.now - q.om.yearAgo : null,
    r40: q?.r40.lowBase ? null : q?.r40.value ?? null, rs: c.stage.rsR, de: q?.de.value ?? null,
  });
  sigMemo.set(c, s); return s;
}
export const redOf = (c: LabCard) => signalsOf(c).filter((x) => x.kind === 'red');
export const goodOf = (c: LabCard) => signalsOf(c).filter((x) => x.kind === 'good');
const derMemo = new WeakMap<LabCard, { inc: ReturnType<typeof reinvestment>; ev: ReturnType<typeof evFcf>; imp: ReturnType<typeof impliedGrowth> }>();
export function derivedOf(c: LabCard) {
  const hit = derMemo.get(c); if (hit) return hit;
  const L = c.rows[c.rows.length - 1], y = c.years[c.years.length - 1];
  const ev = evFcf(c.cap, L?.debt ?? null, c.quarter?.squeeze.cashNow ?? null, y?.fcf ?? null);
  const d = { inc: reinvestment(c.rows), ev, imp: impliedGrowth(ev.ev, y?.fcf ?? null, c.market === 'US' ? 'US' : 'IN') };
  derMemo.set(c, d); return d;
}
export function scoreOf(c: LabCard): LabScore {
  const hit = scoreMemo.get(c); if (hit) return hit;
  const q = c.quarter, y = c.years[c.years.length - 1], e = epsGrowthOf(c);
  const s = labScore({
    revQ: q?.r40.revFrom === 'quarter' ? q.r40.revYoY : null, revQLowBase: !!q?.r40.lowBase, accel: q?.accel.state === 'unknown' ? null : q?.accel.state ?? null,
    epsG: e.text === 'low base' ? 100 : e.v, epsSwing: e.swing, revY: y?.revG ?? null, r40: q?.r40.value ?? null,
    om: q?.om.now ?? null, omChg: q?.om.now != null && q.om.yearAgo != null ? q.om.now - q.om.yearAgo : null, gmChg: q?.gm.now != null && q.gm.yearAgo != null ? q.gm.now - q.gm.yearAgo : null,
    fcfPassed: c.fcf.passed, fcfKnown: c.fcf.known, fcfM: y?.fcfM ?? null, cfoPat: q?.cfoPat.latest ?? null, de: q?.de.value ?? null,
    squeeze: q?.squeeze.level ?? null, squeezeCombo: !!q?.squeeze.keyCombo, dilution: q?.dilution.pct ?? null,
    stage: c.stage.st, tt: c.stage.tt ?? (c.trend.length ? c.trend.filter((r) => r.ok).length : null), rs: c.stage.rsR,
    rsRatio: c.rs?.ratio ?? null, stageFlag: c.extras?.stageCheck.flag ?? null, promChg: c.extras?.promChg ?? null,
    roce: c.extras?.roce ?? null, roceFY: c.extras?.roceFY ?? null, rocePrev: c.extras?.rocePrev ?? null, roe: c.extras?.roe ?? null,
    pe: c.extras?.pe ?? null, peg: c.extras?.peg ?? null, ext50: c.extras?.ext50 ?? null,
    incRet: derivedOf(c).inc.pct, impliedG: derivedOf(c).imp.g, growthNow: y?.revG ?? null, redFlags: redOf(c).map((r) => r.label),
  });
  scoreMemo.set(c, s); return s;
}
export function ScoreBadge({ c, big }: { c: LabCard; big?: boolean }) {
  const s = scoreOf(c);
  const tip = [`Overall ${s.score ?? '—'} (${s.grade})`, ...s.pillars.map((p) => `${p.label} ${p.score ?? '—'} (weight ${p.weight}): ${p.why.join(', ') || 'no figures'}`), ...s.caps].join('\n');
  return <span title={tip} style={{ fontWeight: 900, fontSize: big ? 15 : 13.5, color: GRADE_C[s.grade], whiteSpace: 'nowrap' }}>{s.score ?? '—'} <span style={{ fontSize: big ? 12.5 : 11.5, padding: '0 5px', borderRadius: 5, border: `1px solid ${GRADE_C[s.grade]}` }}>{s.grade}</span>{s.caps.length ? <span style={{ color: R.faint, fontWeight: 400 }}> ⓘ</span> : null}</span>;
}
const TR: Record<string, string> = { up: '▲', down: '▼', flat: '●', unknown: '' };

type Col = { id: string; group: string; h: string; tip: string; cell: (c: LabCard) => React.ReactNode; sort: (c: LabCard) => number };
const Q = (c: LabCard): QuarterReport | undefined => c.quarter;
const X = (c: LabCard) => c.extras;
const last = (c: LabCard) => c.years[c.years.length - 1];
const yieldOf = (c: LabCard) => { const y = last(c); return y?.fcf != null && c.cap ? (y.fcf / c.cap) * 100 : null; };
const gapOf = (c: LabCard) => fcfPriceGap(c.years, c.price);
const col = (v: number | null | undefined, good: (x: number) => boolean, bad: (x: number) => boolean) => (v == null ? R.faint : good(v) ? R.green : bad(v) ? R.red : R.text);

export const COLS: Col[] = [
  { id: 'score', group: 'Overall', h: 'Overall score', tip: 'One balanced score 0–100: growth 30, price strength 20, margin momentum 10, safety (cash, debt, squeeze, dilution, promoter selling) 20, capital efficiency (ROCE) 10, valuation & entry (PEG, distance from the 50-day line) 10. Weak growth caps it at 60, weak safety at 65, a Stage 4 chart at 55, a Stage 2 broken this week at 65. Hover a score for its parts.', cell: (c) => <ScoreBadge c={c} />, sort: (c) => scoreOf(c).score ?? -1 },
  { id: 'signals', group: 'Overall', h: 'Flags', tip: 'Red-flag and positive COMBINATIONS (one weak figure is noise, these together are not). ⚑ red = reject unless the reason is proven away; ✓ green = move on to business and valuation work. Hover for the figures and what to do.', cell: (c) => { const all = signalsOf(c); if (!all.length) return <span style={{ color: R.faint }}>—</span>; return <span style={{ display: 'inline-flex', gap: 4 }}>{all.map((x) => <span key={x.id} title={`${x.label}: ${x.why}\n→ ${x.response}`} style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 6px', borderRadius: 5, color: x.kind === 'red' ? R.red : R.green, border: `1px solid ${x.kind === 'red' ? R.red : R.green}` }}>{x.kind === 'red' ? '⚑' : '✓'} {x.label}</span>)}</span>; }, sort: (c) => goodOf(c).length - 3 * redOf(c).length },
  { id: 'fcfChecks', group: 'Free cash flow', h: 'FCF checks', tip: 'FCF checklist items passed ÷ items that could be checked', cell: (c) => `${c.fcf.passed}/${c.fcf.known}`, sort: (c) => (c.fcf.known ? c.fcf.passed / c.fcf.known : -1) },
  { id: 'fcfM', group: 'Free cash flow', h: 'FCF margin', tip: 'Latest full year: FCF ÷ revenue', cell: (c) => <span style={{ color: col(last(c)?.fcfM, (x) => x >= 10, (x) => x < 0) }}>{pct(last(c)?.fcfM)}</span>, sort: (c) => last(c)?.fcfM ?? -999 },
  { id: 'fcfY', group: 'Free cash flow', h: 'FCF yield', tip: "Latest full year FCF ÷ today's market cap", cell: (c) => pct(yieldOf(c)), sort: (c) => yieldOf(c) ?? -999 },
  { id: 'r40', group: 'Growth', h: 'Rule of 40', tip: "Latest quarter's revenue growth vs the same quarter a year earlier + FCF margin (last 4 quarters, else latest year). 40+ passes.", cell: (c) => { const r = Q(c)?.r40; return r?.value == null ? '—' : <span title={`${pct(r.revYoY)} revenue (${r.quarter}) + ${pct(r.fcfMargin)} FCF margin (${r.fcfFrom})${r.lowBase ? '\n⚠ the revenue growth comes off a weak or tiny year-earlier quarter — do not read it at face value' : ''}`} style={{ fontWeight: 800, color: r.lowBase ? R.amber : r.value >= 40 ? R.green : r.value >= 20 ? R.amber : R.red }}>{r.lowBase ? '⚠ ' : ''}{r.value.toFixed(0)} <span style={{ fontWeight: 400, color: R.faint, fontSize: 12 }}>= {r.revYoY?.toFixed(0)} {(r.fcfMargin ?? 0) < 0 ? '−' : '+'} {Math.abs(r.fcfMargin ?? 0).toFixed(0)}</span></span>; }, sort: (c) => Q(c)?.r40.value ?? -999 },
  { id: 'revQ', group: 'Growth', h: 'Revenue YoY (qtr)', tip: 'Latest quarter vs the same quarter a year earlier', cell: (c) => pct(Q(c)?.r40.revYoY), sort: (c) => Q(c)?.r40.revYoY ?? -999 },
  { id: 'accel', group: 'Growth', h: 'Growth trend (last 4 qtrs)', tip: 'Year-on-year revenue growth of the last four quarters, oldest → newest', cell: (c) => { const a = Q(c)?.accel; if (!a) return '—'; const s = ACC[a.state]; return <span title={a.text}><span style={{ color: s.c, fontWeight: 800 }}>{s.t}</span> <span style={{ color: R.faint, fontSize: 12 }}>{a.last.map((v) => (v == null ? '·' : v.toFixed(0))).join(' → ')}</span></span>; }, sort: (c) => { const a = Q(c)?.accel; return a?.state === 'accelerating' ? 2 : a?.state === 'steady' ? 1 : a?.state === 'decelerating' ? 0 : -1; } },
  { id: 'revG', group: 'Growth', h: 'Revenue growth (yr)', tip: 'Latest full year vs the year before', cell: (c) => pct(last(c)?.revG), sort: (c) => last(c)?.revG ?? -999 },
  { id: 'epsG', group: 'Growth', h: 'EPS growth (yr)', tip: 'Latest full year vs the year before. A move across zero is said in words (loss → profit), and growth over 300% as “low base”.', cell: (c) => { const e = epsGrowthOf(c); return <span title={e.v != null ? pct(e.v) : ''} style={{ color: e.swing === 'profit-to-loss' ? R.red : e.swing === 'loss-to-profit' ? R.green : e.v == null ? R.faint : e.v >= 25 ? R.green : e.v < 0 ? R.red : R.text, fontSize: e.v == null || e.text === 'low base' ? 12 : undefined }}>{e.text}</span>; }, sort: (c) => { const e = epsGrowthOf(c); return e.swing === 'loss-to-profit' ? 500 : e.swing === 'profit-to-loss' ? -500 : e.v ?? -999; } },
  { id: 'gm', group: 'Margins', h: 'Gross margin', tip: 'Latest quarter, and the move vs the same quarter a year earlier', cell: (c) => { const g = Q(c)?.gm; return g?.now == null ? '—' : <span title={g.label}>{g.now.toFixed(1)}% <span style={{ color: g.trend === 'up' ? R.green : g.trend === 'down' ? R.red : R.faint }}>{TR[g.trend]}{g.yearAgo != null ? ` ${(g.now - g.yearAgo) > 0 ? '+' : ''}${(g.now - g.yearAgo).toFixed(1)}` : ''}</span></span>; }, sort: (c) => Q(c)?.gm.now ?? -999 },
  { id: 'om', group: 'Margins', h: 'Operating margin', tip: 'Latest quarter, and the move vs the same quarter a year earlier', cell: (c) => { const g = Q(c)?.om; return g?.now == null ? '—' : <span title={g.label}>{g.now.toFixed(1)}% <span style={{ color: g.trend === 'up' ? R.green : g.trend === 'down' ? R.red : R.faint }}>{TR[g.trend]}{g.yearAgo != null ? ` ${(g.now - g.yearAgo) > 0 ? '+' : ''}${(g.now - g.yearAgo).toFixed(1)}` : ''}</span></span>; }, sort: (c) => Q(c)?.om.now ?? -999 },
  { id: 'dil', group: 'Quality', h: 'Dilution (3 yr)', tip: 'Change in share count over up to three years (positive = more shares)', cell: (c) => { const d = Q(c)?.dilution; return d?.pct == null ? '—' : <span title={d.text} style={{ color: d.pct >= 10 ? R.red : d.pct >= 4 ? R.amber : d.pct <= -3 ? R.green : R.text }}>{pct(d.pct)}</span>; }, sort: (c) => -(Q(c)?.dilution.pct ?? 999) },
  { id: 'cfoPat', group: 'Quality', h: 'CFO / PAT', tip: 'Operating cash ÷ net profit, latest year (3-year in the tooltip). Above 1 = profit backed by cash.', cell: (c) => { const x = Q(c)?.cfoPat; return x?.latest == null ? <span style={{ color: R.faint }} title={x?.text}>—</span> : <span title={x.text} style={{ color: col(x.latest, (v) => v >= 0.9, (v) => v < 0.6) }}>{x.latest.toFixed(2)}×</span>; }, sort: (c) => Q(c)?.cfoPat.latest ?? -999 },
  { id: 'cfoTrend', group: 'Quality', h: 'CFO / PAT trend (yrs)', tip: 'Operating cash ÷ profit each full year, oldest → newest (· = loss year). Improving / worsening = the last two years vs the years before (±0.2×). Sorts by the latest year.', cell: (c) => { const x = Q(c)?.cfoPat; if (!x?.series?.length) return '—'; const t = x.trend ?? 'unknown'; const tc = t === 'improving' ? R.green : t === 'worsening' ? R.red : t === 'steady' ? R.text : R.faint; return <span title={x.series.map((p) => `${p.l}: ${p.v == null ? 'loss' : `${p.v}×`}`).join('\n')}><span style={{ color: tc, fontWeight: 800 }}>{t === 'improving' ? '▲ improving' : t === 'worsening' ? '▼ worsening' : t === 'steady' ? '● steady' : '—'}</span> <span style={{ color: R.faint, fontSize: 12 }}>{x.series.map((p) => (p.v == null ? '·' : p.v.toFixed(1))).join(' → ')}</span></span>; }, sort: (c) => Q(c)?.cfoPat.latest ?? -999 },
  { id: 'de', group: 'Quality', h: 'Debt ÷ equity', tip: 'Total debt ÷ shareholders’ equity, latest year end', cell: (c) => { const x = Q(c)?.de; return x?.value == null ? <span style={{ color: R.faint }} title={x?.text}>—</span> : <span title={x.text} style={{ color: col(x.value, (v) => v <= 0.5, (v) => v > 1.5) }}>{x.value.toFixed(2)}×</span>; }, sort: (c) => -(Q(c)?.de.value ?? 99) },
  { id: 'squeeze', group: 'Cash squeeze', h: 'Cash squeeze', tip: 'Six checks: cash, capex, operating cash, FCF, debt, receivables vs revenue. 3+ warnings = look closer.', cell: (c) => { const s = Q(c)?.squeeze; if (!s) return '—'; return <span title={s.items.filter((i) => i.state === 'warn').map((i) => `⚠ ${i.label}: ${i.value}`).join('\n') || 'no warnings'} style={{ color: LEVEL_C[s.level], fontWeight: 800 }}>{s.level}{s.level !== 'Unknown' ? ` ${s.warns}/${s.known}` : ''}{s.keyCombo ? ' ⚡' : ''}</span>; }, sort: (c) => { const s = Q(c)?.squeeze; return s && s.level !== 'Unknown' ? -s.warns : -99; } },
  { id: 'capexOcf', group: 'Cash squeeze', h: 'Capex ÷ OCF', tip: 'Capital spending ÷ operating cash (last 4 quarters; India: whole investing outflow)', cell: (c) => { const v = Q(c)?.squeeze.ratios.capexToOcf; return v == null ? '—' : <span style={{ color: col(v, (x) => x <= 50, (x) => x > 100) }}>{v.toFixed(0)}%</span>; }, sort: (c) => -(Q(c)?.squeeze.ratios.capexToOcf ?? 999) },
  { id: 'runway', group: 'Cash squeeze', h: 'Cash runway', tip: 'Quarters of cash left at the current free-cash burn (only when FCF is negative)', cell: (c) => { const v = Q(c)?.squeeze.ratios.runwayQ; return v == null ? <span style={{ color: R.faint }}>no burn</span> : <span style={{ color: v < 6 ? R.red : v < 12 ? R.amber : R.text }}>{v.toFixed(1)} qtrs</span>; }, sort: (c) => Q(c)?.squeeze.ratios.runwayQ ?? 999 },
  { id: 'stage', group: 'Technicals', h: 'Stage', tip: 'Weekly Stage Analysis', cell: (c) => (c.stage.st != null ? <span title={c.extras?.stageCheck.text ?? ''} style={{ color: c.extras?.stageCheck.flag === 'broken' ? R.red : c.extras?.stageCheck.flag === 'lagging' ? R.amber : undefined }}>Stage {c.stage.st}{c.extras?.stageCheck.flag === 'broken' ? ' ✕ broken' : c.extras?.stageCheck.flag === 'lagging' ? ' · lagging' : ''}</span> : <span title="Weekly Stage Analysis needs about 30 completed weeks of prices" style={{ color: R.faint, fontSize: 12 }}>{c.listedDays != null && c.listedDays < 400 ? 'new listing' : 'no weekly data'}</span>), sort: (c) => (c.stage.st === 2 ? 2 : c.stage.st === 1 ? 1 : 0) },
  { id: 'tt', group: 'Technicals', h: 'Trend template', tip: 'Minervini trend template rules met', cell: (c) => `${c.stage.tt ?? c.trend.filter((r) => r.ok).length}/6`, sort: (c) => c.stage.tt ?? c.trend.filter((r) => r.ok).length },
  { id: 'rsIdx', group: 'Technicals', h: 'RS vs index', tip: 'Stock return ÷ index return', cell: (c) => (c.rs?.ratio == null ? '—' : `${c.rs.ratio.toFixed(2)}×`), sort: (c) => c.rs?.ratio ?? -1 },
  { id: 'rs', group: 'Technicals', h: 'RS', tip: 'RS rating 1–99', cell: (c) => (c.stage.rsR == null ? <span title="Not enough price history for an RS rating" style={{ color: R.faint, fontSize: 12 }}>{c.listedDays != null && c.listedDays < 400 ? 'new listing' : '—'}</span> : String(Math.round(c.stage.rsR))), sort: (c) => c.stage.rsR ?? -1 },
  // zzz1295 — valuation, capital efficiency, entry, catalysts, ownership
  { id: 'pe', group: 'Valuation', h: 'P/E', tip: 'Trailing price ÷ earnings (stock screener). No forward P/E: we keep no analyst estimates.', cell: (c) => { const v = X(c)?.pe; return v == null ? <span style={{ color: R.faint }} title="loss-making or not known">—</span> : <span style={{ color: v > 80 ? R.red : v > 45 ? R.amber : R.text }}>{v.toFixed(0)}</span>; }, sort: (c) => -(X(c)?.pe ?? 9999) },
  { id: 'peg', group: 'Valuation', h: 'PEG', tip: 'P/E ÷ EPS growth (trailing 12 months, else 3-year). Under 1 = cheap for its growth, over 2.5 = priced for perfection.', cell: (c) => { const x = X(c); return x?.peg == null ? <span style={{ color: R.faint }}>—</span> : <span title={x.pegFrom ?? ''} style={{ fontWeight: 800, color: x.peg <= 1 ? R.green : x.peg <= 2 ? R.text : x.peg <= 3 ? R.amber : R.red }}>{x.peg.toFixed(2)}</span>; }, sort: (c) => -(X(c)?.peg ?? 99) },
  { id: 'evFcf', group: 'Valuation', h: 'EV / FCF', tip: 'Enterprise value (market cap + debt − cash) ÷ latest full-year free cash flow. Blank when FCF is negative.', cell: (c) => { const v = derivedOf(c).ev.multiple; return v == null ? <span style={{ color: R.faint }}>—</span> : <span style={{ color: v <= 20 ? R.green : v > 60 ? R.red : R.text }}>{v.toFixed(0)}×</span>; }, sort: (c) => -(derivedOf(c).ev.multiple ?? 9999) },
  { id: 'implied', group: 'Valuation', h: 'Growth priced in', tip: 'Reverse DCF: the yearly FCF growth for 10 years that today’s enterprise value pays for (USA 10% discount, 3% after; India 12%, 5%). Compare with the growth the company is actually showing — priced-in growth well below it leaves room.', cell: (c) => { const d = derivedOf(c).imp; const now = last(c)?.revG; if (d.g == null) return <span style={{ color: R.faint }} title={d.text}>—</span>; const gap = now != null ? now - d.g : null; return <span title={`${d.text}${now != null ? `\nrevenue growth now ${now}%` : ''}`} style={{ color: gap == null ? R.text : gap >= 10 ? R.green : gap <= -10 ? R.red : R.text }}>{d.g >= 150 ? '>150' : d.g}%{now != null ? <span style={{ color: R.faint, fontSize: 12 }}> vs {Math.round(now)}% now</span> : null}</span>; }, sort: (c) => { const d = derivedOf(c).imp.g, now = last(c)?.revG; return d == null ? -999 : now != null ? now - d : -d; } },
  { id: 'evRev', group: 'Valuation', h: 'EV / sales', tip: 'Enterprise value ÷ revenue (trailing 12 months)', cell: (c) => (X(c)?.evRev == null ? '—' : `${X(c)!.evRev!.toFixed(1)}×`), sort: (c) => -(X(c)?.evRev ?? 999) },
  { id: 'roce', group: 'Capital efficiency', h: 'ROCE', tip: 'Return on capital employed, trailing 12 months; the arrow compares the last full year with the year before', cell: (c) => { const x = X(c); if (x?.roce == null) return <span style={{ color: R.faint }}>—</span>; const d = x.roceFY != null && x.rocePrev != null ? x.roceFY - x.rocePrev : null; return <span title={x.roceFY != null && x.rocePrev != null ? `${x.rocePrev}% → ${x.roceFY}% (full years)` : ''} style={{ color: x.roce >= 20 ? R.green : x.roce < 10 ? R.red : R.text }}>{x.roce.toFixed(0)}% {d != null ? <span style={{ color: d >= 1 ? R.green : d <= -1 ? R.red : R.faint }}>{d >= 1 ? '▲' : d <= -1 ? '▼' : '●'}</span> : null}</span>; }, sort: (c) => X(c)?.roce ?? -99 },
  { id: 'roceTrend', group: 'Capital efficiency', h: 'ROCE trend', tip: 'Year before → last full year → trailing 12 months. 18%+ is the target.', cell: (c) => { const x = X(c); const pts = [x?.rocePrev, x?.roceFY, x?.roce].filter((v): v is number => v != null); if (!pts.length) return '—'; const up = pts.length > 1 ? pts[pts.length - 1] - pts[0] : 0; return <span><span style={{ color: (x?.roce ?? 0) >= 18 ? R.green : (x?.roce ?? 0) < 10 ? R.red : R.text, fontWeight: 800 }}>{pts.map((v) => v.toFixed(0)).join(' → ')}%</span> <span style={{ color: up >= 2 ? R.green : up <= -2 ? R.red : R.faint }}>{up >= 2 ? '▲' : up <= -2 ? '▼' : '●'}</span></span>; }, sort: (c) => X(c)?.roce ?? -99 },
  { id: 'incRet', group: 'Capital efficiency', h: 'Return on new capital', tip: 'Extra profit ÷ extra capital (equity + debt) over up to three years — a profit-based stand-in for incremental ROCE. 18%+ = growth that creates value.', cell: (c) => { const d = derivedOf(c).inc; return d.pct == null ? <span style={{ color: R.faint }} title={d.text}>—</span> : <span title={d.text} style={{ color: d.pct >= 18 ? R.green : d.pct < 8 ? R.red : R.text }}>{d.pct}%</span>; }, sort: (c) => derivedOf(c).inc.pct ?? -999 },
  { id: 'roe', group: 'Capital efficiency', h: 'ROE', tip: 'Return on equity', cell: (c) => (X(c)?.roe == null ? '—' : `${X(c)!.roe!.toFixed(0)}%`), sort: (c) => X(c)?.roe ?? -99 },
  { id: 'ext50', group: 'Entry', h: 'From 50-day', tip: 'Price vs its 50-day average. 0–10% above = near support; 25%+ = extended (wait for a base); below = under support.', cell: (c) => { const v = X(c)?.ext50; return v == null ? '—' : <span style={{ fontWeight: 800, color: v > 25 ? R.red : v > 12 ? R.amber : v >= -3 ? R.green : R.amber }}>{v > 0 ? '+' : ''}{v.toFixed(0)}%{v > 25 ? ' ext' : ''}</span>; }, sort: (c) => -Math.abs((X(c)?.ext50 ?? 99) - 5) },
  { id: 'ext200', group: 'Entry', h: 'From 200-day', tip: 'Price vs its 200-day average — the long-term trend line. Above = long-term uptrend; 40%+ above = stretched; below = under the long-term trend.', cell: (c) => { const v = X(c)?.ext200; return v == null ? '—' : <span style={{ fontWeight: 800, color: v < 0 ? R.red : v > 40 ? R.amber : R.green }}>{v > 0 ? '+' : ''}{v.toFixed(0)}%</span>; }, sort: (c) => X(c)?.ext200 ?? -999 },
  { id: 'fromHigh', group: 'Entry', h: 'From 52-wk high', tip: 'How far under the 52-week high (pivot area)', cell: (c) => { const v = X(c)?.fromHigh; return v == null ? '—' : <span style={{ color: v >= -10 ? R.green : v <= -30 ? R.red : R.text }}>{v.toFixed(0)}%</span>; }, sort: (c) => X(c)?.fromHigh ?? -999 },
  { id: 'nextRes', group: 'Catalysts', h: 'Next result (est.)', tip: 'Estimated as the last result date + about 3 months (companies report quarterly). Within 10 days = a binary event ahead.', cell: (c) => { const x = X(c); if (x?.daysToNext == null) return '—'; const d = x.daysToNext; return <span title={`last result ${x.lastResult} · next around ${x.nextResultEst} (estimate)`} style={{ fontWeight: d <= 10 ? 800 : 400, color: d <= 10 ? R.amber : R.text }}>{d <= 0 ? 'due now' : `~${d} days`}{d <= 10 ? ' ⚠' : ''}</span>; }, sort: (c) => -(X(c)?.daysToNext ?? 999) },
  { id: 'guideUp', group: 'Catalysts', h: 'Guidance raised', tip: 'A guidance raise on file in the last 120 days', cell: (c) => (X(c)?.guidanceUp ? <span style={{ color: R.green, fontWeight: 800 }} title={`raised ${X(c)!.guidanceUp}`}>▲ {X(c)!.guidanceUp!.slice(5)}</span> : <span style={{ color: R.faint }}>—</span>), sort: (c) => (X(c)?.guidanceUp ? 1 : 0) },
  { id: 'prom', group: 'Ownership', h: 'Promoter', tip: 'Promoter holding % and its change over the last four quarters (India; screener.in). Pledge is not in our data.', cell: (c) => { const x = X(c); if (x?.prom == null) return <span style={{ color: R.faint }} title={c.market === 'US' ? 'insider holding not in our US data' : 'not known'}>—</span>; return <span title={x.promFrom ? `${x.promFrom}` : ''}>{x.prom.toFixed(1)}%{x.promChg != null ? <span style={{ color: x.promChg <= -1 ? R.red : x.promChg >= 1 ? R.green : R.faint }}> {x.promChg > 0 ? '+' : ''}{x.promChg.toFixed(1)}</span> : null}</span>; }, sort: (c) => X(c)?.promChg ?? -99 },
  { id: 'inst', group: 'Ownership', h: 'FII + DII', tip: 'Foreign + domestic institutional holding, latest quarter (India)', cell: (c) => (X(c)?.inst == null ? '—' : `${X(c)!.inst!.toFixed(1)}%`), sort: (c) => X(c)?.inst ?? -1 },
  { id: 'gap', group: 'Research lead', h: 'FCF/share vs price (3 yr)', tip: 'FCF per share change vs share price change over up to three full years. ◆ = cash up 30%+, price flat (≤ +10%): a research lead, not a buy signal.', cell: (c) => { const g = gapOf(c); if (g.fcfPsG == null) return <span title={g.why} style={{ color: R.faint, fontSize: 12 }}>{g.short}</span>; return g.fcfPsG > 500 ? <span title={`FCF per share ${pct(g.fcfPsG)} from a tiny starting figure — not meaningful`} style={{ color: R.faint, fontSize: 12 }}>low base</span> : <span title={g.from ? `from ${g.from}` : ''} style={{ color: g.flag ? R.cyan : R.text, fontWeight: g.flag ? 800 : 400 }}>{g.flag ? '◆ ' : ''}{pct(g.fcfPsG)} / {pct(g.priceG)}</span>; }, sort: (c) => { const g = gapOf(c); return g.fcfPsG != null && g.priceG != null ? g.fcfPsG - g.priceG : -999; } },
];
const DEFAULT = ['score', 'signals', 'fcfChecks', 'fcfM', 'fcfY', 'r40', 'accel', 'gm', 'om', 'dil', 'cfoPat', 'cfoTrend', 'de', 'squeeze', 'roce', 'incRet', 'peg', 'implied', 'ext50', 'ext200', 'nextRes', 'prom', 'stage', 'rs', 'gap'];
const GROUPS = Array.from(new Set(COLS.map((c) => c.group)));

// zzz1292 — column layouts: ready-made ones + the owner's own, saved by name (synced to his account), last one used reopens
const LAYOUTS_KEY = 'mc:company-lab:layouts:v1';
type Layout = { cols: string[]; sort?: string; desc?: boolean };
const PRESETS: Record<string, Layout> = {
  'Overview': { cols: DEFAULT, sort: 'score', desc: true },
  'Cash quality': { cols: ['score', 'fcfChecks', 'fcfM', 'fcfY', 'gap', 'cfoPat', 'de', 'dil', 'squeeze', 'capexOcf', 'runway'], sort: 'fcfChecks', desc: true },
  'Growth': { cols: ['score', 'r40', 'revQ', 'accel', 'revG', 'epsG', 'gm', 'om', 'stage', 'rs'], sort: 'r40', desc: true },
  'Valuation & entry': { cols: ['score', 'signals', 'pe', 'peg', 'evRev', 'evFcf', 'implied', 'roce', 'roceTrend', 'incRet', 'roe', 'ext50', 'ext200', 'fromHigh', 'nextRes', 'guideUp', 'stage', 'rs'], sort: 'score', desc: true },
  'Technicals': { cols: ['score', 'stage', 'ext50', 'ext200', 'fromHigh', 'tt', 'rsIdx', 'rs', 'r40', 'accel'], sort: 'rs', desc: true },
  'Everything': { cols: COLS.map((c) => c.id), sort: 'score', desc: true },
};
interface LayoutStore { active: string; custom: Record<string, Layout>; scoreAdded?: boolean; /** zzz1299 — the owner's own changes to a ready-made layout */ overrides?: Record<string, Layout> }
const readLayouts = (): LayoutStore => {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUTS_KEY) || 'null');
    if (v && typeof v === 'object' && v.custom) {
      // zzz1293 — the new overall score joins every saved layout once (it can be switched off again)
      if (!v.scoreAdded) { for (const l of Object.values(v.custom) as Layout[]) if (Array.isArray(l?.cols) && !l.cols.includes('score')) l.cols = ['score', ...l.cols]; v.scoreAdded = true; try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(v)); } catch { /* not kept */ } }
      return { active: String(v.active || 'Overview'), custom: v.custom, scoreAdded: true };
    }
    const old = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');   // the single saved column set of the first version
    if (Array.isArray(old) && old.length) return { active: 'My columns', custom: { 'My columns': { cols: old } } };
  } catch { /* fresh */ }
  return { active: 'Overview', custom: {} };
};
const writeLayouts = (v: LayoutStore) => { try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify({ ...v, scoreAdded: true })); } catch { /* not kept */ } };

export function Compare({ cards, marks = {}, onMark }: { cards: LabCard[]; marks?: Record<string, { m: LabMark }>; onMark?: (key: string, m: LabMark | null) => void }) {
  const [store, setStore] = useState<LayoutStore>({ active: 'Overview', custom: {} });
  const [on, setOn] = useState<string[]>(DEFAULT);
  const [sortId, setSortId] = useState('r40');
  const [desc, setDesc] = useState(true);
  const [pick, setPick] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const apply = (name: string, st: LayoutStore) => {
    const l = st.custom[name] ?? st.overrides?.[name] ?? PRESETS[name] ?? PRESETS.Overview;
    setOn(l.cols.filter((x) => COLS.some((c) => c.id === x))); if (l.sort) setSortId(l.sort); if (l.desc != null) setDesc(l.desc);
  };
  useEffect(() => { const st = readLayouts(); setStore(st); apply(st.active, st); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (name: string) => { const st = { ...store, active: name }; setStore(st); writeLayouts(st); apply(name, st); };
  const isCustom = !!store.custom[store.active];
  const isOverridden = !isCustom && !!store.overrides?.[store.active];
  const dirty = (() => { const l = store.custom[store.active] ?? store.overrides?.[store.active] ?? PRESETS[store.active]; return !l || l.cols.join() !== on.join() || (l.sort && l.sort !== sortId) || (l.desc != null && l.desc !== desc); })();
  const saveAs = (name: string) => {
    const n = name.trim().slice(0, 40); if (!n || PRESETS[n]) return;
    const st = { ...store, active: n, custom: { ...store.custom, [n]: { cols: on, sort: sortId, desc } } }; setStore(st); writeLayouts(st); setNaming(null);
  };
  // zzz1299 — any layout can be updated in place: own layouts are overwritten, a ready-made one keeps the owner's version (reset brings the original back)
  const updateCurrent = () => {
    const l = { cols: on, sort: sortId, desc };
    const st = isCustom ? { ...store, custom: { ...store.custom, [store.active]: l } } : { ...store, overrides: { ...(store.overrides || {}), [store.active]: l } };
    setStore(st); writeLayouts(st);
  };
  const resetPreset = () => { const o = { ...(store.overrides || {}) }; delete o[store.active]; const st = { ...store, overrides: o }; setStore(st); writeLayouts(st); apply(store.active, st); };
  const remove = (name: string) => { const c = { ...store.custom }; delete c[name]; const st = { ...store, active: store.active === name ? 'Overview' : store.active, custom: c }; setStore(st); writeLayouts(st); if (store.active === name) apply('Overview', st); };
  const save = (v: string[]) => setOn(v);
  const cols = COLS.filter((c) => on.includes(c.id));
  const ok = cards.filter((c) => c.ok);
  const sc = COLS.find((c) => c.id === sortId) ?? cols[0];
  const rows = useMemo(() => ok.slice().sort((a, b) => (desc ? 1 : -1) * ((sc?.sort(b) ?? 0) - (sc?.sort(a) ?? 0))), [ok, sc, desc]);
  if (ok.length < 1) return null;
  const groupSpans = GROUPS.map((g) => ({ g, n: cols.filter((c) => c.group === g).length })).filter((x) => x.n);
  return (
    <div style={{ border: `1px solid ${R.border}`, borderRadius: 10, background: R.bg, minWidth: 0, maxWidth: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderBottom: `1px solid ${R.border}` }}>
        <b style={{ fontSize: 14 }}>Side by side · {ok.length} companies</b>
        <span style={{ fontSize: 12, color: R.faint, marginLeft: 6 }}>LAYOUT</span>
        {[...Object.keys(PRESETS), ...Object.keys(store.custom)].map((n) => (
          <span key={n} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: `1px solid ${store.active === n ? R.green : R.border}`, background: store.active === n ? tint(R.green, 12) : 'transparent' }}>
            <button type="button" onClick={() => choose(n)} title={store.custom[n] ? 'Your saved layout' : 'Ready-made layout'} style={{ fontSize: 12.5, fontWeight: 800, padding: '3px 10px', border: 'none', background: 'transparent', cursor: 'pointer', color: store.active === n ? R.green : R.dim }}>{store.custom[n] ? '★ ' : ''}{n}</button>
            {store.custom[n] ? <button type="button" title="Delete this layout" onClick={() => remove(n)} style={{ border: 'none', background: 'transparent', color: R.faint, cursor: 'pointer', paddingRight: 8 }}>✕</button> : null}
          </span>
        ))}
        {dirty
          ? <button type="button" onClick={updateCurrent} title={isCustom ? 'Save these columns and sort into this layout' : 'Save these columns and sort into this ready-made layout (Reset brings the original back)'} style={{ fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.amber}`, background: tint(R.amber, 10), color: R.amber }}>💾 Save changes to “{store.active}”</button>
          : <span style={{ fontSize: 12, color: R.faint }}>✓ “{store.active}” saved{isOverridden ? ' (your version)' : ''}</span>}
        {isOverridden ? <button type="button" onClick={resetPreset} title="Bring back the original ready-made columns" style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.border}`, background: 'transparent', color: R.dim }}>↺ Reset to original</button> : null}
        {naming == null
          ? <button type="button" onClick={() => setNaming('')} style={{ fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.green}`, background: 'transparent', color: R.green }}>＋ Save as new layout</button>
          : <span style={{ display: 'inline-flex', gap: 4 }}><input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveAs(naming); if (e.key === 'Escape') setNaming(null); }} placeholder="Layout name" style={{ fontSize: 12.5, padding: '3px 8px', borderRadius: 6, border: `1px solid ${R.border}`, background: 'transparent', color: R.text, width: 150 }} /><button type="button" onClick={() => saveAs(naming)} style={{ fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${R.green}`, background: tint(R.green, 12), color: R.green }}>Save</button><button type="button" onClick={() => setNaming(null)} style={{ fontSize: 12.5, border: 'none', background: 'transparent', color: R.faint, cursor: 'pointer' }}>Cancel</button></span>}
        <button type="button" onClick={() => setPick((p) => !p)} style={{ fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.cyan}`, background: tint(R.cyan, pick ? 14 : 6), color: R.cyan }}>⚙ Columns ({cols.length}/{COLS.length})</button>
        {pick && <button type="button" onClick={() => apply(store.active, store)} style={{ fontSize: 12.5, padding: '4px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${R.border}`, background: 'transparent', color: R.faint }}>Undo changes</button>}
      </div>
      {pick && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, padding: 10, borderBottom: `1px solid ${R.border}`, background: R.bg2 }}>
          {GROUPS.map((g) => {
            const gc = COLS.filter((c) => c.group === g), all = gc.every((c) => on.includes(c.id));
            return (
              <div key={g}>
                <label style={{ fontSize: 12.5, fontWeight: 900, color: R.dim, cursor: 'pointer', display: 'flex', gap: 6 }}><input type="checkbox" checked={all} onChange={() => save(all ? on.filter((x) => !gc.some((c) => c.id === x)) : Array.from(new Set([...on, ...gc.map((c) => c.id)])))} />{g.toUpperCase()}</label>
                {gc.map((c) => <label key={c.id} title={c.tip} style={{ fontSize: 13, display: 'flex', gap: 6, marginLeft: 14, cursor: 'pointer' }}><input type="checkbox" checked={on.includes(c.id)} onChange={() => save(on.includes(c.id) ? on.filter((x) => x !== c.id) : COLS.map((k) => k.id).filter((id) => id === c.id || on.includes(id)))} />{c.h}</label>)}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ background: R.bg2 }}>
              <th />
              {groupSpans.map(({ g, n }) => <th key={g} colSpan={n} style={{ fontSize: 11, letterSpacing: '0.5px', color: R.faint, padding: '4px 8px', borderLeft: `1px solid ${R.border}`, textAlign: 'center' }}>{g.toUpperCase()}</th>)}
            </tr>
            <tr style={{ background: R.bg2 }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', position: 'sticky', left: 0, background: R.bg2 }}>Company</th>
              {GROUPS.flatMap((g) => cols.filter((c) => c.group === g)).map((c, i, arr) => (
                <th key={c.id} title={c.tip} onClick={() => { if (sortId === c.id) setDesc((d) => !d); else { setSortId(c.id); setDesc(true); } }}
                  style={{ textAlign: 'right', padding: '6px 8px', cursor: 'pointer', color: c.id === sortId ? R.cyan : R.faint, whiteSpace: 'nowrap', borderLeft: i === 0 || arr[i - 1].group !== c.group ? `1px solid ${R.border}` : undefined }}>
                  {c.h}{c.id === sortId ? (desc ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.market}:${c.ticker}`} style={{ borderTop: `1px solid ${R.border}` }}>
                <td style={{ padding: '6px 8px', position: 'sticky', left: 0, background: R.bg, whiteSpace: 'nowrap' }}>
                  {(() => { const k = `${c.market}:${c.ticker}`, red = redOf(c), rj = rejectState(k, red.length, marks); return (
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 4 }}>
                      {onMark && (rj.rejected
                        ? <button type="button" title={rj.why === 'red-flag' ? 'Rejected by a red flag — keep it anyway (you have checked the flag away)' : 'Rejected by you — bring it back'} onClick={() => onMark(k, rj.why === 'red-flag' ? 'kept' : null)} style={{ border: `1px solid ${R.border}`, background: 'transparent', color: R.dim, borderRadius: 5, cursor: 'pointer', fontSize: 11, padding: '0 5px' }}>{rj.why === 'red-flag' ? 'keep' : '↺'}</button>
                        : <button type="button" title={rj.kept ? 'Kept despite a red flag — reject it after all' : 'Reject this company (it stays in the lab; the Exclude-rejected view hides it)'} onClick={() => onMark(k, 'rejected')} style={{ border: `1px solid ${R.border}`, background: 'transparent', color: R.faint, borderRadius: 5, cursor: 'pointer', fontSize: 11, padding: '0 5px' }}>reject</button>)}
                    </span>); })()}
                  <a href={`#lab-${c.market}-${c.ticker}`} title={redOf(c).map((x) => `⚑ ${x.label}: ${x.why}`).join('\n')} style={{ color: redOf(c).length ? R.red : R.text, textDecoration: 'none' }}><b>{redOf(c).length ? '⚑ ' : ''}{c.ticker}</b></a> <span style={{ color: R.faint, fontSize: 12 }}>{c.market === 'US' ? '🇺🇸' : '🇮🇳'} {capText(c)}</span>
                  {c.name && <div style={{ fontSize: 12, color: redOf(c).length ? R.red : R.dim, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>}
                </td>
                {GROUPS.flatMap((g) => cols.filter((k) => k.group === g)).map((k, i, arr) => <td key={k.id} style={{ textAlign: 'right', padding: '6px 8px', whiteSpace: 'nowrap', borderLeft: i === 0 || arr[i - 1].group !== k.group ? `1px solid ${R.border}` : undefined }}>{k.cell(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12.5, color: R.faint, padding: '6px 10px', lineHeight: 1.5 }}>
        Click a column to sort (again to flip). Layouts and your own saved ones are kept with your account and the last one used opens next time. Hover a heading or a value for how it is worked out. ⚡ = rising capex + worsening free cash flow + falling cash together.
        India: cash flow and balance sheet are yearly on screener.in, so its squeeze check is yearly and receivables are not known.
        <br />◆ A rising FCF/share line with a flat share price is a research lead — not an automatic undervaluation signal. The market may be anticipating weaker future economics.
      </div>
    </div>
  );
}

/** Per-company cash-squeeze + quarterly read, shown inside each company card. */
export function QuarterPanel({ c }: { c: LabCard }) {
  const q = c.quarter;
  if (!q) return null;
  const s = q.squeeze;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {[
          ['RULE OF 40', q.r40.value == null ? '—' : `${q.r40.value.toFixed(0)}`, q.r40.value == null ? 'needs quarterly revenue and FCF' : `${pct(q.r40.revYoY)} revenue (${q.r40.quarter}) + ${pct(q.r40.fcfMargin)} FCF margin (${q.r40.fcfFrom})`, q.r40.value == null ? R.faint : q.r40.value >= 40 ? R.green : q.r40.value >= 20 ? R.amber : R.red],
          ['GROWTH TREND', ACC[q.accel.state].t, q.accel.text, ACC[q.accel.state].c],
          ['GROSS MARGIN', q.gm.now == null ? '—' : `${q.gm.now.toFixed(1)}% ${TR[q.gm.trend]}`, q.gm.yearAgo == null ? q.gm.label : `${q.gm.label} vs ${q.gm.yearAgo.toFixed(1)}% a year earlier`, q.gm.trend === 'down' ? R.red : q.gm.trend === 'up' ? R.green : R.text],
          ['OPERATING MARGIN', q.om.now == null ? '—' : `${q.om.now.toFixed(1)}% ${TR[q.om.trend]}`, q.om.yearAgo == null ? q.om.label : `${q.om.label} vs ${q.om.yearAgo.toFixed(1)}% a year earlier`, q.om.trend === 'down' ? R.red : q.om.trend === 'up' ? R.green : R.text],
          ['DILUTION', q.dilution.pct == null ? '—' : pct(q.dilution.pct), q.dilution.text, q.dilution.pct == null ? R.faint : q.dilution.pct >= 10 ? R.red : q.dilution.pct <= -3 ? R.green : R.text],
          ['CFO / PAT', q.cfoPat.latest == null ? '—' : `${q.cfoPat.latest.toFixed(2)}×`, q.cfoPat.text, q.cfoPat.latest == null ? R.faint : q.cfoPat.latest >= 0.9 ? R.green : q.cfoPat.latest < 0.6 ? R.red : R.text],
          ['DEBT ÷ EQUITY', q.de.value == null ? '—' : `${q.de.value.toFixed(2)}×`, q.de.text, q.de.value == null ? R.faint : q.de.value <= 0.5 ? R.green : q.de.value > 1.5 ? R.red : R.text],
        ].map(([h, v, sub, c2]) => (
          <div key={h as string} style={{ border: `1px solid ${R.border}`, borderRadius: 8, padding: '6px 9px' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: R.faint, letterSpacing: '0.5px' }}>{h}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: c2 as string }}>{v}</div>
            <div style={{ fontSize: 12, color: R.dim, lineHeight: 1.35 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div style={{ border: `1px solid ${tint(LEVEL_C[s.level], 50)}`, borderRadius: 8, padding: '8px 10px', background: tint(LEVEL_C[s.level], 5) }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>Cash-squeeze check</b>
          <span style={{ fontWeight: 900, color: LEVEL_C[s.level] }}>{s.level === 'Unknown' ? 'Not enough data' : `${s.level} · ${s.warns} of ${s.known} warnings`}</span>
          {s.keyCombo && <span style={{ fontWeight: 900, color: R.red }}>⚡ rising capex + worsening FCF + falling cash</span>}
          <span style={{ fontSize: 12, color: R.faint }}>{s.period}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 4, marginTop: 6 }}>
          {s.items.map((i) => (
            <div key={i.id} title={i.why} style={{ fontSize: 13 }}>
              <span style={{ color: i.state === 'warn' ? R.red : i.state === 'ok' ? R.green : R.faint, fontWeight: 900 }}>{i.state === 'warn' ? '⚠' : i.state === 'ok' ? '✓' : '?'}</span> {i.label} <span style={{ color: R.dim }}>· {i.value}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: R.dim, marginTop: 6 }}>
          Capex ÷ operating cash: <b>{s.ratios.capexToOcf == null ? '—' : `${s.ratios.capexToOcf.toFixed(0)}%`}</b> · Cash runway: <b>{s.ratios.runwayQ == null ? 'no cash burn' : `${s.ratios.runwayQ.toFixed(1)} quarters`}</b> · Receivables vs revenue growth: <b>{s.ratios.recvG == null ? '—' : `${pct(s.ratios.recvG)} vs ${pct(s.ratios.revG)}`}</b>
          <span style={{ color: R.faint }}> · Rule: 3+ warnings = investigate before trusting the growth.</span>
        </div>
      </div>
    </div>
  );
}

type Entry = { m: 'IN' | 'US'; t: string; s?: 1 };
const clean = (s: string) => String(s || '').toUpperCase().trim().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|US|IN):/, '').replace(/\.(NS|BO)$/, '').replace(/-(BE|EQ|SM|ST)$/, '').replace(/[^A-Z0-9&.\-]/g, '');
type Source = { id: string; label: string; entries: Entry[]; note?: string };
const fromLs = (k: string): any => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const uniq = (es: Entry[]) => { const out: Entry[] = []; for (const e of es) if (e.t && !out.some((x) => x.m === e.m && x.t === e.t)) out.push(e); return out; };
/** zzz1292 — every list the owner keeps, with its market: holdings (India / US), the US book, the watchlist, each chart list. */
/** a saved holding with a quantity of zero (sold) is not part of the book */
const held = (h: any) => { const q = Number(h?.quantity ?? h?.qty ?? h?.shares); return !(Number.isFinite(q) && q <= 0) && !h?.sold && !h?.closed; };
function readSources(usBook: string[]): Source[] {
  const out: Source[] = [];
  const hold: any[] = Array.isArray(fromLs('mc_portfolio_holdings')) ? fromLs('mc_portfolio_holdings') : [];
  out.push({ id: 'in-book', label: '💼 India book', entries: uniq(hold.filter((h) => (h?.market ?? 'IN') !== 'US' && held(h)).map((h) => ({ m: 'IN' as const, t: clean(h?.symbol), s: 1 as const }))) });
  out.push({ id: 'us-book', label: '💼 US book', entries: uniq([...hold.filter((h) => h?.market === 'US' && held(h)).map((h) => clean(h?.symbol)), ...usBook].map((t) => ({ m: 'US' as const, t, s: 1 as const }))) });
  const wl: any[] = Array.isArray(fromLs('mc_watchlist_tickers')) ? fromLs('mc_watchlist_tickers') : [];
  // the watchlist holds bare symbols: NSE symbols and BSE codes are India; a name that is not found in India is looked up in the USA
  out.push({ id: 'watch', label: '📋 My watchlist', entries: uniq(wl.map((x) => ({ m: 'IN' as const, t: clean(typeof x === 'string' ? x : x?.ticker ?? x?.symbol) }))), note: 'symbols without a market: India first, then the USA' });
  const cl = fromLs('mc:chart-watchlists:v1');
  const lists: any[] = Array.isArray(cl) ? cl : Array.isArray(cl?.lists) ? cl.lists : [];
  lists.forEach((l, i) => {
    // chart lists: { name, sections: [{ items: [{ m: 'IN' | 'US', t }] }] } (older shapes: items / rows / symbols)
    const rows: any[] = Array.isArray(l?.sections) ? l.sections.flatMap((sc: any) => (Array.isArray(sc?.items) ? sc.items : []))
      : Array.isArray(l?.items) ? l.items : Array.isArray(l?.rows) ? l.rows : Array.isArray(l?.symbols) ? l.symbols : [];
    const es = uniq(rows.map((r) => {
      const t = clean(r?.t ?? r?.symbol ?? r?.ticker ?? r);
      const ex = String(r?.m ?? r?.exchange ?? r?.market ?? '').toUpperCase();
      return { m: (/NSE|BSE|^IN$/.test(ex) || !ex ? 'IN' : 'US') as 'IN' | 'US', t, ...(ex ? { s: 1 as const } : {}) };
    }).filter((e) => e.t && !/^(CNX|NIFTY|SENSEX|\^)/.test(e.t)));
    if (es.length) out.push({ id: `chart-${i}`, label: `📈 ${String(l?.name || l?.title || `Chart list ${i + 1}`).slice(0, 28)}`, entries: es });
  });
  return out;
}
/** One-click loading from one or several of the owner's lists at once, plus Refresh (latest filings). */
export function BookLoader({ onAdd, onRefresh, busy }: { onAdd: (e: Entry[], replace: boolean) => void; onRefresh: () => void; busy: boolean }) {
  const [usBook, setUsBook] = useState<string[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [replace, setReplace] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem('mc:company-lab:sources:v1') || '[]'); if (Array.isArray(v)) setSel(v); } catch { /* none */ }
    fetch('/api/v1/us-book', { cache: 'no-store' }).then((r) => r.json()).then((j: any) => setUsBook((j?.book?.holdings || j?.holdings || []).map((h: any) => clean(h?.ticker)).filter(Boolean))).catch(() => { /* local only */ });
  }, []);
  const sources = useMemo(() => (typeof window === 'undefined' ? [] : readSources(usBook)), [usBook]);
  const toggle = (id: string) => setSel((v) => { const n = v.includes(id) ? v.filter((x) => x !== id) : [...v, id]; try { localStorage.setItem('mc:company-lab:sources:v1', JSON.stringify(n)); } catch { /* not kept */ } return n; });
  const picked = uniq(sources.filter((s) => sel.includes(s.id)).flatMap((s) => s.entries));
  const go = () => { if (!picked.length) return; onAdd(picked, replace); setMsg(`${replace ? 'Showing' : 'Added'} ${picked.length} companies from ${sources.filter((s) => sel.includes(s.id)).map((s) => s.label.replace(/^\S+\s/, '')).join(' + ')}`); };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12.5, fontWeight: 900, color: R.faint }}>LOAD FROM (pick one or more):</span>
        {sources.filter((s) => more || !s.id.startsWith('chart-') || sel.includes(s.id)).map((s) => {
          const on = sel.includes(s.id);
          return <button key={s.id} type="button" onClick={() => toggle(s.id)} title={s.note || `${s.entries.length} companies`} disabled={!s.entries.length}
            style={{ fontSize: 13, fontWeight: 800, padding: '5px 11px', borderRadius: 999, cursor: s.entries.length ? 'pointer' : 'not-allowed', border: `1px solid ${on ? R.cyan : R.border}`, background: on ? tint(R.cyan, 14) : 'transparent', color: !s.entries.length ? R.faint : on ? R.cyan : R.dim }}>
            {on ? '☑ ' : '☐ '}{s.label} <span style={{ fontWeight: 600, opacity: 0.8 }}>{s.entries.length}</span></button>;
        })}
        {sources.some((s) => s.id.startsWith('chart-')) ? <button type="button" onClick={() => setMore((v) => !v)} style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: `1px dashed ${R.border}`, background: 'transparent', color: R.dim }}>{more ? '▴ fewer lists' : `▾ chart lists (${sources.filter((s) => s.id.startsWith('chart-')).length})`}</button> : null}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" disabled={!picked.length} onClick={go} title={busy ? 'Stops the reading that is running and loads these instead' : undefined} style={{ fontSize: 13.5, fontWeight: 900, padding: '6px 14px', borderRadius: 8, cursor: !picked.length ? 'not-allowed' : 'pointer', border: `1px solid ${R.green}`, background: tint(R.green, 14), color: R.green }}>▶ Load {picked.length || ''} {picked.length === 1 ? 'company' : 'companies'}</button>
        <label style={{ fontSize: 12.5, color: R.dim, display: 'inline-flex', gap: 5, cursor: 'pointer' }}><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> replace the current list</label>
        <button type="button" disabled={busy} onClick={onRefresh} title="Read every company again from the newest filings (SEC / screener.in now, not the weekly copy)" style={{ fontSize: 13, fontWeight: 800, padding: '5px 11px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', border: `1px solid ${R.amber}`, background: tint(R.amber, 8), color: R.amber }}>🔄 Refresh all — latest filings</button>
        {msg && <span style={{ fontSize: 12.5, color: R.dim }}>{msg}</span>}
      </div>
    </div>
  );
}
