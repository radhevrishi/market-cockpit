// zzz1054 — price alerts API (PROTECTED: login cookie or service key — lib/site-auth.ts PROTECTED_API_PREFIXES).
//   GET                         → alerts (+ current member count per alert), last check report, notification channels, unread
//   GET ?view=channels          → which owner channels (Telegram / email) are set up on the server (names only)
//   GET ?view=events            → fired alerts, newest first (&limit, &beforeId, &alertId, &ticker, &market=IN|US, &unread=1, &days)
//                                  zzz1063: each event has delivery: { telegram?, email?, push? } = { state, attempts, error, at }
//                                  (state: pending | sending | sent | failed | gave_up | skipped; a channel is absent when not ticked)
//   GET ?view=bell&afterId=N    → unread count + events newer than N (the header bell polls this every 60 s while visible)
//   POST {action:'create', alert}                 → saved alert (201)      — 503 when the database cannot save it
//   POST {action:'update', id, version, alert}    → saved alert            — 409 when it changed elsewhere
//   POST {action:'pause'|'resume', id, version}
//   POST {action:'rearm', id, version}            → zzz1063: new "once" lifecycle (every ticker may fire once more)
//   GET (no view) also has delivery: per channel { pending, sent, failed, gaveUp, skipped, lastError, lastErrorAt, lastSentAt }
//   (last 7 days) and lastDelivery (the last delivery pass in this server process)
//   POST {action:'delete', id}
//   POST {action:'test', id}                      → one TEST event for the first ticker, sent on the alert's channels
//   POST {action:'read', ids:[…] | 'all'}
//   POST {action:'check'}                         → run one check now (ignores market hours; nothing is sent twice)
// Saves are acknowledged only after Postgres committed them; nothing is kept in Redis.
import { NextRequest, NextResponse } from 'next/server';
import { sanitizeAlertInput } from '@/lib/alerts/types';
import {
  listAlerts, getAlert, createAlert, updateAlert, setAlertStatus, deleteAlert, listEvents, unreadSummary, markRead, rearmAlert,
  deliveryFor, deliverySummary,
  AlertStoreUnavailable, AlertConflict, AlertLimit,
  type DeliveryChannel, type ChannelDelivery, type ChannelSummary,
} from '@/lib/alerts/store';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });

/** zzz1063 — per-event delivery for the page: `delivery` = simple state per ticked channel ('sent' | 'pending' | 'failed' |
 *  'skipped'; sending → pending, gave_up → failed) and `deliveryDetail` = { state, attempts, error, at } as stored. */
function eventDelivery(d: Partial<Record<DeliveryChannel, ChannelDelivery>> | undefined) {
  const delivery: Partial<Record<DeliveryChannel, 'sent' | 'pending' | 'failed' | 'skipped'>> = {};
  for (const [ch, v] of Object.entries(d || {}) as Array<[DeliveryChannel, ChannelDelivery]>) {
    delivery[ch] = v.state === 'sending' ? 'pending' : v.state === 'gave_up' ? 'failed' : v.state;
  }
  return { delivery, deliveryDetail: d || {} };
}
/** zzz1063 — per channel: ok unless its latest outcome was an error (an error newer than the last success). */
function channelHealthOf(s: Record<DeliveryChannel, ChannelSummary>) {
  const out: Partial<Record<DeliveryChannel, { ok: boolean; lastError: string | null; lastSentAt: string | null }>> = {};
  for (const [ch, v] of Object.entries(s) as Array<[DeliveryChannel, ChannelSummary]>) {
    const bad = !!v.lastError && (!v.lastSentAt || (v.lastErrorAt || '') > v.lastSentAt);
    out[ch] = { ok: !bad, lastError: bad ? v.lastError : null, lastSentAt: v.lastSentAt };
  }
  return out;
}

