// zzz1052 — client speed: no viewport prefetch storm (NavLink prefetches on hover / focus / press), below-the-fold home
// panels mount when near the screen (LazyPanel), shared loads (one network call for parallel identical requests), the
// chart's own bars go before the watchlist quotes, favourites open on a "drag" that did not move, and the home Daily
// Signal Inbox without the Quality-pullbacks lane (four lanes in one grid).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { makeIntentPrefetcher, prefetchTarget, claimPrefetch, _resetIntentPrefetch, HOVER_PREFETCH_DELAY_MS } from '../intent-prefetch';
import { sessionMemo, peekSessionMemo, _resetSessionMemo } from '../session-memo';
import { createClientFetch } from '../client-fetch';
import { afterChartLoads, chartFetch, _resetChartLoadCache } from '../chart-load-cache';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const h = React.createElement;
const code = (src: string) => src.replace(/\/\/.*$/gm, '');

describe('no viewport prefetch on bulk navigation links', () => {
  const files = [
    'app/(dashboard)/DashboardClient.tsx', 'components/pwa/MobileNav.tsx', 'app/(dashboard)/page.tsx', 'app/(dashboard)/_home/components.tsx',
    'components/pine-screener/PineScreener.tsx', 'components/stock-screener/StockScreener.tsx', 'app/(dashboard)/activity-log/page.tsx',
    'app/(dashboard)/cockpit/page.tsx', 'components/StockPassport.tsx',
  ];
  test('sidebar, phone menu, home chips / favourites and result rows use NavLink, never a bare next/link', () => {
    for (const f of files) {
      const s = read(f);
      assert.doesNotMatch(s, /from 'next\/link'/, `${f} imports next/link`);
      assert.doesNotMatch(s, /<Link[\s>]/, `${f} renders <Link>`);
      assert.match(s, /import NavLink from '@\/components\/NavLink'/, f);
    }
    const home = read('app/(dashboard)/page.tsx');
    assert.ok((home.match(/<NavLink\b/g) || []).length >= 100, 'the ~100 home links (A–Z strip, favourites, panels)');
  });
  test('NavLink: prefetch off unless asked; hover (delayed) / focus / pointer-down / touch prefetch through the router', () => {
    const s = read('components/NavLink.tsx');
    assert.match(s, /prefetch=\{prefetch === true \? true : false\}/);
    assert.match(s, /onMouseEnter=\{[^}]*it\.hoverStart\(\)/);
    assert.match(s, /onMouseLeave=\{[^}]*it\.hoverEnd\(\)/);
    assert.match(s, /onFocus=\{[^}]*it\.now\(\)/);
    assert.match(s, /onPointerDown=\{[^}]*it\.now\(\)/);
    assert.match(s, /onTouchStart=\{[^}]*it\.now\(\)/);
    assert.match(s, /router\?\.prefetch\(url\)/);
    // no useRouter(): it throws outside the App Router (tests render screens that contain NavLinks)
    assert.doesNotMatch(code(s), /useRouter\(/);
  });
  test('the shell prefetch policy is "never on view"', () => {
    assert.match(read('lib/shell-fetch.ts'), /export const PREFETCH_FAVOURITES = 0;/);
  });
});

describe('intent prefetch', () => {
  test('target: internal pages only, hash dropped, the open page skipped', () => {
    assert.equal(prefetchTarget('/news#top'), '/news');
    assert.equal(prefetchTarget('/multibagger?tab=technicals-ind'), '/multibagger?tab=technicals-ind');
    assert.equal(prefetchTarget('https://www.ibef.org/'), null);
    assert.equal(prefetchTarget('//evil.example/x'), null);
    assert.equal(prefetchTarget('#about'), null);
    assert.equal(prefetchTarget('/playbook#stress', '/playbook'), null, 'already on the page');
    assert.equal(prefetchTarget('/playbook?x=1', '/playbook'), '/playbook?x=1');
  });
  test('hover waits, leaving cancels, focus / press fire at once, the same page is asked for once', () => {
    _resetIntentPrefetch();
    const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
    const deps = {
      setTimer: (fn: () => void, ms: number) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
      clearTimer: (t: any) => { t.live = false; },
      now: () => 1_000,
      currentUrl: () => '/',
    };
    const calls: string[] = [];
    const a = makeIntentPrefetcher(() => '/news', (u) => calls.push(u), deps);
    a.hoverStart();
    assert.equal(calls.length, 0, 'not on mouse-enter itself');
    assert.equal(timers[0].ms, HOVER_PREFETCH_DELAY_MS);
    a.hoverEnd();                                   // swept past
    assert.equal(timers[0].live, false);
    a.hoverStart();
    timers[1].fn();                                 // rested on it
    assert.deepEqual(calls, ['/news']);
    a.now();                                        // focus / press again: already prefetched
    assert.deepEqual(calls, ['/news']);
    const b = makeIntentPrefetcher(() => '/charts?t=QQQ', (u) => calls.push(u), deps);
    b.now();
    assert.deepEqual(calls, ['/news', '/charts?t=QQQ']);
    const c = makeIntentPrefetcher(() => '/', (u) => calls.push(u), deps);
    c.now();
    assert.equal(calls.length, 2, 'the open page is never prefetched');
    assert.equal(claimPrefetch('/z', 0, 100), true);
    assert.equal(claimPrefetch('/z', 50, 100), false);
    assert.equal(claimPrefetch('/z', 150, 100), true, 'asked again after the window');
  });
});

async function withDom(fn: (x: { mount: (el: React.ReactNode) => Promise<void>; settle: (ms?: number) => Promise<void>; dom: JSDOM }) => Promise<void>, opts: { io?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const names = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'IntersectionObserver'];
  const previous = new Map(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event', 'CustomEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  if (opts.io === false) { delete (dom.window as any).IntersectionObserver; }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
  const mount = async (element: React.ReactNode) => { await act(async () => { root.render(element); await settle(); }); };
  try { await fn({ mount, settle, dom }); }
  finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, d] of previous) { if (d) Object.defineProperty(globalThis, key, d); else delete (globalThis as any)[key]; }
  }
}

