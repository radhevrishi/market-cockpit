'use client';

// ═══════════════════════════════════════════════════════════════════════════
// CONFLUENCE — THE ONE THING NEITHER TAB CAN SAY ALONE  (zzz651)
//
// Conviction Beats answers "did this company's earning power actually change".
// Theme Rotation answers "is money moving into this company's neighbourhood".
// Both have been right for months and neither has ever known the other exists,
// so the reader has been doing the join by hand — opening two tabs, remembering
// which themes were green, and scanning a hundred-row bench against them.
//
// That join is not decoration. It is the highest-value fact on either page,
// because the two failure modes it separates are the two most expensive ones:
//
//   · A BLOCKBUSTER print in a LAGGING theme is a value trap in waiting. The
//     quarter is real; nobody is paying for quarters like it right now. These
//     are the names that grind sideways for a year and get sold in month nine.
//
//   · A BUY theme with no qualified names underneath it is a chase. The tape
//     is moving and the filings have not confirmed anything — which is exactly
//     when a theme board is most seductive and least useful.
//
// Only the intersection is a position: a company whose numbers changed, in a
// neighbourhood the market is currently paying for. This module computes that
// intersection and — just as importantly — names the two disagreements, because
// a tool that only shows you the agreements is a tool that flatters you.
//
// THE JOIN IS NOT ASSERTED AS CERTAIN. A name is placed in a theme by the same
// keyword classifier the rotation board uses, which is right most of the time
// and occasionally puts a diversified industrial somewhere arguable. So every
// confluence row carries the theme it was matched to, visibly, and the reader
// can see the match rather than trust it.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import type { ThemeRegion } from './theme-universe';

export interface ThemeVerdict {
  id: string;
  name: string;
  emoji: string;
  verdict: string;
  verdictColor: string;
  verdictNote?: string;
  trendState?: string;
  trendColor?: string;
  rsRatio?: number;
  ret?: Record<string, number>;
  sourceKind?: 'proxy' | 'basket' | 'proxy-fallback';
  fallbackReason?: string | null;
}

/** The verdicts the rotation board issues, ordered by how much they encourage
 *  owning something. Used to rank and to decide what counts as a tailwind. */
export const VERDICT_RANK: Record<string, number> = {
  BUY: 5, 'EARLY BUY': 4, HOLD: 3, WATCH: 2, TRIM: 1, AVOID: 0,
};
/** A theme the board is actively positive on. Deliberately excludes HOLD:
 *  "keep what you own" is not the same statement as "this is where to put new
 *  money", and conflating them is how a confluence screen becomes a list of
 *  everything. */
export const isTailwind = (v?: string | null) => v === 'BUY' || v === 'EARLY BUY';
/** A theme the board is actively negative on — the tape is against the name. */
export const isHeadwind = (v?: string | null) => v === 'AVOID' || v === 'TRIM';

/**
 * Load the rotation board for a region and expose a lookup by theme id.
 *
 * Reads the SAME cached endpoint the Theme Rotation tab reads, so opening
 * Conviction Beats costs one extra cached call and the two pages can never
 * disagree about what a theme's verdict is — which they would within minutes
 * if this kept its own copy.
 */
export function useThemeVerdicts(region: ThemeRegion) {
  const [themes, setThemes] = useState<ThemeVerdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fetch(`/api/market/theme-rotation?region=${region}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const rows = Array.isArray(j?.themes) ? j.themes : [];
        setThemes(rows.map((t: any) => ({
          id: t.id, name: t.name, emoji: t.emoji,
          verdict: t.verdict, verdictColor: t.verdictColor, verdictNote: t.verdictNote,
          trendState: t.trendState, trendColor: t.trendColor, rsRatio: t.rsRatio,
          ret: t.ret, sourceKind: t.sourceKind, fallbackReason: t.fallbackReason,
        })));
      })
      .catch((e) => { if (alive) setError(String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [region]);

  const byId = useMemo(() => {
    const m = new Map<string, ThemeVerdict>();
    for (const t of themes) m.set(t.id, t);
    return m;
  }, [themes]);

  return { themes, byId, loading, error };
}

export type ConfluenceKind = 'aligned' | 'orphan' | 'against' | 'neutral' | 'unknown';

export interface ConfluenceRead {
  kind: ConfluenceKind;
  theme: ThemeVerdict | null;
  /** One sentence a reader can act on — not a label, a statement. */
  line: string;
  color: string;
  /** Short badge text for a dense row. */
  badge: string;
}

/**
 * Read one name's standing: what its own filing said, against what the tape is
 * doing to its neighbourhood.
 *
 * `hunting` is the Process panel's own judgement about whether this bucket is
 * a place to look for a multibagger (A / B / C are; D / E / F are not), so the
 * two inputs here are both already-computed verdicts rather than raw numbers —
 * this function only states what their combination means.
 */
export function confluenceFor(
  themeId: string | null,
  hunting: boolean,
  byId: Map<string, ThemeVerdict>,
): ConfluenceRead {
  const theme = themeId ? byId.get(themeId) ?? null : null;
  if (!theme) {
    return {
      kind: 'unknown', theme: null, color: '#64748B', badge: 'NO THEME',
      line: 'This name was not matched to a tracked rotation theme, so there is nothing to say about whether the tape agrees with the filing. Judge it on the filing alone.',
    };
  }
  const v = theme.verdict;
  if (hunting && isTailwind(v)) {
    return {
      kind: 'aligned', theme, color: '#22C55E', badge: `ALIGNED · ${v}`,
      line: `The filing says the earning power changed and the rotation board rates ${theme.emoji} ${theme.name} a ${v} — the company inflected inside a neighbourhood the market is currently paying for. This is the only combination that is a position rather than an argument.`,
    };
  }
  if (hunting && isHeadwind(v)) {
    return {
      kind: 'against', theme, color: '#EF4444', badge: `TAPE AGAINST · ${v}`,
      line: `The quarter qualifies, but ${theme.emoji} ${theme.name} is rated ${v} — nobody is paying for quarters like this one right now. A real print into a falling theme is the setup that grinds sideways for a year, so this needs either a longer horizon than the theme's, or a reason the company escapes its own sector.`,
    };
  }
  if (!hunting && isTailwind(v)) {
    return {
      kind: 'orphan', theme, color: '#F59E0B', badge: `THEME ONLY · ${v}`,
      line: `${theme.emoji} ${theme.name} is rated ${v}, but this company's own filing did not qualify it as a place to hunt. Owning it is a bet on the theme carrying a business that has not itself changed — which is a trade, not a holding.`,
    };
  }
  return {
    kind: 'neutral', theme, color: '#94A3B8', badge: `${theme.emoji} ${v}`,
    line: `${theme.emoji} ${theme.name} is rated ${v}. Neither the filing nor the tape is arguing strongly here.`,
  };
}
