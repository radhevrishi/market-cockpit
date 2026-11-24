import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns, PATTERN_META, PATTERN_TIMEFRAMES } from '../chart-patterns';
import { SETUP_META, STRUCTURE_PATTERNS } from '../options-ideas/setups';
import { NO_HISTORY_YET } from '../options-ideas/model';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';

// daily bars: rise to 100 (day 200), fall to 60, base 2.5 years under 95, climb to the ceiling, break above it
function bars(breakAbove: boolean) {
  const out: any[] = []; let t = Date.UTC(2020, 0, 1);
  const n = 1100;
  for (let i = 0; i < n; i++) {
    let p: number;
    if (i <= 200) p = 50 + 50 * (i / 200);
    else if (i <= 330) p = 100 - 40 * ((i - 200) / 130);
    else if (i <= 900) p = 60 + 30 * ((i - 330) / 570) + 4 * Math.sin(i / 25);
    else if (i <= 1085) p = 90 + 8 * ((i - 900) / 185);
    else p = breakAbove && i >= 1097 ? 104 : 98;
    const w = p * 0.012;
    out.push({ t, o: p - w / 3, h: p + w, l: p - w, c: p, v: 1e6 * (1 + (i > 1080 ? 1 : 0)) });
    t += 86400000;
  }
  return out;
}

test('multi-year breakout is a pattern on every timeframe, a setup type, in the structure list and a Pine screen', () => {
  assert.equal(PATTERN_META.multiyear_breakout.bias, 'bullish');
  assert.equal(PATTERN_TIMEFRAMES.multiyear_breakout.length, 3);
  assert.equal(SETUP_META.multiyear_breakout.side, 'CALL');
  assert.ok(STRUCTURE_PATTERNS.has('multiyear_breakout') && NO_HISTORY_YET.has('multiyear_breakout'));
  assert.ok(BUILT_IN_PINE_SCREENS.some((s) => s.id === 'multiyear-breakout'));
});

test('a 2+ year ceiling is found under it (forming) and above it (breakout), pivot = the old high', () => {
  const near = detectPatterns(bars(false), { timeframe: 'D', maxBars: 1300 }).find((h) => h.id === 'multiyear_breakout');
  assert.ok(near, 'found while just under the ceiling');
  assert.ok(Math.abs((near!.pivot ?? 0) - 101.2) < 1.5, `pivot ${near!.pivot}`);
  assert.equal(near!.stage, 'forming');
  const broke = detectPatterns(bars(true), { timeframe: 'D', maxBars: 1300 }).find((h) => h.id === 'multiyear_breakout');
  assert.ok(broke, 'found after the break');
  assert.equal(broke!.stage, 'breakout');
});

test('a ceiling set less than two years ago is not a multi-year breakout', () => {
  const b = bars(false).slice(500);   // the 100 high is now only ~1.1 years before the last bar's window start
  const h = detectPatterns(b.slice(-450), { timeframe: 'D', maxBars: 1300 }).find((x) => x.id === 'multiyear_breakout');
  assert.equal(h, undefined);
});
