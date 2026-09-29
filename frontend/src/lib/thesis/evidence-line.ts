// ═══════════════════════════════════════════════════════════════════════════
// THE EVIDENCE LINE — ONE SENTENCE, THE RIGHT WORD.                (zzz837)
//
// "EVIDENCE: contradicted (0/4 structural) · missing: Capacity utilisation …"
// said a structural check was contradicted when none was: the word came from
// the OUTPUT check (operating leverage, computed from revenue and profit). The
// structural part of the line now says 'contradicted' only when a structural
// check is contradicted; with nothing confirmed it says 'not confirmed'. The
// output check is named apart. Pure; no imports, so status.ts can use it.
// ═══════════════════════════════════════════════════════════════════════════

export interface EvidenceLineInput {
  evidence: 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'NOT_CONTRADICTED' | 'CONTRADICTED' | 'INCOMPLETE' | 'UNCHECKED' | string;
  coverage: {
    confirmed: number; applicable: number;
    missing?: string[]; contradicted?: string[]; historical?: string[];
    /** Output checks (revenue / earnings / margin / operating leverage) that moved down. */
    outputContradicted?: string[];
  };
}

/** Case-insensitive dedupe that keeps first spelling and order. */
export function dedupeLabels(xs: Array<string | null | undefined> | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs || []) {
    const t = String(x ?? '').trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function evidenceLineOf(v: EvidenceLineInput): string {
  const cov = v.coverage;
  const x = cov.confirmed, y = cov.applicable;
  if (v.evidence === 'UNCHECKED') return 'not checked — no document read yet';
  const contra = dedupeLabels(cov.contradicted);
  const contraSet = new Set(contra.map((s) => s.toLowerCase()));
  const hist = dedupeLabels(cov.historical);
  const histSet = new Set(hist.map((s) => s.toLowerCase()));
  const missing = dedupeLabels(cov.missing).filter((s) => !contraSet.has(s.toLowerCase()) && !histSet.has(s.toLowerCase()));
  const out = dedupeLabels(cov.outputContradicted);
  const ratio = `(${x}/${y} structural)`;
  let word: string;
  if (contra.length) word = `contradicted ${ratio}: ${contra.join(', ')}`;
  else if (x === 0) word = `not confirmed ${ratio}`;
  else if (v.evidence === 'CONFIRMED') word = `confirmed ${ratio}`;
  else if (v.evidence === 'PARTIALLY_CONFIRMED') word = `partly confirmed ${ratio}`;
  else if (v.evidence === 'NOT_CONTRADICTED') word = `nothing contradicted, not confirmed ${ratio}`;
  else word = `incomplete ${ratio}`;
  return word
    + (hist.length ? ` · historical unresolved: ${hist.join(', ')}` : '')
    + (missing.length ? ` · missing: ${missing.join(', ')}` : '')
    + (out.length ? ` · output check (separate from the structural count): ${out.join(', ')}` : '');
}

// ── THE THREE COUNT ROWS, WITHOUT TRIPLICATION.                    (zzz837)
// STRUCTURAL / MECHANISM / OUTPUT CHECK each listed the same pending items.
// A name is now listed once — under the first row that names it — and later
// rows say how many are the same as above. State words are one vocabulary.
export interface TallyLike {
  confirmed: number; pending: number; contradicted: number; total: number; core_variables?: number;
  watch?: number; historical?: number; unclear?: number;
  named?: { contradicted?: string[]; pending?: string[]; unclear?: string[]; watch?: string[]; historical?: string[] };
}
export interface CountRow {
  name: 'STRUCTURAL' | 'MECHANISM' | 'OUTPUT CHECK';
  total: number;
  parts: Array<{ state: 'confirmed' | 'pending' | 'contradicted' | 'watch' | 'unclear' | 'historical'; word: string; n: number; names: string[]; sameAsAbove: number }>;
}
export const COUNT_STATE_WORD = {
  confirmed: 'confirmed', pending: 'not yet read', contradicted: 'contradicted', watch: 'watch', unclear: 'unclear', historical: 'historical unresolved',
} as const;
export function dedupedCountRows(cov: { structural?: TallyLike | null; mechanism?: TallyLike | null; output?: TallyLike | null }): CountRow[] {
  const rows: Array<[CountRow['name'], TallyLike | null | undefined]> = [['STRUCTURAL', cov.structural], ['MECHANISM', cov.mechanism], ['OUTPUT CHECK', cov.output]];
  const listed: Record<string, Set<string>> = {};
  const out: CountRow[] = [];
  for (const [name, t] of rows) {
    if (!t) continue;
    const parts: CountRow['parts'] = [];
    for (const state of ['confirmed', 'pending', 'contradicted', 'watch', 'unclear', 'historical'] as const) {
      const n = (t as any)[state] as number | undefined ?? 0;
      if (!n) continue;
      const all = dedupeLabels(state === 'confirmed' ? [] : (t.named as any)?.[state]);
      const seen = (listed[state] ||= new Set<string>());
      const fresh = all.filter((x) => !seen.has(x.toLowerCase()));
      for (const x of fresh) seen.add(x.toLowerCase());
      parts.push({ state, word: COUNT_STATE_WORD[state], n, names: fresh, sameAsAbove: all.length - fresh.length });
    }
    out.push({ name, total: t.core_variables ?? t.total, parts });
  }
  return out;
}

/** Metric + period + value identity of a historical-context row: the same
 *  figure in another unit spelling ("30 KL" / "30 KLPD") is one row. (zzz837) */
export function histSignature(key: string, period: string, value: string): string {
  const nums = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
  return `${key}|${String(period).toLowerCase()}|${(nums || [String(value).toLowerCase()]).join(',')}`;
}
