// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3.12: Cross-Reference Network (server-side)
// ─────────────────────────────────────────────────────────────────────────────
// Persists structural articles by theme so the UI can render
// "see also: 4 prior CoWoS articles in last 90 days". Backed by KV.
//
// Bucket key:   xref:{theme}:articles:v1
// Bucket TTL:   90 days (matches BOTTLENECK_PERSISTENT_KEY)
// Bucket value: rolling 50-article window per theme
//
// Caller writes on each fetch cycle; reader queries by theme to build
// a "related coverage" panel under each structural article.
// ─────────────────────────────────────────────────────────────────────────────

import { kvGet, kvSet } from '@/lib/kv';

const XREF_TTL = 90 * 24 * 60 * 60;   // 90 days in seconds
const XREF_MAX = 50;                  // rolling window per theme

export interface XRefArticle {
  id: string;
  title: string;
  source: string;
  source_url: string;
  published_at: string;
  consequence_score: number;
  exposure_beneficiaries?: string[];
  exposure_at_risk?: string[];
}

function bucketKey(theme: string): string {
  return `xref:${theme.toLowerCase().replace(/[^a-z0-9_]/g, '_')}:articles:v1`;
}

// Append an article to the theme's rolling window. De-duplicates by id.
export async function recordXRef(theme: string, article: XRefArticle): Promise<void> {
  if (!theme) return;
  const key = bucketKey(theme);
  try {
    const existing = (await kvGet<XRefArticle[]>(key)) || [];
    if (existing.some((e) => e.id === article.id)) return;     // already stored
    const next = [article, ...existing].slice(0, XREF_MAX);
    await kvSet(key, next, XREF_TTL);
  } catch {
    // KV failures are non-fatal — cross-ref is enrichment, not critical path
  }
}

// Read the theme's rolling window. Returns up to `limit` most-recent.
export async function listXRef(theme: string, limit = 10): Promise<XRefArticle[]> {
  if (!theme) return [];
  const key = bucketKey(theme);
  try {
    const list = (await kvGet<XRefArticle[]>(key)) || [];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}

// Theme aggregates — given a list of articles with bottleneck_sub_tag,
// return top themes by article count (used by the anomaly detector).
export function rollupByTheme(articles: Array<{ bottleneck_sub_tag?: string | null }>): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const a of articles) {
    if (!a.bottleneck_sub_tag) continue;
    counts[a.bottleneck_sub_tag] = (counts[a.bottleneck_sub_tag] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
