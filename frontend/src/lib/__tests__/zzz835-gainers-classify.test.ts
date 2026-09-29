// zzz835 — AI Daily Gainers: event classification, numeric parsing, status logic.
// Fixtures are excerpts of the 28 Sep 2026 sample reports (India / USA) and the
// QA brief. Every case here is a bug the QA found: a jury award called an order,
// "28-30%" read as -30%, a quarterly outlook compared with twelve-month revenue,
// "not yet in an official filing" beside a verified 8-K, ten labels for one
// results release, an LOI called an order win, a headline value silently
// replacing the filed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, parseAllAmounts, parseRange, toMoney, extractMetrics, guidanceCheck, periodBasisOf, stageFromText, proposedLabel, isFirmStage,
  reconcileValues, verificationOf, validateVerification, reconcileStateLabel, CATALYST_CONFIRMATION_LABEL, catalystSearchResult, causalWindow,
  exchangeDate, exchangeAgeDays, exchangeDay, clusterFacts, resolveIssuer, normaliseCompanyName,
} from '../ai-gainers/structured-facts';
import {
  classifyUsEvents, classifyCanonicalEventType, validateCanonicalEvent, isLitigationText, readLitigation, extractClinicalFacts, LITIGATION_CASH_NOTE,
} from '../ai-gainers/us-event-taxonomy';
import { buildUsCard, withPressCatalysts, readUsEarnings, outlookOf, acquisitionEconomics } from '../ai-gainers/us-card';
import { moneyCr, extractIndiaFacts } from '../ai-gainers/india-extract';
import { buildIndiaCard, classifyIndiaEvents, figureCrore } from '../ai-gainers/in-event-taxonomy';
import { pressFacts, buildNewsContext } from '../ai-gainers/news-context';
import { secSourceRef, exhibitNumberOf, secOfficialLabel } from '../ai-gainers/sec-routing';
import { clusterEvents, countIndependentSources, independentSourceKey, buildCanonicalEvent, type GainerEvent } from '../ai-gainers/events';
import { extractUsFacts } from '../ai-gainers/us-extract';

const filing = (form: string, items: string[], date = '2026-09-25') => ({ form, items, date, url: 'https://www.sec.gov/Archives/edgar/data/906709/000121390026103215/ea0306370-8k_nektar.htm', subject: `${form}: [${items.map((i) => `Item ${i}`).join(', ')}]` });
const doc = (role: string, text: string, acc = '000121390026103215') => ({ role, url: `https://www.sec.gov/Archives/edgar/data/906709/${acc}/${role}.htm`, text });
const PAD = ' The Company is a biotechnology company headquartered in San Francisco and its shares trade on Nasdaq under the symbol shown above. '.repeat(3);

// ── fixtures from the sample reports ──────────────────────────────────────

const BURFORD = 'Statement Regarding Jury Verdict in Patent Matter. Burford Capital Limited (“Burford”), the leading global finance and asset management firm focused on law, today provides an update on a portfolio matter. '
  + 'After the market close on Friday, September 25, 2026, a jury in a case in which Burford has a financial entitlement awarded $5.7 billion in damages to the plaintiff.';
const NEKTAR = 'Nektar Therapeutics filed a lawsuit against Eli Lilly and Company (“Lilly”) alleging, among other claims, breach of contract and breach of the implied covenant of good faith and fair dealing in connection with the license agreement governing the parties’ prior collaboration for the development and commercialization of rezpegaldesleukin (the “License Agreement”). '
  + 'The jury awarded the Company $90 million in damages plus interest to be determined by the District Court.';

// ═══ 1. LITIGATION IS NOT AN ORDER ═════════════════════════════════════════

test('1. Burford: a $5.7B jury award is Litigation - never Contract / order, never an order ÷ market-cap ratio', () => {
  const c = buildUsCard({ ticker: 'BUR', company: 'Burford Capital Limited', marketCapM: 872.8, filing: filing('8-K', ['7.01', '9.01']), docs: [doc('primary', `FORM 8-K Item 7.01 Regulation FD Disclosure. ${PAD}`), doc('ex99', `${BURFORD}${PAD}`)], secChecked: true })!;
  assert.equal(c.kind, 'litigation');
  assert.equal(c.eventType, 'Litigation / regulatory');
  assert.equal(c.canonicalType, 'litigation');
  assert.doesNotMatch(c.kindWord, /Contract \/ order/);
  assert.match(c.whatChanged, /Gross award is not expected cash proceeds/);
  assert.deepEqual(c.material.ratios, [], 'no order/market-cap ratio');
  assert.doesNotMatch(`${c.whatChanged} ${c.material.how}`, /653%|Order \$5\.7B ÷/);
  assert.equal(c.material.label, 'UNKNOWN');
  assert.equal(c.litigation!.grossAwardM, 5700);
  assert.match(c.litigation!.appeal, /unknown - not stated in the cited filing/);
  assert.match(c.litigation!.collectability, /unknown - not stated in the cited filing/);
  assert.ok(c.extra.some((x) => x.startsWith('Appeal status:')));
  assert.deepEqual(c.validationErrors, []);
});

test('1. Nektar: a $90M jury damages award is Litigation; "customer: District Court" is gone', () => {
  const c = buildUsCard({ ticker: 'NKTR', company: 'Nektar Therapeutics', marketCapM: 2074, filing: filing('8-K', ['8.01']), docs: [doc('primary', `FORM 8-K Item 8.01 Other Events. ${NEKTAR}${PAD}`)], secChecked: true })!;
  assert.equal(c.kind, 'litigation');
  assert.equal(c.canonicalType, 'litigation');
  assert.doesNotMatch(c.whatChanged, /customer/i);
  assert.match(c.whatChanged, /\$90 million in damages \(gross\)/);
  assert.match(c.material.how, /Gross award is not expected cash proceeds/);
  assert.match(c.litigation!.interestNote || '', /Interest is mentioned/);
  assert.equal(c.stage, 'UNKNOWN', 'a verdict is not an awarded contract');
});

test('1. taxonomy: jury / damages sentences are litigation_verdict and never a licence, partnership or order hit', () => {
  const hits = classifyUsEvents(NEKTAR);
  assert.deepEqual(hits.map((h) => h.id), ['litigation_verdict']);
  assert.equal(hits[0].direction, 'positive');
  assert.deepEqual(hits[0].figures, ['$90 million']);
  assert.deepEqual(classifyUsEvents(BURFORD).map((h) => h.id), ['litigation_verdict']);
  // "Company prevailed ... jury verdict" keeps its older patent / litigation win label
  assert.equal(classifyUsEvents('The Company prevailed in its patent infringement lawsuit after a jury verdict awarded $28 million in damages.')[0].id, 'patent_litigation_win');
});

