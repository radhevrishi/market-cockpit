#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0738 — Indian financial news scraper for GitHub Actions.
//
// Runs on GitHub Actions free CPU (unlimited for public repos / 2000 min/mo
// private). Pulls RSS feeds from ET Markets, Mint, Moneycontrol, Business
// Standard, and Trendlyne, parses entries, and writes a single consolidated
// blob to Upstash Redis. Vercel reads the blob — zero Vercel CPU spent on
// the actual ingestion.
//
// Pure Node 20 — uses built-in fetch + hand-rolled XML parsing. No npm
// install. No dependencies. Runs cold-to-finish in ~5-15s.
//
// Required env vars (GH Actions secrets):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// KV write strategy: one blob (`scraped-india-news:v1:latest`) containing
// the last ~250 normalized entries across all sources. TTL 24h. Costs
// 1 KV write per run × 4 runs/day = 4 writes/day (well under 10K/day cap).
// ═══════════════════════════════════════════════════════════════════════════

// ─── Configuration ──────────────────────────────────────────────────────────

const FEEDS = [
  { name: 'ET Markets',         url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name: 'ET Companies',       url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms' },
  { name: 'Mint Markets',       url: 'https://www.livemint.com/rss/markets' },
  { name: 'Mint Companies',     url: 'https://www.livemint.com/rss/companies' },
  { name: 'Moneycontrol Top',   url: 'https://www.moneycontrol.com/rss/MCtopnews.xml' },
  { name: 'Moneycontrol Mkts',  url: 'https://www.moneycontrol.com/rss/marketreports.xml' },
  { name: 'Moneycontrol Earn',  url: 'https://www.moneycontrol.com/rss/results.xml' },
  { name: 'BizStd Markets',     url: 'https://www.business-standard.com/rss/markets-106.rss' },
  { name: 'BizStd Companies',   url: 'https://www.business-standard.com/rss/companies-101.rss' },
  { name: 'NDTV Profit',        url: 'https://feeds.feedburner.com/ndtvprofit-latest' },
];

const MAX_ENTRIES_PER_FEED = 50;
const MAX_TOTAL_ENTRIES    = 300;
const FETCH_TIMEOUT_MS     = 15_000;
const KV_KEY               = 'scraped-india-news:v1:latest';
const KV_TTL_SECONDS       = 24 * 60 * 60; // 24h — next run will overwrite

// ─── Env validation ────────────────────────────────────────────────────────

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN as repo secrets.');
  process.exit(1);
}

// ─── XML helpers (no library) ──────────────────────────────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripHtml(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function pickTag(block, tag) {
  const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(r);
  if (!m) return '';
  let v = m[1];
  v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1');
  return stripHtml(v);
}

function parseRss(xml, sourceName) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < MAX_ENTRIES_PER_FEED) {
    const block = m[1];
    const title = pickTag(block, 'title');
    const link  = pickTag(block, 'link');
    const pub   = pickTag(block, 'pubDate');
    const desc  = pickTag(block, 'description').slice(0, 400);
    if (!title || !link) continue;
    let isoDt;
    try {
      const d = new Date(pub);
      isoDt = Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
    } catch { isoDt = new Date().toISOString(); }
    items.push({
      title,
      url: link,
      source: sourceName,
      publishedAt: isoDt,
      snippet: desc,
    });
  }
  return items;
}

// ─── Fetch with timeout ────────────────────────────────────────────────────

async function fetchFeed(feed) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit-Scraper/0.1; +https://market-cockpit.vercel.app)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) {
      console.log(`::warning title=${feed.name}::HTTP ${res.status} — skipping`);
      return [];
    }
    const xml = await res.text();
    const items = parseRss(xml, feed.name);
    console.log(`  ${feed.name.padEnd(22)} → ${items.length} entries`);
    return items;
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `timeout (${FETCH_TIMEOUT_MS}ms)` : (e?.message || String(e));
    console.log(`::warning title=${feed.name}::${msg}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Upstash KV writer ─────────────────────────────────────────────────────

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upstash SET failed: HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
  const j = await res.json().catch(() => ({}));
  if (j?.result !== 'OK' && j?.result !== 1) {
    throw new Error(`Upstash SET returned unexpected: ${JSON.stringify(j).slice(0, 200)}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-india-news at ${new Date().toISOString()}`);
  console.log(`  fetching ${FEEDS.length} feeds...`);

  // Parallel fetch with limited concurrency to be polite to upstream.
  const CONC = 5;
  const allEntries = [];
  for (let i = 0; i < FEEDS.length; i += CONC) {
    const batch = FEEDS.slice(i, i + CONC);
    const results = await Promise.all(batch.map(fetchFeed));
    for (const items of results) allEntries.push(...items);
  }

  // Dedupe by URL (and fall back to title if URL is missing).
  const seen = new Set();
  const deduped = [];
  for (const e of allEntries) {
    const key = (e.url || e.title || '').slice(0, 200);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  // Sort newest first, cap at MAX_TOTAL_ENTRIES.
  deduped.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const finalEntries = deduped.slice(0, MAX_TOTAL_ENTRIES);

  const elapsed = Date.now() - startedAt;
  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    feedCount: FEEDS.length,
    rawCount: allEntries.length,
    dedupedCount: finalEntries.length,
    entries: finalEntries,
  };

  console.log(`  raw=${allEntries.length} deduped=${deduped.length} final=${finalEntries.length}`);
  console.log(`  payload size: ${Math.round(JSON.stringify(payload).length / 1024)} KB`);

  // Safety check — Upstash REST has a 1 MiB body limit. We trim defensively.
  let payloadSize = JSON.stringify(payload).length;
  while (payloadSize > 800_000 && payload.entries.length > 20) {
    payload.entries = payload.entries.slice(0, Math.floor(payload.entries.length * 0.8));
    payloadSize = JSON.stringify(payload).length;
  }

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} (${finalEntries.length} entries, ${Math.round(payloadSize / 1024)} KB) in ${elapsed}ms`);
  console.log(`::notice title=Scrape complete::${finalEntries.length} Indian news entries cached for 24h.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
