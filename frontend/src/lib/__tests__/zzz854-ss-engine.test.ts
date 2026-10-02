// zzz854 - Special Situations / radar ENGINE regression tests: metric ownership (target vs acquirer), classification by economic
// reality (acquisition / tender / going-private / spin-off / dividend / buyback), the spurious template '40%', title-copied deal
// fields, filing-exists-terms-not-read evidence, earnings result vs inflection, origin-based independence and the new QA rules.
// Synthetic names plus the public example names from the brief. No ticker is hardcoded in any logic exercised here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyseRadarItem, buildRadar, type RadarInput } from '../multibagger-radar';
import { KIND_LABEL, type RadarItem } from '../multibagger-radar-types';
import { qaErrorsOf, QA_CLASSES } from '../multibagger-radar-qa';
import { dealTargetNames, extractOwnedNumbers } from '../special-sit-numbers';
import { extractDealTerms, isTitleCopy } from '../special-sit-deal-terms';
import { eventToRadarInput } from '../multibagger-radar-adapter';

const mk = (o: Partial<RadarInput> & { title: string }): RadarInput => ({ id: o.id || 'x', ticker: null, company: 'Alphacorp', region: 'IN', sourceLabel: 'Economic Times', tickerResolved: true, ...o } as RadarInput);
const run = (o: Partial<RadarInput> & { title: string }) => analyseRadarItem(mk(o));
const blob = (r: RadarItem) => JSON.stringify(r);
const step = (r: RadarItem, name: string) => (r.evidenceChain || []).find((s) => s.step === name);
const qaOf = (r: RadarItem) => qaErrorsOf([r]).errors.map((e) => e.cls);
const PD = '2026-09-30T10:00:00Z';
const GP_TEMPLATE = { what_happened: 'ACME HOLDINGS INC filed an SC 13E-3 going-private transaction.', what_matters: 'Insider/PE buyout at premium to market — typical 20–40% premium for control.', what_to_watch: 'Fairness opinion · special committee independence', what_breaks_thesis: 'Inadequate price → minority dissent → litigation appraisal action.' };

