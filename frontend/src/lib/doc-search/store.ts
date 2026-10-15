// ═══════════════════════════════════════════════════════════════════════════
// zzz1051 — DOCUMENT SEARCH: the Postgres index and the search itself (server only).
//
// WHERE THE TEXT COMES FROM — the companies' own documents the guidance collectors already gather (India BSE/NSE call
// transcripts, investor presentations, results releases, AGM speeches; US 8-K exhibits / call transcripts from EDGAR):
//   1. at ingest (/api/v1/guidance-docs/ingest): the FULL text the collector sent (≤ SEARCH_DOC_CHARS) — level 'full'.
//      The KV store keeps only ≤ 30k chars of guidance excerpts, and drops even those after extraction, so this is the
//      one moment the whole document is in hand.
//   2. the hourly job, for documents ingested before this existed: the stored excerpts while KV still holds them
//      ('passages'), else the verbatim quotes the AI extractor filed (Postgres ai_extraction, 'quotes'), else nothing
//      ('none', looked at again after 3 days). A later re-collect (scrape-guidance-docs.yml recollect_tickers) sends the
//      full text again and upgrades the document. A poorer copy never replaces a richer one (rank.shouldReindex).
//
// INDEX — own tables, created here (not in lib/db-migrate MIGRATIONS): `CREATE EXTENSION vector` can fail on a Postgres
// without pgvector, and inside the shared migration chain that failure would block every later migration.
//   search_doc    one row per document (hash of the indexed text, level, chunk count)
//   search_chunk  one row per passage: body + filters (market, ticker, kind, filed_at, quarter, speaker, page, section)
//                 + tsv (generated: ticker/company weight A, body weight B, 'english') with a GIN index
//                 + the meaning vector: `emb_v vector(512)` with an HNSW cosine index when pgvector is available,
//                   else `emb` BYTEA (float32) scored in process over a filtered candidate set.
//   search_spend  today's embedding / rerank dollars (the daily ceilings)
//   search_meta   last index run
//
// SEARCH — keyword (websearch_to_tsquery + ts_rank_cd; a looser "any word" pass fills in when the strict one finds
// few) and meaning (the query embedded once, nearest passages), fused by reciprocal rank, optionally reranked by the
// cheap model under its own ceiling. All filters are SQL parameters.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { getPool, dbQuery } from '../db';
import { chunkDocument, quarterLabel } from './chunker';
import {
  rrfFuse, rankByCosine, decodeVector, encodeVector, vectorLiteral, filterSql, queryTerms, orQueryText, highlightStems,
  bestWindow, capFromEnv, capAllows, estimateTokens, embedUsd, shouldReindex, type SearchFilters, type SourceLevel, type MatchedBy,
} from './rank';
import type { GuidanceDoc, GuidanceDocIndexRow, GuidanceDocKind } from '../guidance-docs-types';

export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIMS = 512;
const LOCK_ID = 88_310_510;

export const embedDailyCapUsd = () => capFromEnv(process.env.SEARCH_EMBED_DAILY_USD, 0.10);
export const rerankDailyCapUsd = () => capFromEnv(process.env.SEARCH_RERANK_DAILY_USD, 0.05);
const docCharsCap = () => Math.min(400_000, Math.max(20_000, Number(process.env.SEARCH_DOC_CHARS) || 150_000));
const keepDays = () => Math.max(90, Number(process.env.SEARCH_KEEP_DAYS) || 730);
const fallbackCandidates = () => Math.min(20_000, Math.max(500, Number(process.env.SEARCH_FALLBACK_CANDIDATES) || 4_000));

// ── schema ───────────────────────────────────────────────────────────────────

export interface SchemaState { ok: boolean; vector: boolean; reason?: string }
let _schema: Promise<SchemaState> | null = null;

