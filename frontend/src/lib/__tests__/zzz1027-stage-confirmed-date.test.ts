// zzz1027 — QA finding: two weekly closes confirm a stage change, but the change was dated to the FIRST qualifying week, as if
// the stage had been knowable a week earlier than it was. Now each change keeps two dates: `began` (first week that met the rule)
// and `confirmed` (the second close, when it became known). History, chart colours, pills and the week count follow the
// confirmed week; the began week keeps the old stage with the change pending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stageAnalysis, stageHeadline, stageDetails, dayWords, type WeekBar } from '../stage-analysis';
import { stagePointsFor, stageMarksFor, stageBanner } from '../../components/charts/stage-view';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;
const MON0 = Date.UTC(2020, 0, 6);   // a Monday
const wkIso = (i: number) => new Date(MON0 + i * 7 * DAY).toISOString().slice(0, 10);
const toWeeks = (path: number[]): WeekBar[] => path.map((c, i) => ({ wk: wkIso(i), o: c, h: c * 1.01, l: c * 0.99, c, v: i > 0 && c > path[i - 1] ? 2e6 : 1e6 }));
const flatBench = (n: number) => new Map(Array.from({ length: n }, (_, i) => [wkIso(i), 1000] as [string, number]));
/** a 60-week flat base, then a steady advance */
function basePlusAdvance(up: number): number[] {
  const p: number[] = [];
  for (let i = 0; i < 60; i++) p.push(i % 2 ? 101 : 99);
  let x = 100; for (let i = 0; i < up; i++) { x *= 1.02; p.push(x); }
  return p;
}
const K = 60;   // the breakout week

test('zzz1027 1 → 2: began = week k, confirmed = week k+1; week k still reads the old stage with the change pending', () => {
  const r = stageAnalysis(toWeeks(basePlusAdvance(12)), flatBench(72));
  const ch = r.changes!.find((c) => c.to === 2)!;
  assert.equal(ch.from, 1);
  assert.equal(ch.beganI, K); assert.equal(ch.began, wkIso(K));
  assert.equal(ch.i, K + 1); assert.equal(ch.confirmed, wkIso(K + 1)); assert.equal(ch.wk, ch.confirmed);
  // week k: still Stage 1, Stage 2 waiting for its second close (history never shows Stage 2 before it was known)
  assert.equal(r.weeks[K].stage, 1); assert.equal(r.weeks[K].pending, 2);
  // week k+1: Stage 2, week 1 counted from the confirmed week, both dates carried
  const w = r.weeks[K + 1];
  assert.equal(w.stage, 2); assert.equal(w.weeks, 1); assert.equal(w.pending, null);
  assert.equal(w.began, wkIso(K)); assert.equal(w.confirmed, wkIso(K + 1));
  assert.equal(r.last!.weeks, 72 - (K + 1), 'weeks counted from the confirmed week');
  // with only the breakout week in the data, the live reading is Stage 1 with Stage 2 pending
  const live = stageAnalysis(toWeeks(basePlusAdvance(1)), flatBench(61)).last!;
  assert.equal(live.stage, 1); assert.equal(live.pending, 2);
  assert.match(stageHeadline(live), /Stage 2 needs one more weekly close$/);
});

