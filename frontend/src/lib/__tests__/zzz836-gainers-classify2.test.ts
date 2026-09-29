// zzz836 - AI Daily Gainers round 2: inspection is not an approval, a credit rating is not guidance,
// a showroom is not a plant, direction is about economics (not price), garbage amounts are rejected,
// the headline's own date drives the timing line, price commentary is not evidence, old results are context.
// Fixtures are excerpts of the 29 Sep 2026 sample (Unichem, KMEW, RBZJEWEL, MOMSBELIEF, AXISCADES, LANDMARK, AZAD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionOf, directionNote, subtypeOf, researchQuestionFor, isPriceCommentary, isPlausibleAmount, contextTag, DIRECTION_MARK, ACQUISITION_PRICE_LABEL } from '../ai-gainers/structured-facts';
import { classifyIndiaEvents, buildIndiaCard, inFiguresIn, IN_EVENT_CATEGORIES } from '../ai-gainers/in-event-taxonomy';
import { classifyUsEvents, classifyCanonicalEventType } from '../ai-gainers/us-event-taxonomy';
import { buildNewsContext } from '../ai-gainers/news-context';
import { extractIndiaFacts } from '../ai-gainers/india-extract';
import { evidencePoints, countIndependentSources } from '../ai-gainers/events';

const UNICHEM = 'USFDA inspection at Goa formulation facility ended with five procedural observations; response due in 15 days.';
const UNICHEM_PRESS = 'Unichem Laboratories Concludes USFDA Goa Inspection With 5 Procedural Observations - Sahi';
const KMEW = 'CARE upgraded long-term outlook to Positive and reaffirmed A2 for short-term facilities worth Rs 700 crore.';
const RBZ = 'Media interaction today for Surat showroom launch; inauguration scheduled on 24 September 2026.';
const LANDMARK = 'Landmark Cars is BYD s largest retail and service partner in India, and the new facility in Noida further expands its network with the brand';
const AZAD = 'Azad Engineering inaugurated two 7,600 sq. m facilities for GE Vernova on September 28, 2026.';
const AXIS_SUB = 'Incorporation of AKKODIS AXISCADES AEROSPACE ENGINEERING PRIVATE LIMITED as subsidiary in India';
const AXIS_NCD = 'AXISCADES Technologies Allots Rs 200 Crore Non-Convertible Debentures On Private Placement';
const TAX = 'Appeal filed, in the case of cross charge of common services where penalty of Rs. 87,07,09,556/- under Sec 74(1) and';

const ids = (t: string, o = {}) => classifyIndiaEvents(t, { headline: true, ...o }).map((h) => h.id);

