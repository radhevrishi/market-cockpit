/**
 * zzz855 — opt-in lean response shapes for heavy list endpoints.
 *
 * Every endpoint keeps its full response by default. A caller that only renders a list can ask for less:
 *   ?view=lean        rows keep a documented list-view field set (values unchanged, fields dropped)
 *   ?view=summary     counts / timestamps / status only, no row arrays (where the endpoint supports it)
 *   ?fields=a,b,c     rows keep exactly these fields (overrides the lean set)
 *   ?limit=N          at most N rows (order unchanged)
 *   ?tickers=A,B      (quotes) only these tickers in `stocks`
 * Projection never rewrites a value: a missing field stays missing (unknown is not zero).
 */

export type ListView = 'full' | 'lean' | 'summary';

export interface ListOptions {
  view: ListView;
  fields: string[] | null;
  limit: number | null;
  tickers: Set<string> | null;
}

const MAX_LIMIT = 5000;

export function parseListOptions(sp: URLSearchParams): ListOptions {
  const v = (sp.get('view') || '').toLowerCase();
  const view: ListView = v === 'lean' ? 'lean' : v === 'summary' ? 'summary' : 'full';
  const fRaw = sp.get('fields');
  const fields = fRaw ? fRaw.split(',').map((x) => x.trim()).filter(Boolean) : null;
  const lRaw = sp.get('limit');
  const lNum = lRaw != null && lRaw !== '' ? Number(lRaw) : NaN;
  const limit = Number.isFinite(lNum) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(lNum))) : null;
  const tRaw = sp.get('tickers') || sp.get('symbols');
  const tickers = tRaw
    ? new Set(tRaw.split(',').map((t) => t.trim().toUpperCase().replace(/\.(NS|BO)$/i, '')).filter(Boolean))
    : null;
  return { view, fields: fields && fields.length ? fields : null, limit, tickers };
}

export function isDefaultShape(o: ListOptions): boolean {
  return o.view === 'full' && !o.fields && o.limit == null && !o.tickers;
}

/** Keep only `keys` that exist on the row (absent stays absent). Non-objects pass through. */
export function pick<T extends Record<string, any>>(row: T, keys: readonly string[]): Partial<T> {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, any> = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = (row as any)[k];
  return out as Partial<T>;
}

function rowsOf(rows: any[], o: ListOptions, leanKeys: readonly string[], leanRow?: (r: any) => any): any[] {
  let out = rows;
  if (o.limit != null) out = out.slice(0, o.limit);
  if (o.fields) return out.map((r) => pick(r, o.fields!));
  if (o.view === 'lean') return out.map((r) => (leanRow ? leanRow(r) : pick(r, leanKeys)));
  return out;
}

// ─── /api/market/quotes ─────────────────────────────────────────────────────

/** Row fields a movers / watchlist / ticker-bar list needs. */
export const QUOTE_LEAN_FIELDS = [
  'ticker', 'company', 'sector', 'price', 'change', 'changePercent', 'volume', 'marketCap', 'previousClose',
  'yearHigh', 'yearLow', 'indexGroup', 'turnoverLacs', 'staleEOD',
] as const;

/** quotes already handles fields= and limit= itself; this adds view= and tickers=. */
export function parseQuotesListOptions(sp: URLSearchParams): ListOptions {
  const o = parseListOptions(sp);
  return { ...o, fields: null, limit: null };   // fields/limit keep the route's own (PATCH 1081) semantics
}

export function shapeQuotesPayload(data: any, o: ListOptions): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (o.view === 'full' && !o.tickers) return data;
  const out: any = { ...data };
  if (o.tickers && Array.isArray(out.stocks)) {
    out.stocks = out.stocks.filter((s: any) => o.tickers!.has(String(s?.ticker || '').toUpperCase().replace(/\.(NS|BO)$/i, '')));
  }
  if (o.view === 'summary') {
    if (!o.tickers) delete out.stocks;
    out.view = 'summary';
    return out;
  }
  if (o.view === 'lean') {
    for (const k of ['stocks', 'gainers', 'losers']) {
      if (Array.isArray(out[k])) out[k] = out[k].map((r: any) => pick(r, QUOTE_LEAN_FIELDS));
    }
    delete out._diag;
    out.view = 'lean';
  }
  return out;
}

