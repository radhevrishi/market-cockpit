// zzz1030 — three QA findings on /charts.
//  1 · Stage dates named the MONDAY of a week ("confirmed 10 August"), read as the moment the stage was known. They now name each
//      week's last trading session (its weekly close; a holiday week ends on Thursday etc.): "began wk to 7 Aug · confirmed
//      14 Aug close" in the banner, "began week ending Fri 7 Aug 2026 · confirmed at the close of Fri 14 Aug 2026" in details.
//  2 · The stage colours on real data (HAL, India · AVAV, US; daily bars from the app's chart API, saved as a fixture) change at
//      the confirming week's last session for EVERY change — not earlier, not later — on daily candles, weekly candles and the
//      chart layers (tint / strip); the began week reads the old stage with the change pending.
//  3 · Auto lines: a sloping line shows both of its values (at the reference bar and now, projected), so each % can be checked by
//      hand; a horizontal level shows one value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stageAnalysis, weeklyBars, stageHeadline, stageDetails, stageDatesText, sessionWords, weekEnd, type StageResult } from '../stage-analysis';
import { stagePointsFor, stageMarksFor, stageBanner, stageChangesList } from '../../components/charts/stage-view';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// ── 1 · wording ─────────────────────────────────────────────────────────────────

test('zzz1030 weekly bars carry their last trading session; a holiday week ends on Thursday', () => {
  // week of 3 Aug 2026 (Mon–Fri) and week of 10 Aug 2026 with Friday 14 Aug a holiday
  const d = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'];
  const w = weeklyBars({ d, c: d.map((_, i) => 100 + i) });
  assert.equal(w.length, 2);
  assert.equal(w[0].wk, '2026-08-03'); assert.equal(w[0].last, '2026-08-07');
  assert.equal(w[1].wk, '2026-08-10'); assert.equal(w[1].last, '2026-08-13', 'holiday Friday: the week closed on Thursday');
  assert.equal(weekEnd(w[1]), '2026-08-13');
  assert.equal(weekEnd({ wk: '2026-08-10' }), '2026-08-14', 'hand-made bars without sessions fall back to the Friday');
  assert.equal(sessionWords('2026-08-14'), 'Fri 14 Aug 2026');
  assert.equal(sessionWords('2026-08-13'), 'Thu 13 Aug 2026');
  assert.equal(sessionWords('2026-08-07', { weekday: false, year: false }), '7 Aug');
});

test('zzz1030 banner (short), details and hover text (long) name the weeks by their closes', () => {
  assert.equal(stageDatesText('2026-08-07', '2026-08-14', { short: true, now: '2026-10-09' }), 'began wk to 7 Aug · confirmed 14 Aug close');
  assert.equal(stageDatesText('2026-08-07', '2026-08-14'), 'began week ending Fri 7 Aug 2026 · confirmed at the close of Fri 14 Aug 2026');
  assert.equal(stageDatesText('2025-12-26', '2026-01-02', { short: true, now: '2026-10-09' }), 'began wk to 26 Dec 2025 · confirmed 2 Jan close', 'another year: the year shows');
  assert.equal(stageDatesText('2026-08-13', '2026-08-13', { short: true, now: '2026-10-09' }), 'since wk to 13 Aug');

  const w: any = { wk: '2026-10-05', end: '2026-10-09', c: 120, stage: 2, sub: 'A', weeks: 9, slope: 'rising', mrs: 12.4, vsMa: 8.2, sata: 7, comps: [],
    began: '2026-08-03', since: '2026-08-03', confirmed: '2026-08-10', beganEnd: '2026-08-07', confirmedEnd: '2026-08-14', pending: null,
    ma10: null, ma30: 110, ma40: null, hi13: 118, lo13: 100, level: 101, volX: 1.8, slopePct: 3.1 };
  assert.equal(stageHeadline(w), 'Stage 2 · Advancing · began wk to 7 Aug · confirmed 14 Aug close (9 weeks) · 30-wk MA rising · RS +12 · price 8% above MA');
  const det = stageDetails(w);
  assert.equal(det.find((x) => x.label.startsWith('Structure began'))!.value, 'week ending Fri 7 Aug 2026');
  assert.equal(det.find((x) => x.label.startsWith('Confirmed'))!.value, 'at the close of Fri 14 Aug 2026');
  // a holiday week: Thursday, from the bars, not a computed Friday
  assert.equal(stageDetails({ ...w, confirmedEnd: '2026-08-13' }).find((x) => x.label.startsWith('Confirmed'))!.value, 'at the close of Thu 13 Aug 2026');
  const b = stageBanner('ready', w, true, undefined, true);
  assert.equal(b.long, 'began week ending Fri 7 Aug 2026 · confirmed at the close of Fri 14 Aug 2026');
  // no Monday date anywhere in the texts
  for (const t of [stageHeadline(w), b.long!, ...det.map((x) => x.value)]) assert.doesNotMatch(t, /\b(3|10) Aug\b/);
});

