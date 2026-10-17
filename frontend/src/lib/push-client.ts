// zzz1064 — PHONE NOTIFICATIONS (Web Push), browser side.
//
// The server (another module) owns the keys and the sending:
//   GET  /api/v1/push?view=key                       → { ok, publicKey }
//   POST /api/v1/push { action:'subscribe', subscription, label }
//   POST /api/v1/push { action:'unsubscribe', endpoint }
//   POST /api/v1/push { action:'test' }              → { ok, results:[{ label, state, error? }] }
// The service worker (public/sw.js) shows the notification and opens the page when it is tapped.
//
// The top half of this file is PURE (tests import it); the bottom half touches navigator / fetch and is only called after a tap.

export const PUSH_API = '/api/v1/push';
export const PUSH_DEVICE_KEY = 'mc:push-device:v1';
export const PUSH_CHANGED_EVENT = 'mc:push:changed';

export type PushState =
  | 'checking'          // not worked out yet
  | 'on'                // this device gets phone notifications
  | 'off'               // can be turned on with one tap
  | 'blocked'           // the browser / phone settings said no — must be changed in settings
  | 'ios-install'       // iPhone / iPad in Safari: add to Home Screen first, then open from the icon
  | 'unsupported'       // this browser cannot receive pushes at all
  | 'server-missing';   // the server has no push set up yet

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: 'default' | 'granted' | 'denied' | 'unknown';
  ios: boolean;
  standalone: boolean;
  subscribed: boolean;
  /** null = not asked yet; false = the server answered "no push here" */
  serverReady: boolean | null;
}

/** Works out what to show for this device. Pure. */
export function pushState(env: PushEnv): PushState {
  // iPhone Safari only allows Web Push for a Home Screen app (iOS 16.4+). In the normal Safari tab PushManager is missing.
  if (env.ios && !env.standalone) return 'ios-install';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'blocked';
  if (env.serverReady === false) return 'server-missing';
  if (env.subscribed && env.permission === 'granted') return 'on';
  return 'off';
}

/** Plain-English line for each state. */
export function pushStateText(s: PushState): { title: string; detail: string } {
  switch (s) {
    case 'checking': return { title: 'Checking…', detail: '' };
    case 'on': return { title: 'On for this device', detail: 'Price alerts arrive as phone notifications, even when the app is closed.' };
    case 'off': return { title: 'Off', detail: 'Tap “Turn on” and allow notifications when the phone asks.' };
    case 'blocked': return { title: 'Blocked by the browser', detail: 'Notifications were refused for this site. Open the browser or phone Settings → Notifications → Market Cockpit → Allow, then come back and tap “Turn on”.' };
    case 'ios-install': return { title: 'Needs the app on your Home Screen (iPhone)', detail: 'iPhone only sends notifications to apps on the Home Screen.' };
    case 'unsupported': return { title: 'Not possible in this browser', detail: 'Use Chrome on Android, Safari on iPhone (from the Home Screen icon), or Chrome / Edge / Firefox / Safari on a computer.' };
    case 'server-missing': return { title: 'Not available on the server yet', detail: 'Phone notifications are not available on the server yet. Email still works.' };
  }
}

/** The 3 iPhone steps, in plain words. */
export const IOS_INSTALL_STEPS: readonly string[] = [
  'In Safari, tap the Share button (the square with an arrow pointing up).',
  'Scroll down and tap “Add to Home Screen”, then “Add”.',
  'Open Market Cockpit from the new icon on your Home Screen, come back to this page and tap “Turn on”.',
];

/** A short name for this device, shown in the server's list ("iPhone", "Android phone", "Mac · Chrome"). Pure. */
export function deviceLabel(ua: string, maxTouchPoints = 0): string {
  const u = String(ua || '');
  const browser = /EdgA?\//.test(u) ? 'Edge' : /Firefox\/|FxiOS/.test(u) ? 'Firefox' : /Chrome\/|CriOS/.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser';
  let dev: string;
  if (/iPhone/.test(u)) dev = 'iPhone';
  else if (/iPad/.test(u) || (/Macintosh/.test(u) && maxTouchPoints > 1)) dev = 'iPad';
  else if (/Android/.test(u)) dev = /Mobile/.test(u) ? 'Android phone' : 'Android tablet';
  else if (/Macintosh|Mac OS X/.test(u)) dev = 'Mac';
  else if (/Windows/.test(u)) dev = 'Windows PC';
  else if (/Linux/.test(u)) dev = 'Linux PC';
  else dev = 'Device';
  return `${dev} · ${browser}`;
}

