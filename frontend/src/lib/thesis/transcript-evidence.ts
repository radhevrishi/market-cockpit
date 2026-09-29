// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIPT EVIDENCE — WHAT A CONCALL SENTENCE ACTUALLY SAYS.      (zzz809)
//
// IOLCP's 11 Sep 2026 business-update call printed eight wrong lines on the
// Portfolio Catalysts card. Each came from reading a transcript sentence as
// the wrong kind of statement:
//
//   "our current capacity is exhausted up to the level of 90% to 95%"
//       — the CURRENT utilisation, read as a guidance "target only";
//   "expanding our Ibuprofen capacity by 6,000 MTPA, taking our total
//    capacity to 18,000 MTPA"
//       — a post-expansion TOTAL (a plan), read as installed capacity; the
//         installed figure (18,000 − 6,000) was never derived;
//   "approximately INR495 crores of investment is being deployed"
//       — the PLAN, printed as "Spent: ₹495 crores"; the stated share spent
//         ("around 30% … has already been incurred") was never read;
//   a plant "established … EU GMP certification … commercialization expected
//    during Q3 FY27"
//       — built and certified, commercial sales later: printed as a status
//         conflict;
//   "operating at 90%-95% utilisation (implying capacity constraint)"
//       — a full plant with capacity being added, printed ✕ "moved the wrong
//         way", although nothing says the constraint is costing sales;
//   price, margin and forward statements made in words — never captured.
//
// Every helper here is PURE and generic: it reads the sentence's own words,
// never a ticker, never a number it cannot point to. A derived figure says it
// is derived; a qualitative statement is shown as management commentary and
// never as a filed figure.
// ═══════════════════════════════════════════════════════════════════════════

import type { StructuralEvent } from './evidence-extract';

// ── 1. UTILISATION: CURRENT OR TARGET? ────────────────────────────────────

/** Words that pin a utilisation to NOW. */
const CURRENT_UT = /\b(current(?:ly)?|at present|presently|as (?:on|of) (?:date|today|now)|today|right now|existing (?:facilit\w*|plants?|capacit\w*|lines?|units?|assets?)|(?:is|are|were|was) (?:operating|running|working) at|operating at|running at|working at|exhausted|utili[sz]ed (?:up )?to|at the level of|stands? at|stood at|(?:in|during|for) the (?:quarter|year|period)|this quarter|last quarter)\b/i;
/** Words that make it a TARGET / expectation. "Peak" is deliberately absent:
 *  "running at peak utilisation" is a current statement. */
const TARGET_UT = /\b(target(?:s|ed|ing)?|expect(?:s|ed|ing|ation)?|will|would|shall|going to|plan(?:s|ned|ning)?|aim(?:s|ed|ing)?|(?:to|can|could|will|would|should|may|might) (?:reach|achieve|touch|go up to|hit)|reaching|achieving|optimal|optimum|guid(?:ance|ed|ing)|ramp\w* (?:up )?to|by (?:FY|Q[1-4]|20\d\d|the end)|next (?:year|fiscal|quarter)|in FY\s?'?\d{2}|over the (?:next|coming)|going forward|should|in the first year|once (?:commissioned|operational|fully))\b/i;

/**
 * Pure: is this utilisation sentence about the current level, a target, or
 * neither? A sentence with both kinds of words is a TARGET — the safe side:
 * a target must never be shown as this quarter's figure.
 */
export function utilisationTense(text: string | null | undefined): 'CURRENT' | 'TARGET' | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  if (TARGET_UT.test(t)) return 'TARGET';
  if (CURRENT_UT.test(t)) return 'CURRENT';
  return null;
}

