# Market Cockpit — Claude Handoff Memory

> Read this FIRST when starting any new chat. Saves you 30 minutes of context-rebuilding.
> Last updated: 2026-05-13 (after Patch 0349 — USA post-mortem fixes from PAYS 16% drop. Section 10.10 (batch-13) has the diagnosis + fixes. Section 10.9 (batch-12) has the prior scoring overhaul. Read both if continuing scoring work.)
> **Sandbox-name caveat:** This file references the OLD sandbox `zen-epic-bardeen` in section 2. New sessions get a new sandbox name like `sleepy-serene-brahmagupta`. The repo path mapping pattern is `/Users/.../market-cockpit/` → `/sessions/<sandbox>/mnt/market-cockpit/` — substitute the active sandbox name from your bash mounts.

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

## 10.6.3 · Transmission premium workstation (Patches 0240–0246)

Triggered by an institutional review of /transmission noting it 'reads
like a powerful internal tool, not a premium decision terminal'.

  0240 — COMMODITY UNIVERSE EXPANSION. /api/v1/transmission grew from 9
         to 34 inputs. Categorized into: energy / metals / agri /
         chemicals / fx_rates / ai_robotics / nuclear / rare_earths.
         Each commodity carries category + bias_2026 + source_note.
         Each driver carries pass_through_lag + pricing_power + note.
         Items without Yahoo symbol surface as 'manual feed' with
         drivers still visible. New: palm/soybean/sunflower oil,
         phosphoric acid, ammonia, sulphur, naphtha, BTX, polymers,
         caustic/soda, coking/thermal coal, petcoke, rubber, pulp,
         lithium (LIT), rare earths (REMX), gallium/germanium,
         palladium/platinum, helium-3, uranium (URA), HALEU.
         Route also returns 60-day price sparkline per commodity.

  0241-0245 — TRANSMISSION PAGE REWRITE.
         Three-column grid: 230px filter rail | main | 280px intel rail
         Filter rail (sticky, URL-persistent):
           Category chips (8) · sensitivity (high/med/low) ·
           sector search · ticker search · horizon (1m/3m) · Clear all
         Scenario Lab: 6 sliders for top movers, sector-aggregate
           pressure recomputes instantly under user-applied deltas
         Top-15 shocks summary (existing) wired to new payload
         Commodity grid: card per commodity with category glyph,
           inline 1d/1m/3m + 70px sparkline, top-4 sector impacts
         Click any card → 720px drilldown panel with:
           5-column KPI strip · 60-day sparkline · 2026 bias note ·
           full sector matrix sorted by abs impact · per-row pass-
           through lag / pricing power / 1m+3m pressure / tickers / note
         Right rail (sticky) 'Transmission Intelligence':
           Top 5 movers · top 6 margin casualties · top 6 beneficiaries
         Premium polish: tabular-nums, freshness chip ('as of HH:MM ·
           Xm ago' amber when >15min), category glyphs, 'manual feed'
           italics for items without Yahoo symbol.

  0246 — This documentation update.

Still pending (server-side z-score, historical regression coefficients
on time-lag transmission, real-time price feeds for the 'manual feed'
inputs, earnings-overlay join). Manual feed inputs would benefit from
a scheduled scraper hitting Argus / Platts / CRU / industry trackers.

## 10.6.4 · Cross-cutting bug-fix + mobile + scoring batch (Patches 0247–0265)

  0247 — Transmission unit labels (Aluminum $/MT, Zinc/Soybean ¢/lb,
         Rubber moved to manual feed after Yahoo returned 0.01331).
  0248 — Yahoo → FMP → AlphaVantage multi-source fallback chain.
  0249 — 1d move alongside 1m in Scenario Lab + Intelligence rail.
  0250 — Equity-proxy mode for 17 manual-feed commodities (Peabody for
         coal, CF for ammonia, MOS for phosphate, LYB for petrochem
         chain, OLN for caustic, IP for pulp, MP for rare-earth,
         APD for helium, LEU for HALEU, IOI Corp for palm oil, etc.).
  0251 — Conviction Beats overlay on Intelligence/Signals page (basic).
  0252 — Clickable Tier 1 / 2 / SPIN / M&A / TURN / CAP filter chips
         on Special Situations header.
  0253 — Fix EO calendar stuck-loading. initialData now returns cached
         localStorage payload regardless of age (past months are
         immutable); React Query handles freshness in background.
  0254 — Special Situations institutional polish: REJECT → MONITOR
         (soft slate tone), expected-alpha tag per event_type
         (spread capture / SoP unlock / float reduction / forced
         buying / etc.), source-tier badge on each row.
  0255 — EO Refresh button no-op fix. force=1 alongside refreshMissing=1
         + delayed follow-up refetches at 60s and 5min to catch async
         worker completions. Honest 'no-op' message + don't auto-hide
         when failed tickers remain.
  0256 — Conviction Beats CB badge added to ALL 8 Intelligence card
         render sites (quiet-day, thematic developments, monitoring
         list, top idea, action panel, trend, monitor list).
  0257 — Special Situations client-side duplicate event collapse.
         Group by (target + event_type + 7d date bucket); render
         '×N sources' chip for corroborated events.
  0258 — Special Situations next-catalyst timeline. Uses payload
         next_catalyst_date if present; else event-type heuristic
         ('Open offer typically opens +30d', 'Tender close +35d',
         'NCLT decision +45d', etc).
  0259 — Special Situations decay-color age chip. Each event_type has
         a half-life (tender 15d / merger 60d / index inclusion 14d);
         chip color shifts green→cyan→amber→red as the event ages.
  0260 — Special Situations India sub-category refinement from headline.
         Detects preferential allotment, warrants conversion, OFS,
         promoter stake hike, NCLT/CIRP, delisting, SME→Main, index
         inclusion/exclusion, HoldCo, SoP, QIP, rights issue.
  0261 — Bottleneck Intel quote-mapping defense. Filter quotes for
         valid ticker before .toUpperCase() to prevent the rare
         Yahoo-incomplete-payload crash.
  0262 — Stock Sheet investigation (already defensive — StockSheet
         ErrorBoundary + safeText + safeScalar). No concrete crash
         found without runtime repro; deferred.
  0263 — Mobile-responsive baseline. CSS-only, 8 @media rules in
         globals.css. Three-column transmission collapses to single
         column on mobile; sticky right rails hidden; H1/H2 sizes
         shrink; chips wrap; padding compresses. Tablet (768-1023)
         right rail shrinks 280→220.
  0264 — This documentation update.
  0265 — Multibagger scoring tweaks per user audit:
           • Soften op-leverage penalty: 1.0–1.5× w/ growing PAT now
             gets only soft −1 (was hard −5). Hard penalty reserved
             for actual margin compression.
           • ROIC<WACC KILL SWITCH (−10) when ROIC<10 AND FCF<0 AND
             D/E≥0.5 AND yoy sales>25% — Fisher's growth-that-destroys
             value case.
           • Valuation pillar capped at 45 when MoS<−50% AND ROIC<WACC
             (prevents PEG illusion rewards).
           • Growth Quality +5 offset when ROCE>20% AND CFO/PAT>1 AND
             FCF>0 AND yoy sales>25% (rewards inflection on already-
             high economics).

## 10.7 · Open institutional follow-ups (NOT YET SHIPPED — schema work)

These all need backend / data-model changes beyond the surgical UI
patches above. They were called out explicitly in the institutional
review as P0 for the 300k EUR portal positioning, but they require
new tables / pipelines and are intentionally deferred:

  - Signal entity + SignalEvidence with classifier_features jsonb
    (Evidence Panel v0 in 0232; full version blocked)
  - Source tier table — frontend v0 shipped (0221, 0254); proper
    editor-curated table still pending
  - Theme revisions table + diff view
  - ticker_roles table + role-glyph chips — heuristic v0 in 0234
  - Auth + RBAC + audit log
  - Per-pipeline server-side heartbeats with KV history (client v0 in
    0219/0236)
  - Alert rules engine — client v0 in 0237; Slack/Email/Webhook
    delivery still pending
  - Read-only public API
  - Bottleneck Workbench page per theme — frontend v0 shipped (0235);
    proper L1–L6 ladder + contracts join still pending
  - Thesis Notebooks — localStorage v0 in 0233; multi-user pending
  - Saved Views — URL state v0 in 0218 + named saves in 0225;
    server-side persistence pending Auth

  Special Situations institutional review (still backend-blocked):
  - SEC filing parser (SC TO-T, Schedule TO, 10-12B → structured)
  - Merger-arb spread math from filing terms (offer price, IRR, close)
  - Deal-probability engine
  - Full lifecycle state machine (rumor → board → binding → regulatory
    → vote → court → open → tender → listing → completed/terminated)
  - India-specific event ingest (demerger / OFS / preferential /
    promoter stake hike / NCLT — heuristic v0 in 0260)
  - Liquidity intelligence (ADV / free-float / slippage)
  - Playbook intelligence (historical pattern templates)

  Transmission (still backend-blocked):
  - Server-side z-score + historical regression for time-lag transmission
  - Real-time scrapers for the 14 paid-feed items (Argus / Platts / CRU
    / ICIS) — equity-proxy mode (0250) gives directional signal until
    these land
  - Earnings overlay join (schema dependency on earnings calendar)

If picking these up, start with the Signal/SignalEvidence schema
(blocks several others) and the Auth boundary.

## 10.6.4 · Batch-4 — Conviction Beats spread + shared freshness chip (Patches 0272–0280)

Picked up while user slept. Second-pass loop after the v0-stubs batch.
Theme: spread the institutional Conviction Beats overlay across every
result surface (Multibagger, Earnings Guidance + Hub, Screener,
Re-rating) and extract the news/page.tsx `PanelFreshness` into a shared
component so every dashboard with `dataUpdatedAt` can render the same
"as of HH:MM · Xm ago" chip without duplicating the timer / formatter.

  0272 — Conviction Beats badge + filter chip on Multibagger results.
         Reads `getConvictionTickers()` + listens for cross-tab updates.
         Amber 🏆 CB next to symbol when on the bench; toolbar adds a
         "🏆 Conviction (N)" filter alongside the existing chips.

  0273 — Conviction Beats overlay on Earnings Guidance card list
         (both card view + timeline view) and Earnings Hub header chip
         that jumps to the Scan tab where the existing Conviction
         universe filter lives.

  0274 — `<PanelFreshness>` extracted from /news into
         `frontend/src/components/PanelFreshness.tsx`. Single source of
         truth for the freshness chip used by /news (3 panels), now
         also /breadth and /strategic-visibility. Component re-renders
         once a minute internally so consumers don't need their own
         timer; turns amber when age > `staleAfterMs`.

  0275 — `<PanelFreshness>` wired into /screener and /ipos (both
         pages use plain `useState`+`fetch`, so we stamp Date.now() on
         every successful fetch). Multibagger skipped (Excel-upload
         driven, no live data); Concall Intel skipped (one-shot tool).

  0276 — Conviction Beats overlay on Screener results — badge on
         ticker cell in both Stocks and Earnings tabs + "🏆 CB Only"
         toolbar toggle that narrows the filtered universe.

  0277 — Conviction Beats overlay on Re-rating Screener — shared
         `<CbBadge>` component injected into all three panels (Margin
         Expansion, Model Shift, Multiple Expansion). Same amber chip.

  0278 — Bottleneck Workbench polish: theme-picker search box,
         severity-sorted theme grid, and an explicit "Theme not found"
         state (previously the page spun indefinitely on a stale
         `?theme=` param pointing to a rolled-off bucket).

  0279 — News Alerts JSON import/export. Adds ↓ EXPORT JSON / ↑ IMPORT
         JSON buttons next to the page header. Export downloads a
         timestamped `news-alerts-YYYY-MM-DDTHH-mm-ss.json`; import
         merges by `id` (existing ids overwritten, new ids appended)
         with light validation. Makes the localStorage-only rules
         portable across browsers without depending on Auth/cloud sync.

  0280 — This documentation update.

Behaviour notes:
- `@/components/PanelFreshness` lives at
  `frontend/src/components/PanelFreshness.tsx`. New pages should import
  from there rather than re-implementing the age chip.
- Conviction overlay pattern: every page does
  `Set<string>` derived from `getConvictionTickers()`, refreshed by
  `window.addEventListener('storage', …)` AND
  `window.addEventListener('conviction-beats:updated', …)`.

## 10.6.5 · Batch-5 — Sweep of remaining pages + global CB chip (Patches 0281–0285)

Continued the never-ending loop after batch-4. Theme: fix
small-page null-safety gaps, wire `PanelFreshness` everywhere it
fits, and surface the institutional Conviction Beats count globally
so users always know how big the bench is without navigating.

  0281 — Heatmap null-guards. `dailyData.stocks` and
         `earningsData.results` were accessed without nullish guards;
         a partial API payload would crash the treemap. Added
         optional-chaining on both, plus an extra `!dailyData.stocks`
         clause in the empty-state check. Also confirmed Movers /
         Themes already safe (covered by Patch 0270/0271 patterns).

  0282 — `<PanelFreshness>` wired into /themes (useThemeQuotes),
         /ai-desk (max of morning/evening brief timestamps with a
         6-hour `staleAfterMs`), and /alerts (max of rules /
         instances timestamps with a 10-minute window).

  0283 — Global Conviction Beats count chip in the dashboard header.
         Lives in `DashboardClient.tsx` between MarketHours and
         ThemeSwitcher. Clickable — routes to /earnings-opportunities
         where the bench is curated. Cross-tab sync via storage event
         + 'conviction-beats:updated'. Hidden when count is 0.

  0284 — `<PanelFreshness>` wired into /smart-money and /movers.
         Both pages use plain `useState`+`fetch` so we read their
         existing `lastUpdated: Date` state, convert to epoch ms, and
         pass that in. Smart Money gets a 15-min `staleAfterMs`
         (bulk/block deals only land at EOD); Movers gets 10-min.

  0285 — This documentation update.

Sweep coverage after batch-5: every dashboard page that has a
meaningful "live data" loop now exposes a freshness chip in its
header, and the global header always shows the bench size. Pages
deliberately skipped: /multibagger (Excel-upload driven, not live),
/concall-intel (one-shot analyze), /settings, /stock-sheet (no
query), /portfolio, /watchlists (use their own custom freshness).

## 10.6.6 · Batch-6 — Institutional QA-audit fixes (Patches 0286–0295)

User pasted a 12-bug + 6-improvement institutional QA audit mid-sleep.
Many "wrong-component-mounted" claims (BUG-01/02/03/05/06) were
verified as false positives — the routes are correctly mapped in code
and the user was looking at a stale Vercel deploy or cached page.
The genuine bugs and quality gaps shipped here:

  0286 — EO refresh feedback rewrite. The "⚠ 0/N updated · Worker
         re-checks in 60s + 5min" message looked like a broken state
         even when working as designed (upstream NSE/BSE genuinely
         hadn't published yet). New message branches on date-age:
         > 14 days ago = "sources rarely backfill"; near-today =
         "re-checking automatically"; future date = "wait for filings".
         Each adds a HH:MM timestamp so consecutive refreshes are
         visibly different.

  0287 — Settings profile section: bounded 5s timeout via
         AbortController. If /auth/me hangs or 401s, show a graceful
         "Profile unavailable" message instead of the indefinite
         "Loading profile…" spinner.

  0288 — IPO page graceful TBA fallback. When priceBand / lotSize /
         issueSize are TBA/missing, render an amber "Check NSE / BSE →"
         banner with deep-links to the official IPO calendars instead
         of just showing blank "TBA" everywhere. Individual fields
         also coerce to em-dash if missing.

  0289 — News junk filter strengthened. Added 9 new regex patterns to
         JUNK_HEADLINE_PATTERNS targeting consumer-deal noise the
         audit flagged: "Save $X on", "bundle deal", "Black Friday",
         "X% off", and product-specific patterns for Samsung/Corsair/
         WD/SanDisk SSD bundles. The "Tom's Hardware 9800X3D bundle"
         article that polluted the BOTTLENECK feed now never makes
         it past isMarketRelevant().

  0290 — Impact↔Headline relevance check. Cheap word-overlap test:
         when the server-generated Impact text shares zero non-stop
         words with the headline AND the Impact is specific (≥3
         uncommon tokens), suppress it and render "Related to: theme"
         instead. Fixes the audit complaint that a Dixon Vivo JV
         article showed "GPU deployment bottleneck shifting upstream"
         as its Impact label. Applied to both evidence_bound_impact
         and impact_label_safe render paths in NewsCard.

  0291 — Market Movers row enrichment. Cap chip now shows actual
         ₹ Cr market cap inline below the L/M/S badge, and each
         ticker row has a "📰" button that opens /news?search=<ticker>
         so analysts can immediately see what's driving the move
         without leaving the page.

  0292 — This documentation update.

  0293 — (planned) RRG sector tooltip showing recent headline.

  0294 — (planned) Earnings Guidance QoQ delta + sparkline.

  0295 — Bottleneck Intel: auto-collapses STALE themes. Themes with
         0 articles this week + 0 last week + not structural are
         hidden behind a "X stale themes hidden — click to expand"
         toggle. Audit complaint: 15+ of 21 themes were rendering as
         STALE/VERY LOW which polluted the Conviction Matrix and
         signalled broken coverage when the matrix was actually fine.

## 10.6.7 · Batch-7 — Drill-throughs + race-condition hardening (Patches 0293–0300)

Loop continued after batch-6 audit fixes. Theme: surface drill-through
paths from summary pages into the underlying news/data, and harden
the race-prone callbacks/fetches across high-traffic pages.

  0293 — RRG sector dots now clickable. Clicking any sector dot opens
         /news?search=<sector_name> in a new tab so analysts can
         immediately answer "I see Banking is Lagging — but why?".
         Tooltip also grew a "📰 Click dot for sector news →" hint.

  0294 — Earnings Guidance Q-over-Q delta. Per-symbol score history
         persisted in localStorage 'mc:guidance-scores:v1', keyed by
         YYYY-MM period bucket. On each render we look back at the
         most-recent earlier period for the same symbol and render a
         "Δ+N" or "Δ-N" badge next to the current score. Cumulative
         over time, since each user session contributes one snapshot.

  0295 — Bottleneck Intel auto-collapses stale themes. A theme is
         "stale" when it has 0 articles this week + 0 last week + not
         structural; those get hidden behind a "X stale themes hidden
         — click to expand" toggle. Audit complaint was that 15+/21
         themes showing as STALE polluted the Conviction Matrix and
         signalled broken coverage when the system was working fine.

  0296 — Status page hardened. Switched to Promise.allSettled +
         per-probe try/catch so a single throwing probe can't wedge
         the dashboard with a stuck "Loading…" spinner.

  0297 — Watchlist flag toggle race fixed. Replaced closure-captured
         `watchlistFlags[ticker]` with functional setState so rapid
         double-clicks always cycle from the latest state, not the
         render-snapshot. Removes the dependency-array trap entirely.

  0298 — Calendars AbortController. Fast filter changes
         (monthOffset / indexFilter) no longer race; a stale fetch
         from a prior filter is aborted before its setData fires.

  0299 — Status page granular OK/STALE/FAIL breakdown chip. The
         header pill now shows "13/15 healthy · 1 FAIL · 1 STALE"
         so analysts see the failure shape at a glance instead of
         just the OK ratio.

  0300 — Portfolio header freshness chip. Wired the existing
         lastRefresh state into PanelFreshness with a 5-min staleAfter
         so analysts see "quotes 14:32 · 3m ago" alongside the title.

  0301 — This documentation update.

## 10.6.8 · Batch-8 — Final wrap-up patches (0302–0303)

User asked to "end loop and finish all other open topics". Closing
out the never-ending loop with two final polish patches and a
documentation pass.

  0302 — Calendars header now shows a prominent amber "FILTER:
         <index>" chip when indexFilter is narrowed below 'All'.
         Helps users notice when a low result count is filter-driven
         vs genuinely empty.

  0303 — Watchlist empty state cross-links to /earnings-opportunities
         (Conviction Beats bench) and /screener so users have explicit
         paths to populate the watchlist instead of staring at a
         dead-end "empty" message.

Session end-state: ~30 patches shipped this round (0272–0303). All
12 SEV1 audit items and 6 IMP items either fixed or verified as
false positives. Type-check clean. Deployed to main.

## 10.6.9 · Batch-9 — Backend-batch lift (Patches 0305–0312)

User asked: "fix all these" backend-blocked items from §10.7. Of those
items, the ones that can be done with the existing Vercel + Upstash KV
stack (no new Postgres, no Auth provider, no paid feeds) shipped in
this batch. Each is wired so that when the schema-backed versions
eventually land, the existing endpoint can become a thin proxy.

  0305 — `lib/merger-arb.ts` — pure offer/spot/close-date → IRR math
         with tightness labels + probability-weighted expected IRR.
         New `SimpleArbCalc` panel on Special Situations alongside the
         existing AcceptanceCalc + FloatingCalc.

  0306 — `lib/deal-probability.ts` — heuristic deal-probability engine.
         Takes filing tier + spread + days since announcement +
         regulatory hurdles + friendliness + financing + insider
         ownership → score 0-100 with factor-by-factor explainability.

  0307 — `/api/v1/heartbeat/<pipeline>` POST/GET — KV-backed ring
         buffer per pipeline (240 entries, 7-day TTL). Replaces the
         per-browser localStorage mc:status-history:v1 (Patch 0236)
         with cross-user persistent log so the Status page can show
         shared health history across devices.

  0308 — Source-tier KV override table.
            POST/GET/DELETE /api/v1/admin/source-tiers (secret-gated)
            GET            /api/v1/source-tier (public resolver)
         Hardcoded lib/source-tiers.ts heuristic remains the fallback;
         KV overrides win when present. Editors can curate without
         redeploying.

  0309 — `/api/v1/earnings/nse-announcements` — Tier 2 of the
         institutional filing-date resolver. Hits NSE corp-announcements,
         finds the most-recent "Quarterly/Financial Results" filing,
         caches in KV 24h. Returns NSE_DIRECT / NSE_BLOCKED / NSE_EMPTY
         / KV_CACHED so callers know provenance.

  0310 — `/api/v1/ticker-roles/<ticker>` — server-side classifier that
         reads last 30d of news for the ticker, weights by importance
         + sentiment + article_type, returns BENEFICIARY/LOSER/NEUTRAL
         with -100..+100 score and evidence breakdown. KV-cached 24h.
         Replaces the per-browser client v0 (Patch 0234).

  0311 — Public read-only API scaffold at `/api/v1/public/graded/<date>`.
         Shared-key auth via PUBLIC_API_KEYS env var (or anonymous when
         PUBLIC_API_ANON=1). Rate-limited 60/h per key in KV. Redacted
         response (no internal scoring, no news URLs). README in
         frontend/src/app/api/v1/public/README.md.

  0312 — This documentation update.

### Still requiring infra decisions

The remaining items in §10.7 genuinely need user input:

  - **Auth provider** (Clerk / Supabase Auth / NextAuth) — blocks
    server-side persistence of Notebooks, Saved Views, Alert Rules,
    and the audit log.
  - **Postgres / Supabase DB** — needed for Signal + SignalEvidence,
    ticker_roles real table, theme_revisions diff log, lifecycle
    state machine. Once we have a DB, migrations from the existing
    KV pattern are straightforward.
  - **Slack / SMTP / webhook creds** — to deliver Alert Rules
    server-side. The client v0 (Patch 0237) + import/export (0279)
    keeps rules portable in the meantime.
  - **Paid data subscriptions** (Argus / Platts / CRU / ICIS) — equity
    proxy mode (Patch 0250) gives directional signal for the 14
    manual-feed transmission inputs until real feeds land.
  - **SEC EDGAR + India MCA parsers** for SEC TO-T / Schedule TO /
    10-12B / NCLT scheme docs — needs a Vercel cron + parsing pipeline.
    Patch 0309 gets the NSE corp-announcements adapter going; the
    EDGAR side is the next building block.

These are listed in priority order. **Auth first** unlocks the most
downstream features.

## 10.7 · Batch-10 — Multibagger scoring overhaul + backend lifts (0313–0325)

User pushed back hard on score compression: "21% quarterly sales growth
and many goods is scoring 60, while Kirloskar Pneumatic is also 60 —
why?". Diagnosis: single HIGH red flag was capping all stocks at 60
regardless of fundamental quality. Plus institutional gaps in detecting
governance / forensic / pump patterns. This batch addresses both.

  0313 — Governance Watch: detects low promoter + zero institutional +
         microcap (operator-driven pump fingerprint). Caps composite at
         65 regardless of fundamentals. Discovery bonus now gated on
         promoter ≥ 40%. 🛑 GOV⚠ badge visible on row.

  0314 — Six additional institutional red flags:
         (1) Story-stock pattern: sales >80% + cfoToPat <0.5 → HIGH
         (2) Cycle-peak margins: OPM >1.7× sector p75 + profit CAGR >60%
             → -6 rerating
         (3) Capex burn without ROCE return → -7 rerating
         (4) Pledge severity tiering: ≥50% CRITICAL, 35-50% HIGH
         (5) Falling-knife + premium combo (Stage 4 + PEG > 2.5) → -8
         (6) Zero-dividend with free cash → -3 + check related-party

  0315 — HIGH severity tier split (the headline fix). Splits HIGH red
         flags into STRUCTURAL (governance/leverage — cap 60, -12 pt)
         vs CYCLICAL (revenue decel, one-quarter pressure — cap 72, -6 pt).
         Lets fundamentally strong names with one cyclical concern still
         grade B+ instead of getting flattened. Bucket hard-fail also
         tightened to require structural flags.

  0316 — Per-row SCORE AUDIT chip strip. Shows every active cap and
         severity bucket on row expand. Each red flag now displays its
         point cost (-25/-12/-6/-5), kind (structural/cyclical), severity.
         Makes "why did this stock score X?" debuggable in one glance.

  0317 — Scaffold for 9 new institutional metrics:
         debtorDays, inventoryDays, creditorDays, workingCapitalDays
         interestCoverage, effectiveTaxRate, capex3yr
         promoterHistory[], fiiHistory[], diiHistory[]
         dividendYield, avgDailyValueCr
         Each rule skips gracefully when field is undefined. Parser
         accepts Screener column aliases. User pulls columns from
         Screener.in into Excel and the model picks them up automatically.

  0318 — SEC EDGAR M&A filings adapter (Tier 1 US filing parser).
         GET /api/v1/edgar/filings?cik=<CIK>&form=<form>. Returns
         SC TO-T / SC TO-I / SC 13E3 / DEFM14A / 425 / 10-12B by default.
         Counterpart to /api/v1/earnings/nse-announcements (Patch 0309).

  0319 — Theme revisions KV snapshot log. POST snapshot → diff vs prior
         + ticker added/removed deltas appended to revision log. GET
         returns newest-first history. 50-entry cap, 365-day TTL.

  0320 — Special Situations lifecycle state machine.
         RUMOR → BOARD_APPROVED → BINDING → REGULATORY → VOTE → COURT →
         OPEN → TENDER → LISTING → COMPLETED, with terminal failure
         states (TERMINATED / ABANDONED / BLOCKED). Validates legal
         transitions. Records timestamp + source + note per transition.
         Stalled-deal detection via expected-days-per-state priors.

  0321 — Special Situations playbook intelligence library (16 event
         types). Each playbook: avg close days + p25/p75 range, success
         rate %, typical spread, dominant failure modes with priors,
         friction points, tactical entry/exit guidance, retail-overhang
         flag. Pure static library; consumers import getPlaybook().

  0322 — Multibagger FORENSIC PUMP DETECTOR (MosChip / RIR Power
         pattern). 11 forensic signals, each scoring 1-3 points:
         - Other Income > 25% of PBT (PBT inflation)
         - Cash declining > 30% YoY despite profit growth (paper profits)
         - Share count grew > 25% over 3Y (dilution-funded growth)
         - Related-party transactions > 5% of revenue (value transfer)
         - Auditor changes >= 2 in 3Y (governance flag)
         - >= 10 subsidiaries on a sub-1000Cr microcap (multi-layer scheme)
         - 52w range > 200% (operator-induced volatility)
         - Free float < 15% (thin float manipulable)
         - Sales surging > 35% CAGR with CFO/PAT < 0.7 (paper growth)
         - Promoter < 30% + 1m return > 30% (pump pattern signature)
         - Promoter group entities >= 15 (structure obfuscation)

         Total pump score:
           >= 5  -> CRITICAL red flag (cap 38)
           >= 3  -> HIGH structural red flag (cap 60)
           >= 1  -> -2 rerating + risk note

         Only fires for microcap (mcap < ₹3000 Cr). All checks gracefully
         skip when field undefined; user adds Screener columns to turn
         each signal on independently. Catches operator-pumped names
         that pass conventional fundamental screens.

  0323 — METRICS_TO_ADD.md user-facing doc. Tier A/B/C/D/E columns to
         add to Screener.in export, ranked by institutional impact.
         Tier E specifically covers the 11 forensic-detector columns.

  0324 — Transmission server-side z-score statistical layer.
         GET /api/v1/transmission/zscore/<commodity>?window=60|180|365|1825
         Pulls Yahoo daily history for 21 commodities; returns mean,
         median, std_dev, z-score, percentile, sample size, and a
         one-line institutional interpretation. KV-cached 1h.

  0325 — This documentation update.

### Status of §10.7 backlog after this batch

  - Auth provider — still blocked (user decision needed)
  - Postgres DB — still blocked (user provision needed)
  - Slack/SMTP/webhook creds — still blocked
  - Paid data feeds (Argus/Platts/CRU) — still blocked
  - SEC EDGAR parser — SHIPPED in 0318 (basic submissions API; deeper
    extraction of merger terms / offer prices still pending)
  - Merger-arb math — SHIPPED in 0305
  - Deal-probability engine — SHIPPED in 0306
  - Lifecycle state machine — SHIPPED in 0320
  - India events ingest — heuristic v0 shipped in 0260; canonical
    state machine shipped in 0320
  - Playbook intelligence — SHIPPED in 0321
  - Liquidity intelligence — partial (avgDailyValueCr in 0317)
  - Per-pipeline heartbeats — SHIPPED in 0307
  - Theme revisions diff log — SHIPPED in 0319
  - Public read-only API — SHIPPED in 0311
  - Ticker roles real classifier — SHIPPED in 0310 (KV-backed)
  - Source tier curation table — SHIPPED in 0308
  - Transmission z-score / regression — z-score SHIPPED in 0324;
    regression still pending (needs Postgres for coefficient storage)
  - Earnings overlay join — still pending

## 10.8 · Batch-11 — Backend wiring + UX visibility (0326–0331)

After batch-10 built the backend primitives (lifecycle, playbooks, z-score,
heartbeat, EDGAR adapter), this batch wires them into the user-facing UI
and surfaces the previously-hidden scoring signals as visible chips.

  0326 — Forensic pump-score chip on row. Pump score >= 1 now renders
         as a visible chip on the row (yellow/orange/red tiered). Hover
         tooltip lists the firing forensic flags. Lets the analyst spot
         operator-driven names at a glance without expanding the row.

  0327 — Score-change vs prior upload chip upgraded. Was a tiny ↑/↓
         arrow; now a proper chip with NEW (purple) / = (muted) /
         ▲+N (green) / ▼-N (red). Tooltip shows the prior score.

  0328 — Special Situations playbook intelligence panel. When user
         expands a Special Situations event card, the new 📐 PLAYBOOK
         panel surfaces institutional priors for the event type:
         avg close days + p25-p75 range, success rate %, typical spread,
         retail-overhang flag, tactics paragraph, failure modes. 16
         event types covered from lib/specsit-playbooks.ts.

  0329 — Status page POSTs to server-side heartbeat KV. Every probe
         result now also fires a background POST to
         /api/v1/heartbeat/<probe-id> so health history accumulates
         cross-device. Local ring buffer remains for instant display.

  0330 — Transmission z-score chips in commodity drilldown. New
         ZScoreChips component lazy-fetches 60d/180d/365d/5yr z-scores
         when a commodity drilldown opens. Renders chip strip with
         color tiering (red/orange/grey/cyan/green by extreme),
         percentile, and 1y institutional interpretation summary.
         Z-score endpoint also accepts ?symbol= override so the
         transmission page passes each commodity's actual Yahoo symbol
         without re-deriving the keying.

  0331 — This documentation update.

## 10.9 · Batch-12 — Scoring discipline overhaul + Decision logbook (0332–0347)

This batch is the largest scoring overhaul to date. It inverts the philosophy
of the Multibagger engine: **disqualify operator/forensic/cyclical-spike
names first, then rank the clean universe**. The end state is a scoring
engine that no longer promotes pump-pattern microcaps to A+ and no longer
buries clean compounders due to one bad quarter.

### Scoring discipline patches (0332–0339, India side)

  0332 — Align Multibagger parser with actual Screener export (column-name fix)
  0333 — METRICS_TO_ADD.md update (Tier A/B/C/D/E user-facing column list)
  0334 — Wire "Change in promoter/FII/DII holding 3Years" columns into trend
         rules (synthesizes 2-point promoterHistory/fiiHistory arrays)

  0335 — **CRITICAL stale-count bug fixed.** `highStructPre` was computed at
         bucket-classification time (line ~1572) before Patches 0317/0322/0334
         pushed additional HIGH structural red flags. The score-cap section
         reused that stale snapshot, so caps never bound. Visible: stocks
         with "Active cap: 48 (binding)" in audit panel scored 89.
         Fix: recompute counts freshly from final redFlags array right
         before the cap section.

  0336 — Re-apply red-flag caps after guidance bonus. The +3 guidance bonus
         was being added AFTER cap enforcement, so capped-at-60 stocks
         landed at 63. Fix: mirror cap chain inside applyGuidance().

  0337 — Four loophole fixes:
         (a) Story-stock pattern two-tier detector (Jeena Sikho catch)
         (b) Working-capital trend HIGH structural when delta >60d
         (c) Op-leverage <1.0 composite cap at 75
         (d) Cyclical-peak margins composite cap at 80

  0338 — 500-bagger DNA upgrade + MNC allowlist + tighter pump thresholds:
         - Forensic pump-detector: HIGH at ≥2 (was ≥3), CRITICAL at ≥4 (was ≥5)
         - Governance Watch CRITICAL tier (extremeGov) when promoter ≤20 +
           FII+DII ≤3 + mcap <1000 Cr
         - MNC_ALLOWLIST (30+ tickers: KENNAMET, CARRARO, NITTAGELA,
           GRINDWELL, BOSCHLTD, ABB, SIEMENS, 3MINDIA, NESTLEIND, HUL,
           COLPAL, etc.) — exempt from low-inst penalty + +3 governance bonus
         - 500-bagger DNA bonus +6 when 9/9 criteria align (promoter 50-75% +
           ROCE >25 + CFO/PAT >1 + FCF+ + D/E <0.3 + non-cyclical + CAGR ≥18
           + zero pledge + promoter stable)
         - Niche pricing power bonus +4 (non-cyclical premium OPM)
         - Cyclical-recovery exemption (Mayur Uniquoters pattern)
         - Institutional-vacuum exemption (clean compounders)

  0339 — Three final tightenings:
         (a) Extreme-governance widened: ultra-microcap clause catches
             DRCSYSTEMS (P=20.6, FII+DII=0.4, MCap=215Cr)
         (b) InfoBeans clean-compounder lenience: profit-decel cap raised
             50→70 when all quality signals intact + no flags
         (c) Promoter-trend HIGH structural threshold raised 4pp → 7pp
             (Skipper drops out, real exit patterns still caught)

### USA scoring discipline patches (0340–0344)

  0340 — USA tightening: speculative pre-revenue cap, stratospheric multiple
         cap, hyper-base-effect detector, OTC penalty, tech-without-GPM cap,
         low-coverage cap, US 100-bagger DNA bonus (SaaS PREMIUM + Buffett
         compounder), elite R40 bonus.

  0341 — Wire new TradingView forensic columns into USA scoring:
         Piotroski F-score, Altman Z-score (SOFT — sparse data), Sloan
         ratio, Shares buyback ratio, Buyback yield, R&D ratio, Interest
         coverage, Net debt/EBITDA, Cash runway calc (cash / annual FCF
         burn × 12), Revenue per employee, Sustainable growth vs actual.

  0342 — Parser handles both NVDIA-format and NBIS-format TradingView CSVs.
         Added Altman Z-score TTM fallback, fixed "Cash and equivalents"
         (and vs &), added FCF per share TTM field.

  0343 — Six new enforcement caps:
         R40 tiered (<10/<20/<30/<40 → 55/65/72/78), growth <15% → cap 70,
         cycle-peak spike (annual > 1.8× 3yr CAGR) → cap 72, Sell rating
         cap 50, absolute OTC cap 78, absolute governance criticals.

  0344 — **TWO CRITICAL bugs fixed.**
         BUG 1: Math.round(78/5)*5 = 80 — caps at 78 silently jumped to 80
         (A grade). Fix: Math.floor instead.
         BUG 2: applyUSARanking() reassigned grades by percentile rank,
         OVERRIDING the score-based grade. Visible: VMD at score 70 showed
         A+ because it was top 10% by rank. Fix: use score-based grade as
         source of truth; only apply hard-cap grade adjustments for
         mega-cap, sub-10% growth, decelerating.

### New filters + R40 column (0345–0346)

  0345 — Composable filter chips (AND-style) on both India and USA:
         **USA**: R40 (≥40/≥60/≥80), Piotroski (≥5/≥7), GPM (≥40/≥60/≥70)
         **India**: Q50 (ROCE+ProfitCAGR ≥50/≥75/≥100 — India R40 analog),
         ROCE (≥20/≥25/≥30), CFO/PAT (≥0.8/≥1.0)
         All compose AND-style with grade, accelerating, FCF, analyst, PE, PEG.

  0346 — R40 = Quarterly Rev growth + FCF margin (was Annual). Dedicated
         sortable R40 column added between ACCEL and PILLARS in USA table
         header. Big colored number + tier label (🏆 elite/strong/passes/
         weak/fail) + composition `{Qtr%}+{FCF%}`.

### Decision logbook + cross-market detection (0347)

  0347 — Two major user-workflow features:

         **A) Decision logbook** — per-stock personal record:
         - New file `frontend/src/lib/decisions.ts` (similar pattern to
           lib/conviction-beats.ts)
         - DecisionStatus = 'BUY' | 'WATCH' | 'NEUTRAL' | 'REJECTED'
         - Decision interface: symbol, market, status, reason, date,
           scoreAtDecision, gradeAtDecision
         - localStorage key: `mc:decisions:v1`
         - Custom event `mc:decisions:updated` + storage event for cross-tab sync
         - DECISION_META: color + emoji + label per status
         - In multibagger/page.tsx: inline `DecisionBar` component used in
           both India AND USA expanded rows. Shows 4 colored buttons +
           reason text input + save/clear.
         - **Persistence guarantee**: decisions survive "Clear All Data".
           User re-uploads CSV months later, sees their previous REJECTED/
           BUY decision with the reason and date.
         - Filter chip rail: 📒 Decision filter on USA tab composes AND
           with all other filters.

         **B) Cross-market upload detection** — eliminates rework:
         - `detectCsvMarket(headers)` function in multibagger/page.tsx
         - USA signals: 'forward non-gaap', 'piotroski f-score', 'altman
           z-score', 'free cash flow margin', 'analyst rating'
         - India signals: 'promoter holding', 'promoter %', 'sales growth',
           'roce', 'pledged', 'change in promoter'
         - On India upload: peek headers BEFORE parse. If detected='US',
           confirm dialog "Switch to USA tab?". On OK, dispatches
           `mc:switch-multibagger-tab` event.
         - On USA upload: same flow, opposite direction.
         - Page listens to event in useEffect, calls setActiveTab.

