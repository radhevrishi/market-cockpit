// zzz1026 — Auto trendlines & levels: say which price the distances use. QA: AVAV monthly showed "support $131.03 — price 8.5%
// above" while the header showed $120.60 — the % came from the last COMPLETED monthly close (the forming month is left out).
// Now both are shown: the completed close with its date and the latest price, and a line the latest price is through before
// the period closes is a "provisional breach" (never "intact" / "holding"); broken on completed bars stays "broken".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoLines, type Level, type AutoLinesResult } from '../auto-lines';
import type { Bar } from '../chart-math';
import {
  alnCloseLabel, alnPayload, alnRef, alnRefText, alnTwoPrices, autoLinesHeadline, autoLinesRows, measureLevel, DEFAULT_ALN_PREFS,
} from '../../components/charts/auto-lines-view';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
/** monthly bars from Jan 2020; the last completed one is Sep 2026 when n = 81 */
const mT = (i: number) => Date.UTC(2020, i, 1, 13, 30);
const mbar = (i: number, c: number, lo?: number, hi?: number): Bar => ({ t: mT(i), o: c, h: hi ?? c * 1.01, l: lo ?? c * 0.99, c, v: 1e6 });

/** a range 131–147 on monthly bars: lows at 131.03, highs at 147.21; the last completed close 142.10 */
function avavLike(): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < 81; i++) {
    const c = 139 + 8 * Math.cos((2 * Math.PI * i) / 10);   // highs at 0, 10, 20 … lows at 5, 15, 25 …
    const lo = i % 10 === 5 ? 131.03 : c * 0.995, hi = i % 10 === 0 ? 147.21 : c * 1.005;
    out.push(mbar(i, c, Math.min(lo, c), Math.max(hi, c)));
  }
  out[80] = mbar(80, 142.1, 140.5, 143.5);   // Sep 2026 close 142.10
  return out;
}

test('reference: forming month through support → provisional breach, both distances, with the close date', () => {
  const done = avavLike();
  assert.equal(new Date(done[80].t).getUTCMonth(), 8, 'last completed = Sep');
  const forming = mbar(81, 120.6, 119, 143);   // Oct, not closed, latest $120.60
  const all = [...done, forming];
  const ref = alnRef(done, all)!;
  assert.deepEqual([ref.close, ref.latest, ref.forming], [142.1, 120.6, true]);
  assert.ok(alnTwoPrices(ref));
  // a hand-made support level at 131.03 (the engine reads the same bars; the words do not depend on how it was found)
  const lvl: Level = { kind: 'support', price: 131.03, touches: [{ i: 5, price: 131.03 }, { i: 15, price: 131.03 }, { i: 25, price: 131.03 }], firstTouch: 5, lastTouch: 25, flips: 0, distPct: (142.1 / 131.03 - 1) * 100, strength: 60 };
  const res: Level = { kind: 'resistance', price: 147.21, touches: [{ i: 0, price: 147.21 }, { i: 10, price: 147.21 }, { i: 20, price: 147.21 }], firstTouch: 0, lastTouch: 20, flips: 0, distPct: (142.1 / 147.21 - 1) * 100, strength: 55 };
  const r: AutoLinesResult = { trend: [], levels: [res, lvl], log: false, tolPct: 0.01 };
  const m = measureLevel(lvl, ref);
  assert.equal(m.status, 'provisional');
  assert.ok(Math.abs(m.closeDist - 8.45) < 0.06);
  assert.ok(Math.abs(m.latestDist! + 7.96) < 0.05);
  const rows = autoLinesRows(done, r, 'M', 2, ref, '$');
  const sup = rows.find((x) => x.kind === 'support')!;
  assert.equal(sup.prov, true);
  assert.equal(sup.title, 'Support level 131.03 (provisional breach)');
  assert.match(sup.detail, /Sep close \$142\.10 is 8\.4% above · latest \$120\.60 is 8\.0% below — provisional breach \(month not closed\)/);
  assert.match(sup.tip, /^Support 131\.03 · Sep close \$142\.10 is 8\.4% above · latest \$120\.60 is 8\.0% below — provisional breach \(month not closed\)/);
  assert.ok(!/\bholding\b/i.test(sup.tip + sup.detail + sup.title));
  // the resistance: Sep close 3.5% below it, latest further below — not a breach, still says both prices
  const rs = rows.find((x) => x.kind === 'resistance')!;
  assert.equal(rs.prov, false);
  assert.match(rs.detail, /Sep close \$142\.10 is 3\.5% below · latest \$120\.60 is 18\.1% below \(month not closed\)/);
  // status line counts it; list header names both prices
  assert.match(autoLinesHeadline(r, 'M', 'ready', DEFAULT_ALN_PREFS, 1), /· 1 provisional breach \(month not closed\)$/);
  assert.equal(alnRefText(ref, 'M', 2, '$'), 'Distances from the Sep close $142.10 (last completed month) and the latest $120.60 (month not closed).');
  // chart tags carry the mark
  const p = alnPayload(done, r, DEFAULT_ALN_PREFS, false, 2, ref);
  assert.deepEqual(p.levels.map((x) => [x.kind, !!x.prov]).sort(), [['resistance', false], ['support', true]]);
  assert.ok(read('../../components/charts/auto-lines-kline.ts').includes("lv.prov ? ' · provisional' : ''"));
});

