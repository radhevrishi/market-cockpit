// zzz811 — every Conviction Beats name on the Portfolio Catalysts bench.
// The owner saw "All 55 · My book 53 · Bench 2 · 2 bench names failed the
// preset" while India Conviction Beats held ~314 names. The bench is now the
// whole India Conviction Beats list (server + this browser + synced book
// flags), held names appear once as book, and the quality preset is a label
// and a filter chip — never a gate. SYNTHETIC DATA ONLY.
// Run: npx tsx --test src/lib/__tests__/zzz811-pc-bench.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildIndiaBench, presetLabelIndia, readScope, otherBenchLabel, benchPresetCounts, indiaBenchLine, cbTicker, nextWindow, PC_PAGE_STEP, IN_CB_SOURCE,
} from '../thesis/pc-bench';
import { mergeUniverse, originCounts } from '../thesis/universe';
import { passesIndiaPreset, indiaPresetCheck } from '../quality-preset';
import { universeCounts, RESEARCH_EXPORT_STATUSES } from '../thesis/evidence-counts';
import { assessBookRow } from '../thesis/use-book';
import { classifyOrNearest } from '../earnings/pattern-abfg';
import { ThesisCard } from '../../components/thesis-card';

(globalThis as any).React = React;
const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// ── synthetic universe ──────────────────────────────────────────────────────
const sym = (i: number) => `SYN${String(i).padStart(3, '0')}`;
/** A graded row: every 4th passes the preset, every 4th fails on sales, every
 *  4th fails on margin + cash, every 4th has no market cap (unknown). */
function graded(i: number): any {
  const base = {
    ticker: sym(i), company: `Synthetic Co ${i}`, market: 'IN', source: 'graded', tier: i % 2 ? 'STRONG' : 'BLOCKBUSTER',
    sales_yoy_pct: 34, eps_yoy_pct: 41, net_profit_yoy_pct: 44, opm_pct: 18, opm_prev_pct: 15, cfo_to_pat_ratio: 0.9,
    market_cap_cr: 4000 + i * 90, verdict: 'WATCH', period: 'Q1 FY27', filing_date: '2026-08-12',
  };
  switch (i % 4) {
    case 0: return base;
    case 1: return { ...base, sales_yoy_pct: 11 };
    case 2: return { ...base, opm_pct: 12, cfo_to_pat_ratio: 0.2 };
    default: return { ...base, market_cap_cr: null };
  }
}
// 300 names on the server list, 20 in this browser (6 overlap + 14 local-only),
// 4 only in the synced book = 318; the owner holds 53, 2 of them on the list.
const SERVER = Array.from({ length: 300 }, (_, i) => ({ ticker: sym(i), company: `Synthetic Co ${i}`, tier: i % 2 ? 'STRONG' : 'BLOCKBUSTER', filing_date: '2026-08-12' }))
  .concat([{ ticker: 'SYN000', company: 'dup older', tier: 'STRONG', filing_date: '2026-05-01' }, { ticker: 'NOTCB', company: 'x', tier: 'MIXED', filing_date: '2026-08-01' }]);
const LOCAL = [...Array.from({ length: 6 }, (_, i) => ({ ticker: sym(i), company: null })), ...Array.from({ length: 14 }, (_, i) => ({ ticker: `${sym(300 + i)}@Q1-2027`, company: null }))];
const SYNCED = ['SYN400', 'SYN401', 'SYN402', 'SYN403', 'SYN001'];
const HELD = [...Array.from({ length: 51 }, (_, i) => `HOLD${i}`), 'SYN010', 'syn011.ns'];

