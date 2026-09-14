// ═══════════════════════════════════════════════════════════════════════════
// ONE-OFFS THE RELEASE ITSELF QUANTIFIES — the Burlington class.
//
// Burlington's Q2 FY26 release headlined "Adjusted EPS of $2.96", and that
// figure — the company's OWN adjusted number — "includes an approximate $0.60
// benefit related to the net impact of tariff refunds". Ex the refund the
// quarter earned about $2.37 against a $2.19 street number: a real but modest
// beat, not the 35% one the headline reads as. Dollar Tree, Abercrombie, Gap,
// Bath & Body Works and Agilent all carried the same shape this quarter, each
// with its own wording.
//
// The engine's existing one-off detection compares GAAP to adjusted EPS. That
// catches an item the company EXCLUDED from its adjusted figure. It cannot
// catch an item the company INCLUDED in it and merely disclosed in a sentence,
// which is exactly the case here: the adjusted number is the inflated number.
//
// So this module reads the sentence. It is a GENERAL rule, not a tariff rule:
// any per-share amount the release ties to an item from the discrete-item
// vocabulary below (refunds, recoveries, settlements, gains on sale, tax
// benefits, reserve releases, out-of-period catch-ups, …) and states as
// INCLUDED in an earnings figure is surfaced, with its sign, its label and the
// sentence it came from. Nothing is inferred: if the release does not put a
// per-share number on it, no per-share number is produced.
// ═══════════════════════════════════════════════════════════════════════════

import { htmlToText } from './us-guidance';

export interface OneOff {
  /** Short label built from the release's own words ("tariff refunds"). */
  label: string;
  /** Per-share effect on the reported figure, signed: + is a benefit. */
  per_share: number | null;
  /** 'benefit' | 'charge' | 'unknown' (an "impact" the sentence never signs). */
  kind: 'benefit' | 'charge' | 'unknown';
  /** True when the sentence says the headline/adjusted figure INCLUDES it. */
  included: boolean;
  /** The sentence speaks of an adjusted / non-GAAP figure. A charge disclosed
   *  inside a GAAP sentence is normally already excluded from adjusted EPS, so
   *  it is surfaced but never subtracted a second time. */
  adjusted_basis: boolean;
  /** Ex-item EPS the company itself stated, when it did ("excluding …, EPS was $2.37"). */
  ex_eps_stated: number | null;
  /** The PRIOR-YEAR figure on the same ex-item basis, when the same sentence
   *  gives it ("…, or $2.37 per share, vs. $110 million, or $1.72 per share for
   *  the second quarter of Fiscal 2025"). Without it the growth rate mixes two
   *  bases: $2.37 against the headline prior $1.59 is +49%, and against the
   *  company's own comparable $1.72 it is +38% — the number the company and
   *  every feed printed. */
  ex_eps_prev_stated: number | null;
  /** The sentence, trimmed, so the card can quote the company rather than us. */
  quote: string;
}

/** Vocabulary that marks an item as discrete rather than operating. This is a
 *  CLASS list — nothing in it names a company or a quarter. */
const DISCRETE = /\b(one[- ]time|non[- ]?recurring|discrete|unusual|refunds?|recover(?:y|ies|ed)|drawbacks?|settlements?|gains?\s+(?:and\s+losses\s+)?on\s+[a-z ]{0,20}(?:sale|investments?|securities|disposal|divestiture)|strategic investments?|mark[- ]to[- ]market|fair[- ]value (?:gains?|losses?|remeasurement|adjustments?)|insurance|reversals?|releases? of|true[- ]ups?|catch[- ]up|out[- ]of[- ]period|prior[- ]period|retroactive|cumulative|tax benefits?|valuation allowance|litigation|legal|impairments?|restructuring|severance|write[- ]?(?:offs?|downs?)|credits?|windfall)\b/i;

