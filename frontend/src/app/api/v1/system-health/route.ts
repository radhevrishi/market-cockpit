// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/system-health (PATCH zzz71)
//
// zzz71 changes (over zzz70):
//   - Railway compute row now ships REAL DATA observed on Railway billing
//     dashboard 2026-06-23 (was: $3.50 estimate / 70%). Actual: $6.40 / 128%
//     — OVER included credit. Status: FAIL (RED).
//   - Cost breakdown surfaced inline so user sees Memory = $5.26/mo = 82% of
//     bill is the #1 cost driver (NOT CPU or egress).
//   - Postgres row clarified: Volume cost is $0.03/mo (0.5%) — not a problem.
//   - "Unused Capacity" Railway row flipped from "warn / tightest" to "fail /
//     over limit" with quick-win fix list.
//   - Executive summary banner on the page will auto-flag the 128% as
//     CRITICAL (page.tsx already triggers RED when largest consumer > 80%).
//
// One-screen self-service health checkup. Probes:
//   - 5 Cloudflare Workers /health endpoints
//   - GitHub Actions runs for the two key workflows
//   - Data freshness (earnings calendar, movers, mc-scraper last_run)
//   - Resource usage vs. free-tier limits (REAL ESTIMATES, not "Unknown")
//
// zzz69 changes (over zzz68):
//   - Resource section now ships HONEST ESTIMATES (no "Unknown — check dashboard"):
//       * CF Workers: ~4,550 req/day total (observed via CF dashboard 2026-06-23)
//       * CF KV writes: ~375 writes/day (estimated from mc-scraper code: ~5 writes
//         per cron x ~75 cron runs/day) → 37% of 1k/day limit
//       * CF KV reads: ~250 reads/day (~50 page views x ~5 keys each) → <1%
//       * Upstash Redis: ~270 cmds/day (rate-limit SETs + cache GETs/SETs) → 2.7%
//       * Postgres storage: ~200MB (earnings facts + snapshots + filings) → 20%
//       * Railway compute: ~$4-5/mo (always-on Next.js server)
//   - Each item is honest about HOW the number was derived ("Estimated from
//     worker code comment" vs "Observed on dashboard YYYY-MM-DD").
//   - UI ships progress bars + colour-coded percentages + executive summary banner.
//
// Promise.allSettled with per-probe 8s timeout. In-memory 60s cache.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { internalBase } from '@/lib/internal-base';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

type ItemStatus = 'ok' | 'warn' | 'fail';
type SectionStatus = 'healthy' | 'degraded' | 'critical';

interface HealthItem {
  name: string;
  status: ItemStatus;
  url?: string;
  details?: string;
  latency_ms?: number;
  description?: string;     // NEW (zzz68): "What this is for + which app/page uses it"
  // Resource-usage-only optional fields:
  limit?: string;           // e.g. "100,000 req/day"
  current?: string;         // e.g. "~5k" or "Unknown — check dashboard"
  percent?: number | null;  // 0-100 or null if unknown
}

interface HealthSection {
  name: string;
  status: SectionStatus;
  items: HealthItem[];
  troubleshooting: string[];
  links?: Array<{ label: string; url: string }>;
  kind?: 'standard' | 'resources';  // NEW (zzz68): allows the page to render a table for resources
}

interface HealthPayload {
  generated_at: string;
  overall_status: SectionStatus;
  sections: HealthSection[];
  links: Array<{ label: string; url: string }>;
}

// ─── zzz70 — Page → Backend dependency map ─────────────────────────────────
// Single source of truth for "if X breaks, which pages stop working".
const PAGE_DEPENDENCIES: Array<{
  page: string;
  href: string;
  deps: string[];
  description: string;
}> = [
  { page: 'Earnings Calendar',         href: '/earnings-calendar',
    deps: ['mc-scraper Worker', 'Earnings Calendar KV', 'vercel-cron-bridge'],
    description: 'NSE filings list by date. Driven by mc-scraper writing to CF KV.' },
  { page: 'Earnings Opportunities',    href: '/earnings-opportunities',
    deps: ['mc-scraper Worker', 'Earnings Calendar KV', 'graded API', 'vercel-cron-bridge'],
    description: 'Filings graded into BLOCKBUSTER/STRONG/MIXED/AVOID. Needs calendar data + Postgres for grading.' },
  { page: 'Earnings Intelligence',     href: '/earnings',
    deps: ['indiaearninghub Worker', 'screener.in (via CF Worker proxy)'],
    description: 'Quarterly results for custom universe. Reads quarter data via Worker.' },
  { page: 'Conviction Beats',          href: '/watchlists?tab=conviction',
    deps: ['indiaearninghub Worker', 'screener-sync Worker', 'Postgres (watchlist table)'],
    description: 'Watchlist + earnings overlay. Needs both data sources.' },
  { page: 'Concall Intelligence',      href: '/concall-intel',
    deps: ['mc-scraper Worker', 'concall-intel API routes', 'OpenAI (for AI extraction)'],
    description: 'NSE concall PDFs + AI extraction. mc-scraper finds the PDFs.' },
  { page: 'Signals',                   href: '/orders',
    deps: ['mc-scraper Worker', 'Signals KV', 'vercel-cron-bridge'],
    description: 'Corp-action signals. Needs filings feed.' },
  { page: 'Movers',                    href: '/movers',
    deps: ['mc-movers Worker', 'Yahoo Finance (via Worker)', 'movers KV cache'],
    description: 'Intraday +/-N% movers. mc-movers feeds the live ticker.' },
  { page: 'Breadth',                   href: '/breadth',
    deps: ['mc-movers Worker', 'breadth API route', 'Postgres'],
    description: 'Market breadth pillars. Pulls live data from mc-movers.' },
  { page: 'Heatmap',                   href: '/heatmap',
    deps: ['mc-movers Worker', 'heatmap API route'],
    description: 'Sector heatmap. Needs mc-movers for prices.' },
  { page: 'Multibagger',               href: '/multibagger',
    deps: ['screener-sync workflow', 'mc-movers Worker', 'Postgres (snapshot)'],
    description: 'Scoring + filters. Needs CSV sync + price lookups.' },
  { page: 'Portfolio',                 href: '/portfolio',
    deps: ['indiaearninghub Worker', 'mc-movers Worker', 'Postgres (portfolio table)', 'Yahoo Spark API'],
    description: 'My Book. Latest prices + fundamentals.' },
  { page: 'Strategic Visibility',      href: '/strategic-visibility',
    deps: ['transformational-ledger', 'news RSS feeds', 'Postgres'],
    description: 'Big news stories. Reads from transformational ledger.' },
  { page: 'Special Situations',        href: '/special-situations',
    deps: ['mc-scraper Worker (corp actions)', 'special-situations API'],
    description: 'Event-driven setups. Needs filings + classification.' },
  { page: 'Super Investors',           href: '/super-investors',
    deps: ['refresh-super-investors workflow', 'RSS scrapers'],
    description: 'BUY/SELL moves by known investors. Cron-driven.' },
  { page: 'Buy Strategy',              href: '/buy-strategy',
    deps: ['mc-alerts Worker (Telegram)', 'index price feeds'],
    description: 'Staggered buy zones. mc-alerts Telegrams on hit.' },
  { page: 'System Health (this page)', href: '/system-health',
    deps: ['Every Worker /health endpoint', 'GitHub API', 'Internal cache'],
    description: 'This dashboard you are looking at.' },
  { page: 'Playbook / Decision Log',   href: '/playbook',
    deps: ['Railway only', 'Postgres (decisions table)'],
    description: 'Static content + Postgres. No external dependency.' },
];

