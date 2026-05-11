// ─── Persistent browser pool with cookie jar ───────────────────────────────
// One persistent Chromium context per "origin" we need cookies for.
// State serialised to disk so cookies survive container restarts.

import { chromium, BrowserContext, Browser } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const STATE_DIR = process.env.STATE_DIR || '/var/lib/mc-worker';

let _browser: Browser | null = null;
const _contexts = new Map<string, BrowserContext>();

async function ensureStateDir() {
  await fs.mkdir(STATE_DIR, { recursive: true });
}

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });
  return _browser;
}

/**
 * Get (or create) a persistent context for a given origin key.
 * Cookies are loaded from disk on first request, saved on every close.
 */
export async function getContext(originKey: string): Promise<BrowserContext> {
  await ensureStateDir();
  if (_contexts.has(originKey)) return _contexts.get(originKey)!;

  const browser = await getBrowser();
  const stateFile = path.join(STATE_DIR, `${originKey}-state.json`);

  let storageState: any = undefined;
  try {
    const raw = await fs.readFile(stateFile, 'utf-8');
    storageState = JSON.parse(raw);
  } catch { /* no prior state */ }

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    storageState,
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9',
    },
  });

  // Periodically persist cookies
  ctx.on('close', async () => {
    try {
      const state = await ctx.storageState();
      await fs.writeFile(stateFile, JSON.stringify(state));
    } catch (e) {
      console.warn(`[browser-pool] failed to persist state for ${originKey}:`, e);
    }
  });

  _contexts.set(originKey, ctx);
  return ctx;
}

/**
 * Persist all open contexts now (call from health-check loop or before shutdown).
 */
export async function persistAll() {
  for (const [key, ctx] of _contexts) {
    try {
      const state = await ctx.storageState();
      await fs.writeFile(path.join(STATE_DIR, `${key}-state.json`), JSON.stringify(state));
    } catch (e) {
      console.warn(`[browser-pool] persist failed for ${key}:`, e);
    }
  }
}

export async function shutdown() {
  await persistAll();
  for (const ctx of _contexts.values()) await ctx.close().catch(() => {});
  _contexts.clear();
  if (_browser) await _browser.close().catch(() => {});
  _browser = null;
}