const EARNINGS_WORD = /\b(EPS|earnings per share|net income|net earnings|diluted earnings|adjusted earnings|income per share|earnings)\b/i;
// The verbs that tie an item TO a reported figure. "Contributed" belongs here
// as much as "includes": Advance Auto Parts wrote "Tariff refunds contributed
// approximately $0.31 to second quarter 2026 adjusted diluted earnings per
// share" — the same disclosure Burlington made with "including", and without
// this verb the $0.31 was read out of the release and then discarded as not
// attached to anything, leaving a $0.23 "beat" that was entirely the refund.
const INCLUDES = /\b(includ(?:es|ed|ing)|inclusive of|reflect(?:s|ed|ing)|benefit(?:ed|ted|s)? from|driven by|boosted by|helped by|aided by|contribut(?:ed|es|ing|ion)|added|accounted for|represent(?:ed|s)|attributable to)\b/i;
const BENEFIT = /\b(benefits?|gains?|tailwinds?|favou?rable|positive|credits?|contribut(?:ed|ion))\b/gi;
const CHARGE = /\b(charges?|expenses?|costs?|headwinds?|unfavou?rable|negative|losses?|impairments?)\b/gi;
const PER_SHARE_SUBJECT = /\b(EPS|per (?:diluted |basic )?share|earnings per share|income per share)\b/i;

interface Amt { value: number; index: number; length: number }

/**
 * Every per-share dollar amount in a sentence. An amount is per-share when it
 * says so ("$0.60 per diluted share", "60 cents per share"), or when the
 * sentence is ABOUT a per-share figure and the amount is not a money total
 * ("$0.60 benefit" in a sentence about adjusted EPS; never "$12 million").
 */
function perShareAmounts(s: string): Amt[] {
  const out: Amt[] = [];
  const subjectIsPerShare = PER_SHARE_SUBJECT.test(s);
  const re = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(\s*(?:million|billion|thousand|mm|bn|[mbk])\b)?|(\d{1,3})\s+cents?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[3] != null) { out.push({ value: Number(m[3]) / 100, index: m.index, length: m[0].length }); continue; }
    if (m[2]) continue;                                  // a money total, not per share
    const v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0 || v > 50) continue;
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const explicit = /^\s*(?:per\s+(?:diluted\s+|basic\s+)?(?:common\s+)?share|\/\s?(?:diluted\s+)?share)/i.test(after);
    if (explicit || (subjectIsPerShare && /\.\d{2}$/.test(m[1]))) out.push({ value: v, index: m.index, length: m[0].length });
  }
  return out;
}

function nearestDistance(s: string, re: RegExp, at: number): number {
  let best = Infinity;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const d = m.index > at ? m.index - at : at - (m.index + m[0].length);
    if (d < best) best = d;
  }
  return best;
}

