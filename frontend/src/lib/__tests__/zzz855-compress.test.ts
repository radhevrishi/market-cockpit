// zzz855 — response compression policy + wrapper used by server.js.
// Run: npx tsx --test src/lib/__tests__/zzz855-compress.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';

const req = createRequire(__filename);
const policy = req('../../../compress-policy.js') as {
  MIN_BYTES: number;
  negotiateEncoding: (h: string | undefined) => 'br' | 'gzip' | null;
  isCompressibleType: (t: string | undefined) => boolean;
  shouldCompress: (
    reqHeaders: Record<string, any>,
    resHeaders: Record<string, any>,
    status: number,
    opts?: { method?: string; bodyLength?: number },
  ) => { encoding: 'br' | 'gzip' | null; vary: boolean; reason: string };
  attachCompression: (req: http.IncomingMessage, res: http.ServerResponse) => void;
};
const { negotiateEncoding, isCompressibleType, shouldCompress, attachCompression } = policy;

const AE = { 'accept-encoding': 'gzip, deflate, br' };
const JSON_H = { 'content-type': 'application/json' };

describe('negotiateEncoding', () => {
  test('prefers br, falls back to gzip, none otherwise', () => {
    assert.equal(negotiateEncoding('gzip, deflate, br'), 'br');
    assert.equal(negotiateEncoding('gzip, deflate'), 'gzip');
    assert.equal(negotiateEncoding('deflate'), null);
    assert.equal(negotiateEncoding(''), null);
    assert.equal(negotiateEncoding(undefined), null);
    assert.equal(negotiateEncoding('identity'), null);
  });
  test('honours q-values and exclusions', () => {
    assert.equal(negotiateEncoding('br;q=0, gzip'), 'gzip');
    assert.equal(negotiateEncoding('br;q=0.2, gzip;q=0.8'), 'gzip');
    assert.equal(negotiateEncoding('gzip;q=0, br;q=0'), null);
    assert.equal(negotiateEncoding('*'), 'br');
    assert.equal(negotiateEncoding('*, br;q=0'), 'gzip');
    assert.equal(negotiateEncoding('x-gzip'), 'gzip');
    assert.equal(negotiateEncoding('GZIP'), 'gzip');
  });
});

describe('isCompressibleType', () => {
  test('text-like types', () => {
    for (const t of ['application/json', 'application/json; charset=utf-8', 'text/html; charset=utf-8', 'text/css',
      'text/x-component', 'application/javascript; charset=UTF-8', 'image/svg+xml', 'application/manifest+json',
      'application/vnd.api+json', 'text/csv']) assert.equal(isCompressibleType(t), true, t);
  });
  test('binary / already-compressed / streaming types', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'application/zip', 'application/pdf',
      'application/octet-stream', 'font/woff2', 'video/mp4', 'text/event-stream', 'application/x-ndjson', '', undefined])
      assert.equal(isCompressibleType(t as any), false, String(t));
  });
});

