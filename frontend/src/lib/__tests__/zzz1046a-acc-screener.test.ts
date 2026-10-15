// zzz1046a — volume & accumulation on the Pine Screener and the Stock Screener: the build keeps the engine's figures (completed bars
// only, versioned), India's delivery % from NSE's price files (index 6 of a stored day), the row / lean fields, the Stock Screener's
// new field group, the Pine presets / family / card / workflows, and the Acc chip + detail section. Made-up tickers, synthetic bars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accumulationFigures, ACC_VERSION } from '../accumulation';
import { weekComplete } from '../completed-weeks';
import { techEntry, rowTvFields, leanRow, LEAN_KEYS, OPTIONAL_COLS, PINE_RULE_GROUPS, pineRuleMenu, runPineFull, cleanQuery } from '../screener/pine';
import { accEntry, accRowFields, accCurrent, accFiguresOfRow, accExplainRow, ACC_ROW_KEYS, DLV_ROW_KEYS, ACC_RANK, barVolX, breakoutVolText, accCoverageNote } from '../screener/acc-row';
import { parseBhav, bhavHasDelivery, deliveryOf, deliveryNote, type BhavDay } from '../screener/in-build';
import { overlayNse, type DailyBars } from '../screener/tech';
import { FIELDS, fieldOf } from '../screener/filters';
import { fieldMeta } from '../screener/field-meta';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import { PINE_FAMILIES, pineFamilyOf, pineFamilyGroups, ruleKeyTf } from '../screener/pine-families';
import { SETUP_CARDS, WORKFLOWS, setupCounts, setupRebuild, cardQuery } from '../screener/pine-view';
import type { ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** Weekdays from 2026-01-05; `step(i)` = [change %, volume multiple, close location −1…1] (as in zzz1046). */
function make(n: number, step: (i: number) => [number, number, number], base = 100, vol = 1_000_000): DailyBars {
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.parse('2026-01-05T00:00:00Z'), c = base;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
    const [chg, vx, cl] = step(i);
    const prev = c; c = +(prev * (1 + chg / 100)).toFixed(4);
    const range = Math.max(prev, c) * 0.02;
    const lo = Math.min(prev, c) - range * 0.25, hi = Math.max(prev, c) + range * 0.25;
    const span = hi - lo, l = c - ((cl + 1) / 2) * span, h = l + span;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(prev); b.h.push(+h.toFixed(4)); b.l.push(+l.toFixed(4)); b.c.push(c); b.v.push(Math.round(vol * vx));
    t += 86_400_000;
  }
  return b;
}
const cut = (b: DailyBars, n: number): DailyBars => ({ d: b.d.slice(0, n), o: b.o.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n), v: b.v.slice(0, n) });
// steady accumulation, then one huge unfinished distribution session at the end
const ACC_BARS = (() => { const b = make(160, (i) => (i % 3 === 0 ? [-0.6, 0.6, -0.2] : [1.2, 1.6, 0.7])); const L = b.c.length - 1; b.c[L] = b.c[L - 1] * 0.9; b.l[L] = b.c[L]; b.h[L] = b.c[L - 1]; b.v[L] = 9e7; return b; })();
const NOW = new Date('2026-10-15T12:00:00Z');