test('zzz1027 banner and details say both dates in plain words', () => {
  const r = stageAnalysis(toWeeks(basePlusAdvance(12)), flatBench(72));
  const w = { ...r.last!, mrs: 5, vsMa: 10, sub: 'A' as const };
  const head = stageHeadline(w);
  assert.equal(head, `Stage 2 · Advancing · began ${dayWords(wkIso(K))} · confirmed ${dayWords(wkIso(K + 1))} (11 weeks) · 30-wk MA rising · RS +5 · price 10% above MA`);
  assert.ok(stageHeadline({ ...w, began: '2026-08-03', since: '2026-08-03', confirmed: '2026-08-10', weeks: 10 })
    .startsWith('Stage 2 · Advancing · began 3 Aug 2026 · confirmed 10 Aug 2026 (10 weeks) · '));
  const d = stageDetails(w);
  const get = (s: string) => d.find((x) => x.label.startsWith(s));
  assert.equal(get('Structure began: first week that met the rule')!.value, dayWords(wkIso(K)));
  assert.equal(get('Confirmed: the second weekly close — the stage was only known then')!.value, dayWords(wkIso(K + 1)));
  assert.equal(get('Weeks in this stage (counted from the confirmed week)')!.value, '11');
  assert.match(stageBanner('ready', w, true).text, /began .* · confirmed .* \(11 weeks\)/);
  // the first reading (no change seen yet) has no confirmation step: one date
  const first = stageAnalysis(toWeeks(basePlusAdvance(0)), flatBench(60)).last!;
  assert.equal(first.began, first.confirmed);
  assert.match(stageHeadline(first), /^Stage 1 · Basing · since \d+ \w{3} \d{4} \(\d+ weeks\)/);
  assert.ok(stageDetails(first).some((x) => x.label.startsWith('First reading')));
});

test('zzz1027 chart: pill at the confirmed week, faint "began" tick; daily candles map to the weekly close', () => {
  const path = basePlusAdvance(12);
  const r = stageAnalysis(toWeeks(path), flatBench(path.length));
  // weekly candles
  const wT = path.map((_, i) => MON0 + i * 7 * DAY);
  const wm = stageMarksFor(wT, r).find((m) => m.stage === 2)!;
  assert.equal(wm.t, wT[K + 1]); assert.equal(wm.beganT, wT[K]);
  assert.equal(wm.label, `S2 · Advancing · ${dayWords(wkIso(K + 1), true)}`);
  const wp = stagePointsFor(wT, r);
  assert.equal(wp[K][1], 1, 'the began week candle keeps the old colour'); assert.equal(wp[K + 1][1], 2);
  // daily candles (Mon–Fri)
  const dT: number[] = [];
  path.forEach((_, w) => { for (let k = 0; k < 5; k++) dT.push(MON0 + (w * 7 + k) * DAY); });
  const dm = stageMarksFor(dT, r).find((m) => m.stage === 2)!;
  assert.equal(dm.t, MON0 + ((K + 1) * 7 + 4) * DAY, 'confirmed → the Friday close of that week');
  assert.equal(dm.beganT, MON0 + (K * 7 + 4) * DAY);
  const dp = stagePointsFor(dT, r);
  for (let d = 0; d < 5; d++) assert.equal(dp[K * 5 + d][1], 1);
  for (let d = 0; d < 4; d++) assert.equal(dp[(K + 1) * 5 + d][1], 1, 'Mon–Thu of the confirming week: not known yet');
  assert.equal(dp[(K + 1) * 5 + 4][1], 2, 'from the weekly close');
  // a short (holiday) week: the last session on screen is the close
  const short = dT.filter((t) => t !== MON0 + ((K + 1) * 7 + 4) * DAY);
  assert.equal(stageMarksFor(short, r).find((m) => m.stage === 2)!.t, MON0 + ((K + 1) * 7 + 3) * DAY);
  // the chart started after the began week: the pill still shows, no tick
  const late = stageMarksFor(wT.slice(K + 1), r).find((m) => m.stage === 2)!;
  assert.equal(late.t, wT[K + 1]); assert.equal(late.beganT, null);
  // the kline layer draws the tick
  assert.match(read('../../components/charts/stage-kline.ts'), /m\.beganT/);
});

test('zzz1027 wording: plain words, no "best", no buy / sell words', () => {
  const texts = [read('../stage-analysis.ts'), read('../../components/charts/stage-view.ts'), read('../../components/charts/stage-kline.ts'), read('../../components/charts/StageIndicator.tsx')];
  for (const t of texts) {
    assert.doesNotMatch(t, /\bbest\b/i);
    assert.doesNotMatch(t, /\b(buy|sell|buying|selling|buyers|sellers)\b/i);
  }
  assert.match(read('../../components/charts/StageIndicator.tsx'), /confirmed&rdquo; is the second close/);
});