describe('LazyPanel', () => {
  test('mounts its panel only when the observer reports it near the screen, then keeps it', async () => {
    const { default: LazyPanel } = await import('../../components/LazyPanel');
    await withDom(async ({ mount, dom }) => {
      const observers: Array<{ cb: (e: any[]) => void; opts: any; observed: Element[]; disconnected: boolean }> = [];
      (dom.window as any).IntersectionObserver = class {
        o: { cb: (e: any[]) => void; opts: any; observed: Element[]; disconnected: boolean };
        constructor(cb: (e: any[]) => void, opts: any) { this.o = { cb, opts, observed: [], disconnected: false }; observers.push(this.o); }
        observe(el: Element) { this.o.observed.push(el); }
        disconnect() { this.o.disconnected = true; }
        unobserve() {}
      };
      let mounted = 0;
      function Panel() { React.useEffect(() => { mounted++; }, []); return h('div', { id: 'panel' }, 'panel body'); }
      await mount(h(LazyPanel, { minHeight: 150, rootMargin: '300px', label: 'Test panel', children: h(Panel) }));
      assert.equal(mounted, 0, 'not mounted (no fetches) while far below the screen');
      assert.equal(document.getElementById('panel'), null);
      const ph = document.querySelector('[data-lazy-panel="waiting"]') as HTMLElement;
      assert.ok(ph); assert.equal(ph.style.minHeight, '150px');
      assert.equal(observers.length, 1); assert.equal(observers[0].opts.rootMargin, '300px');
      await act(async () => { observers[0].cb([{ isIntersecting: false, intersectionRatio: 0 }]); });
      assert.equal(mounted, 0, 'still far away');
      await act(async () => { observers[0].cb([{ isIntersecting: true, intersectionRatio: 0.1 }]); });
      assert.equal(mounted, 1);
      assert.ok(document.getElementById('panel'));
      assert.equal(observers[0].disconnected, true, 'stops watching once mounted');
    });
  });
  test('without IntersectionObserver the panel mounts at once (old browsers behave as before)', async () => {
    const { default: LazyPanel } = await import('../../components/LazyPanel');
    await withDom(async ({ mount }) => {
      await mount(h(LazyPanel, { children: h('div', { id: 'panel' }, 'x') }));
      assert.ok(document.getElementById('panel'));
    }, { io: false });
  });
  test('home: below-the-fold panels are wrapped; the Technicals CSVs wait for their section and are remembered', () => {
    const home = read('app/(dashboard)/page.tsx');
    for (const p of ['DailySignalInbox', 'FreshnessStrip', 'SignalScoreboard', 'HomeValuationQuickCheck']) {
      assert.match(home, new RegExp(`<LazyPanel[^>]*>[^\\n]*<(?:div[^>]*><)?${p} />|<LazyPanel[^>]*>\\s*<div[^>]*>\\s*<div[^>]*><${p} />`), p);
    }
    assert.match(home, /const techNear = useNearViewport\(techSentinelRef, '900px'\);/);
    assert.match(home, /if \(!techNear\) return;/);
    assert.match(home, /sessionMemo\(HOME_TECH_TIERS_KEY, compute, 10 \* 60_000\)/);
    assert.match(home, /<div ref=\{techSentinelRef\}/);
  });
});

