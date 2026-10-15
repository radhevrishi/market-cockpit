// zzz1023 — Stage Analysis made professional. Owner: "Stage analysis colors and how it's done can be improved and made a lot more
// professional — fix."
//  • method: Weinstein stages on the 30-week average with a 5-week slope and a ±1 % flatness band, the 13-week closing range as
//    the base, two weekly closes to confirm a change (dated to the first), failed breakouts / breakdowns returned to where they
//    came from, sub-stages A / B
//  • chart: calm per-theme stage colours, a light tint behind the candles + a strip along the bottom, the stage line coloured by
//    its slope (150-day average on a daily chart), label pills and breakout / breakdown levels, a two-colour Mansfield RS pane
//  • banner: "Stage 2 · Advancing · since … (N weeks) · 30-wk MA rising · RS +12 · price 8% above MA" with a details list
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stageAnalysis, stageHeadline, stageDetails, dayWords, STAGE_MEANING, STAGE_RULES, STAGE_WORDS, SUB_WORDS, STAGE_TOOLTIP, type WeekBar, type Stage } from '../stage-analysis';
import {
  STAGE_PALETTE, SLOPE_FLAT, CHART_BG, stageColor, stageFill, stageStrip, slopeColor, stageBanner, stageBannerColors, stagePointsFor,
  stageMarksFor, dailyMa150, barSpacingDays,
} from '../../components/charts/stage-view';
import { contrast } from '../readable-color';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;
const MON0 = Date.UTC(2020, 0, 6);   // a Monday
const wkIso = (i: number) => new Date(MON0 + i * 7 * DAY).toISOString().slice(0, 10);
const toWeeks = (path: number[]): WeekBar[] => path.map((c, i) => ({ wk: wkIso(i), o: c, h: c * 1.01, l: c * 0.99, c, v: i > 0 && c > path[i - 1] ? 2e6 : 1e6 }));
const flatBench = (n: number) => new Map(Array.from({ length: n }, (_, i) => [wkIso(i), 1000] as [string, number]));
const run = (path: number[]) => stageAnalysis(toWeeks(path), flatBench(path.length));

/** base 60 → advance 30 → top 40 → decline 25 → base 30 */
function cycle(): number[] {
  const p: number[] = [];
  for (let i = 0; i < 60; i++) p.push(i % 2 ? 101 : 99);
  let x = 100; for (let i = 0; i < 30; i++) { x *= 1.02; p.push(x); }
  for (let i = 0; i < 40; i++) p.push(i % 2 ? 182 : 168);
  x = 171; for (let i = 0; i < 25; i++) { x *= 0.96; p.push(x); }
  for (let i = 0; i < 30; i++) p.push(i % 2 ? 66 : 64);
  return p;
}

test('zzz1023 the full cycle 1 → 2 → 3 → 4 → 1 on Weinstein rules, each change confirmed (zzz1027: shown from the confirming week)', () => {
  const r = run(cycle());
  assert.deepEqual(r.changes!.map((c) => c.to), [1, 2, 3, 4, 1]);
  const ch = r.changes!;
  assert.equal(ch[1].beganI, 60, 'Stage 2 began in the breakout week'); assert.equal(ch[1].i, 61, '… and was confirmed by the next close');
  assert.equal(ch[1].began, wkIso(60)); assert.equal(ch[1].confirmed, wkIso(61)); assert.equal(ch[1].wk, wkIso(61));
  assert.equal(ch[1].level, 101); assert.equal(ch[1].from, 1);
  assert.equal(ch[1].volX, 1.3, 'breakout week volume ÷ the average of the 10 weeks before (2M vs 1.5M)');
  assert.equal(ch[3].level, 168, 'Stage 4 level = the support broken (13-week closing low)');
  // zzz1027 — no peeking: the new stage shows from the confirmed week; the weeks before keep the old stage (the began week pending)
  for (const c of ch.slice(1)) {
    assert.equal(r.weeks[c.i].stage, c.to); assert.notEqual(r.weeks[c.i - 1].stage, c.to);
    assert.equal(r.weeks[c.beganI].stage, c.from); assert.ok(c.i > c.beganI);
  }
  // every stage reading carries its slope, sub-stage, start and price vs the average
  const w = r.weeks[75];
  assert.equal(w.stage, 2); assert.equal(w.slope, 'rising'); assert.equal(w.since, wkIso(60)); assert.equal(w.began, wkIso(60)); assert.equal(w.confirmed, wkIso(61)); assert.equal(w.weeks, 15);
  assert.ok(w.sub === 'A' || w.sub === 'B'); assert.ok(w.vsMa! > 0);
  assert.equal(STAGE_RULES.confirmWeeks, 2); assert.equal(STAGE_RULES.slopeWeeks, 5); assert.equal(STAGE_RULES.flatPct, 1);
});

