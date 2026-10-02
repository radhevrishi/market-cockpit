// zzz854 — Guidance Upgrades: validation of extracted guidance comparisons. Pure, deterministic, client-safe. Types-only import.
//
// A "raise" is only real when the OLD and NEW figures are the same metric, same basis, same period, and both are guidance.
// Everything here answers one question per comparison: can these two numbers be compared at all?
//   INVALID -> the comparison is wrong (period mismatch, a reported actual used as the old figure, the same figures under two periods,
//              a degenerate range, a period that has already ended, a per-share figure under an absolute metric). Dropped.
//   REVIEW  -> it may be wrong (period not stated, an implausibly large in-year change, figures that look like reported actuals).
//              Requeued as "needs review", never shown as verified.
// Thresholds are in GU_VALIDATION (documented below). Nothing names a company or a ticker.

import type { GuChange, GuGuidancePoint, GuMarket, GuMetric, GuValidationIssue } from './guidance-upgrades-types';

export const GU_VALIDATION = {
  /** an in-year raise of an ANNUAL revenue / volume / order guide above this (relative %, same period) needs review */
  IMPLAUSIBLE_REVENUE_PCT: 50,
  /** an in-year change of an ANNUAL profit-like guide (EBITDA, EBIT, net profit, EPS, FCF) above this needs review */
  IMPLAUSIBLE_PROFIT_PCT: 100,
  /** margin guide moved more than this many points */
  IMPLAUSIBLE_MARGIN_PP: 10,
  /** growth-rate guide moved more than this many points */
  IMPLAUSIBLE_GROWTH_PP: 20,
  /** a range whose high end is more than 5x its low end is not a range (e.g. 0.4 to 17.9) */
  DEGENERATE_RANGE_RATIO: 5,
  /** guidance vs consensus beyond +/-25% almost always means the consensus measures another metric or basis */
  CONSENSUS_MAX_GAP_PCT: 25,
  /** an annual range against a single-point old figure 2.5x-6x smaller is the quarterly-actual-vs-annual-guide signature */
  QUARTER_ANNUAL_RATIO_MIN: 2.5, QUARTER_ANNUAL_RATIO_MAX: 6,
  /** a calendar quarter label ("Q2 2025") is stale this many days after the calendar quarter ends (fiscal quarters can trail) */
  STALE_GRACE_DAYS_CALENDAR_Q: 62,
} as const;

const PROFIT_LIKE = new Set<GuMetric>(['EBITDA', 'EBIT', 'NET_PROFIT', 'EPS', 'ADJ_EPS', 'FCF']);
const REVENUE_LIKE = new Set<GuMetric>(['REVENUE', 'VOLUME', 'PRODUCTION', 'ORDER_INTAKE', 'BACKLOG']);
const ABSOLUTE_AMOUNT = new Set<GuMetric>(['REVENUE', 'EBITDA', 'EBIT', 'NET_PROFIT', 'FCF', 'ORDER_INTAKE', 'BACKLOG']);
const MARGIN_LIKE = new Set<GuMetric>(['OP_MARGIN', 'FCF_CONVERSION', 'CAPACITY_UTIL']);
const PER_SHARE = new Set<GuMetric>(['EPS', 'ADJ_EPS']);
const NAME: Record<GuMetric, string> = {
  REVENUE: 'revenue', REVENUE_GROWTH: 'revenue growth', EBITDA: 'EBITDA', EBIT: 'operating profit', OP_MARGIN: 'operating margin', EPS: 'EPS',
  ADJ_EPS: 'adjusted EPS', FCF: 'free cash flow', FCF_CONVERSION: 'cash conversion', ORGANIC_GROWTH: 'organic growth', ORDER_INTAKE: 'order intake',
  BACKLOG: 'order backlog', VOLUME: 'volume', PRODUCTION: 'production', CAPACITY_UTIL: 'capacity utilisation', NET_PROFIT: 'net profit', OTHER: 'other measure',
};
export const metricName = (m: GuMetric): string => NAME[m] ?? String(m).toLowerCase();

