// zzz1043 — final screener QA (owner, 15 Oct 2026):
//  · India Stock Screener "Daily Gainers" showed yesterday's moves after the close: NSE's daily price file for the day is not out
//    until the evening, while the Yahoo bars already had the completed session → the completed bar close is used until the file arrives.
//  · Latest result quarter labels checked against the filing date (India: future quarter replaced, a very late one flagged ⚠;
//    US: an impossible fiscal year dropped).
//  · Pine pattern chip: the cryptic "v?" now reads "no vol".
//  · Stock Screener: screens can be deleted (own) or hidden (built-in) from the picker, and restored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInQuote } from '../screener/pine';
import { quarterCheckIn, quarterCheckUs, resultText, resultLines, resultCsvCells, type LatestResult } from '../screener/latest-result';
import { pickerGroups } from '../screener/screen-picker';
import { assembleInRow } from '../screener/in-build';

const AFTER_CLOSE = new Date('2026-10-15T10:45:00Z');   // 16:15 IST
const DURING = new Date('2026-10-15T07:00:00Z');        // 12:30 IST

test('India: a completed bar newer than the NSE file replaces the stale price, change from NSE close', () => {
  const tf = { scanPx: 966.15, scanAt: '2026-10-15', prevClose: 876.2, close: 966.15 };
  const r = resolveInQuote({ px: 876, at: '2026-10-14' }, tf, AFTER_CLOSE);
  assert.equal(r.px, 966.15);
  assert.equal(r.at, '2026-10-15');
  assert.equal(r.pxAlt, 876);
  assert.equal(r.chg, 10.3);
  assert.match(r.src, /NSE price file for this day not out yet/);
});

test('India: NSE file kept when the bar is unfinished, read in session, older, or disagrees on the previous close', () => {
  const base = { scanPx: 966.15, scanAt: '2026-10-15', prevClose: 876.2 };
  assert.equal(resolveInQuote({ px: 876, at: '2026-10-14' }, base, DURING).px, 876);   // today's bar still open
  assert.equal(resolveInQuote({ px: 876, at: '2026-10-14' }, { ...base, cc: { sma50: 1 } }, AFTER_CLOSE).px, 876);
  assert.equal(resolveInQuote({ px: 876, at: '2026-10-14' }, { ...base, scanLive: {} }, AFTER_CLOSE).px, 876);
  assert.equal(resolveInQuote({ px: 876, at: '2026-10-15' }, base, AFTER_CLOSE).px, 876);   // the file is already today's
  assert.equal(resolveInQuote({ px: 876, at: '2026-10-14' }, { ...base, prevClose: 438 }, AFTER_CLOSE).px, 876);   // split / bad tick
  assert.equal(resolveInQuote({ px: 876, at: '2026-10-14' }, undefined, AFTER_CLOSE).px, 876);
});

test('India row: price, change, market cap and provenance follow the resolved quote', () => {
  const tf: any = { d: '2026-10-15', scanPx: 110, scanAt: '2026-10-15', prevClose: 100, close: 110, avgVol10: 5 };
  const store: any = { f: { shares: 10, q: 'Jun 2026' } };
  const realNow = Date.now;
  Date.now = () => AFTER_CLOSE.getTime();
  const RealDate = Date;
  // resolveInQuote reads `new Date()`; pin it to after the close
  (globalThis as any).Date = class extends RealDate { constructor(...a: any[]) { super(...(a.length ? a : [AFTER_CLOSE.getTime()]) as [number]); } static now() { return AFTER_CLOSE.getTime(); } };
  try {
    const row = assembleInRow('ABC', 'Abc', { date: '2026-10-14', px: { ABC: [100, 95, 1000] } } as any, [], store, tf, undefined);
    assert.equal(row.px, 110);
    assert.equal(row.chg, 10);
    assert.equal(row.mc, 1100);
    assert.equal(row.pxAt, '2026-10-15');
    assert.equal((row as any).pxAlt, 100);
  } finally { (globalThis as any).Date = RealDate; Date.now = realNow; }
});

