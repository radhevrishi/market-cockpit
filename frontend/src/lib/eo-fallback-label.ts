// zzz898 — label for Earnings Opportunities when the page lands on an earlier day
// because the requested day has no graded results. It must never look like today.
export function eoFallbackLabel(from: string, to: string, todayIso: string): string {
  if (!from || !to || from === to) return '';
  if (from === todayIso) {
    return `Showing ${to} — no results filed today (${from}) yet. Use the date arrows or "Latest" to change.`;
  }
  return `Showing ${to} — no graded results for ${from} yet. Use the date arrows or "Latest" to change.`;
}