// ─── /api/v1/concall-intel/live-feed ────────────────────────────────────────

export const LIVE_FEED_LEAN_FIELDS = [
  'exchange', 'symbol', 'company_name', 'subject', 'filing_datetime', 'source_url', 'category', 'subcategory',
  'filing_type', 'is_high_bullish', 'scored_from', 'content_hash',
] as const;

function leanFiling(f: any): any {
  const out: any = pick(f, LIVE_FEED_LEAN_FIELDS);
  if (Array.isArray(f?.attachment_urls)) out.attachment_urls = f.attachment_urls.slice(0, 1);
  if (f?.bullish && typeof f.bullish === 'object') {
    const b = f.bullish;
    out.bullish = pick(b, ['score', 'raw_score', 'sentiment', 'tier', 'confidence', 'tags', 'critical_blocker']);
    if (b.components && typeof b.components === 'object' && 'composite_score' in b.components) {
      out.bullish.components = { composite_score: b.components.composite_score };
    }
  }
  if (f?.sector_overlay && typeof f.sector_overlay === 'object') {
    // keep the label-level overlay only, drop the matched evidence sentences
    const so = pick(f.sector_overlay, ['sector', 'sector_confidence', 'overlay_score', 'positive_signals', 'negative_signals']);
    if (Object.keys(so).length) out.sector_overlay = so;
  }
  return out;
}

export function shapeLiveFeedPayload(payload: any, o: ListOptions): any {
  if (!payload || typeof payload !== 'object' || isDefaultShape(o)) return payload;
  const filings: any[] = Array.isArray(payload.filings) ? payload.filings : [];
  if (o.view === 'summary') {
    const { filings: _f, theme_clusters: _t, ...rest } = payload;
    return { ...rest, filings: [], theme_clusters_count: Array.isArray(payload.theme_clusters) ? payload.theme_clusters.length : 0, view: 'summary' };
  }
  const out: any = { ...payload, filings: rowsOf(filings, o, LIVE_FEED_LEAN_FIELDS, leanFiling) };
  if (o.view === 'lean' && Array.isArray(payload.theme_clusters)) {
    out.theme_clusters = payload.theme_clusters.map((c: any) => pick(c, ['key', 'kind', 'label', 'company_count', 'filing_count', 'avg_score', 'top_companies', 'conviction', 'sectors']));
  }
  if (o.limit != null) out.filings_total = filings.length;
  if (o.view !== 'full' || o.fields) out.view = o.fields ? 'fields' : o.view;
  return out;
}

// ─── /api/v1/news ───────────────────────────────────────────────────────────

export const NEWS_LEAN_FIELDS = [
  'id', 'title', 'headline', 'summary', 'source_name', 'source', 'source_url', 'url', 'published_at', 'region',
  'article_type', 'investment_tier', 'tickers', 'ticker_symbols', 'primary_ticker', 'importance_score', 'sentiment',
  'bottleneck_sub_tag', 'bottleneck_level', 'freshness_layer', 'structural_state', 'is_synthetic', 'structural_status',
  'feed_layer', 'impact_label_safe', 'evidence_bound_impact', 'lifecycle', 'lifecycle_state',
] as const;

/** For the plain article-array responses of /api/v1/news. Returns the array unchanged by default. */
export function shapeNewsArticles(articles: any[], o: ListOptions): any[] {
  if (!Array.isArray(articles) || isDefaultShape(o) || o.view === 'summary') return articles;
  return rowsOf(articles, o, NEWS_LEAN_FIELDS);
}

// ─── /api/v1/multibagger/snapshot ───────────────────────────────────────────

/** Weak validator for the snapshot GET: changes whenever the snapshot row is rewritten. */
export function snapshotEtag(clientId: string, market: string, updatedAt: string | Date): string {
  const t = new Date(updatedAt as any).getTime();
  return `W/"mb-${clientId}-${market}-${Number.isFinite(t) ? t : String(updatedAt)}"`;
}

export function etagMatches(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  const norm = (x: string) => x.trim().replace(/^W\//, '');
  return header.split(',').some((h) => h.trim() === '*' || norm(h) === norm(etag));
}