describe('1 metric ownership: target vs acquirer', () => {
  const variants = [
    "ITC has invested ₹900 crore in Yoga Bar so far, taking full ownership. Revenue reached ₹452 crore in FY25.",
    "The FMCG major is betting on health foods. The brand's revenue reached ₹452 crore in FY25.",
    'ITC is expanding into health foods with Yoga Bar. Its revenue reached ₹452 crore in FY25.',
  ];
  for (const d of variants) {
    const r = run({ title: "ITC's ₹900 cr Yoga Bar bet", description: d, company: 'ITC' });
    test(`target revenue is the target's: ${d.slice(0, 50)}`, () => {
      const rev = (r.ownedNumbers || []).find((n) => n.metric === 'revenue');
      assert.equal(rev?.entityRole, 'target');
      assert.equal(rev?.entity, 'Yoga Bar');
      assert.equal(rev?.metricOwner, 'Yoga Bar');
      assert.equal(rev?.countsAsParentEarnings, false);
      assert.match(rev?.ownerLabel || '', /^Target \(Yoga Bar\) revenue ₹452 cr — not ITC's revenue; ITC's incremental revenue: Not established$/);
      assert.ok((r.metricOwnerLines || []).some((l) => /Target \(Yoga Bar\) revenue/.test(l)));
    });
    test(`never ITC's revenue, never near-direct, never a confirmed Revenue step: ${d.slice(0, 50)}`, () => {
      assert.notEqual(r.link, 'NEAR_DIRECT');
      assert.notEqual(r.link, 'DIRECT');
      assert.doesNotMatch(JSON.stringify(r.impacts), /452/);
      assert.equal(step(r, 'Revenue')?.state, 'not_established');
      assert.match(step(r, 'Revenue')?.detail || '', /Target \(Yoga Bar\) revenue .*not ITC's revenue; ITC's incremental revenue: Not established/);
      assert.match(r.financialOwner || '', /Yoga Bar \(target\), not ITC/);
      assert.match(r.sourceSubjectLine || '', /ITC \(acquirer\) and Yoga Bar \(target\)/);
      assert.deepEqual(qaOf(r), []);
    });
    test(`classified as Acquisition / investment, not New product / new market: ${d.slice(0, 50)}`, () => {
      assert.equal(r.kind, 'SPECIAL_SITUATION');
      assert.equal(r.subKind, 'ACQUISITION');
      assert.equal(KIND_LABEL[r.subKind!], 'Acquisition / investment');
      assert.ok(r.dealSubtype === 'ACQUISITION' || r.dealSubtype === 'STAKE_INVESTMENT');
      assert.equal(r.evidenceChainKind, 'ACQUISITION');
      assert.ok(['Closing', 'Consolidation'].every((s) => step(r, s)));
    });
  }
  test('the same headline through the feed adapter (live shape) stays an acquisition with target-owned revenue', () => {
    const inp = eventToRadarInput({ event_id: 'itc', event_type: 'MERGER', region: 'IN', primary_filing: { title: "From cigarettes to protein bars: ITC's ₹900 cr Yoga Bar bet as FMCG giant taps India's health-food boom", description: 'Revenue reached ₹452 crore in FY25, up 40%.', source: 'Livemint', pub_date: PD }, why_tradable: { what_happened: 'Definitive merger agreement signed for the issuer.', what_matters: 'Deal terms locked.' } } as any);
    const r = analyseRadarItem(inp);
    assert.equal(r.subKind, 'ACQUISITION');
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.doesNotMatch(JSON.stringify(r.impacts), /452/);
    assert.deepEqual(qaOf(r), []);
  });
  test('a parent-named figure is still the parent\'s', () => {
    const own = extractOwnedNumbers('Alphacorp to acquire Betafoods for Rs 500 crore', 'Alphacorp reported revenue of Rs 9,000 crore in FY25. Betafoods had revenue of Rs 80 crore.', 'ACQUISITION', 'Alphacorp');
    assert.equal(own.find((n) => n.raw.includes('9,000'))?.entityRole, 'parent');
    assert.equal(own.find((n) => n.raw.includes('80'))?.entityRole, 'target');
  });
  test('deal target names from deal wording', () => {
    assert.deepEqual(dealTargetNames("ITC's ₹900 cr Yoga Bar bet", 'ITC'), ['Yoga Bar']);
    assert.deepEqual(dealTargetNames('Alphacorp to buy 51% stake in Beta Systems', 'Alphacorp'), ['Beta Systems']);
    assert.deepEqual(dealTargetNames('Alphacorp acquires Gamma Ltd', 'Alphacorp'), ['Gamma Ltd']);
    assert.deepEqual(dealTargetNames('Alphacorp wins Rs 500 crore order', 'Alphacorp'), []);
  });
});

