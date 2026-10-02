// zzz861 — the PIPELINE STATE of each market, from every real source of evidence (pure; nothing here names a company or reads a clock).
// Replaces the binary NO DATA. A market is described by what the backend actually holds:
//   the exchange scan (NSE / BSE / SEC feeds, last run)   → guidance-pipeline-snapshot (written by the events route every run)
//   the collected-documents store (guidance-docs:v1:*)    → rows + per-day coverage
//   the subject-only filings queue                          → documents still to read
//   the claims table + verified Active records              → claims awaiting a primary document, verified guidance
// Rules: a failed source is never "zero results"; a stale cache may DISCOVER but never counts as fresh verification; one failed source never blocks the others.
export type GuSourceState =
  | 'NO_SOURCE_DATA' | 'SOURCE_FAILED' | 'SOURCE_PARTIAL' | 'SOURCE_STALE'
  | 'DOCUMENTS_DISCOVERED_NOT_PROCESSED' | 'DOCUMENTS_PROCESSED_NO_GUIDANCE' | 'GUIDANCE_DISCOVERED_NOT_VERIFIED' | 'GUIDANCE_VERIFIED';
export type GuCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'PRIMARY_PENDING' | 'SOURCE_FAILED' | 'STALE' | 'NO_SOURCE_DATA';
export type GuSourceRowState = 'OK' | 'PARTIAL' | 'FAILED' | 'STALE' | 'EMPTY' | 'NOT_RUN';
export interface GuSourceLine { name: string; state: GuSourceRowState; documents: number; daysOk: number; daysTried: number; detail: string | null }
export interface GuPipelineInput {
  market: 'IN' | 'US';
  /** the last exchange scan, when one was recorded */
  sources: GuSourceLine[]; scanAt: string | null; servedFromStaleCache: boolean; staleCacheSavedAt: string | null;
  documentsDiscovered: number; documentsProcessed: number; documentsPending: number;
  queueAwaiting: number; queueReadNoGuidance: number; queueUnavailable: number;
  claims: number; claimsPrimaryFound: number; claimsPrimaryRead: number; claimsVerified: number; claimsContradicted: number;
  verifiedGuidance: number; processedNoGuidance: number;
  daysFailed: number; daysPartial: number; daysNotRead: number; tradingDays: number;
}
export interface GuPipelineState {
  state: GuSourceState; status: GuCoverageStatus; headline: string; sources: GuSourceLine[];
  /** the blocking reasons, one sentence each, in plain words */ reasons: string[];
  nse: number | null; bse: number | null;
}
export const STATE_TEXT: Record<GuSourceState, string> = {
  NO_SOURCE_DATA: 'no source has been read yet',
  SOURCE_FAILED: 'every source failed (this says nothing about whether guidance exists)',
  SOURCE_PARTIAL: 'some sources answered, some failed',
  SOURCE_STALE: 'only a saved copy is available (used to discover, never to verify)',
  DOCUMENTS_DISCOVERED_NOT_PROCESSED: 'documents found, not read yet',
  DOCUMENTS_PROCESSED_NO_GUIDANCE: 'documents read, no guidance in them',
  GUIDANCE_DISCOVERED_NOT_VERIFIED: 'guidance claims found, company documents not yet verified',
  GUIDANCE_VERIFIED: 'verified guidance on file',
};
const MK = { IN: 'INDIA', US: 'USA' } as const;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const mark = (s: GuSourceLine) => (s.state === 'OK' ? '✓' : s.state === 'PARTIAL' ? '◐' : s.state === 'STALE' ? '⏱' : s.state === 'EMPTY' ? '∅' : '✕');

