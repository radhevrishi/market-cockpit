// zzz841 — Thesis ledger + owner portfolio tags. Pure functions plus a thin
// localStorage adapter (SSR-safe, every access in try/catch, validated on read,
// capped, cross-tab aware).
//
// RULES: nothing here accepts a price or a move. A status change needs a
// written reason. Entering the ledger is a human act: addFromRadarItem only
// PRE-FILLS a draft; the UI saves it after the owner has reviewed it.

import {
  EVIDENCE_LABEL, LINK_LABEL, THESIS_STATUS_LABEL,
  type LedgerEntry, type PortfolioTag, type RadarItem, type ThesisStatus,
} from './multibagger-radar-types';

export const LEDGER_KEY = 'mc:mb-ledger:v1';
export const TAGS_KEY = 'mc:mb-tags:v1';
export const LEDGER_EVENT = 'mc:mb-ledger:updated';
export const LEDGER_CAP = 200;
export const NOT_ESTABLISHED = 'Not established';

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }

const STATUSES = Object.keys(THESIS_STATUS_LABEL) as ThesisStatus[];
export const OWNER_TAGS = ['CORE', 'SATELLITE', 'WATCH'] as const;
export type OwnerTag = (typeof OWNER_TAGS)[number];

export const TEXT_FIELDS = [
  'thesis', 'catalyst', 'whyNow', 'mechanism', 'evidence', 'assumptions', 'whatMustHappen', 'nextProofPoint',
  'whatWouldConfirm', 'whatWouldWeaken', 'whatWouldBreak', 'catalystDuration', 'earningsLink',
  'managementCommentary', 'valuationContext', 'technicalContext',
] as const;
export type LedgerTextField = (typeof TEXT_FIELDS)[number];

export const FIELD_LABEL: Record<LedgerTextField, string> = {
  thesis: 'Thesis', catalyst: 'Catalyst', whyNow: 'Why now', mechanism: 'Mechanism', evidence: 'Evidence',
  assumptions: 'Assumptions', whatMustHappen: 'What must happen', nextProofPoint: 'Next proof point',
  whatWouldConfirm: 'What would confirm it', whatWouldWeaken: 'What would weaken it', whatWouldBreak: 'What would break it',
  catalystDuration: 'Catalyst duration', earningsLink: 'Earnings link', managementCommentary: 'Management commentary',
  valuationContext: 'Valuation context', technicalContext: 'Technical context (timing only)',
};

const isoDay = (now: string | Date): string => {
  const d = typeof now === 'string' ? new Date(now) : now;
  return Number.isNaN(d.getTime()) ? String(now).slice(0, 10) : d.toISOString().slice(0, 10);
};
const nz = (s: unknown): string => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return !t || /^(unknown|n\/a|na|none|null|undefined|-|—|not assessed|not established)$/i.test(t) ? NOT_ESTABLISHED : t;
};
export const slug = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── Pure: build / validate ───────────────────────────────────────────────
export function ledgerIdOf(item: Pick<RadarItem, 'ticker' | 'company' | 'id'>): string {
  return `${slug(item.ticker || item.company || 'UNKNOWN')}::${slug(item.id)}`;
}