describe('2 capacity, deal value, order and forecast are not revenue', () => {
  test('capacity is not revenue', () => {
    const r = run({ title: 'Alphacorp to acquire 500 MW solar assets for Rs 2,400 crore', company: 'Alphacorp' });
    assert.doesNotMatch(r.impacts?.revenue || '', /500/);
    const cap = (r.ownedNumbers || []).find((n) => n.metric === 'capacity');
    assert.ok(cap && !cap.countsAsParentEarnings);
    assert.equal(cap?.nature, 'capacity');
    assert.notEqual(step(r, 'Revenue')?.state, 'confirmed');
    const own = run({ title: 'Alphacorp commissions new 500 MW plant with customer offtake contract', company: 'Alphacorp', sourceLabel: 'NSE filing' });
    assert.match(own.impacts?.volume || '', /capacity, not volume sold or revenue/);
  });
  test('deal value is not earnings', () => {
    const r = run({ title: 'Alphacorp to acquire Betaworks for Rs 1,000 crore', company: 'Alphacorp', sourceLabel: 'NSE filing' });
    assert.equal(r.link, 'NOT_ESTABLISHED');
    assert.equal((r.ownedNumbers || []).filter((n) => n.countsAsParentEarnings).length, 0);
    assert.ok((r.metricOwnerLines || []).some((l) => /Deal value Rs 1,000 cr — consideration paid, not revenue/.test(l)), JSON.stringify(r.metricOwnerLines));
    assert.equal(r.parentImpactLine, 'Alphacorp incremental revenue / EBITDA / PAT: Not established');
  });
  test('an order is not revenue', () => {
    const r = run({ title: 'Alphacorp wins Rs 500 crore order from a state utility', company: 'Alphacorp', sourceLabel: 'NSE filing' });
    assert.match(r.impacts?.revenue || '', /Order value Rs 500 crore .*an order, not revenue/);
    assert.notEqual(step(r, 'Revenue')?.state, 'confirmed');
    assert.ok((r.metricOwnerLines || []).some((l) => /order value Rs 500 cr — an order, not revenue/.test(l)), JSON.stringify(r.metricOwnerLines));
  });
  test('a management forecast is not a reported figure', () => {
    const own = extractOwnedNumbers('Alphacorp expects revenue of Rs 1,000 crore by FY28', '', 'OTHER', 'Alphacorp');
    const n = own.find((x) => x.metric === 'revenue');
    assert.equal(n?.nature, 'forecast');
    assert.equal(n?.countsAsParentEarnings, false);
  });
});

describe('3 dividend and buyback', () => {
  test('a dividend is a corporate action', () => {
    const r = run({ title: 'Alphacorp declares Rs 5 per share interim dividend; record date fixed', company: 'Alphacorp' });
    assert.equal(r.kind, 'CORPORATE_ACTION');
    assert.equal(r.economicPayoff, 'Shareholder cash return');
    assert.equal(r.link, 'NOT_APPLICABLE');
    assert.equal(r.bucket, 'CORPORATE_ACTION');
  });
  test('a dividend in a result headline is context, not a catalyst', () => {
    const r = run({ title: 'HUDCO Q1 results: Profit jumps 35%, dividend declared', company: 'HUDCO', sourceLabel: 'NDTV Profit' });
    assert.equal(r.kind, 'EARNINGS_RESULT');
    assert.ok((r.contextFacts || []).some((c) => /Dividend declared in the same headline: a shareholder cash return, not a catalyst/.test(c)));
    assert.notEqual(r.secondaryKind, 'CORPORATE_ACTION');
  });
  test('a buyback is a shareholder payoff with no earnings link', () => {
    const r = run({ title: 'Alphacorp board approves buyback of Rs 500 crore at Rs 1,200 per share via tender offer', company: 'Alphacorp', sourceLabel: 'NSE filing' });
    assert.equal(r.kind, 'SPECIAL_SITUATION');
    assert.equal(r.subKind, 'BUYBACK');
    assert.equal(r.link, 'NOT_APPLICABLE');
    assert.equal(r.evidenceChainKind, 'BUYBACK');
  });
});

const secEvent = (id: string, form: string, company: string, cik: string, extra: Record<string, unknown> = {}) => ({
  event_id: id, event_type: (extra.event_type as string) || 'TENDER_OFFER', region: 'US', primary_source: true,
  primary_filing: { title: `${form} - ${company} (${cik}) (Subject)`, source: 'SEC EDGAR', link: `https://www.sec.gov/Archives/edgar/data/${cik}/${id}.txt`, pub_date: PD, description: extra.description },
  filings: extra.filings, why_tradable: extra.why_tradable,
});

