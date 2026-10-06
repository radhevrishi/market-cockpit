// ═══════════════════════════════════════════════════════════════════════════
// DATA WATCH — did each pipeline PRODUCE anything, not just run.     (zzz749)
//
// Every cron in this system reports a heartbeat, and every heartbeat was
// green on the morning the earnings calendar had been empty for weeks. A job
// that runs, finds nothing, and writes nothing is "ok" to a heartbeat. It is
// not ok to the person reading the calendar.
//
// This route asserts on DATA. For each pipeline it asks the question a reader
// would ask — "are there upcoming board meetings?", "did yesterday's US
// filers get graded?", "is the model answering?" — and:
//
//   1. HEALS what it can without a human: re-runs the month ingest and the
//      archive when the calendar is thin, runs the day's gainers sweep when
//      nobody has opened the tab, re-runs the calendar cron when its keys are
//      empty. Then re-checks.
//   2. TELLS a human only what a human must do, by Telegram, once per
//      failure signature per six hours, with the action spelled out.
//   3. RECORDS the full result (`data-watch:last`) for /system-status, so
//      "is anything wrong?" is one row, not a tour of ten tabs.
//
// Schedule (GitHub Actions, data-watch.yml): 05:30 UTC (11:00 IST — the
// morning gainers sweep + calendar), 10:30 UTC (16:00 IST — post-close
// gainers), 14:30 UTC (10:30 ET — US pre-market filers graded).
// GET ?secret=<CRON_SECRET>[&no_heal=1][&no_alert=1]
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { secretFromRequest } from '@/lib/request-secret';   // zzz883: header first, ?secret= only for old callers
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { internalBase } from '@/lib/internal-base';
import { istToday, istNow, isNseHoliday } from '@/lib/market-hours';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import { readSpend, monthlyCapUsd, provider, openaiModel } from '@/lib/anthropic-meter';
import { readBookState } from '@/lib/book-store';
import { indiaResultsSeason, upcomingFloor, failureSignature, type WatchLevel, type WatchCheck, type WatchResult } from '@/lib/data-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Level = WatchLevel;
type Check = WatchCheck;

const LAST_KEY = 'data-watch:last';
const ALERT_KEY = 'data-watch:last-alert';
const ALERT_COOLDOWN_MS = 6 * 3600_000;

const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
function nextMonthOf(d: Date): string { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); return monthOf(x); }

async function getJson(base: string, path: string, timeoutMs = 120_000): Promise<{ ok: boolean; status: number; json: any; error?: string }> {
  try {
    const r = await fetch(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    let json: any = null;
    try { json = await r.json(); } catch { json = null; }
    return { ok: r.ok, status: r.status, json };
  } catch (e: any) {
    return { ok: false, status: 0, json: null, error: String(e?.message || e) };
  }
}

async function telegram(text: string): Promise<{ sent: boolean; why?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN_ALERTS || process.env.TELEGRAM_BOT_TOKEN_EARNINGS || process.env.TELEGRAM_BOT_TOKEN || '';
  const chat = process.env.TELEGRAM_CHAT_ID_ALERTS || process.env.TELEGRAM_CHAT_ID_EARNINGS || process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chat) return { sent: false, why: 'no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID configured' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? { sent: true } : { sent: false, why: `telegram HTTP ${r.status}` };
  } catch (e: any) { return { sent: false, why: String(e?.message || e) }; }
}

