# Market Cockpit — Cloudflare Workers

Two Workers that use the paid Workers plan to make the system self-monitoring
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

## Notes
- Telegram: reuse the bot/chat already used by the portal's alert settings.
- Both Workers stay comfortably inside the paid plan's included usage
  (KV: 1M writes/month; requests: 10M/month).
- mc-scraper hygiene (separate codebase): its 0 * * * * hourly cron overlaps the
  */5 3-10 cron at the top of those hours, double-scraping — worth removing one.
