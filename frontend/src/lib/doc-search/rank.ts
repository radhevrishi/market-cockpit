// zzz1051 — DOCUMENT SEARCH: pure ranking, filter and cap helpers (no I/O; tested in zzz1051-doc-search.test.ts).

import type { GuidanceDocKind } from '../guidance-docs-types';

// ── reciprocal rank fusion ───────────────────────────────────────────────────

export const RRF_K = 60;
export type MatchedBy = 'keyword' | 'meaning' | 'both';
export interface Fused { id: number; score: number; keywordRank: number | null; meaningRank: number | null; matched: MatchedBy }

/**
 * Reciprocal rank fusion: score(d) = Σ 1 / (k + rank), rank 1-based, over each list the passage is in.
 * Ties keep the keyword list's order first (exact words beat "means the same" when the evidence is equal).
 */
export function rrfFuse(keywordIds: readonly number[], meaningIds: readonly number[], k = RRF_K): Fused[] {
  const m = new Map<number, Fused>();
  keywordIds.forEach((id, i) => { if (!m.has(id)) m.set(id, { id, score: 1 / (k + i + 1), keywordRank: i + 1, meaningRank: null, matched: 'keyword' }); });
  meaningIds.forEach((id, i) => {
    const e = m.get(id);
    if (e) { if (e.meaningRank == null) { e.meaningRank = i + 1; e.score += 1 / (k + i + 1); e.matched = 'both'; } }
    else m.set(id, { id, score: 1 / (k + i + 1), keywordRank: null, meaningRank: i + 1, matched: 'meaning' });
  });
  return Array.from(m.values()).sort((a, b) => b.score - a.score || (a.keywordRank ?? 1e9) - (b.keywordRank ?? 1e9) || (a.meaningRank ?? 1e9) - (b.meaningRank ?? 1e9));
}

// ── vectors ──────────────────────────────────────────────────────────────────

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { const x = a[i], y = b[i]; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** float32 little-endian bytes (how the fallback mode stores a vector in BYTEA). */
export function encodeVector(v: ArrayLike<number>): Buffer {
  const b = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) b.writeFloatLE(Number(v[i]) || 0, i * 4);
  return b;
}
export function decodeVector(b: Uint8Array | Buffer | null | undefined): Float32Array | null {
  if (!b || b.length < 4 || b.length % 4) return null;
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}
/** '[0.1,0.2,…]' — the literal pgvector reads. */
export function vectorLiteral(v: ArrayLike<number>): string {
  const parts: string[] = [];
  for (let i = 0; i < v.length; i++) parts.push(Number.isFinite(Number(v[i])) ? String(Math.round(Number(v[i]) * 1e7) / 1e7) : '0');
  return `[${parts.join(',')}]`;
}

/** In-process meaning ranking (fallback mode): the best `limit` candidates by cosine similarity, highest first. */
export function rankByCosine(query: ArrayLike<number>, cands: ReadonlyArray<{ id: number; vec: ArrayLike<number> | null }>, limit = 100, minSim = 0.15): Array<{ id: number; sim: number }> {
  const out: Array<{ id: number; sim: number }> = [];
  for (const c of cands) {
    if (!c.vec || c.vec.length !== query.length) continue;
    const sim = cosine(query, c.vec);
    if (sim >= minSim) out.push({ id: c.id, sim });
  }
  return out.sort((a, b) => b.sim - a.sim || a.id - b.id).slice(0, limit);
}

// ── filters ──────────────────────────────────────────────────────────────────

