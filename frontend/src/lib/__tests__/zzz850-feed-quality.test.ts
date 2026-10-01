// zzz850 - feed-side quality: fund repurchase quarantine, possessive names, group names, via-parent,
// SC 13E-3 dedupe + boilerplate, syndicated dedupe, corporate actions. Synthetic names only.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eventToRadarInput, eventsToRadarInputs, splitRadarInputs, dedupeFeedEvents, companyFromTitle } from '../multibagger-radar-adapter';
import type { RadarFeedEvent } from '../multibagger-radar-feed-types';
import {
  identifySubject, subjectFromHeadline, isFundRepurchaseOffer, isGroupName, resolveViaParent, secAccession, parseSecFilingTitle,
  canonicalEventKey, sameCanonicalEvent, createEventClusterer, priceReactionSpans, stripLegalBoilerplatePercents,
} from '../special-sit-feed-quality';
import { buildRadar } from '../multibagger-radar';

let n = 0;
const ev = (title: string, o: Partial<RadarFeedEvent> & { source?: string; link?: string; description?: string; tickers?: string[]; pub?: string; region?: 'IN' | 'US' | 'GLOBAL' } = {}): RadarFeedEvent => {
  n += 1;
  const { source = 'ET Industry', link = `https://x.test/${n}`, description, tickers, pub, region = 'IN', ...rest } = o;
  return {
    event_id: `e${n}`, event_type: 'UNCLASSIFIED', region, tickers,
    primary_filing: { title, source, link, description, tickers, region, pub_date: pub },
    filings: [{ title, source, link, pub_date: pub }], ...rest,
  } as RadarFeedEvent;
};
const sec = (title: string, source: string, acc: string, o: Parameters<typeof ev>[1] = {}) =>
  ev(title, { source, link: `https://www.sec.gov/Archives/edgar/data/1234/${acc}-index.htm`, region: 'US', event_type: 'TENDER_OFFER', ...o });

describe('1 fund repurchase offers are held back, operating tenders stay', () => {
  const funds = [
    'SC TO-I - Alpha Alternative Access Fund (0001111111) (Subject)',
    'SC TO-I - Beta Capital Private Credit Fund (0001111112) (Subject)',
    'SC TO-I - Gamma Floating Rate & Alternative Income Trust (0001111113) (Subject)',
    'SC TO-I - Delta Credit Solutions, Inc. (0001111114) (Subject)',
    'SC TO-I - Epsilon Structured Credit Fund, LP (0001111115) (Subject)',
    'SC TO-I - Zeta Multi-Alpha Fund (0001111116) (Subject)',
    'SC TO-I - Eta Hedge Fund Guided Portfolio Solution (0001111117) (Subject)',
    'SC TO-I/A - Theta Investment Fund LLC (0001111118) (Issuer)',
  ];
  for (const t of funds) {
    test(`held back: ${t.slice(0, 55)}`, () => {
      const e = sec(t, 'SEC SC TO-I', `0001111111-26-00${++n}`.slice(0, 20));
      const i = eventToRadarInput(e);
      assert.equal(i.ticker, null);
      assert.equal(i.isFundRepurchaseOffer, true);
      assert.equal(i.feedQuarantineReason, 'FUND_REPURCHASE_OFFER');
      assert.equal(i.eventType, 'FUND_REPURCHASE_OFFER');
      assert.equal(i.feedTier, 'NOISE');
    });
  }
  test('Investment Company Act / N-2 text hint catches a fund with a neutral name', () => {
    assert.equal(isFundRepurchaseOffer({ title: 'SC TO-I - Iota Partners (0001) (Subject)', description: 'The Company is a closed-end management investment company registered under the Investment Company Act of 1940 (Form N-2). Repurchase offer at net asset value.', source: 'SEC SC TO-I' }), true);
  });
  test('operating-company SC TO-I (own-share tender) is NOT held back', () => {
    assert.equal(isFundRepurchaseOffer({ title: 'SC TO-I - Kappa Industries, Inc. (0002) (Subject)', description: 'Offer to purchase up to 2,000,000 shares of common stock at $14.00 per share.', source: 'SEC SC TO-I' }), false);
  });
  test('operating SC TO-T and SC 13E3 are not held back', () => {
    assert.equal(isFundRepurchaseOffer({ title: 'SC TO-T - Lambda Medical Products Inc (0003) (Subject)', source: 'SEC SC TO-T' }), false);
    assert.equal(isFundRepurchaseOffer({ title: 'SC 13E3 - Mu Energy Global Ltd (0004) (Subject)', source: 'SEC SC 13E-3' }), false);
  });
  test('splitRadarInputs: funds leave the main list and are counted with the reason', () => {
    const events = [
      ...funds.slice(0, 3).map((t, i) => sec(t, 'SEC SC TO-I', `0009999999-26-00000${i}`)),
      sec('SC TO-T - Lambda Medical Products Inc (0003) (Subject)', 'SEC SC TO-T', '0008888888-26-000001'),
    ];
    const r = splitRadarInputs(events);
    assert.equal(r.inputs.length, 1);
    assert.equal(r.heldBackInputs.length, 3);
    assert.equal(r.heldBack.total, 3);
    assert.equal(r.heldBack.byReason.FUND_REPURCHASE_OFFER, 3);
    assert.match(r.heldBack.line, /3 held back: Fund repurchase offer/);
    assert.equal(eventsToRadarInputs(events).length, 1);
    assert.equal(eventsToRadarInputs(events, { includeHeldBack: true }).length, 4);
    const radar = buildRadar(r.inputs);
    assert.ok(!radar.items.some((x) => /Alpha|Beta|Gamma/.test(x.company)));
  });
});

