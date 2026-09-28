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
// zzz670 — v19 → v20. A newly-listed filer now gets Quality × Inflection: the
//   preview path returned before the quadrant was computed, so Shiprocket
//   showed no Q and no I while the feed carried ROCE, operating margin and a
//   sequential trend — none of which needs a year-ago quarter.
// zzz674 — v20 → v21. A FIFTH India hard ceiling: a company below ₹100 Cr of
//   market cap (or below ₹500 Cr and barely trading) is capped at MIXED. The
//   chart term had been filtering these out by accident — a shell has no stage
//   and no RS, so it scored near the technical floor — and zzz673 is about to
//   take the chart out of the tier. Making the filter explicit is what keeps
//   the V2 split from promoting ₹1 Cr shells alongside Bharat Dynamics.
//   Demotes nothing that was above MIXED (verified 0 of 276 on 2026-08-14).
// zzz691 — v21 → v22. 'optical eps' stopped flagging operating leverage. The
//   tag fired on SIZE alone (EPS >= 3x sales, or EPS >= 200%), which is the
//   arithmetic of every genuine margin expansion — Morepen took margin from
//   6.0% to 14.0% on +34% revenue and was capped at MIXED for it, as were BDL
//   (-18% -> +15%), PTCIL (9% -> 25%) and KMEW (41% -> 64%). The tag now tests
//   what its name claims: a tiny base, EPS outrunning PAT, operations still
//   loss-making, or EPS beyond twice what sales and margin together explain.
//   20 of the 42 tagged rows on 2026-08-14 were mislabelled leverage.
// zzz800 — v22 → v23. Four changes alter what an India grade SAYS:
//   · PAT/EPS growth is REFUSED off a negative year-ago base (it arrived as
//     (curr − prev)/|prev| — KABRAEXTRU's loss ₹7.61 → ₹1.74 Cr read "+77%")
//     and the move is described instead ("loss narrowed ₹7.61 Cr → ₹1.74 Cr");
//   · a NARROWING loss carries 'still loss-making' (10), not 'low quality' (25);
//   · a loss-narrowing operating turnaround (loss at least halved, revenue
//     +25%, margin +5pp and positive) can be STRONG;
//   · a Day-1 sell-off may cost the top tier but can no longer push a
//     fundamentally STRONG quarter to MIXED (the US floor, ported).
// zzz819 — v23 → v24. The India grade is price-free and the top tier needs
//   confirming:
//   · no price input reaches the tier — Day-1 reaction, stage, 52-week
//     distance and thin float are MARKET CONTEXT, shown beside the grade
//     (the US rule since zzz804); the chart methods no longer count and the
//     tier reads the price-free composite;
//   · a BLOCKBUSTER on the numbers must pass a confirmation gate (revenue
//     +15%, no small-base profit arithmetic, a healthy margin or a big
//     expansion, cash backing when known, no open quality flag) or it is
//     held at STRONG / MIXED with a one-line reason;
//   · every card stores the grader's own input (`grade_input`), so a future
//     rules change regrades stored days in-process (lib/india-regrade.ts)
//     instead of re-queuing the whole window. v23/v22/v21/v20 days are
//     regraded from their card figures on first read.
// zzz821 — v24 → v25. Cash is same-fiscal-year CFO ÷ PAT or unknown (the
//   ratio had been annual CFO ÷ ONE quarter's profit, ~4× too high); a first
//   profit after a loss, a market-driven earner (investment / trading
//   company) and an unexplained profit jump (F forensic check not passed)
//   cannot be BLOCKBUSTER; problems are counted by kind and two or more make
//   MIXED; a STRONG floor (no operating loss, no falling profit, no large
//   loss, OPM ≥ 5%, slow revenue needs a real margin); PAT vs EPS graded on
//   the lower, or held when they point opposite ways; one lender detection
//   shared with the card. v24 and v20–v23 days regrade in-process.
export const GRADED_CACHE_VERSION = 'v25';

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
export const GRADED_CACHE_LEGACY: readonly string[] = ['v24', 'v23', 'v22', 'v21', 'v20', 'v19', 'v18', 'v17', 'v16', 'v15', 'v14', 'v13', 'v12', 'v11', 'v10'];

/** Current key first, then the abandoned ones — for readers that tolerate age. */
export function gradedKeyCandidates(date: string): string[] {
  return [gradedKey(date), ...GRADED_CACHE_LEGACY.map((v) => `graded:${v}:${date}`)];
}
