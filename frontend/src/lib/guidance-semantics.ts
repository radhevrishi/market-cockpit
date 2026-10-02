// zzz860 — GUIDANCE SEMANTICS. One pure module (no I/O, no company names, no clock) for the rules the Guidance Upgrades page and the universe share:
//   1. calculation type (HOW the number was got) is separate from verification status (HOW SURE we are of it)
//   2. wording: "Company stated" is only ever used when the company's own document was read
//   3. freshness: one rule (fresh / aging / stale) for every badge, count and list
//   4. event type: what a change IS (raised, lowered, range restructure, reiteration, capital raise, not guidance ...) apart from how big it is
//   5. comparison key: company + metric + period + basis. Two numbers with a different key are never compared.
//   6. scope: which market(s) a heading or count is about
import { AGING_MAX_DAYS, FRESH_MAX_DAYS } from './guidance-config';

// ── 1. calculation type vs verification status ───────────────────────────────────────────────────────────────────────
export type GuCalculationType = 'explicit' | 'derived' | 'implied' | 'amount_only' | 'range';
export type GuVerificationStatus = 'unverified' | 'secondary_only' | 'primary_verified' | 'partly_verified' | 'contradicted' | 'stale';

export function calculationTypeOf(i: { growthType?: string | null; isRange?: boolean | null; hasPercent?: boolean | null }): GuCalculationType {
  const g = String(i.growthType || '').toUpperCase();
  if (g === 'DERIVED') return 'derived';
  if (g === 'IMPLIED') return 'implied';
  if (g === 'EXPLICIT') return i.isRange ? 'range' : 'explicit';
  return i.hasPercent ? (i.isRange ? 'range' : 'explicit') : 'amount_only';
}

export interface GuVerifyIn {
  /** the company's own document (or an exchange / SEC filing) was found AND read */ primaryRead: boolean | null | undefined;
  /** tier 3-4 = media, other = social: number 1..4 (1 is best) */ tier?: number | null;
  /** the legacy / state label the universe computed */ state?: string | null;
  /** a newer primary-source event or the AI verifier disagrees */ contradicted?: boolean | null;
  /** days since the last verification */ ageDays?: number | null;
  /** the record's own researcher label (SECONDARY_ONLY etc.) */ legacy?: string | null;
}
export function verificationStatusOf(i: GuVerifyIn): GuVerificationStatus {
  if (i.contradicted) return 'contradicted';
  const tier = i.tier ?? 4;
  const secondary = tier >= 3 || String(i.legacy || '').toUpperCase() === 'SECONDARY_ONLY';
  let st: GuVerificationStatus;
  if (!i.primaryRead) st = secondary ? 'secondary_only' : 'unverified';
  else st = String(i.state || '').toUpperCase() === 'PARTIAL' || String(i.state || '').toUpperCase() === 'PERIOD_UNCLEAR' ? 'partly_verified' : String(i.state || '').toUpperCase() === 'UNVERIFIED' ? 'unverified' : 'primary_verified';
  if ((st === 'primary_verified' || st === 'partly_verified') && freshnessOf(i.ageDays).tier === 'STALE') return 'stale';
  return st;
}
export const VERIFICATION_STATUS_TEXT: Record<GuVerificationStatus, string> = {
  unverified: 'Not verified', secondary_only: 'Media / secondary source only', primary_verified: "Verified against the company's own document",
  partly_verified: "Partly verified (company document read, some detail not confirmed)", contradicted: "Contradicted by a newer or the company's own document", stale: 'Verified earlier; needs a fresh check',
};
export const CALCULATION_TYPE_TEXT: Record<GuCalculationType, string> = {
  explicit: 'Percent given directly', derived: 'Calculated from stated amounts', implied: 'Implied (no stated percent, base not sourced)', amount_only: 'Target amount only (growth not stated)', range: 'Range given directly',
};