describe('shouldCompress', () => {
  test('large JSON with br accepted → br + vary', () => {
    const d = shouldCompress(AE, JSON_H, 200, { method: 'GET', bodyLength: 50_000 });
    assert.equal(d.encoding, 'br');
    assert.equal(d.vary, true);
  });
  test('unknown length (streamed) still compresses', () => {
    assert.equal(shouldCompress(AE, JSON_H, 200, { method: 'GET' }).encoding, 'br');
  });
  test('small body skipped (exact length or Content-Length)', () => {
    assert.equal(shouldCompress(AE, JSON_H, 200, { bodyLength: 46 }).encoding, null);
    assert.equal(shouldCompress(AE, { ...JSON_H, 'content-length': '900' }, 200).encoding, null);
    assert.equal(shouldCompress(AE, { ...JSON_H, 'content-length': '1024' }, 200).encoding, 'br');
    // Small but compressible type still gets Vary.
    assert.equal(shouldCompress(AE, JSON_H, 200, { bodyLength: 46 }).vary, true);
  });
  test('client without Accept-Encoding gets plain body but Vary', () => {
    const d = shouldCompress({}, JSON_H, 200, { bodyLength: 50_000 });
    assert.equal(d.encoding, null);
    assert.equal(d.vary, true);
  });
  test('HEAD / 204 / 304 / 206 never compressed', () => {
    assert.equal(shouldCompress(AE, JSON_H, 200, { method: 'HEAD' }).encoding, null);
    assert.equal(shouldCompress(AE, JSON_H, 204).encoding, null);
    assert.equal(shouldCompress(AE, JSON_H, 304).encoding, null);
    assert.equal(shouldCompress(AE, { ...JSON_H, 'content-range': 'bytes 0-99/5000' }, 206).encoding, null);
  });
  test('already encoded / no-transform / SSE / binary skipped', () => {
    assert.equal(shouldCompress(AE, { ...JSON_H, 'content-encoding': 'gzip' }, 200).encoding, null);
    assert.equal(shouldCompress(AE, { ...JSON_H, 'content-encoding': 'identity' }, 200).encoding, 'br');
    assert.equal(shouldCompress(AE, { ...JSON_H, 'cache-control': 'public, no-transform' }, 200).encoding, null);
    const sse = shouldCompress(AE, { 'content-type': 'text/event-stream' }, 200);
    assert.equal(sse.encoding, null);
    assert.equal(sse.vary, false);
    assert.equal(shouldCompress(AE, { 'content-type': 'image/png' }, 200).encoding, null);
    assert.equal(shouldCompress(AE, {}, 200).encoding, null); // no content-type → leave alone
  });
  test('error pages still compress (HTML 404/500)', () => {
    assert.equal(shouldCompress(AE, { 'content-type': 'text/html' }, 404).encoding, 'br');
    assert.equal(shouldCompress(AE, { 'content-type': 'text/html' }, 500).encoding, 'br');
  });
});

// ── End-to-end through a real http server with the wrapper attached ─────
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => unknown;
async function withServer(handler: Handler, fn: (port: number) => Promise<void>) {
  const server = http.createServer((rq, rs) => { attachCompression(rq, rs); handler(rq, rs); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try { await fn((server.address() as AddressInfo).port); }
  finally { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); }
}
function get(port: number, path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; raw: Buffer }>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, headers, method }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, raw: Buffer.concat(parts) }));
    });
    r.on('error', reject);
    r.end();
  });
}
function decode(enc: string | undefined, b: Buffer) {
  if (enc === 'br') return zlib.brotliDecompressSync(b);
  if (enc === 'gzip') return zlib.gunzipSync(b);
  return b;
}
const bigJson = JSON.stringify({ items: Array.from({ length: 3000 }, (_, i) => ({ i, ticker: `T${i}`, headline: 'Quarterly results beat estimates' })) });

