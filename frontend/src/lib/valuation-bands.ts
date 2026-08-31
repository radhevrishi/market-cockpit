// ── valuation-bands.ts ───────────────────────────────────────────────────────
// Pure input→output model for the "Valuation Scenario Bands" tool.
// A fast bear / base / bull fair-value calculator. No I/O, no React — everything
// here is deterministic maths so the page stays trivially auditable and testable.

export type ScenarioKey = 'bear' | 'base' | 'bull';

/** All raw, user-editable inputs. Percentages are whole numbers (18 = 18%). */
export interface BandInputs {
  ticker: string;            // optional label
  currentPrice: number;      // ₹ per share
  shares: number;            // shares outstanding, in crore
  fwdRevenue: number;        // forward (year-1) revenue, ₹ crore
  opmBase: number;           // base operating margin %, e.g. 18
  opmBearDelta: number;      // pp added to base OPM in the bear case (usually negative)
  opmBullDelta: number;      // pp added to base OPM in the bull case (usually positive)
  useNetMargin: boolean;     // true = skip tax, treat the margin as a net margin directly
  taxRate: number;           // effective tax rate %, used only when useNetMargin=false
  peBear: number;            // exit P/E multiple, bear
  peBase: number;            // exit P/E multiple, base
  peBull: number;            // exit P/E multiple, bull
  horizonYears: number;      // forward horizon in years (1 = just the forward year)
  revenueCagr: number;       // revenue CAGR % applied beyond year 1 when horizon > 1
}

/** The auditable per-scenario chain: revenue → EBIT → PAT → EPS → target. */
export interface ScenarioResult {
  key: ScenarioKey;
  label: string;
  opm: number;               // operating (or net) margin % actually used
  pe: number;                // exit P/E used
  revenue: number;           // ₹ crore, after any CAGR projection
  ebit: number;              // ₹ crore (= revenue × opm); equals PAT when useNetMargin
  pat: number;               // ₹ crore
  eps: number;               // ₹ per share
  target: number;            // ₹ per share target price (= eps × pe)
  upsidePct: number;         // vs current price, %
  annualisedPct: number | null; // implied CAGR to target over the horizon; null if ≤1y
}

export interface MosZone {
  key: 'large' | 'some' | 'slim' | 'over';
  label: string;
  tone: 'good' | 'info' | 'warn' | 'bad';
}

export interface BandModel {
  bear: ScenarioResult;
  base: ScenarioResult;
  bull: ScenarioResult;
  ordered: ScenarioResult[];      // always [bear, base, bull]
  bandMin: number;                // lowest target across the three
  bandMax: number;                // highest target across the three
  currentPos: number;             // 0..1 position of current price within [min,max] (clamped)
  basePos: number;                // 0..1 position of the base target within [min,max]
  mos: number;                    // margin of safety vs base target, fraction (0.30 = 30%)
  mosZone: MosZone;
  netRoute: 'ebit' | 'net';       // which PAT derivation was used
  valid: boolean;                 // false when inputs are too degenerate to price
}

const SCEN: Record<ScenarioKey, string> = { bear: 'Bear', base: 'Base', bull: 'Bull' };

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Classify a margin-of-safety fraction into a labelled, coloured zone. */
export function classifyMos(mos: number): MosZone {
  if (!Number.isFinite(mos)) return { key: 'over', label: 'n/a', tone: 'bad' };
  if (mos < 0) return { key: 'over', label: 'Overvalued vs base', tone: 'bad' };
  if (mos < 0.1) return { key: 'slim', label: 'Slim margin of safety', tone: 'warn' };
  if (mos < 0.3) return { key: 'some', label: 'Some margin of safety', tone: 'info' };
  return { key: 'large', label: 'Large margin of safety', tone: 'good' };
}

/** Build one scenario's full chain from the shared inputs. */
function buildScenario(key: ScenarioKey, opmDelta: number, pe: number, inp: BandInputs): ScenarioResult {
  const horizon = Math.max(1, num(inp.horizonYears, 1));
  const cagr = num(inp.revenueCagr) / 100;
  // Forward revenue is year-1; project forward when a multi-year horizon is set.
  const projFactor = horizon > 1 ? Math.pow(1 + cagr, horizon - 1) : 1;
  const revenue = Math.max(0, num(inp.fwdRevenue)) * projFactor;

  const opm = num(inp.opmBase) + opmDelta;      // margin % for this scenario
  const ebit = revenue * (opm / 100);           // ₹ cr — also "net" when useNetMargin
  const tax = Math.min(100, Math.max(0, num(inp.taxRate))) / 100;
  const pat = inp.useNetMargin ? ebit : ebit * (1 - tax);

  const shares = Math.max(0, num(inp.shares));
  const eps = shares > 0 ? pat / shares : 0;    // ₹cr / cr-shares = ₹/share
  const target = eps * Math.max(0, num(pe));

  const current = num(inp.currentPrice);
  const upsidePct = current > 0 ? ((target - current) / current) * 100 : 0;
  const annualisedPct =
    horizon > 1 && current > 0 && target > 0
      ? (Math.pow(target / current, 1 / horizon) - 1) * 100
      : null;

  return { key, label: SCEN[key], opm, pe: num(pe), revenue, ebit, pat, eps, target, upsidePct, annualisedPct };
}

/** The whole model in one deterministic call. */
export function computeBands(inp: BandInputs): BandModel {
  const bear = buildScenario('bear', num(inp.opmBearDelta), inp.peBear, inp);
  const base = buildScenario('base', 0, inp.peBase, inp);
  const bull = buildScenario('bull', num(inp.opmBullDelta), inp.peBull, inp);
  const ordered = [bear, base, bull];

  const targets = ordered.map((s) => s.target);
  const bandMin = Math.min(...targets);
  const bandMax = Math.max(...targets);
  const span = bandMax - bandMin;

  const current = num(inp.currentPrice);
  const pos = (v: number) => (span > 0 ? Math.min(1, Math.max(0, (v - bandMin) / span)) : 0.5);
  const currentPos = pos(current);
  const basePos = pos(base.target);

  const mos = base.target > 0 ? (base.target - current) / base.target : NaN;
  const mosZone = classifyMos(mos);

  const valid = num(inp.shares) > 0 && num(inp.fwdRevenue) > 0 && current > 0 && bandMax > 0;

  return {
    bear, base, bull, ordered,
    bandMin, bandMax, currentPos, basePos,
    mos, mosZone,
    netRoute: inp.useNetMargin ? 'net' : 'ebit',
    valid,
  };
}

export const DEFAULT_INPUTS: BandInputs = {
  ticker: '',
  currentPrice: 1000,
  shares: 100,
  fwdRevenue: 5000,
  opmBase: 18,
  opmBearDelta: -4,
  opmBullDelta: 4,
  useNetMargin: false,
  taxRate: 25,
  peBear: 25,
  peBase: 40,
  peBull: 55,
  horizonYears: 1,
  revenueCagr: 15,
};
