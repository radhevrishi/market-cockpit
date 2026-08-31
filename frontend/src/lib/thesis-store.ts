// ═══════════════════════════════════════════════════════════════════════════
// THESIS & SELL-DISCIPLINE STORE — localStorage-backed store for per-ticker
// investment theses and their invalidation triggers.
//
// The discipline layer a long-term investor lacks: you write WHY you own a
// name and the concrete conditions that would BREAK that thesis, then the
// /thesis page surfaces every name whose auto-triggers have breached.
//
// Storage key `mc:thesis:v1` = Record<UPPERCASE ticker, ThesisEntry>.
// Every write is SSR-guarded and dispatches a window CustomEvent
// 'thesis:updated' so open views can re-read live.
// ═══════════════════════════════════════════════════════════════════════════

export type TriggerKind = 'margin' | 'cash' | 'growth' | 'price' | 'custom';

export interface ThesisTrigger {
  id: string;
  kind: TriggerKind;
  label: string;
  threshold?: number;
  note?: string;
}

export interface ThesisEntry {
  ticker: string;
  company?: string;
  thesis: string;
  triggers: ThesisTrigger[];
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

const KEY = 'mc:thesis:v1';
const EVENT = 'thesis:updated';

/** Stable id for a freshly-created trigger. */
export function newTriggerId(): string {
  try {
    // crypto.randomUUID is not universally present (older Safari / non-secure ctx)
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now() + Math.random());
  } catch {
    return String(Date.now() + Math.random());
  }
}

/** Read the full map. SSR-safe: returns {} on the server or on any parse error. */
export function readTheses(): Record<string, ThesisEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Defensive: ensure every entry has a triggers array.
    const out: Record<string, ThesisEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, ThesisEntry>)) {
      if (!v || typeof v !== 'object') continue;
      out[k] = { ...v, triggers: Array.isArray(v.triggers) ? v.triggers : [] };
    }
    return out;
  } catch {
    return {};
  }
}

/** Theses as a list, most-recently-updated first. */
export function getThesisList(): ThesisEntry[] {
  return Object.values(readTheses()).sort((a, b) =>
    (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
  );
}

function writeMap(map: Record<string, ThesisEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* quota / private-mode — swallow so the UI never throws */
  }
}

/** Create or replace a thesis (keyed by UPPERCASE ticker). Stamps updatedAt. */
export function upsertThesis(e: ThesisEntry): void {
  if (typeof window === 'undefined') return;
  const ticker = (e.ticker || '').trim().toUpperCase();
  if (!ticker) return;
  const map = readTheses();
  const existing = map[ticker];
  const now = new Date().toISOString();
  map[ticker] = {
    ...e,
    ticker,
    triggers: Array.isArray(e.triggers) ? e.triggers : [],
    createdAt: existing?.createdAt || e.createdAt || now,
    updatedAt: now,
  };
  writeMap(map);
}

/** Delete a thesis by ticker (case-insensitive). */
export function removeThesis(ticker: string): void {
  if (typeof window === 'undefined') return;
  const key = (ticker || '').trim().toUpperCase();
  if (!key) return;
  const map = readTheses();
  if (map[key]) {
    delete map[key];
    writeMap(map);
  }
}

/** Stamp the annual-review clock (reviewedAt = now). */
export function markReviewed(ticker: string): void {
  if (typeof window === 'undefined') return;
  const key = (ticker || '').trim().toUpperCase();
  if (!key) return;
  const map = readTheses();
  const entry = map[key];
  if (!entry) return;
  const now = new Date().toISOString();
  map[key] = { ...entry, reviewedAt: now, updatedAt: now };
  writeMap(map);
}
