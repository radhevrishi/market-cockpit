// zzz1074 — chart watchlists are merged three ways when two devices both changed them (no more "Another device saved a newer
// copy" for them); zzz1073 — Earnings Opportunities notes and the "results pending" list moved to the end of the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeWatchlistStores } from '../chart-watchlist-merge';
import { VAULT_MERGERS, VAULT_BASE_KEYS } from '../chart-sync';
import { mergeDecision } from '../user-vault-client';
import { CHART_WATCHLISTS_KEY, type WlStore } from '../chart-watchlist';

const store = (sections: Array<[string, string[]]>, extra: Partial<WlStore> = {}): WlStore => ({
  activeId: 'l1',
  lists: [{ id: 'l1', name: 'Main', sections: sections.map(([id, ts]) => ({ id, name: id, collapsed: false, items: ts.map((t) => ({ m: 'US' as const, t })) })) }],
  ...extra,
});
const tickers = (s: WlStore) => s.lists[0].sections.map((x) => `${x.id}:${x.items.map((i) => i.t).join(',')}`);

test('both devices added different tickers: both kept', () => {
  const base = store([['s1', ['AAPL']]]);
  const local = store([['s1', ['AAPL', 'NVDA']]]);
  const server = store([['s1', ['AAPL', 'MSFT']]]);
  assert.deepEqual(tickers(mergeWatchlistStores(local, server, base)), ['s1:AAPL,MSFT,NVDA']);
});

test('a ticker deleted on one device stays deleted (the other did not touch it)', () => {
  const base = store([['s1', ['AAPL', 'TSLA']]]);
  const local = store([['s1', ['AAPL']]]);                  // this device removed TSLA
  const server = store([['s1', ['AAPL', 'TSLA', 'AMD']]]);  // the other device added AMD
  assert.deepEqual(tickers(mergeWatchlistStores(local, server, base)), ['s1:AAPL,AMD']);
  // and the mirror: deleted on the server
  assert.deepEqual(tickers(mergeWatchlistStores(server, local, base)), ['s1:AAPL,AMD']);
});

test('a flag changed on one side wins; no base = union, nothing deleted', () => {
  const base = store([['s1', ['AAPL']]]);
  const local = store([['s1', ['AAPL']]]);
  const server: WlStore = JSON.parse(JSON.stringify(local)); server.lists[0].sections[0].items[0].flag = 'red';
  assert.equal(mergeWatchlistStores(local, server, base).lists[0].sections[0].items[0].flag, 'red');
  const u = mergeWatchlistStores(store([['s1', ['AAPL']]]), store([['s1', ['TSLA']], ['s2', ['AMD']]]), null);
  assert.deepEqual(tickers(u), ['s1:TSLA,AAPL', 's2:AMD']);
});

test('a section added on each device and a list deleted on one', () => {
  const base: WlStore = { activeId: 'l1', lists: [{ id: 'l1', name: 'Main', sections: [] }, { id: 'l2', name: 'Old', sections: [{ id: 'o', name: 'O', collapsed: false, items: [] }] }] };
  const local: WlStore = { activeId: 'l1', lists: [{ id: 'l1', name: 'Main', sections: [{ id: 'a', name: 'A', collapsed: false, items: [] }] }] };   // removed l2
  const server: WlStore = { activeId: 'l2', lists: [{ id: 'l1', name: 'Main', sections: [{ id: 'b', name: 'B', collapsed: false, items: [] }] }, { id: 'l2', name: 'Old', sections: [{ id: 'o', name: 'O', collapsed: false, items: [] }] }] };
  const m = mergeWatchlistStores(local, server, base);
  assert.deepEqual(m.lists.map((l) => l.id), ['l1']);
  assert.deepEqual(m.lists[0].sections.map((s) => s.id), ['b', 'a']);
  assert.equal(m.activeId, 'l1');
});

test('vault: watchlists are a merged key with a kept base; mergeDecision passes the base through', () => {
  assert.ok(VAULT_MERGERS[CHART_WATCHLISTS_KEY]);
  assert.ok(VAULT_BASE_KEYS.has(CHART_WATCHLISTS_KEY));
  const base = store([['s1', ['AAPL', 'TSLA']]]);
  const d = mergeDecision(store([['s1', ['AAPL']]]), store([['s1', ['AAPL', 'TSLA']]]), VAULT_MERGERS[CHART_WATCHLISTS_KEY], base);
  assert.deepEqual(tickers(d.merged as WlStore), ['s1:AAPL'], 'the deletion survives');
  assert.equal(d.needPush, true);
  const src = readFileSync(join(__dirname, '..', 'user-vault-client.ts'), 'utf8');
  assert.match(src, /rememberBase\(key, local\)/);
  assert.match(src, /readVaultBase\(key\)/);
});

test('EO page: window notes and the results-pending list come after the cards', () => {
  const s = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities', 'page.tsx'), 'utf8');
  const cards = s.indexOf("{windowView === 'date' && dGroups.map(");
  const notes = s.indexOf('NOTES ON THIS WINDOW');
  const notGraded = s.indexOf("filed but couldn&apos;t be graded</strong>");
  const pending = s.indexOf('📅 SCHEDULED TODAY · RESULTS PENDING');
  const tierCards = s.indexOf("{viewMode === 'GRADED' && !windowOn && TIER_ORDER.map((tier) =>");
  assert.ok(cards > 0 && notes > cards, 'notes box after the window cards');
  assert.ok(notGraded > notes, '"couldn\'t be graded" is inside the notes');
  assert.ok(pending > tierCards && pending > notes, 'results-pending list after the single-date and window cards');
});
