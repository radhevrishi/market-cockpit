// ═══════════════════════════════════════════════════════════════════════════
// EVENT INTELLIGENCE PIPELINE — patch 0105
//
// Transforms RSS-style "headline + classifier" output into canonical events
// with quantitative catalyst scoring, tradability filtering, lifecycle
// stages, and auto-generated "why tradable" blocks.
//
// Core insight: SEC TO-I/A x3 + SC TO-I (the original) = ONE corporate event,
// not 4 separate news items.  This module collapses amendments under a single
// canonical event ID so the UI shows "Tender offer for Forian Inc · 3
// amendments" rather than 4 floods.
//
// Key pieces:
//   - EVENT_FORM_MAP — strict form-code → event-type lookup (SC TO-T = tender,
//     10-12B = spin-off, 8-K = unknown, etc.)
//   - extractEventSignals — pulls form code, /A amendment status, target name
//     from RSS title + URL
//   - canonicalEventId — hash of (eventType + targetName) so all amendments
//     of the same deal collapse to one bucket
//   - scoreCatalyst — +30 definitive / +20 named ticker / +15 30d deadline /
//     +15 deal consideration / +10 spread calc / -20 amendment / -15 fund /
//     -10 no primary source
//   - isTradable — minimum bar (named ticker + non-fund + non-amendment-only)
//   - whyTradable — auto-generated playbook block per event type
//   - eventDecay — exponential half-life (M&A 30d, spin 90d, turn 7d)
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';

// ─── Event types ────────────────────────────────────────────────────────────

export type EventType =
  | 'TENDER_OFFER'           // SC TO-T / SC TO-I
  | 'GOING_PRIVATE'          // SC 13E-3
  | 'MERGER_RECOMMENDATION'  // SC 14D-9
  | 'MERGER_DEFINITIVE'      // 8-K Item 1.01 / S-4
  | 'SPIN_OFF'               // 10-12B / 10-12G
  | 'OPEN_OFFER'             // SEBI open offer
  | 'BUYBACK_TENDER'
  | 'BUYBACK_OPEN_MARKET'
  | 'BONUS_ISSUE'
  | 'STOCK_SPLIT'
  | 'DIVIDEND_HIKE'
  | 'RIGHTS_ISSUE'
  | 'QIP_PLACEMENT'
  | 'DEMERGER_INDIA'         // NCLT scheme of arrangement
  | 'IPO_SUBSIDIARY'         // parent listing subsidiary
  | 'TURNAROUND_OPERATING'   // back to profit / debt resolution
  | 'TURNAROUND_NARRATIVE'   // soft commentary about improvement
  | 'STAKE_SALE'
  | 'ACQUISITION_PUBLIC'
  | 'NEWS_RUMOR'
  | 'UNCLASSIFIED'
  // PATCH 0431 — institutional review: missing alpha categories.
  // These align with lib/specsit-institutional.ts ExtendedEventType.
  | 'RIGHTS_ISSUE_DEEP'        // deeply-discounted rights w/ detachable warrants
  | 'CONVERTIBLE_PIPE'         // PIPE financing / FCCB / CCD
  | 'PROMOTER_BACKSTOP'        // promoter-backstopped capital raise
  | 'ASSET_SALE_MONETIZATION'  // land / tower / stake / non-core exit
  | 'NCLT_IBC_ADMISSION'
  | 'NCLT_IBC_RESOLUTION'
  | 'INDEX_INCLUSION'
  | 'INDEX_EXCLUSION'
  | 'GOVERNANCE_CRISIS'
  | 'HOLDCO_ARB_TRIGGER'
  | 'STUB_TRADE_TRIGGER'
  | 'SEBI_REGULATORY_ACTION'
  | 'AUDITOR_QUALIFIED'
  | 'PROMOTER_PLEDGE_UNWIND';

export type LifecycleStage = 'rumor' | 'announced' | 'amended' | 'approved' | 'closed' | 'unknown';

// ─── Form-strict classification ─────────────────────────────────────────────

