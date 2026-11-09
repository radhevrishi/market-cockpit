// zzz1231 — sessions below the 50 / 200 average and the 3-candle low.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maStreak, daysBelowText, low3Text } from '../ma-streak';

const mk = (closes: number[], lows?: number[]) => closes.map((c, i) => ({ t: Date.UTC(2026, 0, 1) + i * 86_400_000, o: c, h: c + 1, l: lows?.[i] ?? c - 1, c, v: 1000 }));

test('a long rise then 5 lower closes: 5 sessions below the 50-day, 3-candle low broken', () => {
  const up = Array.from({ length: 240 }, (_, i) => 100 + i * 0.5);   // 100 → 219.5
  const down = [150, 148, 146, 144, 140];
  const s = maStreak(mk([...up, ...down]));
  assert.equal(s.sma50.below, true);
  assert.equal(s.sma50.daysBelow, 5);
  assert.equal(s.ema50.daysBelow, 5);
  assert.equal(daysBelowText(s.sma50), '5 sessions');
  assert.equal(s.sma50.since, '2026-08-29');
  assert.equal(s.low3State, 'breached');   // 140 < min(147,145,143)
  assert.equal(low3Text(s), '⚠ broken');
});

test('3-candle low tested intraday but held on the close', () => {
  const base = Array.from({ length: 80 }, () => 100);
  const closes = [...base, 101, 102, 103, 102.5];
  const lows = [...base.map(() => 99), 100.5, 101.5, 102.5, 100];   // last low 100 < 100.5, close 102.5 above
  const s = maStreak(mk(closes, lows));
  assert.equal(s.low3, 100.5);
  assert.equal(s.low3State, 'tested');
  assert.equal(s.sma200.ma, null, 'not enough bars for a 200-day average');
  assert.equal(daysBelowText(s.sma200), '—');
});