describe('1b SC 13E-3: subject + filed-by is one event; 40% is boilerplate', () => {
  const acc = '0007777777-26-000123';
  const subj = sec('SC 13E3 - Nu Medical Products Inc (0000706698) (Subject)', 'SEC SC 13E-3', acc, { event_type: 'GOING_PRIVATE', description: 'Rule 13e-3 transaction statement. Filing persons hold approximately 40% of the outstanding shares.' });
  const by = sec('SC 13E3 - Pension Sponsor Board (0001234567) (Filed by)', 'SEC SC 13E-3', acc, { event_type: 'GOING_PRIVATE', description: 'Rule 13e-3 transaction statement. 40%.' });
  test('same accession merges to one event, Subject row wins', () => {
    const { events, merged } = dedupeFeedEvents([by, subj]);
    assert.equal(merged, 1);
    assert.equal(events.length, 1);
    assert.match(events[0].primary_filing.title, /Nu Medical Products/);
    assert.equal(eventsToRadarInputs([by, subj]).length, 1);
  });
  test('roles and accession parse', () => {
    assert.equal(parseSecFilingTitle(subj.primary_filing.title)?.role, 'subject');
    assert.equal(parseSecFilingTitle(by.primary_filing.title)?.role, 'filed by');
    assert.equal(secAccession(subj.primary_filing.link), acc);
    assert.equal(secAccession('https://www.sec.gov/Archives/edgar/data/1234/000777777726000123/x.htm'), acc);
  });
  test('40% is not surfaced: stripped from description, listed as non-evidence', () => {
    const i = eventToRadarInput(subj);
    assert.ok(!/40\s?%/.test(i.description || ''));
    assert.ok((i.nonEarningsNumbers || []).includes('40%'));
    assert.equal(i.isLegalBoilerplateAmount, true);
    assert.equal(i.feedQuarantineReason, null);
    assert.equal(stripLegalBoilerplatePercents('holds 40% of shares.'), 'holds of shares.');
  });
  test('clusterer collapses two rows with the same accession', () => {
    const c = createEventClusterer();
    const a = c.assign('A', 'SC 13E3 - Nu Medical Products Inc (1) (Subject)', 'US', 'GOING_PRIVATE', { link: subj.primary_filing.link });
    const b = c.assign('B', 'SC 13E3 - Pension Sponsor Board (2) (Filed by)', 'US', 'GOING_PRIVATE', { link: by.primary_filing.link });
    assert.equal(a, 'A');
    assert.equal(b, 'A');
  });
  test('a different accession is a different event', () => {
    const other = sec('SC 13E3 - Xi Cables Ltd (0005) (Subject)', 'SEC SC 13E-3', '0007777777-26-000999', { event_type: 'GOING_PRIVATE' });
    assert.equal(dedupeFeedEvents([subj, other]).events.length, 2);
  });
});

