'use client';
// zzz1054 — header bell for price alerts: unread count, the latest fires, toasts and browser notifications for new ones.
// Polls /api/v1/price-alerts?view=bell every 60 s only while the tab is visible (no Redis behind it — Postgres).
// zzz1064 — (A07) every fired alert is consumed exactly once, OLDEST FIRST, with a cursor kept per device: a burst of 25 is no
// longer cut to the newest 20 (lib/alerts/client.ts collectNewEvents). A burst shows ONE grouped toast. Opening the app with
// unread alerts says so once. The badge is large and red on desktop and phone; the panel lists ticker, change %, condition,
// time and list, with "Mark all read", "Open log" and the phone-notifications switch for this device.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { pollWhenVisible } from '@/lib/client-fetch';
import {
  ALERTS_API, ALERTS_CHANGED_EVENT, BELL_CURSOR_KEY, BELL_PAGE, markReadApi, collectNewEvents, burstToasts, chartHrefFor, isTestEvent,
  type EventPage,
} from '@/lib/alerts/client';
import { pushOnThisDevice } from '@/lib/push-client';
import type { AlertEvent } from '@/lib/alerts/types';
import PhoneNotifications from './PhoneNotifications';

const POLL_MS = 60_000;
const SESSION_GREETED = 'mc:alerts-bell-greeted:v1';

function readCursor(): number | null {
  try { const v = window.localStorage.getItem(BELL_CURSOR_KEY); const n = v == null ? NaN : Number(v); return Number.isFinite(n) && n >= 0 ? n : null; } catch { return null; }
}
function writeCursor(n: number) { try { window.localStorage.setItem(BELL_CURSOR_KEY, String(n)); } catch { /* storage blocked */ } }
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.ok ? j : null;
  } catch { return null; }
}

const CSS = `
.mcab{position:relative;flex:none}
.mcab-btn{position:relative;background:none;border:1px solid var(--mc-bg-4);border-radius:10px;padding:6px 9px;cursor:pointer;color:var(--mc-text-2);font-size:16px;line-height:1;min-width:38px;min-height:36px}
.mcab-btn.has{border-color:#dc2626}
.mcab-badge{position:absolute;top:-8px;right:-8px;background:#dc2626;color:#fff;border-radius:11px;font-size:11px;font-weight:800;padding:2px 6px;min-width:20px;text-align:center;line-height:16px;border:2px solid var(--mc-bg-1,#fff);font-variant-numeric:tabular-nums}
.mcab-panel{position:absolute;right:0;top:calc(100% + 8px);width:380px;max-width:calc(100vw - 24px);background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 14px 34px rgba(0,0,0,.2);z-index:900;font-size:13px;overflow:hidden}
.mcab-head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e7eb;gap:8px}
.mcab-head b{font-size:15px}
.mcab-link{border:none;background:none;color:#2563eb;cursor:pointer;font-weight:700;font-size:13px;padding:4px 2px;text-decoration:none}
.mcab-list{max-height:min(420px,60vh);overflow-y:auto}
.mcab-row{padding:9px 12px;border-bottom:1px solid #f3f4f6;display:grid;gap:2px}
.mcab-row.unread{background:#eff6ff;border-left:3px solid #2563eb;padding-left:9px}
.mcab-top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.mcab-tk{font-weight:800;color:#111827;text-decoration:none}
.mcab-tk:hover{text-decoration:underline}
.mcab-mk{font-size:10px;font-weight:800;color:#4b5563;border:1px solid #d1d5db;border-radius:4px;padding:0 4px}
.mcab-up{color:#15803d;font-weight:700}.mcab-dn{color:#b91c1c;font-weight:700}
.mcab-cond{color:#111827}
.mcab-sub{color:#6b7280;font-size:12px}
.mcab-empty{padding:14px;color:#4b5563;line-height:1.45}
@media (max-width:768px){
  .mcab-panel{position:fixed;left:8px;right:8px;top:56px;width:auto;max-width:none}
  .mcab-list{max-height:calc(100vh - 220px)}
}
`;

