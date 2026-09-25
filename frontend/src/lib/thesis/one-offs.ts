// ═══════════════════════════════════════════════════════════════════════════
// ONE-OFF DETAIL — WHAT THE ITEM IS, IN THE COMPANY'S OWN WORDS.  (zzz765c)
//
// "One-offs: 1 item" tells the owner nothing he can check. The F thesis asks
// whether a profit jump rests on items that will not repeat, and answering
// that needs five facts about each item: what kind it is, how big, where it
// sits in the P&L, whether it is cash, and whether the company says it recurs.
//
// THE RULE: every field is read from EXPLICIT WORDS in the quote or the stated
// value, and is null otherwise. "Income tax refund" names a tax item; it does
// not say which P&L line carries it, so pl_line stays null. An amount without
// a magnitude word ("-1.6") is kept as raw text and never scaled to crore by
// assumption; a USD amount is never converted at a guessed rate; two different
// figures for one item are ambiguous and produce no amount at all.
//
// Pure — no I/O, no dependency on variables.ts, so it can be called from the
// extraction path without touching anything else.
// ═══════════════════════════════════════════════════════════════════════════

import { isBareRupeeAmount } from './figure-guards';

export type OneOffType =
  | 'earn-out' | 'exceptional item' | 'impairment' | 'forex' | 'tax'
  | 'VRS' | 'insurance claim' | 'asset sale' | 'other';

export type OneOffPlLine = 'below EBITDA' | 'within EBITDA' | 'other income' | 'tax' | 'exceptional';

export interface OneOffDetail {
  one_off_type: OneOffType;
  /** The amount exactly as written, e.g. "Rs. 241.7 Mn". Null when none is stated. */
  amount_raw: string | null;
  /** In ₹ crore, only when an INR amount with a magnitude word (crore, lakh,
   *  mn/million, bn/billion) is stated exactly once. Null otherwise. */
  amount_cr: number | null;
  pl_line: OneOffPlLine | null;
  cash: 'cash' | 'non-cash' | null;
  recurring: 'non-recurring' | 'recurring' | null;
  /** 'expense' or 'gain' only when the words say so (expense/charge/cost vs
   *  gain/income/refund/profit on). Used by oneOffLine. */
  effect: 'expense' | 'gain' | null;
  source_quote: string;
}

const TYPE_RULES: Array<[OneOffType, RegExp]> = [
  ['earn-out', /\bearn[- ]?outs?\b/i],
  ['VRS', /\bVRS\b|voluntary retirement/i],
  ['impairment', /\bimpair|write[- ]?(down|off)s?\b|written (down|off)/i],
  ['insurance claim', /\binsurance (claim|receipt|settlement|proceeds)/i],
  ['forex', /\bforex\b|foreign exchange|exchange (gain|loss|fluctuation|difference)|currency (gain|loss|translation|movement)|\bmtm\b.*\b(currency|derivative)/i],
  ['asset sale', /\b(sale|disposal|divestment) of\b|\bprofit on sale\b|\bgain on (sale|disposal)\b|\bdivest/i],
  ['tax', /\btax\b/i],
  ['exceptional item', /\bexceptional\b/i],
];

/** INR scale words → crore multiplier. */
const SCALE: Array<[RegExp, number]> = [
  [/^(crores?|cr|crs)$/i, 1],
  [/^(lakhs?|lacs?|lakh)$/i, 0.01],
  [/^(mn|million|millions|mio)$/i, 0.1],
  [/^(bn|billion|billions)$/i, 100],
];

// Currency (optional) · number (optional sign, Indian or western grouping) · magnitude word (optional).
// The word boundary keeps "years 2026" from reading as "Rs 2026".
const AMOUNT = /(₹|\$|\b(?:rs\.?|inr|usd|us\$))?\s*([-−–]?\s*\d[\d,]*(?:\.\d+)?)\s*(crores?|crs?|lakhs?|lacs?|mn|millions?|mio|bn|billions?)?\b/gi;

interface AmountHit { raw: string; currency: string | null; value: number; scale: string | null }

function amountsIn(text: string): AmountHit[] {
  const out: AmountHit[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const cur = m[1] ? m[1].toLowerCase() : null;
    const scale = m[3] || null;
    // A bare number with neither a currency nor a magnitude word is a year,
    // a count or a label ("Q1FY27", "2026"), not an amount.
    if (!cur && !scale) continue;
    const num = Number(m[2].replace(/[−–]/g, '-').replace(/[\s,]/g, ''));
    if (!Number.isFinite(num)) continue;
    out.push({ raw: m[0].trim(), currency: cur, value: num, scale });
  }
  return out;
}

function toCrore(hit: AmountHit): number | null {
  const isUsd = hit.currency === 'usd' || hit.currency === 'us$' || hit.currency === '$';
  if (isUsd || !hit.scale) return null;
  const rule = SCALE.find(([re]) => re.test(hit.scale!));
  if (!rule) return null;
  const cr = hit.value * rule[1];
  return Math.round(cr * 100) / 100;
}

