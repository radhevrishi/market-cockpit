# Market Cockpit — €500K Portal Review

_Generated: 2026-05-21 · After Patch 0600 ship · HEAD `4fb8181`_

> Comprehensive review of every dashboard page (42 pages, 28 in nav) with concrete
> consolidation plans, must-have feature gaps, and a sequenced implementation roadmap
> to take this from "powerful internal tool" to "€500K institutional portal".

---

## Executive Summary

**Where it stands today (1-10 scales):**

| Dimension | Score | Note |
|---|---|---|
| Data depth | 9/10 | 42 pages, multi-source ingestion, 8 institutional libs (op-leverage, deal-prob, bottleneck-intel etc) |
| Thematic architecture | 9/10 | Bottleneck taxonomy + transmission cascade + cluster framework is genuinely differentiated |
| Idea generation | 8/10 | Cross-stream evidence convergence is the strongest feature in the entire app |
| Decision support | 7/10 | Decision Logbook + Multibagger Analytics + Specsit Analytics shipped; integration weak |
| **Information density** | 5/10 | **Critical weakness — too many pages, redundant tabs, no story flow** |
| **Quant rigor / calibration** | 4/10 | **Heuristic regex/lexicon; no backtested probabilities, no realized-alpha feedback** |
| Portfolio construction | 4/10 | Basket scaffolds exist; position-sizing is mcap-tier heuristic; no factor overlap / crowding |
| Market-implied confirmation | 3/10 | No RS / volume acceleration / options flow / earnings revisions / short interest |
| Counter-thesis discipline | 6/10 | Catalog exists (lib/bottleneck-intel.ts) but only 8 themes covered |
| Investability mapping (India) | 8/10 | Curated proxy lists shipped for 8 core themes; needs 20+ more |

**Bottom line.** The intelligence stack is hedge-fund quality; the surfacing layer is retail-quality. The single biggest unlock is **consolidation + market-implied validation**. Without both, this remains a powerful idea-generation engine rather than a deployable allocation system.

---

## 1. Page Inventory — The 42 Surfaces

### Sidebar nav (28 visible)

```
News Feed                  →  /news
Market Snapshot           →  /market-snapshot       (heatmap + movers combined)
Portfolio                 →  /portfolio
Watchlist                 →  /watchlists
Signals                   →  /orders                (renamed from Orders)
Special Situations        →  /special-situations
Rating Actions            →  /rating-actions
Earnings Hub              →  /earnings-hub          (Calendar+Scan+Guidance+Concall sub-tabs)
Earnings Scan             →  /earnings              (separate from Hub)
Earnings Opportunities    →  /earnings-opportunities
Strategic Visibility      →  /strategic-visibility
Multibagger               →  /multibagger           (India + USA + Turnaround + Analytics + Checklist)
Valuations                →  /valuations            (10-model fair-value strip)
Super Investors           →  /super-investors
Concall Intelligence      →  /concall-intel
Decision Logbook          →  /decisions
Stock Sheet               →  /stock-sheet
Re-rating                 →  /rerating
Bottleneck Intel          →  /bottleneck-intel
Bottleneck Workbench      →  /bottleneck-workbench
RRG                       →  /rrg
Screener                  →  /screener
Breadth                   →  /breadth
Transmission              →  /transmission
Company Intelligence      →  /company-intel
IPOs                      →  /ipos
News Alerts               →  /news-alerts
System Status             →  /status
```

### Hidden pages (14, not in sidebar but routable)

```
/ai-desk           /alerts           /calendars         /company-news
/earnings-analysis /earnings-guidance /earnings-scan    /heatmap
/movers            /signals          /smart-money       /themes
/settings          (root /page.tsx)
```

**Problem:** 42 routes is too many for any single human to navigate consciously. Most "premium" research portals (FactSet, Sentieo, AlphaSense, Koyfin) live within 8-12 top-level surfaces with sub-tabs inside.

---

## 2. Consolidation Map — Cutting 28 nav items → 12

This is the single biggest UX upgrade available. The structure I'd ship:

### Final 12-item navigation

| # | New nav label | Combines (current) | Reasoning |
|---|---|---|---|
| 1 | **🏠 Home** | NEW dashboard with KPIs across the app | Today's top 5 ideas, alerts, news headline strip — replaces the cluttered list nav as entry point |
| 2 | **📰 News & Signals** | `/news` + `/news-alerts` + `/themes` + `/company-news` | All news surfaces — feed + structured alerts + themes + per-company. Tabs inside. |
| 3 | **🏗 Bottleneck Intelligence** | `/bottleneck-intel` + `/bottleneck-workbench` + `/transmission` + `/strategic-visibility` | The bottleneck-intel + workbench + transmission + strategic-visibility are all variations of the same thematic-supply-chain mental model. Tabs: Themes / Workbench / Transmission / Mega-deals. |
| 4 | **📅 Earnings** | `/earnings-hub` + `/earnings` + `/earnings-opportunities` + `/earnings-analysis` + `/earnings-guidance` + `/earnings-scan` + `/calendars` | **The biggest mess in the app.** 7 different earnings surfaces. Consolidate to one Earnings page with tabs: Calendar / Scan / Opportunities / Guidance / Analysis. |
| 5 | **🎙 Concall Intelligence** | `/concall-intel` + `/company-intel` + `/ai-desk` | Already has Live + Analytics tabs. Pull Company Intel (uploaded transcripts) and AI Desk (briefs) inside. |
| 6 | **🎯 Special Situations** | `/special-situations` + `/rating-actions` | Both are event-driven re-rating catalysts. Make Rating Actions a tab inside Special Sit. |
| 7 | **🚀 Multibagger Research** | `/multibagger` + `/valuations` + `/rerating` + `/screener` + `/stock-sheet` | All long-form fundamental research surfaces. The Multibagger page already has India / USA / Turnaround / Analytics / Checklist tabs — extend with Valuations / Re-rating / Stock-sheet / Screener. |
| 8 | **🌐 Market Snapshot** | `/market-snapshot` + `/heatmap` + `/movers` + `/rrg` + `/breadth` | Macro-level views: market regime, breadth, sector rotation, intraday movers. Currently fragmented across 5 pages. |
| 9 | **💰 Smart Money & IPOs** | `/super-investors` + `/smart-money` + `/ipos` | Coat-tail + bulk/block deals + IPO calendar — all "follow the institutional money" content. |
| 10 | **💼 My Book** | `/portfolio` + `/watchlists` + `/decisions` + `/orders` (Signals) | Everything personal: holdings, watchlist, decision logbook, my signal feed. The "what's mine" zone. |
| 11 | **🚨 Alerts** | `/alerts` + `/news-alerts` + (new alert rules engine) | All alert configuration in one place. Today these are scattered. |
| 12 | **⚙ Settings & Status** | `/settings` + `/status` | Admin + system health. |

**Saved nav slots: 16.** Cognitive load reduction is dramatic.

### Implementation effort

- **Easy (1-2 days each):** items 6, 9, 10, 11 — just sidebar relabel + URL params
- **Medium (3-5 days each):** items 2, 3, 5, 7, 8 — needs proper tab structure inside the merged page
- **Hard (1 week):** item 4 (Earnings) — 7 pages with overlapping data fetches needs careful surgery
- **New build (5 days):** item 1 (Home dashboard) — entry-point cockpit

---

## 3. Must-Have Features Still Missing

Ranked by **PM-workflow impact**. The first 8 are what separates this from being a €500K portal vs a powerful free tool.

### TIER 0 — Cannot launch as €500K without these

**1. Market-implied confirmation layer.** Single biggest gap. Every idea this engine generates needs to be confirmed against:
- Relative strength vs sector / Nifty
- Volume acceleration (>2× 20-day avg = institutional accumulation)
- Earnings revisions (FY1/FY2 EPS estimate direction over last 30 / 60 / 90 days)
- Short interest (where available — limited in India)
- Options flow (US only)
- Credit spreads / CDS (large caps only)

Without this, you have an idea-generation surface, not a portfolio engine. **The catalog says "buy Hitachi Energy India" — but is price action confirming? Is the Street raising estimates?** Today the answer is "no idea, look it up yourself".

**2. Realized-alpha feedback loop.** Today there's zero attribution. Every idea this app surfaced 6 / 12 / 18 months ago should automatically score itself against the realized return relative to Nifty. Without this:
- Engine can't self-calibrate
- User can't tell which detectors actually work
- No way to weight detectors by historical hit-rate

This is what makes "evidence density" eventually become "probability of close" — you need to actually count hits and misses.

**3. Portfolio construction layer.** Today the analytics surface candidates; nothing turns them into a portfolio. Missing:
- Factor overlap analysis (are these 8 names all the same trade?)
- Sector concentration limits
- Correlation matrix
- Crowding metrics (how many other institutional desks are also buying?)
- Position sizing based on realized volatility + ADV liquidity (not just mcap tier)
- Rebalancing suggestions

