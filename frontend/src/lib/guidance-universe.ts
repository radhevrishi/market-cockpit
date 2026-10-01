// zzz848 — GUIDANCE UNIVERSE (Layer A): persistent, currently valid management guidance, independent of event recency.
// Pure module (no I/O). Inputs: live Growth Guidance companies, ledger entries, researched records (data file rows).
// Rules: never invent a number; unknown is not negative; no BUY/SELL; no composite score; every summary number is computed from the
// records (never hard-coded); a company is never named in logic; a range is shown as a range, never a midpoint.
//
// COUNTING RULE (documented choice): a revenue/PAT point counts toward the "30%+" numbers when
//   - it is VERIFIED or PARTIALLY_VERIFIED (media-only rows are listed and counted separately, never in the headline),
//   - it is an annual-style period (FY / CY / rolling 12 months). Multi-year CAGRs, quarters and half-years never count as "FY27 guidance",
//   - it is not a proxy for another measure (e.g. presales instead of revenue),
//   - its comparison value is >= threshold, where the comparison value is: the stated figure for a point, the MIDPOINT for a closed range
//     (the range itself is still displayed), and the LOWER BOUND for an open-ended "80%+" figure (no invented midpoint).
import type { GgCompany, GgGrowthOrigin, GgGuidancePoint, GgKind, GgLedgerRow, GgMetric, GgOrganic, GgPeriodKind, GgRevision, GgSourceRef, GgVerification } from './growth-guidance-types';
import type { GuHighGrowthHorizon, GuHighGrowthMetric, GuHighGrowthRowX, GuMarketSummary, GuPeriodStatus, GuRegressionResponse, GuRegressionRow, GuRegressionStatus, GuSummaryAdditions, GuUniverseBucket, GuUniverseRecord, GuUniverseRecordOrigin, GuUniverseSummary } from './guidance-universe-types';
import { buildCompanyIndex, normCompanyName } from './guidance-upgrades-candidates';
import { NSE_TICKER_NAMES } from './nse-ticker-names';
import { endOfPeriodLabel, qualityOf, revisionOf, type GgStoredEntry } from './growth-guidance';

export const GU_VERSION = 'zzz849-gu-v2';
const DAY = 86_400_000;
const METRICS: GgMetric[] = ['REVENUE', 'PAT', 'EPS', 'EBITDA', 'FCF'];
const METRIC_WORD: Record<GgMetric, string> = { REVENUE: 'revenue', PAT: 'PAT', EPS: 'EPS', EBITDA: 'EBITDA', FCF: 'FCF' };
const PKINDS: GgPeriodKind[] = ['FY', 'CY', 'QUARTER', 'HALF', 'ROLLING_12M', 'MULTI_YEAR_CAGR', 'UNKNOWN'];
const VERIFS: GgVerification[] = ['VERIFIED', 'PARTIALLY_VERIFIED', 'SECONDARY_ONLY', 'UNVERIFIED'];
const KINDS: GgKind[] = ['MANAGEMENT_GUIDANCE', 'MANAGEMENT_TARGET', 'MANAGEMENT_COMMENTARY', 'ANALYST_CONSENSUS', 'ANALYST_ESTIMATE', 'HISTORICAL_TRAJECTORY', 'INFERENCE'];
const ORGANICS: GgOrganic[] = ['ORGANIC', 'ACQUISITION_LED', 'MIXED', 'UNKNOWN'];
const isMgmt = (k: GgKind) => k.startsWith('MANAGEMENT_');
const r1 = (n: number) => Math.round(n * 10) / 10;
const fnum = (n: number) => String(r1(n));
const hash = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

// ═══ seed rows (researched records held as data) ═══════════════════════════════════════════════
export interface GuSeedPrior { date: string; growthLow: number | null; growthHigh: number | null; note: string }
export interface GuSeedRow {
  company: string; ticker: string | null; market: 'IN' | 'US'; metric: GgMetric;
  growthLow: number | null; growthHigh: number | null; growthOrigin: GgGrowthOrigin; absoluteTarget: { value: number; unit: string; valueLow?: number } | null;
  period: string; periodKind: GgPeriodKind; kind: GgKind; organic: GgOrganic; statement: string; driver: string | null; mechanisms: string[];
  sourceName: string; sourceType: string; sourceUrl: string | null; sourceDate: string | null; sourceRank: number; verification: GgVerification;
  priorGuidance: GuSeedPrior[]; supersededBy: string | null; notes: string; ownerListText: string | null;
  /** zzz849: the SOURCED base an implied growth % was divided by, e.g. { value: 357.71, unit: '₹ Cr', period: 'FY26' }. Absent = base not sourced. */
  impliedBase?: { value: number; unit: string; period: string } | null;
  /** zzz849: why a researcher flagged this row (ambiguous base, conflicting sources). Flagged rows stay listed but are never counted as high-growth. */
  needsReview?: string | null;
}
const numOrNull = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isoDay = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
/** Validates researched rows. Malformed rows are dropped (with a reason), never thrown. Accepts an array or `{ rows: [...] }`. */
export function loadSeedRows(raw: unknown): { rows: GuSeedRow[]; dropped: Array<{ index: number; reason: string }> } {
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.rows) ? (raw as any).rows : [];
  const rows: GuSeedRow[] = []; const dropped: Array<{ index: number; reason: string }> = [];
  list.forEach((x: any, index) => {
    const bad = (reason: string) => { dropped.push({ index, reason }); };
    if (!x || typeof x !== 'object') return bad('not an object');
    if (typeof x.company !== 'string' || !x.company.trim()) return bad('no company');
    if (x.market !== 'IN' && x.market !== 'US') return bad('market must be IN or US');
    if (!METRICS.includes(x.metric)) return bad('unknown metric');
    if (typeof x.period !== 'string' || !x.period.trim()) return bad('no period');
    const pk = x.periodKind === undefined ? 'UNKNOWN' : x.periodKind; if (!PKINDS.includes(pk)) return bad('unknown periodKind');
    if (!VERIFS.includes(x.verification)) return bad('unknown verification');
    if (!KINDS.includes(x.kind)) return bad('unknown kind');
    const lo = numOrNull(x.growthLow), hi = numOrNull(x.growthHigh); if (lo === undefined || hi === undefined) return bad('growth is not a number');
    if (lo != null && hi != null && lo > hi) return bad('growthLow above growthHigh');
    const abs = x.absoluteTarget && typeof x.absoluteTarget === 'object' && typeof x.absoluteTarget.value === 'number' && Number.isFinite(x.absoluteTarget.value)
      ? { value: x.absoluteTarget.value, unit: String(x.absoluteTarget.unit || ''), ...(typeof x.absoluteTarget.valueLow === 'number' && Number.isFinite(x.absoluteTarget.valueLow) && x.absoluteTarget.valueLow < x.absoluteTarget.value ? { valueLow: x.absoluteTarget.valueLow } : {}) } : null;
    if (lo == null && hi == null && !abs) return bad('no number at all');
    if (hi != null && lo == null) return bad('growthHigh without growthLow');
    const rank = x.sourceRank; if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > 12) return bad('sourceRank must be 1..12');
    const sd = isoDay(x.sourceDate); if (sd === undefined) return bad('bad sourceDate');
    const ib = x.impliedBase && typeof x.impliedBase === 'object' && typeof x.impliedBase.value === 'number' && Number.isFinite(x.impliedBase.value) && x.impliedBase.value > 0 && typeof x.impliedBase.period === 'string' && x.impliedBase.period.trim()
      ? { value: x.impliedBase.value as number, unit: String(x.impliedBase.unit || ''), period: String(x.impliedBase.period).trim() } : null;
    const url = typeof x.sourceUrl === 'string' && /^https?:\/\//i.test(x.sourceUrl) ? x.sourceUrl : null;
    const priors: GuSeedPrior[] = (Array.isArray(x.priorGuidance) ? x.priorGuidance : []).map((p: any) => ({ date: isoDay(p?.date) || '', growthLow: numOrNull(p?.growthLow) ?? null, growthHigh: numOrNull(p?.growthHigh) ?? null, note: String(p?.note || '') })).filter((p: GuSeedPrior) => p.date);
    rows.push({
      company: x.company.trim(), ticker: typeof x.ticker === 'string' && x.ticker.trim() ? x.ticker.trim().toUpperCase().replace(/\.(NS|BO)$/, '') : null, market: x.market, metric: x.metric,
      growthLow: lo ?? null, growthHigh: hi ?? null, growthOrigin: x.growthOrigin === 'IMPLIED' ? 'IMPLIED' : 'STATED', absoluteTarget: abs,
      period: x.period.trim(), periodKind: pk, kind: x.kind, organic: ORGANICS.includes(x.organic) ? x.organic : 'UNKNOWN', statement: String(x.statement || ''), driver: typeof x.driver === 'string' && x.driver ? x.driver : null,
      mechanisms: Array.isArray(x.mechanisms) ? x.mechanisms.filter((m: unknown) => typeof m === 'string') : [], sourceName: String(x.sourceName || 'Source not named'), sourceType: String(x.sourceType || 'Media'),
      sourceUrl: url, sourceDate: sd ?? null, sourceRank: rank, verification: x.verification, priorGuidance: priors, supersededBy: typeof x.supersededBy === 'string' ? x.supersededBy : null,
      notes: String(x.notes || ''), ownerListText: typeof x.ownerListText === 'string' && x.ownerListText.trim() ? x.ownerListText.trim() : null,
      impliedBase: ib, needsReview: typeof x.needsReview === 'string' && x.needsReview.trim() ? x.needsReview.trim() : null,
    });
  });
  return { rows, dropped };
}

