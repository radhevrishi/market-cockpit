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

export const US_ENGINE_VERSION = '2026.09.14-e';