### TIER 1 — Premium features that justify the price tag

**4. Saved Views + Workspaces.** Power users want to define "my morning briefing": a saved layout that snapshots Top-3-Multibagger + Cross-Stream-Convergence + Today's-Rating-Actions + My-Portfolio-Delta into one screen. Today every page is a fresh fetch with no persistence.

**5. Full-text search.** Hit Cmd+K → "what filings mentioned 'capacity expansion' in last 7 days from Chemicals sector?" There's a global Cmd+K but it's limited to tickers. The user needs to search across:
- Article bodies
- Concall transcripts
- Filings
- Their own decision-log notes

**6. Notes & sharing.** Per-ticker note threads visible to a team. Today there's a Thesis Notebooks v0 (localStorage) but it's per-browser. Without team sharing, an institutional desk can't use this.

**7. Backtest panel per detector.** Every signal-generating detector (Op-Leverage Cluster, Warrant Conviction, Bullish Tier, Bottleneck Severity) should have its own historical hit-rate visualisation. "Op-Leverage Cluster has triggered 47 times since 2022; median 12-month forward return +24% vs Nifty's +14% — 33 of 47 outperformed". Without this, scores are arbitrary numbers.

**8. Alerts as code.** Today News Alert Rules are simple regex matchers in localStorage. A €500K portal needs:
- Compound conditions (`bullish_score > 70 AND sector = Power AND mcap < 5000 Cr`)
- Server-side evaluation (no need to keep tab open)
- Delivery: email + Slack + Telegram + webhook
- Cooldown rules to avoid alert fatigue

### TIER 2 — Polish features

**9. Mobile companion.** Today the dashboard is responsive-ish but not mobile-first. A €500K portal needs a Slack/Telegram bot — partially shipped (eo-blockbuster-alert, watchlist-alert) but no two-way interaction.

**10. Citations everywhere.** Every claim ("Hitachi Energy India is a PURE-exposure transformer play") should be backed by a hover-able citation chain. Today the bottleneck-intel catalog is curated manually — no provenance.

**11. Versioning + audit log.** When the cluster framework formula changes from 0.30·Util to 0.35·Util, an institutional client needs to see the diff, the date, and the reasoning. Today scoring changes ship invisibly via patch numbers.

**12. Real-time co-pilot mode.** "I'm researching Polycab — show me everything you have on it across all 42 surfaces." Today the user has to manually open Stock Sheet, search Multibagger Analytics, scan Special Situations, etc. A single LLM-orchestrated "ticker briefing" mode would compress 30 minutes of manual navigation into 30 seconds.

---

## 4. UX Improvements By Surface

Ranked by impact / effort.

### High impact, low effort (ship this week)

| Page | Problem | Fix |
|---|---|---|
| All decision buckets | Score+grade chips repeat "A+" / "78A" 4-5 times per row | Compress to one chip in row header |
| News Feed | 3-line article cards eat vertical space; no compact-view toggle | Add density toggle (cards / list / chart) |
| Earnings Opportunities | 7 filter chips in same toolbar; ambiguous priority | Group: PRIMARY filters (date / tier) vs SECONDARY (grade / pead / guidance) |
| Multibagger Analytics | 18 separate cards scroll for screens | Top-of-page sticky summary strip with one-line state per card; click-to-jump |
| Bottleneck Workbench | Theme picker hidden inside the page | Move to URL-persistent dropdown in page header |
| Special Situations | Live tab and Analytics tab feel disconnected | Add cross-link chips ("Open in Analytics") on each event card |
| Stock Sheet | No persistence — fill-in checkboxes lost on reload | Already in localStorage; add prominent "Last saved 14:32 ✓" indicator |

### High impact, medium effort

| Issue | Fix |
|---|---|
| Every page has its own freshness chip, refresh button, error-state, density default | Extract into one `<PageShell>` component used everywhere — single source of truth |
| Dark mode contrast across charts is inconsistent | Pass through the design-tokens system to recharts / d3 charts |
| Loading skeleton flashes on every nav (no React Query prefetch) | Implement route prefetch for the Home dashboard top picks |
| Mobile layout collapses but doesn't reorganize (all desktop sections shown in narrow column) | Add mobile-first reorder rules per section (Bottom navigation tab bar on <600px) |

### High impact, hard effort

| Goal | Effort | Why it matters |
|---|---|---|
| Per-ticker briefing mode (LLM-orchestrated cross-surface aggregation) | 2-3 weeks | The single feature that justifies the price tag — competitor portals charge €50K+ for this alone |
| Server-side persistence (Auth + Postgres) | 4-6 weeks | Unlocks team-sharing, alerts-as-code, audit logging, backtest persistence |
| Market-implied confirmation layer (RS / volume / earnings revisions) | 3-4 weeks | The most-requested institutional feature |

---

## 5. Hidden Pages Audit — Decide: nav, merge, or kill

| Hidden page | Today's role | Recommendation |
|---|---|---|
| `/ai-desk` | LLM-driven daily brief | Merge into Concall Intelligence as a sub-tab |
| `/alerts` | Alert configuration (different from /news-alerts) | Merge into `/news-alerts` (single Alerts surface) |
| `/calendars` | Earnings calendar grid | Merge into Earnings Hub Calendar tab |
| `/company-news` | Per-company news | Merge into Stock Sheet |
| `/earnings-analysis` | LLM analyst on earnings PDF | Merge into Earnings Hub Analysis tab |
| `/earnings-guidance` | Guidance scan | Merge into Earnings Hub Guidance tab |
| `/earnings-scan` | Earnings scanner (duplicate?) | Verify — looks like duplicate of `/earnings` — kill one |
| `/heatmap` | Sector heatmap | Merge into Market Snapshot |
| `/movers` | Daily movers | Merge into Market Snapshot |
| `/signals` | Mostly empty alias of `/orders` | Kill — redirect to `/orders` (renamed Signals) |
| `/smart-money` | Bulk/block deals | Merge into Smart Money & IPOs umbrella |
| `/themes` | News themes alternate view | Merge into News & Signals tabs |
| `/settings` | Admin settings | Keep, move to Settings & Status umbrella |
| `/page.tsx` | Root | Replace with Home dashboard |

---

## 6. The Home Dashboard — Critical Missing Piece

There is **no entry point** today. A user lands on the app and sees... nothing. They have to know which of 28 sidebar items to click. This is the biggest UX failure in the app.

### What Home should show (one screen, scroll-free)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🌅 GOOD MORNING, RISHI                          Market: 23,654 (-0.02%) │
├──────────────────────────────────────────────────────────────────────────┤
│ 🎯 TODAY'S TOP 3 ACTIONS                                                  │
│   1. CG Power · A · in CB · Why: Strong Buy convergence + structural     │
│   2. Hitachi Energy India · A · PURE proxy on Transformer bottleneck     │
│   3. Honasa Consumer · ×3 streams · Warrant + Bullish + Keyword          │
├──────────────────────────────────────────────────────────────────────────┤
│ ⚠ ALERTS (3)                       │ 📅 EARNINGS TODAY (12)             │
│ • Rating: ICRA upgrade RELIANCE    │ • TCS, INFY, HDFCBANK at 16:00     │
│ • Special-sit: Vedanta tender open │ • View all in Earnings Hub →       │
├────────────────────────────────────┼────────────────────────────────────┤
│ 📊 BOTTLENECK PIPELINE THIS WEEK   │ 💼 MY PORTFOLIO                     │
│ • Grid/Transformer ▲ 18 articles   │ • Today P&L: +₹12,400 (+0.84%)     │
│ • HBM/CoWoS ▲ 11 articles          │ • Best: NVDA +3.2%                  │
│ • Defense ─ 7 articles              │ • Worst: ITC -1.4%                  │
├──────────────────────────────────────────────────────────────────────────┤
│ 🔥 IN-PLAY NEWS — top 5 ranked impact stories from last 4 hours         │
│ ... ... ... ...                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

Everything here links into the deeper surfaces. The user makes 5 decisions in 60 seconds instead of clicking through 28 nav items.

**This single page is worth more than the next 5 features combined.**

---

## 7. Priority Roadmap — How to actually get to €500K

### Sprint 1 (week 1-2): Consolidation foundation

- [ ] Build `<PageShell>` component (freshness / refresh / error / density-toggle)
- [ ] Consolidate Earnings: merge 7 pages into one with proper tabs (the biggest mess)
- [ ] Consolidate Bottleneck: merge `/bottleneck-intel` + `/bottleneck-workbench` + `/transmission` + `/strategic-visibility`
- [ ] Consolidate Market: `/heatmap` + `/movers` + `/market-snapshot` into one
- [ ] Kill: `/signals` (redirect), `/earnings-scan` (verify dup), `/page.tsx` (replace)

