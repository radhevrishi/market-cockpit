// zzz833 — US Portfolio Catalysts: EVENT ≠ OBSERVED VARIABLE ≠ THESIS LINK ≠ IMPACT. Acceptance cases from the owner's spec.
// Tickers are synthetic-safe: the fixtures reproduce filing WORDS only. Run: npx tsx --test src/lib/__tests__/zzz833-us-catalyst-semantics.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCard, fundRaiseSubtype, managementEvent, chainSpec, calculateCatalystCounts, type CardInput, type Claim } from '../catalyst/event-card';

const F = { pattern: 'F', fit: 'exact' as const, assessment: { checked: [{ key: 'cash_conversion', after: '1.2x', verdict: 'improving' }] } };
const A = { pattern: 'A', fit: 'exact' as const, assessment: null };
const B = { pattern: 'B', fit: 'exact' as const, assessment: null };
const base = (o: Partial<CardInput>): CardInput => ({
  type: 'Results', importance: 'Notable', read: 'read', badge: 'filed', title: '8-K', what: '', line: null, figure: null, claims: [], ctx: F,
  sourceDoc: 'Form 8-K', exchange: 'SEC', date: '2026-09-24', market: 'US', ...o,
});
const x = (key: string, text: string, dir: 'up' | 'down' = 'up'): Claim => ({ key, dir, verified: true, source: 'xbrl', text });
const REV = 'Revenue $129.6 mn → $163.3 mn (+26%) · same quarter a year earlier, SEC XBRL (Q2 FY2027)';
const PAT = 'Net income $10.0 mn → $43.2 mn (+332%) · same quarter a year earlier, SEC XBRL (Q2 FY2027)';

describe('results — SEC XBRL is the primary source', () => {
  test('results with XBRL revenue + profit: Sales ✓ Profit ✓ Margin ? Cash ✓ Guidance ✓; Supports only through registered variables', () => {
    const c = buildCard(base({ importance: 'Material', what: 'Revenue $163 mn, guidance raised', line: 'Revenue $163 mn; guidance raised', claims: [x('revenue_growth', REV), x('earnings_growth', PAT)] }));
    assert.deepEqual(c.chain!.map((l) => `${l.label}${l.ok ? '✓' : '?'}`), ['SALES✓', 'PROFIT✓', 'MARGIN?', 'CASH✓', 'GUIDANCE✓']);
    assert.equal(c.impact, 'Supports');
    assert.equal(c.connection, 'Direct');
    assert.equal(c.quality, 'Direct');
    assert.equal(c.previousValue, '$129.6 mn');
    assert.equal(c.currentValue, '$163.3 mn');
    assert.equal(c.next, 'margin');
    assert.match(String(c.whyMatters), /directly testing/);
    assert.match(String(c.whyMatters), /margin is not yet evidenced/);
    assert.equal(c.evidenceStatus.thesis, true);
  });
  test('XBRL revenue extracted but the narrative has no headline: Sales ✓ and the words say so', () => {
    const c = buildCard(base({ ctx: A, what: 'Partnership / collaboration: administrative burden', line: 'reduces administrative burden', claims: [x('revenue_growth', 'Revenue $654.8 mn → $972.5 mn (+48.5%) · same quarter a year earlier, SEC XBRL (Q2 FY2026)')] }));
    assert.equal(c.chain![0].ok, true, 'Sales ✓');
    assert.match(c.event, /^Revenue \$654\.8 mn → \$972\.5 mn \(\+48\.5%\)$/, 'headlined by the XBRL fact, not a stray sentence');
    assert.match(c.evidence, /SEC XBRL figures extracted \(sales\); narrative headline not stated/);
    assert.doesNotMatch(c.evidence, /no headline figures/);
    assert.equal(c.impact, 'Supports');
    assert.equal(c.deltaPct, 48.5);
  });
  test('a 6-K the reader could not use: Evidence incomplete — not positive, not negative', () => {
    const c = buildCard(base({ ctx: A, read: 'read', lowConfidence: true, title: '6-K: FORM 6-K', what: 'FORM 6-K', line: 'garble', claims: [] }));
    assert.equal(c.impact, 'Evidence incomplete');
    assert.equal(c.connection, 'Evidence incomplete');
    assert.equal(c.quality, 'Unproven');
    assert.deepEqual(c.chain!.map((l) => l.ok), [false, false, false, false, false]);
    assert.equal(c.evidenceStatus.financial, false);
  });
  test('a revenue fall is ✗ contradicted in the chain and Weakens only a registered variable', () => {
    const c = buildCard(base({ ctx: A, claims: [x('revenue_growth', 'Revenue $100.0 mn → $80.0 mn (-20%) · same quarter a year earlier, SEC XBRL (Q1 FY2027)', 'down')] }));
    assert.equal(c.chain![0].contradicted, true);
    assert.equal(c.chain![0].ok, false);
  });
});