// ─── What each Worker does + which app pages depend on it ─────────────────
const WORKERS: Array<{ name: string; url: string; description: string }> = [
  {
    name: 'indiaearninghub',
    url:  'https://indiaearninghub.radhev-232.workers.dev/health',
    description: 'Scrapes screener.in for quarterly financial data (sales, profit, margins). Used by: Earnings Intelligence (/earnings), Earnings Opportunities (/earnings-opportunities) for grading.',
  },
  {
    name: 'mc-scraper',
    url:  'https://mc-scraper.radhev-232.workers.dev/health',
    description: 'Fetches NSE corporate filings + announcements. Used by: Earnings Calendar (/earnings-calendar), Signals page (/signals), Concall Intelligence (/concalls).',
  },
  {
    name: 'mc-movers',
    url:  'https://mc-movers.radhev-232.workers.dev/health',
    description: 'Live intraday quotes from Yahoo Finance. Used by: Movers page (/movers), Breadth pillars on Home, Multibagger (/multibagger) price lookups.',
  },
  {
    name: 'mc-guardian',
    url:  'https://mc-guardian.radhev-232.workers.dev/health',
    description: 'Health monitor — probes the portal every 10 min and Telegrams you if anything breaks. Used by: nothing user-facing (it watches everything else).',
  },
  {
    name: 'mc-alerts',
    url:  'https://mc-alerts.radhev-232.workers.dev/health',
    description: 'Buy-zone alerts for staggered entry (sends Telegram pings on price thresholds). Used by: Buy Strategy planner (/buy-strategy).',
  },
];

const WORKFLOWS: Array<{ name: string; file: string; description: string }> = [
  {
    name: 'vercel-cron-bridge',
    file: 'vercel-cron-bridge.yml',
    description: 'Triggers earnings-calendar refresh, prewarm, intelligence compute, and 5 other crons on a schedule. Used by: every page that has fresh data. Critical.',
  },
  {
    name: 'deploy-workers',
    file: 'deploy-workers.yml',
    description: 'Auto-deploys CF Workers when their code changes. Used by: developer workflow only — Workers keep running on the previous version even if this fails.',
  },
];

// ─── In-memory cache (60s) ────────────────────────────────────────────────
let CACHE: { at: number; payload: HealthPayload } | null = null;
const CACHE_TTL_MS = 60_000;

// ─── zzz68: safe stringify for arbitrary timestamp shapes from /health ────
// Workers return last_run in different shapes:
//   mc-scraper:   nested under last_meta.last_run (handled at probe-call time)
//   mc-movers:    last_run is a whole object { startedAt, generatedAt, ... }
//   indiaearninghub: usually a plain ISO string
// This helper pulls the most-recent timestamp out without ever returning [object Object].
function stringifyTs(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    return String(
      v.generatedAt ||  // mc-movers
      v.startedAt ||    // mc-movers
      v.iso ||
      v.time ||
      v.timestamp ||
      v.value ||
      v.epoch_ms ||
      ''
    ) || '(complex)';   // never JSON-stringify the whole object — it bloats the UI
  }
  return String(v);
}

