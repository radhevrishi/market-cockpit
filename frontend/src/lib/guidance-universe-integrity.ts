// zzz853 — GUIDANCE UNIVERSE data-integrity helpers. Pure (no I/O, no company names, never invents a number).
// Growth basis (explicit / derived / implied), period facts, metric family + units, verification state, claim type, revision chains,
// source conflicts, review reasons. Used by guidance-universe.ts; types live in guidance-universe-types.ts.
import type { GgKind, GgMetric, GgPeriodKind } from './growth-guidance-types';
import { BROAD_RANGE_PP, DERIVE_TOLERANCE_PP, STALE_VERIFICATION_DAYS, canVerify, type SourceTier } from './guidance-config';
import type {
  GuClaimType, GuCohort, GuDurationType, GuGrowthType, GuHistoryStep, GuMetricFamily, GuPeriodConfirm, GuRevisionVsPrior, GuVerificationState, GuVersionSnapshot,
} from './guidance-universe-types';

const DAY = 86_400_000;
export const r0 = (n: number) => Math.round(n);
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const fnum = (n: number) => String(r1(n));
/** '+35' / '-19.8' (never '+-19.8'). */
export const sg = (n: number, dp = 1) => `${n < 0 ? '-' : '+'}${dp === 0 ? String(r0(Math.abs(n))) : fnum(Math.abs(n))}`;

// ═══ periods ═══════════════════════════════════════════════════════════════════════════════════
/** 'FY2027' -> 'FY27', 'FY27–29' -> 'FY27-29', 'cy2026' -> 'CY26'. Anything else is returned trimmed. */
export function normPeriod(p: string): string {
  let s = String(p || '').trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  s = s.replace(/^(fy|cy)\s?(\d{2,4})(?:-(\d{2,4}))?$/i, (_m, a: string, y: string, z?: string) => `${a.toUpperCase()}${y.slice(-2)}${z ? `-${z.slice(-2)}` : ''}`);
  s = s.replace(/^(q[1-4]|h[12]) ?(fy|cy)\s?(\d{2,4})$/i, (_m, q: string, a: string, y: string) => `${q.toUpperCase()} ${a.toUpperCase()}${y.slice(-2)}`);
  return collapseIndianFy(s);
}
/**
 * zzz880 — "FY26-27" (also "FY2026-27", "FY 2026-2027") is ONE Indian fiscal year, 2026-27 = FY27, not a two-year span. Read as a span it
 * was classified multi-year and tripped the CAGR check 12 times (Piccadily, RVNL, SBC Exports, Synergy Green, …). Only a span of exactly
 * one year collapses; "FY25-28" stays a multi-year range.
 */