export const DOC_KINDS: readonly GuidanceDocKind[] = ['TRANSCRIPT', 'PRESENTATION', 'RESULTS_RELEASE', 'AGM_SPEECH', 'OTHER_COMPANY_DOC'];
export interface SearchFilters {
  market?: 'IN' | 'US';
  from?: string;        // YYYY-MM-DD
  to?: string;
  kinds?: GuidanceDocKind[];
  tickers?: string[];
  quarter?: string;     // 'Q1 FY27' | 'Q2 2026'
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Canonical ticker: upper case, exchange prefix / suffix removed. */
export function canonTicker(t: unknown): string | null {
  const s = String(t ?? '').toUpperCase().trim().replace(/^(?:NSE|BSE|NASDAQ|NYSE|AMEX)\s*:\s*/, '').replace(/\.(?:NS|BO)$/, '');
  return /^[A-Z0-9&.\-_]{1,24}$/.test(s) ? s : null;
}

/** Parses URL search params into checked filters; anything malformed is left out (never passed to SQL as text). */
export function parseFilters(sp: URLSearchParams): SearchFilters {
  const f: SearchFilters = {};
  const m = sp.get('market');
  if (m === 'IN' || m === 'US') f.market = m;
  const from = sp.get('from'), to = sp.get('to');
  if (from && DATE_RE.test(from)) f.from = from;
  if (to && DATE_RE.test(to)) f.to = to;
  const kinds = (sp.get('kinds') || '').split(',').map((s) => s.trim().toUpperCase()).filter((k): k is GuidanceDocKind => (DOC_KINDS as readonly string[]).includes(k));
  if (kinds.length) f.kinds = Array.from(new Set(kinds));
  const tickers = (sp.get('tickers') || '').split(',').map(canonTicker).filter((t): t is string => !!t);
  if (tickers.length) f.tickers = Array.from(new Set(tickers)).slice(0, 500);
  const q = (sp.get('quarter') || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^Q[1-4] (?:FY\d{2}|\d{4})$/.test(q)) f.quarter = q;
  return f;
}

/** SQL WHERE parts for the chunk table (alias `c`), parameters numbered from `start`. Values are always parameters. */
export function filterSql(f: SearchFilters, start: number, alias = 'c'): { where: string[]; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  const p = (v: any) => { params.push(v); return `$${start + params.length - 1}`; };
  if (f.market) where.push(`${alias}.market = ${p(f.market)}`);
  if (f.from) where.push(`${alias}.filed_at >= ${p(f.from)}::date`);
  if (f.to) where.push(`${alias}.filed_at <= ${p(f.to)}::date`);
  if (f.kinds?.length) where.push(`${alias}.kind = ANY(${p(f.kinds)}::text[])`);
  if (f.tickers?.length) where.push(`${alias}.ticker = ANY(${p(f.tickers)}::text[])`);
  if (f.quarter) where.push(`${alias}.quarter = ${p(f.quarter)}`);
  return { where, params };
}

/** Same filters applied in process (tests, and a guard on rows read back). */
export function matchesFilters(r: { market: string; filed_at?: string | null; kind?: string | null; ticker?: string | null; quarter?: string | null }, f: SearchFilters): boolean {
  if (f.market && r.market !== f.market) return false;
  const d = String(r.filed_at || '').slice(0, 10);
  if (f.from && (!d || d < f.from)) return false;
  if (f.to && (!d || d > f.to)) return false;
  if (f.kinds?.length && !f.kinds.includes(r.kind as GuidanceDocKind)) return false;
  if (f.tickers?.length && !f.tickers.includes(String(r.ticker || ''))) return false;
  if (f.quarter && r.quarter !== f.quarter) return false;
  return true;
}

// ── query words ──────────────────────────────────────────────────────────────

const STOP = new Set('a an and are as at be by for from has have in into is it its of on or that the their this to was were will with who what which companies company talking about above below over under than more less this quarter guided guide said says'.split(' '));

/** Content words of a query (lower case, ≥ 2 chars, stop words and filler like "companies talking about" removed). */
export function queryTerms(q: string): string[] {
  const words = String(q || '').toLowerCase().replace(/[^a-z0-9%&\s-]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w));
  return Array.from(new Set(words)).slice(0, 12);
}

/** The loose form of a query for a second keyword pass: any of its content words ("a or b or c"). '' when nothing is left. */
export function orQueryText(q: string): string {
  const t = queryTerms(q).filter((w) => /[a-z]/.test(w) && !w.includes('-'));
  return t.length >= 2 ? t.join(' or ') : '';
}

