// zzz1061 — where the signal conditions (signals.ts) get their data (server only). Read only for the markets and sources that an
// active alert with a signal condition needs, only while that market's session is open (the checker does nothing otherwise).
//
//   screen   — the screener snapshot of the market, from lib/screener/snapshot-cache (ONE shared in-memory copy; after 60 s only
//              the tiny built_at is read from Postgres, the rows only when a new build was written). version = builtAt, so the
//              signals are worked out again only when the snapshot changes (India every 20 min, USA 4× a day).
//   results  — graded results of today and the previous session: India Earnings Opportunities (KV graded:<date>, read the same
//              way as the earnings alerts) / US graded-us (KV us-graded:<engine>:<date>|1). At most every 30 minutes per market
//              → ≤ 8 Redis reads an hour, and none at all unless an alert uses a results condition.
//   guidance — verified formal guidance upgrades (Postgres intel_event, archived hourly), dated in the last 7 days; one query
//              per 30 minutes for both markets.
// A failed read keeps the last good copy; with none, the source is "not available" and its conditions wait.
import { getSnapshot } from '@/lib/screener/snapshot-cache';
import { marketDate } from './session';
import { rowIndex, contentStamp, type SignalFeeds, type SignalRow, type SignalSource, type SourceView, type ResultTier } from './signals';
import type { AlertMarket } from './types';
import type { SnapshotData } from '@/lib/screener/snapshot-cache';

export const RESULTS_TTL_MS = 30 * 60_000;
export const GUIDANCE_TTL_MS = 30 * 60_000;

const g = globalThis as any;
interface Cached<T> { at: number; view: SourceView<T> | null }
const resultsCache: Map<AlertMarket, Cached<ResultTier>> = g.__MC_PA_RESULTS__ || (g.__MC_PA_RESULTS__ = new Map());
const guidanceCache: { c: Cached<true> | null; byMarket: Map<AlertMarket, SourceView<true>> } = g.__MC_PA_GUIDE__ || (g.__MC_PA_GUIDE__ = { c: null, byMarket: new Map() });
const screenViews = new WeakMap<SnapshotData, SourceView<SignalRow>>();

/** The snapshot as a lookup view (made once per snapshot object). */
export function screenView(snap: SnapshotData): SourceView<SignalRow> {
  const hit = screenViews.get(snap);
  if (hit) return hit;
  const get = rowIndex(snap.rows as unknown as SignalRow[]);
  const view: SourceView<SignalRow> = { version: `snap:${snap.builtAt}`, get };
  screenViews.set(snap, view);
  return view;
}

/** ticker → best tier view of graded rows (BLOCKBUSTER beats STRONG). */
export function resultsView(payloads: any[]): SourceView<ResultTier> {
  const m = new Map<string, ResultTier>();
  for (const p of payloads) {
    for (const tier of ['STRONG', 'BLOCKBUSTER'] as const) {
      const rows = p?.by_tier?.[tier];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const t = String(r?.ticker || '').toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '').trim();
        if (t && (tier === 'BLOCKBUSTER' || !m.has(t))) m.set(t, tier);
      }
    }
  }
  return { version: `res:${contentStamp(m)}`, get: (t) => m.get(t.toUpperCase()) ?? null };
}

function prevWeekday(date: string): string {
  let t = Date.parse(`${date}T00:00:00Z`);
  for (let i = 0; i < 5; i++) { t -= 86_400_000; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) break; }
  return new Date(t).toISOString().slice(0, 10);
}

async function readResults(market: AlertMarket, now: Date): Promise<SourceView<ResultTier> | null> {
  const hit = resultsCache.get(market);
  if (hit && Date.now() - hit.at < RESULTS_TTL_MS) return hit.view;
  const today = marketDate(market, now);
  const dates = [today, prevWeekday(today)];
  let view: SourceView<ResultTier> | null = null;
  try {
    if (market === 'IN') {
      const { readGradedDay } = await import('@/lib/india-earnings-alert-data');
      const days = await Promise.all(dates.map((d) => readGradedDay(d)));
      view = resultsView(days.map((d) => d.payload).filter(Boolean));
    } else {
      const [{ kvGet }, { US_ENGINE_VERSION }, { gunzipSync }] = await Promise.all([import('@/lib/kv'), import('@/lib/us-engine-version'), import('node:zlib')]);
      const unzip = (raw: any): any => {
        if (!raw) return null;
        if (typeof raw?.z === 'string') { try { return JSON.parse(gunzipSync(Buffer.from(raw.z, 'base64')).toString('utf8')); } catch { return null; } }
        return raw?.by_tier ? raw : null;
      };
      const raw = await Promise.all(dates.map((d) => kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${d}|1`)));
      view = resultsView(raw.map(unzip).filter(Boolean));
    }
  } catch (e: any) {
    console.warn('[price-alerts] results read failed', market, e?.message || e);
    view = hit?.view ?? null;   // keep the last good copy
  }
  resultsCache.set(market, { at: Date.now(), view });
  return view;
}

async function readGuidance(market: AlertMarket): Promise<SourceView<true> | null> {
  const c = guidanceCache.c;
  if (!c || Date.now() - c.at >= GUIDANCE_TTL_MS) {
    try {
      const { dbQuery } = await import('@/lib/db');
      const rows = await dbQuery<{ market: string; ticker: string }>(
        `SELECT market, ticker FROM intel_event WHERE event_type = 'GUIDANCE_FORMAL_UPGRADE' AND status = 'CARD' AND ticker IS NOT NULL
           AND coalesce(event_date, first_seen::date) >= current_date - 7`, []);
      const by = new Map<AlertMarket, Map<string, string>>([['IN', new Map()], ['US', new Map()]]);
      for (const r of rows) {
        const mk = String(r.market || '').toUpperCase();
        const m: AlertMarket | null = mk === 'IN' || mk === 'INDIA' ? 'IN' : mk === 'US' || mk === 'USA' ? 'US' : null;
        if (m) by.get(m)!.set(String(r.ticker).toUpperCase().replace(/^(NSE|BSE):/, ''), '1');
      }
      guidanceCache.byMarket.clear();
      for (const [m, map] of by) guidanceCache.byMarket.set(m, { version: `gu:${contentStamp(map)}`, get: (t) => (map.has(t.toUpperCase()) ? true : null) });
      guidanceCache.c = { at: Date.now(), view: null };
    } catch (e: any) {
      console.warn('[price-alerts] guidance read failed', e?.message || e);
      guidanceCache.c = { at: Date.now() - GUIDANCE_TTL_MS + 5 * 60_000, view: null };   // try again in 5 minutes; keep the last copy
    }
  }
  return guidanceCache.byMarket.get(market) ?? null;
}

/** The data views each market needs. Never throws; an unavailable source is simply absent (its conditions wait). */
export async function readSignalFeeds(needs: Map<AlertMarket, Set<SignalSource>>, now: Date): Promise<Map<AlertMarket, SignalFeeds>> {
  const out = new Map<AlertMarket, SignalFeeds>();
  await Promise.all([...needs].map(async ([market, srcs]) => {
    const f: SignalFeeds = {};
    await Promise.all([
      srcs.has('screen') ? getSnapshot(market).then((s) => { f.screen = s ? screenView(s) : null; }).catch(() => { f.screen = null; }) : null,
      srcs.has('results') ? readResults(market, now).then((v) => { f.results = v; }) : null,
      srcs.has('guidance') ? readGuidance(market).then((v) => { f.guidance = v; }) : null,
    ]);
    out.set(market, f);
  }));
  return out;
}
