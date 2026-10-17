// zzz1054 — browser side of price alerts: API calls with honest results (a save is "saved" only when the server says so).
import type { AlertEvent, AlertInput, PriceAlert } from './types';

export const ALERTS_API = '/api/v1/price-alerts';
export const ALERTS_CHANGED_EVENT = 'mc:price-alerts:changed';

export interface AlertRow extends PriceAlert { members: number | null; membersLabel: string | null; membersError: string | null }
export interface AlertsPayload {
  ok: boolean; alerts: AlertRow[]; lastRun: any; channels: { telegram: boolean; email: boolean; push?: any }; unread: number; latestId: number; error?: string;
  /** zzz1064 — optional, from the server when it records delivery health per channel */
  delivery?: Record<string, any>;
}
export interface SaveResult { ok: boolean; alert?: PriceAlert; error?: string; conflict?: boolean; status: number }

async function call(body: unknown): Promise<{ status: number; json: any }> {
  try {
    const r = await fetch(ALERTS_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    let json: any = null; try { json = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, json };
  } catch (e: any) {
    return { status: 0, json: { ok: false, error: e?.name === 'TimeoutError' ? 'the server did not answer — not saved' : 'network error — not saved' } };
  }
}
const announce = () => { try { window.dispatchEvent(new CustomEvent(ALERTS_CHANGED_EVENT)); } catch { /* no window */ } };

function saveResult(r: { status: number; json: any }): SaveResult {
  const ok = r.status >= 200 && r.status < 300 && r.json?.ok === true && r.json?.saved !== false;
  if (ok) announce();
  return { ok, alert: r.json?.alert, error: ok ? undefined : (r.json?.error || `not saved (HTTP ${r.status || 'error'})`), conflict: r.status === 409, status: r.status };
}

export async function loadAlerts(): Promise<AlertsPayload> {
  try {
    const r = await fetch(ALERTS_API, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const j = await r.json();
    if (!r.ok || !j?.ok) return { ok: false, alerts: [], lastRun: null, channels: { telegram: false, email: false }, unread: 0, latestId: 0, error: j?.error || `HTTP ${r.status}` };
    return j;
  } catch (e: any) { return { ok: false, alerts: [], lastRun: null, channels: { telegram: false, email: false }, unread: 0, latestId: 0, error: String(e?.message || e) }; }
}
export async function loadEvents(q: Record<string, string | number | undefined> = {}): Promise<{ ok: boolean; events: AlertEvent[]; error?: string }> {
  const sp = new URLSearchParams({ view: 'events' });
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') sp.set(k, String(v));
  try {
    const r = await fetch(`${ALERTS_API}?${sp}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const j = await r.json();
    return r.ok && j?.ok ? { ok: true, events: j.events } : { ok: false, events: [], error: j?.error || `HTTP ${r.status}` };
  } catch (e: any) { return { ok: false, events: [], error: String(e?.message || e) }; }
}
export async function loadChannels(): Promise<{ telegram: boolean; email: boolean } | null> {
  try { const r = await fetch(`${ALERTS_API}?view=channels`, { cache: 'no-store' }); const j = await r.json(); return j?.channels ?? null; } catch { return null; }
}

export const createAlertApi = async (alert: AlertInput) => saveResult(await call({ action: 'create', alert }));
export const updateAlertApi = async (id: string, version: number, alert: AlertInput) => saveResult(await call({ action: 'update', id, version, alert }));
export const pauseAlertApi = async (id: string, version: number, pause: boolean) => saveResult(await call({ action: pause ? 'pause' : 'resume', id, version }));
export const deleteAlertApi = async (id: string) => saveResult(await call({ action: 'delete', id }));
export async function testAlertApi(id: string): Promise<{ ok: boolean; error?: string; notified?: any; report?: string[] }> {
  const r = await call({ action: 'test', id });
  if (r.json?.ok) announce();
  return { ok: !!r.json?.ok, error: r.json?.error, notified: r.json?.notified, report: Array.isArray(r.json?.report) ? r.json.report : undefined };
}
/** zzz1062 — "Send test message" (no alert needed). */
export async function testChannelsApi(): Promise<{ ok: boolean; error?: string; report?: string[] }> {
  const r = await call({ action: 'test-channels' });
  return { ok: !!r.json?.ok, error: r.json?.error, report: Array.isArray(r.json?.report) ? r.json.report : undefined };
}
export async function markReadApi(ids: number[] | 'all'): Promise<boolean> {
  const r = await call({ action: 'read', ids });
  if (r.json?.ok) announce();
  return !!r.json?.ok;
}
export async function checkNowApi(): Promise<any> { const r = await call({ action: 'check' }); announce(); return r.json?.report ?? r.json; }

// ── zzz1064: the bell's feed — every fired alert is consumed exactly once, oldest first ─────────────────────────────────────

export const BELL_CURSOR_KEY = 'mc:alerts-bell-cursor:v1';
export const BELL_PAGE = 100;
export const BELL_MAX_PAGES = 10;

/** A test fire ("TEST · …") — hidden from the log by default and never counted as a burst. */
export const isTestEvent = (e: Pick<AlertEvent, 'message'>): boolean => /^TEST\s*·/.test(String(e.message || ''));

/** One page of events. Ascending pages come oldest first after `afterId`; the fallback pages come newest first before `beforeId`. */
export type EventPage = { events: AlertEvent[]; hasMore?: boolean } | null;
export interface FeedFetchers {
  /** server-side ascending paging (view=bell&afterId&order=asc&limit) — counts only when the answer carries `hasMore` */
  ascending?: (afterId: number, limit: number) => Promise<EventPage>;
  /** newest-first paging (view=events&limit&beforeId) — always available */
  descending: (beforeId: number | undefined, limit: number) => Promise<EventPage>;
}
export interface FeedResult {
  /** new events, OLDEST FIRST, all with id > cursor */
  events: AlertEvent[];
  /** where the next read starts: the newest id actually consumed (never past an event not read) */
  cursor: number;
  /** false when a page failed or the read stopped early — the rest comes next time, in order */
  complete: boolean;
  /** more than pageSize × maxPages arrived at once (newest-first fallback only): the oldest are summarised, all are in the log */
  truncated: boolean;
}

/**
 * Reads every event after `cursor`. Uses the server's ascending pages when it offers them (`hasMore` present), otherwise walks
 * newest-first pages back until it reaches the cursor. A failed newest-first page means "consume nothing" (cursor unchanged),
 * so no event is ever skipped. Pure apart from the fetchers.
 */
export async function collectNewEvents(cursor: number, f: FeedFetchers, pageSize = BELL_PAGE, maxPages = BELL_MAX_PAGES): Promise<FeedResult> {
  if (f.ascending) {
    const first = await f.ascending(cursor, pageSize).catch(() => null);
    if (first && typeof first.hasMore === 'boolean') {
      const out: AlertEvent[] = [];
      let cur = cursor;
      let page: EventPage = first;
      let n = 0;
      while (page) {
        const evs = page.events.filter((e) => e.id > cur).sort((a, b) => a.id - b.id);
        out.push(...evs);
        if (evs.length) cur = evs[evs.length - 1].id;
        n++;
        if (!page.hasMore || !evs.length) return { events: out, cursor: cur, complete: true, truncated: false };
        if (n >= maxPages) return { events: out, cursor: cur, complete: false, truncated: false };
        page = await f.ascending(cur, pageSize).catch(() => null);
      }
      return { events: out, cursor: cur, complete: false, truncated: false };   // a later page failed: the rest next time
    }
  }
  const got: AlertEvent[] = [];
  let before: number | undefined;
  for (let n = 0; n < maxPages; n++) {
    const page = await f.descending(before, pageSize).catch(() => null);
    if (!page) return { events: [], cursor, complete: false, truncated: false };
    const evs = page.events;
    for (const e of evs) if (e.id > cursor) got.push(e);
    const minId = evs.length ? Math.min(...evs.map((e) => e.id)) : 0;
    if (evs.length < pageSize || minId <= cursor + 1) {
      const asc = dedupeAsc(got);
      return { events: asc, cursor: asc.length ? asc[asc.length - 1].id : cursor, complete: true, truncated: false };
    }
    before = minId;
  }
  const asc = dedupeAsc(got);
  return { events: asc, cursor: asc.length ? asc[asc.length - 1].id : cursor, complete: true, truncated: true };
}
function dedupeAsc(evs: AlertEvent[]): AlertEvent[] {
  const m = new Map<number, AlertEvent>();
  for (const e of evs) m.set(e.id, e);
  return [...m.values()].sort((a, b) => a.id - b.id);
}

/** What the bell says for a batch of new fires: one toast each for a few, ONE grouped toast for a burst. Pure. */
export function burstToasts(evs: AlertEvent[], truncated = false, single = 3): { lines: string[]; grouped: string | null } {
  const real = evs.filter((e) => !isTestEvent(e));
  const tests = evs.length - real.length;
  if (!truncated && real.length <= single) {
    return { lines: [...real.map((e) => `🔔 ${e.message}`), ...(tests ? [`🔔 Test alert received${tests > 1 ? ` (${tests})` : ''}`] : [])], grouped: null };
  }
  const tickers = [...new Set(real.map((e) => e.ticker))];
  const names = tickers.slice(0, 4).join(', ') + (tickers.length > 4 ? ` +${tickers.length - 4} more` : '');
  return { lines: [], grouped: `🔔 ${real.length}${truncated ? '+' : ''} price alerts fired — ${names}. Open the bell to see them.` };
}

/** Link to the chart for an event (keeps NSE vs BSE). */
export function chartHrefFor(e: Pick<AlertEvent, 'ticker' | 'market' | 'mid'>): string {
  const ex = e.market === 'US' ? 'US' : String(e.mid || '').startsWith('IN:BSE:') ? 'BSE' : 'NSE';
  return `/charts?symbol=${encodeURIComponent(e.ticker)}&exchange=${ex}`;
}

/** "Rearm" a triggered once-alert. `unsupported` when the server does not know the action yet. */
export async function rearmAlertApi(id: string, version: number): Promise<SaveResult & { unsupported?: boolean }> {
  const r = await call({ action: 'rearm', id, version });
  const unsupported = r.status === 400 && /unknown action/i.test(String(r.json?.error || ''));
  return { ...saveResult(r), unsupported };
}

/** Delivery status of one channel for the summary strip. Reads whatever the server returns; missing = unknown. Pure. */
export interface ChannelStatus { state: 'working' | 'not-set-up' | 'failing' | 'unknown'; reason?: string }
export function channelStatus(name: 'telegram' | 'email' | 'push', payload: any): ChannelStatus {
  const d = payload?.delivery?.[name] ?? payload?.channelHealth?.[name];
  if (d && typeof d === 'object') {
    if (d.ok === false || d.state === 'failing' || d.lastError) return { state: 'failing', reason: String(d.lastError || d.error || d.reason || 'the last send failed').slice(0, 140) };
    if (d.ok === true || d.state === 'working') return { state: 'working' };
  }
  const v = payload?.channels?.[name];
  if (typeof v === 'boolean') return v ? { state: 'working' } : { state: 'not-set-up' };
  if (v && typeof v === 'object') {
    if (v.ready === false || v.configured === false) return { state: 'not-set-up', reason: Array.isArray(v.missing) && v.missing.length ? `missing ${v.missing.join(', ')}` : undefined };
    if (v.lastError) return { state: 'failing', reason: String(v.lastError).slice(0, 140) };
    return { state: 'working' };
  }
  return { state: 'unknown' };
}
/** Per-event delivery marks for the log (✓ / ✗ per channel), when the server records them. Pure. */
export function eventDelivery(e: any): Array<{ channel: string; ok: boolean; error?: string }> {
  const d = e?.delivery;
  if (!d || typeof d !== 'object') return [];
  const out: Array<{ channel: string; ok: boolean; error?: string }> = [];
  for (const [k, v] of Object.entries(d as Record<string, any>)) {
    if (v == null || v === 'skipped' || v === false || (typeof v === 'object' && v.state === 'skipped')) continue;
    const ok = v === true || v === 'sent' || v === 'ok' || (typeof v === 'object' && (v.ok === true || v.state === 'sent'));
    out.push({ channel: k, ok, error: ok ? undefined : String(typeof v === 'object' ? v.error || v.state || 'failed' : v) });
  }
  return out;
}