// ─── periods ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ParsedPeriod { kind: 'FY' | 'Q_FY' | 'H_FY' | 'CY' | 'Q_CY' | 'MULTI' | 'UNSTATED' | 'OTHER'; year?: number; q?: number; h?: number }
const yr4 = (s: string): number => { const n = Number(s); return s.length <= 2 ? 2000 + n : n; };
/** Reads the period strings the engine writes: 'FY26', 'Q2 FY26', 'H1 FY26', 'CY25', 'Q2 2025', 'FY26–29', '3 years', 'UNSTATED'. */
export function parsePeriod(p: string | null | undefined): ParsedPeriod {
  const t = String(p ?? '').trim();
  if (!t || /^unstated$/i.test(t)) return { kind: 'UNSTATED' };
  let m: RegExpExecArray | null;
  if ((m = /^Q([1-4])\s*FY(\d{2,4})$/i.exec(t))) return { kind: 'Q_FY', q: +m[1], year: yr4(m[2]) };
  if ((m = /^H([12])\s*FY(\d{2,4})$/i.exec(t))) return { kind: 'H_FY', h: +m[1], year: yr4(m[2]) };
  if ((m = /^FY(\d{2,4})$/i.exec(t))) return { kind: 'FY', year: yr4(m[1]) };
  if ((m = /^CY(\d{2,4})$/i.exec(t))) return { kind: 'CY', year: yr4(m[1]) };
  if ((m = /^Q([1-4])\s+(\d{4})$/i.exec(t))) return { kind: 'Q_CY', q: +m[1], year: +m[2] };
  if (/FY\d{2}\s*[–-]\s*\d{2}|\byears?\b/i.test(t)) return { kind: 'MULTI' };
  return { kind: 'OTHER' };
}
export type PeriodGrain = 'ANNUAL' | 'QUARTER' | 'HALF' | 'MULTI' | 'UNKNOWN';
export function periodGrain(p: string | null | undefined): PeriodGrain {
  const k = parsePeriod(p).kind;
  return k === 'FY' || k === 'CY' ? 'ANNUAL' : k === 'Q_FY' || k === 'Q_CY' ? 'QUARTER' : k === 'H_FY' ? 'HALF' : k === 'MULTI' ? 'MULTI' : 'UNKNOWN';
}
const iso = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number): string => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/**
 * The LATEST date the period can end. India: FYyy ends 31 Mar 20yy (Q1 = Apr-Jun of 20yy-1 ... Q4 = Jan-Mar 20yy).
 * US / other: fiscal labels vary (a 'fiscal 2025' can end as late as early Feb 2026), so FYyy and its quarters/halves are
 * bounded by 1 Feb 20yy+1. Calendar labels end on their calendar date (+ a grace for fiscal quarters written as 'Q2 2025').
 */
export function periodEndBound(p: string | null | undefined, market: GuMarket): string | null {
  const x = parsePeriod(p);
  if (x.year == null || !Number.isFinite(x.year)) return null;
  const y = x.year;
  if (x.kind === 'CY') return iso(y, 12, 31);
  if (x.kind === 'Q_CY') return addDays(iso(y, x.q! * 3, x.q === 1 || x.q === 4 ? 31 : 30), GU_VALIDATION.STALE_GRACE_DAYS_CALENDAR_Q);
  if (market === 'IN') {
    if (x.kind === 'FY') return iso(y, 3, 31);
    if (x.kind === 'Q_FY') return x.q === 1 ? iso(y - 1, 6, 30) : x.q === 2 ? iso(y - 1, 9, 30) : x.q === 3 ? iso(y - 1, 12, 31) : iso(y, 3, 31);
    if (x.kind === 'H_FY') return x.h === 1 ? iso(y - 1, 9, 30) : iso(y, 3, 31);
    return null;
  }
  if (x.kind === 'FY' || x.kind === 'Q_FY' || x.kind === 'H_FY') return iso(y + 1, 2, 1);
  return null;
}
/** True when the guided period had already ended on the announcement date (a 'raise' of an ended period is a reported result, not guidance). */
export function isStalePeriod(p: string | null | undefined, announcementDate: string, market: GuMarket): boolean {
  const end = periodEndBound(p, market);
  const d = String(announcementDate || '').slice(0, 10);
  return !!end && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > end;
}

