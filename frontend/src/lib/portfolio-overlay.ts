// AUDIT_100 #52 — Portfolio attribution helper.
//
// Lets pages outside /portfolio surface inline weight + P&L for tickers
// that the user already owns. Currently used by /multibagger to render
// a "OWN N% Δ+M%" chip next to ticker symbols that are also in the
// portfolio holdings store.
//
// Storage source: `mc_portfolio_holdings` localStorage key (the existing
// canonical portfolio store at frontend/src/app/(dashboard)/portfolio/page.tsx).
//
// Listener pattern: pages subscribe to the existing 'storage' event so
// changes from the /portfolio page propagate cross-tab.

export interface PortfolioHoldingLite {
  symbol: string;
  market?: 'IN' | 'US';
  quantity?: number;
  entryPrice?: number;
  // Derived (optional)
  weight?: number;       // % of portfolio
  pnlPercent?: number;   // % since entry
  currentValue?: number;
  investedValue?: number;
}

const STORAGE_KEY = 'mc_portfolio_holdings';

export function getPortfolioMap(): Map<string, PortfolioHoldingLite> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const m = new Map<string, PortfolioHoldingLite>();
    for (const h of parsed) {
      if (h && typeof h.symbol === 'string') {
        m.set(h.symbol.toUpperCase(), {
          symbol: h.symbol,
          market: h.market,
          quantity: typeof h.quantity === 'number' ? h.quantity : undefined,
          entryPrice: typeof h.entryPrice === 'number' ? h.entryPrice : undefined,
          weight: typeof h.weight === 'number' ? h.weight : undefined,
          pnlPercent: typeof h.pnlPercent === 'number' ? h.pnlPercent : undefined,
          currentValue: typeof h.currentValue === 'number' ? h.currentValue : undefined,
          investedValue: typeof h.investedValue === 'number' ? h.investedValue : undefined,
        });
      }
    }
    return m;
  } catch { return new Map(); }
}

export function isInPortfolio(symbol: string): boolean {
  return getPortfolioMap().has((symbol || '').toUpperCase());
}