interface EventSignals {
  event_type: EventType;
  is_amendment: boolean;
  amendment_label?: string;     // e.g. "Amendment #2"
  target_name?: string;
  acquirer_name?: string;
  filing_form?: string;         // raw form code
}

const SEC_FORM_MAP: Array<{ pattern: RegExp; type: EventType; isAmendmentBy?: RegExp }> = [
  // Spin-off prospectuses — definitive
  { pattern: /\b10-12B(?:\/A)?\b/i,         type: 'SPIN_OFF' },
  { pattern: /\b10-12G(?:\/A)?\b/i,         type: 'SPIN_OFF' },
  // Tender offers
  { pattern: /\bSC\s*TO-T(?:\/A)?\b/i,      type: 'TENDER_OFFER' },
  { pattern: /\bSC\s*TO-I(?:\/A)?\b/i,      type: 'TENDER_OFFER' },
  // Going-private (issuer-led)
  { pattern: /\bSC\s*13E-?3(?:\/A)?\b/i,    type: 'GOING_PRIVATE' },
  // Recommendation statement (target's response)
  { pattern: /\bSC\s*14D-?9(?:\/A)?\b/i,    type: 'MERGER_RECOMMENDATION' },
  // Merger registration
  { pattern: /\bS-?4(?:\/A)?\b/i,           type: 'MERGER_DEFINITIVE' },
];

// India / general headline patterns (used when no SEC form code)
const INDIA_PATTERNS: Array<{ pattern: RegExp; type: EventType; reject?: RegExp }> = [
  { pattern: /\b(open offer|takeover bid|hostile bid)\b/i, type: 'OPEN_OFFER' },
  { pattern: /\b(buyback|share repurchase|repurchas\w* shares|tender for own shares)\b/i, type: 'BUYBACK_TENDER' },
  { pattern: /\b(special dividend|interim dividend|dividend hike|hikes? dividend|raise(?:s|d)? dividend)\b/i, type: 'DIVIDEND_HIKE' },
  { pattern: /\bbonus issue\b/i, type: 'BONUS_ISSUE' },
  { pattern: /\b(stock split|share split)\b/i, type: 'STOCK_SPLIT' },
  { pattern: /\b(rights issue|rights offer)\b/i, type: 'RIGHTS_ISSUE' },
  { pattern: /\b(qip|qualified institutional placement|preferential allotment)\b/i, type: 'QIP_PLACEMENT' },
  { pattern: /\b(demerg\w*|de-?merger|scheme of arrangement|nclt approves|nclt sanctions|hive.?off)\b/i, type: 'DEMERGER_INDIA' },
  { pattern: /\b(ipo (?:of|for) (?:its|the)?\s*(?:subsidiary|arm|unit|division|business)|to list (?:its|the)?\s*(?:subsidiary|arm|unit|division)|plan(?:s)? .{0,30}ipo (?:of|for))\b/i, type: 'IPO_SUBSIDIARY' },
  { pattern: /\b(spin.?off|spinoff|carve.?out|split.?off|business separation|breakup|to spin (?:off|out))\b/i, type: 'SPIN_OFF' },
  { pattern: /\b(definitive (?:agreement|merger)|all.?cash deal|all.?stock deal|merger agreement|cci approves|definitive agreement)\b/i, type: 'MERGER_DEFINITIVE' },
  { pattern: /\b(acquir(?:e|ed|es|ing)|acquisition|merger|merge with|buyout|buys (?:its|stake)|sells (?:its|business|stake)|stake (?:sale|acquisition))\b/i, type: 'ACQUISITION_PUBLIC',
    reject: /\b(rumou?r|may consider|in talks|reportedly weighing|denied|withdrew|called off)\b/i },
  { pattern: /\b(back to profit|loss to profit|swung to profit|first profit (?:after|since)|narrowed (?:loss|losses)|debt restructur|debt reduction|deleverag|recapitalis|emerges? from (?:bankruptcy|restructur|losses)|cdr exit|insolvency exit|debt resolution)\b/i,
    type: 'TURNAROUND_OPERATING',
    reject: /\b(failed turnaround|swung to loss|widening loss)\b/i },
  { pattern: /\b(turnaround|profit revival|improved (?:its|the))\b/i, type: 'TURNAROUND_NARRATIVE' },
  { pattern: /\b(rumou?r(?:ed|s)?|in talks (?:to|with)|reportedly weighing|exploring sale)\b/i, type: 'NEWS_RUMOR' },
];

