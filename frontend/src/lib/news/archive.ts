// zzz1179 — NEWS ARCHIVE. The live feed keeps only a few days; themes need weeks to measure momentum. Every hour the saved
// feed (news:articles:v39:lastgood — no outside fetch) is copied into Postgres table news_archive, kept 180 days.
// Server-only. Without Postgres, readers fall back to the live feed alone.
export interface ArchivedNews {
  id: string; publishedAt: string; title: string; summary: string | null; source: string | null; url: string | null;
  region: string | null; tickers: string[]; importance: number | null; bottleneck: string | null; sentiment: string | null;
}
const KEEP_DAYS = 180;

export function toArchived(a: any): ArchivedNews | null {
  const title = String(a?.title || a?.headline || '').replace(/\s+/g, ' ').trim();
  const at = Date.parse(a?.published_at || a?.publishedAt || '');
  if (title.length < 12 || !Number.isFinite(at)) return null;
  const id = String(a?.id || a?.source_url || title).slice(0, 300);
  const tick = (Array.isArray(a?.ticker_symbols) ? a.ticker_symbols : Array.isArray(a?.tickers) ? a.tickers : []).map((t: any) => String(t?.symbol ?? t ?? '').toUpperCase()).filter((t: string) => /^[A-Z0-9&.-]{1,15}$/.test(t)).slice(0, 12);
  return {
    id, publishedAt: new Date(at).toISOString(), title: title.slice(0, 400), summary: a?.summary ? String(a.summary).replace(/\s+/g, ' ').slice(0, 600) : null,
    source: a?.source_name || a?.source || null, url: typeof a?.source_url === 'string' ? a.source_url : null, region: a?.region || null, tickers: tick,
    importance: typeof a?.importance_score === 'number' ? a.importance_score : null, bottleneck: a?.bottleneck_level ? String(a.bottleneck_level) : null,
    sentiment: typeof a?.sentiment === 'string' ? a.sentiment : (a?.sentiment?.label ?? null),
  };
}

async function liveFeed(): Promise<ArchivedNews[]> {
  const { kvGet } = await import('../kv');
  const { NEWS_SHARED_LASTGOOD_KEY } = await import('../guidance-upgrades-cache');
  const v: any = await Promise.race([kvGet<any>(NEWS_SHARED_LASTGOOD_KEY).catch(() => null), new Promise((r) => setTimeout(() => r(null), 5000))]);
  const arts: any[] = Array.isArray(v) ? v : Array.isArray(v?.articles) ? v.articles : [];
  return arts.map(toArchived).filter((x): x is ArchivedNews => !!x);
}

async function db(): Promise<boolean> { try { return await (await import('../db-migrate')).ensureSchema(); } catch { return false; } }

/** Copy the live feed into the archive (new rows only; importance refreshed). */
export async function archiveNews(): Promise<{ ok: boolean; seen: number; error?: string }> {
  const items = await liveFeed();
  if (!(await db())) return { ok: false, seen: items.length, error: 'no database' };
  const { dbQuery } = await import('../db');
  for (const x of items) {
    await dbQuery(
      `INSERT INTO news_archive (id, published_at, title, summary, source, url, region, tickers, importance, bottleneck, sentiment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET importance = COALESCE(EXCLUDED.importance, news_archive.importance), tickers = CASE WHEN cardinality(EXCLUDED.tickers) > 0 THEN EXCLUDED.tickers ELSE news_archive.tickers END`,
      [x.id, x.publishedAt, x.title, x.summary, x.source, x.url, x.region, x.tickers, x.importance, x.bottleneck, x.sentiment],
    ).catch(() => undefined);
  }
  await dbQuery(`DELETE FROM news_archive WHERE published_at < now() - interval '${KEEP_DAYS} days'`).catch(() => undefined);
  return { ok: true, seen: items.length };
}

/** News of the last `days` (archive + the live feed, newest first, one per id). */
export async function loadNews(days: number): Promise<ArchivedNews[]> {
  const live = await liveFeed().catch(() => [] as ArchivedNews[]);
  const since = Date.now() - days * 86_400_000;
  const map = new Map<string, ArchivedNews>();
  if (await db()) {
    const { dbQuery } = await import('../db');
    const rows = await dbQuery<any>(`SELECT id, published_at, title, summary, source, url, region, tickers, importance, bottleneck, sentiment FROM news_archive WHERE published_at >= $1 ORDER BY published_at DESC LIMIT 20000`, [new Date(since).toISOString()]).catch(() => [] as any[]);
    for (const r of rows) map.set(r.id, { id: r.id, publishedAt: new Date(r.published_at).toISOString(), title: r.title, summary: r.summary, source: r.source, url: r.url, region: r.region, tickers: r.tickers || [], importance: r.importance, bottleneck: r.bottleneck, sentiment: r.sentiment });
  }
  for (const x of live) if (Date.parse(x.publishedAt) >= since && !map.has(x.id)) map.set(x.id, x);
  return [...map.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