/** Pre-fills every ledger field from a radar item. Unknowns become 'Not established'. Owner edits before saving. */
export function addFromRadarItem(item: RadarItem, now: string | Date): LedgerEntry {
  const assumed = (item.chain || []).filter((c) => c.status === 'assumed').map((c) => c.text).filter(Boolean);
  const when = item.proof?.when ? item.proof.when : 'timing not stated';
  const dur = item.duration;
  return {
    id: ledgerIdOf(item),
    ticker: item.ticker || item.company,
    company: item.company,
    thesis: nz(item.whyItMatters),
    dateIdentified: isoDay(now),
    catalyst: nz(item.event),
    whyNow: nz(item.whyItMatters),
    mechanism: nz(item.mechanism),
    evidence: item.evidence ? `${EVIDENCE_LABEL[item.evidence.status]} - ${nz(item.evidence.sourceLabel)}. ${nz(item.evidence.why)}` : NOT_ESTABLISHED,
    assumptions: assumed.length ? assumed.join(' | ') : NOT_ESTABLISHED,
    whatMustHappen: nz(item.proof?.what),
    nextProofPoint: item.proof?.what ? `${item.proof.what} (${when})` : NOT_ESTABLISHED,
    whatWouldConfirm: nz(item.proof?.what),
    whatWouldWeaken: NOT_ESTABLISHED,
    whatWouldBreak: item.breakConditions?.length ? item.breakConditions.join(' | ') : NOT_ESTABLISHED,
    catalystDuration: dur ? `${nz(dur.label)}${dur.evidence ? ` - ${nz(dur.evidence)}` : ''}${dur.basis === 'type' ? ' (by event type)' : ''}` : NOT_ESTABLISHED,
    earningsLink: item.link ? `${LINK_LABEL[item.link]}. ${nz(item.financialImpact)}` : NOT_ESTABLISHED,
    managementCommentary: NOT_ESTABLISHED,
    valuationContext: nz(item.valuationContext),
    technicalContext: nz(item.technical?.note),
    lastReview: null,
    status: 'EARLY',
    history: [],
    fromRadarId: item.id,
  };
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

/** Tolerant validator: returns a clean entry or null. Missing text fields become 'Not established'. */
export function validateEntry(x: unknown): LedgerEntry | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = str(o.id).trim();
  const ticker = str(o.ticker).trim();
  if (!id || !ticker) return null;
  const status = STATUSES.includes(o.status as ThesisStatus) ? (o.status as ThesisStatus) : 'EARLY';
  const e: Record<string, unknown> = {
    id, ticker, company: str(o.company).trim() || ticker,
    dateIdentified: str(o.dateIdentified) || '', lastReview: typeof o.lastReview === 'string' ? o.lastReview : null,
    status, fromRadarId: typeof o.fromRadarId === 'string' ? o.fromRadarId : null,
  };
  for (const f of TEXT_FIELDS) e[f] = nz(o[f]);
  const hist = Array.isArray(o.history) ? o.history : [];
  e.history = hist
    .filter((h) => h && typeof h === 'object' && STATUSES.includes((h as any).from) && STATUSES.includes((h as any).to) && str((h as any).reason).trim())
    .map((h: any) => ({ date: str(h.date), from: h.from as ThesisStatus, to: h.to as ThesisStatus, reason: str(h.reason) }));
  return e as unknown as LedgerEntry;
}

export function parseLedger(raw: string | null | undefined): LedgerEntry[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: LedgerEntry[] = [];
  for (const x of data) {
    const e = validateEntry(x);
    if (e && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  return capLedger(out);
}

/** Keeps the newest LEDGER_CAP entries (by last review, then date identified). */
export function capLedger(list: LedgerEntry[], cap = LEDGER_CAP): LedgerEntry[] {
  if (list.length <= cap) return list;
  const key = (e: LedgerEntry) => e.lastReview || e.dateIdentified || '';
  const keep = new Set([...list].sort((a, b) => key(b).localeCompare(key(a))).slice(0, cap).map((e) => e.id));
  return list.filter((e) => keep.has(e.id));
}

// ── Pure: CRUD on a list ─────────────────────────────────────────────────
export function upsertEntry(list: LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  const v = validateEntry(entry);
  if (!v) return list;
  const i = list.findIndex((e) => e.id === v.id);
  const next = i >= 0 ? list.map((e, j) => (j === i ? { ...v, history: e.history.length >= v.history.length ? e.history : v.history } : e)) : [v, ...list];
  return capLedger(next);
}
export function deleteEntry(list: LedgerEntry[], id: string): LedgerEntry[] { return list.filter((e) => e.id !== id); }

export type StatusResult = { ok: true; entry: LedgerEntry } | { ok: false; error: string };
/** A status change needs a written reason. There is no price or move parameter, by design. */
export function applyStatus(entry: LedgerEntry, to: ThesisStatus, reason: string, now: string | Date): StatusResult {
  const r = (reason || '').replace(/\s+/g, ' ').trim();
  if (!STATUSES.includes(to)) return { ok: false, error: 'Unknown status.' };
  if (r.length < 5) return { ok: false, error: 'A status change needs a written reason (what evidence changed).' };
  const date = isoDay(now);
  return { ok: true, entry: { ...entry, status: to, lastReview: date, history: [...entry.history, { date, from: entry.status, to, reason: r }] } };
}
export function updateStatusIn(list: LedgerEntry[], id: string, to: ThesisStatus, reason: string, now: string | Date): { list: LedgerEntry[]; error?: string } {
  const e = list.find((x) => x.id === id);
  if (!e) return { list, error: 'Entry not found.' };
  const r = applyStatus(e, to, reason, now);
  if (!r.ok) return { list, error: r.error };
  return { list: list.map((x) => (x.id === id ? r.entry : x)) };
}

// ── Storage adapter ──────────────────────────────────────────────────────
function defaultStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
}
function announce(): void {
  try { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(LEDGER_EVENT)); } catch { /* ignore */ }
}

