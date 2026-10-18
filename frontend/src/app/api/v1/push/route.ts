// zzz1063 — phone / browser push (Web Push, VAPID). PROTECTED (lib/site-auth PROTECTED_API_PREFIXES): login cookie or service key.
// The full contract (routes + payload) is in lib/push/contract.ts.
//   GET  ?view=key       → { ok, publicKey }
//   GET  ?view=devices   → { ok, devices }
//   POST { action: 'subscribe', subscription, label?, replaces? } → { ok, device }   (replaces = old endpoint to swap out)
//   POST { action: 'unsubscribe', endpoint }           → { ok, removed }
//   POST { action: 'test' }                            → { ok, results, sent, failed, line }
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const err = (e: any) => json({ ok: false, error: String(e?.message || e).slice(0, 200) }, /not configured|not available/.test(String(e?.message)) ? 503 : 500);

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get('view') || 'key';
  try {
    const push = await import('@/lib/push/server');
    if (view === 'key') return json({ ok: true, publicKey: (await push.vapidKeys()).publicKey });
    if (view === 'devices') return json({ ok: true, devices: await push.listDevices() });
    return json({ ok: false, error: 'unknown view' }, 400);
  } catch (e) { return err(e); }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid json' }, 400); }
  try {
    const push = await import('@/lib/push/server');
    switch (String(body?.action || '')) {
      case 'subscribe': {
        const label = typeof body.label === 'string' ? body.label.trim() || null : null;
        const replaces = typeof body.replaces === 'string' ? body.replaces.slice(0, 1000) : null;
        const r = await push.subscribe(body.subscription, label, req.headers.get('user-agent'), replaces);
        return r.ok ? json({ ok: true, device: r.device }) : json({ ok: false, error: r.error }, 400);
      }
      case 'unsubscribe': return json({ ok: true, removed: await push.unsubscribe(String(body.endpoint || '')) });
      case 'test': {
        const r = await push.sendPushToAll({
          title: '🔔 Market Cockpit test', body: 'If you see this, price alerts can reach this device.', url: '/price-alerts', tag: 'mc-push-test', eventId: null,
        });
        const { pushLine } = await import('@/lib/alerts/engine');
        return json({ ok: r.state === 'sent', state: r.state, results: r.results, sent: r.results.filter((x) => x.ok).length, failed: r.results.filter((x) => !x.ok).length, line: pushLine(r) });
      }
      default: return json({ ok: false, error: 'unknown action' }, 400);
    }
  } catch (e) { return err(e); }
}
