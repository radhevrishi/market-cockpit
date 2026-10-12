// N-05 total-return arithmetic, N-06 axis-tag text colour, origin-aware screener review queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backAdjustDividends, backAdjustDividendsDetailed, TOTAL_RETURN_LABEL, type Bar } from '../chart-math';
import { blendOver, contrast, textOnColor } from '../readable-color';
import {
  CHART_REVIEW_QUEUE_KEY, marketOfExchange, parseQueue, queueIndex, readQueue, reviewFromUrl, reviewPosition, safeReturnUrl, stepQueue,
} from '../chart-review-queue';

const day = (i: number) => Date.UTC(2026, 0, 5 + i);
const bar = (i: number, c: number): Bar => ({ t: day(i), o: c, h: c, l: c, c, v: 1 });
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// ── N-05 ──────────────────────────────────────────────────────────────────────
test('N-05: prev close 100, ex-date close 110, dividend 10 → exactly +20% (wealth 120 per 100 invested)', () => {
  // Independent wealth arithmetic: 1 share at 100; on the ex-date it is worth 110 plus 10 cash; the 10 buys 10/110 more
  // shares at the ex-date close → 1 + 1/11 shares × 110 = 120.
  const shares = 1 + 10 / 110;
  const wealth = shares * 110;
  near(wealth, 120);
  const out = backAdjustDividends([bar(0, 100), bar(1, 110)], [{ t: day(1), amount: 10 }]);
  assert.equal(out[1].c, 110, 'latest price unchanged');
  near(out[1].c / out[0].c - 1, wealth / 100 - 1);   // chart return = wealth return = 20%
  near(out[1].c / out[0].c - 1, 0.2);
  near(out[0].c, 100 * 110 / 120);
});

test('N-05: two dividends compound — chart return equals buy-and-reinvest wealth', () => {
  const closes = [50, 52, 49, 51, 55, 54];
  const divs = [{ t: day(2), amount: 2 }, { t: day(4), amount: 1.5 }];
  const out = backAdjustDividends(closes.map((c, i) => bar(i, c)), divs);
  // simulate a holder from the first close: dividends reinvested at the ex-date close
  let shares = 1;
  for (let i = 1; i < closes.length; i++) {
    const d = divs.find((x) => x.t === day(i));
    if (d) shares += (shares * d.amount) / closes[i];
  }
  const wealthReturn = (shares * closes[closes.length - 1]) / closes[0] - 1;
  near(out[out.length - 1].c / out[0].c - 1, wealthReturn, 1e-12);
  // between the two ex-dates only the second factor applies
  near(out[2].c, 49 * (55 / 56.5));
  near(out[0].c, 50 * (49 / 51) * (55 / 56.5));
  assert.equal(out[5].c, 54);
});

test('N-05: no ex-date bar (or a missing close) falls back to the previous-close factor and is flagged', () => {
  const bars = [bar(0, 100), bar(1, 100), bar(3, 102)];   // no bar on day 2
  const r = backAdjustDividendsDetailed(bars, [{ t: day(2), amount: 4 }]);
  assert.equal(r.fallbacks.length, 1);
  assert.equal(r.fallbacks[0].reason, 'no-ex-date-bar');
  near(r.bars[1].c, 100 * (1 - 4 / 100));
  assert.equal(r.bars[2].c, 102);
  const zero = backAdjustDividendsDetailed([bar(0, 100), { ...bar(1, 0) }], [{ t: day(1), amount: 4 }]);
  assert.equal(zero.fallbacks[0]?.reason, 'ex-close-missing');
  const none = backAdjustDividendsDetailed([bar(0, 100)], [{ t: day(0), amount: 1 }]);
  assert.equal(none.skipped, 1, 'nothing before the first bar to adjust');
});

