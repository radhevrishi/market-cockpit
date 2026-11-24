// Options Ideas — historical study + model fit (run by hand, not part of the app).
//   node --import tsx scripts/options-ideas-study.ts <barsDir> <idxUS.json> <idxIN.json> [tradesDir]
// barsDir: chart-API answers saved as <TICKER>.<US|IN>.json (GET /api/v1/chart/<T>?market=&interval=1d&range=5y).
// tradesDir (optional): saved study results ({ trades }) — skips re-running the walk.
// Writes src/lib/options-ideas/model-coeffs.ts (STUDY: per market / side / grade and per setup type, before and after the
// hold-out date OI_TEST_FROM, default 2025-07-01).
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { study, aggregate, optionReturn, type Trade } from '../src/lib/options-ideas/backtest';
import { classify, indexCtx, type RawFeatures, type StudyStats, type GroupStats, type Grade } from '../src/lib/options-ideas/model';
import type { PBar } from '../src/lib/chart-patterns';
import { SETUPS_VERSION } from '../src/lib/options-ideas/setups';

const [barsDir, idxUS, idxIN, tradesDir] = process.argv.slice(2);
const toBars = (j: any): PBar[] => { const B = j.bars; return (B?.t ?? []).map((t: number, i: number) => ({ t, o: B.o[i], h: B.h[i], l: B.l[i], c: B.c[i], v: B.v[i] ?? 0 })).filter((q: PBar) => q.c != null && q.o != null && q.l > 0); };
const idx = { US: toBars(JSON.parse(readFileSync(idxUS, 'utf8'))), IN: toBars(JSON.parse(readFileSync(idxIN, 'utf8'))) };