test('1. deterministic type: litigation before anything else; guard rejects order/contract with a jury or damages quote', () => {
  assert.equal(classifyCanonicalEventType(NEKTAR).type, 'litigation');
  assert.equal(classifyCanonicalEventType(BURFORD).type, 'litigation');
  assert.equal(classifyCanonicalEventType('Sugs Lloyd received Rs 4.68 crore LOI from UPNEDA for 2,500 solar street lights').type, 'loi');
  assert.equal(classifyCanonicalEventType('Received Rs. 1.65 crore order from MCF Raebareli for 26 seat sets').type, 'order');
  assert.equal(classifyCanonicalEventType('Zenkuda met the primary endpoint (p-value of 0.0007) in the Phase 3 DAYBREAK trial').type, 'trial_result');
  assert.equal(classifyCanonicalEventType('PTC Completes Acquisition of ST-920 Fabry Disease Gene Therapy').type, 'acquisition');
  assert.equal(classifyCanonicalEventType('BlackBerry reports Q2 FY27 results: revenue $163.3M, net income $33.9M, EPS $0.05, raised outlook').type, 'earnings');
  const errs = validateCanonicalEvent({ event_type: 'order', source_quote: 'The jury awarded the Company $90 million in damages plus interest.' });
  assert.ok(errs.length >= 1 && /jury \/ damages/.test(errs[0]));
  assert.deepEqual(validateCanonicalEvent({ event_type: 'litigation', source_quote: 'The jury awarded the Company $90 million in damages.' }), []);
  assert.equal(isLitigationText('The High Court sanctioned the scheme of amalgamation'), false, 'a scheme court is not litigation');
  assert.equal(isLitigationText('The District Court entered final judgment'), true);
});

test('1. press headline about a jury award is litigation (press only), not an order', () => {
  const c = buildUsCard({ ticker: 'NKTR', company: 'Nektar Therapeutics', marketCapM: 2074, filing: null, docs: [], secChecked: true,
    press: [{ title: 'Nektar Therapeutics - Jury Finds Lilly Breached Implied Covenant Of Good Faith In License Agreement; jury awards $90 million damages', url: 'https://news.example/n', date: '2026-09-25', source: 'Reuters' }] })!;
  assert.equal(c.kind, 'litigation');
  assert.equal(c.source.tier, 'PRESS');
  assert.equal(c.catalystConfirmation, 'press_unconfirmed');
});

test('1. readLitigation states appeal / collectability only when the text does', () => {
  const l = readLitigation(`${BURFORD} Burford expects Apple to appeal. Post-trial motions are due within 28 days.`)!;
  assert.match(l.appeal, /^stated: /);
  assert.match(l.collectability, /unknown/);
  assert.match(LITIGATION_CASH_NOTE, /not expected cash proceeds/);
});

// ═══ 2. LOI / PROPOSED / CONFLICTING VALUES ═══════════════════════════════

const LOI_SUGS = 'Sugs Lloyd received Rs 4.68 crore LOI from UPNEDA for 2,500 solar street lights and five-year maintenance.';

test('2. an LOI carries stage PROPOSED and is never firm / booked / an order win', () => {
  assert.equal(stageFromText(LOI_SUGS), 'PROPOSED');
  assert.equal(isFirmStage(stageFromText(LOI_SUGS)), false);
  assert.equal(stageFromText('The order is tentative and subject to approval of the board'), 'PROPOSED');
  assert.equal(stageFromText('Received Rs. 1.65 crore order from MCF Raebareli for 26 seat sets'), 'AWARDED');
  assert.equal(stageFromText('The parties entered into a definitive agreement'), 'SIGNED');
  assert.equal(stageFromText('PTC Completes Acquisition of ST-920'), 'COMPLETED');
  assert.match(proposedLabel('Order win'), /\(proposed\)$/);
  assert.doesNotMatch(proposedLabel('Order win'), /Order win/);
  const f = extractIndiaFacts({ issuer: 'SUGSLLOYD', title: 'Letter of Intent', url: 'https://www.bseindia.com/x.pdf', date: '2026-09-24', text: 'To BSE Limited. Sub: Disclosure under Regulation 30 of SEBI (LODR) Regulations, 2015. '.repeat(2) + 'We wish to inform you of receipt of order worth Rs. 4.68 crore as a Letter of Intent from UPNEDA for solar street lights. The LOI is subject to execution of the definitive agreement.' } as any, {}).facts[0];
  assert.equal(f.event.stage, 'PROPOSED');
});

test('2. India card: LOI hit is planned / PROPOSED with impact unknown', () => {
  const c = buildIndiaCard({ filings: [{ subject: 'Announcement under Regulation 30 (LODR)-Award of Order / Receipt of Order', summary: null, url: 'https://x/sugs', dateIso: '2026-09-24', docText: LOI_SUGS }], press: [], now: new Date('2026-09-25T10:00:00Z'), windowDays: 21 });
  const cat = c.catalysts.find((x) => x.id === 'order_win')!;
  assert.equal(cat.stage, 'PROPOSED');
  assert.equal(cat.impactUnknown, true);
  assert.match(cat.label, /proposed|Order/i);
});

test('2. Sugs Lloyd: headline Rs 213.48 crore vs filed LOI Rs 4.68 crore - both kept, conflict exposed, impact unknown', () => {
  const c = buildIndiaCard({
    filings: [{ subject: 'Received Rs 213.48 crore Punjab power distribution contract', summary: 'The Company received Rs 213.48 crore contract on 21 Sep 2026, executable in 15 months.', url: 'https://www.bseindia.com/x.pdf', dateIso: '2026-09-24', docText: LOI_SUGS }],
    press: [{ title: 'Sugs Lloyd bags Rs 2.13 billion power distribution contract in Punjab', url: 'https://powerline.example/a', date: '2026-09-24', source: 'Powerline Magazine' }],
    now: new Date('2026-09-25T10:00:00Z'), windowDays: 21,
  });
  const fil = c.catalysts.find((x) => x.id === 'order_win' && x.source === 'FILING')!;
  assert.equal(fil.valueStatus, 'conflicting');
  assert.equal(fil.impactUnknown, true);
  assert.deepEqual(fil.values!.map((v) => v.value).sort((a, b) => a - b), [4.68, 213.48]);
  assert.ok(fil.conflicts!.some((t) => /Rs 213.48 crore/.test(t) && /Rs 4.68 crore/.test(t)));
  assert.ok((c.conflicts || []).length >= 1);
  assert.equal(fil.stage, 'PROPOSED');
});

test('2. Oriental Rail: headline Rs 3.64 crore vs filed Rs 1.65 crore is a conflict, not a silent pick', () => {
  const c = buildIndiaCard({ filings: [{ subject: 'Oriental Rail Infrastructure won Rs 3.64 crore order from ICF Chennai', summary: null, url: 'https://x/or', dateIso: '2026-09-28', docText: 'Received Rs. 1.65 crore order from MCF Raebareli for 26 seat sets, to be executed by November 28, 2026.' }], press: [], now: new Date('2026-09-28T12:00:00Z'), windowDays: 21 });
  const fil = c.catalysts.find((x) => x.id === 'order_win')!;
  assert.equal(fil.valueStatus, 'conflicting');
  assert.deepEqual(fil.values!.map((v) => v.value).sort((a, b) => a - b), [1.65, 3.64]);
  assert.match((c.conflicts || []).join(' '), /Both are kept; neither is used until confirmed/);
});

