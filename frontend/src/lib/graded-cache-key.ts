// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA GRADED-SESSION CACHE KEY — ONE DEFINITION, TWO READERS.  (zzz665)
//
// WHY THIS FILE EXISTS.
//
// The graded route writes a session under `graded:v14:<date>`. The server-bench
// cron read `graded:v10:<date>`. Those two numbers were the same when the cron
// was written and drifted apart four bumps later, and nothing anywhere could
// notice, because a `kvGet` on a key nobody writes does not fail — it returns
// null, and `refresh-bench` treats null as "no results filed that day" and
// moves on. The cron reported `ok: true` every night.
//
// What it was actually doing: rebuilding the bench out of the LAST GENERATION
// of cached sessions. Settled days are held for 180 days, so v10 keys were
// still there, still readable, and still full of verdicts produced by a grading
// engine four versions out of date. Every India grading fix since the v10 → v14
// bump — every caveat, every cap, every tier correction — reached the page and
// never reached the bench. And a session graded TODAY, written to v14, could
// never enter the bench at all: the newest name on a bench rebuilt this morning
// was three and a half weeks old.
//
// It would also have fixed itself, eventually, in the worst possible way: as
// the v10 keys aged out the bench would have emptied one day at a time, with
// the cron still reporting success throughout.
//
// So the key is no longer written down twice. Both sides import it from here,
// and the next bump is one edit that cannot leave half the system behind.
//
// BUMP `GRADED_CACHE_VERSION` when the India grader's OUTPUT changes, for the
// same reason `US_ENGINE_VERSION` exists on the other side: a cached day holds
// a verdict, not just numbers, and a verdict from an older engine should not be
// served. Bumping abandons the previous namespace, which is the intent.
// ═══════════════════════════════════════════════════════════════════════════

// zzz665c — v14 → v15. Four changes alter what an India grade SAYS:
//   · the price range now reaches far enough to compute MA150/MA200, so
//     Weinstein stage and the trend template exist for the first time;
//   · duplicate caveat tags no longer double-charge quality or the ladder;
//   · the reaction ladder is scaled by each stock's own volatility;
//   · Path F (a completed profit swing at scale) is no longer overruled.
// zzz666 — v15 → v16. Two more:
//   · three HARD CEILINGS now exist on the India side (cash against profit,
//     earnings outrunning revenue and cash, two or more critical flags);
//   · stage / RS / 52-week / close series arrive from the technicals scraper,
//     so the technical axis stops being a constant 50 for every company.
// zzz668 — v16 → v17. The fields the scraper fetched and the grader never saw:
//   · PEAD's volume leg is measured instead of the constant 50;
//   · `exceptional item` finally has an emitter, and a 4th ceiling with it;
//   · a Stage-4 chart no longer forces AVOID by itself (matching the US);
//   · Path F reaches India too;
//   · both row builders now carry the same fields — `close_30d` had reached
//     only one of them, so the volatility-scaled reaction never ran.
//   · a COMPLETED turnaround is no longer stamped 'low quality' — it earns a
//     'returned to profit' tag instead, as it already did on the US side.
// zzz669 — v18 → v19. The last three:
//   · the grader is ONE function (lib/india-grade.ts) instead of two copies
//     721 and 421 lines apart;
//   · one PEAD score instead of two that disagreed — the card adopts the
//     bench's decay-aware formula, tilted by the now-measured volume ratio;
//   · guidance is real: refresh-guidance builds a per-symbol overlay from the
//     concall pipeline that was already running and never connected.
export const GRADED_CACHE_VERSION = 'v19';

/** The KV key holding one fully graded India session. */
export const gradedKey = (date: string): string => `graded:${GRADED_CACHE_VERSION}:${date}`;

/**
 * Namespaces abandoned by earlier bumps, newest first.
 *
 * A reader may fall back through these so that a version bump degrades the
 * bench gradually instead of emptying it overnight — the day a bump ships,
 * nothing has been written to the new namespace yet. Nothing should WRITE to
 * them, and a reader that uses them must prefer the current key first.
 */
export const GRADED_CACHE_LEGACY: readonly string[] = ['v18', 'v17', 'v16', 'v15', 'v14', 'v13', 'v12', 'v11', 'v10'];

/** Current key first, then the abandoned ones — for readers that tolerate age. */
export function gradedKeyCandidates(date: string): string[] {
  return [gradedKey(date), ...GRADED_CACHE_LEGACY.map((v) => `graded:${v}:${date}`)];
}
