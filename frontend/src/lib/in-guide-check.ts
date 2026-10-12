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

import { kvGet, kvMGet } from './kv';
import { applyInGuideLines, extractsForFiling, IN_OVERLAY_VERSION, type InExtractDocLike, type InAiGuidanceLike, type InGuideStored } from './in-guide-line';
import { haikuFgKey, haikuPeriodOf } from './haiku-fg-key';
import { checkQuarterLabel } from './india-eo-card-data';

const DOCS_INDEX_KEY = 'guidance-docs:v1:index';
const extractKey = (docId: string) => `guidance-extract:v1:${docId}`;
const INDEX_FRESH_MS = 15 * 60_000;
const INDEX_MAX_MS = 6 * 3_600_000;
const ITEM_MS = 30 * 60_000;
const COLD_INDEX_WAIT_MS = 4_000;
const MGET_CHUNK = 100;
const MAX_KEYS_PER_DAY = 600;

type IndexRow = { docId: string; filedAt: string };
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
      list.push({ docId: r.docId, filedAt: String(r.filedAt || '') });
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
    const rowKey = (r: any) => `${String(r?.ticker || '').toUpperCase()}|${filingOf(r)}`;
    const wantDocs = new Set<string>();
    for (const r of rows) {
      const list = byTicker?.get(String(r.ticker || '').toUpperCase()) || [];
      const ids = extractsForFiling(list.map((x) => ({ ...x, rows: [] })), filingOf(r)).map((x) => (x as any).docId as string);
      docIdsFor.set(rowKey(r), ids);
      for (const id of ids) wantDocs.add(id);
    }
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
      const k = aiKeyOf(r);
      return { extracts, ai: k ? _ai.get(k)?.v ?? null : null };
    };
    return applyInGuideLines(payload, storedFor);
  } catch {
    // the stores could not be read: the line still comes from the card's own text
    try { return applyInGuideLines(payload, () => null); } catch { return payload; }
  }
}

/** Test helper. */
export function _resetInGuideMemo(): void { _idx = null; _idxInflight = null; _extract.clear(); _ai.clear(); }