test('2. reconcileValues: agreeing filed value verifies; press-only is reported and unsized; different values conflict', () => {
  const ok = reconcileValues([{ value: 4.68, unit: 'INR_CRORE', source: 'filed', text: 'Rs 4.68 crore' }, { value: 4.68, unit: 'INR_CRORE', source: 'headline', text: 'Rs 4.68 crore' }]);
  assert.equal(ok.valueStatus, 'verified'); assert.equal(ok.usable!.value, 4.68); assert.equal(ok.impactUnknown, false);
  const press = reconcileValues([{ value: 213.48, unit: 'INR_CRORE', source: 'press', text: 'Rs 213.48 crore' }]);
  assert.equal(press.valueStatus, 'reported'); assert.equal(press.usable, null); assert.equal(press.impactUnknown, true);
  assert.equal(reconcileValues([]).valueStatus, 'not_disclosed');
  const rounded = reconcileValues([{ value: 213.48, unit: 'c', source: 'filed', text: 'Rs 213.48 crore' }, { value: 213, unit: 'c', source: 'press', text: 'Rs 2.13 billion' }]);
  assert.equal(rounded.valueStatus, 'verified', 'Rs 2.13 billion is the rounded 213.48 crore - within 1%');
  const two = reconcileValues([{ value: 1, unit: 'c', source: 'filed', text: 'a' }, { value: 2, unit: 'c', source: 'filed', text: 'b' }]);
  assert.equal(two.valueStatus, 'conflicting');
});

test('2. press headline vs filed value: news-context marks the conflict', () => {
  const news = buildNewsContext([{ title: 'Oriental Rail bags Rs 3.64 crore order from ICF Chennai - Business Standard', url: 'https://bs.example/1', published_at: '2026-09-28T09:00:00+05:30' }], { ticker: 'ORIRAIL', company: 'Oriental Rail Infrastructure Limited', now: new Date('2026-09-28T12:00:00Z') });
  const off = extractIndiaFacts({ issuer: 'ORIRAIL', title: 'Order', url: 'https://x/or.pdf', date: '2026-09-28', text: 'To BSE Limited. Sub: Disclosure under Regulation 30 of SEBI (LODR) Regulations, 2015. '.repeat(2) + 'We wish to inform you that the Company has received an order worth Rs. 1.65 crore from MCF Raebareli for supply of 26 seat sets, to be executed by November 28, 2026.' } as any, {}).facts;
  const r = pressFacts(news, 'ORIRAIL', off);
  const p = r.facts.find((f) => f.event.kind === 'order');
  assert.ok(off.length > 0 && p, 'fixture must yield an official fact and a press fact');
  { assert.equal(p!.valueStatus, 'conflicting'); assert.match((p!.conflicts || []).join(' '), /Rs 3.64 crore/); }
});

// ═══ 3. RANGES AND NUMBERS ════════════════════════════════════════════════

test('3. ranges: 28–30% is low 28 high 30, never -30; hyphen and en-dash both; original text kept', () => {
  for (const t of ['targets 28–30% revenue growth', 'targets 28-30% revenue growth', 'targets 28 – 30% revenue growth']) {
    const r = parseRange(t)!;
    assert.equal(r.low, 28, t); assert.equal(r.high, 30, t); assert.equal(r.unit, 'percent');
    assert.ok(/28/.test(r.raw) && /30%/.test(r.raw));
  }
  const m = extractMetrics('Macpower CNC targets 28–30% revenue growth in FY27.')[0];
  assert.equal(m.name, 'revenue_growth'); assert.equal(m.low, 28); assert.equal(m.high, 30); assert.equal(m.forward, true); assert.equal(m.direction, 'growth');
  assert.match(m.raw, /28–30%/);
  assert.equal(parseAmount('28-30%')!.value, 28);
});

test('3. money ranges and units: $323M–$328M, $1.348B, ₹70 crore, lakh, Rs 1,310 Crore, Rs. 2.13 billion, Rs 213.48 Cr', () => {
  const r = parseRange('revenue of $323M–$328M')!;
  assert.equal(r.low, 323); assert.equal(r.high, 328); assert.equal(r.currency, 'USD'); assert.equal(r.absoluteLow, 323_000_000); assert.equal(r.absoluteHigh, 328_000_000);
  const r2 = parseRange('$3.325 billion to $3.4 billion')!;
  assert.equal(r2.absoluteLow, 3_325_000_000); assert.equal(r2.absoluteHigh, 3_400_000_000);
  assert.equal(parseAmount('$1.348B')!.absolute, 1_348_000_000);
  assert.equal(toMoney(parseAmount('$90M'))!.value, 90);
  const inr = toMoney(parseAmount('Rs 213.48 Cr'))!;
  assert.equal(inr.unit, 'INR_CRORE'); assert.equal(inr.value, 213.48); assert.equal(inr.normalized_inr, 2_134_800_000);
  assert.equal(toMoney(parseAmount('₹70 crore'))!.value, 70);
  assert.equal(toMoney(parseAmount('Rs 1,310 Crore'))!.value, 1310);
  assert.equal(toMoney(parseAmount('Rs. 2.13 billion'))!.value, 213);
  assert.equal(toMoney(parseAmount('Rs 24 lakh'))!.value, 0.24);
  assert.equal(parseAmount('Rs 24 lakh')!.magnitude, 'lakh');
  const rr = parseRange('Rs 10 to 12 crore')!;
  assert.equal(rr.low, 10); assert.equal(rr.high, 12); assert.equal(rr.absoluteHigh, 120_000_000);
  assert.equal(parseAmount('Rs 213.48 Cr')!.raw, 'Rs 213.48 Cr');
});

test('3. bps, negative EPS, commas, negative ranges', () => {
  const b = parseAmount('gross margin expanded 120 basis points')!;
  assert.equal(b.value, 120); assert.equal(b.unit, 'bps');
  assert.equal(parseAmount('50 bps')!.unit, 'bps');
  assert.equal(parseAmount('diluted EPS of $(0.12)')!.value, -0.12);
  assert.equal(parseAmount('diluted EPS -$0.02')!.value, -0.02);
  assert.equal(parseAmount('diluted loss per share of (0.07)')!.value, -0.07);
  assert.equal(parseAmount('a loss of −$0.07')!.value, -0.07);
  assert.equal(parseAmount('12,345,678 shares')!.value, 12345678);
  const nr = parseRange('a decline of -5% to -3%')!;
  assert.equal(nr.low, -5); assert.equal(nr.high, -3);
  const all = parseAllAmounts('Revenue $163.3M vs $129.6M, net income $33.9M');
  assert.deepEqual(all.map((a) => a.value), [163.3, 129.6, 33.9]);
  assert.equal(parseAmount('no number here'), null);
});

// ═══ 12. TYPED METRICS ════════════════════════════════════════════════════

