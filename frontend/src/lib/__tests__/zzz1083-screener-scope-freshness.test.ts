// zzz1083–1087 — retest improvements: Stock Screener company list (AND with rules), Pine warnings scoped, three freshness facts +
// next rebuild with its day, screen families, Price-first / collapse-all panes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { universeOptions, universeSet, applyUniverse, universeLine } from '../screener/universe-scope';
import { scopedNotes } from '../screener/scope-notes';
import { quarterEnd, nextResultDue, freshnessFacts, figuresOverdue } from '../screener/freshness';
import { whenText } from '../screener/rebuild-schedule';
import { pickerGroups, stockFamilyOf, STOCK_FAMILIES } from '../screener/screen-picker';
import { BUILT_IN_SCREENS } from '../screener/filters';
import { setPanesCollapsed, fitPaneHeights, paneMinFrac } from '../chart-readability';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const src = {
  chartLists: [{ id: 'a', name: 'Swing', sections: [{ items: [{ m: 'IN' as const, t: 'HAL', flag: 'red' }, { m: 'US' as const, t: 'HAL' }, { m: 'IN' as const, t: 'TATVA' }] }] }],
  standalone: ['NSE:KPIL', 'US:NVDA', 'MTARTECH'],
  portfolio: ['HAL', 'NOPE'],
  cb: ['TATVA'],
};
const rows = [{ t: 'HAL' }, { t: 'TATVA' }, { t: 'KPIL' }, { t: 'MTARTECH' }, { t: 'INFY' }];

test('1083: the list is applied by market; rules run after it (AND)', () => {
  assert.equal(universeSet('all', 'IN', src).set, null);
  const pf = applyUniverse(rows, universeSet('pf', 'IN', src));
  assert.deepEqual(pf.rows.map((r) => r.t), ['HAL']);
  assert.deepEqual(pf.missing, ['NOPE'], 'a list company without data is reported, not dropped silently');
  // chart list: India items only when India is open (NYSE:HAL is not NSE:HAL)
  assert.deepEqual([...universeSet('wl:a', 'IN', src).set!].sort(), ['HAL', 'TATVA']);
  assert.deepEqual([...universeSet('wl:a', 'US', src).set!], ['HAL']);
  assert.deepEqual([...universeSet('flagged', 'IN', src).set!], ['HAL']);
  // Watchlists page list: prefixes decide; a bare symbol is matched here and reported as "market not written"
  const w = universeSet('watch', 'IN', src);
  assert.deepEqual([...w.set!].sort(), ['KPIL', 'MTARTECH']);
  assert.deepEqual(w.bare, ['MTARTECH']);
  const s = applyUniverse(rows, w);
  assert.match(universeLine(w, s, 'IN'), /Market not written.*MTARTECH/);
  assert.match(universeLine(w, s, 'IN'), /rules below must ALSO pass/);
  assert.equal(universeSet('cb', 'US', src).set!.size, 0, 'Conviction Beats is India only');
  assert.ok(!universeOptions('US', src).some((o) => o.id === 'cb'));
  assert.equal(universeSet('pf', 'IN', { ...src, portfolio: null }).waiting, true);
});