// ═══ periods ═══════════════════════════════════════════════════════════════════════════════════
/** 'FY2027' -> 'FY27', 'FY27–29' -> 'FY27-29', 'cy2026' -> 'CY26'. Anything else is returned trimmed. */
export function normPeriod(p: string): string {
  let s = String(p || '').trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  s = s.replace(/^(fy|cy)\s?(\d{2,4})(?:-(\d{2,4}))?$/i, (_m, a: string, y: string, z?: string) => `${a.toUpperCase()}${y.slice(-2)}${z ? `-${z.slice(-2)}` : ''}`);
  s = s.replace(/^(q[1-4]|h[12]) ?(fy|cy)\s?(\d{2,4})$/i, (_m, q: string, a: string, y: string) => `${q.toUpperCase()} ${a.toUpperCase()}${y.slice(-2)}`);
  return s;
}
/** End of a guidance period. Indian FY ends 31 Mar. US FY: the company's fiscal year end is not known here, so it is treated as 31 Dec of the named year and noted. Unknown -> null (active, noted). */
export function periodEnd(period: string, market: 'IN' | 'US', announced?: string | null): { end: Date | null; note: string | null } {
  const p = normPeriod(period);
  const end = endOfPeriodLabel(p, announced || new Date().toISOString(), market);
  if (!end) return { end: null, note: `Period end not known for "${period}", so it is kept active.` };
  return { end, note: market === 'US' && /^FY/.test(p) ? 'Fiscal year end not known, treated as 31 December of that year.' : null };
}

// ═══ period status (zzz849): ACTIVE / EXPIRED / UNKNOWN from the period text and the issue date ═════
/** A guided quarter or half is treated as expired only this long after it ends (results are reported with a lag). Annual periods have no lag. */
export const REPORTING_LAG_DAYS = 45;
export interface GuPeriodInfo { status: GuPeriodStatus; end: Date | null; /** the year was not in the text and was inferred from the issue date */ inferred: boolean; note: string | null; reason: string }
const utcD = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
/** Calendar end of quarter q (1-4) or half h (1-2) for a market: India reports on an April-March fiscal year, the US on calendar quarters unless the text says otherwise. */
const SHORT_END: Record<'IN' | 'US', { Q: Array<[number, number]>; H: Array<[number, number]> }> = {
  IN: { Q: [[5, 30], [8, 30], [11, 31], [2, 31]], H: [[8, 30], [2, 31]] },
  US: { Q: [[2, 31], [5, 30], [8, 30], [11, 31]], H: [[5, 30], [11, 31]] },
};
/**
 * Whether a guided period is still running, from the period text and the date the guidance was issued. Never invents a company fiscal calendar:
 *  - 'Q2 (year not stated)': the year is inferred as the first such quarter end on or after the issue date (calendar reading for the US, April-March for India), flagged `inferred`.
 *    No issue date -> UNKNOWN.
 *  - quarters and halves expire REPORTING_LAG_DAYS after they end; a US quarter labelled with a fiscal year gets a further quarter of tolerance because its fiscal calendar is not known.
 *  - India FY ends 31 March. A US 'FY2026' could end anywhere from mid-2026 to early 2027, so it is treated as running until 1 March of the next year (+lag) and noted.
 *  - anything that cannot be placed in time -> UNKNOWN (kept in the universe, never in the high-growth list).
 */
export function periodStatusOf(period: string, pkind: GgPeriodKind, market: 'IN' | 'US', issued: string | null | undefined, now: Date): GuPeriodInfo {
  const p = normPeriod(period); const t = now.getTime();
  const unknown = (reason: string, note = 'Period year not stated: the period end is not known, so it is kept in the universe but out of the high-growth list.'): GuPeriodInfo => ({ status: 'UNKNOWN', end: null, inferred: false, note, reason });
  const issuedMs = issued ? Date.parse(issued) : NaN;
  const yl = /^([QH])([1-4]) \(year not stated\)$/i.exec(p) || /^([QH])([1-4])$/i.exec(p);
  if (yl) {
    const kind = yl[1].toUpperCase() as 'Q' | 'H'; const n = parseInt(yl[2], 10);
    if (kind === 'H' && n > 2) return unknown(`${p} is not a half-year.`);
    if (!Number.isFinite(issuedMs)) return unknown(`${p}: no issue date, so the year cannot be inferred.`);
    const [m, d] = SHORT_END[market][kind][n - 1]; const iy = new Date(issuedMs).getUTCFullYear();
    let end: Date | null = null;
    for (const y of [iy - 1, iy, iy + 1]) { const c = utcD(y, m, d); if (c.getTime() >= issuedMs - DAY + 1 && (!end || c.getTime() < end.getTime())) end = c; }
    if (!end) return unknown('Quarter end could not be inferred.');
    const note = 'Year not stated; the quarter end is inferred from the issue date.';
    if (end.getTime() + REPORTING_LAG_DAYS * DAY < t) return { status: 'EXPIRED', end, inferred: true, note, reason: `The guided ${p.replace(/ \(year not stated\)/, '')} (year not stated, inferred to end ${end.toISOString().slice(0, 10)} from the ${new Date(issuedMs).toISOString().slice(0, 10)} issue date) has ended.` };
    return { status: 'ACTIVE', end, inferred: true, note, reason: '' };
  }
  if (pkind === 'UNKNOWN' || /^Period not stated$/i.test(p) || /not stated/i.test(p)) return unknown(`Period "${period}" is not stated.`);
  const end = endOfPeriodLabel(p, Number.isFinite(issuedMs) ? new Date(issuedMs).toISOString() : now.toISOString(), market);
  if (!end) return unknown(`Period "${period}" could not be placed in time.`);
  const isShort = pkind === 'QUARTER' || pkind === 'HALF' || /^[QH][1-4] /.test(p);
  let lag = isShort ? REPORTING_LAG_DAYS : 0; let note: string | null = null; let endAdj = end;
  if (market === 'US' && /^FY\d{2}/.test(p)) {
    endAdj = utcD(end.getUTCFullYear() + 1, 2, 1); lag = REPORTING_LAG_DAYS; note = 'US fiscal year end not known; treated as running until March of the following year.';
  } else if (market === 'US' && /^[QH][1-4] FY/.test(p)) { lag += /^H/.test(p) ? 183 : 92; note = 'US fiscal quarter end not known; calendar quarters assumed with a quarter of tolerance.'; }
  if (endAdj.getTime() + lag * DAY < t) return { status: 'EXPIRED', end: endAdj, inferred: false, note, reason: `The guided period (${p}) has ended.` };
  return { status: 'ACTIVE', end: endAdj, inferred: false, note, reason: '' };
}
const multiYears = (period: string, cumulativeYears?: number | null): number | null => {
  const m = /^FY(\d{2})-(\d{2})$/.exec(normPeriod(period)); if (m) { const n = parseInt(m[2], 10) - parseInt(m[1], 10) + 1; if (n > 1) return n; }
  return cumulativeYears && cumulativeYears > 1 ? cumulativeYears : null;
};

// ═══ display ═══════════════════════════════════════════════════════════════════════════════════
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Open-ended = only a lower bound is known: no upper number, or the source says 'at least / over / more than 60%' or '80%+'. */
export function isOpenEnded(low: number | null, high: number | null, statement: string): boolean {
  if (low == null) return false;
  if (high == null) return true;
  if (low !== high) return false;
  const n = esc(String(low));
  return new RegExp(`(?:at least|over|more than|above|in excess of|minimum of|upwards of)\\s+(?:about\\s+|around\\s+|roughly\\s+|~)?${n}\\s*%`, 'i').test(statement)
    || new RegExp(`\\b${n}\\s*%\\s*(?:\\+|plus(?! or minus)\\b|or more|and above)`, 'i').test(statement);
}
export interface GuDisplayIn { metric: GgMetric; low: number | null; high: number | null; open: boolean; origin: GgGrowthOrigin; periodKind: GgPeriodKind; period: string; abs: { value: number; unit: string; valueLow?: number } | null; cumulativeYears?: number | null; proxy?: string | null }
/** '+35' / '-19.8' (never '+-19.8'). */
const sg = (n: number) => `${n < 0 ? '-' : '+'}${fnum(Math.abs(n))}`;
/** Money amount as written in the data: '₹750 Cr', '$140M', '$1.1B'. */
export function amountText(a: { value: number; unit: string; valueLow?: number }): string {
  const u = a.unit; const f = (n: number) => n.toLocaleString('en-US');
  const val = a.valueLow != null && a.valueLow < a.value ? `${f(a.valueLow)}–${f(a.value)}` : f(a.value);
  return `${u === '₹ Cr' ? '₹' : u.startsWith('$') ? '$' : ''}${val}${u === '₹ Cr' ? ' Cr' : u.startsWith('$') ? u.slice(1) : u ? ` ${u}` : ''}`;
}
export function pctText(low: number, high: number | null, open: boolean): string {
  return open ? `${sg(low)}%+` : high == null || low === high ? `${sg(low)}%` : low < 0 || high < 0 ? `${sg(low)} to ${sg(high)}%` : `${sg(low)}–${fnum(high)}%`;
}
export function displayOf(i: GuDisplayIn): string {
  let core: string;
  if (i.low == null) {
    if (!i.abs) return '—';
    return `${amountText(i.abs)} target (no % stated)`;
  }
  const pct = pctText(i.low, i.high, i.open);
  if (i.periodKind === 'MULTI_YEAR_CAGR') {
    const y = multiYears(i.period, i.cumulativeYears);
    core = `${y ? `${y}-yr` : 'Multi-year'} ${METRIC_WORD[i.metric]} CAGR ${pct}`;
  } else core = pct;
  if (i.proxy) core += ` (${i.proxy})`;
  if (i.origin === 'IMPLIED') core += ' (implied)';
  return core;
}
/** Value used for the threshold test. See COUNTING RULE at the top. */
export function compareValue(low: number | null, high: number | null, open: boolean): number | null {
  if (low == null) return null;
  if (open || high == null) return low;
  return r1((low + high) / 2);
}
const proxyOf = (metric: GgMetric, statement: string): string | null => {
  if (metric !== 'REVENUE') return null;
  if (/\b(revenue|top[- ]?line)\b/i.test(statement)) return null;
  if (/pre-?sales/i.test(statement)) return 'presales';
  if (/\bbookings\b/i.test(statement)) return 'bookings';
  return null;
};

