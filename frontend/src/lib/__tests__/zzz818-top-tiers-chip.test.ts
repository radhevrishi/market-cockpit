// zzz818 — the one-click "⭐+🟢 BLOCKBUSTER + STRONG" chip on the India and US
// Earnings Opportunities pages, and the US tier chips made into filters.
// Run: npx tsx --test src/lib/__tests__/zzz818-top-tiers-chip.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TOP_TIERS, isTopTiersSel, toggleTopTiers, topTiersCount, tierEmptyMessage,
  toggleTier, passesTier, parseTierParam, withTierParam, withWindowParams, countByTier,
} from '../india-earnings-window';
import { withSearchParam } from '../earnings-search';

type R = { ticker: string; tier: string; cap: number; elite: boolean };
const ROWS: R[] = [
  { ticker: 'A', tier: 'BLOCKBUSTER', cap: 5000, elite: true },
  { ticker: 'B', tier: 'BLOCKBUSTER', cap: 200, elite: false },
  { ticker: 'C', tier: 'STRONG', cap: 9000, elite: true },
  { ticker: 'D', tier: 'STRONG', cap: 100, elite: false },
  { ticker: 'E', tier: 'MIXED', cap: 7000, elite: true },
  { ticker: 'F', tier: 'AVOID', cap: 50, elite: false },
];

describe('the combined chip selects exactly both tiers', () => {
  test('one click = BLOCKBUSTER + STRONG, the same as multi-selecting both', () => {
    const viaChip = toggleTopTiers([]);
    const viaTwoClicks = toggleTier(toggleTier([], 'STRONG'), 'BLOCKBUSTER');
    assert.deepEqual(viaChip, ['BLOCKBUSTER', 'STRONG']);
    assert.deepEqual(viaChip, viaTwoClicks);
    assert.deepEqual([...TOP_TIERS], ['BLOCKBUSTER', 'STRONG']);
    assert.ok(isTopTiersSel(viaTwoClicks), 'picking both by hand lights the combined chip');
  });
  test('clicking it again clears; from any other selection it switches to exactly both', () => {
    assert.deepEqual(toggleTopTiers(['BLOCKBUSTER', 'STRONG']), []);
    assert.deepEqual(toggleTopTiers(['MIXED']), ['BLOCKBUSTER', 'STRONG']);
    assert.deepEqual(toggleTopTiers(['BLOCKBUSTER']), ['BLOCKBUSTER', 'STRONG']);
    assert.ok(!isTopTiersSel(['BLOCKBUSTER']));
    assert.ok(!isTopTiersSel(['BLOCKBUSTER', 'STRONG', 'MIXED']));
  });
  test('the selection shows only those two tiers', () => {
    const sel = toggleTopTiers([]);
    assert.deepEqual(ROWS.filter((r) => passesTier(r, sel)).map((r) => r.ticker), ['A', 'B', 'C', 'D']);
  });
});

describe('its count = the sum of the two tiers under the other filters', () => {
  test('no other filter', () => {
    const c = countByTier(ROWS);
    assert.equal(topTiersCount(c), 4);
  });
  test('with a cap filter and an ELITE filter, and it equals what clicking shows', () => {
    for (const other of [(r: R) => r.cap >= 1000, (r: R) => r.elite, (r: R) => r.cap >= 1000 && r.elite, () => false]) {
      const passing = ROWS.filter(other);
      const c = countByTier(passing);
      const shown = passing.filter((r) => passesTier(r, toggleTopTiers([])));
      assert.equal(topTiersCount(c), c.BLOCKBUSTER + c.STRONG);
      assert.equal(topTiersCount(c), shown.length);
    }
    assert.equal(topTiersCount(countByTier(ROWS.filter((r) => r.cap >= 1000))), 2);   // A, C
  });
});

