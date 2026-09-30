// zzz845 - thesis ledger: qualification, versioning, migration, change log, monitor, post-mortem. Synthetic tickers only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_KEY, addFromRadarItem, addQualifiedEntry, aggregatePostMortems, appendVersion, applyStatus, changeLogOf, isLedgerQualified,
  loadLedger, parseLedger, saveEntry, saveQualifiedFromRadar, updateStatus, type StorageLike,
} from '../multibagger-ledger-store';
import { monitorThesisOf, portfolioMonitorOf } from '../multibagger-radar';
import type { RadarItem } from '../multibagger-radar-types';

function mem(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

const GOOD = {
  id: 'r1', ticker: 'QQA', company: 'Qqa Ltd', region: 'IN', bucket: 'EARNINGS_INFLECTION', kind: 'CAPACITY_INFLECTION',
  event: 'Commissioned line two; utilisation ramp under way', whyItMatters: 'Adds volume at higher margin', changes: ['volume'], mechanism: 'New line lifts volume and utilisation',
  financialImpact: 'Revenue up', duration: { code: 3, label: '4-8 quarters', basis: 'stated', evidence: 'stated' },
  evidence: { status: 'STRONG', sourceRank: 1, sourceLabel: 'Exchange filing', why: 'Filing', independentSources: 1 },
  link: 'DIRECT', inflection: 'NOT_ASSESSED', chain: Array.from({ length: 9 }, (_, i) => ({ step: `Step ${i}`, text: `text ${i}`, status: 'unknown' })), provenThrough: -1, bottleneckQuestion: null,
  proof: { what: 'Utilisation above 70 percent in next quarter', when: 'next results' }, breakConditions: ['Line delayed'],
  expectations: { state: 'NOT_ASSESSED', note: '' }, valuationContext: 'not assessed', technical: { note: null },
  governance: { status: 'CLEAN', flags: [] }, drivers: [], priority: 'MEDIUM', priorityReason: 'x', lowSignal: false, sourceUrl: null, publishedAt: null, feedEventId: null,
  financialTransmission: 'DIRECT', mechanismStatus: 'STATED', mechanismSpecific: true, ledgerEligible: true, catalystMaturity: 'DEVELOPING', evidenceDelta: 'NEW_EVIDENCE',
  upgradeTrigger: 'Margin expands', downgradeTrigger: 'Utilisation stalls',
} as unknown as RadarItem;
const mk = (o: Record<string, unknown>): RadarItem => ({ ...(GOOD as any), ...o }) as RadarItem;
const NOW = '2026-09-30T08:00:00Z';

describe('qualification', () => {
  test('a qualified item passes with no blockers', () => {
    const q = isLedgerQualified(GOOD);
    assert.deepEqual(q, { qualified: true, blockers: [] });
    assert.equal(addQualifiedEntry(GOOD, NOW).ok, true);
  });
  test('refusal lists every blocker', () => {
    const q = isLedgerQualified(mk({
      company: 'Unnamed company', event: '', evidence: { ...GOOD.evidence, status: 'HYPOTHESIS' }, mechanism: '', link: 'INDIRECT', financialTransmission: 'INDIRECT',
      proof: { what: 'Monitor the situation', when: null },
    }));
    assert.equal(q.qualified, false);
    for (const re of [/company/i, /catalyst/i, /Evidence/, /mechanism/i, /earnings link/i, /next proof/i]) assert.ok(q.blockers.some((b) => re.test(b)), String(re));
  });
  test('ledgerEligible false is honoured and its blockers are returned', () => {
    const q = isLedgerQualified(mk({ ledgerEligible: false, ledgerBlockers: ['Engine says no.'] }));
    assert.equal(q.qualified, false);
    assert.ok(q.blockers.includes('Engine says no.'));
  });
  test('corporate actions, disproved rumours, dividend text and contradictions never qualify', () => {
    assert.equal(isLedgerQualified(mk({ kind: 'CORPORATE_ACTION', bucket: 'CORPORATE_ACTION' })).qualified, false);
    assert.equal(isLedgerQualified(mk({ kind: 'DISPROVED_RUMOUR' })).qualified, false);
    assert.equal(isLedgerQualified(mk({ event: 'Declares interim dividend, record date 10 Oct', link: 'NEAR_DIRECT', financialTransmission: 'NEAR_DIRECT' })).qualified, false);
    assert.equal(isLedgerQualified(mk({ event: 'Stock split 1:5', financialTransmission: 'NEAR_DIRECT', link: 'NEAR_DIRECT' })).qualified, false);
    const c = isLedgerQualified(mk({ mechanismStatus: 'CONTRADICTED' }));
    assert.ok(c.blockers.some((b) => /contradicts/.test(b)));
  });
  test('structural indirect mechanism can qualify; a plain indirect one cannot', () => {
    assert.equal(isLedgerQualified(mk({ bucket: 'MULTIBAGGER', link: 'INDIRECT', financialTransmission: 'INDIRECT' })).qualified, true);
    assert.equal(isLedgerQualified(mk({ link: 'INDIRECT', financialTransmission: 'INDIRECT' })).qualified, false);
  });
  test('saveQualifiedFromRadar refuses and writes nothing for an unqualified item', () => {
    const s = mem();
    const r = saveQualifiedFromRadar(mk({ ledgerEligible: false, evidence: { ...GOOD.evidence, status: 'DISPROVED' } }), NOW, s);
    assert.equal(r.ok, false);
    assert.equal(loadLedger(s).length, 0);
    assert.equal(saveQualifiedFromRadar(GOOD, NOW, s).ok, true);
    assert.equal(loadLedger(s).length, 1);
  });
});

describe('versioning', () => {
  test('new entry starts at v1 with dates and conditions', () => {
    const e = addFromRadarItem(GOOD, NOW);
    assert.equal(e.versions!.length, 1);
    assert.equal(e.versions![0].version, 1);
    assert.equal(e.firstDiscovered, '2026-09-30');
    assert.equal(e.firstFinancialConfirmation, null);
    assert.equal(e.upgradeCondition, 'Margin expands');
    assert.equal(e.downgradeCondition, 'Utilisation stalls');
  });
  test('updates append and never overwrite earlier versions', () => {
    const e1 = addFromRadarItem(GOOD, NOW);
    const r2 = appendVersion(e1, { date: '2026-10-10', thesis: 'Line two running; thesis refined', evidenceStatus: 'CONFIRMED', catalystMaturity: 'FINANCIALLY_VISIBLE', whatChanged: 'Evidence update: second filing', reason: 'Filing shows shipments', evidenceRefs: ['Filing A'] });
    assert.ok(r2.ok); if (!r2.ok) return;
    const r3 = appendVersion(r2.entry, { date: '2026-11-20', whatChanged: 'Financial confirmation', reason: 'Results show revenue lift', to: 'STRENGTHENING', firstFinancialConfirmation: '2026-11-20' });
    assert.ok(r3.ok); if (!r3.ok) return;
    const v = r3.entry.versions!;
    assert.deepEqual(v.map((x) => x.version), [1, 2, 3]);
    assert.equal(v[0].thesis, e1.versions![0].thesis);
    assert.equal(v[1].thesis, 'Line two running; thesis refined');
    assert.equal(v[2].thesis, 'Line two running; thesis refined');
    assert.deepEqual(v[2].statusChange, { from: 'EARLY', to: 'STRENGTHENING' });
    assert.equal(r3.entry.firstFinancialConfirmation, '2026-11-20');
    const r4 = appendVersion(r3.entry, { whatChanged: 'later', reason: 'Another update', firstFinancialConfirmation: '2027-01-01' });
    assert.ok(r4.ok && r4.entry.firstFinancialConfirmation === '2026-11-20');
    assert.equal(appendVersion(e1, { whatChanged: 'x', reason: ' ' }).ok, false);
  });
  test('owner edit of the form keeps versions and adds one for changed thesis text', () => {
    const s = mem();
    const e = addFromRadarItem(GOOD, NOW);
    saveEntry(e, s);
    saveEntry({ ...e, thesis: 'Rewritten thesis', versions: undefined }, s);
    const got = loadLedger(s)[0];
    assert.equal(got.versions!.length, 2);
    assert.equal(got.versions![0].thesis, e.thesis);
    assert.equal(got.thesis, 'Rewritten thesis');
  });
  test('legacy entries migrate to v1 without losing data', () => {
    const legacy = {
      id: 'OLD::X', ticker: 'OLD', company: 'Old Co', thesis: 'Old thesis', dateIdentified: '2026-05-01', catalyst: 'Old catalyst', evidence: 'Strong - Filing. ok',
      status: 'STRENGTHENING', lastReview: '2026-06-01', history: [{ date: '2026-06-01', from: 'EARLY', to: 'STRENGTHENING', reason: 'Shipments began' }], fromRadarId: null,
    };
    const s = mem({ [LEDGER_KEY]: JSON.stringify([legacy]) });
    const e = loadLedger(s)[0];
    assert.equal(e.thesis, 'Old thesis');
    assert.equal(e.versions!.length, 1);
    assert.equal(e.versions![0].thesis, 'Old thesis');
    assert.equal(e.versions![0].evidenceStatus, 'STRONG');
    assert.equal(e.versions![0].statusChange.to, 'EARLY');
    assert.equal(e.history.length, 1);
    assert.equal(e.firstDiscovered, '2026-05-01');
    assert.equal(e.firstFinancialConfirmation, null);
    assert.equal(e.postMortem, null);
    const rows = changeLogOf(e);
    assert.ok(rows.some((r) => /Shipments began/.test(r.evidence)));
  });
});

describe('change log', () => {
  test('rows come from versions and history; only populated rows', () => {
    const e1 = addFromRadarItem(GOOD, NOW);
    const r = applyStatus(e1, 'STRENGTHENING', 'Second filing confirms shipments', '2026-10-05T00:00:00Z');
    assert.ok(r.ok); if (!r.ok) return;
    const rows = changeLogOf(r.entry);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((x) => x.date), ['2026-09-30', '2026-10-05']);
    assert.match(rows[1].impact, /early to strengthening/);
    for (const row of rows) for (const c of Object.values(row)) assert.ok(c.trim().length > 0);
    const empty = changeLogOf({ ...r.entry, versions: [{ ...r.entry.versions![0], whatChanged: 'Not established' }], history: [] });
    assert.equal(empty.length, 0);
  });
});

