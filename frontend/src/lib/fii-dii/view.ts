// zzz1055 — FII / DII flows: the GET /api/v1/fii-dii answer, built from stored rows (pure, unit-tested).
// zzz1060 — plus the insights (positioning, absorption, streak history, sector grid + rotation, monthly totals, FII vs Nifty,
// FPI equity / debt split, "What it means today"). Each block is null / empty when its data is not stored, and the page hides it.
import {
  streakOf, buyShare, rangeStart, cumulativeSeries, rollingSum, sumSince, sectorTable,
  type DailyRow, type Range, type SectorFortnightRow, type Streak, type SectorTable,
} from './compute';
import {
  buildPositioning, absorption, streakHistory, sectorGrid, rotation, monthlyTotals, fiiVsMarket, assetMixMonths, summarize,
  type OiRow, type ClosePoint, type Positioning, type Absorption, type StreakHistory, type SectorGrid, type Rotation,
  type MonthTotal, type FiiVsMarket, type AssetMixMonth,
} from './insights';

export interface TodayCard {
  date: string;
  provisional: boolean;
  source: 'nse' | 'nsdl';
  fii: { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null };
  dii: { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null } | null;
  combinedNet: number | null;
  /** zzz1060 — combined buy / sell (FII + DII) when both are known */
  combinedBuy: number | null; combinedSell: number | null; combinedBuySharePct: number | null;
  /** zzz1060 — DII net as % of the FII selling that day (only when FII sold and DII bought) */
  absorbPct: number | null;
  fpiConfirmedNet: number | null;
  fetchedAt: string | null;
}
export interface BackfillStatus {
  daily: { cursor: string | null; done: boolean } | null;
  sectors: { done: boolean } | null;
  oi: { cursor: string | null; done: boolean } | null;
  oiLatest: string | null;
  niftyLatest: string | null;
}
export interface HistPointV { date: string; fii: number | null; dii: number | null; fiiCum: number; fii20: number | null; dii20: number | null; nifty: number | null; source: 'nse' | 'nsdl'; provisional: boolean }
export interface FiiDiiView {
  ok: true;
  available: boolean;
  today: TodayCard | null;
  streaks: { fii: Streak; dii: Streak; combined: Streak };
  totals: { fii1m: { sum: number; days: number }; dii1m: { sum: number; days: number } };
  range: Range;
  history: HistPointV[];
  coverage: { firstDate: string | null; firstNseDate: string | null; lastDate: string | null; days: number };
  sectors: SectorTable;
  // zzz1060
  sectorGrid: SectorGrid;
  rotation: Rotation | null;
  monthly: MonthTotal[];
  positioning: Positioning | null;
  absorption: Absorption[];
  streakHistory: StreakHistory | null;
  market: FiiVsMarket | null;
  assetMix: AssetMixMonth[];
  summary: string[];
  status: BackfillStatus | null;
}

export interface ViewExtras { oi?: readonly OiRow[]; closes?: readonly ClosePoint[]; status?: BackfillStatus | null }

