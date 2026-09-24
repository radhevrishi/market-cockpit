// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE RESEARCH VIEW MODEL.                        (zzz770)
//
// One pure function turns what the pipeline already produced (the day's
// catalyst findings, the scanned board, the filed-result rows and the owner's
// book) into what the page shows: a research queue ranked by research value,
// with every claim traced to a source and every unknown stated as unknown.
//
//   PRICE MOVE → EVENT → EVIDENCE → ECONOMIC TRANSMISSION → EXPECTATION GAP
//   → RESEARCH ACTION
//
// CONTRACT: the page renders ONLY from ResearchView. The shapes below are the
// contract between the pipeline and the UI; change them only together.
// Nothing here reads a price as an exit or buy signal, and nothing here may
// invent a figure the evidence does not state — a missing value is null and
// is printed as "Not disclosed".
//
// PURE AND DETERMINISTIC: no clock, no network, no server import. The same
// input always yields the same view (the page may call it client-side).
// Price is context: the size of the move is never a ranking input — it only
// enters through the expectation GAP (move vs fundamental change).
// ═══════════════════════════════════════════════════════════════════════════

import type { Finding } from './catalyst-research';
import { presentErrorLines } from './research-present';

/** The six states every gainer ends in (spec §4), plus data states. */
export type EventClass =
  | 'CONFIRMED_MATERIAL'          // A — verified, economically meaningful
  | 'CONFIRMED_LOW_MATERIALITY'   // B — real, too small to explain the move
  | 'POTENTIAL_UNVERIFIED'        // C — something exists, not verified
  | 'NEGATIVE'                    // D — negative / contrary / denied
  | 'NO_CATALYST'                 // E — no credible event found
  | 'MARKET_MOVE_ONLY'            // F — band print / technical, no event
  | 'LISTING'                     // recent listing — excluded from comparison
  | 'DATA_UNAVAILABLE';           // sources failed — NOT "no catalyst"

/** Standard event taxonomy (spec §18). */
export type EventType =
  | 'Earnings' | 'Order win' | 'Order cancellation' | 'Capacity expansion' | 'Production ramp'
  | 'New product' | 'Customer win' | 'Pricing' | 'Acquisition' | 'Divestment' | 'JV'
  | 'Regulatory approval' | 'Contract' | 'Partnership' | 'Buyback' | 'Fundraising'
  | 'Debt / refinancing' | 'Management change' | 'Governance' | 'Guidance' | 'Rating action'
  | 'Litigation / regulatory' | 'Accident / disruption' | 'Denial' | 'No identified catalyst'
  | 'Market/technical move';

/** Strict stage ladder (spec §19). */
export type Stage = 'RUMOUR' | 'PROPOSED' | 'ENABLING' | 'SIGNED' | 'AWARDED' | 'EXECUTED' | 'OPERATIONAL' | 'MONETIZING' | 'UNKNOWN';

/** Source confidence (spec §20). */
export type SourceConfidence = 'VERIFIED_DOCUMENT' | 'VERIFIED_FILING' | 'SECONDARY_SUMMARY' | 'UNVERIFIED';

/** How the event reaches the income statement (spec §9). */
export type Transmission = 'DIRECT' | 'NEAR_TERM' | 'LONG_TERM' | 'WEAK' | 'NONE';

export type Persistence = 'DAYS' | 'QUARTER' | 'YEARS' | 'UNKNOWN';
export type GapLevel = 'LARGE' | 'MODERATE' | 'SMALL' | 'UNKNOWN';
export type PortfolioRelevance = 'HOLDING' | 'WATCHLIST' | 'SAME_THEME' | 'UNRELATED';
/** The only actions this view ever names — never a trade instruction. */
export type ResearchAction = 'Review' | 'Investigate' | 'Monitor' | 'Thesis evidence' | 'No catalyst' | 'Negative evidence';

export interface MaterialityRatio {
  /** What the event value is divided by. */
  basis: 'market_cap' | 'ttm_revenue' | 'annual_revenue' | 'order_book' | 'current_capacity' | 'ebitda' | 'assets';
  pct: number;
  /** e.g. "₹488 Cr ÷ ₹1,020 Cr TTM revenue = 47.8%" — the arithmetic, shown. */
  text: string;
}

export interface Materiality {
  label: 'SIGNIFICANT' | 'MODERATE' | 'SMALL' | 'UNKNOWN';
  ratios: MaterialityRatio[];
  /** One line: why this label. "Not disclosed" when no value exists. */
  explanation: string;
}

