#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0801 — Multi-source news deep-scan for extreme NSE movers.
//
// For each stock that moved ≥10% in the latest session, pull news from 4
// free public sources to find the actual catalyst. Stored per-ticker in KV
// so Vercel can surface the real headline as the "primary driver" instead
// of generic "No confirmed trigger".
//
// Sources (no auth, no paid API):
//   1. Google News RSS    — news.google.com/rss/search?q=<ticker>+stock
//   2. Moneycontrol       — per-ticker company news page (HTML scrape)
//   3. Trendlyne          — per-ticker news + events (HTML scrape)
//   4. Yahoo Finance      — finance.yahoo.com/quote/<T>.NS/news
//
// Per-ticker KV write: 'mover-reasons:v1:<TICKER>' (24h TTL)
//   {
//     ticker, generatedAt,
//     topReason: { headline, source, url, publishedAt, narrative },
//     allReasons: [ ... up to 10 ranked headlines ... ]
//   }
//
// Selection: ranking by source reliability + recency.
//   Source priority: Moneycontrol > Trendlyne > Reuters/Bloomberg > Yahoo > Google
//   Recency: prefers <48h old.
//
// GH Actions free tier: workflow can run hourly for unlimited public repos.
// Polite throttling: 1 sec between each ticker's 4-source fetch batch.
// ═══════════════════════════════════════════════════════════════════════════

const FETCH_TIMEOUT_MS = 10_000;
const TICKER_THROTTLE_MS = 600;
const MAX_TICKERS_PER_RUN = 80;       // includes EXTREME (≥10%) + STANDARD (≥5%)
const MOVER_PCT_THRESHOLD = 5;        // P0802: lowered from 10 to catch JSWCEMENT-class moves
const KV_TTL_SECONDS = 24 * 60 * 60;

// Headline blacklist — Moneycontrol/Trendlyne nav widgets that match the regex
const HEADLINE_BLACKLIST = [
  /^business videos?$/i,
  /^latest news$/i,
  /^more news$/i,
  /^watch\b/i,
  /^live tv$/i,
  /^subscribe\b/i,
  /^follow us$/i,
  /^top stories$/i,
  /^market dashboard$/i,
  /^market overview$/i,
  /^markets$/i,
  /^news$/i,
  /^stocks?$/i,
  /^companies$/i,
  /^videos?$/i,
  /^podcasts?$/i,
  /^webinars?$/i,
  /^download our app$/i,
  // P0804: TradingView / Walletinvestor / algorithmic price-forecast pages —
  // not real news, just SEO-spam pages with auto-generated predictions
  /\bforecast\s*[—\-]\s*price\s+target\b/i,
  /\bprediction\s+for\s+\d{4}\b/i,
  /-\s*TradingView$/i,
  /^\s*\w+\s+(stock\s+)?prediction\s+\d{4}/i,
  /^\s*\w+\s+stock\s+forecast\b/i,
  /\bwalletinvestor\b/i,
];

function looksLikeRealHeadline(title) {
  if (!title) return false;
  if (title.length < 25) return false;
  for (const re of HEADLINE_BLACKLIST) if (re.test(title)) return false;
  // Real headlines have at least one verb-like or number-like marker
  if (!/[a-z]{4,}/i.test(title)) return false;
  return true;
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
};

const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}

// ─── KV helpers ─────────────────────────────────────────────────────────

