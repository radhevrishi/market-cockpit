// zzz914 — the two owner briefs the app now sends itself (conviction-catalyst-brief, portfolio-thesis-watch).
// Made-up tickers only (AAA, BBB, …): personal holdings never appear in source, tests or logs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { vaultValue, bareTicker, looksUsListed, briefDate, briefDayKey, ADVICE_WORDS } from '../owner-briefs/common';
import {
  cbEntriesFrom, enrichEntry, scoreRow, smallMidOnly, rankRows, deltaOf, nothingChanged, attachCatalysts, nextState,
  tradingViewBlock, composeConvictionBrief, parseAiCatalyst, aiWorthIt, aiFacts, AI_MAX_NAMES, AI_MAX_USD_PER_RUN, type CbState,
} from '../owner-briefs/conviction-brief';
import { evaluateTrigger, assessHolding, composeThesisWatch, rankResults, type HoldingInput } from '../owner-briefs/thesis-watch';
import { holdingSymbols, ledgerViewOf, researchFor } from '../owner-briefs/run';
import { ownerBriefOutcome } from '../owner-briefs/job';
import { APP_JOBS, parseCron, prevSlot, lockTtlSec, slotWindowMs } from '../app-scheduler';

const NOW = new Date('2026-10-06T04:29:00Z');
const strongQ = [100, 105, 110, 115, 130, 140, 150, 165];   // oldest → newest, every recent quarter +15% YoY or more
const E = (t: string, o: any = {}) => ({
  ticker: t, company: `${t} Industries`, tier: 'STRONG', composite_score: 80, filing_date: '2026-09-20', added_at: '2026-09-21T00:00:00Z',
  sales_yoy_pct: 30, net_profit_yoy_pct: 45, eps_yoy_pct: 45, opm_pct: 18, opm_prev_pct: 15, quarters_sales: strongQ,
  annual_cfo_pat: [0.9, 1.1], guidance: 'Positive', guidance_score: 0.6, roce: 24, pe: 30, market_cap_cr: 4000, move_pct: 1, ...o,
});

describe('common', () => {
  test('vault value: {__raw, parsed}, raw only, plain, string', () => {
    assert.deepEqual(vaultValue({ __raw: '{"a":1}', parsed: { a: 1 } }), { a: 1 });
    assert.deepEqual(vaultValue({ __raw: '[1,2]' }), [1, 2]);
    assert.deepEqual(vaultValue([{ symbol: 'AAA' }]), [{ symbol: 'AAA' }]);
    assert.deepEqual(vaultValue('{"b":2}'), { b: 2 });
    assert.equal(vaultValue(null), null);
  });
  test('tickers: prefixes and suffixes stripped, US listings recognised', () => {
    assert.equal(bareTicker('NSE:aaa'), 'AAA'); assert.equal(bareTicker('BBB.NS'), 'BBB');
    assert.ok(looksUsListed('NASDAQ:ZZZ')); assert.ok(looksUsListed('ZZZ.US')); assert.ok(!looksUsListed('AAA'));
  });
  test('dates: Berlin day label and key', () => {
    assert.equal(briefDate(NOW), '06 Oct 2026');
    assert.equal(briefDayKey(new Date('2026-10-05T22:30:00Z')), '2026-10-06');   // already the 6th in Berlin
  });
});