function pickAmount(value: string | null, quote: string): { raw: string | null; cr: number | null } {
  // zzz802: an INR amount with no magnitude word ("Rs. 1,113.51") looks like a
  // per-share or price value — it is not an amount of the one-off, raw or scaled.
  const usable = (h: AmountHit) => !(h.scale == null && h.currency != null && /^(?:₹|rs\.?|inr)$/i.test(h.currency));
  const fromValue = value && value.trim() ? amountsIn(value).filter(usable) : [];
  const hits = fromValue.length ? fromValue : amountsIn(quote).filter(usable);
  if (!hits.length) {
    // A value that is itself a number with no unit is still what was stated —
    // unless it is a bare rupee figure (above), which is not kept at all.
    const bare = value && /\d/.test(value) && !isBareRupeeAmount(value) ? value.trim() : null;
    return { raw: bare, cr: null };
  }
  // A range written as "286-2,859 Mn" splits into two hits; so does "USD 689
  // million … INR 5,881.23 crore". Two different figures for one item are
  // ambiguous: keep the words, claim no number.
  const distinct = new Set(hits.map((h) => `${h.value}|${h.scale || ''}|${h.currency || ''}`));
  const rangeInValue = !!value && /\d\s*[-–]\s*\d/.test(value.replace(/^\s*[-−–]/, ''));
  if (distinct.size > 1 || rangeInValue) {
    return { raw: (fromValue.length ? value!.trim() : hits.map((h) => h.raw).join(' / ')), cr: null };
  }
  return { raw: hits[0].raw, cr: toCrore(hits[0]) };
}

export function parseOneOff(quote: string, value: string | null): OneOffDetail {
  const q = String(quote || '').trim();
  const words = `${q} ${value || ''}`;
  const one_off_type = (TYPE_RULES.find(([, re]) => re.test(q)) || TYPE_RULES.find(([, re]) => re.test(words)) || ['other'])[0] as OneOffType;
  const amt = pickAmount(value, q);

  const pl_line: OneOffPlLine | null =
    /\bbelow (the )?(ebitda|operating (line|profit))\b/i.test(words) ? 'below EBITDA'
      : /\b(within|in|part of|included in|through) (the )?ebitda\b/i.test(words) ? 'within EBITDA'
        : /\bother income\b/i.test(words) ? 'other income'
          : /\bexceptional\b/i.test(words) ? 'exceptional'
            : /\b(tax (expense|charge|credit|line|provision|write[- ]?back)|deferred tax)\b/i.test(words) ? 'tax'
              : null;

  const cash: OneOffDetail['cash'] =
    /\bnon[- ]?cash\b|\bnotional\b/i.test(words) ? 'non-cash'
      : /\b(in cash|cash (gain|inflow|outflow|payment|proceeds|settlement|received|component|consideration))\b/i.test(words) ? 'cash'
        : null;

  const recurring: OneOffDetail['recurring'] =
    /\bnon[- ]?recurring\b|\bone[- ]?(off|time)\b|\b(will|would|does|is) not (recur|repeat)\b|\bnot (expected )?to (recur|repeat)\b/i.test(words) ? 'non-recurring'
      : /(?<!non[- ]?)\brecurring\b|\bwill (recur|repeat)\b/i.test(words) ? 'recurring'
        : null;

  const effect: OneOffDetail['effect'] =
    /\b(expenses?|charges?|costs?|loss(es)?|write[- ]?(off|down)s?|impairment)\b/i.test(q) ? 'expense'
      : /\b(gains?|income|refunds?|profit on|proceeds|write[- ]?back)\b/i.test(q) ? 'gain'
        : null;

  return {
    one_off_type, amount_raw: amt.raw, amount_cr: amt.cr, pl_line, cash, recurring, effect,
    source_quote: q,
  };
}

function fmtCr(cr: number): string {
  const abs = Math.abs(cr);
  const s = Number.isInteger(abs) ? abs.toLocaleString('en-IN') : abs.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${cr < 0 ? '−' : ''}₹${s} Cr`;
}

/** "₹56 Cr · earn-out expense · below EBITDA · non-recurring". Only fields
 *  that were stated appear; nothing is filled in to make the line complete. */
export function oneOffLine(d: OneOffDetail): string {
  const parts: string[] = [];
  if (d.amount_cr != null) parts.push(fmtCr(d.amount_cr));
  else if (d.amount_raw) parts.push(d.amount_raw);
  parts.push(d.effect ? `${d.one_off_type} ${d.effect}` : d.one_off_type);
  if (d.pl_line && !(d.pl_line === 'exceptional' && d.one_off_type === 'exceptional item')) parts.push(d.pl_line);
  if (d.cash) parts.push(d.cash);
  if (d.recurring) parts.push(d.recurring);
  return parts.join(' · ');
}
