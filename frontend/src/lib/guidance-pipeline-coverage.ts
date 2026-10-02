// zzz860 — DATA QUALITY of the guidance pipeline, per market, in numbers (pure; the clock is passed in).
// "Failed source is not zero results": a market with a failed / missing source or unprocessed documents is PARTIAL, never COMPLETE, and the page says so.
//   documents discovered  = rows in the collected-documents index for the window
//   documents processed   = those the AI extractor has read (extracted flag)
//   documents pending     = discovered - processed (the queue that feeds extraction -> guidance rows -> events -> universe)
//   days                  = weekdays (trading days, holidays not modelled) in the window, split by what the collectors recorded: ok / partial / failed / not read
import type { Coverage } from './guidance-docs-store';
import type { GuidanceDocIndexRow } from './guidance-docs-types';

export const COVERAGE_WINDOW_DAYS = 120;
export type GuCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'NO_DATA';
export interface GuSourceHealth { name: string; ok: boolean; documents: number }
export interface GuMarketQuality {
  market: 'IN' | 'US'; status: GuCoverageStatus; windowDays: number; tradingDays: number;
  daysFullyCovered: number; daysPartial: number; daysFailed: number; daysNotRead: number;
  documentsDiscovered: number; documentsProcessed: number; documentsPending: number;
  sources: GuSourceHealth[]; line: string; lastCoverageAt: string | null;
}
export interface GuDataQuality { windowDays: number; markets: { IN: GuMarketQuality; US: GuMarketQuality }; exhaustive: boolean; footnote: string | null }
export const NOT_EXHAUSTIVE = 'Guidance counts are not exhaustive until the pending primary documents are processed.';

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

export function marketQuality(market: 'IN' | 'US', rows: GuidanceDocIndexRow[], coverage: Coverage | null | undefined, now: Date, windowDays = COVERAGE_WINDOW_DAYS): GuMarketQuality {
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
  // A source is OK when documents from it are in the index (a collector that never reached it has none). Sources are never guessed.
  const sources: GuSourceHealth[] = EXPECTED[market].map((name) => ({ name, ok: (byHost.get(name) || 0) > 0, documents: byHost.get(name) || 0 }));
  const pending = inWin.length - processed;
  const status: GuCoverageStatus = !inWin.length && !days.some((d) => coverage?.days?.[d]) ? 'NO_DATA' : sources.every((s) => s.ok) && pending === 0 && failed === 0 && partial === 0 && notRead === 0 ? 'COMPLETE' : 'PARTIAL';
  const label = market === 'IN' ? 'INDIA' : 'USA';
  const line = status === 'NO_DATA' ? `${label} — NO DATA: no documents collected in the last ${windowDays} days (the collector has not run, or every source failed)`
    : `${label} — ${status}: ${sources.map((s) => `${s.name} ${s.ok ? '✓' : '✕'}`).join(' | ')} | ${pending} document${pending === 1 ? '' : 's'} pending`;
  return { market, status, windowDays, tradingDays: days.length, daysFullyCovered: ok, daysPartial: partial, daysFailed: failed, daysNotRead: notRead,
    documentsDiscovered: inWin.length, documentsProcessed: processed, documentsPending: pending, sources, line, lastCoverageAt: last };
}
export function dataQualityOf(rows: GuidanceDocIndexRow[], cov: { IN?: Coverage | null; US?: Coverage | null }, now: Date, windowDays = COVERAGE_WINDOW_DAYS): GuDataQuality {
  const IN = marketQuality('IN', rows, cov.IN, now, windowDays); const US = marketQuality('US', rows, cov.US, now, windowDays);
  const exhaustive = IN.status === 'COMPLETE' && US.status === 'COMPLETE';
  return { windowDays, markets: { IN, US }, exhaustive, footnote: exhaustive ? null : NOT_EXHAUSTIVE };
}
