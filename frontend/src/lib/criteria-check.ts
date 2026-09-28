// ═══════════════════════════════════════════════════════════════════════════
// PASS, FAIL — OR NOT CHECKED.                                         (zzz823)
//
// The Conviction Beats criteria were a yes/no function. A name whose sales
// growth, market cap or margin had not been filled in yet read as a FAIL: the
// filter did `sales ?? 0 < 20`, so "we do not know" became "0%" and the name
// was silently dropped from the Conviction Beats tab and pushed to the hidden
// "failing" pile on Portfolio Catalysts. Unknown is not fail.
//
// This runner turns a yes/no filter into three answers, using the filter's
// OWN per-criterion probe (so it can never disagree with it):
//   pass     — the full filter passes;
//   fail     — at least one criterion fails on data that IS there;
//   unknown  — every criterion that fails does so only because its data is
//              missing — the name is shown, labelled "not checked: … missing".
// PURE: no fetch, no window.
// ═══════════════════════════════════════════════════════════════════════════

export type CriteriaState = 'pass' | 'fail' | 'unknown';

export interface CriteriaCheck {
  state: CriteriaState;
  /** Criteria missed on data that is there, in plain words. */
  failed: string[];
  /** Data fields a criterion needed and did not have, in plain words. */
  missing: string[];
}

/**
 * `keys`       the criteria active in the filter set;
 * `fullPass`   the filter's own verdict over all of them;
 * `probe(k)`   the filter with ONLY criterion k active;
 * `missingOf`  for a criterion that fails, the data words it lacked — an
 *              empty list means it failed on real data (or is strict);
 * `failWord`   the plain-words reason for a real failure.
 */
export function runCriteriaCheck(
  keys: string[],
  fullPass: boolean,
  probe: (k: string) => boolean,
  missingOf: (k: string) => string[],
  failWord: (k: string) => string,
): CriteriaCheck {
  if (fullPass) return { state: 'pass', failed: [], missing: [] };
  const failed: string[] = [];
  const missing: string[] = [];
  for (const k of keys) {
    if (probe(k)) continue;
    const m = missingOf(k);
    if (m.length) { for (const w of m) if (!missing.includes(w)) missing.push(w); }
    else { const w = failWord(k); if (!failed.includes(w)) failed.push(w); }
  }
  if (failed.length) return { state: 'fail', failed, missing };
  if (missing.length) return { state: 'unknown', failed, missing };
  // The whole set fails while no single criterion does (a combination rule):
  // that is a real failure, said as such.
  return { state: 'fail', failed: ['another active criterion'], missing };
}

/** "not checked: sales growth, market cap missing". */
export function notCheckedText(missing: string[]): string {
  return `not checked: ${missing.join(', ')} missing`;
}

/** One line for a card / row. */
export function criteriaCheckText(c: CriteriaCheck, passText: string): string {
  if (c.state === 'pass') return passText;
  if (c.state === 'unknown') return `${notCheckedText(c.missing)} — shown, not failed (unknown is not a fail)`;
  return `misses your Conviction Beats criteria — ${c.failed.join('; ')}${c.missing.length ? ` · also ${notCheckedText(c.missing)}` : ''}`;
}