export default function AlertBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<AlertEvent[]>([]);
  const [loadErr, setLoadErr] = useState(false);
  const cursor = useRef<number | null>(null);
  const busy = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const announceNew = useCallback((evs: AlertEvent[], truncated: boolean) => {
    const toastable = evs.filter((e) => e.toast !== false);
    const t = burstToasts(toastable, truncated);
    if (t.grouped) {
      toast((tt) => (
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{t.grouped}</span>
          <button type="button" onClick={() => { toast.dismiss(tt.id); setOpen(true); }} style={{ border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '4px 10px', fontWeight: 700, cursor: 'pointer' }}>Open</button>
        </span>
      ), { duration: 12_000 });
    } else {
      for (const line of t.lines) toast(line, { duration: 8000 });
    }
    // In-page browser notifications only when this device does NOT already get phone pushes (no doubles), and only a few.
    if (!pushOnThisDevice() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const e of evs.filter((x) => x.browser && !isTestEvent(x)).slice(-3)) {
        try { new Notification(`🔔 ${e.ticker}`, { body: e.message, tag: `pa-${e.id}` }); } catch { /* not allowed here */ }
      }
    }
  }, []);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (cursor.current == null) cursor.current = readCursor();
      const cur = cursor.current;
      const head = await getJson(`${ALERTS_API}?view=bell&afterId=${cur ?? 0}&order=asc&limit=${BELL_PAGE}`);
      if (!head) return;
      const nUnread = Number(head.unread) || 0;
      const latest = Number(head.latestId) || 0;
      setUnread(nUnread);

      // Once per app visit: say how many are waiting (the owner opened the app and saw nothing before).
      let greeted = true;
      try { greeted = window.sessionStorage.getItem(SESSION_GREETED) === '1'; window.sessionStorage.setItem(SESSION_GREETED, '1'); } catch { greeted = true; }

      if (cur == null || latest < cur) {
        // first time on this device (or the log was reset): start from now; old fires are in the panel and the log
        cursor.current = latest; writeCursor(latest);
        if (!greeted && nUnread > 0) announceWaiting(nUnread);
        return;
      }
      if (latest <= cur) {
        if (!greeted && nUnread > 0) announceWaiting(nUnread);
        return;
      }
      let firstUsed = false;
      const ascending = async (afterId: number, limit: number): Promise<EventPage> => {
        if (!firstUsed && afterId === cur) { firstUsed = true; return Array.isArray(head.events) ? { events: head.events, hasMore: head.hasMore } : null; }
        const j = await getJson(`${ALERTS_API}?view=bell&afterId=${afterId}&order=asc&limit=${limit}`);
        return j && Array.isArray(j.events) ? { events: j.events, hasMore: j.hasMore } : null;
      };
      const descending = async (beforeId: number | undefined, limit: number): Promise<EventPage> => {
        const j = await getJson(`${ALERTS_API}?view=events&limit=${limit}${beforeId ? `&beforeId=${beforeId}` : ''}`);
        return j && Array.isArray(j.events) ? { events: j.events } : null;
      };
      const r = await collectNewEvents(cur, { ascending, descending });
      if (r.events.length) {
        setRecent((old) => {
          const seen = new Set(old.map((e) => e.id));
          return [...[...r.events].reverse().filter((e) => !seen.has(e.id)), ...old].slice(0, 30);
        });
        announceNew(r.events, r.truncated);
      }
      if (r.cursor > cur) { cursor.current = r.cursor; writeCursor(r.cursor); }
    } finally { busy.current = false; }
  }, [announceNew]);

  function announceWaiting(n: number) {
    toast((tt) => (
      <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>🔔 {n} unread price alert{n === 1 ? '' : 's'}</span>
        <button type="button" onClick={() => { toast.dismiss(tt.id); setOpen(true); }} style={{ border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '4px 10px', fontWeight: 700, cursor: 'pointer' }}>Show</button>
      </span>
    ), { duration: 10_000 });
  }

  useEffect(() => {
    void poll();
    const stop = pollWhenVisible(() => { void poll(); }, POLL_MS);
    const onChange = () => { void poll(); };
    window.addEventListener(ALERTS_CHANGED_EVENT, onChange);
    return () => { stop(); window.removeEventListener(ALERTS_CHANGED_EVENT, onChange); };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    // the latest fires for the panel
    void getJson(`${ALERTS_API}?view=events&limit=30`).then((j) => { if (j) { setRecent(j.events); setLoadErr(false); } else setLoadErr(true); });
    const out = (e: MouseEvent | TouchEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', out); document.addEventListener('touchstart', out, { passive: true }); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('touchstart', out); document.removeEventListener('keydown', esc); };
  }, [open]);

  const readAll = async () => { if (await markReadApi('all')) { setUnread(0); setRecent((r) => r.map((e) => ({ ...e, read: true }))); } };
  const readOne = (e: AlertEvent) => {
    if (e.read) return;
    setRecent((r) => r.map((x) => (x.id === e.id ? { ...x, read: true } : x)));
    setUnread((n) => Math.max(0, n - 1));
    void markReadApi([e.id]);
  };

  return (
    <div ref={boxRef} className="mcab">
      <style>{CSS}</style>
      <button ref={btnRef} type="button" className={`mcab-btn${unread ? ' has' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Price alerts: ${unread} unread` : 'Price alerts'} title={unread ? `${unread} unread price alert${unread === 1 ? '' : 's'}` : 'Price alerts'}>
        🔔
        {unread > 0 && <span className="mcab-badge" aria-hidden>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Recent price alerts" className="mcab-panel">
          <div className="mcab-head">
            <b>Price alerts{unread > 0 ? ` · ${unread} unread` : ''}</b>
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {unread > 0 && <button type="button" className="mcab-link" onClick={() => void readAll()}>Mark all read</button>}
              <Link href="/price-alerts#log" className="mcab-link" onClick={() => setOpen(false)}>Open log</Link>
            </span>
          </div>
          <PhoneNotifications compact />
          <div className="mcab-list">
            {loadErr && recent.length === 0 ? <div className="mcab-empty">The alerts could not be loaded. Check your connection and open the bell again.</div>
              : recent.length === 0 ? <div className="mcab-empty">Nothing has fired yet. Create alerts from a chart watchlist, /watchlists or the Price alerts page.</div>
              : recent.map((e) => (
                <div key={e.id} className={`mcab-row${e.read ? '' : ' unread'}`}>
                  <div className="mcab-top">
                    <Link href={chartHrefFor(e)} className="mcab-tk" onClick={() => { readOne(e); setOpen(false); }}>{e.ticker}</Link>
                    <span className="mcab-mk">{e.market === 'US' ? 'USA' : e.mid?.startsWith('IN:BSE:') ? 'BSE' : 'NSE'}</span>
                    {e.changePct != null && <span className={e.changePct >= 0 ? 'mcab-up' : 'mcab-dn'}>{e.changePct >= 0 ? '+' : ''}{e.changePct.toFixed(2)}%</span>}
                    {isTestEvent(e) && <span className="mcab-sub">test</span>}
                    <span className="mcab-sub" style={{ marginLeft: 'auto' }} title={new Date(e.firedAt).toLocaleString()}>{ago(e.firedAt)}</span>
                  </div>
                  <div className="mcab-cond">{e.condition || e.message}</div>
                  <div className="mcab-sub">{e.alertName}{e.list ? ` · ${e.list}` : ''}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
