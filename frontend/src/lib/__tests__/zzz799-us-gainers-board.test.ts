// zzz799 — US AI Daily Gainers: research is tied to the scan it was built
// from. The live page showed a 66-name board (16:54 ET scan) under a MARKET
// SUMMARY of "57 GAINERS SCANNED" with the 15:55 ET cards: the research store
// is keyed by date only and the page preferred the server's view built from
// the older board. Now the board hash travels with the research; a newer
// board gets a free SEC pass; dropped names are listed; a sweep always ends
// with a reason; the page names the US session in New York time. India is
// unchanged. Run: npx tsx --test src/lib/__tests__/zzz799-us-gainers-board.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardHash, droppedFromBoard, serverViewMatchesBoard, needsBoardSync, usSessionPhrase, sweepStopReason, ymdIn } from '../ai-gainers/us-board-sync';

const OLD57 = Array.from({ length: 57 }, (_, i) => `T${i}`);
const NEW66 = [...OLD57.slice(5), ...Array.from({ length: 14 }, (_, i) => `N${i}`)];   // 5 fell off, 14 new

describe('the board identity', () => {
  test('same names in any order → same hash; the count is in it', () => {
    assert.equal(boardHash(['b', 'A', 'a']), boardHash(['A', 'B']));
    assert.match(boardHash(NEW66), /^66-[0-9a-f]{8}$/);
    assert.notEqual(boardHash(OLD57), boardHash(NEW66));
  });
  test('the server view is used only for the same board', () => {
    assert.equal(serverViewMatchesBoard(boardHash(OLD57), boardHash(NEW66)), false);
    assert.equal(serverViewMatchesBoard(boardHash(NEW66), boardHash([...NEW66].reverse())), true);
    assert.equal(serverViewMatchesBoard(null, boardHash(NEW66)), false, 'research stored before this fix → rebuilt from the board on screen');
  });
  test('a newer scan → the free SEC pass; same board with nothing missing → none', () => {
    assert.equal(needsBoardSync({ serverHash: boardHash(OLD57), currentHash: boardHash(NEW66), missing: 14, boardSize: 66 }), true);
    assert.equal(needsBoardSync({ serverHash: boardHash(NEW66), currentHash: boardHash(NEW66), missing: 0, boardSize: 66 }), false);
    assert.equal(needsBoardSync({ serverHash: boardHash(NEW66), currentHash: boardHash(NEW66), missing: 2, boardSize: 66 }), true);
  });
  test('names that fell off are kept as "no longer in today’s list"; a name back on the board leaves it', () => {
    const d = droppedFromBoard(OLD57.map((t) => ({ ticker: t, company: `${t} Inc` })), NEW66);
    assert.deepEqual(d.map((x) => x.ticker), ['T0', 'T1', 'T2', 'T3', 'T4']);
    const d2 = droppedFromBoard(NEW66.map((t) => ({ ticker: t })), [...NEW66, 'T0'], d);
    assert.deepEqual(d2.map((x) => x.ticker), ['T1', 'T2', 'T3', 'T4']);
  });
});

describe('which US session, in plain words', () => {
  // 02:24 IST Friday 25 Sep 2026 = 16:54 ET Thursday 24 Sep.
  const at = new Date('2026-09-24T20:54:00Z');
  test('the clocks', () => { assert.equal(ymdIn('Asia/Kolkata', at), '2026-09-25'); assert.equal(ymdIn('America/New_York', at), '2026-09-24'); });
  test('"US session Thu 24 Sep (New York time)", and it says India is already on Friday', () => {
    const s = usSessionPhrase('2026-09-24', at)!;
    assert.match(s, /^US session Thu 24 Sep \(New York time\)/);
    assert.match(s, /already Fri 25 Sep in India, but this is still today's US session/);
  });
  test('same calendar day in both places → just the session', () => {
    assert.equal(usSessionPhrase('2026-09-24', new Date('2026-09-24T15:00:00Z')), 'US session Thu 24 Sep (New York time)');
  });
});

describe('a sweep never sticks on "running…"', () => {
  const base = { calls: 3, maxCalls: 40, stalledCalls: 0, retrying: 0, elapsedMs: 60_000, maxMs: 15 * 60_000, remaining: 20 };
  test('progressing → keep going; finished → no reason', () => {
    assert.equal(sweepStopReason(base), null);
    assert.equal(sweepStopReason({ ...base, remaining: 0, stalledCalls: 9 }), null);
  });
  test('three rounds with nothing new → stop with the reason', () => assert.match(sweepStopReason({ ...base, stalledCalls: 3 })!, /researched nothing new \(20 left\)/));
  test('names retrying after a timeout → not a stall', () => assert.equal(sweepStopReason({ ...base, stalledCalls: 3, retrying: 2 }), null));
  test('time limit / round limit → stop with the reason', () => {
    assert.match(sweepStopReason({ ...base, elapsedMs: 15 * 60_000 })!, /stopped after 15 minutes with 20 names/);
    assert.match(sweepStopReason({ ...base, calls: 40 })!, /stopped after 40 rounds/);
  });
});

describe('wired in the route and the page, US only', () => {
  const route = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'ai-gainers', 'research', 'route.ts'), 'utf8');
  const page = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'ai-gainers', 'page.tsx'), 'utf8');
  test('the route records the board and answers without an older board’s view', () => {
    assert.match(route, /st\.board_hash = boardHash\(sent\)/);
    assert.match(route, /const wantBoard = market === 'US' \? searchParams\.get\('board'\) : null/);
    assert.match(route, /boardMatch === false \? null : await viewFor/);
    assert.match(route, /const noModel = market === 'US' && body\?\.no_model === true/);
    assert.match(route, /market === 'US' && st\.board_rows\?\.length \? st\.board_rows/);
  });
  test('India paths unchanged: board recording only inside the US branch', () => {
    const i = route.indexOf("if (market === 'US' && rows.length) {");
    const j = route.indexOf('st.board_hash = boardHash(sent)');
    assert.ok(i > 0 && j > i && j - i < 600);
  });
  test('the page: server view only for the same board; free SEC pass; session phrase', () => {
    assert.match(page, /serverViewMatchesBoard\(research\?\.board_hash, boardH\)/);
    assert.match(page, /const serverViewOk = market !== 'US' \|\|/);
    assert.match(page, /await sweep\(m, j\.scanned \|\| \[\], gen, false, false, true\)/);
    assert.match(page, /usSessionPhrase\(/);
    assert.match(page, /data-testid="us-dropped"/);
  });
});