describe('zzz811 — all Conviction Beats names join the India bench', () => {
  const b = buildIndiaBench({ held: HELD, server: SERVER, local: LOCAL, synced: SYNCED, updatedAt: '2026-09-27T20:00:00Z' });

  test('every name on the list is on the page: bench + held-on-list = list total', () => {
    assert.equal(b.info.total, 318);
    assert.equal(b.info.server, 300);
    assert.equal(b.info.localOnly, 14);
    assert.equal(b.info.syncedOnly, 4);
    assert.equal(b.bench.length + b.heldOnCb.length, b.info.total);
    assert.deepEqual(b.heldOnCb.sort(), ['SYN010', 'SYN011']);
    for (let i = 0; i < 314; i++) if (i !== 10 && i !== 11) assert.ok(b.bench.includes(sym(i)), `missing ${sym(i)}`);
    assert.ok(!b.bench.includes('NOTCB'), 'a MIXED tier is not Conviction Beats');
  });

  test('a fresh phone (empty browser list, tiny synced book) still gets the whole server list', () => {
    const phone = buildIndiaBench({ held: HELD, server: SERVER, local: [], synced: ['SYN001', 'SYN002', 'SYN003', 'SYN004'] });
    assert.equal(phone.bench.length, 298);
    assert.equal(phone.info.syncedOnly, 0);
  });

  test('the old path (synced flags + a small local list) is what gave "Bench 2"; the server list alone fixes it', () => {
    const old = buildIndiaBench({ held: HELD, server: [], local: [], synced: ['SYN001', 'SYN002', 'SYN003', 'SYN004'] });
    assert.equal(old.bench.length, 4);
    assert.equal(indiaBenchLine(old.info, 0, 4, { bench: 4, pass: 0, fail: 0, unknown: 4 }, 0).includes('server list not read'), true);
  });

  test('book/bench dedupe: a held name appears once, as book; archive keys fold to one ticker', () => {
    const u = mergeUniverse(HELD.map(cbTicker), b.bench);
    assert.equal(u.size, 53 + b.bench.length);
    assert.equal(u.get('SYN010'), 'book');
    assert.equal(u.get('SYN011'), 'book');
    assert.equal(cbTicker('MTAR@Q3-2026'), 'MTAR');
    assert.equal(new Set(b.bench).size, b.bench.length);
    const oc = originCounts(u.values());
    assert.equal(oc.book + (oc.total - oc.book), oc.total);
    assert.equal(oc.book, 53);
  });

  test('the preset LABELS instead of hiding: pass / fail with reasons / not checked yet', () => {
    assert.equal(presetLabelIndia(graded(0)).state, 'pass');
    const f = presetLabelIndia(graded(1));
    assert.equal(f.state, 'fail');
    assert.match(f.text, /sales growth 11% is below 20%/);
    const f2 = presetLabelIndia(graded(2));
    assert.equal(f2.state, 'fail');
    assert.equal(f2.reasons.length, 2, 'every failing gate is named');
    assert.equal(presetLabelIndia(graded(3)).state, 'unknown', 'an unknown market cap alone is not a fail');
    assert.equal(presetLabelIndia(null).state, 'unknown', 'no graded row is not a fail');
    assert.equal(presetLabelIndia({ source: 'none' }).state, 'unknown');
    // the label and the alert rule are one rule
    for (let i = 0; i < 40; i++) assert.equal(indiaPresetCheck(graded(i)).pass, passesIndiaPreset(graded(i)));
    // no BUY/SELL words, no visible 0–100 score in any label
    for (let i = 0; i < 8; i++) {
      const t = presetLabelIndia({ ...graded(i), verdict: 'SELL', pead_score: 12 }).text;
      assert.doesNotMatch(t, /\b(BUY|SELL)\b/);
      assert.doesNotMatch(t, /\b12\b/);
    }
  });

  test('assessed rows carry the label, and every bench row stays on the page', () => {
    const rows = b.bench.map((s) => {
      const i = Number(s.slice(3));
      const g = i < 300 ? graded(i) : null;
      return assessBookRow({ symbol: s, origin: 'bench', market: 'IN', graded: g, tier: g?.tier || null, pattern: g ? classifyOrNearest(g) : null,
        radarScore: null, summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null } as any);
    });
    assert.equal(rows.length, b.bench.length);
    const pc = benchPresetCounts(rows);
    assert.equal(pc.bench, rows.length);
    assert.equal(pc.pass + pc.fail + pc.unknown, pc.bench);
    assert.ok(pc.pass > 50 && pc.fail > 100 && pc.unknown > 50);
    // provisional (nearest-fit) is never affirmative on a bench name with no filing read
    for (const r of rows) assert.ok(!['STRENGTHENING', 'ON_TRACK'].includes(String(r.assessment?.status)) || r.pattern?.fit !== 'nearest');
  });

  test('the header counts add up and say what they cover', () => {
    const shown = { bench: 290, pass: 70, fail: 150, unknown: 70 };
    const line = indiaBenchLine(b.info, b.heldOnCb.length, b.bench.length, shown, b.bench.length - 290);
    assert.match(line, new RegExp(`^${IN_CB_SOURCE.replace(/[()]/g, '\\$&')} 318 = 2 you hold \\(shown once, in My book\\) \\+ 316 on the bench`));
    assert.match(line, /bench 316 − 26 large caps hidden = 290 shown = 70 pass the preset \+ 150 do not \+ 70 not checked yet/);
    assert.match(line, /server list 300 \(updated 2026-09-27\) \+ 14 only in this browser \+ 4 only in your synced book/);
    // universe line: total − hidden = shown = book + bench
    const all = [...Array(53).fill({ origin: 'book', market: 'IN', assessment: { status: 'NEUTRAL' } }), ...Array(316).fill({ origin: 'bench', market: 'IN', assessment: { status: 'CONFIRMATION_REQUIRED' } })];
    const sized = all.slice(0, 53 + 290);
    const uc = universeCounts(all, sized, [...RESEARCH_EXPORT_STATUSES]);
    assert.equal(uc.shown, uc.book + uc.bench);
    assert.equal(uc.total - uc.hiddenLargeCap, uc.shown);
    assert.match(uc.line, /^369 total − 26 large caps hidden = 343 shown = 53 book \+ 290 bench/);
  });

  test('progressive window: 30 at a time, never past the end', () => {
    assert.equal(PC_PAGE_STEP, 30);
    assert.equal(nextWindow(30, 316), 60);
    assert.equal(nextWindow(300, 316), 316);
    assert.equal(nextWindow(0, 10), 10);
  });

  test('performance: join + assess 314 names, and render only the first window', () => {
    const t0 = performance.now();
    const bb = buildIndiaBench({ held: HELD, server: SERVER, local: LOCAL, synced: SYNCED });
    const u = mergeUniverse(HELD.map(cbTicker), bb.bench);
    const t1 = performance.now();
    const rows = Array.from(u.entries()).map(([s, origin]) => {
      const i = s.startsWith('SYN') ? Number(s.slice(3)) : -1;
      const g = i >= 0 && i < 300 ? graded(i) : null;
      return assessBookRow({ symbol: s, origin, market: 'IN', graded: g, tier: g?.tier || null, pattern: g ? classifyOrNearest(g) : null,
        radarScore: null, summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null } as any);
    });
    const t2 = performance.now();
    const html = rows.slice(0, PC_PAGE_STEP).map((r: any) => renderToStaticMarkup(React.createElement(ThesisCard as any, {
      symbol: r.symbol, market: r.market, tier: r.tier, pattern: r.pattern, radarScore: null, assessment: r.assessment, capex: r.capex, origin: r.origin,
      needsRead: true, reading: false, onRead() {}, onCheck() {}, onReread() {}, ledger: null, freshness: null, reportingPeriod: null, changed: [], changedFrom: null,
      persisted: null, readNote: null, promiseNote: null, dataSource: r.graded ? 'graded' : null,
    }))).join('');
    const t3 = performance.now();
    // eslint-disable-next-line no-console
    console.log(`[zzz811 timing] join ${u.size} names: ${(t1 - t0).toFixed(1)} ms · assess ${rows.length} rows: ${(t2 - t1).toFixed(1)} ms · render first ${PC_PAGE_STEP} cards: ${(t3 - t2).toFixed(1)} ms (${html.length} chars)`);
    assert.equal(rows.length, 53 + 316);
    assert.ok(t1 - t0 < 200, 'join is fast');
    assert.ok(t2 - t1 < 8000, 'assessing the whole universe stays in seconds, not minutes');
  });
});

