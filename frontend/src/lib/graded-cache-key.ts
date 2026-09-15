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

export const GRADED_CACHE_VERSION = 'v14';

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
export const GRADED_CACHE_LEGACY: readonly string[] = ['v13', 'v12', 'v11', 'v10'];

/** Current key first, then the abandoned ones — for readers that tolerate age. */
export function gradedKeyCandidates(date: string): string[] {
  return [gradedKey(date), ...GRADED_CACHE_LEGACY.map((v) => `graded:${v}:${date}`)];
}