describe('4 tender offers, going-private and spin-off (form-only filings)', () => {
  const tot = analyseRadarItem(eventToRadarInput(secEvent('tot', 'SC TO-T', 'STURM RUGER & CO INC', '0000095029', {
    filings: [
      { title: 'SC TO-T - STURM RUGER & CO INC (0000095029) (Subject)', source: 'SEC EDGAR', link: 'https://www.sec.gov/Archives/edgar/data/95029/a1.txt', pub_date: PD },
      { title: 'SC TO-T - Beretta Holding S.A. (0001234567) (Filed by)', source: 'SEC EDGAR', link: 'https://www.sec.gov/Archives/edgar/data/1234567/a1.txt', pub_date: PD },
    ],
  }) as any));
  test('third-party tender: own chain, acquirer = filed by, target = subject', () => {
    assert.equal(tot.dealSubtype, 'THIRD_PARTY_TENDER');
    assert.equal(tot.subKind, 'TENDER_OFFER');
    assert.ok((tot.dealTermLines || []).some((l) => l.label === 'Acquirer (filed by)' && /Beretta/.test(l.value)));
    assert.ok((tot.dealTermLines || []).some((l) => l.label === 'Target (subject company)' && /Sturm Ruger/i.test(l.value)));
    assert.ok(step(tot, 'Bidder (acquirer)'));
    assert.match(tot.economicPayoff || '', /Tender payoff/);
    assert.match(tot.financialOwner || '', /^Not applicable/);
  });
  test('a bare form title proves only that a filing exists', () => {
    assert.equal(tot.termsRead, false);
    assert.equal(tot.evidenceLabel, 'Filing exists — terms not read');
    assert.notEqual(tot.evidence.status, 'CONFIRMED');
    assert.equal(tot.stageNumber, 1);
    assert.equal(tot.stageLabel, 'Filing exists — terms not read');
    assert.ok((tot.dealTermLines || []).filter((l) => !l.stated).every((l) => l.value === 'Terms not read — filing not opened'));
    assert.match(tot.proof.what, /^Open the SC TO-T and record .*offer price.*expiry.*minimum tender condition/);
    assert.equal(tot.whyNow, 'SC TO-T filed 2026-09-30 (filing date); its terms have not been read yet.');
    assert.deepEqual(qaOf(tot), []);
  });
  test('terms present in the filing text are extracted (offer price, expiry); missing ones say "Not stated in filing"', () => {
    const r = analyseRadarItem(eventToRadarInput(secEvent('tot2', 'SC TO-T', 'ACV AUCTIONS INC', '0001637873', { description: 'Copart Inc. offers to purchase all outstanding shares of ACV Auctions Inc. at $12.50 per share in cash. The offer will expire on November 15, 2026, unless extended.' }) as any));
    assert.equal(r.termsRead, true);
    assert.ok((r.dealTermLines || []).some((l) => l.label === 'Offer price' && /\$12\.50 per share/.test(l.value)), JSON.stringify(r.dealTermLines));
    assert.ok((r.dealTermLines || []).some((l) => l.label === 'Expiry' && /November 15, 2026/.test(l.value)));
    assert.ok((r.dealTermLines || []).some((l) => l.value === 'Not stated in filing'));
    assert.notEqual(r.evidenceLabel, 'Filing exists — terms not read');
  });
  const toi = analyseRadarItem(eventToRadarInput(secEvent('toi', 'SC TO-I', 'JONES FINANCIAL COMPANIES LLLP', '0000815917') as any));
  test('issuer tender: own chain and wording; Financing never copies the title', () => {
    assert.equal(toi.dealSubtype, 'ISSUER_TENDER');
    assert.ok(step(toi, 'Security sought'));
    const fin = (toi.dealTermLines || []).find((l) => l.label === 'Financing');
    assert.ok(fin && !fin.stated, JSON.stringify(fin));
    assert.doesNotMatch(fin!.value, /JONES|SC TO-I/);
    assert.match(toi.proof.what, /which security is sought/);
    assert.deepEqual(qaOf(toi), []);
  });
  const gp = analyseRadarItem(eventToRadarInput(secEvent('gp', 'SC 13E3', 'ACME HOLDINGS INC', '0000123456', { event_type: 'GOING_PRIVATE', why_tradable: GP_TEMPLATE }) as any));
  test('SC 13E3 is going-private, not a tender, with its own chain', () => {
    assert.equal(gp.dealSubtype, 'GOING_PRIVATE');
    assert.equal(gp.subKind, 'GOING_PRIVATE');
    assert.equal(gp.evidenceChainKind, 'GOING_PRIVATE');
    assert.ok(step(gp, 'Majority-of-minority vote'));
    assert.match(gp.economicPayoff || '', /Going-private payoff/);
    assert.match(gp.proof.what, /^Open the SC 13E3 and record the consideration per share/);
  });
  test('the 40% bug: no number from the feed\'s template text is ever extracted', () => {
    assert.doesNotMatch(gp.financialImpact, /40%/);
    assert.ok(!(gp.ownedNumbers || []).some((n) => /40/.test(n.raw)));
    assert.doesNotMatch(JSON.stringify([gp.financialImpact, gp.impacts, gp.dealTermLines, gp.evidenceChain, gp.whyNow, gp.breakConditions]), /40%|20–40|Inadequate price/);
    // engine-level, without the adapter: what_matters is commentary even when the feed does not flag it
    const raw = run({ title: 'SC 13E3 - ACME HOLDINGS INC (0000123456) (Subject)', company: 'ACME HOLDINGS INC', region: 'US', sourceLabel: 'SEC EDGAR', primarySource: true, eventType: 'GOING_PRIVATE', feedFacts: GP_TEMPLATE });
    assert.doesNotMatch(raw.financialImpact, /40%/);
    assert.doesNotMatch(blob(raw), /The source states: 40%/);
  });
  const spin = analyseRadarItem(eventToRadarInput(secEvent('spin', '10-12B', 'Archer SpinCo Inc', '0002000001', { event_type: 'SPIN_OFF' }) as any));
  test('10-12B spin-off: own wording, dated why-now, concrete proof', () => {
    assert.equal(spin.dealSubtype, 'SPIN_OFF');
    assert.equal(spin.subKind, 'SPIN_DEMERGER');
    assert.match(spin.whyNow || '', /^10-12B filed 2026-09-30 \(filing date\)/);
    assert.match(spin.proof.what, /distribution ratio, the record date/);
    assert.match(spin.economicPayoff || '', /Spin-off payoff/);
  });
});

