// ═══════════════════════════════════════════════════════════════════════════
// zzz975 — SERVER OVERLAY: THE INDIA GUIDANCE LINE ON EVERY SERVED GRADED DAY.
//
// Applied when a graded India day is SERVED (/api/v1/earnings/graded and
// /graded-window), never written into the stored day: a regrade from the
// stored grader input stays exactly as it was, and a guidance document read
// later (the call usually follows the results by one to three weeks) changes
// the line on the next read without re-grading anything.
//
// Reads only what is already stored — no AI call, no fetch outside KV:
//   guidance-docs:v1:index        → which extracted documents belong to which
//                                   NSE symbol / BSE code (memo 15 min, served
//                                   stale while it refreshes)
//   guidance-extract:v1:<docId>   → the quote-checked figures (memo 30 min)
//   haiku-fg:v3:…:<T>:<Qn-FYyy>   → the stored AI concall read (memo 30 min)
// One batched read for the figures and one for the AI reads per served day.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvMGet, kvSet } from './kv';
import { applyInGuideLines, extractsForFiling, IN_OVERLAY_VERSION, type InExtractDocLike, type InAiGuidanceLike, type InGuideStored } from './in-guide-line';
import { haikuFgKey, haikuPeriodOf } from './haiku-fg-key';
import { checkQuarterLabel } from './india-eo-card-data';

const DOCS_INDEX_KEY = 'guidance-docs:v1:index';
const INTIMATIONS_KEY = 'guidance-docs:v1:intimations';
/** zzz977 — India BLOCKBUSTER / STRONG companies whose new call is not read yet: the guidance reader takes their documents first */
export const IN_PRIORITY_KEY = 'guidance-priority:v1:IN';
const STANDING_DAYS = 200;
const extractKey = (docId: string) => `guidance-extract:v1:${docId}`;
const INDEX_FRESH_MS = 15 * 60_000;
const INDEX_MAX_MS = 6 * 3_600_000;
const ITEM_MS = 30 * 60_000;
const COLD_INDEX_WAIT_MS = 4_000;
const MGET_CHUNK = 100;
const MAX_KEYS_PER_DAY = 600;

type IndexRow = { docId: string; filedAt: string; kind?: string; extracted?: boolean; url?: string };
let _idx: { at: number; byTicker: Map<string, IndexRow[]> } | null = null;
let _idxInflight: Promise<void> | null = null;
const _extract = new Map<string, { at: number; v: InExtractDocLike | null }>();
const _ai = new Map<string, { at: number; v: InAiGuidanceLike | null }>();

function refreshIndex(): Promise<void> {
  if (_idxInflight) return _idxInflight;
  _idxInflight = (async () => {
    const raw = await kvGet<any>(DOCS_INDEX_KEY);
    const rows: any[] = Array.isArray(raw?.rows) ? raw.rows : [];
    if (!rows.length) return;   // a failed / empty read never replaces a good map
    const byTicker = new Map<string, IndexRow[]>();
    for (const r of rows) {
      if (!r || r.market !== 'IN' || typeof r.docId !== 'string' || !r.ticker) continue;
      const t = String(r.ticker).toUpperCase();
      const list = byTicker.get(t) || [];
      list.push({ docId: r.docId, filedAt: String(r.filedAt || ''), kind: typeof r.kind === 'string' ? r.kind : undefined, extracted: r.extracted === true, url: typeof r.url === 'string' ? r.url : undefined });
      byTicker.set(t, list);
    }
    _idx = { at: Date.now(), byTicker };
  })().catch(() => { /* keep the old map */ }).finally(() => { _idxInflight = null; });
  return _idxInflight;
}
/** The ticker → documents map: fresh, or stale while it refreshes, or (cold) waited for a few seconds at most. */
async function docsIndex(): Promise<Map<string, IndexRow[]> | null> {
  const age = _idx ? Date.now() - _idx.at : Infinity;
  if (_idx && age < INDEX_FRESH_MS) return _idx.byTicker;
  if (_idx && age < INDEX_MAX_MS) { void refreshIndex(); return _idx.byTicker; }
  await Promise.race([refreshIndex(), new Promise((r) => setTimeout(r, COLD_INDEX_WAIT_MS))]);
  return _idx?.byTicker ?? null;
}

