// zzz1065 — Daily Signal Inbox: four lanes laid out as 1, 2 or 4 columns by the inbox's own width (never 3 + 1, which
// `repeat(auto-fit, minmax(230px, 1fr))` gave on a laptop). The CSS lives in globals.css (`.mc-inbox-lanes`, container
// queries on `.mc-inbox-wrap`); these numbers are the same breakpoints and a test checks that the two agree.
export const INBOX_TWO_COLUMNS_FROM = 520;   // px of inbox width: two lanes of ≥ 255 px
export const INBOX_FOUR_COLUMNS_FROM = 980;  // px of inbox width: four lanes of ≥ 237 px

export function inboxLaneColumns(inboxWidthPx: number): 1 | 2 | 4 {
  if (!(inboxWidthPx >= INBOX_TWO_COLUMNS_FROM)) return 1;
  if (inboxWidthPx < INBOX_FOUR_COLUMNS_FROM) return 2;
  return 4;
}
