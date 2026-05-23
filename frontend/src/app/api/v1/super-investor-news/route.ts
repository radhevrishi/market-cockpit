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

// PATCH 0484 — parsed stake-change "moves" extracted from headlines.
// We look for explicit "buys/adds/raises X% in Y" / "exits Y" / "trims Y"
// language and surface as institutional move chips above the news feed.
interface StakeMove {
  direction: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'UNKNOWN';
  ticker?: string;
  company?: string;
  stakePct?: number;       // new resulting stake
  stakeFromPct?: number;   // previous stake if "from X% to Y%"
  stakeDeltaPct?: number;  // explicit delta if "by N%"
  detail?: string;         // sentence with the stake change
  headline: string;
  url: string;
  source: string;
  publishedAt: string;
  // PATCH 0488 — institutional-grade signal hardening
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';  // HIGH=explicit stake; MED=add/trim word; LOW=commentary
  sourceType: 'BSE' | 'NEWS' | 'INTERVIEW' | 'TV' | 'OTHER';
  hashKey: string;          // dedupe key — same event from multiple sources collapses
  timeDecay: number;        // 0-1 exponential decay weighted by recency
  signalScore: number;      // composite confidence × decay × stake weight 0-100
}

interface ResponseShape {
  articles: NewsArticle[];
  moves: StakeMove[];     // PATCH 0484
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

// PATCH 0734 — defensive sanitizer for company names extracted from headlines.
// Returns the cleaned name, or '' (falsy) when the input was clearly garbage.
// The home Super Investors panel surfaces these directly, so anything that
// makes it through here ends up in front of the user.
function sanitizeCompanyName(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // 1) Strip "for Rs N crore / lakh" / "worth ₹N" / "at Rs N" tails that
  //    headline regex captures by accident. Run multiple times in case
  //    the tail repeats ("for Rs 216 crore at 145 per share").
  s = s.replace(/\s+(?:for|worth|at|of|paying|@)\s+(?:rs\.?|inr|₹|\$)\s*[\d,.]+(?:\s*(?:crore|cr|lakh|lac|million|mn|billion|bn))?\b.*/i, '');
  s = s.replace(/\s+(?:for|worth|at)\s+[\d,.]+\s*(?:crore|cr|lakh|lac|million|mn|billion|bn)\b.*/i, '');

  // 2) Strip source-attribution suffixes like " - Moneycontrol.com" /
  //    " | Bloomberg" / " — Economic Times" / " (Reuters)". Most public
  //    news pubs append their domain or name with a delimiter.
  s = s.replace(/\s*[-–—|·]\s*(?:moneycontrol|et\s*markets|economic\s*times|livemint|mint|business\s*standard|ndtv|cnbc|bloomberg|reuters|trendlyne|equitymaster|business\s*today)(?:\.\w+)?\b.*/i, '');
  // Bare ".com / .in" domain hint at the end → strip last word.
  s = s.replace(/\s+\S*\.(?:com|in|net|org|co)\b.*/i, '');

  // 3) Strip trailing pricing / quantity / share-count phrases.
  s = s.replace(/\s+(?:shares?|stake|stocks?|holding|holdings|positions?|portfolio|units?)\s*$/i, '');
  s = s.replace(/\s+(?:Q[1-4]\s*FY\d{2,4}|H[12]\s*FY\d{2,4}|FY\d{2,4}).*$/i, '');

  // 4) Strip leading prepositions / verbs that may sneak in.
  s = s.replace(/^(?:in|the|by|via|from|on)\s+/i, '');

  // 5) Drop trailing punctuation noise.
  s = s.replace(/[\s\-–—|.,;:]+$/g, '').trim();

  // 6) Final validation — reject if too short, too long, contains URL hints,
  //    contains digits at the END (likely a fragment), or contains delimiter
  //    chars that aren't found in real company names.
  if (s.length < 3 || s.length > 40) return '';
  if (/^(?:Rs\.?|INR|USD|EUR|₹|\$)/i.test(s)) return '';
  if (/\b(?:http|www|\.com|\.in|\.net)\b/i.test(s)) return '';
  if (/\b(?:per\s*share|crore|lakh|billion|million)\b/i.test(s)) return '';
  if (/\b(?:first\s*time|now\s*holds|raises\s*stake|cuts\s*stake|exits|enters)\b/i.test(s)) return '';
  if (!/^[A-Za-z]/.test(s)) return '';  // must start with a letter
  return s;
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

// ── PATCH 0485 — context-aware stake-move extractor ──────────────────────
// V1 (0484) blindly grabbed the first "%" in the headline. That mis-fired
// when a headline mixed price-action language with stake language:
//   "FMCG Stock Hits 20% Upper Circuit After Kacholia Increases Stake"
//   ^ "20%" is the price circuit, NOT the stake change.
// This V2 (a) rejects pct candidates whose context word is price-action
// ("upper circuit", "rally", "gain", "surge", "jump", "rise", etc.),
// (b) ALSO scans the article snippet (description text) for "from X% to
// Y%" patterns, and (c) returns from→to so the move card can render the
// before / after stake without the user needing to click through.

// Words that, when within 6 tokens of a "%", mark that % as a price move
// rather than a stake change — used to FILTER OUT false positives.
const PRICE_NOISE_CONTEXT = new RegExp(
  '\\b(upper\\s*circuit|lower\\s*circuit|circuit|rally|rallies|rallied|surged?|jumps?|jumped|' +
  'rises?|rose|falls?|fell|gains?|gained|losses?|lost|drops?|dropped|crashed?|plunged?|' +
  'soared|skyrocketed|breakout|return|returns?|advanced?|gained?|spiked?|up|down|higher|lower|' +
  'discount|premium|yield|coupon|growth|cagr|margin|profit|sales|revenue|q[1-4]|fy\\d{2,4})\\b',
  'i'
);

// Try to extract a stake number near a stake-language anchor. Returns
// { resulting, from, delta } if anything found. "Resulting" = the new
// stake after the move ("now holds X%" / "to Y%" / bare "X% stake").
function extractStakePcts(text: string): { resulting?: number; from?: number; delta?: number } | null {
  if (!text) return null;
  const out: { resulting?: number; from?: number; delta?: number } = {};

  // 1. from X% to Y% — both before and after stake captured.
  const fromTo = text.match(/from\s+(\d+(?:\.\d+)?)\s*%\s+to\s+(\d+(?:\.\d+)?)\s*%/i);
  if (fromTo) {
    const a = parseFloat(fromTo[1]);
    const b = parseFloat(fromTo[2]);
    if (a > 0 && a <= 60) out.from = a;
    if (b > 0 && b <= 60) out.resulting = b;
    if (a > 0 && b > 0) out.delta = Math.round((b - a) * 100) / 100;
    return out;
  }

  // 2. "by N%" — explicit delta language.
  const byDelta = text.match(/(?:rais(?:ed|es|ing)|increas(?:ed|es|ing)|hike[ds]?|add(?:ed|s|ing)|cut[s]?|trim(?:med|s|ming)|reduc(?:ed|es|ing))\s+(?:his|her|their)?\s*stake\s+by\s+(\d+(?:\.\d+)?)\s*(?:%|percent|per\s*cent|percentage\s*points?|pp|bps?)/i);
  if (byDelta) {
    const d = parseFloat(byDelta[1]);
    if (d > 0 && d <= 30) out.delta = d;
  }

  // 3. "holds X%" / "stake at X%" / "X% stake" — the new resulting stake,
  //    but only when explicitly tied to stake/holding/shareholding language.
  const stakeAt = text.match(
    /(?:holds?|holding|now\s+holds?|stake(?:\s+now)?\s+(?:at|of|to|stands?\s+at)|raised?\s+(?:his|her|their)\s+stake\s+to|increased?\s+(?:his|her|their)\s+stake\s+to)\s*(\d+(?:\.\d+)?)\s*(?:%|percent|per\s*cent)/i,
  );
  if (stakeAt) {
    const v = parseFloat(stakeAt[1]);
    if (v > 0 && v <= 60 && out.resulting === undefined) out.resulting = v;
  }

  // 4. Bare "X% stake / X% shareholding / X% holding" — strict pattern,
  //    requires the noun "stake / holding / shareholding" immediately after.
  if (out.resulting === undefined) {
    const bareStake = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|per\s*cent)\s+(?:stake|holding|shareholding)/i);
    if (bareStake) {
      const v = parseFloat(bareStake[1]);
      if (v > 0 && v <= 60) out.resulting = v;
    }
  }

