// zzz1055 — FII / DII flows: the GET /api/v1/fii-dii answer, built from stored rows (pure, unit-tested).
// zzz1060 — plus the insights (positioning, absorption, streak history, sector grid + rotation, monthly totals, FII vs Nifty,
// FPI equity / debt split, "What it means today"). Each block is null / empty when its data is not stored, and the page hides it.
// zzz1067 (F01 / F02) — ONE FII series at a time, never two sources joined silently:
//   • 'nsdl' = NSDL's confirmed FPI equity net (stock-exchange route) — the long, consistent history; the latest day usually
//     arrives a working day later;
//   • 'nse'  = NSE's provisional FII/FPI net (the evening figure) — only from the day this app started saving it.
// The running total, 20-session sums, streak history, monthly bars and FII-vs-Nifty all use the chosen series (`basis`). The
// headline card always shows NSE's provisional number and says so, with NSDL's final figure beside it once it arrives. DII and
// the combined FII + DII come from NSE only (same source, same day, same scope). Rolling sums, streaks and period totals are
// checked against the NSE session calendar so missing days are shown, not hidden.
import {
  streakOf, buyShare, rangeStart, cumulativeSeries, rollingSum, sumSince, sectorTable, trailingSessions, UNKNOWN_CALENDAR,
  type DailyRow, type Range, type SectorFortnightRow, type Streak, type SectorTable, type SessionCalendar,
} from './compute';
import {
  buildPositioning, absorption, streakHistory, sectorGrid, rotation, monthlyTotals, fiiVsMarket, assetMixMonths, summarize,
  type OiRow, type ClosePoint, type Positioning, type Absorption, type StreakHistory, type SectorGrid, type Rotation,
  type MonthTotal, type FiiVsMarket, type AssetMixMonth,
} from './insights';

export type FiiBasis = 'nsdl' | 'nse';
export function parseBasis(s: unknown): FiiBasis | null {
  const t = String(s || '').toLowerCase();
  return t === 'nsdl' || t === 'nse' ? t : null;
}
export const BASIS_LABEL: Record<FiiBasis, string> = { nsdl: 'NSDL final (FPI, stock-exchange trades)', nse: 'NSE provisional (FII/FPI evening figure)' };

