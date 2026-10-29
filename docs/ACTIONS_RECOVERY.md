# Actions and portal recovery — 29 October 2026

Standard Ubuntu runner compute for this public repository is free. GitHub Pro remains a separate subscription; it does not
remove historical charges, account payment restrictions, storage charges or Railway/AI-provider charges. No account budget
or subscription was changed by this repair.

## Application outage

Railway deployment `5d60e00c-f5e7-48ff-ab3d-bbc4fdb2a7dd` crashed with a V8 heap-out-of-memory error at the former
1536 MB runtime heap limit. The existing build was recovered as deployment `05b8c08e-cdba-404c-96d9-6e851690a209` with
`node --max-old-space-size=3072 server.js`, within the existing 8 GB container allocation. The Docker runtime default now
matches this setting. This is recovery from the observed limit, not evidence that every source of memory growth is fixed
or that the memory bill will fall. Continue measuring RSS, heap and heavy-job samples.

The guidance facts browser request now has a 45-second deadline including body parsing, cancels superseded requests and
provides Retry figures per company. The server returns completed figures plus explicit pending company keys after its
40-second deadline; slow company reads can finish into the cache, and overlapping India reads share one request. A failed source lookup says it could not be read, rather than asserting that the
company has no figures. Negative India facts cache entries expire after five minutes; older un-stamped negative entries
are re-read. Valid cached figures and all financial calculation rules are unchanged.

## Collector repairs

- NSE results: unread weekdays are partial/deferred even when weekends or other days were read successfully. Existing
  results remain stored; deferred heartbeat does not claim a complete refresh.
- US guidance: any failed upload, partial day or missing coverage acknowledgement prevents an unconditional green run.
- India and US guidance: public company-document batches are compressed into a Redis delivery journal before sending.
  A subsequent run retries up to 20 pending batches before scanning again. A still-blocked delivery backlog pauses new
  collection instead of repeatedly downloading the same documents. Never put this journal in public Actions artifacts.
- Complete ingestion requires `ok: true`, the unique accepted document count and no rejected documents. A valid partial
  acceptance moves only rejected documents to the market review queue; accepted rows are acknowledged. A malformed answer
  remains pending. Permanent auth/configuration failures stop promptly instead of repeatedly re-downloading PDFs.
- Journal keys: `collector-delivery:v1:IN|US`, `:item:<hash>`; separate `IN:review|US:review` queues retain rejected public
  documents. Payloads expire after 30 days. An expired entry raises an error requiring source reconciliation. This does not
  retroactively recover uploads lost before the journal existed. Re-read affected source dates after authentication works.
- Corporate filings: keep last-good rows for an unavailable exchange for at most 24 hours, with their original source
  timestamp. Fresh NSE data cannot refresh BSE's age. A total source outage never replaces the stored blob. The capped
  list reserves room for each available exchange; its cap is not a promise of complete exchange/day coverage.
- Heartbeats: eight affected workflows retry delivery and verify acknowledgement separately. A failed heartbeat is visible
  in its own step; collection counts in the preceding step remain the authority for what was actually written.
- Watchdog: billing/permission blocks are actionable, not classified as lack of runner capacity.
- Public backups require the dedicated `BACKUP_PASSPHRASE` before export; there is no CRON_SECRET fallback. Plaintext is
  still removed on failure, and only encrypted artifacts may be uploaded. Historical artifacts were not deleted.
- CSV sync: authenticated HTML and response headers are no longer committed as debug files. A partial export writes its
  manifest and retains last-good files, then reports failure instead of unconditional success.
- Workflow names now match their actual cron frequency. Schedules and paid AI limits were not increased.

## Owner action: current authentication failure

A fresh FII/DII workflow retry returned HTTP 401 `service key required` while the application was online. Its script sends
GitHub's `CRON_SECRET` as `x-cron-secret`; the deployed app accepts its configured service keys. The connected tools cannot
read either secret value. Do not weaken the route's authentication to hide this error.

1. Open the Railway market-cockpit service, production, Variables. Copy the **existing CRON_SECRET value** privately.
2. Open GitHub repository Settings → Secrets and variables → Actions.
3. Edit the repository secret named **CRON_SECRET**. Paste exactly the Railway value, without quotes/spaces/newlines.
4. Save it. Updating a GitHub Actions secret does not require a Railway deployment when Railway's value stays unchanged.
5. Re-run the failed FII/DII job once. Expect ingest HTTP 200. If it still returns 401, verify CRON_BASE_URL points at this
   production service and check any same-name environment secret overriding the repository secret.
6. After that succeeds, re-run recent India and US guidance collection for their ordinary seven-day window, then NSE
   results and the backup restore drill. Reconcile the earlier 250 India / 666 US unacknowledged documents against stored
   document IDs; do not infer full recovery merely from a later green run. Do not run a new full historical AI backfill.

Never paste these credentials into chat, commit them, or print them into workflow logs. GitHub Pro does not fix a service-key
mismatch. Bot-token rotations and historical log/artifact cleanup remain separate owner decisions.

## Operational evidence

- India technicals retry: run 40745564108 succeeded; two missing sessions fetched, 2,888 symbol histories saved.
- Mover reasons retry: run 40717117504 succeeded; 80/80 processed, 79 public reasons. Its old heartbeat still timed out;
  the repaired heartbeat path must be verified on a run using this new commit.
- FII/DII retry: run 40770616448 still returned HTTP 401; unresolved until credential synchronization is verified.
- Existing earlier audit: Market-Cockpit-GitHub-Actions-Audit-2026-10-28.md (delivered separately).

Repository tests and workflow validation cannot certify live external-source availability. Confirm run commit SHA and
source-level coverage after rollout; historical red runs are retained as evidence, not erased.
