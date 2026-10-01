// zzz852 B - deal terms by kind. Regex over the supplied text ONLY. Absent = listed in `missing` ('Not stated').
// Nothing is inferred: premium needs a stated reference price, and approvals / antitrust / minority words are never
// written by this file (statedConditions and approval fields are verbatim sentences from the text).

import type { DealKind, DealTerms } from './radar-owned-types';
import { extractOwnedNumbers, splitSentences } from './special-sit-numbers';

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE = `(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}|${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4})`;
const MONEY = '(?:US\\$|\\$|Rs\\.?|\\u20b9|INR|\\u20ac|\\u00a3)\\s?\\d[\\d,]*(?:\\.\\d+)?';
const MONEY_UNIT = `${MONEY}\\s?(?:lakh crores?|crores?|cr|lakhs?|million|mn|billion|bn)?`;
const PER_SHARE = '(?:per\\s+(?:common\\s+|equity\\s+)?share|\\/\\s?-?\\s?(?:per\\s+)?share|a\\s+share|each\\s+share|per\\s+unit)';

const clip = (s: string, n = 280): string => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
const first = (text: string, re: RegExp): RegExpMatchArray | null => text.match(re);
const sentenceWith = (sents: string[], re: RegExp): string | null => { for (const s of sents) if (re.test(s)) return clip(s); return null; };