// ═══ B. inspection type ═══
test('B. USFDA inspection with observations is "Regulatory inspection / observations", never a regulatory approval (India)', () => {
  const h = classifyIndiaEvents(UNICHEM, { headline: true });
  assert.equal(h[0].id, 'regulatory_inspection');
  assert.equal(h[0].label, 'Regulatory inspection / observations');
  assert.ok(!h.some((x) => x.id === 'regulatory_approval' || x.id === 'regulatory_setback'));
  assert.equal(h[0].economicDirection, 'MIXED');
  assert.match(String(h[0].directionNote), /not a clean result/);
  assert.equal(h[0].subtype, 'inspection');
  assert.deepEqual(ids(UNICHEM_PRESS), ['regulatory_inspection']);
});
test('B. inspection direction: observations MIXED, NAI positive, warning letter / OAI negative, plain inspection unknown', () => {
  assert.equal(directionOf('regulatory_inspection', UNICHEM), 'MIXED');
  assert.equal(directionOf('regulatory_inspection', 'The USFDA inspection closed with no observations (NAI).'), 'POSITIVE');
  assert.equal(directionOf('regulatory_inspection', 'USFDA classified the inspection as Official Action Indicated (OAI).'), 'NEGATIVE');
  assert.equal(directionOf('regulatory_inspection', 'USFDA inspection at the Goa site.'), 'UNKNOWN');
  assert.deepEqual(ids('USFDA issued a warning letter to the Company after the Goa inspection'), ['regulatory_setback']);
  assert.equal(directionOf('regulatory_setback', 'warning letter'), 'NEGATIVE');
});
test('B. a real approval is still an approval', () => {
  assert.ok(ids('Company received USFDA final approval for its ANDA for tablets').includes('regulatory_approval'));
});
test('B. US taxonomy: FDA inspection is its own type, a CRL and a warning letter are different', () => {
  const h = classifyUsEvents('The FDA completed its inspection of the Bothell facility and issued a Form 483 with three observations.')[0];
  assert.equal(h.id, 'fda_inspection'); assert.equal(h.economicDirection, 'MIXED');
  const w = classifyUsEvents('The Company received a warning letter from the FDA regarding its manufacturing facility.')[0];
  assert.equal(w.id, 'fda_warning_letter'); assert.equal(w.economicDirection, 'NEGATIVE');
  assert.equal(classifyUsEvents('The FDA issued a complete response letter for the NDA.')[0].id, 'fda_crl');
  assert.equal(classifyUsEvents('FDA approved the drug for adults.')[0].id, 'fda_approval');
  assert.equal(classifyCanonicalEventType('FDA inspection ended with a Form 483 and three observations').type, 'regulatory_inspection');
  assert.equal(classifyCanonicalEventType('The FDA issued a complete response letter').type, 'regulatory');
});
test('B. extraction kind for the Unichem filing is an inspection, not a qualification', () => {
  const doc = 'To BSE Limited. Sub: Disclosure under Regulation 30 of SEBI (LODR) Regulations, 2015. '.repeat(2) + 'We wish to inform you that the USFDA inspection at the Goa formulation facility ended on 26 September 2026 with five procedural observations. The Company will respond within 15 days.';
  const f = extractIndiaFacts({ text: doc, issuer: 'UNICHEMLAB', date: '2026-09-26', url: 'u', title: 'Unichem' }).facts[0];
  assert.equal(f.event.eventType, 'regulatory_inspection');
  assert.notEqual(f.event.kind, 'qualification');
  assert.match(f.headline, /inspection completed/i);
  assert.equal(f.event.stage, 'COMPLETED');
});
test('B. the Rs 87.07 crore tax demand is NEGATIVE and contingent, never a positive', () => {
  const h = classifyIndiaEvents(TAX, { headline: true })[0];
  assert.equal(h.id, 'tax_demand'); assert.equal(h.economicDirection, 'NEGATIVE');
  assert.match(String(h.directionNote), /contingent/);
  assert.equal(directionOf('tax_demand', TAX), 'NEGATIVE');
});

// ═══ D. economic direction ═══
test('D. direction examples from the QA brief', () => {
  assert.equal(directionOf('subsidiary_incorporation', AXIS_SUB), 'NEUTRAL');
  assert.equal(directionOf('debt_raise', AXIS_NCD), 'NEUTRAL');
  assert.equal(directionOf('order_win', 'Work order for 15 years worth Rs 279.33 crore from Mumbai Port'), 'POSITIVE');
  assert.equal(directionOf('rating_upgrade', KMEW), 'POSITIVE');
  assert.equal(directionOf('kmp_resignation', 'Resignation of the Chief Financial Officer'), 'NEGATIVE');
  assert.equal(directionOf('kmp_resignation', 'Resignation of the Head of Marketing as senior management personnel'), 'UNKNOWN');
  assert.equal(directionOf('equity_raise', 'Preferential issue of warrants'), 'NEUTRAL');
  assert.match(String(directionNote('equity_raise', 'x')), /dilution/);
  assert.equal(directionOf('something_new', 'x'), 'UNKNOWN', 'unknown is UNKNOWN, never negative');
  assert.equal(directionOf('something_new', 'x', 'positive'), 'POSITIVE', 'the taxonomy hint is used only for unknown types');
  assert.deepEqual([DIRECTION_MARK.POSITIVE, DIRECTION_MARK.NEGATIVE, DIRECTION_MARK.MIXED, DIRECTION_MARK.NEUTRAL, DIRECTION_MARK.UNKNOWN], ['▲', '▼', '◆', '◆', '?']);
});
test('D. every India / US hit carries economicDirection', () => {
  for (const t of [UNICHEM, KMEW, RBZ, LANDMARK, AXIS_SUB, AXIS_NCD, TAX]) for (const h of classifyIndiaEvents(t, { headline: true })) assert.ok(['POSITIVE', 'NEGATIVE', 'MIXED', 'NEUTRAL', 'UNKNOWN'].includes(String(h.economicDirection)), `${h.id}`);
  const u = classifyUsEvents('Revenue increased 20% but net loss widened.')[0];
  assert.ok(u && u.economicDirection);
  const c = buildIndiaCard({ filings: [{ subject: 'Intimation of incorporation of subsidiary', summary: null, url: 'u', dateIso: '2026-09-22', docText: AXIS_SUB + '. Board approved the incorporation of the wholly owned subsidiary.' }], press: [], now: new Date('2026-09-29T05:00:00Z'), windowDays: 21 });
  assert.equal(c.catalysts.find((x) => x.id === 'subsidiary_incorporation')?.economicDirection, 'NEUTRAL');
});