// ─── single comparisons ─────────────────────────────────────────────────────────────────────────────────────────
const isRange = (p: GuGuidancePoint | null | undefined): boolean => !!p && p.low != null && p.high != null && p.low !== p.high;
const fractional = (v: number | null | undefined, perShare: boolean): boolean => {
  if (v == null || !Number.isFinite(v)) return false;
  if (perShare) { const cents = Math.round(Math.abs(v) * 100); return cents % 5 !== 0; }   // $4.27 reads like a result; guides are usually $4.25 / $4.30
  return Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 && Math.abs(v - Math.round(v)) > 1e-9;  // one decimal place, not whole: 158.9
};
function degenerate(p: GuGuidancePoint | null | undefined): boolean {
  if (!p || p.low == null || p.high == null || p.isGrowthRate) return false;
  if (p.low < 0 && p.high > 0) return true;
  if (p.low > 0 && p.high / p.low > GU_VALIDATION.DEGENERATE_RANGE_RATIO) return true;
  return false;
}
const pctOf = (c: GuChange): number | null => {
  const b = c.before?.midpoint; const a = c.after.midpoint;
  if (b == null || a == null) return null;
  if (c.after.isGrowthRate) return a - b;
  return b > 0 ? ((a - b) / b) * 100 : null;
};
const fmt = (p: GuGuidancePoint | null | undefined): string => {
  if (!p || p.midpoint == null) return 'DATA UNAVAILABLE';
  const one = (v: number) => (p.isGrowthRate ? `${+v.toFixed(2)}%` : `${p.currency ?? ''}${+v.toFixed(2)}${p.unit && p.unit !== '%' ? (p.unit.length > 1 ? ` ${p.unit}` : p.unit) : ''}`);
  return p.low != null && p.high != null && p.low !== p.high ? `${one(p.low)}–${one(p.high)}` : one(p.midpoint);
};