// ── 2. wording ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The sentence that says WHERE a guidance figure comes from. 'Company stated' only when the primary document was read. */
export function guidanceWording(status: GuVerificationStatus | null | undefined, calc: GuCalculationType | null | undefined): string {
  const s = status ?? 'unverified'; const c = calc ?? 'explicit';
  if (s === 'contradicted') return "Contradicted by the company's own document or a newer filing";
  if (s === 'primary_verified' || s === 'partly_verified' || s === 'stale') {
    const tail = s === 'partly_verified' ? ' (partly verified)' : s === 'stale' ? ' (verified earlier; re-check due)' : '';
    if (c === 'derived') return `Derived from company-stated amounts${tail}`;
    if (c === 'implied') return `Implied from a company target amount; base not sourced${tail}`;
    if (c === 'amount_only') return `Company stated a target amount; growth not stated${tail}`;
    return `Company stated${tail}`;
  }
  if (s === 'secondary_only') return c === 'derived' || c === 'implied' || c === 'amount_only' ? 'Calculated from amounts a secondary source reports; primary source not yet verified' : 'Secondary source attributes this guidance to management';
  return c === 'derived' || c === 'implied' || c === 'amount_only' ? 'Calculated from reported amounts; primary source not yet verified' : 'Media-reported claim; primary source not yet verified';
}

// ── 3. freshness (the one rule) ────────────────────────────────────────────────────────────────────────────────────────────
export type GuFreshnessTier = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';
export function freshnessOf(ageDays: number | null | undefined): { tier: GuFreshnessTier; text: string; stale: boolean } {
  if (ageDays == null || !Number.isFinite(ageDays) || ageDays < 0) return { tier: 'UNKNOWN', text: 'unknown', stale: false };
  if (ageDays <= FRESH_MAX_DAYS) return { tier: 'FRESH', text: 'fresh', stale: false };
  if (ageDays <= AGING_MAX_DAYS) return { tier: 'AGING', text: 'aging', stale: false };
  return { tier: 'STALE', text: 'stale', stale: true };
}
export const FRESHNESS_RULE = `Fresh: verified in the last ${FRESH_MAX_DAYS} days. Aging: ${FRESH_MAX_DAYS + 1} to ${AGING_MAX_DAYS} days. Stale: more than ${AGING_MAX_DAYS} days.`;
export function freshnessCounts(ages: Array<number | null | undefined>): Record<GuFreshnessTier, number> {
  const c: Record<GuFreshnessTier, number> = { FRESH: 0, AGING: 0, STALE: 0, UNKNOWN: 0 };
  for (const a of ages) c[freshnessOf(a).tier]++;
  return c;
}

