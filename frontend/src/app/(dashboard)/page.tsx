'use client';

// ═══════════════════════════════════════════════════════════════════════════
// HOME DASHBOARD — PATCH 0602
//
// Entry-point cockpit. Replaces the previous redirect-to-/news with a real
// landing page that compresses the 28-item sidebar into one screen of
// actionable signal. Per INSTITUTIONAL_REVIEW.md sprint plan, this is the
// single biggest unlock for the €500K portal grade.
//
// Sections:
//   🎯 TODAY'S TOP 3 ACTIONS — cross-stream conviction picks
//   ⚠ ALERTS                — news alert rules firing
//   📅 EARNINGS TODAY       — from earnings calendar
//   🏗 BOTTLENECK PIPELINE  — severity-sorted themes
//   💼 MY BOOK              — portfolio summary + deep links
//   🔥 IN-PLAY NEWS         — top ranked impact stories last 4h
//   QUICK ACCESS grid       — deep-link to every other surface
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getConvictionTickers, getConvictionList } from '@/lib/conviction-beats';
import { readDecisions } from '@/lib/decisions';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

interface NewsItem {
  id?: string;
  title?: string;
  headline?: string;
  source?: string;
  source_name?: string;
  url?: string;
  source_url?: string;
  published_at?: string;
  importance_score?: number;
  ticker_symbols?: any[];
}
interface BottleneckBucket {
  bucket_id: string;
  label: string;
  severity_label?: string;
  severity_color?: string;
  severity_icon?: string;
  article_count?: number;
  signal_count?: number;
}
interface PortfolioHolding { symbol: string; quantity: number; entryPrice: number; }
interface GradedCard {
  ticker: string; company: string; composite_score: number; tier: string;
  filing_date?: string; sector?: string;
}
interface AlertRule { id: string; name: string; enabled: boolean; lastFiredAt?: number; }

interface HomeState {
  loading: boolean;
  inPlay: NewsItem[];
  bottleneck: BottleneckBucket[];
  earningsToday: GradedCard[];
  portfolio: PortfolioHolding[];
  alerts: AlertRule[];
  topActions: Array<{ symbol: string; company?: string; score?: number; grade?: string; sector?: string; reason: string; href: string }>;
}

function todayIstISO(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60_000);
  return ist.toISOString().slice(0, 10);
}