test('zzz1046a techEntry: accumulation figures from the COMPLETED sessions only, versioned, on the row only when current', () => {
  const e = techEntry(ACC_BARS, null, true, null, { market: 'US', now: NOW });   // last bar = today's unfinished session
  const done = cut(ACC_BARS, ACC_BARS.c.length - 1);
  const ref = accumulationFigures(done, { daily: true, weekDone: (m) => weekComplete(m, 'US', NOW) });
  assert.equal(e.accV, ACC_VERSION);
  assert.equal(e.accS, ref.accS, 'same score as the engine on the completed bars (the live distribution bar is left out)');
  assert.ok(['A', 'B'].includes(e.accG as string), String(e.accG));
  assert.equal(e.accR, ACC_RANK[ref.accG!]);
  assert.equal(e.accD, ref.accD); assert.equal(e.disD, ref.disD); assert.equal(e.cmf65, ref.cmf65);
  assert.deepEqual(e.accP, [ref.parts!.ad, ref.parts!.days, ref.parts!.udv, ref.parts!.obv, ref.parts!.weeks, ref.parts!.pull]);
  assert.ok(!('udv50' in e), 'the 50-session up/down volume is the setups\' udv — not stored twice');
  const withLive = accumulationFigures(ACC_BARS, { daily: true });
  assert.notEqual(withLive.disD, e.disD, 'reading the live bar would have counted its distribution');
  // the row carries the figures only from a current reading
  const row = rowTvFields(e, 'US');
  assert.equal(row.accS, e.accS); assert.equal(row.accG, e.accG); assert.deepEqual(row.accP, e.accP);
  const stale = rowTvFields({ ...e, accV: ACC_VERSION - 1 } as any, 'US');
  for (const k of ACC_ROW_KEYS) assert.equal((stale as any)[k], undefined, `${k} blank on an older reading`);
  assert.deepEqual(accRowFields(undefined), {});
  assert.equal(accCurrent({ accV: ACC_VERSION }), true); assert.equal(accCurrent({}), false);
});

test('zzz1046a accEntry: short history stores only the version (blank figures, never zeros); coverage note', () => {
  const e = accEntry(make(40, () => [0.5, 1, 0.5]), 'US', NOW);
  assert.deepEqual(e, { accV: ACC_VERSION });
  const note = accCoverageNote(new Map<string, any>([['AAA', { accV: ACC_VERSION, accS: 70 }], ['BBB', { accV: ACC_VERSION }], ['CCC', {}]]));
  assert.match(note, /2 of 3 companies read with version \d+, 1 with enough history for a grade — 1 wait for their next price read/);
});

test('zzz1046a the build re-reads companies without the current accumulation version', () => {
  assert.match(read('lib/screener/tech-fetch.ts'), /s\.setV !== SETUP_VERSION \|\| s\.accV !== ACC_VERSION/);
  assert.match(read('lib/screener/tech-fetch.ts'), /accCoverageNote\(store\)/);
  assert.match(read('lib/screener/pine.ts'), /const acc = accEntry\(done, src\?\.market, now\)/);
});

test('zzz1046a NSE price file: delivery % kept at index 6, OHLC positions unchanged', () => {
  const head = 'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
  const px = parseBhav(`${head}
ZQALPHA, EQ, 06-Oct-2026, 100, 101, 105, 99, 104, 104, 103, 5000, 5.1, 120, 2600, 52.00
ZQBETA, EQ, 06-Oct-2026, 50, -, -, -, 51, 51, 51, 900, 0.4, 10, 450, 50.00
ZQGAMMA, BE, 06-Oct-2026, 20, 20, 21, 19, 20.5, 20.5, 20.4, 300, 0.1, 5, -, -
`);
  assert.deepEqual(px.ZQALPHA, [104, 100, 5000, 101, 105, 99, 52]);
  assert.deepEqual(px.ZQBETA, [51, 50, 900, null, null, null, 50], 'missing open / high / low padded so index 6 stays the delivery %');
  assert.deepEqual(px.ZQGAMMA, [20.5, 20, 300, 20, 21, 19], 'no delivery % → the old 6-element day');
  // a file without the column keeps the old shape (zzz939 test)
  assert.deepEqual(parseBhav('SYMBOL, SERIES, CLOSE_PRICE, PREV_CLOSE, TTL_TRD_QNTY\nZQD, EQ, 10, 9, 100\n'), { ZQD: [10, 9, 100] });
  assert.equal(bhavHasDelivery(px as any), true);
  assert.equal(bhavHasDelivery({ ZQGAMMA: [20.5, 20, 300, 20, 21, 19] }), false);
  // overlayNse reads index 0..5 as before; a null open / high / low falls back to the close
  const b: DailyBars = { d: ['2026-10-05'], o: [50], h: [50.5], l: [49.5], c: [50], v: [10] };
  const out = overlayNse(b, [{ date: '2026-10-06', day: px.ZQBETA }, { date: '2026-10-05', day: px.ZQBETA }]);
  assert.deepEqual([out.c[0], out.v[0]], [51, 900]);
  assert.equal(out.d.length, 1, 'a later day without open / high / low is not appended (unchanged rule)');
});

