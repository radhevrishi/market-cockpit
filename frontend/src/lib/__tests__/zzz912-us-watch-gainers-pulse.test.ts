// zzz912 — US earnings watch (app job) + gainers pipeline pulse (guardian check). Pure logic only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgarFilingDateNow, etMinutesOfDay } from '../us-earnings-dates';
import { pickUsWatchRows, formatUsWatchMessage, usWatchKey, fmtCapMusd } from '../us-earnings-watch';
import { expectedIndiaSessions, gainersPulseVerdict, sessionInfo } from '../gainers-pulse';
import { APP_JOBS, parseCron, prevSlot, slotWindowMs, lockTtlSec } from '../app-scheduler';
// @ts-ignore — plain JS module of the Cloudflare worker
import { gainersCheckDue, decideGainers, gainersAlertText } from '../../../../workers/mc-guardian/gainers-check.js';

const at = (s: string) => new Date(s);

test('EDGAR filing date: after 17:30 ET on a weekday it is the next weekday (EDT and EST)', () => {
  assert.equal(edgarFilingDateNow(Date.parse('2026-10-05T21:29:00Z')), '2026-10-05');   // 17:29 EDT Mon
  assert.equal(edgarFilingDateNow(Date.parse('2026-10-05T21:30:00Z')), '2026-10-06');   // 17:30 EDT Mon
  assert.equal(edgarFilingDateNow(Date.parse('2026-10-06T01:00:00Z')), '2026-10-06');   // 21:00 EDT Mon — the late sweep
  assert.equal(edgarFilingDateNow(Date.parse('2026-10-09T23:00:00Z')), '2026-10-12');   // Friday evening → Monday
  assert.equal(edgarFilingDateNow(Date.parse('2026-10-10T23:00:00Z')), '2026-10-10');   // Saturday stays
  assert.equal(edgarFilingDateNow(Date.parse('2026-12-01T22:29:00Z')), '2026-12-01');   // 17:29 EST
  assert.equal(edgarFilingDateNow(Date.parse('2026-12-01T22:31:00Z')), '2026-12-02');   // 17:31 EST
  assert.equal(etMinutesOfDay(Date.parse('2026-10-06T04:05:00Z')), 5);                  // 00:05 EDT
});

const row = (ticker: string, over: Record<string, any> = {}) => ({
  ticker, company: `${ticker} Inc`, tier: 'STRONG', composite_score: 70, filing_date: '2026-10-06', quarter: 'Q1 FY27', fiscal_year: 2027,
  sales_yoy_pct: 30, net_profit_yoy_pct: 45, eps_yoy_pct: 40, opm_pct: 20, opm_prev_pct: 15,
  revenue_curr_musd: 100, net_income_curr_musd: 10, cfo_curr_musd: 12,
  market_cap_musd: 3000, pead_score: 65, pct_vs_ma50: 5, pct_vs_ma200: 12, stage: 2,
  eps_adj_curr: 0.7, eps_estimate: 0.6, guidance: 'RAISED', d1_pct: 6.2,
  filing_url: `https://www.sec.gov/Archives/edgar/data/1/${ticker}-index.htm`, ...over,
});

test('US watch: same preset as the US Conviction Beats page, small/mid caps only, ranked', () => {
  const payload = { by_tier: {
    BLOCKBUSTER: [row('BBB', { tier: 'BLOCKBUSTER', composite_score: 60 })],
    STRONG: [
      row('AAA', { composite_score: 80 }),
      row('BIG', { market_cap_musd: 45_000 }),                      // large cap → out
      row('NOCAP', { market_cap_musd: null }),                     // market cap unknown → out
      row('SLOW', { sales_yoy_pct: 8 }),                           // fails sales gate on real data → out
      row('TINY', { market_cap_musd: 150 }),                       // under the preset's $300M floor → out
      row('DOWN', { pct_vs_ma200: -4, stage: 4 }),                 // below the 200-day average → out
      row('PRE', { prelim: true, cfo_curr_musd: null, cfo_to_pat_ratio: null }),   // cash not known yet → kept, said
    ],
    MIXED: [row('MIX', { tier: 'MIXED' })],
  } };
  const picks = pickUsWatchRows(payload);
  assert.deepEqual(picks.map((p) => p.entry.ticker), ['BBB', 'AAA', 'PRE']);
  assert.equal(picks[0].key, usWatchKey('BBB', '2026-10-06'));
  assert.equal(picks[0].key, 'us-earnings:BBB:2026-10-06');
  assert.equal(picks.find((p) => p.entry.ticker === 'PRE')!.state, 'unknown');
  assert.equal(picks.find((p) => p.entry.ticker === 'AAA')!.state, 'pass');
});