test('N-05: the total-return wording is exact and used by the route and the chart page', () => {
  assert.equal(TOTAL_RETURN_LABEL, 'Total return — dividends reinvested at the ex-date close (chart adjustment, not an investment-account record)');
  const route = readFileSync(new URL('../../app/api/v1/chart/[ticker]/route.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(route, /TOTAL_RETURN_LABEL/);
  assert.match(route, /'tr2'/, 'server cache key bumped for the new factor');
  assert.match(page, /TOTAL_RETURN_LABEL/);
  assert.match(page, /&basis=tr&adj=2/, 'browser URL changes so an old cached answer is never reused');
  assert.doesNotMatch(page, /as if reinvested/);
});

// ── N-06 ──────────────────────────────────────────────────────────────────────
test('N-06: tag text is black on yellow, white on dark blue, and always ≥ 4.5:1', () => {
  assert.equal(textOnColor('#FFD600'), '#000000');
  assert.equal(textOnColor('#1E3A8A'), '#FFFFFF');
  assert.ok((contrast('#FFFFFF', '#FFD600') ?? 0) < 1.5, 'the old white-on-yellow tag');
  for (const c of ['#FFD600', '#1E3A8A', '#2962FF', '#F59E0B', '#089981', '#F23645', '#7E57C2', '#787B86', '#FF6D00', '#B2B5BE', '#000000', '#FFFFFF']) {
    assert.ok((contrast(textOnColor(c), c) ?? 0) >= 4.5, c);
  }
});

test('N-06: semi-transparent volume colours are judged on the page background; one text for up and down tags', () => {
  assert.equal(blendOver('rgba(8,153,129,0.5)', '#FFFFFF'), '#84ccc0');
  assert.equal(textOnColor('rgba(8,153,129,0.5)', '#FFFFFF'), '#000000');
  const both = textOnColor(['#089981', '#F23645']);
  assert.ok(Math.min(contrast(both, '#089981') ?? 0, contrast(both, '#F23645') ?? 0) >= 4.5);
});

test('N-06: the library tags (one white text for all lines) are off and the per-tag overlay is used instead', () => {
  const page = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  const setup = readFileSync(new URL('../../components/charts/kline-setup.ts', import.meta.url), 'utf8');
  assert.match(page, /lastValueMark: \{ show: false \}/);
  assert.match(page, /name: 'mcLastValues'/);
  assert.match(setup, /name: 'mcLastValues'/);
  assert.match(setup, /textOnColor\(color, page\)/);
  assert.doesNotMatch(setup, /color: '#ffffff', backgroundColor: c/);
});

// ── origin-aware review ───────────────────────────────────────────────────────
const queue = {
  origin: 'screener', label: 'Momentum leaders', returnUrl: '/stock-screener?s=abc', at: 1,
  items: [{ symbol: 'NVDA', exchange: 'NASDAQ', name: 'NVIDIA' }, { symbol: 'TATVA', exchange: 'BSE' }, { symbol: 'TATVA', exchange: 'NSE' }, { symbol: 'shyammetl', exchange: 'NSE' }],
};
const store = (v: unknown) => ({ getItem: (k: string) => (k === CHART_REVIEW_QUEUE_KEY ? (typeof v === 'string' ? v : JSON.stringify(v)) : null) });

test('review queue: read, validate, and survive broken storage', () => {
  const q = readQueue(store(queue));
  assert.ok(q);
  assert.equal(q.items.length, 4);
  assert.equal(q.items[3].symbol, 'SHYAMMETL');
  assert.equal(readQueue(store('{not json')), null);
  assert.equal(readQueue(store({ ...queue, origin: 'watchlist' })), null);
  assert.equal(readQueue(store({ ...queue, items: [] })), null);
  assert.equal(readQueue({ getItem: () => { throw new Error('SecurityError'); } }), null);
  assert.equal(readQueue(null), null);
  assert.equal(parseQueue({ ...queue, returnUrl: 'https://evil.example/x' })?.returnUrl, '/stock-screener');
  assert.equal(safeReturnUrl('//evil.example'), '/stock-screener');
  assert.equal(safeReturnUrl('/stock-screener?s=1'), '/stock-screener?s=1');
  assert.equal(marketOfExchange('nse'), 'IN');
  assert.equal(marketOfExchange('NYSE'), 'US');
});

test('review queue: steps through the screener list, exchange-aware, no wrap', () => {
  const q = parseQueue(queue)!;
  assert.equal(queueIndex(q, 'TATVA', 'NSE', 'IN'), 2);
  assert.equal(queueIndex(q, 'TATVA', 'BSE', 'IN'), 1);
  assert.equal(queueIndex(q, 'TATVA', undefined, 'IN'), 1);
  assert.deepEqual(stepQueue(q, 'NVDA', undefined, 1, -1, 'US'), { index: 1, target: { market: 'IN', ticker: 'TATVA', exchange: 'BSE' } });
  assert.deepEqual(stepQueue(q, 'TATVA', 'NSE', 1, -1, 'IN')?.target, { market: 'IN', ticker: 'SHYAMMETL', exchange: 'NSE' });
  assert.deepEqual(stepQueue(q, 'TATVA', 'BSE', -1, -1, 'IN')?.target, { market: 'US', ticker: 'NVDA', name: 'NVIDIA' });
  assert.equal(stepQueue(q, 'NVDA', undefined, -1, -1, 'US'), null);
  assert.equal(stepQueue(q, 'SHYAMMETL', 'NSE', 1, -1, 'IN'), null);
  // a symbol picked by hand mid-review: step from the last reviewed position
  assert.equal(stepQueue(q, 'AAPL', undefined, 1, 1, 'US')?.index, 2);
  assert.deepEqual(reviewPosition(q, 'TATVA', 'NSE', 'IN'), { position: 3, total: 4 });
  assert.deepEqual(reviewPosition(q, 'AAPL', undefined, 'US'), { position: null, total: 4 });
});

test('review queue: on only with the URL flag and the current symbol in the stored list', () => {
  assert.ok(reviewFromUrl('screener', store(queue), 'NVDA', 'NASDAQ', 'US'));
  assert.equal(reviewFromUrl(null, store(queue), 'NVDA', 'NASDAQ', 'US'), null);
  assert.equal(reviewFromUrl('screener', store(queue), 'AAPL', 'NASDAQ', 'US'), null);
  assert.equal(reviewFromUrl('screener', { getItem: () => null }, 'NVDA', 'NASDAQ', 'US'), null);
});
