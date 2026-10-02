// zzz854 - Special Situations feed layer: held-back classes, SEC form subtypes + roles + amendment chains,
// security resolution states, information origins, one count model, QA invariants.
// Fixtures: synthetic names plus the public example names from the live-output evidence (fixtures only; no logic keys on them).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eventToRadarInput, splitRadarInputs, dedupeFeedEvents, feedCountModelFromEvents } from '../multibagger-radar-adapter';
import { buildUsLookup, deriveSourceSubject, createSecLookupLoader, resolveEntity } from '../special-sit-entity';
import {
  assignInformationOrigins, classifyFeedHoldBack, dealRolesFor, displayName, isBareFormText, isPooledVehicleName, listedParentOf, secBaseForm,
  secFilingInfoFor, secRowsFromCikTickerMap, secSubtypeOf, securityResolutionFor,
} from '../special-sit-security';
import { FEED_QUARANTINE_LABEL, classifyForm10, eventFamily, isFundRepurchaseOffer, subtypeHint, summariseHeldBack } from '../special-sit-feed-quality';
import { buildFeedCountModel, buildRadarQa, checkShownInvariants, countInvariant } from '../special-sit-qa';
import type { RadarFeedEvent, RadarFeedItem } from '../multibagger-radar-feed-types';

let n = 0;
const secLink = (cik: string, acc: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${acc}-index.htm`;
const acc = (i: number) => `0001193125-26-${String(i).padStart(6, '0')}`;
function secEv(title: string, o: { filings?: RadarFeedItem[]; description?: string; pub_date?: string; link?: string; why?: RadarFeedEvent['why_tradable']; region?: 'US' | 'IN' } = {}): RadarFeedEvent {
  n += 1;
  const link = o.link || secLink('1', acc(n));
  const pf: RadarFeedItem = { title, source: 'SEC EDGAR', link, description: o.description, pub_date: o.pub_date || '2026-09-30T00:00:00Z', region: o.region || 'US' };
  return { event_id: `s${n}`, event_type: 'TENDER_OFFER', region: o.region || 'US', tier: 'TIER_2', primary_source: true, primary_filing: pf, filings: o.filings || [pf], why_tradable: o.why } as RadarFeedEvent;
}
function newsEv(title: string, o: { source?: string; description?: string; filings?: RadarFeedItem[]; region?: 'US' | 'IN'; event_type?: string } = {}): RadarFeedEvent {
  n += 1;
  const pf: RadarFeedItem = { title, source: o.source || 'ET Industry', link: `https://news.test/${n}`, description: o.description, pub_date: '2026-09-30T06:00:00Z', region: o.region || 'IN' };
  return { event_id: `n${n}`, event_type: o.event_type || 'OTHER', region: o.region || 'IN', tier: 'TIER_2', primary_filing: pf, filings: o.filings || [pf] } as RadarFeedEvent;
}

