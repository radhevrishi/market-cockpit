// ═══════════════════════════════════════════════════════════════════════════
// DECISION LOG — personal logbook for each company.
//
// User-set decisions ('REJECTED', 'BUY', 'WATCH', 'NEUTRAL') with a reason
// note persist in localStorage. Survives across uploads, clears, and tabs.
// Even if the user clears the Multibagger upload list, their rejection /
// buy / watch decisions remain so they can see "I already evaluated this
// company on date X for reason Y" when the same ticker appears in a future
// upload.
//
// Surface points:
//   - Multibagger India tab: expanded row → 4 decision buttons + reason input
//   - Multibagger USA tab: expanded row → 4 decision buttons + reason input
//   - Collapsed rows: badge showing current decision status (compact)
//   - Filter chips: filter list by decision status
// ═══════════════════════════════════════════════════════════════════════════

export type DecisionStatus = 'BUY' | 'WATCH' | 'NEUTRAL' | 'REJECTED';
export type DecisionMarket = 'IN' | 'US';

export interface Decision {
  symbol: string;
  market: DecisionMarket;
  status: DecisionStatus;
  reason: string;
  company?: string;        // last-known company name
  date: string;            // ISO timestamp of last update
  scoreAtDecision?: number;// score on the row when the decision was recorded
  gradeAtDecision?: string;// grade on the row when the decision was recorded
}

const LS_KEY = 'mc:decisions:v1';
const UPDATE_EVENT = 'mc:decisions:updated';

/** Read all decisions */
export function readDecisions(): Record<string, Decision> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Write the full map and notify */
function writeDecisions(map: Record<string, Decision>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch {}
}

/** Get a single decision (or undefined) */
export function getDecision(symbol: string): Decision | undefined {
  if (!symbol) return undefined;
  const map = readDecisions();
  return map[symbol.toUpperCase().trim()];
}

/** Upsert a decision */
export function setDecision(d: Omit<Decision, 'date'> & { date?: string }): Decision {
  const map = readDecisions();
  const key = d.symbol.toUpperCase().trim();
  const entry: Decision = {
    ...d,
    symbol: key,
    date: d.date ?? new Date().toISOString(),
  };
  map[key] = entry;
  writeDecisions(map);
  return entry;
}

/** Remove a decision (set to no-decision) */
export function clearDecision(symbol: string) {
  const map = readDecisions();
  delete map[symbol.toUpperCase().trim()];
  writeDecisions(map);
}

/** Hook to subscribe to decision changes (returns the current map, refreshes on update) */
export function subscribeDecisions(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener(UPDATE_EVENT, handler);
  // Storage event for cross-tab sync
  window.addEventListener('storage', (e) => { if (e.key === LS_KEY) cb(); });
  return () => {
    window.removeEventListener(UPDATE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** Counts by status */
export function countByStatus(): Record<DecisionStatus, number> {
  const map = readDecisions();
  const counts: Record<DecisionStatus, number> = { BUY: 0, WATCH: 0, NEUTRAL: 0, REJECTED: 0 };
  Object.values(map).forEach(d => { counts[d.status]++; });
  return counts;
}

/** Color and emoji per status */
export const DECISION_META: Record<DecisionStatus, { color: string; emoji: string; label: string }> = {
  BUY:      { color: '#10b981', emoji: '✅', label: 'BUY'      },
  WATCH:    { color: '#f59e0b', emoji: '👁',  label: 'WATCH'    },
  NEUTRAL:  { color: '#94a3b8', emoji: '⚪', label: 'NEUTRAL'  },
  REJECTED: { color: '#ef4444', emoji: '❌', label: 'REJECTED' },
};
