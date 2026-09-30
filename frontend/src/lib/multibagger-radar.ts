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
  CatalystKind, ChainStatus, ChainStep, DurationCode, DurationRead, EvidenceRead, EvidenceStatus,
  ExpectationsRead, GovernanceRead, InflectionState, LedgerEntry, LinkStrength, MonitorAnswers,
  ProofPoint, RadarBucket, RadarItem, ResearchPriority, SharedDriverGroup, TechnicalContext,
} from './multibagger-radar-types';

export const RADAR_ENGINE_VERSION = 'zzz841-radar-v1';

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

export interface RadarInput {
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
  feedFacts?: { what_happened?: string; what_matters?: string; what_to_watch?: string; what_breaks_thesis?: string };
}

export interface RadarCounts {
  total: number;
  byBucket: Record<RadarBucket, number>;
  byPriority: Record<ResearchPriority, number>;
  lowSignal: number;
  holdings: number;
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
  durableSS: /(growth business|high[\s-]?growth|unlock\w*|contribut\w+[^.]{0,30}(?:revenue|ebitda|profit|earnings|%)|(?:adds?|adding)[^.]{0,30}(?:capacity|customers?|revenue|ebitda)|capacity of \d|customer base|accretive|synerg\w+[^.]{0,30}\d)/i,
  quantAdd: /\d/,
};