// ─── 1. Held back ─────────────────────────────────────────────────────────────
describe('1 held back: pooled vehicles, partnership units, debt / routine / unread issuer tenders', () => {
  const POOLED = [
    'Vista Credit Strategic Lending Corp', 'Star Mountain Lower Middle-Market Capital Corp', 'Kennedy Lewis Capital Co', 'Blue Owl Technology Income Corp',
    'NexPoint Capital, Inc.', 'Willow Tree Capital Corp', 'Crestline Lending Solutions LLC', 'Highlands REIT, Inc.',
    'Zephyr Private Credit Fund', 'Orchid Interval Fund', 'Quill Senior Lending Corp II', 'Harbor Direct Lending Fund LP',
  ];
  for (const name of POOLED) test(`pooled vehicle SC TO-I held back: ${name}`, () => {
    const i = eventToRadarInput(secEv(`SC TO-I - ${name} (0001999001) (Subject)`));
    assert.equal(i.feedQuarantineReason, 'FUND_REPURCHASE_OFFER');
    assert.equal(i.isFundRepurchaseOffer, true);
    assert.equal(i.excludedFromEquityRadar, true);
    assert.equal(i.securityState, 'NON_EQUITY_ENTITY');
    assert.equal(i.feedTier, 'NOISE');
  });
  test('the route-side check (isFundRepurchaseOffer) catches BDC / private-credit names in an issuer tender too', () => {
    for (const nm of ['Vista Credit Strategic Lending Corp', 'Kennedy Lewis Capital Co', 'Crestline Lending Solutions LLC', 'Blue Owl Technology Income Corp']) {
      assert.equal(isFundRepurchaseOffer({ title: `SC TO-I - ${nm} (0000000001) (Subject)`, source: 'SEC EDGAR' }), true, nm);
    }
    // ...but a 'Capital' name in an ordinary headline is not a fund
    assert.equal(isFundRepurchaseOffer({ title: 'Zeta Capital Corp wins Rs 300 crore order' }), false);
  });
  test('partnership / LLLP unit repurchase is held back with its own reason', () => {
    const i = eventToRadarInput(secEv('SC TO-I - JONES FINANCIAL COMPANIES LLLP (0000815917) (Subject)'));
    assert.equal(i.feedQuarantineReason, 'PARTNERSHIP_UNIT_REPURCHASE');
    assert.equal(i.securityState, 'NON_EQUITY_ENTITY');
    assert.match(i.securityLabel || '', /LP \/ LLC units/);
  });
  test('operating-company SC TO-I with only the form title: held back as terms not read', () => {
    for (const nm of ['MEDTRONIC PLC', 'LINCOLN NATIONAL CORP', 'Northwind Gears Inc']) {
      const i = eventToRadarInput(secEv(`SC TO-I - ${nm} (0001000777) (Subject)`, { description: 'Filed: 2026-09-30 AccNo: 0001193125-26-000777 Size: 45 KB' }));
      assert.equal(i.feedQuarantineReason, 'ISSUER_TENDER_TERMS_NOT_READ', nm);
      assert.equal(i.feedQuarantineLabel, 'Issuer tender — terms not read (could be odd-lot, employee or debt)');
    }
  });
  test('debt and routine issuer tenders get their own reasons', () => {
    const d = eventToRadarInput(secEv('SC TO-I - Northwind Gears Inc (0001000778) (Subject)', { description: 'Offer to purchase for cash any and all of its outstanding 5.25% Senior Notes due 2029.' }));
    assert.equal(d.feedQuarantineReason, 'DEBT_TENDER');
    const r = eventToRadarInput(secEv('SC TO-I - Northwind Gears Inc (0001000779) (Subject)', { description: 'Offer to exchange eligible options held by employees for new restricted stock units.' }));
    assert.equal(r.feedQuarantineReason, 'ROUTINE_ISSUER_TENDER');
    const o = classifyFeedHoldBack({ title: 'Northwind Gears announces odd-lot tender offer', company: 'Northwind Gears' });
    assert.equal(o?.reason, 'ROUTINE_ISSUER_TENDER');
    const nd = classifyFeedHoldBack({ title: 'Northwind Gears launches cash tender offer for its 6.5% senior notes due 2030' });
    assert.equal(nd?.reason, 'DEBT_TENDER');
  });
  test('an issuer tender that says it is an equity buyback / Dutch auction stays (not held back)', () => {
    const i = eventToRadarInput(secEv('SC TO-I - Northwind Gears Inc (0001000780) (Subject)', { description: 'Modified Dutch auction tender offer to purchase up to $150 million of its common stock at a price not greater than $42 nor less than $38 per share.' }));
    assert.equal(i.feedQuarantineReason, null);
    assert.equal(i.eventSubtype, 'ISSUER_TENDER');
    assert.equal(i.eventType, 'BUYBACK_TENDER');
    assert.equal(i.formTitleOnly, undefined);
  });
  test('a listed REIT is not assumed non-traded; a third-party tender for an operating company is never held back', () => {
    assert.equal(isPooledVehicleName('Highlands REIT, Inc.', { listed: false }), true);
    assert.equal(isPooledVehicleName('Highlands REIT, Inc.', { listed: true }), false);
    assert.equal(classifyFeedHoldBack({ title: 'SC TO-T - STURM RUGER & CO INC (0000095029) (Subject)' }), null);
    assert.equal(isPooledVehicleName('First Bancorp Capital Inc'), false);
  });
  test('held-back counts per reason sum to the total; every reason has a label', () => {
    const evs = [
      secEv('SC TO-I - Willow Tree Capital Corp (0001000801) (Subject)'), secEv('SC TO-I - NexPoint Capital, Inc. (0001000802) (Subject)'),
      secEv('SC TO-I - JONES FINANCIAL COMPANIES LLLP (0001000803) (Subject)'), secEv('SC TO-I - MEDTRONIC PLC (0001000804) (Subject)'),
      secEv('SC TO-T - STURM RUGER & CO INC (0001000805) (Subject)'),
    ];
    const sp = splitRadarInputs(evs);
    assert.equal(sp.inputs.length, 1);
    assert.equal(sp.heldBack.total, 4);
    assert.deepEqual(sp.heldBack.byReason, { FUND_REPURCHASE_OFFER: 2, PARTNERSHIP_UNIT_REPURCHASE: 1, ISSUER_TENDER_TERMS_NOT_READ: 1 });
    assert.equal(sp.heldBack.reasons!.reduce((a, r) => a + r.count, 0), sp.heldBack.total);
    assert.match(sp.heldBack.line, /2 held back: Fund repurchase offer/);
    assert.match(sp.heldBack.line, /1 held back: Issuer tender — terms not read/);
    for (const r of Object.keys(FEED_QUARANTINE_LABEL)) assert.ok((FEED_QUARANTINE_LABEL as Record<string, string>)[r].length > 10);
    const s = summariseHeldBack([{ reason: 'DEBT_TENDER', name: 'A' }, { reason: 'DEBT_TENDER', name: 'B' }]);
    assert.equal(s.reasons![0].count, 2); assert.deepEqual(s.reasons![0].examples, ['A', 'B']);
  });
});

