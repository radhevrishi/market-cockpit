// zzz1044d — deep audit 15 Oct 2026, the wording / market / table items:
//  F03 Rule of 40: the FCF margin is the latest FULL FISCAL YEAR (never called TTM); India is a cash-flow proxy; a US year without a
//      capex line is unknown (was: capex taken as 0); the year is carried on the row (fcfmAt).
//  F04 Pine: the count and the table carry one result-batch identity and the table is keyed by it.
//  F07 Fresh Stage 2 / Stage 1 texts say what the filters and stage rules actually do.
//  F11 Stock Screener market buttons open that market's own screen; carrying rules over is an explicit copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { R40_FORMULA, R40_FIELDS, r40Explain } from '../screener/pine';
import { fcfmSourceText, FIELDS } from '../screener/filters';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('F03: Rule of 40 wording says latest full fiscal year, never TTM, and names the India proxy', () => {
  assert.ok(!/trailing twelve/i.test(R40_FORMULA));
  assert.match(R40_FORMULA, /latest full fiscal year/);
  assert.match(R40_FORMULA, /India: FCF margin is a cash-flow proxy/);
  assert.equal(R40_FIELDS.find((f) => f.key === 'fcfmTTM')?.period, 'latest full fiscal year');
  const f = FIELDS.find((x) => x.key === 'fcfmTTM')!;
  assert.match(f.label, /latest full year/);
  assert.match(f.approxNote!.IN!, /cash-flow proxy/);
  assert.match(f.approxNote!.US!, /unknown when the company files no capex line/);
  assert.ok(!read('components/pine-screener/PineScreener.tsx').includes('FCF margin TTM'));
});

test('F03: the row names its fiscal year and source', () => {
  assert.equal(fcfmSourceText({ fcfmAt: 'Mar 2026' }, 'IN'), 'fiscal year to Mar 2026 · cash-flow proxy: (cash from operations + cash from investing) ÷ sales');
  assert.match(fcfmSourceText({ fcfmAt: '2025-12-31' }, 'US'), /^fiscal year to 2025-12-31 · \(operating cash flow − capex\)/);
  assert.match(fcfmSourceText({}, 'US'), /^latest full fiscal year/);
  assert.match(r40Explain({ revQYoY: 30, fcfmTTM: 15, fcfmAt: 'Mar 2026' }).text, /15% FCF margin \(FY to Mar 2026\) = 45/);
});

test('F03: US free cash flow needs a filed capex line; India records the year', () => {
  const sec = read('lib/screener/sec-assemble.ts');
  assert.ok(!sec.includes('Math.abs(cx ?? 0)'));
  assert.match(sec, /cfo != null && cx != null && revA != null/);
  assert.match(read('lib/screener/in-assemble.ts'), /out\.fcfmAt = h;/);
  assert.match(read('lib/screener/pine.ts'), /'fcfmTTM', 'fcfmAt', 'r40'/);   // reaches the Pine page
});

test('F07: Fresh Stage 2 text matches its filters; Stage 1 text matches the 30-week rules', () => {
  const fresh = BUILT_IN_PINE_SCREENS.find((s) => s.id === 'tw-fresh-stage2')!;
  const note = String((fresh as any).note || (fresh as any).desc || '');
  assert.ok(!/SATA ≥ 6\./.test(note) || /does NOT require a SATA score now/.test(note));
  assert.match(note, /stage age ≤ 4 weeks/);
  assert.ok(!/40-week average with SATA/.test(note));
  const st1 = BUILT_IN_PINE_SCREENS.find((s) => s.id === 'tw-stage1-bases')!;
  const n1 = String((st1 as any).note || (st1 as any).desc || '');
  assert.match(n1, /30-week average/);
  assert.ok(!/40-week average is still falling/.test(n1));
});

test('F04: count and table share one batch identity; the table is keyed by it', () => {
  const src = read('components/pine-screener/PineScreener.tsx');
  assert.match(src, /data-testid="match-count" data-batch=\{batchId\}/);
  assert.match(src, /<table key=\{batchId\} data-batch=\{batchId\}/);
  assert.match(src, /if \(batchSeen !== batchId\) \{ setBatchSeen\(batchId\); setExpanded\(null\); \}/);
});

test('F11: market buttons open that market\'s own screen; copying rules is explicit and flags money units', () => {
  const src = read('components/stock-screener/StockScreener.tsx');
  assert.match(src, /onClick=\{\(\) => switchMarket\(m\)\}/);
  assert.ok(!src.includes('if (m !== market) { setMarket(m); setDirty(true); }'));
  assert.match(src, /LAST_BY_MARKET_KEY/);
  assert.match(src, /Copy these rules to \{market === 'US' \? 'India' : 'USA'\}/);
  assert.match(src, /the numbers were kept but are now/);
  assert.match(src, /if \(f\.kind === 'exch'\) return false;/);
});
