// ═══════════════════════════════════════════════════════════════════════════
// THE US CONVICTION BEATS BENCH FOR US PORTFOLIO CATALYSTS.          (zzz797)
//
// "USA Conviction Beats still missing" — the US PC page showed "🏆 US bench
// 0" while the server's US Conviction Beats list (/api/v1/bench-us, KV
// `bench:us:server:v1`) held 92 BLOCKBUSTER / STRONG names. Two reasons, both
// closed here:
//   · the deployed page predated the wiring (round 1 was never deployed), and
//   · even wired, the page leaned on this BROWSER's copy of the list as a
//     second source — and the owner now opens the site from an installed
//     phone app, whose storage is empty. The server list is the source of
//     truth; the browser's copy only adds names the server does not have.
//
// This module is the pure part: which names count (US Conviction Beats tiers
// only, one per ticker, names the owner removed on the US Conviction Beats
// page left off), a compact projection of the server payload (tickers, tier,
// company — no grade cards, no price), and the rebuild the bench-us route
// runs when the KV list was never built (the same walk over the graded-US
// session cache that /api/v1/cron/refresh-us-bench performs).
// ═══════════════════════════════════════════════════════════════════════════

import { usTickerKey } from './sanitize';

export const US_CB_TIERS = new Set(['BLOCKBUSTER', 'STRONG']);
const TICKER_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

export interface UsBenchName {
  ticker: string;
  tier: string | null;
  company: string | null;
  filing_date: string | null;
  exchange: string | null;
}

/** One entry of a bench payload → a US Conviction Beats name, or null. A
 *  tier other than BLOCKBUSTER / STRONG is not on the list; an entry with no
 *  tier (a browser copy written before tiers were stored) is kept. */
export function usBenchName(e: any): UsBenchName | null {
  if (!e || typeof e !== 'object') return null;
  const t = usTickerKey(String(e.ticker || '').split('@')[0]);
  if (!t || !TICKER_RE.test(t)) return null;
  const tier = e.tier ? String(e.tier).toUpperCase() : null;
  if (tier && !US_CB_TIERS.has(tier)) return null;
  return {
    ticker: t, tier,
    company: e.company ? String(e.company).slice(0, 120) : null,
    filing_date: e.filing_date ? String(e.filing_date).slice(0, 10) : null,
    exchange: e.exchange ? String(e.exchange) : null,
  };
}

/** A payload's entries → the compact, de-duplicated list (newest filing
 *  wins; a BLOCKBUSTER beats a STRONG for the same filing date). */
