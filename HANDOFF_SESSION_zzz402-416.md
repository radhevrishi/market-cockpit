# SESSION HANDOFF — zzz402 → zzz416 (2026-08-21)

> Paste into a new chat: "Read HANDOFF_SESSION_zzz402-416.md at the repo root before doing anything, then continue from OPEN ITEMS."

---

## 1 · PROJECT / FOLDER MAP (critical)

- **User's repo folder (the connected folder):** `/Users/radhevrishi/Developer/Python/Imp Marketcockpit/market-cockpit/`
  ⚠ NOT the old Desktop path some CLAUDE.md sections mention — **Developer**, not Desktop.
- **Frontend app:** `frontend/` (Next.js 14 App Router, TypeScript)
- **User's git branch:** `deploy-zzz` (local `main` is ~1578 commits stale — NEVER use it)
- **Push command (canonical):**
  ```
  cd "/Users/radhevrishi/Developer/Python/Imp Marketcockpit/market-cockpit"
  git add -A && git commit -m "zzzNNN: msg" && git pull --rebase origin main && git push origin deploy-zzz:main
  ```
  On non-fast-forward reject: commit FIRST, then `git pull --rebase origin main`, then push.
- **Railway auto-deploy is UNRELIABLE** — after pushing, force a build with:
  ```
  git commit --allow-empty -m "trigger railway deploy" && git push origin deploy-zzz:main
  ```
  (Railway dashboard has no Redeploy in the ⋮ menu; empty-commit or `railway up` via CLI are the working triggers.)
- **Vercel is DEAD** (`market-cockpit.vercel.app` → DEPLOYMENT_DISABLED / 402). Production = **Railway**:
  `https://market-cockpit-production.up.railway.app`
- **tsc before every delivery**: `cd frontend && npx tsc --noEmit`. ~190 PRE-EXISTING errors exist in
  other files (fondWeight, lime, dma50, xxs…) — only YOUR touched files must be clean.
  `next.config` has `ignoreBuildErrors: true` so builds pass regardless.
- **`.github/` is a PROTECTED path for the remote bridge** — files there must be hand-copied by the user.

## 2 · INFRASTRUCTURE (set up this session — all working)

| Piece | Value / State |
|---|---|
| **mc-proxy** (NEW, deployed today) | `https://mc-proxy.radhev-232.workers.dev` — Cloudflare Worker proxying Screener/NSE/BSE (source: `cloudflare-worker/proxy.js`). Secret set via `wrangler secret put PROXY_SECRET`. |
| Railway env vars (NEW today) | `PROXY_URL=https://mc-proxy.radhev-232.workers.dev`, `PROXY_SECRET=<32-char, same as worker>` — this is what lets Railway reach Screener (Screener blocks datacenter IPs). |
| indiaearninghub worker | `https://indiaearninghub.radhev-232.workers.dev` — PRIMARY enrich source. Source NOT in repo (Cloudflare dashboard only). KNOWN FLAW: fetches `/consolidated/` only; standalone-only companies (DIVGIITTS, GRSE, HEIDELBERG, DATAPATTNS, HOMEFIRST, UJJIVANSFB) return all-null (`topRatiosFound:0`). The mc-proxy + direct-Screener path now covers them. `/debug?symbol=X` shows raw HTML it sees. |
| GH Actions cron bridge | `.github/workflows/vercel-cron-bridge.yml` — points at Railway (CRON_BASE_URL default). Daily: hub ingest 18:00 UTC, archive-to-postgres 19:30 UTC, prewarm 4×/day. Manual trigger: Actions → "Vercel Cron Bridge" → Run workflow → pick endpoint. |
| CRON_SECRET | Set in Railway Variables + GH secrets. Needed for `/api/v1/cron/archive-to-postgres?months=2&secret=…` |
| Data flow (calendar/graded) | live NSE →(ingest `?ingest=1&force=1`)→ KV snapshot →(archive cron)→ **Postgres `calendar_snapshots` = single source of truth** → hub `/api/market/earnings` → graded `/api/v1/earnings/graded`. Hub NEVER reads live for UI; only ingest does. |

## 3 · FIXED + VERIFIED LIVE (don't re-fix; don't regress)