type SsSubtype = 'BUYBACK' | 'OPEN_OFFER' | 'SPIN' | 'MA' | 'RIGHTS' | 'ASSET_SALE' | 'RESTRUCTURING' | 'OTHER';
const SS_RE: Array<[SsSubtype, RegExp]> = [
  ['BUYBACK', /buy[\s-]?back|share repurchase|repurchase (?:of )?(?:shares|stock)/i],
  ['OPEN_OFFER', /open offer|mandatory offer|tender offer|takeover offer|delisting|delist\b|going private|take[\s-]?private|squeeze[\s-]?out|voluntary offer|tender(?:ing)? of shares|merger[\s-]?arb/i],
  ['SPIN', /spin[\s-]?off|demerg\w+|split(?:ting)? (?:into|the company)|carve[\s-]?out|hive[\s-]?off|separation of|separate listing/i],
  ['MA', /\bmerger|amalgamation|acqui(?:re|res|red|ring|sition)|takeover|take over|scheme of arrangement|reverse merger|stake acquisition/i],
  ['RIGHTS', /rights issue|rights entitlement|\bQIP\b|preferential (?:allotment|issue)|\bOFS\b|offer for sale|fund ?raise|capital raise|warrants? (?:conversion|issue)/i],
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
  if ((m = /\b(one[\s-]?time|one[\s-]?off|non[\s-]?recurring|exceptional (?:gain|item|income)|tax (?:benefit|credit|write[\s-]?back|refund)|(?:gain|profit) on (?:sale|disposal)|asset sale|sale of (?:land|asset|property|building|plant)|single order|pilot order|sample order|trial order)\b/i.exec(text))) {
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
const P_NUM: Record<ResearchPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 };
const P_FROM: ResearchPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
const STRUCTURAL_KINDS = new Set<CatalystKind>(['OPERATING_INFLECTION', 'DEMAND_EXPLOSION', 'BOTTLENECK', 'CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'NEW_PRODUCT_MARKET', 'SUPPLY_DEMAND_INFLECTION']);

const CHAIN_NAMES = [
  'Catalyst', 'Customer / market driver', 'Bottleneck', 'Company advantage', 'Capacity / volume', 'Revenue', 'Margin',
  'Free cash flow', 'Earnings', 'Valuation / expectations', 'Potential multi-year re-rating',
];

function matchQuote(re: RegExp, text: string): string | null {
  const m = re.exec(text);
  return m ? squash(m[0]) : null;
}

export function analyseRadarItem(input: RadarInput): RadarItem {
  const title = squash(input.title || '');
  const desc = squash(input.description || '');
  const ff = input.feedFacts || {};
  const text = squash([title, desc, ff.what_happened || '', ff.what_matters || ''].filter(Boolean).join('. '));
  const sents = sentencesOf([title, desc, ff.what_happened || '', ff.what_matters || ''].filter(Boolean).join('. '));
  const e = input.earnings || null;
  const eType = input.eventType || '';

  // ── detectors ──
  const disprovedQuote = matchQuote(RE.disproved, text);
  const disproved = disprovedQuote != null;
  const tentative = RE.tentative.test(text);
  const qualDet = RE.qual.test(text);
  const prodAward = RE.prodAward.test(text);
  const bottleneckDet = RE.bottleneck.test(text);
  const demandDet = RE.demand.test(text);
  const supplyDemandDet = RE.supplyDemand.test(text);
  const newProductDet = RE.newProduct.test(text) || /new product|launch|approval/i.test(eType);
  const operatingDet = RE.operating.test(text);
  const isResult = RE.isResult.test(text) || /result|earnings/i.test(eType);
  const orderLike = RE.orderLike.test(text);
  const capacityIncrease = RE.capacityIncrease.test(text);
  const custDemand = RE.custDemand.test(text);
  const utilisation = RE.utilisation.test(text);
  const contractOfftake = RE.contract.test(text);
  const capexDetected = RE.capexWord.test(text) || capacityIncrease || input.category === 'CAPEX' || /capex|capacity/i.test(eType);
  const capacityConfirmed = capacityIncrease && (custDemand || utilisation || contractOfftake);
  const amounts = text.match(RE.amount) || [];
  const percents = text.match(RE.percent) || [];
  const unitsM = text.match(RE.units) || [];
  const quantInText = amounts.length + percents.length + unitsM.length > 0;
  const earnNumbers = !!e && (isNum(e.revenueYoY) || isNum(e.patYoY) || (isNum(e.marginNow) && isNum(e.marginPrior)) || isNum(e.cfoToPat));
  const concrete = quantInText || RE.concreteVerb.test(text) || earnNumbers || disproved;

  let ss: SsSubtype | null = null;
  for (const [k, re] of SS_RE) if (re.test(text)) { ss = k; break; }
  if (!ss) ss = eventTypeSs(eType, input.category);
  // A capital raise word in a capacity story ("QIP") is still a special situation only when nothing structural is stated.
  const alwaysSS = ss === 'BUYBACK' || ss === 'OPEN_OFFER';
  const durableSS = !alwaysSS && (ss === 'SPIN' || ss === 'MA') && RE.durableSS.test(text) && !disproved;

  const noisePatterns: string[] = [];
  if (RE.analyst.test(text)) noisePatterns.push('analyst rating or price-level change');
  if (RE.priceMove.test(text)) noisePatterns.push('a share-price move');
  if (RE.promo.test(text)) noisePatterns.push('promotional language');
  if (RE.genericAI.test(text)) noisePatterns.push('generic AI narrative');
  if (RE.sector.test(text)) noisePatterns.push('sector commentary without company evidence');
  const technicalText = RE.technical.test(text) || /technical|breakout/i.test(eType);

  const orderOnly = orderLike && concrete && !qualDet && !bottleneckDet && !demandDet && !capexDetected && !ss && !isResult;
  const anyFundamental = !!(ss || qualDet || bottleneckDet || demandDet || supplyDemandDet || newProductDet || capexDetected || operatingDet || orderOnly || (isResult && (earnNumbers || quantInText)));

  // ── duration parse (stated only) ──
  const term = parseDuration(text);

  // ── kind ──
  let kind: CatalystKind = 'OTHER';
  let noiseKind: 'NOISE' | 'TECHNICAL' | null = null;
  let noiseReason = '';
  const narrativeOnly = noisePatterns.length > 0 && !concrete;
  if (!anyFundamental) {
    if (technicalText && !noisePatterns.some((n) => n.startsWith('analyst') || n.startsWith('promotional'))) { noiseKind = 'TECHNICAL'; noiseReason = 'a technical setup with no fundamental event'; }
    else { noiseKind = 'NOISE'; noiseReason = noisePatterns.length ? noisePatterns[0] : 'no event that changes revenue, margin or cash generation'; }
  } else if (narrativeOnly && !ss && !earnNumbers) {
    noiseKind = 'NOISE'; noiseReason = noisePatterns[0];
  }
  const supplyAgreement = orderLike && !!term && term.code >= 3 && /supply|off-?take|agreement|contract/i.test(text);
  if (noiseKind == null) {
    if (ss) kind = 'SPECIAL_SITUATION';
    else if (qualDet) kind = 'CUSTOMER_QUALIFICATION';
    else if (bottleneckDet) kind = 'BOTTLENECK';
    else if (capacityConfirmed) kind = 'CAPACITY_INFLECTION';
    else if (supplyAgreement) kind = 'CUSTOMER_QUALIFICATION';
    else if (demandDet) kind = 'DEMAND_EXPLOSION';
    else if (supplyDemandDet) kind = 'SUPPLY_DEMAND_INFLECTION';
    else if (newProductDet && !(isResult && !RE.newProduct.test(text))) kind = 'NEW_PRODUCT_MARKET';
    else if (capexDetected) kind = 'CAPACITY_INFLECTION';
    else if (isResult) kind = 'EARNINGS_RESULT';
    else if (operatingDet) kind = 'OPERATING_INFLECTION';
    else kind = 'OTHER';
  }
  const capexAlone = kind === 'CAPACITY_INFLECTION' && !capacityConfirmed;
  const isOrderOther = kind === 'OTHER' && orderOnly;

  // ── duration ──
  const duration = ((): DurationRead => {
    if (noiseKind || (kind === 'OTHER' && !isOrderOther && !term)) {
      return { code: null, label: NE, basis: 'none', evidence: 'Not established - the source states no term and the type of event does not imply one.' };
    }
    if (term) {
      let code: DurationCode = term.code;
      if (code >= 4 && kind !== 'OTHER' && RE.transformational.test(text) && RE.capability.test(text) && RE.traction.test(text)) code = 5;
      // a one-time item in an asset-sale / accounting context stays 0; otherwise the stated term stands
      return { code, label: DURATION_LABEL[code], basis: 'stated', evidence: `Stated in the source: "${clip(term.quote, 60)}" (${term.words}).` };
    }
    // type only, capped at 3
    let code: DurationCode | null = null;
    if (kind === 'EARNINGS_RESULT') {
      const q = e && isNum(e.quarters) ? e.quarters : 0;
      if (q >= 2) {
        code = q >= 4 ? 3 : 2;
        return { code, label: DURATION_LABEL[code], basis: 'type', evidence: `Supplied results support the picture for ${fmt(q)} quarters. The source states no forward term, so this is based on the type of event only.` };
      }
      code = 1;
    } else if (kind === 'SPECIAL_SITUATION') {
      code = ss === 'BUYBACK' || ss === 'ASSET_SALE' || ss === 'RIGHTS' ? 0 : ss === 'OPEN_OFFER' || ss === 'OTHER' ? 1 : ss === 'RESTRUCTURING' ? 2 : 3;
    } else if (kind === 'OTHER') code = null;
    else if (capexAlone) code = 2;
    else if (kind === 'CAPACITY_INFLECTION' || kind === 'BOTTLENECK' || kind === 'CUSTOMER_QUALIFICATION') code = 3;
    else code = 2;
    if (code == null) return { code: null, label: NE, basis: 'none', evidence: 'Not established - the source states no term.' };
    return { code, label: DURATION_LABEL[code], basis: 'type', evidence: `Not stated in the source. Based only on the type of event (${KIND_LABEL[kind].toLowerCase()}), so it is capped at "${DURATION_LABEL[code].toLowerCase()}".` };
  })();

  // ── source / evidence ──
  const src = sourceRankOf(input.sourceLabel, input.url, input.primarySource);
  const nSrc = isNum(input.independentSources) && input.independentSources >= 1 ? Math.floor(input.independentSources) : 1;
  const socialAnalyst = src.rank != null && src.rank >= 12;
  const directPrimary = !socialAnalyst && (input.primarySource === true || (src.rank != null && src.rank <= 9));
  let evStatus: EvidenceStatus;
  if (disproved && !noiseKind) evStatus = 'DISPROVED';
  else if (noiseKind || (kind === 'OTHER' && !isOrderOther)) evStatus = 'HYPOTHESIS';
  else if (socialAnalyst) evStatus = 'HYPOTHESIS';
  else if (directPrimary) evStatus = tentative ? (nSrc >= 2 ? 'STRONG' : 'DEVELOPING') : 'CONFIRMED';
  else if (src.rank === 10) evStatus = nSrc >= 2 ? 'STRONG' : 'DEVELOPING';
  else evStatus = nSrc >= 2 ? 'STRONG' : 'HYPOTHESIS';
  if (capexAlone && (evStatus === 'CONFIRMED' || evStatus === 'STRONG')) evStatus = 'DEVELOPING';

  // ── link strength ──
  let link: LinkStrength;
  const inflection = inflectionOf(e);
  if (noiseKind) link = 'NARRATIVE_ONLY';
  else if (kind === 'EARNINGS_RESULT') link = earnNumbers || quantInText ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'CUSTOMER_QUALIFICATION') link = prodAward || (orderLike && quantInText) ? (quantInText ? 'DIRECT' : 'NEAR_DIRECT') : 'NEAR_DIRECT';
  else if (kind === 'DEMAND_EXPLOSION') link = orderLike && quantInText ? 'DIRECT' : orderLike ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'CAPACITY_INFLECTION') link = capexAlone ? 'INDIRECT' : contractOfftake && quantInText ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'BOTTLENECK') link = RE.companyAdvantage.test(text) && (orderLike || quantInText) ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'OPERATING_INFLECTION') link = quantInText ? 'DIRECT' : 'NEAR_DIRECT';
  else if (kind === 'SUPPLY_DEMAND_INFLECTION') link = quantInText && RE.companyAdvantage.test(text) ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'NEW_PRODUCT_MARKET') link = RE.traction.test(text) && quantInText ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (kind === 'SPECIAL_SITUATION') link = durableSS ? 'NEAR_DIRECT' : 'INDIRECT';
  else if (isOrderOther) link = quantInText ? 'DIRECT' : 'NEAR_DIRECT';
  else link = 'NARRATIVE_ONLY';

  // ── bucket ──
  const linkGood = link === 'DIRECT' || link === 'NEAR_DIRECT';
  const evOK = evStatus === 'CONFIRMED' || evStatus === 'STRONG' || evStatus === 'DEVELOPING';
  const dCode = duration.code;
  let bucket: RadarBucket;
  const quantified = earnNumbers || quantInText;
  if (noiseKind) bucket = noiseKind;
  else if (alwaysSS) bucket = 'SPECIAL_SITUATION';
  else if (kind === 'SPECIAL_SITUATION') {
    if (durableSS && evOK && linkGood) bucket = dCode != null && dCode >= 4 ? 'MULTIBAGGER' : 'EARNINGS_INFLECTION';
    else bucket = 'SPECIAL_SITUATION';
  } else if (evStatus === 'DISPROVED') bucket = 'EVENT_DRIVEN';
  else if (STRUCTURAL_KINDS.has(kind) && dCode != null && dCode >= 4 && linkGood && evOK) bucket = 'MULTIBAGGER';
  else if (bottleneckDet && (kind === 'BOTTLENECK' || kind === 'DEMAND_EXPLOSION' || kind === 'SUPPLY_DEMAND_INFLECTION') ) bucket = 'BOTTLENECK';
  else if ((kind === 'EARNINGS_RESULT' || kind === 'OPERATING_INFLECTION') && quantified && inflection.state !== 'NO_INFLECTION') bucket = 'EARNINGS_INFLECTION';
  else if (STRUCTURAL_KINDS.has(kind) && dCode === 3 && linkGood && evOK) bucket = 'EARNINGS_INFLECTION';
  else bucket = 'EVENT_DRIVEN';

  // ── changes / mechanism ──
  const chg: string[] = [];
  const add = (...a: string[]) => a.forEach((x) => { if (!chg.includes(x)) chg.push(x); });
  if (kind === 'CUSTOMER_QUALIFICATION') add('revenue', 'volume', 'competitive position', 'customer concentration', 'earnings durability');
  else if (kind === 'BOTTLENECK') add('ASP', 'gross margin', 'operating margin', 'competitive position', 'earnings durability');
  else if (kind === 'CAPACITY_INFLECTION') add('volume', 'revenue', 'utilisation', 'ROCE', 'FCF');
  else if (kind === 'DEMAND_EXPLOSION') add('revenue', 'volume', 'addressable market', 'utilisation');
  else if (kind === 'SUPPLY_DEMAND_INFLECTION') add('ASP', 'gross margin', 'operating margin', 'volume');
  else if (kind === 'NEW_PRODUCT_MARKET') add('addressable market', 'mix', 'revenue', 'market share');
  else if (kind === 'OPERATING_INFLECTION') add('operating margin', 'utilisation', 'FCF', 'ROCE', 'earnings durability');
  else if (kind === 'EARNINGS_RESULT') {
    if (e && isNum(e.revenueYoY)) add('revenue');
    if (e && isNum(e.marginNow) && isNum(e.marginPrior)) add('operating margin');
    if (e && isNum(e.cfoToPat)) add('FCF');
    if (e && e.orderBook && e.orderBook !== 'NOT_STATED') add('volume');
    if (!chg.length) add('revenue', 'operating margin');
  } else if (kind === 'SPECIAL_SITUATION') {
    if (ss === 'SPIN') add('competitive position', 'addressable market', 'ROCE', 'earnings durability');
    else if (ss === 'MA') add('revenue', 'market share', 'customer concentration', 'mix');
    else if (ss === 'RESTRUCTURING') add('operating margin', 'FCF', 'earnings durability');
    // buyback / open offer / asset sale / capital raise: no business variable stated
  } else if (isOrderOther) add('revenue', 'volume', 'customer concentration');
  if (kind !== 'SPECIAL_SITUATION' || durableSS) {
    if (/\bmix\b|value[\s-]?added|premium (?:product|segment)/i.test(text)) add('mix');
    if (/gross margin/i.test(text)) add('gross margin');
    if (/single customer|top customer|customer concentration|largest customer/i.test(text)) add('customer concentration');
    if (/\bROCE\b|return on capital/i.test(text)) add('ROCE');
    if (/market share/i.test(text)) add('market share');
    if (/free cash flow|\bFCF\b|cash conversion/i.test(text)) add('FCF');
  }
  if (noiseKind) chg.length = 0;
  const changes = chg;

  const mechanism = ((): string => {
    if (noiseKind === 'TECHNICAL') return 'A chart setup says something about timing only. It gives no reason why revenue, margin or cash may change.';
    if (noiseKind) return `No mechanism to earnings power is stated (${noiseReason}).`;
    switch (kind) {
      case 'CUSTOMER_QUALIFICATION': return 'Approval or a contract with a customer that is slow to switch suppliers can turn into repeat volume.';
      case 'BOTTLENECK': return 'When supply is scarce, the few suppliers that can deliver may hold price and volume.';
      case 'CAPACITY_INFLECTION': return capexAlone ? 'Capex adds capacity, but it only lifts earnings if customer demand fills it.' : 'New capacity that is matched by customer demand, utilisation or a contract can lift volume, revenue and utilisation.';
      case 'DEMAND_EXPLOSION': return 'Demand that grows faster than supply can lift volume, price and utilisation.';
      case 'SUPPLY_DEMAND_INFLECTION': return 'A shift in supply or demand can change realised prices and margins.';
      case 'NEW_PRODUCT_MARKET': return 'A new product or market can widen the addressable market and change the sales mix.';
      case 'OPERATING_INFLECTION': return 'Higher margin on a growing base can lift earnings faster than revenue.';
      case 'EARNINGS_RESULT': return 'Reported results show whether revenue, margin and cash are actually improving.';
      case 'SPECIAL_SITUATION':
        if (durableSS) return 'The text describes a change in the business that is bought or separated, with a stated contribution to earnings power.';
        if (ss === 'BUYBACK') return 'A buyback changes the share count, not the business.';
        if (ss === 'OPEN_OFFER') return 'A tender, open offer or going-private step is a deal-driven event with its own timetable, not a change in operations.';
        if (ss === 'SPIN') return 'A separation can change how the parts are run and valued; the text does not say it changes earnings power.';
        if (ss === 'MA') return 'A deal can change scale or customers; the text does not state a contribution to earnings.';
        if (ss === 'ASSET_SALE') return 'An asset sale is usually a one-time cash event.';
        if (ss === 'RIGHTS') return 'A capital raise changes funding and share count, not operations.';
        return 'A corporate action, classified separately from operating catalysts.';
      default: return isOrderOther ? 'An order adds revenue as it is delivered; its size against annual revenue is not established.' : 'No mechanism to earnings power is stated in the text.';
    }
  })();

  const whyItMatters = noiseKind
    ? (noiseKind === 'TECHNICAL' ? 'This is timing information only. It does not say why the business may change.' : `No change to earnings power is stated (${noiseReason}). ${mechanism}`)
    : changes.length
      ? `${KIND_LABEL[kind]}: it can change ${joinList(changes)}. ${mechanism}`
      : `${KIND_LABEL[kind]}: ${mechanism}`;

  // ── financial impact ──
  const financialImpact = ((): string => {
    const parts: string[] = [];
    const q = uniq([...amounts.map(squash), ...percents.map(squash), ...unitsM.map(squash)]).slice(0, 4);
    if (kind === 'EARNINGS_RESULT' && e) {
      const b: string[] = [];
      if (isNum(e.revenueYoY)) b.push(`revenue ${e.revenueYoY >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e.revenueYoY))}% year on year`);
      if (isNum(e.marginNow) && isNum(e.marginPrior)) b.push(`margin ${fmt(e.marginPrior)}% to ${fmt(e.marginNow)}%`);
      if (isNum(e.patYoY)) b.push(`profit ${e.patYoY >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e.patYoY))}% year on year`);
      if (isNum(e.cfoToPat)) b.push(`cash flow from operations is ${fmt(e.cfoToPat)}x profit`);
      if (b.length) parts.push(`Reported: ${joinList(b)}.`);
    }
    if (q.length) parts.push(`The source states: ${q.join(', ')}.`);
    if (!parts.length) return 'Not quantified in the source - the financial impact is not established.';
    return parts.join(' ');
  })();

  // ── governance, drivers ──
  const governance = governanceOf(input.governance);
  const drivers = noiseKind === 'NOISE' ? [] : driversOfText(`${input.title || ''} ${input.description || ''} ${ff.what_happened || ''} ${ff.what_matters || ''}`);

  // ── bottleneck question ──
  const bottleneckQuestion = (kind === 'BOTTLENECK' || (bottleneckDet && !noiseKind))
    ? `Why can't competitors immediately supply this demand? ${(() => { const s = sentenceWith(sents, RE.bottleneck); return s ? `The source says: "${s}"` : 'Not established - read the source'; })()}`
    : null;

  // ── chain ──
  const evSent = sentenceWith(sents, /./) || clip(text, 200);
  const step = (i: number, status: ChainStatus, t: string): ChainStep => ({ step: CHAIN_NAMES[i], status, text: t });
  const chain: ChainStep[] = [];
  const evUsable = evStatus !== 'HYPOTHESIS' && evStatus !== 'DISPROVED' && !noiseKind;
  chain.push(
    noiseKind ? step(0, 'unknown', 'No catalyst that changes earnings power is stated.')
      : evStatus === 'DISPROVED' ? step(0, 'unknown', `The source says the event was cancelled, withdrawn or rejected ("${clip(disprovedQuote || '', 60)}").`)
        : evUsable ? step(0, 'proven', `Source sentence: "${evSent}"`)
          : step(0, 'assumed', `Reported by ${src.label} but not verified by a primary source: "${evSent}"`),
  );
  const drvSent = sentenceWith(sents, /\b(customers?|demand|orders?|order book|backlog|offtake|off-take|market)\b/i);
  chain.push(noiseKind ? step(1, 'unknown', NE) : drvSent && kind !== 'EARNINGS_RESULT' ? step(1, evUsable ? 'proven' : 'assumed', `Source sentence: "${drvSent}"`) : ['DEMAND_EXPLOSION', 'CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'NEW_PRODUCT_MARKET'].includes(kind) ? step(1, 'assumed', 'The kind of event implies a customer or market driver, but the source does not name one.') : step(1, 'unknown', NE));
  const bnSent = sentenceWith(sents, RE.bottleneck);
  chain.push(bnSent && !noiseKind ? step(2, evUsable ? 'proven' : 'assumed', `Source sentence: "${bnSent}"`) : step(2, 'unknown', kind === 'BOTTLENECK' ? 'Not established - read the source' : NE));
  const advSent = qualDet ? sentenceWith(sents, RE.qual) : (RE.companyAdvantage.test(text) && !noiseKind ? sentenceWith(sents, RE.companyAdvantage) : null);
  chain.push(advSent && !noiseKind ? step(3, evUsable ? 'proven' : 'assumed', `Source sentence: "${advSent}"`) : step(3, 'unknown', NE));
  const capSent = capacityIncrease ? sentenceWith(sents, RE.capacityIncrease) : (utilisation ? sentenceWith(sents, RE.utilisation) : null);
  const orderBookUp = e?.orderBook === 'UP' && kind === 'EARNINGS_RESULT';
  chain.push(orderBookUp ? step(4, 'proven', 'Supplied results show the order book up.')
    : capSent && !noiseKind ? step(4, evUsable ? 'proven' : 'assumed', `Source sentence: "${capSent}"`)
      : ['CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'DEMAND_EXPLOSION'].includes(kind) ? step(4, 'assumed', 'Volume is implied by the kind of event; no capacity or volume figure is stated.') : step(4, 'unknown', NE));
  const fromResults = kind === 'EARNINGS_RESULT' && !!e;
  const revProven = fromResults && isNum(e!.revenueYoY);
  const marginProven = fromResults && isNum(e!.marginNow) && isNum(e!.marginPrior);
  const fcfProven = fromResults && isNum(e!.cfoToPat);
  const patProven = fromResults && isNum(e!.patYoY);
  const impliesRev = !noiseKind && ['CAPACITY_INFLECTION', 'CUSTOMER_QUALIFICATION', 'DEMAND_EXPLOSION', 'NEW_PRODUCT_MARKET', 'BOTTLENECK', 'OPERATING_INFLECTION', 'EARNINGS_RESULT'].includes(kind) || isOrderOther;
  chain.push(revProven ? step(5, 'proven', `Supplied results: revenue ${e!.revenueYoY! >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e!.revenueYoY!))}% year on year.`) : impliesRev ? step(5, 'assumed', 'Revenue impact is implied by the mechanism, not yet visible in reported earnings.') : step(5, 'unknown', NE));
  chain.push(marginProven ? step(6, 'proven', `Supplied results: margin ${fmt(e!.marginPrior!)}% to ${fmt(e!.marginNow!)}%.`) : changes.some((c) => /margin|ASP/.test(c)) && !noiseKind ? step(6, 'assumed', 'Margin impact is implied by the mechanism, not yet visible in reported earnings.') : step(6, 'unknown', NE));
  chain.push(fcfProven ? step(7, 'proven', `Supplied results: cash flow from operations is ${fmt(e!.cfoToPat!)}x profit.`) : step(7, 'unknown', NE));
  chain.push(patProven ? step(8, 'proven', `Supplied results: profit ${e!.patYoY! >= 0 ? 'up' : 'down'} ${fmt(Math.abs(e!.patYoY!))}% year on year.`) : (chain[5].status === 'assumed' || chain[6].status === 'assumed') ? step(8, 'assumed', 'Earnings impact follows only if the revenue and margin steps happen.') : step(8, 'unknown', NE));

  // expectations
  const mult = input.multipleNow, fwd = input.forwardEarningsGrowth;
  const haveVal = isNum(mult) && isNum(fwd);
  const structuralBegin = STRUCTURAL_KINDS.has(kind) && linkGood && dCode != null && dCode >= 3 && evOK;
  const expectations: ExpectationsRead = ((): ExpectationsRead => {
    if (!haveVal) return { state: 'NOT_ASSESSED', note: 'Not assessed - no multiple / forward earnings supplied.' };
    const m = mult as number, g = fwd as number;
    const ratio = g > 0 ? m / g : null;
    const high = ratio == null ? m > 12 : ratio >= 2;
    const low = ratio == null ? m <= 12 : ratio <= 1;
    const strong = ['CONFIRMED_INFLECTION', 'ACCELERATING_INFLECTION', 'STRUCTURAL_INFLECTION'].includes(inflection.state);
    const moderate = inflection.state === 'EARLY_INFLECTION';
    const weak = inflection.state === 'NO_INFLECTION' || inflection.state === 'NOT_ASSESSED';
    const facts = `Multiple of ${fmt(m)}x against forward earnings growth of ${fmt(g)}%.`;
    if (strong && high) return { state: 'ALREADY_EXPECTED', note: `${facts} Fundamentals are strong, but the multiple already asks for a lot.` };
    if ((strong || moderate) && low) return { state: 'LOW_EXPECTATIONS', note: `${facts} Fundamentals are improving and the multiple asks for little.` };
    if (weak && structuralBegin) return { state: 'EARLY_STAGE', note: `${facts} Results do not show it yet, but a structural catalyst is beginning.` };
    return { state: 'NOT_ASSESSED', note: `${facts} No expectations case fits the fundamentals supplied.` };
  })();
  chain.push(haveVal ? step(9, 'assumed', expectations.note) : step(9, 'unknown', 'Not assessed - no multiple / forward earnings supplied.'));
  chain.push(!noiseKind && STRUCTURAL_KINDS.has(kind) && dCode != null && dCode >= 4 && evOK ? step(10, 'assumed', 'A multi-year re-rating is only possible if the earnings steps above are proven and the catalyst lasts.') : step(10, 'unknown', NE));
  let provenThrough = -1;
  chain.forEach((c, i) => { if (c.status === 'proven') provenThrough = i; });

  const valuationContext = haveVal
    ? (fwd as number) > 0
      ? `What has to happen for the current valuation to make sense: earnings need to grow about ${fmt(fwd as number)}% a year to match a ${fmt(mult as number)}x multiple, and that growth has to last as long as the catalyst does. Slower growth leaves the multiple stretched.`
      : `What has to happen for the current valuation to make sense: earnings growth has to turn positive; at a ${fmt(mult as number)}x multiple with forward growth of ${fmt(fwd as number)}% the multiple is not supported by growth.`
    : 'Not assessed - no multiple / forward earnings supplied.';

  // ── evidence read ──
  const weakLinkIdx = ((): number => {
    const order = kind === 'BOTTLENECK' ? [3, 4, 5, 8] : kind === 'CUSTOMER_QUALIFICATION' ? [4, 5, 8] : kind === 'CAPACITY_INFLECTION' ? [1, 5, 8] : [5, 8];
    for (const i of order) if (chain[i].status !== 'proven') return i;
    return 8;
  })();
  const unproven = CHAIN_NAMES[weakLinkIdx].toLowerCase();
  const why = ((): string => {
    if (evStatus === 'DISPROVED') return `The source says the event was cancelled, withdrawn or rejected ("${clip(disprovedQuote || '', 60)}"). Nothing further is proven.`;
    if (noiseKind) return 'No earnings-relevant event is stated, so there is nothing to confirm.';
    if (evStatus === 'HYPOTHESIS') {
      const what = socialAnalyst ? `${src.label} is a social or analyst source: it can point to an idea but never proves one` : `${src.label} is a single unverified source`;
      return `${what}. Proven: nothing yet. Unproven: the event itself and the ${unproven} link.`;
    }
    if (evStatus === 'CONFIRMED') return `${src.label}${src.rank ? ` (rank ${src.rank})` : ''} states the event directly. Proven: the event. Unproven: the ${unproven} link${capexAlone ? ' - capex without a demand link' : ''}.`;
    if (evStatus === 'STRONG') return `${nSrc} independent sources agree${tentative ? ', though the event is described as planned or proposed' : ''}. Proven: the event is reported. Unproven: the ${unproven} link.`;
    return `Evidence exists (${src.label}${src.rank ? `, rank ${src.rank}` : ''})${tentative ? ' but the event is described as planned or proposed' : ''}${capexAlone ? ', and the demand behind the capex is not stated' : ''}. Financial impact is not yet visible; the ${unproven} link is unproven.`;
  })();
  const evidence: EvidenceRead = { status: evStatus, sourceRank: src.rank, sourceLabel: src.label, why, independentSources: nSrc };

  // ── proof point ──
  const when = ((): string | null => {
    const m = /(?:by|in|during|from|before|starting|planned|scheduled|slated|due|commenc\w+|expected (?:by|in|to))\s+((?:Q[1-4]\s?FY\s?\d{2}|H[12]\s?FY\s?\d{2}|FY\s?\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:first|second|third|fourth) quarter(?: of)?\s+\d{4}|Q[1-4]\s?\d{4}))/i.exec(text);
    return m ? squash(m[1]) : null;
  })();
  const proof: ProofPoint = ((): ProofPoint => {
    let p: ProofPoint;
    if (noiseKind === 'TECHNICAL') p = { what: 'A company filing or result that states a revenue, order or margin effect; the chart alone does not answer why.', when: null, kind: 'filing' };
    else if (noiseKind) p = { what: 'A company filing or result that states a revenue, order or margin effect for this company.', when: null, kind: 'filing' };
    else if (evStatus === 'DISPROVED') p = { what: 'A company filing that confirms the cancellation, or a replacement order or contract.', when: null, kind: 'filing' };
    else switch (kind) {
      case 'CUSTOMER_QUALIFICATION': p = prodAward ? { what: 'First production shipments and billing under the award, then a second customer.', when, kind: 'shipment' } : { what: 'First production shipments to the qualifying customer, then a second customer qualification.', when, kind: 'qualification' }; break;
      case 'CAPACITY_INFLECTION': p = capexAlone ? { what: 'Proof needed: commissioning + utilisation + demand (commissioning date, utilisation of the new capacity, and customer orders that fill it).', when, kind: 'commissioning' } : { what: 'Commissioning date and utilisation of the new capacity, and revenue from the demand that fills it.', when, kind: 'commissioning' }; break;
      case 'DEMAND_EXPLOSION': p = { what: 'Billing start and backlog conversion into reported revenue over the next results.', when, kind: 'backlog' }; break;
      case 'BOTTLENECK': p = { what: 'Utilisation, pricing or allocation terms that show the shortage persists and the company holds a share of the scarce supply.', when, kind: 'utilisation' }; break;
      case 'NEW_PRODUCT_MARKET': p = RE.approval.test(text) ? { what: 'Product launch after the approval, then first sales in reported revenue.', when, kind: 'approval' } : { what: 'First commercial sales or shipments of the new product or in the new market.', when, kind: 'shipment' }; break;
      case 'SUPPLY_DEMAND_INFLECTION': p = { what: 'Realised prices and gross margin in the next results showing the shift reaches this company.', when: when || 'next quarterly result', kind: 'margin' }; break;
      case 'OPERATING_INFLECTION': case 'EARNINGS_RESULT': p = { what: 'Next quarterly result: do revenue growth and margin hold for a second and third quarter?', when: 'next quarterly result', kind: 'result' }; break;
      case 'SPECIAL_SITUATION':
        p = ss === 'BUYBACK' ? { what: 'Completion of the buyback and the size actually bought back.', when, kind: 'closing' }
          : ss === 'OPEN_OFFER' ? { what: 'Offer close, acceptance level and the regulatory approvals.', when, kind: 'closing' }
            : ss === 'SPIN' ? { what: 'Record date, listing of the separated business and its first separate results.', when, kind: 'closing' }
              : ss === 'MA' ? { what: 'Regulatory approvals and deal closing, then the first combined results.', when, kind: 'closing' }
                : ss === 'RESTRUCTURING' ? { what: 'The next regulatory or lender step, then results showing the effect.', when, kind: 'filing' }
                  : { what: 'Completion step named in the filing (closing, allotment or listing).', when, kind: 'closing' };
        break;
      default: p = isOrderOther ? { what: 'Billing start and delivery of the order in reported revenue; order size against annual revenue.', when, kind: 'order' } : { what: 'A company filing or result that states a revenue, order or margin effect.', when: null, kind: 'filing' };
    }
    if (ff.what_to_watch && squash(ff.what_to_watch)) p = { ...p, what: `${p.what} Feed watch item: ${clip(squash(ff.what_to_watch), 160)}` };
    return p;
  })();

  // ── break conditions ──
  const breaks: string[] = [];
  const bAdd = (...s: string[]) => s.forEach((x) => { if (!breaks.includes(x)) breaks.push(x); });
  if (ff.what_breaks_thesis && squash(ff.what_breaks_thesis)) bAdd(clip(squash(ff.what_breaks_thesis), 200));
  if (noiseKind) bAdd('No filing or result ever states an effect on revenue, margin or cash.');
  else switch (kind) {
    case 'CUSTOMER_QUALIFICATION': bAdd('Order cancellation or no follow-on orders after qualification', 'Customer loss or a second source approved', 'Margin reversal on the new business', 'Delayed capacity to serve the customer'); break;
    case 'CAPACITY_INFLECTION': bAdd('Utilisation deterioration at the new capacity', 'Delayed commissioning', 'Capex without demand: orders do not fill the capacity', 'Balance-sheet stress from the spend'); break;
    case 'DEMAND_EXPLOSION': bAdd('Falling backlog or order inflow', 'Order cancellation', 'Pricing deterioration as supply catches up', 'Utilisation deterioration'); break;
    case 'BOTTLENECK': bAdd('Competitors qualify or add supply, so the shortage ends', 'Pricing deterioration', 'Customer loss', 'Margin reversal'); break;
    case 'SUPPLY_DEMAND_INFLECTION': bAdd('Pricing deterioration', 'Margin reversal', 'Supply returns or demand fades'); break;
    case 'NEW_PRODUCT_MARKET': bAdd('Regulatory rejection or delay', 'No first sales after launch', 'Customer loss', 'Margin reversal'); break;
    case 'OPERATING_INFLECTION': case 'EARNINGS_RESULT': bAdd('Margin reversal in the next result', 'Revenue growth slows', 'Falling backlog or order book', 'Cash conversion worsens'); break;
    case 'SPECIAL_SITUATION': bAdd('Regulatory rejection or deal termination', 'Balance-sheet stress from the deal or its financing'); if (durableSS) bAdd('The stated earnings contribution does not appear in results'); break;
    default: bAdd('Order cancellation', 'Falling backlog', 'Margin reversal');
  }
  if (governance.status === 'FLAGGED') bAdd('Governance deterioration: the flags above worsen');
  else if (!noiseKind) bAdd('Governance deterioration');
  if (/\bdebt|borrow|loan|financ/i.test(text) && kind !== 'SPECIAL_SITUATION') bAdd('Balance-sheet stress');
  const breakConditions = breaks.slice(0, 7);

  // ── priority ──
  let p = 0;
  const durStated4 = duration.basis === 'stated' && dCode != null && dCode >= 4;
  const evGood = evStatus === 'CONFIRMED' || evStatus === 'STRONG';
  const inflStrong = ['CONFIRMED_INFLECTION', 'ACCELERATING_INFLECTION', 'STRUCTURAL_INFLECTION'].includes(inflection.state);
  if (noiseKind || evStatus === 'DISPROVED' || link === 'NARRATIVE_ONLY') p = 0;
  else if (bucket === 'SPECIAL_SITUATION') p = evGood && (ss === 'SPIN' || ss === 'MA' || ss === 'RESTRUCTURING') ? 1 : 0;
  else if (durStated4 && linkGood && evGood) p = 3;
  else if (linkGood && evOK && ((dCode != null && dCode >= 3) || (kind === 'EARNINGS_RESULT' && inflStrong))) p = 2;
  else if (linkGood && evOK) p = 1;
  else if (link === 'INDIRECT' && evOK) p = 1;
  else if (linkGood && evStatus === 'HYPOTHESIS') p = 1;
  else p = 0;
  const capReasons: string[] = [];
  if (!noiseKind && evStatus === 'HYPOTHESIS') { if (p > 1) p = 1; capReasons.push('the evidence is only a hypothesis'); }
  if (governance.status === 'FLAGGED') { if (p > 1) p = 1; capReasons.push(`governance is flagged (${joinList(governance.flags.slice(0, 2))})`); }
  if (capexAlone) { if (p > 1) p = 1; capReasons.push('capex without a demand link'); }
  if (link === 'INDIRECT' && p > 1) p = 1;
  const priority = P_FROM[p];

  // ── priority reason (spec §19 style) ──
  const priorityReason = ((): string => {
    if (noiseKind) return `No measurable link to earnings power: ${noiseReason}. Shown greyed as low signal.`;
    if (evStatus === 'DISPROVED') return 'The source says the event was cancelled, withdrawn or rejected, so it is kept only as a record.';
    const feats: string[] = [];
    if (kind === 'SPECIAL_SITUATION') feats.push(SS_LABEL[ss || 'OTHER']);
    if (qualDet) feats.push('Customer qualification');
    if (bottleneckDet) feats.push('supply bottleneck');
    if (capacityConfirmed) feats.push('capacity expansion');
    else if (capexAlone) feats.push('capex announcement');
    if (demandDet) feats.push('demand surge');
    if (supplyDemandDet && kind === 'SUPPLY_DEMAND_INFLECTION') feats.push('supply-demand shift');
    if (newProductDet && kind === 'NEW_PRODUCT_MARKET') feats.push('new product / market');
    if (orderLike && (kind === 'CUSTOMER_QUALIFICATION' || isOrderOther || kind === 'DEMAND_EXPLOSION')) feats.push('order / contract');
    if (kind === 'EARNINGS_RESULT') feats.push('reported results');
    if (kind === 'OPERATING_INFLECTION') feats.push('operating inflection');
    let head = feats.length ? cap1(feats.join(' + ')) : cap1(KIND_LABEL[kind].toLowerCase());
    if (duration.basis === 'stated' && term && term.code > 0) head += ` + ${clip(term.quote.toLowerCase(), 30)} term`;
    const descr = `${LINK_LABEL[link].split(' - ')[0].toLowerCase()} link, ${EVIDENCE_LABEL[evStatus].toLowerCase()} evidence, duration ${dCode == null ? 'not established' : duration.label.toLowerCase()}`;
    const tail = kind === 'EARNINGS_RESULT' && earnNumbers
      ? `Reported results are supplied (${INFLECTION_LABEL[inflection.state].toLowerCase()}).`
      : 'Revenue impact not yet visible in reported earnings.';
    const govTail = governance.status === 'NOT_CHECKED' && p >= 2 ? ' Governance not checked yet.' : '';
    const capTail = capReasons.length ? ` Capped at ${PRIORITY_LABEL.MEDIUM.toLowerCase()}: ${joinList(capReasons)}.` : '';
    return `${head}: ${descr}. ${tail}${govTail}${capTail}`.replace(/\s+/g, ' ').trim();
  })();

  const regimeNote = inflection.note;
  const publishedAt = input.publishedAt || null;
  const hasFeedHints = !!(input.eventType || input.feedTier || input.feedFacts);
  const item: RadarItem = {
    id: input.id,
    ticker: input.ticker && input.ticker.trim() ? input.ticker.trim() : null,
    company: input.company,
    region: input.region,
    bucket,
    kind,
    event: clip(title || sentencesOf(desc)[0] || 'Not stated', 280),
    whyItMatters,
    changes,
    mechanism,
    financialImpact,
    duration,
    evidence,
    link,
    inflection: inflection.state,
    regimeNote,
    chain,
    provenThrough,
    bottleneckQuestion,
    proof,
    breakConditions,
    expectations,
    valuationContext,
    technical: technicalNote(input.technical),
    governance,
    drivers,
    priority,
    priorityReason,
    lowSignal: bucket === 'NOISE' || bucket === 'TECHNICAL' || link === 'NARRATIVE_ONLY',
    sourceUrl: input.url || null,
    publishedAt,
    feedEventId: hasFeedHints ? input.id : null,
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
  const analysed = (inputs || []).map((inp) => ({ inp, item: analyseRadarItem(inp) }));
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
  const usable = items.filter((i) => i.bucket !== 'NOISE' && i.bucket !== 'TECHNICAL');
  const sharedDrivers = sharedDriversOf(usable.map((i) => ({ ticker: i.ticker, company: i.company, drivers: i.drivers })), { holdings: Array.from(holdings) });
  const counts: RadarCounts = {
    total: items.length,
    byBucket: {} as Record<RadarBucket, number>,
    byPriority: { VERY_HIGH: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    lowSignal: 0,
    holdings: 0,
  };
  BUCKET_ORDER.forEach((b) => { counts.byBucket[b] = byBucket[b].length; });
  for (const i of items) {
    counts.byPriority[i.priority] += 1;
    if (i.lowSignal) counts.lowSignal += 1;
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
