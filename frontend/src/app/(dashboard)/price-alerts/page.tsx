'use client';
// zzz1054 — /price-alerts: every price alert (India + USA) with its state, and the log of what fired.
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { loadAlerts, loadEvents, pauseAlertApi, deleteAlertApi, testAlertApi, markReadApi, checkNowApi, ALERTS_CHANGED_EVENT, type AlertRow, type AlertsPayload } from '@/lib/alerts/client';
import { condLabel, targetKindLabel, triggerLabel, type AlertEvent, type PriceAlert } from '@/lib/alerts/types';
import { chartListOptions } from '@/lib/alerts/chart-lists';

const CreateAlertDialog = dynamic(() => import('@/components/alerts/CreateAlertDialog'), { ssr: false });

const CSS = `
.pa{max-width:1200px;margin:0 auto;color:#111827}
.pa-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:14px}
.pa h1{font-size:22px;margin:0;font-weight:800;color:#111827}
.pa-lede{color:#4b5563;font-size:13px;margin:4px 0 0}
.pa-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:14px}
.pa-btn{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:600;font-size:13px}
.pa-btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.pa-btn.sm{padding:3px 8px;font-size:12px}
.pa-btn:disabled{opacity:.6}
.pa-chips{display:flex;gap:8px;flex-wrap:wrap}
.pa-chip{border:1px solid #e5e7eb;border-radius:999px;padding:3px 10px;font-size:12px;background:#f9fafb;color:#374151;cursor:pointer}
.pa-chip[aria-pressed=true]{background:#2563eb;color:#fff;border-color:#2563eb}
.pa table{width:100%;border-collapse:collapse;font-size:13px}
.pa th{text-align:left;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;padding:6px 8px;white-space:nowrap}
.pa td{border-bottom:1px solid #f3f4f6;padding:7px 8px;vertical-align:top}
.pa-wrap{overflow-x:auto}
.pa-st{font-weight:700;font-size:12px}
.pa-st.active{color:#15803d}.pa-st.paused{color:#b45309}.pa-st.triggered{color:#2563eb}.pa-st.expired{color:#6b7280}
.pa-sub{color:#6b7280;font-size:12px}
.pa-err{color:#b91c1c;font-size:12px}
.pa-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.pa-ctl input,.pa-ctl select{border:1px solid #d1d5db;border-radius:8px;padding:5px 8px;font-size:13px;background:#fff;color:#111827}
.pa-unread{background:#eff6ff}
`;