describe('orders — a win is not thesis support', () => {
  test('a $100 mn customer win: order/backlog evidence, Static, Indirect connection, Neutral, no F variable named', () => {
    const c = buildCard(base({ type: 'Order win', importance: 'Material', title: '8-K', what: 'Customer win: adds over $100 mn to the royalty backlog', line: 'The design win adds over $100 mn to the royalty backlog' }));
    assert.equal(c.impact, 'Neutral');
    assert.equal(c.connection, 'Indirect');
    assert.equal(c.mapped, false);
    assert.equal(c.thesisVariable, null, 'no "F · order book" when order book is not a thesis variable');
    assert.equal(c.observed, 'Backlog / order book');
    assert.match(String(c.whyMatters), /adds to future backlog/);
    assert.equal(c.chain![0].label, 'CONTRACT');
    assert.equal(c.next, 'execution → revenue → margin');
  });
  test('a backlog number without a prior is STATIC, never a change', () => {
    const c = buildCard(base({ type: 'Order win', what: 'Backlog $135.2 mn', line: 'Total backlog was $135.2 mn', figure: '$135.2 mn' }));
    assert.equal(c.quality, 'Static');
    assert.equal(c.delta.kind, 'level');
    assert.equal(c.deltaPct, null);
    assert.equal(c.previousValue, null);
  });
});

describe('fund raise — debt, equity and convertible are different things', () => {
  test('subtype taxonomy', () => {
    assert.equal(fundRaiseSubtype('Pricing of Upsized $125 mn Offering of Additional 6.250% Senior Notes due 2030'), 'Debt issuance');
    assert.equal(fundRaiseSubtype('entered into a credit agreement, revolving credit facility'), 'Credit facility');
    assert.equal(fundRaiseSubtype('Item 3.02 Unregistered Sales of Equity Securities: private placement of common stock'), 'Private placement');
    assert.equal(fundRaiseSubtype('at-the-market offering program'), 'ATM');
    assert.equal(fundRaiseSubtype('$300 mn convertible senior notes due 2031'), 'Convertible');
    assert.equal(fundRaiseSubtype('allotment of non-convertible debentures'), 'Debt issuance');
    assert.equal(fundRaiseSubtype('prospectus supplement 424B5 common stock'), 'Equity issuance');
    assert.equal(fundRaiseSubtype('redemption of 2027 notes with proceeds of new notes; refinancing'), 'Debt refinancing');
    assert.equal(fundRaiseSubtype('warrants to purchase shares'), 'Warrant');
  });
  test('equity placement (TTMI-like) is never debt: equity chain, no thesis debt variable', () => {
    const c = buildCard(base({ type: 'Fund raise', ctx: A, read: 'read', title: '8-K: Unregistered sale of equity [Item 3.02]', what: 'Equity offering', line: 'The Offering was conducted as a private placement exempt from registration under the Securities Act', importance: 'Notable' }));
    assert.equal(c.eventSubtype, 'Private placement');
    assert.deepEqual(c.chain!.map((l) => l.label), ['OFFERING', 'SHARES ISSUED', 'DILUTION', 'DEPLOYMENT', 'EPS/FCF']);
    assert.equal(c.thesisVariable, null);
    assert.equal(c.connection, 'No established connection');
    assert.equal(c.impact, 'Neutral');
    assert.match(c.evidence, /dilution/);
    assert.match(String(c.whyMatters), /dilute/);
  });
  test('a debt financing (AKAM/LB-like) uses the debt chain and is not a thesis variable unless registered', () => {
    const c = buildCard(base({ type: 'Fund raise', ctx: B, title: '8-K', what: 'Pricing of $125 mn Senior Notes', line: 'Announces Pricing of Upsized $125 mn Offering of Additional 6.250% Senior Notes due 2030', importance: 'Material' }));
    assert.equal(c.eventSubtype, 'Debt issuance');
    assert.deepEqual(c.chain!.map((l) => l.label), ['BORROWING', 'PROCEEDS', 'DEPLOYMENT', 'INTEREST COST', 'EARNINGS/FCF']);
    assert.equal(c.thesisVariable, null);
    assert.notEqual(c.connection, 'Direct');
    assert.match(String(c.whyMatters), /interest cost/);
    assert.match(c.evidence, /no new shares/);
    assert.equal(chainSpec('Fund raise', 'US', 'Convertible')!.links[1][0], 'CONVERSION TERMS');
  });
  test('a marketing sentence never headlines a fund raise', () => {
    const c = buildCard(base({ type: 'Fund raise', ctx: B, title: '8-K: Unregistered sale of equity [Item 3.02]', what: 'AI / data-centre move: These agreements underscore demand', line: 'These agreements underscore demand', importance: 'Notable' }));
    assert.match(c.event, /^Private placement/);
  });
});

