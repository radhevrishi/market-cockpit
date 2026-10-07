# Background jobs on GitHub — reliability notes

Last reviewed: 6 Oct 2026 (patch zzz908). Scope: the jobs that must keep running on GitHub because they
fetch data from GitHub's network (NSE / BSE / screener.in / Trendlyne / SEC / Yahoo / TradingView refuse or
throttle the app's own server). The plain HTTP "poke the app" jobs are being moved into the app's own scheduler
(see `docs/SCHEDULING.md`, written separately).

## What failed in the last 21 days (15 Sep – 6 Oct 2026) and why

24 workflows checked, about 730 runs, 19 runs not green.

| Workflow | Runs failed | Root cause | Fix |
|---|---|---|---|
| scrape-india-technicals, scrape-mover-reasons, edgar-guidance-backfill (×2), screener-sync, daily-research | 6 (5 Oct, 19:30–21:20 UTC) | **GitHub had no machine.** "The job was not acquired by Runner of type hosted even after multiple attempts." GitHub-side capacity outage; the jobs never started. | Nothing to fix in code. The watchdog now files these under "nothing to do" instead of a red alarm. Later scheduled runs worked. |
| scrape-mover-reasons | 2 (23 Sep, 2 Oct) | **Killed at its 8-minute limit.** 80 movers handled one after another; when the news sites hung, each ticker waited up to 10 s → 80 × ~10 s > 8 min. | 4 tickers in parallel + a 6-minute time budget; tickers not reached keep their previous 24 h entry and are done next run. Limit raised to 10 min as headroom. |
| screener-sync | 1 (28 Sep) | **Push stuck in a half-done rebase.** Another commit changed the same generated file (`frontend/public/data/screener/manifest.json`); `git pull --rebase` stopped on a conflict and all 5 retries then failed ("You are not currently on a branch"). | New `.github/scripts/push-data.sh` (used by screener-sync and tradingview-sync): on a rejected push it aborts any rebase, resets to the latest `main`, puts this run's copy of *only its own data folder* back and commits again. Tested locally against a conflicting remote. |
| edgar-guidance-backfill | 3 (2–3 Oct) | **Missing SEC contact.** SEC refuses requests without a contact User-Agent; no `SEC_USER_AGENT` secret was set. | Already fixed on 5 Oct (zzz880: the workflow falls back to the same contact line the server uses). Green since. |
| scrape-nse-results | 2 (5 Oct 15:15, 15:20, manual runs) | **App route not deployed yet.** The collector was run by hand a few minutes after it was committed; the app's `/api/v1/nse-results/ingest` answered 404 until the deploy finished. Green from 15:29 on. | One-off. The collector now separates the cases: app down / redeploying (5xx, no answer) → deferred; 401 / 404 / 400 / 413 → stays red (wrong secret, missing route, bad payload). |
| scrape-india-technicals | 1 (15 Sep) | **Upstash 10 MB request limit** (`ERR max request size exceeded`). | Already fixed earlier (history is now chunked under the limit). Green since. |
| ai-eval | 1 (6 Oct 07:43, manual) | **Real quality-bar failure** ("guidance extractor below the bar"). Fixed by the prompt change that went green at 08:00. | Working as intended — this one *should* be red. |
| scrape-guidance-docs | 1 (5 Oct) | Cancelled by hand. | — |
| ci | 2 (6 Oct) | Cancelled because a newer push replaced the run (`cancel-in-progress`). | Harmless; the watchdog files these as "replaced by a newer run". |

Annotations that appear on every run and are **not** failures: "The ubuntu-latest label will migrate to Ubuntu 26
…", "Node.js 20 is deprecated …" (older runs that still used `actions/*@v4`; everything now uses `@v5`).
CI also shows "npm audit found high/critical advisories" as a warning — worth a separate look, it does not fail CI.

## What changed (zzz908)

1. **Retries on transient network errors in every collector.** `.github/scripts/lib/resilient-fetch.mjs`
   wraps `fetch` (installed at each collector's entry point): retries network errors (connection reset,
   DNS, socket closed) and HTTP 429 / 500 / 502 / 503 / 504 / 520–524 with exponential backoff and jitter,
   honouring `Retry-After` (capped at 30 s). It never retries other 4xx (auth, not found, too large) and never
   retries a timeout the script itself chose. Tunable with `MC_FETCH_RETRIES`, `MC_FETCH_BACKOFF_MS`.
   EDGAR keeps its own SEC-paced retries (fair-access rules), so it only uses the exit classification.

2. **"Deferred" instead of red for upstream outages.** A collector that could not update only because a source
   was down or had not published yet exits with code **75**. The workflow turns that into a green run with a
   warning, runs a visible step named *"Upstream deferred (data not updated this run)"*, and posts the heartbeat
   with `ok: true` and a note `deferred: …`. Stored data is never overwritten with a partial result.
   Real problems still exit 1 and stay red: code exceptions, wrong / missing secrets, 401 / 403 / 404 / 413,
   malformed data, an ingest that refused the payload.
   Deferred cases: NSE refusing every day (nse-results, guidance-docs), NSE archive not published
   (rolling-stats, index-history, indices), news RSS too thin (india-news), NSE holiday list unreachable,
   the app down / redeploying (nse-results ingest, results-pdf, daily-summary), and any final error whose message is a network error / timeout / 429 / 5xx.

