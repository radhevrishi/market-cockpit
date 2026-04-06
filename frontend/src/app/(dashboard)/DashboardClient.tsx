'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Newspaper, Calendar, Briefcase, Compass, Bell, Settings, LogOut, ChevronDown, BookMarked, Search,
  TrendingUp, Grid3X3, RefreshCw, Filter, Globe, Rocket, Shield, LineChart, Star,
} from 'lucide-react';
import api from '@/lib/api';
import TickerDrawer from '@/components/TickerDrawer';
import GlobalSearch from '@/components/GlobalSearch';
import MarketHours from '@/components/MarketHours';

interface NavItem { href: string; label: string; icon: ReactNode; }

const NAV: NavItem[] = [
  { href: '/news',          label: 'News Feed',       icon: <Newspaper className="w-5 h-5" /> },
  { href: '/heatmap',       label: 'Heatmap',         icon: <Grid3X3 className="w-5 h-5" /> },
  { href: '/movers',        label: 'Movers',          icon: <TrendingUp className="w-5 h-5" /> },
  { href: '/portfolio',     label: 'Portfolio',       icon: <Briefcase className="w-5 h-5" /> },
  { href: '/watchlists',    label: 'Watchlist',       icon: <BookMarked className="w-5 h-5" /> },
  { href: '/orders',        label: 'Intelligence',    icon: <Shield className="w-5 h-5" /> },
  { href: '/earnings',      label: 'Earnings',        icon: <LineChart className="w-5 h-5" /> },
  { href: '/multibagger',   label: 'Multibagger',     icon: <Star className="w-5 h-5" /> },
  { href: '/rrg',           label: 'RRG',             icon: <RefreshCw className="w-5 h-5" /> },
  { href: '/screener',      label: 'Screener',        icon: <Filter className="w-5 h-5" /> },
  { href: '/ipos',          label: 'IPOs',            icon: <Rocket className="w-5 h-5" /> },
  { href: '/macro-maps',    label: 'Macro Maps',      icon: <Globe className="w-5 h-5" /> },
  { href: '/calendars',     label: 'Calendar',        icon: <Calendar className="w-5 h-5" /> },
];

// Static fallback shown while live data loads
const MARKETS_FALLBACK = [
  { symbol: 'NIFTY 50',  price: '23,500', change: '—', up: true },
  { symbol: 'SENSEX',    price: '77,000', change: '—', up: true },
  { symbol: 'S&P 500',   price: '5,700',  change: '—', up: true },
  { symbol: 'NASDAQ',    price: '18,200', change: '—', up: true },
  { symbol: 'USD/INR',   price: '86.50',  change: '—', up: true },
  { symbol: 'GOLD',      price: '3,050',  change: '—', up: true },
  { symbol: 'CRUDE OIL', price: '69.50',  change: '—', up: true },
];

interface MarketIndex {
  symbol: string;
  name?: string;
  price: number | string;
  change_pct?: number;
  change?: number | string;
  up?: boolean;
}

interface UserProfile {
  id: string;
  user_id: string;
  display_name: string | null;
  timezone: string;
  preferred_markets: string[];
  preferred_themes: string[];
  notification_channels: Record<string, boolean>;
}

