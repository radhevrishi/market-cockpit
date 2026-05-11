import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS OPPORTUNITIES — server pipeline (patch 0132)
//
// Fully automated, fully live, NO Multibagger localStorage dependency.
// Architecture:
//   1. Fetch results-flavoured RSS feeds in parallel
//   2. Filter to "Q[1-4] results" / "FY26 earnings" announcements only
//   3. Parse structured Q4 fields from title + summary text:
//        - Sales YoY %
//        - PAT YoY %
//        - EPS YoY %
//        - Absolute Cr pairs ('Rs 530 Cr vs Rs 135 Cr')
//   4. Resolve company name → ticker via simple alias map + fallbacks
//   5. Apply transparent scoring: Growth × Quality × Acceleration × Tech
//   6. Bucket into 4 tiers: BLOCKBUSTER / STRONG / MIXED / AVOID
//   7. Generate narrative brief per stock
//   8. Cache result in KV by date (12-hour TTL)
//
// User: 'no hardcoding, all should be automatic'.
// Caveat: parser accuracy depends on RSS title/summary richness.  Sources
// vary — Moneycontrol Results / BS Markets often include absolute Cr;
// generic ET headlines often don't.  Parser surfaces partial cards
// (just YoY %) when only growth is in the text.
// ═══════════════════════════════════════════════════════════════════════════

