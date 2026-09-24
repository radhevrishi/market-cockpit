// zzz797 — the owner's live US Portfolio Catalysts paste, item by item:
// table-row capex, thousands-scaled order books, share counts as guidance,
// a widened / narrowed loss read as earnings growth, ₹ / Cr on a US card,
// cash-conversion sign, and a provisional type for all 15 THESIS NOT SET
// names (real SEC XBRL, fixture fetched 2026-09-24).
// Run: npx tsx --test src/lib/__tests__/zzz797-us-pc-audit.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeUsSummary, sanitizeUsEvents, isolateUsLedger, isTableFragment, isShareCountNotGuidance, usScaleMoney } from '../us-thesis/sanitize';
import { newUsRow, assessUsRow, autoPattern, usSignedAmount, usLossWords, usLossAwareEarnings } from '../us-thesis/assess';
import { usText, usDisplayRow } from '../us-thesis/display';
import { extractVariables } from '../thesis/variables';

const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz797-us-pc-15.json'), 'utf8'));
const src = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const rowOf = (t: string, summary: any = null) => {
  const c = FX.companies[t];
  return assessUsRow({ ...newUsRow(t, 'book', null, null, 'NASDAQ'), graded: c.row, gradedWhy: c.row ? null : c.why, sec: c.profile, pattern: autoPattern(c.row, c.profile), summary } as any);
};
const earn = (r: any) => (r.assessment?.ledger || r.assessment?.variables || []).find?.((v: any) => v.key === 'earnings_growth');

