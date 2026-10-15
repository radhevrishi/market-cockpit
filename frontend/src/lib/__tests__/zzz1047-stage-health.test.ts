// zzz1047 — Stage 2 health: a confirmed Stage 2 that is breaking down (STRL, Oct 2026: Stage 2 for 75 weeks, SATA 1/10, RS −6,
// price under its averages, far off its high) is flagged without changing the stage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stageAnalysis, stageHealth, stageHealthText, stageHeadline, stageDetails, type StageWeek, type WeekBar } from '../stage-analysis';
import { stageBanner } from '../../components/charts/stage-view';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { WORKFLOWS } from '../screener/pine-view';
import { TV_ROW_KEYS, SETUP_VERSION } from '../screener/pine';

const root = join(__dirname, '..', '..');
const base: StageWeek = { wk: '2026-10-05', c: 100, ma10: 95, ma30: 90, ma40: 88, hi13: 99, lo13: 80, mrs: 5, comps: [], sata: 8, stage: 2, weeks: 20, slopePct: 3, slope: 'rising', vsMa: 11, ddPct: -3 };

test('healthy Stage 2: no warning, headline unchanged', () => {
  const h = stageHealth(base)!;
  assert.equal(h.level, 'ok'); assert.equal(h.code, 2);
  assert.equal(stageHealthText(h), '');
  assert.ok(!/weakening|losing/.test(stageHeadline(base)));
});

test('STRL-like Stage 2: SATA 1, below the 30-week MA, 57% off the high → weakening, stage stays 2', () => {
  const strl: StageWeek = { ...base, c: 430, ma10: 480, ma30: 520, sata: 1, mrs: -6.1, slope: 'rising', vsMa: -17.3, ddPct: -57, weeks: 75 };
  const h = stageHealth(strl)!;
  assert.equal(h.level, 'weak'); assert.equal(h.code, 0);
  assert.deepEqual(h.warnings, ['SATA 1/10', 'close 17% below the 30-wk MA', '57% off the stage high']);
  assert.match(stageHealthText(h), /^Stage 2 weakening — topping risk: SATA 1\/10/);
  assert.match(stageHeadline(strl), /^Stage 2 · Advancing — ⚠ weakening — topping risk/);
  assert.ok(stageDetails(strl).some((d) => d.label.startsWith('Stage 2 health') && d.ok === false));
  const b = stageBanner('ready', strl, true, undefined, true);
  assert.equal(b.health?.level, 'weak');
  assert.equal(b.stage, 2, 'the stage itself is not changed');
});

test('one warning alone = losing momentum; two cautions = losing momentum; one warning + two cautions = weakening', () => {
  assert.equal(stageHealth({ ...base, sata: 3 })!.level, 'caution');
  assert.equal(stageHealth({ ...base, c: 94, mrs: -1 })!.level, 'caution');   // below 10-wk MA + RS < 0
  assert.equal(stageHealth({ ...base, sata: 3, c: 94, mrs: -1 })!.level, 'weak');
  assert.equal(stageHealth({ ...base, ddPct: -20 })!.level, 'ok', 'one caution alone is still healthy');
});

test('outside Stage 2 there is no health reading', () => {
  for (const s of [1, 3, 4] as const) assert.equal(stageHealth({ ...base, stage: s }), null);
  assert.equal(stageHealth(null), null);
});

test('the engine records the drop from the stage\'s highest weekly close', () => {
  const weeks: WeekBar[] = [];
  let t = Date.parse('2024-01-01T00:00:00Z'), c = 50;
  for (let i = 0; i < 120; i++) {
    c = i < 30 ? 50 + Math.sin(i) : i < 100 ? c * 1.02 : c * 0.96;
    weeks.push({ wk: new Date(t).toISOString().slice(0, 10), o: c, h: c * 1.01, l: c * 0.99, c, v: 1000 });
    t += 7 * 86_400_000;
  }
  const r = stageAnalysis(weeks.slice(0, 110));
  const last = r.last!;
  // still a confirmed Stage 2 by the stage rules (the 30-week average is still rising) while 30%+ below its high — the lag this fixes
  assert.equal(last.stage, 2);
  assert.ok(last.ddPct != null && last.ddPct < -30, `ddPct ${last.ddPct}`);
  assert.equal(stageHealth(last)!.level, 'weak');
  const hiWeek = r.weeks.find((w) => w.ddPct === 0 && w.stage === 2);
  assert.ok(hiWeek, 'a new stage high reads 0');
});

test('screener wiring: fields stored with a new setup version, presets and the portfolio workflow', () => {
  assert.ok((TV_ROW_KEYS as readonly string[]).includes('twH') && (TV_ROW_KEYS as readonly string[]).includes('twDd'));
  assert.ok(SETUP_VERSION >= 5);
  const weak = BUILT_IN_PINE_SCREENS.find((s) => s.id === 'tw-stage2-weak')!;
  assert.deepEqual(weak.q.filters.map((f: any) => [f.key, f.v]), [['twSt', 2], ['twH', 0]]);
  assert.ok(BUILT_IN_PINE_SCREENS.find((s) => s.id === 'tw-stage2-healthy'));
  assert.equal(WORKFLOWS.find((w) => w.id === 'pf-st2-weak')?.presetId, 'tw-stage2-weak');
  assert.match(readFileSync(join(root, 'lib/screener/tv-screens.ts'), 'utf8'), /out\.twH = h \? h\.code : null/);
});
