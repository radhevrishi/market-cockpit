// zzz855 — safe localStorage layer. Run: npx tsx --test src/lib/__tests__/zzz855-storage.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { installSafeStorage, safeStorageEarlyScript } from '../storage/safe-storage-runtime';

// A localStorage stand-in with a real prototype (the runtime patches the
// prototype, like Storage.prototype in a browser) and a quota counted in
// UTF-16 chars of key+value, like Chromium.
function makeEnv(quotaChars = 5_000_000) {
  class FakeStorage {
    _m = new Map<string, string>();
    _quota = quotaChars;
    get length() { return this._m.size; }
    key(i: number) { return Array.from(this._m.keys())[i] ?? null; }
    getItem(k: string) { const v = this._m.get(String(k)); return v === undefined ? null : v; }
    setItem(k: string, v: string) {
      k = String(k); v = String(v);
      const old = this._m.get(k);
      const used = this.used() - (old !== undefined ? k.length + old.length : 0);
      if (used + k.length + v.length > this._quota) { const e: any = new Error('quota'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
      this._m.set(k, v);
    }
    removeItem(k: string) { this._m.delete(String(k)); }
    clear() { this._m.clear(); }
    used() { let n = 0; for (const [k, v] of this._m) n += k.length + v.length; return n; }
  }
  const ls = new FakeStorage();
  const timers: Function[] = [];
  const warnings: any[] = [];
  const events: any[] = [];
  const win: any = {
    localStorage: ls,
    setTimeout: (fn: Function) => { timers.push(fn); return timers.length; },
    console: { warn: (...a: any[]) => warnings.push(a) },
    addEventListener: () => {},
    dispatchEvent: (e: any) => { events.push(e); return true; },
    CustomEvent: class { type: string; detail: any; constructor(t: string, o: any) { this.type = t; this.detail = o?.detail; } },
  };
  return { ls, win, timers, warnings, events, FakeStorage, runTimers: () => { while (timers.length) timers.shift()!(); } };
}

function rowsSample(nRows = 1500) {
  const sectors = ['Capital Goods', 'Chemicals', 'Defence', 'IT Services', 'Pharma', 'Auto Ancillary', 'Power'];
  const rows = [];
  for (let i = 0; i < nRows; i++) {
    rows.push({
      symbol: 'SYM' + i, name: 'Company ' + i + ' Limited', sector: sectors[i % sectors.length],
      market_cap_cr: Math.round(500 + (i * 7919) % 40000), pe: +(10 + (i * 31) % 70 + Math.random()).toFixed(2),
      roce: +(5 + (i * 13) % 40 + Math.random()).toFixed(1), sales_growth_3y: +(Math.random() * 60 - 10).toFixed(1),
      profit_growth_3y: +(Math.random() * 80 - 20).toFixed(1), debt_to_equity: +(Math.random() * 2).toFixed(2),
      promoter_holding: +(30 + Math.random() * 45).toFixed(2), score: Math.round(Math.random() * 100),
      tier: i % 5 === 0 ? 'STRONG' : 'WATCH', flags: i % 9 === 0 ? ['pledge', 'low-cfo'] : [], notes: '₹ guidance ↑ — 収益 ' + (i % 3),
    });
  }
  return JSON.stringify(rows);
}

function realSample(): string | null {
  // Real app payload (persistent-catalyst ledger fixture, ~1.16M chars).
  try { return fs.readFileSync(path.join(__dirname, 'fixtures/zzz790-pc-named.json'), 'utf8'); } catch { return null; }
}

describe('zzz855 safe localStorage', () => {
  test('codec round-trips edge cases incl. unicode, surrogates, marker-like text', () => {
    const { win } = makeEnv();
    const api = installSafeStorage(win);
    const cases = [
      '', 'a', 'aaaa', 'abcabcabcabcabcabc', 'x'.repeat(100000),
      '😀🚀'.repeat(20000) + 'end', '\uD800 lone \uDC00 surrogates ￿ 翿耀鿿',
      '\u0000\u0001\u0002 control', api.MARKER + 'looks compressed but is not',
      rowsSample(300),
      Array.from({ length: 70000 }, (_, i) => String.fromCharCode((i * 2654435761) % 65536)).join(''),
    ];
    for (const s of cases) assert.equal(api.decompress(api.compress(s)), s);
  });

  test('big values are stored compressed and read back transparently', () => {
    const { ls, win } = makeEnv();
    installSafeStorage(win);
    const v = rowsSample(1500);
    ls.setItem('mb_excel_scored_v2', v);
    const raw = (ls as any)._m.get('mb_excel_scored_v2');
    assert.ok(win.__mcSafeStorage.isCompressed(raw));
    assert.ok(raw.length < v.length * 0.5, `stored ${raw.length} vs ${v.length}`);
    assert.equal(ls.getItem('mb_excel_scored_v2'), v);
    assert.deepEqual(JSON.parse(ls.getItem('mb_excel_scored_v2')!), JSON.parse(v));
    // read cache: same string object while the stored value is unchanged
    assert.equal(ls.getItem('mb_excel_scored_v2'), ls.getItem('mb_excel_scored_v2'));
    // small values pass through untouched
    ls.setItem('mc:posCalc:capital', '100000');
    assert.equal((ls as any)._m.get('mc:posCalc:capital'), '100000');
    // a short value that starts with the marker is still stored safely
    const tricky = win.__mcSafeStorage.MARKER + 'x';
    ls.setItem('weird', tricky);
    assert.equal(ls.getItem('weird'), tricky);
  });

  test('legacy uncompressed values stay readable; removeItem/clear work', () => {
    const { ls, win } = makeEnv();
    const legacy = rowsSample(800);
    (ls as any)._m.set('mc:conviction-beats:v1', legacy);
    installSafeStorage(win);
    assert.equal(ls.getItem('mc:conviction-beats:v1'), legacy);
    ls.removeItem('mc:conviction-beats:v1');
    assert.equal(ls.getItem('mc:conviction-beats:v1'), null);
    ls.setItem('a', rowsSample(500)); ls.clear();
    assert.equal(ls.length, 0); assert.equal(ls.getItem('a'), null);
  });

  test('sessionStorage-like other instances are not touched', () => {
    const { win, FakeStorage } = makeEnv();
    installSafeStorage(win);
    const other: any = new (FakeStorage as any)();
    const v = rowsSample(500);
    other.setItem('k', v);
    assert.equal(other._m.get('k'), v);
  });

  test('quota: evicts cache keys (LRU first), never user keys, never throws for cache', () => {
    const { ls, win } = makeEnv(400_000);
    const api = installSafeStorage(win);
    // incompressible filler so compression cannot rescue us
    const noise = (n: number, seed: number) => { let s = ''; let x = seed; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; s += String.fromCharCode(0x4e00 + (x % 5000)); } return s; };
    ls.setItem('mb_excel_scored_v2', noise(120_000, 1));        // user
    ls.setItem('mc_watchlist_tickers', noise(60_000, 2));       // user
    ls.setItem('mc:hub:v7:old', noise(80_000, 3));              // cache (older)
    ls.setItem('mc:graded:v10:2026-09-01', noise(80_000, 4));   // cache (newer)
    ls.setItem('unknown-key', noise(30_000, 5));                // unknown → user
    // New cache write needs ~100k → must evict cache only
    assert.doesNotThrow(() => ls.setItem('mc:cap-map:v1', noise(100_000, 6)));
    for (const k of ['mb_excel_scored_v2', 'mc_watchlist_tickers', 'unknown-key']) assert.ok((ls as any)._m.has(k), `user key ${k} kept`);
    assert.ok(api.stats().counters.evicted.length >= 1);
    for (const k of api.stats().counters.evicted) assert.equal(api.classify(k), 'cache');
    // A cache write that can never fit: swallowed, kept in memory, flag set.
    assert.doesNotThrow(() => ls.setItem('mc:strategic-vis:v1:7', noise(500_000, 7)));
    assert.equal(win.__mcStorageFull, true);
    assert.equal(ls.getItem('mc:strategic-vis:v1:7')!.length, 500_000);
    for (const k of ['mb_excel_scored_v2', 'mc_watchlist_tickers', 'unknown-key']) assert.ok((ls as any)._m.has(k));
  });

  test('eviction order: least-recently-used cache key first, even if smaller', () => {
    const { ls, win } = makeEnv(300_000);
    const noise = (n: number, seed: number) => { let s = ''; let x = seed; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; s += String.fromCharCode(0x4e00 + (x % 5000)); } return s; };
    (ls as any)._m.set('mc:hub:v7:recent', noise(100_000, 1));
    (ls as any)._m.set('mc:hub:v7:stale', noise(60_000, 2));
    (ls as any)._m.set('mb_excel_scored_v2', noise(100_000, 3));
    (ls as any)._m.set('__mc_ss_lru_v1', JSON.stringify({ 'mc:hub:v7:recent': 2000, 'mc:hub:v7:stale': 1000 }));
    const api = installSafeStorage(win);
    ls.setItem('mc:cap-map:v1', noise(50_000, 4));
    assert.deepEqual(api.stats().counters.evicted, ['mc:hub:v7:stale']);
    assert.ok((ls as any)._m.has('mc:hub:v7:recent'));
    assert.ok((ls as any)._m.has('mb_excel_scored_v2'));
  });

  test('quota: user key that cannot fit re-throws (callers keep their fallbacks) but stays readable this session', () => {
    const { ls, win, warnings, events } = makeEnv(200_000);
    installSafeStorage(win);
    const noise = (n: number) => { let s = ''; let x = 9; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; s += String.fromCharCode(0x4e00 + (x % 5000)); } return s; };
    ls.setItem('mb_usa_scored_v1', noise(150_000));
    const big = noise(120_000);
    assert.throws(() => ls.setItem('mb_turnaround_scored_v1', big), (e: any) => e.name === 'QuotaExceededError');
    assert.equal(ls.getItem('mb_turnaround_scored_v1'), big);
    assert.ok((ls as any)._m.has('mb_usa_scored_v1'));
    assert.equal(win.__mcStorageFull, true);
    assert.equal(warnings.length, 1); assert.equal(events.length, 1);
    // a second failure does not warn again
    try { ls.setItem('mb_turnaround_scored_v2', big); } catch {}
    assert.equal(warnings.length, 1);
  });

  test('quota path compresses legacy raw values before evicting anything', () => {
    const { ls, win } = makeEnv(1_000_000);
    const user = rowsSample(2500);              // ~0.5M chars, compressible
    (ls as any)._m.set('mb_excel_scored_v2', user);
    (ls as any)._m.set('mc:hub:v7:x', rowsSample(1500));
    const api = installSafeStorage(win);
    const v = rowsSample(2000);
    assert.doesNotThrow(() => ls.setItem('mb_usa_scored_v1', v));
    assert.equal(api.stats().counters.evicted.length, 0, 'compression alone made room');
    assert.equal(ls.getItem('mb_excel_scored_v2'), user);
    assert.equal(ls.getItem('mb_usa_scored_v1'), v);
  });

  test('migration frees space, is lossless and idempotent', () => {
    const { ls, win, runTimers } = makeEnv();
    const a = rowsSample(2000), b = rowsSample(1200), small = '{"x":1}';
    (ls as any)._m.set('mb_excel_scored_v2', a);
    (ls as any)._m.set('mc:conviction-beats-us:v1', b);
    (ls as any)._m.set('mc:posCalc:capital', small);
    const before = (ls as any).used();
    const api = installSafeStorage(win);
    runTimers(); // background migration slice(s)
    const after = (ls as any).used();
    assert.ok(after < before * 0.45, `before ${before} after ${after}`);
    assert.equal(ls.getItem('mb_excel_scored_v2'), a);
    assert.equal(ls.getItem('mc:conviction-beats-us:v1'), b);
    assert.equal((ls as any)._m.get('mc:posCalc:capital'), small);
    const snap = JSON.stringify(Array.from((ls as any)._m.entries()));
    const r = api.migrate();
    assert.equal(r.freed, 0);
    assert.equal(JSON.stringify(Array.from((ls as any)._m.entries())), snap);
  });

  test('install is idempotent (no double wrapping)', () => {
    const { ls, win } = makeEnv();
    const a1 = installSafeStorage(win); const a2 = installSafeStorage(win);
    assert.equal(a1, a2);
    const v = rowsSample(500);
    ls.setItem('k', v);
    assert.equal(ls.getItem('k'), v);
    assert.ok(a1.isCompressed((ls as any)._m.get('k')));
  });

  test('inline <head> script is self-contained and installs in an empty sandbox', () => {
    const { ls, win } = makeEnv();
    const src = safeStorageEarlyScript();
    assert.ok(!/require\(|import\(/.test(src), 'no imports in the inline script');
    const ctx = vm.createContext({ window: win });
    vm.runInContext(src.replace('try{', 'try{').replace('catch(e){}', 'catch(e){throw e}'), ctx);
    assert.ok(win.__mcSafeStorage, 'installed');
    const v = rowsSample(600);
    ls.setItem('mb_tech_rows_usa_v1', v);
    assert.ok(win.__mcSafeStorage.isCompressed((ls as any)._m.get('mb_tech_rows_usa_v1')));
    assert.equal(ls.getItem('mb_tech_rows_usa_v1'), v);
  });

  test('codec speed and ratio (1 MB JSON) — prints estimate', () => {
    const { win } = makeEnv();
    const api = installSafeStorage(win);
    const synth = rowsSample(5200);               // ~1M chars
    const real = realSample();
    for (const [label, s] of [['synthetic rows', synth], ['real app json (zzz790 fixture)', real]] as const) {
      if (!s) continue;
      api.compress(s); // warm-up JIT
      let t = performance.now(); const enc = api.compress(s); const tc = performance.now() - t;
      t = performance.now(); const dec = api.decompress(enc); const td = performance.now() - t;
      assert.equal(dec, s);
      const ratio = enc.length / s.length;
      // eslint-disable-next-line no-console
      console.log(`[zzz855] ${label}: ${(s.length / 1e6).toFixed(2)}M chars → ${(enc.length / 1e6).toFixed(3)}M (${(ratio * 100).toFixed(1)}%) compress ${tc.toFixed(1)} ms, decompress ${td.toFixed(1)} ms (per MB: ${(tc / (s.length / 1e6)).toFixed(1)} / ${(td / (s.length / 1e6)).toFixed(1)} ms)`);
      assert.ok(tc / (s.length / 1e6) < 100, 'compress < 100 ms per 1M chars');
      assert.ok(td / (s.length / 1e6) < 50, 'decompress < 50 ms per 1M chars');
      assert.ok(ratio < 0.5);
    }
  });
});