describe('5 title-copied deal fields', () => {
  test('a financing sentence never matches a company name with "Financial" in it', () => {
    const t = extractDealTerms('SC TO-I - JONES FINANCIAL COMPANIES LLLP (0000815917) (Subject). ', 'TENDER');
    assert.equal(t.fields.financing, undefined);
    assert.ok(t.missing.includes('financing'));
  });
  test('isTitleCopy catches the headline and SEC form headers', () => {
    assert.equal(isTitleCopy('SC TO-I - JONES FINANCIAL COMPANIES LLLP (0000815917) (Subject).'), true);
    assert.equal(isTitleCopy('Alphacorp to acquire Beta', 'Alphacorp to acquire Beta'), true);
    assert.equal(isTitleCopy('The offer is financed with cash on hand.', 'Alphacorp tender offer'), false);
  });
  test('feed-supplied deal terms that copy the title are dropped by the engine', () => {
    const title = 'SC TO-I - JONES FINANCIAL COMPANIES LLLP (0000815917) (Subject)';
    const r = run({ title, company: 'JONES FINANCIAL COMPANIES LLLP', region: 'US', sourceLabel: 'SEC EDGAR', primarySource: true, eventType: 'TENDER_OFFER', dealTerms: { kind: 'TENDER', fields: { financing: `${title}.` }, statedConditions: [`${title}.`], missing: [] } } as any);
    const fin = (r.dealTermLines || []).find((l) => l.label === 'Financing');
    assert.ok(fin && !fin.stated);
    assert.deepEqual(qaOf(r).filter((c) => c === 'title-copied field'), []);
  });
});

