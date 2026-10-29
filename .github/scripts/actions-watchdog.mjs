#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// zzz908 — daily GitHub Actions watchdog: ONE plain-words message about what really failed.
//
// Lists every workflow run of the last WINDOW_HOURS (default 24) through the REST API, looks at each
// failed / cancelled run's jobs and annotations, and sorts it into:
//   capacity    GitHub had no runner for the job ("not acquired by Runner", runner lost)  → not our problem
//   superseded  cancelled by a newer run of the same workflow (concurrency)               → harmless
//   manual      cancelled by a person                                                     → harmless
//   transient   an upstream site / the app was down, rate-limited or timed out            → next run retries
//   real        everything else: code errors, auth/secret problems, bad data, job timeouts → needs a look
// Plus: a collector that ran ≥2 times and was "deferred" (upstream down) on EVERY run → "stuck", counted as real.
//
// Sends ONE Telegram message only when something is real (or stuck). Never prints a secret.
// Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID repo secrets when set; otherwise the app's
// /api/v1/alerts/dispatch (x-cron-secret: CRON_SECRET), which uses the app's own Telegram settings.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, WINDOW_HOURS, DRY_RUN=1 (classify + print, send nothing),
//      RUNS_FILE (read a saved run list instead of the API — local testing), CRON_BASE_URL, CRON_SECRET.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installResilientFetch, exitForError } from './lib/resilient-fetch.mjs';

export const DEFERRED_STEP = 'Upstream deferred (data not updated this run)';
const SELF = 'actions-watchdog';

const RX = {
  capacity: /not acquired by Runner|runner .*(lost communication|has received a shutdown signal)|hosted runner encountered an error|No runner (is )?available|Runner .* did not connect|internal error occurred while (starting|running) the job/i,
  superseded: /higher priority waiting request|Canceling since a higher priority|cancell?ed because .* newer/i,
  manual: /The run was cancell?ed by @/i,
  timeout: /exceeded the maximum execution time/i,
  transient: /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|Could not resolve host|Connection (timed out|refused|reset)|HTTP (429|50[0234])|\b50[234] (Bad Gateway|Service Unavailable|Gateway Time-?out)|rate limit|Upstream not available|deferred to the next run|npm (ERR!|error) (network|code E(AI_AGAIN|CONNRESET|TIMEDOUT))|Temporary failure in name resolution/i,
};
// GitHub's own noise annotations that say nothing about the failure.
const NOISE = /ubuntu-latest label will migrate|Node\.js \d+ (is deprecated|actions are deprecated)|Process completed with exit code|The operation was canceled|npm audit found/i;

/**
 * Classify one finished run from its conclusion, its jobs and the annotation messages of its failed jobs.
 * @returns {{ kind: 'ok'|'capacity'|'superseded'|'manual'|'transient'|'real', reason: string, step?: string }}
 */
export function classifyRun(run, jobs = [], annotations = []) {
  const concl = run.conclusion;
  if (concl === 'success' || concl === 'skipped' || concl === 'neutral') return { kind: 'ok', reason: '' };
  const msgs = annotations.map((a) => String(a || '')).filter(Boolean);
  const meaningful = msgs.filter((m) => !NOISE.test(m));
  const all = msgs.join(' | ');
  const failedJob = jobs.find((j) => ['failure', 'timed_out', 'cancelled', 'startup_failure'].includes(j.conclusion));
  const failedStep = failedJob?.steps?.find((s) => ['failure', 'timed_out', 'cancelled'].includes(s.conclusion))?.name;
  const firstReason = (meaningful[0] || (failedStep ? `step "${failedStep}" failed` : msgs[0]) || '').replace(/\s+/g, ' ').slice(0, 200);

  // Billing/permission blocks also have no runner: do not misclassify an owner-actionable block as capacity.
  if (/recent account payments have failed|spending limit needs to be increased|billing|payment method|Actions has been disabled|not allowed to run workflows/i.test(all)) {
    return { kind: 'real', reason: 'GitHub account billing, spending limit or Actions permission blocked the job; inspect the account settings', step: failedStep };
  }
  if (RX.capacity.test(all)) return { kind: 'capacity', reason: 'GitHub had no runner for the job' };
  if (concl === 'cancelled' && RX.superseded.test(all)) return { kind: 'superseded', reason: 'replaced by a newer run' };
  if (concl === 'cancelled' && RX.manual.test(all)) return { kind: 'manual', reason: 'cancelled by hand' };
  // A job that never got a runner and has no steps at all: GitHub-side.
  if (failedJob && !(failedJob.steps || []).length && !failedJob.runner_name && concl !== 'startup_failure') {
    return { kind: 'capacity', reason: 'job never started on a runner' };
  }
  if (RX.timeout.test(all)) return { kind: 'real', reason: `ran past its time limit${failedStep ? ` in "${failedStep}"` : ''}`, step: failedStep };
  if (meaningful.length && meaningful.every((m) => RX.transient.test(m))) return { kind: 'transient', reason: firstReason, step: failedStep };
  if (concl === 'startup_failure') return { kind: 'real', reason: 'workflow file could not start (YAML / permissions)', step: failedStep };
  return { kind: 'real', reason: firstReason || `${concl}${failedStep ? ` in "${failedStep}"` : ''}`, step: failedStep };
}

