# Market Cockpit — Claude Handoff Memory

> Read this FIRST when starting any new chat. Saves you 30 minutes of context-rebuilding.
> Last updated: 2026-05-12 (after Patch 0239 — batch-3 v0 stubs of backend-blocked items).

---

## 1 · Identity & Goal

- **Project:** Market Cockpit — Bloomberg-lite dashboard for Indian + US equities (NSE focus).
- **Repo:** `https://github.com/radhevrishi/market-cockpit` (branch: `main`).
- **Owner:** Rishi (`radhev.232@gmail.com`).
- **Stack:** Next.js 14 App Router (TypeScript), React Query v5, Vercel hosting, Upstash Redis KV, Railway worker (occasionally stale).
- **Live URL:** `https://market-cockpit.vercel.app`
- **The bar:** EarningsPulse.ai quality. User often compares to it. No hallucinations, no stale data, must feel like a paid product.

---

## 2 · Working-Folder Map (CRITICAL)

```
/Users/radhevrishi/Desktop/Python/Imp Marketcockpit/market-cockpit/   ← repo root (the user's selected folder)
├── frontend/                                                          ← Next.js app
│   ├── src/app/(dashboard)/                                           ← all dashboard pages
│   ├── src/app/api/                                                   ← Next.js API routes
│   ├── src/lib/                                                       ← shared libs (kv, nse, conviction-beats etc.)
│   ├── src/components/                                                ← shared React components
│   └── vercel.json                                                    ← cron schedule + edge rewrites
└── 00XX-*.patch                                                       ← historical patch files (informational only)
```

**File-tool paths use this prefix.** Bash sees them under `/sessions/zen-epic-bardeen/mnt/market-cockpit/`.

---

## 3 · Architecture (what runs where)

| Tier | Service | What it does |
|---|---|---|
| Edge | Vercel | All Next.js routes (`/api/v1/*`, `/api/market/*`), SSR pages |
| KV | Upstash Redis | Hot cache: `graded:v8:<date>`, `enrich:v5:<sym>:<date>`, `earnings-cal:auto:<date>`, `post-gap:v1:<sym>:<date>:<timing>`, `auto-fill:v1:<date>`, scheduled-tasks state |
| Cron | Vercel Cron | Daily refresh of earnings calendar (06:30 IST), market intelligence, watchlist alerts |
| Worker | Railway (`mc-pulse-bots.onrender.com` BSE proxy, separate Railway scraper) | Background Screener scrape — often goes stale; we built Vercel-side enrichment to bypass |
| External API rewrite | `vercel.json` rewrites `/api/v1/*` → Render backend `https://market-cockpit-api.onrender.com` BUT file-based routes win first, so locally-implemented `/api/v1/*` endpoints take precedence over the rewrite |

**Two routes you'll touch most:**
- `frontend/src/app/api/market/earnings/route.ts` — universe builder (NSE + BSE + KV calendar)
- `frontend/src/app/api/v1/earnings/graded/route.ts` — per-date grading with KV cache

---

## 4 · Required Env Vars (Vercel project)

Don't ask the user for actual VALUES — they're already set in Vercel. Just know the **names**:

| Env var | Purpose |
|---|---|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `_TOKEN`) | Upstash Redis KV (read via `@/lib/kv` → `kvGet`, `kvSet`, `isRedisAvailable`) |
| `CRON_SECRET` (optional) | Auth gate on `/api/v1/cron/refresh-earnings-calendar` |
| `ANTHROPIC_API_KEY` (optional, future) | Concall Intelligence v2 (`/api/v1/concall/analyze`) currently uses pure regex/lexicon, no LLM. If env added, can route through Claude for deeper analysis. |

All others are in `vercel.json` `crons` array — secrets passed as URL query params (`?secret=mc-bot-2026` for example).

---

## 5 · Key Pages and Their Caching