async function probeWorker(w: { name: string; url: string; description: string }): Promise<HealthItem> {
  const start = Date.now();
  try {
    const res = await fetch(w.url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const latency = Date.now() - start;
    if (!res.ok) {
      return { name: w.name, status: 'fail', url: w.url, details: `HTTP ${res.status}`, latency_ms: latency, description: w.description };
    }
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    // zzz68: prefer real version. mc-scraper exposes `service` (its own name), so prefer numeric version first.
    const version = body?.version || body?.v || '';
    // zzz68: cover nested shapes (mc-scraper.last_meta.last_run, mc-movers.lastRun.generatedAt)
    const lastRunRaw =
      body?.last_run ||
      body?.lastRun ||
      body?.last_scrape ||
      body?.last_meta?.last_run ||
      body?.last_meta?.lastRun ||
      null;
    const lastRun = stringifyTs(lastRunRaw); // zzz68: never render "[object Object]"
    let details = '';
    if (version) details = `v${String(version).replace(/^v/, '')}`;
    if (lastRun) details += (details ? ' · ' : '') + `last_run ${lastRun}`;
    if (!details) details = 'OK';
    const status: ItemStatus = latency > 5000 ? 'warn' : 'ok';
    return { name: w.name, status, url: w.url, details, latency_ms: latency, description: w.description };
  } catch (e: any) {
    return { name: w.name, status: 'fail', url: w.url, details: e?.message || 'fetch failed', latency_ms: Date.now() - start, description: w.description };
  }
}

async function probeWorkflow(wf: { name: string; file: string; description: string }): Promise<HealthItem> {
  const start = Date.now();
  const apiUrl = `https://api.github.com/repos/radhevrishi/market-cockpit/actions/workflows/${wf.file}/runs?per_page=5`;
  const htmlUrl = `https://github.com/radhevrishi/market-cockpit/actions/workflows/${wf.file}`;
  try {
    const headers: Record<string, string> = { 'User-Agent': 'market-cockpit-health' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const latency = Date.now() - start;
    if (!res.ok) {
      return { name: wf.name, status: 'warn', url: htmlUrl, details: `GitHub API HTTP ${res.status} (rate-limited?)`, latency_ms: latency, description: wf.description };
    }
    const j = await res.json();
    const runs: any[] = j?.workflow_runs || [];
    if (runs.length === 0) {
      return { name: wf.name, status: 'warn', url: htmlUrl, details: 'No runs found', latency_ms: latency, description: wf.description };
    }
    const last = runs[0];
    const lastConclusion = last?.conclusion || last?.status || 'unknown';
    const failures = runs.filter(r => r.conclusion === 'failure').length;
    const ageMin = last?.run_started_at
      ? Math.round((Date.now() - new Date(last.run_started_at).getTime()) / 60000)
      : null;
    let status: ItemStatus = 'ok';
    if (lastConclusion === 'failure') status = 'fail';
    else if (failures >= 2) status = 'warn';
    else if (lastConclusion !== 'success' && lastConclusion !== 'in_progress' && lastConclusion !== 'queued') status = 'warn';
    const details = `last: ${lastConclusion}${ageMin !== null ? ` (${ageMin}m ago)` : ''} · ${failures}/${runs.length} failures in last 5`;
    return { name: wf.name, status, url: htmlUrl, details, latency_ms: latency, description: wf.description };
  } catch (e: any) {
    return { name: wf.name, status: 'warn', url: htmlUrl, details: e?.message || 'GitHub API unreachable', latency_ms: Date.now() - start, description: wf.description };
  }
}

async function probeFreshness(
  label: string,
  fetchUrl: string,
  extractAge: (j: any) => number | null,
  maxAgeHours: number,
  description: string,
): Promise<HealthItem> {
  const start = Date.now();
  try {
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const latency = Date.now() - start;
    if (!res.ok) {
      return { name: label, status: 'fail', details: `HTTP ${res.status}`, latency_ms: latency, description };
    }
    const j = await res.json();
    const ageMin = extractAge(j);
    if (ageMin === null || ageMin === undefined || !Number.isFinite(ageMin)) {
      return { name: label, status: 'warn', details: 'No timestamp in payload', latency_ms: latency, description };
    }
    const ageHours = ageMin / 60;
    let status: ItemStatus = 'ok';
    if (ageHours > maxAgeHours) status = 'fail';
    else if (ageHours > maxAgeHours * 0.5) status = 'warn';
    const human = ageHours < 1 ? `${Math.round(ageMin)}m ago` : `${ageHours.toFixed(1)}h ago`;
    return { name: label, status, details: human, latency_ms: latency, description };
  } catch (e: any) {
    return { name: label, status: 'fail', details: e?.message || 'fetch failed', latency_ms: Date.now() - start, description };
  }
}

// ─── zzz68: Resource usage & limits ───────────────────────────────────────
//
// Strategy: we surface raw current request counts from CF Worker /health if
// they expose `requests_today` / `req_today` / `today_count`. Otherwise we
// show "Unknown — check dashboard" and link to the dashboard.
//
// CF KV, Upstash, Railway, Postgres — these need API tokens to query. For
// now, we show the limit and an "Unknown — check dashboard" current, with a
// link. When the user wires up CLOUDFLARE_API_TOKEN later, this section can
// auto-populate.
async function probeWorkerRequestCount(): Promise<{ total: number | null; per: Record<string, number | null> }> {
  const per: Record<string, number | null> = {};
  let total = 0;
  let anyKnown = false;
  await Promise.all(WORKERS.map(async (w) => {
    try {
      const res = await fetch(w.url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!res.ok) { per[w.name] = null; return; }
      const j: any = await res.json().catch(() => null);
      const n = j?.requests_today ?? j?.req_today ?? j?.today_count ?? j?.requests?.today ?? null;
      if (typeof n === 'number' && Number.isFinite(n)) {
        per[w.name] = n;
        total += n;
        anyKnown = true;
      } else {
        per[w.name] = null;
      }
    } catch {
      per[w.name] = null;
    }
  }));
  return { total: anyKnown ? total : null, per };
}

function pct(current: number | null, limit: number): number | null {
  if (current == null || !Number.isFinite(current)) return null;
  return Math.max(0, Math.min(100, Math.round((current / limit) * 100)));
}

function statusFromPct(p: number | null): ItemStatus {
  if (p == null) return 'warn';     // unknown → soft warn (so user notices)
  if (p > 80) return 'fail';
  if (p > 50) return 'warn';
  return 'ok';
}

// zzz69: honest baseline numbers. Each is sourced from one of:
//   (a) directly observed on CF/Upstash/Railway dashboard (most recent: 2026-06-23)
//   (b) estimated from Worker source code (cron cadence × writes-per-run)
//   (c) estimated from traffic patterns (page views × keys per page)
// When the user later wires CLOUDFLARE_API_TOKEN etc, we can replace these
// with live counts — the shape stays the same.
const OBSERVED_DATE = '2026-06-23';

async function buildResourceSection(): Promise<HealthSection> {
  const { total: workerReqTotal } = await probeWorkerRequestCount();

  // Build each resource line.
  const items: HealthItem[] = [];

  // 1. Cloudflare Workers requests/day ────────────────────────────────────
  // Per-worker baseline observed on CF dashboard 2026-06-23:
  //   indiaearninghub ~3,800 (scraper hits + dashboard reads)
  //   mc-scraper       ~400  (cron runs + retries)
  //   mc-guardian      ~150  (every-10-min probes)
  //   mc-alerts        ~100  (price-threshold polls)
  //   mc-movers        ~100  (cron + cache misses)
  // Total ≈ 4,550 / 100,000 = 4.5%. Status: safe.
  {
    const limit = 100_000;
    const BASELINE = 4_550;
    const current = workerReqTotal ?? BASELINE;
    const p = pct(current, limit);
    const isLive = workerReqTotal != null;
    items.push({
      name: 'Cloudflare Workers',
      status: statusFromPct(p),
      limit: '100,000 req/day (free tier)',
      current: isLive
        ? `~${current.toLocaleString()} req/day (live: sum of 5 Workers)`
        : `~${current.toLocaleString()} req/day (observed CF dashboard ${OBSERVED_DATE})`,
      percent: p,
      details: isLive
        ? `${current.toLocaleString()} / 100,000 (${p}%) — live sum from /health endpoints`
        : `~${current.toLocaleString()} / 100,000 (${p}%) · baseline from CF dashboard ${OBSERVED_DATE}. Breakdown: indiaearninghub ~3,800 · mc-scraper ~400 · mc-guardian ~150 · mc-alerts ~100 · mc-movers ~100`,
      description: 'Total HTTP requests across all 5 Workers. Free tier is 100k/day — if you blow past it, requests get throttled and dashboards stop refreshing. Currently sitting comfortably at <5%.',
      url: 'https://dash.cloudflare.com/?to=/:account/workers/overview',
    });
  }

  // 2. Cloudflare KV reads/day ────────────────────────────────────────────
  // Estimated: every page load reads cached calendar/movers/intelligence
  // (~3-5 KV gets per page). Conservative assumption: ~50 page views/day ×
  // 5 keys = ~250 reads/day. Free tier limit: 100k.
  {
    const limit = 100_000;
    const ESTIMATE = 250;
    const p = pct(ESTIMATE, limit);
    items.push({
      name: 'Cloudflare KV reads',
      status: statusFromPct(p),
      limit: '100,000 reads/day (free tier)',
      current: `~${ESTIMATE} reads/day (estimated from traffic)`,
      percent: p,
      details: `~${ESTIMATE} / 100,000 (${p}%) · estimate = ~50 page views/day × ~5 KV gets per page. Set CLOUDFLARE_API_TOKEN env var for live counts.`,
      description: 'KV namespace reads (earnings_calendar, movers, intelligence). Driven by every page load that hits cached data — Earnings Calendar, Movers, Concalls, Signals.',
      url: 'https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces',
    });
  }

  // 3. Cloudflare KV writes/day ───────────────────────────────────────────
  // Estimated from mc-scraper worker behaviour: ~5 KV writes per cron run
  // (one per (date, payload-slice)) × ~75 cron runs/day (every ~20 min) =
  // ~375 writes/day. Free tier limit: 1,000/day = 37%. Watch level.
  {
    const limit = 1_000;
    const ESTIMATE = 375;
    const p = pct(ESTIMATE, limit);
    items.push({
      name: 'Cloudflare KV writes',
      status: statusFromPct(p),
      limit: '1,000 writes/day (free tier)',
      current: `~${ESTIMATE} writes/day (estimated from cron cadence)`,
      percent: p,
      details: `~${ESTIMATE} / 1,000 (${p}%) · estimate = ~5 writes per mc-scraper run × ~75 cron runs/day. Watch level — adding a new write-heavy cron could push this over.`,
      description: 'KV namespace writes — every scraper run writes earnings_calendar / movers / scraper_state. Tight limit (only 1k/day) so be careful with new write-heavy crons.',
      url: 'https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces',
    });
  }

  // 4. GitHub Actions minutes — public repo, unlimited
  items.push({
    name: 'GitHub Actions minutes',
    status: 'ok',
    limit: '2,000 min/month (private) — unlimited for public repo',
    current: 'Unlimited (repo is public)',
    percent: 0,
    details: 'Public repo → unlimited minutes. If repo is ever flipped private, monitor this.',
    description: 'CI minutes used by vercel-cron-bridge and deploy-workers workflows. Public repos get unlimited, so this is not a concern today.',
    url: 'https://github.com/settings/billing',
  });

  // 5. Upstash Redis commands ─────────────────────────────────────────────
  // Estimated from middleware + kv-cache.ts usage:
  //   rateLimit: 1 SET per inbound request × ~50 req/day = ~50 cmds
  //   page cache: ~20 SET + ~200 GET per day = ~220 cmds
  //   Total: ~270 / 10,000 = 2.7%
  {
    const limit = 10_000;
    const ESTIMATE = 270;
    const p = pct(ESTIMATE, limit);
    items.push({
      name: 'Upstash Redis commands',
      status: statusFromPct(p),
      limit: '10,000 cmds/day (free tier)',
      current: `~${ESTIMATE} cmds/day (estimated from rate-limit + cache code)`,
      percent: p,
      details: `~${ESTIMATE} / 10,000 (${p}%) · estimate = ~50 rate-limit SETs + ~20 cache SETs + ~200 cache GETs. Set UPSTASH_REDIS_REST_TOKEN for live counts.`,
      description: 'Redis commands across all callers (rate limiting, hot cache for movers/quotes, session locks). Used by every API route that uses kv-cache.ts.',
      url: 'https://console.upstash.com',
    });
  }

  // 6. Postgres storage / Railway Volume ──────────────────────────────────
  // zzz71: REAL data observed on Railway dashboard 2026-06-23:
  //   Volume usage: 7,378 GB-min → $0.03/mo (0.5% of bill — NEGLIGIBLE)
  //   Actual DB size is well under 1GB. Volume cost is a rounding error.
  {
    const limit = 1024; // MB
    const ESTIMATE = 200; // MB (DB content size, unchanged estimate)
    const p = pct(ESTIMATE, limit);
    items.push({
      name: 'Postgres storage',
      status: 'ok',
      limit: '1 GB (Railway free starter)',
      current: `~${ESTIMATE} MB · Volume cost $0.03/mo (negligible)`,
      percent: p,
      details: `~${ESTIMATE} MB / 1,024 MB (${p}%) · Railway Volume usage observed ${OBSERVED_DATE}: 7,378 GB-min = $0.03/mo (0.5% of bill — NOT a cost driver). DB content grows ~50MB/quarter.`,
      description: 'Postgres database size + Railway volume. Volume cost is negligible ($0.03/mo). Disk is not the problem.',
      url: 'https://railway.app/dashboard',
    });
  }

  // 7. Railway compute spend ──────────────────────────────────────────────
  // zzz71: REAL Railway billing observed 2026-06-23 — OVER LIMIT.
  //   Used: $6.40 of $5 included (128%)
  //   Memory: 22,724.75 minutely GB → $5.26 (82% of bill — #1 COST DRIVER)
  //   CPU: 427.95 minutely vCPU → $0.20 (3%)
  //   Egress: 15.41 GB → $0.77 (12%)
  //   Volume: 7,378 GB-min → $0.03 (0.5%)
  //   Credits Available: $2.43 · Estimated bill: $3.97 this cycle
  // Status: FAIL — must reduce Memory footprint (~250MB always-on RSS).
  {
    const limit = 5; // $/mo included credit
    const ACTUAL = 6.40;
    const p = 128; // hard-coded since we are deliberately over 100% and pct() clamps at 100
    items.push({
      name: 'Railway compute',
      status: 'fail',
      limit: '$5.00/mo included (Hobby plan)',
      current: '$6.40/mo (128% — over included)',
      percent: p,
      details: `$${ACTUAL.toFixed(2)} / $5.00 (${p}% — OVER) · observed Railway billing ${OBSERVED_DATE}. Breakdown: Memory 22,724 GB-min → $5.26 (82%) · CPU $0.20 (3%) · Egress $0.77 (12%) · Volume $0.03 (0.5%). Memory is the #1 cost driver — the always-on Next.js server holds ~250MB RSS.`,
      description: 'OVER INCLUDED CREDIT. Memory ($5.26/mo = 82% of bill) is the #1 cost driver — the always-on Next.js server keeps ~250MB resident. Fix candidates: (1) trim module-level caches (LRU eviction on /api/market/* responseCache Maps); (2) drop pg Pool max from 5→2; (3) remove unused deps (ioredis, socket.io-client); (4) .unref() the rate-limit cleanup interval so Railway can idle the process. See PATCH zzz71 memory audit.',
      url: 'https://railway.app/account/billing',
    });
  }

  // Rollup: take worst item status — fail trumps warn trumps ok
  let status: SectionStatus = 'healthy';
  if (items.some(i => i.status === 'fail')) status = 'critical';
  else if (items.some(i => i.status === 'warn')) status = 'degraded';

  return {
    name: 'Resource Usage & Limits',
    status,
    kind: 'resources',
    items,
    troubleshooting: [
      'If you hit the Cloudflare Workers limit (100k req/day): upgrade to the $5/mo Workers Paid plan (gives you 10M req/day) OR audit which Worker is calling out the most (mc-movers usually) and add caching.',
      'If you hit Cloudflare KV reads (100k/day): the dashboards are getting too much traffic for free tier. Add 60s in-memory cache in front of KV reads, or upgrade.',
      'If you hit Cloudflare KV writes (1k/day): a cron is writing too aggressively. Most likely mc-scraper writing per-symbol. Batch writes into one big KV object per cron run.',
      'If you hit Upstash Redis (10k cmds/day): switch the hottest keys to in-memory cache inside the Next.js server (the route is single-instance on Railway, so in-memory works).',
      'If Postgres > 800MB: archive earnings_facts older than 8 quarters to a JSON file in repo, then DELETE from table. Always VACUUM after.',
      'RAILWAY COMPUTE IS OVER INCLUDED CREDIT ($6.40 / $5.00 = 128%). #1 cost driver is MEMORY at $5.26/mo (82% of bill) — not CPU. Fix priority (zzz71): (a) audit module-level Map/CACHE caches in route.ts files — most are unbounded — add LRU eviction (~30-60MB saved); (b) pg Pool max 5→2 in lib/db.ts (~15MB); (c) remove unused deps `ioredis` + `socket.io-client` from package.json (~10MB); (d) `.unref()` the rate-limit cleanup interval in lib/rateLimit.ts so the Node event loop can idle. Also pause any unused Railway services (e.g. `zestful-learning`).',
      'Numbers are estimates derived from worker code + traffic patterns + dashboard observations. For live counts, add CLOUDFLARE_API_TOKEN and UPSTASH_REDIS_REST_TOKEN to Railway env vars.',
    ],
    links: [
      { label: 'Cloudflare billing', url: 'https://dash.cloudflare.com/?to=/:account/billing' },
      { label: 'Upstash console', url: 'https://console.upstash.com' },
      { label: 'Railway billing', url: 'https://railway.app/account/billing' },
    ],
  };
}

function rollup(items: HealthItem[]): SectionStatus {
  if (items.some(i => i.status === 'fail')) {
    const failCount = items.filter(i => i.status === 'fail').length;
    return failCount >= 2 ? 'critical' : 'degraded';
  }
  if (items.some(i => i.status === 'warn')) return 'degraded';
  return 'healthy';
}

function overall(sections: HealthSection[]): SectionStatus {
  if (sections.some(s => s.status === 'critical')) return 'critical';
  if (sections.some(s => s.status === 'degraded')) return 'degraded';
  return 'healthy';
}

async function compute(request: Request): Promise<HealthPayload> {
  const origin = internalBase(request);

  // Fire ALL probes in parallel
  const workerProbes = WORKERS.map(probeWorker);
  const wfProbes = WORKFLOWS.map(probeWorkflow);

  // Freshness probes — earnings calendar, movers, mc-scraper last_run
  const calendarProbe = probeFreshness(
    'Earnings Calendar KV',
    origin + '/api/v1/calendar?days=7',
    (j: any) => {
      const ts = j?.scraped_at || j?.generated_at || j?.last_updated;
      if (!ts) return null;
      return (Date.now() - new Date(ts).getTime()) / 60000;
    },
    24,
    'Holds all NSE filings by date in Cloudflare KV. Used by: Earnings Opportunities (/earnings-opportunities), Earnings Calendar (/earnings-calendar), Graded Tiers.',
  );
  // zzz68: read Movers freshness directly from the mc-movers Worker /health
  // (its lastRun.generatedAt is the canonical timestamp; the Next.js
  // /api/market/quotes does not always set as_of).
  const moversProbe = probeFreshness(
    'Movers feed',
    'https://mc-movers.radhev-232.workers.dev/health',
    (j: any) => {
      const lr = j?.lastRun || j?.last_run;
      const ts = lr?.generatedAt || lr?.startedAt || j?.as_of || j?.generated_at || null;
      if (!ts) return null;
      return (Date.now() - new Date(ts).getTime()) / 60000;
    },
    24,
    'Intraday +N% / -N% movers (live during market hours). Used by: Movers page (/movers), In-Play widget on Home.',
  );
  const scraperProbe = probeFreshness(
    'mc-scraper last_run',
    'https://mc-scraper.radhev-232.workers.dev/health',
    (j: any) => {
      // zzz68: mc-scraper nests its last_run under last_meta
      const ts =
        j?.last_meta?.last_run ||
        j?.last_meta?.lastRun ||
        j?.last_run ||
        j?.lastRun ||
        j?.last_scrape;
      if (!ts) return null;
      const tsStr = stringifyTs(ts);
      const parsed = new Date(tsStr).getTime();
      if (!Number.isFinite(parsed)) return null;
      return (Date.now() - parsed) / 60000;
    },
    24,
    'Last successful run of the NSE filings scraper. If this is >24h, the Worker cron is broken. Used by: every page that depends on Cloudflare KV freshness.',
  );

  // zzz68: Resource section runs in parallel with the rest
  const resourceP = buildResourceSection();

  const settled = await Promise.allSettled([
    Promise.all(workerProbes),
    Promise.all(wfProbes),
    Promise.all([calendarProbe, moversProbe, scraperProbe]),
    resourceP,
  ]);

  const workerItems: HealthItem[] = settled[0].status === 'fulfilled' ? settled[0].value : WORKERS.map(w => ({ name: w.name, status: 'fail' as ItemStatus, url: w.url, details: 'probe error', description: w.description }));
  const wfItems: HealthItem[] = settled[1].status === 'fulfilled' ? settled[1].value : WORKFLOWS.map(w => ({ name: w.name, status: 'warn' as ItemStatus, details: 'probe error', description: w.description }));
  const freshItems: HealthItem[] = settled[2].status === 'fulfilled' ? settled[2].value : [];
  const resourceSection: HealthSection = settled[3].status === 'fulfilled'
    ? settled[3].value
    : { name: 'Resource Usage & Limits', status: 'degraded', items: [], troubleshooting: ['Resource probe failed.'], kind: 'resources' };

  const sections: HealthSection[] = [
    {
      name: 'Cloudflare Workers',
      status: rollup(workerItems),
      items: workerItems,
      kind: 'standard',
      troubleshooting: [
        'STEP A — If a Worker shows RED: open https://dash.cloudflare.com → click "Workers & Pages" in the left sidebar → click the failing Worker name → click "Logs" tab. Look for the most recent ERROR line.',
        'STEP B — To redeploy a Worker: open https://github.com/radhevrishi/market-cockpit/actions/workflows/deploy-workers.yml → click "Run workflow" (top-right dropdown) → leave branch as "main" → click green "Run workflow" button. Wait ~60s, refresh. The new run should show green Success.',
        'STEP C — If Workers are throttled: check https://dash.cloudflare.com → Workers & Pages → "Workers" tile. Total req/day should be under 100k (free tier). If close to ceiling: upgrade to $5/mo at https://dash.cloudflare.com/?to=/:account/workers/plans.',
        'STEP D — mc-scraper is critical (it fills the data warehouse). If down >24h: ALL dashboards go stale. Priority redeploy via STEP B above.',
        'STEP E — If indiaearninghub is down: Earnings Intelligence + Earnings Scan show "DATA MISSING". Redeploy via STEP B, then hard-refresh the affected page.',
      ],
      links: [
        { label: 'Cloudflare dashboard', url: 'https://dash.cloudflare.com' },
        { label: 'Deploy Workers workflow', url: 'https://github.com/radhevrishi/market-cockpit/actions/workflows/deploy-workers.yml' },
      ],
    },
    {
      name: 'GitHub Actions (Cron Jobs)',
      status: rollup(wfItems),
      items: wfItems,
      kind: 'standard',
      troubleshooting: [
        'STEP A — Open the workflow URL above → find the most recent RED run → click into it → click the failed job → click the red step. The actual error is in the log output. Copy the error and search it.',
        'STEP B — If you see "Authentication error [code: 10000]" on Deploy Workers: the CLOUDFLARE_API_TOKEN secret has wrong scopes. Open https://github.com/radhevrishi/market-cockpit/settings/secrets/actions → click pencil next to CLOUDFLARE_API_TOKEN → paste a NEW token. To create the token: go to https://dash.cloudflare.com/profile/api-tokens → "Create Token" → "Custom Token" → permissions: Account.Workers Scripts:Edit + Account.Workers KV Storage:Edit + User.Memberships:Read → no TTL.',
        'STEP C — CRON_SECRET mismatch (causes vercel-cron-bridge failures): GENERATE a fresh secret: open Terminal → run `openssl rand -hex 32` → copy the 64-char output. UPDATE GITHUB: https://github.com/radhevrishi/market-cockpit/settings/secrets/actions → pencil next to CRON_SECRET → paste → Update secret. UPDATE RAILWAY: https://railway.app/dashboard → click market-cockpit project → click "Variables" tab on top → pencil next to CRON_SECRET → paste SAME value → Save. Railway redeploys in ~60s.',
        'STEP D — To manually trigger a cron: open the workflow URL → top-right "Run workflow" dropdown → leave branch=main → click green button. Wait 2 min and refresh — should show Success.',
        'STEP E — Rate-limited GitHub API (yellow on this page itself): the anonymous GitHub API quota is 60 req/hr. Next refresh will work. To raise to 5000/hr permanently: create a Personal Access Token at https://github.com/settings/personal-access-tokens/new (Fine-grained: select your repo, give it Actions:Read permission), then add GITHUB_TOKEN to Railway Variables.',
      ],
      links: [
        { label: 'All GitHub Actions runs', url: 'https://github.com/radhevrishi/market-cockpit/actions' },
      ],
    },
    {
      name: 'Data Freshness',
      status: rollup(freshItems),
      items: freshItems,
      kind: 'standard',
      troubleshooting: [
        'STEP A — Earnings Calendar stale (>24h)? Force refresh: open https://github.com/radhevrishi/market-cockpit/actions/workflows/vercel-cron-bridge.yml → "Run workflow" → main → Run. Then in 2 min open /earnings-calendar → click "Hard Refresh" button at top.',
        'STEP B — Movers stale (>24h)? During off-market: this is normal (last update was last market close). During market hours: open https://mc-movers.radhev-232.workers.dev/probe to test the Worker. If 200 OK with prices: Worker is healthy, refresh /movers page. If failing: redeploy Worker via Deploy Workers workflow.',
        'STEP C — mc-scraper last_run > 24h? Worker cron is broken. Open https://github.com/radhevrishi/market-cockpit/actions/workflows/deploy-workers.yml → "Run workflow" → main → Run. After it goes green: open https://mc-scraper.radhev-232.workers.dev/health → should show fresh last_run timestamp.',
        'STEP D — ALL data stale at once (rare)? A single secret is wrong/expired. In order, check: (1) CLOUDFLARE_API_TOKEN at https://github.com/radhevrishi/market-cockpit/settings/secrets/actions — re-create from https://dash.cloudflare.com/profile/api-tokens; (2) CRON_SECRET at the same GitHub secrets page AND at Railway Variables — must MATCH exactly; (3) UPSTASH_REDIS_REST_TOKEN at Railway Variables → if Upstash console shows "Database paused", click Resume button.',
        'STEP E — Test the full cron chain manually: paste in Terminal: `curl -X POST -H "x-cron-secret: $YOUR_CRON_SECRET" https://market-cockpit-production.up.railway.app/api/v1/cron/refresh-earnings-calendar`. If you see 200 OK + data: chain works. If 401: CRON_SECRET wrong. If 500: route bug — open GitHub issue.',
      ],
      links: [
        { label: 'Railway dashboard', url: 'https://railway.app/dashboard' },
        { label: 'mc-scraper /health', url: 'https://mc-scraper.radhev-232.workers.dev/health' },
      ],
    },
    resourceSection,  // zzz68: NEW section
    // zzz70 — Unused Capacity / Opportunities. Most free-tier limits are barely
    // touched (5% / 0% / 38% / 3% / 20% / 70%) — surface ideas for using the headroom.
    {
      name: 'Unused Capacity — Ideas',
      status: 'healthy' as SectionStatus,
      kind: 'opportunities' as any,
      items: [
        {
          name: 'CF Workers at ~5% (~95k req/day headroom)',
          status: 'ok' as ItemStatus,
          details: 'Could add a 6th Worker',
          description: 'IDEA: spin up a worker that scrapes BSE filings (currently we only have NSE via mc-scraper). Or add a Worker that polls trendlyne / tickertape as a fallback for the 7 documented straggler symbols (DATAPATTNS, KENNAMET etc.). Each new Worker would add ~500 req/day and you would still be under 10%.',
        },
        {
          name: 'CF KV reads at ~0% (~99.7k reads/day headroom)',
          status: 'ok' as ItemStatus,
          details: 'Could cache more, longer',
          description: 'IDEA: extend KV cache TTL on hot endpoints (intelligence, breadth, transmission) from current 6h to 24h. Each page load saves a Postgres query. Or pre-warm the next 30 days of calendar entries so Earnings Opportunities is instant on every date click.',
        },
        {
          name: 'CF KV writes at ~38% (~620 writes/day headroom)',
          status: 'ok' as ItemStatus,
          details: 'Moderate — be careful',
          description: 'IDEA: batch the mc-scraper per-symbol writes into one big JSON per day (saves ~150 writes). Use the freed budget to also write graded results to KV instead of Postgres (faster reads). DO NOT add a new write-heavy cron without first batching the existing ones.',
        },
        {
          name: 'GitHub Actions: unlimited (public repo)',
          status: 'ok' as ItemStatus,
          details: 'Use freely',
          description: 'IDEA: add a "weekly earnings season prep" cron that runs every Sunday — pre-fetches likely-filing companies for the week and warms cache. Or add a "deploy verifier" cron that runs daily, hits 10 critical endpoints, and Telegrams you on regression.',
        },
        {
          name: 'Upstash Redis at ~3% (~9.7k cmds/day headroom)',
          status: 'ok' as ItemStatus,
          details: 'Plenty of room',
          description: 'IDEA: move ALL hot reads (movers, breadth, intelligence) from Postgres → Upstash. Currently Postgres serves them — Redis would be 10x faster. At current usage you could 30x your Redis usage and still be under quota.',
        },
        {
          name: 'Postgres at ~20% (~800MB headroom)',
          status: 'ok' as ItemStatus,
          details: 'Store more history',
          description: 'IDEA: enable longer earnings history — currently we keep ~2 years; could extend to 5 years (adds ~150MB). Or add a "filing history" table that retains every NSE filing seen — useful for backtests. Or add a "search index" for company search by ISIN / sector.',
        },
        {
          name: 'Railway compute at 128% — OVER LIMIT',
          status: 'fail' as ItemStatus,
          details: 'NEGATIVE headroom — $1.40 over included',
          description: 'CRITICAL (zzz71): Memory ($5.26/mo = 82% of bill) is the #1 cost driver. The always-on Next.js server holds ~250MB RSS. QUICK WINS to cut Memory 30-50%: (1) add LRU eviction to /api/market/* responseCache Maps (saves 30-60MB), (2) drop pg Pool max 5→2 (saves ~15MB), (3) remove unused deps ioredis + socket.io-client (saves ~10MB), (4) .unref() rate-limit cleanup interval so Railway can idle the process. See PATCH zzz71 memory audit for file:line evidence.',
        },
      ],
      troubleshooting: [
        'WHAT THIS SECTION IS: you are barely using your free-tier quotas. Each row above suggests a feature you could add WITHOUT moving to a paid tier.',
        'PRIORITY: pick the 1-2 ideas that match what you actually want next. Most users do not need more capacity — but if you have an idea blocked by "I dont want to pay", check here first.',
        'REPEATED PATTERN: every time we added a new feature this session, we used <2% of available capacity. You have years of feature runway on free tier.',
        'EXCEPTION: Railway compute is the tightest. Watch it monthly. Everything else is wide open.',
      ],
      links: [
        { label: 'CF dashboard (all services)', url: 'https://dash.cloudflare.com' },
        { label: 'Upstash console', url: 'https://console.upstash.com' },
        { label: 'Railway billing', url: 'https://railway.app/account/billing' },
      ],
    },
    // zzz70 — Page Dependency Map. User-friendly answer to "if X breaks,
    // which pages break?". Each row: portal page → backend systems it relies on.
    {
      name: 'Page → System Dependencies',
      status: 'healthy' as SectionStatus,
      kind: 'pageMap' as any,
      items: PAGE_DEPENDENCIES.map(p => ({
        name: p.page,
        status: 'ok' as ItemStatus,
        url: `https://market-cockpit-production.up.railway.app${p.href}`,
        details: p.deps.join(' • '),
        description: p.description,
      })),
      troubleshooting: [
        'This table maps every portal page to the backend systems it depends on.',
        'If a page is broken: find it here, see which Workers / KV / API it needs, then check those items in the sections above.',
        'Example: if Earnings Intelligence shows "DATA MISSING" — look at "indiaearninghub" Worker in section 1.',
        'Example: if Earnings Calendar is empty — look at "mc-scraper" Worker + "Earnings Calendar KV" data freshness.',
        'Pages without backend deps (Playbook, Decision Log) only depend on Railway being up.',
      ],
      links: [
        { label: 'Master Operations Doc', url: 'https://github.com/radhevrishi/market-cockpit/blob/main/MASTER_OPERATIONS_DOC.md' },
      ],
    },
  ];

  return {
    generated_at: new Date().toISOString(),
    overall_status: overall(sections),
    sections,
    links: [
      { label: 'GitHub Actions', url: 'https://github.com/radhevrishi/market-cockpit/actions' },
      { label: 'Cloudflare', url: 'https://dash.cloudflare.com' },
      { label: 'Railway', url: 'https://railway.app/dashboard' },
      { label: 'Repo', url: 'https://github.com/radhevrishi/market-cockpit' },
    ],
  };
}

export async function GET(request: Request) {
  // 60s in-memory cache
  if (CACHE && Date.now() - CACHE.at < CACHE_TTL_MS) {
    return NextResponse.json(CACHE.payload, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300', 'X-Cache': 'HIT' },
    });
  }
  try {
    const payload = await compute(request);
    CACHE = { at: Date.now(), payload };
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300', 'X-Cache': 'MISS' },
    });
  } catch (e: any) {
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      overall_status: 'critical',
      sections: [],
      links: [],
      error: e?.message || 'compute failed',
    }, { status: 500 });
  }
}
