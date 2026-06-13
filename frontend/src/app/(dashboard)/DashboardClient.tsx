'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Newspaper, Calendar, Briefcase, Compass, Bell, Settings, LogOut, ChevronDown, BookMarked, Search,
  TrendingUp, Grid3X3, RefreshCw, Filter, Globe, Rocket, Shield, LineChart, Star, Microscope, Factory,
} from 'lucide-react';
import api from '@/lib/api';
import TickerDrawer from '@/components/TickerDrawer';
import GlobalSearch from '@/components/GlobalSearch';
import { PdfExportButton } from '@/components/PdfExportButton';
import MarketHours from '@/components/MarketHours';
// PATCH 0283 — Surface Conviction Beats count in the global header.
import { getConvictionTickers } from '@/lib/conviction-beats';

interface NavItem { href: string; label: string; icon: ReactNode; }

// PATCH 0603 — Grouped sidebar. INSTITUTIONAL_REVIEW.md called out the
// 28-item flat nav as cognitive overload. New structure groups every
// surface into 9 collapsible parents. URLs are unchanged so deep links
// and bookmarks still work; only the visual organisation changes.
interface NavGroup { id: string; label: string; icon: ReactNode; items: NavItem[]; }

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'Home',
    icon: <Star className="w-5 h-5" />,
    items: [
      { href: '/',                 label: 'Home Dashboard',     icon: <Star className="w-4 h-4" /> },
    ],
  },
  // PATCH 0617 — sidebar reorder per user request:
  //   1. Earnings tabs right after News & Signals (was 3rd, now 2nd).
  //   2. News Alerts + Themes moved out of News & Signals to the very end.
  {
    id: 'news-signals',
    label: 'News & Signals',
    icon: <Newspaper className="w-5 h-5" />,
    items: [
      // PATCH 0905 — /company-news route was deleted in an earlier sweep
      // (frontend/src/app/(dashboard)/company-news/** removed). The nav link
      // remained, sending users to a 404. Removed per user request.
      { href: '/news',             label: 'News Feed',          icon: <Newspaper className="w-4 h-4" /> },
      { href: '/in-play', label: 'Live In Play', icon: <Newspaper className='w-4 h-4' /> },
        { href: '/fundamentals', label: 'Fundamentals', icon: <BarChart3 className="w-4 h-4" /> },
    ],
  },
  {
    id: 'earnings',
    label: 'Earnings',
    icon: <LineChart className="w-5 h-5" />,
    items: [
      { href: '/earnings-hub',           label: 'Earnings Hub',           icon: <LineChart className="w-4 h-4" /> },
      { href: '/earnings-opportunities', label: 'Earnings Opportunities', icon: <Star className="w-4 h-4" /> },
      { href: '/earnings',               label: 'Earnings Scan',          icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/earnings-analysis',      label: 'Earnings Analysis (AI)', icon: <Microscope className="w-4 h-4" /> },
      { href: '/earnings-guidance',      label: 'Earnings Guidance',      icon: <LineChart className="w-4 h-4" /> },
      { href: '/calendars',              label: 'Calendar',               icon: <LineChart className="w-4 h-4" /> },
    ],
  },
  {
    id: 'bottleneck',
    label: 'Bottleneck Intelligence',
    icon: <Microscope className="w-5 h-5" />,
    items: [
      { href: '/bottleneck-intel',     label: 'Bottleneck Intel',     icon: <Microscope className="w-4 h-4" /> },
      { href: '/bottleneck-workbench', label: 'Bottleneck Workbench', icon: <Microscope className="w-4 h-4" /> },
      { href: '/transmission',         label: 'Transmission',         icon: <TrendingUp className="w-4 h-4" /> },
      { href: '/strategic-visibility', label: 'Strategic Visibility', icon: <Star className="w-4 h-4" /> },
    ],
  },
  {
    id: 'concall',
    label: 'Concall Intelligence',
    icon: <Microscope className="w-5 h-5" />,
    items: [
      { href: '/concall-intel',       label: 'Concall Intelligence', icon: <Microscope className="w-4 h-4" /> },
      { href: '/guidance-extractor',  label: 'Guidance Extractor',   icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/company-intel',  label: 'Company Intelligence', icon: <BookMarked className="w-4 h-4" /> },
      { href: '/ai-desk',        label: 'AI Desk',              icon: <Microscope className="w-4 h-4" /> },
    ],
  },
  {
    id: 'special-events',
    label: 'Event-Driven',
    icon: <Compass className="w-5 h-5" />,
    items: [
      { href: '/special-situations', label: 'Special Situations', icon: <Compass className="w-4 h-4" /> },
      // PATCH 0773 — Order Book Intel + Rating Actions nav entries DELETED.
      // User feedback: empty data, distracting from real workflow.
      // Pages also removed from the route table.
    ],
  },
  {
    id: 'research',
    label: 'Research',
    icon: <Star className="w-5 h-5" />,
    items: [
      { href: '/multibagger',     label: 'Multibagger',           icon: <Star className="w-4 h-4" /> },
      { href: '/buy-strategy', label: 'Buy Strategy', icon: <Rocket className="w-4 h-4" /> },
      { href: '/capex-tracker', label: 'Capex Tracker', icon: <Factory className="w-4 h-4" /> },
      { href: '/valuations',      label: 'Valuations',            icon: <Star className="w-4 h-4" /> },
      { href: '/valuation-calc',  label: 'Valuation Calculators', icon: <Star className="w-4 h-4" /> },
      { href: '/auto-valuation',  label: 'Auto-Valuation',        icon: <Star className="w-4 h-4" /> },
      { href: '/rerating',       label: 'Re-rating',       icon: <TrendingUp className="w-4 h-4" /> },
      { href: '/stock-sheet',    label: 'Stock Sheet',     icon: <BookMarked className="w-4 h-4" /> },
      { href: '/screener',       label: 'Screener',        icon: <Filter className="w-4 h-4" /> },
    ],
  },
  {
    id: 'market',
    label: 'Market Snapshot',
    icon: <Grid3X3 className="w-5 h-5" />,
    items: [
      { href: '/market-snapshot', label: 'Market Snapshot', icon: <Grid3X3 className="w-4 h-4" /> },
      { href: '/heatmap',         label: 'Heatmap',         icon: <Grid3X3 className="w-4 h-4" /> },
      { href: '/movers',          label: 'Movers',          icon: <TrendingUp className="w-4 h-4" /> },
      { href: '/rrg',             label: 'RRG',             icon: <RefreshCw className="w-4 h-4" /> },
      { href: '/breadth',         label: 'Breadth',         icon: <BarChart3 className="w-4 h-4" /> },
    ],
  },
  {
    id: 'smart-money',
    label: 'Smart Money & IPOs',
    icon: <Rocket className="w-5 h-5" />,
    items: [
      { href: '/super-investors', label: 'Super Investors', icon: <Star className="w-4 h-4" /> },
      { href: '/smart-money',     label: 'Smart Money',     icon: <Briefcase className="w-4 h-4" /> },
      { href: '/ipos',            label: 'IPOs',            icon: <Rocket className="w-4 h-4" /> },
    ],
  },
  {
    id: 'mybook',
    label: 'My Book',
    icon: <Briefcase className="w-5 h-5" />,
    items: [
      { href: '/portfolio',     label: 'Portfolio',        icon: <Briefcase className="w-4 h-4" /> },
      { href: '/watchlists',    label: 'Watchlist',        icon: <BookMarked className="w-4 h-4" /> },
      { href: '/decisions',     label: 'Decision Logbook', icon: <BookMarked className="w-4 h-4" /> },
      { href: '/activity-log',  label: 'Activity Log',     icon: <BookMarked className="w-4 h-4" /> },
      { href: '/orders',     label: 'Signals',          icon: <Shield className="w-4 h-4" /> },
      { href: '/alerts',     label: 'Alerts',           icon: <Bell className="w-4 h-4" /> },
    ],
  },
  {
    id: 'system',
    label: 'System & Tools',
    icon: <Bell className="w-5 h-5" />,
    items: [
      { href: '/playbook',         label: 'Playbook',         icon: <BookMarked className="w-4 h-4" /> },
      { href: '/investing-os', label: 'Investing OS', icon: <Compass className="w-4 h-4" /> },
      { href: '/gautam-baid', label: 'Baid Playbook', icon: <BookMarked className="w-4 h-4" /> },
      { href: '/earnings-trigger', label: 'Earnings Trigger', icon: <TrendingUp className="w-4 h-4" /> },
      { href: '/earnings-trigger-masterclass', label: 'ET Masterclass', icon: <BookMarked className="w-4 h-4" /> },
      { href: '/critical-themes',  label: 'Critical Themes',  icon: <Star className="w-4 h-4" /> },
      { href: '/themes',           label: 'Themes',           icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/news-alerts',  label: 'News Alerts',   icon: <Bell className="w-4 h-4" /> },
      { href: '/status',       label: 'System Status', icon: <Bell className="w-4 h-4" /> },
      { href: '/settings',     label: 'Settings',      icon: <Shield className="w-4 h-4" /> },
    ],
  },
];

// Flat NAV preserved for any code that still iterates flatly (e.g. CmdK
// search). Auto-derived from groups so we don't maintain two arrays.
const NAV: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// _LEGACY_NAV_FOR_REFERENCE_ — keep the old flat list compiled-out so future
// readers can see the pre-0603 ordering / comments at a glance.
const _LEGACY_NAV: NavItem[] = [
  { href: '/news',          label: 'News Feed',          icon: <Newspaper className="w-5 h-5" /> },
        { href: '/fundamentals', label: 'Fundamentals', icon: <BarChart3 className="w-4 h-4" /> },
  // PATCH 0090: heatmap + movers merged into Market Snapshot (toggle inside)
  { href: '/market-snapshot', label: 'Market Snapshot',  icon: <Grid3X3 className="w-5 h-5" /> },
  { href: '/portfolio',     label: 'Portfolio',          icon: <Briefcase className="w-5 h-5" /> },
  { href: '/watchlists',    label: 'Watchlist',          icon: <BookMarked className="w-5 h-5" /> },
  // PATCH 0209: 'Intelligence' was confusing — it routed to /orders, suggesting a
  // trade-order page, but the content is a signals workbench. Relabel to 'Signals'.
  { href: '/orders',        label: 'Signals',            icon: <Shield className="w-5 h-5" /> },
  // PATCH 0092: Special Situations pillar (SPIN / M&A / TURN / CAP scanners)
  { href: '/special-situations', label: 'Special Situations', icon: <Compass className="w-5 h-5" /> },
  // PATCH 0773 — Rating Actions legacy flat-nav entry DELETED (matches
  // the grouped-nav removal at line ~89). Page route also removed.
  // PATCH 0091: Earnings + Earnings AI + Calendar merged into Earnings Hub (sub-tabs inside)
  { href: '/earnings-hub',  label: 'Earnings Hub',       icon: <LineChart className="w-5 h-5" /> },
  // PATCH 0123: bring back the legacy /earnings page (Portfolio + Watchlist + 750-company
  // custom universe earnings cards with YoY/QoQ + EPS deltas).  The page file was never
  // deleted, only the sidebar link.  Restored as a separate entry so Earnings Hub is
  // untouched.  User: 'don't change earnings hub — that is my best use functionality'.
  { href: '/earnings',      label: 'Earnings Scan',      icon: <BarChart3 className="w-5 h-5" /> },
  // PATCH 0130: Earnings Opportunities Pro — BLOCKBUSTER/STRONG/MIXED/AVOID
  // grading of Indian earnings filings, modelled on earningspulse.ai.
  { href: '/earnings-opportunities', label: 'Earnings Opportunities', icon: <Star className="w-5 h-5" /> },
  // PATCH 0350 — Strategic Visibility moved next to the earnings intelligence
  // cluster (it surfaces transformational-contract / mega-deal wins which is
  // an earnings-adjacent decision surface). Was previously sandwiched between
  // Bottleneck Workbench and RRG which obscured its connection to earnings.
  { href: '/strategic-visibility', label: 'Strategic Visibility', icon: <Star className="w-5 h-5" /> },
  { href: '/multibagger',   label: 'Multibagger',        icon: <Star className="w-5 h-5" /> },
  // VALUATION-C — automated valuation models (DCF / EV-EBITDA / Graham / EPV
  // / Reverse-DCF / Justified-P/E / P/B-ROE / Sector-PE / Owner-Earnings /
  // Asset-Floor) with Bull/Base/Bear cases and bulk-import for concall
  // guidance text. Slots next to Multibagger because it shares the same
  // localStorage upload universe (mb_excel_scored_v2).
  { href: '/valuations',    label: 'Valuations',         icon: <Star className="w-5 h-5" /> },
  // PATCH 0482 — Super Investor Tracker. Coat-tail dashboard for 10 Indian
  // growth-style investors: Kacholia / Kedia / Porinju / Pabrai / Andrade /
  // Mukherjea / Anand Shah / Khemani / Bakshi / Mittal. Holdings table +
  // news / interviews per investor.
  // PATCH 0554 — Moved above Decision Logbook per user.
  { href: '/super-investors', label: 'Super Investors',  icon: <Star className="w-5 h-5" /> },
  // PATCH 0107 / 0171: Concall Intelligence Engine v2.
  // PATCH 0553/0554 — Sits next to Super Investors, both above Decision Logbook.
  { href: '/concall-intel', label: 'Concall Intelligence', icon: <Microscope className="w-5 h-5" /> },
  // PATCH 0454 TIER1-A — Decision Logbook (queryable journal of every BUY /
  // WATCH / NEUTRAL / REJECTED across both markets, with CSV export).
  { href: '/decisions',     label: 'Decision Logbook',   icon: <BookMarked className="w-5 h-5" /> },
  // PATCH 0093: Single-Stock Sheet — 16-section institutional checklist runner
  { href: '/stock-sheet',   label: 'Stock Sheet',        icon: <BookMarked className="w-5 h-5" /> },
  // PATCH 0094: Re-rating Screener — margin expansion + model shift + multiple expansion
  { href: '/rerating',      label: 'Re-rating',          icon: <TrendingUp className="w-5 h-5" /> },
  { href: '/bottleneck-intel', label: 'Bottleneck Intel', icon: <Microscope className="w-5 h-5" /> },
  // PATCH 0235 — Per-theme workbench (frontend v0 on existing data)
  { href: '/bottleneck-workbench', label: 'Bottleneck Workbench', icon: <Microscope className="w-5 h-5" /> },
  { href: '/rrg',           label: 'RRG',                icon: <RefreshCw className="w-5 h-5" /> },
  { href: '/screener',      label: 'Screener',           icon: <Filter className="w-5 h-5" /> },
  // PATCH 0168: Market Breadth Indicator
  { href: '/breadth',       label: 'Breadth',            icon: <BarChart3 className="w-5 h-5" /> },
  // PATCH 0096 / 0170: Live Input Cost → Equity Transmission
  { href: '/transmission',  label: 'Transmission',       icon: <TrendingUp className="w-5 h-5" /> },
  // PATCH 0455 — Company Intelligence Hub. Upload concall transcripts /
  // PPTs / guidance docs once → site-wide retrievable corpus + auto-
  // extracted guidance items (revenue / EBITDA / capex / peak / orderbook).
  { href: '/company-intel', label: 'Company Intelligence', icon: <BookMarked className="w-5 h-5" /> },
  { href: '/ipos',          label: 'IPOs',               icon: <Rocket className="w-5 h-5" /> },
  // PATCH 0237: Client-side news alert rules v0
  { href: '/news-alerts',   label: 'News Alerts',        icon: <Bell className="w-5 h-5" /> },
  // PATCH 0219: System Status — per-pipeline heartbeats for institutional trust.
  { href: '/status',        label: 'System Status',      icon: <Bell className="w-5 h-5" /> },
  // PATCH 0089: macro-maps removed — header ticker covers global indices/currencies/commodities
  // PATCH 0091: standalone /calendars also merged into Earnings Hub above
];

// Static fallback shown while live data loads — no hardcoded prices to avoid showing stale data
const MARKETS_FALLBACK = [
  { symbol: 'NIFTY 50',  price: '—', change: '—', up: true },
  { symbol: 'SENSEX',    price: '—', change: '—', up: true },
  { symbol: 'S&P 500',   price: '—', change: '—', up: true },
  { symbol: 'NASDAQ',    price: '—', change: '—', up: true },
  { symbol: 'USD/INR',   price: '—', change: '—', up: true },
  { symbol: 'GOLD',      price: '—', change: '—', up: true },
  { symbol: 'CRUDE OIL', price: '—', change: '—', up: true },
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

  // PATCH 0283 — Global Conviction Beats count chip. Reads bench size from
  // the existing lib + listens for cross-tab updates. Clicking jumps to
  // /earnings-opportunities where the bench lives.
  const [convictionCount, setConvictionCount] = useState<number>(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setConvictionCount(getConvictionTickers().size); }
      catch { setConvictionCount(0); }
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);

  // ── Auth check: mark as checked (public data loads regardless) ──────────
  useEffect(() => {
    setAuthChecked(true);
  }, []);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Handle ?ticker= query parameter to open drawer
  // PATCH 0692 — drop the hardcoded NASDAQ fallback so the drawer can infer
  // exchange from the LIVE quote response (currency: 'INR' => NSE) rather
  // than mis-labelling every non-allowlisted Indian ticker as NASDAQ.
  useEffect(() => {
    const tickerParam = searchParams?.get('ticker');
    if (tickerParam) {
      const indianTickers = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'WIPRO', 'BAJFINANCE',
                             'TATAMOTORS', 'SUNPHARMA', 'ADANIENT', 'SBIN', 'AXISBANK', 'KOTAKBANK',
                             'HAL', 'BEL', 'NTPC', 'ONGC', 'MARUTI', 'HCLTECH', 'ITC', 'LT', 'POWERGRID',
                             'MTAR', 'BDL'];
      // Pass exchange ONLY when we're confident (allowlist hit). Otherwise leave
      // undefined so TickerDrawer can infer from the live quote.
      const exchange = indianTickers.includes(tickerParam.toUpperCase()) ? 'NSE' : undefined;
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

  // PATCH 0455 CLEANUP-4 — One-shot scrub of legacy localStorage versions
  // on app mount. Replaces scattered per-page scrub blocks.
  useEffect(() => {
    import('@/lib/kv-keys').then(m => {
      try { m.scrubLegacyLS(); } catch {}
    }).catch(() => {});
  }, []);

  // PATCH 0455 TIER1-C — Cross-page right-click ticker drawer.
  // Any element with data-ticker="SYMBOL" attribute (or a nested descendant)
  // captures right-click and opens the existing TickerDrawer. Saves the
  // user a full page navigation when they want quick context on a ticker
  // they see ANYWHERE in the dashboard (table cells, chips, watchlist
  // rows, news cards). Standard institutional UX.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest('[data-ticker]') as HTMLElement | null;
      if (!el) return;
      const sym = el.getAttribute('data-ticker')?.trim().toUpperCase();
      if (!sym) return;
      // Skip if user holds Shift / Ctrl (they may want browser context menu).
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const exchange = el.getAttribute('data-exchange') || undefined;
      setDrawerTicker({ symbol: sym, exchange });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Refetch market data when component re-mounts
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['market', 'indices'] });
  }, [qc]);

  // Show loading skeleton briefly — set short so pages feel fast
  useEffect(() => {
    const timer = setTimeout(() => setShowLoadingSkeleton(false), 600);
    return () => clearTimeout(timer);
  }, []);

  // Live market indices — refresh every 60 s
  // Tries FastAPI backend first, falls back to Next.js /api/market/indices route
  // PATCH 0437 BUG-001 — localStorage cache prime so the ticker bar doesn't
  // show all-zeros/dashes on cold load or after navigating back from an
  // external link. Last successful payload primes initialData; React Query
  // refetches fresh in background.
  const { data: liveIndices, isLoading, error } = useQuery<MarketIndex[]>({
    queryKey: ['market', 'indices'],
    queryFn: async () => {
      // Try 1: FastAPI backend (works when backend is running)
      try {
        const { data } = await api.get('/market/indices');
        if (Array.isArray(data) && data.length > 0) {
          setShowLoadingSkeleton(false);
          try { if (typeof window !== 'undefined') window.localStorage.setItem('mc:ticker-bar:v1', JSON.stringify({ data, ts: Date.now() })); } catch {}
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
            try { if (typeof window !== 'undefined') window.localStorage.setItem('mc:ticker-bar:v1', JSON.stringify({ data, ts: Date.now() })); } catch {}
            return data;
          }
        }
      } catch {}

      setShowLoadingSkeleton(false);
      return [];
    },
    initialData: (() => {
      if (typeof window === 'undefined') return undefined;
      try {
        const raw = window.localStorage.getItem('mc:ticker-bar:v1');
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        // Use cache only if less than 30 min old — prevents showing day-old prices
        if (Date.now() - (parsed.ts || 0) > 30 * 60_000) return undefined;
        return parsed.data;
      } catch { return undefined; }
    })(),
    // PATCH 0688 — bumped from 60s → 3min to ease Vercel free-tier CPU.
    // Conviction-Beats count chip already updates via localStorage events
    // when entries change; the polled refresh is a backstop, not primary.
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 2,
  });

  // Fetch user profile
  // PATCH 0874 — SSR-safe token check. Reading localStorage in render
  // body produced `false` during SSR and (potentially) `true` on client,
  // toggling React Query's `enabled` flag between renders → hydration
  // mismatch warnings on every load. Track via state + effect so server
  // and first client render agree (both `false`), then update post-mount.
  const [hasToken, setHasToken] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHasToken(!!localStorage.getItem('token'));
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'token') setHasToken(!!localStorage.getItem('token'));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
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
  // PATCH 0268 — Distinguish 'genuinely 0%' from 'change_pct missing'. The
  // top strip showing '+0.00%' on every symbol was misleading — actually
  // meant the API didn't return a change for that symbol. Now we render
  // an em-dash instead so the user knows the change is unknown.
  const markets = liveIndices && liveIndices.length > 0
    ? liveIndices.map((m) => {
        const hasChange = typeof m.change_pct === 'number' && Number.isFinite(m.change_pct);
        const pct = hasChange ? m.change_pct! : 0;
        const price = typeof m.price === 'number'
          ? m.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : String(m.price);
        const changeStr = hasChange ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—';
        return { symbol: m.symbol, price, change: changeStr, up: pct >= 0 };
      })
    : showLoadingSkeleton || isLoading
      ? MARKETS_FALLBACK.map(m => ({ ...m, price: '...', change: '...' }))
      : MARKETS_FALLBACK;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname?.startsWith(href + '/');

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
      {/*
       * PATCH 0965 UX — Sidebar label truncation.
       * Root cause: the sidebar was 72px wide and rendered each label
       * word-by-word at 9px. Long words like "Bottleneck" / "Intelligence"
       * wrapped *visually* but the per-word block had no overflow handling,
       * producing the awful "BOTTLENE / INTELLIGE" clipping. The Link
       * already had a `title=` so a tooltip existed, but the visible text
       * was unreadable.
       * Fix: widen the rail from 72px → 96px (still compact) so most
       * common words fit, AND add `text-overflow: ellipsis` + `overflow:
       * hidden` to each word span so the rare extra-long word gets a
       * clean "Intellig…" with the existing title-attr tooltip showing
       * the full label on hover.
       */}
      <aside className="desktop-sidebar" style={{
        width: '96px',
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

        {/* Nav items (PATCH 0603 — grouped) */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.id} style={{ marginBottom: 4 }}>
              {/* Group divider — first group has no top border */}
              {gi > 0 && (
                <div style={{
                  borderTop: '1px solid #1A2840',
                  margin: '6px 12px 4px',
                  paddingTop: 6,
                  fontSize: 8,
                  color: '#4A5B6C',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                }}>
                  {group.label}
                </div>
              )}
              {group.items.map(item => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href}
                    title={`${group.label} › ${item.label}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '10px 4px',
                      margin: '2px 6px',
                      borderRadius: '10px',
                      textDecoration: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      backgroundColor: active ? 'rgba(15,122,191,0.18)' : 'transparent',
                      color: active ? '#0F7ABF' : '#6B7A8D',
                      fontSize: '9px',
                      fontWeight: active ? '600' : '400',
                      letterSpacing: '0.3px',
                      borderLeft: active ? '2px solid #0F7ABF' : '2px solid transparent',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                    }}>
                    <div>{item.icon}</div>
                    {/*
                     * PATCH 0965 UX — per-word ellipsis. The wider rail
                     * (96px) fits "Bottleneck" / "Intelligence" but if a
                     * future label adds a 12+ char word we now clip
                     * cleanly with an ellipsis instead of mid-letter
                     * truncation. The `title` on the parent Link still
                     * exposes the full label on hover.
                     */}
                    <span style={{ textAlign: 'center', lineHeight: '1.2', width: '100%' }}>
                      {item.label.split(' ').map((w, i) => (
                        <div
                          key={i}
                          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {w}
                        </div>
                      ))}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* PATCH 0607 — bottom-left sidebar items removed.
            Theme switcher already present in the top-right header (Dark/Light/Pro).
            Settings + Sign Out already in the User menu top-right.
            User feedback: "remove from left — i have those on right already". */}
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
            {(showLoadingSkeleton || isLoading) && (!liveIndices || liveIndices.length === 0) ? (
              // Show animated skeleton pills while market data loads
              MARKETS_FALLBACK.map(m => (
                <div key={m.symbol} style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0, padding: '4px 4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#4A5B6C' }}>{m.symbol}</span>
                  <div style={{ width: '42px', height: '12px', backgroundColor: '#1A2840', borderRadius: '4px', animation: 'shimmer 1.5s infinite' }} />
                  <div style={{ width: '38px', height: '12px', backgroundColor: '#1A2840', borderRadius: '4px', animation: 'shimmer 1.5s infinite 0.2s' }} />
                </div>
              ))
            ) : markets.map(m => (
              <button
                key={m.symbol}
                onClick={() => setDrawerTicker({ symbol: m.symbol })}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: '6px', transition: 'background-color 0.15s' }}
                title={`View ${m.symbol} details`}
              >
                <span style={{ fontSize: '11px', fontWeight: '600', color: '#C9D4E0' }}>{m.symbol}</span>
                {m.price !== '—' && <span style={{ fontSize: '11px', color: '#8A95A3', fontVariantNumeric: 'tabular-nums' }}>{m.price}</span>}
                <span style={{ fontSize: '11px', fontWeight: '700', color: m.change === '—' || m.change === '...' ? '#4A5B6C' : m.up ? '#10B981' : '#EF4444', fontVariantNumeric: 'tabular-nums' }}>{m.change}</span>
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

            {/* Market hours + Theme + PDF + Search + User */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="desktop-market-hours">
                <MarketHours />
              </div>

              {/* PATCH 0283 — Global Conviction Beats count chip. Always
                  visible across every dashboard route so the bench size is
                  never more than one glance away. */}
              {convictionCount > 0 && (
                <Link
                  href="/earnings-opportunities"
                  title={`Conviction Beats bench (${convictionCount} tickers). Open Earnings Opportunities to view the bench.`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', borderRadius: 8,
                    border: '1px solid rgba(245,158,11,0.4)',
                    backgroundColor: 'rgba(245,158,11,0.10)',
                    color: '#F59E0B', fontSize: 11, fontWeight: 800,
                    letterSpacing: '0.4px', textDecoration: 'none',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >🏆 CB {convictionCount}</Link>
              )}

              {/* PATCH 0074: theme cycler + PDF export — visible on every tab */}
              {/* ThemeSwitcher removed — light/pro themes were never wired to page styles */}
              <PdfExportButton />

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
        // PATCH 1035 — overlay zIndex was 90, sat ABOVE sidebar (z=40), so first sidebar
        // click was consumed by overlay (just closed menu). Drop to z=30 so overlay stays
        // BELOW sidebar — first click reaches the <Link> and navigates.
        <div onClick={() => setUserMenu(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'transparent' }} />
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
