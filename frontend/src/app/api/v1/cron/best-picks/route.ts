// zzz1305 — /api/v1/cron/best-picks: the Daily Best Picks email.
//   POST (x-cron-secret)     compose and send once a day (app scheduler job "best-picks", weekdays 13:40 UTC)
//   ?dry=1                   compose only: returns the email (subject, html, text) + the full scoring of every company; sends nothing
//   ?force=1                 send again even if today's email already went out (a test send)
//   ?last=1 (GET)            the last stored run (for the /best-picks page)
// The owner (site login) may run dry / last / a forced test send from the /best-picks page; the scheduler uses the service key.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { siteAuthOk } from '@/lib/site-auth-request';
import { internalBase } from '@/lib/internal-base';
import { kvGet } from '@/lib/kv';
import { runBestPicks, LAST_KEY } from '@/lib/best-picks/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

async function handle(req: Request) {
  const sp = new URL(req.url).searchParams;
  const cron = verifyCronSecret(req).ok;
  if (!cron && !(await siteAuthOk(req))) return NextResponse.json({ ok: false, error: 'owner or service key required' }, { status: 401 });
  if (sp.get('last') === '1') {
    const last = await kvGet<any>(LAST_KEY).catch(() => null);
    return NextResponse.json({ ok: true, last }, { headers: { 'cache-control': 'no-store' } });
  }
  const secret = (process.env.CRON_SECRET || '').trim();
  try {
    const out = await runBestPicks({ base: internalBase(req), secret, dry: sp.get('dry') === '1', force: sp.get('force') === '1' });
    console.log(`[best-picks] ok=${out.ok} dry=${out.dry} quiet=${out.quiet} counts=${JSON.stringify(out.counts)}`);   // counts only
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
