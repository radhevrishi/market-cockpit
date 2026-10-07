// zzz855 — app shell speed: prefetch policy, shared shell requests, timers that sleep while hidden,
// service worker registration / update checks / navigation preload, and capped long lists on
// Guidance Upgrades and the Special Situations radar. Synthetic data only.
// Run: npx tsx --test src/lib/__tests__/zzz855-shell.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { shellFetchJson, _resetShellFetch, visibleInterval, swUpdateDue, SW_UPDATE_GAP_MS, navPrefetch, PREFETCH_FAVOURITES } from '../shell-fetch';
import { CappedList, LazyDetails, cappedCount, moreText, LIST_STEP } from '../../components/guidance-upgrades/GuMore';
import { GuAuditArea } from '../../components/guidance-upgrades/GuCard';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('shared shell requests', () => {
  test('identical GETs share one request; the answer is reused; failures are not remembered', async () => {
    _resetShellFetch();
    const orig = globalThis.fetch;
    let calls = 0;
    let ok = false;
    (globalThis as any).fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return ok ? new Response('{"n":1}', { status: 200 }) : new Response('no', { status: 503 }); };
    try {
      const [a, b] = await Promise.all([shellFetchJson('/api/x'), shellFetchJson('/api/x')]);
      assert.equal(calls, 1, 'one request for two callers');
      assert.equal(a, null); assert.equal(b, null);
      ok = true;
      const c = await shellFetchJson<{ n: number }>('/api/x');
      assert.equal(calls, 2, 'a failure is retried, never cached as empty');
      assert.deepEqual(c, { n: 1 });
      const d = await shellFetchJson('/api/x');
      assert.equal(calls, 2, 'served from the short memo');
      assert.deepEqual(d, { n: 1 });
      await shellFetchJson('/api/x', { ttlMs: 0 });
      assert.equal(calls, 3, 'memo expires');
    } finally { (globalThis as any).fetch = orig; _resetShellFetch(); }
  });
});

describe('timers that sleep while the tab is hidden', () => {
  test('no ticks while hidden; one catch-up when visible again', async () => {
    const listeners: Record<string, () => void> = {};
    const doc = { hidden: false, addEventListener: (t: string, f: () => void) => { listeners[t] = f; }, removeEventListener: (t: string) => { delete listeners[t]; } };
    let n = 0;
    const stop = visibleInterval(() => { n++; }, 5, doc);
    try {
    await new Promise((r) => setTimeout(r, 22));
    assert.ok(n >= 2, `ticks while visible (${n})`);
    doc.hidden = true; const before = n;
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(n, before, 'nothing runs while hidden');
    doc.hidden = false; listeners.visibilitychange();
    assert.equal(n, before + 1, 'one catch-up on return');
    stop();
    assert.equal(listeners.visibilitychange, undefined, 'cleanup removes the listener');
    } finally { stop(); }
  });
  test('service worker update check at most once an hour', () => {
    assert.equal(swUpdateDue(null, 1000), true);
    assert.equal(swUpdateDue(0, SW_UPDATE_GAP_MS - 1), false);
    assert.equal(swUpdateDue(0, SW_UPDATE_GAP_MS), true);
    assert.ok(SW_UPDATE_GAP_MS >= 30 * 60_000);
  });
});