/** Every check that applies to ONE comparison (old -> new). */
export function validateChange(c: GuChange, x: { announcementDate: string; market: GuMarket }): GuValidationIssue[] {
  const out: GuValidationIssue[] = [];
  const m = c.metric; const per = c.after.period; const name = metricName(m);
  const push = (code: GuValidationIssue['code'], severity: GuValidationIssue['severity'], text: string) => out.push({ code, severity, metric: m, period: per, text });
  if (degenerate(c.after) || degenerate(c.before)) push('DEGENERATE_RANGE', 'INVALID', `Invalid range: ${name} ${fmt(degenerate(c.after) ? c.after : c.before)} — the high end is more than ${GU_VALIDATION.DEGENERATE_RANGE_RATIO}x the low end, so it is not a guided range (likely a parsing or unit error)`);
  if (c.after.periodKind !== 'MULTI_YEAR_CAGR' && isStalePeriod(per, x.announcementDate, x.market)) push('STALE_PERIOD', 'INVALID', `Stale period: ${name} for ${per} was announced on ${x.announcementDate.slice(0, 10)}, after that period had ended — a figure for a finished period is a result, not guidance`);
  if (ABSOLUTE_AMOUNT.has(m) && !c.after.isGrowthRate && c.after.currency && !c.after.unit && c.after.midpoint != null && Math.abs(c.after.midpoint) < 100)
    push('PER_SHARE_MISMATCH', 'INVALID', `Unit error: ${name} ${fmt(c.after)} has no scale (million, billion, crore) and is the size of a per-share amount, so it is not an absolute ${name} figure`);
  if (!c.before) return out;
  const bPer = c.before.period;
  if (per === 'UNSTATED' || bPer === 'UNSTATED') push('PERIOD_UNSTATED', 'REVIEW', `Period not stated: ${name} ${fmt(c.before)} → ${fmt(c.after)} — the source gives no fiscal year, so old and new cannot be confirmed as the same period`);
  else if (bPer !== per) push('PERIOD_MISMATCH', 'INVALID', `Period mismatch: old ${name} ${fmt(c.before)} is for ${bPer}, new ${fmt(c.after)} is for ${per} — not the same period, so not a raise`);
  if (c.before.grain === 'QUARTER' && periodGrain(per) !== 'QUARTER') push('PERIOD_MISMATCH', 'INVALID', `Period mismatch: old ${name} ${fmt(c.before)} is a single-quarter figure, new ${fmt(c.after)} is for ${per} — quarterly versus annual`);
  if (c.before.valueKind === 'ACTUAL') push('ACTUAL_VS_GUIDANCE', 'INVALID', `Actual versus guidance: old ${name} ${fmt(c.before)} is a reported result, not earlier guidance — the comparison is not a guidance raise`);
  const p = pctOf(c);
  if (p != null) {
    const a = Math.abs(p);
    const lim = c.after.isGrowthRate ? (MARGIN_LIKE.has(m) ? GU_VALIDATION.IMPLAUSIBLE_MARGIN_PP : GU_VALIDATION.IMPLAUSIBLE_GROWTH_PP)
      : PROFIT_LIKE.has(m) ? GU_VALIDATION.IMPLAUSIBLE_PROFIT_PCT : REVENUE_LIKE.has(m) ? GU_VALIDATION.IMPLAUSIBLE_REVENUE_PCT : null;
    if (lim != null && a > lim && c.after.periodKind !== 'MULTI_YEAR_CAGR')
      push('IMPLAUSIBLE_CHANGE', 'REVIEW', `Needs review: implausible change, likely period or unit mix-up — ${name} ${fmt(c.before)} → ${fmt(c.after)} (${p >= 0 ? '+' : ''}${p.toFixed(1)}${c.after.isGrowthRate ? ' points' : '%'}) within ${per === 'UNSTATED' ? 'an unstated period' : per}`);
  }
  // single-point old figure with reported-style precision against an annual range 2.5x-6x larger: the quarterly-actual-vs-annual-guide signature
  if (!c.after.isGrowthRate && ABSOLUTE_AMOUNT.has(m) && !isRange(c.before) && isRange(c.after) && fractional(c.before.midpoint, false)
    && c.before.midpoint && c.after.midpoint && periodGrain(per) !== 'QUARTER') {
    const r = c.after.midpoint / c.before.midpoint;
    if (r >= GU_VALIDATION.QUARTER_ANNUAL_RATIO_MIN && r <= GU_VALIDATION.QUARTER_ANNUAL_RATIO_MAX && !out.some((i) => i.code === 'ACTUAL_VS_GUIDANCE'))
      push('ACTUAL_VS_GUIDANCE', 'REVIEW', `Needs review: old ${name} ${fmt(c.before)} is a single figure with reported-style precision and the new ${fmt(c.after)} range is ${r.toFixed(1)}x larger — likely a quarterly actual compared with an annual guide`);
  }
  return out;
}

