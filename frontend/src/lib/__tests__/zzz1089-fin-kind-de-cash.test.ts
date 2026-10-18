// zzz1089 — blank D/E and CFO/PAT tiles on Earnings Opportunities (17 Oct paste): the engine marks every "Financial Services"
// company a lender, so an asset manager / fintech / broker read "n/a (lender)" twice; E2E and MAPROIN had no D/E in the snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finSubKind, leverageTone } from '../fin-kind';
import { deTileView, deCellFor } from '../de-tile';
import { cashTileView } from '../india-eo-card-data';
import { finFallbackFromRaw, fallbackRatio } from '../fin-fallback';

const row = (industry: string, broad: string, company: string, extra: any = {}) => ({ sector: 'Financial Services', industry, broad_industry: broad, company, fin_kind: 'lender', ...extra });
const CRAMC = row('Asset Management Company', 'Capital Markets', 'Canara Robeco Asset Management Company Ltd', { grade_input: { cash_fy: 'Mar 2026', ocf_annual_cr: 172, pat_annual_cr: 204 } });
const MPI = row('Financial Technology (Fintech)', 'Financial Technology (Fintech)', 'Manipal Payment and Identity Solutions Ltd', { grade_input: {} });
const GROWW = row('Stockbroking & Allied', 'Capital Markets', 'Billionbrains Garage Ventures Ltd', { grade_input: { cash_fy: 'Mar 2026', ocf_annual_cr: -21, pat_annual_cr: 2083 } });
const HDBFS = row('Non Banking Financial Company (NBFC)', 'Finance', 'HDB Financial Services Ltd', { grade_input: { cash_fy: 'Mar 2026', ocf_annual_cr: -8606, pat_annual_cr: 2544 } });
const AXIS = row('Private Sector Bank', 'Banks', 'Axis Bank Ltd');

test('kinds of financial company from the industry words', () => {
  assert.equal(finSubKind(CRAMC, true), 'asset-light');
  assert.equal(finSubKind(MPI, true), 'asset-light');
  assert.equal(finSubKind(GROWW, true), 'broker');
  assert.equal(finSubKind(HDBFS, true), 'nbfc');
  assert.equal(finSubKind(AXIS, true), 'bank');
  assert.equal(finSubKind(row('Small Finance Bank', 'Banks', 'Ujjivan Small Finance Bank Ltd'), true), 'bank');
  assert.equal(finSubKind({ company: 'Yes Bank Ltd' }, true), 'bank');
  assert.equal(finSubKind({ company: 'Paushak Ltd', industry: 'Specialty Chemicals' }, false), null);
  assert.equal(leverageTone(4.8), 'warn');
});

test('cash tile: asset manager gets the real ratio; NBFC / broker show their figures; bank without figures says so', () => {
  const c = cashTileView(CRAMC);
  assert.equal(c.text, '0.84x'); assert.match(c.note, /partly cash-backed · not part of the grade/); assert.equal(c.basis, 'Mar 2026 full year');
  const h = cashTileView(HDBFS);
  assert.equal(h.text, '-3.38x'); assert.equal(h.note, 'lender · not graded'); assert.equal(h.color, 'none');   // zzz1094 — a plain ratio like every card
  assert.match(cashTileView(GROWW).note, /broker/);
  assert.equal(cashTileView(AXIS).text, 'n/a (bank)');
  // fintech with nothing in the feed: the company page's figures fill it
  assert.equal(cashTileView(MPI, { cfo: 90, pat: 100, fy: 'Mar 2026' }).text, '0.90x');
  // a non-financial with no ratio in the feed: the page figures give one
  assert.equal(cashTileView({ company: 'Mapro Industries Ltd' }, { cfo: 3, pat: 2, fy: 'Mar 2026' }).text, '1.50x');
});

test('D/E tile: bank n/a, NBFC as leverage, asset-light as a normal company, fallback when the snapshot has none', () => {
  // zzz1091 — a bank shows its borrowings figure (deposits not counted), neutral; '—' only when there is none
  assert.equal(deTileView(AXIS, { de: 1.3, basis: 'fiscal year' }).text, '1.30×');
  assert.equal(deTileView(AXIS, { de: 1.3, basis: 'fiscal year' }).tone, 'none');
  assert.match(deTileView(AXIS, { de: 1.3, basis: 'fiscal year' }).sub, /borrowings excl\. deposits/);
  assert.equal(deTileView(AXIS, null, { de: null, deBasis: null, error: 'x' }).text, '—');
  const h = deTileView(HDBFS, { de: 4.8, basis: 'fiscal year' });
  assert.equal(h.text, '4.80×'); assert.equal(h.tone, 'warn'); assert.match(h.sub, /NBFC \/ lender leverage/);
  assert.equal(deTileView(CRAMC, { de: 0.02, basis: 'latest quarter' }).text, 'debt-free');
  const e2e = deTileView({ company: 'E2E Networks Ltd', industry: 'IT Enabled Services' }, null, { de: 0.12, deBasis: 'balance sheet Mar 2026' });
  assert.equal(e2e.text, '0.12×'); assert.match(e2e.title, /screener\.in page/);
  assert.equal(deTileView({ company: 'X Ltd' }, null, { de: null, deBasis: null, pending: true }).text, '…');
  assert.equal(deTileView({ company: 'X Ltd' }, null, { de: null, deBasis: null, error: 'no answer' }).sub, 'no balance sheet found');
  assert.equal(deCellFor(4.8, 'fiscal year', HDBFS, true).text, '4.80× lev.');
  assert.equal(deCellFor(0.5, 'fiscal year', AXIS, true).text, '0.50× bank');
  assert.equal(deCellFor(null, 'fiscal year', AXIS, true).text, 'n/a (bank)');
  // a bank's cash: the company-page figures are shown, never as a cash test
  assert.equal(cashTileView(AXIS, { cfo: -5000, pat: 26000, fy: 'Mar 2026' }).text, '-0.19x');
  assert.equal(cashTileView(AXIS, { cfo: -5000, pat: 26000, fy: 'Mar 2026' }).note, 'bank · not graded');
});

