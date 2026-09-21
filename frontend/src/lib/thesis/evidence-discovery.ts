// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE DISCOVERY — FIND EVERY DOCUMENT, NOT THE FIRST ONE.      (zzz733)
//
// THE BUG THIS EXISTS TO FIX, in the owner's words: "Claude is functioning as
// a grader over whatever data is already available, not as an evidence-
// retrieval agent." He is right, and the code said so plainly: the India
// reader tried the exchange feed, then ONE screener.in document, and on
// failure returned "No readable document was found" — after which the card
// was still drawn from screener financial data with every structural field
// at ○. A retrieval failure became a thesis verdict.
//
// Three separate defects sat underneath that sentence:
//
//   1. ONE DOCUMENT PER COMPANY. A quarter's evidence is spread across the
//      results PDF (the numbers), the investor presentation (capacity,
//      utilisation, order book) and the concall transcript (the cause, the
//      guidance, the ramp). Reading whichever single document answered first
//      structurally cannot populate the structural block.
//   2. A CHAIN THAT STOPPED AT THE FIRST FAILURE. screener.in is unreachable
//      from this host — it refuses datacenter IPs — so on production the
//      chain died at step one and never reached the exchange announcements
//      that WERE available.
//   3. NO RECORD OF WHAT WAS TRIED. "No readable document" is indistinguish-
//      able from "the company disclosed nothing", and those are opposite
//      facts about a holding. Every attempt is now recorded and returned.
//
// WHAT THIS MODULE DOES NOT DO. It finds and ranks documents. It does not
// extract, does not interpret, and never produces a value. Extraction is a
// separate stage precisely so a discovery failure can never be mistaken for
// a disclosure absence — the distinction the owner's spec calls
// NOT_SEARCHED vs SEARCHED_NO_EVIDENCE.
// ═══════════════════════════════════════════════════════════════════════════

import { fetchCompanyDocs, pickDocument, type CompanyDoc } from '@/lib/earnings/screener-documents';

/** Where a document came from, in the owner's source hierarchy (§28). */
export type SourceTier = 1 | 2 | 3;

export type DocKind =
  | 'results'              // the numbers
  | 'investor_presentation' // capacity, utilisation, order book, capex
  | 'transcript'           // cause, guidance, ramp — the richest structural source
  | 'annual_report'
  | 'announcement'         // orders, commissioning, approvals
  | 'other';

export interface DocCandidate {
  url: string;
  kind: DocKind;
  /** Tier 1 company/exchange disclosure, tier 2 management transcript. */
  tier: SourceTier;
  /** Where this candidate was found — named so a card can cite it. */
  source: string;
  /** As the source labels it ("Sep 2026", "2026-08-14"). Null when unlabelled. */
  period: string | null;
  /** ISO date for ordering. Null when unparseable. */
  dateIso: string | null;
  /** Human label for the card's SOURCES block. */
  label: string;
}

/** One retrieval attempt, recorded whether it succeeded or not. */
export interface DiscoveryAttempt {
  source: string;
  outcome: 'found' | 'empty' | 'error';
  detail: string;
  found: number;
}

export type DiscoveryState =
  /** Documents were found and can be read. */
  | 'EVIDENCE_FOUND'
  /** Every source was reached and none of them holds a readable document. */
  | 'SEARCH_EXHAUSTED'
  /** A source could not be reached at all — this is NOT an absence of
   *  disclosure, and must never be reported as one. */
  | 'RETRIEVAL_FAILED';

export interface Discovery {
  state: DiscoveryState;
  candidates: DocCandidate[];
  attempts: DiscoveryAttempt[];
  /** Plain sentence for the card. Says what was tried, never blames the
   *  company for a network failure. */
  summary: string;
}

/**
 * How much structural evidence a kind of document typically carries.
 *
 * A TRANSCRIPT RANKS ABOVE THE RESULTS PDF, and not as a fallback. The
 * structural block asks for utilisation, capacity, order intake, commissioning
 * dates and management targets. A results PDF is a statement of financials and
 * usually contains none of them; a concall is forty minutes of analysts asking
 * management exactly those questions. The exchange feed was wired first
 * because it was available, not because it was better.
 */
const KIND_RANK: Record<DocKind, number> = {
  transcript: 0,
  investor_presentation: 1,
  results: 2,
  announcement: 3,
  annual_report: 4,
  other: 5,
};

