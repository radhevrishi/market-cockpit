// ═══════════════════════════════════════════════════════════════════════════
// GROUPED TRADINGVIEW EXPORT — US
//
// TradingView's watchlist importer accepts a flat comma-separated list in which
// a token beginning `###` starts a named SECTION. So
//
//   ###ELITE,NASDAQ:NVDA,NASDAQ:AVGO,###BLOCKBUSTER,NYSE:KEYS,…
//
// arrives as three collapsible groups rather than one undifferentiated list of
// eighty names. This is the same grammar the India tabs use (see the
// `###ELITE / ###BLOCKBUSTER / ###STRONG` block in watchlists/page.tsx) and the
// semantics are copied exactly: groups in DESCENDING quality order, and a name
// that appears in a higher group is never repeated in a lower one.
//
// THE EXCHANGE PREFIX IS RESOLVED, NEVER GUESSED
// ──────────────────────────────────────────────
// There is no rule that maps a US ticker to its venue. Four letters is not
// Nasdaq (ADBE is, but so is Nasdaq-listed AAPL at four, while NYSE lists BALL,
// CIEN and PATH); three letters is not NYSE (SBUX vs. NKE proves nothing).
// Guessing gets a real fraction of a bench wrong, and a wrong prefix does not
// fail loudly — TradingView silently drops the symbol, so the watchlist is
// short and nothing says why.
//
// So the venue comes from the one place that actually states it: SEC's
// `company_tickers_exchange.json`, already parsed by `listings()` in
// lib/us-edgar.ts and surfaced to the browser by /api/v1/us/exchange. A name
// whose venue cannot be established still exports — as a BARE ticker, which
// TradingView accepts and resolves against its own default venue for that
// symbol. A bare ticker is a weaker instruction than a qualified one; it is not
// a wrong one, and it is the only honest thing to write when the venue is
// genuinely unknown.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SEC venue name → TradingView exchange prefix.
 *
 * TradingView carries NYSE American (the old AMEX) and NYSE Arca under the
 * prefix `AMEX`, which is why two SEC names collapse onto one prefix here. Keys
 * are matched case-insensitively so a capitalisation change in the SEC file
 * ("Nasdaq" → "NASDAQ") cannot silently start dropping prefixes.
 */
const TV_PREFIX: Record<string, string> = {
  'nyse': 'NYSE',
  'nasdaq': 'NASDAQ',
  'nyse american': 'AMEX',
  'nyse mkt': 'AMEX',
  'nyse arca': 'AMEX',
  'amex': 'AMEX',
  'cboe': 'CBOE',
  'bats': 'CBOE',
  'iex': 'IEX',
};

/** The TradingView prefix for a SEC venue name, or null when we hold no venue
 *  or hold one TradingView has no equivalent for (OTC tiers, mostly). */
export function tvExchangePrefix(exchange: string | null | undefined): string | null {
  const k = String(exchange ?? '').trim().toLowerCase();
  if (!k) return null;
  return TV_PREFIX[k] ?? null;
}

/**
 * One TradingView symbol.
 *
 * Class shares are the one place the two vocabularies differ: SEC writes
 * `BRK-B`, TradingView writes `BRK.B`. The separator is translated; nothing
 * else about the ticker is touched.
 *
 * Returns `EXCHANGE:TICKER` when the venue is known and `TICKER` when it is not
 * — both are forms TradingView imports.
 */
export function tvSymbol(ticker: string, exchange: string | null | undefined): string {
  // A bench key can be a composite `TICKER@Q3-2026` for an archived quarter;
  // the exportable symbol is the part before the @.
  const bare = String(ticker || '').toUpperCase().split('@')[0].replace(/-/g, '.').trim();
  if (!bare) return '';
  const px = tvExchangePrefix(exchange);
  return px ? `${px}:${bare}` : bare;
}

export interface TvGroup {
  /** Section name, without the `###`. Upper-cased on output. */
  label: string;
  /** Rows in this group, best first. Order inside a group is preserved. */
  rows: Array<{ ticker: string; exchange?: string | null }>;
}

export interface TvExport {
  text: string;
  /** How many symbols were written, after de-duplication. */
  count: number;
  /** Symbols written WITHOUT a venue prefix, because none could be resolved.
   *  Surfaced so the UI can say so rather than pretending the export is fully
   *  qualified. */
  unresolved: string[];
  groups: Array<{ label: string; count: number }>;
}

/**
 * Build the grouped export string.
 *
 * De-duplication is by BARE TICKER across the whole export and runs top-down,
 * so a name that is ELITE is written once, in ELITE, and skipped in
 * BLOCKBUSTER and STRONG below it. An empty group is omitted entirely rather
 * than emitted as a header with nothing under it.
 */
export function buildTvExport(groups: TvGroup[]): TvExport {
  const seen = new Set<string>();
  const parts: string[] = [];
  const unresolved: string[] = [];
  const summary: Array<{ label: string; count: number }> = [];
  let count = 0;

  for (const g of groups) {
    const syms: string[] = [];
    for (const row of g.rows) {
      const bare = String(row.ticker || '').toUpperCase().split('@')[0].trim();
      if (!bare || seen.has(bare)) continue;
      const sym = tvSymbol(bare, row.exchange ?? null);
      if (!sym) continue;
      seen.add(bare);
      syms.push(sym);
      if (!sym.includes(':')) unresolved.push(sym);
    }
    if (!syms.length) continue;
    parts.push(`###${g.label.toUpperCase()}`, ...syms);
    summary.push({ label: g.label.toUpperCase(), count: syms.length });
    count += syms.length;
  }
  return { text: parts.join(','), count, unresolved, groups: summary };
}
