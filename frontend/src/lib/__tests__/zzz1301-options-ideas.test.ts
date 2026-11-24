import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSetups, SETUP_META, MIN_RR } from '../options-ideas/setups';
import { bs, planOption, pickExpiry, syntheticExpiries, syntheticStrikes } from '../options-ideas/options';
import { classify, type RawFeatures } from '../options-ideas/model';
import { parseNseChain, nseDateIso, parseLots } from '../options-ideas/chain';
import { simulate } from '../options-ideas/backtest';
import { STUDY } from '../options-ideas/model-coeffs';
import { HUBS } from '../nav-hubs';

const raw: number[][] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'options-ideas-aapl.json'), 'utf8'));
const bars = raw.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

test('zzz1301 — setups found on real bars carry a full, consistent plan', () => {
  const s = findSetups(bars);
  assert.ok(s.length >= 1, 'a setup on the fixture day');
  for (const x of s) {
    assert.equal(x.side, SETUP_META[x.id].side);
    const call = x.side === 'CALL';
    assert.ok(call ? x.stop < x.entry && x.target1 > x.entry && x.target2 >= x.target1 : x.stop > x.entry && x.target1 < x.entry && x.target2 <= x.target1);
    assert.ok(x.rr1 >= MIN_RR - 0.05);
    assert.ok(x.quality >= 0 && x.quality <= 100);
    assert.ok(x.lines.length >= 1);
  }
});

test('zzz1301 — no look-ahead: a setup depends only on bars up to its day', () => {
  const a = findSetups(bars.slice(0, -30));
  const b = findSetups(bars.slice(0, -30).concat([]));
  assert.deepEqual(a, b);
  assert.deepEqual(findSetups(bars.slice(0, 100)), []); // too little history
});

test('zzz1301 — Black–Scholes sanity and put–call parity', () => {
  const c = bs(100, 100, 0.25, 0.04, 0.3, true), p = bs(100, 100, 0.25, 0.04, 0.3, false);
  assert.ok(Math.abs(c.price - p.price - (100 - 100 * Math.exp(-0.04 * 0.25))) < 1e-6);
  assert.ok(c.delta > 0.5 && c.delta < 0.6 && p.delta < 0 && p.delta > -0.5);
  assert.equal(bs(110, 100, 0, 0.04, 0.3, true).price, 10);
});

test('zzz1301 — expiries: US Fridays, India last Tuesday; expiry rule ≥ 30 days', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const us = syntheticExpiries('US', now), inn = syntheticExpiries('IN', now);
  assert.ok(us.every((d) => [4, 5].includes(new Date(d + 'T12:00:00Z').getUTCDay())));
  assert.ok(!us.includes('2026-12-25') && us.includes('2026-12-24')); // Christmas Friday → Thursday
  assert.ok(inn.every((d) => [1, 2].includes(new Date(d + 'T12:00:00Z').getUTCDay())));
  assert.ok(inn.includes('2027-01-25')); // 26 Jan (Republic Day) → Monday
  assert.equal(inn[0], '2026-12-29'); // 24 Nov is today's (last Tuesday) expiry — excluded
  const p = pickExpiry(us, now, 12, 30)!;
  assert.ok(Math.round((Date.parse(p.expiry) - now.getTime()) / 86400000) >= 29);
  assert.ok(syntheticStrikes('US', 101).includes(100));
});

test('zzz1301 — option plan: delta near 0.5, a safer and an aggressive choice, values at T1 / stop', () => {
  const closes = bars.slice(-90).map((b) => b.c);
  const spot = closes[closes.length - 1];
  const o = planOption({ market: 'US', call: true, spot, entry: spot, stop: spot * 0.95, target1: spot * 1.1, target2: spot * 1.18, expSessions: 12, closes, now: new Date('2026-11-24T12:00:00Z') })!;
  assert.ok(o);
  assert.ok(Math.abs(Math.abs(o.delta) - 0.5) < 0.12);
  assert.ok(o.dte >= 29);
  assert.ok(o.atTarget1.retPct > 0 && o.atStop.retPct < 0);
  assert.equal(o.contractSize, 100);
  assert.ok(o.safer && Math.abs(o.safer.delta) > Math.abs(o.delta));
  assert.ok(o.aggressive && Math.abs(o.aggressive.delta) < Math.abs(o.delta));
  assert.ok(o.notes.some((n) => /model price/.test(n)));
  // India: the lot size is the contract
  const i = planOption({ market: 'IN', call: false, spot: 1000, entry: 1000, stop: 1040, target1: 920, target2: 880, expSessions: 12, closes: closes.map((c) => c * 5), now: new Date('2026-11-24T12:00:00Z'), lotSize: 550 })!;
  assert.equal(i.contractSize, 550);
  assert.equal(i.type, 'PUT');
});