export function ensureSearchSchema(): Promise<SchemaState> {
  if (_schema) return _schema;
  _schema = (async (): Promise<SchemaState> => {
    const pool = getPool();
    if (!pool) return { ok: false, vector: false, reason: 'Postgres is not configured' };
    const c = await pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
      await c.query(`
        CREATE TABLE IF NOT EXISTS search_doc (
          doc_id        TEXT PRIMARY KEY,
          market        TEXT NOT NULL,
          ticker        TEXT,
          company       TEXT,
          kind          TEXT,
          title         TEXT,
          url           TEXT,
          filed_at      DATE,
          quarter       TEXT,
          source_level  TEXT NOT NULL,
          text_hash     TEXT NOT NULL,
          chars         INTEGER NOT NULL DEFAULT 0,
          chunk_count   INTEGER NOT NULL DEFAULT 0,
          indexed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS search_doc_filed_idx ON search_doc (filed_at DESC);
        CREATE TABLE IF NOT EXISTS search_chunk (
          id           BIGSERIAL PRIMARY KEY,
          doc_id       TEXT NOT NULL REFERENCES search_doc(doc_id) ON DELETE CASCADE,
          seq          INTEGER NOT NULL,
          market       TEXT NOT NULL,
          ticker       TEXT,
          company      TEXT,
          kind         TEXT,
          filed_at     DATE,
          quarter      TEXT,
          speaker      TEXT,
          page         INTEGER,
          section      TEXT,
          body         TEXT NOT NULL,
          words        INTEGER NOT NULL DEFAULT 0,
          tsv          tsvector GENERATED ALWAYS AS (
                         setweight(to_tsvector('english', coalesce(ticker, '') || ' ' || coalesce(company, '')), 'A') ||
                         setweight(to_tsvector('english', body), 'B')) STORED,
          emb          BYTEA,
          embedded_at  TIMESTAMPTZ,
          embed_model  TEXT,
          UNIQUE (doc_id, seq)
        );
        CREATE INDEX IF NOT EXISTS search_chunk_tsv_idx ON search_chunk USING GIN (tsv);
        CREATE INDEX IF NOT EXISTS search_chunk_filter_idx ON search_chunk (market, filed_at DESC);
        CREATE INDEX IF NOT EXISTS search_chunk_ticker_idx ON search_chunk (ticker, filed_at DESC);
        CREATE INDEX IF NOT EXISTS search_chunk_todo_idx ON search_chunk (filed_at DESC) WHERE embedded_at IS NULL;
        CREATE TABLE IF NOT EXISTS search_spend (
          day    DATE NOT NULL,
          kind   TEXT NOT NULL,
          usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
          tokens BIGINT NOT NULL DEFAULT 0,
          calls  INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, kind)
        );
        CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
      // pgvector, when this Postgres has it. Each step on its own: a missing extension must not undo the tables above.
      let vector = false;
      let reason: string | undefined;
      if (String(process.env.SEARCH_EMBED_MODE || '').toLowerCase() !== 'fallback') {
        try { await c.query('CREATE EXTENSION IF NOT EXISTS vector'); } catch (e: any) { reason = `pgvector not available (${String(e?.message || e).slice(0, 120)})`; }
        const has = (await c.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`)).rowCount;
        if (has) {
          try {
            await c.query(`ALTER TABLE search_chunk ADD COLUMN IF NOT EXISTS emb_v vector(${EMBED_DIMS})`);
            await c.query(`CREATE INDEX IF NOT EXISTS search_chunk_emb_hnsw ON search_chunk USING hnsw (emb_v vector_cosine_ops)`);
            vector = true; reason = undefined;
          } catch (e: any) { reason = `pgvector column/index failed (${String(e?.message || e).slice(0, 120)})`; }
        }
      } else reason = 'SEARCH_EMBED_MODE=fallback';
      return { ok: true, vector, reason };
    } catch (e: any) {
      _schema = null;   // try again next call
      return { ok: false, vector: false, reason: `schema failed: ${String(e?.message || e).slice(0, 160)}` };
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
      c.release();
    }
  })().catch((e) => { _schema = null; return { ok: false, vector: false, reason: String(e?.message || e).slice(0, 160) }; });
  return _schema;
}

export type EmbedMode = 'pgvector' | 'in-process' | 'off';
export async function embedMode(): Promise<{ mode: EmbedMode; why: string }> {
  const s = await ensureSearchSchema();
  if (!s.ok) return { mode: 'off', why: s.reason || 'no database' };
  const { embeddingsConfigured } = await import('../anthropic-meter');
  if (!embeddingsConfigured()) return { mode: 'off', why: 'no OPENAI_API_KEY — keyword search only' };
  if (!(embedDailyCapUsd() > 0)) return { mode: 'off', why: 'SEARCH_EMBED_DAILY_USD is 0 — keyword search only' };
  return s.vector
    ? { mode: 'pgvector', why: 'pgvector HNSW index in Postgres' }
    : { mode: 'in-process', why: `${s.reason || 'pgvector not available'} — vectors stored as bytes and scored in the app over a filtered candidate set` };
}

