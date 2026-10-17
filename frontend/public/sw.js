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
 * zzz1064 — PHONE NOTIFICATIONS: 'push' shows the price alert as a phone / desktop notification (payload JSON
 * {title, body, url, tag, eventId}); tapping it ('notificationclick') focuses an open Market Cockpit window and goes to the
 * alert's page, or opens one. 'pushsubscriptionchange' signs the device up again with the server's key. Push never caches
 * anything and never touches page requests.
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

// zzz855 — navigation preload: the browser starts the page request while the
// worker is still waking up, instead of after. Pages stay network-first and are
// still never stored; this only removes the worker's start-up delay.
function enableNavigationPreload() {
  try {
    var np = self.registration && self.registration.navigationPreload;
    if (np && typeof np.enable === 'function') return np.enable().catch(function () { /* unsupported */ });
  } catch (e) { /* unsupported */ }
  return Promise.resolve();
}

self.addEventListener('activate', function (event) {
  event.waitUntil(
    enableNavigationPreload().then(function () { return caches.keys(); }).then(function (names) {
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
    // Use the preloaded response when the browser made one (zzz855), else fetch.
    var preload = event.preloadResponse ? Promise.resolve(event.preloadResponse).catch(function () { return null; }) : Promise.resolve(null);
    event.respondWith(
      preload.then(function (pre) { return pre || fetch(req); })
        .catch(function () { return offlineResponse(); })
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

// ── zzz1064: phone notifications ─────────────────────────────────────────────

/** Only same-site paths are opened from a notification ("/price-alerts", "/charts?…"); anything else → the alerts page. */
function mcSafePath(u) {
  var s = typeof u === 'string' ? u.trim() : '';
  if (s.charAt(0) !== '/' || s.charAt(1) === '/' || s.charAt(1) === '\\') return '/price-alerts';
  return s.slice(0, 500);
}

/**
 * Turns the push payload into showNotification(title, options). Pure, so tests can call it.
 * raw: the parsed JSON object, a plain string, or null.
 */
function mcPushNotice(raw) {
  var d = raw && typeof raw === 'object' ? raw : { body: typeof raw === 'string' ? raw : '' };
  var title = String(d.title || 'Market Cockpit alert').slice(0, 120);
  var body = String(d.body || d.message || '').slice(0, 400);
  var eventId = d.eventId != null ? String(d.eventId).slice(0, 40) : null;
  var tag = d.tag ? String(d.tag).slice(0, 80) : (eventId ? 'mc-alert-' + eventId : 'mc-alert');
  return {
    title: title,
    options: {
      body: body,
      tag: tag,
      renotify: true,          // a newer alert with the same tag still buzzes the phone
      icon: '/icon-192.png',
      badge: '/icon-maskable-192.png',
      timestamp: Date.now(),
      data: { url: mcSafePath(d.url), eventId: eventId },
    },
  };
}
self.__mcPushNotice = mcPushNotice;
self.__mcSafePath = mcSafePath;

self.addEventListener('push', function (event) {
  var raw = null;
  try { raw = event.data ? event.data.json() : null; } catch (e) {
    try { raw = event.data ? event.data.text() : null; } catch (e2) { raw = null; }
  }
  var n = mcPushNotice(raw);
  // Always show something: a push with no notification is penalised by the browser.
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener('notificationclick', function (event) {
  var note = event.notification;
  var path = mcSafePath(note && note.data && note.data.url);
  try { note.close(); } catch (e) { /* ignore */ }
  var target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var same = false;
        try { same = new URL(c.url).origin === self.location.origin; } catch (e) { same = false; }
        if (!same) continue;
        return Promise.resolve(c.focus ? c.focus() : c).then(function (fc) {
          var w = fc || c;
          if (w.navigate && w.url !== target) return w.navigate(target).catch(function () { return self.clients.openWindow(target); });
          return w;
        });
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});

// The browser renewed / dropped the subscription: sign up again with the server's key (best effort; the page also checks).
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    fetch('/api/v1/push?view=key', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok || !j.publicKey) return;
      var s = String(j.publicKey).replace(/-/g, '+').replace(/_/g, '/');
      s += '===='.slice(0, (4 - (s.length % 4)) % 4);
      var bin = atob(s), key = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) key[i] = bin.charCodeAt(i);
      return self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then(function (sub) {
        return fetch('/api/v1/push', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON(), label: 'renewed device', replaces: event.oldSubscription ? event.oldSubscription.endpoint : null }),
        });
      });
    }).catch(function () { /* the page will notice on the next visit */ })
  );
});
