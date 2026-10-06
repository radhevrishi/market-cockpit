// zzz913 — DAILY GAINERS BRIEF (India), composed from the stored research and sent to the owner.
//
// POST|GET /api/v1/cron/gainers-brief?final=0|1[&dry=1]      header: x-cron-secret
//   final=0  send only when today's research sweep is complete; otherwise answer "defer" (a later slot sends)
//   final=1  send whatever exists; an incomplete sweep is sent marked PARTIAL (never silence)
//   dry=1    compose and return the brief without sending (for checking the wording)
// Scheduled by the app (lib/app-scheduler.ts job `gainers-brief-in`); hand run: .github/workflows/gainers-brief.yml.
// No model call, no upstream fetch: it reads /api/v1/ai-gainers/research (the stored sweep) and earlier sessions' stored
// boards for new / sustained / dropped. Sent once per session date (owner-notify memory key gainers-brief:IN:<date>).
import { NextRequest, NextResponse } from 'next/server';
import { secretFromRequest } from '@/lib/request-secret';
import { internalBase } from '@/lib/internal-base';
import { kvMGet } from '@/lib/kv';
import { notifyOwnerOnce, notifyChannels } from '@/lib/owner-notify';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import { isNseHolidayDate } from '@/lib/market-hours';
import { indiaSession } from '@/lib/ai-gainers/screener-gainers';
import { briefDecision, composeBrief, previousSessionDates, researchStateKey, boardTickersOf, type BriefResearch, type BoardHistoryEntry } from '@/lib/gainers-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HISTORY_SESSIONS = 6;

async function handle(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured; endpoint disabled' }, { status: 503 });
  if (secretFromRequest(req) !== expected) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const final = sp.get('final') === '1';
  const dry = sp.get('dry') === '1';
  await warmNseHolidays();
  const session = indiaSession();

  // the stored research (same JSON the AI Daily Gainers page reads)
  let research: BriefResearch | null = null;
  let researchError: string | null = null;
  try {
    const r = await fetch(`${internalBase(req)}/api/v1/ai-gainers/research?market=IN`, { headers: { 'x-cron-secret': expected }, cache: 'no-store', signal: AbortSignal.timeout(90_000) });
    const j: any = await r.json().catch(() => null);
    if (r.ok && j?.ok) research = { ...j, session: j.session || session };
    else researchError = `research store answered HTTP ${r.status}`;
  } catch (e: any) { researchError = `research store did not answer (${e?.name === 'TimeoutError' ? 'timeout' : 'error'})`; }

  const date = research?.date || session.date;
  const decision = briefDecision(research || { session, coverage: null, remaining: undefined }, final);
  const coverage = research?.coverage ? `${research.coverage.researched}/${research.coverage.total}` : '0/0';
  if (decision === 'skip_no_session' || (decision === 'defer' && !dry)) {
    return NextResponse.json({ ok: true, decision, sent: false, date, coverage, note: decision === 'defer' ? 'sweep not complete yet; a later slot sends' : 'no NSE session today' });
  }

  // earlier sessions' boards, newest first (a missing store stops the "in a row" count there)
  const prevDates = previousSessionDates(date, HISTORY_SESSIONS, isNseHolidayDate);
  let history: BoardHistoryEntry[] = prevDates.map((d) => ({ date: d, tickers: null }));
  try {
    const states = await kvMGet<any>(prevDates.map((d) => researchStateKey('IN', d)));
    history = prevDates.map((d, i) => ({ date: d, tickers: boardTickersOf(states[i]) }));
  } catch { /* history is optional: the brief says it is not stored */ }

  const partial = decision === 'send_partial';
  const note = partial
    ? (researchError ? `${researchError}; nothing could be ranked.` : !research?.coverage?.total ? 'no research sweep was stored for this session (the GitHub run and the app backup both missed it).' : `the research sweep covered ${coverage} names by the last send time.`)
    : null;
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://market-cockpit-production.up.railway.app';
  const brief = composeBrief(research, { date, partial, history, appUrl, note });
  if (dry) return NextResponse.json({ ok: true, decision, dry: true, date, coverage, subject: brief.subject, text: brief.text, html: brief.html });

  const res = await notifyOwnerOnce(`gainers-brief:IN:${date}`, { subject: brief.subject, text: brief.text, html: brief.html, topic: 'BRIEF' });
  if (res === null) return NextResponse.json({ ok: true, decision, sent: false, already: true, date, coverage });
  const delivered = res.telegram === 'sent' || res.email === 'sent';
  // 503 = not delivered (no channel set up, or every channel refused) — the scheduler marks the heartbeat failed, and the
  // send-once key was released, so the next slot (or a hand run) tries again.
  return NextResponse.json({ ok: delivered, decision, sent: delivered, date, coverage, partial, channels: { telegram: res.telegram, email: res.email }, configured: notifyChannels('BRIEF'), errors: res.errors }, { status: delivered ? 200 : 503 });
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }
