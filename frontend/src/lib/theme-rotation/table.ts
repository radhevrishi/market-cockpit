// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — TABLE SORT AND FILTER  (zzz795)
// Pure, so every column sort and every filter is unit-tested.
// ═══════════════════════════════════════════════════════════════════════════

import type { FlagKind, LayerKey, LayerState, Tier } from './types';
import type { ThemeView } from './view-model';

export type SortKey = 'rank' | 'name' | 'verdict' | 'w1' | 'm1' | 'm3' | 'y1' | 'trend' | 'yours' | `layer:${LayerKey}`;
export type SortDir = 'asc' | 'desc';

const VERDICT_ORDER: Record<string, number> = { BUY: 0, 'EARLY BUY': 1, HOLD: 2, WATCH: 3, TRIM: 4, AVOID: 5 };
const STATE_ORDER: Record<LayerState, number> = { improving: 0, steady: 1, unknown: 2, weakening: 3 };
const TREND_ORDER: Record<string, number> = { 'accelerating:up': 0, 'continuing:up': 1, 'reversing:up': 2, 'flat:flat': 3, 'unknown:flat': 4, 'reversing:down': 5, 'continuing:down': 6, 'accelerating:down': 7 };

/** Natural direction for each column when first clicked. */
export function defaultDir(k: SortKey): SortDir {
  return k === 'rank' || k === 'name' || k === 'verdict' || k === 'trend' || k.startsWith('layer:') ? 'asc' : 'desc';
}

export function sortViews(views: ThemeView[], key: SortKey, dir: SortDir, yours: (id: string) => number = () => 0): ThemeView[] {
  const val = (v: ThemeView): number | string => {
    switch (key) {
      case 'rank': return v.rank;
      case 'name': return v.row.name.toLowerCase();
      case 'verdict': return VERDICT_ORDER[v.row.verdict || ''] ?? 9;
      case 'w1': case 'm1': case 'm3': case 'y1': return v.row.ret?.[key] ?? Number.NEGATIVE_INFINITY;
      case 'trend': return TREND_ORDER[`${v.trend.word}:${v.trend.dir}`] ?? 4;
      case 'yours': return yours(v.row.id);
      default: {
        const lk = key.slice(6) as LayerKey;
        const r = v.a.layers[lk];
        if (lk === 'valuation') return r.level === 'strong' ? 0 : r.level === 'neutral' ? 1 : r.level === 'weak' ? 2 : 3;
        return STATE_ORDER[r.state];
      }
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...views].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
    // Missing numbers always sink to the bottom whatever the direction.
    if (x === Number.NEGATIVE_INFINITY && y !== Number.NEGATIVE_INFINITY) return 1;
    if (y === Number.NEGATIVE_INFINITY && x !== Number.NEGATIVE_INFINITY) return -1;
    return c * sign || a.rank - b.rank;
  });
}

export interface TableFilter {
  verdicts: Set<string>;          // empty = all
  tiers: Set<Tier>;               // empty = all
  flags: Set<FlagKind | 'mine'>;  // empty = all; otherwise ANY of them
  query: string;
}

export const emptyFilter = (): TableFilter => ({ verdicts: new Set(), tiers: new Set(), flags: new Set(), query: '' });

export function filterViews(views: ThemeView[], f: TableFilter, yours: (id: string) => number = () => 0): ThemeView[] {
  const q = f.query.trim().toLowerCase();
  return views.filter((v) => {
    if (f.verdicts.size && !f.verdicts.has(v.row.verdict || '')) return false;
    if (f.tiers.size && !f.tiers.has(v.a.tier)) return false;
    if (f.flags.size) {
      const hit = [...f.flags].some((k) => (k === 'mine' ? yours(v.row.id) > 0 : v.a.flags.some((x) => x.kind === k)));
      if (!hit) return false;
    }
    if (q && !(`${v.row.name} ${v.row.group} ${v.row.note || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}