/** Event-level checks across all comparisons of one release. */
export function validateChanges(changes: readonly GuChange[], x: { announcementDate: string; market: GuMarket }): GuValidationIssue[] {
  const out: GuValidationIssue[] = [];
  for (const c of changes) out.push(...validateChange(c, x));
  // the same old and new figures under two periods (Q2 2026 and FY26 both 138.9 -> 319.7): neither can be trusted
  const seen = new Map<string, GuChange>();
  for (const c of changes) {
    if (!c.before || c.before.midpoint == null || c.after.midpoint == null) continue;
    const k = `${PER_SHARE.has(c.metric) ? 'EPS' : c.metric}|${c.before.midpoint}|${c.after.midpoint}`;
    const o = seen.get(k);
    if (o && o.after.period !== c.after.period) {
      for (const d of [o, c]) out.push({ code: 'DUPLICATE_ACROSS_PERIODS', severity: 'INVALID', metric: d.metric, period: d.after.period,
        text: `Same figures under two periods: ${metricName(c.metric)} ${fmt(c.before)} → ${fmt(c.after)} appears for both ${o.after.period} and ${c.after.period} — a period was mis-read, so neither is used` });
    } else if (!o) seen.set(k, c);
  }
  // two or more absolute single-point comparisons that all carry reported-style precision read like results, not guidance
  const pts = changes.filter((c) => c.before && !c.after.isGrowthRate && !isRange(c.after) && !isRange(c.before) && (ABSOLUTE_AMOUNT.has(c.metric) || PER_SHARE.has(c.metric))
    && (fractional(c.after.midpoint, PER_SHARE.has(c.metric)) || fractional(c.before!.midpoint, PER_SHARE.has(c.metric))));
  if (pts.length >= 2) for (const c of pts) out.push({ code: 'ACTUAL_VS_GUIDANCE', severity: 'REVIEW', metric: c.metric, period: c.after.period,
    text: `Needs review: ${metricName(c.metric)} ${fmt(c.before)} → ${fmt(c.after)} — several single figures with reported-style precision look like reported results (quarter or year-ago actuals), not guidance` });
  return out;
}

/** Same figures under two periods ACROSS separate events of one company on one day (each event holds one period). Returns event ids -> issue. */
export function duplicatesAcrossEvents<T extends { id: string; ticker: string; date: string; changes: readonly GuChange[] }>(list: readonly T[]): Map<string, GuValidationIssue> {
  const by = new Map<string, Array<{ id: string; c: GuChange }>>();
  for (const e of list) for (const c of e.changes) {
    if (!c.before || c.before.midpoint == null || c.after.midpoint == null) continue;
    const k = `${e.ticker.toUpperCase()}|${e.date.slice(0, 10)}|${PER_SHARE.has(c.metric) ? 'EPS' : c.metric}|${c.before.midpoint}|${c.after.midpoint}`;
    by.set(k, [...(by.get(k) ?? []), { id: e.id, c }]);
  }
  const out = new Map<string, GuValidationIssue>();
  for (const rows of by.values()) {
    const periods = new Set(rows.map((r) => r.c.after.period));
    if (periods.size < 2) continue;
    const ps = [...periods].join(' and ');
    for (const r of rows) out.set(r.id, { code: 'DUPLICATE_ACROSS_PERIODS', severity: 'INVALID', metric: r.c.metric, period: r.c.after.period,
      text: `Same figures under two periods: ${metricName(r.c.metric)} ${fmt(r.c.before)} → ${fmt(r.c.after)} appears for ${ps} — a period was mis-read, so neither is used` });
  }
  return out;
}

// ─── GAAP versus adjusted ───────────────────────────────────────────────────────────────────────────────────────
export type HeadlineBasis = 'ADJUSTED' | 'GAAP' | 'UNSTATED';
export function basisOfChange(c: GuChange): HeadlineBasis {
  if (c.metric === 'ADJ_EPS') return 'ADJUSTED';
  if (c.metric === 'EPS') return c.after.basis === 'NON_GAAP' ? 'UNSTATED' : 'GAAP';   // a bare EPS next to an adjusted EPS is the GAAP line
  if (c.after.basis === 'NON_GAAP') return 'ADJUSTED';
  if (c.after.basis === 'GAAP' || c.after.basis === 'REPORTED') return 'GAAP';
  return 'UNSTATED';
}
const familyKey = (c: GuChange): string => `${PER_SHARE.has(c.metric) ? 'EPS' : c.metric}|${c.after.period}`;
/**
 * Never mix bases. When the same measure and period is given on BOTH an adjusted and a GAAP (or unlabelled) basis, the adjusted line is
 * the headline (the basis companies emphasise) and the GAAP line is kept separately, labelled, with a plain note on the difference.
 */