describe('monitor: evidence only, price never', () => {
  const e = addFromRadarItem(GOOD, NOW);
  test('status follows evidenceDelta and maturity', () => {
    assert.equal(monitorThesisOf(e, mk({ evidenceDelta: 'FIRST_FINANCIAL_CONFIRMATION', catalystMaturity: 'CONFIRMED' })).status, 'STRENGTHENING');
    assert.equal(monitorThesisOf(e, mk({ evidenceDelta: 'WEAKENED' })).status, 'WEAKENING');
    assert.equal(monitorThesisOf(e, mk({ evidenceDelta: 'CONTRADICTED', catalystMaturity: 'BROKEN' })).status, 'BROKEN');
    assert.equal(monitorThesisOf(e, mk({ evidenceDelta: 'UNCHANGED' })).status, 'NO_MATERIAL_CHANGE');
    assert.equal(monitorThesisOf(e, mk({ evidenceDelta: 'NEW_EVIDENCE', catalystMaturity: 'DEVELOPING' })).status, 'EARLY');
    assert.equal(monitorThesisOf(e, mk({ evidenceDelta: 'NEW_EVIDENCE', catalystMaturity: 'DEVELOPING' })).status, 'EARLY');
    assert.equal(monitorThesisOf(e, mk({ evidenceDelta: 'NEW_EVIDENCE', catalystMaturity: 'DISCOVERY' })).status, 'WEAKENING');
    const fin = { ...e, versions: [{ ...e.versions![0], catalystMaturity: 'CONFIRMED' as const }] };
    assert.equal(monitorThesisOf(fin, mk({ evidenceDelta: 'NEW_EVIDENCE', catalystMaturity: 'CONFIRMED' })).status, 'INTACT');
    const back = { ...e, versions: [{ ...e.versions![0], catalystMaturity: 'CONFIRMED' as const }] };
    assert.equal(monitorThesisOf(back, mk({ evidenceDelta: 'NEW_EVIDENCE', catalystMaturity: 'DEVELOPING' })).status, 'WEAKENING');
  });
  test('no radar item: no material change, not a negative', () => {
    const m = monitorThesisOf(e, null);
    assert.equal(m.status, 'NO_MATERIAL_CHANGE');
    assert.equal(monitorThesisOf(null, null).status, 'NO_MATERIAL_CHANGE');
  });
  test('price-only change leaves status and answers unchanged', () => {
    const a = monitorThesisOf(e, mk({ evidenceDelta: 'UNCHANGED' }));
    const b = monitorThesisOf(e, mk({ evidenceDelta: 'UNCHANGED', priceResponse: { text: 'Stock fell 30 percent', pct: -30, direction: 'DOWN', note: '' }, technical: { note: 'Broke support' } }));
    assert.deepEqual(a, b);
    assert.equal(monitorThesisOf.length, 2);
  });
  test('answers compare against the original thesis and stay backward compatible', () => {
    const m = monitorThesisOf(e, GOOD);
    assert.equal(m.originalThesis, e.thesis);
    assert.match(m.failureConditions, /Line delayed/);
    assert.equal(Object.keys(portfolioMonitorOf(e, GOOD)).length, 10);
  });
});

