// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL SITUATIONS LIVE DISCOVERY ENGINE — patch 0097
//
// Independent of /api/v1/news (which filters to BOTTLENECK-tier signals).
// This route fetches a curated set of RSS feeds DIRECTLY, applies SPIN /
// M&A / TURN / CAP / DEMERGER / TENDER_BUYBACK classification, dedupes,
// and returns a structured response.
//
// Cache: 30 minutes (corporate actions don't break in real time).
// Output: per-category arrays + last_updated for liveness pill.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── Sources ────────────────────────────────────────────────────────────────
// Mix of US + India + global feeds known to carry corporate-action coverage.
// Order matters for fallback — slower sources later.

interface FeedSource { name: string; url: string; region: 'IN' | 'US' | 'GLOBAL' }

const SOURCES: ReadonlyArray<FeedSource> = [
  // India — broad business + market feeds
  { name: 'ET Markets',        url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',           region: 'IN' },
  { name: 'ET Industry',       url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms',           region: 'IN' },
  { name: 'ET Stocks',         url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms',      region: 'IN' },
  { name: 'Livemint Companies',url: 'https://www.livemint.com/rss/companies',                                          region: 'IN' },
  { name: 'Livemint Markets',  url: 'https://www.livemint.com/rss/markets',                                            region: 'IN' },
  { name: 'NDTV Profit',       url: 'https://feeds.feedburner.com/ndtvprofit-latest',                                  region: 'IN' },
  { name: 'MoneyControl Top',  url: 'https://www.moneycontrol.com/rss/MCtopnews.xml',                                  region: 'IN' },
  { name: 'MoneyControl Mkts', url: 'https://www.moneycontrol.com/rss/marketreports.xml',                              region: 'IN' },
  { name: 'MoneyControl Biz',  url: 'https://www.moneycontrol.com/rss/business.xml',                                   region: 'IN' },
  // US — corporate-action heavy
  { name: 'MarketWatch Top',   url: 'https://feeds.marketwatch.com/marketwatch/topstories/',                           region: 'US' },
  { name: 'MarketWatch Mkts',  url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/',                          region: 'US' },
  { name: 'SeekingAlpha News', url: 'https://seekingalpha.com/market_currents.xml',                                    region: 'US' },
  { name: 'CNBC Top',          url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', region: 'US' },
  { name: 'CNBC Finance',      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',  region: 'US' },
  { name: 'CNBC Earnings',     url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135',  region: 'US' },
  // PATCH 0100: SEC EDGAR 8-K — primary source for US M&A / spin-off / buyback disclosures
  { name: 'SEC EDGAR 8-K',     url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  { name: 'SEC EDGAR Form 10', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-12B&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  // Global / wires
  { name: 'Yahoo Finance',     url: 'https://finance.yahoo.com/news/rssindex',                                          region: 'GLOBAL' },
];

// ─── Patterns ───────────────────────────────────────────────────────────────
// Tuned wider than the page-side regex so we catch more candidates.  REJECT
// patterns kill rumour / negation noise.

type Category = 'SPIN' | 'MA' | 'TURN' | 'CAP';

interface CategorySpec {
  id: Category;
  label: string;
  pattern: RegExp;
  reject?: RegExp;
}

const CATEGORIES: ReadonlyArray<CategorySpec> = [
  {
    id: 'SPIN',
    label: 'Spin-offs / Demergers',
    // PATCH 0100: broadened to catch headlines like "X to separate into two", "approves demerger",
    // "split into X", "creates independent company", Form 10/10-12B SEC filings, "carve out unit"
    pattern: /\b(spin.?off|spinoff|spun.?off|spinning off|demerg(?:e[rd]?|ing)|de.?merger|carve.?out|carved out|carving out|split.?off|hive.?off|hive[ -]off|form\s*10(?:-12B)?\b|tax.?free distribution|business separation|breakup|break.?up\s+plan|separate (?:the|its) (?:business|division|segment|unit|operations)|to spin (?:off|out)|approves? (?:demerger|spin.?off|de-?merger|separation)|creates? (?:independent|separate|new) (?:company|entity|listed)|split into (?:two|three|four)|two separate companies|independent (?:public )?company|to be (?:demerged|separated|split)|sebi (?:demerger|spin)|nclt (?:approves|sanctions) (?:demerger|scheme of arrangement)|scheme of arrangement|business reorganis(?:e|ation)|listing of (?:the )?(?:demerged|spin))\b/i,
  },
  {
    id: 'MA',
    label: 'M&A / Open Offers / Takeovers',
    pattern: /\b(open offer|takeover bid|tender offer|hostile (?:bid|offer)|acquir(?:e|ed|es|ing)|acquisition|merger|merge with|merger agreement|all.?cash deal|all.?stock deal|strategic acquisition|control change|change of control|controlling stake|substantial acquisition|buyout offer|to (?:buy|acquire)\s+[A-Z]|deal worth|stake (?:sale|acquisition)|to sell (?:business|unit|division|stake)|sells (?:its|business|unit|division|stake)|cci approves?|definitive agreement|definitive merger)\b/i,
    reject: /\b(rumou?r(?:ed|s)?|may consider|reportedly weighing|in talks (?:to|with)|exploring|denied|reject(?:ed)?\s+(?:the\s+)?offer|terminated|called off|withdr(?:ew|awn)|antitrust block|deal collapse)\b/i,
  },
  {
    id: 'TURN',
    label: 'Turnarounds',
    // PATCH 0100: added narrowed-loss / first-profitable / EBITDA-positive / operating-profit phrasings
    pattern: /\b(turnaround|turn.?around|back to profit|back in (?:the )?black|swung to profit|swing to profit|loss to profit|profit revival|first profit (?:after|since)|exits losses|debt restructur|balance sheet repair|debt reduction|debt prepay|deleverag|recapitalis|operational restructur|cost cutting yields|return to profit|profit after years|profit after \w+ losses|narrowed (?:loss|losses)|narrowing loss(?:es)?|first profitable (?:quarter|year)|ebitda positive|operating profit (?:after|first)|black (?:after|since)|profitable (?:after|since) \w+ (?:years|quarters)|recovers? from loss|emerges? from (?:bankruptcy|restructur|losses)|debt resolution|cdr exit|sdr exit|insolvency exit)\b/i,
    reject: /\b(failed turnaround|turnaround unlikely|fall(?:s|ing|en)?\s+back into loss|swung to loss|return to loss|loss widens|widening loss|loss expands)\b/i,
  },
  {
    id: 'CAP',
    label: 'Capital Allocation (Buybacks / Dividends)',
    pattern: /\b(buyback|share repurchase|repurchas(?:e|ed|ing)\s+shares|repurchase program|tender for own shares|special dividend|interim dividend|bonus issue|capital return|return of capital|debt prepay|treasury shares|reduction of share capital|capital reduction|dividend hike|dividend increase|raise(?:s|d)?\s+dividend|hikes? dividend|stock split|share split|board approves dividend|board recommends dividend|qip\b|qualified institutional placement|preferential (?:allotment|issue)|rights issue|rights offer)\b/i,
    reject: /\b(buyback program ended|cancel(?:led|s)?\s+(?:the\s+)?buyback|denied buyback|paused\s+(?:the\s+)?buyback|dividend (?:cut|reduced|suspended)|skip dividend|forgoes dividend)\b/i,
  },
];

// ─── Item type ──────────────────────────────────────────────────────────────

interface FeedItem {
  id: string;
  title: string;
  link: string;
  source: string;
  region: 'IN' | 'US' | 'GLOBAL';
  pub_date: string;
  age_hours: number;
  category: Category;
  category_label: string;
  tickers: string[];
  description?: string;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;
let CACHE: { data: any; ts: number } | null = null;

// ─── XML parsing ────────────────────────────────────────────────────────────
// Lightweight regex-based parser — RSS/Atom feeds expose flat <item> blocks
// (or <entry> for Atom). We don't need DOM-level fidelity.

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripCdataAndHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')                  // strip inline HTML
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRSS(xml: string): Array<{ title: string; link: string; pubDate: string; description?: string }> {
  const out: Array<{ title: string; link: string; pubDate: string; description?: string }> = [];
  // RSS <item> blocks
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || '';
    const link  = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]) || (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]) || '';
    const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]) ||
                    (block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)?.[1]) || '';
    const desc = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1]) || '';
    out.push({
      title: stripCdataAndHtml(decodeXmlEntities(title)),
      link: stripCdataAndHtml(decodeXmlEntities(link)),
      pubDate: stripCdataAndHtml(decodeXmlEntities(pubDate)),
      description: stripCdataAndHtml(decodeXmlEntities(desc)),
    });
  }
  // Atom <entry> blocks (Yahoo Finance, some others)
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml))) {
    const block = m[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || '';
    const link  = (block.match(/<link[^>]*href="([^"]+)"/i)?.[1]) || '';
    const pubDate = (block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]) ||
                    (block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]) || '';
    const summary = (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]) ||
                    (block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1]) || '';
    out.push({
      title: stripCdataAndHtml(decodeXmlEntities(title)),
      link: stripCdataAndHtml(decodeXmlEntities(link)),
      pubDate: stripCdataAndHtml(decodeXmlEntities(pubDate)),
      description: stripCdataAndHtml(decodeXmlEntities(summary)),
    });
  }
  return out;
}

