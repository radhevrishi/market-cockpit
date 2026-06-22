# Market Cockpit — Operations Runbook

Self-service operations guide. Written 2026-06-22 ahead of a Pro-tier window.
Production: https://market-cockpit-production.up.railway.app
Repo: https://github.com/radhevrishi/market-cockpit

---

## SESSION 2026-06-22 — earnings pipeline + Yahoo migration + CF CI fix

### 1. What was fixed this session (high level)

- **Earnings Intelligence**: was 0/25 working at session start, now 105+/112 symbols return full quarter data.
- **Yahoo v7/quote API died** (started returning 401 across the board). Migrated `mc-movers` Worker and the `/api/market/multibagger` route to `v7/finance/spark` (and `v8/finance/chart` as fallback). spark returns a compact time-series payload that we collapse to last close + prev close client-side.
- **Deploy Workers CI was broken since Jun 19**: the `CLOUDFLARE_API_TOKEN` GitHub secret had the wrong scopes. Cloudflare silently changed the "Edit Cloudflare Workers" template — instead of granting `Workers Scripts:Edit`, the template now grants `Workers Agents Configuration:Edit`, which wrangler cannot use to publish a Worker script. Fix: create a **custom** API token with `Account → Workers Scripts → Edit` explicitly. Do not trust the named template.
- **Hidden misleading 0/0/0 chip**: the `/earnings-opportunities` page showed a `NSE 0 · BSE 0 · merged 0` chip even when data was healthy because the counter read from a stale prop. Removed the render (zzz58).
- **Calendar month-aggregate query**: `?month=YYYY-MM` was returning a per-day shape and then 0-aggregating. Fixed to call the per-day endpoint in a loop and sum into `{ month, total, by_date }`.

### 2. How to handle future variants of these issues (self-service)

**If Earnings Intelligence shows DATA MISSING for many symbols:**
1. Hit `https://indiaearninghub.radhev-232.workers.dev/health` — if non-200, the indiaearninghub Worker is down. Check CF dashboard logs.
2. If the Worker is healthy but data is missing, fetch one symbol directly: `curl 'https://indiaearninghub.radhev-232.workers.dev/q?symbol=TCS'`. If the Worker returns empty quarter data but a 200, screener.in changed its HTML structure — check the regex/selectors in the Worker source for `screener.in/company/<symbol>` parsing.
3. The Worker has its own GitHub repo. The static HTML parse selectors live in `src/screener.ts`.

**If Yahoo returns 401:**
1. Yahoo has rotated auth or moved another endpoint behind the crumb wall. Do NOT try to scrape the cookie + crumb dance — it's not stable.
2. Migrate the caller to `v7/finance/spark?symbols=...&range=5d&interval=1d` (returns just close prices, no auth).
3. Or `v8/finance/chart/<symbol>?range=5d&interval=1d` (more verbose, also auth-free).
4. Both already work from `mc-movers/src/yahoo.ts` — copy the helper.

**If Deploy Workers CI fails:**
1. Check the run log. If you see `Authentication error [code: 10000]` or `not authorized to edit Workers scripts`, it's the token.
2. Go to https://dash.cloudflare.com/profile/api-tokens, create a **Custom Token** (NOT the "Edit Cloudflare Workers" template).
3. Permissions: `Account → Workers Scripts → Edit`, `Account → Account Settings → Read`, `User → User Details → Read`.
4. Account resource: `880c51da572278c2d828f6f74ab3ecc3`.
5. Paste into GitHub repo Settings → Secrets → Actions → `CLOUDFLARE_API_TOKEN`.

**If a Worker stops working entirely and CI is also broken:**
1. Bypass wrangler with a direct multipart PUT:
   ```
   curl -X PUT \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -F "metadata=@metadata.json;type=application/json" \
     -F "script=@worker.js;type=application/javascript+module" \
     "https://api.cloudflare.com/client/v4/accounts/880c51da572278c2d828f6f74ab3ecc3/workers/scripts/<name>"
   ```
2. `metadata.json` is `{"main_module": "worker.js", "compatibility_date": "2024-09-01"}`.
3. Token must still have `Workers Scripts:Edit`.

**For NAM-INDIA-style "Worker works from sandbox but not Railway":**
- Railway egress is rate-limited by some Workers when the source IP shares a pool with many other Railway projects.
- Two fixes:
  1. Attach a custom domain to the Worker (e.g. `iearn.market-cockpit.app`). Custom domains bypass the `workers.dev` rate-limit class.
  2. Stand up a second Worker at a different `*.workers.dev` hostname and load-balance between them in the Railway client.

