// zzz862 — the WATCH SET: every company that already has a guidance record (active, under review, or a claim waiting for its company document).
// A new company filing from a watched company is the one that can change a guidance figure, so it is read FIRST, automatically, with no manual step:
//   filing seen -> queued P0 (events queue) -> read -> stored as a company document -> AI extractor reads watched documents first -> universe + events update.
// The universe route saves the set after each build (counts of companies, never any holding); the events route and the extractor read it.
// Pure helpers + a never-throwing KV reader / writer. Nothing here names a company.
import { normCompanyName } from './guidance-upgrades-candidates';
import type { GuQueueItem } from './guidance-upgrades-types';

export const WATCH_KEY = 'guidance-pipeline:watch:v1';
export const WATCH_TTL_S = 14 * 86_400;
export const WATCH_MAX = 1500;
export interface WatchSet { at: string; IN: { tickers: string[]; names: string[] }; US: { tickers: string[]; names: string[] } }
export const emptyWatch = (): WatchSet => ({ at: '', IN: { tickers: [], names: [] }, US: { tickers: [], names: [] } });
export interface WatchSubject { market: 'IN' | 'US' | string; ticker?: string | null; company?: string | null }

export function watchOf(subjects: readonly WatchSubject[], now: Date = new Date()): WatchSet {
  const w = emptyWatch(); w.at = now.toISOString();
  const seen = { IN: { t: new Set<string>(), n: new Set<string>() }, US: { t: new Set<string>(), n: new Set<string>() } };
  for (const s of subjects) {
    const m: 'IN' | 'US' = s.market === 'US' ? 'US' : 'IN';
    const t = String(s.ticker || '').toUpperCase().trim(); const n = normCompanyName(s.company);
    if (t && !seen[m].t.has(t) && seen[m].t.size < WATCH_MAX) { seen[m].t.add(t); w[m].tickers.push(t); }
    if (n && !seen[m].n.has(n) && seen[m].n.size < WATCH_MAX) { seen[m].n.add(n); w[m].names.push(n); }
  }
  return w;
}
export function validWatch(v: any): WatchSet | null {
  if (!v || typeof v !== 'object' || !v.IN || !v.US || !Array.isArray(v.IN.tickers) || !Array.isArray(v.US.tickers)) return null;
  return { at: String(v.at || ''), IN: { tickers: v.IN.tickers.map(String), names: Array.isArray(v.IN.names) ? v.IN.names.map(String) : [] }, US: { tickers: v.US.tickers.map(String), names: Array.isArray(v.US.names) ? v.US.names.map(String) : [] } };
}
/** A set with ticker + name lookups, built once per run. */
export function watchMatcher(w: WatchSet | null | undefined): (s: WatchSubject) => boolean {
  if (!w) return () => false;
  const sets = { IN: { t: new Set(w.IN.tickers), n: new Set(w.IN.names) }, US: { t: new Set(w.US.tickers), n: new Set(w.US.names) } };
  return (s) => { const m: 'IN' | 'US' = s.market === 'US' ? 'US' : 'IN'; const t = String(s.ticker || '').toUpperCase().trim(); const n = normCompanyName(s.company); return (!!t && sets[m].t.has(t)) || (!!n && sets[m].n.has(n)); };
}
/** A subject line that can carry guidance: results, outcome of a board meeting, presentation, call / transcript, press / earnings release, investor meet. */
export const GUIDANCE_BEARING_SUBJECT = /result|outcome of (?:the )?board|presentation|transcript|con(?:ference)?\.? call|earnings|investor (?:meet|call|day)|analyst|press release|media release|guidance|outlook|agm/i;
/** Promote waiting queue items of watched companies to P0 (never demotes). Returns how many moved. Pure on a copy the caller owns. */
export function promoteWatched(items: GuQueueItem[], isWatched: (s: WatchSubject) => boolean): number {
  let n = 0;
  for (const x of items) {
    if (x.priority === 'P0') continue;
    if (x.processing_status !== 'QUEUED' && x.processing_status !== 'FAILED') continue;
    if (!isWatched({ market: x.market, ticker: x.ticker, company: x.company })) continue;
    if (!GUIDANCE_BEARING_SUBJECT.test(`${x.subject} ${x.source_type}`)) continue;
    x.priority = 'P0'; n++;
  }
  return n;
}
export async function readWatch(): Promise<WatchSet | null> { try { const { kvGet } = await import('./kv'); return validWatch(await kvGet<WatchSet>(WATCH_KEY)); } catch { return null; } }
export async function writeWatch(w: WatchSet): Promise<boolean> { try { const { kvSet } = await import('./kv'); await kvSet(WATCH_KEY, w, WATCH_TTL_S); return true; } catch { return false; } }

// zzz865 — REQUESTED NAMES: company names the owner typed into the Coverage check. They join the watch set (both markets, by name), so their filings are queued first and read first.
// Company names only (public information, never a holding). Bounded, validated, never throws.
export const REQUEST_KEY = 'guidance-pipeline:requested:v1';
export const REQUEST_MAX = 300;
export function cleanRequestedNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = []; const seen = new Set<string>();
  for (const x of v) {
    const raw = String(x ?? '').trim(); if (raw.length < 3 || raw.length > 80 || !/^[\p{L}\p{N}&.\-' ]+$/u.test(raw)) continue;
    const k = normCompanyName(raw); if (!k || seen.has(k)) continue;
    seen.add(k); out.push(k); if (out.length >= REQUEST_MAX) break;
  }
  return out;
}
export async function readRequested(): Promise<string[]> { try { const { kvGet } = await import('./kv'); return cleanRequestedNames(await kvGet<string[]>(REQUEST_KEY)); } catch { return []; } }
export async function addRequested(names: unknown): Promise<string[] | null> {
  try { const { kvGet, kvSet } = await import('./kv'); const cur = cleanRequestedNames(await kvGet<string[]>(REQUEST_KEY)); const merged = cleanRequestedNames([...cur, ...cleanRequestedNames(names)]); await kvSet(REQUEST_KEY, merged, 90 * 86_400); return merged; } catch { return null; }
}
/** Merge requested names into a watch set (both markets, names only). */
export function withRequested(w: WatchSet, names: readonly string[]): WatchSet {
  const add = (arr: string[]) => { const s = new Set(arr); for (const n of names) if (s.size < WATCH_MAX + REQUEST_MAX) s.add(n); return [...s]; };
  return { ...w, IN: { ...w.IN, names: add(w.IN.names) }, US: { ...w.US, names: add(w.US.names) } };
}