// ─── Ticker extraction ──────────────────────────────────────────────────────

const TICKER_RE = /\b([A-Z]{2,6})\b/g;
const TICKER_BLACKLIST = new Set([
  // common english caps + acronyms that aren't tickers
  'CEO','CFO','COO','CTO','CIO','MD','VP','EVP','SVP',
  'NSE','BSE','SEBI','NCLT','RBI','GST','PLI','FDI','PMI',
  'GDP','CPI','WPI','EPS','EBIT','EBITDA','PAT','OPM','PE','PEG','ROE','ROCE','ROIC','FCF','OCF','SBC','SOP','TAM',
  'AI','ML','LLM','API','SDK','PDF','HTML','URL','PII',
  'USD','INR','EUR','GBP','JPY','RMB','AED',
  'IPO','M&A','SPIN','TURN','CAP','MRI',
  'US','UK','EU','UAE','UK','USA',
  'CEO','BOD','COO',
  'JV','MoU','LOI','RFP',
  'HIGH','LOW','BUY','SELL','HOLD','BULL','BEAR',
  'NEW','OLD','TOP','MAY','APR','JAN','FEB','MAR','JUN','JUL','AUG','SEP','OCT','NOV','DEC',
  'LIVE','BREAKING','UPDATE','WATCH','READ','SEE',
  'FOR','THE','AND','OR','BUT','NOT','ARE','WITH','FROM','HAS','HAD','OUT','OVER','INTO','THIS','THAT','THESE','THOSE','WILL','SAID','SAY','SAYS','MORE','LESS','BIG','SMALL',
  'YEAR','YEARS','QUARTER','MONTH','MONTHS','WEEK','WEEKS','DAY','DAYS',
  'COMPANY','COMPANIES','GROUP','LTD','INC','CORP','PLC','SA','SE','LLC','LP',
]);

