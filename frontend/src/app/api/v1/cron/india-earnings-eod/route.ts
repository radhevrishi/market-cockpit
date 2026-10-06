// zzz911 — India earnings evening check-in (app job `in-earnings-eod`; replaces the "Earnings Watch — EOD" Claude task).
// ALWAYS one message per weekday (sent once per India date): a health line (how many India filings were graded today,
// how many cleared the preset) and today's names that cleared it, best first. A missing evening message is the signal
// that something needs a look.
// GET, secret in the x-cron-secret header. ?dry=1 shows the message without sending it.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { isRedisAvailable } from '@/lib/kv';
import { notifyOwnerOnce, notifyChannels } from '@/lib/owner-notify';
import { formatEodDigest, istDate, EOD_KEY_PREFIX } from '@/lib/india-earnings-alert';
import { collectIndiaAlertHits } from '@/lib/india-earnings-alert-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.reason.includes('not configured') ? 503 : 401 });
  if (!isRedisAvailable()) return NextResponse.json({ ok: false, error: 'kv_unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const dry = sp.get('dry') === '1';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') || '') ? sp.get('date')! : istDate();
  const { hits, scanned } = await collectIndiaAlertHits([date], { smallMidOnly: true });
  const day = scanned[0];
  const m = formatEodDigest({ dateIst: date, graded: !!day?.key, candidatesTotal: day?.candidates_total ?? day?.rows ?? null, hits });

  if (dry) return NextResponse.json({ ok: true, dry: true, date, channels: notifyChannels('EARNINGS'), cleared: hits.map((h) => h.alert_id), scanned, preview: m });

  const sent = await notifyOwnerOnce(`${EOD_KEY_PREFIX}${date}`, { ...m, topic: 'EARNINGS' });
  if (!sent) return NextResponse.json({ ok: true, date, note: 'already sent for this date' });
  const delivered = sent.telegram === 'sent' || sent.email === 'sent';
  const none = sent.telegram === 'skipped' && sent.email === 'skipped';
  const status = delivered || none ? 200 : 502;
  return NextResponse.json({ ok: status === 200, date, cleared: hits.map((h) => h.alert_id), telegram: sent.telegram, email: sent.email, errors: sent.errors }, { status });
}
