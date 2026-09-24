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
