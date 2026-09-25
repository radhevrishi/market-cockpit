// ═══════════════════════════════════════════════════════════════════════════
// US AI DAILY GAINERS — RESEARCH TIED TO THE SCAN IT WAS BUILT FROM. (zzz799)
//
// "This still taking not today gainers." The page showed a 66-name board from
// the 16:54 ET scan, but its MARKET SUMMARY said "57 GAINERS SCANNED" with the
// same seven cards as the 15:55 ET scan an hour earlier. The research store is
// keyed by the session DATE only (ai-gainers:research:v1:US:<date>), and the
// page preferred the view the server had built from that store — i.e. from
// the 57-name board the research was last run on — over the board it had just
// scanned. Nothing tied the research to a scan.
//
// Now every stored research state carries the board it was registered from
// (a hash of its tickers + the scan time). The page uses the server's view
// only when that hash equals the board on screen; otherwise it builds the view
// from the current board, and a free SEC pass (no AI) registers the new board,
// researches the new names and drops the ones that fell off (listed as "no
// longer in today's list"). US only — India is unchanged.
//
// Pure: no fetch, no storage.
// ═══════════════════════════════════════════════════════════════════════════

/** The board's identity: how many names + a short hash of the sorted tickers. */
export function boardHash(tickers: Iterable<string>): string {
  const list = Array.from(new Set(Array.from(tickers, (t) => String(t || '').trim().toUpperCase()).filter(Boolean))).sort();
  // FNV-1a, 32-bit — an identity check, not security.
  let h = 0x811c9dc5;
  const s = list.join(',');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${list.length}-${h.toString(16).padStart(8, '0')}`;
}

/** Names on the previous board that are not on the new one (kept with their company), merged with any earlier drops; a name back on the board leaves the list. */
export function droppedFromBoard(
  prev: Array<{ ticker: string; company?: string | null }>,
  next: Iterable<string>,
  earlier: Array<{ ticker: string; company: string | null }> = [],
): Array<{ ticker: string; company: string | null }> {
  const now = new Set(Array.from(next, (t) => String(t || '').toUpperCase()));
  const out = new Map<string, { ticker: string; company: string | null }>();
  for (const e of earlier) { const t = String(e?.ticker || '').toUpperCase(); if (t && !now.has(t)) out.set(t, { ticker: t, company: e.company ?? null }); }
  for (const p of prev) { const t = String(p?.ticker || '').toUpperCase(); if (t && !now.has(t)) out.set(t, { ticker: t, company: p.company ?? null }); }
  return Array.from(out.values()).sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, 200);
}

/** Should the page use the view the server built? Only when it was built from this exact board. */
export function serverViewMatchesBoard(serverHash: string | null | undefined, currentHash: string | null | undefined): boolean {
  return !!serverHash && !!currentHash && serverHash === currentHash;
}

/**
 * Does the board on screen need the free SEC pass? Yes when the stored
 * research was registered from another board, or when names on the board
 * (in research scope) have no finding yet.
 */
export function needsBoardSync(opts: { serverHash: string | null | undefined; currentHash: string; missing: number; boardSize: number }): boolean {
  if (!opts.boardSize) return false;
  if (opts.serverHash !== opts.currentHash) return true;
  return opts.missing > 0;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-24" → "Thu 24 Sep" (fixed English labels, same on every device). */
const fmtDay = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return ymd;
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
};

/** Today's calendar date in a time zone, as YYYY-MM-DD. */
export function ymdIn(tz: string, now: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return p.slice(0, 10);
}

/**
 * Which US session the board covers, in plain words:
 * "US session Thu 24 Sep (New York time)". When it is already the next day
 * in India (02:24 IST Friday), says so, so the board does not look like old data.
 */
export function usSessionPhrase(sessionYmd: string | null | undefined, now: Date = new Date()): string | null {
  if (!sessionYmd || !/^\d{4}-\d{2}-\d{2}$/.test(sessionYmd)) return null;
  const base = `US session ${fmtDay(sessionYmd)} (New York time)`;
  let india: string;
  try { india = ymdIn('Asia/Kolkata', now); } catch { return base; }
  if (india > sessionYmd) {
    let ny = sessionYmd;
    try { ny = ymdIn('America/New_York', now); } catch { /* keep */ }
    const still = ny === sessionYmd ? ` — it is already ${fmtDay(india)} in India, but this is still today's US session` : ` — it is ${fmtDay(india)} in India`;
    return base + still;
  }
  return base;
}

/**
 * When a sweep must stop and say why, instead of "running…" for ever.
 * `stalledCalls` = consecutive calls that researched nothing new.
 */
export function sweepStopReason(opts: { calls: number; maxCalls: number; stalledCalls: number; retrying: number; elapsedMs: number; maxMs: number; remaining: number }): string | null {
  if (opts.remaining <= 0) return null;
  if (opts.elapsedMs >= opts.maxMs) return `stopped after ${Math.round(opts.elapsedMs / 60_000)} minutes with ${opts.remaining} name${opts.remaining === 1 ? '' : 's'} not yet researched — press ▶ Research to continue`;
  if (opts.calls >= opts.maxCalls) return `stopped after ${opts.calls} rounds with ${opts.remaining} name${opts.remaining === 1 ? '' : 's'} not yet researched — press ▶ Research to continue`;
  if (opts.stalledCalls >= 3 && !opts.retrying) return `stopped: the last ${opts.stalledCalls} rounds researched nothing new (${opts.remaining} left) — the SEC / price sources are not answering; press ▶ Research to try again`;
  return null;
}