const AMENDMENT_PATTERN = /\/A(?:\d*)\b/i;
const FUND_PATTERN = /\b(fund|trust|capital evergreen|infrastructure income|private markets fund|closed-end|etf)\b/i;

export function extractEventSignals(args: { title: string; description?: string; link?: string; source?: string }): EventSignals {
  const text = `${args.title} ${args.description || ''}`;
  const isAmendment = AMENDMENT_PATTERN.test(args.title);

  // Parse target name from SEC titles like "10-12B - Mobility Global Inc. (0001234) (Filer)"
  let target_name: string | undefined;
  let filing_form: string | undefined;
  const secTitleMatch = args.title.match(/^([A-Z0-9-/\s]+)\s*-\s*(.+?)(?:\s*\([\d ]+\))?(?:\s*\([^)]*\))?$/);
  if (secTitleMatch) {
    filing_form = secTitleMatch[1].trim();
    target_name = secTitleMatch[2].trim();
  }

  // Layer 1: SEC form-strict
  for (const f of SEC_FORM_MAP) {
    if (f.pattern.test(text)) {
      return { event_type: f.type, is_amendment: isAmendment, target_name, filing_form };
    }
  }

  // Layer 2: India / general pattern match
  for (const p of INDIA_PATTERNS) {
    if (p.pattern.test(text)) {
      if (p.reject && p.reject.test(text)) continue;
      return { event_type: p.type, is_amendment: false, target_name };
    }
  }

  return { event_type: 'UNCLASSIFIED', is_amendment: false, target_name };
}

// ─── Canonical event ID ─────────────────────────────────────────────────────