### Sprint 2 (week 3-4): Home dashboard

- [ ] Build `/page.tsx` Home — KPI strip + top 3 actions + alerts + earnings today + bottleneck pipeline + portfolio + in-play news
- [ ] Wire up data sources from existing endpoints
- [ ] Sidebar collapses to 12 items
- [ ] Saved Workspaces v0 (localStorage)

### Sprint 3 (week 5-7): Market-implied validation

- [ ] Backend: pull /api/v1/quotes/rs (relative strength endpoint)
- [ ] Backend: pull earnings revisions from a third-party feed
- [ ] Each idea-row on every page shows: RS chip · Volume chip · Estimate-direction chip
- [ ] Cross-stream evidence chips upgrade from "×3 streams" to "×3 streams + RS confirming + Estimates rising"

### Sprint 4 (week 8-10): Backtest + alpha feedback

- [ ] Backend: each detector tracked over time in Postgres (Auth provider decision needed first)
- [ ] Per-detector backtest panel: 12-month rolling hit-rate, median forward return vs Nifty
- [ ] Score calibration based on historical hit-rate (start replacing heuristic 0-100 numbers with actual probabilities)

### Sprint 5 (week 11-12): Portfolio construction

- [ ] Factor overlap matrix per basket
- [ ] Sector concentration limits
- [ ] Correlation matrix
- [ ] Crowding metrics
- [ ] Position-sizing model (vol-adjusted, ADV-aware)

### Sprint 6 (week 13-14): Co-pilot mode

- [ ] LLM-orchestrated per-ticker briefing ("brief me on POLYCAB across all surfaces")
- [ ] Citations + provenance chain
- [ ] Full-text search across articles + filings + transcripts + notes

### Sprint 7 (week 15-16): Polish + launch

- [ ] Mobile companion app or PWA
- [ ] Team-sharing (multi-user with Auth)
- [ ] Alerts-as-code (compound conditions, server-side, multi-channel delivery)
- [ ] Versioning + audit log on scoring changes

**At end of sprint 7 (~4 months), this is a €500K portal.**

---

## 8. Things to KILL or REBUILD

Be ruthless. €500K customers do not pay for "powerful but cluttered". They pay for "elegantly opinionated".

### Kill outright
- `/earnings-scan` — appears to duplicate `/earnings`
- `/signals` — empty alias of `/orders`
- The legacy `/page.tsx` root — replace with proper Home dashboard

### Rebuild
- News Feed card layout — currently 3-line cards; institutional users want list view with hover-expand
- Stock Sheet — currently a checklist UI; needs to be the authoritative per-ticker dashboard
- Decision Logbook — currently a flat table; should be a full thesis journal with linked evidence

### Rename for clarity
- `/orders` → keep as Signals (already done)
- `/decisions` → "Decision Journal" rather than "Decision Logbook"
- Bottleneck Intel → "Constraint Economics" (the user-feedback term they used)

---

## 9. Honest Caveats

This review is opinionated and aggressive. Three caveats:

1. **The user (you, Rishi) has built this primarily for himself.** Some of the redundancy (Earnings Scan + Earnings + Earnings Hub) reflects iterative product evolution, not bad design. A buyer would see redundancy where the builder sees historical workflow paths.

2. **The intelligence is real.** No competing retail tool has the bottleneck transmission cascade or the operating leverage cluster framework. The €500K case is not "the data" — it's already there.

3. **The €500K case is "decision compression".** Today: hedge-fund-grade intelligence buried under retail-grade navigation. Fix consolidation + Home dashboard + market-implied validation = institutional pricing.

---

## 10. Three-Month Sprint Pick (if you can only do one)

If forced to pick ONE thing to ship in the next 3 months that moves the needle most:

> **Build the Home dashboard + Earnings consolidation + Market-implied validation chips.**

That trio takes the system from "powerful internal tool" to "buyer would consider this seriously". Everything else is incremental.

The two non-trivial decisions blocking are still:
- **Auth provider** (Clerk / Supabase / NextAuth) — unlocks team-sharing, server-side alerts, audit log
- **Postgres / Supabase DB** — unlocks backtest persistence, factor library, signal calibration

Without one of these committed, the system caps at "single-user power-tool" tier.

---

_End of review. Save for next session reference._
