// zzz797 — US Conviction Beats on the US Portfolio Catalysts bench.
// The owner saw "🏆 US bench 0" while the server list held 92 BLOCKBUSTER /
// STRONG names. The bench is now built from the server list first (rebuilt
// server-side from the graded-US cache when KV is empty), plus this
// browser's list, minus the owner's removals, de-duplicated against holdings.
// Run: npx tsx --test src/lib/__tests__/zzz797-us-pc-bench.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compactUsBench, mergeUsBench, rebuildUsBench, usBenchSessions, usBenchLine, usBenchEmptyReason, usBenchName } from '../us-thesis/us-bench';
import { convictionBenchAdds } from '../us-thesis/use-us-book';

const LIVE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz797-us-bench-live.json'), 'utf8'));
// The owner's US holdings named in his pastes (a subset of the 30).
const HELD = ['ALB', 'AKAM', 'AVAV', 'CIFR', 'ESP', 'GFS', 'ITW', 'LAR', 'MDA', 'MOG-A', 'NTNX', 'NVEC', 'OII', 'PL', 'POWL', 'RELL', 'RSKD', 'SILC', 'WULF', 'XPEV'];

describe('zzz797 US bench — the live server list reaches the page', () => {
  test('the live KV list: 92 names, all BLOCKBUSTER or STRONG, one per ticker', () => {
    const names = compactUsBench(LIVE.entries);
    assert.equal(names.length, 92);
    assert.ok(names.every((n) => n.tier === 'BLOCKBUSTER' || n.tier === 'STRONG'));
    assert.equal(new Set(names.map((n) => n.ticker)).size, 92);
  });

  test('a fresh phone (empty browser storage) still gets every name from the server', () => {
    const mg = mergeUsBench(LIVE.entries, [], []);
    assert.equal(mg.names.length, 92);
    assert.equal(mg.server, 92);
    assert.equal(mg.local, 0);
  });

  test('de-duplicated against holdings: held CB names (ALB, NTNX) are holdings, the rest are bench adds', () => {
    const uni = HELD.map((t) => ({ ticker: t }));
    const adds = convictionBenchAdds(uni, mergeUsBench(LIVE.entries, [], []).names);
    assert.equal(adds.length, 92 - 2);
    assert.ok(!adds.some((a) => a.ticker === 'ALB' || a.ticker === 'NTNX'));
  });

  test('names removed on US Conviction Beats stay off; names only in this browser are added', () => {
    const mg = mergeUsBench(LIVE.entries, [{ ticker: 'ZZZQ', tier: 'STRONG' }, { ticker: 'NVDA', tier: 'STRONG' }], ['NVDA', 'SNOW']);
    assert.equal(mg.removed.length, 2);
    assert.ok(!mg.names.some((n) => n.ticker === 'SNOW'));
    // NVDA is back in this browser's own list (re-graded after the remove) — the browser list wins
    assert.ok(mg.names.some((n) => n.ticker === 'NVDA'));
    assert.ok(mg.names.some((n) => n.ticker === 'ZZZQ'));
    assert.equal(mg.localOnly, 1);
    assert.equal(mg.names.length, 92 - 1 + 1);
  });

  test('tiers other than BLOCKBUSTER / STRONG are not on the list; share classes normalise', () => {
    assert.equal(usBenchName({ ticker: 'AAA', tier: 'MIXED' }), null);
    assert.equal(usBenchName({ ticker: 'BRK.B', tier: 'STRONG' })!.ticker, 'BRK-B');
    assert.equal(usBenchName({ ticker: '' }), null);
  });

  test('server-side rebuild from the graded-US session cache: newest filing wins, cold sessions skipped', async () => {
    const sessions = usBenchSessions('2026-09-24', 5);
    assert.deepEqual(sessions, ['2026-09-24', '2026-09-23', '2026-09-22', '2026-09-21', '2026-09-18']);
    const cache: Record<string, any> = {
      '2026-09-23': { by_tier: { BLOCKBUSTER: [{ ticker: 'FPS', filing_date: '2026-09-23' }], STRONG: [{ ticker: 'HPE', filing_date: '2026-09-23' }], MIXED: [{ ticker: 'XXX' }] } },
      '2026-09-18': { by_tier: { STRONG: [{ ticker: 'FPS', filing_date: '2026-06-10' }, { ticker: 'DELL', filing_date: '2026-09-18' }] } },
    };
    const r = await rebuildUsBench(sessions, async (d) => cache[d] || null, { concurrency: 2 });
    assert.equal(r.warm, 2); assert.equal(r.cold, 3);
    assert.deepEqual(r.entries.map((e) => e.ticker).sort(), ['DELL', 'FPS', 'HPE']);
    assert.equal(r.entries.find((e) => e.ticker === 'FPS').filing_date, '2026-09-23');
    assert.equal(r.entries.find((e) => e.ticker === 'FPS').tier, 'BLOCKBUSTER');
  });

  test('the header states count and source, and reconciles; an empty list says why in plain words', () => {
    const info = { total: 92, server: 92, local: 0, localOnly: 0, removed: 0, updatedAt: LIVE.updatedAt, serverSource: 'kv', serverNote: null, serverError: null };
    const line = usBenchLine(info, 90, 2);
    assert.match(line, /bench: 90 from Conviction Beats \(US\) — 92 on that list = 90 on the bench \+ 2 you hold/);
    assert.match(line, /source: server list 92 names updated 2026-09-24/);
    const empty = usBenchEmptyReason({ server: 0, local: 0, serverNote: null });
    assert.match(empty, /US Conviction Beats list is empty — open US Earnings Opportunities/);
    assert.match(usBenchLine({ ...info, total: 0, server: 0 }, 0, 0), /bench: 0 from Conviction Beats \(US\) — the list is empty/);
  });
});
