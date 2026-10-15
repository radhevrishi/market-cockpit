// zzz1028 — chart-pattern explanations (QA findings 3 / 4 / 5):
//  3. HAL (Pine, "Base on base"): "Prior rise into the base: 6.5% — rule bases ≥ 20%" on a passing reading. The detector stores the GAIN
//     from the earlier base's pivot to this base's lip under `trend` and requires it to be 5–20% (O'Neil: the earlier breakout stalled);
//     the value was right, the rule text was the generic base rule. Every measured row now carries the detector's own bounds and a pass
//     flag (patternEvidenceRules, shared by the Pine detail and the chart), and this test walks real + synthetic detector output and
//     asserts every reported shape passes every hard row it shows — a label can no longer drift from the code.
//  4. SHAHALLOYS (monthly breakout): the event said "first close beyond the pivot in the last 5 sessions". It now names the timeframe and
//     its own window (D: 5 sessions, W: 2 weeks, M: 2 months; failed: 40 sessions / 8 weeks / 2 months) from stageWindowsFor.
//  5. AVAV (Monthly analysis): the banner led with a DAILY descending triangle. The chosen timeframe's state now comes first and the other
//     timeframe's structure is marked apart ("Monthly: no qualifying pattern · Other timeframe → Daily: …"), with a one-click switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzePatterns, analyzeDailyAs, patternEvidenceRules, evidenceRulePass, stageWindowsFor, PATTERN_IDS,
  type PBar, type PatternHit, type PatternId, type PatternTimeframe,
} from '../chart-patterns';
import { evidenceRows, conditionState, eventWindowWords, stageTip, stageWindowText, SETUP_CARDS } from '../screener/pine-view';
import type { ScreenPatternTag } from '../screener/pine';
import { evidenceWords, multiBanner, patternView, OTHER_TF_SEP, type TfViews } from '../../components/charts/pattern-view';

const DAY = 86_400_000;

// ───────── fixtures: the real charts stored in the zzz1005 / zzz1014 / zzz1024 tests (read as text — their tests are not re-run) ─────────
function decode(s: string): PBar[] {
  const [head, body] = s.split('|');
  const [t0s, es] = head.split(',');
  const unit = Math.pow(10, Number(es));
  let t = parseInt(t0s, 36) * DAY;
  return body.split(';').map((row) => {
    const [dt, o, h, l, c, v] = row.split(',');
    t += parseInt(dt, 36) * DAY;
    const vv = parseInt(v, 36);
    return { t, o: parseInt(o, 36) * unit, h: parseInt(h, 36) * unit, l: parseInt(l, 36) * unit, c: parseInt(c, 36) * unit, v: vv ? Math.floor(vv / 20) * Math.pow(10, vv % 20) : NaN };
  });
}
interface RealFx { name: string; tf: PatternTimeframe; bars: PBar[] }
function realFixtures(): RealFx[] {
  const out: RealFx[] = [];
  const dir = __dirname;
  for (const f of ['zzz1005-pattern-precision.test.ts', 'zzz1014-pattern-recall.test.ts']) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/name: '([^']+)', tf: '([DWM])'[^\n]*?bars: '([^']+)'/g)) out.push({ name: m[1], tf: m[2] as PatternTimeframe, bars: decode(m[3]) });
  }
  const src = readFileSync(join(dir, 'zzz1024-pattern-recall-watchlist.test.ts'), 'utf8');
  for (const m of src.matchAll(/^ {2}(US_[A-Z]+_([DW])): (\[.*\]),$/gm)) {
    const p = JSON.parse(m[3]) as any[];
    let d = p[0];
    out.push({ name: m[1], tf: m[2] as PatternTimeframe, bars: p.slice(1).map((r: number[]) => { d += r[0]; return { t: d * DAY, o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] * 1000 }; }) });
  }
  return out;
}

// ───────── synthetic: seeded random legs (rises, bases, pullbacks, declines) ─────────
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function synth(seed: number, n: number): PBar[] {
  const r = rng(seed);
  const path: number[] = [100];
  while (path.length < n) {
    const len = 5 + Math.floor(r() * 45), move = (r() - 0.42) * 0.5, from = path[path.length - 1], ease = r() < 0.5;
    for (let k = 1; k <= len && path.length < n; k++) { const x = k / len; path.push(from * (1 + move * (ease ? (1 - Math.cos(Math.PI * x)) / 2 : x))); }
  }
  const bars: PBar[] = [];
  let t = Date.UTC(2016, 0, 4), prev = path[0];
  for (const p of path) {
    const c = p * (1 + (r() - 0.5) * 0.02), o = prev;
    bars.push({ t, o, h: Math.max(o, c) * (1 + 0.012 * r()), l: Math.min(o, c) * (1 - 0.012 * r()), c, v: 1e6 * (0.5 + r()) });
    prev = c; t += DAY; while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
  }
  return bars;
}

