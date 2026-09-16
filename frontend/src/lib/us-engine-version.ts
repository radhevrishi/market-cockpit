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
// 2026.09.16-b (zzz683) — the root cause, not a symptom. `decideTier` gates
// BLOCKBUSTER Path A on composite >= 78 and Path B on >= 72, but Paths C-F are
// pure magnitude tests with NO composite requirement, so a name with huge YoY
// percentages and weak everything else entered the top tier at a composite of
// 55 while STRONG held a 99. Both top tiers now require composite >= 80 — one
// threshold, measured once, replicating in both halves of the bench.
//   BLOCKBUSTER  -0.7% -> +6.7%   win 43% -> 74%
//   STRONG       -1.4% -> +3.0%   win 38% -> 56%
//   held-out half: -1.7% -> +3.2%, win 42% -> 63%
export const US_ENGINE_VERSION = '2026.09.16-b';