describe('6 earnings result vs inflection', () => {
  test('secondary-only headline: Earnings result (unverified), direction not established, read the filing', () => {
    for (const t of ['Vedanta Aluminium profit surges three-fold', 'HUDCO Q1 results: Profit jumps 35%, dividend declared', 'Epsilon Q1 net profit jumps 60%, revenue up 30%']) {
      const r = run({ title: t, company: t.split(' ')[0] });
      assert.equal(r.kind, 'EARNINGS_RESULT', t);
      assert.equal(r.resultVerified, false);
      assert.equal(r.resultLabel, 'Earnings result (unverified)');
      assert.equal(r.catalystDirection, 'unknown');
      assert.ok(!['strong', 'moderate'].includes(String(r.inflectionStrength)));
      assert.notEqual(r.bucket, 'EARNINGS_INFLECTION');
      assert.match(r.nextStep || '', /read the official result filing/);
      assert.match(r.proof.what, /^Read the filing/);
      assert.match(r.whyNow || '', /filing has not been read/);
      assert.notEqual(step(r, 'Profit (PAT)')?.state, 'confirmed');
      assert.deepEqual(qaOf(r), [], t);
    }
  });
  test('primary source with revenue and profit change -> inflection; primary with profit only -> not an inflection', () => {
    const full = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon', sourceLabel: 'NSE filing' });
    assert.equal(full.bucket, 'EARNINGS_INFLECTION');
    assert.equal(full.resultLabel, 'Earnings inflection');
    const half = run({ title: 'Epsilon Q1 net profit jumps 60%', company: 'Epsilon', sourceLabel: 'NSE filing' });
    assert.notEqual(half.bucket, 'EARNINGS_INFLECTION');
    assert.match(half.resultLabel || '', /incomplete/);
  });
  test('two independent origins verify a media result; two outlets copying one origin do not', () => {
    const two = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon', independentOrigins: 2 } as any);
    assert.equal(two.resultVerified, true);
    assert.equal(two.bucket, 'EARNINGS_INFLECTION');
    const copies = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon', independentSources: 4 });
    assert.equal(copies.resultVerified, false);
    assert.notEqual(copies.bucket, 'EARNINGS_INFLECTION');
  });
  test('"all-time high" never changes the class, bucket, link or priority', () => {
    for (const base of ['Vedanta Aluminium profit surges three-fold', 'Epsilon Q1 net profit jumps 60%, revenue up 30%']) {
      for (const src of [{}, { sourceLabel: 'NSE filing' }]) {
        const a = run({ title: base, company: 'Vedanta Aluminium', ...src });
        const b = run({ title: `${base}; shares hit all-time high`, company: 'Vedanta Aluminium', ...src });
        assert.equal(b.kind, a.kind, base);
        assert.equal(b.bucket, a.bucket, base);
        assert.equal(b.link, a.link, base);
        assert.equal(b.priority, a.priority, base);
        assert.ok((b.contextFacts || []).some((c) => /Price context only, not evidence: hit all-time high/i.test(c)), JSON.stringify(b.contextFacts));
      }
    }
  });
});

describe('7 independence by origin, not outlet count', () => {
  test('outlet count never raises evidence or priority', () => {
    const one = run({ title: 'Kappa Ltd wins order worth $10 million from a customer', independentSources: 1 });
    const five = run({ title: 'Kappa Ltd wins order worth $10 million from a customer', independentSources: 5 });
    assert.equal(five.evidence.status, one.evidence.status);
    assert.equal(five.priority, one.priority);
    assert.equal(five.evidence.independentOrigins, 1);
    assert.equal(five.evidence.originBasis, 'conservative');
  });
  test('origin ids decide independence', () => {
    const sources = [
      { label: 'Daily Alpha', url: 'https://a.example/1', title: 'Kappa wins order', originId: 'pr-1' },
      { label: 'Beta Times', url: 'https://b.example/1', title: 'Kappa bags contract', originId: 'pr-1' },
      { label: 'Gamma News', url: 'https://c.example/1', title: 'Kappa order details', originId: 'pr-1' },
    ];
    const same = run({ title: 'Kappa Ltd wins order worth $10 million', sources } as any);
    assert.equal(same.evidence.independentOrigins, 1);
    assert.equal(same.evidence.status, 'HYPOTHESIS');
    const diff = run({ title: 'Kappa Ltd wins order worth $10 million', sources: sources.map((s, i) => ({ ...s, originId: `o${i}` })) } as any);
    assert.equal(diff.evidence.independentOrigins, 3);
    assert.equal(diff.evidence.status, 'STRONG');
  });
});

