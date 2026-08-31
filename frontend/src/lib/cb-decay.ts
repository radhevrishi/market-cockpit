// ════════════════════════════════════════════════════════════════════════════
// cb-decay.ts — Conviction Beats "decay watch"
// ────────────────────────────────────────────────────────────────────────────
// A bench name earns its place because the quarter was strong. But quality can
// roll over AFTER we add it: margins slip, cash stops backing profit, growth
// turns negative, the post-earnings drift fades into a bull-trap, or the name
// just sits on the bench for months and never converts to a buy.
//
// `assessDecay` inspects a single ConvictionEntry and returns a structured
// decay assessment (or null when the name still looks clean). Pure + SSR-safe:
// no window / localStorage access here — the caller feeds it entries.
// ════════════════════════════════════════════════════════════════════════════

import type { ConvictionEntry } from './conviction-beats';

// The task lists a few fundamentals as "relevant" that predate their addition
// to the ConvictionEntry interface (cfo_to_pat_ratio in particular). Accept a
// slightly widened shape so callers on older/newer bench schemas both type-check.
export type DecayInput = ConvictionEntry & {
  cfo_to_pat_ratio?: number | null;
};

export type DecaySeverity = 'high' | 'med' | 'low';

/** One machine-readable decay reason, kept alongside the human label so a
 *  consumer can filter/group without re-parsing the display string. */
export interface DecayFlag {
  kind: 'margin' | 'cash' | 'growth' | 'drift' | 'stale';
  label: string;   // short chip text, e.g. "OPM ↓ 4.2pp"
  weight: number;  // contribution to the severity score
}

export interface DecayAssessment {
  ticker: string;
  company: string;
  score: number;            // summed reason weights (higher = worse)
  reasons: string[];        // human-readable chip labels
  flags: DecayFlag[];       // structured form of the same reasons
  severity: DecaySeverity;  // bucketed from score
}

const STALE_DAYS = 120;

/** Days since the name was first added to the bench. Returns 0 when added_at
 *  is missing/unparseable so an undated entry never reads as "ancient". */
export function benchAge(e: Pick<ConvictionEntry, 'added_at'>): number {
  const raw = e?.added_at;
  if (!raw) return 0;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return 0;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  return days < 0 ? 0 : days;
}

/** An aging bench name that has sat past the stale horizon (~120d) — presumed
 *  never bought, quietly rotting on the watchlist. */
export function isStale(e: Pick<ConvictionEntry, 'added_at'>): boolean {
  return benchAge(e) > STALE_DAYS;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Assess whether a single bench entry is decaying. Returns null when no
 *  decay reason fires. Severity buckets: score ≥ 5 high, ≥ 3 med, else low. */
export function assessDecay(e: DecayInput): DecayAssessment | null {
  if (!e) return null;
  const flags: DecayFlag[] = [];

  // ── margin contraction ────────────────────────────────────────────────────
  const opm = num(e.opm_pct);
  const opmPrev = num(e.opm_prev_pct);
  if (opm != null && opmPrev != null && opm < opmPrev) {
    const drop = opmPrev - opm; // positive pp decline
    const severe = drop >= 3;
    flags.push({
      kind: 'margin',
      label: `OPM ↓ ${drop.toFixed(1)}pp`,
      weight: severe ? 3 : 1,
    });
  }

  // ── cash conversion weak ──────────────────────────────────────────────────
  // Prefer the explicit ratio; fall back to the last annual CFO/PAT reading.
  let cfoPat = num(e.cfo_to_pat_ratio);
  if (cfoPat == null && Array.isArray(e.annual_cfo_pat) && e.annual_cfo_pat.length) {
    cfoPat = num(e.annual_cfo_pat[e.annual_cfo_pat.length - 1]);
  }
  if (cfoPat != null && cfoPat < 0.6) {
    flags.push({
      kind: 'cash',
      label: `CFO/PAT ${cfoPat.toFixed(2)}`,
      weight: 2,
    });
  }

  // ── growth reversal ───────────────────────────────────────────────────────
  const npYoy = num(e.net_profit_yoy_pct);
  if (npYoy != null && npYoy < 0) {
    flags.push({
      kind: 'growth',
      label: `PAT YoY ${npYoy.toFixed(0)}%`,
      weight: 2,
    });
  }

  // ── drift rolling over (post-earnings fade / bull trap) ───────────────────
  const move = num(e.move_pct);
  if (move != null && move < -8) {
    const d1 = num(e.d1_pct);
    const bullTrap = d1 != null && d1 > 0; // popped on the print, then faded
    flags.push({
      kind: 'drift',
      label: bullTrap
        ? `Bull trap ${move.toFixed(0)}%`
        : `Drift ${move.toFixed(0)}%`,
      weight: bullTrap ? 3 : 2,
    });
  }

  // ── stale (aging, never converted) ────────────────────────────────────────
  if (isStale(e)) {
    flags.push({
      kind: 'stale',
      label: `${benchAge(e)}d on bench`,
      weight: 1,
    });
  }

  if (flags.length === 0) return null;

  const score = flags.reduce((s, f) => s + f.weight, 0);
  const severity: DecaySeverity = score >= 5 ? 'high' : score >= 3 ? 'med' : 'low';

  return {
    ticker: e.ticker,
    company: e.company,
    score,
    reasons: flags.map((f) => f.label),
    flags,
    severity,
  };
}