describe('post-mortem', () => {
  test('BROKEN creates a post-mortem and keeps history', () => {
    const e = addFromRadarItem(GOOD, NOW);
    const r = applyStatus(e, 'BROKEN', 'Customer cancelled the order', '2027-01-10T00:00:00Z', { postMortem: { detectionFailureWhy: 'Relied on one press report', falsePositiveReason: 'INSUFFICIENT_EVIDENCE', transmissionAssumed: true } });
    assert.ok(r.ok); if (!r.ok) return;
    const pm = r.entry.postMortem!;
    assert.equal(pm.originalCatalyst, e.catalyst);
    assert.equal(pm.failurePoint, 'Customer cancelled the order');
    assert.equal(pm.detectionFailureWhy, 'Relied on one press report');
    assert.equal(pm.transmissionAssumed, true);
    assert.equal(r.entry.versions!.length, 2);
    assert.equal(r.entry.versions![0].thesis, e.thesis);
    const s = mem();
    saveEntry(e, s);
    const u = updateStatus(e.id, 'BROKEN', 'Customer cancelled the order', NOW, s);
    assert.equal(u.error, undefined);
    assert.ok(loadLedger(s)[0].postMortem);
    assert.ok(parseLedger(JSON.stringify(loadLedger(s)))[0].postMortem);
  });
  test('a non-broken change makes no post-mortem; aggregation counts reasons', () => {
    const e = addFromRadarItem(GOOD, NOW);
    const ok = applyStatus(e, 'WEAKENING', 'Delay disclosed', NOW);
    assert.ok(ok.ok && ok.entry.postMortem === null);
    const mkB = (t: string, reason: any, flag = false) => {
      const r = applyStatus({ ...e, ticker: t }, 'BROKEN', 'It broke here', NOW, { postMortem: { falsePositiveReason: reason, durationOverstated: flag } });
      return r.ok ? r.entry : e;
    };
    const agg = aggregatePostMortems([mkB('AAA', 'PRICE_ONLY', true), mkB('BBB', 'PRICE_ONLY'), mkB('CCC', 'IMMATERIAL'), e]);
    assert.equal(agg.total, 3);
    assert.deepEqual(agg.byReason.map((x) => [x.reason, x.count]), [['PRICE_ONLY', 2], ['IMMATERIAL', 1]]);
    assert.equal(agg.flags.durationOverstated, 1);
  });
});