describe('2 names: possessives, quotes, groups, via parent', () => {
  test('possessive and quotes stripped from extracted names', () => {
    assert.equal(subjectFromHeadline('Omicron Aluminium’s renewable arm signs 500 MW PPA'), 'Omicron Aluminium');
    assert.equal(subjectFromHeadline("Pi Metals's board approves buyback"), 'Pi Metals');
    assert.equal(companyFromTitle('Omicron Aluminium’s demerger gets NCLT nod'), 'Omicron Aluminium');
  });
  test('unresolved subsidiary keeps ticker empty (never guessed)', () => {
    const i = eventToRadarInput(ev('Omicron Aluminium’s capacity expansion approved'));
    assert.equal(i.ticker, null);
    assert.equal(i.company, 'Omicron Aluminium');
  });
  test('subsidiary maps to listed parent only through an explicit alias, labelled via parent', () => {
    const aliases = [{ match: /^Omicron Aluminium$/i, parent: 'Omicron Holdings', parentTicker: 'OMHL' }];
    assert.deepEqual(resolveViaParent('Omicron Aluminium', aliases), { ticker: 'OMHL', parent: 'Omicron Holdings' });
    const id = identifySubject({ title: 'Omicron Aluminium’s capacity expansion approved', subsidiaryAliases: aliases });
    assert.equal(id.ticker, 'OMHL');
    assert.equal(id.tickerSource, 'parent');
    assert.equal(id.viaParent, 'Omicron Holdings');
    assert.equal(resolveViaParent('Rho Cement', aliases), null);
  });
  test('group / promoter names are not listed tickers', () => {
    assert.equal(isGroupName('Sigma Group'), true);
    assert.equal(isGroupName('RPSG'), true);
    assert.equal(isGroupName('Sigma Cement'), false);
    const i = eventToRadarInput(ev('Sigma Group’s renewable-energy arm to acquire Tau Solar Power’s portfolio'));
    assert.equal(i.ticker, null);
    assert.equal(i.groupName, true);
    assert.equal(i.tickerNote, 'No listed ticker (group)');
    assert.equal(i.company, 'Sigma Group');
  });
  test('a feed ticker equal to the group token is dropped', () => {
    const i = eventToRadarInput(ev('RPSG Group’s renewable-energy arm to acquire Tau Solar Power’s portfolio', { tickers: ['RPSG'] }));
    assert.equal(i.ticker, null);
    assert.equal(i.groupName, true);
    const j = eventToRadarInput(ev('RPSG to acquire Tau Solar Power portfolio', { tickers: ['RPSG'] }));
    assert.equal(j.ticker, null);
  });
  test('explicit exchange tag on a group-named subject is kept', () => {
    assert.equal(identifySubject({ title: 'Sigma Group (NSE: SIGG) plans demerger' }).ticker, 'SIGG');
  });
});

describe('3 price reaction stays context only', () => {
  test('all-time-high wording is listed as non-evidence and not in evidence text', () => {
    const t = 'Upsilon Defence wins Rs 400 crore order; share price hits all-time high';
    const i = eventToRadarInput(ev(t));
    assert.ok((i.nonEarningsNumbers || []).some((x) => /all-time high/i.test(x)));
    assert.deepEqual(priceReactionSpans('stock hits record high'), ['hits record high']);
    const r = buildRadar([i]);
    const ev0 = JSON.stringify((r.items[0] as any).evidence || (r.items[0] as any).earningsEvidence || '');
    assert.ok(!/all-time high/i.test(ev0));
  });
});

