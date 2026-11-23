import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_MERGES, mergedTarget, currentAddress } from '../page-merges';

const APP = join(__dirname, '..', '..', 'app', '(dashboard)');

test('old addresses forward to the workspace tab and keep their own values', () => {
  assert.equal(mergedTarget('/valuation-calc'), '/valuation?view=calc');
  assert.equal(mergedTarget('/valuation-calc', '?tab=learn'), '/valuation?view=calc&tab=learn');
  assert.equal(mergedTarget('/bottleneck-workbench', 'theme=hbm'), '/bottlenecks?view=deepdive&theme=hbm');
  assert.equal(mergedTarget('/pead-tracker', 'tab=x'), '/earnings-hub?tab=pead');
  assert.equal(mergedTarget('/movers/'), '/market-snapshot?tab=movers');
  assert.equal(mergedTarget('/valuation'), null);
  assert.equal(currentAddress('/thesis#top'), '/journal?view=thesis#top');
  assert.equal(currentAddress('https://x.y/alerts'), 'https://x.y/alerts');
});

test('every merged page still exists (the workspace loads it) and its workspace offers that tab', () => {
  for (const [old, to] of Object.entries(PAGE_MERGES)) {
    assert.ok(existsSync(join(APP, old.slice(1), 'page.tsx')), `${old} page file kept`);
    const [host, q] = to.split('?');
    const id = new URLSearchParams(q).get('view') ?? new URLSearchParams(q).get('tab');
    const src = readFileSync(join(APP, host.slice(1), 'page.tsx'), 'utf8');
    assert.ok(src.includes(`'../${old.slice(1)}/page'`), `${host} loads ${old}`);
    assert.ok(src.includes(`id: '${id}'`) || src.includes(`'${id}'`), `${host} has tab ${id}`);
  }
});

test('no workspace forwards to itself or to another merged address (no loops)', () => {
  for (const to of Object.values(PAGE_MERGES)) assert.equal(PAGE_MERGES[to.split('?')[0]], undefined, to);
});

test('the proxy forwards merged pages before the login gate', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'proxy.ts'), 'utf8');
  assert.ok(src.indexOf('mergedTarget(') > 0 && src.indexOf('mergedTarget(') < src.indexOf('PUBLIC_PAGE_PATHS.includes'));
});
