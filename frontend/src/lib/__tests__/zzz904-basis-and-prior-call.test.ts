// zzz904 — (A) basis tags on fundamentals figures, (B) honest concall "vs previous call".
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferBasis, basisFromFieldName, basisForCandidates, combineBases, describeBasisMix, checkFieldLabel, latestFyLabel, makeBasis,
} from '../metric-basis';
import { comparePriorCall, findPriorCall, NO_PRIOR_MESSAGE, NO_TICKER_MESSAGE, type ConcallCorpus, type ConcallAnalysisLike } from '../concall-prior-compare';

const IN = { market: 'INDIA' as const, asOf: new Date('2026-10-06T00:00:00Z') };
const US = { market: 'USA' as const };

describe('inferBasis — TradingView headers', () => {
  const cases: Array<[string, string]> = [
    ['Revenue growth %, Annual YoY', 'FY'],
    ['Revenue growth %, Quarterly YoY', 'REPORTED'],
    ['Gross margin %, Trailing 12 months', 'TTM'],
    ['Gross margin %, TTM', 'TTM'],
    ['Earnings per share diluted growth %, TTM YoY', 'TTM'],
    ['Forward non-GAAP price to earnings, Annual', 'ESTIMATE'],
    ['Forward revenue growth %, FY1', 'ESTIMATE'],
    ['Revenue growth %, next year', 'ESTIMATE'],
    ['Earnings per share estimate, Annual', 'ESTIMATE'],
    ['Target price, 1 year', 'ESTIMATE'],
    ['Analyst Rating', 'ESTIMATE'],
    ['Price to earning to growth, Trailing 12 months', 'TTM'],
    ['Price to earnings ratio', 'TTM'],
    ['Price to book ratio', 'REPORTED'],
    ['Debt to equity ratio, Quarterly', 'REPORTED'],
    ['Free cash flow margin %, Annual', 'FY'],
    ['Performance %, 1 year', 'PRICE'],
    ['Beta, 5 years', 'PRICE'],
    ['Exponential moving average, 50, 1 day', 'PRICE'],
    ['Market capitalization', 'PRICE'],
    ['Management guidance revenue', 'GUIDED'],
  ];
  for (const [col, kind] of cases) test(`${col} → ${kind}`, () => assert.equal(inferBasis(col, US).kind, kind));

  test('5-year CAGR carries its span', () => {
    const b = inferBasis('Revenue growth %, 5 year CAGR', US);
    assert.equal(b.kind, 'FY');
    assert.equal(b.span, '5Y');
  });
  test('USA FY claims no year (company year-ends vary)', () => assert.equal(inferBasis('Revenue growth %, Annual YoY', US).label, 'FY'));
});

describe('inferBasis — Screener.in headers (India)', () => {
  test('"Sales growth" / "Profit growth" are last-full-year, not TTM', () => {
    assert.equal(inferBasis('Sales growth', IN).kind, 'FY');
    assert.equal(inferBasis('Sales growth', IN).label, 'FY26');
    assert.equal(inferBasis('Profit growth', IN).kind, 'FY');
  });
  test('quarterly / last-year / multi-year columns', () => {
    assert.equal(inferBasis('YOY Quarterly sales growth', IN).kind, 'REPORTED');
    assert.equal(inferBasis('OPM latest quarter', IN).kind, 'REPORTED');
    assert.equal(inferBasis('OPM last year', IN).kind, 'FY');
    const s3 = inferBasis('Sales growth 3Years', IN);
    assert.equal(s3.kind, 'FY'); assert.equal(s3.label, '3Y FY26');
  });
  test('ratios, holdings and market data', () => {
    assert.equal(inferBasis('Return on capital employed', IN).kind, 'FY');
    assert.equal(inferBasis('OPM', IN).kind, 'TTM');
    assert.equal(inferBasis('Price to Earning', IN).kind, 'TTM');
    assert.equal(inferBasis('PEG Ratio', IN).kind, 'DERIVED');
    assert.equal(inferBasis('Debt to equity', IN).kind, 'REPORTED');
    assert.equal(inferBasis('Promoter holding', IN).kind, 'REPORTED');
    const ch = inferBasis('Change in promoter holding 3Years', IN);
    assert.equal(ch.kind, 'REPORTED'); assert.equal(ch.span, '3Y');
    assert.equal(inferBasis('Return over 1year', IN).kind, 'PRICE');
    assert.equal(inferBasis('DMA 200', IN).kind, 'PRICE');
    assert.equal(inferBasis('Market Capitalization', IN).kind, 'PRICE');
  });
  test('silent header falls back to the field name', () => {
    assert.equal(inferBasis('Mystery column', { fieldName: 'opmTtm' }).kind, 'TTM');
    assert.equal(inferBasis('', { fieldName: 'fcfMarginAnn' }).kind, 'FY');
    assert.equal(inferBasis('Mystery column').kind, 'UNKNOWN');
  });
});

