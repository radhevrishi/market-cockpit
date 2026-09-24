// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — SHARED TYPES  (zzz795)
//
// One vocabulary for the server engine, the pure evidence calculators and the
// UI. Everything here is plain data so the calculators can be unit-tested
// without React, the network or KV.
// ═══════════════════════════════════════════════════════════════════════════

export type Market = 'us' | 'india';

export interface Ret { w1: number; m1: number; m3: number; m6: number; ytd: number; y1: number }

/** Constituent participation, measured on the theme's own member stocks. */
export interface BreadthStats {
  /** Members that could be priced. */
  n: number;
  /** Members above their own 50-day average today. */
  above50: number;
  /** Members above their own 50-day average four weeks (20 sessions) ago. */
  above50Prev: number | null;
  /** Members beating the benchmark over three months. */
  outperf: number;
  /** Members within 2% of their one-year high. */
  newHighs: number;
  /** Members within 2% of their one-year low. */
  newLows: number;
}

/** Volume-based proxy for money moving in or out. NOT fund-flow data. */
export interface FlowStats {
  /** Last-20-session average volume divided by the 60 sessions before it. */
  relVol: number | null;
  /** Share of last-20-session volume traded on up days (0..1). */
  upShare: number | null;
  /** The same share for the 20 sessions before that. */
  upSharePrev: number | null;
  /** Where the volume came from. 'none' = no usable volume at all. */
  basis: 'etf' | 'members' | 'none';
}

export interface QuadMove { from: string; to: string; dir: 'upgrade' | 'downgrade' }

/** One theme as the server engine returns it. Fields are optional because a
 *  cached payload from an older build may not carry the newer ones. */
export interface ThemeRow {
  id: string; name: string; emoji: string; group: string; note?: string;
  proxy: string | null; members: string[];
  price?: number; dayChangePct?: number;
  sourceKind?: 'proxy' | 'basket' | 'proxy-fallback';
  fallbackReason?: string | null;
  proxySource?: 'nse-published' | 'vendor';
  dayChangeFrom?: 'proxy' | 'members' | 'none';
  ret?: Ret; rsRatio?: number; rsMomentum?: number; quadrant?: string; trail?: { x: number; y: number }[];
  aboveSMA50?: boolean; breadthAbove50?: number | null;
  trendState?: string; trendColor?: string; trendNote?: string;
  characterChange?: 'bullish' | 'bearish' | null;
  /** Kept in the payload for older consumers (cockpit). Never displayed here. */
  conviction?: number;
  rotationVelocity?: number; rotation?: string; action?: string | null;
  verdict?: string; verdictColor?: string; verdictNote?: string;
  quadrant1w?: string | null; quadrant4w?: string | null;
  quadrantMove?: QuadMove | null; quadrantMove4w?: QuadMove | null;
  rsDelta1w?: number | null; momDelta1w?: number | null;
  fallingLeader?: boolean;
  vol?: number | null; dd1y?: number | null; rangePos?: number | null;
  dist50?: number | null; excess3m?: number | null; riskAdj?: number | null; rsSlope?: number | null;
  cluster?: number | null; clusterLabel?: string | null; clusterSize?: number | null; clusterCorr?: number | null;
  /** zzz795 — evidence inputs computed on the server. */
  breadthStats?: BreadthStats | null;
  flowStats?: FlowStats | null;
  /** zzz795 — the price has broken down over the last week / month even
   *  though the three-month picture is still strong. */
  shortTermBreak?: boolean;
  ok?: boolean;
}

export interface MarketBreadth {
  themes: number; above50: number; pctAbove50: number;
  newHigh: number; newLow: number;
  quadrantCounts?: Record<string, number>;
  benchAbove50?: boolean | null; benchRangePos?: number | null;
  regime: 'risk-on' | 'risk-off' | 'mixed'; regimeScore: number; note: string;
}

export interface Payload {
  region: Market;
  benchmark: { symbol: string; name: string; price: number; changePercent: number };
  benchmarkRet?: Ret | null;
  themes: ThemeRow[];
  rotatingIn: string[]; rotatingOut: string[]; topBuy: string[]; topAvoid: string[];
  byVerdict?: Record<string, string[]>;
  movedUp?: string[]; movedDown?: string[];
  clusters?: Array<{ id: number; label: string; members: string[] }>;
  breadth?: MarketBreadth | null;
  /** zzz795 — how much of the constituent breadth pass completed. */
  coverage?: { breadthThemes: number; breadthSkipped: number } | null;
  asOf: string; source?: string; error?: string;
}