| Patch | File | What it fixed | Verified |
|---|---|---|---|
| zzz402–407 | learn/* | Learn tab: Book collapse, First Principles page, 152 examples | deployed earlier |
| zzz408 | enrich/route.ts + .github/scripts/scrape-screener-fundamentals.mjs | GH-scraped `fundamentals:v1` KV fallback + standalone-page fallback in scraper. ⚠ scraper file may still need hand-copy into `.github/scripts/` (protected path) — VERIFY. | partial |
| zzz409 | fundamentals/page.tsx, multibagger/page.tsx | "0h ago · STALE" chip → distinguishes sync-auth-failure (amber) vs old data. Screener sync GitHub secret `SCREENER_SESSION` was expired (manifest ok:0 fail:19) — user may still need to refresh that secret. | deployed |
| zzz410 | journey/page.tsx | 22% CAGR row added + set as MY TARGET | deployed |
| zzz411/411b | graded/route.ts | **THE big one**: Railway container can't fetch its own public URL (edge rejects self-loop with non-OK, catch-only fallback never fired). Now loopback-first (`127.0.0.1:$PORT`) when `PORT && !VERCEL` for BOTH enrich self-fetch AND hub self-fetch. | ✓ live (158 graded Aug 11) |
| zzz412 | market/earnings/route.ts | Confirmed board meetings now dated to ACTUAL result filing date (confirmingDateNear), not the meeting date. Divgi Q4: May 27, not May 25. | ✓ live |
| zzz413 | cron/archive-to-postgres/route.ts | Archive aborted on duplicate key `raw_filings_src_ref_idx` (checksum includes fy/fq; src_ref doesn't). Dedupe by (source,src_ref) + `ON CONFLICT DO NOTHING` (no target). | ✓ live (archive returns ok, 1664-row snapshot) |
| zzz414 | graded/route.ts, enrich/route.ts | (a) hub-'Upcoming' rows with NO announce_date + >7d old were silently dropped by the zzz72 guard → added quarter-corroborated escape (Screener quarter-end within 0–95d of filing). This is what put DIVGIITTS on Aug 11 as **BLOCKBUSTER score 83, +90.3%/+177.8%**. (b) partial-refresh re-grade passed `hub_quality: undefined` → absolute-only enrichments (CMRGREEN class) were discarded; now derives quality from card tier. (c) `_isoFromQuarterLabel` helper + enrich sets `latest_quarter_end_iso` from the label. | ✓ live |
| zzz415 | earnings-opportunities/page.tsx | "Refresh N missing" client counter now matches server criterion: (noYoY && noAbs) OR noMargin. Fixes "1 missing" when 2 show gaps. Also fixed the auto-converge loop counter. | pushed (verify after deploy) |
| Upstash migration etc. | — | Postgres reachable; KV working; hub ingest manually run today (1664 rows Aug incl. 635 confirmed). | ✓ |

**Verified server state (2026-08-21 evening):** Aug 14 = 231 graded, Aug 13 = 250, Aug 12 = 58, Aug 11 = 158 (Divgi BLOCKBUSTER), May 25 = 91. Aug 18–20 genuinely light (season ended ~Aug 14; 1–3 filings/day is REAL, not a bug).

## 4 · ⚠ OPEN ITEM #1 — THE UNFIXED ONE (zzz416/416b: recent-IPO YoY)

**Symptom:** Cards for 2025-26 listings (INDOMIM, MANIPALHOS, LCL/Lohia, XTRANET, VIKRAN, CAMPUS, CRIZAC…) show absolutes (Rev/PAT/EPS) but `YoY —` + "screener gap" chip, even though **Screener HAS the year-ago quarter** (IPOs disclose RHP quarters; INDOMIM's table = [Jun 2025, Mar 2026, Jun 2026]).

**Root cause (3 stacked layers in `frontend/src/app/api/v1/earnings/enrich/route.ts`):**
1. `fetchScreenerForSymbol` REJECTED tables with `<5` columns → whole direct-Screener result null for IPOs. → fixed: gate now `< 2` (zzz416b).
2. YoY lookup was positional (`priorIdx = N - 5`) → out of bounds on sparse tables. → fixed: month-matched fallback (same month, year−1) when `priorIdx < 0` (zzz416).
3. The Worker wins the source merge and its YoY is also positional-null. → fixed: cherry-pick block fills sales/pat/eps/opm prev+yoy from the direct-Screener result when primary left them null (`_yoy_source: 'screener'`) (zzz416).

**STATE: code COMPLETE, tsc clean, WRITTEN to the user's working tree — but NOT pushed/deployed.** As of the last probe, prod still returns `INDOMIM salesYoY=None`.

**To finish:**
```
cd "/Users/radhevrishi/Developer/Python/Imp Marketcockpit/market-cockpit"
git add -A && git commit -m "zzz416/416b: recent-IPO YoY — relax 5-col gate + month-matched prior quarter + merge cherry-pick" && git pull --rebase origin main && git push origin deploy-zzz:main
git commit --allow-empty -m "trigger railway deploy" && git push origin deploy-zzz:main
```
**Verify after deploy (must show numbers, not None):**
```
curl -s "https://market-cockpit-production.up.railway.app/api/v1/earnings/enrich?symbols=INDOMIM,VIKRAN&bypassCache=1"
# expect INDOMIM sales_yoy_pct ≈ real number, _yoy_source:'screener'
```
Then on the EO page press "Refresh N missing" on Aug 13 / 19 / 20 — IPO cards fill their YoY (refresh path uses nocache=1).

## 5 · OTHER OPEN ITEMS (in priority order)

1. **Push + deploy zzz416/416b** (item #4 above) — the only broken user-visible thing left.
2. **Slow Backfill full run** — runs IN THE BROWSER TAB; navigating/reloading kills it (user's died at 2/60). Start it and leave that tab untouched; browse in a second tab. Dense dates already done manually; the backfill fills the rest of the 60d.
3. **`.github/scripts/scrape-screener-fundamentals.mjs`** — the zzz408 standalone-fallback fix could NOT be written via the bridge (protected path). Check `grep hasUsableRatios` in that file on the user's machine; if absent, the fixed copy was delivered in chat earlier — user must hand-copy. Then run the GH workflow once.
4. **`SCREENER_SESSION` GitHub secret** likely still expired (manifest showed ok:0 fail:19) → Multibagger auto-sync amber chip. User: log into screener.in, copy session cookie, update repo secret, re-run sync workflow.
5. **indiaearninghub worker root-fix (optional)** — patch it in the Cloudflare dashboard to fall back to the standalone page when consolidated top-ratios are empty. Not urgent now that mc-proxy covers it, but would also fix `/batch` consumers.
6. **Manipal/one-off gaps**: MANIPALHOS OPM still null (worker gives opm for it? verify after zzz416 deploys — the direct-screener path may fill opm_prev too).
7. Coverage Probe "+ Add to page" exists for any single missing ticker — use before deep-debugging a one-off.

## 6 · KEY DEBUG COMMANDS (all worked this session)

```
# Per-ticker enrich truth (bypass cache)
curl -s ".../api/v1/earnings/enrich?symbols=TKR&bypassCache=1"
# Graded rebuild for a date
curl -s ".../api/v1/earnings/graded?date=YYYY-MM-DD&force=1"
# Hub month view (Postgres canonical)
curl -s ".../api/market/earnings?market=india&month=YYYY-MM"
# Live ingest (writes KV; ~2-4 min)
curl -s ".../api/market/earnings?market=india&month=YYYY-MM&ingest=1&force=1"
# Archive KV→Postgres (needs secret)
curl -X POST ".../api/v1/cron/archive-to-postgres?months=2&secret=CRON_SECRET"
# Worker debug for a symbol (see raw HTML it fetched)
curl -s "https://indiaearninghub.radhev-232.workers.dev/debug?symbol=TKR"
# Proxy health
curl -s "https://mc-proxy.radhev-232.workers.dev/health"
```
(base = https://market-cockpit-production.up.railway.app)

## 7 · ARCHITECTURE LESSONS (this session's hard-won)

1. Railway containers often CANNOT fetch their own public URL — edge rejects with non-OK (not a throw). ALWAYS loopback-first (`http://127.0.0.1:$PORT`) for self-fetches when `PORT && !VERCEL`.
2. Postgres `calendar_snapshots` is the ONLY thing the calendar/hub UI reads. If pages look frozen: ingest → archive → then they update. Manual chain fixes it same-day; crons (18:00/19:30 UTC) keep it fresh.
3. gradeRow has MULTIPLE silent `return null` gates (future-date, announce-date ±3d, zzz72 no-announce >7d, quarter-mismatch >95d). When a ticker vanishes, binary-search WHICH gate by checking its enrich fields against each gate.
4. Recent IPOs: sparse Screener tables are DATA, not absence — month-match, don't position-count.
5. "N missing/updated" UI counters must use the SAME criterion as the server path they describe.
6. Railway auto-deploy from GitHub pushes is flaky — always confirm a new deployment actually went Active; empty-commit re-push works.
7. `ON CONFLICT (col)` only arbitrates ONE constraint; tables with 2 unique indexes need `ON CONFLICT DO NOTHING` (no target) for idempotent inserts.

## 8 · FILES CHANGED THIS SESSION (user's tree)

```
frontend/src/app/(dashboard)/learn/{page.tsx,learn-intro.ts,learn-examples.ts}   zzz407
frontend/src/app/(dashboard)/journey/page.tsx                                    zzz410
frontend/src/app/(dashboard)/fundamentals/page.tsx                               zzz409
frontend/src/app/(dashboard)/multibagger/page.tsx                                zzz409
frontend/src/app/(dashboard)/watchlists/page.tsx                                 (WATCH preset — was already coded, shipped)
frontend/src/app/(dashboard)/earnings-opportunities/page.tsx                     zzz415
frontend/src/app/api/v1/earnings/enrich/route.ts                                 zzz408/411/414/416/416b  ← PENDING PUSH
frontend/src/app/api/v1/earnings/graded/route.ts                                 zzz411/411b/414
frontend/src/app/api/market/earnings/route.ts                                    zzz412
frontend/src/app/api/v1/cron/archive-to-postgres/route.ts                        zzz413
.github/scripts/scrape-screener-fundamentals.mjs                                 zzz408 ← may need hand-copy (protected)
cloudflare-worker/ (proxy.js deployed as mc-proxy via wrangler)
```

## 9 · STARTER PROMPT FOR NEXT CHAT

> Read `HANDOFF_SESSION_zzz402-416.md` at the repo root of
> `/Users/radhevrishi/Developer/Python/Imp Marketcockpit/market-cockpit/` before doing anything.
> First: check OPEN ITEM #1 (zzz416/416b) — probe
> `curl ".../enrich?symbols=INDOMIM&bypassCache=1"`; if sales_yoy_pct is still null, the push/deploy
> didn't happen — walk me through it and verify. Then work down the OPEN ITEMS list.
