// zzz1006 — presentation helpers for the chart-side watchlist: readable section labels (display only — the saved section name is
// never changed), exchange / currency labels, the US extended-hours session word and the panel-level quote freshness. Pure.
import type { Quote, WlItem } from './chart-watchlist';

const SMALL = new Set(['and', 'or', 'of', 'the', 'in', 'on', 'for', 'to', 'a', 'an', 'vs', 'with', 'by', 'at']);
const ACRONYM = new Set(['AI', 'US', 'USA', 'UK', 'EU', 'EV', 'EVS', 'IT', 'PSU', 'PSUS', 'SME', 'NBFC', 'NBFCS', 'ETF', 'ETFS', 'IPO', 'IPOS', 'ADR', 'GPU', 'CPU', 'HPC',
  'AR', 'VR', 'NSE', 'BSE', 'FMCG', 'API', 'CDMO', 'CRDMO', 'EMS', 'PCB', 'OSAT', 'HBM', 'DRAM', 'LNG', 'CNG', 'EPC', 'MSME', 'IOT', 'SAAS', 'SPAC', 'REIT', 'REITS', 'RE', 'TV', 'IV', 'II', 'III', 'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY']);
const SPECIAL: Record<string, string> = { SAAS: 'SaaS', EVS: 'EVs', PSUS: 'PSUs', NBFCS: 'NBFCs', ETFS: 'ETFs', IPOS: 'IPOs', REITS: 'REITs', IOT: 'IoT' };

/** "AI_CHIPS_&_SEMICONDUCTORS" → "AI Chips & Semiconductors". Mixed-case names keep their own capitals (underscores become spaces). */
export function displaySectionName(raw: string): string {
  const spaced = String(raw || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return '';
  const letters = spaced.replace(/[^A-Za-z]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return spaced;   // written by hand: leave as is
  return spaced.split(' ').map((w, i) => {
    const bare = w.replace(/[^A-Za-z0-9]/g, '');
    if (SPECIAL[bare]) return w.replace(bare, SPECIAL[bare]);
    if (ACRONYM.has(bare)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(bare.toLowerCase())) return lower;
    return lower.replace(/[a-z]/, (c) => c.toUpperCase());
  }).join(' ');
}

/** Exchange word for a row (the identity the list stores: NSE / BSE / US). */
export function exchangeLabel(it: Pick<WlItem, 'm' | 'x'>): string { return it.m === 'US' ? 'US' : it.x === 'BSE' ? 'BSE' : 'NSE'; }
export function currencyOf(it: Pick<WlItem, 'm'>): 'USD' | 'INR' { return it.m === 'US' ? 'USD' : 'INR'; }

/** Which US extended session is running now ('pre' 04:00–09:30 ET, 'post' 16:00–20:00 ET on weekdays), else null. */
export function usExtendedSession(now: Date = new Date()): 'pre' | 'post' | null {
  let parts: Record<string, string> = {};
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  } catch { return null; }
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return null;
  const m = Number(parts.hour) * 60 + Number(parts.minute);
  if (m >= 240 && m < 570) return 'pre';
  if (m >= 960 && m < 1200) return 'post';
  return null;
}

export interface Freshness { newest: number | null; stale: number; missing: number; total: number }
/** Panel-level quote state: the newest receive time, how many quotes are stale (refresh failed) and how many have none yet. */
export function quoteFreshness(keys: readonly string[], quotes: Record<string, Quote | undefined>): Freshness {
  let newest: number | null = null, stale = 0, missing = 0;
  for (const k of keys) {
    const q = quotes[k];
    if (!q || q.last == null) { missing++; continue; }
    if (q.stale) stale++;
    if (typeof q.at === 'number' && (newest == null || q.at > newest)) newest = q.at;
  }
  return { newest, stale, missing, total: keys.length };
}
/** "now", "3 min ago", "14:32" (older than an hour). */
export function agoLabel(at: number | null, now = Date.now()): string {
  if (at == null) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Panel width presets (px) — the divider's own range (280–620) applies. */
export const WIDTH_PRESETS: ReadonlyArray<{ id: 'narrow' | 'standard' | 'wide'; label: string; px: number }> = [
  { id: 'narrow', label: 'Narrow', px: 300 }, { id: 'standard', label: 'Standard', px: 400 }, { id: 'wide', label: 'Wide', px: 520 },
];
export const WL_EXT_COLUMN_KEY = 'mc:watchlist-ext-col:v1';
