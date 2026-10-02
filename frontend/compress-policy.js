'use strict';
// zzz855 — response compression for the custom production server (server.js).
//
// Why this exists: `next start` gzips pages and static files, but App Router
// route handlers under /api went out uncompressed (e.g. /api/v1/news 239 KB
// raw). server.js wraps every response with `attachCompression` below, and
// next.config.js sets `compress: false` so Next does not also compress.
//
// Plain CommonJS on purpose: server.js runs with plain `node`, no build step.
// No npm dependency — node:zlib only. Brotli is preferred when the client
// accepts it, else gzip.

const zlib = require('node:zlib');

const MIN_BYTES = 1024;

// Types worth compressing. Anything not matched (images, fonts like woff2,
// zip, pdf, octet-stream, audio/video) is already compressed or binary.
const COMPRESSIBLE_EXACT = new Set([
  'application/json',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/xml',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/manifest+json',
  'application/ld+json',
  'application/geo+json',
  'application/graphql-response+json',
  'application/wasm',
  'application/x-www-form-urlencoded',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'font/ttf',
  'font/otf',
  'application/vnd.ms-fontobject',
]);

// Streaming types that must reach the client chunk by chunk. Flush would
// work, but there is no gain worth the risk for live streams — skip them.
const STREAMING_TYPES = new Set(['text/event-stream', 'application/x-ndjson', 'application/ndjson']);

function headerValue(headers, name) {
  if (!headers) return undefined;
  const v = headers[name] !== undefined ? headers[name] : headers[name.toLowerCase()];
  if (Array.isArray(v)) return v.join(', ');
  return v === undefined || v === null ? undefined : String(v);
}

function mimeOf(contentType) {
  if (!contentType) return '';
  return String(contentType).split(';')[0].trim().toLowerCase();
}

function isStreamingType(contentType) {
  return STREAMING_TYPES.has(mimeOf(contentType));
}

function isCompressibleType(contentType) {
  const m = mimeOf(contentType);
  if (!m) return false;
  if (STREAMING_TYPES.has(m)) return false;
  if (m.startsWith('text/')) return true; // html, css, plain, csv, x-component (RSC)
  if (COMPRESSIBLE_EXACT.has(m)) return true;
  if (m.endsWith('+json') || m.endsWith('+xml')) return true;
  return false;
}

// Parse Accept-Encoding and pick 'br', 'gzip' or null. Honours q-values,
// q=0 exclusions and '*'. Ties prefer br over gzip.
function negotiateEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;
  const q = Object.create(null);
  for (const part of String(acceptEncoding).split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) weight = Number(m[1]);
    }
    if (!Number.isFinite(weight)) weight = 0;
    q[name] = Math.max(q[name] === undefined ? -1 : q[name], weight);
  }
  const star = q['*'];
  const weightOf = (enc) => (q[enc] !== undefined ? q[enc] : star !== undefined ? star : 0);
  const br = weightOf('br');
  const gz = Math.max(weightOf('gzip'), q['x-gzip'] !== undefined ? q['x-gzip'] : -1);
  if (br <= 0 && gz <= 0) return null;
  return br >= gz ? 'br' : 'gzip';
}

/**
 * Pure decision. Returns { encoding: 'br'|'gzip'|null, vary: boolean, reason }.
 *   reqHeaders — incoming request headers (lower-case keys as Node gives them)
 *   resHeaders — response headers so far (res.getHeaders())
 *   status     — response status code
 *   opts.method     — request method (HEAD never compressed)
 *   opts.bodyLength — exact body size when known (single end() call)
 * `vary` says whether to add `Vary: Accept-Encoding` (true for any
 * compressible type, even when this client gets the plain body, so shared
 * caches keep the variants apart).
 */
function shouldCompress(reqHeaders, resHeaders, status, opts) {
  const o = opts || {};
  const contentType = headerValue(resHeaders, 'content-type');
  if (isStreamingType(contentType)) return { encoding: null, vary: false, reason: 'streaming-type' };
  const compressible = isCompressibleType(contentType);
  const no = (reason, vary) => ({ encoding: null, vary: Boolean(vary), reason });

  if (!compressible) return no('type-not-compressible', false);
  if (status === 204 || status === 304 || status === 206 || (status >= 100 && status < 200)) return no('status-' + status, false);

  const existing = headerValue(resHeaders, 'content-encoding');
  if (existing && existing.trim().toLowerCase() !== 'identity') return no('already-encoded', false);
  if (headerValue(resHeaders, 'content-range')) return no('range', false);

  const cacheControl = headerValue(resHeaders, 'cache-control');
  if (cacheControl && /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(cacheControl)) return no('no-transform', false);

  if (String(o.method || 'GET').toUpperCase() === 'HEAD') return no('head', true);

  let length = typeof o.bodyLength === 'number' ? o.bodyLength : undefined;
  if (length === undefined) {
    const cl = headerValue(resHeaders, 'content-length');
    if (cl !== undefined && /^\s*\d+\s*$/.test(cl)) length = Number(cl);
  }
  if (length !== undefined && length < MIN_BYTES) return no('small', true);

  const encoding = negotiateEncoding(headerValue(reqHeaders, 'accept-encoding'));
  if (!encoding) return no('client-no-encoding', true);
  return { encoding, vary: true, reason: 'ok' };
}