export interface TodayCard {
  date: string;
  /** zzz1067: true whenever the FII number shown is NSE's provisional figure — even after NSDL's final figure has arrived */
  provisional: boolean;
  source: 'nse' | 'nsdl';
  fii: { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null };
  dii: { buy: number | null; sell: number | null; net: number | null; buySharePct: number | null } | null;
  combinedNet: number | null;
  /** zzz1060 — combined buy / sell (FII + DII) when both are known */
  combinedBuy: number | null; combinedSell: number | null; combinedBuySharePct: number | null;
  /** zzz1060 — DII net as % of the FII selling that day (only when FII sold and DII bought) */
  absorbPct: number | null;
  /** NSDL's final FPI figure for the same day (a different number from a different source), once it has arrived */
  fpiConfirmedNet: number | null;
  /** zzz1067: what the headline FII number is, in words */
  fiiLabel: string;
  fetchedAt: string | null;
}
export interface Quarantine { at: string; problems: string[]; via?: string; report?: string }
export interface BackfillStatus {
  daily: { cursor: string | null; done: boolean } | null;
  sectors: { done: boolean } | null;
  oi: { cursor: string | null; done: boolean } | null;
  oiLatest: string | null;
  niftyLatest: string | null;
  /** zzz1067 (F03): the latest NSE file / sector report that failed the checks (null = none outstanding) */
  nseQuarantine?: Quarantine | null;
  sectorQuarantine?: Quarantine | null;
}
export interface HistPointV {
  date: string; fii: number | null; dii: number | null; fiiCum: number; fii20: number | null; dii20: number | null; nifty: number | null;
  source: 'nse' | 'nsdl'; provisional: boolean;
  /** zzz1067: both FII series, so the hover can show them side by side (only `fii` = the chosen basis is charted) */
  fiiNse: number | null; fiiFinal: number | null;
}
export interface Coverage {
  firstDate: string | null; firstNseDate: string | null; lastDate: string | null; days: number;
  /** zzz1067: first day with an NSDL final figure */
  firstFinalDate: string | null;
}
export interface PeriodSum { sum: number; days: number; expected: number | null }
export interface FiiDiiView {
  ok: true;
  available: boolean;
  today: TodayCard | null;
  /** zzz1067: fii = NSE provisional (matches the headline), fiiFinal = NSDL final; dii / combined NSE only */
  streaks: { fii: Streak; fiiFinal: Streak; dii: Streak; combined: Streak };
  totals: { fii1m: PeriodSum; dii1m: PeriodSum; from: string | null };
  range: Range;
  /** zzz1067 (F01): the FII series used for history / running total / 20-session sums / monthly bars */
  basis: FiiBasis;
  basisAuto: boolean;
  basisLabel: string;
  history: HistPointV[];
  /** zzz1067 (F02): sessions in a row (ending at the latest) that have a figure — the 20-session sum needs 20 */
  rollingAvailable: { need: number; fii: number; dii: number };
  coverage: Coverage;
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

export interface ViewExtras {
  oi?: readonly OiRow[]; closes?: readonly ClosePoint[]; status?: BackfillStatus | null;
  /** zzz1067: the FII series asked for (null / undefined = chosen automatically, see buildView) */
  basis?: FiiBasis | null;
  /** zzz1067: the NSE session calendar (holiday list + which years it knows); without it continuity is never claimed */
  calendar?: SessionCalendar;
}

/** NSE's provisional FII figure — only on rows that came from NSE. */
export const fiiNseOf = (r: DailyRow) => (r.source === 'nse' ? r.fiiNet : null);
/** NSDL's final FPI figure (on NSDL-only rows it is the same number as fiiNet). */
export const fiiFinalOf = (r: DailyRow) => (r.fpiFinalNet != null ? r.fpiFinalNet : r.source === 'nsdl' ? r.fiiNet : null);
const diiOf = (r: DailyRow) => (r.source === 'nse' ? r.diiNet : null);
/** FII + DII only when both are NSE figures for the same day (same source, same scope). */
const combOf = (r: DailyRow) => (r.source === 'nse' && r.fiiNet != null && r.diiNet != null ? r.fiiNet + r.diiNet : null);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** zzz1067 (F01): the automatic series — NSE when its stored history covers the whole range, else NSDL's longer history. */
export function autoBasis(all: readonly DailyRow[], from: string | null): FiiBasis {
  const firstNse = all.filter((r) => r.source === 'nse' && r.fiiNet != null).reduce<string | null>((m, r) => (!m || r.date < m ? r.date : m), null);
  if (!firstNse) return 'nsdl';
  const firstAny = all.reduce<string | null>((m, r) => (!m || r.date < m ? r.date : m), null);
  const start = from && firstAny && from > firstAny ? from : firstAny;
  return start && firstNse <= start ? 'nse' : 'nsdl';
}

export function buildView(all: readonly DailyRow[], sectorRows: readonly SectorFortnightRow[], range: Range, extras: ViewExtras = {}): FiiDiiView {
  const cal = extras.calendar ?? UNKNOWN_CALENDAR;
  const asc = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const last = asc[asc.length - 1] ?? null;
  // today's card: the latest day with NSE figures (FII + DII); before any NSE row exists, the latest NSDL FII-only day
  const lastNse = [...asc].reverse().find((r) => r.source === 'nse') ?? null;
  const t = lastNse ?? last;
  const bothSides = t && t.source === 'nse' && t.fiiBuy != null && t.fiiSell != null && t.diiBuy != null && t.diiSell != null;
  const today: TodayCard | null = t ? {
    date: t.date, provisional: t.source === 'nse', source: t.source,
    fii: { buy: t.fiiBuy, sell: t.fiiSell, net: t.fiiNet, buySharePct: buyShare(t.fiiBuy, t.fiiSell) },
    dii: t.source === 'nse' && t.diiNet != null ? { buy: t.diiBuy, sell: t.diiSell, net: t.diiNet, buySharePct: buyShare(t.diiBuy, t.diiSell) } : null,
    combinedNet: combOf(t) != null ? r2(combOf(t)!) : null,
    combinedBuy: bothSides ? r2(t.fiiBuy! + t.diiBuy!) : null,
    combinedSell: bothSides ? r2(t.fiiSell! + t.diiSell!) : null,
    combinedBuySharePct: bothSides ? buyShare(t.fiiBuy! + t.diiBuy!, t.fiiSell! + t.diiSell!) : null,
    absorbPct: t.source === 'nse' && t.fiiNet != null && t.diiNet != null && t.fiiNet < 0 && t.diiNet > 0 ? Math.round((t.diiNet / Math.abs(t.fiiNet)) * 100) : null,
    fpiConfirmedNet: t.source === 'nse' ? t.fpiFinalNet : null,
    fiiLabel: t.source === 'nse' ? 'NSE provisional' : 'NSDL final (no NSE figure stored for this day)',
    fetchedAt: t.fetchedAt,
  } : null;
  const from = last ? rangeStart(range, last.date) : null;
  const basisAuto = !extras.basis;
  const basis: FiiBasis = extras.basis ?? autoBasis(asc, from);
  const fiiOf = basis === 'nse' ? fiiNseOf : fiiFinalOf;
  // the chosen series as plain rows, so the insights (which read fiiNet) all see the same series
  const basisRows: DailyRow[] = asc.map((r) => ({ ...r, fiiNet: fiiOf(r), diiNet: diiOf(r) }));
  const inRange = from ? asc.filter((r) => r.date >= from) : asc;
  const cum = new Map(cumulativeSeries(inRange, fiiOf).map((p) => [p.date, p.cum]));
  // rolling sums use the days before the range too, so the first points of a short range are not blank
  const f20 = new Map(rollingSum(asc, fiiOf, 20, cal).map((p) => [p.date, p.sum]));
  const d20 = new Map(rollingSum(asc, diiOf, 20, cal).map((p) => [p.date, p.sum]));
  const closes = extras.closes ?? [];
  const close = new Map(closes.map((c) => [c.date, c.close]));
  let lastCum = 0;
  const history: HistPointV[] = inRange.map((r) => {
    if (cum.has(r.date)) lastCum = cum.get(r.date)!;
    return {
      date: r.date, fii: fiiOf(r), dii: diiOf(r), fiiCum: lastCum, fii20: f20.get(r.date) ?? null, dii20: d20.get(r.date) ?? null,
      nifty: close.get(r.date) ?? null, source: basis === 'nse' ? 'nse' : 'nsdl', provisional: basis === 'nse',
      fiiNse: fiiNseOf(r), fiiFinal: fiiFinalOf(r),
    };
  });
  const monthAgo = last ? rangeStart('1M', last.date)! : '9999-12-31';
  const sectors = sectorTable(sectorRows);
  const grid = sectorGrid(sectorRows, 24);
  const positioning = buildPositioning(extras.oi ?? []);
  // absorption: NSE FII vs NSE DII only (same source, same day)
  const absorb = absorption(asc.map((r) => ({ ...r, fiiNet: fiiNseOf(r), diiNet: diiOf(r) })));
  const sh = basisRows.some((r) => r.fiiNet != null) ? streakHistory(basisRows) : null;
  // the summary talks about today's NSE number, so its streak is the NSE series' streak
  const nseRows = asc.map((r) => ({ ...r, fiiNet: fiiNseOf(r) }));
  const shNse = nseRows.some((r) => r.fiiNet != null) ? streakHistory(nseRows) : null;
  const market = closes.length ? fiiVsMarket(basisRows, closes, 20) : null;
  const rot = sectors.lines.length ? rotation(sectors.lines, grid) : null;
  const assetMix = assetMixMonths(asc.map((r) => ({ date: r.date, equity: r.fpiEqTotal ?? null, debt: r.fpiDebt ?? null, hybrid: r.fpiHybrid ?? null })), 6);
  const summary = asc.length ? summarize({
    today: today ? { date: today.date, fii: today.fii.net, dii: today.dii?.net ?? null } : null,
    streak: shNse, absorption: absorb, todayAbsorbPct: today?.absorbPct ?? null, rotation: rot, positioning, market,
  }) : [];
  return {
    ok: true,
    available: asc.length > 0,
    today,
    streaks: { fii: streakOf(asc, fiiNseOf, cal), fiiFinal: streakOf(asc, fiiFinalOf, cal), dii: streakOf(asc, diiOf, cal), combined: streakOf(asc, combOf, cal) },
    totals: { fii1m: sumSince(asc, fiiOf, monthAgo, cal), dii1m: sumSince(asc, diiOf, monthAgo, cal), from: last ? monthAgo : null },
    range,
    basis, basisAuto, basisLabel: BASIS_LABEL[basis],
    history,
    rollingAvailable: { need: 20, fii: trailingSessions(asc, fiiOf, cal), dii: trailingSessions(asc, diiOf, cal) },
    coverage: {
      firstDate: asc[0]?.date ?? null, firstNseDate: asc.find((r) => r.source === 'nse')?.date ?? null, lastDate: last?.date ?? null, days: asc.length,
      firstFinalDate: asc.find((r) => fiiFinalOf(r) != null)?.date ?? null,
    },
    sectors,
    sectorGrid: grid,
    rotation: rot,
    monthly: monthlyTotals(basisRows, 24, cal),
    positioning,
    absorption: absorb,
    streakHistory: sh,
    market,
    assetMix,
    summary,
    status: extras.status ?? null,
  };
}
