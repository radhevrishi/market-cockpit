// zzz796 — service worker rules, run against the real public/sw.js in a sandbox.
// Run: npx tsx --test src/lib/__tests__/zzz796-pwa-sw.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SRC = readFileSync(join(__dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://cockpit.example';

interface FakeCache { store: Map<string, Response> }

function loadWorker(opts: { version?: string; fetchImpl?: (r: Request) => Promise<Response>; existingCaches?: string[] } = {}) {
  const handlers: Record<string, (e: any) => void> = {};
  const cacheMap = new Map<string, FakeCache>();
  for (const n of opts.existingCaches || []) cacheMap.set(n, { store: new Map() });
  const keyOf = (r: Request | string) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
  const openCache = (name: string) => {
    if (!cacheMap.has(name)) cacheMap.set(name, { store: new Map() });
    const c = cacheMap.get(name)!;
    return {
      match: async (r: Request | string) => { const hit = c.store.get(keyOf(r)); return hit ? hit.clone() : undefined; },
      put: async (r: Request | string, res: Response) => { c.store.set(keyOf(r), res); },
      keys: async () => [...c.store.keys()].map((k) => new Request(k)),
      delete: async (r: Request | string) => c.store.delete(keyOf(r)),
    };
  };
  const fetched: string[] = [];
  const self: any = {
    location: { href: `${ORIGIN}/sw.js?v=${opts.version ?? 'build123'}`, origin: ORIGIN },
    addEventListener: (type: string, fn: (e: any) => void) => { handlers[type] = fn; },
    clients: { claim: async () => {} },
    skipped: false,
    skipWaiting() { this.skipped = true; },
  };
  const ctx = vm.createContext({
    self, URL, Request, Response, Promise, console,
    caches: {
      open: async (n: string) => openCache(n),
      keys: async () => [...cacheMap.keys()],
      delete: async (n: string) => cacheMap.delete(n),
    },
    fetch: async (r: Request | string) => {
      const req = typeof r === 'string' ? new Request(new URL(r, ORIGIN).href) : r;
      fetched.push(req.url);
      return (opts.fetchImpl || (async () => new Response('net', { status: 200 })))(req);
    },
  });
  vm.runInContext(SRC, ctx);
  return { self, handlers, cacheMap, fetched };
}

function fakeReq(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
  const h = new Headers(init.headers || {});
  return { url: new URL(url, ORIGIN).href, method: init.method || 'GET', mode: init.mode || 'cors', headers: h };
}

// Constructed Responses have type 'default'; real same-origin ones are 'basic'
// (the only kind the worker stores). Emulate that for a test.
async function asBasic<T>(fn: () => Promise<T>): Promise<T> {
  const orig = Object.getOwnPropertyDescriptor(Response.prototype, 'type')!;
  Object.defineProperty(Response.prototype, 'type', { configurable: true, get: () => 'basic' });
  try { return await fn(); } finally { Object.defineProperty(Response.prototype, 'type', orig); }
}

async function dispatchFetch(w: ReturnType<typeof loadWorker>, req: any) {
  const box: { p: Promise<Response> | null } = { p: null };
  const waits: Promise<any>[] = [];
  w.handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => { box.p = Promise.resolve(p); }, waitUntil: (p: Promise<any>) => waits.push(p) });
  const res: Response | null = box.p ? await box.p : null;
  await Promise.all(waits);
  return res;
}

describe('routing rules', () => {
  const w = loadWorker();
  const route = (url: string, init?: any) => w.self.__mcRoute(fakeReq(url, init), ORIGIN);

  test('never touches /api/*, login, POST, auth headers or other sites', () => {
    assert.equal(route('/api/v1/book/state'), 'bypass');
    assert.equal(route('/api/portfolio', { mode: 'navigate' }), 'bypass');
    assert.equal(route('/api'), 'bypass');
    assert.equal(route('/login', { mode: 'navigate' }), 'bypass');
    assert.equal(route('/login?next=%2F', { mode: 'navigate' }), 'bypass');
    assert.equal(route('/register', { mode: 'navigate' }), 'bypass');
    assert.equal(route('/_next/static/chunks/app.js', { method: 'POST' }), 'bypass');
    assert.equal(route('/portfolio', { mode: 'navigate', method: 'POST' }), 'bypass');
    assert.equal(route('/_next/static/chunks/app.js', { headers: { Authorization: 'Bearer x' } }), 'bypass');
    assert.equal(route('/icon-192.png', { headers: { 'x-mc-key': 'k' } }), 'bypass');
    assert.equal(route('https://www.nseindia.com/api/x'), 'bypass');
    assert.equal(route('/sw.js'), 'bypass');
    assert.equal(route('/portfolio?_rsc=abc'), 'bypass', 'React Server Component data is private and never cached');
  });

  test('pages are network-first with the offline fallback', () => {
    assert.equal(route('/', { mode: 'navigate' }), 'navigate');
    assert.equal(route('/us-portfolio-book', { mode: 'navigate' }), 'navigate');
  });

  test('hashed build files and icons are cache-first', () => {
    assert.equal(route('/_next/static/chunks/main-abc123.js'), 'cache-first');
    assert.equal(route('/_next/static/css/app.css'), 'cache-first');
    assert.equal(route('/icon-512.png'), 'cache-first');
    assert.equal(route('/icons/shortcut-home.png'), 'cache-first');
    assert.equal(route('/apple-touch-icon.png'), 'cache-first');
  });

  test('cache names carry the deploy version', () => {
    assert.equal(w.self.__mcVersion, 'build123');
  });
});