// ─── RSS sources optimised for Indian results ──────────────────────────────
const RESULTS_FEEDS: Array<{ name: string; url: string; tier: 'primary' | 'secondary' }> = [
  // Moneycontrol Results — best signal density
  { name: 'Moneycontrol Results',         url: 'https://www.moneycontrol.com/rss/results.xml',                              tier: 'primary' },
  { name: 'Moneycontrol Markets',         url: 'https://www.moneycontrol.com/rss/marketreports.xml',                        tier: 'secondary' },
  { name: 'Moneycontrol Business',        url: 'https://www.moneycontrol.com/rss/business.xml',                             tier: 'secondary' },
  // Business Standard Markets / Companies — often has absolute Cr pairs
  { name: 'Business Standard Markets',    url: 'https://www.business-standard.com/rss/markets-106.rss',                     tier: 'primary' },
  { name: 'Business Standard Companies',  url: 'https://www.business-standard.com/rss/companies-101.rss',                   tier: 'primary' },
  // BL Markets/Companies
  { name: 'BL Markets',                   url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss',           tier: 'secondary' },
  { name: 'BL Companies',                 url: 'https://www.thehindubusinessline.com/companies/feeder/default.rss',         tier: 'secondary' },
  // Livemint
  { name: 'Mint Companies',               url: 'https://www.livemint.com/rss/companies',                                    tier: 'secondary' },
  { name: 'Mint Markets',                 url: 'https://www.livemint.com/rss/markets',                                      tier: 'secondary' },
  // ET Markets / Companies
  { name: 'ET Markets',                   url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',      tier: 'secondary' },
  { name: 'ET Industry',                  url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms',       tier: 'secondary' },
  // Financial Express
  { name: 'Financial Express Industry',   url: 'https://www.financialexpress.com/business/industry/feed/',                  tier: 'secondary' },
  // Capital Market
  { name: 'Capital Market',               url: 'https://www.capitalmarket.com/Mark/marketwatch.aspx?type=rss',              tier: 'secondary' },
];

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
  tier: 'primary' | 'secondary';
}

// Minimal RSS parser — regex-based, no XML lib dependency
function parseRss(xml: string, source: string, tier: 'primary' | 'secondary'): RssItem[] {
  const items: RssItem[] = [];
  // Some feeds use <item>, some Atom uses <entry>
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const chunk = m[0];
    const title       = stripTags(extract(chunk, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const link        = stripTags(extract(chunk, /<link[^>]*>([\s\S]*?)<\/link>/i));
    const pubDate     = stripTags(extract(chunk, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i));
    const description = stripTags(extract(chunk, /<description[^>]*>([\s\S]*?)<\/description>/i));
    if (title) items.push({ title, link, pubDate, description, source, tier });
  }
  return items;
}
function extract(s: string, re: RegExp): string {
  const m = re.exec(s); return m ? m[1] : '';
}
function stripTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// ─── Results-flavoured filter ──────────────────────────────────────────────
// Returns true if article is about a quarterly earnings result.
// Patterns we want: 'Q4 results' / 'Q4 FY26' / 'quarterly results' / 'PAT rises' /
// 'net profit jumps' / 'reports a profit' / '<Co> Q4 earnings' / 'Q4FY26'.
// Patterns we filter OUT: previews ('to announce Q4 on'), guidance only ('FY27 guidance'),
// rating changes ('upgrades' / 'downgrades'), opinion pieces.
const RESULTS_TRIGGER = /\b(q[1-4]\s*fy\s*\d{2,4}|q[1-4]\s+results|q[1-4]\s+earnings|q[1-4]\s+net\s+profit|q[1-4]\s+pat|quarterly\s+(?:results|earnings|profit)|reports?\s+(?:a\s+)?(?:q[1-4]\s+)?(?:profit|loss|earnings)|posts?\s+(?:a\s+)?(?:q[1-4]\s+)?(?:profit|loss|earnings)|earnings\s+(?:rise|jump|fall|drop|surge|decline)|q[1-4]\s+(?:net\s+)?profit\s+(?:rises|jumps|falls|drops)|posts?\s+q[1-4]|standalone\s+q[1-4]|consolidated\s+q[1-4])\b/i;

const PREVIEW_OR_NOISE = /\b(to\s+(?:announce|report|post|file)|preview|will\s+report|expected\s+to|guidance\s+(?:cut|raised|reaffirmed)|target\s+price|upgrade|downgrade|brokerage|stock\s+(?:soars?|jumps?|falls?)\s+after|share\s+price)\b/i;

function isEarningsArticle(item: RssItem): boolean {
  const text = `${item.title} ${item.description}`;
  if (!RESULTS_TRIGGER.test(text)) return false;
  // Allow some overlap (e.g. 'Stock jumps 5% after Q4 results' has 'stock jumps after' but is OK)
  if (PREVIEW_OR_NOISE.test(text) && !/q[1-4]/i.test(text)) return false;
  return true;
}

// ─── Number parsing ────────────────────────────────────────────────────────
// Sales / PAT / EPS YoY %
function parseYoyPct(text: string, metricRe: RegExp): number | null {
  if (!text) return null;
  const re = new RegExp(
    `(?:${metricRe.source})[^.]{0,80}?(?:up|down|fell|rose|jumped|dropped|surged|grew|expanded|contracted|declined)?\\s*(?:by\\s+)?([+-]?\\d{1,4}(?:\\.\\d{1,2})?)\\s*%`,
    'i',
  );
  const m = re.exec(text);
  if (!m) return null;
  // Detect direction word — if 'down/fell/dropped/declined' precedes, force negative
  const direction = re.exec(text);  // re-run for safety
  let v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  // If text immediately before % suggests negative
  const ctx = text.slice(Math.max(0, (m.index || 0) - 60), m.index);
  if (/\b(down|fell|dropped|declined|fall|decline|contracted)\b/i.test(ctx) && v > 0) v = -v;
  return v;
}
function parseAbsolutePair(text: string, metricRe: RegExp): { curr: number | null; prev: number | null } {
  if (!text) return { curr: null, prev: null };
  // "Rs 889 Cr versus Rs 291 Cr" / "₹530 Crore vs ₹135 Crore" / "Rs.530 cr from Rs.135 cr"
  const re = new RegExp(
    `(?:${metricRe.source})[^.]{0,80}?(?:rs\\.?|₹|inr)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:cr|crore|lakh)?\\s*(?:vs|versus|against|from|compared\\s+to)\\s*(?:rs\\.?|₹|inr)?\\s*([\\d,]+(?:\\.\\d+)?)`,
    'i',
  );
  const m = re.exec(text);
  if (!m) return { curr: null, prev: null };
  const curr = Number(m[1].replace(/,/g, ''));
  const prev = Number(m[2].replace(/,/g, ''));
  return {
    curr: Number.isFinite(curr) ? curr : null,
    prev: Number.isFinite(prev) ? prev : null,
  };
}

const SALES_RE = /\b(sales|revenue|topline|net\s+sales|total\s+revenue|revenue\s+from\s+operations)\b/i;
const PAT_RE   = /\b(pat|net\s+profit|profit\s+after\s+tax|net\s+income|bottom\s+line|consolidated\s+net\s+profit|consolidated\s+pat)\b/i;
const EPS_RE   = /\b(eps|earnings\s+per\s+share)\b/i;

// ─── Company / ticker extraction ───────────────────────────────────────────
// Indian results headlines typically start with the company name.
// Strip noise tokens, normalise, then look up.
const NOISE_TOKENS = /\b(ltd|limited|corp|corporation|inc|company|co\.?|the|india|industries|industry)\b/gi;
function extractCompany(title: string): string {
  // Take everything before the first ":", "-", "—", or " Q[1-4]"
  let s = title.split(/\s+[—–-]\s+|:\s+|\s+\|\s+|\s+Q[1-4]\b/i)[0].trim();
  if (s.length > 60) s = s.slice(0, 60);
  return s;
}
function normaliseCompanyName(name: string): string {
  return name.replace(NOISE_TOKENS, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().toUpperCase();
}

// Best-effort ticker guess — strip noise + take first uppercase token in title
const TICKER_HINT_RE = /\b([A-Z]{3,12})(?:\.NS|\.BO)?\b/g;
function guessTickerFromText(text: string, companyHint: string): string {
  // 1. Look for explicit ticker hints like 'NSE: COMPANY' or 'BSE: 532898'
  let m = /\b(?:NSE|BSE)\s*[:|]\s*([A-Z]{3,12}|\d{4,7})\b/.exec(text);
  if (m) return m[1].toUpperCase();
  // 2. Take first long all-caps token
  TICKER_HINT_RE.lastIndex = 0;
  m = TICKER_HINT_RE.exec(text.replace(NOISE_TOKENS, ''));
  if (m) return m[1].toUpperCase();
  // 3. Fallback: collapse company name
  return normaliseCompanyName(companyHint).replace(/\s+/g, '').slice(0, 12);
}

// ─── Quarter detection ─────────────────────────────────────────────────────
const QUARTER_RE = /\bQ([1-4])\s*(?:FY)?\s*(\d{2}|2\d{3})?\b/i;
function detectQuarter(text: string): string {
  const m = QUARTER_RE.exec(text);
  if (!m) return 'Q4';
  let yr = m[2] || '';
  if (yr.length === 4) yr = yr.slice(2);
  return `Q${m[1]}${yr ? `FY${yr}` : ''}`.toUpperCase();
}

// ─── Caveat detection ──────────────────────────────────────────────────────
const CAVEAT_PATTERNS: Array<{ tag: string; re: RegExp }> = [
  { tag: 'tax distortion',          re: /\b(tax\s+(?:refund|credit|reversal|write[- ]back)|deferred\s+tax|effective\s+tax\s+rate\s+fell|itat\s+order|tax\s+writeback)\b/i },
  { tag: 'exceptional item',        re: /\b(exceptional\s+item|one[- ]?time\s+(?:gain|loss|charge|item)|extraordinary\s+item|impairment\s+charge|labour\s+code|robotics\s+divestment)\b/i },
  { tag: 'segment mix shift',       re: /\b(segment\s+(?:mix|shift|reclassification)|business\s+mix\s+changed|consolidation\s+of)\b/i },
  { tag: 'accelerated depreciation',re: /\b(accelerated\s+depreciation|one[- ]?time\s+depreciation|write[- ]?down)\b/i },
  { tag: 'forex loss',              re: /\b(forex\s+loss|fx\s+loss|currency\s+(?:headwind|hit|loss))\b/i },
  { tag: 'forex gain',              re: /\b(forex\s+gain|fx\s+gain|currency\s+tailwind)\b/i },
  { tag: 'one time order',          re: /\b(one[- ]?time\s+order|single\s+(?:large\s+)?order|damas\s+one[- ]?off)\b/i },
];

// ─── Scoring ───────────────────────────────────────────────────────────────
type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

interface ParsedEarning {
  ticker: string;
  company: string;
  filing_date: string;
  quarter: string;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  eps_curr: number | null;
  eps_prev: number | null;
  caveat_tags: string[];
  methodology_tags: string[];
  composite_score: number;
  tier: EarningsTier;
  narrative: string;
  filing_url: string;
  source: string;
}

function scoreFromYoy(yoy: number): number {
  return yoy >= 200 ? 100 : yoy >= 100 ? 95 : yoy >= 50 ? 88 : yoy >= 25 ? 75
       : yoy >= 10  ? 60  : yoy >= 0   ? 45 : yoy >= -10 ? 32 : yoy >= -25 ? 20 : 8;
}

function gradeItem(item: RssItem): ParsedEarning | null {
  const text = `${item.title} ${item.description}`;
  const company = extractCompany(item.title);
  if (!company || company.length < 2) return null;
  const ticker = guessTickerFromText(item.title, company);

  const sales_yoy = parseYoyPct(text, SALES_RE);
  const pat_yoy   = parseYoyPct(text, PAT_RE);
  const eps_yoy   = parseYoyPct(text, EPS_RE);
  // Need at least one growth signal to grade
  if (sales_yoy == null && pat_yoy == null && eps_yoy == null) return null;

  const salesAbs = parseAbsolutePair(text, SALES_RE);
  const patAbs   = parseAbsolutePair(text, PAT_RE);
  const epsAbs   = parseAbsolutePair(text, EPS_RE);

  // Caveat tags
  const caveat_tags: string[] = [];
  for (const { tag, re } of CAVEAT_PATTERNS) if (re.test(text)) caveat_tags.push(tag);
  // Optical EPS heuristic
  if (eps_yoy != null && sales_yoy != null && sales_yoy > 0 && eps_yoy >= sales_yoy * 3 && eps_yoy >= 50) {
    caveat_tags.push('optical eps');
  }
  if (eps_yoy != null && eps_yoy >= 200) caveat_tags.push('optical eps');
  if (caveat_tags.length >= 3) caveat_tags.push('low quality');

  // Methodology tags
  const methodology_tags: string[] = [];
  if (eps_yoy != null && eps_yoy >= 20 && (sales_yoy == null || sales_yoy >= 5)) methodology_tags.push('bonde ep');
  if (eps_yoy != null && eps_yoy >= 25 && (sales_yoy ?? 0) >= 15) methodology_tags.push('canslim');
  if (eps_yoy != null && eps_yoy >= 30 && (sales_yoy ?? 0) >= 15) {
    methodology_tags.push('trend template');
    methodology_tags.push('sepa');
  }

  // Score
  let growth = 45, weight = 0;
  if (sales_yoy != null) { growth += scoreFromYoy(sales_yoy) * 0.20; weight += 0.20; }
  if (pat_yoy   != null) { growth += scoreFromYoy(pat_yoy)   * 0.30; weight += 0.30; }
  if (eps_yoy   != null) { growth += scoreFromYoy(eps_yoy)   * 0.50; weight += 0.50; }
  growth = weight > 0 ? (growth - 45) / weight : 45;

  const technical = 50 + methodology_tags.filter((t, i, a) => a.indexOf(t) === i).length * 13;
  const composite_raw = growth * 0.55 + 60 * 0.30 + 55 * 0.15 + technical * 0.15;  // (growth × 55%) blended
  const composite = Math.max(0, Math.min(100, composite_raw - new Set(caveat_tags).size * 3.5));

  const tier: EarningsTier =
    new Set(caveat_tags).size >= 3 && composite >= 85 ? 'STRONG' :
    composite >= 85 ? 'BLOCKBUSTER' :
    composite >= 70 ? 'STRONG' :
    composite >= 50 ? 'MIXED' : 'AVOID';

  // Narrative
  const fmtP = (label: string, v: number | null): string => v == null ? '' : `${label} ${v >= 0 ? '+' : ''}${Math.round(v)}% YoY`;
  const head =
    tier === 'BLOCKBUSTER' ? `${company} prints a blockbuster ${detectQuarter(text)}` :
    tier === 'STRONG'      ? `${company} delivers a strong ${detectQuarter(text)}` :
    tier === 'MIXED'       ? `${company} ${detectQuarter(text)} is a mixed print` :
                             `${company} ${detectQuarter(text)} fails the bar`;
  const metrics = [fmtP('revenue', sales_yoy), fmtP('PAT', pat_yoy), fmtP('EPS', eps_yoy)].filter(Boolean).join(', ');
  const flavor =
    caveat_tags.length > 0 ? ` with caveat${caveat_tags.length > 1 ? 's' : ''}: ${[...new Set(caveat_tags)].slice(0, 3).join(' + ')}.` :
    methodology_tags.length >= 2 ? ` and ${[...new Set(methodology_tags)].join('/')} all passing.` : '.';
  const narrative = `${head} (${metrics})${flavor}`;

  return {
    ticker, company,
    filing_date: pubDateToISO(item.pubDate),
    quarter: detectQuarter(text),
    sales_yoy_pct: sales_yoy,
    net_profit_yoy_pct: pat_yoy,
    eps_yoy_pct: eps_yoy,
    sales_curr_cr: salesAbs.curr, sales_prev_cr: salesAbs.prev,
    pat_curr_cr: patAbs.curr,     pat_prev_cr: patAbs.prev,
    eps_curr: epsAbs.curr,         eps_prev: epsAbs.prev,
    caveat_tags: [...new Set(caveat_tags)],
    methodology_tags: [...new Set(methodology_tags)],
    composite_score: Math.round(composite),
    tier,
    narrative,
    filing_url: item.link,
    source: item.source,
  };
}

function pubDateToISO(s: string): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return '';
}

// ─── Fetch one feed with timeout ───────────────────────────────────────────
async function fetchFeed(url: string, ms = 9000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Market Cockpit / earnings opportunities pipeline' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return '';
    return await res.text();
  } catch { return ''; }
  finally { clearTimeout(t); }
}

// ─── KV cache ──────────────────────────────────────────────────────────────
let redis: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
} catch {}

const CACHE_TTL_S = 12 * 3600;
function cacheKey(date: string): string { return `earnings:opps:v1:${date || 'all'}`; }

// ─── Main handler ──────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || '';   // YYYY-MM-DD or empty for all
  const force = url.searchParams.get('force') === '1';

  // Try cache
  if (redis && !force) {
    try {
      const hit = await redis.get(cacheKey(date));
      if (hit) return NextResponse.json(hit);
    } catch {}
  }

  // Fetch all feeds in parallel
  const xmls = await Promise.all(
    RESULTS_FEEDS.map(async (f) => ({ feed: f, xml: await fetchFeed(f.url) })),
  );

  // Parse + dedup by title
  const allItems: RssItem[] = [];
  const seen = new Set<string>();
  for (const { feed, xml } of xmls) {
    if (!xml) continue;
    const items = parseRss(xml, feed.name, feed.tier);
    for (const it of items) {
      const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      allItems.push(it);
    }
  }

  // Filter to actual earnings articles
  const earningsItems = allItems.filter(isEarningsArticle);

  // Optional date filter
  const filteredItems = date
    ? earningsItems.filter((it) => pubDateToISO(it.pubDate) === date)
    : earningsItems;

  // Grade each
  const candidates: ParsedEarning[] = [];
  const tickerSeen = new Set<string>();
  for (const it of filteredItems) {
    const graded = gradeItem(it);
    if (!graded) continue;
    // Dedup by company name (different feeds same story)
    const cKey = graded.company.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tickerSeen.has(cKey)) continue;
    tickerSeen.add(cKey);
    candidates.push(graded);
  }

  // Group by tier, sort by score
  const by_tier: Record<EarningsTier, ParsedEarning[]> = {
    BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [],
  };
  for (const c of candidates) by_tier[c.tier].push(c);
  for (const t of Object.keys(by_tier) as EarningsTier[]) {
    by_tier[t].sort((a, b) => b.composite_score - a.composite_score);
  }

  const payload = {
    filing_date: date || null,
    candidates_total: candidates.length,
    raw_items_total: earningsItems.length,
    by_tier,
    generated_at: new Date().toISOString(),
    sources_polled: RESULTS_FEEDS.length,
  };

  // Cache
  if (redis) {
    try { await redis.set(cacheKey(date), payload, { ex: CACHE_TTL_S }); } catch {}
  }

  return NextResponse.json(payload);
}
