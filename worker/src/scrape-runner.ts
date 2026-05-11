// ═══════════════════════════════════════════════════════════════════════════
// scrape-runner.ts — top-level loop
// ═══════════════════════════════════════════════════════════════════════════
//
// Mode 'once'  — single pass, exit
// Mode 'loop'  — runs forever, sleeps SCRAPE_INTERVAL_MIN minutes between passes
//
// Each pass:
//   1. Activate enabled source adapters (ACTIVE_SOURCES env, default all)
//   2. Fetch each in parallel with shared abort signal
//   3. Reconcile via aggregator
//   4. Validate
//   5. Push to Vercel ingest endpoint
//   6. Touch /var/lib/mc-worker/last_ok for healthcheck
//   7. Persist browser cookies
//   8. Sleep / exit

import fs from 'node:fs/promises';
import path from 'node:path';
import { nseAdapter } from './sources/nse.js';
import { trendlyneAdapter } from './sources/trendlyne.js';
import { enrichEvents, EnrichmentClient } from './sources/screener.js';
import { reconcile, validate } from './aggregator.js';
import { pushToVercel } from './ingest-client.js';
import { CanonicalEvent, RunResult, SourceAdapter } from './types.js';
import { persistAll, shutdown } from './browser-pool.js';

// ─── KV client for the enrichment cache ────────────────────────────────────
// Worker writes directly to Upstash REST API so we don't double-hop through
// Vercel for cache lookups during enrichment.  Same env vars as Vercel.
function getKvClient(): EnrichmentClient | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  return {
    async kvGet(key: string) {
      try {
        const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const j = await res.json();
        return j?.result ? JSON.parse(j.result) : null;
      } catch { return null; }
    },
    async kvSet(key: string, value: any, ttlSeconds: number) {
      try {
        const body = JSON.stringify(value);
        await fetch(`${url}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
          body,
        });
      } catch {}
    },
  };
}

const STATE_DIR = process.env.STATE_DIR || '/var/lib/mc-worker';

const ALL_ADAPTERS: Record<string, SourceAdapter> = {
  nse: nseAdapter,
  trendlyne: trendlyneAdapter,
  // bse: bseAdapter,          // TODO: similar pattern to NSE
  // tickertape: tickertapeAdapter, // TODO: public results page
  // rss: rssAdapter,          // TODO: fallback news scraper
};

async function runOnePass(): Promise<{ total: number; results: RunResult[]; pushed?: any }> {
  const activeNames = (process.env.ACTIVE_SOURCES || 'trendlyne,nse')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const lookback = +(process.env.LOOKBACK_DAYS || '70');
  const lookahead = +(process.env.LOOKAHEAD_DAYS || '14');
  const now = new Date();
  const from = new Date(now); from.setDate(now.getDate() - lookback);
  const to   = new Date(now); to.setDate(now.getDate() + lookahead);

  const results: RunResult[] = [];
  const byAdapter = new Map<string, CanonicalEvent[]>();

  for (const name of activeNames) {
    const adapter = ALL_ADAPTERS[name];
    if (!adapter) {
      console.warn(`[run] unknown source '${name}'`);
      continue;
    }
    const t0 = Date.now();
    try {
      const events = await adapter.fetch({ from, to });
      byAdapter.set(name, events);
      results.push({ source: adapter.name, ok: true, count: events.length, duration_ms: Date.now() - t0 });
      console.log(`[run] ${name}: ${events.length} events in ${Date.now() - t0}ms`);
    } catch (e: any) {
      results.push({ source: adapter.name, ok: false, count: 0, error: e.message, duration_ms: Date.now() - t0 });
      console.warn(`[run] ${name} failed:`, e.message);
    }
  }

  // Reconcile + validate
  const merged = reconcile(byAdapter);
  const clean = validate(merged);
  console.log(`[run] reconciled ${merged.length} → ${clean.length} valid`);

  // PATCH 0137 — enrich each event with Screener.in financials.
  // Per-event KV cache means we only fetch new (symbol, filing_date) tuples.
  // Budgeted to 8 minutes per pass — remaining events ship unenriched.
  const enrichEnabled = (process.env.ENRICH_FINANCIALS ?? '1') !== '0';
  let enriched: CanonicalEvent[];
  if (enrichEnabled) {
    const kv = getKvClient();
    const t0 = Date.now();
    enriched = await enrichEvents(clean, kv, { budgetMs: 8 * 60_000 });
    const withFin = enriched.filter((e) => e.sales_curr_cr != null).length;
    console.log(`[enrich] ${withFin}/${enriched.length} enriched with financials in ${Date.now() - t0}ms`);
  } else {
    enriched = clean;
  }

  // Push to Vercel
  const pushResult = await pushToVercel(enriched);
  console.log(`[run] push → status=${pushResult.status} ok=${pushResult.ok} ingested=${pushResult.ingested ?? '?'}`);

  return { total: clean.length, results, pushed: pushResult };
}

async function touchHealthOk() {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(path.join(STATE_DIR, 'last_ok'), String(Date.now()));
  } catch (e) {
    console.warn('[health] could not touch last_ok:', e);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const mode = (modeIdx >= 0 ? args[modeIdx + 1] : 'once') as 'once' | 'loop';
  console.log(`[runner] mode=${mode} active=${process.env.ACTIVE_SOURCES || 'trendlyne,nse'}`);

  process.on('SIGINT',  async () => { await shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

  if (mode === 'once') {
    const out = await runOnePass();
    await touchHealthOk();
    await persistAll();
    console.log('[runner] done:', JSON.stringify({ total: out.total, results: out.results.map((r) => ({ source: r.source, ok: r.ok, count: r.count })) }));
    await shutdown();
    return;
  }

  // Loop forever
  const intervalMin = +(process.env.SCRAPE_INTERVAL_MIN || '30');
  while (true) {
    try {
      await runOnePass();
      await touchHealthOk();
      await persistAll();
    } catch (e: any) {
      console.error('[runner] pass failed:', e?.stack || e?.message);
    }
    console.log(`[runner] sleeping ${intervalMin}min…`);
    await new Promise((r) => setTimeout(r, intervalMin * 60_000));
  }
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1); });