// ── spend ────────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);
export async function spentToday(kind: 'embed' | 'rerank'): Promise<number> {
  const r = await dbQuery<{ usd: number }>('SELECT usd FROM search_spend WHERE day = $1::date AND kind = $2', [today(), kind]).catch(() => []);
  return Number(r[0]?.usd) || 0;
}
export async function addSpend(kind: 'embed' | 'rerank', usd: number, tokens: number): Promise<void> {
  await dbQuery(
    `INSERT INTO search_spend (day, kind, usd, tokens, calls) VALUES ($1::date, $2, $3, $4, 1)
     ON CONFLICT (day, kind) DO UPDATE SET usd = search_spend.usd + EXCLUDED.usd, tokens = search_spend.tokens + EXCLUDED.tokens, calls = search_spend.calls + 1`,
    [today(), kind, usd, Math.round(tokens)],
  ).catch((e) => console.error('[doc-search] spend not recorded:', String(e?.message || e).slice(0, 120)));
}

/** Embeds texts within today's ceiling. Returns null (and why) when the ceiling or the key says no. */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][] | null; usd: number; why?: string }> {
  const est = embedUsd(estimateTokens(texts));
  const gate = capAllows(await spentToday('embed'), embedDailyCapUsd(), est);
  if (!gate.allowed) return { vectors: null, usd: 0, why: `embedding ${gate.reason}` };
  const { openaiEmbeddings } = await import('../anthropic-meter');
  const r = await openaiEmbeddings('doc-search-embed', texts.map((t) => t.slice(0, 24_000)), { model: EMBED_MODEL, dimensions: EMBED_DIMS, signal });
  if (r.usd > 0 || r.tokens > 0) await addSpend('embed', r.usd || embedUsd(r.tokens), r.tokens);
  if (!r.ok) return { vectors: null, usd: r.usd, why: r.error || `HTTP ${r.status}` };
  return { vectors: r.vectors, usd: r.usd };
}

// ── indexing ─────────────────────────────────────────────────────────────────

export interface DocMeta { docId: string; market: 'IN' | 'US'; ticker: string | null; company: string; kind: GuidanceDocKind; title: string; url: string; filedAt: string; periodHint?: string | null }
export const textHash = (t: string) => createHash('sha1').update(t).digest('hex');

