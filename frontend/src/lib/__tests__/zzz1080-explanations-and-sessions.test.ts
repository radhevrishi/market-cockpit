// zzz1080 / zzz1081 — retest B05 (accumulation grade help = the engine's rule), B06 (monthly pattern wording in monthly units),
// B07 (a closed-market move is "last session · 16 Oct", never "today").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACC_GATES, accGradeRuleText, accExplain } from '../accumulation';
import { fieldOf } from '../screener/filters';
import { patternShortFor, PATTERN_META, MONTHLY_MIN_SPAN } from '../chart-patterns';
import { moveSessionLabel } from '../session-move-label';

test('B05: the grade help is written from ACC_GATES (A 85, B 72) and names the confirmation conditions', () => {
  const t = accGradeRuleText();
  assert.match(t, new RegExp(`A = score ≥ ${ACC_GATES.scoreA}`));
  assert.match(t, new RegExp(`B = score ≥ ${ACC_GATES.scoreB}`));
  assert.match(t, /On-Balance Volume rising/);
  assert.match(t, /misses any of these is C/);
  assert.doesNotMatch(t, /A score ≥ 80|B ≥ 65/);
  const note = fieldOf('accR')?.approxNote?.IN || '';
  assert.match(note, /A = score ≥ 85/, 'the screener field uses it');
});

test('B05: a score of 84 graded B says why it is not A; a confirmed 79 that fails gates reads C with the miss', () => {
  const base: any = { accV: 3, accD: 5, disD: 1, chD: 0, cmf21: 0.12, cmf65: 0.18, udv50: 1.6, obvSlope: 0.3, obvLead: 0, bigUpW: 2, bigDnW: 0, vdu: null, vboD: null, vboX: null, distWarn: 0, dlv10: null, dlvChg: null, accMiss: [] };
  const b84 = accExplain({ ...base, accS: 84, accG: 'B' }, 'session', 'IN');
  assert.ok(b84.some((l) => /Graded B, not A: A needs a score ≥ 85/.test(l) && /score 84 is below 85/.test(l)));
  const c79 = accExplain({ ...base, accS: 79, accG: 'C', accMiss: ['On-Balance Volume not rising'] }, 'session', 'IN');
  assert.ok(c79.some((l) => /not confirmed: On-Balance Volume not rising/.test(l)));
});

test('B06: a monthly cup is described in monthly candles from the detector limits, daily unchanged', () => {
  const m = patternShortFor('cup', 'M');
  assert.match(m, new RegExp(`${MONTHLY_MIN_SPAN}–16 monthly candles`));
  assert.doesNotMatch(m, /weeks long/);
  assert.equal(patternShortFor('cup', 'D'), PATTERN_META.cup.short);
  assert.match(patternShortFor('double_bottom', 'M'), /at least 6 monthly candles apart/);
  assert.match(patternShortFor('double_top', 'W'), /at least 5 weekly candles apart/);
  const hd = readFileSync(join(__dirname, '..', '..', 'components', 'pine-screener', 'HitDetail.tsx'), 'utf8');
  assert.match(hd, /patternShortFor\(b!\.id, b!\.tf\)/);
});

test('B07: Sunday 18 Oct 2026 → "last session · 16 Oct"; a trading day after the open → "today"', () => {
  const sun = moveSessionLabel('IN', new Date('2026-10-18T09:00:00Z'));
  assert.equal(sun.today, false); assert.equal(sun.word, 'last session · 16 Oct');
  const monOpen = moveSessionLabel('IN', new Date('2026-10-19T05:00:00Z'));   // 10:30 IST Monday
  assert.equal(monOpen.word, 'today');
  const monPre = moveSessionLabel('IN', new Date('2026-10-19T03:00:00Z'));    // 08:30 IST, before the open
  assert.equal(monPre.word, 'last session · 16 Oct');
  // a quote time wins over the calendar: Friday's quote seen on Monday morning is Friday's move
  assert.equal(moveSessionLabel('IN', new Date('2026-10-19T05:00:00Z'), '2026-10-16T10:00:00Z').word, 'last session · 16 Oct');
  const c = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', '_home', 'components.tsx'), 'utf8');
  assert.doesNotMatch(c, /% today`/);
  assert.match(c, /moveSessionLabel\('IN', new Date\(\), g\.quoteTime\)/);
});
