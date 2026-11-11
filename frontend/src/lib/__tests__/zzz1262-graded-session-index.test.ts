// zzz1262 — one reader of the India graded sessions (portfolio grades, earnings search, BSE-code map).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  istBusinessDaysBack, compactGradedRows, quarterRank, flattenSessions, gradedSessions, lookupGraded, gradedIndex, clearGradedSessionMemo,
  type GradedReadDeps,
} from '../graded-session-index';
import { gradedKeyCandidates } from '../graded-cache-key';

const WED = Date.parse('2026-11-11T12:00:00Z');
const day = (rows: Array<[string, string, string]>) => ({ by_tier: { STRONG: rows.map(([ticker, quarter, bse]) => ({ ticker, company: `${ticker} Ltd`, quarter, composite_score: 70, bse_code: bse || undefined })) } });

function store(data: Record<string, any>, opts: { failFirst?: number; failAlways?: (keys: string[]) => boolean } = {}) {
  let calls = 0, failed = 0;
  const deps: GradedReadDeps = {
    now: () => WED,
    regrade: (p) => p,
    mget: async (keys) => {
      calls++;
      if (opts.failAlways?.(keys)) throw new Error('store down');
      if (opts.failFirst && failed < opts.failFirst) { failed++; throw new Error('timeout'); }
      return keys.map((k) => data[k] ?? null);
    },
  };
  return { deps, calls: () => calls };
}
const keyOf = (d: string) => gradedKeyCandidates(d)[0];

test('India business days: IST calendar, weekends skipped, newest first', () => {
  assert.deepEqual(istBusinessDaysBack(4, WED), ['2026-11-11', '2026-11-10', '2026-11-09', '2026-11-06']);
  // 20:00 UTC on a Sunday is already Monday in India
  assert.equal(istBusinessDaysBack(1, Date.parse('2026-11-08T20:00:00Z'))[0], '2026-11-09');
});

test('compact rows and quarter order', () => {
  const rows = compactGradedRows({ by_tier: { BLOCKBUSTER: [{ ticker: 'kross', quarter: 'Q2 FY27', scrip_code: 544253 }], AVOID: [{ company: 'no ticker' }] } }, '2026-11-10');
  assert.equal(rows.length, 1);
  assert.deepEqual({ t: rows[0].t, tier: rows[0].tier, fd: rows[0].fd, bse: rows[0].bse }, { t: 'KROSS', tier: 'BLOCKBUSTER', fd: '2026-11-10', bse: '544253' });
  assert.ok(quarterRank('Q2 FY27') > quarterRank('Q1 FY27') && quarterRank('Q1 FY27') > quarterRank('Q4 FY26'));
  assert.equal(quarterRank('nonsense'), 0);
});

test('newest session wins for a ticker + quarter; lookups are narrowed to the asked tickers', async () => {
  clearGradedSessionMemo();
  const s = store({
    [keyOf('2026-11-11')]: day([['KROSS', 'Q2 FY27', '']]),
    [keyOf('2026-11-10')]: day([['KROSS', 'Q2 FY27', ''], ['OTHER', 'Q2 FY27', '']]),
    [keyOf('2026-08-12')]: day([['KROSS', 'Q1 FY27', '']]),
  });
  const { entries, unread } = await lookupGraded(['kross'], s.deps);
  assert.deepEqual(unread, []);
  assert.deepEqual(entries.map((e) => `${e.t}@${e.q}@${e.db}`), ['KROSS@Q2 FY27@0', 'KROSS@Q1 FY27@65']);
});

test('a second call is answered from memory; a failed batch is retried once, then reported and NOT remembered as empty', async () => {
  clearGradedSessionMemo();
  const dates = istBusinessDaysBack(12, WED);
  const data = { [keyOf(dates[0])]: day([['AAA', 'Q2 FY27', '']]), [keyOf(dates[7])]: day([['BBB', 'Q2 FY27', '']]) };
  const ok = store(data, { failFirst: 1 });
  const a = await gradedSessions(dates, ok.deps);
  assert.deepEqual(a.unread, []);
  assert.equal(ok.calls(), 3, 'two batches of 6, the first tried twice');
  await gradedSessions(dates, ok.deps);
  assert.equal(ok.calls(), 3, 'second call reads nothing');

  clearGradedSessionMemo();
  let down = true;
  const bad = store(data, { failAlways: (keys) => down && keys.includes(keyOf(dates[7])) });
  const b = await gradedSessions(dates, bad.deps);
  assert.deepEqual(b.unread, dates.slice(6), 'the batch that could not be read is reported');
  assert.equal(b.sessions.find((x) => x.d === dates[0])?.rows[0].t, 'AAA');
  down = false;
  const c = await gradedSessions(dates, bad.deps);
  assert.deepEqual(c.unread, []);
  assert.equal(c.sessions.find((x) => x.d === dates[7])?.rows[0].t, 'BBB', 'read on the next call — never cached as "nothing graded"');
});

test('two callers at the same moment share one read', async () => {
  clearGradedSessionMemo();
  const dates = istBusinessDaysBack(6, WED);
  const s = store({ [keyOf(dates[0])]: day([['AAA', 'Q2 FY27', '']]) });
  const [a, b] = await Promise.all([gradedSessions(dates, s.deps), gradedSessions(dates, s.deps)]);
  assert.equal(s.calls(), 1);
  assert.equal(a.sessions[0].rows[0].t, 'AAA'); assert.equal(b.sessions[0].rows[0].t, 'AAA');
});

test('the whole index carries BSE codes and is not kept when a session was unread', async () => {
  clearGradedSessionMemo();
  const s = store({ [keyOf('2026-11-10')]: day([['ZZALPHA', 'Q2 FY27', '999001']]) });
  const g = await gradedIndex(s.deps);
  assert.equal(g.cache, 'built');
  assert.equal(g.index[0].bse, '999001');
  assert.equal((await gradedIndex(s.deps)).cache, 'memo');
  assert.deepEqual(flattenSessions([{ d: 'x', rows: [] }], ['2026-11-11']), []);
});

test('no route reads or writes the old 15-minute whole-index copy', () => {
  for (const f of ['../../app/api/v1/portfolio/earnings-grades/route.ts', '../../app/api/v1/earnings/search/route.ts', '../../app/api/v1/book/bse-map/route.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /kv(Get|Set)[^\n]*search:idx|INDEX_KEY/, f);
  }
  assert.match(readFileSync(new URL('../../app/(dashboard)/watchlists/PortfolioEarningsTab.tsx', import.meta.url), 'utf8'), /earnings-grades\?tickers=\$\{csv\}&scan=0/);
});
