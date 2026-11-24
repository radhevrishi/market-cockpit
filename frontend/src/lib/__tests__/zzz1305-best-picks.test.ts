import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, selectPicks, freshnessOf, nextSent, regimeRule, type Candidate, type Tech, type MarketRegime, type Evidence } from '../best-picks/score';
import { renderEmail } from '../best-picks/render';

const TODAY = '2026-11-24';
const tech = (o: Partial<Tech> = {}): Tech => ({ px: 102, chg: 1, mc: 4000, sma50: 100, sma200: 85, ema21: 101, stage: 2, health: 2, rs: 80, p3m: 15, p1y: 40, traded: 20, r40: 45, roce: 22, de: 0.2, name: 'Test Co', industry: 'Industrials', ...o });
const ev = (family: Evidence['family'], points: number, date = '2026-11-20', id = `${family}-1`, extra: Partial<Evidence> = {}): Evidence => ({ family, tool: family, points, line: `${family} line`, date, id, ...extra });
const cand = (o: Partial<Candidate> = {}): Candidate => ({ market: 'IN', ticker: 'TESTCO', company: 'Test Co', evidence: [ev('EARNINGS', 25)], tech: tech(), held: false, rejectedOn: null, resultsOn: null, guidanceCut: null, ...o });
const reg = (kind: MarketRegime['kind']): MarketRegime => ({ kind, note: null, drawdownPct: -2, vix: 14, vixBand: 'calm', above50: 60, above200: 55, indexName: 'Nifty 50', indexChg: 0.4 });

test('two families on a healthy trend = a top pick; one family is not', () => {
  const two = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)] }), TODAY);
  assert.deepEqual(two.vetoes, []);
  assert.ok(two.familyCount >= 2);
  const one = scoreCandidate(cand({ tech: tech({ px: 130 }) }), TODAY);   // extended: no Entry Desk setup either
  assert.ok(one.vetoes.includes('only one family of evidence'));
});

test('the price on its 50-day counts as the setup family (Entry Desk rules)', () => {
  const s = scoreCandidate(cand({ tech: tech({ px: 101, sma50: 100 }) }), TODAY);
  assert.ok(s.families.includes('SETUP'));
  assert.ok(s.entry && s.entry.stop != null);
});

test('result + guidance from the same filing count as 1.5 families', () => {
  const s = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25, '2026-11-20'), ev('GUIDANCE', 20, '2026-11-21')], tech: tech({ px: 130 }) }), TODAY);
  assert.equal(s.familyCount, 1.5);
  assert.ok(s.vetoes.includes('only one family of evidence'), 'a result and its own guidance still need a second confirmation');
});

test('old catalysts do not count; vetoes and exclusions', () => {
  const old = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25, '2026-09-01')] }), TODAY);
  assert.ok(old.vetoes[0].startsWith('no catalyst'));
  const big = scoreCandidate(cand({ tech: tech({ mc: 50_000 }) }), TODAY);
  assert.match(big.excluded!, /large company/);
  const usBig = scoreCandidate(cand({ market: 'US', tech: tech({ mc: 12_000 }) }), TODAY);
  assert.match(usBig.excluded!, /large company/);
  const st3 = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)], tech: tech({ stage: 3 }) }), TODAY);
  assert.ok(st3.vetoes.some((v) => /Stage 3/.test(v)));
  const below = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)], tech: tech({ px: 80 }) }), TODAY);
  assert.ok(below.vetoes.some((v) => /200-day/.test(v)));
  const thin = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)], tech: tech({ traded: 1 }) }), TODAY);
  assert.ok(thin.vetoes.some((v) => /thin trading/.test(v)));
  const ran = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)], tech: tech({ p3m: 60 }) }), TODAY);
  assert.ok(ran.rewarded && ran.vetoes.some((v) => /already rewarded/.test(v)));
  const cut = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)], guidanceCut: '2026-11-22' }), TODAY);
  assert.ok(cut.vetoes.some((v) => /guidance cut/.test(v)));
});

test('a REJECTED mark hides the name unless a catalyst is newer than the mark', () => {
  const hidden = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25, '2026-11-10'), ev('EVENT', 20, '2026-11-10')], rejectedOn: '2026-11-15' }), TODAY);
  assert.match(hidden.excluded!, /REJECTED/);
  const back = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25, '2026-11-20'), ev('EVENT', 20, '2026-11-10')], rejectedOn: '2026-11-15' }), TODAY);
  assert.equal(back.excluded, null);
  assert.ok(back.warnings.some((w) => /rejected/.test(w)));
});

