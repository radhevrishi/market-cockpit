// zzz908 — shared network resilience for the GitHub-hosted collectors.
//
// installResilientFetch() (called at a collector's entry point) wraps globalThis.fetch so every
// request the collector makes is retried on TRANSIENT failures only:
//   - network errors: ECONNRESET, ETIMEDOUT, ECONNREFUSED, EAI_AGAIN, ENOTFOUND, socket hang up,
//     undici "fetch failed" / UND_ERR_* (connect timeout, headers timeout, socket closed)
//   - HTTP 429 (honours Retry-After, capped), 500, 502, 503, 504, 520-524 (Cloudflare)
// It does NOT retry: other 4xx (auth / not found / too large are real problems), a request whose
// caller-supplied AbortSignal already fired (a timeout the caller chose — retrying would blow the
// caller's own time budget), or a request whose body is a one-shot stream.
//
// Tuning (env): MC_FETCH_RETRIES (default 2 extra attempts), MC_FETCH_BACKOFF_MS (default 1500),
// MC_FETCH_MAX_WAIT_MS (default 30000, cap for Retry-After).
//
// Exit-code convention (see docs/RELIABILITY.md): a collector that could not update its data only
// because an upstream was down / not yet published exits with EXIT_TRANSIENT (75, EX_TEMPFAIL).
// The workflow step maps 75 to a green run with a warning + a "deferred" heartbeat note, so the
// owner is not emailed for an outage that the next scheduled run will cover. Real bugs (code
// exceptions, auth errors, malformed data, missing secrets) still exit 1 and stay red.

export const EXIT_TRANSIENT = 75;

const RETRIES = clampInt(process.env.MC_FETCH_RETRIES, 2, 0, 6);
const BACKOFF_MS = clampInt(process.env.MC_FETCH_BACKOFF_MS, 1500, 0, 60_000);
const MAX_WAIT_MS = clampInt(process.env.MC_FETCH_MAX_WAIT_MS, 30_000, 0, 120_000);
const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

const stats = { retries: 0, transientGiveUps: 0 };
export function fetchStats() { return { ...stats }; }

function clampInt(v, d, lo, hi) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
}

const TRANSIENT_NET_RE = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|ENETUNREACH|EHOSTUNREACH|socket hang up|other side closed|fetch failed|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)|network ?error|TLS connection was not established/i;

function errText(e) {
  if (!e) return '';
  const parts = [e.name, e.code, e.message];
  if (e.cause) parts.push(e.cause.name, e.cause.code, e.cause.message);
  return parts.filter(Boolean).join(' ');
}

/** True for network-level failures worth retrying (not for an abort the caller asked for). */
export function isTransientNetworkError(e) {
  return TRANSIENT_NET_RE.test(errText(e));
}

/**
 * Classify a final error that made a collector give up.
 * transient = upstream down / slow / rate-limited / not published yet → the next run will cover it.
 * Anything else (TypeError from our own code, HTTP 401/403/404/413, JSON shape errors, missing secrets)
 * is a real problem and must stay red.
 */
export function isTransientError(e) {
  if (!e) return false;
  if (e.transient === true) return true;
  if (e.transient === false) return false;
  const t = errText(e);
  if (TRANSIENT_NET_RE.test(t)) return true;
  if (/TimeoutError|timed? ?out|The operation was aborted due to timeout/i.test(t)) return true;
  // "HTTP 503", "status 502", "failed 429", "→ 504" — status codes our scripts put in messages.
  if (/\b(HTTP|status|failed|code|→|->)\s*:?\s*(429|5\d\d)\b/i.test(t)) return true;
  return false;
}

/** Error that marks an upstream as temporarily unavailable (data simply not updated this run). */
export class TransientUpstreamError extends Error {
  constructor(message) { super(message); this.name = 'TransientUpstreamError'; this.transient = true; }
}

