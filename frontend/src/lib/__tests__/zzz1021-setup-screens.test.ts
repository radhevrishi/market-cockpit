// zzz1021 — TRADER SETUPS in the screener: the stored entry (techEntry → setV + figures), rows only from a current setup reading,
// CANSLIM points / episodic pivot on results, the 'Trader setups' presets (fields delivered, rule-editor group), wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  techEntry, rowTvFields, applyTraderSetups, canslimPoints, setupEntry, setupCoverageNote, SETUP_VERSION, SETUP_ROW_KEYS, PATTERN_SCAN_VERSION,
  LEAN_KEYS, PINE_GROUPS, PINE_RULE_GROUPS, OPTIONAL_COLS, pineRuleMenu, leanRow,
} from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { FIELDS, fieldOf, filterKeys } from '../screener/filters';
import { SETUP_FIGURE_KEYS } from '../setups';
import type { DailyBars } from '../screener/tech';
import type { ScreenRow } from '../screener/types';
import type { TechStored } from '../screener/tech-fetch';

/** n completed sessions (Mon–Fri) ending well before `now`, a steady rise with a gap at the end */
function daily(n: number): DailyBars {
  const d: string[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  let t = Date.UTC(2021, 0, 4), px = 50;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const prev = px; px *= 1.002;
    d.push(new Date(t).toISOString().slice(0, 10)); o.push(prev); h.push(px * 1.005); l.push(prev * 0.995); c.push(px); v.push(1_000_000);
    t += 86_400_000;
  }
  return { d, o, h, l, c, v };
}
const SETUPS = BUILT_IN_PINE_SCREENS.filter((s) => s.group === 'setups');

test('zzz1021 versions: PATTERN_SCAN_VERSION stays 10, SETUP_VERSION 1; row keys are setup figure keys (epT kept on the entry)', () => {
  assert.equal(PATTERN_SCAN_VERSION, 10);
  assert.equal(SETUP_VERSION, 2);
  for (const k of SETUP_ROW_KEYS) assert.ok((SETUP_FIGURE_KEYS as readonly string[]).includes(k), k);
  assert.deepEqual(SETUP_FIGURE_KEYS.filter((k) => !(SETUP_ROW_KEYS as readonly string[]).includes(k)), ['epT']);
});

test('zzz1021 techEntry stores setV and the setup figures (nulls left out); a failure still stores the version', () => {
  const e = techEntry(daily(400), null, false, null, { market: 'US', now: new Date('2026-10-14T12:00:00Z') });
  assert.equal(e.setV, SETUP_VERSION);
  assert.equal(e.patV, PATTERN_SCAN_VERSION);
  assert.equal(typeof e.x50A, 'number');
  assert.equal(typeof e.udv === 'number' || e.udv === undefined, true);
  for (const [k, v] of Object.entries(e)) if ((SETUP_FIGURE_KEYS as readonly string[]).includes(k)) assert.notEqual(v, null, `${k} stored as null`);
  const bad = setupEntry({ d: ['x'], o: [NaN], h: [NaN], l: [NaN], c: [NaN], v: [NaN] });
  assert.deepEqual(bad, { setV: SETUP_VERSION });
});

test('zzz1021 rowTvFields: setup fields only from a current setup reading; an old or missing setV withholds them', () => {
  const base = { patV: PATTERN_SCAN_VERSION, tt: 5, wt3: 3, wt3P: 12.5, dvx: 2, x50A: 3.1, epT: 20000 } as unknown as TechStored;
  const cur = rowTvFields({ ...base, setV: SETUP_VERSION } as TechStored, 'US');
  assert.equal(cur.wt3, 3); assert.equal(cur.dvx, 2); assert.equal(cur.x50A, 3.1); assert.equal(cur.tt, 5);
  assert.equal((cur as any).epT, undefined, 'the gap day stays on the entry');
  for (const old of [{ ...base, setV: SETUP_VERSION - 1 }, base]) {
    const r = rowTvFields(old as TechStored, 'US');
    assert.equal(r.tt, 5, 'the TradingView-script fields are unaffected');
    for (const k of SETUP_ROW_KEYS) assert.equal((r as any)[k], undefined, k);
  }
});

