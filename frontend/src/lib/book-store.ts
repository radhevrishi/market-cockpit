// zzz397 — Book Watch spine (server-side, KV-backed).
//
// THE PROBLEM this solves (from the CIO tab-audit): Market Cockpit computes
// institutional-grade buy/sell signals — thesis-drift, Stage-4 breakdown,
// bench DRIFT, structural red-flags, earnings-tier downgrades — and then lets
// them die in a closed browser tab. Nothing syncs across devices, nothing is
// pushed, and most tabs don't even know which names the user actually holds.
//
// This module is the persistence + evaluation spine that fixes that:
//   1. The client SYNCs its book (holdings + conviction bench + watchlist +
//      per-ticker decision snapshots + any client-armed flags) to KV via
//      /api/v1/book/sync, so the book survives a closed tab.
//   2. A cron (/api/v1/cron/book-watch) reads the book from KV and evaluates
//      SERVER-authoritative conditions (earnings-tier changes from the graded
//      KV, price drawdowns) + relays client-armed flags, then dispatches the
//      NEW ones through lib/alert-dispatcher (Slack/SMTP/webhook/telegram —
//      all no-op gracefully until their env vars are set).
//   3. A dedup ledger (day-bucketed) prevents the same condition re-alerting
//      every cron tick, and a capped feed gives an in-app "Book Watch" inbox
//      even when no push channel is configured.
//
// PURE server module: only imports lib/kv. No React, no browser globals.
// Single-tenant for now (no Auth): keyed by chatId, defaulting to the same
// CHAT_ID the portfolio route already uses. When Auth lands, chatId → userId
// is a one-line swap.

import { kvGet, kvSet } from './kv';

// ── Types ────────────────────────────────────────────────────────────────

export type BookFlagKind =
  | 'EARNINGS_TIER_DOWNGRADE' // server: a held/bench name's latest graded tier is worse than last seen
  | 'EARNINGS_PRINT'          // server: a held/bench name reported today
  | 'BENCH_DRIFT'             // server: a BLOCKBUSTER/STRONG bench name is fading hard post-print
  | 'HOLDING_DRAWDOWN'        // server: a held name is down materially vs entry/decision price
  | 'THESIS_DRIFT_REOPEN'     // client: a REJECTED name is now grading high again
  | 'THESIS_BREAK'            // client: a BUY/WATCH name decayed to a low grade / gained a CRITICAL flag
  | 'STAGE4_BREAKDOWN'        // client: a held name broke down technically (Stage 4)
  | 'STRUCTURAL_RISK';        // client: a held name carries a CRITICAL/HIGH structural red flag / pump

export type BookFlagSeverity = 'critical' | 'warning' | 'info';

export interface BookFlag {
  kind: BookFlagKind;
  ticker: string;
  company?: string;
  severity: BookFlagSeverity;
  message: string;            // human-readable one-liner (this is what gets pushed)
  detail?: string;            // optional extra context
  source: 'client' | 'server';
  armedAt: string;            // ISO
}

export interface BookTicker {
  ticker: string;             // canonical uppercase
  company?: string;
  held?: boolean;
  benched?: boolean;
  watchlisted?: boolean;
  market?: 'IN' | 'US';
  // decision snapshot (from lib/decisions)
  decisionStatus?: 'BUY' | 'WATCH' | 'NEUTRAL' | 'REJECTED';
  scoreAtDecision?: number;
  gradeAtDecision?: string;
  priceAtDecision?: number;
  // bench snapshot (from lib/conviction-beats)
  benchTier?: 'BLOCKBUSTER' | 'STRONG';
  // holding snapshot (from portfolio)
  entryPrice?: number;
  quantity?: number;
  // last-seen earnings snapshot (so the cron can detect a downgrade)
  lastTier?: string;          // EarningsTier last recorded for this name
  lastComposite?: number;
}

export interface BookState {
  chatId: string;
  updatedAt: string;
  tickers: BookTicker[];
  clientFlags?: BookFlag[];   // flags the client already armed (thesis/stage/structural)
}

