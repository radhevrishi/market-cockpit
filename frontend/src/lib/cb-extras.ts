// ═══════════════════════════════════════════════════════════════════════════
// zzz1231 — EXTRA FIGURES ON THE CONVICTION BEATS CARDS (India + USA). Pure.
//
// The owner (8–9 Nov 2026):
//   · "GNG Electronics is a low float and low turnover stock. I want to avoid
//      investing in such — find the criteria and add them to the preset."
//   · gross profit growth %, Rule of 40 (FCF margin % + quarterly revenue
//     growth YoY, with the value shown), whether ROCE is expanding.
//
// Every figure comes from the stock-screener snapshot (the slim `?tickers=`
// answer). A missing figure is "—" and never fails a gate — the same
// "absent data passes" rule as the rest of the preset.
//
// LIQUIDITY — what "hard to buy and sell" means, in figures we have:
//   free float          shares not held by the promoter group (India:
//                       100 − promoter holding, latest quarter; USA: the
//                       float % of shares). Under 30% = LOW FLOAT. SEBI's
//                       minimum public holding is 25%, so a 70%+ promoter
//                       stake leaves a thin supply of shares (GNG Electronics:
//                       promoters 71.8% in Sep 2026 → 28.2% float).
//   free-float value    float % × market cap. Under ₹500 Cr / $150M = LOW FLOAT.
//   traded value        30-session average volume × price, per day. Under
//                       ₹3 Cr / $3M a day = LOW TURNOVER (a position cannot
//                       be built or sold without moving the price).
//   float turnover      traded value ÷ free-float value, per day. Under 0.1%
//                       a day (≈ a quarter of the float a year) = LOW TURNOVER.
// ═══════════════════════════════════════════════════════════════════════════
import type { MetricCell, MetricTone } from './cb-metric-view';

export type CbMarket = 'IN' | 'US';
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

export const CB_LIQ = {
  minFloatPct: 30,
  minFloatValue: { IN: 500, US: 150 } as Record<CbMarket, number>,   // ₹ Cr / $ million
  minTradedValue: { IN: 3, US: 3 } as Record<CbMarket, number>,     // per day, ₹ Cr / $ million
  minFloatTurnoverPct: 0.1,                                          // per day
};

export interface CbLiquidity {
  floatPct: number | null;
  floatBasis: 'promoter' | 'float' | null;
  floatValue: number | null;     // ₹ Cr / $ million
  tradedValue: number | null;    // per day, ₹ Cr / $ million
  floatTurnoverPct: number | null;
  lowFloat: boolean;
  lowTurnover: boolean;
  reasons: string[];             // why it is flagged (empty = fine or unknown)
  known: boolean;                // at least one of float / traded value is known
}

export interface CbExtras {
  gpQ: number | null;            // gross profit growth, latest quarter YoY %
  gpA: number | null;            // gross profit growth, latest full year %
  revQ: number | null;           // revenue growth, latest quarter YoY %
  fcfm: number | null;           // FCF margin % used in the Rule of 40
  fcfmBasis: 'ttm' | 'year' | null;
  fcfmAt: string | null;
  r40: number | null;            // revQ + fcfm
  roce: number | null; roceP: number | null;
  roceTrend: 'expanding' | 'stable' | 'contracting' | null;
  liq: CbLiquidity;
}

const money = (v: number, m: CbMarket) => (m === 'IN' ? `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : r1(v)} Cr` : `$${v >= 100 ? Math.round(v).toLocaleString('en-US') : r1(v)}M`);