test('reference: completed close equals the latest (daily after the close) → one distance, no "latest", no breach', () => {
  const done = avavLike().map((b, i) => ({ ...b, t: Date.UTC(2026, 0, 1 + i, 13, 30) }));
  const ref = alnRef(done, done)!;
  assert.equal(ref.forming, false);
  assert.equal(alnTwoPrices(ref), false);
  const lvl: Level = { kind: 'support', price: 131.03, touches: [{ i: 5, price: 131.03 }, { i: 15, price: 131.03 }, { i: 25, price: 131.03 }], firstTouch: 5, lastTouch: 25, flips: 1, distPct: (142.1 / 131.03 - 1) * 100, strength: 60 };
  const rows = autoLinesRows(done, { trend: [], levels: [lvl], log: false, tolPct: 0.01 }, 'D', 2, ref, '$');
  assert.equal(rows[0].latestDistPct, null);
  assert.match(rows[0].detail, /· 22 Mar close \$142\.10 is 8\.4% above ·/);
  assert.ok(!/latest|provisional|not closed/.test(rows[0].detail + rows[0].tip));
  assert.equal(alnRefText(ref, 'D', 2, '$'), 'Distances from the 22 Mar close $142.10.');
  // a forming candle whose price has not moved off the completed close: one distance too
  const same = alnRef(done, [...done, { ...done[done.length - 1], t: done[done.length - 1].t + 86_400_000 }])!;
  assert.equal(same.forming, true);
  assert.equal(alnTwoPrices(same), false);
});

