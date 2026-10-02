// zzz860 — DATA QUALITY of the guidance pipeline, per market, in numbers (pure; the clock is passed in).
// "Failed source is not zero results": a market with a failed / missing source or unprocessed documents is PARTIAL, never COMPLETE, and the page says so.
//   documents discovered  = rows in the collected-documents index for the window
//   documents processed   = those the AI extractor has read (extracted flag)
//   documents pending     = discovered - processed (the queue that feeds extraction -> guidance rows -> events -> universe)
//   days                  = weekdays (trading days, holidays not modelled) in the window, split by what the collectors recorded: ok / partial / failed / not read
import type { Coverage } from './guidance-docs-store';
import type { GuidanceDocIndexRow } from './guidance-docs-types';
import { pipelineStateOf, type GuCoverageStatus, type GuPipelineInput, type GuSourceLine, type GuSourceState } from './guidance-pipeline-state';
import type { PipelineSnapshot } from './guidance-pipeline-snapshot';

export const COVERAGE_WINDOW_DAYS = 120;
export type { GuCoverageStatus };
export interface GuSourceHealth { name: string; ok: boolean; documents: number; state?: GuSourceLine['state']; detail?: string | null }
export interface GuMarketQuality {
  market: 'IN' | 'US'; status: GuCoverageStatus; windowDays: number; tradingDays: number;
  daysFullyCovered: number; daysPartial: number; daysFailed: number; daysNotRead: number;
  documentsDiscovered: number; documentsProcessed: number; documentsPending: number;
  sources: GuSourceHealth[]; line: string; lastCoverageAt: string | null;
  /** zzz861: the distinct pipeline state (never a bare NO DATA), the reasons in plain words, and the plain numbers the state was derived from (the route adds the claim counts) */
  state: GuSourceState; reasons: string[]; nse: number | null; bse: number | null; inputs: GuPipelineInput;
}
export interface GuDataQuality { windowDays: number; markets: { IN: GuMarketQuality; US: GuMarketQuality }; exhaustive: boolean; footnote: string | null }
export const NOT_EXHAUSTIVE = 'Guidance counts are not exhaustive until the pending primary documents are processed.';
export function dataQualityFrom(IN: GuMarketQuality, US: GuMarketQuality, windowDays = COVERAGE_WINDOW_DAYS): GuDataQuality { const exhaustive = IN.status === 'COMPLETE' && US.status === 'COMPLETE'; return { windowDays, markets: { IN, US }, exhaustive, footnote: exhaustive ? null : NOT_EXHAUSTIVE }; }

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function tradingDaysBetween(startIso: string, endIso: string): string[] {
  const out: string[] = []; const s = Date.parse(`${startIso}T00:00:00Z`), e = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return out;
  for (let t = s; t <= e; t += DAY) { const g = new Date(t).getUTCDay(); if (g !== 0 && g !== 6) out.push(iso(new Date(t))); }
  return out;
}
/** The exchange / regulator a document URL belongs to. Unknown hosts are 'other'. */
export function sourceOfUrl(url: string | null | undefined, market: 'IN' | 'US'): string {
  const u = String(url || '').toLowerCase();
  if (/nseindia\.com/.test(u)) return 'NSE'; if (/bseindia\.com/.test(u)) return 'BSE'; if (/sec\.gov/.test(u)) return 'SEC';
  return market === 'IN' ? 'other' : 'other';
}
const EXPECTED: Record<'IN' | 'US', string[]> = { IN: ['NSE', 'BSE'], US: ['SEC'] };

export interface QualityExtras { snapshot?: PipelineSnapshot | null; claims?: Partial<Record<'IN' | 'US', ClaimCounts>> }
export interface ClaimCounts { claims: number; primaryFound: number; primaryRead: number; verified: number; contradicted: number; verifiedGuidance: number }
const ZERO_CLAIMS: ClaimCounts = { claims: 0, primaryFound: 0, primaryRead: 0, verified: 0, contradicted: 0, verifiedGuidance: 0 };