// ── 2 · boundaries on real data ─────────────────────────────────────────────────

interface Fx { market: string; d0: number; dd: number[]; c: number[] }
const FX = JSON.parse(read('./fixtures/stage-daily-hal-avav.json')) as { tickers: Record<string, Fx> };
function dailyOf(f: Fx): { d: string[]; t: number[]; c: number[] } {
  const t: number[] = [f.d0 * DAY];
  for (const x of f.dd) t.push(t[t.length - 1] + x * DAY);
  return { d: t.map(iso), t, c: f.c };
}
/** what the chart must show on a daily bar dated `day`: the stage of the latest change confirmed at or before that session */
function expectedOn(r: StageResult, day: string): number {
  let s = 0;
  for (const ch of r.changes || []) if (ch.confirmedEnd <= day) s = ch.to;
  return s;
}
/** the chart layers (tint behind the candles, the stage line with its strip) read through a stand-in chart engine */
const CALCS: Record<string, (dataList: any[], ind: any) => any[]> = {};
async function klineCalcs(): Promise<Record<string, (dataList: any[], ind: any) => any[]>> {
  if (!Object.keys(CALCS).length) {
    const { registerStageIndicators } = await import('../../components/charts/stage-kline');
    registerStageIndicators({ registerIndicator: (tpl: any) => { CALCS[tpl.name] = tpl.calc; } } as any);
  }
  return CALCS;
}