test('12. BlackBerry: net income up 154.9% is net_income_growth - not revenue growth, not a margin', () => {
  const ms = extractMetrics('Revenue $163.3M vs $129.6M a year ago (+26.0%) · Net income $33.9M vs $13.3M (up 154.9%) · Operating margin 20.6% vs 8.9%');
  const byName = Object.fromEntries(ms.map((m) => [m.name, m]));
  assert.equal(byName.net_income_growth.value, 154.9);
  assert.equal(byName.net_income_growth.raw, '154.9%');
  assert.equal(byName.revenue_growth.value, 26);
  assert.ok(!ms.some((m) => m.name === 'revenue_growth' && m.value === 154.9));
  assert.ok(ms.some((m) => m.name === 'operating_margin' && m.direction === 'level' && m.value === 20.6));
  const sq = extractMetrics('Revenue increased 26% year-over-year to $163 million and net income was up 154.9%');
  assert.equal(sq.find((m) => m.name === 'revenue_growth')!.value, 26);
  assert.equal(sq.find((m) => m.name === 'net_income_growth')!.value, 154.9);
});

test('12. CBRL: revenue -2.2% and net income +80.7% stay separate, named, signed', () => {
  const ms = extractMetrics('Revenue -2.2% and net income +80.7% versus a year ago.');
  assert.deepEqual(ms.map((m) => [m.name, m.value, m.direction]), [['revenue_growth', -2.2, 'decline'], ['net_income_growth', 80.7, 'growth']]);
  const t = extractMetrics('Adjusted EBITDA margin was 7.3% compared to 6.4% and net income up 80.7%');
  assert.ok(t.some((m) => m.name === 'ebitda_margin' && m.value === 7.3 && m.direction === 'level'));
  assert.ok(t.some((m) => m.name === 'net_income_growth' && m.value === 80.7));
  const loss = extractMetrics('Net loss margin of 0.6%')[0];
  assert.equal(loss.value, -0.6);
});

test('12. taxonomy: net income growth is its own catalyst with typed metrics beside the figures', () => {
  const h = classifyUsEvents('Revenue increased 26% year-over-year to $163 million; net income of $33.9 million was up 154.9%.');
  const ids = h.map((x) => x.id);
  assert.ok(ids.includes('revenue_growth') && ids.includes('profit_growth'), ids.join(','));
  const pg = h.find((x) => x.id === 'profit_growth')!;
  assert.ok(pg.metrics!.some((m) => m.name === 'net_income_growth' && m.value === 154.9));
  assert.ok(pg.metrics!.some((m) => m.name === 'revenue_growth' && m.value === 26));
});

// ═══ 4 / 17. GUIDANCE VS ACTUAL ═══════════════════════════════════════════

const SFIX_EX = 'Stitch Fix Announces Fourth Quarter and Full Fiscal Year 2026 Financial Results. Net revenue was $324.4 million, up 4.2% from $311.2 million a year ago. Net loss was $2.07 million compared to a net loss of $8.58 million. Diluted loss per share was $0.02. '
  + 'First Quarter Fiscal 2027 Outlook: Net revenue of $323 million to $328 million. Adjusted EBITDA of $3 million to $6 million. Gross margin of 43% to 44%. Fiscal 2026 net revenue was $1.348 billion for the twelve months ended.';

test('4. Stitch Fix: a Q1 outlook is never compared with twelve-month revenue (was -76%)', () => {
  const g = guidanceCheck({ guidance: { low: 323, high: 328, period: 'first quarter of fiscal 2027' }, actual: { value: 1348, period: 'the last twelve months', yearEnd: true } });
  assert.equal(g.comparable, false);
  assert.equal(g.changePct, null);
  assert.match(g.display, /comparison unavailable/);
  assert.match(g.display, /new outlook — direction cannot be inferred/);
  assert.doesNotMatch(g.display, /-7\d/);
});

test('4. guidance comparison only when period basis matches: FY vs FY, Q vs same Q a year earlier', () => {
  const fy = guidanceCheck({ guidance: { low: 3325, high: 3400, period: 'FY2027' }, actual: { value: 3318.7, period: 'FY2026' } });
  assert.equal(fy.comparable, true); assert.deepEqual(fy.changePct, { low: 0.2, high: 2.4 });
  const q = guidanceCheck({ guidance: { low: 143, high: 154, period: 'third fiscal quarter of fiscal 2027' }, actual: { value: 129.6, period: 'Q3 FY2026' } });
  assert.equal(q.comparable, true);
  const wrongQ = guidanceCheck({ guidance: { low: 143, high: 154, period: 'Q3 FY2027' }, actual: { value: 129.6, period: 'Q2 FY2026' } });
  assert.equal(wrongQ.comparable, false);
  const sameYear = guidanceCheck({ guidance: { low: 143, high: 154, period: 'Q3 FY2027' }, actual: { value: 129.6, period: 'Q3 FY2027' } });
  assert.equal(sameYear.comparable, false);
  const none = guidanceCheck({ guidance: { low: 1, high: 2, period: 'FY2027' }, actual: null });
  assert.equal(none.comparable, false); assert.match(none.display, /comparison unavailable/);
  assert.equal(periodBasisOf('trailing twelve months').kind, 'ttm');
  assert.equal(periodBasisOf('Q1 FY27').fiscalYear, 2027);
});

test('17. prior guidance: raised / maintained / cut only for the same period, else direction cannot be inferred', () => {
  const p = { low: 100, high: 110, period: 'FY2027' };
  assert.equal(guidanceCheck({ guidance: { low: 105, high: 115, period: 'FY2027' }, prior: p }).action, 'raised');
  assert.equal(guidanceCheck({ guidance: { low: 100, high: 110, period: 'FY2027' }, prior: p }).action, 'maintained');
  assert.equal(guidanceCheck({ guidance: { low: 90, high: 100, period: 'FY2027' }, prior: p }).action, 'cut');
  assert.equal(guidanceCheck({ guidance: { low: 105, high: 115, period: 'FY2028' }, prior: p }).action, 'unknown');
  assert.equal(guidanceCheck({ guidance: { low: 105, high: 115, period: 'FY2027' } }).action, 'new');
});

test('4. Stitch Fix card: outlook line has no forced percentage and says the comparison is unavailable', () => {
  const html = null;
  const e = readUsEarnings({ text: SFIX_EX, html, form: '8-K' });
  assert.ok(e, 'earnings read');
  const rev = e!.outlook.find((l) => /^revenue/i.test(l))!;
  assert.match(rev, /\$323M–\$328M/);
  assert.doesNotMatch(rev, /-76|-75|\d+\.\d% to/);
  assert.equal(e!.guidance, 'NEW');
  assert.ok(e!.guidanceCheck);
  assert.match(e!.guidanceCheck!.display, /new outlook — direction cannot be inferred/);
  assert.equal(outlookOf(SFIX_EX).action, 'NEW');
});

// ═══ 5. DOCUMENT VERIFICATION vs CATALYST CONFIRMATION ════════════════════

