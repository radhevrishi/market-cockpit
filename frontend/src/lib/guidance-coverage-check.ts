// zzz865 — COVERAGE CHECK: type company names, see for each whether the guidance universe holds it (active guidance, a claim waiting for its
// company document, or nothing yet). Pure functions, no company is named here. A name that is not found is never reported as "no guidance";
// it is reported as "not read yet" with the next step. Matching is by normalised name words (prefix match), by joined spelling, or by ticker.
import { normCompanyName } from './guidance-upgrades-candidates';

export type CoverageStatus = 'ACTIVE' | 'CLAIM_WAITING' | 'NOT_SEEN';
export interface CoverageCandidate { company: string; ticker?: string | null; market?: string | null }
export interface CoverageActive extends CoverageCandidate { display: string; metric?: string; period?: string | null; verification?: string | null }
export interface CoverageClaim extends CoverageCandidate { claim: string; status: string; nextAction: string }
export interface CoverageRow {
  input: string; status: CoverageStatus; matched: string | null; ticker: string | null; market: string | null;
  /** one plain sentence: what the universe holds for this name */ line: string;
  /** all active guidance lines found for the name (revenue, PAT ...) */ guidance: string[];
  /** what happens next */ next: string;
}

/** Split pasted text (a numbered list, commas, emoji, notes in brackets) into clean company names. */
export function parseNames(text: string, max = 80): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const part of String(text || '').split(/[\n\r;,]+/)) {
    let t = part.replace(/\([^)]*\)/g, ' ').replace(/^\s*\d+\s*[.)\-:]*\s*/, '').replace(/[^\p{L}\p{N}&.\-' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(/\s+(?:hinted|raised|upgraded)$/i, '').trim();
    if (t.length < 3) continue;
    const k = normCompanyName(t); if (!k || seen.has(k)) continue;
    seen.add(k); out.push(t); if (out.length >= max) break;
  }
  return out;
}

const tokens = (s: string): string[] => normCompanyName(s).split(' ').filter(Boolean);
/** Does the typed name point at this company? Every typed word starts a company word, or the typed name run together starts the company name, or it is the ticker. */
export function nameMatches(input: string, cand: CoverageCandidate): boolean {
  const q = tokens(input); if (!q.length || q.join('').length < 3) return false;
  const t = String(cand.ticker || '').toUpperCase();
  const qj = q.join('');
  if (t && (t === input.toUpperCase().replace(/[^A-Z0-9&-]/g, '') || t === qj.toUpperCase())) return true;
  const c = tokens(cand.company); if (!c.length) return false;
  if (qj.length >= 4 && c.join('').startsWith(qj)) return true;
  const used = new Set<number>(); let pos = -1; let ok = true;
  for (const w of q) {
    let found = -1;
    for (let i = pos + 1; i < c.length; i++) if (!used.has(i) && c[i].startsWith(w)) { found = i; break; }
    if (found < 0) { ok = false; break; }
    used.add(found); pos = found;
  }
  return ok;
}

export function checkCoverage(inputs: string[], active: CoverageActive[], claims: CoverageClaim[]): CoverageRow[] {
  return inputs.map((input): CoverageRow => {
    const a = active.filter((x) => nameMatches(input, x));
    if (a.length) {
      const first = a[0];
      return { input, status: 'ACTIVE', matched: first.company, ticker: first.ticker ?? null, market: first.market ?? null,
        line: 'In the guidance universe with active guidance.', guidance: a.map((x) => `${x.metric ?? ''} ${x.display}${x.period ? ` · ${x.period}` : ''}${x.verification ? ` · ${x.verification}` : ''}`.trim()),
        next: 'Nothing to do. Open the company row for the source and the calculation.' };
    }
    const c = claims.filter((x) => nameMatches(input, x));
    if (c.length) {
      const first = c[0];
      return { input, status: 'CLAIM_WAITING', matched: first.company, ticker: first.ticker ?? null, market: first.market ?? null,
        line: 'A guidance claim exists, but the company document has not confirmed it yet.', guidance: c.map((x) => x.claim),
        next: first.nextAction || 'The company document is queued to be read.' };
    }
    return { input, status: 'NOT_SEEN', matched: null, ticker: null, market: null,
      line: 'Not in the guidance universe yet. This is NOT a statement that the company gave no guidance. Its documents have not been read.', guidance: [],
      next: 'Add it to the automatic read list: its next filings are read first and the next India run picks it up.' };
  });
}
export function coverageSummary(rows: CoverageRow[]): { total: number; active: number; waiting: number; notSeen: number } {
  return { total: rows.length, active: rows.filter((r) => r.status === 'ACTIVE').length, waiting: rows.filter((r) => r.status === 'CLAIM_WAITING').length, notSeen: rows.filter((r) => r.status === 'NOT_SEEN').length };
}