test('regimes: BEAR shows no picks; CORRECTION needs a support entry and caps at 4', () => {
  const good = (t: string, px = 101) => scoreCandidate(cand({ ticker: t, evidence: [ev('EARNINGS', 25, '2026-11-20', `e-${t}`), ev('EVENT', 20, '2026-11-20', `v-${t}`)], tech: tech({ px }) }), TODAY);
  const all = Array.from({ length: 6 }, (_, i) => good(`T${i}`));
  assert.equal(selectPicks(all, { IN: reg('BEAR'), US: null }, {}, TODAY).top.length, 0);
  const corr = selectPicks(all, { IN: reg('CORRECTION'), US: null }, {}, TODAY);
  assert.equal(corr.top.length, 4);
  const ext = selectPicks([good('X', 118)], { IN: reg('CORRECTION'), US: null }, {}, TODAY);
  assert.equal(ext.top.length, 0); assert.equal(ext.regimeHeld.length, 1);
  assert.equal(selectPicks([good('X', 118)], { IN: reg('BULL'), US: null }, {}, TODAY).top.length, 1);
  assert.equal(regimeRule('UNKNOWN').maxTop, 4);
});

test('repeat rule: same evidence → still valid; a new catalyst or +10 score → back on top; 14 days resets', () => {
  const s = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)] }), TODAY);
  const sel = selectPicks([s], { IN: reg('BULL'), US: null }, {}, TODAY);
  assert.equal(sel.top.length, 1); assert.equal(sel.top[0].fresh, 'NEW');
  const sent = nextSent({}, sel, TODAY);
  const again = selectPicks([s], { IN: reg('BULL'), US: null }, sent, '2026-11-25');
  assert.equal(again.top.length, 0); assert.equal(again.stillValid.length, 1);
  const s2 = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20), ev('GUIDANCE', 20, '2026-11-25', 'g-new')] }), '2026-11-25');
  assert.equal(freshnessOf(s2, sent['IN:TESTCO'], '2026-11-25'), 'NEW CATALYST');
  assert.equal(freshnessOf(s, sent['IN:TESTCO'], '2026-12-09'), 'NEW');
});

test('held names go to the add-on list, not the top list', () => {
  const s = scoreCandidate(cand({ held: true, evidence: [ev('EARNINGS', 25), ev('EVENT', 20)] }), TODAY);
  const sel = selectPicks([s], { IN: reg('BULL'), US: null }, {}, TODAY);
  assert.equal(sel.top.length, 0); assert.equal(sel.addOn.length, 1);
});

test('email: quiet day subject, partial-data banner, plain text has no markup, light page', () => {
  const sel = selectPicks([], { IN: reg('BULL'), US: reg('CORRECTION') }, {}, TODAY);
  const r = renderEmail({ dateLabel: '24 Nov 2026', today: TODAY, regimes: { IN: reg('BULL'), US: reg('CORRECTION') }, sel, sources: [{ id: 'radar', label: 'Transformation Radar', state: 'failed', asOf: null, note: 'timeout', count: null }], candidates: 0, tookMs: 1200, version: 't', siteUrl: 'https://x' });
  assert.ok(r.quiet);
  assert.match(r.subject, /No high-conviction picks today/);
  assert.match(r.subject, /1 source failed/);
  assert.match(r.html, /Partial data/);
  assert.match(r.html, /background:#ffffff/);
  assert.ok(!/<[a-z]/i.test(r.text));
  const s = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)] }), TODAY);
  const r2 = renderEmail({ dateLabel: '24 Nov 2026', today: TODAY, regimes: { IN: reg('BULL'), US: null }, sel: selectPicks([s], { IN: reg('BULL'), US: null }, {}, TODAY), sources: [], candidates: 1, tookMs: 1, version: 't', siteUrl: 'https://x' });
  assert.match(r2.subject, /🇮🇳 BULL 1/);
  assert.match(r2.html, /TESTCO/);
  assert.match(r2.telegram, /1\. TESTCO/);
});

test('route and page: no named exports from the page, the scheduler runs the job on weekdays', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const page = readFileSync(join(__dirname, '../../app/(dashboard)/best-picks/page.tsx'), 'utf8');
  assert.ok(!/^export (?!default)/m.test(page));
  const sched = readFileSync(join(__dirname, '../app-scheduler.ts'), 'utf8');
  assert.match(sched, /name: 'best-picks', crons: \['40 13 \* \* 1-5'\]/);
});

test('weak relative strength or no stage far under the 50-day is vetoed (OMPOWER case)', () => {
  const weak = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)], tech: tech({ rs: 12 }) }), TODAY);
  assert.ok(weak.vetoes.some((v) => /relative strength/.test(v)));
  const noStage = scoreCandidate(cand({ evidence: [ev('EARNINGS', 25), ev('EVENT', 20)], tech: tech({ stage: null as any, px: 90, sma50: 100 }) }), TODAY);
  assert.ok(noStage.vetoes.some((v) => /no weekly stage/.test(v)));
});
