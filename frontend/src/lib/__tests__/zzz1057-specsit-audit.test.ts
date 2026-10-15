// zzz1057 — Special Situations audit: court case reports vs turnaround / distress, tier + category + coverage boxes that add up
// to the shown count, capacity / first-concall typing, fund-subject test, document resolution by company name (EDGAR full text),
// an end state for items that can never be verified, zero boxes hidden. Fixtures are synthetic or public law-feed titles.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capexOrConcallEventType, courtCaseHoldDetail, courtCaseReport, eventAgeDays, isFundSubject, refineDistressType, splitExpiredAwaiting, VERIFY_EXPIRE_DAYS,
} from '../special-sit-audit';
import { classifyFeedHoldBack } from '../special-sit-security';
import { FEED_QUARANTINE_LABEL } from '../special-sit-feed-quality';
import { computeCoverageDiagnostic } from '../specsit-institutional';
import { assembleGatedFeed } from '../multibagger-radar-adapter';
import { locateDocs, locateUsByName, searchableNames, type EdgarNameHit } from '../ai-verify-locator';
import { specSitToClaim } from '../ai-verify-gate';
import { locatedTtlFor } from '../ai-verify';
import { expiredLine, headerFromModel, splitZeroBoxes, verificationLine, AI_UNAVAILABLE_TEXT } from '../../components/special-situations/ss-counts';
import type { RadarFeedEvent, RadarFeedItem } from '../multibagger-radar-feed-types';
import type { LocatedDoc } from '../ai-verify-types';