export function liquidityOf(r: any, m: CbMarket): CbLiquidity {
  const prom = fin(r?.prom) ? r.prom : null;
  const floatPct = m === 'IN' ? (prom != null ? r1(100 - prom) : fin(r?.flt) ? r.flt : null) : fin(r?.flt) ? r.flt : null;
  const floatBasis = floatPct == null ? null : m === 'IN' ? 'promoter' : 'float';
  const mc = fin(r?.mc) && r.mc > 0 ? r.mc : null;
  const px = fin(r?.px) && r.px > 0 ? r.px : fin(r?.scanPx) && r.scanPx > 0 ? r.scanPx : null;
  const vol = fin(r?.avgVol30) && r.avgVol30 > 0 ? r.avgVol30 : fin(r?.avgVol10) && r.avgVol10 > 0 ? r.avgVol10 : null;
  const tradedValue = px != null && vol != null ? r1((px * vol) / (m === 'IN' ? 1e7 : 1e6)) : null;
  const floatValue = floatPct != null && mc != null ? r1((floatPct / 100) * mc) : null;
  const floatTurnoverPct = tradedValue != null && floatValue != null && floatValue > 0 ? Math.round((tradedValue / floatValue) * 10000) / 100 : null;
  const reasons: string[] = [];
  let lowFloat = false, lowTurnover = false;
  if (floatPct != null && floatPct < CB_LIQ.minFloatPct) {
    lowFloat = true;
    reasons.push(`free float ${floatPct}%${m === 'IN' ? ` (promoters hold ${r1(100 - floatPct)}%)` : ''} — under ${CB_LIQ.minFloatPct}%`);
  }
  if (floatValue != null && floatValue < CB_LIQ.minFloatValue[m]) {
    lowFloat = true;
    reasons.push(`shares in free float worth ${money(floatValue, m)} — under ${money(CB_LIQ.minFloatValue[m], m)}`);
  }
  if (tradedValue != null && tradedValue < CB_LIQ.minTradedValue[m]) {
    lowTurnover = true;
    reasons.push(`trades ${money(tradedValue, m)} a day (30-session average) — under ${money(CB_LIQ.minTradedValue[m], m)}`);
  }
  if (floatTurnoverPct != null && floatTurnoverPct < CB_LIQ.minFloatTurnoverPct) {
    lowTurnover = true;
    reasons.push(`${floatTurnoverPct}% of the free float trades a day — under ${CB_LIQ.minFloatTurnoverPct}%`);
  }
  return { floatPct, floatBasis, floatValue, tradedValue, floatTurnoverPct, lowFloat, lowTurnover, reasons, known: floatPct != null || tradedValue != null };
}

export function extrasOf(r: any, m: CbMarket): CbExtras {
  const revQ = fin(r?.revQYoY) ? r.revQYoY : null;
  // US: the trailing-twelve-month FCF margin when the snapshot has it (zzz1045e), else the latest full year
  const ttm = m === 'US' && fin(r?.fcfmT) ? r.fcfmT : null;
  const year = fin(r?.fcfmTTM) ? r.fcfmTTM : null;
  const fcfm = ttm ?? year;
  const fcfmBasis = ttm != null ? 'ttm' : year != null ? 'year' : null;
  const fcfmAt = ttm != null ? (r?.fcfmTAt ?? null) : year != null ? (r?.fcfmAt ?? null) : null;
  const roce = fin(r?.roceFY) ? r.roceFY : null, roceP = fin(r?.roceP) ? r.roceP : null;
  const roceTrend = roce == null || roceP == null ? null : roce - roceP >= 1 ? 'expanding' : roceP - roce >= 1 ? 'contracting' : 'stable';
  return {
    gpQ: fin(r?.gpQYoY) ? r.gpQYoY : null, gpA: fin(r?.gpAYoY) ? r.gpAYoY : null, revQ,
    fcfm, fcfmBasis, fcfmAt, r40: revQ != null && fcfm != null ? r1(revQ + fcfm) : null,
    roce, roceP, roceTrend, liq: liquidityOf(r, m),
  };
}

/** ticker → extras, from the slim stock-screener rows. */
export function extrasIndex(rows: ReadonlyArray<any> | null | undefined, m: CbMarket): Record<string, CbExtras> {
  const out: Record<string, CbExtras> = {};
  for (const r of rows || []) {
    const t = String(r?.t || '').toUpperCase();
    if (t) out[t] = extrasOf(r, m);
  }
  return out;
}

/** The liquidity gate of the preset: a KNOWN low float or low turnover fails; unknown passes. */
export function passesLiquidity(e: any): boolean {
  const l: CbLiquidity | undefined = e?.cbx?.liq;
  return !l || (!l.lowFloat && !l.lowTurnover);
}
export function liquidityFailText(e: any): string {
  const l: CbLiquidity | undefined = e?.cbx?.liq;
  return l && l.reasons.length ? `hard to trade: ${l.reasons.join('; ')}` : 'liquidity not known';
}

const sign = (v: number) => `${v >= 0 ? '+' : ''}${r1(v)}%`;
const growthTone = (v: number): MetricTone => (v >= 20 ? 'good' : v >= 0 ? 'warn' : 'bad');