/** Index one document at `level`. Skips when the same text is held, or a richer copy is. Returns the passages written (0 = skipped / empty). */
export async function indexDocument(meta: DocMeta, text: string, level: SourceLevel): Promise<number> {
  const s = await ensureSearchSchema();
  if (!s.ok) return 0;
  const body = String(text || '').slice(0, docCharsCap());
  const hash = textHash(`${level}:${body}`);
  const prev = await dbQuery<{ source_level: SourceLevel; text_hash: string }>('SELECT source_level, text_hash FROM search_doc WHERE doc_id = $1', [meta.docId]).catch(() => []);
  if (!shouldReindex(prev[0] ? { level: prev[0].source_level, hash: prev[0].text_hash } : null, { level, hash })) {
    // still nothing to index: note the look so the hourly job waits another 3 days before trying again
    if (prev[0]?.source_level === 'none') await dbQuery('UPDATE search_doc SET indexed_at = now() WHERE doc_id = $1', [meta.docId]).catch(() => {});
    return 0;
  }
  const chunks = level === 'none' ? [] : chunkDocument(body);
  const filed = String(meta.filedAt || '').slice(0, 10) || null;
  const quarter = quarterLabel(meta.market, meta.filedAt, meta.periodHint);
  const pool = getPool();
  if (!pool) return 0;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO search_doc (doc_id, market, ticker, company, kind, title, url, filed_at, quarter, source_level, text_hash, chars, chunk_count, indexed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13, now())
       ON CONFLICT (doc_id) DO UPDATE SET market = EXCLUDED.market, ticker = EXCLUDED.ticker, company = EXCLUDED.company, kind = EXCLUDED.kind,
         title = EXCLUDED.title, url = EXCLUDED.url, filed_at = EXCLUDED.filed_at, quarter = EXCLUDED.quarter, source_level = EXCLUDED.source_level,
         text_hash = EXCLUDED.text_hash, chars = EXCLUDED.chars, chunk_count = EXCLUDED.chunk_count, indexed_at = now()`,
      [meta.docId, meta.market, meta.ticker, meta.company.slice(0, 200), meta.kind, meta.title.slice(0, 500), meta.url.slice(0, 1000), filed, quarter, level, hash, body.length, chunks.length],
    );
    await c.query('DELETE FROM search_chunk WHERE doc_id = $1', [meta.docId]);
    if (chunks.length) {
      await c.query(
        `INSERT INTO search_chunk (doc_id, seq, market, ticker, company, kind, filed_at, quarter, speaker, page, section, body, words)
         SELECT $1, x.seq, $2, $3, $4, $5, $6::date, $7, x.speaker, x.page, x.section, x.body, x.words
         FROM unnest($8::int[], $9::text[], $10::int[], $11::text[], $12::text[], $13::int[]) AS x(seq, speaker, page, section, body, words)`,
        [meta.docId, meta.market, meta.ticker, meta.company.slice(0, 200), meta.kind, filed, quarter,
          chunks.map((k) => k.seq), chunks.map((k) => k.speaker), chunks.map((k) => k.page), chunks.map((k) => k.section), chunks.map((k) => k.text), chunks.map((k) => k.words)],
      );
    }
    await c.query('COMMIT');
    return chunks.length;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/** Called by the ingest route after a successful store: index the FULL text the collector sent. Never throws. */
export async function indexFromIngest(docs: readonly GuidanceDoc[], rawDocs: unknown): Promise<{ indexed: number; passages: number }> {
  let indexed = 0, passages = 0;
  try {
    const raw = new Map<string, string>();
    if (Array.isArray(rawDocs)) for (const d of rawDocs as any[]) if (d && typeof d.docId === 'string' && typeof d.text === 'string') raw.set(d.docId, d.text);
    for (const d of docs) {
      const full = raw.get(d.docId);
      const text = full && full.length >= (d.text?.length || 0) ? full : d.text || '';
      if (!text.trim()) continue;
      const level: SourceLevel = full ? 'full' : (d.originalChars && d.originalChars > d.textChars ? 'passages' : 'full');
      try { const n = await indexDocument(d, text, level); if (n) { indexed++; passages += n; } }
      catch (e: any) { console.error('[doc-search] ingest index failed for', d.docId, String(e?.message || e).slice(0, 160)); }
    }
  } catch (e: any) { console.error('[doc-search] ingest index failed:', String(e?.message || e).slice(0, 160)); }
  return { indexed, passages };
}

/** Text from the extractor's verified quotes (for documents whose text is gone). '' when none. */
export function quotesText(rows: unknown): string {
  if (!Array.isArray(rows)) return '';
  const parts: string[] = [];
  for (const r of rows as any[]) {
    const q = typeof r?.quote === 'string' ? r.quote.trim() : '';
    if (!q) continue;
    const lab = [r?.metricLabel, r?.period].filter((x) => typeof x === 'string' && x).join(', ');
    const sp = typeof r?.speaker === 'string' && r.speaker ? `${r.speaker}: ` : '';
    parts.push(`${sp}${q}${lab ? ` (${lab})` : ''}`);
  }
  return Array.from(new Set(parts)).join('\n\n');
}

// ── the hourly job ───────────────────────────────────────────────────────────

export interface IndexRunResult {
  ok: boolean; mode: EmbedMode; why: string;
  docsSeen: number; docsProcessed: number; byLevel: Record<string, number>; kvReads: number;
  embedded: number; converted: number; embedUsd: number; embedStop?: string; pruned: number; ms: number; error?: string;
}

const MAX_KV_READS = 150;
const RECHECK_NONE_MS = 3 * 86_400_000;

export async function runIndexJob(opts: { budgetMs?: number } = {}): Promise<IndexRunResult> {
  const t0 = Date.now();
  const deadline = t0 + (opts.budgetMs ?? 8 * 60_000);
  const res: IndexRunResult = { ok: true, mode: 'off', why: '', docsSeen: 0, docsProcessed: 0, byLevel: {}, kvReads: 0, embedded: 0, converted: 0, embedUsd: 0, pruned: 0, ms: 0 };
  const s = await ensureSearchSchema();
  if (!s.ok) return { ...res, ok: false, why: s.reason || 'no database', ms: Date.now() - t0 };
  try {
    // 1. documents in the guidance store the index does not hold yet
    const store = await import('../guidance-docs-store');
    const kv = store.realDocsKv(15_000);
    const rows: GuidanceDocIndexRow[] = await store.listDocs({}, kv).catch(() => []);
    res.docsSeen = rows.length;
    const held = new Map<string, { level: SourceLevel; at: number }>();
    for (const r of await dbQuery<{ doc_id: string; source_level: SourceLevel; indexed_at: string }>('SELECT doc_id, source_level, indexed_at FROM search_doc')) {
      held.set(r.doc_id, { level: r.source_level, at: new Date(r.indexed_at).getTime() });
    }
    const todo = rows.filter((r) => { const h = held.get(r.docId); return !h || (h.level === 'none' && Date.now() - h.at > RECHECK_NONE_MS); })
      .sort((a, b) => (b.filedAt || '').localeCompare(a.filedAt || ''));
    // the extractor's quotes, for any of them whose text turns out to be gone (one query)
    const gone = todo.slice(0, 5000).map((r) => r.docId);
    const quotes = new Map<string, string>();
    if (gone.length) {
      const q = await dbQuery<{ doc_id: string; rows: any }>('SELECT doc_id, rows FROM ai_extraction WHERE doc_id = ANY($1::text[])', [gone]).catch(() => []);
      for (const x of q) { const t = quotesText(x.rows); if (t) quotes.set(x.doc_id, t); }
    }
    for (const r of todo) {
      if (Date.now() > deadline - 3 * 60_000) break;   // keep time for embeddings
      const meta: DocMeta = { docId: r.docId, market: r.market, ticker: r.ticker, company: r.company, kind: r.kind, title: '', url: r.url, filedAt: r.filedAt };
      let text = '', level: SourceLevel = 'none';
      if (r.textBytes !== 0 && res.kvReads < MAX_KV_READS) {
        res.kvReads++;
        const d = await store.getDoc(r.docId, kv).catch(() => null);
        if (d) { meta.title = d.title || meta.title; meta.periodHint = d.periodHint; }
        if (d?.text && d.text.trim().length >= 50) { text = d.text; level = d.originalChars && d.originalChars > d.textChars ? 'passages' : 'full'; }
      } else if (r.textBytes !== 0) continue;   // read next hour
      if (!text && quotes.has(r.docId)) { text = quotes.get(r.docId)!; level = 'quotes'; }
      try {
        await indexDocument(meta, text, level);
        res.docsProcessed++; res.byLevel[level] = (res.byLevel[level] || 0) + 1;
      } catch (e: any) { console.error('[doc-search] index failed for', r.docId, String(e?.message || e).slice(0, 160)); }
    }
    // 2. meaning vectors for passages that have none
    const m = await embedMode();
    res.mode = m.mode; res.why = m.why;
    if (m.mode === 'pgvector') res.converted = await convertBytesToVector(deadline);
    if (m.mode !== 'off') {
      while (Date.now() < deadline - 20_000) {
        const batch = await dbQuery<{ id: string; body: string; company: string | null; ticker: string | null }>(
          `SELECT id, body, company, ticker FROM search_chunk WHERE embedded_at IS NULL ORDER BY filed_at DESC NULLS LAST, id LIMIT 64`);
        if (!batch.length) break;
        const texts = batch.map((b) => `${b.company || b.ticker || ''}\n${b.body}`);
        const e = await embedTexts(texts, AbortSignal.timeout(60_000));
        if (!e.vectors) { res.embedStop = e.why; break; }
        res.embedUsd += e.usd;
        await writeVectors(batch.map((b) => Number(b.id)), e.vectors, m.mode === 'pgvector');
        res.embedded += batch.length;
      }
    }
    // 3. retention
    const pr = await dbQuery<{ n: string }>(`WITH d AS (DELETE FROM search_doc WHERE filed_at < (now() - ($1::int * interval '1 day'))::date RETURNING 1) SELECT count(*)::text AS n FROM d`, [keepDays()]).catch(() => []);
    res.pruned = Number(pr[0]?.n) || 0;
  } catch (e: any) {
    res.ok = false; res.error = String(e?.message || e).slice(0, 300);
  }
  res.ms = Date.now() - t0;
  await dbQuery(`INSERT INTO search_meta (key, value, updated_at) VALUES ('last_run', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ ...res, at: new Date().toISOString() })]).catch(() => {});
  return res;
}

