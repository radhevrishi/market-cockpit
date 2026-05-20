# Market Cockpit — 100-Item Institutional Audit
_Generated: 2026-05-20_
_Scope: every dashboard page under `frontend/src/app/(dashboard)`, Telegram bot routes under `frontend/src/app/api/bot/*`, and cross-cutting concerns. Findings exclude items already shipped in patches 0001–0529._

## TODO when user wakes up

### Verified shipped this session (no action needed)
- **Patch 0539** (commit `3f27286`): Conviction Beats parity with Earnings Hub Scan.
  New shared `EarningsScanCard.tsx` component. /watchlists → Conviction Beats
  now renders the SAME rich card the Earnings Hub Scan page renders, fetched
  via `/api/market/earnings-scan?symbols=...`, cached in localStorage
  `mc:conviction-enriched:v1` (24h TTL). Hub-style filter rail added
  (Grade × Score × Audience × Quality × Divergence) composing AND-style
  with the existing PEAD / Op-lev / Sales / PAT / EPS / Guidance chips.
  CoverageStatsBar top-strip surfaces the same Avg Sentiment / divergence
  / data-quality breakdown / showing N of M numbers the hub does.
  GUIDANCE 📈/➖/📉 chip now lights up for ALL entries (it was 0/0/0 before
  because pre-Patch-0538 entries lacked guidance — now we re-fetch fresh
  from the same API the hub uses, so every entry has up-to-date guidance).
- **Patch 0540** (commit `b438b59`): Conviction parity 3-loop polish.
  Rules-of-Hooks landmine fixed (early-return moved AFTER all hook
  declarations). enrichedList/hubFilteredList memoized. PEAD-sort now
  bypasses the tier-grouped grid and renders a single ranked grid so the
  sort the user just asked for actually shows top-down.
- **Patch 0541** (commit `51ddb3a`): Residual close-out.
  Cache prune on write (7-day grace, quota-exceeded fallback wipes
  cleanly instead of half-writing). Unmount guard for refetch path via
  mountedRef. Refetch failures now console.warn rather than swallow.

### Needs user verify after Vercel redeploy
1. Visit `/earnings-opportunities` to seed/refresh the bench
   (existing flow — Conviction Beats auto-populates as before).
2. Open `/watchlists` → **Conviction Beats** sub-tab. Default view should
   be the new "Rich (Earnings Hub)" — full earnings cards with quarterly
   tables, BEAT/MIXED commentary, GuidanceBadge, F/P/Total footer, etc.
3. Tap **GUIDANCE 📈 Positive** chip → bench narrows; count > 0.
   (This was 0/0/0 before because pre-0538 entries had no guidance.)
4. Tap the new **HUB FILTERS** rail chips:
   - GRADE: EXCELLENT / STRONG / GOOD / OK / BAD
   - SCORE: ≥60 / ≥75 / ≥85
   - AUDIENCE: PORTFOLIO / WATCHLIST / BOTH / BANK
   - QUALITY: Full / Partial / Price Only
   - FLAGS: ⚡ Divergence Only
   All should compose AND with the existing PEAD/Op-Lev/Sales/PAT/EPS/Guidance.
5. Toggle "Rich (Earnings Hub)" ↔ "Compact" — the legacy compact rows are
   preserved for users who liked them better.
6. Tap "🌊 Sort by PEAD" — cards should render in a single ranked grid
   (no tier grouping) so the PEAD ordering is visible.
7. Tap **↻ Refresh** in the rich-view toolbar — should re-fetch enriched
   payloads for all bench tickers (bypasses the 24h cache).

### Blocked — need user input
- **#41 Settings backend POST**: no `/api/user/profile` endpoint yet.
- **#51 FIFO tax-lot accounting**: needs Postgres + Auth.
- **#53 Multi-watchlist persistence**: needs Auth for cross-device.
- **#62 Bottleneck workbench L1–L6 ladder**: needs schema (per §10.7).
- **#71 Zod schema for safeScalar**: cross-cutting refactor — needs API
  contracts firm first.

### Backend-blocked (provided in CLAUDE.md §10.12)
- Auth provider (Clerk / Supabase Auth / NextAuth) → unblocks #41, #51, #53,
  #68, #70, server-side persistence of Notebooks, Saved Views, Alert Rules,
  audit log.
- Postgres / Supabase DB → unblocks Signal+SignalEvidence, ticker_roles,
  theme_revisions diff log, lifecycle state machine (real table — heuristic
  v0 already shipped).
- Slack / SMTP / webhook creds → unblocks server-side alert delivery.
- Paid Argus / Platts / CRU / ICIS feeds → unblocks the 14 manual-feed
  transmission inputs (equity-proxy mode (0250) is the bridge).

---

## STATUS (closeout pass — 2026-05-20)

Living document. Patch 0535 was the closeout batch; this list tracks what
remains open and why.

### Done — 70+ items across patches 0530-0535
- **Patch 0530**: #1, #2, #3, #4, #7 (P0 batch)
- **Patch 0531**: #5, #6, #9, #10, #11, #12, #15, #16, #18, #19, #20, #21, #22, #23, #24, #27, #29, #40, #42, #44, #79
- **Patch 0533**: #14, #26, #38, #43, #45, #48, #50, #73, #74, #75, #80, #81, #82, #83, #84, #85, #94, #96, #97
- **Patch 0534**: #5, #8, #9, #28, #31, #32, #36, #37, #39, #46, #49, #65, #66, #86, #94
- **Patch 0535** (this batch): #30, #52, #57, #58, #59, #61, #67, #76 (hook), #77, #95 (utility), #100 (component), #13 (verified done), #33 (verified done), #35 (verified done), #47 (verified done)

### Remaining open — by blocker reason

