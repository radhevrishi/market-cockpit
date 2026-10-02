// zzz852 A - owned numbers. Every money / capacity figure gets an owner. A figure owned by a target, subsidiary,
// transaction, asset or market is NEVER the parent's earnings. Conservative: unclear ownership -> 'unknown', not counted.
// Pure, regex over the supplied text only. Nothing is inferred or invented.

import type { EntityRole, NumberMetric, NumberNature, OwnedNumber } from './radar-owned-types';

const CUR: Array<[RegExp, string]> = [[/^(?:rs\.?|inr|₹)/i, 'INR'], [/^(?:us\$|usd|\$)/i, 'USD'], [/^(?:€|eur)/i, 'EUR'], [/^(?:£|gbp)/i, 'GBP'], [/^cad/i, 'CAD']];
const MONEY_RE = /(?:rs\.?|inr|₹|us\$|usd|\$|€|eur|£|gbp|cad)\s?(\d[\d,]*(?:\.\d+)?)\s?(lakh crores?|crores?|cr|lakhs?|lacs?|million|mn|billion|bn|trillion|thousand|m|b)?\b|\b(\d[\d,]*(?:\.\d+)?)\s?(lakh crores?|crores?|crs?)\b/gi;
const CAP_RE = /\b(\d[\d,]*(?:\.\d+)?)\s?(MWp|MWh|MW|GWh|GW|KW|MTPA|ktpa|TPA)\b/g;

const UNIT_NORM: Record<string, string> = { cr: 'crore', crs: 'crore', crore: 'crore', crores: 'crore', 'lakh crore': 'lakh crore', 'lakh crores': 'lakh crore', lakh: 'lakh', lakhs: 'lakh', lac: 'lakh', lacs: 'lakh', million: 'million', mn: 'million', m: 'million', billion: 'billion', bn: 'billion', b: 'billion', trillion: 'trillion', thousand: 'thousand' };

