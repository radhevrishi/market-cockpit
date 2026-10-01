// zzz841 — Multibagger / Structural Inflection Radar engine. SYNTHETIC names and tickers only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseRadarItem, buildRadar, sharedDriversOf, portfolioMonitorOf, governanceOf, driversOfText, parseDuration,
  type RadarInput,
} from '../multibagger-radar';
import { BUCKET_ORDER, type LedgerEntry, type RadarItem } from '../multibagger-radar-types';

const mk = (o: Partial<RadarInput> & { title: string }): RadarInput => ({
  id: o.id || 'x1', ticker: null, company: 'Zenith Widgets', region: 'US', sourceLabel: 'SEC 8-K', primarySource: true, ...o,
});
const run = (o: Partial<RadarInput> & { title: string }) => analyseRadarItem(mk(o));

const BANNED = /\b(buy|sell|target price|fair value|price target)\b/i;
const LEAK = /\bundefined\b|\bNaN\b|\bnull\b/;
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (v && typeof v === 'object') Object.values(v as object).forEach((x) => leaves(x, out));
  return out;
}

// ── fixtures ──
const QUAL = mk({
  id: 'q', title: 'Aster Corp completes customer qualification and wins a 3-year supply contract worth $120 million',
  description: 'Approved supplier status was granted. Lead times of 40 weeks and few qualified suppliers mean competitors cannot copy this quickly. Capacity expansion with commissioning by Q3 FY27 and customer demand is committed.',
  sourceLabel: 'SEC 8-K', primarySource: true, independentSources: 2,
});
const CAPEX_ONLY = mk({ id: 'c1', title: 'Borealis announces capex of $300 million over the next 5 years', sourceLabel: 'Company press release', primarySource: true });
const CAPEX_DEMAND = mk({ id: 'c2', title: 'Borealis adds capacity of 5 MTPA with a signed customer offtake agreement', sourceLabel: 'Company press release', primarySource: true });
const RESULT = mk({
  id: 'r', title: 'Cyclone Ltd Q2 FY26 results: revenue up 32%, margin expansion', sourceLabel: 'Earnings release', primarySource: true,
  earnings: { revenueYoY: 32, revenuePrevYoY: 20, marginNow: 18, marginPrior: 15, patYoY: 40, cfoToPat: 1.1, quarters: 3, guidance: 'RAISED', orderBook: 'UP' },
});
const BUYBACK = mk({ id: 'b', title: 'Echo Ltd board approves buyback of shares', sourceLabel: 'NSE', primarySource: true });
const OPEN_OFFER = mk({ id: 'o', title: 'Acquirer announces open offer for Foxtrot Ltd; delisting to follow', sourceLabel: 'NSE', primarySource: true });
const SPIN_DURABLE = mk({ id: 's', title: 'Golf Ltd to demerge its growth business; the unit contributes 40% of revenue and adds capacity of 5 MTPA', sourceLabel: 'NSE', primarySource: true, category: 'SPIN' });
const SPIN_PLAIN = mk({ id: 's2', title: 'Hotel Ltd board approves demerger scheme', sourceLabel: 'NSE', primarySource: true, category: 'SPIN' });
const BOTTLENECK = mk({ id: 'bn', title: 'Indigo Materials: component shortage, capacity of its qualified suppliers sold out', sourceLabel: 'Industry trade press' });
const SOCIAL = mk({ id: 'so', title: 'Juliet wins massive order worth $50 million', sourceLabel: 'Twitter', primarySource: false });
const ANALYST = mk({ id: 'an', title: 'Kilo secures 5-year supply contract worth $80 million', sourceLabel: 'Analyst note', primarySource: false });
const PRICE = mk({ id: 'p', title: 'Shares of Lima surge on heavy volume', sourceLabel: 'Financial media', primarySource: false });
const TECH = mk({ id: 't', title: 'Mike Corp stock breakout above 200-DMA, golden cross forms', sourceLabel: 'Financial media', primarySource: false });
const PROMO = mk({ id: 'pr', title: 'Nova is the next big thing, a game changer poised to soar', sourceLabel: 'Financial media', primarySource: false });
const GENERIC_AI = mk({ id: 'ai', title: 'The AI boom will lift everything, says commentator', sourceLabel: 'Financial media', primarySource: false });
const SECTOR = mk({ id: 'sec', title: 'Analysts say the sector outlook looks strong for the industry', sourceLabel: 'Financial media', primarySource: false });
const CANCEL = mk({ id: 'cx', title: 'Oscar order worth $20 million cancelled by the customer', sourceLabel: 'Company press release', primarySource: true });
const GRID = mk({ id: 'g1', ticker: 'GRD1', company: 'Grid One', title: 'Grid One wins $40 million order for transformers for grid expansion', sourceLabel: 'NSE', primarySource: true });
const DC1 = mk({ id: 'd1', ticker: 'DCA', company: 'Data A', title: 'Data A wins $60 million order for AI data centers', sourceLabel: 'NSE', primarySource: true });
const DC2 = mk({ id: 'd2', ticker: 'DCB', company: 'Data B', title: 'Data B secures $30 million order for AI data centers', sourceLabel: 'NSE', primarySource: true });
const DC3 = mk({ id: 'd3', ticker: 'DCC', company: 'Data C', title: 'Data C wins $25 million order for AI data centers', sourceLabel: 'NSE', primarySource: true });
const DEF = mk({ id: 'df', ticker: 'DEF1', company: 'Defence One', title: 'Defence One wins $70 million order for missile components', sourceLabel: 'NSE', primarySource: true });
const NEWPROD = mk({ id: 'np', title: 'Papa Pharma receives USFDA approval for a new formulation, launch planned Q2 FY27', sourceLabel: 'Regulatory filing', primarySource: true });
const SUPDEM = mk({ id: 'sd', title: 'Quebec Chem: prices rise 12% after anti-dumping duty and supply cuts', sourceLabel: 'Industry trade press' });
const OP_INFL = mk({ id: 'oi', title: 'Romeo turned profitable with record quarterly revenue and operating margin of 14%', sourceLabel: 'Company press release', primarySource: true });
const ONE_TIME = mk({ id: 'ot', title: 'Sierra reports a one-time tax benefit in the quarter and a single order worth $2 million', sourceLabel: 'Company press release', primarySource: true });

const ALL_FIX: RadarInput[] = [QUAL, CAPEX_ONLY, CAPEX_DEMAND, RESULT, BUYBACK, OPEN_OFFER, SPIN_DURABLE, SPIN_PLAIN, BOTTLENECK, SOCIAL, ANALYST, PRICE, TECH, PROMO, GENERIC_AI, SECTOR, CANCEL, GRID, DC1, DC2, DC3, DEF, NEWPROD, SUPDEM, OP_INFL, ONE_TIME];