/** VAPID public key (base64url) → bytes for pushManager.subscribe. Pure. Throws on a bad key. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const s = String(base64 || '').trim();
  if (!/^[A-Za-z0-9_-]+=*$/.test(s)) throw new Error('bad key');
  const padded = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface PushDeviceRecord { on: boolean; endpoint: string | null; label: string; at: string }
/** Reads the per-device record. Pure apart from the storage passed in. */
export function readDeviceRecord(storage: Pick<Storage, 'getItem'> | null): PushDeviceRecord | null {
  try {
    const raw = storage?.getItem(PUSH_DEVICE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object' || typeof j.on !== 'boolean') return null;
    return { on: j.on, endpoint: typeof j.endpoint === 'string' ? j.endpoint : null, label: String(j.label || ''), at: String(j.at || '') };
  } catch { return null; }
}

/** How the server answered a test. Pure. */
export function describeTestResults(j: any, status: number): { ok: boolean; text: string } {
  if (status === 404 || status === 405) return { ok: false, text: pushStateText('server-missing').detail };
  const results: any[] = Array.isArray(j?.results) ? j.results : [];
  if (!j?.ok && !results.length) return { ok: false, text: `Test not sent: ${String(j?.error || `HTTP ${status || 'error'}`)}` };
  if (!results.length) return { ok: false, text: 'No device has phone notifications turned on yet. Tap “Turn on” first.' };
  const lines = results.map((r) => {
    const label = String(r?.label || 'device');
    const st = String(r?.state || '');
    if (st === 'sent' || st === 'ok') return `✓ ${label}: sent`;
    if (st === 'gone' || st === 'expired') return `✗ ${label}: this device is no longer subscribed (removed). Turn it on again there.`;
    return `✗ ${label}: ${String(r?.error || st || 'failed')}`;
  });
  const ok = results.some((r) => r?.state === 'sent' || r?.state === 'ok');
  return { ok, text: (ok ? 'Test sent — it should appear on your phone within a few seconds.\n' : 'Test not delivered.\n') + lines.join('\n') };
}

// ── browser part ────────────────────────────────────────────────────────────

function lsGet(): Storage | null { try { return window.localStorage; } catch { return null; } }
function saveDeviceRecord(rec: PushDeviceRecord | null): void {
  try {
    const s = lsGet();
    if (!s) return;
    if (rec) s.setItem(PUSH_DEVICE_KEY, JSON.stringify(rec)); else s.removeItem(PUSH_DEVICE_KEY);
  } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent(PUSH_CHANGED_EVENT)); } catch { /* no window */ }
}

function isIosUa(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
}
function isStandaloneNow(): boolean {
  if (typeof window === 'undefined') return false;
  try { if (window.matchMedia?.('(display-mode: standalone)').matches) return true; } catch { /* old browser */ }
  return (window.navigator as any).standalone === true;
}

/** True when this device said "on" last time (used to tick "Phone" in a new alert). */
export function pushOnThisDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return readDeviceRecord(lsGet())?.on === true;
}

let keyCache: { key: string | null; at: number } | null = null;
/** The server's public key, or null when push is not set up there (route missing, or no key). */
export async function fetchPublicKey(): Promise<{ ready: boolean; key: string | null; error?: string }> {
  if (keyCache && Date.now() - keyCache.at < 10 * 60_000) return { ready: !!keyCache.key, key: keyCache.key };
  try {
    const r = await fetch(`${PUSH_API}?view=key`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    let j: any = null; try { j = await r.json(); } catch { /* not JSON */ }
    const key = r.ok && j?.ok && typeof j.publicKey === 'string' && j.publicKey ? j.publicKey : null;
    if (r.ok || r.status === 404 || r.status === 405 || r.status === 503) keyCache = { key, at: Date.now() };
    return { ready: !!key, key, error: key ? undefined : j?.error || `HTTP ${r.status}` };
  } catch (e: any) {
    return { ready: false, key: null, error: String(e?.message || e) };
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const sw = navigator.serviceWorker;
  try {
    const existing = await sw.getRegistration('/');
    if (existing) return existing;
    // Not registered yet (first visit, or the app's own registration is still waiting for an idle moment).
    await sw.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    return await Promise.race([sw.ready, new Promise<null>((res) => setTimeout(() => res(null), 10_000))]);
  } catch { return null; }
}

/** Reads the current state of this device. Never throws. */
export async function detectPushEnv(opts: { askServer?: boolean } = {}): Promise<PushEnv> {
  const hasSW = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const hasPM = typeof window !== 'undefined' && 'PushManager' in window;
  const hasN = typeof window !== 'undefined' && 'Notification' in window;
  const permission = hasN ? (Notification.permission as PushEnv['permission']) : 'unknown';
  let subscribed = false;
  if (hasSW && hasPM) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      subscribed = !!(await reg?.pushManager.getSubscription());
    } catch { /* ignore */ }
  }
  let serverReady: boolean | null = null;
  if (opts.askServer !== false && hasSW && hasPM) serverReady = (await fetchPublicKey()).ready;
  const rec = readDeviceRecord(lsGet());
  if (rec?.on && !subscribed) saveDeviceRecord({ ...rec, on: false });   // the browser dropped it: say so honestly
  return { hasServiceWorker: hasSW, hasPushManager: hasPM, hasNotification: hasN, permission, ios: isIosUa(), standalone: isStandaloneNow(), subscribed, serverReady };
}