| Page | Cache layer | TTL |
|---|---|---|
| `/earnings-opportunities` | localStorage `mc:graded:v8:<date>` + `mc:hub:v2:<months>` + KV `graded:v8:<date>` | past 7d, today 15m |
| `/earnings` (Earnings Hub Scan) | localStorage `mc:earnings-scan:v1` + React Query staleTime | 1h, auto-invalidates on month change |
| `/watchlists` | localStorage `mc_watchlist_tickers` + `mc:conviction-beats:v1` | manual |
| `/stock-sheet` | localStorage `mc:stock-sheet:v3:scrub-2026-05:<ticker>` | per-ticker |
| `/special-situations` | localStorage `mc:specsit:rejected:v1` | manual |
| `/breadth`, `/transmission`, `/strategic-visibility` | React Query staleTime 5-10min | rolling |

**Always cache-bust strategy when shape changes:** bump the version suffix (`v7 → v8`).

---

## 6 · Critical Data Quirks (THINGS THAT BIT ME)

1. **Digit-leading tickers** (`3IINFOLTD`, `5PAISA`, `63MOONS`, `360ONE`): `isValidSymbol` in `/enrich` historically used `/^[A-Z][A-Z0-9&-]/` which **silently dropped** them. Now uses `/^[A-Z0-9][A-Z0-9&-]/`. ALWAYS check other regex validators when adding new endpoints.
2. **Date attribution**: a scheduled board meeting is NOT proof of filing. KV calendar entries from `0181` cron must be `quality: 'Upcoming'` regardless of date until explicit confirmation arrives. See `/api/market/earnings/route.ts` Step 6.4.
3. **Empty `/enrich` cache poisoning**: when NSE/Screener returns null for a ticker, cache TTL is **5min** (not 6h) so retries actually retry. See Patch 0194.
4. **Vercel.json rewrite gotcha**: `/api/v1/:path*` is rewritten to `market-cockpit-api.onrender.com`, BUT Next.js file-based routes take priority. So if you add a file at `src/app/api/v1/foo/route.ts` it works locally. If you don't, requests go to Render backend (which may not have `/api/v1/foo`).
5. **Indian markets weekend skip**: `shiftDate(-1)` in `/earnings-opportunities` skips Sat/Sun — don't break that.
6. **React #31 error history**: `{direction, magnitude}` objects rendered as JSX children. `safeText()` + `safeScalar()` helpers exist in `/stock-sheet/page.tsx`. Always coerce at boundary (load/save).
7. **Browser cache vs server KV**: refetch fetches need `cache: 'no-store'` or browser can serve stale HTTP responses even when KV is fresh. See Patch 0192.
8. **Stale localStorage**: when server returns "no-op" on refresh, wipe localStorage for that key and force a refetch. Patch 0190.

---

## 7 · Conviction Beats Pipeline (custom architecture)

User's institutional bench, auto-populated from `/earnings-opportunities`.

- **Storage:** `lib/conviction-beats.ts` — localStorage `mc:conviction-beats:v1`
- **Writer:** `useEffect` in `/earnings-opportunities` calls `syncFromEarningsOps()` on every graded payload. Dedup: newer filing_date or BLOCKBUSTER tier upgrade wins.
- **Readers:**
  1. `/watchlists` → "Conviction Beats" tab (next to "My Watchlist"). Renders BLOCKBUSTER/STRONG sections.
  2. `/earnings` (Scan) → "Conviction Beats" universe option in the multi-select + a separate "Conviction Beats only" composable AND-filter toggle.
- **Cross-tab sync:** `window.dispatchEvent(new CustomEvent('conviction-beats:updated'))` from writers; readers listen.

---

## 8 · TradingView Export Toolbar (`/components/TickerExportToolbar.tsx`)

Reusable component dropped into Conviction Beats panel + Earnings Scan.

Buttons:
- **Copy for TradingView** (primary, solid cyan) — `NSE:JTLIND,NSE:GARUDA,...` to clipboard
- **Copy CSV** — `JTLIND,GARUDA,...` (Excel-friendly)
- **Download .txt** — one ticker per line with `NSE:` prefix
- **Open in TradingView** — opens first ticker's chart + copies full list
- **Tier-grouped chips** when `groups` prop supplied: `⭐ Copy BLOCKBUSTER 25`, `🟢 Copy STRONG 49`, `🏆 Copy Conviction 20`

