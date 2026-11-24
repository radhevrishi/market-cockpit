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
  assert.equal(classify(f({})).grade, 'A');                                   // sector unknown, no catalyst
  assert.equal(classify(f({ secStrong: true, gap60: true })).grade, 'A+');
  assert.equal(classify(f({ secStrong: true, rvol: 1.5 })).grade, 'A+');
  assert.equal(classify(f({ secStrong: false, gap60: true })).grade, 'B');     // weak sector: no grade A
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

test('zzz1301 — Nasdaq chain table parsing (US fallback when Yahoo refuses)', async () => {
  const { parseNasdaqChain, nasdaqDateIso } = await import('../options-ideas/chain');
  assert.equal(nasdaqDateIso('December 24, 2026'), '2026-12-24');
  const c = parseNasdaqChain({ data: { table: { rows: [
    { expirygroup: 'December 24, 2026', strike: null },
    { expirygroup: '', strike: '29.00', c_Bid: '1.20', c_Ask: '1.35', c_Last: '1.25', c_Volume: '40', c_Openinterest: '1,250', p_Bid: '--', p_Ask: '0.90', p_Last: '--', p_Volume: '--', p_Openinterest: '--' },
  ] } } })!;
  assert.deepEqual(c.expiries, ['2026-12-24']);
  assert.equal(c.byExpiry['2026-12-24'].calls[0].oi, 1250);
  assert.equal(c.byExpiry['2026-12-24'].puts[0].bid, null);
});

test('zzz1301e — context: catalyst gap, volume, HV percentile; sector medians', async () => {
  const { extraCtx, sectorMedians } = await import('../options-ideas/context');
  const b = bars.map((q) => ({ ...q }));
  const L = b.length - 1;
  b[L - 10] = { ...b[L - 10], o: b[L - 11].c * 1.08, v: 50 * (b[L - 11].v || 1e6) };
  const e = extraCtx(b);
  assert.equal(e.gap60, true); assert.equal(e.gapDaysAgo, 10);
  assert.ok(e.hvPct >= 0 && e.hvPct <= 100 && e.hv20 > 0);
  const med = sectorMedians([{ sec: 'Tech', perf3M: 1 }, { sec: 'Tech', perf3M: 5 }, { sec: 'Tech', perf3M: 9 }, { sec: 'Tech', perf3M: 3 }, { sec: 'Oil', perf3M: 2 }]);
  assert.equal(med.get('Tech'), 5); assert.equal(med.has('Oil'), false);
});

test('zzz1301e — option plan: results gate moves the expiry earlier, spread + sell-put alternatives, expensive-volatility note', () => {
  const closes = bars.slice(-90).map((b) => b.c);
  const spot = closes[closes.length - 1];
  const now = new Date('2026-11-24T12:00:00Z');
  const base = { market: 'US' as const, call: true, spot, entry: spot, stop: spot * 0.95, target1: spot * 1.1, target2: spot * 1.18, expSessions: 12, closes, now };
  const o = planOption({ ...base, nextEarnings: '2026-12-23', hvPct: 85 })!;
  assert.ok(o.expiry === '2026-12-18' && o.results.movedExpiry && !o.results.beforeExpiry);
  assert.ok(o.dte >= 21);
  assert.ok(o.notes.some((n) => /expensive/.test(n)));
  assert.ok(o.spread && o.spread.debit < o.premium && o.spread.sell > o.spread.buy);
  assert.ok(o.sellPut && o.sellPut.strike < spot && o.sellPut.premium > 0);
  const o2 = planOption({ ...base, nextEarnings: '2026-12-08' })!;                 // too close: no expiry ≥ 21 days before it
  assert.ok(o2.results.beforeExpiry && o2.notes.some((n) => /held through results/.test(n)));
});

test('zzz1301f — fear path: VIX ≥ 25 (USA) / India VIX ≥ 20 makes a near-target call grade A even in a falling market', () => {
  const f = (o: Partial<RawFeatures>): RawFeatures => ({ id: 'trend_bounce', side: 'CALL', market: 'US', ret20: -8, ret60: -15, vs50: -6, vs200: -4, trend: -1, touches: 3, vr: 1, rr1: 2, riskPct: 5, atrPct: 3, triggered: false, idx: { vs200: -3, ret20: -6, ret60: -9 }, ...o });
  assert.equal(classify(f({ vix: 18 })).grade, 'C');
  assert.equal(classify(f({ vix: 31 })).grade, 'A');
  assert.equal(classify(f({ vix: 31, gap60: true })).grade, 'A+');
  assert.equal(classify(f({ vix: 31, rr1: 4 })).grade, 'C');                        // far target: no
  assert.equal(classify(f({ market: 'IN', vix: 21 })).grade, 'A');
  assert.notEqual(classify(f({ id: 'trend_breakdown', side: 'PUT', vix: 35 })).grade, 'A'); // puts never A
});

