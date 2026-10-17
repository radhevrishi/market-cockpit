// zzz1064 — phone notifications (browser side) + the alerts UI helpers: push state machine (incl. iPhone not installed), the
// bell's cursor (every event exactly once, oldest first), NSE / BSE identity in the alert form, the service worker's push and
// notification-click handlers, the manifest and the login gate for the app files.
// Run: node --import tsx --test src/lib/__tests__/zzz1064-push-client-alerts-ui.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  pushState, pushStateText, deviceLabel, urlBase64ToUint8Array, readDeviceRecord, describeTestResults, IOS_INSTALL_STEPS, PUSH_DEVICE_KEY,
  type PushEnv,
} from '../push-client';
import { collectNewEvents, burstToasts, isTestEvent, chartHrefFor, channelStatus, eventDelivery, type EventPage } from '../alerts/client';
import { tickerFormFrom, tickerFormInput, tickerFormMarket, tickerFormMid, exchangeBadge, trapFocusTarget } from '../alerts/dialog-meta';
import { sanitizeTarget, type AlertEvent } from '../alerts/types';

const ROOT = join(__dirname, '..', '..', '..');
const PUB = join(ROOT, 'public');
const SRC = join(ROOT, 'src');

// ── push state machine ────────────────────────────────────────────────────

const base: PushEnv = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: 'default', ios: false, standalone: false, subscribed: false, serverReady: true };

describe('push state', () => {
  test('Android / desktop: off → on; blocked; server missing; unsupported', () => {
    assert.equal(pushState(base), 'off');
    assert.equal(pushState({ ...base, permission: 'granted', subscribed: true }), 'on');
    assert.equal(pushState({ ...base, permission: 'granted', subscribed: false }), 'off', 'permission alone is not "on"');
    assert.equal(pushState({ ...base, permission: 'denied' }), 'blocked');
    assert.equal(pushState({ ...base, serverReady: false }), 'server-missing');
    assert.equal(pushState({ ...base, hasPushManager: false }), 'unsupported');
    assert.equal(pushState({ ...base, hasServiceWorker: false }), 'unsupported');
  });
  test('iPhone in the Safari tab (not installed) → the 3 Home Screen steps, whatever else is true', () => {
    assert.equal(pushState({ ...base, ios: true, standalone: false, hasPushManager: false }), 'ios-install');
    assert.equal(pushState({ ...base, ios: true, standalone: false }), 'ios-install');
    assert.equal(IOS_INSTALL_STEPS.length, 3);
    assert.match(IOS_INSTALL_STEPS[0], /Share/);
    assert.match(IOS_INSTALL_STEPS[1], /Add to Home Screen/);
    assert.match(IOS_INSTALL_STEPS[2], /Turn on/);
  });
  test('iPhone opened from the Home Screen icon works like Android; old iOS without PushManager is unsupported', () => {
    assert.equal(pushState({ ...base, ios: true, standalone: true }), 'off');
    assert.equal(pushState({ ...base, ios: true, standalone: true, permission: 'granted', subscribed: true }), 'on');
    assert.equal(pushState({ ...base, ios: true, standalone: true, hasPushManager: false }), 'unsupported');
  });
  test('every state has plain words; server-missing says so', () => {
    for (const s of ['checking', 'on', 'off', 'blocked', 'ios-install', 'unsupported', 'server-missing'] as const) assert.ok(pushStateText(s).title, s);
    assert.match(pushStateText('server-missing').detail, /not available on the server yet/);
  });
  test('device labels', () => {
    assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
    assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'), 'Android phone · Chrome');
    assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', 5), 'iPad · Safari');
    assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0'), 'Windows PC · Edge');
  });
  test('VAPID key decoding (base64url) and bad keys', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256);
    const key = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.deepEqual([...urlBase64ToUint8Array(key)], [...bytes]);
    assert.throws(() => urlBase64ToUint8Array('not a key!'));
  });
  test('per-device record and test-result wording', () => {
    assert.equal(readDeviceRecord(null), null);
    const store = { getItem: (k: string) => (k === PUSH_DEVICE_KEY ? JSON.stringify({ on: true, endpoint: 'https://push.example/1', label: 'iPhone · Safari', at: 'x' }) : null) };
    assert.equal(readDeviceRecord(store)?.on, true);
    assert.equal(readDeviceRecord({ getItem: () => '{bad' }), null);
    assert.equal(describeTestResults(null, 404).ok, false);
    assert.match(describeTestResults(null, 404).text, /not available on the server yet/);
    const r = describeTestResults({ ok: true, results: [{ label: 'iPhone', state: 'sent' }, { label: 'Old laptop', state: 'gone' }] }, 200);
    assert.equal(r.ok, true);
    assert.match(r.text, /✓ iPhone: sent/);
    assert.match(r.text, /✗ Old laptop/);
    assert.match(describeTestResults({ ok: true, results: [] }, 200).text, /Turn on/);
  });
});

