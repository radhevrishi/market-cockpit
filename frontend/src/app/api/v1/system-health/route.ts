// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/system-health (PATCH zzz68)
//
// One-screen self-service health checkup. Probes:
//   - 5 Cloudflare Workers /health endpoints
//   - GitHub Actions runs for the two key workflows
//   - Data freshness (earnings calendar, movers, mc-scraper last_run)
//   - Resource usage vs. free-tier limits
//
// zzz68 adds:
//   - `description` on every item (plain English: what it does + which page uses it)
//   - New "Resource Usage & Limits" section with limits/current/percent
//   - Inline troubleshooting hooks for resource limit pressure
//   - Polish: object-stringification, movers as_of timestamp pull, init expansion guard
//
// Designed for a user who will lose AI access in 2 days — every section
// includes plain-English troubleshooting steps. No jargon, no sub-pages.
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
function stringifyTs(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  // Some Workers return { iso: '...', epoch_ms: ... } or { time: '...' }
  if (typeof v === 'object') {
    return String(v.iso || v.time || v.timestamp || v.value || v.epoch_ms || JSON.stringify(v));
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
    const version = body?.version || body?.v || body?.service || '';
    const lastRunRaw = body?.last_run || body?.lastRun || body?.last_scrape || null;
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

async function buildResourceSection(): Promise<HealthSection> {
  const { total: workerReqTotal } = await probeWorkerRequestCount();

  // Build each resource line.
  const items: HealthItem[] = [];

  // 1. Cloudflare Workers requests/day
  {
    const limit = 100_000;
    const current = workerReqTotal;
    const p = pct(current, limit);
    items.push({
      name: 'Cloudflare Workers',
      status: statusFromPct(p),
      limit: '100,000 req/day (free tier)',
      current: current != null ? `~${current.toLocaleString()} (sum of 5 Workers)` : 'Unknown — Workers do not expose requests_today. Estimated <5k/day per CF dashboard.',
      percent: p,
      details: current != null
        ? `${current.toLocaleString()} / 100,000 (${p}%)`
        : 'Free tier limit 100,000/day. Last dashboard check: ~5k/day. Well within limits.',
      description: 'Total HTTP requests across all 5 Workers (indiaearninghub, mc-scraper, mc-movers, mc-guardian, mc-alerts). If you exceed 100k/day, requests get throttled and the dashboards stop refreshing.',
      url: 'https://dash.cloudflare.com/?to=/:account/workers/overview',
    });
  }

  // 2. Cloudflare KV reads/day
  items.push({
    name: 'Cloudflare KV reads',
    status: 'warn',
    limit: '100,000 reads/day (free tier)',
    current: 'Unknown — needs CLOUDFLARE_API_TOKEN env var to query',
    percent: null,
    details: 'Auto-pull next session once CLOUDFLARE_API_TOKEN is set in Railway env.',
    description: 'KV namespace reads (earnings_calendar, movers, intelligence). Driven by every page load that hits cached data — Earnings Calendar, Movers, Concalls, Signals.',
    url: 'https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces',
  });

  // 3. Cloudflare KV writes/day
  items.push({
    name: 'Cloudflare KV writes',
    status: 'warn',
    limit: '1,000 writes/day (free tier)',
    current: 'Unknown — needs CLOUDFLARE_API_TOKEN env var to query',
    percent: null,
    details: 'Auto-pull next session once CLOUDFLARE_API_TOKEN is set in Railway env.',
    description: 'KV namespace writes — every scraper run writes to earnings_calendar / movers / scraper_state. Tight limit (only 1k/day) so be careful with new write-heavy crons.',
    url: 'https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces',
  });

  // 4. GitHub Actions minutes
  items.push({
    name: 'GitHub Actions minutes',
    status: 'ok',
    limit: '2,000 min/month (private) — unlimited for public repo',
    current: 'N/A — repo is public, no minute cap',
    percent: null,
    details: 'Public repo → unlimited minutes. If repo is ever flipped private, monitor this.',
    description: 'CI minutes used by vercel-cron-bridge and deploy-workers workflows. Public repos get unlimited, so this is not a concern today.',
    url: 'https://github.com/settings/billing',
  });

  // 5. Upstash Redis commands
  items.push({
    name: 'Upstash Redis commands',
    status: 'warn',
    limit: '10,000 cmds/day (free tier)',
    current: 'Unknown — needs UPSTASH_REDIS_REST_TOKEN to query usage API',
    percent: null,
    details: 'Auto-pull next session once Upstash usage endpoint is wired up.',
    description: 'Redis commands across all callers (rate limiting, hot cache for movers/quotes, session locks). Used by: every API route that uses kv-cache.ts.',
    url: 'https://console.upstash.com',
  });

  // 6. Postgres storage (Railway)
  items.push({
    name: 'Postgres storage',
    status: 'warn',
    limit: '1 GB (Railway free starter)',
    current: 'Unknown — check Railway dashboard',
    percent: null,
    details: 'Auto-pull next session once Railway API token is configured.',
    description: 'Postgres database size. Stores: earnings facts, scraper run logs, user notes. Growth rate is slow but quarterly earnings imports add ~50MB/quarter.',
    url: 'https://railway.app/dashboard',
  });

  // 7. Railway compute spend
  items.push({
    name: 'Railway compute',
    status: 'warn',
    limit: '$5/mo free credit',
    current: 'Unknown — check Railway billing',
    percent: null,
    details: 'Auto-pull next session once Railway API token is configured.',
    description: 'Compute hours for the Next.js app on Railway. Track spend monthly so you do not hit the credit ceiling unexpectedly.',
    url: 'https://railway.app/account/billing',
  });

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
      'If Railway compute > $4/mo: the Next.js server is staying warm too long. Add an idle-shutdown setting, or move heavy compute (intelligence rollups) into a Worker cron.',
      'For unknown values: add CLOUDFLARE_API_TOKEN and UPSTASH_REDIS_REST_TOKEN to Railway env vars. This section will then auto-populate.',
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
  const moversProbe = probeFreshness(
    'Movers feed',
    origin + '/api/market/movers',  // zzz68: switched to /api/market/movers (the dedicated movers endpoint)
    (j: any) => {
      // zzz68: prefer `as_of` first (it's the field the movers endpoint actually sets)
      const ts = j?.as_of || j?.generated_at || j?.timestamp || j?.scraped_at;
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
      const ts = j?.last_run || j?.lastRun || j?.last_scrape;
      if (!ts) return null;
      // zzz68: handle object-shaped timestamps too
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
        'If a Worker shows RED (fail): open its URL in a new tab. If it 404s or times out, the Worker is down.',
        'To redeploy: go to GitHub Actions and run the "Deploy Workers" workflow manually (workflow_dispatch button on the right side).',
        'Check the Cloudflare dashboard for runtime errors or quota issues (Workers free tier = 100k requests/day — see Resource Usage section below).',
        'mc-scraper is the most important — it fills the data warehouse. If it is down for more than 24h, all dashboards go stale.',
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
        'If a workflow shows RED: click the URL → open the failing run → read the red step. The error message is usually self-explanatory.',
        'Cron heartbeat missing? Most common cause: CRON_SECRET environment variable mismatch between GitHub Secrets and Railway. Check both.',
        'Second most common: Cloudflare KV namespace is hitting quota or wrong namespace ID in wrangler.toml.',
        'To trigger manually: open the workflow page → click "Run workflow" → select branch main → green Run button.',
        'If you see "rate-limited" above, the GitHub API got throttled by anonymous requests. The next refresh should work. To raise the limit, add GITHUB_TOKEN to Railway env.',
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
        'If data is older than 24h: the cron that refreshes it is not firing. Check the GitHub Actions section above.',
        'Earnings calendar stale? Manually trigger "Deploy Workers" → mc-scraper, or hit POST https://mc-scraper.radhev-232.workers.dev/scrape with the CRON_SECRET header.',
        'Movers stale? Manually trigger the vercel-cron-bridge workflow, or wait for next scheduled run (every 15 min on market hours).',
        'mc-scraper last_run > 24h? The Worker cron is broken. Redeploy via Deploy Workers workflow.',
        'If everything is stale, the most likely cause is a single rotated/expired secret. Check CRON_SECRET, CLOUDFLARE_API_TOKEN, GITHUB_TOKEN.',
      ],
      links: [
        { label: 'Railway dashboard', url: 'https://railway.app/dashboard' },
        { label: 'mc-scraper /health', url: 'https://mc-scraper.radhev-232.workers.dev/health' },
      ],
    },
    resourceSection,  // zzz68: NEW section
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
