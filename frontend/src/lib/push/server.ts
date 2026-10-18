// zzz1063 — Web Push (VAPID) on the server. The contract (routes, payload) is in lib/push/contract.ts.
//
// Keys: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY from Railway when set; otherwise a key pair is made ONCE and kept in Postgres
// (push_vapid, a single row; a race between two server copies is settled by INSERT … ON CONFLICT DO NOTHING + read back), so
// push works with no owner action. Changing the keys later makes every saved subscription invalid (browsers must subscribe
// again) — so the stored pair is never replaced automatically.
// Subject (the contact the push services may use): VAPID_SUBJECT, else https://<RAILWAY_PUBLIC_DOMAIN>, else a placeholder.
// Endpoints: only https URLs of the known browser push services are accepted (no request to an arbitrary host).
// No Redis. Postgres: one read of the keys per process, one SELECT of active devices per send, one UPDATE per device result.
import { getPool, dbAvailable } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import type { PushPayload, PushDevice, PushDeviceResult } from './contract';

export type { PushPayload, PushDevice, PushDeviceResult } from './contract';

const g = globalThis as any;
const mem: { keys?: { publicKey: string; privateKey: string; source: 'env' | 'db' }; active?: { n: number; at: number } } = g.__MC_PUSH__ || (g.__MC_PUSH__ = {});

/** Known Web Push services (Chrome / Edge / Android: FCM; Firefox: Mozilla autopush; Safari / iOS: Apple; Windows: WNS). */
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
/** Pure: is this a push endpoint we may send to? */
export function allowedEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((r) => r.test(u.hostname)); } catch { return false; }
}
/** Pure: endpoint shown to the owner (host + last 8 characters). */
export function shortEndpoint(endpoint: string): string {
  try { const u = new URL(endpoint); return `${u.hostname}/…${endpoint.slice(-8)}`; } catch { return '…'; }
}
const B64U = /^[A-Za-z0-9_-]+=*$/;
/** Pure: checks a PushSubscriptionJSON from the browser. */
export function parseSubscription(raw: any): { ok: true; endpoint: string; p256dh: string; auth: string } | { ok: false; error: string } {
  const endpoint = raw?.endpoint, p256dh = raw?.keys?.p256dh, auth = raw?.keys?.auth;
  if (!allowedEndpoint(endpoint)) return { ok: false, error: 'not a browser push address' };
  if (typeof p256dh !== 'string' || p256dh.length < 40 || p256dh.length > 200 || !B64U.test(p256dh)) return { ok: false, error: 'subscription key missing' };
  if (typeof auth !== 'string' || auth.length < 8 || auth.length > 100 || !B64U.test(auth)) return { ok: false, error: 'subscription secret missing' };
  return { ok: true, endpoint, p256dh, auth };
}

async function pool() {
  if (!dbAvailable()) throw new Error('Postgres is not configured');
  const p = getPool();
  if (!p || !(await ensureSchema())) throw new Error('database not available');
  return p;
}

async function webpush(): Promise<any> {
  const m: any = await import('web-push');
  return m.default || m;
}

/** The VAPID key pair (env first, else the stored pair, else make and store one). */
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string; source: 'env' | 'db' }> {
  if (mem.keys) return mem.keys;
  const pub = (process.env.VAPID_PUBLIC_KEY || '').trim(), priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (pub && priv) return (mem.keys = { publicKey: pub, privateKey: priv, source: 'env' });
  const p = await pool();
  let row = (await p.query('SELECT public_key, private_key FROM push_vapid WHERE id = 1')).rows[0];
  if (!row) {
    const k = (await webpush()).generateVAPIDKeys();
    await p.query('INSERT INTO push_vapid (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING', [k.publicKey, k.privateKey]);
    row = (await p.query('SELECT public_key, private_key FROM push_vapid WHERE id = 1')).rows[0];
  }
  return (mem.keys = { publicKey: row.public_key, privateKey: row.private_key, source: 'db' });
}
export function vapidSubject(): string {
  const s = (process.env.VAPID_SUBJECT || '').trim();
  if (/^(mailto:|https:\/\/)/.test(s)) return s;
  const d = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  return d ? `https://${d}` : 'mailto:alerts@market-cockpit.invalid';
}