async function writeVectors(ids: number[], vectors: number[][], pgvector: boolean): Promise<void> {
  if (pgvector) {
    await dbQuery(
      `UPDATE search_chunk c SET emb_v = v.e::vector, emb = NULL, embedded_at = now(), embed_model = $3
       FROM unnest($1::bigint[], $2::text[]) AS v(id, e) WHERE c.id = v.id`,
      [ids, vectors.map(vectorLiteral), `${EMBED_MODEL}:${EMBED_DIMS}`]);
  } else {
    await dbQuery(
      `UPDATE search_chunk c SET emb = v.e, embedded_at = now(), embed_model = $3
       FROM unnest($1::bigint[], $2::bytea[]) AS v(id, e) WHERE c.id = v.id`,
      [ids, vectors.map(encodeVector), `${EMBED_MODEL}:${EMBED_DIMS}`]);
  }
}

/** pgvector arrived after vectors were stored as bytes: move them over (free — no API call). */
async function convertBytesToVector(deadline: number): Promise<number> {
  let n = 0;
  while (Date.now() < deadline - 60_000) {
    const rows = await dbQuery<{ id: string; emb: Buffer }>(`SELECT id, emb FROM search_chunk WHERE emb IS NOT NULL AND emb_v IS NULL LIMIT 500`).catch(() => []);
    if (!rows.length) break;
    const ok = rows.map((r) => ({ id: Number(r.id), v: decodeVector(r.emb) })).filter((x) => x.v && x.v.length === EMBED_DIMS);
    if (!ok.length) break;
    await dbQuery(`UPDATE search_chunk c SET emb_v = v.e::vector, emb = NULL FROM unnest($1::bigint[], $2::text[]) AS v(id, e) WHERE c.id = v.id`,
      [ok.map((x) => x.id), ok.map((x) => vectorLiteral(x.v!))]);
    n += ok.length;
  }
  return n;
}