// ── EVIDENCE LAYERS ────────────────────────────────────────────────────────

export type LayerKey = 'strength' | 'breadth' | 'flow' | 'earnings' | 'catalysts' | 'valuation' | 'price';
/** Direction of a layer. 'unknown' means NO DATA — it is never read as bad. */
export type LayerState = 'improving' | 'steady' | 'weakening' | 'unknown';

export interface EvidenceLink { label: string; date?: string | null; url?: string | null; ticker?: string | null; tone?: 'pos' | 'neg' | 'neutral' }

export interface LayerRead {
  key: LayerKey;
  state: LayerState;
  /** Where the layer stands, separately from which way it is moving. */
  level: 'strong' | 'neutral' | 'weak' | null;
  /** One plain-English line — the headline a reader sees first. */
  headline: string;
  /** A second line with the numbers behind it. */
  detail: string;
  /** Where the data came from, in words. */
  source: string;
  /** True when the layer is a stand-in (e.g. volume for fund flow). */
  proxy?: boolean;
  /** Dated items that back the layer (prints, filings, news). */
  evidence?: EvidenceLink[];
}

export type LayerSet = Record<LayerKey, LayerRead>;

// ── CLIENT-SIDE INPUTS ─────────────────────────────────────────────────────

/** A graded earnings print (BLOCKBUSTER / STRONG) from the Conviction bench. */
export interface PrintInput { ticker: string; tier: string; filingDate: string; company?: string | null; url?: string | null; pe?: number | null }

export type CatalystKind = 'order' | 'rating-up' | 'rating-down' | 'capacity' | 'guidance-up' | 'guidance-down' | 'approval' | 'regulatory-negative' | 'deal' | 'buyback' | 'other';
export interface CatalystInput {
  ticker: string;
  kind: CatalystKind;
  tone: 'pos' | 'neg' | 'neutral';
  title: string;
  date: string;          // ISO
  url?: string | null;
  source: 'filing' | 'news';
}

// ── DETECTORS / RANKING ────────────────────────────────────────────────────

export type FlagKind = 'early-rotation' | 'crowded' | 'breakdown' | 'short-term-break' | 'defensive';
export interface Flag { kind: FlagKind; label: string; why: string }

export type Tier = 'top' | 'look' | 'monitor' | 'low';
export const TIER_ORDER: Record<Tier, number> = { top: 0, look: 1, monitor: 2, low: 3 };
export const TIER_LABEL: Record<Tier, string> = {
  top: 'Research first',
  look: 'Worth a look',
  monitor: 'Monitor',
  low: 'Low priority',
};

export interface ThemeAssessment {
  id: string;
  layers: LayerSet;
  flags: Flag[];
  tier: Tier;
  /** Hidden ordering key inside a tier. Never shown to the reader. */
  sortKey: number;
  /** "Why:" line built from the evidence layers. */
  why: string;
  improving: LayerKey[];
  weakening: LayerKey[];
}

export interface CrossFlow {
  from: string; to: string;
  /** Change in RS-momentum over the window, per theme. */
  fromDelta: number; toDelta: number;
  weeks: number;
  basis: 'same group' | 'moves together' | 'same group, moves together';
  /** Names inside the receiving theme most likely to benefit next. */
  beneficiaries: string[];
  why: string;
}

// ── HISTORY ────────────────────────────────────────────────────────────────

/** One theme, compactly, as persisted in a weekly snapshot. */
export interface SnapThemeBase { v?: string; q?: string; rs?: number; mom?: number; a50?: boolean; b?: number | null; m1?: number; m3?: number }
export interface SnapThemeOverlay { t?: Tier; r?: number; e?: number; c?: number; f?: FlagKind[] }
export interface WeeklySnapshot {
  week: string;                 // ISO week, e.g. 2026-W39
  market: Market;
  at?: string;                  // last write
  base?: Record<string, SnapThemeBase>;
  overlay?: Record<string, SnapThemeOverlay>;
  overlayAt?: string;
}

export type TrendWord = 'accelerating' | 'continuing' | 'reversing' | 'flat' | 'unknown';
export interface TrendRead { word: TrendWord; dir: 'up' | 'down' | 'flat'; basis: 'snapshots' | 'rrg-tail' | 'none'; note: string }

export interface HistoryDiff {
  available: boolean;
  basis: 'snapshots' | 'rrg-tail';
  previousWeek: string | null;
  weeksOfHistory: number;
  newEntrants: string[];
  rising: string[];
  falling: string[];
  persistentLeaders: string[];
  fading: string[];
  note: string;
}