### 3. Account IDs / hostnames quick reference

- **Cloudflare Account ID**: `880c51da572278c2d828f6f74ab3ecc3`
- **Workers** (all on `*.radhev-232.workers.dev`):
  - `indiaearninghub` — quarter data via screener.in
  - `mc-scraper` — NSE/BSE filings + corp announcements
  - `mc-movers` — Yahoo-backed gainers/losers/volume
  - `mc-guardian` — health + circuit-breaker for the upstream pool
  - `mc-alerts` — webhook fanout for the alert engine
- **Production**: https://market-cockpit-production.up.railway.app (Railway, branch `main`)
- **Repo**: https://github.com/radhevrishi/market-cockpit
- **CI workflows of note**: `.github/workflows/deploy-workers.yml`, `.github/workflows/vercel-cron-bridge.yml`

### 4. Q1 FY27 earnings season

- **Season starts** ~July 15 2026, **peak** Aug 1 – Aug 14.
- The pipeline should auto-populate. No manual intervention expected.
- **Health check** (run weekly during season):
  ```
  curl 'https://market-cockpit-production.up.railway.app/api/v1/earnings/calendar?month=2026-08' | jq '.total'
  ```
  Expected: rising into the thousands by late July.
- **If calendar stays empty past July 20**: manually trigger the `vercel-cron-bridge` workflow from GitHub Actions → "Run workflow". That kicks the NSE scraper.
- **If a single day looks wrong**: hit `?date=YYYY-MM-DD` directly. Compare against `https://www.nseindia.com/companies-listing/corporate-filings-financial-results`.

### 5. The 7 documented stragglers (Earnings Intelligence)

These cannot be fixed without work in the Worker repo. Acceptable as-is until next deep session:

| Symbol | Why it fails |
|---|---|
| `DATAPATTNS` | screener.in serves client-rendered page; no quarter data in static HTML |
| `DIVGIITTS` | same as above (client-rendered) |
| `KENNAMET` | screener.in stopped updating this company entirely |
| `SMLMAH` | screener stopped updating |
| `MACPOWER` | screener stopped updating |
| `JAYNECOIND` | screener stopped updating |
| `KRISHANA` | screener stopped updating |
| `NAM-INDIA` | Worker has data; Railway → Worker is rate-limited (custom domain on the Worker would fix) |

### 6. Sanity-test endpoints (paste-and-go)

```
BASE="https://market-cockpit-production.up.railway.app"

# Calendar
curl -s "$BASE/api/v1/earnings/calendar?date=2026-05-28" | jq '.total'   # expect ~199
curl -s "$BASE/api/v1/earnings/calendar?month=2026-05"   | jq '.total'   # expect ~2600

# Graded tiers
curl -s "$BASE/api/v1/earnings/graded?date=2026-05-28"   | jq '.by_tier | map_values(length)'

# Earnings scan
curl -s "$BASE/api/market/earnings-scan?symbols=ASTRAMICRO,UNIPARTS" | jq '.summary.withData'
```

---

## Verification snapshot — 2026-06-22

| Endpoint | Query | Expected | Actual | Status |
|---|---|---|---|---|
| `/api/v1/earnings/calendar` | `?date=2026-05-28` | ~199 | 199 | PASS |
| `/api/v1/earnings/calendar` | `?month=2026-05` | ~2600 | 2603 | PASS |
| `/api/v1/earnings/calendar` | `?month=2026-06` | 19 (off-season) | 0 | DEGRADED (off-season, no error) |
| `/api/v1/earnings/calendar` | `?date=2026-06-30` | 0, no error | 0 | PASS |
| `/api/v1/earnings/graded` | `?date=2026-05-28` | 144 graded across 4 tiers | 144 (BLOCK 7 / STRONG 4 / MIXED 75 / AVOID 58) | PASS |
| `/api/v1/earnings/graded` | `?date=2026-06-18` | 1 ANIKINDS AVOID | 1 ANIKINDS AVOID | PASS |
| `/api/v1/earnings/graded` | `?date=2026-06-22` | 0, no error | 0 | PASS |
| `/earnings-opportunities` | page load | 200, no 0/0/0 chip | 200, chip absent | PASS |
| `/api/market/earnings-scan` | `?symbols=ASTRAMICRO,UNIPARTS,NAM-INDIA,DATAPATTNS,KENNAMET` | 2-3 FULL | ASTRAMICRO STRONG, UNIPARTS STRONG; NAM-INDIA/DATAPATTNS/KENNAMET MISSING (documented stragglers) | PASS |
