// ═══════════════════════════════════════════════════════════════════════════
// zzz971b — READING "RAISED / KEPT / LOWERED / GUIDED DOWN" OUT OF PLAIN TEXT.
//
// Pure (no fetch, no node modules): used by the server check (filing exhibits,
// call transcripts and write-ups) and by the card's one-line verdict.
//
// What the first live run got wrong, and the rule each one added:
//   • CarMax call: "…in order to actually not have to go with margins lower than
//     our initial guidance" read as a cut → a sentence where the verb sits
//     under "not / avoid / without / never" is not a statement that it happened.
//   • Byrna call: "gross margins outperforming our internal expectations and
//     inventory beginning to trend lower" read as a cut → the words between the
//     verb and "outlook / guidance / expectations" may not include "and / but /
//     which / while / as / or", and AFTER the noun only "was lowered" forms count
//     ("trend lower" is an adjective).
//   • Atossa: "Based on the capital raised and management's operating cash flow
//     forecast" read as a raise → same rule; and the noun before the verb may not
//     be capital / funds / money / prices.
//   • PepsiCo: "CFO touts cost discipline, slashes guidance" was missed by the
//     verb list (now has slash) and the quote came with the page menu in front
//     → a quote is cut to the words around the match.
// ═══════════════════════════════════════════════════════════════════════════

const OUTLOOK = String.raw`(?:outlook|guidance|forecasts?|expectations?|full[- ]year\s+(?:revenue|sales|eps|earnings)\s+range)`;
// a word between the verb and the noun: figures allowed ("$1,200"), joining words not
const GAP = String.raw`(?:(?!(?:and|but|while|which|that|as|or|because|so|then)\b)[\w$.%–\-'’]+(?:,\d+)*\s+)`;
const DET = String.raw`(?:its|our|the|their|full[- ]year|annual)?\s*`;

const DOWN_ACTIVE = String.raw`(?:lower(?:ed|s|ing)?|reduc(?:e|ed|es|ing)|cut(?:s|ting)?|trim(?:med|s|ming)?|slash(?:ed|es|ing)?|revis(?:ed|es|ing)\s+(?:down(?:ward)?|lower)|narrow(?:ed|s)?\s+(?:to\s+)?the\s+low(?:er)?\s+end|withdr(?:ew|awn|aws)|pull(?:ed|s)|tempered|walked\s+back)`;
const DOWN_PASSIVE = String.raw`(?:lowered|reduced|cut|trimmed|slashed|revised\s+(?:down(?:ward)?|lower)|withdrawn|pulled|tempered)`;
const UP_ACTIVE = String.raw`(?:rais(?:ed|es|ing)|increas(?:ed|es|ing)|lift(?:ed|s|ing)?|boost(?:ed|s|ing)?|upgrad(?:ed|es|ing)|revis(?:ed|es|ing)\s+(?:up(?:ward)?|higher)|hik(?:ed|es))`;
const UP_PASSIVE = String.raw`(?:raised|increased|lifted|boosted|upgraded|revised\s+(?:up(?:ward)?|higher))`;
const KEEP_ACTIVE = String.raw`(?:reaffirm(?:ed|s|ing)?|reiterat(?:ed|es|ing)|maintain(?:ed|s|ing)?|kept|keeps)`;
const KEEP_PASSIVE = String.raw`(?:reaffirmed|reiterated|maintained|unchanged|confirmed)`;
const BE = String.raw`(?:was|were|is|are|has\s+been|have\s+been|being|now|remains?)?\s*`;

const pair = (active: string, passive: string, gap = 6) => [
  new RegExp(String.raw`\b${active}\s+${DET}${GAP}{0,${gap}}?${OUTLOOK}\b`, 'i'),
  new RegExp(String.raw`\b${OUTLOOK}\s+${GAP}{0,${Math.min(gap, 5)}}?${BE}${passive}\b`, 'i'),
];
const RE_DOWN = pair(DOWN_ACTIVE, DOWN_PASSIVE);
const RE_UP = pair(UP_ACTIVE, UP_PASSIVE);
const RE_KEEP = pair(KEEP_ACTIVE, KEEP_PASSIVE, 5);