/** every reported shape (qualifying, weaker and expired: all passed the detector's gates) of one reading */
const allHits = (a: { hits: PatternHit[]; weak?: PatternHit[]; expired?: PatternHit[] }) => [...a.hits, ...(a.weak || []), ...(a.expired || [])];
function checkHit(h: PatternHit, where: string, seen: Map<PatternId, number>) {
  if (!h.evidence) return;
  seen.set(h.id, (seen.get(h.id) || 0) + 1);
  const rows = patternEvidenceRules({ id: h.id, bullish: h.bias === 'bullish', ev: h.evidence, tf: h.timeframe });
  for (const r of rows) {
    // the pass flag IS the measured value against the stated bounds
    assert.equal(r.pass, evidenceRulePass(r.num, r.lo, r.hi, r.key === 'retr' ? 0.6 : r.key === 'sh' ? 0.0051 : r.key === 'gap' ? 0 : undefined), `${where} ${h.id} ${r.key}`);
    if (r.lo != null || r.hi != null) {
      // a shape the detector reported passes every hard rule it is shown with
      assert.equal(r.pass, true, `${where}: ${h.id} [${h.timeframe}] "${r.label}" ${r.value} vs rule ${r.rule} (${JSON.stringify(h.evidence)})`);
      assert.ok(r.rule.length > 0, `${h.id} ${r.key}: a bound without words`);
    }
  }
}

test('zzz1028 #3 HAL base on base: the measured gain from the EARLIER base sits next to its own 5–20% rule (never "bases ≥ 20%")', () => {
  const tag: Pick<ScreenPatternTag, 'id' | 'b' | 'ev' | 'tf'> = { id: 'base_on_base', b: 'U', ev: { depth: 11.2, trend: 6.5 }, tf: 'W' };
  const rows = evidenceRows(tag);
  const gain = rows.find((x) => /earlier base/.test(x.label))!;
  assert.ok(gain, rows.map((x) => x.label).join(' | '));
  assert.equal(gain.label, 'Gain from the earlier base\'s pivot to this base\'s lip');
  assert.equal(gain.value, '6.5%');
  assert.match(gain.rule, /^5–20%/);
  assert.equal(gain.pass, true);
  assert.ok(!rows.some((x) => /Prior rise/.test(x.label)), 'not labelled a prior rise');
  assert.ok(!rows.some((x) => /bases ≥ 20%/.test(x.rule)));
  // 22% would have been the earlier breakout running on — the detector rejects it, the row would say so
  assert.equal(evidenceRows({ ...tag, ev: { trend: 22 } }).find((x) => /earlier base/.test(x.label))!.pass, false);
  // the depth row of a base on base: 3–25%
  assert.equal(rows.find((x) => x.label === 'Depth')!.rule, '3–25%');
});

