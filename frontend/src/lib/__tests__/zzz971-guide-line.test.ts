import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideLine } from '../us-guide-line';
import { applyGuideCheck, guideRaisedInText, guideKeptInText, guideCautionInText, guideDirectionInCoverage, withDirection } from '../us-guide-check';

const fig = (o: any) => ({ metric: 'revenue', basis: 'gaap', period: 'year', period_label: 'FY27', low: 2.43e9, high: 2.47e9, unit: 'usd', prior_low: null, prior_high: null, raised: null, source: '', ...o });

test('zzz971 raised / kept / caution sentences are found; costs and dividends are not guidance', () => {
  assert.ok(guideRaisedInText('Penguin raised its fiscal 2027 net sales outlook to growth of 40%.'));
  assert.ok(guideRaisedInText('The company increased its full-year guidance for adjusted EPS to $3.10.'));
  assert.equal(guideRaisedInText('We raised prices in July and increased our dividend by 5%.'), null);
  assert.ok(guideKeptInText('Management reaffirmed its full-year outlook.'));
  // CarMax FY27
  assert.ok(guideCautionInText('CarMax said CAF income is expected to be slightly below fiscal 2026 levels.'));
  assert.ok(guideCautionInText('Management expects retail GPU to be down year over year in the third and fourth quarters.'));
  assert.equal(guideCautionInText('Net loss is expected to decline year over year.'), null);
  assert.equal(guideCautionInText('Operating expenses are expected to be lower than last year.'), null);
});

test('zzz971 call coverage: CarMax reads mixed — a better GPU outlook and CAF income guided below last year', () => {
  const t = 'CarMax raised its outlook for retail GPU, which should decline less than $200 this year. CarMax expects CAF income to be slightly below fiscal 2026. Buybacks resume.';
  const d = guideDirectionInCoverage(t, 'CarMax, Inc.');
  assert.equal(d?.direction, 'mixed');
  assert.equal(guideDirectionInCoverage('CarMax expects CAF income to be slightly below fiscal 2026.', 'CarMax')?.direction, 'cautious');
  assert.equal(guideDirectionInCoverage('Penguin raised its fiscal 2027 outlook to 40% growth.', 'Penguin Solutions')?.direction, 'raised');
});

test('zzz971 one line: release raised, release mixed with a main-line cut, outside cut wins', () => {
  const up = guideLine({ guidance: 'RAISED', guidance_figures: [fig({})], guide_change: [{ metric: 'revenue', basis: 'gaap', period_label: 'FY27', prev_low: 2.17e9, prev_high: 2.22e9, direction: 'raised' }] });
  assert.equal(up.direction, 'raised');
  assert.equal(up.lowered, false);
  assert.match(up.text, /^Guidance raised — FY27 Revenue \$2\.43B–\$2\.47B \(was \$2\.17B–\$2\.22B\)/);

  const mixed = guideLine({ guidance_figures: [fig({}), fig({ metric: 'eps', basis: 'adjusted', low: 1.1, high: 1.2, unit: 'usd_share' })],
    guide_change: [{ metric: 'revenue', basis: 'gaap', period_label: 'FY27', prev_low: 2.1e9, prev_high: 2.2e9, direction: 'raised' },
      { metric: 'eps', basis: 'adjusted', period_label: 'FY27', prev_low: 1.3, prev_high: 1.4, direction: 'lowered' }] });
  assert.equal(mixed.direction, 'mixed');
  assert.equal(mixed.lowered, true);

  const marginOnly = guideLine({ guidance_figures: [fig({}), fig({ metric: 'gross_margin', low: 40, high: 41, unit: 'pct' })],
    guide_change: [{ metric: 'revenue', period_label: 'FY27', direction: 'raised' }, { metric: 'gross_margin', period_label: 'FY27', direction: 'lowered' }] });
  assert.equal(marginOnly.direction, 'mixed');
  assert.equal(marginOnly.lowered, false);

  const pke = guideLine({ guidance: null, guide_check: { lowered: true, direction: 'lowered', scope: 'segment', what: 'GE program sales outlook cut to $32–35M', source: 'call-coverage', url: 'https://m' } });
  assert.equal(pke.direction, 'lowered');
  assert.equal(pke.lowered, true);
  assert.match(pke.text, /segment/);

  assert.equal(guideLine({}).direction, 'unknown');
  assert.equal(guideLine({ guidance_absent_reason: 'none-given' }).direction, 'none');
  assert.equal(guideLine({ guide_check: { direction: 'raised', what: 'raised FY outlook to $3B', source: 'ai-web', url: 'https://a' } }).direction, 'raised');
});

test('zzz971 tier: mixed / cautious from outside move STRONG to MIXED; raised stays and gets a line; v1 results read', () => {
  const kmx: any = { ticker: 'KMX', tier: 'STRONG', caveat_tags: [] };
  assert.equal(applyGuideCheck(kmx, { checked_at: '', lowered: false, direction: 'mixed', scope: 'company', what: 'GPU decline under $200; CAF income slightly below FY26', quote: '', source: 'call-coverage', url: 'https://x', usd: 0 }), true);
  assert.equal(kmx.tier, 'MIXED');
  assert.equal(kmx.tier_before_guide_check, 'STRONG');
  assert.ok(kmx.caveat_tags.some((t: string) => t.startsWith('guidance mixed')));

  const peng: any = { ticker: 'PENG', tier: 'STRONG', caveat_tags: [], guidance: 'RAISED' };
  assert.equal(applyGuideCheck(peng, { checked_at: '', lowered: false, direction: 'raised', scope: 'company', what: 'raised FY27 outlook', quote: 'The Company also raised its outlook for its fiscal 2027 full year.', source: 'filing', url: null, usd: 0 }), false);
  assert.equal(peng.tier, 'STRONG');
  assert.equal(peng.guide_line.direction, 'raised');

  const bad: any = { ticker: 'Q', tier: 'AVOID', caveat_tags: [] };
  assert.equal(applyGuideCheck(bad, { checked_at: '', lowered: true, direction: 'lowered', scope: 'company', what: 'cut FY outlook', quote: '', source: 'filing', url: null, usd: 0 }), false);
  assert.equal(bad.tier, 'AVOID');
  assert.equal(bad.guide_line.direction, 'lowered');

  assert.equal(withDirection({ checked_at: '', lowered: false, scope: 'none', what: '', quote: '', source: 'ai-web', url: null, usd: 0 })!.direction, 'not-lowered');
});