describe('shared loads', () => {
  test('sessionMemo: parallel identical loads → one call; success remembered; failure retried', async () => {
    _resetSessionMemo();
    let calls = 0;
    const load = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { v: 1 }; };
    const [a, b, c] = await Promise.all([sessionMemo('k', load), sessionMemo('k', load), sessionMemo('k', load)]);
    assert.equal(calls, 1);
    assert.deepEqual(a, { v: 1 }); assert.equal(a, b); assert.equal(b, c);
    await sessionMemo('k', load);
    assert.equal(calls, 1, 'remembered for the session');
    assert.deepEqual(peekSessionMemo('k'), { v: 1 });
    let fcalls = 0;
    const failing = async () => { fcalls++; return null; };
    assert.equal(await sessionMemo('f', failing), null);
    assert.equal(await sessionMemo('f', failing), null);
    assert.equal(fcalls, 2, 'a failure is not remembered');
    let t = 0;
    await sessionMemo('t', async () => 'x', 100, () => t);
    t = 150;
    let again = 0;
    await sessionMemo('t', async () => { again++; return 'y'; }, 100, () => t);
    assert.equal(again, 1, 'expired → loaded again');
  });
  test('client-fetch: parallel identical GETs → one network call', async () => {
    let network = 0;
    const cf = createClientFetch({ fetchImpl: async () => { network++; await new Promise((r) => setTimeout(r, 5)); return { ok: true, status: 200, json: async () => ({ ok: 1 }) } as any; } });
    const out = await Promise.all([1, 2, 3, 4].map(() => cf.getJson('/api/x')));
    assert.equal(network, 1);
    assert.ok(out.every((o) => o?.ok === 1));
  });
});

