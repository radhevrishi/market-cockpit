# Market Cockpit — Cloudflare Workers

Three Workers that use the paid Workers plan to make the system self-monitoring
and always-on. Deploy each from its folder with Wrangler (same flow as mc-scraper).

## 1. mc-guardian — uptime & freshness monitor
Probes the portal (home, news, quotes, in-play) and mc-scraper every 10 minutes.
Telegrams you when something breaks, and again when it recovers. No spam:
one message per failure episode.

Deploy:
```
cd workers/mc-guardian
npx wrangler kv namespace create guardian-kv     # copy the id into wrangler.toml
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler deploy
```
Test: open https://mc-guardian.radhev-232.workers.dev/run — you should see all
probes ok:true. Status anytime at the root URL.

## 2. mc-alerts — always-on buy-zone alerts
The Buy Strategy page's alert system only works while the browser tab is open.
This Worker runs every 5 minutes during IST market hours, checks the Nifty
Midcap 50 level (portal indices API first, Yahoo fallback), and Telegrams you
the moment price enters one of your staggered buy zones. Each zone re-arms
after a 2% recovery above the entry.

Deploy:
```
cd workers/mc-alerts
npx wrangler kv namespace create alerts-kv       # copy the id into wrangler.toml
npx wrangler secret put ALERT_SECRET             # any long random string
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler deploy
```

Load your zones (entries from /buy-strategy — update whenever you change the plan):
```
curl -X POST https://mc-alerts.radhev-232.workers.dev/zones \
  -H "Authorization: Bearer YOUR_ALERT_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "name": "Nifty Midcap 50",
    "symbol": "^NSEMDCP50",
    "match": "midcap",
    "zones": [
      { "entry": 14100, "label": "Zone 1 · 14000-14200" },
      { "entry": 13400, "label": "Zone 2 · 13200-13500" },
      { "entry": 12490, "label": "Zone 3 · 12300-12600" },
      { "entry": 11800, "label": "Zone 4" },
      { "entry": 10800, "label": "Zone 5" },
      { "entry": 10100, "label": "Zone 6" },
      { "entry": 9100,  "label": "Zone 7" }
    ]
  }'
```
Manual test run anytime: https://mc-alerts.radhev-232.workers.dev/check

## 3. mc-movers — live intraday movers (replaces the GH Actions cron)
The "Refresh Movers (live intraday)" workflow (.github/workflows/refresh-movers-live.yml)
suffers GitHub cron starvation — on a bad day only ~2 of ~75 scheduled runs fire,
so nse-movers-live:v1:latest goes stale mid-session. This Worker is a faithful
port of .github/scripts/scrape-movers-live.mjs: same Upstash keys (reads
nse-ticker-universe:v1:latest, writes nse-movers-live:v1:latest with TTL 1h),
same Yahoo cookie+crumb auth with query2 fallback, same 50-symbol batching with
150ms gaps and one retry, same guards (refuses to write if <50 quotes or <70%
batch coverage). Cron: */5 3-10 UTC Mon-Fri, gated in-code to Mon-Fri
09:15-15:35 IST. A small run summary lives at nse-movers-live:lastrun:v1.

Deploy:
```
cd workers/mc-movers
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
npx wrangler secret put RUN_SECRET   # any long random string — gates GET /run
npx wrangler deploy
```
No KV namespace and no Telegram secrets needed — it talks to Upstash via REST
exactly like the GH script, so the Railway app keeps working unchanged.

Check it is writing: open https://mc-movers.radhev-232.workers.dev/ — lastRun
should show ok:true with a recent generatedAt during market hours. Manual
trigger: GET /run with "Authorization: Bearer RUN_SECRET".

Once the Worker is live and writing, disable the GH workflow by editing
.github/workflows/refresh-movers-live.yml: remove the schedule: block and keep
workflow_dispatch as a manual backup. Until then it is fine to leave both
running — they write the same key in the same shape, so overlap is harmless.

## Notes
- Telegram: reuse the bot/chat already used by the portal's alert settings.
- Both Workers stay comfortably inside the paid plan's included usage
  (KV: 1M writes/month; requests: 10M/month).
- mc-scraper hygiene (separate codebase): its 0 * * * * hourly cron overlaps the
  */5 3-10 cron at the top of those hours, double-scraping — worth removing one.