export default function HomeDashboard() {
  const [data, setData] = useState<HomeState>({
    loading: true, inPlay: [], bottleneck: [], earningsToday: [], portfolio: [], alerts: [], topActions: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const safe = async <T,>(url: string): Promise<T | null> => {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 12_000);
          const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(t);
          if (!r.ok) return null;
          return await r.json() as T;
        } catch { return null; }
      };

      // localStorage reads (sync, fast)
      let portfolio: PortfolioHolding[] = [];
      let alerts: AlertRule[] = [];
      try { portfolio = JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]') || []; } catch {}
      try { alerts = JSON.parse(localStorage.getItem('mc:news-alerts:v1') || '[]') || []; } catch {}

      // Parallel network fetches
      const [inPlayJson, bnJson, earningsJson] = await Promise.all([
        safe<any>('/api/v1/news/in-play'),
        safe<any>('/api/v1/news/bottleneck-dashboard'),
        safe<any>(`/api/v1/earnings/graded?date=${todayIstISO()}`),
      ]);
      if (cancelled) return;

      const inPlay: NewsItem[] = Array.isArray(inPlayJson) ? inPlayJson
                    : (inPlayJson?.articles || inPlayJson?.items || []);
      const bottleneck = ((bnJson?.buckets || []) as BottleneckBucket[]).slice();
      const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      bottleneck.sort((a, b) => (sevOrder[(a.severity_label || '').toLowerCase()] ?? 9) - (sevOrder[(b.severity_label || '').toLowerCase()] ?? 9)
                              || (b.article_count || 0) - (a.article_count || 0));

      const earningsToday: GradedCard[] = (earningsJson?.cards || earningsJson || [])
        .filter((c: any) => c?.ticker)
        .slice(0, 12);

      // Build Top 3 Actions
      const cbSet = (() => { try { return getConvictionTickers(); } catch { return new Set<string>(); } })();
      const cbList = (() => { try { return getConvictionList().slice(0, 20); } catch { return []; } })();
      const decisions = readDecisions();
      const indiaRows: any[] = (() => {
        try { return JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]') || []; } catch { return []; }
      })();
      const topFromMb = indiaRows
        .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                         && cbSet.has((r.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, ''))
                         && !decisions[(r.symbol || '').toUpperCase()])
        .sort((a: any, b: any) => (b.score ?? b.composite ?? 0) - (a.score ?? a.composite ?? 0))
        .slice(0, 3)
        .map((r: any) => ({
          symbol: r.symbol,
          company: r.company || r.companyName,
          score: r.score ?? r.composite,
          grade: r.grade,
          sector: r.sector,
          reason: 'Cross-confirmed: A-grade scorecard + on Conviction Beats bench + no decision tagged yet',
          href: `/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}`,
        }));
      const topFromEar = topFromMb.length >= 3 ? [] : earningsToday
        .filter((c: any) => c.tier === 'BLOCKBUSTER' || c.tier === 'STRONG')
        .slice(0, 3 - topFromMb.length)
        .map((c: any) => ({
          symbol: c.ticker,
          company: c.company,
          score: c.composite_score,
          grade: c.tier === 'BLOCKBUSTER' ? 'A+' : 'A',
          sector: c.sector,
          reason: `${c.tier} earnings tier today`,
          href: `/earnings-opportunities`,
        }));
      const topFromCb = (topFromMb.length + topFromEar.length) >= 3 ? [] : cbList
        .filter((e: any) => !decisions[(e.ticker || '').toUpperCase()])
        .slice(0, 3 - topFromMb.length - topFromEar.length)
        .map((e: any) => ({
          symbol: e.ticker,
          company: e.company,
          score: e.composite_score,
          grade: e.tier === 'BLOCKBUSTER' ? 'A+' : 'A',
          sector: e.sector,
          reason: `On Conviction Beats bench (${e.tier}) · no decision tagged yet`,
          href: `/stock-sheet?ticker=${encodeURIComponent(e.ticker)}`,
        }));
      const topActions = [...topFromMb, ...topFromEar, ...topFromCb];

      setData({ loading: false, inPlay: inPlay.slice(0, 6), bottleneck: bottleneck.slice(0, 6), earningsToday, portfolio, alerts, topActions });
    })();
    return () => { cancelled = true; };
  }, []);

  const activeAlerts = useMemo(() => data.alerts.filter(a => a.enabled), [data.alerts]);
  const portfolioCount = data.portfolio.length;

  if (data.loading) {
    return (
      <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: DIM }}>📡 Loading your morning briefing…</div>
      </div>
    );
  }

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: TEXT }}>🌅 {greeting}, Rishi</h1>
            <div style={{ marginTop: 4, fontSize: 12, color: DIM }}>
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {' · '}{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/news" style={navChip('#22D3EE')}>📰 News</Link>
            <Link href="/multibagger" style={navChip('#10B981')}>🚀 Multibagger</Link>
            <Link href="/earnings-opportunities" style={navChip('#F59E0B')}>📅 Earnings</Link>
            <Link href="/concall-intel" style={navChip('#A78BFA')}>🎙 Concall Intel</Link>
          </div>
        </div>

        {/* 🎯 TODAY'S TOP ACTIONS */}
        {data.topActions.length > 0 ? (
          <div style={{ ...cardStyle, borderColor: '#F59E0B70', background: 'linear-gradient(180deg, #F59E0B14 0%, transparent 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: '#F59E0B', letterSpacing: '0.4px' }}>
                🎯 TODAY&apos;S TOP {data.topActions.length} ACTIONS
              </span>
              <span style={{ fontSize: 10, color: '#F59E0B', background: '#F59E0B22', padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>
                CROSS-CONFIRMED · NOT YET TAGGED
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 10 }}>
              {data.topActions.map((a, i) => (
                <Link key={a.symbol + i} href={a.href} style={{
                  display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', borderRadius: 6,
                  border: '1px solid #F59E0B40', background: '#F59E0B10', textDecoration: 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: '#F59E0B' }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.company || a.symbol}</div>
                      <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{a.symbol}{a.sector ? ` · ${a.sector}` : ''}</div>
                    </div>
                    {a.score != null && (
                      <span style={{ fontSize: 13, color: '#10B981', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{a.score}{a.grade || ''}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#CBD5E1', lineHeight: 1.45 }}>Why: {a.reason}</div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ ...cardStyle, borderColor: '#22D3EE40' }}>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 700, marginBottom: 4 }}>🎯 Top 3 Actions</div>
            <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
              Upload a Screener.in CSV on the Multibagger tab and add names to your Conviction Beats bench from
              Earnings Opportunities to populate this card.
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <Link href="/multibagger" style={navChip('#10B981')}>📊 Open Multibagger</Link>
              <Link href="/earnings-opportunities" style={navChip('#F59E0B')}>📅 Earnings Ops</Link>
            </div>
          </div>
        )}

        {/* ALERTS + EARNINGS TODAY */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#EF4444', letterSpacing: '0.4px' }}>⚠ ALERTS ({activeAlerts.length} active)</span>
              <Link href="/news-alerts" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Manage →</Link>
            </div>
            {activeAlerts.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                No alert rules configured yet. <Link href="/news-alerts" style={{ color: '#22D3EE' }}>Set up alerts →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activeAlerts.slice(0, 5).map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #1A2540' }}>
                    <span style={{ color: TEXT, fontWeight: 600 }}>{a.name}</span>
                    <span style={{ color: DIM, fontSize: 10 }}>{a.lastFiredAt ? `fired ${timeAgo(a.lastFiredAt)}` : 'pending'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', letterSpacing: '0.4px' }}>📅 EARNINGS TODAY ({data.earningsToday.length})</span>
              <Link href="/earnings-opportunities" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>View all →</Link>
            </div>
            {data.earningsToday.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>No filings graded yet for today.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.earningsToday.slice(0, 6).map((c) => {
                  const tierColor = c.tier === 'BLOCKBUSTER' ? '#10B981' : c.tier === 'STRONG' ? '#22D3EE' : c.tier === 'MIXED' ? '#F59E0B' : '#EF4444';
                  return (
                    <Link key={c.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(c.ticker)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 3, textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company || c.ticker}</span>
                      <span style={{ fontSize: 10, color: DIM, fontFamily: 'ui-monospace, monospace' }}>{c.ticker}</span>
                      <span style={{ fontSize: 9, fontWeight: 800, color: tierColor, padding: '1px 5px', borderRadius: 3, background: `${tierColor}22` }}>
                        {c.tier} {c.composite_score}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* BOTTLENECK + MY BOOK */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#A78BFA', letterSpacing: '0.4px' }}>🏗 BOTTLENECK PIPELINE</span>
              <Link href="/bottleneck-intel" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Open Intel →</Link>
            </div>
            {data.bottleneck.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>No active bottleneck themes yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.bottleneck.map((b) => {
                  const color = b.severity_color || ((b.severity_label || '').toLowerCase() === 'high' ? '#EF4444' : '#F59E0B');
                  return (
                    <Link key={b.bucket_id} href={`/bottleneck-workbench?theme=${encodeURIComponent(b.bucket_id)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 3, textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                      <span style={{ fontSize: 14 }}>{b.severity_icon || '⚡'}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
                      <span style={{ fontSize: 9, color, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${color}22` }}>{b.severity_label || 'WATCH'}</span>
                      <span style={{ fontSize: 10, color: DIM, minWidth: 36, textAlign: 'right' }}>{b.article_count || 0} art</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#10B981', letterSpacing: '0.4px' }}>💼 MY BOOK</span>
              <Link href="/portfolio" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Open Portfolio →</Link>
            </div>
            {portfolioCount === 0 ? (
              <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                No holdings added yet. <Link href="/portfolio" style={{ color: '#10B981' }}>Add holdings →</Link>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>HOLDINGS</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{portfolioCount}</div>
                  </div>
                  <div style={{ flex: 1, fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                    Open Portfolio for live P&amp;L, watchlist deltas, RRG positioning, and the trend column.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Link href="/watchlists" style={navChip('#22D3EE')}>📋 Watchlist</Link>
                  <Link href="/decisions" style={navChip('#A78BFA')}>📒 Decisions</Link>
                  <Link href="/orders" style={navChip('#10B981')}>🛡 Signals</Link>
                </div>
              </>
            )}
          </div>
        </div>

        {/* IN-PLAY NEWS */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px' }}>🔥 IN-PLAY NEWS — last 4 hours</span>
            <Link href="/news" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Open feed →</Link>
          </div>
          {data.inPlay.length === 0 ? (
            <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>No in-play articles right now.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {data.inPlay.map((n, i) => {
                const title = n.title || n.headline || '(no headline)';
                const tickerRaw = Array.isArray(n.ticker_symbols) && n.ticker_symbols.length > 0
                  ? (typeof n.ticker_symbols[0] === 'string' ? n.ticker_symbols[0] : (n.ticker_symbols[0]?.ticker || ''))
                  : '';
                return (
                  <a key={(n.id || '') + i} href={n.url || n.source_url || '#'} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 3, textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                    <span style={{ fontSize: 11, color: DIM, fontWeight: 700, minWidth: 22, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT, fontWeight: 500, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{title}</span>
                    {tickerRaw && (
                      <span style={{ fontSize: 9, color: '#22D3EE', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: '#22D3EE15', border: '1px solid #22D3EE40', fontFamily: 'ui-monospace, monospace' }}>
                        {String(tickerRaw).toUpperCase()}
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: DIM, whiteSpace: 'nowrap' }}>{n.source_name || n.source || '—'}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* QUICK ACCESS GRID — deep links to every surface */}
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: DIM, fontWeight: 700, letterSpacing: '0.4px', marginBottom: 8 }}>QUICK ACCESS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
            {[
              { href: '/concall-intel', label: '🎙 Concall Intel' },
              { href: '/special-situations', label: '🎯 Special Sit' },
              { href: '/rating-actions', label: '🏛 Rating Actions' },
              { href: '/multibagger', label: '🚀 Multibagger' },
              { href: '/valuations', label: '💎 Valuations' },
              { href: '/screener', label: '🔍 Screener' },
              { href: '/strategic-visibility', label: '⭐ Strategic Visibility' },
              { href: '/transmission', label: '🔄 Transmission' },
              { href: '/super-investors', label: '👥 Super Investors' },
              { href: '/breadth', label: '📊 Breadth' },
              { href: '/heatmap', label: '🔥 Heatmap' },
              { href: '/rrg', label: '🎯 RRG' },
              { href: '/ipos', label: '🚀 IPOs' },
              { href: '/movers', label: '📈 Movers' },
              { href: '/smart-money', label: '💰 Smart Money' },
              { href: '/themes', label: '🏷 Themes' },
              { href: '/calendars', label: '📅 Calendars' },
              { href: '/company-intel', label: '🏢 Company Intel' },
              { href: '/stock-sheet', label: '📄 Stock Sheet' },
              { href: '/ai-desk', label: '🤖 AI Desk' },
              { href: '/status', label: '🛠 System Status' },
            ].map((l) => (
              <Link key={l.href} href={l.href} style={{
                display: 'block', padding: '6px 10px', borderRadius: 4,
                background: '#0A1422', border: `1px solid ${BORDER}`,
                color: TEXT, fontSize: 11, fontWeight: 600, textDecoration: 'none', textAlign: 'left',
              }}>{l.label}</Link>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 10, color: '#6B7A8D', lineHeight: 1.6, padding: '0 4px' }}>
          Top Actions derive from Multibagger CSV + Conviction Beats overlap + Decision Logbook (excludes tagged tickers).
          Earnings from <code>/api/v1/earnings/graded</code> · Bottleneck from <code>/news/bottleneck-dashboard</code> ·
          In-Play from <code>/news/in-play</code>. All scores heuristic — treat as evidence-density, not probability.
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: CARD, border: `1px solid ${BORDER}`,
  borderRadius: 8, padding: '14px 16px',
};
function navChip(color: string): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, color, textDecoration: 'none',
    padding: '5px 10px', borderRadius: 5,
    background: `${color}15`, border: `1px solid ${color}40`,
  };
}
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