const fiiOf = (r: DailyRow) => r.fiiNet;
const diiOf = (r: DailyRow) => r.diiNet;
const combOf = (r: DailyRow) => (r.fiiNet != null && r.diiNet != null ? r.fiiNet + r.diiNet : null);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function buildView(all: readonly DailyRow[], sectorRows: readonly SectorFortnightRow[], range: Range, extras: ViewExtras = {}): FiiDiiView {
  const asc = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const last = asc[asc.length - 1] ?? null;
  // today's card: the latest day with NSE figures (FII + DII); before any NSE row exists, the latest NSDL FII-only day
  const lastNse = [...asc].reverse().find((r) => r.source === 'nse') ?? null;
  const t = lastNse ?? last;
  const bothSides = t && t.fiiBuy != null && t.fiiSell != null && t.diiBuy != null && t.diiSell != null;
  const today: TodayCard | null = t ? {
    date: t.date, provisional: t.provisional, source: t.source,
    fii: { buy: t.fiiBuy, sell: t.fiiSell, net: t.fiiNet, buySharePct: buyShare(t.fiiBuy, t.fiiSell) },
    dii: t.diiNet != null ? { buy: t.diiBuy, sell: t.diiSell, net: t.diiNet, buySharePct: buyShare(t.diiBuy, t.diiSell) } : null,
    combinedNet: combOf(t) != null ? r2(combOf(t)!) : null,
    combinedBuy: bothSides ? r2(t.fiiBuy! + t.diiBuy!) : null,
    combinedSell: bothSides ? r2(t.fiiSell! + t.diiSell!) : null,
    combinedBuySharePct: bothSides ? buyShare(t.fiiBuy! + t.diiBuy!, t.fiiSell! + t.diiSell!) : null,
    absorbPct: t.fiiNet != null && t.diiNet != null && t.fiiNet < 0 && t.diiNet > 0 ? Math.round((t.diiNet / Math.abs(t.fiiNet)) * 100) : null,
    fpiConfirmedNet: t.fpiFinalNet,
    fetchedAt: t.fetchedAt,
  } : null;
  const from = last ? rangeStart(range, last.date) : null;
  const inRange = from ? asc.filter((r) => r.date >= from) : asc;
  const cum = new Map(cumulativeSeries(inRange, fiiOf).map((p) => [p.date, p.cum]));
  // rolling sums use the days before the range too, so the first points of a short range are not blank
  const f20 = new Map(rollingSum(asc, fiiOf).map((p) => [p.date, p.sum]));
  const d20 = new Map(rollingSum(asc, diiOf).map((p) => [p.date, p.sum]));
  const closes = extras.closes ?? [];
  const close = new Map(closes.map((c) => [c.date, c.close]));
  let lastCum = 0;
  const history = inRange.map((r) => {
    if (cum.has(r.date)) lastCum = cum.get(r.date)!;
    return { date: r.date, fii: r.fiiNet, dii: r.diiNet, fiiCum: lastCum, fii20: f20.get(r.date) ?? null, dii20: d20.get(r.date) ?? null, nifty: close.get(r.date) ?? null, source: r.source, provisional: r.provisional };
  });
  const monthAgo = last ? rangeStart('1M', last.date)! : '9999-12-31';
  const sectors = sectorTable(sectorRows);
  const grid = sectorGrid(sectorRows, 24);
  const positioning = buildPositioning(extras.oi ?? []);
  const absorb = absorption(asc);
  const sh = asc.some((r) => r.fiiNet != null) ? streakHistory(asc) : null;
  const market = closes.length ? fiiVsMarket(asc, closes, 20) : null;
  const rot = sectors.lines.length ? rotation(sectors.lines, grid) : null;
  const assetMix = assetMixMonths(asc.map((r) => ({ date: r.date, equity: r.fpiEqTotal ?? null, debt: r.fpiDebt ?? null, hybrid: r.fpiHybrid ?? null })), 6);
  const summary = asc.length ? summarize({
    today: today ? { date: today.date, fii: today.fii.net, dii: today.dii?.net ?? null } : null,
    streak: sh, absorption: absorb, todayAbsorbPct: today?.absorbPct ?? null, rotation: rot, positioning, market,
  }) : [];
  return {
    ok: true,
    available: asc.length > 0,
    today,
    streaks: { fii: streakOf(asc, fiiOf), dii: streakOf(asc, diiOf), combined: streakOf(asc, combOf) },
    totals: { fii1m: sumSince(asc, fiiOf, monthAgo), dii1m: sumSince(asc, diiOf, monthAgo) },
    range,
    history,
    coverage: { firstDate: asc[0]?.date ?? null, firstNseDate: asc.find((r) => r.source === 'nse')?.date ?? null, lastDate: last?.date ?? null, days: asc.length },
    sectors,
    sectorGrid: grid,
    rotation: rot,
    monthly: monthlyTotals(asc, 24),
    positioning,
    absorption: absorb,
    streakHistory: sh,
    market,
    assetMix,
    summary,
    status: extras.status ?? null,
  };
}
