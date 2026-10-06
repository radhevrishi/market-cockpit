// zzz913 — Daily Gainers Brief moved from a Claude scheduled task into the app. No network: pure functions + fake job ctx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  briefDecision, backupDecision, previousSessionDates, boardDelta, briefRows, composeBrief, researchStateKey, boardTickersOf,
  neutralText, isFinalBriefSlot, BRIEF_FINAL_SLOT, gainersBriefJob, gainersInBackupJob, type BriefResearch,
} from '../gainers-brief';
import { APP_JOBS, parseCron, slotWindowMs, lockTtlSec, prevSlot } from '../app-scheduler';

const at = (iso: string) => new Date(iso);
const today = { date: '2026-10-06', state: 'closed', isToday: true, label: 'Tue 06 Oct 2026 — today\'s closed session' };

function research(over: Partial<BriefResearch> = {}): BriefResearch {
  return {
    date: '2026-10-06', session: today, coverage: { researched: 4, total: 5, pct: 80 }, remaining: 1, updated_at: '2026-10-06T11:20:00Z',
    universe: [
      { ticker: 'SMALLA', company: 'Small A Ltd', movePct: 4.1, marketCap: 900 },
      { ticker: 'MIDB', company: 'Mid B Ltd', movePct: 12.5, marketCap: 12_000 },
      { ticker: 'BIGC', company: 'Big C Ltd', movePct: 6.0, marketCap: 45_000 },     // large cap: never in the brief
      { ticker: 'UNKD', company: 'Unknown Size', movePct: 8.0, marketCap: null },      // unknown size: kept
      { ticker: 'TODO', company: 'Not Yet', movePct: 19.0, marketCap: 500 },
    ],
    findings: { SMALLA: { status: 'catalyst' }, MIDB: { status: 'none' }, BIGC: { status: 'catalyst' }, UNKD: { status: 'negative' } },
    view: {
      top3: [{ ticker: 'SMALLA', eventClass: 'CONFIRMED_MATERIAL', primaryStatus: 'confirmed', priority: 80, headline: 'Order of ₹120 Cr from NTPC <5% of revenue> — analysts say BUY', whyResearch: 'Fresh order, material vs revenue', sourceUrl: 'https://www.bseindia.com/x.pdf', portfolio: { relevance: 'HOLDING' } }],
      noCatalyst: [{ ticker: 'MIDB', eventClass: 'NO_CATALYST', priority: 10, headline: 'No filing in the window' }],
      negative: [{ ticker: 'UNKD', eventClass: 'NEGATIVE', primaryStatus: 'negative', priority: 50, headline: 'Tax demand of ₹40 Cr', whyResearch: 'Large vs equity' }],
    },
    ...over,
  };
}

test('send decision: complete sweep sends; incomplete waits, except the last slot sends PARTIAL; no session → skip', () => {
  assert.equal(briefDecision({ session: today, coverage: { researched: 5, total: 5, pct: 100 }, remaining: 0 }, false), 'send');
  assert.equal(briefDecision({ session: today, coverage: { researched: 4, total: 5, pct: 80 }, remaining: 1 }, false), 'defer');
  assert.equal(briefDecision({ session: today, coverage: { researched: 4, total: 5, pct: 80 }, remaining: 1 }, true), 'send_partial');
  assert.equal(briefDecision(null, true), 'send_partial');                    // the research store did not answer: still send
  assert.equal(briefDecision(null, false), 'defer');
  assert.equal(briefDecision({ session: { ...today, isToday: false, state: 'holiday' }, coverage: null }, true), 'skip_no_session');
});

test('backup sweep: only when GitHub’s run is missing or stalled, never on top of a running one', () => {
  const now = at('2026-10-06T11:41:00Z');
  assert.equal(backupDecision({ session: today, coverage: { researched: 0, total: 0, pct: 0 }, remaining: 0 }, now), 'run');
  assert.equal(backupDecision({ session: today, coverage: { researched: 9, total: 9, pct: 100 }, remaining: 0 }, now), 'skip_complete');
  assert.equal(backupDecision({ session: today, coverage: { researched: 3, total: 9, pct: 33 }, remaining: 6, updated_at: '2026-10-06T11:35:00Z' }, now), 'skip_in_progress');
  assert.equal(backupDecision({ session: today, coverage: { researched: 3, total: 9, pct: 33 }, remaining: 6, updated_at: '2026-10-06T11:00:00Z' }, now), 'run');
  assert.equal(backupDecision({ session: { ...today, isToday: false }, coverage: null }, now), 'skip_no_session');
});

