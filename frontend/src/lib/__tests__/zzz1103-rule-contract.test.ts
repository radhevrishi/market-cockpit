// zzz1103–1105 (deep audit N07 / N08 / H01) — a nested pattern rule keeps "breakouts holding only" through save / clean and
// compare tells the two apart; HAL in India and HAL in the US are two companies in a cross-market compare; a stored tag of a
// type the engine does not read on that timeframe never matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPatternRule, evalPattern, patternRuleLabel, runScreen, type Filter } from '../screener/filters';
import { compareScreens, ruleSignature } from '../screener/screen-compare';
import { PATTERN_IDS, patternApplies, PATTERN_META } from '../chart-patterns';

const backBelow = { id: PATTERN_IDS.find((i) => patternApplies(i, 'D') && PATTERN_META[i].bias === 'bullish')!, b: 'U', s: 'b', c: 80, d: -2, tf: 'D' } as any;
const row = (t: string, extra: any = {}) => ({ t, n: t, mc: 100, scan: { st: 'ready' }, pat: [backBelow], ...extra }) as any;

test('N07 — returned:false survives cleaning and keeps rejecting a breakout back below its pivot', () => {
  const rule = { kind: 'pattern', bias: 'U', ids: [], tfs: ['D'], tfMode: 'any', stages: ['b'], minScore: 55, dist: { on: false, lo: -15, hi: 5 }, returned: false } as const;
  const cleaned = cleanPatternRule(JSON.parse(JSON.stringify(rule)));
  assert.equal(cleaned.returned, false);
  assert.equal(evalPattern(row('X'), cleaned).status, 'fail', 'back-below breakout rejected after the round trip');
  assert.equal(evalPattern(row('X'), { ...cleaned, returned: undefined }).status, 'pass', 'default still counts it');
  assert.equal(cleanPatternRule({ ...rule, returned: true }).returned, undefined, 'true stays the default (no change for old screens)');
  const sigHold = ruleSignature({ ...rule } as Filter), sigAny = ruleSignature({ ...rule, returned: true } as Filter);
  assert.notEqual(sigHold, sigAny);
  assert.match(patternRuleLabel(cleaned), /breakouts holding only/);
});

test('N08 — cross-market compare: HAL (India) and HAL (US) are different companies', () => {
  const f: Filter[] = [];
  const r = compareScreens({ name: 'A', market: 'IN', filters: f }, { name: 'B', market: 'US', filters: f }, [row('HAL')], [row('HAL')]);
  assert.equal(r.both, 0);
  assert.deepEqual(r.onlyInA.map((x) => x.t), ['HAL']);
  assert.deepEqual(r.onlyInB.map((x) => x.t), ['HAL']);
  const same = compareScreens({ name: 'A', market: 'US', filters: f }, { name: 'B', market: 'US', filters: f }, [row('HAL')], [row('HAL')]);
  assert.equal(same.both, 1, 'same market unchanged');
});

test('H01 — every pattern id × D/W/M: a tag on a timeframe the engine does not read never matches', () => {
  let unsupported = 0;
  for (const id of PATTERN_IDS) for (const tf of ['D', 'W', 'M'] as const) {
    const bias = PATTERN_META[id].bias === 'bearish' ? 'D' : 'U';
    const tag = { id, b: bias, s: 'f', c: 90, d: 0, tf };
    const r = { t: 'T', scan: { st: 'ready' }, scanW: { st: 'ready' }, scanM: { st: 'ready' }, pat: tf === 'D' ? [tag] : [], patW: tf === 'W' ? [tag] : [], patM: tf === 'M' ? [tag] : [] };
    const st = evalPattern(r, { bias: 'both', ids: [], stages: ['f', 'b', 'x'], minScore: 35, dist: { on: false, lo: 0, hi: 0 }, tfs: [tf], tfMode: 'any' }).status;
    if (patternApplies(id, tf)) assert.equal(st, 'pass', `${id} ${tf}`);
    else { unsupported++; assert.equal(st, 'fail', `${id} ${tf} must be rejected`); }
  }
  assert.ok(unsupported > 0);
  assert.equal(runScreen([row('Y')], []).length, 1);
});