test('5. a verified SEC 8-K that contains the event is confirmed - never "not yet in an official filing"', () => {
  const v = verificationOf({ sourceKind: 'SEC_FILING', access: 'DOCUMENT_READ', eventInDocument: true });
  assert.deepEqual(v, { documentVerification: 'read', catalystConfirmation: 'confirmed_in_official_filing' });
  assert.equal(validateVerification(v.documentVerification, v.catalystConfirmation, { sourceKind: 'SEC_FILING', eventInDocument: true }), null);
  assert.match(validateVerification('summary_only', 'confirmed_in_official_filing') || '', /not read/);
  assert.match(validateVerification('read', 'press_unconfirmed', { sourceKind: 'SEC_FILING', eventInDocument: true }) || '', /cannot be "not yet in an official filing"/);
  assert.equal(reconcileStateLabel('Identified — not yet in an official filing', 'confirmed_in_official_filing'), 'Identified — confirmed in an official filing that was read');
  assert.equal(reconcileStateLabel('Identified — not yet in an official filing', 'press_unconfirmed'), 'Identified — not yet in an official filing');
  assert.deepEqual(verificationOf({ sourceKind: 'PRESS', access: 'SUMMARY_ONLY', eventInDocument: false }), { documentVerification: 'summary_only', catalystConfirmation: 'press_unconfirmed' });
  assert.equal(verificationOf({ sourceKind: 'EXCHANGE_FILING', access: 'SUMMARY_ONLY', eventInDocument: false }).catalystConfirmation, 'filed_document_unread');
  assert.doesNotMatch(Object.values(CATALYST_CONFIRMATION_LABEL)[0], /not yet/);
});

test('5. every US card built from a read SEC filing carries document_verification=read and confirmation=confirmed', () => {
  for (const [ticker, text, items] of [['BUR', BURFORD, ['7.01']], ['NKTR', NEKTAR, ['8.01']], ['SFIX', SFIX_EX, ['2.02', '9.01']]] as Array<[string, string, string[]]>) {
    const c = buildUsCard({ ticker, company: `${ticker} Inc.`, marketCapM: 1000, filing: filing('8-K', items), docs: [doc('ex99', `${text}${PAD}`)], secChecked: true })!;
    assert.equal(c.documentVerification, 'read', ticker);
    assert.equal(c.catalystConfirmation, 'confirmed_in_official_filing', ticker);
    assert.match(c.catalystConfirmationLabel!, /^Confirmed in an official filing/, ticker);
    assert.deepEqual(c.validationErrors, [], ticker);
  }
});

// ═══ 6. NO "NO CATALYST" WHEN AN EVENT WAS EXTRACTED ══════════════════════

const PBLS = 'Parabilis Medicines Announces Presentation at the Connective Tissue Oncology Society Annual Meeting. The presentation is scheduled for Saturday, October 24 during a sarcoma-focused Proffered Paper session beginning at 2:45pm CEST (8:45am ET). Parabilis Medicines is a clinical-stage biotechnology company.';

test('6. PBLS: a scheduled presentation is "event found, low information" - the card does not say "no catalyst found"', () => {
  const c = buildUsCard({ ticker: 'PBLS', company: 'Parabilis Medicines, Inc.', marketCapM: 900, filing: filing('8-K', ['7.01', '9.01'], '2026-09-15'), docs: [doc('primary', `FORM 8-K Item 7.01 Regulation FD Disclosure. On September 15, 2026 the Company issued a press release. ${PAD}`), doc('ex99', `${PBLS}${PAD}`)], secChecked: true, windowDays: 21 })!;
  assert.equal(c.catalystStatus!.status, 'event_found_low_information');
  assert.match(c.catalystStatus!.sentence, /Event found/);
  assert.match(c.catalystStatus!.sentence, /no material operating catalyst found/);
  assert.match(c.catalystStatus!.sentence, /SEC 8-K/);
  assert.match(c.catalystStatus!.sentence, /last 21 days/);
  assert.doesNotMatch(`${c.catalystStatus!.sentence} ${c.extra.join(' ')}`, /No catalyst found in/i);
  assert.ok(!c.extra.some((x) => /^Catalyst scan: no catalyst found/i.test(x)));
});

test('6. status vocabulary: no_event_found says what was searched and how far back', () => {
  const none = catalystSearchResult({ eventExtracted: false, sources: ['SEC EDGAR', 'press headlines'], lookbackDays: 21 });
  assert.equal(none.status, 'no_event_found');
  assert.match(none.sentence, /No catalyst found in filings or news — searched SEC EDGAR, press headlines over the last 21 days/);
  assert.equal(catalystSearchResult({ eventExtracted: true, verified: false, sources: ['press'], lookbackDays: 7 }).status, 'event_found_unverified');
  assert.equal(catalystSearchResult({ eventExtracted: true, verified: true, material: true, sources: ['SEC 8-K'], lookbackDays: 7 }).status, 'confirmed_material_event');
  assert.equal(catalystSearchResult({ eventExtracted: true, verified: true, lowInformation: true, sources: ['SEC 8-K'] }).status, 'event_found_low_information');
  assert.equal(catalystSearchResult({ eventExtracted: true, verified: true, sources: ['SEC 8-K'] }).status, 'event_found_not_market_moving');
  const w = catalystSearchResult({ eventExtracted: true, verified: true, lowInformation: true, sources: ['SEC 8-K'] });
  assert.doesNotMatch(w.sentence, /No catalyst found in filings or news/);
});

test('6. India card records what was searched; an event never reads as no_event_found', () => {
  const none = buildIndiaCard({ filings: [], press: [], now: new Date('2026-09-25T10:00:00Z'), windowDays: 21 });
  assert.equal(none.summary, 'No catalyst found in filings or news');
  assert.equal(none.catalystStatus, 'no_event_found');
  assert.equal(none.searched!.lookbackDays, 21);
  assert.match(none.searched!.sources.join(' '), /exchange filings/);
  const routine = buildIndiaCard({ filings: [{ subject: 'Trading Window Closure', summary: null, url: 'u', dateIso: '2026-09-24' }], press: [], now: new Date('2026-09-25T10:00:00Z'), windowDays: 21 });
  assert.notEqual(routine.catalystStatus, 'no_event_found');
});

// ═══ 7 / 8. CLUSTERS ══════════════════════════════════════════════════════

const BB = 'Waterloo, Ontario - BlackBerry Limited today reported financial results for the three months ended August 31, 2026. Revenue increased 26% year-over-year to $163 million. '
  + 'QNX delivered record quarterly revenue and secured its first Alloy Kore TM design win, the largest design win in QNX history. '
  + 'Generated $29 million operating cash flow; delivered sixth consecutive quarter of positive GAAP net income and Adjusted EPS exceeded expectations. '
  + 'Net income of $33.9 million was up 154.9% compared to $13.3 million. Raised fiscal year 2027 revenue and Adjusted EBITDA outlook following strong first-half execution.';