// ── 4. event type ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type GuEventType = 'CAPITAL_RAISE' | 'REITERATION' | 'FIRST_GUIDANCE' | 'GUIDANCE_RAISED' | 'GUIDANCE_LOWERED' | 'RANGE_RESTRUCTURE' | 'NOT_GUIDANCE' | 'UNRESOLVED' | 'WITHDRAWAL' | 'EXPIRED' | 'UNKNOWN' | 'NEW_GUIDANCE';
export interface GuRangeIn { low: number | null; high: number | null }
export interface GuChangeIn {
  text?: string | null; company?: string | null;
  metric?: string | null; period?: string | null; basis?: string | null;
  prev?: (GuRangeIn & { metric?: string | null; period?: string | null; basis?: string | null }) | null;
  curr?: GuRangeIn | null;
  /** the guided period has ended */ periodEnded?: boolean | null;
}
export interface GuChangeOut { type: GuEventType; lowDelta: number | null; highDelta: number | null; midDelta: number | null; narrower: boolean; wider: boolean; comparable: boolean; reason: string }
const CAPITAL_WORDS = /\b(bonds?|debentures?|ncds?|notes?\s+offering|senior\s+notes|convertible|qip|rights\s+issue|fpo|ipo|ecb|term\s+loan|fund-?rais\w*|raises?\s+(?:rs\.?|inr|usd|us\$|\$|₹)?\s?[\d.,]+\s*(?:bn|billion|million|mn|crore|cr)\b[^.]{0,40}\b(?:bond|debenture|note|loan|debt|funds?|capital|ncd))/i;
const GUIDANCE_CUES = /\b(guid\w*|outlook|forecast\w*|expects?|expected|targets?|projects?|anticipat\w*)\b[^.]{0,60}\b(revenue|sales|ebitda|pat|profit|earnings|eps|growth|margin|income)\b|\b(revenue|sales|ebitda|pat|profit|earnings|eps|growth|margin)\b[^.]{0,40}\b(guid\w*|outlook|forecast\w*|target\w*)\b/i;
const WITHDRAW = /\b(withdr[ae]w\w*|suspend\w*|no longer (?:provid|issu)\w*|rescind\w*|discontinu\w*)\b[^.]{0,40}\b(guid\w*|outlook|forecast\w*)\b|\b(guid\w*|outlook)\b[^.]{0,40}\b(withdr[ae]w\w*|suspend\w*|withdrawn)\b/i;
const REITERATE = /\b(reiterat\w*|reaffirm\w*|maintain\w*|unchanged|re-?confirm\w*|stays?\s+at|remains?\s+at)\b/i;
const EPS = 0.0001;
const same = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < EPS;