/** Workflows whose collector can end "deferred" (they carry the DEFERRED_STEP). */
export function deferringWorkflows(dir) {
  const out = new Set();
  if (!dir || !existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    if (readFileSync(join(dir, f), 'utf8').includes(DEFERRED_STEP)) out.add(`.github/workflows/${f}`);
  }
  return out;
}

/** Group classified runs per workflow and decide what the owner must hear about. */
export function summarize(items) {
  const byWf = new Map();
  for (const it of items) {
    const k = it.workflow;
    if (!byWf.has(k)) byWf.set(k, { workflow: k, runs: 0, ok: 0, deferred: 0, capacity: 0, superseded: 0, manual: 0, transient: 0, real: [], lastUrl: null, latestAt: '', latestKind: '' });
    const w = byWf.get(k);
    w.runs++;
    const at = String(it.createdAt || '');
    if (at >= w.latestAt && !['superseded', 'manual', 'capacity'].includes(it.kind)) { w.latestAt = at; w.latestKind = it.kind; }
    if (it.kind === 'ok') { w.ok++; if (it.deferred) w.deferred++; }
    else if (it.kind === 'real') { w.real.push(it); }
    else w[it.kind]++;
    if (it.kind !== 'ok' || it.deferred) w.lastUrl = w.lastUrl || it.url;
  }
  const rows = [...byWf.values()];
  // a workflow whose most recent run succeeded has already recovered: listed, but no alert on its own
  // (3+ real failures in the window still count as "needs a look": a flaky bug, not a one-off)
  for (const w of rows) w.recovered = w.real.length > 0 && w.real.length < 3 && w.latestKind === 'ok';
  const realWfs = rows.filter((w) => w.real.length && !w.recovered);
  const recovered = rows.filter((w) => w.recovered);
  const stuck = rows.filter((w) => w.deferred >= 2 && w.deferred === w.runs);
  const totals = rows.reduce((t, w) => {
    for (const k of ['runs', 'ok', 'deferred', 'capacity', 'superseded', 'manual', 'transient']) t[k] += w[k];
    t.real += w.real.length; return t;
  }, { runs: 0, ok: 0, deferred: 0, capacity: 0, superseded: 0, manual: 0, transient: 0, real: 0 });
  return { rows, realWfs, recovered, stuck, totals, alert: realWfs.length > 0 || stuck.length > 0 };
}

/** The one message, in plain words. */
export function buildMessage(sum, { hours = 24, repo = '' } = {}) {
  const t = sum.totals;
  const L = [];
  L.push(`Market Cockpit — background jobs, last ${hours} h`);
  L.push(`${t.runs} runs: ${t.ok} fine${t.deferred ? ` (${t.deferred} skipped an update because a source was down)` : ''}.`);
  if (sum.realWfs.length) {
    L.push('');
    L.push(`NEEDS A LOOK (${sum.realWfs.length} job${sum.realWfs.length > 1 ? 's' : ''}):`);
    for (const w of sum.realWfs.slice(0, 12)) {
      const last = w.real[0];
      L.push(`• ${nameOf(w.workflow)} — failed ${w.real.length}× of ${w.runs}: ${last.reason || 'see the run log'}`);
      if (last.url) L.push(`  ${last.url}`);
    }
  }
  if (sum.recovered.length) {
    L.push('');
    L.push('Failed earlier but the latest run worked (no action unless it repeats):');
    for (const w of sum.recovered.slice(0, 12)) L.push(`• ${nameOf(w.workflow)} — ${w.real.length}× of ${w.runs}: ${w.real[0].reason || 'see the run log'}`);
  }
  if (sum.stuck.length) {
    L.push('');
    L.push('STUCK — every run skipped its update because the source stayed down for the whole day:');
    for (const w of sum.stuck.slice(0, 8)) L.push(`• ${nameOf(w.workflow)} (${w.deferred} runs)${w.lastUrl ? `\n  ${w.lastUrl}` : ''}`);
  }
  const noise = [];
  if (t.capacity) noise.push(`${t.capacity} not started because GitHub had no free machine`);
  if (t.transient) noise.push(`${t.transient} hit a temporary outage of a data source`);
  if (t.superseded) noise.push(`${t.superseded} replaced by a newer run`);
  if (t.manual) noise.push(`${t.manual} cancelled by hand`);
  if (noise.length) { L.push(''); L.push(`Nothing to do about: ${noise.join('; ')}. The next scheduled runs cover them.`); }
  if (repo) { L.push(''); L.push(`All runs: https://github.com/${repo}/actions`); }
  return L.join('\n');
}