test('7. BlackBerry: ten labels from one release are ONE earnings cluster with child facts', () => {
  const c = buildUsCard({ ticker: 'BB', company: 'BlackBerry Limited', marketCapM: 3000, filing: filing('8-K', ['2.02', '9.01'], '2026-09-24'), docs: [doc('ex99', `${BB}${PAD}`, '000107023526000112')], secChecked: true })!;
  const ids = (c.catalysts || []).map((x) => x.id);
  assert.ok(ids.length >= 4, `labels: ${ids.join(',')}`);
  assert.equal(c.clusters!.length, 1);
  assert.equal(c.clusters![0].primaryEventType, 'earnings');
  assert.equal(c.clusters![0].facts.length, ids.length);
  assert.equal(c.clusters![0].independentConfirmationCount, 1);
  assert.equal(c.independentSourceCount, 1);
  assert.ok(c.catalysts!.length === ids.length, 'the flat list still exists for older consumers');
});

test('8. clusterFacts counts independent filings, not sentences', () => {
  const f = (id: string, url: string, category = 'Earnings') => ({ id, label: id, category, url, source: 'SEC' as const });
  const cl = clusterFacts([f('revenue_growth', 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/a.htm'), f('record_results', 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/b.htm'), f('earnings_beat', 'https://www.sec.gov/Archives/edgar/data/1/000000000026000002/a.htm')]);
  assert.equal(cl.length, 2, 'two filings = two clusters');
  assert.equal(cl.reduce((n, c) => n + c.facts.length, 0), 3);
  assert.equal(countIndependentSources([{ url: 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/a.htm' }, { url: 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/ex99.htm' }]), 1);
  assert.equal(independentSourceKey('https://x.com/a?utm=1#f'), 'https://x.com/a');
});

const ge = (url: string, t: string): GainerEvent => ({ eventId: url, clusterId: '', market: 'US', ticker: 'BB', eventTime: t, detectedAt: t, catalyst: 'quarterly_result', informationStatus: 'new_information', attribution: 'company_specific', priceChangePct: 8, volumeRatio: null, sectorRelativePct: null, sources: [{ url, tier: 1 }], claims: [], materiality: 'high', structuralDuration: 'short' });
test('8. events: two sightings 60 hours apart across a 72h bucket edge are one event', () => {
  const edge = Math.ceil(Date.parse('2026-09-24T00:00:00Z') / (72 * 3600_000)) * 72 * 3600_000;
  const a = ge('https://a/1', new Date(edge - 30 * 3600_000).toISOString());
  const b = ge('https://a/2', new Date(edge + 30 * 3600_000).toISOString());
  assert.equal(clusterEvents([a, b]).length, 1);
  const far = ge('https://a/3', new Date(edge + 200 * 3600_000).toISOString());
  assert.equal(clusterEvents([a, b, far]).length, 2);
});

// ═══ 8 (clinical) ═════════════════════════════════════════════════════════

const KOD = 'Zenkuda and tabirafusp-ted Meet Primary Endpoints in Pivotal DAYBREAK Trial in wAMD. '
  + 'Zenkuda (tarcocimab tedromer) met the primary endpoint (p-value of 0.0007) demonstrating meaningful vision gains as well as rapid and sustained retinal drying with the majority of patients (54%) on 6-month dosing, establishing a first-line option. '
  + 'The trial enrolled 450 patients with wet age-related macular degeneration and compared Zenkuda with aflibercept. '
  + 'Retina specialist Dr. Smith said: “The Zenkuda results exceeded my expectations, delivering the clinical profile retina specialists are seeking.” Kodiak plans to submit a BLA in 2027.';

test('clinical (KOD): effect, p-value, sample size, comparator, dosing, next step from the text; safety not disclosed', () => {
  const f = extractClinicalFacts(KOD)!;
  assert.equal(f.endpointMet, 'met'); assert.equal(f.result, 'positive');
  assert.equal(f.pValue, 'p = 0.0007');
  assert.match(f.effectSize!, /54%/);
  assert.equal(f.dosingInterval, '6-month dosing');
  assert.equal(f.sampleSize, '450 patients');
  assert.equal(f.comparator, 'aflibercept');
  assert.match(f.nextStep!, /submit a BLA in 2027/);
  assert.equal(f.safety, null);
  assert.ok(f.notDisclosed.includes('safety'));
  assert.ok(f.lines.includes('Safety: not disclosed in the cited filing'));
  // a physician's quoted "exceeded my expectations" is not an earnings beat
  assert.ok(!classifyUsEvents(KOD).some((h) => h.id === 'earnings_beat'));
});

test('clinical (KOD/DFTX): the card shows the read-out instead of "amount unknown"', () => {
  const c = buildUsCard({ ticker: 'KOD', company: 'Kodiak Sciences Inc', marketCapM: 800, filing: filing('8-K', ['7.01', '9.01'], '2026-09-28'), docs: [doc('ex99', `${KOD}${PAD}`)], secChecked: true })!;
  assert.equal(c.kind, 'clinical');
  assert.equal(c.canonicalType, 'trial_result');
  assert.ok(c.clinical);
  assert.ok(c.extra.some((x) => /^Effect size: .*54%/.test(x)));
  assert.ok(c.extra.some((x) => x === 'Safety: not disclosed in the cited filing'));
  assert.ok(!c.unknowns.some((u) => /^Amount: not stated/.test(u)));
  assert.ok(c.unknowns.includes('Safety: not disclosed in the cited filing'));
  assert.match(c.material.how, /no dollar amount/);
});

const DFTX = 'Definium Therapeutics Announces Positive Topline Results from Phase 3 Panorama Study of DT120 ODT in Generalized Anxiety Disorder. Study met primary and all key secondary efficacy endpoints. This Presentation does not constitute an offering of, or a solicitation of an off er to purchase, securities of Definium and under no circumstances is it to be construed as a prospectus.';
test('clinical (DFTX): phase and indication read; the disclaimer is not an equity offering', () => {
  const f = extractClinicalFacts(DFTX)!;
  assert.equal(f.phase, 'Phase 3'); assert.match(f.indication!, /Generalized Anxiety Disorder/);
  assert.equal(f.endpointMet, 'met');
  assert.equal(f.effectSize, null);
  assert.ok(!classifyUsEvents(DFTX).some((h) => h.id === 'equity_offering'), 'offering disclaimer is boilerplate');
});

test('clinical (IONS): a partner Phase 3 interim read-out', () => {
  const f = extractClinicalFacts('Ionis announces positive interim data from partner Roche’s Phase 3 IMAgINATION study in IgA nephropathy (IgAN). Sefaxersen demonstrated statistically significant and clinically meaningful reductions in proteinuria (p<0.001) compared with placebo in 300 patients.')!;
  assert.equal(f.phase, 'Phase 3'); assert.equal(f.endpointMet, 'met'); assert.equal(f.comparator, 'placebo'); assert.match(f.pValue!, /p < 0\.001/);
  assert.equal(extractClinicalFacts('The Company held its annual meeting.'), null);
  assert.equal(extractClinicalFacts('The study did not meet its primary endpoint (p=0.21) in patients with sepsis.')!.result, 'negative');
});

// ═══ 9. ACQUISITIONS ══════════════════════════════════════════════════════

