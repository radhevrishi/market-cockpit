// Options Ideas — historical study + model fit (run by hand, not part of the app).
//   node --import tsx scripts/options-ideas-study.ts <barsDir> <idxUS.json> <idxIN.json> [tradesDir]
// barsDir: chart-API answers saved as <TICKER>.<US|IN>.json (GET /api/v1/chart/<T>?market=&interval=1d&range=5y).
// tradesDir (optional): saved study results ({ trades }) — skips re-running the walk.
// Writes src/lib/options-ideas/model-coeffs.ts (STUDY: per market / side / grade and per setup type, before and after the
// hold-out date OI_TEST_FROM, default 2025-07-01).
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { study, aggregate, optionReturn, type Trade } from '../src/lib/options-ideas/backtest';
import { extraCtx } from '../src/lib/options-ideas/context';
import { classify, finalGrade, indexCtx, type RawFeatures, type StudyStats, type GroupStats, type Grade } from '../src/lib/options-ideas/model';
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
// zzz1301e — extra context per trade: catalyst / volume / HV percentile from the company's own bars, sector strength from the
// median 3-month return of companies in the same sector (OI_IND_US / OI_IND_IN = JSON { ticker: { sec } } from the screener).
const barsBy: Record<string, PBar[]> = {};
for (const f of readdirSync(barsDir).filter((x) => x.endsWith('.json'))) barsBy[`${f.includes('.IN.') ? 'IN' : 'US'}:${f.split('.')[0]}`] = toBars(JSON.parse(readFileSync(join(barsDir, f), 'utf8')));
const indMap: Record<string, Record<string, { sec?: string | null }>> = { US: process.env.OI_IND_US ? JSON.parse(readFileSync(process.env.OI_IND_US, 'utf8')) : {}, IN: process.env.OI_IND_IN ? JSON.parse(readFileSync(process.env.OI_IND_IN, 'utf8')) : {} };
const dk = (t: number) => new Date(t > 1e11 ? t : t * 1000).toISOString().slice(0, 10);
const r60: Record<string, Map<string, number>> = {};
for (const k in barsBy) { const b = barsBy[k], m = new Map<string, number>(); for (let i = 60; i < b.length; i++) m.set(dk(b[i].t), (b[i].c / b[i - 60].c - 1) * 100); r60[k] = m; }
const secMembers: Record<string, string[]> = {};
for (const k in barsBy) { const [m, t] = k.split(':'); const sec = indMap[m][t]?.sec; if (sec) (secMembers[`${m}|${sec}`] ||= []).push(k); }
const secMedAt = (m: string, sec: string, day: string) => { const v = (secMembers[`${m}|${sec}`] || []).map((k) => r60[k].get(day)).filter((x): x is number => x != null).sort((a, b) => a - b); return v.length >= 4 ? v[Math.floor(v.length / 2)] : null; };
const extraOf = (t: Trade, ixRet60: number | null) => {
  const k = `${t.market}:${t.ticker}`, b = barsBy[k];
  const si = b ? b.findIndex((q) => q.t === t.signalT) : -1;
  if (!b || si < 260) return {};
  const e = extraCtx(b, si);
  const sec = indMap[t.market][t.ticker]?.sec;
  const sm = sec ? secMedAt(t.market, sec, dk(t.signalT)) : null;
  return { gap60: e.gap60, rvol: e.rvol, hvPct: e.hvPct, secStrong: sm != null && ixRet60 != null ? sm > ixRet60 : null };
};
const vixMap: Record<string, Record<string, number>> = { US: process.env.OI_VIX_US ? JSON.parse(readFileSync(process.env.OI_VIX_US, 'utf8')) : {}, IN: process.env.OI_VIX_IN ? JSON.parse(readFileSync(process.env.OI_VIX_IN, 'utf8')) : {} };
const vixAt = (m: string, t: number) => { for (let k = 0; k < 6; k++) { const v = vixMap[m][dk(ms(t) - k * 86_400_000)]; if (v != null) return v; } return null; };
const raw = (t: Trade): RawFeatures => ({
  id: t.id, side: t.side, market: t.market,
  ret20: Number(t.features.ret20), ret60: Number(t.features.ret60), vs50: Number(t.features.vs50), vs200: Number(t.features.vs200),
  trend: Number(t.features.trend ?? 0), touches: Number(t.features.touches ?? 0), vr: Number(t.features.vr ?? 1), rr1: t.rr1, riskPct: t.riskPct,
  atrPct: Number(t.features.atrPct ?? 0), triggered: t.triggered, idx: indexCtx(idx[t.market], ms(t.signalT)),
  ...extraOf(t, indexCtx(idx[t.market], ms(t.signalT))?.ret60 ?? null),
  vix: vixAt(t.market, t.signalT),
});
const ms = (t: number) => (t > 1e11 ? t : t * 1000);
const testFrom = Date.parse(process.env.OI_TEST_FROM || '2025-07-01');
const OPT_DELTA = 0.5, OPT_DTE = 30;
const pre = trades.map((t) => { const f = raw(t); return { t, f, c0: classify(f) }; });
const mean0 = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
// the setup-type gate table: grade-A conditions before the gate, per market and setup
const groups0: Record<string, GroupStats> = {};
{ const m = new Map<string, Trade[]>(); for (const x of pre) if ((x.c0.grade === 'A' || x.c0.grade === 'A+')) { const k = `${x.t.market}|${x.t.id}|A0`; if (!m.has(k)) m.set(k, []); m.get(k)!.push(x.t); }
  for (const [k, v] of m) groups0[k] = { n: v.length, winRate: 0, avgR: 0, trailR: Math.round(mean0(v.map((t) => t.rTrail)) * 100) / 100, medSessions: 0, optAvgRet: null, optWinRate: null, trainR: 0, testR: 0, trainOpt: null, testOpt: null }; }