import { guideLoweredInText as lo2, guideRaisedInText as up2, guideDirectionInCoverage as cov2, focusQuote } from '../us-guide-text';
test('zzz971b the first live run’s wrong reads stay fixed', () => {
  // CarMax call: a negation is not a cut
  assert.equal(lo2('And we are going to focus on driving efficiencies in COGS and logistics in order to actually not have to go with margins lower than our initial guidance.'), null);
  // Byrna call: "expectations and inventory beginning to trend lower" is not a cut
  assert.equal(lo2('We are also seeing progress, with gross margins outperforming our internal expectations and inventory beginning to trend lower.'), null);
  // Atossa: "capital raised and … forecast" is not a raise
  assert.equal(up2('CFO Patel stated, "Based on the capital raised and management’s operating cash flow forecast, management concluded that substantial doubt was alleviated."'), null);
  // PepsiCo: "slashes guidance" is a cut, quoted without the page menu
  const pep = cov2('PepsiCo CFO touts cost discipline, slashes guidance | CFO Dive Skip to main content CONTINUE TO SITE Informa TechTarget | Banking Dive', 'PepsiCo, Inc.');
  assert.equal(pep?.direction, 'lowered');
  assert.equal(pep?.quote, 'PepsiCo CFO touts cost discipline, slashes guidance');
  // CarMax write-up: CAF income guided below FY26 — quoted without the section heading in front
  const kmx = cov2('Email [email protected] RISKS Daniels warned that CarMax Auto Finance income for fiscal 2027 is anticipated to be &quot;slightly lower than FY 26,&quot; as the company scales Tier 2.', 'CarMax, Inc.');
  assert.equal(kmx?.direction, 'cautious');
  assert.match(kmx!.quote, /^Daniels warned that CarMax Auto Finance income/);
  // still caught
  assert.ok(lo2('The Company lowered its fiscal 2027 GE program sales outlook to $32 million to $35 million.'));
  assert.ok(lo2('Full-year guidance was cut to $1.2 billion from $1.3 billion.'));
  assert.ok(up2('The Company also raised its outlook for its fiscal 2027 full year as compared to the preliminary view provided last quarter.'));
  assert.equal(focusQuote('short sentence here.', 0, 5), 'short sentence here.');
});

test('zzz971b the card line picks the outlook sentence, not the headline block; wording vs arithmetic is said honestly', () => {
  const peng = guideLine({ guidance: 'RAISED', guidance_snippets: ['Press Release FOR IMMEDIATE RELEASE Penguin Solutions Announces Fourth-Quarter and Full-Year Fiscal 2026 Results Record Results', 'The Company also raised its outlook for its fiscal 2027 full year as compared to the preliminary view provided last quarter.'] });
  assert.equal(peng.direction, 'raised');
  assert.match(peng.text, /^Guidance raised — The Company also raised its outlook/);
  const ntwk = guideLine({ guidance: 'RAISED', guidance_snippets: ['Full-year revenue increased 12.5% to a record $74.4 million, exceeding guidance of $73 million.'] });
  assert.equal(ntwk.direction, 'unknown');
  const ctas = guideLine({ guidance: 'RAISED', guidance_figures: [fig({ metric: 'eps', low: 4.74, high: 4.86, unit: 'usd_share' })], guide_change: [{ metric: 'eps', basis: 'gaap', period_label: 'FY27', prev_low: 4.74, prev_high: 4.86, direction: 'reiterated' }],
    guidance_snippets: ['Schneider concluded, As we look forward to fiscal 2027, we are raising our full fiscal year financial guidance.'] });
  assert.equal(ctas.direction, 'maintained');
  assert.match(ctas.text, /calls it a raise/);
});

test('zzz971c "inflation expectations have increased" is not a raise; the plain sentence beats the headline', () => {
  assert.equal(up2('Inflation expectations have increased since we held our last earnings call on July 22.'), null);
  assert.ok(up2('Our full-year expectations were raised to $3.10.'));
  const peng = guideLine({ guidance: 'RAISED', guidance_snippets: ['Penguin Solutions Announces Fourth-Quarter Results Record Results Across Key Metrics Raises Fiscal 2027 Outlook', 'The Company also raised its outlook for its fiscal 2027 full year as compared to the preliminary view provided last quarter.'] });
  assert.match(peng.text, /^Guidance raised — The Company also raised its outlook/);
});

test('zzz976 a stored free "raised" made by older rules is re-read and dropped', () => {
  const l = guideLine({ guidance: 'RAISED', guidance_snippets: ['The company\'s outlook for fiscal 2027 is for consolidated sales to increase.'],
    guide_check: { direction: 'raised', source: 'filing', quote: 'Inflation expectations have increased since we held our last earnings call on July 22.', what: 'Inflation expectations have increased since we held our last earnings call on July 22.' } });
  assert.doesNotMatch(l.text, /Inflation/);
});
