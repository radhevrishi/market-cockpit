// ═══════════════════════════════════════════════════════════════════════════
// A CHECK THE DOCUMENTS ARE SILENT ON IS UNKNOWN — NEVER PASSED.     (zzz788)
//
// The owner read "One-offs · none disclosed · check passes" on CYIENTDLM and
// MOREPENLAB, and "1 silent (passes, not a reading)" in the structural and
// mechanism summaries. Both are wrong: a document that says nothing about
// one-offs (or customer loss, execution delay, a shutdown…) has not told us
// there were none. Silence is UNKNOWN — not negative, and not positive.
//
// THE ONE INVARIANT, in one place, used everywhere a silent / undisclosed
// check is rendered or counted:
//   · silent            → "NOT DISCLOSED · unknown"; counted as silent, never
//                         as passed, flat or confirmed; never clears a gate.
//   · explicitly none   → "none stated by the company · check passes" — only
//                         when the document itself says there were none
//                         ("no exceptional items during the quarter").
// Pure: no I/O, no dependency on the status engine.
// ═══════════════════════════════════════════════════════════════════════════

/** The row word for a silent check. */
export const SILENT_CHECK_WORD = 'NOT DISCLOSED · unknown';
/** The row word for a check the company explicitly answered "none". */
export const NONE_STATED_WORD = 'none stated by the company · check passes';
/** The state word in a mechanism / structural list. */
export const SILENT_STATE_WORD = 'silent (NOT DISCLOSED — unknown, not a reading)';
/** The phrase used inside a status sentence. */
export const SILENT_PHRASE = 'NOT DISCLOSED · unknown — silence, not a reading';
/** The hover text beside a silent count. */
export const SILENT_HINT = 'A check the documents read did not mention: UNKNOWN — not passed, not failed. It passes only when the company states there were none.';
/** "1 silent (unknown, not a reading)" — the count as printed. */
export function silentCountWord(n: number): string {
  return `${n} silent (unknown, not a reading)`;
}

/** The company's own words that there were NONE of the item. */
const NONE_STATED = new RegExp([
  String.raw`\b(?:no|nil|none|not any|without any|zero)\b[^.;]{0,40}\b(?:one[- ]?offs?|one[- ]time|exceptional|non[- ]recurring|extraordinary|customer loss(?:es)?|loss of (?:any )?customers?|execution delays?|delays?|shutdowns?|bottlenecks?)`,
  String.raw`\b(?:one[- ]?offs?|one[- ]time items?|exceptional items?|extraordinary items?|non[- ]recurring items?)\b[^.;]{0,20}\b(?:nil|none|not applicable|zero)\b`,
  String.raw`^\s*(?:nil|none|no|not applicable|n\/a|—|-)\s*\.?\s*$`,
].join('|'), 'i');

/** Pure: does this text state that there were none? */
/** zzz790: "no stated delays", "none disclosed", "not mentioned" report the
 *  READER's silence, not the company's statement — never an explicit none. */
export const SILENCE_WORDING = /\bno\b[^.;]{0,40}?\b(?:disclosed|mentioned|cited|specified)\b|\b(?:no|not|none)\s+(?:stated|mentioned|disclosed|reported|found|cited|specified)\b|\bno mention\b|\bnot (?:been )?(?:stated|mentioned|disclosed)\b|\bnone (?:were |was )?(?:disclosed|found|mentioned)\b/i;
export function explicitNoneStated(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  return !!t && NONE_STATED.test(t) && !SILENCE_WORDING.test(t);
}

export interface SilentCheckRow {
  verdict?: string | null;
  /** The engine's flag: documents read, nothing found. */
  silence?: boolean | null;
  readings?: number | null;
  before?: string | null;
  after?: string | null;
}

/** Pure: a check with no reading at all — documents read, nothing said. */
export function isSilentCheck(c: SilentCheckRow): boolean {
  if (c.silence) return true;
  return c.verdict === 'flat' && (c.readings === 0 || (c.readings == null && !c.after && !c.before));
}

/** Pure: the ONLY way a risk check passes — the company said "none". */
export function checkPasses(c: SilentCheckRow): boolean {
  if (isSilentCheck(c)) return false;
  return explicitNoneStated(c.after) || explicitNoneStated(c.before);
}

/** Pure: 'passes' | 'unknown' (silent) | 'read' (a real reading to judge). */
export function silentCheckState(c: SilentCheckRow): 'passes' | 'unknown' | 'read' {
  if (isSilentCheck(c)) return 'unknown';
  return checkPasses(c) ? 'passes' : 'read';
}
