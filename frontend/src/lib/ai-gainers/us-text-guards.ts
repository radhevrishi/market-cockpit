// ═══════════════════════════════════════════════════════════════════════════
// US TEXT GUARDS (zzz840) — small, pure, deterministic helpers shared by the
// US card / taxonomy / extractor:
//   · repairSplitText     — "Septemb er 28, 2 026" -> "September 28, 2026"
//   · hasNegatedTrigger   — "did not repurchase any shares" is not a buyback
//   · parseAmountsM       — full-dollar and scaled amounts, ranges, in $ millions
//   · primaryCatalystScore— current-period, quantified, guidance / results beat
//                           a background mention (no AI, no price)
// Nothing here invents a number: a value is returned only when it is written.
// ═══════════════════════════════════════════════════════════════════════════

const MONTHS = ['January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ANY = 'January|February|March|April|May|June|July|August|September|October|November|December';

/** Every split of a known month name into two fragments of 2+ letters, only when a day/year number follows. */
const MONTH_SPLITS: Array<{ re: RegExp; to: string }> = [];
for (const m of MONTHS) {
  for (let i = 2; i <= m.length - 2; i++) {
    MONTH_SPLITS.push({ re: new RegExp(`\\b${m.slice(0, i)}\\s${m.slice(i)}(?=\\s*\\d)`, 'g'), to: m });
  }
}
const YEAR_AFTER_DATE = new RegExp(`\\b((?:${MONTH_ANY})\\s+\\d{1,2},?\\s+)(20|19)\\s(\\d\\d)\\b`, 'g');
const YEAR_AFTER_DATE_2 = new RegExp(`\\b((?:${MONTH_ANY})\\s+\\d{1,2},?\\s+)([12])\\s(0\\d\\d)\\b`, 'g');
const YEAR_AFTER_FY = /\b((?:fiscal(?: year)?|FY|calendar(?: year)?|year ended|quarter ended)\s+)(20|19)\s(\d\d)\b/gi;
const YEAR_LEADING_ZERO = /\b(2)\s(0[0-9]{2})\b(?!\s*(?:,\d|\.\d|%))/g;

/** Repair month names and years that text extraction split with a stray space. Conservative: known months, 4-digit years only. */
export function repairSplitText(text: string): string {
  let t = String(text || '');
  if (!t || !/[A-Za-z0-9]\s[A-Za-z0-9]/.test(t)) return t;
  for (const { re, to } of MONTH_SPLITS) t = t.replace(re, to);
  t = t.replace(YEAR_AFTER_DATE, (_m, a, b, c) => `${a}${b}${c}`)
    .replace(YEAR_AFTER_DATE_2, (_m, a, b, c) => `${a}${b}${c}`)
    .replace(YEAR_AFTER_FY, (_m, a, b, c) => `${a}${b}${c}`)
    .replace(YEAR_LEADING_ZERO, (_m, a, b) => `${a}${b}`);
  return t;
}

// ── negation ───────────────────────────────────────────────────────────────

const NEGATOR_TAIL = /\b(?:did not|didn['’]t|does not|do not|has not|have not|had not|hasn['’]t|haven['’]t|will not|won['’]t|would not|not|no|never|without|neither|nor|cannot|can not)(?!\s+only)\b(?:\s+[\w'’-]+){0,4}\s*$/i;

/** True when the words just before `index` negate the trigger ("did not repurchase", "no material contract", "has not received"). */
export function negatedAt(sentence: string, index: number): boolean {
  const before = String(sentence || '').slice(Math.max(0, index - 60), index);
  return NEGATOR_TAIL.test(before);
}

/** True when the FIRST match of any regex in the sentence is negated by the words before it. */
export function hasNegatedTrigger(sentence: string, res: RegExp[]): boolean {
  let at = Infinity;
  for (const re of res) { const m = new RegExp(re.source, re.flags.replace('g', '')).exec(sentence); if (m && m.index < at) at = m.index; }
  return Number.isFinite(at) && negatedAt(sentence, at);
}

/** "we did not repurchase any shares ... pursuant to our share repurchase program", "no repurchases", "had no shares repurchased". */
export const NO_REPURCHASE = /\b(?:did not|didn['’]t|do not|does not|has not|have not|had not|will not|not|no|never)\b(?:\s+[\w'’-]+){0,3}?\s+(?:repurchas\w*|purchas\w*|buy(?:ing)?\s+back|bought back)\b|\bno\s+(?:shares?|common stock|stock)\b[^.;]{0,40}\b(?:repurchas|purchas|bought back)\w*|\bno\s+(?:share\s+|stock\s+)?(?:repurchases?|buybacks?)\b|\bnot\s+(?:made|effected|executed)\s+any\s+(?:share\s+|stock\s+)?(?:repurchases?|purchases?)\b|\bwithout\s+(?:any\s+)?(?:share\s+)?repurchas/i;

/** A neutral fact for the card, never a catalyst. */
export function noRepurchaseFact(sentence: string): boolean { return NO_REPURCHASE.test(sentence); }

// ── amounts ────────────────────────────────────────────────────────────────

export interface AmountM { m: number; text: string; index: number; unit: 'billion' | 'million' | 'thousand' | 'full' }

const AMT = /(?:US|U\.S\.)?\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(billion|bn|million|mm|mn|thousand|[BMK])(?![A-Za-z]))?/gi;

function toM(num: string, unit: string | undefined): { m: number; unit: AmountM['unit'] } | null {
  const v = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(v) || v <= 0) return null;
  const u = (unit || '').toLowerCase();
  if (u === 'billion' || u === 'bn' || u === 'b') return { m: v * 1000, unit: 'billion' };
  if (u === 'million' || u === 'mm' || u === 'mn' || u === 'm') return { m: v, unit: 'million' };
  if (u === 'thousand' || u === 'k') return { m: v / 1000, unit: 'thousand' };
  // full dollars ("$12,000,000", "$58,350,533"): a written amount, not a price/EPS
  if (!u && v >= 100_000) return { m: v / 1e6, unit: 'full' };
  return null;
}

/** Every dollar amount in the text that can be turned into $ millions: full-dollar, "$50.0 million", "$1.2 billion". EPS-like "$0.64" is skipped. */
export function parseAmountsM(text: string): AmountM[] {
  const out: AmountM[] = [];
  for (const m of String(text || '').matchAll(AMT)) {
    const r = toM(m[1], m[2]);
    if (r) out.push({ m: r.m, text: m[0].trim(), index: m.index ?? 0, unit: r.unit });
  }
  return out;
}

export interface RangeM { lowM: number; highM: number; midM: number; text: string }
/** "$410 to $420 Million" / "$410 million to $420 million" / "$410-$420 million". Midpoint only when both ends are in the same unit (a shared trailing unit counts). */
export function parseRangeM(text: string): RangeM | null {
  const re = /(?:US|U\.S\.)?\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(billion|bn|million|mm|mn|thousand))?\s*(?:to|-|–|—|and)\s*(?:US|U\.S\.)?\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|bn|million|mm|mn|thousand)?/i;
  const m = re.exec(String(text || ''));
  if (!m) return null;
  const uA = (m[2] || m[4] || '').toLowerCase(), uB = (m[4] || '').toLowerCase();
  const norm = (u: string) => (u === 'bn' ? 'billion' : /^(mm|mn)$/.test(u) ? 'million' : u);
  if (!uB) return null;                                        // no unit at the top end: not a stated range
  if (m[2] && norm(uA) !== norm(uB)) return null;              // different units at the two ends
  const a = toM(m[1], uA || uB), b = toM(m[3], uB);
  if (!a || !b || b.m < a.m) return null;
  return { lowM: a.m, highM: b.m, midM: (a.m + b.m) / 2, text: m[0].trim() };
}

