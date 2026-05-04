/**
 * Centralised app config — single source of truth for values that
 * appear in multiple files. Set via env vars for per-deployment override.
 *
 * NEXT_PUBLIC_* values are bundled into client JS (visible in browser).
 * Real auth should replace these for multi-user deployments.
 */

/** Telegram chat ID for portfolio / watchlist / alerts */
export const CHAT_ID =
  process.env.NEXT_PUBLIC_CHAT_ID ?? '5057319640';

/** Shared secret for watchlist write operations */
export const BOT_SECRET =
  process.env.NEXT_PUBLIC_BOT_SECRET ?? 'mc-bot-2026';
