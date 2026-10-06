// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type OptionalCol, type HubFilters } from './types';

// zzz254 — Sector color palette for the sector-dot chip. Stable, distinctive
// hues so an analyst scanning 42 cards instantly clusters by industry.
export const SECTOR_COLORS: Record<string, string> = {
  'Pharma': '#14B8A6', 'Chemicals': '#8B5CF6', 'Chemicals/Fertilizers': '#8B5CF6',
  'Chemicals/Additives': '#8B5CF6', 'Real Estate': '#EF4444',
  'EMS/Defence': '#A78BFA', 'Defence': '#A78BFA', 'Defence/Aerospace': '#A78BFA',
  'Refractories': '#F97316', 'Rubber Products': '#F97316', 'Paper': '#84CC16',
  'NBFC': '#6366F1', 'Banks': '#F59E0B', 'PSU Banks': '#EAB308',
  'Auto Parts': '#F97316', 'Auto OEM': '#F97316',
  'Power/Transmission': '#0EA5E9', 'Power': '#0EA5E9', 'Power/Green Finance': '#0EA5E9',
  'Steel': '#64748B', 'Broker/Fintech': '#EC4899', 'FMCG': '#10B981',
  'AMC': '#22D3EE', 'Consumer Durables': '#F59E0B', 'Diagnostics': '#14B8A6',
  'Ratings/Analytics': '#22D3EE', 'Distillers/Breweries': '#8B5CF6',
  'IT Services': '#22D3EE', 'IT Products': '#22D3EE', 'Hotels': '#F472B6',
  'Jewelry/Bullion': '#EAB308', 'Renewables': '#10B981', 'EVs/Buses': '#10B981',
  'Textiles': '#8B5CF6', 'Electronics/Bartronics': '#A78BFA',
  'Cement': '#94A3B8', 'Logistics': '#0EA5E9', 'Paints': '#EC4899', 'Engineering': '#F97316',
};

export const sectorColor = (sec: string | null): string => (sec && SECTOR_COLORS[sec]) || 'var(--mc-text-4)';

export const OPTIONAL_COLS: Array<{ id: OptionalCol; label: string }> = [
  { id: 'volume',      label: 'Volume' },
  { id: 'week52High',  label: '52W High' },
  { id: 'week52Low',   label: '52W Low' },
  { id: 'marketCap',   label: 'Market Cap' },
  { id: 'peRatio',     label: 'P/E (TTM)' },
  { id: 'avgVolume',   label: 'Avg Vol (20D)' },
];

export const COL_PREFS_KEY = 'mc:watchlist:cols:v1';

// ── Constants ──────────────────────────────────────────────────────────────────

// No hardcoded default — watchlist comes from Redis API (synced via Telegram bot or UI)
export const DEFAULT_TICKERS: string[] = [];

export const STORAGE_KEY = 'mc_watchlist_tickers';

// ═══════════════════════════════════════════════════════════════════════════
// CONVICTION BEATS PANEL (PATCH 0186)
// Auto-populated bench of BLOCKBUSTER + STRONG earnings prints from
// /earnings-opportunities. localStorage-backed via lib/conviction-beats.ts.
// ═══════════════════════════════════════════════════════════════════════════
// zzz811 — the Conviction Beats filter (ConvFilters, the India preset,
// passesConvictionFilter and its helpers) moved VERBATIM to
// lib/conviction-filter-india.ts so Portfolio Catalysts applies the SAME
// function to the SAME list. Imported at the top of this file.

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0539 — Rich Earnings Hub Scan parity for Conviction Beats.
// Fetches enriched EarningsScanCard payloads for the bench tickers via the
// same /api/market/earnings-scan endpoint the /earnings hub uses, caches in
// localStorage (24h TTL — past quarters are immutable), and surfaces the
// SAME card UI Earnings Hub Scan renders. Existing compact rows still
// available via the view-mode toggle.
// ═══════════════════════════════════════════════════════════════════════════
export const RICH_LS_KEY = 'mc:conviction-enriched:v1';

export const RICH_TTL_MS = 24 * 60 * 60 * 1000;

export const HUB_FILTER_DEFAULT: HubFilters = {
  grades: new Set(),
  scoreMin: null,
  divergenceOnly: false,
  dataQuality: new Set(),
  audience: new Set(),
};

export const EI_ELITE_LS_KEY = 'mc:ei-elite:v1';

export const EI_ELITE_HIDDEN_KEY = 'mc:ei-elite:hidden:v1';

export const EI_ELITE_MAX_AGE_DAYS = 30;
