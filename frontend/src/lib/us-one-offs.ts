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
  /** The sentence, trimmed, so the card can quote the company rather than us. */
  quote: string;
}

/** Vocabulary that marks an item as discrete rather than operating. This is a
 *  CLASS list — nothing in it names a company or a quarter. */
const DISCRETE = /\b(one[- ]time|non[- ]?recurring|discrete|unusual|refunds?|recover(?:y|ies|ed)|drawbacks?|settlements?|gain on (?:the )?sale|insurance|reversals?|releases? of|true[- ]ups?|catch[- ]up|out[- ]of[- ]period|prior[- ]period|retroactive|cumulative|tax benefits?|valuation allowance|litigation|legal|impairments?|restructuring|severance|write[- ]?(?:offs?|downs?)|credits?|windfall)\b/i;

const EARNINGS_WORD = /\b(EPS|earnings per share|net income|net earnings|diluted earnings|adjusted earnings|income per share|earnings)\b/i;
const INCLUDES = /\b(includ(?:es|ed|ing)|inclusive of|reflect(?:s|ed|ing)|benefit(?:ed|ted|s)? from|driven by|boosted by|helped by|aided by)\b/i;
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
  if (m) return m[1].trim().replace(/\s*\d+$/, '').toLowerCase();   // "tariff refunds 1" — a footnote mark
  const d = sentence.match(DISCRETE);
  return d ? d[1].toLowerCase() : 'discrete item';
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
        out.push({ label, per_share: null, kind: 'unknown', included: true, adjusted_basis: true, ex_eps_stated: ex, quote: s });
      }
      continue;
    }

    // ── form B: a signed per-share amount tied to the item.
    //    "Adjusted EPS of $2.96 includes an approximate $0.60 benefit related
    //     to tariff refunds" / "$1.75 per diluted share impact" (Abercrombie)
    // The comparison tail ("compared with $390 million, or $1.37 per share")
    // is the prior year; the item is never in it.
    const body = s.split(/\b(?:compared (?:with|to)|vs\.?|versus)\b/i)[0];
    let amts = perShareAmounts(body);
    // The headline figure is the one that "includes" the item — an amount
    // immediately followed by the includes-verb is the total, never the item.
    amts = amts.filter((a) => !/^\s*(?:per\s+(?:diluted\s+)?(?:common\s+)?share\s*)?,?\s*\(?\s*(?:which\s+)?(?:includ|inclusive|reflect)/i.test(s.slice(a.index + a.length, a.index + a.length + 44)));
    // An amount that says "per share" outranks one that is per-share only by
    // the sentence's subject.
    const explicit = amts.filter((a) => /^\s*(?:per\s|\/\s?(?:diluted\s+)?share)/i.test(s.slice(a.index + a.length, a.index + a.length + 12)));
    if (explicit.length) amts = explicit;
    if (!amts.length) continue;
    let best: { a: Amt; kind: OneOff['kind']; d: number } | null = null;
    for (const a of amts) {
      const at = a.index + a.length / 2;
      const db = nearestDistance(s, BENEFIT, at);
      const dc = nearestDistance(s, CHARGE, at);
      const d = Math.min(db, dc);
      if (d > 90) continue;                                // no sign word near it
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
      included: INCLUDES.test(s) || /\bimpact\b/i.test(s),
      adjusted_basis: adjustedBasis,
      ex_eps_stated: null,
      quote: s,
    });
  }
  return out;
}

export function oneOffsFromReleaseHtml(html: string): OneOff[] {
  if (!html || typeof html !== 'string') return [];
  try { return oneOffsFromReleaseText(htmlToText(html)); } catch { return []; }
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
export function epsExOneOffs(adjEps: number | null, items: OneOff[], gaapEps?: number | null): { eps: number; total: number } | null {
  if (adjEps == null || !Number.isFinite(adjEps) || !items.length) return null;
  const stated = items.find((o) => o.ex_eps_stated != null);
  if (stated) {
    const total = Math.round((adjEps - stated.ex_eps_stated!) * 100) / 100;
    return Math.abs(total) >= 0.01 ? { eps: stated.ex_eps_stated!, total } : null;
  }
  const gap = (gaapEps != null && Number.isFinite(gaapEps)) ? Math.abs(gaapEps - adjEps) : null;
  const signed = items.filter((o) => o.included && o.per_share != null && (o.per_share as number) > 0
    && (o.adjusted_basis || gap == null || gap < Math.abs(o.per_share as number) * 0.5));
  if (!signed.length) return null;
  const total = signed.reduce((n, o) => n + (o.per_share as number), 0);
  if (Math.abs(total) < 0.01) return null;
  return { eps: Math.round((adjEps - total) * 100) / 100, total: Math.round(total * 100) / 100 };
}