test('India quarter label: future quarter replaced, very late one flagged, normal kept', () => {
  assert.deepEqual(quarterCheckIn('Q1 FY28', '2026-08-10'), { q: 'Q1 FY27', fixedFrom: 'Q1 FY28' });
  assert.deepEqual(quarterCheckIn('Q1 FY27', '2026-10-14'), { q: 'Q1 FY27', late: 106 });
  assert.deepEqual(quarterCheckIn('Q1 FY27', '2026-08-12'), { q: 'Q1 FY27' });
  assert.deepEqual(quarterCheckIn('Q4 FY26', '2026-05-28'), { q: 'Q4 FY26' });
  assert.deepEqual(quarterCheckIn(undefined, '2026-08-12'), { q: undefined });
});

test('US quarter label: only an impossible fiscal year is dropped', () => {
  assert.deepEqual(quarterCheckUs('Q2 FY17', '2026-08-10'), { q: 'Q2', fixedFrom: 'Q2 FY17' });
  assert.deepEqual(quarterCheckUs('Q2 FY26', '2026-08-05'), { q: 'Q2 FY26' });
  assert.deepEqual(quarterCheckUs('Q1 FY27', '2026-09-20'), { q: 'Q1 FY27' });
  assert.deepEqual(quarterCheckUs('Q4 FY25', '2026-02-20'), { q: 'Q4 FY25' });
});

test('result text, tooltip and CSV use the checked label', () => {
  const lr: LatestResult = { d: '2026-10-14', q: 'Q1 FY27', g: 'MIXED', s: -53, p: 35, src: 'EO' };
  assert.match(resultText(lr, 'IN', '2026-10-15'), /^Q1 FY27 ⚠ · 14 Oct/);
  assert.ok(resultLines(lr, 'IN', '2026-10-15').some((l) => /Filed 106 days after Q1 FY27 ended/.test(l)));
  assert.equal(resultCsvCells(lr, '2026-10-15', 'IN')[1], 'Q1 FY27 (filed 106 days after quarter end)');
  const us: LatestResult = { d: '2026-08-10', q: 'Q2 FY17', g: 'MIXED', src: 'EO' };
  assert.match(resultText(us, 'US', '2026-10-15'), /^Q2 · 10 Aug/);
  assert.ok(resultLines(us, 'US', '2026-10-15').some((l) => /cannot be right for a 2026 filing/.test(l)));
});

test('screen picker leaves hidden screens out of every group', () => {
  const screens: any[] = [
    { id: 'b1', name: 'Daily Gainers Stocks', market: 'IN', filters: [] },
    { id: 'b2', name: 'Other', market: 'IN', filters: [] },
    { id: 'm1', name: 'Mine', market: 'US', filters: [] },
  ];
  const bi = new Set(['b1', 'b2']);
  const g = pickerGroups(screens, bi, ['b1'], '', ['b1']);
  const ids = g.flatMap((x) => x.screens.map((s) => s.id));
  assert.deepEqual(ids.sort(), ['b2', 'm1']);
});

test('UI wiring: delete / hide / restore in the picker, "no vol", Last close date, India pxAlt wording', () => {
  const root = join(__dirname, '..', '..');
  const picker = readFileSync(join(root, 'components/stock-screener/ScreenPicker.tsx'), 'utf8');
  assert.match(picker, /data-remove=/);
  assert.match(picker, /data-restore=/);
  assert.match(picker, /Hidden screens/);
  const ss = readFileSync(join(root, 'components/stock-screener/StockScreener.tsx'), 'utf8');
  assert.match(ss, /onRemove=\{removeScreen\}/);
  assert.match(ss, /writeHiddenScreens/);
  assert.match(ss, /Last close\$\{closeDayText/);
  const ui = readFileSync(join(root, 'components/pine-screener/pine-ui.tsx'), 'utf8');
  assert.ok(!ui.includes('>v?<'));
  assert.match(ui, />no vol</);
  const pine = readFileSync(join(root, 'components/pine-screener/PineScreener.tsx'), 'utf8');
  assert.match(pine, /NSE's price file for/);
  const keys = readFileSync(join(root, 'lib/user-vault-keys.ts'), 'utf8') + readFileSync(join(root, 'lib/user-state-store.ts'), 'utf8');
  assert.equal(keys.split("'mc:stock-screens-hidden:v1'").length - 1, 2);
});