async function post(body: unknown): Promise<{ status: number; json: any }> {
  try {
    const r = await fetch(PUSH_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    let json: any = null; try { json = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, json };
  } catch (e: any) { return { status: 0, json: { ok: false, error: e?.name === 'TimeoutError' ? 'the server did not answer' : 'network error' } }; }
}

/** "Turn on": must be called from a tap (iPhone refuses the permission prompt otherwise). */
export async function turnOnPush(): Promise<{ ok: boolean; state: PushState; message: string }> {
  const env = await detectPushEnv({ askServer: false });
  const pre = pushState({ ...env, serverReady: true, subscribed: false });
  if (pre === 'ios-install' || pre === 'unsupported' || pre === 'blocked') return { ok: false, state: pre, message: pushStateText(pre).detail };
  const k = await fetchPublicKey();
  if (!k.key) return { ok: false, state: 'server-missing', message: pushStateText('server-missing').detail };
  let perm: NotificationPermission = Notification.permission;
  if (perm !== 'granted') {
    try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; }
  }
  if (perm !== 'granted') {
    return perm === 'denied'
      ? { ok: false, state: 'blocked', message: pushStateText('blocked').detail }
      : { ok: false, state: 'off', message: 'Notifications were not allowed. Tap “Turn on” again and choose Allow.' };
  }
  const reg = await getRegistration();
  if (!reg) return { ok: false, state: 'unsupported', message: 'The app’s background worker could not start in this browser. Reload the page and try again.' };
  // An older worker (from before phone notifications) cannot show them: take the newest one now. The page is not reloaded.
  try { await reg.update(); } catch { /* offline: keep the current one */ }
  try { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch { /* ignore */ }
  let sub: PushSubscription | null = null;
  try {
    sub = await reg.pushManager.getSubscription();
    const appKey = urlBase64ToUint8Array(k.key);
    if (sub) {
      // a subscription made with an older server key cannot be used: replace it
      const old = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (old && (old.length !== appKey.length || old.some((b, i) => b !== appKey[i]))) { await sub.unsubscribe().catch(() => {}); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey as unknown as BufferSource });
  } catch (e: any) {
    return { ok: false, state: 'off', message: `This device could not be signed up for notifications: ${String(e?.message || e).slice(0, 160)}` };
  }
  const label = deviceLabel(navigator.userAgent, (navigator as any).maxTouchPoints || 0);
  const r = await post({ action: 'subscribe', subscription: sub.toJSON(), label });
  if (r.status === 404 || r.status === 405) return { ok: false, state: 'server-missing', message: pushStateText('server-missing').detail };
  if (!(r.status >= 200 && r.status < 300 && r.json?.ok)) return { ok: false, state: 'off', message: `Not saved on the server: ${String(r.json?.error || `HTTP ${r.status || 'error'}`)}. Try again.` };
  saveDeviceRecord({ on: true, endpoint: sub.endpoint, label, at: new Date().toISOString() });
  return { ok: true, state: 'on', message: `Phone notifications are on for this device (${label}).` };
}

/** "Turn off" for this device. */
export async function turnOffPush(): Promise<{ ok: boolean; message: string }> {
  let endpoint: string | null = readDeviceRecord(lsGet())?.endpoint ?? null;
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { endpoint = sub.endpoint; await sub.unsubscribe().catch(() => {}); }
  } catch { /* ignore */ }
  let serverOk = true;
  if (endpoint) {
    const r = await post({ action: 'unsubscribe', endpoint });
    serverOk = r.status === 404 || (r.status >= 200 && r.status < 300);
  }
  saveDeviceRecord({ on: false, endpoint: null, label: '', at: new Date().toISOString() });
  return { ok: true, message: serverOk ? 'Phone notifications are off for this device.' : 'Turned off here; the server could not be told yet (it removes dead devices on its own).' };
}

/** "Send test to my phone". */
export async function sendTestPush(): Promise<{ ok: boolean; text: string }> {
  const r = await post({ action: 'test' });
  return describeTestResults(r.json, r.status);
}
