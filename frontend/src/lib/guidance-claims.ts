// zzz861 — the GUIDANCE CLAIMS table. A claim is something a secondary source (media, social, analyst copy) says management guided.
// It is DISCOVERY only. This module resolves each claim against the company's own documents, using only what the stores hold:
//   secondary claim → company resolved → primary document found? → read? → numbers compared → VERIFIED / CONTRADICTED / PRIMARY_NOT_FOUND / PRIMARY_NOT_READ / NO_GUIDANCE_IN_DOCUMENT
// Pure: no I/O, no clock, no company names. A claim is never promoted here; verification only happens when a company document that WAS read states the
// same metric and period with numbers that agree. Silence never passes (a document with no guidance for the metric is NO_GUIDANCE_IN_DOCUMENT, not VERIFIED).
import type { GuUniverseRecordX } from './guidance-universe';
import type { GuidanceDocIndexRow, GuidanceExtractResult, ExtractedGuidance } from './guidance-docs-types';
import type { GuQueueItem } from './guidance-upgrades-types';
import { normCompanyName } from './guidance-upgrades-candidates';
import { universeUnitOf } from './guidance-extract-reader';
import type { ClaimCounts } from './guidance-pipeline-coverage';

export type ClaimVerification = 'VERIFIED' | 'CONTRADICTED' | 'PRIMARY_NOT_FOUND' | 'PRIMARY_NOT_READ' | 'NO_GUIDANCE_IN_DOCUMENT' | 'NOT_COMPARABLE';
export type ClaimPrimary = 'FOUND' | 'NOT_FOUND' | 'NOT_YET_FETCHED';
export type ClaimDocument = 'AVAILABLE' | 'PENDING';
export type ClaimProcessing = 'QUEUED' | 'RUNNING' | 'FAILED' | 'DONE' | 'NONE';
/** The processing stage of a filing in the queue (the queue's own statuses mapped onto the pipeline stages). */
export type QueueStage = 'DISCOVERED' | 'LOCATED' | 'FETCHED' | 'READ' | 'EXTRACTED' | 'NO_GUIDANCE' | 'GUIDANCE_FOUND' | 'FAILED' | 'SOURCE_UNAVAILABLE';
export interface GuidanceClaim {
  claim_id: string; company: string; ticker: string | null; market: 'IN' | 'US';
  claimed_metric: string; claimed_period: string; claimed_growth: string; claimed_amount: string | null;
  source_url: string | null; source_date: string | null; secondary_source: string; claim_status: 'AWAITING_PRIMARY' | 'VERIFIED' | 'CONTRADICTED' | 'NO_GUIDANCE_IN_DOCUMENT';
  primary_source_id: string | null; verification_status: ClaimVerification;
  /** actionable status */
  primary: ClaimPrimary; document: ClaimDocument; processing: ClaimProcessing; queue_stage: QueueStage | null; next_action: string;
  primary_source_url: string | null; reason: string;
}
export interface ClaimCtx {
  docs?: GuidanceDocIndexRow[]; extracted?: GuidanceExtractResult[]; queue?: GuQueueItem[];
  /** tickers (upper case) or normalised names the AI verifier contradicted */ contradicted?: string[];
}
const METRIC: Record<string, string[]> = { REVENUE: ['REVENUE'], PAT: ['PAT'], EPS: ['EPS', 'ADJ_EPS'], EBITDA: ['EBITDA'], FCF: ['FCF'] };
const normPeriod = (p: string): string => { const m = /^(FY|CY)\s?(?:20)?(\d{2})$/i.exec(String(p || '').trim()); return m ? `${m[1].toUpperCase()}${m[2]}` : String(p || '').toUpperCase().replace(/\s+/g, ''); };
const near = (a: number, b: number, tol = 0.02): boolean => Math.abs(a - b) <= Math.max(Math.abs(b), 1e-9) * tol;