const NOW = Date.parse('2026-10-15T20:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
let n = 0;
function ev(title: string, o: { source?: string; description?: string; region?: 'IN' | 'US' | 'GLOBAL'; event_type?: string; tier?: string; pub?: string; link?: string } = {}): RadarFeedEvent {
  n += 1;
  const pf: RadarFeedItem = { title, source: o.source || 'ET Industry', link: o.link || `https://news.test/${n}`, description: o.description, pub_date: o.pub || daysAgo(1), region: o.region || 'IN' };
  return { event_id: `e${n}`, event_type: o.event_type || 'ACQUISITION_PUBLIC', region: o.region || 'IN', tier: o.tier || 'TIER_2', primary_filing: pf, filings: [pf] } as RadarFeedEvent;
}

// ─── 1. NCLT / court case reports vs turnaround ──────────────────────────────
describe('1 court case reports are not turnarounds', () => {
  const CASES = [
    'Ravi Dhiman Vs. Ritu Rastogi (RP) – NCLAT, Principal Bench, New Delhi',
    'CMA Harshad Deshpande, RP of Vivaan Multistructures Ltd. – NCLT, Mumbai Bench',
    'VIA Projects Pvt. Ltd. Vs. Narendra Kumar Sharma, RP of Spaze Towers Pvt. Ltd. – NCLT, New Delhi Bench',
    'SPC International (India) Pvt. Ltd. – NCLT, Bengaluru Bench',
    'Authorised Officer, Punjab National Bank Vs. Sabbineni Sarojini – DRAT, Kolkata',
    'Reena Aggarwal Vs. Logix lnfratech Pvt. Ltd. and Ors. – NCLAT, Principal Bench, New Delhi',
    'Ascot Hotels &#038; Resorts Ltd. and Ors. Vs. Housing and Urban Development Corporation Ltd. and Anr. &#8211; DRAT, Delhi',
    'Emaar India Ltd. (Formerly known as Emaar MGF Land Ltd.) Vs. Poonam Goel and Anr. &#8211; Haryana REAT',
  ];
  test('law-feed case titles are recognised (entities decoded, typos and "formerly known as" tolerated)', () => {
    for (const t of CASES) assert.ok(courtCaseReport(t, () => undefined), t);
  });
  test('news headlines that mention a court are not case reports', () => {
    for (const t of [
      'Vedanta demerger approved – NCLT',
      'SC strikes down MMTC appeal against NSEL one-time settlement',
      'NCLAT Upholds Resolution Plan Approval for Satellite Cables; Dismisses Appeals by Suspended Directors Under IBC',
      'Adani Ports shares jump 5% – here is why',
      'Reliance Vs. Amazon battle heats up – Supreme Court',
    ]) assert.equal(courtCaseReport(t, () => undefined), null, t);
  });
  test('held back as COURT_CASE_REPORT (route and adapter use the same classifier); SEC rows are never court reports', () => {
    const d = classifyFeedHoldBack({ title: CASES[0], source: 'IBC Laws', eventType: 'TURNAROUND_OPERATING', courtLookup: () => undefined });
    assert.equal(d?.reason, 'COURT_CASE_REPORT');
    assert.equal(d?.label, FEED_QUARANTINE_LABEL.COURT_CASE_REPORT);
    assert.equal(classifyFeedHoldBack({ title: 'SC TO-T - ACME INC (0000123456) (Subject)', source: 'SEC SC TO-T' }), null);
    // a law-feed digest is not a company event either
    assert.ok(courtCaseHoldDetail('Insolvency Bulletin – Weekly Case Laws Digest: 5 October to 10 October, 2026', () => undefined, 'IBC Laws'));
  });
  test('an NCLT matter whose party is a LISTED company is an insolvency event (distress), never held and never a turnaround', () => {
    const t = 'State Bank of India Vs. Orion Textiles Ltd. – NCLT, Mumbai Bench';
    const lookup = (nm: string) => (/orion textiles/i.test(nm) ? 'ORIONTEX' : undefined);
    assert.equal(courtCaseReport(t, lookup)!.listedParty!.ticker, 'ORIONTEX');
    assert.equal(courtCaseHoldDetail(t, lookup, 'IBC Laws'), null);
    assert.equal(refineDistressType('TURNAROUND_OPERATING', `${t} insolvency petition admitted`, t, lookup), 'NCLT_IBC_ADMISSION');
    // a listed BANK as the creditor does not make the case a listed-company event
    assert.equal(courtCaseReport('ICICI Bank Ltd. Vs. Ossify Industries Pvt. Ltd. – NCLT, Allahabad Bench', (nm) => (/icici/i.test(nm) ? 'ICICIBANK' : undefined))!.listedParty, null);
  });
  test('turnaround = operating turnaround: insolvency wording moves to NCLT / IBC; a headline that is not about a turnaround is dropped', () => {
    assert.equal(refineDistressType('TURNAROUND_OPERATING', 'Coffee Day clears loan via one-time settlement', 'Coffee Day clears loan via one-time settlement'), 'NCLT_IBC_RESOLUTION');
    assert.equal(refineDistressType('TURNAROUND_OPERATING', 'Marcus & Millichap swings back to profit as deals return', 'Marcus & Millichap (MMI) Swings Back To Profit As Deals Return'), 'TURNAROUND_OPERATING');
    assert.equal(refineDistressType('TURNAROUND_OPERATING', 'Lumino Industries shares soar 40% after IPO. Proceeds for debt reduction.', 'Lumino Industries shares soar 40% from IPO price after strong market debut'), 'UNCLASSIFIED');
    assert.equal(refineDistressType('ACQUISITION_PUBLIC', 'X to acquire Y', 'X to acquire Y'), 'ACQUISITION_PUBLIC', 'other types untouched');
  });
  test('coverage: an event type is in at most ONE bucket; turnaround is not in the NCLT bucket', () => {
    const defs = computeCoverageDiagnostic({});
    const seen = new Map<string, string>();
    for (const b of defs) for (const t of b.event_types) { assert.ok(!seen.has(t), `${t} in ${seen.get(t)} and ${b.bucket}`); seen.set(t, b.bucket); }
    assert.ok(!defs.find((b) => b.bucket === 'NCLT / IBC / Distressed')!.event_types.includes('TURNAROUND_OPERATING'));
    assert.equal(seen.get('TURNAROUND_OPERATING'), 'Operating Turnaround');
    assert.equal(seen.get('CAPEX_EXPANSION'), 'Capacity / New Ventures');
    assert.equal(seen.get('FIRST_CONCALL'), 'First Concall / Presentation');
  });
});

// ─── 2. capacity expansion / first concall / fund subject ────────────────────
describe('2 capacity expansion and first concall get an event type; fund = the subject', () => {
  test('strict capacity detector', () => {
    assert.equal(capexOrConcallEventType('CAPEX', 'Orion Cement to set up a 2 MTPA greenfield plant in Rajasthan at Rs 1,200 crore'), 'CAPEX_EXPANSION');
    assert.equal(capexOrConcallEventType('CAPEX', 'Delta Polymers commences commercial production at its new Dahej unit'), 'CAPEX_EXPANSION');
    assert.equal(capexOrConcallEventType('CAPEX', 'Gamma Infra bags new order worth Rs 300 crore'), null, 'an order win is not capacity');
    assert.equal(capexOrConcallEventType('CAPEX', 'Beta Steel defers capacity expansion to FY28'), null);
    assert.equal(capexOrConcallEventType('CAPEX', 'Kappa forms new joint venture'), null);
  });
  test('first concall only (not every quarterly call)', () => {
    assert.equal(capexOrConcallEventType('CONCALL', 'KRM Ayurveda to hold its first concall after listing'), 'FIRST_CONCALL');
    assert.equal(capexOrConcallEventType('CONCALL', 'Pajson Agro maiden investor presentation released'), 'FIRST_CONCALL');
    assert.equal(capexOrConcallEventType('CONCALL', 'Q2 FY27 earnings call transcript of Delta Ltd'), null);
    assert.equal(capexOrConcallEventType('CONCALL', 'Delta Ltd first quarter results conference call'), null);
  });
  test('"fund" as a verb or as the investor does not make the subject a fund', () => {
    assert.equal(isFundSubject('Ola Electric'), false);
    assert.equal(isFundSubject('GP Petroleums'), false);
    assert.equal(isFundSubject('Bow River Capital Evergreen Fund'), true);
    assert.equal(isFundSubject('XAI Floating Rate & Alternative Income Trust'), true);
    assert.equal(isFundSubject('Medical Properties Trust Bank'), false);
  });
});

// ─── 3. tier / category / coverage boxes add up to the shown count ──────────
describe('3 the boxes add up to the shown count', () => {
  test('the tier remainder (NOISE) gets its own Low-signal box: 8 + 62 + 93 + 10 = 173', () => {
    const h = headerFromModel({ shown: 173, shown_by_tier: { TIER_1: 8, TIER_2: 62, WATCHLIST: 93, NOISE: 10 }, shown_by_category: { MA: 66, TURN: 83, SPIN: 6, CAP: 17, UNCATEGORISED: 1 } } as any, 'ALL')!;
    assert.deepEqual(h.tiers, { TIER_1: 8, TIER_2: 62, WATCHLIST: 93 });
    assert.equal(h.tiers.TIER_1 + h.tiers.TIER_2 + h.tiers.WATCHLIST + h.lowSignal, 173);
    assert.equal(headerFromModel({ shown: 5, shown_by_tier: { TIER_1: 5 }, shown_by_category: {} } as any, 'ALL')!.lowSignal, 0);
  });
  test('zero boxes are hidden and named once; the shown boxes keep their order', () => {
    const rows = [{ k: 'Spin', count: 6 }, { k: 'Index Arbitrage', count: 0 }, { k: 'M&A', count: 62 }, { k: 'HoldCo', count: 0 }, { k: 'Governance', count: 0 }];
    const s = splitZeroBoxes(rows, (r) => r.k);
    assert.deepEqual(s.shown.map((r) => r.k), ['Spin', 'M&A']);
    assert.equal(s.emptyLine, 'Nothing today in: Index Arbitrage, HoldCo, Governance.');
    assert.equal(splitZeroBoxes([{ k: 'a', count: 1 }], (r) => r.k).emptyLine, null);
  });
  test('gated feed with court, expired and awaiting items reconciles (E1–E6) and counts each reason apart', () => {
    const kept = [ev('Orion Ltd to acquire Sigma Ltd for Rs 800 crore', { tier: 'TIER_2' }), ev('Pi Corp board approves Rs 500 crore buyback', { event_type: 'BUYBACK_TENDER', tier: 'WATCHLIST' })];
    const court = ev('Ravi Dhiman Vs. Ritu Rastogi (RP) – NCLAT, Principal Bench, New Delhi', { source: 'IBC Laws', event_type: 'TURNAROUND_OPERATING', tier: 'WATCHLIST' });
    const awaiting = [ev('Theta Ltd to buy stake in Iota Ltd', { pub: daysAgo(2) })];
    const expired = [ev('Lambda Ltd to acquire Mu Ltd', { pub: daysAgo(40) }), ev('Nu Corp to merge with Xi Corp', { pub: daysAgo(30) })];
    const g = assembleGatedFeed({ kept: [...kept, court], held: [], awaiting, expired, coverageBucketOf: () => 'M&A / Merger Arb' });
    const m = g.countModel;
    assert.equal(m.reconciles, true, m.mismatches.join('; '));
    assert.equal(m.shown, 2, 'the court case report is held back even when it arrived in the kept list (stale cached build)');
    assert.equal(m.held_back.by_reason.COURT_CASE_REPORT, 1);
    assert.equal(m.held_back.by_reason.VERIFICATION_EXPIRED, 2);
    assert.equal(m.held_back.by_reason.AWAITING_VERIFICATION, 1);
    assert.equal(g.byTier.TIER_1 + g.byTier.TIER_2 + g.byTier.WATCHLIST + g.byTier.NOISE, m.shown);
    assert.equal(Object.values(m.shown_by_category).reduce((a, b) => a + b, 0), m.shown);
    assert.equal(Object.values(m.shown_by_coverage).reduce((a, b) => a + b, 0), m.shown);
    assert.match(g.heldBack.line, /Closed unverified/);
  });
});

// ─── 4. verification backlog: document resolution + an end state ────────────
describe('4 verification backlog', () => {
  test('awaiting items with no document (or claim not in it) older than the expiry are closed; queued / unreadable never expire', () => {
    const a = ev('A', { pub: daysAgo(40) }), b = ev('B', { pub: daysAgo(3) }), c = ev('C', { pub: daysAgo(40) }), d = ev('D', { pub: daysAgo(40) }), e = ev('E', { pub: daysAgo(20) });
    const rows = [
      { refId: a.event_id, reason: 'no_primary' }, { refId: b.event_id, reason: 'no_primary' }, { refId: c.event_id, reason: 'queued' },
      { refId: d.event_id, reason: 'unreadable' }, { refId: e.event_id, reason: 'not_found' },
    ];
    const s = splitExpiredAwaiting([a, b, c, d, e], rows, NOW);
    assert.deepEqual(s.expired.map((x) => x.event_id), [a.event_id, e.event_id]);
    assert.deepEqual(s.live.map((x) => x.event_id), [b.event_id, c.event_id, d.event_id]);
    assert.deepEqual(s.expiredByReason, { no_primary: 1, not_found: 1 });
    assert.equal(VERIFY_EXPIRE_DAYS, 14);
    assert.equal(eventAgeDays({ primary_filing: {} }, NOW), null, 'undated: never expired on age');
  });
  test('the expired count is said plainly, apart from the waiting count', () => {
    assert.equal(expiredLine({ expired: 0 }), null);
    assert.match(expiredLine({ expired: 6, expiredByReason: { no_primary: 5, not_found: 1 }, expireAfterDays: 14 })!, /^6 closed unverified after 14 days \(No company document to read 5 · Not found in the document 1\)/);
  });
  test('a closed item is searched for a document again only every 12 days (sooner than a found one is kept)', () => {
    const none = { found: false } as LocatedDoc;
    assert.equal(locatedTtlFor(none, daysAgo(30), NOW), 12 * 86_400);
    assert.equal(locatedTtlFor(none, daysAgo(10), NOW), 7 * 86_400);
    assert.equal(locatedTtlFor(none, daysAgo(1), NOW), 86_400);
    assert.ok(locatedTtlFor({ found: true } as LocatedDoc, daysAgo(30), NOW) > locatedTtlFor(none, daysAgo(30), NOW));
  });
  const usClaim = (title: string, pub = daysAgo(2)) => specSitToClaim(ev(title, { region: 'US', source: 'Yahoo Finance', pub }))!;
  test('a US story with no ticker is matched to the company\'s OWN EDGAR filing by name (never a filing that merely mentions it)', () => {
    const c = usClaim('Quantum Harbor Systems agrees to acquire Bluefin Robotics for $420 million');
    assert.deepEqual(searchableNames(c.locateHints!), ['Quantum Harbor Systems']);
    const hits: EdgarNameHit[] = [
      { cik: 222, company: 'Bluefin Robotics Inc', form: '8-K', filingDate: daysAgo(2).slice(0, 10), accession: '0000222000-26-000001', items: ['1.01'] },
      { cik: 111, company: 'Quantum Harbor Systems, Inc.', form: '8-K', filingDate: daysAgo(1).slice(0, 10), accession: '0000111000-26-000009', items: ['1.01', '9.01'] },
    ];
    const r = locateUsByName(c, 'Quantum Harbor Systems', hits, new Date(NOW));
    assert.equal(r.found, true);
    assert.equal(r.how, 'edgar_by_name');
    assert.match(r.url!, /edgar\/data\/111\/000011100026000009\//);
    const none = locateUsByName(c, 'Quantum Harbor Systems', hits.slice(0, 1), new Date(NOW));
    assert.equal(none.found, false);
    assert.match(none.detail, /EDGAR full-text search for "Quantum Harbor Systems"/);
  });
  test('locateDocs uses the name search when the event names no ticker; unknown (EDGAR down) is searched again, never "none"', async () => {
    const c = usClaim('Quantum Harbor Systems agrees to acquire Bluefin Robotics for $420 million');
    const io = (hits: EdgarNameHit[] | null) => ({
      indiaFilings: async () => [], cikForTicker: async () => null, submissions: async () => null, now: () => new Date(NOW),
      searchByName: async () => hits,
    });
    const found = await locateDocs([c], io([{ cik: 111, company: 'Quantum Harbor Systems Inc', form: '8-K', filingDate: daysAgo(1).slice(0, 10), accession: '0000111000-26-000009', items: ['1.01'] }]), { deadline: Date.now() + 5_000 });
    assert.equal(found.get(c.claimId)?.found, true);
    const unknown = await locateDocs([c], io(null), { deadline: Date.now() + 5_000 });
    assert.equal(unknown.has(c.claimId), false);
    // without the name search (older I/O) the old message stays
    const legacy = await locateDocs([c], { indiaFilings: async () => [], cikForTicker: async () => null, submissions: async () => null, now: () => new Date(NOW) }, { deadline: Date.now() + 5_000 });
    assert.match(legacy.get(c.claimId)!.detail, /names no US ticker/);
  });
  test('a generic group / sector word alone is never searched', () => {
    const c = usClaim('Global Energy Holdings to sell unit');
    assert.deepEqual(searchableNames(c.locateHints!), []);
  });
});

// ─── 5. AI check honesty ────────────────────────────────────────────────────
describe('5 the AI check never pretends', () => {
  test('a missing key reads "not configured"', () => {
    const u = verificationLine({ available: false, unavailableReason: 'No ANTHROPIC_API_KEY is configured on the server.' })!;
    assert.equal(u.available, false);
    assert.ok(u.text.startsWith(AI_UNAVAILABLE_TEXT));
    assert.match(u.text, /Not configured: No ANTHROPIC_API_KEY is configured on the server\./);
    assert.doesNotMatch(verificationLine({ available: false, unavailableReason: 'Monthly AI cap reached.' })!.text, /Not configured/);
  });
});