// ── KV keys ──────────────────────────────────────────────────────────────

const BOOK_KEY = (chatId: string) => `book:v1:${chatId}`;
const DISPATCHED_KEY = (chatId: string) => `book-watch:dispatched:v1:${chatId}`;
const FEED_KEY = (chatId: string) => `book-watch:feed:v1:${chatId}`;

const BOOK_TTL_S = 60 * 60 * 24 * 60;     // 60 days
const DISPATCH_TTL_S = 60 * 60 * 24 * 4;  // 4 days (dedup window)
const FEED_TTL_S = 60 * 60 * 24 * 30;     // 30 days
const FEED_MAX = 200;

// ── Book state read/write ────────────────────────────────────────────────

export async function readBookState(chatId: string): Promise<BookState | null> {
  return kvGet<BookState>(BOOK_KEY(chatId));
}

export async function writeBookState(state: BookState): Promise<void> {
  const clean: BookState = {
    chatId: state.chatId,
    updatedAt: new Date().toISOString(),
    tickers: Array.isArray(state.tickers) ? state.tickers.slice(0, 1000) : [],
    clientFlags: Array.isArray(state.clientFlags) ? state.clientFlags.slice(0, 300) : [],
  };
  await kvSet(BOOK_KEY(state.chatId), clean, BOOK_TTL_S);
}

// ── Dedup ledger (day-bucketed fingerprints) ─────────────────────────────

/**
 * A persistent condition (e.g. a held name still broken) should re-alert at
 * most once per day, not on every cron tick. Day-bucketing the fingerprint
 * gives exactly that: same kind+ticker+day → one alert.
 */
export function flagFingerprint(f: BookFlag): string {
  const day = (f.armedAt || new Date().toISOString()).slice(0, 10);
  return `${f.kind}:${f.ticker}:${day}`;
}

export async function readDispatched(chatId: string): Promise<Record<string, string>> {
  return (await kvGet<Record<string, string>>(DISPATCHED_KEY(chatId))) || {};
}

export async function markDispatched(chatId: string, fingerprints: string[]): Promise<void> {
  if (!fingerprints.length) return;
  const cur = await readDispatched(chatId);
  const nowIso = new Date().toISOString();
  for (const fp of fingerprints) cur[fp] = nowIso;
  // prune entries older than the dedup window so the ledger can't grow forever
  const cutoff = Date.now() - DISPATCH_TTL_S * 1000;
  for (const k of Object.keys(cur)) {
    const t = Date.parse(cur[k]);
    if (!Number.isNaN(t) && t < cutoff) delete cur[k];
  }
  await kvSet(DISPATCHED_KEY(chatId), cur, DISPATCH_TTL_S);
}

// ── In-app alert feed (works even with no push channel configured) ───────

export async function readFeed(chatId: string): Promise<BookFlag[]> {
  return (await kvGet<BookFlag[]>(FEED_KEY(chatId))) || [];
}

export async function appendFeed(chatId: string, flags: BookFlag[]): Promise<void> {
  if (!flags.length) return;
  const cur = await readFeed(chatId);
  const next = [...flags, ...cur].slice(0, FEED_MAX);
  await kvSet(FEED_KEY(chatId), next, FEED_TTL_S);
}

// ── Severity → importance score (for the alert payload) ──────────────────

export function severityScore(sev: BookFlagSeverity): number {
  if (sev === 'critical') return 95;
  if (sev === 'warning') return 70;
  return 45;
}

export const BOOK_FLAG_LABEL: Record<BookFlagKind, string> = {
  EARNINGS_TIER_DOWNGRADE: 'Earnings downgrade',
  EARNINGS_PRINT: 'Earnings print',
  BENCH_DRIFT: 'Bench drift',
  HOLDING_DRAWDOWN: 'Holding drawdown',
  THESIS_DRIFT_REOPEN: 'Thesis reopen',
  THESIS_BREAK: 'Thesis break',
  STAGE4_BREAKDOWN: 'Stage-4 breakdown',
  STRUCTURAL_RISK: 'Structural risk',
};