test('previous sessions skip weekends and named holidays', () => {
  assert.deepEqual(previousSessionDates('2026-10-06', 3), ['2026-10-05', '2026-10-02', '2026-10-01']);
  assert.deepEqual(previousSessionDates('2026-10-06', 2, (d) => d === '2026-10-02'), ['2026-10-05', '2026-10-01']);
});

test('board changes: new, dropped, and 3+ sessions in a row; an unstored session stops the streak', () => {
  const d = boardDelta(['A', 'B', 'C'], [
    { date: '2026-10-05', tickers: ['A', 'B', 'X'] },
    { date: '2026-10-02', tickers: ['A', 'B'] },
    { date: '2026-10-01', tickers: null },
    { date: '2026-09-30', tickers: ['A'] },
  ]);
  assert.equal(d.known, true);
  assert.deepEqual(d.newToday, ['C']);
  assert.deepEqual(d.dropped, ['X']);
  assert.deepEqual(d.sustained, [{ ticker: 'A', sessions: 3 }, { ticker: 'B', sessions: 3 }]);
  const u = boardDelta(['A'], [{ date: '2026-10-05', tickers: null }]);
  assert.equal(u.known, false);
  assert.deepEqual(u.newToday, []);
  assert.deepEqual(boardTickersOf({ universe: [{ ticker: 'a', marketCap: 100 }, { ticker: 'big', marketCap: 50_000 }] }), ['A']);
  assert.equal(boardTickersOf(null), null);
});

test('rows: small/mid only (unknown size kept), ranked by evidence, never by the move', () => {
  const rows = briefRows(research());
  assert.deepEqual(rows.map((r) => r.ticker), ['SMALLA', 'UNKD', 'MIDB', 'TODO']);   // TODO moved most but is unresearched
  assert.ok(!rows.some((r) => r.ticker === 'BIGC'));
  assert.equal(rows.find((r) => r.ticker === 'TODO')!.status, 'not_researched');
  assert.equal(rows.find((r) => r.ticker === 'SMALLA')!.held, true);
});