// ─── 2. SEC form subtypes, roles, amendments ─────────────────────────────────
describe('2 SEC form -> subtype, acquirer / target roles, amendment chains', () => {
  test('form -> subtype', () => {
    assert.equal(secSubtypeOf('SC TO-T'), 'THIRD_PARTY_TENDER');
    assert.equal(secSubtypeOf('SC TO-T/A'), 'THIRD_PARTY_TENDER');
    assert.equal(secSubtypeOf('SC TO-I/A'), 'ISSUER_TENDER');
    assert.equal(secSubtypeOf('SC 13E3'), 'GOING_PRIVATE');
    assert.equal(secSubtypeOf('SC 13E-3/A'), 'GOING_PRIVATE');
    assert.equal(secSubtypeOf('SC 14D9'), 'TARGET_RECOMMENDATION');
    assert.equal(secSubtypeOf('10-12B'), 'SPIN_OFF_REGISTRATION');
    assert.equal(secSubtypeOf('10-12G'), 'SECURITIES_REGISTRATION');
    assert.equal(secSubtypeOf('10-12G', 'distribution of all outstanding shares to stockholders'), 'SPIN_OFF_REGISTRATION');
    assert.equal(secBaseForm('SC 13E-3/A'), 'SC 13E3');
  });
  test('10-12B is a spin-off registration unless the filer is a pooled vehicle', () => {
    assert.equal(classifyForm10('10-12B - Archer SpinCo, Inc. (0001) (Filer)'), 'SPIN');
    assert.equal(classifyForm10('10-12B - Northwind Mobility Inc. (0002000001) (Filer)'), 'SPIN');
    assert.equal(classifyForm10('10-12B - Harbor Infrastructure Fund LP (0002000002) (Filer)'), 'REGISTRATION');
    assert.equal(classifyForm10('10-12G - Quiet Lake Holdings Inc (0002000003) (Filer)'), 'REGISTRATION');
  });
  test('SC TO-T: acquirer = filed-by entity, target = subject, financial owner = target shareholders', () => {
    const a = acc(9001);
    const subj: RadarFeedItem = { title: 'SC TO-T - STURM RUGER & CO INC (0000095029) (Subject)', source: 'SEC EDGAR', link: secLink('95029', a) };
    const filer: RadarFeedItem = { title: 'SC TO-T - Beretta Holding S.A. (0001900001) (Filed by)', source: 'SEC EDGAR', link: secLink('1900001', a) };
    const us = buildUsLookup([{ ticker: 'RGR', name: 'Sturm Ruger & Co Inc', cik: '95029', exchange: 'NYSE' }, { ticker: 'BRTA', name: 'Beretta Holding SA', cik: '1900001', exchange: 'NYSE' }]);
    const i = eventToRadarInput(secEv(subj.title, { link: subj.link, filings: [subj, filer] }), { entityDeps: { usLookup: us, nseLookup: () => undefined } });
    assert.equal(i.eventSubtype, 'THIRD_PARTY_TENDER');
    assert.equal(i.eventType, 'TENDER_OFFER');
    assert.equal(i.eventSubtypeLabel, 'Third-party tender offer (SC TO-T)');
    assert.equal(i.dealRoles!.acquirer, 'Beretta Holding S.A.');
    assert.equal(i.dealRoles!.acquirerTicker, 'BRTA');
    assert.equal(i.dealRoles!.target, 'Sturm Ruger & Co Inc');
    assert.equal(i.dealRoles!.financialOwner, 'Target shareholders (Sturm Ruger & Co Inc)');
    assert.equal(i.dealRoles!.roleLine, 'Acquirer: Beretta Holding S.A. → Target: Sturm Ruger & Co Inc');
    assert.equal(i.sourceSubject!.target, 'STURM RUGER & CO INC');
    assert.equal(i.ticker, 'RGR');
    assert.equal(i.securityLabel, 'Ticker: RGR (NYSE)');
    assert.equal(i.secFiling!.subjectCik, '95029'); assert.equal(i.secFiling!.filerCik, '1900001');
  });
  test('the same role logic for other public evidence pairs (fixtures only)', () => {
    for (const [target, bidder] of [['ACV AUCTIONS INC', 'Copart, Inc.'], ['YATRA ONLINE, INC.', 'Magna Holdings Ltd'], ['DESTINATION XL GROUP, INC.', 'Camac Fund, LP']]) {
      const a = acc(9100 + target.length);
      const s: RadarFeedItem = { title: `SC TO-T - ${target} (0001700001) (Subject)`, source: 'SEC EDGAR', link: secLink('1700001', a) };
      const f: RadarFeedItem = { title: `SC TO-T - ${bidder} (0001800001) (Filed by)`, source: 'SEC EDGAR', link: secLink('1800001', a) };
      const i = eventToRadarInput(secEv(s.title, { link: s.link, filings: [f, s] }));
      assert.equal(i.dealRoles!.acquirer, bidder, target);
      assert.equal(i.dealRoles!.target, displayName(target));
      assert.equal(i.feedQuarantineReason, null, target);
    }
  });
  test('SC TO-T with no filed-by row: acquirer is "Not established", never guessed', () => {
    const i = eventToRadarInput(secEv('SC TO-T - Quiet Rivers Inc (0001700002) (Subject)'));
    assert.equal(i.dealRoles!.acquirer, null);
    assert.match(i.dealRoles!.roleLine || '', /^Acquirer: Not established → Target: Quiet Rivers Inc$/);
    assert.ok(i.dealRoles!.notes.some((x) => /not in the feed/.test(x)));
  });
  test('SC 13E3 is a going-private transaction, not a tender; the template 20-40% never becomes evidence', () => {
    const i = eventToRadarInput(secEv('SC 13E3 - Kappa Systems Inc (0001700003) (Subject)', { why: { what_happened: 'Kappa filed an SC 13E-3 going-private transaction.', what_matters: 'Insider/PE buyout at premium to market — typical 20–40% premium for control.' } }));
    assert.equal(i.eventSubtype, 'GOING_PRIVATE');
    assert.equal(i.eventType, 'GOING_PRIVATE');
    assert.equal(i.eventHeadlineKind, 'MERGER');
    assert.notEqual(i.eventHeadlineKind, 'TENDER');
    assert.equal(i.feedFactsAreTemplate, true);
    assert.ok(i.nonEarningsNumbers!.includes('20–40%'));
    assert.ok(i.nonEarningsNumbers!.includes('40%'));
    assert.equal(i.ownedNumbers!.some((o) => o.countsAsParentEarnings), false);
    assert.match(i.dealRoles!.roleLine || '', /Going private: Kappa Systems Inc/);
  });
  test('original + /A amendments fold into ONE event with the latest amendment date', () => {
    const o = secEv('SC TO-T - Quiet Rivers Inc (0001700010) (Subject)', { pub_date: '2026-09-01T00:00:00Z' });
    const a1 = secEv('SC TO-T/A - Quiet Rivers Inc (0001700010) (Subject)', { pub_date: '2026-09-10T00:00:00Z' });
    const a2 = secEv('SC TO-T/A - Quiet Rivers Inc (0001700010) (Subject)', { pub_date: '2026-09-20T00:00:00Z' });
    const other = secEv('SC TO-T - Different Target Inc (0001700011) (Subject)');
    const d = dedupeFeedEvents([a2, o, a1, other]);
    assert.equal(d.events.length, 2);
    assert.equal(d.merged, 2);
    const sp = splitRadarInputs([a2, o, a1, other]);
    const card = [...sp.inputs, ...sp.heldBackInputs].find((x) => x.company === 'Quiet Rivers Inc')!;
    assert.equal(card.title, 'SC TO-T - Quiet Rivers Inc (0001700010) (Subject)', 'the original is the card, not an amendment');
    assert.equal(card.secFiling!.amendmentCount, 2);
    assert.equal(card.secFiling!.isAmendment, false);
    assert.equal(card.secFiling!.originalDate, '2026-09-01T00:00:00.000Z');
    assert.equal(card.secFiling!.latestAmendmentDate, '2026-09-20T00:00:00.000Z');
    assert.equal(card.sourceOrigins!.independentOrigins, 1);
    assert.equal(card.sourceOrigins!.amendmentCopies, 2);
    assert.equal(sp.mergedDuplicates, 2);
  });
  test('Form 10 amendments fold by CIK; different registrants never merge', () => {
    const a = secEv('10-12B - Archer SpinCo, Inc. (0002100001) (Filer)', { pub_date: '2026-08-01T00:00:00Z' });
    const b = secEv('10-12B/A - Archer SpinCo, Inc. (0002100001) (Filer)', { pub_date: '2026-09-15T00:00:00Z' });
    const c = secEv('10-12B - Other SpinCo, Inc. (0002100002) (Filer)');
    const d = dedupeFeedEvents([a, b, c]);
    assert.equal(d.events.length, 2);
    const info = secFilingInfoFor([a.primary_filing, ...(d.events[0].filings || [])]);
    assert.equal(info!.subtype, 'SPIN_OFF_REGISTRATION');
    assert.equal(info!.amendmentCount, 1);
  });
  test('dealRolesFor: issuer tender and spin-off registration', () => {
    const it = dealRolesFor({ secFiling: { subtype: 'ISSUER_TENDER' } as any, subject: 'NORTHWIND GEARS INC' });
    assert.equal(it!.roleLine, 'Issuer buying its own securities: Northwind Gears Inc');
    const sp = dealRolesFor({ secFiling: { subtype: 'SPIN_OFF_REGISTRATION' } as any, subject: 'Archer SpinCo, Inc.' });
    assert.match(sp!.roleLine || '', /spun off/);
    assert.equal(displayName('STURM RUGER & CO INC'), 'Sturm Ruger & Co Inc');
    assert.equal(displayName('JONES FINANCIAL COMPANIES LLLP'), 'Jones Financial Companies LLLP');
    assert.equal(displayName('Beretta Holding S.A.'), 'Beretta Holding S.A.');
  });
});

