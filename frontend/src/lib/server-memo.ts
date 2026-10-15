// zzz1053 — server-side speed helpers for the one long-lived Node process (Railway):
//
//   MemoLru        bounded (entries + bytes) LRU with timestamps — touch on read, evict the least recently used
//   singleFlight   concurrent callers of the same key share one promise (no thundering herd on a cold cache)
//   memoSwr        fresh → serve; stale → serve + ONE background refresh; too old / missing → load (shared). A load whose result
//                  is not usable (error, empty) is returned to its caller but never cached and never replaces a good value.
//   etagFor / matchesIfNoneMatch / notModified   ETag + 304, so an unchanged revisit transfers nothing
//   sendText       one response helper: 304 when the ETag matches, else the body — large bodies sent PRE-COMPRESSED (br / gzip,
//                  compressed once per cache key, not once per request)
//   cachedRoute    a whole GET handler's answer memoised with memoSwr (status 200 + not no-store only, unless told otherwise)
//
// Public market data only. Never used for personal data (user-state / books / watchlists) — those are always read from the store.
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib';
import type { ServerTiming } from './server-timing';

// ── LRU ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MemoEntry<V> { value: V; at: number; bytes: number }
export interface MemoLruOpts<V> { maxEntries: number; maxBytes?: number; sizeOf?: (v: V) => number; now?: () => number }

export class MemoLru<V> {
  private m = new Map<string, MemoEntry<V>>();
  private total = 0;
  readonly maxEntries: number; readonly maxBytes: number;
  private sizeOf: (v: V) => number; readonly now: () => number;
  hits = 0; misses = 0; evictions = 0;
  constructor(o: MemoLruOpts<V>) {
    this.maxEntries = Math.max(1, o.maxEntries); this.maxBytes = o.maxBytes ?? Infinity;
    this.sizeOf = o.sizeOf ?? (() => 1); this.now = o.now ?? Date.now;
  }
  /** The entry (most-recently-used from now on), or undefined. Age is the caller's decision. */
  get(key: string): MemoEntry<V> | undefined {
    const e = this.m.get(key);
    if (!e) { this.misses++; return undefined; }
    this.m.delete(key); this.m.set(key, e); this.hits++;
    return e;
  }
  peek(key: string): MemoEntry<V> | undefined { return this.m.get(key); }
  set(key: string, value: V, at = this.now()): void {
    const bytes = Math.max(0, this.sizeOf(value) || 0);
    this.delete(key);
    if (bytes > this.maxBytes) return;   // never keep one value bigger than the whole budget
    this.m.set(key, { value, at, bytes }); this.total += bytes;
    while ((this.m.size > this.maxEntries || this.total > this.maxBytes) && this.m.size) {
      const k0 = this.m.keys().next().value as string;
      this.delete(k0); this.evictions++;
    }
  }
  delete(key: string): void { const e = this.m.get(key); if (e) { this.m.delete(key); this.total -= e.bytes; } }
  /** drop every key for which `pred` is true */
  deleteWhere(pred: (key: string) => boolean): void { for (const k of [...this.m.keys()]) if (pred(k)) this.delete(k); }
  clear(): void { this.m.clear(); this.total = 0; }
  get size(): number { return this.m.size; }
  get bytes(): number { return this.total; }
  keys(): string[] { return [...this.m.keys()]; }
}

// ── single flight ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function singleFlight<T>(inflight: Map<string, Promise<T>>, key: string, fn: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key);
  if (cur) return cur;
  let p: Promise<T>;
  try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
  inflight.set(key, p);
  const clear = () => { if (inflight.get(key) === p) inflight.delete(key); };
  p.then(clear, clear);
  return p;
}

// ── stale-while-revalidate memo ─────────────────────────────────────────────────────────────────────────────────────────────
export type MemoState = 'hit' | 'stale' | 'miss';
export interface MemoSwrOpts<V> {
  cache: MemoLru<V>; inflight: Map<string, Promise<V>>; key: string;
  /** younger than this: served as is */
  freshMs: number;
  /** younger than this (and not fresh): served at once, refreshed in the background. ≤ freshMs = no stale serving. */
  staleMs: number;
  load: () => Promise<V>;
  /** false = the loaded value is returned to the caller but not cached (errors, empty answers) */
  usable?: (v: V) => boolean;
  /** skip the cache (still shared with any running load for the key) */
  force?: boolean;
}
export interface MemoSwrResult<V> { value: V; state: MemoState; ageMs: number; at: number; cached: boolean }

