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
import { kvGet, kvSet } from '@/lib/kv';
// PATCH 0105: event intelligence pipeline (canonical events + scoring + tradability)
import {
  extractEventSignals,
  canonicalEventId,
  scoreCatalyst,
  classifyTradability,
  whyTradable,
  inferLifecycleStage,
  type EventType,
  type LifecycleStage,
  type CatalystScore,
} from '@/lib/news/event-intelligence';
// PATCH 0431 — Institutional taxonomy: rights/PIPE/NCLT/index/governance/etc
import {
  classifyExtendedEvent,
  isInstitutionalNoise,
  computeCoverageDiagnostic,
  EVENT_PRIORS,
  type ExtendedEventType,
  type CoverageBucket,
} from '@/lib/specsit-institutional';

import {
  classifyForm10, contentHints, createEventClusterer, decodeHtmlEntities, extractSubjectTickers, identifySubject, isNonEventContent, countCanonicalEventTypes,
  parseSecFilingTitle, summariseHeldBack, type FeedQuarantineReason,
} from '@/lib/special-sit-feed-quality';
import { assembleGatedFeed, dedupeFeedEvents, splitRadarInputs } from '@/lib/multibagger-radar-adapter';
import { buildRadarQa } from '@/lib/special-sit-qa';
import { createSecLookupLoader } from '@/lib/special-sit-entity';
import { classifyFeedHoldBack, dealRolesFor, secFilingInfoFor, secRowsFromCikTickerMap } from '@/lib/special-sit-security';
import { gateSpecialSituations, aiVerificationOf } from '@/lib/ai-verify';
import { isSpecSitPrimaryVerified } from '@/lib/ai-verify-gate';