3. **Runner image pinned to `ubuntu-24.04`** in every workflow listed below, so GitHub's move of `ubuntu-latest`
   to Ubuntu 26 on **19 Oct 2026** cannot change the machine under the jobs silently. Move to a newer image on
   purpose, one workflow first, when 24.04 nears its end of support (GitHub usually announces ~6 months ahead).

   Pinned here: scrape-commodity-prices, scrape-corp-filings, scrape-guidance-docs, scrape-india-news,
   scrape-india-technicals, scrape-mover-reasons, scrape-nse-holidays, scrape-nse-index-history,
   scrape-nse-indices, scrape-nse-results, scrape-rolling-stats, scrape-screener-fundamentals,
   edgar-guidance-backfill, screener-sync, tradingview-sync, results-pdf,
   daily-research, daily-summary, score-ai-ledger, ai-eval, deploy-workers, ci,
   and the new actions-watchdog.

   **Still on `ubuntu-latest` (owned by the scheduling work, pin them too):** vercel-cron-bridge, book-watch,
   refresh-movers, refresh-news-feed, refresh-special-situations, refresh-guidance-upgrades, data-watch,
   ai-verify, ai-guidance-extract, backup-user-data — and two not covered by either list:
   **ai-guidance-backlog** and **refresh-movers-live**.

4. **Time limits and overlap guards.** Every workflow here has `timeout-minutes`; deploy-workers got one (15 min),
   a `concurrency` group (no out-of-order deploys) and one automatic retry of the Cloudflare deploy.
   results-pdf: fixed a status-capture bug (`|| echo 000` produced "000000" on a network failure).

5. **Daily watchdog** — `.github/workflows/actions-watchdog.yml` (03:23 UTC / 08:53 IST, also runnable by hand
   with a dry-run switch). It reads every run of the last 24 h through the GitHub API, sorts failures into
   *GitHub had no machine* / *data source down* / *replaced by a newer run* / *cancelled by hand* (nothing to do)
   and *needs a look*, and sends **one Telegram message only if something needs a look**: a real failure whose
   latest run is still failing, a real failure that happened 3+ times, or a collector that was deferred on every
   run of the day (a source that stays down, or a site that changed its format). It also writes the summary to
   the run page and posts the heartbeat `actions-watchdog`. Logic: `.github/scripts/actions-watchdog.mjs`;
   tests: `frontend/src/lib/__tests__/zzz908-actions-reliability.test.ts` (fixtures are the real annotations
   from the table above). Dry run against the real last 30 h: 185 runs, 164 fine, 14 GitHub-capacity,
   3 cancelled harmlessly, 3 real failures that had all recovered → no message would have been sent.

## Things only the owner can do

1. **Render: suspend or delete the service `market-cockpit-api`.** It still builds from the deleted `backend/`
   folder and e-mails a failed build on every push. The live site runs on Railway and does not use it.
   (render.com → the service → Settings → Suspend, or Delete Service.)
2. **Telegram for the watchdog.** Either add repository secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
   (GitHub → repo → Settings → Secrets and variables → Actions), or rely on the fallback: the watchdog asks the
   app (`/api/v1/alerts/dispatch` with `CRON_SECRET`) to send it with the app's own Telegram settings. Run the
   watchdog once by hand with `dry_run = 0` and `hours = 72` to confirm a message arrives (it only sends when
   something needs a look).
3. **Turn off GitHub's per-run failure e-mails** once the digest has proven itself for a week:
   github.com/settings/notifications → the *Actions* section → stop e-mail notifications for workflow runs.
   The daily digest replaces them.
4. **Check the Actions minutes quota** for this private repository: github.com/settings/billing (Usage →
   Actions). Private repos have a monthly free allowance; if it runs out, every scheduled job stops at once.
   The biggest users are the multi-hour jobs (scrape-guidance-docs manual runs, edgar-guidance-backfill
   full backfills, ai-guidance-backlog).
5. **Railway → service → Settings → "Wait for CI"** (from the zzz883 audit) so a red CI blocks a deploy.
6. **Session cookies expire.** `SCREENER_SESSIONID` and `TRADINGVIEW_SESSIONID` are personal login cookies;
   when they expire, screener-sync / tradingview-sync fail red (that is intended — it is a real problem).
   Refresh the secret from a logged-in browser when the watchdog reports it.

## How to read a run now

- Red ✗ = a real problem in our code, secrets or data. The watchdog will mention it.
- Green ✓ with a step "Upstream deferred (data not updated this run)" = a source was down; nothing to do
  unless the watchdog reports the job as **stuck** (deferred on every run for a day).
- Grey "cancelled" with "not acquired by Runner" = GitHub had no machine; nothing to do.