/** Queue item → pipeline stage. `extracted` = docId → the extract result (when the AI extractor has read that document). */
export function stageOfQueueItem(x: GuQueueItem & { doc_id?: string | null; handoff?: unknown }, extracted?: Map<string, GuidanceExtractResult>): QueueStage {
  const s = x.processing_status;
  if (s === 'SOURCE_UNAVAILABLE') return 'SOURCE_UNAVAILABLE';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'QUEUED') return x.source_url ? 'LOCATED' : 'DISCOVERED';
  if (s === 'READING') return 'FETCHED';
  if (x.result?.complete) return 'GUIDANCE_FOUND';
  const er = x.doc_id ? extracted?.get(x.doc_id) : undefined;
  if (er) return er.rows.length > 0 ? 'GUIDANCE_FOUND' : 'NO_GUIDANCE';
  return x.handoff ? 'READ' : 'NO_GUIDANCE';
}
const stageProcessing = (st: QueueStage | null): ClaimProcessing => (st == null ? 'NONE' : st === 'DISCOVERED' || st === 'LOCATED' ? 'QUEUED' : st === 'FETCHED' || st === 'READ' || st === 'EXTRACTED' ? 'RUNNING' : st === 'FAILED' || st === 'SOURCE_UNAVAILABLE' ? 'FAILED' : 'DONE');

const grow = (r: ExtractedGuidance): [number, number] | null => (r.growthPctLow != null ? [r.growthPctLow, r.growthPctHigh ?? r.growthPctLow] : null);
/** Compare one claim point with one extracted row (same metric + period). VERIFIED when the stated numbers agree, CONTRADICTED when they conflict, null when they cannot be compared. */
export function compareClaim(p: GuUniverseRecordX['points'][number], r: ExtractedGuidance): 'VERIFIED' | 'CONTRADICTED' | null {
  const g = grow(r);
  if (p.statedGrowth && g) { const hi = p.statedGrowth.high ?? p.statedGrowth.low; return near(p.statedGrowth.low, g[0], 0.05) && near(hi, g[1], 0.05) ? 'VERIFIED' : 'CONTRADICTED'; }
  const unit = universeUnitOf(r.currency, r.unit);
  if (p.absolute && unit && unit === p.absolute.unit && r.low != null) {
    const cl = p.absolute.valueLow ?? p.absolute.value, ch = p.absolute.value; const rl = r.low, rh = r.high ?? r.low;
    return near(cl, rl) && near(ch, rh) ? 'VERIFIED' : 'CONTRADICTED';
  }
  return null;
}