test('zzz1046a delivery figures per company from the loaded price files (newest first)', () => {
  const days: BhavDay[] = [];
  for (let k = 0; k < 50; k++) days.push({ date: `d${String(50 - k).padStart(2, '0')}`, px: { ZQALPHA: [10, 10, 100, 10, 10, 10, k < 10 ? 60 : 40], ZQOLD: [10, 10, 100, 10, 10, 10] } });
  assert.deepEqual(deliveryOf(days, 'ZQALPHA'), { dlv10: 60, dlvChg: 20 });
  assert.deepEqual(deliveryOf(days, 'ZQOLD'), { dlv10: null, dlvChg: null }, 'no delivery known → blank');
  assert.deepEqual(deliveryOf(days.slice(0, 12), 'ZQALPHA'), { dlv10: 60, dlvChg: null }, 'the change needs 20 earlier sessions');
  assert.match(deliveryNote(days), /delivery % \(NSE price files\): 50 of 50 sessions known$/);
  const half = days.map((d, i) => (i >= 30 ? { ...d, px: { ZQOLD: [1, 1, 1, 1, 1, 1] as any } } : d));
  assert.match(deliveryNote(half), /30 of 50 sessions known — older files are read again a few per run/);
  const src = read('lib/screener/in-build.ts');
  assert.match(src, /loadBhav\(50, notes, 3, 3\)/, '50 sessions, at most 3 new files and 3 delivery re-reads a run');
  assert.match(src, /if \(wantDlv\) dlvLeft--; else fetched\+\+;/);
  assert.match(src, /\.\.\.deliveryFields\(bhav, t\)/);
});

test('zzz1046a Stock Screener: the "Volume & accumulation" field group, India-only delivery, period and source', () => {
  const keys = ['accS', 'accR', 'accD', 'disD', 'chD', 'cmf21', 'cmf65', 'obvSlope', 'obvLead', 'bigUpW', 'bigDnW', 'vdu', 'vboD', 'vboX', 'distWarn', 'dlv10', 'dlvChg'];
  for (const k of keys) { const f = fieldOf(k); assert.ok(f && f.group === 'Volume & accumulation', k); assert.ok(f!.approxNote?.IN, `${k} explained`); }
  assert.deepEqual(fieldOf('dlv10')!.markets, ['IN']); assert.deepEqual(fieldOf('dlvChg')!.markets, ['IN']);
  assert.ok(fieldOf('udv') && fieldOf('udv')!.group === 'Trader setups', 'the 50-session up/down volume is reused, not duplicated');
  assert.ok(!fieldOf('accG' as any) && !fieldOf('udv50' as any));
  assert.ok(FIELDS.filter((f) => f.group === 'Volume & accumulation').every((f) => !/\bbest\b|\bbuy\b|\bsell\b/i.test(`${f.label} ${f.approxNote?.US || ''} ${f.approxNote?.IN || ''}`)));
  assert.match(read('components/stock-screener/StockScreener.tsx'), /'Trader setups', 'Volume & accumulation', 'Growth'/);
  assert.match(read('components/stock-screener/AddFilterPanel.tsx'), /\{ label: 'Volume & accumulation', of: \['Volume & accumulation'\] \}/);
  assert.equal(fieldMeta('accS', 'US', { scanAt: '2026-10-14' }).period, 'completed sessions to 2026-10-14');
  assert.equal(fieldMeta('accS', 'IN').source, 'Yahoo daily bars + NSE price file');
  assert.equal(fieldMeta('accS', 'US').source, 'Yahoo daily bars');
  assert.equal(fieldMeta('dlv10', 'IN').source, 'NSE price file (delivery %)');
  assert.match(fieldMeta('bigUpW', 'US').period, /completed weeks/);
  assert.equal(ruleKeyTf('bigUpW'), 'W'); assert.equal(ruleKeyTf('accS'), 'D');
});

