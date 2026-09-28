// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO CATALYSTS — THE PAGE'S OWN LINES, AS PURE FUNCTIONS.  (zzz793)
// Kept out of page.tsx (a page file may export nothing but its default) so
// they can be tested. Plain English; no score, no BUY / SELL, no price.
// ═══════════════════════════════════════════════════════════════════════════

import { RESEARCH_EXPORT_STATUSES } from '@/lib/thesis/evidence-counts';

/** The research export in facts — the India wording ("eligible for research
 *  export"), the rule stated, and a sum that reconciles. */
export function usExportLine(rows: Array<{ assessment?: { status?: string | null } | null }>, label: (s: string) => string): { eligible: number; analysed: number; line: string } {
  const analysed = rows.filter((r) => r.assessment?.status).length;
  const keep = (s: string | null | undefined) => !!s && (RESEARCH_EXPORT_STATUSES as readonly string[]).includes(s);
  const eligible = rows.filter((r) => keep(r.assessment?.status)).length;
  const ex: Record<string, number> = {};
  for (const r of rows) { const s = r.assessment?.status; if (s && !keep(s)) ex[s] = (ex[s] || 0) + 1; }
  const excluded = Object.entries(ex);
  const excludedN = excluded.reduce((t, [, n]) => t + n, 0);
  const line = `${analysed} analysed · ${eligible} eligible for research export (strengthening, on track, confirmation required, running ahead of plan — confirmation required is included)`
    + `${excludedN ? ` · ${excludedN} excluded (${excluded.map(([s, n]) => `${n} ${label(s).toLowerCase()}`).join(', ')})` : ''}`
    + ` · ${eligible} + ${excludedN} = ${analysed}`;
  return { eligible, analysed, line };
}

/** "Why: …" for a research-priority row — what the documents evidence, in
 *  words. The internal ranking number is never shown. */
export function usWhyLine(rank: { output?: { revenue?: number | null; earnings?: number | null; marginPp?: number | null } | null; drivers?: Array<{ group: string; text: string }> | null } | null | undefined): string {
  if (!rank) return 'Why: no evidenced catalyst on file.';
  const bits: string[] = [];
  for (const d of (rank.drivers || []).slice(0, 2)) bits.push(`${d.group.toLowerCase()} — ${String(d.text).replace(/\s+/g, ' ').slice(0, 110)}`);
  const o = rank.output || {};
  const out = [o.revenue != null ? `revenue ${o.revenue >= 0 ? '+' : ''}${o.revenue}%` : null, o.earnings != null ? `earnings ${o.earnings >= 0 ? '+' : ''}${o.earnings}%` : null,
    o.marginPp != null && o.marginPp > 0 ? `margin +${o.marginPp} points` : null].filter(Boolean).join(', ');
  if (out) bits.push(`filed results: ${out}`);
  return `Why: ${bits.join('; ') || 'filed results only — no mechanism evidenced yet'}.`;
}

/** The progress line for a batch, including how it ended. */
export function usBatchLine(b: { running: boolean; done: number; total: number; stopped?: boolean; resumable?: number; retrying?: number }, what = 'Reading'): string | null {
  if (b.running && b.retrying) return `${what}: ${b.done} of ${b.total} done — retrying ${b.retrying} that failed (once)…`;
  if (b.running) return `${what} ${Math.min(b.done + 1, b.total)} of ${b.total}…`;
  if (b.stopped && b.total) return `Stopped — ${b.done} of ${b.total} finished; ${Math.max(0, b.total - b.done)} not read. Nothing in progress.`;
  return null;
}

// ── zzz815: WHERE EACH NAME'S SEC FIGURES STAND. ─────────────────────────
type FigRow = { figures?: { state?: string; note?: string | null; attempts?: number; noFiler?: boolean } | null; graded?: any; sec?: any; gradedWhy?: string | null };

export interface UsFiguresCounts { total: number; loading: number; ok: number; none: number; retrying: number; failed: number }

/** Pure: how many names are loading / in / retrying / failed. */
export function usFiguresCounts(rows: FigRow[]): UsFiguresCounts {
  const c: UsFiguresCounts = { total: rows.length, loading: 0, ok: 0, none: 0, retrying: 0, failed: 0 };
  for (const r of rows) {
    const s = r.figures?.state;
    if (s === 'loading') c.loading++;
    else if (s === 'retrying') c.retrying++;
    else if (s === 'failed') c.failed++;
    else if (s === 'none') c.none++;
    else c.ok++;
  }
  return c;
}

/** Pure: the progress line. Counts add up to the total. */
export function usFiguresLine(c: UsFiguresCounts, firstPass: boolean): string {
  const inN = c.ok + c.none;
  const head = firstPass ? `Loading SEC XBRL figures: ${inN} of ${c.total} in` : `SEC XBRL figures: ${inN} of ${c.total} in`;
  const parts = [`${c.ok} with quarterly figures`, c.none ? `${c.none} with none filed` : '', c.loading ? `${c.loading} loading` : '',
    c.retrying ? `${c.retrying} SEC request failed — retrying` : '', c.failed ? `${c.failed} SEC request failed (not a finding about the company)` : ''].filter(Boolean);
  return `${head} (${parts.join(' · ')}).`;
}

/** Pure: the card's figures line when there is no quarterly row. Never
 *  "no SEC filer" unless the server said the loaded ticker list lacks it;
 *  never "not loaded yet" next to a finding. */
export function usCardFiguresWords(r: FigRow): string {
  const f = r.figures;
  if (f?.state === 'loading') return 'loading SEC figures…';
  if (f?.state === 'retrying') return f.note || 'SEC request failed — retrying';
  if (f?.state === 'failed') return f.note || 'SEC request failed — not a finding about the company';
  const why = r.sec?.note || r.gradedWhy;
  return why ? `No quarterly SEC XBRL figures: ${why}` : 'No quarterly SEC XBRL figures filed';
}

// ── zzz815: WHICH CARDS THE PAGE SHOWS — pure, so it can be tested. ──────
type ViewRow = { symbol: string; origin: string; preset?: { state?: string } | null; assessment?: { status?: string | null; triggered?: unknown[] } | null };

/**
 * The cards for a view. Bench names are hidden ONLY when they miss the
 * owner's Conviction Beats criteria and the "also show failing" chip is off;
 * a bench name whose figures are still loading is shown (as loading). The
 * view chip picks book / bench / all; the status filter narrows further.
 */
export function usPcView<T extends ViewRow>(rows: T[], o: { source: 'all' | 'book' | 'bench' | 'cb'; showFailing: boolean; filter: string | null; order: readonly string[]; cbKeys?: ReadonlySet<string>; keyOf?: (t: string) => string }): { all: T[]; inSource: T[]; list: T[] } {
  const all = o.showFailing ? rows : rows.filter((r) => !(r.origin === 'bench' && r.preset?.state === 'fail'));
  // zzz828: 'cb' = every name the US Conviction Beats page shows under the
  // saved criteria, HELD ONES INCLUDED (held + not held), from ALL rows —
  // never narrowed by the failing chip (a CB name never fails its own list).
  const key = o.keyOf || ((t: string) => t.toUpperCase());
  const inSource = o.source === 'cb'
    ? rows.filter((r) => !!o.cbKeys && o.cbKeys.has(key(r.symbol)))
    : all.filter((r) => (o.source === 'all' ? true : o.source === 'book' ? r.origin !== 'bench' : r.origin === 'bench'));
  const f = o.filter ? inSource.filter((r) => r.assessment?.status === o.filter) : inSource;
  const list = [...f].sort((a, b) => {
    const ai = o.order.indexOf(a.assessment?.status || 'NEUTRAL'), bi = o.order.indexOf(b.assessment?.status || 'NEUTRAL');
    if (ai !== bi) return ai - bi;
    return ((b.assessment?.triggered?.length || 0) - (a.assessment?.triggered?.length || 0)) || a.symbol.localeCompare(b.symbol);
  });
  return { all, inSource, list };
}