export function resolveClaims(rows: GuUniverseRecordX[], ctx: ClaimCtx = {}): GuidanceClaim[] {
  const contra = new Set((ctx.contradicted || []).map((x) => String(x).toUpperCase()));
  const byDoc = new Map<string, GuidanceExtractResult>(); for (const e of ctx.extracted || []) byDoc.set(e.docId, e);
  const out: GuidanceClaim[] = [];
  for (const r of rows) {
    const p = r.points[0]; if (!p) continue;
    const mk = r.record.market === 'US' ? 'US' : 'IN';
    const tk = (r.tickers[0] || r.record.ticker || '').toUpperCase() || null; const nm = normCompanyName(r.record.company);
    const mine = <T extends { market: string; ticker: string | null; company: string }>(d: T) => d.market === mk && ((tk && (d.ticker || '').toUpperCase() === tk) || normCompanyName(d.company) === nm);
    const docs = (ctx.docs || []).filter(mine);
    const results = (ctx.extracted || []).filter(mine);
    const qitems = (ctx.queue || []).filter((x) => x.market === mk && ((tk && (x.ticker || '').toUpperCase() === tk) || normCompanyName(x.company) === nm));
    const stages = qitems.map((x) => ({ x, st: stageOfQueueItem(x as any, byDoc) }));
    const best = stages.sort((a, b) => ORDER.indexOf(b.st) - ORDER.indexOf(a.st))[0] ?? null;
    const want = METRIC[String(p.metric)] || [String(p.metric)]; const wantP = normPeriod(p.period);
    let v: ClaimVerification; let primary: ClaimPrimary; let docState: ClaimDocument; let sourceId: string | null = null; let primaryUrl: string | null = null; let why: string;
    const matched = results.flatMap((e) => e.rows.filter((x) => want.includes(x.metric) && normPeriod(x.period) === wantP).map((x) => ({ e, x })));
    if ([tk, nm.toUpperCase()].some((k) => !!k && contra.has(k as string))) {
      v = 'CONTRADICTED'; primary = 'FOUND'; docState = 'AVAILABLE'; why = "The AI check found the company's own document does not support this claim.";
    } else if (matched.length) {
      const cmp = matched.map((m) => ({ m, c: compareClaim(p, m.x) }));
      const ok = cmp.find((c) => c.c === 'VERIFIED'); const bad = cmp.find((c) => c.c === 'CONTRADICTED');
      const pick = ok ?? bad ?? cmp[0];
      sourceId = pick.m.e.docId; primaryUrl = pick.m.e.docUrl; primary = 'FOUND'; docState = 'AVAILABLE';
      if (ok) { v = 'VERIFIED'; why = 'A company document that was read states the same metric and period with agreeing numbers.'; }
      else if (bad) { v = 'CONTRADICTED'; why = 'A company document that was read states the same metric and period with different numbers.'; }
      else { v = 'NOT_COMPARABLE'; why = 'The company document states this metric and period, but in a unit or form that cannot be compared with the claim; kept for review.'; }
    } else if (results.length) {
      const e = results[0]; sourceId = e.docId; primaryUrl = e.docUrl; primary = 'FOUND'; docState = 'AVAILABLE'; v = 'NO_GUIDANCE_IN_DOCUMENT';
      why = `${results.length === 1 ? 'The company document was' : `${results.length} company documents were`} read and none gives ${String(p.metric).toLowerCase()} guidance for ${p.period}.`;
    } else if (docs.length) {
      const d = docs[0]; sourceId = d.docId; primaryUrl = d.url; primary = 'FOUND'; docState = d.textChars > 0 ? 'AVAILABLE' : 'PENDING'; v = 'PRIMARY_NOT_READ';
      why = 'A company document is on file but has not been read yet.';
    } else {
      primary = best ? 'NOT_YET_FETCHED' : 'NOT_FOUND'; docState = 'PENDING'; v = 'PRIMARY_NOT_FOUND';
      why = best ? 'A filing for this company is queued; it has not been fetched and read yet.' : 'No company document for this company is on file yet.';
    }
    const stage = best?.st ?? null;
    const processing: ClaimProcessing = v === 'VERIFIED' || v === 'CONTRADICTED' || v === 'NO_GUIDANCE_IN_DOCUMENT' || v === 'NOT_COMPARABLE' ? 'DONE' : stageProcessing(stage);
    const next = v === 'VERIFIED' ? 'None: verified; it can move to Active.' : v === 'CONTRADICTED' ? 'None: leave out of every list.' : v === 'NO_GUIDANCE_IN_DOCUMENT' ? 'Look for a later results release, presentation or call transcript.' : v === 'NOT_COMPARABLE' ? 'Review the unit or period by hand.'
      : v === 'PRIMARY_NOT_READ' ? 'Read the document (the AI extractor picks it up on its next run).'
      : processing === 'QUEUED' ? 'Wait: the filing is queued to be fetched and read.' : processing === 'RUNNING' ? 'Wait: the filing is being read.' : processing === 'FAILED' ? 'Retry: the last fetch failed; it is retried with back-off.'
      : 'Collect: add this company to the wanted list so the next collector run looks for its results release, presentation or transcript.';
    out.push({
      claim_id: r.entityKey ? `${r.entityKey}|${p.metric}|${wantP}` : `${mk}:${tk ?? nm}|${p.metric}|${wantP}`, company: r.record.company, ticker: tk, market: mk,
      claimed_metric: String(p.metric), claimed_period: p.period, claimed_growth: p.display, claimed_amount: p.absolute ? `${p.absolute.valueLow != null ? `${p.absolute.valueLow}–` : ''}${p.absolute.value} ${p.absolute.unit}` : null,
      source_url: p.sourceUrl ?? r.sourceUrl ?? null, source_date: p.sourceDate ?? r.sourceDate ?? null, secondary_source: p.sourceName || r.sourceName || 'secondary source',
      claim_status: v === 'VERIFIED' ? 'VERIFIED' : v === 'CONTRADICTED' ? 'CONTRADICTED' : v === 'NO_GUIDANCE_IN_DOCUMENT' ? 'NO_GUIDANCE_IN_DOCUMENT' : 'AWAITING_PRIMARY',
      primary_source_id: sourceId, verification_status: v, primary, document: docState, processing, queue_stage: stage, next_action: next, primary_source_url: primaryUrl, reason: why,
    });
  }
  return out;
}
const ORDER: QueueStage[] = ['SOURCE_UNAVAILABLE', 'FAILED', 'DISCOVERED', 'LOCATED', 'FETCHED', 'READ', 'EXTRACTED', 'NO_GUIDANCE', 'GUIDANCE_FOUND'];