describe('prefetch policy', () => {
  test('only Home and the first few favourites prefetch', () => {
    assert.equal(navPrefetch('/', null), undefined);
    assert.equal(navPrefetch('/news', null), false);
    assert.equal(navPrefetch('/news', 0), undefined);
    assert.equal(navPrefetch('/news', PREFETCH_FAVOURITES - 1), undefined);
    assert.equal(navPrefetch('/news', PREFETCH_FAVOURITES), false);
    assert.ok(PREFETCH_FAVOURITES <= 3);
  });
  test('every sidebar, menu and chip link in the shell sets a prefetch policy', () => {
    // every <Link ...>...</Link> block (attributes span several lines)
    const blocks = (src: string) => src.split(/<Link\s/).slice(1).map((b) => b.slice(0, b.indexOf('</Link>')));
    const nav = blocks(read('app/(dashboard)/DashboardClient.tsx'));
    const home = nav.filter((b) => /^\s*href="\/"/.test(b));
    const others = nav.filter((b) => !/^\s*href="\/"/.test(b));
    assert.ok(others.length >= 4, `${others.length} links`);
    for (const b of others) assert.match(b, /prefetch=/, b.slice(0, 80));
    assert.equal(home.length, 1, 'the MC home badge keeps the default prefetch');
    const mob = blocks(read('components/pwa/MobileNav.tsx')).filter((b) => !/^\s*href="\/"/.test(b));
    assert.ok(mob.length >= 4);
    for (const b of mob) assert.match(b, /prefetch=/, b.slice(0, 80));
    for (const f of ['app/(dashboard)/DashboardClient.tsx', 'components/pwa/MobileNav.tsx', 'components/pwa/PwaRegister.tsx', 'components/RegimeBanner.tsx', 'components/MarketHours.tsx']) {
      assert.ok(!/router\.prefetch|\.prefetch\(/.test(read(f)), `${f} has no prefetch loop`);
    }
  });
});

describe('shell polling', () => {
  test('the dead header-ticker query is gone; bench chips read once, after idle, shared', () => {
    const nav = read('app/(dashboard)/DashboardClient.tsx');
    const code = nav.replace(/\/\/.*$/gm, '');
    assert.ok(!/refetchInterval/.test(code), 'no polling query in the shell');
    assert.ok(!/'market', 'indices'/.test(code));
    assert.ok(!/mc:ticker-bar/.test(code), 'no localStorage write for a bar that is not shown');
    assert.match(code, /shellFetchJson<any>\('\/api\/v1\/bench\?view=tickers'\)/);
    assert.match(code, /shellFetchJson<any>\('\/api\/v1\/bench-us\?view=tickers'\)/);
    assert.match(code, /whenIdle\(/);
    assert.match(code, /dynamic\(\(\) => import\('@\/components\/TickerDrawer'\)/);
    // the CB chip and its wording are unchanged
    assert.match(nav, /🏆 CB \{convictionCount \+ \(usBenchCount \|\| 0\)\}/);
  });
  test('market-hours clock sleeps while hidden; regime read starts after idle', () => {
    assert.match(read('components/MarketHours.tsx'), /visibleInterval\(\(\) => setTick/);
    assert.ok(!/setInterval/.test(read('components/MarketHours.tsx').replace(/\/\/.*$|\*.*$/gm, '')));
    assert.match(read('components/RegimeBanner.tsx'), /whenIdle\(/);
  });
});

describe('service worker', () => {
  test('registration waits for load + idle; update checks are throttled', () => {
    const reg = read('components/pwa/PwaRegister.tsx');
    assert.match(reg, /whenIdle\(register/);
    assert.match(reg, /window\.addEventListener\('load', afterLoad, \{ once: true \}\)/);
    assert.match(reg, /swUpdateDue\(lastCheck, now\)/);
    assert.match(reg, /register\(`\/sw\.js\?v=\$\{encodeURIComponent\(version\)\}`/);
  });

  const SW = readFileSync(join(SRC, '..', 'public', 'sw.js'), 'utf8');
  const ORIGIN = 'https://cockpit.example';
  function load(registration?: any) {
    const handlers: Record<string, (e: any) => void> = {};
    const fetched: string[] = [];
    const self: any = { location: { href: `${ORIGIN}/sw.js?v=b1`, origin: ORIGIN }, addEventListener: (t: string, f: any) => { handlers[t] = f; }, clients: { claim: async () => {} }, registration };
    vm.runInContext(SW, vm.createContext({
      self, URL, Request, Response, Promise, console,
      caches: { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => true }), keys: async () => [], delete: async () => true },
      fetch: async (r: any) => { fetched.push(typeof r === 'string' ? r : r.url); return new Response('net', { status: 200 }); },
    }));
    return { handlers, fetched };
  }
  const nav = (path: string) => ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate', headers: new Headers() });

  test('activate turns on navigation preload when the browser has it (and copes when it does not)', async () => {
    let enabled = 0;
    const w = load({ navigationPreload: { enable: async () => { enabled++; } } });
    const waits: Promise<any>[] = [];
    w.handlers.activate({ waitUntil: (p: Promise<any>) => waits.push(p) });
    await Promise.all(waits);
    assert.equal(enabled, 1);
    const w2 = load(undefined);
    const waits2: Promise<any>[] = [];
    w2.handlers.activate({ waitUntil: (p: Promise<any>) => waits2.push(p) });
    await Promise.all(waits2);
  });
  test('a preloaded page response is used as is (no second request, nothing stored)', async () => {
    const w = load();
    let p: Promise<Response> | null = null;
    w.handlers.fetch({ request: nav('/portfolio'), preloadResponse: Promise.resolve(new Response('PRELOADED', { status: 200 })), respondWith: (x: Promise<Response>) => { p = Promise.resolve(x); }, waitUntil: () => {} });
    assert.equal(await (await p!).text(), 'PRELOADED');
    assert.deepEqual(w.fetched, []);
  });
  test('without a preload (or a failed one) the page still comes from the network', async () => {
    for (const pre of [undefined, Promise.resolve(undefined), Promise.reject(new Error('x'))]) {
      const w = load();
      let p: Promise<Response> | null = null;
      w.handlers.fetch({ request: nav('/news'), preloadResponse: pre, respondWith: (x: Promise<Response>) => { p = Promise.resolve(x); }, waitUntil: () => {} });
      assert.equal(await (await p!).text(), 'net');
      assert.equal(w.fetched.length, 1);
    }
  });
});

describe('capped lists', () => {
  const items = Array.from({ length: 75 }, (_, i) => `row-${i + 1}`);
  const list = (n: number) => renderToStaticMarkup(React.createElement('div', null, React.createElement(CappedList<string>, { items: items.slice(0, n), render: (s: string) => React.createElement('p', { key: s }, s) })));
  test('first 30 rendered in order, the full total is stated, "Show N more" offered', () => {
    const h = list(75);
    assert.equal((h.match(/<p>/g) || []).length, LIST_STEP);
    assert.ok(h.indexOf('row-1<') < h.indexOf('row-2<') && h.includes('row-30<') && !h.includes('row-31<'));
    const t = strip(h);
    assert.match(t, /Showing 30 of 75/); assert.match(t, /Show 30 more/); assert.match(t, /Show all 75/);
  });
  test('short lists render whole with no control', () => {
    const h = list(12);
    assert.equal((h.match(/<p>/g) || []).length, 12);
    assert.ok(!/Show \d+ more/.test(h));
  });
  test('wording and counts are pure', () => {
    assert.equal(cappedCount(562, 30), 30); assert.equal(cappedCount(10, 30), 10); assert.equal(cappedCount(0, 30), 0);
    assert.deepEqual(moreText(30, 45), { more: 'Show 15 more', all: 'Show all 45', note: 'Showing 30 of 45' });
  });
  test('lazy details keep their text in a server render', () => {
    const h = renderToStaticMarkup(React.createElement(LazyDetails, { summary: React.createElement("summary", null, "HEAD"), children: null } as any, React.createElement('div', null, 'BODY')));
    assert.match(h, /^<details/); assert.match(h, /HEAD/); assert.match(h, /BODY/); assert.ok(!/<details open/.test(h));
  });
  test('audit area states the full total and renders 30 rows', () => {
    const ev = (i: number): any => ({ guidance_event_id: `a${i}`, ticker: `T${i}`, company: `Co ${i}`, market: 'US', verification: 'VERIFIED', primaryAvailable: true, decision: 'WATCHLIST', changes: [], flags: [], history: [], links: {}, duration: 'MULTI_YEAR', materiality: 'HIGH', expectationGap: 'UNKNOWN', sources: [], announcement_date: '2026-09-30' });
    const evs = Array.from({ length: 61 }, (_, i) => ev(i));
    const h = renderToStaticMarkup(React.createElement(GuAuditArea, { events: evs, onOpen: () => {}, now: new Date('2026-10-01T00:00:00Z') }));
    const t = strip(h);
    assert.match(t, /AUDIT ONLY \(61\)/);
    assert.equal((h.match(/<li class="gu-card"/g) || []).length, 30);
    assert.match(t, /Showing 30 of 61/);
    assert.ok(t.indexOf('Co 0 ') < t.indexOf('Co 1 ') && !t.includes('Co 30 '));
  });
  test('Guidance Upgrades page caps each card list; Special Situations radar and All tab show more instead of stopping', () => {
    const gu = read('app/(dashboard)/guidance-upgrades/page.tsx');
    assert.equal((gu.match(/<CappedList /g) || []).length, 3);
    assert.match(gu, /\{todayList\.length\} announced today/, 'the count still comes from the full list');
    const radar = read('components/special-situations/MultibaggerRadar.tsx');
    assert.match(radar, /const CARD_CAP = 30/);
    assert.match(radar, /<ShowMoreBar shown=\{shown\.length\} total=\{list\.length\}/);
    assert.match(radar, /\{list\.length\}\{list\.length !== all\.length \? ` of \$\{all\.length\}` : ''\}/, 'bucket chip counts the full bucket');
    const ss = read('app/(dashboard)/special-situations/page.tsx');
    assert.match(ss, /const radarEvents: CanonicalEvent\[\] = useMemo\(/);
    assert.equal((ss.match(/<ShowMoreBar /g) || []).length, 2);
    assert.match(read('components/special-situations/RadarCard.tsx'), /<LazyDetails summary=/);
  });
});
