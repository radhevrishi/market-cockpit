// zzz398 — Client-side Book Watch flag store.
//
// Pages that compute a per-name signal (Technicals Stage-4 breakdown, Conviction
// bench DRIFT, Valuation WATCH→BUY crossing, Multibagger thesis-drift) can ARM a
// Book Watch flag by calling armBookFlag(). The flags are queued in localStorage
// and picked up by lib/book-sync-client, which ships them to the server as
// `clientFlags` on the next book sync — where the book-watch cron relays them
// into the alert feed + push channels.
//
// PURE client module: never import the server book-store (it pulls in KV/node).
// The flag shape here mirrors what /api/v1/book/sync sanitizes.

export type ClientFlagKind =
  | 'THESIS_DRIFT_REOPEN'
  | 'THESIS_BREAK'
  | 'STAGE4_BREAKDOWN'
  | 'STRUCTURAL_RISK'
  | 'BENCH_DRIFT'
  | 'HOLDING_DRAWDOWN';

export interface ClientBookFlag {
  kind: ClientFlagKind;
  ticker: string;
  company?: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  detail?: string;
  armedAt: string; // ISO
}

const LS_KEY = 'mc:book-flags:v1';
const MAX = 200;
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readRaw(): ClientBookFlag[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeRaw(arr: ClientBookFlag[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, MAX)));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Arm a Book Watch flag. Deduped by kind+ticker+day so a page re-render (or a
 * condition that stays true across visits) queues the flag at most once per day.
 * Fires `mc:book-flags:updated` so the dashboard sync effect ships it promptly.
 */
export function armBookFlag(f: Omit<ClientBookFlag, 'armedAt'> & { armedAt?: string }): void {
  if (typeof window === 'undefined') return;
  const ticker = String(f.ticker || '').toUpperCase().trim();
  if (!ticker || !f.kind || !f.message) return;
  const armedAt = f.armedAt || new Date().toISOString();
  const day = armedAt.slice(0, 10);
  const arr = readRaw();
  if (arr.some((x) => x.kind === f.kind && x.ticker === ticker && (x.armedAt || '').slice(0, 10) === day)) {
    return; // already armed today
  }
  arr.unshift({
    kind: f.kind,
    ticker,
    company: f.company ? String(f.company).slice(0, 120) : undefined,
    severity: f.severity || 'warning',
    message: String(f.message).slice(0, 300),
    detail: f.detail ? String(f.detail).slice(0, 300) : undefined,
    armedAt,
  });
  writeRaw(arr);
  try {
    window.dispatchEvent(new CustomEvent('mc:book-flags:updated'));
  } catch {
    /* ignore */
  }
}

/** Read currently-armed flags (pruned to the last 7 days). */
export function readArmedBookFlags(): ClientBookFlag[] {
  if (typeof window === 'undefined') return [];
  const cutoff = Date.now() - PRUNE_MS;
  const arr = readRaw().filter((x) => {
    const t = Date.parse(x.armedAt || '');
    return Number.isNaN(t) || t >= cutoff;
  });
  // opportunistically persist the pruned list so it can't grow unbounded
  if (arr.length !== readRaw().length) writeRaw(arr);
  return arr;
}