export function splitByBasis(changes: readonly GuChange[]): { headline: GuChange[]; secondary: GuChange[]; basis: HeadlineBasis; note: string | null } {
  const groups = new Map<string, GuChange[]>();
  for (const c of changes) groups.set(familyKey(c), [...(groups.get(familyKey(c)) ?? []), c]);
  const headline: GuChange[] = []; const secondary: GuChange[] = []; const notes: string[] = [];
  for (const g of groups.values()) {
    const adj = g.filter((c) => basisOfChange(c) === 'ADJUSTED');
    const other = g.filter((c) => basisOfChange(c) !== 'ADJUSTED');
    if (adj.length && other.length) {
      headline.push(...adj); secondary.push(...other);
      const a = adj[0]; const o = other[0];
      const pa = pctOf(a); const po = pctOf(o);
      const label = PER_SHARE.has(a.metric) ? 'EPS' : metricName(a.metric);
      const sz = (c: GuChange, p: number | null) => (p == null ? '' : ` ${p >= 0 ? '+' : ''}${p.toFixed(1)}${c.after.isGrowthRate ? ' points' : '%'}`);
      const differ = pa != null && po != null && Math.abs(pa - po) >= 2;
      notes.push(`Headline uses adjusted ${label}${sz(a, pa)} (the basis the company emphasises); GAAP ${label}${sz(o, po)} is shown separately${differ ? ' — the gap between the two usually comes from one-off items' : ''}.`);
    } else headline.push(...g);
  }
  const bases = new Set(headline.map(basisOfChange));
  const basis: HeadlineBasis = bases.has('ADJUSTED') ? 'ADJUSTED' : bases.has('GAAP') ? 'GAAP' : 'UNSTATED';
  // keep the caller's order
  const order = (l: GuChange[]) => changes.filter((c) => l.includes(c));
  return { headline: order(headline), secondary: order(secondary), basis, note: notes.length ? notes.join(' ') : null };
}

// ─── consensus ──────────────────────────────────────────────────────────────────────────────────────────────────
/** A consensus that differs from the guided midpoint by more than 25% is almost always another metric or basis (an FFO guide vs a GAAP EPS estimate). */
export function consensusLooksMismatched(gapPct: number | null | undefined): boolean {
  return gapPct != null && Number.isFinite(gapPct) && Math.abs(gapPct) > GU_VALIDATION.CONSENSUS_MAX_GAP_PCT;
}

// ─── capital raise / financing ──────────────────────────────────────────────────────────────────────────────────
const FINANCING_RE = /\b(?:(?:public|secondary|follow-on|registered direct|underwritten|private|equity|common stock|stock|share|shares|notes?|bonds?|debt|convertible|preferred|debenture)\s+(?:offering|placement|issuance|issue|sale)s?|at[- ]the[- ]market(?:\s+(?:offering|program|equity))?|\bATM\s+(?:program|offering|facility)|(?:revolving\s+)?credit\s+(?:facility|agreement|line)|term\s+loan|(?:senior|secured|unsecured|exchangeable|convertible)\s+(?:secured\s+|unsecured\s+)?notes|notes\s+due\s+(?:20)?\d{2}|qualified institutional placements?|\bQIPs?\b|rights\s+(?:issue|offering)|preferential\s+(?:issue|allotment)|fund[- ]?rais(?:e|ing|ed)|capital\s+raise|pricing\s+of\s+(?:its\s+|an?\s+)?(?:\$[\d.,]+\s*(?:million|billion)?\s+)?(?:offering|notes)|priced\s+(?:its|an?)\s+(?:\w+\s+){0,3}(?:offering|notes)|non[- ]convertible\s+debentures|\bNCDs?\b|commercial\s+papers?|raises?\s+(?:US\$|\$|₹|rs\.?\s?|inr\s?|usd\s?)\s?\d[\d,.]*\s*(?:million|billion|crore|cr|mn|bn|lakh)?\s+(?:in|via|through|from|by)\b)/i;
const GUIDANCE_RAISE_RE = /\b(?:rais\w*|lift\w*|increas\w*|hik\w*|upgrad\w*|boost\w*|revis\w+ (?:up|upward|higher)|now expects?|now sees?)\b[^.;]{0,80}\b(?:guidance|outlook|forecast|targets?|expectations?)\b|\b(?:guidance|outlook|forecast)\b[^.;]{0,40}\b(?:raised|lifted|increased|upgraded|revised (?:up|upward|higher))\b/i;
const splitS = (t: string): string[] => String(t || '').replace(/\r/g, '\n').split(/(?<=[.!?])\s+(?=[A-Z₹$€£])|\n+|;\s+/).map((s) => s.trim()).filter(Boolean);
export const isFinancingSentence = (s: string): boolean => FINANCING_RE.test(String(s || ''));
/** A sentence that raises an earnings guide and is not itself about financing. */
export const isGuidanceRaiseSentence = (s: string): boolean => GUIDANCE_RAISE_RE.test(s) && !FINANCING_RE.test(s);
/**
 * capital_raise_or_financing: an equity offering, notes, a credit facility, an ATM program, a QIP / rights issue / NCDs, money raised.
 * It is a capital raise when the HEADLINE is about financing, or when financing sentences are present and NO sentence raises an earnings guide.
 * A release that raises guidance AND mentions a credit facility is still guidance (the guidance sentence wins).
 */