test('brief: coverage fraction, PARTIAL subject, no "<" or URL in text, every link an anchor, no rating words', () => {
  const b = composeBrief(research(), { date: '2026-10-06', partial: true, history: [{ date: '2026-10-05', tickers: ['MIDB', 'GONE'] }], appUrl: 'https://app.example', note: 'the research sweep covered 4/5 names by the last send time.' });
  assert.equal(b.subject, 'PARTIAL — Daily Gainers Brief — 06 Oct 2026');
  assert.match(b.text, /^Closing data, 06 Oct 2026\./);
  assert.match(b.text, /Catalyst coverage 3\/4 = 75%/);                       // the large cap is not counted
  assert.ok(!b.text.includes('<'), 'plain text has no "<"');
  assert.ok(!/https?:\/\//.test(b.text), 'plain text has no URLs');
  assert.ok(!/\b(BUY|SELL)\b/.test(b.text + b.html), 'no rating word as a call');
  assert.match(b.text, /new today \(3\): SMALLA, UNKD, TODO/);
  assert.match(b.text, /dropped off since the last session \(1\): GONE/);
  assert.match(b.text, /NOT YET RESEARCHED \(1\): TODO/);
  // every URL in the HTML sits inside href="…", never as visible text
  const visible = b.html.replace(/href="[^"]*"/g, '');
  assert.ok(!/https?:\/\//.test(visible), 'no bare URL in the email body');
  assert.match(b.html, /<a href="https:\/\/www\.bseindia\.com\/x\.pdf"[^>]*>filing<\/a>/);
  assert.match(b.html, /background:#ffffff/);
  assert.ok(!/background:#(0|1|2)[0-9a-f]{5}/i.test(b.html), 'no dark fills');
  const full = composeBrief(research({ remaining: 0 }), { date: '2026-10-06', partial: false, history: [] });
  assert.equal(full.subject, 'Daily Gainers Brief — 06 Oct 2026');
  assert.match(full.text, /previous session’s board is not stored/);
  const empty = composeBrief(null, { date: '2026-10-06', partial: true, history: [], note: 'no research sweep was stored' });
  assert.match(empty.text, /No research is stored/);
  assert.equal(neutralText('a <b> STRONG BUY'), 'a ‹b› strong buy');
});

test('history key is the research route’s own store key', () => {
  const src = readFileSync(join(__dirname, '../../app/api/v1/ai-gainers/research/route.ts'), 'utf8');
  assert.ok(src.includes('const KEY = (m: string, d: string) => `ai-gainers:research:v1:${m}:${d}`;'));
  assert.equal(researchStateKey('IN', '2026-10-06'), 'ai-gainers:research:v1:IN:2026-10-06');
});

test('scheduler: both jobs registered at the end, odd minutes, lock shorter than every window, final slot is 13:31', () => {
  const tail = APP_JOBS.slice(-2).map((j) => j.name);
  assert.deepEqual(tail, ['gainers-in-backup', 'gainers-brief-in']);
  for (const j of APP_JOBS.slice(-2)) {
    for (const c of j.crons) { assert.ok(parseCron(c)); assert.equal(Number(c.split(' ')[0]) % 2, 1, `${j.name}: odd minute`); }
    let s = prevSlot(j.crons, at('2026-10-05T00:00:00Z'))!;
    for (let k = 0; k < 40; k++) { assert.ok(slotWindowMs(j, s) > lockTtlSec(j) * 1000); s = prevSlot(j.crons, new Date(s.getTime() + 7 * 86_400_000))!; }
  }
  const brief = APP_JOBS.find((j) => j.name === 'gainers-brief-in')!;
  assert.ok(brief.crons.includes(BRIEF_FINAL_SLOT));
  assert.equal(isFinalBriefSlot(at('2026-10-06T13:31:00Z')), true);
  assert.equal(isFinalBriefSlot(at('2026-10-06T11:57:00Z')), false);
  // the backup runs after GitHub's 10:50 sweep, and the brief's first slot after the backup
  assert.equal(APP_JOBS.find((j) => j.name === 'gainers-in-backup')!.crons[0], '41 11 * * 1-5');
});

function fakeCtx(slot: Date, answer: (p: string, o: any) => { status: number; json?: any }) {
  const calls: Array<{ p: string; o: any }> = [];
  return {
    calls,
    ctx: {
      slot, deadline: Date.now() + 600_000, sleep: async () => {}, log: () => {},
      call: async (p: string, o: any = {}) => { calls.push({ p, o }); const a = answer(p, o); return { status: a.status, ok: a.status >= 200 && a.status < 300, json: a.json ?? null, text: '', error: null }; },
    },
  };
}

test('brief job: final=1 only on the last slot; a 503 (not delivered) is a failed run', async () => {
  const a = fakeCtx(at('2026-10-06T11:57:00Z'), () => ({ status: 200, json: { decision: 'defer' } }));
  assert.equal((await gainersBriefJob(a.ctx)).ok, true);
  assert.match(a.calls[0].p, /final=0$/);
  const b = fakeCtx(at('2026-10-06T13:31:00Z'), () => ({ status: 503, json: { sent: false } }));
  assert.equal((await gainersBriefJob(b.ctx)).ok, false);
  assert.match(b.calls[0].p, /final=1$/);
});

test('backup job: skips a complete sweep; otherwise sweeps without re-processing', async () => {
  const done = fakeCtx(at('2026-10-06T11:41:00Z'), () => ({ status: 200, json: { ok: true, session: today, coverage: { researched: 5, total: 5 }, remaining: 0 } }));
  await gainersInBackupJob(done.ctx);
  assert.equal(done.calls.length, 1);
  const miss = fakeCtx(at('2026-10-06T11:41:00Z'), (p, o) => {
    if (p.startsWith('/api/v1/ai-gainers/research?')) return { status: 200, json: { ok: true, session: today, coverage: { researched: 0, total: 0 }, remaining: 0 } };
    if (p.startsWith('/api/v1/ai-gainers?')) return { status: 200, json: { scanned: [{ ticker: 'AAA', move_pct: 9 }] } };
    return { status: 200, json: { remaining: 0, researched_now: 1 } };
  });
  assert.equal((await gainersInBackupJob(miss.ctx, () => at('2026-10-06T11:41:00Z'))).ok, true);
  const post = miss.calls.find((c) => c.o?.method === 'POST')!;
  assert.equal(post.o.body.market, 'IN');
  assert.equal(post.o.body.reprocess, undefined);
  assert.equal(post.o.retry, false);   // paid-AI call: never retried by the scheduler
});