test('9. PTCT (price not stated): every economic line says "not disclosed in the cited filing"', () => {
  const ex = 'PTC Completes Acquisition of ST-920 Fabry Disease Gene Therapy. On September 21, 2026, PTC Therapeutics, Inc. completed the acquisition of ST-920. A rolling BLA submission to FDA for accelerated approval of ST-920 is expected to be completed in Q4 2026.';
  const c = buildUsCard({ ticker: 'PTCT', company: 'PTC Therapeutics, Inc.', marketCapM: 4000, filing: filing('8-K', ['2.01', '9.01'], '2026-09-21'), docs: [doc('primary', `FORM 8-K Item 2.01 Completion of Acquisition. ${ex}${PAD}`)], secChecked: true })!;
  assert.ok(c.acquisition, 'acquisition economics present');
  const a = c.acquisition!;
  for (const k of ['purchasePrice', 'upfrontCash', 'contingentConsideration', 'assumedLiabilities', 'financing', 'expectedContribution'] as const) assert.equal(a[k], 'not disclosed in the cited filing', k);
});

test('9. acquisition economics keep upfront cash, contingent consideration and assumed liabilities apart', () => {
  const d: any = { upfrontM: 61, contingentM: 25, totalValueM: null, perShare: null, exchangeRatio: null, funding: 'cash on hand', targetRevenueM: 40 };
  const a = acquisitionEconomics(d, 'The Company will assume approximately $12 million of liabilities of the target.');
  assert.equal(a.upfrontCash, '$61M'); assert.match(a.contingentConsideration, /^up to \$25M/);
  assert.equal(a.purchasePrice, 'not disclosed in the cited filing');
  assert.match(a.assumedLiabilities, /^stated: "The Company will assume/);
  assert.equal(a.financing, 'cash on hand');
  assert.match(a.expectedContribution, /target revenue about \$40M; earnings contribution not disclosed in the cited filing/);
});

// ═══ 10. AGE / CAUSAL WINDOW / EXCHANGE CALENDAR ══════════════════════════

test('10. official filing window is 3 days, press 1 day; older is context only', () => {
  const w = causalWindow({ itemDate: '2026-09-25', moveDate: '2026-09-28', official: true });
  assert.equal(w.status, 'inside_window'); assert.equal(w.ageDaysAtMove, 3); assert.equal(w.contextOnly, false);
  const old = causalWindow({ itemDate: '2026-09-24', moveDate: '2026-09-28', official: true });
  assert.equal(old.status, 'outside_window'); assert.equal(old.ageDaysAtMove, 4); assert.equal(old.contextOnly, true);
  assert.match(old.label, /^Context only/);
  assert.equal(causalWindow({ itemDate: '2026-09-27', moveDate: '2026-09-28', official: false }).status, 'inside_window');
  assert.equal(causalWindow({ itemDate: '2026-09-26', moveDate: '2026-09-28', official: false }).status, 'outside_window');
  assert.equal(causalWindow({ itemDate: '2026-09-20', moveDate: '2026-09-28', official: false, windowDays: 10 }).status, 'inside_window', 'configurable');
  assert.equal(causalWindow({ itemDate: null, moveDate: '2026-09-28', official: true }).status, 'unknown');
  assert.equal(causalWindow({ itemDate: '2026-09-29', moveDate: '2026-09-28', official: true }).contextOnly, true, 'after the move');
});

test('10. US card exposes the causal window when the move day is given', () => {
  const c = buildUsCard({ ticker: 'DFTX', company: 'Definium', marketCapM: 500, filing: filing('8-K', ['7.01'], '2026-09-14'), docs: [doc('ex99', `${DFTX}${PAD}`)], secChecked: true, moveDate: '2026-09-28' } as any)!;
  assert.equal(c.causal!.ageDaysAtMove, 14); assert.equal(c.causal!.status, 'outside_window'); assert.equal(c.causal!.contextOnly, true);
});

test('10. "today" is the exchange calendar: New York for US, Kolkata for India (not UTC)', () => {
  const t = new Date('2026-09-28T23:30:00Z');
  assert.equal(exchangeDate(t, 'IN'), '2026-09-29');
  assert.equal(exchangeDate(t, 'US'), '2026-09-28');
  const t2 = new Date('2026-09-28T02:30:00Z');
  assert.equal(exchangeDate(t2, 'US'), '2026-09-27');
  assert.equal(exchangeDate(t2, 'IN'), '2026-09-28');
  assert.equal(exchangeAgeDays('2026-09-25', new Date('2026-09-28T23:30:00Z'), 'IN'), 4);
  assert.equal(exchangeAgeDays('2026-09-25', new Date('2026-09-28T23:30:00Z'), 'US'), 3);
  assert.equal(exchangeDay('2026-09-29T01:14:00Z', 'US'), '2026-09-28');
  assert.equal(exchangeDay('2026-09-28T20:00:00Z', 'IN'), '2026-09-29');
  assert.equal(exchangeDay('2026-09-28', 'IN'), '2026-09-28');
  assert.equal(exchangeDay('not a date', 'IN'), null);
});

test('10. SEC filing date is the New York day, not the UTC day', () => {
  const r = secSourceRef({ issuer: 'BB', form: '8-K', date: '2026-09-29T01:30:00Z', url: 'https://www.sec.gov/Archives/edgar/data/1070235/000107023526000112/q2fy27ex-991.htm', access: 'DOCUMENT_READ', role: 'ex99' });
  assert.equal(r.date, '2026-09-28');
});

test('10. India card ages are IST calendar days and the causal window is measured to the IST session day', () => {
  const c = buildIndiaCard({ filings: [{ subject: 'Award of order worth Rs 90 crore from NHAI', summary: null, url: 'u', dateIso: '2026-09-22' }], press: [], now: new Date('2026-09-28T20:00:00Z'), windowDays: 21, causalWindowDays: 3, pressWindowDays: 1, sessionCloseIso: '2026-09-28T15:30:00+05:30' } as any);
  assert.equal(c.moveDate, '2026-09-28');
  const cat = c.catalysts[0];
  assert.equal(cat.ageDays, 7, '22 Sep -> 29 Sep IST (now is 01:30 IST on the 29th)');
  assert.equal(cat.ageDaysAtMove, 6);
  assert.equal(cat.causalWindowStatus, 'outside_window');
  assert.equal(cat.contextOnly, true);
});

// ═══ 11. INDIA NUMBERS AND IDENTITY ═══════════════════════════════════════

test('11. India money: Rs 213.48 Cr, Rs. 2.13 billion, Rs 1,310 Crore, ₹70 crore, lakh, INR bn', () => {
  assert.equal(moneyCr('Rs 213.48 Cr'), 213.48);
  assert.equal(moneyCr('Rs. 2.13 billion'), 213);
  assert.equal(moneyCr('Rs 1,310 Crore'), 1310);
  assert.equal(moneyCr('₹70 crore'), 70);
  assert.equal(moneyCr('Rs 24 lakh'), 0.24);
  assert.equal(moneyCr('INR 5 bn'), 500);
  assert.equal(moneyCr('bags Rs 2.13 billion power distribution contract in Punjab'), 213);
  assert.equal(moneyCr('20 crore shares'), null, 'a count, not money');
  assert.equal(figureCrore('Rs. 2.13 billion'), 213);
  assert.equal(moneyCr('an order of 5 billion units'), null);
});

test('11. numeric BSE codes stay codes; a ticker is never inferred from a name without a security-master match', () => {
  const a = resolveIssuer({ ticker: '544434', company: 'Neetu Yoshi Limited' });
  assert.equal(a.code, '544434'); assert.equal(a.ticker, null); assert.equal(a.name, 'Neetu Yoshi Limited'); assert.equal(a.display, 'Neetu Yoshi Limited (BSE 544434)');
  const b = resolveIssuer({ company: 'Sugs Lloyd Limited' });
  assert.equal(b.ticker, null); assert.equal(b.tickerBasis, null); assert.equal(b.display, 'Sugs Lloyd Limited');
  const c = resolveIssuer({ company: 'Sugs Lloyd Ltd.', securityMaster: { [normaliseCompanyName('Sugs Lloyd Limited')]: '544501' } });
  assert.equal(c.code, '544501'); assert.equal(c.ticker, null); assert.equal(c.tickerBasis, 'security_master');
  const d = resolveIssuer({ company: 'Sugs Lloyd Limited', securityMaster: { 'oriental rail infrastructure': 'ORIRAIL' } });
  assert.equal(d.ticker, null, 'no fuzzy or partial match');
  const e = resolveIssuer({ company: 'Oriental Rail Infrastructure Limited', securityMaster: { 'oriental rail infrastructure': 'ORIRAIL' } });
  assert.equal(e.ticker, 'ORIRAIL'); assert.equal(e.tickerBasis, 'security_master');
  assert.equal(resolveIssuer({ ticker: 'orirail', company: 'Oriental Rail' }).ticker, 'ORIRAIL');
  assert.equal(normaliseCompanyName('Sugs Lloyd Ltd.'), 'sugs lloyd');
});

// ═══ 14. SEC IDENTITY ═════════════════════════════════════════════════════

test('14. SEC source ref keeps accession, form, CIK, exhibit; an 8-K exhibit is an official filing, not press', () => {
  const r = secSourceRef({ issuer: 'BB', form: '8-K', items: ['2.02', '9.01'], date: '2026-09-24', url: 'https://www.sec.gov/Archives/edgar/data/1070235/000107023526000112/q2fy27ex-991.htm', access: 'DOCUMENT_READ', role: 'ex99' });
  assert.equal(r.accession, '0001070235-26-000112'); assert.equal(r.cik, '1070235'); assert.equal(r.formType, '8-K'); assert.equal(r.exhibit, '99.1');
  assert.match(secOfficialLabel(r), /^Official SEC filing - Exhibit 99\.1 press release, filed 2026-09-24 - accession 0001070235-26-000112$/);
  assert.equal(exhibitNumberOf('https://www.sec.gov/Archives/edgar/data/1/2/tmb-20260921x8k.htm', 'primary'), null);
  assert.match(secOfficialLabel({ ...r, exhibit: null }), /8-K body \(Item 2\.02, 9\.01\)/);
});

// ═══ scan: other bugs found ═══════════════════════════════════════════════

test('scan: "expected to be closed" is not a completed deal (us-extract stage)', () => {
  const t = 'On September 20, 2026, the Company entered into an Agreement and Plan of Merger with Acme Parent, LLC. The Merger is expected to be closed in the first quarter of 2027, subject to the approval of the Company’s stockholders. The Merger consideration is $9.50 per share in cash.';
  const f = extractUsFacts({ text: t, source: secSourceRef({ issuer: 'PRTH', form: '8-K', items: ['1.01'], date: '2026-09-21', url: 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/d8k.htm', access: 'DOCUMENT_READ', role: 'primary' }), form: '8-K', items: ['1.01'], issuerName: 'Priority Technology Holdings, Inc.' });
  const deal = f.find((x) => x.event.kind === 'acquisition' || x.event.kind === 'merger');
  if (deal) assert.notEqual(deal.event.stage, 'COMPLETED');
});

test('scan: canonical event builder - type from rules, values preserved, errors when the declared type contradicts the quote', () => {
  const ev = buildCanonicalEvent({ ticker: 'nktr', quote: 'The jury awarded the Company $90 million in damages plus interest.', tier: 'official_filing', filingDate: '2026-09-25', declaredType: 'order', values: [{ value: 90, unit: 'USD_M', source: 'filed', text: '$90 million' }] });
  assert.equal(ev.event_type, 'litigation'); assert.equal(ev.value_status, 'verified'); assert.ok(ev.validation_errors.length >= 1);
  const loi = buildCanonicalEvent({ ticker: 'sugs', quote: LOI_SUGS, tier: 'official_filing', values: [{ value: 213.48, unit: 'INR_CRORE', source: 'headline', text: 'Rs 213.48 crore' }, { value: 4.68, unit: 'INR_CRORE', source: 'filed', text: 'Rs 4.68 crore' }] });
  assert.equal(loi.event_type, 'loi'); assert.equal(loi.stage, 'proposed'); assert.equal(loi.value_status, 'conflicting'); assert.equal(loi.value, null); assert.equal(loi.values.length, 2); assert.equal(loi.conflicts.length, 1);
});

test('scan: withPressCatalysts flags a press amount that differs from the filed amount for the same event', () => {
  const ex = 'Acme Corp. today announced a five-year supply agreement valued at $60 million with a Tier 1 carrier.';
  const c0 = buildUsCard({ ticker: 'ACME', company: 'Acme Corp.', marketCapM: 400, filing: filing('8-K', ['8.01']), docs: [doc('ex99', `${ex} ${'The company serves enterprise customers. '.repeat(5)}`)], secChecked: true })!;
  const c = withPressCatalysts(c0, [{ title: 'Acme signs $600 million supply agreement', url: 'https://news.example/a', date: '2026-09-25', source: 'Wire' }]);
  assert.equal(c.valueStatus, 'conflicting');
  assert.match(c.conflicts!.join(' '), /\$600 million/);
  assert.equal(c.material.label, 'UNKNOWN');
});

test('scan: a US LOI/tentative order is PROPOSED, not an awarded order', () => {
  const ex = 'Acme Corp. today announced it received a non-binding letter of intent from a Tier 1 carrier for an order valued at $60 million, subject to a definitive agreement.';
  const c = buildUsCard({ ticker: 'ACME', company: 'Acme Corp.', marketCapM: 400, filing: filing('8-K', ['8.01']), docs: [doc('ex99', `${ex} ${'The company serves enterprise customers. '.repeat(5)}`)], secChecked: true })!;
  assert.notEqual(c.stage, 'AWARDED');
  assert.ok(c.stage === 'PROPOSED' || c.stage === 'UNKNOWN' || c.stage === 'SIGNED' || c.stage === 'EXECUTED' ? c.stage !== ('AWARDED' as string) : true);
});

test('scan: India classifier reads the LOI as planned', () => {
  const h = classifyIndiaEvents(LOI_SUGS).find((x) => x.id === 'order_win')!;
  assert.equal(h.planned, true);
  assert.deepEqual(h.figures, ['Rs 4.68 crore']);
});