// ═══ E1. credit rating ═══
test('E1. a CARE rating outlook upgrade is a Credit rating action (Balance sheet / credit), never guidance or a result', () => {
  const h = classifyIndiaEvents(KMEW, { headline: true });
  assert.deepEqual(h.map((x) => x.id), ['rating_upgrade']);
  assert.equal(h[0].category, 'Balance sheet / credit');
  assert.ok(IN_EVENT_CATEGORIES.includes('Balance sheet / credit'));
  assert.match(String(h[0].note), /not guidance or revenue/);
  assert.equal(h[0].subtype, 'credit_rating');
  assert.ok(!ids(KMEW).includes('guidance'));
  assert.equal(classifyCanonicalEventType(KMEW).type, 'credit_rating', 'outlook must not make it earnings');
  assert.equal(directionOf('credit_rating_action', 'CRISIL reaffirmed AA/Stable'), 'NEUTRAL');
  assert.equal(directionOf('rating_downgrade', 'ICRA downgraded the rating to BBB'), 'NEGATIVE');
  assert.deepEqual(ids('CRISIL reaffirmed its AA rating on the bank facilities'), ['rating_action']);
  // real guidance is still guidance
  assert.ok(ids('Management raised its FY27 revenue guidance to Rs 1,200 crore').includes('guidance'));
});

// ═══ E2. garbage amounts ═══
test('E2. "rs 7" and other table fragments are never presented as amounts', () => {
  assert.equal(isPlausibleAmount('Rs 7'), false);
  assert.equal(isPlausibleAmount('rs 7'), false);
  assert.equal(isPlausibleAmount('Rs 15'), false);
  assert.equal(isPlausibleAmount('Rs 279.33 crore'), true);
  assert.equal(isPlausibleAmount('Rs. 87,07,09,556/-'), true);
  assert.equal(isPlausibleAmount('Rs 1,25,000'), true);
  assert.equal(isPlausibleAmount('$4'), false);
  assert.equal(isPlausibleAmount('$4.2 million'), true);
  assert.deepEqual(inFiguresIn('Work Order for 15 years worth Rs 279.33 crore. Particulars Rs 7 For the Qtr'), ['Rs 279.33 crore']);
  assert.deepEqual(inFiguresIn('Allamounts in INR Millions Consolidated S. No. Particulars 7 For the Qtr Rs 7'), []);
  const h = classifyIndiaEvents('Receipt of Work Order from Mumbai Port for 15 years worth Rs 279.33 crore Rs 7', { headline: true })[0];
  assert.deepEqual(h.figures, ['Rs 279.33 crore']);
});

// ═══ E3. store / dealership / facility for a customer ═══
test('E3. RBZJEWEL showroom launch is a New store / showroom launch, not Capacity expansion / capex', () => {
  const h = classifyIndiaEvents(RBZ, { headline: true });
  assert.deepEqual(h.map((x) => x.id), ['store_launch']);
  assert.equal(h[0].label, 'New store / showroom launch');
  assert.equal(h[0].subtype, 'store_launch');
  assert.ok(!ids(RBZ).some((i) => i.startsWith('capacity')));
  assert.match(researchQuestionFor('store_launch'), /same-store sales/);
  assert.doesNotMatch(researchQuestionFor('store_launch'), /utilisation/);
});
test('E3. LANDMARK new BYD dealership is dealership / network expansion', () => {
  assert.deepEqual(ids(LANDMARK), ['dealership_expansion']);
  assert.deepEqual(ids('Landmark Cars opens new BYD dealership in Noida'), ['dealership_expansion']);
  assert.equal(subtypeOf('dealership_expansion', LANDMARK), 'dealership');
  assert.match(researchQuestionFor('dealership'), /outlet/);
});
test('E3. AZAD facility inaugurated for GE Vernova is a facility for a named customer with its own question', () => {
  const h = classifyIndiaEvents(AZAD, { headline: true })[0];
  assert.equal(h.subtype, 'facility_for_customer');
  assert.match(researchQuestionFor('facility_for_customer'), /customer contract/);
  const qs = new Set(['store_launch', 'dealership', 'facility_for_customer', 'capacity_capex', 'credit_rating', 'inspection'].map((s) => researchQuestionFor(s as any)));
  assert.equal(qs.size, 6, 'six subtypes, six different questions');
});
test('E3. the store-launch stage follows the date: an inauguration date already past is launched, not proposed', () => {
  const past = buildIndiaCard({ filings: [{ subject: 'Media interaction', summary: null, url: 'u', dateIso: '2026-09-22', docText: RBZ + ' The showroom opened to customers on 24 September 2026.' }], press: [], now: new Date('2026-09-29T05:00:00Z'), windowDays: 21 });
  assert.equal(past.catalysts.find((c) => c.id === 'store_launch')?.subtype, 'store_launch');
});

