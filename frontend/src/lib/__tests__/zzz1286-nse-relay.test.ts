import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('zzz1286: NSE announcements try the mc-proxy relay before giving up on a refusal', () => {
  const src = fs.readFileSync(path.join(__dirname, '../nse-bse-feed.ts'), 'utf8');
  assert.ok(src.includes('async function nseAnnouncementsViaRelay(url: string)'));
  const i = src.indexOf('if (!res.ok) {'); const j = src.indexOf('nseAnnouncementsViaRelay(url)');
  assert.ok(i > 0 && j > i && j - i < 600, 'relay is tried inside the refusal branch');
});

test('zzz1286: the NSE funnel uses the relay only for filing / announcement paths', async () => {
  const { nseRelayEligible } = await import('../nse');
  assert.equal(nseRelayEligible('/api/corporates-announcements?index=equities&symbol=AZAD'), true);
  assert.equal(nseRelayEligible('/api/corporate-announcements?index=equities&from_date=01-11-2026'), true);
  assert.equal(nseRelayEligible('/api/corporates-financial-results?index=equities'), true);
  assert.equal(nseRelayEligible('/api/equity-stockIndices?index=NIFTY%2050'), false);
  assert.equal(nseRelayEligible('/api/quote-equity?symbol=AZAD'), false);
});