export function marketQuality(market: 'IN' | 'US', rows: GuidanceDocIndexRow[], coverage: Coverage | null | undefined, now: Date, windowDays = COVERAGE_WINDOW_DAYS, extras: QualityExtras = {}): GuMarketQuality {
  const end = iso(now); const start = iso(new Date(now.getTime() - windowDays * DAY));
  const inWin = rows.filter((r) => r.market === market && String(r.filedAt || '').slice(0, 10) >= start);
  const processed = inWin.filter((r) => r.extracted === true).length;
  const days = tradingDaysBetween(start, end);
  let ok = 0, partial = 0, failed = 0, notRead = 0; let last: string | null = null;
  for (const d of days) {
    const c = coverage?.days?.[d];
    if (!c) notRead++; else { if (c.status === 'ok') ok++; else if (c.status === 'partial') partial++; else failed++; if (c.at && (!last || c.at > last)) last = c.at; }
  }
  const byHost = new Map<string, number>();
  for (const r of inWin) { const s = sourceOfUrl(r.url, market); byHost.set(s, (byHost.get(s) || 0) + 1); }
  const snap = extras.snapshot?.markets?.[market] ?? null;
  // Sources: the last exchange scan (it knows failed vs answered) merged with the collected-document counts. A failed source never blocks another.
  const lines = new Map<string, GuSourceLine>();
  for (const s of snap?.sources ?? []) lines.set(s.name, { ...s });
  for (const name of EXPECTED[market]) {
    const docs = byHost.get(name) || 0; const prev = lines.get(name);
    if (prev) lines.set(name, { ...prev, documents: Math.max(prev.documents, docs), state: docs > 0 && prev.state === 'FAILED' ? 'PARTIAL' : prev.state });
    else lines.set(name, { name, state: docs > 0 ? 'OK' : snap ? 'NOT_RUN' : 'NOT_RUN', documents: docs, daysOk: 0, daysTried: 0, detail: null });
  }
  const sources = [...lines.values()].sort((a, b) => (EXPECTED[market].indexOf(a.name) + 99 * Number(!EXPECTED[market].includes(a.name))) - (EXPECTED[market].indexOf(b.name) + 99 * Number(!EXPECTED[market].includes(b.name))));
  const cc = extras.claims?.[market] ?? ZERO_CLAIMS;
  const q = snap?.queue;
  const input: GuPipelineInput = {
    market, sources, scanAt: snap?.scanAt ?? null, servedFromStaleCache: snap?.servedFromStaleCache ?? false, staleCacheSavedAt: snap?.staleCacheSavedAt ?? null,
    documentsDiscovered: inWin.length, documentsProcessed: processed, documentsPending: inWin.length - processed,
    queueAwaiting: q?.awaiting ?? 0, queueReadNoGuidance: q?.readNoGuidance ?? 0, queueUnavailable: q?.unavailable ?? 0,
    claims: cc.claims, claimsPrimaryFound: cc.primaryFound, claimsPrimaryRead: cc.primaryRead, claimsVerified: cc.verified, claimsContradicted: cc.contradicted,
    verifiedGuidance: cc.verifiedGuidance, processedNoGuidance: 0,
    daysFailed: failed + (snap?.daysFailed ?? 0), daysPartial: partial + (snap?.daysPartial ?? 0), daysNotRead: coverage ? notRead : 0, tradingDays: days.length,
  };
  return qualityFromInput(input, { windowDays, ok, partial, failed, notRead, inWin: inWin.length, processed, last });
}
/** Re-derive a market's quality after the claim counts are known (the route calls this; same rules, more evidence). */
export function withClaimCounts(q: GuMarketQuality, cc: ClaimCounts): GuMarketQuality {
  return qualityFromInput({ ...q.inputs, claims: cc.claims, claimsPrimaryFound: cc.primaryFound, claimsPrimaryRead: cc.primaryRead, claimsVerified: cc.verified, claimsContradicted: cc.contradicted, verifiedGuidance: cc.verifiedGuidance },
    { windowDays: q.windowDays, ok: q.daysFullyCovered, partial: q.daysPartial, failed: q.daysFailed, notRead: q.daysNotRead, inWin: q.documentsDiscovered, processed: q.documentsProcessed, last: q.lastCoverageAt });
}
function qualityFromInput(input: GuPipelineInput, d: { windowDays: number; ok: number; partial: number; failed: number; notRead: number; inWin: number; processed: number; last: string | null }): GuMarketQuality {
  const st = pipelineStateOf(input);
  return {
    market: input.market, status: st.status, windowDays: d.windowDays, tradingDays: input.tradingDays,
    daysFullyCovered: d.ok, daysPartial: d.partial, daysFailed: d.failed, daysNotRead: d.notRead,
    documentsDiscovered: d.inWin, documentsProcessed: d.processed, documentsPending: input.documentsPending,
    sources: st.sources.map((s) => ({ name: s.name, ok: s.state === 'OK' || s.state === 'PARTIAL', documents: s.documents, state: s.state, detail: s.detail })),
    line: st.headline, lastCoverageAt: d.last, state: st.state, reasons: st.reasons, nse: st.nse, bse: st.bse, inputs: input,
  };
}
export function dataQualityOf(rows: GuidanceDocIndexRow[], cov: { IN?: Coverage | null; US?: Coverage | null }, now: Date, windowDays = COVERAGE_WINDOW_DAYS, extras: QualityExtras = {}): GuDataQuality {
  const IN = marketQuality('IN', rows, cov.IN, now, windowDays, extras); const US = marketQuality('US', rows, cov.US, now, windowDays, extras);
  const exhaustive = IN.status === 'COMPLETE' && US.status === 'COMPLETE';
  return { windowDays, markets: { IN, US }, exhaustive, footnote: exhaustive ? null : NOT_EXHAUSTIVE };
}
