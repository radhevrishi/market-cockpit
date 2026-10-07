import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncVaultOnce, resolveVaultConflict, quickHash } from '../user-vault-client';
import { parseVersionedResult } from '../kv-versioned';

function browser() {
  const original = { fetch: globalThis.fetch, window: (globalThis as any).window, localStorage: (globalThis as any).localStorage };
  const values = new Map<string, string>(); const events: Event[] = [];
  (globalThis as any).window = { dispatchEvent: (e: Event) => { events.push(e); return true; } };
  (globalThis as any).localStorage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string,v: string) => values.set(k,v), get length() { return values.size; }, key: (i: number) => [...values.keys()][i] };
  return { values, events, close() { Object.assign(globalThis, original); } };
}
const key = 'mc:decisions:v1';
const wrapped = (value: unknown) => ({ __raw: JSON.stringify(value), parsed: value });

test('409 preserves local changes, does not advance sync metadata, and emits a visible conflict', async () => {
  const b = browser();
  try {
    b.values.set(key, JSON.stringify(['local edit']));
    const last = { [key]: { hash: quickHash(JSON.stringify(wrapped(['prior']))), version: 1 } };
    b.values.set('mc:vault:meta:v1', JSON.stringify(last));
    let puts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('list=1')) return Response.json({ keys: [{ key, version: 2, hash: 'newer' }] });
      puts++; return Response.json({ conflict: true, version: 2 }, { status: 409 });
    }) as typeof fetch;
    const result = await syncVaultOnce();
    assert.equal(puts, 1); assert.deepEqual(result.pushed, []); assert.match(result.error!, /conflict/);
    assert.equal(b.values.get(key), JSON.stringify(['local edit']));
    assert.deepEqual(JSON.parse(b.values.get('mc:vault:meta:v1')!), last);
    assert.equal(JSON.parse(b.values.get(`mc:vault:conflict:${key}`)!).value.__raw, JSON.stringify(['local edit']));
    assert.ok(b.events.some(e => e.type === 'mc:vault:conflict'));
  } finally { b.close(); }
});

test('explicit keep-local resolution uses current server version and retains edits made during PUT', async () => {
  const b = browser();
  try {
    b.values.set(key, JSON.stringify(['submitted'])); let submitted: any;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ ok: true, found: true, version: 7, value: wrapped(['server']) });
      submitted = JSON.parse(String(init.body));
      b.values.set(key, JSON.stringify(['edited during PUT']));
      return Response.json({ ok: true, version: 8 });
    }) as typeof fetch;
    await resolveVaultConflict(key, 'local');
    assert.equal(submitted.baseVersion, 7);
    assert.equal(b.values.get(key), JSON.stringify(['edited during PUT']));
    const meta = JSON.parse(b.values.get('mc:vault:meta:v1')!)[key];
    assert.equal(meta.version, 8); assert.equal(meta.hash, quickHash(JSON.stringify(wrapped(['submitted']))));
  } finally { b.close(); }
});

test('server resolution never overwrites an edit made while the read was in flight', async () => {
  const b = browser();
  try {
    b.values.set(key, JSON.stringify(['before']));
    globalThis.fetch = (async () => { b.values.set(key, JSON.stringify(['new edit'])); return Response.json({ ok: true, found: true, version: 2, value: wrapped(['server']) }); }) as typeof fetch;
    await assert.rejects(resolveVaultConflict(key, 'server'), /changed/);
    assert.equal(b.values.get(key), JSON.stringify(['new edit']));
  } finally { b.close(); }
});

test('server resolution keeps a recovery copy before applying the chosen saved value', async () => {
  const b = browser();
  try {
    b.values.set(key, JSON.stringify(['local']));
    globalThis.fetch = (async () => Response.json({ ok: true, found: true, version: 4, value: wrapped(['server']) })) as typeof fetch;
    await resolveVaultConflict(key, 'server');
    assert.equal(b.values.get(key), JSON.stringify(['server']));
    assert.equal(JSON.parse(b.values.get(`mc:vault:conflict:${key}`)!).value.__raw, JSON.stringify(['local']));
  } finally { b.close(); }
});

test('invalid atomic acknowledgements cannot claim a save succeeded', () => {
  for (const result of [null, [], [1, ''], [1, JSON.stringify({ version: -1, hash: 'x' })]]) assert.throws(() => parseVersionedResult(result));
  assert.deepEqual(parseVersionedResult([0, '']), { ok: false, unchanged: false, row: null });
});