function splitSentences(text: string): string[] {
  // Lines first: htmlToText ends every paragraph, bullet and table cell with a
  // newline, so a bulleted highlights block becomes one candidate per bullet
  // and a table becomes short cell fragments that never pass the word tests.
  return text
    .split(/\n/)
    .flatMap((line) => line
      .replace(/\s+/g, ' ')
      // Keep "$2.96." style decimals intact: split only on a period followed
      // by a space and a capital, or on a semicolon.
      .split(/(?<=[a-z0-9%)"'])\.\s+(?=[A-Z"(])|;\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 700);
}

function labelFrom(sentence: string, amtIdx: number): string {
  // The words after "related to / from / of / due to / associated with", cut at
  // the next clause boundary. Fall back to the discrete word itself.
  const tail = sentence.slice(amtIdx);
  const m = tail.match(/\b(?:related to|relating to|associated with|attributable to|due to|from|of|for)\s+(?:the\s+|an?\s+)?(?:net\s+)?(?:impact\s+of\s+(?:the\s+)?)?([a-z][a-z0-9 &'\-\/]{2,60}?)(?=[,.;:()]|\s+(?:and|which|that|in|on|during|compared|versus|vs)\b|$)/i);
  if (m) {
    const lab = m[1].trim().replace(/\s*\d+$/, '').toLowerCase();   // "tariff refunds 1" — a footnote mark
    // "…benefits of $1.65 FOR Q2 2026" names a period, not the item. Fall
    // through to the item vocabulary rather than labelling a refund "q2".
    // "…of $150 million OF WHICH approximately $100 million…" — the words after
    // the preposition are a relative clause, not the item. A label that starts
    // on a connective or a hedge is not naming anything, and "which
    // approximately" on a Kohl's card was how that showed.
    const JUNK_HEAD = /^(?:which|that|whom|approximately|about|roughly|it|this|these|those|such|them|these\s)/i;
    if (lab && !JUNK_HEAD.test(lab)
        && !/^(?:q[1-4]|fy|the\s+(?:quarter|year)|quarter|year|fiscal)\b/i.test(lab) && lab.length > 2) return lab;
  }
  // The item vocabulary, with the word in front of it when it qualifies the
  // item ("tariff refunds", "IEEPA recovery") rather than the bare noun.
  const d = sentence.match(new RegExp(`([A-Za-z]+\\s+)?${DISCRETE.source.replace(/^\\b|\\b$/g, '')}`, 'i'));
  return d ? d[0].trim().toLowerCase() : 'discrete item';
}

const FORWARD = /\b(guidance|expects?|expected|anticipates?|forecasts?|estimated?|projected|remainder of|to a range of|outlook (?:to|of|for|range))\b|^\s*(?:fiscal\s+\d{4}\s+)?outlook\b/i;
/** A sentence about a longer period than the quarter, or a flattened table. */
const NOT_THE_QUARTER = /\b(?:six|nine|twelve) months|year[- ]to[- ]date|first half|second half|(?:26|39|52|53)[- ]weeks?\b/i;

/** First per-share amount in `s` at or after `from` (an "excluding …" clause),
 *  before any comparison ("vs", "compared"). */
function perShareAfter(s: string, from: number): number | null {
  const tail = s.slice(from).split(/\b(?:vs\.?|versus|compared)\b/i)[0];
  const m = tail.match(/\$\s?(\d+\.\d{2})\s*(?:per\s+(?:diluted\s+)?(?:common\s+)?share|\/\s?share)/i)
    || tail.match(/(?:per\s+(?:diluted\s+)?share|EPS|earnings per share)\s+(?:would have been|was|were|of|totaled)\s+\$\s?(\d+\.\d{2})/i);
  return m ? Number(m[1]) : null;
}

/** The per-share figure in the COMPARISON tail of the same sentence — the
 *  prior year on the same ex-item basis. Refused when it equals the current
 *  figure (a sentence that repeats one number is not giving two). */
function priorPerShareAfter(s: string, current: number): number | null {
  const parts = s.split(/\b(?:vs\.?|versus|compared (?:with|to))\b/i);
  if (parts.length < 2) return null;
  const m = parts[1].match(/\$\s?(\d+\.\d{2})\s*(?:per\s+(?:diluted\s+)?(?:common\s+)?share|\/\s?share)/i);
  if (!m) return null;
  const v = Number(m[1]);
  return (Number.isFinite(v) && Math.abs(v - current) > 0.005) ? v : null;
}

/**
 * Extract every quantified one-off the release states around an earnings
 * figure of the reported quarter. Deduplicated by label; the first (usually
 * headline) sentence wins. Forward-looking sentences are skipped: a refund
 * expected next quarter is guidance, not this print.
 */
export function oneOffsFromReleaseText(text: string): OneOff[] {
  if (!text || text.length < 200) return [];
  const out: OneOff[] = [];
  const seen = new Set<string>();

  for (const s of splitSentences(text)) {
    if (!DISCRETE.test(s) || !EARNINGS_WORD.test(s) || FORWARD.test(s) || NOT_THE_QUARTER.test(s)) continue;
    if ((s.match(/\$/g) || []).length > 6) continue;         // a flattened table, not a sentence
    const adjustedBasis = /adjusted|non-?gaap/i.test(s);

    // ── form A: the company's own ex-item per-share figure.
    //    "Adjusted Net Income, excluding the $41 million after tax benefit of
    //     tariff refunds, was $151 million, or $2.37 per share"  (Burlington)
    //    "Excluding the refund benefit, … adjusted earnings per diluted share
    //     would have been $0.31"                                   (Bath & Body Works)
    //    "adjusted diluted earnings per share were $0.52, excluding the net
    //     IEEPA tariff recovery"                                   (Gap)
    const exm = s.match(/\bexcluding\s+(?:the\s+)?(?:\$\s?[\d.,]+\s*(?:million|billion)?\s+)?(?:(?:after|pre)[- ]tax\s+)?(?:net\s+)?(?:benefit|impact|effect|gain|charge)?\s*(?:of\s+|from\s+|related to\s+)?([a-z][a-z0-9 &'\-\/]{2,70}?)(?=[,.;:]|\s+(?:and|which|as well as|was|were|would)\b|$)/i);
    if (exm && adjustedBasis) {
      const label = exm[1].trim().toLowerCase();
      if (/^(?:million|billion|thousand|\d)/.test(label)) continue;   // "excluding $9 million and $12 million" — no item named
      const ex = perShareAfter(s, (exm.index ?? 0) + exm[0].length) ?? perShareAfter(s, 0);
      if (ex != null && !seen.has(label)) {
        seen.add(label);
        out.push({ label, per_share: null, kind: 'unknown', included: true, adjusted_basis: true,
          ex_eps_stated: ex, ex_eps_prev_stated: priorPerShareAfter(s, ex), quote: s });
      }
      continue;
    }

    // ── form B: a signed per-share amount tied to the item.
    //    "Adjusted EPS of $2.96 includes an approximate $0.60 benefit related
    //     to tariff refunds" / "$1.75 per diluted share impact" (Abercrombie)
    // The comparison tail ("compared with $390 million, or $1.37 per share")
    // is the prior year, and its figures must not be mistaken for the item —
    // UNLESS the tail is where the item is disclosed. Target writes the whole
    // thing as one sentence: "Second quarter GAAP and Adjusted EPS was $4.11,
    // compared with prior-year … of $2.05, an increase of 100 percent, which
    // included tariff refund benefits of $1.65 for Q2 2026." Trimming at
    // "compared with" threw away the $1.65 and left a 76% "beat" against an
    // adjusted consensus. So the tail is kept whenever it carries both a
    // discrete item and a sign word; otherwise it is dropped as before.
    const parts = s.split(/\b(?:compared (?:with|to)|vs\.?|versus)\b/i);
    const tail = parts.slice(1).join(' ');
    const tailCarriesItem = !!tail && DISCRETE.test(tail)
      && (new RegExp(BENEFIT.source, 'i').test(tail) || new RegExp(CHARGE.source, 'i').test(tail));
    const body = tailCarriesItem ? s : parts[0];
    let amts = perShareAmounts(body);
    // The headline figure is the one that "includes" the item — an amount
    // immediately followed by the includes-verb is the total, never the item.
    amts = amts.filter((a) => !/^\s*(?:per\s+(?:diluted\s+)?(?:common\s+)?share\s*)?,?\s*\(?\s*(?:which\s+)?(?:includ|inclusive|reflect)/i.test(s.slice(a.index + a.length, a.index + a.length + 44)));
    // An amount that says "per share" outranks one that is per-share only by
    // the sentence's subject.
    const explicit = amts.filter((a) => /^\s*(?:per\s|\/\s?(?:diluted\s+)?share)/i.test(s.slice(a.index + a.length, a.index + a.length + 12)));
    if (explicit.length) amts = explicit;
    if (!amts.length) continue;
    // A SENTENCE THAT NAMES BOTH BASES GIVES TWO AMOUNTS, AND ONLY ONE OF THEM
    // BELONGS TO THE FIGURE BEING ADJUSTED. Salesforce's footnote reads "gains
    // on strategic investments impacted GAAP diluted net income per share by
    // $2.43 … and non-GAAP diluted net income per share by $X": the first
    // amount is the GAAP effect, and subtracting it from the non-GAAP figure
    // would be the wrong arithmetic on the right idea. When the sentence names
    // the non-GAAP figure, only amounts AFTER that mention are candidates.
    const ngIdx = body.search(/\bnon[\s‐-]?gaap\b/i);
    if (ngIdx >= 0) {
      const after = amts.filter((a) => a.index > ngIdx);
      if (after.length) amts = after;
    }
    let best: { a: Amt; kind: OneOff['kind']; d: number } | null = null;
    for (const a of amts) {
      const at = a.index + a.length / 2;
      const db = nearestDistance(s, BENEFIT, at);
      const dc = nearestDistance(s, CHARGE, at);
      const d = Math.min(db, dc);
      // How far a sign word may sit from the amount. A footnote names the item
      // once and its per-share effects later — Salesforce's "gains on strategic
      // investments impacted GAAP … by $2.43 … and non-GAAP … by $2.53" puts
      // 170 characters between "gains" and the number that matters, and a
      // 90-character window silently dropped a $2.53 item out of a $5.90
      // figure. The other guards (per-share, tied by an includes/impact verb,
      // on the adjusted basis, smaller than the figure itself) do the real
      // work; this one only has to keep an unrelated amount from being picked.
      if (d > 220) continue;
      const kind: OneOff['kind'] = db < dc ? 'benefit' : dc < db ? 'charge' : 'unknown';
      if (!best || d < best.d) best = { a, kind, d };
    }
    if (!best) continue;
    // The headline EPS itself sits next to "EPS was" — never treat the largest
    // per-share figure in the sentence as the item when a smaller one exists.
    const perShare = best.a.value;
    const kind = best.kind;
    const idx = best.a.index;
    const label = labelFrom(s, idx);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      per_share: kind === 'benefit' ? perShare : kind === 'charge' ? -perShare : null,
      kind,
      included: INCLUDES.test(s) || /\bimpact(?:ed|s|ing)?\b/i.test(s),
      adjusted_basis: adjustedBasis,
      ex_eps_stated: null,
      ex_eps_prev_stated: null,
      quote: s,
    });
  }
  return out;
}

export function oneOffsFromReleaseHtml(html: string): OneOff[] {
  if (!html || typeof html !== 'string') return [];
  try { return oneOffsFromReleaseText(htmlToText(html)); } catch { return []; }
}

// ── THE ITEM QUANTIFIED IN DOLLARS AND NEVER PER SHARE ─────────────────────
//
// Kohl's Q2 FY26: GAAP diluted EPS $1.28, adjusted diluted EPS $1.28 — the two
// are the same figure because the company adjusted for nothing — against a
// $0.57 street number, which the card read as a 124% beat. Buried a paragraph
// below: "Tariff refunds of approximately $150 million were received in the
// quarter of which approximately $100 million flowed through gross margin."
//
// Everything above this line needs a PER-SHARE amount, and this release never
// prints one, so the whole Burlington machinery found nothing and the beat was
// reported clean. It was not clean: on $151 million of net income, a $150
// million refund is essentially the entire quarter's profit.
//
// The honest thing to do with an item like this is NOT to turn it into an EPS
// figure. Dividing by share count and assuming a tax rate manufactures a
// number the filing does not contain, which is the one thing this engine never
// does. What it can do is state the size of the item against a figure from the
// same filing — net income — and refuse to call the beat clean. So this
// returns the item, its dollar amount and its sentence, and the caller decides
// what a benefit worth most of the quarter's profit does to the grade.
export interface AbsoluteOneOff {
  label: string;
  /** Absolute dollars, signed: + is a benefit to earnings. */
  amount_usd: number;
  kind: 'benefit' | 'charge';
  quote: string;
}

/** "$150 million", "$1.2 billion", "$17.4 thousand" → absolute dollars. */
function absAmounts(s: string): Array<{ value: number; index: number }> {
  const out: Array<{ value: number; index: number }> = [];
  const re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const mult = /thousand/i.test(m[2]) ? 1e3 : /million/i.test(m[2]) ? 1e6 : 1e9;
    out.push({ value: n * mult, index: m.index });
  }
  return out;
}

/**
 * Discrete items the release quantifies in DOLLARS, tied to the reported
 * quarter, with no per-share figure anywhere in the sentence. Per-share
 * disclosures are handled above and are deliberately excluded here so the same
 * item is never counted twice.
 */
export function absoluteOneOffsFromReleaseText(text: string, periodEndISO?: string | null): AbsoluteOneOff[] {
  if (!text || text.length < 200) return [];
  const out: AbsoluteOneOff[] = [];
  const seen = new Set<string>();
  // A RELEASE TALKS ABOUT OLD QUARTERS TOO. Dollar Tree's Q2 FY26 release
  // explains a gain "in the fourth quarter of fiscal 2024" — a real one-off,
  // in a quarter reported two years ago, and "fourth quarter" satisfied the
  // period anchor below. A fiscal label two years or more behind the period
  // being reported is never this quarter; one year behind can be, because a
  // retailer's fiscal 2025 ends in January 2026.
  const periodYear = periodEndISO && /^\d{4}/.test(periodEndISO) ? Number(periodEndISO.slice(0, 4)) : null;
  for (const s of splitSentences(text)) {
    if (!DISCRETE.test(s)) continue;
    if (FORWARD.test(s)) continue;                 // guidance, not this print
    if (NOT_THE_QUARTER.test(s)) continue;         // the half-year column
    if (PER_SHARE_SUBJECT.test(s)) continue;       // handled per-share, above
    // It has to be THIS quarter. "received in the quarter", "during the second
    // quarter", "in the quarter ended". Without a period anchor the sentence
    // could be describing any period the release mentions.
    if (!/\b(?:in|during|within|for)\s+the\s+(?:current\s+|second\s+|third\s+|fourth\s+|first\s+)?quarter\b|\bin\s+the\s+quarter\b|\bquarter\s+ended\b/i.test(s)) continue;
    if (periodYear != null) {
      const yr = s.match(/\b(?:fiscal|FY)\s*(\d{4})\b/i) || s.match(/\bquarter\s+of\s+(\d{4})\b/i);
      if (yr && Number(yr[1]) <= periodYear - 2) continue;
    }
    const amts = absAmounts(s);
    if (!amts.length) continue;
    // The largest amount in the sentence is the item; a smaller one beside it
    // is usually the portion that landed in one line ("of which ~$100 million
    // flowed through gross margin"), and the item is the whole.
    const a = amts.reduce((x, y) => (Math.abs(y.value) > Math.abs(x.value) ? y : x));
    // THE ITEM'S OWN WORD DECIDES THE SIGN, NOT THE NEAREST ADJECTIVE.
    //
    // Williams-Sonoma: "a REDUCTION of COST of goods sold of $167.8 million
    // related to refunds received for tariffs". The nearest sign word to the
    // amount is "cost", so a proximity test called a $168 million benefit a
    // charge. A refund received is money coming back whatever noun it lands
    // in, and a reduction of a cost is a benefit by construction — both are
    // stated outright in the sentence, so neither needs to be guessed.
    let kind: 'benefit' | 'charge' | null = null;
    if (/\breduction (?:of|in) (?:cost|costs|expenses?|cost of (?:goods|sales|revenue))/i.test(s)) kind = 'benefit';
    else if (/\bincrease (?:of|in) (?:cost|costs|expenses?)/i.test(s)) kind = 'charge';
    if (kind == null) {
      if (/\b(refunds?|recover(?:y|ies|ed)|drawbacks?|reversals?|releases? of|windfall|tax benefits?)\b/i.test(s)) kind = 'benefit';
      else if (/\b(impairments?|restructuring|severance|write[- ]?(?:offs?|downs?)|litigation)\b/i.test(s)) kind = 'charge';
    }
    if (kind == null) {
      // Only now, and only when the two are not equally far away.
      const benefitD = nearestDistance(s, BENEFIT, a.index);
      const chargeD = nearestDistance(s, CHARGE, a.index);
      kind = benefitD < chargeD ? 'benefit' : chargeD < benefitD ? 'charge' : null;
    }
    if (!kind) continue;                            // an unsigned amount says nothing
    const label = labelFrom(s, a.index);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, amount_usd: kind === 'benefit' ? a.value : -a.value, kind, quote: s });
  }
  return out;
}

export function absoluteOneOffsFromReleaseHtml(html: string, periodEndISO?: string | null): AbsoluteOneOff[] {
  if (!html || typeof html !== 'string') return [];
  try { return absoluteOneOffsFromReleaseText(htmlToText(html), periodEndISO); } catch { return []; }
}

/**
 * The adjusted EPS with the disclosed one-offs taken back out.
 *
 * Uses the company's own ex-item figure when it stated one; otherwise
 * subtracts the signed per-share amounts — but ONLY the items the adjusted
 * figure still carries. A benefit disclosed in a GAAP sentence that the
 * adjusted figure already removed (Dollar Tree: GAAP $2.70, adjusted $1.39,
 * refund $1.31) must not be removed twice; the test is whether GAAP and
 * adjusted already differ by most of the item. Returns null when nothing
 * applies — an unsigned "impact" is surfaced as a caveat but never
 * arithmetically applied.
 */
export function epsExOneOffs(adjEps: number | null, items: OneOff[], gaapEps?: number | null): { eps: number; total: number; prev?: number | null } | null {
  if (adjEps == null || !Number.isFinite(adjEps) || !items.length) return null;
  // THE ITEM MUST BELONG TO THE FIGURE BEING ADJUSTED.
  //
  // Workday's release says "Included within DILUTED NET INCOME PER SHARE for the
  // current quarter is a tax benefit of $1.52 per share related to an
  // intra-entity transfer of intellectual property" — a statement about its
  // GAAP line. Subtracting it from the $2.75 non-GAAP figure turned a +5% beat
  // into a −53% miss. A sentence that does not speak of the adjusted figure
  // says nothing about the adjusted figure, whatever the two happen to be.
  // A statement about the GAAP figure IS a statement about the adjusted figure
  // when the two are the same number — Abercrombie and Target both headline
  // "GAAP and Adjusted EPS" at one value, and their refund disclosures never
  // use the word "adjusted" at all.
  const sameFigure = gaapEps != null && Number.isFinite(gaapEps) && Math.abs(gaapEps - adjEps) <= 0.011;
  const mine = items.filter((o) => o.adjusted_basis || sameFigure);
  const stated = mine.find((o) => o.ex_eps_stated != null);
  if (stated) {
    const total = Math.round((adjEps - stated.ex_eps_stated!) * 100) / 100;
    // THE EX-ITEM FIGURE MUST MOVE IN THE DIRECTION THE SENTENCE DESCRIBES.
    //
    // Build-A-Bear: "Excluding the $7 million impact from the tariff refund …
    // adjusted EPS totaled $1.73" — against a quarter that reported $0.70,
    // because the $1.73 is the twenty-six-week column. Removing a BENEFIT
    // cannot raise the figure; when it does, the two numbers are not the same
    // period and nothing is computed from them.
    // AN ITEM CANNOT BE LARGER THAN THE FIGURE IT SITS INSIDE. Build-A-Bear's
    // $1.73 "excluding the tariff refund" is the twenty-six-week number against
    // a quarter that reported $0.70: the implied item ($1.03) exceeds the whole
    // quarter, which no disclosed item inside it can. Two periods, not one.
    if (Math.abs(total) > Math.abs(adjEps)) return null;
    // And removing a BENEFIT cannot raise the figure.
    const removingBenefit = /\bexclud\w*\s+(?:the\s+)?(?:\$?[\d.,]+\s*(?:million|billion)?\s*)?(?:net\s+)?[a-z ]{0,24}(refund|recover|gain|benefit|credit|windfall|reversal)/i.test(stated.quote);
    if (removingBenefit && total < 0) return null;
    return Math.abs(total) >= 0.01
      ? { eps: stated.ex_eps_stated!, total, prev: stated.ex_eps_prev_stated }
      : null;
  }
  const signed = mine.filter((o) => o.included && o.per_share != null && (o.per_share as number) > 0);
  if (!signed.length) return null;
  const total = signed.reduce((n, o) => n + (o.per_share as number), 0);
  if (Math.abs(total) < 0.01) return null;
  return { eps: Math.round((adjEps - total) * 100) / 100, total: Math.round(total * 100) / 100 };
}