function nameOf(path) { return String(path || '').replace(/^\.github\/workflows\//, '').replace(/\.ya?ml$/, ''); }

// ── I/O ────────────────────────────────────────────────────────────────────

async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mc-actions-watchdog' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${path.split('?')[0]} → HTTP ${res.status}`);
  return res.json();
}

async function listRuns(repo, token, sinceIso) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await gh(`/repos/${repo}/actions/runs?per_page=100&page=${page}&created=${encodeURIComponent('>=' + sinceIso)}`, token);
    const runs = j.workflow_runs || [];
    out.push(...runs);
    if (runs.length < 100) break;
  }
  return out.filter((r) => r.status === 'completed');
}

async function telegramDirect(text, env) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20_000),
  });
  return r.ok ? 'telegram' : `telegram HTTP ${r.status}`;
}

async function viaApp(text, env, repo) {
  const base = (env.CRON_BASE_URL || 'https://market-cockpit-production.up.railway.app').replace(/\/+$/, '');
  const r = await fetch(`${base}/api/v1/alerts/dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.CRON_SECRET || '' },
    body: JSON.stringify({
      rule: { id: SELF, name: 'GitHub Actions watchdog' },
      article: { title: text, url: `https://github.com/${repo}/actions`, source: 'GitHub Actions' },
      triggeredAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) return `app dispatch HTTP ${r.status}`;
  const j = await r.json().catch(() => ({}));
  return j.telegram === 'sent' ? 'telegram via app' : `app dispatch telegram=${j.telegram || '?'}`;
}

export async function main(env = process.env) {
  const repo = env.GITHUB_REPOSITORY || 'radhevrishi/market-cockpit';
  const hours = Math.max(1, Math.min(168, Number(env.WINDOW_HOURS) || 24));
  const since = new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const token = env.GITHUB_TOKEN || '';
  const offline = !!env.RUNS_FILE;
  if (!offline && !token) throw Object.assign(new Error('GITHUB_TOKEN is not set'), { transient: false });

  const runs = offline ? JSON.parse(readFileSync(env.RUNS_FILE, 'utf8')) : await listRuns(repo, token, since);
  const deferring = deferringWorkflows(env.WORKFLOWS_DIR || '.github/workflows');
  const items = [];
  let apiCalls = 0;
  for (const run of runs) {
    if (String(run.path || '').includes(`${SELF}.yml`)) continue;
    const item = { workflow: run.path || run.name, url: run.html_url, createdAt: run.created_at, conclusion: run.conclusion, deferred: false, kind: 'ok', reason: '' };
    const failed = !['success', 'skipped', 'neutral'].includes(run.conclusion);
    let jobs = run._jobs || [];
    let annotations = run._annotations || [];
    if (!offline && (failed || deferring.has(run.path)) && apiCalls < 400) {
      try {
        jobs = (await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`, token)).jobs || []; apiCalls++;
        if (failed) {
          for (const j of jobs.filter((x) => x.conclusion && x.conclusion !== 'success' && x.conclusion !== 'skipped').slice(0, 3)) {
            const a = await gh(`/repos/${repo}/check-runs/${j.id}/annotations?per_page=50`, token); apiCalls++;
            annotations.push(...a.map((x) => x.message));
          }
        }
      } catch (e) { item.reason = `could not read details (${e.message})`; }
    }
    Object.assign(item, classifyRun(run, jobs, annotations));
    if (item.kind === 'ok') item.deferred = jobs.some((j) => (j.steps || []).some((s) => s.name === DEFERRED_STEP && s.conclusion === 'success'));
    items.push(item);
  }

  const sum = summarize(items);
  const text = buildMessage(sum, { hours, repo });
  console.log(text);
  console.log(`\n(classified ${items.length} runs with ${apiCalls} API calls; alert=${sum.alert})`);
  if (env.GITHUB_STEP_SUMMARY) { try { appendFileSync(env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n'); } catch { /* ignore */ } }

  let sent = 'not needed';
  if (sum.alert && env.DRY_RUN !== '1') {
    sent = 'not sent';
    try {
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) sent = await telegramDirect(text, env);
      if (!/^telegram/.test(sent) && env.CRON_SECRET) sent = await viaApp(text, env, repo);
    } catch (e) { sent = `send failed: ${e?.message || e}`; }
    if (!/telegram/.test(sent) || /HTTP|failed|=/.test(sent)) console.log(`::warning title=Watchdog message not delivered::${sent} — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID repository secrets`);
    else console.log(`message delivered (${sent})`);
  } else if (sum.alert) sent = 'dry run';
  return { sum, text, sent };
}

const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } })();
if (isMain) {
  installResilientFetch();
  main().catch((e) => exitForError(e, 'actions-watchdog failed'));
}
