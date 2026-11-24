// zzz1306 — filters for "Price and free cash flow per share — every company" (Company Lab).
//
// The owner asked for "FCF per share above the share price". The two lines sit on different
// axes, so "above" on the chart means the FCF line climbed more than the price line. Taken
// literally (FCF per share larger than the price) it would mean a free-cash-flow yield over
// 100%, which no listed company has — so the filter compares GROWTH over the same years.
// Pure: no fetch, no React.

export interface FcfYear { label: string; fcfPs: number | null; priceAtEnd: number | null; fcfYield: number | null }

export interface FcfVsPrice {
  from: string | null;          // first fiscal year used
  years: number;                // fiscal years spanned
  fcfG: number | null;          // FCF per share growth over the span, %
  priceG: number | null;        // share price growth over the span (start year end → today), %
  gap: number | null;           // fcfG − priceG, percentage points
  faster: boolean;              // FCF/share grew more than the price
  positive: boolean;            // latest FCF/share > 0
  rising: boolean;              // FCF/share up in every year of the span
  yieldNow: number | null;      // latest FCF ÷ today's price, %
  lowBase: boolean;             // start-year FCF yield under 1% — the growth % comes from a tiny base
  why: string;                  // plain reason when a figure is missing
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function fcfVsPrice(years: FcfYear[], priceNow: number | null, span: number): FcfVsPrice {
  const ys = years.filter((y) => fin(y.fcfPs));
  const none: FcfVsPrice = { from: null, years: 0, fcfG: null, priceG: null, gap: null, faster: false, positive: false, rising: false, yieldNow: null, lowBase: false, why: '' };
  if (!ys.length) return { ...none, why: 'no free cash flow per share in the filings' };
  const last = ys[ys.length - 1];
  const positive = last.fcfPs! > 0;
  const px = fin(priceNow) && priceNow > 0 ? priceNow : last.priceAtEnd;
  const yieldNow = positive && fin(px) && px > 0 ? r1((last.fcfPs! / px) * 100) : null;
  if (ys.length < 2) return { ...none, positive, yieldNow, why: 'only one year of free cash flow per share' };
  const first = ys[Math.max(0, ys.length - 1 - Math.max(1, span))];
  const seg = ys.slice(ys.indexOf(first));
  const rising = seg.every((y, i) => i === 0 || y.fcfPs! > seg[i - 1].fcfPs!);
  const base = { ...none, from: first.label, years: seg.length - 1, positive, rising, yieldNow };
  if (!(first.fcfPs! > 0) || !positive) return { ...base, why: `free cash flow per share ${first.fcfPs} → ${last.fcfPs}: from or to a negative figure is not a growth rate` };
  const fcfG = r1((last.fcfPs! / first.fcfPs! - 1) * 100);
  const p0 = first.priceAtEnd;
  const priceG = fin(p0) && p0 > 0 && fin(px) ? r1((px / p0 - 1) * 100) : null;
  if (priceG == null) return { ...base, fcfG, why: `no share price at the ${first.label} year end (listed later)` };
  const lowBase = first.fcfPs! / p0! < 0.01;
  return { ...base, fcfG, priceG, gap: r1(fcfG - priceG), faster: fcfG > priceG, lowBase };
}

export type FcfFilterKey = 'faster' | 'flat' | 'positive' | 'rising' | 'yield5';
export interface FcfFilterDef { key: FcfFilterKey; label: string; help: string }
export const FCF_FILTERS: FcfFilterDef[] = [
  { key: 'faster', label: 'FCF/share grew faster than price', help: 'Free cash flow per share rose more than the share price over the chosen years — the FCF line ends above the price line.' },
  { key: 'flat', label: 'Cash up, price flat', help: 'Free cash flow per share up 30% or more while the price moved less than +10% over the chosen years.' },
  { key: 'positive', label: 'FCF positive now', help: 'The latest full year has positive free cash flow per share.' },
  { key: 'rising', label: 'FCF/share up every year', help: 'Free cash flow per share went up in each year of the chosen span.' },
  { key: 'yield5', label: 'FCF yield ≥ 5%', help: 'Latest free cash flow per share ÷ today\'s price is 5% or more.' },
];

export function passesFcfFilters(v: FcfVsPrice, on: Set<FcfFilterKey>): boolean {
  for (const k of on) {
    if (k === 'faster' && !v.faster) return false;
    if (k === 'flat' && !(v.fcfG != null && v.priceG != null && v.fcfG >= 30 && v.priceG < 10)) return false;
    if (k === 'positive' && !v.positive) return false;
    if (k === 'rising' && !v.rising) return false;
    if (k === 'yield5' && !(v.yieldNow != null && v.yieldNow >= 5)) return false;
  }
  return true;
}
