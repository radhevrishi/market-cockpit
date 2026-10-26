// ═══════════════════════════════════════════════════════════════════════════
// THE GRADING ENGINE'S VERSION — the thing that makes the day cache safe.
//
// A completed session is immutable on EDGAR, so a cached day is held for 30
// days. That reasoning is correct about the FILINGS and wrong about the GRADE:
// the numbers do not change, but how they are read changes with every fix.
//
// The symptom, over and over: a grading defect is found, fixed and deployed —
// Burlington's tariff refund, Advance Auto's $0.31, Fabrinet's cash — and the
// card still shows the old verdict, because the day it sits on was cached
// before the fix and is served from the browser for another month. The engine
// is right and the screen is wrong, which is the worst of the two failures: it
// looks like the fix did not work.
//
// So every cached day carries the version of the engine that produced it, and
// a day produced by an older engine is not served. One line to bump, and every
// browser re-reads the window against the new rules by itself.
//
// BUMP THIS whenever a change alters what a grade SAYS — a tier rule, a
// caveat, a number on a card, a new field the card renders. Do not bump it for
// a change that cannot alter output (a comment, a page layout, a button).
// ═══════════════════════════════════════════════════════════════════════════

// zzz665 — the magnitude gates no longer treat an ABSENT year-ago EPS, nor a
// NEGATIVE year-ago base, as a failed test. A completed profit swing at scale
// is now Path F, so a company that recovered from a loss — and a spin-off with
// no per-share history — can grade above MIXED for the first time. This changes
// what grades SAY, so every cached day re-reads.
// 2026.09.16-a (zzz680) — the setup verdict now gates the tier. Measured over
// the 506-name bench: 'beat already priced' ran −4.7% since print and
// 'compounder setup' +3.2%, and the tier ignored both. BLOCKBUSTER moves from
// −0.7% to +5.1% (win 43% → 64%) on the same rows. Every cached grade changes,
// so the namespace changes with it.
// 2026.09.17-a (zzz685) — the top-tier floor is measured WITHOUT the chart.
// It read `composite_score` (25% technical), so "composite below 80" also meant
// "bad chart": Flexible Solutions was demoted to MIXED on revenue +94%, OPM
// +16.4pp and backlog +256% purely for sitting 51% below its 52-week high —
// composite 73, fundamental composite 82. That is the Bharat Dynamics defect
// zzz673 exists to prevent, reintroduced by the gate. Now floors on
// fund_composite. Top tiers +3.7% -> +3.9%; held-out half +3.2% -> +3.7%.
// 2026.09.17-b (zzz686) — the "needs a pullback" cap is gone. It moved one
// name in 506 and that name returned +15.3%; gate 4 already covers it.
// 2026.09.17-c (zzz692) — 'optical eps' stopped flagging operating leverage.
// The size tests (EPS >= 3x sales, or EPS >= 200%) fired on 102 bench rows and
// 69 carried the tag ONLY because margins expanded: HBB 4.7->30.3%, MPC
// 6.5->14.1% (+37.0% since print), DINO 4.0->11.2% (+23.6%), TER 13.9->32.9%,
// LMT 4.1->12.4%. The tag spends the caveat budget the BLOCKBUSTER paths are
// gated on and, with CFO/PAT under 1, trips the outrun-both ceiling to MIXED.
// A disclosed GAAP-vs-adjusted gap still reports unconditionally.
// 2026.09.25-a (zzz804) — price never grades. The tier reads a price-free
// composite (no technical term, no chart methods); the reaction ladder, the
// stage-4 ceiling, "market rejected", thin float and the setup gates' "already
// priced" / "setup does not confirm" demotions become market CONTEXT only.
// PRELIM rows read the release's own three-month cash-flow statement (so a
// −$917m operating cash quarter caps at MIXED instead of grading STRONG), the
// street's revenue beat counts, and the sentence is rebuilt from the final
// tier. Every cached grade can change.
// 2026.09.25-b (zzz806) — BLOCKBUSTER needs confirmation beyond one magnified
// percentage: growth that is not small-base arithmetic, a healthy margin, known
// cash backing, an independent confirmation (two for micro-caps) and no open
// forensics flag. Misses cap at STRONG, or MIXED when three or more combine.
// 2026.10.12-a (zzz962/963) — working-capital quarters read from the release's cash-flow statement (Penguin Solutions) and a
// lowered outlook keeps a quarter out of BLOCKBUSTER/STRONG. Browsers held the old day for 30 days, so PENG stayed MIXED on
// screen; the bump makes every browser re-read its days (regraded in-process, no SEC re-read).
// 2026.10.20-a (zzz1163) — a re-grade of a named company no longer credits a later non-results 8-K with last quarter's XBRL
// (SM, VG showed Q2 figures as "Q3 FY26"; ManpowerGroup's real Q3 print was graded on Q2); lenders carry net interest income,
// bank revenue, credit-loss provision and equity ÷ assets. The bump re-grades bench entries so they pick these up.
// 2026.10.20-b (zzz1164) — patent / royalty filers are no longer "financial", so the cash gate applies to them (Digital Turbine).
// 2026.10.26-a (zzz1172) — a one-off in the year-ago quarter (GAAP prev far below adjusted prev, OSBC): graded on core EPS growth.
export const US_ENGINE_VERSION = '2026.10.26-a';

/** zzz807 — earlier engine versions whose cached days can be REGRADED in-process
 *  (their rows carry every figure the grade reads). Newest first. A rules-only
 *  bump appends the version it replaces here, so no cached day is ever sent
 *  back to SEC just because a rule changed. */
export const US_ENGINE_PREVIOUS_VERSIONS: readonly string[] = [
  '2026.09.25-b', '2026.09.25-a', '2026.09.17-c', '2026.09.17-b', '2026.09.17-a', '2026.09.16-a',
];

/** zzz970 — corrections the SERVER applies when it hands a day out (lowered-outlook check, working-capital re-read). A day a
 *  browser stored without this stamp — or regraded itself — is re-fetched, so it cannot keep showing the uncorrected grade. */
export const US_OVERLAY_VERSION = '2026.10.12-f';
