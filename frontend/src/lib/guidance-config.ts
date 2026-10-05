// zzz853 — GUIDANCE CENTRAL CONFIG. One place for every threshold, lag, cap and the source-tier rules used by the Guidance Universe.
// The UI and the event engine import these; nothing else may define its own copy of a number below.
// Pure module (no I/O, no company names).

/** A revenue / PAT / EBITDA growth at or above this % counts as "high growth" (compare value: stated figure, midpoint of a closed range, lower bound of an open range). */
export const HIGH_GROWTH_THRESHOLD = 30;
/** Bounds for the `threshold` API parameter. */
export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 500;
/** A revenue growth at or above this needs an explicit management-stated % (with the figure in the source text) or it is flagged 'needs review'. */
export const PLAUSIBLE_REVENUE_GROWTH_PCT = 100;
/** A guided quarter or half is treated as expired only this long after it ends (results are reported with a lag). Annual periods have no lag. */
export const REPORTING_LAG_DAYS = 45;
/** A record whose last verification is older than this gets a stale-verification warning. It stays ACTIVE: expiry is by period / status only. */
export const STALE_VERIFICATION_DAYS = 60;
/** zzz860: THE one freshness rule (badge, summary, review queue, universe and diagnostics all read it): fresh up to 30 days, aging 31 to 60, stale above 60. */
export const FRESH_MAX_DAYS = 30;
export const AGING_MAX_DAYS = STALE_VERIFICATION_DAYS;
/**
 * zzz854 (documented decision): a record whose last verification is OLDER than this is moved out of the Active list into "Needs review"
 * (reason STALE_VERIFICATION). 90 days = one full reporting cycle: a newer quarterly filing exists and may have changed the guidance, so the
 * record is no longer shown as verified until it is re-checked. Between STALE_VERIFICATION_DAYS and this it stays Active with a caveat.
 * A record whose guided period has ended is never Active either (EXPIRED, handled by the period rules).
 */
// zzz880: 90 → 135. Indian companies guide the year once (May) and restate it at the next call; Q1 results are due by mid-August and calls run
// into late August, so a sound May guide was being pulled from Active weeks before the company had a chance to restate it (Man Industries).
export const STALE_DEMOTE_DAYS = 135;
/** Two sources for the same company + metric + period whose dates are this close (days) and whose values differ are a SOURCE CONFLICT, not a revision. */
export const SOURCE_CONFLICT_WINDOW_DAYS = 3;
/** Derived / implied growth ranges at least this wide (percentage points) are shown with 0 decimals; narrower ones keep 1 decimal. */
export const BROAD_RANGE_PP = 5;
/** A derived growth is accepted when the stored % and the target / base arithmetic agree within this many percentage points. */
export const DERIVE_TOLERANCE_PP = 0.6;
/** Owner-list regression: a figure within this many points of the found guidance is a match. */
export const REGRESSION_TOLERANCE_PP = 2;
/** An owner figure this close to (or below) an earlier guidance figure is read as 'quoting the earlier target'. */
export const PRIOR_NEIGHBOURHOOD_PP = 10;
/** Universe KV keys and TTL. */
export const UNIVERSE_LASTGOOD_KEY = 'guidance-universe:v1:lastgood';
export const UNIVERSE_TTL_S = 400 * 24 * 3600;

// ── source tiers (deterministic) ──────────────────────────────────────────────────────────────
//  TIER1  exchange filing / SEC filing / company earnings release / investor presentation (and the company's own transcript or annual report / AGM document)
//  TIER2  company website / investor relations / company press release
//  TIER3  reputable media
//  TIER4  everything else (aggregators, blogs, forums, social, broker notes)
// A TIER3 or TIER4 source can DISCOVER a claim but can never make it VERIFIED.
export type SourceTier = 1 | 2 | 3 | 4;
export type SourceTierLabel = 'TIER1' | 'TIER2' | 'TIER3' | 'TIER4';
export const MAX_VERIFYING_TIER: SourceTier = 2;
export const TIER_LABEL: Record<SourceTier, SourceTierLabel> = { 1: 'TIER1', 2: 'TIER2', 3: 'TIER3', 4: 'TIER4' };
export const TIER_NAME: Record<SourceTier, string> = { 1: 'Exchange / SEC filing, earnings release, investor presentation', 2: 'Company website / IR', 3: 'Reputable media', 4: 'Other source' };