for (const tk of ['HAL', 'AVAV']) {
  test(`zzz1030 ${tk}: every stage change shows from the confirming week's last session — daily, weekly, chart layers`, async () => {
    const f = FX.tickers[tk];
    const daily = dailyOf(f);
    const weeks = weeklyBars({ d: daily.d, c: daily.c });
    const r = stageAnalysis(weeks, null);
    const changes = (r.changes || []).filter((c) => c.from != null);
    assert.ok(changes.length >= 8, `${tk}: enough changes to check (${changes.length})`);

    // the weekly series: the began week keeps the old stage (pending the new one); the confirmed week shows the new one
    for (const ch of changes) {
      assert.equal(ch.i, ch.beganI + 1, 'two weekly closes in a row');
      assert.equal(r.weeks[ch.beganI].stage, ch.from, `${tk} ${ch.began}: began week reads the old stage`);
      assert.equal(r.weeks[ch.beganI].pending, ch.to, `${tk} ${ch.began}: … with the change pending`);
      assert.equal(r.weeks[ch.i].stage, ch.to);
      assert.equal(r.weeks[ch.i].weeks, 1, 'weeks count from the confirmed week');
      assert.equal(ch.confirmedEnd, weeks[ch.i].last, 'confirmed = the last session of that week, from the bars');
      assert.equal(ch.beganEnd, weeks[ch.beganI].last);
      assert.ok(daily.d.includes(ch.confirmedEnd), 'a real trading session');
    }

    // daily candles: before the confirming session the old stage, from it the new one — for every bar, every change
    const pts = stagePointsFor(daily.t, r);
    let bad = 0;
    for (let i = 0; i < daily.t.length; i++) if (pts[i][1] !== expectedOn(r, daily.d[i])) bad++;
    assert.equal(bad, 0, `${tk}: daily bars whose stage colour disagrees with the confirmation dates`);
    for (const ch of changes) {
      const j = daily.d.indexOf(ch.confirmedEnd);
      assert.equal(pts[j][1], ch.to, `${tk} ${ch.confirmedEnd}: new stage from the confirming close`);
      if (j > 0) assert.equal(pts[j - 1][1], ch.from, `${tk} ${daily.d[j - 1]}: the session before still the old stage`);
    }

    // weekly candles (Monday timestamps): the candle of each week shows that week's reading
    const wT = weeks.map((w) => Date.parse(`${w.wk}T00:00:00Z`));
    const wp = stagePointsFor(wT, r);
    for (const ch of changes) { assert.equal(wp[ch.beganI][1], ch.from); assert.equal(wp[ch.i][1], ch.to); }

    // pills and ticks: on the confirming / began week's last session; the label names that close
    const marks = stageMarksFor(daily.t, r);
    for (const ch of changes) {
      const m = marks.find((x) => x.confirmed === ch.confirmed && x.stage === ch.to)!;
      assert.ok(m, `${tk} ${ch.confirmed}: a pill`);
      assert.equal(iso(m.t), ch.confirmedEnd);
      if (m.beganT != null) assert.equal(iso(m.beganT), ch.beganEnd);
      assert.match(m.label, / close$/);
      assert.equal(m.confirmedEnd, ch.confirmedEnd);
    }

    // the chart layers (tint + strip) take the same per-bar stage
    const calcs = await klineCalcs();
    const dataList = daily.t.map((t) => ({ timestamp: t }));
    const tint = calcs.MC_STAGE(dataList, { extendData: { points: pts } });
    const line = calcs.MC_STAGE_LINE(dataList, { extendData: { points: pts } });
    for (let i = 0; i < daily.t.length; i++) {
      const e = expectedOn(r, daily.d[i]);
      assert.equal(tint[i].s ?? 0, e, `${tk} ${daily.d[i]}: tint`);
      assert.equal(line[i].s ?? 0, e, `${tk} ${daily.d[i]}: strip`);
    }

    // the changes list names the closes
    const list = stageChangesList(r.changes, 100);
    assert.ok(list.length >= changes.length);
    const lastCh = changes[changes.length - 1];
    assert.ok(list[0].includes(`confirmed at the close of ${sessionWords(lastCh.confirmedEnd)}`), list[0]);
  });
}

test('zzz1030 real data has holiday weeks: a confirming close that is not a Friday is named by its own weekday', () => {
  let nonFri = 0;
  for (const tk of ['HAL', 'AVAV']) {
    const daily = dailyOf(FX.tickers[tk]);
    const r = stageAnalysis(weeklyBars({ d: daily.d, c: daily.c }), null);
    for (const ch of r.changes || []) {
      const wd = new Date(`${ch.confirmedEnd}T00:00:00Z`).getUTCDay();
      assert.ok(wd >= 1 && wd <= 6, 'a trading session (NSE traded on Saturday 1 Feb 2025, Budget day)');
      if (wd !== 5) { nonFri++; assert.ok(stageChangesList([ch])[0].includes(sessionWords(ch.confirmedEnd))); }
    }
  }
  // HAL: Stage 2 → 1 confirmed Thu 9 Apr 2020 (Good Friday) and Stage 3 → 4 on Sat 1 Feb 2025 (Budget-day session)
  assert.ok(nonFri >= 2, `confirming closes off a Friday: ${nonFri}`);
});

// ── 3 · auto lines: both values of a sloping line ───────────────────────────────

