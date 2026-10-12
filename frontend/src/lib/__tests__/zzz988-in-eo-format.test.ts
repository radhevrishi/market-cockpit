// zzz988 — the India Earnings Opportunities page must stay readable: no text smaller than 11px in its three
// presentation files (the owner: "text too small"). Chips/labels are at least 11px, prose 13px, and the card
// figure tiles keep their label/sub-line sizes at 11px or more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities');
const FILES = ['page.tsx', 'components.tsx', 'eo-style.tsx'];

test('no numeric fontSize below 11 in the India EO page files', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const bad: string[] = [];
    for (const m of src.matchAll(/fontSize:\s*['"]?(\d+(?:\.\d+)?)(px)?['"]?/g)) {
      if (Number(m[1]) < 11) bad.push(m[0]);
    }
    assert.deepEqual(bad, [], `${f} has font sizes under 11px: ${bad.join(', ')}`);
  }
});

test('figure-tile label and sub-line sizes are at least 11px', () => {
  const src = fs.readFileSync(path.join(DIR, 'eo-style.tsx'), 'utf8');
  const block = src.slice(src.indexOf('TILE_SCALE'), src.indexOf('TILE_FLEX'));
  const nums = [...block.matchAll(/\b(lab|sub):\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  assert.ok(nums.length >= 6, 'TILE_SCALE found');
  for (const n of nums) assert.ok(n >= 11, `tile label/sub ${n}px is under 11px`);
});

test('card prose (narrative, guidance line) is at least 13px', () => {
  const page = fs.readFileSync(path.join(DIR, 'page.tsx'), 'utf8');
  assert.match(page, /fontSize: 13[^}]*\}\}>\s*\{narrativeForDisplay\(stock\)\}/);
  const comp = fs.readFileSync(path.join(DIR, 'components.tsx'), 'utf8');
  assert.match(comp, /data-guide=\{gl\.direction\}\s*style=\{\{ fontSize: 13/);
});
