// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/system-health (PATCH zzz67)
//
// One-screen self-service health checkup. Probes:
//   - 5 Cloudflare Workers /health endpoints
//   - GitHub Actions runs for the two key workflows
//   - Data freshness (earnings calendar, movers, mc-scraper last_run)
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
}

interface HealthSection {
  name: string;
  status: SectionStatus;
  items: HealthItem[];
  troubleshooting: string[];
  links?: Array<{ label: string; url: string }>;
}

interface HealthPayload {
  generated_at: string;
  overall_status: SectionStatus;
  sections: HealthSection[];
  links: Array<{ label: string; url: string }>;
}

const WORKERS = [
  { name: 'indiaearninghub',  url: 'https://indiaearninghub.radhev-232.workers.dev/health' },
  { name: 'mc-scraper',       url: 'https://mc-scraper.radhev-232.workers.dev/health' },
  { name: 'mc-movers',        url: 'https://mc-movers.radhev-232.workers.dev/health' },
  { name: 'mc-guardian',      url: 'https://mc-guardian.radhev-232.workers.dev/health' },
  { name: 'mc-alerts',        url: 'https://mc-alerts.radhev-232.workers.dev/health' },
];

const WORKFLOWS = [
  { name: 'vercel-cron-bridge', file: 'vercel-cron-bridge.yml' },
  { name: 'deploy-workers',     file: 'deploy-workers.yml' },
];

// ─── In-memory cache (60s) ────────────────────────────────────────────────
let CACHE: { at: number; payload: HealthPayload } | null = null;
const CACHE_TTL_MS = 60_000;

async function probeWorker(w: { name: string; url: string }): Promise<HealthItem> {
  const start = Date.now();
  try {
    const res = await fetch(w.url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const latency = Date.now() - start;
    if (!res.ok) {
      return { name: w.name, status: 'fail', url: w.url, details: `HTTP ${res.status}`, latency_ms: latency };
    }
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    const version = body?.version || body?.v || body?.service || '';
    const lastRun = body?.last_run || body?.lastRun || body?.last_scrape || null;
    let details = '';
    if (version) details = `v${String(version).replace(/^v/, '')}`;
    if (lastRun) details += (details ? ' · ' : '') + `last_run ${String(lastRun)}`;
    if (!details) details = 'OK';
    const status: ItemStatus = latency > 5000 ? 'warn' : 'ok';
    return { name: w.name, status, url: w.url, details, latency_ms: latency };
  } catch (e: any) {
    return { name: w.name, status: 'fail', url: w.url, details: e?.message || 'fetch failed', latency_ms: Date.now() - start };
  }
}

async function probeWorkflow(wf: { name: string; file: string }): Promise<HealthItem> {
  const start = Date.now();
  const apiUrl = `https://api.github.com/repos/radhevrishi/market-cockpit/actions/workflows/${wf.file}/runs?per_page=5`;
  const htmlUrl = `https://github.com/radhevrishi/market-cockpit/actions/workflows/${wf.file}`;
  try {
    const headers: Record<string, string> = { 'User-Agent': 'market-cockpit-health' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const latency = Date.now() - start;
    if (!res.ok) {
      return { name: wf.name, status: 'warn', url: htmlUrl, details: `GitHub API HTTP ${res.status} (rate-limited?)`, latency_ms: latency };
    }
    const j = await res.json();
    const runs: any[] = j?.workflow_runs || [];
    if (runs.length === 0) {
      return { name: wf.name, status: 'warn', url: htmlUrl, details: 'No runs found', latency_ms: latency };
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
    return { name: wf.name, status, url: htmlUrl, details, latency_ms: latency };
  } catch (e: any) {
    return { name: wf.name, status: 'warn', url: htmlUrl, details: e?.message || 'GitHub API unreachable', latency_ms: Date.now() - start };
  }
}

async function probeFreshness(label: string, fetchUrl: string, extractAge: (j: any) => number | null, maxAgeHours: number): Promise<HealthItem> {
  const start = Date.now();
  try {
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const latency = Date.now() - start;
    if (!res.ok) {
      return { name: label, status: 'fail', details: `HTTP ${res.status}`, latency_ms: latency };
    }
    const j = await res.json();
    const ageMin = extractAge(j);
    if (ageMin === null || ageMin === undefined || !Number.isFinite(ageMin)) {
      return { name: label, status: 'warn', details: 'No timestamp in payload', latency_ms: latency };
    }
    const ageHours = ageMin / 60;
    let status: ItemStatus = 'ok';
    if (ageHours > maxAgeHours) status = 'fail';
    else if (ageHours > maxAgeHours * 0.5) status = 'warn';
    const human = ageHours < 1 ? `${Math.round(ageMin)}m ago` : `${ageHours.toFixed(1)}h ago`;
    return { name: label, status, details: human, latency_ms: latency };
  } catch (e: any) {
    return { name: label, status: 'fail', details: e?.message || 'fetch failed', latency_ms: Date.now() - start };
  }
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
    'Earnings calendar',
    origin + '/api/v1/calendar?days=7',
    (j: any) => {
      const ts = j?.scraped_at || j?.generated_at || j?.last_updated;
      if (!ts) return null;
      return (Date.now() - new Date(ts).getTime()) / 60000;
    },
    24,
  );
  const moversProbe = probeFreshness(
    'Movers feed',
    origin + '/api/market/quotes?market=india',
    (j: any) => {
      const ts = j?.as_of || j?.generated_at || j?.timestamp;
      if (!ts) return null;
      return (Date.now() - new Date(ts).getTime()) / 60000;
    },
    24,
  );
  const scraperProbe = probeFreshness(
    'mc-scraper last_run',
    'https://mc-scraper.radhev-232.workers.dev/health',
    (j: any) => {
      const ts = j?.last_run || j?.lastRun || j?.last_scrape;
      if (!ts) return null;
      return (Date.now() - new Date(ts).getTime()) / 60000;
    },
    24,
  );

  const settled = await Promise.allSettled([
    Promise.all(workerProbes),
    Promise.all(wfProbes),
    Promise.all([calendarProbe, moversProbe, scraperProbe]),
  ]);

  const workerItems: HealthItem[] = settled[0].status === 'fulfilled' ? settled[0].value : WORKERS.map(w => ({ name: w.name, status: 'fail' as ItemStatus, url: w.url, details: 'probe error' }));
  const wfItems: HealthItem[] = settled[1].status === 'fulfilled' ? settled[1].value : WORKFLOWS.map(w => ({ name: w.name, status: 'warn' as ItemStatus, details: 'probe error' }));
  const freshItems: HealthItem[] = settled[2].status === 'fulfilled' ? settled[2].value : [];

  const sections: HealthSection[] = [
    {
      name: 'Cloudflare Workers',
      status: rollup(workerItems),
      items: workerItems,
      troubleshooting: [
        'If a Worker shows RED (fail): open its URL in a new tab. If it 404s or times out, the Worker is down.',
        'To redeploy: go to GitHub Actions and run the "Deploy Workers" workflow manually (workflow_dispatch button on the right side).',
        'Check the Cloudflare dashboard for runtime errors or quota issues (Workers free tier = 100k requests/day).',
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