function fmtTime(iso: string | null) { return iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

export default function PriceAlertsPage() {
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | PriceAlert['status']>('all');
  const [evMarket, setEvMarket] = useState<'' | 'IN' | 'US'>('');
  const [evAlert, setEvAlert] = useState('');
  const [evTicker, setEvTicker] = useState('');
  const [evUnread, setEvUnread] = useState(false);
  const [moreEnd, setMoreEnd] = useState(false);
  const [dialog, setDialog] = useState<{ editing: PriceAlert | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => { setData(await loadAlerts()); }, []);
  const refreshEvents = useCallback(async (beforeId?: number) => {
    const r = await loadEvents({ limit: 100, market: evMarket || undefined, alertId: evAlert || undefined, ticker: evTicker.trim() || undefined, unread: evUnread ? 1 : undefined, beforeId });
    setEvErr(r.ok ? null : r.error || 'could not load');
    setEvents((cur) => (beforeId ? [...cur, ...r.events] : r.events));
    setMoreEnd(r.events.length < 100);
  }, [evMarket, evAlert, evTicker, evUnread]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshEvents(); }, [refreshEvents]);
  useEffect(() => {
    const h = () => { void refresh(); void refreshEvents(); };
    window.addEventListener(ALERTS_CHANGED_EVENT, h);
    return () => window.removeEventListener(ALERTS_CHANGED_EVENT, h);
  }, [refresh, refreshEvents]);

  const alerts = useMemo(() => data?.alerts || [], [data]);
  const counts = useMemo(() => {
    const c = { active: 0, paused: 0, triggered: 0, expired: 0 } as Record<PriceAlert['status'], number>;
    for (const a of alerts) c[a.status]++;
    return c;
  }, [alerts]);
  const shown = statusFilter === 'all' ? alerts : alerts.filter((a) => a.status === statusFilter);
  const chartLists = useMemo(() => chartListOptions(), [dialog]);   // re-read when the dialog opens

  async function act(a: AlertRow, kind: 'pause' | 'resume' | 'delete' | 'test') {
    setBusy(a.id); setNote(null);
    if (kind === 'delete') {
      if (!window.confirm(`Delete “${a.name}”? Its fired history stays in the log.`)) { setBusy(null); return; }
      const r = await deleteAlertApi(a.id); if (!r.ok) setNote(`Not deleted: ${r.error}`);
    } else if (kind === 'test') {
      const r = await testAlertApi(a.id);
      setNote(r.ok ? `Test sent${r.notified ? ` (Telegram: ${r.notified.telegram}, email: ${r.notified.email})` : ''}.` : `Test failed: ${r.error}`);
    } else {
      const r = await pauseAlertApi(a.id, a.version, kind === 'pause');
      if (!r.ok) setNote(r.conflict ? 'Changed in another tab — reloaded.' : `Not saved: ${r.error}`);
    }
    setBusy(null);
    void refresh();
  }

  const lastRun = data?.lastRun;
  return (
    <div className="pa">
      <style>{CSS}</style>
      <div className="pa-head">
        <div>
          <h1>🔔 Price alerts</h1>
          <p className="pa-lede">India + USA. An alert watches one ticker or a whole list (it follows the list&apos;s current members). Checked every minute while each market is open; nothing is sent twice.</p>
          <p className="pa-sub" style={{ marginTop: 4 }}>
            {lastRun ? <>Last check {fmtTime(lastRun.at)} · {lastRun.ok ? `${lastRun.tickers ?? 0} tickers, ${lastRun.fired ?? 0} fired${lastRun.waiting ? `, ${lastRun.waiting} waiting for data` : ''}${lastRun.capped ? ' · ticker cap reached' : ''}` : <span className="pa-err">failed: {lastRun.error}</span>}</> : 'No check on this server copy yet (checks run only while a market is open).'}
            {data?.channels && <> · Telegram {data.channels.telegram ? 'set up' : 'not set up'} · Email {data.channels.email ? 'set up' : 'not set up'}</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="pa-btn" disabled={busy === 'check'} onClick={async () => { setBusy('check'); const r = await checkNowApi(); setBusy(null); setNote(r?.ok ? `Checked: ${r.tickers ?? 0} tickers in open sessions, ${r.fired ?? 0} fired.` : `Check failed: ${r?.error || 'error'}`); void refresh(); }}>Check now</button>
          <button type="button" className="pa-btn pri" onClick={() => setDialog({ editing: null })}>+ Create alert</button>
        </div>
      </div>
      {note && <div className="pa-card" role="status" style={{ padding: '8px 12px' }}>{note}</div>}
      {data && !data.ok && <div className="pa-card pa-err" role="alert">Alerts could not be loaded: {data.error}</div>}

      <div className="pa-card">
        <div className="pa-ctl">
          <div className="pa-chips" role="group" aria-label="Filter alerts by status">
            {(['all', 'active', 'paused', 'triggered', 'expired'] as const).map((s) => (
              <button key={s} type="button" className="pa-chip" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? `All ${alerts.length}` : `${s[0].toUpperCase()}${s.slice(1)} ${counts[s]}`}
              </button>
            ))}
          </div>
        </div>
        <div className="pa-wrap">
          <table>
            <thead><tr><th>Alert</th><th>On</th><th>Conditions</th><th>Trigger</th><th>Expires</th><th>Status</th><th>Fired</th><th /></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={8} className="pa-sub">Loading…</td></tr>
                : shown.length === 0 ? <tr><td colSpan={8} className="pa-sub">No alerts{statusFilter !== 'all' ? ` with status ${statusFilter}` : ''}. Use “+ Create alert”, or the 🔔 button on a chart watchlist or on /watchlists.</td></tr>
                : shown.map((a) => (
                  <tr key={a.id}>
                    <td><b>{a.name}</b><div className="pa-sub" title="Message template">{a.message}</div></td>
                    <td>{targetKindLabel(a.target.kind)}{a.target.kind !== 'watchlist' && a.target.kind !== 'book-in' && a.target.kind !== 'book-us' && a.target.kind !== 'cb-in' && a.target.kind !== 'cb-us' ? <>: <b>{a.membersLabel || a.target.label || a.target.id}</b></> : null}
                      <div className="pa-sub">{a.members != null ? `${a.members} ticker${a.members === 1 ? '' : 's'} now` : ''}</div>
                      {a.membersError && <div className="pa-err">{a.membersError}</div>}</td>
                    <td>{a.conditions.map((c, i) => <div key={i}>{condLabel(c, a.interval)}</div>)}</td>
                    <td>{triggerLabel(a.trigger)}<div className="pa-sub">{a.interval === 'W' ? '1 week' : '1 day'} · {a.session}</div></td>
                    <td>{a.expiresAt ? fmtTime(a.expiresAt) : 'Open-ended'}</td>
                    <td><span className={`pa-st ${a.status}`}>{a.status}</span></td>
                    <td>{a.fireCount}<div className="pa-sub">{a.lastFiredAt ? fmtTime(a.lastFiredAt) : 'never'}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="pa-btn sm" disabled={busy === a.id} onClick={() => setDialog({ editing: a })}>Edit</button>{' '}
                      {a.status === 'active' ? <button type="button" className="pa-btn sm" disabled={busy === a.id} onClick={() => void act(a, 'pause')}>Pause</button>
                        : <button type="button" className="pa-btn sm" disabled={busy === a.id} title={a.status === 'paused' ? 'Start checking again' : 'Start checking again (change the expiry first if it has passed)'} onClick={() => void act(a, 'resume')}>Resume</button>}{' '}
                      <button type="button" className="pa-btn sm" disabled={busy === a.id} title="Send a test alert for the first ticker on the alert's channels" onClick={() => void act(a, 'test')}>Test</button>{' '}
                      <button type="button" className="pa-btn sm" disabled={busy === a.id} onClick={() => void act(a, 'delete')}>Delete</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pa-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <b style={{ fontSize: 15 }}>Alert log {data ? <span className="pa-sub">· {data.unread} unread</span> : null}</b>
          <button type="button" className="pa-btn sm" onClick={async () => { await markReadApi('all'); void refreshEvents(); void refresh(); }}>Mark all read</button>
        </div>
        <div className="pa-ctl">
          <select aria-label="Market" value={evMarket} onChange={(e) => setEvMarket(e.target.value as '' | 'IN' | 'US')}><option value="">India + USA</option><option value="IN">India</option><option value="US">USA</option></select>
          <select aria-label="Alert" value={evAlert} onChange={(e) => setEvAlert(e.target.value)}><option value="">All alerts</option>{alerts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input aria-label="Ticker" placeholder="Ticker" value={evTicker} onChange={(e) => setEvTicker(e.target.value.toUpperCase())} style={{ width: 110 }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={evUnread} onChange={(e) => setEvUnread(e.target.checked)} /> Unread only</label>
          <span className="pa-sub">Kept 180 days.</span>
        </div>
        {evErr && <div className="pa-err">Log could not be loaded: {evErr}</div>}
        <div className="pa-wrap">
          <table>
            <thead><tr><th>Time</th><th>Ticker</th><th>Message</th><th>Price</th><th>Change</th><th>Alert</th></tr></thead>
            <tbody>
              {events.length === 0 ? <tr><td colSpan={6} className="pa-sub">Nothing fired{evMarket || evAlert || evTicker || evUnread ? ' for these filters' : ' yet'}.</td></tr>
                : events.map((e) => (
                  <tr key={e.id} className={e.read ? undefined : 'pa-unread'}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(e.firedAt)}</td>
                    <td><a href={`/charts?t=${encodeURIComponent(e.ticker)}&m=${e.market}${e.mid.startsWith('IN:BSE:') ? '&x=BSE' : ''}`} style={{ color: '#2563eb', fontWeight: 700 }}>{e.ticker}</a><div className="pa-sub">{e.market === 'IN' ? 'India' : 'USA'}{e.name ? ` · ${e.name}` : ''}</div></td>
                    <td>{e.message}<div className="pa-sub">{e.condition}</div></td>
                    <td>{e.price != null ? `${e.market === 'IN' ? '₹' : '$'}${e.price.toFixed(2)}` : '—'}</td>
                    <td style={{ color: e.changePct == null ? undefined : e.changePct >= 0 ? '#15803d' : '#b91c1c' }}>{e.changePct != null ? `${e.changePct >= 0 ? '+' : ''}${e.changePct.toFixed(2)}%` : '—'}</td>
                    <td>{e.alertName}{e.list ? <div className="pa-sub">{e.list}</div> : null}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!moreEnd && events.length > 0 && <button type="button" className="pa-btn sm" style={{ marginTop: 8 }} onClick={() => void refreshEvents(events[events.length - 1].id)}>Load older</button>}
      </div>

      {dialog && <CreateAlertDialog editing={dialog.editing} chartLists={chartLists} onClose={() => setDialog(null)} onSaved={() => { setNote('Saved.'); void refresh(); }} />}
    </div>
  );
}