test('US watch: one card per company (newest filing wins)', () => {
  const payload = { by_tier: { STRONG: [row('DUP', { filing_date: '2026-10-05' }), row('DUP', { filing_date: '2026-10-06' })] } };
  const picks = pickUsWatchRows(payload);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].entry.filing_date, '2026-10-06');
});

test('US watch message: plain words, every asked-for field, PRELIM said, link included', () => {
  const picks = pickUsWatchRows({ by_tier: { STRONG: [row('AAA'), row('PRE', { prelim: true, cfo_curr_musd: null, cfo_to_pat_ratio: null })] } });
  const m = formatUsWatchMessage(picks, { date: '2026-10-06', windowStart: '2026-10-05' });
  assert.match(m.subject, /2 new names/);
  assert.match(m.text, /1\. AAA — AAA Inc/);
  assert.match(m.text, /Grade: STRONG, score 70\. Quarter: Q1 FY27\./);
  assert.match(m.text, /Sales \+30% vs last year\. EPS \+40%/);
  assert.match(m.text, /EPS \$0\.70 vs \$0\.60 expected \(beat\)/);
  assert.match(m.text, /Outlook: raised\./);
  assert.match(m.text, /Drift score 65/);
  assert.match(m.text, /stock \+6% on day 1/);
  assert.match(m.text, /Market cap \$3\.0B/);
  assert.match(m.text, /Verdict: /);
  assert.match(m.text, /PRELIM: these figures come from the press release/);
  assert.match(m.text, /Not checked yet \(data missing\): cash ratio/);
  assert.match(m.text, /SEC filing: https:\/\/www\.sec\.gov\//);
  assert.ok(!/\b(BUY|SELL)\b/.test(m.text), 'no buy/sell words');
  assert.equal(fmtCapMusd(450), '$450M');
});

test('US watch job: registered last-block style, odd minutes, both windows, lock shorter than every window', () => {
  const j = APP_JOBS.find((x) => x.name === 'us-earnings-watch')!;
  assert.ok(j);
  for (const c of j.crons) { assert.ok(parseCron(c)); assert.equal(Number(c.split(' ')[0]) % 2, 1, `${c} on an odd minute`); }
  // US hours (11:07 UTC Mon) and the late after-close sweep (01:07 UTC Tue = 21:07 EDT Mon)
  assert.equal(prevSlot(j.crons, at('2026-10-05T11:30:00Z'))!.toISOString(), '2026-10-05T11:07:00.000Z');
  assert.equal(prevSlot(j.crons, at('2026-10-06T01:10:00Z'))!.toISOString(), '2026-10-06T01:07:00.000Z');
  assert.equal(prevSlot(j.crons, at('2026-10-10T12:00:00Z'))!.toISOString(), '2026-10-10T02:07:00.000Z');   // Saturday: only the late sweep
  let s = prevSlot(j.crons, at('2026-10-05T00:00:00Z'))!;
  for (let k = 0; k < 100; k++) { assert.ok(slotWindowMs(j, s) > lockTtlSec(j) * 1000); s = prevSlot(j.crons, new Date(s.getTime() + 3 * 3600_000))!; }
});

const noHol = () => false;
test('gainers pulse: the sessions that should have research by now', () => {
  assert.deepEqual(expectedIndiaSessions(at('2026-10-05T14:20:00Z'), 2, noHol), ['2026-10-05', '2026-10-02']);   // Mon 19:50 IST
  assert.deepEqual(expectedIndiaSessions(at('2026-10-05T05:00:00Z'), 2, noHol), ['2026-10-02', '2026-10-01']);   // Mon morning: not yet today
  assert.deepEqual(expectedIndiaSessions(at('2026-10-04T14:20:00Z'), 2, noHol), ['2026-10-02', '2026-10-01']);   // Sunday
  assert.deepEqual(expectedIndiaSessions(at('2026-10-05T14:20:00Z'), 2, (d) => d === '2026-10-02'), ['2026-10-05', '2026-10-01']);   // holiday skipped
});

test('gainers pulse: healthy when either checked session has research; otherwise a cause from the evidence', () => {
  const s = (date: string, researched: number, total = researched) => ({ date, researched, total, updated_at: null });
  const hb = (last_ok_at: string | null, last_ok: boolean | null = true, error: string | null = null) => ({ name: 'daily-research-gainers-in', last_ok_at, last_ok, error });
  assert.equal(gainersPulseVerdict(['2026-10-05', '2026-10-02'], [s('2026-10-05', 0), s('2026-10-02', 31)], hb('2026-10-05T11:30:00Z')).ok, true);
  const stale = gainersPulseVerdict(['2026-10-05', '2026-10-02'], [s('2026-10-05', 0, 0), s('2026-10-02', 0, 0), s('2026-10-01', 28)], hb('2026-10-01T11:20:00Z'));
  assert.equal(stale.ok, false);
  assert.equal(stale.last_output!.date, '2026-10-01');
  assert.match(stale.likely_cause!, /has not run successfully since 2026-10-01/);
  assert.match(gainersPulseVerdict(['2026-10-05', '2026-10-02'], [s('2026-10-05', 0, 0), s('2026-10-02', 0, 0)], hb('2026-10-05T11:00:00Z', false, 'exit 1')).likely_cause!, /last gainers-in run failed: exit 1/);
  assert.match(gainersPulseVerdict(['2026-10-05', '2026-10-02'], [s('2026-10-05', 0, 40), s('2026-10-02', 0, 0)], hb('2026-10-05T11:00:00Z')).likely_cause!, /no name was researched/);
  assert.deepEqual(sessionInfo('2026-10-05', { findings: { A: {}, B: {} }, universe: [1, 2, 3], updated_at: 'x' }), { date: '2026-10-05', researched: 2, total: 3, updated_at: 'x' });
  assert.deepEqual(sessionInfo('2026-10-05', null), { date: '2026-10-05', researched: 0, total: 0, updated_at: null });
});

test('guardian gainers check: weekdays from 14:20 UTC, once a day, two strikes before an alert, silence when healthy', () => {
  assert.equal(gainersCheckDue(at('2026-10-05T14:10:00Z'), null), false);
  assert.equal(gainersCheckDue(at('2026-10-05T14:20:00Z'), null), true);
  assert.equal(gainersCheckDue(at('2026-10-04T15:00:00Z'), null), false);                                   // Sunday
  assert.equal(gainersCheckDue(at('2026-10-05T15:00:00Z'), { date: '2026-10-05', done: true }), false);
  assert.equal(gainersCheckDue(at('2026-10-06T14:20:00Z'), { date: '2026-10-05', done: true }), true);
  const now = at('2026-10-05T14:20:00Z');
  const healthy = decideGainers(now, null, { ok: true, body: { ok: true } });
  assert.equal(healthy.action, 'silent'); assert.equal(healthy.state.done, true);
  const broken = { ok: false, checked: ['2026-10-05', '2026-10-02'], last_output: { date: '2026-10-01', researched: 28, updated_at: null }, sessions: [1, 2, 3], heartbeats: [{ name: 'daily-research-gainers-in', last_ok_at: '2026-10-01T11:20:00Z', last_ok: true }], likely_cause: 'x' };
  const first = decideGainers(now, null, { ok: true, body: broken });
  assert.equal(first.action, 'wait'); assert.equal(first.state.strikes, 1);
  const second = decideGainers(at('2026-10-05T14:30:00Z'), first.state, { ok: true, body: broken });
  assert.equal(second.action, 'alert'); assert.equal(second.state.done, true);
  assert.match(String(second.text), /^Gainers pipeline has not run in 48h/);
  assert.match(String(second.text), /Last research: the 2026-10-01 session \(28 names\)/);
  assert.match(gainersAlertText(broken), /Most likely cause: x\./);
  // the app not answering: wait, then report once after 17:20 UTC
  assert.equal(decideGainers(now, null, { ok: false, why: 'HTTP 502' }).action, 'wait');
  const gaveUp = decideGainers(at('2026-10-05T17:20:00Z'), null, { ok: false, why: 'HTTP 502' });
  assert.equal(gaveUp.action, 'alert'); assert.match(String(gaveUp.text), /could not run/);
});
