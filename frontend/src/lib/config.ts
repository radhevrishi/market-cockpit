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

/**
 * Shared secret for watchlist / portfolio write operations.
 *
 * SECURITY NOTE: This used to fall back to a hardcoded string
 * ("mc-bot-2026") AND be exposed via NEXT_PUBLIC_BOT_SECRET, meaning
 * the secret was visible in the browser bundle and anyone could call
 * the write endpoints. As of security patch 15:
 *  - Empty string is the default — server endpoints reject any request
 *    without a matching MC_BOT_SECRET env var on the server.
 *  - Web client write paths (portfolio editor, watchlist mutations)
 *    will return 401 unless you implement real per-user auth.
 *  - The Telegram bot continues to work because it sends the secret
 *    server-to-server with the value of MC_BOT_SECRET set on Vercel.
 */
export const BOT_SECRET = process.env.NEXT_PUBLIC_BOT_SECRET ?? '';