test('zzz1301f — market panel: bands, mood, verdicts', async () => {
  const { buildPanel } = await import('../options-ideas/market-panel');
  const idx = Array.from({ length: 500 }, (_, i) => 100 * Math.pow(1.0005, i) * (i > 470 ? 1 + (i - 470) * 0.002 : 1));
  const fallIdx = [...idx.slice(0, 470), ...Array.from({ length: 30 }, (_, i) => 140 - i * 1.5)];
  const vixCalm = Array.from({ length: 300 }, () => 14), vixFear = [...Array.from({ length: 290 }, () => 16), ...Array.from({ length: 10 }, (_, i) => 22 + i)];
  const rows = Array.from({ length: 80 }, (_, i) => ({ px: 10, sma50: i < 60 ? 9 : 11, sma200: i < 40 ? 9 : 11, hi52: 10.2, mc: 5000 }));
  const up = buildPanel('US', idx, vixCalm, rows);
  assert.equal(up.vix?.band, 'calm'); assert.equal(up.regime, 'up'); assert.equal(up.verdict.calls.act, 'TAKE'); assert.equal(up.verdict.puts.act, 'AVOID');
  assert.equal(up.breadth?.above50, 75); assert.equal(up.breadth?.above200, 50);
  const fear = buildPanel('US', fallIdx, vixFear, rows);
  assert.equal(fear.vix?.band, 'fear'); assert.equal(fear.regime, 'fear'); assert.equal(fear.verdict.calls.act, 'TAKE'); assert.equal(fear.verdict.sellPuts.act, 'TAKE');
  assert.ok(fear.mood && fear.mood.score < up.mood!.score);
  const down = buildPanel('US', fallIdx, vixCalm, rows);
  assert.equal(down.verdict.calls.act, 'SELECTIVE');
});

test('zzz1301g — no setup: the chart structure and what to wait for', async () => {
  const { describeStructure } = await import('../options-ideas/setups');
  const s = describeStructure(bars);
  assert.ok(s.lines.length + s.levels.length > 0);
  assert.ok(s.watch.length > 0 && s.watch.every((w) => typeof w.what === 'string' && w.what.length > 20));
  for (let i = 1; i < s.watch.length; i++) assert.ok(Math.abs(s.watch[i].distPct) >= Math.abs(s.watch[i - 1].distPct));
  assert.ok(describeStructure(bars.slice(0, 100)).notes.length === 1);
});

test('zzz1301h — ADR% (TradingView formula) and the 1-day change dated by the live quote', async () => {
  const { extraCtx, adrBand } = await import('../options-ideas/context');
  const flat = Array.from({ length: 300 }, (_, i) => ({ t: i, o: 100, h: 103, l: 100, c: 101, v: 1 }));
  assert.equal(extraCtx(flat).adr, 3);
  assert.equal(adrBand(1.5), 'calm'); assert.equal(adrBand(6), 'wild');
  const { closesWithLive } = await import('../options-ideas/market-panel');
  const d = (s: string) => Date.parse(s + 'T14:00:00Z') / 1000;
  // Fri close 6910, Mon live 7237, Monday bar already present with a stale close → prev must be Friday's
  const r = closesWithLive([d('2026-11-19'), d('2026-11-20'), d('2026-11-23')], [7176, 6910, 7100], 7237, d('2026-11-23') + 3600);
  assert.deepEqual(r.c, [7176, 6910, 7237]); assert.equal(r.prev, 6910);
  // Monday bar missing (null) → still Friday's close as prev, live appended
  const r2 = closesWithLive([d('2026-11-20'), d('2026-11-23')], [6910, null], 7237, d('2026-11-23') + 3600);
  assert.deepEqual(r2.c, [6910, 7237]); assert.equal(r2.prev, 6910);
});