// ─── 3. Security resolution states ───────────────────────────────────────────
describe('3 ticker / security resolution states (never bare "No ticker")', () => {
  const us = buildUsLookup([
    { ticker: 'NWG', name: 'Northwind Gears Inc', cik: '1000777', exchange: 'Nasdaq' },
    { ticker: 'DUALA', name: 'Dual Class Holdings Corp', cik: 5, exchange: 'NYSE' }, { ticker: 'DUALB', name: 'Dual Class Holdings Corp', cik: 5, exchange: 'NYSE' },
  ]);
  test('CIK -> ticker when the map is loaded', () => {
    const i = eventToRadarInput(secEv('SC TO-T - Renamed Filer Co (0001000777) (Subject)'), { entityDeps: { usLookup: us, nseLookup: () => undefined } });
    assert.equal(i.securityState, 'RESOLVED'); assert.equal(i.ticker, 'NWG'); assert.equal(i.securityLabel, 'Ticker: NWG (Nasdaq)');
  });
  test('unresolved always carries a reason: CIK not in map vs map not loaded vs name not matched', () => {
    const a = eventToRadarInput(secEv('SC TO-T - Quiet Rivers Inc (0001234999) (Subject)'), { entityDeps: { usLookup: us, nseLookup: () => undefined } });
    assert.equal(a.securityState, 'UNRESOLVED'); assert.equal(a.securityLabel, 'Unresolved - CIK not in ticker map');
    const b = eventToRadarInput(secEv('SC TO-T - Quiet Rivers Inc (0001234998) (Subject)'), { entityDeps: { nseLookup: () => undefined } });
    assert.equal(b.securityLabel, 'Unresolved - SEC ticker map not loaded');
    const c = eventToRadarInput(newsEv('Quiet Rivers Ltd wins Rs 120 crore order'), { entityDeps: { nseLookup: () => undefined } });
    assert.equal(c.securityLabel, 'Unresolved - name not matched');
    assert.match(resolveEntity({ name: 'Quiet Rivers Inc', cik: '1234999' }, { usLookup: us, nseLookup: () => undefined }).basis, /CIK not in ticker map/);
  });
  test('multiple securities', () => {
    const e = resolveEntity({ name: 'Dual Class Holdings Corp' }, { usLookup: us, nseLookup: () => undefined });
    const s = securityResolutionFor(e, { name: 'Dual Class Holdings Corp', usLookupLoaded: true });
    assert.equal(s.state, 'RESOLVED_MULTIPLE'); assert.equal(s.label, 'Resolved - multiple securities: DUALA, DUALB'); assert.deepEqual(s.tickers, ['DUALA', 'DUALB']);
  });
  test('subsidiary "<Parent> <Something>": unlisted subsidiary only when the parent resolves', () => {
    const nse = (x: string) => (x.toLowerCase() === 'vedanta' ? 'VEDL' : x.toLowerCase() === 'tata' ? 'TATAX' : undefined);
    const v = eventToRadarInput(newsEv('Vedanta Aluminium commissions new smelter line', { source: 'ET Industry' }), { entityDeps: { nseLookup: nse } });
    assert.equal(v.securityState, 'UNLISTED_SUBSIDIARY');
    assert.equal(v.securityLabel, 'Unlisted subsidiary - listed parent: Vedanta (VEDL)');
    assert.equal(v.ticker, null, 'the parent ticker is context, never the card ticker');
    assert.equal(v.security!.listedParent!.ticker, 'VEDL');
    // a group prefix is never a listed parent; an unknown prefix stays unresolved with a reason
    assert.equal(listedParentOf('Tata Electronics', { nseLookup: nse }), null);
    const q = eventToRadarInput(newsEv('Quiet Rivers Aluminium commissions new smelter line'), { entityDeps: { nseLookup: nse } });
    assert.equal(q.securityState, 'UNRESOLVED'); assert.match(q.securityLabel || '', /^Unresolved - /);
  });
  test('the repo NSE master resolves the Vedanta parent with no injection', () => {
    assert.deepEqual(listedParentOf('Vedanta Aluminium Ltd'), { name: 'Vedanta', ticker: 'VEDL' });
  });
  test('non-equity entity and not-applicable states', () => {
    assert.equal(securityResolutionFor(resolveEntity({ name: 'Alpha Private Credit Fund' }), { name: 'Alpha Private Credit Fund' }).state, 'NON_EQUITY_ENTITY');
    assert.equal(securityResolutionFor(resolveEntity({ name: 'Securities and Exchange Commission' }), { name: 'x' }).label, 'Not applicable (regulator)');
    assert.equal(securityResolutionFor(resolveEntity({ name: 'Omega Retail Pvt Ltd' }), { name: 'Omega Retail Pvt Ltd' }).state, 'UNLISTED');
    for (const st of ['RESOLVED', 'RESOLVED_MULTIPLE', 'UNLISTED', 'NOT_APPLICABLE', 'UNRESOLVED'] as const) {
      assert.doesNotMatch(securityResolutionFor({ legalEntity: 'x', state: st, basis: '' }, { name: 'x' }).label, /^No ticker$/);
    }
  });
  test('SEC lookup loader: optional fallback rows (e.g. a CIK -> ticker map) when KV is empty', async () => {
    const load = createSecLookupLoader(async () => null, ['k'], 1000, () => 0, async () => secRowsFromCikTickerMap(new Map([[95029, 'RGR']])));
    const l = await load();
    assert.equal(l!.byCik!('0000095029')[0].ticker, 'RGR');
    const none = createSecLookupLoader(async () => null, ['k'], 1000, () => 0, async () => { throw new Error('down'); });
    assert.equal(await none(), null);
  });
});