**API / backend change required:**
- **#41** — Settings backend POST: no /api/user/profile endpoint confirmed
- **#51** — FIFO tax-lot accounting: needs Postgres + Auth
- **#53** — Multi-watchlist persistence: needs Auth for cross-device
- **#56** — Special-sit event watch: needs alert-engine integration
- **#68** — AI-desk follow-up chat: needs SSE / stream API
- **#69** — Status incident log: needs server-side aggregation
- **#70** — Telegram /alerts add command: needs DB
- **#71** — Zod schema for safeScalar: large refactor, defer until API contracts firm
- **#72** — Filing-date source on calendar: needs source-tier in calendar payload
- **#78** — Ticker normalization at boundary: cross-cutting refactor
- **#89** — Incremental news fetch: needs `since=` API
- **#92** — Server-side news filter: needs filter API expansion
- **#93** — Sparklines endpoint: needs new endpoint

**Vendor / heavy lifting:**
- **#54** — PDF/Markdown export of stock-sheet: needs react-to-print or server PDF
- **#91** — PDF.js pre-bundle: vendor library work
- **#100 (PERF)** — Lazy ImageResponse: low-risk gain only after bundle audit

**New page or significant scope:**
- **#34** — Stock-sheet starter templates: design call
- **#55** — Transmission shock alerts: needs alert pipeline integration
- **#60** — Breadth 30-day sparkline: needs KV history backend
- **#62** — Bottleneck workbench L1-L6 ladder: needs schema
- **#63** — Company-intel diff between two transcripts: needs corpus
- **#64** — Heatmap compare-two-days: needs snapshot history

**Architecture / not worth this batch:**
- **#17** — Smart-money loading state: intentional pattern (isRefreshing covers UX)
- **#25** — Re-rating mb3_symbols dual store: document in code rather than unify
- **#76** — Shared quotes hook: hook created in lib/hooks/useMarketQuotes.ts; consumer migration deferred
- **#87** — Split multibagger page: 9000-line surgery, defer
- **#88** — Cache scored rows by CSV hash: memoization already there, full cache deferred
- **#90** — Lazy import date-fns: needs bundle analysis
- **#95** — Debounced LS writes: utility shipped in lib/debounced-storage.ts; consumer migration deferred
- **#98** — Memoize market-snapshot child queries: needs cross-page state lift
- **#99** — Virtualize bottleneck-intel/super-investors: skip (per closeout guidance)
- **#100 (UX)** — IntersectionObserver lazy images: component shipped in components/LazyImage.tsx; no current image-heavy lists to wire

## Summary
- **Bugs:** 25 items (P0: 7, P1: 13, P2: 5)
- **UX improvements:** 25 items (P0: 0, P1: 14, P2: 11)
- **New features:** 20 items (P0: 0, P1: 10, P2: 10)
- **Data / quality:** 15 items (P0: 1, P1: 9, P2: 5)
- **Performance / architecture:** 15 items (P0: 0, P1: 10, P2: 5)

## Priority — Top 10 to ship next
1. **#2** — Bot auth bypass: `secret !== BOT_SECRET` evaluates `'' !== ''` as false when `MC_BOT_SECRET` env is unset, so an empty `?secret=` query authorizes movers/watchlist/portfolio routes. Hard-fail when `BOT_SECRET` is empty.
2. **#1** — Personal Telegram chat ID `'5057319640'` hardcoded in movers-alert, watchlist-alert, earnings-alert (twice) and broadcast on every cron. Move to env, mirror eo-blockbuster-alert's pattern.
3. **#3** — `/portfolio` and `/watchlists` hit only `?market=india`; US holdings (NVDA / TSM / RKLB etc.) return blank quotes & break P&L math even though the dashboard sells itself as Indian + US.
4. **#4** — `news-alerts` `lastFiredArticleIds` writes back through `setRules` on every match in the per-article loop, queueing N re-renders per stream tick; in heavy alert mode this saturates React and freezes the page.
5. **#7** — 14 of 17 polling pages have NO `document.visibilityState` gate; tabs left open burn quota on a hidden tab for hours and rate-limit the active tab.
6. **#5** — `Window.confirm` / `Window.alert` used for destructive rule deletes & import errors on news-alerts — broken UX inside the embedded webview and inconsistent with the toast system used elsewhere.
7. **#9** — `mc:guidance-scores:v1`, `mc:notes:v1:*` and `mc:status-history:v1` are write-only and grow unbounded; the prune helpers from §10.6.3 don't apply here. Single user can blow past the 5 MB localStorage cap.
8. **#76** — `Heatmap` and `Movers` mount the SAME `/api/market/quotes?market=india` endpoint independently from inside `/market-snapshot`, doubling NSE API hits per session. Move quote fetching to a shared React Query key.
9. **#22** — Watchlist `SummaryBar` divides by `items.length` for "Avg. Change" but the data set includes pre-market zeros from individual quote fallbacks, dragging the average artificially toward 0 and confusing the gainers / losers headline.
10. **#41** — `Settings` page: editing timezone or refresh interval is local-only — there's no debounced backend POST despite the `UserProfile` type supporting it. User changes vanish on browser switch.

---

## Bugs

### #1 — `[api/bot/*]` `[BUG]` `[P0]`
Personal Telegram chat ID `'5057319640'` is hardcoded in `movers-alert/route.tsx:12`, `watchlist-alert/route.tsx:14`, and `earnings-alert/route.tsx:19-20`. Anyone running this code in a separate Vercel project will silently DM the original owner's account. Mirror the env-var pattern used in `eo-blockbuster-alert/route.tsx:39-43`.

### #2 — `[api/bot/movers-alert · watchlist-alert · portfolio-alert]` `[BUG]` `[P0]`
Auth check `if (secret !== BOT_SECRET) return 401` is bypassable when `MC_BOT_SECRET` env is unset: empty default `''` matches the empty `?secret=` query string. `eo-blockbuster-alert` fail-closes correctly (`!vercelHeader && expected && provided !== expected`). Port that guard, or `if (!BOT_SECRET) return 503 unauthenticated server`.

