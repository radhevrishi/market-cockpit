// zzz1054 — browser side of price alerts: API calls with honest results (a save is "saved" only when the server says so).
import type { AlertEvent, AlertInput, PriceAlert } from './types';

export const ALERTS_API = '/api/v1/price-alerts';
export const ALERTS_CHANGED_EVENT = 'mc:price-alerts:changed';

export interface AlertRow extends PriceAlert { members: number | null; membersLabel: string | null; membersError: string | null }
export interface AlertsPayload {
  ok: boolean; alerts: AlertRow[]; lastRun: any; channels: { telegram: boolean; email: boolean }; unread: number; latestId: number; error?: string;
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
export async function testAlertApi(id: string): Promise<{ ok: boolean; error?: string; notified?: any }> {
  const r = await call({ action: 'test', id });
  if (r.json?.ok) announce();
  return { ok: !!r.json?.ok, error: r.json?.error, notified: r.json?.notified };
}
export async function markReadApi(ids: number[] | 'all'): Promise<boolean> {
  const r = await call({ action: 'read', ids });
  if (r.json?.ok) announce();
  return !!r.json?.ok;
}
export async function checkNowApi(): Promise<any> { const r = await call({ action: 'check' }); announce(); return r.json?.report ?? r.json; }