test('zzz1023 hysteresis: a single-week dip or pop does not flip the stage; the waiting change is shown as pending', () => {
  // (a) a steady advance with one sharp one-week dip: under a rising average it asks for nothing, no flicker
  const up: number[] = [];
  for (let i = 0; i < 60; i++) up.push(i % 2 ? 101 : 99);
  let x = 100; for (let i = 0; i < 40; i++) { x *= 1.015; up.push(x); }
  const dipAt = up.length;
  up.push(x * 0.75);
  for (let i = 0; i < 6; i++) { x *= 1.015; up.push(x); }
  const r = run(up);
  assert.equal(r.weeks[dipAt].stage, 2, 'the dip week is still Stage 2');
  assert.ok(r.weeks.slice(61).every((w) => w.stage === 2), 'no flicker after the breakout');
  // (b) a decline with one week popping over the falling average: Stage 1 is asked for (pending) but not taken
  const dn: number[] = [];
  for (let i = 0; i < 60; i++) dn.push(i % 2 ? 101 : 99);
  let y = 100; for (let i = 0; i < 40; i++) { y *= 0.97; dn.push(y); }
  const popAt = dn.length;
  dn.push(y * 1.7);
  for (let i = 0; i < 4; i++) { y *= 0.97; dn.push(y); }
  const d = run(dn);
  assert.equal(d.weeks[popAt - 1].stage, 4);
  assert.equal(d.weeks[popAt].stage, 4, 'the pop week is still Stage 4');
  assert.equal(d.weeks[popAt].pending, 1, 'the pop asked for Stage 1');
  assert.equal(d.weeks[popAt + 1].pending, null); assert.equal(d.weeks[popAt + 1].stage, 4);
  assert.ok(d.weeks.slice(popAt).every((w) => w.stage === 4));
  // the live (last) week waiting for its second close says so in the headline
  const live = run(dn.slice(0, popAt + 1)).last!;
  assert.equal(live.stage, 4); assert.equal(live.pending, 1);
  assert.match(stageHeadline(live), /Stage 1 needs one more weekly close$/);
  // a second close over the average confirms it: shown from the confirming week, the pop week stays Stage 4 (pending)
  const two = run([...dn.slice(0, popAt + 1), dn[popAt] * 1.02]);
  assert.equal(two.last!.stage, 1); assert.equal(two.last!.weeks, 1); assert.equal(two.weeks[popAt].stage, 4); assert.equal(two.weeks[popAt].pending, 1);
  assert.equal(two.last!.began, wkIso(popAt)); assert.equal(two.last!.confirmed, wkIso(popAt + 1));
});

test('zzz1023 a breakout that falls straight back under a flat average is a failed move (back to Stage 1), not a top', () => {
  const p: number[] = [];
  for (let i = 0; i < 60; i++) p.push(i % 2 ? 101 : 99);
  p.push(104, 105);                                // breakout, confirmed
  for (let i = 0; i < 8; i++) p.push(i % 2 ? 99.5 : 98.5);   // straight back into the base, under the flat average
  const r = run(p);
  const to = r.changes!.map((c) => c.to);
  assert.deepEqual(to, [1, 2, 1]);
  assert.equal(r.last!.stage, 1);
  assert.ok(!r.weeks.some((w) => w.stage === 3));
});

test('zzz1023 sub-stages: 2B when price runs more than 20% above the average, 4A while the fall is fast', () => {
  const r = run(cycle());
  const subs2 = new Set(r.weeks.filter((w) => w.stage === 2).map((w) => w.sub));
  assert.ok(subs2.has('A') && subs2.has('B'));
  for (const w of r.weeks) if (w.stage === 2 && w.sub === 'B') assert.ok(w.c > w.ma30! * 1.2);
  assert.ok(r.weeks.some((w) => w.stage === 4 && w.sub === 'A'));
  for (const s of [1, 2, 3, 4] as Stage[]) { assert.ok(SUB_WORDS[s].A && SUB_WORDS[s].B); assert.ok(STAGE_MEANING[s].length > 40); }
});