test('zzz1028 #3 audit: every rule label states the detector\'s own threshold (spot checks where the old generic text was wrong)', () => {
  const R = (id: PatternId, ev: any, tf: PatternTimeframe = 'D', bullish = true) => patternEvidenceRules({ id, bullish, ev, tf });
  const one = (id: PatternId, ev: any, key: string, tf: PatternTimeframe = 'D', bullish = true) => R(id, ev, tf, bullish).find((x) => x.key === key)!;
  // VCP / ascending base: the detector takes a 15% prior rise (the old text said "bases ≥ 20%")
  assert.equal(one('vcp', { trend: 17 }, 'trend').pass, true);
  assert.match(one('vcp', { trend: 17 }, 'trend').rule, /^≥ 15%/);
  assert.equal(one('ascending_base', { trend: 16 }, 'trend').pass, true);
  // U base: no minimum prior rise — measured, not a gate
  assert.equal(one('u_base', { trend: 3 }, 'trend').pass, null);
  // a deep cup (≥ 25%) needs 31% roundness, a shallow one 35%
  assert.equal(one('cup', { depth: 40, round: 32 }, 'round').pass, true);
  assert.equal(one('cup', { depth: 20, round: 32 }, 'round').pass, false);
  // line triangles: the band against the flat line's own tolerance, the swing ≥ max(5%, 2 × tol), length 15–130 sessions
  const tri = R('descending_triangle', { band: 3.6, rally: 9.1, gap: 110, tol: 4 }, 'D', false);
  assert.match(tri.find((x) => x.key === 'band')!.rule, /^≤ 4% — the flat line's tolerance/);
  assert.equal(tri.find((x) => x.key === 'band')!.pass, true);
  assert.equal(tri.find((x) => x.key === 'rally')!.lo, 8);
  assert.equal(tri.find((x) => x.key === 'gap')!.rule, '15–130 sessions');
  assert.ok(!tri.some((x) => /Middle dip|Separation/.test(x.label)), 'triangle rows are not worded as a double top');
  // head & shoulders TOP: the neckline is BELOW the shoulders
  assert.equal(one('head_shoulders', { rally: 7 }, 'rally', 'D', false).label, 'Neckline below the shoulders');
  // flags: the gate is the pullback as a share of the pole (≤ 50%), derived from the stored depth and pole
  const fl = R('bull_flag', { trend: 20, depth: 7 });
  assert.equal(fl.find((x) => x.key === 'retr')!.value, '42%');
  assert.equal(fl.find((x) => x.key === 'retr')!.pass, true);
  assert.equal(fl.find((x) => x.key === 'depth')!.pass, null);
  // reversal separation per timeframe: D ≥ 10 sessions (triple ≥ 20), W ≥ 4 weeks, M ≥ 5 months
  assert.match(one('double_bottom', { gap: 12 }, 'gap').rule, /^10–325 sessions/);
  assert.equal(one('triple_top', { gap: 15 }, 'gap', 'D', false).pass, false);
  assert.match(one('double_top', { gap: 4 }, 'gap', 'W', false).rule, /^4–65 weeks \(spans ≥ 5 weekly candles\)/);
  assert.equal(one('inverse_hs', { gap: 5 }, 'gap', 'M').pass, true);
  // score-only measurements are never shown as a passed rule
  assert.equal(one('flat_base', { vr: 0.7 }, 'vr').pass, null);
});

test('zzz1028 #3 walk: on real charts and 120 synthetic series (D / W / M, several end dates) every reported shape passes every hard rule row', () => {
  const seen = new Map<PatternId, number>();
  const fx = realFixtures();
  assert.ok(fx.length >= 30, `${fx.length} real fixtures`);
  for (const f of fx) {
    const n = f.bars.length;
    for (let cut = Math.max(40, Math.floor(n * 0.6)); cut <= n; cut += Math.max(5, Math.floor(n / 12))) {
      for (const h of allHits(analyzePatterns(f.bars.slice(0, cut), { timeframe: f.tf, weak: true }))) checkHit(h, `${f.name}@${cut}`, seen);
    }
  }
  for (let seed = 1; seed <= 120; seed++) {
    const b = synth(seed * 7919, 1300);
    for (const cut of [700, 950, 1300]) {
      const part = b.slice(0, cut);
      for (const tf of ['D', 'W', 'M'] as PatternTimeframe[]) {
        const a = tf === 'D' ? analyzePatterns(part.slice(-700), { weak: true }) : analyzeDailyAs(part, tf, { weak: true });
        for (const h of allHits(a)) checkHit(h, `synth ${seed}@${cut} ${tf}`, seen);
      }
    }
  }
  // the walk covers most pattern types (wedges carry no evidence)
  const covered = PATTERN_IDS.filter((id) => seen.has(id));
  assert.ok(covered.length >= 14, `covered: ${covered.join(', ')}`);
  for (const id of ['base_on_base', 'flat_base', 'cup', 'vcp', 'double_bottom', 'double_top', 'descending_triangle'] as PatternId[]) assert.ok(seen.has(id), `${id} not walked; covered ${covered.join(', ')}`);
});

test('zzz1028 #3 chart: the "Measured rules" words carry the same rule and pass mark', () => {
  const h = { id: 'base_on_base' as PatternId, bias: 'bullish' as const, timeframe: 'W' as PatternTimeframe, evidence: { depth: 11.2, trend: 6.5 } };
  const w = evidenceWords(h);
  assert.ok(w.some((x) => /^Gain from the earlier base's pivot to this base's lip 6\.5% \(rule 5–20%.*\) ✓$/.test(x)), w.join(' | '));
  assert.ok(!w.some((x) => /prior trend/.test(x)));
});

test('zzz1028 #4 event wording: the analysis timeframe and its own window (D 5 sessions · W 2 weeks · M 2 months)', () => {
  assert.equal(stageWindowsFor('D').breakout + 1, 5);
  assert.deepEqual([eventWindowWords('D').breakout, eventWindowWords('W').breakout, eventWindowWords('M').breakout], ['in the last 5 sessions', 'in the last 2 weeks', 'in the last 2 months']);
  assert.deepEqual([eventWindowWords('D').failed, eventWindowWords('W').failed, eventWindowWords('M').failed], ['within 40 sessions', 'within 8 weeks', 'within 2 months']);
  const tag = (tf: 'D' | 'W' | 'M', s: 'b' | 'x' = 'b') => ({ id: 'cup', b: 'U', s, c: 70, d: 3, p: 100, tf } as unknown as ScreenPatternTag);
  const row = { t: 'SHAHALLOYS', px: 103 } as any;
  const now = new Date('2026-10-15T12:00:00Z');
  // SHAHALLOYS: a monthly breakout
  assert.equal(conditionState(row, tag('M'), now).event.label, 'monthly breakout (first monthly close beyond the pivot in the last 2 months)');
  assert.equal(conditionState(row, tag('W'), now).event.label, 'weekly breakout (first weekly close beyond the pivot in the last 2 weeks)');
  assert.equal(conditionState(row, tag('D'), now).event.label, 'daily breakout (first daily close beyond the pivot in the last 5 sessions)');
  assert.match(conditionState(row, tag('M', 'x'), now).event.label, /^monthly breakout failed \(a monthly close more than 7\.5% back through the pivot within 2 months of the break\)$/);
  for (const tf of ['W', 'M'] as const) assert.doesNotMatch(conditionState(row, tag(tf), now).event.label, /sessions/);
  // the stage chips and the "How the patterns are found" text follow the timeframes in use
  assert.match(stageTip('b', ['M']), /^First monthly close beyond the pivot in the last 2 months/);
  assert.match(stageTip('b', ['D']), /in the last 5 sessions/);
  assert.equal(stageWindowText(['D', 'M'], 'breakout'), 'daily: in the last 5 sessions · monthly: in the last 2 months');
  // the Breakouts card reads daily patterns and says so
  assert.equal(SETUP_CARDS.find((c) => c.id === 'breakouts')!.sub, 'First daily close above the pivot in the last 5 sessions');
});

test('zzz1028 #5 banner: Monthly analysis with a daily structure — the monthly state first, the daily one marked as another timeframe', () => {
  const T0 = Date.UTC(2026, 4, 1);
  const tri: PatternHit = {
    id: 'descending_triangle', label: 'Descending triangle', bias: 'bearish', family: 'triangle' as any, stage: 'breakout', confidence: 0.64, likelihood: 'likely',
    startT: T0, endT: T0 + 160 * DAY, lengthBars: 110, depthPct: 30, pivot: 135.2, distToPivotPct: -6, note: '', timeframe: 'D', breakAgo: 2, breakT: T0 + 158 * DAY,
    lines: [{ kind: 'support', points: [[T0, 135.2], [T0 + 160 * DAY, 135.2]] }],
  } as PatternHit;
  const views: TfViews = { D: patternView({ hits: [tri], tf: 'D' }), W: patternView({ hits: [], tf: 'W' }), M: patternView({ hits: [], tf: 'M' }) };
  const b = multiBanner(views, 'M', '$', { displayTf: 'M' });
  assert.ok(b.text.startsWith('📐 Monthly: no qualifying pattern' + OTHER_TF_SEP + 'Daily: Descending triangle · broke down'), b.text);
  assert.equal(b.own, 'Monthly: no qualifying pattern');
  assert.equal(b.other?.tf, 'D');
  assert.match(b.other!.words, /^Descending triangle · broke down/);
  assert.equal(b.headTf, 'M', 'the list stays on the chosen timeframe');
  assert.equal(b.leadHit, tri, 'the daily structure is still drawn (its labels carry "Daily · ")');
  // Auto: the most relevant timeframe leads as before, no "other timeframe" part
  const a = multiBanner(views, 'A', '$');
  assert.equal(a.other, undefined);
  assert.match(a.text, /^📐 Descending triangle · Daily · /);
});