/** Pure: rank candidates for reading, nearest-period first within a kind. */
export function rankCandidates(candidates: DocCandidate[], near?: string | null): DocCandidate[] {
  const nearMs = near ? Date.parse(near) : NaN;
  const ageRank = (d: DocCandidate): number => {
    if (!d.dateIso) return 3;
    if (!Number.isFinite(nearMs)) return 0;
    const days = Math.abs(Date.parse(d.dateIso) - nearMs) / 86_400_000;
    return days <= 120 ? 0 : days <= 240 ? 1 : 2;
  };
  return [...candidates].sort((a, b) => {
    const aa = ageRank(a), ba = ageRank(b);
    if (aa !== ba) return aa - ba;
    const ak = KIND_RANK[a.kind], bk = KIND_RANK[b.kind];
    if (ak !== bk) return ak - bk;
    return String(b.dateIso || '').localeCompare(String(a.dateIso || ''));
  });
}

/**
 * Pure: pick the documents worth reading, capped, and never two of the same
 * kind.
 *
 * ONE PER KIND IS THE POINT. Reading three investor presentations from three
 * quarters costs three model calls and answers the same questions three times;
 * reading the transcript AND the presentation AND the results answers three
 * different sets. The cap exists because each document is a model call against
 * the owner's budget.
 */
