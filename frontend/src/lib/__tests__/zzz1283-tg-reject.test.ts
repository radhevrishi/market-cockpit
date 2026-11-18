import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tgRejectState } from '../transformational/marks';

test('zzz1283: rejected company hidden until a newer event; page uses the shared mark', () => {
  assert.equal(tgRejectState(null, null, '2026-11-18'), null);
  assert.equal(tgRejectState('WATCH', '2026-11-10T10:00:00Z', '2026-11-18'), null);
  assert.equal(tgRejectState('REJECTED', '2026-11-18T21:00:00Z', '2026-11-18'), 'hidden');
  assert.equal(tgRejectState('REJECTED', '2026-11-18T21:00:00Z', '2026-11-12'), 'hidden');
  assert.equal(tgRejectState('REJECTED', '2026-11-12T09:00:00Z', '2026-11-18'), 'resurfaced');
  const src = fs.readFileSync(path.join(__dirname, '../../app/(dashboard)/transformational-gainers/page.tsx'), 'utf8');
  assert.ok(src.includes("setCbMark(g.ticker, g.market, on ? 'rejected' : null"));
  assert.ok(src.includes('Show rejected (')); assert.ok(src.includes('👁 Watchlist only ('));
  assert.ok(src.includes("groupsSorted.filter((g) => rejOf(g).state !== 'hidden')"));
});