// zzz977 — exchange intimations ("call on 15 Oct", "transcript available at …") whose document is not out yet, by ticker
type Intim = { kind?: string; filedAt?: string; url?: string };
let _intim: { at: number; byTicker: Map<string, Intim[]> } | null = null;
async function intimations(): Promise<Map<string, Intim[]>> {
  if (_intim && Date.now() - _intim.at < INDEX_FRESH_MS) return _intim.byTicker;
  try {
    const raw = await kvGet<any>(INTIMATIONS_KEY);
    const list: any[] = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
    const m = new Map<string, Intim[]>();
    for (const e of list) {
      if (!e || !e.ticker) continue;
      const t = String(e.ticker).toUpperCase();
      m.set(t, [...(m.get(t) || []), { kind: e.kind, filedAt: e.filedAt, url: e.url }]);
    }
    _intim = { at: Date.now(), byTicker: m };
  } catch { if (!_intim) _intim = { at: Date.now(), byTicker: new Map() }; }
  return _intim.byTicker;
}
const DAY = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
/** Pure: the documents filed 3–200 days BEFORE these results (the previous season's calls), newest first, at most two. */
export function standingDocIds(list: readonly IndexRow[], filing: string): string[] {
  const f = dayOf(filing);
  if (!Number.isFinite(f)) return [];
  return list.filter((x) => { const a = dayOf(x.filedAt); return x.extracted !== false && Number.isFinite(a) && a < f - 3 * DAY && a >= f - STANDING_DAYS * DAY; })
    .sort((a, b) => String(b.filedAt).localeCompare(String(a.filedAt))).slice(0, 2).map((x) => x.docId);
}
let _prioWritten = '';

async function mgetChunked<T>(keys: string[]): Promise<Array<T | null>> {
  const out: Array<T | null> = [];
  for (let i = 0; i < keys.length; i += MGET_CHUNK) {
    const part = keys.slice(i, i + MGET_CHUNK);
    const vals = await kvMGet<T>(part).catch(() => part.map(() => null));
    out.push(...part.map((_, j) => vals[j] ?? null));
  }
  return out;
}

function rowsOf(payload: any): any[] {
  const out: any[] = [];
  for (const v of Object.values(payload?.by_tier || {})) if (Array.isArray(v)) for (const r of v) if (r && typeof r === 'object') out.push(r);
  return out;
}
const filingOf = (r: any): string => String(r?._window_date || r?.filing_date || '').slice(0, 10);
const aiKeyOf = (r: any): string | null => {
  const p = haikuPeriodOf(checkQuarterLabel(r?.quarter, filingOf(r)).label);
  return p && r?.ticker ? haikuFgKey(String(r.ticker), p) : null;
};

