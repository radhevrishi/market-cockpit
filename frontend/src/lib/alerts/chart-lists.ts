// zzz1054 — the /charts watchlists (this browser's copy) as options for the "Create alert on" picker (browser only).
import { CHART_WATCHLISTS_KEY, sanitizeStore, listCount } from '@/lib/chart-watchlist';
import type { ChartListOption } from '@/components/alerts/CreateAlertDialog';

export function chartListOptions(): ChartListOption[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHART_WATCHLISTS_KEY);
    if (!raw) return [];
    return sanitizeStore(JSON.parse(raw)).lists.map((l) => ({ id: l.id, name: l.name, count: listCount(l) }));
  } catch { return []; }
}