describe('charts: the open chart first', () => {
  test('afterChartLoads waits for the chart the owner is looking at, and never longer than its cap', async () => {
    let release: () => void = () => {};
    _resetChartLoadCache((async () => { await new Promise<void>((r) => { release = r; }); return { ok: true, status: 200, json: async () => ({ ok: true, bars: [] }) }; }) as any);
    const t0 = Date.now();
    await afterChartLoads(2_000);
    assert.ok(Date.now() - t0 < 200, 'no chart loading → resolves right away');
    void chartFetch('/api/v1/chart/QQQ?market=US&interval=1d&range=2y');
    let done = false;
    const p = afterChartLoads(2_000).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(done, false, 'waits while the bars are loading');
    release();
    await p;
    assert.equal(done, true);
    _resetChartLoadCache((async () => new Promise(() => {})) as any);
    void chartFetch('/api/v1/chart/HANG?market=US&interval=1d&range=2y');
    const t1 = Date.now();
    await afterChartLoads(80);
    assert.ok(Date.now() - t1 < 1_000, 'a hung chart load never blocks the side requests for long');
    _resetChartLoadCache();
  });
  test('the watchlist quotes start after the chart bars', () => {
    const w = read('components/charts/WatchlistPanel.tsx');
    assert.match(w, /afterChartLoads\(\)\.then\(\(\) => \{\s*if \(stopped\) return;\s*stop = pollWhenVisible\(load, 60_000, \{ runImmediately: true \}\);/);
  });
});

describe('favourites click reliably', () => {
  // zzz1065 — the chips are plain links now (never draggable); reordering moved to a separate handle in Arrange mode,
  // so the zzz1052 "tiny drag = click" workaround is gone (see zzz1065-home-ux.test.ts).
  test('a favourite is a plain link (not draggable); chips no longer jump on hover', () => {
    const home = read('app/(dashboard)/page.tsx');
    assert.doesNotMatch(home, /function isTinyDrag\(/);
    assert.match(home, /<NavLink key=\{f\.href\} className="mc-chip-hover" href=\{f\.href\} style=\{st\} draggable=\{false\}>/);
    const css = read('styles/design-system.css');
    const rule = css.slice(css.indexOf('.mc-chip-hover:hover'), css.indexOf('}', css.indexOf('.mc-chip-hover:hover')));
    assert.ok(rule.length > 0);
    assert.doesNotMatch(rule, /transform/, 'no movement under the pointer');
  });
});

describe('Daily Signal Inbox without the Quality pullbacks lane', () => {
  test('no pullback code, type or preset helper left', () => {
    const c = read('app/(dashboard)/_home/components.tsx');
    assert.doesNotMatch(c, /QUALITY PULLBACKS|setPullbacks|pbSparks|passesQualityPreset|InboxPullback|logSignals\('pullback'/);
    assert.doesNotMatch(read('app/(dashboard)/_home/types.ts'), /InboxPullback/);
    assert.doesNotMatch(read('app/(dashboard)/_home/helpers.ts'), /passesQualityPreset/);
    // zzz1065 — explicit 1 / 2 / 4 columns from CSS (no auto-fit 3 + 1)
    assert.match(c, /data-testid="inbox-lanes" className="mc-inbox-lanes" style=\{\{ display: 'grid', gap: 10/);
  });
  test('renders the four lanes in one grid, no pullback section', async () => {
    const { DailySignalInbox } = await import('../../app/(dashboard)/_home/components');
    await withDom(async ({ mount, settle }) => {
      (globalThis as any).fetch = async (url: string) => {
        const body = String(url).includes('/api/market/quotes')
          ? { stocks: [], gainers: [{ ticker: 'ZZUP', company: 'Zz Up Ltd', changePercent: 6.2, price: 420, sector: 'Industrials' }] }
          : {};
        return { ok: true, status: 200, json: async () => body } as any;
      };
      await mount(h(DailySignalInbox));
      await act(async () => { await settle(60); });
      const grid = document.querySelector('[data-testid="inbox-lanes"]');
      assert.ok(grid, 'lane grid shown');
      assert.deepEqual(Array.from(grid!.querySelectorAll('[data-lane]')).map((e) => e.getAttribute('data-lane')), ['MOMENTUM', 'WARRANT', 'TRANSFORM', 'BENCH']);
      assert.match(grid!.textContent || '', /ZZUP/);
      const text = document.body.textContent || '';
      assert.doesNotMatch(text, /pullback/i);
    });
  });
});
