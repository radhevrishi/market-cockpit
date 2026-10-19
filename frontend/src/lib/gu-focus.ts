// zzz880 — FOCUS LIST: "which companies do I look at first?" at the top of the guidance page (Rishi: "give me a summary so I know easily
// which company I need to focus on"). Two signals the page already holds, joined per company:
//   • RAISED   — a verified formal guidance upgrade in the chosen window (old and new figures from the company's own document);
//   • GROWTH   — active guidance of 30% or more growth (verified or derived from the company's own numbers).
// A company with both comes first. Every row says in plain words what happened and why it is on the list. Pure: no fetch, no React.
import { metricLabelOf, METRIC_LABEL } from './guidance-upgrades-format';   // zzz1117
import type { GuMetric } from './guidance-upgrades-types';
import type { GuidanceEvent } from './guidance-upgrades-types';
import type { GuHighGrowthGroups, GuHgGroupRow } from './guidance-universe-types';

export type FocusVerdict = 'TOP FOCUS' | 'STRONG RAISE' | 'HIGH GROWTH' | 'RAISED' | 'WATCH';
export interface FocusRow {
  key: string; company: string; ticker: string | null; market: 'IN' | 'US';
  raised: string | null; raisePct: number | null; raiseDate: string | null; eventId: string | null;
  growth: string | null; growthPct: number | null; growthPeriod: string | null; growthTrust: string | null; /** zzz1122: "-5 pp" when this guidance is lower than the earlier one */ growthCutText?: string | null;
  verdict: FocusVerdict; why: string; score: number;
  /** zzz881: date of the growth guidance document (growth-only rows) */ growthDate?: string | null; growthSource?: string | null; growthSourceUrl?: string | null; growthFreshness?: string | null; growthVerifiedDaysAgo?: number | null;
  /** zzz881: the raise is real but small (under 5%) or only a small-base EPS */ smallRaise?: boolean;
  /** zzz882: the raise is a growth rate (percentage points); raisePct is then the relative rise of the guided growth */ raisePp?: boolean;
  /** zzz895: the size of a growth-rate raise in percentage points (10% → 12–15% = +3.5 pp) */ raisePpDelta?: number | null;
  /** zzz880: 'SMALL_MID' / 'LARGE' from a market cap or the large-cap list; null when not known */
  size: 'SMALL_MID' | 'LARGE' | null; capText: string | null;
  /** zzz923: the guided metric(s) and cohort of the growth row, and a verified guidance cut in the window (for the Sky Gold score) */
  growthMetric?: string | null; growthMetrics?: string[]; growthCohort?: string | null; cutDate?: string | null;
  /** zzz925: how the headline growth was obtained ('EXPLICIT' = stated by the company) and, for a worked-out growth, the amounts it came from */
  growthType?: string | null; growthDerivation?: { previousValue: number; currentLow: number; currentHigh: number; unit: string; basePeriod: string } | null;
  /** zzz929: the old → new figures of the headline raise (metric, period, midpoints) — for the implied-profit change; null when the row has no raise */
  raiseDetail?: RaiseDetail | null;
}
export interface RaiseDetail { metric: string; period: string; beforeMid: number | null; afterMid: number | null; isGrowthRate: boolean; unit: string | null; currency: string | null; periodKind: string | null; periodYears: number | null }
export interface FocusSizeIn { caps?: { IN?: Record<string, number>; US?: Record<string, number> } | null; indiaLarge?: ReadonlySet<string> }
/** India large cap from ₹30,000 Cr; US from $30B (Rishi's US default band). */
export function sizeOf(market: 'IN' | 'US', ticker: string | null, s: FocusSizeIn | undefined): { size: FocusRow['size']; capText: string | null } {
  const t = (ticker || '').toUpperCase();
  const cap = t ? s?.caps?.[market]?.[t] : undefined;
  if (typeof cap === 'number' && cap > 0) {
    if (market === 'IN') return { size: cap >= 30_000 ? 'LARGE' : 'SMALL_MID', capText: `₹${Math.round(cap).toLocaleString('en-IN')} Cr` };
    return { size: cap >= 30_000 ? 'LARGE' : 'SMALL_MID', capText: cap >= 1000 ? `$${(cap / 1000).toFixed(1)}B` : `$${Math.round(cap)}M` };
  }
  if (market === 'IN' && t && s?.indiaLarge?.has(t)) return { size: 'LARGE', capText: 'large cap' };
  return { size: null, capText: null };
}

