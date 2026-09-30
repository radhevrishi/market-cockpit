// zzz841 — Multibagger / Structural Inflection Radar: the pure, deterministic engine.
//
// No network, no AI, no clock inside the logic (only an injectable `now` used to
// order items that carry `ageHours` instead of a date). Same input -> same output.
//
// HARD RULES (see multibagger-radar-types.ts): price is never an input; unknown is
// never negative; a hypothesis never looks confirmed; no buy / sell / target-price
// language; no visible 0-100 score; nothing is invented (a chain step is 'proven'
// only when a supplied source sentence or supplied data supports it).
//
// Units: every percentage in RadarInput is a plain number (25 means 25%).

import {
  BUCKET_ORDER, DURATION_LABEL, EVIDENCE_LABEL, INFLECTION_LABEL, KIND_LABEL, LINK_LABEL,
  PRIORITY_LABEL,
} from './multibagger-radar-types';
import type {
  CatalystKind, CatalystLink, CatalystLinkKey, CatalystMaturity, ChainStatus, ChainStep, Confidence, DurationCode, DurationRead,
  DurationSource, EarningsImpactStatus, EventClass, EventConfirmation, EvidenceDelta, EvidenceRead, EvidenceStatus, ExpectationsLabel,
  ExpectationsRead, FalsePositiveReason, GovernanceRead, HalfLife, HistoricalAnalogue, ImpactMap, IndicatorType, InflectionState,
  IntegrityCode, LedgerEntry, LinkStatus, LinkStrength, Materiality, MechanismStatus, MonitorAnswers, PriceResponse, ProofPoint,
  QuantificationStatus, RadarBucket, RadarItem, ResearchPriority, SharedDriverGroup, SourceDiversity, SourceQuality, TechnicalContext,
  ThesisIntegrity, ThesisMonitor, ThesisStatus, QuarantineReason,
} from './multibagger-radar-types';
import type { RadarFeedHints } from './multibagger-radar-feed-types';
import { NOT_IDENTIFIED, entityTokens, keyNumbers, publisherFamily } from './special-sit-feed-quality';

export const RADAR_ENGINE_VERSION = 'zzz845-radar-v2';

// ─────────────────────────── input types ───────────────────────────

export type RadarCategory = 'SPIN' | 'MA' | 'TURN' | 'CAP' | 'CAPEX' | 'CONCALL';

export interface RadarEarnings {
  revenueYoY?: number | null; revenuePrevYoY?: number | null;
  marginNow?: number | null; marginPrior?: number | null;
  patYoY?: number | null; cfoToPat?: number | null;
  /** Number of consecutive quarters that support the picture. */
  quarters?: number | null;
  guidance?: 'RAISED' | 'MAINTAINED' | 'CUT' | 'NOT_STATED';
  orderBook?: 'UP' | 'DOWN' | 'UNCHANGED' | 'NOT_STATED';
}

export interface RadarGovernanceInput {
  auditorIssue?: boolean | null;
  qualifiedOpinion?: boolean | null;
  /** Promoter shares pledged, percent. */
  promoterPledgePct?: number | null;
  relatedPartyConcern?: boolean | null;
  /** Share-count dilution, percent over the recent period (or true when dilution is flagged without a number). */
  dilutionPct?: number | boolean | null;
  debtToEquity?: number | null;
  interestCover?: number | null;
  regulatoryIssue?: boolean | null;
  accountingRedFlag?: boolean | null;
}

export interface RadarTechnicalInput {
  trend?: string | null;
  relativeStrength?: string | number | null;
  breakout?: boolean | string | null;
  volumeConfirmation?: boolean | string | null;
}

/** One article / filing behind an event. Used to de-duplicate syndicated copies and to judge source diversity. */
export interface RadarSourceInput { label?: string; url?: string | null; title?: string; publishedAt?: string | null; primary?: boolean }

/** Company size context for materiality. Every number is in `unit` of `currency` (default MILLION). Omit what is not known. */
export interface RadarCompanyContext {
  currency?: string; unit?: 'CRORE' | 'MILLION' | 'BILLION';
  revenue?: number | null; ebitda?: number | null; pat?: number | null; marketCap?: number | null;
}

/** The previous read of the same catalyst, used to compute evidenceDelta and to keep first-seen dates. Build it with snapshotOf(). */
export interface RadarSnapshot {
  evidenceStatus?: EvidenceStatus; catalystProgression?: number; catalystMaturity?: CatalystMaturity | null;
  linkStatus?: Partial<Record<CatalystLinkKey, LinkStatus>>; sourceCount?: number; primaryConfirmed?: boolean; commercialConfirmed?: boolean;
  financiallyVisible?: boolean;
  firstDiscovered?: string | null; firstPrimaryConfirmation?: string | null; firstFinancialConfirmation?: string | null; firstMaterialEarningsImpact?: string | null;
}

export interface RadarInput extends RadarFeedHints {
  id: string;
  ticker: string | null;
  company: string;
  region: 'IN' | 'US' | 'GLOBAL';
  title: string;
  description?: string;
  /** Existing Special Situations feed event_type, used as a hint only. */
  eventType?: string;
  category?: RadarCategory;
  sourceLabel?: string;
  primarySource?: boolean;
  independentSources?: number;
  publishedAt?: string | null;
  url?: string | null;
  ageHours?: number;
  earnings?: RadarEarnings | null;
  governance?: RadarGovernanceInput | null;
  /** TIMING ONLY. Never used for bucket, priority, duration, evidence or link. */
  technical?: RadarTechnicalInput | null;
  multipleNow?: number | null;
  forwardEarningsGrowth?: number | null;
  feedTier?: string;
  /** Every article / filing behind the event; syndicated and near-identical copies are collapsed to one source. */
  sources?: RadarSourceInput[];
  companyContext?: RadarCompanyContext | null;
  previous?: RadarSnapshot | null;
  /** Optional analogue text supplied by the caller. Shown as context only, never as a prediction. */
  historicalAnalogue?: string | null;
  feedFacts?: { what_happened?: string; what_matters?: string; what_to_watch?: string; what_breaks_thesis?: string };
}

export interface RadarCounts {
  total: number;
  byBucket: Record<RadarBucket, number>;
  byPriority: Record<ResearchPriority, number>;
  lowSignal: number;
  holdings: number;
  /** Syndicated / near-identical inputs merged into another input by buildRadar. */
  duplicatesMerged?: number;
  /** zzz847: items kept out of every thesis bucket (registrations, price articles, previews, analyst targets, opinion, non-company news, unidentified). */
  quarantined?: number;
  quarantineByReason?: Partial<Record<QuarantineReason, number>>;
  /** Items in the Special situations bucket; quarantined items are never in it. */
  specialSituations?: number;
}

export interface RadarResult {
  items: RadarItem[];
  byBucket: Record<RadarBucket, RadarItem[]>;
  sharedDrivers: SharedDriverGroup[];
  counts: RadarCounts;
}

export interface RadarOptions { holdings?: string[]; now?: number }

// ─────────────────────────── small helpers ───────────────────────────

