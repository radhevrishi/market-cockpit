// ═══════════════════════════════════════════════════════════════════════════
// KV KEY REGISTRY — PATCH 0455 CLEANUP-4
//
// Single inventory of every Upstash Redis (KV) key prefix used by the app.
// Audit found 20+ prefixes scattered across routes with no central reference —
// new contributors silently introduced collisions and version drift.
//
// Conventions:
//   • Format: <domain>:<purpose>:v<version>:<scope>
//   • Bump <version> when the value shape changes incompatibly.
//   • Always set an explicit TTL on writes — never write a long-lived key.
//
// Read this file before adding a new KV key.
// ═══════════════════════════════════════════════════════════════════════════

export const KV_KEYS = {
  // News / bottleneck
  news_articles:                 'news:articles:v39',
  news_persistent_bottleneck:    'bottleneck:articles:persistent:v14',

  // Earnings
  earnings_calendar:             (date: string) => `earnings-calendar:auto:${date}`,
  earnings_graded:               (date: string) => `graded:v8:${date}`,
  earnings_enrich:               (sym: string, date?: string) =>
                                   date ? `enrich:v5:${sym}:${date}` : `enrich:v5:${sym}`,
  earnings_postgap:              (ticker: string, filed: string, timing: string, period: string) =>
                                   `post-gap:v4:${ticker}:${filed}:${timing}:${period}`,
  earnings_guidance:             'guidance:events',
  earnings_backtest:             (days: number) => `eo-backtest:v1:${days}d`,

  // Special situations
  specsit_feed:                  'specsit:feed:v1',

  // Bottleneck workbench / heartbeat
  heartbeat:                     (pipeline: string) => `heartbeat:v1:${pipeline}`,

  // Source-tier admin overrides
  source_tier_override:          (domain: string) => `source-tier:override:v1:${domain}`,

  // Theme revisions + ticker roles
  theme_revisions:               'theme:revisions:v1',
  ticker_role:                   (ticker: string) => `ticker-role:v1:${ticker}`,

  // Public API rate limit
  public_api_rate:               (key: string) => `rate:public:v1:${key}`,

  // Concall intel
  concall_intel_scored:          (filingId: string) => `concall:scored:v6:${filingId}`,
  concall_intel_filings_list:    'concall:filings:v3',

  // Transmission z-score cache
  transmission_zscore:           (sym: string, window: number) => `transmission-zscore:v1:${sym}:${window}`,

  // Auto-heal lockout
  graded_autoheal_lock:          (cacheKey: string) => `graded:autoheal-lock:${cacheKey}`,

  // Company intelligence
  company_intel_corpus:          (ticker: string) => `company-intel:v1:${ticker.toUpperCase()}`,
  company_intel_index:           'company-intel:index:v1',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// LOCALSTORAGE VERSION SCRUB REGISTRY — PATCH 0455 CLEANUP-4
//
// Centralized registry of stale localStorage versions to wipe on app boot.
// Add new entries here when bumping any LS schema version. The boot scrub
// runs once per session (gated by sessionStorage flag).
// ═══════════════════════════════════════════════════════════════════════════

/** Older LS prefixes that should be cleared on first app boot.
 *  Key = new SCRUB sentinel; value = array of legacy prefix strings. */
export const LS_LEGACY_PREFIXES: Record<string, string[]> = {
  'mc:scrub:graded:v9':       ['mc:graded:v7:', 'mc:graded:v8:'],
  'mc:scrub:hub:v3':          ['mc:hub:v1:', 'mc:hub:v2:'],
  'mc:scrub:earnings-scan:v1':[/* none yet */],
};

/** One-shot scrub for legacy localStorage keys. Call on app mount. */
export function scrubLegacyLS(): { scrubbed: string[]; skipped: string[] } {
  const scrubbed: string[] = [];
  const skipped: string[] = [];
  if (typeof window === 'undefined') return { scrubbed, skipped };
  for (const [sentinel, legacyPrefixes] of Object.entries(LS_LEGACY_PREFIXES)) {
    try {
      if (window.localStorage.getItem(sentinel)) {
        skipped.push(sentinel);
        continue;
      }
      let removed = 0;
      const keys = Object.keys(window.localStorage);
      for (const k of keys) {
        if (legacyPrefixes.some(prefix => k.startsWith(prefix))) {
          window.localStorage.removeItem(k);
          removed++;
        }
      }
      window.localStorage.setItem(sentinel, String(Date.now()));
      scrubbed.push(`${sentinel}(-${removed})`);
    } catch {}
  }
  return { scrubbed, skipped };
}