export function compactUsBench(entries: unknown): UsBenchName[] {
  const by = new Map<string, UsBenchName>();
  for (const e of Array.isArray(entries) ? entries : []) {
    const n = usBenchName(e);
    if (!n) continue;
    const had = by.get(n.ticker);
    if (!had) { by.set(n.ticker, n); continue; }
    const newer = String(n.filing_date || '') > String(had.filing_date || '');
    const same = String(n.filing_date || '') === String(had.filing_date || '');
    if (newer || (same && n.tier === 'BLOCKBUSTER' && had.tier !== 'BLOCKBUSTER')) by.set(n.ticker, { ...n, company: n.company || had.company, exchange: n.exchange || had.exchange });
  }
  return Array.from(by.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export interface UsBenchMerge {
  names: UsBenchName[];
  server: number;
  local: number;
  localOnly: number;
  removed: string[];
}

/** The server list + this browser's list, minus what the owner removed on
 *  the US Conviction Beats page (its recycle bin). Pure. */
export function mergeUsBench(server: unknown, local: unknown, removedTickers: Iterable<string> = []): UsBenchMerge {
  const removedSet = new Set(Array.from(removedTickers, (t) => usTickerKey(String(t || '').split('@')[0])).filter(Boolean));
  const s = compactUsBench(server), l = compactUsBench(local);
  const sSet = new Set(s.map((x) => x.ticker));
  const removed = s.filter((x) => removedSet.has(x.ticker)).map((x) => x.ticker);
  // A name the owner removed stays off even if the server still lists it; a
  // name in this browser's own list is on it (that list already honours the
  // owner's removals — a remove deletes it there).
  const names = compactUsBench([...s.filter((x) => !removedSet.has(x.ticker)), ...l]);
  return { names, server: s.length, local: l.length, localOnly: l.filter((x) => !sSet.has(x.ticker)).length, removed };
}

// ── the server-side rebuild (the refresh-us-bench walk, read-only) ─────────

/** `count` weekday sessions ending at `endDate`, newest first. */
export function usBenchSessions(endDate: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count && i < count * 3; i++) {
    const iso = new Date(Date.parse(endDate + 'T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10);
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(iso);
  }
  return out;
}

/**
 * Rebuild the US Conviction Beats bench from the graded-US session cache —
 * the same source (and the same rule: BLOCKBUSTER + STRONG, newest filing per
 * ticker) as the refresh-us-bench cron and the US Conviction Beats page.
 * `readSession` returns one session's `{ by_tier }` or null (cold). Reads are
 * run `concurrency` at a time; nothing is graded here.
 */
export async function rebuildUsBench(
  sessions: string[],
  readSession: (date: string) => Promise<{ by_tier?: Record<string, any[]> } | null>,
  opts: { concurrency?: number; maxEntries?: number; deadlineMs?: number } = {},
): Promise<{ entries: any[]; warm: number; cold: number; timedOut: boolean }> {
  const payloads: Array<{ date: string; p: { by_tier?: Record<string, any[]> } | null }> = new Array(sessions.length);
  const t0 = Date.now();
  let i = 0, timedOut = false;
  const worker = async () => {
    while (i < sessions.length) {
      if (opts.deadlineMs && Date.now() - t0 > opts.deadlineMs) { timedOut = true; return; }
      const k = i++;
      let p: { by_tier?: Record<string, any[]> } | null = null;
      try { p = await readSession(sessions[k]); } catch { p = null; }
      payloads[k] = { date: sessions[k], p };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 8, sessions.length)) }, worker));
  const byTicker = new Map<string, any>();
  let warm = 0, cold = 0;
  // newest session first: first write wins
  for (const x of payloads) {
    if (!x) continue;
    if (!x.p?.by_tier) { cold++; continue; }
    warm++;
    for (const tier of ['BLOCKBUSTER', 'STRONG']) {
      for (const row of Array.isArray(x.p.by_tier[tier]) ? x.p.by_tier[tier] : []) {
        if (!row?.ticker || byTicker.has(row.ticker)) continue;
        byTicker.set(row.ticker, { ...row, tier: row.tier || tier, seen_date: x.date });
      }
    }
  }
  const entries = Array.from(byTicker.values())
    .sort((a, b) => String(b.filing_date || b.seen_date || '').localeCompare(String(a.filing_date || a.seen_date || '')))
    .slice(0, opts.maxEntries ?? 600);
  return { entries, warm, cold, timedOut };
}

/** Plain words for the header when the bench is empty. */
export function usBenchEmptyReason(info: { server: number; local: number; serverNote?: string | null; serverError?: string | null } | null | undefined): string {
  if (!info) return 'The US Conviction Beats list has not loaded yet.';
  if (info.serverError) return `The US Conviction Beats list could not be read from the server (${info.serverError}) and this browser holds no copy — reload to retry.`;
  return 'US Conviction Beats list is empty — open US Earnings Opportunities (or US Conviction Beats) once to fill it; the server list fills itself after the nightly US grading runs.'
    + (info.serverNote ? ` Server: ${info.serverNote}.` : '');
}

/** The header's bench line — count, source, and a sum that reconciles. */
export function usBenchLine(
  info: { total: number; server: number; localOnly: number; removed: number; updatedAt: string | null; serverSource: string | null; serverError?: string | null } | null | undefined,
  onBench: number, held: number, label = 'Conviction Beats (US)',
): string {
  if (!info) return `bench: loading the ${label} list…`;
  if (!info.total) return `bench: 0 from ${label} — the list is empty${info.serverError ? ' (the server list could not be read)' : ''}`;
  const other = Math.max(0, info.total - onBench - held);
  const when = info.updatedAt ? ` updated ${String(info.updatedAt).slice(0, 10)}` : '';
  const src = info.server
    ? `server list ${info.server} name${info.server === 1 ? '' : 's'}${when}${info.serverSource === 'rebuilt' ? ', rebuilt from the graded US sessions' : ''}`
    : `this browser's list only${info.serverError ? ' (the server list could not be read)' : ' (the server list is empty)'}`;
  return `bench: ${onBench} from ${label} — ${info.total} on that list = ${onBench} on the bench + ${held} you hold (counted once, as holdings)`
    + `${other ? ` + ${other} not on the page (non-US listing)` : ''}`
    + ` · source: ${src}${info.server && info.localOnly ? ` + ${info.localOnly} only in this browser` : ''}`
    + `${info.removed ? ` · ${info.removed} you removed on US Conviction Beats left off` : ''}`;
}