/** Per-market counts the data-quality state is derived from. `verifiedGuidance` = Active rows (verified or derived from company documents). */
export function claimCountsOf(claims: GuidanceClaim[], verifiedGuidance: Record<'IN' | 'US', number>): Record<'IN' | 'US', ClaimCounts> {
  const f = (m: 'IN' | 'US'): ClaimCounts => {
    const c = claims.filter((x) => x.market === m);
    return { claims: c.length, primaryFound: c.filter((x) => x.primary === 'FOUND').length, primaryRead: c.filter((x) => x.verification_status === 'VERIFIED' || x.verification_status === 'CONTRADICTED' || x.verification_status === 'NO_GUIDANCE_IN_DOCUMENT' || x.verification_status === 'NOT_COMPARABLE').length,
      verified: c.filter((x) => x.verification_status === 'VERIFIED').length, contradicted: c.filter((x) => x.verification_status === 'CONTRADICTED').length, verifiedGuidance: verifiedGuidance[m] };
  };
  return { IN: f('IN'), US: f('US') };
}
/** What the collectors should go and fetch: companies whose claim has no primary document yet (or one not yet read). Names come from the claims, never from a list in code. */
export interface WantedCompany { market: 'IN' | 'US'; ticker: string | null; company: string; claims: number; since: string | null; why: 'PRIMARY_NOT_FOUND' | 'PRIMARY_NOT_READ' }
export function wantedFromClaims(claims: GuidanceClaim[], max = 200): WantedCompany[] {
  const m = new Map<string, WantedCompany>();
  for (const c of claims) {
    if (c.verification_status !== 'PRIMARY_NOT_FOUND' && c.verification_status !== 'PRIMARY_NOT_READ') continue;
    const k = `${c.market}:${c.ticker ?? normCompanyName(c.company)}`; const w = m.get(k);
    if (w) { w.claims++; if (c.source_date && (!w.since || c.source_date < w.since)) w.since = c.source_date; if (c.verification_status === 'PRIMARY_NOT_FOUND') w.why = 'PRIMARY_NOT_FOUND'; }
    else m.set(k, { market: c.market, ticker: c.ticker, company: c.company, claims: 1, since: c.source_date, why: c.verification_status });
  }
  return [...m.values()].sort((a, b) => b.claims - a.claims || a.company.localeCompare(b.company)).slice(0, max);
}
export const STAGE_TEXT: Record<QueueStage, string> = { DISCOVERED: 'discovered', LOCATED: 'document located', FETCHED: 'fetched', READ: 'read', EXTRACTED: 'extracted', NO_GUIDANCE: 'read: no guidance', GUIDANCE_FOUND: 'guidance found', FAILED: 'failed (will retry)', SOURCE_UNAVAILABLE: 'source unavailable' };
export function queueStageCounts(items: Array<GuQueueItem & { doc_id?: string | null; handoff?: unknown }>, extracted?: Map<string, GuidanceExtractResult>, market?: 'IN' | 'US'): Record<QueueStage, number> {
  const out = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<QueueStage, number>;
  for (const x of items) if (!market || x.market === market) out[stageOfQueueItem(x, extracted)]++;
  return out;
}