// ── search ───────────────────────────────────────────────────────────────────

export interface SearchHit {
  id: number; docId: string; market: string; ticker: string | null; company: string | null; kind: string | null; title: string | null; url: string | null;
  filedAt: string | null; quarter: string | null; speaker: string | null; page: number | null; section: string | null; level: string | null;
  snippet: string; text: string; matched: MatchedBy; keywordRank: number | null; meaningRank: number | null; score: number; rerankScore?: number;
}
export interface SearchResponse {
  ok: boolean; q: string; filters: SearchFilters; mode: EmbedMode; modeWhy: string; stems: string[];
  results: SearchHit[]; counts: { keyword: number; keywordLoose: number; meaning: number }; notes: string[];
  rerank?: { used: boolean; usd: number; why?: string };
}

const KW_LIMIT = 100, MEANING_LIMIT = 100;

export async function keywordIds(q: string, f: SearchFilters, limit = KW_LIMIT): Promise<{ strict: number[]; loose: number[] }> {
  const run = async (qt: string) => {
    const fs = filterSql(f, 2);
    const where = [`c.tsv @@ websearch_to_tsquery('english', $1)`, ...fs.where].join(' AND ');
    const rows = await dbQuery<{ id: string }>(
      `SELECT c.id FROM search_chunk c WHERE ${where}
       ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', $1), 32) DESC, c.filed_at DESC NULLS LAST, c.id LIMIT ${Math.min(500, limit)}`,
      [qt, ...fs.params]);
    return rows.map((r) => Number(r.id));
  };
  const strict = await run(q);
  let loose: number[] = [];
  const oq = orQueryText(q);
  if (strict.length < 20 && oq) { const seen = new Set(strict); loose = (await run(oq)).filter((id) => !seen.has(id)); }
  return { strict, loose };
}