export async function GET(req: Request) {
  await warmNseHolidays(); // zzz905: holiday check below must know years beyond 2026
  const { searchParams } = new URL(req.url);
  const provided = secretFromRequest(req) || '';
  const expected = process.env.CRON_SECRET || '';
  if (expected && provided !== expected) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const heal = searchParams.get('no_heal') !== '1';
  // ── MODEL SPEND IS CLICK-ONLY.                                    (zzz768)
  // The owner's rule: a model call happens because someone clicked, never
  // because a schedule fired. The gainers sweep and the held-name evidence
  // reads below both spend model calls, so a scheduled run only REPORTS them
  // unless MC_AUTO_SPEND=1 is set on the server. Free heals (calendar
  // ingest, cron re-runs) still run.
  const autoSpend = process.env.MC_AUTO_SPEND === '1';
  const alert = searchParams.get('no_alert') !== '1';
  const secretQ = expected ? `&secret=${encodeURIComponent(expected)}` : '';
  const base = internalBase(req);

  const now = new Date();
  const ist = istNow(now);
  const istDate = istToday(now);
  const istHour = ist.getUTCHours();   // istNow() shifts the instant: UTC getters, or a non-UTC host double-shifts (zzz766)
  const istDow = ist.getUTCDay();
  const indiaTradingDay = istDow >= 1 && istDow <= 5 && !isNseHoliday(now);
  const checks: Check[] = [];
  const t = () => Date.now();

  // ── 1. INDIA CALENDAR: upcoming results board meetings ──────────────────
  {
    const t0 = t();
    const cur = monthOf(now), nxt = nextMonthOf(now);
    // force=1 after a heal: the read route memoises a month for 5 minutes.
    const countUpcoming = async (force = false) => {
      const f = force ? '&force=1' : '';
      const [a, b] = await Promise.all([getJson(base, `/api/market/earnings?market=india&month=${cur}${f}`), getJson(base, `/api/market/earnings?market=india&month=${nxt}${f}`)]);
      const rows = [...(a.json?.results || []), ...(b.json?.results || [])];
      const up = rows.filter((r: any) => r?.quality === 'Upcoming' && String(r?.resultDate || '').slice(0, 10) >= istDate);
      return { up: up.length, nextKnown: b.json?.coverage === 'known', curKnown: a.json?.coverage === 'known', sample: up.slice(0, 5).map((r: any) => `${r.ticker} ${String(r.resultDate).slice(0, 10)}`) };
    };
    let c = await countUpcoming();
    const need = upcomingFloor(istDate);
    const dayOfMonth = ist.getUTCDate();
    const nextMissing = dayOfMonth >= 2 && !c.nextKnown;
    let healed: string | undefined;
    if ((c.up < need || nextMissing) && heal) {
      const i1 = await getJson(base, `/api/market/earnings?ingest=1&force=1&month=${cur}`, 170_000);
      const i2 = await getJson(base, `/api/market/earnings?ingest=1&force=1&month=${nxt}`, 170_000);
      const ar = await getJson(base, `/api/v1/cron/archive-to-postgres?months=1&ahead=1${secretQ}`, 120_000);
      c = await countUpcoming(true);
      healed = `re-ran ingest ${cur} (${i1.json?.summary?.total ?? '?'} rows), ${nxt} (${i2.json?.summary?.total ?? '?'} rows), archive ${ar.ok ? 'ok' : `HTTP ${ar.status}`} → ${c.up} upcoming now`;
    }
    const level: Level = c.up >= need && !(dayOfMonth >= 2 && !c.nextKnown) ? 'ok' : c.up > 0 ? 'warn' : 'fail';
    checks.push({
      id: 'india-calendar', name: 'India calendar: upcoming results meetings', level,
      detail: `${c.up} upcoming (need ≥${need}${indiaResultsSeason(istDate) ? ', results season' : ''}) · ${cur} ${c.curKnown ? 'in Postgres' : 'NOT in Postgres'} · ${nxt} ${c.nextKnown ? 'in Postgres' : 'NOT in Postgres'}${c.sample.length ? ` · e.g. ${c.sample.join(', ')}` : ''}`,
      healed,
      action: level === 'ok' ? undefined : 'Run /api/market/earnings?ingest=1&force=1&month=<YYYY-MM>&debug=true and read upcomingSources: it names which exchange (NSE / BSE) refused and why.',
      ms: t() - t0,
    });
  }

  // ── 2. CALENDAR CRON KEYS (earnings-cal:auto:*) ────────────────────────
  {
    const t0 = t();
    const to = new Date(now.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    const q = () => getJson(base, `/api/v1/earnings/calendar?from=${istDate}&to=${to}`);
    let r = await q();
    let total = Number(r.json?.total || 0);
    let healed: string | undefined;
    if (total === 0 && heal) {
      const rr = await getJson(base, `/api/v1/cron/refresh-earnings-calendar?x=1${secretQ}`, 120_000);
      r = await q(); total = Number(r.json?.total || 0);
      healed = `re-ran refresh-earnings-calendar (${rr.json?.status || `HTTP ${rr.status}`}, meetings_found ${rr.json?.meetings_found ?? '?'}${rr.json?.fetch_error ? `, ${rr.json.fetch_error}` : ''}) → ${total} in next 30d`;
    }
    checks.push({
      id: 'calendar-cron', name: 'Calendar cron keys (next 30 days)', level: total > 0 ? 'ok' : 'fail',
      detail: `${total} meetings in earnings-cal keys for ${istDate}→${to} (source ${r.json?.source || '?'})`, healed,
      action: total > 0 ? undefined : 'Both NSE and BSE answered nothing to refresh-earnings-calendar: check the heartbeat error text and PROXY_URL/PROXY_SECRET on Railway.',
      ms: t() - t0,
    });
  }

  // ── 3. ANTHROPIC: is the model answering? ─────────────────────────────
  {
    const t0 = t();
    let led: any = null;
    try { led = await readSpend(); } catch { led = null; }
    const cap = monthlyCapUsd();
    const lastOk = led ? Object.values(led.by_feature as Record<string, any>).map((f: any) => f.last_at).filter(Boolean).sort().pop() : null;
    const err = led?.last_error;
    const errRecent = err && Date.now() - Date.parse(err.at) < 24 * 3600_000;
    const failingNow = !!(errRecent && (!lastOk || err.at > lastOk));
    const nearCap = led ? led.total_usd >= 0.9 * cap : false;
    const level: Level = failingNow ? 'fail' : nearCap ? 'warn' : 'ok';
    checks.push({
      id: 'anthropic', name: `AI model API (${provider() === 'openai' ? `OpenAI ${openaiModel()}` : 'Anthropic Haiku 4.5'})`, level,
      detail: led ? `month $${led.total_usd.toFixed(2)} of $${cap} · ${led.calls} ok · ${led.failed || 0} failed · ${led.blocked} capped${err ? ` · last error ${err.at.slice(0, 16)} HTTP ${err.status}: ${String(err.message).slice(0, 120)}` : ''}` : 'no ledger (KV unavailable)',
      action: failingNow ? `Every model call since ${err.at.slice(0, 16)} was refused (HTTP ${err.status}: ${String(err.message).slice(0, 160)}). Fix at ${provider() === 'openai' ? 'platform.openai.com' : 'console.anthropic.com'} (billing/key); no redeploy needed.` : nearCap ? `Spend is at ${Math.round((led.total_usd / cap) * 100)}% of the $${cap} cap — raise AI_MONTHLY_CAP_USD on Railway if this month should keep going.` : undefined,
      ms: t() - t0,
    });
  }

  // ── 4. US GRADED: last ET session ──────────────────────────────────────
  {
    const t0 = t();
    // Last completed US session in ET: yesterday, or Friday on a weekend/Monday.
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const d = new Date(et); d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = await getJson(base, `/api/v1/earnings/graded-us?date=${iso}&days=1`, 240_000);
    const raw = Number(r.json?.raw_items_total ?? -1), cand = Number(r.json?.candidates_total ?? -1);
    const pendingXbrl = Number(r.json?.pending_xbrl_total ?? 0);
    const level: Level = !r.ok ? 'fail' : raw > 0 && cand === 0 && pendingXbrl === 0 ? 'fail' : 'ok';
    checks.push({
      id: 'us-graded', name: `US graded (${iso})`, level,
      detail: r.ok ? `${raw} filers · ${cand} graded · ${pendingXbrl} awaiting XBRL · engine ${r.json?.engine_version || '?'}` : `graded-us HTTP ${r.status} ${r.error || ''}`,
      action: level === 'fail' ? 'Filers were found but none graded: open /us-earnings-opportunities → Hard re-scan for that date and read the notes; if it repeats, the EDGAR XBRL path changed.' : undefined,
      ms: t() - t0,
    });
  }

  // ── 5. AI GAINERS: today's sweep, run it if nobody opened the tab ──────
  if (indiaTradingDay && istHour >= 10) {
    const t0 = t();
    const state = await getJson(base, `/api/v1/ai-gainers/research?market=IN`);
    let cov = state.json?.coverage || { researched: 0, total: 0, pct: 0 };
    let healed: string | undefined;
    if ((cov.total === 0 || cov.pct < 90) && heal && autoSpend) {
      const scan = await getJson(base, `/api/v1/ai-gainers?market=IN&limit=15`, 120_000);
      const rows = (scan.json?.scanned || []).map((g: any) => ({ ticker: g.ticker, company: g.company, move_pct: g.move_pct, volume: g.volume ?? null, price: g.price ?? null, market_cap: g.market_cap ?? null, perf: g.perf ?? null }));
      let calls = 0, researched = 0, remaining = -1;
      const deadline = Date.now() + 200_000;
      while (Date.now() < deadline && calls < 8) {
        let j: any = null;
        try {
          const rr = await fetch(`${base}/api/v1/ai-gainers/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ market: 'IN', rows: calls === 0 ? rows : [], budget_ms: 40_000 }), signal: AbortSignal.timeout(60_000) });
          j = await rr.json();
        } catch (e: any) { healed = `sweep stopped: ${String(e?.message || e)}`; break; }
        calls++; researched += Number(j?.researched_now || 0); remaining = Number(j?.remaining ?? -1);
        if (!remaining || !j?.researched_now) break;
      }
      const after = await getJson(base, `/api/v1/ai-gainers/research?market=IN`);
      cov = after.json?.coverage || cov;
      healed = healed || `swept ${researched} names in ${calls} calls (${rows.length} scanned) → ${cov.researched}/${cov.total} researched`;
    }
    // With spend click-only, an unswept day is the expected state, not a fault.
    const level: Level = !autoSpend ? 'ok' : cov.total === 0 ? 'fail' : cov.pct >= 90 ? 'ok' : 'warn';
    checks.push({
      id: 'ai-gainers', name: 'AI Daily Gainers (IN) sweep', level,
      detail: `${cov.researched}/${cov.total} researched (${cov.pct}%) · model reads ${state.json?.model_reads ?? '?'}/${state.json?.model_reads_ceiling ?? '?'}${autoSpend ? '' : ' · sweep runs on click (auto-spend off)'}`, healed,
      action: level === 'fail' ? 'The screener gainers scan returned no names: check the screener.in screen URL and the mc-proxy Worker.' : undefined,
      ms: t() - t0,
    });
  }

  // ── 5b. PORTFOLIO EVIDENCE: read new filings for held names ───────────
  //
  // "Read all" was a button. Now: every run reads, in incremental mode, up
  // to ~150 s worth of held names whose ledger says NEVER_READ, STALE or
  // NEW_EVIDENCE_AVAILABLE. Incremental mode short-circuits when no source
  // lists a document newer than the ledger, so a settled book costs nothing.
  // Skipped entirely while the model is refusing calls (check 3).
  {
    const t0 = t();
    const modelDown = checks.find((c) => c.id === 'anthropic')?.level === 'fail';
    let held: string[] = [];
    try {
      const st: any = await readBookState(process.env.NEXT_PUBLIC_CHAT_ID || '5057319640');
      const rows: any[] = st?.tickers || st?.book?.tickers || [];
      held = rows.filter((x) => x?.held).map((x) => String(x.ticker || '').toUpperCase()).filter(Boolean);
    } catch { held = []; }
    if (held.length) {
      const ev = await getJson(base, `/api/v1/portfolio/evidence?tickers=${encodeURIComponent(held.join(','))}`);
      const fresh: Record<string, { state: string }> = ev.json?.freshness || {};
      const due = held.filter((tk) => ['NEVER_READ', 'STALE', 'NEW_EVIDENCE_AVAILABLE'].includes(fresh[tk]?.state || 'NEVER_READ'));
      let healed: string | undefined;
      let read = 0, skippedNoNew = 0, failed = 0;
      const outcomes: string[] = [];
      if (due.length && heal && autoSpend && !modelDown) {
        const deadline = Date.now() + 150_000;
        for (const tk of due) {
          if (Date.now() > deadline) break;
          const r = await getJson(base, `/api/v1/india/ai-summary?ticker=${encodeURIComponent(tk)}&mode=incremental`, 130_000);
          if (r.json?.skipped === 'SKIPPED_NO_NEW_EVIDENCE') skippedNoNew++;
          else if (r.json?.ok) read++;
          else { failed++; outcomes.push(`${tk}: ${String(r.json?.error || r.error || `HTTP ${r.status}`).slice(0, 80)}`); }
        }
        healed = `read ${read}, no new evidence ${skippedNoNew}, failed ${failed} of ${due.length} due${outcomes.length ? ` — ${outcomes.slice(0, 3).join('; ')}` : ''}`;
      }
      const remaining = Math.max(0, due.length - read - skippedNoNew);
      const level: Level = modelDown && autoSpend ? 'warn' : failed > 0 && read === 0 && due.length > 0 ? 'fail' : 'ok';
      checks.push({
        id: 'portfolio-evidence', name: 'Portfolio Catalysts evidence (held names)', level,
        detail: `${held.length} held · ${due.length} due (never read / stale / new evidence) · ${remaining} still due after this run${autoSpend ? '' : ' · reads run on click (auto-spend off)'}`, healed,
        action: modelDown ? 'Not attempted: the model is refusing calls (see Anthropic API).' : level === 'fail' ? 'Every attempted read failed: open one card → Read latest evidence and read the outcome text.' : undefined,
        ms: t() - t0,
      });
    }
  }

  // ── 6. HEARTBEATS: silent crons ───────────────────────────────────────
  {
    const t0 = t();
    const h = await getJson(base, `/api/v1/cron/heartbeat?action=health`);
    const stale: any[] = (h.json?.rows || []).filter((r: any) => r?.stale);
    const failedLast: any[] = (h.json?.rows || []).filter((r: any) => r && r.last_ok === false && !r.stale);
    const level: Level = stale.length ? 'fail' : failedLast.length ? 'warn' : 'ok';
    checks.push({
      id: 'heartbeats', name: 'Cron heartbeats', level,
      detail: `${(h.json?.rows || []).length} crons · ${stale.length} silent${stale.length ? ` (${stale.map((r) => r.name).join(', ')})` : ''} · ${failedLast.length} failed last run${failedLast.length ? ` (${failedLast.map((r) => `${r.name}: ${String(r.error || r.exit_code).slice(0, 60)}`).join('; ')})` : ''}`,
      action: level === 'ok' ? undefined : 'Open GitHub → Actions for the named workflow; the heartbeat row carries the response body of the failed run.',
      ms: t() - t0,
    });
  }

  const fails = checks.filter((c) => c.level === 'fail').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  const healedN = checks.filter((c) => c.healed).length;
  const result: WatchResult = { ran_at: new Date().toISOString(), ist_date: istDate, checks, fails, warns, healed: healedN, alerted: false };

  // ── Alert: once per failure signature per 6 hours, actions spelled out ──
  if (alert && (fails > 0 || warns > 0)) {
    const sig = failureSignature(checks);
    let last: { sig: string; at: number } | null = null;
    try { last = await kvGet(ALERT_KEY); } catch { last = null; }
    if (!last || last.sig !== sig || Date.now() - last.at > ALERT_COOLDOWN_MS) {
      const lines = checks.filter((c) => c.level !== 'ok').map((c) => `${c.level === 'fail' ? '🔴' : '🟠'} <b>${c.name}</b>\n${c.detail}${c.healed ? `\n↻ ${c.healed}` : ''}${c.action ? `\n→ ${c.action}` : ''}`);
      const text = `<b>Market Cockpit · data watch</b> ${istDate}\n${fails} failing · ${warns} warning · ${healedN} self-healed\n\n${lines.join('\n\n')}`.slice(0, 3900);
      const tg = await telegram(text);
      result.alerted = tg.sent;
      result.alert_note = tg.sent ? undefined : tg.why;
      if (tg.sent) { try { await kvSet(ALERT_KEY, { sig, at: Date.now() }, 7 * 24 * 3600); } catch { /* next run re-alerts; acceptable */ } }
    } else {
      result.alert_note = `same failure set already alerted ${Math.round((Date.now() - last.at) / 60000)} min ago`;
    }
  }

  if (isRedisAvailable()) { try { await kvSet(LAST_KEY, result, 7 * 24 * 3600); } catch { /* status page shows the previous run */ } }
  // zzz885: the watch's own heartbeat says the WATCH RAN (green). Failing checks are reported by the checks themselves
  // (Telegram + /system-status); making this row red too fed the 'Cron heartbeats' check its own failure, so it never recovered.
  try {
    await fetch(`${base}/api/v1/cron/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'data-watch', phase: 'end', ok: true, exit_code: 200, error: fails ? `ran; failing checks: ${checks.filter((c) => c.level === 'fail').map((c) => c.name).join('; ')}`.slice(0, 400) : null }), signal: AbortSignal.timeout(10_000) });
  } catch { /* the KV record above is the durable one */ }

  return NextResponse.json(result, { status: fails ? 503 : 200 });
}

export async function POST(req: Request) { return GET(req); }
