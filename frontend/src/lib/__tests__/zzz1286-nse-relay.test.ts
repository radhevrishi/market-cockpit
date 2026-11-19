import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('zzz1286: NSE announcements try the mc-proxy relay before giving up on a refusal', () => {
  const src = fs.readFileSync(path.join(__dirname, '../nse-bse-feed.ts'), 'utf8');
  assert.ok(src.includes('async function nseAnnouncementsViaRelay(url: string)'));
  const i = src.indexOf('if (!res.ok) {'); const j = src.indexOf('nseAnnouncementsViaRelay(url)', i);
  assert.ok(i > 0 && j > i && j - i < 600, 'relay is tried inside the refusal branch');
});

test('zzz1286: the NSE funnel uses the relay only for filing / announcement paths', async () => {
  const { nseRelayEligible } = await import('../nse');
  assert.equal(nseRelayEligible('/api/corporate-announcements?index=equities&symbol=AZAD'), true);
  assert.equal(nseRelayEligible('/api/corporate-announcements?index=equities&from_date=01-11-2026'), true);
  assert.equal(nseRelayEligible('/api/corporates-financial-results?index=equities'), true);
  assert.equal(nseRelayEligible('/api/equity-stockIndices?index=NIFTY%2050'), false);
  assert.equal(nseRelayEligible('/api/quote-equity?symbol=AZAD'), false);
});

test('zzz1286: no caller uses the 404 path corporates-announcements (NSE serves corporate-announcements)', () => {
  const root = path.join(__dirname, '..', '..');
  const bad: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!/__tests__|node_modules|relay-probe/.test(p)) walk(p); } else if (/\.tsx?$/.test(f.name) && fs.readFileSync(p, 'utf8').includes('/api/corporates-announcements')) bad.push(p); } };
  walk(root);
  assert.deepEqual(bad, []);
});

test('zzz1287: NSE announcements are tried without a cookie first, then with one, then the relay', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'nse-bse-feed.ts'), 'utf8');
  const a = src.indexOf("await doFetch('')"), b = src.indexOf('await doFetch(await nseCookies())'), c = src.indexOf('nseAnnouncementsViaRelay(url)', b);
  assert.ok(a > 0 && b > a && c > b);
  const nse = fs.readFileSync(path.join(__dirname, '..', 'nse.ts'), 'utf8');
  assert.match(nse, /if \(nseRelayEligible\(path\)\) \{\s*const direct = await nseFilingDirect\(path\)/);
  assert.match(nse, /async function nseFilingDirect[\s\S]*headers: HEADERS, signal: AbortSignal\.timeout\(6_000\)/);
});

test('zzz1287: a BSE reply without a table is "could not check", not "nothing filed"', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'thesis', 'evidence-discovery.ts'), 'utf8');
  assert.match(src, /page === 1 && \(j == null \|\| typeof j !== 'object'\)\) return \{ items: \[\], code: sc\.code, error:/);
});
