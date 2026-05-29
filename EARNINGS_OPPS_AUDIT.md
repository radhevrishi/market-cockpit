# Earnings Opportunities + Conviction Beats — Audit & 10-Year Plan
_Last updated: 2026-05-29 (Patches 1021–1031)_

This is the most important surface in Market Cockpit. This doc explains why it
felt unreliable (constant Hard Refresh / backfill), what was fixed, what bugs
remain, and what to build so it runs itself for the next decade.

---

## 1. THE ROOT CAUSE of "I always have to Hard Refresh / backfill"

The app was moved off Vercel onto Railway, but **every scheduled background job
still pointed at the old Vercel URL — which now returns HTTP 402 (account
suspended).** So none of the warming jobs ever reached the live site.

On top of that, the one job that pre-warms the graded cache
(`prewarm-earnings`, which warms the last 7 days) **was never even on the
schedule.**

Result: nothing kept the cache warm on Railway. Every time you opened the page,
you were the one paying the cold-build cost — which is exactly why you had to
Hard Refresh and backfill by hand.

**Fixed in Patch 1031:**
- All cron jobs now target the Railway URL (overridable via the optional
  `CRON_BASE_URL` GitHub secret if the host ever changes again).
- `prewarm-earnings` is now scheduled **4× daily** (08:30 / 11:30 / 16:30 /
  19:30 IST) so the last 7 days of graded data are always warm.
- The cron routes now accept `POST` (the GitHub bridge POSTs; the routes were
  `GET`-only and were silently 405-ing even when the URL was right).

**What you should see:** after this, opening Earnings Opportunities should be an
instant warm hit on any recent date — no Hard Refresh, no backfill needed.

---

## 2. THE DEEPER ISSUE — the cache store itself is lossy (Upstash free tier)

Even with warming fixed, there's a second problem: the durable cache (Upstash
Redis, free tier) is **evicting data under memory pressure**. Observed live:
`graded:v8:2026-04-28` went from "cache hit" (32 companies) to "cache miss"
(evicted) within minutes. That's why April kept flickering between "264
filings" and "No filings."

This is **infrastructure, not code** — and it's the single biggest thing
holding the product back.

**Mitigations already shipped:**
- Patch 1026 — durable month snapshots + reconstruct a past month from the
  per-date graded caches.
- Patch 1028 — never serve/store an empty past-month from the in-memory cache.
- Patch 1030 — eviction-proof static seed for April (lives in the deploy
  bundle; can never be evicted).

**The real fix (recommended, see §5):** move durable storage off the free
Upstash tier to a paid Redis or (better) a real database. Then nothing is ever
evicted and every layer above it stops flickering.

---

## 3. BUGS / ISSUES STILL OPEN

| # | Issue | Severity | Notes |
|---|-------|----------|-------|
| B1 | Upstash free-tier eviction drops graded/enrich/snapshot keys | **HIGH** | The deep cause of flicker + cold cache. Needs paid Redis or DB. |
| B2 | Cache poisoning: `graded:v8:<date>` gets overwritten with an EMPTY payload when the month hub is briefly empty | **HIGH** | Saw 04-28 go 32→0. Graded should refuse to cache an empty rebuild when the hub returned 0 for a past date. |
| B3 | Static seed only covers April | MEDIUM | Other past months still vanish if evicted. Seed the May peak + each completed month. |
| B4 | Conviction Beats bench shrank (≈172 → 77) | MEDIUM | Partly correct (stricter margin/loss/turnaround gates), partly the "Re-validate" pruning while dates were returning empty. Re-validate should NOT prune a stock when its date payload is empty/errored (empty ≠ demoted). |
| B5 | Conviction Beats + Decision Logbook live only in browser localStorage | MEDIUM | Not synced across devices; cleared if the browser is wiped. Needs Auth + DB. |
| B6 | Enrichment lag on 140–260 filing days | LOW (mitigated) | Auto-converge (1027) now chips away automatically; upstream Screener rate-limit is the ceiling. |

---

## 4. WHAT'S BEEN FIXED THIS SESSION (1021–1031)

- 1021 — fixed the `client_timeout_45s` error (reverted a forced-uncached path).
- 1022/1023 — market-cap in ₹Cr on cards + cap-range filter on EO and
  Conviction Beats; "quality STRONG" path (a great print no longer misses STRONG
  by 1 composite point); near-zero gap/D1 shows "flat" not "-0%".
- 1024 — Multibagger ₹5k–50k market-cap band.
- 1025 — Slow Backfill runs newest-first (warms data-rich recent dates first,
  not empty pre-season March).
- 1026/1028/1029/1030 — durable calendar memory so past months (April) stop
  going blank.
- 1027 — heavy-day auto-converge (busy days fill themselves, no manual refresh).
- 1031 — **the big one:** scheduled warming actually reaches Railway now.

---

## 5. THE 10-YEAR PLAN (priority order)

**P0 — Get off the free Upstash tier.** Either upgrade Upstash (paid) or move
durable data to Postgres/Supabase (free tier is generous and doesn't evict).
This single change eliminates B1, B2, B3 and most of the flicker/refresh pain
permanently. Everything else is a workaround until this is done.

**P1 — Stop caching empty payloads anywhere (B2).** A rebuild that produced 0
rows for a past date must never overwrite a good cache entry. This is a small,
safe guard in the graded route.

**P2 — Auth + per-user DB (B5).** Once there's a database, move Conviction Beats,
the Decision Logbook, watchlists, and saved views server-side so they sync
across your phone/laptop and survive a browser wipe. This is what turns it from
"a tool on one browser" into "my book, everywhere."

**P3 — Seed every completed month (B3).** Snapshot each finished month into the
deploy bundle (like April) as a permanent floor, independent of cache health.

**P4 — A real status page.** One screen showing: is the cache warm? when did
the last cron run? how many dates are fully enriched? So you never have to guess
whether the data is fresh — and never reflexively Hard Refresh.

**P5 — Conviction Beats re-validate hardening (B4).** Never prune a bench stock
when its date payload is empty/errored; only prune on a confirmed downgrade.

---

## 6. "How do I make it smooth?" — short answer

You shouldn't have to touch Hard Refresh or backfill at all. After Patch 1031
the system warms itself 4× a day on Railway. The only reason you'd still see a
cold/empty state is the Upstash eviction (B1) — and the permanent cure for that
is P0 (paid cache or a database). Do P0 and the manual-refresh era is over.
