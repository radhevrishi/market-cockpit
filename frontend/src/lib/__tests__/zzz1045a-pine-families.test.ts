// zzz1045a — Pine Screener organisation: the 65 built-in screens grouped into families (every one in exactly one), favourites first,
// search; the "pattern timeframe vs rule timeframe" note (rules stay daily unless the figure says weekly / monthly); the filter panel
// order Companies → Screen → Direction → Timeframe → Stage; and the stable screen IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import {
  PINE_FAMILIES, PINE_FAV_KEY, pineFamilyOf, pineFamilyGroups, matchesPineScreen, togglePineFav, readPineFavs, writePineFavs,
  ruleTf, ruleKeyTf, ruleTimeframeNote, ruleTimeframeSummary, type PineFamilyId,
} from '../screener/pine-families';
import { querySummary } from '../screener/pine-view';
import { DEFAULT_QUERY, type PineQuery, type PineScreen } from '../screener/pine';
import type { Filter } from '../screener/filters';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const Q = (o: Partial<PineQuery> = {}): PineQuery => ({ ...DEFAULT_QUERY, ...o, dist: { ...DEFAULT_QUERY.dist, ...(o.dist || {}) } });
const BUILT = new Set(BUILT_IN_PINE_SCREENS.map((s) => s.id));

const IDS = ['all-bullish', 'all-bearish', 'oneil-bases', 'minervini-vcp', 'breakouts-today', 'flags-pennants', 'triangles-wedges', 'bottoms', 'bearish-tops',
  'breakdowns', 'bear-continuation', 'broad-candidates', 'near-ready', 'bases-forming', 'weekly-bases', 'monthly-bases', 'monthly-reversal-bases',
  'monthly-near-pivot', 'breakouts-holding', 'breakouts-back-below', 'mtf-aligned', 'wl-forming-bases', 'failed-breakouts', 'pf-bearish-risks',
  'pf-bullish-opps', 'pf-failed-bearish', 'tv-trend-template', 'tv-rule-of-40', 'tv-rsi-cross', 'tv-rsi-50', 'tv-golden-cross', 'tv-death-cross',
  'tw-stage2-sata6', 'tw-fresh-stage2', 'tw-stage4-sata3', 'tw-stage1-bases', 'tv-ema-cross-up', 'rs-80', 'stage-2', 'stage-1-2', 'pocket-pivot',
  'ripster-bull', 'high-rvol', 'tt-bullish-base', 'r40-bullish', 'r40-ready', 'r40-weekly-bases', 'rs80-stage2-forming', 'ts-3wt-stage2',
  'ts-darvas-breakout', 'ts-donchian-20', 'ts-donchian-55', 'ts-squeeze-on', 'ts-squeeze-fired-up', 'ts-episodic-pivot', 'ts-gap-volume', 'ts-burst-tt',
  'ts-wedge-pop', 'ts-ema-crossback', 'ts-new-high-rs80', 'ts-canslim-5', 'ts-accumulation-rs80', 'ts-holy-grail', 'ts-spring', 'ts-extended',
  // zzz1046a — volume & accumulation (added at the end; earlier ids unchanged)
  'acc-ab', 'acc-base', 'acc-vbo', 'acc-stealth', 'acc-quiet', 'dist-warn', 'dlv-rising',
  // zzz1047 — Stage 2 health (added at the end)
  'tw-stage2-healthy', 'tw-stage2-weak'];

test('zzz1045a the 65 built-in screen IDs are unchanged (same IDs, same order, none removed or renamed)', () => {
  assert.equal(BUILT_IN_PINE_SCREENS.length, 74);   // zzz1047: + 2 Stage 2 health screens   // zzz1046a: + 7 volume & accumulation screens
  assert.deepEqual(BUILT_IN_PINE_SCREENS.map((s) => s.id), IDS);
});

