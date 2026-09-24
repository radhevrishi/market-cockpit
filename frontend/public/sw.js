/* Market Cockpit service worker (zzz796).
 *
 * Hand-written on purpose (no workbox / next-pwa). What it does:
 *   - Page navigations: always go to the network first. Pages are NEVER
 *     stored, because every page is the owner's private data. If the phone is
 *     offline, a plain "You're offline" page is shown instead.
 *   - /_next/static/* (file names change on every build, so they never go
 *     stale) and the app icons: served from the cache first.
 *   - Everything else passes straight through: /api/*, login, POST requests,
 *     anything carrying an auth header, other sites.
 *
 * Versioning: the page registers /sw.js?v=<deploy id>. A new deploy means a
 * new script URL, so the phone installs a new worker; the app then shows
 * "Update available — tap to reload". The new worker deletes older caches
 * when it takes over. Because pages are network-first and static files are
 * hashed, a deploy can never be hidden behind an old cache even if the
 * update prompt is ignored.
 */
'use strict';

var VERSION = (function () {
  try { return new URL(self.location.href).searchParams.get('v') || 'dev'; } catch (e) { return 'dev'; }
})();
var PREFIX = 'mc-pwa-';
var STATIC_CACHE = PREFIX + 'static-' + VERSION;
var OFFLINE_CACHE = PREFIX + 'offline-' + VERSION;
var OFFLINE_URL = '/offline.html';
var MAX_STATIC_ENTRIES = 300;

var ICON_PATHS = [
  '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png',
  '/apple-touch-icon.png', '/icon.svg', '/favicon.ico',
];
var NEVER_PAGES = ['/login', '/register'];
var PRIVATE_HEADERS = ['authorization', 'x-mc-key', 'x-cron-secret'];

/**
 * Decide how one request is handled. Pure, so tests can call it.
 * req: { url, method, mode, headers: { get(name) } }
 * scopeOrigin: this site's origin.
 * Returns 'bypass' | 'navigate' | 'cache-first'.
 */
function mcRoute(req, scopeOrigin) {
  var url;
  try { url = new URL(req.url); } catch (e) { return 'bypass'; }
  if (url.origin !== scopeOrigin) return 'bypass';
  if ((req.method || 'GET').toUpperCase() !== 'GET') return 'bypass';
  if (req.headers && typeof req.headers.get === 'function') {
    for (var i = 0; i < PRIVATE_HEADERS.length; i++) {
      if (req.headers.get(PRIVATE_HEADERS[i])) return 'bypass';
    }
  }
  var path = url.pathname;
  if (path === '/api' || path.indexOf('/api/') === 0) return 'bypass';
  for (var j = 0; j < NEVER_PAGES.length; j++) {
    if (path === NEVER_PAGES[j] || path.indexOf(NEVER_PAGES[j] + '/') === 0) return 'bypass';
  }
  if (path === '/sw.js') return 'bypass';
  if (req.mode === 'navigate') return 'navigate';
  if (path.indexOf('/_next/static/') === 0) return 'cache-first';
  if (ICON_PATHS.indexOf(path) !== -1 || path.indexOf('/icons/') === 0) return 'cache-first';
  return 'bypass';
}
self.__mcRoute = mcRoute;
self.__mcVersion = VERSION;

function cacheable(res) {
  return !!res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;
}

function trimCache(name, max) {
  return caches.open(name).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= max) return;
      return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return cache.delete(k); }));
    });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then(function (cache) {
      // cache: 'reload' skips the browser's HTTP cache so the fallback is current.
      return fetch(new Request(new URL(OFFLINE_URL, self.location.href).href, { cache: 'reload', credentials: 'omit' })).then(function (res) {
        if (cacheable(res)) return cache.put(OFFLINE_URL, res);
      }).catch(function () { /* offline during install: fallback text below still works */ });
    })
  );
  // No automatic skipWaiting: the app asks first ("Update available — tap to
  // reload") so a page is never swapped out from under the owner.
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (n.indexOf(PREFIX) === 0 && n !== STATIC_CACHE && n !== OFFLINE_CACHE) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  var data = event.data;
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting();
});

function offlineResponse() {
  return caches.open(OFFLINE_CACHE).then(function (cache) {
    return cache.match(OFFLINE_URL);
  }).then(function (hit) {
    if (hit) return hit;
    return new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="background:#0A0E1A;color:#F1F5F9;font-family:system-ui;padding:40px 20px;text-align:center">' +
      '<h1 style="font-size:20px">You’re offline — reconnect to load live data</h1>' +
      '<button onclick="location.reload()" style="font-size:16px;padding:12px 20px;border-radius:10px;border:0;background:#22D3EE;color:#0A0E1A;font-weight:800">Try again</button>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var route = mcRoute(req, self.location.origin);
  if (route === 'bypass') return; // browser handles it normally, nothing stored

  if (route === 'navigate') {
    // Network first, never stored (pages hold private data).
    event.respondWith(
      fetch(req).catch(function () { return offlineResponse(); })
    );
    return;
  }

  // cache-first: hashed build files and icons only.
  event.respondWith(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (cacheable(res)) {
            var copy = res.clone();
            event.waitUntil(cache.put(req, copy).then(function () { return trimCache(STATIC_CACHE, MAX_STATIC_ENTRIES); }));
          }
          return res;
        });
      });
    })
  );
});