/** "raised ... by $55 million at the midpoint" -> 55. Null when no raise amount is written. */
export function guidanceRaiseAmountM(text: string): { m: number; text: string } | null {
  const s = String(text || '');
  const m = /\b(?:rais(?:es|ed|ing)|increas(?:es|ed|ing)|lift(?:s|ed))\b[^.]{0,80}?\bby\s+(?:approximately\s+|about\s+)?((?:US|U\.S\.)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:billion|bn|million|mm|mn))?)[^.]{0,40}\b(?:at|of|to)\s+the\s+mid[- ]?point/i.exec(s)
    || /\b(?:an? )?(?:increase|raise)\s+of\s+((?:US|U\.S\.)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:billion|bn|million|mm|mn))?)[^.]{0,40}\bmid[- ]?point/i.exec(s)
    || /\bmid[- ]?point\b[^.]{0,40}\b(?:up|raised|increased|higher)\b[^.]{0,20}\bby\s+((?:US|U\.S\.)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:billion|bn|million|mm|mn))?)/i.exec(s);
  if (!m) return null;
  const a = parseAmountsM(m[1]);
  return a.length ? { m: a[0].m, text: m[1].trim() } : null;
}

// ── primary catalyst selection ──────────────────────────────────────────────

/** Background / company-description sentence: says what the product IS, not what happened. */
const BACKGROUND = /\b(?:is|are|was|remains?)\s+(?:the\s+)?(?:first|only|leading|largest|a leading|a global|a commercial[- ]stage|a clinical[- ]stage|an? [\w-]+ company)\b|\bnow approved in\b|\b(?:approved|cleared|marketed|available|commercially available) in (?:\w+ |\d+ )?(?:markets|countries|jurisdictions)\b|\bhas been approved\b|\bis (?:FDA|approved)[- ]approved\b|\bthe first (?:and only )?FDA[- ]approved\b|\bwhich (?:is|was) approved\b|\bpreviously (?:approved|announced)\b/i;
/** The event is stated as happening in the current period. */
const CURRENT_EVENT = /\b(?:today|announced today|is pleased to announce|announces?|announced that|has (?:received|announced|entered|completed|signed|been (?:granted|awarded|approved))|received (?:FDA )?(?:approval|clearance)|granted|reported|raises?|raised|reports?)\b/i;