test('zzz1045a every built-in screen belongs to exactly one family, as the brief lists them', () => {
  const groups = pineFamilyGroups(BUILT_IN_PINE_SCREENS, BUILT, []);
  const seen = new Map<string, number>();
  for (const g of groups) for (const s of g.screens) seen.set(s.id, (seen.get(s.id) || 0) + 1);
  for (const id of IDS) assert.equal(seen.get(id), 1, `${id} listed once`);
  assert.equal(groups.reduce((n, g) => n + g.screens.length, 0), 74);
  assert.deepEqual(groups.map((g) => g.id), ['discovery', 'bases', 'breakouts', 'portfolio', 'trend', 'r40', 'setups', 'volume']);
  const fam = (id: string) => pineFamilyOf(BUILT_IN_PINE_SCREENS.find((s) => s.id === id)!);
  const expect: Record<PineFamilyId, string[]> = {
    discovery: ['all-bullish', 'all-bearish', 'broad-candidates', 'near-ready', 'oneil-bases', 'minervini-vcp', 'flags-pennants', 'triangles-wedges', 'bottoms', 'bearish-tops', 'bear-continuation'],
    bases: ['bases-forming', 'weekly-bases', 'monthly-bases', 'monthly-reversal-bases', 'monthly-near-pivot', 'mtf-aligned', 'wl-forming-bases'],
    breakouts: ['breakouts-today', 'breakouts-holding', 'breakouts-back-below', 'failed-breakouts', 'breakdowns'],
    portfolio: ['pf-bearish-risks', 'pf-bullish-opps', 'pf-failed-bearish'],
    trend: ['tv-trend-template', 'rs-80', 'stage-2', 'stage-1-2', 'tt-bullish-base', 'rs80-stage2-forming', 'tw-stage2-sata6', 'tw-fresh-stage2', 'tw-stage4-sata3',
      'tw-stage1-bases', 'tv-golden-cross', 'tv-death-cross', 'tv-rsi-cross', 'tv-rsi-50', 'tv-ema-cross-up', 'pocket-pivot', 'ripster-bull', 'high-rvol', 'tw-stage2-healthy', 'tw-stage2-weak'],
    r40: ['tv-rule-of-40', 'r40-bullish', 'r40-ready', 'r40-weekly-bases'],
    setups: IDS.filter((x) => x.startsWith('ts-')),
    volume: ['acc-ab', 'acc-base', 'acc-vbo', 'acc-stealth', 'acc-quiet', 'dist-warn', 'dlv-rising'],   // zzz1046a
  };
  for (const [f, ids] of Object.entries(expect)) for (const id of ids) assert.equal(fam(id), f, `${id} → ${f}`);
  assert.equal(Object.values(expect).flat().length, 74);
  assert.equal(PINE_FAMILIES.length, 8);
  for (const f of PINE_FAMILIES) assert.doesNotMatch(`${f.label} ${f.hint}`, /\bbest\b|\bbuy\b|\bsell\b/i, 'plain wording, no buy / sell');
});