Filter-respecting: `/earnings` passes `sortedCards.map(c => c.symbol)` so only currently-visible tickers get exported.

---

## 9 · Multi-Select Universe (Earnings Scan)

State: `selectedUniverses: Set<'portfolio' | 'watchlist' | 'conviction' | 'screener'>` plus legacy `viewMode` kept for non-filter code paths.

Helper: `matchesSelectedUniverses(card)` → OR-union of selected sources.

Each universe has its accent color:
- 💼 Portfolio: `#10B981` (green)
- 📋 Watchlist: `#22D3EE` (cyan)
- 🏆 Conviction Beats: `#F59E0B` (amber)
- 🔍 Screener: `#8B5CF6` (purple)

Default: just Watchlist.

---

## 10 · BLOCKBUSTER Gate (current v3 — Patch 0185)

`/api/v1/earnings/graded` and the client-side `gradeRow` both apply the same logic.

Three paths (any one qualifies):

**Path A — Clean magnitude + structure**
- composite ≥ 78
- cleanMagnitude (Sales/PAT/EPS ≥ 25)
- ≤ 1 caveat
- (≥ 1 Tier-1 method OR positive guidance signal)
- chart OK (stage ≠ 4, pct52 ≥ -25)

**Path B — Exceptional magnitude**
- composite ≥ 72
- exceptionalMagnitude (Sales ≥ 40, PAT ≥ 50, EPS ≥ 50)
- ≤ 2 caveats
- chart OK

**Path C — Mega magnitude (escape hatch)**
- megaMagnitude (Sales ≥ 40, PAT ≥ 75, EPS ≥ 75)
- ≤ 3 caveats
- stage ≠ 4
- (no composite floor — magnitude IS the signal)