  if (out.resulting === undefined && out.from === undefined && out.delta === undefined) return null;
  return out;
}

// Pull the sentence that contains the stake-change reference for display.
function extractDetailSentence(text: string): string | undefined {
  if (!text) return undefined;
  // Split by sentence-ish boundaries and pick the one mentioning stake / holding / shareholding.
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    if (/\b(stake|holding|shareholding|stake)\b/i.test(s)) {
      const trimmed = s.trim();
      if (trimmed.length > 8 && trimmed.length < 360) return trimmed;
    }
  }
  return undefined;
}

function extractMove(article: NewsArticle, investorName: string): StakeMove | null {
  const headline = article.title.trim();
  if (!headline) return null;
  const snippet = (article.snippet || '').trim();
  const combined = `${headline} ${snippet}`;
  const lcCombined = combined.toLowerCase();

  // Direction classifier — order matters (exit before trim before add/buy).
  let direction: StakeMove['direction'] = 'UNKNOWN';
  if (/\bexit(s|ed|ing)?\b|\bsold off\b|\boff\-?loads?\b|\bpares stake to zero\b/i.test(lcCombined)) direction = 'EXIT';
  else if (/\btrims?\b|\bcuts? stake\b|\breduces? stake\b|\bsells?\s+stake\b/i.test(lcCombined)) direction = 'TRIM';
  else if (/\badds?\s+(?:to\s+)?stake\b|\braises? stake\b|\bincreases?\s+(?:his|her|their)?\s*stake\b|\bhikes?\s+stake\b|\badd(?:s|ed|ing)?\b\s+\d+\s*%/i.test(lcCombined)) direction = 'ADD';
  else if (/\bbuys?\s+stake\b|\bpicks? up\b|\bacquires?\s+stake\b|\bnew (entry|position|stake)\b|\bnew\s+\d+\.?\d*\s*%\s*stake\b/i.test(lcCombined)) direction = 'BUY';

  if (direction === 'UNKNOWN') return null;

  // PATCH 0485 — try snippet FIRST (richer source), then headline.
  let stakes = extractStakePcts(snippet);
  if (!stakes) stakes = extractStakePcts(headline);

  // Last resort: bare % in headline, but ONLY if context isn't a price move.
  if (!stakes) {
    const pctMatches = [...headline.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent|per\s*cent)/gi)];
    for (const pm of pctMatches) {
      const v = parseFloat(pm[1]);
      if (isNaN(v) || v <= 0 || v > 30) continue;
      // Look at the surrounding words (50 chars window) for noise context.
      const idx = pm.index || 0;
      const window = headline.slice(Math.max(0, idx - 40), idx + 40);
      if (PRICE_NOISE_CONTEXT.test(window)) continue; // skip — it's a price move
      // Require stake-related anchor word nearby.
      if (!/\b(stake|holding|shareholding)\b/i.test(window)) continue;
      stakes = { resulting: v };
      break;
    }
  }

  // Company name — try snippet "in <COMPANY>" first (often cleaner) then headline.
  // PATCH 0734 — tighten capture window from {2,60} to {2,40} and add
  // multi-stage stripping so headline garbage like "in Nazara for Rs 216 crore"
  // or "in TV Today Network - Moneycontrol.com" doesn't leak through as the
  // company name. The user saw rows on the Home dashboard like:
  //   - "Nazara for Rs 216 crore"   ← "for Rs N crore" tail not stripped
  //   - "TV Today Network - Moneycontrol.com"  ← source attribution leaked
  //   - "Sammaan CaSammaan Capital" ← ticker label + duplicate company
  let company: string | undefined;
  const inSnippet = snippet.match(/\bin\s+([A-Z][A-Za-z0-9 \-&.()]{2,40}?)(?:\s+(?:Limited|Ltd|Pvt|Private|Corp(?:oration)?))?\b/);
  if (inSnippet) company = inSnippet[1].trim();
  if (!company) {
    const inMatch = headline.match(/\bin\s+([A-Z][A-Za-z0-9 \-&.()]{2,40})(?:[.,;]|$)/);
    if (inMatch) company = inMatch[1].trim();
  }
  if (company) {
    company = sanitizeCompanyName(company);
    if (!company) return null;  // sanitizer rejected it as garbage
  }

  // Skip when we found NOTHING actionable.
  if (!company && !stakes) return null;

  const detail = extractDetailSentence(snippet) || extractDetailSentence(headline);

  // PATCH 0488 — confidence + sourceType + dedupe hash + temporal decay.
  // HIGH: explicit stake disclosed in snippet ("from 3.8% to 4.3%" / "now holds 4.3%")
  // MEDIUM: directional verb without numeric stake (adds / trims / exits)
  // LOW: commentary headline only (no stake noun, no explicit direction parsed)
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (stakes && (stakes.resulting != null || stakes.from != null || stakes.delta != null)) {
    confidence = 'HIGH';
  } else if (direction === 'EXIT' || direction === 'TRIM' || direction === 'ADD' || direction === 'BUY') {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }
  // Filter: refuse to surface bare commentary (e.g. "Kacholia bullish on EMS")
  // as a move. We need at least a directional verb.
  if (confidence === 'LOW') return null;

  // Source-type — coarse classify the publisher.
  const srcLc = (article.source || '').toLowerCase();
  let sourceType: 'BSE' | 'NEWS' | 'INTERVIEW' | 'TV' | 'OTHER' = 'NEWS';
  if (/(bse|nse|sebi|regulator|filing|announce)/.test(srcLc) || /(filing|disclosure)/.test(lcCombined)) sourceType = 'BSE';
  else if (/(interview|podcast|fireside|q&a|youtube)/.test(lcCombined) || /(et now|cnbc|bloomberg|moneycontrol)/.test(srcLc)) sourceType = 'INTERVIEW';
  else if (/(tv|et now|cnbc|bloomberg)/.test(srcLc)) sourceType = 'TV';

  // Dedupe hash — same (investor + company + direction + day) collapses
  // identical events syndicated across Google / Moneycontrol / ET / Trendlyne.
  const day = (article.publishedAt || '').slice(0, 10);
  const companyKey = (company || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  const stakeKey = stakes?.resulting != null ? `r${stakes.resulting.toFixed(1)}`
    : stakes?.delta != null ? `d${stakes.delta.toFixed(1)}`
    : '';
  const hashKey = `${investorName.toLowerCase().replace(/\s+/g, '_')}|${companyKey}|${direction}|${stakeKey}|${day}`;

  // Temporal decay: half-life of 7 days for "live" relevance.
  const pubMs = new Date(article.publishedAt || Date.now()).getTime();
  const daysAgo = Math.max(0, (Date.now() - pubMs) / 86_400_000);
  const timeDecay = Math.exp(-daysAgo / 7);  // 1.0 today → 0.37 at 7d → 0.05 at 21d

  // Composite signal score (0-100)
  const confFactor = confidence === 'HIGH' ? 1.0 : confidence === 'MEDIUM' ? 0.65 : 0.3;
  const stakeFactor = stakes?.resulting != null
    ? Math.min(1, stakes.resulting / 5)
    : stakes?.delta != null ? Math.min(1, Math.abs(stakes.delta) / 2) : 0.3;
  const signalScore = Math.round(confFactor * (0.6 + 0.4 * stakeFactor) * timeDecay * 100);

  return {
    direction,
    company,
    stakePct: stakes?.resulting,
    stakeFromPct: stakes?.from,
    stakeDeltaPct: stakes?.delta,
    detail,
    headline,
    url: article.url,
    source: article.source,
    publishedAt: article.publishedAt,
    confidence,
    sourceType,
    hashKey,
    timeDecay: Math.round(timeDecay * 100) / 100,
    signalScore,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────
export async function GET(request: Request): Promise<NextResponse<ResponseShape>> {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('query') || '').trim();
  if (!query) {
    return NextResponse.json({ articles: [], moves: [], sources: [], cached: false, query: '' });
  }

  const cacheKey = `super-investor-news:v1:${query.toLowerCase().replace(/\s+/g, '_')}`;
  try {
    // PATCH 0730 — 5min → 30min validity. Vercel observability shows this
    // route is the single biggest CPU drain (493 calls / 12h). Stake
    // disclosures are quarterly events — '5-min live feel' was wasteful.
    // Each cache miss does 4 RSS fetches (Google News + Moneycontrol +
    // ET + Trendlyne). 30min cache cuts fetch frequency 6× without
    // hurting user-facing data quality.
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

  // PATCH 0484 — extract stake-change moves from headlines.
  const investorName = query.split(/\s+(?:portfolio|holdings|stake|Carnelian|Old|Marcellus|MK|Screener|Equity|Wealth)/i)[0].trim();
  const rawMoves: StakeMove[] = [];
  for (const a of merged) {
    const move = extractMove(a, investorName);
    if (move) rawMoves.push(move);
  }
  // PATCH 0488 — DEDUPE by hashKey. When Moneycontrol + ET + Trendlyne
  // syndicate the same event we keep one, prefer the higher-confidence /
  // higher-signal copy and the most authoritative source.
  const byHash = new Map<string, StakeMove>();
  for (const m of rawMoves) {
    const existing = byHash.get(m.hashKey);
    if (!existing) { byHash.set(m.hashKey, m); continue; }
    // Higher confidence wins; if tied, higher signalScore wins.
    const confRank = (c: StakeMove['confidence']) => c === 'HIGH' ? 2 : c === 'MEDIUM' ? 1 : 0;
    if (confRank(m.confidence) > confRank(existing.confidence) ||
        (confRank(m.confidence) === confRank(existing.confidence) && m.signalScore > existing.signalScore)) {
      byHash.set(m.hashKey, m);
    }
  }
  const moves = Array.from(byHash.values())
    // Sort by signalScore desc — strongest, freshest signal first.
    .sort((a, b) => b.signalScore - a.signalScore);

  const payload: ResponseShape = {
    articles: merged.slice(0, 40),
    moves: moves.slice(0, 12),
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
    // PATCH 0730 — KV TTL 15min → 60min to match the new 30min validity
    // window. Total CPU savings on this route ~6× since it's the single
    // biggest per-call consumer (493 invocations / 12h per Vercel obs).
    await kvSet(cacheKey, { ...payload, _ts: Date.now() }, 60 * 60);
  } catch (err) {
    console.warn('[super-investor-news] KV SET failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json(payload);
}
