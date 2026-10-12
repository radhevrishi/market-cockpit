import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDailyCadence, parseYahooChart } from '../chart-data';

const day = 86_400_000;
test('zzz967 monthly bars are never taken as daily (NVDA range=max)', () => {
  const monthly = Array.from({ length: 60 }, (_, i) => ({ t: Date.UTC(2000, i, 1), o: 1, h: 1, l: 1, c: 1, v: 1 }));
  assert.equal(isDailyCadence(monthly), false);
  const daily: any[] = []; let t = Date.UTC(2026, 0, 5);
  for (let i = 0; i < 300; i++) { daily.push({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }); t += (new Date(t).getUTCDay() === 5 ? 3 : 1) * day; }
  assert.equal(isDailyCadence(daily), true);
});

test('zzz967 the bar built from the quote is flagged, and an inferred open is said', () => {
  const ts = [Date.UTC(2026, 9, 5) / 1000 + 14 * 3600, Date.UTC(2026, 9, 6) / 1000 + 14 * 3600];
  const s = parseYahooChart({ chart: { result: [{ meta: { symbol: 'X', regularMarketPrice: 12, regularMarketTime: Date.UTC(2026, 9, 7) / 1000 + 14 * 3600, dataGranularity: '1d' }, timestamp: ts,
    indicators: { quote: [{ open: [10, 11], high: [10.5, 11.5], low: [9.5, 10.5], close: [10.2, 11.2], volume: [5, 6] }] } }] } })!;
  assert.equal(s.bars.length, 3);
  assert.equal(s.lastBarSynthetic, true);
  assert.equal(s.lastBarOpenInferred, true);
  assert.equal(s.granularity, '1d');
});
