// zzz883 — the browser keys that hold the owner's personal data (shared by the client sync and the server allow-list).
export const NOTES_PREFIX = 'mc:notes:v1:';
export const NOTES_BUNDLE = 'mc:notes:bundle';
export const USER_STATE_KEYS_CLIENT = [
  'mc:decisions:v1', 'mc:thesis:v1', 'mc:coffeecan:v1', 'mc:mb-ledger:v1', 'mc:mb-tags:v1', 'mc:signal-log:v1',
  'mc:saved-valuations:v1', 'mc:book-flags:v1', 'mc_portfolio_holdings', 'mc_watchlist_tickers',
  'mc:conviction-beats:v1', 'mc:conviction-beats-us:v1', 'mc:saved-views:v1', 'mc:news-alerts:v1', NOTES_BUNDLE,
  'mc:chart-drawings:v1', 'mc:chart-settings:v1',   // zzz937 — /charts drawings (per ticker) + moving-average settings
  'mc:chart-watchlists:v1',                         // zzz940 — /charts watchlist panel (lists, sections, flags)
  'mc:chart-layouts:v1',                            // zzz944 — /charts named layouts (indicator sets)
  'mc:stock-screens:v1',   // zzz938 — saved stock screens
  'mc:screen-shortlists:v1', 'mc:chart-drawing-sets:v1', 'mc:screen-review:v1',   // zzz969 — saved screener shortlists; named drawing sets per chart
] as const;
