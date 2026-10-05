import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasForwardNumber } from '../ai-guidance-extract';

test('screen passes real guidance language', () => {
  assert.ok(hasForwardNumber('We expect revenue growth of 25% in FY27 driven by new capacity.'));
  assert.ok(hasForwardNumber('Management reiterated a revenue guidance of about INR 5,000 crore for the year.'));
  assert.ok(hasForwardNumber('The company targets an EBITDA margin of 18% by FY28.'));
});
test('screen removes notices and plain tables (free, no AI)', () => {
  assert.equal(hasForwardNumber('Intimation of board meeting to be held on 12th November 2026 to consider unaudited results.'), false);
  assert.equal(hasForwardNumber('Registered office: Mumbai. Scrutinizer appointed for e-voting. Cut-off date for AGM is 20 September.'), false);
  assert.equal(hasForwardNumber(''), false);
});
