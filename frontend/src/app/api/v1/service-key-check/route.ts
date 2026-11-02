// zzz1210 — GET /api/v1/service-key-check (header x-cron-secret) → 200 when the key a GitHub workflow holds is one the app
// accepts, else 401. Workflows call it first (.github/scripts/check-service-key.mjs): with a wrong key the collectors used to
// download everything and fail at the upload with "service key required", several times a day, one e-mail each (FII/DII,
// NSE results, guidance documents, EDGAR backfill, backup — from 29 Oct). Now the FIRST run of the UTC day that finds the
// mismatch fails with the fix written out; later runs that day skip quietly (heartbeat still marked failed), and the owner
// gets one message (Telegram / e-mail when set). Never says which key matched or what any key is.
import { NextRequest, NextResponse } from 'next/server';
import { hasServiceKey } from '@/lib/site-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let lastMark = 0;
export async function GET(req: NextRequest) {
  const k = req.headers.get('x-cron-secret');
  if (hasServiceKey(k)) return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  const job = String(req.nextUrl.searchParams.get('job') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'workflow';
  let firstToday = true;
  // only a request that CARRIES a key counts (a bare probe from the internet changes nothing); one store write per 10 min
  if (k && Date.now() - lastMark > 10 * 60_000) {
    lastMark = Date.now();
    try {
      const { kvSetNX } = await import('@/lib/kv');
      const day = new Date().toISOString().slice(0, 10);
      firstToday = await kvSetNX(`svc-key-mismatch:v1:${day}`, job, 2 * 86400);
      if (firstToday) {
        const { notifyOwnerOnce } = await import('@/lib/owner-notify');
        void notifyOwnerOnce(`svc-key-mismatch:${day}`, {
          topic: 'ALERTS',
          subject: 'GitHub collectors: key does not match the app',
          text: 'The CRON_SECRET saved in GitHub (Settings → Secrets and variables → Actions) is not a key the app accepts, so the FII/DII, NSE results, guidance documents, EDGAR and backup jobs cannot upload. Copy CRON_SECRET from Railway (service → Variables) into the GitHub secret CRON_SECRET. Collectors skip until then.',
        }, 1).catch(() => null);
      }
    } catch { firstToday = true; }
  } else if (k) firstToday = false;
  return NextResponse.json({ ok: false, error: 'key not accepted', firstToday }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}