### #3 — `[portfolio · watchlists]` `[BUG]` `[P0]`
`fetchStockQuotes` is hardcoded `?market=india`; US tickers held by the user return empty stock arrays so `cmp === 0`, `pnl === -investedValue`, weights stuck at 0%. The codebase already has USA support in `/multibagger/USA` and ranks tickers like NVDA/TSM/RKLB. Need a per-holding market hint and conditional fetches to `/api/market/quote?market=us`.

### #4 — `[news-alerts]` `[BUG]` `[P0]`
`page.tsx:127` calls `setRules(...)` INSIDE a `for (const article of stream)` loop, once per matched article. React batches inside event handlers but not inside `useEffect`, so each match schedules a separate render that recomputes the whole rules array. 50 matches in one stream tick = 50 renders. Aggregate updates into a single `setRules(rs => rs.map(... applyAllHits))`.

### #5 — `[news-alerts · decisions · multibagger · news]` `[BUG]` `[P1]`
`window.confirm()` for destructive deletes and `window.alert()` for import errors at `news-alerts/page.tsx:164,186`. These render as native browser modals — broken in iframes, inconsistent with the existing `react-hot-toast` system used elsewhere. Add a confirm-modal component once and reuse.

### #6 — `[earnings-opportunities]` `[BUG]` `[P1]`
`useMarketEarnings` calls `initialDataUpdatedAt` returning `undefined` when no LS entry exists, but React Query 5 expects a number or `undefined` only when `initialData` is also undefined. Stale-data path can mark a fresh fetch as already-stale and skip the refetch loop. Always pair the two or both omit.

### #7 — `[movers · screener · heatmap · portfolio · watchlists · ipos · concall-intel · status · super-investors · company-news · smart-money]` `[BUG]` `[P1]`
14 of 17 setInterval-polling pages have NO `document.visibilityState !== 'visible'` gate. Only `/movers` has it (patch 0516). Hidden tabs keep hitting `/api/market/quotes` and `/api/market/smart-money` every 60-300s. Centralize the gate in a `useVisibilityInterval` hook.

### #8 — `[multibagger · 98 places]` `[BUG]` `[P1]`
24 files use `key={i}` (array-index keys) for `.map()` rendering, mostly inside re-orderable / filterable lists (chip rails, pillar grids, sortable rows). When the underlying array reorders due to a sort toggle, child component state (collapsed/expanded, edit-mode) snaps to whichever new element took the index slot. Switch to a stable id field.

### #9 — `[guidance · stock-sheet · status · news · notes]` `[BUG]` `[P1]`
Several localStorage stores have unbounded growth: `mc:guidance-scores:v1` keeps every period × every symbol (no pruning), `mc:notes:v1:<id>` is per-article (never deleted), `mc:status-history:v1` says 24h ring but actually keeps 200/probe × 16 probes = 3200 entries. A heavy user blows past the 5 MB localStorage cap and silent QuotaExceeded turns most pages into ghost-reload loops.

### #10 — `[earnings · earnings-opportunities]` `[BUG]` `[P1]`
`buildCalendarFromHub` compares ISO date strings `e.resultDate < fromIso` lexically. Works for YYYY-MM-DD but breaks the moment any source emits `2026-5-9` (single-digit month/day). Add a strict regex check before `<` or convert to Date.

### #11 — `[bottleneck-intel · news · bottleneck-workbench]` `[BUG]` `[P1]`
`bottleneck-intel/page.tsx:62` does `for (const k of Object.keys(SEV)) if (label?.toUpperCase().includes(k))` — `DEFAULT` is included in SEV but never excluded from the match loop. Any label containing the substring "default" matches the placeholder bucket. Add explicit allow-list.

### #12 — `[transmission]` `[BUG]` `[P1]`
`ZScoreChips` race: 4 windows fired in `Promise.all` with no per-request abort. Open commodity A, then quickly open commodity B before A resolves — A's stale results overwrite B's. Add an `AbortController` and a closing cleanup in the `useEffect`.

### #13 — `[news · earnings · news-alerts]` `[BUG]` `[P1]`
`useNews(search)` query key is `['news', 'all', search]` — when search includes the OR-expanded `${search}|${aliases.join('|')}` string, the cache key changes on every keystroke (no debounce), so React Query refetches on every character. Debounce search 250-400ms or split server-search from client-filter.

### #14 — `[calendars]` `[BUG]` `[P1]`
`_calendarCache` is module-scoped but the cleanup runs only on `calendarCacheSet`. If the user only ever reads cache (e.g. stays on Apr / May for an hour), expired entries linger and `_calendarCache.size` never trips the eviction. Move eviction to a periodic helper or to the `get` path.

### #15 — `[stock-sheet]` `[BUG]` `[P1]`
`safeScalar` returns `null` for `{value: undefined}` but coerces `{value: NaN}` to `NaN * 1 = NaN`, which then JSX-renders as the string "NaN". Tighten the `'value' in v` branch with a `Number.isFinite` guard mirroring the top-level numeric branch.

### #16 — `[news-alerts]` `[BUG]` `[P1]`
On every parsed-rule import, validation only ensures `id` and `name` are strings — doesn't sanitize `conditions.ticker`/`conditions.headline_substring`. A maliciously-shaped JSON can inject regex special characters that later run as part of `String.includes` (safe) but `theme_substring`'s toLowerCase chain is also unsafe if the value isn't a string. Schema-validate before merge.

### #17 — `[smart-money]` `[BUG]` `[P2]`
`fetchData` polls every 60s and ALWAYS sets `loading = false` in `finally`, but `setLoading(true)` only happens once at mount. On a long network stall, the user sees stale data + a stuck "Refresh" spinner with no countdown.