const REVENUE_RE = /\b(revenues?|sales|turnover|top[- ]?line)\b/i;
const EBITDA_RE = /\bebitda\b/i;
const PAT_RE = /\b(net profit|profit|pat|net income|earnings|net loss|loss)\b/i;
const MARKET_RE = /\b(market|industry|sector|segment|category)\b/i;
const ORDER_RE = /\b(orders?|contracts?|order book|awarded|bags|secures?|wins?)\b/i;
const CAPEX_RE = /\b(capex|capital expenditure|outlay)\b/i;
const ACQ_RE = /\b(acquir\w*|acquisition|buy(?:s|ing)?|bought|purchas\w*|takeover|take over|snap\w* up|stake|bet|invest\w*|infus\w*|buyout|foray|launch\w*|new brand|enter\w*)\b/i;
const BUY_RE = /\b(acquir\w*|acquisition|buy(?:s|ing)?|bought|purchas\w*|takeover|take over|snap\w* up|buyout)\b/i;
const GENERIC_TARGET_RE = /\b(the business|the brand|the target|the acquired (?:company|business|entity)|the company it is buying|its unit|the unit|the subsidiary|the arm)\b/i;
const SUBSIDIARY_RE = /\b(subsidiary|subsidiaries|arm|unit|step-down)\b/i;
const PERIOD_RE = /\b(Q[1-4]\s?FY\s?'?\d{2,4}|H[12]\s?FY\s?'?\d{2,4}|FY\s?'?\d{2,4}|FY\d{4}|calendar (?:year )?\d{4}|CY\d{2,4}|\d{4}-\d{2})\b/i;
const NAME = "[A-Z][\\w&.'\\u2019-]*(?:\\s+[A-Z][\\w&.'\\u2019-]*){0,3}";

// zzz854: management forecasts / targets are never reported figures.
export const FORECAST_RE = /\b(?:expects?|expected|expecting|targets?|targeting|targeted|aims?|aiming|guidance|guided|guides|outlook|projects?|projected|projection|forecasts?|forecast(?:ed|ing)?|estimates?|estimated|plans? to|hopes? to|aspires?|envisag\w+|to (?:reach|touch|cross|hit|achieve|double|triple)|will (?:reach|touch|cross|hit|achieve|double)|could (?:reach|touch|cross|hit)|by (?:FY|20)\s?'?\d{2,4}|over the next \w+ years?|in the next \w+ years?)\b/i;
const TGT_STOP = new Set(['The', 'A', 'An', 'Its', 'It', 'Stake', 'Shares', 'Share', 'Company', 'Rs', 'For', 'In', 'Into', 'To', 'On', 'At', 'Of', 'And', 'Remaining', 'Majority', 'Controlling', 'Minority', 'Additional', 'Further', 'Full', 'Entire', 'Balance', 'Bet', 'Deal', 'Buy', 'Big']);
const TGT_NAME = "[A-Z][\\w&.'\\u2019-]*(?:\\s+[A-Z][\\w&.'\\u2019-]*){0,3}";
const TGT_VERB_RE = new RegExp(`\\b(?:acquir(?:e|es|ed|ing)|acquisition of|buy(?:s|ing)?(?:\\s+out)?|bought|buy-?out of|takeover of|take over|takes over|snap(?:s|ped)? up|stake in|(?:invest(?:s|ed|ing|ment)?|infus\\w+|pump\\w*|bet\\w*)\\s+(?:[^.;]{0,30}?\\s)?(?:in|into|on)|merge(?:s|d)? with|purchase(?:s|d)? of|bid for|offer for|open offer for|tender offer for)\\s+(?:(?:a|an|the|its|remaining|majority|controlling|minority|additional|further|full|entire|balance)\\s+)*(?:\\d+(?:\\.\\d+)?\\s?%\\s+(?:stake\\s+)?(?:in\\s+)?)?(?:stake\\s+in\\s+)?(${TGT_NAME})`, 'g');
// "A's ₹900 cr B bet", "A's $2 bn B deal", "A's B buyout"
const TGT_POSS_RE = new RegExp(`['\\u2019]s\\s+(?:(?:[Rr][Ss]\\.?|INR|inr|\\u20b9|US\\$|us\\$|USD|usd|\\$|\\u20ac|\\u00a3)\\s?[\\d,.]+\\s?(?:lakh crores?|crores?|[Cc]r|lakhs?|million|mn|billion|bn|[mbMB]n?)?\\s+)?(${TGT_NAME})\\s+(?:bet|buy|buyout|deal|acquisition|takeover|stake|purchase|investment|bid)\\b`, 'g');

/**
 * zzz854: names of the business being bought / invested in, read from deal wording only ('A acquires B', 'A to buy stake in B',
 * "A's ₹900 cr B bet"). The event company itself is never returned. Nothing is inferred beyond the words.
 */
export function dealTargetNames(text: string, companyName: string | null | undefined): string[] {
  const out: string[] = [];
  const co = (companyName || '').trim();
  const t = (text || '').replace(/\s+/g, ' ');
  for (const re of [TGT_VERB_RE, TGT_POSS_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const words = m[1].split(/\s+/).filter((w) => !TGT_STOP.has(w.replace(/[.,'\u2019]+$/, '')));
      // stop at a verb-like trailing word ('Yoga Bar Rises' never happens in a name, but 'Zenbar Foods For' does)
      const name = words.join(' ').replace(/['\u2019]s$/i, '').replace(/[.,'\u2019-]+$/, '').trim();
      if (name.length < 2 || /^\d/.test(name)) continue;
      if (co && sameCompanyName(name, co)) continue;
      if (/^(?:Rs|INR|USD|Crore|Cr|Million|Billion|Q[1-4]|FY\d*)$/i.test(name)) continue;
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

const CORP_TOKENS = new Set(['inc', 'incorporated', 'corp', 'corporation', 'plc', 'ltd', 'limited', 'llc', 'sa', 'nv', 'ag', 'holdings', 'holding', 'group', 'the', 'pvt', 'private', 'lp']);
export function normName(s: string): string[] {
  return (s || '').toLowerCase().replace(/\ba\/s\b/g, ' ').replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !CORP_TOKENS.has(t));
}
/** True when two company names denote the same entity (token subset after stripping corporate words). */
export function sameCompanyName(a: string, b: string): boolean {
  const x = normName(a), y = normName(b);
  if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every((t) => l.includes(t));
}

export function splitSentences(text: string): string[] {
  return (text || '').replace(/\s+/g, ' ').split(/(?<=[.;!?])\s+(?=[A-Z"'“‘(])/).map((s) => s.trim()).filter(Boolean);
}

function currencyOf(prefix: string): string | undefined { for (const [re, c] of CUR) if (re.test(prefix)) return c; return undefined; }

function ownerBefore(before: string): { name: string; generic: boolean } | null {
  const b = before.replace(/\s+$/, '');
  const rel = b.match(new RegExp(`(${NAME}),?\\s+(?:which|that|whose)\\b[^,;]{0,40}$`));
  if (rel) return { name: rel[1], generic: false };
  const gen = b.slice(-70).match(GENERIC_TARGET_RE);
  if (gen) return { name: gen[1], generic: true };
  const poss = b.match(new RegExp(`(${NAME})['\\u2019]s\\s+(?:[\\w-]+\\s+){0,2}$`));
  if (poss) return { name: poss[1], generic: false };
  const verbs = Array.from(b.matchAll(new RegExp(`(${NAME})\\s+(?:reported|posted|clocked|recorded|logged|booked|earned|generated|had|has|saw|delivered|achieved)\\b`, 'g')));
  if (verbs.length) return { name: verbs[verbs.length - 1][1], generic: false };
  return null;
}
function leadSubject(sentence: string): string | null {
  const m = sentence.match(new RegExp(`^(?:will |can |should )?(${NAME})(?:['\\u2019]s)?\\b`));
  if (!m) return null;
  const words = m[1].split(/\s+/).filter((w) => !/^(?:Q[1-4]|FY\d*|Rs|Net|Total|The|Revenue|Profit)$/i.test(w));
  return words.join(' ') || null;
}

interface Ctx { acquisitionKind: boolean; companyName: string; targets: string[] }

function metricFromContext(sentence: string, start: number, end: number): { metric: NumberMetric | null; dist: number } {
  const after = sentence.slice(end, end + 40).split(/[,;]/)[0];
  const beforeFull = sentence.slice(Math.max(0, start - 45), start);
  const before = beforeFull.split(/[,;]/).pop() || '';
  const cands: Array<[NumberMetric, RegExp]> = [['revenue', REVENUE_RE], ['ebitda', EBITDA_RE], ['pat', PAT_RE], ['capex', CAPEX_RE]];
  let best: { metric: NumberMetric; dist: number } | null = null;
  for (const [m, re] of cands) {
    const a = after.match(re); if (a) { const d = (a.index || 0); if (!best || d < best.dist) best = { metric: m, dist: d }; }
    let last: RegExpMatchArray | null = null;
    for (const mm of before.matchAll(new RegExp(re.source, 'gi'))) last = mm;
    if (last) { const d = before.length - ((last.index || 0) + last[0].length) + 0.5; if (!best || d < best.dist) best = { metric: m, dist: d }; }
  }
  return best ? { metric: best.metric, dist: best.dist } : { metric: null, dist: 99 };
}

function classify(sentence: string, start: number, end: number, ctx: Ctx, isCapacity: boolean): { metric: NumberMetric; role: EntityRole; entity: string; parent: boolean } {
  const acq = ctx.acquisitionKind || ACQ_RE.test(sentence);
  if (isCapacity) {
    return acq ? { metric: 'capacity', role: 'acquired_asset', entity: 'acquired assets', parent: false } : { metric: 'capacity', role: 'unknown', entity: 'not stated', parent: false };
  }
  const after = sentence.slice(end, end + 40).split(/[,;]/)[0];
  const beforeNear = (sentence.slice(Math.max(0, start - 45), start).split(/[,;]/).pop() || '');
  const { metric: fin } = metricFromContext(sentence, start, end);
  const marketCue = /\b(market|industry|sector|segment)\b[^,;]{0,25}\b(worth|valued|size|sized|estimated|projected|to reach|of)\b/i.test(beforeNear + ' ' + after) || /\b(worth|valued at|size)\b[^,;]{0,15}$/i.test(beforeNear) && MARKET_RE.test(beforeNear + after) || /\b(market|industry|sector)\b/i.test(after.slice(0, 20));
  if (marketCue && !fin) return { metric: 'market_size', role: 'market', entity: 'market / industry', parent: false };
  if (marketCue && fin && MARKET_RE.test(beforeNear)) return { metric: 'market_size', role: 'market', entity: 'market / industry', parent: false };

  if (fin === 'revenue' || fin === 'ebitda' || fin === 'pat') {
    const owner = ownerBefore(sentence.slice(0, start));
    const co = ctx.companyName;
    // zzz854: in a deal / stake article a financial figure is the parent's ONLY when the parent is named as its owner.
    // A generic owner ('the brand', 'its') or no owner at all belongs to the business being bought when the source names one.
    const tgt = ctx.targets[0] || null;
    const tgtInSentence = ctx.targets.find((n) => sentence.toLowerCase().includes(n.toLowerCase())) || null;
    if (owner && !owner.generic) {
      if (co && sameCompanyName(owner.name, co)) return { metric: fin, role: 'parent', entity: owner.name, parent: true };
      const asTarget = ctx.targets.find((n) => sameCompanyName(n, owner.name));
      if (asTarget) return { metric: fin, role: 'target', entity: asTarget, parent: false };
      if (acq && /^(?:its|it|their|the)$/i.test(owner.name.trim()) && tgt) return { metric: fin, role: 'target', entity: tgtInSentence || tgt, parent: false };
      return { metric: fin, role: SUBSIDIARY_RE.test(sentence) && !acq ? 'subsidiary' : acq ? 'target' : 'unknown', entity: owner.name, parent: false };
    }
    if (owner && owner.generic) return { metric: fin, role: SUBSIDIARY_RE.test(owner.name) ? 'subsidiary' : 'target', entity: tgtInSentence || tgt || owner.name, parent: false };
    const lead = leadSubject(sentence);
    if (lead && co && sameCompanyName(lead, co)) {
      // 'Parent to acquire Target; Target ... revenue' is handled above. Here the sentence is led by the event company itself.
      if (acq && !/\b(reported|posted|clocked|recorded|logged|booked|earned|generated|delivered|achieved)\b/i.test(sentence)) return { metric: fin, role: tgt ? 'target' : 'unknown', entity: tgtInSentence || tgt || 'not stated', parent: false };
      return { metric: fin, role: 'parent', entity: lead, parent: true };
    }
    if (lead && !(co && sameCompanyName(lead, co))) {
      if (/^(?:its|it|their)$/i.test(lead.trim())) return { metric: fin, role: acq && tgt ? 'target' : 'unknown', entity: acq && tgt ? (tgtInSentence || tgt) : 'not stated', parent: false };
      const asTarget = ctx.targets.find((n) => sameCompanyName(n, lead));
      return { metric: fin, role: acq || asTarget ? 'target' : 'unknown', entity: asTarget || lead, parent: false };
    }
    if (acq && tgt) return { metric: fin, role: 'target', entity: tgtInSentence || tgt, parent: false };
    return { metric: fin, role: 'unknown', entity: 'not stated', parent: false };
  }
  if (fin === 'capex') return { metric: 'capex', role: acq ? 'transaction' : 'unknown', entity: acq ? 'investment programme' : 'not stated', parent: false };

  if (acq) {
    const metric: NumberMetric = BUY_RE.test(sentence) && !/\bbet\b/i.test(sentence.slice(end, end + 30)) ? 'purchase_price' : 'investment';
    return { metric, role: 'transaction', entity: 'acquisition transaction', parent: false };
  }
  if (ORDER_RE.test(beforeNear + ' ' + after)) {
    const lead = leadSubject(sentence);
    if (lead && ctx.companyName && sameCompanyName(lead, ctx.companyName)) return { metric: 'order_value', role: 'parent', entity: lead, parent: true };
    return { metric: 'order_value', role: 'unknown', entity: lead || 'not stated', parent: false };
  }
  return { metric: 'other', role: 'unknown', entity: 'not stated', parent: false };
}

/** zzz854: what kind of figure a metric is. Revenue / EBITDA / profit stated as an expectation or target is a forecast, never reported. */
export function natureOf(metric: NumberMetric, sentence: string): NumberNature {
  if (metric === 'revenue' || metric === 'ebitda' || metric === 'pat' || metric === 'eps') return FORECAST_RE.test(sentence) ? 'forecast' : 'reported';
  if (metric === 'purchase_price' || metric === 'deal_value' || metric === 'investment' || metric === 'offer_price' || metric === 'percent_stake') return 'deal_consideration';
  if (metric === 'capacity') return 'capacity';
  if (metric === 'order_value') return 'order_value';
  if (metric === 'market_size') return 'market_size';
  if (metric === 'dividend_per_share' || metric === 'buyback_size') return 'shareholder_payout';
  return 'other';
}

/**
 * Owned numbers from a headline + description. eventKind is a free label ('ACQUISITION', 'EARNINGS', 'ORDER', ...).
 * companyName is the event company (the parent). Absent ownership -> role 'unknown', countsAsParentEarnings=false.
 */
export function extractOwnedNumbers(title: string, description: string | undefined | null, eventKind: string | undefined | null, companyName: string | undefined | null): OwnedNumber[] {
  const out: OwnedNumber[] = [];
  const seen = new Set<string>();
  const kind = (eventKind || '').toUpperCase();
  const sentences = [...splitSentences(title || ''), ...splitSentences(description || '')];
  const targets = dealTargetNames(`${title || ''}. ${description || ''}`, companyName);
  const ctx: Ctx = { acquisitionKind: /ACQ|MERGER|M&A|\bMA\b|INVEST|BRAND|STAKE|BUYOUT|TAKEOVER/.test(kind) || (targets.length > 0 && ACQ_RE.test(`${title || ''} ${description || ''}`)), companyName: (companyName || '').trim(), targets };
  for (const sentence of sentences) {
    const hits: Array<{ start: number; end: number; raw: string; value: number; currency?: string; unit?: string; cap: boolean }> = [];
    for (const m of sentence.matchAll(MONEY_RE)) {
      const numTxt = m[1] ?? m[3]; const unitTxt = (m[2] ?? m[4] ?? '').toLowerCase();
      const value = parseFloat((numTxt || '').replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      const prefix = (m[0].match(/^(?:rs\.?|inr|₹|us\$|usd|\$|€|eur|£|gbp|cad)/i) || [''])[0];
      hits.push({ start: m.index || 0, end: (m.index || 0) + m[0].length, raw: m[0].trim(), value, currency: prefix ? currencyOf(prefix) : (unitTxt && /cr|lakh|lac/.test(unitTxt) ? 'INR' : undefined), unit: UNIT_NORM[unitTxt] || (unitTxt || undefined), cap: false });
    }
    for (const m of sentence.matchAll(CAP_RE)) {
      const value = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      hits.push({ start: m.index || 0, end: (m.index || 0) + m[0].length, raw: m[0].trim(), value, unit: m[2], cap: true });
    }
    hits.sort((a, b) => a.start - b.start);
    for (const h of hits) {
      const c = classify(sentence, h.start, h.end, ctx, h.cap);
      const key = `${h.raw}|${c.metric}|${c.entity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const per = sentence.match(PERIOD_RE);
      const nature = natureOf(c.metric, sentence);
      // a management forecast / target is never a reported figure, so it never counts as the company's earnings
      const countable = c.parent && nature !== 'forecast' && (c.metric === 'revenue' || c.metric === 'ebitda' || c.metric === 'pat' || c.metric === 'order_value' || c.metric === 'eps');
      out.push({ value: h.value, currency: h.currency, unit: h.unit, raw: h.raw, metric: c.metric, period: per ? per[1] : 'not stated', entity: c.entity, entityRole: c.role, sentence, countsAsParentEarnings: countable, metricOwner: c.entity, nature });
    }
  }
  return out;
}