describe('8 automatic QA rules (each one fires on a broken item)', () => {
  const good = run({ title: 'Alphacorp to acquire Betaworks for Rs 1,000 crore', description: 'Betaworks had revenue of Rs 300 crore in FY25.', company: 'Alphacorp' });
  const fire = (bad: RadarItem) => new Set(qaErrorsOf([bad]).errors.map((e) => e.cls));
  test('the new classes are registered', () => {
    for (const c of ['evidence strong but primary not read', 'earnings link without a subject-owned earnings number', 'target metric attributed to acquirer', 'title-copied field', 'inflection from unverified secondary']) assert.ok((QA_CLASSES as readonly string[]).includes(c), c);
  });
  test('the good item is clean', () => assert.deepEqual(qaOf(good), []));
  test('evidence strong but primary not read', () => {
    assert.ok(fire({ ...good, termsRead: false, evidenceLabel: 'Confirmed', evidence: { ...good.evidence, status: 'CONFIRMED', sourceRank: 1 }, stageNumber: 3 }).has('evidence strong but primary not read'));
  });
  test('earnings link without a subject-owned number', () => {
    assert.ok(fire({ ...good, kind: 'EARNINGS_RESULT', link: 'DIRECT' }).has('earnings link without a subject-owned earnings number'));
    assert.ok(fire({ ...good, link: 'NEAR_DIRECT' }).has('earnings link without a subject-owned earnings number'));
    // a stated multiple ('three-fold') is a subject-owned figure
    const r = run({ title: 'Vedanta Aluminium profit surges three-fold', company: 'Vedanta Aluminium', sourceLabel: 'NSE filing' });
    assert.ok((r.ownedNumbers || []).some((n) => n.entityRole === 'parent' && n.metric === 'pat' && n.unit === 'x'));
  });
  test('target metric attributed to acquirer', () => {
    const chain = (good.evidenceChain || []).map((s) => (s.step === 'Revenue' ? { ...s, state: 'confirmed' as const } : s));
    assert.ok(fire({ ...good, evidenceChain: chain }).has('target metric attributed to acquirer'));
    assert.ok(fire({ ...good, financialOwner: 'Alphacorp' }).has('target metric attributed to acquirer'));
  });
  test('title-copied field', () => {
    const lines = [...(good.dealTermLines || []), { label: 'Financing', value: 'SC TO-I - JONES FINANCIAL COMPANIES LLLP (0000815917) (Subject).', stated: true }];
    assert.ok(fire({ ...good, dealTermLines: lines }).has('title-copied field'));
  });
  test('inflection from unverified secondary', () => {
    const r = run({ title: 'Epsilon Q1 net profit jumps 60%, revenue up 30%', company: 'Epsilon' });
    assert.ok(fire({ ...r, bucket: 'EARNINGS_INFLECTION', catalystDirection: 'positive', inflectionStrength: 'strong' }).has('inflection from unverified secondary'));
  });
  test('a mixed live-like batch passes the gate with zero errors', () => {
    const batch = buildRadar([
      mk({ id: 'a', title: "ITC's ₹900 cr Yoga Bar bet", description: 'Revenue reached ₹452 crore in FY25.', company: 'ITC' }),
      mk({ id: 'b', title: 'HUDCO Q1 results: Profit jumps 35%, dividend declared', company: 'HUDCO' }),
      mk({ id: 'c', title: 'Alphacorp wins Rs 500 crore order from a state utility', sourceLabel: 'NSE filing' }),
      mk({ id: 'd', title: 'SC 13E3 - ACME HOLDINGS INC (0000123456) (Subject)', company: 'ACME HOLDINGS INC', region: 'US', sourceLabel: 'SEC EDGAR', primarySource: true, eventType: 'GOING_PRIVATE', feedFacts: GP_TEMPLATE, publishedAt: PD }),
    ], { now: 0 });
    const qa = qaErrorsOf(batch.items);
    const mine = qa.errors.filter((e) => ['evidence strong but primary not read', 'earnings link without a subject-owned earnings number', 'target metric attributed to acquirer', 'title-copied field', 'inflection from unverified secondary', 'number-owner mismatch'].includes(e.cls));
    assert.deepEqual(mine, []);
  });
});