export function collapseIndianFy(s: string): string {
  const m = /^FY(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return (parseInt(m[1], 10) + 1) % 100 === parseInt(m[2], 10) ? `FY${m[2]}` : s;
}
export interface GuPeriodFacts {
  periodLabelSource: string; periodNormalized: string; fiscalYear: number | null; fiscalYearStart: number | null; fiscalQuarter: number | null;
  periodStatus: GuPeriodConfirm; durationType: GuDurationType; cohort: GuCohort | null;
  /** the label the period end is computed from (the normalised label, or the year-less label completed by a record-carried fiscal-year context) */
  effectivePeriod: string; contextApplied: boolean; note: string | null;
}
const CAGR_RE = /\b(cagr|compound(?:ed)?|annuali[sz]ed|per annum|p\.?a\.?|each year|every year|annual growth rate)\b/i;
const yy = (s: string) => 2000 + parseInt(s.slice(-2), 10);
/**
 * Period facts from the label text and (only) the source record's own fiscal-year context. A year is NEVER taken from today's date or the issue date:
 * a year-less quarter stays UNCLEAR unless `context` (filing period / period of report / explicit text, e.g. 'FY27') is carried by the record itself.
 */
export function periodFacts(label: string, pkind: GgPeriodKind, opts: { context?: string | null; statement?: string; cumulativeYears?: number | null } = {}): GuPeriodFacts {
  const src = String(label ?? ''); const n = normPeriod(src);
  const base = (o: Partial<GuPeriodFacts>): GuPeriodFacts => ({
    periodLabelSource: src, periodNormalized: n, fiscalYear: null, fiscalYearStart: null, fiscalQuarter: null, periodStatus: 'UNKNOWN', durationType: 'UNKNOWN', cohort: null,
    effectivePeriod: n, contextApplied: false, note: null, ...o,
  });
  const cohortOf = (d: GuDurationType): GuCohort | null => (d === 'ANNUAL' ? 'ANNUAL' : d === 'QUARTER' ? 'QUARTERLY' : d === 'CAGR' || d === 'MULTI_YEAR' ? 'MULTI_YEAR_CAGR' : null);
  const fin = (f: GuPeriodFacts) => ({ ...f, cohort: cohortOf(f.durationType) });
  const ctx = opts.context ? normPeriod(opts.context) : null;
  const ctxM = ctx ? /^(FY|CY)(\d{2})$/.exec(ctx) : null;
  // year-less quarter / half
  const yl = /^([QH])([1-4])(?: \(year not stated\))?$/i.exec(n);
  if (yl) {
    const kind = yl[1].toUpperCase() as 'Q' | 'H'; const num = parseInt(yl[2], 10); const dur: GuDurationType = kind === 'Q' ? 'QUARTER' : 'HALF_YEAR';
    if (kind === 'H' && num > 2) return fin(base({ periodStatus: 'UNKNOWN', durationType: 'UNKNOWN', note: `${n} is not a half-year.` }));
    if (ctxM) return fin(base({ periodNormalized: `${kind}${num} ${ctx}`, effectivePeriod: `${kind}${num} ${ctx}`, fiscalYear: yy(ctxM[2]), fiscalQuarter: kind === 'Q' ? num : null, periodStatus: 'CONFIRMED', durationType: dur, contextApplied: true, note: `Year taken from the record's own period context (${ctx}), not from a date.` }));
    return fin(base({ periodStatus: 'UNCLEAR', durationType: dur, fiscalQuarter: kind === 'Q' ? num : null, note: 'Period year not stated in the source, so the period is unclear.' }));
  }
  if (pkind === 'UNKNOWN' || /^Period not stated$/i.test(n) || /not stated/i.test(n) || !n) return fin(base({ periodStatus: 'UNKNOWN', durationType: 'UNKNOWN', note: 'Period not stated.' }));
  let m = /^([QH])([1-4]) (FY|CY)(\d{2})$/.exec(n);
  if (m) return fin(base({ fiscalYear: yy(m[4]), fiscalQuarter: m[1] === 'Q' ? parseInt(m[2], 10) : null, periodStatus: 'CONFIRMED', durationType: m[1] === 'Q' ? 'QUARTER' : 'HALF_YEAR' }));
  m = /^FY(\d{2})-(\d{2})$/.exec(n);
  if (m) {
    const d: GuDurationType = pkind === 'MULTI_YEAR_CAGR' && !(opts.cumulativeYears && opts.cumulativeYears > 1) && (CAGR_RE.test(opts.statement || '') || pkind === 'MULTI_YEAR_CAGR') ? 'CAGR' : 'MULTI_YEAR';
    return fin(base({ fiscalYearStart: yy(m[1]), fiscalYear: yy(m[2]), periodStatus: 'CONFIRMED', durationType: d }));
  }
  m = /^(FY|CY)(\d{2})$/.exec(n);
  if (m) return fin(base({ fiscalYear: yy(m[2]), periodStatus: 'CONFIRMED', durationType: pkind === 'MULTI_YEAR_CAGR' ? (opts.cumulativeYears && opts.cumulativeYears > 1 ? 'MULTI_YEAR' : 'CAGR') : 'ANNUAL' }));
  if (/^next (?:12|twelve) months/i.test(n) || pkind === 'ROLLING_12M') return fin(base({ periodStatus: 'CONFIRMED', durationType: 'ANNUAL', note: 'Rolling twelve months: no fiscal year is named.' }));
  if (/^next (?:\d+[–-])?\d+ years?/i.test(n) || pkind === 'MULTI_YEAR_CAGR') return fin(base({ periodStatus: 'CONFIRMED', durationType: pkind === 'MULTI_YEAR_CAGR' && !(opts.cumulativeYears && opts.cumulativeYears > 1) ? 'CAGR' : 'MULTI_YEAR' }));
  if (/^(?:19|20)\d{2}$/.test(n) && (pkind === 'FY' || pkind === 'CY')) return fin(base({ fiscalYear: parseInt(n, 10), periodStatus: 'CONFIRMED', durationType: 'ANNUAL' }));
  return fin(base({ periodStatus: 'UNCLEAR', durationType: pkind === 'QUARTER' ? 'QUARTER' : pkind === 'HALF' ? 'HALF_YEAR' : pkind === 'FY' || pkind === 'CY' ? 'ANNUAL' : 'UNKNOWN', note: `Period label "${src}" could not be placed on a fiscal calendar.` }));
}

// ═══ metric family, currency, unit, scale ═══════════════════════════════════════════════════════
export const FAMILY_OF: Record<GgMetric, GuMetricFamily> = { REVENUE: 'REVENUE', PAT: 'NET_PROFIT', EBITDA: 'EBITDA', EPS: 'EPS', FCF: 'FCF' };
const LABEL_FAMILIES: Array<[RegExp, GuMetricFamily]> = [
  [/\b(?:revenue(?:s)? from operations|net sales|sales|turnover|top[- ]?line|revenue(?:s)?)\b/i, 'REVENUE'],
  [/\b(?:pat|profit after tax|net profit|net income|net earnings|bottom[- ]?line)\b/i, 'NET_PROFIT'],
  [/\b(?:ebitda|operating profit)\b/i, 'EBITDA'],
  [/\b(?:eps|earnings per share)\b/i, 'EPS'],
  [/\b(?:fcf|free cash flow)\b/i, 'FCF'],
];
/** The metric word the source actually used ('Net sales', 'Turnover', 'PAT'), found in the source label or statement. Null when none is present. */
export function extractMetricLabel(text: string, metric: GgMetric): string | null {
  const want = FAMILY_OF[metric]; const t = String(text || '');
  for (const [re, fam] of LABEL_FAMILIES) { if (fam !== want) continue; const m = re.exec(t); if (m) return m[0]; }
  return null;
}
/** Which metric family a source label belongs to (Sales / Net sales / Turnover -> REVENUE; PAT / Net income / Net profit -> NET_PROFIT). */
export function familyOfLabel(label: string | null | undefined): GuMetricFamily | null {
  const t = String(label || ''); if (!t) return null;
  for (const [re, fam] of LABEL_FAMILIES) if (re.test(t)) return fam;
  return null;
}
export interface GuMoneyUnit { currency: 'INR' | 'USD' | 'EUR' | 'GBP' | null; scale: 'LAKH' | 'CRORE' | 'THOUSAND' | 'MILLION' | 'BILLION' | null; unit: string }
export function parseUnit(unit: string | null | undefined): GuMoneyUnit {
  const u = String(unit || '').trim();
  const currency = /₹|\brs\.?\b|\binr\b/i.test(u) ? 'INR' : /\$|\busd\b/i.test(u) ? 'USD' : /€|\beur\b/i.test(u) ? 'EUR' : /£|\bgbp\b/i.test(u) ? 'GBP' : null;
  const t = u.replace(/\s/g, '');
  const scale = /cr(?:ore)?s?/i.test(u) ? 'CRORE' : /lakh|\blac\b/i.test(u) ? 'LAKH' : /billion|\bbn\b|b$/i.test(t) ? 'BILLION' : /million|\bmn\b|m$/i.test(t) ? 'MILLION' : /thousand|k$/i.test(t) ? 'THOUSAND' : null;
  return { currency, scale, unit: u };
}
export function sameMoneyBasis(a: string | null | undefined, b: string | null | undefined): { ok: boolean; reason: string | null } {
  if (!a || !b) return { ok: true, reason: null };
  if (a === b) return { ok: true, reason: null };
  const x = parseUnit(a), y = parseUnit(b);
  if (x.currency && y.currency && x.currency !== y.currency) return { ok: false, reason: `currency differs (${a} vs ${b})` };
  if (x.scale && y.scale && x.scale !== y.scale) return { ok: false, reason: `unit scale differs (${a} vs ${b})` };
  if (x.currency === y.currency && x.scale === y.scale) return { ok: true, reason: null };
  return { ok: false, reason: `units differ (${a} vs ${b})` };
}

// ═══ money text ═════════════════════════════════════════════════════════════════════════════════
/** Money amount as written in the data: '₹750 Cr', '$140M', '$1.1B'. */
export function amountText(a: { value: number; unit: string; valueLow?: number }): string {
  const u = a.unit; const f = (n: number) => n.toLocaleString('en-US');
  const val = a.valueLow != null && a.valueLow < a.value ? `${f(a.valueLow)}–${f(a.value)}` : f(a.value);
  return `${u === '₹ Cr' ? '₹' : u.startsWith('$') ? '$' : ''}${val}${u === '₹ Cr' ? ' Cr' : u.startsWith('$') ? u.slice(1) : u ? ` ${u}` : ''}`;
}
export function pctText(low: number, high: number | null, open: boolean, dp = 1): string {
  const f = (n: number) => (dp === 0 ? String(r0(Math.abs(n))) : fnum(Math.abs(n)));
  const s = (n: number) => `${n < 0 ? '-' : '+'}${f(n)}`;
  const same = high == null || (dp === 0 ? r0(low) === r0(high) : r1(low) === r1(high));
  return open ? `${s(low)}%+` : same ? `${s(low)}%` : low < 0 || high! < 0 ? `${s(low)} to ${s(high!)}%` : `${s(low)}–${f(high!)}%`;
}

// ═══ growth derivation (absolute target vs a sourced base) ═════════════════════════════════════
export type GuBaseKind = 'PRIOR_YEAR_ACTUAL' | 'PRIOR_GUIDANCE';
export interface GuDerivationIn { target: { value: number; valueLow?: number; unit: string }; base: { value: number; unit: string; period: string; kind?: GuBaseKind | null }; storedLow: number | null; storedHigh: number | null }
export interface GuDerivationOut {
  ok: boolean; reason: string | null;
  previousValue: number; currentLow: number; currentHigh: number; unit: string; basePeriod: string;
  growthLow: number; growthMid: number; growthHigh: number; basis: 'absolute_vs_prior_year_actual' | 'absolute_vs_prior_guidance';
  /** the stored % and the arithmetic agree (within DERIVE_TOLERANCE_PP) */ consistent: boolean;
}
/** growth = target / base - 1 for each end of the target. Refuses (ok=false) when the base is not positive or its currency / unit scale differs. */
export function deriveGrowth(i: GuDerivationIn): GuDerivationOut {
  const cl = i.target.valueLow != null && i.target.valueLow < i.target.value ? i.target.valueLow : i.target.value; const ch = i.target.value; const b = i.base.value;
  const basis = i.base.kind === 'PRIOR_GUIDANCE' ? 'absolute_vs_prior_guidance' : 'absolute_vs_prior_year_actual';
  const out: GuDerivationOut = { ok: false, reason: null, previousValue: b, currentLow: cl, currentHigh: ch, unit: i.target.unit, basePeriod: i.base.period, growthLow: 0, growthMid: 0, growthHigh: 0, basis, consistent: false };
  if (!(b > 0)) { out.reason = 'the base is not a positive number'; return out; }
  const cmp = sameMoneyBasis(i.target.unit, i.base.unit); if (!cmp.ok) { out.reason = cmp.reason; return out; }
  out.ok = true; out.growthLow = (cl / b - 1) * 100; out.growthHigh = (ch / b - 1) * 100; out.growthMid = ((cl + ch) / 2 / b - 1) * 100;
  if (i.storedLow == null) out.consistent = true;
  else out.consistent = Math.abs(out.growthLow - i.storedLow) <= DERIVE_TOLERANCE_PP && Math.abs(out.growthHigh - (i.storedHigh ?? i.storedLow)) <= DERIVE_TOLERANCE_PP;
  return out;
}
/** 0 decimals for a broad derived / implied range, 1 decimal for a narrow one or a single point. */
export const derivedDp = (low: number, high: number | null): 0 | 1 => (high != null && Math.abs(high - low) >= BROAD_RANGE_PP ? 0 : 1);

// ═══ claim type ═════════════════════════════════════════════════════════════════════════════════
const ATTRIBUTION_RE = /\b(management|company|ceo|cfo|coo|md|chairman|co-?chairman|managing director|promoters?|board|guid\w*|target\w*|aims?|aspir\w*|plans?|stated|outlook|announced)\b/i;
const UNATTRIBUTED_RE = /\b(sources? (?:said|say|familiar)|people familiar|rumou?rs?|reportedly|unconfirmed|speculat\w*|market chatter|street (?:expects|sees|estimates)|whisper)\b/i;
const ORDERBOOK_RE = /\b(order[- ]?book|order[- ]?backlog|backlog|capacity (?:of|addition|utili[sz]ation|expansion)|installed capacity)\b/i;
const METRIC_GUIDE_RE = /\b(revenue|sales|turnover|top[- ]?line|pat|profit|ebitda|eps|earnings)\b[^.]{0,80}\b(guid\w*|target\w*|expect\w*|grow\w*|growth|to rise|to reach)|\b(guid\w*|target\w*|expect\w*)\b[^.]{0,80}\b(revenue|sales|turnover|top[- ]?line|pat|profit|ebitda|eps)\b/i;
/** Claim type from the extractor's kind, the source tier and the statement. Only MANAGEMENT_GUIDANCE enters the universe. */
export function claimTypeOf(kind: GgKind, tier: SourceTier, statement: string): GuClaimType {
  if (kind === 'ANALYST_CONSENSUS') return 'CONSENSUS';
  if (kind === 'ANALYST_ESTIMATE') return 'ANALYST_ESTIMATE';
  if (kind === 'INFERENCE' || kind === 'HISTORICAL_TRAJECTORY') return 'SYSTEM_DERIVED';
  // a media report that quotes or paraphrases management stays MANAGEMENT_GUIDANCE; only an unattributed, hedged claim (sources / rumour / street) is a MEDIA_CLAIM
  if (tier >= 3 && statement && !ATTRIBUTION_RE.test(statement) && UNATTRIBUTED_RE.test(statement)) return 'MEDIA_CLAIM';
  return 'MANAGEMENT_GUIDANCE';
}
/** Why a record is not guidance at all (null = it is guidance). Order book / capacity / commentary are not guidance. */
export function nonGuidanceReason(kind: GgKind, claim: GuClaimType, statement: string): string | null {
  if (claim === 'ANALYST_ESTIMATE') return 'Analyst estimate, not management guidance.';
  if (claim === 'CONSENSUS') return 'Analyst consensus, not management guidance.';
  if (claim === 'SYSTEM_DERIVED') return 'System-derived or historical trajectory, not management guidance.';
  if (claim === 'MEDIA_CLAIM') return 'Media claim not attributed to management, not guidance.';
  if (kind === 'MANAGEMENT_COMMENTARY') return 'Management commentary, not guidance.';
  if (ORDERBOOK_RE.test(statement) && !METRIC_GUIDE_RE.test(statement)) return 'Order book / capacity statement, not guidance.';
  return null;
}

// ═══ revision wording: reiteration and capital raises are never a RAISE ═════════════════════════
const CAPITAL_RAISE_RE = /\b(?:rais(?:e|ed|es|ing)\s+(?:capital|funds?|equity|debt|money|₹|rs\.?|inr|\$|usd|an?\s+(?:qip|ipo|fpo|ncd))|qip|fund[- ]?raise|fund raising|capital raise|preferential (?:issue|allotment)|public offering|follow-on offering|rights issue|ipo)\b/i;
const GUIDANCE_RAISE_RE = /\b(?:rais(?:ed|es|ing)|upgrad(?:ed|es|ing)|hik(?:ed|es|ing)|lift(?:ed|s|ing)|increas(?:ed|es|ing)|revis(?:ed|es|ing)\s+up)\s+(?:its\s+|the\s+|their\s+|full[- ]year\s+|fy\s?\d{2,4}\s+)?(?:\w+\s+){0,3}?(?:guidance|target|outlook|forecast|estimate)s?\b|\b(?:guidance|target|outlook|forecast)s?\s+(?:was\s+|were\s+)?(?:raised|upgraded|hiked|lifted)\b/i;
export const isCapitalRaise = (text: string): boolean => CAPITAL_RAISE_RE.test(text || '');
export const isReiteration = (text: string): boolean => /\b(reiterat\w*|reaffirm\w*|maintain\w*|unchanged|re-?stat\w*)\b/i.test(text || '');
/** true when the text says the GUIDANCE was raised (not funds, not a reiteration) */
export function textSaysGuidanceRaised(text: string): boolean {
  const t = text || '';
  if (!GUIDANCE_RAISE_RE.test(t)) return false;
  if (isReiteration(t) && !/\b(raised|upgraded|hiked|lifted)\b[^.]{0,40}\b(guidance|target|outlook)/i.test(t)) return false;
  return true;
}

// ═══ versions, revision vs prior guidance, history chain ═════════════════════════════════════════
export interface GuVersionIn { date: string | null; low: number | null; high: number | null; absLow: number | null; absHigh: number | null; unit: string | null; source: string; display: string }
const midOf = (a: number | null, b: number | null): number | null => (a == null ? null : b == null ? a : (a + b) / 2);
const dir = (pct: number): 'RAISED' | 'LOWERED' | 'MAINTAINED' => (pct > 0.5 ? 'RAISED' : pct < -0.5 ? 'LOWERED' : 'MAINTAINED');
/** The change from the previous version to the current one. Same-kind numbers only: amounts vs amounts (percent change), % vs % (percentage points). Otherwise null. */
export function compareVersions(prev: GuVersionIn, cur: GuVersionIn): { kind: 'ABSOLUTE' | 'PERCENT_POINTS'; changeLowPct: number | null; changeMidPct: number | null; changeHighPct: number | null; changePp: number | null; direction: 'RAISED' | 'LOWERED' | 'MAINTAINED' } | null {
  if (prev.absLow != null && cur.absLow != null && prev.absLow > 0 && sameMoneyBasis(prev.unit, cur.unit).ok) {
    const pl = prev.absLow, ph = prev.absHigh ?? prev.absLow, cl = cur.absLow, ch = cur.absHigh ?? cur.absLow;
    const mid = ((cl + ch) / 2 / ((pl + ph) / 2) - 1) * 100;
    return { kind: 'ABSOLUTE', changeLowPct: (cl / pl - 1) * 100, changeMidPct: mid, changeHighPct: (ch / ph - 1) * 100, changePp: null, direction: dir(mid) };
  }
  const pm = midOf(prev.low, prev.high), cm = midOf(cur.low, cur.high);
  if (pm != null && cm != null) { const pp = cm - pm; return { kind: 'PERCENT_POINTS', changeLowPct: null, changeMidPct: null, changeHighPct: null, changePp: pp, direction: dir(pp) }; }
  return null;
}
const snap = (v: GuVersionIn): GuVersionSnapshot => ({ date: v.date, low: v.low, high: v.high, absoluteLow: v.absLow, absoluteHigh: v.absHigh, unit: v.unit, display: v.display, source: v.source });
const amtOf = (v: GuVersionIn): string | null => (v.absLow != null && v.unit ? amountText({ value: v.absHigh ?? v.absLow, valueLow: v.absHigh != null && v.absHigh !== v.absLow ? v.absLow : undefined, unit: v.unit }) : null);
/** The labelled fact 'revision vs prior guidance' (kept apart from growth vs prior-year actual). */
export function revisionVsPriorOf(prev: GuVersionIn | null, cur: GuVersionIn): GuRevisionVsPrior | null {
  if (!prev) return null;
  const c = compareVersions(prev, cur); if (!c) return null;
  const pa = amtOf(prev), ca = amtOf(cur);
  const word = c.direction === 'RAISED' ? 'raised' : c.direction === 'LOWERED' ? 'lowered' : 'unchanged';
  const display = c.kind === 'ABSOLUTE'
    ? `${word} ${sg(c.changeMidPct as number, 0)}% vs prior guidance (${pa} → ${ca}${prev.date ? `, prior dated ${prev.date}` : ''})`
    : `${word} ${sg(c.changePp as number, 1)} pp vs prior guidance (${prev.display} → ${cur.display}${prev.date ? `, prior dated ${prev.date}` : ''})`;
  return {
    basis: c.kind === 'ABSOLUTE' ? 'absolute_vs_prior_guidance' : 'percent_vs_prior_guidance', direction: c.direction, previous: snap(prev), current: snap(cur),
    previousValue: prev.absLow != null ? (prev.absHigh ?? prev.absLow) : null, previousValueLow: prev.absLow, currentLow: cur.absLow, currentHigh: cur.absHigh ?? cur.absLow,
    changeLowPct: c.changeLowPct, changeMidPct: c.changeMidPct, changeHighPct: c.changeHighPct, changePp: c.changePp, display,
  };
}
/** Consecutive revisions (A→B, B→C — never A→C). `versions` may be in any order; they are sorted by date (undated keep their order, first). The last version carries `lastStatus`; every earlier one is SUPERSEDED. */
export function buildHistory(versions: GuVersionIn[], lastStatus: GuHistoryStep['status']): GuHistoryStep[] {
  const idx = versions.map((v, i) => ({ v, i })).sort((a, b) => (a.v.date || '').localeCompare(b.v.date || '') || a.i - b.i).map((x) => x.v);
  const uniq: GuVersionIn[] = [];
  for (const v of idx) { const l = uniq[uniq.length - 1]; if (l && l.date === v.date && l.low === v.low && l.high === v.high && l.absLow === v.absLow && l.absHigh === v.absHigh) continue; uniq.push(v); }
  return uniq.map((v, i): GuHistoryStep => {
    const prev = i > 0 ? uniq[i - 1] : null; const c = prev ? compareVersions(prev, v) : null;
    return { step: i + 1, date: v.date, from: prev ? snap(prev) : null, to: snap(v), revision: prev ? (c ? c.direction : 'UNKNOWN') : 'INITIAL', changeMidPct: c?.changeMidPct ?? null, changePp: c?.changePp ?? null, status: i === uniq.length - 1 ? lastStatus : 'SUPERSEDED', source: v.source };
  });
}

// ═══ verification state ═════════════════════════════════════════════════════════════════════════
export interface GuStateIn { claimType: GuClaimType; tier: SourceTier; primarySourceFound: boolean; primarySourceRead: boolean; growthType: GuGrowthType; periodStatus: GuPeriodConfirm; needsReview: boolean; hasEvidence: boolean }
/**
 * VERIFIED    primary source (TIER1/2) read, growth EXPLICIT, period CONFIRMED, not flagged.
 * DERIVED     primary source read; the system worked growth out from the primary's own numbers.
 * PARTIAL     primary source confirms some fields only (growth implied, flagged, no read, no % ...).
 * UNVERIFIED  media / other source only (discovery) or not management guidance.
 * PERIOD_UNCLEAR  the period is not confirmed (dominates every state above).
 */
export function verificationStateOf(i: GuStateIn): { state: GuVerificationState; reason: string } {
  if (i.claimType !== 'MANAGEMENT_GUIDANCE') return { state: 'UNVERIFIED', reason: 'Not management guidance.' };
  if (i.periodStatus !== 'CONFIRMED') return { state: 'PERIOD_UNCLEAR', reason: i.periodStatus === 'UNCLEAR' ? 'The period year is not stated, so the period is unclear.' : 'The period is not stated.' };
  if (!canVerify(i.tier)) return { state: 'UNVERIFIED', reason: 'Only media or another secondary source backs this. It can discover a claim but cannot verify it.' };
  if (!i.primarySourceFound) return { state: 'UNVERIFIED', reason: 'No primary source was found.' };
  if (!i.primarySourceRead || !i.hasEvidence) return { state: 'PARTIAL', reason: 'A primary source exists but its text has not been read.' };
  if (i.growthType === 'EXPLICIT') return i.needsReview ? { state: 'PARTIAL', reason: 'The primary source states the figure but the record is flagged for review.' } : { state: 'VERIFIED', reason: 'The primary source states company, metric, period, value and the growth %.' };
  if (i.growthType === 'DERIVED') return { state: 'DERIVED', reason: 'The primary source gives the amounts; the growth % was calculated by the system.' };
  return { state: 'PARTIAL', reason: i.growthType === 'IMPLIED' ? 'The growth % is inferred without a sourced base.' : 'The primary source gives no growth %.' };
}
export const daysBetween = (isoA: string | null | undefined, now: Date): number | null => {
  const t = isoA ? Date.parse(isoA) : NaN; return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : null;
};
export const isStale = (days: number | null): boolean => days != null && days > STALE_VERIFICATION_DAYS;

// ═══ source conflict ════════════════════════════════════════════════════════════════════════════
export function sameValue(a: { low: number | null; high: number | null; abs: { value: number; valueLow?: number } | null }, b: { low: number | null; high: number | null; abs: { value: number; valueLow?: number } | null }): boolean {
  const ea = (x: number | null, y: number | null) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 0.05);
  const absA = a.abs ? [a.abs.valueLow ?? a.abs.value, a.abs.value] : null, absB = b.abs ? [b.abs.valueLow ?? b.abs.value, b.abs.value] : null;
  if (absA && absB) return ea(absA[0], absB[0]) && ea(absA[1], absB[1]);
  if (a.low != null && b.low != null) return ea(a.low, b.low) && ea(a.high ?? a.low, b.high ?? b.low);
  return false;
}
