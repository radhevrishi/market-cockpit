// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type DecisionStatus } from '@/lib/decisions';

// zzz175 - "New" tracker (shared across all 4 tabs)
export type NewTabKey = 'us-tech' | 'in-tech' | 'us-mb' | 'in-mb';
export interface USAChecklistItem {
  id: string; label: string; pillar: string; pillarColor: string;
  target: string; why: string; weight: number; source: string;
}

export type MbMarketScope = 'INDIA' | 'USA' | 'BOTH';

export interface MbAnalyticsStock {
  symbol: string;
  company?: string;
  score: number;
  grade: string;
  sector?: string;
  market: 'INDIA' | 'USA';
}

// ─── THESIS DRIFT detector (current re-score vs Decision Logbook) ─────────
// For every scored row that carries a logged Decision, compare the CURRENT
// score/grade to what was logged and classify divergence:
//   REOPEN (green) — a REJECTED name that now grades high (grade A/A+ OR
//                    composite ≥ 80). "Your best-researched buy pipeline
//                    just improved."
//   BREAK  (red)   — a BUY/WATCH name that decayed: grade C/D OR composite
//                    ≤ 55 OR a CRITICAL/HIGH STRUCTURAL red flag OR pump ≥ 2.
//                    "A name you own/watch deteriorated."
// The `score` field IS the composite. redFlags/pumpScore are India-only and
// simply never fire on USA rows (which carry no redFlags). Reuses the
// ScoreMoversStrip render pattern and arms Book Watch flags so the drift
// surfaces in the alert feed (armBookFlag self-dedups by kind+ticker+day).
type DriftKind = 'REOPEN' | 'BREAK';
export interface DriftItem {
  ticker: string; company?: string; kind: DriftKind;
  decisionStatus: DecisionStatus;
  oldGrade?: string; oldScore?: number;
  grade: string; score: number;
  reason: string; flagNote: string;
}
// ─────────────────────────────────────────────────────────────────────────
// CAPITAL ALLOCATION PANEL — embedded inside Multibagger as a sub-tab.
// Per-ticker scorecard: capex efficiency (ΔEBIT / cumulative capex),
// ROCE shift, equity dilution, buyback quality, dividend rationality,
// reinvestment runway. Computed from /api/earnings/india-screener annual
// data (no new pipeline). Composite score 0-100 with grade A-F.
// ─────────────────────────────────────────────────────────────────────────
export interface CapAllocAnalysis {
  ticker: string; company: string;
  capexEfficiency: { value: number | null; grade: string; label: string };
  roceShift: { before: number | null; after: number | null; delta: number | null };
  dilution: { sharesYoYPct: number | null; verdict: string };
  buybackQuality: { sharesRepurchasedPct: number | null; verdict: string };
  dividendRationality: { payoutPct: number | null; epsGrowthPct: number | null; verdict: string };
  reinvestmentRunway: { years: number | null; verdict: string };
  overall: { score: number; grade: string; label: string };
}