type Ext = (text: string, sents: string[]) => string | null;
const E = {
  offerPrice: ((t, s) => {
    for (const sent of s) { if (!/\b(offer|tender|purchase|buy|bid|acquire|per share)\b/i.test(sent)) continue; const m = sent.match(new RegExp(`(${MONEY_UNIT})\\s*(?:in cash\\s*)?${PER_SHARE}`, 'i')); if (m) return `${m[1].trim()} per share`; }
    const m = first(t, new RegExp(`(?:offer(?:ed)? price|purchase price|price of)\\s+(?:of\\s+)?(${MONEY_UNIT})`, 'i')); return m ? m[1].trim() : null;
  }) as Ext,
  considerationType: ((t) => {
    const cash = /\ball[- ]cash\b|\bin cash\b|\bcash consideration\b|\bfor cash\b|\bcash offer\b/i.test(t);
    const shares = /\bstock consideration\b|\ball[- ]stock\b|\bin (?:exchange for )?(?:shares|stock)\b|\bshare exchange\b|\bexchange ratio\b|\bshares? of (?:the )?acquirer\b|\bnew shares\b/i.test(t);
    const debt = /\bassum(?:e|ption of) (?:the )?debt\b|\bdebt[- ]funded\b/i.test(t);
    const parts = [cash && 'cash', shares && 'shares', debt && 'assumed debt'].filter(Boolean) as string[];
    return parts.length ? parts.join(' and ') : null;
  }) as Ext,
  referencePrice: ((t) => { const m = first(t, new RegExp(`(?:closing (?:share |stock )?price|last (?:reported )?(?:sale |sales |closing )?price|reference price|VWAP|volume[- ]weighted average(?: price)?)[^.$\\u20b9]{0,60}?(${MONEY_UNIT})`, 'i')); return m ? `${m[0].trim()}` : null; }) as Ext,
  premium: ((t) => { const m = first(t, /(\d+(?:\.\d+)?)\s?%\s+(premium|discount)\b[^.]{0,80}/i); return m ? clip(m[0].trim(), 200) : null; }) as Ext,
  minTender: ((_t, s) => sentenceWith(s, /\bminimum\b/i)) as Ext,
  maxTender: ((_t, s) => sentenceWith(s, /\bmaximum\b|\bup to\b[^.]{0,40}\bshares\b|\bat most\b/i)) as Ext,
  expiry: ((t) => { const m = first(t, new RegExp(`(?:expire[sd]?|expiration(?: date)?|expiry|until|closes? on|open until)[^.]{0,60}?(${DATE})`, 'i')); return m ? m[1] : null; }) as Ext,
  settlement: ((_t, s) => sentenceWith(s, /\bsettle(?:d|ment)?\b|\bpayment (?:will be|is) made\b|\bpaid within\b/i)) as Ext,
  financing: ((_t, s) => sentenceWith(s, /\bfinanc\w*|\bfunded\b|\bfunding\b|\bbridge\b|\bcredit facilit\w*|\bborrow\w*|\bcash on hand\b|\bdebt\b/i)) as Ext,
  approvals: ((_t, s) => sentenceWith(s, /\bapproval|\bclearance|\bregulatory|\bHSR\b|\bCCI\b|\bSEBI\b|\bshareholder vote\b/i)) as Ext,
  purchasePrice: ((t) => {
    const m = first(t, new RegExp(`(?:for|at|worth|valued at|valuing[^.]{0,30}at|consideration of|purchase price of|deal value of|enterprise value of|transaction value of)\\s+(?:an? )?(?:total |aggregate )?(?:of )?(${MONEY_UNIT})`, 'i')); return m ? m[1].trim() : null;
  }) as Ext,
  targetRevenue: null as unknown as Ext,
  multiple: ((t) => { const m = first(t, /(\d+(?:\.\d+)?)\s?x\s+(?:EV\s?\/\s?)?(?:EBITDA|revenue|sales|earnings)\b|(?:EV\s?\/\s?(?:EBITDA|sales|revenue)|multiple)\s+of\s+(\d+(?:\.\d+)?)\s?x?/i); return m ? m[0].trim() : null; }) as Ext,
  newShares: ((_t, s) => sentenceWith(s, /\bnew shares\b|\bissu(?:e|ing|ance of)\b[^.]{0,60}\bshares\b|\bdilut\w*/i)) as Ext,
  expectedClose: ((_t, s) => sentenceWith(s, /\bexpected to (?:close|complete|be completed)\b|\bclosing (?:is )?expected\b|\bexpected (?:closing|completion)\b|\bcompletion (?:is )?expected\b|\bis expected to be effective\b/i)) as Ext,
  exchangeRatio: ((t) => { const m = first(t, /exchange ratio[^.]{0,60}|\b\d+(?:\.\d+)?\s+(?:equity\s+)?shares?(?:\s+of\s+[^.,]{2,40}?)?\s+for\s+(?:every|each)\s+\d+(?:\.\d+)?\b[^.,]{0,40}|\b\d+\s?:\s?\d+\b(?=\s*(?:ratio|share|swap|exchange))/i); return m ? clip(m[0].trim(), 160) : null; }) as Ext,
  sharesIssued: ((_t, s) => sentenceWith(s, /\b(?:issue[sd]?|issuing|issuance)\b[^.]{0,60}\bshares\b/i)) as Ext,
  ownershipSplit: ((_t, s) => sentenceWith(s, /\d+(?:\.\d+)?\s?%[^.]{0,50}\b(?:own|owned|ownership|hold|held|stake)\b|\b(?:own|ownership|hold|held)\b[^.]{0,50}\d+(?:\.\d+)?\s?%/i)) as Ext,
  recordDate: ((t) => { const m = first(t, new RegExp(`record date[^.]{0,40}?(${DATE})`, 'i')); return m ? m[1] : null; }) as Ext,
  ratio: ((t) => { const m = first(t, /\b(?:ratio of|in the ratio)\s+[^.,;]{2,50}|\b\d+(?:\.\d+)?\s+(?:equity\s+)?shares?[^.,;]{0,50}\s+for\s+(?:every|each)\s+\d+[^.,;]{0,40}|\b(?:one|1)\s+(?:equity\s+)?share\s+of\s+[^.,;]{2,40}\s+for\s+(?:every|each)[^.,;]{2,40}|\b\d+\s?:\s?\d+\b/i); return m ? clip(m[0].trim(), 160) : null; }) as Ext,
  listingDate: ((t) => { const m = first(t, new RegExp(`(?:listing|list(?:ed)?|trading|when-issued|begin trading)[^.]{0,50}?(${DATE})`, 'i')); return m ? m[1] : null; }) as Ext,
  businessTransferred: ((_t, s) => sentenceWith(s, /\b(?:demerg\w*|transfer\w*|spin\w*|separat\w*|hive\w*)\b[^.]{0,80}\b(?:business|undertaking|division|segment|unit)\b|\b(?:business|undertaking|division)\b[^.]{0,80}\b(?:demerg\w*|transfer\w*|spun|separat\w*)\b/i)) as Ext,
  debtCashAllocation: ((_t, s) => sentenceWith(s, /\b(?:debt|cash)\b[^.]{0,80}\b(?:alloc\w*|assum\w*|transfer\w*|capitali[sz]ation|retain\w*)\b|\b(?:alloc\w*|assum\w*|transfer\w*|capitali[sz]ation|retain\w*)\b[^.]{0,80}\b(?:debt|cash)\b/i)) as Ext,
  buybackSize: ((_t, s) => { for (const sent of s) { if (!/buy[- ]?back|repurchase/i.test(sent)) continue; const m = sent.match(new RegExp(`(${MONEY_UNIT})`, 'i')); if (m && !new RegExp(`${MONEY_UNIT}\\s*${PER_SHARE}`, 'i').test(m[0] + sent.slice((sent.indexOf(m[0]) + m[0].length), (sent.indexOf(m[0]) + m[0].length) + 14))) return m[1].trim(); } return null; }) as Ext,
  pctMarketCap: ((t) => { const m = first(t, /(\d+(?:\.\d+)?)\s?%\s+of\s+(?:its\s+|the\s+)?(?:total\s+)?(?:market cap\w*|paid[- ]up[^.,;]{0,30}|(?:post[- ]issue )?equity[^.,;]{0,30}|outstanding shares)/i); return m ? m[0].trim() : null; }) as Ext,
  buybackMethod: ((t) => { const m = first(t, /\b(tender offer|open market|stock exchange (?:route|mechanism)|dutch auction|accelerated share repurchase|ASR|proportionate basis)\b/i); return m ? m[1] : null; }) as Ext,
  buybackFunding: ((_t, s) => sentenceWith(s, /\bfunded\b|\bfunding\b|\bfrom (?:its )?(?:free )?reserves\b|\bcash (?:on hand|reserves)\b|\bfinanced\b/i)) as Ext,
  buybackPrice: ((t) => { const m = first(t, new RegExp(`(?:at a (?:maximum )?price of|price of|at up to|at)\\s+(${MONEY_UNIT})\\s*${PER_SHARE}?`, 'i')); return m ? m[1].trim() : null; }) as Ext,
  dps: ((t) => { const m = first(t, new RegExp(`(${MONEY_UNIT})\\s*${PER_SHARE}`, 'i')); return m ? m[0].trim() : null; }) as Ext,
  splitRatio: ((t) => { const m = first(t, /\b(?:split|bonus|sub-?division)[^.]{0,60}?(\d+\s?:\s?\d+|\d+-for-\d+|\d+\s+for\s+\d+)|\b(\d+\s?:\s?\d+)\b[^.]{0,20}\b(?:split|bonus)\b/i); return m ? m[0].trim() : null; }) as Ext,
};