async function kvGet(key) {
  const url = `${KV_URL.replace(/\/+$/, '')}/get/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${KV_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    if (!j || j.result === null || j.result === undefined) return null;
    return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
  } catch { return null; }
}

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upstash SET failed: HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
}

// ─── HTML/XML helpers ───────────────────────────────────────────────────

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

function pickXmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  let v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1');
  return stripHtml(v);
}

async function fetchUrl(url, label) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 200 ? text : null;
  } catch (e) {
    return null;
  }
}

// ─── Source 1: Google News RSS ──────────────────────────────────────────

// P0804: cross-ticker leak guard. Google News RSS regularly returns
// results that don't mention our ticker (e.g. OCCLLTD query returned
// a Ramco Systems Group-B gainers article). Headline must mention the
// ticker OR a meaningful chunk of the company name to qualify.
function headlineMentionsCompany(title, ticker, companyName) {
  if (!title) return false;
  const t = title.toLowerCase();
  // Ticker symbol present anywhere
  if (ticker && t.includes(ticker.toLowerCase())) return true;
  if (!companyName) return false;
  // Try the first 2-3 distinctive words of the company name.
  // Strip stop-words like "Ltd", "Limited", "India", "Industries" — they
  // appear in dozens of unrelated companies and would let everything through.
  const STOP = new Set([
    'ltd', 'limited', 'india', 'industries', 'industry', 'corporation',
    'corp', 'company', 'co', 'group', 'enterprises', 'enterprise',
    'holdings', 'holding', 'international', 'systems', 'technologies',
    'tech', 'solutions', 'services', 'and', 'the', 'of', 'for', 'inc',
  ]);
  const tokens = companyName
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  if (tokens.length === 0) return false;
  // Need at least one distinctive company-name token in the headline
  for (const tok of tokens.slice(0, 4)) {
    if (t.includes(tok)) return true;
  }
  return false;
}

async function fetchGoogleNews(ticker, companyName) {
  // Build query: ticker + company name + India context for better matches
  const qParts = [ticker];
  if (companyName) qParts.push(companyName.split(' ').slice(0, 3).join(' '));
  const q = qParts.join(' ');
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' stock')}&hl=en-IN&gl=IN&ceid=IN:en`;
  const xml = await fetchUrl(url, 'google-news');
  if (!xml) return [];
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 5) {
    const block = m[1];
    const title = pickXmlTag(block, 'title');
    const link  = pickXmlTag(block, 'link');
    const pub   = pickXmlTag(block, 'pubDate');
    if (!title || !link) continue;
    if (!looksLikeRealHeadline(title)) continue;
    if (!headlineMentionsCompany(title, ticker, companyName)) continue;
    items.push({
      headline: title,
      url: link,
      source: 'Google News',
      sourceWeight: 30,
      publishedAt: pub ? new Date(pub).toISOString() : null,
    });
  }
  return items;
}

// ─── Source 2: Moneycontrol per-ticker news ─────────────────────────────