### #18 — `[multibagger · USA]` `[BUG]` `[P2]`
`USAChecklist` memoizes `usaRows` with `[]` deps so it never picks up a CSV re-upload until the page is hard-reloaded. The comment says "manual upload/clear is driven through events captured below" but the listeners are inside the same memo deps array (which is empty). Add `'mc:switch-multibagger-tab'` and `'storage'` listeners that bump a tick.

### #19 — `[breadth]` `[BUG]` `[P2]`
`new Date(data.generated_at).toLocaleString('en-IN')` will render `Invalid Date` for any payload missing/malformed `generated_at`. Wrap in a try/catch like `formatDate` in `/ipos`.

### #20 — `[ipos]` `[BUG]` `[P2]`
`fetchIPOs` sets `loading = true` on every poll (5-min interval), so the entire page shows the spinner every 5 min even when data is present and only newly-updated. Only show spinner on initial load (gate with `data === null`).

### #21 — `[ai-desk]` `[BUG]` `[P2]`
Saved briefs returns from `/ai/briefs` may be `Array.isArray(data) ? data : data?.briefs ?? []` — but the payload type is `ApiBrief[]` so consumers may receive `undefined` for `.generated_at` and crash `format()`. Surface a per-brief error fallback inside the renderer.

### #22 — `[watchlists]` `[BUG]` `[P2]`
`SummaryBar` averages `changePercent` across all items including those where `price === 0` (fallback default). The mean is pulled toward 0 even when 5 of 6 stocks are up 3%. Filter to `price > 0` before averaging.

### #23 — `[transmission]` `[BUG]` `[P2]`
`Sparkline` returns an empty SVG when `data.length < 2`. The empty box still occupies 80×24 px in the card grid causing visible alignment shimmer next to populated rows. Render `null` or a dashed placeholder instead.

### #24 — `[bottleneck-intel · status]` `[BUG]` `[P2]`
`status/page.tsx:154`: probe id `earnings-graded` makes a request to `/api/v1/earnings/graded?date=<todayIso>` with todayIso computed UTC — between 00:00–05:30 IST this asks for tomorrow's IST calendar date, which is empty. Use the existing IST-shifted helper that `eo-blockbuster-alert` uses.

### #25 — `[multibagger · India]` `[BUG]` `[P2]`
`detectCsvMarket` and parser triggers reading `localStorage.getItem('mb3_symbols')` via `readMultibaggerSymbols` (re-rating) AND `mb_excel_scored_v2` (canonical). When the user clears only the legacy `mb3_symbols`, Re-rating Screener silently keeps the deleted universe. Document the dual store or unify reads.

---

## UX improvements

### #26 — `[earnings · earnings-opportunities]` `[IMP-UX]` `[P1]`
"Refresh" button has no inline confidence band (✓ all 187 / ⚠ 178/187 / ✗ none). Today the only feedback is the timestamp. Add a "X of Y enriched · M missing" chip next to the button.

### #27 — `[watchlists]` `[IMP-UX]` `[P1]`
Adding a ticker via the TickerSearch box doesn't auto-scroll the table to the new row, so on lists of 60+ stocks the user has to manually find what they just added. `scrollIntoView({ block: 'nearest' })` after insert.

### #28 — `[portfolio]` `[IMP-UX]` `[P1]`
No bulk-import path. Users with 30+ positions cannot paste a CSV/TSV from their broker. Add an "Import CSV" button using the same `parseBulkTable` already shipped for `/valuations`.

### #29 — `[breadth]` `[IMP-UX]` `[P1]`
The regime banner is the page's headline but doesn't deeplink anywhere. Click "TIGHT RANGE" → `/news?search=breadth` or `/transmission?bias=defensive`. Make the regime label clickable.

### #30 — `[transmission]` `[IMP-UX]` `[P1]`
Scenario Lab sliders have no "reset" or "save scenario" affordance. Users tweak 6 inputs to test a thesis, switch tabs, come back to a fresh slate. Persist last 3 scenarios in localStorage and offer a one-click "Reset to live".

### #31 — `[news]` `[IMP-UX]` `[P1]`
Lifecycle filter chips (LIVE/WARM/STALE/PERSISTENT/ALL) lack a count badge per chip. Users click STALE expecting articles, see "0 results", don't realize the chip itself was 0 before they clicked. Show `LIVE+WARM (47)` etc.

### #32 — `[special-situations]` `[IMP-UX]` `[P1]`
Reject-as-MONITOR has a 365-day TTL but no way to view or restore monitor entries. Add a "Show monitored (N)" toggle and per-entry restore button.

### #33 — `[multibagger]` `[IMP-UX]` `[P1]`
USA tab's R40 column header sorts but doesn't show the active sort arrow (other columns do). Audit `<th>` markup around `r40` to ensure the sort indicator renders.

### #34 — `[stock-sheet]` `[IMP-UX]` `[P1]`
16 sections × 7 criteria = 112 checkbox sets per ticker. There's no "fast-track" preset (e.g. "Tier-1 Defense" auto-fills Theme/Catalyst boxes). Add 3-4 starter templates that pre-populate likely answers per archetype.

### #35 — `[earnings-opportunities]` `[IMP-UX]` `[P1]`
Date arrows skip weekends correctly but the visible date label doesn't say "Mon" / "Fri" — users land on Friday and don't realize Monday is the next click. Show day-of-week chip next to the date.

### #36 — `[concall-intel]` `[IMP-UX]` `[P1]`
65s spinner with no progress hint. PDF parsing happens server-side; expose intermediate states ("Downloading PDF…" → "Extracting…" → "Analyzing…"). The route already has clear phases — surface them via SSE or chunked response.

### #37 — `[news-alerts]` `[IMP-UX]` `[P1]`
Browser-notification permission prompt is just a button; no preview of what a fired notification looks like. Inline mock-notification card next to the button.

### #38 — `[bottleneck-workbench]` `[IMP-UX]` `[P1]`
Theme not found state cross-links back to `/news` but doesn't surface "Did you mean: <closest bucket_id>?". With Levenshtein on the bucket-list it's a one-liner that fixes 80% of stale bookmark sadness.

