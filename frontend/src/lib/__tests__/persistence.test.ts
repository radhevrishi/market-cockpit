// zzz780 — persistent catalyst layer. Run: npx tsx --test src/lib/__tests__/persistence.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectPersistentCatalysts, itemsFromFinding } from '../catalyst/persistence';
import { mergeDetections, focusStatus, type PersistBlob } from '../catalyst/persistence-store';

let n = 0;
const fact = (period: string, metric: string, after: string, o: Partial<{ before: string; stmt: string; date: string; type: string; quote: string }> = {}) => ({
  id: `f${n++}`, ticker: 'T', reporting_period: period, evidence_type: o.type || (o.stmt === 'TARGET' || o.stmt === 'GUIDANCE' ? 'forward' : 'mechanism'),
  metric_name: metric, metric_label: metric, value: after, before_value: o.before ?? null, after_value: after, unit: null, delta: null, direction: 'up',
  source_document_id: null, source_name: `Concall ${period}`, source_date: o.date || '2026-08-01', source_type: 'transcript', source_quote: o.quote || `we ${metric} ${after}`,
  fact_or_management_statement: o.stmt || 'FACT', confidence: 'HIGH', evidence_quality: 'sentence', extracted_at: '', updated_at: '', record_status: 'ACTIVE',
});
const ledger = (periods: Record<string, any[]>) => ({
  latest_period: Object.keys(periods).pop(), latest_document_date: '2026-08-01',
  periods: Object.fromEntries(Object.entries(periods).map(([p, facts]) => [p, { reporting_period: p, facts, summary: null }])),
});
const detect = (l: any, extra: any = {}) => detectPersistentCatalysts({ ticker: 'T', ledger: l, origin: 'portfolio', today: '2026-09-24', ...extra });
const kind = (list: any[], k: string) => list.find((p) => p.kind === k);