export function canonicalEventId(args: { event_type: EventType; target_name?: string; tickers?: string[] }): string {
  // Use ticker as the strongest identity signal; fallback to target name.
  const idKey = (args.tickers && args.tickers.length > 0)
    ? args.tickers[0].toUpperCase()
    : (args.target_name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
  const h = createHash('sha1').update(`${args.event_type}::${idKey}`).digest('hex').slice(0, 12);
  return `EV_${args.event_type}_${h}`;
}

// ─── Catalyst scoring ───────────────────────────────────────────────────────

export interface CatalystScoreInputs {
  event_type: EventType;
  is_amendment: boolean;
  is_fund: boolean;
  has_named_ticker: boolean;
  has_primary_source: boolean;       // SEC / exchange / press release vs media
  has_explicit_deadline: boolean;    // any date pattern in title/desc
  has_consideration: boolean;        // $X / Rs X / x.y x EBITDA in text
  has_spread_calc: boolean;
  age_hours: number;
  // PATCH 0447 IMP-1 — institutional source tier + speculation penalty.
  // source_tier mirrors how event-driven hedge funds rank evidence:
  //   1 = exchange filing (NSE corp-actions, BSE corp-announcements, SEC EDGAR)
  //   2 = press release (PRN / GlobeNewswire / BusinessWire / company website)
  //   3 = vertical specialist trade press (Mergermarket, Reorg Research, etc.)
  //   4 = general media aggregator (ET, Livemint, Yahoo Finance, MarketsMojo)
  // speculation_penalty applies when the headline uses hedging language
  // ('could acquire', 'in talks', 'exploring', 'buzzing stocks') — these are
  // not actionable catalysts and should not outrank real definitive filings.
  source_tier?: 1 | 2 | 3 | 4;
  speculation_penalty?: boolean;
}

export interface CatalystScore {
  raw_score: number;
  decay_score: number;
  components: Array<{ label: string; pts: number }>;
}

// PATCH 0459 IMP-3 — Event-specific time-decay curves. Earlier version
// used compressed half-lives (14-90d) which made every event evaporate
// from the leaderboard within 1-2 months. Institutional priors per audit:
//   • Buyback tender: 30-60d (≈45d half-life)
//   • Open offer: 90-180d (≈135d)
//   • M&A definitive: 90-180d
//   • Going private: 60-120d
//   • Spin-off / demerger: 9-18 months (≈360d) — forced flow persists
//   • Rights / QIP / PIPE: 6-18 months (≈270d) — warrant conversion + dilution unwind
//   • Convertible PIPE: 12-24 months
//   • NCLT / IBC: 1-3 years (≈540d) — multi-year resolution lifecycle
//   • Index inclusion: 60-90d (≈75d)
//   • HoldCo arb / stub trades: 9-18 months
//   • Governance crisis: 60-180d
//   • Turnaround operating: 60-120d (cycle gives time to verify)
//   • Bonus / split: 14-30d (mechanical, short-lived)
function eventHalfLifeDays(t: EventType): number {
  switch (t) {
    // ── Forced-flow / structural — long persistence ──────────────────
    case 'SPIN_OFF':
    case 'DEMERGER_INDIA':
    case 'IPO_SUBSIDIARY':
      return 360;
    case 'HOLDCO_ARB_TRIGGER':
    case 'STUB_TRADE_TRIGGER':
      return 365;
    // ── M&A / open offer / take-private — multi-month ────────────────
    case 'MERGER_DEFINITIVE':
    case 'MERGER_RECOMMENDATION':
    case 'ACQUISITION_PUBLIC':
      return 150;
    case 'OPEN_OFFER':
      return 135;
    case 'TENDER_OFFER':
      return 120;
    case 'GOING_PRIVATE':
      return 100;
    // ── Capital allocation — recurring quarterly events ──────────────
    case 'BUYBACK_TENDER':
      return 45;
    case 'BUYBACK_OPEN_MARKET':
      return 60;
    case 'DIVIDEND_HIKE':
      return 30;
    // ── Rights / PIPE / warrants — dilution overhang multi-quarter ───
    case 'RIGHTS_ISSUE':
    case 'RIGHTS_ISSUE_DEEP':
      return 180;
    case 'QIP_PLACEMENT':
      return 90;
    case 'CONVERTIBLE_PIPE':
    case 'PROMOTER_BACKSTOP':
      return 365;
    // ── Asset / stake monetisation ──────────────────────────────────
    case 'ASSET_SALE_MONETIZATION':
    case 'STAKE_SALE':
      return 120;
    // ── Distressed — long lifecycle ─────────────────────────────────
    case 'NCLT_IBC_ADMISSION':
    case 'NCLT_IBC_RESOLUTION':
      return 540;
    case 'TURNAROUND_OPERATING':
      return 120;
    // ── Index inclusion / exclusion ────────────────────────────────
    case 'INDEX_INCLUSION':
    case 'INDEX_EXCLUSION':
      return 75;
    // ── Governance ─────────────────────────────────────────────────
    case 'GOVERNANCE_CRISIS':
    case 'SEBI_REGULATORY_ACTION':
    case 'AUDITOR_QUALIFIED':
    case 'PROMOTER_PLEDGE_UNWIND':
      return 90;
    // ── Bonus / split — mechanical, fades fast ────────────────────
    case 'BONUS_ISSUE':
    case 'STOCK_SPLIT':
      return 21;
    // ── Soft / speculative ─────────────────────────────────────────
    case 'TURNAROUND_NARRATIVE':
    case 'NEWS_RUMOR':
      return 7;
    default:
      return 30;
  }
}

const PRIMARY_SOURCE_RE = /sec\.gov|bseindia\.com|nseindia\.com|sebi\.gov|press release|prnewswire|globe ?newswire|business ?wire/i;
const DEADLINE_RE = /\b(\d{1,2}\s*(?:may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar|apr)|record date|tender (?:expir|deadline)|effective date|listing date|hearing date|expir(?:y|es) (?:on|date)|by\s+\w+\s+\d+|deadline)\b/i;
const CONSIDERATION_RE = /(\$\s*\d|rs\.?\s*\d|₹\s*\d|deal worth|offer price|per share|gross spread|consideration)/i;

export function scoreCatalyst(inp: CatalystScoreInputs): CatalystScore {
  const components: Array<{ label: string; pts: number }> = [];
  let raw = 0;

  // POSITIVE
  // +30 definitive filing — non-amendment AND form-based event type
  const isDefinitive = !inp.is_amendment && [
    'SPIN_OFF', 'TENDER_OFFER', 'GOING_PRIVATE', 'MERGER_DEFINITIVE',
    'MERGER_RECOMMENDATION', 'OPEN_OFFER', 'DEMERGER_INDIA', 'BUYBACK_TENDER',
  ].includes(inp.event_type);
  if (isDefinitive) { raw += 30; components.push({ label: '+30 definitive filing', pts: 30 }); }

  // +20 named listed ticker
  if (inp.has_named_ticker) { raw += 20; components.push({ label: '+20 named listed ticker', pts: 20 }); }

  // +15 explicit date/deadline within 30 days
  if (inp.has_explicit_deadline) { raw += 15; components.push({ label: '+15 explicit deadline', pts: 15 }); }

  // +15 deal consideration disclosed
  if (inp.has_consideration) { raw += 15; components.push({ label: '+15 consideration disclosed', pts: 15 }); }

  // +10 spread / stub value calculable
  if (inp.has_spread_calc) { raw += 10; components.push({ label: '+10 spread calculable', pts: 10 }); }

  // NEGATIVE
  if (inp.is_amendment) { raw -= 20; components.push({ label: '-20 amendment-only filing', pts: -20 }); }
  if (inp.is_fund) { raw -= 15; components.push({ label: '-15 fund/closed-end housekeeping', pts: -15 }); }
  if (!inp.has_primary_source) { raw -= 10; components.push({ label: '-10 no primary-source link', pts: -10 }); }

  // PATCH 0447 IMP-1 — Source-tier boost (institutional hierarchy).
  //   Tier 1 (exchange filing): +20
  //   Tier 2 (press release):   +10
  //   Tier 3 (specialist press): +5
  //   Tier 4 (general aggregator): no boost — relies on PRIMARY signal only.
  // The boost is additive to the existing +30 'definitive filing' which is
  // event-type-driven; together they let SC TO-T / NSE corp-action filings
  // rank above an ET 'sources say' rehash of the same news.
  switch (inp.source_tier) {
    case 1: raw += 20; components.push({ label: '+20 exchange filing (T1)', pts: 20 }); break;
    case 2: raw += 10; components.push({ label: '+10 press release (T2)', pts: 10 }); break;
    case 3: raw += 5;  components.push({ label: '+5 specialist press (T3)', pts: 5 }); break;
    default: break;
  }

  // PATCH 0447 IMP-1 — Speculation penalty. Hedging headlines ('could
  // acquire', 'may consider', 'in talks', 'exploring', 'buzzing stocks',
  // 'reportedly weighing') are NOT actionable. Heavy -15 so they can't
  // outrank a definitive filing even if they shout louder.
  if (inp.speculation_penalty) { raw -= 15; components.push({ label: '-15 speculative headline', pts: -15 }); }

  // Decay (age-adjusted)
  const halfLife = eventHalfLifeDays(inp.event_type);
  const ageDays = Math.max(0, inp.age_hours / 24);
  const decayMultiplier = Math.pow(0.5, ageDays / halfLife);
  const decay_score = Math.round(raw * decayMultiplier * 10) / 10;

  return { raw_score: raw, decay_score, components };
}

// ─── Tradability filter ─────────────────────────────────────────────────────

export interface TradabilityInputs {
  event_type: EventType;
  is_amendment: boolean;
  amendment_count_in_event: number;
  is_fund: boolean;
  has_named_ticker: boolean;
  has_primary_source: boolean;
  decay_score: number;
  // PATCH 0120 — IMP-03: optional title/desc for content-based rejection
  title?: string;
  description?: string;
}

// PATCH 0120 — IMP-03: untradable-for-India-retail patterns.
// Spec Sit Tier 2 was surfacing events the user can't actually trade:
//   - REIT / InvIT consolidation (different instrument class)
//   - European bank consolidation (no listing on NSE/BSE, no GDR)
//   - VRS (voluntary retirement scheme) — operating noise, not catalyst
//   - SPAC merger announcements with no India listing
//   - Distressed-debt / NCLT-only proceedings (resolution prof, not equity)
// Each pattern uses word boundaries to avoid false positives.
const UNTRADABLE_FOR_INDIA_RETAIL: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(reit|invit|real estate investment trust|infrastructure investment trust)\b/i,
    reason: 'REIT / InvIT — different instrument class, separate analysis frame' },
  { pattern: /\b(vrs|voluntary retirement scheme|voluntary separation)\b/i,
    reason: 'VRS — operating restructuring, not a discrete equity catalyst' },
  { pattern: /\b(commerzbank|deutsche bank|bnp paribas|credit suisse|ubs|santander|hsbc holdings|barclays plc|natwest|lloyds)\b.*\b(merger|consolidation|tie[- ]?up|takeover)\b/i,
    reason: 'European bank consolidation — no NSE/BSE/GDR listing for India retail' },
  { pattern: /\b(spac|special purpose acquisition company)\b.*\b(combination|merger|business combination)\b/i,
    reason: 'SPAC combination — US-listed only, no India retail access' },
  // PATCH 0461 — narrow NCLT match to insolvency-specific phrasing. The
  // previous regex matched bare 'nclt' anywhere, which incorrectly rejected
  // DEMERGER_INDIA / scheme-of-arrangement filings (those route through
  // NCLT too, but for approval — not insolvency). Now we require the NCLT
  // context to be insolvency / liquidation, OR independent insolvency
  // phrases. Demerger / scheme / sanction NCLT filings now pass through.
  { pattern: /\b(nclt[^.]{0,40}(insolvency|liquidation|cirp|moratorium|admit(ted)?)|insolvency.{0,20}resolution|corporate insolvency resolution|cirp|liquidation order)\b/i,
    reason: 'NCLT insolvency — equity typically extinguished, no upside trade' },
];

