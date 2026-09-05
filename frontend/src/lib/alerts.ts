// ════════════════════════════════════════════════════════════════════════════
// alerts.ts — user-defined alert conditions, evaluated against live quotes.
// Rules persist in localStorage ('mc:alerts:v1'); SSR-safe (window guards).
// Cooldown: a rule that fired won't refire within 20 hours.
// ════════════════════════════════════════════════════════════════════════════

import { getConvictionList } from './conviction-beats';
import { assessDecay } from './cb-decay';

export type AlertKind =
  | 'ma50_touch'
  | 'ma200_touch'
  | 'price_below'
  | 'price_above'
  | 'drop_day'
  | 'decay_flag';

export interface AlertRule {
  id: string;
  ticker: string;
  kind: AlertKind;
  level?: number;
  createdAt: number;
  lastFiredAt?: number;
}

export interface AlertHit {
  rule: AlertRule;
  message: string;
}

const KEY = 'mc:alerts:v1';
const COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20h
const TOUCH_BAND = 0.015; // 1.5%

const norm = (s: string) => String(s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();

function readRules(): AlertRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.id && r.ticker && r.kind) : [];
  } catch { return []; }
}

function writeRules(rules: AlertRule[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(rules)); } catch { /* ignore */ }
}

export function getRules(): AlertRule[] {
  return readRules();
}

export function addRule(rule: Omit<AlertRule, 'id' | 'createdAt'>): AlertRule {
  const full: AlertRule = {
    ...rule,
    ticker: norm(rule.ticker),
    id: `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  const rules = readRules();
  rules.push(full);
  writeRules(rules);
  return full;
}

export function removeRule(id: string) {
  writeRules(readRules().filter((r) => r.id !== id));
}

/** Look up last-synced sma50/sma200 for a ticker from the raw technicals rows
 *  (both markets). Returns nulls when the symbol isn't in either universe. */
function readMAs(ticker: string): { sma50: number | null; sma200: number | null } {
  const out = { sma50: null as number | null, sma200: null as number | null };
  if (typeof window === 'undefined') return out;
  for (const key of ['mb_tech_rows_ind_v1', 'mb_tech_rows_usa_v1']) {
    try {
      const rows = JSON.parse(localStorage.getItem(key) || 'null');
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (norm(r?.symbol || r?.ticker) !== ticker) continue;
        const s50 = parseFloat(String(r?.sma50)); const s200 = parseFloat(String(r?.sma200));
        if (out.sma50 == null && Number.isFinite(s50) && s50 > 0) out.sma50 = s50;
        if (out.sma200 == null && Number.isFinite(s200) && s200 > 0) out.sma200 = s200;
      }
    } catch { /* ignore */ }
    if (out.sma50 != null && out.sma200 != null) break;
  }
  return out;
}

/** Evaluate every rule against a live quote map (ticker → {price, chg}).
 *  Fires that pass the 20h cooldown are returned; lastFiredAt is stamped and
 *  the rule set persisted. */
export function evaluateAlerts(live: Map<string, { price: number; chg: number | null }>): AlertHit[] {
  if (typeof window === 'undefined') return [];
  const rules = readRules();
  const hits: AlertHit[] = [];
  const now = Date.now();
  let dirty = false;

  for (const rule of rules) {
    if (rule.lastFiredAt && now - rule.lastFiredAt < COOLDOWN_MS) continue;
    const t = norm(rule.ticker);
    const q = live.get(t) || null;
    let message: string | null = null;

    switch (rule.kind) {
      case 'ma50_touch':
      case 'ma200_touch': {
        if (!q || !Number.isFinite(q.price) || q.price <= 0) break;
        const mas = readMAs(t);
        const ma = rule.kind === 'ma50_touch' ? mas.sma50 : mas.sma200;
        if (ma != null && ma > 0 && Math.abs(q.price - ma) / ma <= TOUCH_BAND) {
          message = `${t} touching ${rule.kind === 'ma50_touch' ? '50DMA' : '200DMA'} (${q.price.toFixed(2)} vs ${ma.toFixed(2)})`;
        }
        break;
      }
      case 'price_below': {
        // zzz530 — a stale/zero/NaN price must not trip "below X"
        if (q && Number.isFinite(q.price) && q.price > 0 && typeof rule.level === 'number' && q.price <= rule.level) {
          message = `${t} below ${rule.level} (now ${q.price.toFixed(2)})`;
        }
        break;
      }
      case 'price_above': {
        if (q && Number.isFinite(q.price) && q.price > 0 && typeof rule.level === 'number' && q.price >= rule.level) {
          message = `${t} above ${rule.level} (now ${q.price.toFixed(2)})`;
        }
        break;
      }
      case 'drop_day': {
        const threshold = rule.level && rule.level > 0 ? rule.level : 5;
        if (q && q.chg != null && Number.isFinite(q.chg) && q.chg <= -threshold) {
          message = `${t} down ${q.chg.toFixed(1)}% today (alert at −${threshold}%)`;
        }
        break;
      }
      case 'decay_flag': {
        try {
          for (const entry of getConvictionList()) {
            if (norm(entry.ticker) !== t) continue;
            const d = assessDecay(entry);
            if (d) message = `${t} decay flag (${d.severity}): ${d.reasons.slice(0, 2).join(' · ')}`;
            break;
          }
        } catch { /* ignore */ }
        break;
      }
    }

    if (message) {
      rule.lastFiredAt = now;
      dirty = true;
      hits.push({ rule, message });
    }
  }

  if (dirty) writeRules(rules);
  return hits;
}

/** Push browser notifications for hits (max 3) when permitted; always returns
 *  the hits for in-page rendering. */
export function notify(hits: AlertHit[]): AlertHit[] {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    for (const h of hits.slice(0, 3)) {
      try { new Notification('Market Cockpit', { body: h.message }); } catch { /* ignore */ }
    }
  }
  return hits;
}

export function requestNotifyPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return Promise.resolve('denied' as NotificationPermission);
  try { return Notification.requestPermission(); } catch { return Promise.resolve('denied' as NotificationPermission); }
}

// ── zzz526 — server sync ─────────────────────────────────────────────────────
// Mirror the rules to KV so the GitHub-Actions cron evaluates them with the
// portal closed and pushes via Telegram/Slack. Best-effort, never throws.
export async function syncRulesToServer(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const r = await fetch('/api/v1/alerts/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: getRules() }),
    });
    return r.ok;
  } catch { return false; }
}

/** Server-fired hits (from the cron), for display alongside client hits. */
export async function fetchServerHits(): Promise<Array<{ ruleId: string; ticker: string; message: string; ts: number }>> {
  if (typeof window === 'undefined') return [];
  try {
    const r = await fetch('/api/v1/alerts/rules', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.hits) ? j.hits : [];
  } catch { return []; }
}