function oneLine(s, n = 300) { return String(s ?? '').replace(/\s+/g, ' ').slice(0, n); }

/** Exit "deferred": upstream not available / not published yet. Workflow maps code 75 to green + warning. */
export function exitTransient(message) {
  console.log(`::warning title=Upstream not available — deferred to the next run::${oneLine(message)}`);
  process.exit(EXIT_TRANSIENT);
}

/** Final handler for main().catch(): transient → 75 (green + warning), anything else → 1 (red). */
export function exitForError(e, title = 'Collector failed') {
  const msg = oneLine(e?.message || e);
  if (isTransientError(e)) exitTransient(`${title}: ${msg}`);
  console.error(`::error title=${title}::${msg}`);
  if (e?.stack) console.error(String(e.stack).split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

function bodyIsReplayable(body) {
  if (body == null) return true;
  if (typeof body === 'string') return true;
  if (body instanceof URLSearchParams) return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  return false;   // ReadableStream / async iterable: one-shot
}

function retryAfterMs(res) {
  const h = res.headers?.get?.('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoff(attempt, baseMs = BACKOFF_MS) {
  const base = baseMs * 2 ** attempt;          // 1.5s, 3s, 6s ...
  return Math.min(MAX_WAIT_MS, Math.round(base * (0.75 + Math.random() * 0.5)));
}

/** fetch with retries on transient failures. Same signature as fetch. */
export function makeResilientFetch(baseFetch, { retries = RETRIES, backoffMs = BACKOFF_MS, log = (m) => console.log(m) } = {}) {
  return async function resilientFetch(input, init = undefined) {
    const signal = init?.signal || (typeof input === 'object' && input?.signal) || null;
    const canReplay = bodyIsReplayable(init?.body) && !(typeof Request !== 'undefined' && input instanceof Request && input.body);
    const label = (() => { try { const u = new URL(typeof input === 'string' ? input : input.url); return `${init?.method || 'GET'} ${u.host}${u.pathname.slice(0, 60)}`; } catch { return 'request'; } })();
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await baseFetch(input, init);
        if (!RETRY_STATUS.has(res.status) || attempt >= retries || !canReplay || signal?.aborted) {
          if (RETRY_STATUS.has(res.status) && attempt >= retries) stats.transientGiveUps++;
          return res;
        }
        let wait = backoff(attempt, backoffMs);
        if (res.status === 429 || res.status === 503) {
          const ra = retryAfterMs(res);
          if (ra != null) wait = Math.min(MAX_WAIT_MS, Math.max(wait, ra));
        }
        try { await res.body?.cancel?.(); } catch { /* ignore */ }
        stats.retries++;
        log(`  [retry] ${label} → HTTP ${res.status}; retry ${attempt + 1}/${retries} in ${Math.round(wait / 100) / 10}s`);
        await sleep(wait);
      } catch (e) {
        // The caller's own timeout / abort: honour it, do not retry.
        if (signal?.aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError') throw e;
        if (!isTransientNetworkError(e) || attempt >= retries || !canReplay) {
          if (isTransientNetworkError(e)) stats.transientGiveUps++;
          throw e;
        }
        const wait = backoff(attempt, backoffMs);
        stats.retries++;
        log(`  [retry] ${label} → ${oneLine(errText(e), 80)}; retry ${attempt + 1}/${retries} in ${Math.round(wait / 100) / 10}s`);
        await sleep(wait);
      }
    }
  };
}

/**
 * Wrap globalThis.fetch once per process. Called by each collector at its entry point (never at import
 * time, so a test that imports a collector's helpers keeps its own fetch).
 */
export function installResilientFetch() {
  if (typeof globalThis.fetch === 'function' && !globalThis.fetch.__mcResilient) {
    const wrapped = makeResilientFetch(globalThis.fetch.bind(globalThis));
    wrapped.__mcResilient = true;
    globalThis.fetch = wrapped;
  }
  return globalThis.fetch;
}
