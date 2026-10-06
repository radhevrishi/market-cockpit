// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// ── data model ──────────────────────────────────────────────────────────────
export type Row = Record<string, string>;
export type Factor = { id: number; label: string; pts: number; max: number; note: string; tier: 1 | 2 | 3 | 4 };
export type Scored = {
  name: string; sector: string; industry: string; country: 'IN' | 'US';
  base: number; final: number; decision: string; decisionColor: string;
  dbCount: number; dbList: string[]; mult: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  position: string; gaps: number; estUsed: number; factors: Factor[];
  comment: string; action: string; theme: string | null;
  roce: number; de: number; util: number; anchor: number; debtFund: number; ocfYears: number;
  ebitda: number; pledge: number; raw: Row;
  phase: string; capexToSales: number; cwipRatio: number; capexAccel: number; deChange: number; selfFund: number;
  netDebtEbitda: number; capexPreRev: number; utilEff: number; nbGrowth: number; revYoY: number;
  stage: string; stageLabel: string; entry: string; entryColor: string; entryShort: string;
  capexSeries: { y: string; v: number }[]; nbSeries: { y: string; v: number }[]; cwipSeries: { y: string; v: number }[]; cycleNote: string;
  watch: string[]; sells: string[]; measuredPct: number; availMax: number;
  tiers: { label: string; pts: number; max: number }[];
};
// ════════════════════════════════════════════════════════════════════════════
// v5 INTELLIGENCE LAYER — pure functions over the persisted rows.
// All series math is null-gap tolerant (Screener exports miss early years);
// a metric whose inputs are missing is EXCLUDED and its weight removed from
// the available maximum — same "measured %" philosophy as the 21-factor engine.
// ════════════════════════════════════════════════════════════════════════════

export type Fin = {
  years: string[]; sales: (number | null)[]; np: (number | null)[]; pbt: (number | null)[];
  tax: (number | null)[]; oi: (number | null)[]; dep: (number | null)[]; intr: (number | null)[];
  div: (number | null)[]; eq: (number | null)[]; res: (number | null)[]; bor: (number | null)[];
  nb: (number | null)[]; cwip: (number | null)[]; cash: (number | null)[]; recv: (number | null)[];
  inv: (number | null)[]; rm: (number | null)[]; chgInv: (number | null)[]; ocf: (number | null)[]; cfi: (number | null)[]; cff: (number | null)[];
  shares: (number | null)[]; price: (number | null)[]; mcap: number | null; capex: (number | null)[];
};
export type MBComp = { id: string; label: string; w: number; pts: number | null; detail: string };
export type MBResult = { score: number; grade: string; color: string; available: number; components: MBComp[]; pe: number; peg: number };
export type FXCheck = { id: string; label: string; w: number; pts: number | null; detail: string; flag?: string };
export type FXResult = { score: number; grade: string; color: string; flags: string[]; critical: boolean; checks: FXCheck[]; workbook: { row: number; label: string; answer: string }[] };
export type ConcallExtract = {
  utilization: number | null; utilArr: number[]; orderBook: number | null; capexGuidance: number | null;
  timeline: string[]; anchorPct: number | null;
  growthNote: string | null; marginNote: string | null; demandNote: string | null; __v?: number;
  optimism: number; caution: number; tone: number | null;
  quotes: { field: string; match: string; snippet: string }[];
  customerCount: number | null; exportPct: number | null; pliMentioned: boolean;
};
export type ConcallEntry = { id: string; label: string; addedAt: string; chars: number; text: string; extract: ConcallExtract };
export type CCState = { freshness: 'FRESH' | 'STALE' | 'NONE'; tone: number | null; utilization: number | null };
export type Verdict = { call: string; color: string; why: string; composite: number; note: string; veto: boolean };
