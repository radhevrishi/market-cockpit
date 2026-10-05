import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingReasonWord, pendingReasonMap } from '../eo-pending-reason';
test('zzz879 — a short reason per pending name', () => {
  assert.equal(pendingReasonWord('scheduled (Upcoming) — no filing confirmed and no fresh quarter on Screener').word, 'board meeting only — results not out yet');
  assert.equal(pendingReasonWord("Screener's latest quarter 2026-03-31 is 180d before the filing (new quarter not on Screener yet)").word, 'filed — waiting for the numbers');
  assert.equal(pendingReasonWord('no financials and no hub confirmation').word, 'no results filing seen yet');
  assert.equal(pendingReasonWord('period x vs Screener quarter y (quarter-mismatch guard)').word, 'dates do not match — not graded');
  assert.equal(pendingReasonWord(null).word, 'results not out yet');
  assert.equal(pendingReasonWord('anything', true).word, "numbers didn't load — retrying");
  const m = pendingReasonMap({ _dropped: [{ ticker: 'ansalapi', reason: "Screener's latest quarter 2026-03-31 is 190d before the filing (new quarter not on Screener yet)" }], _failed_tickers: ['X'] });
  assert.equal(m.get('ANSALAPI')!.word, 'filed — waiting for the numbers'); assert.equal(m.get('X')!.word, "numbers didn't load — retrying");
});