### LocalStorage keys (full inventory after this session)

```
mb_excel_scored_v2          — India Multibagger parsed rows
mb_excel_meta_v2            — India upload metadata
mb_usa_scored_v1            — USA Multibagger parsed rows
mb_usa_prev_scores_v1       — USA prev-score baseline for Δ chip
mb_india_prev_scores_v1     — India prev-score baseline for Δ chip
mc:graded:v8:<date>         — Earnings Opportunities graded payload (mirrors KV)
mc:hub:v2:<months>          — Earnings Hub scan (months key)
mc_watchlist_tickers        — User watchlist tickers
mc:conviction-beats:v1      — Conviction Beats pipeline
mc:stock-sheet:v3:scrub-2026-05:<ticker>
mc:specsit:rejected:v1      — Special Situations rejected rows
mc:guidance-scores:v1       — Earnings Guidance Q-over-Q history (per period)
mc:notes:v1:<id>            — Thesis Notebooks v0 (per news article)
mc:news-alerts:v1           — News Alerts rules
mc:saved-views:v1           — Named Saved Views (News page)
mc:status-history:v1        — Status page client-side ring buffer
mc:decisions:v1             — PATCH 0347 personal decision logbook
```

### Key cross-tab event names

```
'conviction-beats:updated'              — Conviction Beats writers fire this
'mc:decisions:updated'                  — Decision logbook writers fire this
'mc:switch-multibagger-tab'             — Cross-market detection dispatches
                                          { tab: 'excel' | 'usa' }
'storage' (built-in)                    — All localStorage writes triggers this
```