test('reference: a trendline already broken on completed bars stays "broken"; an intact one the forming bar cuts is provisional', () => {
  // rising support on daily bars (100 + 0.2·i, lows on it every 40 bars)
  const lineAt = (i: number) => 100 + 0.2 * i;
  const T0 = Date.UTC(2024, 0, 1), DAY = 86_400_000;
  const mk = (n: number, tweak?: (i: number) => number | null) => Array.from({ length: n }, (_, i) => {
    const c = tweak?.(i) ?? lineAt(i) + 0.5 + 10 * Math.abs(Math.sin((Math.PI * (i - 20)) / 40));
    return { t: T0 + i * DAY, o: c, h: c + 0.5, l: c - 0.5, c, v: 1e6 } as Bar;
  });
  const done = mk(130);
  const r = autoLines(done, { tf: 'D' });
  const sup = r.trend.find((l) => l.kind === 'support')!;
  assert.ok(sup && sup.state === 'intact');
  const formingBelow = { ...done[129], t: done[129].t + DAY, c: lineAt(130) - 3, l: lineAt(130) - 3.5 };
  const ref = alnRef(done, [...done, formingBelow])!;
  const row = autoLinesRows(done, r, 'D', 2, ref, '$').find((x) => x.id.startsWith('t:support'))!;
  assert.equal(row.prov, true);
  assert.match(row.title, /\(provisional breach\)$/);
  assert.match(row.detail, /line at the \d+ \w{3} close: \$\d+\.\d\d \(\d+ \w{3} close \$\d+\.\d\d is \d+\.\d% above\) · line now \(projected to the latest bar\): \$\d+\.\d\d \(latest \$\d+\.\d\d is \d+\.\d% below\) — provisional breach \(day not closed\)/);
  assert.match(row.tip, /Intact on completed days; the latest price is through it — provisional breach until the day closes/);
  // forming bar back above the line: intact, two distances, no breach words
  const ok = autoLinesRows(done, r, 'D', 2, alnRef(done, [...done, { ...formingBelow, c: lineAt(130) + 4 }]), '$').find((x) => x.id.startsWith('t:support'))!;
  assert.equal(ok.prov, false);
  assert.ok(!/breach/.test(ok.detail + ok.title));
  assert.match(ok.detail, /\(latest \$\d+\.\d\d is \d+\.\d% above\) \(day not closed\)/);
  // broken on completed bars: stays broken even when the forming bar is back above
  const brokenDone = mk(135, (i) => (i >= 121 ? lineAt(i) - 4 : null));
  const rb = autoLines(brokenDone, { tf: 'D' });
  const lb = rb.trend.find((l) => l.kind === 'support' && l.state === 'broken')!;
  assert.ok(lb);
  const back = { ...brokenDone[134], t: brokenDone[134].t + DAY, c: lineAt(135) + 5 };
  const rowB = autoLinesRows(brokenDone, rb, 'D', 2, alnRef(brokenDone, [...brokenDone, back]), '$').find((x) => x.broken)!;
  assert.match(rowB.title, /\(broken\)$/);
  assert.equal(rowB.prov, false);
  assert.match(rowB.tip, /Broken on a completed close/);
});

test('reference: labels per timeframe and plain wording (no "holding", "best", buy / sell)', () => {
  const t = Date.UTC(2026, 9, 6, 13, 30);
  assert.equal(alnCloseLabel(t, 'M'), 'Oct close');
  assert.equal(alnCloseLabel(t, 'W'), 'week of 6 Oct close');
  assert.equal(alnCloseLabel(t, 'D'), '6 Oct close');
  assert.equal(alnRef([], []), null);
  for (const f of ['../auto-lines.ts', '../../components/charts/auto-lines-view.ts', '../../components/charts/auto-lines-kline.ts', '../../components/charts/AutoLinesIndicator.tsx']) {
    const src = read(f);
    assert.ok(!/\bholding\b/i.test(src), `${f}: "holding"`);
    assert.ok(!/\bbest\b/i.test(src), `${f}: "best"`);
    assert.ok(!/\b(buy|sell|buying|selling)\b/i.test(src), `${f}: buy / sell`);
  }
});

test('zzz1034 — one colour per kind: trendlines white / levels yellow on dark; charcoal / deep amber on white; broken grey', async () => {
  const { alnColors, alnColorOf } = await import('../../components/charts/auto-lines-view');
  assert.equal(alnColorOf('support', false, false), '#FFFFFF');
  assert.equal(alnColorOf('resistance', false, false), '#FFFFFF');
  assert.equal(alnColorOf('support', false, false, true), '#FFD54F');
  assert.equal(alnColorOf('resistance', false, true), '#1E293B');
  assert.equal(alnColorOf('resistance', false, true, true), '#A16207');
  assert.equal(alnColorOf('support', true, false), alnColors(false).broken);
  const { readFileSync } = await import('node:fs');
  const k = readFileSync(new URL('../../components/charts/auto-lines-kline.ts', import.meta.url), 'utf8');
  assert.match(k, /const c = col\.level;/);
  assert.match(k, /ln\.broken \? col\.broken : col\.trend/);
});
