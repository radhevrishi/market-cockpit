import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PatternHit } from '../chart-patterns';
import { cleanLayout, legendRows, priceSeriesOf, sameSettings, seedLayoutStore, EXTRA_INFO } from '../chart-layouts';
import {
  bannerColors, bannerOf, currencyPrefix, dailyUrl, hitsFor, hitsToDraw, overlayLinesOf, patternDataPlan, patternKey, patternsOn,
  snapTime, statusFor, togglePicked, withPatterns, EMPTY_PATTERNS, PATTERN_GROUP,
} from '../../components/charts/pattern-view';
import { contrast } from '../readable-color';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const hit = (over: Partial<PatternHit> = {}): PatternHit => ({
  id: 'cup_handle', label: 'Cup with handle', bias: 'bullish', family: 'base', stage: 'forming', confidence: 0.82, likelihood: 'very likely',
  startT: T0, endT: T0 + 130 * DAY, lengthBars: 130, depthPct: 24, pivot: 512.4, distToPivotPct: -4.1,
  note: 'Cup with handle, 26 weeks, 24% deep — handle 8% deep; pivot 512.40, close 4% below',
  lines: [
    { kind: 'pivot', points: [[T0 + 120 * DAY, 512.4], [T0 + 130 * DAY, 512.4]] },
    { kind: 'resistance', points: [[T0, 520], [T0 + 120 * DAY, 520]] },
    { kind: 'support', points: [[T0 + 60 * DAY, 395], [T0 + 60 * DAY, 395]] },
  ],
  ...over,
});
const vcp = hit({ id: 'vcp', label: 'VCP (volatility contraction)', confidence: 0.6, likelihood: 'likely' });
const dblTop = hit({ id: 'double_top', label: 'Double top', bias: 'bearish', family: 'reversal', pivot: 88.25, distToPivotPct: 3, lengthBars: 40, lines: [{ kind: 'pivot', points: [[T0, 88.25], [T0 + 40 * DAY, 88.25]] }, { kind: 'trend', points: [[T0, 80], [T0 + 20 * DAY, 95]] }] });

test('banner: bullish lead with currency, also-likely tail, green tone', () => {
  const b = bannerOf([hit(), vcp], '₹');
  assert.equal(b.tone, 'bullish');
  assert.equal(b.text, '📐 Very likely forming: Cup with handle (bullish, 26 wk, pivot ₹512.40, 4% below) · also likely: VCP (volatility contraction)');
});

test('banner: bearish lead in dollars, red tone; none → grey "No clear chart pattern"', () => {
  const b = bannerOf([dblTop], '$');
  assert.equal(b.tone, 'bearish');
  assert.match(b.text, /^📐 Very likely forming: Double top \(bearish, 8 wk, breakdown \$88\.25, 3% above\)$/);
  assert.deepEqual(bannerOf([], '$'), { text: '📐 No clear chart pattern', tone: 'none' });
  assert.equal(bannerOf([], '$', 'loading').tone, 'none');
  assert.match(bannerOf([], '$', 'error', 'daily bars unavailable').text, /daily bars unavailable/);
  // a sub-₹1 price keeps 4 decimals
  assert.match(bannerOf([hit({ pivot: 0.4567 })], '₹').text, /pivot ₹0\.4567/);
});

test('currency prefix follows the response, then the market', () => {
  assert.equal(currencyPrefix('IN', 'INR'), '₹');
  assert.equal(currencyPrefix('US', 'USD'), '$');
  assert.equal(currencyPrefix('US', 'EUR'), 'EUR ');
  assert.equal(currencyPrefix('IN', null), '₹');
  assert.equal(currencyPrefix('US', undefined), '$');
});