export async function meaningIds(qvec: number[], f: SearchFilters, mode: EmbedMode, keywordCands: number[], limit = MEANING_LIMIT): Promise<number[]> {
  if (mode === 'pgvector') {
    const fs = filterSql(f, 2);
    const where = ['c.emb_v IS NOT NULL', ...fs.where].join(' AND ');
    const pool = getPool();
    if (!pool) return [];
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL hnsw.ef_search = 200').catch(() => {});
      const r = await c.query(`SELECT c.id, 1 - (c.emb_v <=> $1::vector) AS sim FROM search_chunk c WHERE ${where} ORDER BY c.emb_v <=> $1::vector LIMIT ${limit}`, [vectorLiteral(qvec), ...fs.params]);
      await c.query('COMMIT');
      return r.rows.filter((x: any) => Number(x.sim) >= 0.15).map((x: any) => Number(x.id));
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }
  if (mode === 'in-process') {
    // candidates: the newest embedded passages that pass the filters, plus every keyword candidate
    const fs = filterSql(f, 1);
    const where = ['c.emb IS NOT NULL', ...fs.where].join(' AND ');
    const recent = await dbQuery<{ id: string; emb: Buffer }>(`SELECT c.id, c.emb FROM search_chunk c WHERE ${where} ORDER BY c.filed_at DESC NULLS LAST LIMIT ${fallbackCandidates()}`, fs.params);
    const have = new Set(recent.map((r) => Number(r.id)));
    const extra = keywordCands.filter((id) => !have.has(id));
    const more = extra.length ? await dbQuery<{ id: string; emb: Buffer }>('SELECT id, emb FROM search_chunk WHERE id = ANY($1::bigint[]) AND emb IS NOT NULL', [extra]) : [];
    const cands = recent.concat(more).map((r) => ({ id: Number(r.id), vec: decodeVector(r.emb) }));
    return rankByCosine(qvec, cands, limit).map((x) => x.id);
  }
  return [];
}

export async function searchDocs(q: string, f: SearchFilters, opts: { limit?: number; rerank?: boolean; meaning?: boolean; keyword?: boolean } = {}): Promise<SearchResponse> {
  const notes: string[] = [];
  const s = await ensureSearchSchema();
  const stems = highlightStems(q);
  const base: SearchResponse = { ok: false, q, filters: f, mode: 'off', modeWhy: '', stems, results: [], counts: { keyword: 0, keywordLoose: 0, meaning: 0 }, notes };
  if (!s.ok) return { ...base, modeWhy: s.reason || 'no database' };
  const m = await embedMode();
  base.mode = m.mode; base.modeWhy = m.why;
  const limit = Math.min(80, Math.max(5, opts.limit ?? 40));
  const kw = opts.keyword === false ? { strict: [], loose: [] } : await keywordIds(q, f);
  base.counts.keyword = kw.strict.length; base.counts.keywordLoose = kw.loose.length;
  let mIds: number[] = [];
  if (opts.meaning !== false && m.mode !== 'off' && queryTerms(q).length) {
    const e = await embedTexts([q], AbortSignal.timeout(15_000));
    if (e.vectors?.[0]) mIds = await meaningIds(e.vectors[0], f, m.mode, kw.strict.concat(kw.loose));
    else notes.push(`Meaning search skipped: ${e.why || 'no vector'}.`);
  }
  base.counts.meaning = mIds.length;
  const fused = rrfFuse(kw.strict.concat(kw.loose), mIds);
  let top = fused.slice(0, opts.rerank ? Math.max(limit, 30) : limit);
  const hits = await loadHits(top.map((x) => x.id));
  let results: SearchHit[] = top.map((x) => {
    const h = hits.get(x.id);
    return h ? { ...h, snippet: bestWindow(h.text, stems), matched: x.matched, keywordRank: x.keywordRank, meaningRank: x.meaningRank, score: Math.round(x.score * 1e5) / 1e5 } : null;
  }).filter((x): x is SearchHit => !!x);
  if (opts.rerank && results.length > 1) {
    const { rerankHits } = await import('./rerank');
    const rr = await rerankHits(q, results.slice(0, 30));
    base.rerank = { used: rr.used, usd: rr.usd, ...(rr.why ? { why: rr.why } : {}) };
    if (rr.used) results = rr.hits.concat(results.slice(30));
    else notes.push(`Reranker not used: ${rr.why}.`);
  }
  results = results.slice(0, limit);
  if (!results.length && !kw.strict.length && !mIds.length) notes.push('Nothing matched. Try fewer words, a wider date range, or switch off filters.');
  return { ...base, ok: true, results };
}