describe('zzz780 persistent catalyst layer', () => {
  test('Example 1 — capacity ramp across quarters is ONE catalyst, scaling, Special Focus', () => {
    const l = ledger({
      'Q2 FY26': [fact('Q2 FY26', 'capacity', '1,00,000 TPA', { before: '50,000 TPA', date: '2025-11-01' }), fact('Q2 FY26', 'commissioning', 'new plant commissioned', { date: '2025-11-01' })],
      'Q3 FY26': [fact('Q3 FY26', 'utilisation', '30%', { date: '2026-02-01' })],
      'Q4 FY26': [fact('Q4 FY26', 'utilisation', '48%', { date: '2026-05-01' })],
      'Q1 FY27': [fact('Q1 FY27', 'utilisation', '65%', { date: '2026-08-01' }), fact('Q1 FY27', 'volume', 'volume grew 22% YoY', { date: '2026-08-01' })],
    });
    const list = detect(l);
    const cap = kind(list, 'CAPACITY_RAMP');
    assert.equal(list.filter((p) => p.kind === 'CAPACITY_RAMP').length, 1, 'one persistent catalyst, not four');
    assert.equal(cap.state, 'SCALING');
    assert.ok(cap.specialFocus, cap.why.join(' | '));
    assert.ok(cap.periods.length >= 3);
    assert.ok(cap.beforeAfter.some((r: any) => r.variable === 'Utilisation' && r.direction === '↑'));
    assert.match(cap.nextMilestone, /utilisation above 65%/i);
    assert.equal(cap.duration, 'Duration: Unknown', 'duration is never invented');
  });

  test('Example 2 — growing order book with repeat intake: multi-period demand', () => {
    const l = ledger({
      'Q3 FY26': [fact('Q3 FY26', 'order_book', 'INR 3,000 crores', { before: 'INR 2,000 crores', date: '2026-02-01' }), fact('Q3 FY26', 'order_intake', 'INR 900 crores', { date: '2026-02-01' })],
      'Q1 FY27': [fact('Q1 FY27', 'order_book', 'INR 4,500 crores', { date: '2026-08-01' }), fact('Q1 FY27', 'order_intake', 'INR 1,400 crores', { date: '2026-08-01' })],
    });
    const ob = kind(detect(l, { quarterRevenueCr: 425 }), 'ORDER_VISIBILITY');
    assert.equal(ob.state, 'SCALING');
    assert.ok(ob.specialFocus, ob.why.join(' | '));
    assert.match(ob.runway.text, /annual revenue/);
  });

  test('Example 3 — margin from an inventory gain is NOT persistent and never Special Focus', () => {
    const l = ledger({ 'Q1 FY27': [fact('Q1 FY27', 'one_offs', 'inventory gain of INR 40 crores lifted margins'), fact('Q1 FY27', 'volume', 'basically flat volume')] });
    const list = detectPersistentCatalysts({ ticker: 'T', ledger: l, origin: 'portfolio', today: '2026-09-24',
      assessment: { status: 'ON_TRACK', mechanismEvidence: [{ key: 'margin_driver', text: 'margin up 900 bps on inventory gains' }] } });
    assert.ok(list.every((p) => !p.specialFocus));
    const mix = kind(list, 'MIX_PRICING');
    assert.equal(mix?.confidence, 'TEMPORARY_UNCERTAIN');
  });

  test('Example 4 — qualification → order → repeat raises the customer chain stage', () => {
    const a1 = { status: 'ON_TRACK', mechanismEvidence: [{ key: 'qualification', text: 'qualification: approved supplier to a global OEM' }] };
    const a3 = { status: 'ON_TRACK', mechanismEvidence: [{ key: 'qualification', text: 'qualification: approved supplier to a global OEM' }, { key: 'new_customer', text: 'new customer: first commercial order from the OEM' }, { key: 'new_customer', text: 'repeat order received from the OEM for a second product' }] };
    const s1 = kind(detectPersistentCatalysts({ ticker: 'T', assessment: a1, origin: 'portfolio', today: '2026-09-24' }), 'CUSTOMER_RAMP');
    const s3 = kind(detectPersistentCatalysts({ ticker: 'T', assessment: a3, origin: 'portfolio', today: '2026-09-24' }), 'CUSTOMER_RAMP');
    assert.equal(s1.state, 'IDENTIFIED');
    assert.equal(s3.state, 'RAMPING');
    assert.ok(!s1.specialFocus, 'a qualification remark alone never qualifies');
  });

  test('Example 5 — a theme with no company evidence creates nothing; output alone creates nothing', () => {
    const list = detectPersistentCatalysts({ ticker: 'T', ledger: ledger({}), origin: 'portfolio', today: '2026-09-24',
      assessment: { status: 'ON_TRACK', mechanismEvidence: [] } });
    assert.equal(list.length, 0);
  });

  test('ALKYLAMINE shape — unused capacity with flat volume is not a catalyst', () => {
    const l = ledger({ 'Q1 FY27': [fact('Q1 FY27', 'utilisation', 'between 60% and 85% capacity utilization'), fact('Q1 FY27', 'capacity', '30,000 ton'), fact('Q1 FY27', 'volume', 'basically flat volume and value')] });
    const cap = kind(detect(l), 'CAPACITY_RAMP');
    assert.ok(!cap?.specialFocus);
    assert.equal(cap?.runway.ok, false);
  });

  test('a capex budget, ore reserves and a mismatched unit never count as capacity evidence', () => {
    const l = ledger({ 'Q1 FY27': [
      fact('Q1 FY27', 'capex', 'INR 440 crores'),
      fact('Q1 FY27', 'capacity_addition', '198.61 Million Tonne', { quote: 'ore reserves increased by 198.61 million tonne' }),
      fact('Q1 FY27', 'capacity_addition', 'between INR 250 crores and INR 300 crores'),
    ] });
    const cap = kind(detect(l), 'CAPACITY_RAMP');
    assert.equal(cap?.hardCount ?? 0, 0);
  });

  test('duplicate documents are one item with several sources, not several catalysts', () => {
    const l = ledger({ 'Q1 FY27': [
      fact('Q1 FY27', 'order_book', 'INR 5,143 crores', { date: '2026-08-01' }),
      { ...fact('Q1 FY27', 'order_book', 'Rs. 5,143.3 Cr', { date: '2026-08-02' }), source_name: 'Investor presentation' },
    ] });
    const ob = kind(detect(l), 'ORDER_VISIBILITY');
    const items = ob.evidence.filter((e: any) => e.metric === 'order_book');
    assert.equal(items.length, 1);
    assert.ok(items[0].sources.length >= 2);
  });

  test('a target is a milestone, never evidence; a stated horizon is quoted, not invented', () => {
    const l = ledger({ 'Q1 FY27': [
      fact('Q1 FY27', 'capacity', '1,16,000 TPA', { before: '58,000 TPA' }),
      fact('Q1 FY27', 'utilisation', 'well above 65%'),
      fact('Q1 FY27', 'volume', 'sales volume grew 16% YoY'),
      fact('Q1 FY27', 'capacity', 'over 2 million tons per annum by 2030', { stmt: 'TARGET' }),
    ] });
    const cap = kind(detect(l), 'CAPACITY_RAMP');
    assert.equal(cap.hardCount, 3);
    assert.match(cap.duration, /by 2030 — management target, not a result/);
    assert.ok(cap.forward.length >= 1);
  });

  test('a broken thesis never produces Special Focus; a weakening thesis can still show demand evidence', () => {
    const l = ledger({ 'Q1 FY27': [fact('Q1 FY27', 'order_book', 'INR 2,598 crores'), fact('Q1 FY27', 'book_to_bill', '1.5x'), fact('Q1 FY27', 'order_intake', 'INR 551.9 crores')] });
    const broken = kind(detectPersistentCatalysts({ ticker: 'T', ledger: l, origin: 'portfolio', today: '2026-09-24', assessment: { status: 'BROKEN', mechanismEvidence: [] } }), 'ORDER_VISIBILITY');
    const weak = kind(detectPersistentCatalysts({ ticker: 'T', ledger: l, origin: 'portfolio', today: '2026-09-24', assessment: { status: 'WEAKENING', mechanismEvidence: [] }, quarterRevenueCr: 380 }), 'ORDER_VISIBILITY');
    assert.equal(broken.specialFocus, false);
    assert.equal(weak.specialFocus, true, 'persistent demand evidence and thesis weakening are separate dimensions');
  });

  test('Daily Gainer event → persistence test; price never read', () => {
    const f = { status: 'catalyst', category: 'order_win', stage: 'executed', valueStated: 1200, movePct: 19, marketCap: 3000, sourceDate: '2026-09-20', sourceUrl: 'x', modelRead: true,
      headline: 'Company wins ₹1,200 crore multi-year contract', facts: { counterparty: 'Indian Air Force', execution_period: 'over 3 years', value: 'Rs 1,200 crore' } };
    const items = itemsFromFinding(f);
    assert.equal(items.length, 1);
    assert.equal(items[0].cls, 'HARD');
    const a = detectPersistentCatalysts({ ticker: 'T', finding: f, origin: 'gainers', today: '2026-09-24' });
    const b = detectPersistentCatalysts({ ticker: 'T', finding: { ...f, movePct: 1 }, origin: 'gainers', today: '2026-09-24' });
    assert.deepEqual(a.map((p) => [p.kind, p.confidence, p.specialFocus]), b.map((p) => [p.kind, p.confidence, p.specialFocus]), 'the move size changes nothing');
    assert.equal(kind(a, 'ORDER_VISIBILITY').confidence, 'MEDIUM');
  });

  test('memory: the same id is updated, never duplicated; Special Focus # is kept; decay stays visible', () => {
    const l1 = ledger({ 'Q1': [fact('Q1', 'capacity', '1,00,000 TPA', { before: '50,000 TPA', date: '2026-07-01' }), fact('Q1', 'utilisation', '40%', { date: '2026-07-01' }), fact('Q1', 'volume', 'volume grew 20%', { date: '2026-07-01' })] });
    const blob: PersistBlob = { version: 1, seq: 0, records: {} };
    mergeDetections(blob, detect(l1), 'portfolio', '2026-03-01T00:00:00Z');
    const id = 'T:CAPACITY_RAMP';
    assert.ok(blob.records[id]?.sfId === 1);
    mergeDetections(blob, detect(l1), 'portfolio', '2026-03-02T00:00:00Z');
    assert.equal(blob.records[id].timeline.length, 1, 'no change → no new timeline entry');
    const l2 = ledger({ 'Q2': [fact('Q2', 'utilisation', '95%', { date: '2026-09-01' })] });
    mergeDetections(blob, detect(l2), 'portfolio', '2026-09-02T00:00:00Z');
    assert.equal(Object.keys(blob.records).filter((k) => k === id).length, 1);
    assert.equal(blob.records[id].sfId, 1);
    const fs = focusStatus(blob.records[id]);
    assert.equal(fs.inQueue, true, 'a decayed Special Focus stays in the queue');
    assert.equal(fs.decayed, true);
  });

  test('no buy / sell / target / winner language anywhere in the output', () => {
    const l = ledger({ 'Q1': [fact('Q1', 'capacity', '1,00,000 TPA', { before: '50,000 TPA' }), fact('Q1', 'utilisation', '40%'), fact('Q1', 'volume', 'volume grew 20%')] });
    const txt = JSON.stringify(detect(l));
    assert.doesNotMatch(txt, /\b(buy|sell|price target|multibagger|winner|best stock|upside)\b/i);
  });

  test('zzz781 — a filed commissioning fact is evidence (zzz787: a candidate; demand or utilisation lifts it to Special Focus)', () => {
    const l = ledger({ 'Q1 FY27': [
      fact('Q1 FY27', 'capacity', '9,600 MTPA', { before: '5,000 MTPA' }),
      fact('Q1 FY27', 'capex_status', 'new block commissioned in June', { quote: 'the new block was commissioned in June and is in commercial production' }),
    ] });
    const cap = kind(detect(l), 'CAPACITY_RAMP');
    assert.equal(cap.hardCount, 2);
    assert.notEqual(cap.state, 'IDENTIFIED');
    // zzz787 (intentional change): commissioning alone is a persistent catalyst CANDIDATE, not Special Focus.
    assert.equal(cap.specialFocus, false);
    // zzz788 (intentional change): capacity added with no continuation evidence
    // is headroom, not runway — a candidate (EARLY), no longer MEDIUM.
    assert.equal(cap.confidence, 'EARLY');
    assert.ok(cap.toQualify.some((q: string) => /demand evidence|utilisation|continuation/.test(q)), cap.toQualify.join(' | '));
    // zzz788 (intentional change): commissioned + today's utilisation is
    // headroom, not future demand — no longer Special Focus on its own.
    const withUtil = kind(detect(ledger({ 'Q1 FY27': [...l.periods['Q1 FY27'].facts, fact('Q1 FY27', 'utilisation', '62%', { quote: 'capacity utilisation on the enlarged base was 62%' })] })), 'CAPACITY_RAMP');
    assert.equal(withUtil.specialFocus, false, withUtil.why.join(' | '));
    assert.match(withUtil.headroom || '', /^Capacity headroom: Utilisation 62% — 38 percentage points available on the current installed-capacity basis\.$/);
    // …and recurring volume growth on the new base is continuation → Special Focus.
    const withVol = kind(detect(ledger({ 'Q1 FY27': [...l.periods['Q1 FY27'].facts, fact('Q1 FY27', 'utilisation', '62%', { quote: 'capacity utilisation on the enlarged base was 62%' }), fact('Q1 FY27', 'volume', 'volume grew 24% YoY')] })), 'CAPACITY_RAMP');
    assert.ok(withVol.specialFocus, withVol.why.join(' | '));
    assert.match(withVol.sfBasis || '', /utilisation/);
  });

  test('zzz781 — a capacity target smaller than today (or another unit) is not the next milestone', () => {
    const l = ledger({ 'Q1 FY27': [
      fact('Q1 FY27', 'capacity', '5300 MTPA', { before: '2600 MTPA' }), fact('Q1 FY27', 'utilisation', '80%'),
      fact('Q1 FY27', 'capacity_addition', '200 MTPA', { stmt: 'GUIDANCE' }),
    ] });
    assert.doesNotMatch(kind(detect(l), 'CAPACITY_RAMP').nextMilestone, /200 MTPA/);
  });

  test('zzz781 — Daily Gainers: a second order in the window is a repeat order', () => {
    const f = { status: 'catalyst', category: 'order_win', stage: 'executed', valueStated: 400, sourceDate: '2026-09-20', sourceUrl: 'a', modelRead: false, headline: 'order of ₹400 crore', facts: null };
    const g = { ...f, valueStated: 250, sourceUrl: 'b', sourceDate: '2026-09-10', headline: 'order of ₹250 crore' };
    const one = kind(detectPersistentCatalysts({ ticker: 'T', finding: f, origin: 'gainers', today: '2026-09-24' }), 'ORDER_VISIBILITY');
    const two = kind(detectPersistentCatalysts({ ticker: 'T', finding: f, extraFindings: [g], origin: 'gainers', today: '2026-09-24' }), 'ORDER_VISIBILITY');
    assert.equal(one.hardCount, 1);
    assert.equal(two.hardCount, 2);
    assert.match(two.mechanism, /repeat orders/);
  });

  test('zzz781 — a near miss names exactly what would qualify it', () => {
    const l = ledger({ 'Q1 FY27': [fact('Q1 FY27', 'capacity_addition', '39,600 MTPA'), fact('Q1 FY27', 'capex_status', 'plant commissioned')] });
    const cap = kind(detect(l), 'CAPACITY_RAMP');
    assert.equal(cap.specialFocus, false);
    assert.ok(cap.toQualify.length >= 1 && cap.toQualify.length <= 2, cap.toQualify.join(' | '));
    assert.ok(cap.toQualify.some((q: string) => /utilisation|installed base/.test(q)));
  });
});
