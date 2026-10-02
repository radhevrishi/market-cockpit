/* eslint-disable */
// zzz855 — Safe localStorage runtime (compression + quota guard + read cache).
//
// WHY: the owner's browser storage for this site was full (5.5 MB, 125 keys).
// Every big write then threw QuotaExceededError, so pages refetched on every
// visit and uploads could silently fail to save. 243 setItem call sites in 84
// files made per-call fixes impractical, so this module patches
// Storage.prototype ONCE, for window.localStorage only:
//
//   1. Big values (>= 16384 UTF-16 chars, about 32 KB) are stored compressed
//      with a small in-house LZ77 codec (no deps) under MARKER. getItem
//      decompresses transparently. Values without MARKER pass through, so all
//      existing data stays readable. Every compressed write is decoded and
//      compared before it is stored; if the check fails the raw value is kept.
//   2. QuotaExceededError → (a) compress any old big values still stored raw,
//      (b) evict CACHE keys only (least-recently-used first, then largest),
//      retrying after each. USER data (uploads, books, notes, settings, and
//      ANY key we do not recognise) is never evicted.
//      If it still does not fit, the value is kept in memory for this session
//      (getItem returns it), window.__mcStorageFull = true, one console.warn
//      and a 'mc:storage-full' event. For CACHE keys the error is swallowed.
//      For USER keys the original error is re-thrown, exactly as the browser
//      did before: several pages catch it to fall back to IndexedDB / a slim
//      copy / a visible "not saved" message, and hiding it would turn a
//      visible failure into silent loss on the next reload.
//   3. Repeated reads of the same compressed key return the same decoded
//      string from an in-memory cache (checked against the raw stored value).
//   4. On idle after load, existing big values are recompressed in place
//      (round-trip verified first). Idempotent.
//
// IMPORTANT: the whole runtime lives inside ONE self-contained function so the
// root layout can inline it as a <script> in <head> (via Function#toString)
// and it runs before any page bundle reads storage. Do not reference anything
// from module scope inside installSafeStorage — the test suite checks that the
// stringified function runs in an empty sandbox.
//
// Not covered (documented): direct property access (localStorage[k],
// localStorage.foo = v) bypasses the patch. A grep at install time found no
// such reads/writes of data keys; only localStorage.length/key(i) loops,
// which are unaffected (they list keys, then call getItem).

export const SAFE_STORAGE_VERSION = 1;