// ─── 4. Information origins ──────────────────────────────────────────────────
describe('4 source independence by information origin', () => {
  test('Archer-style: 4 SEC listings of one registration = 1 origin, 0 syndicated', () => {
    const a = acc(7001);
    const items = [
      { title: '10-12B - Archer SpinCo, Inc. (0002200001) (Filer)', source: 'SEC EDGAR', link: secLink('2200001', a) },
      { title: '10-12B - Archer Parent Corp (0002200002) (Filed by)', source: 'SEC EDGAR', link: secLink('2200002', a) },
      { title: '10-12B/A - Archer SpinCo, Inc. (0002200001) (Filer)', source: 'SEC EDGAR', link: secLink('2200001', acc(7002)) },
      { title: '10-12B/A - Archer SpinCo, Inc. (0002200001) (Filer)', source: 'SEC EDGAR', link: secLink('2200001', acc(7003)) },
    ];
    const o = assignInformationOrigins(items);
    assert.equal(o.sourceCount, 4); assert.equal(o.independentOrigins, 1); assert.equal(o.syndicatedCopies, 0);
    assert.equal(o.amendmentCopies, 2); assert.equal(o.partyListings, 1);
    assert.equal(o.line, '4 items · 1 independent origin (2 amendments, 1 party listing of the same filing)');
  });
  test('rewrites of one press release share one origin; own reporting with new facts is a new origin', () => {
    const items = [
      { title: 'Zetacorp wins Rs 400 crore order from state utility', source: 'BSE Corp Announcements', link: 'https://www.bseindia.com/x' },
      { title: 'Zetacorp bags Rs 400 crore order; shares in focus', source: 'Moneycontrol', link: 'https://moneycontrol.test/1' },
      { title: 'Zetacorp secures ₹400 crore contract', source: 'Business Standard', link: 'https://bs.test/1', description: 'Rs 400 crore, the company said in an exchange filing.' },
      { title: 'Zetacorp order win worth Rs 400 crore', source: 'NDTV Profit', link: 'https://ndtv.test/1' },
      { title: 'Zetacorp in talks for second utility contract, sources say', source: 'Reuters', link: 'https://reuters.test/1', description: 'People familiar with the matter said a second award is being negotiated.' },
    ];
    const o = assignInformationOrigins(items);
    assert.equal(o.sourceCount, 5);
    assert.equal(o.independentOrigins, 2);
    assert.equal(o.syndicatedCopies, 3);
    assert.equal(o.perItem[0].originId, o.perItem[3].originId);
    assert.notEqual(o.perItem[0].originId, o.perItem[4].originId);
    assert.equal(o.independentOrigins + o.syndicatedCopies + o.amendmentCopies + o.partyListings, o.sourceCount);
  });
  test('same newsroom twice is one origin; distinct stories with no shared facts stay distinct', () => {
    assert.equal(assignInformationOrigins([{ title: 'Alpha merger approved', source: 'Livemint Companies' }, { title: 'Board clears the plan', source: 'Livemint Markets' }]).independentOrigins, 1);
    assert.equal(assignInformationOrigins([{ title: 'a' }, { title: 'b' }, { title: 'c' }]).independentOrigins, 3);
  });
  test('the adapter uses origins for independentSources and tags each source with its origin', () => {
    const items: RadarFeedItem[] = [
      { title: 'Zetacorp wins Rs 400 crore order', source: 'BSE Corp Announcements', link: 'https://www.bseindia.com/z' },
      { title: 'Zetacorp bags Rs 400 crore order', source: 'Moneycontrol', link: 'https://moneycontrol.test/z' },
      { title: 'Zetacorp gets Rs 400 crore order', source: 'NDTV Profit', link: 'https://ndtv.test/z' },
    ];
    const i = eventToRadarInput(newsEv(items[0].title, { filings: items, source: items[0].source }));
    assert.equal(i.independentSources, 1); assert.equal(i.independentOrigins, 1);
    assert.equal(i.sourceOrigins!.sourceCount, 3);
    assert.ok((i.sources as any[]).every((s) => typeof s.originId === 'string'));
    assert.deepEqual((i.sources as any[]).map((s) => s.copyKind), ['ORIGIN', 'SYNDICATED', 'SYNDICATED']);
  });
});

