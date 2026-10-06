// zzz911 — hourly India earnings alert (app job `in-earnings-alert`; replaces the "MC Earnings Alert" Claude task).
// New BLOCKBUSTER / STRONG results from the last 3 days that pass the site's Quality Preset (small & mid caps), each
// company + filing date sent once, all new ones in ONE message, best first. Nothing new → nothing sent.
// GET, secret in the x-cron-secret header. ?dry=1 shows what would be sent without sending or marking anything.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { isRedisAvailable } from '@/lib/kv';
import { notifyOwnerOnceMany, unsentKeys, notifyChannels } from '@/lib/owner-notify';
import { formatHourlyAlert, utcDatesBack, HOURLY_KEY_PREFIX } from '@/lib/india-earnings-alert';
import { collectIndiaAlertHits } from '@/lib/india-earnings-alert-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAYS = 3;

export async function GET(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.reason.includes('not configured') ? 503 : 401 });
  // No KV = no dedup memory: fail closed rather than risk sending the same names every hour.
  if (!isRedisAvailable()) return NextResponse.json({ ok: false, error: 'kv_unavailable' }, { status: 503 });

  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const { hits, scanned } = await collectIndiaAlertHits(utcDatesBack(DAYS), { smallMidOnly: true });
  const keyOf = (alertId: string) => `${HOURLY_KEY_PREFIX}${alertId}`;
  const keys = hits.map((h) => keyOf(h.alert_id));

  if (dry) {
    const unsent = new Set(await unsentKeys(keys));
    const fresh = hits.filter((h) => unsent.has(keyOf(h.alert_id)));
    return NextResponse.json({ ok: true, dry: true, channels: notifyChannels('EARNINGS'), passing: hits.length, new: fresh.map((h) => h.alert_id), scanned, preview: fresh.length ? formatHourlyAlert(fresh) : null });
  }

  const sent = await notifyOwnerOnceMany(keys, (freshKeys) => {
    const set = new Set(freshKeys);
    const fresh = hits.filter((h) => set.has(keyOf(h.alert_id)));
    if (!fresh.length) return null;
    const m = formatHourlyAlert(fresh);
    return { ...m, topic: 'EARNINGS' };
  });

  const base = { ok: true, passing: hits.length, scanned };
  if (!sent) return NextResponse.json({ ...base, new: [], note: 'nothing new' });
  const delivered = sent.telegram === 'sent' || sent.email === 'sent';
  const none = sent.telegram === 'skipped' && sent.email === 'skipped';
  // A channel is set up but every send failed → 502, so the scheduler marks the run failed (keys were released; the
  // next hourly slot tries again). No channel set up at all is not a failure of this job.
  const status = delivered || none ? 200 : 502;
  return NextResponse.json({ ...base, ok: status === 200, new: sent.keys.map((k) => k.slice(HOURLY_KEY_PREFIX.length)), telegram: sent.telegram, email: sent.email, errors: sent.errors }, { status });
}