/** Pure: the lower bound of a stated utilisation ("90% to 95%" → 90). */
export function utilisationLow(value: string | null | undefined): number | null {
  const v = String(value ?? '');
  if (!/%|per ?cent/i.test(v)) return null;
  const m = v.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ── 2. CAPACITY: WHICH PRODUCT, AND THE DERIVED INSTALLED FIGURE ─────────

const PRODUCT_STOP = /^(?:our|the|its|their|this|that|these|those|a|an|and|of|to|by|in|at|on|for|from|with|we|us|have|has|had|are|is|was|were|be|been|being|also|further|now|then|total|overall|combined|aggregate|installed|existing|current|annual|nameplate|production|manufacturing|plant|plants|new|additional|incremental|capacity|capacities|expanded|expanding|expand|increased|increasing|increase|enhanced|enhancing|enhance|augmented|added|adding|add|raised|raising|taking|take|bringing|bring|successfully|during|year|quarter|which|will|would|all|entire|crores?|crs?|cr|lakhs?|lacs?|millions?|billions?|mn|bn|rs|inr|usd|locations?|riders?|mtpa|tpa|ktpa|mt|kl|kld|klpd|tonnes?|tons?|mw|gw|mwh|units?|unit-?\d*|nos|lines?|first|second|third|further|approx\w*|about|around|nearly|over|up)$/i;

/** Words that sit between a product and "capacity" and name no product. */
const CAP_MODIFIER = /^(?:installed|total|overall|production|manufacturing|annual|existing|current|nameplate|combined|aggregate|our|the|its|their|effective|operational|operating|rated|licensed|design|peak)$/i;
/** Capitalised words that are never a product: sentence openers, titles. */
const NOT_A_NAME = /^(?:the|our|we|its|this|that|management|company|group|board|plant|unit|phase|sir|madam|so|and|but|also|further|first|second|third|during|in|at|as|with|new|india|indian)$/i;

/** Pure: the product a capacity figure belongs to, from the words in front of
 *  "capacity" nearest the figure — "Ethyl Acetate capacity increased to
 *  1,20,000 MTPA" → "Ethyl Acetate"; "expanding our Ibuprofen capacity by
 *  6,000 MTPA, taking our total capacity to 18,000 MTPA" → "Ibuprofen" for
 *  both figures (the "total" in the same sentence is that product's total).
 *  Null when no product is named. */
export function productOfCapacity(text: string | null | undefined, value: string | null | undefined): string | null {
  const t = String(text ?? '');
  const num = (/\d[\d,]*(?:\.\d+)?/.exec(String(value ?? '')) || [''])[0];
  if (!t || !num) return null;
  // The sentence holding the figure.
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
  const bare = num.replace(/,/g, '');
  const s = sentences.find((x) => x.replace(/,/g, '').includes(bare)) || t;
  const at = (() => {
    const flat = s.replace(/,/g, '');
    const i = flat.indexOf(bare);
    if (i < 0) return s.length;
    // Map the comma-free index back onto the sentence.
    let k = 0, j = 0;
    while (j < s.length && k < i) { if (s[j] !== ',') k++; j++; }
    return j;
  })();
  const before = s.slice(0, at);
  const hits = Array.from(before.matchAll(/((?:[A-Za-z][\w-]*\s+){1,5})capacit(?:y|ies)\b/gi));
  for (let h = hits.length - 1; h >= 0; h--) {
    const words = hits[h][1].trim().split(/\s+/);
    // Modifiers between the product and "capacity" ("our Ibuprofen installed
    // capacity") are skipped; the product is the run of words right before
    // them. A lower-case word counts only when it touches "capacity"
    // ("cement capacity"); otherwise product words are Capitalised names.
    let w = words.length - 1;
    let skipped = false;
    while (w >= 0 && CAP_MODIFIER.test(words[w])) { w--; skipped = true; }
    const keep: string[] = [];
    for (; w >= 0 && keep.length < 3; w--) {
      const x = words[w];
      if (PRODUCT_STOP.test(x) || NOT_A_NAME.test(x) || /\d/.test(x)) break;
      const capital = /^[A-Z]/.test(x);
      if (!capital && (skipped || keep.length)) break;
      keep.unshift(x);
      if (!capital) break;
    }
    const name = keep.join(' ').trim();
    if (name && /[A-Za-z]{3,}/.test(name)) return name;
  }
  // "Commissioned new Paracetamol Unit-11 with installed capacity of …"
  const unit = /\b([A-Z][A-Za-z-]{2,}(?:\s+[A-Z][A-Za-z-]{2,})?)\s+(?:Unit|Plant|Block|Line|Facility|Complex)\b/.exec(before);
  if (unit && !PRODUCT_STOP.test(unit[1].split(/\s+/)[0])) return unit[1];
  return null;
}

/** Pure: a comparable key for a product name ("Ethyl  Acetate" → "ethyl acetate"). */
export const productKey = (p: string | null | undefined): string | null =>
  p ? p.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null : null;

const NUM = String.raw`(?:about\s+|around\s+|approximately\s+|approx\.?\s+|~\s*)?([\d,]+(?:\.\d+)?)\s*([A-Za-z]{1,8})\b`;
const DERIVE_RE = new RegExp(
  String.raw`\b(?:expand\w*|increas\w*|add\w*|enhanc\w*|augment\w*|rais\w*|scal\w* up)\s+(?:(?:our|the|its|their)\s+)?((?:[A-Za-z][\w-]*\s+){0,3})capacit(?:y|ies)\s+by\s+${NUM}[^.;]{0,90}?\b(?:taking|to take|takes|bringing|to bring|brings|which (?:will )?(?:take|bring)s?|thereby taking|to reach|reaching)\s+(?:(?:our|the|its|their)\s+)?(?:total|overall|aggregate|combined|installed|cumulative)?\s*(?:installed\s+)?capacit(?:y|ies)\s+to\s+${NUM}`,
  'i');

export interface DerivedCapacity {
  product: string | null;
  addition: string;
  total: string;
  /** total − addition, formatted like the source and marked derived. */
  current: string;
  unit: string;
  /** Plain words: "derived: total 18,000 MTPA − addition 6,000 MTPA, both in one sentence". */
  basis: string;
}

const fmtLike = (n: number, like: string): string => {
  // Indian grouping ("1,20,000") when the source uses it.
  const indian = /\d,\d{2},\d{3}/.test(like);
  return n.toLocaleString(indian ? 'en-IN' : 'en-US', { maximumFractionDigits: 2 });
};

/**
 * Pure: "expanding X capacity by A, taking total capacity to T" → the
 * installed capacity today is T − A. Only when BOTH figures sit in the same
 * sentence, carry the same unit, and T > A. Never across sentences, never
 * across units. The result says it is derived.
 */
export function deriveCurrentCapacity(text: string | null | undefined): DerivedCapacity | null {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  for (const s of t.split(/(?<=[.!?])\s+(?=[A-Z"'(])/)) {
    const m = DERIVE_RE.exec(s);
    if (!m) continue;
    const add = Number(m[2].replace(/,/g, '')), tot = Number(m[4].replace(/,/g, ''));
    const ua = m[3].toUpperCase(), ut = m[5].toUpperCase();
    if (!Number.isFinite(add) || !Number.isFinite(tot) || ua !== ut || !(tot > add) || add <= 0) continue;
    const product = productOfCapacity(s, m[2]);
    const cur = fmtLike(tot - add, m[4]);
    return {
      product,
      addition: `${m[2]} ${m[3]}`, total: `${m[4]} ${m[5]}`,
      current: `${cur} ${m[5]}`, unit: m[5],
      basis: `derived: total after expansion ${m[4]} ${m[5]} − ${m[2]} ${m[3]} being added, both stated in one sentence`,
    };
  }
  return null;
}

/** Pure: "taking our total capacity to 18,000 MTPA" while "expanding … by" —
 *  the figure is the capacity AFTER a plan, not capacity installed today. */
export function isPostExpansionTotal(text: string | null | undefined, value: string | null | undefined): boolean {
  const d = deriveCurrentCapacity(text);
  if (!d) return false;
  const v = (/\d[\d,]*(?:\.\d+)?/.exec(String(value ?? '')) || [''])[0].replace(/,/g, '');
  return !!v && d.total.replace(/,/g, '').startsWith(v)
    // A completed expansion ("has taken", "now stands") is installed capacity.
    && !/\b(has|have|had) (?:taken|brought|increased|expanded)|\bnow stands?\b|\bcompleted\b/i.test(String(text ?? ''));
}

/** Pure: two figures that differ by an exact power of ten (10×, 100×, 1000×,
 *  within 2%) — the signature of a unit or zero error in one of them. */
export function powerOfTenApart(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null || !(a > 0) || !(b > 0)) return false;
  const r = Math.max(a, b) / Math.min(a, b);
  const k = Math.round(Math.log10(r));
  return k >= 1 && k <= 3 && Math.abs(r / 10 ** k - 1) < 0.02;
}

// ── 3. CAPEX: PLANNED OR SPENT, AND THE STATED SHARE SPENT ───────────────

const PLANNED_CAPEX = /\b(propos\w*|planned|planning|plans? to|to be (?:incurred|spent|invested|deployed)|will (?:be )?(?:invest\w*|spend\w*|deploy\w*|incur\w*)|(?:is|are) being (?:deployed|invested|spent|incurred)|involving|outlay|budget\w*|earmark\w*|envisag\w*|announced|approved|sanction\w*|over the (?:next|coming)|across the (?:\w+ )?(?:initiatives|projects|programmes?))\b/i;
const SPENT_CAPEX = /\b(spent|incurred|capitali[sz]ed|already (?:invested|spent|deployed|incurred|been)|(?:has|have|had) been (?:spent|incurred|invested|deployed)|invested (?:so far|till|to date|until))\b/i;

/** Pure: does the sentence give the amount as a PLAN (programme size) or as
 *  money SPENT? "is being deployed", "proposed investment of", "across the
 *  three initiatives" are a plan; "has been incurred", "spent so far" are
 *  spend. Null when it says neither. */
export function capexAmountKind(text: string | null | undefined): 'PLANNED' | 'SPENT' | null {
  const t = String(text ?? '');
  if (SPENT_CAPEX.test(t) && !/(?:is|are) being (?:deployed|invested|spent)/i.test(t)) return 'SPENT';
  // "The total capex for Q1 was INR943 million" is money that went out.
  if (/\b(was|were|during the (?:quarter|year|period)|(?:in|for) (?:Q[1-4]|the quarter|FY\s?'?\d{2}))\b/i.test(t) && !/(?:is|are) being|propos|planned|to be /i.test(t)) return null;
  if (PLANNED_CAPEX.test(t)) return 'PLANNED';
  return null;
}

/**
 * Pure: "Around 30% of overall funding requirements has already been
 * incurred" / "30% of capex is already been done" → the stated share of the
 * plan that is spent. Never converted into a rupee figure.
 */
export function incurredShare(text: string | null | undefined): { pct: number; quote: string } | null {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  const re = /(?:(?:around|about|approximately|nearly|over|almost|roughly|~)\s+)?(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?[\w\s-]{0,50}?)?\s*(?:has|have|is|are)?\s*(?:already\s+)?(?:been\s+)?(?:already\s+)?(?:incurred|spent|done|deployed|invested|utili[sz]ed|completed)\b/gi;
  for (const m of t.matchAll(re)) {
    const pct = Number(m[1]);
    if (!(pct > 0 && pct <= 100)) continue;
    // "30% of revenue … spent on R&D" is not a share of the capex plan.
    const around = t.slice(Math.max(0, m.index! - 60), m.index! + m[0].length + 20);
    if (/\b(revenue|sales|turnover|profit|ebitda|margin)\b/i.test(m[0])) continue;
    if (!/capex|capital|invest|fund|project|programme|program|initiative|incurred|spent|deployed/i.test(around)) continue;
    return { pct, quote: m[0].trim() };
  }
  return null;
}

// ── 4. PROJECTS: BUILT, THEN COMMERCIAL LATER, IS NOT A CONFLICT ─────────

/** Pure: a plant reported built / commissioned / certified whose stated
 *  "completion" is really its COMMERCIAL start ("commercialization expected
 *  Q3 FY27"). Returns that commercial-start phrase, or null. */
export function commercialStartOf(status: string | null | undefined, completion: string | null | undefined): string | null {
  const st = String(status ?? '').toLowerCase().replace(/_/g, ' ');
  const c = String(completion ?? '');
  if (!/commission|established|built|completed|certified|ready/.test(st)) return null;
  const m = /commerciali[sz]ation|commercial (?:production|operations|supplies|sales|start)|commercial(?:ly)? launch/i.exec(c);
  if (!m) return null;
  const when = /\b(Q[1-4]\s?FY\s?'?\d{2}|H[12]\s?FY\s?'?\d{2}|FY\s?'?\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}|\d{1,2}\s*(?:-|to)\s*\d{1,2}\s+months)\b/i.exec(c);
  return when ? when[1] : c.replace(/^.*?(commerciali[sz]ation|commercial\s+\w+)\s*(?:is\s+)?(?:expected\s+)?(?:during|in|by|from)?\s*/i, '').trim() || c.trim();
}

// ── 5. A BOTTLENECK IS ✕ ONLY WHEN IT IS COSTING SALES ───────────────────

const HURTS_SALES = /\b(lost|losing|forgo(?:ne|ing)?|missed|turn(?:ed|ing) away|unable to (?:meet|serve|supply|cater|fulfil+|execute)|could not (?:meet|serve|supply|cater|fulfil+)|cannot (?:meet|serve|supply|cater|fulfil+)|can ?not (?:meet|serve)|constrain\w* (?:our )?(?:sales|volumes?|revenue|growth|dispatch\w*|supplies)|limit\w* (?:our )?(?:sales|volumes?|revenue|dispatch\w*|growth)|capp\w* (?:our )?(?:sales|volumes?|growth)|hurt\w* (?:our )?(?:sales|volumes?|revenue)|impact\w* (?:on )?(?:our )?(?:sales|volumes?|revenue|dispatch\w*)|(?:sales|volumes?|revenue|dispatch\w*) (?:were|was|are|is|have been|has been) (?:constrained|limited|impacted|hit|capped|restricted)|shortfall in (?:sales|supplies|volumes?)|demand (?:exceed\w*|outstrip\w*) (?:our )?(?:supply|capacity) (?:and|so|,)[^.]{0,40}(?:lost|unmet|could not))\b/i;

/** Pure: does the text say the constraint is costing sales or volumes? A
 *  full plant with capacity being added is the case FOR the capex, not a
 *  deterioration. */
export function bottleneckHurtsSales(text: string | null | undefined): boolean {
  return HURTS_SALES.test(String(text ?? ''));
}

// ── 6. QUALITATIVE COMMENTARY AND FORWARD GUIDANCE FROM A TRANSCRIPT ─────

interface Sent { text: string; speaker: string | null; analyst: boolean }

/** Speaker turns ("Abhay Raj Singh:  …", "Disha:  …") → sentences, each with
 *  who said it. Analysts are the names the moderator introduces ("the line
 *  of Disha with Sapphire Capital") and the moderator itself; everyone else
 *  who speaks is taken as management. A transcript with no turn markers is
 *  read as one speaker (management). */
function transcriptSentences(text: string): Sent[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const analysts = new Set<string>(['moderator', 'operator']);
  for (const m of t.matchAll(/\b(?:line of|from the line of|question (?:is )?from)\s+((?:[A-Z][A-Za-z.'-]+\s+){0,3}[A-Z][A-Za-z.'-]+)/g)) {
    // The introduced person's FIRST name identifies the turn: a surname is
    // shared too often (an analyst "Suhani Singh", a CFO "Abhay Raj Singh").
    const first = m[1].replace(/^(?:Mr|Mrs|Ms|Dr)\.?\s+/i, '').split(/\s+/)[0];
    if (first && first.length >= 3) analysts.add(first.toLowerCase());
  }
  const TURN = /(?:^|\s)((?:(?:Mr|Mrs|Ms|Dr)\.\s+)?(?:[A-Z][A-Za-z'-]+\s+){0,3}[A-Z][A-Za-z'-]+)\s?:\s/g;
  const marks: Array<{ at: number; end: number; name: string }> = [];
  for (const m of t.matchAll(TURN)) {
    const name = m[1];
    if (/^(?:Note|Subject|Page|Date|Time|Ref|Sub|Encl|Security Symbol|Security Code|Website|Email|Tel|Fax|CIN)$/i.test(name)) continue;
    marks.push({ at: m.index! + (m[0].startsWith(' ') ? 1 : 0), end: m.index! + m[0].length, name });
  }
  const turns: Array<{ speaker: string | null; body: string }> = [];
  if (!marks.length) turns.push({ speaker: null, body: t });
  else {
    if (marks[0].at > 0) turns.push({ speaker: null, body: t.slice(0, marks[0].at) });
    marks.forEach((mk, i) => turns.push({ speaker: mk.name, body: t.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : t.length) }));
  }
  const out: Sent[] = [];
  for (const tr of turns) {
    const who = String(tr.speaker || '');
    const analyst = !!who && analysts.has(who.replace(/^(?:Mr|Mrs|Ms|Dr)\.?\s+/i, '').split(/\s+/)[0].toLowerCase());
    for (const s of tr.body.split(/(?<=[.!?])\s+(?=[A-Z"“0-9₹])/)) {
      const x = s.trim();
      // Short turns are kept: "Yes." is how management confirms a question.
      if (x.length >= 2) out.push({ text: x, speaker: tr.speaker, analyst });
    }
  }
  return out;
}

const AFFIRM = /^(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s?:\s*)?(?:yes|yeah|correct|that'?s correct|that is correct|right|absolutely|definitely|true|exactly|you are right|that'?s right)\b/i;
const QUESTION = /\?\s*$/;

/** A clause of the sentence that carries the matched words, verbatim. */
function clauseAround(s: string, re: RegExp, max = 140): string {
  const parts = s.split(/(?<=[,;])\s+|\s+(?=\bbut\b)|\s+(?=\bwhereas\b)/i);
  const hit = parts.find((p) => re.test(p)) || s;
  const c = hit.replace(/^[\s,;]+|[\s,;.]+$/g, '').replace(/^(?:but|and|so|see|in fact|basically)[,\s]+/i, '').trim();
  return c.length > max ? `${c.slice(0, max - 1)}…` : c;
}

const PRICE_WORD = /\b(?:prices?|pricing|realisations?|realizations?)\b/i;
const PRICE_QUAL = /\b(more or less (?:the )?same|hovering|stable|stabili[sz]ed|steady|softened|soften\w*|not going up\w*|no sharp (?:increase|decrease)|not much change|firm(?:ed|ing)?|declin\w*|fall(?:en|ing)?|fell|increas\w*|higher|lower|pressure|escalation|price adjustment|pass(?:ed)?[- ]?(?:on|through)|pass (?:those|these|the) \w+)\b/i;
const MARGIN_WORD = /\bmargins?\b|\bEBITDA\b|\braw[- ]material (?:price|cost)s?\b[^.]{0,60}\bcontrol/i;
const MARGIN_QUAL = /\b(expansion|expand\w*|improv\w*|better|higher|accretive|backward[- ]integrat\w*|controlled by us|same|maintain\w*|stable|protect\w*|pass(?:ed)?[- ]?(?:on|through))\b/i;
const VOLUME_QUAL = /\b(good|strong|healthy|higher|robust|increasing|growing) volumes?\b|\bvolumes? (?:are|is|will be|to be) (?:good|strong|healthy|higher|growing)\b|\bforecasting (?:some )?(?:good|strong|healthy) volumes?\b/i;

/** Guidance line patterns: each returns the line's words (a label chosen
 *  from a fixed list + the figure text copied from the sentence). */
const GUIDANCE_PATTERNS: Array<{ label: string; re: RegExp; need?: RegExp; skip?: RegExp }> = [
  { label: 'Incremental revenue from the new capacity', re: /\b(?:incremental|additional|add(?:ing)?|contribut\w*)\b[^.?]{0,40}?((?:around\s+|about\s+|approximately\s+)?\d+(?:\.\d+)?\s*%\s*(?:to|-|–)\s*(?:around\s+|about\s+)?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%)[^.?]{0,40}?\b(?:top ?line|revenue|sales|turnover)\b|((?:around\s+|about\s+)?\d+(?:\.\d+)?\s*%\s*(?:to|-|–)\s*(?:around\s+|about\s+)?\d+(?:\.\d+)?\s*%)\s+(?:incremental|contribution|addition)s?\b[^.?]{0,30}?\b(?:top ?line|revenue|sales)\b/i },
  { label: 'Asset turn (revenue ÷ investment)', re: /((?:\d+(?:\.\d+)?\s*x\s*(?:to|-|–)\s*)?\d+(?:\.\d+)?\s*x)\b[^.?]{0,60}?\b(?:of (?:the )?investment|top ?line|asset turn|on an average basis|utili[sz]ation)\b|\basset turns?\b[^.?]{0,40}?((?:\d+(?:\.\d+)?\s*x\s*(?:to|-|–)\s*)?\d+(?:\.\d+)?\s*x)\b/i },
  { label: 'Company ROCE when the projects are implemented', re: /((?:about|around|approximately|more than|over)?\s*\d+(?:\.\d+)?\s*%)\s*(?:ROCE|return on capital)|\b(?:ROCE|return on capital employed)\b[^.?]{0,40}?((?:about|around|approximately)?\s*\d+(?:\.\d+)?\s*%)/i, need: /expect|target|will|when|once|implement|steady[- ]state/i },
  { label: 'Revenue growth guidance', re: /\bguidance\b[^.?]{0,120}?(\d+(?:\.\d+)?\s*%\s*(?:to|-|–)\s*\d+(?:\.\d+)?\s*%)|(\d+(?:\.\d+)?\s*%\s*(?:to|-|–)\s*\d+(?:\.\d+)?\s*%)\s*(?:revenue |top ?line |sales )?growth (?:guidance|target)/i },
  { label: 'Utilisation target', re: /((?:around\s+|about\s+|more than\s+|over\s+)?\d+(?:\.\d+)?\s*%)\s*utili[sz]ation\b[^.?]{0,30}\b(?:we can reach|can reach|expected|target\w*|by FY|in FY)|\b(?:optimal|optimum|peak) (?:utili[sz]ation )?(?:is|will be|of)\s+((?:more than\s+|over\s+|around\s+)?\d+(?:\.\d+)?\s*%)|\bin FY\s?'?\d{2}\b[^.?]{0,40}?((?:around\s+|about\s+)?\d+(?:\.\d+)?\s*%)\s*utili[sz]ation/i },
];

type CommentaryEvent = StructuralEvent & { qualitative?: boolean; guidance_line?: boolean };

const evt = (variable: StructuralEvent['variable'], value_type: StructuralEvent['value_type'], after: string, sentence: string, source: string,
  extra: Partial<CommentaryEvent> = {}): CommentaryEvent => ({
  variable, value_type, before: null, after, unit: null, period: null, direction: 'unknown',
  evidence_text: sentence.slice(0, 600), source, confidence: 'MEDIUM', evidence_quality: 'sentence', ...extra,
});

/** A period stated in the sentence ("FY29", "Q3 FY27", "'28-'29"). */
const periodIn = (s: string): string | null => {
  const m = /\b(Q[1-4]\s?FY\s?'?\d{2}|FY\s?'?\d{2}(?:\s*[-–]\s*'?\d{2})?|H[12]\s?FY\s?'?\d{2})\b/i.exec(s);
  return m ? m[1].replace(/\s+/g, ' ') : null;
};

/**
 * Pure: management's qualitative statements on price, margin driver and
 * volume, and its forward guidance lines, read from a transcript. Every
 * event's evidence_text is copied verbatim from the text; every figure in
 * `after` appears in that evidence. Qualitative events carry no figure of
 * their own and are typed MANAGEMENT_CLAIM — shown as commentary, never as a
 * filed result. Questions are never evidence on their own: a question counts
 * only when management's next turn affirms it, and then the evidence is the
 * question AND the answer.
 */
export function transcriptCommentary(text: string, source: string): CommentaryEvent[] {
  const ss = transcriptSentences(text);
  const out: CommentaryEvent[] = [];
  const seen = new Set<string>();
  const push = (e: CommentaryEvent) => {
    const k = `${e.variable}|${String(e.after ?? "").toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k); out.push(e);
  };
  const count = (v: string) => out.filter((e) => e.variable === v && !e.guidance_line).length;
  /** The first sentence of the next MANAGEMENT turn after sentence i, when it
   *  affirms ("Yes, that's correct."). */
  const affirmation = (i: number): string | null => {
    for (let j = i + 1; j < Math.min(ss.length, i + 5); j++) {
      if (ss[j].analyst) continue;
      if (ss[j].speaker === ss[i].speaker && !ss[i].analyst) return null;
      return AFFIRM.test(ss[j].text) ? ss[j].text : null;
    }
    return null;
  };
  /** A statement put to management and confirmed: an analyst's sentence
   *  that ends in a question, or is followed by a short confirmation
   *  question ("Is that understanding correct?"), then a management "yes". */
  const confirmedQuestion = (i: number): string | null => {
    const s = ss[i];
    if (QUESTION.test(s.text)) { const a = affirmation(i); return a ? `${s.text} ${a}` : null; }
    const nx = ss[i + 1];
    if (nx && nx.speaker === s.speaker && QUESTION.test(nx.text) && nx.text.length <= 70 && /\b(correct|right|true|understanding|fair)\b/i.test(nx.text)) {
      const a = affirmation(i + 1);
      return a ? `${s.text} ${nx.text} ${a}` : null;
    }
    return null;
  };

  for (let i = 0; i < ss.length; i++) {
    const s = ss[i].text;
    const q = QUESTION.test(s);
    // Management's own statement, or an analyst's statement management
    // confirmed. Anything else an analyst says is a question, not evidence.
    const confirmed = ss[i].analyst || q ? confirmedQuestion(i) : null;
    if ((ss[i].analyst || q) && !confirmed) continue;
    const evidence = confirmed || s;
    const tag = confirmed ? ' (put to management and confirmed)' : '';
    const whole = (re: RegExp) => (s.length <= 200 ? s.replace(/[\s.]+$/, '') : clauseAround(s, re, 170));

    // PRICE — a statement about the company's product prices in words.
    if (count('price') < 8 && PRICE_WORD.test(s) && PRICE_QUAL.test(s)
      && !/\b(share price|stock price|price target|market price of (?:the )?share|issue price|buyback price)\b/i.test(s)) {
      push(evt('price', 'MANAGEMENT_CLAIM', `${whole(PRICE_WORD)}${tag}`, evidence, source, { qualitative: true }));
    }
    // MARGIN DRIVER — a mechanism for the margin, stated in words.
    if (count('margin_driver') < 4 && MARGIN_WORD.test(s) && MARGIN_QUAL.test(s)
      && !/\b(too early|very early|not in a position|cannot (?:share|comment|disclose))\b/i.test(s)
      && !/\d+(?:\.\d+)?\s*%/.test(s)) {
      // The answer itself names the margin: it is read on its own turn.
      const answerSays = !!confirmed && MARGIN_WORD.test(confirmed.slice(s.length));
      if (!answerSays) push(evt('margin_driver', 'MANAGEMENT_CLAIM', `${whole(/margin|controlled by us|backward[- ]integrat/i)}${tag}`, evidence, source, { qualitative: true }));
    }
    // VOLUME — qualitative only; a figure is never made from these words.
    if (count('volume') < 2 && VOLUME_QUAL.test(s) && !confirmed) {
      push(evt('volume', 'MANAGEMENT_CLAIM', clauseAround(s, VOLUME_QUAL), s, source, { qualitative: true }));
    }
    // FORWARD GUIDANCE — each line keeps the figure exactly as printed.
    for (const g of GUIDANCE_PATTERNS) {
      const m = g.re.exec(s);
      if (!m) continue;
      if (g.need && !g.need.test(s)) continue;
      const fig = (m.slice(1).find((x) => x) || '').replace(/\s+/g, ' ').trim();
      if (!fig || !/\d/.test(fig)) continue;
      const per = periodIn(s);
      push(evt('guidance', 'GUIDANCE', `${g.label}: ${fig}${per ? ` (${per})` : ''}`, evidence, source, { guidance_line: true, period: per }));
    }
  }
  return out;
}