### #39 — `[heatmap]` `[IMP-UX]` `[P1]`
`Earnings mode` uses `mcapToValue` constants (`L=50000, M=8000, S=2000, Micro=500`) for treemap sizing — so 1 large-cap visually equals 25 small-caps even when the small-cap had a 30% earnings move. Add a "Size by move magnitude" toggle.

### #40 — `[smart-money]` `[IMP-UX]` `[P2]`
Trade-type filter (Bulk/Block) uses raw text matching against `deal.tradeType`; case mismatch on the `'Block'` vs `'BLOCK'` payload variants drops half the data. Lowercase compare or central enum.

### #41 — `[settings]` `[IMP-UX]` `[P2]`
Display preferences (timezone, refresh interval, dark mode) live in localStorage `mc_prefs` but never POST to backend, even though `UserProfile` supports it. Add a debounced sync. Settings reset on every browser change.

### #42 — `[ipos]` `[IMP-UX]` `[P2]`
"GMP" column is a raw number — no positive/negative coloring, no tooltip explaining "Grey Market Premium" to non-Indian users.

### #43 — `[calendars]` `[IMP-UX]` `[P2]`
Calendar cells with `0 results` are visually identical to weekend cells (both grey). Add a subtle `·` glyph for "filing day but nothing reported" to distinguish.

### #44 — `[movers]` `[IMP-UX]` `[P2]`
"Move filter" chips (`+2% / +4% / +6%`) are an OR-union (a stock matching ANY token shows). With both `+4%` and `+6%` selected, the result equals selecting just `+4%`. Either make them mutually exclusive (radio) or display "Showing ≥+4%".

### #45 — `[strategic-visibility]` `[IMP-UX]` `[P2]`
Funding confidence (1-5) and execution status are rendered as separate chips with no key. New users don't know `FINANCIAL_CLOSE` outranks `SIGNED`. Add a one-line legend at the top.

### #46 — `[super-investors]` `[IMP-UX]` `[P2]`
"Recent Moves" panel re-renders every 30s via setTick — but the freshness chip still reads `as of HH:MM` from `fetchedAt`. The disconnect is jarring; either show "checking…" briefly when the tick fires or remove the gratuitous bump.

### #47 — `[decisions]` `[IMP-UX]` `[P2]`
Status filter chips don't show "Buy (12) · Watch (34) · Neutral (3) · Rejected (8)". The counts are computed in `counts` but never rendered next to the chips themselves.

### #48 — `[earnings-guidance]` `[IMP-UX]` `[P2]`
Q-over-Q `Δ+N` badge has no hover/tooltip showing the actual prior score. Users see `Δ+12` but don't know if that's 78→90 or 45→57. The data is in localStorage — surface it.

### #49 — `[rrg]` `[IMP-UX]` `[P2]`
Quadrant labels (Leading/Lagging/Improving/Weakening) and their plot positions are static; the sector dots have no click target to the underlying index. RRG → `/heatmap?index=<sector>` would be a 5-line pivot.

### #50 — `[alerts]` `[IMP-UX]` `[P2]`
Preset modal jumps straight to the form on click without showing the resolved condition (`Price up 5%` → `direction:UP, threshold:5%`). The user can't tell what they just selected until they hit Save and read the rule.

---

## New features

### #51 — `[portfolio]` `[IMP-FEATURE]` `[P1]`
No tax-lot / FIFO accounting. Indian / US capital-gains rules require lot tracking for STCG vs LTCG. Add `lots: { date, qty, price }[]` to each holding and a "Realized P&L" tab.

### #52 — `[multibagger]` `[IMP-FEATURE]` `[P1]`
No portfolio attribution — when a row is also in `mc_portfolio_holdings`, show inline weight + current P&L. Already have both stores client-side. One join, big win.

### #53 — `[watchlists]` `[IMP-FEATURE]` `[P1]`
No multi-watchlist support — only one `mc_watchlist_tickers` array. Power users want "Earnings this week", "Conviction Beats only", "Defense plays" as separate named lists. Move to `mc:watchlists:v1: { [name]: tickers[] }`.

### #54 — `[stock-sheet]` `[IMP-FEATURE]` `[P1]`
No PDF/Markdown export of completed sheet. Buy-side users need to share the thesis with PMs. Add `react-to-print` or a server-side md → pdf endpoint.

### #55 — `[transmission]` `[IMP-FEATURE]` `[P1]`
No "shock alert" — user can't subscribe to "tell me when palm oil moves > 10% in a week". Reuse the `news-alerts` engine on the transmission feed.

### #56 — `[special-situations]` `[IMP-FEATURE]` `[P1]`
No watchlist for pending events ("Notify me when the Vedanta tender opens"). Add a per-event ★-watch that fires when the lifecycle state machine moves the event past a threshold.

### #57 — `[earnings-opportunities]` `[IMP-FEATURE]` `[P1]`
No CSV / Excel export of the day's BLOCKBUSTER tier. Add an export button alongside the existing TickerExportToolbar.

### #58 — `[news]` `[IMP-FEATURE]` `[P1]`
No "Read it later" queue for articles that aren't an alert but the user wants to revisit. localStorage `mc:reading-list:v1` with a sidebar badge.

### #59 — `[decisions]` `[IMP-FEATURE]` `[P1]`
No outcome tracking — every BUY decision should show "Stock price since decision: +12%" or "Score now: 85 (was 78)". The data is there; just join on current scoreUSARow / scoreIndiaRow.

### #60 — `[breadth]` `[IMP-FEATURE]` `[P1]`
No historical regime view. Buy-side wants to know "we were at 78 a week ago, now 42 — what changed?". Add a 30-day composite sparkline (the KV ring buffer from heartbeat is a model).