// zzz852: read-only SEC ticker map from an existing KV cache (6h memory cache). zzz854: when no KV key holds the map, fall back
// to the shared us-edgar CIK -> ticker map (one SEC download per day, shared with every caller), capped at 8s so the feed never
// waits on SEC. A failure leaves the lookup null and entities say 'SEC ticker map not loaded' (never a silent 'No ticker').
const loadSecLookup = createSecLookupLoader((k) => kvGet(k), undefined, undefined, undefined, async () => {
  const { cikTickerMap } = await import('@/lib/us-edgar');
  const map = await Promise.race([cikTickerMap(), new Promise<null>((res) => setTimeout(() => res(null), 8_000))]);
  return secRowsFromCikTickerMap(map);
});
const safeSecLookup = () => loadSecLookup().catch(() => null);
// Coverage bucket for an event type, from the institutional coverage definitions (one source of truth for both raw and shown).
const COVERAGE_DEFS = computeCoverageDiagnostic({});
const coverageBucketOf = (et: string): string => COVERAGE_DEFS.find((b) => (b.event_types as string[]).includes(et))?.bucket || 'Other';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH 0103: rolling 90-day KV cache so classified items persist across pulls
// (RSS feeds only carry 1-3 days of headlines; Vedanta-class events from
// weeks ago fall off the live RSS but should still be visible).
// PATCH 0432 — reverted to v2. Patch 0431's v3 bump wiped 90 days of
// rolling history (Vedanta demerger and other historical events disappeared).
// The new taxonomy + noise filter run at read time on every request, so
// they auto-apply to cached events anyway — bumping the key was unnecessary.
const ROLLING_KEY = 'special-situations:rolling:v2';
const ROLLING_TTL_SECONDS = 95 * 86400;
const ROLLING_RETAIN_DAYS = 90;

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
  // PATCH 0103: Indian sector-specific feeds with corporate-action heavy coverage
  { name: 'Capital Market',    url: 'https://www.capitalmarket.com/rss/news.xml',                                       region: 'IN' },
  { name: 'BL Companies',      url: 'https://www.thehindubusinessline.com/companies/feeder/default.rss',                region: 'IN' },
  { name: 'BL Markets',        url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss',                  region: 'IN' },
  { name: 'Financial Express', url: 'https://www.financialexpress.com/feed/',                                           region: 'IN' },
  // US — corporate-action heavy
  { name: 'MarketWatch Top',   url: 'https://feeds.marketwatch.com/marketwatch/topstories/',                           region: 'US' },
  { name: 'MarketWatch Mkts',  url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/',                          region: 'US' },
  { name: 'SeekingAlpha News', url: 'https://seekingalpha.com/market_currents.xml',                                    region: 'US' },
  { name: 'CNBC Top',          url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', region: 'US' },
  { name: 'CNBC Finance',      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',  region: 'US' },
  { name: 'CNBC Earnings',     url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135',  region: 'US' },
  // PATCH 0100c: SEC EDGAR — narrow to forms whose TITLE alone identifies the action.
  // 8-K dropped (too noisy — title doesn't say what the filing is about; most are
  // routine items 1.01/2.02/5.02 not M&A).  Kept the spin-off + tender-offer forms.
  { name: 'SEC Form 10-12B',  url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-12B&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  { name: 'SEC Form 10-12G',  url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-12G&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  { name: 'SEC SC 14D-9',     url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+14D-9&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  { name: 'SEC SC TO-T',      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+TO-T&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  { name: 'SEC SC TO-I',      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+TO-I&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  { name: 'SEC SC 13E-3',     url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+13E3&company=&dateb=&owner=include&count=40&output=atom', region: 'US' },
  // Global / wires
  { name: 'Yahoo Finance',     url: 'https://finance.yahoo.com/news/rssindex',                                          region: 'GLOBAL' },
  // PATCH 0432 — Indian legal / regulatory feeds for NCLT/IBC/SEBI coverage.
  // These directly feed the NCLT_IBC_ADMISSION/RESOLUTION + SEBI_REGULATORY_
  // ACTION buckets that were sitting at zero. Each carries the institutional
  // class of headlines our generic business-press sources rarely surface.
  { name: 'Bar & Bench Corp',  url: 'https://www.barandbench.com/feeds/corporate.rss',                                   region: 'IN' },
  { name: 'Live Law Corp',     url: 'https://www.livelaw.in/news/corporate.rss',                                         region: 'IN' },
  { name: 'IBC Laws',          url: 'https://ibclaw.in/feed/',                                                            region: 'IN' },
];

// ─── Patterns ───────────────────────────────────────────────────────────────
// Tuned wider than the page-side regex so we catch more candidates.  REJECT
// patterns kill rumour / negation noise.

// PATCH 0532 — Added CAPEX (Capacity Expansion / New Ventures) and CONCALL
// (First Presentation / Concall). User's institutional event list also
// includes pure capacity-expansion announcements (new manufacturing
// facility, capex commitment, fresh foray into a market/business) and
// first-time investor presentations / concalls. Previously these slipped
// through the SPIN/MA/TURN/CAP cracks and never appeared.
type Category = 'SPIN' | 'MA' | 'TURN' | 'CAP' | 'CAPEX' | 'CONCALL';

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
    // PATCH 0103: catches Indian holdco patterns ('plan IPO for subsidiary',
    // 'to list X arm/unit/division', '6k-crore IPO for X' style) which the
    // earlier patterns missed. NTPC/IndianOil/Coal India IPO-ing Hindustan
    // Urvarak is a spin-off pattern; Cipla pharma split, ITC hotels demerger,
    // Reliance Capital insurance demerger all use these phrasings.
    pattern: /\b(spin.?off|spinoff|spun.?off|spinning off|demerg(?:e[rd]?|ing)|de.?merger|carve.?out|carved out|carving out|split.?off|hive.?off|hive[ -]off|10-12[BG](?:\/A)?\b|form\s*10(?:-12[BG])?\b|tax.?free distribution|business separation|breakup|break.?up\s+plan|separate (?:the|its) (?:business|division|segment|unit|operations)|to spin (?:off|out)|approves? (?:demerger|spin.?off|de-?merger|separation)|creates? (?:independent|separate|new) (?:company|entity|listed)|split into (?:two|three|four)|two separate companies|independent (?:public )?company|to be (?:demerged|separated|split)|sebi (?:demerger|spin)|nclt (?:approves|sanctions) (?:demerger|scheme of arrangement)|scheme of arrangement|business reorganis(?:e|ation)|listing of (?:the )?(?:demerged|spin)|ipo (?:of|for) (?:its|the)?\s*(?:subsidiary|arm|unit|division|business|venture|jv|joint venture|spin)|plan\s+(?:rs\.?\s*[\d,]+\s*(?:crore|cr|lakh\s*crore)\s*)?ipo (?:of|for)\s+\w+|to list (?:its|the)?\s*(?:subsidiary|arm|unit|division|business)|list\s+(?:its|the)?\s*\w+\s+(?:arm|unit|division|business|subsidiary)|(?:subsidiary|arm|unit|division)\s+ipo|listing approval|sebi clears (?:demerger|spin|scheme)|\binitial\s+listing\b|reverse\s+merger)\b/i,
  },
  {
    id: 'MA',
    label: 'M&A / Open Offers / Takeovers',
    // PATCH 0100c: catch SEC tender-offer schedules (SC 14D-9 / SC TO-T / SC TO-I / SC 13E-3)
    // by their form codes directly.
    pattern: /\b(open offer|takeover bid|tender offer|hostile (?:bid|offer)|acquir(?:e|ed|es|ing)|acquisition|merger|merge with|merger agreement|all.?cash deal|all.?stock deal|strategic acquisition|control change|change of control|controlling stake|substantial acquisition|buyout offer|to (?:buy|acquire)\s+[A-Z]|deal worth|stake (?:sale|acquisition)|to sell (?:business|unit|division|stake)|sells (?:its|business|unit|division|stake)|cci approves?|definitive agreement|definitive merger|SC[\s-]?14D-?9|SC[\s-]?TO-[TI]|SC[\s-]?13E-?3)\b/i,
    reject: /\b(rumou?r(?:ed|s)?|may consider|reportedly weighing|in talks (?:to|with)|exploring|denied|reject(?:ed)?\s+(?:the\s+)?offer|terminated|called off|withdr(?:ew|awn)|antitrust block|deal collapse)\b/i,
  },
  {
    id: 'TURN',
    label: 'Turnarounds',
    // PATCH 0447 BUG-054 — Broadened regex. Added NCLT/IBC + asset-sale-for-
    // debt-repair + improvement-after-stress phrasings the user reported
    // missing. Catches India-style 'one-time settlement', 'OTS', NPA
    // recovery, fresh capital infusion when paired with deleverage.
    pattern: /\b(turnaround|turn.?around|back to profit|back in (?:the )?black|swung to profit|swing to profit|loss to profit|profit revival|first profit (?:after|since)|exits losses|debt restructur|balance sheet repair|debt reduction|debt prepay|deleverag|recapitalis|operational restructur|cost cutting yields|return to profit|profit after years|profit after \w+ losses|narrowed (?:loss|losses)|narrowing loss(?:es)?|first profitable (?:quarter|year)|ebitda positive|operating profit (?:after|first)|black (?:after|since)|profitable (?:after|since) \w+ (?:years|quarters)|recovers? from loss|emerges? from (?:bankruptcy|restructur|losses)|debt resolution|cdr exit|sdr exit|insolvency exit|nclt|ibc[\s_-]?(?:admission|resolution|proceedings)|insolvency (?:proceedings|petition|admitted)|one[\s-]?time settlement|\bots[\s-]?(?:approved|settlement)|npa\s+recovery|asset\s+monetisation|debt[\s-]?for[\s-]?equity\s+swap|promoter\s+infus(?:e|ion)|fresh\s+capital\s+infusion|stake\s+sale\s+for\s+debt|debt\s+repayment|cleanup\s+(?:balance sheet|finances)|recoveries?\s+from\s+npa)\b/i,
    reject: /\b(failed turnaround|turnaround unlikely|fall(?:s|ing|en)?\s+back into loss|swung to loss|return to loss|loss widens|widening loss|loss expands)\b/i,
  },
  {
    id: 'CAP',
    label: 'Capital Allocation (Buybacks / Dividends / Fund Raising)',
    // PATCH 0532 — broadened with explicit NCD / debenture / warrant /
    // FCCB / OFS phrasings so fund-raising announcements (NCDs, warrants
    // conversion, OFS, preference issues) get bucketed here instead of
    // falling through unclassified.
    pattern: /\b(buyback|share repurchase|repurchas(?:e|ed|ing)\s+shares|repurchase program|tender for own shares|special dividend|interim dividend|bonus issue|capital return|return of capital|debt prepay|treasury shares|reduction of share capital|capital reduction|dividend hike|dividend increase|raise(?:s|d)?\s+dividend|hikes? dividend|stock split|share split|board approves dividend|board recommends dividend|qip\b|qualified institutional placement|preferential (?:allotment|issue)|rights issue|rights offer|non[\s-]?convertible debentures?|\bncd\b|ncds\b|debenture\s+issu(?:e|ance)|fccb\b|foreign currency convertible bonds?|warrant(?:s|\s+conversion|\s+issu(?:e|ance))?|ofs\b|offer for sale|secondary offering|via\s+(?:qip|ncds?|preference|preferential|rights|warrants|debentures?|ofs|fccb)|raises?\s+(?:rs\.?\s*)?[\d,]+\s*(?:cr|crore|crores?|lakh\s*crore)\s+via|raises?\s+(?:funds|capital|equity)\s+via)\b/i,
    reject: /\b(buyback program ended|cancel(?:led|s)?\s+(?:the\s+)?buyback|denied buyback|paused\s+(?:the\s+)?buyback|dividend (?:cut|reduced|suspended)|skip dividend|forgoes dividend)\b/i,
  },
  // PATCH 0532 — Capacity Expansion / New Ventures.
  // User's institutional event list includes "Company X to set up a new
  // <X> manufacturing facility", "X commences production at new unit",
  // "X to invest <Y> crore towards <facility>", "X forays into <new
  // segment>", "X expands capacity from N to M TPD", "X signs a new
  // property in <city>", "X launches a new <residential/commercial>
  // project". These slipped past SPIN/MA/TURN/CAP entirely.
  {
    id: 'CAPEX',
    label: 'Capacity Expansion / New Ventures',
    pattern: /\b(?:set\s+up|sets\s+up|setting\s+up|commission(?:s|ed|ing)?|commences?\s+production|inaugurat(?:e|es|ed|ion)|expand(?:s|ed|ing)?\s+(?:its\s+|the\s+)?(?:capacity|production|manufacturing|facility|footprint)|increase(?:s|d)?\s+(?:its\s+)?(?:capacity|production)|capacity\s+expansion|new\s+(?:manufacturing|production|cement|steel|sugar|chemical|plant|unit|facility|line|capacity|venture|business|property|hotel|project|order|order\s+book)|greenfield\s+(?:plant|facility|capacity|investment|project)|brownfield\s+expansion|to\s+invest\s+(?:rs\.?\s*)?[\d,]+\s*(?:cr|crore|crores?|lakh\s*crore|million|bn|billion)\s+(?:towards|in|to\s+(?:set\s+up|build|expand))|forays?\s+into|foray\s+into\s+(?:new|the)|enter(?:s|ed|ing)?\s+(?:into\s+)?(?:new|the)\s+(?:market|business|segment|sector)|launch(?:es|ed|ing)?\s+(?:a\s+)?new\s+(?:hotel|property|project|business|brand|residential|commercial|venture|plant|capacity|product\s+line|division)|signs?\s+(?:a\s+)?new\s+(?:hotel|property|deal|jv|joint\s+venture)|to\s+set\s+up\s+a\s+new|new\s+jv|joint\s+venture|leases?\s+a\s+new\s+(?:manufacturing|production|facility|unit)|new\s+(?:phase|line)\s+(?:of\s+)?(?:production|capacity)|capex\s+(?:of|plan|programme|towards)|spend\s+(?:rs\.?\s*)?[\d,]+\s*(?:cr|crore)\s+(?:towards|on)|increase(?:s|d)?\s+(?:starch|cement|sugar|steel|paper|polymer|capacity)\s+(?:from|to)\s+[\d,]+|secures?\s+(?:govt\s+)?approval\s+to\s+commence)\b/i,
    reject: /\b(delay(?:s|ed|ing)?\s+(?:the\s+)?(?:capex|expansion|capacity|project)|shelv(?:e|ed|es)\s+(?:the\s+)?(?:capex|expansion|project)|defer(?:s|red)\s+(?:the\s+)?capex|cancels?\s+(?:the\s+)?(?:project|expansion|capex)|put\s+on\s+hold|withdraws?\s+(?:from|the)\s+(?:project|venture)|exits?\s+(?:the\s+)?(?:business|market|venture))\b/i,
  },
  // PATCH 0532 — First Presentation / Concall.
  // Investor concalls + first presentations after IPO are
  // institutional-grade triggers (first formal management guidance,
  // sell-side coverage initiation, fresh disclosure of operating data).
  // The screenshot row "First Presentation - Hester Biosciences" /
  // "First Concall - KRM Ayurveda" / "First Concall - Pajson Agro" maps
  // directly here.
  {
    id: 'CONCALL',
    label: 'First Presentation / Concall',
    pattern: /\b(first\s+(?:investor\s+)?(?:presentation|concall|conference\s+call|earnings\s+call)|maiden\s+(?:investor\s+)?(?:presentation|concall|conference\s+call)|(?:investor|analyst)\s+(?:meet|presentation|day)|debut\s+(?:investor\s+)?(?:presentation|concall)|inaugural\s+(?:concall|conference\s+call|investor\s+presentation)|post[\s-]?ipo\s+(?:concall|presentation)|conference\s+call\s+(?:transcript|recording)|earnings\s+call\s+transcript|q\d\s+(?:concall|conference\s+call|investor\s+presentation)|management\s+meet|sell[\s-]?side\s+(?:initiation|coverage)|coverage\s+initiat(?:ed|ion)|analyst\s+initiat(?:es|ion|ed))\b/i,
    reject: /\b(skipped\s+(?:the\s+)?(?:concall|conference\s+call)|cancel(?:s|led)?\s+(?:the\s+)?(?:concall|conference|presentation)|postpon(?:e|ed)\s+(?:the\s+)?(?:concall|conference|presentation))\b/i,
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
//
// PATCH 0454 P1-24 — Audit found this module-level `CACHE` only existed
// within a single Vercel container. Cold starts re-fetched all RSS sources
// (slow + rate-limit-prone). Now layered: KV is the cross-container source
// of truth, the in-memory variable is just a warm-path optimization.

import { kvGet as ssKvGet, kvSet as ssKvSet, isRedisAvailable as ssRedisAvailable } from '@/lib/kv';

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_KV_KEY = 'specsit:feed:v1';
const CACHE_KV_TTL_S = Math.round(CACHE_TTL_MS / 1000);
let CACHE: { data: any; ts: number } | null = null;

// ─── XML parsing ────────────────────────────────────────────────────────────
// Lightweight regex-based parser — RSS/Atom feeds expose flat <item> blocks
// (or <entry> for Atom). We don't need DOM-level fidelity.

function decodeXmlEntities(s: string): string {
  // zzz847: one central decoder (named + decimal + hex entities, e.g. &#x20B1; and &#8377;).
  return decodeHtmlEntities(s);
}

function stripCdataAndHtml(s: string): string {
  let r = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')                  // strip inline HTML
    .replace(/\s+/g, ' ')
    .trim();
  // PATCH 1057: residual CDATA wrappers leaked into link/title strings (the
  // "<![CDATA[https://..." that appeared in the Antares/Urenco HALEUC row).
  // If the result still has angle/square brackets in something that looks like
  // a URL, strip them — they came from nested CDATA markers, not real syntax.
  if (r.startsWith('http') && /[<>\[\]]/.test(r)) {
    r = r.replace(/[<>\[\]]/g, '');
  }
  return decodeHtmlEntities(r);
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
  // PATCH 0164: known FALSE-POSITIVE investor / fund / regulator / generic-word tokens
  'XV','SEQUOIA','PEAK','BLACKROCK','KKR','TPG','BLACKSTONE','GIC','ADIA','SOFTBANK',
  'AIF','ETF','REIT','FII','DII','SIP','SWP','STP',
  'BUYBACK','TENDER','OFFER','OPEN','PUBLIC','MERGER','DEMERGER','SPIN-OFF','ACQUISITION',
  'DEAL','STAKE','SHARE','SHARES','EQUITY','FLOOR','PRICE','RECORD','EX-DATE',
  'BUZZING','STOCKS','RALLY','SURGE','PLUNGE','GAIN','LOSS','GAINER','LOSER',
  'ANNOUNCED','APPROVED','EXPECTED','PLANS','SET','SAYS','TOLD','ADDED',
  'NEWS','MARKET','MARKETS','TRADE','TRADING','PORTFOLIO','REPORT',
  // PATCH 0164b: specific tokens that keep leaking from "X to sell" / "Buzzing
  // stocks: X" headlines — these aren't usable Indian tradable symbols even
  // though they appear as bare caps.  Real Indian listings have longer
  // suffixes (PNCINFRA, not PNC; etc).
  'FMC','PNC','UPL','BSE',  // BSE is the EXCHANGE not a tradable symbol in this context
  'GROWW','LENSKART','MEESHO','SWIGGY','OYO',  // recent IPOs / unicorns that appear as names not tickers
  // 'FMC' is US Fertilizer Corp ticker but contextually appears as 'FMC Corp' (parent
  // selling India unit) in headlines — when followed by 'to sell India' it's not the
  // tradable Indian symbol; we filter this in context-checking below
]);

// PATCH 0164: tighter ticker extraction.
// Heuristics applied in order:
//   1. .NS / .BO suffix is authoritative — keep as-is
//   2. Plain caps tokens require POSITIONAL context: appear inside parens like
//      "(MRVL)", or after / before "shares", "stock", "Inc.", or be 3+ chars and
//      not in any blacklist.
//   3. Bare 2-letter tokens are REJECTED unless they appear inside (TKR) form
//      (avoids 'XV', 'FY', 'IT' false positives).
//   4. Investor-name dropping: words preceded by "Peak", "Sequoia", "TPG",
//      "BlackRock" treated as investor labels, not company tickers.
//   5. We exclude the token when the surrounding bigram is investor-y
//      ("Peak XV", "Sequoia Capital", etc.)
function extractTickers(text: string, region: 'IN'|'US'|'GLOBAL'): string[] {
  const tickers = new Set<string>();
  // 1. Suffixed tickers
  const inSuffix = text.match(/\b[A-Z][A-Z0-9]+\.NS\b|\b[A-Z][A-Z0-9]+\.BO\b/g) || [];
  inSuffix.forEach((t) => tickers.add(t.toUpperCase()));
  // 2a. Strong positive: token in parentheses "(MRVL)" or "(MCX)"
  const parenTickers = text.match(/\(([A-Z]{2,6})\)/g) || [];
  for (const m of parenTickers) {
    const t = m.replace(/[()]/g, '');
    if (TICKER_BLACKLIST.has(t)) continue;
    if (t.length < 2 || t.length > 6) continue;
    tickers.add(t);
  }
  // 2b. Bare caps tokens — require 3+ chars AND not in blacklist AND not
  //     preceded by an investor-name keyword.
  const all = text.match(TICKER_RE) || [];
  const lowerText = text.toLowerCase();
  for (const t of all) {
    if (TICKER_BLACKLIST.has(t)) continue;
    if (t.length < 3 || t.length > 6) continue;  // 2-char tokens are too noisy
    // Reject if preceded by investor-name word in the same sentence
    const idx = text.indexOf(t);
    if (idx > 0) {
      const before = text.slice(Math.max(0, idx - 20), idx).toLowerCase();
      if (/peak\s*$|sequoia\s*$|tpg\s*$|blackrock\s*$|softbank\s*$|kkr\s*$|carlyle\s*$/.test(before)) continue;
    }
    tickers.add(t);
  }
  // 3. Final pass: if no positively-confirmed (paren-form or .NS/.BO) token
  //    appears AND we have bare caps that look investor-y or generic,
  //    drop them entirely rather than guessing.
  const positives = Array.from(tickers).filter((t) =>
    t.endsWith('.NS') || t.endsWith('.BO') || text.includes(`(${t})`),
  );
  if (positives.length > 0) return positives.slice(0, 6);
  return Array.from(tickers).slice(0, 4);
}

// ─── Fetch + classify ───────────────────────────────────────────────────────

async function fetchFeedSafe(src: FeedSource, timeoutMs = 4500): Promise<{ src: FeedSource; xml: string } | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    // PATCH 0100: SEC EDGAR requires identifying User-Agent (company name + contact email).
    // Using browser UA gets 403.  Other feeds accept either.
    const isSEC = /sec\.gov/.test(src.url);
    const userAgent = isSEC
      ? 'Market Cockpit Research admin@market-cockpit.app'
      : 'Mozilla/5.0 (Market Cockpit Special Situations 1.0)';
    const res = await fetch(src.url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': isSEC ? 'application/atom+xml, application/xml' : 'application/rss+xml, application/xml, */*',
        'Accept-Encoding': 'gzip, deflate',
      },
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

interface RollingCache {
  items: FeedItem[];
  updated_at: string;
}

async function loadRolling(): Promise<FeedItem[]> {
  try {
    const c = await kvGet<RollingCache>(ROLLING_KEY);
    return c?.items || [];
  } catch { return []; }
}

async function saveRolling(items: FeedItem[]): Promise<void> {
  try {
    await kvSet(ROLLING_KEY, { items, updated_at: new Date().toISOString() }, ROLLING_TTL_SECONDS);
  } catch { /* non-fatal */ }
}

// PATCH 0105: canonical event object (collapses amendments under one event)
interface CanonicalEvent {
  event_id: string;
  event_type: EventType;
  category: Category;                           // back-compat with old by_category
  target_name?: string;
  primary_filing: FeedItem;                     // earliest non-amendment item
  amendments: FeedItem[];                       // /A filings
  amendment_count: number;
  filings: FeedItem[];                          // primary + amendments + media
  catalyst_score: CatalystScore;                // raw + decay + components
  is_tradable: boolean;
  tier: 'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE';
  tradability_rationale: string;
  why_tradable: ReturnType<typeof whyTradable>;
  lifecycle: LifecycleStage;
  region: 'IN' | 'US' | 'GLOBAL';
  tickers: string[];
  is_fund: boolean;
  primary_source: boolean;
  age_hours: number;
  /** Set when the event is held out of the main Radar list (visible in held_back). */
  quarantine_reason?: FeedQuarantineReason | null;
  /** zzz854: why_tradable.what_matters / what_breaks_thesis are per-event-type playbook text, not facts. */
  why_tradable_kind?: 'PLAYBOOK';
}

async function buildFeed(): Promise<{
  last_updated: string;
  total: number;
  by_category: Record<Category, FeedItem[]>;
  source_status: Array<{ name: string; ok: boolean; items?: number }>;
  rolling_kept: number;
  fresh_added: number;
  events: CanonicalEvent[];                     // PATCH 0105 — canonical events
  by_tier: Record<'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE', number>;
}> {
  // Fetch all feeds in parallel
  // PATCH 1033 — cap total fan-out at 20s. Any single slow source returns null instead of pegging the request to the 30s frontend axios ceiling.
  const FANOUT_BUDGET_MS = 20_000;
  const fetched = await Promise.all(
    SOURCES.map((s) =>
      Promise.race<{ src: FeedSource; xml: string } | null>([
        fetchFeedSafe(s),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FANOUT_BUDGET_MS)),
      ]),
    ),
  );
  const sourceStatus: Array<{ name: string; ok: boolean; items?: number }> = [];
  const fresh: FeedItem[] = [];
  const now = Date.now();
  const rollingCutoff = now - ROLLING_RETAIN_DAYS * 86400000;

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
      let c = classify(text);
      if (!c) continue;
      // zzz847: a Form 10-12G/B registration that is not a spin-off goes to the quiet corporate-action bucket.
      if (classifyForm10(it.title, it.description) === 'REGISTRATION') c = { category: 'CAP', label: CATEGORIES.find((x) => x.id === 'CAP')?.label || 'Capital structure' };
      let pubMs = NaN;
      if (it.pubDate) {
        const d = new Date(it.pubDate);
        pubMs = isNaN(d.getTime()) ? NaN : d.getTime();
      }
      // Drop items older than 30d if we have a date
      if (!isNaN(pubMs) && pubMs < rollingCutoff) continue;
      const ageHours = isNaN(pubMs) ? 999 : Math.max(0, Math.round((now - pubMs) / 3600000));
      fresh.push({
        id: `${src.name}__${(it.link || it.title).slice(0, 200)}`,
        title: it.title,
        link: it.link || '',
        source: src.name,
        region: src.region,
        pub_date: isNaN(pubMs) ? '' : new Date(pubMs).toISOString(),
        age_hours: ageHours,
        category: c.category,
        category_label: c.label,
        tickers: extractSubjectTickers(it.title, it.description, src.name, it.link),
        description: (it.description || '').slice(0, 240),
      });
    }
  }

  // PATCH 0103: rolling-30-day cache merge.  Fresh items take precedence on
  // dedupe (so age_hours updates).  Rolling items older than 30d are dropped.
  const rolling = await loadRolling();
  const keptRolling = rolling.filter((r) => {
    if (!r.pub_date) return false;
    const t = new Date(r.pub_date).getTime();
    return !isNaN(t) && t >= rollingCutoff;
  });

  // Dedupe by id (preferring fresh over rolling)
  const seenIds = new Set<string>();
  const merged: FeedItem[] = [];
  for (const it of fresh) {
    if (seenIds.has(it.id)) continue;
    seenIds.add(it.id);
    merged.push(it);
  }
  for (const it of keptRolling) {
    if (seenIds.has(it.id)) continue;
    seenIds.add(it.id);
    // Recompute age_hours for the rolling entry
    if (it.pub_date) {
      const t = new Date(it.pub_date).getTime();
      if (!isNaN(t)) it.age_hours = Math.max(0, Math.round((now - t) / 3600000));
    }
    merged.push(it);
  }

  // Also dedupe by canonical title across the merged set (in case sources rephrase)
  const deduped = dedupeBy(merged, (x) => x.title);

  // Persist for next request
  await saveRolling(deduped);

  // Sort latest first within categories
  deduped.sort((a, b) => {
    const da = a.pub_date ? new Date(a.pub_date).getTime() : 0;
    const db = b.pub_date ? new Date(b.pub_date).getTime() : 0;
    return db - da;
  });

  // PATCH 0532 — CAPEX + CONCALL buckets added
  const by_category: Record<Category, FeedItem[]> = { SPIN: [], MA: [], TURN: [], CAP: [], CAPEX: [], CONCALL: [] };
  for (const it of deduped) by_category[it.category].push(it);

  // ── PATCH 0105: EVENT INTELLIGENCE PIPELINE ──
  //
  // Step 1: extract event signals per item (form code, /A amendment status,
  //         target name) using the form-strict map first, headline patterns
  //         as fallback.
  // Step 2: assign canonical event ID = hash(event_type + first_ticker_or_target).
  //         Same event ID = same deal across all amendments + media coverage.
  // Step 3: group items into CanonicalEvent buckets, picking the earliest
  //         non-amendment item as primary_filing.
  // Step 4: score each event with the +30/+20/+15/-20 model + decay.
  // Step 5: classify tradability — Tier 1 / Tier 2 / Watchlist / Noise.
  // Step 6: generate "why tradable" auto-playbook per event type.

  // PATCH 0447 BUG-054 — Map event_type → Category so the Turnaround chip
  // (and every other category chip) shows the right count. Prior version
  // just echoed the regex-matched RSS category, which meant NCLT_IBC_*,
  // TURNAROUND_*, and any event_type-classified turnaround event never
  // got bucketed into Category 'TURN'. Now the event_type is the source
  // of truth — falls back to the regex category only when event_type is
  // unmapped.
  // PATCH 0532 — CAPEX_NEW_VENTURE + FIRST_CONCALL event_types routed to
  // the new buckets; everything else falls back to existing.
  const eventTypeToCategory = (eventType: string, fallback: Category): Category => {
    const et = (eventType || '').toUpperCase();
    if (['NCLT_IBC_ADMISSION', 'NCLT_IBC_RESOLUTION', 'TURNAROUND_OPERATING', 'TURNAROUND_NARRATIVE'].includes(et)) return 'TURN';
    if (['TENDER_OFFER', 'MERGER_DEFINITIVE', 'MERGER_RECOMMENDATION', 'GOING_PRIVATE', 'OPEN_OFFER', 'ACQUISITION_PUBLIC', 'STAKE_SALE', 'ASSET_SALE_MONETIZATION'].includes(et)) return 'MA';
    if (et === 'FORM10_REGISTRATION') return 'CAP';
    if (['SPIN_OFF', 'DEMERGER_INDIA', 'IPO_SUBSIDIARY', 'HOLDCO_ARB_TRIGGER', 'STUB_TRADE_TRIGGER'].includes(et)) return 'SPIN';
    if (['BUYBACK_TENDER', 'BUYBACK_OPEN_MARKET', 'DIVIDEND_HIKE', 'RIGHTS_ISSUE', 'RIGHTS_ISSUE_DEEP', 'CONVERTIBLE_PIPE', 'PROMOTER_BACKSTOP', 'QIP_PLACEMENT', 'BONUS_ISSUE', 'STOCK_SPLIT', 'NCD_ISSUE', 'WARRANTS_ISSUE', 'OFS', 'FCCB_ISSUE'].includes(et)) return 'CAP';
    if (['CAPEX_EXPANSION', 'NEW_VENTURE', 'CAPACITY_COMMISSIONED', 'GREENFIELD_PROJECT', 'BROWNFIELD_EXPANSION', 'NEW_MANUFACTURING_FACILITY', 'FORAY_NEW_MARKET'].includes(et)) return 'CAPEX';
    if (['FIRST_CONCALL', 'INVESTOR_PRESENTATION', 'MAIDEN_PRESENTATION', 'ANALYST_MEET', 'COVERAGE_INITIATED'].includes(et)) return 'CONCALL';
    return fallback;
  };
  const tickerToCategory = (cat: Category): Category => cat;
  const SEC_PRIMARY_RE = /sec\.gov/i;
  const PR_RE = /prnewswire|globenewswire|business ?wire/i;

  // Bucket by event ID
  const eventBuckets = new Map<string, FeedItem[]>();
  const itemSignals = new Map<string, ReturnType<typeof extractEventSignals>>();

  // PATCH 0431 — per-event-type counts for coverage diagnostic
  const eventTypeCounts: Record<string, number> = {};
  const clusterer = createEventClusterer();

  for (const it of deduped) {
    const fullText = `${it.title} ${it.description || ''}`;

    // PATCH 0431 — Institutional NOISE FILTER first. Reject ordinary news
    // (earnings, launches, industry commentary, awards) that was leaking
    // into the special-situations feed as false-positive 'OPEN_OFFER's etc.
    if (isInstitutionalNoise(fullText)) continue;

    const sig = extractEventSignals({ title: it.title, description: it.description, link: it.link, source: it.source });

    // PATCH 0431 — Extended classification layer. Refines UNCLASSIFIED /
    // generic types into specific institutional event_types (RIGHTS_ISSUE_DEEP,
    // CONVERTIBLE_PIPE, NCLT_IBC_ADMISSION, INDEX_INCLUSION, ASSET_SALE_MONETIZATION,
    // GOVERNANCE_CRISIS, SEBI_REGULATORY_ACTION, etc.) when the existing
    // taxonomy misclassified them.
    const extended = classifyExtendedEvent(fullText);
    if (extended) {
      sig.event_type = extended as any;
    }

    // zzz847: SEC Form 10 registrations that are not spin-offs stay out of the spin / extended classifiers.
    const f10 = classifyForm10(it.title, it.description);
    if (f10 === 'REGISTRATION') sig.event_type = 'FORM10_REGISTRATION' as any;
    else if (f10 === 'SPIN') sig.event_type = 'SPIN_OFF';
    itemSignals.set(it.id, sig);

    // Skip UNCLASSIFIED noise from canonical event grouping (still in by_category for backwards compat)
    if (sig.event_type === 'UNCLASSIFIED') continue;

    // zzz847: tickerless events key on the headline subject (not 'unknown'), and the same deal reported with
    // different subjects (acquirer vs target) collapses onto the first card via the clusterer.
    const subj = identifySubject({ title: it.title, feedTicker: it.tickers[0] || null, isSec: /sec\.gov/i.test(it.link) });
    const baseId = canonicalEventId({
      event_type: sig.event_type,
      target_name: sig.target_name || (subj.company !== 'Not identified' ? subj.company : it.title.slice(0, 60)),
      tickers: it.tickers,
    });
    const eid = sig.event_type === 'FORM10_REGISTRATION' ? baseId : clusterer.assign(baseId, it.title, it.region, sig.event_type, { link: it.link, pubDate: it.pub_date });
    const bucket = eventBuckets.get(eid) || [];
    bucket.push(it);
    eventBuckets.set(eid, bucket);
  }

  // PATCH 0431 — Coverage diagnostic. Tells the user which institutional
  // categories the engine found in this window. Direct response to "if
  // something is missing reupdate logic — 3 months it should show all such".

  // Build CanonicalEvent objects
  const events: CanonicalEvent[] = [];
  for (const [eventId, bucketItems] of eventBuckets.entries()) {
    // Sort: primary filings first (non-amendment), then amendments, then media
    const sorted = [...bucketItems].sort((a, b) => {
      const sigA = itemSignals.get(a.id)!;
      const sigB = itemSignals.get(b.id)!;
      // Primary filings (SEC.gov non-amendment) take priority
      const aIsPrimary = SEC_PRIMARY_RE.test(a.link) && !sigA.is_amendment;
      const bIsPrimary = SEC_PRIMARY_RE.test(b.link) && !sigB.is_amendment;
      if (aIsPrimary !== bIsPrimary) return aIsPrimary ? -1 : 1;
      // The Subject row of a deal is the card; a 'Filed by' row (acquirer / sponsor) is the same deal, never its own card.
      const roleRank = (x: FeedItem) => { const r = parseSecFilingTitle(x.title)?.role; return r === 'subject' || r === 'issuer' ? 0 : r === 'filed by' ? 2 : 1; };
      if (roleRank(a) !== roleRank(b)) return roleRank(a) - roleRank(b);
      // Otherwise newest first
      const ta = a.pub_date ? new Date(a.pub_date).getTime() : 0;
      const tb = b.pub_date ? new Date(b.pub_date).getTime() : 0;
      return tb - ta;
    });

    const primary = sorted[0];
    const primarySig = itemSignals.get(primary.id)!;
    const amendments = sorted.slice(1).filter((it) => itemSignals.get(it.id)?.is_amendment);

    // Resolve event metadata
    const eventType = primarySig.event_type;
    const allTickers = Array.from(new Set(sorted.flatMap((it) => it.tickers))).slice(0, 6);
    const region = primary.region;

    // Detect fund-only events (e.g. "Bow River Capital Evergreen Fund" tender)
    const allText = sorted.map((it) => `${it.title} ${it.description || ''}`).join(' ');
    const isFund = /\b(fund|trust|capital evergreen|infrastructure income|private markets fund|closed-end|etf)\b/i.test(allText);

    // Primary-source check
    const hasPrimarySource = sorted.some((it) => SEC_PRIMARY_RE.test(it.link) || PR_RE.test(it.link));

    // Catalyst score inputs
    const ageHours = primary.age_hours;
    const titleAndDesc = `${primary.title} ${primary.description || ''}`;
    const hasDeadline = /\b(\d{1,2}\s*(?:may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar|apr)|record date|tender (?:expir|deadline)|effective date|listing date|hearing date|expir(?:y|es) (?:on|date)|by\s+\w+\s+\d+|deadline)\b/i.test(titleAndDesc);
    const hasConsideration = /(\$\s*\d|rs\.?\s*\d|₹\s*\d|deal worth|offer price|per share|gross spread|consideration)/i.test(titleAndDesc);
    const hasSpread = /\b(spread|premium of|trading at|effective consideration)\b/i.test(titleAndDesc);

    // PATCH 0447 IMP-1 — Classify primary source into the 4-tier institutional
    // hierarchy + detect speculative-language penalty. Used to rank definitive
    // exchange filings ABOVE recycled aggregator headlines of the same story.
    // PATCH 0454 P1-23 — Audit found these patterns mis-classified 99% of
    // RSS items as Tier 4. Two root causes:
    //   1. The T1_RE prefix anchor was too strict and missed common URL
    //      shapes (especially Indian press feeds that wrap announcements).
    //   2. Most RSS items don't have exchange URLs at all — they come from
    //      ET/Mint/MC. The classifier needs to ALSO match the source name
    //      (e.g. "BSE Corp Announcements", "PIB India") which DO indicate
    //      a primary filing even when the link is to a news rewrite.
    const T1_LINK_RE  = /(sec\.gov|bseindia\.com|nseindia\.com|sebi\.gov\.in|nsearchives\.nseindia|bsedb|rbi\.org\.in|pib\.gov\.in|investor\.[a-z0-9-]+\.com\/news-release)/i;
    const T2_LINK_RE  = /(prnewswire|globenewswire|business ?wire|press ?release|company.*press|investor.{0,10}relations)/i;
    const T3_LINK_RE  = /(reorg ?research|mergermarket|debtwire|deal ?reporter|prime ?database|capitaline)/i;
    const T1_NAME_RE  = /\b(bse corp|nse corp|sec edgar|sebi|rbi|pib india|nseindia|bseindia|moneycontrol announcements|investor ?relations)\b/i;
    const T2_NAME_RE  = /\b(reuters|bloomberg|wsj|wall street journal|financial times|ft\b|pr ?newswire|globenewswire|business ?wire)\b/i;
    const T3_NAME_RE  = /\b(reorg|mergermarket|debtwire|deal ?reporter|capitaline|equitymaster|trendforce|digitimes|semianalysis|semi ?wiki)\b/i;
    const inferSourceTier = (link: string, sourceName: string): 1 | 2 | 3 | 4 => {
      if (T1_LINK_RE.test(link) || T1_NAME_RE.test(sourceName)) return 1;
      if (T2_LINK_RE.test(link) || T2_NAME_RE.test(sourceName)) return 2;
      if (T3_LINK_RE.test(link) || T3_NAME_RE.test(sourceName)) return 3;
      return 4;
    };
    const sourceTier = inferSourceTier(primary.link, primary.source);
    const SPECULATION_RE = /\b(could (?:acquire|buy|merge)|may consider|reportedly weighing|in talks (?:to|with)?|exploring (?:a |the )?(?:sale|merger|deal)|buzz(?:ing)? stock|likely to (?:bid|acquire|merge)|rumou?red|speculation|chatter|sources say|believed to be|allegedly|reportedly plans?|might (?:bid|acquire))\b/i;
    const hasSpeculation = SPECULATION_RE.test(titleAndDesc);

    const score = scoreCatalyst({
      event_type: eventType,
      is_amendment: primarySig.is_amendment && amendments.length === 0,  // primary itself is an /A and we have nothing earlier
      is_fund: isFund,
      has_named_ticker: allTickers.length > 0,
      has_primary_source: hasPrimarySource,
      has_explicit_deadline: hasDeadline,
      has_consideration: hasConsideration,
      has_spread_calc: hasSpread,
      age_hours: ageHours,
      source_tier: sourceTier,
      speculation_penalty: hasSpeculation,
    });

    const tradabilityRaw = classifyTradability({
      event_type: eventType,
      is_amendment: primarySig.is_amendment,
      amendment_count_in_event: amendments.length,
      is_fund: isFund,
      has_named_ticker: allTickers.length > 0,
      has_primary_source: hasPrimarySource,
      decay_score: score.decay_score,
      // PATCH 0120 — IMP-03: content-based reject for REIT/VRS/EU-bank/SPAC/NCLT
      title: primary.title,
      description: primary.description,
    });

    // zzz847: registrations, price articles, previews, analyst targets and opinion pieces are never actionable catalysts.
    const hintsP = contentHints(primary.title, primary.description);
    const tradability = (eventType as string) === 'FORM10_REGISTRATION'
      ? { is_tradable: false, tier: 'NOISE' as const, rationale: 'Registration (Form 10) of a class of securities, not a spin-off. Low signal.' }
      : isNonEventContent(hintsP)
        ? { is_tradable: false, tier: 'NOISE' as const, rationale: hintsP.isPriceArticle ? 'Price article, not a corporate event' : hintsP.isPreview ? 'Preview, result not out yet' : hintsP.isAnalystTarget ? 'Analyst target / rating, non-investment signal' : hintsP.isOpinion ? 'Opinion / prediction piece' : 'Not a company event' }
        : tradabilityRaw;

    // zzz854: held back with ONE reason: pooled vehicles (fund / BDC / private credit / non-traded REIT), partnership units,
    // debt tenders, routine issuer tenders, and operating-company SC TO-I whose terms were not read.
    const relatedText = sorted.filter((it) => it !== primary).map((it) => `${it.title} ${it.description || ''}`).join(' ');
    const hold = classifyFeedHoldBack({ title: primary.title, description: primary.description, source: primary.source, link: primary.link, eventType, relatedText });
    const quarantineReason: FeedQuarantineReason | null = hold ? hold.reason : null;
    const fundRep = quarantineReason === 'FUND_REPURCHASE_OFFER';
    if (hold) { tradability.is_tradable = false; (tradability as any).tier = 'NOISE'; tradability.rationale = hold.label; }

    const lifecycle = inferLifecycleStage({
      is_amendment: primarySig.is_amendment,
      amendment_count: amendments.length,
      event_type: eventType,
    });

    const whyTpl = whyTradable({
      event_type: eventType,
      target_name: primarySig.target_name,
      ticker: allTickers[0],
    });
    // zzz854: why_tradable is a per-event-type PLAYBOOK. 'What happened' is the fact from the source (SEC subtype + roles, or the
    // headline); the playbook prior is labelled so no card shows it as a fact about this event.
    const secInfo = secFilingInfoFor(sorted.map((it) => ({ title: it.title, source: it.source, link: it.link, pub_date: it.pub_date, description: it.description })), primary.description || '');
    const secRows = sorted.map((it) => parseSecFilingTitle(it.title)).filter(Boolean) as NonNullable<ReturnType<typeof parseSecFilingTitle>>[];
    const secSubject = secRows.find((r) => r.role === 'subject' || r.role === 'issuer')?.company || secRows.find((r) => r.role !== 'filed by')?.company || null;
    const secFiler = secRows.find((r) => r.role === 'filed by' && r.company !== secSubject)?.company || null;
    const roles = secInfo ? dealRolesFor({ secFiling: secInfo, subject: secSubject, filer: secFiler }) : null;
    const why = {
      ...whyTpl,
      what_happened: secInfo ? `${secInfo.subtypeLabel} filed${roles?.roleLine ? `. ${roles.roleLine}` : ''}${secInfo.amendmentCount ? ` (${secInfo.amendmentCount} amendment${secInfo.amendmentCount === 1 ? '' : 's'})` : ''}.` : primary.title,
      what_matters: `Playbook (typical for this event type, not from the source): ${whyTpl.what_matters}`,
    };

    events.push({
      event_id: eventId,
      event_type: eventType,
      category: eventTypeToCategory(eventType, primary.category),
      target_name: primarySig.target_name,
      primary_filing: primary,
      amendments,
      amendment_count: amendments.length,
      filings: sorted,
      catalyst_score: score,
      is_tradable: tradability.is_tradable,
      tier: tradability.tier,
      tradability_rationale: tradability.rationale,
      why_tradable: why,
      why_tradable_kind: 'PLAYBOOK',
      lifecycle,
      region,
      tickers: allTickers,
      is_fund: isFund || fundRep,
      primary_source: hasPrimarySource,
      age_hours: ageHours,
      quarantine_reason: quarantineReason,
    });
  }

  // Sort events by decay_score desc, with Tier 1 first
  const tierRank: Record<CanonicalEvent['tier'], number> = { TIER_1: 4, TIER_2: 3, WATCHLIST: 2, NOISE: 1 };
  events.sort((a, b) => {
    const ta = tierRank[a.tier];
    const tb = tierRank[b.tier];
    if (ta !== tb) return tb - ta;
    return b.catalyst_score.decay_score - a.catalyst_score.decay_score;
  });

  // zzz847: coverage counts are per canonical event (was per raw item over the whole 90-day window, which
  // double counted syndication and amendments), and skip registrations and price / preview / analyst pieces.
  const canonicalTypeCounts = countCanonicalEventTypes(events.map((e) => ({ event_type: e.event_type, title: e.primary_filing.title, tier: e.tier })));
  for (const [k, v] of Object.entries(canonicalTypeCounts)) eventTypeCounts[k] = v;
  const coverageDiagnostic: CoverageBucket[] = computeCoverageDiagnostic(eventTypeCounts);

  const by_tier: Record<'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE', number> = {
    TIER_1: 0, TIER_2: 0, WATCHLIST: 0, NOISE: 0,
  };
  for (const e of events) by_tier[e.tier] += 1;

  // zzz852: QA + exclusion flags. Additive only: nothing is removed from events / by_category (raw data stays available).
  let qa: any = null;
  try {
    const usLookup = await safeSecLookup();
    const evs = events as unknown as Parameters<typeof splitRadarInputs>[0] & Parameters<typeof dedupeFeedEvents>[0];
    const split = splitRadarInputs(evs, { entityDeps: { usLookup } });
    // zzz854: the adapter's hold-back decision (it also knows the security state) is the one the route reports, so the route's
    // held_back line and the Radar's line are the same numbers.
    const evById = new Map(events.map((e) => [e.event_id, e]));
    for (const h of split.heldBackInputs) { const e = evById.get(h.id); if (e && !e.quarantine_reason && h.feedQuarantineReason) { e.quarantine_reason = h.feedQuarantineReason; e.tier = 'NOISE'; e.is_tradable = false; e.tradability_rationale = h.feedQuarantineLabel || e.tradability_rationale; } }
    const normalized = dedupeFeedEvents(evs || []).events;
    qa = buildRadarQa({ rawEvents: evs || [], normalizedEvents: normalized, radarInputs: split.inputs as any, heldBack: split.heldBackInputs as any });
    qa.totals.raw_items = deduped.length;
    const byId = new Map(qa.exclusions.map((x: any) => [x.id, x]));
    const byLink = new Map<string, any>();
    for (const e of events) {
      const x: any = byId.get(e.event_id);
      if (!x) continue;
      Object.assign(e, { excluded_from_equity_radar: true, exclusion_reason: x.exclusion_reason, entity_type: x.entity_type });
      for (const f of e.filings) if (f.link) byLink.set(f.link, x);
    }
    for (const k of Object.keys(by_category) as Category[]) for (const it of by_category[k]) { const x = it.link ? byLink.get(it.link) : null; if (x) Object.assign(it, { excluded_from_equity_radar: true, exclusion_reason: x.exclusion_reason, entity_type: x.entity_type }); }
  } catch { qa = null; }
  const held_back = summariseHeldBack(events.filter((e) => e.quarantine_reason).map((e) => ({ reason: e.quarantine_reason as FeedQuarantineReason, name: e.target_name || e.primary_filing.title })));

  const result: any = {
    qa,
    held_back,
    last_updated: new Date().toISOString(),
    total: deduped.length,
    by_category,
    source_status: sourceStatus,
    rolling_kept: keptRolling.length,
    fresh_added: fresh.length,
    events,
    by_tier,
    // PATCH 0431 — institutional diagnostics
    coverage_diagnostic: coverageDiagnostic,
    event_type_counts: eventTypeCounts,
    event_priors: EVENT_PRIORS,
  };
  return result;
}

// ─── zzz854: AI verification gate ───────────────────────────────────────────
// Applied to EVERY response (fresh or cached), so new verdicts show without a rebuild. Main lists (events, by_category, by_tier)
// keep only events whose primary document carries the terms, or that the AI verifier confirmed from the primary document.
// AI-contradicted events go to verificationAudit; everything else to awaitingVerification with a reason (bare form titles,
// media-only stories with no primary filing, not yet checked). Events already held back (fund offers, excluded entities)
// are never sent to the paid verifier; they keep their flags so the Radar can explain what it held back.
async function applyVerificationGate(data: any): Promise<any> {
  const all: any[] = Array.isArray(data?.events) ? data.events : [];
  const held = (e: any) => !!e?.quarantine_reason || !!e?.excluded_from_equity_radar;
  const candidates = all.filter((e) => !held(e));
  const heldOut = all.length - candidates.length;
  const g = await gateSpecialSituations(candidates, { timeoutMs: 3_000 }).catch(() => null);
  const kept: any[] = g
    ? g.kept.map((e: any) => { const ai = aiVerificationOf(g.confirmedByRef.get(String(e?.event_id))); return ai ? { ...e, aiVerification: ai } : e; })
    : candidates.filter((e) => isSpecSitPrimaryVerified(e));   // the gate failed: primary-verified only, never a silent pass
  const keptLinks = new Set<string>();
  for (const e of kept) { if (e?.primary_filing?.link) keptLinks.add(e.primary_filing.link); for (const f of e?.filings || []) if (f?.link) keptLinks.add(f.link); }
  const report = g?.verification.mode === 'report';
  const byCategory: Record<string, any[]> = {};
  let categoryHeld = 0;
  for (const [k, list] of Object.entries((data?.by_category || {}) as Record<string, any[]>)) {
    const arr = Array.isArray(list) ? list : [];
    byCategory[k] = report ? arr : arr.filter((it) => it?.link && keptLinks.has(it.link));
    categoryHeld += arr.length - byCategory[k].length;
  }
  // zzz854: ONE count model over the verified set. Shown = kept (after the adapter's dedupe + hold-back); held back = route reasons
  // + AWAITING_VERIFICATION + AI_CONTRADICTED, each with its own count. Header tiers, category chips and coverage all derive
  // from it; the route's pre-gate numbers stay available as *_raw (labelled raw).
  const keptIds = new Set(kept.map((e: any) => String(e?.event_id)));
  const removedRefs = new Set((g?.removed ?? []).map((r: any) => String(r?.refId)));
  const notKept = candidates.filter((e) => !keptIds.has(String(e?.event_id)));
  const rawCoverage: Record<string, number> = {};
  for (const b of (Array.isArray(data?.coverage_diagnostic) ? data.coverage_diagnostic : [])) if (b?.bucket) rawCoverage[b.bucket] = Number(b.count) || 0;
  let gated: ReturnType<typeof assembleGatedFeed> | null = null;
  try {
    gated = assembleGatedFeed({
      kept, held: all.filter(held), awaiting: notKept.filter((e) => !removedRefs.has(String(e?.event_id))), contradicted: notKept.filter((e) => removedRefs.has(String(e?.event_id))),
      rawItemCount: Number(data?.total) || undefined, rawCoverage, coverageBucketOf, entityDeps: { usLookup: await safeSecLookup() },
    });
  } catch { gated = null; }
  const byTier: Record<string, number> = gated ? { ...gated.byTier } : { TIER_1: 0, TIER_2: 0, WATCHLIST: 0, NOISE: 0 };
  if (!gated) for (const e of kept) if (e?.tier && e.tier in byTier) byTier[e.tier] += 1;
  const coverageShown = gated ? COVERAGE_DEFS.map((b) => ({ ...b, count: gated!.countModel.shown_by_coverage[b.bucket] || 0 })) : data?.coverage_diagnostic;
  const verification = g?.verification ?? { provider: 'unknown', model: null, available: false, unavailableReason: 'The verification gate could not run; only primary-verified events are shown.', mode: 'enforce',
    primaryVerified: kept.length, checked: 0, confirmed: 0, contradicted: 0, awaiting: candidates.length - kept.length, awaitingByReason: {}, lastRunAt: null };
  return {
    ...data,
    // held-back events stay in `events` WITH their quarantine / exclusion flags (the Radar turns them into its "N held back" line and
    // never shows them as cards); they are not counted in by_tier and their headlines are not in by_category.
    events: gated ? gated.events : [...kept, ...all.filter(held)], by_category: byCategory, by_tier: byTier,
    by_tier_before_verification: data?.by_tier ?? null,
    // zzz854: one count model; chips = count_model.shown_by_category, coverage = shown coverage (raw kept separately)
    count_model: gated ? gated.countModel : null,
    category_counts: gated ? gated.countModel.shown_by_category : null,
    held_back: gated ? gated.heldBack : data?.held_back,
    coverage_diagnostic: coverageShown,
    coverage_diagnostic_raw: { label: 'RAW (pre-filter)', buckets: data?.coverage_diagnostic ?? [] },
    verification,
    awaitingVerification: (g?.awaiting ?? []).slice(0, 300),
    awaitingVerificationCount: verification.awaiting,
    verificationAudit: (g?.removed ?? []).slice(0, 200),
    verification_held_back: { events_awaiting: verification.awaiting, events_contradicted: verification.contradicted, events_already_held_back: heldOut, category_items_hidden: categoryHeld },
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get('refresh') === '1';
    const now = Date.now();

    // PATCH 0454 P1-24 — Two-tier cache lookup: in-memory warm path first
    // (cheap), then KV (cross-container). Skip both when ?refresh=1.
    if (!force && CACHE && now - CACHE.ts < CACHE_TTL_MS) {
      return NextResponse.json({ ...(await applyVerificationGate(CACHE.data)), cached: true, cache_age_min: Math.round((now - CACHE.ts) / 60000) });
    }
    if (!force && ssRedisAvailable()) {
      try {
        const persisted = await ssKvGet<{ data: any; ts: number }>(CACHE_KV_KEY);
        if (persisted && now - persisted.ts < CACHE_TTL_MS) {
          CACHE = persisted; // warm the in-mem too
          return NextResponse.json({ ...(await applyVerificationGate(persisted.data)), cached: true, cache_age_min: Math.round((now - persisted.ts) / 60000), cache_origin: 'kv' });
        }
      } catch {}
    }

    const data = await buildFeed();
    CACHE = { data, ts: now };
    if (ssRedisAvailable()) {
      try { await ssKvSet(CACHE_KV_KEY, CACHE, CACHE_KV_TTL_S); } catch {}
    }
    return NextResponse.json({ ...(await applyVerificationGate(data)), cached: false, cache_age_min: 0 });
  } catch (e: any) {
    // PATCH zzz65 — sanitize. Don't ship raw error.message to client.
    console.error('[special-situations/feed] error', e?.message || e);
    return NextResponse.json({
      error: 'special-situations feed temporarily unavailable',
      message: 'upstream temporarily unavailable',
      last_updated: new Date().toISOString(),
      total: 0,
      // PATCH 0550 — fallback shape must match the live Category set (Patch
      // 0532 added CAPEX + CONCALL). Otherwise the page renders the empty
      // catch payload and the new chip groups silently disappear.
      by_category: { SPIN: [], MA: [], TURN: [], CAP: [], CAPEX: [], CONCALL: [] },
      // PATCH zzz65 — full success-shape parity so clients reading events/
      // by_tier/event_type_counts/event_priors/source_status/coverage_diagnostic
      // don't crash (mismatched-shape bug).
      events: [],
      by_tier: {},
      source_status: {},
      coverage_diagnostic: {},
      event_type_counts: {},
      event_priors: {},
    }, { status: 200 });
  }
}