export function gpCell(x: CbExtras | null | undefined): MetricCell {
  const label = 'GROSS PROFIT';
  if (!x || (x.gpQ == null && x.gpA == null)) return { label, text: '—', tone: 'none', title: 'Gross profit growth is not in the stock-screener snapshot for this company (no cost-of-sales split filed). Not a fail.' };
  const v = x.gpQ ?? (x.gpA as number);
  return {
    label, text: `${sign(v)}${x.gpQ == null ? ' (year)' : ''}`, tone: growthTone(v),
    title: `Gross profit growth — latest quarter vs the same quarter a year ago: ${x.gpQ == null ? 'not known' : sign(x.gpQ)}; latest full year: ${x.gpA == null ? 'not known' : sign(x.gpA)}. Gross profit = revenue − cost of sales.`,
  };
}

export function r40Cell(x: CbExtras | null | undefined): MetricCell {
  const label = 'RULE OF 40';
  if (!x || x.r40 == null) {
    const miss = !x ? 'no snapshot figures' : x.revQ == null ? 'quarterly revenue growth not known' : 'FCF margin not known';
    return { label, text: '—', tone: 'none', title: `Rule of 40 = FCF margin % + quarterly revenue growth YoY — ${miss}. Not a fail.` };
  }
  const basis = x.fcfmBasis === 'ttm' ? `last twelve months${x.fcfmAt ? ` to ${x.fcfmAt}` : ''}` : `full year${x.fcfmAt ? ` ${x.fcfmAt}` : ''}`;
  return {
    label, text: `${r1(x.r40)} (${sign(x.revQ as number)} + ${r1(x.fcfm as number)}%)`, tone: x.r40 >= 40 ? 'good' : x.r40 >= 20 ? 'warn' : 'bad',
    title: `Rule of 40 = quarterly revenue growth YoY ${sign(x.revQ as number)} + FCF margin ${r1(x.fcfm as number)}% (${basis}) = ${r1(x.r40)}. 40 or more passes.`,
  };
}

export function roceTrendCell(x: CbExtras | null | undefined): MetricCell {
  const label = 'ROCE TREND';
  if (!x || x.roceTrend == null) return { label, text: '—', tone: 'none', title: 'Needs ROCE for the last two fiscal years; one of them is not in the snapshot yet. Not a fail.' };
  const d = r1((x.roce as number) - (x.roceP as number));
  const word = x.roceTrend === 'expanding' ? '▲ expanding' : x.roceTrend === 'contracting' ? '▼ contracting' : '◆ stable';
  return {
    label, text: `${word} ${r1(x.roceP as number)}→${r1(x.roce as number)}%`, tone: x.roceTrend === 'expanding' ? 'good' : x.roceTrend === 'stable' ? 'warn' : 'bad',
    title: `ROCE latest fiscal year ${r1(x.roce as number)}% vs the year before ${r1(x.roceP as number)}% (${d >= 0 ? '+' : ''}${d} points). A move of 1 point or more counts as expanding / contracting.`,
  };
}

export function liquidityCell(x: CbExtras | null | undefined, m: CbMarket): MetricCell {
  const label = 'LIQUIDITY';
  const l = x?.liq;
  if (!l || !l.known) return { label, text: '—', tone: 'none', title: 'Free float and traded value are not in the snapshot for this company yet. Not a fail.' };
  const parts = [
    l.floatPct != null ? `float ${l.floatPct}%` : null,
    l.tradedValue != null ? `${money(l.tradedValue, m)}/day` : null,
  ].filter(Boolean).join(' · ');
  const flag = l.lowFloat && l.lowTurnover ? 'LOW FLOAT + TURNOVER' : l.lowFloat ? 'LOW FLOAT' : l.lowTurnover ? 'LOW TURNOVER' : null;
  const facts = [
    l.floatPct != null ? `Free float ${l.floatPct}%${l.floatBasis === 'promoter' ? ' (100 − promoter holding, latest quarter)' : ''}` : 'Free float not known',
    l.floatValue != null ? `free-float value ${money(l.floatValue, m)}` : null,
    l.tradedValue != null ? `traded value ${money(l.tradedValue, m)} a day (30 sessions)` : 'traded value not known',
    l.floatTurnoverPct != null ? `${l.floatTurnoverPct}% of the float trades a day` : null,
  ].filter(Boolean).join('; ');
  return {
    label, text: flag ? `⚠ ${flag} · ${parts}` : parts, tone: flag ? 'bad' : 'good',
    title: `${facts}.${flag ? ` Flagged: ${l.reasons.join('; ')}. The Quality Preset leaves such companies out — a thin float or thin trading means a position cannot be built or sold without moving the price.` : ' Not low float, not low turnover.'}`,
  };
}