describe('attachCompression (http)', () => {
  test('single end(json): br and gzip decode identical; Content-Length dropped; Vary set', async () => {
    await withServer((_q, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', Buffer.byteLength(bigJson));
      res.setHeader('Vary', 'RSC');
      res.end(bigJson);
    }, async (port) => {
      for (const [ae, want] of [['gzip, br', 'br'], ['gzip', 'gzip']] as const) {
        const r = await get(port, '/', { 'accept-encoding': ae });
        assert.equal(r.headers['content-encoding'], want);
        assert.equal(r.headers['content-length'], undefined);
        assert.equal(r.headers['vary'], 'RSC, Accept-Encoding');
        assert.ok(r.raw.length < bigJson.length / 4);
        assert.deepEqual(JSON.parse(decode(want, r.raw).toString()), JSON.parse(bigJson));
      }
      const plain = await get(port, '/', {});
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(plain.raw.toString(), bigJson);
      assert.equal(plain.headers['vary'], 'RSC, Accept-Encoding');
    });
  });

  test('Next-style pipe (flushHeaders + write + flush + end) of a tiny body is NOT compressed', async () => {
    await withServer((_q, res) => {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      res.flushHeaders();
      res.write(Buffer.from('{"error":"upstream unavailable","x":1}'));
      (res as any).flush?.();
      Promise.resolve().then(() => Promise.resolve()).then(() => res.end()); // like ReadableStream.pipeTo close
    }, async (port) => {
      const r = await get(port, '/', { 'accept-encoding': 'gzip, br' });
      assert.equal(r.status, 503);
      assert.equal(r.headers['content-encoding'], undefined);
      assert.equal(r.raw.toString(), '{"error":"upstream unavailable","x":1}');
    });
  });

  test('many writes with backpressure (5 MB) round-trip exactly', async () => {
    const chunk = Buffer.from(bigJson);
    await withServer((_q, res) => {
      res.setHeader('content-type', 'application/json');
      let n = 0;
      const pump = () => {
        while (n < 40) {
          n++;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        res.end();
      };
      pump();
    }, async (port) => {
      const r = await get(port, '/', { 'accept-encoding': 'br' });
      assert.equal(r.headers['content-encoding'], 'br');
      const out = decode('br', r.raw);
      assert.equal(out.length, chunk.length * 40);
      assert.ok(out.equals(Buffer.concat(Array(40).fill(chunk))));
    });
  });

  test('streaming: flushed first chunk reaches the client before the stream ends', async () => {
    await withServer((_q, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.flushHeaders();
      res.write('<html><body>' + 'shell '.repeat(400));
      (res as any).flush();
      setTimeout(() => { res.write('<div>late</div>'); (res as any).flush(); res.end('</body></html>'); }, 400);
    }, async (port) => {
      const t0 = Date.now();
      const firstAt = await new Promise<{ ms: number; text: string; enc?: string }>((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path: '/', headers: { 'accept-encoding': 'gzip' } }, (res) => {
          const dec = zlib.createGunzip();
          res.pipe(dec);
          let text = '';
          let done = false;
          dec.on('data', (d) => {
            text += d.toString();
            if (!done && text.includes('shell')) { done = true; resolve({ ms: Date.now() - t0, text, enc: res.headers['content-encoding'] as string }); }
          });
          dec.on('end', () => { if (!done) reject(new Error('no early data')); });
        });
        r.on('error', reject);
        r.end();
      });
      assert.equal(firstAt.enc, 'gzip');
      assert.ok(firstAt.ms < 300, `first chunk took ${firstAt.ms} ms`);
    });
  });

  test('SSE is passed through uncompressed and unbuffered', async () => {
    await withServer((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write('data: 1\n\n');
      setTimeout(() => res.end('data: 2\n\n'), 200);
    }, async (port) => {
      const r = await get(port, '/', { 'accept-encoding': 'gzip, br' });
      assert.equal(r.headers['content-encoding'], undefined);
      assert.equal(r.raw.toString(), 'data: 1\n\ndata: 2\n\n');
    });
  });

  test('HEAD, 304, binary and pre-encoded responses untouched', async () => {
    const gz = zlib.gzipSync(Buffer.from(bigJson));
    await withServer((q, res) => {
      if (q.url === '/304') { res.statusCode = 304; res.setHeader('content-type', 'application/json'); return res.end(); }
      if (q.url === '/png') { res.setHeader('content-type', 'image/png'); return res.end(Buffer.alloc(5000, 1)); }
      if (q.url === '/pre') { res.setHeader('content-type', 'application/json'); res.setHeader('content-encoding', 'gzip'); return res.end(gz); }
      res.setHeader('content-type', 'application/json');
      return res.end(bigJson);
    }, async (port) => {
      const h = await get(port, '/', { 'accept-encoding': 'br' }, 'HEAD');
      assert.equal(h.headers['content-encoding'], undefined);
      assert.equal((await get(port, '/304', { 'accept-encoding': 'br' })).status, 304);
      const png = await get(port, '/png', { 'accept-encoding': 'br' });
      assert.equal(png.headers['content-encoding'], undefined);
      assert.equal(png.raw.length, 5000);
      const pre = await get(port, '/pre', { 'accept-encoding': 'br' });
      assert.equal(pre.headers['content-encoding'], 'gzip');
      assert.ok(pre.raw.equals(gz));
    });
  });

  test('strong ETag is weakened when the body is re-encoded', async () => {
    await withServer((_q, res) => {
      res.setHeader('content-type', 'application/javascript');
      res.setHeader('etag', '"abc123"');
      res.end(bigJson);
    }, async (port) => {
      const r = await get(port, '/', { 'accept-encoding': 'gzip' });
      assert.equal(r.headers['etag'], 'W/"abc123"');
    });
  });
});
