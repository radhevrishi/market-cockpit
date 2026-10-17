'use client';
// zzz1054 — /price-alerts: every price alert (India + USA) with its state, and the log of what fired.
// zzz1064 — friendlier: a summary strip (active, fired today, unread, last check, and whether Phone / Email / Telegram are
// working), the "📱 Phone notifications" switch for this device at the top, alerts as cards on a phone, log tickers open the
// chart (NSE vs BSE kept), test fires hidden unless asked for, "Rearm" for a one-time alert that already fired, and ✓ / ✗ per
// channel in the log when the server records delivery. Light page whatever the screen theme.
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  loadAlerts, loadEvents, pauseAlertApi, deleteAlertApi, testAlertApi, testChannelsApi, markReadApi, checkNowApi, rearmAlertApi,
  isTestEvent, chartHrefFor, channelStatus, eventDelivery, ALERTS_CHANGED_EVENT, type AlertRow, type AlertsPayload, type ChannelStatus,
} from '@/lib/alerts/client';
import { condLabel, targetKindLabel, triggerLabel, type AlertEvent, type PriceAlert } from '@/lib/alerts/types';
import { chartListOptions } from '@/lib/alerts/chart-lists';
import PhoneNotifications from '@/components/alerts/PhoneNotifications';

const CreateAlertDialog = dynamic(() => import('@/components/alerts/CreateAlertDialog'), { ssr: false });

const CSS = `
.pa{max-width:1200px;margin:0 auto;color:#111827;background:#f8fafc;padding:16px;min-height:100%;box-sizing:border-box}
.pa *{box-sizing:border-box}
.pa-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:14px}
.pa h1{font-size:22px;margin:0;font-weight:800;color:#111827}
.pa-lede{color:#4b5563;font-size:13px;margin:4px 0 0;line-height:1.45}
.pa-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:14px}
.pa-btn{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:7px 12px;cursor:pointer;font-weight:600;font-size:13px;min-height:36px}
.pa-btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.pa-btn.sm{padding:4px 9px;font-size:12px;min-height:30px}
.pa-btn:disabled{opacity:.6}
.pa-chips{display:flex;gap:8px;flex-wrap:wrap}
.pa-chip{border:1px solid #e5e7eb;border-radius:999px;padding:4px 11px;font-size:12px;background:#f9fafb;color:#374151;cursor:pointer}
.pa-chip[aria-pressed=true]{background:#2563eb;color:#fff;border-color:#2563eb}
.pa-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.pa-tile{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;min-width:0}
.pa-tile b{display:block;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:#111827}
.pa-tile span{font-size:12px;color:#4b5563}
.pa-tile.alert{border-color:#fecaca;background:#fef2f2}
.pa-tile.alert b{color:#b91c1c}
.pa-chan{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.pa-ch{display:flex;gap:6px;align-items:center;border:1px solid #e5e7eb;background:#fff;border-radius:10px;padding:6px 10px;font-size:13px;min-width:0;max-width:100%}
.pa-ch i{font-style:normal;color:#4b5563;overflow-wrap:anywhere}
.pa-ch .dot{width:9px;height:9px;border-radius:50%;flex:none}
.pa table{width:100%;border-collapse:collapse;font-size:13px}
.pa th{text-align:left;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;padding:6px 8px;white-space:nowrap}
.pa td{border-bottom:1px solid #f3f4f6;padding:7px 8px;vertical-align:top}
.pa-wrap{overflow-x:auto}
.pa-st{font-weight:700;font-size:12px}
.pa-st.active{color:#15803d}.pa-st.paused{color:#b45309}.pa-st.triggered{color:#2563eb}.pa-st.expired{color:#6b7280}
.pa-sub{color:#6b7280;font-size:12px}
.pa-err{color:#b91c1c;font-size:12px}
.pa-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.pa-ctl input,.pa-ctl select{border:1px solid #d1d5db;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff;color:#111827;min-width:0;max-width:100%}
.pa-unread{background:#eff6ff}
.pa-tk{color:#2563eb;font-weight:800;text-decoration:none}
.pa-tk:hover{text-decoration:underline}
.pa-del{font-size:11px;font-weight:700;margin-right:6px}
.pa-del.ok{color:#15803d}.pa-del.bad{color:#b91c1c}
.pa-acts{display:flex;gap:6px;flex-wrap:wrap}
@media (max-width:700px){
  .pa{padding:12px}
  .pa h1{font-size:20px}
  .pa-head>div:last-child{width:100%}
  .pa-head>div:last-child .pa-btn{flex:1 1 auto}
  .pa-cards thead{display:none}
  .pa-cards,.pa-cards tbody,.pa-cards tr,.pa-cards td{display:block;width:100%}
  .pa-cards tr{border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;margin-bottom:10px;background:#fff}
  .pa-cards tr.pa-unread{background:#eff6ff;border-color:#bfdbfe}
  .pa-cards td{border:none;padding:3px 0;display:flex;gap:10px;justify-content:space-between;align-items:flex-start;text-align:right;overflow-wrap:anywhere}
  .pa-cards td::before{content:attr(data-label);color:#6b7280;font-size:12px;font-weight:600;text-align:left;flex:none;min-width:70px}
  .pa-cards td.pa-main{display:block;text-align:left;font-size:14px}
  .pa-cards td.pa-main::before{content:none}
  .pa-cards td.pa-acts-cell{justify-content:flex-start}
  .pa-cards td.pa-acts-cell::before{content:none}
  .pa-wrap{overflow-x:visible}
  .pa-card{padding:12px}
}
`;