export function pipelineStateOf(i: GuPipelineInput): GuPipelineState {
  const live = i.sources.filter((s) => s.state === 'OK' || s.state === 'PARTIAL');
  const failed = i.sources.filter((s) => s.state === 'FAILED');
  const stale = i.sources.filter((s) => s.state === 'STALE');
  const anySourceRows = i.sources.some((s) => s.documents > 0);
  const anyEvidence = i.documentsDiscovered > 0 || i.queueAwaiting > 0 || i.queueReadNoGuidance > 0 || i.claims > 0 || i.verifiedGuidance > 0 || anySourceRows || i.scanAt != null;
  const pending = i.documentsPending + i.queueAwaiting;
  const claimsOpen = Math.max(0, i.claims - i.claimsVerified - i.claimsContradicted);
  const reasons: string[] = [];
  let state: GuSourceState; let status: GuCoverageStatus;
  if (!anyEvidence) { state = 'NO_SOURCE_DATA'; status = 'NO_SOURCE_DATA'; reasons.push('Nothing has been collected or scanned for this market yet.'); }
  else if (!live.length && failed.length && stale.length === 0 && i.documentsDiscovered === 0 && i.claims === 0 && i.verifiedGuidance === 0 && !anySourceRows) {
    state = 'SOURCE_FAILED'; status = 'SOURCE_FAILED'; reasons.push(`Every source failed (${failed.map((s) => s.name).join(', ')}).`);
  } else if (!live.length && (stale.length > 0 || i.servedFromStaleCache) && i.documentsDiscovered === 0 && i.verifiedGuidance === 0) {
    state = 'SOURCE_STALE'; status = 'STALE'; reasons.push(`Only a saved copy is available${i.staleCacheSavedAt ? ` (saved ${i.staleCacheSavedAt.slice(0, 16).replace('T', ' ')} UTC)` : ''}; it can discover documents but cannot verify guidance.`);
  } else {
    if (i.verifiedGuidance > 0) state = 'GUIDANCE_VERIFIED';
    else if (i.claims > 0) state = 'GUIDANCE_DISCOVERED_NOT_VERIFIED';
    else if (pending > 0) state = 'DOCUMENTS_DISCOVERED_NOT_PROCESSED';
    else if (i.documentsProcessed > 0 || i.processedNoGuidance > 0 || i.queueReadNoGuidance > 0) state = 'DOCUMENTS_PROCESSED_NO_GUIDANCE';
    else state = failed.length || i.daysFailed > 0 || i.daysPartial > 0 ? 'SOURCE_PARTIAL' : 'DOCUMENTS_PROCESSED_NO_GUIDANCE';
    const blocked = i.verifiedGuidance === 0 && (claimsOpen > 0 || pending > 0);
    if (failed.length) reasons.push(`${failed.map((s) => s.name).join(' and ')} ${failed.length === 1 ? 'did' : 'do'} not answer; the other sources keep running.`);
    if (stale.length || i.servedFromStaleCache) reasons.push('A saved copy of one feed is in use; it is used to discover, not to verify.');
    if (pending > 0) reasons.push(`${plural(pending, 'document')} still to be read.`);
    if (claimsOpen > 0) reasons.push(`${plural(claimsOpen, 'claim')} waiting for a company document.`);
    status = blocked ? 'PRIMARY_PENDING' : failed.length || stale.length || i.daysFailed > 0 || i.daysPartial > 0 || i.daysNotRead > 0 || pending > 0 || claimsOpen > 0 ? 'PARTIAL' : 'COMPLETE';
  }
  const nse = i.sources.find((s) => s.name === 'NSE'); const bse = i.sources.find((s) => s.name === 'BSE');
  const lead = status === 'PRIMARY_PENDING' ? 'PRIMARY VERIFICATION PENDING' : status === 'NO_SOURCE_DATA' ? 'NO SOURCE DATA' : status === 'SOURCE_FAILED' ? 'SOURCE FAILED' : status === 'STALE' ? 'STALE (saved copy only)' : status;
  const tail = [`${plural(pending, 'document')} pending`, `${plural(i.claims, 'claim')}`, `${i.verifiedGuidance} verified`];
  const head = i.sources.length ? `${i.sources.map((s) => `${s.name} ${mark(s)}${s.documents ? ` ${s.documents}` : ''}`).join(' | ')} | ` : '';
  const headline = `${MK[i.market]} — ${lead}: ${head}${tail.join(' | ')}`;
  return { state, status, headline, sources: i.sources, reasons, nse: nse ? nse.documents : null, bse: bse ? bse.documents : null };
}
