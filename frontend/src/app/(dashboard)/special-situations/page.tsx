'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL SITUATIONS — patch 0092
//
// Closes the biggest gap vs the user's PRIMARY EDGE B (Event-driven mispricing).
// Four sub-tabs, each a dedicated event scanner:
//
//   🔀 SPIN — spin-offs / demergers / carve-outs / Form 10 / split-offs
//   🤝 M&A  — open offers / takeover bids / acquisitions / mergers / buyouts
//   ↩️ TURN — turnarounds / first profit after losses / debt-reduction stories
//   💰 CAP  — buybacks / share repurchase / special dividends / capital return
//
// Implementation: client-side regex over the existing /api/v1/news?days=90
// feed.  Reuses all the news-route classification (region, source tier,
// article_type, tickers).  No new server endpoint needed.
//
// For each category we render:
//   - Top-line: count + latest sample
//   - Ticker basket: most-mentioned tickers ranked by count + recency
//   - Article feed: matched articles with date, source tier, full headline
//
// URL state: ?tab=spin|ma|turn|cap so refresh / share preserves the active
// scanner.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { GitBranch, Handshake, RotateCcw, Banknote, ExternalLink } from 'lucide-react';
import api from '@/lib/api';

// ─── Categories ─────────────────────────────────────────────────────────────

type Category = 'SPIN' | 'MA' | 'TURN' | 'CAP';

interface CategorySpec {
  id: Category;
  label: string;
  Icon: typeof GitBranch;
  color: string;
  tagline: string;
  rationale: string;
  pattern: RegExp;
  // Optional anti-pattern — if title matches this, the article is rejected
  // (kills 'M&A' false positives like "M&A activity slowed in Q4").
  reject?: RegExp;
}

const CATEGORIES: ReadonlyArray<CategorySpec> = [
  {
    id: 'SPIN',
    label: 'Spin-offs',
    Icon: GitBranch,
    color: '#22D3EE',
    tagline: 'Conglomerate discount → breakup unlocks value',
    rationale: 'Spin-offs create forced selling (index-fund rebalancing, shareholders dumping unfamiliar stub) which drives mispricing. The parent often re-rates too, freed from the discount. Classic Joel Greenblatt setup.',
    pattern: /\b(spin.?off|spinoff|demerg(?:er|ed|ing)|carve.?out|split.?off|form\s*10\b|hive.?off|business separation|tax.?free distribution|stock dividend.*subsidiary)\b/i,
  },
  {
    id: 'MA',
    label: 'M&A / Open Offer',
    Icon: Handshake,
    color: '#FBBF24',
    tagline: 'Offer price = valuation signal · new promoter → re-rating',
    rationale: 'Open offers and takeover bids set a hard price floor. Strategic acquirers paying 20-50% premium implies asymmetric upside if the deal closes; downside is bounded by walk-away protection.',
    pattern: /\b(open offer|takeover bid|tender offer|acquisition agreement|merger agreement|buyout|control change|controlling stake|change of control|strategic acquisition|all.?cash deal|sebi takeover|substantial acquisition)\b/i,
    reject: /\b(rumou?red|may consider|reportedly weighing|in talks|exploring|denied|rejected.+offer|terminated|called off|withdrew)\b/i,
  },
  {
    id: 'TURN',
    label: 'Turnaround',
    Icon: RotateCcw,
    color: '#10B981',
    tagline: 'Loss → profit shift · margins improving · debt repair',
    rationale: 'Turnaround names trade at distressed multiples through the loss-cycle. The first profitable quarter after losses creates a structural re-rating event. Margin trough → recovery is the dominant alpha mechanism.',
    pattern: /\b(turnaround|turn.?around|back to profit|back in (?:the )?black|swung to profit|loss to profit|profit revival|first profit (?:after|since)|exits losses|debt restructur|balance sheet repair|debt reduction|deleverag|recapitalis|operational restructur|cost cutting yields)\b/i,
    reject: /\b(failed turnaround|turnaround unlikely|fall back into loss|swung to loss|return to loss)\b/i,
  },
  {
    id: 'CAP',
    label: 'Capital Allocation',
    Icon: Banknote,
    color: '#A78BFA',
    tagline: 'Buybacks · debt paydown · special dividends · capex efficiency',
    rationale: 'Disciplined capital allocation is the highest signal management can send. Buybacks at low multiples, debt paydown, special dividends — all of these compound shareholder returns silently.',
    pattern: /\b(buyback|share repurchase|repurchas(?:e|ed|ing)\s+shares|tender for own shares|special dividend|interim dividend|bonus issue|capital return|return of capital|debt prepay|debt reduction|deleverag|treasury shares|reduction of share capital|capital reduction)\b/i,
    reject: /\b(buyback program ended|buyback.+rejected|denied buyback|cancel.+(?:buyback|repurchase)|paused.+buyback)\b/i,
  },
];