**Tier-1 methods** = Trend Template, SEPA, CANSLIM (NOT Bonde EP — that's auto-satisfied by magnitude).

**Methodology score floor:** 55 if any Tier-1 present, 65 if exceptional mag, 75 if mega mag.

**Forward guidance signal:** regex scan of `narrative_text` / `announcement_text` for `capacity expansion`, `order book`, `record`, `margin expansion`, `capex`, `tailwind`, `Vadod`, etc. (≥ 2 matches = positive guidance).

---

## 10.5 · Post-Earnings Price Gap pipeline (Patches 0201–0208)

Visible on `/earnings` cards as a 3-line badge:

```
POST-EARNINGS (CLOSE)
▲ 36.8%          ← cumulative since filing (live_move_pct)
gap +2.6%        ← overnight gap (open vs prior close)
1d close +5.0%   ← Day-1 close (T+1 reaction)
✓ filed 05-08    ← filing-date provenance (✓=kv-calendar, ~=detected, blank=explicit)
```

Filing-date resolution is tiered (institutional framework — patches
0205/0206 implement Tier 3 + Tier 1; Tier 2 NSE API is future work):

  Tier 1 — KV calendar (`graded:v8:<date>` payloads from NSE+BSE).
           Authoritative. ✓ prefix on the badge.
  Tier 2 — NSE corp announcements API. Not yet implemented.
  Tier 3 — Price-action inference from Yahoo daily chart. Fallback.
           ~ prefix on the badge.

Endpoint: `POST /api/v1/earnings/post-gap`
Body items: `{ ticker, filing_date, period, timing }`
Cache key: `post-gap:v3:<ticker>:<filing>:<timing>:<period>:<source>` 7d/5m
Response includes `source_counts` for telemetry.

Also wired (Patch 0207): a `1D CLOSE:` filter row on `/earnings` with
multi-select chips (`≥+2%`, `≥+4%`, `≥+7%`, `≥+10%`, `≤-2%`, `≤-5%`)
that compose AND-style with the universe / grade / date / guidance
filters and trim the visible cards in real time.

DATA MISSING recovery (Patch 0208): `/api/market/earnings-scan` now
falls back to `/api/v1/earnings/enrich` when its own Screener parser
returns null. Recovers SMLMAH, MACPOWER, KARURVYSYA, BAJAJ-AUTO,
NAM-INDIA, NIVABUPA, UJJIVANSFB, etc.

## 10.6 · Institutional readiness pass (Patches 0209–0217)

Triggered by a cross-functional review (senior QA + staff PE + UX +
ontology + buy-side PM). Full review lives in chat history.

  0209 — Nav cleanup. Full labels everywhere (no 'Spec Sit', 'Strategic
         Vis', 'Market Snap'). 'Intelligence' label renamed 'Signals'
         (it routed to /orders which is a signals workbench, not a
         trade-order page).
  0210 — IN PLAY TODAY dedup. Client-side groupBy(ticker), keeps the
         most-recent article, adds '×N' mention-count badge inline.
         Fixes DEEDEV×2, INOXINDIA×2, CEINSYS×2.
  0211 — Single time-format rule. Replaces 'about 4 hours ago' / '01:19
         PM · 3 minutes ago' / 'May 11, 12:53 PM · 1 day ago' soup with
         a deterministic ladder:
            <60s 'now' · <60m 'Xm ago' · <24h 'Xh ago' · ≤7d 'Xd ago'
            · else absolute date. Tooltip always shows the absolute time.
  0212 — `<PanelFreshness>` chip. Renders 'as of HH:MM · Xm ago' per
         panel using React Query's dataUpdatedAt. Turns amber when
         older than staleAfterMs. Applied to IN PLAY, Bottleneck
         Reading, and main News Feed.
  0213 — Lifecycle filter row (LIVE+WARM / STALE / PERSISTENT / ALL).
         Defaults to LIVE+WARM so the main feed doesn't mix soup.
         UI-only; proper signals.lifecycle_state DB column scheduled
         for backend work later.
  0214 — Design tokens. lib/design-tokens.ts defines three orthogonal
         palettes: semantic (bullish/bearish/neutral), state (live/
         warm/stale/persistent/archived), severity (high/medium/low).
         Same red never collides between 'bearish', 'stale', 'bad'.
         Applied to STALE/PERSISTENT badges; rest is incremental.
  0215 — Explicit error / empty / partial states on news panels.
         IN PLAY error path now shows Retry. Main feed empty state
         diagnoses the cause (lifecycle filter? other filter? source?)
         and offers a one-click clear button.
  0216 — Truncation guards. Headlines clamp to 3 lines, Impact text to
         2 lines, ticker chips capped at 3 with '+N more' overflow
         badge. Card row-height now bounded.
  0217 — Documentation update (mid-pass).
  0218 — URL-persistent filter state on /news. All filters (region,
         type, source, signal, sort, lifecycle, search) hydrate from
         and write back to the URL via router.replace(). Bookmarkable
         filter combos. First step toward 'Saved Views'.
  0219 — /status page with per-pipeline health probes. Bloomberg-style
         status board for News In-Play, News Bottleneck, Earnings
         Post-Gap / Enrich / Graded / Scan. Click any row to re-probe;
         60s auto-refresh toggle. Linked from side nav as 'System Status'.
  0220 — Visible priority score on every NewsCard. 'P N' badge with
         per-component breakdown in title (importance/severity/structural/
         recency). Makes the impact-based sort auditable.
  0221 — Source-tier badges. lib/source-tiers.ts classifies sources by
         domain into PRIMARY (◆ exchange filings, regulators) /
         SPECIALIST (◇ vertical trade press) / SECONDARY (◯ general
         business news) / AGGREGATOR (· reprints + blogs). Hover
         reveals tier definition.
  0222 — Documentation update (post-batch-1).
  0223 — Single-refetch contract on /news/refresh. Replaces the 3-shot
         polling at 0s/8s/20s with one coordinated refetch after the
         backend POST returns. Bounded, observable, debouncible.
  0224 — Lifecycle state dot + 3px left-edge on every NewsCard.
         LIVE cyan / WARM teal / STALE amber / PERSISTENT violet so
         the bucket is scannable across the whole feed.
  0225 — Named Saved Views (localStorage 'mc:saved-views:v1'). ☆ SAVE
         VIEW button + VIEWS (N) ▾ dropdown. Cross-tab sync via storage
         event. Sits on top of Patch 0218 URL state.
  0226 — Demoted stale strip beneath the main feed. When lifecycleFilter
         hides 48h–7d items, a compact '◐ Recent — N stale items hidden'
         strip surfaces them in one click. Never silently delete data.
  0227 — Visible SORT chip in the SIGNALS summary bar. PRIORITY/TIME
         toggle exposed in the main feed (was only in BOTTLENECK before).
  0228 — Mobile-aware collapse defaults. Persistent Bottleneck +
         Transformational Contracts default to collapsed on ≤768px so
         above-the-fold density drops from 8 panels to 3 on mobile.
  0229 — Inline expansion of also-reporting sources. '+ N sources'
         chip is now a button that toggles a panel showing the source
         list inline. First step toward proper Evidence Panel.
  0230 — Amber stale-strip when panel data is >3× the freshness window.
         Full-width banner at the top of /news with click-to-refresh.
         Builds on Patch 0212 (soft per-panel chip) and 0223 (single-
         refetch contract).
  0231 — This documentation update (final, end of batch-2).

## 10.6.2 · Batch-3 v0 stubs of backend-blocked items (Patches 0232–0239)

These ship **frontend-only approximations** of items in §10.7 so users
get the UX today while the proper schema-backed implementations are
planned. Each is clearly marked v0 in code + UI. When the real backend
lands, the v0 stubs swap in transparently.

  0232 — Evidence Panel v0 inside ArticleDetail. New 'EVIDENCE &
         PROVENANCE' section surfaces source-tier, corroboration count
         + source list, existing classifier output fields, lifecycle.
         Full classifier feature trace still pending SignalEvidence schema.

  0233 — Thesis Notebooks v0. Per-article markdown notes saved to
         localStorage 'mc:notes:v1:<id>'. 600ms autosave + 'saved
         HH:MM:SS' indicator. Cross-tab via storage event. Real
         multi-user notebooks with @-mentions need Auth + notes table.

  0234 — Ticker role glyphs v0 (heuristic from article sentiment).
         ▲ BENEFICIARY (green) / ▼ LOSER (red) / ◆ NEUTRAL (grey)
         on every ticker chip. '~' prefix flags inference. Real role
         classification needs ticker_roles table + upstream classifier.

  0235 — Bottleneck Workbench v0 at /bottleneck-workbench[?theme=<id>].
         Per-theme page with severity header, implicated tickers grid,
         active signals, articles timeline. Uses existing bottleneck-
         dashboard + /news endpoints; no schema change. Proper L1–L6
         transmission ladder + theme-filtered contracts ledger pending.

  0236 — /status page 24h history ring buffer. Each probe result is
         appended to localStorage 'mc:status-history:v1' under the
         probe id; older than 24h evicts on read; max 200 per probe.
         Sparkline + uptime % shown per row. Server-side heartbeat
         with cross-user aggregation still pending.

  0237 — Client-side News Alert Rules v0 at /news-alerts. Define
         simple rules (article_type/region/min_importance/ticker/
         theme/headline substring). Watches /news stream every 60s;
         fires browser Notification + on-screen toast. Rules persist
         in localStorage 'mc:news-alerts:v1'. Slack/Email/Webhook
         delivery + server-side rule evaluation still pending.

  0238 — Severity 'why' explainability tooltip. Hover the severity
         badge on any NewsCard to see the existing payload fields
         that drove the tier (importance_score, bottleneck_level,
         corroboration count, structural_score, confidence). Full
         classifier feature trace pending classifier_features JSONB.

  0239 — This documentation update.

The v0 stubs all use localStorage so they're per-browser-tab today;
when Auth lands they migrate to per-user/per-org server-side storage
in one swap.

## 10.7 · Open institutional follow-ups (NOT YET SHIPPED — schema work)

These all need backend / data-model changes beyond the surgical UI
patches above. They were called out explicitly in the institutional
review as P0 for the 300k EUR portal positioning, but they require
new tables / pipelines and are intentionally deferred:

  - Signal entity + SignalEvidence with classifier_features jsonb
  - Evidence Panel UI (click any confidence chip → side panel)
  - Source tier table + 'PRIMARY/SPECIALIST/SECONDARY/AGGREGATOR' badges
  - Theme revisions table + diff view
  - ticker_roles table + role-glyph chips with evidence count
  - Auth + RBAC + audit log
  - Status page with per-pipeline heartbeats
  - Alert rules engine (Slack/Email/Webhook)
  - Read-only public API
  - Bottleneck Workbench page per theme (L1–L6, ticker grid, contracts)
  - Thesis Notebooks
  - Saved Views in URL

If picking these up, start with the Signal/SignalEvidence schema
(blocks several others) and the Auth boundary.

## 11 · Patch Log Summary (0073 → 0217)

Pre-session patches existed (0073–0095). Recent session highlights:

**Earnings/Filings pipeline:**
- 0130–0150 — Earnings Opps pro page + BSE/NSE pipeline + Screener enricher
- 0155–0158 — Live Vercel enrichment, calibrated grading to EarningsPulse
- 0160–0162 — Partial refresh, BLOCKBUSTER gate refinement
- 0172–0185 — BLOCKBUSTER v3, guidance, force-include, audit, KV calendar cron, announce-date verification
- 0186 — **Conviction Beats** watchlist tab + Scan filter
- 0187–0194 — Date attribution + zero-loading + empty-cache + 3IINFOLTD digit-leading regex fix
- 0195–0198 — Symbol regex, TradingView toolbar, multi-select universe
- 0199–0200 — Persistent localStorage cache on /earnings + cross-page staleTime audit
- 0201 — **Post-earnings price gap** badge on Earnings Scan cards (`/api/v1/earnings/post-gap`)
- 0202 — Fix post-gap badges silently dropping cards (regex too strict)
- 0203 — Period-fallback when only quarter is known
- 0204 — Day-1 close (T+1 reaction) line added to badge
- 0205 — Server-side filing-date detection from Yahoo price action (Tier 3)
- 0206 — Tier 1 KV-calendar filing-date resolver (graded:v8:* scan)
- 0207 — Day-1 close threshold filter (multi-select, composable)
- 0208 — DATA MISSING recovery via `/api/v1/earnings/enrich` fallback
- 0209 — Institutional nav cleanup (full labels, Intelligence→Signals)
- 0210 — IN PLAY TODAY dedup by ticker, ×N mention badge
- 0211 — Single deterministic time-format rule for the entire news feed
- 0212 — `<PanelFreshness>` 'as-of HH:MM · Xm ago' chip per panel
- 0213 — Lifecycle filter chips (LIVE+WARM / STALE / PERSISTENT / ALL)
- 0214 — `lib/design-tokens.ts` semantic/state/severity orthogonal palettes
- 0215 — Explicit error / empty / partial states on news panels
- 0216 — Truncation guards on headlines / Impact / ticker chips
- 0217 — CLAUDE.md mid-pass update
- 0218 — URL-persistent filter state on /news (Saved Views v0)
- 0219 — `/status` page with per-pipeline health probes
- 0220 — Visible priority score on NewsCard (rank transparency)
- 0221 — Source-tier badges (PRIMARY/SPECIALIST/SECONDARY/AGGREGATOR)
- 0222 — CLAUDE.md update (post-batch-1)
- 0223 — Single-refetch contract on /news/refresh (replaces 3-shot poll)
- 0224 — Lifecycle state dot + left-edge on NewsCard
- 0225 — Named Saved Views (localStorage)
- 0226 — Demoted Stale strip beneath main feed
- 0227 — Visible SORT chip (PRIORITY/TIME) in main feed
- 0228 — Mobile-responsive collapse defaults on dense panels
- 0229 — Inline expansion of also-reporting sources
- 0230 — Amber stale-strip when panel data >3× freshness window
- 0231 — CLAUDE.md update (end of batch-2)
- 0232 — Evidence Panel v0 inside ArticleDetail
- 0233 — Thesis Notebooks v0 (localStorage)
- 0234 — Ticker role glyph heuristic (~▲/▼/◆)
- 0235 — Bottleneck Workbench v0 (/bottleneck-workbench)
- 0236 — /status page 24h history ring buffer + sparkline
- 0237 — Client-side News Alert Rules v0 (/news-alerts)
- 0238 — Severity 'why' explainability tooltip
- 0239 — CLAUDE.md final update (end of batch-3)

**Other features:**
- 0089–0094 — Earnings Hub merge, Special Situations pillar, Stock Sheet, Re-rating Screener
- 0096 — Live Input Cost → Equity Transmission Engine (`/transmission`)
- 0107 — **Concall Intelligence v2** (`/concall-intel` + `/api/v1/concall/analyze`) — pure regex/lexicon
- 0168 — Market Breadth Indicator (`/breadth`) — 5-pillar composite

---

## 12 · Known Open Issues (`pending` tasks)

- **#90** — Verify Graded Tiers match EarningsPulse semantics after worker pass
- **#93** — Verify BSE adapter pulls May 8/9 filings on Railway (next 30-min cycle)
- **#101** — Worker stale tracker: Railway worker last run 16:36 UTC; we built Vercel-side enrichment to bypass

---

## 13 · Hard Rules for ALL Future Sessions

1. **Always type-check before commit:** `cd /sessions/zen-epic-bardeen/mnt/market-cockpit/frontend && timeout 35 npx tsc --noEmit`
2. **Don't reduce cache TTLs for past dates** — they're immutable, 7d localStorage / 90d KV is correct.
3. **Don't add regex validators that reject digit-leading tickers.** Always use `[A-Z0-9]` for first char of NSE symbols.
4. **Don't cache empty enrich results for 6h** — 5min only. See Patch 0194.
5. **Don't attribute earnings data to dates not backed by confirmation.** Board meeting alone ≠ filing. See Patch 0179, 0187.
6. **Don't fabricate guidance.** Real forward signals from news/concall text only, never from past YoY tiles. See Patch 0185.
7. **Always show inline feedback near the button user clicked.** Toasts far from the action get missed. See Patch 0189.
8. **Hard Refresh must wipe BOTH localStorage and KV.** Refresh-without-bust is a footgun.
9. **Date navigation arrows skip weekends.** Indian markets only trade Mon-Fri.
10. **The user's tone is direct. Don't over-apologize. Diagnose deeply, fix at root cause, ship.**

---

## 14 · Quick Commands

```bash
# Type-check
cd /sessions/zen-epic-bardeen/mnt/market-cockpit/frontend && timeout 35 npx tsc --noEmit

# Commit + push
cd /sessions/zen-epic-bardeen/mnt/market-cockpit && git add -A && git commit -m "..." && git push origin main

# Trigger calendar cron manually (after deploy)
curl 'https://market-cockpit.vercel.app/api/v1/cron/refresh-earnings-calendar'

# Probe a specific ticker's coverage
curl 'https://market-cockpit.vercel.app/api/v1/earnings/coverage?ticker=SYRMA&date=2026-05-11'

# Force-rebuild graded for a date
curl 'https://market-cockpit.vercel.app/api/v1/earnings/graded?date=2026-05-11&force=1'

# Post-earnings gap probe
curl -X POST 'https://market-cockpit.vercel.app/api/v1/earnings/post-gap' \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"ticker":"JTLIND","filing_date":"2026-05-11","timing":"post"}]}'
```

---

## 15 · How to Start a New Chat

Paste this into the new chat as the first message:

> Read `/Users/radhevrishi/Desktop/Python/Imp Marketcockpit/market-cockpit/CLAUDE.md` before doing anything. It has the full project context from the previous session. Then [your actual request].

That's it. The new agent will load the memory and you skip the 30-min rebuild.