/** "lower costs", "reduced its debt", "cut expenses" are not an outlook cut, even near the word "guidance" */
const NOT_A_CUT = /\b(?:costs?|expenses?|debt|leverage|interest|tax(?:es)?|net\s+loss|losses|headcount|share\s+count|risk|emissions|inventory(?:\s+levels)?|capex|spending)\b/i;
const NOT_A_RAISE = /\b(?:prices?|pricing|dividend|buyback|repurchase|capital|funds|money|financing|debt|stake|investment|wages?|rates?|costs?|expenses?|tax(?:es)?|headcount|shares?\s+outstanding|concerns?|questions?|doubt)\b/i;
const NOT_A_KEEP = /\b(?:dividend|rating|listing|compliance|leverage\s+target|capital\s+allocation)\b/i;
/** the verb is under a negation, a condition or a hope — not something that happened */
const NEGATED_BEFORE = /\b(?:not|n['’]t|never|avoid(?:ing|ed)?|without|no\s+need|rather\s+than|instead\s+of|if|unless|could|would|might|should\s+we)\b[^.;]{0,45}$/i;
const BOILERPLATE = /\bforward[- ]looking\s+statements?\b|\bsafe\s+harbor\b|\bcould\s+(?:cause|differ)|\brisks?\s+and\s+uncertainties\b/i;

export function splitSentences(text: string): string[] {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
}

/** The words around a match — the whole sentence when it is short, else ~90 characters each side, cut at word edges. */
export function focusQuote(sentence: string, idx: number, len: number, max = 230): string {
  // page clutter a web page puts into the same "sentence": a title bar ("… | CFO Dive Skip to main content"), a
  // section heading in capitals ("Email … RISKS Daniels warned …"), HTML entities
  const matched = sentence.slice(idx, idx + len);
  let s = sentence.replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\[email\s+protected\]/gi, '').trim();
  let at = s.indexOf(matched.replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&'));
  if (at < 0) { s = sentence.trim(); at = Math.max(0, s.indexOf(matched)); }
  const bar = s.lastIndexOf(' | ', at);
  const barEnd = s.indexOf(' | ', at + matched.length);
  if (bar >= 0 || barEnd >= 0) { const a = bar >= 0 ? bar + 3 : 0; s = s.slice(a, barEnd >= 0 ? barEnd : s.length); at -= a; }
  const heads = [...s.slice(0, at).matchAll(/\b[A-Z]{3,}(?:\s+[A-Z]{3,})*\s+(?=[A-Z][a-z])/g)];
  const head = heads.length ? heads[heads.length - 1] : null;
  if (head && head.index != null && !/^(?:GAAP|CEO|CFO|COO|EPS|USD|NYSE|ARR|EBITDA|FY)\s/.test(head[0])) { const a = head.index + head[0].length; s = s.slice(a); at -= a; }
  idx = Math.max(0, at); len = matched.length;
  s = s.trim();
  if (s.length <= max) return s;
  const side = Math.max(40, Math.floor((max - len) / 2));
  let a = Math.max(0, idx - side), b = Math.min(s.length, idx + len + side);
  if (a > 0) { const sp = s.indexOf(' ', a); a = sp > 0 && sp < idx ? sp + 1 : a; }
  if (b < s.length) { const sp = s.lastIndexOf(' ', b); b = sp > idx + len ? sp : b; }
  return `${a > 0 ? '…' : ''}${s.slice(a, b).trim()}${b < s.length ? '…' : ''}`;
}

function firstMatch(text: string, res: RegExp[], skipInMatch: RegExp): { quote: string; sentence: string } | null {
  for (const sn of splitSentences(text)) {
    if (sn.length < 20 || sn.length > 1200) continue;
    if (BOILERPLATE.test(sn)) continue;
    for (const re of res) {
      const m = re.exec(sn);
      if (!m) continue;
      // the matched words plus the three after them ("lowered … guidance for operating costs")
      const around = sn.slice(Math.max(0, m.index - 25), m.index + m[0].length + 30);
      if (skipInMatch.test(m[0]) || skipInMatch.test(around.slice(around.length - 30))) continue;
      if (skipInMatch === NOT_A_RAISE && /\b(?:capital|funds|money|cash)\s+$/i.test(sn.slice(0, m.index))) continue;
      if (NEGATED_BEFORE.test(sn.slice(Math.max(0, m.index - 60), m.index))) continue;
      return { quote: focusQuote(sn, m.index, m[0].length), sentence: sn };
    }
  }
  return null;
}

const SEGMENT = /\b(?:segment|division|program(?:me)?s?|product\s+line|business\s+unit|customer|platform)\b/i;

/** A sentence saying management lowered an outlook. Null when there is none. */
export function guideLoweredInText(text: string): { quote: string; scope: 'company' | 'segment' } | null {
  const hit = firstMatch(text, RE_DOWN, NOT_A_CUT);
  if (!hit) return null;
  // "raised revenue guidance but lowered EPS guidance" is still a cut; "raised its outlook" alone never reaches here
  return { quote: hit.quote, scope: SEGMENT.test(hit.sentence) ? 'segment' : 'company' };
}
/** A sentence saying management RAISED an outlook. Only call after the lowered check — a cut anywhere wins. */
export function guideRaisedInText(text: string): { quote: string } | null {
  const hit = firstMatch(text, RE_UP, NOT_A_RAISE);
  return hit ? { quote: hit.quote } : null;
}
/** A sentence saying management kept / reaffirmed its outlook. */
export function guideKeptInText(text: string): { quote: string } | null {
  const hit = firstMatch(text, RE_KEEP, NOT_A_KEEP);
  return hit ? { quote: hit.quote } : null;
}

// ── A PROFIT LINE GUIDED BELOW LAST YEAR ─────────────────────────────────────
// Not a cut versus management's own earlier range, but the owner counts it:
// "CAF income expected to be slightly below FY26", "GPU expected to decline year over year in Q3 and Q4".
const PROFIT_LINE = String.raw`(?:income|profit|profits|margins?|eps|earnings(?:\s+per\s+share)?|gpu|gross\s+profit(?:\s+per\s+unit)?|ebitda|operating\s+income)`;
const FUTURE = String.raw`(?:expect(?:s|ed|ing)?|anticipat(?:e|es|ed|ing)|guid(?:e|es|ed|ing|ance)|outlook|forecast(?:s|ed|ing)?|project(?:s|ed|ing)?|will\s+be|to\s+remain)`;
const DOWN_WORD = String.raw`(?:below|lower\s+than|declin(?:e|es|ed|ing)|down|decreas(?:e|es|ed|ing)|compress(?:ed|ion)?|contract(?:ion)?|pressure[ds]?)`;
const VS_LAST = String.raw`(?:year[- ]over[- ]year|y\/y|yoy|(?:the\s+)?prior\s+year|last\s+year|a\s+year\s+ago|fiscal\s+(?:year\s+)?(?:20)?\d{2}|fy\s?'?\d{2})`;
const RE_CAUTION = new RegExp(String.raw`\b${PROFIT_LINE}\b[^.]{0,80}?\b${FUTURE}\b[^.]{0,80}?\b${DOWN_WORD}\b[^.]{0,60}?\b${VS_LAST}|\b${FUTURE}\b[^.]{0,60}?\b${PROFIT_LINE}\b[^.]{0,60}?\b${DOWN_WORD}\b[^.]{0,60}?\b${VS_LAST}`, 'i');
const NOT_A_CAUTION = /\b(?:net\s+loss|losses|loss\s+per|costs?|expenses?|tax\s+rate|interest\s+expense|share\s+count|decline\s+less\s+than|less\s+than\s+(?:previously|initially|earlier)|smaller\s+decline|better\s+than)\b/i;
/** A sentence guiding a profit line below last year. */
export function guideCautionInText(text: string): { quote: string } | null {
  for (const sn of splitSentences(text)) {
    if (sn.length > 400 || sn.length < 25) continue;
    if (BOILERPLATE.test(sn) || /\bcould\b|\bmay\b|\bif\b/i.test(sn)) continue;
    const m = RE_CAUTION.exec(sn);
    if (!m || NOT_A_CAUTION.test(m[0])) continue;
    if (NEGATED_BEFORE.test(sn.slice(Math.max(0, m.index - 60), m.index))) continue;
    return { quote: focusQuote(sn, m.index, m[0].length) };
  }
  return null;
}

// ── call write-ups: only sentences about THIS company ───────────────────────
export function aboutCompany(text: string, company: string): string {
  const word = (company || '').split(/[\s,.]+/).find((w) => w.length >= 4 && !/^(the|inc|corp|corporation|company|holdings|group|technologies|solutions)$/i.test(w)) || '';
  const alts = ['the company', 'management', 'we', 'our', 'it', word.replace(/[^A-Za-z0-9]/g, '')].filter(Boolean);
  const about = new RegExp(`\\b(${alts.join('|')})\\b`, 'i');
  return splitSentences(text).filter((sn) => about.test(sn)).join(' ');
}
/** A lowered-outlook sentence in a call write-up that is about THIS company (its name, or "the company" / "management"). */
export function guideLoweredInCoverage(text: string, company: string): { quote: string; scope: 'company' | 'segment' } | null {
  return guideLoweredInText(aboutCompany(text, company));
}
/** The direction a call write-up states for THIS company: lowered wins over guided-down, guided-down over raised, raised over kept. */
export function guideDirectionInCoverage(text: string, company: string): { direction: 'lowered' | 'mixed' | 'cautious' | 'raised' | 'maintained'; quote: string; scope: 'company' | 'segment' } | null {
  const own = aboutCompany(text, company);
  const lo = guideLoweredInText(own);
  if (lo) return { direction: 'lowered', ...lo };
  const up = guideRaisedInText(own);
  const caution = guideCautionInText(own);
  if (caution) return { direction: up ? 'mixed' : 'cautious', quote: up ? `${up.quote} … ${caution.quote}`.slice(0, 460) : caution.quote, scope: 'company' };
  if (up) return { direction: 'raised', quote: up.quote, scope: 'company' };
  const keep = guideKeptInText(own);
  if (keep) return { direction: 'maintained', quote: keep.quote, scope: 'company' };
  return null;
}
