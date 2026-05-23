// PATCH 0724 — Free RSS-based Indian-smallcap news ingestion.
//
// The standard /api/v1/news pipeline misses many Indian smallcap tickers
// (MINDACORP, SPARC, RATEGAIN class). This module fetches directly from
// Yahoo Finance + Google News RSS as a free, no-API-key fallback so the
// Home Movers WHY-attribution panel actually has data for those names.
//
// Both endpoints return XML. We parse minimally with regex (no heavy
// xml lib in serverless cold-start budget). All fetches are bounded by
// an 8s AbortController and fail-soft (return [] on any error).

export interface NewsItem {
  title: string;
  url: string;
  published_at: string;        // ISO 8601
  source: 'Yahoo Finance' | 'Google News';
  summary?: string;
}

const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT =
  'Market Cockpit institutional-research feedback@market-cockpit.app';

// ── Tiny XML helpers ─────────────────────────────────────────────────
// We don't need a full XML parser — RSS 2.0 items are flat and the
// only nesting we care about is <item>...</item> blocks with simple
// child tags. Regex on a single <item> chunk is robust enough for
// Yahoo + Google News, both of which emit well-formed feeds.

/** Decode the small set of XML entities that appear in RSS payloads. */
function decodeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => {
      const code = Number(d);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .trim();
}

/** Extract the first child tag value out of an <item> chunk. */
function extractTag(itemXml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = itemXml.match(re);
  return m ? decodeXml(m[1]) : '';
}

/** Strip HTML tags from a summary blob (Google News wraps in <a> + <font>). */
function stripHtml(s: string): string {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Convert RFC-822 / RFC-2822 / ISO-ish pubDate strings to ISO 8601. */
function toIso(pubDate: string): string {
  if (!pubDate) return new Date().toISOString();
  const t = Date.parse(pubDate);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return new Date().toISOString();
}

/** Generic RSS 2.0 item parser. Returns an array of raw item chunks. */
function splitItems(xml: string): string[] {
  if (!xml) return [];
  const items: string[] = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    items.push(m[1]);
    if (items.length >= 50) break; // hard cap, RSS feeds shouldn't be huge
  }
  return items;
}

/** Bounded fetch with User-Agent + AbortController. Returns text or null. */
async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
      // RSS feeds are static enough — let the platform decide cache
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Yahoo Finance RSS ────────────────────────────────────────────────
// URL: https://feeds.finance.yahoo.com/rss/2.0/headline?s=<TICKER>.NS&region=US&lang=en-US
// Yahoo's RSS is small (8-12 items) but well-formed and covers many
// Indian listings. Returns [] on any failure.

export async function fetchYahooFinanceRSS(
  tickerNS: string,
): Promise<NewsItem[]> {
  const sym = (tickerNS || '').trim().toUpperCase();
  if (!sym) return [];
  // Accept both "MINDACORP" and "MINDACORP.NS" — normalize to .NS suffix.
  const yahooSym = /\.(NS|BO)$/i.test(sym) ? sym : `${sym}.NS`;
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
    yahooSym,
  )}&region=US&lang=en-US`;
  const xml = await fetchText(url);
  if (!xml) return [];

  try {
    const items = splitItems(xml);
    const out: NewsItem[] = [];
    for (const it of items) {
      const title = extractTag(it, 'title');
      const link = extractTag(it, 'link');
      const pubDate = extractTag(it, 'pubDate');
      const description = stripHtml(extractTag(it, 'description'));
      if (!title || !link) continue;
      out.push({
        title,
        url: link,
        published_at: toIso(pubDate),
        source: 'Yahoo Finance',
        summary: description || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ── Google News RSS ──────────────────────────────────────────────────
// URL: https://news.google.com/rss/search?q=<company>&hl=en-IN&gl=IN&ceid=IN:en
// Google News descriptions arrive as nested HTML (often a list of <a>
// tags with the publisher name + headline). We strip them down to plain
// text. Each <item> also carries a <source> tag we don't currently use.

export async function fetchGoogleNewsRSS(
  companyName: string,
): Promise<NewsItem[]> {
  const q = (companyName || '').trim();
  if (!q) return [];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    q,
  )}&hl=en-IN&gl=IN&ceid=IN:en`;
  const xml = await fetchText(url);
  if (!xml) return [];

  try {
    const items = splitItems(xml);
    const out: NewsItem[] = [];
    for (const it of items) {
      const title = extractTag(it, 'title');
      const link = extractTag(it, 'link');
      const pubDate = extractTag(it, 'pubDate');
      const description = stripHtml(extractTag(it, 'description'));
      if (!title || !link) continue;
      out.push({
        title,
        url: link,
        published_at: toIso(pubDate),
        source: 'Google News',
        summary: description || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ── Combined union ───────────────────────────────────────────────────
// Runs both feeds in parallel, dedupes by normalized title (case +
// whitespace insensitive — RSS feeds frequently double-list the same
// article under slightly different titles), sorts newest first, caps
// at 30 items.

export async function fetchIndianNews(
  ticker: string,
  companyName?: string,
): Promise<NewsItem[]> {
  const sym = (ticker || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  if (!sym) return [];

  // For Google News, prefer the explicit company name when supplied,
  // otherwise fall back to the ticker (which is good enough for unique
  // ticker symbols like MINDACORP / RATEGAIN but bad for generic ones).
  const gQuery = (companyName || '').trim() || sym;

  const [yahoo, google] = await Promise.all([
    fetchYahooFinanceRSS(sym),
    fetchGoogleNewsRSS(gQuery),
  ]);

  const seen = new Set<string>();
  const all: NewsItem[] = [];
  for (const it of [...yahoo, ...google]) {
    const k = it.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    all.push(it);
  }
  all.sort(
    (a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  );
  return all.slice(0, 30);
}