function extractTickers(text: string, region: 'IN'|'US'|'GLOBAL'): string[] {
  const tickers = new Set<string>();
  // 1. Indian-suffixed tickers
  const inSuffix = text.match(/\b[A-Z][A-Z0-9]+\.NS\b|\b[A-Z][A-Z0-9]+\.BO\b/g) || [];
  inSuffix.forEach((t) => tickers.add(t.toUpperCase()));
  // 2. Plain caps tokens
  const all = text.match(TICKER_RE) || [];
  for (const t of all) {
    if (TICKER_BLACKLIST.has(t)) continue;
    if (t.length < 2 || t.length > 6) continue;
    tickers.add(t);
  }
  return Array.from(tickers).slice(0, 6);
}

// ─── Fetch + classify ───────────────────────────────────────────────────────

async function fetchFeedSafe(src: FeedSource, timeoutMs = 8000): Promise<{ src: FeedSource; xml: string } | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(src.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Market Cockpit Special Situations 1.0)' },
      signal: ac.signal,
      cache: 'no-store',
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const xml = await res.text();
    return { src, xml };
  } catch {
    return null;
  }
}

function classify(text: string): { category: Category; label: string } | null {
  for (const c of CATEGORIES) {
    if (c.reject && c.reject.test(text)) continue;
    if (c.pattern.test(text)) return { category: c.id, label: c.label };
  }
  return null;
}