const DAY = 86_400_000;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const keyOf = (market: string, ticker: string | null | undefined, company: string) =>
  `${market === 'US' ? 'US' : 'IN'}|${(ticker || '').toUpperCase() || company.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
const METRIC_WORD: Record<string, string> = {
  REVENUE: 'revenue', REVENUE_GROWTH: 'revenue growth', EBITDA: 'EBITDA', EBIT: 'operating profit', OP_MARGIN: 'operating margin',
  EPS: 'EPS', ADJ_EPS: 'adjusted EPS', NET_PROFIT: 'net profit', FCF: 'free cash flow', ORGANIC_GROWTH: 'organic growth',
};
function fmtVal(v: number | null | undefined, unit?: string, currency?: string, rate?: boolean): string {
  if (v == null || !Number.isFinite(v)) return '?';
  const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100);
  if (rate) return `${n}%`;
  return `${currency || ''}${n}${unit && unit !== '%' ? ` ${unit}` : ''}`;
}
function rangeText(p: any): string {
  if (!p) return '?';
  const lo = num(p.low) ?? num(p.midpoint), hi = num(p.high) ?? num(p.midpoint);
  const a = fmtVal(lo, p.unit, p.currency, p.isGrowthRate), b = fmtVal(hi, p.unit, p.currency, p.isGrowthRate);
  return lo === hi ? a : `${a}–${b}`;
}

/** zzz881: an EPS whose old midpoint is under $1 (US) or ₹5 (India) a share: a % from that base looks huge (Rubrik $0.30 → $0.50 = +67%)
 *  while revenue moved +2.8%. Such a figure is shown, but never sets how strong the raise is. */
export function isSmallEpsBase(c: any): boolean {
  if (c?.metric !== 'EPS' && c?.metric !== 'ADJ_EPS') return false;
  const m = num(c?.before?.midpoint) ?? num(c?.before?.low);
  if (m == null) return false;
  const lim = /₹|INR|Rs/i.test(String(c?.before?.currency || c?.after?.currency || '')) ? 5 : 1;
  return Math.abs(m) < lim;
}
/** The headline raise of one verified upgrade event, in words: 'FY27 revenue ₹250 Cr → ₹275 Cr (+10%)'.
 *  zzz881: the headline is the raise that best shows the business moved — revenue / profit first; an EPS from a small base is shown
 *  last and never counts as the size of the raise. `pct` is that size (null when only a small-base EPS or a pp change was raised). */
function relMid(c: any): number | null {
  const b = num(c?.before?.midpoint), a = num(c?.after?.midpoint);
  return b != null && a != null && b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null;
}
export function raiseLine(e: GuidanceEvent): { text: string; pct: number | null; smallBaseOnly: boolean; pp: boolean; ppDelta: number | null; detail: RaiseDetail } | null {
  const ups = (e.changes || []).filter((c: any) => c?.direction === 'UP' && c?.before && c?.after);
  if (!ups.length) return null;
  const pctOf = (c: any) => num(c.percentageChange) ?? num(c.percentagePointChange);
  // zzz881: only the floor moved (top end the same, Planet Labs EBITDA $0–10M → $3–10M) or the old figure started at zero: not a strong raise
  const weak = (c: any) => isSmallEpsBase(c) || (num(c.before?.high) != null && num(c.before?.high) === num(c.after?.high)) || (num(c.before?.low) != null && (num(c.before?.low) as number) <= 0);
  const strength = (c: any): number => (weak(c) ? -1 : num(c.percentageChange) ?? (num(c.percentagePointChange) != null ? relMid(c) ?? 0 : -1));
  const c: any = ups.slice().sort((a: any, b: any) => strength(b) - strength(a) || (pctOf(b) ?? 0) - (pctOf(a) ?? 0))[0];
  const pct = pctOf(c);
  const isPp = num(c.percentageChange) == null && num(c.percentagePointChange) != null;
  const small = weak(c);
  const sign = pct == null ? '' : ` (${pct >= 0 ? '+' : ''}${Math.round(pct * 10) / 10}${isPp ? ' pp' : '%'})`;
  const others = ups.filter((u: any) => u !== c);
  const smallOther = others.find((u: any) => isSmallEpsBase(u));
  const more = others.length ? ` + ${others.length} more${smallOther ? ` (incl. EPS +${Math.round(pctOf(smallOther) ?? 0)}% from a small base)` : ''}` : '';
  const mWord = (() => { const l = metricLabelOf({ metric: c.metric, raw: c.after?.raw }); const base = METRIC_WORD[c.metric] || String(c.metric).toLowerCase(); return l === 'Other' || l === METRIC_LABEL[c.metric as GuMetric] ? base : l.charAt(0).toLowerCase() + l.slice(1); })();
  const smallNote = !small ? '' : isSmallEpsBase(c) ? ` — from a small base of ${c.before?.currency || ''}${num(c.before?.midpoint) ?? '?'} a share` : ' — only the low end moved, or it started from zero';
  return {
    // zzz895: a % figure for a money metric is a growth rate — say so ('net profit growth', not 'net profit')
    // zzz1117 (G05) — the measure's own words ("core revenue", an "other" measure's name) instead of a bare "other"
    text: `${c.after.period || ''} ${mWord}${isPp && !/growth|margin/i.test(mWord) ? ' growth' : ''}: ${rangeText(c.before)} → ${rangeText(c.after)}${sign}${smallNote}${more}`.trim(),
    // zzz882: a growth-rate raise (25–30% → 40–50%, +17.5 pp) is sized by how much the guided growth itself rose (27.5 → 45 = +64%),
    // so India raises given as growth rates rank next to US raises given in dollars instead of sinking to the bottom
    pct: small ? null : isPp ? relMid(c) : pct, smallBaseOnly: small, pp: isPp, ppDelta: isPp ? pct : null,
    detail: { metric: String(c.metric), period: String(c.after.period || ''), beforeMid: num(c.before?.midpoint), afterMid: num(c.after?.midpoint), isGrowthRate: !!c.after.isGrowthRate, unit: c.after.unit ?? null, currency: c.after.currency ?? null,
      periodKind: c.after.periodKind ?? null, periodYears: num(c.after.periodYears) },
  };
}

const isShownUpgrade = (e: GuidanceEvent) => e.verification === 'VERIFIED' && e.taxonomy === 'formal_upgrade' && (!e.pipeline || e.pipeline.status === 'CARD');

export function buildFocusList(groups: GuHighGrowthGroups | null | undefined, events: readonly GuidanceEvent[] | null | undefined, now: Date, limit = 15, sizeIn?: FocusSizeIn): FocusRow[] {
  const by = new Map<string, FocusRow>();
  const get = (market: 'IN' | 'US', ticker: string | null, company: string) => {
    const k = keyOf(market, ticker, company);
    let r = by.get(k);
    if (!r) { r = { key: k, company, ticker, market, raised: null, raisePct: null, raiseDate: null, eventId: null, growth: null, growthPct: null, growthPeriod: null, growthTrust: null, verdict: 'WATCH', why: '', score: 0, ...sizeOf(market, ticker, sizeIn) }; by.set(k, r); }
    return r;
  };
  for (const e of events || []) {
    if (!isShownUpgrade(e)) continue;
    const l = raiseLine(e); if (!l) continue;
    const r = get(e.market === 'US' ? 'US' : 'IN', e.ticker || null, e.company || e.ticker);
    if (r.raiseDate && r.raiseDate >= e.announcement_date) continue;   // the newest raise wins
    r.raised = l.text; r.raisePct = l.pct; r.raisePp = l.pp; r.raisePpDelta = l.ppDelta; r.smallRaise = l.smallBaseOnly || (l.pct != null && l.pct < 5); r.raiseDate = e.announcement_date; r.eventId = e.guidance_event_id; r.raiseDetail = l.detail;
  }
  const rows: GuHgGroupRow[] = groups ? [...(groups.cohorts?.ANNUAL || []), ...(groups.cohorts?.MULTI_YEAR_CAGR || [])] : [];
  for (const g of rows) {
    if (g.trust !== 'verified' && g.trust !== 'derived') continue;
    const v = num(g.headline?.compareValue); if (v == null) continue;
    const r = get(g.market === 'US' ? 'US' : 'IN', g.ticker, g.company);
    if (r.growthPct != null && r.growthPct >= v) continue;
    r.growth = g.cohort === 'MULTI_YEAR_CAGR' && !/CAGR/i.test(g.text) ? `${g.text} a year (multi-year)` : g.text; r.growthPct = v; r.growthPeriod = g.headline?.period || null; r.growthTrust = g.trust; r.growthDate = g.sourceDate || null; r.growthSource = g.sourceName || null; r.growthSourceUrl = g.sourceUrl || null; r.growthFreshness = g.headline.freshness ?? null; r.growthVerifiedDaysAgo = g.headline.lastVerifiedDaysAgo ?? null;
    r.growthMetric = (g.headline as any)?.metric ?? null; r.growthCohort = g.cohort ?? null;
    r.growthType = (g.headline as any)?.growthType ?? null; r.growthDerivation = (g.headline as any)?.derivation ?? null;
    { const rv = String((g.headline as any)?.revisionVsPriorGuidance || ''); r.growthCutText = /^\s*-|\b(?:lower|cut|reduced)\b/i.test(rv) ? rv.replace(/\s*vs prior guidance\s*/i, '').trim() || 'cut' : null; }
    r.growthMetrics = Array.from(new Set([...(g.metrics || []).map((m: any) => String(m?.metric || '')), String((g.headline as any)?.metric || '')].filter(Boolean)));
  }
  // zzz923: a verified guidance cut in the same window is a red flag on a row already listed (it never adds a row)
  for (const e of events || []) {
    if (e.verification !== 'VERIFIED' || e.taxonomy !== 'downgrade') continue;
    const r = by.get(keyOf(e.market === 'US' ? 'US' : 'IN', e.ticker || null, e.company || e.ticker));
    if (r && (!r.cutDate || r.cutDate < e.announcement_date)) r.cutDate = e.announcement_date;
  }
  const out = Array.from(by.values());
  for (const r of out) {
    const days = r.raiseDate ? Math.max(0, Math.round((now.getTime() - Date.parse(`${r.raiseDate}T00:00:00Z`)) / DAY)) : null;
    const g = Math.min(100, r.growthPct ?? 0), p = Math.min(60, Math.max(0, r.raisePct ?? 0));
    // zzz880: a raise of under 5% (Kestra +2.9%) is real but small: it never makes a name TOP FOCUS on its own
    const meaningful = !!r.raised && !r.smallRaise;
    r.score = g + p + (meaningful && r.growth ? 60 : 0) + (days != null ? (days <= 14 ? 20 : days <= 45 ? 10 : 0) : 0) + (r.growthTrust === 'verified' || r.raised ? 10 : 0);
    if (meaningful && r.growth) { r.verdict = 'TOP FOCUS'; r.why = `Raised its guidance and guides ${r.growthPct}%+ growth — both signals`; }
    // zzz895: a growth-rate raise is STRONG only when the guided growth moved 5+ points (Kfin 10% → 12–15%, +3.5 pp, is a raise, not a strong one)
    else if (r.raised && (r.raisePct ?? 0) >= 15 && (!r.raisePp || (r.raisePpDelta ?? 0) >= 5)) { r.verdict = 'STRONG RAISE'; r.why = r.raisePp ? `Guided growth rate raised a lot (up ${Math.round((r.raisePpDelta ?? 0) * 10) / 10} points) — checked in the company's own filing` : `Guidance raised by ${Math.round(r.raisePct!)}% — a large upgrade, checked in the company's own filing`; }
    else if (r.raised && r.growth) { r.verdict = 'HIGH GROWTH'; r.why = `Guides ${r.growthPct}% growth; also a small guidance raise (${Math.round((r.raisePct ?? 0) * 10) / 10}%)`; }
    else if (r.growth && (r.growthPct ?? 0) >= 50) { r.verdict = 'HIGH GROWTH'; r.why = growthWhy(r); }
    else if (r.raised) { r.verdict = r.smallRaise ? 'WATCH' : 'RAISED'; r.why = r.smallRaise ? 'Small raise (under 5%, or only EPS from a small base) — real, but not a strong signal' : 'Guidance raised, checked in the company’s own filing'; }
    else { r.verdict = 'WATCH'; r.why = growthWhy(r); }
    // zzz1122 — a guidance that is LOWER than the company's earlier guidance says so (Piccadily: +60%, 5 points below its earlier guide)
    if (r.growthCutText && r.growth) r.why = `${r.why} — lower than its earlier guidance (${r.growthCutText})`;
  }
  return out.sort((a, b) => b.score - a.score || a.company.localeCompare(b.company)).slice(0, limit);
}

/** zzz1122 — "Guides 134.1% growth" for a growth WE worked out read as a company target: a derived growth says "implied". */
function growthWhy(r: FocusRow): string {
  return r.growthTrust === 'derived' || r.growthType === 'DERIVED'
    ? `Implied ${r.growthPct}% growth — worked out from the company’s own numbers, not a stated target`
    : `Guides ${r.growthPct}% growth`;
}

// ── zzz925: a worked-out revenue growth must agree with the revenue the company actually reports ─────────────────────────
// Pinnacle West (a utility) showed "Revenue +187–192% (derived)": $5.56–5.66B guided against a "FY25 actual" of $1.94B, while the
// company's reported yearly revenue is about $5.8B — the base was a part-year figure. A derived growth whose base is far below the
// reported yearly revenue (or whose target is not far above it while the growth claims a big jump) is held back for review, not shown.
/** Amount in the unit the company facts use (India ₹ Cr, USA $M); null when the unit cannot be placed. */
export function toFactsUnit(v: number, unit: string, market: 'IN' | 'US'): number | null {
  const u = String(unit || '').replace(/\s+/g, ' ').trim();
  if (market === 'IN') return /^₹ ?Cr$/i.test(u) ? v : null;
  if (/^\$ ?B$/i.test(u)) return v * 1000;
  if (/^\$ ?M$/i.test(u)) return v;
  return null;
}
export interface GrowthHold { key: string; company: string; ticker: string | null; market: 'IN' | 'US'; growth: string; reason: string }
/** Pure: why a row's guided growth disagrees with the reported yearly revenue (null = fine or not checkable). `salesBase` = the latest
 *  full year's revenue (India) or the latest quarter × 4 (USA), in the facts unit. */
export function derivedGrowthIssue(r: Pick<FocusRow, 'market' | 'growthPct' | 'growthType' | 'growthTrust' | 'growthMetric' | 'growthDerivation'>, salesBase: number | null | undefined): string | null {
  const d = r.growthDerivation;
  if (!d || r.growthMetric !== 'REVENUE' || (r.growthType !== 'DERIVED' && r.growthTrust !== 'derived')) return null;
  if (typeof salesBase !== 'number' || !Number.isFinite(salesBase) || salesBase <= 0) return null;
  const base = toFactsUnit(d.previousValue, d.unit, r.market), lo = toFactsUnit(d.currentLow, d.unit, r.market), hi = toFactsUnit(d.currentHigh, d.unit, r.market);
  if (base == null || lo == null || hi == null) return null;
  const fmt = (v: number) => (r.market === 'IN' ? `₹${Math.round(v).toLocaleString('en-IN')} Cr` : v >= 1000 ? `$${(v / 1000).toFixed(2)}B` : `$${Math.round(v)}M`);
  const vsReported = ((lo + hi) / 2 / salesBase - 1) * 100;
  if (base < 0.5 * salesBase) return `worked out from a base of ${fmt(base)} for ${d.basePeriod}, but the company reports yearly revenue of about ${fmt(salesBase)} — the base looks like a part of the year; against reported revenue the target is ${vsReported >= 0 ? '+' : ''}${Math.round(vsReported)}%`;
  if ((r.growthPct ?? 0) >= 100 && vsReported < 0.5 * (r.growthPct ?? 0)) return `a ${r.growthPct}% jump worked out from company numbers, but the target is only ${vsReported >= 0 ? '+' : ''}${Math.round(vsReported)}% above the yearly revenue the company reports (${fmt(salesBase)})`;
  return null;
}
/** Pure: rows with a growth that fails the check lose that growth (a row with a raise stays, on its raise only); the held rows are listed. */
export function holdInconsistentGrowth(rows: FocusRow[], salesBaseOf: (r: FocusRow) => number | null | undefined): { rows: FocusRow[]; held: GrowthHold[] } {
  const held: GrowthHold[] = [];
  const out: FocusRow[] = [];
  for (const r of rows) {
    const why = r.growth ? derivedGrowthIssue(r, salesBaseOf(r)) : null;
    if (!why) { out.push(r); continue; }
    held.push({ key: r.key, company: r.company, ticker: r.ticker, market: r.market, growth: r.growth!, reason: why });
    if (r.raised) out.push({ ...r, growth: null, growthPct: null, growthPeriod: null, growthTrust: null, growthType: null, growthDerivation: null,
      verdict: r.smallRaise ? 'WATCH' : r.verdict === 'TOP FOCUS' ? 'RAISED' : r.verdict, why: r.verdict === 'TOP FOCUS' || r.verdict === 'HIGH GROWTH' ? (r.smallRaise ? 'Small raise (under 5%, or only EPS from a small base) — real, but not a strong signal' : 'Guidance raised, checked in the company’s own filing') : r.why });
  }
  return { rows: out, held };
}

/** Select the growth horizon before merging companies, so an annual target is not lost to a larger CAGR. Raises are unaffected. */
export function focusGrowthHorizon(groups: GuHighGrowthGroups | null | undefined, horizon: 'ALL' | 'ANNUAL' | 'MULTI_YEAR_CAGR'): GuHighGrowthGroups | null | undefined {
  if (!groups?.cohorts || horizon === 'ALL') return groups;
  return { ...groups, cohorts: { ...groups.cohorts, ANNUAL: horizon === 'ANNUAL' ? groups.cohorts.ANNUAL : [], MULTI_YEAR_CAGR: horizon === 'MULTI_YEAR_CAGR' ? groups.cohorts.MULTI_YEAR_CAGR : [] } };
}
