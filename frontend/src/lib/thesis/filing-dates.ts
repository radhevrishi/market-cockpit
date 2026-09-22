// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGE FILING DATES AND SYMBOLS — read the way the sources write them.
//                                                                    (zzz765)
//
// WHY CUPID NEVER SAW ITS OWN FILINGS. The CF worker's results feed writes
// `filing_date` as "22-Sep-2026 18:47:27". Every consumer tested it against
// /^\d{4}-\d{2}-\d{2}/ and got null, so:
//
//   · evidence discovery kept exchange candidates UNDATED — they ranked last,
//     never set `newest_seen`, and could never make a card say "update
//     available";
//   · the recent-reporters pass dropped EVERY feed row as dateless, so no
//     holding was ever "reported in the last 10 days".
//
// And IFBAGRO sits in the book as IFBAGRO-BE (trade-for-trade series) while
// the exchange feed and BSE key it as IFBAGRO, so an exact-match symbol
// filter found nothing for it at any exchange source.
//
// Pure, no imports: the recent-reporters module is shared with the client.
// ═══════════════════════════════════════════════════════════════════════════

const MON: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) =>
  y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/**
 * A filing date in any of the shapes the exchange sources emit, as
 * YYYY-MM-DD. Falls back to the NSE archive filename stamp
 * (`CUPID_22092026184721_…pdf` → 2026-09-22). Null when nothing parses.
 */
export function feedDateIso(raw: string | null | undefined, url?: string | null): string | null {
  const s = String(raw || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/,]+(\d{4})/.exec(s);
  if (m) {
    const mo = MON[m[2].toLowerCase()];
    if (mo && valid(+m[3], mo, +m[1])) return `${m[3]}-${pad(mo)}-${pad(+m[1])}`;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m && valid(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  const u = String(url || '');
  m = /_(\d{2})(\d{2})(\d{4})\d{6}_/.exec(u);
  if (m && valid(+m[3], +m[2], +m[1])) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** NSE series suffixes (-BE, -SM, -BZ, -ST …) removed. The exchange feed, BSE
 *  and screener.in all key a company by its bare symbol. */
export function bareSymbol(ticker: string | null | undefined): string {
  return String(ticker || '').toUpperCase().trim().replace(/-(BE|BZ|SM|ST|BL|IL|GS|SZ|E1|N[0-9A-Z])$/, '');
}