export interface EarningsMini {
  revenueYoY: number | null; revenueQoQ: number | null;
  ebitdaYoY: number | null; marginNow: number | null; marginPrior: number | null;
  patYoY: number | null; cfoToPat: number | null;
  guidance: 'RAISED' | 'MAINTAINED' | 'CUT' | 'NOT_STATED';
  orderBook: 'UP' | 'DOWN' | 'UNCHANGED' | 'NOT_STATED';
  keyChange: string | null;
  filedDaysAgo: number | null;
  /** Optional detail (zzz770 AG-A): the grader's tier, quarter and filing date. */
  tier?: string | null;
  quarter?: string | null;
  filedDate?: string | null;
  /** Filed more than CATALYST_WINDOWS.recent (14) days ago: context for the
   *  move, never its catalyst (zzz771 — was 20d). */
  stale?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CATALYST WINDOWS (zzz771) — the ONE table that says how old an event can be
// and still be this session's catalyst. India boards carry a 1-day move, so a
// filing more than 3 days old cannot be its trigger; US boards carry a 1-week
// move, so the window is a week. Between the window and 14 days a delayed
// reaction is possible (RECENT). Beyond 14 days the event is real but it is
// older CONTEXT: PASUPTAC's Q1 result filed 47 days before a +7.3% session
// was ranked #5 as "CONFIRMED MATERIAL EVENT" — the class was right, the
// attribution was not.
// ═══════════════════════════════════════════════════════════════════════════

export const CATALYST_WINDOWS: Record<'IN' | 'US', { thisMove: number; recent: number }> = {
  IN: { thisMove: 3, recent: 14 },
  US: { thisMove: 7, recent: 14 },
};

export function catalystForOf(market: 'IN' | 'US', ageDays: number | null | undefined): NonNullable<ResearchItem['catalystFor']> {
  if (ageDays == null || !Number.isFinite(ageDays)) return 'RECENT';   // unknown age: neither claimed nor dismissed
  const w = CATALYST_WINDOWS[market];
  return ageDays <= w.thisMove ? 'THIS_MOVE' : ageDays <= w.recent ? 'RECENT' : 'CONTEXT';
}

/** A bare BSE scrip code ("544501") is not a name anyone recognises: the
 *  company is shown first and the code small. (zzz771) */
export function displayNameOf(ticker: string, company: string | null): { displayTicker: string; displayCode: string | null } {
  const t = String(ticker || '').trim();
  const name = company ? String(company).replace(/\s*\((india|ltd|limited)\)\s*$/i, '').replace(/[\s,]*\b(limited|ltd|pvt|private|inc|corp|corporation|plc)\b\.?\s*$/i, '').replace(/[\s,.-]+$/, '').trim() : '';
  if (/^\d+$/.test(t) && name) return { displayTicker: name, displayCode: t };
  return { displayTicker: t, displayCode: null };
}

export interface ResearchItem {
  /** zzz775: the pricing assessment from the finding (reaction since the
   *  filing vs the event's size) — shown as PRICED instead of "UNKNOWN". */
  pricing?: { state: string; label: string; text: string } | null;
  /** Press coverage for the name — secondary, never scored. (zzz773) */
  news?: { narrative: { label: string; days: number; firstDate: string; lastDate: string; lead: string } | null; items: Array<{ title: string; url: string; date: string; source: string }> } | null;
  ticker: string;
  company: string | null;
  market: 'IN' | 'US';
  /** The one-session move. US boards carry a 1-WEEK move, so this is null
   *  there and the move sits in `returns.w1` (see `move`). */
  move1d: number | null;
  returns: { w1: number | null; m1: number | null; m3: number | null };
  marketCap: number | null;
  eventClass: EventClass;
  eventType: EventType;
  /** One line: what happened, in the filing's own proper nouns. */
  headline: string;
  /** Concrete change with numbers when verified; null when not established. */
  whatChanged: string | null;
  before: string | null;
  after: string | null;
  filedDate: string | null;
  stage: Stage;
  sourceConfidence: SourceConfidence;
  sourceUrl: string | null;
  quote: string | null;
  materiality: Materiality;
  transmission: Transmission;
  /** EVENT → DRIVER → REVENUE → MARGIN → EPS/FCF → VALUATION; unsupported steps say "TBD" / "Not disclosed". */
  transmissionChain: string[];
  persistence: Persistence;
  /** zzz782: evidence that it WILL persist — separate from the potential duration above. */
  persistenceEvidence?: { level: PersistEvidenceLevel; text: string };
  /** zzz782: a tax / penalty demand under 0.25% of market cap. */
  immaterialNegative?: boolean;
  /** zzz780: persistent-catalyst test of the event (never price). */
  persistentCatalyst?: import('@/lib/catalyst/persistence').PersistSummary | null;
  expectationGap: { level: GapLevel; text: string; direction?: 'EXPECTATION_HEAVY' | 'UNDER_REFLECTED' | 'ALIGNED' | null };
  /** Named unknowns: "Order margin: Not disclosed", "Revenue timing: Not disclosed". */
  unknowns: string[];
  /** 3–5 concrete questions for the event type. */
  researchNext: string[];
  /** The one-sentence reason this deserves research time (spec §41). */
  whyResearch: string;
  portfolio: { relevance: PortfolioRelevance; thesisVariable: string | null; note: string | null };
  earnings: EarningsMini | null;
  flags: { band: number | null; listing: boolean; dilution: boolean; denial: boolean; turnover: number | null };
  /** 0–100 research priority; never the size of the move. */
  priority: number;
  /** Human reasons behind the priority ("Fresh event", "Material vs revenue", …). */
  priorityReasons: string[];
  /** Raw numeric components for the collapsible "Score details". */
  scoreDetails: Record<string, number> | null;
  // ── optional additions (zzz770 AG-A) ──
  /** Display label finer than the taxonomy: "Letter of intent (not an order)". */
  eventLabel?: string;
  /** Review / Investigate / Monitor / Thesis evidence / No catalyst / Negative evidence. */
  action?: ResearchAction;
  /** The move as measured, with its window: '1D' (India session) or '1W' (US export). */
  move?: { pct: number | null; window: '1D' | '1W' };
  /** The pipeline's own finding status (catalyst / denied / none …) for audit. */
  findingStatus?: string | null;
  /** The finding's caveat notes, decoded. */
  notes?: string[];
  /** Days since the event's source was filed. */
  ageDays?: number | null;
  /** ── zzz771 CONTRACT (AG-1 fills, AG-2 renders) ─────────────────────────
   *  Whether this event can be the catalyst for THIS session's move.
   *  THIS_MOVE: filed within the move window (IN ≤3d, US ≤7d).
   *  RECENT: 4–14d — a delayed reaction is possible; stays in the queue with a freshness penalty.
   *  CONTEXT: >14d — a real event, but older context; never the catalyst, never in the queue/top3/confirmed counts. */
  catalystFor?: 'THIS_MOVE' | 'RECENT' | 'CONTEXT';
  /** Company name first when the ticker is a bare BSE scrip code ("544501"). */
  displayTicker?: string;
  /** Secondary code shown small when displayTicker is the name. */
  displayCode?: string | null;
  /** For NO_CATALYST rows: what was actually scanned, so "no catalyst" is never read as "nothing happened". */
  scanNote?: string | null;
}

export interface ResearchView {
  session: {
    date: string | null; scanAt: string | null; status: string; cached: boolean;
    /** Optional (zzz770 AG-A): human label and whether the move is today's. */
    label?: string | null; isToday?: boolean | null; note?: string | null;
  };
  summary: {
    scanned: number; confirmed: number; potential: number; negative: number;
    noCatalyst: number; queue: number; portfolioMatches: number; dataUnavailable: number;
    /** Optional detail (zzz770 AG-A). */
    lowMateriality?: number; marketMoveOnly?: number; listings?: number; unresearched?: number; watch?: number;
    /** zzz771: older filings behind names on the board — context, not this move's catalyst. */
    context?: number;
  };
  top3: ResearchItem[];
  /** Full research queue, 10–15, ranked by priority. */
  queue: ResearchItem[];
  /** Watch / investigate, 10–20. */
  watch: ResearchItem[];
  negative: ResearchItem[];
  /** zzz782: tax / penalty items under 0.25% of market cap — shown, not ranked as negative evidence. */
  immaterialNegative?: ResearchItem[];
  noCatalyst: ResearchItem[];
  /** Recent listings and other data-quality exclusions. */
  dataQuality: ResearchItem[];
  sourceFailures: Array<{ ticker: string; text: string; full: string; news?: ResearchItem['news'] }>;
  /** Filings WERE checked; only a secondary input (price history) failed.
   *  Kept apart so "not checked" means exactly that. (zzz773) */
  partialFailures?: Array<{ ticker: string; text: string; full: string }>;
  portfolio: ResearchItem[];
  /** zzz771: items whose only event is older than the move window (catalystFor === 'CONTEXT'),
   *  ranked by their own priority. Rendered collapsed under "Older filings — context, not the catalyst". */
  context?: ResearchItem[];
}

export interface ResearchViewInput {
  market: 'IN' | 'US';
  findings: Record<string, Finding>;
  /** Today's scanned board (ticker, company, move, market cap, perf …). */
  board: Array<{ ticker: string; company: string | null; move_pct: number | null; market_cap?: number | null; perf?: any; turnover?: number | null }>;
  /** Filed-result rows from the graded funnel (the scan's queue rows). */
  filedResults: any[];
  /** Held tickers (upper-case) and watchlist tickers. */
  holdings: string[];
  watchlist?: string[];
  /** Optional per-holding thesis variable hints: ticker → variable keys. */
  thesisVariables?: Record<string, string[]>;
  errors?: string[];
  session?: ResearchView['session'];
  /** Optional (zzz770 AG-A): tickers sharing a theme with the book. */
  sameTheme?: string[];
  /** Optional ISO instant used to age a filed result that carries only a
   *  date. Never read from the clock: the builder stays deterministic. */
  now?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// small helpers
// ═══════════════════════════════════════════════════════════════════════════

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const r1 = (v: number) => Math.round(v * 10) / 10;
const pctS = (v: number | null | undefined) => (v == null ? 'Not disclosed' : `${v >= 0 ? '+' : ''}${r1(v).toFixed(1)}%`);
const money = (v: number, m: 'IN' | 'US') => (m === 'IN'
  ? `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : r1(v).toString()} Cr`
  : v >= 1000 ? `$${r1(v / 1000)}B` : `$${v >= 100 ? Math.round(v) : r1(v)}M`);
const up = (s: any) => String(s || '').trim().toUpperCase();

/** Source text keeps its words, but a shouted rating token is never passed
 *  through as if it were this page's instruction. */
function clean(s: any): string {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\b(BUY|SELL|EXIT|STOP)\b/g, (w) => w.toLowerCase())
    .replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// FILED RESULTS → EarningsMini
// Accepts a raw graded row, the scan's `filed_results` row, or a scan queue
// row carrying `filed: {...}`.
// ═══════════════════════════════════════════════════════════════════════════

interface FiledRow {
  ticker: string; company: string | null; tier: string | null; quarter: string | null;
  filingDate: string | null; ageDays: number | null; url: string | null;
  salesCurr: number | null; salesPrev: number | null; salesYoY: number | null;
  patCurr: number | null; patPrev: number | null; patYoY: number | null; epsYoY: number | null;
  ebitdaYoY: number | null; opm: number | null; opmPrev: number | null; cfoToPat: number | null;
  quartersSales: number[] | null; ttmRevenue: number | null; annualRevenue: number | null;
  guidanceRaised: boolean | null; guidanceLowered: boolean | null; concreteGuidance: boolean | null;
  orderBook: 'UP' | 'DOWN' | 'UNCHANGED' | 'NOT_STATED'; marketCap: number | null;
}

function ageFrom(dateIso: string | null, now: string | null | undefined): number | null {
  if (!dateIso || !now) return null;
  const a = Date.parse(dateIso.length === 10 ? `${dateIso}T00:00:00Z` : dateIso), b = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export function normaliseFiledRow(raw: any, now?: string | null): FiledRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw.filed && typeof raw.filed === 'object' ? { ...raw, ...raw.filed } : raw;
  const ticker = up(r.ticker || r.symbol);
  if (!ticker) return null;
  const qs = Array.isArray(r.quarters_sales) ? r.quarters_sales.map(num) : null;
  const q4 = qs && qs.length >= 4 ? qs.slice(-4) : null;
  const ttm = num(r.ttm_revenue_cr ?? r.ttm_revenue ?? r.revenue_ttm)
    ?? (q4 && q4.every((x: number | null) => x != null && x > 0) ? (q4 as number[]).reduce((s, x) => s + x, 0) : null);
  const filingDate = (r.filing_date || r.filed_date || r.filedDate || null) ? String(r.filing_date || r.filed_date || r.filedDate).slice(0, 10) : null;
  const age = num(r._ageDays ?? r.filed_days_ago ?? r.age_days) ?? ageFrom(filingDate, now);
  const ob = String(r.order_book_trend || r.order_book || '').toUpperCase();
  return {
    ticker, company: r.company ? clean(r.company) : null, tier: r.tier ? String(r.tier) : null, quarter: r.quarter ? String(r.quarter) : null,
    filingDate, ageDays: age, url: r.filing_url || r.release_url || r.source_url || null,
    salesCurr: num(r.sales_curr_cr), salesPrev: num(r.sales_prev_cr), salesYoY: num(r.sales_yoy_pct ?? r.revenue_yoy_pct),
    patCurr: num(r.pat_curr_cr), patPrev: num(r.pat_prev_cr), patYoY: num(r.pat_yoy_pct ?? r.net_profit_yoy_pct), epsYoY: num(r.eps_yoy_pct),
    ebitdaYoY: num(r.op_profit_yoy_pct ?? r.ebitda_yoy_pct), opm: num(r.opm_pct), opmPrev: num(r.opm_prev_pct),
    cfoToPat: num(r.ocf_to_pat_ratio ?? r.cfo_to_pat_ratio),
    quartersSales: qs && qs.every((x: number | null) => x != null) ? qs as number[] : null,
    ttmRevenue: ttm, annualRevenue: num(r.sales_annual_cr ?? r.annual_revenue_cr),
    guidanceRaised: typeof r.guidance_raised === 'boolean' ? r.guidance_raised : null,
    guidanceLowered: typeof r.guidance_lowered === 'boolean' ? r.guidance_lowered : null,
    concreteGuidance: typeof r.has_concrete_guidance === 'boolean' ? r.has_concrete_guidance : null,
    orderBook: ob === 'UP' || ob === 'DOWN' || ob === 'UNCHANGED' ? ob as any : 'NOT_STATED',
    marketCap: num(r.market_cap_cr ?? r.market_cap),
  };
}

/** A graded row trimmed to what the view reads — the scan response carries
 *  these as `filed_results` so the research route can rebuild the view from
 *  the cached scan without calling the grader again. */
export function compactFiledRow(r: any): Record<string, any> {
  const pick = ['ticker', 'company', 'tier', 'quarter', 'filing_date', '_ageDays', 'filing_url', 'release_url', 'market_cap_cr',
    'sales_curr_cr', 'sales_prev_cr', 'sales_yoy_pct', 'pat_curr_cr', 'pat_prev_cr', 'pat_yoy_pct', 'net_profit_yoy_pct', 'eps_yoy_pct',
    'op_profit_yoy_pct', 'opm_pct', 'opm_prev_pct', 'ocf_to_pat_ratio', 'cfo_to_pat_ratio', 'quarters_sales', 'sales_annual_cr',
    'guidance_raised', 'guidance_lowered', 'has_concrete_guidance'];
  const out: Record<string, any> = {};
  for (const k of pick) if (r && r[k] !== undefined && r[k] !== null) out[k] = r[k];
  return out;
}

export function earningsMiniOf(f: FiledRow): EarningsMini {
  const qs = f.quartersSales;
  const qoq = qs && qs.length >= 2 && qs[qs.length - 2] > 0 ? ((qs[qs.length - 1] / qs[qs.length - 2]) - 1) * 100 : null;
  const guidance: EarningsMini['guidance'] = f.guidanceRaised ? 'RAISED' : f.guidanceLowered ? 'CUT' : f.concreteGuidance ? 'MAINTAINED' : 'NOT_STATED';
  let keyChange: string | null = null;
  if (f.opm != null && f.opmPrev != null && Math.abs(f.opm - f.opmPrev) >= 3) keyChange = `Operating margin ${r1(f.opmPrev)}% → ${r1(f.opm)}% (${f.opm >= f.opmPrev ? '+' : ''}${r1(f.opm - f.opmPrev)}pp)`;
  else if (f.patYoY != null && f.salesYoY != null) keyChange = `PAT ${pctS(f.patYoY)} YoY on revenue ${pctS(f.salesYoY)} YoY`;
  else if (f.salesYoY != null) keyChange = `Revenue ${pctS(f.salesYoY)} YoY`;
  else if (f.patYoY != null) keyChange = `PAT ${pctS(f.patYoY)} YoY`;
  return {
    revenueYoY: f.salesYoY == null ? null : r1(f.salesYoY), revenueQoQ: qoq == null ? null : r1(qoq),
    ebitdaYoY: f.ebitdaYoY == null ? null : r1(f.ebitdaYoY), marginNow: f.opm, marginPrior: f.opmPrev,
    patYoY: f.patYoY == null ? null : r1(f.patYoY), cfoToPat: f.cfoToPat,
    guidance, orderBook: f.orderBook, keyChange, filedDaysAgo: f.ageDays,
    tier: f.tier, quarter: f.quarter, filedDate: f.filingDate, stale: f.ageDays != null && f.ageDays > CATALYST_WINDOWS.IN.recent,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT TYPE + STAGE — at the data-model level.
// An LoI / MoU / board approval / proposal is never an order and never
// executed; an LoA received is AWARDED; an announcement is not revenue.
// ═══════════════════════════════════════════════════════════════════════════

const RX_ENABLING = /letter of intent|\bloi\b|memorandum of understanding|\bmou\b|term sheet|non-binding|in-principle|\bl1\b|lowest bidder|subject to (the )?(shareholder|regulatory|statutory|customer|lender|court|nclt|cci|sebi|stock exchange|final)? ?approvals?|board (has )?approv|approved by the board|approval of the board|board of directors (has )?approv|enabling resolution/i;
const RX_PROPOSED = /to consider|proposal|proposed|intends? to|plans? to|exploring|evaluat(e|ing)|intimation of board meeting/i;
const RX_RUMOUR = /reportedly|media report|news (report|item|article)|rumou?r|sources said|according to sources/i;
const RX_AWARDED = /letter of award|\bloa\b|work order|purchase order|receipt of (an? )?order|received (an? )?(order|contract|loa|work order|purchase order)|bag(s|ged|ging)|award(ed|s)?\b|secured|won\b|wins\b|order (worth|valued|of)/i;
const RX_SIGNED = /signed|signing|definitive agreement|share purchase agreement|\bspa\b|executed (an? )?agreement|entered into (an? )?(agreement|contract)/i;
const RX_OPERATIONAL = /commission(ed|ing)|commenced (commercial )?(production|operations)|started (commercial )?(production|operations)|inaugurat|ready for (commercial|operation)|capacity (rises|rose|increased|enhanced|augmented)|expansion completed|operational/i;
const RX_MONETIZING = /first (dispatch|supply|supplies|shipment|batch)|commercial (sales|supplies) (commenced|started|began)|began commercial sales|revenue (recogni[sz]ed|booked)/i;
const RX_EXECUTED = /completion of (the )?acquisition|completed (the )?acquisition|acquisition (completed|consummated)|allot(ted|ment)|consummat|closed the (deal|transaction)|approval (granted|received)|received (an? )?approval|granted/i;

function eventTypeOf(category: string | null, hay: string, negative: boolean): { type: EventType; label: string | null } {
  const c = String(category || '');
  if (negative) {
    if (c === 'order_cancellation' || c === 'customer_loss') return { type: 'Order cancellation', label: null };
    if (c === 'dilution') return { type: 'Fundraising', label: 'Offering / dilution' };
    if (c === 'auditor_resignation') return { type: 'Governance', label: 'Auditor change' };
    if (c === 'regulatory_investigation') return { type: 'Litigation / regulatory', label: null };
    if (c === 'tax_litigation') return { type: 'Litigation / regulatory', label: 'Tax demand / notice' };
    if (c === 'debt_stress') return { type: 'Debt / refinancing', label: 'Debt stress' };
    if (c === 'guidance_reduction') return { type: 'Guidance', label: 'Guidance cut' };
    if (c === 'project_delay') return { type: 'Accident / disruption', label: 'Project delay' };
    if (/fire|explosion|blast|accident|damage|shut ?down|suspen|strike|lock-?out|flood|force majeure|disruption|cyber/i.test(hay)) return { type: 'Accident / disruption', label: null };
    if (/resign|cessation|ceased|steps? down|stepped down|departure/i.test(hay)) return { type: 'Management change', label: 'Management departure' };
    if (/default|insolvency|nclt|cirp|winding up|accelerat/i.test(hay)) return { type: 'Debt / refinancing', label: 'Debt stress' };
    if (/delist|non-?compliance|going concern|restatement|non-reliance|qualified opinion|auditor/i.test(hay)) return { type: 'Governance', label: null };
    if (/cancel|terminat|loss of/i.test(hay)) return { type: 'Order cancellation', label: null };
    return { type: 'Litigation / regulatory', label: null };
  }
  switch (c) {
    case 'order_win': case 'backlog_increase': {
      if (/letter of intent|\bloi\b/i.test(hay)) return { type: 'Contract', label: 'Letter of intent (not an order)' };
      if (/memorandum of understanding|\bmou\b|term sheet|non-binding/i.test(hay)) return { type: 'Partnership', label: 'MoU / non-binding (not an order)' };
      if (/\bl1\b|lowest bidder/i.test(hay)) return { type: 'Contract', label: 'L1 bidder (award pending)' };
      if (/framework agreement|empanel/i.test(hay)) return { type: 'Contract', label: 'Framework / empanelment (no committed volume)' };
      return { type: 'Order win', label: /letter of award|\bloa\b/i.test(hay) ? 'Letter of award received' : null };
    }
    case 'quarterly_result': case 'margin_expansion': return { type: 'Earnings', label: null };
    case 'capacity_expansion': return { type: 'Capacity expansion', label: null };
    case 'production_ramp': case 'utilization_increase': return { type: 'Production ramp', label: null };
    case 'revenue_guidance_increase': return { type: 'Guidance', label: null };
    case 'regulatory_approval': case 'export_approval': return { type: 'Regulatory approval', label: null };
    case 'product_qualification': return { type: 'Regulatory approval', label: 'Qualification / certification' };
    case 'new_customer': case 'customer_ramp': case 'new_geography': return { type: 'Customer win', label: null };
    case 'new_product': return { type: 'New product', label: null };
    case 'acquisition': case 'open_offer': return { type: 'Acquisition', label: c === 'open_offer' ? 'Open offer / tender' : null };
    case 'strategic_investor': return { type: 'Acquisition', label: 'Strategic stake (13D / investor)' };
    case 'joint_venture': return /memorandum|\bmou\b|partnership|alliance/i.test(hay) ? { type: 'Partnership', label: null } : { type: 'JV', label: null };
    case 'demerger': case 'divestiture': return { type: 'Divestment', label: c === 'demerger' ? 'Demerger / scheme' : null };
    case 'fundraising': return { type: 'Fundraising', label: 'Financing (supply, not demand)' };
    case 'buyback': return { type: 'Buyback', label: null };
    case 'promoter_purchase': return { type: 'Governance', label: 'Promoter purchase' };
    case 'management_change': return { type: 'Management change', label: null };
    case 'rating_action': return { type: 'Rating action', label: null };
    case 'pricing_increase': case 'cost_reduction': return { type: 'Pricing', label: null };
    case 'debt_reduction': return { type: 'Debt / refinancing', label: null };
    case 'restructuring': return { type: 'Governance', label: 'Restructuring' };
    default: return { type: 'No identified catalyst', label: null };
  }
}

function stageOf(type: EventType, findingStage: string | null, hay: string): Stage {
  if (type === 'Earnings') return 'MONETIZING';
  if (RX_RUMOUR.test(hay) && !RX_AWARDED.test(hay)) return 'RUMOUR';
  // Enabling language wins over any "received" in the same sentence: a
  // received LoI is still an LoI.
  if (findingStage === 'enabling' || RX_ENABLING.test(hay)) return RX_PROPOSED.test(hay) && !RX_ENABLING.test(hay) ? 'PROPOSED' : 'ENABLING';
  if (RX_PROPOSED.test(hay) && !RX_AWARDED.test(hay) && !RX_OPERATIONAL.test(hay)) return 'PROPOSED';
  if (RX_MONETIZING.test(hay)) return 'MONETIZING';
  if (type === 'Capacity expansion' || type === 'Production ramp') {
    if (findingStage === 'scheduled' && !RX_OPERATIONAL.test(hay)) return 'ENABLING';
    return RX_OPERATIONAL.test(hay) || type === 'Production ramp' || findingStage === 'executed' ? 'OPERATIONAL' : 'UNKNOWN';
  }
  if (type === 'Order win' || type === 'Customer win' || type === 'Contract') {
    if (RX_AWARDED.test(hay)) return 'AWARDED';
    if (RX_SIGNED.test(hay)) return 'SIGNED';
    return findingStage === 'executed' || findingStage === 'scheduled' ? 'AWARDED' : 'UNKNOWN';
  }
  if (type === 'Acquisition' || type === 'Divestment' || type === 'JV' || type === 'Partnership') {
    if (RX_EXECUTED.test(hay)) return 'EXECUTED';
    if (RX_SIGNED.test(hay)) return 'SIGNED';
    return findingStage === 'executed' ? 'SIGNED' : 'UNKNOWN';
  }
  if (type === 'Regulatory approval') return /granted|received|obtained|approv(ed|al)|certif|accredit/i.test(hay) ? 'EXECUTED' : 'UNKNOWN';
  if (type === 'Fundraising' || type === 'Buyback') return RX_EXECUTED.test(hay) ? 'EXECUTED' : 'ENABLING';
  if (RX_OPERATIONAL.test(hay)) return 'OPERATIONAL';
  if (RX_EXECUTED.test(hay) || findingStage === 'executed') return 'EXECUTED';
  return 'UNKNOWN';
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPACITY "from X to Y" — the only before/after a filing states in a line.
// ═══════════════════════════════════════════════════════════════════════════

const SCALE: Record<string, { mult: number; short: string }> = {
  million: { mult: 1e6, short: 'M' }, mn: { mult: 1e6, short: 'M' }, m: { mult: 1e6, short: 'M' },
  lakh: { mult: 1e5, short: ' lakh' }, lakhs: { mult: 1e5, short: ' lakh' }, crore: { mult: 1e7, short: ' Cr' },
  thousand: { mult: 1e3, short: 'K' }, k: { mult: 1e3, short: 'K' }, billion: { mult: 1e9, short: 'B' }, bn: { mult: 1e9, short: 'B' },
};

export function parseCapacityChange(text: string): { before: string; after: string; delta: string; pct: number; unit: string } | null {
  const sentences = String(text || '').split(/(?<=[.;])\s+/).filter((s) => /capacit/i.test(s));
  for (const s of sentences) {
    const m = /from\s+(~|about |approx\.? |approximately )?\s*([\d][\d,]*(?:\.\d+)?)\s*(million|mn|m|lakhs?|crore|thousand|k|billion|bn)?\b([^\d]{0,40}?)\bto\s+(~|about |approx\.? |approximately )?\s*([\d][\d,]*(?:\.\d+)?)\s*(million|mn|m|lakhs?|crore|thousand|k|billion|bn)?\b\s*([a-z][a-z ./%-]{0,30})?/i.exec(s);
    if (!m) continue;
    const a = parseFloat(m[2].replace(/,/g, '')), b = parseFloat(m[6].replace(/,/g, ''));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= a) continue;
    const sa = (m[3] || m[7] || '').toLowerCase(), sb = (m[7] || m[3] || '').toLowerCase();
    const ka = SCALE[sa] || { mult: 1, short: '' }, kb = SCALE[sb] || { mult: 1, short: '' };
    const A = a * ka.mult, B = b * kb.mult;
    if (B <= A) continue;
    const unit = String(m[8] || m[4] || '').replace(/\s*(\bper annum\b|\bper year\b|\ba year\b|\bannually\b|\bp\.a\.?|\/year\b|\/annum\b)/i, '/yr').replace(/\s+/g, ' ').replace(/[ .,;-]+$/, '').trim();
    const cleanUnit = unit.split(/\s+(with|and|at|in|by|from|which|through|for)\b/i)[0].trim();
    const approx = m[1] || m[5] ? '~' : '';
    const d = (B - A) / kb.mult;
    const dShort = `${r1(d).toLocaleString('en-US')}${kb.short}${!kb.short && cleanUnit ? ` ${cleanUnit}` : ''}`;
    return {
      before: `${approx}${m[2]}${ka.short}${cleanUnit ? ` ${cleanUnit}` : ''}`,
      after: `${approx}${m[6]}${kb.short}${cleanUnit ? ` ${cleanUnit}` : ''}`,
      delta: `+${dShort}`, pct: r1(((B - A) / A) * 100), unit: cleanUnit,
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MATERIALITY — strongest denominator first; the arithmetic is shown.
// ═══════════════════════════════════════════════════════════════════════════

type Band = [number, number];   // [significant ≥, moderate ≥]
const BANDS: Record<string, { revenue: Band; mcap: Band }> = {
  order: { revenue: [25, 10], mcap: [15, 5] },
  acquisition: { revenue: [30, 10], mcap: [20, 5] },
  capex: { revenue: [30, 10], mcap: [10, 3] },
  buyback: { revenue: [100, 100], mcap: [5, 2] },
  // zzz771: a raise is sized against market cap only (issue ÷ market cap).
  fundraise: { revenue: [100, 100], mcap: [10, 3] },
  generic: { revenue: [25, 10], mcap: [15, 5] },
};

function labelFor(pct: number, band: Band): Materiality['label'] {
  return pct >= band[0] ? 'SIGNIFICANT' : pct >= band[1] ? 'MODERATE' : 'SMALL';
}

function valueMateriality(value: number | null, mcap: number | null, revenue: { v: number; basis: 'ttm_revenue' | 'annual_revenue' } | null, market: 'IN' | 'US', kind: keyof typeof BANDS, verifiedValue: boolean, renewal: boolean): Materiality {
  if (value == null || !(value > 0)) return { label: 'UNKNOWN', ratios: [], explanation: 'Event value: Not disclosed — materiality cannot be measured.' };
  const ratios: MaterialityRatio[] = [];
  const b = BANDS[kind];
  let label: Materiality['label'] = 'UNKNOWN';
  if (revenue && revenue.v > 0 && kind !== 'buyback') {
    const p = (value / revenue.v) * 100;
    ratios.push({ basis: revenue.basis, pct: r1(p), text: `${money(value, market)} ÷ ${money(revenue.v, market)} ${revenue.basis === 'ttm_revenue' ? 'TTM' : 'annual'} revenue = ${r1(p)}%` });
    label = labelFor(p, b.revenue);
  }
  if (mcap && mcap > 0) {
    const p = (value / mcap) * 100;
    ratios.push({ basis: 'market_cap', pct: r1(p), text: `${money(value, market)} ÷ ${money(mcap, market)} market cap = ${r1(p)}%` });
    if (label === 'UNKNOWN') label = labelFor(p, b.mcap);
  }
  if (!ratios.length) return { label: 'UNKNOWN', ratios: [], explanation: `Value ${money(value, market)} stated; market cap and revenue Not disclosed — no denominator.` };
  const order: Materiality['label'][] = ['SMALL', 'MODERATE', 'SIGNIFICANT'];
  if (renewal && label !== 'UNKNOWN') label = order[Math.max(0, order.indexOf(label) - 1)];
  const basisTxt = ratios[0].basis === 'market_cap' ? 'market cap (no revenue figure on the row)' : 'revenue';
  const explanation = `${label === 'SIGNIFICANT' ? 'Large' : label === 'MODERATE' ? 'Meaningful' : 'Small'} relative to ${basisTxt}: ${ratios[0].text}.`
    + (renewal ? ' Reads as a renewal / re-announcement — one level lower.' : '')
    + (verifiedValue ? '' : ' Figure from the filing subject/summary — not verified in the document.');
  return { label, ratios, explanation };
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNDRAISING (zzz771) — a preferential allotment to a named fund or the
// promoter is a potential catalyst with a dilution flag, not a negative event
// by default (ROSSTECH: preferential issue to SBI Mutual Fund at ₹1,166 was
// NEGATIVE, priority 3). It turns NEGATIVE only on distress markers, and a US
// resale / shelf registration is a supply overhang that raises nothing new.
// ═══════════════════════════════════════════════════════════════════════════

const RX_DISTRESS = /\bdefault(ed|s)?\b|\blenders?\b|one[- ]time settlement|\bots\b|working capital (shortfall|gap|stress|crunch)|going concern|restructuring of (the )?(debt|loans?|borrowings?|facilit)|debt restructuring|resolution plan|stressed asset|\bnpa\b/i;
// Matches the zzz771 reason text from classifyUsFiling, not the pre-zzz771
// "supply, dilution or resale overhang" wording that every registration carried.
const RX_RESALE = /resale \/ shelf|resale (registration|prospectus)|shelf registration|selling (stock|share)holders?/i;
// Named allottees: an entity phrase after "to" / "in favour of", ending in
// a corporate suffix, or the promoter group.
const RX_ALLOTTEE = /(?:\bto|in favou?r of|allottees?:?|subscribed by|by)\s+((?:(?:[A-Z][\w&'.-]*|of|and|&|de|the)\s+){0,7}(?:Mutual Fund|Fund|Trust|Capital|LLP|Limited|Ltd\.?|Pvt\.?|Private Limited|Investments?|Holdings?|AIF|Insurance|Bank|Partners|Ventures|Advisors|Advisers|Management|Securities|Corporation|Inc\.?|Group|Company|Co\.?))(?![\w-])/g;

export function allotteesOf(text: string): string[] {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out: string[] = [];
  for (const m of t.matchAll(RX_ALLOTTEE)) {
    const name = m[1].replace(/[\s,.]+$/, '').trim();
    if (!name || /^(the )?(company|board|issuer|exchange|bse|nse)\b/i.test(name) || name.split(' ').length < 2 && !/Fund|Trust|Bank/.test(name)) continue;
    if (!out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  if (/\bpromoter/i.test(t) && !out.some((x) => /promoter/i.test(x))) out.push(/promoter group/i.test(t) ? 'promoter group' : 'promoters');
  return out.slice(0, 4);
}

interface FundraiseRead { cls: EventClass; label: string; mat: Materiality; allottees: string[]; distress: boolean; resale: boolean; named: boolean }

function fundraisingOf(hay: string, stage: Stage, value: number | null, mcap: number | null, market: 'IN' | 'US', verifiedValue: boolean, usRegistration: boolean): FundraiseRead {
  const resale = usRegistration && RX_RESALE.test(hay);
  const distress = RX_DISTRESS.test(hay);
  const allottees = allotteesOf(hay);
  const named = allottees.length > 0;
  if (resale) return { cls: 'NO_CATALYST', label: 'Resale registration (supply overhang) — not a new raise', mat: { label: 'UNKNOWN', ratios: [], explanation: 'No new proceeds: existing or future stock registered for sale — nothing to size against market cap.' }, allottees, distress, resale, named };
  const mat = valueMateriality(value, mcap, null, market, 'fundraise', verifiedValue, false);
  if (mat.ratios.length) mat.explanation = mat.explanation.replace(/^(Large|Meaningful|Small) relative to market cap \(no revenue figure on the row\)/, '$1 issue relative to market cap');
  const label = `Fundraising — ${named ? allottees.join(', ') : 'allottees not stated'}`;
  if (distress) return { cls: 'NEGATIVE', label: `${label} (distress markers)`, mat, allottees, distress, resale, named };
  const cls: EventClass = stage === 'EXECUTED' && mat.label === 'SMALL' ? 'CONFIRMED_LOW_MATERIALITY' : 'POTENTIAL_UNVERIFIED';
  return { cls, label, mat, allottees, distress, resale, named };
}

function earningsMateriality(e: EarningsMini | null, f: FiledRow | null, market: 'IN' | 'US'): Materiality {
  if (!e || (e.revenueYoY == null && e.patYoY == null)) return { label: 'UNKNOWN', ratios: [], explanation: 'Result filed; revenue and PAT change Not disclosed on the row.' };
  const rv = Math.abs(e.revenueYoY ?? 0), pt = Math.abs(e.patYoY ?? 0);
  const label: Materiality['label'] = rv >= 25 || pt >= 50 ? 'SIGNIFICANT' : rv >= 10 || pt >= 20 ? 'MODERATE' : 'SMALL';
  const parts: string[] = [];
  if (e.revenueYoY != null) parts.push(`revenue ${f && f.salesPrev != null && f.salesCurr != null ? `${money(f.salesPrev, market)} → ${money(f.salesCurr, market)} = ` : ''}${pctS(e.revenueYoY)} YoY`);
  if (e.patYoY != null) parts.push(`PAT ${f && f.patPrev != null && f.patCurr != null ? `${money(f.patPrev, market)} → ${money(f.patCurr, market)} = ` : ''}${pctS(e.patYoY)} YoY`);
  return { label, ratios: [], explanation: `Versus the prior-year quarter: ${parts.join('; ')}.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// per-type research content
// ═══════════════════════════════════════════════════════════════════════════

const NEXT: Record<string, string[]> = {
  // zzz782: research questions per EVENT TYPE — what the owner needs to know
  // next for that kind of event, not one generic list.
  order: ['What is the order value, and what % of FY revenue is this order?', 'Over what period is revenue recognised, and when does revenue start?', 'What margin does it carry versus the company average?', 'What is the total order book after this order (order book ÷ revenue)?', 'Is capacity in place to execute it, or is new capex needed?', 'Is it repeatable (framework, repeat customer) or one-off?', 'How concentrated is revenue on this client (client concentration)?', 'What working capital or advances does it need?'],
  order_recurring: ['Is the stated annual value recurring for the full programme life — how many years does the programme run?', 'Are these fixed contracts, or initial awards that scale up or down with the customer\'s build rate?', 'What % of FY revenue does the annual value add?', 'What margin do the programmes carry versus the company average?', 'What capacity is needed, and is it already in place?', 'When does production start, and when does it reach the full annual run-rate?', 'Are further programmes being qualified with the same customer or new ones?', 'What working capital or advances does it need?'],
  enabling: ['Chain: MoU / LoI → definitive agreement → approvals → binding order → supply start → revenue — which step is next?', 'What has to happen before this becomes a binding order (definitive agreement, approvals)?', 'Is a value, volume or price disclosed anywhere?', 'Who is the counterparty and how firm is its commitment?', 'By when is conversion to an order expected?'],
  enabling_realestate: ['Chain: MoU / JDA → definitive agreement → approvals → execution → launch → bookings → collections → revenue → profit — which step is next?', 'What is the company\'s own share of revenue or profit (the project GDV is not the company\'s revenue)?', 'Which approvals are needed before a definitive agreement or launch, and by when?', 'When is the project launch expected?', 'What bookings and collections are expected in the first year after launch?', 'Who is the land owner / partner, and how firm is the commitment?'],
  capacity: ['How much capex was invested, and how was it funded?', 'When is (or was) the capacity commissioned?', 'What is current utilisation of the existing capacity?', 'How much incremental capacity does it add (before → after)?', 'Is demand secured (orders, offtake) for the added capacity?', 'What utilisation is expected on the new capacity, and by when?', 'What revenue and operating profit can it contribute at full ramp?', 'How long is the ramp-up to full utilisation?'],
  qualification: ['What stage is it — sample, pilot, approved vendor or commercial supply?', 'Which customer, and for which product?', 'Is there a commercial order yet, and of what size?', 'When do commercial supplies start?', 'Is it repeatable — does the qualification cover future orders from the same buyer?', 'How many customers has the company now qualified with?', 'Is capacity in place to serve it?'],
  acquisition: ['What price was paid (EV/EBITDA, EV/sales)?', 'What are the target\'s revenue and EBITDA?', 'How is it funded — cash, debt or new shares?', 'What is the integration plan, and what could delay it?', 'When does it start contributing to consolidated revenue and profit?', 'What is the strategic rationale — capability, customers, geography?', 'Is the contribution recurring, or a one-off gain?', 'How much dilution, if any?'],
  earnings: ['Did management raise, hold or cut guidance?', 'What is the order book / pipeline after this quarter?', 'Does CFO track PAT (cash conversion)?', 'Which drivers explain the change — volume, price, mix or one-offs?', 'Is the margin change repeatable next quarter?'],
  approval: ['What products or markets does it open, and how large are they?', 'When do commercial supplies start?', 'Which competitors already hold the same approval?', 'What revenue has management attached to it?'],
  customer: ['How large is the customer\'s annual spend with the company?', 'What margin and payment terms apply?', 'When does supply start, and at what run-rate?', 'Does it raise customer concentration?'],
  product: ['Which market does it target, and how large is it?', 'How is it priced (pricing)?', 'When is (or was) the launch, and is it commercially available?', 'What adoption so far — named users or orders?', 'When does revenue start, and at what scale?', 'What gross margin does the product carry?', 'Is revenue repeatable (subscriptions, repeat orders) or one-time?'],
  fundraising: ['At what price and discount versus the market?', 'Who are the allottees (promoter, institutions, public)?', 'What is the stated use of proceeds?', 'How much dilution per share?'],
  buyback: ['Buyback size versus market cap and free float?', 'Price versus the current market?', 'Tender or open market?', 'Is the promoter participating?'],
  guidance: ['What exactly changed versus prior guidance?', 'What drives the new guidance?', 'How has management tracked against past guidance?'],
  management: ['Who joined or left, and from where?', 'Planned succession or abrupt?', 'Does it affect execution of stated plans?'],
  rating: ['Which agency, from what to what?', 'What drove the change — leverage, cash flow, scale?', 'Does it change borrowing cost?'],
  pricing: ['Price change versus input cost?', 'Is it sticky across the industry?', 'Margin effect next quarter?'],
  denial: ['Check turnover and delivery % behind the move.', 'Check bulk/block deals and shareholding changes.', 'Check sector and peer moves in the same session.', 'Watch for a later filing that explains the move.'],
  negative: ['Size the impact on revenue and EBITDA.', 'Is it one-off or recurring?', 'Does it change the thesis or the balance sheet?', 'Is insurance, a penalty cap or a reversal possible?'],
  none: ['Check liquidity and turnover versus the 1-week average.', 'Check technical drivers (breakout, band, circuit).', 'Check sector and peer moves in the same session.', 'Check bulk/block deals and news flow.'],
  band: ['Check how many shares actually traded at the band.', 'Check whether the price band was revised.', 'Check sector moves in the same session.'],
  listing: ['Wait for comparable price history.', 'Compare with the issue price.', 'Read the offer document for use of proceeds.'],
  unavailable: ['Re-run research when the source is reachable.', 'Open the exchange filing page directly.', 'Do not treat the name as "no catalyst" until checked.'],
  unclassified: ['Open the unclassified filing — the subject line was generic.', 'Check whether it states a value, counterparty or date.', 'Check sector and peer moves in the same session.'],
  generic: ['What exactly changed, with numbers?', 'How does it reach revenue or margin?', 'Is it repeatable?'],
};

function nextKey(type: EventType, cls: EventClass, stage: Stage, finding: Finding | null, clarification = false): string {
  if (cls === 'DATA_UNAVAILABLE') return 'unavailable';
  if (cls === 'LISTING') return 'listing';
  if (cls === 'MARKET_MOVE_ONLY') return 'band';
  if (type === 'Denial' || clarification) return 'denial';
  if (cls === 'NO_CATALYST') return type === 'Fundraising' ? 'fundraising' : /not classifiable/i.test(String(finding?.headline || '')) ? 'unclassified' : 'none';
  if (type === 'Fundraising') return 'fundraising';
  if (cls === 'NEGATIVE' && type !== 'Earnings') return 'negative';
  const hayK = `${finding?.headline || ''} ${finding?.evidenceQuote || ''}`;
  if ((type === 'Order win' || type === 'Contract' || type === 'Partnership' || type === 'JV') && (stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR'))
    return /\bjda\b|joint development|\bgdv\b|gross development|acres?|residential|township|real estate|housing/i.test(hayK) ? 'enabling_realestate' : 'enabling';
  // zzz782: a qualification is not a licence — its questions are about conversion to commercial supply.
  if (type === 'Regulatory approval' && (finding?.category === 'product_qualification' || /qualif|approved (vendor|supplier)|vendor (registration|approval)|\bfai\b|first article|sampl/i.test(hayK))) return 'qualification';
  switch (type) {
    case 'Order win': case 'Contract':
      // RAYMOND "multi-programme orders worth about ₹33 crore annually": recurring-programme questions.
      return /\bannual(ly)?\b|per annum|\bp\.?\s?a\.?\b|\bprogramm?e?s?\b|multi-?year|framework|rate contract/i.test(hayK) ? 'order_recurring' : 'order';
    case 'Customer win': return 'customer';
    case 'Capacity expansion': case 'Production ramp': return 'capacity';
    case 'Acquisition': case 'JV': case 'Divestment': return 'acquisition';
    case 'Earnings': return 'earnings';
    case 'Regulatory approval': return 'approval';
    case 'New product': return 'product';
    case 'Buyback': return 'buyback';
    case 'Guidance': return 'guidance';
    case 'Management change': return 'management';
    case 'Rating action': return 'rating';
    case 'Pricing': return 'pricing';
    default: return 'generic';
  }
}

function unknownsFor(key: string, hay: string, hasValue: boolean, e: EarningsMini | null): string[] {
  const u: string[] = [];
  const say = (k: string, known: boolean, word = 'Not disclosed') => { if (!known) u.push(`${k}: ${word}`); };
  switch (key) {
    case 'order': case 'order_recurring': case 'customer':
      say('Order value', hasValue);
      say('Order margin', /margin/i.test(hay));
      say('Revenue timing / execution period', /\b(months?|years?|by (fy|q[1-4]|march|june|september|december)|\d{4})\b/i.test(hay));
      say('Customer concentration', false, 'Unknown');
      say('Working capital terms', /advance|payment terms|working capital/i.test(hay));
      break;
    case 'enabling': case 'enabling_realestate':
      say('Binding order', false, 'Not yet — enabling stage');
      say('Company economics (value / revenue share)', hasValue && !/\bgdv\b|gross development value|potential|may unlock/i.test(hay));
      say('Conversion timing', false, 'Unknown');
      break;
    case 'capacity':
      say('Capex invested', hasValue || /capex|invest/i.test(hay));
      say('Current utilisation', /utili[sz]ation/i.test(hay));
      say('Demand secured / offtake', false, 'Unknown');
      say('Revenue contribution', false);
      break;
    case 'acquisition':
      say('Price', hasValue);
      say('Funding', /funded|cash|debt|internal accruals|share swap/i.test(hay));
      say('Target revenue / EBITDA', /revenue|ebitda|turnover/i.test(hay));
      say('Earnings contribution', /accretive|eps|earnings contribution/i.test(hay));
      say('Dilution', false, 'Unknown');
      break;
    case 'earnings':
      if (!e || e.guidance === 'NOT_STATED') u.push('Guidance: Not stated');
      if (!e || e.orderBook === 'NOT_STATED') u.push('Order book: Not stated');
      if (!e || e.cfoToPat == null) u.push('CFO/PAT: Not disclosed');
      if (!e || e.marginNow == null) u.push('Operating margin: Not disclosed');
      break;
    case 'fundraising':
      say('Issue price / discount', /price|premium|discount/i.test(hay));
      say('Use of proceeds', /use of proceeds|to fund|for (capex|expansion|acquisition)/i.test(hay));
      say('Dilution', false, 'Unknown');
      break;
    case 'none': case 'band': case 'unclassified':
      u.push('Cause of the move: Unknown');
      u.push('Turnover versus average: Unknown');
      break;
    case 'unavailable':
      u.push('Filings in window: Unknown (source unavailable)');
      break;
    case 'negative': case 'denial':
      // zzz777: a negative event is sized by exposure, cash and recurrence.
      say('Financial exposure', hasValue);
      say('Cash impact (paid / deposited / provided)', /paid|deposit|provision|pre-?deposit/i.test(hay));
      say('Recurrence (one-off or repeating)', /one[- ]off|one[- ]time|recurring|similar (notice|demand)s?/i.test(hay), 'Unknown');
      break;
    case 'qualification':
      say('Commercial order', /purchase order|commercial (order|supply)|supply order/i.test(hay), 'Not yet on file');
      say('Commercial start date', /commercial|supplies|launch|from (fy|q[1-4]|\w+ \d{4})/i.test(hay));
      say('Number of qualified customers', false, 'Unknown');
      break;
    case 'approval':
      // zzz777: a licence / approval opens a market; the unknown is its size.
      say('Addressable commercial impact', hasValue);
      say('Commercial start date', /commercial|supplies|launch|from (fy|q[1-4]|\w+ \d{4})/i.test(hay));
      say('Competitors holding the same approval', false, 'Unknown');
      break;
    case 'product':
      say('Commercial impact', hasValue);
      say('Revenue start and scale', /revenue|order|customer/i.test(hay));
      say('Pricing / margin', /pric|margin/i.test(hay));
      break;
    default:
      // zzz776: a product launch or a licence has no "event value" — what is
      // unknown is its commercial impact.
      say('Commercial impact', hasValue);
      u.push('Revenue impact: Not disclosed');
  }
  u.push('Consensus expectations: Unknown');
  return u;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSMISSION + PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

function transmissionOf(type: EventType, cls: EventClass, stage: Stage, mat: Materiality['label']): Transmission {
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY' || cls === 'LISTING' || cls === 'DATA_UNAVAILABLE') return 'NONE';
  // zzz771: a raise reaches the P&L only through what the money funds — WEAK,
  // not NONE — unless it is a distress raise (NEGATIVE).
  if (type === 'Fundraising') return cls === 'NEGATIVE' ? 'NONE' : 'WEAK';
  if (type === 'Denial' || type === 'Management change' || type === 'Governance' || type === 'No identified catalyst' || type === 'Market/technical move') return 'NONE';
  const early = stage === 'RUMOUR' || stage === 'PROPOSED' || stage === 'ENABLING';
  switch (type) {
    case 'Earnings': return 'DIRECT';
    case 'Order win': case 'Contract': case 'Customer win': return early ? 'WEAK' : mat === 'SIGNIFICANT' || mat === 'MODERATE' ? 'DIRECT' : 'NEAR_TERM';
    case 'Order cancellation': return 'DIRECT';
    case 'Capacity expansion': return early ? 'LONG_TERM' : 'NEAR_TERM';
    case 'Production ramp': return 'NEAR_TERM';
    case 'Acquisition': return stage === 'EXECUTED' ? 'NEAR_TERM' : early ? 'WEAK' : 'LONG_TERM';
    case 'Pricing': case 'Guidance': case 'Accident / disruption': return 'NEAR_TERM';
    case 'Regulatory approval': case 'New product': case 'JV': case 'Divestment': return early ? 'WEAK' : 'LONG_TERM';
    case 'Partnership': case 'Buyback': case 'Rating action': case 'Debt / refinancing': case 'Litigation / regulatory': return 'WEAK';
    default: return 'WEAK';
  }
}

function persistenceOf(type: EventType, cls: EventClass, hay: string): Persistence {
  if (cls === 'MARKET_MOVE_ONLY') return 'DAYS';
  if (cls === 'NO_CATALYST' || cls === 'LISTING' || cls === 'DATA_UNAVAILABLE') return 'UNKNOWN';
  switch (type) {
    case 'Order win': case 'Contract': case 'Customer win':
      return /multi-?year|\b\d+\s*years?\b|annual|framework|long[- ]term|rate contract/i.test(hay) ? 'YEARS' : 'QUARTER';
    case 'Capacity expansion': case 'Production ramp': case 'Acquisition': case 'Regulatory approval': case 'JV': case 'New product': case 'Pricing': return 'YEARS';
    case 'Earnings': case 'Guidance': return 'QUARTER';
    case 'Divestment': case 'Buyback': case 'Rating action': case 'Denial': return 'DAYS';
    case 'Order cancellation': case 'Accident / disruption': return /permanent|closure|terminat/i.test(hay) ? 'YEARS' : 'QUARTER';
    default: return 'UNKNOWN';
  }
}

// ── POTENTIAL DURATION ≠ PERSISTENCE EVIDENCE.                       (zzz782)
// `persistenceOf` says how long an event of this TYPE could last (a new
// product: years). This says how much EVIDENCE there is that it will: a new
// product is long-term possible but unproven; a qualification is early; a
// commercial order is evidence; a multi-year contract is strong; capacity with
// utilisation / demand evidence is strong; a one-off tax demand is not persistent.
export type PersistEvidenceLevel = 'NOT_PERSISTENT' | 'UNPROVEN' | 'EARLY' | 'EVIDENCE' | 'STRONG' | 'NONE';
export function persistenceEvidenceOf(type: EventType, cls: EventClass, stage: Stage, key: string, hay: string,
  pc: { confidence: string; specialFocus: boolean; label: string; kind?: string } | null | undefined): { level: PersistEvidenceLevel; text: string } {
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY' || cls === 'LISTING' || cls === 'DATA_UNAVAILABLE') return { level: 'NONE', text: 'No event — nothing to persist.' };
  if (cls === 'NEGATIVE') {
    return /\b(gst|tax|penalt\w*|demand|show[- ]cause|\bscn\b|notice|interest|fine|levy|assessment)\b/i.test(hay)
      ? { level: 'NOT_PERSISTENT', text: 'One-off tax / penalty item — not persistent unless similar demands recur.' }
      : { level: 'UNPROVEN', text: 'Negative development — whether it recurs is not established.' };
  }
  if (pc && pc.kind !== 'PROJECT_PIPELINE' && (pc.specialFocus || pc.confidence === 'HIGH')) return { level: 'STRONG', text: `Filed mechanism evidence across metrics (${pc.label}).` };
  if (pc && pc.kind !== 'PROJECT_PIPELINE' && pc.confidence === 'MEDIUM') return { level: 'EVIDENCE', text: `Mechanism evidence on file (${pc.label}), not yet across periods.` };
  if (stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR') return { level: 'UNPROVEN', text: 'Enabling step — nothing booked yet; tracked until a definitive step is filed.' };
  switch (type) {
    case 'New product':
      return /\b(orders?|revenue|sales|customers? (signed|onboarded)|subscribers?)\b/i.test(hay) && /\d/.test(hay)
        ? { level: 'EVIDENCE', text: 'Commercial traction stated with the launch.' }
        : { level: 'UNPROVEN', text: 'Long-term possible, unproven — no orders or revenue on file yet.' };
    case 'Regulatory approval':
      return /purchase order|commercial (order|supply|supplies)|supply order/i.test(hay)
        ? { level: 'EVIDENCE', text: 'Approval with a commercial order on file.' }
        : { level: 'EARLY', text: key === 'qualification' ? 'Qualification — early; no commercial order on file yet.' : 'Licence / approval — opens a market; no commercial order on file yet.' };
    case 'Order win': case 'Contract': case 'Customer win':
      return /multi-?year|\b\d+\s*years?\b|framework|rate contract|\bannual(ly)?\b|per annum|long[- ]term|\bprogramm?e?s?\b/i.test(hay)
        ? { level: 'STRONG', text: 'Multi-year / recurring programme stated — confirm it is fixed, not an initial award.' }
        : { level: 'EVIDENCE', text: 'Commercial order on file — covers one execution period.' };
    case 'Capacity expansion': case 'Production ramp':
      return /utili[sz]ation|order book|offtake|\borders?\b|sold out|fully booked|demand/i.test(hay)
        ? { level: 'STRONG', text: 'Capacity with utilisation / demand evidence.' }
        : stage === 'EXECUTED' || /commission|operational|commercial production|started production|production (start|commenc)/i.test(hay) ? { level: 'EARLY', text: 'Capacity commissioned — utilisation and demand not yet evidenced.' }
          : { level: 'UNPROVEN', text: 'Capacity planned — nothing commissioned yet.' };
    case 'Acquisition': case 'JV':
      return stage === 'EXECUTED' && /revenue|ebitda|turnover/i.test(hay)
        ? { level: 'EVIDENCE', text: 'Completed, with the target\'s economics stated.' }
        : { level: 'EARLY', text: 'Deal signed — target economics and integration not yet evidenced.' };
    case 'Earnings': return { level: 'EARLY', text: 'One quarter\'s result — persistence needs the next quarter.' };
    case 'Guidance': return { level: 'EARLY', text: 'Management guidance — a target, not evidence.' };
    case 'Pricing': return { level: 'EARLY', text: 'Price change — persistence depends on the industry holding it.' };
    case 'Buyback': case 'Rating action': case 'Management change': case 'Divestment': case 'Fundraising': case 'Denial':
      return { level: 'NOT_PERSISTENT', text: 'Not an operating catalyst.' };
    default: return { level: 'UNPROVEN', text: 'Persistence not established.' };
  }
}

/** zzz782: all rupee amounts in a negative-event text, in ₹ crore — "₹3.53 crore
 *  … ₹46.58 lakh" = 4.00; a bare "₹40,036" is rupees. Null when none. */
export function negativeAmountCr(text: string): number | null {
  const t = String(text || '');
  let sum = 0, any = false;
  const rx = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|million|mn\b)?/gi;
  for (const m of t.matchAll(rx)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const u = (m[2] || '').toLowerCase();
    sum += /^cr/.test(u) ? n : /^la|^lac/.test(u) ? n / 100 : /^m/.test(u) ? n / 10 : n / 1e7;
    any = true;
  }
  return any ? Math.round(sum * 10000) / 10000 : null;
}

function chainOf(type: EventType, trans: Transmission, stage: Stage, it: { headline: string; value: number | null; market: 'IN' | 'US'; mat: Materiality; e: EarningsMini | null; f: FiledRow | null; cap: ReturnType<typeof parseCapacityChange> }): string[] {
  const ev = `EVENT: ${it.headline.slice(0, 90)} (${stage})`;
  if (trans === 'NONE') return [ev, 'DRIVER: none identified', 'REVENUE: TBD', 'MARGIN: TBD', 'EPS/FCF: TBD', 'VALUATION: TBD — no fundamental change to value'];
  const ratio = it.mat.ratios[0]?.text || null;
  if (type === 'Earnings') {
    const e = it.e, f = it.f;
    return [ev,
      `DRIVER: ${e?.keyChange || 'Not disclosed'}`,
      `REVENUE: ${e?.revenueYoY != null ? `${pctS(e.revenueYoY)} YoY${f?.salesPrev != null && f?.salesCurr != null ? ` (${money(f.salesPrev, it.market)} → ${money(f.salesCurr, it.market)})` : ''}` : 'Not disclosed'}`,
      `MARGIN: ${e?.marginNow != null ? `${e.marginPrior != null ? `${r1(e.marginPrior)}% → ` : ''}${r1(e.marginNow)}% operating margin` : 'Not disclosed'}`,
      `EPS/FCF: ${e?.patYoY != null ? `PAT ${pctS(e.patYoY)} YoY` : 'PAT Not disclosed'}${e?.cfoToPat != null ? `; CFO/PAT ${e.cfoToPat}` : '; CFO/PAT Not disclosed'}`,
      'VALUATION: TBD — consensus Unknown'];
  }
  const early = stage === 'RUMOUR' || stage === 'PROPOSED' || stage === 'ENABLING';
  const driver = (() => {
    switch (type) {
      case 'Order win': case 'Contract': case 'Customer win': return early ? 'order book: nothing booked yet (enabling stage)' : it.value != null ? `order book +${money(it.value, it.market)}` : 'order book up — value Not disclosed';
      case 'Capacity expansion': case 'Production ramp': return it.cap ? `capacity ${it.cap.before} → ${it.cap.after} (${it.cap.delta}, +${it.cap.pct}%)` : 'installed capacity up — size Not disclosed';
      case 'Acquisition': return it.value != null ? `acquired business for ${money(it.value, it.market)}` : 'acquired business — price Not disclosed';
      case 'Regulatory approval': return 'market access — permits work, books none';
      case 'Order cancellation': return it.value != null ? `order book −${money(it.value, it.market)}` : 'order book down — value Not disclosed';
      case 'Accident / disruption': return 'lost output — size Not disclosed';
      case 'Buyback': return 'share count down (mechanical EPS effect)';
      case 'Pricing': return 'realisation change — size Not disclosed';
      default: return 'TBD';
    }
  })();
  const revenue = early ? 'REVENUE: none until converted — TBD'
    : type === 'Order win' || type === 'Contract' || type === 'Customer win'
      ? `REVENUE: ${it.value != null ? `${money(it.value, it.market)} over the execution period — timing Not disclosed` : 'Not disclosed'}${ratio ? ` (${ratio})` : ''}`
      : type === 'Capacity expansion' || type === 'Production ramp' ? 'REVENUE: depends on utilisation and demand — Not disclosed'
        : ratio ? `REVENUE: TBD (${ratio})` : 'REVENUE: TBD';
  return [ev, `DRIVER: ${driver}`, revenue, 'MARGIN: Not disclosed', 'EPS/FCF: TBD', `VALUATION: TBD${ratio ? ` — event = ${it.mat.ratios[0].pct}% of ${it.mat.ratios[0].basis === 'market_cap' ? 'market cap' : 'revenue'}` : ''}`];
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPECTATION GAP — the move against the fundamental change, never alone.
// ═══════════════════════════════════════════════════════════════════════════

function gapOf(cls: EventClass, move: { pct: number | null; window: '1D' | '1W' }, returns: { w1: number | null; m1: number | null; m3: number | null }, fc: { pct: number; text: string } | null): ResearchItem['expectationGap'] {
  const moveParts = [move.pct != null ? `${pctS(move.pct)} (${move.window})` : null, returns.m1 != null ? `${pctS(returns.m1)} (1M)` : null, returns.m3 != null ? `${pctS(returns.m3)} (3M)` : null].filter(Boolean);
  const moveTxt = moveParts.length ? `Stock ${moveParts.join(', ')}` : 'Move Not disclosed';
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY') return { level: 'UNKNOWN', text: `${moveTxt}; no fundamental change identified — the move is not measured against anything.`, direction: null };
  if (cls === 'LISTING') return { level: 'UNKNOWN', text: `${moveTxt}; recent listing — no comparable prior close.`, direction: null };
  if (cls === 'DATA_UNAVAILABLE') return { level: 'UNKNOWN', text: `${moveTxt}; sources unavailable — gap cannot be assessed.`, direction: null };
  if (cls === 'NEGATIVE') return { level: 'UNKNOWN', text: `${moveTxt}; the event is negative — the move is not explained by it.`, direction: null };
  if (!fc) return { level: 'UNKNOWN', text: `${moveTxt}; fundamental change Not disclosed — gap cannot be measured.`, direction: null };
  const mv = Math.max(move.pct ?? -Infinity, returns.m1 ?? -Infinity);
  if (!Number.isFinite(mv)) return { level: 'UNKNOWN', text: `Move Not disclosed; ${fc.text}.`, direction: null };
  // zzz773: a stock that is not up is the market's RESPONSE, never proof the
  // change is unpriced. With no positive move there is nothing to compare.
  if (mv <= 0) return { level: 'UNKNOWN', text: `${moveTxt}; ${fc.text} → the market has not rewarded the change. That is a response, not evidence it is unpriced.`, direction: null };
  const r = fc.pct / Math.max(mv, 1);
  if (r >= 3) return { level: 'LARGE', text: `${moveTxt}; ${fc.text} → the move is small against the change (ratio ${r.toFixed(1)}×).`, direction: 'UNDER_REFLECTED' };
  if (r >= 1.5) return { level: 'MODERATE', text: `${moveTxt}; ${fc.text} → the move is modest against the change (ratio ${r.toFixed(1)}×).`, direction: 'UNDER_REFLECTED' };
  if (r >= 0.5) return { level: 'SMALL', text: `${moveTxt}; ${fc.text} → move and change broadly in proportion.`, direction: 'ALIGNED' };
  if (r >= 0.2) return { level: 'MODERATE', text: `${moveTxt}; ${fc.text} → expectation-heavy.`, direction: 'EXPECTATION_HEAVY' };
  return { level: 'LARGE', text: `${moveTxt}; ${fc.text} → expectation-heavy: the move is far larger than the change.`, direction: 'EXPECTATION_HEAVY' };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIORITY — research value, never the move.
// ═══════════════════════════════════════════════════════════════════════════

const F_CLASS: Record<EventClass, number> = { CONFIRMED_MATERIAL: 1, CONFIRMED_LOW_MATERIALITY: 0.55, POTENTIAL_UNVERIFIED: 0.5, NEGATIVE: 0.6, NO_CATALYST: 0.15, MARKET_MOVE_ONLY: 0.1, LISTING: 0.08, DATA_UNAVAILABLE: 0.1 };
const F_MAT: Record<Materiality['label'], number> = { SIGNIFICANT: 1, MODERATE: 0.75, SMALL: 0.35, UNKNOWN: 0.5 };
const F_TRANS: Record<Transmission, number> = { DIRECT: 1, NEAR_TERM: 0.85, LONG_TERM: 0.6, WEAK: 0.4, NONE: 0.1 };
const F_EVID: Record<SourceConfidence, number> = { VERIFIED_DOCUMENT: 1, VERIFIED_FILING: 0.85, SECONDARY_SUMMARY: 0.55, UNVERIFIED: 0.35 };
const F_PERS: Record<Persistence, number> = { YEARS: 1, QUARTER: 0.8, DAYS: 0.55, UNKNOWN: 0.7 };
// zzz771: the 0.7 step ends at the RECENT window (14d), not 20d, so freshness
// and catalystFor agree on where "recent" stops.
const freshF = (age: number | null) => (age == null ? 0.6 : age <= 1 ? 1 : age <= 3 ? 0.95 : age <= 7 ? 0.85 : age <= CATALYST_WINDOWS.IN.recent ? 0.7 : age <= 60 ? 0.45 : 0.2);
const gapF = (g: ResearchItem['expectationGap']) => (g.direction === 'UNDER_REFLECTED' ? (g.level === 'LARGE' ? 1 : 0.9)
  : g.direction === 'ALIGNED' ? 0.75 : g.direction === 'EXPECTATION_HEAVY' ? (g.level === 'LARGE' ? 0.4 : 0.55) : 0.7);

function priorityOf(it: ResearchItem, ctx: { routine: boolean; pricingState: string | null; staleEarnings: boolean; veryStale: boolean; namedAllottee: boolean; clarification: boolean }): { score: number; reasons: string[]; details: Record<string, number> } {
  const d: Record<string, number> = {
    eventQuality: F_CLASS[it.eventClass], materiality: F_MAT[it.materiality.label], transmission: F_TRANS[it.transmission],
    evidence: F_EVID[it.sourceConfidence], freshness: freshF(it.ageDays ?? null), expectationGap: gapF(it.expectationGap), persistence: F_PERS[it.persistence],
  };
  const reasons: string[] = [];
  const cls = it.eventClass;
  if (cls === 'CONFIRMED_MATERIAL') reasons.push('Confirmed, economically material event');
  else if (cls === 'CONFIRMED_LOW_MATERIALITY') reasons.push('Real event, low materiality');
  else if (cls === 'POTENTIAL_UNVERIFIED') reasons.push(/ENABLING|PROPOSED|RUMOUR/.test(it.stage) ? `Not executed (${it.stage})` : it.sourceConfidence === 'VERIFIED_DOCUMENT' || it.sourceConfidence === 'VERIFIED_FILING' ? 'Event on file; financial impact not established' : 'Source not verified');
  else if (cls === 'NEGATIVE') reasons.push('Negative evidence');
  else if (cls === 'NO_CATALYST') reasons.push('No identified catalyst');
  else if (cls === 'MARKET_MOVE_ONLY') reasons.push('Technical / band move only');
  else if (cls === 'LISTING') reasons.push('Listing artifact');
  else reasons.push('Source unavailable');
  if (it.materiality.ratios[0] && it.materiality.label !== 'UNKNOWN') reasons.push(`${it.materiality.label === 'SIGNIFICANT' ? 'Material' : it.materiality.label === 'MODERATE' ? 'Moderate' : 'Small'} vs ${it.materiality.ratios[0].basis === 'market_cap' ? 'market cap' : 'revenue'} (${it.materiality.ratios[0].pct}%)`);
  else if (it.eventType === 'Earnings' && it.materiality.label !== 'UNKNOWN') reasons.push(`${it.materiality.label === 'SIGNIFICANT' ? 'Large' : it.materiality.label === 'MODERATE' ? 'Moderate' : 'Small'} change versus the prior year`);
  // zzz771: the source reason says what was actually read. A graded result's
  // figures ARE read from the filed statement (by the grader), and a
  // clarification is the company's own filing; "document not parsed" is only
  // true for a subject-line classification.
  if (it.sourceConfidence === 'VERIFIED_DOCUMENT') reasons.push('Quote verified in the document');
  else if (it.sourceConfidence === 'VERIFIED_FILING') {
    if (it.eventType === 'Earnings' && it.earnings) reasons.push('Figures from the filed result (grader-read)');
    else if (ctx.clarification) reasons.push('Exchange clarification on file (company-confirmed)');
    else reasons.push(`${it.market === 'US' ? 'SEC' : 'Exchange'} filing (document not parsed)`);
  }
  if (it.transmission === 'DIRECT') reasons.push('Direct P&L transmission');
  if (it.transmission === 'NONE') reasons.push('No transmission to earnings');
  if (it.ageDays != null && it.ageDays <= 3 && cls !== 'NO_CATALYST') reasons.push(`Fresh (${it.ageDays === 0 ? 'today' : `${it.ageDays}d`})`);
  if (it.expectationGap.direction === 'UNDER_REFLECTED') reasons.push('Move small against the fundamental change');
  if (it.persistence === 'YEARS') reasons.push('Multi-year persistence');
  let pen = 1;
  const penal = (k: string, f: number, why: string) => { d[`penalty_${k}`] = f; pen *= f; reasons.push(why); };
  // zzz771: dilution is a flag on a potential catalyst, not a rejection —
  // 0.75 with a named allottee (the buyer is known), 0.6 without one.
  if (it.flags.dilution) penal('dilution', ctx.namedAllottee ? 0.75 : 0.6, ctx.namedAllottee ? 'Penalty: dilution (named allottee)' : 'Penalty: dilution / financing');
  // A true denial penalises; a clarification is already NO_CATALYST and is
  // priced by its class, not punished twice.
  if (it.flags.denial && cls === 'NEGATIVE') penal('denial', 0.5, 'Penalty: company denial');
  if (it.flags.denial && ctx.clarification) reasons.push('Company-confirmed: no undisclosed information');
  if (it.eventClass === 'CONFIRMED_LOW_MATERIALITY') penal('lowMateriality', 0.8, 'Penalty: too small to explain the move');
  // zzz773: a trailing return is not a pricing assessment. Penalise only a
  // DEFINED comparison: the reaction since the filing against its size, a run
  // before the filing, or a move far larger than the fundamental change.
  if (ctx.pricingState === 'REACTION_EXCEEDS_SIZE') penal('pricing', 0.8, 'Penalty: reaction since the filing exceeds the event\'s size');
  else if (ctx.pricingState === 'RAN_UP_BEFORE_FILING') penal('pricing', 0.85, 'Penalty: stock ran up before the filing');
  else if (it.expectationGap.direction === 'EXPECTATION_HEAVY' && it.expectationGap.level === 'LARGE') penal('pricing', 0.8, 'Penalty: move far larger than the fundamental change');
  // A no-catalyst row is UNVERIFIED because nothing was found to verify; it
  // is not an unverified source and is not penalised as one. (zzz771)
  const noEvent = cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY';
  if (!noEvent && (it.sourceConfidence === 'SECONDARY_SUMMARY' || it.sourceConfidence === 'UNVERIFIED')) penal('unverified', 0.85, 'Penalty: unverified source');
  if (it.flags.listing) penal('listing', 0.3, 'Penalty: listing artifact');
  if (ctx.routine) penal('routine', 0.5, 'Penalty: routine filings only');
  if (it.eventClass === 'MARKET_MOVE_ONLY') penal('technical', 0.5, 'Penalty: technical-only move');
  if (ctx.staleEarnings) penal('staleResult', ctx.veryStale ? 0.4 : 0.7, `Penalty: result filed ${it.earnings?.filedDaysAgo}d ago — context, not this move's trigger`);
  // zzz771: the attribution reason. The class stays (it IS a real event); the
  // reason says why it is not in the queue.
  if (it.catalystFor === 'CONTEXT') reasons.push(`Context, not this move's catalyst (${it.ageDays}d)`);
  else if (it.catalystFor === 'RECENT' && it.ageDays != null) reasons.push(`Recent (${it.ageDays}d) — delayed reaction possible`);
  const product = d.eventQuality * d.materiality * d.transmission * d.evidence * d.freshness * d.expectationGap * d.persistence;
  d.product = Math.round(product * 10000) / 10000;
  d.penaltyMultiplier = Math.round(pen * 1000) / 1000;
  const score = Math.max(0, Math.min(100, Math.round(100 * Math.pow(product, 0.6) * pen)));
  d.priority = score;
  return { score, reasons, details: d };
}

// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO
// ═══════════════════════════════════════════════════════════════════════════

const VAR_OF: Partial<Record<EventType, string>> = {
  'Order win': 'order growth', 'Contract': 'order growth', 'Order cancellation': 'order growth', 'Customer win': 'customer',
  'Capacity expansion': 'capacity/utilisation', 'Production ramp': 'capacity/utilisation', 'Accident / disruption': 'capacity/utilisation',
  'Earnings': 'margin', 'Guidance': 'guidance', 'Pricing': 'margin', 'Acquisition': 'capital allocation', 'Buyback': 'capital allocation',
  'Fundraising': 'capital allocation', 'Regulatory approval': 'market access', 'New product': 'market access',
};
const NEXT_CHECK: Record<string, string> = {
  'order growth': 'order book ÷ TTM revenue at the next update', 'customer': 'customer concentration in the next disclosure',
  'capacity/utilisation': 'utilisation guidance in the next concall', 'margin': 'operating margin next quarter', 'guidance': 'next quarter against guidance',
  'capital allocation': 'funding, dilution and return on the capital deployed', 'market access': 'first commercial revenue from it',
};

function portfolioOf(ticker: string, type: EventType, cls: EventClass, e: EarningsMini | null, ctx: { held: Set<string>; watch: Set<string>; theme: Set<string>; vars: Record<string, string[]> | undefined; findingHeld: boolean }): ResearchItem['portfolio'] {
  const rel: PortfolioRelevance = ctx.held.has(ticker) || ctx.findingHeld ? 'HOLDING' : ctx.watch.has(ticker) ? 'WATCHLIST' : ctx.theme.has(ticker) ? 'SAME_THEME' : 'UNRELATED';
  if (rel === 'UNRELATED' || rel === 'SAME_THEME') return { relevance: rel, thesisVariable: null, note: rel === 'SAME_THEME' ? 'Shares a theme with the book — context for held names.' : null };
  let v = VAR_OF[type] || null;
  if (type === 'Earnings' && e) v = e.guidance !== 'NOT_STATED' ? 'guidance' : (e.marginNow != null && e.marginPrior != null) ? 'margin' : 'revenue growth';
  const hints = ctx.vars?.[ticker] || [];
  if (hints.length) {
    const hit = hints.find((h) => v && (h.toLowerCase().includes(v.split('/')[0]) || v.includes(h.toLowerCase())));
    v = hit || v;
  }
  const next = v ? (NEXT_CHECK[v] || `the next disclosure on ${v}`) : 'turnover, sector moves and the next filing';
  if (cls === 'NEGATIVE') return { relevance: rel, thesisVariable: v, note: `Challenges thesis variable ${v || 'Not mapped'} — next check ${next}.` };
  if (!v || cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY' || cls === 'DATA_UNAVAILABLE' || cls === 'LISTING') return { relevance: rel, thesisVariable: null, note: `No thesis-relevant event — next check ${next}.` };
  return { relevance: rel, thesisVariable: v, note: `${cls === 'POTENTIAL_UNVERIFIED' ? 'May support' : 'Supports'} thesis variable ${v} — next check ${next}.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE NAME → ONE ITEM
// ═══════════════════════════════════════════════════════════════════════════

interface BoardRow { ticker: string; company: string | null; move_pct: number | null; market_cap?: number | null; perf?: any; turnover?: number | null }

function whyOf(cls: EventClass, type: EventType, stage: Stage, mat: Materiality, key: string, gap: ResearchItem['expectationGap'], e: EarningsMini | null, fr: FundraiseRead | null = null, clarification = false): string {
  if (cls === 'DATA_UNAVAILABLE') return 'Sources could not be reached — this is missing data, not an absence of news.';
  if (cls === 'LISTING') return 'Recent listing — no comparable prior close, so the move is excluded from comparison.';
  if (cls === 'MARKET_MOVE_ONLY') return 'Band print on thin turnover — the move measures the price band, not demand.';
  // zzz771: a clarification is the company confirming there is nothing filed
  // behind the move — company-confirmed absence, not a negative event.
  if (clarification) return 'The company told the exchange it has no undisclosed information — company-confirmed absence of a filed catalyst; only liquidity, sector or technical checks remain.';
  if (fr?.resale) return 'A resale / shelf registration releases existing stock for sale — a supply overhang with no new proceeds; it does not explain the move.';
  if (cls === 'NO_CATALYST') return key === 'unclassified' ? 'A filing exists but its subject says nothing classifiable — open it before concluding there is no catalyst.' : 'No filing explains the move; only liquidity, sector or technical checks remain.';
  if (type === 'Denial') return 'The company contradicted a specific report while the stock moved — negative evidence for that story, not a catalyst.';
  if (type === 'Fundraising') {
    if (fr?.distress) return 'A raise beside distress markers (default, lenders, settlement) is supply into a stressed balance sheet — not a catalyst.';
    return fr?.named
      ? `A named allottee (${fr.allottees.join(', ')}) taking stock at a stated price can be the catalyst; it also adds supply — check the price against market, size against market cap and use of proceeds.`
      : 'A raise with no named allottee adds supply — check pricing, allottees and use of proceeds before treating it as a catalyst.';
  }
  if (cls === 'NEGATIVE') return type === 'Earnings' ? 'Results weakened; the move is not explained by fundamentals.' : type === 'Accident / disruption' ? 'Operational disruption — size the lost output and the insurance cover.' : 'Negative development in the window — check whether it changes the thesis.';
  if (key === 'enabling') return `${stage === 'PROPOSED' ? 'A proposal' : 'An enabling step (LoI / MoU / board approval)'}, not an executed order — nothing is booked yet.`;
  if (cls === 'CONFIRMED_LOW_MATERIALITY') return type === 'Earnings' ? 'Real result, but the change is modest — unlikely to explain the move alone.' : 'Real event, but too small relative to company scale to explain the move.';
  if (cls === 'POTENTIAL_UNVERIFIED') return mat.label === 'UNKNOWN' ? 'Event on file but its size is not disclosed — establish the value before judging it.' : 'Reported in a summary only — verify it in the filing before spending time on it.';
  const under = gap.direction === 'UNDER_REFLECTED' ? ' and the move looks small against it' : gap.direction === 'EXPECTATION_HEAVY' ? ', though the move already runs ahead of it' : '';
  switch (key) {
    case 'order': case 'customer': return `Large order relative to company scale${under}, but execution and margin economics remain unknown.`;
    case 'capacity': return `Verified capacity change${under}; utilisation and demand for the new capacity are not yet disclosed.`;
    case 'acquisition': return `Acquisition sized against the company${under}; price, funding and target economics decide whether it adds value.`;
    case 'earnings': return `Reported growth large enough to move earnings power${under}; check whether it repeats and whether cash follows profit${e?.stale ? ' (result is older context, not this move\'s trigger)' : ''}.`;
    case 'approval': return 'Approval opens a market; the revenue it books is not yet disclosed.';
    default: return `Confirmed event with a stated economic size${under}; the path to earnings still needs checking.`;
  }
}

function actionOf(cls: EventClass, rel: PortfolioRelevance): ResearchAction {
  if (cls === 'NEGATIVE') return 'Negative evidence';
  if (cls === 'NO_CATALYST' || cls === 'MARKET_MOVE_ONLY') return 'No catalyst';
  if ((rel === 'HOLDING' || rel === 'WATCHLIST') && (cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED')) return 'Thesis evidence';
  if (cls === 'CONFIRMED_MATERIAL') return 'Review';
  if (cls === 'POTENTIAL_UNVERIFIED' || cls === 'DATA_UNAVAILABLE') return 'Investigate';
  return 'Monitor';
}


const PRICING_LABEL: Record<string, string> = {
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT EVIDENCE', RAN_UP_BEFORE_FILING: 'RAN UP BEFORE FILING', REACTION_SMALL_VS_SIZE: 'SMALL VS SIZE',
  REACTION_IN_LINE: 'IN LINE WITH SIZE', REACTION_EXCEEDS_SIZE: 'EXCEEDS SIZE', FELL_AFTER_FILING: 'FELL AFTER FILING',
};
function pricingOfFinding(f: Finding | null): ResearchItem['pricing'] {
  const p = (f?.components as any)?.pricing;
  if (!p || !p.state) return null;
  return { state: String(p.state), label: PRICING_LABEL[String(p.state)] || String(p.state), text: String(p.text || '') };
}

/** zzz775: answer each research question from what the filing states. */
export function answerQuestions(qs: string[], ctx: { facts: Record<string, string> | null; read: boolean; value: number | null; marketCap: number | null; market: 'IN' | 'US'; revenue: number | null; headline: string; quote: string | null }): string[] {
  const f = ctx.facts || {};
  const pctOf = (v: number, base: number) => Math.round((v / base) * 1000) / 10;
  const sizeAns = (): string | null => {
    if (ctx.value == null) return f.value ? `${f.value} (as stated)` : null;
    const parts = [money(ctx.value, ctx.market)];
    if (ctx.revenue) parts.push(`≈ ${pctOf(ctx.value, ctx.revenue)}% of TTM revenue`);
    if (ctx.marketCap) parts.push(`≈ ${pctOf(ctx.value, ctx.marketCap)}% of market cap`);
    return parts.join(' · ');
  };
  const pick = (q: string): string | null => {
    const l = q.toLowerCase();
    if (/% of fy revenue|price was paid|capex was invested|what exactly changed|issue size|how much.*invest/.test(l)) return sizeAns() || f.price_terms || null;
    if (/over what period|when does revenue start|when do commercial|revenue timing|by when|conversion to an order/.test(l)) return [f.execution_period, f.revenue_start].filter(Boolean).join(' · ') || null;
    if (/margin|pricing/.test(l)) return f.margin || null;
    if (/funded|funding/.test(l)) return f.funding || null;
    if (/counterparty|who is the|customer|repeat customer|which competitors/.test(l)) return f.counterparty || null;
    if (/approval|binding|definitive agreement|conditions/.test(l)) return f.conditions || null;
    if (/utilisation|capacity/.test(l)) return f.capacity || null;
    if (/target's revenue|ebitda|dilution/.test(l)) return f.price_terms || null;
    return null;
  };
  return qs.map((q) => {
    const a = pick(q);
    if (a) return `${q} — ✓ ${a}${ctx.read ? ' (per the filing)' : ' (from the stated value; filing not model-read)'}`;
    return ctx.read ? `${q} — not stated in the filing (ask management / next concall)` : q;
  });
}

export function buildResearchItem(ticker: string, f: Finding | null, b: BoardRow | null, filed: FiledRow | null, input: ResearchViewInput, sets: { held: Set<string>; watch: Set<string>; theme: Set<string> }): ResearchItem {
  const market = input.market;
  const perf = (b?.perf && typeof b.perf === 'object') ? b.perf : {};
  const moveRaw = num(f?.movePct) ?? num(b?.move_pct);
  const mv = { pct: moveRaw == null ? null : r1(moveRaw), window: (market === 'US' ? '1W' : '1D') as '1D' | '1W' };
  const returns = {
    w1: market === 'US' ? mv.pct : num(f?.returns?.w1) != null ? r1(f!.returns!.w1 as number) : num(perf.w1 ?? perf.week),
    m1: num(f?.returns?.m1) != null ? r1(f!.returns!.m1 as number) : num(perf.m1) != null ? r1(num(perf.m1)!) : null,
    m3: num(f?.returns?.m3) != null ? r1(f!.returns!.m3 as number) : num(perf.m3) != null ? r1(num(perf.m3)!) : null,
  };
  const marketCap = num(f?.marketCap) ?? num(b?.market_cap) ?? filed?.marketCap ?? null;
  const company = f?.company ? clean(f.company) : b?.company ? clean(b.company) : filed?.company ?? null;
  const e = filed ? earningsMiniOf(filed) : null;
  const status = f?.status || null;
  const notes = (f?.notes || []).map(clean);
  const headline0 = clean(f?.headline || '');
  const quote = f?.evidenceQuote ? clean(f.evidenceQuote) : null;
  const evHay = `${headline0} ${quote || ''}`;
  const hay = `${evHay} ${notes.join(' ')}`;
  // zzz782: a sentence copied verbatim from the filed document (US press
  // release, no model) is as verified as a model-read quote.
  const verifiedDoc = !!(f && (f.modelRead || f.docExtract) && quote);
  const revenue = filed?.ttmRevenue ? { v: filed.ttmRevenue, basis: 'ttm_revenue' as const } : filed?.annualRevenue ? { v: filed.annualRevenue, basis: 'annual_revenue' as const } : null;

  // ── which event does this name carry? ──
  const earningsLead = !!e && (!f || status === 'none' || status === 'source_failed' || status === 'routine_only' || status === 'unresearched' || (status === 'catalyst' && f.category === 'quarterly_result'));
  let cls: EventClass; let type: EventType; let label: string | null = null; let stage: Stage = 'UNKNOWN';
  let conf: SourceConfidence = 'UNVERIFIED';
  let mat: Materiality = { label: 'UNKNOWN', ratios: [], explanation: 'Not disclosed.' };
  let headline = headline0;
  let dilution = false, denial = false, routine = false;
  const listing = status === 'listing_artifact';
  const bandLevel = f?.bandPrint ? (f.bandLevel ?? null) : null;
  let cap: ReturnType<typeof parseCapacityChange> = null;
  let value: number | null = num(f?.valueStated);
  let sourceUrl = f?.sourceUrl || null;
  let filedDate = f?.sourceDate ? String(f.sourceDate).slice(0, 10) : null;
  // The finding's own age when it has one; otherwise aged from its filing
  // date against the scan instant (input.now) — never the clock. (zzz771)
  let ageDays: number | null = num(f?.ageDays) ?? ageFrom(f?.sourceDate ? String(f.sourceDate) : null, input.now);
  const windowDays = num(f?.windowDays) ?? 21;
  const scanScope = market === 'US' ? 'SEC' : 'exchange';
  const notScanned = 'news, broker actions and sector moves are not scanned';
  let scanNote: string | null = null;
  let clarification = false;
  let fr: FundraiseRead | null = null;

  if (status === 'source_failed' && !e) {
    cls = 'DATA_UNAVAILABLE'; type = 'No identified catalyst'; label = 'Source unavailable'; headline = 'Filing source could not be reached — not "no catalyst"';
    // zzz782: say WHICH failure — a ticker EDGAR does not list is not an
    // outage, and neither is "checked, nothing filed".
    if (market === 'US' && notes.some((n) => /not in the SEC company list/i.test(n))) { label = 'Not in SEC EDGAR'; headline = 'Ticker not found in the SEC company list (CIK not found) — filings not checked, not "no catalyst"'; }
    else if (market === 'US') headline = 'SEC EDGAR could not be reached for this name — filings not checked, not "no catalyst"';
  } else if (listing) {
    cls = 'LISTING'; type = 'No identified catalyst'; label = 'Recent listing'; conf = f?.sourceTier === 'primary' ? 'VERIFIED_FILING' : 'UNVERIFIED';
  } else if (status === 'denied') {
    // zzz771: "no undisclosed information" is the company confirming there is
    // NO catalyst — evidence of absence, not a negative event. Only a reply
    // that contradicts a specific reported story is a denial. Findings stored
    // before zzz771 carry no denialKind; their headline says which it was.
    const kind = f!.denialKind || (/denied the reported|denies|baseless|no such/i.test(headline0) ? 'denial' : 'clarification');
    denial = true; conf = 'VERIFIED_FILING';
    if (kind === 'denial') { cls = 'NEGATIVE'; type = 'Denial'; stage = 'EXECUTED'; }
    else {
      clarification = true; cls = 'NO_CATALYST'; type = 'No identified catalyst';
      label = `Company confirmed no undisclosed information (exchange clarification, ${filedDate || 'undated'})`;
      scanNote = `Company confirmed no undisclosed information to the ${scanScope}${filedDate ? ` on ${filedDate}` : ''} — ${notScanned}`;
    }
  } else if (status === 'negative' && f!.category === 'dilution') {
    // zzz771 (US): a registration is a raise (potential, dilution flag), a
    // resale / shelf (supply overhang, NO_CATALYST) or distress (NEGATIVE).
    type = 'Fundraising'; dilution = true;
    conf = verifiedDoc ? 'VERIFIED_DOCUMENT' : f!.sourceTier === 'primary' ? 'VERIFIED_FILING' : f!.sourceTier === 'secondary' ? 'SECONDARY_SUMMARY' : 'UNVERIFIED';
    stage = stageOf(type, f!.stage, evHay);
    fr = fundraisingOf(evHay, stage, value, marketCap, market, verifiedDoc, true);
    cls = fr.cls; label = fr.label; mat = fr.mat;
    if (fr.resale) scanNote = `Only a resale / shelf registration in the last ${windowDays} days — ${notScanned}`;
  } else if (status === 'negative') {
    const t = eventTypeOf(f!.category, evHay, true); type = t.type; label = t.label; cls = 'NEGATIVE';
    dilution = type === 'Fundraising';
    conf = verifiedDoc ? 'VERIFIED_DOCUMENT' : f!.sourceTier === 'primary' ? 'VERIFIED_FILING' : f!.sourceTier === 'secondary' ? 'SECONDARY_SUMMARY' : 'UNVERIFIED';
    stage = stageOf(type, f!.stage, evHay);
    if (type === 'Order cancellation') mat = valueMateriality(value, marketCap, revenue, market, 'order', verifiedDoc, false);
  } else if (status === 'catalyst' && !earningsLead) {
    const t = eventTypeOf(f!.category, evHay, false); type = t.type; label = t.label;
    stage = stageOf(type, f!.stage, evHay);
    if (notes.some((n) => /Offering filed in the window/i.test(n))) dilution = true;
    conf = verifiedDoc ? 'VERIFIED_DOCUMENT' : f!.sourceTier === 'primary' ? 'VERIFIED_FILING' : f!.sourceTier === 'secondary' ? 'SECONDARY_SUMMARY' : 'UNVERIFIED';
    const renewal = notes.some((n) => /renewal or re-announcement/i.test(n));
    if (type === 'Capacity expansion' || type === 'Production ramp') {
      cap = parseCapacityChange(`${quote || ''} ${headline0}`);
      if (cap) {
        const lab: Materiality['label'] = cap.pct >= 25 ? 'SIGNIFICANT' : cap.pct >= 10 ? 'MODERATE' : 'SMALL';
        mat = { label: lab, ratios: [{ basis: 'current_capacity', pct: cap.pct, text: `${cap.delta} ÷ ${cap.before} current capacity = ${cap.pct}%` }], explanation: `Capacity increment ${cap.before} → ${cap.after} = +${cap.pct}% of current capacity.` };
        if (value != null) mat.ratios.push(...valueMateriality(value, marketCap, revenue, market, 'capex', verifiedDoc, renewal).ratios);
      } else mat = valueMateriality(value, marketCap, revenue, market, 'capex', verifiedDoc, renewal);
    } else {
      const k: keyof typeof BANDS = type === 'Acquisition' || type === 'JV' || type === 'Divestment' ? 'acquisition' : type === 'Buyback' ? 'buyback' : type === 'Order win' || type === 'Contract' || type === 'Customer win' ? 'order' : 'generic';
      mat = valueMateriality(value, marketCap, revenue, market, k, verifiedDoc, renewal);
    }
    const early = stage === 'RUMOUR' || stage === 'PROPOSED' || stage === 'ENABLING';
    if (early && mat.label !== 'UNKNOWN') {
      // A number attached to an LoI / MoU / proposal / board approval is scale,
      // not an economic commitment: nothing is booked or spent yet.
      const nonBinding = type === 'Partnership' || type === 'Contract' || type === 'Order win' || stage === 'RUMOUR';
      const ladder: Materiality['label'][] = ['SMALL', 'MODERATE', 'SIGNIFICANT'];
      mat = { ...mat, label: nonBinding ? 'UNKNOWN' : ladder[Math.max(0, ladder.indexOf(mat.label) - 1)],
        explanation: `${mat.explanation} ${nonBinding ? 'Non-binding / not awarded — the ratio shows scale only, not a commitment.' : `Not executed (${stage}) — one level lower until it is.`}` };
    }
    if (early && !label) label = type === 'Capacity expansion' ? 'Capex plan (not executed)' : `${type} (${stage.toLowerCase()}, not executed)`;
    if (type === 'Fundraising') {
      // zzz771: preferential / QIP / warrants / rights / private placement is
      // a potential catalyst with a dilution flag; NEGATIVE only on distress.
      dilution = true;
      fr = fundraisingOf(evHay, stage, value, marketCap, market, verifiedDoc, false);
      cls = fr.cls; label = early ? `${fr.label} (${stage.toLowerCase()}, not allotted)` : fr.label; mat = fr.mat;
    }
    else if (type === 'Management change' && /resign|cessation|steps? down|stepped down|departure/i.test(evHay)) { cls = 'NEGATIVE'; label = 'Management departure'; }
    else if (type === 'Management change' || type === 'Governance' || type === 'Rating action') cls = 'CONFIRMED_LOW_MATERIALITY';
    else if (early || conf === 'SECONDARY_SUMMARY' || conf === 'UNVERIFIED') cls = 'POTENTIAL_UNVERIFIED';
    else if (mat.label === 'SMALL') cls = 'CONFIRMED_LOW_MATERIALITY';
    else if (mat.label === 'SIGNIFICANT' || mat.label === 'MODERATE') cls = 'CONFIRMED_MATERIAL';
    else cls = verifiedDoc && (type === 'Regulatory approval' || type === 'Production ramp') ? 'CONFIRMED_MATERIAL' : 'POTENTIAL_UNVERIFIED';
    if (early && (type === 'Order win')) { type = 'Contract'; label = label || 'Enabling stage (not an order)'; }     // belt and braces: an early-stage "order" is never an order win
  } else if (earningsLead && e) {
    type = 'Earnings'; stage = 'MONETIZING'; conf = 'VERIFIED_FILING';
    mat = earningsMateriality(e, filed, market);
    const weak = String(filed!.tier || '').toUpperCase() === 'AVOID' || (e.revenueYoY != null && e.revenueYoY < 0 && (e.patYoY == null || e.patYoY < 0)) || (e.patYoY != null && e.patYoY <= -20);
    const strong = /BLOCKBUSTER|STRONG/i.test(String(filed!.tier || '')) || ((e.revenueYoY ?? -1) >= 15 && (e.patYoY ?? -1) >= 20);
    cls = e.revenueYoY == null && e.patYoY == null ? 'POTENTIAL_UNVERIFIED' : weak ? 'NEGATIVE' : strong && mat.label !== 'SMALL' ? 'CONFIRMED_MATERIAL' : 'CONFIRMED_LOW_MATERIALITY';
    label = weak ? 'Weak result' : null;
    headline = `${filed!.quarter ? `${filed!.quarter} result` : 'Quarterly result'} filed${filed!.filingDate ? ` ${filed!.filingDate}` : ''}${e.keyChange ? ` — ${e.keyChange}` : ''}`;
    sourceUrl = filed!.url || sourceUrl; filedDate = filed!.filingDate || filedDate; ageDays = filed!.ageDays ?? ageDays; value = null;
  } else if (status === 'routine_only') {
    routine = true;
    const unclassified = /not classifiable/i.test(headline0);
    cls = bandLevel != null && !unclassified ? 'MARKET_MOVE_ONLY' : 'NO_CATALYST';
    type = /debt financing/i.test(headline0) ? 'Debt / refinancing' : cls === 'MARKET_MOVE_ONLY' ? 'Market/technical move' : 'No identified catalyst';
    label = unclassified ? 'Unclassified filing — open it' : /debt financing/i.test(headline0) ? 'Debt financing (not a catalyst)' : 'Routine filings only';
    // zzz771: nothing here was verified as an event — the confidence is
    // UNVERIFIED, and the note says what WAS scanned so "no catalyst" is
    // never read as "nothing happened".
    conf = 'UNVERIFIED';
    const n = num(f?.filingsInWindow);
    scanNote = `${n != null && n > 0 ? `${n} ${scanScope} filing${n === 1 ? '' : 's'}` : `${scanScope === 'SEC' ? 'SEC' : 'Exchange'} filings`} in the last ${windowDays} days, ${unclassified ? 'none classifiable as an event' : 'all routine paperwork'} — ${notScanned}`;
  } else {
    // none / unresearched without a result
    cls = bandLevel != null ? 'MARKET_MOVE_ONLY' : 'NO_CATALYST';
    type = cls === 'MARKET_MOVE_ONLY' ? 'Market/technical move' : 'No identified catalyst';
    conf = 'UNVERIFIED';
    if (f) {
      // zzz782 (US): "EDGAR checked, only insider Form 4s" is said as such.
      const insider = market === 'US' ? /SEC EDGAR checked[^:]*: (\d+) insider ownership report/.exec(notes.join(' ')) : null;
      const checked = insider ? ` (EDGAR checked; ${insider[1]} insider Form 3/4/5/144 report${insider[1] === '1' ? '' : 's'} not counted as events)` : '';
      scanNote = `No ${scanScope} filing in the last ${windowDays} days${checked} — ${notScanned}`;
      if (!headline) headline = `No ${scanScope} filing in the last ${windowDays} days`;
      // "No filing in the last 21 days" reads as "nothing happened": it names
      // what was scanned instead. (zzz771)
      headline = headline.replace(/No filing in the last (\d+) days/, `No ${scanScope} filing in the last $1 days (${notScanned})`);
    } else if (!headline) headline = 'Not researched yet';
  }
  if (!headline) headline = label || type;

  // zzz771: can this event be THIS session's catalyst? Only classes that
  // carry a dated event get an answer; no-catalyst / listing / unavailable
  // rows have nothing to date.
  const dated = cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || cls === 'NEGATIVE';
  const catalystFor = dated ? catalystForOf(market, ageDays) : undefined;
  const isContext = catalystFor === 'CONTEXT';

  const trans = transmissionOf(type, cls, stage, mat.label);
  const pers = persistenceOf(type, cls, evHay);
  const persEv = persistenceEvidenceOf(type, cls, stage, nextKey(type, cls, stage, f, clarification), evHay, (f as any)?.persistence ?? null);
  // zzz782: a tax / penalty demand that is a rounding error against the
  // company's size (SEDEMAC ₹40,036; JAMNAAUTO ₹4 Cr) is shown, but as an
  // IMMATERIAL negative — not ranked with real negative evidence.
  let immaterialNegative = false;
  if (cls === 'NEGATIVE' && market === 'IN' && /\b(gst|tax|penalt\w*|demand|show[- ]cause|\bscn\b|notice|interest|fine)\b/i.test(evHay)) {
    const amt = negativeAmountCr(evHay);
    if (amt != null && marketCap && marketCap > 0) {
      const p = (amt / marketCap) * 100;
      if (p < 0.25) {
        immaterialNegative = true;
        mat = { label: 'SMALL', ratios: [{ basis: 'market_cap', pct: Math.round(p * 1000) / 1000, text: `${money(amt, market)} ÷ ${money(marketCap, market)} market cap = ${p < 0.01 ? '<0.01' : r1(p)}%` }],
          explanation: `Immaterial: the stated amounts total ${money(amt, market)}, ${p < 0.01 ? 'under 0.01' : r1(p)}% of market cap — a one-off tax / penalty item, recorded but not treated as negative evidence.` };
      }
    }
  }
  const fc = (() => {
    if (type === 'Earnings' && e?.revenueYoY != null) return { pct: Math.abs(e.revenueYoY), text: `revenue ${pctS(e.revenueYoY)} YoY` };
    const r0 = mat.ratios[0];
    if (!r0 || stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR') return null;
    const what = type === 'Capacity expansion' || type === 'Production ramp' ? 'capacity' : type === 'Acquisition' ? 'deal' : type === 'Buyback' ? 'buyback' : 'order';
    return { pct: r0.pct, text: `${what} = ${r0.pct}% of ${r0.basis === 'market_cap' ? 'market cap' : r0.basis === 'current_capacity' ? 'current capacity' : 'revenue'}` };
  })();
  const gap = gapOf(cls, mv, returns, fc);

  let whatChanged: string | null = null, before: string | null = null, after: string | null = null;
  if (cap) { whatChanged = `Capacity ${cap.before} → ${cap.after} (${cap.delta}, +${cap.pct}%)`; before = cap.before; after = cap.after; }
  else if (type === 'Earnings' && e && filed) {
    const parts: string[] = [];
    if (filed.salesPrev != null && filed.salesCurr != null) { parts.push(`Revenue ${money(filed.salesPrev, market)} → ${money(filed.salesCurr, market)} (${pctS(e.revenueYoY)} YoY)`); }
    else if (e.revenueYoY != null) parts.push(`Revenue ${pctS(e.revenueYoY)} YoY`);
    if (filed.patPrev != null && filed.patCurr != null) parts.push(`PAT ${money(filed.patPrev, market)} → ${money(filed.patCurr, market)} (${pctS(e.patYoY)} YoY)`);
    else if (e.patYoY != null) parts.push(`PAT ${pctS(e.patYoY)} YoY`);
    whatChanged = parts.length ? parts.join('; ') : null;
    if (filed.salesPrev != null || filed.patPrev != null) before = [filed.salesPrev != null ? `Revenue ${money(filed.salesPrev, market)}` : null, filed.patPrev != null ? `PAT ${money(filed.patPrev, market)}` : null].filter(Boolean).join(', ') + ' (year-ago quarter)';
    if (filed.salesCurr != null || filed.patCurr != null) after = [filed.salesCurr != null ? `Revenue ${money(filed.salesCurr, market)}` : null, filed.patCurr != null ? `PAT ${money(filed.patCurr, market)}` : null].filter(Boolean).join(', ') + ' (this quarter)';
  } else if (value != null && (cls === 'CONFIRMED_MATERIAL' || cls === 'CONFIRMED_LOW_MATERIALITY' || cls === 'POTENTIAL_UNVERIFIED' || type === 'Order cancellation')) {
    const earlyW = stage === 'ENABLING' || stage === 'PROPOSED' || stage === 'RUMOUR';
    const noun = type === 'Order cancellation' ? 'Order cancelled' : type === 'Acquisition' ? 'Acquisition' : type === 'Buyback' ? 'Buyback' : type === 'Fundraising' ? 'Issue size' : type === 'Capacity expansion' ? 'Capex' : 'Order';
    const ratioTxt = mat.ratios[0] ? ` = ${mat.ratios[0].pct}% of ${mat.ratios[0].basis === 'market_cap' ? 'market cap' : 'revenue'}` : '';
    whatChanged = earlyW
      ? `${label || type}: ${money(value, market)} stated, nothing booked yet (${stage})${ratioTxt ? ` — scale${ratioTxt}` : ''}`
      : `${noun} ${money(value, market)}${ratioTxt}${conf === 'VERIFIED_DOCUMENT' ? '' : ' (figure not verified in the document)'}`;
  }

  // zzz776: a GDV / "may unlock" figure is headline SCALE, not the company's
  // financial impact — shown as such rather than "not established".
  // (the same test as catalyst-research's isPotentialValue — kept local: this module stays client-safe)
  const isPotentialValue = (h: string): boolean => /\bgdv\b|gross development value|revenue potential|top ?line potential|sales potential|peak (revenue|sales) potential|may unlock|potential (revenue|value|topline)|market (size|opportunity) of/i.test(h);
  if (!whatChanged && isPotentialValue(`${headline0 || ''} ${(f?.notes || []).join(' ')}`)) {
    const m = /((?:inr|₹|rs\.?)\s*[\d,.]+(?:\s*[-–]\s*[\d,.]+)?\s*(?:crores?|cr\b|lakh crore|million|billion|bn|mn))[^.;]{0,30}/i.exec(String(headline0 || ''));
    whatChanged = `Headline scale${m ? `: ${m[0].trim()}` : ''} — project / potential scale, not the company's revenue or share; company financial impact not established`;
  }
  const key = nextKey(type, cls, stage, f, clarification);
  // zzz775: a research question the filing already answers is shown WITH its
  // answer; one the model-read filing is silent on says so. Only a filing
  // that was not read keeps the bare question.
  const researchNext = answerQuestions((NEXT[key] || NEXT.generic).slice(0, 8), {
    facts: f?.facts || null, read: verifiedDoc, value, marketCap, market,
    revenue: revenue ? revenue.v : null, headline: headline0, quote,
  });
  // A clarification's unknowns are a no-catalyst row's (cause of the move), not a negative event's impact. (zzz771)
  const unknowns = unknownsFor(clarification ? 'none' : key, hay, value != null, e);
  const portfolio = portfolioOf(ticker, type, cls, e, { ...sets, vars: input.thesisVariables, findingHeld: !!f?.holding });
  // zzz771: an older event keeps its class but is labelled as context, its
  // EarningsMini is kept (stale), and its action is to monitor, not review.
  const earnings = e && isContext ? { ...e, stale: true } : e;
  const shownHeadline = isContext ? `Older context (${ageDays}d): ${headline}` : headline;
  const item: ResearchItem = {
    // zzz782: the US export carries 1W only; the 1D is the last daily bar
    // against the close before it, from the dated closes the sweep fetched.
    ticker, company, market, move1d: market === 'US' ? (num((f?.returns as any)?.d1) != null ? r1(num((f?.returns as any)?.d1)!) : null) : mv.pct, returns, marketCap,
    eventClass: cls, eventType: type, headline: clean(shownHeadline), whatChanged, before, after, filedDate, stage,
    sourceConfidence: conf, sourceUrl, quote, materiality: mat, transmission: trans,
    transmissionChain: chainOf(type, trans, stage, { headline: clean(headline), value, market, mat, e, f: filed, cap }),
    persistence: pers, persistenceEvidence: persEv, immaterialNegative, expectationGap: gap, unknowns, researchNext, pricing: pricingOfFinding(f),
    whyResearch: whyOf(cls, type, stage, mat, key, gap, e, fr, clarification),
    portfolio, earnings,
    flags: { band: bandLevel, listing, dilution, denial, turnover: num(f?.turnover) ?? num(b?.turnover) },
    priority: 0, priorityReasons: [], scoreDetails: null,
    eventLabel: label || type, action: isContext ? 'Monitor' : actionOf(cls, portfolio.relevance), move: mv, findingStatus: status, notes, ageDays,
    catalystFor, ...displayNameOf(ticker, company), scanNote,
    persistentCatalyst: f?.persistence ?? null,
    news: f?.news ? { narrative: f.news.narrative ? { label: f.news.narrative.label, days: f.news.narrative.days, firstDate: f.news.narrative.firstDate, lastDate: f.news.narrative.lastDate, lead: f.news.narrative.lead } : null, items: f.news.items.slice(0, 3).map((x) => ({ title: x.title, url: x.url, date: x.date, source: x.source })) } : null,
  };
  const staleEarnings = type === 'Earnings' && e?.filedDaysAgo != null && e.filedDaysAgo > CATALYST_WINDOWS[market].recent;
  const p = priorityOf(item, { routine, pricingState: (f?.components as any)?.pricing?.state ?? null, staleEarnings, veryStale: staleEarnings && (e!.filedDaysAgo as number) > 60, namedAllottee: !!fr?.named, clarification });
  item.priority = p.score; item.priorityReasons = p.reasons; item.scoreDetails = p.details;
  return item;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE VIEW
// ═══════════════════════════════════════════════════════════════════════════

const CLASS_RANK: Record<EventClass, number> = { CONFIRMED_MATERIAL: 0, POTENTIAL_UNVERIFIED: 1, CONFIRMED_LOW_MATERIALITY: 2, NEGATIVE: 3, NO_CATALYST: 4, MARKET_MOVE_ONLY: 5, LISTING: 6, DATA_UNAVAILABLE: 7 };
const byPriority = (a: ResearchItem, b: ResearchItem) => (b.priority - a.priority) || (CLASS_RANK[a.eventClass] - CLASS_RANK[b.eventClass]) || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);

export function buildResearchView(input: ResearchViewInput): ResearchView {
  const market = input.market === 'US' ? 'US' : 'IN';
  const inp: ResearchViewInput = { ...input, market };
  const board = new Map<string, BoardRow>();
  for (const r of input.board || []) { const t = up(r?.ticker); if (t && !board.has(t)) board.set(t, r); }
  const findings = new Map<string, Finding>();
  for (const [k, f] of Object.entries(input.findings || {})) if (f) findings.set(up(k || f.ticker), f);
  const filed = new Map<string, FiledRow>();
  for (const raw of input.filedResults || []) { const r = normaliseFiledRow(raw, input.now); if (r && !filed.has(r.ticker)) filed.set(r.ticker, r); }
  const sets = { held: new Set((input.holdings || []).map(up)), watch: new Set((input.watchlist || []).map(up)), theme: new Set((input.sameTheme || []).map(up)) };

  // The universe: the board when there is one; otherwise whatever was researched or filed.
  const tickers = board.size ? Array.from(board.keys()) : Array.from(new Set([...Array.from(findings.keys()), ...Array.from(filed.keys())]));
  tickers.sort();
  const items: ResearchItem[] = [];
  let unresearched = 0;
  for (const t of tickers) {
    const f = findings.get(t) || null;
    const fr = filed.get(t) || null;
    if ((!f || f.status === 'unresearched') && !fr) { unresearched++; continue; }
    items.push(buildResearchItem(t, f, board.get(t) || null, fr, inp, sets));
  }
  items.sort(byPriority);

  // zzz771: an event older than the move window is CONTEXT — real, kept with
  // its class, but never this move's catalyst. It leaves every ranked section
  // (queue / watch / negative / no-catalyst) for its own list, and the summary
  // counts it as "no fresh catalyst for this move". INVARIANTS the tests hold:
  //   queue ∪ watch ⊆ eligible ∖ context;  context ∩ (queue ∪ watch ∪ negative
  //   ∪ noCatalyst) = ∅;  summary.confirmed / potential / negative exclude
  //   context;  summary.noCatalyst includes it;  the class totals still add
  //   up to `scanned`.
  const context = items.filter((i) => i.catalystFor === 'CONTEXT');
  const live = items.filter((i) => i.catalystFor !== 'CONTEXT');
  const eligible = live.filter((i) => i.eventClass === 'CONFIRMED_MATERIAL' || i.eventClass === 'CONFIRMED_LOW_MATERIALITY' || i.eventClass === 'POTENTIAL_UNVERIFIED');
  const queue = eligible.filter((i) => i.priority >= 12).slice(0, 15);
  const inQ = new Set(queue.map((i) => i.ticker));
  const watch = eligible.filter((i) => !inQ.has(i.ticker)).slice(0, 20);
  const top3 = queue.filter((i) => i.priority >= 25).slice(0, 3);
  const negative = live.filter((i) => i.eventClass === 'NEGATIVE' && !i.immaterialNegative);
  const immaterialNegative = live.filter((i) => i.eventClass === 'NEGATIVE' && i.immaterialNegative);
  const noCatalyst = live.filter((i) => i.eventClass === 'NO_CATALYST' || i.eventClass === 'MARKET_MOVE_ONLY');
  const dataQuality = items.filter((i) => i.eventClass === 'LISTING' || i.eventClass === 'DATA_UNAVAILABLE');
  const portfolio = items.filter((i) => i.portfolio.relevance === 'HOLDING' || i.portfolio.relevance === 'WATCHLIST');

  const universe = tickers.map((ticker) => ({ ticker }));
  const lines = presentErrorLines(input.errors || [], universe, 60);
  // zzz773: the error log is cumulative across calls. A name whose filings
  // were read (any status but source_failed) was CHECKED, whatever an earlier
  // call logged; only its missing price history is a partial failure, and
  // only while the price history is still missing.
  const byTicker = new Map(items.map((i) => [i.ticker, i] as const));
  const lastLine = new Map<string, { short: string; full: string }>();
  for (const l of lines) if (l.ticker) lastLine.set(l.ticker, { short: l.short, full: l.full });
  const sourceFailures: ResearchView['sourceFailures'] = [];
  const partialFailures: NonNullable<ResearchView['partialFailures']> = [];
  for (const i of items) {
    if (i.eventClass !== 'DATA_UNAVAILABLE') continue;
    const l = lastLine.get(i.ticker);
    sourceFailures.push({ ticker: i.ticker, text: l?.short || `${i.ticker}: filing source unavailable — not "no catalyst"`, full: l?.full || (i.notes || []).join(' ') || 'The filing source could not be reached.', news: i.news ?? null });
  }
  for (const [t, l] of Array.from(lastLine.entries())) {
    const it = byTicker.get(t);
    if (!it || it.eventClass === 'DATA_UNAVAILABLE') continue;
    const noPrice = it.returns.m1 == null && it.returns.m3 == null;
    if (noPrice && /chart|price/i.test(l.full)) partialFailures.push({ ticker: t, text: `${t}: filings checked; price history unavailable — market response not measured`, full: l.full });
  }
  // Class counts over the LIVE items; context is counted once, under noCatalyst. (zzz771)
  const count = (c: EventClass) => live.filter((i) => i.eventClass === c).length;
  const s0 = input.session || { date: null, scanAt: null, status: 'unknown', cached: false };
  const session: ResearchView['session'] = { ...s0 };
  if (session.note == null) {
    session.note = market === 'US'
      ? 'US moves are 1-week performance from the export, not a one-day move.'
      : session.isToday === false ? `Moves are from the last completed session${session.date ? ` (${session.date})` : ''}, not today.` : null;
  }
  return {
    session,
    summary: {
      scanned: tickers.length, confirmed: count('CONFIRMED_MATERIAL') + count('CONFIRMED_LOW_MATERIALITY'), potential: count('POTENTIAL_UNVERIFIED'),
      negative: count('NEGATIVE'), noCatalyst: count('NO_CATALYST') + count('MARKET_MOVE_ONLY') + context.length, queue: queue.length,
      portfolioMatches: portfolio.length, dataUnavailable: count('DATA_UNAVAILABLE'),
      lowMateriality: count('CONFIRMED_LOW_MATERIALITY'), marketMoveOnly: count('MARKET_MOVE_ONLY'), listings: count('LISTING'), unresearched, watch: watch.length,
      context: context.length,
    },
    top3, queue, watch, negative, immaterialNegative, noCatalyst, dataQuality, sourceFailures, partialFailures, portfolio, context,
  };
}