test('zzz1301 — grades follow the study rules (calls: stock + market + near target; puts never A)', () => {
  const f = (o: Partial<RawFeatures>): RawFeatures => ({ id: 'trend_bounce', side: 'CALL', market: 'US', ret20: 3, ret60: 15, vs50: 4, vs200: 12, trend: 1, touches: 3, vr: 1, rr1: 2, riskPct: 4, atrPct: 2, triggered: false, idx: { vs200: 5, ret20: 2, ret60: 6 }, ...o });
  assert.equal(classify(f({})).grade, 'A');
  assert.equal(classify(f({ rr1: 4 })).grade, 'B');
  assert.equal(classify(f({ idx: { vs200: -3, ret20: -2, ret60: -5 } })).grade, 'B');
  assert.equal(classify(f({ vs200: -5, ret60: -10, idx: { vs200: -3, ret20: -2, ret60: -5 } })).grade, 'C');
  assert.notEqual(classify(f({ id: 'trend_breakdown', side: 'PUT', vs200: -10, ret60: -20, idx: { vs200: -4, ret20: -3, ret60: -6 } })).grade, 'A');
});

test('zzz1301 — NSE chain + lot-size parsing', () => {
  assert.equal(nseDateIso('25-Nov-2026'), '2026-11-25');
  const c = parseNseChain({ records: { data: [{ strikePrice: 100, expiryDate: '30-Dec-2026', CE: { bidprice: 5, askPrice: 5.4, impliedVolatility: 32, openInterest: 1200, totalTradedVolume: 300, lastPrice: 5.2 }, PE: { bidprice: 3, askPrice: 3.3, impliedVolatility: 30, openInterest: 900, totalTradedVolume: 100 } }] } })!;
  assert.deepEqual(c.expiries, ['2026-12-30']);
  assert.equal(c.byExpiry['2026-12-30'].calls[0].iv, 0.32);
  assert.equal(parseLots('UNDERLYING,SYMBOL,DEC-26\nNIFTY 50,NIFTY,65\nDIXON TECHNOLOGIES,DIXON,50\n').DIXON, 50);
});

test('zzz1301 — simulate: stop first on a bar that touches both', () => {
  const b = [...bars.slice(0, 300)];
  const t = 299;
  const px = b[t].c;
  const fut = [{ t: b[t].t + 86400000, o: px, h: px * 1.2, l: px * 0.9, c: px, v: 1 }];
  const s: any = { id: 'trend_bounce', side: 'CALL', triggered: true, trigger: px, entry: px, stop: px * 0.95, target1: px * 1.1, target2: px * 1.2, quality: 50, rr1: 2, riskPct: 5, evidence: {} };
  const r = simulate([...b, ...fut], t, s, 'US', 'X');
  assert.ok(r && r !== 'nofill' && r.outcome === 'stop');
});

test('zzz1301 — study numbers present; grade A calls positive before and after the hold-out; page is in a hub', () => {
  const a = STUDY.groups['ALL|CALL|A'];
  assert.ok(a && a.n > 500 && a.trainR > 0 && a.testR > 0);
  assert.ok(STUDY.groups['ALL|PUT|C'].trailR < 0);
  assert.ok(HUBS.some((h) => h.tabs.some((t) => t.href === '/options-ideas')));
});

test('zzz1301 — chain outside market hours (bid = ask = 0): real strikes / expiry, model price, said so', () => {
  const closes = Array.from({ length: 90 }, (_, i) => 30 + Math.sin(i / 5));
  const ex = '2026-12-31';
  const q = (k: number) => ({ strike: k, bid: 0, ask: 0, last: 0.2, iv: 0.2500075, oi: 0, volume: 1 });
  const chain = { expiries: ['2026-11-27', ex], byExpiry: { [ex]: { calls: [27, 28, 29, 30, 31, 32, 33].map(q), puts: [] } }, source: 'test', asOf: null };
  const o = planOption({ market: 'US', call: true, spot: 30, entry: 30, stop: 28.5, target1: 33, target2: 35, expSessions: 12, closes, now: new Date('2026-11-24T12:00:00Z'), chain })!;
  assert.equal(o.expiry, ex);
  assert.ok([27, 28, 29, 30, 31, 32, 33].includes(o.strike));
  assert.equal(o.premiumSource, 'model');
  assert.ok(o.notes.some((n) => /no live bid \/ ask/.test(n)));
});