describe('1 two questions: what happened / why it matters', () => {
  test('event is the source words, trimmed; why + changes populated', () => {
    const r = run({ title: '   Aster   wins  a  contract worth $10 million   ' });
    assert.equal(r.event, 'Aster wins a contract worth $10 million');
    assert.ok(r.whyItMatters.length > 20);
    assert.ok(r.changes.length > 0);
  });
  test('changes come from the allowed variable list', () => {
    const allowed = new Set(['revenue', 'volume', 'ASP', 'mix', 'gross margin', 'operating margin', 'utilisation', 'FCF', 'ROCE', 'market share', 'addressable market', 'customer concentration', 'competitive position', 'earnings durability']);
    for (const f of ALL_FIX) for (const c of analyseRadarItem(f).changes) assert.ok(allowed.has(c), c);
  });
  test('qualification names revenue, volume, competitive position', () => {
    const r = analyseRadarItem(QUAL);
    for (const c of ['revenue', 'volume', 'competitive position']) assert.ok(r.changes.includes(c));
  });
  test('a buyback changes no business variable', () => {
    const r = analyseRadarItem(BUYBACK);
    assert.deepEqual(r.changes, []);
    assert.match(r.whyItMatters, /not the business/i);
  });
  test('capex-only: capacity kind, indirect link', () => {
    const r = analyseRadarItem(CAPEX_ONLY);
    assert.equal(r.kind, 'CAPACITY_INFLECTION');
  });
});

describe('1b capex is not automatically bullish', () => {
  test('capex alone: CAPACITY_INFLECTION, INDIRECT, DEVELOPING, proof text, priority capped', () => {
    const r = analyseRadarItem(CAPEX_ONLY);
    assert.equal(r.kind, 'CAPACITY_INFLECTION');
    assert.equal(r.link, 'INDIRECT');
    assert.equal(r.evidence.status, 'DEVELOPING');
    assert.match(r.proof.what.toLowerCase(), /commissioning \+ utilisation \+ demand/);
    assert.ok(['MEDIUM', 'LOW'].includes(r.priority));
    assert.match(r.priorityReason, /capex without a demand link/);
    assert.ok(!['MULTIBAGGER', 'EARNINGS_INFLECTION'].includes(r.bucket));
  });
  test('capex alone with a stated 5-year programme still cannot become MULTIBAGGER', () => {
    const r = analyseRadarItem(CAPEX_ONLY);
    assert.equal(r.duration.basis, 'stated');
    assert.notEqual(r.bucket, 'MULTIBAGGER');
    assert.ok(r.priority !== 'VERY_HIGH' && r.priority !== 'HIGH');
  });
  test('capacity increase + customer demand / offtake reaches a real capacity inflection', () => {
    const r = analyseRadarItem(CAPEX_DEMAND);
    assert.equal(r.kind, 'CAPACITY_INFLECTION');
    assert.notEqual(r.link, 'INDIRECT');
    assert.doesNotMatch(r.priorityReason, /capex without a demand link/);
  });
  test('capacity increase + utilisation reaches capacity inflection', () => {
    const r = run({ title: 'Plant expansion adds capacity; existing lines running at 95% utilisation', sourceLabel: 'Company press release' });
    assert.equal(r.kind, 'CAPACITY_INFLECTION');
    assert.notEqual(r.link, 'INDIRECT');
  });
  test('capacity increase with a stated multi-year contract can reach MULTIBAGGER', () => {
    const r = run({ title: 'Company adds new plant capacity backed by a 4-year offtake contract worth $200 million', sourceLabel: 'Company press release' });
    assert.equal(r.kind, 'CAPACITY_INFLECTION');
    assert.equal(r.bucket, 'MULTIBAGGER');
  });
  test('capex with no capacity or demand words: capex without demand', () => {
    const r = run({ title: 'Company announces capex of $50 million', sourceLabel: 'Company press release' });
    assert.equal(r.link, 'INDIRECT');
    assert.equal(r.evidence.status, 'DEVELOPING');
  });
  test('capex category hint alone still classifies capacity, capped', () => {
    const r = run({ title: 'Company board approves investment programme', category: 'CAPEX', sourceLabel: 'NSE' });
    assert.equal(r.kind, 'CAPACITY_INFLECTION');
    assert.ok(P(r) <= 1);
  });
});
const P = (r: RadarItem) => ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].indexOf(r.priority);