test('1083: the page runs the screen on the scoped rows and shows the list', () => {
  const p = read('components/stock-screener/StockScreener.tsx');
  assert.match(p, /runScreen\(scopedRows, filters/);
  assert.match(p, /filterCounts\(scopedRows, filters/);
  assert.match(p, /aria-label="Companies to screen"/);
  assert.match(p, /data-universe-line/);
});

test('1084: a universe-wide warning is rewritten for the list in use', () => {
  const note = 'Across the full USA universe (4383 companies): 91 companies show a latest quote more than 2% from the close the patterns were read from (different price sources) — x';
  const r = [{ t: 'NKE' }, { t: 'AAPL', pxConflict: 1 }];
  assert.equal(scopedNotes([note], r, null, '', 'US')[0], note, 'all companies: unchanged');
  const one = scopedNotes([note], r, new Set(['NKE']), 'From the Stock Screener: x', 'US')[0];
  assert.match(one, /^In From the Stock Screener: x: none of the 1 company has a price-source gap\. \(Across the full USA universe: 91 of 4383\.\)$/);
  assert.match(scopedNotes([note], r, new Set(['AAPL', 'NKE']), 'L', 'US')[0], /1 of 2 companies show/);
  assert.match(read('app/api/v1/pine-screener/route.ts'), /Across the full \$\{market === 'IN' \? 'India' : 'USA'\} universe/);
});

test('1085: three freshness facts; "behind" needs evidence; next rebuild names the day', () => {
  assert.equal(quarterEnd('Q2 2026'), '2026-06-30');
  assert.equal(quarterEnd('Jun 2026'), '2026-06-30');
  assert.equal(quarterEnd('Mar 2026'), '2026-03-31');
  assert.equal(nextResultDue('2026-06-30', 'IN'), '2026-11-14');
  assert.equal(nextResultDue('2025-12-31', 'IN'), '2026-05-30', 'March year-end quarter: 60 days');
  const now = new Date('2026-10-18T09:00:00Z');
  const cur = freshnessFacts({ q: 'Jun 2026', pxAt: '2026-10-16' }, 'IN', '2026-10-18T07:00:00Z', now);
  assert.deepEqual(cur.map((f) => f.label), ['Price', 'Figures', 'Snapshot']);
  assert.equal(cur[0].text, '16 Oct close');
  assert.equal(cur[1].tone, 'ok');
  const old = freshnessFacts({ q: 'Mar 2026', pxAt: '2026-10-16' }, 'IN', null, now);
  assert.equal(old[1].tone, 'warn');
  assert.match(old[1].title, /Not checked against the latest filings/);
  const newer = freshnessFacts({ q: 'Mar 2026', pxAt: '2026-10-16' }, 'IN', null, now, { d: '2026-08-10', q: 'Q1 FY27', src: 'EO' }, true);
  assert.equal(newer[1].tone, 'bad');
  assert.match(newer[1].text, /newer result filed 10 Aug/);
  assert.equal(figuresOverdue('Jun 2026', 'IN', now), '');
  assert.equal(figuresOverdue('Mar 2026', 'IN', now), '2026-08-14');
  const sun = new Date(2026, 9, 18, 12, 0), mon = new Date(2026, 9, 19, 16, 45);
  assert.match(whenText(mon, sun), /^Mon 19 Oct, 16:45$/);
  assert.equal(whenText(new Date(2026, 9, 18, 16, 45), sun), '16:45');
  assert.match(read('components/stock-screener/StockScreener.tsx'), /Next rebuild ~\{whenText\(nextBuild\)\}/);
});

test('1086: built-in screens listed by family for the open market; every screen in exactly one group', () => {
  const built = new Set(BUILT_IN_SCREENS.map((s) => s.id));
  for (const m of ['US', 'IN'] as const) {
    const g = pickerGroups(BUILT_IN_SCREENS, built, [], '', [], m);
    const ids = g.flatMap((x) => x.screens.map((s) => s.id));
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(ids.length, BUILT_IN_SCREENS.filter((s) => s.market === m).length);
    assert.ok(g.every((x) => x.id.startsWith('fam:')));
  }
  assert.equal(stockFamilyOf({ id: 'us-minervini', name: '' }), 'leaders');
  assert.equal(stockFamilyOf({ id: 'in-volume-accumulation', name: '' }), 'volume');
  assert.equal(stockFamilyOf({ id: 'x', name: 'My breakout list' }), 'momentum');
  assert.equal(STOCK_FAMILIES.length, 7);
});

test('1087: Price first keeps ≥ 70% for price; collapse all / expand all per layout', () => {
  const panes = [{ id: 'a', want: 200 }, { id: 'b', want: 200 }];
  const normal = fitPaneHeights(800, panes, { axis: 0 });
  const pf = fitPaneHeights(800, panes, { axis: 0, minFrac: paneMinFrac('price') });
  assert.ok(800 - (pf.a + pf.b) >= 560);
  assert.ok(pf.a < normal.a);
  const s = setPanesCollapsed({}, 'L1', ['a', 'b'], true);
  assert.deepEqual(s, { L1: ['a', 'b'] });
  assert.deepEqual(setPanesCollapsed(s, 'L1', ['a', 'b'], false), {});
  assert.match(read('components/charts/ChartWorkspace.tsx'), /data-testid="price-first"/);
});