describe('zzz811 — bulk reads: book + preset-passing bench by default, the rest is a separate manual button', () => {
  const rows = [
    { symbol: 'A', origin: 'book', preset: null }, { symbol: 'B', origin: 'both', preset: { state: 'fail' } },
    { symbol: 'C', origin: 'bench', preset: { state: 'pass' } }, { symbol: 'D', origin: 'bench', preset: { state: 'fail' } },
    { symbol: 'E', origin: 'bench', preset: { state: 'unknown' } }, { symbol: 'F', origin: 'bench' },
  ];
  test('India: default = book + bench passing preset; other = the rest of the bench', () => {
    const s = readScope(rows, 'IN');
    assert.deepEqual(s.primary.map((r) => r.symbol), ['A', 'B', 'C']);
    assert.deepEqual(s.otherBench.map((r) => r.symbol), ['D', 'E', 'F']);
    assert.equal(s.primary.length + s.otherBench.length, rows.length);
  });
  test('US: default = the US book; every bench name is in the separate button (preset not applied)', () => {
    const s = readScope(rows, 'US');
    assert.deepEqual(s.primary.map((r) => r.symbol), ['A', 'B']);
    assert.deepEqual(s.otherBench.map((r) => r.symbol), ['C', 'D', 'E', 'F']);
  });
  test('the separate button says what it costs', () => {
    assert.equal(otherBenchLabel(212), 'Also read the other 212 bench names (about 212 AI reads)');
    assert.equal(otherBenchLabel(1), 'Also read the other 1 bench name (about 1 AI read)');
  });
  test('both pages: bulk buttons use the default scope; the other-bench read runs only on click', () => {
    const inPage = read('app/(dashboard)/portfolio-catalysts/page.tsx');
    const usPage = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    for (const src of [inPage, usPage]) {
      assert.doesNotMatch(src, /readAll\((list|inSource)\.map/, 'no bulk read over the whole bench');
      assert.match(src, /otherBenchLabel\(/);
      assert.match(src, /readScope\(/);
      // the other-bench read appears only inside onClick handlers
      const calls = src.match(/readAll\((otherSyms|needReadOther[^)]*)\)/g) || [];
      assert.ok(calls.length >= 1);
      for (const line of src.split('\n').filter((l) => /readAll\((otherSyms|needReadOther)/.test(l))) assert.match(line, /onClick=/);
      assert.match(src, /onClick=\{stop\}/, 'Stop is still offered');
    }
    assert.doesNotMatch(read('lib/thesis/use-book.ts'), /resumeRef\.current = (?!null)/, 'no automatic resume of reads');
  });
});

describe('zzz811 — pages: no gate, no silent removal, US wording on the US page', () => {
  const inPage = read('app/(dashboard)/portfolio-catalysts/page.tsx');
  const usPage = read('app/(dashboard)/us-portfolio-catalysts/page.tsx').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const useBook = read('lib/thesis/use-book.ts');
  const useUs = read('lib/us-thesis/use-us-book.ts');

  test('India: the bench reads the server Conviction Beats list and no longer gates on the preset', () => {
    assert.match(useBook, /\/api\/v1\/bench\?view=tickers/);
    assert.doesNotMatch(useBook, /benchPassingPreset\(/);
    assert.match(inPage, /Bench passing preset/);
    assert.match(inPage, /bench-preset-label/);
    assert.match(inPage, /large caps hidden/, 'the size filter says what it hides');
    assert.match(inPage, /visible\.map\(/, 'cards render from the progressive window');
  });

  test('US: US data and US wording only', () => {
    assert.match(useUs, /\/api\/v1\/bench-us\?view=tickers/);
    assert.doesNotMatch(useUs, /\/api\/v1\/bench[?'"`]/);
    assert.doesNotMatch(useUs, /use-book'|readConvictionBeats\(/, 'never reads the India book or India Conviction Beats');
    assert.match(usPage, /SEC/);
    assert.match(usPage, /EDGAR/);
    assert.doesNotMatch(usPage, /\bNSE\b|research export \(NSE\)|uc\.line|₹|crore|\bCr\b/);
    assert.doesNotMatch(usPage, /useBook\(/);
    assert.match(usPage, /market: 'US'/);
    const us = universeCounts([{ origin: 'bench', market: 'US', assessment: { status: 'CONFIRMATION_REQUIRED' } }], [{ origin: 'bench', market: 'US', assessment: { status: 'CONFIRMATION_REQUIRED' } }], [...RESEARCH_EXPORT_STATUSES], { market: 'US' });
    assert.doesNotMatch(us.line, /NSE/);
    assert.match(us.line, /US-listed, SEC filers/);
    assert.match(usPage, /visible\.map\(/);
  });

  test('page files keep only a default export', () => {
    for (const src of [inPage, usPage]) {
      const named = src.match(/^export\s+(?!default\b)(const|function|interface|type|class|async)\b.*$/gm) || [];
      assert.deepEqual(named, []);
    }
  });
});