const graded = pre.map((x) => ({ t: x.t, g: finalGrade(x.f, x.c0, groups0).grade }));
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
const groupsA0Stats = (() => { const m = new Map<string, Trade[]>(); for (const x of pre) if ((x.c0.grade === 'A' || x.c0.grade === 'A+')) { const k = `${x.t.market}|${x.t.id}|A0`; if (!m.has(k)) m.set(k, []); m.get(k)!.push(x.t); } return m; })();
const by = (key: (x: { t: Trade; g: Grade }) => string) => { const m = new Map<string, Trade[]>(); for (const x of graded) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x.t); } for (const [k, v] of m) if (v.length >= 20) groups[k] = stats(v); };
by((x) => `${x.t.market}|${x.t.side}|${x.g}`);
by((x) => `${x.t.market}|${x.t.id}|${x.g}`);
by((x) => `ALL|${x.t.side}|${x.g}`);
by((x) => `ALL|${x.t.id}|${x.g}`);
for (const [k, v] of groupsA0Stats) if (v.length >= 20) groups[k] = stats(v);
// how winners and losers behaved (grade A calls)
const A = graded.filter((x) => x.g === 'A' || x.g === 'A+').map((x) => x.t);
const win = A.filter((t) => t.outcome === 'target'), lose = A.filter((t) => t.outcome === 'stop');
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const all = graded.map((x) => x.t);
const findings = [
  `All ${all.length.toLocaleString('en-US')} setups together: calls ${aggregate(all.filter((t) => t.side === 'CALL')).avgR} R a trade, puts ${aggregate(all.filter((t) => t.side === 'PUT')).avgR} R — the pattern alone is close to a coin toss.`,
  `Grade A+ calls (all checks + a fresh catalyst): ${groups['ALL|CALL|A+']?.n ?? 0} trades, ${groups['ALL|CALL|A+']?.trailR ?? 0} R a trade (${groups['ALL|CALL|A+']?.trainR ?? 0} before ${new Date(testFrom).toISOString().slice(0, 7)}, ${groups['ALL|CALL|A+']?.testR ?? 0} after); options ${groups['ALL|CALL|A+']?.optAvgRet ?? 0}% a trade, ${groups['ALL|CALL|A+']?.optWinRate ?? 0}% of them profitable.`,
  `Grade A calls (healthy stock, market and sector + near target, no catalyst): ${groups['ALL|CALL|A']?.n ?? 0} trades, ${groups['ALL|CALL|A']?.trailR ?? 0} R a trade (${groups['ALL|CALL|A']?.trainR ?? 0} before, ${groups['ALL|CALL|A']?.testR ?? 0} after).`,
  `10-year replay (2018–2026, incl. the 2020 crash and the 2022 bear market): calls bought when fear was high (VIX ≥ 25 / India VIX ≥ 20) made +0.49 R a trade — positive in 8 of 9 years, +0.57 R even with the market below its 200-day. Puts did WORST then (−0.55 R at VIX ≥ 30) and lost in 2022 too: a falling market is not a put signal — sharp rallies stop puts out. So high fear makes calls grade A.`,
  `Tested and NOT adopted (replay 24 Nov 2026): a time stop (exit if not +0.5R in 10 sessions) cut grade A results from +0.29 to +0.20 R; call spreads (sell at target 1) averaged +5–7% a trade vs +22% for the plain call — shown as a cheaper alternative only; puts on SPY / QQQ / IWM / Nifty / Bank Nifty lost money too (−0.35 R a trade over 10 years); a weekly Stage 2 check added nothing.`,
  `Moving the stop to the entry at +1R: +0.28 R a trade vs +0.22 R holding to the first stop or target — kept.`,
  `Options bought when the stock's 20-day volatility is in the top 30% of its year returned about a quarter of the others (+6% vs +24–29%) — the page warns when that is the case.`,
  `Selling a 30-day put (delta ~0.3) instead of buying the call on grade A ideas: +0.6% of the strike a month, profitable 60% of the time — an income alternative for stocks you want to own.`,
  `Winners took a median ${med(win.map((t) => t.sessions))} sessions to reach target 1; ${pct(win.filter((t) => t.maeR > -0.5).length, win.length)}% of them never went more than half the risk against the entry.`,
  `Losers: ${pct(lose.filter((t) => t.sessions <= 3).length, lose.length)}% were stopped within 3 sessions; ${pct(lose.filter((t) => t.mfeR >= 1).length, lose.length)}% had first been up 1R or more — so moving the stop to the entry at +1R is in the plan.`,
  `Grade A options (delta ${OPT_DELTA}, ${OPT_DTE}+ days, stop to entry at +1R, aim for target 2): only about ${groups['ALL|CALL|A']?.optWinRate ?? 0}% of trades made money — a few big winners pay for many small losses. Size every trade so a full loss of the premium is fine.`,
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