// ── bell cursor ───────────────────────────────────────────────────────────

function ev(id: number, extra: Partial<AlertEvent> = {}): AlertEvent {
  return { id, alertId: 'a', alertName: 'A', mid: 'IN:HAL', market: 'IN', ticker: 'HAL', name: null, price: 1, changePct: 1, condition: 'c', list: null, message: `m${id}`, firedAt: new Date(0).toISOString(), dedupeKey: 'k', read: false, toast: true, browser: false, ...extra };
}
/** A fake server: ids 1..n; `grow` adds arrivals after each page request. */
function fakeServer(n: number, opts: { grow?: number; failPage?: number; asc?: boolean } = {}) {
  let ids = Array.from({ length: n }, (_, i) => i + 1);
  let calls = 0;
  const after = () => { if (opts.grow) { const top = ids.length ? ids[ids.length - 1] : 0; for (let k = 1; k <= opts.grow; k++) ids.push(top + k); } };
  const descending = async (beforeId: number | undefined, limit: number): Promise<EventPage> => {
    calls++;
    if (opts.failPage === calls) return null;
    const out = ids.filter((i) => beforeId == null || i < beforeId).sort((a, b) => b - a).slice(0, limit).map((i) => ev(i));
    after();
    return { events: out };
  };
  const ascending = opts.asc ? async (afterId: number, limit: number): Promise<EventPage> => {
    calls++;
    if (opts.failPage === calls) return null;
    const rest = ids.filter((i) => i > afterId).sort((a, b) => a - b);
    const out = rest.slice(0, limit).map((i) => ev(i));
    after();
    return { events: out, hasMore: rest.length > limit };
  } : async () => ({ events: [] as AlertEvent[] });   // old server: no hasMore → ignored
  return { descending, ascending, all: () => ids.slice(), set: (v: number[]) => { ids = v; } };
}