interface Spec { name: string; ext: Ext }
const SPECS: Partial<Record<DealKind, Spec[]>> = {
  TENDER: [
    { name: 'offer_price', ext: E.offerPrice }, { name: 'consideration_type', ext: E.considerationType }, { name: 'reference_price', ext: E.referencePrice },
    { name: 'premium_or_discount', ext: E.premium }, { name: 'minimum_tender', ext: E.minTender }, { name: 'maximum_tender', ext: E.maxTender },
    { name: 'expiry_date', ext: E.expiry }, { name: 'settlement', ext: E.settlement }, { name: 'financing', ext: E.financing }, { name: 'regulatory_approvals', ext: E.approvals },
  ],
  ACQUISITION: [
    { name: 'purchase_price', ext: E.purchasePrice }, { name: 'consideration_type', ext: E.considerationType }, { name: 'target_revenue', ext: E.targetRevenue }, { name: 'target_ebitda', ext: E.targetRevenue },
    { name: 'multiple', ext: E.multiple }, { name: 'financing', ext: E.financing }, { name: 'new_shares_or_dilution', ext: E.newShares }, { name: 'expected_close', ext: E.expectedClose },
  ],
  MERGER: [
    { name: 'exchange_ratio', ext: E.exchangeRatio }, { name: 'shares_issued', ext: E.sharesIssued }, { name: 'ownership_split', ext: E.ownershipSplit },
    { name: 'approvals', ext: E.approvals }, { name: 'expected_close', ext: E.expectedClose },
  ],
  SPIN_OFF: [
    { name: 'record_date', ext: E.recordDate }, { name: 'ratio', ext: E.ratio }, { name: 'listing_date', ext: E.listingDate },
    { name: 'business_transferred', ext: E.businessTransferred }, { name: 'debt_cash_allocation', ext: E.debtCashAllocation },
  ],
  BUYBACK: [
    { name: 'size', ext: E.buybackSize }, { name: 'pct_of_market_cap', ext: E.pctMarketCap }, { name: 'method', ext: E.buybackMethod },
    { name: 'funding', ext: E.buybackFunding }, { name: 'price', ext: E.buybackPrice },
  ],
  DIVIDEND: [{ name: 'amount_per_share', ext: E.dps }, { name: 'record_date', ext: E.recordDate }],
  SPLIT_BONUS: [{ name: 'amount_per_share', ext: E.dps }, { name: 'record_date', ext: E.recordDate }, { name: 'ratio', ext: E.splitRatio }],
};

const COND_RE = /\bcondition|\bsubject to\b|\bexpir|\bminimum\b|\bapproval|\bfinancing\b/i;

export function extractDealTerms(text: string, kind: DealKind): DealTerms {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const sents = splitSentences(t);
  const specs = SPECS[kind] || [];
  const fields: Record<string, string> = {};
  const missing: string[] = [];
  // Target figures need an owner: only numbers owned by a target / subsidiary / acquired asset in the text.
  const owned = kind === 'ACQUISITION' ? extractOwnedNumbers('', t, 'ACQUISITION', '') : [];
  for (const sp of specs) {
    let v: string | null = null;
    if (sp.name === 'target_revenue' || sp.name === 'target_ebitda') {
      const metric = sp.name === 'target_revenue' ? 'revenue' : 'ebitda';
      const hit = owned.find((o) => o.metric === metric && (o.entityRole === 'target' || o.entityRole === 'subsidiary'));
      v = hit ? `${hit.raw}${hit.period && hit.period !== 'not stated' ? ` (${hit.period})` : ''}` : null;
    } else v = sp.ext(t, sents);
    if (v) fields[sp.name] = v; else missing.push(sp.name);
  }
  // Premium / discount is shown only when its reference price is stated too.
  if (kind === 'TENDER' && fields.premium_or_discount && !fields.reference_price) { delete fields.premium_or_discount; missing.push('premium_or_discount'); }
  const statedConditions = Array.from(new Set(sents.filter((s) => COND_RE.test(s)).map((s) => clip(s, 300))));
  return { kind, fields, statedConditions, missing };
}
