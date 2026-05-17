// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTELLIGENCE — index set maintenance helper.
//
// PATCH 0458 — Lives in /lib because Next.js App Router route files can only
// export GET / POST / DELETE / PATCH / runtime / dynamic etc. Any other
// export (even a helper function) fails the build with
// "X is not a valid Route export field". The earlier version exported
// maintainIndex from .../company-intel/index/route.ts which broke deploys.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

const INDEX_KEY = 'company-intel:index:v1';

/** Append a ticker to the company-intel tickers index. Capped at 500. */
export async function maintainCompanyIntelIndex(ticker: string): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    const tickers = (await kvGet<string[]>(INDEX_KEY)) || [];
    const tk = ticker.toUpperCase();
    if (!tickers.includes(tk)) {
      tickers.push(tk);
      const trimmed = tickers.slice(-500);
      await kvSet(INDEX_KEY, trimmed, 365 * 24 * 3600);
    }
  } catch {}
}