async function fetchMoneycontrol(ticker) {
  // Moneycontrol has /news?search=<ticker> which returns recent ticker-tagged news
  const url = `https://www.moneycontrol.com/news/tags/${encodeURIComponent(ticker.toLowerCase())}.html`;
  const html = await fetchUrl(url, 'moneycontrol');
  if (!html) return [];

  const items = [];
  // PATCH 0802: tighter regex — must point to a Moneycontrol news article URL
  // AND not match the headline blacklist (drops "Business videos" etc.)
  const re = /<(?:h2|h3)[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/(?:h2|h3)>/g;
  let m;
  while ((m = re.exec(html)) !== null && items.length < 5) {
    const href = m[1];
    const title = stripHtml(m[2]);
    if (!looksLikeRealHeadline(title)) continue;
    // Moneycontrol news article URLs always contain '/news/' and end in a numeric id
    if (!/moneycontrol\.com\/news\/.+\d+\.html/i.test(href)
        && !(/^\/news\//.test(href) && /\d+\.html$/.test(href))) continue;
    items.push({
      headline: title,
      url: href.startsWith('http') ? href : `https://www.moneycontrol.com${href}`,
      source: 'Moneycontrol',
      sourceWeight: 70,
      publishedAt: null,
    });
  }
  return items;
}

// ─── Source 3: Trendlyne ─────────────────────────────────────────────────

async function fetchTrendlyne(ticker) {
  // Trendlyne per-ticker news URL pattern
  const url = `https://trendlyne.com/equity/latest-news/${encodeURIComponent(ticker.toUpperCase())}/`;
  const html = await fetchUrl(url, 'trendlyne');
  if (!html) return [];

  const items = [];
  // Trendlyne news items: links inside news-list containers
  const re = /<a[^>]*href="(\/[^"]*news[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null && items.length < 5) {
    const href = m[1];
    const title = stripHtml(m[2]);
    if (!looksLikeRealHeadline(title)) continue;     // P0804: filter junk
    if (seen.has(title)) continue;
    seen.add(title);
    items.push({
      headline: title,
      url: `https://trendlyne.com${href}`,
      source: 'Trendlyne',
      sourceWeight: 60,
      publishedAt: null,
    });
  }
  return items;
}

// ─── Source 4: Yahoo Finance news ────────────────────────────────────────

async function fetchYahoo(ticker) {
  // Yahoo has a JSON-ish endpoint; fall back to HTML scrape
  // Try the v6 finance/news endpoint first
  const symbols = `${ticker}.NS`;
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbols)}&newsCount=8&quotesCount=0`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const j = await res.json();
    const news = j?.news || [];
    return news.slice(0, 5).map((n) => ({
      headline: n.title || '',
      url: n.link || '',
      source: `Yahoo (${n.publisher || 'unknown'})`,
      sourceWeight: 40,
      publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    })).filter((x) => x.headline && x.url && looksLikeRealHeadline(x.headline));  // P0804
  } catch { return []; }
}

// ─── Dedupe + rank ──────────────────────────────────────────────────────

function dedupeAndRank(items) {
  // Dedupe by title (first 80 chars normalized)
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').slice(0, 80);
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const k = norm(it.headline);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }
  // Rank: sourceWeight DESC, then recency DESC (newer first)
  unique.sort((a, b) => {
    if (a.sourceWeight !== b.sourceWeight) return b.sourceWeight - a.sourceWeight;
    const ta = new Date(a.publishedAt || 0).getTime();
    const tb = new Date(b.publishedAt || 0).getTime();
    return tb - ta;
  });
  return unique;
}

// ─── Narrative extraction ──────────────────────────────────────────────

function buildNarrative(topReason, ticker) {
  if (!topReason) return null;
  const h = topReason.headline;
  // Detect category for the chip
  let category = 'NEWS';
  if (/earnings|results|Q[1-4]|profit|revenue|EBITDA|margin/i.test(h)) category = 'EARNINGS';
  else if (/order|contract|LoA|award|win|deal/i.test(h)) category = 'ORDER';
  else if (/upgrade|downgrade|rating|outlook/i.test(h)) category = 'RATING';
  else if (/merger|acquisition|stake|demerger|takeover|de-listing/i.test(h)) category = 'M&A';
  else if (/dividend|buyback|bonus|split/i.test(h)) category = 'CAPITAL';
  else if (/SEBI|RBI|FDA|approval|clearance/i.test(h)) category = 'REGULATORY';
  return { category, source: topReason.source, headline: h };
}

// ─── Identify today's extreme movers ───────────────────────────────────

async function loadExtremeMovers() {
  // Read the NSE ticker universe blob for current changePercent values
  const blob = await kvGet('nse-ticker-universe:v1:latest');
  if (!blob || !Array.isArray(blob.tickers)) return [];
  const extreme = blob.tickers
    .filter((t) => t.hasPrice && Math.abs(t.changePercent || 0) >= MOVER_PCT_THRESHOLD)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, MAX_TICKERS_PER_RUN);
  return extreme;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function processTicker(t) {
  const results = await Promise.allSettled([
    fetchGoogleNews(t.ticker, t.company),
    fetchMoneycontrol(t.ticker),
    fetchTrendlyne(t.ticker),
    fetchYahoo(t.ticker),
  ]);
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...(r.value || []));
  }
  const ranked = dedupeAndRank(all);
  const top = ranked[0] || null;
  return {
    ticker: t.ticker,
    company: t.company,
    changePercent: t.changePercent,
    generatedAt: new Date().toISOString(),
    topReason: top,
    narrative: buildNarrative(top, t.ticker),
    allReasons: ranked.slice(0, 10),
    sourceCounts: {
      google: results[0].status === 'fulfilled' ? results[0].value.length : 0,
      moneycontrol: results[1].status === 'fulfilled' ? results[1].value.length : 0,
      trendlyne: results[2].status === 'fulfilled' ? results[2].value.length : 0,
      yahoo: results[3].status === 'fulfilled' ? results[3].value.length : 0,
    },
  };
}

async function main() {
  const startedAt = Date.now();
  console.log(`▶ scrape-mover-reasons at ${new Date().toISOString()}`);

  const extreme = await loadExtremeMovers();
  console.log(`  found ${extreme.length} movers (≥${MOVER_PCT_THRESHOLD}%)`);
  if (extreme.length === 0) {
    console.log('  no movers above threshold — nothing to scrape');
    return;
  }

  let ok = 0, withReason = 0;
  for (let i = 0; i < extreme.length; i++) {
    const t = extreme[i];
    try {
      const result = await processTicker(t);
      await kvSet(`mover-reasons:v1:${t.ticker}`, result, KV_TTL_SECONDS);
      ok++;
      if (result.topReason) withReason++;
      if ((i + 1) % 10 === 0 || i === extreme.length - 1) {
        console.log(`  ${i + 1}/${extreme.length} processed (with-reason=${withReason})`);
      }
    } catch (e) {
      console.log(`  ${t.ticker}: ${e?.message || e}`);
    }
    if (i < extreme.length - 1) await new Promise((r) => setTimeout(r, TICKER_THROTTLE_MS));
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`✓ done in ${elapsed}s · ok=${ok}/${extreme.length} · with-public-reason=${withReason}`);
  console.log(`::notice title=Mover reasons::${withReason}/${extreme.length} movers got public-source headlines.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
