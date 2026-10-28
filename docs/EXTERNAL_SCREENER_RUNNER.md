# External screener runner: opt-in rollout

Default behavior is unchanged: Railway builds both screeners. The new scheduled workflow allocates no runner while the
repository is private, or while the repository variable `SCREENER_RUNNER_ENABLED` is not `true`.

The runner uses the same builders, financial calculations, histories and pattern engines. It writes the existing Postgres
cache/snapshot tables. It does not require AI provider keys, portfolio data or Telegram credentials. External database
traffic may add egress; a smaller web process is not a guarantee of a lower total bill.

## Before activation

1. Deploy the build-lease and publication changes to Railway first. Do not use an old application version that lacks the
   cross-process lease. Keep `SCREENER_RUNNER` unset during verification.
2. Complete the owner's secret rotations and history/log review before making the repository public. This document does
   not certify that exposed historical tokens have been revoked.
3. Provide a separate database writer credential, not the database owner's URL. It needs CONNECT to this database, USAGE
   on public, SELECT on `schema_migrations`, and SELECT/INSERT/UPDATE on `screener_store`, `screener_snapshot`, and
   `sec_frame_cache`. It must not have access to user-state, books, alerts, decisions or other personal tables. It must not
   have CREATE, DROP, role-management or migration privileges. Verify inherited/public/default grants as well.
4. Store its TLS-capable public connection string as the Actions secret `SCREENER_DATABASE_PUBLIC_URL`. The app's internal
   database URL remains unchanged. A public TCP proxy alone is not proof of valid TLS/credentials/least-privilege access.
5. Add `SEC_USER_AGENT` as an Actions secret with a legitimate SEC fair-access contact. Never put credentials in a URL,
   workflow file, dispatch input, artifact or log.

## Prove it works, then cut over

Run the workflow manually for US, then India. Compare snapshot coverage, source/scan dates, key financial values and D/W/M
results with the existing build. Same inputs must give the same results; different live input dates must be reconciled.
Confirm `meta.runner = github` and a fresh `meta.checkedAt` from a successful run. Check failures as well as success.

After the repository is public and these checks pass, set `SCREENER_RUNNER_ENABLED=true` in repository variables and
`SCREENER_RUNNER=github` on the Railway app. Deployment of the latter is necessary for the running process to see it.

The app keeps its schedules. It defers a local build only while a completed external snapshot check is less than one hour
old (India) or eight hours old (US). Missing, invalid, future or stale check metadata uses the Railway fallback. Both
processes use one PostgreSQL lease per market. Snapshot publication is performed over the lease-owning connection; a
lost lease cannot publish an obsolete result. Unchanged rows still refresh metadata without a full rows rewrite.

The external CLI validates existing migration IDs without running DDL. Deploy all application migrations before running
the external job. The workflow intentionally does not upload result payloads or application data as artifacts.

## Rollback

Unset `SCREENER_RUNNER` on Railway and deploy it, then set `SCREENER_RUNNER_ENABLED=false` on GitHub. Do not drop tables or
delete snapshots. Keep the existing app ready until external reliability and total resource costs have been measured.

## Remaining owner-only prerequisites

BotFather token revocation, synchronized job-secret rotation, backup-passphrase rotation and repository-publication are
separate account actions. Read-only/OAuth connectors may not expose credential values or GitHub secret administration.
Do not pretend these were completed merely because application tests passed.