export interface CatalystLike { id: string; sentence: string; figures?: string[]; category?: string; planned?: boolean; order?: number }

/** Deterministic score: current-period, quantified, guidance / results / deals above a background mention. Higher = the headline event. */
export function primaryCatalystScore(c: CatalystLike): number {
  const s = c.sentence || '';
  let score = 0;
  const id = c.id;
  if (/^guidance_(?:raise|cut|issued)$/.test(id)) score += 60;
  else if (/^(?:earnings_beat|earnings_miss|record_results|revenue_growth|revenue_decline|profit_growth|profit_decline|turned_profitable|eps_reported|growth_acceleration|margin_expansion|margin_compression)$/.test(id)) score += 50;
  else if (/^(?:acquisition|merger_agreement|takeover_bid|divestiture|major_contract|gov_contract|licensing|supply_agreement|buyback|dividend|equity_offering|convertible|debt_refinancing|settlement)$/.test(id)) score += 40;
  else score += 25;
  if ((c.figures || []).length) score += 15;
  if (parseAmountsM(s).length) score += 10;
  if (CURRENT_EVENT.test(s)) score += 10;
  if (c.planned) score -= 10;
  if (BACKGROUND.test(s)) score -= 45;
  if (/^(?:fda_approval|intl_approval|designation)$/.test(id)) score += FDA_CURRENT.test(s) && !BACKGROUND.test(s) ? 70 : -25;   // a NEW approval is the event; a state ("approved in three markets") is not
  return score;
}

/** An approval that happened in the current period is worded as an announcement, not as a state. */
export const FDA_CURRENT = /\b(?:announced today|today announced|announces?|is pleased to announce|has (?:received|been granted)|received|granted|approved|cleared|has approved|has granted)\b[^.]{0,80}\b(?:FDA|Food and Drug Administration)\b|\b(?:FDA|Food and Drug Administration)\b[^.]{0,40}\b(?:has |today )?(?:approved|granted|cleared|authori[sz]ed)\b/i;

/** True when an FDA-approval sentence only describes an existing state of the product (background), not a new approval. */
export function isBackgroundApproval(sentence: string): boolean {
  const s = String(sentence || '');
  if (!BACKGROUND.test(s)) return false;
  return !/\b(?:announced today|today announced|is pleased to announce|announces? that the (?:U\.S\. )?(?:FDA|Food and Drug Administration)|has (?:just )?(?:received|been granted)|received (?:FDA )?(?:approval|clearance))\b/i.test(s);
}

/** Pick the primary catalyst: highest score, ties keep the incoming (taxonomy) order. */
export function pickPrimaryCatalyst<T extends CatalystLike>(cats: T[]): T | null {
  let best: T | null = null, bs = -Infinity;
  cats.forEach((c, i) => { const sc = primaryCatalystScore(c) - i * 0.01; if (sc > bs) { bs = sc; best = c; } });
  return best;
}
