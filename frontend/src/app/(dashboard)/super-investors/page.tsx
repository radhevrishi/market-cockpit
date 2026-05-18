'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR TRACKER (PATCH 0482)
//
// Coat-tail dashboard for 10 Indian growth/value/quality investors. Two
// sub-views per investor:
//   1. HOLDINGS  — last-disclosed positions with BSE / AIF / commentary tier
//   2. NEWS      — recent news + interviews matched against investor's name
//                  (uses /api/v1/news search)
//
// Roster is curated in lib/super-investors.ts. New investors matching the
// growth / small-mid / management-quality archetype get appended there.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import {
  SUPER_INVESTORS, STYLE_META, TIER_META, getInvestor,
  type InvestorStyle, type SuperInvestor,
} from '@/lib/super-investors';

const BG = '#0A0E1A';
const PANEL = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const MUTED = '#6B7A8D';
const ACCENT = '#22D3EE';

type Tab = 'HOLDINGS' | 'NEWS';

export default function SuperInvestorsPage() {
  const [selectedId, setSelectedId] = useState<string>(SUPER_INVESTORS[0].id);
  const [tab, setTab] = useState<Tab>('HOLDINGS');
  const [styleFilter, setStyleFilter] = useState<InvestorStyle | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    if (styleFilter === 'ALL') return SUPER_INVESTORS;
    return SUPER_INVESTORS.filter((i) => i.style === styleFilter);
  }, [styleFilter]);

  const selected = getInvestor(selectedId) || SUPER_INVESTORS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: BG }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${BORDER}`, backgroundColor: PANEL }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: TEXT, margin: 0 }}>Super Investor Tracker</h1>
          <span style={{
            fontSize: 11, color: ACCENT, fontWeight: 700,
            border: `1px solid ${ACCENT}50`, backgroundColor: `${ACCENT}15`,
            padding: '2px 7px', borderRadius: 4,
          }}>
            {SUPER_INVESTORS.length} INVESTORS
          </span>
          <span style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
            Holdings + news for growth / small-mid / quality-style Indian investors
          </span>
        </div>
        <p style={{ color: MUTED, fontSize: 12, margin: '6px 0 0', lineHeight: 1.5, maxWidth: 920 }}>
          Coat-tail intelligence. Each investor card surfaces their last-disclosed top holdings (BSE ≥1% filings,
          AIF portfolio disclosures, or public commentary) plus a live news feed for their public statements and
          portfolio moves. The roster maps to the user&apos;s Multibagger + Earnings Opportunities framework
          (growth + management quality + small/mid bias).
        </p>

        {/* Style filter chips */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {(['ALL', ...Object.keys(STYLE_META)] as Array<InvestorStyle | 'ALL'>).map((s) => {
            const isActive = styleFilter === s;
            const meta = s === 'ALL' ? null : STYLE_META[s as InvestorStyle];
            const label = s === 'ALL' ? 'All Styles' : meta!.label;
            const color = s === 'ALL' ? ACCENT : meta!.color;
            return (
              <button
                key={s}
                onClick={() => setStyleFilter(s)}
                style={{
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${isActive ? color : BORDER}`,
                  backgroundColor: isActive ? `${color}22` : 'transparent',
                  color: isActive ? color : MUTED,
                  padding: '4px 10px', borderRadius: 4,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Two-column body ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 0 }}>
        {/* Left: investor list */}
        <div style={{
          borderRight: `1px solid ${BORDER}`,
          overflowY: 'auto', backgroundColor: PANEL,
        }}>
          {filtered.map((inv) => {
            const meta = STYLE_META[inv.style];
            const isActive = inv.id === selectedId;
            return (
              <button
                key={inv.id}
                onClick={() => setSelectedId(inv.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  border: 'none', cursor: 'pointer',
                  background: isActive ? `${meta.color}12` : 'transparent',
                  borderLeft: `3px solid ${isActive ? meta.color : 'transparent'}`,
                  padding: '12px 14px',
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: TEXT, fontWeight: 700, fontSize: 14 }}>{inv.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.3px',
                    color: meta.color, border: `1px solid ${meta.color}40`,
                    backgroundColor: `${meta.color}10`,
                    padding: '1px 6px', borderRadius: 3,
                  }}>
                    {meta.label.toUpperCase()}
                  </span>
                  {inv.firm && (
                    <span style={{ fontSize: 10, color: MUTED }}>· {inv.firm}</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>
                  {inv.topHoldings.length} disclosed holdings
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 16, color: MUTED, fontSize: 12, fontStyle: 'italic' }}>
              No investors match this style filter.
            </div>
          )}
        </div>

        {/* Right: investor detail */}
        <div style={{ overflowY: 'auto', padding: 24 }}>
          <InvestorDetail investor={selected} tab={tab} setTab={setTab} />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function InvestorDetail({
  investor, tab, setTab,
}: {
  investor: SuperInvestor;
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const meta = STYLE_META[investor.style];

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: TEXT, margin: 0, marginBottom: 6 }}>
          {investor.name}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
            color: meta.color, border: `1px solid ${meta.color}50`,
            backgroundColor: `${meta.color}15`,
            padding: '3px 8px', borderRadius: 4,
          }}>
            {meta.label}
          </span>
          {investor.firm && (
            <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>{investor.firm}</span>
          )}
          {investor.yearsActive && (
            <span style={{ fontSize: 11, color: MUTED }}>· active {investor.yearsActive}</span>
          )}
          {investor.twitter && (
            <a
              href={`https://x.com/${investor.twitter}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: ACCENT, textDecoration: 'none' }}
            >
              @{investor.twitter}
            </a>
          )}
          {investor.website && (
            <a
              href={investor.website}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: ACCENT, textDecoration: 'none' }}
            >
              ↗ Website
            </a>
          )}
          {investor.trendlyneUrl && (
            <a
              href={investor.trendlyneUrl}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: ACCENT, textDecoration: 'none' }}
            >
              ↗ Trendlyne page
            </a>
          )}
        </div>
        <p style={{ color: '#CBD5E1', fontSize: 13, lineHeight: 1.55, margin: 0, maxWidth: 760 }}>
          {investor.shortBio}
        </p>
      </div>

      {/* Sub-tab switcher */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, marginBottom: 16, gap: 4 }}>
        {(['HOLDINGS', 'NEWS'] as Tab[]).map((t) => {
          const isActive = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 12, fontWeight: 700, letterSpacing: '0.4px',
                color: isActive ? ACCENT : MUTED,
                background: 'transparent', cursor: 'pointer',
                border: 'none',
                borderBottom: `2px solid ${isActive ? ACCENT : 'transparent'}`,
                padding: '8px 14px',
              }}
            >
              {t === 'HOLDINGS' ? '📁 Holdings' : '📰 News & Interviews'}
            </button>
          );
        })}
      </div>

      {tab === 'HOLDINGS' ? (
        <HoldingsTable investor={investor} />
      ) : (
        <NewsPanel query={investor.newsQuery} investorName={investor.name} />
      )}

      {investor.notes && (
        <div style={{
          marginTop: 20, padding: 12, borderRadius: 6,
          backgroundColor: '#F59E0B10', border: '1px solid #F59E0B30',
          fontSize: 12, color: '#FCD34D', lineHeight: 1.5,
        }}>
          <strong style={{ color: '#F59E0B' }}>Note · </strong>{investor.notes}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function HoldingsTable({ investor }: { investor: SuperInvestor }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
        Last-disclosed positions. Tier ◆ = mandatory BSE / AIF filing.
        ◇ = self-disclosed in interview / book / tweet. ~ = inferred from media.
        Holdings refresh after each disclosure cycle (quarterly for BSE filings).
      </div>
      <div style={{
        border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: PANEL }}>
              <th style={thStyle}>Ticker</th>
              <th style={thStyle}>Company</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Stake</th>
              <th style={thStyle}>Tier</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Disclosed</th>
              <th style={thStyle}>Thesis / Note</th>
            </tr>
          </thead>
          <tbody>
            {investor.topHoldings.map((h, idx) => {
              const tierMeta = TIER_META[h.tier];
              return (
                <tr key={h.ticker + idx} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={tdStyle}>
                    <a
                      href={`/stock-sheet?ticker=${h.ticker}`}
                      style={{
                        color: TEXT, fontWeight: 700,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        textDecoration: 'none',
                      }}
                    >
                      {h.ticker}
                    </a>
                  </td>
                  <td style={tdStyle}>{h.company}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {h.stakePct != null ? `${h.stakePct.toFixed(1)}%` : '—'}
                  </td>
                  <td style={tdStyle}>
                    <span title={tierMeta.description} style={{
                      fontSize: 10, fontWeight: 700,
                      color: tierMeta.color, border: `1px solid ${tierMeta.color}40`,
                      backgroundColor: `${tierMeta.color}10`,
                      padding: '2px 6px', borderRadius: 3,
                    }}>
                      {tierMeta.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                    {h.disclosedOn}
                  </td>
                  <td style={{ ...tdStyle, color: MUTED, fontStyle: h.thesis ? 'normal' : 'italic' }}>
                    {h.thesis || '—'}
                  </td>
                </tr>
              );
            })}
            {investor.topHoldings.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, color: MUTED, fontStyle: 'italic', textAlign: 'center' }}>
                  No disclosed holdings yet — check the News tab for public commentary.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: '0.4px',
  textAlign: 'left', padding: '8px 12px',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px', color: TEXT, fontSize: 12, verticalAlign: 'top',
};

// ──────────────────────────────────────────────────────────────────────────

interface NewsArticle {
  id?: string;
  title: string;
  url?: string;
  source?: string;
  source_tier?: string;
  publishedAt?: string;
  date?: string;
  region?: string;
  importance_score?: number;
}

function NewsPanel({ query, investorName }: { query: string; investorName: string }) {
  const [items, setItems] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // Use the existing /api/v1/news endpoint with a search param.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    fetch(`/api/v1/news?search=${encodeURIComponent(query)}&limit=30`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('news fetch failed')))
      .then((data) => {
        if (!alive) return;
        const articles: NewsArticle[] = Array.isArray(data?.articles) ? data.articles
          : Array.isArray(data?.cards) ? data.cards
          : Array.isArray(data) ? data
          : [];
        setItems(articles.slice(0, 30));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || 'fetch error');
        setLoading(false);
      })
      .finally(() => clearTimeout(t));
    return () => { alive = false; controller.abort(); clearTimeout(t); };
  }, [query]);

  return (
    <div>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
        News + interviews matched to <strong style={{ color: ACCENT }}>{investorName}</strong>.
        Sourced from the user&apos;s existing /news pipeline (PRIMARY / SPECIALIST / SECONDARY / AGGREGATOR
        tiers). Click any headline to open in a new tab.
      </div>
      {loading && (
        <div style={{ padding: 24, color: MUTED, fontSize: 12, fontStyle: 'italic' }}>
          Loading news…
        </div>
      )}
      {error && !loading && (
        <div style={{
          padding: 12, color: '#EF4444', fontSize: 12,
          border: '1px solid #EF444440', borderRadius: 4, backgroundColor: '#EF444410',
        }}>
          Could not load news ({error}). Try the global news feed for fallback coverage.
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div style={{
          padding: 12, color: MUTED, fontSize: 12, fontStyle: 'italic',
          border: `1px solid ${BORDER}`, borderRadius: 4, backgroundColor: PANEL,
        }}>
          No recent news matched. Try widening the time window on the /news page.
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((a, idx) => (
            <a
              key={a.id || a.url || idx}
              href={a.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '10px 12px',
                border: `1px solid ${BORDER}`, borderRadius: 6,
                backgroundColor: PANEL, textDecoration: 'none',
              }}
            >
              <div style={{ color: TEXT, fontSize: 13, fontWeight: 600, lineHeight: 1.4, marginBottom: 3 }}>
                {a.title}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {a.source && (
                  <span style={{ fontSize: 10, color: MUTED }}>{a.source}</span>
                )}
                {a.source_tier && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: ACCENT,
                    border: `1px solid ${ACCENT}40`, padding: '1px 5px', borderRadius: 3,
                  }}>
                    {a.source_tier}
                  </span>
                )}
                <span style={{ fontSize: 10, color: MUTED }}>
                  {a.publishedAt || a.date || ''}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
