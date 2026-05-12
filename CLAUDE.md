# Market Cockpit — Claude Handoff Memory

> Read this FIRST when starting any new chat. Saves you 30 minutes of context-rebuilding.
> Last updated: 2026-05-13 (after Patch 0300 — race-condition hardening + drill-through enrichments across whole dashboard).

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

## 11 · Patch Log Summary (0073 → 0300)

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
