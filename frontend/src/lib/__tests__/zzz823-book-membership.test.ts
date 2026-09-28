// zzz823 — "My book" = the saved holdings, exactly; the Conviction Beats
// selection is one shared pass / fail / NOT CHECKED check; stale Special
// Focus records are split off. Synthetic tickers only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveIndiaBook, bookUniverse, buildBookCheck, bookWhy } from '../thesis/book-membership';
import { heldKey, selectIndiaCb, selectUsCb, cbCriteriaLine } from '../thesis/pc-bench';
import { runCriteriaCheck, notCheckedText } from '../criteria-check';
import { cbCriteriaCheck, cbFiltersForOwner, passesConvictionFilter, FILTER_DEFAULT } from '../conviction-filter-india';
import { usCbCriteriaCheck, usPresetFilters, passesUsConvictionFilter } from '../conviction-beats-us';
import { splitOffLists } from '../catalyst/cross-view';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

// A synthetic India entry that meets the whole preset on real data.
const good = (ticker: string, over: Record<string, any> = {}) => ({
  ticker, company: `${ticker} Synthetic Ltd`, tier: 'STRONG', composite_score: 80,
  sales_yoy_pct: 40, net_profit_yoy_pct: 50, eps_yoy_pct: 50, opm_pct: 20, opm_prev_pct: 15,
  cfo_to_pat_ratio: 1.2, roce: 30, market_cap_cr: 5000, pledged_pct: 0, d1_pct: 5, gap_pct: 2, pe: 20,
  filing_date: '2026-08-10', sector: 'Capital Goods',
  ...over,
}) as any;

describe('zzz823 — My book is the saved holdings, nothing else', () => {
  test('server copy ∪ this browser; old lists and the synced snapshot are never members', () => {
    const r = resolveIndiaBook({
      server: { ok: true, symbols: ['ZZALPHA', 'ZZBETA'], updatedAt: '2026-09-20T10:00:00Z' },
      browser: ['ZZBETA', 'ZZGAMMA'],
      legacy: { portfolioHoldings: ['ZZOLDONE', 'ZZALPHA'], mc_portfolio_tickers: ['ZZOLDTWO'] },
      synced: { ok: true, symbols: ['ZZSTALE', 'ZZBETA'] },
    });
    assert.deepEqual(r.names.map((n) => n.symbol), ['ZZALPHA', 'ZZBETA', 'ZZGAMMA']);
    assert.deepEqual(r.names.find((n) => n.symbol === 'ZZGAMMA')!.sources, ['browser']);
    assert.match(bookWhy(r.names.find((n) => n.symbol === 'ZZGAMMA')!), /this browser only — not on the server yet/);
    assert.deepEqual(r.ignored.map((x) => x.symbol).sort(), ['ZZOLDONE', 'ZZOLDTWO', 'ZZSTALE']);
    assert.ok(r.sources.some((s) => /Old list/.test(s.label) && !s.used));
    assert.ok(r.sources.some((s) => /Synced book snapshot/.test(s.label) && !s.used));
    assert.equal(r.settled, true);
    assert.equal(r.serverError, null);
  });

  test('one company, one row: ABC and ABC-BE (and NSE:, .NS, lower case) never duplicate or drop', () => {
    const r = resolveIndiaBook({ server: { ok: true, symbols: ['zzdelta-be', 'NSE:ZZEPS'] }, browser: ['ZZDELTA', 'zzeps.ns', '543210'] });
    assert.deepEqual(r.names.map((n) => n.symbol), ['543210', 'ZZDELTA', 'ZZEPS']);
    const d = r.names.find((n) => n.symbol === 'ZZDELTA')!;
    assert.deepEqual(d.merged, ['ZZDELTA-BE']);
    assert.match(bookWhy(d), /also saved as ZZDELTA-BE/);
    assert.match(bookWhy(r.names.find((n) => n.symbol === '543210')!), /BSE code/);
    assert.equal(heldKey('NSE:ZZDELTA-BE'), 'ZZDELTA');
    assert.equal(heldKey('zzdelta.ns'), 'ZZDELTA');
  });

  test('server not read yet → this browser only; server failed → said, never "empty"', () => {
    const a = resolveIndiaBook({ server: null, browser: ['ZZALPHA'] });
    assert.equal(a.settled, false);
    assert.deepEqual(a.names.map((n) => n.symbol), ['ZZALPHA']);
    const b = resolveIndiaBook({ server: { ok: false, symbols: [], error: 'HTTP 500' }, browser: ['ZZALPHA'] });
    assert.equal(b.serverError, 'HTTP 500');
    assert.deepEqual(b.names.map((n) => n.symbol), ['ZZALPHA']);
  });

  test('bookUniverse: a held name on the bench list under another spelling is not a bench row', () => {
    const r = resolveIndiaBook({ server: { ok: true, symbols: ['ZZDELTA-BE'] }, browser: [] });
    const u = bookUniverse(r.names, ['ZZDELTA', 'ZZNEW']);
    assert.deepEqual(Array.from(u.entries()), [['ZZDELTA-BE', 'book'], ['ZZNEW', 'bench']]);
  });

  test('Book check: saved = shown; shown-but-not-saved is zero; the reasons are printed', () => {
    const r = resolveIndiaBook({ server: { ok: true, symbols: ['ZZALPHA', 'ZZBETA'] }, browser: [] });
    const rows = [
      { symbol: 'ZZALPHA', origin: 'book' },
      { symbol: 'ZZBETA', origin: 'book' },
      { symbol: 'ZZBENCH', origin: 'bench', benchSource: 'Conviction Beats (India)', preset: { state: 'unknown', text: 'not checked: sales growth missing — shown, not failed' } },
    ];
    const c = buildBookCheck({ saved: r.names, rows, sources: r.sources, rule: r.rule });
    assert.equal(c.book.length, 2);
    assert.equal(c.notSaved.length, 0);
    assert.equal(c.notShown.length, 0);
    assert.match(c.bench[0].why, /not checked: sales growth missing/);
    assert.match(c.line, /Saved holdings 2 → shown in My book 2/);
    // A stray row shown as a holding that is not saved is caught.
    const bad = buildBookCheck({ saved: r.names, rows: [...rows, { symbol: 'ZZSTRAY', origin: 'book' }], sources: r.sources, rule: r.rule });
    assert.deepEqual(bad.notSaved.map((x) => x.symbol), ['ZZSTRAY']);
    assert.match(bad.line, /not saved: 1 ⚠/);
    // A saved name with no row, and one saved elsewhere (a non-US listing), each say why.
    const miss = buildBookCheck({ saved: [...r.names, { symbol: 'ZZFRA', key: 'ZZFRA', sources: ['server'], merged: [] }, { symbol: 'ZZGONE', key: 'ZZGONE', sources: ['server'], merged: [] }], rows, sources: r.sources, rule: r.rule, savedElsewhere: [{ symbol: 'ZZFRA', reason: 'held on Frankfurt' }] });
    assert.deepEqual(miss.notShown.map((x) => x.symbol).sort(), ['ZZFRA', 'ZZGONE']);
  });
});