const FINANCING_EVENT_RE = /(?:US\$|\$|₹|rs\.?\s?|inr\s?|usd\s?)\s?\d|\b\d[\d,.]*\s*(?:million|billion|crore|cr|mn|bn|lakh)\b|\b(?:pric(?:ed|ing)|upsiz\w+|clos(?:ed|es|ing) (?:of )?(?:its|an?|the)|complet\w+ (?:its|an?|the)|launch\w*|proposed|offering)\b/i;
/** a financing sentence that IS a financing event (an amount, a pricing, an offering) — not an incidental mention such as 'also amended its credit facility' */
export const isFinancingEvent = (s: string): boolean => isFinancingSentence(s) && FINANCING_EVENT_RE.test(s);
export function financingVerdict(title: string, text: string): { capitalRaise: boolean; reason: string | null } {
  const t = String(title || ''); const body = splitS(text || '');
  const titleGuide = isGuidanceRaiseSentence(t);
  const bodyGuide = body.some(isGuidanceRaiseSentence);
  if (isFinancingSentence(t) && !titleGuide && !bodyGuide) return { capitalRaise: true, reason: `Capital raise or financing, not guidance: "${t.slice(0, 140)}"` };
  // the body is about a financing event and nowhere raises a guide: a 'raises guidance' headline over it is not guidance
  const ev = body.find(isFinancingEvent);
  if (ev && !bodyGuide && (!titleGuide || body.length > 0)) return { capitalRaise: true, reason: `Capital raise or financing, not guidance: "${ev.slice(0, 140)}"` };
  return { capitalRaise: false, reason: null };
}

// ─── broker words inside a company name ─────────────────────────────────────────────────────────────────────────
const BROKER_FOLLOW_OK = /^(?:Sachs|Stanley|Securities|Research|Capital|Markets|Group|Institutional|Equities|Fargo|Suisse|Bank|Ratings|Global|Investment|Investments|analysts?|Analysts?|Broking|Financial Services)\b/;
/**
 * True when a broker / agency word found by a regex is really part of a company's own name: 'Abercrombie & Fitch', 'Citi Trends'.
 * Then the subject is the company, not an analyst. `idx`/`len` locate the matched broker word inside `s`.
 */
export function brokerWordIsCompanyName(s: string, idx: number, len: number): boolean {
  const before = s.slice(Math.max(0, idx - 4), idx);
  if (/(?:&|\band)\s*$/i.test(before)) return true;
  const after = s.slice(idx + len, idx + len + 30);
  const m = /^\s+([A-Z][A-Za-z'.-]+)/.exec(after);
  if (m && !BROKER_FOLLOW_OK.test(m[1])) return true;
  return false;
}