export function installSafeStorage(win: any): any {
  try {
    if (!win || win.__mcSafeStorage) return win && win.__mcSafeStorage;
    var ls: any;
    try { ls = win.localStorage; } catch (e) { return null; }
    if (!ls) return null;
    var proto: any = Object.getPrototypeOf(ls);
    if (!proto || typeof proto.setItem !== 'function') return null;

    var MARKER = String.fromCharCode(1) + 'MCZ1' + String.fromCharCode(2);
    var MIN_CHARS = 16384;          // ~32 KB in UTF-16
    var LRU_KEY = '__mc_ss_lru_v1';
    var MIN_MATCH = 4;
    var MAX_LEN = 0x3fff + MIN_MATCH;
    var MAX_OFF = 0x1fffffff;
    var READ_CACHE_MAX_CHARS = 24 * 1024 * 1024;

    var origGet = proto.getItem;
    var origSet = proto.setItem;
    var origRemove = proto.removeItem;
    var origClear = proto.clear;
    var origKey = proto.key;
    var lenDesc = Object.getOwnPropertyDescriptor(proto, 'length');

    function rawGet(k: string): string | null { return origGet.call(ls, k); }
    function rawSet(k: string, v: string) { origSet.call(ls, k, v); }
    function rawRemove(k: string) { origRemove.call(ls, k); }
    function rawLength(): number { return lenDesc && lenDesc.get ? lenDesc.get.call(ls) : ls.length; }
    function rawKey(i: number): string | null { return origKey.call(ls, i); }
    function allKeys(): string[] {
      var out: string[] = []; var n = rawLength();
      for (var i = 0; i < n; i++) { var k = rawKey(i); if (k != null) out.push(k); }
      return out;
    }

    // ── Key classes ─────────────────────────────────────────────────────
    // CACHE = copies of server/API responses that the page refetches when
    // missing. Everything else (and anything unknown) is USER data.
    var CACHE_PATTERNS: RegExp[] = [
      /^mc:hub:/, /^mc:hub-scrub:/,
      /^mc:graded:/, /^mc:graded-us:/, /^mc:graded-scrub:/,
      /^mc:cal-us:/,
      /^mc:strategic-vis:/,
      /^mc:cap-map:/,
      /^mc:heatmap-snapshot:/,
      /^mc:nse-industry:/,
      /^mc:earnings-scan:/,
      /^mc:ticker-bar:/,
      /^mc:regime:/,
      /^mc:specsit:lastfeed:/,
      /^mc:conviction-enriched:/,
    ];
    function classify(k: string): string {
      if (k === LRU_KEY) return 'internal';
      for (var i = 0; i < CACHE_PATTERNS.length; i++) if (CACHE_PATTERNS[i].test(k)) return 'cache';
      return 'user';
    }

    // ── Codec: LZ77 over UTF-16 code units, emitted as 15-bit words (+32) ─
    // Stored as MARKER + base36(originalLength) + ':' + words. Words are
    // 32..32799, so never surrogates or NUL — safe in every browser's storage.
    // Word layout:
    //   literal run : 0b0LLLLLLLLLLLLLL (L = count 1..16383), then per unit
    //                 c (< 0x7FFF) or 0x7FFF, c>>>1, c&1.
    //   match       : 0b1LLLLLLLLLLLLLL (L = len-4), then offset:
    //                 0b0OOOOOOOOOOOOOO (< 16384) or 0b1HHHHHHHHHHHHHH + 15 low bits.
    var hashTable: Int32Array | null = null;
    function compress(s: string): string {
      var n = s.length;
      var c = new Uint16Array(n);
      for (var q = 0; q < n; q++) c[q] = s.charCodeAt(q);
      var out = new Uint16Array(n + (n >> 3) + 64);
      var o = 0;
      function grow(need: number) {
        if (o + need <= out.length) return;
        var bigger = new Uint16Array(Math.max(out.length * 2, o + need + 64));
        bigger.set(out.subarray(0, o)); out = bigger;
      }
      function flushLit(from: number, to: number) {
        while (from < to) {
          var run = to - from; if (run > 0x3fff) run = 0x3fff;
          grow(1 + run * 3);
          out[o++] = run;
          for (var j = from, e = from + run; j < e; j++) {
            var u = c[j];
            if (u < 0x7fff) out[o++] = u;
            else { out[o++] = 0x7fff; out[o++] = u >>> 1; out[o++] = u & 1; }
          }
          from += run;
        }
      }
      if (!hashTable) hashTable = new Int32Array(1 << 16);
      var table = hashTable; table.fill(-1);
      var i = 0, lit = 0, last = n - MIN_MATCH;
      while (i <= last) {
        var h = (Math.imul((c[i] | (c[i + 1] << 16)) ^ Math.imul(c[i + 2] | (c[i + 3] << 16), 0x9e3779b1), 0x85ebca6b) >>> 16);
        var cand = table[h]; table[h] = i;
        if (cand >= 0 && i - cand <= MAX_OFF && c[cand] === c[i] && c[cand + 1] === c[i + 1] && c[cand + 2] === c[i + 2] && c[cand + 3] === c[i + 3]) {
          var len = MIN_MATCH;
          var lim = n - i; if (lim > MAX_LEN) lim = MAX_LEN;
          while (len < lim && c[cand + len] === c[i + len]) len++;
          flushLit(lit, i);
          grow(3);
          var off = i - cand;
          out[o++] = 0x4000 | (len - MIN_MATCH);
          if (off < 0x4000) out[o++] = off;
          else { out[o++] = 0x4000 | (off >>> 15); out[o++] = off & 0x7fff; }
          // index a few positions inside the match (cheap, helps ratio)
          var end = i + len; var p = i + 1;
          var step = len > 32 ? 4 : 1;
          for (; p < end && p <= last; p += step) {
            table[(Math.imul((c[p] | (c[p + 1] << 16)) ^ Math.imul(c[p + 2] | (c[p + 3] << 16), 0x9e3779b1), 0x85ebca6b) >>> 16)] = p;
          }
          i = end; lit = i;
        } else {
          i += 1 + ((i - lit) >> 7); // skip faster through incompressible data
        }
      }
      flushLit(lit, n);
      var parts: string[] = [MARKER, n.toString(36), ':'];
      var CH = 8192;
      var buf = new Uint16Array(Math.min(CH, o));
      for (var a = 0; a < o; a += CH) {
        var b = Math.min(o, a + CH);
        var view = b - a === buf.length ? buf : new Uint16Array(b - a);
        for (var x = a; x < b; x++) view[x - a] = out[x] + 32;
        parts.push(String.fromCharCode.apply(null, view as any));
      }
      return parts.join('');
    }

    function isCompressed(raw: any): boolean {
      return typeof raw === 'string' && raw.length > MARKER.length && raw.charCodeAt(0) === 1 && raw.slice(0, MARKER.length) === MARKER;
    }

    function decompress(raw: string): string {
      var colon = raw.indexOf(':', MARKER.length);
      if (colon < 0) throw new Error('mcz: bad header');
      var n = parseInt(raw.slice(MARKER.length, colon), 36);
      if (!(n >= 0)) throw new Error('mcz: bad length');
      var out = new Uint16Array(n);
      var o = 0, p = colon + 1, L = raw.length;
      while (p < L) {
        var w = raw.charCodeAt(p++) - 32;
        if (w & 0x4000) {
          var len = (w & 0x3fff) + MIN_MATCH;
          var w1 = raw.charCodeAt(p++) - 32;
          var off = (w1 & 0x4000) ? (((w1 & 0x3fff) << 15) | (raw.charCodeAt(p++) - 32)) : w1;
          var src = o - off;
          if (off <= 0 || src < 0 || o + len > n) throw new Error('mcz: bad match');
          if (off >= len) { out.copyWithin(o, src, src + len); o += len; }
          else { for (var k = 0; k < len; k++) out[o++] = out[src + k]; }
        } else {
          if (w <= 0 || o + w > n) throw new Error('mcz: bad literal');
          for (var j = 0; j < w; j++) {
            var u = raw.charCodeAt(p++) - 32;
            if (u === 0x7fff) u = ((raw.charCodeAt(p++) - 32) << 1) | (raw.charCodeAt(p++) - 32);
            out[o++] = u;
          }
        }
      }
      if (o !== n || p !== L) throw new Error('mcz: length mismatch');
      var CH = 8192; var parts: string[] = [];
      for (var a = 0; a < n; a += CH) parts.push(String.fromCharCode.apply(null, out.subarray(a, Math.min(n, a + CH)) as any));
      return parts.join('');
    }

    // Encode for storage. Returns the raw value when compression does not pay
    // or the round-trip check fails (never stores something we cannot read
    // back exactly). A value that itself starts with MARKER is always encoded
    // so it can never be mistaken for compressed data.
    function encode(v: string): string {
      var mustEncode = isCompressed(v);
      if (v.length < MIN_CHARS && !mustEncode) return v;
      try {
        var enc = compress(v);
        if (!mustEncode && enc.length > v.length * 0.9) return v;
        if (decompress(enc) !== v) { stats.verifyFailures++; return v; }
        return enc;
      } catch (e) { stats.verifyFailures++; return v; }
    }

    // ── State ───────────────────────────────────────────────────────────
    var mem: Map<string, string> = new Map();          // session-only overflow
    var readCache: Map<string, { raw: string; val: string }> = new Map();
    var readCacheChars = 0;
    var lru: Record<string, number> = {};
    var lruDirty = false; var lruTimer: any = null;
    var warned = false;
    var stats = { compressedWrites: 0, evicted: [] as string[], overflow: 0, verifyFailures: 0, migrated: 0, migratedFreedChars: 0 };
    try { var lr = rawGet(LRU_KEY); if (lr) { var po = JSON.parse(lr); if (po && typeof po === 'object') lru = po; } } catch (e) {}

    function cachePut(k: string, raw: string, val: string) {
      var prev = readCache.get(k);
      if (prev) readCacheChars -= prev.val.length + prev.raw.length;
      if (readCacheChars + val.length + raw.length > READ_CACHE_MAX_CHARS) { readCache.clear(); readCacheChars = 0; }
      readCache.set(k, { raw: raw, val: val }); readCacheChars += val.length + raw.length;
    }
    function cacheDrop(k: string) {
      var prev = readCache.get(k);
      if (prev) { readCacheChars -= prev.val.length + prev.raw.length; readCache.delete(k); }
    }
    function flushLru() {
      lruTimer = null; if (!lruDirty) return; lruDirty = false;
      try { rawSet(LRU_KEY, JSON.stringify(lru)); } catch (e) {}
    }
    function touch(k: string) {
      if (classify(k) !== 'cache') return;
      lru[k] = Date.now(); lruDirty = true;
      if (!lruTimer && typeof win.setTimeout === 'function') lruTimer = win.setTimeout(flushLru, 3000);
    }
    function isQuota(e: any): boolean {
      if (!e) return false;
      var n = e.name, c = e.code;
      return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || c === 22 || c === 1014;
    }
    function markFull(k: string) {
      win.__mcStorageFull = true;
      if (!warned) {
        warned = true;
        try { win.console && win.console.warn && win.console.warn('[safe-storage] browser storage is full; "' + k + '" kept in memory for this session only'); } catch (e) {}
        try { if (typeof win.dispatchEvent === 'function' && typeof win.CustomEvent === 'function') win.dispatchEvent(new win.CustomEvent('mc:storage-full', { detail: { key: k } })); } catch (e) {}
      }
    }

    // Recompress existing big raw values in place. Returns chars freed.
    // budgetMs bounds one call; keys already compressed are skipped (cheap).
    function migrate(budgetMs?: number): { done: boolean; freed: number } {
      var t0 = Date.now(); var freed = 0;
      var keys = allKeys();
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === LRU_KEY) continue;
        if (budgetMs != null && Date.now() - t0 > budgetMs) return { done: false, freed: freed };
        var raw: string | null;
        try { raw = rawGet(k); } catch (e) { continue; }
        if (raw == null || raw.length < MIN_CHARS || isCompressed(raw)) continue;
        var enc = encode(raw);
        if (enc === raw) continue;              // did not pay, or verify failed
        try {
          if (rawGet(k) !== raw) continue;       // changed under us
          rawSet(k, enc);
          freed += raw.length - enc.length;
          stats.migrated++;
          cachePut(k, enc, raw);
        } catch (e) { /* leave original */ }
      }
      stats.migratedFreedChars += freed;
      return { done: true, freed: freed };
    }

    function evictOne(exceptKey: string): boolean {
      var keys = allKeys(); var best: string | null = null; var bestTs = Infinity; var bestSize = -1;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (classify(k) !== 'cache' || k === exceptKey) continue;
        var ts = lru[k] || 0;
        var size = 0; try { var r = rawGet(k); size = r ? r.length : 0; } catch (e) {}
        if (ts < bestTs || (ts === bestTs && size > bestSize)) { best = k; bestTs = ts; bestSize = size; }
      }
      if (best == null) return false;
      try { rawRemove(best); } catch (e) { return false; }
      cacheDrop(best); delete lru[best]; lruDirty = true;
      stats.evicted.push(best);
      return true;
    }

    function safeSet(k: string, v: string) {
      var stored = encode(v);
      var compressed = stored !== v;
      var lastErr: any = null;
      var migratedOnce = false;
      for (var attempt = 0; attempt < 500; attempt++) {
        try {
          rawSet(k, stored);
          mem.delete(k);
          if (compressed) { stats.compressedWrites++; cachePut(k, stored, v); } else cacheDrop(k);
          touch(k);
          return;
        } catch (e) {
          if (!isQuota(e)) throw e;
          lastErr = e;
          if (!migratedOnce) { migratedOnce = true; if (migrate().freed > 0) continue; }
          if (!evictOne(k)) break;
        }
      }
      // Still does not fit: keep for this session.
      mem.set(k, v); cacheDrop(k); stats.overflow++;
      markFull(k);
      if (classify(k) !== 'cache') throw lastErr;  // preserve caller fallbacks
    }

    // ── Patch Storage.prototype (localStorage only) ─────────────────────
    proto.setItem = function (this: any, k: any, v: any) {
      if (this !== ls || arguments.length < 2) return origSet.apply(this, arguments as any);
      return safeSet(String(k), String(v));
    };
    proto.getItem = function (this: any, k: any) {
      if (this !== ls || arguments.length < 1) return origGet.apply(this, arguments as any);
      var key = String(k);
      if (mem.size && mem.has(key)) return mem.get(key) as string;
      var raw = rawGet(key);
      if (raw == null || !isCompressed(raw)) return raw;
      var hit = readCache.get(key);
      if (hit && hit.raw === raw) { touch(key); return hit.val; }
      try {
        var val = decompress(raw);
        cachePut(key, raw, val); touch(key);
        return val;
      } catch (e) {
        try { win.console && win.console.warn && win.console.warn('[safe-storage] could not decode "' + key + '"', e); } catch (e2) {}
        return null;
      }
    };
    proto.removeItem = function (this: any, k: any) {
      if (this !== ls || arguments.length < 1) return origRemove.apply(this, arguments as any);
      var key = String(k);
      mem.delete(key); cacheDrop(key);
      if (lru[key]) { delete lru[key]; lruDirty = true; }
      return origRemove.call(ls, key);
    };
    proto.clear = function (this: any) {
      if (this !== ls) return origClear.apply(this, arguments as any);
      mem.clear(); readCache.clear(); readCacheChars = 0; lru = {};
      return origClear.call(ls);
    };

    // Cross-tab 'storage' events carry the raw stored string — decode it.
    try {
      var SE = win.StorageEvent;
      if (SE && SE.prototype) {
        ['newValue', 'oldValue'].forEach(function (prop) {
          var d = Object.getOwnPropertyDescriptor(SE.prototype, prop);
          if (!d || !d.get || !d.configurable) return;
          var g = d.get;
          Object.defineProperty(SE.prototype, prop, {
            configurable: true, enumerable: d.enumerable,
            get: function (this: any) {
              var r = g.call(this);
              if (!isCompressed(r)) return r;
              try { return decompress(r); } catch (e) { return null; }
            },
          });
        });
      }
      if (typeof win.addEventListener === 'function') {
        win.addEventListener('storage', function (e: any) {
          try {
            if (e && e.storageArea === ls) { if (e.key == null) { readCache.clear(); readCacheChars = 0; } else cacheDrop(e.key); }
          } catch (x) {}
        });
        win.addEventListener('pagehide', function () { flushLru(); });
      }
    } catch (e) {}

    // Background migration of existing big values, a slice at a time.
    function scheduleMigrate() {
      var run = function () {
        var r = migrate(40);
        if (!r.done) schedule();
      };
      var schedule = function () {
        if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 4000 });
        else if (typeof win.setTimeout === 'function') win.setTimeout(run, 200);
      };
      schedule();
    }

    var api = {
      version: 1,
      MARKER: MARKER,
      MIN_CHARS: MIN_CHARS,
      compress: compress,
      decompress: decompress,
      isCompressed: isCompressed,
      classify: classify,
      migrate: migrate,
      stats: function () {
        var keys = allKeys(); var stored = 0; var logical = 0; var list: any[] = [];
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i]; var r = rawGet(k) || '';
          var l = r.length;
          if (isCompressed(r)) { var c = r.indexOf(':', MARKER.length); l = parseInt(r.slice(MARKER.length, c), 36) || 0; }
          stored += k.length + r.length; logical += k.length + l;
          list.push({ key: k, storedChars: r.length, logicalChars: l, kind: classify(k), compressed: isCompressed(r) });
        }
        list.sort(function (a, b) { return b.storedChars - a.storedChars; });
        return { storedChars: stored, logicalChars: logical, keys: list, memoryOnly: Array.from(mem.keys()), counters: stats, full: !!win.__mcStorageFull };
      },
      // Rollback helper: rewrite every compressed value uncompressed (may not
      // fit — returns keys that could not be restored).
      decompressAll: function () {
        var failed: string[] = []; var keys = allKeys();
        for (var i = 0; i < keys.length; i++) {
          var r = rawGet(keys[i]);
          if (!isCompressed(r)) continue;
          try { rawSet(keys[i], decompress(r as string)); } catch (e) { failed.push(keys[i]); }
        }
        return failed;
      },
    };
    win.__mcSafeStorage = api;
    win.__mcStorageFull = false;
    scheduleMigrate();
    return api;
  } catch (e) {
    return null;
  }
}

/** Inline <script> body for the root layout <head>. Runs before any bundle. */
export function safeStorageEarlyScript(): string {
  // The __name shim keeps the source valid if a transpiler with keepNames
  // (esbuild/tsx) injected __name(fn,"x") calls into the function body.
  return 'try{(function(){var __name=function(f){return f};(' + installSafeStorage.toString() + ')(window)})()}catch(e){}';
}