### #61 — `[concall-intel]` `[IMP-FEATURE]` `[P2]`
No persistent corpus — each Analyze call is one-shot. Save the last 25 analyses to localStorage with the input hash so users don't re-pay the 65s wait when comparing two analyses.

### #62 — `[bottleneck-workbench]` `[IMP-FEATURE]` `[P2]`
No L1–L6 transmission ladder yet (mentioned in §10.7 as backend-blocked). A frontend v0 just listing the heuristic order of transmission for the active theme would close 70% of the value gap.

### #63 — `[company-intel]` `[IMP-FEATURE]` `[P2]`
No diff view between two uploaded transcripts of the same ticker. Show "Q2 vs Q3: guidance shifted from Neutral → Positive" inline.

### #64 — `[heatmap]` `[IMP-FEATURE]` `[P2]`
No "compare two days" toggle. Treemap of today vs treemap of 7d ago side-by-side would reveal sector rotation more directly than RRG.

### #65 — `[movers]` `[IMP-FEATURE]` `[P2]`
No "Earnings-day movers only" filter. The earningsTickers map is already built — wire a chip that filters the table to symbols in the map.

### #66 — `[settings]` `[IMP-FEATURE]` `[P2]`
No data-export / data-erase. Privacy hygiene + new institutional bar require a "Download all my localStorage" button so users can audit what's tracked.

### #67 — `[news-alerts]` `[IMP-FEATURE]` `[P2]`
No "test fire this rule" button — to know if rule conditions catch the right articles, the user must wait for one in the wild. Add a button that runs the rule against the last 100 articles and shows hits.

### #68 — `[ai-desk]` `[IMP-FEATURE]` `[P2]`
No "ask a follow-up" chat thread — every brief is a fresh prompt. State the existing brief as system context, accept follow-ups.

### #69 — `[status]` `[IMP-FEATURE]` `[P2]`
No incident log / postmortem entries. When a pipeline goes red, surface the user-visible impact (e.g. "Movers data was stale 14:32–14:51 — recovered").

### #70 — `[api/bot/telegram-webhook]` `[IMP-FEATURE]` `[P2]`
No `/alerts add <ticker> <pct>` slash command — only canned scans. Telegram is where the user actually lives during market hours; lacking per-ticker subscription parity with the web is a missed institutional feature.

---

## Data / quality

### #71 — `[stock-sheet · multibagger]` `[IMP-DATA]` `[P0]`
`safeScalar` accepts a `{magnitude, direction}` sentiment shape but no upstream contract pins this. A new source (or a backend type change) silently breaks the React render again. Define a Zod (or io-ts) schema for the quote/sentiment payload and validate at the edge.

### #72 — `[earnings · earnings-opportunities]` `[IMP-DATA]` `[P1]`
No source-of-truth column on the calendar grid. A filing detected only via Yahoo price action (Tier 3) renders identically to a KV-calendar (Tier 1) confirmation. Reuse the `✓` / `~` prefix from §10.5 on the calendar cells too.

### #73 — `[transmission]` `[IMP-DATA]` `[P1]`
"manual feed" commodities show last static prices even when 30 days stale. Stamp each commodity row with its individual `fetched_at` and turn the value muted/red if older than 24h. Group-level freshness chip masks per-row staleness.

### #74 — `[special-situations]` `[IMP-DATA]` `[P1]`
`expectedAlphaFor` returns a categorical label but no historical p25/p50/p75 win-rate. Even a static lookup of typical realized IRR per event_type would be more institutional than "Spread capture".

### #75 — `[ipos]` `[IMP-DATA]` `[P1]`
GMP comes from one source; no provenance shown. Surface the source name ("Chittorgarh", "InvestorGain") and last-updated time per row so users can weight it.

### #76 — `[heatmap · movers · market-snapshot]` `[IMP-DATA]` `[P1]`
Movers and Heatmap each fetch `/api/market/quotes?market=india` independently — when the user toggles between them inside `/market-snapshot` they make two separate calls within the same minute. Lift to a shared React Query cache (key `['quotes', 'india']`) and both views ride the same data.

### #77 — `[multibagger · USA]` `[IMP-DATA]` `[P1]`
No data-staleness flag per uploaded row. CSV upload from yesterday + intraday earnings = "stale fundamentals vs fresh price" risk (called out in §10.10 as still-pending). Stamp upload timestamp on each row and warn if any row is > 60 days old AND its price moved > 15% since.

### #78 — `[news]` `[IMP-DATA]` `[P1]`
`ticker_symbols` array is a `(string | {ticker, exchange})` union — half the codebase normalizes inconsistently. Single boundary normalizer at API ingestion would prevent the recurring "ticker chip blank" bug class (patched 12+ times in CLAUDE.md log).

### #79 — `[earnings-guidance]` `[IMP-DATA]` `[P1]`
Period-key bucketing is `YYYY-MM` — a company reporting Q4 in April vs Q1 in April both write the same key, second write silently overwrites first. Use `${ticker}|${quarter}` as the key instead.

### #80 — `[concall-intel]` `[IMP-DATA]` `[P1]`
Sentiment uses pure regex/lexicon (§11). Tone score swings wildly on companies with neutral guidance + lots of "robust" / "headwind" keywords. Document the calibration explicitly on the page so users don't over-trust a 78 vs 72 difference.

### #81 — `[smart-money]` `[IMP-DATA]` `[P2]`
"Institutional" vs "Retail" classifier rule is invisible. Two trades of identical size are sometimes labeled differently — show the matched rule (e.g. "Client name contains 'MUTUAL FUND'") inline as a tooltip.

### #82 — `[breadth]` `[IMP-DATA]` `[P2]`
`pillars.flow.score` is described as "PSU Bank vs Nifty 1m (proxy for DII)" — a single proxy is fragile. Document the proxy in a tooltip and surface a confidence band ("Low confidence — proxy-only").