function fail(e: any) {
  if (e instanceof AlertStoreUnavailable) return json({ ok: false, saved: false, error: e.message }, 503);
  if (e instanceof AlertConflict) return json({ ok: false, conflict: true, current: e.current, error: e.message }, 409);
  if (e instanceof AlertLimit) return json({ ok: false, error: e.message }, 400);
  return json({ ok: false, error: String(e?.message || e).slice(0, 200) }, 500);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const view = sp.get('view');
    if (view === 'bell') {
      const raw = sp.get('afterId');
      const afterId = raw == null ? -1 : Number(raw);
      const s = await unreadSummary();
      // zzz1063 — &order=asc&limit=N (≤ 100): oldest first after the cursor, hasMore = more after the last one returned, so a
      // client can advance its cursor only through events it actually consumed. Without order=asc: as before (newest 20).
      const asc = sp.get('order') === 'asc';
      const limit = Math.min(100, Math.max(1, Number(sp.get('limit') || 20) || 20));
      let events = Number.isFinite(afterId) && afterId >= 0 && s.latestId > afterId
        ? await listEvents({ afterId, limit: asc ? limit + 1 : limit, order: asc ? 'asc' : 'desc' }) : [];
      const hasMore = asc ? events.length > limit : events.length >= limit && s.latestId > afterId && events.length > 0 && events[events.length - 1].id > afterId + 1;
      if (asc && events.length > limit) events = events.slice(0, limit);
      return json({ ok: true, ...s, events, hasMore, nextCursor: asc && events.length ? events[events.length - 1].id : null });
    }
    if (view === 'channels') {
      await (await import('@/lib/push/server')).activePushCount().catch(() => 0);
      const { notifyChannels } = await import('@/lib/owner-notify');
      return json({ ok: true, channels: notifyChannels('ALERTS') });
    }
    if (view === 'events') {
      const market = sp.get('market');
      const events = await listEvents({
        limit: Number(sp.get('limit') || 100), beforeId: Number(sp.get('beforeId') || 0) || undefined,
        alertId: sp.get('alertId') || undefined, ticker: sp.get('ticker') || undefined,
        market: market === 'IN' || market === 'US' ? market : undefined, unread: sp.get('unread') === '1',
        sinceDays: Number(sp.get('days') || 0) || undefined,
      });
      const del = await deliveryFor(events.map((e) => e.id)).catch(() => null);
      return json({ ok: true, events: events.map((e) => ({ ...e, ...eventDelivery(del?.get(e.id)) })) });
    }
    const alerts = await listAlerts();
    const [{ expandAll }, { lastRunReport }, { notifyChannels }, { lastDeliveryReport }, { activePushCount }] = await Promise.all([
      import('@/lib/alerts/sources'), import('@/lib/alerts/engine'), import('@/lib/owner-notify'), import('@/lib/alerts/delivery'), import('@/lib/push/server'),
    ]);
    await activePushCount().catch(() => 0);
    const delivery = await deliverySummary().catch(() => null);
    const exp = await expandAll(alerts.map((a) => a.target)).catch(() => null);
    const s = await unreadSummary();
    return json({
      ok: true,
      alerts: alerts.map((a, i) => ({ ...a, members: exp ? exp[i].mids.length : null, membersLabel: exp ? exp[i].label : null, membersError: exp ? exp[i].error ?? null : 'lists could not be read' })),
      lastRun: lastRunReport(),
      channels: notifyChannels('ALERTS'),
      channelHealth: delivery ? channelHealthOf(delivery) : null,
      delivery, lastDelivery: lastDeliveryReport(),
      ...s,
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid json' }, 400); }
  const action = String(body?.action || '');
  const id = typeof body?.id === 'string' ? body.id.slice(0, 60) : '';
  const version = Number(body?.version);
  try {
    switch (action) {
      case 'create': {
        const s = sanitizeAlertInput(body.alert);
        if (!s.ok) return json({ ok: false, error: s.error }, 400);
        return json({ ok: true, saved: true, alert: await createAlert(s.alert) }, 201);
      }
      case 'update': {
        if (!id || !Number.isSafeInteger(version)) return json({ ok: false, error: 'id and version required' }, 400);
        const s = sanitizeAlertInput(body.alert);
        if (!s.ok) return json({ ok: false, error: s.error }, 400);
        return json({ ok: true, saved: true, alert: await updateAlert(id, s.alert, version) });
      }
      case 'pause': case 'resume': {
        if (!id || !Number.isSafeInteger(version)) return json({ ok: false, error: 'id and version required' }, 400);
        return json({ ok: true, saved: true, alert: await setAlertStatus(id, action === 'pause' ? 'paused' : 'active', version) });
      }
      case 'rearm': {
        if (!id || !Number.isSafeInteger(version)) return json({ ok: false, error: 'id and version required' }, 400);
        return json({ ok: true, saved: true, alert: await rearmAlert(id, version) });
      }
      case 'delete': {
        if (!id) return json({ ok: false, error: 'id required' }, 400);
        const gone = await deleteAlert(id);
        return json({ ok: gone, saved: gone, error: gone ? undefined : 'not found' }, gone ? 200 : 404);
      }
      case 'test': {
        const a = id ? await getAlert(id) : null;
        if (!a) return json({ ok: false, error: 'not found' }, 404);
        const { testFire } = await import('@/lib/alerts/engine');
        const r = await testFire(a);
        return json({ ok: !!r.event, ...r }, r.event ? 200 : 422);
      }
      case 'test-channels': {
        // zzz1062 — "Send test message": checks Telegram + email delivery without any alert.
        const [{ notifyOwnerVia, notifyDiagnosis }, { testReport }] = await Promise.all([import('@/lib/owner-notify'), import('@/lib/alerts/engine')]);
        const diag = notifyDiagnosis('ALERTS');
        const via = { telegram: diag.telegram.ready, email: diag.email.ready };
        const r = via.telegram || via.email
          ? await notifyOwnerVia({ subject: '🔔 Market Cockpit test message', text: `If you can read this, price alerts can reach you here.\nSent ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`, topic: 'ALERTS' }, via)
          : { telegram: 'skipped' as const, email: 'skipped' as const, errors: [] as string[] };
        return json({ ok: true, notified: { telegram: r.telegram, email: r.email }, report: testReport(r, diag, { telegram: true, email: true }) });
      }
      case 'read': {
        const ids = body.ids === 'all' ? 'all' : Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isSafeInteger) : [];
        return json({ ok: true, marked: await markRead(ids) });
      }
      case 'check': {
        const { runPriceAlerts } = await import('@/lib/alerts/engine');
        return json({ ok: true, report: await runPriceAlerts({ force: true }) });
      }
      default: return json({ ok: false, error: 'unknown action' }, 400);
    }
  } catch (e) { return fail(e); }
}
