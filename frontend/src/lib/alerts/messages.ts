// zzz1054 / zzz1063 — the text of a Telegram / email message for fired alerts (pure; engine.ts re-exports it).
import type { AlertEvent } from './types';

/** One Telegram / email message for a group of events (≤ 30 lines). */
export function externalMessage(events: ReadonlyArray<Pick<AlertEvent, 'ticker' | 'condition' | 'message' | 'price' | 'market' | 'list'>>): { subject: string; text: string } | null {
  if (!events.length) return null;
  const lines = events.slice(0, 30).map((e) => `• ${e.message}${e.price != null ? ` — ${e.market === 'IN' ? '₹' : '$'}${e.price.toFixed(2)}` : ''}${e.list ? ` (${e.list})` : ''}`);
  if (events.length > 30) lines.push(`… and ${events.length - 30} more — open Price alerts in Market Cockpit`);
  return { subject: `🔔 ${events.length === 1 ? `${events[0].ticker}: ${events[0].condition}` : `${events.length} price alerts fired`}`, text: lines.join('\n') };
}
