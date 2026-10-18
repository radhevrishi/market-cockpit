// zzz1085 — retest improvement 3: three DIFFERENT freshness facts for one company, never mixed up:
//   1. Price — which trading session the price is from (the row's pxAt), not when the page fetched it.
//   2. Figures — which quarter the company figures describe (row.q), with how old that quarter is.
//   3. Snapshot — when the screener snapshot was built.
// "Figures may be behind" is only said with evidence: a newer graded result on file (Earnings Opportunities / Conviction Beats)
// → "newer result filed <date>, not in these figures yet"; no newer result known but the next one is overdue → "next result was
// due by <date> — not found in our result files" (a missing filing is NOT proven by an old quarter alone). Pure.
import type { ScreenMarket, ScreenRow } from './types';
import type { LatestResult } from './latest-result';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
export const dayText = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const short = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;

/** The last day of the quarter a row's figures describe: USA 'Q2 2026' (calendar quarter), India 'Jun 2026' (month it ended). */
export function quarterEnd(q: string | null | undefined): string | null {
  if (!q) return null;
  const s = q.trim();
  let m = s.match(/^Q([1-4])\s+(\d{4})$/);
  if (m) { const mo = Number(m[1]) * 3; return ymd(Date.UTC(Number(m[2]), mo, 0)); }
  m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m) { const i = MON.findIndex((x) => x.toLowerCase() === m![1].toLowerCase()); if (i >= 0) return ymd(Date.UTC(Number(m[2]), i + 1, 0)); }
  return null;
}

/** When the NEXT quarter's result is normally out: India 45 days after the quarter (60 for the March year-end quarter, SEBI LODR);
 *  USA 45 days (10-Q; 90 for a year-end 10-K — we cannot tell the fiscal year end, so allow 90 for a December quarter). */
export function nextResultDue(end: string, market: ScreenMarket): string {
  const t = Date.parse(`${end}T00:00:00Z`);
  const d = new Date(t);
  const nextEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 4, 0);   // last day of the quarter after
  const nm = new Date(nextEnd).getUTCMonth() + 1;
  const lag = market === 'IN' ? (nm === 3 ? 60 : 45) : (nm === 12 ? 90 : 45);
  return ymd(nextEnd + lag * DAY);
}

export type Tone = 'ok' | 'warn' | 'bad' | 'dim';
export interface Fact { label: string; text: string; tone: Tone; title: string }

export function freshnessFacts(row: Pick<ScreenRow, 'q' | 'pxAt'> & { cc?: unknown }, market: ScreenMarket, builtAt: string | null, now: Date, lr?: LatestResult | null, resultsChecked = false): Fact[] {
  const today = ymd(now.getTime());
  const out: Fact[] = [];
  // 1. price session
  const pxAt = typeof row.pxAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.pxAt) ? row.pxAt : null;
  out.push(pxAt
    ? { label: 'Price', text: row.cc ? `${short(pxAt)} session (during trading)` : `${short(pxAt)} close`, tone: 'ok', title: `The price is from the ${dayText(pxAt)} ${market === 'IN' ? 'NSE' : 'US'} session${row.cc ? ', read while it was trading' : ' (completed close)'}.` }
    : { label: 'Price', text: 'session not known', tone: 'dim', title: 'The price source gave no session date.' });
  // 2. figures period
  const end = quarterEnd(row.q);
  if (!end) out.push({ label: 'Figures', text: 'quarter not known', tone: 'dim', title: 'No quarter is on file for these company figures.' });
  else {
    const age = Math.round((now.getTime() - Date.parse(`${end}T00:00:00Z`)) / DAY);
    const due = nextResultDue(end, market);
    const newer = lr && lr.d && lr.d > ymd(Date.parse(`${end}T00:00:00Z`) + 20 * DAY) ? lr : null;
    if (newer) out.push({ label: 'Figures', text: `${row.q} · newer result filed ${short(newer.d)}`, tone: 'bad', title: `These figures describe the quarter to ${dayText(end)} (${age} days ago). A newer result${newer.q ? ` (${newer.q})` : ''} was filed on ${dayText(newer.d)} and is not in these figures yet — the next build reads it.` });
    else if (today > due) out.push({ label: 'Figures', text: `${row.q} · next result was due ${short(due)}`, tone: 'warn', title: `These figures describe the quarter to ${dayText(end)} (${age} days ago). The next result is normally out by ${dayText(due)}.${resultsChecked ? ' No newer result is in our result files (Earnings Opportunities, last 100 days, and Conviction Beats) — it may be late, or filed but not graded.' : ' Not checked against the latest filings.'}` });
    else out.push({ label: 'Figures', text: `${row.q} · current`, tone: 'ok', title: `These figures describe the quarter to ${dayText(end)} (${age} days ago). The next result is normally out by ${dayText(due)}.` });
  }
  // 3. snapshot build
  if (builtAt && Number.isFinite(Date.parse(builtAt))) {
    const b = new Date(builtAt);
    const h = (now.getTime() - b.getTime()) / 3_600_000;
    out.push({ label: 'Snapshot', text: h < 1 ? `built ${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `built ${Math.round(h)} h ago` : `built ${short(ymd(b.getTime()))}`, tone: h < 36 ? 'ok' : 'warn', title: `This screener snapshot was built ${b.toLocaleString()}. It is the time the data was put together — not the price session or the quarter.` });
  } else out.push({ label: 'Snapshot', text: 'build time not known', tone: 'dim', title: 'The snapshot has no build time.' });
  return out;
}

/** Compact table marker: the date the next result was due, when it has passed ('' when the figures are current or the quarter is
 *  unknown). "Overdue" only — the full check against the result files is in the company details. */
export function figuresOverdue(q: string | null | undefined, market: ScreenMarket, now: Date): string {
  const end = quarterEnd(q);
  if (!end) return '';
  const due = nextResultDue(end, market);
  return ymd(now.getTime()) > due ? due : '';
}