// ─── 5. Count model ──────────────────────────────────────────────────────────
describe('5 one count model; header, chips, coverage and radar reconcile', () => {
  const evs = [
    secEv('SC TO-I - Willow Tree Capital Corp (0001300001) (Subject)'),
    secEv('SC TO-I - MEDTRONIC PLC (0001300002) (Subject)'),
    secEv('SC TO-T - Quiet Rivers Inc (0001300003) (Subject)'),
    secEv('SC TO-T/A - Quiet Rivers Inc (0001300003) (Subject)'),
    newsEv('Omicron Ltd board approves demerger of its chemicals business', { event_type: 'DEMERGER_INDIA' }),
    newsEv('Zetacorp wins Rs 400 crore order for power systems', { event_type: 'LARGE_ORDER' }),
  ];
  test('equations hold on one filtered set', () => {
    const m = feedCountModelFromEvents(evs, { rawItemCount: 40 });
    assert.equal(m.canonical_events, 6); assert.equal(m.merged_duplicates, 1); assert.equal(m.held_back.total, 2); assert.equal(m.shown, 3);
    assert.equal(m.reconciles, true, m.mismatches.join('; '));
    assert.ok(m.equations.find((e) => e.id === 'E1')!.holds);
    assert.equal(Object.values(m.shown_by_tier).reduce((a, b) => a + b, 0), m.shown);
    assert.equal(Object.values(m.shown_by_category).reduce((a, b) => a + b, 0), m.shown);
    assert.equal(Object.values(m.shown_by_coverage).reduce((a, b) => a + b, 0), m.shown);
    assert.deepEqual(m.held_back.by_reason, { FUND_REPURCHASE_OFFER: 1, ISSUER_TENDER_TERMS_NOT_READ: 1 });
    assert.equal(m.raw_items, 40);
  });
  test('raw coverage is labelled raw and reported shown-vs-raw, never mixed into the equations', () => {
    const m = feedCountModelFromEvents(evs, { rawCoverage: { 'M&A': 854, 'Spin-offs': 41, Buybacks: 165 } });
    assert.equal(m.coverage_raw!.label, 'RAW (pre-filter)');
    const ma = m.coverage_shown_vs_raw.find((x) => x.bucket === 'M&A')!;
    assert.equal(ma.raw, 854); assert.equal(ma.shown, m.shown_by_coverage['M&A'] || 0);
    assert.equal(m.reconciles, true);
  });
  test('radar sections that do not add up are reported (QA d)', () => {
    const bad = feedCountModelFromEvents(evs, { radarSections: { SPECIAL_SITUATION: 2, CONTRACT: 2 }, radarExcluded: 0 });
    assert.equal(bad.reconciles, false);
    assert.ok(bad.mismatches.some((x) => x.startsWith('E5')));
    const qa = countInvariant(bad);
    assert.equal(qa.ok, false); assert.equal(qa.counts.COUNTS_DO_NOT_RECONCILE, 1);
    const good = feedCountModelFromEvents(evs, { radarSections: { SPECIAL_SITUATION: 2 }, radarExcluded: 1 });
    assert.equal(good.reconciles, true);
    assert.equal(countInvariant(good).ok, true);
  });
  test('buildFeedCountModel directly: E1 catches a dropped item', () => {
    const m = buildFeedCountModel({ canonicalEvents: 5, mergedDuplicates: 0, shown: [{ feedTier: 'TIER_1', category: 'MA', eventType: 'TENDER_OFFER' }], heldBack: [{ feedQuarantineReason: 'DEBT_TENDER' }] });
    assert.equal(m.reconciles, false); assert.ok(m.mismatches[0].startsWith('E1'));
  });
});