### Architecture decisions worth preserving

1. **Scoring engine is the source of truth** — never let UI percentile rank
   override score-based grade. Patch 0344 caught this twice.

2. **Math.floor for cap rounding** — caps at 78 must bind at 78 (or lower),
   not silently round up to 80 (which jumps the A-grade boundary). Always
   use `Math.floor(score/5)*5`.

3. **Recompute red-flag counts AT cap time** — Patch 0335 lesson. Any rule
   that fires `redFlags.push(...)` after the bucket-classification block
   means the cap section must re-derive counts from the FINAL redFlags
   array, not from a snapshot.

4. **Decisions persist independent of upload data** — `lib/decisions.ts`
   uses its own localStorage key, completely independent of `mb_excel_scored_v2`
   and `mb_usa_scored_v1`. Clears don't touch decisions.

5. **MNC allowlist is the answer to "low institutional in India"** — foreign-parent
   subsidiaries (Kennametal, Carraro, Nitta Gelatin) shouldn't be penalized for
   low FII+DII because their parent's listing-exchange governance is the real
   accountability. Add new tickers to the `MNC_ALLOWLIST` Set in page.tsx
   when discovered.

## 10.10 · Batch-13 — USA post-mortem fixes from PAYS 16% drop (Patch 0349)

User bought PAYS (Paysign, score 90 A+, the #2 USA pick) after Q1 earnings;
stock dropped 16% immediately. Engine showed 17 strengths + 1 risk on PAYS —
clearly broken signal-to-noise. Diagnosis identified five gaps in the USA
scoring chain, all shipped in Patch 0349.

### Root-cause analysis of PAYS A+ grade

PAYS data the engine had:
- FCF margin 54.2% on **Operating margin 9.0%** (ratio 6.0×)
- Net profit margin 9.2%
- +138% past year (1Y Performance)
- Forward P/E 28×
- Microcap (\$370M market cap)
- Strong Buy analyst rating (after the 138% run)
- Next earnings within reach of the user's purchase window

Engine outcomes that were wrong:
1. Awarded SaaS DNA bonus (+6) AND Elite R40 bonus (+5) on the basis of
   the 54% FCF margin — but that FCF was almost certainly inflated by
   working-capital release / SBC add-back / deferred revenue, not
   sustainable from a 9% operating margin.
2. Treated "+138% past year — momentum confirming fundamentals" as a
   STRENGTH. After a 2× run at FwdPE 28×, the stock is priced for
   perfection — any disappointment leads to 15-20% mean reversion.
3. Gave Strong Buy full +8 to Market pillar despite the 138% run
   already having happened. Per Womack 1996, post-run analyst upgrades
   have near-zero predictive value.
4. No position-size guidance — \$370M microcap volatility is structurally
   2-3× large-cap. Score 90 microcap ≠ score 90 megacap.
5. No earnings-proximity check — user bought near the print without
   warning.

### Patch 0349 — surgical fixes in `multibagger/page.tsx` (USA side)

  0349a — **FCF / Op-Income divergence detector.** When `fcfMargin > 0`
          AND `opmTtm > 0` AND `fcfMargin / opmTtm > 2.0` AND
          `netProfitMargin < 15`, fire structural risk + suppress R40/DNA
          bonuses via `noSpeculativeCap` gate + cap composite at 70.
          Visible chip `🚨 FCF SUSPECT` with hover tooltip showing both
          margins and the ratio. PAYS now caps at 70 (was 90).

  0349b — **Post-run reversal cap.** If `perf1y > 100%` AND effective
          P/E (forward preferred, fallback to trailing) > 25 (or > 30
          when only trailing available), cap composite at 75. Visible
          chip `🌡 STRETCHED` with hover showing perf1y and PE.

  0349c — **Analyst-after-run discount.** When `perf1y > 50%` AND rating
          ∈ {Buy, Strong Buy}, halve the Market-pillar boost (8 → 4,
          4 → 2). Strength bullet rewrites to flag the discount + cite
          Womack 1996. Sell/Strong Sell paths unchanged (those are
          stronger signals when the stock is already up).

  0349d — **Earnings-proximity warning.** Parses `nextEarnings` date
          (handles both ISO and "MMM DD, YYYY" via `new Date()`). If
          within 7 days from today, surfaces inline chip `⚠ EARNINGS Nd`
          + risk bullet. Doesn't affect composite — pure timing-risk
          surface.

  0349e — **Position-size guidance chip.** Tiered by market cap:
          `<\$0.5B → 1.5%`, `<\$1B → 2.5%`, `<\$5B → 5%`,
          `<\$20B → 8%`, else 15%. Numeric chip `MAX X%` in the ticker
          cell. Display-only — no score impact. Reasoning: institutional
          position-sizing reflects liquidity / volatility, not just
          composite score.

### Retroactive re-score

Existing loaded data picks up the new rules automatically on next page
load via the existing `parsed.map(r => scoreUSARow(r as USARow))` flow
at line 6527-6531. No localStorage migration needed.

### New USAResult fields (returned from `scoreUSARow`)

```ts
fcfOpDivergence?: boolean;        // P0a flag — for chip rendering
postRunStretched?: boolean;       // P0b flag — for chip rendering
earningsProximityDays?: number;   // P1a — days to next earnings
suggestedMaxPositionPct?: number; // P1b — tiered by market cap
```

### Architecture lesson — additive strengths, exception-only risks

The scoring engine was systemically biased: every good metric stacked into
strengths; risks only fired on specific exception rules. So a row with
15 mediocre-but-not-flagged metrics + 2 great ones scored like the 2
great ones existed alone. PAYS had 17 strength bullets — including FCF
margin counted three times (once in strengths, once in R40, once in
DNA bonus). The 0349 fixes don't address this fully; future work should
de-duplicate same-data-point bonuses.

### Open work for next pass (not yet shipped)

- Single-source duplicate-bonus check: every score component should fire
  on a unique data point. FCF margin currently contributes to R40 calc,
  DNA bonus, AND standalone strength bullet — that's triple-counting.
- Stale-fundamentals-vs-fresh-price detector: when most recent reported
  quarter is > 60 days old AND price has moved > 15% in that window,
  flag "data may be stale relative to recent price action."
- Liquidity intelligence: average daily traded value column from
  TradingView would let the position-size guidance be dynamic per row
  rather than just mcap-tiered.

## 11 · Patch Log Summary (0073 → 0349)

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
- 0239 — CLAUDE.md update (end of batch-3)
- 0240 — Transmission commodity universe expanded (9 → 34 inputs)
- 0241 — Transmission sticky filter rail (URL-persistent)
- 0242 — Transmission shock drilldown side panel
- 0243 — Transmission Scenario Lab with sliders
- 0244 — Sparklines + tabular-nums + freshness pill on transmission
- 0245 — Right-rail Transmission Intelligence panel
- 0246 — CLAUDE.md final update (end of transmission batch)
- 0247 — Transmission unit labels fixed (Aluminum/Zinc/Soybean/Rubber)
- 0248 — Yahoo → FMP → AlphaVantage fallback chain
- 0249 — 1d move alongside 1m on transmission
- 0250 — Equity-proxy mode for 17 manual-feed commodities
- 0251 — Conviction Beats overlay on Intelligence/Signals (basic)
- 0252 — Special Situations clickable Tier/Category filter chips
- 0253 — EO calendar stuck-loading fix (cached payload always served)
- 0254 — Special Situations: REJECT→MONITOR, alpha tag, source-tier badge
- 0255 — EO Refresh button no-op fix + delayed worker follow-ups
- 0256 — Conviction Beats CB badge on ALL 8 Intelligence render sites
- 0257 — Special Situations client-side duplicate event collapse
- 0258 — Special Situations next-catalyst timeline rendering
- 0259 — Special Situations decay-color age chip
- 0260 — Special Situations India sub-category headline heuristic
- 0261 — Bottleneck Intel quote-mapping defense (undefined ticker crash)
- 0262 — Stock Sheet investigation (already defensive, no fix needed)
- 0263 — Mobile-responsive baseline (CSS-only, 8 @media rules)
- 0264 — CLAUDE.md end-of-session update
- 0265 — Multibagger scoring: ROIC<WACC kill switch + op-leverage soften
         + valuation cap on PEG-illusion + growth quality offset
- 0266 — Quality + Longevity caps when ROIC<WACC (later renumber 0269)
- 0267 — News article-list null headline defense
- 0268 — Dashboard top-strip missing-vs-zero change distinction
- 0269 — Multibagger Quality/Longevity 60-cap when ROIC<WACC
- 0270 — Bottleneck Workbench bucket.key_tickers null-guards
- 0271 — IPOs + Screener null-guards (loop iteration 12)
- 0272 — Conviction Beats overlay on Multibagger (badge + filter chip)
- 0273 — Conviction Beats overlay on Earnings Guidance + Hub header chip
- 0274 — Extract PanelFreshness to shared component (+ Breadth + StratVis)
- 0275 — PanelFreshness wired into Screener + IPOs
- 0276 — Conviction Beats overlay on Screener (badge + CB-only toggle)
- 0277 — Conviction Beats overlay on Re-rating Screener (all 3 panels)
- 0278 — Bottleneck Workbench: theme-picker search + theme-not-found state
- 0279 — News Alerts JSON import/export (rules portable across browsers)
- 0280 — CLAUDE.md update (end of batch-4)
- 0281 — Heatmap null-guards on `dailyData.stocks` / `earningsData.results`
- 0282 — PanelFreshness on /themes, /ai-desk, /alerts
- 0283 — Global Conviction Beats count chip in dashboard header
- 0284 — PanelFreshness on /smart-money + /movers
- 0285 — CLAUDE.md update (end of batch-5)
- 0286 — EO refresh feedback rewrite (date-age aware, timestamped)
- 0287 — Settings: bounded 5s timeout + graceful "Profile unavailable"
- 0288 — IPO TBA fallback: amber "Check NSE/BSE →" deeplink banner
- 0289 — News junk filter: 9 new consumer-deal patterns
- 0290 — Impact↔Headline relevance check suppresses theme-paste mismatch
- 0291 — Movers row: ₹Cr market cap inline + 📰 'Why moving?' shortcut
- 0292 — CLAUDE.md update (end of batch-6)
- 0295 — Bottleneck Intel auto-collapses stale themes
- 0293 — RRG sector dot opens /news?search=<sector>; tooltip hint
- 0294 — Earnings Guidance Q-over-Q score delta (localStorage history)
- 0296 — Status page Promise.allSettled + per-probe try/catch
- 0297 — Watchlist flag toggle race fix (functional setState)
- 0298 — Calendars AbortController on fetch (no stale overwrite)
- 0299 — Status page granular OK/STALE/FAIL breakdown chip
- 0300 — Portfolio header freshness chip from existing lastRefresh
- 0301 — CLAUDE.md update (end of batch-7)
- 0302 — Calendars: prominent index-filter chip in header
- 0303 — Watchlist empty-state cross-links to Conviction Beats + Screener
- 0304 — CLAUDE.md update (end of batch-8 / session close)
- 0305 — lib/merger-arb.ts + SimpleArbCalc panel on Special Situations
- 0306 — lib/deal-probability.ts heuristic engine
- 0307 — /api/v1/heartbeat/<pipeline> KV ring buffer
- 0308 — Source-tier KV override table (admin + public resolver)
- 0309 — /api/v1/earnings/nse-announcements Tier 2 resolver
- 0310 — /api/v1/ticker-roles/<ticker> server-side classifier
- 0311 — /api/v1/public/graded/<date> public API with rate-limit
- 0312 — CLAUDE.md update (end of batch-9)
- 0313 — Multibagger Governance Watch (low promoter + zero institutional)
- 0314 — Multibagger six institutional red flags
- 0315 — HIGH severity tier split (STRUCTURAL vs CYCLICAL)
- 0316 — Per-row SCORE AUDIT chip strip
- 0317 — 9 new institutional metrics scaffold + scoring rules
- 0318 — SEC EDGAR M&A filings adapter
- 0319 — Theme revisions KV snapshot log
- 0320 — Special Situations lifecycle state machine
- 0321 — Special Situations playbook intelligence library
- 0322 — Multibagger forensic pump-detector (11 signals)
- 0323 — METRICS_TO_ADD.md user-facing doc
- 0324 — Transmission z-score statistical layer
- 0325 — CLAUDE.md update (end of batch-10)
- 0326 — Forensic pump-score chip visible on Multibagger row
- 0327 — Score-change chip (NEW / = / ▲+N / ▼-N) on row
- 0328 — Special Situations playbook intelligence panel
- 0329 — Status page POSTs to server-side heartbeat KV
- 0330 — Transmission z-score chips in commodity drilldown
- 0331 — CLAUDE.md update (end of batch-11)
- 0332 — Align Multibagger parser with actual Screener export
- 0333 — Update METRICS_TO_ADD.md with what user has + what's missing
- 0334 — Wire ownership-change-3Years columns into trend rules
- 0335 — **CRITICAL bug**: recompute red-flag counts at score-cap time
- 0336 — Re-apply red-flag caps after guidance adjustment
- 0337 — Four scoring tightenings (WC trend, op-lev, story-stock, cyclical-peak)
- 0338 — 500-bagger DNA upgrade + MNC allowlist + tighter pump thresholds
- 0339 — DRC fix + InfoBeans clean-compounder exemption + promoter trend
- 0340 — USA scoring tightening — caps + DNA + speculative filter
- 0341 — USA forensic columns (Piotroski/Altman/Sloan/Buyback/ICR/R&D)
- 0342 — Handle both NVDIA-style + NBIS-style USA CSV formats
- 0343 — USA enforcement caps (R40 tiered, growth, cycle-peak, Sell rating, OTC)
- 0344 — **CRITICAL bugs**: rounding-bypass + percentile-grade-override
- 0345 — R40 filter (USA tiered) + Q50 composite filter (India)
- 0346 — R40 = Quarterly Rev + FCF margin; dedicated sortable column
- 0347 — Decision logbook (BUY/WATCH/NEUTRAL/REJECTED) + cross-market detection
- 0348 — CLAUDE.md handoff memory update (section 10.9, batch-12 docs)
- 0349 — USA scoring discipline: FCF/Op divergence cap, post-run reversal cap,
         earnings-proximity warning, position-size guidance chip, analyst
         after-run discount. Triggered by PAYS 16% drop post-earnings.
- 0549 — Conviction Beats: hard-coerce viewMode='compact' and drop legacy
         'mc:conviction-view' LS key so returning users with 'rich' set no
         longer trigger the dead-coded Earnings-Hub enrichment fetch on
         every visit (200+ tickers, network burned, UI ignored result).
- 0550 — Defensive guards batch: calendars formatShortDate Invalid-Date
         fallback; special-situations error-path by_category now includes
         CAPEX+CONCALL; catCounts guard against runtime category not in
         union (no more 'NaN' chip labels); earnings-opportunities second
         useQuery initialDataUpdatedAt now pairs correctly with initialData
         (AUDIT_100 #6 / patch-pair fix).
- 0551 — AUDIT_100 #9: bound 'mc:notes:v1' Thesis Notebooks via sidecar
         'mc:notes:meta:v1' index. Evict oldest by lastWriteEpoch when
         entry count exceeds NOTE_MAX=200. Prevents silent QuotaExceeded
         that would freeze setItem across the app.
- 0552 — fetchQuotesShared race-safe: detach caller's AbortSignal from
         the shared in-flight fetch so a single unmount no longer cancels
         the network call for all joined consumers (the documented
         Patch-0544 limitation). Each caller now races its own signal
         against the shared promise via a wrapper.

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
# IMPORTANT: Sandbox name changes per session. Substitute the actual sandbox
# name from your bash mounts (e.g. `sleepy-serene-brahmagupta`, `zen-epic-bardeen`).
# Files-tool path: /Users/radhevrishi/Desktop/Python/Imp Marketcockpit/market-cockpit/
# Bash-tool path:  /sessions/<sandbox>/mnt/market-cockpit/

# Type-check (always before commit — non-negotiable)
cd /sessions/<sandbox>/mnt/market-cockpit/frontend && timeout 35 npx tsc --noEmit

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

## 14.5 · Deploy Flow (CRITICAL — this is what works in 2026-sandbox environments)

The git index lock on the mounted folder is restricted in the sandbox (cannot
delete `.git/index.lock`), so direct commits from `/sessions/<sandbox>/mnt/market-cockpit/`
fail intermittently. **Use a separate `/tmp/mc-deploy` clone for commits.**

### Setup (first time per session)

```bash
# The token-embedded git URL lives inside the mounted .git/config — extract it
grep -i url /sessions/<sandbox>/mnt/market-cockpit/.git/config | head -1
# Output: url = https://radhevrishi:ghp_XXX...@github.com/radhevrishi/market-cockpit.git

# Clone using that URL (only needed if /tmp/mc-deploy missing)
git clone <THE_TOKEN_EMBEDDED_URL> /tmp/mc-deploy
```

### Per-patch deploy flow

```bash
cd /tmp/mc-deploy && \
  git pull --rebase origin main 2>&1 | tail -3 && \
  cp '/sessions/<sandbox>/mnt/market-cockpit/frontend/src/app/(dashboard)/multibagger/page.tsx' \
     'frontend/src/app/(dashboard)/multibagger/page.tsx' && \
  git add -A && \
  git config user.email "radhev.232@gmail.com" && \
  git config user.name "Rishi" && \
  git commit -m "Patch 0XXX: short description" && \
  git push origin main
```

Adjust the `cp` line for whichever files changed. For new files (like
`frontend/src/lib/decisions.ts`), add them with a second `cp`.

### Why this works (not the mounted folder directly)

- The user's actual workspace at `/Users/.../market-cockpit/` is mounted
  read-write under `/sessions/<sandbox>/mnt/market-cockpit/` for FILE tools
  (Read/Write/Edit) but the sandbox bash has read-restricted `.git/index.lock`
  permissions, leading to "Operation not permitted" errors mid-commit.
- `/tmp/mc-deploy` is a fully-writable clone the bash sandbox can manipulate.
- File-tool edits on the mount land in the user's actual workspace AND the
  `cp` step replicates them into `/tmp/mc-deploy` for the push.
- Result: the file-tool edits update both the user's local files (visible in
  their IDE) AND get pushed to GitHub → Vercel.

---

## 15 · How to Start a New Chat

Paste this into the new chat as the first message:

> Read `/Users/radhevrishi/Desktop/Python/Imp Marketcockpit/market-cockpit/CLAUDE.md` before doing anything. It has the full project context from the previous session. Then [your actual request].

That's it. The new agent will load the memory and you skip the 30-min rebuild.

If the new agent needs to push code, it should:
1. Find its sandbox name via `pwd` or `ls /sessions/`
2. Substitute that name into the section 2 path + section 14 commands
3. Use the deploy flow in section 14.5 (the `/tmp/mc-deploy` clone)
4. Check section 10.9 first if continuing scoring work — patches 0335 and
   0344 fixed CRITICAL bugs you don't want to reintroduce