test('zzz1046a Pine: lean rows carry the fields; rule editor and optional columns offer them', () => {
  for (const k of [...ACC_ROW_KEYS, ...DLV_ROW_KEYS]) assert.ok((LEAN_KEYS as readonly string[]).includes(k), k);
  const lean = leanRow({ t: 'ZQA', accS: 72, accR: 4, accG: 'B', accP: [20, 15, 10, 12.5, 7.5, 5], dlv10: 55.55, distWarn: 0 } as unknown as ScreenRow);
  assert.equal(lean.accG, 'B'); assert.deepEqual(lean.accP, [20, 15, 10, 12.5, 7.5, 5]); assert.equal(lean.dlv10, 55.55); assert.equal(lean.distWarn, 0);
  assert.ok(PINE_RULE_GROUPS.includes('Volume & accumulation' as any));
  const g = pineRuleMenu('IN').find((x) => x.group === 'Volume & accumulation')!;
  assert.ok(g.fields.some((f) => f.key === 'dlv10') && g.fields.some((f) => f.key === 'accS'));
  assert.ok(!pineRuleMenu('US').find((x) => x.group === 'Volume & accumulation')!.fields.some((f) => f.key === 'dlv10'), 'delivery: India only');
  for (const k of ['accS', 'accR', 'accD', 'disD', 'cmf21', 'vboX', 'dlv10']) assert.ok((OPTIONAL_COLS as readonly string[]).includes(k), k);
});

const R = (t: string, o: Partial<ScreenRow>): ScreenRow => ({ t, n: t, px: 10, ...o } as ScreenRow);

test('zzz1046a Pine presets: the volume family, stable ids, each in exactly one family', () => {
  const ids = ['acc-ab', 'acc-base', 'acc-vbo', 'acc-stealth', 'acc-quiet', 'dist-warn', 'dlv-rising', 'acc-mtf', 'acc-weekly-base', 'acc-mtf-eo'];   // zzz1047c, zzz1047d
  for (const id of ids) {
    const s = BUILT_IN_PINE_SCREENS.find((x) => x.id === id);
    assert.ok(s, id);
    assert.equal(pineFamilyOf(s!), 'volume', id);
    assert.doesNotMatch(`${s!.name} ${s!.note || ''}`, /\bbest\b|\bbuy\b|\bsell\b/i, id);
    assert.deepEqual(cleanQuery(s!.q), s!.q, `${id} survives the saved-screen clean-up`);
  }
  assert.ok(PINE_FAMILIES.some((f) => f.id === 'volume' && f.label === 'Volume & accumulation'));
  const g = pineFamilyGroups(BUILT_IN_PINE_SCREENS, new Set(BUILT_IN_PINE_SCREENS.map((s) => s.id)), []).find((x) => x.id === 'volume')!;
  assert.deepEqual(g.screens.map((s) => s.id), ids);
  assert.equal(BUILT_IN_PINE_SCREENS.find((s) => s.id === 'dlv-rising')!.market, 'IN');
  const q = (id: string) => BUILT_IN_PINE_SCREENS.find((s) => s.id === id)!.q;
  assert.deepEqual(q('acc-stealth').filters, [{ kind: 'num', key: 'obvLead', op: 'between', v: 1, v2: 1 }]);
  assert.deepEqual(q('dlv-rising').filters, [{ kind: 'num', key: 'dlvChg', op: 'ge', v: 5 }, { kind: 'num', key: 'dlv10', op: 'ge', v: 40 }]);
  // grade A / B = accR ≥ 4; missing figures never pass
  const rows = [R('ZQA', { accR: 5, accS: 85 }), R('ZQB', { accR: 4, accS: 66 }), R('ZQC', { accR: 3, accS: 50 }), R('ZQD', {})];
  assert.deepEqual(runPineFull(rows, q('acc-ab'), 'US').strict.map((h) => h.row.t), ['ZQA', 'ZQB']);
  assert.deepEqual(runPineFull([R('ZQW', { distWarn: 1 }), R('ZQX', { distWarn: 0 })], q('dist-warn'), 'US').strict.map((h) => h.row.t), ['ZQW']);
  assert.deepEqual(runPineFull([R('ZQI', { dlv10: 45, dlvChg: 6 }), R('ZQJ', { dlv10: 35, dlvChg: 9 })], q('dlv-rising'), 'IN').strict.map((h) => h.row.t), ['ZQI']);
  assert.deepEqual(runPineFull([R('ZQQ', { vdu: 1, stage: 2 }), R('ZQR', { vdu: 1, stage: 3 })], q('acc-quiet'), 'US').strict.map((h) => h.row.t), ['ZQQ']);
});