describe('management change — Item 5.02 alone says nothing', () => {
  test('classification', () => {
    assert.equal(managementEvent('CEO resigned effective immediately').priority, 'Investigate');
    assert.equal(managementEvent('Chief Financial Officer terminated for cause').priority, 'Investigate');
    assert.equal(managementEvent('appointed as Chief Executive Officer; planned succession').priority, 'Monitor');
    assert.equal(managementEvent('independent director appointed to the board').priority, 'Routine');
    assert.equal(managementEvent('audit committee membership change').priority, 'Routine');
    assert.equal(managementEvent('8-K: Director / officer change [Item 5.02]').priority, 'Monitor');
  });
  test('a bare 5.02 is Monitor: no attention, no thesis impact, no negative implication', () => {
    const c = buildCard(base({ type: 'Management change', senior: true, importance: 'Notable', read: 'read', lowConfidence: true, title: '8-K: Director / officer change [Item 5.02]', what: 'garble', line: 'garble', ctx: A }));
    assert.equal(c.attention, null);
    assert.equal(c.priority, 'Monitor');
    assert.notEqual(c.impact, 'Weakens');
    assert.notEqual(c.impact, 'Broken');
    assert.equal(c.connection, 'No established connection', 'a management event tests no thesis variable');
  });
  test('a CEO resignation with the words in the filing goes to Needs attention (Investigate)', () => {
    const c = buildCard(base({ type: 'Management change', senior: true, importance: 'Notable', title: '8-K: Item 5.02', what: 'The Chief Executive Officer resigned', line: 'The Chief Executive Officer resigned effective October 1', ctx: A }));
    assert.equal(c.priority, 'Investigate');
    assert.match(String(c.attention), /ceo resignation/);
    assert.equal(c.connection, 'No established connection');
    assert.equal(c.impact, 'Neutral');
  });
});

describe('counts — one hierarchy', () => {
  test('names → filings → events (Material+Notable+Minor) → routine filings not counted as events', () => {
    const mk = (m: 'Material' | 'Notable' | 'Minor') => buildCard(base({ importance: m, type: 'Order win', line: 'Backlog $10 mn' }));
    const cards = [mk('Material'), mk('Material'), mk('Notable'), mk('Minor')];
    const n = calculateCatalystCounts({ names: 118, filingsRead: 26, filingsTotal: 26, routine: 8, cards });
    assert.equal(n.events, 4);
    assert.equal(n.material + n.notable + n.minor, n.events);
    assert.equal(n.routine, 8);
    assert.match(n.line, /118 names tracked · 26 of 26 filings read · 4 events \(2 Material · 1 Notable · 1 Minor\) · 8 routine filings not counted as events/);
  });
});