const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());
const rowToDevice = (r: any): PushDevice => ({ id: Number(r.id), label: r.label ?? null, endpointShort: shortEndpoint(r.endpoint), createdAt: iso(r.created_at)!, lastOkAt: iso(r.last_ok_at), lastError: r.last_error ?? null, disabled: !!r.disabled });

export async function subscribe(raw: any, label: string | null, userAgent: string | null, replaces?: string | null): Promise<{ ok: true; device: PushDevice } | { ok: false; error: string }> {
  const s = parseSubscription(raw);
  if (!s.ok) return s;
  const p = await pool();
  // the browser renewed its subscription (service worker pushsubscriptionchange): drop the old row, keep its label
  if (typeof replaces === 'string' && replaces && replaces !== s.endpoint) {
    const old = (await p.query('DELETE FROM push_subscription WHERE endpoint = $1 RETURNING label', [replaces])).rows[0];
    if (!label && old?.label) label = old.label;
  }
  const n = Number((await p.query('SELECT count(*)::int AS n FROM push_subscription WHERE NOT disabled')).rows[0]?.n || 0);
  if (n >= 20) return { ok: false, error: 'at most 20 devices — remove an old one first' };
  const r = (await p.query(
    `INSERT INTO push_subscription (endpoint, p256dh, auth, label, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = coalesce(EXCLUDED.label, push_subscription.label),
       user_agent = EXCLUDED.user_agent, disabled = false, last_error = NULL, last_error_at = NULL
     RETURNING *`,
    [s.endpoint, s.p256dh, s.auth, label ? label.slice(0, 60) : null, userAgent ? userAgent.slice(0, 200) : null],
  )).rows[0];
  mem.active = undefined;
  return { ok: true, device: rowToDevice(r) };
}
export async function unsubscribe(endpoint: string): Promise<boolean> {
  if (typeof endpoint !== 'string' || !endpoint) return false;
  const p = await pool();
  const n = (await p.query('DELETE FROM push_subscription WHERE endpoint = $1', [endpoint])).rowCount || 0;
  mem.active = undefined;
  return n > 0;
}
export async function listDevices(): Promise<PushDevice[]> {
  const p = await pool();
  return (await p.query('SELECT * FROM push_subscription ORDER BY created_at DESC')).rows.map(rowToDevice);
}
/** Active device count, cached 5 minutes (also published on globalThis for lib/owner-notify notifyChannels). */
export async function activePushCount(): Promise<number> {
  if (mem.active && Date.now() - mem.active.at < 5 * 60_000) return mem.active.n;
  if (!dbAvailable()) return 0;
  try {
    const p = await pool();
    const n = Number((await p.query('SELECT count(*)::int AS n FROM push_subscription WHERE NOT disabled')).rows[0]?.n || 0);
    mem.active = { n, at: Date.now() };
    g.__MC_PUSH_ACTIVE__ = n;
    return n;
  } catch { return mem.active?.n ?? 0; }
}

export interface PushTarget { id: number; label: string | null; endpoint: string; p256dh: string; auth: string }
/** Sends one payload to one device. Injected in tests; the default uses the web-push package. */
export type PushSender = (t: PushTarget, payload: string, vapid: { subject: string; publicKey: string; privateKey: string }) => Promise<{ status: number }>;
export const webPushSender: PushSender = async (t, payload, vapid) => {
  const wp = await webpush();
  try {
    const r = await wp.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
      vapidDetails: vapid, TTL: 6 * 3600, urgency: 'high', timeout: 10_000,
    });
    return { status: Number(r?.statusCode || 201) };
  } catch (e: any) {
    if (typeof e?.statusCode === 'number') { const err: any = new Error(String(e.body || e.message || 'push refused').slice(0, 200)); err.status = e.statusCode; throw err; }
    throw new Error(String(e?.message || e).slice(0, 200));
  }
};

/** Pure: a push service status that means "this subscription is gone" (stop sending to it). */
export const goneStatus = (status: number | null | undefined) => status === 404 || status === 410;

export interface PushSendResult { state: 'sent' | 'skipped' | 'error'; error?: string; results: PushDeviceResult[] }
/**
 * One payload to every active device. 'sent' when at least one device took it, 'skipped' when there is no device,
 * 'error' when all failed. 404 / 410 → the device is disabled. Never throws.
 */
