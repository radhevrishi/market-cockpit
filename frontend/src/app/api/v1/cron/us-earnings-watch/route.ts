// zzz912 — GET /api/v1/cron/us-earnings-watch: the US earnings alert, run by the app scheduler (job us-earnings-watch).
//
// Replaces two Claude scheduled tasks ("US hours" and "late after-close"). Rules only, no AI:
//   1. grade the latest US results: /api/v1/earnings/graded-us for the last 3 days up to the NEWEST EDGAR filing date —
//      after 17:30 ET that is tomorrow's date, which is where the evening 8-Ks are filed (see edgarFilingDateNow);
//   2. keep BLOCKBUSTER / STRONG names that the US Conviction Beats page would show under its Quality Preset and the
//      under-$30B band (lib/us-earnings-watch.ts);
//   3. send ONE ranked message (Telegram and/or email, lib/owner-notify) with the names not alerted before — each
//      company + filing date is sent once. Nothing new → nothing sent.
// Secret: x-cron-secret header (the app scheduler sends it). ?dry=1 → show what would be sent, send nothing.

import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { internalBase } from '@/lib/internal-base';
import { edgarFilingDateNow } from '@/lib/us-earnings-dates';
import { notifyOwnerOnceEach, unsentKeys, notifyChannels } from '@/lib/owner-notify';
import { pickUsWatchRows, formatUsWatchMessage } from '@/lib/us-earnings-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

const WINDOW_DAYS = 3;
const GRADE_TIMEOUT_MS = 11 * 60_000;   // the grader stops itself at 10 minutes and answers with what it has

export async function GET(req: Request) {
  const auth = verifyCronSecret(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  const date = edgarFilingDateNow();
  const url = `${internalBase(req)}/api/v1/earnings/graded-us?date=${date}&days=${WINDOW_DAYS}`;
  let payload: any = null;
  let status = 0;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(GRADE_TIMEOUT_MS) });
    status = r.status;
    payload = await r.json().catch(() => null);
  } catch (e: any) {
    return NextResponse.json({ ok: false, date, error: `graded-us did not answer: ${e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || e)}` }, { status: 502 });
  }
  if (status !== 200 || !payload?.by_tier) {
    return NextResponse.json({ ok: false, date, error: `graded-us HTTP ${status}: ${String(payload?.error || 'no payload').slice(0, 300)}` }, { status: 502 });
  }

  const picks = pickUsWatchRows(payload);
  const ctx = { date: payload.filing_date || date, windowStart: payload.window_start || null };
  const summary = picks.map((p) => ({ ticker: p.entry.ticker, tier: p.entry.tier, score: p.entry.composite_score, filing_date: p.entry.filing_date, checked: p.state, prelim: !!(p.entry as any).prelim }));

  if (dry) {
    const fresh = new Set(await unsentKeys(picks.map((p) => p.key)));
    const freshPicks = picks.filter((p) => fresh.has(p.key));
    return NextResponse.json({ ok: true, dry: true, date, window_start: ctx.windowStart, passing: summary, would_send: freshPicks.map((p) => p.entry.ticker), message: freshPicks.length ? formatUsWatchMessage(freshPicks, ctx) : null, channels: notifyChannels('EARNINGS') });
  }

  const sent = picks.length
    ? await notifyOwnerOnceEach(picks.map((p) => p.key), (fresh) => {
      const set = new Set(fresh);
      const list = picks.filter((p) => set.has(p.key));
      return list.length ? { ...formatUsWatchMessage(list, ctx), topic: 'EARNINGS' as const } : null;
    })
    : null;
  const delivered = !!sent && (sent.result.telegram === 'sent' || sent.result.email === 'sent');
  const res = {
    ok: !sent || delivered,
    date, window_start: ctx.windowStart,
    graded: { blockbuster: payload.by_tier.BLOCKBUSTER?.length ?? 0, strong: payload.by_tier.STRONG?.length ?? 0, pending: payload.pending?.length ?? 0 },
    passing: summary,
    sent: sent ? sent.keys : [],
    channels: sent ? { telegram: sent.result.telegram, email: sent.result.email } : null,
    errors: sent && !delivered && !sent.result.errors.length ? ['no Telegram or email channel is set up (see lib/owner-notify.ts)'] : (sent?.result.errors ?? []),
  };
  // Nothing delivered while there was something to send → a failure the scheduler records (keys were released; the next slot retries).
  return NextResponse.json(res, { status: res.ok ? 200 : 502 });
}