// ═══ E4. wording ═══
test('E4. acquisition unknown label is "Purchase price / swap ratio"', () => {
  assert.equal(ACQUISITION_PRICE_LABEL, 'Purchase price / swap ratio');
});

// ═══ E5. headline timing from the headline event's own date ═══
test('E5. MOMSBELIEF: the headline age comes from the acquisition filed 2026-09-28, not the 09-21 filing; live move date = session date', () => {
  const c = buildIndiaCard({
    filings: [
      { subject: 'Acquisition of City Pro Group', summary: null, url: 'https://x/acq', dateIso: '2026-09-28', docText: 'Rays of Belief Limited has through its subsidiary acquired 100% of City Pro Group Inc., effective September 18, 2026. The acquisition makes City Pro a step-down wholly owned subsidiary of the Company.' },
      { subject: 'Listing intimation', summary: null, url: 'https://x/old', dateIso: '2026-09-21', docText: null },
    ], press: [], now: new Date('2026-09-29T05:30:00Z'), windowDays: 21, causalWindowDays: 3, pressWindowDays: 1,
  });
  assert.ok(c.headline, 'a headline event exists');
  assert.equal(c.headline!.date, '2026-09-28');
  assert.equal(c.headline!.ageDays, 1);
  assert.equal(c.headline!.ageDaysAtMove, 1, 'live session: move date = today (IST) 2026-09-29');
  assert.equal(c.moveDate, '2026-09-29');
  assert.equal(c.headline!.causalWindowStatus, 'inside_window');
  assert.equal(c.lead?.date, c.headline!.date, 'timing is the lead event\'s own date');
});
test('E5. an explicit moveDate overrides (replay): age at move is counted to that day', () => {
  const c = buildIndiaCard({ filings: [{ subject: 'Order', summary: null, url: 'u', dateIso: '2026-09-22', docText: 'We wish to inform you that the Company has received an order worth Rs. 45 crore from ONGC for supply of valves.' }], press: [], now: new Date('2026-09-29T05:30:00Z'), windowDays: 21, moveDate: '2026-09-25', causalWindowDays: 3 });
  assert.equal(c.headline!.ageDaysAtMove, 3);
});

// ═══ E7. price commentary ═══
test('E7. circuit / momentum / broker-target press is price commentary, not evidence', () => {
  assert.equal(isPriceCommentary('RBZ Jewellers Ltd Locks at Upper Circuit With 5% Gain - Buyers Queue, Sellers Absent'), true);
  assert.equal(isPriceCommentary('Goldman Sachs raises target price on Azad Engineering'), true);
  assert.equal(isPriceCommentary('Shares surge after Rs 200 crore order win'), false, 'an event headline is classified by its event');
  const now = new Date('2026-09-29T05:00:00Z');
  const mk = (t: string, d: string) => ({ title: t, url: `https://n/${d}/${t.length}`, published_at: `${d}T08:00:00+05:30`, source: 'x' });
  const ctx = buildNewsContext([
    mk('RBZ Jewellers Ltd Locks at Upper Circuit With 5% Gain - Buyers Queue, Sellers Absent', '2026-09-01'),
    mk('RBZ Jewellers Ltd shares zoom, hit 52-week high', '2026-09-28'),
  ], { ticker: 'RBZJEWEL', company: 'RBZ Jewellers Limited', now });
  assert.ok(ctx.items.length >= 1 && ctx.items.every((i) => i.priceCommentary && i.kind === 'price_commentary'));
  assert.equal(ctx.narrative?.kind, 'price_commentary');
  assert.equal(ctx.narrative?.evidence, false);
  assert.equal(ctx.narrative?.displayLabel, 'PRICE COMMENTARY (not evidence)');
  assert.equal(ctx.evidenceItemCount, 0);
  assert.ok(ctx.themes.every((t) => t.evidence === false || t.theme !== 'circuit_momentum'));
});
test('E7. price commentary is excluded from evidence counts', () => {
  assert.equal(countIndependentSources([{ url: 'https://a.example/1' }, { url: 'https://b.example/2', kind: 'price_commentary' }]), 1);
  assert.equal(evidencePoints([{ url: 'https://b.example/2', tier: 2, kind: 'price_commentary' }]).points, 0);
  assert.equal(evidencePoints([{ url: 'https://b.example/2', tier: 2 }]).points, 7);
});