describe('zzz797 audit — round-1 leftovers are gone from HEAD', () => {
  const page = src('src/app/(dashboard)/us-portfolio-catalysts/page.tsx');
  test('no "engine period key" line and no score in research priority', () => {
    assert.ok(!/engine period key/.test(page));
    assert.ok(!/· score \{/.test(page));
  });
  test('the 🔥 strip sits inside its own company block, after that company\'s line', () => {
    const block = page.indexOf('data-testid="us-card-block"');
    const strip = page.indexOf('<PersistentStrip ticker={r0.symbol}');
    const card = page.indexOf('<ThesisCard', strip);
    assert.ok(block > 0 && strip > block && card > strip);
  });
  test('ALB "65" / "83%" and MOG-A "$3,250 → $2,650" are dropped', () => {
    const s = sanitizeUsSummary({ volume_price_mix: { volume: '65' }, balance: { working_capital: '83%' }, order_book: { closing_value: '$3,250', order_inflow: '$2,650' } }).summary;
    assert.equal(s.volume_price_mix.volume, '');
    assert.equal(s.balance.working_capital, '');
    assert.equal(s.order_book.closing_value, '');
  });
  test('US profit is $M, never Cr (grader row) — and any ₹ / Cr the shared wording prints becomes $M', () => {
    const v = extractVariables(FX.companies.ITW.row, null, null, {});
    const e = v.find((x) => x.key === 'earnings_growth')!;
    assert.equal(e.before, '$755M'); assert.equal(e.after, '$815M');
    const t = usText("≈ 0% of the quarter's reported profit (₹815 Cr) — material; 38.7 Cr → 1269.6 Cr", (k) => k);
    assert.ok(!/₹|\bCr\b/.test(t), t);
    assert.match(t, /\(\$815M\)/); assert.match(t, /\$38\.7M → \$1269\.6M/);
  });
});

describe('zzz797 audit — junk figures from the paste', () => {
  test('(1) POWL capex "announced $ | 6,525 | $ | 5,117 | …" is a table row, not a capex figure', () => {
    assert.ok(isTableFragment('announced $ | 6,525 | $ | 5,117 | $ | 1,408'));
    assert.ok(!isTableFragment('$25 million for a new facility in Houston'));
    const { summary, dropped } = sanitizeUsSummary({
      capital: { capex: 'announced $ | 6,525 | $ | 5,117 | …' },
      capex_projects: [{ name: 'Houston expansion', amount: '$ | 6,525 | $ | 5,117', capacity_added: '' }, { name: 'Jacinto Port', amount: '$12.5 million', capacity_added: '' }],
      positives: [{ label: 'Backlog', detail: 'backlog $1.4 billion', evidence: 'Backlog | 1,408 | 1,302' }],
    });
    assert.equal(summary.capital.capex, '');
    assert.deepEqual(summary.capex_projects.map((p: any) => p.name), ['Jacinto Port']);
    assert.equal(summary.positives.length, 1, 'a table-sourced evidence quote does not drop a stated figure');
    assert.ok(dropped.some((d) => /table row/.test(d)));
    assert.equal(sanitizeUsEvents([{ variable: 'capex', after: '$ | 6,525 | $ | 5,117', evidence_text: 'x' }]).length, 0);
  });
  test('(2) OII "$445,000" and PL "$753,117" (in thousands) — scaled to $M with the table\'s own scale, dropped without one', () => {
    assert.equal(usScaleMoney('order_book', '$445,000', 'Backlog (in thousands) $445,000').value, '$445.0 million');
    assert.equal(usScaleMoney('order_book', '$753,117', 'Remaining performance obligations (in thousands): $753,117').value, '$753.1 million');
    const s = sanitizeUsSummary({ order_book: { closing_value: '$445,000' }, demand: { revenue_visibility: '$753,117' } }).summary;
    assert.equal(s.order_book.closing_value, '');
    assert.equal(s.demand.revenue_visibility, '');
    const led: any = { ticker: 'OII', periods: { 'Q1 FY27': { documents: [], events: [], facts: [
      { metric_name: 'order_book', after_value: '$445,000', source_quote: 'Backlog (in thousands) was $445,000', source_url: null },
    ] } } };
    assert.equal(isolateUsLedger(led, 'OII')!.periods['Q1 FY27'].facts[0].after_value, '$445.0 million');
  });
  test('(3) MDA "8,106,539 common shares" is a share count, never guidance', () => {
    assert.ok(isShareCountNotGuidance('8,106,539 common shares'));
    assert.ok(!isShareCountNotGuidance('revenue of $1.6 billion to $1.7 billion'));
    assert.ok(!isShareCountNotGuidance('EPS of $1.20 per share'));
    const s = sanitizeUsSummary({ guidance: { action: 'maintained', detail: '8,106,539 common shares', period: 'FY2026' }, management_targets: [{ metric: 'shares', target: '8,106,539 common shares' }, { metric: 'revenue', target: '$1.6 billion' }] }).summary;
    assert.equal(s.guidance.action, 'none');
    assert.deepEqual(s.management_targets.map((t: any) => t.metric), ['revenue']);
    const v = extractVariables(null, s, null, {});
    assert.ok(!v.some((x) => x.key === 'guidance'));
  });
});

describe('zzz797 audit — a loss is not earnings growth', () => {
  test('accounting parentheses are a minus sign', () => {
    assert.equal(usSignedAmount('$(45,781)'), -45781);
    assert.equal(usSignedAmount('(267,529)'), -267529);
    assert.equal(usSignedAmount('−$5.1 million'), -5.1e6);
    assert.equal(usSignedAmount('net loss of $3 million'), -3e6);
    assert.equal(usSignedAmount('$815 million'), 815e6);
    assert.equal(usLossWords(-267529, -45781), 'loss widened');
    assert.equal(usLossWords(-5066, -67370), 'loss narrowed');
    assert.equal(usLossWords(200, -729), 'swung from a loss to a profit');
    assert.equal(usLossWords(3, 2), null);
  });
  test('(4) CIFR / WULF: "$(45,781) → $(267,529)" reads "loss widened", never "+484.4%"', () => {
    const hl = { headline: { period: 'Q2 2026', profit: '$(267,529)', profit_prior: '$(45,781)', profit_growth: '', comparison: 'yoy', basis: 'consolidated' } };
    // the shared engine alone (the bug): parentheses read as positive
    const raw = extractVariables(null, hl, null, {}).find((v) => v.key === 'earnings_growth');
    assert.match(String(raw?.delta), /\+484\.4%/);
    const fixed = usLossAwareEarnings(extractVariables(null, hl, null, {}), null, hl).find((v) => v.key === 'earnings_growth')!;
    assert.equal(fixed.delta, null);
    assert.match(String(fixed.after), /loss widened/);
    assert.ok(!/484/.test(JSON.stringify(fixed)));
    // with the real XBRL row the earnings row says the same, and nothing on the card says +484.4%
    for (const t of ['CIFR', 'WULF']) {
      const g = FX.companies[t].row;
      const e = usLossAwareEarnings(extractVariables(g, hl, null, {}), g, hl).find((v) => v.key === 'earnings_growth')!;
      assert.match(String(e.after), /net loss \$[\d,.]+M — loss widened/, t);
      assert.equal(e.delta, null);
      assert.ok(!/\+484\.4%/.test(JSON.stringify(rowOf(t, hl))), t);
    }
  });
  test('(5) AVAV: "$(67,370) → $(5,066)" reads "loss narrowed", not a −92.5% decline', () => {
    const hl = { headline: { profit: '$(5,066)', profit_prior: '$(67,370)', comparison: 'yoy' } };
    const raw = extractVariables(null, hl, null, {}).find((v) => v.key === 'earnings_growth');
    assert.match(String(raw?.delta), /-92\.5%/, 'the shared engine alone reads a decline');
    const g = FX.companies.AVAV.row;
    const e = usLossAwareEarnings(extractVariables(g, hl, null, {}), g, hl).find((v) => v.key === 'earnings_growth')!;
    assert.match(String(e.after), /loss narrowed/);
    assert.equal(e.verdict, 'unknown');
    assert.ok(!/92\.5%/.test(JSON.stringify(rowOf('AVAV', hl))));
  });
  test('(7) ESP cash conversion −0.18× against a positive profit reads "not becoming cash" (sign read correctly)', () => {
    const v = extractVariables(FX.companies.ESP.row, null, null, {}).find((x) => x.key === 'cash_conversion')!;
    assert.equal(v.after, '-0.18×');
    assert.equal(v.verdict, 'deteriorating');
    assert.match(v.evidence, /negative against a positive profit/);
  });
});

describe('zzz797 audit — (8)/(9) every one of the 15 gets a provisional type, foreign filers labelled', () => {
  const NAMES = ['CIFR', 'WULF', 'AKAM', 'AVAV', 'ESP', 'GFS', 'ITW', 'LAR', 'MDA', 'NVEC', 'OII', 'PL', 'RSKD', 'SILC', 'XPEV'];
  for (const t of NAMES) {
    test(`${t}: a provisional (nearest-fit) type, not THESIS NOT SET`, () => {
      const r = rowOf(t);
      assert.ok(r.pattern, `${t} has no type`);
      assert.equal((r.pattern as any).fit, 'nearest');
      assert.notEqual(r.assessment!.status, 'THESIS_NOT_SET');
    });
  }
  test('GFS reads quarterly figures; RSKD / SILC / XPEV / LAR carry annual figures labelled; MDA is labelled a foreign filer with no XBRL', () => {
    assert.ok(FX.companies.GFS.row);
    for (const t of ['RSKD', 'SILC', 'XPEV', 'LAR']) assert.match(FX.companies[t].why, /^Foreign filer — files 20-F.*annual figures/);
    assert.match(FX.companies.MDA.why, /^Foreign filer — files 6-K; its financial statements are not in SEC XBRL/);
  });
  test('the display copy of a US row carries no ₹ and no Cr', () => {
    for (const t of NAMES) assert.ok(!/₹|\d\s?Cr\b/.test(JSON.stringify(usDisplayRow(rowOf(t)))), t);
  });
});