/** Normalised comparison key: company + metric + period + basis. The same string means two figures may be compared; any difference means they may not. */
export function comparisonKey(i: { company?: string | null; ticker?: string | null; metric?: string | null; period?: string | null; basis?: string | null }): string {
  const co = String(i.ticker || i.company || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const per = String(i.period || 'UNSTATED').toUpperCase().replace(/\s+/g, '').replace(/^FY20(\d\d)$/, 'FY$1').replace(/^CY20(\d\d)$/, 'CY$1');
  const bas = String(i.basis || 'UNSTATED').toUpperCase().replace(/[^A-Z]+/g, '');
  return `${co}|${String(i.metric || 'UNKNOWN').toUpperCase()}|${per}|${bas}`;
}
export function comparable(a: Parameters<typeof comparisonKey>[0], b: Parameters<typeof comparisonKey>[0]): boolean {
  const ka = comparisonKey(a), kb = comparisonKey(b);
  // an UNSTATED basis on one side may meet any basis on the other (it is not a contradiction); metric, period and company must match exactly
  const [ca, ma, pa, ba] = ka.split('|'); const [cb, mb, pb, bb] = kb.split('|');
  return ca === cb && ma === mb && pa === pb && pa !== 'UNSTATED' && (ba === bb || ba === 'UNSTATED' || bb === 'UNSTATED');
}

/** What a guidance change IS. Direction comes from the numbers (low end and high end separately), never from the headline's verbs. */
export function classifyGuidanceChange(i: GuChangeIn): GuChangeOut {
  const text = String(i.text || '');
  const none = (type: GuEventType, reason: string, comparableFlag = false): GuChangeOut => ({ type, lowDelta: null, highDelta: null, midDelta: null, narrower: false, wider: false, comparable: comparableFlag, reason });
  if (WITHDRAW.test(text)) return none('WITHDRAWAL', 'The company withdrew or suspended its guidance.');
  const cur = i.curr; const has = !!cur && (cur.low != null || cur.high != null);
  if (CAPITAL_WORDS.test(text) && !GUIDANCE_CUES.test(text)) return none('CAPITAL_RAISE', 'This is a funding event (bond, loan or share sale), not guidance.');
  if (i.periodEnded) return none('EXPIRED', 'The guided period has ended.');
  if (!has) return none(GUIDANCE_CUES.test(text) || REITERATE.test(text) ? 'UNRESOLVED' : 'NOT_GUIDANCE', GUIDANCE_CUES.test(text) ? 'Guidance wording found, but no figure could be read.' : 'No guidance figure in this text.');
  if (!i.period || !String(i.period).trim()) return none('UNRESOLVED', 'The guided period is not stated.');
  const lo = cur!.low ?? cur!.high; const hi = cur!.high ?? cur!.low;
  const prev = i.prev;
  if (!prev || (prev.low == null && prev.high == null)) {
    if (REITERATE.test(text)) return { type: 'REITERATION', lowDelta: null, highDelta: null, midDelta: null, narrower: false, wider: false, comparable: false, reason: 'Management repeated its guidance; no earlier figure is on file to compare.' };
    return none('FIRST_GUIDANCE', 'The first guidance on file for this company, metric and period.');
  }
  const cmpOk = comparable({ company: i.company, metric: i.metric, period: i.period, basis: i.basis }, { company: i.company, metric: prev.metric ?? i.metric, period: prev.period ?? i.period, basis: prev.basis ?? i.basis });
  if (!cmpOk) return none('NEW_GUIDANCE', 'The earlier figure is for a different metric, period or basis, so the two are not compared.');
  const plo = prev.low ?? prev.high; const phi = prev.high ?? prev.low;
  const dLo = lo! - plo!, dHi = hi! - phi!;
  const dMid = (lo! + hi!) / 2 - (plo! + phi!) / 2;
  const wid = hi! - lo!, pwid = phi! - plo!;
  const base = { lowDelta: dLo, highDelta: dHi, midDelta: dMid, narrower: wid < pwid - EPS, wider: wid > pwid + EPS, comparable: true };
  if (same(lo!, plo!) && same(hi!, phi!)) return { type: 'REITERATION', ...base, reason: 'Same figure as the earlier guidance.' };
  const up = dLo > EPS || dHi > EPS, down = dLo < -EPS || dHi < -EPS;
  if (up && !down) return { type: 'GUIDANCE_RAISED', ...base, reason: 'Both ends of the range moved up (or stayed).' };
  if (down && !up) return { type: 'GUIDANCE_LOWERED', ...base, reason: 'Both ends of the range moved down (or stayed).' };
  return { type: 'RANGE_RESTRUCTURE', ...base, reason: `The low end moved ${dLo > 0 ? 'up' : 'down'} while the high end moved ${dHi > 0 ? 'up' : 'down'}; the range is ${base.narrower ? 'narrower' : base.wider ? 'wider' : 'shifted'}. Not a clean raise or cut.` };
}
/** The reviewer-facing event type for the existing event engine's status kind (RAISED / REITERATED / LOWERED / MIXED / INVALID / NO_NUMBERS). */
export function eventTypeOfStatus(status: string | null | undefined, reason?: string | null): GuEventType {
  switch (String(status || '').toUpperCase()) {
    case 'RAISED': return 'GUIDANCE_RAISED'; case 'REITERATED': return 'REITERATION'; case 'LOWERED': return 'GUIDANCE_LOWERED'; case 'MIXED': return 'RANGE_RESTRUCTURE';
    case 'INVALID': return /capital|bond|debenture|fund|loan|issue/i.test(String(reason || '')) ? 'CAPITAL_RAISE' : 'NOT_GUIDANCE';
    case 'NO_NUMBERS': return 'UNRESOLVED'; default: return 'UNKNOWN';
  }
}

// ── 6. scope ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type GuScope = 'ALL' | 'IN' | 'US';
export const SCOPE_WORD: Record<GuScope, string> = { ALL: 'ALL MARKETS', IN: 'INDIA', US: 'USA' };
export const SCOPE_NOTE: Record<GuScope, string> = { ALL: 'India and USA together', IN: 'India only', US: 'USA only' };
/** 'HIGHEST ACTIVE GUIDANCE — ALL MARKETS' */
export const scopedTitle = (title: string, scope: GuScope): string => `${title.replace(/\s*[—-]\s*(ALL MARKETS|INDIA|USA)\s*$/i, '')} — ${SCOPE_WORD[scope]}`;