export interface TradabilityResult {
  is_tradable: boolean;
  tier: 'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE';
  rationale: string;
}

export function classifyTradability(inp: TradabilityInputs): TradabilityResult {
  // PATCH 0120 — IMP-03: untradable-for-India-retail content reject.
  // Runs first so REIT / European bank / VRS / SPAC / NCLT events drop
  // straight to NOISE before any tier classification.
  const blob = `${inp.title || ''} ${inp.description || ''}`;
  if (blob.trim()) {
    for (const rule of UNTRADABLE_FOR_INDIA_RETAIL) {
      if (rule.pattern.test(blob)) {
        return { is_tradable: false, tier: 'NOISE', rationale: rule.reason };
      }
    }
  }
  // Hard reject: fund-only events without explicit user request
  if (inp.is_fund) {
    return { is_tradable: false, tier: 'NOISE', rationale: 'Fund / closed-end housekeeping — not a public-equity catalyst' };
  }
  // Hard reject: amendment-only event with no original definitive filing
  if (inp.is_amendment && inp.amendment_count_in_event === 0) {
    return { is_tradable: false, tier: 'NOISE', rationale: 'Amendment without primary filing in our window' };
  }
  // Reject: rumor / unclassified with weak signal
  if (inp.event_type === 'NEWS_RUMOR' || inp.event_type === 'UNCLASSIFIED') {
    return { is_tradable: false, tier: 'NOISE', rationale: 'Rumour / unclassified — wait for definitive filing' };
  }
  // Reject: turnaround narrative without operating trigger
  if (inp.event_type === 'TURNAROUND_NARRATIVE') {
    return { is_tradable: true, tier: 'WATCHLIST', rationale: 'Operating commentary — track but not a discrete catalyst' };
  }
  // Tier 1: definitive event + named ticker + primary source + decay > 20
  const isHardCatalyst = [
    'TENDER_OFFER', 'GOING_PRIVATE', 'MERGER_DEFINITIVE', 'SPIN_OFF',
    'OPEN_OFFER', 'DEMERGER_INDIA', 'IPO_SUBSIDIARY', 'BUYBACK_TENDER',
  ].includes(inp.event_type);
  if (isHardCatalyst && inp.has_named_ticker && inp.has_primary_source && inp.decay_score >= 20) {
    return { is_tradable: true, tier: 'TIER_1', rationale: 'Hard catalyst · named ticker · primary source · time-bounded payoff' };
  }
  // Tier 2: tradable but weaker
  if (isHardCatalyst || inp.event_type === 'ACQUISITION_PUBLIC' || inp.event_type === 'STAKE_SALE') {
    return { is_tradable: true, tier: 'TIER_2', rationale: 'Tradable but missing one of: ticker / primary source / decay' };
  }
  // Watchlist: dividend hikes, bonus issues, capital allocation — softer
  return { is_tradable: true, tier: 'WATCHLIST', rationale: 'Capital allocation signal — track, not actionable solo' };
}

