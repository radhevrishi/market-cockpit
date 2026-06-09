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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
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

  if (!payload.entries || payload.entries.length < 20) {
    console.error(`Refusing to overwrite KV: only ${payload.entries ? payload.entries.length : 0} entries scraped — keeping previous blob.`);
    process.exit(1);
  }

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} (${finalEntries.length} entries, ${Math.round(payloadSize / 1024)} KB) in ${elapsed}ms`);

  // ─── PATCH 0798: per-ticker news index ────────────────────────────────────
  // Build a per-ticker lookup so the attribution engine can ask "any news
  // about RPOWER in last 72h?" with a single KV GET instead of full blob scan.
  // We extract candidate NSE tickers from each headline using a simple
  // uppercase-token heuristic plus an allowlist of common NSE symbols.
  const tickerRegex = /\b([A-Z][A-Z0-9&-]{2,14})\b/g;
  // Common false-positive words that look like tickers but aren't
  const STOP_TOKENS = new Set([
    'IPO','RBI','SEBI','GST','FY','FY26','FY25','FY24','Q1','Q2','Q3','Q4','PSU','NSE','BSE','MCX',
    'CEO','CFO','CTO','COO','MD','BSE','NSE','SEBI','TRAI','NCLT','EBITDA','PAT','YOY','QOQ','TTM',
    'INR','USD','EUR','PE','PB','ROE','ROCE','CAGR','GDP','CPI','WPI','RBI','FII','DII','MF','ETF',
    'AI','EV','5G','API','URL','HTTP','PDF','CSV','XML','JSON','HTML','CSS','JS','PR','IN','THE',
    'TO','OF','AT','BY','ON','IS','AS','AND','FOR','WITH','FROM','THIS','THAT','ITS','BE','HAS',
    'WAS','WILL','RS','CR','LTD','LIMITED','COMPANY','CORP','INDIA','BANK','NEW','BIG','HIGH','LOW',
    'UP','DOWN','TOP','HOT','BUY','SELL','HOLD','MAY','JAN','FEB','MAR','APR','JUN','JUL','AUG',
    'SEP','OCT','NOV','DEC',
  ]);
  const perTickerIndex = new Map(); // ticker -> [{title, url, source, publishedAt}]
  for (const e of finalEntries) {
    const text = `${e.title || ''} ${e.snippet || ''}`;
    const seen = new Set();
    let m;
    while ((m = tickerRegex.exec(text)) !== null) {
      const tk = m[1].toUpperCase();
      if (tk.length < 3 || tk.length > 14) continue;
      if (STOP_TOKENS.has(tk)) continue;
      if (!/[A-Z]/.test(tk)) continue; // must contain at least one letter
      if (seen.has(tk)) continue;
      seen.add(tk);
      if (!perTickerIndex.has(tk)) perTickerIndex.set(tk, []);
      perTickerIndex.get(tk).push({
        title: e.title,
        url: e.url,
        source: e.source,
        publishedAt: e.publishedAt,
      });
    }
  }

  // Write per-ticker keys ONLY when we have ≥2 mentions (filters out junk
  // false-positives from common words slipping past STOP_TOKENS).
  let writtenTickers = 0;
  for (const [ticker, entries] of perTickerIndex) {
    if (entries.length < 2) continue;
    // Cap to 20 entries per ticker, newest first
    entries.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    const capped = entries.slice(0, 20);
    const tickerKey = `news-by-ticker:v1:${ticker}`;
    try {
      await kvSet(tickerKey, { ticker, generatedAt: new Date().toISOString(), entries: capped }, 24 * 60 * 60);
      writtenTickers++;
    } catch (err) {
      // Single ticker failure shouldn't crash the whole script
      console.log(`::warning title=${ticker}::KV write failed: ${err?.message || err}`);
    }
  }
  console.log(`✓ wrote per-ticker news indexes: ${writtenTickers} keys`);
  console.log(`::notice title=Scrape complete::${finalEntries.length} Indian news entries cached for 24h, ${writtenTickers} per-ticker indexes.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