describe('latestFyLabel', () => {
  test('India: from June the just-ended March year is the latest', () => {
    assert.equal(latestFyLabel('INDIA', new Date('2026-10-06')), 'FY26');
    assert.equal(latestFyLabel('INDIA', new Date('2026-04-15')), 'FY25');
    assert.equal(latestFyLabel('INDIA', new Date('2026-06-02')), 'FY26');
  });
  test('USA / no date → no year claimed', () => {
    assert.equal(latestFyLabel('USA', new Date('2026-10-06')), '');
    assert.equal(latestFyLabel('INDIA'), '');
  });
});

describe('basisForCandidates mirrors the reader fallbacks', () => {
  test('first present column decides', () => {
    const h = ['Symbol', 'Piotroski F-score, Annual'];
    const b = basisForCandidates(h, ['Piotroski F-score, Trailing 12 months', 'Piotroski F-score, Annual'], US);
    assert.equal(b.kind, 'FY'); assert.equal(b.column, 'Piotroski F-score, Annual');
    const b2 = basisForCandidates(['Piotroski F-score, Trailing 12 months'], ['Piotroski F-score, Trailing 12 months', 'Piotroski F-score, Annual'], US);
    assert.equal(b2.kind, 'TTM');
  });
});

describe('combineBases / describeBasisMix', () => {
  test('same basis stays; mixed becomes DERIVED with parts', () => {
    const fy = inferBasis('Revenue growth %, Annual YoY', US), fcf = inferBasis('Free cash flow margin %, Annual', US);
    assert.equal(combineBases([fy, fcf]).kind, 'FY');
    const ttm = inferBasis('Earnings per share diluted growth %, TTM YoY', US);
    const d = combineBases([ttm, fy]);
    assert.equal(d.kind, 'DERIVED'); assert.deepEqual(d.parts, ['TTM', 'FY']);
  });
  test('verdict text says when it combines bases', () => {
    const txt = describeBasisMix([
      { name: 'revenue growth', basis: makeBasis('TTM') },
      { name: 'P/E', basis: inferBasis('Forward non-GAAP price to earnings, Annual', US) },
    ]);
    assert.equal(txt, 'uses TTM revenue growth with forward P/E');
  });
  test('three bases, grouped', () => {
    const txt = describeBasisMix([
      { name: 'ROIC', basis: inferBasis('Return on invested capital %, Annual', US) },
      { name: 'FCF margin', basis: inferBasis('Free cash flow margin %, Annual', US) },
      { name: 'net margin', basis: inferBasis('Net margin %, Trailing 12 months', US) },
      { name: 'P/E', basis: inferBasis('Forward P/E', US) },
    ]);
    assert.equal(txt, 'uses full-year ROIC and FCF margin with TTM net margin and forward P/E');
  });
  test('one accounting basis (+ market data) is not "mixed"', () => {
    assert.equal(describeBasisMix([
      { name: 'ROIC', basis: inferBasis('Return on invested capital %, Annual', US) },
      { name: '1Y return', basis: inferBasis('Performance %, 1 year', US) },
    ]), null);
    assert.equal(describeBasisMix([]), null);
  });
  test('India FY names the year', () => {
    const txt = describeBasisMix([
      { name: 'sales growth', basis: inferBasis('Sales growth', IN) },
      { name: 'OPM', basis: inferBasis('OPM latest quarter', IN) },
    ]);
    assert.equal(txt, 'uses FY26 sales growth with latest-quarter OPM');
  });
});

describe('checkFieldLabel — catches plainly mislabelled fields', () => {
  test('a "Fwd" PEG filled from a trailing column', () => {
    const r = checkFieldLabel('pegFwd', 'Price to earning to growth, Trailing 12 months', US);
    assert.equal(r.ok, false);
  });
  test('a "3yr" CAGR filled from the 5-year column', () => {
    const r = checkFieldLabel('revGrowth3yr', 'Revenue growth %, 5 year CAGR', US);
    assert.equal(r.ok, false); assert.match(r.reason || '', /5Y/);
  });
  test('an "Ann" gross margin filled from the TTM fallback', () => {
    assert.equal(checkFieldLabel('grossMarginAnn', 'Gross margin %, Trailing 12 months', US).ok, false);
  });
  test('consistent pairs pass', () => {
    assert.equal(checkFieldLabel('opmTtm', 'Operating margin %, Trailing 12 months', US).ok, true);
    assert.equal(checkFieldLabel('fcfMarginAnn', 'Free cash flow margin %, Annual', US).ok, true);
    assert.equal(checkFieldLabel('revenueGrowthQtr', 'Revenue growth %, Quarterly YoY', US).ok, true);
    assert.equal(basisFromFieldName('pegTtm').kind, 'TTM');
  });
});

// ─── (B) concall "vs previous call" ───────────────────────────────────────────
const call = (over: Partial<ConcallAnalysisLike>): ConcallAnalysisLike => ({
  ticker: 'ACME', length: 5000, tone: { score: 60, pos: 6, neg: 4, defensive: 2, label: 'Cautiously Optimistic' },
  guidance: [], numbers: [], themes: [], red_flags: [], generated_at: '2026-10-06T10:00:00Z', ...over,
});