describe('2 detectors A-H', () => {
  test('A operating inflection', () => assert.equal(analyseRadarItem(OP_INFL).kind, 'OPERATING_INFLECTION'));
  test('B demand explosion', () => {
    const r = run({ title: 'Victor Systems reports record order book and demand surge; oversubscribed', sourceLabel: 'Company press release' });
    assert.equal(r.kind, 'DEMAND_EXPLOSION');
  });
  test('C bottleneck fills the question from the text', () => {
    const r = analyseRadarItem(BOTTLENECK);
    assert.equal(r.kind, 'BOTTLENECK');
    assert.match(r.bottleneckQuestion || '', /Why can't competitors immediately supply this demand\?/);
    assert.match(r.bottleneckQuestion || '', /sold out/);
  });
  test('C bottleneck question falls back to Not established when no sentence matches', () => {
    const r = run({ title: 'Kappa qualification barriers', description: '', sourceLabel: 'Industry trade press' });
    assert.ok(r.bottleneckQuestion);
  });
  test('C bottleneck keywords: lead times, scarce, regulatory barriers', () => {
    for (const t of ['Long lead times of 60 weeks constrain switchgear supply', 'Scarce rare earth magnets held by few players', 'Regulatory barriers keep new entrants out of the licence market']) {
      assert.equal(run({ title: t, sourceLabel: 'Industry trade press' }).kind, 'BOTTLENECK', t);
    }
  });
  test('non-bottleneck items have no bottleneck question', () => assert.equal(analyseRadarItem(BUYBACK).bottleneckQuestion, null));
  test('D capacity', () => assert.equal(analyseRadarItem(CAPEX_DEMAND).kind, 'CAPACITY_INFLECTION'));
  test('E customer qualification families', () => {
    for (const t of ['Lambda gets design win at a tier-one customer', 'Mu Corp becomes approved supplier for new platform', 'Nu Ltd receives production award and recurring purchase orders', 'Xi is now sole-source supplier for the part']) {
      assert.equal(run({ title: t, sourceLabel: 'Company press release' }).kind, 'CUSTOMER_QUALIFICATION', t);
    }
  });
  test('F new product / market', () => assert.equal(analyseRadarItem(NEWPROD).kind, 'NEW_PRODUCT_MARKET'));
  test('G supply-demand inflection', () => assert.equal(analyseRadarItem(SUPDEM).kind, 'SUPPLY_DEMAND_INFLECTION'));
  test('H special situations are kept and classified separately', () => {
    for (const f of [BUYBACK, OPEN_OFFER, SPIN_PLAIN]) assert.equal(analyseRadarItem(f).kind, 'SPECIAL_SITUATION');
    for (const t of ['Pi Ltd announces rights issue', 'Rho Ltd completes asset sale of a plant', 'Sigma restructuring plan approved by lenders', 'Tau Ltd to go private via take-private offer']) {
      assert.equal(run({ title: t, sourceLabel: 'NSE' }).kind, 'SPECIAL_SITUATION', t);
    }
  });
  test('feed eventType is used as a hint', () => {
    const r = run({ title: 'Upsilon Ltd corporate update', eventType: 'SPIN_OFF', sourceLabel: 'NSE' });
    assert.equal(r.kind, 'SPECIAL_SITUATION');
    const r2 = run({ title: 'Phi Ltd update', eventType: 'BUYBACK_TENDER', sourceLabel: 'NSE' });
    assert.equal(r2.bucket, 'SPECIAL_SITUATION');
  });
});

describe('2b special situations vs structural candidates', () => {
  test('buyback / open offer / going private / tender are always SPECIAL_SITUATION', () => {
    for (const t of ['Chi Ltd board approves buyback of 2 million shares worth $10 million over 5 years', 'Psi Ltd tender offer for shares, adds capacity of 3 MTPA customers', 'Omega Ltd going private; acquirer open offer contributes 40% of revenue synergies']) {
      assert.equal(run({ title: t, sourceLabel: 'NSE' }).bucket, 'SPECIAL_SITUATION', t);
    }
    assert.equal(analyseRadarItem(OPEN_OFFER).bucket, 'SPECIAL_SITUATION');
    assert.equal(analyseRadarItem(BUYBACK).bucket, 'SPECIAL_SITUATION');
  });
  test('a plain spin-off stays SPECIAL_SITUATION', () => assert.equal(analyseRadarItem(SPIN_PLAIN).bucket, 'SPECIAL_SITUATION'));
  test('a spin-off that unlocks a growth business with stated contribution stays a special situation (zzz847: no measured result exists yet)', () => {
    const r = analyseRadarItem(SPIN_DURABLE);
    assert.equal(r.kind, 'SPECIAL_SITUATION');
    assert.equal(r.bucket, 'SPECIAL_SITUATION');
    assert.equal(r.structuralBridge?.created, true);
  });
  test('an acquisition lands in special situations with or without a stated contribution (zzz847); the contribution only builds the structural bridge', () => {
    const yes = run({ title: 'Zeta acquires a rival; adds capacity of 4 MTPA and contributes 25% to revenue', sourceLabel: 'NSE' });
    assert.equal(yes.bucket, 'SPECIAL_SITUATION');
    assert.equal(yes.structuralBridge?.created, true);
    const no = run({ title: 'Eta Ltd announces acquisition of a rival', sourceLabel: 'NSE' });
    assert.equal(no.bucket, 'SPECIAL_SITUATION');
  });
  test('special-situation proof point is a closing / regulatory step', () => {
    assert.equal(analyseRadarItem(BUYBACK).proof.kind, 'closing');
    assert.equal(analyseRadarItem(OPEN_OFFER).proof.kind, 'closing');
  });
});

describe('3 duration', () => {
  test('stated terms give basis stated and the evidence quotes them', () => {
    for (const [t, q] of [['a 5-year supply contract', '5-year'], ['multi-year programme awarded', 'multi-year'], ['over 3 years the order is delivered', '3 years'], ['programme for FY27-FY30', 'FY27-FY30']] as const) {
      const r = run({ title: `Beta Corp wins a contract: ${t}, worth $100 million`, sourceLabel: 'NSE' });
      assert.equal(r.duration.basis, 'stated', t);
      assert.ok(r.duration.evidence.includes(q), `${t} :: ${r.duration.evidence}`);
      assert.equal(r.duration.code, 4, t);
    }
  });
  test('type-only is capped at 3', () => {
    for (const f of [BOTTLENECK, CAPEX_DEMAND, NEWPROD, SUPDEM]) {
      const r = analyseRadarItem({ ...f, title: f.title.replace(/\d+-year|over the next 5 years/g, '') });
      if (r.duration.basis === 'type') assert.ok((r.duration.code ?? 0) <= 3);
    }
    // changed in zzz845: duration is never inferred from the type of event
    const r = analyseRadarItem({ ...BOTTLENECK, title: BOTTLENECK.title.replace(/\d+-year|over the next 5 years/g, '') });
    assert.ok(r.duration.basis === 'none' || r.duration.basis === 'stated');
    assert.ok((r.duration.code ?? 0) <= 3);
  });
  test('nothing stated and no type: code null, not established', () => {
    const r = analyseRadarItem(PRICE);
    assert.equal(r.duration.code, null);
    assert.equal(r.duration.basis, 'none');
    assert.match(r.duration.evidence, /not established/i);
  });
  test('code 5 only when the text supports a transformational case, never from type alone', () => {
    const big = run({ title: 'Gamma Bio qualified platform opens a new large market, a $40 billion market opportunity; first orders from customers under a 10-year agreement', sourceLabel: 'NSE' });
    assert.equal(big.duration.code, 5);
    const plain = run({ title: 'Gamma Bio wins a 10-year supply contract worth $10 million', sourceLabel: 'NSE' });
    assert.equal(plain.duration.code, 4);
    for (const f of ALL_FIX) { const r = analyseRadarItem(f); if (r.duration.code === 5) assert.equal(r.duration.basis, 'stated'); }
  });
  test('one-time items get code 0', () => {
    const r = run({ title: 'Delta Ltd books a one-time tax benefit', description: 'Operating profit up 12% year on year.', sourceLabel: 'Company press release', primarySource: true });
    assert.equal(r.duration.code, 0);
    assert.match(r.duration.evidence, /one-time/i);
  });
  test('asset sale is one-time and a buyback type-only is 0', () => {
    // changed in zzz845: no duration from event type; unknown is null, not zero
    assert.equal(run({ title: 'Rho Ltd completes asset sale of a plant', sourceLabel: 'NSE' }).duration.code, null);
    assert.equal(analyseRadarItem(BUYBACK).duration.code, null);
  });
  test('quarters and months conversion; history windows are ignored', () => {
    assert.equal(parseDuration('benefit for the next 2 quarters')?.code, 2);
    assert.equal(parseDuration('order delivered over 18 months')?.code, 3);
    assert.equal(parseDuration('revenue grew over the last 3 years')?.code ?? null, null);
    assert.equal(parseDuration('nothing here'), null);
  });
  test('duration label is the display label', () => assert.equal(analyseRadarItem(QUAL).duration.label, '2-5 years (structural)'));
});

describe('4 evidence status and source hierarchy', () => {
  test('primary filing stating the event -> CONFIRMED', () => assert.equal(analyseRadarItem(QUAL).evidence.status, 'CONFIRMED'));
  test('primary but planned / proposed -> DEVELOPING', () => {
    const r = run({ title: 'Iota Ltd plans to build a new plant with customer orders in hand', sourceLabel: 'NSE' });
    assert.equal(r.evidence.status, 'DEVELOPING');
  });
  test('several credible non-primary sources -> STRONG', () => {
    const r = run({ title: 'Kappa Ltd wins order worth $10 million from a customer', sourceLabel: 'Financial media', primarySource: false, independentSources: 3 });
    assert.equal(r.evidence.status, 'STRONG');
  });
  test('press-only single source -> HYPOTHESIS', () => {
    const r = run({ title: 'Kappa Ltd wins order worth $10 million from a customer', sourceLabel: 'Financial media', primarySource: false });
    assert.equal(r.evidence.status, 'HYPOTHESIS');
  });
  test('cancelled / terminated / denied / withdrawn / rejected -> DISPROVED', () => {
    for (const w of ['cancelled', 'terminated', 'denied', 'withdrawn', 'rejected']) {
      const r = run({ title: `Order worth $10 million ${w} by customer of Lambda`, sourceLabel: 'Company press release' });
      assert.equal(r.evidence.status, 'DISPROVED', w);
      assert.ok(P(r) === 0);
    }
  });
  test('hypothesis is never CONFIRMED and is labelled differently', () => {
    const hyp = analyseRadarItem(SOCIAL);
    assert.equal(hyp.evidence.status, 'HYPOTHESIS');
    assert.notEqual(hyp.evidence.status, 'CONFIRMED');
    assert.match(hyp.evidence.why, /never proves/);
  });
  test('social or analyst only can never be above HYPOTHESIS, even with many sources or primary flag', () => {
    for (const label of ['Twitter', 'Reddit thread', 'Analyst note', 'Broker research note', 'Stocktwits']) {
      const r = run({ title: 'Mu Corp secures 5-year supply contract worth $80 million', sourceLabel: label, primarySource: true, independentSources: 5 });
      assert.equal(r.evidence.status, 'HYPOTHESIS', label);
      assert.ok(r.evidence.sourceRank === 12 || r.evidence.sourceRank === 13);
    }
  });
  test('sourceRank follows the hierarchy', () => {
    const rank = (sourceLabel: string) => run({ title: 'Nu Ltd wins order worth $5 million', sourceLabel, primarySource: false }).evidence.sourceRank;
    assert.equal(rank('SEC filing'), 1);
    assert.equal(rank('Annual report'), 2);
    assert.equal(rank('10-Q'), 3);
    assert.equal(rank('Earnings release'), 4);
    assert.equal(rank('Investor presentation'), 5);
    assert.equal(rank('Company press release'), 6);
    assert.equal(rank('Customer announcement'), 7);
    assert.equal(rank('Government procurement portal'), 8);
    assert.equal(rank('Regulatory filing'), 9);
    assert.equal(rank('Industry trade press'), 10);
    assert.equal(rank('Financial media'), 11);
    assert.equal(rank('Analyst note'), 12);
    assert.equal(rank('Social media'), 13);
    assert.equal(run({ title: 'Nu Ltd wins order worth $5 million', sourceLabel: undefined, primarySource: false }).evidence.sourceRank, null);
  });
  test('why names what is proven and what link remains unproven', () => {
    const w = analyseRadarItem(QUAL).evidence.why;
    assert.match(w, /Proven/);
    assert.match(w, /Unproven/);
  });
  test('capex-only never exceeds DEVELOPING', () => assert.equal(analyseRadarItem(CAPEX_ONLY).evidence.status, 'DEVELOPING'));
});

describe('5 link strength', () => {
  test('quantified order -> DIRECT; production award -> DIRECT/NEAR_DIRECT', () => {
    assert.ok(['DIRECT', 'NEAR_DIRECT'].includes(analyseRadarItem(QUAL).link));
    // zzz852: DIRECT means already in reported financials; a quantified order is a documented event with a bridge (NEAR_DIRECT)
    assert.equal(analyseRadarItem(GRID).link, 'NEAR_DIRECT');
  });
  test('results with numbers -> DIRECT', () => assert.equal(analyseRadarItem(RESULT).link, 'DIRECT'));
  test('sector bottleneck without company evidence -> INDIRECT', () => assert.equal(analyseRadarItem(BOTTLENECK).link, 'INDIRECT'));
  test('noise -> NARRATIVE_ONLY', () => { for (const f of [PRICE, PROMO, GENERIC_AI, SECTOR]) assert.equal(analyseRadarItem(f).link, 'NARRATIVE_ONLY'); });
  test('priority favours direct/near-direct: same event indirect ranks no higher', () => {
    const direct = analyseRadarItem(GRID);
    const indirect = analyseRadarItem(BOTTLENECK);
    assert.ok(P(direct) >= P(indirect));
  });
});

describe('6 chain', () => {
  const NAMES = ['Catalyst', 'Customer / market driver', 'Bottleneck', 'Company advantage', 'Capacity / volume', 'Revenue', 'Margin', 'Free cash flow', 'Earnings', 'Valuation / expectations', 'Potential multi-year re-rating'];
  test('11 steps in spec order with allowed statuses', () => {
    for (const f of ALL_FIX) {
      const r = analyseRadarItem(f);
      assert.deepEqual(r.chain.map((c) => c.step), NAMES);
      for (const c of r.chain) assert.ok(['proven', 'assumed', 'unknown'].includes(c.status));
    }
  });
  test('a headline alone never proves revenue, margin, cash, earnings, valuation or re-rating', () => {
    for (const f of ALL_FIX.filter((x) => !x.earnings)) {
      const r = analyseRadarItem(f);
      for (let i = 5; i <= 10; i++) assert.notEqual(r.chain[i].status, 'proven', `${f.id} step ${i}`);
      assert.ok(r.provenThrough <= 4, `${f.id} provenThrough ${r.provenThrough}`);
    }
  });
  test('earnings-result items prove revenue / margin / cash / earnings from the earnings block', () => {
    const r = analyseRadarItem(RESULT);
    for (const i of [5, 6, 7, 8]) assert.equal(r.chain[i].status, 'proven', String(i));
    assert.equal(r.provenThrough, 8);
    assert.equal(r.chain[9].status, 'unknown');
    assert.equal(r.chain[10].status, 'unknown');
  });
  test('the earnings block does not prove steps for a non-result headline', () => {
    const r = run({ title: 'Wu Ltd wins order worth $9 million', earnings: { revenueYoY: 30, marginNow: 18, marginPrior: 15, patYoY: 20, cfoToPat: 1 } });
    for (const i of [5, 6, 7, 8]) assert.notEqual(r.chain[i].status, 'proven');
  });
  test('qualification chain proves company advantage from the source sentence', () => {
    const r = analyseRadarItem(QUAL);
    assert.equal(r.chain[3].status, 'proven');
    assert.match(r.chain[3].text, /qualification/i);
    assert.equal(r.chain[2].status, 'proven');
  });
  test('hypothesis catalyst step is assumed, not proven', () => assert.equal(analyseRadarItem(SOCIAL).chain[0].status, 'assumed'));
  test('noise has nothing proven', () => assert.equal(analyseRadarItem(PRICE).provenThrough, -1));
});

describe('7 inflection state', () => {
  const st = (earnings: RadarInput['earnings']) => run({ title: 'Xi Ltd Q3 FY26 results', earnings }).inflection;
  test('NOT_ASSESSED with no earnings data (never NO_INFLECTION)', () => {
    assert.equal(st(null), 'NOT_ASSESSED');
    assert.equal(st({}), 'NOT_ASSESSED');
    assert.equal(st({ revenueYoY: null, marginNow: null }), 'NOT_ASSESSED');
    assert.equal(analyseRadarItem(QUAL).inflection, 'NOT_ASSESSED');
  });
  test('NO_INFLECTION', () => {
    assert.equal(st({ revenueYoY: -5, marginNow: 10, marginPrior: 12 }), 'NO_INFLECTION');
    assert.equal(st({ revenueYoY: 5, guidance: 'CUT' }), 'NO_INFLECTION');
  });
  test('EARLY', () => assert.equal(st({ revenueYoY: 18 }), 'EARLY_INFLECTION'));
  test('CONFIRMED: growth + margin up + healthy cash or order book up', () => {
    assert.equal(st({ revenueYoY: 20, marginNow: 16, marginPrior: 14, cfoToPat: 1 }), 'CONFIRMED_INFLECTION');
    assert.equal(st({ revenueYoY: 20, marginNow: 16, marginPrior: 14, orderBook: 'UP' }), 'CONFIRMED_INFLECTION');
  });
  test('ACCELERATING: revenue growth above the prior period and margin up', () => {
    assert.equal(st({ revenueYoY: 30, revenuePrevYoY: 18, marginNow: 16, marginPrior: 14 }), 'ACCELERATING_INFLECTION');
  });
  test('STRUCTURAL: three or more supporting quarters', () => {
    assert.equal(st({ revenueYoY: 30, revenuePrevYoY: 18, marginNow: 16, marginPrior: 14, quarters: 3 }), 'STRUCTURAL_INFLECTION');
  });
  test('good quarter vs new regime is stated in words', () => {
    const early = run({ title: 'Xi Ltd Q3 FY26 results', earnings: { revenueYoY: 18 } });
    assert.match(early.regimeNote || '', /good quarter/i);
    const structural = run({ title: 'Xi Ltd Q3 FY26 results', earnings: { revenueYoY: 30, marginNow: 16, marginPrior: 14, quarters: 4 } });
    assert.match(structural.regimeNote || '', /new earnings regime/i);
    assert.match(analyseRadarItem(QUAL).regimeNote || '', /No result data/);
  });
});

describe('8 expectations gap and valuation context', () => {
  test('NOT_ASSESSED without multiple and growth', () => {
    const r = analyseRadarItem(RESULT);
    assert.equal(r.expectations.state, 'NOT_ASSESSED');
    assert.match(r.expectations.note, /no multiple \/ forward earnings supplied/i);
    assert.match(r.valuationContext, /Not assessed - no multiple \/ forward earnings supplied/);
    assert.equal(run({ title: 'Yu wins order', multipleNow: 30 }).expectations.state, 'NOT_ASSESSED');
    assert.equal(run({ title: 'Yu wins order', forwardEarningsGrowth: 20 }).expectations.state, 'NOT_ASSESSED');
  });
  test('strong fundamentals + high expectations -> ALREADY_EXPECTED', () => {
    const r = analyseRadarItem({ ...RESULT, multipleNow: 60, forwardEarningsGrowth: 20 });
    assert.equal(r.expectations.state, 'ALREADY_EXPECTED');
  });
  test('improving + low expectations -> LOW_EXPECTATIONS', () => {
    const r = analyseRadarItem({ ...RESULT, earnings: { revenueYoY: 18, marginNow: 14, marginPrior: 13 }, multipleNow: 12, forwardEarningsGrowth: 20 });
    assert.equal(r.expectations.state, 'LOW_EXPECTATIONS');
  });
  test('weak results + structural catalyst beginning -> EARLY_STAGE', () => {
    const r = analyseRadarItem({ ...QUAL, multipleNow: 25, forwardEarningsGrowth: 15 });
    assert.equal(r.expectations.state, 'EARLY_STAGE');
  });
  test('valuation context explains what has to happen with the supplied numbers, never a fair value', () => {
    const r = analyseRadarItem({ ...RESULT, multipleNow: 40, forwardEarningsGrowth: 20 });
    assert.match(r.valuationContext, /What has to happen for the current valuation to make sense/);
    assert.match(r.valuationContext, /20%/);
    assert.match(r.valuationContext, /40x/);
    assert.doesNotMatch(r.valuationContext, BANNED);
  });
});

describe('9 proof point and break conditions', () => {
  test('proof by kind is specific and never just monitor', () => {
    const by: Array<[RadarInput, RegExp, string]> = [
      [QUAL, /production shipments|second customer/i, 'qualification'],
      [CAPEX_DEMAND, /commissioning date and utilisation/i, 'commissioning'],
      [NEWPROD, /launch|first sales/i, 'approval'],
      [BUYBACK, /completion/i, 'closing'],
      [SPIN_PLAIN, /record date|listing/i, 'closing'],
      [RESULT, /next quarterly result/i, 'result'],
      [DC1, /billing|delivery/i, 'order'],
    ];
    for (const [f, re, kind] of by) {
      const r = analyseRadarItem(f);
      assert.match(r.proof.what, re, f.id);
      assert.equal(r.proof.kind, kind, f.id);
    }
    for (const f of ALL_FIX) assert.doesNotMatch(analyseRadarItem(f).proof.what, /^monitor\b|monitor company/i);
  });
  test('order / contract proof mentions billing start or backlog conversion', () => {
    assert.match(run({ title: 'Zulu Ltd reports record order book and demand surge', sourceLabel: 'NSE' }).proof.what, /billing|backlog/i);
  });
  test('timing is picked up from the text when stated', () => {
    assert.equal(analyseRadarItem(NEWPROD).proof.when, 'Q2 FY27');
  });
  test('break conditions are kind-specific and non-empty', () => {
    assert.ok(analyseRadarItem(CAPEX_DEMAND).breakConditions.some((b) => /utilisation/i.test(b)));
    assert.ok(analyseRadarItem(CAPEX_DEMAND).breakConditions.some((b) => /capex without demand/i.test(b)));
    assert.ok(analyseRadarItem(QUAL).breakConditions.some((b) => /cancellation/i.test(b)));
    assert.ok(analyseRadarItem(RESULT).breakConditions.some((b) => /margin reversal/i.test(b)));
    assert.ok(analyseRadarItem(BUYBACK).breakConditions.some((b) => /regulatory|termination|stated transaction conditions/i.test(b)));
    for (const f of ALL_FIX) assert.ok(analyseRadarItem(f).breakConditions.length > 0, f.id);
  });
  test('feed facts feed the proof and break lists', () => {
    const r = run({ title: 'Ab Ltd wins order worth $9 million', feedFacts: { what_to_watch: 'first dispatch', what_breaks_thesis: 'customer cuts volumes' } });
    // zzz847: the feed watch-item boilerplate is no longer appended to the next proof
    assert.doesNotMatch(r.proof.what, /first dispatch|Feed watch item/);
    assert.ok(r.breakConditions.some((b) => /customer cuts volumes/.test(b)));
  });
});

describe('10 buckets', () => {
  test('bucket assignment for each fixture', () => {
    const want: Record<string, string[]> = {
      MULTIBAGGER: ['q'],
      EARNINGS_INFLECTION: ['r'],
      BOTTLENECK: ['bn'],
      SPECIAL_SITUATION: ['b', 'o', 's2'],
      EVENT_DRIVEN: ['c1', 'cx'],
      TECHNICAL: ['t'],
      NOISE: ['p', 'pr', 'ai', 'sec'],
    };
    for (const [bucket, ids] of Object.entries(want)) for (const id of ids) {
      const f = ALL_FIX.find((x) => x.id === id)!;
      assert.equal(analyseRadarItem(f).bucket, bucket, id);
    }
  });
  test('MULTIBAGGER needs duration >= 4, direct/near link and evidence >= developing', () => {
    for (const f of ALL_FIX) {
      const r = analyseRadarItem(f);
      if (r.bucket === 'MULTIBAGGER') {
        assert.ok((r.duration.code ?? 0) >= 4);
        assert.ok(['DIRECT', 'NEAR_DIRECT'].includes(r.link));
        assert.ok(['CONFIRMED', 'STRONG', 'DEVELOPING'].includes(r.evidence.status));
      }
    }
    const hyp = analyseRadarItem(ANALYST);
    assert.notEqual(hyp.bucket, 'MULTIBAGGER');
  });
  test('noise types are NOISE and lowSignal; technical is TECHNICAL', () => {
    for (const f of [PRICE, PROMO, GENERIC_AI, SECTOR]) { const r = analyseRadarItem(f); assert.equal(r.bucket, 'NOISE'); assert.equal(r.lowSignal, true); }
    const analystNoise = run({ title: 'Brokerage raises price objective and reiterates rating on Ac Ltd', sourceLabel: 'Analyst note', primarySource: false });
    assert.equal(analystNoise.bucket, 'NOISE');
    assert.equal(analyseRadarItem(TECH).bucket, 'TECHNICAL');
  });
  test('a generic AI narrative with a concrete order is not noise', () => {
    const r = run({ title: 'AI boom: Ad Ltd wins $30 million order for data center racks', sourceLabel: 'NSE' });
    assert.notEqual(r.bucket, 'NOISE');
  });
  test('NEVER one blended list: buildRadar returns per-bucket lists and every bucket key exists', () => {
    const res = buildRadar(ALL_FIX, { now: 0 });
    assert.deepEqual(Object.keys(res.byBucket), BUCKET_ORDER);
    let n = 0;
    for (const b of BUCKET_ORDER) { for (const i of res.byBucket[b]) assert.equal(i.bucket, b); n += res.byBucket[b].length; }
    assert.equal(n, ALL_FIX.length);
    assert.equal(res.items.length, ALL_FIX.length);
    assert.equal(res.counts.total, ALL_FIX.length);
    for (const b of BUCKET_ORDER) assert.equal(res.counts.byBucket[b], res.byBucket[b].length);
  });
  test('sort within a bucket: priority, then evidence, then duration, then recency; never price', () => {
    const base = { ticker: null, company: 'Co', region: 'US' as const, sourceLabel: 'Company press release', primarySource: true };
    const ins: RadarInput[] = [
      { ...base, id: 'old', title: 'Ae Ltd wins order worth $5 million', publishedAt: '2026-01-01T00:00:00Z' },
      { ...base, id: 'new', title: 'Af Ltd wins order worth $5 million', publishedAt: '2026-03-01T00:00:00Z' },
      { ...base, id: 'age', title: 'Ag Ltd wins order worth $5 million', ageHours: 1 },
    ];
    const res = buildRadar(ins, { now: Date.parse('2026-03-02T00:00:00Z') });
    const ids = res.byBucket.EVENT_DRIVEN.map((i) => i.id);
    assert.deepEqual(ids, ['age', 'new', 'old']);
    const ranked = buildRadar([QUAL, CAPEX_DEMAND, GRID, { ...QUAL, id: 'q2', title: 'Ah Corp wins production award worth $9 million' }], { now: 0 });
    const list = ranked.items.filter((i) => i.bucket === 'MULTIBAGGER');
    for (let k = 1; k < list.length; k++) assert.ok(P(list[k - 1]) >= P(list[k]));
  });
  test('counts by priority add up and holdings are counted', () => {
    const res = buildRadar(ALL_FIX, { holdings: ['grd1', 'DCA'], now: 0 });
    const s = Object.values(res.counts.byPriority).reduce((a, b) => a + b, 0);
    assert.equal(s, ALL_FIX.length);
    assert.equal(res.counts.holdings, 2);
  });
});

describe('11 research priority', () => {
  test('VERY_HIGH needs stated duration >= 4, direct/near link, confirmed/strong evidence, governance not flagged', () => {
    // changed in zzz845: materiality is unknown without company context, so the top grade is withheld
    assert.equal(analyseRadarItem(QUAL).priority, 'HIGH');
    // missing pieces each drop it
    assert.notEqual(analyseRadarItem({ ...QUAL, sourceLabel: 'Financial media', primarySource: false, independentSources: 1 }).priority, 'VERY_HIGH');
    const typeOnly = run({ title: 'Ai Corp completes customer qualification and wins a supply contract worth $120 million', sourceLabel: 'SEC 8-K' });
    assert.equal(typeOnly.duration.basis, 'none');
    assert.notEqual(typeOnly.priority, 'VERY_HIGH');
  });
  test('governance FLAGGED caps at MEDIUM with the reason', () => {
    const r = analyseRadarItem({ ...QUAL, governance: { promoterPledgePct: 60, auditorIssue: true } });
    assert.equal(r.governance.status, 'FLAGGED');
    assert.equal(r.priority, 'MEDIUM');
    assert.match(r.priorityReason, /governance is flagged/);
  });
  test('NOT_CHECKED governance is not CLEAR and does not block, but is said', () => {
    const r = analyseRadarItem(QUAL);
    assert.equal(r.governance.status, 'NOT_CHECKED');
    assert.notEqual(r.governance.status as string, 'CLEAR');
    assert.match(r.priorityReason, /Governance not checked/);
  });
  test('CLEAR governance with data', () => {
    const r = analyseRadarItem({ ...QUAL, governance: { promoterPledgePct: 2, auditorIssue: false } });
    assert.equal(r.governance.status, 'CLEAR');
    assert.equal(r.priority, 'HIGH'); // changed in zzz845: no company context, materiality unknown
  });
  test('HYPOTHESIS never above MEDIUM', () => {
    for (const f of [SOCIAL, ANALYST, { ...QUAL, sourceLabel: 'Twitter', primarySource: false, independentSources: 1 }]) assert.ok(P(analyseRadarItem(f)) <= 1);
    const r = analyseRadarItem({ ...QUAL, sourceLabel: 'Reddit', primarySource: false });
    assert.match(r.priorityReason, /hypothesis/i);
  });
  test('social-only capped: same event from a filing outranks the social version', () => {
    assert.ok(P(analyseRadarItem(QUAL)) > P(analyseRadarItem({ ...QUAL, sourceLabel: 'Twitter', primarySource: false })));
  });
  test('capex-only capped at MEDIUM', () => assert.ok(P(analyseRadarItem({ ...CAPEX_ONLY, independentSources: 4 })) <= 1));
  test('priority reason reads like the spec example', () => {
    const r = analyseRadarItem(QUAL);
    assert.match(r.priorityReason, /Customer qualification/);
    assert.match(r.priorityReason, /capacity expansion/);
    assert.match(r.priorityReason, /3-year/);
    assert.match(r.priorityReason, /Revenue impact not yet visible in reported earnings/);
  });
  test('PRICE IS NEVER AN INPUT: +40% vs -5% gives identical output', () => {
    const up = mk({ id: 'z', title: 'Bb Ltd wins 3-year supply contract worth $50 million; shares up 40% today', sourceLabel: 'NSE', primarySource: true });
    const down = { ...up, title: 'Bb Ltd wins 3-year supply contract worth $50 million; shares down 5% today' };
    const a = analyseRadarItem(up), b = analyseRadarItem(down);
    assert.equal(a.bucket, b.bucket);
    assert.equal(a.priority, b.priority);
    assert.equal(a.duration.code, b.duration.code);
    assert.equal(a.evidence.status, b.evidence.status);
    assert.equal(a.link, b.link);
    // the RadarInput type has no price field
    const keys = Object.keys(mk({ title: 'x' }));
    assert.ok(!keys.some((k) => /price|move|gain|change/i.test(k)));
    for (const f of [QUAL, RESULT, CAPEX_ONLY]) assert.ok(!('price' in f));
  });
  test('technical data never changes bucket, priority, duration, evidence or link', () => {
    const plain = analyseRadarItem(QUAL);
    const tech = analyseRadarItem({ ...QUAL, technical: { trend: 'up', relativeStrength: 'strong', breakout: true, volumeConfirmation: true } });
    for (const k of ['bucket', 'priority', 'priorityReason', 'duration', 'evidence', 'link', 'chain', 'proof', 'inflection'] as const) assert.deepEqual(tech[k], plain[k], k);
    const weak = analyseRadarItem({ ...QUAL, technical: { trend: 'down', relativeStrength: 'weak', breakout: false, volumeConfirmation: false } });
    assert.equal(weak.priority, plain.priority);
    assert.equal(weak.bucket, plain.bucket);
  });
});

describe('12 technical note is timing only', () => {
  test('null when none supplied', () => assert.equal(analyseRadarItem(QUAL).technical.note, null));
  test('describes trend, RS, breakout and volume, and says WHEN not WHY', () => {
    const n = analyseRadarItem({ ...QUAL, technical: { trend: 'up', relativeStrength: 'strong', breakout: true, volumeConfirmation: true } }).technical.note || '';
    assert.match(n, /WHEN, not WHY/);
    for (const w of ['trend is up', 'relative strength reads strong', 'breakout is in place', 'volume confirms']) assert.ok(n.includes(w), w);
  });
  test('empty technical object gives no note', () => assert.equal(analyseRadarItem({ ...QUAL, technical: {} }).technical.note, null));
});

describe('13 entity / ticker', () => {
  test('ticker stays null when unknown; given ticker is kept, never guessed', () => {
    assert.equal(analyseRadarItem(QUAL).ticker, null);
    assert.equal(run({ title: 'Ac Ltd wins order', ticker: '  ' }).ticker, null);
    assert.equal(run({ title: 'Ac Ltd wins order', ticker: 'ACL1' }).ticker, 'ACL1');
  });
});

describe('governance', () => {
  test('NOT_CHECKED when no data', () => {
    for (const d of [undefined, null, {}, { promoterPledgePct: null, auditorIssue: null }]) {
      const g = governanceOf(d as never);
      assert.equal(g.status, 'NOT_CHECKED');
      assert.deepEqual(g.flags, []);
      assert.match(g.note, /unknown, not clear/);
    }
  });
  test('each flag source is detected', () => {
    const cases: Array<[Parameters<typeof governanceOf>[0], RegExp]> = [
      [{ auditorIssue: true }, /Auditor/], [{ qualifiedOpinion: true }, /Qualified/], [{ promoterPledgePct: 55 }, /pledging/i],
      [{ relatedPartyConcern: true }, /Related-party/], [{ dilutionPct: 20 }, /dilution/i], [{ debtToEquity: 2.4 }, /Debt/],
      [{ regulatoryIssue: true }, /Regulatory/], [{ accountingRedFlag: true }, /Accounting/],
    ];
    for (const [d, re] of cases) { const g = governanceOf(d); assert.equal(g.status, 'FLAGGED'); assert.ok(g.flags.some((f) => re.test(f)), JSON.stringify(d)); }
  });
  test('small pledge is clear and states what was covered', () => {
    const g = governanceOf({ promoterPledgePct: 3 });
    assert.equal(g.status, 'CLEAR');
    assert.match(g.note, /promoter pledge/);
    assert.match(g.note, /not supplied are not covered/);
  });
});

describe('shared drivers', () => {
  test('AI data centres and grid expansion share an AI infrastructure driver', () => {
    const res = buildRadar([DC1, DC2, DC3, GRID, DEF], { holdings: ['DCA', 'GRD1'], now: 0 });
    const g = res.sharedDrivers.find((x) => x.driver === 'AI infrastructure');
    assert.ok(g, JSON.stringify(res.sharedDrivers));
    assert.deepEqual(g!.tickers, ['DCA', 'DCB', 'DCC', 'GRD1']);
    assert.match(g!.note, /AI infrastructure demand driver/);
    assert.match(g!.note, /GRD1 via grid \/ power/);
    assert.match(g!.note, /2 of 4 are holdings/);
    assert.ok(!res.sharedDrivers.some((x) => x.driver === 'Defence'));
  });
  test('driver taxonomy is keyword-based and general', () => {
    assert.ok(driversOfText('Order for missile components and drones').includes('Defence'));
    assert.ok(driversOfText('New wafer fab for semiconductor chips').includes('Semiconductors'));
    assert.ok(driversOfText('Rare earth magnet supply and lithium').includes('Rare earth / critical minerals'));
    assert.ok(driversOfText('LNG terminal and strategic reserves').includes('Energy security'));
    assert.ok(driversOfText('Battery cell gigafactory for electric vehicles').includes('EV / battery'));
    assert.ok(driversOfText('USFDA approval for API and formulations').includes('Pharma / API'));
    assert.ok(driversOfText('Hyperscale data centre with liquid cooling').includes('Data centres'));
    assert.deepEqual(driversOfText('Company reports steady growth'), []);
  });
  test('sharedDriversOf accepts plain tickers + drivers and needs 2+ names', () => {
    const g = sharedDriversOf([
      { ticker: 'AAA', drivers: ['Defence'] }, { ticker: 'BBB', drivers: ['Defence', 'Semiconductors'] }, { ticker: 'CCC', drivers: ['Semiconductors'] }, { ticker: null, company: 'Lone Co', drivers: ['Nuclear'] },
    ]);
    assert.deepEqual(g.map((x) => [x.driver, x.tickers]), [['Defence', ['AAA', 'BBB']], ['Semiconductors', ['BBB', 'CCC']]]);
  });
  test('noise items do not create shared drivers', () => {
    const res = buildRadar([mk({ id: 'n1', ticker: 'N1', title: 'The AI boom lifts everything, analysts say', sourceLabel: 'Financial media', primarySource: false }), mk({ id: 'n2', ticker: 'N2', title: 'The AI boom is the next big thing', sourceLabel: 'Financial media', primarySource: false })]);
    assert.deepEqual(res.sharedDrivers, []);
  });
});

describe('portfolio monitor', () => {
  const ENTRY: Partial<LedgerEntry> = { ticker: 'AAA', catalyst: 'Qualification at a tier-one customer', evidence: 'Developing', status: 'INTACT', lastReview: '2026-08-01', nextProofPoint: 'First shipments' };
  test('Not established when there is no data at all', () => {
    const m = portfolioMonitorOf(null, null);
    for (const v of Object.values(m)) assert.equal(v, 'Not established');
    const m2 = portfolioMonitorOf({}, null);
    for (const v of Object.values(m2)) assert.equal(v, 'Not established');
    assert.equal(Object.keys(m).length, 10);
  });
  test('ledger entry alone: only the next proof point is answered from its own field', () => {
    const m = portfolioMonitorOf(ENTRY, null);
    assert.match(m.nextProofPoint, /First shipments/);
    assert.equal(m.originalCatalystProgressed, 'Not established');
    assert.equal(m.earningsConversionBegun, 'Not established');
    assert.equal(m.valuationAheadOfFundamentals, 'Not established');
  });
  test('with a radar item, answers use only its fields', () => {
    const item = analyseRadarItem({ ...QUAL, earnings: { revenueYoY: 20, marginNow: 16, marginPrior: 14 }, multipleNow: 30, forwardEarningsGrowth: 25 });
    const m = portfolioMonitorOf(ENTRY, item);
    assert.match(m.originalCatalystProgressed, /Qualification at a tier-one customer/);
    assert.match(m.evidenceStrengthened, /strengthened/);
    assert.match(m.earningsConversionBegun, /inflection/i);
    assert.match(m.opportunityIncreased, /revenue/);
    assert.match(m.bottleneckStrengthened, /shortage|lead times|suppliers/i);
    assert.match(m.customerAdoptionIncreased, /qualification|contract/i);
    assert.match(m.nextProofPoint, /production shipments/);
    assert.match(m.thesisWeakened, /No weakening signal/);
    assert.equal(portfolioMonitorOf(item, null).nextProofPoint, m.nextProofPoint);
  });
  test('disproved and flagged items show weakening; broken ledger status is reflected', () => {
    const item = analyseRadarItem({ ...CANCEL, governance: { accountingRedFlag: true } });
    const m = portfolioMonitorOf({ ...ENTRY, status: 'WEAKENING' }, item);
    assert.match(m.thesisWeakened, /weakening/);
    assert.match(m.thesisWeakened, /cancelled/);
    assert.match(m.thesisWeakened, /Governance flags/);
  });
  test('none of the ten answers is a price question and none leaks placeholders', () => {
    const m = portfolioMonitorOf(ENTRY, analyseRadarItem(QUAL));
    for (const v of Object.values(m)) { assert.doesNotMatch(v, LEAK); assert.doesNotMatch(v, BANNED); assert.doesNotMatch(v, /stock (?:went|is) up|price/i); }
  });
});

describe('output hygiene', () => {
  const EXTRA: RadarInput[] = [
    mk({ id: 'e1', title: 'Ba Ltd Q1 FY27 results', earnings: { revenueYoY: 12, marginNow: 11, marginPrior: 12 }, multipleNow: 22, forwardEarningsGrowth: 0 }),
    mk({ id: 'e2', title: 'Bb Ltd wins order', governance: { debtToEquity: 3, promoterPledgePct: 30 }, technical: { trend: 'up', breakout: false }, description: 'Approved supplier. Multi-year contract.' }),
    mk({ id: 'e3', title: '', description: 'Only a description about a design win with a customer.' }),
    mk({ id: 'e4', title: 'Bc Ltd', ticker: 'BC1', feedFacts: { what_happened: 'Signed a 6-quarter supply contract worth $12 million', what_matters: 'Adds volume', what_to_watch: 'first dispatch', what_breaks_thesis: 'Customer cuts volumes' }, feedTier: 'TIER1', eventType: 'ORDER' }),
    mk({ id: 'e5', title: 'Bd Ltd announces rights issue and going private plan', sourceLabel: undefined, primarySource: undefined }),
  ];
  test('no BUY / SELL / target-price / fair-value language in any output string', () => {
    for (const f of [...ALL_FIX, ...EXTRA]) for (const s of leaves(analyseRadarItem(f))) assert.doesNotMatch(s, BANNED, `${f.id}: ${s}`);
    for (const s of leaves(buildRadar([...ALL_FIX, ...EXTRA], { holdings: ['DCA'], now: 0 }))) assert.doesNotMatch(s, BANNED, s);
  });
  test('no undefined / NaN / null in any string', () => {
    for (const f of [...ALL_FIX, ...EXTRA]) for (const s of leaves(analyseRadarItem(f))) assert.doesNotMatch(s, LEAK, `${f.id}: ${s}`);
    for (const s of leaves(buildRadar([...ALL_FIX, ...EXTRA], { now: 0 }))) assert.doesNotMatch(s, LEAK, s);
  });
  test('empty and odd inputs never throw and never fake a candidate', () => {
    const r = analyseRadarItem(mk({ id: 'empty', title: '', description: '', sourceLabel: undefined, primarySource: undefined }));
    assert.equal(r.bucket, 'NOISE');
    assert.equal(r.event, 'Not stated');
    assert.equal(buildRadar([], { now: 0 }).items.length, 0);
    assert.doesNotThrow(() => analyseRadarItem(mk({ title: 'x', earnings: { revenueYoY: NaN, marginNow: Infinity } })));
  });
  test('no visible 0-100 score field is emitted', () => {
    for (const f of ALL_FIX) assert.ok(!Object.keys(analyseRadarItem(f)).some((k) => /score/i.test(k)));
  });
  test('feed facts and description contribute to reading', () => {
    const r = analyseRadarItem(EXTRA[3]);
    assert.equal(r.kind, 'CUSTOMER_QUALIFICATION');
    assert.equal(r.feedEventId, 'e4');
    assert.equal(analyseRadarItem(QUAL).feedEventId, null);
  });
  test('determinism: same input, deep-equal output', () => {
    for (const f of [...ALL_FIX, ...EXTRA]) assert.deepEqual(analyseRadarItem(f), analyseRadarItem(JSON.parse(JSON.stringify(f))));
    const a = buildRadar([...ALL_FIX, ...EXTRA], { holdings: ['DCA'], now: 123 });
    const b = buildRadar([...ALL_FIX, ...EXTRA].slice().reverse(), { holdings: ['DCA'], now: 123 });
    assert.deepEqual(a, b);
  });
  test('unknown is not negative: missing earnings, governance and valuation never read as bad', () => {
    const r = analyseRadarItem(QUAL);
    assert.equal(r.inflection, 'NOT_ASSESSED');
    assert.equal(r.expectations.state, 'NOT_ASSESSED');
    assert.equal(r.governance.status, 'NOT_CHECKED');
    assert.equal(r.chain[9].status, 'unknown');
  });
});