export async function sendPushToAll(payload: PushPayload, opts: { sender?: PushSender; targets?: PushTarget[]; record?: boolean; vapid?: { publicKey: string; privateKey: string } } = {}): Promise<PushSendResult> {
  const sender = opts.sender ?? webPushSender;
  let targets = opts.targets;
  let vapid: { subject: string; publicKey: string; privateKey: string };
  try {
    if (!targets) {
      const p = await pool();
      targets = (await p.query('SELECT id, label, endpoint, p256dh, auth FROM push_subscription WHERE NOT disabled ORDER BY id')).rows.map((r: any) => ({ id: Number(r.id), label: r.label ?? null, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
    }
    if (!targets.length) return { state: 'skipped', error: 'no phone or browser has turned on push yet', results: [] };
    const k = opts.vapid ?? await vapidKeys();
    vapid = { subject: vapidSubject(), publicKey: k.publicKey, privateKey: k.privateKey };
  } catch (e: any) { return { state: 'error', error: `push not ready: ${String(e?.message || e).slice(0, 150)}`, results: [] }; }
  const body = JSON.stringify(payload);
  const results: PushDeviceResult[] = await Promise.all(targets.map(async (t) => {
    try {
      const r = await sender(t, body, vapid);
      return { id: t.id, label: t.label, endpointShort: shortEndpoint(t.endpoint), ok: true, state: 'sent' as const, status: r.status, error: null, disabled: false };
    } catch (e: any) {
      const status = typeof e?.status === 'number' ? e.status : null;
      const gone = goneStatus(status);
      return { id: t.id, label: t.label, endpointShort: shortEndpoint(t.endpoint), ok: false, state: gone ? 'gone' as const : 'error' as const, status, error: `${status ? `HTTP ${status} — ` : ''}${String(e?.message || e).slice(0, 160)}`, disabled: gone };
    }
  }));
  if (opts.record !== false && !opts.targets) await recordResults(results).catch(() => {});
  const sent = results.filter((r) => r.ok).length;
  if (sent) return { state: 'sent', results };
  return { state: 'error', error: results.map((r) => `${r.label || r.endpointShort}: ${r.error}`).join('; ').slice(0, 300), results };
}
async function recordResults(results: PushDeviceResult[]): Promise<void> {
  if (!results.length) return;
  const p = await pool();
  const ok = results.filter((r) => r.ok).map((r) => r.id);
  if (ok.length) await p.query('UPDATE push_subscription SET last_ok_at = now(), last_error = NULL WHERE id = ANY($1::bigint[])', [ok]);
  for (const r of results.filter((x) => !x.ok)) {
    await p.query('UPDATE push_subscription SET last_error = $2, last_error_at = now(), disabled = disabled OR $3 WHERE id = $1', [r.id, r.error, r.disabled]);
  }
  if (results.some((r) => r.disabled)) mem.active = undefined;
}

/** Pure: the push for a set of fired events — one alert opens that event; several open the alerts page. */
export function pushForEvents(events: ReadonlyArray<{ id: number; ticker: string; condition: string; message: string; price: number | null; market: string }>): PushPayload | null {
  if (!events.length) return null;
  if (events.length === 1) {
    const e = events[0];
    const px = e.price != null ? ` — ${e.market === 'IN' ? '₹' : '$'}${e.price.toFixed(2)}` : '';
    return { title: `🔔 ${e.ticker}: ${e.condition}`.slice(0, 120), body: `${e.message}${px}`.slice(0, 240), url: `/price-alerts?event=${e.id}`, tag: `mc-alert-${e.id}`, eventId: e.id };
  }
  const tickers = [...new Set(events.map((e) => e.ticker))];
  const body = events.slice(0, 4).map((e) => e.message).join('\n') + (events.length > 4 ? `\n… and ${events.length - 4} more` : '');
  return { title: `🔔 ${events.length} price alerts (${tickers.slice(0, 3).join(', ')}${tickers.length > 3 ? '…' : ''})`.slice(0, 120), body: body.slice(0, 240), url: '/price-alerts', tag: 'mc-alerts', eventId: null };
}