async function loadHits(ids: number[]): Promise<Map<number, Omit<SearchHit, 'snippet' | 'matched' | 'keywordRank' | 'meaningRank' | 'score'>>> {
  const out = new Map<number, any>();
  if (!ids.length) return out;
  const rows = await dbQuery<any>(
    `SELECT c.id, c.doc_id, c.market, c.ticker, c.company, c.kind, c.filed_at::text AS filed_at, c.quarter, c.speaker, c.page, c.section, c.body,
            d.title, d.url, d.source_level
     FROM search_chunk c JOIN search_doc d ON d.doc_id = c.doc_id WHERE c.id = ANY($1::bigint[])`, [ids]);
  for (const r of rows) out.set(Number(r.id), {
    id: Number(r.id), docId: r.doc_id, market: r.market, ticker: r.ticker, company: r.company, kind: r.kind, title: r.title, url: r.url,
    filedAt: r.filed_at, quarter: r.quarter, speaker: r.speaker, page: r.page == null ? null : Number(r.page), section: r.section, level: r.source_level, text: r.body,
  });
  return out;
}

// ── coverage ─────────────────────────────────────────────────────────────────

export interface Coverage {
  ok: boolean; why?: string; mode: EmbedMode; modeWhy: string;
  storeDocs: number; indexedDocs: number; docsWithPassages: number; byLevel: Record<string, number>; byMarket: Record<string, number>;
  passages: number; embedded: number; newest: string | null; oldest: string | null;
  spend: { embedToday: number; embedCap: number; rerankToday: number; rerankCap: number };
  lastRun: any;
}
export async function coverage(): Promise<Coverage> {
  const s = await ensureSearchSchema();
  const m = await embedMode();
  const spend = { embedToday: 0, embedCap: embedDailyCapUsd(), rerankToday: 0, rerankCap: rerankDailyCapUsd() };
  const empty: Coverage = { ok: false, why: s.reason, mode: m.mode, modeWhy: m.why, storeDocs: 0, indexedDocs: 0, docsWithPassages: 0, byLevel: {}, byMarket: {}, passages: 0, embedded: 0, newest: null, oldest: null, spend, lastRun: null };
  if (!s.ok) return empty;
  const [lv, mk, ch, rng, meta, sp, storeN] = await Promise.all([
    dbQuery<{ source_level: string; n: string }>('SELECT source_level, count(*)::text AS n FROM search_doc GROUP BY 1'),
    dbQuery<{ market: string; n: string }>('SELECT market, count(*)::text AS n FROM search_doc WHERE chunk_count > 0 GROUP BY 1'),
    dbQuery<{ n: string; e: string }>('SELECT count(*)::text AS n, count(embedded_at)::text AS e FROM search_chunk'),
    dbQuery<{ lo: string | null; hi: string | null }>('SELECT min(filed_at)::text AS lo, max(filed_at)::text AS hi FROM search_doc WHERE chunk_count > 0'),
    dbQuery<{ value: any }>(`SELECT value FROM search_meta WHERE key = 'last_run'`).catch(() => []),
    dbQuery<{ kind: string; usd: number }>('SELECT kind, usd FROM search_spend WHERE day = $1::date', [today()]).catch(() => []),
    import('../guidance-docs-store').then((st) => st.storageStats(st.realDocsKv(15_000))).then((x) => x.docs).catch(() => 0),
  ]);
  const byLevel: Record<string, number> = {};
  let indexedDocs = 0, withP = 0;
  for (const r of lv) { byLevel[r.source_level] = Number(r.n); indexedDocs += Number(r.n); if (r.source_level !== 'none') withP += Number(r.n); }
  const byMarket: Record<string, number> = {};
  for (const r of mk) byMarket[r.market] = Number(r.n);
  for (const r of sp) { if (r.kind === 'embed') spend.embedToday = Number(r.usd) || 0; if (r.kind === 'rerank') spend.rerankToday = Number(r.usd) || 0; }
  return {
    ok: true, mode: m.mode, modeWhy: m.why, storeDocs: storeN, indexedDocs, docsWithPassages: withP, byLevel, byMarket,
    passages: Number(ch[0]?.n) || 0, embedded: Number(ch[0]?.e) || 0, newest: rng[0]?.hi ?? null, oldest: rng[0]?.lo ?? null, spend, lastRun: meta[0]?.value ?? null,
  };
}
