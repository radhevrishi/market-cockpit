'use client';
// zzz883 — keeps the owner's personal browser data (decisions, theses, ledgers, saved valuations, book, bench, notes …) copied
// to the server, and brings it back on a new device or after the browser is cleared.
//
// Every 60 s (and when the tab is hidden) it compares each key with what the server last confirmed:
//   • local changed since the last sync      → PUT to the server
//   • local unchanged, server moved forward  → another device saved: take the server copy
//   • local missing, server has it           → restore
// Nothing is ever deleted on either side by this code; every server write is kept in history (last 60 versions per key).
import { USER_STATE_KEYS_CLIENT, NOTES_PREFIX, NOTES_BUNDLE } from './user-vault-keys';

const META_KEY = 'mc:vault:meta:v1';
const DEVICE_KEY = 'mc:vault:device:v1';
export interface VaultMetaEntry { hash: string; version: number }
export type VaultAction = { kind: 'push' } | { kind: 'pull' } | { kind: 'none' };

/** Pure: what to do for one key. `localHash` null = nothing stored locally. */
export function vaultPlan(localHash: string | null, last: VaultMetaEntry | undefined, server: VaultMetaEntry | undefined): VaultAction {
  if (localHash == null) return server ? { kind: 'pull' } : { kind: 'none' };
  if (!server) return { kind: 'push' };
  if (server.hash === localHash) return { kind: 'none' };
  // first contact on this device while the server already holds a copy: the server copy wins (a fresh browser often starts with an
  // empty default that must never overwrite real data); the local value is kept in a local backup key first
  if (!last) return { kind: 'pull' };
  const localChanged = !last || last.hash !== localHash;
  if (localChanged) return { kind: 'push' };
  return server.version > (last?.version ?? 0) ? { kind: 'pull' } : { kind: 'none' };
}

/** Small stable hash (FNV-1a) — enough to notice a change; the server keeps its own sha256. */
export function quickHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}:${s.length}`;
}

function readLocal(key: string): unknown | null {
  if (key === NOTES_BUNDLE) {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(NOTES_PREFIX)) out[k] = localStorage.getItem(k) || ''; }
    return Object.keys(out).length ? out : null;
  }
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try { return { __raw: raw, parsed: JSON.parse(raw) }; } catch { return { __raw: raw }; }
}
function writeLocal(key: string, value: any): void {
  if (key === NOTES_BUNDLE) { for (const [k, v] of Object.entries(value || {})) if (k.startsWith(NOTES_PREFIX) && localStorage.getItem(k) == null) localStorage.setItem(k, String(v)); return; }
  if (value && typeof value.__raw === 'string') localStorage.setItem(key, value.__raw);
}
const localHashOf = (v: unknown | null) => (v == null ? null : quickHash(JSON.stringify(v)));

let running = false;
export async function syncVaultOnce(): Promise<{ pushed: string[]; pulled: string[]; error?: string }> {
  if (running || typeof window === 'undefined' || typeof localStorage === 'undefined') return { pushed: [], pulled: [] };
  running = true;
  const pushed: string[] = []; const pulled: string[] = [];
  try {
    let meta: Record<string, VaultMetaEntry> = {};
    try { meta = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch { meta = {}; }
    let device = localStorage.getItem(DEVICE_KEY);
    if (!device) { device = `d-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(DEVICE_KEY, device); }
    const r = await fetch('/api/v1/user-state?list=1', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { pushed, pulled, error: `list HTTP ${r.status}` };
    const j = await r.json();
    // the server's own hash is sha256; ours is FNV — so the server copy is remembered by OUR hash at the time of the last sync
    const server: Record<string, VaultMetaEntry> = {};
    for (const k of j.keys || []) server[k.key] = { hash: meta[k.key]?.version === k.version ? meta[k.key].hash : `srv:${k.hash}`, version: Number(k.version) };
    for (const key of USER_STATE_KEYS_CLIENT) {
      const local = readLocal(key); const lh = localHashOf(local);
      const plan = vaultPlan(lh, meta[key], server[key]);
      if (plan.kind === 'push' && local != null) {
        const p = await fetch('/api/v1/user-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: local, baseVersion: meta[key]?.version ?? null, device }), signal: AbortSignal.timeout(20_000) });
        if (p.ok) { const pj = await p.json(); meta[key] = { hash: lh!, version: Number(pj.version) }; pushed.push(key); }
      } else if (plan.kind === 'pull') {
        if (local != null) { try { localStorage.setItem(`mc:vault:backup:${key}`, JSON.stringify({ at: new Date().toISOString(), value: local })); } catch { /* quota */ } }
        const g = await fetch(`/api/v1/user-state?key=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
        if (g.ok) {
          const gj = await g.json();
          if (gj.found) { writeLocal(key, gj.value); meta[key] = { hash: localHashOf(readLocal(key)) || '', version: Number(gj.version) }; pulled.push(key); }
        }
      }
    }
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    if (pulled.length) window.dispatchEvent(new CustomEvent('mc:vault:restored', { detail: { keys: pulled } }));
    return { pushed, pulled };
  } catch (e: any) {
    return { pushed, pulled, error: String(e?.message || e) };
  } finally { running = false; }
}

/** Starts the background sync (idempotent). Returns a stop function. */
export function startVaultSync(intervalMs = 60_000): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as any;
  if (w.__mcVault) return w.__mcVault;
  const tick = () => { void syncVaultOnce(); };
  const first = setTimeout(tick, 4_000);
  const iv = setInterval(tick, intervalMs);
  const onHide = () => { if (document.visibilityState === 'hidden') tick(); };
  document.addEventListener('visibilitychange', onHide);
  const stop = () => { clearTimeout(first); clearInterval(iv); document.removeEventListener('visibilitychange', onHide); w.__mcVault = null; };
  w.__mcVault = stop;
  return stop;
}
