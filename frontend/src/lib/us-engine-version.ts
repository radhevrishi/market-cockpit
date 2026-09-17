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
export const US_ENGINE_VERSION = '2026.09.17-b';
