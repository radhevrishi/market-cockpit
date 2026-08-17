// zzz390 — Shared earnings-grade scoring constants.
//
// The per-quarter grader exists in TWO copies that must stay identical:
//   • server: src/app/api/v1/earnings/graded/route.ts  (authoritative)
//   • client: src/app/(dashboard)/earnings-opportunities/page.tsx  (gradeRow,
//             used by the force-include + client-join paths)
//
// Over this session those two copies repeatedly DRIFTED on exactly the pieces
// below — the caveat-penalty table and the OPM-expansion "margin ladder" — and
// each drift produced a real over-grading bug (zzz384 → zzz386 → zzz387). This
// module is the single source of truth for both, so the values can never
// diverge again. It is pure data + one pure function: no React, no server-only
// APIs, importable from both a route handler and a client page.
//
// IMPORTANT: keep this file free of any 'use client' / 'use server' directive
// and of any import that pulls in browser- or node-only globals.

/**
 * Quality-score penalty per caveat tag (points subtracted from a base of 100).
 * Unknown tags fall back to 8 at the call site (`CAVEAT_PENALTY[tag] ?? 8`).
 */
export const CAVEAT_PENALTY: Record<string, number> = {
  'optical eps': 20,
  'tax distortion': 15,
  'ocf divergence': 25,
  'low quality': 25,
  'segment mix shift': 10,
  'exceptional item': 10,
  'forex gain': 8,
  'forex loss': 8,
  'accelerated depreciation': 10,
  'accounting change': 12,
  'pooling of interests restate': 12,
  'one time order': 10,
};

/** Fallback penalty for a caveat tag not present in CAVEAT_PENALTY. */
export const CAVEAT_PENALTY_DEFAULT = 8;

/**
 * OPM-expansion "margin ladder" (PATCH 1000 + zzz387 ordering fix).
 * Returns the quality-point delta for a given OPM-expansion in percentage
 * points (opmExp = opm_pct − opm_prev_pct). Positive = margins widening.
 *
 * Severe contraction (≤ -2pp) is checked BEFORE mild (≤ -0.5pp) so the -14
 * branch is reachable — the zzz387 bug was that -0.5 shadowed -2, capping every
 * contraction at -8. null / mid-band (between -0.5 and +1) returns 0.
 */
export function marginQualityDelta(opmExp: number | null | undefined): number {
  if (opmExp == null) return 0;
  if (opmExp >= 5) return 14;
  if (opmExp >= 3) return 10;
  if (opmExp >= 1) return 5;
  if (opmExp <= -2) return -14;   // severe contraction — check FIRST
  if (opmExp <= -0.5) return -8;  // mild contraction
  return 0;
}