export default function DashboardClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [drawerTicker, setDrawerTicker] = useState<{ symbol: string; exchange?: string } | null>(null);
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  // ── Auth check: mark as checked (public data loads regardless) ──────────
  useEffect(() => {
    setAuthChecked(true);
  }, []);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Handle ?ticker= query parameter to open drawer
  useEffect(() => {
    const tickerParam = searchParams?.get('ticker');
    if (tickerParam) {
      const indianTickers = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'WIPRO', 'BAJFINANCE',
                             'TATAMOTORS', 'SUNPHARMA', 'ADANIENT', 'SBIN', 'AXISBANK', 'KOTAKBANK',
                             'HAL', 'BEL', 'NTPC', 'ONGC', 'MARUTI', 'HCLTECH', 'ITC', 'LT', 'POWERGRID',
                             'MTAR', 'BDL'];
      const exchange = indianTickers.includes(tickerParam.toUpperCase()) ? 'NSE' : 'NASDAQ';
      setDrawerTicker({ symbol: tickerParam, exchange });
    }
  }, [searchParams]);

  // Handle custom openTicker event from GlobalSearch
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setDrawerTicker({ symbol: detail.symbol, exchange: detail.exchange });
    };
    window.addEventListener('openTicker', handler);
    return () => window.removeEventListener('openTicker', handler);
  }, []);

  // Refetch market data when component re-mounts
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['market', 'indices'] });
  }, [qc]);

  // Show loading skeleton for first 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowLoadingSkeleton(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Live market indices — refresh every 60 s
  // Tries FastAPI backend first, falls back to Next.js /api/market/indices route
  const { data: liveIndices, isLoading, error } = useQuery<MarketIndex[]>({
    queryKey: ['market', 'indices'],
    queryFn: async () => {
      // Try 1: FastAPI backend (works when backend is running)
      try {
        const { data } = await api.get('/market/indices');
        if (Array.isArray(data) && data.length > 0) {
          setShowLoadingSkeleton(false);
          return data;
        }
      } catch {}

      // Try 2: Next.js API route (direct NSE fetch — always available on Vercel)
      try {
        const res = await fetch('/api/market/indices');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setShowLoadingSkeleton(false);
            return data;
          }
        }
      } catch {}

      setShowLoadingSkeleton(false);
      return [];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  // Fetch user profile
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('token');
  const { data: userProfile } = useQuery<UserProfile>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data } = await api.get('/auth/me');
      return data;
    },
    staleTime: 5 * 60_000,
    retry: 0,
    enabled: hasToken,
  });

  // Don't render anything until auth is verified
  if (!authChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#0A0E1A' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #1A2840', borderTopColor: '#0F7ABF', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: '#4A5B6C', fontSize: '13px' }}>Loading...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Shape live data into ticker format
  const markets = liveIndices && liveIndices.length > 0
    ? liveIndices.map((m) => {
        const pct = typeof m.change_pct === 'number' ? m.change_pct : 0;
        const price = typeof m.price === 'number'
          ? m.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : String(m.price);
        const changeStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        return { symbol: m.symbol, price, change: changeStr, up: pct >= 0 };
      })
    : showLoadingSkeleton || isLoading
      ? MARKETS_FALLBACK.map(m => ({ ...m, price: '...', change: '...' }))
      : MARKETS_FALLBACK;

  const isActive = (href: string) =>
    href === '/news' ? (pathname === '/' || pathname === '/news' || pathname?.startsWith('/news')) : pathname?.startsWith(href);

  function handleSignOut() {
    localStorage.removeItem('token');
    router.push('/login');
  }

  const handleRetry = () => {
    qc.invalidateQueries({ queryKey: ['market', 'indices'] });
    qc.invalidateQueries({ queryKey: ['portfolios'] });
    qc.invalidateQueries({ queryKey: ['watchlists'] });
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#0A0E1A', overflow: 'hidden' }}>

      {/* ── Desktop Sidebar ───────────────────────────────────────────── */}
      <aside className="desktop-sidebar" style={{
        width: '72px',
        flexShrink: 0,
        backgroundColor: '#0D1623',
        borderRight: '1px solid #1A2840',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 40,
      }}>
        {/* Logo */}
        <div style={{ padding: '16px 0', textAlign: 'center', borderBottom: '1px solid #1A2840' }}>
          <div style={{
            width: '36px',
            height: '36px',
            background: 'linear-gradient(135deg, #0F7ABF, #06B6D4)',
            borderRadius: '10px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            fontWeight: 'bold',
            color: 'white',
            letterSpacing: '-1px',
          }}>MC</div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {NAV.map(item => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}
                title={item.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '10px 4px',
                  margin: '2px 6px',
                  borderRadius: '10px',
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                  backgroundColor: active ? 'rgba(15,122,191,0.18)' : 'transparent',
                  color: active ? '#0F7ABF' : '#6B7A8D',
                  fontSize: '9px',
                  fontWeight: active ? '600' : '400',
                  letterSpacing: '0.3px',
                  borderLeft: active ? '2px solid #0F7ABF' : '2px solid transparent',
                }}>
                <div>{item.icon}</div>
                <span style={{ textAlign: 'center', lineHeight: '1.2' }}>
                  {item.label.split(' ').map((w, i) => <div key={i}>{w}</div>)}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Settings + Signout */}
        <div style={{ borderTop: '1px solid #1A2840', padding: '8px 0' }}>
          <Link href="/settings" title="Settings"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '10px 4px',
              color: '#6B7A8D', textDecoration: 'none', fontSize: '9px' }}>
            <Settings className="w-4 h-4" /><span>Settings</span>
          </Link>
          <button onClick={handleSignOut} title="Sign Out"
            style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
              padding: '10px 4px', background: 'none', border: 'none', color: '#6B7A8D', cursor: 'pointer', fontSize: '9px' }}>
            <LogOut className="w-4 h-4" /><span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top Bar */}
        <header style={{ backgroundColor: '#0D1623', borderBottom: '1px solid #1A2840', flexShrink: 0 }}>

          {/* Markets ticker — horizontal scroll on mobile */}
          <div
            style={{
              height: '36px',
              backgroundColor: '#060E1A',
              borderBottom: '1px solid #1A2840',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '12px',
              paddingRight: '12px',
              gap: '16px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
            className="scrollbar-hide mobile-scroll"
          >
            {markets.map(m => (
              <button
                key={m.symbol}
                onClick={() => setDrawerTicker({ symbol: m.symbol })}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 4px', borderRadius: '6px' }}
                title={`View ${m.symbol} details`}
              >
                <span style={{ fontSize: '11px', fontWeight: '600', color: '#C9D4E0' }}>{m.symbol}</span>
                <span style={{ fontSize: '11px', color: '#8A95A3' }}>{m.price}</span>
                <span style={{ fontSize: '11px', fontWeight: '600', color: m.up ? '#10B981' : '#EF4444' }}>{m.change}</span>
              </button>
            ))}
          </div>

          {/* Header row — compact on mobile */}
          <div style={{ height: '48px', padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: '700', background: 'linear-gradient(90deg, #0F7ABF, #06B6D4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                MARKET COCKPIT
              </span>
              <span className="desktop-header-subtitle" style={{ fontSize: '11px', color: '#4A5B6C' }}>Bloomberg-lite · India + US</span>
            </div>

            {/* Market hours + Search + User */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="desktop-market-hours">
                <MarketHours />
              </div>

              <button
                onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true } as any))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'none',
                  border: '1px solid #1A2840',
                  borderRadius: '10px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  color: '#6B7A8D',
                  minHeight: '36px',
                  minWidth: '36px',
                  justifyContent: 'center',
                }}
                title="Search tickers (Cmd+K)"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* User menu — hidden on mobile, accessible via bottom nav */}
              <div className="desktop-user-menu" style={{ position: 'relative' }}>
                <button onClick={() => setUserMenu(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: '1px solid #1A2840', borderRadius: '10px', padding: '6px 12px', cursor: 'pointer', color: '#C9D4E0' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #0F7ABF, #06B6D4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: 'white' }}>
                    {(userProfile?.display_name || 'R').charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontSize: '13px' }}>{userProfile?.display_name || 'User'}</span>
                  <ChevronDown className="w-3 h-3" style={{ color: '#4A5B6C' }} />
                </button>

                {userMenu && (
                  <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: '180px', backgroundColor: '#111B35', border: '1px solid #1A2840', borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', zIndex: 100, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #1A2840' }}>
                      <p style={{ fontSize: '13px', fontWeight: '600', color: '#F5F7FA', margin: 0 }}>{userProfile?.display_name || 'User'}</p>
                      <p style={{ fontSize: '11px', color: '#4A5B6C', margin: 0 }}>Active Investor</p>
                    </div>
                    <div style={{ padding: '6px 0' }}>
                      <Link href="/settings" style={{ display: 'block', padding: '8px 16px', fontSize: '13px', color: '#C9D4E0', textDecoration: 'none' }}>⚙️ Settings</Link>
                      <button onClick={handleSignOut} style={{ width: '100%', textAlign: 'left', padding: '8px 16px', fontSize: '13px', color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', borderTop: '1px solid #1A2840' }}>
                        🚪 Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content — add bottom padding on mobile for bottom nav */}
        <main className="mobile-main-content" style={{ flex: 1, overflowY: 'auto', backgroundColor: '#0A0E1A' }}>
          {children}
        </main>
      </div>

      {/* ── Mobile Bottom Navigation ─────────────────────────────────── */}
      <nav
        className="mobile-bottom-nav mobile-bottom-nav"
        style={{
          display: 'none',
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '56px',
          backgroundColor: '#0D1623',
          borderTop: '1px solid #1A2840',
          zIndex: 50,
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingTop: '4px',
          paddingBottom: '4px',
        }}
      >
        {NAV.map(item => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                padding: '6px 12px',
                textDecoration: 'none',
                color: active ? '#0F7ABF' : '#6B7A8D',
                fontSize: '10px',
                fontWeight: active ? '600' : '400',
                minWidth: '56px',
                minHeight: '44px',
                justifyContent: 'center',
              }}>
              {item.icon}
              <span>{item.label.split(' ')[0]}</span>
            </Link>
          );
        })}
        <Link href="/settings"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            padding: '6px 12px',
            textDecoration: 'none',
            color: pathname?.startsWith('/settings') ? '#0F7ABF' : '#6B7A8D',
            fontSize: '10px',
            minWidth: '56px',
            minHeight: '44px',
            justifyContent: 'center',
          }}>
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </Link>
        <button onClick={handleSignOut}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            padding: '6px 12px',
            background: 'none',
            border: 'none',
            color: '#6B7A8D',
            fontSize: '10px',
            cursor: 'pointer',
            minWidth: '56px',
            minHeight: '44px',
            justifyContent: 'center',
          }}>
          <LogOut className="w-5 h-5" />
          <span>Sign Out</span>
        </button>
      </nav>

      {/* Click-away for user menu */}
      {userMenu && (
        <div onClick={() => setUserMenu(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
      )}

      {/* Ticker drilldown drawer */}
      {drawerTicker && (
        <TickerDrawer
          symbol={drawerTicker.symbol}
          exchange={drawerTicker.exchange}
          onClose={() => setDrawerTicker(null)}
        />
      )}

      {/* Global Search Modal */}
      <GlobalSearch />
    </div>
  );
}