// ═══ items (one guidance statement, whatever its origin) ═══════════════════════════════════════
type Inactive = 'EXPIRED' | 'SUPERSEDED' | 'WITHDRAWN';
interface Prior { date: string; low: number | null; high: number | null; note: string }
interface ItemBase { value: number; unit: string; period: string }
interface Item {
  origin: GuUniverseRecordOrigin; market: 'IN' | 'US'; ticker: string | null; company: string; metric: GgMetric;
  low: number | null; high: number | null; open: boolean; gOrigin: GgGrowthOrigin; abs: { value: number; unit: string; valueLow?: number } | null; cumulativeYears?: number | null;
  /** sourced base behind an IMPLIED growth % (null = no base recorded) */ base?: ItemBase | null; needsReview?: string | null; /** a same-day IMPLIED item merged under a STATED winner */ compImplied?: Item | null;
  period: string; pkind: GgPeriodKind; kind: GgKind; organic: GgOrganic; statement: string; driver: string | null; mechanisms: string[];
  src: { name: string; type: string; url: string | null; date: string | null; rank: number };
  verification: GgVerification; priors: Prior[]; notes: string | null; withdrawn?: boolean; forced?: Inactive; gc?: GgCompany; gp?: GgGuidancePoint; isPrimary?: boolean; owner?: string | null;
}
const srcPrimary = (rank: number, type: string) => rank <= 7 && !/media|news/i.test(type);
const tk = (t: unknown): string | null => { const s = String(t ?? '').trim().toUpperCase().replace(/\.(NS|BO)$/, ''); return s || null; };
const hasNumber = (low: number | null, abs: unknown) => low != null || !!abs;

function itemFromSeed(r: GuSeedRow): Item {
  return {
    origin: 'RESEARCHED_SEED', market: r.market, ticker: r.ticker, company: r.company, metric: r.metric, low: r.growthLow, high: r.growthHigh ?? r.growthLow, open: isOpenEnded(r.growthLow, r.growthHigh, r.statement), gOrigin: r.growthOrigin,
    abs: r.absoluteTarget, base: r.impliedBase ?? null, needsReview: r.needsReview ?? null, period: r.period, pkind: r.periodKind, kind: r.kind, organic: r.organic, statement: r.statement, driver: r.driver, mechanisms: r.mechanisms,
    src: { name: r.sourceName, type: r.sourceType, url: r.sourceUrl, date: r.sourceDate, rank: r.sourceRank }, verification: r.verification,
    priors: r.priorGuidance.map((p) => ({ date: p.date, low: p.growthLow, high: p.growthHigh, note: p.note })), notes: r.notes || null, owner: r.ownerListText,
  };
}
const inactiveOfValidity = (v: GgCompany['validity']): Inactive | undefined => (v === 'ACTIVE' ? undefined : v === 'SUPERSEDED' ? 'SUPERSEDED' : v === 'WITHDRAWN' ? 'WITHDRAWN' : 'EXPIRED');
function itemsFromLive(c: GgCompany): Item[] {
  if (c.market !== 'IN' && c.market !== 'US') return [];
  const s0: GgSourceRef | undefined = c.sources?.[0];
  const pts = [c.primary, ...(c.others || [])].filter(Boolean);
  const out: Item[] = [];
  pts.forEach((p, idx) => {
    if (!isMgmt(p.kind) || (p.growthLow == null && !p.absoluteTarget)) return;
    const lo = p.growthLow, hi = p.growthHigh ?? p.growthLow;
    out.push({
      origin: 'LIVE', market: c.market as 'IN' | 'US', ticker: tk(c.ticker), company: c.company, metric: p.metric, low: lo, high: hi, open: isOpenEnded(lo, hi, p.originalStatement || ''), gOrigin: p.growthOrigin,
      abs: p.absoluteTarget ? { value: p.absoluteTarget.value, unit: p.absoluteTarget.unit, ...((p as any).absoluteHigh != null && (p as any).absoluteHigh !== p.absoluteTarget.value ? { valueLow: Math.min(p.absoluteTarget.value, (p as any).absoluteHigh), value: Math.max(p.absoluteTarget.value, (p as any).absoluteHigh) } : {}) } : null,
      base: p.base ? { value: p.base.value, unit: p.absoluteTarget?.unit || '', period: p.base.period } : null, cumulativeYears: p.cumulativeYears, period: p.period, pkind: p.periodKind, kind: p.kind, organic: p.organic,
      statement: p.originalStatement || '', driver: c.driverText || null, mechanisms: c.mechanisms || [], src: { name: s0?.name || 'Live scan', type: s0?.type || 'Media', url: s0?.url || null, date: s0?.date || c.announcedAt || null, rank: s0?.rank ?? 10 },
      verification: c.verification, priors: [], notes: null, forced: inactiveOfValidity(c.validity), withdrawn: c.validity === 'WITHDRAWN', gc: c, gp: p, isPrimary: idx === 0,
    });
  });
  return out;
}
function itemsFromLedger(rows: Array<{ market: 'IN' | 'US'; ticker: string; company?: string; entries: GgStoredEntry[] }>): Item[] {
  const out: Item[] = [];
  for (const row of rows || []) {
    const groups = new Map<string, GgStoredEntry[]>();
    for (const e of row.entries || []) {
      if (!e || !isMgmt(e.kind) || e.verification === 'UNVERIFIED') continue;
      const k = `${e.metric}|${normPeriod(e.period)}`; (groups.get(k) || groups.set(k, []).get(k)!).push(e);
    }
    for (const list of Array.from(groups.values())) {
      list.sort((a, b) => a.date.localeCompare(b.date));
      const e = list[list.length - 1];
      if (e.low == null && e.absLow == null) continue;
      out.push({
        origin: 'LEDGER', market: row.market, ticker: tk(row.ticker), company: row.company || (NSE_TICKER_NAMES as Record<string, string>)[row.ticker.toUpperCase()] || row.ticker, metric: e.metric, low: e.low, high: e.high ?? e.low, open: isOpenEnded(e.low, e.high ?? e.low, e.statement || ''), gOrigin: e.growthOrigin,
        abs: e.absLow != null ? { value: e.absLow, unit: e.absUnit || '' } : null, period: e.period, pkind: e.periodKind, kind: e.kind, organic: 'UNKNOWN', statement: e.statement || '', driver: null, mechanisms: [],
        src: { name: e.source, type: e.sourceRank <= 6 ? 'Filing' : e.sourceRank <= 9 ? 'Company voice' : 'Media', url: e.sourceUrl || null, date: e.date, rank: e.sourceRank }, verification: e.verification,
        priors: list.slice(0, -1).map((x) => ({ date: x.date, low: x.low, high: x.high, note: x.source })), notes: null, withdrawn: !!e.withdrawn, forced: e.withdrawn ? 'WITHDRAWN' : undefined,
      });
    }
  }
  return out;
}

// ═══ stored universe (what the route persists) ═════════════════════════════════════════════════
export interface GuStoredPoint {
  key: string; slot: string; market: 'IN' | 'US'; ticker: string | null; company: string; metric: GgMetric; low: number | null; high: number | null; open: boolean; gOrigin: GgGrowthOrigin;
  abs: { value: number; unit: string; valueLow?: number } | null; base?: ItemBase | null; needsReview?: string | null; period: string; pkind: GgPeriodKind; kind: GgKind; organic: GgOrganic; verification: GgVerification; statement: string;
  src: { name: string; type: string; url: string | null; date: string | null; rank: number }; priors: Prior[]; origin: GuUniverseRecordOrigin; display: string;
}
export interface GuStoredDoc { v: 1; asOf: string; hash: string; rows: GuStoredPoint[] }
export const GU_MAX_STORED = 600;
function itemsFromStored(rows: GuStoredPoint[] | null | undefined): Item[] {
  const out: Item[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.origin === 'RESEARCHED_SEED') continue;           // researched rows are re-read from their data file every time, never from a stale copy
    if (!METRICS.includes(r.metric) || !r.company || (r.low == null && !r.abs) || !isMgmt(r.kind) || r.verification === 'UNVERIFIED') continue;
    out.push({ origin: 'LEDGER', market: r.market, ticker: r.ticker, company: r.company, metric: r.metric, low: r.low, high: r.high, open: !!r.open, gOrigin: r.gOrigin, abs: r.abs, base: r.base ?? null, needsReview: r.needsReview ?? null, period: r.period, pkind: r.pkind, kind: r.kind,
      organic: r.organic, statement: r.statement || '', driver: null, mechanisms: [], src: r.src, verification: r.verification, priors: Array.isArray(r.priors) ? r.priors : [], notes: null });
  }
  return out;
}
/** Pure: the next stored document. Same slot (market|entity|metric|period) is replaced by the fresh point; expired slots are dropped; bounded; newest first. Returns changed=false when nothing differs (idempotent write). */
export function mergeStored(existing: GuStoredDoc | null | undefined, fresh: GuStoredPoint[], now: Date, asOf = now.toISOString()): { doc: GuStoredDoc; changed: boolean } {
  const bySlot = new Map<string, GuStoredPoint>();
  for (const r of existing?.rows || []) {
    if (!r?.slot) continue;
    const e = periodEnd(r.period, r.market, r.src?.date).end; if (e && e.getTime() < now.getTime()) continue;
    bySlot.set(r.slot, r);
  }
  for (const r of fresh) bySlot.set(r.slot, r);
  const rows = Array.from(bySlot.values()).sort((a, b) => (b.src.date || '').localeCompare(a.src.date || '') || a.key.localeCompare(b.key)).slice(0, GU_MAX_STORED);
  const h = hash(rows.map((r) => r.key).sort().join(','));
  return { doc: { v: 1, asOf, hash: h, rows }, changed: h !== existing?.hash };
}