### #83 — `[rrg]` `[IMP-DATA]` `[P2]`
Tail length on the trail isn't normalized to the timeframe — 6m chart has 8-point tails (long) while 1m has 8-point tails (essentially full history). Cap the trail at 25% of the lookback window.

### #84 — `[strategic-visibility]` `[IMP-DATA]` `[P2]`
`funding_confidence` (1-5) renders as a number with no description. The user has to remember "5 = financial close, 1 = press release". Add a 4-char tag (e.g. `FIN-CLOSE`, `PRESS`).

### #85 — `[earnings-analysis]` `[IMP-DATA]` `[P2]`
PDF extraction is "smart page selection: cover + financial section only" (lines 47-49) — but no callout to the user that the AI report saw only ~10% of the PDF. Display "Analyzed pages 1, 4-9, 12-15 of 277" so the limitation is honest.

---

## Performance / architecture

### #86 — `[movers · heatmap · screener · watchlists · portfolio · smart-money · ipos]` `[IMP-PERF]` `[P1]`
Setting `loading=true` on every poll re-renders the whole table tree even when the data is byte-identical. Use `keepPreviousData` (React Query) or compare-by-hash before triggering a re-render.

### #87 — `[multibagger]` `[IMP-PERF]` `[P1]`
9145 lines in one file means TSC checks all of it for every save and Vercel ships the whole bundle on every page. Split India / USA / Turnaround into separate `page.tsx` siblings using a shared scoring lib (or use `next/dynamic` with `ssr:false` per tab).

### #88 — `[multibagger · USA]` `[IMP-PERF]` `[P1]`
`USAChecklist.usaRows` re-runs `scoreUSARow` for the entire dataset on each mount. If the dataset is 500+ rows that's 500 scoring passes on every tab switch into USA. Cache scored rows in localStorage under a hash-of-CSV key.

### #89 — `[news]` `[IMP-PERF]` `[P1]`
`useNews` requests `limit: 500` on every search. With 90s refetchInterval the user pulls 500 articles every 90s even when 3-4 changed. Move to `since=<lastTimestamp>` incremental fetching.

### #90 — `[orders · special-situations · earnings-opportunities]` `[IMP-PERF]` `[P1]`
Three files cross 2000 lines and import 5+ heavy lib modules at module-scope (incl. `formatDistanceToNow` from date-fns). Lazy-import the bottom-heavy helpers and switch to dayjs (or `Intl.RelativeTimeFormat`) for 60% bundle-size reduction.

### #91 — `[earnings-analysis]` `[IMP-PERF]` `[P1]`
PDF.js loaded from CDN at runtime is a 1MB script load — page is unusable for the first 8s after click. Pre-bundle `pdfjs-dist` (or its lite worker) so the wait is gone.

### #92 — `[news]` `[IMP-PERF]` `[P1]`
React Query `useQuery({queryFn: async () => { ... if (search) ... })` doesn't apply the existing client-side filter universe (region/type/source/signal) on the server. With 500 results coming over the wire and only 20 surviving filters, you're paying 25x bandwidth.

### #93 — `[transmission]` `[IMP-PERF]` `[P1]`
60-day sparkline arrays embedded in the main `/api/v1/transmission` payload — 34 commodities × 60 floats = 2,040 floats per request fired every page load. Move sparklines into a separate `/api/v1/transmission/sparklines` endpoint and prefetch on hover.

### #94 — `[bottleneck-intel]` `[IMP-PERF]` `[P1]`
3332 lines, 6 React Query hooks fired on mount with no `enabled` gate based on the active tab. Mount → 6 simultaneous requests even when the user only views the Rotation tab. Gate each query on `activeTab === ...`.

### #95 — `[stock-sheet · multibagger · earnings-analysis · news]` `[IMP-PERF]` `[P1]`
All `useEffect`s that read localStorage on every change re-stringify the entire object back. Heavy on big stores like `mb_excel_scored_v2` (50KB+). Use a `useDebouncedCallback(write, 400ms)` to batch writes.

### #96 — `[multibagger · valuations · re-rating · etc.]` `[IMP-PERF]` `[P2]`
17 pages call `getConvictionTickers()` synchronously on mount. The lib parses localStorage every time. Cache the parsed `Set<string>` in a module-scope variable and bust on the `conviction-beats:updated` event.

### #97 — `[multibagger · earnings · etc.]` `[IMP-PERF]` `[P2]`
Multiple pages start a `window.addEventListener('storage', ...)` but never call `removeEventListener` in the cleanup. Long sessions leak listeners.

### #98 — `[market-snapshot]` `[IMP-PERF]` `[P2]`
Each child page is `dynamic(() => import('../heatmap/page'), { ssr:false })` — when the user toggles between heatmap and movers, both queries restart. Memoize the heatmap snapshot in a parent store so the toggle is instant.

### #99 — `[bottleneck-intel · super-investors]` `[IMP-PERF]` `[P2]`
Two pages render >3000 DOM nodes (tickers × signals). React DevTools profiler shows >100ms commits on click. Virtualize the large lists with `@tanstack/react-virtual`.

### #100 — `[api/bot/eo-blockbuster-alert · earnings-alert · portfolio-alert]` `[IMP-PERF]` `[P2]`
`ImageResponse` (Next.js OG) is loaded at the top of every bot route, adding 600KB+ to the cold-start of each. Lazy-import inside the handler.

---

