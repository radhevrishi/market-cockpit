// ═══════════════════════════════════════════════════════════════════════════
// COFFEE-CAN STORE (buy-and-forget sleeve)
//
// A coffee-can portfolio is a deliberate buy-and-forget bucket for true
// multi-decade holds. The user flags their highest-conviction compounders and
// then DOESN'T touch them. This store is the tiny persistence spine for that
// curated subset of holdings — it records which tickers are "in the can", when
// each was sealed in (addedAt), and when it was last given its annual review
// (reviewedAt).
//
// Design notes:
//   • Client-only, localStorage-backed. Every read/write is SSR-guarded via
//     `typeof window !== 'undefined'` so it is safe to import from a page that
//     server-renders; nothing here touches `window` during module load.
//   • Tickers are canonicalised to UPPERCASE with any `.NS`/`.BO` suffix
//     stripped, so the can matches quotes/holdings regardless of exchange tag.
//   • Every write dispatches a window CustomEvent `'coffeecan:updated'` so the
//     page (and any other open surface) can re-read reactively.
//   • addToCoffeeCan stamps addedAt only on first entry — re-adding an existing
//     name never resets its holding clock (the whole point is a long hold).
// ═══════════════════════════════════════════════════════════════════════════

const STORE_KEY = 'mc:coffeecan:v1';
const UPDATED_EVENT = 'coffeecan:updated';

export interface CoffeeCanState {
  tickers: string[];
  addedAt: Record<string, string>;      // ticker → ISO timestamp sealed into the can
  reviewedAt?: Record<string, string>;  // ticker → ISO timestamp of last annual review
}

/** Canonical key: uppercase, strip .NS/.BO exchange suffix. */
function norm(ticker: string): string {
  return (ticker || '').toUpperCase().trim().replace(/\.(NS|BO)$/i, '');
}

function emptyState(): CoffeeCanState {
  return { tickers: [], addedAt: {}, reviewedAt: {} };
}

/** Read the full coffee-can state. SSR-safe; returns an empty shape off-client. */
export function readCoffeeCan(): CoffeeCanState {
  if (typeof window === 'undefined') return emptyState();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const tickers = Array.isArray(parsed.tickers)
      ? parsed.tickers.map((t: any) => norm(String(t))).filter(Boolean)
      : [];
    // de-dupe defensively
    const uniq = Array.from(new Set(tickers));
    return {
      tickers: uniq,
      addedAt: parsed.addedAt && typeof parsed.addedAt === 'object' ? parsed.addedAt : {},
      reviewedAt: parsed.reviewedAt && typeof parsed.reviewedAt === 'object' ? parsed.reviewedAt : {},
    };
  } catch {
    return emptyState();
  }
}

function writeCoffeeCan(state: CoffeeCanState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(UPDATED_EVENT));
  } catch {
    // localStorage unavailable / quota — swallow; the can is best-effort.
  }
}

/** Set of canonical tickers currently in the can. */
export function getCoffeeCanTickers(): Set<string> {
  return new Set(readCoffeeCan().tickers);
}

/** Is this ticker sealed in the can? */
export function isCoffeeCan(ticker: string): boolean {
  const k = norm(ticker);
  if (!k) return false;
  return getCoffeeCanTickers().has(k);
}

/** Seal a name into the can. Stamps addedAt only on first entry. */
export function addToCoffeeCan(ticker: string): void {
  const k = norm(ticker);
  if (!k) return;
  const state = readCoffeeCan();
  if (!state.tickers.includes(k)) {
    state.tickers.push(k);
  }
  if (!state.addedAt[k]) {
    state.addedAt[k] = new Date().toISOString();
  }
  writeCoffeeCan(state);
}

/** Remove a name from the can (deliberate action — the page gates this). */
export function removeFromCoffeeCan(ticker: string): void {
  const k = norm(ticker);
  if (!k) return;
  const state = readCoffeeCan();
  state.tickers = state.tickers.filter((t) => t !== k);
  delete state.addedAt[k];
  if (state.reviewedAt) delete state.reviewedAt[k];
  writeCoffeeCan(state);
}

/** Stamp "reviewed now" for the annual-review discipline. */
export function markCoffeeCanReviewed(ticker: string): void {
  const k = norm(ticker);
  if (!k) return;
  const state = readCoffeeCan();
  if (!state.reviewedAt) state.reviewedAt = {};
  state.reviewedAt[k] = new Date().toISOString();
  writeCoffeeCan(state);
}
