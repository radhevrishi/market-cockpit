'use client';
// zzz1054 — header bell for price alerts: unread count, the latest fires, toasts and browser notifications for new ones.
// Polls /api/v1/price-alerts?view=bell every 60 s only while the tab is visible (no Redis behind it — Postgres).
// The first poll only learns where the list stands (no toasts for old fires).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { pollWhenVisible } from '@/lib/client-fetch';
import { ALERTS_API, ALERTS_CHANGED_EVENT, markReadApi } from '@/lib/alerts/client';
import type { AlertEvent } from '@/lib/alerts/types';

const POLL_MS = 60_000;

export default function AlertBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<AlertEvent[]>([]);
  const lastId = useRef<number>(0);
  const primed = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const first = !primed.current;
      const r = await fetch(`${ALERTS_API}?view=bell${first ? '' : `&afterId=${lastId.current}`}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return;
      const j = await r.json();
      if (!j?.ok) return;
      setUnread(Number(j.unread) || 0);
      const evs: AlertEvent[] = Array.isArray(j.events) ? j.events : [];
      if (!first && evs.length) {
        setRecent((cur) => [...evs, ...cur].slice(0, 15));
        for (const e of evs.slice(0, 5).reverse()) {
          if (e.toast) toast(`🔔 ${e.message}`, { duration: 8000 });
          if (e.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification(`🔔 ${e.ticker}`, { body: e.message, tag: `pa-${e.id}` }); } catch { /* not allowed here */ }
          }
        }
        if (evs.length > 5) toast(`🔔 ${evs.length - 5} more price alerts — open the bell`, { duration: 8000 });
      }
      lastId.current = Math.max(lastId.current, Number(j.latestId) || 0);
      primed.current = true;
    } catch { /* offline: try again next minute */ }
  }, []);

  useEffect(() => {
    void poll();
    const stop = pollWhenVisible(() => { void poll(); }, POLL_MS);
    const onChange = () => { void poll(); };
    window.addEventListener(ALERTS_CHANGED_EVENT, onChange);
    return () => { stop(); window.removeEventListener(ALERTS_CHANGED_EVENT, onChange); };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    // load the latest fires for the dropdown
    void fetch(`${ALERTS_API}?view=events&limit=15`, { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j?.ok) setRecent(j.events); }).catch(() => {});
    const out = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);

  const readAll = async () => { if (await markReadApi('all')) { setUnread(0); setRecent((r) => r.map((e) => ({ ...e, read: true }))); } };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Price alerts: ${unread} unread` : 'Price alerts'} title="Price alerts"
        style={{ position: 'relative', background: 'none', border: '1px solid var(--mc-bg-4)', borderRadius: 10, padding: '6px 9px', cursor: 'pointer', color: 'var(--mc-text-2)', fontSize: 14, lineHeight: 1 }}>
        🔔
        {unread > 0 && <span style={{ position: 'absolute', top: -6, right: -6, background: '#DC2626', color: '#fff', borderRadius: 9, fontSize: 10, fontWeight: 800, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Recent price alerts" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 340, maxWidth: 'calc(100vw - 32px)', background: '#fff', color: '#111827', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,.18)', zIndex: 900, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
            <b>Price alerts</b>
            <span style={{ display: 'flex', gap: 10 }}>
              {unread > 0 && <button type="button" onClick={() => void readAll()} style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>Mark all read</button>}
              <Link href="/price-alerts" onClick={() => setOpen(false)} style={{ color: '#2563eb', fontWeight: 600 }}>Open</Link>
            </span>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {recent.length === 0 ? <div style={{ padding: 14, color: '#6b7280' }}>Nothing has fired yet. Create alerts from a chart watchlist, /watchlists or the Price alerts page.</div>
              : recent.map((e) => (
                <div key={e.id} style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', background: e.read ? '#fff' : '#eff6ff' }}>
                  <div style={{ fontWeight: 600 }}>{e.message}</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{new Date(e.firedAt).toLocaleString()}{e.list ? ` · ${e.list}` : ''}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