// ═══ entity resolution ═════════════════════════════════════════════════════════════════════════
const GENERIC = new Set(['india', 'indian', 'bank', 'group', 'global', 'power', 'steel', 'gold', 'energy', 'capital', 'finance', 'industries', 'international', 'technologies', 'company', 'holdings', 'infra', 'enterprises', 'foods', 'oil', 'gas', 'green', 'new', 'first', 'national', 'united']);
class Entities {
  private parent = new Map<string, string>(); private ticker = new Map<string, string | null>();
  private find(x: string): string { let r = x; while (this.parent.get(r) !== r) r = this.parent.get(r)!; let c = x; while (this.parent.get(c) !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; } return r; }
  add(x: string) { if (!this.parent.has(x)) { this.parent.set(x, x); this.ticker.set(x, x.startsWith('T|') ? x.split('|')[2] : null); } }
  union(a: string, b: string): boolean {
    this.add(a); this.add(b); const ra = this.find(a), rb = this.find(b); if (ra === rb) return true;
    const ta = this.ticker.get(ra), tb = this.ticker.get(rb); if (ta && tb && ta !== tb) return false;   // two different tickers are never merged
    this.parent.set(rb, ra); this.ticker.set(ra, ta || tb || null); return true;
  }
  root(x: string): string { this.add(x); return this.find(x); }
  tickerOf(root: string): string | null { return this.ticker.get(root) ?? null; }
}
const nKey = (m: string, name: string) => `N|${m}|${normCompanyName(name)}`;
const tKey = (m: string, t: string) => `T|${m}|${t}`;
/** true when a and b differ by at most one inserted, deleted or substituted letter (and are not equal) */
function editDistanceLe1(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
function resolveEntities(items: Item[]): Map<Item, string> {
  const E = new Entities();
  const names = NSE_TICKER_NAMES as Record<string, string>;
  const idx = buildCompanyIndex([...Object.entries(names).map(([symbol, name]) => ({ symbol, name })), ...items.filter((i) => i.market === 'IN' && i.ticker).map((i) => ({ symbol: i.ticker, name: i.company }))]);
  for (const it of items) { E.add(nKey(it.market, it.company)); if (it.ticker) E.add(tKey(it.market, it.ticker)); }
  // 1. ticker <-> name from the item itself, and from the curated ticker map
  for (const it of items) {
    if (it.ticker) { E.union(tKey(it.market, it.ticker), nKey(it.market, it.company)); const cn = names[it.ticker]; if (it.market === 'IN' && cn) E.union(tKey(it.market, it.ticker), nKey(it.market, cn)); }
  }
  // 2. a name that is itself a known ticker ('KRN'), or a name the company index knows
  for (const it of items) {
    if (it.ticker || it.market !== 'IN') continue;
    const k = normCompanyName(it.company); const up = it.company.trim().toUpperCase();
    if (idx.known.has(up)) { E.union(nKey(it.market, it.company), tKey(it.market, up)); continue; }
    const sym = idx.names.get(k); if (sym) E.union(nKey(it.market, it.company), tKey(it.market, sym));
  }
  // 2b. '(KMEW)' in the name, or a spaced short name ('Ross Tech' -> ROSSTECH): the token is a known ticker
  for (const it of items) {
    if (it.market !== 'IN') continue;
    const par = /\(([A-Za-z0-9&-]{2,15})\)/.exec(it.company); const tokens = [par ? par[1].toUpperCase() : '', it.company.replace(/\(.*?\)/g, '').replace(/[^A-Za-z0-9&]/g, '').toUpperCase()].filter(Boolean);
    for (const tkn of tokens) if (idx.known.has(tkn) && (!it.ticker || it.ticker === tkn)) { E.union(nKey(it.market, it.company), tKey(it.market, tkn)); break; }
  }
  // 3. word-prefix aliases ('syrma sgs' / 'syrma sgs technology'): only when the short name prefixes exactly one longer name
  for (const m of ['IN', 'US']) {
    const ns = Array.from(new Set(items.filter((i) => i.market === m).map((i) => normCompanyName(i.company)).filter(Boolean)));
    for (const s of ns) {
      if (s.length < 4 || (!s.includes(' ') && GENERIC.has(s))) continue;
      const longer = ns.filter((l) => l !== s && l.startsWith(`${s} `));
      if (longer.length === 1) E.union(`N|${m}|${s}`, `N|${m}|${longer[0]}`);
    }
  }
  // 4. one-letter spelling variants of a long name ('krishana phoschem' / 'krishna phoschem'): same market, never across two different tickers
  for (const m of ['IN', 'US']) {
    const ns = Array.from(new Set(items.filter((i) => i.market === m).map((i) => normCompanyName(i.company)).filter((n) => n.length >= 10)));
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (Math.abs(ns[i].length - ns[j].length) <= 1 && editDistanceLe1(ns[i], ns[j])) E.union(`N|${m}|${ns[i]}`, `N|${m}|${ns[j]}`);
  }
  const out = new Map<Item, string>();
  for (const it of items) { const r = E.root(it.ticker ? tKey(it.market, it.ticker) : nKey(it.market, it.company)); const t = E.tickerOf(r); out.set(it, `${it.market}:${t || r.replace(/^N\|[A-Z]+\|/, '~')}`); }
  return out;
}

// ═══ record shapes ═════════════════════════════════════════════════════════════════════════════
export interface GuPoint {
  metric: GgMetric; period: string; periodKind: GgPeriodKind; display: string; low: number | null; high: number | null; open: boolean; implied: boolean; compareValue: number | null; counted: boolean;
  verification: GgVerification; origin: GuUniverseRecordOrigin; sourceName: string; sourceType: string; sourceUrl: string | null; sourceDate: string | null; sourceRank: number; primarySource: boolean;
  revision: GuUniverseRecord['revision']; proxy: string | null; statement: string; notes: string | null;
  priors: Prior[]; absolute: { value: number; unit: string; valueLow?: number } | null;
  // ── zzz849 (additive) ──
  periodStatus: GuPeriodStatus; periodInferred: boolean; periodNote: string | null; periodEnd: string | null;
  /** growth as management stated it (null when only a target amount was stated) */
  statedGrowth: { low: number; high: number | null; open: boolean; display: string } | null;
  /** growth worked out from a target amount and a sourced base. Secondary when statedGrowth exists; primary (and labelled '(implied)') otherwise. */
  impliedGrowth: { low: number; high: number | null; display: string; base: { value: number; unit: string; period: string } | null; baseLabel: string | null } | null;
  /** display of the implied figure including its base, e.g. '+102.7–109.7% (implied, base FY26 revenue ₹357.71 Cr)' */
  impliedDisplay: string | null;
  /** when management stated a % AND an implied figure exists, the implied one as a secondary line */
  secondaryDisplay: string | null;
  /** why an implied % was dropped (quarter target vs full-year base, no target amount ...); the display then shows the amount only */
  impliedRejected: string | null;
  /** why the point is flagged 'needs review' (implausible growth, unsourced base, researcher flag). Flagged points are never counted. */
  needsReview: string | null;
  /** high-growth class when every rule except the threshold passes: single-year, or explicit multi-year CAGR */
  hg: GuHighGrowthHorizon | null;
  /** passes every high-growth rule except verification (only media backs it) */
  awaitingVerification: boolean;
}
export interface GuUniverseRecordX extends GuUniverseRecord {
  entityKey: string; tickers: string[]; names: string[]; period: string;
  /** ANNUAL (FY/CY/12M), MULTI_YEAR (CAGR), SHORT_PERIOD (quarter/half), UNKNOWN_PERIOD */
  classification: 'ANNUAL' | 'MULTI_YEAR' | 'SHORT_PERIOD' | 'UNKNOWN_PERIOD';
  points: GuPoint[];
  sourceName: string; sourceType: string; sourceUrl: string | null; sourceDate: string | null; sourceRank: number; primarySource: boolean;
  statement: string; notes: string | null; activeNote: string | null;
  /** zzz849: status of the headline point's period, why it is flagged, and the secondary (implied) figure when management also stated a % */
  periodStatus: GuPeriodStatus; needsReview: string | null; secondaryDisplay: string | null; impliedDisplay: string | null;
}
export interface GuInactiveRecord { entityKey: string; company: string; ticker: string | null; market: 'IN' | 'US'; metric: GgMetric; period: string; status: Inactive; reason: string; display: string; verification: GgVerification; sourceName: string; sourceDate: string | null; origin: GuUniverseRecordOrigin }
export interface GuExcluded { company: string; ticker: string | null; market: 'IN' | 'US'; metric: GgMetric; period: string; reason: string }
export interface GuUniverseBuild { records: GuUniverseRecordX[]; inactive: GuInactiveRecord[]; excluded: GuExcluded[]; stored: GuStoredPoint[] }
export interface GuBuildOpts { threshold?: number }

const dateOf = (i: Item) => i.src.date || '';
const ORIGIN_ORDER: Record<GuUniverseRecordOrigin, number> = { LIVE: 0, LEDGER: 1, RESEARCHED_SEED: 2 };
/** >0 when a should win over b (a is the current guidance). Live/ledger beat a researched row when newer-or-equal OR from a higher-ranked source. Otherwise newest wins, then rank. */
function better(a: Item, b: Item): number {
  const aSeed = a.origin === 'RESEARCHED_SEED', bSeed = b.origin === 'RESEARCHED_SEED';
  if (aSeed !== bSeed) {
    const nonSeed = aSeed ? b : a, seed = aSeed ? a : b;
    const nsWins = dateOf(nonSeed) >= dateOf(seed) || nonSeed.src.rank < seed.src.rank;
    return (nsWins ? nonSeed : seed) === a ? 1 : -1;
  }
  if (dateOf(a) !== dateOf(b)) return dateOf(a) > dateOf(b) ? 1 : -1;
  const aS = a.gOrigin === 'STATED' && a.low != null, bS = b.gOrigin === 'STATED' && b.low != null;
  if (aS !== bS) return aS ? 1 : -1;   // the same day: a stated % beats a worked-out one
  if (a.src.rank !== b.src.rank) return a.src.rank < b.src.rank ? 1 : -1;
  if (a.origin !== b.origin) return ORIGIN_ORDER[a.origin] < ORIGIN_ORDER[b.origin] ? 1 : -1;
  return 0;
}
const mid = (low: number | null, high: number | null): number | null => (low == null ? null : high == null ? low : (low + high) / 2);
const REVISION_UP = /\b(raised|upgraded|hiked|lifted|increased)\b/i, REVISION_DOWN = /\b(lowered|cut|trimmed|reduced|slashed|downgraded)\b/i, REVISION_SAME = /\b(reiterat\w*|maintain\w*|unchanged|reaffirm\w*)\b/i, GUIDE_CTX = /\b(guid\w*|target\w*|outlook|forecast\w*|expect\w*)\b/i;
function revisionFor(it: Item, history: Prior[]): GuUniverseRecord['revision'] {
  if (it.gc && it.isPrimary) { const r = it.gc.revision; if (r === 'RAISED' || r === 'MAINTAINED' || r === 'LOWERED' || r === 'WITHDRAWN' || r === 'INITIAL') return r; }
  const cur = mid(it.low, it.high);
  const priors = history.filter((p) => p.low != null).sort((a, b) => a.date.localeCompare(b.date));
  const last = priors[priors.length - 1];
  if (cur != null && last) { const r = revisionOf(mid(last.low, last.high), cur, false); if (r === 'RAISED' || r === 'LOWERED' || r === 'MAINTAINED') return r; }
  if (GUIDE_CTX.test(it.statement)) { if (REVISION_DOWN.test(it.statement)) return 'LOWERED'; if (REVISION_UP.test(it.statement)) return 'RAISED'; if (REVISION_SAME.test(it.statement)) return 'MAINTAINED'; }
  return it.gc && it.isPrimary && it.gc.revision === 'INITIAL' ? 'INITIAL' : 'NONE';
}
const classOf = (k: GgPeriodKind): GuUniverseRecordX['classification'] => (k === 'MULTI_YEAR_CAGR' ? 'MULTI_YEAR' : k === 'QUARTER' || k === 'HALF' ? 'SHORT_PERIOD' : k === 'UNKNOWN' ? 'UNKNOWN_PERIOD' : 'ANNUAL');
const ANNUAL_COUNTABLE: GgPeriodKind[] = ['FY', 'CY', 'ROLLING_12M'];
const srcRefOf = (it: Item): GgSourceRef => ({ name: it.src.name, rank: it.src.rank, type: it.src.type, date: it.src.date, url: it.src.url || undefined, primary: srcPrimary(it.src.rank, it.src.type) });

/** A revenue growth at or above this needs an explicit stated basis (a % management stated, with the figure in the source text) or it is flagged 'needs review'. */
export const PLAUSIBLE_REVENUE_GROWTH_PCT = 100;
const lenOfKind = (k: GgPeriodKind): number | null => (k === 'FY' || k === 'CY' || k === 'ROLLING_12M' ? 12 : k === 'QUARTER' ? 3 : k === 'HALF' ? 6 : null);
const lenOfPeriod = (p: string): number | null => { const n = normPeriod(p); return /^Q[1-4]\b/.test(n) ? 3 : /^H[12]\b/.test(n) ? 6 : /^(FY|CY)\d{2}$/.test(n) || /^(prior|previous|last) year$/i.test(n) || /^(19|20)\d{2}$/.test(n) ? 12 : null; };
const baseText = (b: { value: number; unit: string; period: string }, metric: GgMetric) => `${b.period} ${METRIC_WORD[metric]} ${amountText({ value: b.value, unit: b.unit })}`;
const figureIn = (statement: string, n: number): boolean => new RegExp(`(?:^|[^0-9.])${esc(String(Math.abs(n)))}(?:\\.0)?\\s*(?:%|per ?cent|percent|-|–|to\\b|\\+)`, 'i').test(statement);

/** Like-for-like check for an implied growth %. reject = drop the % and show the amount only; review = keep it but flag it and never count it. */
function impliedCheck(it: Item): { reject?: string; review?: string } {
  const tl = lenOfKind(it.pkind);
  if (tl == null) return { reject: `Implied growth dropped: the target period (${it.period}) is not a single year, half or quarter, so it cannot be set against a one-period base.` };
  if (!it.abs) return { reject: 'Implied growth dropped: there is no stated target amount to work it out from.' };
  const b = it.base;
  if (!b) return { review: 'Implied growth has no sourced base (base amount and period were not recorded), so it is not counted.' };
  const bl = lenOfPeriod(b.period);
  if (bl != null && bl !== tl) return { reject: `Implied growth dropped: a ${tl}-month ${it.period} target cannot be divided by a ${bl}-month base (${b.period}).` };
  if (b.unit && it.abs.unit && b.unit !== it.abs.unit) return { reject: `Implied growth dropped: the target is in ${it.abs.unit} but the base is in ${b.unit}.` };
  if (it.low != null && it.low === it.high && it.abs.valueLow == null) {
    const calc = (it.abs.value / b.value - 1) * 100;
    if (Math.abs(calc - it.low) > 0.6) return { review: `Stored growth (${fnum(it.low)}%) does not match the target amount divided by the base (${fnum(calc)}%).` };
  } else if (it.low != null && it.abs.valueLow != null) {
    const lo = (it.abs.valueLow / b.value - 1) * 100, hi = (it.abs.value / b.value - 1) * 100;
    if (Math.abs(lo - it.low) > 0.6 || Math.abs(hi - (it.high ?? it.low)) > 0.6) return { review: `Stored growth range does not match the target range divided by the base (${fnum(lo)}–${fnum(hi)}%).` };
  }
  return {};
}

function pointOf(it: Item, history: Prior[], ps: GuPeriodInfo): GuPoint {
  const proxy = proxyOf(it.metric, it.statement);
  let low = it.low, high = it.high, open = it.open; const origin = it.gOrigin;
  let impliedRejected: string | null = null; const flags: string[] = [];
  if (origin === 'IMPLIED' && low != null) {
    const chk = impliedCheck(it);
    if (chk.reject) { impliedRejected = chk.reject; low = null; high = null; open = false; } else if (chk.review) flags.push(chk.review);
  }
  if (it.needsReview) flags.push(it.needsReview);
  const cv = compareValue(low, high, open);
  if (it.metric === 'REVENUE' && cv != null && cv >= PLAUSIBLE_REVENUE_GROWTH_PCT && !(origin === 'STATED' && low != null && figureIn(it.statement, low)))
    flags.push(`Revenue growth of about ${fnum(cv)}% is at or above ${PLAUSIBLE_REVENUE_GROWTH_PCT}%, which is implausible for an established company unless management clearly stated it as a percent. The source text does not show that, so it needs review.`);
  const needsReview = flags.length ? flags.join(' ') : null;
  const baseCore = displayOf({ metric: it.metric, low, high, open, origin: low == null ? 'STATED' : origin, periodKind: it.pkind, period: it.period, abs: it.abs, cumulativeYears: it.cumulativeYears, proxy });
  const tails: string[] = [];
  if (needsReview) tails.push('needs review');
  if (ps.status === 'UNKNOWN' || ps.inferred) tails.push('period year not stated');
  const display = tails.length ? `${baseCore} (${tails.join('; ')})` : baseCore;
  const baseLabel = it.base ? baseText(it.base, it.metric) : null;
  // stated vs implied: both are kept when both exist; stated is always primary
  const statedGrowth = origin === 'STATED' && low != null ? { low, high: open ? null : high === low ? null : high, open, display: pctText(low, open ? null : high === low ? null : high, open) } : null;
  let impliedGrowth: GuPoint['impliedGrowth'] = null;
  if (origin === 'IMPLIED' && low != null) impliedGrowth = { low, high: high === low ? null : high, display: pctText(low, high === low ? null : high, false), base: it.base ?? null, baseLabel };
  else if (statedGrowth && it.compImplied && it.compImplied.low != null && !impliedCheck(it.compImplied).reject && !impliedCheck(it.compImplied).review) {
    const c = it.compImplied; const cb = c.base ? baseText(c.base, c.metric) : null;
    impliedGrowth = { low: c.low!, high: c.high === c.low ? null : c.high, display: pctText(c.low!, c.high === c.low ? null : c.high, false), base: c.base ?? null, baseLabel: cb };
  }
  const impliedDisplay = impliedGrowth ? `${impliedGrowth.display} (implied${impliedGrowth.baseLabel ? `, base ${impliedGrowth.baseLabel}` : ''})` : null;
  const secondaryDisplay = statedGrowth && impliedGrowth ? impliedDisplay : null;
  const mgmtVerified = it.verification === 'VERIFIED' || it.verification === 'PARTIALLY_VERIFIED';
  const horizon: GuHighGrowthHorizon | null = ANNUAL_COUNTABLE.includes(it.pkind) ? 'SINGLE_YEAR' : it.pkind === 'MULTI_YEAR_CAGR' ? 'MULTI_YEAR_CAGR' : null;
  const base = isMgmt(it.kind) && (it.metric === 'REVENUE' || it.metric === 'PAT') && horizon && !proxy && cv != null && !needsReview && ps.status === 'ACTIVE' && !ps.inferred;
  const hg = base && mgmtVerified ? horizon : null;
  const awaitingVerification = !!base && it.verification === 'SECONDARY_ONLY';
  const counted = isMgmt(it.kind) && mgmtVerified && horizon === 'SINGLE_YEAR' && !proxy && cv != null && !needsReview && ps.status === 'ACTIVE' && !ps.inferred;
  return {
    metric: it.metric, period: it.period, periodKind: it.pkind, display,
    low, high, open, implied: origin === 'IMPLIED', compareValue: cv, counted, verification: it.verification, origin: it.origin, sourceName: it.src.name, sourceType: it.src.type, sourceUrl: it.src.url,
    sourceDate: it.src.date, sourceRank: it.src.rank, primarySource: srcPrimary(it.src.rank, it.src.type), revision: revisionFor(it, history), proxy, statement: it.statement, notes: it.notes, priors: history, absolute: it.abs,
    periodStatus: ps.status, periodInferred: ps.inferred, periodNote: ps.note, periodEnd: ps.end ? ps.end.toISOString().slice(0, 10) : null,
    statedGrowth, impliedGrowth, impliedDisplay, secondaryDisplay, impliedRejected, needsReview, hg, awaitingVerification,
  };
}
const fmtPrior = (p: Prior) => (p.low == null ? 'no %' : pctText(p.low, p.high === p.low ? null : p.high, false));

function companyOf(base: Item, all: Item[], pt: GuPoint, key: string): GgCompany {
  const primaryPoint: GgGuidancePoint = base.gp || {
    metric: base.metric, kind: base.kind, growthLow: base.low, growthHigh: base.high, growthOrigin: base.gOrigin, absoluteTarget: base.abs ? { value: base.abs.value, unit: base.abs.unit } : null, base: null,
    period: base.period, periodKind: base.pkind, organic: base.organic, basis: 'UNSTATED', originalStatement: base.statement, unit: base.pkind === 'MULTI_YEAR_CAGR' ? '% CAGR' : '%', prior: null,
  };
  const others: GgGuidancePoint[] = all.filter((x) => x !== base).map((x) => x.gp || ({
    metric: x.metric, kind: x.kind, growthLow: x.low, growthHigh: x.high, growthOrigin: x.gOrigin, absoluteTarget: x.abs ? { value: x.abs.value, unit: x.abs.unit } : null, base: null,
    period: x.period, periodKind: x.pkind, organic: x.organic, basis: 'UNSTATED', originalStatement: x.statement, unit: '%',
  } as GgGuidancePoint));
  const history: GgLedgerRow[] = [...pt.priors.map((p): GgLedgerRow => ({ date: p.date, period: base.period, metric: base.metric, old: null, next: fmtPrior(p), revision: 'INITIAL', source: p.note || 'Earlier guidance', reason: p.note || '', status: 'SUPERSEDED' })),
    { date: base.src.date || '', period: base.period, metric: base.metric, old: pt.priors.length ? fmtPrior(pt.priors[pt.priors.length - 1]) : null, next: pt.display, revision: pt.revision === 'NONE' ? 'INITIAL' : (pt.revision as GgRevision), source: base.src.name, reason: '', status: 'ACTIVE' }];
  const src = srcRefOf(base);
  const organicWord = base.organic === 'ORGANIC' ? 'Organic' : base.organic === 'ACQUISITION_LED' ? 'Acquisition-led' : base.organic === 'MIXED' ? 'Organic + acquisition' : 'Organic mix unknown';
  return {
    id: hash(`${key}|${base.metric}|${normPeriod(base.period)}`), ticker: base.ticker || '', company: base.company, market: base.market, tickerResolved: !!base.ticker, capBand: 'UNKNOWN', marketCap: null,
    primary: primaryPoint, others, verification: base.verification, quality: qualityOf(primaryPoint, src), validity: 'ACTIVE', sources: [src], conflict: null,
    driverText: base.driver || 'Management has not stated the driver in the source found', mechanisms: base.mechanisms, catalysts: [], chain: [], guidanceDuration: base.period, structuralDuration: base.pkind === 'MULTI_YEAR_CAGR' ? 'Multi-year' : 'Not established',
    history, revision: pt.revision === 'NONE' ? 'INITIAL' : (pt.revision as GgRevision), trend: 'NONE', trendText: null, credibility: null, surprise: null, reality: null, earnings: null, map2x2: 'FORWARD_LOOKING_EARLY',
    expectations: 'UNKNOWN', expectationsWhy: 'DATA UNAVAILABLE', valuation: null, nextProof: `Next results: compare reported ${METRIC_WORD[base.metric]} growth with the guided ${pt.display} for ${base.period}.`, breakers: [],
    links: { radarEligible: false, radarWhy: 'Not assessed for this record' }, organicNote: `${base.period} ${pt.display} ${METRIC_WORD[base.metric]}: ${organicWord}`, corporateActionGrowth: base.organic === 'ACQUISITION_LED', portfolio: { held: false },
    announcedAt: base.src.date, lastEvidenceAt: base.src.date, isNewToday: false, alert: null,
  };
}

const METRIC_ORDER: Record<GgMetric, number> = { REVENUE: 0, PAT: 1, EPS: 2, EBITDA: 3, FCF: 4 };
const PERIOD_CLASS_ORDER: Record<GuUniverseRecordX['classification'], number> = { ANNUAL: 0, UNKNOWN_PERIOD: 1, SHORT_PERIOD: 2, MULTI_YEAR: 3 };

/** The universe: currently valid guidance, merged per company. No time window. ACTIVE = not expired (period end vs now), not superseded by a later record for the same company+metric+period, not withdrawn. */
export function buildUniverse(live: GgCompany[], ledgerRows: Array<{ market: 'IN' | 'US'; ticker: string; company?: string; entries: GgStoredEntry[] }> | null | undefined, seedRows: GuSeedRow[], now: Date, opts: GuBuildOpts & { stored?: GuStoredPoint[] | null } = {}): GuUniverseBuild {
  void opts;
  const items: Item[] = [];
  for (const c of live || []) items.push(...itemsFromLive(c));
  items.push(...itemsFromLedger(ledgerRows || []));
  items.push(...itemsFromStored(opts.stored));
  for (const r of seedRows || []) items.push(itemFromSeed(r));
  const excluded: GuExcluded[] = [];
  const usable = items.filter((it) => {
    if (it.verification === 'UNVERIFIED') { excluded.push({ company: it.company, ticker: it.ticker, market: it.market, metric: it.metric, period: it.period, reason: 'UNVERIFIED: no source supports this number, so it is not shown as guidance.' }); return false; }
    if (!isMgmt(it.kind) || !hasNumber(it.low, it.abs)) return false;
    return true;
  });
  const entityOf = resolveEntities(usable);
  // group per entity + metric + period
  const slots = new Map<string, Item[]>();
  for (const it of usable) { const k = `${entityOf.get(it)}|${it.metric}|${normPeriod(it.period)}`; (slots.get(k) || slots.set(k, []).get(k)!).push(it); }
  const inactive: GuInactiveRecord[] = [];
  const activeByEntity = new Map<string, Array<{ it: Item; history: Prior[]; note: string | null; ps: GuPeriodInfo }>>();
  const nameSets = new Map<string, Set<string>>(); const tickerSets = new Map<string, Set<string>>();
  for (const it of usable) { const e = entityOf.get(it)!; (nameSets.get(e) || nameSets.set(e, new Set()).get(e)!).add(normCompanyName(it.company)); if (it.ticker) (tickerSets.get(e) || tickerSets.set(e, new Set()).get(e)!).add(it.ticker); }
  const pushInactive = (e: string, it: Item, status: Inactive, reason: string) => inactive.push({ entityKey: e, company: it.company, ticker: it.ticker, market: it.market, metric: it.metric, period: it.period, status, reason, display: displayOf({ metric: it.metric, low: it.low, high: it.high, open: it.open, origin: it.gOrigin, periodKind: it.pkind, period: it.period, abs: it.abs, cumulativeYears: it.cumulativeYears }), verification: it.verification, sourceName: it.src.name, sourceDate: it.src.date, origin: it.origin });
  for (const group of Array.from(slots.values())) {
    const e = entityOf.get(group[0])!;
    const eligible = group.filter((g) => !g.forced);
    for (const g of group.filter((x) => x.forced)) pushInactive(e, g, g.forced!, g.forced === 'WITHDRAWN' ? 'Management withdrew this guidance.' : g.forced === 'SUPERSEDED' ? 'Replaced by a later statement.' : 'The guided period has ended.');
    if (!eligible.length) continue;
    eligible.sort((a, b) => -better(a, b));
    const win = eligible[0];
    // zzz849: a stated % is never replaced by an implied one. A same-day implied statement for the same slot rides along as the secondary figure; the same
    // statement from the same day never beats a stated one.
    const comp = win.gOrigin === 'STATED' && win.low != null ? eligible.slice(1).find((x) => x.gOrigin === 'IMPLIED' && x.low != null && dateOf(x) === dateOf(win)) : undefined;
    if (comp) win.compImplied = comp;
    for (const l of eligible.slice(1)) if (l !== comp) pushInactive(e, l, 'SUPERSEDED', `A later or higher-ranked record for the same company, metric and period (${win.src.date || 'undated'}, ${win.src.name}) replaces this one.`);
    if (win.withdrawn) { pushInactive(e, win, 'WITHDRAWN', 'Management withdrew this guidance.'); continue; }
    const ps = periodStatusOf(win.period, win.pkind, win.market, win.src.date || (win.gc?.announcedAt ?? null), now);
    if (ps.status === 'EXPIRED') { pushInactive(e, win, 'EXPIRED', ps.reason); continue; }
    const history: Prior[] = [...win.priors, ...eligible.slice(1).map((l) => ({ date: l.src.date || '', low: l.low, high: l.high, note: l.src.name }))].filter((p) => p.date);
    (activeByEntity.get(e) || activeByEntity.set(e, []).get(e)!).push({ it: win, history, note: ps.note, ps });
  }
  const records: GuUniverseRecordX[] = [];
  for (const [e, act] of Array.from(activeByEntity.entries())) {
    const pts = act.map((a) => ({ ...a, pt: pointOf(a.it, a.history, a.ps), cls: classOf(a.it.pkind) }));
    pts.sort((a, b) => METRIC_ORDER[a.it.metric] - METRIC_ORDER[b.it.metric] || PERIOD_CLASS_ORDER[a.cls] - PERIOD_CLASS_ORDER[b.cls]
      || (periodEnd(a.it.period, a.it.market, a.it.src.date).end?.getTime() ?? 9e15) - (periodEnd(b.it.period, b.it.market, b.it.src.date).end?.getTime() ?? 9e15));
    // headline = the best revenue point (annual before multi-year), else the next metric in order
    const head = pts[0]; const rest = pts.slice(1);
    const base = head.it;
    const gc = base.gc ? { ...base.gc } : companyOf(base, pts.map((p) => p.it), head.pt, e);
    const tracking = pts.map((p) => p.it.gc?.reality?.tracking).find((t) => t === 'AT_RISK' || t === 'BROKEN');
    const company = base.company;
    const rec: GuUniverseRecordX = {
      record: gc, origin: base.origin, display: head.pt.display, metric: base.metric,
      alsoDisplay: rest.map((r) => ({ metric: r.it.metric, display: r.pt.display, verification: r.it.verification, period: r.it.period, sourceDate: r.it.src.date, sourceName: r.it.src.name, implied: r.pt.implied,
        secondaryDisplay: r.pt.secondaryDisplay, impliedDisplay: r.pt.impliedDisplay, periodStatus: r.pt.periodStatus, needsReview: r.pt.needsReview })) as GuUniverseRecord['alsoDisplay'],
      mediaOnly: base.verification === 'SECONDARY_ONLY', revision: head.pt.revision, atRisk: !!tracking,
      entityKey: e, tickers: Array.from(tickerSets.get(e) || []), names: Array.from(nameSets.get(e) || []), period: base.period, classification: head.cls, points: pts.map((p) => p.pt),
      sourceName: base.src.name, sourceType: base.src.type, sourceUrl: base.src.url, sourceDate: base.src.date, sourceRank: base.src.rank, primarySource: head.pt.primarySource,
      statement: base.statement, notes: base.notes, activeNote: head.note,
      periodUnclear: head.pt.periodStatus === 'UNKNOWN' || head.pt.periodInferred, periodStatus: head.pt.periodStatus, needsReview: head.pt.needsReview, secondaryDisplay: head.pt.secondaryDisplay, impliedDisplay: head.pt.impliedDisplay,
    };
    void company;
    records.push(rec);
  }
  records.sort((a, b) => (a.record.market === b.record.market ? 0 : a.record.market === 'IN' ? -1 : 1) || (b.points[0].compareValue ?? -1) - (a.points[0].compareValue ?? -1) || a.record.company.localeCompare(b.record.company));
  const stored: GuStoredPoint[] = [];
  for (const r of records) for (const p of r.points) {
    const it = activeByEntity.get(r.entityKey)!.find((a) => a.it.metric === p.metric && a.it.period === p.period)!.it;
    if (it.origin === 'RESEARCHED_SEED') continue;   // never frozen into the store: the data file is authoritative and re-read each time
    const slot = `${it.market}|${r.entityKey}|${it.metric}|${normPeriod(it.period)}`;
    stored.push({ key: `${slot}|${hash(`${it.src.url || it.src.name}|${it.src.date}|${p.display}`)}`, slot, market: it.market, ticker: it.ticker, company: it.company, metric: it.metric, low: it.low, high: it.high, open: it.open, gOrigin: it.gOrigin, abs: it.abs, base: it.base ?? null, needsReview: it.needsReview ?? null,
      period: it.period, pkind: it.pkind, kind: it.kind, organic: it.organic, verification: it.verification, statement: it.statement.slice(0, 300), src: it.src, priors: r.points.find((x) => x === p)!.priors.slice(-3), origin: it.origin, display: p.display });
  }
  return { records, inactive, excluded, stored };
}

/** What the page shows in a metric column: the figure, or '—' with 'not verified' when no such statement exists. Never infers PAT from revenue. */
export function metricCell(rec: GuUniverseRecordX, metric: GgMetric): { text: string; note: string | null; verification: GgVerification | null; period: string | null } {
  const p = rec.points.find((x) => x.metric === metric && x.periodKind !== 'MULTI_YEAR_CAGR') || rec.points.find((x) => x.metric === metric);
  if (!p) return { text: '—', note: 'not verified', verification: null, period: null };
  return { text: p.display, note: p.verification === 'VERIFIED' ? null : p.verification === 'PARTIALLY_VERIFIED' ? 'partly verified' : 'media only', verification: p.verification, period: p.period };
}

// ═══ summary ═══════════════════════════════════════════════════════════════════════════════════
/**
 * HIGH-GROWTH RULE (owner's spec, one function). Every high-growth list and count is computed from the rows returned here, never recomputed elsewhere.
 * A company is in when an ACTIVE record has a revenue (and, separately, a PAT) point that
 *  - has a % (a target amount with no % is never high-growth) whose comparison value is >= threshold (stated figure / midpoint of a closed range / lower bound of an open '80%+'),
 *  - is for a FY / CY / rolling-12M period (SINGLE_YEAR) or an explicit multi-year CAGR (MULTI_YEAR_CAGR, flagged 'CAGR, multi-year', listed after and counted apart from single-year),
 *  - is not a proxy (presales, bookings), is VERIFIED or PARTIALLY_VERIFIED, is not flagged 'needs review', and has a period that is ACTIVE with a stated year.
 * Order: single-year before CAGR, then highest comparison value first ('highest verified guidance', not 'best').
 */
export const HIGH_GROWTH_LABEL = 'Highest verified guidance' as const;
export const HIGH_GROWTH_RULE = 'Revenue or PAT growth at or above the threshold on the comparison value (stated figure, midpoint of a closed range, lower bound of an open range); active FY/CY/rolling-12M guidance, or an explicit multi-year CAGR listed separately; proxy metrics (presales, bookings), target amounts with no % stated, flagged and unverified-media records excluded.';
const hgMetric = (p: GuPoint): GuHighGrowthMetric => ({ display: p.display, compareValue: p.compareValue as number, period: p.period, verification: p.verification, implied: p.implied, impliedBase: p.implied ? p.impliedGrowth?.baseLabel ?? null : null });
export function selectHighGrowth(records: GuUniverseRecordX[], thr = 30): GuHighGrowthRowX[] {
  const rows: Array<Omit<GuHighGrowthRowX, 'rank'>> = [];
  for (const r of records) {
    for (const horizon of ['SINGLE_YEAR', 'MULTI_YEAR_CAGR'] as GuHighGrowthHorizon[]) {
      const q = (m: GgMetric) => r.points.filter((p) => p.metric === m && p.hg === horizon && p.compareValue != null && p.compareValue >= thr).sort((a, b) => (b.compareValue as number) - (a.compareValue as number))[0] || null;
      const rev = q('REVENUE'), pat = q('PAT'); if (!rev && !pat) continue;
      const head = !pat || (rev && (rev.compareValue as number) >= (pat.compareValue as number)) ? rev! : pat;
      rows.push({
        entityKey: r.entityKey, company: r.record.company, ticker: r.record.ticker || r.tickers[0] || null, market: r.record.market, horizon, horizonLabel: horizon === 'MULTI_YEAR_CAGR' ? 'CAGR, multi-year' : null,
        metric: head.metric, display: head.display, compareValue: head.compareValue as number, period: head.period, verification: head.verification, implied: head.implied, impliedBase: head.implied ? head.impliedGrowth?.baseLabel ?? null : null,
        id: `${r.entityKey}|${horizon}`, guidance: [rev ? `${rev.display} Revenue` : '', pat ? `${pat.display} PAT` : ''].filter(Boolean).join(' / '),
        alsoDisplay: head === rev && pat ? [{ metric: 'PAT', display: pat.display, verification: pat.verification }] : head === pat && rev ? [{ metric: 'REVENUE', display: rev.display, verification: rev.verification }] : [],
        periodUnclear: false, mediaOnly: false,
        revenue: rev ? hgMetric(rev) : null, pat: pat ? hgMetric(pat) : null, revision: head.revision, sourceName: head.sourceName, sourceDate: head.sourceDate, sourceUrl: head.sourceUrl, label: HIGH_GROWTH_LABEL,
      });
    }
  }
  rows.sort((a, b) => (a.horizon === b.horizon ? 0 : a.horizon === 'SINGLE_YEAR' ? -1 : 1) || b.compareValue - a.compareValue || (a.verification === b.verification ? 0 : a.verification === 'VERIFIED' ? -1 : b.verification === 'VERIFIED' ? 1 : 0) || a.company.localeCompare(b.company));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
function marketSummary(rs: GuUniverseRecordX[], hg: GuHighGrowthRowX[]): GuMarketSummary {
  const keys = new Set(rs.map((r) => r.entityKey)); const mine = hg.filter((h) => keys.has(h.entityKey)); const single = mine.filter((h) => h.horizon === 'SINGLE_YEAR');
  return { companies: rs.length, revenueGe30: single.filter((h) => h.revenue).length, patGe30: single.filter((h) => h.pat).length, multiMetric: single.filter((h) => h.revenue && h.pat).length, cagrMultiYear: mine.filter((h) => h.horizon === 'MULTI_YEAR_CAGR').length };
}
function bucketOf(rs: GuUniverseRecordX[], hg: GuHighGrowthRowX[]): GuUniverseBucket {
  const keys = new Set(rs.map((r) => r.entityKey)); const rev = hg.filter((h) => keys.has(h.entityKey) && h.horizon === 'SINGLE_YEAR' && h.revenue);
  const best = rev.slice().sort((a, b) => (b.revenue!.compareValue - a.revenue!.compareValue))[0];
  const m = marketSummary(rs, hg);
  return { companies: m.companies, revenueGte30: m.revenueGe30, patGte30: m.patGe30, revenueAndPatGte30: m.multiMetric, highestRevenue: best ? { company: best.company, display: best.revenue!.display } : null };
}
export interface GuSummaryX extends Omit<GuUniverseSummary, keyof GuSummaryAdditions>, GuSummaryAdditions { all: GuUniverseSummary['all'] & { pendingPrimary: number } }
export function summarize(records: GuUniverseRecordX[], now: Date, threshold = 30, inactive: GuInactiveRecord[] = []): GuSummaryX {
  const hg = selectHighGrowth(records, threshold); const inM = (m: 'IN' | 'US') => records.filter((r) => r.record.market === m);
  const allPoints = records.flatMap((r) => r.points);
  return {
    asOf: now.toISOString(), threshold,
    india: bucketOf(inM('IN'), hg), usa: bucketOf(inM('US'), hg),
    all: {
      active: records.length, raised: records.filter((r) => r.revision === 'RAISED').length, maintained: records.filter((r) => r.revision === 'MAINTAINED').length, cut: records.filter((r) => r.revision === 'LOWERED').length,
      atRisk: records.filter((r) => r.atRisk).length, mediaOnly: records.filter((r) => r.mediaOnly).length, pendingPrimary: records.filter((r) => !r.points.some((p) => p.primarySource)).length,
    },
    byMarket: { IN: marketSummary(inM('IN'), hg), US: marketSummary(inM('US'), hg), ALL: marketSummary(records, hg) },
    highGrowth: hg, highGrowthLabel: HIGH_GROWTH_LABEL, highGrowthRule: HIGH_GROWTH_RULE,
    expiredCount: inactive.filter((x) => x.status === 'EXPIRED').length,
    unknownPeriodCount: allPoints.filter((p) => p.periodStatus === 'UNKNOWN').length,
    awaitingVerificationCount: records.filter((r) => r.points.some((p) => p.awaitingVerification && p.compareValue != null && p.compareValue >= threshold)).length,
    needsReviewCount: allPoints.filter((p) => p.needsReview).length,
  };
}

// ═══ regression: the owner's list vs what the sources say ═══════════════════════════════════════
export const REGRESSION_TOLERANCE_PP = 2;
/** An owner figure this close to (or below) an earlier guidance figure is read as 'quoting the earlier target'. */
export const PRIOR_NEIGHBOURHOOD_PP = 10;
export interface GuOwnerClaim { low: number; high: number | null; text: string }
/** Reads '35-40% Top line', '80%+revenue', '60% revenue and 70% PAT', '40% Growth topline and Bottomline' into per-metric claims. A figure with no metric word is read as revenue. */
export function parseOwnerText(text: string): Partial<Record<GgMetric, GuOwnerClaim>> {
  const out: Partial<Record<GgMetric, GuOwnerClaim>> = {};
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*%(\+)?/gi;
  const hits: Array<{ m: RegExpExecArray; end: number }> = []; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) hits.push({ m, end: m.index + m[0].length });
  hits.forEach((h, i) => {
    const after = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].m.index : text.length);
    const rev = /\b(revenue|top[- ]?line|sales)\b/i.test(after), pat = /\b(pat|profit|bottom[- ]?line)\b/i.test(after);
    const ms: GgMetric[] = rev || pat ? [...(rev ? (['REVENUE'] as GgMetric[]) : []), ...(pat ? (['PAT'] as GgMetric[]) : [])] : ['REVENUE'];
    const lo = parseFloat(h.m[1]), hi = h.m[2] ? parseFloat(h.m[2]) : null;
    const claim: GuOwnerClaim = h.m[3] ? { low: lo, high: null, text: `${fnum(lo)}%+` } : hi != null ? { low: lo, high: hi, text: `${fnum(lo)}–${fnum(hi)}%` } : { low: lo, high: lo, text: `${fnum(lo)}%` };
    for (const mm of ms) if (!out[mm]) out[mm] = claim;
  });
  return out;
}
const overlaps = (o: GuOwnerClaim, fLow: number, fHigh: number | null, tol: number) => o.low - tol <= (fHigh ?? Infinity) && (o.high ?? Infinity) + tol >= fLow;
const emptyCounts = (): Record<GuRegressionStatus, number> => ({ VERIFIED: 0, PARTIALLY_VERIFIED: 0, NOT_FOUND: 0, REJECTED: 0, SUPERSEDED: 0, EXPIRED: 0 });
export interface GuRegressionRowX extends GuRegressionRow { sourceUrl: string | null; verification: GgVerification | null; foundOrigin: GuUniverseRecordOrigin | null }
export interface GuRegressionResponseX extends GuRegressionResponse { rows: GuRegressionRowX[] }
export interface GuOwnerRow { ownerText: string; company?: string; ticker?: string | null; market?: 'IN' | 'US'; metric?: GgMetric }