function addVary(res) {
  const cur = res.getHeader('Vary');
  const value = Array.isArray(cur) ? cur.join(', ') : cur ? String(cur) : '';
  if (value.trim() === '*') return;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === 'accept-encoding')) return;
  parts.push('Accept-Encoding');
  res.setHeader('Vary', parts.join(', '));
}

function createEncoder(encoding, sizeHint) {
  if (encoding === 'br') {
    const params = {
      // Quality 5: ~30% smaller than gzip-6 on our JSON at ~3 ms per
      // 240 KB (measured). 11 (the default) is far too slow per request.
      [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    };
    if (sizeHint > 0) params[zlib.constants.BROTLI_PARAM_SIZE_HINT] = sizeHint;
    return zlib.createBrotliCompress({ params });
  }
  return zlib.createGzip({ level: 6 });
}

function byteLength(chunk, enc) {
  if (chunk === undefined || chunk === null) return 0;
  if (typeof chunk === 'string') return Buffer.byteLength(chunk, typeof enc === 'string' ? enc : 'utf8');
  return chunk.length || chunk.byteLength || 0;
}

/**
 * Patch one Node ServerResponse so its body is compressed when the policy
 * says so. The decision is made when headers are about to be sent (first
 * writeHead / flushHeaders / write / end). `res.flush()` is provided so
 * Next's streaming (RSC/HTML) flushes each chunk to the client.
 */
function attachCompression(req, res) {
  const origWrite = res.write;
  const origEnd = res.end;
  const origWriteHead = res.writeHead;
  const origFlushHeaders = res.flushHeaders;
  let state = 'pending'; // 'pending' | 'plain' | 'compress'
  let encoder = null;
  let ending = false;

  function decide(bodyLength) {
    if (state !== 'pending') return;
    state = 'plain';
    if (res.headersSent) return;
    try {
      const d = shouldCompress(req.headers, res.getHeaders(), res.statusCode, { method: req.method, bodyLength });
      if (d.vary) addVary(res);
      if (!d.encoding) return;
      const cl = Number(res.getHeader('Content-Length'));
      encoder = createEncoder(d.encoding, Number.isFinite(cl) ? cl : bodyLength || 0);
      res.setHeader('Content-Encoding', d.encoding);
      res.removeHeader('Content-Length');
      const etag = res.getHeader('ETag');
      if (typeof etag === 'string' && !etag.startsWith('W/')) res.setHeader('ETag', 'W/' + etag);
      state = 'compress';
      encoder.on('data', (chunk) => {
        if (origWrite.call(res, chunk) === false && !res.destroyed) encoder.pause();
      });
      res.on('drain', () => { if (encoder && !res.writableNeedDrain) encoder.resume(); });
      // Writers wait on res 'drain' when write() returned false — relay the
      // encoder's own drain so they are never left waiting.
      encoder.on('drain', () => res.emit('drain'));
      encoder.on('end', () => { origEnd.call(res); });
      encoder.on('error', (err) => { res.destroy(err); });
      res.once('close', () => { if (encoder && !encoder.destroyed && !res.writableFinished) encoder.destroy(); });
    } catch (err) {
      state = 'plain';
      encoder = null;
    }
  }

  res.writeHead = function writeHead(statusCode, reason, headers) {
    if (state === 'pending' && !res.headersSent) {
      let reasonPhrase = reason;
      let hdrs = headers;
      if (typeof reason !== 'string') { hdrs = reason; reasonPhrase = undefined; }
      if (Array.isArray(hdrs)) {
        // Flat [k, v, k, v] or [[k, v]] form.
        if (hdrs.length && Array.isArray(hdrs[0])) for (const [k, v] of hdrs) res.setHeader(k, v);
        else for (let i = 0; i + 1 < hdrs.length; i += 2) res.setHeader(hdrs[i], hdrs[i + 1]);
      } else if (hdrs && typeof hdrs === 'object') {
        for (const k of Object.keys(hdrs)) if (hdrs[k] !== undefined) res.setHeader(k, hdrs[k]);
      }
      if (typeof statusCode === 'number') res.statusCode = statusCode;
      if (reasonPhrase) res.statusMessage = reasonPhrase;
      decide(undefined);
      return reasonPhrase
        ? origWriteHead.call(res, res.statusCode, reasonPhrase)
        : origWriteHead.call(res, res.statusCode);
    }
    return origWriteHead.apply(res, arguments);
  };

  // Small-body handling: Next pipes route-handler bodies (flushHeaders, then
  // write chunk, then end), so the length is not known up front. While the
  // decision is pending, chunks under MIN_BYTES are held for at most one
  // event-loop turn; if end() arrives in that time we know the exact size
  // (and skip tiny bodies), otherwise we decide without it.
  let held = [];
  let heldBytes = 0;
  let headFlushWanted = false;
  let flushWanted = false;
  let timer = null;

  function writeThrough(chunk, enc, cb) {
    if (state !== 'compress') return origWrite.call(res, chunk, enc, cb);
    if (ending) return false;
    if (!res.headersSent) res.writeHead(res.statusCode);
    if (chunk === undefined || chunk === null || byteLength(chunk, enc) === 0) { if (cb) process.nextTick(cb); return true; }
    return encoder.write(typeof chunk === 'string' ? Buffer.from(chunk, enc || 'utf8') : chunk, cb);
  }

  function release(bodyLength) {
    if (timer) { clearImmediate(timer); timer = null; }
    decide(bodyLength);
    const chunks = held;
    held = [];
    heldBytes = 0;
    let ok = true;
    for (const [c, e, cb] of chunks) ok = writeThrough(c, e, cb) && ok;
    if (headFlushWanted && !res.headersSent && typeof origFlushHeaders === 'function') origFlushHeaders.call(res);
    headFlushWanted = false;
    if (flushWanted && state === 'compress' && encoder && !ending) encoder.flush();
    flushWanted = false;
    return ok;
  }

  if (typeof origFlushHeaders === 'function') {
    res.flushHeaders = function flushHeaders() {
      if (state === 'pending' && !res.headersSent) {
        // Non-compressible / streaming responses (e.g. SSE) flush at once.
        const d = shouldCompress(req.headers, res.getHeaders(), res.statusCode, { method: req.method });
        if (d.encoding) { headFlushWanted = true; return; }
        decide(undefined);
      }
      return origFlushHeaders.apply(res, arguments);
    };
  }

  res.write = function write(chunk, enc, cb) {
    if (typeof enc === 'function') { cb = enc; enc = undefined; }
    if (state === 'pending' && !res.headersSent) {
      const d = shouldCompress(req.headers, res.getHeaders(), res.statusCode, { method: req.method });
      if (!d.encoding) { decide(undefined); return origWrite.call(res, chunk, enc, cb); }
      held.push([chunk, enc, cb]);
      heldBytes += byteLength(chunk, enc);
      if (heldBytes >= MIN_BYTES) return release(undefined);
      if (!timer) timer = setImmediate(() => { timer = null; if (state === 'pending') release(undefined); });
      return true;
    }
    if (state === 'pending') decide(undefined);
    return writeThrough(chunk, enc, cb);
  };

  res.end = function end(chunk, enc, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; enc = undefined; }
    else if (typeof enc === 'function') { cb = enc; enc = undefined; }
    if (state === 'pending' && !res.headersSent) {
      const total = heldBytes + byteLength(chunk, enc);
      release(total);
    } else if (held.length) {
      release(undefined);
    }
    if (state !== 'compress') return origEnd.call(res, chunk, enc, cb);
    if (ending) return res;
    ending = true;
    if (!res.headersSent) res.writeHead(res.statusCode);
    if (cb) res.once('finish', cb);
    if (chunk !== undefined && chunk !== null && byteLength(chunk, enc) > 0) {
      encoder.end(typeof chunk === 'string' ? Buffer.from(chunk, enc || 'utf8') : chunk);
    } else {
      encoder.end();
    }
    return res;
  };

  // Next's stream writer calls res.flush() after every chunk when present.
  res.flush = function flush() {
    if (state === 'pending') { flushWanted = true; return; }
    if (state === 'compress' && encoder && !ending) encoder.flush();
  };

  res.once('close', () => { if (timer) { clearImmediate(timer); timer = null; } });

  return res;
}

module.exports = {
  MIN_BYTES,
  negotiateEncoding,
  isCompressibleType,
  isStreamingType,
  shouldCompress,
  attachCompression,
};