test('banner colours: readable text on the tint, white and dark workspace', () => {
  for (const light of [true, false]) {
    for (const tone of ['bullish', 'bearish', 'none'] as const) {
      const c = bannerColors(tone, light);
      const page = light ? '#FFFFFF' : '#0A0E1A';
      assert.ok((contrast(c.text, page) ?? 0) >= 4.4, `${tone} ${light ? 'light' : 'dark'} text ${c.text}`);
      assert.match(c.bg, /^rgba\(/);
    }
  }
  assert.notEqual(bannerColors('bullish', true).bg, bannerColors('bearish', true).bg);
});

test('overlay points: pivot dashed with a label, others solid; a one-point level becomes a short tick', () => {
  const times = Array.from({ length: 140 }, (_, i) => T0 + i * DAY);
  const lines = overlayLinesOf(hit(), times, (n) => `₹${n.toFixed(2)}`);
  assert.equal(lines.length, 3);
  const [pv, res, sup] = lines;
  assert.deepEqual(pv.points, [{ timestamp: T0 + 120 * DAY, value: 512.4 }, { timestamp: T0 + 130 * DAY, value: 512.4 }]);
  assert.equal(pv.dashed, true); assert.equal(pv.label, 'Pivot ₹512.40'); assert.equal(pv.color, '#089981');
  assert.equal(res.dashed, false); assert.equal(res.label, undefined);
  assert.deepEqual(sup.points, [{ timestamp: T0 + 58 * DAY, value: 395 }, { timestamp: T0 + 62 * DAY, value: 395 }]);
  const bear = overlayLinesOf(dblTop, times)[0];
  assert.equal(bear.color, '#F23645'); assert.equal(bear.label, 'Breakdown 88.25');
});

test('overlay points snap onto weekly candles; times before the first candle are kept', () => {
  const weeks = Array.from({ length: 30 }, (_, i) => T0 + i * 7 * DAY);
  assert.equal(snapTime(weeks, T0 + 9 * DAY), T0 + 7 * DAY);
  assert.equal(snapTime(weeks, T0 - 3 * DAY), T0 - 3 * DAY);
  assert.equal(snapTime([], 123), 123);
  const [pv] = overlayLinesOf(hit(), weeks);
  assert.ok(weeks.includes(pv.points[0].timestamp) && weeks.includes(pv.points[1].timestamp));
  // pivot 120..130 days → weeks 17 and 18: still two distinct points
  assert.notEqual(pv.points[0].timestamp, pv.points[1].timestamp);
});

test('symbol change: hits for the previous symbol are never shown', () => {
  const kA = patternKey('IN', 'abc', 'NSE', 'price'), kB = patternKey('IN', 'XYZ', 'NSE', 'price');
  const state = { key: kA, hits: [hit()], at: 1, status: 'ready' as const };
  assert.equal(hitsFor(state, kA).length, 1);
  assert.deepEqual(hitsFor(state, kB), []);
  assert.equal(statusFor(state, kB), 'loading');
  assert.deepEqual(hitsFor(EMPTY_PATTERNS, kA), []);
  // exchange and price basis are part of the identity; US ignores the exchange
  assert.notEqual(patternKey('IN', 'ABC', 'NSE', 'price'), patternKey('IN', 'ABC', 'BSE', 'price'));
  assert.notEqual(kA, patternKey('IN', 'ABC', 'NSE', 'tr'));
  assert.equal(patternKey('US', 'qqq', 'NSE', 'price'), patternKey('US', 'QQQ', undefined, 'price'));
});

test('data plan: reuse the daily bars on screen only when they cover 5+ years; else one daily fetch (same URL as the page)', () => {
  assert.equal(patternDataPlan({ interval: '1d', range: '5y' }, 'ABC', 'IN', 'NSE', 'price').useShown, true);
  assert.equal(patternDataPlan({ interval: '1d', range: '2y' }, 'ABC', 'IN', 'NSE', 'price').useShown, false);
  assert.equal(patternDataPlan({ interval: '1wk', range: '10y' }, 'ABC', 'IN', 'NSE', 'price').useShown, false);
  assert.equal(patternDataPlan(null, 'ABC', 'IN', 'NSE', 'price').useShown, false);
  assert.equal(dailyUrl('M&M', 'IN', 'BSE', 'tr'), '/api/v1/chart/M%26M?market=IN&interval=1d&range=5y&exchange=BSE&basis=tr&adj=2');
  assert.equal(dailyUrl('QQQ', 'US', 'NSE', 'price'), '/api/v1/chart/QQQ?market=US&interval=1d&range=5y');
  // the page's own load URL is built the same way, so a fetched daily series is shared through its cache
  const src = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes("/api/v1/chart/${encodeURIComponent(ticker)}?market=${market}&interval=${TF_TO_INTERVAL[tf]}&range=${dataRange}${market === 'IN' && exchange ? `&exchange=${exchange}` : ''}${basis === 'tr' ? '&basis=tr&adj=2' : ''}"));
});

