// zzz852 — pure helpers for the radar's LOGIC QA round. No network, no clock, no AI.
//   1. number ownership (who owns every figure in the source)
//   2. earnings direction and inflection strength (a result is not automatically positive)
//   3. headline hierarchy (a dividend headline with a profit figure is a corporate action)
//   4. deal-terms lines, per-kind evidence chains, event-specific "why now", stated conditions
//   5. the diagnostics block (bottleneck audit, structural screen, 'no earnings link' reasons)
// Rules that apply to everything here: nothing is invented; unknown is never negative; price is never evidence;
// a number owned by a target, subsidiary, transaction or industry is never the parent's earnings.

import type { DealKind, DealTerms, EntityRole, NumberMetric, OwnedNumber, SourceSubject } from './radar-owned-types';
import type {
  CatalystDirection, CatalystKind, DealTermLine, EvidenceChainKind, EvidenceChainStep, InflectionStrength, RadarItem,
} from './multibagger-radar-types';

const squash = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const sentencesOfText = (t: string): string[] => (t || '').split(/(?<=[.!?])\s+|\n+/).map(squash).filter(Boolean);

// ─────────────────────────── 1. number ownership ───────────────────────────

const AMOUNT = /(?:₹|rs\.?|inr|us\$|\$|usd|eur|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(?:crores?|cr|lakhs?|million|mn|billion|bn|m|b|k)?|\d[\d,]*(?:\.\d+)?\s?(?:crores?|cr|million|billion|mn|bn)\b/gi;
const CAPUNIT = /(\d[\d,.]*)\s?(mtpa|ktpa|tpa|mw|gw|gwh|mwh|mt)\b/gi;
const FIN_NOUN = /(revenues?|sales|turnover|ebitda|operating profit|net profit|profit after tax|\bpat\b|net income|profit|earnings)/i;
const DEAL_VERB = /\b(?:acqui(?:re|res|red|ring|sition)|takeover|buy[\s-]?out|to buy|buys|buying|purchase(?:s|d)?(?!\s+(?:orders?|agreements?|commitments?|contracts?))|stake (?:in|buy|purchase|acquisition)|invest(?:s|ed|ing|ment|ments)?|infus\w+|merge(?:s|d)?|merger|demerg\w+|divest\w*|open offer|tender offer)\b/i;
const ACQ_ARTICLE = /\b(?:acqui(?:re|res|red|ring|sition)|takeover|buy[\s-]?out|to buy|buys|stake (?:in|buy|purchase|acquisition)|invest(?:s|ed|ing|ment|ments)?|infus\w+|merge(?:s|d)?|merger|divest\w*)\b/i;
const TARGET_CUE = /\b(?:the (?:target|brand|business|acquired (?:company|business|brand)|company being acquired|start-?up|unit|asset)|being acquired|which (?:generated|reported|posted|clocked|recorded|had|earned)|that (?:generated|reported|posted|clocked|recorded)|its (?:annual |yearly |net )?(?:revenue|sales|turnover|ebitda|profit))\b/i;
const MARKET_CUE = /\b(?:market (?:size|worth|value|of)|(?:industry|sector|segment|category)(?:'s)? (?:size|revenue|sales|worth)|addressable market|\bTAM\b|market is (?:expected|estimated|projected|valued|worth)|worth (?:an? )?(?:estimated )?(?:rs\.?|₹|\$)?[\d,.\s]+(?:crores?|cr|million|billion|bn|mn)? market)/i;
const SUB_CUE = /\b(?:subsidiary|arm\b|joint venture|\bJV\b|associate company)\b/i;
const COMP_CUE = /\b(?:competitors?|rivals?|peers?|industry (?:leader|major))\b/i;
const ORDER_CUE = /\b(?:orders?|contracts?|award\w*|\bLoA\b|purchase order|work order|\bPOs?\b|off-?take|supply agreement)\b/i;
const NAME_STOP = new Set(['The', 'A', 'An', 'Its', 'It', 'Stake', 'Shares', 'Share', 'Company', 'Rs', 'Inr', 'Usd', 'Cr', 'Crore', 'For', 'In', 'Into', 'To', 'On', 'At', 'Of', 'And', 'Q1', 'Q2', 'Q3', 'Q4', 'FY', 'India', 'Indian', 'US', 'Ltd', 'Limited', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const TARGET_RE = /\b(?:[Aa]cqui(?:re|res|red|ring|sition of)|[Bb]uy(?:s|ing)?|[Bb]uy-?out of|[Tt]akeover of|[Ss]take in|[Ii]nvest(?:s|ed|ing|ment)? in|[Ii]nfus\w+ (?:in|into)|[Mm]erge(?:s|d)? with|[Pp]urchase(?:s|d)? of|[Bb]id for|[Oo]ffer for|[Oo]pen offer for)\s+(?:(?:a|an|the|its)\s+)?(?:\d+(?:\.\d+)?\s?%\s+(?:stake\s+in\s+)?)?((?:[A-Z][\w&'-]*)(?:\s+[A-Z][\w&'-]*){0,3})/g;

const LEGAL_SUFFIX = /\b(?:ltd|limited|inc|incorporated|corp|corporation|co|plc|llc|pvt|private|public|company|holdings?)\b\.?/gi;
/** Lower-case tokens that identify the event company inside a sentence (full name and first word). */
export function parentTokens(company: string): string[] {
  const c = squash((company || '').replace(LEGAL_SUFFIX, ' ').replace(/[.,]/g, ' '));
  const out = new Set<string>();
  if (c.length >= 3) out.add(c.toLowerCase());
  const f = c.split(/\s+/)[0];
  if (f && f.length >= 3) out.add(f.toLowerCase());
  return Array.from(out);
}

export function targetNamesOf(text: string, company: string): string[] {
  const out: string[] = [];
  const pt = parentTokens(company);
  TARGET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TARGET_RE.exec(text))) {
    const words = m[1].split(/\s+/).filter((w) => !NAME_STOP.has(w));
    const name = words.join(' ').replace(/[.,'-]+$/, '');
    if (name.length < 3) continue;
    if (pt.includes(name.toLowerCase()) || pt.some((p) => name.toLowerCase() === p)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const moneyCurrency = (raw: string): string | undefined => (/₹|rs\.?|inr/i.test(raw) ? 'INR' : /us\$|\$|usd/i.test(raw) ? 'USD' : /€|eur/i.test(raw) ? 'EUR' : /£/.test(raw) ? 'GBP' : undefined);
const moneyUnit = (raw: string): string | undefined => {
  const m = /(crores?|cr\b|lakhs?|million|mn\b|billion|bn\b)/i.exec(raw);
  if (!m) return undefined;
  const u = m[1].toLowerCase();
  return u.startsWith('cr') ? 'crore' : u.startsWith('lakh') ? 'lakh' : u.startsWith('m') ? 'million' : 'billion';
};
const moneyValue = (raw: string): number => {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(raw);
  return m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
};
const periodOf = (s: string): string => {
  const m = /\b(?:Q[1-4]\s?FY\s?\d{2,4}|H[12]\s?FY\s?\d{2,4}|FY\s?\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]+quarter|(?:first|second|third|fourth)[\s-]+quarter)\b/i.exec(s);
  return m ? squash(m[0]) : 'not stated';
};

export interface OwnershipRead {
  numbers: OwnedNumber[];
  /** Numbers that belong to someone other than the event company (target, subsidiary, industry, competitor, seller, acquired asset). */
  foreign: OwnedNumber[];
  /** Parent-owned financial-statement lines: the only numbers that may set the earnings link or count in quantification. */
  parentFinancial: OwnedNumber[];
  /** The text with every sentence that carries a foreign financial / market figure removed. */
  ownText: string;
  targetNames: string[];
  source: 'feed' | 'text';
}

const FOREIGN_ROLES: EntityRole[] = ['target', 'subsidiary', 'industry', 'competitor', 'seller', 'unrelated_comparison', 'market', 'acquired_asset'];
const FIN_METRICS: NumberMetric[] = ['revenue', 'ebitda', 'pat', 'eps', 'order_value'];

function finishOwnership(numbers: OwnedNumber[], text: string, targetNames: string[], source: 'feed' | 'text'): OwnershipRead {
  const foreign = numbers.filter((n) => FOREIGN_ROLES.includes(n.entityRole) && (FIN_METRICS.includes(n.metric) || n.metric === 'market_size' || n.metric === 'other' || n.metric === 'capacity'));
  const parentFinancial = numbers.filter((n) => n.entityRole === 'parent' && n.countsAsParentEarnings);
  const drop = foreign.map((n) => squash(n.sentence).toLowerCase().slice(0, 48)).filter((x) => x.length >= 12);
  const sents = sentencesOfText(text);
  const kept = sents.filter((s) => { const k = s.toLowerCase(); return !drop.some((d) => k.includes(d) || d.includes(k.slice(0, 48))); });
  return { numbers, foreign, parentFinancial, ownText: squash(kept.join(' ')), targetNames, source };
}

/**
 * Reads every figure in the text and says whose it is.
 * Deal sentence ("X to acquire Y ... Y generated revenue of Rs N") -> the revenue is the target's unless the parent is named right before it.
 * A figure with no clear owner in a deal article is 'unknown' and counts for nothing.
 */
export function extractOwnership(text: string, company: string, hinted?: OwnedNumber[] | null): OwnershipRead {
  const t = squash(text);
  const targets = targetNamesOf(t, company);
  if (hinted && hinted.length) return finishOwnership(hinted, t, targets, 'feed');
  const pt = parentTokens(company);
  const dealArticle = ACQ_ARTICLE.test(t);
  const resultContext = /\b(?:q[1-4]\b|quarter(?:ly)? (?:results?|ended)|results? for the|reported (?:revenue|net profit|profit)|fy\s?\d{2,4}\s+results)/i.test(t);
  const out: OwnedNumber[] = [];
  const seen = new Set<string>();
  const parentLabel = squash(company) || 'the company';

  const roleFor = (s: string, before: string, metric: NumberMetric): { role: EntityRole; entity: string } => {
    const lower = before.toLowerCase();
    const idxP = Math.max(-1, ...pt.map((p) => lower.lastIndexOf(p)));
    const targetAfter = targets.some((n) => lower.lastIndexOf(n.toLowerCase()) > idxP);
    const parentNamed = idxP >= 0 && !targetAfter;
    const nameIn = targets.find((n) => s.toLowerCase().includes(n.toLowerCase()));
    const dealSent = DEAL_VERB.test(s);
    if (metric === 'market_size') return { role: 'industry', entity: 'industry / market' };
    if (metric === 'purchase_price' || metric === 'deal_value' || metric === 'investment' || metric === 'buyback_size' || metric === 'offer_price' || metric === 'dividend_per_share' || metric === 'share_price' || metric === 'percent_stake') {
      return { role: 'transaction', entity: dealSent ? 'transaction' : 'shareholder payout' };
    }
    if (metric === 'capex') return { role: 'parent', entity: parentLabel };
    if (metric === 'capacity') return dealSent && !parentNamed ? { role: 'acquired_asset', entity: nameIn ? `${nameIn} assets` : 'acquired assets' } : { role: 'parent', entity: parentLabel };
    if (MARKET_CUE.test(s) && !parentNamed) return { role: 'industry', entity: 'industry / market' };
    if ((dealSent || TARGET_CUE.test(s) || nameIn) && dealArticle && !parentNamed && !(resultContext && !dealSent && !nameIn && !TARGET_CUE.test(s))) {
      return { role: 'target', entity: nameIn || targets[0] || 'target business' };
    }
    if (SUB_CUE.test(s) && !parentNamed) return { role: 'subsidiary', entity: 'subsidiary' };
    if (COMP_CUE.test(s) && !parentNamed) return { role: 'competitor', entity: 'competitor' };
    return { role: 'parent', entity: parentLabel };
  };

  const push = (n: Omit<OwnedNumber, 'countsAsParentEarnings'> & { margin?: boolean }) => {
    const key = `${n.raw}|${n.metric}|${n.sentence.slice(0, 30)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { margin, ...rest } = n;
    out.push({ ...rest, countsAsParentEarnings: rest.entityRole === 'parent' && (FIN_METRICS.includes(rest.metric) || !!margin) });
  };

  for (const s of sentencesOfText(t)) {
    const dealSent = DEAL_VERB.test(s);
    AMOUNT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = AMOUNT.exec(s))) {
      const raw = squash(m[0]);
      const start = m.index; const end = start + m[0].length;
      const before = s.slice(Math.max(0, start - 70), start);
      const after = s.slice(end, end + 45);
      const perShare = /^\s*(?:\/\s?-?\s?)?(?:per\s+)?(?:common\s+|equity\s+)?share|^\s*a share/i.test(after);
      let metric: NumberMetric = 'other';
      const finBefore = ((): RegExpExecArray | null => {
        // the NEAREST noun before the amount ("revenue of Rs 452 crore and EBITDA of Rs 60 crore": the 60 belongs to EBITDA)
        const re = /(revenues?|sales|turnover|ebitda|operating profit|net profit|profit after tax|\bpat\b|net income|profit|earnings)[^.;]{0,32}$/i;
        const all = Array.from(before.matchAll(/(revenues?|sales|turnover|ebitda|operating profit|net profit|profit after tax|\bpat\b|net income|profit|earnings)/gi));
        for (let k = all.length - 1; k >= 0; k -= 1) { const m2 = re.exec(before.slice(all[k].index)); if (m2) return m2; }
        return null;
      })();
      const finAfter = /^\s*(?:in |of |per year |a year )?(?:annual |yearly |net )?(revenues?|sales|turnover|ebitda|net profit|profit)\b/i.exec(after);
      const noun = (finBefore ? finBefore[1] : finAfter ? finAfter[1] : '').toLowerCase();
      if (perShare) metric = /dividend/i.test(s) ? 'dividend_per_share' : /offer|tender|buy[\s-]?back|repurchase|acquir|purchase/i.test(s) ? 'offer_price' : 'share_price';
      else if (/market|industry|sector|\bTAM\b|addressable/i.test(before.slice(-30) + after.slice(0, 25)) && MARKET_CUE.test(s)) metric = 'market_size';
      else if (noun) metric = /ebitda/.test(noun) ? 'ebitda' : /revenue|sales|turnover/.test(noun) ? 'revenue' : /profit|pat|income|earnings/.test(noun) ? 'pat' : 'other';
      else if (/buy[\s-]?back|repurchase/i.test(s)) metric = 'buyback_size';
      else if (/\bcapex\b|capital expenditure|outlay/i.test(before.slice(-40))) metric = 'capex';
      else if (ORDER_CUE.test(before.slice(-50) + ' ' + after.slice(0, 35)) && !dealSent) metric = 'order_value';
      else if (dealSent && /(?:invest\w*|infus\w+|commit\w*|earmark\w*|allocat\w+)[^.;]{0,30}$/i.test(before)) metric = 'investment';
      else if (dealSent) metric = /(?:valu(?:ed|ation)|enterprise value|\bEV\b)/i.test(before.slice(-40)) ? 'deal_value' : 'purchase_price';
      else if (ORDER_CUE.test(s)) metric = 'order_value';
      const { role, entity } = roleFor(s, before, metric);
      push({
        value: moneyValue(raw), currency: moneyCurrency(raw), unit: moneyUnit(raw), raw, metric, period: periodOf(s), entity, entityRole: role, sentence: clip(s, 240),
      });
    }
    CAPUNIT.lastIndex = 0;
    while ((m = CAPUNIT.exec(s))) {
      const raw = squash(m[0]);
      const before = s.slice(Math.max(0, m.index - 70), m.index);
      const { role, entity } = roleFor(s, before, 'capacity');
      push({ value: parseFloat(m[1].replace(/,/g, '')), unit: m[2].toUpperCase(), raw, metric: 'capacity', period: 'not stated', entity, entityRole: role, sentence: clip(s, 240) });
    }
    // growth / margin percentages that follow an earnings noun: "profit up 23%", "operating margin of 14%"
    const PCT = /(\d+(?:\.\d+)?)\s?(?:%|per ?cent)/gi;
    while ((m = PCT.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 48), m.index);
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 24);
      const mg = /margins?[^.;]{0,24}$/i.test(before) || /^\s*(?:ebitda |operating |net |gross )?margin/i.test(after);
      const fn = FIN_NOUN.exec(before.slice(-40));
      const growth = /\b(?:up|down|rose|fell|grew|jump\w*|surg\w*|declin\w*|drop\w*|increase\w*|decrease\w*|rise|fall|growth|higher|lower)\b/i.test(before.slice(-30)) || /^\s*(?:growth|yoy|y-o-y|year[\s-]on[\s-]year)/i.test(after);
      if (/dividend|stake|holding|premium|discount|yield|interest rate|coupon/i.test(before.slice(-30) + after)) continue;
      if (mg) {
        const { role, entity } = roleFor(s, before, 'other');
        push({ value: parseFloat(m[1]), unit: '%', raw: `${squash(m[0])} margin`, metric: 'other', period: periodOf(s), entity, entityRole: role, sentence: clip(s, 240), margin: true });
      } else if (fn && growth) {
        const noun = fn[1].toLowerCase();
        const metric: NumberMetric = /ebitda/.test(noun) ? 'ebitda' : /revenue|sales|turnover/.test(noun) ? 'revenue' : 'pat';
        const { role, entity } = roleFor(s, before, metric);
        push({ value: parseFloat(m[1]), unit: '%', raw: `${noun} ${squash(m[0])}`, metric, period: periodOf(s), entity, entityRole: role, sentence: clip(s, 240) });
      }
    }
  }
  return finishOwnership(out, t, targets, 'text');
}

/** 'Yoga Bar revenue: Rs 452 cr (target / acquired business, not ITC)'. Only numbers that belong to someone else. */
export function foreignNumberLines(own: OwnershipRead, company: string): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const roleWord = (n: OwnedNumber): string => n.entityRole === 'target' ? 'target / acquired business' : n.entityRole === 'subsidiary' ? 'subsidiary' : n.entityRole === 'acquired_asset' ? 'acquired asset' : n.entityRole === 'industry' || n.entityRole === 'market' ? 'industry / market figure' : n.entityRole === 'competitor' ? 'competitor' : n.entityRole === 'seller' ? 'seller' : 'another entity';
  const metricWord = (n: OwnedNumber): string => n.metric === 'revenue' ? 'revenue' : n.metric === 'ebitda' ? 'EBITDA' : n.metric === 'pat' ? 'profit' : n.metric === 'order_value' ? 'order value' : n.metric === 'capacity' ? 'capacity' : n.metric === 'market_size' ? 'market size' : n.raw.includes('margin') ? 'margin' : 'figure';
  const parent = squash(company) || 'the company';
  for (const n of own.foreign) {
    const shortRaw = squash(n.raw).replace(/\bcrores?\b/gi, 'cr');
    const line = `${n.entity} ${metricWord(n)}: ${shortRaw} (${roleWord(n)}, not ${parent})`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

// ─────────────────────────── 2. earnings direction ───────────────────────────

export interface EarningsLike {
  revenueYoY?: number | null; revenuePrevYoY?: number | null; marginNow?: number | null; marginPrior?: number | null; patYoY?: number | null; cfoToPat?: number | null;
  quarters?: number | null; guidance?: 'RAISED' | 'MAINTAINED' | 'CUT' | 'NOT_STATED'; orderBook?: 'UP' | 'DOWN' | 'UNCHANGED' | 'NOT_STATED';
}
export interface DirectionRead { direction: CatalystDirection; strength: InflectionStrength; basis: string; signals: number; supplied: boolean }

const UP_W = /\b(?:rise[sn]?|rose|rising|jump(?:s|ed)?|surg(?:e|es|ed)|soar(?:s|ed)?|climb(?:s|ed)?|grow(?:s|n)?|grew|growth|increase[sd]?|up|higher|improv(?:e|es|ed)|expand(?:s|ed)?|doubl(?:e|es|ed)|tripl(?:e|es|ed)|quadrupl(?:e|es|ed)|(?:\d+|two|three|four|five)[\s-]?fold|multi[\s-]?fold|record|beats?|swings? to (?:a )?profit|turns? (?:to )?profit(?:able)?|returns? to profit|narrow(?:s|ed)? (?:its |the )?loss|\d+(?:\.\d+)?\s?x)\b/i;
const DOWN_W = /\b(?:fall(?:s|en|ing)?|fell|drop(?:s|ped)?|declin(?:e|es|ed|ing)|slump(?:s|ed)?|plung(?:e|es|ed)|tumbl(?:e|es|ed)|dip(?:s|ped)?|down|lower|decreas(?:e|es|ed)|shrink(?:s|ed)?|slid(?:e|es)?|miss(?:es|ed)?|swings? to (?:a )?loss|turns? (?:to )?loss|widen(?:s|ed)? (?:its |the )?loss|weak(?:er|ens)?|contract(?:s|ed)?|reduc(?:e|es|ed))\b/i;
const FOLD = /\b(\d+|two|three|four|five)[\s-]?fold\b|\b(\d+(?:\.\d+)?)\s?x\b|\b(doubl\w+|tripl\w+|quadrupl\w+)\b/i;
const FOLD_WORD: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
type Group = 'profit' | 'revenue' | 'margin' | 'cash';
const GROUPS: Array<[Group, RegExp]> = [
  ['profit', /(net profit|profit after tax|\bPAT\b|net income|\bprofit\b|earnings|ebitda|operating profit|net loss|\bloss\b)/gi],
  ['revenue', /(revenues?|net sales|\bsales\b|turnover|top[\s-]?line)/gi],
  ['margin', /(\bmargins?\b)/gi],
  ['cash', /(free cash flow|cash flow from operations|operating cash flow|\bCFO\b)/gi],
];

/**
 * Reads the direction of a REPORTED result from what the text and the supplied numbers actually say.
 *  positive = better, negative = worse, mixed = some measures up and some down, neutral = flat, unknown = no comparison stated.
 * Strength only applies to positive results: strong (about 40%+ profit growth, a multiple, or a turn to profit), moderate, weak.
 */
export function directionOf(ownText: string, e?: EarningsLike | null, inflectionState?: string): DirectionRead {
  const ups: Array<{ g: Group; mag: number | null; fold: boolean; strongWord: boolean }> = [];
  const downs: Array<{ g: Group }> = [];
  const t = ownText || '';
  for (const s of sentencesOfText(t)) {
    for (const [g, re] of GROUPS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const after = s.slice(m.index + m[0].length, m.index + m[0].length + 46);
        const before = s.slice(Math.max(0, m.index - 22), m.index);
        const mUpA = UP_W.exec(after); const mDnA = DOWN_W.exec(after);
        const mUpB = UP_W.exec(before); const mDnB = DOWN_W.exec(before);
        // nearest direction word wins; a word after the noun is preferred ("profit up 23%")
        let dir: 'up' | 'down' | null = null; let seg = '';
        if (mUpA || mDnA) {
          const iu = mUpA ? mUpA.index : 1e9; const id = mDnA ? mDnA.index : 1e9;
          dir = iu <= id ? 'up' : 'down'; seg = after.slice(dir === 'up' ? iu : id);
        } else if (mUpB || mDnB) {
          const iu = mUpB ? mUpB.index : -1; const id = mDnB ? mDnB.index : -1;
          dir = iu >= id ? 'up' : 'down'; seg = s.slice(Math.max(0, m.index - 22) + (dir === 'up' ? iu : id), m.index + m[0].length + 30);
        }
        if (!dir) continue;
        if (/\bloss\b/i.test(m[0]) && !/narrow|turn|swing|return/i.test(seg + before)) {
          // a loss that "rises" is bad, a loss that "falls" is good
          dir = dir === 'up' ? 'down' : 'up';
        }
        if (dir === 'down') { downs.push({ g }); continue; }
        const pm = /(\d+(?:\.\d+)?)\s?(?:%|per ?cent)/i.exec(seg);
        const fm = FOLD.exec(seg + ' ' + before);
        let fold = false; let mag: number | null = pm ? parseFloat(pm[1]) : null;
        if (fm) {
          fold = true;
          const k = fm[1] ? (FOLD_WORD[fm[1].toLowerCase()] ?? parseFloat(fm[1])) : fm[2] ? parseFloat(fm[2]) : /doubl/i.test(fm[3] || '') ? 2 : /tripl/i.test(fm[3] || '') ? 3 : 4;
          if (isNum(k) && k >= 2) mag = Math.max(mag ?? 0, (k - 1) * 100);
        }
        const strongWord = /surg|jump|soar|record|turn\w* (?:to )?profit|return\w* to profit|swing\w* to (?:a )?profit/i.test(seg + before);
        ups.push({ g, mag, fold, strongWord });
      }
    }
  }
  let supplied = false;
  if (e) {
    if (isNum(e.patYoY)) { supplied = true; (e.patYoY >= 0 ? ups.push({ g: 'profit', mag: e.patYoY, fold: false, strongWord: false }) : downs.push({ g: 'profit' })); }
    if (isNum(e.revenueYoY)) { supplied = true; (e.revenueYoY >= 0 ? ups.push({ g: 'revenue', mag: e.revenueYoY, fold: false, strongWord: false }) : downs.push({ g: 'revenue' })); }
    if (isNum(e.marginNow) && isNum(e.marginPrior) && e.marginNow !== e.marginPrior) { supplied = true; (e.marginNow > e.marginPrior ? ups.push({ g: 'margin', mag: (e.marginNow - e.marginPrior) * 5, fold: false, strongWord: false }) : downs.push({ g: 'margin' })); }
    if (e.guidance === 'RAISED') { supplied = true; ups.push({ g: 'profit', mag: null, fold: false, strongWord: false }); }
    if (e.guidance === 'CUT') { supplied = true; downs.push({ g: 'profit' }); }
  }
  const signals = ups.length + downs.length;
  if (!signals) {
    const flat = /\b(?:flat|unchanged|in line|stable|steady)\b/i.test(t) && /\b(?:profit|revenue|earnings|sales|ebitda|margin)\b/i.test(t);
    return flat ? { direction: 'neutral', strength: 'none', basis: 'The source says the figures were flat or in line.', signals: 0, supplied } : { direction: 'unknown', strength: 'unknown', basis: 'No comparison (up or down, against a period) is stated for the result.', signals: 0, supplied };
  }
  const profitUp = ups.filter((u) => u.g === 'profit');
  let direction: CatalystDirection;
  if (ups.length && downs.length) direction = 'mixed';
  else direction = ups.length ? 'positive' : 'negative';
  // profit up and only margin/cash down (or the reverse) stays mixed; a lone revenue fall with no other signal is negative
  let strength: InflectionStrength = 'none';
  if (direction === 'positive') {
    const maxMag = Math.max(-1, ...ups.map((u) => u.mag ?? -1));
    const profitMag = Math.max(-1, ...profitUp.map((u) => u.mag ?? -1));
    const folded = ups.some((u) => u.fold && (u.mag ?? 0) >= 100);
    const turned = profitUp.some((u) => u.strongWord && u.mag == null);
    const both = ups.some((u) => u.g === 'revenue' && (u.mag ?? 0) >= 20) && profitUp.length > 0;
    if (folded || profitMag >= 40 || (both && maxMag >= 25)) strength = 'strong';
    else if (maxMag >= 12 || ups.some((u) => u.strongWord) || turned || (supplied && inflectionState && /CONFIRMED|ACCELERATING|STRUCTURAL/.test(inflectionState))) strength = 'moderate';
    else if (maxMag >= 0) strength = 'weak';
    else strength = 'weak';
    if (supplied && inflectionState) {
      if (/CONFIRMED|ACCELERATING|STRUCTURAL/.test(inflectionState)) strength = 'strong';
      else if (/EARLY/.test(inflectionState) && strength === 'weak') strength = 'moderate';
      else if (/NO_INFLECTION/.test(inflectionState) && strength !== 'strong') strength = 'weak';
    }
  }
  const bits: string[] = [];
  if (ups.length) bits.push(`up: ${Array.from(new Set(ups.map((u) => u.g))).join(', ')}`);
  if (downs.length) bits.push(`down: ${Array.from(new Set(downs.map((d) => d.g))).join(', ')}`);
  return { direction, strength, basis: `Stated in the source${supplied ? ' and the supplied results' : ''} (${bits.join('; ')}).`, signals, supplied };
}

export const DIRECTION_LABEL: Record<CatalystDirection, string> = {
  positive: 'Direction: positive', negative: 'Direction: negative', mixed: 'Direction: mixed', neutral: 'Direction: flat', unknown: 'Direction: not stated',
};

// ─────────────────────────── 3. headline hierarchy ───────────────────────────

const CORP_TITLE = /\b(?:dividends?|stock split|share split|sub[\s-]?division of (?:equity )?shares|bonus (?:issue|shares?|debentures?)|record date|ex[\s-]?(?:date|dividend|split|bonus))\b/i;
const EARN_TITLE = /\b(?:net profit|profit after tax|profits?|\bpat\b|revenues?|earnings|ebitda|net income|net loss|\bloss\b|q[1-4]\b|quarter|quarterly|results?)\b/i;
const SUBORD_BEFORE = /\b(?:despite|even as|even though|as|after|amid|while|though|although|notwithstanding|following|on|with)\s+(?:a\s+|an\s+|the\s+)?(?:\w+\s+){0,2}$/i;

export interface HeadlineHierarchy { corpPrimary: boolean; earningsInTitle: boolean; corpWord: string | null }
/**
 * The headline's main verb/object decides the primary event. "Declares Rs 200 dividend, despite fall in Q1 net profit" -> dividend (primary), result (context).
 * "Q1 profit jumps 40%, board declares dividend" -> the result stays primary.
 */
export function headlineHierarchy(title: string): HeadlineHierarchy {
  const t = squash(title);
  const c = CORP_TITLE.exec(t);
  const e = EARN_TITLE.exec(t);
  if (!c) return { corpPrimary: false, earningsInTitle: !!e, corpWord: null };
  if (!e) return { corpPrimary: true, earningsInTitle: false, corpWord: c[0].toLowerCase() };
  const corpFirst = c.index < e.index;
  const subordinated = SUBORD_BEFORE.test(t.slice(0, e.index).slice(-24));
  return { corpPrimary: corpFirst || (subordinated && c.index > e.index ? true : subordinated), earningsInTitle: true, corpWord: c[0].toLowerCase() };
}

// ─────────────────────────── 4. deal terms, chains, why now ───────────────────────────

const DATE_RE = '(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?,?\\s+\\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4})';
const COND_RE = /\bcondition|\bsubject to\b|\bexpir|\bminimum\b|\bapproval|\bfinancing\b|\bregulatory\b|\bshareholder (?:vote|approval)\b/i;

export function dealKindOf(kind: CatalystKind, subKind: CatalystKind | null, text: string, growthInvest: boolean): DealKind | null {
  if (kind === 'CORPORATE_ACTION') return /dividend/i.test(text) ? 'DIVIDEND' : /split|bonus|sub[\s-]?division/i.test(text) ? 'SPLIT_BONUS' : 'OTHER';
  if (kind === 'LEGAL_DECISION' || kind === 'REGULATORY_DECISION') return 'LEGAL';
  if (kind === 'CAPITAL_RAISE' || kind === 'FINANCING') return 'CAPITAL_RAISE';
  if (kind === 'SPECIAL_SITUATION') {
    if (subKind === 'TENDER_OFFER' || subKind === 'GOING_PRIVATE') return 'TENDER';
    if (subKind === 'BUYBACK') return 'BUYBACK';
    if (subKind === 'SPIN_DEMERGER') return 'SPIN_OFF';
    if (subKind === 'MERGER') return 'MERGER';
    if (subKind === 'ACQUISITION') return 'ACQUISITION';
    if (subKind === 'RIGHTS_ISSUE') return 'CAPITAL_RAISE';
    return 'OTHER';
  }
  if (growthInvest && /\b(?:acqui\w+|stake|buy\w*|takeover)\b/i.test(text)) return 'ACQUISITION';
  return null;
}

const EXPECTED: Partial<Record<DealKind, Array<[string, string]>>> = {
  TENDER: [['offer_price', 'Offer price'], ['consideration_type', 'Consideration'], ['reference_price', 'Reference price'], ['premium_or_discount', 'Premium / discount'], ['minimum_tender', 'Minimum tender'], ['maximum_tender', 'Maximum tender'], ['expiry_date', 'Expiry'], ['settlement', 'Settlement'], ['regulatory_approvals', 'Conditions / approvals'], ['financing', 'Financing']],
  ACQUISITION: [['purchase_price', 'Purchase price'], ['consideration_type', 'Consideration'], ['target_revenue', 'Target revenue'], ['target_ebitda', 'Target EBITDA'], ['multiple', 'Multiple'], ['financing', 'Financing'], ['new_shares_or_dilution', 'Dilution'], ['expected_close', 'Expected closing']],
  MERGER: [['exchange_ratio', 'Exchange ratio'], ['shares_issued', 'Shares issued'], ['ownership_split', 'Ownership split'], ['approvals', 'Approvals'], ['expected_close', 'Expected closing']],
  SPIN_OFF: [['record_date', 'Record date'], ['ratio', 'Ratio'], ['listing_date', 'Listing'], ['business_transferred', 'Business transferred'], ['debt_cash_allocation', 'Debt / cash allocation']],
  BUYBACK: [['size', 'Size'], ['pct_of_market_cap', '% of market cap'], ['method', 'Method'], ['price', 'Price'], ['funding', 'Funding']],
  DIVIDEND: [['amount_per_share', 'Amount per share'], ['record_date', 'Record date']],
  SPLIT_BONUS: [['ratio', 'Ratio'], ['record_date', 'Record date']],
};
const keyNorm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const prettyKey = (k: string) => { const s = k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : k; };

/** A small local extractor used only when the feed supplied no deal terms. Text only; absent means 'Not stated'. */
export function ownDealTerms(kind: DealKind, text: string, own: OwnershipRead): DealTerms {
  const t = squash(text);
  const sents = sentencesOfText(t);
  const fields: Record<string, string> = {};
  const pick = (re: RegExp): string | null => { for (const s of sents) if (re.test(s)) return clip(s, 220); return null; };
  const date = (re: RegExp): string | null => { const m = new RegExp(`(?:${re.source})[^.]{0,50}?(${DATE_RE})`, 'i').exec(t); return m ? m[1] : null; };
  const tx = (metric: NumberMetric) => own.numbers.find((n) => n.entityRole === 'transaction' && n.metric === metric);
  if (kind === 'TENDER') {
    const op = tx('offer_price'); if (op) fields.offer_price = op.raw;
    const ex = date(/expire[sd]?|expiry|expiration|closes? on|open until|until/); if (ex) fields.expiry_date = ex;
    const mn = pick(/\bminimum\b/i); if (mn) fields.minimum_tender = mn;
    const st = pick(/\bsettle(?:d|ment)?\b/i); if (st) fields.settlement = st;
    const fi = pick(/\bfinanc\w+|\bfunded\b/i); if (fi) fields.financing = fi;
    const ap = pick(/\bapproval|\bregulatory\b|\bsubject to\b/i); if (ap) fields.regulatory_approvals = ap;
    const rp = /(?:reference price|closing price|last (?:closing )?price)[^.$₹]{0,50}?((?:₹|rs\.?|\$|us\$)\s?\d[\d,.]*)/i.exec(t); if (rp) fields.reference_price = rp[1];
  } else if (kind === 'ACQUISITION') {
    const pp = tx('purchase_price') || tx('deal_value') || tx('investment'); if (pp) fields.purchase_price = pp.raw;
    const tr = own.foreign.find((n) => n.metric === 'revenue' && (n.entityRole === 'target' || n.entityRole === 'subsidiary')); if (tr) fields.target_revenue = `${tr.raw}${tr.period && tr.period !== 'not stated' ? ` (${tr.period})` : ''}`;
    const te = own.foreign.find((n) => n.metric === 'ebitda' && (n.entityRole === 'target' || n.entityRole === 'subsidiary')); if (te) fields.target_ebitda = te.raw;
    const fi = pick(/\bfinanc\w+|\bfunded\b|\bdebt\b|\bcash on hand\b/i); if (fi) fields.financing = fi;
    const ec = pick(/expected to (?:close|complete)|completion (?:is )?expected|closing (?:is )?expected/i); if (ec) fields.expected_close = ec;
    if (/\ball[\s-]cash\b|\bin cash\b|\bcash consideration\b/i.test(t)) fields.consideration_type = 'cash';
  } else if (kind === 'MERGER') {
    const er = /exchange ratio[^.]{0,60}|\b\d+\s+(?:equity\s+)?shares?[^.,;]{0,40}\s+for\s+(?:every|each)\s+\d+[^.,;]{0,40}/i.exec(t); if (er) fields.exchange_ratio = squash(er[0]);
    const ap = pick(/\bapproval|\bNCLT\b|\bregulatory\b/i); if (ap) fields.approvals = ap;
    const ec = pick(/expected to (?:close|complete|be effective)/i); if (ec) fields.expected_close = ec;
  } else if (kind === 'SPIN_OFF') {
    const rd = date(/record date/); if (rd) fields.record_date = rd;
    const ld = date(/listing|list(?:ed)?|trading/); if (ld) fields.listing_date = ld;
    const ra = /(?:ratio of|in the ratio)\s+[^.,;]{2,50}/i.exec(t); if (ra) fields.ratio = squash(ra[0]);
  } else if (kind === 'BUYBACK') {
    const sz = tx('buyback_size') || own.numbers.find((n) => n.metric === 'buyback_size'); if (sz) fields.size = sz.raw;
    const pr = tx('offer_price'); if (pr) fields.price = pr.raw;
    const me = /\b(tender offer|open market|stock exchange (?:route|mechanism)|proportionate basis)\b/i.exec(t); if (me) fields.method = me[1];
  } else if (kind === 'DIVIDEND') {
    const d = tx('dividend_per_share'); if (d) fields.amount_per_share = d.raw;
    const rd = date(/record date/); if (rd) fields.record_date = rd;
  }
  const statedConditions = Array.from(new Set(sents.filter((s) => COND_RE.test(s)).map((s) => clip(s, 240))));
  const exp = EXPECTED[kind] || [];
  return { kind, fields, statedConditions, missing: exp.map(([k]) => k).filter((k) => !(k in fields)) };
}

const parseNum = (s: string | undefined): { v: number; cur: string; unit: string } | null => {
  if (!s) return null;
  const m = /(₹|rs\.?|inr|us\$|\$|usd|€|£)\s?(\d[\d,]*(?:\.\d+)?)\s?(crores?|cr\b|lakhs?|million|mn\b|billion|bn\b)?/i.exec(s);
  if (!m) return null;
  return { v: parseFloat(m[2].replace(/,/g, '')), cur: moneyCurrency(m[1]) || m[1], unit: (m[3] || '').toLowerCase().slice(0, 2) };
};

/** Each expected field as a value or 'Not stated'. A premium or multiple is calculated only when BOTH inputs are stated, and says so. */
export function dealTermLinesOf(kind: DealKind, terms: DealTerms | null, own: OwnershipRead): DealTermLine[] {
  const expected = EXPECTED[kind] || [];
  const fields = terms?.fields || {};
  const norm: Record<string, string> = {};
  Object.entries(fields).forEach(([k, v]) => { if (v && squash(v)) norm[keyNorm(k)] = squash(v); });
  const lines: DealTermLine[] = [];
  const used = new Set<string>();
  for (const [k, label] of expected) {
    const v = norm[keyNorm(k)];
    used.add(keyNorm(k));
    lines.push(v ? { label, value: clip(v, 220), stated: true } : { label, value: 'Not stated', stated: false });
  }
  Object.entries(fields).forEach(([k, v]) => { if (!used.has(keyNorm(k)) && v && squash(v)) lines.push({ label: prettyKey(k), value: clip(squash(v), 220), stated: true }); });
  // calculated values: both inputs must be stated in the source
  if (kind === 'TENDER') {
    const op = parseNum(norm[keyNorm('offer_price')]); const rp = parseNum(norm[keyNorm('reference_price')]);
    const row = lines.find((l) => l.label === 'Premium / discount');
    if (op && rp && op.cur === rp.cur && rp.v > 0 && row && !row.stated) {
      const pct = ((op.v - rp.v) / rp.v) * 100;
      row.value = `${pct >= 0 ? '+' : ''}${(Math.round(pct * 10) / 10).toFixed(1)}% to the stated reference price (calculated from the two stated prices)`; row.stated = true; row.calculated = true;
    }
  }
  if (kind === 'ACQUISITION') {
    const pp = parseNum(norm[keyNorm('purchase_price')]);
    const tr = own.foreign.find((n) => n.metric === 'revenue' && (n.entityRole === 'target' || n.entityRole === 'subsidiary'));
    const trv = tr ? parseNum(tr.raw) : null;
    const row = lines.find((l) => l.label === 'Multiple');
    if (pp && trv && pp.cur === trv.cur && pp.unit === trv.unit && trv.v > 0 && row && !row.stated) {
      row.value = `${(Math.round((pp.v / trv.v) * 10) / 10).toFixed(1)}x target revenue (calculated from the stated price and the target's stated revenue)`; row.stated = true; row.calculated = true;
    }
  }
  return lines;
}

const COND_BOILER = /\b(?:antitrust|minority shareholder dissent|inadequate price|governance deterioration|margin reversal|falling backlog|cash conversion worsens)\b/i;
export const isBoilerplateBreak = (s: string): boolean => COND_BOILER.test(s);

/** Stated conditions as short next-proof clauses. */
export function conditionClauses(terms: DealTerms | null, max = 3): string[] {
  const out: string[] = [];
  const f = terms?.fields || {};
  const nf: Record<string, string> = {};
  Object.entries(f).forEach(([k, v]) => { nf[keyNorm(k)] = squash(String(v)); });
  if (nf.expirydate) out.push(`offer expiry ${nf.expirydate}`);
  for (const c of terms?.statedConditions || []) { const cl = clip(squash(c), 130); if (!out.some((o) => o.toLowerCase().includes(cl.slice(0, 40).toLowerCase()))) out.push(cl); if (out.length >= max) break; }
  return out.slice(0, max);
}

export interface ChainCtx {
  kind: CatalystKind; subKind: CatalystKind | null; dealKind: DealKind | null; text: string; own: OwnershipRead; terms: DealTerms | null; termLines: DealTermLine[];
  listingDone: boolean; completed: boolean; secondary: boolean; company: string;
  /** operating chain: status of each catalyst link, and the parent-owned figures */
  link: (k: string) => { status: string; evidence: string | null } | undefined;
  hasParentRevenue: boolean; hasParentOrder: boolean; resultStated: { revenue: boolean; profit: boolean; margin: boolean; cash: boolean; guidance: boolean; driver: boolean };
}

export function chainKindOf(c: Pick<ChainCtx, 'kind' | 'dealKind'>): EvidenceChainKind {
  if (c.kind === 'EARNINGS_RESULT') return 'RESULT';
  if (c.dealKind === 'TENDER') return 'TENDER';
  if (c.dealKind === 'ACQUISITION') return 'ACQUISITION';
  if (c.dealKind === 'MERGER') return 'MERGER';
  if (c.dealKind === 'SPIN_OFF') return 'SPIN_OFF';
  if (c.dealKind === 'BUYBACK') return 'BUYBACK';
  if (c.dealKind === 'LEGAL') return 'LEGAL';
  if (c.dealKind === 'DIVIDEND' || c.dealKind === 'SPLIT_BONUS' || c.dealKind === 'OTHER' && c.kind === 'CORPORATE_ACTION') return 'CORPORATE_ACTION';
  if (c.dealKind === 'CAPITAL_RAISE') return 'CAPITAL_RAISE';
  return 'OPERATING';
}

/** The per-kind evidence chain. A step is 'confirmed' only when the source states that fact; everything else is 'not established'. */
export function evidenceChainOf(c: ChainCtx): { kind: EvidenceChainKind; steps: EvidenceChainStep[] } {
  const kind = chainKindOf(c);
  const st = (step: string, ok: boolean, detail: string | null): EvidenceChainStep => ({ step, state: ok ? 'confirmed' : 'not_established', detail: detail ? clip(detail, 140) : null });
  const val = (label: string) => { const l = c.termLines.find((x) => x.label === label); return l && l.stated ? l.value : null; };
  const sec = c.secondary ? ' (secondary-reported)' : '';
  const t = c.text;
  const parent = squash(c.company) || 'the company';
  const foreignRev = c.own.foreign.find((n) => n.metric === 'revenue');
  const L = (k: string) => c.link(k);
  const lok = (k: string) => { const l = L(k); return !!l && (l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN'); };
  const levd = (k: string) => L(k)?.evidence || null;
  const steps: EvidenceChainStep[] = [];
  if (kind === 'ACQUISITION') {
    const tn = c.own.targetNames[0];
    steps.push(st('Target', !!tn, tn ? `${tn}${sec}` : null));
    const dt = val('Purchase price') || val('Consideration');
    steps.push(st('Deal terms', !!dt, dt));
    steps.push(st('Closing', c.completed, c.completed ? 'The source says the deal is completed' : val('Expected closing')));
    steps.push(st('Consolidation', false, null));
    steps.push(st('Revenue', c.hasParentRevenue, foreignRev && !c.hasParentRevenue ? `${foreignRev.entity} revenue ${foreignRev.raw} is the target's, not ${parent}'s` : null));
    steps.push(st('EBITDA', false, null));
    steps.push(st('Financing cost', !!val('Financing'), val('Financing')));
    steps.push(st('EPS', false, null));
    steps.push(st('ROIC', false, null));
  } else if (kind === 'TENDER') {
    steps.push(st('Offer', true, `Offer reported${sec}`));
    steps.push(st('Price / terms', !!val('Offer price'), val('Offer price')));
    steps.push(st('Acceptance', /\b(?:accepted|tendered|acceptance level|oversubscribed|undersubscribed)\b/i.test(t), null));
    steps.push(st('Conditions', (c.terms?.statedConditions || []).length > 0, (c.terms?.statedConditions || [])[0] || null));
    steps.push(st('Settlement', !!val('Settlement'), val('Settlement')));
    const prem = c.termLines.find((x) => x.label === 'Premium / discount');
    steps.push(st('Shareholder payoff', !!prem && prem.stated && !!prem.calculated, prem && prem.stated ? prem.value : null));
  } else if (kind === 'MERGER') {
    steps.push(st('Merger terms', true, `Merger reported${sec}`));
    steps.push(st('Exchange ratio', !!val('Exchange ratio'), val('Exchange ratio')));
    steps.push(st('Approvals', !!val('Approvals'), val('Approvals')));
    steps.push(st('Closing', c.completed, val('Expected closing')));
    steps.push(st('Combined revenue / EBITDA', c.hasParentRevenue, null));
    steps.push(st('EPS effect', false, null));
  } else if (kind === 'SPIN_OFF') {
    steps.push(st('Separation', true, `Separation reported${sec}`));
    steps.push(st('Assets / liabilities', !!val('Business transferred'), val('Business transferred')));
    steps.push(st('Capital structure', !!val('Debt / cash allocation'), val('Debt / cash allocation')));
    steps.push(st('Listing', c.listingDone || !!val('Listing'), c.listingDone ? 'The source says the business is listed' : val('Listing')));
    steps.push(st('Standalone earnings', false, null));
    steps.push(st('Valuation', false, null));
  } else if (kind === 'BUYBACK') {
    steps.push(st('Authorisation', true, `Buyback reported${sec}`));
    steps.push(st('Size', !!val('Size'), val('Size')));
    steps.push(st('Price / method', !!(val('Price') || val('Method')), val('Price') || val('Method')));
    steps.push(st('Completion', c.completed, null));
    steps.push(st('Share-count effect', false, null));
    steps.push(st('Shareholder payoff', false, null));
  } else if (kind === 'LEGAL') {
    steps.push(st('Decision', true, `Decision reported${sec}`));
    steps.push(st('Right / liability affected', /\b(?:penalt\w+|fine[sd]?|licen[cs]e|ban|claim|liabilit\w+|damages|injunction|relief|order|duty|demand|tax)\b/i.test(t), null));
    steps.push(st('Financial consequence', c.own.numbers.some((n) => n.entityRole === 'transaction' || n.metric === 'other') && /\b(?:penalt\w+|fine[sd]?|damages|demand|tax|liabilit\w+)\b/i.test(t), null));
    steps.push(st('Timing', new RegExp(DATE_RE, 'i').test(t) || /\bwithin \d+ (?:days|weeks|months)\b/i.test(t), null));
    steps.push(st('Appeal / implementation risk', /\b(?:appeal\w*|stay\w*|challenge\w*|implement\w*)\b/i.test(t), null));
  } else if (kind === 'CORPORATE_ACTION') {
    steps.push(st('Declaration', true, `Declared${sec}`));
    steps.push(st('Amount / ratio', !!(val('Amount per share') || val('Ratio')), val('Amount per share') || val('Ratio')));
    steps.push(st('Record date', !!val('Record date'), val('Record date')));
    steps.push(st('Payment date', /\b(?:payment date|payable on|paid on|to be paid)\b/i.test(t), null));
    steps.push(st('Shareholder cash return', !!val('Amount per share'), val('Amount per share')));
  } else if (kind === 'CAPITAL_RAISE') {
    steps.push(st('Instrument', true, `Raise reported${sec}`));
    steps.push(st('Size', c.own.numbers.some((n) => n.entityRole === 'transaction' || n.metric === 'other') && /\b(?:raise[sd]?|issue[sd]?|allot\w*|loan|debentures?|bonds?|warrants?)\b/i.test(t), null));
    steps.push(st('Use of proceeds', /\b(?:use of proceeds|proceeds (?:will|to|would)|to (?:fund|finance|repay|expand)|for (?:capex|expansion|working capital|debt))/i.test(t), null));
    steps.push(st('Dilution / interest cost', /\b(?:dilut\w+|interest|coupon|yield)\b/i.test(t), null));
    steps.push(st('Deployment', false, null));
  } else if (kind === 'RESULT') {
    const r = c.resultStated;
    steps.push(st('Result reported', true, `Result reported${sec}`));
    steps.push(st('Revenue', r.revenue, levd('REVENUE')));
    steps.push(st('Margin', r.margin, levd('MARGIN')));
    steps.push(st('EBITDA', lok('EBITDA'), levd('EBITDA')));
    steps.push(st('Profit (PAT)', r.profit, levd('EARNINGS')));
    steps.push(st('Cash flow', r.cash, levd('FCF')));
    steps.push(st('Cause stated (price, volume, cost)', r.driver, null));
    steps.push(st('Guidance', r.guidance, null));
  } else {
    steps.push(st('Driver', lok('DRIVER') || c.hasParentOrder, levd('DRIVER')));
    steps.push(st('Company edge', lok('COMPANY_ADVANTAGE'), levd('COMPANY_ADVANTAGE')));
    steps.push(st('Capacity', lok('CAPACITY'), levd('CAPACITY')));
    steps.push(st('Volume', lok('VOLUME'), levd('VOLUME')));
    steps.push(st('Revenue', c.hasParentRevenue || (lok('REVENUE') && !/contract or order value/.test(levd('REVENUE') || '')), levd('REVENUE')));
    steps.push(st('Margin', lok('MARGIN'), levd('MARGIN')));
    steps.push(st('EBITDA', lok('EBITDA'), levd('EBITDA')));
    steps.push(st('FCF', lok('FCF'), levd('FCF')));
    steps.push(st('Earnings', lok('EARNINGS'), levd('EARNINGS')));
  }
  return { kind, steps };
}

const monthYear = (t: string): string | null => { const m = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]+quarter|(?:first|second|third|fourth)[\s-]+quarter|Q[1-4]\s?FY\s?\d{2,4}|H[12]\s?FY\s?\d{2,4})/i.exec(t); return m ? squash(m[1]) : null; };

export interface WhyNowCtx {
  kind: CatalystKind; subKind: CatalystKind | null; dealKind: DealKind | null; text: string; terms: DealTerms | null; direction: DirectionRead; company: string; tentative: boolean; planHint: boolean; listingDone: boolean;
  evSentence: string; secondaryDirection?: CatalystDirection | null; noEarningsLink: boolean; quarantined: boolean; disproved: boolean;
}
/**
 * One event-specific sentence about the status change, built only from the event kind and stated facts (dates, status words).
 * Returns 'Not established' when the source gives nothing to base it on. Never a taxonomy definition.
 */
export function whyNowOf(c: WhyNowCtx): string {
  const t = c.text;
  const f = c.terms?.fields || {};
  const nf: Record<string, string> = {};
  Object.entries(f).forEach(([k, v]) => { nf[keyNorm(k)] = squash(String(v)); });
  const dated = nf.expirydate || nf.recorddate || nf.listingdate;
  const status = /\b(?:definitive agreement|agreement|signed|signs|executed)\b/i.test(t) ? 'agreement' : /\b(?:launch(?:es|ed)?|commence[sd]?|opens?|opened)\b/i.test(t) ? 'launch' : /\b(?:filed|files|filing)\b/i.test(t) ? 'filed' : /\b(?:completed|completes|closed|closing completed)\b/i.test(t) ? 'completed' : /\b(?:approved|approves|approval)\b/i.test(t) ? 'approved' : /\b(?:announce[sd]?|to acquire|will acquire|proposes?|plans? to)\b/i.test(t) ? 'announced' : null;
  if (c.disproved) return 'Not established';
  if (c.quarantined || (c.noEarningsLink && c.kind !== 'CORPORATE_ACTION')) return 'Not established';
  const q = monthYear(t);
  switch (c.kind) {
    case 'EARNINGS_RESULT': {
      const d = c.direction.direction;
      const what = d === 'positive' ? 'higher profit or revenue' : d === 'negative' ? 'lower profit or revenue' : d === 'mixed' ? 'mixed results (some measures up, some down)' : d === 'neutral' ? 'flat results' : null;
      if (!what) return `The ${q ? `${q} ` : ''}result is now reported; its direction against an earlier period is not stated, so what changed is not established.`;
      return `The ${q ? `${q} ` : ''}result is the first reported evidence of ${what}; the next question is whether the drivers persist.`;
    }
    case 'CORPORATE_ACTION': {
      const rd = nf.recorddate;
      const w = /dividend/i.test(t) ? 'dividend' : /split/i.test(t) ? 'split' : /bonus/i.test(t) ? 'bonus issue' : 'corporate action';
      return `The board has declared the ${w}${rd ? `; the record date is ${rd}` : ''}.${c.secondaryDirection && c.secondaryDirection !== 'unknown' ? ` The same headline also reports earnings (${c.secondaryDirection}); that is context, not the event.` : ''}`;
    }
    case 'SPECIAL_SITUATION': {
      if (c.dealKind === 'TENDER') {
        if (dated) return `The filing establishes a finite timetable (${nf.expirydate ? `offer expiry ${nf.expirydate}` : `date ${dated}`}), making offer terms, acceptance and completion the near-term milestones.`;
        if (status === 'launch') return 'The offer has moved from announcement to launch, so offer terms, acceptance and completion are now the near-term milestones.';
        if (status === 'filed') return 'The offer is now in a filing, so the stated terms and conditions can be checked and acceptance and completion become the milestones.';
        if (status === 'agreement') return 'The situation has moved from announcement to a disclosed agreement; the offer terms and conditions are the next thing to check.';
        return 'Not established';
      }
      if (c.dealKind === 'ACQUISITION' || c.dealKind === 'MERGER') {
        if (status === 'completed') return 'The deal has moved from agreement to completion; consolidation into reported results is the next step.';
        if (status === 'agreement') return 'The deal has moved from announcement to a disclosed agreement; terms, approvals and closing are the next milestones.';
        if (status === 'approved') return 'An approval step has been reported; the remaining approvals and closing are the next milestones.';
        if (status === 'announced') return 'The deal has been announced; its terms, approvals and closing are the next milestones.';
        return 'Not established';
      }
      if (c.dealKind === 'SPIN_OFF') {
        if (c.listingDone || status === 'completed') return 'The separated business is now listed; separate reporting is the next evidence.';
        if (dated) return `A date is stated (${dated}); record date, listing and first separate results are the milestones.`;
        if (status === 'approved' || status === 'announced') return `The separation has been ${status === 'approved' ? 'approved' : 'announced'}; record date, listing and first separate results are the milestones.`;
        return 'Not established';
      }
      if (c.dealKind === 'BUYBACK') {
        if (nf.recorddate) return `A buyback record date is stated (${nf.recorddate}); completion and the size actually bought back are the next evidence.`;
        if (status === 'approved' || status === 'announced') return 'The buyback has been announced; its size, price and completion are the next evidence.';
        return 'Not established';
      }
      return status ? `The situation has been ${status === 'agreement' ? 'documented in an agreement' : status}; the next filing should state the remaining steps.` : 'Not established';
    }
    case 'LEGAL_DECISION': case 'REGULATORY_DECISION':
      return status === 'approved' || /\b(?:ruled|rules|order(?:ed|s)?|quash\w*|upheld|dismiss\w*|allow\w*)\b/i.test(t) ? 'A decision has been issued; the question is what right or liability it changes and when it takes effect.' : 'Not established';
    case 'CAPITAL_RAISE': case 'FINANCING':
      return status ? 'The raise has been announced; use of proceeds and deployment are what the next filings should state.' : 'Not established';
    case 'CONTRACT_ORDER':
      return /\b(?:wins?|won|awarded|secures?|bags?|receives?|signs?|signed)\b/i.test(t) ? 'The company has disclosed a signed order or award; the question is how it converts into delivered revenue.' : 'Not established';
    case 'CAPACITY_INFLECTION':
      return /\b(?:commission\w*|complet\w+|start\w*|begins?|began)\b/i.test(t) ? 'A capacity step has been reported; utilisation and demand that fills it are the next evidence.' : /\b(?:announce\w*|plans?|invest\w*|capex)\b/i.test(t) ? 'A capacity plan has been announced; commissioning and demand that fills it are the next evidence.' : 'Not established';
    case 'CUSTOMER_QUALIFICATION':
      return 'The company reports a customer qualification or award; first shipments and repeat orders are the next evidence.';
    case 'NEW_PRODUCT_MARKET':
      return c.planHint ? 'Management has set out a target; reported revenue against it is the next evidence.' : /\b(?:acqui\w+|stake|invest\w+)\b/i.test(t) ? 'The company has announced an acquisition or investment into a new area; closing and the business results are the next evidence.' : /\b(?:launch\w*|approv\w+|enters?)\b/i.test(t) ? 'The company reports a launch, approval or market entry; first sales are the next evidence.' : 'Not established';
    default:
      return c.evSentence && /\b(?:wins?|announce\w*|reports?|signs?|approves?|completes?|launch\w*)\b/i.test(c.evSentence) ? 'A company disclosure has been reported; the next filing or result should show whether it reaches the numbers.' : 'Not established';
  }
}

// ─────────────────────────── 5. diagnostics ───────────────────────────

const BOTTLENECK_CUES = /(capacity[\s-]?(?:constrain\w*|constraints?|fully (?:utili[sz]ed|booked)|sold out|tight\w*)|full(?:y)? utili[sz]ation|utili[sz]ation (?:at|of) (?:9\d|100)\s?%|running at (?:9\d|100)\s?%|supply[\s-]?(?:constrain\w*|shortage|tight\w*|crunch|gap)|shortage|short supply|(?:long|extended|stretch\w*) lead[\s-]?times?|lead[\s-]?times?|allocation|price (?:hike|increase|rise)s?|prices? (?:rise|rose|rising|surge\w*)|backlog|order book|long[\s-]term (?:contract|supply|agreement)|take[\s-]or[\s-]pay|(?:industry|sector)[\s-]?wide capacity (?:additions?|expansion)|capacity additions?|new capacity)/i;
const SUPPLY_PROVEN = /(shortage|short supply|supply[\s-](?:constrain\w*|tight\w*|crunch|gap|deficit|bottleneck)|constrained supply|supply[\s-]?constrained|(?:long|extended|stretch\w*) lead[\s-]?times?|lead[\s-]?times? (?:of|extend\w*|stretch\w*|exceed\w*)|allocations? (?:basis|of)|capacity (?:is )?(?:sold out|fully booked|constrained)|sold out|fully booked|bottleneck|limited (?:number of )?(?:suppliers?|qualified|players|vendors|capacity))/i;

export interface RadarDiagnostics {
  bottleneck: { candidates: number; promoted: number; rejectedNoCompanyBenefit: number; rejectedSupplyNotProven: number; examples: Array<{ id: string; why: string }> };
  structural: {
    screened: number; passed: number;
    failures: { noCompanyEdge: number; noMultiYearDemand: number; insufficientEarningsPathway: number; durationUnknown: number; valuationNotAssessable: number; governanceOrBalanceSheet: number };
  };
  noEarningsLink: { total: number; byReason: Record<string, number> };
  lines: { bottleneck: string; structural: string; noLink: string };
}

export const NO_LINK_REASONS = [
  'pure corporate action', 'dividend / split', 'price response', 'analyst commentary', 'media narrative', 'legal with no quantified economics',
  'capital structure only', 'shareholder payoff only', 'unlisted / non-investable', 'insufficient evidence', 'sector commentary',
] as const;

export function noLinkReasonOf(i: RadarItem): string | null {
  const noLink = i.bucket === 'NOISE' || i.bucket === 'CORPORATE_ACTION' || ['NONE', 'NOT_APPLICABLE', 'NOT_ESTABLISHED', 'NARRATIVE_ONLY'].includes(i.link);
  if (!noLink) return null;
  if (i.entity && (i.entity.state === 'UNLISTED' || i.entity.entityType === 'FUND' || i.entity.entityType === 'PRIVATE')) return 'unlisted / non-investable';
  if (i.kind === 'PRICE_MOVE' || i.quarantineReason === 'PRICE_ARTICLE') return 'price response';
  if (i.kind === 'ANALYST_CHANGE' || i.quarantineReason === 'ANALYST_TARGET') return 'analyst commentary';
  if (i.kind === 'MEDIA_NARRATIVE' || i.quarantineReason === 'OPINION') return 'media narrative';
  if (i.kind === 'SECTOR_COMMENTARY') return 'sector commentary';
  if (i.kind === 'CORPORATE_ACTION') return /dividend|split|bonus/i.test(`${i.event} ${i.economicPayoff || ''}`) ? 'dividend / split' : 'pure corporate action';
  if (i.kind === 'LEGAL_DECISION' || i.kind === 'REGULATORY_DECISION') return 'legal with no quantified economics';
  if (i.kind === 'CAPITAL_RAISE' || i.kind === 'FINANCING' || i.subKind === 'RIGHTS_ISSUE') return 'capital structure only';
  if (i.subKind === 'BUYBACK' || i.subKind === 'TENDER_OFFER' || i.subKind === 'GOING_PRIVATE') return 'shareholder payoff only';
  return 'insufficient evidence';
}

export function diagnosticsOf(entries: Array<{ id: string; text: string; item: RadarItem }>): RadarDiagnostics {
  const d: RadarDiagnostics = {
    bottleneck: { candidates: 0, promoted: 0, rejectedNoCompanyBenefit: 0, rejectedSupplyNotProven: 0, examples: [] },
    structural: { screened: 0, passed: 0, failures: { noCompanyEdge: 0, noMultiYearDemand: 0, insufficientEarningsPathway: 0, durationUnknown: 0, valuationNotAssessable: 0, governanceOrBalanceSheet: 0 } },
    noEarningsLink: { total: 0, byReason: {} },
    lines: { bottleneck: '', structural: '', noLink: '' },
  };
  for (const { id, text, item } of entries) {
    // (a) bottleneck detector audit: how many inputs carried a cue, how many were promoted, and why the rest were not
    if (BOTTLENECK_CUES.test(text)) {
      d.bottleneck.candidates += 1;
      if (item.bucket === 'BOTTLENECK') d.bottleneck.promoted += 1;
      else if (!SUPPLY_PROVEN.test(text)) { d.bottleneck.rejectedSupplyNotProven += 1; if (d.bottleneck.examples.length < 5) d.bottleneck.examples.push({ id, why: 'supply constraint not proven in the source' }); }
      else { d.bottleneck.rejectedNoCompanyBenefit += 1; if (d.bottleneck.examples.length < 5) d.bottleneck.examples.push({ id, why: 'no company-specific benefit shown' }); }
    }
    // (b) structural / multibagger screen
    const structural = !!item.kind && !item.quarantineReason && !['CORPORATE_ACTION', 'PRICE_MOVE', 'ANALYST_CHANGE', 'MEDIA_NARRATIVE', 'SECTOR_COMMENTARY', 'DISPROVED_RUMOUR', 'OTHER', 'CAPITAL_RAISE', 'FINANCING', 'LEGAL_DECISION', 'REGULATORY_DECISION', 'SPECIAL_SITUATION'].includes(item.kind);
    if (structural) {
      d.structural.screened += 1;
      if (item.bucket === 'MULTIBAGGER') d.structural.passed += 1;
      else {
        const edge = (item.catalystChain || []).find((l) => l.link === 'COMPANY_ADVANTAGE');
        if (!edge || (edge.status !== 'PROVEN' && edge.status !== 'PARTIALLY_PROVEN')) d.structural.failures.noCompanyEdge += 1;
        if (item.duration.code == null) d.structural.failures.durationUnknown += 1;
        else if (item.duration.code < 4) d.structural.failures.noMultiYearDemand += 1;
        if (item.link !== 'DIRECT' && item.link !== 'NEAR_DIRECT') d.structural.failures.insufficientEarningsPathway += 1;
        if (item.expectations.state === 'NOT_ASSESSED') d.structural.failures.valuationNotAssessable += 1;
        if (item.governance.status === 'FLAGGED') d.structural.failures.governanceOrBalanceSheet += 1;
      }
    }
    // (c) 'no earnings link' by sub-reason
    const r = noLinkReasonOf(item);
    if (r) { d.noEarningsLink.total += 1; d.noEarningsLink.byReason[r] = (d.noEarningsLink.byReason[r] || 0) + 1; }
  }
  const b = d.bottleneck;
  d.lines.bottleneck = `Bottleneck ${b.promoted} - ${b.candidates} ${b.candidates === 1 ? 'candidate' : 'candidates'} screened: ${b.promoted} promoted, ${b.rejectedNoCompanyBenefit} rejected (no company-specific benefit), ${b.rejectedSupplyNotProven} rejected (supply constraint not proven)`;
  const f = d.structural.failures;
  d.lines.structural = `Multibagger / structural ${d.structural.passed} - ${d.structural.screened} screened. Failed on: no company-specific edge ${f.noCompanyEdge}, no multi-year demand evidence ${f.noMultiYearDemand}, insufficient earnings pathway ${f.insufficientEarningsPathway}, duration unknown ${f.durationUnknown}, valuation not assessable ${f.valuationNotAssessable}, governance / balance-sheet issue ${f.governanceOrBalanceSheet}`;
  const parts = Object.entries(d.noEarningsLink.byReason).sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k} ${v}`);
  d.lines.noLink = `No earnings link ${d.noEarningsLink.total}${parts.length ? ` - ${parts.join(', ')}` : ''}`;
  return d;
}

export function sourceSubjectOf(hinted: SourceSubject | null | undefined, company: string, own: OwnershipRead): { subject: SourceSubject; line: string; financialOwner: string } {
  const parent = squash(company) || 'Not identified';
  const target = own.targetNames[0];
  const fin = own.parentFinancial.length ? parent : own.foreign.length ? `${own.foreign[0].entity} (${own.foreign[0].entityRole === 'target' ? 'target' : own.foreign[0].entityRole}), not ${parent}` : 'Not established';
  const subject: SourceSubject = hinted && hinted.sourceSubject ? hinted : { eventSubject: parent, target, sourceSubject: target ? `${parent} (acquirer) and ${target} (target)` : parent, financialOwner: fin };
  const financialOwner = subject.financialOwner || fin;
  return { subject, line: `Source subject: ${subject.sourceSubject}`, financialOwner };
}
