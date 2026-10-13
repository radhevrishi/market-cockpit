// zzz974 — screener research workflow (audit workflow items): review progress per company, the view to come back to after a
// chart, and finding a company within the results. Pure helpers + guarded storage (a blocked storage only loses the convenience).
import type { ScreenMarket, ScreenRow } from './types';
import { CHART_REVIEW_QUEUE_KEY } from '../chart-review-queue';
export { CHART_REVIEW_QUEUE_KEY as CHART_REVIEW_KEY };

/** The order the chart's Next / Previous step through when a company is opened from the screener (this tab only). */
export function writeReviewQueue(label: string, items: Array<{ symbol: string; exchange: string; name?: string }>, returnUrl = '/stock-screener', from?: { source: 'screener' | 'watchlist'; listId?: string }): boolean {
  try {
    sessionStorage.setItem(CHART_REVIEW_QUEUE_KEY, JSON.stringify({ origin: 'screener', label, returnUrl, at: Date.now(), items: items.slice(0, 5000), ...(from || {}) }));
    return true;
  } catch { return false; }   // the chart then steps the watchlist as before
}

export type ReviewState = 'unreviewed' | 'chart' | 'filings' | 'parked';
export const REVIEW_STATES: ReadonlyArray<{ id: ReviewState; label: string }> = [
  { id: 'unreviewed', label: 'Unreviewed' }, { id: 'chart', label: 'Chart checked' }, { id: 'filings', label: 'Filings checked' }, { id: 'parked', label: 'Parked' },
];
const VALID = new Set<string>(REVIEW_STATES.map((x) => x.id));
/** Kept in the browser and synced to the owner's other devices by the vault (listed in user-vault-keys). */
export const REVIEW_KEY = 'mc:screen-review:v1';
export const MAX_REVIEW = 5000;
export const reviewKey = (market: ScreenMarket, t: string) => `${market}:${String(t).toUpperCase()}`;

export function cleanReviewStates(raw: unknown): Record<string, ReviewState> {
  const out: Record<string, ReviewState> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^(US|IN):[A-Z0-9&.\-]{1,24}$/.test(k) && typeof v === 'string' && VALID.has(v) && v !== 'unreviewed') out[k] = v as ReviewState;
  }
  return out;
}
export function readReviewStates(): Record<string, ReviewState> {
  try { return typeof window === 'undefined' ? {} : cleanReviewStates(JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}')); } catch { return {}; }
}
/** Pure: the map with one company's state set ('unreviewed' removes it), capped to the most recent MAX_REVIEW entries. */
export function setReviewState(all: Record<string, ReviewState>, market: ScreenMarket, t: string, st: ReviewState): Record<string, ReviewState> {
  const k = reviewKey(market, t);
  const { [k]: _old, ...rest } = all;
  const next: Record<string, ReviewState> = st === 'unreviewed' ? rest : { ...rest, [k]: st };
  const keys = Object.keys(next);
  if (keys.length > MAX_REVIEW) for (const drop of keys.slice(0, keys.length - MAX_REVIEW)) delete next[drop];
  return next;
}
export function writeReviewState(market: ScreenMarket, t: string, st: ReviewState): Record<string, ReviewState> {
  const next = setReviewState(readReviewStates(), market, t, st);
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  return next;
}

// ── the view to come back to (this tab only) ──────────────────────────────────────────────────────────────────────────
export const VIEW_KEY = 'mc:screener-view:v1';
export interface ViewState { sort?: { key: string; dir: 1 | -1 }; find?: string; scrollY?: number; showAll?: boolean }
export function cleanView(v: any): ViewState | null {
  if (!v || typeof v !== 'object') return null;
  const out: ViewState = {};
  if (v.sort && typeof v.sort.key === 'string' && (v.sort.dir === 1 || v.sort.dir === -1)) out.sort = { key: v.sort.key.slice(0, 40), dir: v.sort.dir };
  if (typeof v.find === 'string') out.find = v.find.slice(0, 60);
  if (typeof v.scrollY === 'number' && Number.isFinite(v.scrollY) && v.scrollY >= 0) out.scrollY = v.scrollY;
  if (typeof v.showAll === 'boolean') out.showAll = v.showAll;
  return out;
}
export function readViewState(screenId: string): ViewState | null {
  try { return typeof window === 'undefined' ? null : cleanView((JSON.parse(sessionStorage.getItem(VIEW_KEY) || '{}') || {})[screenId]); } catch { return null; }
}
export function writeViewState(screenId: string, patch: ViewState): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(VIEW_KEY) || '{}') || {};
    all[screenId] = { ...(cleanView(all[screenId]) || {}), ...patch };
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(all));
  } catch { /* a convenience */ }
}

/** Narrow the result table to companies whose ticker or name contains the text (an NSE:/BSE: prefix and .NS / .BO are ignored). */
export function findInResults<T extends Pick<ScreenRow, 't' | 'n'>>(rows: readonly T[], q: string): T[] {
  const s = String(q || '').trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
  if (!s) return rows.slice();
  return rows.filter((r) => r.t.toUpperCase().includes(s) || String(r.n || '').toUpperCase().includes(s));
}
