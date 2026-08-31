// ════════════════════════════════════════════════════════════════════════════
// cb-decay.ts — Conviction Beats "decay watch"
// ────────────────────────────────────────────────────────────────────────────
// A bench name earns its place because the quarter was strong. But quality can
// roll over AFTER we add it: margins slip, cash stops backing profit, growth
// turns negative, or the post-earnings drift fades into a bull-trap.
//
// `assessDecay` inspects a single ConvictionEntry and returns a structured
// decay assessment (or null when the name still looks clean). Pure + SSR-safe:
// no window / localStorage access here — the caller feeds it entries.
//
// zzz517 — NOISE FIX. The old version flagged a name on ANY single weak reading
// (a 0.1pp OPM dip, or a single sub-0.6 CFO/PAT), which lit up ~160 bench names
// at once and buried the few that matter. Two structural fixes:
//   1. CFO/PAT is a structurally negative number for lenders/NBFCs/banks (they
//      consume operating cash as the loan book grows), so the cash signal is
//      MEANINGLESS for financials — it is now suppressed for them. This alone
//      removes the false positives on Bajaj Finance, Shriram, Muthoot, etc.
//   2. Thresholds are tightened AND a name must CORROBORATE: a fundamental
//      signal (margin/cash/growth) has to be joined by a price rollover, OR a
//      single signal has to be genuinely severe, OR two fundamentals have to be
//      rolling over together. A lone mild reading no longer clutters the list.
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
 *  never bought, quietly rotting on the watchlist. Surfaced in its own list. */
export function isStale(e: Pick<ConvictionEntry, 'added_at'>): boolean {
  return benchAge(e) > STALE_DAYS;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Lending / financial businesses run structurally negative operating cash flow
// while they grow the book, so CFO/PAT is not a quality signal for them. Detect
// via the sector field first (cleanest), then a conservative company-name regex.
const FIN_SECTOR_RE = /financ|bank|nbfc|insur|capital\s*market|broking|securities|fintech|lend/i;
// Leading word-boundary only — these are stems ("financ" must match "Finance",
// "Financial"; "securit" → "Securities"; "insur" → "Insurance"). A trailing \b
// would wrongly reject "Finance" (no boundary between the "c" and the "e").
const FIN_NAME_RE = /\b(?:bank|banking|financ|finserv|fincorp|nbfc|microfin|micro\s*fin|small\s*finance|housing\s*finance|insur|securit|broking|broker|fintech|capital|mortgage|grameen|vysya|credit|loan)/i;
function isFinancial(e: DecayInput): boolean {
  const s = String(e.sector || '');
  if (s && FIN_SECTOR_RE.test(s)) return true;
  return FIN_NAME_RE.test(String(e.company || ''));
}

/**
 * Assess whether a single bench entry is decaying. Returns null unless the
 * deterioration is corroborated or genuinely severe (see gate below).
 *
 * Flag weights (severe = weight ≥ 3):
 *   margin  OPM ↓ ≥3pp → 3 ·  ↓ ≥1.5pp → 1.5      (drops under 1.5pp ignored)
 *   cash    CFO/PAT <0 → 3 ·  <0.3 → 2             (financials excluded entirely)
 *   growth  PAT YoY <-20% → 3 ·  <-5% → 2          (barely-negative ignored)
 *   drift   bull trap (popped then <-10%) → 3 · plain <-10% → 2
 *
 * Inclusion gate — a name shows on the decay list ONLY when one holds:
 *   • a fundamental flag (margin/cash/growth) is JOINED by a price rollover, or
 *   • any single flag is severe (weight ≥ 3), or
 *   • two or more fundamentals are rolling over together.
 * Severity buckets from the summed score: ≥5 high, ≥3 med, else low.
 */
export function assessDecay(e: DecayInput): DecayAssessment | null {
  if (!e) return null;
  const flags: DecayFlag[] = [];
  // A single signal only earns a spot on its own when it is CATASTROPHIC, or
  // when the market itself rejected the print (a bull trap). Everything milder
  // must be corroborated. These latch during flag construction below.
  let catastrophic = false;
  let bullTrapHit = false;

  // ── margin contraction (need a MEANINGFUL slip, not a rounding dip) ─────────
  const opm = num(e.opm_pct);
  const opmPrev = num(e.opm_prev_pct);
  if (opm != null && opmPrev != null && opm < opmPrev) {
    const drop = opmPrev - opm; // positive pp decline
    if (drop >= 1.5) {
      flags.push({ kind: 'margin', label: `OPM ↓ ${drop.toFixed(1)}pp`, weight: drop >= 3 ? 3 : 1.5 });
      if (drop >= 5) catastrophic = true; // margin fell off a cliff
    }
  }

  // ── cash conversion weak (skip for lenders — CFO/PAT is structurally low) ───
  if (!isFinancial(e)) {
    let cfoPat = num(e.cfo_to_pat_ratio);
    if (cfoPat == null && Array.isArray(e.annual_cfo_pat) && e.annual_cfo_pat.length) {
      cfoPat = num(e.annual_cfo_pat[e.annual_cfo_pat.length - 1]);
    }
    if (cfoPat != null && cfoPat < 0.3) {
      flags.push({ kind: 'cash', label: `CFO/PAT ${cfoPat.toFixed(2)}`, weight: cfoPat < 0 ? 3 : 2 });
      if (cfoPat < -3) catastrophic = true; // cash wildly divergent from profit
    }
  }

  // ── growth reversal (real decline, not a fraction of a percent) ────────────
  const npYoy = num(e.net_profit_yoy_pct);
  if (npYoy != null && npYoy < -5) {
    flags.push({ kind: 'growth', label: `PAT YoY ${npYoy.toFixed(0)}%`, weight: npYoy < -20 ? 3 : 2 });
    if (npYoy < -30) catastrophic = true; // profit more than a third gone
  }

  // ── drift rolling over (post-earnings fade / bull trap) ────────────────────
  const move = num(e.move_pct);
  if (move != null && move < -10) {
    const d1 = num(e.d1_pct);
    const bullTrap = d1 != null && d1 > 0; // popped on the print, then faded
    flags.push({
      kind: 'drift',
      label: bullTrap ? `Bull trap ${move.toFixed(0)}%` : `Drift ${move.toFixed(0)}%`,
      weight: bullTrap ? 3 : 2,
    });
    if (bullTrap) bullTrapHit = true; // market rejected the print — actionable alone
  }

  if (flags.length === 0) return null;

  // ── corroboration gate — the noise filter ──────────────────────────────────
  // A lone weak fundamental (a single sub-0.3 CFO/PAT, a 2pp OPM slip) is NOT
  // enough — that was the old noise. A name shows only when the deterioration
  // is corroborated across signals, or is bad enough to stand on its own:
  //   • a fundamental flag JOINED by a price rollover (the core case), or
  //   • two or more fundamentals rolling over together, or
  //   • the market rejected the print (a bull trap), or
  //   • a single CATASTROPHIC reading (CFO/PAT < -3, PAT YoY < -30%, OPM ↓ ≥5pp).
  const fundamentals = flags.filter((f) => f.kind === 'margin' || f.kind === 'cash' || f.kind === 'growth');
  const price = flags.filter((f) => f.kind === 'drift');
  const corroborated = fundamentals.length >= 1 && price.length >= 1;
  const multiFundamental = fundamentals.length >= 2;
  if (!corroborated && !multiFundamental && !bullTrapHit && !catastrophic) return null;

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