/** Word stems the page highlights (a crude prefix, so "expanding" lights up for "expansion"). */
export function highlightStems(q: string): string[] {
  return queryTerms(q).filter((w) => /[a-z]/.test(w)).map((w) => (w.length > 6 ? w.slice(0, Math.max(5, w.length - 4)) : w));
}

/** The most query-dense window of a passage (≈ `chars` long, cut at word edges) for the result list. */
export function bestWindow(body: string, stems: readonly string[], chars = 700): string {
  const t = String(body || '');
  if (t.length <= chars) return t;
  if (!stems.length) return t.slice(0, chars).replace(/\s+\S*$/, '') + ' …';
  const re = new RegExp(`\\b(?:${stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const hits: number[] = [];
  for (let m = re.exec(t); m; m = re.exec(t)) { hits.push(m.index); if (re.lastIndex === m.index) re.lastIndex++; }
  if (!hits.length) return t.slice(0, chars).replace(/\s+\S*$/, '') + ' …';
  let best = 0, bestN = -1;
  for (const h of hits) {
    const s = Math.max(0, h - Math.round(chars / 3));
    const n = hits.filter((x) => x >= s && x < s + chars).length;
    if (n > bestN) { bestN = n; best = s; }
  }
  let s = best, e = Math.min(t.length, best + chars);
  if (s > 0) { const sp = t.indexOf(' ', s); s = sp > 0 && sp < s + 40 ? sp + 1 : s; }
  if (e < t.length) { const sp = t.lastIndexOf(' ', e); e = sp > s ? sp : e; }
  return (s > 0 ? '… ' : '') + t.slice(s, e) + (e < t.length ? ' …' : '');
}

// ── daily spend ceilings ─────────────────────────────────────────────────────

/** A ceiling from an env value: a number ≥ 0, else the default. (0 = that spend is switched off.) */
export function capFromEnv(raw: string | undefined, dflt: number): number {
  if (raw == null || raw === '') return dflt;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}
/** Whether a call that will cost about `estimateUsd` may go ahead: only when it keeps today's spend within the ceiling. */
export function capAllows(spentUsd: number, capUsd: number, estimateUsd: number): { allowed: boolean; reason?: string } {
  if (!(capUsd > 0)) return { allowed: false, reason: 'switched off (ceiling is $0)' };
  if (spentUsd >= capUsd || spentUsd + Math.max(0, estimateUsd) > capUsd) return { allowed: false, reason: `today's ceiling reached ($${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)})` };
  return { allowed: true };
}
/** Embedding cost: tokens × $/M (text-embedding-3-small: $0.02 per million). Tokens estimated as chars ÷ 4 before the call. */
export const EMBED_USD_PER_M = 0.02;
export const estimateTokens = (texts: readonly string[]) => Math.ceil(texts.reduce((n, t) => n + String(t || '').length, 0) / 4);
export const embedUsd = (tokens: number) => (Math.max(0, tokens) * EMBED_USD_PER_M) / 1_000_000;

// ── index decisions ──────────────────────────────────────────────────────────

/** How much of a document the index holds: the full text the collector sent, the stored guidance excerpts, only the extracted guidance quotes, or nothing. */
export type SourceLevel = 'full' | 'passages' | 'quotes' | 'none';
const LEVEL_RANK: Record<SourceLevel, number> = { full: 3, passages: 2, quotes: 1, none: 0 };
/** Index again only when the text changed AND the new copy is not poorer than the one held (never trade a full transcript for excerpts). */
export function shouldReindex(existing: { level: SourceLevel; hash: string } | null, incoming: { level: SourceLevel; hash: string }): boolean {
  if (!existing) return true;
  if (existing.hash === incoming.hash) return false;
  return LEVEL_RANK[incoming.level] >= LEVEL_RANK[existing.level];
}