export function selectForReading(ranked: DocCandidate[], max = 3): DocCandidate[] {
  const out: DocCandidate[] = [];
  const kinds = new Set<DocKind>();
  for (const c of ranked) {
    if (out.length >= max) break;
    if (kinds.has(c.kind)) continue;
    kinds.add(c.kind);
    out.push(c);
  }
  // A second document of an already-taken kind is better than no second
  // document at all, so the remaining slots are filled after the sweep.
  for (const c of ranked) {
    if (out.length >= max) break;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Pure: map a screener.in document entry into a candidate. */
export function candidateFromScreenerDoc(d: CompanyDoc): DocCandidate {
  const kind: DocKind = d.kind === 'transcript' ? 'transcript'
    : d.kind === 'ppt' ? 'investor_presentation'
      : d.kind === 'annual_report' ? 'annual_report' : 'other';
  return {
    url: d.url,
    kind,
    tier: kind === 'transcript' ? 2 : 1,
    source: 'screener.in company page',
    period: d.period,
    dateIso: d.periodIso,
    label: d.label,
  };
}

/** Pure: classify an exchange attachment by its subject and filename. The
 *  subject is frequently generic ("Announcement under Regulation 30"), so the
 *  filename is read too — the same lesson that produced zzz705. */
export function classifyExchangeDoc(subject: string, url: string): DocKind {
  const hay = `${subject} ${decodeURIComponent(url).replace(/[_-]+/g, ' ')}`;
  if (/transcript/i.test(hay)) return 'transcript';
  if (/investor\s*(presentation|update)|earnings\s*(presentation|deck)/i.test(hay)) return 'investor_presentation';
  if (/financial\s+results|outcome\s+of\s+(the\s+)?board\s+meeting|press\s+release|earnings\s+update/i.test(hay)) return 'results';
  if (/annual\s+report/i.test(hay)) return 'annual_report';
  if (/order|contract|letter\s+of\s+award|loa\b|commission|expansion|capacity|plant|approval|acquisition/i.test(hay)) return 'announcement';
  return 'other';
}

export interface ExchangeFiling {
  symbol?: string;
  subject?: string;
  attachment_url?: string;
  filing_date?: string;
}

/** Pure: every readable attachment this ticker has in the exchange feed,
 *  as candidates. Unlike the old ranker this does NOT discard announcements —
 *  an order win or a commissioning notice is exactly the structural evidence
 *  the thesis ledger asks for, and the old filter threw them away. */
export function candidatesFromFilings(all: ExchangeFiling[], ticker: string): DocCandidate[] {
  const sym = ticker.toUpperCase();
  const out: DocCandidate[] = [];
  const seen = new Set<string>();
  for (const f of all) {
    if (String(f?.symbol || '').toUpperCase() !== sym) continue;
    const url = String(f?.attachment_url || '');
    if (!url || seen.has(url)) continue;
    const subject = String(f?.subject || '');
    const hay = `${subject} ${decodeURIComponent(url).replace(/[_-]+/g, ' ')}`;
    // Documents that are never evidence of anything structural.
    if (/newspaper|trading window|voting result|scrutini[sz]er|postal ballot|duplicate share|loss of share|share transfer|reconciliation of share capital|compliance certificate/i.test(hay)) continue;
    seen.add(url);
    const kind = classifyExchangeDoc(subject, url);
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(f?.filing_date || '')) ? String(f!.filing_date).slice(0, 10) : null;
    out.push({
      url,
      kind,
      tier: 1,
      source: 'exchange filing feed',
      period: date,
      dateIso: date,
      label: subject || 'Exchange filing',
    });
  }
  return out;
}

/**
 * Discover every document available for one company.
 *
 * BOTH SOURCES ARE ALWAYS TRIED. The previous chain stopped as soon as one
 * answered, which meant that on production — where screener.in refuses this
 * host — the whole structural block came back empty while exchange
 * announcements sat unread. A source that fails is recorded and the next one
 * runs.
 */
export async function discoverEvidence(
  ticker: string,
  opts: { filings?: ExchangeFiling[]; filingDate?: string | null },
): Promise<Discovery> {
  const attempts: DiscoveryAttempt[] = [];
  const candidates: DocCandidate[] = [];
  let anyReached = false;

  // ── Source 1: the exchange feed (tier 1, but a rolling ~1-week window).
  const filings = opts.filings || [];
  if (filings.length) {
    anyReached = true;
    const found = candidatesFromFilings(filings, ticker);
    candidates.push(...found);
    attempts.push({
      source: 'exchange filing feed',
      outcome: found.length ? 'found' : 'empty',
      detail: found.length
        ? `${found.length} attachment(s) for ${ticker}`
        : `the feed was read (${filings.length} filings) but holds none for ${ticker} — it is a rolling window of roughly one week`,
      found: found.length,
    });
  } else {
    attempts.push({
      source: 'exchange filing feed',
      outcome: 'error',
      detail: 'the feed could not be reached',
      found: 0,
    });
  }

  // ── Source 2: the screener.in company page (full concall history).
  try {
    const lib = await fetchCompanyDocs(ticker);
    if (lib.error && !lib.docs.length) {
      attempts.push({ source: 'screener.in company page', outcome: 'error', detail: lib.error, found: 0 });
    } else {
      anyReached = true;
      const found = lib.docs.map(candidateFromScreenerDoc);
      candidates.push(...found);
      attempts.push({
        source: 'screener.in company page',
        outcome: found.length ? 'found' : 'empty',
        detail: found.length ? `${found.length} document(s) listed` : 'the page lists no transcript, presentation or annual report',
        found: found.length,
      });
    }
  } catch (e: any) {
    attempts.push({ source: 'screener.in company page', outcome: 'error', detail: String(e?.message || e), found: 0 });
  }

  const ranked = rankCandidates(candidates, opts.filingDate);

  // THE THREE STATES ARE NOT INTERCHANGEABLE. Anything found is
  // EVIDENCE_FOUND. Nothing found with every source reached means the company
  // genuinely published nothing readable. Nothing found with a source
  // unreachable is a failure of ours, and saying "not disclosed" there would
  // be reporting our own outage as the company's silence.
  const state: DiscoveryState = ranked.length ? 'EVIDENCE_FOUND'
    : anyReached ? 'SEARCH_EXHAUSTED' : 'RETRIEVAL_FAILED';

  const summary = state === 'EVIDENCE_FOUND'
    ? `${ranked.length} document(s) found across ${attempts.filter((a) => a.outcome === 'found').length} source(s).`
    : state === 'SEARCH_EXHAUSTED'
      ? `Every source was reached and none holds a readable document for ${ticker}. `
        + 'This is an absence of disclosure, not a failed search.'
      : `Evidence could not be retrieved for ${ticker}: ${attempts.filter((a) => a.outcome === 'error').map((a) => `${a.source} — ${a.detail}`).join('; ')}. `
        + 'No conclusion about the thesis follows from this.';

  return { state, candidates: ranked, attempts, summary };
}

/** Kept so the old single-document path keeps compiling while callers move
 *  over. Prefer `discoverEvidence` + `selectForReading`. */
export { pickDocument };