// ─── Auto-generated "why tradable" block ───────────────────────────────────

export function whyTradable(args: { event_type: EventType; target_name?: string; ticker?: string }): {
  what_happened: string;
  what_matters: string;
  what_to_watch: string;
  what_breaks_thesis: string;
} {
  const target = args.target_name || args.ticker || 'the issuer';
  switch (args.event_type) {
    case 'TENDER_OFFER':
      return {
        what_happened: `Third-party or issuer tender offer filed for ${target}.`,
        what_matters: 'Hard cash spread — buy below offer price, tender, capture premium. Annualized return = spread ÷ months to close.',
        what_to_watch: 'Tender expiry date · acceptance ratio · proration if oversubscribed · regulatory close conditions.',
        what_breaks_thesis: 'Deal break (antitrust / minority shareholder dissent) — drops to standalone fundamentals.',
      };
    case 'GOING_PRIVATE':
      return {
        what_happened: `${target} filed an SC 13E-3 going-private transaction.`,
        what_matters: 'Insider/PE buyout at premium to market — typical 20–40% premium for control.',
        what_to_watch: 'Fairness opinion · special committee independence · MFW protections · vote threshold.',
        what_breaks_thesis: 'Inadequate price → minority dissent → litigation appraisal action.',
      };
    case 'SPIN_OFF':
      return {
        what_happened: `${target} filed a Form 10-12B/12G — spin-off prospectus.`,
        what_matters: 'Index funds / ETFs forced to sell stub → mispricing in months 1–3 post-listing.',
        what_to_watch: 'Distribution ratio · record date · listing date · when-issued trading · parent/child capital structure.',
        what_breaks_thesis: 'Stub absorbs heavy debt or operates in declining segment ("spin the trash" pattern).',
      };
    case 'DEMERGER_INDIA':
      return {
        what_happened: `${target} filed scheme of arrangement / NCLT approval for demerger.`,
        what_matters: 'Conglomerate discount unlocks → 4 standalone entities re-rate independently. Pre-record holders get the basket free.',
        what_to_watch: 'Record date · NCLT effective date · listing of demerged entities · debt allocation per entity.',
        what_breaks_thesis: 'Heavy debt allocated to weak entity (e.g. cyclical with thin equity) → forced selling on listing.',
      };
    case 'MERGER_DEFINITIVE':
      return {
        what_happened: `Definitive merger agreement signed for ${target}.`,
        what_matters: 'Deal terms locked → cash spread (or stock+cash effective consideration) is the trade.',
        what_to_watch: 'HSR clearance · shareholder vote · regulatory approvals · MAC clauses · expected close window.',
        what_breaks_thesis: 'Antitrust block · regulatory delay · MAC trigger · acquirer financing failure.',
      };
    case 'OPEN_OFFER':
      return {
        what_happened: `Open offer disclosed for ${target} (SEBI takeover code).`,
        what_matters: 'Offer price floor · acceptance math depends on minority/promoter mix · timing-bounded.',
        what_to_watch: 'Offer period · acceptance ratio · price revisions · escrow funding.',
        what_breaks_thesis: 'Offer fails minimum acceptance threshold → falls through, re-opens to market price.',
      };
    case 'IPO_SUBSIDIARY':
      return {
        what_happened: `${target} announced IPO / listing of a subsidiary or division.`,
        what_matters: 'Parent unlocks holdco discount on the listed value of the subsidiary stake. Re-rating of parent often follows.',
        what_to_watch: 'Pricing band · subscription levels · listing date · post-listing parent stake · index inclusion of new entity.',
        what_breaks_thesis: 'Weak listing pop — parent re-rating delays or reverses. Subsidiary debt allocation inferior.',
      };
    case 'BUYBACK_TENDER':
      return {
        what_happened: `${target} announced tender-route buyback at premium.`,
        what_matters: 'Premium to CMP × acceptance ratio = expected return. SEBI reserved 15% pool helps small holders (≤₹2L) materially more than large.',
        what_to_watch: 'Record date · promoter participation · acceptance ratio (general vs reserved) · post-buyback fundamentals.',
        what_breaks_thesis: 'Promoter participates → large-holder acceptance collapses to 5–10%, premium not captured.',
      };
    case 'TURNAROUND_OPERATING':
      return {
        what_happened: `${target} disclosed operating turnaround trigger (debt resolution / first profit / restart).`,
        what_matters: 'Hard inflection — distressed multiples re-rate to going-concern multiples.',
        what_to_watch: 'Quarterly margin sustainability · debt schedule · bank covenants · capital infusion terms.',
        what_breaks_thesis: 'Operating improvement was one-off (asset sale, accounting) — reverts in 1–2 quarters.',
      };
    case 'RIGHTS_ISSUE':
      return {
        what_happened: `${target} announced rights issue.`,
        what_matters: 'Discount to CMP creates either accretion (if subscribed) or dilution (if dropped). Trade the rights themselves where listed.',
        what_to_watch: 'Issue price vs CMP · subscription levels · use of proceeds · promoter participation.',
        what_breaks_thesis: 'Heavy dilution + weak operating use → permanent re-rating lower.',
      };
    case 'BONUS_ISSUE':
    case 'STOCK_SPLIT':
      return {
        what_happened: `${target} announced bonus issue / stock split.`,
        what_matters: 'Cosmetic — share count up, price down proportionally. Liquidity / retail-accessibility benefit only.',
        what_to_watch: 'Record date · ex-bonus date · post-event liquidity uptick.',
        what_breaks_thesis: 'No fundamental thesis — pure mechanics.',
      };
    default:
      return {
        what_happened: `${target} — corporate event of type ${args.event_type.replace(/_/g, ' ').toLowerCase()}.`,
        what_matters: 'Track for primary-source confirmation.',
        what_to_watch: 'Definitive filing · named ticker · timeline.',
        what_breaks_thesis: 'Event downgrades to rumour / fails to materialize.',
      };
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

export function inferLifecycleStage(args: { is_amendment: boolean; amendment_count: number; event_type: EventType }): LifecycleStage {
  if (args.event_type === 'NEWS_RUMOR') return 'rumor';
  if (args.amendment_count >= 1) return 'amended';
  if (args.is_amendment && args.amendment_count === 0) return 'amended';
  return 'announced';
}