let trades: Trade[] = [];
if (tradesDir) {
  for (const f of readdirSync(tradesDir).filter((x) => x.endsWith('.json'))) trades.push(...JSON.parse(readFileSync(join(tradesDir, f), 'utf8')).trades);
} else {
  for (const f of readdirSync(barsDir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(barsDir, f), 'utf8'));
    const m = f.includes('.IN.') ? 'IN' : 'US';
    trades.push(...study(toBars(j), m, j.ticker).trades);

  }
}
const raw = (t: Trade): RawFeatures => ({
  id: t.id, side: t.side, market: t.market,
  ret20: Number(t.features.ret20), ret60: Number(t.features.ret60), vs50: Number(t.features.vs50), vs200: Number(t.features.vs200),
  trend: Number(t.features.trend ?? 0), touches: Number(t.features.touches ?? 0), vr: Number(t.features.vr ?? 1), rr1: t.rr1, riskPct: t.riskPct,
  atrPct: Number(t.features.atrPct ?? 0), triggered: t.triggered, idx: indexCtx(idx[t.market], ms(t.signalT)),
});
const ms = (t: number) => (t > 1e11 ? t : t * 1000);
const testFrom = Date.parse(process.env.OI_TEST_FROM || '2025-07-01');
const OPT_DELTA = 0.5, OPT_DTE = 30;
const graded = trades.map((t) => ({ t, g: classify(raw(t)).grade }));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r2 = (x: number) => Math.round(x * 100) / 100, r1 = (x: number) => Math.round(x * 10) / 10;
const stats = (rows: Trade[]): GroupStats => {
  const a = aggregate(rows);
  const tr = rows.filter((t) => ms(t.signalT) < testFrom), te = rows.filter((t) => ms(t.signalT) >= testFrom);
  const opt = (x: Trade[]) => (x.length ? r1(mean(x.map((t) => optionReturn(t, OPT_DELTA, OPT_DTE, 'trail'))) * 100) : null);
  const optAll = rows.map((t) => optionReturn(t, OPT_DELTA, OPT_DTE, 'trail'));
  return {
    n: a.n, winRate: a.winRate, avgR: a.avgR, trailR: r2(mean(rows.map((t) => t.rTrail))), medSessions: a.medSessions,
    optAvgRet: rows.length ? r1(mean(optAll) * 100) : null, optWinRate: rows.length ? r1((optAll.filter((x) => x > 0).length / rows.length) * 100) : null,
    trainR: r2(mean(tr.map((t) => t.rTrail))), testR: r2(mean(te.map((t) => t.rTrail))), trainOpt: opt(tr), testOpt: opt(te),
  };
};
const groups: Record<string, GroupStats> = {};
const by = (key: (x: { t: Trade; g: Grade }) => string) => { const m = new Map<string, Trade[]>(); for (const x of graded) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x.t); } for (const [k, v] of m) if (v.length >= 20) groups[k] = stats(v); };
by((x) => `${x.t.market}|${x.t.side}|${x.g}`);
by((x) => `${x.t.market}|${x.t.id}|${x.g}`);
by((x) => `ALL|${x.t.side}|${x.g}`);
by((x) => `ALL|${x.t.id}|${x.g}`);
// how winners and losers behaved (grade A calls)
const A = graded.filter((x) => x.g === 'A').map((x) => x.t);
const win = A.filter((t) => t.outcome === 'target'), lose = A.filter((t) => t.outcome === 'stop');
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const all = graded.map((x) => x.t);
const findings = [
  `All ${all.length.toLocaleString('en-US')} setups together: calls ${aggregate(all.filter((t) => t.side === 'CALL')).avgR} R a trade, puts ${aggregate(all.filter((t) => t.side === 'PUT')).avgR} R — the pattern alone is close to a coin toss.`,
  `Grade A calls (healthy stock + healthy market + near target): ${A.length.toLocaleString('en-US')} trades, ${groups['ALL|CALL|A']?.trailR ?? 0} R a trade, ${groups['ALL|CALL|A']?.trainR ?? 0} R before ${new Date(testFrom).toISOString().slice(0, 7)} and ${groups['ALL|CALL|A']?.testR ?? 0} R after (hold-out).`,
  `Winners took a median ${med(win.map((t) => t.sessions))} sessions to reach target 1; ${pct(win.filter((t) => t.maeR > -0.5).length, win.length)}% of them never went more than half the risk against the entry.`,
  `Losers: ${pct(lose.filter((t) => t.sessions <= 3).length, lose.length)}% were stopped within 3 sessions; ${pct(lose.filter((t) => t.mfeR >= 1).length, lose.length)}% had first been up 1R or more — so moving the stop to the entry at +1R is in the plan.`,
  `Grade A options (delta ${OPT_DELTA}, ${OPT_DTE}+ days, stop to entry at +1R, aim for target 2): average ${groups['ALL|CALL|A']?.optAvgRet ?? 0}% a trade, but only ${groups['ALL|CALL|A']?.optWinRate ?? 0}% of trades made money — a few big winners pay for many small losses. Size every trade so a full loss of the premium is fine.`,
  `Puts lost money in every condition tried (including falling markets: sharp bear-market rallies stopped them). They are shown as hedge / watch ideas only.`,
];
const pick = (rows: Trade[], n: number) => rows.slice(0, n).map((t) => ({ market: t.market, ticker: t.ticker, id: t.id, grade: 'A' as Grade, date: new Date(ms(t.signalT)).toISOString().slice(0, 10), r: t.rTrail, outcome: t.outcome, sessions: t.trailSessions, optRet: r1(optionReturn(t, OPT_DELTA, OPT_DTE, 'trail') * 100) }));
const recentA = [...A].sort((a, b) => ms(b.signalT) - ms(a.signalT));
const examples = [...pick(recentA.filter((t) => t.rTrail > 1), 8), ...pick(recentA.filter((t) => t.rTrail < 0), 8)];
const out: StudyStats = {
  version: `${SETUPS_VERSION}-${new Date().toISOString().slice(0, 10)}`,
  groups, examples,
  option: { delta: OPT_DELTA, minDte: OPT_DTE, note: 'In the study delta 0.5 with 30+ days was the steadiest; shorter or cheaper options averaged more but with deeper drawdowns.' },
  trainedOn: { trades: trades.length, companies: new Set(trades.map((t) => `${t.market}:${t.ticker}`)).size, from: new Date(ms(trades[0].signalT)).toISOString().slice(0, 10), to: new Date(ms(trades[trades.length - 1].signalT)).toISOString().slice(0, 10), testFrom: new Date(testFrom).toISOString().slice(0, 10) },
  findings,
};
writeFileSync('src/lib/options-ideas/model-coeffs.ts', `// GENERATED by scripts/options-ideas-study.ts — do not edit by hand. Study numbers behind the Options Ideas grades.\nimport type { StudyStats } from './model';\nexport const STUDY: StudyStats = ${JSON.stringify(out)};\n`);
console.log(findings.join('\n'));
for (const k of Object.keys(groups).filter((k) => k.startsWith('ALL|') || k.split('|')[2] === 'A').sort()) console.log(k.padEnd(28), JSON.stringify(groups[k]));