function dedupeBy<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn(x).toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

async function buildFeed(): Promise<{
  last_updated: string;
  total: number;
  by_category: Record<Category, FeedItem[]>;
  source_status: Array<{ name: string; ok: boolean; items?: number }>;
}> {
  // Fetch all feeds in parallel
  const fetched = await Promise.all(SOURCES.map((s) => fetchFeedSafe(s)));
  const sourceStatus: Array<{ name: string; ok: boolean; items?: number }> = [];
  const all: FeedItem[] = [];
  const now = Date.now();

  for (let i = 0; i < SOURCES.length; i++) {
    const src = SOURCES[i];
    const fr = fetched[i];
    if (!fr) {
      sourceStatus.push({ name: src.name, ok: false });
      continue;
    }
    const items = parseRSS(fr.xml);
    sourceStatus.push({ name: src.name, ok: true, items: items.length });

    for (const it of items) {
      const text = `${it.title} ${it.description || ''}`;
      const c = classify(text);
      if (!c) continue;
      let pubMs = NaN;
      if (it.pubDate) {
        const d = new Date(it.pubDate);
        pubMs = isNaN(d.getTime()) ? NaN : d.getTime();
      }
      const ageHours = isNaN(pubMs) ? 999 : Math.max(0, Math.round((now - pubMs) / 3600000));
      all.push({
        id: `${src.name}__${(it.link || it.title).slice(0, 200)}`,
        title: it.title,
        link: it.link || '',
        source: src.name,
        region: src.region,
        pub_date: isNaN(pubMs) ? '' : new Date(pubMs).toISOString(),
        age_hours: ageHours,
        category: c.category,
        category_label: c.label,
        tickers: extractTickers(text, src.region),
        description: (it.description || '').slice(0, 240),
      });
    }
  }

  // Dedupe by canonical title (lowercased, trimmed)
  const deduped = dedupeBy(all, (x) => x.title);

  // Sort latest first within categories
  deduped.sort((a, b) => {
    const da = a.pub_date ? new Date(a.pub_date).getTime() : 0;
    const db = b.pub_date ? new Date(b.pub_date).getTime() : 0;
    return db - da;
  });

  const by_category: Record<Category, FeedItem[]> = { SPIN: [], MA: [], TURN: [], CAP: [] };
  for (const it of deduped) by_category[it.category].push(it);

  return {
    last_updated: new Date().toISOString(),
    total: deduped.length,
    by_category,
    source_status: sourceStatus,
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get('refresh') === '1';
    const now = Date.now();

    if (!force && CACHE && now - CACHE.ts < CACHE_TTL_MS) {
      return NextResponse.json({ ...CACHE.data, cached: true, cache_age_min: Math.round((now - CACHE.ts) / 60000) });
    }

    const data = await buildFeed();
    CACHE = { data, ts: now };
    return NextResponse.json({ ...data, cached: false, cache_age_min: 0 });
  } catch (e: any) {
    return NextResponse.json({
      error: 'special-situations feed failed',
      message: e?.message || String(e),
      last_updated: new Date().toISOString(),
      total: 0,
      by_category: { SPIN: [], MA: [], TURN: [], CAP: [] },
    }, { status: 200 });
  }
}