function loadAndStore<V>(o: MemoSwrOpts<V>): Promise<V> {
  return singleFlight(o.inflight, o.key, async () => {
    const v = await o.load();
    if (!o.usable || o.usable(v)) o.cache.set(o.key, v);
    return v;
  });
}

export async function memoSwr<V>(o: MemoSwrOpts<V>): Promise<MemoSwrResult<V>> {
  const now = o.cache.now();
  const e = o.force ? undefined : o.cache.get(o.key);
  if (e) {
    const age = Math.max(0, now - e.at);
    if (age < o.freshMs) return { value: e.value, state: 'hit', ageMs: age, at: e.at, cached: true };
    if (age < o.staleMs) {
      if (!o.inflight.has(o.key)) void loadAndStore(o).catch(() => { /* the stale value stays */ });
      return { value: e.value, state: 'stale', ageMs: age, at: e.at, cached: true };
    }
  }
  const v = await loadAndStore(o);
  const stored = o.cache.peek(o.key);
  const cached = !!stored && stored.value === v;
  return { value: v, state: 'miss', ageMs: 0, at: cached ? stored!.at : now, cached };
}

// ── ETag / 304 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The deploy this process runs (so an ETag never survives a deploy that may change how a body is made). */
export const DEPLOY_ID: string = String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || `boot-${Date.now()}`).slice(0, 16);

/** A weak ETag from the given parts (+ the deploy id). */
export function etagFor(...parts: Array<string | number | null | undefined>): string {
  const h = createHash('sha1').update([DEPLOY_ID, ...parts.map((p) => String(p ?? ''))].join('\u0001')).digest('base64url').slice(0, 22);
  return `W/"${h}"`;
}
/** A weak ETag of a body's text. */
export function etagOfText(text: string): string { return etagFor('body', createHash('sha1').update(text).digest('hex')); }

const bareTag = (t: string) => t.trim().replace(/^W\//, '');
export function matchesIfNoneMatch(req: Request | { headers: Headers }, etag: string): boolean {
  const inm = req.headers.get('if-none-match');
  if (!inm || !etag) return false;
  if (inm.trim() === '*') return true;
  const want = bareTag(etag);
  return inm.split(',').some((t) => bareTag(t) === want);
}
export function notModified(etag: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
}

// ── pre-compressed bodies ───────────────────────────────────────────────────────────────────────────────────────────────────
export type Enc = 'br' | 'gzip';
/** br preferred, then gzip; honours q-values and q=0. Null = send it plain. */
export function pickEncoding(acceptEncoding: string | null | undefined): Enc | null {
  if (!acceptEncoding) return null;
  const q: Record<string, number> = {};
  for (const part of String(acceptEncoding).split(',')) {
    const [raw, ...params] = part.trim().split(';');
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    let w = 1;
    for (const p of params) { const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p); if (m) w = Number(m[1]); }
    q[name] = Math.max(q[name] ?? -1, Number.isFinite(w) ? w : 0);
  }
  const star = q['*'];
  const wOf = (n: string) => (q[n] !== undefined ? q[n] : star !== undefined ? star : 0);
  const br = wOf('br'), gz = wOf('gzip');
  if (br <= 0 && gz <= 0) return null;
  return br >= gz ? 'br' : 'gzip';
}
export const PRECOMPRESS_MIN_BYTES = 32 * 1024;
const _compressed = new MemoLru<Buffer>({ maxEntries: 64, maxBytes: 96 * 1024 * 1024, sizeOf: (b) => b.length });
export function compressText(text: string, enc: Enc): Buffer {
  const buf = Buffer.from(text, 'utf8');
  return enc === 'br'
    ? brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    : gzipSync(buf, { level: 6 });
}
/** The text compressed for this cache key (made once per key + encoding). */
export function compressedFor(cacheKey: string, text: string, enc: Enc): Buffer {
  const k = `${cacheKey}|${enc}|${text.length}`;
  const hit = _compressed.get(k);
  if (hit) return hit.value;
  const out = compressText(text, enc);
  _compressed.set(k, out);
  return out;
}
export function _compressedCacheSize(): number { return _compressed.size; }