const NE = 'Not established';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);
const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const uniq = <T,>(a: T[]) => Array.from(new Set(a));
const sentencesOf = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map(squash).filter(Boolean);
const sentenceWith = (sents: string[], re: RegExp): string | null => {
  for (const s of sents) if (re.test(s)) return clip(s, 240);
  return null;
};
function joinList(a: string[]): string {
  if (a.length === 0) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

// ─────────────────────────── regex families ───────────────────────────

const RE = {
  disproved: /\b(cancel+ed|cancell?ation|terminated|termination of (?:the )?(?:order|contract|agreement|deal|merger)|denied|denies|withdrawn|withdraws?|withdrew|rejected|rejects?|called off|scrapped|abandon(?:ed|s)|fell through|no longer (?:proceed|going ahead))\b/i,
  tentative: /\b(in talks|exploring|explores|considering|considers|proposes?|proposed|plans? to|planning to|intends? to|likely to|may|might|could|seeks? to|aims? to)\b/i,
  // analyst / price / promo / generic / sector / technical noise
  analyst: /\b(price (?:target|objective)|target price|raises? (?:its )?target|cuts? (?:its )?target|target (?:raised|cut|lifted)|(?:upgrades?|downgrades?|initiates?|reiterates?|maintains?) (?:coverage|rating|stock|shares|to (?:buy|sell|hold|outperform|overweight|neutral|underweight))|(?:buy|sell|hold|outperform|overweight|underweight) rating|analyst (?:rating|call|pick)|broker(?:age)? (?:says|rates|rating|pick|note|upgrade|downgrade)|top pick)\b/i,
  priceMove: /\b(?:shares?|stock|scrip|equity|counter)\b.{0,40}\b(?:surges?|jumps?|rall(?:y|ies|ied)|soars?|spikes?|slumps?|tumbles?|plunges?|falls?|drops?|gains?|climbs?|hits?|zooms?|skyrockets?)\b|\b(?:52[\s-]?week (?:high|low)|all[\s-]?time high|upper circuit|lower circuit|top gainers?|top losers?|biggest gainers?|volume spike|record high)\b/i,
  promo: /\b(bullish|poised to (?:soar|explode|rally)|set to (?:soar|explode|skyrocket|rally)|strong outlook|positive outlook|game[\s-]?changer|revolutionary|next big thing|multi[\s-]?bagger|to the moon|hidden gem|massive upside|explosive (?:growth|potential)|can'?t miss|once[\s-]?in[\s-]?a[\s-]?lifetime|rocket|skyrocket\w*|amazing|incredible|turbocharg\w+|goldmine)\b/i,
  genericAI: /\b(AI (?:boom|revolution|wave|play|frenzy|theme|trade|narrative|hype|mania|era|tailwinds?|momentum|euphoria)|artificial intelligence (?:boom|revolution|wave|hype)|riding the AI|AI[\s-]?driven (?:rally|optimism)|AI beneficiar\w+|AI stocks?)\b/i,
  sector: /\b(sector (?:outlook|view|commentary|update|rally|momentum|tailwinds?|is set|looks|to (?:benefit|gain|see))|industry (?:outlook|trends?|experts?|watchers|analysts)|(?:analysts?|experts?|strategists?) (?:say|expect|believe|see|feel|reckon) (?:the )?(?:sector|industry|market)|(?:sector|industry)-wide|market outlook|outlook for the (?:sector|industry))\b/i,
  technical: /\b(breakout|breaks? out|breaking out|moving average|\d+[\s-]?(?:dma|dema|ema|sma)\b|golden cross|death cross|RSI\b|MACD|support (?:level|zone)|resistance (?:level|zone)|chart pattern|cup and handle|technical (?:setup|view|analysis|outlook|picks?)|relative strength|volume (?:breakout|surge)|bullish (?:pattern|engulfing)|price action)/i,
  // concrete company evidence
  amount: /(?:₹|rs\.?|inr|us\$|\$|usd|eur|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(?:crores?|cr|lakhs?|million|mn|billion|bn|m|b|k)?|\d[\d,]*(?:\.\d+)?\s?(?:crores?|cr|million|billion|mn|bn)\b/gi,
  percent: /\d+(?:\.\d+)?\s?(?:%|per ?cent)/gi,
  units: /\d[\d,.]*\s?(?:mtpa|ktpa|tpa|mw|gw|gwh|mwh|mt|units|tonnes|wafers|beds)\b/gi,
  concreteVerb: /\b(wins?|won|awarded|secures?|secured|signs?|signed|receives?|received|bags?|bagged|commission(?:s|ed)|completes?|completed|approved|approval|qualified|launch(?:es|ed)|reports?|reported|announces?|announced|acquires?|acquired|files?|filed|declares?|declared|records?|recorded|starts?|started|begins?|began|expands?|expanded|invests?|invested|clears?|cleared|nominated|added)\b/i,
  // detectors
  qual: /(approved (?:supplier|vendor|source)|vendor approval|supplier approval|design[\s-]?wins?|qualification (?:completed|complete|cleared|approval|successful|received)|(?:complet\w+|cleared|passed|received|achieved|obtain\w+) (?:customer |product |vendor )?qualification|qualified (?:as|by|with)|platform nomination|nominated (?:as|for|supplier)|production award|(?:series|volume|mass) production (?:award|order|contract|nomination)|recurring (?:PO|purchase order)s?|repeat orders?|sole[\s-]?source|preferred (?:supplier|vendor|partner)|type approval|PPAP|first article approval|empanel\w*|added to (?:the )?(?:approved|vendor) list)/i,
  prodAward: /(production award|(?:series|volume|mass) production (?:award|order|contract|nomination)|recurring (?:PO|purchase order)s?|platform nomination|repeat orders?)/i,
  bottleneck: /(shortage|short supply|supply[\s-](?:constrain\w*|tight\w*|crunch|gap|deficit|bottleneck)|constrained supply|supply[\s-]?constrained|(?:long|extended|stretch\w*) lead[\s-]?times?|lead[\s-]?times? (?:of|extend\w*|stretch\w*|exceed\w*)|qualification (?:barriers?|cycles?|period)|(?:barriers?|hurdles?) to entry|entry barriers?|scarce|scarcity|limited (?:number of )?(?:suppliers?|qualified|players|vendors|capacity)|only (?:a )?(?:few|two|three|handful|one)\b[^.]{0,30}(?:suppliers?|players|vendors|manufacturers|producers|companies)|sole[\s-](?:supplier|source)|single[\s-]source|regulatory barriers?|licen[cs]e[\s-]required|allocations? (?:basis|of (?:supply|capacity|units|chips))|capacity (?:is )?(?:sold out|fully booked|constrained)|(?:can'?t|cannot) (?:be )?(?:easily )?(?:replicated|substituted)|hard to (?:replicate|substitute)|supply[\s-]demand imbalance|component shortage|bottleneck)/i,
  demand: /(demand (?:surge|surges|surged|explosion|boom|spike|outstrips?|outstripping|far exceeds?|exceeds? supply)|surging demand|explosive demand|record (?:order|orders|order book|order inflow|bookings|backlog)|order (?:book|inflow|backlog)s? (?:surge\w*|doubl\w+|tripl\w+|jump\w*|rose|up|record|at (?:a )?record)|oversubscri\w+|(?:booked|sold)[\s-](?:out|through)|multi[\s-]?fold|backlog (?:of|at|rose|surge)|order backlog)/i,
  supplyDemand: /(price (?:hike|increase|rise)s?|prices? (?:rise|rising|rose|surge|surged|firm|firming|up)|spreads? (?:widen|widening|expand)|realisations? (?:rise|up|improv\w+)|tariff (?:hike|increase)|anti[\s-]?dumping duty|safeguard duty|import (?:duty|curbs?|ban)|supply (?:cuts?|discipline|deficit|rationali[sz]ation)|production cuts?|capacity (?:shutdowns?|closures?|rationali[sz]ation)|destocking (?:ends|over|complete)|cycle (?:turns?|upturn|bottom\w*)|upcycle|demand[\s-]supply (?:gap|imbalance|mismatch)|china\s?\+\s?1|import substitution)/i,
  newProduct: /(launch(?:es|ed|ing)?|new (?:product|platform|molecule|variant|segment)|enters? (?:the )?[\w\s-]{0,25}market|entry into|commerciali[sz]ation|first commercial|(?:usfda|fda|dcgi|cdsco|ema|who|mhra) (?:approval|clearance|nod)|regulatory approval|receives? approval|patent (?:granted|grant)|expands? into|foray into|debut)/i,
  approval: /(approval|clearance|patent|licen[cs]e|nod)/i,
  operating: /(margin (?:expan\w+|improv\w+|inflection|up)|operating leverage|turned profitable|first (?:quarterly |annual )?profit|return(?:ed)? to profit|profitab\w+ inflection|record (?:quarterly |annual )?(?:revenue|profit|ebitda|pat|sales|earnings)|(?:ebitda|operating|gross|pat) margins? (?:rose|rise|up|improved|expanded|widened|of \d)|(?:revenue|sales|pat|net profit|profit|ebitda|earnings|volumes?) (?:up|rose|grew|growth|jumped|surged|doubled|tripled|increased) (?:by |of |to )?[\d₹$]|(?:doubled|tripled)|utili[sz]ation (?:rose|rises|up|improv\w+|increas\w+|at \d)|break[\s-]?even)/i,
  isResult: /(\bq[1-4]\s?fy\s?\d{2}|\bh[12]\s?fy\s?\d{2}|\bfy\s?\d{2} results|(?:quarterly|annual|half[\s-]?yearly|full[\s-]?year) results?|results? for the (?:quarter|year)|earnings (?:release|report|call)|reports? (?:q[1-4]|quarter)|(?:first|second|third|fourth) quarter (?:results|earnings)|net profit|\bPAT\b|\bEBITDA\b)/i,
  capexWord: /(\bcapex\b|capital expenditure|capital outlay|investment (?:of|worth)|invest(?:s|ing|ed)? (?:up to |about )?(?:[₹$€]|rs\.?|inr|usd)|expansion plans?|to invest)/i,
  capacityIncrease: /(\bcapacity (?:expansion|addition|increase|enhancement|ramp[\s-]?up|build[\s-]?out|of \d)|\b(?:add|adds|adding|added|expand|expands|expanding|expanded|increase|increases|increasing|double|doubles|doubling|triple|scale up|scaling up|enhance)\b[^.]{0,40}\bcapacity|\bnew (?:plant|facility|factory|line|fab|unit|furnace|kiln|mine|refinery)|\bgreenfield|\bbrownfield|\bdebottleneck\w*|\bcommission(?:s|ed|ing)? (?:of )?(?:a |the |new )?(?:plant|facility|line|unit))/i,
  custDemand: /\b(customers?|demand|order book|backlog|orders?|committed|anchor|off-?take)\b/i,
  utilisation: /(utili[sz]ation|running at \d+\s?%|operating at \d+\s?%|(?:sold|booked) out|fully booked)/i,
  contract: /\b(contracts?|off-?take|agreements?|purchase (?:order|commitment)|letter of (?:award|intent)|LoA|LoI|take[\s-]or[\s-]pay|long[\s-]term supply)\b/i,
  orderLike: /((?<!in )\border(?:s)?\b|\bawarded\b|\bcontracts?\b|letter of (?:award|intent)|\bLoA\b|\bLoI\b|off-?take|supply agreement|framework agreement|purchase order|work order|\bPOs?\b)/i,
  companyAdvantage: /\b(sole|only|approved|qualified|market share|leader|leading|first|proprietary|patent\w*|design[\s-]?win|preferred|incumbent|difficult to replace)\b/i,
  traction: /\b(first (?:sales|revenue|shipment|delivery|order)|shipments?|orders? (?:received|booked|worth)|revenue|deliver\w+|commercial production|customers?)\b/i,
  transformational: /(transformational|transformative|new (?:multi-?billion|large|huge|massive) market|multi-?decade|\d+(?:\.\d+)? ?(?:billion|bn|trillion|tn) (?:market|opportunity|addressable)|addressable market of|\bTAM\b)/i,
  capability: /(qualified|qualification|approved|design[\s-]?win|patent|proprietary|first commercial|licensed|certified|platform)/i,
  durableSS: /(growth business|high[\s-]?growth|unlock\w*|contribut\w+[^.]{0,30}(?:revenue|ebitda|profit|earnings|%)|(?:adds?|adding)[^.]{0,30}(?:capacity|customers?|revenue|ebitda)|capacity of \d|customer base|accretive|synerg\w+[^.]{0,30}\d|capital efficiency|return on capital|\bROCE\b|asset quality|cash generation|free cash flow|addressable market|market share|competitive position)/i,
  quantAdd: /\d/,
  // ── zzz845: event parsing before classification ──
  corpAction: /(\b(?:interim|final|special|annual|quarterly)?\s?dividends?\b|\bdividend[\s-]?(?:stock|yield|payout|record|declared|announced)|\d+(?:\.\d+)?\s?%\s*dividend|\b(?:stock|share|equity)\s+splits?\b|\bsplit\s+watch\b|\bsub[\s-]?division of (?:equity )?shares|\bconsolidation of (?:equity )?shares|\bbonus (?:issue|shares?|debentures?)|\bbonus\b.{0,20}\b(?:ratio|\d\s?:\s?\d)|\brecord[\s-]?date\b|\bex[\s-]?(?:date|dividend|split|bonus)\b|\bex-?entitlement\b|\bface value (?:split|of)\b|\bstock split\b)/i,
  rumour: /\b(rumou?rs?|speculation|speculative reports?|unconfirmed reports?|media reports?|news reports?|reports? (?:of|that|suggest\w*|claim\w*)|social media (?:posts?|claims?)|viral (?:post|message|claims?)|fake (?:news|message)|misinformation|clarif\w+)\b/i,
  denial: /\b(denied|denies|deny|denying|refut\w+|baseless|unfounded|false|untrue|incorrect|misleading|no such (?:proposal|plan|decision)|not (?:under consideration|true|correct)|no proposal|rejects? (?:the )?(?:reports?|claims?|rumou?rs?)|dismiss\w+ (?:the )?(?:reports?|claims?|rumou?rs?))\b/i,
  legalSAT: /(\bSAT\b|\bNCLAT\b|\bNCLT\b|\bITAT\b)/,
  legalCase: /(\bSecurities Appellate Tribunal\b|\bappellate tribunal\b|\bhigh court\b|\bsupreme court\b|\btribunals?\b|\bcourts?\b|\bverdict\b|\bacquit\w*|\bquash(?:ed|es)\b|\bset(?:s|ting)? aside\b|\bstay(?:ed)? (?:on|order)\b|\blitigation\b|\blawsuit\b|\bappeals? (?:allowed|dismissed|rejected|upheld|filed)\b|\bjudg(?:e)?ment\b|\binjunction\b)/i,
  regDecision: /(\bSEBI\b|\bRBI\b|\bCCI\b|\bregulator\w*|\bshow[\s-]cause|\bpenalt(?:y|ies)\b|\bfined?\b|\bsettlement order\b|\bconsent order\b|\bwarning letter\b|\bdebarred?\b|\brelief\b|\bprobe\b|\binvestigation\b)/i,
  fdaLike: /\b(usfda|fda|dcgi|cdsco|ema|mhra|who[\s-]gmp|nmpa|anda|nda)\b/i,
  capRaise: /(\bwarrants?\b|\bQIP\b|qualified institutions? placement|preferential (?:allotment|issue|basis|warrants?)|\bOFS\b|offer for sale|fund[\s-]?rais\w*|capital[\s-]?rais\w*|equity (?:infusion|raise|issue)|private placement|\bFCCBs?\b|convertible (?:debentures?|bonds?|notes?)|allot(?:s|ted|ment)?\s+(?:of\s+)?(?:[\w.,]+\s+){0,4}(?:equity|shares|warrants|debentures|securities)|raises? (?:₹|rs\.?|inr|\$|us\$)?\s?[\d,.]+\s?(?:crores?|cr|million|billion|mn|bn)?\s?(?:via|through|by|from))/i,
  debtFin: /(\bNCDs?\b|non[\s-]convertible debentures?|bond issue|term loan|credit facility|working capital (?:loan|facility)|loan sanction|sanctioned (?:a )?loan|debt raise|refinanc\w+|external commercial borrowing|\bECB\b|raises? (?:[\w₹$.,\s]{0,24})?(?:via|through) (?:bonds?|debentures?|loans?|debt))/i,
  useOfProceeds: /(use of proceeds|proceeds (?:will|to|would)|to (?:fund|finance|repay|pare|reduce|deleverage|expand|acquire)|for (?:capex|expansion|working capital|debt (?:repayment|reduction)|general corporate)|repay(?:ment)? of (?:debt|borrowings)|debt reduction)/i,
  marketShare: /(market share (?:gain|gains|rise|rose|increase\w*|expan\w+|of \d|climb\w*|improv\w+)|(?:gains?|gained|wins?|won|captur\w+) (?:\d+(?:\.\d+)?\s?(?:%|pp|bps)\s)?market share|share gains?|share of (?:the )?market (?:rose|up|increas\w+))/i,
  regDemand: /(\bmandat(?:e|es|ed|ory)\b|\bphase[\s-]?out\b|emission norms|\bBIS (?:norms|certification|mandate)|blending (?:mandate|target)|\bPLI\b|production[\s-]linked incentive|new (?:regulations?|norms|rules|standards) (?:require|mandate|make)|safety (?:norms|standards|mandate)|policy (?:push|mandate)|compliance deadline)/i,
  pricingPower: /(pricing power|raised prices|raises? prices|implement\w* (?:a )?(?:price (?:hike|increase|rise)|price revision)|price (?:hike|increase|revision) (?:of|by) \d|passed on|pass[\s-]?through|price increases? (?:took|taken|effective|implemented))/i,
  pricingImplemented: /(implement\w*|effective|took effect|taken|raised prices|raises? prices|passed on)/i,
  marginWord: /(margin (?:expan\w+|improv\w+|inflection|up|gain\w*|widen\w*)|(?:gross|ebitda|operating) margins? (?:rose|rise|up|improved|expanded|widened|of \d)|\d+\s?bps (?:margin|expansion|improvement)|margin[s]? (?:by|of) \d+\s?bps|operating leverage|margin inflection)/i,
  fcfWord: /(free cash flow|\bFCF\b|cash conversion|operating cash flow|cash flow from operations|\bCFO\b|working capital (?:release|improv\w+|days|reduction)|net[\s-]debt[\s-]free|debt[\s-]free|deleverag\w+|cash generation)/i,
  businessExpansion: /\b(brands?|portfolio|categor(?:y|ies)|segments?|health|wellness|food|beverages?|D2C|consumer|foray|entry into|enters?|entering|verticals?|distribution|outlets|stores|range|product line|new market|footprint|scale up|scale its|expand\w*|growth business)\b/i,
  investIn: /\b(invest(?:s|ed|ing|ment)?|infus(?:e|es|ed|ion)|pump(?:s|ed)? in|commits?|earmarks?|allocates?)\b/i,
  dealMechanics: /\b(merger|amalgamation|scheme of arrangement|reverse merger|open offer|tender offer|delist\w*|go(?:ing)? private|demerg\w+|spin[\s-]?off|buy[\s-]?back|squeeze[\s-]?out|slump sale|stake sale|divest\w+)\b/i,
  aiExposure: /(\bAI\b.{0,30}(?:exposure|beneficiar\w+|play|tailwinds?|theme|optionality)|exposure to (?:the )?AI|AI[\s-]linked|AI[\s-]related)/i,
  wire: /\b(PTI|IANS|ANI|Reuters|Bloomberg|Press Trust of India|Asian News International|AFP|Dow Jones|with inputs from|via (?:PTI|IANS|ANI|Reuters))\b/i,
};

type SsSubtype = 'BUYBACK' | 'OPEN_OFFER' | 'SPIN' | 'MA' | 'RIGHTS' | 'ASSET_SALE' | 'RESTRUCTURING' | 'OTHER';
const SS_RE: Array<[SsSubtype, RegExp]> = [
  ['BUYBACK', /buy[\s-]?back|share repurchase|repurchase (?:of )?(?:shares|stock)/i],
  ['OPEN_OFFER', /open offer|mandatory offer|tender offer|takeover offer|delisting|delist\b|going private|take[\s-]?private|squeeze[\s-]?out|voluntary offer|tender(?:ing)? of shares|merger[\s-]?arb/i],
  ['SPIN', /spin[\s-]?off|demerg\w+|split(?:ting)? (?:into|the company)|carve[\s-]?out|hive[\s-]?off|separation of|separate listing/i],
  ['MA', /\bmerger|amalgamation|acqui(?:re|res|red|ring|sition)|takeover|take over|scheme of arrangement|reverse merger|stake acquisition/i],
  ['RIGHTS', /rights issue|rights entitlement/i],
  ['ASSET_SALE', /asset sale|sale of (?:business|division|unit|stake|undertaking|plant|land|assets?)|divest\w+|stake sale|sells? (?:its )?(?:stake|unit|division|business)|monetis\w+|slump sale/i],
  ['RESTRUCTURING', /restructur\w+|turnaround|resolution plan|\bNCLT\b|insolvency|\bIBC\b|one[\s-]?time settlement|recapitali[sz]ation/i],
];
const SS_LABEL: Record<SsSubtype, string> = {
  BUYBACK: 'buyback', OPEN_OFFER: 'open offer / tender / going-private', SPIN: 'spin-off / demerger', MA: 'merger / acquisition',
  RIGHTS: 'capital raise', ASSET_SALE: 'asset sale', RESTRUCTURING: 'restructuring', OTHER: 'corporate action',
};

function eventTypeSs(eventType: string | undefined, category: RadarCategory | undefined): SsSubtype | null {
  const et = (eventType || '').replace(/_/g, ' ');
  if (et) {
    for (const [k, re] of SS_RE) if (re.test(et)) return k;
    if (/tender|delist|going private|voluntary offer/i.test(et)) return 'OPEN_OFFER';
    if (/index (?:inclusion|exclusion)|bonus issue|promoter stake|holdco|governance crisis|nclt/i.test(et)) return /nclt/i.test(et) ? 'RESTRUCTURING' : 'OTHER';
  }
  if (category === 'SPIN') return 'SPIN';
  if (category === 'MA') return 'MA';
  if (category === 'TURN') return 'RESTRUCTURING';
  return null;
}

// ─────────────────────────── driver taxonomy ───────────────────────────

const DRIVER_RE: Array<[string, RegExp]> = [
  ['AI infrastructure', /\bAI\b|artificial intelligence|\bGPUs?\b|accelerators?|hyperscal\w+|\bLLMs?\b|generative|inference|training cluster/],
  ['Data centres', /data[\s-]?cent(?:er|re)s?|colocation|server farm/i],
  ['Grid / power', /\bgrid\b|transmission line|transformers?|substations?|switchgear|power (?:demand|infrastructure|equipment)|\bHVDC\b|electrification|utility capex|\bT&D\b/i],
  ['Cooling', /liquid cooling|\bcooling\b|\bHVAC\b|chillers?|thermal management/i],
  ['Electrical equipment', /electrical equipment|busbars?|\bUPS\b|gensets?|\bcables?\b|wires and cables/i],
  ['Defence', /defen[cs]e|military|missiles?|drones?|ordnance|ammunition|\bnavy\b|air force|armed forces|munitions?|\bradar\b|aerospace/i],
  ['Semiconductors', /semiconductors?|\bchips?\b|foundry|wafers?|\bfab\b|\bOSAT\b|\bHBM\b|photomask|lithography/i],
  ['Rare earth / critical minerals', /rare[\s-]earths?|neodymium|\bmagnets?\b|lithium|cobalt|gallium|germanium|graphite|critical minerals?|antimony|tungsten/i],
  ['Nuclear', /nuclear|uranium|\bSMRs?\b|enrichment|\bHALEU\b/i],
  ['Energy security', /energy security|\bLNG\b|crude oil|oil (?:&|and) gas|refiner(?:y|ies)|strategic reserves?|coal (?:supply|imports?)|pipeline/i],
  ['EV / battery', /electric vehicles?|\bEVs?\b|batter(?:y|ies)|cell manufacturing|gigafactory|charging (?:network|stations?)|\banode\b|\bcathode\b/i],
  ['Renewables', /\bsolar\b|\bwind (?:energy|power|turbines?)|renewables?|green hydrogen|\binverters?\b/i],
  ['Pharma / API', /pharma\w*|\bAPIs?\b|usfda|formulations?|\bCDMO\b|\bCRAMS\b|biosimilars?|generic drugs?|\bANDA\b/i],
  ['Railways / infrastructure', /railways?|\bmetro\b|highways?|infrastructure capex|wagons?|\brail\b/i],
  ['China+1 / import substitution', /china\s?\+\s?1|import substitution|localisation|localization|anti[\s-]?dumping/i],
];
const AI_UMBRELLA = ['AI infrastructure', 'Data centres', 'Grid / power', 'Cooling', 'Electrical equipment'];

export function driversOfText(text: string): string[] {
  const out: string[] = [];
  for (const [tag, re] of DRIVER_RE) if (re.test(text)) out.push(tag);
  return out;
}

// ─────────────────────────── duration parsing ───────────────────────────

const NUMW: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const numOf = (s: string) => (NUMW[s.toLowerCase()] ?? parseInt(s, 10));

interface Term { quarters: number; code: DurationCode; quote: string; words: string }

function precededByHistory(text: string, idx: number): boolean {
  return /\b(last|past|previous|prior|preceding)\s+$/i.test(text.slice(Math.max(0, idx - 12), idx));
}

export function parseDuration(text: string): Term | null {
  const cands: Term[] = [];
  let m: RegExpExecArray | null;
  const fy = /\bFY\s?'?(\d{2})\s?(?:-|–|to|through)\s?(?:FY)?\s?'?(\d{2})\b/gi;
  while ((m = fy.exec(text))) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (b > a && b - a <= 15) { const y = b - a + 1; cands.push({ quarters: y * 4, code: y >= 2 ? 4 : 3, quote: m[0], words: `about ${y} fiscal years` }); }
  }
  const yr = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)[\s-]*(?:years?|yrs?)\b(?!\s*(?:ago|old|on|over))/gi;
  while ((m = yr.exec(text))) {
    if (precededByHistory(text, m.index)) continue;
    const y = numOf(m[1]);
    if (!isNum(y) || y <= 0 || y > 40) continue;
    cands.push({ quarters: y * 4, code: y >= 2 ? 4 : 3, quote: m[0], words: `about ${y} year${y === 1 ? '' : 's'}` });
  }
  if ((m = /\bmulti[\s-]?year\b/i.exec(text))) cands.push({ quarters: 8, code: 4, quote: m[0], words: 'more than one year (multi-year)' });
  const qt = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight)[\s-]*quarters?\b/gi;
  while ((m = qt.exec(text))) {
    if (precededByHistory(text, m.index)) continue;
    const q = numOf(m[1]);
    if (!isNum(q) || q <= 0 || q > 40) continue;
    cands.push({ quarters: q, code: q <= 1 ? 1 : q <= 3 ? 2 : q <= 7 ? 3 : 4, quote: m[0], words: `${q} quarter${q === 1 ? '' : 's'}` });
  }
  const mo = /\b(\d{1,3})[\s-]*months?\b/gi;
  while ((m = mo.exec(text))) {
    if (precededByHistory(text, m.index)) continue;
    const mm = parseInt(m[1], 10);
    if (!(mm > 0)) continue;
    const q = Math.floor(mm / 3);
    cands.push({ quarters: q, code: q <= 1 ? 1 : q <= 3 ? 2 : q <= 7 ? 3 : 4, quote: m[0], words: `${mm} months` });
  }
  if ((m = /\bmulti[\s-]?quarter\b/i.exec(text))) cands.push({ quarters: 2, code: 2, quote: m[0], words: 'more than one quarter (multi-quarter)' });
  if ((m = /\blong[\s-]?term (?:contract|agreement|supply|offtake|off-take|order|partnership|programme|program)\b/i.exec(text))) cands.push({ quarters: 4, code: 3, quote: m[0], words: 'described as long-term, length not given' });
  if (cands.length) {
    cands.sort((a, b) => b.quarters - a.quarters || b.code - a.code);
    return cands[0];
  }
  if ((m = /\b(one[\s-]?time|one[\s-]?off|non[\s-]?recurring|exceptional (?:gain|item|income)|tax (?:benefit|credit|write[\s-]?back|refund)|(?:gain|profit) on (?:sale|disposal)|single order|pilot order|sample order|trial order)\b/i.exec(text))) {
    return { quarters: 0, code: 0, quote: m[0], words: 'a one-time item' };
  }
  return null;
}

// ─────────────────────────── source hierarchy ───────────────────────────

const RANK_NAME: Record<number, string> = {
  1: 'SEC / exchange filing', 2: 'Annual report', 3: 'Quarterly filing', 4: 'Earnings release', 5: 'Investor presentation',
  6: 'Company press release', 7: 'Customer announcement', 8: 'Government procurement', 9: 'Regulatory filing',
  10: 'Industry source', 11: 'Financial media', 12: 'Analyst note', 13: 'Social media',
};

function sourceRankOf(label: string | undefined, url: string | null | undefined, primary: boolean | undefined): { rank: number | null; label: string } {
  const l = (label || '').trim();
  const u = (url || '').toLowerCase();
  const t = l.toLowerCase();
  let rank: number | null = null;
  if (t) {
    if (/social|twitter|x\.com|reddit|stocktwits|telegram|whatsapp|discord|youtube|forum|tweet|blog|substack|influencer/.test(t)) rank = 13;
    else if (/analyst|broker|research note|brokerage|sell[\s-]side|initiation/.test(t)) rank = 12;
    else if (/annual report|10-?k\b|20-?f\b/.test(t)) rank = 2;
    else if (/10-?q\b|quarterly (?:filing|report)/.test(t)) rank = 3;
    else if (/earnings release|results? (?:release|press)|earnings press/.test(t)) rank = 4;
    else if (/investor presentation|investor deck|presentation/.test(t)) rank = 5;
    else if (/regulator|\bfda\b|usfda|cdsco|\brbi\b|\bsebi\b|ferc|cfius|nclt|regulatory/.test(t)) rank = 9;
    else if (/\bsec\b|edgar|8-?k\b|6-?k\b|exchange filing|\bnse\b|\bbse\b|regulation 30|reg\.? ?30|stock exchange|exchange announcement|\bfiling\b/.test(t)) rank = 1;
    else if (/company (?:press )?release|press release|company statement|company announcement|management|earnings call|concall|conference call/.test(t)) rank = /call|concall/.test(t) ? 5 : 6;
    else if (/customer/.test(t)) rank = 7;
    else if (/government|procurement|ministry|tender portal|\bgem\b|dod\b|contract award/.test(t)) rank = 8;
    else if (/industry|trade (?:press|body|publication)|association|\bsmm\b|platts|argus|trendforce/.test(t)) rank = 10;
    else if (/reuters|bloomberg|financial times|economic times|\bet\b|mint|business standard|moneycontrol|cnbc|wsj|news|media|press|times|journal/.test(t)) rank = 11;
  }
  if (rank == null && u) {
    if (/sec\.gov/.test(u)) rank = 1;
    else if (/nseindia\.com|bseindia\.com/.test(u)) rank = 1;
  }
  if (rank == null && primary === true) return { rank: 6, label: l || 'Primary source (type not stated)' };
  if (rank == null) return { rank: null, label: l || 'Source not stated' };
  return { rank, label: l || RANK_NAME[rank] };
}

// ─────────────────────────── governance ───────────────────────────

export function governanceOf(data?: RadarGovernanceInput | null): GovernanceRead {
  const d = data || {};
  const checked: string[] = [];
  const flags: string[] = [];
  const bool = (v: unknown, name: string, flag: string) => {
    if (v === true) { checked.push(name); flags.push(flag); } else if (v === false) checked.push(name);
  };
  bool(d.auditorIssue, 'auditor', 'Auditor issue reported');
  bool(d.qualifiedOpinion, 'audit opinion', 'Qualified audit opinion');
  if (isNum(d.promoterPledgePct)) {
    checked.push('promoter pledge');
    if (d.promoterPledgePct >= 50) flags.push(`Promoter pledging is high at ${fmt(d.promoterPledgePct)}%`);
    else if (d.promoterPledgePct >= 25) flags.push(`Promoter pledging is ${fmt(d.promoterPledgePct)}%`);
  }
  bool(d.relatedPartyConcern, 'related-party dealings', 'Related-party dealings raise concern');
  if (isNum(d.dilutionPct)) {
    checked.push('dilution');
    if (d.dilutionPct >= 10) flags.push(`Share count grew about ${fmt(d.dilutionPct)}% (dilution)`);
  } else bool(d.dilutionPct, 'dilution', 'Dilution flagged');
  if (isNum(d.debtToEquity)) {
    checked.push('debt');
    if (d.debtToEquity >= 1.5) flags.push(`Debt to equity is high at ${fmt(d.debtToEquity)}`);
  }
  if (isNum(d.interestCover)) {
    checked.push('interest cover');
    if (d.interestCover < 2) flags.push(`Interest cover is thin at ${fmt(d.interestCover)}x`);
  }
  bool(d.regulatoryIssue, 'regulatory record', 'Regulatory problem reported');
  bool(d.accountingRedFlag, 'accounting', 'Accounting red flag');
  if (checked.length === 0) {
    return { status: 'NOT_CHECKED', flags: [], note: 'Not checked - no governance data supplied. This is unknown, not clear.' };
  }
  if (flags.length) return { status: 'FLAGGED', flags, note: `${flags.length} governance flag${flags.length === 1 ? '' : 's'} to review before any higher priority.` };
  return { status: 'CLEAR', flags: [], note: `No flags on the checks supplied (${joinList(uniq(checked))}). Checks not supplied are not covered.` };
}

// ─────────────────────────── technical note (timing only) ───────────────────────────

function technicalNote(t?: RadarTechnicalInput | null): TechnicalContext {
  if (!t) return { note: null };
  const bits: string[] = [];
  const tr = t.trend != null && String(t.trend).trim() ? String(t.trend).trim().toLowerCase() : '';
  if (tr) bits.push(`trend is ${tr}`);
  if (t.relativeStrength != null && String(t.relativeStrength).trim() !== '' && !(typeof t.relativeStrength === 'number' && !Number.isFinite(t.relativeStrength))) bits.push(`relative strength reads ${String(t.relativeStrength).toLowerCase()}`);
  if (t.breakout === true) bits.push('a breakout is in place');
  else if (t.breakout === false) bits.push('no breakout yet');
  else if (typeof t.breakout === 'string' && t.breakout.trim()) bits.push(`breakout: ${t.breakout.trim().toLowerCase()}`);
  if (t.volumeConfirmation === true) bits.push('volume confirms');
  else if (t.volumeConfirmation === false) bits.push('volume does not confirm');
  else if (typeof t.volumeConfirmation === 'string' && t.volumeConfirmation.trim()) bits.push(`volume: ${t.volumeConfirmation.trim().toLowerCase()}`);
  if (!bits.length) return { note: null };
  return { note: `Timing only (answers WHEN, not WHY): ${joinList(bits)}. It does not change the priority or say why the business may change.` };
}

// ─────────────────────────── inflection ───────────────────────────

function inflectionOf(e: RadarEarnings | null | undefined): { state: InflectionState; note: string } {
  if (!e || !(isNum(e.revenueYoY) || isNum(e.marginNow) || isNum(e.marginPrior) || isNum(e.patYoY) || isNum(e.cfoToPat) ||
      (e.orderBook && e.orderBook !== 'NOT_STATED') || isNum(e.quarters) || (e.guidance && e.guidance !== 'NOT_STATED'))) {
    return { state: 'NOT_ASSESSED', note: 'No result data supplied, so this cannot be called a good quarter or a new earnings regime.' };
  }
  const revStrong = isNum(e.revenueYoY) && e.revenueYoY >= 15;
  const revAccel = isNum(e.revenueYoY) && isNum(e.revenuePrevYoY) && e.revenueYoY > e.revenuePrevYoY;
  const marginUp = isNum(e.marginNow) && isNum(e.marginPrior) && e.marginNow > e.marginPrior;
  const cashOk = isNum(e.cfoToPat) && e.cfoToPat >= 0.8;
  const orderUp = e.orderBook === 'UP';
  const raised = e.guidance === 'RAISED';
  const cut = e.guidance === 'CUT';
  const marginDown = isNum(e.marginNow) && isNum(e.marginPrior) && e.marginNow < e.marginPrior;
  const revDecl = isNum(e.revenueYoY) && e.revenueYoY < 0;
  const count = (revStrong ? 1 : 0) + (marginUp ? 1 : 0) + (cashOk || orderUp || raised ? 1 : 0);
  const q = isNum(e.quarters) ? e.quarters : 0;
  if (cut || (revDecl && marginDown) || e.orderBook === 'DOWN' && !revStrong && !marginUp) {
    return { state: 'NO_INFLECTION', note: 'Results do not show improvement: this is not a new earnings regime.' };
  }
  if (q >= 3 && count >= 2) return { state: 'STRUCTURAL_INFLECTION', note: `Supporting results run for ${fmt(q)} quarters: this reads as a new earnings regime, not a single good quarter.` };
  if (revAccel && marginUp && isNum(e.revenueYoY) && e.revenueYoY > 0) return { state: 'ACCELERATING_INFLECTION', note: 'Growth is stronger than the prior period and margin is up: this reads as a strengthening regime, but the run is short.' };
  if (count >= 3) return { state: 'CONFIRMED_INFLECTION', note: 'Several signals improve together (growth, margin, cash or orders): this reads as a new regime beginning, not just one good quarter.' };
  if (count >= 1 || revAccel) return { state: 'EARLY_INFLECTION', note: 'A good quarter so far: some signals improve, not yet enough to call a new regime.' };
  return { state: 'NO_INFLECTION', note: 'Results supplied show no clear improvement: this is not a new earnings regime.' };
}

// ─────────────────────────── main analysis ───────────────────────────

const EV_ORDER: Record<EvidenceStatus, number> = { CONFIRMED: 0, STRONG: 1, DEVELOPING: 2, HYPOTHESIS: 3, DISPROVED: 4 };
const P_NUM: Record<ResearchPriority, number> = { EXCLUDE: -1, LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 };
const P_FROM: ResearchPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
const STRUCTURAL_KINDS = new Set<CatalystKind>([
  'OPERATING_INFLECTION', 'DEMAND_EXPLOSION', 'BOTTLENECK', 'CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'NEW_PRODUCT_MARKET', 'SUPPLY_DEMAND_INFLECTION',
  'MARGIN_INFLECTION', 'FCF_INFLECTION', 'MARKET_SHARE_INFLECTION', 'REGULATORY_DEMAND_INFLECTION', 'PRICING_POWER_INFLECTION',
]);
/** Kinds that are quarantined: they never become a thesis candidate and never show an earnings link. */
const QUARANTINE_KINDS = new Set<CatalystKind>(['CORPORATE_ACTION', 'PRICE_MOVE', 'ANALYST_CHANGE', 'MEDIA_NARRATIVE', 'SECTOR_COMMENTARY', 'DISPROVED_RUMOUR']);
const NON_OPERATING_CLASSES = new Set<EventClass>(['CAPITAL_STRUCTURE_FUNDING', 'REGULATORY_LEGAL', 'CORPORATE_ACTION', 'DISPROVED_RUMOUR', 'PRICE_RESPONSE', 'ANALYST', 'NARRATIVE', 'SECTOR_COMMENTARY', 'TECHNICAL']);
const LINK_ORDER: Record<LinkStrength, number> = { DIRECT: 4, NEAR_DIRECT: 3, INDIRECT: 2, NARRATIVE_ONLY: 1, NOT_ESTABLISHED: 0 };
const PROGRESSION: Record<CatalystMaturity, number> = { BROKEN: 0, DISCOVERY: 1, VALIDATED: 2, DEVELOPING: 3, FINANCIALLY_VISIBLE: 4, CONFIRMED: 5, ACCELERATING: 6, MATURE: 7 };
const MAT_NUM: Record<Materiality, number> = { UNKNOWN: -1, LOW: 0, MODERATE: 1, HIGH: 2, VERY_HIGH: 3 };
const LINK_STATUS_NUM: Record<LinkStatus, number> = { CONTRADICTED: -1, NOT_APPLICABLE: 0, ASSUMED: 1, PARTIALLY_PROVEN: 2, PROVEN: 3 };

const CHAIN_NAMES = [
  'Catalyst', 'Customer / market driver', 'Bottleneck', 'Company advantage', 'Capacity / volume', 'Revenue', 'Margin',
  'Free cash flow', 'Earnings', 'Valuation / expectations', 'Potential multi-year re-rating',
];
const LINK_KEYS: CatalystLinkKey[] = ['EVENT', 'DRIVER', 'BOTTLENECK', 'COMPANY_ADVANTAGE', 'CAPACITY', 'VOLUME', 'REVENUE', 'MARGIN', 'EBITDA', 'FCF', 'EARNINGS', 'EXPECTATIONS', 'VALUATION'];
const LINK_WORD: Record<CatalystLinkKey, string> = {
  EVENT: 'event', DRIVER: 'customer / market driver', BOTTLENECK: 'bottleneck', COMPANY_ADVANTAGE: 'company advantage', CAPACITY: 'capacity', VOLUME: 'volume',
  REVENUE: 'revenue', MARGIN: 'margin', EBITDA: 'EBITDA', FCF: 'free cash flow', EARNINGS: 'earnings', EXPECTATIONS: 'expectations', VALUATION: 'valuation',
};

/** Drops a share-price clause ("stock jumps 8%") from a quote so a price variable never sits in a fundamental chain link. */
function noPriceClause(t: string): string {
  return (t || '').replace(/[;,]?\s*[^;,.]*\b(?:stock|shares?|scrip|price)\b[^;,.]*\d+(?:\.\d+)?\s?%[^;,.]*/gi, '').replace(/[;,]?\s*[^;,.]*\d+(?:\.\d+)?\s?%[^;,.]*\b(?:stock|shares?|scrip|price)\b[^;,.]*/gi, '').trim() || 'Price move only; no operating event stated';
}

function matchQuote(re: RegExp, text: string): string | null {
  const m = re.exec(text);
  return m ? squash(m[0]) : null;
}

// ─────────────────────────── price split (price is never a fundamental) ───────────────────────────

const STOCK_WORD = /\b(?:shares?|stocks?|scrip|counter|share price|stock price)\b/i;
const FUND_NOUN = /\b(?:revenue|profit|pat|orders?|margins?|sales|ebitda|contracts?|capacity|volumes?|growth|dividend|earnings|backlog|price hike|realisations?)\b/i;
const DOWN_WORD = /\b(?:down|lower|slump\w*|tumbl\w+|plung\w+|fall\w*|fell|drop\w*|slid\w*|sink\w*|sank|lose[sd]?|lost|decline[sd]?|dip(?:s|ped)?|crash\w*)\b/i;
const UP_WORD = /\b(?:up|higher|surg\w+|jump\w*|rall\w+|soar\w*|spik\w+|gain\w*|climb\w*|ris(?:e|es|ing)|rose|zoom\w*|skyrocket\w*|advance[sd]?|rebound\w*|lift\w*|boost\w*|pop\w*)\b/i;

export interface PriceSplit { clean: string; response: PriceResponse | null }

/**
 * Separates share-price reaction from company facts. Every percent or amount that describes the share price, a trading
 * volume, a dividend, an issue price or a count of securities is removed from `clean`, so it can never feed a financial field.
 */
export function splitPrice(text: string): PriceSplit {
  let clean = text;
  const hits: Array<{ snippet: string; pct: number | null; dir: 'UP' | 'DOWN' | null }> = [];
  const pctRe = /([+\-−]?)\s?(\d+(?:\.\d+)?)\s?(?:%|per ?cent)/gi;
  let m: RegExpExecArray | null;
  let prevEnd = 0;
  const spans: Array<[number, number]> = [];
  while ((m = pctRe.exec(text))) {
    const start = m.index, end = start + m[0].length;
    const before = text.slice(Math.max(prevEnd, start - 45), start);
    const clause = before.split(/[.;!?]/).pop() || '';
    const after = text.slice(end, end + 32);
    const sm = STOCK_WORD.exec(clause);
    let isPrice = false;
    let seg = clause;
    let viaStock = false;
    if (sm) {
      seg = clause.slice(sm.index);
      isPrice = !FUND_NOUN.test(seg);
      viaStock = isPrice;
    }
    const trailing = /^\s*(?:jump|surge|rally|gain|rise|spike|pop|gap[\s-]?up|upside|rebound)\b.{0,28}\b(?:shares?|stock|scrip|counter)\b/i.test(after);
    if (!isPrice && trailing) { isPrice = true; seg = text.slice(start, end + 32); }
    if (!isPrice && /^\s*(?:upper circuit|lower circuit)\b/i.test(after)) isPrice = true;
    prevEnd = end;
    if (!isPrice) continue;
    const downSign = m[1] === '-' || m[1] === '−';
    const val = parseFloat(m[2]);
    const dir: 'UP' | 'DOWN' | null = downSign || DOWN_WORD.test(seg) ? 'DOWN' : (m[1] === '+' || UP_WORD.test(seg) || trailing ? 'UP' : null);
    const pct = isNum(val) ? (dir === 'DOWN' ? -Math.abs(val) : val) : null;
    const snippet = viaStock && sm ? squash(text.slice(start - clause.length + sm.index, end)) : squash(text.slice(start, end) + ' ' + after.split(/[.;!?]/)[0]);
    hits.push({ snippet: snippet || squash(m[0]), pct, dir });
    spans.push([start, end]);
  }
  for (const [a, b] of spans.slice().reverse()) clean = clean.slice(0, a) + ' ' + clean.slice(b);

  // share-price levels, trading volume, dividends, issue prices, securities counts
  const drop = [
    /\b(?:target price|price target|share price|stock price|CMP|trading at|closed at|ended at|quoted at|issue price|offer price|floor price|conversion price|exercise price|allotment price|allot\w* price|face value)\b\s*(?:of|at|:)?\s*(?:₹|rs\.?|inr|us\$|\$)?\s?\d[\d,.]*(?:\s?(?:per share|per warrant|each))?/gi,
    /(?:₹|rs\.?|inr|us\$|\$)\s?\d[\d,.]*\s?(?:per|a|each|\/)\s?(?:equity share|share|warrant|unit|security|debenture)\b/gi,
    /\bat\s+(?:a\s+)?(?:price|premium|discount)\s+of\s+(?:₹|rs\.?|inr|us\$|\$)?\s?\d[\d,.]*/gi,
    /\b(?:trading|traded|share|stock|delivery)\s+volumes?\b[^.;]{0,30}?\d[\d,.]*\s?(?:x|times|%|million|lakh|crore|mn|k)?(?:\s+shares)?/gi,
    /\b\d[\d,.]*\s?(?:million|lakh|crore|mn|k)?\s+shares\s+(?:traded|changed hands)\b/gi,
    /\b(?:interim |final |special |annual |quarterly )?dividends?\b(?:\s+(?:of|at|payout))?\s*(?:₹|rs\.?|inr|us\$|\$)?\s?\d[\d,.]*(?:\s?(?:per share|%|per cent|crore|cr))?/gi,
    /\b\d[\d,.]*\s?(?:%|per ?cent)\s*(?:interim |final |special )?dividend\b/gi,
    /\b\d[\d,.]*\s?(?:crores?|cr|lakhs?|million|mn|billion|bn)?\s+(?:(?:fully[\s-]?convertible |convertible |equity |preference |compulsorily convertible )*(?:warrants?|shares?|debentures?|units|securities|bonds?))\b/gi,
    /\b\d+\s?:\s?\d+\b/g,
  ];
  for (const re of drop) clean = clean.replace(re, ' ');
  clean = squash(clean);

  let response: PriceResponse | null = null;
  if (hits.length) {
    const h = hits[0];
    const dirWord = h.dir === 'UP' ? 'up' : h.dir === 'DOWN' ? 'down' : 'moved';
    response = { text: clip(h.snippet, 120), pct: h.pct, direction: h.dir, note: `Share-price reaction (${dirWord}${h.pct != null ? ` ${fmt(Math.abs(h.pct))}%` : ''}). It is timing context only and is not evidence about revenue, margin or earnings.` };
  } else if (RE.priceMove.test(text)) {
    const mm = RE.priceMove.exec(text);
    const snippet = mm ? squash(mm[0]) : 'share-price move';
    const dir: 'UP' | 'DOWN' | null = DOWN_WORD.test(snippet) ? 'DOWN' : UP_WORD.test(snippet) ? 'UP' : null;
    response = { text: clip(snippet, 120), pct: null, direction: dir, note: 'Share-price reaction. It is timing context only and is not evidence about revenue, margin or earnings.' };
  }
  return { clean, response };
}

// ─────────────────────────── amounts and materiality ───────────────────────────

interface Amount { raw: string; millions: number; currency: string | null }

function parseAmounts(clean: string): Amount[] {
  const out: Amount[] = [];
  const found = clean.match(RE.amount) || [];
  for (const raw0 of found) {
    const raw = squash(raw0);
    const m = /^(₹|rs\.?|inr|us\$|\$|usd|eur|€|£)?\s?(\d[\d,]*(?:\.\d+)?)\s?(crores?|cr|lakhs?|million|mn|billion|bn|m|b|k)?$/i.exec(raw);
    if (!m) continue;
    const num = parseFloat(m[2].replace(/,/g, ''));
    if (!isNum(num)) continue;
    const unit = (m[3] || '').toLowerCase();
    const mult = /^crore|^cr$/.test(unit) ? 10 : /^lakh/.test(unit) ? 0.1 : /^(million|mn|m)$/.test(unit) ? 1 : /^(billion|bn|b)$/.test(unit) ? 1000 : unit === 'k' ? 0.001 : 0.000001;
    const sym = (m[1] || '').toLowerCase();
    const cur = /^(₹|rs\.?|inr)$/.test(sym) ? 'INR' : /^(us\$|\$|usd)$/.test(sym) ? 'USD' : /^(eur|€)$/.test(sym) ? 'EUR' : sym === '£' ? 'GBP' : (/^crore|^cr$|^lakh/.test(unit) ? 'INR' : null);
    out.push({ raw, millions: num * mult, currency: cur });
  }
  return out;
}

const CTX_UNIT: Record<string, number> = { CRORE: 10, MILLION: 1, BILLION: 1000 };

function materialityOf(args: { amounts: Amount[]; capitalEvent: boolean; termQuarters: number | null; ctx?: RadarCompanyContext | null }): { level: Materiality; note: string; ratioText: string | null; base: string | null } {
  const { amounts, capitalEvent, termQuarters, ctx } = args;
  if (!ctx) return { level: 'UNKNOWN', note: 'Materiality unknown: no company size (revenue, EBITDA, profit or market cap) was supplied. It is never judged on the absolute amount alone.', ratioText: null, base: null };
  const mult = CTX_UNIT[ctx.unit || 'MILLION'] ?? 1;
  const cur = (ctx.currency || '').toUpperCase() || null;
  const conv = (v: number | null | undefined) => (isNum(v) && v > 0 ? v * mult : null);
  const bases: Array<[string, number | null, [number, number, number]]> = capitalEvent
    ? [['market cap', conv(ctx.marketCap), [15, 5, 1.5]], ['revenue', conv(ctx.revenue), [25, 8, 2]], ['EBITDA', conv(ctx.ebitda), [60, 20, 5]], ['profit', conv(ctx.pat), [80, 25, 6]]]
    : [['revenue', conv(ctx.revenue), [25, 8, 2]], ['EBITDA', conv(ctx.ebitda), [60, 20, 5]], ['profit', conv(ctx.pat), [80, 25, 6]], ['market cap', conv(ctx.marketCap), [15, 5, 1.5]]];
  const usable = amounts.filter((a) => a.millions >= 0.01 && (!cur || !a.currency || a.currency === cur));
  if (!usable.length) return { level: 'UNKNOWN', note: amounts.length && cur ? 'Materiality unknown: the amount is in a different currency from the company context, and no conversion is assumed.' : 'Materiality unknown: the source states no amount to compare with the size of the company.', ratioText: null, base: null };
  const top = usable.reduce((a, b) => (b.millions > a.millions ? b : a));
  const years = !capitalEvent && termQuarters != null && termQuarters >= 4 ? termQuarters / 4 : 1;
  const annual = top.millions / years;
  for (const [name, val, th] of bases) {
    if (val == null) continue;
    const pct = (annual / val) * 100;
    const level: Materiality = pct >= th[0] ? 'VERY_HIGH' : pct >= th[1] ? 'HIGH' : pct >= th[2] ? 'MODERATE' : 'LOW';
    const pctText = pct >= 10 ? fmt(Math.round(pct)) : fmt(Math.round(pct * 10) / 10);
    const ratioText = `${pctText}% of annual ${name}${years > 1 ? ` (spread over about ${fmt(Math.round(years * 10) / 10)} years)` : ''}`;
    return { level, note: `${cap1(top.raw)} is about ${ratioText}.`, ratioText, base: name };
  }
  return { level: 'UNKNOWN', note: 'Materiality unknown: the company context has no usable revenue, EBITDA, profit or market cap.', ratioText: null, base: null };
}

// ─────────────────────────── sources: dedupe, quality, diversity ───────────────────────────

export interface SourceRead { rank: number | null; label: string; count: number; distinct: number; duplicates: number; diversity: SourceDiversity[]; quality: SourceQuality; hasPrimary: boolean }

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'by', 'at', 'as', 'with', 'from', 'its', 'is', 'says', 'said', 'announces', 'announced']);
function tokensOf(title: string | undefined): Set<string> {
  const t = (title || '').toLowerCase().replace(/\s[-|–—]\s[^-|–—]{2,40}$/, '').replace(/[^a-z0-9₹$%\s]/g, ' ');
  return new Set(t.split(/\s+/).filter((w) => w && !STOP.has(w)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter += 1; });
  return inter / (a.size + b.size - inter);
}
function domainOf(url: string | null | undefined): string {
  const m = /^(?:https?:\/\/)?(?:www\.)?([^\/?#]+)/i.exec((url || '').trim());
  return m ? m[1].toLowerCase() : '';
}
function diversityOf(rank: number | null): SourceDiversity | null {
  if (rank == null) return null;
  if (rank <= 3) return 'PRIMARY';
  if (rank <= 6) return 'COMPANY';
  if (rank === 7) return 'CUSTOMER';
  if (rank <= 9) return 'GOVERNMENT';
  if (rank === 10) return 'INDEPENDENT_INDUSTRY';
  if (rank === 11) return 'FINANCIAL_MEDIA';
  if (rank === 12) return 'ANALYST';
  return 'SOCIAL';
}
function qualityOf(rank: number | null): SourceQuality {
  if (rank == null) return 'UNKNOWN';
  if (rank <= 3) return 'PRIMARY';
  if (rank <= 9) return 'HIGH';
  if (rank === 10) return 'MEDIUM';
  return 'LOW';
}

export function readSources(input: Pick<RadarInput, 'sourceLabel' | 'url' | 'primarySource' | 'title' | 'publishedAt' | 'sources' | 'independentSources'>): SourceRead {
  const own = { label: input.sourceLabel, url: input.url, title: input.title, primary: input.primarySource, publishedAt: input.publishedAt } as RadarSourceInput;
  const hasList = Array.isArray(input.sources) && input.sources.length > 0;
  // the event's own headline is usually also the first entry of the list: it is one source, not a duplicate of itself
  const normT = (t?: string) => squash(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const listHasOwn = hasList && input.sources!.some((x) => (!!x.url && !!own.url && x.url === own.url) || (!!x.title && !!own.title && normT(x.title) === normT(own.title) && squash(x.label || '') === squash(own.label || '')));
  const entries: RadarSourceInput[] = listHasOwn ? input.sources!.slice() : [own, ...(hasList ? input.sources! : [])];
  const ranked = entries.map((e) => ({ e, r: sourceRankOf(e.label, e.url, e.primary), toks: tokensOf(e.title), dom: domainOf(e.url), wire: RE.wire.test(`${e.title || ''} ${e.label || ''}`) }));
  // best source overall
  let best = ranked[0].r;
  for (const x of ranked) if (x.r.rank != null && (best.rank == null || x.r.rank < best.rank)) best = x.r;
  // the plain own entry alone keeps the legacy behaviour (one source, or the supplied independent count)
  if (!hasList) {
    const n = isNum(input.independentSources) && input.independentSources >= 1 ? Math.floor(input.independentSources) : 1;
    const dv = diversityOf(best.rank);
    return { rank: best.rank, label: best.label, count: n, distinct: n, duplicates: 0, diversity: dv ? [dv] : [], quality: qualityOf(best.rank), hasPrimary: best.rank != null && best.rank <= 9 };
  }
  // cluster: same outlet, near-identical title, or the same wire story
  const clusters: Array<{ idx: number[] }> = [];
  ranked.forEach((x, i) => {
    let placed = false;
    for (const c of clusters) {
      const same = c.idx.some((j) => {
        const y = ranked[j];
        const jac = jaccard(x.toks, y.toks);
        return (x.dom && x.dom === y.dom) || jac >= 0.7 || ((x.wire || y.wire) && jac >= 0.4) || (!x.dom && !y.dom && !!x.r.label && x.r.label === y.r.label && jac >= 0.5);
      });
      if (same) { c.idx.push(i); placed = true; break; }
    }
    if (!placed) clusters.push({ idx: [i] });
  });
  const cats: SourceDiversity[] = [];
  let hasPrimary = false;
  for (const c of clusters) {
    let cr: number | null = null;
    for (const j of c.idx) { const r = ranked[j].r.rank; if (r != null && (cr == null || r < cr)) cr = r; }
    const dv = diversityOf(cr);
    if (dv && !cats.includes(dv)) cats.push(dv);
    if (cr != null && cr <= 9) hasPrimary = true;
  }
  const dups = ranked.length - clusters.length;
  if (dups > 0 && ranked.some((x) => x.wire) && !cats.includes('SYNDICATED')) cats.push('SYNDICATED');
  return { rank: best.rank, label: best.label, count: ranked.length, distinct: clusters.length, duplicates: dups, diversity: cats, quality: qualityOf(best.rank), hasPrimary };
}

// ─────────────────────────── duration helpers ───────────────────────────

function halfLifeOf(code: DurationCode | null): HalfLife | null {
  if (code == null) return null;
  return code <= 1 ? 'SHORT' : code === 2 ? 'MEDIUM' : code === 3 ? 'LONG' : code === 4 ? 'STRUCTURAL' : 'TRANSFORMATIONAL';
}

// ─────────────────────────── indicators ───────────────────────────

const LEADING_RE: Array<[RegExp, string]> = [
  [/qualif\w+|approved (?:supplier|vendor)/i, 'customer qualification'], [/design[\s-]?wins?/i, 'design win'], [/nominat\w+/i, 'supplier nomination'],
  [/capacity (?:booking|reservation)|(?:booked|reserved) capacity/i, 'capacity booking'], [/long[\s-]term (?:contract|supply|agreement|offtake|off-take)|take[\s-]or[\s-]pay|off-?take/i, 'long-term contract'],
  [/order (?:inflow|intake|book|backlog)|backlog|record orders?|orders? (?:worth|received|booked)|wins? (?:an? )?(?:\S+ ){0,3}orders?|\border\b.{0,30}\bworth/i, 'order intake / backlog'],
  [/procurement|awarded|letter of award|\bLoA\b|\bL1\b/i, 'procurement award'], [/groundbreaking|foundation stone|factory construction|construction of (?:a |the )?(?:new )?(?:plant|factory|facility)|new (?:plant|factory|facility)/i, 'factory construction'],
  [/equipment orders?|orders? for (?:equipment|machinery|tools)/i, 'equipment orders'], [/\bhiring|recruit\w+|headcount/i, 'hiring'], [/customer capex|customers? (?:are )?(?:investing|expanding)/i, 'customer capex'],
  [/regulatory approval|usfda|fda approval|cdsco|approval/i, 'regulatory approval'], [/price (?:hike|increase|rise)|prices? (?:rise|rising|rose)|lead[\s-]?times?/i, 'pricing / lead-time change'],
  [/\bcapex\b|capacity (?:expansion|addition)/i, 'capacity build-out'],
];
export function indicatorOf(text: string, kind: CatalystKind, quarantine: boolean): { type: IndicatorType | null; label: string } {
  if (quarantine) return { type: null, label: 'Not an operating indicator' };
  if (kind === 'EARNINGS_RESULT') return { type: 'LAGGING', label: 'reported revenue / earnings' };
  for (const [re, label] of LEADING_RE) if (re.test(text)) return { type: 'LEADING', label };
  if (/utili[sz]ation|running at \d+\s?%|operating at \d+\s?%/i.test(text)) return { type: 'INTERMEDIATE', label: 'utilisation' };
  if (/\b(?:revenue|sales|EPS|PAT|net profit|EBITDA|margin)\b/i.test(text)) return { type: 'LAGGING', label: 'revenue / profit / margin' };
  return { type: null, label: 'Not classified' };
}

// ─────────────────────────── snapshot and evidence delta ───────────────────────────

export function snapshotOf(item: RadarItem): RadarSnapshot {
  const ls: Partial<Record<CatalystLinkKey, LinkStatus>> = {};
  for (const l of item.catalystChain || []) ls[l.link] = l.status;
  const fin = (item.catalystChain || []).some((l) => (l.link === 'REVENUE' || l.link === 'EARNINGS') && l.status === 'PROVEN');
  const commercial = (item.catalystChain || []).some((l) => (l.link === 'VOLUME' || l.link === 'REVENUE') && (l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN')) || (item.evidence.status === 'CONFIRMED' && (item.kind === 'CONTRACT_ORDER' || item.kind === 'CUSTOMER_QUALIFICATION') && item.link === 'DIRECT');
  return {
    evidenceStatus: item.evidence.status, catalystProgression: item.catalystProgression, catalystMaturity: item.catalystMaturity ?? null, linkStatus: ls,
    sourceCount: item.evidence.independentSources, primaryConfirmed: item.evidence.sourceQuality === 'PRIMARY' || item.evidence.sourceQuality === 'HIGH', commercialConfirmed: commercial,
    financiallyVisible: fin, firstDiscovered: item.firstDiscovered ?? null, firstPrimaryConfirmation: item.firstPrimaryConfirmation ?? null,
    firstFinancialConfirmation: item.firstFinancialConfirmation ?? null, firstMaterialEarningsImpact: item.firstMaterialEarningsImpact ?? null,
  };
}

export function evidenceDeltaOf(args: {
  prev: RadarSnapshot | null | undefined; evidence: EvidenceStatus; chain: CatalystLink[]; resolved: boolean;
  primaryConfirmed: boolean; commercialConfirmed: boolean; financiallyVisible: boolean; sourceCount: number;
}): EvidenceDelta {
  const { prev, evidence, chain, resolved } = args;
  if (!prev) return 'NEW_EVIDENCE';
  const contradicted = evidence === 'DISPROVED' || chain.some((l) => l.status === 'CONTRADICTED');
  if (contradicted && prev.evidenceStatus !== 'DISPROVED') return 'CONTRADICTED';
  if (resolved) return 'RESOLVED';
  if (args.financiallyVisible && !prev.financiallyVisible) return 'FIRST_FINANCIAL_CONFIRMATION';
  if (args.commercialConfirmed && !prev.commercialConfirmed) return 'FIRST_COMMERCIAL_CONFIRMATION';
  const evNow = EV_ORDER[evidence];
  const evPrev = prev.evidenceStatus != null ? EV_ORDER[prev.evidenceStatus] : null;
  const score = (st: Partial<Record<CatalystLinkKey, LinkStatus>> | undefined) => Object.values(st || {}).reduce((a, v) => a + (v ? LINK_STATUS_NUM[v] : 0), 0);
  const nowSt: Partial<Record<CatalystLinkKey, LinkStatus>> = {};
  chain.forEach((l) => { nowSt[l.link] = l.status; });
  const dLinks = score(nowSt) - score(prev.linkStatus);
  if (evPrev != null && evNow < evPrev) return 'STRENGTHENED';
  if (evPrev != null && evNow > evPrev) return 'WEAKENED';
  if (prev.linkStatus && Object.keys(prev.linkStatus).length) {
    if (dLinks > 0) return 'STRENGTHENED';
    if (dLinks < 0) return 'WEAKENED';
  }
  if (args.sourceCount > (prev.sourceCount ?? 0)) return 'DEVELOPING';
  return 'UNCHANGED';
}

// ─────────────────────────── thesis integrity ───────────────────────────

/**
 * Runs the integrity checks on a finished item. Pure: the same item always gives the same answer, so a caller (or a test)
 * can also run it on an edited or externally built item.
 */
export function thesisIntegrityOf(item: RadarItem): ThesisIntegrity {
  const fails: Array<{ code: IntegrityCode; why: string }> = [];
  const f = (code: IntegrityCode, why: string) => fails.push({ code, why });
  const quarantine = QUARANTINE_KINDS.has(item.kind) || item.bucket === 'NOISE' || item.bucket === 'TECHNICAL' || item.bucket === 'CORPORATE_ACTION';
  const cls = item.eventClass;
  // 1 price used as earnings evidence
  const pr = item.priceResponse;
  if (pr) {
    const tokens = [pr.text, pr.pct != null ? `${fmt(Math.abs(pr.pct))}%` : ''].filter(Boolean);
    const fundamental = [item.financialImpact, ...(item.impacts ? Object.values(item.impacts) : []), ...(item.changes || [])].join(' | ');
    for (const t of tokens) if (t.length >= 2 && fundamental.includes(t)) { f('PRICE_USED_AS_EARNINGS_EVIDENCE', `The share-price reaction "${clip(t, 40)}" appears in a fundamental-impact field.`); break; }
  }
  // 3 kind mismatched to event
  if (cls && NON_OPERATING_CLASSES.has(cls) && (STRUCTURAL_KINDS.has(item.kind) || item.kind === 'EARNINGS_RESULT' || item.kind === 'CONTRACT_ORDER')) f('KIND_MISMATCHED_TO_EVENT', `The event reads as ${cls.toLowerCase().replace(/_/g, ' ')} but is labelled ${KIND_LABEL[item.kind].toLowerCase()}.`);
  // 4 link contradicts mechanism
  const linkGood = item.link === 'DIRECT' || item.link === 'NEAR_DIRECT';
  if (linkGood && ((cls && NON_OPERATING_CLASSES.has(cls)) || QUARANTINE_KINDS.has(item.kind) || item.kind === 'CAPITAL_RAISE' || item.kind === 'FINANCING' || item.kind === 'REGULATORY_DECISION' || item.kind === 'LEGAL_DECISION')) f('LINK_CONTRADICTS_MECHANISM', `A ${item.link.toLowerCase().replace('_', '-')} earnings link is shown for an event whose own mechanism does not change earnings.`);
  // 2 duration inferred without disclosure
  const d = item.duration;
  if (d.code != null && d.inferred === true && d.duration_source !== 'historical-inference' && d.duration_source !== 'structural-inference') f('DURATION_INFERRED_WITHOUT_DISCLOSURE', 'A duration is shown but no source states it.');
  if (d.code != null && d.basis === 'type') f('DURATION_INFERRED_WITHOUT_DISCLOSURE', 'A duration was taken from the type of event alone.');
  // 5 media only while a primary source exists
  const ev = item.evidence;
  if ((ev.sourceQuality === 'LOW') && (ev.sourceDiversity || []).some((x) => x === 'PRIMARY' || x === 'COMPANY')) f('MEDIA_ONLY_WHEN_PRIMARY_EXISTS', 'The evidence is rated from media although a primary source is among the sources.');
  // 6 source count mistaken for independence
  if (ev.sourceCount != null && ev.sourceCount > ev.independentSources && ev.status === 'STRONG' && ev.independentSources < 2) f('SOURCE_COUNT_MISTAKEN_FOR_INDEPENDENCE', 'Several copies of one report were counted as independent sources.');
  if (ev.status === 'CONFIRMED' && ev.sourceQuality === 'LOW') f('SOURCE_COUNT_MISTAKEN_FOR_INDEPENDENCE', 'Media-only evidence is shown as confirmed.');
  // 11 event confirmation confused with thesis confirmation
  if (item.confirmationLabel && /^Confirmed earnings catalyst/i.test(item.confirmationLabel) && item.earningsImpactStatus !== 'CONFIRMED') f('EVENT_CONFIRMATION_CONFUSED_WITH_THESIS', 'The label says the earnings catalyst is confirmed but earnings transmission is not proven.');
  if (!quarantine) {
    if (item.mechanismSpecific === false) f('NO_COMPANY_SPECIFIC_MECHANISM', 'The text does not support a company-specific mechanism.');
    if (!item.proof || !item.proof.what || /^monitor\b/i.test(item.proof.what)) f('NO_NEXT_PROOF', 'There is no specific next proof point.');
    if (!item.breakConditions || item.breakConditions.length === 0) f('NO_BREAK_CONDITION', 'No break condition is stated.');
    if (item.catalystMateriality === 'UNKNOWN' && item.priority === 'VERY_HIGH') f('MATERIALITY_UNKNOWN_SHOWN_HIGH', 'Materiality is unknown, so the priority cannot read very high.');
  }
  const reject = fails.some((x) => x.code === 'PRICE_USED_AS_EARNINGS_EVIDENCE' || x.code === 'LINK_CONTRADICTS_MECHANISM' || x.code === 'KIND_MISMATCHED_TO_EVENT');
  return { passed: fails.length === 0, failedChecks: fails, action: fails.length === 0 ? 'NONE' : reject ? 'REJECTED' : 'DOWNGRADED' };
}

const EARN_NOUN_BEFORE = /\b(?:revenues?|sales|turnover|profits?|pat|ebitda|margins?|income|earnings|order book|orderbook|backlog)\b[^.;%]{0,18}$/i;
/**
 * Removes price, dividend-per-share, stake and similar spans the adapter flagged, so they never reach earnings evidence.
 * A plain percent that directly follows an earnings word ("profit up 23%") is an earnings fact and is kept.
 */
export function stripNonEarnings(text: string, spans: ReadonlyArray<string> | undefined): string {
  if (!spans || !spans.length) return text;
  let out = text;
  for (const raw of spans) {
    const sp = squash(raw);
    if (!sp) continue;
    const pureCount = /^\d[\d,]*(?:\.\d+)?\s?%$/.test(sp);
    const re = new RegExp(sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'gi');
    out = out.replace(re, (m, off: number, whole: string) => (pureCount && EARN_NOUN_BEFORE.test(whole.slice(Math.max(0, off - 40), off)) ? m : ' '));
  }
  return squash(out);
}

/** Why an item is kept out of every thesis bucket, from the adapter's hints. Order: the most specific reason first. */
interface Quarantine { reason: QuarantineReason; kind: CatalystKind; cls: EventClass; noise: string; fp: FalsePositiveReason; proof: string }
function quarantineOf(input: RadarInput): Quarantine | null {
  if (input.isRegistration) return { reason: 'REGISTRATION', kind: 'OTHER', cls: 'UNCLASSIFIED', noise: 'Registration (Form 10) — not a spin-off', fp: 'WRONG_CLASSIFICATION', proof: 'A separate filing that names a real separation or an operating effect; a registration of securities is neither.' };
  if (input.isNonCorporate) return { reason: 'NON_CORPORATE', kind: 'OTHER', cls: 'UNCLASSIFIED', noise: 'government or union news, not a company event', fp: 'NARRATIVE_ONLY', proof: 'Nothing to prove: this is not a company event.' };
  if (input.isAnalystTarget) return { reason: 'ANALYST_TARGET', kind: 'ANALYST_CHANGE', cls: 'ANALYST', noise: 'analyst rating or price-level change', fp: 'NARRATIVE_ONLY', proof: 'A company filing or result that states a revenue, order or margin effect; a broker view is not one.' };
  if (input.isPreview) return { reason: 'PREVIEW', kind: 'OTHER', cls: 'UNCLASSIFIED', noise: 'a results preview: the result is not out yet, so no earnings fact exists', fp: 'INSUFFICIENT_EVIDENCE', proof: 'The reported results themselves, once the company publishes them.' };
  if (input.isPriceArticle) return { reason: 'PRICE_ARTICLE', kind: 'PRICE_MOVE', cls: 'PRICE_RESPONSE', noise: 'a share-price move', fp: 'PRICE_ONLY', proof: 'A company filing or result that states a revenue, order or margin effect; the price move is not one.' };
  if (input.isOpinion) return { reason: 'OPINION', kind: 'MEDIA_NARRATIVE', cls: 'NARRATIVE', noise: 'an opinion or question headline with no stated event', fp: 'NARRATIVE_ONLY', proof: 'A company filing or result that states the event itself.' };
  if (!input.ticker && squash(input.company || '').toLowerCase() === NOT_IDENTIFIED.toLowerCase() && input.primarySource !== true && input.tickerResolved !== true) {
    return { reason: 'UNIDENTIFIED', kind: 'OTHER', cls: 'UNCLASSIFIED', noise: 'no company is identified in the source', fp: 'INSUFFICIENT_EVIDENCE', proof: 'A source that names the company.' };
  }
  return null;
}

const DANGLING_TAIL = /\s+(?:declares?|announces?|allots?|works?|outlines?|falls?|rises?|says?|plans?|to|rs\.?|₹|\$|inr|the|a|an|of|and|in|on|for|with|as|after|amid|may|will|seeks?|approves?|reports?|posts?|wins?|gets?|hikes?|cuts?|raises?)\.?$/i;
/** Never show a headline fragment as the company name: trim trailing verbs / currency tokens; empty falls back to the ticker. */
export function cleanCompanyName(company: string, ticker: string | null): string {
  let c = squash(company || '');
  if (!c) return ticker || NOT_IDENTIFIED;
  for (let i = 0; i < 4 && DANGLING_TAIL.test(c); i += 1) c = c.replace(DANGLING_TAIL, '').trim();
  if (ticker && c.length > ticker.length && c.toLowerCase().startsWith(ticker.toLowerCase() + ' ') && /^(?:declares?|announces?|allots?|works?|outlines?|falls?|rises?|says?|plans?)$/i.test(c.slice(ticker.length + 1).split(' ')[0] || '')) c = ticker;
  return c || ticker || NOT_IDENTIFIED;
}

export function analyseRadarItem(input: RadarInput): RadarItem {
  const title = squash(input.title || '');
  const desc = squash(input.description || '');
  const ff = input.feedFacts || {};
  const text = squash([title, desc, ff.what_happened || '', ff.what_matters || ''].filter(Boolean).join('. '));
  const sents = sentencesOf([title, desc, ff.what_happened || '', ff.what_matters || ''].filter(Boolean).join('. '));
  const e = input.earnings || null;
  const eType = input.eventType || '';
  const etText = eType.replace(/_/g, ' ');

  // ── price is split off first: it can never feed a fundamental field ──
  const ps = splitPrice(text);
  const quar = quarantineOf(input);
  // spans the adapter flagged (price, dividend per share, stake %) never reach earnings evidence
  const ctext = stripNonEarnings(ps.clean, input.nonEarningsNumbers);
  const priceResponse = ps.response;

  // ── detectors (company facts are read from the price-free text) ──
  const disprovedQuote = matchQuote(RE.disproved, text);
  const disproved = disprovedQuote != null;
  const subHint = input.subtypeHint || null;
  const tentative = RE.tentative.test(text) || (!!subHint && /\b(?:proposal|proposals|questions?)\b/i.test(text));
  const qualDet = RE.qual.test(text);
  const prodAward = RE.prodAward.test(text);
  const bottleneckDet = RE.bottleneck.test(text);
  const demandDet = RE.demand.test(text);
  const supplyDemandDet = RE.supplyDemand.test(text);
  const planHint = subHint === 'GUIDANCE_PLAN';
  const financingHint = subHint === 'FINANCING';
  const listingDone = subHint === 'LISTING_DONE';
  const newProductDet = RE.newProduct.test(text) || /new product|launch|approval/i.test(eType) || subHint === 'NEW_PRODUCT' || planHint;
  const operatingDet = RE.operating.test(ctext);
  const isResult = RE.isResult.test(text) || /result|earnings/i.test(eType);
  const orderLike = RE.orderLike.test(text);
  const capacityIncrease = RE.capacityIncrease.test(text);
  const custDemand = RE.custDemand.test(text);
  const utilisation = RE.utilisation.test(text);
  const contractOfftake = RE.contract.test(text);
  const marketShareDet = RE.marketShare.test(text);
  const regDemandDet = RE.regDemand.test(text);
  const pricingDet = RE.pricingPower.test(text);
  const marginDet = RE.marginWord.test(ctext);
  const fcfDet = RE.fcfWord.test(text);
  const amounts = parseAmounts(ctext);
  const amountStrs = ctext.match(RE.amount) || [];
  const percents = ctext.match(RE.percent) || [];
  const unitsM = ctext.match(RE.units) || [];
  const quantInText = amountStrs.length + percents.length + unitsM.length > 0;
  const earnNumbers = !!e && (isNum(e.revenueYoY) || isNum(e.patYoY) || (isNum(e.marginNow) && isNum(e.marginPrior)) || isNum(e.cfoToPat));
  const resultFin = isResult && (earnNumbers || /\b(?:pat|net profit|profit|revenue|sales|ebitda|income|margin|earnings)\b[^.;]{0,40}\d/i.test(ctext));
  const capexDetected = RE.capexWord.test(text) || capacityIncrease || input.category === 'CAPEX' || /capex|capacity/i.test(eType);
  const capacityConfirmed = capacityIncrease && (custDemand || utilisation || contractOfftake);
  const concrete = quantInText || RE.concreteVerb.test(text) || earnNumbers || disproved;

  let ss: SsSubtype | null = null;
  for (const [k, re] of SS_RE) if (re.test(text)) { ss = k; break; }
  if (!ss) ss = eventTypeSs(eType, input.category);
  // zzz847 subtype routing from the adapter: a merger is never a demerger, a loan is financing, a plan is not a deal
  if (subHint === 'MERGER') ss = 'MA';
  else if (subHint === 'SPIN' || listingDone) ss = 'SPIN';
  else if (financingHint || planHint || subHint === 'NEW_PRODUCT') ss = null;

  // an investment into an operating business or brand is growth, not a corporate action
  const dealMech = RE.dealMechanics.test(text);
  const acqWord = /\b(?:acqui(?:re|res|red|ring|sition)|stake|takeover)\b/i.test(text);
  const investDet = RE.investIn.test(text);
  const namedTarget = /\b(?:invest\w*|infus\w*)\b[^.;]{0,60}?\b(?:in|into)\s+(?:the\s+)?[A-Z][\w&'-]+/.test(`${title}. ${desc}`);
  const expansionWords = RE.businessExpansion.test(text);
  const growthInvest = !dealMech && !capacityIncrease && !newProductDet
    && ((investDet && (expansionWords || namedTarget)) || (acqWord && expansionWords && (ss === 'MA' || ss == null)));
  if (growthInvest) ss = null;

  // capital-structure funding: equity raises (warrants, QIP, preferential) and debt raises
  const fundingEq = RE.capRaise.test(text);
  const fundingDebt = RE.debtFin.test(text);
  const funding = (fundingEq || fundingDebt) && (ss == null);
  const useOfProceeds = RE.useOfProceeds.test(text);

  // independent fundamental mechanisms: anything that can change revenue, margin or cash on its own
  const orderOnly = orderLike && concrete && !qualDet && !bottleneckDet && !demandDet && !capexDetected && !ss && !isResult && !funding;
  const operatingFund = qualDet || bottleneckDet || demandDet || capacityIncrease || operatingDet || resultFin || marketShareDet || pricingDet || marginDet || regDemandDet;
  const fundMech = operatingFund || supplyDemandDet || orderOnly || fcfDet || (newProductDet && RE.newProduct.test(text)) || growthInvest;

  const rumourDenial = RE.rumour.test(text) && RE.denial.test(text) && !operatingFund;
  const corpActionDet = RE.corpAction.test(text) || RE.corpAction.test(etText);
  const corpAction = !rumourDenial && corpActionDet && !fundMech && !funding && !(ss && ss !== 'OTHER');
  const fda = RE.fdaLike.test(text);
  const legalCaseDet = !fda && (RE.legalSAT.test(text) || RE.legalCase.test(text));
  const legalDet = !fda && (legalCaseDet || RE.regDecision.test(text));
  const legalEvent = !rumourDenial && !corpAction && legalDet && !fundMech && !ss && !funding;
  const fundingEvent = !rumourDenial && !corpAction && funding && !(qualDet || bottleneckDet || demandDet || supplyDemandDet || operatingDet || resultFin || orderOnly || marketShareDet || pricingDet);

  const noisePatterns: string[] = [];
  if (RE.analyst.test(text)) noisePatterns.push('analyst rating or price-level change');
  if (RE.priceMove.test(text) || (priceResponse && !fundMech)) noisePatterns.push('a share-price move');
  if (RE.promo.test(text)) noisePatterns.push('promotional language');
  if (RE.genericAI.test(text)) noisePatterns.push('generic AI narrative');
  if (RE.sector.test(text)) noisePatterns.push('sector commentary without company evidence');
  const technicalText = RE.technical.test(text) || /technical|breakout/i.test(eType);

  const alwaysSS = ss === 'BUYBACK' || ss === 'OPEN_OFFER';
  const durableSSm = RE.durableSS.exec(text);
  const durableSS = !alwaysSS && (ss === 'SPIN' || ss === 'MA') && !!durableSSm && !disproved;
  const anyFundamental = !!(ss || qualDet || bottleneckDet || demandDet || supplyDemandDet || newProductDet || capexDetected || operatingDet || orderOnly || marketShareDet || regDemandDet || pricingDet || marginDet || fcfDet || growthInvest || (isResult && (earnNumbers || quantInText)));

  // ── duration parse (stated only) ──
  const term = parseDuration(ctext);

  // ── event class, kind ──
  let kind: CatalystKind = 'OTHER';
  let eventClass: EventClass = 'UNCLASSIFIED';
  let noiseKind: 'NOISE' | 'TECHNICAL' | null = null;
  let noiseReason = '';
  const narrativeOnly = noisePatterns.length > 0 && !concrete;
  const supplyAgreement = orderLike && !!term && term.code >= 3 && /supply|off-?take|agreement|contract/i.test(text);
  const isCourt = legalCaseDet;

  if (quar) { kind = quar.kind; eventClass = quar.cls; noiseKind = 'NOISE'; noiseReason = quar.noise; }
  else if (rumourDenial) { kind = 'DISPROVED_RUMOUR'; eventClass = 'DISPROVED_RUMOUR'; }
  else if (financingHint && !operatingFund) { kind = 'FINANCING'; eventClass = 'CAPITAL_STRUCTURE_FUNDING'; }
  else if (corpAction) { kind = 'CORPORATE_ACTION'; eventClass = 'CORPORATE_ACTION'; }
  else if (legalEvent) { kind = isCourt ? 'LEGAL_DECISION' : 'REGULATORY_DECISION'; eventClass = 'REGULATORY_LEGAL'; }
  else if (fundingEvent) { kind = fundingEq || !fundingDebt ? 'CAPITAL_RAISE' : 'FINANCING'; eventClass = 'CAPITAL_STRUCTURE_FUNDING'; }
  else {
    if (!anyFundamental) {
      if (technicalText && !noisePatterns.some((n) => n.startsWith('analyst') || n.startsWith('promotional'))) { noiseKind = 'TECHNICAL'; noiseReason = 'a technical setup with no fundamental event'; }
      else { noiseKind = 'NOISE'; noiseReason = noisePatterns.length ? noisePatterns[0] : 'no event that changes revenue, margin or cash generation'; }
    } else if (narrativeOnly && !ss && !earnNumbers) {
      noiseKind = 'NOISE'; noiseReason = noisePatterns[0];
    }
    if (noiseKind != null) {
      const first = noisePatterns[0] || '';
      if (noiseKind === 'TECHNICAL') { kind = 'PRICE_MOVE'; eventClass = 'TECHNICAL'; }
      else if (first.startsWith('analyst')) { kind = 'ANALYST_CHANGE'; eventClass = 'ANALYST'; }
      else if (first.startsWith('a share-price')) { kind = 'PRICE_MOVE'; eventClass = 'PRICE_RESPONSE'; }
      else if (first.startsWith('promotional') || first.startsWith('generic AI')) { kind = 'MEDIA_NARRATIVE'; eventClass = 'NARRATIVE'; }
      else if (first.startsWith('sector')) { kind = 'SECTOR_COMMENTARY'; eventClass = 'SECTOR_COMMENTARY'; }
      else { kind = 'OTHER'; eventClass = 'UNCLASSIFIED'; }
    } else if (planHint) kind = 'NEW_PRODUCT_MARKET';
    else if (ss) kind = 'SPECIAL_SITUATION';
    else if (qualDet) kind = 'CUSTOMER_QUALIFICATION';
    else if (bottleneckDet) kind = 'BOTTLENECK';
    else if (capacityConfirmed) kind = 'CAPACITY_INFLECTION';
    else if (supplyAgreement) kind = 'CUSTOMER_QUALIFICATION';
    else if (demandDet) kind = 'DEMAND_EXPLOSION';
    else if (marketShareDet) kind = 'MARKET_SHARE_INFLECTION';
    else if (regDemandDet) kind = 'REGULATORY_DEMAND_INFLECTION';
    else if (pricingDet) kind = 'PRICING_POWER_INFLECTION';
    else if (supplyDemandDet) kind = 'SUPPLY_DEMAND_INFLECTION';
    else if (growthInvest) kind = 'NEW_PRODUCT_MARKET';
    else if (newProductDet && !(isResult && !RE.newProduct.test(text))) kind = 'NEW_PRODUCT_MARKET';
    else if (capexDetected) kind = 'CAPACITY_INFLECTION';
    else if (isResult) kind = 'EARNINGS_RESULT';
    else if (fcfDet) kind = 'FCF_INFLECTION';
    else if (marginDet && !/turned profitable|first (?:quarterly |annual )?profit|record (?:quarterly |annual )?(?:revenue|sales)/i.test(ctext)) kind = 'MARGIN_INFLECTION';
    else if (operatingDet) kind = 'OPERATING_INFLECTION';
    else if (orderOnly) kind = 'CONTRACT_ORDER';
    else kind = 'OTHER';
    if (noiseKind == null) {
      eventClass = kind === 'SPECIAL_SITUATION' ? 'CORPORATE_TRANSACTION' : kind === 'EARNINGS_RESULT' ? 'RESULT' : kind === 'CONTRACT_ORDER' ? 'ORDER' : kind === 'OTHER' ? 'UNCLASSIFIED' : 'OPERATING';
    }
  }
  const quarantineKind = QUARANTINE_KINDS.has(kind);
  const noEarningsLink = noiseKind != null || quarantineKind;
  const isOrderOther = kind === 'CONTRACT_ORDER';
  const capexAlone = kind === 'CAPACITY_INFLECTION' && !capacityConfirmed;
  const nonOperatingEvent = kind === 'CAPITAL_RAISE' || kind === 'FINANCING' || kind === 'REGULATORY_DECISION' || kind === 'LEGAL_DECISION';

  // special-situation subtype and secondary kind
  const subKind: CatalystKind | null = kind !== 'SPECIAL_SITUATION' ? null
    : ss === 'BUYBACK' ? 'BUYBACK'
      : ss === 'OPEN_OFFER' ? (/delist|going private|take[\s-]?private|squeeze/i.test(text) ? 'GOING_PRIVATE' : 'TENDER_OFFER')
        : ss === 'SPIN' ? 'SPIN_DEMERGER'
          : ss === 'MA' ? (subHint === 'MERGER' || /merger|amalgamation|scheme of arrangement/i.test(text) ? 'MERGER' : 'ACQUISITION')
            : ss === 'RIGHTS' ? 'RIGHTS_ISSUE'
              : ss === 'ASSET_SALE' ? (/divest|hive|sale of (?:business|division|unit|undertaking)|stake sale|slump sale|sells? (?:its )?(?:stake|unit|division|business)/i.test(text) ? 'DIVESTITURE' : 'ASSET_SALE')
                : ss === 'RESTRUCTURING' ? 'RESTRUCTURING' : null;
  const secondaryKind: CatalystKind | null = ((): CatalystKind | null => {
    if (noEarningsLink || nonOperatingEvent) return null;
    const cands: Array<[boolean, CatalystKind]> = [
      [qualDet, 'CUSTOMER_QUALIFICATION'], [bottleneckDet, 'BOTTLENECK'], [capacityIncrease, 'CAPACITY_INFLECTION'], [demandDet, 'DEMAND_EXPLOSION'],
      [marketShareDet, 'MARKET_SHARE_INFLECTION'], [regDemandDet, 'REGULATORY_DEMAND_INFLECTION'], [pricingDet, 'PRICING_POWER_INFLECTION'],
      [supplyDemandDet, 'SUPPLY_DEMAND_INFLECTION'], [newProductDet, 'NEW_PRODUCT_MARKET'], [fcfDet, 'FCF_INFLECTION'], [marginDet, 'MARGIN_INFLECTION'],
    ];
    if (growthInvest && acqWord && !marketShareDet) return 'ACQUISITION';
    for (const [on, k] of cands) if (on && k !== kind) return k;
    return null;
  })();

  // ── duration: stated or evidenced, never inferred from the event type ──
  const src0 = readSources(input);
  const src = { rank: src0.rank, label: src0.label };
  const nSrc = src0.distinct;
  const socialAnalyst = src.rank != null && src.rank >= 12;
  const directPrimary = !socialAnalyst && (input.primarySource === true || (src.rank != null && src.rank <= 9) || src0.hasPrimary);

  const duration = ((): DurationRead => {
    const none = (why: string): DurationRead => ({ code: null, label: NE, basis: 'none', evidence: why, duration_source: 'unknown', durationConfidence: 'UNKNOWN', inferred: false, halfLife: null });
    if (noEarningsLink) return none('Not established - the source states no term and the type of event does not imply one.');
    if (term) {
      let code: DurationCode = term.code;
      if (code >= 4 && kind !== 'OTHER' && RE.transformational.test(text) && RE.capability.test(text) && RE.traction.test(text)) code = 5;
      const structuralItem = term.code === 0 && /gain on|profit on|tax (?:benefit|credit|write|refund)|exceptional/i.test(term.quote);
      const source: DurationSource = structuralItem ? 'structural-inference'
        : src.rank != null && src.rank <= 3 ? 'filing-stated'
          : (orderLike || contractOfftake) && /contract|agreement|off-?take|supply|order|award/i.test(text) ? 'contract-stated'
            : capexDetected || /^FY/i.test(term.quote) ? 'project-timeline' : 'company-stated';
      const conf: Confidence = (src.rank != null && src.rank <= 3) || (source === 'contract-stated' && directPrimary) ? 'HIGH' : directPrimary ? 'MEDIUM' : 'LOW';
      return { code, label: DURATION_LABEL[code], basis: 'stated', evidence: `Stated in the source: "${clip(term.quote, 60)}" (${term.words}).`, duration_source: source, durationConfidence: conf, inferred: structuralItem, halfLife: halfLifeOf(code) };
    }
    if (kind === 'EARNINGS_RESULT') {
      const q = e && isNum(e.quarters) ? e.quarters : 0;
      if (q >= 2) {
        const code: DurationCode = q >= 4 ? 3 : 2;
        return { code, label: DURATION_LABEL[code], basis: 'type', evidence: `Supplied results support the picture for ${fmt(q)} quarters. The source states no forward term, so this reads the past run only (historical inference).`, duration_source: 'historical-inference', durationConfidence: 'LOW', inferred: true, halfLife: halfLifeOf(code) };
      }
    }
    return none('Not established - the source states no term and the type of event does not imply one.');
  })();
  const dCode = duration.code;

  // ── evidence status ──
  let evStatus: EvidenceStatus;
  if (kind === 'DISPROVED_RUMOUR') evStatus = 'DISPROVED';
  else if (disproved && !noiseKind) evStatus = 'DISPROVED';
  else if (noiseKind || (kind === 'OTHER' && !isOrderOther)) evStatus = 'HYPOTHESIS';
  else if (socialAnalyst) evStatus = 'HYPOTHESIS';
  else if (directPrimary) evStatus = tentative ? (nSrc >= 2 ? 'STRONG' : 'DEVELOPING') : 'CONFIRMED';
  else if (src.rank === 10) evStatus = nSrc >= 2 ? 'STRONG' : 'DEVELOPING';
  else evStatus = nSrc >= 2 ? 'STRONG' : 'HYPOTHESIS';
  if (capexAlone && (evStatus === 'CONFIRMED' || evStatus === 'STRONG')) evStatus = 'DEVELOPING';
  // a proposal, a question about a deal or a management plan is reported, not done: never above developing
  const proposedOnly = (tentative && (!!ss || planHint || !!subHint)) || planHint;
  if (proposedOnly && (evStatus === 'CONFIRMED' || evStatus === 'STRONG')) evStatus = 'DEVELOPING';

  // ── link strength: strict definitions, price and non-earnings amounts never count ──
  const inflection = inflectionOf(e);
  const amountOrder = orderLike && amounts.length > 0;
  const implementedPrice = pricingDet && RE.pricingImplemented.test(text) && percents.length > 0;
  const aiExposureOnly = RE.aiExposure.test(text) && !(orderLike && amounts.length > 0) && !qualDet && !resultFin;
  const opEffectStated = /\b(?:licen[cs]e|ban (?:lifted|revoked)|resume[sd]? (?:operations|production|trading)|allowed to (?:operate|resume)|restor\w+ (?:operations|licen[cs]e)|clearance to operate|revenue|margins?|earnings|profit)\b/i.test(ctext) && !legalCaseDet;
  let link: LinkStrength;
  if (noiseKind) link = 'NARRATIVE_ONLY';
  else if (kind === 'CORPORATE_ACTION' || kind === 'DISPROVED_RUMOUR') link = 'NOT_ESTABLISHED';
  else if (kind === 'CAPITAL_RAISE' || kind === 'FINANCING') link = useOfProceeds ? 'INDIRECT' : 'NOT_ESTABLISHED';
  else if (kind === 'REGULATORY_DECISION' || kind === 'LEGAL_DECISION') link = opEffectStated ? 'INDIRECT' : 'NOT_ESTABLISHED';
  else if (kind === 'EARNINGS_RESULT') link = earnNumbers || resultFin ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'CUSTOMER_QUALIFICATION') link = amountOrder ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'DEMAND_EXPLOSION') link = amountOrder ? 'DIRECT' : orderLike ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'CAPACITY_INFLECTION') link = capexAlone ? 'INDIRECT' : contractOfftake && (unitsM.length > 0 || amounts.length > 0) ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'BOTTLENECK') link = RE.companyAdvantage.test(text) && (orderLike || quantInText) ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'OPERATING_INFLECTION') link = quantInText ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'MARGIN_INFLECTION') link = quantInText ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'FCF_INFLECTION') link = quantInText ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'PRICING_POWER_INFLECTION') link = implementedPrice ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'MARKET_SHARE_INFLECTION') link = quantInText ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'REGULATORY_DEMAND_INFLECTION') link = orderLike && quantInText ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'SUPPLY_DEMAND_INFLECTION') link = quantInText && RE.companyAdvantage.test(text) ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'NEW_PRODUCT_MARKET') link = planHint ? (amounts.length > 0 && /\b(?:revenue|sales|turnover|ebitda)\b/i.test(ctext) ? 'NEAR_DIRECT' : 'INDIRECT') : RE.traction.test(text) && quantInText && !growthInvest ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'SPECIAL_SITUATION') link = durableSS ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (isOrderOther) link = amountOrder ? 'DIRECT' : 'NEAR_DIRECT';
  else link = 'NARRATIVE_ONLY';
  if (aiExposureOnly && (link === 'DIRECT' || link === 'NEAR_DIRECT')) link = 'INDIRECT';

  // ── bucket ──
  const linkGood = link === 'DIRECT' || link === 'NEAR_DIRECT';
  const evOK = evStatus === 'CONFIRMED' || evStatus === 'STRONG' || evStatus === 'DEVELOPING';
  let bucket: RadarBucket;
  const quantified = earnNumbers || quantInText;
  const earningsKinds = kind === 'EARNINGS_RESULT' || kind === 'OPERATING_INFLECTION' || kind === 'MARGIN_INFLECTION' || kind === 'FCF_INFLECTION';
  if (kind === 'CORPORATE_ACTION') bucket = 'CORPORATE_ACTION';
  else if (kind === 'DISPROVED_RUMOUR') bucket = 'NOISE';
  else if (noiseKind) bucket = noiseKind;
  else if (alwaysSS) bucket = 'SPECIAL_SITUATION';
  else if (kind === 'SPECIAL_SITUATION') {
    // zzz847: a merger, acquisition or spin-off is a special situation, never an earnings inflection (no measured result exists yet)
    bucket = 'SPECIAL_SITUATION';
  } else if (evStatus === 'DISPROVED') bucket = 'EVENT_DRIVEN';
  else if (planHint) bucket = 'EVENT_DRIVEN';
  else if (growthInvest && acqWord) bucket = 'SPECIAL_SITUATION';
  else if (STRUCTURAL_KINDS.has(kind) && dCode != null && dCode >= 4 && linkGood && evOK) bucket = 'MULTIBAGGER';
  else if (bottleneckDet && (kind === 'BOTTLENECK' || kind === 'DEMAND_EXPLOSION' || kind === 'SUPPLY_DEMAND_INFLECTION')) bucket = 'BOTTLENECK';
  else if (earningsKinds && quantified && inflection.state !== 'NO_INFLECTION') bucket = 'EARNINGS_INFLECTION';
  else if (STRUCTURAL_KINDS.has(kind) && (dCode == null || dCode === 2 || dCode === 3) && linkGood && evOK) bucket = 'EARNINGS_INFLECTION';
  else bucket = 'EVENT_DRIVEN';

  // ── changes / mechanism ──
  const chg: string[] = [];
  const add = (...a: string[]) => a.forEach((x) => { if (!chg.includes(x)) chg.push(x); });
  if (kind === 'CUSTOMER_QUALIFICATION') add('revenue', 'volume', 'competitive position', 'customer concentration', 'earnings durability');
  else if (kind === 'BOTTLENECK') add('ASP', 'gross margin', 'operating margin', 'competitive position', 'earnings durability');
  else if (kind === 'CAPACITY_INFLECTION') add('volume', 'revenue', 'utilisation', 'ROCE', 'FCF');
  else if (kind === 'DEMAND_EXPLOSION') add('revenue', 'volume', 'addressable market', 'utilisation');
  else if (kind === 'SUPPLY_DEMAND_INFLECTION') add('ASP', 'gross margin', 'operating margin', 'volume');
  else if (kind === 'PRICING_POWER_INFLECTION') add('ASP', 'gross margin', 'operating margin');
  else if (kind === 'MARGIN_INFLECTION') add('gross margin', 'operating margin', 'earnings durability');
  else if (kind === 'FCF_INFLECTION') add('FCF', 'ROCE');
  else if (kind === 'MARKET_SHARE_INFLECTION') add('market share', 'revenue', 'competitive position');
  else if (kind === 'REGULATORY_DEMAND_INFLECTION') add('addressable market', 'volume', 'revenue');
  else if (kind === 'NEW_PRODUCT_MARKET') add('addressable market', 'mix', 'revenue', 'market share');
  else if (kind === 'OPERATING_INFLECTION') add('operating margin', 'utilisation', 'FCF', 'ROCE', 'earnings durability');
  else if (kind === 'EARNINGS_RESULT') {
    if (e && isNum(e.revenueYoY)) add('revenue');
    if (e && isNum(e.marginNow) && isNum(e.marginPrior)) add('operating margin');
    if (e && isNum(e.cfoToPat)) add('FCF');
    if (e && e.orderBook && e.orderBook !== 'NOT_STATED') add('volume');
    if (!chg.length) add('revenue', 'operating margin');
  } else if (kind === 'SPECIAL_SITUATION') {
    // a special situation names business variables only when the text shows the business changes (the structural bridge)
    if (durableSS) {
      if (ss === 'SPIN') add('competitive position', 'addressable market', 'ROCE', 'earnings durability');
      else if (ss === 'MA') add('revenue', 'market share', 'customer concentration', 'mix');
    }
  } else if (isOrderOther) add('revenue', 'volume', 'customer concentration');
  if ((kind !== 'SPECIAL_SITUATION' || durableSS) && !noEarningsLink && !nonOperatingEvent) {
    if (/\bmix\b|value[\s-]?added|premium (?:product|segment)/i.test(text)) add('mix');
    if (/gross margin/i.test(text)) add('gross margin');
    if (/single customer|top customer|customer concentration|largest customer/i.test(text)) add('customer concentration');
    if (/\bROCE\b|return on capital/i.test(text)) add('ROCE');
    if (/market share/i.test(text)) add('market share');
    if (/free cash flow|\bFCF\b|cash conversion/i.test(text)) add('FCF');
  }
  if (noEarningsLink || nonOperatingEvent) chg.length = 0;
  const changes = chg;

  const mechanism = ((): string => {
    if (kind === 'CORPORATE_ACTION') return 'A dividend, split, bonus or record date changes the share count or cash returned, not what the business earns.';
    if (kind === 'DISPROVED_RUMOUR') return 'The source says the report was denied or untrue, so there is no event and no earnings mechanism.';
    if (kind === 'PRICE_MOVE' && noiseKind === 'TECHNICAL') return 'A chart setup says something about timing only. It gives no reason why revenue, margin or cash may change.';
    if (noiseKind === 'TECHNICAL') return 'A chart setup says something about timing only. It gives no reason why revenue, margin or cash may change.';
    if (noiseKind) return `No mechanism to earnings power is stated (${noiseReason}).`;
    switch (kind) {
      case 'CUSTOMER_QUALIFICATION': return 'Approval or a contract with a customer that is slow to switch suppliers can turn into repeat volume.';
      case 'BOTTLENECK': return 'When supply is scarce, the few suppliers that can deliver may hold price and volume.';
      case 'CAPACITY_INFLECTION': return capexAlone ? 'Capex adds capacity, but it only lifts earnings if customer demand fills it.' : 'New capacity that is matched by customer demand, utilisation or a contract can lift volume, revenue and utilisation.';
      case 'DEMAND_EXPLOSION': return 'Demand that grows faster than supply can lift volume, price and utilisation.';
      case 'SUPPLY_DEMAND_INFLECTION': return 'A shift in supply or demand can change realised prices and margins.';
      case 'PRICING_POWER_INFLECTION': return 'A price rise that customers accept lifts realised price and margin without needing more volume.';
      case 'MARGIN_INFLECTION': return 'A higher margin on the same revenue lifts earnings faster than sales.';
      case 'FCF_INFLECTION': return 'Better cash conversion or lower working capital turns more of each profit rupee into free cash.';
      case 'MARKET_SHARE_INFLECTION': return 'A rising share of the market lifts volume and revenue faster than the market grows.';
      case 'REGULATORY_DEMAND_INFLECTION': return 'A rule that forces customers to buy or switch creates demand that does not depend on the cycle.';
      case 'NEW_PRODUCT_MARKET': return planHint ? 'Management says it will expand and lists a revenue target. A target is a company claim: it reaches earnings only if reported revenue gets there.' : growthInvest ? 'Money put into an operating business or brand can widen the product range and the addressable market; it only reaches earnings through that business growing.' : 'A new product or market can widen the addressable market and change the sales mix.';
      case 'OPERATING_INFLECTION': return 'Higher margin on a growing base can lift earnings faster than revenue.';
      case 'EARNINGS_RESULT': return 'Reported results show whether revenue, margin and cash are actually improving.';
      case 'CAPITAL_RAISE': return useOfProceeds ? 'A funding round changes cash and share count; it reaches earnings only through the use of proceeds named in the source.' : 'A funding round or warrant allotment changes cash and share count, not operations. The source does not say what the money is for.';
      case 'FINANCING': return useOfProceeds ? 'New debt changes the balance sheet; it reaches earnings only through the use of proceeds named in the source.' : 'New debt changes the balance sheet and interest cost, not operations. The source does not say what the money is for.';
      case 'LEGAL_DECISION': return 'A court or tribunal ruling changes a penalty, restriction or claim. The source does not say how revenue or margin change.';
      case 'REGULATORY_DECISION': return 'A regulator decision changes a penalty, permission or rule. The source does not say how revenue or margin change.';
      case 'SPECIAL_SITUATION':
        if (durableSS) return 'The text describes a change in the business that is bought or separated, with a stated contribution to earnings power.';
        if (ss === 'BUYBACK') return 'A buyback changes the share count, not the business.';
        if (ss === 'OPEN_OFFER') return 'A tender, open offer or going-private step is a deal-driven event with its own timetable, not a change in operations.';
        if (ss === 'SPIN') return listingDone ? 'The separation is already done and the business is listed. What is left is whether it reports and performs on its own; the text does not say it changes earnings power.' : 'A separation can change how the parts are run and valued; the text does not say it changes earnings power.';
        if (ss === 'MA') return 'A deal can change scale or customers; the text does not state a contribution to earnings.';
        if (ss === 'ASSET_SALE') return 'An asset sale is usually a one-time cash event.';
        if (ss === 'RIGHTS') return 'A capital raise changes funding and share count, not operations.';
        return 'A corporate action, classified separately from operating catalysts.';
      default: return isOrderOther ? 'An order adds revenue as it is delivered; its size against annual revenue is not established.' : 'No mechanism to earnings power is stated in the text.';
    }
  })();

  const whyItMatters = kind === 'CORPORATE_ACTION'
    ? `${mechanism} It is kept as a low-signal corporate action, not a thesis.`
    : kind === 'DISPROVED_RUMOUR' ? `${mechanism} Nothing here links to earnings.`
      : noiseKind
        ? (noiseKind === 'TECHNICAL' ? 'This is timing information only. It does not say why the business may change.' : `No change to earnings power is stated (${noiseReason}). ${mechanism}`)
        : changes.length
          ? `${KIND_LABEL[kind]}: it can change ${joinList(changes)}. ${mechanism}`
          : `${KIND_LABEL[kind]}: ${mechanism}`;

  // ── financial impact (company facts only; price, dividends, issue prices and security counts were removed) ──
  const financialImpact = ((): string => {
    if (noEarningsLink || nonOperatingEvent) {
      return kind === 'CORPORATE_ACTION' ? 'Not established - a corporate action states no operating figure.'
        : kind === 'DISPROVED_RUMOUR' ? 'Not established - the report was denied.'
          : nonOperatingEvent ? `Not established - ${kind === 'CAPITAL_RAISE' || kind === 'FINANCING' ? 'funding changes cash and share count, not revenue or profit' : 'the source states no revenue or profit effect'}.`
            : 'Not established - no earnings figure is stated.';
    }
    const parts: string[] = [];
    const q = uniq([...amounts.map((a) => a.raw), ...percents.map(squash), ...unitsM.map(squash)]).slice(0, 4);
    if (kind === 'EARNINGS_RESULT' && e) {
      const b: string[] = [];
      if (isNum(e.revenueYoY)) b.push(`revenue ${e.revenueYoY >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e.revenueYoY))}% year on year`);
      if (isNum(e.marginNow) && isNum(e.marginPrior)) b.push(`margin ${fmt(e.marginPrior)}% to ${fmt(e.marginNow)}%`);
      if (isNum(e.patYoY)) b.push(`profit ${e.patYoY >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e.patYoY))}% year on year`);
      if (isNum(e.cfoToPat)) b.push(`cash flow from operations is ${fmt(e.cfoToPat)}x profit`);
      if (b.length) parts.push(`Reported: ${joinList(b)}.`);
    }
    if (q.length) parts.push(`The source states: ${q.join(', ')}${growthInvest || kind === 'SPECIAL_SITUATION' ? ' (a deal or investment amount, not revenue)' : planHint ? ' (a management target, not reported revenue)' : ''}.`);
    if (!parts.length) return 'Not quantified in the source - the financial impact is not established.';
    return parts.join(' ');
  })();

  // per-variable impacts
  const noFinLink = noEarningsLink || link === 'NOT_ESTABLISHED' || link === 'NARRATIVE_ONLY';
  const NQ = noFinLink ? 'Not established' : 'Not quantified';
  const impacts: ImpactMap = { revenue: NQ, volume: NQ, asp: NQ, margin: NQ, ebitda: NQ, fcf: NQ, roce: NQ, marketShare: NQ };
  if (!noFinLink) {
    const firstAmt = amounts.length ? amounts.reduce((a, b) => (b.millions > a.millions ? b : a)).raw : null;
    if (kind === 'EARNINGS_RESULT' && e && isNum(e.revenueYoY)) impacts.revenue = `Revenue ${e.revenueYoY >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e.revenueYoY))}% year on year (reported)`;
    else if (firstAmt && (isOrderOther || kind === 'CUSTOMER_QUALIFICATION' || kind === 'DEMAND_EXPLOSION' || (orderLike && kind === 'CAPACITY_INFLECTION'))) impacts.revenue = `${firstAmt} contract or order value (stated; revenue arrives as it is delivered)`;
    else { const rv = /\b(?:revenue|sales|turnover)\b[^.;]{0,30}?(\d[\d,.]*\s?(?:%|crores?|cr|million|billion|mn|bn))/i.exec(ctext); if (rv) impacts.revenue = `${squash(rv[0])} (stated)`; }
    if (unitsM.length) impacts.volume = `${squash(unitsM[0]!)} (stated)`;
    else if (kind === 'EARNINGS_RESULT' && e && e.orderBook && e.orderBook !== 'NOT_STATED') impacts.volume = `Order book ${e.orderBook.toLowerCase()} (reported)`;
    const asp = /\b(?:price|prices|realisations?|ASP)\b[^.;]{0,30}?(\d+(?:\.\d+)?\s?%)/i.exec(ctext);
    if (asp) impacts.asp = `${squash(asp[0])} (stated)`;
    if (kind === 'EARNINGS_RESULT' && e && isNum(e.marginNow) && isNum(e.marginPrior)) impacts.margin = `Margin ${fmt(e.marginPrior)}% to ${fmt(e.marginNow)}% (reported)`;
    else { const mg = /\bmargins?\b[^.;]{0,30}?(\d+(?:\.\d+)?\s?(?:%|bps))|(\d+(?:\.\d+)?\s?(?:%|bps))\s+margin/i.exec(ctext); if (mg) impacts.margin = `${squash(mg[0])} (stated)`; }
    const eb = /\bEBITDA\b[^.;]{0,30}?((?:₹|rs\.?|inr|\$|us\$)?\s?\d[\d,.]*\s?(?:crores?|cr|million|billion|mn|bn|%))/i.exec(ctext);
    if (eb) impacts.ebitda = `${squash(eb[0])} (stated)`;
    if (kind === 'EARNINGS_RESULT' && e && isNum(e.cfoToPat)) impacts.fcf = `Cash flow from operations ${fmt(e.cfoToPat)}x profit (reported)`;
    else { const fc = /\b(?:free cash flow|FCF)\b[^.;]{0,30}?((?:₹|rs\.?|inr|\$|us\$)?\s?\d[\d,.]*\s?(?:crores?|cr|million|billion|mn|bn|%))/i.exec(ctext); if (fc) impacts.fcf = `${squash(fc[0])} (stated)`; }
    const rc = /\b(?:ROCE|return on capital)\b[^.;]{0,25}?(\d+(?:\.\d+)?\s?%)/i.exec(ctext);
    if (rc) impacts.roce = `${squash(rc[0])} (stated)`;
    const ms = /\bmarket share\b[^.;]{0,25}?(\d+(?:\.\d+)?\s?(?:%|pp|bps))/i.exec(ctext);
    if (ms) impacts.marketShare = `${squash(ms[0])} (stated)`;
  }
  const impactVals = Object.values(impacts);
  const nQuant = impactVals.filter((v) => v !== 'Not quantified' && v !== 'Not established').length;
  const quantificationStatus: QuantificationStatus = noFinLink ? 'NO_FINANCIAL_LINK'
    : nQuant >= 2 && (impacts.revenue.includes('(') || impacts.ebitda.includes('(')) ? 'QUANTIFIED' : nQuant >= 1 ? 'PARTIALLY_QUANTIFIED' : 'NOT_QUANTIFIED';

  // ── governance, drivers ──
  const governance = governanceOf(input.governance);
  const drivers = noiseKind === 'NOISE' || kind === 'CORPORATE_ACTION' || kind === 'DISPROVED_RUMOUR' ? [] : driversOfText(`${input.title || ''} ${input.description || ''} ${ff.what_happened || ''} ${ff.what_matters || ''}`);

  // ── bottleneck question ──
  const bottleneckQuestion = (kind === 'BOTTLENECK' || (bottleneckDet && !noEarningsLink && !nonOperatingEvent))
    ? `Why can't competitors immediately supply this demand? ${(() => { const s = sentenceWith(sents, RE.bottleneck); return s ? `The source says: "${s}"` : 'Not established - read the source'; })()}`
    : null;

  // ── chain (11 steps, kept for compatibility) ──
  const evSent = sentenceWith(sents, /./) || clip(text, 200);
  const pub = input.publishedAt || null;
  const evUsable = evStatus !== 'HYPOTHESIS' && evStatus !== 'DISPROVED' && !noEarningsLink;
  const step = (i: number, status: ChainStatus, t: string): ChainStep => ({
    step: CHAIN_NAMES[i], status, text: t,
    source: status === 'proven' ? src.label : null, date: status === 'proven' ? pub : null,
    confidence: status === 'proven' ? (src.rank != null && src.rank <= 6 ? 'HIGH' : 'MEDIUM') : status === 'assumed' ? 'LOW' : 'UNKNOWN',
  });
  const chain: ChainStep[] = [];
  chain.push(
    noEarningsLink && kind !== 'CORPORATE_ACTION' ? step(0, 'unknown', kind === 'DISPROVED_RUMOUR' ? 'The source says the report was denied or untrue.' : 'No catalyst that changes earnings power is stated.')
      : kind === 'CORPORATE_ACTION' ? step(0, 'unknown', 'A corporate action is not a catalyst that changes earnings power.')
        : evStatus === 'DISPROVED' ? step(0, 'unknown', `The source says the event was cancelled, withdrawn or rejected ("${clip(disprovedQuote || '', 60)}").`)
          : evUsable ? step(0, 'proven', `Source sentence: "${evSent}"`)
            : step(0, 'assumed', `Reported by ${src.label} but not verified by a primary source: "${evSent}"`),
  );
  const drvSent = sentenceWith(sents, /\b(customers?|demand|orders?|order book|backlog|offtake|off-take|market)\b/i);
  chain.push(noEarningsLink || nonOperatingEvent ? step(1, 'unknown', NE) : drvSent && kind !== 'EARNINGS_RESULT' ? step(1, evUsable ? 'proven' : 'assumed', `Source sentence: "${drvSent}"`) : ['DEMAND_EXPLOSION', 'CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'NEW_PRODUCT_MARKET'].includes(kind) ? step(1, 'assumed', 'The kind of event implies a customer or market driver, but the source does not name one.') : step(1, 'unknown', NE));
  const bnSent = sentenceWith(sents, RE.bottleneck);
  chain.push(bnSent && !noEarningsLink && !nonOperatingEvent ? step(2, evUsable ? 'proven' : 'assumed', `Source sentence: "${bnSent}"`) : step(2, 'unknown', kind === 'BOTTLENECK' ? 'Not established - read the source' : NE));
  const advSent = qualDet ? sentenceWith(sents, RE.qual) : (RE.companyAdvantage.test(text) && !noEarningsLink && !nonOperatingEvent ? sentenceWith(sents, RE.companyAdvantage) : null);
  chain.push(advSent && !noEarningsLink ? step(3, evUsable ? 'proven' : 'assumed', `Source sentence: "${advSent}"`) : step(3, 'unknown', NE));
  const capSent = capacityIncrease ? sentenceWith(sents, RE.capacityIncrease) : (utilisation ? sentenceWith(sents, RE.utilisation) : null);
  const orderBookUp = e?.orderBook === 'UP' && kind === 'EARNINGS_RESULT';
  chain.push(orderBookUp ? step(4, 'proven', 'Supplied results show the order book up.')
    : capSent && !noEarningsLink && !nonOperatingEvent ? step(4, evUsable ? 'proven' : 'assumed', `Source sentence: "${capSent}"`)
      : ['CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'DEMAND_EXPLOSION'].includes(kind) ? step(4, 'assumed', 'Volume is implied by the kind of event; no capacity or volume figure is stated.') : step(4, 'unknown', NE));
  const fromResults = kind === 'EARNINGS_RESULT' && !!e;
  const revProven = fromResults && isNum(e!.revenueYoY);
  const marginProven = fromResults && isNum(e!.marginNow) && isNum(e!.marginPrior);
  const fcfProven = fromResults && isNum(e!.cfoToPat);
  const patProven = fromResults && isNum(e!.patYoY);
  const impliesRev = !noEarningsLink && !nonOperatingEvent && ['CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'DEMAND_EXPLOSION', 'NEW_PRODUCT_MARKET', 'BOTTLENECK', 'OPERATING_INFLECTION', 'EARNINGS_RESULT', 'MARKET_SHARE_INFLECTION', 'REGULATORY_DEMAND_INFLECTION'].includes(kind) || isOrderOther;
  chain.push(revProven ? step(5, 'proven', `Supplied results: revenue ${e!.revenueYoY! >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e!.revenueYoY!))}% year on year.`) : impliesRev ? step(5, 'assumed', 'Revenue impact is implied by the mechanism, not yet visible in reported earnings.') : step(5, 'unknown', NE));
  chain.push(marginProven ? step(6, 'proven', `Supplied results: margin ${fmt(e!.marginPrior!)}% to ${fmt(e!.marginNow!)}%.`) : changes.some((c) => /margin|ASP/.test(c)) && !noEarningsLink ? step(6, 'assumed', 'Margin impact is implied by the mechanism, not yet visible in reported earnings.') : step(6, 'unknown', NE));
  chain.push(fcfProven ? step(7, 'proven', `Supplied results: cash flow from operations is ${fmt(e!.cfoToPat!)}x profit.`) : step(7, 'unknown', NE));
  chain.push(patProven ? step(8, 'proven', `Supplied results: profit ${e!.patYoY! >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e!.patYoY!))}% year on year.`) : (chain[5].status === 'assumed' || chain[6].status === 'assumed') ? step(8, 'assumed', 'Earnings impact follows only if the revenue and margin steps happen.') : step(8, 'unknown', NE));

  // ── expectations (only when both sides have data) ──
  const mult = input.multipleNow, fwd = input.forwardEarningsGrowth;
  const haveVal = isNum(mult) && isNum(fwd);
  const structuralBegin = STRUCTURAL_KINDS.has(kind) && linkGood && dCode != null && dCode >= 3 && evOK;
  const expectations: ExpectationsRead = ((): ExpectationsRead => {
    if (!haveVal) return { state: 'NOT_ASSESSED', note: 'Not assessed - no multiple / forward earnings supplied.', label: 'EXPECTATION DATA INSUFFICIENT' };
    const m = mult as number, g = fwd as number;
    const ratio = g > 0 ? m / g : null;
    const high = ratio == null ? m > 12 : ratio >= 2;
    const low = ratio == null ? m <= 12 : ratio <= 1;
    const strong = ['CONFIRMED_INFLECTION', 'ACCELERATING_INFLECTION', 'STRUCTURAL_INFLECTION'].includes(inflection.state);
    const moderate = inflection.state === 'EARLY_INFLECTION';
    const weak = inflection.state === 'NO_INFLECTION' || inflection.state === 'NOT_ASSESSED';
    const facts = `Multiple of ${fmt(m)}x against forward earnings growth of ${fmt(g)}%.`;
    if (strong && high) return { state: 'ALREADY_EXPECTED', note: `${facts} Fundamentals are strong, but the multiple already asks for a lot.`, label: 'STRONG FUNDAMENTALS/ALREADY REFLECTED' };
    if (moderate && high) return { state: 'ALREADY_EXPECTED', note: `${facts} Fundamentals are improving, and the multiple already asks for a lot.`, label: 'IMPROVING FUNDAMENTALS/HIGH EXPECTATION' };
    if ((strong || moderate) && low) return { state: 'LOW_EXPECTATIONS', note: `${facts} Fundamentals are improving and the multiple asks for little.`, label: 'LOW EXPECTATION/DEVELOPING FUNDAMENTALS' };
    if (weak && structuralBegin) return { state: 'EARLY_STAGE', note: `${facts} Results do not show it yet, but a structural catalyst is beginning.`, label: 'LOW EXPECTATION/DEVELOPING FUNDAMENTALS' };
    return { state: 'NOT_ASSESSED', note: `${facts} No expectations case fits the fundamentals supplied.`, label: 'EXPECTATION DATA INSUFFICIENT' };
  })();
  chain.push(haveVal ? step(9, 'assumed', expectations.note) : step(9, 'unknown', 'Not assessed - no multiple / forward earnings supplied.'));
  chain.push(!noEarningsLink && STRUCTURAL_KINDS.has(kind) && dCode != null && dCode >= 4 && evOK ? step(10, 'assumed', 'A multi-year re-rating is only possible if the earnings steps above are proven and the catalyst lasts.') : step(10, 'unknown', NE));
  let provenThrough = -1;
  chain.forEach((c, i) => { if (c.status === 'proven') provenThrough = i; });

  const valuationContext = haveVal
    ? (fwd as number) > 0
      ? `What has to happen for the current valuation to make sense: earnings need to grow about ${fmt(fwd as number)}% a year to match a ${fmt(mult as number)}x multiple, and that growth has to last as long as the catalyst does. Slower growth leaves the multiple stretched.`
      : `What has to happen for the current valuation to make sense: earnings growth has to turn positive; at a ${fmt(mult as number)}x multiple with forward growth of ${fmt(fwd as number)}% the multiple is not supported by growth.`
    : 'Not assessed - no multiple / forward earnings supplied.';

  // ── catalyst chain v2: 13 links with link-level status ──
  const srcName = src.label;
  const evLinkStatus: LinkStatus = evStatus === 'DISPROVED' ? 'CONTRADICTED' : evStatus === 'CONFIRMED' || evStatus === 'STRONG' ? 'PROVEN' : evStatus === 'DEVELOPING' ? 'PARTIALLY_PROVEN' : 'ASSUMED';
  const confOf = (st: LinkStatus): Confidence => st === 'NOT_APPLICABLE' ? 'UNKNOWN' : st === 'PROVEN' ? (src.rank != null && src.rank <= 6 ? 'HIGH' : 'MEDIUM') : st === 'ASSUMED' ? 'LOW' : 'MEDIUM';
  const lk = (link: CatalystLinkKey, status: LinkStatus, evidence: string | null): CatalystLink => {
    const real = status === 'PROVEN' || status === 'PARTIALLY_PROVEN' || status === 'CONTRADICTED';
    return { link, status, evidence: status === 'NOT_APPLICABLE' ? null : evidence, source: real ? srcName : null, date: real ? pub : null, confidence: confOf(status) };
  };
  const NA = (link: CatalystLinkKey) => lk(link, 'NOT_APPLICABLE', null);
  const soft: LinkStatus = evLinkStatus === 'PROVEN' ? 'PROVEN' : evLinkStatus === 'PARTIALLY_PROVEN' ? 'PARTIALLY_PROVEN' : 'ASSUMED';
  const opKind = STRUCTURAL_KINDS.has(kind) || kind === 'EARNINGS_RESULT' || kind === 'CONTRACT_ORDER';
  const bnApplicable = bottleneckDet || ['BOTTLENECK', 'CUSTOMER_QUALIFICATION', 'SUPPLY_DEMAND_INFLECTION', 'DEMAND_EXPLOSION', 'REGULATORY_DEMAND_INFLECTION', 'PRICING_POWER_INFLECTION'].includes(kind);
  const capApplicable = capacityIncrease || utilisation || ['CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'DEMAND_EXPLOSION', 'BOTTLENECK', 'CONTRACT_ORDER', 'NEW_PRODUCT_MARKET', 'REGULATORY_DEMAND_INFLECTION'].includes(kind);
  const volApplicable = opKind && !['MARGIN_INFLECTION', 'FCF_INFLECTION', 'PRICING_POWER_INFLECTION'].includes(kind);
  const marginApplicable = marginProven || changes.some((c) => /margin|ASP/.test(c)) || ['MARGIN_INFLECTION', 'PRICING_POWER_INFLECTION', 'OPERATING_INFLECTION', 'EARNINGS_RESULT'].includes(kind);
  const fcfApplicable = fcfProven || changes.includes('FCF') || kind === 'FCF_INFLECTION';
  const spApplicable = kind === 'SPECIAL_SITUATION' && (durableSS || ss === 'MA' || ss === 'SPIN');
  const resultsContra = kind === 'EARNINGS_RESULT' && inflection.state === 'NO_INFLECTION';
  const catalystChain: CatalystLink[] = [];
  if (noEarningsLink) {
    catalystChain.push(lk('EVENT', kind === 'DISPROVED_RUMOUR' ? 'CONTRADICTED' : soft, kind === 'DISPROVED_RUMOUR' ? 'The source says the report was denied or untrue.' : `${KIND_LABEL[kind]}: ${clip(noPriceClause(evSent), 140)}`));
    for (const k of LINK_KEYS.slice(1)) catalystChain.push(NA(k));
  } else if (nonOperatingEvent) {
    catalystChain.push(lk('EVENT', evLinkStatus, `Source sentence: "${noPriceClause(evSent)}"`));
    for (const k of LINK_KEYS.slice(1)) {
      if ((k === 'REVENUE' || k === 'EARNINGS') && link === 'INDIRECT') catalystChain.push(lk(k, 'ASSUMED', 'Follows only through the use of proceeds or operating effect named in the source.'));
      else if (k === 'CAPACITY' && useOfProceeds && capexDetected) catalystChain.push(lk(k, 'ASSUMED', 'The source names capacity or capex as a use of the money; deployment is not shown.'));
      else if ((k === 'EXPECTATIONS' || k === 'VALUATION') && haveVal) catalystChain.push(lk(k, 'PARTIALLY_PROVEN', expectations.note));
      else catalystChain.push(NA(k));
    }
  } else {
    catalystChain.push(lk('EVENT', evLinkStatus, evStatus === 'DISPROVED' ? `The source says the event was cancelled, withdrawn or rejected ("${clip(disprovedQuote || '', 60)}").` : `Source sentence: "${noPriceClause(evSent)}"`));
    if (kind === 'SPECIAL_SITUATION' && !spApplicable) {
      for (const k of LINK_KEYS.slice(1)) catalystChain.push((k === 'EXPECTATIONS' || k === 'VALUATION') && haveVal ? lk(k, 'PARTIALLY_PROVEN', expectations.note) : NA(k));
    } else {
      catalystChain.push(kind === 'EARNINGS_RESULT' ? NA('DRIVER') : drvSent ? lk('DRIVER', soft, `Source sentence: "${drvSent}"`) : lk('DRIVER', 'ASSUMED', 'The kind of event implies a customer or market driver, but the source does not name one.'));
      catalystChain.push(!bnApplicable ? NA('BOTTLENECK') : bnSent ? lk('BOTTLENECK', soft, `Source sentence: "${bnSent}"`) : lk('BOTTLENECK', 'ASSUMED', 'Not established - read the source.'));
      catalystChain.push(kind === 'EARNINGS_RESULT' ? NA('COMPANY_ADVANTAGE') : advSent ? lk('COMPANY_ADVANTAGE', soft, `Source sentence: "${advSent}"`) : lk('COMPANY_ADVANTAGE', 'ASSUMED', 'Not established.'));
      catalystChain.push(!capApplicable ? NA('CAPACITY') : capSent ? lk('CAPACITY', capexAlone ? 'PARTIALLY_PROVEN' : soft, `Source sentence: "${capSent}"`) : lk('CAPACITY', 'ASSUMED', 'No capacity figure is stated.'));
      catalystChain.push(!volApplicable ? NA('VOLUME')
        : orderBookUp ? lk('VOLUME', 'PROVEN', 'Supplied results show the order book up.')
          : unitsM.length ? lk('VOLUME', soft === 'ASSUMED' ? 'ASSUMED' : 'PARTIALLY_PROVEN', `The source states ${squash(unitsM[0]!)}.`)
            : lk('VOLUME', 'ASSUMED', 'Volume is implied by the mechanism; no volume figure is stated.'));
      const revSt: LinkStatus = resultsContra && revProven ? 'CONTRADICTED' : revProven ? 'PROVEN' : amountOrder && link === 'DIRECT' && soft !== 'ASSUMED' ? 'PARTIALLY_PROVEN' : impliesRev || kind === 'SPECIAL_SITUATION' ? 'ASSUMED' : 'NOT_APPLICABLE';
      catalystChain.push(lk('REVENUE', revSt, revProven ? `Supplied results: revenue ${e!.revenueYoY! >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e!.revenueYoY!))}% year on year.` : revSt === 'PARTIALLY_PROVEN' ? `${impacts.revenue}.` : 'Revenue impact is implied by the mechanism, not yet visible in reported earnings.'));
      const mgSt: LinkStatus = resultsContra && marginProven ? 'CONTRADICTED' : marginProven ? 'PROVEN' : !marginApplicable ? 'NOT_APPLICABLE' : impacts.margin !== 'Not quantified' && link === 'DIRECT' ? 'PARTIALLY_PROVEN' : 'ASSUMED';
      catalystChain.push(lk('MARGIN', mgSt, marginProven ? `Supplied results: margin ${fmt(e!.marginPrior!)}% to ${fmt(e!.marginNow!)}%.` : mgSt === 'PARTIALLY_PROVEN' ? `${impacts.margin}.` : 'Margin impact is implied by the mechanism, not yet visible in reported earnings.'));
      const ebSt: LinkStatus = revProven && marginProven ? 'PARTIALLY_PROVEN' : impacts.ebitda !== 'Not quantified' ? 'PARTIALLY_PROVEN' : revSt === 'ASSUMED' || mgSt === 'ASSUMED' ? 'ASSUMED' : 'NOT_APPLICABLE';
      catalystChain.push(lk('EBITDA', ebSt, ebSt === 'PARTIALLY_PROVEN' ? (revProven && marginProven ? 'Derived from reported revenue and margin; EBITDA itself is not stated.' : `${impacts.ebitda}.`) : 'EBITDA impact follows only if the revenue and margin steps happen.'));
      catalystChain.push(!fcfApplicable ? NA('FCF') : fcfProven ? lk('FCF', 'PROVEN', `Supplied results: cash flow from operations is ${fmt(e!.cfoToPat!)}x profit.`) : impacts.fcf !== 'Not quantified' ? lk('FCF', 'PARTIALLY_PROVEN', `${impacts.fcf}.`) : lk('FCF', 'ASSUMED', 'Cash conversion is not yet shown.'));
      const eaSt: LinkStatus = patProven ? (resultsContra ? 'CONTRADICTED' : 'PROVEN') : revSt === 'ASSUMED' || mgSt === 'ASSUMED' || revSt === 'PARTIALLY_PROVEN' ? 'ASSUMED' : 'NOT_APPLICABLE';
      catalystChain.push(lk('EARNINGS', eaSt, patProven ? `Supplied results: profit ${e!.patYoY! >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e!.patYoY!))}% year on year.` : 'Earnings impact follows only if the revenue and margin steps happen.'));
    }
    if (!(kind === 'SPECIAL_SITUATION' && !spApplicable)) {
      catalystChain.push(haveVal ? lk('EXPECTATIONS', 'PARTIALLY_PROVEN', expectations.note) : lk('EXPECTATIONS', 'ASSUMED', 'Expectation data insufficient: no multiple or forward growth supplied.'));
      catalystChain.push(haveVal ? lk('VALUATION', 'PARTIALLY_PROVEN', valuationContext) : lk('VALUATION', 'ASSUMED', 'Not assessed - no multiple / forward earnings supplied.'));
    }
  }
  const chainOf = (k: CatalystLinkKey) => catalystChain.find((l) => l.link === k)!;

  // three separate confirmations
  const eventConfirmation: EventConfirmation = noiseKind ? 'NOT_APPLICABLE' : evStatus === 'DISPROVED' ? 'DISPROVED' : tentative || planHint ? 'PLANNED' : evStatus === 'CONFIRMED' ? 'CONFIRMED' : 'REPORTED';
  const mechLinks = catalystChain.filter((l) => ['DRIVER', 'BOTTLENECK', 'COMPANY_ADVANTAGE', 'CAPACITY', 'VOLUME'].includes(l.link) && l.status !== 'NOT_APPLICABLE');
  const mechanismStatus: MechanismStatus = evStatus === 'DISPROVED' ? 'CONTRADICTED'
    : !mechLinks.length ? 'NOT_ESTABLISHED'
      : mechLinks.filter((l) => l.status === 'PROVEN').length >= 2 ? 'STATED'
        : mechLinks.some((l) => l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN') ? 'PARTIALLY_STATED' : 'ASSUMED';
  const earnLinks = catalystChain.filter((l) => ['REVENUE', 'MARGIN', 'EBITDA', 'EARNINGS'].includes(l.link) && l.status !== 'NOT_APPLICABLE');
  const earningsImpactStatus: EarningsImpactStatus = earnLinks.some((l) => l.status === 'CONTRADICTED') ? 'CONTRADICTED'
    : !earnLinks.length ? 'NOT_ESTABLISHED'
      : chainOf('EARNINGS').status === 'PROVEN' ? 'CONFIRMED'
        : earnLinks.some((l) => l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN') ? 'PARTIALLY_PROVEN' : 'UNPROVEN';
  const kindWord: Partial<Record<CatalystKind, string>> = {
    CAPACITY_INFLECTION: 'demand/capacity', DEMAND_EXPLOSION: 'demand/capacity', CUSTOMER_QUALIFICATION: 'customer-qualification', BOTTLENECK: 'supply-bottleneck',
    NEW_PRODUCT_MARKET: 'new product/market', MARGIN_INFLECTION: 'margin', FCF_INFLECTION: 'cash-flow', MARKET_SHARE_INFLECTION: 'market-share',
    PRICING_POWER_INFLECTION: 'pricing', REGULATORY_DEMAND_INFLECTION: 'regulation-driven demand', SUPPLY_DEMAND_INFLECTION: 'supply-demand', CONTRACT_ORDER: 'order',
    OPERATING_INFLECTION: 'operating', EARNINGS_RESULT: 'results',
  };
  const confirmationLabel = ((): string => {
    if (kind === 'DISPROVED_RUMOUR') return 'Disproved: the source says the report was denied or untrue. No earnings link.';
    if (evStatus === 'DISPROVED') return 'Disproved: the source says the event was cancelled, withdrawn or rejected.';
    if (kind === 'CORPORATE_ACTION') return 'Corporate action: the event is reported; it has no earnings mechanism.';
    if (noiseKind) return 'Not an earnings catalyst: no event that changes revenue, margin or cash is stated.';
    if (nonOperatingEvent) return `${eventConfirmation === 'CONFIRMED' ? 'Event confirmed' : 'Event reported'}; the earnings link is not established.`;
    const kw = kindWord[kind] || (kind === 'SPECIAL_SITUATION' ? 'deal' : 'event');
    if (earningsImpactStatus === 'CONFIRMED') return 'Confirmed earnings catalyst: reported results show it in profit.';
    if (eventConfirmation === 'CONFIRMED') return `Confirmed ${kw} catalyst; earnings transmission remains ${earningsImpactStatus === 'PARTIALLY_PROVEN' ? 'partially unproven' : earningsImpactStatus === 'NOT_ESTABLISHED' ? 'not established' : 'unproven'}.`;
    if (eventConfirmation === 'PLANNED') return `Planned ${kw} event, not yet completed; earnings transmission is unproven.`;
    return `Reported ${kw} event, not confirmed by a primary source; earnings transmission is unproven.`;
  })();
  const evidenceScope = ((): { confirmed: string[]; notConfirmed: string[] } => {
    const confirmed: string[] = [];
    const notConfirmed: string[] = [];
    for (const l of catalystChain) {
      if (l.status === 'PROVEN') confirmed.push(`${cap1(LINK_WORD[l.link])}: ${clip(l.evidence || 'stated in the source', 110)}`);
      else if (l.status === 'PARTIALLY_PROVEN') confirmed.push(`${cap1(LINK_WORD[l.link])} (partly): ${clip(l.evidence || 'partly stated', 110)}`);
      else if (l.status === 'ASSUMED') notConfirmed.push(cap1(LINK_WORD[l.link]));
      else if (l.status === 'CONTRADICTED') notConfirmed.push(`${cap1(LINK_WORD[l.link])} (contradicted)`);
    }
    if (duration.code == null && !noEarningsLink) notConfirmed.push('Duration');
    if (proposedOnly && !noEarningsLink) notConfirmed.unshift(planHint ? 'Management target: proposed, not delivered' : 'Deal: proposed, not approved');
    if (kind === 'CAPITAL_RAISE' || kind === 'FINANCING') { if (!useOfProceeds) notConfirmed.push('Use of proceeds'); }
    return { confirmed, notConfirmed };
  })();

  // ── weakest unproven link and the next proof ──
  const PATH: Partial<Record<CatalystKind, CatalystLinkKey[]>> = {
    CUSTOMER_QUALIFICATION: ['VOLUME', 'REVENUE', 'EARNINGS'], CAPACITY_INFLECTION: capexAlone ? ['DRIVER', 'CAPACITY', 'VOLUME', 'REVENUE'] : ['CAPACITY', 'VOLUME', 'REVENUE', 'EARNINGS'],
    BOTTLENECK: ['COMPANY_ADVANTAGE', 'VOLUME', 'MARGIN', 'REVENUE'], DEMAND_EXPLOSION: ['VOLUME', 'REVENUE', 'EARNINGS'], SUPPLY_DEMAND_INFLECTION: ['COMPANY_ADVANTAGE', 'MARGIN', 'VOLUME', 'REVENUE'],
    NEW_PRODUCT_MARKET: ['VOLUME', 'REVENUE', 'MARGIN'], MARGIN_INFLECTION: ['MARGIN', 'EBITDA', 'EARNINGS'], FCF_INFLECTION: ['FCF', 'EARNINGS'], MARKET_SHARE_INFLECTION: ['VOLUME', 'REVENUE'],
    REGULATORY_DEMAND_INFLECTION: ['DRIVER', 'VOLUME', 'REVENUE'], PRICING_POWER_INFLECTION: ['MARGIN', 'VOLUME', 'EBITDA'], CONTRACT_ORDER: ['VOLUME', 'REVENUE', 'EARNINGS'],
    OPERATING_INFLECTION: ['REVENUE', 'MARGIN', 'FCF', 'EARNINGS'], EARNINGS_RESULT: ['REVENUE', 'MARGIN', 'FCF', 'EARNINGS'], CAPITAL_RAISE: ['CAPACITY', 'REVENUE', 'EARNINGS'], FINANCING: ['CAPACITY', 'REVENUE', 'EARNINGS'],
    SPECIAL_SITUATION: ['REVENUE', 'EARNINGS'],
  };
  const weakestKey = ((): CatalystLinkKey | null => {
    if (noEarningsLink) return null;
    if (evStatus === 'DISPROVED') return 'EVENT';
    if (evLinkStatus === 'ASSUMED') return 'EVENT';
    for (const k of PATH[kind] || ['REVENUE', 'EARNINGS']) { const l = chainOf(k); if (l.status === 'ASSUMED' || l.status === 'PARTIALLY_PROVEN') return k; }
    return null;
  })();
  const weakestUnprovenLink = weakestKey ? LINK_WORD[weakestKey] : null;

  const when = ((): string | null => {
    const m = /(?:by|in|during|from|before|starting|planned|scheduled|slated|due|commenc\w+|expected (?:by|in|to))\s+((?:Q[1-4]\s?FY\s?\d{2}(?:\d{2})?(?!\d)|H[12]\s?FY\s?\d{2}(?:\d{2})?(?!\d)|FY\s?\d{2}(?:\d{2})?(?!\d)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:first|second|third|fourth) quarter(?: of)?\s+\d{4}|Q[1-4]\s?\d{4}))/i.exec(text);
    return m ? squash(m[1]) : null;
  })();
  const proof: ProofPoint = ((): ProofPoint => {
    let p: ProofPoint;
    if (kind === 'CORPORATE_ACTION') p = { what: 'Nothing to prove: a corporate action is not a thesis. A separate filing stating a revenue, order or margin effect would be needed.', when: null, kind: 'filing' };
    else if (kind === 'DISPROVED_RUMOUR') p = { what: 'A company filing that states an operating effect. The denied report is not evidence of one.', when: null, kind: 'filing' };
    else if (noiseKind === 'TECHNICAL') p = { what: 'A company filing or result that states a revenue, order or margin effect; the chart alone does not answer why.', when: null, kind: 'filing' };
    else if (quar) p = { what: quar.proof, when: null, kind: 'filing' };
    else if (noiseKind) p = { what: 'A company filing or result that states a revenue, order or margin effect for this company.', when: null, kind: 'filing' };
    else if (evStatus === 'DISPROVED') p = { what: 'A company filing that confirms the cancellation, or a replacement order or contract.', when: null, kind: 'filing' };
    else switch (kind) {
      case 'CUSTOMER_QUALIFICATION': p = prodAward ? { what: 'First production shipments, recurring purchase orders or disclosed volume under the award, then revenue from it in reported results.', when, kind: 'shipment' } : { what: 'First production shipments, recurring purchase orders or disclosed volume with the qualifying customer, then revenue from it in reported results.', when, kind: 'qualification' }; break;
      case 'CAPACITY_INFLECTION': p = capexAlone ? { what: 'Proof needed: commissioning + utilisation + demand (commissioning date, utilisation of the new capacity, and customer orders that fill it).', when, kind: 'commissioning' } : { what: 'Commissioning date and utilisation of the new capacity, incremental shipment volume, and revenue from the demand that fills it.', when, kind: 'commissioning' }; break;
      case 'DEMAND_EXPLOSION': p = { what: 'Billing start and backlog conversion into reported revenue over the next results.', when, kind: 'backlog' }; break;
      case 'BOTTLENECK': p = { what: 'Lead times, pricing, utilisation and backlog conversion that show the shortage persists and the company holds a share of the scarce supply.', when, kind: 'utilisation' }; break;
      case 'NEW_PRODUCT_MARKET': p = planHint ? { what: `Reported revenue against the management target${amounts.length ? ` (${amounts[0].raw})` : ''} in the next results. It is a target, not a result.`, when, kind: 'result' } : growthInvest ? { what: 'Revenue growth of the acquired or funded business, distribution expansion and segment performance in the next results.', when: when || 'next quarterly result', kind: 'result' }
        : RE.approval.test(text) ? { what: 'Product launch after the approval, then adoption and shipment growth in reported revenue (first sales).', when, kind: 'approval' } : { what: 'Launch, adoption and shipment growth of the new product or in the new market (first commercial sales).', when, kind: 'shipment' }; break;
      case 'SUPPLY_DEMAND_INFLECTION': p = { what: 'Realised prices, volume, utilisation and order intake in the next results showing the shift reaches this company.', when: when || 'next quarterly result', kind: 'margin' }; break;
      case 'PRICING_POWER_INFLECTION': p = { what: 'Realised price, volume and gross margin in the next results showing the price rise held.', when: when || 'next quarterly result', kind: 'margin' }; break;
      case 'MARGIN_INFLECTION': p = { what: 'Gross margin and EBITDA margin in the next results: does the gain hold for a second quarter?', when: when || 'next quarterly result', kind: 'margin' }; break;
      case 'FCF_INFLECTION': p = { what: 'Cash flow from operations against profit, working-capital days and free cash flow in the next results.', when: when || 'next quarterly result', kind: 'result' }; break;
      case 'MARKET_SHARE_INFLECTION': p = { what: 'Volume and revenue growth against the market, and the stated share figure, in the next results.', when: when || 'next quarterly result', kind: 'result' }; break;
      case 'REGULATORY_DEMAND_INFLECTION': p = { what: 'Enforcement dates, the company\'s order intake under the rule and volume in the next results.', when, kind: 'order' }; break;
      case 'OPERATING_INFLECTION': case 'EARNINGS_RESULT': p = { what: 'Next quarterly result: do revenue growth and margin hold for a second and third quarter?', when: 'next quarterly result', kind: 'result' }; break;
      case 'CAPITAL_RAISE': case 'FINANCING': p = { what: 'Use of proceeds and deployment, the balance-sheet effect, and later results showing what the money funded.', when, kind: 'filing' }; break;
      case 'LEGAL_DECISION': case 'REGULATORY_DECISION': p = { what: 'A company disclosure of the operating effect (licence, revenue or margin) in a filing or the next results.', when, kind: 'filing' }; break;
      case 'SPECIAL_SITUATION':
        p = ss === 'BUYBACK' ? { what: 'Completion of the buyback and the size actually bought back.', when, kind: 'closing' }
          : ss === 'OPEN_OFFER' ? { what: 'Offer close, acceptance level and the regulatory approvals.', when, kind: 'closing' }
            : ss === 'SPIN' ? (listingDone ? { what: 'First separate results and separate reporting of the listed business; the listing itself is done.', when, kind: 'result' }
                : tentative ? { what: 'Board and shareholder approval of the proposal (proposed, not approved), then the record date, listing of the separated business and its first separate results.', when, kind: 'closing' }
                  : { what: 'Record date, listing of the separated business and its first separate results.', when, kind: 'closing' })
              : ss === 'MA' ? (subHint === 'MERGER' ? { what: `${tentative ? 'Approval of the proposal (proposed, not approved), then ' : ''}regulatory, shareholder and NCLT approval, the swap-ratio terms, deal closing and the first combined results.`, when, kind: 'closing' }
                : { what: 'Regulatory approval, deal closing, distribution or customer overlap, and separate reporting of the acquired business.', when, kind: 'closing' })
                : ss === 'RESTRUCTURING' ? { what: 'The next regulatory or lender step, then results showing the effect.', when, kind: 'filing' }
                  : { what: 'Completion step named in the filing (closing, allotment or listing).', when, kind: 'closing' };
        break;
      default: p = isOrderOther ? { what: 'Billing start and delivery of the order in reported revenue; order size against annual revenue.', when, kind: 'order' } : { what: 'A company filing or result that states a revenue, order or margin effect.', when: null, kind: 'filing' };
    }
    // zzz847: no feed watch-item boilerplate is appended; the next proof is the weakest unproven link only
    if (p.when && !/\d/.test(p.when) && !/^next /i.test(p.when)) p = { ...p, when: null };
    return p;
  })();

  // ── break conditions ──
  const breaks: string[] = [];
  const bAdd = (...s: string[]) => s.forEach((x) => { if (!breaks.includes(x)) breaks.push(x); });
  if (ff.what_breaks_thesis && squash(ff.what_breaks_thesis)) bAdd(clip(squash(ff.what_breaks_thesis), 200));
  if (kind === 'CORPORATE_ACTION') { /* quarantined: no thesis, so nothing to break */ }
  else if (noEarningsLink) bAdd('No filing or result ever states an effect on revenue, margin or cash.');
  else switch (kind) {
    case 'CUSTOMER_QUALIFICATION': bAdd('Order cancellation or no follow-on orders after qualification', 'Customer loss or a second source approved', 'Margin reversal on the new business', 'Delayed capacity to serve the customer'); break;
    case 'CAPACITY_INFLECTION': bAdd('Utilisation deterioration at the new capacity', 'Delayed commissioning', 'Capex without demand: orders do not fill the capacity', 'Balance-sheet stress from the spend'); break;
    case 'DEMAND_EXPLOSION': bAdd('Falling backlog or order inflow', 'Order cancellation', 'Pricing deterioration as supply catches up', 'Utilisation deterioration'); break;
    case 'BOTTLENECK': bAdd('Competitors qualify or add supply, so the shortage ends', 'Pricing deterioration', 'Customer loss', 'Margin reversal'); break;
    case 'SUPPLY_DEMAND_INFLECTION': bAdd('Pricing deterioration', 'Margin reversal', 'Supply returns or demand fades'); break;
    case 'PRICING_POWER_INFLECTION': bAdd('The price rise is reversed or discounted away', 'Volume falls as customers switch', 'Margin reversal'); break;
    case 'MARGIN_INFLECTION': bAdd('Margin gain reverses in the next result', 'Input costs rise again', 'Revenue growth slows'); break;
    case 'FCF_INFLECTION': bAdd('Working capital builds again', 'Cash conversion falls back', 'Capex absorbs the cash'); break;
    case 'MARKET_SHARE_INFLECTION': bAdd('Share gains stall or reverse', 'Competitors respond on price', 'Revenue growth falls to the market rate'); break;
    case 'REGULATORY_DEMAND_INFLECTION': bAdd('The rule is delayed, diluted or repealed', 'Customers comply through a rival supplier', 'No order intake follows the rule'); break;
    case 'NEW_PRODUCT_MARKET': bAdd('Regulatory rejection or delay', 'No first sales after launch', 'Customer loss', 'Margin reversal'); if (growthInvest) bAdd('The acquired or funded business stops growing', 'Distribution does not expand'); break;
    case 'OPERATING_INFLECTION': case 'EARNINGS_RESULT': bAdd('Margin reversal in the next result', 'Revenue growth slows', 'Falling backlog or order book', 'Cash conversion worsens'); break;
    case 'CAPITAL_RAISE': case 'FINANCING': bAdd('The money is not deployed into the business', 'Dilution or interest cost outruns the return on the new money'); break;
    case 'LEGAL_DECISION': case 'REGULATORY_DECISION': bAdd('The ruling is appealed or reversed', 'The operating effect never shows in results'); break;
    case 'SPECIAL_SITUATION': if (listingDone) bAdd('The separated business reports weak results on its own', 'Balance-sheet stress at the separated business'); else bAdd('Regulatory rejection or deal termination', 'Balance-sheet stress from the deal or its financing'); if (durableSS) bAdd('The stated earnings contribution does not appear in results'); break;
    default: bAdd('Order cancellation', 'Falling backlog', 'Margin reversal');
  }
  if (kind !== 'CORPORATE_ACTION') {
    if (governance.status === 'FLAGGED') bAdd('Governance deterioration: the flags above worsen');
    else if (!noEarningsLink) bAdd('Governance deterioration');
    if (/\bdebt|borrow|loan|financ/i.test(text) && kind !== 'SPECIAL_SITUATION' && !noEarningsLink) bAdd('Balance-sheet stress');
  }
  const breakConditions = breaks.slice(0, 7);

  // ── materiality, counterfactual, mechanism sentence ──
  const capitalEvent = growthInvest || kind === 'SPECIAL_SITUATION' || kind === 'CAPITAL_RAISE' || kind === 'FINANCING' || (kind === 'CAPACITY_INFLECTION' && capexAlone);
  const mat = noEarningsLink || nonOperatingEvent
    ? { level: 'UNKNOWN' as Materiality, note: 'Not applicable: no earnings link is established, so size against the company is not judged.', ratioText: null as string | null, base: null as string | null }
    : materialityOf({ amounts, capitalEvent, termQuarters: term ? term.quarters : null, ctx: input.companyContext });
  const catalystMateriality = mat.level;
  const primaryVar = changes[0] || 'earnings';
  const counterfactual = noEarningsLink || nonOperatingEvent ? null : {
    without: `Without this event the company's earnings path is unchanged: no change in ${joinList(changes.slice(0, 3)) || 'revenue, margin or cash'} comes from it.`,
    withSuccess: mat.ratioText ? `If it plays out as stated, ${primaryVar} could change by roughly ${mat.ratioText}.${mat.level === 'LOW' ? ' That is economically hard to tell apart from no event.' : ''}` : `If it plays out, ${primaryVar} could change, but its size against the company is not established.`,
  };

  const anchor = quantInText || qualDet || bottleneckDet || capacityConfirmed || contractOfftake || earnNumbers || resultFin || marketShareDet || pricingDet || regDemandDet || (newProductDet && RE.newProduct.test(text)) || growthInvest;
  const mechanismSpecific = !noEarningsLink && !nonOperatingEvent && kind !== 'OTHER' && !capexAlone && (kind === 'SPECIAL_SITUATION' ? durableSS : anchor);
  const subject = input.company && input.company !== 'Unnamed company' ? input.company : 'the company';
  const oneSentenceMechanism = ((): string | null => {
    if (noEarningsLink) return null;
    const X: Partial<Record<CatalystKind, [string, string, string]>> = {
      CUSTOMER_QUALIFICATION: ['the qualification turns into production shipments', 'volume and revenue', bottleneckDet ? 'few suppliers are qualified and lead times are long' : 'qualified suppliers are slow to be replaced'],
      CAPACITY_INFLECTION: capexAlone ? ['the new capacity is commissioned and filled', 'volume and revenue', 'demand for it is not yet shown'] : ['the new capacity is commissioned and filled', 'volume, revenue and utilisation', 'customer demand or a contract already covers it'],
      BOTTLENECK: ['supply stays short', 'price and margin', 'few suppliers can deliver'],
      DEMAND_EXPLOSION: ['the orders convert into billing', 'volume and revenue', 'the backlog is contracted'],
      SUPPLY_DEMAND_INFLECTION: ['the price or supply shift holds', 'realised price and margin', 'supply is tightening or demand is rising'],
      PRICING_POWER_INFLECTION: ['the price rise sticks', 'realised price and margin', 'customers accept the pass-through'],
      MARGIN_INFLECTION: ['the margin gain holds', 'EBITDA', 'mix, price or operating leverage is improving'],
      FCF_INFLECTION: ['cash conversion holds', 'free cash flow', 'working capital or capex needs are falling'],
      MARKET_SHARE_INFLECTION: ['the share gains continue', 'revenue and volume', 'the company is winning business from rivals'],
      REGULATORY_DEMAND_INFLECTION: ['the rule is enforced', 'volume and revenue', 'it forces customers to buy or switch'],
      NEW_PRODUCT_MARKET: growthInvest ? ['the acquired or funded business grows and gains distribution', 'segment revenue and mix', 'the money widens the product range'] : ['the product launches and is adopted', 'revenue and mix', 'it widens the addressable market'],
      OPERATING_INFLECTION: ['margin and growth hold in the next results', 'earnings', 'operating leverage is showing'],
      EARNINGS_RESULT: ['revenue and margin hold for further quarters', 'earnings', 'the reported results already show the trend'],
      CONTRACT_ORDER: ['the order is delivered and billed', 'revenue and volume', 'the contract is awarded'],
      CAPITAL_RAISE: ['the money is received and deployed', 'cash and share count', 'investors pay the issue price'],
      FINANCING: ['the money is received and deployed', 'the balance sheet and interest cost', 'new debt is drawn'],
      LEGAL_DECISION: ['the ruling stands', 'the penalty or restriction', 'the tribunal has decided'],
      REGULATORY_DECISION: ['the decision stands', 'the penalty, permission or rule', 'the regulator has decided'],
    };
    const t = X[kind];
    if (kind === 'SPECIAL_SITUATION') {
      const lab = subKind ? KIND_LABEL[subKind].toLowerCase() : 'deal';
      if (durableSS) return `If the ${lab} completes, ${changes[0] || 'earnings power'} should change because the text states the business contribution (${clip(durableSSm ? durableSSm[0] : 'see source', 60)}).`;
      return `If the ${lab} completes, ${ss === 'BUYBACK' ? 'the share count' : 'the ownership or structure'} changes because it is a corporate action; the source states no change to earnings power.`;
    }
    if (!t) return null;
    const tail = kind === 'CAPITAL_RAISE' || kind === 'FINANCING' ? (useOfProceeds ? ' The use of proceeds is named in the source.' : ' The source does not say what the money is for, so the earnings effect is not established.') : (kind === 'LEGAL_DECISION' || kind === 'REGULATORY_DECISION') ? ' The source states no revenue or margin effect.' : '';
    return `If ${t[0]}, ${t[1]} should change because ${t[2]}.${tail}`;
  })();

  // ── research priority ──
  let p = 0;
  const durStated4 = duration.basis === 'stated' && dCode != null && dCode >= 4;
  const evGood = evStatus === 'CONFIRMED' || evStatus === 'STRONG';
  const inflStrong = ['CONFIRMED_INFLECTION', 'ACCELERATING_INFLECTION', 'STRUCTURAL_INFLECTION'].includes(inflection.state);
  if (noEarningsLink || evStatus === 'DISPROVED' || link === 'NARRATIVE_ONLY' || link === 'NOT_ESTABLISHED') p = 0;
  else if (bucket === 'SPECIAL_SITUATION') p = evGood && (ss === 'SPIN' || ss === 'MA' || ss === 'RESTRUCTURING') ? 1 : 0;
  else if (durStated4 && linkGood && evGood) p = 3;
  else if (linkGood && evOK && ((dCode != null && dCode >= 3) || (kind === 'EARNINGS_RESULT' && inflStrong))) p = 2;
  else if (linkGood && evOK) p = 1;
  else if (link === 'INDIRECT' && evOK) p = 1;
  else if (linkGood && evStatus === 'HYPOTHESIS') p = 1;
  else p = 0;
  const capReasons: string[] = [];
  const whyNot: string[] = [];
  if (!noEarningsLink && evStatus === 'HYPOTHESIS') { if (p > 1) p = 1; capReasons.push('the evidence is only a hypothesis'); }
  if (governance.status === 'FLAGGED') { if (p > 1) p = 1; capReasons.push(`governance is flagged (${joinList(governance.flags.slice(0, 2))})`); }
  if (capexAlone) { if (p > 1) p = 1; capReasons.push('capex without a demand link'); }
  if (link === 'INDIRECT' && p > 1) p = 1;
  if (!noEarningsLink && p === 1 && linkGood && evGood && STRUCTURAL_KINDS.has(kind) && (mat.level === 'HIGH' || mat.level === 'VERY_HIGH') && governance.status !== 'FLAGGED') p = 2;
  if (!noEarningsLink && p > 0 && mat.level === 'LOW') { p = 0; capReasons.push('the event is economically hard to tell apart from no event against the size of the company'); }
  else if (!noEarningsLink && p > 2 && mat.level === 'MODERATE') { p = 2; capReasons.push('the event is only moderate against the size of the company'); }
  if (p === 3 && earningsImpactStatus === 'CONFIRMED') { p = 2; capReasons.push('the earnings effect is already reported, so little transmission is left to prove'); }

  // draft item, then integrity
  const dates = ((): Pick<RadarItem, 'firstDiscovered' | 'firstPrimaryConfirmation' | 'firstFinancialConfirmation' | 'firstMaterialEarningsImpact'> => {
    const prev = input.previous || null;
    const primaryNow = directPrimary && !noEarningsLink && evStatus !== 'DISPROVED' && !tentative;
    const finNow = !noEarningsLink && (chainOf('REVENUE').status === 'PROVEN' || chainOf('EARNINGS').status === 'PROVEN');
    const matNow = finNow && chainOf('EARNINGS').status === 'PROVEN' && (mat.level === 'HIGH' || mat.level === 'VERY_HIGH');
    return {
      firstDiscovered: prev?.firstDiscovered ?? pub,
      firstPrimaryConfirmation: prev?.firstPrimaryConfirmation ?? (primaryNow ? pub : null),
      firstFinancialConfirmation: prev?.firstFinancialConfirmation ?? (finNow ? pub : null),
      firstMaterialEarningsImpact: prev?.firstMaterialEarningsImpact ?? (matNow ? pub : null),
    };
  })();

  // maturity, progression
  const finVisible = !noEarningsLink && (chainOf('REVENUE').status === 'PROVEN' || chainOf('EARNINGS').status === 'PROVEN');
  const commercialNow = !noEarningsLink && !nonOperatingEvent && (chainOf('VOLUME').status === 'PROVEN' || chainOf('VOLUME').status === 'PARTIALLY_PROVEN' || chainOf('REVENUE').status === 'PARTIALLY_PROVEN' || (link === 'DIRECT' && evGood && (isOrderOther || kind === 'CUSTOMER_QUALIFICATION')));
  const maturity: CatalystMaturity | null = ((): CatalystMaturity | null => {
    if (kind === 'CORPORATE_ACTION' || kind === 'PRICE_MOVE' || kind === 'ANALYST_CHANGE' || kind === 'DISPROVED_RUMOUR') return kind === 'DISPROVED_RUMOUR' ? null : null;
    if (kind === 'MEDIA_NARRATIVE' || kind === 'SECTOR_COMMENTARY' || noiseKind) return 'DISCOVERY';
    if (evStatus === 'DISPROVED' || catalystChain.some((l) => l.status === 'CONTRADICTED')) return 'BROKEN';
    if (nonOperatingEvent) return evLinkStatus === 'PROVEN' ? 'VALIDATED' : 'DISCOVERY';
    if (listingDone && kind === 'SPECIAL_SITUATION') return mechLinks.some((l) => l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN') ? 'DEVELOPING' : 'VALIDATED';
    if (finVisible && (inflection.state === 'STRUCTURAL_INFLECTION')) return 'MATURE';
    if (finVisible && (inflection.state === 'ACCELERATING_INFLECTION' || inflection.state === 'CONFIRMED_INFLECTION')) return 'ACCELERATING';
    if (finVisible) return 'CONFIRMED';
    if (commercialNow && (quantInText || unitsM.length)) return 'FINANCIALLY_VISIBLE';
    if (mechLinks.some((l) => l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN') && evLinkStatus !== 'ASSUMED') return 'DEVELOPING';
    if (evLinkStatus === 'PROVEN' || evLinkStatus === 'PARTIALLY_PROVEN') return 'VALIDATED';
    return 'DISCOVERY';
  })();
  const indicator = indicatorOf(ctext, kind, noEarningsLink || nonOperatingEvent);

  const resolved = !!input.previous && kind === 'SPECIAL_SITUATION' && /\b(?:completed|completes|completion|closed|closing completed|listed|listing completed|allotted|effective from)\b/i.test(text);
  const evidenceDelta = evidenceDeltaOf({ prev: input.previous, evidence: evStatus, chain: catalystChain, resolved, primaryConfirmed: directPrimary, commercialConfirmed: commercialNow, financiallyVisible: finVisible, sourceCount: nSrc });

  // evidence read
  const unproven = weakestUnprovenLink || CHAIN_NAMES[8].toLowerCase();
  const weakLinkIdx = ((): number => {
    const order = kind === 'BOTTLENECK' ? [3, 4, 5, 8] : kind === 'CUSTOMER_QUALIFICATION' ? [4, 5, 8] : kind === 'CAPACITY_INFLECTION' ? [1, 5, 8] : [5, 8];
    for (const i of order) if (chain[i].status !== 'proven') return i;
    return 8;
  })();
  const unprovenOld = CHAIN_NAMES[weakLinkIdx].toLowerCase();
  const dupNote = src0.duplicates > 0 ? ` (${src0.duplicates} syndicated or near-identical ${src0.duplicates === 1 ? 'copy was' : 'copies were'} removed)` : '';
  const why = ((): string => {
    if (evStatus === 'DISPROVED') return kind === 'DISPROVED_RUMOUR' ? 'The source says the report was denied or untrue. There is no event to confirm.' : `The source says the event was cancelled, withdrawn or rejected ("${clip(disprovedQuote || '', 60)}"). Nothing further is proven.`;
    if (kind === 'CORPORATE_ACTION') return `${src.label}${src.rank ? ` (rank ${src.rank})` : ''} reports the corporate action. It has no earnings mechanism, so there is no thesis to confirm.`;
    if (noiseKind) return 'No earnings-relevant event is stated, so there is nothing to confirm.';
    if (evStatus === 'HYPOTHESIS') {
      const what = socialAnalyst ? `${src.label} is a social or analyst source: it can point to an idea but never proves one` : `${src.label} is a single unverified source${dupNote}`;
      return `${what}. Proven: nothing yet. Unproven: the event itself and the ${unprovenOld} link.`;
    }
    if (evStatus === 'CONFIRMED') return `${src.label}${src.rank ? ` (rank ${src.rank})` : ''} states the event directly. Proven: the event. Unproven: the ${nonOperatingEvent ? 'earnings' : unprovenOld} link${capexAlone ? ' - capex without a demand link' : ''}.`;
    if (evStatus === 'STRONG') return `${nSrc} distinct ${src0.hasPrimary ? 'sources' : 'outlets'} report it${dupNote}${src0.hasPrimary ? '' : '; none is a primary source, so this is reported, not confirmed'}${tentative ? ', and the event is described as planned or proposed' : ''}. Proven: the event is reported. Unproven: the ${unprovenOld} link.`;
    return `Evidence exists (${src.label}${src.rank ? `, rank ${src.rank}` : ''})${tentative ? ' but the event is described as planned or proposed' : ''}${capexAlone ? ', and the demand behind the capex is not stated' : ''}. Financial impact is not yet visible; the ${unprovenOld} link is unproven.`;
  })();
  const evidence: EvidenceRead = {
    status: evStatus, sourceRank: src.rank, sourceLabel: src.label, why, independentSources: nSrc,
    sourceCount: src0.count, sourceQuality: src0.quality, sourceDiversity: src0.diversity, duplicatesRemoved: src0.duplicates,
  };

  // draft
  const publishedAt = pub;
  const hasFeedHints = !!(input.eventType || input.feedTier || input.feedFacts);
  const financialTransmission: LinkStrength = link;
  const draft: RadarItem = {
    id: input.id,
    ticker: input.ticker && input.ticker.trim() ? input.ticker.trim() : null,
    company: cleanCompanyName(input.company, input.ticker && input.ticker.trim() ? input.ticker.trim() : null),
    region: input.region,
    bucket, kind,
    event: clip(title || sentencesOf(desc)[0] || 'Not stated', 280),
    whyItMatters, changes, mechanism, financialImpact, duration, evidence, link,
    inflection: inflection.state, regimeNote: inflection.note, chain, provenThrough, bottleneckQuestion, proof, breakConditions,
    expectations, valuationContext, technical: technicalNote(input.technical), governance, drivers,
    priority: noEarningsLink ? 'EXCLUDE' : P_FROM[p], priorityReason: '',
    lowSignal: bucket === 'NOISE' || bucket === 'TECHNICAL' || bucket === 'CORPORATE_ACTION' || link === 'NARRATIVE_ONLY' || link === 'NOT_ESTABLISHED',
    sourceUrl: input.url || null, publishedAt, feedEventId: hasFeedHints ? input.id : null,
    eventClass, subKind, secondaryKind,
    structuralBridge: kind === 'SPECIAL_SITUATION' ? { created: durableSS, basis: durableSS && durableSSm ? `The text states: "${clip(durableSSm[0], 80)}"` : null } : undefined,
    catalystChain, eventConfirmation, mechanismStatus, earningsImpactStatus, confirmationLabel, evidenceScope,
    financialTransmission, quantificationStatus, impacts,
    catalystMaturity: maturity, catalystProgression: maturity ? PROGRESSION[maturity] : 0, evidenceDelta, indicator,
    catalystMateriality, materialityNote: mat.note, counterfactual,
    oneSentenceMechanism, mechanismSpecific: noEarningsLink ? undefined : mechanismSpecific,
    weakestUnprovenLink, ...dates, priceResponse,
    historicalAnalogue: input.historicalAnalogue && squash(input.historicalAnalogue)
      ? { label: 'HISTORICAL ANALOGUE', text: clip(squash(input.historicalAnalogue), 400), note: 'Context only. It is not a prediction of what happens here.' } : null,
  };
  const integrity = thesisIntegrityOf(draft);
  if (!noEarningsLink && integrity.action === 'REJECTED') { p = 0; }
  else if (!noEarningsLink && integrity.action === 'DOWNGRADED' && p > 0) { p -= 1; capReasons.push(`an integrity check failed (${joinList(integrity.failedChecks.slice(0, 2).map((x) => x.why.replace(/\.$/, '').toLowerCase()))})`); }
  let priority: ResearchPriority = noEarningsLink ? 'EXCLUDE' : P_FROM[Math.max(0, p)];
  if (!noEarningsLink && integrity.action === 'REJECTED') priority = 'LOW';

  // why not higher, triggers
  if (priority !== 'EXCLUDE') {
    if (priority === 'VERY_HIGH') whyNot.push('Already at the highest level.');
    else {
      if (evStatus === 'HYPOTHESIS') whyNot.push('The evidence is only a hypothesis.');
      else if (evStatus === 'DEVELOPING') whyNot.push('The evidence is still developing (planned, or no demand shown).');
      if (link === 'INDIRECT' || link === 'NOT_ESTABLISHED' || link === 'NARRATIVE_ONLY') whyNot.push(`The earnings link is ${link === 'INDIRECT' ? 'indirect' : 'not established'}.`);
      if (duration.code == null) whyNot.push('No duration is stated, so it is not treated as long-lasting.');
      else if (duration.code < 4 && priority !== 'LOW') whyNot.push(`The stated duration is ${duration.label.toLowerCase()}, not structural.`);
      if (mat.level === 'UNKNOWN' && !nonOperatingEvent) whyNot.push('Materiality against the company is unknown (no company size supplied).');
      else if (mat.level === 'LOW' || mat.level === 'MODERATE') whyNot.push(`Materiality is ${mat.level.toLowerCase()}.`);
      if (governance.status === 'FLAGGED') whyNot.push('Governance is flagged.');
      if (capexAlone) whyNot.push('Capex has no demand link yet.');
      if (earningsImpactStatus !== 'CONFIRMED' && link !== 'NOT_ESTABLISHED') whyNot.push(`Earnings transmission is ${earningsImpactStatus === 'PARTIALLY_PROVEN' ? 'only partly proven' : 'unproven'}.`);
      if (integrity.action !== 'NONE') for (const f of integrity.failedChecks) whyNot.push(f.why);
    }
  }
  const upgradeTrigger = noEarningsLink ? null : `Upgrade if: ${proof.what.replace(/\.$/, '')}.`;
  const downgradeTrigger = noEarningsLink ? null : breakConditions.length ? `Downgrade if: ${breakConditions.slice(0, 2).join('; ')}.` : null;

  // priority reason: names the catalyst and the evidence, never a generic sentence
  const priorityReason = ((): string => {
    const evt = clip(title || evSent, 90);
    if (kind === 'CORPORATE_ACTION') return `Corporate action ("${evt}"): it changes share count or cash returned, not operating earnings. Excluded from research priority and kept as low signal.`;
    if (kind === 'DISPROVED_RUMOUR') return `Denied report ("${evt}"): the source says it is untrue, so there is no event and no earnings link. Excluded from research priority.`;
    if (kind === 'PRICE_MOVE' && priceResponse) return `Share-price reaction only ("${clip(priceResponse.text, 70)}"): price is timing context, not a reason the business changed. No measurable link to earnings power.`;
    if (noiseKind) return `No measurable link to earnings power: ${noiseReason}. Shown greyed as low signal.`;
    if (evStatus === 'DISPROVED') return `The source says the event was cancelled, withdrawn or rejected ("${clip(disprovedQuote || '', 40)}"), so "${evt}" is kept only as a record.`;
    if (kind === 'CAPITAL_RAISE' || kind === 'FINANCING' || kind === 'LEGAL_DECISION' || kind === 'REGULATORY_DECISION') {
      const what = kind === 'CAPITAL_RAISE' ? 'Capital raise / funding' : kind === 'FINANCING' ? 'Debt financing' : kind === 'LEGAL_DECISION' ? 'Legal decision' : 'Regulatory decision';
      return `${what} ("${evt}"): ${EVIDENCE_LABEL[evStatus].toLowerCase()} evidence for the event, but the earnings link is ${link === 'INDIRECT' ? 'indirect, through the stated use of the money or the stated operating effect' : 'not established'}. ${kind === 'CAPITAL_RAISE' || kind === 'FINANCING' ? 'Next: use of proceeds and deployment.' : 'Next: the company\'s own statement of the operating effect.'}${capReasons.length ? ` Held at ${PRIORITY_LABEL[priority].toLowerCase()}: ${joinList(capReasons)}.` : ''}`;
    }
    const feats: string[] = [];
    if (kind === 'SPECIAL_SITUATION') feats.push(subKind ? KIND_LABEL[subKind].toLowerCase() : SS_LABEL[ss || 'OTHER']);
    if (growthInvest) feats.push('investment in an operating business');
    if (qualDet) feats.push('Customer qualification');
    if (bottleneckDet) feats.push('supply bottleneck');
    if (capacityConfirmed) feats.push('capacity expansion');
    else if (capexAlone) feats.push('capex announcement');
    if (demandDet) feats.push('demand surge');
    if (supplyDemandDet && kind === 'SUPPLY_DEMAND_INFLECTION') feats.push('supply-demand shift');
    if (newProductDet && kind === 'NEW_PRODUCT_MARKET' && !growthInvest) feats.push('new product / market');
    if (kind === 'MARGIN_INFLECTION') feats.push('margin inflection');
    if (kind === 'FCF_INFLECTION') feats.push('free cash flow inflection');
    if (kind === 'MARKET_SHARE_INFLECTION') feats.push('market share gain');
    if (kind === 'PRICING_POWER_INFLECTION') feats.push('pricing power');
    if (kind === 'REGULATORY_DEMAND_INFLECTION') feats.push('regulation-driven demand');
    if (orderLike && (kind === 'CUSTOMER_QUALIFICATION' || isOrderOther || kind === 'DEMAND_EXPLOSION')) feats.push('order / contract');
    if (kind === 'EARNINGS_RESULT') feats.push('reported results');
    if (kind === 'OPERATING_INFLECTION') feats.push('operating inflection');
    let head = feats.length ? cap1(feats.join(' + ')) : cap1(KIND_LABEL[kind].toLowerCase());
    if (duration.basis === 'stated' && term && term.code > 0) head += ` + ${clip(term.quote.toLowerCase(), 30)} term`;
    const descr = `${LINK_LABEL[link].split(' - ')[0].toLowerCase()} link, ${EVIDENCE_LABEL[evStatus].toLowerCase()} evidence, duration ${dCode == null ? 'not established' : duration.label.toLowerCase()}`;
    const evClause = `Evidence: ${src.label} reports "${clip(evt, 80)}".`;
    const wk = weakestUnprovenLink ? ` Weakest unproven link: ${weakestUnprovenLink}.` : '';
    const tail = kind === 'EARNINGS_RESULT' && earnNumbers
      ? `Reported results are supplied (${INFLECTION_LABEL[inflection.state].toLowerCase()}).`
      : 'Revenue impact not yet visible in reported earnings.';
    const govTail = governance.status === 'NOT_CHECKED' && p >= 2 ? ' Governance not checked yet.' : '';
    const capTail = capReasons.length ? ` Capped at ${PRIORITY_LABEL[priority === 'EXCLUDE' ? 'LOW' : priority].toLowerCase()}: ${joinList(capReasons)}.` : '';
    return `${head}: ${descr}. ${evClause}${wk} ${tail}${govTail}${capTail}`.replace(/\s+/g, ' ').trim();
  })();

  // false-positive reason, ledger eligibility
  const fpReason = ((): FalsePositiveReason | null => {
    if (quar) return quar.fp;
    if (kind === 'CORPORATE_ACTION') return 'CORPORATE_ACTION_ONLY';
    if (kind === 'PRICE_MOVE') return 'PRICE_ONLY';
    if (kind === 'MEDIA_NARRATIVE' || kind === 'SECTOR_COMMENTARY' || kind === 'ANALYST_CHANGE') return 'NARRATIVE_ONLY';
    if (kind === 'DISPROVED_RUMOUR' || evStatus === 'DISPROVED') return 'THESIS_CONTRADICTED';
    if (integrity.action === 'REJECTED') return integrity.failedChecks.some((x) => x.code === 'KIND_MISMATCHED_TO_EVENT') ? 'WRONG_CLASSIFICATION' : 'NO_EARNINGS_TRANSMISSION';
    if (noiseKind) return 'NARRATIVE_ONLY';
    if (src0.duplicates > 0 && src0.distinct < 2 && evStatus === 'HYPOTHESIS') return 'DUPLICATED_SOURCE';
    if (link === 'NOT_ESTABLISHED' || link === 'NARRATIVE_ONLY') return 'NO_EARNINGS_TRANSMISSION';
    if (mat.level === 'LOW') return 'IMMATERIAL';
    if (evStatus === 'HYPOTHESIS') return 'INSUFFICIENT_EVIDENCE';
    if (integrity.failedChecks.some((x) => x.code === 'DURATION_INFERRED_WITHOUT_DISCLOSURE')) return 'DURATION_UNSUPPORTED';
    return null;
  })();
  const ledgerBlockers: string[] = [];
  const strategicStructural = (bucket === 'MULTIBAGGER' || bucket === 'BOTTLENECK') && evOK && (link === 'INDIRECT' || linkGood);
  if (!input.company || input.company === 'Unnamed company') ledgerBlockers.push('No company is named.');
  if (quar) ledgerBlockers.push(`Quarantined: ${quar.noise}.`);
  if (proposedOnly) ledgerBlockers.push('The event is proposed, not approved or delivered.');
  if (noEarningsLink || kind === 'OTHER' || nonOperatingEvent || kind === 'SPECIAL_SITUATION' && !durableSS) ledgerBlockers.push('The event is not an earnings catalyst.');
  if (!(evStatus === 'CONFIRMED' || evStatus === 'STRONG' || evStatus === 'DEVELOPING')) ledgerBlockers.push('Evidence is not yet at developing or better.');
  if (!mechanismSpecific) ledgerBlockers.push('No company-specific mechanism.');
  if (!(linkGood || strategicStructural)) ledgerBlockers.push('The earnings link is below near-direct and the catalyst is not strategically structural.');
  if (!proof.what || /^monitor\b/i.test(proof.what) || noEarningsLink) ledgerBlockers.push('No clear next proof.');
  if (evStatus === 'DISPROVED' || integrity.failedChecks.some((x) => x.code === 'LINK_CONTRADICTS_MECHANISM' || x.code === 'KIND_MISMATCHED_TO_EVENT' || x.code === 'PRICE_USED_AS_EARNINGS_EVIDENCE') || catalystChain.some((l) => l.status === 'CONTRADICTED')) ledgerBlockers.push('The evidence contradicts the thesis or the classification failed a check.');
  const ledgerEligible = ledgerBlockers.length === 0 && bucket !== 'CORPORATE_ACTION' && bucket !== 'NOISE' && bucket !== 'TECHNICAL';

  const item: RadarItem = {
    ...draft,
    priority, priorityReason,
    whyNotHigher: whyNot, upgradeTrigger, downgradeTrigger,
    thesisIntegrity: integrity, falsePositiveReason: fpReason, quarantineReason: quar ? quar.reason : null, ledgerEligible, ledgerBlockers,
  };
  return item;
}

// ─────────────────────────── shared drivers ───────────────────────────

export interface DriverEntry { ticker: string | null; company?: string; drivers: string[]; isHolding?: boolean }

export function sharedDriversOf(entries: DriverEntry[], opts?: { holdings?: string[] }): SharedDriverGroup[] {
  const holdings = new Set((opts?.holdings || []).map((h) => h.trim().toUpperCase()).filter(Boolean));
  const keyOf = (e: DriverEntry) => (e.ticker && e.ticker.trim() ? e.ticker.trim() : (e.company || '').trim());
  const isHold = (e: DriverEntry) => e.isHolding === true || (!!e.ticker && holdings.has(e.ticker.trim().toUpperCase()));
  // driver tag -> set of keys
  const byTag = new Map<string, Set<string>>();
  const holdKeys = new Set<string>();
  for (const e of entries) {
    const k = keyOf(e);
    if (!k) continue;
    if (isHold(e)) holdKeys.add(k);
    for (const d of e.drivers || []) {
      const tag = AI_UMBRELLA.includes(d) ? 'AI infrastructure' : d;
      if (!byTag.has(tag)) byTag.set(tag, new Set());
      byTag.get(tag)!.add(k);
    }
  }
  const groups: SharedDriverGroup[] = [];
  byTag.forEach((set, tag) => {
    if (set.size < 2) return;
    const tickers = Array.from(set).sort();
    const nh = tickers.filter((t) => holdKeys.has(t)).length;
    let note = `${joinList(tickers)} share ${/^[AEIOU]/i.test(tag) ? 'an' : 'a'} ${tag} demand driver.`;
    if (tag === 'AI infrastructure') {
      const subs = new Map<string, string[]>();
      for (const e of entries) {
        const k = keyOf(e);
        for (const d of e.drivers || []) if (AI_UMBRELLA.includes(d)) { if (!subs.has(d)) subs.set(d, []); if (!subs.get(d)!.includes(k)) subs.get(d)!.push(k); }
      }
      const parts = Array.from(subs.entries()).map(([d, ks]) => `${joinList(ks.sort())} via ${d.toLowerCase()}`);
      if (subs.size > 1 || (subs.size === 1 && !subs.has('AI infrastructure'))) note += ` Links: ${parts.join('; ')}. The chain runs AI build-out to data centres to power, cooling and electrical equipment, so these can fall together.`;
    }
    if (nh > 0) note += ` ${nh} of ${tickers.length} ${nh === 1 ? 'is a holding' : 'are holdings'}.`;
    groups.push({ driver: tag, tickers, note });
  });
  groups.sort((a, b) => b.tickers.length - a.tickers.length || a.driver.localeCompare(b.driver));
  return groups;
}

// ─────────────────────────── buildRadar ───────────────────────────

function recencyKey(i: RadarInput | undefined, item: RadarItem, now: number): number {
  const ms = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
  if (Number.isFinite(ms)) return ms;
  if (i && isNum(i.ageHours)) return now - i.ageHours * 3600_000;
  return -Infinity;
}

export function buildRadar(inputs: RadarInput[], opts?: RadarOptions): RadarResult {
  const now = isNum(opts?.now) ? (opts!.now as number) : Date.now();
  const holdings = new Set((opts?.holdings || []).map((h) => h.trim().toUpperCase()).filter(Boolean));
  const analysedAll = (inputs || []).map((inp) => ({ inp, item: analyseRadarItem(inp) }));
  // Merge near-duplicate syndicated copies of one event (same company and kind, near-identical headline).
  const tok = (t: string) => new Set((t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1));
  const jac = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; a.forEach((w) => { if (b.has(w)) n += 1; }); return n / (a.size + b.size - n); };
  const analysed: typeof analysedAll = [];
  const toks: Set<string>[] = [];
  let duplicatesMerged = 0;
  const DEAL = new Set<CatalystKind>(['SPECIAL_SITUATION', 'NEW_PRODUCT_MARKET', 'FINANCING', 'CAPITAL_RAISE']);
  const ents = (x: { inp: RadarInput; item: RadarItem }) => entityTokens(x.inp.title || x.item.event);
  const keys = (x: { inp: RadarInput; item: RadarItem }) => keyNumbers(x.inp.title || x.item.event);
  const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; a.forEach((w) => { if (b.has(w)) n += 1; }); return n; };
  /** Same deal seen twice: the same kind and subtype, the same named entities and at least one shared deal number (a swap ratio or an amount). */
  const sameDeal = (a: { inp: RadarInput; item: RadarItem }, b: { inp: RadarInput; item: RadarItem }): boolean => {
    if (a.item.quarantineReason || b.item.quarantineReason) return false;
    if (a.item.kind !== b.item.kind || (a.item.subKind || null) !== (b.item.subKind || null) || !DEAL.has(a.item.kind)) return false;
    const ka = keys(a), kb = keys(b);
    if (!overlap(ka, kb)) return false;
    return overlap(ents(a), ents(b)) >= 2;
  };
  const mergeSources = (a: RadarInput, b: RadarInput): RadarSourceInput[] => {
    const all: RadarSourceInput[] = [
      { label: a.sourceLabel, url: a.url, title: a.title, publishedAt: a.publishedAt, primary: a.primarySource }, ...(a.sources || []),
      { label: b.sourceLabel, url: b.url, title: b.title, publishedAt: b.publishedAt, primary: b.primarySource }, ...(b.sources || []),
    ];
    // one entry per publisher family (the primary / first-seen copy wins): syndicated copies never count twice
    const seen = new Map<string, RadarSourceInput>();
    for (const x of all) {
      const fam = x.label ? publisherFamily(x.label) : `t:${squash(x.title || '').toLowerCase()}`;
      const cur = seen.get(fam);
      if (!cur || (x.primary && !cur.primary)) seen.set(fam, x);
    }
    return Array.from(seen.values());
  };
  for (const cur of analysedAll) {
    const ct = tok(cur.inp.title || cur.item.event);
    const tk = (cur.item.ticker || cur.item.company || '').toUpperCase();
    let at = tk ? analysed.findIndex((x, ix) => (x.item.ticker || x.item.company || '').toUpperCase() === tk && x.item.kind === cur.item.kind && jac(toks[ix], ct) >= 0.8) : -1;
    let viaDeal = false;
    if (at < 0) { at = analysed.findIndex((x) => sameDeal(x, cur)); viaDeal = at >= 0; }
    if (at < 0) { analysed.push(cur); toks.push(ct); continue; }
    duplicatesMerged += 1;
    const keep = analysed[at];
    const curWins = P_NUM[cur.item.priority] > P_NUM[keep.item.priority] || (P_NUM[cur.item.priority] === P_NUM[keep.item.priority] && EV_ORDER[cur.item.evidence.status] < EV_ORDER[keep.item.evidence.status]) || (viaDeal && P_NUM[cur.item.priority] === P_NUM[keep.item.priority] && EV_ORDER[cur.item.evidence.status] === EV_ORDER[keep.item.evidence.status] && (cur.item.evidence.sourceRank ?? 99) < (keep.item.evidence.sourceRank ?? 99));
    const win = curWins ? cur : keep;
    const lose = curWins ? keep : cur;
    if (viaDeal) {
      // the same deal from two outlets: re-read the kept card once, with both source lists merged by publisher family
      const mergedInput: RadarInput = { ...win.inp, sources: mergeSources(win.inp, lose.inp), independentSources: undefined };
      analysed[at] = { inp: mergedInput, item: analyseRadarItem(mergedInput) };
    } else if (curWins) analysed[at] = cur;
  }
  const byBucket = {} as Record<RadarBucket, RadarItem[]>;
  BUCKET_ORDER.forEach((b) => { byBucket[b] = []; });
  const cmp = (a: { inp: RadarInput; item: RadarItem }, b: { inp: RadarInput; item: RadarItem }) =>
    P_NUM[b.item.priority] - P_NUM[a.item.priority]
    || EV_ORDER[a.item.evidence.status] - EV_ORDER[b.item.evidence.status]
    || (b.item.duration.code ?? -1) - (a.item.duration.code ?? -1)
    || (recencyKey(b.inp, b.item, now) === recencyKey(a.inp, a.item, now) ? 0 : recencyKey(b.inp, b.item, now) > recencyKey(a.inp, a.item, now) ? 1 : -1)
    || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);
  const sorted = analysed.slice().sort(cmp);
  for (const { item } of sorted) byBucket[item.bucket].push(item);
  const items = BUCKET_ORDER.flatMap((b) => byBucket[b]);
  const usable = items.filter((i) => i.bucket !== 'NOISE' && i.bucket !== 'TECHNICAL' && i.bucket !== 'CORPORATE_ACTION');
  const sharedDrivers = sharedDriversOf(usable.map((i) => ({ ticker: i.ticker, company: i.company, drivers: i.drivers })), { holdings: Array.from(holdings) });
  const counts: RadarCounts = {
    total: items.length,
    byBucket: {} as Record<RadarBucket, number>,
    byPriority: { VERY_HIGH: 0, HIGH: 0, MEDIUM: 0, LOW: 0, EXCLUDE: 0 },
    lowSignal: 0,
    holdings: 0,
    duplicatesMerged,
    quarantined: 0,
    quarantineByReason: {},
    specialSituations: 0,
  };
  BUCKET_ORDER.forEach((b) => { counts.byBucket[b] = byBucket[b].length; });
  for (const i of items) {
    counts.byPriority[i.priority] += 1;
    if (i.lowSignal) counts.lowSignal += 1;
    if (i.quarantineReason) { counts.quarantined = (counts.quarantined || 0) + 1; counts.quarantineByReason![i.quarantineReason] = (counts.quarantineByReason![i.quarantineReason] || 0) + 1; }
    else if (i.bucket === 'SPECIAL_SITUATION') counts.specialSituations = (counts.specialSituations || 0) + 1;
    if (i.ticker && holdings.has(i.ticker.toUpperCase())) counts.holdings += 1;
  }
  return { items, byBucket, sharedDrivers, counts };
}

// ─────────────────────────── portfolio monitor ───────────────────────────

const isRadarItem = (x: unknown): x is RadarItem => !!x && typeof x === 'object' && 'bucket' in (x as object) && 'chain' in (x as object);
const evWord = (s: string): EvidenceStatus | null => {
  const m = /(confirmed|strong|developing|hypothesis|disproved)/i.exec(s || '');
  return m ? (m[1].toUpperCase() as EvidenceStatus) : null;
};

export function portfolioMonitorOf(entryOrItem: Partial<LedgerEntry> | RadarItem | null | undefined, radarItem?: RadarItem | null): MonitorAnswers {
  let item: RadarItem | null = radarItem ?? null;
  let entry: Partial<LedgerEntry> | null = null;
  if (isRadarItem(entryOrItem)) { if (!item) item = entryOrItem; }
  else if (entryOrItem) entry = entryOrItem as Partial<LedgerEntry>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? squash(v) : '');

  // 1 catalyst progressed
  let q1 = NE;
  if (item && item.bucket !== 'NOISE' && item.bucket !== 'TECHNICAL') {
    const orig = str(entry?.catalyst);
    q1 = `${orig ? `Original catalyst: ${clip(orig, 140)}. ` : ''}Latest event: ${clip(item.event, 160)} (${KIND_LABEL[item.kind].toLowerCase()}, evidence ${EVIDENCE_LABEL[item.evidence.status].toLowerCase()}).`;
  }
  // 2 evidence strengthened
  let q2 = NE;
  if (item) {
    const prior = evWord(str(entry?.evidence));
    const now = item.evidence.status;
    if (prior) {
      const d = EV_ORDER[prior] - EV_ORDER[now];
      q2 = d > 0 ? `Evidence moved from ${EVIDENCE_LABEL[prior].toLowerCase()} to ${EVIDENCE_LABEL[now].toLowerCase()}: it has strengthened. ${item.evidence.why}`
        : d < 0 ? `Evidence moved from ${EVIDENCE_LABEL[prior].toLowerCase()} to ${EVIDENCE_LABEL[now].toLowerCase()}: it has weakened. ${item.evidence.why}`
          : `Evidence is unchanged at ${EVIDENCE_LABEL[now].toLowerCase()}. ${item.evidence.why}`;
    } else q2 = `Evidence now reads ${EVIDENCE_LABEL[now].toLowerCase()} (${item.evidence.sourceLabel}). ${item.evidence.why} The earlier level is not recorded.`;
  }
  // 3 earnings conversion
  let q3 = NE;
  if (item && item.inflection !== 'NOT_ASSESSED') {
    const through = item.provenThrough >= 0 ? item.chain[item.provenThrough].step.toLowerCase() : null;
    q3 = `Result data reads ${INFLECTION_LABEL[item.inflection].toLowerCase()}. ${item.regimeNote || ''}${through ? ` The chain is proven through ${through}.` : ''}`.replace(/\s+/g, ' ').trim();
  }
  // 4 opportunity increased
  let q4 = NE;
  if (item && item.changes.some((c) => /addressable market|market share|volume|revenue/.test(c)) && item.bucket !== 'NOISE' && item.bucket !== 'TECHNICAL') {
    q4 = `The latest event can change ${joinList(item.changes)}. Duration reads ${item.duration.label.toLowerCase()} (${item.duration.basis === 'stated' ? 'stated' : item.duration.basis === 'type' ? 'from the type of event only' : 'not established'}).`;
  }
  // 5 bottleneck strengthened
  let q5 = NE;
  if (item && item.bottleneckQuestion && item.chain[2].status === 'proven') q5 = item.chain[2].text;
  // 6 management executed
  let q6 = NE;
  if (item && item.chain[4].status === 'proven') q6 = `Capacity or volume step is proven in the latest source: ${item.chain[4].text}`;
  // 7 customer adoption
  let q7 = NE;
  if (item && (item.kind === 'CUSTOMER_QUALIFICATION' || item.chain[1].status === 'proven') && item.chain[1].status !== 'unknown' && item.evidence.status !== 'HYPOTHESIS') {
    q7 = item.chain[1].status === 'proven' ? item.chain[1].text : `Latest event is a ${KIND_LABEL[item.kind].toLowerCase()}: ${clip(item.event, 140)}`;
  } else if (item && item.kind === 'CUSTOMER_QUALIFICATION') q7 = `Latest event is a customer qualification reported by an unverified source: ${clip(item.event, 140)}`;
  // 8 thesis weakened
  const weak: string[] = [];
  if (entry?.status === 'WEAKENING' || entry?.status === 'BROKEN') weak.push(`Ledger status is ${String(entry.status).toLowerCase()}${str(entry.lastReview) ? ` (last review ${str(entry.lastReview)})` : ''}`);
  if (item?.evidence.status === 'DISPROVED') weak.push('The latest source says the event was cancelled, withdrawn or rejected');
  if (item?.governance.status === 'FLAGGED') weak.push(`Governance flags: ${joinList(item.governance.flags)}`);
  let q8 = NE;
  if (weak.length) q8 = `${weak.join('. ')}.`;
  else if (item && item.bucket !== 'NOISE') q8 = `No weakening signal in the latest read (evidence ${EVIDENCE_LABEL[item.evidence.status].toLowerCase()}). Conditions that would weaken it: ${item.breakConditions.slice(0, 3).join('; ')}.`;
  // 9 valuation ahead of fundamentals
  let q9 = NE;
  if (item && item.expectations.state !== 'NOT_ASSESSED') {
    q9 = item.expectations.state === 'ALREADY_EXPECTED' ? `Yes, expectations look ahead of fundamentals. ${item.expectations.note}`
      : item.expectations.state === 'LOW_EXPECTATIONS' ? `No, expectations look modest against the fundamentals. ${item.expectations.note}`
        : `Not yet visible in results. ${item.expectations.note}`;
  }
  // 10 next proof point
  let q10 = NE;
  if (item && item.bucket !== 'NOISE') q10 = `${item.proof.what}${item.proof.when ? ` (${item.proof.when})` : ''}`;
  else if (str(entry?.nextProofPoint)) q10 = `Ledger next proof point: ${clip(str(entry?.nextProofPoint), 200)}`;

  return {
    originalCatalystProgressed: q1, evidenceStrengthened: q2, earningsConversionBegun: q3, opportunityIncreased: q4,
    bottleneckStrengthened: q5, managementExecuted: q6, customerAdoptionIncreased: q7, thesisWeakened: q8,
    valuationAheadOfFundamentals: q9, nextProofPoint: q10,
  };
}

// ── Thesis monitor (Phase 3) ──────────────────────────────────────────────
// Compares the CURRENT radar read with the ORIGINAL ledger thesis. The status comes from evidenceDelta and
// catalyst-maturity changes only. There is no price input anywhere in this function.

const linkAnswer = (item: RadarItem | null, key: CatalystLinkKey, what: string): string => {
  const l = item?.catalystChain?.find((c) => c.link === key);
  if (!l) return NE;
  if (l.status === 'PROVEN' || l.status === 'PARTIALLY_PROVEN') return `${what} ${l.status === 'PROVEN' ? 'is shown' : 'is partly shown'}${l.evidence ? `: ${clip(squash(l.evidence), 160)}` : ''}.`;
  if (l.status === 'ASSUMED') return `${what} is assumed in the mechanism but not yet shown by a source.`;
  if (l.status === 'CONTRADICTED') return `The latest evidence contradicts ${what.toLowerCase()}.`;
  return NE;
};

export function monitorThesisOf(entry: Partial<LedgerEntry> | null | undefined, radarItem: RadarItem | null | undefined): ThesisMonitor {
  const item = radarItem && isRadarItem(radarItem) ? radarItem : null;
  const e = entry || null;
  const a = portfolioMonitorOf(e, item);
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() && v !== NE ? squash(v) : '');
  const versions = Array.isArray(e?.versions) ? e!.versions! : [];
  const priorMat = [...versions].reverse().map((v) => v.catalystMaturity).find((m): m is CatalystMaturity => !!m) ?? null;
  const nowMat = item?.catalystMaturity ?? null;
  const moved = priorMat && nowMat ? PROGRESSION[nowMat] - PROGRESSION[priorMat] : 0;
  const delta = item?.evidenceDelta;

  let status: ThesisStatus = 'NO_MATERIAL_CHANGE';
  let why = 'No current radar evidence for this thesis, so nothing has changed on the record. Missing data is not a negative.';
  if (item) {
    if (item.evidence.status === 'DISPROVED' || nowMat === 'BROKEN' || delta === 'CONTRADICTED') { status = 'BROKEN'; why = 'The latest evidence contradicts the original catalyst or says it was cancelled.'; }
    else if (delta === 'WEAKENED' || moved < 0) { status = 'WEAKENING'; why = moved < 0 ? `Catalyst maturity moved back from ${priorMat!.toLowerCase().replace(/_/g, ' ')} to ${nowMat!.toLowerCase().replace(/_/g, ' ')}.` : 'The evidence is weaker than at the last read.'; }
    else if (delta === 'FIRST_FINANCIAL_CONFIRMATION' || delta === 'FIRST_COMMERCIAL_CONFIRMATION' || delta === 'STRENGTHENED' || moved > 0) {
      status = 'STRENGTHENING';
      why = delta === 'FIRST_FINANCIAL_CONFIRMATION' ? 'First financial confirmation: results now show the catalyst in the numbers.' : delta === 'FIRST_COMMERCIAL_CONFIRMATION' ? 'First commercial confirmation of the catalyst.' : moved > 0 ? `Catalyst maturity moved up from ${priorMat!.toLowerCase().replace(/_/g, ' ')} to ${nowMat!.toLowerCase().replace(/_/g, ' ')}.` : 'The evidence is stronger than at the last read.';
    } else if (delta === 'RESOLVED') { status = 'INTACT'; why = 'The catalyst event has completed; the original thesis stands.'; }
    else if (delta === 'NEW_EVIDENCE' || delta === 'DEVELOPING') {
      status = nowMat && PROGRESSION[nowMat] >= 4 ? 'INTACT' : 'EARLY';
      why = 'New evidence is arriving but the catalyst is still early.';
      if (status === 'INTACT') why = 'New evidence fits the original thesis and the catalyst is already visible in financials.';
    } else if (delta === 'UNCHANGED') { status = 'NO_MATERIAL_CHANGE'; why = 'The evidence and maturity are unchanged since the last read.'; }
    else { why = 'The radar gives no evidence change to compare, so nothing has changed on the record.'; }
  }

  const orig = clean(e?.thesis);
  const fail = [...(item?.breakConditions || []), ...(clean(e?.whatWouldBreak) ? [clean(e?.whatWouldBreak)] : [])].filter(Boolean);
  const indicator = item?.indicator?.type ? `${item.indicator.type[0] + item.indicator.type.slice(1).toLowerCase()} indicator: ${item.indicator.label}.` : NE;
  const fin = item?.earningsImpactStatus === 'CONFIRMED' || item?.earningsImpactStatus === 'PARTIALLY_PROVEN'
    ? `Earnings impact is ${item.earningsImpactStatus === 'CONFIRMED' ? 'confirmed' : 'partly proven'}. ${a.earningsConversionBegun !== NE ? a.earningsConversionBegun : ''}`.trim()
    : a.earningsConversionBegun;
  return {
    status, statusReason: why, originalThesis: orig || NE,
    originalCatalystProgressed: a.originalCatalystProgressed, leadingIndicators: indicator, financialConversion: fin,
    managementExecution: a.managementExecuted, customerAdoption: a.customerAdoptionIncreased,
    capacity: linkAnswer(item, 'CAPACITY', 'Capacity'), margin: linkAnswer(item, 'MARGIN', 'Margin improvement'), fcf: linkAnswer(item, 'FCF', 'Free cash flow'),
    valuation: a.valuationAheadOfFundamentals,
    failureConditions: fail.length ? Array.from(new Set(fail)).slice(0, 4).join('; ') : NE,
    nextProofPoint: a.nextProofPoint,
  };
}
