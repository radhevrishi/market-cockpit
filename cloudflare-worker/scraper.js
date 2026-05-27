/**
 * Market Cockpit — NSE/BSE Scheduled Scraper Worker (KV-backed)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * RUNS:
 *   • Every 5 min during IST market hours (UTC 03:45-10:00)
 *   • Hourly off-hours
 *   • All fetches use Cloudflare's stable egress IP — no NSE/BSE blocks
 *   • One persistent cookie session per scrape run (no bot-like pattern)
 *
 * STORAGE (Cloudflare KV binding `MC_KV`):
 *   filings:latest         → JSON array of last 200 fresh filings (24h TTL)
 *   filings:day:YYYY-MM-DD → JSON array of that day's filings (7d TTL)
 *   filings:meta           → { last_run, count, duration, errors } (no TTL)
 *
 * WRITE BUDGET:
 *   ~5 writes per cron run × ~75 cron runs/day = ~375 writes/day max.
 *   CF KV free tier = 1000 writes/day. Safe 2.6× headroom.
 *
 * READ ENDPOINTS (Vercel calls these):
 *   GET /api/filings/latest        — all fresh filings (no auth)
 *   GET /api/filings/day/:date     — specific day (no auth)
 *   GET /health                    — meta status (no auth)
 *   GET /api/scrape/run?secret=X   — manual trigger (auth req)
 *
 * The /api/filings/* endpoints are PUBLIC because they're read-only,
 * idempotent, and don't expose anything sensitive. Vercel hits them
 * with no shared secret needed.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

const NSE_BASE = 'https://www.nseindia.com';
const NSE_CORP_ANNOUNCEMENTS = '/api/corporate-announcements';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
};

// ─── NSE session bootstrap ─────────────────────────────────────────────────
async function bootstrapNSESession() {
  const res = await fetch(NSE_BASE, {
    headers: { ...BROWSER_HEADERS, 'Accept': 'text/html,application/xhtml+xml' },
    cf: { cacheTtl: 0 },
  });
  const setCookies = res.headers.get('set-cookie') || '';
  const cookies = setCookies
    .split(/,\s*(?=[A-Za-z0-9_-]+=)/g)
    .map(c => c.split(';')[0].trim())
    .filter(Boolean);
  return cookies.join('; ');
}

// ─── NSE corp filings fetch ────────────────────────────────────────────────
async function fetchNSEFilings(cookie) {
  const url = `${NSE_BASE}${NSE_CORP_ANNOUNCEMENTS}?index=equities`;
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, 'Cookie': cookie },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`NSE non-JSON (likely blocked): ${text.slice(0, 80)}`); }
  if (!Array.isArray(data)) throw new Error('NSE response not array');
  return data;
}

// PATCH 0935 — Financial Results scrape.
// The default fetchNSEFilings (?index=equities) returns last-24h general
// announcements only — mostly press releases / investor meets / insolvency
// notices. Earnings Hub + Signals need the dedicated Financial Results
// sub-category, which is a SEPARATE NSE endpoint call with explicit date range.
// Without it, both pages show zero on quiet announcement days (today's bug).
async function fetchNSEResults(cookie) {
  // Two-day window: yesterday + today (captures pre-market filings + intraday)
  const fmt = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${day}-${m}-${y}`;
  };
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);  // last 7 days
  const url = `${NSE_BASE}${NSE_CORP_ANNOUNCEMENTS}?index=equities&from_date=${fmt(from)}&to_date=${fmt(now)}&sub_category=Financial%20Results`;
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, 'Cookie': cookie },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`NSE results HTTP ${res.status}`);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`NSE results non-JSON: ${text.slice(0, 80)}`); }
  if (!Array.isArray(data)) throw new Error('NSE results not array');
  return data;
}

// ─── Filing normalizer ─────────────────────────────────────────────────────
function normalizeFiling(raw) {
  return {
    symbol: raw.symbol || raw.SYMBOL || '',
    company: raw.sm_name || raw.smName || raw.company || '',
    subject: raw.desc || raw.subject || raw.attchmntDescription || '',
    category: raw.subject || raw.bdetails || '',
    filing_date: raw.attchmntDate || raw.an_dt || raw.exchdisstime || '',
    attachment_url: raw.attchmntFile || raw.attachmentUrl || '',
    raw,
  };
}

// ─── Main scrape ──────────────────────────────────────────────────────────
async function runScrape(env) {
  const startedAt = Date.now();
  const meta = {
    last_run: new Date().toISOString(),
    duration_ms: 0,
    count: 0,
    errors: [],
    source: 'cf-worker-scraper',
  };

  let cookie = '';
  try {
    cookie = await bootstrapNSESession();
    if (!cookie) meta.errors.push('NSE returned no cookies');
  } catch (e) {
    meta.errors.push(`bootstrap: ${e.message}`);
  }

  let filings = [];
  try {
    const raw = await fetchNSEFilings(cookie);
    filings = raw.map(normalizeFiling).filter(f => f.symbol && f.filing_date);
    meta.count = filings.length;
  } catch (e) {
    meta.errors.push(`fetch: ${e.message}`);
  }

  // PATCH 0935 — also fetch Financial Results (powers Earnings Hub + most Signals).
  let results = [];
  try {
    const rawResults = await fetchNSEResults(cookie);
    results = rawResults.map(normalizeFiling).filter(f => f.symbol && f.filing_date);
    meta.results_count = results.length;
  } catch (e) {
    meta.errors.push(`results: ${e.message}`);
    meta.results_count = 0;
  }

  meta.duration_ms = Date.now() - startedAt;

  // Write general filings to KV — same as before.
  if (filings.length > 0 && env.MC_KV) {
    const byDate = new Map();
    for (const f of filings) {
      const day = f.filing_date.slice(0, 10);
      if (!byDate.has(day)) byDate.set(day, []);
      byDate.get(day).push(f);
    }
    for (const [day, dayFilings] of byDate.entries()) {
      await env.MC_KV.put(
        `filings:day:${day}`,
        JSON.stringify(dayFilings),
        { expirationTtl: 7 * 24 * 3600 }
      );
    }
    await env.MC_KV.put(
      'filings:latest',
      JSON.stringify(filings.slice(0, 200)),
      { expirationTtl: 24 * 3600 }
    );
  }
  // PATCH 0935 — separate KV keys for results so Earnings Hub can read them
  // directly without churning through the general announcements list.
  if (results.length > 0 && env.MC_KV) {
    const byDate = new Map();
    for (const f of results) {
      const day = f.filing_date.slice(0, 10);
      if (!byDate.has(day)) byDate.set(day, []);
      byDate.get(day).push(f);
    }
    for (const [day, dayResults] of byDate.entries()) {
      await env.MC_KV.put(
        `results:day:${day}`,
        JSON.stringify(dayResults),
        { expirationTtl: 7 * 24 * 3600 }
      );
    }
    // 'latest' is the whole 7-day window — Vercel reads this once per refresh.
    await env.MC_KV.put(
      'results:latest',
      JSON.stringify(results),
      { expirationTtl: 24 * 3600 }
    );
  }
  // Always write meta (single small key) — debug + status read by /health
  if (env.MC_KV) {
    await env.MC_KV.put('filings:meta', JSON.stringify(meta));
  }

  console.log(`[scraper] ${meta.last_run}: ${meta.count} announcements, ${meta.results_count || 0} results, errors=${meta.errors.length}, ${meta.duration_ms}ms`);
  return meta;
}

// ─── Worker handlers ──────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScrape(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Health + meta
    if (path === '/' || path === '/health') {
      let meta = null;
      if (env.MC_KV) {
        const raw = await env.MC_KV.get('filings:meta');
        if (raw) { try { meta = JSON.parse(raw); } catch {} }
      }
      return jsonResponse({
        ok: true,
        service: 'mc-scraper',
        kv_available: !!env.MC_KV,
        last_meta: meta,
      });
    }

    // Latest filings (Vercel reads from here on every Signals page load)
    if (path === '/api/filings/latest') {
      if (!env.MC_KV) return jsonResponse({ error: 'KV unavailable' }, 503);
      const raw = await env.MC_KV.get('filings:latest');
      const filings = raw ? JSON.parse(raw) : [];
      return jsonResponse({
        generated_at: new Date().toISOString(),
        count: filings.length,
        filings,
        cached: true,
      });
    }

    // PATCH 0935 — Financial Results endpoints (powers Earnings Hub).
    if (path === '/api/results/latest') {
      if (!env.MC_KV) return jsonResponse({ error: 'KV unavailable' }, 503);
      const raw = await env.MC_KV.get('results:latest');
      const results = raw ? JSON.parse(raw) : [];
      return jsonResponse({
        generated_at: new Date().toISOString(),
        count: results.length,
        results,
        cached: true,
      });
    }
    if (path.startsWith('/api/results/day/')) {
      const date = path.split('/').pop() || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return jsonResponse({ error: 'invalid date — expect YYYY-MM-DD' }, 400);
      }
      if (!env.MC_KV) return jsonResponse({ error: 'KV unavailable' }, 503);
      const raw = await env.MC_KV.get(`results:day:${date}`);
      const results = raw ? JSON.parse(raw) : [];
      return jsonResponse({ date, count: results.length, results, cached: true });
    }

    // Day-specific filings (used by EO page when picking a date)
    if (path.startsWith('/api/filings/day/')) {
      const date = path.split('/').pop() || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return jsonResponse({ error: 'invalid date — expect YYYY-MM-DD' }, 400);
      }
      if (!env.MC_KV) return jsonResponse({ error: 'KV unavailable' }, 503);
      const raw = await env.MC_KV.get(`filings:day:${date}`);
      const filings = raw ? JSON.parse(raw) : [];
      return jsonResponse({
        date,
        count: filings.length,
        filings,
        cached: true,
      });
    }

    // Manual scrape trigger — auth required
    if (path === '/api/scrape/run' || path === '/run') {
      const providedSecret = url.searchParams.get('secret') || '';
      if (!env.PROXY_SECRET || providedSecret !== env.PROXY_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      const meta = await runScrape(env);
      return jsonResponse(meta);
    }

    return jsonResponse({ error: 'Not found', path }, 404);
  },
};
