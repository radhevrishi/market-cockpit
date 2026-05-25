// PATCH 0840 — EO Alert library — browser-side push notification logic.
// No external service required. Uses Notification API + localStorage.
// Cron runs every 30 min, page fetches latest /api/v1/earnings/graded
// for today, compares to last-seen BB list (mc:eo-alerts:lastseen LS),
// triggers a browser notification when new BB lands.

const LS_LASTSEEN = 'mc:eo-alerts:lastseen:v1';
const LS_ENABLED  = 'mc:eo-alerts:enabled';

export interface EOAlert {
  ticker: string;
  company: string;
  tier: 'BLOCKBUSTER' | 'STRONG';
  composite_score?: number;
  sales_yoy_pct?: number;
  net_profit_yoy_pct?: number;
  eps_yoy_pct?: number;
  filing_date?: string;
}

export function eoAlertsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(LS_ENABLED) === '1'; } catch { return false; }
}

export function setEoAlertsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) localStorage.setItem(LS_ENABLED, '1');
    else localStorage.removeItem(LS_ENABLED);
  } catch {}
}

export function getLastSeenBB(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(LS_LASTSEEN);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}

export function setLastSeenBB(tickers: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_LASTSEEN, JSON.stringify(tickers)); } catch {}
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

export function fireNotification(title: string, body: string, url?: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'mc-eo-alert-' + Date.now(),
      requireInteraction: false,
    });
    if (url) {
      n.onclick = () => { window.open(url, '_blank'); n.close(); };
    }
  } catch {}
}

export async function pollAndAlert(): Promise<{ checked: number; newBB: EOAlert[] }> {
  if (!eoAlertsEnabled()) return { checked: 0, newBB: [] };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const r = await fetch(`/api/v1/earnings/graded?date=${today}&_=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return { checked: 0, newBB: [] };
    const data = await r.json();
    const bbs: EOAlert[] = (data?.by_tier?.BLOCKBUSTER || []).map((it: any) => ({
      ticker: it.ticker || '',
      company: it.company || it.ticker,
      tier: 'BLOCKBUSTER',
      composite_score: it.composite_score,
      sales_yoy_pct: it.sales_yoy_pct,
      net_profit_yoy_pct: it.net_profit_yoy_pct,
      eps_yoy_pct: it.eps_yoy_pct,
      filing_date: it.filing_date,
    }));
    const lastSeen = getLastSeenBB();
    const newBB = bbs.filter(b => !lastSeen.has(b.ticker));
    if (newBB.length > 0) {
      const body = newBB.length === 1
        ? `${newBB[0].ticker} — sales ${Math.round(newBB[0].sales_yoy_pct || 0)}% / PAT ${Math.round(newBB[0].net_profit_yoy_pct || 0)}%`
        : `${newBB.length} new BB: ${newBB.slice(0, 3).map(b => b.ticker).join(', ')}${newBB.length > 3 ? '…' : ''}`;
      fireNotification(`⭐ ${newBB.length} new BLOCKBUSTER`, body, '/earnings-opportunities');
      // Update last-seen
      setLastSeenBB([...lastSeen, ...newBB.map(b => b.ticker)]);
    }
    return { checked: bbs.length, newBB };
  } catch {
    return { checked: 0, newBB: [] };
  }
}