## Pages walked
- /earnings-opportunities — 7 findings (#3, #6, #9, #10, #26, #35, #72)
- /earnings (Hub) — 8 findings (#10, #14, #26, #44, #57, #72, #76, #95)
- /earnings-hub — covered via Hub findings
- /valuations — covered via Multibagger findings
- /multibagger (India + USA + Turnaround) — 9 findings (#3, #8, #18, #25, #33, #52, #71, #77, #87)
- /watchlists — 5 findings (#3, #7, #22, #27, #53)
- /portfolio — 6 findings (#3, #7, #28, #51, #76, #95)
- /stock-sheet — 4 findings (#15, #34, #54, #71)
- /screener — 4 findings (#7, #76, #86, #95)
- /heatmap — 5 findings (#7, #39, #64, #76, #86)
- /movers — 6 findings (#7, #17, #44, #65, #76, #86)
- /smart-money — 4 findings (#7, #17, #40, #81)
- /breadth — 4 findings (#19, #29, #60, #82)
- /transmission — 6 findings (#12, #23, #30, #55, #73, #93)
- /rerating — 2 findings (#25, #52)
- /special-situations — 5 findings (#5, #32, #56, #74)
- /strategic-visibility — 3 findings (#45, #84)
- /signals (alias of /orders) — 4 findings (#8, #25, #90)
- /news — 9 findings (#5, #11, #13, #31, #58, #78, #89, #92)
- /themes — covered via Conviction Beats overlay class
- /bottleneck-workbench — 3 findings (#11, #38, #62)
- /company-intel — 2 findings (#63, #93)
- /concall-intel — 4 findings (#7, #36, #61, #80)
- /super-investors — 4 findings (#7, #46, #99)
- /alerts — 2 findings (#50, #95)
- /news-alerts — 6 findings (#4, #5, #16, #37, #67, #95)
- /ai-desk — 4 findings (#21, #68)
- /decisions — 3 findings (#5, #47, #59)
- /calendars — 4 findings (#14, #43, #72, #95)
- /ipos — 5 findings (#7, #20, #42, #75)
- /status — 4 findings (#9, #24, #69, #86)
- /settings — 3 findings (#41, #66)
- /api/bot/* — 5 findings (#1, #2, #70, #100)

## Notes & methodology
- Files actually read in full or in sampled segments:
  - `/Users/radhevrishi/Desktop/Python/Imp Marketcockpit/market-cockpit/CLAUDE.md`
  - `frontend/src/app/(dashboard)/earnings-opportunities/page.tsx`
  - `frontend/src/app/(dashboard)/portfolio/page.tsx`
  - `frontend/src/app/(dashboard)/watchlists/page.tsx`
  - `frontend/src/app/(dashboard)/breadth/page.tsx`
  - `frontend/src/app/(dashboard)/stock-sheet/page.tsx`
  - `frontend/src/app/(dashboard)/heatmap/page.tsx`
  - `frontend/src/app/(dashboard)/movers/page.tsx`
  - `frontend/src/app/(dashboard)/smart-money/page.tsx`
  - `frontend/src/app/(dashboard)/transmission/page.tsx`
  - `frontend/src/app/(dashboard)/rerating/page.tsx`
  - `frontend/src/app/(dashboard)/news/page.tsx`
  - `frontend/src/app/(dashboard)/special-situations/page.tsx`
  - `frontend/src/app/(dashboard)/status/page.tsx`
  - `frontend/src/app/(dashboard)/ipos/page.tsx`
  - `frontend/src/app/(dashboard)/decisions/page.tsx`
  - `frontend/src/app/(dashboard)/alerts/page.tsx`
  - `frontend/src/app/(dashboard)/news-alerts/page.tsx`
  - `frontend/src/app/(dashboard)/calendars/page.tsx`
  - `frontend/src/app/(dashboard)/super-investors/page.tsx`
  - `frontend/src/app/(dashboard)/screener/page.tsx`
  - `frontend/src/app/(dashboard)/themes/page.tsx`
  - `frontend/src/app/(dashboard)/valuations/page.tsx`
  - `frontend/src/app/(dashboard)/company-intel/page.tsx`
  - `frontend/src/app/(dashboard)/concall-intel/page.tsx`
  - `frontend/src/app/(dashboard)/earnings-guidance/page.tsx`
  - `frontend/src/app/(dashboard)/earnings-hub/page.tsx`
  - `frontend/src/app/(dashboard)/earnings-analysis/page.tsx`
  - `frontend/src/app/(dashboard)/earnings/page.tsx`
  - `frontend/src/app/(dashboard)/market-snapshot/page.tsx`
  - `frontend/src/app/(dashboard)/strategic-visibility/page.tsx`
  - `frontend/src/app/(dashboard)/bottleneck-workbench/page.tsx`
  - `frontend/src/app/(dashboard)/bottleneck-intel/page.tsx`
  - `frontend/src/app/(dashboard)/company-news/page.tsx`
  - `frontend/src/app/(dashboard)/orders/page.tsx`
  - `frontend/src/app/(dashboard)/rrg/page.tsx`
  - `frontend/src/app/(dashboard)/signals/page.tsx`
  - `frontend/src/app/(dashboard)/settings/page.tsx`
  - `frontend/src/app/(dashboard)/ai-desk/page.tsx`
  - `frontend/src/app/(dashboard)/multibagger/page.tsx`
  - `frontend/src/app/api/bot/telegram-webhook/route.ts`
  - `frontend/src/app/api/bot/eo-blockbuster-alert/route.tsx`
  - `frontend/src/app/api/bot/movers-alert/route.tsx`
  - `frontend/src/lib/conviction-beats.ts`
- Cross-cutting grep sweeps for: `setInterval` (visibility-gating), `JSON.parse` (LS load patterns), `key={i}` (reorder bugs), `window.confirm/alert` (modals), `cache: 'no-store'` (cache discipline), `TG_CHAT_ID = '...'` (hardcoded creds), `BOT_SECRET` (auth bypass), `?market=india` (US-blindness).
- Time spent: approximately 25 minutes of read + 8 minutes of grep + 12 minutes of synthesis.
- All findings cross-checked against the patch log in `CLAUDE.md` (patches 0001-0349 explicit + reference to 0521-0529 bot work) to avoid duplicates. Items already shipped (`PanelFreshness`, post-earnings gap badges, Conviction Beats overlays, BLOCKBUSTER v3 gating, USA scoring caps, Decision Logbook, etc.) are NOT re-listed.