test('layout: off by default, toggled into the working layout, saved like other indicators, not a legend row', () => {
  for (const l of seedLayoutStore(1).layouts) assert.equal(patternsOn(l), false);
  const base = cleanLayout(seedLayoutStore(1).layouts[0]);
  const on = cleanLayout(withPatterns(base, true));
  assert.equal(patternsOn(on), true);
  assert.equal(on.extras.filter((x) => x.type === 'PAT').length, 1);
  assert.equal(cleanLayout(withPatterns(on, true)).extras.filter((x) => x.type === 'PAT').length, 1, 'never added twice');
  assert.equal(sameSettings(on, base), false, 'turning it on marks the layout as changed (● Save)');
  assert.equal(sameSettings(cleanLayout(withPatterns(on, false)), base), true, 'turning it off returns to the saved layout');
  assert.equal(legendRows(on).length, legendRows(base).length);
  assert.deepEqual(priceSeriesOf(on), priceSeriesOf(base));
  assert.equal(EXTRA_INFO.PAT.pane, false);
  // survives a save → reload round trip
  assert.equal(patternsOn(cleanLayout(JSON.parse(JSON.stringify(on)))), true);
});

test('which patterns are drawn: the lead by default, then whatever is ticked', () => {
  const hits = [hit(), vcp];
  assert.deepEqual(hitsToDraw(hits, null).map((h) => h.id), ['cup_handle']);
  const p1 = togglePicked(hits, null, 'vcp');
  assert.deepEqual([...p1].sort(), ['cup_handle', 'vcp']);
  const p2 = togglePicked(hits, p1, 'cup_handle');
  assert.deepEqual(hitsToDraw(hits, p2).map((h) => h.id), ['vcp']);
  assert.deepEqual(hitsToDraw(hits, new Set()), []);
  assert.deepEqual(hitsToDraw([], null), []);
});

test('wiring: own overlay group, never in the saved drawings, registered overlay, toggle in the Indicators panel', () => {
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  const ind = readFileSync(new URL('../../components/charts/PatternIndicator.tsx', import.meta.url), 'utf8');
  const ks = readFileSync(new URL('../../components/charts/kline-setup.ts', import.meta.url), 'utf8');
  const lc = readFileSync(new URL('../../components/charts/LayoutControls.tsx', import.meta.url), 'utf8');
  assert.equal(PATTERN_GROUP, 'mc-patterns');
  assert.ok(ind.includes('groupId: PATTERN_GROUP') && ind.includes('removeOverlay({ groupId: PATTERN_GROUP })'));
  assert.ok(ws.includes("getOverlays({ groupId: DRAW_GROUP })"), 'drawings are saved from their own group only');
  assert.ok(ks.includes("name: 'mcPatternLine'"));
  assert.ok(lc.includes('Automate chart patterns') && lc.includes('withPatterns'));
  assert.ok(ws.includes('usePatternIndicator({ on: patternsOn(L.working)'));
});