test('zzz1023 banner: one tidy line, details with measured values, meaning per stage', () => {
  assert.equal(dayWords('2026-08-10'), '10 Aug 2026'); assert.equal(dayWords('2026-08-10', true), '10 Aug 26');
  const r = run(cycle());
  const w2 = r.weeks[75];
  assert.equal(stageHeadline({ ...w2, sub: 'A', mrs: 12.4, vsMa: 8.2 }), `Stage 2 · Advancing · began ${dayWords(wkIso(60))} · confirmed ${dayWords(wkIso(61))} (15 weeks) · 30-wk MA rising · RS +12 · price 8% above MA`);
  assert.match(stageHeadline({ ...w2, mrs: -3.6, vsMa: -0.2, sub: 'B' }), /^Stage 2 · Advancing \(extended\) · .* · RS −4 · price at the MA$/);
  const d = stageDetails(w2);
  const labels = d.map((x) => x.label).join(' | ');
  for (const k of ['slope', 'Close vs the 30-week average', '13-week closing range', 'Structure began', 'Confirmed', 'Weeks in this stage', 'Base high broken', 'Volume in the breakout week', 'Mansfield RS', 'SATA']) assert.ok(labels.includes(k), k);
  assert.equal(d.find((x) => x.label.startsWith('Volume'))!.value, '1.3×');
  const b = stageBanner('ready', w2, true, undefined, true);
  assert.equal(b.color, stageColor(2, true)); assert.equal(b.stage, 2); assert.equal(b.meaning, STAGE_MEANING[2]);
  assert.ok(b.details!.length >= 7); assert.match(b.sub!, /^2[AB] · /);
  assert.equal(stageBanner('ready', w2, true, undefined, false).color, stageColor(2, false));
  assert.match(stageBanner('ready', null, true).text, /not enough weekly history/);
  assert.match(STAGE_TOOLTIP, /Weinstein/); assert.match(STAGE_TOOLTIP, /TheWrap/);
});

