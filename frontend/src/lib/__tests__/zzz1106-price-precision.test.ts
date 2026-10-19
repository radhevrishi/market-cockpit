// zzz1106 (deep audit N02) — moving averages are stored and sent at full precision, so "SMA 50 above SMA 200" gives the same
// answer on the raw figures, the stored row and the lean (page) row; percentages keep 2 decimals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { techFigures, TECH_FIGURES_VERSION } from '../screener/tech';
import { leanRow } from '../screener/pine';
import { passes, type Filter } from '../screener/filters';

const series = (closes: number[]) => {
  const d: string[] = []; const t0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < closes.length; i++) d.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
  return { d, o: closes.slice(), h: closes.map((x) => x * 1.001), l: closes.map((x) => x * 0.999), c: closes, v: closes.map(() => 1000) };
};
const above: Filter = { kind: 'cmp', key: 'sma50', op: 'above', other: 'sma200' } as any;

test('cent-priced fixture: 199 × 100.00 then 100.01 → SMA 50 > SMA 200 on stored and lean rows', () => {
  const f = techFigures(series([...Array(199).fill(100), 100.01]));
  assert.ok(f.sma50! > f.sma200!, `${f.sma50} > ${f.sma200}`);
  assert.ok(Math.abs(f.sma50! - 100.0002) < 1e-9 && Math.abs(f.sma200! - 100.00005) < 1e-9);
  const row = { t: 'X', ...f } as any;
  assert.equal(passes(row, above), true);
  assert.equal(passes({ t: 'X', ...leanRow(row) } as any, above), true, 'lean row agrees');
});

test('low-priced fixture: SMA 50 1.004 vs SMA 200 1.001 stay apart', () => {
  const closes = [...Array(150).fill(1), ...Array(50).fill(1.004)];
  const f = techFigures(series(closes));
  assert.ok(Math.abs(f.sma50! - 1.004) < 1e-9 && Math.abs(f.sma200! - 1.001) < 1e-9);
  assert.equal(passes({ t: 'Y', ...leanRow({ t: 'Y', ...f } as any) } as any, above), true);
  assert.equal(TECH_FIGURES_VERSION >= 2, true);
});