test('zzz1030 auto lines: a sloping line shows its value at the completed close and now (projected); each % checks out by hand', async () => {
  const { autoLines } = await import('../auto-lines');
  const { alnRef, autoLinesRows, measureLine, alnLineValues } = await import('../../components/charts/auto-lines-view');
  const lineAt = (i: number) => 100 + 0.2 * i;
  const T0 = Date.UTC(2024, 0, 1);
  const done = Array.from({ length: 130 }, (_, i) => {
    const c = lineAt(i) + 0.5 + 10 * Math.abs(Math.sin((Math.PI * (i - 20)) / 40));
    return { t: T0 + i * DAY, o: c, h: c + 0.5, l: c - 0.5, c, v: 1e6 };
  });
  const r = autoLines(done, { tf: 'D' });
  const sup = r.trend.find((l) => l.kind === 'support')!;
  assert.ok(sup);
  const forming = { ...done[129], t: done[129].t + DAY, c: lineAt(130) - 3, l: lineAt(130) - 3.5 };
  const ref = alnRef(done, [...done, forming])!;
  const row = autoLinesRows(done, r, 'D', 2, ref, '$').find((x) => x.id.startsWith('t:support'))!;
  const re = /line at the (\d+ \w{3}) close: \$([\d,.]+) \(\1 close \$([\d,.]+) is ([\d.]+)% (above|below)\) · line now \(projected to the latest bar\): \$([\d,.]+) \(latest \$([\d,.]+) is ([\d.]+)% (above|below)\) — provisional breach \(day not closed\)/;
  const m = re.exec(row.detail);
  assert.ok(m, row.detail);
  const n = (x: string) => Number(x.replace(/,/g, ''));
  const [lineClose, close, pc, lineNow, latest, pl] = [n(m![2]), n(m![3]), n(m![4]), n(m![6]), n(m![7]), n(m![8])];
  // reproduce each % from the shown numbers (rounded to 2 decimals → within 0.1 point)
  assert.ok(Math.abs(Math.abs(close / lineClose - 1) * 100 - pc) < 0.1, 'close % from the line at the close');
  assert.ok(Math.abs(Math.abs(latest / lineNow - 1) * 100 - pl) < 0.1, 'latest % from the line now');
  assert.equal(m![5], 'above'); assert.equal(m![9], 'below');
  assert.ok(lineNow > lineClose, 'a rising line is higher one bar later');
  assert.ok(Math.abs(lineClose - lineAt(129)) < 0.6 && Math.abs(lineNow - lineAt(130)) < 0.6);
  // the provisional-breach logic is unchanged
  assert.equal(row.prov, true); assert.equal(measureLine(sup, ref, 129).status, 'provisional');
  // hover tooltip: one line per value
  assert.match(row.tip, /\nLine at the \d+ \w{3} close: \$[\d.]+ \(/);
  assert.match(row.tip, /\nLine now \(projected to the latest bar\): \$[\d.]+ \(latest /);
  // one price (no forming candle): one value
  const one = autoLinesRows(done, r, 'D', 2, alnRef(done, done), '$').find((x) => x.id.startsWith('t:support'))!;
  assert.match(one.detail, /· line at the \d+ \w{3} close: \$[\d.]+ \(\d+ \w{3} close \$[\d.]+ is [\d.]+% above\) · /);
  assert.doesNotMatch(one.detail + one.tip, /line now|latest/i);
  // the spec example's shape (monthly)
  const mref = { closeT: Date.UTC(2026, 8, 1), close: 142.22, latestT: Date.UTC(2026, 9, 1), latest: 120.6, forming: true };
  const v = alnLineValues({ closeDist: (142.22 / 131.4 - 1) * 100, latestDist: (120.6 / 132.1 - 1) * 100, lineNow: 132.1, lineAtClose: 131.4, status: 'provisional' }, mref, 'M', 2, '');
  assert.equal(v.atClose, 'line at the Sep close: 131.40 (Sep close 142.22 is 8.2% above)');
  assert.equal(v.now, 'line now (projected to the latest bar): 132.10 (latest 120.60 is 8.7% below) — provisional breach (month not closed)');
});

test('zzz1030 auto lines: a horizontal level shows one value and names both prices; chart tags stay short', async () => {
  const { autoLinesRows, alnRef } = await import('../../components/charts/auto-lines-view');
  const M = (i: number) => Date.UTC(2020, i, 1);
  const done = Array.from({ length: 81 }, (_, i) => ({ t: M(i), o: 140, h: 141, l: 139, c: i === 80 ? 142.1 : 140 }));
  const lvl: any = { kind: 'support', price: 131.03, touches: [{ i: 5, price: 131.03 }, { i: 15, price: 131.03 }, { i: 25, price: 131.03 }], firstTouch: 5, lastTouch: 25, flips: 0, distPct: (142.1 / 131.03 - 1) * 100, strength: 60 };
  const ref = alnRef(done, [...done, { t: M(81), c: 120.6 }])!;
  const row = autoLinesRows(done, { trend: [], levels: [lvl], log: false, tolPct: 0.01 }, 'M', 2, ref, '$')[0];
  assert.equal(row.title, 'Support level 131.03 (provisional breach)');
  assert.match(row.detail, /Sep close \$142\.10 is 8\.4% above · latest \$120\.60 is 8\.0% below — provisional breach \(month not closed\)/);
  assert.doesNotMatch(row.detail, /line now|projected/);
  // Clean-mode right-edge tags: short (touch count; a level its price)
  const k = read('../../components/charts/auto-lines-kline.ts');
  assert.ok(k.includes('text: lineTagText(ln.kind, ln.n, !!ln.prov)'));   // zzz1037 — 'S line · 3 touches'
});

test('zzz1030 wording: plain words, no "best", no buy / sell words', () => {
  for (const f of ['../stage-analysis.ts', '../../components/charts/stage-view.ts', '../../components/charts/stage-kline.ts', '../../components/charts/StageIndicator.tsx', '../../components/charts/auto-lines-view.ts']) {
    const t = read(f);
    assert.doesNotMatch(t, /\bbest\b/i, f);
    assert.doesNotMatch(t, /\b(buy|sell|buying|selling)\b/i, f);
  }
});

test('zzz1030 auto lines: one level = one right-edge tag (QA: two identical "×9 4,604.76" tags on HAL daily, Clean)', async () => {
  const { dedupeAlnTags, alnPayload, DEFAULT_ALN_PREFS } = await import('../../components/charts/auto-lines-view');
  const { mergeLevelTags, placeEdgeTags } = await import('../chart-display');
  const lv = { id: 'l:support:4604.76', y: 200, price: 4604.76, n: 9, kind: 'support' as const, text: '×9  4,604.76', color: '#0B8A73' };
  const twin = { ...lv };                                                     // the same level twice
  const role = { ...lv, id: 'l:resistance:4604.76', kind: 'resistance' as const, n: 7, text: '×7  4,604.76' };   // same price, other role
  const line = { id: 't:support:10:40', y: 201, price: 4604.9, n: 4, kind: 'support' as const, text: '×4', color: '#0B8A73' };
  const d = dedupeAlnTags([lv, twin, role, line], 2);
  assert.deepEqual(d.map((t) => t.id), ['l:support:4604.76', 't:support:10:40'], 'one tag per level price; a trendline kept');
  assert.equal(d[0].n, 9);
  // through the Clean merge and placement: no two identical tag texts
  for (const mode of ['clean', 'research'] as const) {
    const reqs = mergeLevelTags(dedupeAlnTags([lv, twin], 2).map((t) => ({ ...t, priority: 50 })), { mode, fmt: (n) => n.toFixed(2) });
    const { placed } = placeEdgeTags(reqs, { mode, gap: 17, min: 8, max: 500 });
    assert.equal(placed.length, 1, mode);
    assert.equal(placed[0].text, '×9  4,604.76');
  }
  // the payload: a level price listed twice by the reading is drawn once
  const bars = Array.from({ length: 40 }, (_, i) => ({ t: Date.UTC(2026, 0, 1 + i) }));
  const L: any = { kind: 'support', price: 4604.76, touches: [{ i: 5, price: 4604.76 }, { i: 15, price: 4604.76 }, { i: 25, price: 4604.76 }], firstTouch: 5, lastTouch: 25, flips: 0, distPct: 2, strength: 60 };
  const p = alnPayload(bars, { trend: [], levels: [L, { ...L }], log: false, tolPct: 0.01 }, DEFAULT_ALN_PREFS, true, 2, null);
  assert.equal(p.levels.length, 1);
  // the chart layer dedupes its tags, and the hook removes any earlier copy of the layer right before creating it
  assert.match(read('../../components/charts/auto-lines-kline.ts'), /dedupeAlnTags\(tags, ext\.decimals\)/);
  assert.match(read('../../components/charts/AutoLinesIndicator.tsx'), /clear\(\);\n\s+try \{ chart\.createIndicator\(\{ name: ALN_INDICATOR/);
});