// ─── Article shape (subset of NewsArticle) ──────────────────────────────────

interface Article {
  id: string;
  headline?: string;
  title?: string;
  summary?: string;
  source?: string;
  source_name?: string;
  source_tier?: string;
  source_tier_v2?: string;
  published_at?: string;
  source_url?: string;
  url?: string;
  tickers?: string[];
  ticker_symbols?: string[];
  region?: string;
  article_type?: string;
  importance_score?: number;
}

interface NewsResp {
  articles: Article[];
  count?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function articleText(a: Article): string {
  return `${a.headline || a.title || ''} ${a.summary || ''}`;
}

function articleTickers(a: Article): string[] {
  const t = (a.ticker_symbols || a.tickers || []).filter(Boolean);
  return Array.from(new Set(t.map((s) => String(s).toUpperCase())));
}

function articleDate(a: Article): Date | null {
  if (!a.published_at) return null;
  const d = new Date(a.published_at);
  return isNaN(d.getTime()) ? null : d;
}

function ageDaysOf(a: Article): number | null {
  const d = articleDate(a);
  if (!d) return null;
  return Math.round((Date.now() - d.getTime()) / 86400000);
}

interface TickerAgg {
  ticker: string;
  count: number;
  most_recent_date?: Date | null;
  most_recent_age_days?: number | null;
  sample_headline?: string;
}

function aggregateTickers(matched: Article[]): TickerAgg[] {
  const map = new Map<string, TickerAgg>();
  for (const a of matched) {
    const date = articleDate(a);
    const age = ageDaysOf(a);
    for (const t of articleTickers(a)) {
      const cur = map.get(t);
      if (cur) {
        cur.count += 1;
        if (date && (!cur.most_recent_date || date > cur.most_recent_date)) {
          cur.most_recent_date = date;
          cur.most_recent_age_days = age;
          cur.sample_headline = a.headline || a.title;
        }
      } else {
        map.set(t, {
          ticker: t,
          count: 1,
          most_recent_date: date,
          most_recent_age_days: age,
          sample_headline: a.headline || a.title,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (a.most_recent_age_days ?? 999) - (b.most_recent_age_days ?? 999);
  });
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useSpecialSituationsFeed() {
  return useQuery<NewsResp>({
    queryKey: ['special-situations', 'feed'],
    queryFn: async () => {
      // Pull last 90 days of news — the universe to filter against.
      // Same endpoint the rest of the cockpit uses; no new server route needed.
      const { data } = await api.get('/news', { params: { days: 90, limit: 2000 } });
      return data;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
}

// ─── UI ─────────────────────────────────────────────────────────────────────

export default function SpecialSituationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = (searchParams?.get('tab')?.toUpperCase() as Category) || 'SPIN';
  const [active, setActive] = useState<Category>(
    CATEGORIES.some((c) => c.id === initial) ? initial : 'SPIN',
  );
  const [region, setRegion] = useState<'ALL' | 'IN' | 'GLOBAL'>('ALL');

  // Sync active sub-tab to URL
  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab')?.toUpperCase() !== active) {
      sp.set('tab', active.toLowerCase());
      router.replace(`/special-situations?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  const { data: feed, isLoading, error, dataUpdatedAt } = useSpecialSituationsFeed();
  const allArticles: Article[] = feed?.articles || [];

  // Derive matched articles per category
  const matchesByCategory = useMemo(() => {
    const out: Record<Category, Article[]> = { SPIN: [], MA: [], TURN: [], CAP: [] };
    for (const a of allArticles) {
      const text = articleText(a);
      if (region !== 'ALL') {
        const r = (a.region || '').toUpperCase();
        if (region === 'IN' && r !== 'IN' && r !== 'INDIA') continue;
        if (region === 'GLOBAL' && (r === 'IN' || r === 'INDIA')) continue;
      }
      for (const cat of CATEGORIES) {
        if (cat.pattern.test(text) && !(cat.reject && cat.reject.test(text))) {
          out[cat.id].push(a);
        }
      }
    }
    // Sort each category latest-first
    for (const cat of CATEGORIES) {
      out[cat.id].sort((a, b) => {
        const da = articleDate(a)?.getTime() ?? 0;
        const db = articleDate(b)?.getTime() ?? 0;
        return db - da;
      });
    }
    return out;
  }, [allArticles, region]);

  const activeMeta = CATEGORIES.find((c) => c.id === active) || CATEGORIES[0];
  const activeArticles = matchesByCategory[active];
  const tickerAgg = useMemo(() => aggregateTickers(activeArticles).slice(0, 30), [activeArticles]);

  // Liveness pill
  const lastUpdatedMin = dataUpdatedAt
    ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 60000))
    : null;
  const liveColor = lastUpdatedMin == null ? '#6B7A8D'
    : lastUpdatedMin <= 10 ? '#10B981'
    : lastUpdatedMin <= 60 ? '#F59E0B'
    : '#EF4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Hero header ─────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: '#0D1B2E',
        borderBottom: '1px solid #1E2D45',
        borderLeft: `4px solid ${activeMeta.color}`,
        padding: '14px 18px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: activeMeta.color, letterSpacing: '0.6px' }}>
            🎯 SPECIAL SITUATIONS
          </span>
          <span style={{ fontSize: 12, color: '#4A5B6C' }}>
            Event-driven mispricing — SPIN · M&A · TURN · CAP
          </span>
          {/* Liveness */}
          <span
            title={dataUpdatedAt ? `Last refresh: ${new Date(dataUpdatedAt).toLocaleString()}` : 'Live'}
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
              color: liveColor, border: `1px solid ${liveColor}50`,
              backgroundColor: `${liveColor}15`,
              padding: '2px 8px', borderRadius: 4,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: liveColor, boxShadow: `0 0 6px ${liveColor}` }} />
            {lastUpdatedMin == null ? 'LIVE' :
              lastUpdatedMin === 0 ? 'LIVE · just now' :
              lastUpdatedMin < 60 ? `LIVE · ${lastUpdatedMin}m ago` :
              `STALE · ${Math.round(lastUpdatedMin / 60)}h ago`}
          </span>
          {/* Region filter */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {([
              { v: 'ALL', label: 'ALL' },
              { v: 'IN', label: '🇮🇳 IN' },
              { v: 'GLOBAL', label: '🌐 GL' },
            ] as const).map((r) => {
              const isActive = region === r.v;
              return (
                <button
                  key={r.v}
                  onClick={() => setRegion(r.v as 'ALL' | 'IN' | 'GLOBAL')}
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    border: isActive ? '1px solid #38A9E860' : '1px solid #1A2840',
                    backgroundColor: isActive ? '#0F7ABF20' : 'transparent',
                    color: isActive ? '#38A9E8' : '#6B7A8D',
                    cursor: 'pointer',
                  }}
                >{r.label}</button>
              );
            })}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CATEGORIES.map(({ id, label, Icon, color }) => {
            const isActive = active === id;
            const count = matchesByCategory[id].length;
            return (
              <button
                key={id}
                onClick={() => setActive(id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: isActive ? `1px solid ${color}80` : '1px solid #1A2840',
                  backgroundColor: isActive ? `${color}18` : 'transparent',
                  color: isActive ? color : '#8A95A3',
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '0.4px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <Icon style={{ width: 16, height: 16 }} />
                <span>{label.toUpperCase()}</span>
                <span style={{
                  fontSize: 11, fontWeight: 800, padding: '1px 6px', borderRadius: 4,
                  backgroundColor: isActive ? `${color}30` : '#1A2840',
                  color: isActive ? color : '#6B7A8D',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active category context */}
        <div style={{ marginTop: 10, fontSize: 12, color: '#94A3B8', lineHeight: 1.5 }}>
          <span style={{ color: activeMeta.color, fontWeight: 700 }}>{activeMeta.tagline}</span>
          <span style={{ color: '#6B7A8D' }}> · {activeMeta.rationale}</span>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isLoading && (
          <div style={{ color: '#6B7A8D', fontSize: 13, padding: 24 }}>Loading 90-day news universe…</div>
        )}
        {error && (
          <div style={{ color: '#EF4444', fontSize: 13, padding: 24 }}>Failed to load news feed.</div>
        )}
        {!isLoading && !error && (
          <>
            {/* Empty-state */}
            {activeArticles.length === 0 && (
              <div style={{
                backgroundColor: '#0D1B2E',
                border: '1px solid #1E2D45',
                borderRadius: 12,
                padding: 24,
                textAlign: 'center',
                color: '#6B7A8D',
                fontSize: 13,
              }}>
                No <strong>{activeMeta.label}</strong> matches in the last 90 days
                {region !== 'ALL' && <> for {region === 'IN' ? '🇮🇳 India' : '🌐 Global'}</>}.
                Try widening region or checking a different sub-tab.
              </div>
            )}

            {/* Ticker basket */}
            {tickerAgg.length > 0 && (
              <div style={{
                backgroundColor: '#0D1B2E',
                border: '1px solid #1E2D45',
                borderLeft: `3px solid ${activeMeta.color}`,
                borderRadius: 12,
                padding: '14px 18px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: activeMeta.color, letterSpacing: '0.5px', marginBottom: 10 }}>
                  ⭐ TOP {activeMeta.label.toUpperCase()} CANDIDATES
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>
                    Most-mentioned tickers, ranked by frequency × recency
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {tickerAgg.map((t) => (
                    <button
                      key={t.ticker}
                      onClick={() => window.dispatchEvent(new CustomEvent('openTicker', { detail: { symbol: t.ticker } }))}
                      title={`${t.count} ${activeMeta.label} mention${t.count === 1 ? '' : 's'} in the last 90 days\nMost recent: ${t.most_recent_age_days ?? '?'}d ago\n"${(t.sample_headline || '').slice(0, 140)}"`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: `1px solid ${activeMeta.color}50`,
                        backgroundColor: `${activeMeta.color}12`,
                        color: '#E6EDF3',
                        fontSize: 13, fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}
                    >
                      <span>{t.ticker}</span>
                      <span style={{ fontSize: 11, color: activeMeta.color, fontWeight: 800 }}>
                        ×{t.count}
                      </span>
                      {t.most_recent_age_days != null && t.most_recent_age_days <= 7 && (
                        <span style={{ fontSize: 9, color: '#FBBF24', fontWeight: 800 }}>🆕</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Article feed */}
            {activeArticles.length > 0 && (
              <div style={{
                backgroundColor: '#0D1B2E',
                border: '1px solid #1E2D45',
                borderRadius: 12,
                padding: '14px 18px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.5px', marginBottom: 10 }}>
                  📰 MATCHED ARTICLES
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>
                    {activeArticles.length} matches · sorted latest first
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {activeArticles.slice(0, 50).map((a) => {
                    const tickers = articleTickers(a);
                    const ageD = ageDaysOf(a);
                    const tier = a.source_tier_v2 || a.source_tier || '';
                    const isFresh = ageD != null && ageD <= 7;
                    return (
                      <a
                        key={a.id}
                        href={a.source_url || a.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          backgroundColor: '#0A1422',
                          border: `1px solid ${isFresh ? activeMeta.color + '40' : '#1A2840'}`,
                          borderRadius: 8,
                          padding: '10px 14px',
                          textDecoration: 'none',
                          color: 'inherit',
                          display: 'block',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                          {tickers.slice(0, 3).map((t) => (
                            <span key={t} style={{
                              fontSize: 11, fontWeight: 700, color: '#38A9E8',
                              backgroundColor: '#0F7ABF20',
                              border: '1px solid #0F7ABF40',
                              padding: '2px 6px', borderRadius: 4,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            }}>
                              {t}
                            </span>
                          ))}
                          {isFresh && (
                            <span style={{
                              fontSize: 10, fontWeight: 800, color: '#0A1422',
                              backgroundColor: '#FBBF24',
                              padding: '1px 6px', borderRadius: 3, letterSpacing: '0.3px',
                            }}>
                              🆕 {ageD}d
                            </span>
                          )}
                          {a.region === 'IN' && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#FBBF24' }}>🇮🇳</span>
                          )}
                          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6B7A8D' }}>
                            {a.source_name || a.source}
                            {tier && <span style={{ color: '#4A5B6C' }}>· {tier}</span>}
                            <ExternalLink style={{ width: 11, height: 11 }} />
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: '#E6EDF3', lineHeight: 1.4, fontWeight: 500 }}>
                          {a.headline || a.title}
                        </div>
                        {a.summary && (
                          <div style={{ fontSize: 11, color: '#6B7A8D', lineHeight: 1.5, marginTop: 6 }}>
                            {a.summary.slice(0, 200)}
                            {a.summary.length > 200 && '…'}
                          </div>
                        )}
                      </a>
                    );
                  })}
                  {activeArticles.length > 50 && (
                    <div style={{ fontSize: 11, color: '#6B7A8D', textAlign: 'center', marginTop: 6 }}>
                      Showing latest 50 of {activeArticles.length} matches.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