describe('zzz823 — pass / fail / NOT CHECKED (unknown is not a fail)', () => {
  const preset = cbFiltersForOwner(false);

  test('runner: fail wins over missing; only-missing is unknown; a combination fail is a fail', () => {
    assert.equal(runCriteriaCheck(['a'], true, () => false, () => [], (k) => k).state, 'pass');
    const u = runCriteriaCheck(['a', 'b'], false, (k) => k === 'b', (k) => (k === 'a' ? ['sales growth'] : []), (k) => k);
    assert.deepEqual([u.state, u.missing], ['unknown', ['sales growth']]);
    const f = runCriteriaCheck(['a', 'b'], false, () => false, (k) => (k === 'a' ? ['sales growth'] : []), (k) => `${k} low`);
    assert.deepEqual([f.state, f.failed, f.missing], ['fail', ['b low'], ['sales growth']]);
    assert.equal(runCriteriaCheck(['a'], false, () => true, () => [], (k) => k).state, 'fail');
    assert.equal(notCheckedText(['market cap']), 'not checked: market cap missing');
  });

  test('India: full data passes; a missing figure is NOT CHECKED; a real miss fails', () => {
    const ok = good('ZZPASS');
    assert.equal(passesConvictionFilter(ok, preset), true);
    assert.equal(cbCriteriaCheck(ok, preset).state, 'pass');
    const noSales = good('ZZNOSALES', { sales_yoy_pct: null });
    assert.equal(passesConvictionFilter(noSales, preset), false, 'the yes/no filter drops it (sales ?? 0)');
    const c = cbCriteriaCheck(noSales, preset);
    assert.equal(c.state, 'unknown');
    assert.ok(c.missing.includes('sales growth'));
    const noCap = cbCriteriaCheck(good('ZZNOCAP', { market_cap_cr: null }), preset);
    assert.deepEqual([noCap.state, noCap.missing.includes('market cap')], ['unknown', true]);
    const slow = cbCriteriaCheck(good('ZZSLOW', { sales_yoy_pct: 5 }), preset);
    assert.equal(slow.state, 'fail');
    assert.match(slow.failed.join(' '), /sales growth 5% \(needs 20%\)/);
    // A hand-set chip stays strict: no day-one move → fails a D1 chip.
    assert.equal(cbCriteriaCheck(good('ZZD1', { d1_pct: null }), { ...FILTER_DEFAULT, d1Bucket: 3 }).state, 'fail');
  });

  test('selectIndiaCb: not-checked names are listed and on the bench; held (any spelling) shown once as book', () => {
    const list = [good('ZZPASS'), good('ZZNOSALES', { sales_yoy_pct: null }), good('ZZSLOW', { sales_yoy_pct: 5 }), good('ZZHELD')];
    const sel = selectIndiaCb({ held: ['ZZHELD-BE'], list, criteriaOff: false, check: (e) => cbCriteriaCheck(e as any, preset) });
    assert.deepEqual(sel.passing, ['ZZHELD', 'ZZNOSALES', 'ZZPASS']);
    assert.deepEqual(sel.unknown, ['ZZNOSALES']);
    assert.deepEqual(sel.bench, ['ZZNOSALES', 'ZZPASS']);
    assert.deepEqual(sel.benchFailing, ['ZZSLOW']);
    assert.deepEqual(sel.heldPassing, ['ZZHELD']);
    assert.equal(sel.labels.ZZNOSALES.state, 'unknown');
    assert.match(sel.labels.ZZNOSALES.text, /^not checked: sales growth missing/);
    assert.equal(sel.labels.ZZSLOW.state, 'fail');
    const line = cbCriteriaLine({ market: 'IN', listTotal: 4, passing: 3, failing: 1, heldPassing: 1, unknown: 1, criteria: 'x', source: 'y', error: null }, 3, false);
    assert.match(line, /under your criteria: 3 \(2 meet them \+ 1 not checked/);
    assert.match(line, /matches Conviction Beats page: 3 names = 1 you hold/);
  });

  test('US: a missing market cap under Small/Mid is NOT CHECKED; low growth fails', () => {
    const f = { ...usPresetFilters(), cap: 'smid', aboveMa50: false, aboveMa200: false } as any;
    const base = { ticker: 'ZZUS', company: 'ZZ US Corp', tier: 'STRONG', sales_yoy_pct: 40, net_profit_yoy_pct: 60, eps_yoy_pct: 60, opm_pct: 20, opm_prev_pct: 15, cfo_to_pat_ratio: 1.2, market_cap_musd: 1500, pead_score: 70, filing_date: '2026-08-10' } as any;
    assert.equal(passesUsConvictionFilter(base, f), true);
    assert.equal(usCbCriteriaCheck(base, f).state, 'pass');
    const noCap = usCbCriteriaCheck({ ...base, market_cap_musd: null }, f);
    assert.deepEqual([noCap.state, noCap.missing], ['unknown', ['market cap']]);
    assert.equal(usCbCriteriaCheck({ ...base, sales_yoy_pct: 3 }, f).state, 'fail');
    const sel = selectUsCb({ held: ['ZZH.B'], key: (t) => t.toUpperCase().replace(/[./ ]/g, '-'), list: [{ ...base, ticker: 'ZZH-B' }, { ...base, ticker: 'ZZN', market_cap_musd: null }], criteriaOff: false, check: (e) => usCbCriteriaCheck(e as any, f) });
    assert.deepEqual(sel.heldPassing, ['ZZH-B']);
    assert.deepEqual(sel.bench, ['ZZN']);
    assert.deepEqual(sel.unknown, ['ZZN']);
  });
});

describe('zzz823 — Special Focus and 10-day counts are book + bench only', () => {
  test('a stored record with no row on the page is split off and not counted', () => {
    const e = (id: string, row: any, dismissed = false) => ({ id, row, dismissed });
    const { onLists, offLists } = splitOffLists([e('A', { symbol: 'ZZA' }), e('B', null), e('C', null, true)]);
    assert.deepEqual(onLists.map((x) => x.id), ['A']);
    assert.deepEqual(offLists.map((x) => x.id), ['B']);
  });

  test('wiring: both pages and both Conviction Beats tabs use the shared pieces', () => {
    const inPc = read('app/(dashboard)/portfolio-catalysts/page.tsx');
    const usPc = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    assert.match(inPc, /<BookCheckPanel check=\{bookCheck\} market="IN" \/>/);
    assert.match(usPc, /<BookCheckPanel check=\{bookCheck\} market="US" \/>/);
    assert.match(usPc, /<UsSpecialFocusPanel rows=\{inSource as any\} lookup=\{all0 as any\}/);
    const useBook = read('lib/thesis/use-book.ts');
    assert.doesNotMatch(useBook, /readHoldingSymbols|fetchServerBook/, 'the old six-source book is gone');
    assert.match(useBook, /resolveIndiaBook\(/);
    const wl = read('app/(dashboard)/watchlists/page.tsx');
    assert.match(wl, /cbCriteriaCheck\(e, filters\)/);
    assert.match(wl, /entries\.filter\(\(e\) => cbCheckOf\.get\(e\)\?\.state !== 'fail'\)/);
    assert.doesNotMatch(wl, /for \(const key of \['mc_portfolio_tickers', 'mc_portfolio_holdings_v1'\]\)/);
    assert.match(read('app/(dashboard)/us-conviction-beats/page.tsx'), /usCheckOf\.get\(e\)\?\.state !== 'fail'/);
    assert.doesNotMatch(read('app/(dashboard)/earnings/page.tsx'), /localStorage\.setItem\('mc_portfolio_holdings'/, 'no page but Portfolio writes the book');
    assert.match(read('components/special-focus-panel.tsx'), /splitOffLists\(entries\)/);
    assert.match(read('components/us-special-focus-panel.tsx'), /splitOffLists\(entries\)/);
  });
});