export interface SendTextOpts {
  text: string; contentType: string; status?: number;
  /** ETag of this body (a 304 is sent when the request already has it) */
  etag?: string | null;
  cacheControl?: string;
  /** stable key for this exact body (e.g. "stock-screener|US|<builtAt>"): large bodies are compressed once per key */
  compressKey?: string | null;
  headers?: Record<string, string>;
  timing?: ServerTiming | null;
}
/** The response for a text body: 304 / pre-compressed / plain. */
export function sendText(req: Request, o: SendTextOpts): Response {
  const base: Record<string, string> = { ...(o.headers || {}) };
  if (o.cacheControl) base['Cache-Control'] = o.cacheControl;
  if (o.etag) base['ETag'] = o.etag;
  const status = o.status ?? 200;
  if (o.timing) base['Server-Timing'] = o.timing.header();
  if (o.etag && status === 200 && matchesIfNoneMatch(req, o.etag)) {
    if (o.timing) { o.timing.note('etag', '304'); base['Server-Timing'] = o.timing.header(); }
    return notModified(o.etag, { ...base, Vary: 'Accept-Encoding' });
  }
  const enc = o.compressKey && status === 200 && o.text.length >= PRECOMPRESS_MIN_BYTES ? pickEncoding(req.headers.get('accept-encoding')) : null;
  if (enc) {
    const body = compressedFor(o.compressKey!, o.text, enc);
    return new Response(new Uint8Array(body), { status, headers: { ...base, 'Content-Type': o.contentType, 'Content-Encoding': enc, Vary: 'Accept-Encoding', 'Content-Length': String(body.length) } });
  }
  return new Response(o.text, { status, headers: { ...base, 'Content-Type': o.contentType } });
}

// ── whole-route memo ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CachedAnswer { status: number; headers: Array<[string, string]>; text: string; etag: string }
const DROP_HEADERS = new Set(['content-length', 'set-cookie', 'content-encoding', 'transfer-encoding', 'connection', 'etag', 'server-timing']);
const _routeCache = new MemoLru<CachedAnswer>({ maxEntries: 300, maxBytes: 64 * 1024 * 1024, sizeOf: (a) => a.text.length + 256 });
const _routeInflight = new Map<string, Promise<CachedAnswer>>();
export const defaultCacheable = (a: CachedAnswer) => a.status === 200 && !a.headers.some(([k, v]) => k === 'cache-control' && /no-store/i.test(v));

export async function answerOf(res: Response): Promise<CachedAnswer> {
  const text = await res.text();
  const headers: Array<[string, string]> = [];
  res.headers.forEach((v, k) => { if (!DROP_HEADERS.has(k.toLowerCase())) headers.push([k.toLowerCase(), v]); });
  return { status: res.status, headers, text, etag: etagOfText(text) };
}

export interface CachedRouteOpts {
  key: string; freshMs: number; staleMs: number;
  handler: () => Promise<Response>;
  /** which answers may be kept (default: 200 and not no-store) */
  cacheable?: (a: CachedAnswer) => boolean;
  /** replace the handler's Cache-Control on served answers */
  cacheControl?: string;
  force?: boolean;
  timing?: ServerTiming | null;
}
/** Run a GET handler through memoSwr; the served answer carries x-mc-memo (hit / stale / miss) and its age. */
export async function cachedRoute(req: Request, o: CachedRouteOpts): Promise<Response> {
  const t = o.timing;
  const a0 = t ? t.elapsed() : 0;
  const r = await memoSwr<CachedAnswer>({
    cache: _routeCache, inflight: _routeInflight, key: o.key, freshMs: o.freshMs, staleMs: o.staleMs, force: o.force,
    load: async () => answerOf(await o.handler()), usable: o.cacheable || defaultCacheable,
  });
  if (t) { t.add('app', t.elapsed() - a0, `memo ${r.state}`); }
  const headers: Record<string, string> = {};
  for (const [k, v] of r.value.headers) headers[k] = v;
  if (o.cacheControl) headers['cache-control'] = o.cacheControl;
  headers['x-mc-memo'] = r.cached ? r.state : 'pass';
  headers['x-mc-memo-age'] = String(Math.round(r.ageMs / 1000));
  const ct = headers['content-type'] || 'application/json';
  delete headers['content-type'];
  return sendText(req, { text: r.value.text, status: r.value.status, contentType: ct, etag: r.value.status === 200 ? r.value.etag : null, headers, timing: t,
    compressKey: r.cached ? `route|${o.key}|${r.value.etag}` : null });
}
/** Drop a kept answer (after a forced rebuild of what it shows). */
export function forgetCachedRoute(key: string): void { _routeCache.delete(key); }
export function cachedRouteHas(key: string): boolean { return !!_routeCache.peek(key); }
export function _resetRouteCacheForTests(): void { _routeCache.clear(); _routeInflight.clear(); _compressed.clear(); }