describe('bell cursor (A07): every event once, oldest first, never past an unread one', () => {
  for (const n of [0, 1, 20, 21, 50]) {
    test(`${n} events since the cursor (newest-first fallback, page 20)`, async () => {
      const s = fakeServer(n + 5);
      const r = await collectNewEvents(5, { descending: s.descending, ascending: s.ascending }, 20, 10);
      assert.equal(r.complete, true);
      assert.deepEqual(r.events.map((e) => e.id), Array.from({ length: n }, (_, i) => i + 6), 'all of them, ascending');
      assert.equal(r.cursor, n ? n + 5 : 5);
    });
    test(`${n} events since the cursor (server ascending pages, page 20)`, async () => {
      const s = fakeServer(n + 5, { asc: true });
      const r = await collectNewEvents(5, { descending: s.descending, ascending: s.ascending }, 20, 10);
      assert.equal(r.complete, true);
      assert.deepEqual(r.events.map((e) => e.id), Array.from({ length: n }, (_, i) => i + 6));
    });
  }
  test('new arrivals during the read are picked up by the next read, none twice, none missed', async () => {
    for (const asc of [false, true]) {
      const s = fakeServer(50, { grow: 3, asc });
      const seen: number[] = [];
      let cur = 0;
      for (let k = 0; k < 6; k++) {
        const r = await collectNewEvents(cur, { descending: s.descending, ascending: s.ascending }, 20, 10);
        seen.push(...r.events.map((e) => e.id));
        assert.ok(r.events.every((e, i, a) => i === 0 || a[i - 1].id < e.id), 'ascending');
        cur = r.cursor;
      }
      const max = Math.max(...seen);
      assert.deepEqual(seen, Array.from({ length: max }, (_, i) => i + 1), `asc=${asc}: each id exactly once, in order`);
    }
  });
  test('a failed page consumes nothing (cursor unchanged), the next read gets everything', async () => {
    const s = fakeServer(45, { failPage: 2 });
    const r1 = await collectNewEvents(0, { descending: s.descending }, 20, 10);
    assert.equal(r1.complete, false);
    assert.equal(r1.cursor, 0);
    assert.equal(r1.events.length, 0);
    const r2 = await collectNewEvents(0, { descending: s.descending }, 20, 10);
    assert.equal(r2.events.length, 45);
  });
  test('ascending: a later page failing keeps what came in order; the rest follows next time', async () => {
    const s = fakeServer(50, { asc: true, failPage: 2 });
    const r1 = await collectNewEvents(0, { descending: s.descending, ascending: s.ascending }, 20, 10);
    assert.deepEqual(r1.events.map((e) => e.id), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(r1.cursor, 20);
    const r2 = await collectNewEvents(r1.cursor, { descending: s.descending, ascending: s.ascending }, 20, 10);
    assert.deepEqual(r2.events.map((e) => e.id), Array.from({ length: 30 }, (_, i) => i + 21));
  });
  test('a burst gets ONE grouped toast; a few get one each; tests are not counted as a burst', () => {
    const few = burstToasts([ev(1), ev(2)]);
    assert.equal(few.grouped, null);
    assert.equal(few.lines.length, 2);
    const many = burstToasts(Array.from({ length: 12 }, (_, i) => ev(i + 1, { ticker: `T${i}` })));
    assert.equal(many.lines.length, 0);
    assert.match(many.grouped!, /^🔔 12 price alerts fired — T0, T1, T2, T3 \+8 more/);
    assert.equal(burstToasts([ev(1, { message: 'TEST · HAL' }), ev(2, { message: 'TEST · X' }), ev(3, { message: 'TEST · Y' }), ev(4, { message: 'TEST · Z' })]).grouped, null);
    assert.ok(isTestEvent({ message: 'TEST · HAL crossing' }));
    assert.ok(!isTestEvent({ message: 'HAL TEST' }));
  });
  test('chart links keep NSE vs BSE vs USA', () => {
    assert.equal(chartHrefFor({ ticker: 'TATVA', market: 'IN', mid: 'IN:BSE:TATVA' }), '/charts?symbol=TATVA&exchange=BSE');
    assert.equal(chartHrefFor({ ticker: 'HAL', market: 'IN', mid: 'IN:HAL' }), '/charts?symbol=HAL&exchange=NSE');
    assert.equal(chartHrefFor({ ticker: 'HAL', market: 'US', mid: 'US:HAL' }), '/charts?symbol=HAL&exchange=US');
  });
  test('channel status and per-event delivery read whatever the server sends, defensively', () => {
    assert.deepEqual(channelStatus('email', { channels: { telegram: false, email: true } }), { state: 'working' });
    assert.deepEqual(channelStatus('telegram', { channels: { telegram: false, email: true } }), { state: 'not-set-up' });
    assert.equal(channelStatus('push', { channels: { telegram: false, email: true } }).state, 'unknown');
    assert.equal(channelStatus('telegram', { channels: { telegram: true }, delivery: { telegram: { ok: false, lastError: '401 Unauthorized' } } }).state, 'failing');
    assert.equal(channelStatus('push', { channels: { push: { ready: true } } }).state, 'working');
    assert.deepEqual(eventDelivery({}), []);
    assert.deepEqual(eventDelivery({ delivery: { email: 'sent', telegram: { ok: false, error: '401' }, push: 'skipped' } }), [{ channel: 'email', ok: true, error: undefined }, { channel: 'telegram', ok: false, error: '401' }]);
  });
});

// ── A04: identity in the alert form ───────────────────────────────────────

describe('alert form keeps the exchange (A04)', () => {
  const roundTrip = (mid: string) => tickerFormMid(tickerFormFrom({ kind: 'ticker', id: mid }));
  test('NSE TATVA', () => {
    let f = tickerFormFrom(null);
    f = tickerFormInput(f, 'tatva');
    assert.equal(tickerFormMid(f), 'IN:TATVA');
    assert.equal(exchangeBadge(f), 'NSE');
    assert.equal(roundTrip('IN:TATVA'), 'IN:TATVA');
  });
  test('BSE TATVA (picked, typed BSE:, or .BO) stays BSE through edit and save', () => {
    const picked = { ...tickerFormInput(tickerFormFrom(null), 'TATVA'), exchange: 'BSE' as const };
    assert.equal(tickerFormMid(picked), 'IN:BSE:TATVA');
    assert.equal(tickerFormMid(tickerFormInput(tickerFormFrom(null), 'BSE:TATVA')), 'IN:BSE:TATVA');
    assert.equal(tickerFormMid(tickerFormInput(tickerFormFrom(null), 'TATVA.BO')), 'IN:BSE:TATVA');
    const edit = tickerFormFrom({ kind: 'ticker', id: 'IN:BSE:TATVA' });
    assert.deepEqual(edit, { market: 'IN', ticker: 'TATVA', exchange: 'BSE' });
    assert.equal(exchangeBadge(edit), 'BSE');
    // editing the text keeps BSE
    assert.equal(tickerFormMid(tickerFormInput(edit, 'TATVA')), 'IN:BSE:TATVA');
    const s = sanitizeTarget({ kind: 'ticker', id: tickerFormMid(edit) });
    assert.ok(s.ok && s.t.id === 'IN:BSE:TATVA', 'the server check keeps it too');
    assert.equal(roundTrip('IN:BSE:TATVA'), 'IN:BSE:TATVA');
    // from the chart on screen
    assert.equal(tickerFormMid(tickerFormFrom(undefined, { m: 'IN', t: 'TATVA', x: 'BSE' })), 'IN:BSE:TATVA');
  });
  test('numeric BSE code', () => {
    const f = tickerFormInput(tickerFormFrom(null), '543262');
    assert.equal(f.exchange, 'BSE');
    assert.equal(tickerFormMid(f), 'IN:BSE:543262');
    assert.equal(roundTrip('IN:BSE:543262'), 'IN:BSE:543262');
  });
  test('India HAL vs US HAL never mix', () => {
    const inHal = tickerFormInput(tickerFormFrom(null), 'HAL');
    assert.equal(tickerFormMid(inHal), 'IN:HAL');
    const usHal = tickerFormMarket(inHal, 'US');
    assert.equal(tickerFormMid(usHal), 'US:HAL');
    assert.equal(exchangeBadge(usHal), 'USA');
    assert.equal(roundTrip('US:HAL'), 'US:HAL');
    assert.equal(roundTrip('IN:HAL'), 'IN:HAL');
    // back to India: NSE again (BSE stays only when chosen)
    assert.equal(tickerFormMid(tickerFormMarket(usHal, 'IN')), 'IN:HAL');
    assert.equal(tickerFormMid(tickerFormMarket({ market: 'IN', ticker: 'TATVA', exchange: 'BSE' }, 'IN')), 'IN:BSE:TATVA');
  });
  test('focus trap wraps at both ends', () => {
    const items = ['a', 'b', 'c'];
    assert.equal(trapFocusTarget(items, 'c', false), 'a');
    assert.equal(trapFocusTarget(items, 'a', true), 'c');
    assert.equal(trapFocusTarget(items, 'b', false), null);
    assert.equal(trapFocusTarget(items, null, false), 'a');
    assert.equal(trapFocusTarget([], null, false), null);
  });
  test('dialog wiring: one form state, exchange toggle + badge, Phone checkbox, focus trap and mobile sheet', () => {
    const dlg = readFileSync(join(SRC, 'components', 'alerts', 'CreateAlertDialog.tsx'), 'utf8');
    assert.match(dlg, /tickerFormMid\(tform\)/);
    assert.match(dlg, /aria-label="Exchange"/);
    assert.match(dlg, /exchangeBadge\(tform\)/);
    assert.match(dlg, /📱 Phone/);
    assert.match(dlg, /trapFocusTarget\(/);
    assert.match(dlg, /opener\.focus\(\)/);
    assert.ok(!/setTickerText|setTickerMkt/.test(dlg), 'no separate market / text state that drops BSE');
  });
});

// ── service worker ────────────────────────────────────────────────────────

const SW = readFileSync(join(PUB, 'sw.js'), 'utf8');
const ORIGIN = 'https://cockpit.example';
function loadSw(clientsList: any[] = []) {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: Array<{ title: string; options: any }> = [];
  const opened: string[] = [];
  const self: any = {
    location: { href: `${ORIGIN}/sw.js?v=t1`, origin: ORIGIN },
    addEventListener: (t: string, fn: (e: any) => void) => { handlers[t] = fn; },
    registration: { showNotification: async (title: string, options: any) => { shown.push({ title, options }); } },
    clients: { claim: async () => {}, matchAll: async () => clientsList, openWindow: async (u: string) => { opened.push(u); return null; } },
    skipWaiting() {},
  };
  const ctx = vm.createContext({ self, URL, Request, Response, Promise, console, caches: { open: async () => ({}), keys: async () => [] }, fetch: async () => new Response('') });
  vm.runInContext(SW, ctx);
  return { handlers, shown, opened, self };
}
async function fire(h: (e: any) => void, e: any) { const waits: Promise<any>[] = []; h({ ...e, waitUntil: (p: Promise<any>) => waits.push(p) }); await Promise.all(waits); }

describe('service worker: push + notification click', () => {
  test('has push, notificationclick and pushsubscriptionchange handlers', () => {
    assert.match(SW, /addEventListener\('push'/);
    assert.match(SW, /addEventListener\('notificationclick'/);
    assert.match(SW, /addEventListener\('pushsubscriptionchange'/);
  });
  test('push shows the alert with title, body, tag, renotify, badge and the page to open', async () => {
    const w = loadSw();
    await fire(w.handlers.push, { data: { json: () => ({ title: '🔔 HAL', body: 'HAL crossing up 4500', url: '/charts?symbol=HAL&exchange=NSE', tag: 'pa-77', eventId: 77 }) } });
    assert.equal(w.shown.length, 1);
    const n = w.shown[0];
    assert.equal(n.title, '🔔 HAL');
    assert.equal(n.options.body, 'HAL crossing up 4500');
    assert.equal(n.options.tag, 'pa-77');
    assert.equal(n.options.renotify, true);
    assert.ok(n.options.badge && n.options.icon);
    assert.equal(n.options.data.url, '/charts?symbol=HAL&exchange=NSE');
    assert.equal(n.options.data.eventId, '77');
  });
  test('a push with no / odd payload still shows something; other sites are never opened', async () => {
    const w = loadSw();
    await fire(w.handlers.push, { data: null });
    await fire(w.handlers.push, { data: { json: () => { throw new Error('x'); }, text: () => 'plain text' } });
    await fire(w.handlers.push, { data: { json: () => ({ title: 'x', url: 'https://evil.example/' }) } });
    assert.equal(w.shown.length, 3);
    assert.equal(w.shown[0].title, 'Market Cockpit alert');
    assert.equal(w.shown[1].options.body, 'plain text');
    assert.equal(w.shown[2].options.data.url, '/price-alerts');
    assert.equal(w.self.__mcSafePath('//evil.example'), '/price-alerts');
  });
  test('tap: focuses an open Market Cockpit window and goes to the page', async () => {
    const calls: string[] = [];
    const client = { url: `${ORIGIN}/`, focus: async () => { calls.push('focus'); return client; }, navigate: async (u: string) => { calls.push(`nav ${u}`); return client; } };
    const w = loadSw([{ url: 'https://other.example/', focus: async () => { calls.push('wrong'); } }, client]);
    let closed = false;
    await fire(w.handlers.notificationclick, { notification: { data: { url: '/price-alerts#log' }, close: () => { closed = true; } } });
    assert.ok(closed);
    assert.deepEqual(calls, ['focus', `nav ${ORIGIN}/price-alerts#log`]);
    assert.equal(w.opened.length, 0);
  });
  test('tap with no window open: opens one', async () => {
    const w = loadSw([]);
    await fire(w.handlers.notificationclick, { notification: { data: { url: '/charts?symbol=TATVA&exchange=BSE' }, close() {} } });
    assert.deepEqual(w.opened, [`${ORIGIN}/charts?symbol=TATVA&exchange=BSE`]);
  });
  test('push never touches page caching (fetch rules unchanged)', () => {
    const w = loadSw();
    assert.equal(typeof w.self.__mcRoute, 'function');
    assert.equal(w.self.__mcRoute({ url: `${ORIGIN}/api/v1/push`, method: 'GET', mode: 'cors', headers: new Headers() }, ORIGIN), 'bypass');
  });
});

// ── manifest, layout, headers, login gate ─────────────────────────────────

describe('installable app files', () => {
  test('manifest is valid JSON, standalone, with icons that exist', () => {
    const m = JSON.parse(readFileSync(join(PUB, 'manifest.json'), 'utf8'));
    assert.equal(m.name, 'Market Cockpit');
    assert.equal(m.short_name, 'Cockpit');
    assert.equal(m.display, 'standalone');
    assert.ok(m.start_url.startsWith('/'));
    for (const i of m.icons) assert.ok(existsSync(join(PUB, i.src)), i.src);
    assert.ok(m.icons.some((i: any) => i.purpose === 'maskable'));
    assert.ok(existsSync(join(PUB, 'apple-touch-icon.png')));
    const layout = readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8');
    assert.match(layout, /rel="manifest"/);
    assert.match(layout, /apple-mobile-web-app-capable/);
  });
  test('sw.js is served fresh with the whole-site scope', () => {
    const cfg = require(join(ROOT, 'next.config.js'));
    return cfg.headers().then((rules: any[]) => {
      const sw = rules.find((r) => r.source === '/sw.js');
      assert.ok(sw, '/sw.js header rule');
      const h = Object.fromEntries(sw.headers.map((x: any) => [x.key, x.value]));
      assert.equal(h['Service-Worker-Allowed'], '/');
      assert.match(h['Cache-Control'], /no-cache/);
      assert.match(h['Content-Type'], /javascript/);
    });
  });
  test('the login gate lets sw.js, the manifest and the icons through', () => {
    const src = readFileSync(join(SRC, 'proxy.ts'), 'utf8');
    const m = src.match(/matcher:\s*\[\s*'([^']+)'/);
    assert.ok(m);
    const re = new RegExp(`^${m![1].replace(/\\\\/g, '\\')}$`);
    for (const p of ['/sw.js', '/manifest.json', '/icon-192.png', '/icon-maskable-192.png', '/apple-touch-icon.png']) assert.equal(re.test(p), false, p);
    assert.equal(re.test('/price-alerts'), true, 'pages stay behind the login');
  });
  test('the bell sits outside the scrolling chip row; the page has only a default export', () => {
    const dash = readFileSync(join(SRC, 'app', '(dashboard)', 'DashboardClient.tsx'), 'utf8');
    const chips = dash.indexOf('className={pwa.chips}');
    const bell = dash.indexOf('<AlertBell />');
    const headerEnd = dash.indexOf('</header>');
    assert.ok(chips > 0 && bell > chips && bell < headerEnd, 'bell in the header');
    const between = dash.slice(chips, bell);
    assert.ok(/<\/div>\s*<\/div>\s*\{\/\*[^]*?\*\/\}\s*$/.test(between), 'after the chip row closes');
    const page = readFileSync(join(SRC, 'app', '(dashboard)', 'price-alerts', 'page.tsx'), 'utf8');
    assert.ok(!/^export (?!default)/m.test(page));
    assert.match(page, /<PhoneNotifications \/>/);
    assert.match(page, /isTestEvent/);
    const bellSrc = readFileSync(join(SRC, 'components', 'alerts', 'AlertBell.tsx'), 'utf8');
    assert.match(bellSrc, /collectNewEvents\(/);
    assert.match(bellSrc, /BELL_CURSOR_KEY/);
  });
});