test('zzz1023 colours: four distinct calm stage colours per theme that read on both chart backgrounds', () => {
  for (const light of [true, false]) {
    const bg = CHART_BG(light);
    const cols = ([1, 2, 3, 4] as Stage[]).map((s) => stageColor(s, light));
    assert.equal(new Set(cols).size, 4);
    for (const c of cols) assert.ok(contrast(c, bg)! >= 3, `${c} on ${bg}: ${contrast(c, bg)}`);   // graphics: 3:1
    assert.ok(contrast(SLOPE_FLAT[light ? 'light' : 'dark'], bg)! >= 3);
    // banner text reads at 4.5:1 on its tint
    for (const s of [1, 2, 3, 4] as Stage[]) {
      const bc = stageBannerColors(stageColor(s, light), light);
      const a = light ? 0.1 : 0.18;
      const tint = '#' + [1, 3, 5].map((i) => Math.round(parseInt(stageColor(s, light).slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
      assert.ok(contrast(bc.text, tint)! >= 4.5, `banner text stage ${s} ${light ? 'white' : 'dark'}`);
    }
    // the background tint is faint (never hides candles), sub-stage B fainter; the strip is solid
    const alpha = (rgba: string) => Number(rgba.match(/,([\d.]+)\)$/)![1]);
    for (const s of [1, 2, 3, 4] as Stage[]) {
      assert.ok(alpha(stageFill(s, light)) <= 0.08); assert.ok(alpha(stageFill(s, light, true)) < alpha(stageFill(s, light)));
      assert.ok(alpha(stageStrip(s, light)) >= 0.8);
    }
    assert.equal(slopeColor(1, light), stageColor(2, light)); assert.equal(slopeColor(-1, light), stageColor(4, light));
    assert.equal(slopeColor(0, light), SLOPE_FLAT[light ? 'light' : 'dark']);
  }
  assert.notEqual(STAGE_PALETTE.light[2], STAGE_PALETTE.dark[2]);
});

test('zzz1023 chart points: the 150-day average on a daily chart, the 30-week average on a weekly one; marks where stages began', () => {
  const path = cycle();
  const r = run(path);
  // daily candles: five a week
  const daily: Array<{ t: number; c: number }> = [];
  path.forEach((c, w) => { for (let k = 0; k < 5; k++) daily.push({ t: MON0 + (w * 7 + k) * DAY, c }); });
  const times = daily.map((d) => d.t);
  assert.equal(barSpacingDays(times), 1);
  const ma = dailyMa150(daily);
  assert.equal(ma.size, daily.length - 149);
  const pts = stagePointsFor(times, r, ma);
  const last = pts[pts.length - 1];
  assert.equal(last[3], ma.get(new Date(times[times.length - 1]).toISOString().slice(0, 10)), 'daily chart: 150-day average');
  assert.equal(pts[0][3], null);
  // weekly candles: the 30-week average of that week, its slope as −1 / 0 / 1
  const wTimes = path.map((_, i) => Date.parse(`${wkIso(i)}T00:00:00Z`));
  const wp = stagePointsFor(wTimes, r);
  assert.equal(wp[75][3], r.weeks[75].ma30); assert.equal(wp[75][4], 1); assert.equal(wp[75][1], 2);
  // marks: a pill per change, levels only on breakouts / breakdowns
  const marks = stageMarksFor(wTimes, r);
  assert.deepEqual(marks.map((m) => m.stage), [1, 2, 3, 4, 1]);
  assert.equal(marks[1].kind, 'breakout'); assert.equal(marks[1].level, 101); assert.equal(marks[1].t, wTimes[61], 'pill at the confirmed week');
  assert.equal(marks[1].beganT, wTimes[60], 'faint "began" tick at the first qualifying week');
  assert.match(marks[1].label, /^S2 · Advancing · \d+ \w{3} \d{2}$/);
  assert.ok(marks[1].levelFrom! < marks[1].t && marks[1].levelTo! > marks[1].t);
  assert.equal(marks[3].kind, 'breakdown'); assert.equal(marks[2].kind, null); assert.equal(marks[2].level, null);
  // zzz1027 — on daily candles the mark sits on the confirming week's close (its last session), the tick on the began week's close
  assert.equal(stageMarksFor(times, r)[1].t, MON0 + (61 * 7 + 4) * DAY);
  assert.equal(stageMarksFor(times, r)[1].beganT, MON0 + (60 * 7 + 4) * DAY);
  // only the changes on screen: a chart starting at week 100 shows the Stage 3 / 4 / 1 starts, nothing piled on its first candle
  const later = stageMarksFor(wTimes.slice(100), r);
  assert.deepEqual(later.map((m) => m.stage), [3, 4, 1]);
  assert.ok(later.every((m) => m.t > wTimes[100]));
});

test('zzz1023 wiring: tint behind the candles, line / strip / pills in front, two-colour RS pane, details dropdown', () => {
  const k = read('../../components/charts/stage-kline.ts');
  assert.match(k, /name: 'MC_STAGE'[\s\S]*zLevel: -1/);
  assert.match(k, /name: 'MC_STAGE_LINE'/);
  assert.match(k, /slopeColor\(/); assert.match(k, /stageStrip\(/); assert.match(k, /setLineDash\(\[5, 4\]\)/);
  assert.match(k, /name: 'MC_MRS'[\s\S]*stageColor\(2, light\)[\s\S]*stageColor\(4, light\)/);
  const ind = read('../../components/charts/StageIndicator.tsx');
  assert.match(ind, /zLevel: -1/); assert.match(ind, /STAGE_LINE_INDICATOR/); assert.match(ind, /dailyMa150\(daily\)/);
  assert.match(ind, /data-testid="stage-details"/); assert.match(ind, /What this means/); assert.match(ind, /Measured this week/);
  assert.match(ind, /key === 'Escape'/);
});

test('zzz1023 wording: plain words, no "best", no buy / sell words in what the owner reads', () => {
  const texts = [
    read('../stage-analysis.ts'), read('../../components/charts/stage-view.ts'), read('../../components/charts/stage-kline.ts'), read('../../components/charts/StageIndicator.tsx'),
    ...Object.values(STAGE_MEANING), ...Object.values(STAGE_WORDS), STAGE_TOOLTIP,
    ...([1, 2, 3, 4] as Stage[]).flatMap((s) => [SUB_WORDS[s].A, SUB_WORDS[s].B]),
  ];
  for (const t of texts) {
    assert.doesNotMatch(t, /\bbest\b/i);
    assert.doesNotMatch(t, /\b(buy|sell|buying|selling|buyers|sellers)\b/i);
  }
});
