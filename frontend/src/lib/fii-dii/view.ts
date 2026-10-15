// zzz1055 — FII / DII flows: the GET /api/v1/fii-dii answer, built from stored rows (pure, unit-tested).
import {
  streakOf, buyShare, rangeStart, cumulativeSeries, rollingSum, sumSince, sectorTable,
  type DailyRow, type Range, type SectorFortnightRow, type Streak, type SectorTable,
} from './compute';

export interface TodayCard {
  date: string;
  provisional: boolean;
  source: 'nse' | 'nsdl';
  fii: { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null };
  dii: { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null } | null;
  combinedNet: number | null;
  fpiConfirmedNet: number | null;
  fetchedAt: string | null;
}
export interface FiiDiiView {
  ok: true;
  available: boolean;
  today: TodayCard | null;
  streaks: { fii: Streak; dii: Streak; combined: Streak };
  totals: { fii1m: { sum: number; days: number }; dii1m: { sum: number; days: number } };
  range: Range;
  history: Array<{ date: string; fii: number | null; dii: number | null; fiiCum: number; fii20: number | null; dii20: number | null; source: 'nse' | 'nsdl'; provisional: boolean }>;
  coverage: { firstDate: string | null; firstNseDate: string | null; lastDate: string | null; days: number };
  sectors: SectorTable;
}

const fiiOf = (r: DailyRow) => r.fiiNet;
const diiOf = (r: DailyRow) => r.diiNet;
const combOf = (r: DailyRow) => (r.fiiNet != null && r.diiNet != null ? r.fiiNet + r.diiNet : null);

export function buildView(all: readonly DailyRow[], sectorRows: readonly SectorFortnightRow[], range: Range): FiiDiiView {
  const asc = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const last = asc[asc.length - 1] ?? null;
  // today's card: the latest day with NSE figures (FII + DII); before any NSE row exists, the latest NSDL FII-only day
  const lastNse = [...asc].reverse().find((r) => r.source === 'nse') ?? null;
  const t = lastNse ?? last;
  const today: TodayCard | null = t ? {
    date: t.date, provisional: t.provisional, source: t.source,
    fii: { buy: t.fiiBuy, sell: t.fiiSell, net: t.fiiNet, buySharePct: buyShare(t.fiiBuy, t.fiiSell) },
    dii: t.diiNet != null ? { buy: t.diiBuy, sell: t.diiSell, net: t.diiNet, buySharePct: buyShare(t.diiBuy, t.diiSell) } : null,
    combinedNet: combOf(t) != null ? Math.round(combOf(t)! * 100) / 100 : null,
    fpiConfirmedNet: t.fpiFinalNet,
    fetchedAt: t.fetchedAt,
  } : null;
  const from = last ? rangeStart(range, last.date) : null;
  const inRange = from ? asc.filter((r) => r.date >= from) : asc;
  const cum = new Map(cumulativeSeries(inRange, fiiOf).map((p) => [p.date, p.cum]));
  // rolling sums use the days before the range too, so the first points of a short range are not blank
  const f20 = new Map(rollingSum(asc, fiiOf).map((p) => [p.date, p.sum]));
  const d20 = new Map(rollingSum(asc, diiOf).map((p) => [p.date, p.sum]));
  let lastCum = 0;
  const history = inRange.map((r) => {
    if (cum.has(r.date)) lastCum = cum.get(r.date)!;
    return { date: r.date, fii: r.fiiNet, dii: r.diiNet, fiiCum: lastCum, fii20: f20.get(r.date) ?? null, dii20: d20.get(r.date) ?? null, source: r.source, provisional: r.provisional };
  });
  const monthAgo = last ? rangeStart('1M', last.date)! : '9999-12-31';
  return {
    ok: true,
    available: asc.length > 0,
    today,
    streaks: { fii: streakOf(asc, fiiOf), dii: streakOf(asc, diiOf), combined: streakOf(asc, combOf) },
    totals: { fii1m: sumSince(asc, fiiOf, monthAgo), dii1m: sumSince(asc, diiOf, monthAgo) },
    range,
    history,
    coverage: { firstDate: asc[0]?.date ?? null, firstNseDate: asc.find((r) => r.source === 'nse')?.date ?? null, lastDate: last?.date ?? null, days: asc.length },
    sectors: sectorTable(sectorRows),
  };
}
