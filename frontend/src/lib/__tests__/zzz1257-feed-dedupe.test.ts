// zzz1257 — the Special Situations merge no longer re-parses every kept headline for every new event (it blocked the whole
// server for ~12 s per refresh); (2) the heap guard collects garbage before it blocks jobs or restarts the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dedupeFeedEvents } from '../multibagger-radar-adapter';

const read = (...p: string[]) => readFileSync(new URL(['..', ...p].join('/'), import.meta.url), 'utf8');

const ev = (id: string, title: string, o: Record<string, unknown> = {}): any => ({
  event_id: id, event_type: 'MA', region: 'IN', primary_source: false,
  primary_filing: { title, link: `https://x.example/${id}`, source: 'ET', pub_date: '2026-11-10T08:00:00Z', region: 'IN' }, filings: [], ...o,
});

test('syndicated copies of one deal merge; different regions and held-back items never merge into shown ones', () => {
  const a = ev('a', 'Acme Corp to acquire Beta Industries for 500 crore');
  const b = ev('b', 'Acme Corp to acquire Beta Industries for 500 crore deal', { primary_filing: { title: 'Acme Corp to acquire Beta Industries for 500 crore deal', link: 'https://y.example/b', source: 'Mint', pub_date: '2026-11-10T09:00:00Z', region: 'IN' } });
  const us = ev('us', 'Acme Corp to acquire Beta Industries for 500 crore', { region: 'US' });
  const held = ev('held', 'Acme Corp to acquire Beta Industries for 500 crore', { quarantine_reason: 'FUND_REPURCHASE_OFFER' });
  const r = dedupeFeedEvents([a, b, us, held]);
  assert.equal(r.merged, 1);
  assert.equal(r.events.length, 3);
  assert.deepEqual(r.events.map((e) => e.region).sort(), ['IN', 'IN', 'US']);
});

test('the same SEC accession lists once even when the headlines differ', () => {
  const link = 'https://www.sec.gov/Archives/edgar/data/1234/0001234567-26-000777-index.htm';
  const mk = (id: string, title: string) => ev(id, title, { primary_filing: { title, link, source: 'SEC', pub_date: '2026-11-10T08:00:00Z', region: 'IN' } });
  const r = dedupeFeedEvents([mk('s1', 'SC TO-T - Delta Steel Limited (Subject)'), mk('s2', 'SC TO-T - Omega Energy (Filed by)')]);
  assert.equal(r.merged, 1);
});

test('3,000 unrelated events merge in well under the old time (no per-pair re-parsing)', () => {
  const words = ['Alpha', 'Brava', 'Cobalt', 'Dynamo', 'Ember', 'Fjord', 'Glacier', 'Harbor', 'Ion', 'Jasper'];
  const evs = Array.from({ length: 3000 }, (_, i) => ev(`e${i}`, `${words[i % 10]}${i} ${words[(i * 7) % 10]}${i * 3} Ltd announces unique plan ${i}`, { event_type: ['MA', 'SPIN', 'CAP'][i % 3] }));
  const t0 = Date.now();
  const r = dedupeFeedEvents(evs);
  const ms = Date.now() - t0;
  assert.equal(r.events.length, 3000);
  assert.ok(ms < 4000, `took ${ms} ms`);
});

test('dedupe computes each event once: no secChainKey / canonicalEventKey / sameEvent call inside the pair loop', () => {
  const src = read('multibagger-radar-adapter.ts');
  const body = src.slice(src.indexOf('export function dedupeFeedEvents'), src.indexOf('export function eventsToRadarInputs'));
  assert.match(body, /const feats = new WeakMap<RadarFeedEvent, DedupeFeat>\(\)/);
  assert.doesNotMatch(body, /sameEvent\(\{ title/);
  assert.doesNotMatch(body, /canonicalEventKey\(\{ title: kt/);
  assert.doesNotMatch(body, /secChainKey\(k\)/);
});