describe('behaviour', () => {
  test('an /api response is never stored, even on GET', async () => {
    const w = loadWorker();
    const res = await dispatchFetch(w, new Request(`${ORIGIN}/api/v1/book/state`));
    assert.equal(res, null, 'respondWith not called — browser handles it');
    for (const c of w.cacheMap.values()) assert.equal(c.store.size, 0);
  });

  test('a page is fetched from the network and NOT stored', async () => {
    const w = loadWorker({ fetchImpl: async () => new Response('<html>private</html>', { status: 200 }) });
    const req = fakeReq('/portfolio', { mode: 'navigate' });
    const res = await asBasic(() => dispatchFetch(w, req));
    assert.equal(await res!.text(), '<html>private</html>');
    for (const c of w.cacheMap.values()) assert.equal(c.store.size, 0, 'no page HTML cached');
  });

  test('offline navigation falls back to /offline.html from the install-time cache', async () => {
    let online = true;
    const w = loadWorker({
      fetchImpl: async (r) => {
        if (!online) throw new TypeError('Failed to fetch');
        return new Response(r.url.endsWith('/offline.html') ? 'OFFLINE PAGE' : 'x', { status: 200 });
      },
    });
    await asBasic(async () => {
      const waits: Promise<any>[] = [];
      w.handlers.install({ waitUntil: (p: Promise<any>) => waits.push(p) });
      await Promise.all(waits);
    });
    online = false;
    const res = await dispatchFetch(w, fakeReq('/us-portfolio-catalysts', { mode: 'navigate' }));
    assert.equal(await res!.text(), 'OFFLINE PAGE');
  });

  test('offline with nothing cached still shows a plain offline message', async () => {
    const w = loadWorker({ fetchImpl: async () => { throw new TypeError('offline'); } });
    const res = await dispatchFetch(w, fakeReq('/', { mode: 'navigate' }));
    assert.equal(res!.status, 503);
    assert.match(await res!.text(), /offline/i);
  });

  test('static files: second request is served from cache', async () => {
    let n = 0;
    const w = loadWorker({ fetchImpl: async () => { n++; return new Response('js', { status: 200 }); } });
    await asBasic(async () => {
      const r1 = await dispatchFetch(w, new Request(`${ORIGIN}/_next/static/chunks/a.js`));
      const r2 = await dispatchFetch(w, new Request(`${ORIGIN}/_next/static/chunks/a.js`));
      assert.equal(await r1!.text(), 'js');
      assert.equal(await r2!.text(), 'js');
      assert.equal(n, 1, 'network hit once');
    });
  });

  test('activate deletes caches from older deploys, keeps other sites\' caches', async () => {
    const w = loadWorker({ version: 'new', existingCaches: ['mc-pwa-static-old', 'mc-pwa-offline-old', 'mc-pwa-static-new', 'someone-else'] });
    const waits: Promise<any>[] = [];
    w.handlers.activate({ waitUntil: (p: Promise<any>) => waits.push(p) });
    await Promise.all(waits);
    const names = [...w.cacheMap.keys()].sort();
    assert.deepEqual(names, ['mc-pwa-static-new', 'someone-else']);
  });

  test('new version waits until the app asks (SKIP_WAITING message)', () => {
    const w = loadWorker();
    assert.match(SRC, /addEventListener\('install'/);
    assert.doesNotMatch(SRC.split("addEventListener('install'")[1].split("addEventListener('activate'")[0], /skipWaiting\(\)/);
    w.handlers.message({ data: { type: 'OTHER' } });
    assert.equal(w.self.skipped, false);
    w.handlers.message({ data: { type: 'SKIP_WAITING' } });
    assert.equal(w.self.skipped, true);
  });
});

describe('registration', () => {
  test('registered per deploy, production only, bypassing the HTTP cache', () => {
    const reg = readFileSync(join(__dirname, '..', '..', 'components', 'pwa', 'PwaRegister.tsx'), 'utf8');
    assert.match(reg, /process\.env\.NODE_ENV !== 'production'/);
    assert.match(reg, /register\(`\/sw\.js\?v=\$\{encodeURIComponent\(version\)\}`/);
    assert.match(reg, /updateViaCache: 'none'/);
    assert.match(reg, /Update available/);
    assert.match(reg, /SKIP_WAITING/);
  });
});
