// zzz880 — FOCUS LIST: "which companies do I look at first?" at the top of the guidance page (Rishi: "give me a summary so I know easily
// which company I need to focus on"). Two signals the page already holds, joined per company:
//   • RAISED   — a verified formal guidance upgrade in the chosen window (old and new figures from the company's own document);
//   • GROWTH   — active guidance of 30% or more growth (verified or derived from the company's own numbers).
// A company with both comes first. Every row says in plain words what happened and why it is on the list. Pure: no fetch, no React.
import type { GuidanceEvent } from './guidance-upgrades-types';
import type { GuHighGrowthGroups, GuHgGroupRow } from './guidance-universe-types';

export type FocusVerdict = 'TOP FOCUS' | 'STRONG RAISE' | 'HIGH GROWTH' | 'RAISED' | 'WATCH';
export interface FocusRow {
  key: string; company: string; ticker: string | null; market: 'IN' | 'US';
  raised: string | null; raisePct: number | null; raiseDate: string | null; eventId: string | null;
  growth: string | null; growthPct: number | null; growthPeriod: string | null; growthTrust: string | null;
  verdict: FocusVerdict; why: string; score: number;
  /** zzz881: date of the growth guidance document (growth-only rows) */ growthDate?: string | null; growthSource?: string | null;
  /** zzz881: the raise is real but small (under 5%) or only a small-base EPS */ smallRaise?: boolean;
  /** zzz882: the raise is a growth rate (percentage points); raisePct is then the relative rise of the guided growth */ raisePp?: boolean;
  /** zzz880: 'SMALL_MID' / 'LARGE' from a market cap or the large-cap list; null when not known */
  size: 'SMALL_MID' | 'LARGE' | null; capText: string | null;
}
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
const keyOf = (market: string, ticker: string | null | undefined, company: string) =>
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
export function raiseLine(e: GuidanceEvent): { text: string; pct: number | null; smallBaseOnly: boolean; pp: boolean } | null {
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
  const smallNote = !small ? '' : isSmallEpsBase(c) ? ` — from a small base of ${c.before?.currency || ''}${num(c.before?.midpoint) ?? '?'} a share` : ' — only the low end moved, or it started from zero';
  return {
    text: `${c.after.period || ''} ${METRIC_WORD[c.metric] || String(c.metric).toLowerCase()}: ${rangeText(c.before)} → ${rangeText(c.after)}${sign}${smallNote}${more}`.trim(),
    // zzz882: a growth-rate raise (25–30% → 40–50%, +17.5 pp) is sized by how much the guided growth itself rose (27.5 → 45 = +64%),
    // so India raises given as growth rates rank next to US raises given in dollars instead of sinking to the bottom
    pct: small ? null : isPp ? relMid(c) : pct, smallBaseOnly: small, pp: isPp,
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
    r.raised = l.text; r.raisePct = l.pct; r.raisePp = l.pp; r.smallRaise = l.smallBaseOnly || (l.pct != null && l.pct < 5); r.raiseDate = e.announcement_date; r.eventId = e.guidance_event_id;
  }
  const rows: GuHgGroupRow[] = groups ? [...(groups.cohorts?.ANNUAL || []), ...(groups.cohorts?.MULTI_YEAR_CAGR || [])] : [];
  for (const g of rows) {
    if (g.trust !== 'verified' && g.trust !== 'derived') continue;
    const v = num(g.headline?.compareValue); if (v == null) continue;
    const r = get(g.market === 'US' ? 'US' : 'IN', g.ticker, g.company);
    if (r.growthPct != null && r.growthPct >= v) continue;
    r.growth = g.cohort === 'MULTI_YEAR_CAGR' && !/CAGR/i.test(g.text) ? `${g.text} a year (multi-year)` : g.text; r.growthPct = v; r.growthPeriod = g.headline?.period || null; r.growthTrust = g.trust; r.growthDate = g.sourceDate || null; r.growthSource = g.sourceName || null;
  }
  const out = Array.from(by.values());
  for (const r of out) {
    const days = r.raiseDate ? Math.max(0, Math.round((now.getTime() - Date.parse(`${r.raiseDate}T00:00:00Z`)) / DAY)) : null;
    const g = Math.min(100, r.growthPct ?? 0), p = Math.min(60, Math.max(0, r.raisePct ?? 0));
    // zzz880: a raise of under 5% (Kestra +2.9%) is real but small: it never makes a name TOP FOCUS on its own
    const meaningful = !!r.raised && !r.smallRaise;
    r.score = g + p + (meaningful && r.growth ? 60 : 0) + (days != null ? (days <= 14 ? 20 : days <= 45 ? 10 : 0) : 0) + (r.growthTrust === 'verified' || r.raised ? 10 : 0);
    if (meaningful && r.growth) { r.verdict = 'TOP FOCUS'; r.why = `Raised its guidance and guides ${r.growthPct}%+ growth — both signals`; }
    else if (r.raised && (r.raisePct ?? 0) >= 15) { r.verdict = 'STRONG RAISE'; r.why = r.raisePp ? `Guided growth rate raised a lot (about ${Math.round(r.raisePct!)}% higher than before) — checked in the company's own filing` : `Guidance raised by ${Math.round(r.raisePct!)}% — a large upgrade, checked in the company's own filing`; }
    else if (r.raised && r.growth) { r.verdict = 'HIGH GROWTH'; r.why = `Guides ${r.growthPct}% growth; also a small guidance raise (${Math.round((r.raisePct ?? 0) * 10) / 10}%)`; }
    else if (r.growth && (r.growthPct ?? 0) >= 50) { r.verdict = 'HIGH GROWTH'; r.why = `Guides ${r.growthPct}% growth${r.growthTrust === 'derived' ? ' (worked out from the company’s own numbers)' : ''}`; }
    else if (r.raised) { r.verdict = r.smallRaise ? 'WATCH' : 'RAISED'; r.why = r.smallRaise ? 'Small raise (under 5%, or only EPS from a small base) — real, but not a strong signal' : 'Guidance raised, checked in the company’s own filing'; }
    else { r.verdict = 'WATCH'; r.why = `Guides ${r.growthPct}% growth`; }
  }
  return out.sort((a, b) => b.score - a.score || a.company.localeCompare(b.company)).slice(0, limit);
}