test('zzz1046a setup card and workflows: Institutional accumulation; "…" while no company has the figures', () => {
  const card = SETUP_CARDS.find((c) => c.id === 'accumulation')!;
  assert.ok(card && card.presetId === 'acc-ab' && card.label === 'Institutional accumulation');
  assert.equal(cardQuery(card), BUILT_IN_PINE_SCREENS.find((s) => s.id === 'acc-ab')!.q);
  const rows = [R('ZQA', { accR: 5, accS: 85 }), R('ZQB', { accR: 4, accS: 66 }), R('ZQC', { accR: 2, accS: 33 })];
  assert.equal(setupCounts(rows, 'US', null, null).accumulation, 2);
  assert.equal(setupRebuild(rows, null).accumulation.state, 'ok');
  const none = setupRebuild([R('ZQZ', {})], null).accumulation;
  assert.equal(none.state, 'none'); assert.match(none.text, /not been read yet/);
  const wf = (id: string) => WORKFLOWS.find((w) => w.id === id)!;
  assert.deepEqual([wf('pf-acc').label, wf('pf-acc').presetId, wf('pf-acc').scope], ['Accumulation in my portfolio', 'acc-ab', 'pf']);
  assert.deepEqual([wf('pf-dist').label, wf('pf-dist').presetId, wf('pf-dist').scope, wf('pf-dist').tone], ['Distribution warning in my portfolio', 'dist-warn', 'pf', 'down']);
  assert.match(read('components/pine-screener/PineScreener.tsx'), /const unread = s\.q\.filters\.some/);
  assert.match(read('components/pine-screener/SetupCards.tsx'), /accumulation: <>/);
});

