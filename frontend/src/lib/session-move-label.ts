// zzz1081 (retest B07) — say WHICH session a price move belongs to: "today" only when the exchange traded today and the quote is
// from today; otherwise "last session · 16 Oct". On Sunday 18 Oct 2026 the home Momentum lane said "+20.0% today" for Friday's
// move. The quote's own time (quoteTime) decides when it is known; without it, the exchange calendar's last session does —
// never the time the page fetched the price.
import { marketDate, isTradingDay, regularStarted, lastCompletedSession, type Market } from './exchange-calendar';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MON[Number(ymd.slice(5, 7)) - 1]}`;

export interface SessionLabel { today: boolean; word: string; session: string; title: string }

/** "today" or "last session · 16 Oct", with the session date and a hover line. */
export function moveSessionLabel(market: Market, now: Date, quoteTime?: string | number | null): SessionLabel {
  const today = marketDate(market, now);
  const qt = quoteTime == null || quoteTime === '' ? NaN : typeof quoteTime === 'number' ? quoteTime : Date.parse(quoteTime);
  let session: string;
  let fromQuote = false;
  if (Number.isFinite(qt)) { session = marketDate(market, new Date(qt)); fromQuote = true; }
  else session = isTradingDay(market, today) && regularStarted(market, now) ? today : lastCompletedSession(market, now);
  const isToday = session === today && isTradingDay(market, today);
  const exch = market === 'IN' ? 'NSE' : 'US market';
  return {
    today: isToday,
    session,
    word: isToday ? 'today' : `last session · ${shortDay(session)}`,
    title: isToday
      ? `Today's ${exch} session (${shortDay(session)}).`
      : `The ${exch} is closed now; this is the move of the last session, ${shortDay(session)}${fromQuote ? ' (the time on the quote)' : ' (no time on the quote — the last trading day on the exchange calendar)'}.`,
  };
}