function fmtTime(iso: string | null) { return iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
const sameLocalDay = (iso: string, d = new Date()) => { const x = new Date(iso); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
const CH_COLOR: Record<ChannelStatus['state'], string> = { working: '#16a34a', 'not-set-up': '#9ca3af', failing: '#dc2626', unknown: '#9ca3af' };
const CH_WORD: Record<ChannelStatus['state'], string> = { working: 'working', 'not-set-up': 'not set up', failing: 'failing', unknown: 'see below' };
const CH_NAME: Record<string, string> = { telegram: 'Telegram', email: 'Email', push: 'Phone', app: 'App', toast: 'Toast', browser: 'Browser' };

export default function PriceAlertsPage() {
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | PriceAlert['status']>('all');
  const [evMarket, setEvMarket] = useState<'' | 'IN' | 'US'>('');
  const [evAlert, setEvAlert] = useState('');
  const [evTicker, setEvTicker] = useState('');
  const [evUnread, setEvUnread] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [moreEnd, setMoreEnd] = useState(false);
  const [today, setToday] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ editing: PriceAlert | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rearmMissing, setRearmMissing] = useState(false);

  const refresh = useCallback(async () => { setData(await loadAlerts()); }, []);
  const refreshEvents = useCallback(async (beforeId?: number) => {
    const r = await loadEvents({ limit: 100, market: evMarket || undefined, alertId: evAlert || undefined, ticker: evTicker.trim() || undefined, unread: evUnread ? 1 : undefined, beforeId });
    setEvErr(r.ok ? null : r.error || 'could not load');
    setEvents((cur) => (beforeId ? [...cur, ...r.events] : r.events));
    setMoreEnd(r.events.length < 100);
  }, [evMarket, evAlert, evTicker, evUnread]);
  const refreshToday = useCallback(async () => {
    const r = await loadEvents({ limit: 500, days: 1 });
    setToday(r.ok ? r.events.filter((e) => !isTestEvent(e) && sameLocalDay(e.firedAt)).length : null);
  }, []);

  useEffect(() => { const t = window.setTimeout(() => { void refresh(); void refreshToday(); }, 0); return () => window.clearTimeout(t); }, [refresh, refreshToday]);
  useEffect(() => { const t = window.setTimeout(() => { void refreshEvents(); }, 0); return () => window.clearTimeout(t); }, [refreshEvents]);
  useEffect(() => {
    const h = () => { void refresh(); void refreshEvents(); void refreshToday(); };
    window.addEventListener(ALERTS_CHANGED_EVENT, h);
    return () => window.removeEventListener(ALERTS_CHANGED_EVENT, h);
  }, [refresh, refreshEvents, refreshToday]);
  // the bell's "Open log" lands on #log; scroll there once the log has rendered
  useEffect(() => {
    if (typeof window === 'undefined' || !/^#(log|phone)$/.test(window.location.hash)) return;
    const t = window.setTimeout(() => { document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' }); }, 300);
    return () => window.clearTimeout(t);
  }, []);

  const alerts = useMemo(() => data?.alerts || [], [data]);
  const counts = useMemo(() => {
    const c = { active: 0, paused: 0, triggered: 0, expired: 0 } as Record<PriceAlert['status'], number>;
    for (const a of alerts) c[a.status]++;
    return c;
  }, [alerts]);
  const shown = statusFilter === 'all' ? alerts : alerts.filter((a) => a.status === statusFilter);
  const shownEvents = showTests ? events : events.filter((e) => !isTestEvent(e));
  const hiddenTests = events.length - shownEvents.length;
  const chartLists = useMemo(() => chartListOptions(), [dialog]);   // re-read when the dialog opens

  async function act(a: AlertRow, kind: 'pause' | 'resume' | 'delete' | 'test' | 'rearm') {
    setBusy(a.id); setNote(null);
    if (kind === 'delete') {
      if (!window.confirm(`Delete “${a.name}”? Its fired history stays in the log.`)) { setBusy(null); return; }
      const r = await deleteAlertApi(a.id); if (!r.ok) setNote(`Not deleted: ${r.error}`);
    } else if (kind === 'test') {
      const r = await testAlertApi(a.id);
      setNote(r.ok ? ['Test alert saved to the log.', ...(r.report || [])].join('\n') : `Test failed: ${r.error}`);
    } else if (kind === 'rearm') {
      const r = await rearmAlertApi(a.id, a.version);
      if (r.unsupported) { setRearmMissing(true); setNote('Rearm is not available on the server yet. Use “Resume” for now.'); }
      else setNote(r.ok ? `“${a.name}” is armed again — it can fire once more for every ticker.` : r.conflict ? 'Changed in another tab — reloaded.' : `Not rearmed: ${r.error}`);
    } else {
      const r = await pauseAlertApi(a.id, a.version, kind === 'pause');
      if (!r.ok) setNote(r.conflict ? 'Changed in another tab — reloaded.' : `Not saved: ${r.error}`);
    }
    setBusy(null);
    void refresh();
  }

  const lastRun = data?.lastRun;
  const chans: Array<{ key: 'push' | 'email' | 'telegram'; label: string; st: ChannelStatus }> = data?.ok
    ? [
      { key: 'push', label: '📱 Phone', st: channelStatus('push', data) },
      { key: 'email', label: '✉️ Email', st: channelStatus('email', data) },
      { key: 'telegram', label: '✈️ Telegram', st: channelStatus('telegram', data) },
    ]
    : [];

  return (
    <div className="pa">
      <style>{CSS}</style>
      <div className="pa-head">
        <div style={{ minWidth: 0 }}>
          <h1>🔔 Price alerts</h1>
          <p className="pa-lede">India + USA. An alert watches one ticker or a whole list (it follows the list&apos;s current members). Checked every minute while each market is open; nothing is sent twice.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="pa-btn pri" onClick={() => setDialog({ editing: null })}>+ Create alert</button>
          <button type="button" className="pa-btn" disabled={busy === 'check'} title="Run one check now (ignores market hours; nothing is sent twice)" onClick={async () => { setBusy('check'); const r = await checkNowApi(); setBusy(null); setNote(r?.ok ? `Checked: ${r.tickers ?? 0} tickers in open sessions, ${r.fired ?? 0} fired.` : `Check failed: ${r?.error || 'error'}`); void refresh(); }}>{busy === 'check' ? 'Checking…' : 'Check now'}</button>
          <button type="button" className="pa-btn" disabled={busy === 'channels'} title="Sends one test message to Telegram and email (whichever are set up) and says exactly what went wrong if it fails" onClick={async () => { setBusy('channels'); setNote(null); const r = await testChannelsApi(); setBusy(null); setNote(r.ok ? (r.report || []).join('\n') : `Test failed: ${r.error}`); }}>{busy === 'channels' ? 'Sending…' : 'Test email / Telegram'}</button>
        </div>
      </div>

      {/* summary strip */}
      <div className="pa-sum" aria-label="Summary">
        <div className="pa-tile"><b>{data ? counts.active : '…'}</b><span>active alert{counts.active === 1 ? '' : 's'}{data && counts.triggered ? ` · ${counts.triggered} done` : ''}</span></div>
        <div className="pa-tile"><b>{today ?? '…'}</b><span>fired today</span></div>
        <a href="#log" className={`pa-tile${data && data.unread > 0 ? ' alert' : ''}`} style={{ textDecoration: 'none' }} onClick={() => setEvUnread(!!data && data.unread > 0)}><b>{data ? data.unread : '…'}</b><span>unread — tap to see</span></a>
        <div className="pa-tile"><b style={{ fontSize: 15, paddingTop: 5 }}>{lastRun ? fmtTime(lastRun.at) : '—'}</b>
          <span>{lastRun ? (lastRun.ok ? `last check · ${lastRun.tickers ?? 0} tickers${lastRun.waiting ? `, ${lastRun.waiting} waiting for data` : ''}` : <span className="pa-err">last check failed: {lastRun.error}</span>) : 'no check yet (runs while a market is open)'}</span></div>
      </div>
      {chans.length > 0 && (
        <div className="pa-chan" aria-label="Where alerts are sent">
          {chans.map((c) => (
            <span key={c.key} className="pa-ch" title={c.st.reason || ''}>
              <span className="dot" style={{ background: CH_COLOR[c.st.state] }} aria-hidden />
              <b>{c.label}</b> <i>{CH_WORD[c.st.state]}{c.st.reason ? `: ${c.st.reason}` : ''}</i>
            </span>
          ))}
        </div>
      )}

      <PhoneNotifications />

      {note && <div className="pa-card" role="status" style={{ padding: '8px 12px', whiteSpace: 'pre-line' }}>{note}</div>}
      {data && !data.ok && <div className="pa-card pa-err" role="alert">Alerts could not be loaded: {data.error}</div>}

      <div className="pa-card">
        <div className="pa-ctl">
          <b style={{ fontSize: 15, marginRight: 4 }}>My alerts</b>
          <div className="pa-chips" role="group" aria-label="Filter alerts by status">
            {(['all', 'active', 'paused', 'triggered', 'expired'] as const).map((s) => (
              <button key={s} type="button" className="pa-chip" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? `All ${alerts.length}` : `${s === 'triggered' ? 'Done' : `${s[0].toUpperCase()}${s.slice(1)}`} ${counts[s]}`}
              </button>
            ))}
          </div>
        </div>
        <div className="pa-wrap">
          <table className="pa-cards">
            <thead><tr><th>Alert</th><th>On</th><th>Conditions</th><th>Trigger</th><th>Expires</th><th>Status</th><th>Fired</th><th /></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={8} className="pa-sub pa-main">Loading…</td></tr>
                : shown.length === 0 ? <tr><td colSpan={8} className="pa-sub pa-main">No alerts{statusFilter !== 'all' ? ` with status ${statusFilter}` : ''}. Use “+ Create alert”, or the 🔔 button on a chart watchlist or on /watchlists.</td></tr>
                : shown.map((a) => (
                  <tr key={a.id}>
                    <td className="pa-main"><b>{a.name}</b><div className="pa-sub" title="Message template">{a.message}</div></td>
                    <td data-label="On"><span>{targetKindLabel(a.target.kind)}{a.target.kind === 'ticker' || a.target.kind === 'chart-list' ? <>: <b>{a.membersLabel || a.target.label || a.target.id}</b></> : null}
                      {a.target.kind === 'ticker' && a.target.id?.startsWith('IN:BSE:') ? <span className="pa-sub"> (BSE)</span> : null}
                      <span className="pa-sub" style={{ display: 'block' }}>{a.members != null ? `${a.members} ticker${a.members === 1 ? '' : 's'} now` : ''}</span>
                      {a.membersError && <span className="pa-err" style={{ display: 'block' }}>{a.membersError}</span>}</span></td>
                    <td data-label="When"><span>{a.conditions.map((c, i) => <span key={i} style={{ display: 'block' }}>{condLabel(c, a.interval)}</span>)}</span></td>
                    <td data-label="Trigger"><span>{triggerLabel(a.trigger)}<span className="pa-sub" style={{ display: 'block' }}>{a.interval === 'W' ? '1 week' : '1 day'} · {a.session}</span></span></td>
                    <td data-label="Expires">{a.expiresAt ? fmtTime(a.expiresAt) : 'Open-ended'}</td>
                    <td data-label="Status"><span className={`pa-st ${a.status}`}>{a.status === 'triggered' ? 'done (fired)' : a.status}</span></td>
                    <td data-label="Fired"><span>{a.fireCount}×<span className="pa-sub" style={{ display: 'block' }}>{a.lastFiredAt ? fmtTime(a.lastFiredAt) : 'never'}</span></span></td>
                    <td className="pa-acts-cell">
                      <div className="pa-acts">
                        <button type="button" className="pa-btn sm" disabled={busy === a.id} onClick={() => setDialog({ editing: a })}>Edit</button>
                        {a.status === 'triggered' && a.trigger === 'once' && !rearmMissing
                          ? <button type="button" className="pa-btn sm pri" disabled={busy === a.id} title="Arm this one-time alert again so it can fire once more" onClick={() => void act(a, 'rearm')}>Rearm</button>
                          : a.status === 'active' ? <button type="button" className="pa-btn sm" disabled={busy === a.id} onClick={() => void act(a, 'pause')}>Pause</button>
                          : <button type="button" className="pa-btn sm" disabled={busy === a.id} title={a.status === 'paused' ? 'Start checking again' : 'Start checking again (change the expiry first if it has passed)'} onClick={() => void act(a, 'resume')}>Resume</button>}
                        <button type="button" className="pa-btn sm" disabled={busy === a.id} title="Send a test alert for the first ticker on the alert's channels" onClick={() => void act(a, 'test')}>Test</button>
                        <button type="button" className="pa-btn sm" disabled={busy === a.id} onClick={() => void act(a, 'delete')}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pa-card" id="log">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <b style={{ fontSize: 15 }}>Alert log {data ? <span className="pa-sub">· {data.unread} unread</span> : null}</b>
          <button type="button" className="pa-btn sm" onClick={async () => { await markReadApi('all'); void refreshEvents(); void refresh(); }}>Mark all read</button>
        </div>
        <div className="pa-ctl">
          <select aria-label="Market" value={evMarket} onChange={(e) => setEvMarket(e.target.value as '' | 'IN' | 'US')}><option value="">India + USA</option><option value="IN">India</option><option value="US">USA</option></select>
          <select aria-label="Alert" value={evAlert} onChange={(e) => setEvAlert(e.target.value)} style={{ maxWidth: 220 }}><option value="">All alerts</option>{alerts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input aria-label="Ticker" placeholder="Ticker" value={evTicker} onChange={(e) => setEvTicker(e.target.value.toUpperCase())} style={{ width: 110 }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={evUnread} onChange={(e) => setEvUnread(e.target.checked)} /> Unread only</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} /> Show tests</label>
          <span className="pa-sub">Kept 180 days.{!showTests && hiddenTests > 0 ? ` ${hiddenTests} test${hiddenTests === 1 ? '' : 's'} hidden.` : ''}</span>
        </div>
        {evErr && <div className="pa-err">Log could not be loaded: {evErr}</div>}
        <div className="pa-wrap">
          <table className="pa-cards">
            <thead><tr><th>Ticker · time</th><th>Message</th><th>Price</th><th>Change</th><th>Alert</th></tr></thead>
            <tbody>
              {shownEvents.length === 0 ? <tr><td colSpan={5} className="pa-sub pa-main">Nothing fired{evMarket || evAlert || evTicker || evUnread ? ' for these filters' : ' yet'}.</td></tr>
                : shownEvents.map((e) => {
                  const del = eventDelivery(e);
                  return (
                    <tr key={e.id} className={e.read ? undefined : 'pa-unread'}>
                      <td className="pa-main" style={{ whiteSpace: 'nowrap' }}>
                        <a href={chartHrefFor(e)} className="pa-tk" title="Open the chart">{e.ticker}</a>
                        <span className="pa-sub"> · {e.market === 'IN' ? (e.mid.startsWith('IN:BSE:') ? 'BSE' : 'NSE') : 'USA'} · {fmtTime(e.firedAt)}{isTestEvent(e) ? ' · test' : ''}{e.read ? '' : ' · new'}</span>
                        {e.name ? <div className="pa-sub" style={{ whiteSpace: 'normal' }}>{e.name}</div> : null}
                      </td>
                      <td data-label="Message"><span>{e.message}<span className="pa-sub" style={{ display: 'block' }}>{e.condition}</span>
                        {del.length > 0 && <span style={{ display: 'block', marginTop: 2 }}>{del.map((d) => <span key={d.channel} className={`pa-del ${d.ok ? 'ok' : 'bad'}`} title={d.error || 'sent'}>{d.ok ? '✓' : '✗'} {CH_NAME[d.channel] || d.channel}</span>)}</span>}</span></td>
                      <td data-label="Price">{e.price != null ? `${e.market === 'IN' ? '₹' : '$'}${e.price.toFixed(2)}` : '—'}</td>
                      <td data-label="Change" style={{ color: e.changePct == null ? undefined : e.changePct >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{e.changePct != null ? `${e.changePct >= 0 ? '+' : ''}${e.changePct.toFixed(2)}%` : '—'}</td>
                      <td data-label="Alert"><span>{e.alertName}{e.list ? <span className="pa-sub" style={{ display: 'block' }}>{e.list}</span> : null}</span></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!moreEnd && events.length > 0 && <button type="button" className="pa-btn sm" style={{ marginTop: 8 }} onClick={() => void refreshEvents(events[events.length - 1].id)}>Load older</button>}
      </div>

      {dialog && <CreateAlertDialog editing={dialog.editing} chartLists={chartLists} onClose={() => setDialog(null)} onSaved={() => { setNote('Saved.'); void refresh(); }} />}
    </div>
  );
}