// ─── 6. QA invariants ────────────────────────────────────────────────────────
describe('6 QA invariants on the shown list', () => {
  test('(a) Confirmed evidence on a bare form title is flagged', () => {
    const i = eventToRadarInput(secEv('SC TO-T - Quiet Rivers Inc (0001400001) (Subject)', { description: 'Filed: 2026-09-30 AccNo: 0001193125-26-400001 Size: 12 KB' }));
    assert.equal(i.formTitleOnly, true); assert.equal(i.evidenceCeiling, 'FILING_EXISTS_TERMS_NOT_READ');
    const r = checkShownInvariants([{ ...i, evidenceStatus: 'CONFIRMED' }]);
    assert.equal(r.ok, false); assert.equal(r.counts.CONFIRMED_ON_BARE_FORM_TITLE, 1);
    assert.equal(checkShownInvariants([{ ...i, evidenceStatus: 'DEVELOPING' }]).counts.CONFIRMED_ON_BARE_FORM_TITLE, undefined);
  });
  test('(b) a pooled vehicle in the shown list is flagged', () => {
    const f = eventToRadarInput(secEv('SC TO-I - Kennedy Lewis Capital Co (0001400002) (Subject)'));
    const r = checkShownInvariants([f]);
    assert.equal(r.counts.POOLED_VEHICLE_SHOWN, 1);
    const sp = splitRadarInputs([secEv('SC TO-I - Kennedy Lewis Capital Co (0001400003) (Subject)'), secEv('SC TO-T - Quiet Rivers Inc (0001400004) (Subject)')]);
    assert.equal(checkShownInvariants(sp.inputs).counts.POOLED_VEHICLE_SHOWN, undefined, 'the real shown list is clean');
  });
  test('(c) a financing / terms field equal to the title is flagged, and the adapter never produces one', () => {
    const title = 'SC TO-I - JONES FINANCIAL COMPANIES LLLP (0000815917) (Subject)';
    const r = checkShownInvariants([{ id: 'x', title, company: 'Jones', dealTerms: { fields: { financing: `${title}.` } } }]);
    assert.equal(r.counts.TERM_EQUALS_TITLE, 1);
    const i = eventToRadarInput(secEv('SC TO-I - Northwind Gears Inc (0001400005) (Subject)', { description: 'SC TO-I - Northwind Gears Inc (0001400005) (Subject). Modified Dutch auction for up to 2,000,000 shares of common stock. The offer is not subject to any financing condition.' }));
    for (const v of Object.values(i.dealTerms?.fields || {})) assert.doesNotMatch(v, /SC TO-I - /);
    assert.equal(checkShownInvariants([i]).counts.TERM_EQUALS_TITLE, undefined);
  });
  test('source-count consistency is checked', () => {
    const bad = checkShownInvariants([{ id: 'y', title: 't', sourceOrigins: { sourceCount: 4, independentOrigins: 1, syndicatedCopies: 1, amendmentCopies: 0, partyListings: 0, origins: [], line: '' } }]);
    assert.equal(bad.counts.SOURCE_COUNT_INCONSISTENT, 1);
  });
  test('buildRadarQa carries held-back counts per reason and the shown invariants', () => {
    const raw = [secEv('SC TO-I - NexPoint Capital, Inc. (0001400006) (Subject)'), secEv('SC TO-I - MEDTRONIC PLC (0001400007) (Subject)'), secEv('SC TO-T - Quiet Rivers Inc (0001400008) (Subject)')];
    const sp = splitRadarInputs(raw);
    const qa = buildRadarQa({ rawEvents: raw, normalizedEvents: dedupeFeedEvents(raw).events, radarInputs: sp.inputs, heldBack: sp.heldBackInputs });
    assert.deepEqual(qa.held_back_by_reason, { FUND_REPURCHASE_OFFER: 1, ISSUER_TENDER_TERMS_NOT_READ: 1 });
    assert.ok(qa.exclusions.some((x) => x.exclusion_reason === 'TERMS_NOT_READ'));
    assert.equal(qa.invariants!.ok, true);
  });
});

// ─── 7. Headline-level fixes (acquisition bet, source subject) ───────────────
describe('7 acquisition "bet" headlines and financial ownership', () => {
  const ITC = "From cigarettes to protein bars: ITC's ₹900 cr Yoga Bar bet as FMCG giant taps India's health-food boom";
  test('a "<money> <Company> bet" is an acquisition, not a new product', () => {
    assert.equal(eventFamily(ITC), 'ACQUISITION');
    assert.equal(subtypeHint(ITC), null);
    assert.equal(eventFamily('Acme sets aside Rs 500 crore for EV bet on new platforms'), 'OTHER');
    const i = eventToRadarInput(newsEv(ITC, { source: 'Livemint', description: 'Yoga Bar revenue reached ₹452 crore in FY25.' }));
    assert.equal(i.eventHeadlineKind, 'ACQUISITION');
    assert.equal(i.sourceSubject!.target, 'Yoga Bar');
    assert.equal(i.sourceSubject!.financialOwner, undefined, 'the acquirer is not assumed to own the target revenue');
    assert.equal(i.dealRoles!.roleLine, 'Acquirer: ITC → Target: Yoga Bar');
  });
  test('deriveSourceSubject leaves financialOwner to the owned numbers for acquisitions', () => {
    assert.equal(deriveSourceSubject({ title: 'Acme Foods to acquire Beta Snacks for Rs 2,410 crore', company: 'Acme Foods' }).financialOwner, undefined);
    assert.equal(deriveSourceSubject({ title: 'Omega Polymers Declares Rs 200/Share Dividend', company: 'Omega Polymers' }).financialOwner, 'Omega Polymers');
  });
  test('bare EDGAR description boilerplate is still a bare form title', () => {
    assert.equal(isBareFormText('SC TO-T - Quiet Rivers Inc (0001700002) (Subject)', 'Filed: 2026-09-30 AccNo: 0001193125-26-000001 Size: 45 KB'), true);
    assert.equal(isBareFormText('SC TO-T - Quiet Rivers Inc (0001700002) (Subject)', 'Offer to purchase all outstanding shares at $14.25 per share in cash, expiring October 30.'), false);
  });
});

describe('8 lifecycle hint from the SEC form', () => {
  test('form-only stage says terms were not read', async () => {
    const { secLifecycleHint } = await import('../special-sit-lifecycle');
    const h = secLifecycleHint('THIRD_PARTY_TENDER', true)!;
    assert.equal(h.state, 'OPEN'); assert.equal(h.termsRead, false); assert.match(h.basis, /Terms not read/);
    assert.equal(secLifecycleHint('GOING_PRIVATE', false)!.state, 'BINDING');
    assert.equal(secLifecycleHint('SECURITIES_REGISTRATION'), null);
  });
});