test('zzz1046a Acc chip, detail section and breakout volume', () => {
  const ui = read('components/pine-screener/PineScreener.tsx');
  assert.match(ui, /<Th label="Acc" k="accS"/);
  assert.match(ui, /<td className="pnx-num" data-col="acc"><AccChip row=\{r\} market=\{market\} \/><\/td>/);
  assert.match(ui, /const colCount = 14 \+/);
  assert.match(ui, /'RS Rating', 'Accumulation grade', 'Accumulation score \(0–100\)', 'Distribution warning'/);
  const pu = read('components/pine-screener/pine-ui.tsx');
  assert.match(pu, /export function AccChip/);
  assert.match(pu, /g === 'A' \|\| g === 'B' \? C\.green : g === 'C' \? C\.dim : C\.red/);
  assert.match(pu, /accExplain\(f, 'session', market\)\.join/);
  assert.match(pu, /breakoutVolText\(t\.bx\)/);
  const hd = read('components/pine-screener/HitDetail.tsx');
  assert.match(hd, /data-detail="accumulation"/);
  assert.match(hd, /accExplainRow\(r, market\)/);
  assert.match(hd, /data-detail="breakout-volume"/);
  // the explanation from a row
  const f = accFiguresOfRow({ accS: 82, accR: 5, accG: 'A', accD: 7, disD: 1, cmf65: 0.21, cmf21: 0.18, udv: 1.9, obvLead: 1, bigUpW: 3, bigDnW: 0, vdu: 1, distWarn: 0, accP: [25, 20, 13.3, 15, 15, 10], dlv10: 61, dlvChg: 8 });
  assert.equal(f.accG, 'A'); assert.equal(f.udv50, 1.9); assert.equal(f.parts!.weeks, 15);
  const lines = accExplainRow({ accS: 82, accR: 5, accG: 'A', accD: 7, disD: 1, cmf65: 0.21, udv: 1.9, dlv10: 61, dlvChg: 8 }, 'IN');
  assert.match(lines[0], /^Accumulation A \(heavy accumulation\) — score 82\/100$/);
  assert.ok(lines.some((l) => /^Delivery 61% of traded shares/.test(l)));
  const blank = accExplainRow({ dlv10: 40 }, 'IN');
  assert.match(blank[0], /^No accumulation grade yet: not read for this company yet/);
  assert.ok(blank.some((l) => /^Delivery 40%/.test(l)));
  // breakout volume: the bar ÷ the 50 bars before it
  const v = [...Array(50).fill(1000), 2100];
  assert.equal(barVolX(v, 50), 2.1);
  assert.equal(barVolX([...Array(30).fill(1000), 2100], 30), null, 'fewer than 40 earlier bars with volume');
  assert.equal(breakoutVolText(2.1), 'on 2.1× the 50-session average volume');
  assert.equal(breakoutVolText(0.8), 'on light volume (0.8× the 50-session average)');
  assert.equal(breakoutVolText(undefined), '');
  assert.match(read('lib/screener/pine.ts'), /const bx = bxOf && t\.s === 'b' && h\.breakT != null/);
});

test('zzz1046a a daily breakout tag carries its breakout-session volume ÷ the 50 sessions before (bx)', () => {
  // zzz990's cup-with-handle breakout generator: the last two sessions trade 2.4× the usual volume
  let x = 7;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const path: number[] = new Array(301).fill(60);
  for (const [d, to] of [[60, 60], [120, 100], [50, 75], [12, 75], [50, 98], [12, 92], [4, 95], [2, 101]] as Array<[number, number]>) { const from = path[path.length - 1]; for (let k = 1; k <= d; k++) path.push(from + ((to - from) * k) / d); }
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.UTC(2023, 0, 2), prev = path[0];
  path.forEach((p, i) => {
    const c = p * (1 + (rnd() - 0.5) * 0.006), o = prev;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(o); b.h.push(Math.max(o, c) * (1 + 0.005 * (0.3 + 0.7 * rnd()))); b.l.push(Math.min(o, c) * (1 - 0.005 * (0.3 + 0.7 * rnd()))); b.c.push(c);
    b.v.push(i >= path.length - 2 ? 2.4e6 : 1e6);
    prev = c; t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  });
  const e = techEntry(b, null, false, null, { market: 'US', now: new Date('2026-10-15T12:00:00Z') });
  const bo = (e.pat || []).filter((tag) => tag.s === 'b');
  assert.ok(bo.length > 0, 'a breakout is read');
  for (const tag of bo) assert.ok(typeof tag.bx === 'number' && tag.bx > 2 && tag.bx < 2.5, `${tag.id} bx ${tag.bx}`);
  assert.ok((e.pat || []).filter((tag) => tag.s !== 'b').every((tag) => tag.bx == null), 'only breakout tags carry it');
  assert.ok([...(e.patW || []), ...(e.patM || [])].every((tag) => tag.bx == null), 'daily tags only');
});