/** Pure. One row per owner statement (per metric). `ownerRows` default: every researched row that carries the owner's original text. */
export function buildRegression(seedRows: GuSeedRow[], universe: Pick<GuUniverseBuild, 'records'> & Partial<Pick<GuUniverseBuild, 'inactive'>>, now: Date, ownerRows?: GuOwnerRow[]): GuRegressionResponseX {
  const owners: Array<{ o: GuOwnerRow; seed: GuSeedRow | null; metric: GgMetric }> = [];
  if (ownerRows) {
    for (const o of ownerRows) {
      const claims = parseOwnerText(o.ownerText); const wanted = o.metric ? [o.metric] : (Object.keys(claims) as GgMetric[]);
      for (const metric of wanted.length ? wanted : (['REVENUE'] as GgMetric[])) {
        const seed = seedRows.find((s) => s.metric === metric && ((o.ticker && s.ticker === o.ticker) || (o.company && normCompanyName(s.company) === normCompanyName(o.company)))) || null;
        owners.push({ o, seed, metric });
      }
    }
  } else for (const s of seedRows) if (s.ownerListText) owners.push({ o: { ownerText: s.ownerListText, company: s.company, ticker: s.ticker, market: s.market, metric: s.metric }, seed: s, metric: s.metric });
  const rows: GuRegressionRowX[] = [];
  for (const { o, seed, metric } of owners) {
    const company = seed?.company || o.company || 'Unknown company'; const ticker = seed?.ticker ?? o.ticker ?? null; const market = seed?.market || o.market || 'IN';
    const claim = parseOwnerText(o.ownerText)[metric] || null;
    const expected = claim ? `${claim.text} ${METRIC_WORD[metric]}` : o.ownerText;
    const nm = normCompanyName(company);
    const rec = universe.records.find((r) => r.record.market === market && ((ticker && r.tickers.includes(ticker)) || r.names.includes(nm)));
    const pts = rec ? rec.points.filter((p) => p.metric === metric) : [];
    const pt = pts.find((p) => seed && normPeriod(p.period) === normPeriod(seed.period)) || pts[0] || null;
    const base = { ownerText: o.ownerText, company, ticker, market, expected };
    const row = (status: GuRegressionStatus, reason: string, found = '—', p: GuPoint | null = null): GuRegressionRowX => ({
      ...base, found, source: p?.sourceName ?? null, sourceDate: p?.sourceDate ?? null, period: p?.period ?? null, metric: p ? metric : null, status, reason, sourceUrl: p?.sourceUrl ?? null, verification: p?.verification ?? null, foundOrigin: p?.origin ?? null,
    });
    if (!pt) {
      const inact = (universe.inactive || []).find((x) => x.market === market && x.metric === metric && (x.ticker === ticker || normCompanyName(x.company) === nm) && (!seed || normPeriod(x.period) === normPeriod(seed.period)));
      if (inact && inact.status === 'EXPIRED') { rows.push({ ...row('EXPIRED', `The guidance found was for ${inact.period}, which has ended. No newer guidance was found.`, `${inact.display} ${METRIC_WORD[metric]} (${inact.period})`), source: inact.sourceName, sourceDate: inact.sourceDate, period: inact.period, metric }); continue; }
      if (inact && inact.status === 'SUPERSEDED') { rows.push({ ...row('SUPERSEDED', 'A later record replaced this guidance.', `${inact.display} ${METRIC_WORD[metric]} (${inact.period})`), source: inact.sourceName, sourceDate: inact.sourceDate, period: inact.period, metric }); continue; }
      const why = seed && seed.verification === 'UNVERIFIED' ? `No source we could read says this. ${seed.notes.replace(/^CONFLICT:\s*/i, '').slice(0, 240)}` : 'No source found for this company and metric.';
      rows.push({ ...row('NOT_FOUND', why), period: seed?.period ?? null, metric });
      continue;
    }
    const found = `${pt.display} ${METRIC_WORD[metric]} (${pt.period})`;
    if (pt.sourceRank >= 11) { rows.push(row('NOT_FOUND', `Only a ${pt.sourceRank === 12 ? 'social-media post' : 'blog or forum post'} gives a figure (${pt.display}). That is not a usable source, so the claim is not confirmed.`, found, pt)); continue; }
    if (pt.low == null) { rows.push(row('PARTIALLY_VERIFIED', `The source gives a rupee or dollar target but no growth percent, so your ${expected} cannot be checked against it.`, found, pt)); continue; }
    if (!claim) { rows.push(row('PARTIALLY_VERIFIED', 'The list text gives no figure that can be compared.', found, pt)); continue; }
    const matches = overlaps(claim, pt.low, pt.open ? null : pt.high, REGRESSION_TOLERANCE_PP);
    const who = pt.primarySource ? `The company's own ${pt.sourceType.toLowerCase()}` : 'Media or commentary';
    if (matches) {
      const caveats: string[] = [];
      if (pt.periodKind === 'MULTI_YEAR_CAGR') caveats.push('The source gives a multi-year growth rate, not a single-year figure, so the period does not match.');
      if (pt.proxy) caveats.push(`The figure is for ${pt.proxy}, not reported revenue.`);
      if (pt.implied) caveats.push('The growth is worked out from a target amount, not stated as a percent by management.');
      if (pt.needsReview) caveats.push(`Flagged for review: ${pt.needsReview}`);
      const full = pt.verification === 'VERIFIED' && !pt.needsReview && !caveats.some((c) => !/worked out/.test(c));
      if (full) rows.push(row('VERIFIED', `${who} (${pt.sourceDate || 'undated'}) says ${pt.display}. The list figure ${claim.text} is within ${REGRESSION_TOLERANCE_PP} points.${caveats.length ? ` ${caveats.join(' ')}` : ''}`, found, pt));
      else rows.push(row('PARTIALLY_VERIFIED', `${pt.primarySource ? `${who} (${pt.sourceDate || 'undated'}) says ${pt.display}.` : `Only media or commentary backs this. It says ${pt.display}.`} The list figure ${claim.text} is within ${REGRESSION_TOLERANCE_PP} points.${pt.primarySource ? '' : " The company's own filing or transcript has not been read yet."}${caveats.length ? ` ${caveats.join(' ')}` : ''}`, found, pt));
      continue;
    }
    // number does not match: is the owner quoting an earlier target that management has since raised?
    const prior = pt.priors.filter((p) => p.low != null).find((p) => claim.low <= (p.high ?? p.low!) + PRIOR_NEIGHBOURHOOD_PP && claim.low >= (p.low as number) - PRIOR_NEIGHBOURHOOD_PP - REGRESSION_TOLERANCE_PP && pt.low! > (claim.high ?? claim.low));
    if (prior) { rows.push(row('SUPERSEDED', `The list figure ${claim.text} is close to the earlier target (${fmtPrior(prior)}, ${prior.date}). Management has since raised guidance to ${pt.display}.${pt.needsReview ? ` Flagged for review: ${pt.needsReview}` : ''}`, found, pt)); continue; }
    const soft = pt.verification !== 'VERIFIED' || !pt.primarySource ? ` This rests on ${pt.primarySource ? 'a partly verified' : 'a media or secondary'} source and the company's own transcript has not been read, so it is the best figure found so far, not a final answer.` : '';
    const note = seed?.notes ? ` Researcher note: ${seed.notes.replace(/^CONFLICT:\s*/i, '').slice(0, 260)}` : '';
    rows.push(row('REJECTED', `${who} says ${pt.display}. The list says ${claim.text}. The gap is more than ${REGRESSION_TOLERANCE_PP} points.${pt.implied ? ' The source figure is worked out from a target amount.' : ''}${pt.needsReview ? ` Flagged for review: ${pt.needsReview}` : ''}${soft}${note}`, found, pt));
  }
  const counts = emptyCounts(); for (const r of rows) counts[r.status]++;
  return { asOf: now.toISOString(), rows, counts };
}
