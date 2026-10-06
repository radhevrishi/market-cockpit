// zzz890 — US ESTIMATE REVISIONS AFTER RESULTS: did the street raise or cut its numbers after the print?
// A beat that analysts do not carry into next year's estimates is a one-quarter event; upward revisions after a print
// are what drive the post-earnings drift. Uses the consensus as it stood BEFORE the print (the 7 / 30 / 60 / 90-day-ago
// value that lies before the filing date) against today's. Pure, unit-tested.
import type { EstimateTrendRow } from './us-prices';

export type RevisionVerdict = 'RAISED' | 'CUT' | 'UNCHANGED' | 'NO_DATA';
export interface PeriodRevision { period: string; label: string; before: number | null; now: number | null; changePct: number | null; anchor: string | null; up: number | null; down: number | null }
export interface EstimateRevision { verdict: RevisionVerdict; lines: PeriodRevision[]; text: string; daysSincePrint: number | null }

const LABEL: Record<string, string> = { '0q': 'this quarter', '+1q': 'next quarter', '0y': 'this fiscal year', '+1y': 'next fiscal year' };
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The first snapshot that lies before the print: 7 days ago if the print is less than 7 days old, else 30, 60, 90. */
export function anchorFor(daysSincePrint: number): 'd7' | 'd30' | 'd60' | 'd90' | null {
  if (daysSincePrint < 0) return null;
  if (daysSincePrint < 7) return 'd7'; if (daysSincePrint < 30) return 'd30'; if (daysSincePrint < 60) return 'd60'; if (daysSincePrint < 90) return 'd90';
  return null;
}

export function estimateRevision(rows: EstimateTrendRow[], filingDate: string | null, now = new Date()): EstimateRevision {
  const fd = filingDate ? Date.parse(`${String(filingDate).slice(0, 10)}T00:00:00Z`) : NaN;
  const days = Number.isFinite(fd) ? Math.floor((now.getTime() - fd) / 86_400_000) : null;
  const anchor = days == null ? null : anchorFor(days);
  const lines: PeriodRevision[] = [];
  for (const p of ['0y', '+1y', '+1q']) {
    const r = rows.find((x) => x.period === p); if (!r) continue;
    const before = anchor ? (r[anchor] as number | null) : null;
    const up = days != null && days < 7 ? r.up7 : r.up30; const down = days != null && days < 7 ? r.down7 : r.down30;
    const changePct = num(before) && num(r.current) && Math.abs(before) >= 0.05 ? Math.round(((r.current - before) / Math.abs(before)) * 1000) / 10 : null;
    lines.push({ period: p, label: LABEL[p], before: num(before) ? before : null, now: r.current, changePct, anchor: anchor ? anchor.slice(1) + ' days ago' : null, up, down });
  }
  const fy = lines.find((l) => l.period === '+1y' && l.changePct != null) || lines.find((l) => l.period === '0y' && l.changePct != null);
  if (!fy) return { verdict: 'NO_DATA', lines, daysSincePrint: days, text: days != null && days >= 90 ? 'Print is over 90 days old — no pre-print estimate to compare.' : 'No estimate history for this company.' };
  const verdict: RevisionVerdict = fy.changePct! >= 2 ? 'RAISED' : fy.changePct! <= -2 ? 'CUT' : 'UNCHANGED';
  const ud = fy.up != null || fy.down != null ? ` (${fy.up ?? 0} analysts up, ${fy.down ?? 0} down)` : '';
  const text = `${fy.label[0].toUpperCase()}${fy.label.slice(1)} EPS estimate ${verdict === 'RAISED' ? 'raised' : verdict === 'CUT' ? 'cut' : 'unchanged'} ${fy.changePct! >= 0 ? '+' : ''}${fy.changePct}% since before the print ($${fy.before!.toFixed(2)} → $${fy.now!.toFixed(2)})${ud}.`;
  return { verdict, lines, text, daysSincePrint: days };
}
