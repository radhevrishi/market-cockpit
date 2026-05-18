// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR NEWS ENDPOINT (PATCH 0483)
//
// GET /api/v1/super-investor-news?query=Ashish+Kacholia
//
// The general /api/v1/news cache is curated for stock-level events, so
// searching it for an investor name almost always returns zero results.
// This route fans out across multiple public news/RSS sources keyed on
// the investor's name and returns a deduped, dated list of recent
// articles. KV-cached 30 min so we don't re-hit RSS endpoints on every
// page visit.
//
// Sources (all free, all RSS-or-HTML):
//   1. Google News RSS (most reliable, indexes most Indian financial pubs)
//   2. Moneycontrol search RSS
//   3. Economic Times search (HTML scrape, optional)
//
// Returns: { articles: NewsArticle[], sources: { name: string, count: number }[] }
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 25;

interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  source_tier?: string;
  publishedAt: string;
  snippet?: string;
}

interface ResponseShape {
  articles: NewsArticle[];
  sources: { name: string; count: number }[];
  cached: boolean;
  query: string;
}

// ── XML helpers (no library) ─────────────────────────────────────────────
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml: string): Array<Partial<NewsArticle>> {
  const items: Array<Partial<NewsArticle>> = [];
  // Tolerant matcher — Google News uses <item>, Moneycontrol uses <item> too.
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const pick = (tag: string): string => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const x = block.match(r);
      if (!x) return '';
      let v = x[1];
      v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1');
      return stripHtml(v);
    };
    const title = pick('title');
    const link = pick('link');
    const pubDate = pick('pubDate');
    const source = pick('source') || pick('dc:creator') || '';
    const description = pick('description');
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source: source || 'Google News',
      snippet: description.slice(0, 240),
    });
  }
  return items;
}

// ── Sources ──────────────────────────────────────────────────────────────
async function fetchGoogleNews(query: string): Promise<NewsArticle[]> {
  // hl=en-IN biases toward Indian results; ceid=IN:en restricts country.
  const q = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRss(xml);
    return items.map((it, i) => ({
      id: `gn-${Buffer.from((it.url || '') + i).toString('base64').slice(0, 16)}`,
      title: it.title || '',
      url: it.url || '',
      source: it.source || 'Google News',
      source_tier: 'AGGREGATOR',
      publishedAt: it.publishedAt || new Date().toISOString(),
      snippet: it.snippet || '',
    })).filter((a) => a.title && a.url);
  } catch {
    return [];
  }
}

async function fetchMoneycontrol(query: string): Promise<NewsArticle[]> {
  // Moneycontrol exposes /news/sitesearch.php and a separate RSS for some
  // sections — broad search via Google site:moneycontrol.com is more
  // reliable, but we still try the direct sitesearch HTML as a fallback.
  const q = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${q}+site:moneycontrol.com&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRss(xml);
    return items.map((it, i) => ({
      id: `mc-${Buffer.from((it.url || '') + i).toString('base64').slice(0, 16)}`,
      title: it.title || '',
      url: it.url || '',
      source: 'Moneycontrol',
      source_tier: 'SECONDARY',
      publishedAt: it.publishedAt || new Date().toISOString(),
      snippet: it.snippet || '',
    })).filter((a) => a.title && a.url);
  } catch {
    return [];
  }
}

async function fetchET(query: string): Promise<NewsArticle[]> {
  const q = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${q}+site:economictimes.indiatimes.com&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRss(xml);
    return items.map((it, i) => ({
      id: `et-${Buffer.from((it.url || '') + i).toString('base64').slice(0, 16)}`,
      title: it.title || '',
      url: it.url || '',
      source: 'Economic Times',
      source_tier: 'SECONDARY',
      publishedAt: it.publishedAt || new Date().toISOString(),
      snippet: it.snippet || '',
    })).filter((a) => a.title && a.url);
  } catch {
    return [];
  }
}

async function fetchTrendlyne(query: string): Promise<NewsArticle[]> {
  // Trendlyne doesn't expose a public RSS, but Google News indexes it.
  const q = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${q}+site:trendlyne.com&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRss(xml);
    return items.map((it, i) => ({
      id: `tl-${Buffer.from((it.url || '') + i).toString('base64').slice(0, 16)}`,
      title: it.title || '',
      url: it.url || '',
      source: 'Trendlyne',
      source_tier: 'SPECIALIST',
      publishedAt: it.publishedAt || new Date().toISOString(),
      snippet: it.snippet || '',
    })).filter((a) => a.title && a.url);
  } catch {
    return [];
  }
}

// ── Handler ──────────────────────────────────────────────────────────────
export async function GET(request: Request): Promise<NextResponse<ResponseShape>> {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('query') || '').trim();
  if (!query) {
    return NextResponse.json({ articles: [], sources: [], cached: false, query: '' });
  }

  const cacheKey = `super-investor-news:v1:${query.toLowerCase().replace(/\s+/g, '_')}`;
  try {
    const cached = await kvGet<ResponseShape & { _ts?: number }>(cacheKey);
    if (cached && cached._ts && Date.now() - cached._ts < 30 * 60 * 1000) {
      return NextResponse.json({ ...cached, cached: true });
    }
  } catch {}

  // Fan-out across all sources in parallel.
  const [gn, mc, et, tl] = await Promise.all([
    fetchGoogleNews(query),
    fetchMoneycontrol(query),
    fetchET(query),
    fetchTrendlyne(query),
  ]);

  // Dedupe by URL (most reliable identifier).
  const seen = new Set<string>();
  const merged: NewsArticle[] = [];
  for (const a of [...gn, ...mc, ...et, ...tl]) {
    const u = a.url.split('?')[0]; // strip query params for better dedup
    if (seen.has(u)) continue;
    seen.add(u);
    merged.push(a);
  }

  // Sort newest first.
  merged.sort((a, b) => {
    const ta = new Date(a.publishedAt).getTime();
    const tb = new Date(b.publishedAt).getTime();
    return tb - ta;
  });

  const payload: ResponseShape = {
    articles: merged.slice(0, 40),
    sources: [
      { name: 'Google News', count: gn.length },
      { name: 'Moneycontrol', count: mc.length },
      { name: 'Economic Times', count: et.length },
      { name: 'Trendlyne', count: tl.length },
    ],
    cached: false,
    query,
  };

  try {
    await kvSet(cacheKey, { ...payload, _ts: Date.now() }, 60 * 60); // 1h TTL
  } catch {}

  return NextResponse.json(payload);
}
