// zzz883 — the browser keys that hold the owner's personal data (shared by the client sync and the server allow-list).
export const NOTES_PREFIX = 'mc:notes:v1:';
export const NOTES_BUNDLE = 'mc:notes:bundle';
export const USER_STATE_KEYS_CLIENT = [
  'mc:decisions:v1', 'mc:thesis:v1', 'mc:coffeecan:v1', 'mc:mb-ledger:v1', 'mc:mb-tags:v1', 'mc:signal-log:v1',
  'mc:saved-valuations:v1', 'mc:book-flags:v1', 'mc_portfolio_holdings', 'mc_watchlist_tickers',
  'mc:conviction-beats:v1', 'mc:conviction-beats-us:v1', 'mc:saved-views:v1', 'mc:news-alerts:v1', NOTES_BUNDLE,
  'mc:chart-drawings:v1', 'mc:chart-settings:v1',   // zzz937 — /charts drawings (per ticker) + moving-average settings
] as const;