test('company-page reader: latest balance sheet and the same-year CFO / profit', () => {
  const raw: any = { T: {
    bs: { headers: ['Mar 2025', 'Mar 2026', 'Sep 2026'], rows: { 'Equity Capital': [10, 10, 10], Reserves: [90, 110, 130], Borrowings: [20, 30, 14] } },
    cf: { headers: ['Mar 2025', 'Mar 2026'], rows: { 'Cash from Operating Activity +': [5, 40] } },
    a: { headers: ['Mar 2025', 'Mar 2026', 'TTM'], rows: { 'Net Profit +': [8, 25, 30] } },
  } };
  // screener.in row labels carry a "+" — the reader matches exact labels, so give the plain ones too
  raw.T.cf.rows['Cash from Operating Activity'] = raw.T.cf.rows['Cash from Operating Activity +'];
  raw.T.a.rows['Net Profit'] = raw.T.a.rows['Net Profit +'];
  const f = finFallbackFromRaw(raw);
  assert.equal(f.de, 0.1); assert.equal(f.deBasis, 'balance sheet Sep 2026');
  assert.deepEqual([f.cfo, f.pat, f.fy], [40, 25, 'Mar 2026']);
  assert.equal(fallbackRatio(f), 1.6);
  assert.equal(fallbackRatio({ cfo: 5, pat: -2 }), null);
});

test('wiring: page reads the fallback; route exists', () => {
  const p = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities', 'page.tsx'), 'utf8');
  assert.match(p, /useFinFallbackIndex\(fbTickers.out, fbTickers.names\)/);
  assert.match(readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'fin-fallback', 'route.ts'), 'utf8'), /screener_store/);
});

// zzz1090 — India / USA Technicals list as a company list in the Stock Screener and the Pine Screener
import { techSymbolsFromCsv, csvCells } from '../screener/tech-lists';
import { universeOptions, universeSet } from '../screener/universe-scope';
test('1090: Technicals CSV split by exchange; offered as a company list in both screeners', () => {
  assert.deepEqual(csvCells('a,"b, c",d'), ['a', 'b, c', 'd']);
  const csv = 'Symbol,Exchange,Description\nNVDA,NASDAQ,"Nvidia, Corp"\nHAL,NSE,Hindustan Aero\nHAL,NYSE,Halliburton\nNSE:KPIL,NSE,x';
  assert.deepEqual(techSymbolsFromCsv(csv, 'IN'), ['HAL', 'KPIL']);
  assert.deepEqual(techSymbolsFromCsv(csv, 'US'), ['NVDA', 'HAL']);
  const src = { chartLists: [], standalone: [], portfolio: [], cb: [], tech: ['HAL', 'KPIL'], techSource: 'tab' as const };
  assert.ok(universeOptions('IN', src).some((o) => o.id === 'tech' && o.label === 'India Technicals list' && o.count === 2));
  assert.ok(universeOptions('US', src).some((o) => o.id === 'tech' && o.label === 'USA Technicals list'));
  assert.deepEqual([...universeSet('tech', 'IN', src).set!].sort(), ['HAL', 'KPIL']);
  assert.equal(universeSet('tech', 'IN', { ...src, tech: null }).waiting, true);
  const pine = readFileSync(join(__dirname, '..', '..', 'components', 'pine-screener', 'PineScreener.tsx'), 'utf8');
  assert.match(pine, /<option value="tech">/);
  assert.match(readFileSync(join(__dirname, '..', '..', 'components', 'stock-screener', 'StockScreener.tsx'), 'utf8'), /loadTechListServer\(market/);
});

// zzz1091 — the page must not send cards to the company page before the snapshot answered, and requests are never cancelled
test('1091: no fallback storm, no cancelled requests', () => {
  const p = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'earnings-opportunities', 'page.tsx'), 'utf8');
  assert.match(p, /const noDe = deAnswered\.has\(t\) && !deIdx\[t\]/);
  const h = readFileSync(join(__dirname, '..', 'use-debt-equity.ts'), 'utf8');
  const fb = h.slice(h.indexOf('function askFallback'));
  assert.doesNotMatch(fb, /ctrl\.abort\(\)/, 'fallback requests are not aborted when the card list grows');
  assert.match(fb, /_fbInflight/);
});