test('zzz1021 CANSLIM points (M not counted) and the episodic pivot on results', () => {
  const r = { t: 'A', epsQYoY: 30, epsTTMYoY: 40, px: 90, hi52: 100, udv: 1.3, rsR: 85 } as Partial<ScreenRow>;
  assert.equal(canslimPoints(r), 5);
  assert.equal(canslimPoints({ ...r, px: 80 }), 4);
  assert.equal(canslimPoints({ ...r, udv: null, rsR: undefined }), 3, 'a missing figure is a point not earned');
  const rows = [
    { t: 'A', epsQYoY: 30, epsTTMYoY: 40, px: 90, hi52: 100, udv: 1.3, rsR: 85, epD: 2, earnD: 20001 },
    { t: 'B', epsQYoY: 30, epD: 2, earnD: 20010 },
    { t: 'C', epsQYoY: 30, epD: 2 },
    { t: 'OLD', epsQYoY: 30 },
  ] as unknown as ScreenRow[];
  const entries: Record<string, { setV?: number; epT?: number }> = { A: { setV: SETUP_VERSION, epT: 20000 }, B: { setV: SETUP_VERSION, epT: 20000 }, C: { setV: SETUP_VERSION, epT: 20000 }, OLD: { setV: 0 } };
  applyTraderSetups(rows, (t) => entries[t]);
  assert.equal(rows[0].csl, 5); assert.equal(rows[0].epE, 1);
  assert.equal(rows[1].csl, 1); assert.equal(rows[1].epE, 0, '10 days from the results date');
  assert.equal(rows[2].epE, undefined, 'results date unknown');
  assert.equal(rows[3].csl, undefined, 'not read with the current setup version');
  assert.match(setupCoverageNote(new Map([['A', { setV: SETUP_VERSION }], ['B', { setV: 0 }]])), /1 of 2 companies .* 1 wait/);
});

test('zzz1021 presets: ~16 trader-setup screens; every rule / column field is delivered (LEAN_KEYS) and defined (FIELDS)', () => {
  assert.ok(SETUPS.length >= 14, `${SETUPS.length} setup screens`);
  assert.ok(PINE_GROUPS.some((g) => g.id === 'setups' && g.label === 'Trader setups'));
  for (const s of SETUPS) {
    assert.equal(s.q.need, 'any', `${s.id}: rules decide`);
    assert.ok(s.note && /our own version of the published rules/i.test(s.note), `${s.id}: note says our own version`);
    for (const f of s.q.filters) for (const k of filterKeys(f)) assert.ok((LEAN_KEYS as readonly string[]).includes(k) && fieldOf(k), `${s.id}: ${k}`);
    for (const k of s.q.cols) assert.ok((LEAN_KEYS as readonly string[]).includes(k) && fieldOf(k), `${s.id} column ${k}`);
  }
  const ids = new Set(BUILT_IN_PINE_SCREENS.map((s) => s.id));
  assert.equal(ids.size, BUILT_IN_PINE_SCREENS.length, 'unique ids');
  for (const k of [...SETUP_ROW_KEYS, 'csl', 'epE']) {
    assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${k} in LEAN_KEYS`);
    const f = fieldOf(k);
    assert.ok(f && f.group === 'Trader setups' && f.markets.includes('US') && f.markets.includes('IN'), `${k} field`);
    assert.match(f!.approxNote?.US || '', /our own version of the published rules/);
  }
  for (const k of OPTIONAL_COLS) assert.ok(fieldOf(k), k);
  // the rule editor offers them under their own group
  assert.ok(PINE_RULE_GROUPS.includes('Trader setups'));
  const menu = pineRuleMenu('US').find((g) => g.group === 'Trader setups');
  assert.ok(menu && menu.fields.some((f) => f.key === 'dvx') && menu.fields.some((f) => f.key === 'csl'));
  // a lean row carries the setup fields
  const lr = leanRow({ t: 'A', n: 'A', wt3: 3, dvx: 1, csl: 4 } as unknown as ScreenRow);
  assert.equal(lr.wt3, 3); assert.equal(lr.dvx, 1); assert.equal(lr.csl, 4);
});

test('zzz1021 wording: setup labels, notes and names say "setup / signal / watch / extended" — never best / buy / sell', () => {
  const texts = [
    ...SETUPS.flatMap((s) => [s.name, s.note || '']),
    ...FIELDS.filter((f) => f.group === 'Trader setups').flatMap((f) => [f.label, f.approxNote?.US || '', f.sparse?.US || '']),
  ];
  for (const t of texts) assert.doesNotMatch(t, /\bbest\b|\bbuys?\b|\bsells?\b|\bBUY\b|\bSELL\b/i, t);
  assert.ok(SETUPS.some((s) => /take care/i.test(s.name)), 'the extended list says take care');
});
