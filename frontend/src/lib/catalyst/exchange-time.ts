// zzz834: dates are EXCHANGE dates. A US filing dated 24 Sep is the 24th in New York whatever the browser's
// timezone (IST/UTC/Europe); "today" and the "as of" stamp use the market's own clock, never the browser's.
export const MARKET_TZ = { US: 'America/New_York', IN: 'Asia/Kolkata' } as const;
export type Mkt = keyof typeof MARKET_TZ;

/** The market's calendar day, YYYY-MM-DD. */
export function exchangeToday(market: Mkt, now: Date = new Date()): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: MARKET_TZ[market], year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  } catch { /* fall through */ }
  return now.toISOString().slice(0, 10);
}
/** "14:32 ET" / "20:02 IST" — when the data on screen was loaded, on the market's clock. */
export function exchangeClock(market: Mkt, now: Date = new Date()): string {
  try {
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: MARKET_TZ[market], hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    return `${t} ${market === 'US' ? 'ET' : 'IST'}`;
  } catch { return now.toISOString().slice(11, 16) + ' UTC'; }
}
export const CURRENCY: Record<Mkt, { symbol: string; code: string; note: string }> = {
  US: { symbol: '$', code: 'USD', note: 'SEC filings · dates in New York time' },
  IN: { symbol: '₹', code: 'INR', note: 'NSE / BSE filings · dates in India time' },
};

/** An .ics file (all-day events on the filing date) — the shown events, for a calendar. */
export function buildIcs(events: Array<{ date: string; ticker: string; summary: string; url?: string | null }>, now: Date = new Date()): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Market Cockpit//Portfolio Catalysts//EN', 'CALSCALE:GREGORIAN'];
  events.forEach((e, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return;
    lines.push('BEGIN:VEVENT', `UID:mc-${e.ticker}-${e.date}-${i}@market-cockpit`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next(e.date)}`,
      `SUMMARY:${esc(`${e.ticker} — ${e.summary}`)}`, ...(e.url ? [`URL:${e.url}`] : []), 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