test('zzz1045a favourites come first (built-in and made here) and are not repeated in their family', () => {
  const mine: PineScreen = { id: 'my-1', name: 'My cup screen', q: Q() };
  const all = [...BUILT_IN_PINE_SCREENS, mine];
  const g = pineFamilyGroups(all, BUILT, ['ts-spring', 'my-1', 'rs-80']);
  assert.equal(g[0].id, 'fav');
  assert.deepEqual(g[0].screens.map((s) => s.id), ['rs-80', 'ts-spring', 'my-1'], 'favourites in list order');
  assert.ok(!g.find((x) => x.id === 'trend')!.screens.some((s) => s.id === 'rs-80'));
  assert.ok(!g.some((x) => x.id === 'mine'), 'the only screen made here is a favourite');
  const g2 = pineFamilyGroups(all, BUILT, []);
  assert.deepEqual(g2.at(-1)!.screens.map((s) => s.id), ['my-1']);
  assert.equal(g2.at(-1)!.label, 'Made here');
  assert.deepEqual(togglePineFav(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(togglePineFav(['a', 'b'], 'a'), ['b']);
});

test('zzz1045a search: every word in the name or the family name', () => {
  const ids = (q: string) => pineFamilyGroups(BUILT_IN_PINE_SCREENS, BUILT, [], q).flatMap((g) => g.screens.map((s) => s.id));
  assert.deepEqual(ids('donchian'), ['ts-donchian-20', 'ts-donchian-55']);
  assert.deepEqual(ids('portfolio'), ['pf-bearish-risks', 'pf-bullish-opps', 'pf-failed-bearish']);
  assert.ok(ids('base builder').length === 7, 'family name matches');
  assert.deepEqual(ids('monthly near'), ['monthly-near-pivot']);
  assert.deepEqual(ids('zzzz-nothing'), []);
  assert.ok(matchesPineScreen({ id: 'x', name: 'Whatever' }, '', false));
  assert.ok(matchesPineScreen({ id: 'x', name: 'Whatever' }, 'made here', false));
});

test('zzz1045a favourites storage is guarded (no localStorage / bad JSON → empty)', () => {
  const g = globalThis as any; const old = g.localStorage;
  try {
    delete g.localStorage;
    assert.deepEqual(readPineFavs(), []);
    writePineFavs(['x']);   // does not throw
    const store = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    writePineFavs(['rs-80', 'ts-spring']);
    assert.equal(store.get(PINE_FAV_KEY), '["rs-80","ts-spring"]');
    assert.deepEqual(readPineFavs(), ['rs-80', 'ts-spring']);
    store.set(PINE_FAV_KEY, '{bad');
    assert.deepEqual(readPineFavs(), []);
    assert.equal(PINE_FAV_KEY, 'mc:pine-fav-screens:v1');
  } finally { if (old === undefined) delete g.localStorage; else g.localStorage = old; }
});

test('zzz1045a rule timeframes from the field metadata: weekly / monthly keys, daily price figures, company figures', () => {
  for (const k of ['rsiW', 'wt3', 'dc20W', 'twSt', 'sata', 'mrs', 'stage']) assert.equal(ruleKeyTf(k), 'W', k);
  assert.equal(ruleKeyTf('rsiM'), 'M');
  for (const k of ['rsi', 'sma50', 'dc20D', 'rsR', 'ttOk', 'rvol']) assert.equal(ruleKeyTf(k), 'D', k);
  assert.equal(ruleKeyTf('roeTTM'), 'company');
  const cmp: Filter = { kind: 'cmp', key: 'px', op: 'above', other: 'sma200' };
  assert.equal(ruleTf(cmp), 'D');
  assert.equal(ruleTf({ kind: 'sector', sectors: [] }), null);
});

test('zzz1045a the timeframe note: none on daily patterns; W / M say the rules stay daily; the summary names it only when a rule is daily', () => {
  const rsi: Filter = { kind: 'num', key: 'rsi', op: 'gt', v: 50 };
  const rsiW: Filter = { kind: 'num', key: 'rsiW', op: 'gt', v: 50 };
  assert.equal(ruleTimeframeNote(Q({ tfs: ['D'] })), '');
  assert.equal(ruleTimeframeNote(Q({ tfs: ['W'] })), 'Pattern timeframe: Weekly. Rules below use daily figures unless they say weekly or monthly.');
  assert.equal(ruleTimeframeNote(Q({ tfs: ['W', 'M'], filters: [rsi, rsiW, { kind: 'num', key: 'roeTTM', op: 'gt', v: 10 }] })),
    'Pattern timeframe: Weekly + Monthly. Rules below use daily figures unless they say weekly or monthly. Your rules: 1 daily, 1 weekly, 1 company figure.');
  assert.match(ruleTimeframeNote(Q({ tfs: ['M'], filters: [{ ...rsi, off: true }] })), /^Pattern timeframe: Monthly\.[^Y]*$/, 'paused rules are not counted');
  assert.equal(ruleTimeframeSummary(Q({ tfs: ['W'], filters: [rsi] })), 'Rules on daily figures');
  assert.equal(ruleTimeframeSummary(Q({ tfs: ['W'], filters: [rsiW] })), '');
  assert.equal(ruleTimeframeSummary(Q({ tfs: ['D'], filters: [rsi] })), '');
  assert.match(querySummary(Q({ tfs: ['W'], filters: [rsi] }), ''), / · Rules on daily figures/);
  assert.doesNotMatch(querySummary(Q({ tfs: ['W'] }), ''), /Rules on daily/);
  assert.doesNotMatch(querySummary(Q({ tfs: ['D'], filters: [rsi] }), ''), /Rules on daily/);
});

test('zzz1045a filter panel order: Companies → Screen → Direction → Timeframe → Stage; family picker + grouped list wired', () => {
  const src = read('components/pine-screener/PineScreener.tsx');
  const at = (s: string) => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = [at('<span className="pnx-lab">Companies</span>'), at('<span className="pnx-lab">Screen</span>'), at('<span className="pnx-lab">Direction</span>'),
    at('<span className="pnx-lab">Timeframe</span>'), at('<span className="pnx-lab">Stage</span>')];
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  assert.match(src, /aria-label="Pine screens"/, 'the screen select keeps its label (older page tests use it)');
  assert.match(src, /PINE_FAMILIES\.map/);
  assert.match(src, /<ScreenFamilyPicker /);
  assert.match(src, /data-testid="rule-tf-note"/);
  const picker = read('components/pine-screener/ScreenFamilyPicker.tsx');
  assert.match(picker, /pineFamilyGroups/);
  assert.doesNotMatch(picker, /\bbest\b/i);
});