/** The served India day with `guide_line` on every row and lowered-guidance top-tier rows moved to MIXED. Never throws. */
export async function overlayInGuideLines(payload: any): Promise<any> {
  if (!payload?.by_tier) return payload;
  try {
    const rows = rowsOf(payload);
    if (!rows.length) return { ...payload, in_overlay_v: IN_OVERLAY_VERSION };
    const now = Date.now();
    const byTicker = await docsIndex().catch(() => null);
    // documents of each row's results season
    const docIdsFor = new Map<string, string[]>();
    const standingFor = new Map<string, string[]>();
    const pendingFor = new Map<string, Intim[]>();
    const rowKey = (r: any) => `${String(r?.ticker || '').toUpperCase()}|${filingOf(r)}`;
    const wantDocs = new Set<string>();
    for (const r of rows) {
      const list = byTicker?.get(String(r.ticker || '').toUpperCase()) || [];
      const season = extractsForFiling(list.map((x) => ({ ...x, rows: [] })), filingOf(r)) as unknown as IndexRow[];
      const ids = season.filter((x) => x.extracted !== false).map((x) => x.docId);
      docIdsFor.set(rowKey(r), ids);
      pendingFor.set(rowKey(r), season.filter((x) => x.extracted === false).map((x) => ({ kind: x.kind, filedAt: x.filedAt, url: x.url })));
      const st = standingDocIds(list, filingOf(r));
      standingFor.set(rowKey(r), st);
      for (const id of [...ids, ...st]) wantDocs.add(id);
    }
    const intimByTicker = await intimations().catch(() => new Map<string, Intim[]>());
    const needDocs = [...wantDocs].filter((id) => { const m = _extract.get(id); return !m || now - m.at > ITEM_MS; }).slice(0, MAX_KEYS_PER_DAY);
    const aiKeys = Array.from(new Set(rows.map(aiKeyOf).filter((k): k is string => !!k)));
    const needAi = aiKeys.filter((k) => { const m = _ai.get(k); return !m || now - m.at > ITEM_MS; }).slice(0, MAX_KEYS_PER_DAY);
    const [docVals, aiVals] = await Promise.all([
      needDocs.length ? mgetChunked<any>(needDocs.map(extractKey)) : Promise.resolve([] as any[]),
      needAi.length ? mgetChunked<any>(needAi) : Promise.resolve([] as any[]),
    ]);
    needDocs.forEach((id, i) => {
      const v = docVals[i];
      _extract.set(id, { at: now, v: v && v.market === 'IN' && Array.isArray(v.rows) ? { docId: v.docId, docKind: v.docKind, docUrl: v.docUrl, filedAt: v.filedAt, status: v.status, rows: v.rows } : null });
    });
    needAi.forEach((k, i) => {
      const v = aiVals[i];
      _ai.set(k, { at: now, v: v && typeof v === 'object' && typeof v.label === 'string' ? v : null });
    });
    if (_extract.size > 20_000) _extract.clear();
    if (_ai.size > 20_000) _ai.clear();
    const storedFor = (r: any): InGuideStored => {
      const ids = docIdsFor.get(rowKey(r)) || [];
      const extracts = ids.map((id) => _extract.get(id)?.v).filter((x): x is InExtractDocLike => !!x);
      const standing = (standingFor.get(rowKey(r)) || []).map((id) => _extract.get(id)?.v).filter((x): x is InExtractDocLike => !!x);
      const f = dayOf(filingOf(r));
      const announced = (intimByTicker.get(String(r.ticker || '').toUpperCase()) || []).filter((x) => { const a = dayOf(String(x.filedAt || '')); return Number.isFinite(a) && Number.isFinite(f) && a >= f - 3 * DAY && a <= f + 60 * DAY; });
      const k = aiKeyOf(r);
      return { extracts, ai: k ? _ai.get(k)?.v ?? null : null, standing, pending: pendingFor.get(rowKey(r)) || [], announced };
    };
    const out = applyInGuideLines(payload, storedFor);
    void notePriority(out).catch(() => null);
    return out;
  } catch {
    // the stores could not be read: the line still comes from the card's own text
    try { return applyInGuideLines(payload, () => null); } catch { return payload; }
  }
}

/**
 * zzz977 — remember this season's India BLOCKBUSTER / STRONG companies whose new guidance is not read yet, so the hourly
 * guidance reader takes their transcripts / decks first (within its unchanged daily allowance). Written only when the set
 * changes in this process; kept 20 days.
 */
async function notePriority(payload: any): Promise<void> {
  const want: Record<string, string> = {};
  for (const t of ['BLOCKBUSTER', 'STRONG']) for (const r of (payload?.by_tier?.[t] || [])) {
    const d = r?.guide_line?.direction;
    if (r?.ticker && (d === 'standing' || d === 'pending' || d === 'unknown' || d === 'none')) want[String(r.ticker).toUpperCase()] = filingOf(r);
  }
  // rows moved to MIXED by an earlier line keep their place too (their call is still the thing to read)
  for (const r of (payload?.by_tier?.MIXED || [])) if (r?.tier_before_guide_check && r?.ticker) want[String(r.ticker).toUpperCase()] = filingOf(r);
  const sig = Object.keys(want).sort().join(',');
  if (!sig || _prioWritten.includes(sig)) return;
  const prev = (await kvGet<Record<string, string>>(IN_PRIORITY_KEY).catch(() => null)) || {};
  const cutoff = new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10);
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...prev, ...want })) if (typeof v === 'string' && v >= cutoff && Object.keys(merged).length < 400) merged[k] = v;
  await kvSet(IN_PRIORITY_KEY, merged, 20 * 24 * 3600);
  _prioWritten = `${_prioWritten.slice(-4000)}|${sig}`;
}

/** Test helper. */
export function _resetInGuideMemo(): void { _idx = null; _idxInflight = null; _extract.clear(); _ai.clear(); _intim = null; _prioWritten = ''; }