describe('4 syndicated copies merge on canonical key', () => {
  const t0 = '2026-09-10T04:00:00Z';
  const et = ev('Phi Industries to acquire Chi Chemicals for Rs 1,200 crore', { source: 'ET Industry', pub: t0 });
  const mc = ev('Phi Industries buys Chi Chemicals in ₹1200 cr deal', { source: 'MoneyControl Top', pub: '2026-09-10T07:00:00Z' });
  const mint = ev('Phi Industries to acquire Chi Chemicals for Rs 1,200 crore: Report', { source: 'Livemint Companies', pub: '2026-09-11T01:00:00Z' });
  test('keys agree on company + family + amount', () => {
    const a = canonicalEventKey({ title: et.primary_filing.title, pubDate: t0 });
    const b = canonicalEventKey({ title: mc.primary_filing.title, pubDate: '2026-09-10T07:00:00Z' });
    assert.equal(a.family, 'ACQUISITION');
    assert.equal(a.subject, 'phi industries');
    assert.ok(a.amounts.includes('1200cr') && b.amounts.includes('1200cr'));
    assert.equal(sameCanonicalEvent(a, b), true);
  });
  test('ET + Moneycontrol + Mint copies are one event', () => {
    const r = dedupeFeedEvents([et, mc, mint]);
    assert.equal(r.events.length, 1);
    assert.equal(r.merged, 2);
    assert.ok((r.events[0].filings || []).length >= 3);
  });
  test('different amount or far-apart date is not merged', () => {
    const a = canonicalEventKey({ title: 'Phi Industries to acquire Chi Chemicals for Rs 1,200 crore', pubDate: t0 });
    assert.equal(sameCanonicalEvent(a, canonicalEventKey({ title: 'Phi Industries to acquire Psi Foods for Rs 300 crore', pubDate: t0 })), false);
    assert.equal(sameCanonicalEvent(a, canonicalEventKey({ title: 'Phi Industries to acquire Chi Chemicals for Rs 1,200 crore', pubDate: '2026-08-01T00:00:00Z' })), false);
  });
  test('clusterer merges them under one id', () => {
    const c = createEventClusterer();
    assert.equal(c.assign('1', et.primary_filing.title, 'IN', 'MERGER_DEFINITIVE', { pubDate: t0 }), '1');
    assert.equal(c.assign('2', mc.primary_filing.title, 'IN', 'MERGER_DEFINITIVE', { pubDate: '2026-09-10T07:00:00Z' }), '1');
  });
  test('radar source quality counts one source per publisher family', () => {
    const merged = eventsToRadarInputs([et, mc, mint]);
    assert.equal(merged.length, 1);
    assert.ok((merged[0]?.independentSources ?? 0) >= 1);
  });
});

describe('5 corporate actions go to the low-signal bucket, never Special situations', () => {
  const heads = [
    'Omega Polymers declares interim dividend of Rs 5 per share',
    'Omega Polymers announces 1:2 bonus issue, record date fixed',
    'Omega Polymers board approves stock split of face value Rs 10 to Rs 2',
  ];
  for (const h of heads) {
    test(h, () => {
      const r = buildRadar([eventToRadarInput(ev(h, { event_type: /dividend/i.test(h) ? 'DIVIDEND_HIKE' : /bonus/i.test(h) ? 'BONUS_ISSUE' : 'STOCK_SPLIT', tickers: ['OMGP'] }))]);
      const it = r.items[0];
      assert.equal(it.bucket, 'CORPORATE_ACTION');
      assert.equal(it.lowSignal, true);
      assert.equal(r.counts.specialSituations ?? 0, 0);
      assert.ok(!(r.byBucket.SPECIAL_SITUATION || []).length);
    });
  }
});
