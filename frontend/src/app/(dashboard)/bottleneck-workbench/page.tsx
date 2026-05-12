'use client';

/**
 * PATCH 0235 — Bottleneck Workbench v0.
 *
 * Single-theme deep-dive page. Built on existing endpoints — no schema
 * change — so it works against today's data:
 *   - /news/bottleneck-dashboard  → all bottleneck buckets (we filter to one)
 *   - /news?article_type=BOTTLENECK&category=<sub_tag>  → related articles
 *
 * URL form: /bottleneck-workbench?theme=<bucket_id>
 *
 * Lays out:
 *   - Header: theme name + severity + article/signal counts + ticker chips
 *   - Signals: each signal in the bucket with its statement, sources, time
 *   - Related Articles: chronological timeline of all articles in this theme
 *   - Tickers: deduplicated key tickers with role glyphs
 *   - (Future) L1–L6 transmission ladder when that field is in the payload.
 *
 * Real workbench (proper L1–L6 ladder, contract ledger filtered by theme,
 * portfolio overlay, theme revision history) needs the Bottleneck entity
 * with explicit transmission_levels + contracts join — frontend-only v0.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { TOKENS } from '@/lib/design-tokens';
import { classifySource, TIER_VISUAL } from '@/lib/source-tiers';

interface BnSignal {
  id: string;
  statement: string;
  severity: number;
  source_count: number;
  sources?: string[];
  first_seen?: string;
  last_seen?: string;
  ticker_mentions?: string[];
}
interface BnBucket {
  bucket_id: string;
  label: string;
  description: string;
  severity: number;
  severity_label: string;
  severity_color: string;
  severity_icon: string;
  signal_count: number;
  article_count: number;
  key_tickers: string[];
  signals: BnSignal[];
}
interface BnDashboard {
  buckets: BnBucket[];
}
interface ThemedArticle {
  id: string;
  title?: string;
  headline?: string;
  source_name?: string;
  source?: string;
  source_url?: string;
  url?: string;
  published_at: string;
  region?: string;
  importance_score?: number;
  bottleneck_sub_tag?: string;
  bottleneck_level?: string;
  ticker_symbols?: string[];
}

function useBucket(bucketId: string) {
  return useQuery<BnDashboard>({
    queryKey: ['workbench', 'bottleneck-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/news/bottleneck-dashboard');
      return data;
    },
    staleTime: 120_000,
  });
}

function useThemedArticles(bucketId: string) {
  return useQuery<ThemedArticle[]>({
    queryKey: ['workbench', 'articles', bucketId],
    enabled: !!bucketId,
    queryFn: async () => {
      const { data } = await api.get(`/news?article_type=BOTTLENECK&category=${encodeURIComponent(bucketId)}&limit=50`);
      return Array.isArray(data) ? data : (data?.items || []);
    },
    staleTime: 120_000,
  });
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const age = Date.now() - d.getTime();
    if (age < 0) return d.toLocaleDateString();
    const m = Math.floor(age / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const day = Math.floor(h / 24);
    if (day <= 7) return `${day}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

export default function BottleneckWorkbenchPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const themeParam = sp?.get('theme') || '';
  const [activeBucket, setActiveBucket] = useState<string>(themeParam);

  useEffect(() => { setActiveBucket(themeParam); }, [themeParam]);

  const { data: dashboard, isLoading } = useBucket(activeBucket);
  const buckets = dashboard?.buckets || [];
  const bucket = useMemo(() => buckets.find(b => b.bucket_id === activeBucket), [buckets, activeBucket]);

  const { data: relatedArticles, isLoading: artLoading } = useThemedArticles(activeBucket);

  const tickerRoleMap = useMemo(() => {
    // Heuristic: any ticker appearing in 'key_tickers' for a positive-severity
    // bucket is a likely beneficiary. Real role classification needs ticker_roles.
    const map = new Map<string, 'BENEFICIARY' | 'NEUTRAL'>();
    if (bucket) {
      for (const t of bucket.key_tickers || []) {
        map.set(t.toUpperCase(), 'BENEFICIARY');
      }
    }
    return map;
  }, [bucket]);

  if (!themeParam) {
    return (
      <div style={{ padding: '40px', backgroundColor: TOKENS.surface.canvas, minHeight: '100vh', color: TOKENS.surface.text }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Bottleneck Workbench</h1>
        <p style={{ fontSize: 13, color: TOKENS.surface.textDim, marginBottom: 24 }}>
          Pick a bottleneck theme below to open its workbench. Each theme aggregates the persistent
          signals, the related articles timeline, and the implicated tickers across the active feed.
        </p>
        {isLoading ? (
          <p style={{ fontSize: 13, color: TOKENS.surface.textDim }}>Loading themes…</p>
        ) : buckets.length === 0 ? (
          <p style={{ fontSize: 13, color: TOKENS.surface.textDim }}>No active bottlenecks at this time.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {buckets.map(b => (
              <button
                key={b.bucket_id}
                onClick={() => router.push(`${pathname}?theme=${encodeURIComponent(b.bucket_id)}`)}
                style={{
                  backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`,
                  borderLeft: `3px solid ${b.severity_color}`, borderRadius: 10,
                  padding: '12px 14px', textAlign: 'left', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>{b.severity_icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{b.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: b.severity_color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{b.severity_label}</span>
                </div>
                <div style={{ fontSize: 11, color: TOKENS.surface.textDim, marginBottom: 6, lineHeight: 1.4 }}>{b.description}</div>
                <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontFamily: 'ui-monospace, monospace' }}>
                  {b.article_count} articles · {b.signal_count} signals · {b.key_tickers.length} tickers
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', backgroundColor: TOKENS.surface.canvas, minHeight: '100vh', color: TOKENS.surface.text }}>
      <button
        onClick={() => router.push(pathname)}
        style={{
          backgroundColor: 'transparent', border: `1px solid ${TOKENS.surface.cardBorder}`,
          color: TOKENS.surface.textDim, borderRadius: 5, padding: '4px 10px',
          fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 16,
        }}
      >← All bottlenecks</button>

      {isLoading || !bucket ? (
        <p style={{ fontSize: 13, color: TOKENS.surface.textDim }}>Loading theme…</p>
      ) : (
        <>
          {/* Header */}
          <div style={{
            backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`,
            borderLeft: `3px solid ${bucket.severity_color}`,
            borderRadius: 12, padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{bucket.severity_icon}</span>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{bucket.label}</h1>
              <span style={{
                marginLeft: 'auto',
                fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                backgroundColor: `${bucket.severity_color}15`, color: bucket.severity_color,
                border: `1px solid ${bucket.severity_color}40`,
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>{bucket.severity_label}</span>
            </div>
            <p style={{ fontSize: 13, color: TOKENS.surface.textDim, margin: '0 0 12px', lineHeight: 1.5 }}>{bucket.description}</p>
            <div style={{ display: 'flex', gap: 18, fontSize: 11, color: TOKENS.surface.textMuted, fontFamily: 'ui-monospace, monospace' }}>
              <span>{bucket.article_count} articles</span>
              <span>{bucket.signal_count} signals</span>
              <span>{bucket.key_tickers.length} implicated tickers</span>
            </div>
          </div>

          {/* Tickers grid */}
          {bucket.key_tickers.length > 0 && (
            <div style={{
              backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`,
              borderRadius: 12, padding: '16px 20px', marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: TOKENS.semantic.bullish.solid, letterSpacing: '0.6px', marginBottom: 10 }}>
                IMPLICATED TICKERS  ·  {bucket.key_tickers.length}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bucket.key_tickers.map(t => {
                  const role = tickerRoleMap.get(t.toUpperCase());
                  const glyph = role === 'BENEFICIARY' ? '▲' : '◆';
                  const color = role === 'BENEFICIARY' ? TOKENS.semantic.bullish.solid : TOKENS.surface.textDim;
                  return (
                    <span key={t}
                      title="Heuristic role classification — ticker_roles pipeline pending"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`,
                        borderRadius: 5, padding: '3px 8px',
                        fontSize: 11, fontWeight: 700,
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    ><span style={{ color }}>{glyph}</span><span>{t}</span></span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Signals */}
          {bucket.signals?.length > 0 && (
            <div style={{
              backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`,
              borderRadius: 12, padding: '16px 20px', marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: TOKENS.severity.high.solid, letterSpacing: '0.6px', marginBottom: 10 }}>
                ACTIVE SIGNALS  ·  {bucket.signals.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bucket.signals.map(s => (
                  <div key={s.id} style={{
                    backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`,
                    borderLeft: `2px solid ${TOKENS.severity.high.solid}`,
                    borderRadius: 8, padding: '10px 14px',
                  }}>
                    <div style={{ fontSize: 13, color: TOKENS.surface.text, marginBottom: 6, lineHeight: 1.5 }}>
                      {s.statement}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: TOKENS.surface.textMuted, fontFamily: 'ui-monospace, monospace' }}>
                      <span>{s.source_count || 0} sources</span>
                      {s.first_seen && <span>first seen {fmtTime(s.first_seen)}</span>}
                      {s.last_seen && <span>last seen {fmtTime(s.last_seen)}</span>}
                      {(s.ticker_mentions || []).length > 0 && <span>tickers: {(s.ticker_mentions || []).slice(0, 5).join(', ')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related articles timeline */}
          <div style={{
            backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`,
            borderRadius: 12, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: TOKENS.state.live.solid, letterSpacing: '0.6px', marginBottom: 10 }}>
              ARTICLES TIMELINE  ·  {(relatedArticles || []).length}
            </div>
            {artLoading ? (
              <div style={{ fontSize: 12, color: TOKENS.surface.textDim }}>Loading articles…</div>
            ) : (relatedArticles || []).length === 0 ? (
              <div style={{ fontSize: 12, color: TOKENS.surface.textDim }}>No recent articles for this theme.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(relatedArticles || []).slice(0, 30).map(a => {
                  const tier = classifySource(a.source_name ?? a.source, a.source_url ?? a.url);
                  const v = TIER_VISUAL[tier];
                  const title = a.title || a.headline || '(untitled)';
                  return (
                    <a
                      key={a.id}
                      href={a.source_url || a.url || '#'}
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        display: 'grid', gridTemplateColumns: '90px 90px 1fr 140px',
                        gap: 10, alignItems: 'center',
                        textDecoration: 'none', color: 'inherit',
                        padding: '8px 10px', borderRadius: 6,
                        backgroundColor: '#0A1422',
                        border: `1px solid ${TOKENS.surface.cardBorder}`,
                      }}
                    >
                      <span style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontFamily: 'ui-monospace, monospace' }}>{fmtTime(a.published_at)}</span>
                      <span title={`${v.label} source`} style={{
                        fontSize: 9, fontWeight: 700, color: v.tone.solid,
                        fontFamily: 'ui-monospace, monospace',
                      }}>{v.glyph} {v.label}</span>
                      <span style={{ fontSize: 12, color: TOKENS.surface.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                      <span style={{ fontSize: 10, color: TOKENS.surface.textDim, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{a.source_name || a.source || ''}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <p style={{ fontSize: 10, color: TOKENS.surface.textMuted, marginTop: 24, lineHeight: 1.6 }}>
        Workbench v0 — uses existing endpoints (no schema migration). Proper L1–L6 ladder, theme-
        filtered contracts ledger, theme revision diff, and portfolio overlay land once the
        Bottleneck entity with explicit transmission_levels + contracts join lands.
      </p>
    </div>
  );
}