// ═══ E8. older result block = context ═══
test('E8. KMEW: a result filed 46 days ago is tagged OLDER RESULT (46d) - context', () => {
  assert.deepEqual(contextTag(46, 'result'), { context: true, label: 'OLDER RESULT (46d) - context' });
  assert.deepEqual(contextTag(7, 'result'), { context: false, label: null });
  assert.equal(contextTag(14).context, false);
  assert.equal(contextTag(15).context, true);
  const c = buildIndiaCard({
    filings: [
      { subject: 'Receipt of Work Order from Mumbai Port', summary: null, url: 'u1', dateIso: '2026-09-28', docText: 'We wish to inform you that the Company has received a work order worth Rs 279.33 crore from Mumbai Port Authority for 15 years.' },
      { subject: 'Outcome of Board Meeting - Financial Results', summary: null, url: 'u2', dateIso: '2026-08-14', docText: 'Revenue from operations rose 139.6% year on year to Rs 120 crore. Net profit at Rs 40 crore against Rs 12 crore.' },
    ], press: [], now: new Date('2026-09-29T05:00:00Z'), windowDays: 21, backdropDays: 60 });
  assert.ok(c.backdrop, 'the older result is the backdrop');
  assert.equal(c.backdrop!.context, true);
  assert.match(String(c.backdrop!.contextLabel), /^OLDER RESULT \(4\dd\) - context$/);
  assert.equal(c.lead?.id, 'order_win', 'the fresh order leads, not the old result');
});

// ═══ C-lite: two independent fields + headline role ═══
test('C. source existence and evidence verification are separate fields; official filing that was not read is not verified', () => {
  const c = buildIndiaCard({ filings: [{ subject: 'Award of Order worth Rs 45 crore', summary: null, url: 'u', dateIso: '2026-09-28', docText: null }], press: [{ title: 'Azad Engineering bags Rs 45 crore order - Business Standard', url: 'https://bs/1', date: '2026-09-27' }], now: new Date('2026-09-29T05:00:00Z'), windowDays: 21 });
  const f = c.catalysts.find((x) => x.source === 'FILING');
  assert.equal(f?.sourceExistence, 'official');
  assert.equal(f?.evidenceVerification, 'document_not_read');
  const p = c.catalysts.find((x) => x.source === 'PRESS');
  if (p) { assert.equal(p.evidenceVerification, 'secondary_only'); assert.notEqual(p.evidenceRole, 'headline'); }
  const read = buildIndiaCard({ filings: [{ subject: 'Award of Order', summary: null, url: 'u', dateIso: '2026-09-28', docText: 'We wish to inform you that the Company has received an order worth Rs. 45 crore from ONGC for valves.' }], press: [], now: new Date('2026-09-29T05:00:00Z'), windowDays: 21 });
  const r = read.catalysts.find((x) => x.source === 'FILING');
  assert.equal(r?.evidenceVerification, 'document_read'); assert.equal(r?.evidenceRole, 'headline');
});

// ═══ G. no visible string implies causation ═══
test('F. visible strings in the classifiers never imply causation', () => {
  const rx = /behind the move|\bcaused\b|driven by|catalyst behind/i;
  for (const t of [UNICHEM, KMEW, RBZ, LANDMARK, AZAD, AXIS_SUB, AXIS_NCD, TAX]) for (const h of classifyIndiaEvents(t, { headline: true })) {
    assert.doesNotMatch(`${h.label} ${h.note || ''} ${h.directionNote || ''}`, rx);
  }
  for (const s of ['store_launch', 'dealership', 'facility_for_customer', 'capacity_capex', 'credit_rating', 'inspection', 'tax_demand', 'subsidiary', 'debt_financing', 'equity_raise', 'acquisition', 'order', 'price_commentary'] as const) assert.doesNotMatch(researchQuestionFor(s), rx);
});