export function loadLedger(storage: StorageLike | null = defaultStorage()): LedgerEntry[] {
  if (!storage) return [];
  try { return parseLedger(storage.getItem(LEDGER_KEY)); } catch { return []; }
}
export function saveLedger(list: LedgerEntry[], storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(LEDGER_KEY, JSON.stringify(capLedger(list))); announce(); return true; } catch { return false; }
}
export function saveEntry(entry: LedgerEntry, storage: StorageLike | null = defaultStorage()): LedgerEntry[] {
  const next = upsertEntry(loadLedger(storage), entry);
  saveLedger(next, storage);
  return next;
}
export function removeEntry(id: string, storage: StorageLike | null = defaultStorage()): LedgerEntry[] {
  const next = deleteEntry(loadLedger(storage), id);
  saveLedger(next, storage);
  return next;
}
export function updateStatus(id: string, to: ThesisStatus, reason: string, now: string | Date, storage: StorageLike | null = defaultStorage()): { list: LedgerEntry[]; error?: string } {
  const r = updateStatusIn(loadLedger(storage), id, to, reason, now);
  if (!r.error) saveLedger(r.list, storage);
  return r;
}

// ── Owner portfolio tags (Core / Satellite / Watch), keyed by upper-case ticker ──
export function parseTags(raw: string | null | undefined): Record<string, OwnerTag> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, OwnerTag> = {};
    for (const [k, v] of Object.entries(o)) if ((OWNER_TAGS as readonly string[]).includes(v as string) && k) out[k.toUpperCase()] = v as OwnerTag;
    return out;
  } catch { return {}; }
}
export function loadTags(storage: StorageLike | null = defaultStorage()): Record<string, OwnerTag> {
  if (!storage) return {};
  try { return parseTags(storage.getItem(TAGS_KEY)); } catch { return {}; }
}
/** tag = null clears it. */
export function setTag(ticker: string, tag: OwnerTag | null, storage: StorageLike | null = defaultStorage()): Record<string, OwnerTag> {
  const cur = loadTags(storage);
  const k = ticker.trim().toUpperCase();
  if (!k) return cur;
  if (tag && (OWNER_TAGS as readonly string[]).includes(tag)) cur[k] = tag; else delete cur[k];
  if (storage) { try { storage.setItem(TAGS_KEY, JSON.stringify(cur)); announce(); } catch { /* ignore */ } }
  return cur;
}

/** The three derived tags. Uses ledger status and evidence only: never a price. Null = nothing to say. */
export function derivedTag(entries: ReadonlyArray<Pick<LedgerEntry, 'status'>>, items: ReadonlyArray<Pick<RadarItem, 'evidence'>>): PortfolioTag | null {
  if (entries.some((e) => e.status === 'BROKEN' || e.status === 'WEAKENING') || items.some((i) => i.evidence.status === 'DISPROVED')) return 'THESIS_AT_RISK';
  if (entries.some((e) => e.status === 'STRENGTHENING') || items.some((i) => i.evidence.status === 'CONFIRMED' || i.evidence.status === 'STRONG')) return 'CATALYST_CONFIRMED';
  if (entries.length > 0 || items.some((i) => i.evidence.status === 'DEVELOPING' || i.evidence.status === 'HYPOTHESIS')) return 'CATALYST_DEVELOPING';
  return null;
}