// ─── 9. Wave 2: verification-gated payload (the route's single count model) ──
describe('9 verification-gated feed: one count model after the gate', () => {
  test('kept / route-held / awaiting / contradicted / QA duplicates reconcile (E1) and carry reasons', async () => {
    const { assembleGatedFeed } = await import('../multibagger-radar-adapter');
    const kept = [
      secEv('SC TO-T - Quiet Rivers Inc (0001500001) (Subject)', { description: 'Offer to purchase all outstanding shares at $14.25 per share in cash.' }),
      newsEv('Omicron Ltd board approves demerger of its chemicals business', { event_type: 'DEMERGER_INDIA' }),
    ];
    const fund = { ...secEv('SC TO-I - Willow Tree Capital Corp (0001500002) (Subject)'), quarantine_reason: 'FUND_REPURCHASE_OFFER' } as RadarFeedEvent;
    const dup = { ...newsEv('Omicron Ltd board approves demerger of chemicals arm'), excluded_from_equity_radar: true, exclusion_reason: 'DUPLICATE' } as RadarFeedEvent;
    const regulator = { ...newsEv('Securities Appellate Tribunal sets aside order against Omega Polymers'), excluded_from_equity_radar: true, exclusion_reason: 'REGULATOR' } as RadarFeedEvent;
    // same deal as the kept filing, but only a media story: must NOT merge into the shown card
    const awaiting = [newsEv('Quiet Rivers gets $14.25 a share cash tender offer', { region: 'US' }), newsEv('Zetacorp wins Rs 400 crore order for power systems', { event_type: 'LARGE_ORDER' })];
    const contradicted = [newsEv('Sigma Ltd to acquire Tau Ltd for Rs 800 crore')];
    const g = assembleGatedFeed({ kept, held: [fund, dup, regulator], awaiting, contradicted, rawItemCount: 99, rawCoverage: { 'M&A / Merger Arb': 854 }, coverageBucketOf: () => 'M&A / Merger Arb' });
    const m = g.countModel;
    assert.equal(m.shown, 2);
    assert.equal(m.reconciles, true, m.mismatches.join('; '));
    assert.equal(m.canonical_events, m.shown + m.held_back.total + m.merged_duplicates);
    assert.equal(m.held_back.by_reason.AWAITING_VERIFICATION, 2);
    assert.equal(m.held_back.by_reason.AI_CONTRADICTED, 1);
    assert.equal(m.held_back.by_reason.FUND_REPURCHASE_OFFER, 1);
    assert.equal(m.held_back.by_reason.EXCLUDED_FROM_EQUITY_RADAR, 1);
    assert.equal(m.merged_duplicates, 1, 'the QA duplicate is a merged duplicate, not a card or a held-back item');
    assert.equal(g.byTier.TIER_1 + g.byTier.TIER_2 + g.byTier.WATCHLIST + g.byTier.NOISE, m.shown);
    assert.equal(g.heldBack.total, m.held_back.total);
    assert.match(g.heldBack.line, /2 held back: Awaiting verification/);
    // held items stay in the list, flagged, and never count as a chip category
    const flagged = g.events.filter((e) => e.quarantine_reason);
    assert.equal(flagged.length, 5, 'fund + regulator + 2 awaiting + 1 contradicted; the QA duplicate is folded, not listed');
    assert.ok(flagged.every((e) => e.category === 'HELD_BACK' && e.tier === 'NOISE'));
    assert.equal(m.coverage_raw!.buckets['M&A / Merger Arb'], 854);
    assert.equal(Object.values(m.shown_by_category).reduce((a, b) => a + b, 0), m.shown);
  });
  test('a kept event the adapter classifies as held back (stale cached payload) is flagged in the list too', async () => {
    const { assembleGatedFeed } = await import('../multibagger-radar-adapter');
    const g = assembleGatedFeed({ kept: [secEv('SC TO-I - Kennedy Lewis Capital Co (0001500010) (Subject)')], held: [], awaiting: [] });
    assert.equal(g.countModel.shown, 0);
    assert.equal(g.events[0].quarantine_reason, 'FUND_REPURCHASE_OFFER');
    assert.equal(g.countModel.reconciles, true);
  });
  test('the route-decided reason is honoured by the adapter (radar line = route line)', () => {
    const i = eventToRadarInput({ ...newsEv('Zetacorp wins Rs 400 crore order'), quarantine_reason: 'AWAITING_VERIFICATION' } as RadarFeedEvent);
    assert.equal(i.feedQuarantineReason, 'AWAITING_VERIFICATION');
    assert.equal(i.feedQuarantineLabel, FEED_QUARANTINE_LABEL.AWAITING_VERIFICATION);
    const sp = splitRadarInputs([{ ...newsEv('Zetacorp wins Rs 400 crore order'), quarantine_reason: 'AWAITING_VERIFICATION' } as RadarFeedEvent]);
    assert.equal(sp.inputs.length, 0); assert.equal(sp.heldBack.byReason.AWAITING_VERIFICATION, 1);
  });
  test('playbook why_tradable never reaches the engine as facts', () => {
    const e = secEv('SC 13E3 - Kappa Systems Inc (0001500020) (Subject)', { why: { what_happened: 'Going-private transaction (SC 13E3) filed.', what_matters: 'Playbook (typical for this event type, not from the source): Insider/PE buyout at premium to market — typical 20–40% premium for control.', what_to_watch: 'Fairness opinion · vote threshold.', what_breaks_thesis: 'Inadequate price.' } });
    const i = eventToRadarInput({ ...e, why_tradable_kind: 'PLAYBOOK' } as RadarFeedEvent);
    assert.equal((i.feedFacts as any).what_matters, undefined);
    assert.equal((i.feedFacts as any).what_breaks_thesis, undefined);
    assert.equal(i.feedFacts!.what_to_watch, 'Fairness opinion · vote threshold.');
    assert.ok(i.nonEarningsNumbers!.includes('40%'));
  });
  test('price-reaction wording stays context (non-evidence) on shown and held items alike', () => {
    const shown = eventToRadarInput(newsEv('Vedanta Aluminium commissions new smelter line; stock hits all-time high'));
    assert.ok(shown.nonEarningsNumbers!.some((x) => /all-time high/i.test(x)));
  });
});
