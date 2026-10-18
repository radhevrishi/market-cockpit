// zzz1044c — the two writes the /watchlists page makes to /api/watchlist, with the answer checked.
// Kept out of page.tsx (page files may only export the page). The queue / flag logic is in lib/watchlist-sync.ts.
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
import { interpretWriteResponse, type ListOp, type WriteResult } from '@/lib/watchlist-sync';

const WRITE_TIMEOUT_MS = 20_000;

async function postJson(payload: Record<string, unknown>, requested?: readonly string[]): Promise<WriteResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WRITE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
      cache: 'no-store',
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return interpretWriteResponse(res.ok, res.status, body, requested);
  } catch (e) {
    return { ok: false, error: (e as { name?: string })?.name === 'AbortError' ? 'timed out' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Full-list write (the server replaces the list). */
export function postWatchlistList(list: string[]): Promise<WriteResult> {
  return postJson({ chatId: CHAT_ID, watchlist: list, secret: BOT_SECRET }, list);   // zzz1092 — checked against what was kept
}

/** One company's flag; '' clears it. Resolves true only when the server confirmed. */
export async function postWatchlistFlag(ticker: string, flag: string): Promise<boolean> {
  const r = await postJson({ chatId: CHAT_ID, action: 'set-flag', symbol: ticker, flag: flag || null });
  return r.ok;
}

export function describeListOp(op: ListOp): string {
  const names = op.tickers.length > 3 ? `${op.tickers.slice(0, 3).join(', ')} +${op.tickers.length - 3}` : op.tickers.join(', ');
  return `${op.kind === 'add' ? 'add' : 'remove'} ${names}`;
}