const MEDIA_TYPE_RE = /\b(media|news|aggregator|blog|forum|social|summary|broker|analyst|report)\b/i;
const FILING_TYPE_RE = /\b(filing|exchange|sec|edgar|8-?k|10-?[kq]|6-?k|earnings release|results? release|release|investor presentation|presentation|deck|concall|conference call|earnings call|call|transcript|annual report|agm|regulatory)\b/i;
const COMPANY_SITE_RE = /\b(company website|website|investor relations|\bir\b|press release|company voice)\b/i;
const EXCHANGE_HOST_RE = /(?:^|\/\/|\.)(nseindia\.com|bseindia\.com|sec\.gov)(?:\/|$)/i;
const REPUTABLE_MEDIA_RE = /\b(reuters|bloomberg|business ?standard|economic ?times|et ?now|livemint|mint|moneycontrol|financial ?express|hindu ?business ?line|businessline|cnbc|wsj|wall street journal|financial times|ft\.com|barron'?s|the hindu|ndtv profit|business today)\b/i;

/**
 * zzz854: aggregators, call-summary sites, social posts and retail news apps. Whatever rank or type a feed gave them, they can only DISCOVER a claim
 * (TIER4): a summary of a call is not the company's document. An exchange / SEC URL still wins (checked first).
 */
const AGGREGATOR_RE = /\b(?:scan ?x|multibagg\w*|trade ?brains|sahi(?: news)?|whalesbook|tradingkey|alpha ?spread|gurufocus|investywise|money ?muscle|business ?upturn|stocktwits|twitter|tweet|post on x|on x\b|x\.com|reddit|telegram|youtube|substack|seeking ?alpha|marketscreener|simply ?wall|tikr|quartr|marketbeat|tipranks|zacks|motley fool|stockanalysis|screener\.in|tickertape|trendlyne|moneycontrol forum|valuepickr)\b/i;
const SUMMARY_RE = /\b(?:summary|summari[sz]ed|highlights|recap|as reported by|via)\b/i;
export const isAggregatorSource = (name?: string | null, url?: string | null): boolean => AGGREGATOR_RE.test(`${name || ''} ${url || ''}`);

export interface TierInput { rank?: number | null; type?: string | null; name?: string | null; url?: string | null }
export interface TierResult { tier: SourceTier; label: SourceTierLabel; reason: string }
export function classifySourceTier(s: TierInput): TierResult {
  const rank = typeof s.rank === 'number' && Number.isFinite(s.rank) ? s.rank : 10;
  const type = String(s.type || ''); const name = String(s.name || ''); const url = String(s.url || '');
  const res = (tier: SourceTier, reason: string): TierResult => ({ tier, label: TIER_LABEL[tier], reason });
  if (url && EXCHANGE_HOST_RE.test(url)) return res(1, 'exchange / SEC host');
  if (isAggregatorSource(name, url)) return res(4, 'aggregator, call summary or social post (can discover, never verify)');
  // a third-party summary of a call / release is not the document itself
  if (rank >= 6 && SUMMARY_RE.test(name) && !/\btranscript\b/i.test(name)) return res(rank <= 8 || REPUTABLE_MEDIA_RE.test(`${name} ${url}`) ? 3 : 4, 'third-party summary of a company document');
  const media = MEDIA_TYPE_RE.test(type) && !FILING_TYPE_RE.test(type.replace(MEDIA_TYPE_RE, ''));
  if (rank <= 5 && !media) return res(1, `rank ${rank}: company filing, release, presentation or transcript`);
  if (rank === 6 && !media) return res(2, 'rank 6: company press release / IR');
  if (rank === 7 && !media) {
    if (COMPANY_SITE_RE.test(type) && !FILING_TYPE_RE.test(type)) return res(2, 'company website / IR');
    if (FILING_TYPE_RE.test(type)) return res(1, 'company document (transcript / call) at rank 7');
    return res(2, 'company voice');
  }
  if (rank <= 8) return res(3, 'rank 8: reputable financial media');
  if (rank >= 11) return res(4, `rank ${rank}: blog, forum or social post`);
  if (rank === 9) return res(4, 'rank 9: broker / analyst note');
  return REPUTABLE_MEDIA_RE.test(`${name} ${url}`) ? res(3, 'reputable media outlet') : res(4, 'other news / aggregator');
}
export const canVerify = (tier: SourceTier): boolean => tier <= MAX_VERIFYING_TIER;
