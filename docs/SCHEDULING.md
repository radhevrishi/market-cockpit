# Scheduling (zzz907)

Market Cockpit runs all day on Railway. Since zzz907 the app runs its own scheduled jobs. GitHub Actions now runs only the jobs that have to run on GitHub.

Why we moved them:
- GitHub's scheduler skips and delays runs. In the week of 29 Sep to 5 Oct only 626 runs started, far fewer than were scheduled. On 5 Oct an outage cancelled about 10 jobs.
- The repo is private, so every run costs paid Actions minutes.
- Most scheduled workflows did one thing: call this app over HTTP. The app can make those calls to itself.

## What runs inside the app

The code is in `frontend/src/lib/app-scheduler.ts` (`APP_JOBS`). `instrumentation.ts` starts the scheduler.

| Job (heartbeat name) | UTC schedule | Calls | Workflow kept for hand runs |
|---|---|---|---|
| refresh-earnings-calendar | `7 1 * * *` | POST /api/v1/cron/refresh-earnings-calendar | vercel-cron-bridge.yml |
| intelligence-compute | `7 4 * * 1-5` | POST /api/market/intelligence/compute | vercel-cron-bridge.yml |
| earnings-guidance-ingest | `15 4 * * 1-5` | POST /api/market/earnings-guidance/ingest | vercel-cron-bridge.yml |
| movers-alert / watchlist-alert | `35 4` / `50 4 * * 1-5` | GET /api/bot/…?mode=full | vercel-cron-bridge.yml |
| eo-blockbuster-morning / -evening | `30 5` / `30 15 * * *` | GET /api/bot/eo-blockbuster-alert | vercel-cron-bridge.yml |
| prewarm-earnings | 03:07, 06:07, 11:07, 14:07 daily | POST /api/v1/cron/prewarm-earnings | vercel-cron-bridge.yml |
| prewarm-us-earnings | 01:20 and 01:40 Tue–Sat, 05:20 daily | POST /api/v1/cron/prewarm-us-earnings?sessions=30 | vercel-cron-bridge.yml |
| refresh-us-bench | `45 5 * * *` | POST /api/v1/cron/refresh-us-bench | vercel-cron-bridge.yml |
| refresh-guidance | `10 13 * * 1-5` | POST /api/v1/cron/refresh-guidance | vercel-cron-bridge.yml |
| archive-to-postgres | `30 19 * * *` | POST /api/v1/cron/archive-to-postgres?months=2&ahead=1 | vercel-cron-bridge.yml |
| hub-ingest / hub-ingest-next | `7 18` / `15 18 * * *` | POST /api/market/earnings?ingest=1&force=1&month=… (the slot's month / the next month) | vercel-cron-bridge.yml |
| refresh-bench | `4 3 * * *` | GET /api/v1/cron/refresh-bench | book-watch.yml |
| book-watch | 05:30 and 12:04 Mon–Fri, 15:04 Mon–Sat | GET refresh-bench, then GET /api/v1/cron/book-watch | book-watch.yml |
| eo-bb-evening | `30 13 * * *` | GET /api/bot/eo-blockbuster-alert | book-watch.yml |
| user-alerts | :45 past 04–09 Mon–Fri, 15:45 and 19:45 Mon–Fri | GET /api/v1/cron/user-alerts | book-watch.yml |
| refresh-movers | 10 times on weekdays, 03:30 to 15:30 | GET /api/market/quotes?market=india and us, with &refresh=1 | refresh-movers.yml |
| refresh-news-feed | `9 * * * *` | POST /api/v1/news/refresh, GET /api/v1/news?market=all, GET /api/v1/news/in-play | refresh-news-feed.yml |
| refresh-special-situations | every 15 min 03–12 Mon–Fri, then :11 past every other hour | GET /api/v1/special-situations/feed?refresh=1 | refresh-special-situations.yml |
| refresh-guidance-upgrades | `10 * * * *` | GET guidance-upgrades (30D, 120D), guidance-universe, then POST /api/v1/intel-archive | refresh-guidance-upgrades.yml |
| refresh-super-investors | `17 */6 * * *` | POST /api/v1/cron/refresh-super-investors | refresh-super-investors.yml |
| daily-summary | `30 16 * * 1-5` | POST /api/v1/cron/daily-summary | daily-summary.yml |
| data-watch | 05:30 daily, 10:30 and 14:30 Mon–Fri | GET /api/v1/cron/data-watch | data-watch.yml |
| ai-verify | `35 * * * *` | POST /api/v1/ai-verify, up to 4 rounds (100 claims, $1.50 per run) | ai-verify.yml |
| ai-guidance-extract | `50 * * * *` | POST /api/v1/guidance-extract, rounds for up to 20 minutes ($1.20 per run) | ai-guidance-extract.yml |
| results-pdf | `20 * * * *` | POST /api/v1/results-pdf?max_items=12&max_usd=0.30 | results-pdf.yml |
| score-ai-ledger | `20 2 * * *` | GET /api/v1/ai/desk (us, india), then GET /api/v1/ai/ledger?score=1, up to 6 passes | score-ai-ledger.yml |
| ai-eval | `41 3 * * 1` | GET /api/v1/ai-eval?run=1. The heartbeat is marked failed when precision is below 0.90 or recall is below 0.80. | ai-eval.yml |
| daily-research-gainers-us | `30 21 * * 1-5` | US gainers: board, then research rounds | daily-research.yml |
| daily-research-portfolio | `13 14 * * *` | reads the Indian holdings that reported in the last 4 days | daily-research.yml |
| in-earnings-alert (zzz911) | `27 4-16 * * 1-6` | GET /api/v1/cron/india-earnings-alert — new India Blockbuster/Strong results passing the Quality Preset (small and mid caps), each sent once, by Telegram and/or email | book-watch.yml (manual input `india-earnings-alert`) |
| in-earnings-eod (zzz911) | `37 15 * * 1-5` | GET /api/v1/cron/india-earnings-eod — the evening check-in, always one message per weekday | book-watch.yml (manual input `india-earnings-eod`) |
| us-earnings-watch (zzz912, was two Claude tasks) | :07 every 2 h 11–23 UTC Mon–Fri, :07 at 00–02 UTC Tue–Sat | GET /api/v1/cron/us-earnings-watch: graded-us (3 days up to the newest EDGAR filing date) → US Quality Preset + under $30B → one ranked Telegram/email alert of names not sent before | us-earnings-watch.yml |
| gainers-in-backup | `41 11 * * 1-5` | India gainers sweep, only when GitHub's gainers-in run (10:50) is missing or stalled; no re-process, inside the route's 70-read daily ceiling | daily-research.yml |
| gainers-brief-in | 11:57, 12:37, 13:31 Mon–Fri | POST /api/v1/cron/gainers-brief: Daily Gainers Brief from the stored research (no model call), Telegram + email via owner-notify, once per session. Earlier slots send only a complete sweep; 13:31 always sends (PARTIAL when incomplete) | gainers-brief.yml |

You can see the live schedule (last success, next run, and the state of the current slot) at `GET /api/v1/cron/schedule`. It is public and contains no secrets.

### How the scheduler works

- **Timer.** It checks every minute, starting 90 seconds after the server starts. A job runs at its slot. It may start until the next slot, and never later than 3 hours after its slot.
- **Once per slot.** Each slot has a Redis lock, `appsched:v1:<job>:<slot>`, taken with SET NX. If a second copy of the server is running during a deploy, it cannot run the same slot twice. If Redis is down, the job is skipped. It never runs twice.
- **Restarts.** The lock lasts as long as the job's time limit plus 2 minutes. This is always shorter than the slot's window. If the server dies in the middle of a job, the lock expires and the job runs again within the window. When a job finishes, the lock is marked "done" for the rest of the window. Before running, the scheduler also checks the job's heartbeat. So a restart never repeats a slot that already succeeded. A hand run from GitHub after the slot also counts as done.
- **Retry.** If a call gets a 5xx or a network error, it is retried once after 45 seconds. Calls that spend AI money are not retried, because a failed answer may already have cost money. The next slot carries on.
- **Load.** At most 2 jobs run at once, and each job runs one at a time. Jobs never run on a request path: the scheduler uses timers and `fetch` to `127.0.0.1` with each job's own time limit.
- **Heartbeat.** After each run the scheduler posts to `/api/v1/cron/heartbeat`, using the same name the workflow used. For these jobs the health view works out when a job is stale from its schedule: the longest normal gap between slots, plus 6 hours. It is never stricter than the global 25-hour (or weekend 72-hour) limit. So a weekly job is not flagged as stale after 25 hours.
- **Switches.** The scheduler needs `CRON_SECRET` and Redis. Set `APP_SCHEDULER=0` (or the old `BACKSTOP_SCHEDULER=0`) to turn it off.

## What stays on GitHub, and why

| Workflow | Why it stays |
|---|---|
| daily-research.yml (gainers-in only, `50 10 * * 1-5`) | It downloads screener.in pages from GitHub's network into KV. screener.in does not answer the app's host. |
| scrape-*.yml (13 workflows) | They fetch from NSE, BSE, Screener, Yahoo, Trendlyne and news sites using GitHub's IPs. Those sources block Railway. |
| edgar-guidance-backfill.yml | A repo script reads SEC EDGAR at the fair-access rate and writes to KV directly. |
| screener-sync.yml, tradingview-sync.yml | They log in, download CSVs and commit them to git. |
| backup-user-data.yml | The backup has to be stored outside the app, as an encrypted GitHub artifact kept for 90 days. |
| ci.yml, deploy-workers.yml | They run on push, not on a schedule. |
| ai-guidance-backlog.yml, refresh-movers-live.yml | Manual only. |

## Run a job by hand

- **From GitHub:** Actions → pick the workflow → **Run workflow**. Every moved workflow still has `workflow_dispatch`, and it uses the same route, secret header and heartbeat. If the app's scheduler ever stops, these buttons are the emergency fallback.
- **With curl:**
  ```
  curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<app>/api/v1/cron/prewarm-earnings
  ```
  Use the method and path from the table above. Always send the secret in the `x-cron-secret` header, never in the URL.

## Add a job

1. Make sure the job only calls this app. If it has to fetch a source that blocks Railway, keep it on GitHub.
2. Add an entry to `APP_JOBS` in `frontend/src/lib/app-scheduler.ts`:
   - `name` (the heartbeat name)
   - `crons` (UTC, 5 fields)
   - `timeoutMs`
   - `workflow` (the hand-run fallback; create one with only `workflow_dispatch` if needed)
   - `does`
   - `run`: use `http(method, path, timeoutMs)` for a single call, or write a small function for a loop, and keep its round logic pure and tested.
3. Add a row to the table above. The test `src/lib/__tests__/zzz907-app-scheduler.test.ts` checks that every cron is valid, that names are unique, that every lock is shorter than every window, and that the moved workflows have no `schedule:` left.