describe('9 wave 2: form-title-only evidence fields agree; feed hints copied onto the item', () => {
  const ev = {
    event_id: 'tot9', event_type: 'TENDER_OFFER', region: 'US', primary_source: true,
    primary_filing: { title: 'SC TO-T - STURM RUGER & CO INC (0000095029) (Subject)', source: 'SEC EDGAR', link: 'https://www.sec.gov/Archives/edgar/data/95029/w2.txt', pub_date: PD },
    filings: [
      { title: 'SC TO-T - STURM RUGER & CO INC (0000095029) (Subject)', source: 'SEC EDGAR', link: 'https://www.sec.gov/Archives/edgar/data/95029/w2.txt', pub_date: PD },
      { title: 'SC TO-T - Beretta Holding S.A. (0001234567) (Filed by)', source: 'SEC EDGAR', link: 'https://www.sec.gov/Archives/edgar/data/1234567/w2.txt', pub_date: PD },
    ],
  };
  const inp = eventToRadarInput(ev as any);
  const r = analyseRadarItem(inp);
  test('every evidence / confirmation / stage field says filed, terms unproven', () => {
    assert.equal(r.termsRead, false);
    assert.equal(r.eventEvidence, 'FILED_TERMS_NOT_READ');
    assert.notEqual(r.eventConfirmation, 'CONFIRMED');
    assert.equal(r.eventConfirmation, 'REPORTED');
    assert.ok(!['CONFIRMED', 'STRONG'].includes(r.evidence.status));
    assert.equal(r.evidenceLabel, 'Filing exists — terms not read');
    assert.equal(r.stageNumber, 1);
    assert.equal(r.stageLabel, 'Filing exists — terms not read');
    assert.match(r.confirmationLabel || '', /^Filing exists — terms not read: the SC TO-T is filed, its terms are unproven/);
    assert.equal(r.firstPrimaryConfirmation, null);
    assert.deepEqual(qaOf(r), []);
  });
  test('the QA gate fails on any disagreement', () => {
    const fire = (bad: RadarItem) => qaErrorsOf([bad]).errors.some((e) => e.cls === 'evidence fields disagree');
    assert.ok(fire({ ...r, eventEvidence: 'PRIMARY_CONFIRMED' }));
    assert.ok(fire({ ...r, eventConfirmation: 'CONFIRMED' }));
    assert.ok(fire({ ...r, stageNumber: 3, stageLabel: 'Confirmed by company or filing' }));
    assert.ok(fire({ ...r, evidenceLabel: 'Confirmed' }));
    assert.ok(fire({ ...r, confirmationLabel: 'Event confirmed; the earnings link is not established.' }));
    assert.ok(fire({ ...r, termsRead: true }));
  });
  test('a filing whose terms were read is not capped', () => {
    const read = analyseRadarItem(eventToRadarInput({ ...ev, event_id: 'tot10', primary_filing: { ...ev.primary_filing, description: 'Beretta Holding offers to purchase all outstanding shares at $45.00 per share in cash. The offer will expire on November 20, 2026.' } } as any));
    assert.equal(read.termsRead, true);
    assert.notEqual(read.eventEvidence, 'FILED_TERMS_NOT_READ');
    assert.ok(!qaOf(read).includes('evidence fields disagree'));
  });
  test('feed hints are copied onto the RadarItem under the same names', () => {
    for (const k of ['securityState', 'securityLabel', 'security', 'dealRoles', 'sourceOrigins', 'eventSubtype'] as const) {
      assert.deepEqual((r as any)[k], (inp as any)[k], k);
    }
    assert.equal(r.independentOrigins, (inp as any).independentOrigins);
    assert.equal(r.eventSubtype, 'THIRD_PARTY_TENDER');
    assert.match(String(r.dealRoles?.acquirer || ''), /Beretta/);
  });
});