describe('URL round-trip (both pages use the same helper)', () => {
  test('India: ?w= ?wv= ?q= survive; ?tier=BLOCKBUSTER,STRONG is written and read back', () => {
    const href = withTierParam(withWindowParams('/earnings-opportunities?q=kaynes', 60, 'date'), toggleTopTiers([]));
    assert.equal(href, '/earnings-opportunities?q=kaynes&w=60&tier=BLOCKBUSTER,STRONG');
    assert.ok(isTopTiersSel(parseTierParam(new URL(href, 'http://x').searchParams.get('tier'))));
  });
  test('US: ?q= survives the tier writer and the tier survives the search writer', () => {
    let href = withTierParam('/us-earnings-opportunities?q=nvda', ['STRONG', 'BLOCKBUSTER']);
    assert.equal(href, '/us-earnings-opportunities?q=nvda&tier=BLOCKBUSTER,STRONG');
    href = withSearchParam(href, 'ntsk');
    const sp = new URL(href, 'http://x').searchParams;
    assert.equal(sp.get('q'), 'ntsk');
    assert.deepEqual(parseTierParam(sp.get('tier')), ['BLOCKBUSTER', 'STRONG']);
    assert.equal(withTierParam(href, toggleTopTiers(['BLOCKBUSTER', 'STRONG'])), '/us-earnings-opportunities?q=ntsk');
  });
});

describe('the empty-state message', () => {
  test('says so plainly', () => {
    assert.equal(tierEmptyMessage(['BLOCKBUSTER', 'STRONG']), 'No BLOCKBUSTER or STRONG results in this window — widen the window or clear a filter');
    assert.equal(tierEmptyMessage(['MIXED']), 'No MIXED results in this window — widen the window or clear a filter');
    assert.equal(tierEmptyMessage(['BLOCKBUSTER', 'STRONG', 'AVOID']), 'No BLOCKBUSTER, STRONG or AVOID results in this window — widen the window or clear a filter');
    assert.match(tierEmptyMessage(['BLOCKBUSTER', 'STRONG'], 'date'), /^No BLOCKBUSTER or STRONG results on this date/);
  });
});

describe('page wiring (source checks)', () => {
  const dash = join(__dirname, '..', '..', 'app', '(dashboard)');
  const us = readFileSync(join(dash, 'us-earnings-opportunities', 'page.tsx'), 'utf8');
  const india = readFileSync(join(dash, 'earnings-opportunities', 'page.tsx'), 'utf8');
  const card = readFileSync(join(__dirname, '..', '..', 'components', 'us-earnings-card.tsx'), 'utf8');
  test('US: the tier chips are buttons that filter, with All, the combined chip and the URL', () => {
    assert.ok(us.includes('setTierSel((sel) => toggleTier(sel, t as WindowTier))'));
    assert.ok(us.includes('setTierSel((sel) => toggleTopTiers(sel))'));
    assert.ok(us.includes('onClick={() => setTierSel([])}'));
    assert.ok(us.includes('withTierParam(cur, tierSel)'));
    assert.ok(us.includes("parseTierParam(new URLSearchParams(window.location.search).get('tier'))"));
    assert.ok(!/<span key=\{t\} style=\{\{[^}]*\}\}>\{TIER_META\[t\]\.icon\} \{t\} \{counts\[t\]\}<\/span>/.test(us), 'the old static labels are gone');
  });
  test('US: counts follow the other filters; screen and exports follow the selection', () => {
    assert.ok(us.includes('BLOCKBUSTER: view.BLOCKBUSTER.length'));
    assert.ok(us.includes("out[t] = passesTier({ tier: t }, tierSel) ? view[t] : [];"));
    assert.equal((us.match(/US_TIER_ORDER\.flatMap\(\(t\) => shownView\[t\]\)/g) || []).length, 2, 'CSV + TradingView');
    assert.ok(us.includes('out[t] = rows.slice().sort(freshestFirst);'), 'freshest-first untouched');
    assert.ok(us.includes('resolveSearch'), 'search untouched');
    assert.ok(us.includes('tierEmptyMessage(tierSel'));
  });
  test('US cards carry a tier badge next to the name', () => {
    assert.ok(card.includes('{meta.icon} {meta.label}'));
  });
  test('India: the combined chip and the empty-state line are wired', () => {
    assert.ok(india.includes('setTierSel((sel) => toggleTopTiers(sel))'));
    assert.ok(india.includes('topTiersCount(tierChipCounts)'));
    assert.ok(india.includes("tierEmptyMessage(tierSel, 'window')"));
    assert.ok(india.includes("tierEmptyMessage(tierSel, 'date')"));
  });
  test('neither page gains a named export', () => {
    for (const p of [us, india]) assert.deepEqual(p.split('\n').filter((l) => /^export\s/.test(l) && !/^export default function/.test(l)), []);
  });
});
