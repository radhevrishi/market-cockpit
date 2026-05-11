# Market Cockpit — Earnings Data Worker

**This worker lives OUTSIDE Vercel.** Its job: maintain a persistent browser session against Indian
exchange / aggregator endpoints (NSE, BSE, Trendlyne, Tickertape) and push canonical earnings
events into Upstash KV. Vercel reads from KV — Vercel does NO scraping.

## 4-tier durable architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIER 1 — DATA ACQUISITION  (this worker — Hetzner/Railway/Render)  │
│    Playwright browser pool, persistent cookie jar, residential IP    │
│    ↓                                                                 │
│  TIER 2 — MULTI-SOURCE AGGREGATION  (sources.* modules)              │
│    NSE corporate-financial-results (primary)                         │
│    BSE corp announcements (primary)                                  │
│    Trendlyne calendar-v2 (secondary)                                 │
│    Tickertape upcoming-results (secondary)                           │
│    RSS news feeds (fallback)                                         │
│    ↓                                                                 │
│  TIER 3 — RECONCILIATION  (aggregator.ts)                            │
│    canonical security_id resolution, dedup, conflict-resolve         │
│    ↓                                                                 │
│  TIER 4 — TRANSPORT  (POST to Vercel /api/v1/earnings/calendar/ingest)│
│    X-Ingest-Secret auth, normalised payload                          │
│    ↓                                                                 │
│  Vercel  — READ-ONLY consumer                                        │
│    /api/v1/earnings/calendar (GET) reads from KV                     │
│    /api/v1/earnings/opportunities (GET) — AI scoring layer           │
└─────────────────────────────────────────────────────────────────────┘
```

**Where AI fits:** Tier 4 / Vercel side — anomaly detection, filing classifier, earnings
scorer, narrative generator. AI is **never** the transport layer.

## Why not Vercel functions?

NSE blocks Vercel IPs ~85% of the time (Akamai bot protection). Vercel serverless has:
- known IP ranges
- no cookie persistence between invocations
- no browser fingerprint
- 10s execution limit

A persistent worker on a $5/month VPS sidesteps all four.

## Why not GitHub Actions?

GH runner IPs rotate (good for evading blocks) but:
- no session persistence between runs (cold-start cookies every time)
- max 2000 free min/month (~50% used at 30-min cron)
- can't easily run multi-stage Playwright with browser pool

Acceptable as **fallback**, not primary.

## Deploy targets (pick one)

| Host       | Cost          | Persistent? | Setup difficulty | Recommended |
|------------|---------------|-------------|------------------|-------------|
| Hetzner CX11| ~₹400/mo (~$5)| Yes        | Medium (SSH)     | ✅ Best     |
| Railway     | $5/mo free→$5 | Yes        | Easy (CLI)       | ✅ Easiest  |
| Render BG   | Free→$7/mo    | Yes        | Easy (Git push)  | ✅ Easiest  |
| Fly.io      | Free→$2/mo    | Yes        | Medium           | ✅          |
| AWS EC2 t4g | $4/mo Reserve | Yes        | Hard             | ⚠ Overkill  |
| GitHub Actions | Free       | No (rotates)| Easy            | Fallback only|

## Local test

```bash
cd worker
npm install
cp .env.example .env       # add UPSTASH_REDIS_REST_URL + TOKEN + INGEST_SECRET + INGEST_URL
npx playwright install chromium
npm run scrape:once        # one-pass scrape & push
npm run scrape:loop        # daemon mode, 30-min cron internally
```

## Production deploy — Railway (easiest)

```bash
railway login
railway init               # in worker/ directory
railway up                 # pushes Dockerfile, deploys persistent worker
railway variables set UPSTASH_REDIS_REST_URL=...
railway variables set UPSTASH_REDIS_REST_TOKEN=...
railway variables set INGEST_SECRET=...
railway variables set INGEST_URL=https://market-cockpit.vercel.app/api/v1/earnings/calendar/ingest
```

Railway auto-restarts on crash, persists disk between runs, gives one durable IP per service.

## Production deploy — Hetzner (cheapest, most control)

```bash
# On any Hetzner CX11 (~$5/mo, Ubuntu 22.04)
git clone https://github.com/radhevrishi/market-cockpit
cd market-cockpit/worker
docker build -t mc-earnings-worker .
docker run -d --restart=always --name mc-earnings \
  --env-file .env \
  mc-earnings-worker
```

That's it. The worker runs `scrape:loop` indefinitely with a 30-min internal interval.

## Operational guarantees

- **Persistence**: cookie jar serialised to `/var/lib/mc-worker/cookies.json` between runs
- **Multi-source fallback**: if NSE blocks, falls through Trendlyne → Tickertape → RSS
- **Reconciliation**: every event canonicalised by (BSE_code, NSE_symbol, ISIN) before push
- **Idempotent**: dedup by `(symbol, filing_date, period_ended)` — safe to re-run
- **Observability**: logs to stdout + optional Sentry/Axiom webhook
- **Health check**: writes `last_run_ok=<ts>` to KV; Vercel can alert if stale > 2h

## What runs where (summary)

| Component                             | Lives on              | Why                                    |
|---------------------------------------|----------------------|----------------------------------------|
| Scraper (Playwright, cookies, IP)     | Worker (Hetzner)     | Anti-bot evasion needs persistence     |
| Source adapters (NSE, BSE, Trendlyne) | Worker               | Co-located with scraper for speed      |
| Reconciliation engine                 | Worker               | Pre-push normalisation                 |
| KV (Upstash)                          | Upstash cloud        | Stateless handoff                       |
| Read APIs (calendar, opportunities)   | Vercel               | Read-only, edge-cached                 |
| AI scoring / narratives               | Vercel               | Stateless, fast cold-start             |
| UI                                    | Vercel               | Static + RSC                            |

The data path is uni-directional: **Worker → KV → Vercel → UI**.
Vercel cannot scrape and cannot write back. This is the moat.
