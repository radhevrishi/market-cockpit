# Market Cockpit — Audit Log (refreshed)

_Last refresh: 2026-05-21 — Patch 0582 (post-0574→0581 sweep)._

> This document used to track 100+ items across bugs / UX / data / perf /
> features. After the 0574-0581 batch (and the 0569 P3-UX bundle, plus the
> Patch 0573 analytics refresh), ~95% of original items have shipped.
> A spot-verification pass confirmed: bugs #1 #2 #4 #5 #7 #9 #10 #11 #12
> #13 #14 #15; UX #26-#50 sample (#42 #44 #47 #48 #49); data #77 #79 are
> all closed. Rather than maintain the legacy 100-item list as ghost
> records, this file is now scoped to **what's actually still open**.
>
> If you need the original full audit, it's in git history at commit
> a4e9692 (Patch 0568).

---

## Status snapshot (2026-05-21 EOD)

- **HEAD on `origin/main`**: `ee45539` (Patches 0579-0581 batch)
- **Patches shipped this session**: 0549 → 0581 (33 patches)
- **Type-check**: clean (`tsc --noEmit` exits 0)
- **All P0/P1 audit bugs**: verified closed
- **All 9 P3 UX items**: shipped (Patch 0569)
- **TheWrap modules 1/3/4/5**: shipped (Patch 0579 as news chips)
- **TheWrap module 2** (Rating Actions): shipped (Patch 0580 as own page)
- **TheWrap module 6** (Capacity util): shipped (Patch 0581 in Concall Intel)
- **Operating Leverage Cluster framework**: shipped (Patch 0578)
- **Cash-Rich / Net-Zero Debt lens**: shipped (Patch 0578.5)

---

## Still genuinely open (infrastructure-blocked)

These need a user decision before any line of code can ship. Listed in
priority order — Auth first unlocks the most downstream features.

### Auth provider choice (Clerk / Supabase / NextAuth)
Unlocks:
- Server-side persistence of Thesis Notebooks, Saved Views, News Alert
  Rules, Decision Logbook (currently per-browser localStorage)
- Multi-watchlist support
- FIFO tax-lot accounting on Portfolio
- Audit log for source-tier curation

### Postgres / Supabase DB provisioning
Unlocks:
- Signal + SignalEvidence schema (replaces client-side `__priority` /
  classifier_features fields)
- Real ticker_roles table (replaces heuristic v0)
- theme_revisions diff log
- Special-Situations lifecycle state-machine persistence
- Transmission regression coefficients (already have z-score in 0324)
- Breadth 30-day composite sparkline

### Slack / SMTP / webhook creds
News Alert Rules currently only fire as browser Notifications + on-screen
toasts. JSON import/export (Patch 0279) keeps rules portable across
browsers. Server-side delivery requires these creds.

### Paid data feeds (Argus / Platts / CRU / ICIS)
14 transmission commodities run in equity-proxy mode (Patch 0250) until
these subscriptions land. Z-score statistical layer (0324) gives
directional signal in the meantime.

### SEC EDGAR deep parser
Basic submissions API adapter shipped (Patch 0318). Full extraction of
merger terms / offer prices / SC TO-T / Schedule TO / 10-12B /
DEFM14A still needs a structured parsing pipeline.

---

## Still open (architecture-blocked, but not infra)

### Multibagger page split (legacy AUDIT #87)
File is now 9.1K lines. Splitting India / USA / Turnaround / Analytics
into sibling page.tsx files using a shared scoring lib is a meaningful
refactor (~2-3 days of focused surgery). Deferred deliberately — the
single-file form is type-checking cleanly and the test surface is small.

### Per-row TradingView refresh / live quotes on USA rows
Today USA rows are CSV-snapshot only. The Stale-Fundamentals chip
(Patch 0576) is the institutional answer for now. A live quote fetcher
hooked to the existing /api/market/quotes endpoint would be a follow-up.

### Liquidity-driven dynamic position sizing
Patch 0577 surfaces ADV as an info chip and parses Average Volume from
TradingView. The `suggestedMaxPositionPct` field is still mcap-tiered
(Patch 0349); incorporating ADV into that calculation is a follow-up.

---

## Latent items (low priority, no user pressure)

### Architecture
- 9100-line multibagger/page.tsx → split (see above)
- 17 pages call `getConvictionTickers()` — module-scope cache shipped in
  Patch 0574; pages just consume the cached Set now (no migration needed)

### Performance
- Movers + Heatmap mount /api/market/quotes independently inside
  market-snapshot (AUDIT #76). Shared React Query key would halve
  outbound quote requests in that view.
- 60-day sparkline payload on /api/v1/transmission is 2040 floats per
  request. Split into /transmission/sparklines endpoint + prefetch on
  hover (AUDIT #93).

### Data quality
- Single boundary normalizer for ticker_symbols union — already patched
  ~12 times across the codebase. A Zod schema at API ingestion would
  pay off long-term (AUDIT #78).
- USA scoring still doesn't have a one-source contract for the
  `{magnitude, direction}` sentiment shape (AUDIT #71). Adding Zod at
  the API boundary is a larger refactor.

---

## Closed since last audit (verification pass — Patch 0582)

The legacy bug list claimed these were open as of 2026-05-20. Each has
been verified shipped in code as of the 2026-05-21 sweep:

- **#1**: hardcoded `5057319640` chat ID — not present anywhere in
  `/api/bot/*` (verified via grep).
- **#2**: bot auth bypass — all 4 bot routes fail-closed (503) when
  `MC_BOT_SECRET` env is unset.
- **#4**: news-alerts setRules in for-loop — already batched via
  `setRules(rs => rs.map(...))` after aggregating hitsByRule.
- **#5**: window.confirm / alert — replaced with react-hot-toast.
- **#7**: visibility-state gate — `lib/hooks/useVisibilityInterval.ts`
  exists, wired into 11 polling pages.
- **#9**: unbounded localStorage — all three keys bounded
  (mc:guidance-scores:v1, mc:status-history:v1, mc:notes:v1).
- **#10**: lexical date compare in buildCalendarFromHub — ISO_DATE_RE
  guard in place.
- **#11**: SEV 'DEFAULT' substring in bottleneck-intel — fixed.
- **#12**: ZScoreChips race — AbortController + cleanup added.
- **#13**: useNews query-key debounce — `debouncedSearch` shipped.
- **#14**: calendar cache eviction on read — calendarCacheGet calls
  evictExpiredCalendarCache on every read.
- **#15**: safeScalar NaN — Number.isFinite guard + recursive fallback.
- **#42**: IPO GMP tooltip + coloring — shipped.
- **#44**: movers "Showing ≥+X%" labeling — shipped with OR-semantics hint.
- **#47**: Decision Logbook chip counts — `· N` rendered next to label.
- **#48**: Earnings Guidance Δ tooltip with prior score — shipped.
- **#49**: RRG sector dot click → /news?search= (Shift+click → /heatmap).
- **#77**: stale-fundamentals row warning — page banner shipped in 0349;
  per-row chip in Patch 0576.
- **#79**: period-key collision — uses `${ym}|${quarter}` when quarter known.

---

## How to use this doc

1. When auditing the app, scan **"Still genuinely open"** first.
2. Anything in **"Closed since last audit"** is shipped — don't
   reopen unless behaviour regresses (in which case file a fresh entry
   under the appropriate section above).
3. If you find a new bug or gap that doesn't fit any open category,
   add it under a new H3 section with a clear "Open since YYYY-MM-DD"
   date stamp so future audit passes can verify shelf life.