describe('concall prior-call comparison', () => {
  test('no earlier call on file → honest message, no comparison', () => {
    const cur = call({});
    const r = comparePriorCall(cur, {}, null);
    assert.equal(r.status, 'NO_PRIOR');
    assert.equal((r as any).message, NO_PRIOR_MESSAGE);
    assert.equal(NO_PRIOR_MESSAGE, 'No earlier call on file — comparison starts with the next call');
  });
  test('no ticker → asks for one', () => {
    const r = comparePriorCall(call({ ticker: '' }), {}, null);
    assert.equal(r.status, 'NO_TICKER'); assert.equal((r as any).message, NO_TICKER_MESSAGE);
  });
  test('another company or a later analysis is not "previous"; the current entry is skipped', () => {
    const cur = call({});
    const corpus: ConcallCorpus = {
      self: { ticker: 'ACME', ts: Date.parse('2026-10-06T10:00:00Z'), result: cur },
      other: { ticker: 'BETA', ts: 1, result: call({ ticker: 'BETA', length: 4000, generated_at: '2026-07-01T00:00:00Z' }) },
      later: { ticker: 'ACME', ts: 2, result: call({ length: 4100, generated_at: '2026-11-01T00:00:00Z' }) },
    };
    assert.equal(findPriorCall(corpus, cur, 'self'), null);
    assert.equal(comparePriorCall(cur, corpus, 'self').status, 'NO_PRIOR');
  });
  test('same transcript analysed twice is not an earlier call', () => {
    const cur = call({});
    const corpus: ConcallCorpus = { dup: { ticker: 'acme', ts: 1, result: call({ generated_at: '2026-10-05T00:00:00Z' }) } };
    assert.equal(findPriorCall(corpus, cur, null), null);
  });
  test('earlier call compared: tone, guidance wording, guidance cuts, numbers, flags, themes', () => {
    const prior = call({
      length: 4200, generated_at: '2026-07-20T09:00:00Z',
      tone: { score: 78, pos: 9, neg: 1, defensive: 1 },
      guidance: [{ kind: 'expect', pct: '20%', snippet: 'We expect robust demand and strong growth of 20% next year' }],
      numbers: [{ metric: 'revenue', value: '20' }, { metric: 'margin', value: '18' }],
      themes: [{ theme: 'Capacity Expansion', mentions: 4 }],
      red_flags: [],
    });
    const older = call({ length: 3900, generated_at: '2026-04-20T09:00:00Z', tone: { score: 40 } });
    const cur = call({
      tone: { score: 55, pos: 5, neg: 5, defensive: 4 },
      guidance: [
        { kind: 'expect', pct: '12%', snippet: 'Demand is stable and we remain cautious; we expect growth of 12%' },
        { kind: 'cut', pct: '12%', snippet: 'We have lowered our guidance to 12% given pressure' },
      ],
      numbers: [{ metric: 'revenue', value: '12' }, { metric: 'margin', value: '18' }],
      themes: [{ theme: 'Demand Recovery', mentions: 2 }],
      red_flags: ['Working capital / cash flow strain'],
    });
    const corpus: ConcallCorpus = {
      a: { ticker: 'ACME', ts: 1, result: prior },
      b: { ticker: 'ACME', ts: 0, result: older },
      me: { ticker: 'ACME', ts: 2, result: cur },
    };
    const r = comparePriorCall(cur, corpus, 'me');
    assert.equal(r.status, 'COMPARED');
    if (r.status !== 'COMPARED') return;
    assert.equal(r.priorDate, '2026-07-20');           // the most recent earlier call, not the older one
    assert.equal(r.heading, 'vs previous call (analysed 2026-07-20)');
    const all = r.lines.join('\n');
    assert.match(all, /Tone score 78 → 55 \(-23\) — cooler/);
    assert.match(all, /Guidance wording cooler/);
    assert.match(all, /New hedge words in guidance: .*stable/);
    assert.match(all, /Guidance cut: 0 → 1/);
    assert.match(all, /revenue 20 → 12/);
    assert.doesNotMatch(all, /margin 18 → 18/);
    assert.match(all, /New red flags: Working capital/);
    assert.match(all, /New themes: Demand Recovery/);
    assert.match(all, /Themes no longer discussed: Capacity Expansion/);
  });
  test('small tone moves are called noise', () => {
    const prior = call({ length: 4000, generated_at: '2026-07-01T00:00:00Z', tone: { score: 62 } });
    const cur = call({ tone: { score: 66 } });
    const r = comparePriorCall(cur, { p: { ticker: 'NSE:ACME', ts: 0, result: prior } }, null);
    assert.equal(r.status, 'COMPARED');
    if (r.status === 'COMPARED') assert.match(r.lines[0], /about the same/);
  });
});