describe('conviction catalyst brief', () => {
  test('entries: record or array, India only, removed cards and duplicates dropped', () => {
    const v = { AAA: E('AAA'), BBB: { ...E('BBB'), _not_on_server: true }, CCC: { ...E('NASDAQ:CCC') }, aaa: E('aaa') };
    assert.deepEqual(cbEntriesFrom(v).map((e) => e.ticker), ['AAA']);
    assert.deepEqual(cbEntriesFrom([E('DDD')]).map((e) => e.ticker), ['DDD']);
  });

  test('enrich before scoring: a blank ROCE / cash is filled from the bench, then the screener — never sidelined', () => {
    const { entry, filled } = enrichEntry(E('AAA', { roce: null, annual_cfo_pat: null, pe: 0 }), { roce: 31 }, { roce_pct: 12, cfo_to_pat_ratio: 1.2, pe: 22 });
    assert.equal(entry.roce, 31); assert.equal(entry.cfo_to_pat_ratio, 1.2); assert.equal(entry.pe, 22);
    assert.ok(filled.includes('roce') && filled.includes('cfo_to_pat_ratio'));
    const bare = scoreRow(E('BBB', { roce: null, annual_cfo_pat: null, pe: null }));
    assert.equal(bare.roce, null); assert.ok(bare.cat > 0, 'a blank field scores zero for that part, the name still ranks');
  });

  test('buckets: SHARP needs score 50+, a forward signal and no veto; cash veto never SHARP', () => {
    const sharp = scoreRow(E('AAA'), { guidanceRaised: true });
    assert.equal(sharp.bucket, 'SHARP', JSON.stringify(sharp.info));
    const noFwd = scoreRow(E('BBB', { guidance: undefined, guidance_score: null }), {});
    assert.notEqual(noFwd.bucket, 'SHARP');
    const cash = scoreRow(E('CCC', { annual_cfo_pat: [0.3] }), { guidanceRaised: true });
    assert.equal(cash.bucket, 'CATALYST'); assert.match(cash.veto.join(' '), /not backed by cash/);
    const cut = scoreRow(E('DDD'), { guidanceLowered: true });
    assert.ok(cut.veto.includes('guidance cut on file')); assert.notEqual(cut.bucket, 'SHARP');
  });

  test('price never adds points; it only says whether the market noticed', () => {
    const a = scoreRow(E('AAA', { move_pct: -20 }), { guidanceRaised: true });
    const b = scoreRow(E('AAA', { move_pct: 40 }), { guidanceRaised: true });
    assert.equal(a.cat, b.cat);
    assert.equal(a.recog, 'faded'); assert.equal(b.recog, 'noticed');
  });

  test('small/mid only: a known large cap is left out, an unknown size is kept', () => {
    const rows = [scoreRow(E('AAA')), scoreRow(E('BBB', { market_cap_cr: 50_000 })), scoreRow(E('CCC', { market_cap_cr: null }))];
    const { kept, largeLeftOut } = smallMidOnly(rows);
    assert.deepEqual(kept.map((r) => r.ticker), ['AAA', 'CCC']); assert.equal(largeLeftOut, 1);
  });

  test('delta: new, re-added, dropped, bucket moves; reuse stored catalyst for old names', () => {
    const rows = rankRows([scoreRow(E('AAA'), { guidanceRaised: true }), scoreRow(E('BBB', { added_at: '2026-10-05T00:00:00Z' })), scoreRow(E('CCC'))]);
    const prev: CbState = { at: '2026-10-05T04:30:00Z', names: {
      AAA: { addedAt: '2026-09-21T00:00:00Z', catalyst: 'stored line', catalystBy: 'rules', bucket: 'GATE', cat: 40, veto: false },
      BBB: { addedAt: '2026-08-01T00:00:00Z', catalyst: 'old', catalystBy: 'rules', bucket: 'GATE', cat: 40, veto: false },
      ZZZ: { addedAt: '2026-08-01T00:00:00Z', catalyst: 'gone', catalystBy: 'rules', bucket: 'CATALYST', cat: 10, veto: false },
    } };
    const d = deltaOf(rows, prev);
    assert.deepEqual(d.added.sort(), ['BBB', 'CCC']); assert.deepEqual(d.dropped, ['ZZZ']);
    assert.deepEqual(d.moved, [{ ticker: 'AAA', from: 'GATE', to: 'SHARP' }]);
    const withCat = attachCatalysts(rows, { CCC: { guidanceStatement: 'Revenue to grow 25% in FY27' } }, prev, { BBB: 'New plant starts in Q4.' }, d.added);
    const by = Object.fromEntries(withCat.map((r) => [r.ticker, r]));
    assert.equal(by.AAA.catalyst, 'stored line'); assert.equal(by.AAA.catalystBy, 'stored');
    assert.equal(by.BBB.catalystBy, 'ai'); assert.equal(by.CCC.catalyst, 'Revenue to grow 25% in FY27');
    assert.ok(by.BBB.isNew && by.CCC.isNew && !by.AAA.isNew);
    const st = nextState(withCat, NOW);
    assert.equal(deltaOf(rows, st).added.length, 0); assert.ok(nothingChanged(deltaOf(rows, st)));
  });

  test('TradingView block: exact format, grouped by bucket, BSE code gets BSE:', () => {
    const tv = tradingViewBlock([{ ticker: 'AAA', bucket: 'SHARP' }, { ticker: 'BBB', bucket: 'SHARP' }, { ticker: 'CCC', bucket: 'GATE' }, { ticker: '543210', bucket: 'CATALYST' }]);
    assert.equal(tv, '###SHARP,NSE:AAA,NSE:BBB,###GATE,NSE:CCC,###CATALYST,BSE:543210');
  });

  test('the mail: subject, sections, white page, no advice words, text part has no markup; one line when nothing changed', () => {
    const rows = attachCatalysts(rankRows([scoreRow(E('AAA'), { guidanceRaised: true }), scoreRow(E('CCC', { annual_cfo_pat: [0.2] }))]), {}, null, {}, ['AAA', 'CCC']);
    const d = deltaOf(rows, null);
    const b = composeConvictionBrief({ rows, delta: d, largeLeftOut: 2, when: NOW, dateLabel: briefDate(NOW), source: 'test list', prevAt: null });
    assert.equal(b.subject, 'Conviction Catalyst - Morning 06 Oct 2026');
    assert.ok(!b.oneLine);
    for (const s of ['New since last run', 'Ranked, catalyst first', 'red flags', 'TradingView import', '###SHARP,NSE:AAA', '2 large caps left out']) assert.ok(b.html.includes(s), s);
    assert.ok(!/<|>/.test(b.text), 'plain text carries no markup');
    assert.ok(!ADVICE_WORDS.test(b.text), b.text.match(ADVICE_WORDS)?.[0]);
    assert.ok(/background:#ffffff/.test(b.html) && !/background:#(0|1|2)[0-9a-f]{5}/i.test(b.html), 'light page, no dark fills');
    assert.ok(!/<script/i.test(b.html));
    const quiet = composeConvictionBrief({ rows, delta: deltaOf(rows, nextState(rows, NOW)), largeLeftOut: 0, when: NOW, dateLabel: '07 Oct 2026', source: 'x', prevAt: NOW.toISOString() });
    assert.ok(quiet.oneLine); assert.equal(quiet.text.split('\n').length, 1); assert.match(quiet.text, /^No change in the conviction list since 2026-10-06/);
  });

  test('AI: only for names with company text, a small per-run cap, the reply cleaned and advice refused', () => {
    assert.ok(!aiWorthIt({})); assert.ok(aiWorthIt({ guidanceStatement: 'x' }));
    assert.ok(AI_MAX_NAMES <= 6 && AI_MAX_USD_PER_RUN <= 0.05);
    const facts = aiFacts({ guidanceStatement: 'Capacity doubles by Q3 FY27' }, scoreRow(E('AAA')).info);
    assert.ok(facts[0].startsWith('Company guidance on file'));
    assert.equal(parseAiCatalyst({ content: [{ type: 'text', text: '"<b>New plant</b> adds capacity in Q3 FY27."' }] }), 'New plant adds capacity in Q3 FY27.');
    assert.equal(parseAiCatalyst({ content: [{ type: 'text', text: 'Strong buy ahead of results' }] }), null);
    assert.equal(parseAiCatalyst({}), null);
  });

  test('stored research: raise / cut decided by the newer event, guidance statement from the universe', () => {
    const events = [
      { id: 'e2', ticker: 'AAA', event_type: 'GUIDANCE_RAISED', event_date: '2026-09-01', headline: 'Raised FY27 revenue growth to 30%' },
      { id: 'e1', ticker: 'AAA', event_type: 'GUIDANCE_LOWERED', event_date: '2026-06-01', headline: 'Cut' },
      { id: 'e3', ticker: 'BBB', event_type: 'GUIDANCE_LOWERED', event_date: '2026-09-10', headline: 'Lowered margin outlook' },
    ];
    const universe = [{ record: { ticker: 'AAA', market: 'IN' }, statement: 'Revenue growth of 30% in FY27', sourceUrl: 'https://example.com/a.pdf', metric: 'revenue' }];
    const a = researchFor('AAA', events, universe);
    assert.ok(a.guidanceRaised && !a.guidanceLowered); assert.equal(a.guidanceStatement, 'Revenue growth of 30% in FY27');
    const b = researchFor('BBB', events, universe);
    assert.ok(b.guidanceLowered && !b.guidanceRaised); assert.equal(b.guidanceStatement, null);
  });
});

describe('portfolio thesis watch', () => {
  const thesis = { thesis: 'capacity ramp', triggers: [
    { id: 't1', kind: 'margin', label: 'margin below 12%', threshold: 12 },
    { id: 't2', kind: 'price', label: 'stop', threshold: 100 },
    { id: 't3', kind: 'custom', label: 'check order book', note: 'order book' },
  ] };
  const H = (t: string, o: Partial<HoldingInput> = {}): HoldingInput => ({ ticker: t, company: `${t} Ltd`, thesis, figures: { opm_pct: 14, opm_prev_pct: 15, net_profit_yoy_pct: 10, cfo_to_pat_ratio: 1 }, ledger: { period: 'Q1 FY27', status: 'ON_TRACK', because: null, readAt: null }, guidance: [], result: null, ...o });

  test('triggers: same rules as the Thesis page, price never checked here', () => {
    assert.equal(evaluateTrigger({ kind: 'margin', threshold: 12 }, { opm_pct: 11, opm_prev_pct: 13 }).status, 'breach');
    assert.equal(evaluateTrigger({ kind: 'margin', threshold: 12 }, { opm_pct: 14, opm_prev_pct: 15 }).status, 'ok');
    assert.equal(evaluateTrigger({ kind: 'cash' }, { annual_cfo_pat: [0.4] }).status, 'breach');
    assert.equal(evaluateTrigger({ kind: 'growth', threshold: 0 }, { net_profit_yoy_pct: -5 }).status, 'breach');
    assert.equal(evaluateTrigger({ kind: 'price', threshold: 100 }, { opm_pct: 1 }).status, 'not-checked');
    assert.equal(evaluateTrigger({ kind: 'margin' }, null).status, 'unknown');
  });

  test('a breached written trigger is THESIS CHANGE (IMPAIRED), quoting the trigger; reported once, then "still flagged"', () => {
    const h = H('AAA', { figures: { opm_pct: 10, opm_prev_pct: 14 } });
    const first = assessHolding(h, null);
    assert.equal(first.result.verdict, 'IMPAIRED');
    assert.match(first.result.changes[0].what, /“margin below 12%” is breached/);
    assert.equal(first.result.changes[0].leg, 'margin');
    assert.match(first.result.action, /^exit-watch/);
    assert.equal(first.result.priceTriggersSkipped, 1);
    const second = assessHolding(h, first.state);
    assert.equal(second.result.changes.length, 0); assert.equal(second.result.verdict, 'IMPAIRED');
    assert.match(second.result.stillFlagged[0], /still breached/);
  });

  test('engine status, guidance events and results — only what is new since the last run', () => {
    const base = assessHolding(H('BBB'), null).state;
    assert.equal(assessHolding(H('BBB'), base).result.verdict, 'INTACT');
    const weak = assessHolding(H('BBB', { ledger: { period: 'Q2 FY27', status: 'WEAKENING', because: 'utilisation fell', readAt: null } }), base);
    assert.equal(weak.result.verdict, 'WATCH'); assert.match(weak.result.changes[0].what, /weakening \(Q2 FY27\) — utilisation fell/);
    const raised = assessHolding(H('BBB', { guidance: [{ id: 'g1', type: 'GUIDANCE_RAISED', date: '2026-10-01', headline: 'FY27 revenue growth raised to 30%' }] }), base);
    assert.equal(raised.result.verdict, 'STRENGTHENED'); assert.match(raised.result.action, /consider adding/);
    assert.equal(assessHolding(H('BBB', { guidance: [{ id: 'g1', type: 'GUIDANCE_RAISED', date: null, headline: null }] }), raised.state).result.changes.length, 0, 'no repeats');
    const loss = assessHolding(H('BBB', { result: { filingDate: '2026-10-03', salesYoy: 5, profitYoy: -12 } }), base);
    assert.equal(loss.result.verdict, 'WATCH'); assert.equal(loss.result.changes[0].leg, 'earnings');
    const broken = assessHolding(H('BBB', { ledger: { period: 'Q2 FY27', status: 'BROKEN', because: 'two core variables down', readAt: null } }), base);
    assert.equal(broken.result.verdict, 'IMPAIRED'); assert.match(broken.result.action, /^re-underwrite/);
  });

  test('the mail: changes first, watch compact, intact as one list, footer; one line when nothing is new', () => {
    const prevs: Record<string, any> = {};
    const hs = [H('AAA', { figures: { opm_pct: 10, opm_prev_pct: 14 } }), H('BBB'), H('CCC', { guidance: [{ id: 'g9', type: 'GUIDANCE_LOWERED', date: '2026-10-02', headline: 'Lowered volume outlook', url: 'https://example.com/x' }] }), H('DDD', { thesis: null })];
    const rs = hs.map((h) => { const a = assessHolding(h, null); prevs[h.ticker] = a.state; return a.result; });
    assert.deepEqual(rankResults(rs).map((r) => r.verdict), ['IMPAIRED', 'WATCH', 'INTACT', 'INTACT']);
    const b = composeThesisWatch({ results: rs, dateLabel: '06 Oct 2026', source: 'test book', prevAt: null, firstRun: true, usDropped: 1 });
    assert.equal(b.subject, 'Portfolio Thesis Watch — 06 Oct 2026');
    for (const s of ['Changes', 'Watch', 'Intact (2)', 'THESIS CHANGE (IMPAIRED)', 'review prompts, not investment advice · India book, 4 holdings · 06 Oct 2026', '1 US-listed name left out', 'price triggers are not checked', '<a href="https://example.com/x"']) assert.ok(b.html.includes(s), s);
    assert.ok(!/https?:\/\//.test(b.html.replace(/href="[^"]*"/g, '')), 'no bare URL in visible text');
    assert.ok(!/<|>/.test(b.text)); assert.ok(!ADVICE_WORDS.test(b.text), b.text.match(ADVICE_WORDS)?.[0]);
    const again = hs.map((h) => assessHolding(h, prevs[h.ticker]).result);
    const q = composeThesisWatch({ results: again, dateLabel: '07 Oct 2026', source: 'test book', prevAt: '2026-10-06T02:15:00Z', firstRun: false });
    assert.ok(q.oneLine); assert.match(q.text, /^No new thesis drift across 4 India holdings since 2026-10-06\. Still flagged: AAA\.$/);
  });

  test('holdings and ledgers: US names dropped and counted; the stored engine status is read, never recomputed', () => {
    assert.deepEqual(holdingSymbols([{ symbol: 'AAA' }, { symbol: 'aaa.ns' }, { symbol: 'NASDAQ:ZZZ' }, { symbol: 'YYY', market: 'US' }, 'BBB']), { india: ['AAA', 'BBB'], usDropped: 2 });
    assert.deepEqual(holdingSymbols({ holdings: [{ symbol: 'CCC' }] }).india, ['CCC']);
    const l = { latest_period: 'Q1 FY27', periods: { 'Q1 FY27': { status: 'STRENGTHENING', status_because: 'utilisation up' } }, status_history: [], last_evidence_read_at: '2026-10-01' };
    assert.deepEqual(ledgerViewOf(l), { period: 'Q1 FY27', status: 'STRENGTHENING', because: 'utilisation up', readAt: '2026-10-01' });
    assert.equal(ledgerViewOf(null), null);
  });

  test('static: the thesis watch reads no price, market cap or technicals (same rule as the thesis engine)', () => {
    const src = readFileSync(join(__dirname, '..', 'owner-briefs', 'thesis-watch.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
    const BANNED = /\b(ltp|cmp|last_?price|lastPrice|current_?price|currentPrice|close_?price|prev_?close|change_?pct|pct_?change|draw_?down|drawdown|target_?price|market_?cap(?:_cr)?|marketCap(?:Cr)?|mcap|pct52|high52|low52|perf1y|technicals?|live_move_pct|move_pct|d1_pct|stock_?price|pe)\b|\.(?:price|close)\b/;
    const hit = src.split('\n').find((l) => BANNED.test(l));
    assert.equal(hit, undefined, hit);
  });

  test('no new files inside lib/thesis (the price-banned engine is untouched by this patch)', () => {
    const files = readdirSync(join(__dirname, '..', 'thesis'));
    assert.ok(!files.some((f) => /owner|brief/i.test(f)));
  });
});

describe('scheduling', () => {
  test('two jobs at the end of APP_JOBS, weekday mornings, odd minutes, owner-briefs.yml for hand runs', () => {
    const last = APP_JOBS.slice(-2).map((j) => j.name);
    assert.ok(APP_JOBS.findIndex((j) => j.name === 'conviction-catalyst-brief') >= APP_JOBS.length - 4);
    assert.ok(last.length === 2);
    const cb = APP_JOBS.find((j) => j.name === 'conviction-catalyst-brief')!;
    const tw = APP_JOBS.find((j) => j.name === 'portfolio-thesis-watch')!;
    assert.deepEqual(cb.crons, ['29 4 * * 1-5']); assert.deepEqual(tw.crons, ['15 2 * * 1-5']);
    for (const j of [cb, tw]) {
      assert.equal(j.workflow, 'owner-briefs.yml');
      for (const c of j.crons) { assert.ok(parseCron(c)); assert.equal(Number(c.split(' ')[0]) % 2, 1, `${c} odd minute`); }
      assert.ok(lockTtlSec(j) * 1000 < slotWindowMs(j, prevSlot(j.crons, NOW)!));
    }
    assert.equal(prevSlot(cb.crons, new Date('2026-10-10T12:00:00Z'))!.toISOString(), '2026-10-09T04:29:00.000Z', 'no Saturday run');
  });

  test('job outcome: ok from the route; not delivered / partial / no channel are failures with a reason', () => {
    const R = (status: number, json: any) => ({ status, ok: status >= 200 && status < 300, json, text: '', error: null, ms: 1 });
    assert.deepEqual(ownerBriefOutcome(R(200, { ok: true })), { ok: true, status: 200, error: null });
    assert.equal(ownerBriefOutcome(R(200, { ok: true, alreadySent: true })).error, 'already sent today');
    assert.match(ownerBriefOutcome(R(200, { ok: false, channels: { telegram: false, email: false } })).error!, /no Telegram or email channel/);
    assert.match(ownerBriefOutcome(R(200, { ok: false, partial: 'could not read', channels: { email: true } })).error!, /PARTIAL/);
    assert.equal(ownerBriefOutcome(R(401, null)).ok, false);
  });

  test('routes: secret checked (fail closed), counts-only log, no ticker in source', () => {
    for (const n of ['conviction-catalyst-brief', 'portfolio-thesis-watch']) {
      const s = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'cron', n, 'route.ts'), 'utf8');
      assert.match(s, /verifyCronSecret\(req\)/); assert.match(s, /counts=\$\{JSON\.stringify\(out\.counts\)\}/);
    }
    const wf = readFileSync(join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'owner-briefs.yml'), 'utf8');
    assert.match(wf, /workflow_dispatch:/); assert.match(wf, /lib\/app-scheduler/); assert.ok(!/^\s+schedule:/m.test(wf)); assert.match(wf, /x-cron-secret/);
  });
});
