'use client';

import { ReactNode, useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getFavourites, toggleFavourite, subscribeFavourites } from '@/lib/nav-favourites';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Newspaper, Calendar, Briefcase, Compass, Bell, Settings, LogOut, ChevronDown, BookMarked, Search,
  TrendingUp, Grid3X3, RefreshCw, Filter, Globe, Rocket, Shield, LineChart, Star, Microscope, Factory, Zap,
} from 'lucide-react';
import api from '@/lib/api';
// zzz855 — the drawer (react-query + date-fns + its own fetches) only loads when a ticker is opened.
const TickerDrawer = dynamic(() => import('@/components/TickerDrawer'), { ssr: false });
import GlobalSearch from '@/components/GlobalSearch';
import { PdfExportButton } from '@/components/PdfExportButton';
import ScreenThemeToggle from '@/components/ScreenThemeToggle';
import MarketHours from '@/components/MarketHours';
import RegimeBanner from '@/components/RegimeBanner'; // zzz524 — portal-wide market regime
import StockPassport from '@/components/StockPassport'; // zzz524 — global one-symbol overlay
// PATCH 0283 — Surface Conviction Beats count in the global header.
import { getConvictionTickers, getConvictionList, readConvictionBin, getBenchSince } from '@/lib/conviction-beats';
import { mergeIndiaBench } from '@/lib/fundamentals/universe';
import { scheduleBookSync } from '@/lib/book-sync-client';
// zzz796 — installable app: phone tab bar, favourites sheet, menu drawer, install help.
import MobileNav from '@/components/pwa/MobileNav';
import { InstallBanner, InstallAppCard } from '@/components/pwa/InstallApp';
import pwa from '@/components/pwa/pwa.module.css';
import { navPrefetch, shellFetchJson, whenIdle } from '@/lib/shell-fetch';

interface NavItem { href: string; label: string; icon: ReactNode; }

// PATCH 0603 — Grouped sidebar. INSTITUTIONAL_REVIEW.md called out the
// 28-item flat nav as cognitive overload. New structure groups every
// surface into 9 collapsible parents. URLs are unchanged so deep links
// and bookmarks still work; only the visual organisation changes.
interface NavGroup { id: string; label: string; icon: ReactNode; items: NavItem[]; }

// zzz707 — the rail has ~40 destinations; the ones opened every morning are
// scattered across five groups. Favourites pins them without reordering
// anything: a starred item still appears in its own group, because a tab
// quietly vanishing from where you expect it is worse than a long rail.

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'Home',
    icon: <Star className="w-5 h-5" />,
    items: [
      { href: '/',                 label: 'Home Dashboard',     icon: <Star className="w-4 h-4" /> },
      { href: '/cockpit',          label: 'Action Cockpit',     icon: <Compass className="w-4 h-4" /> },
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
      // US market engine — same grading, fed by SEC EDGAR instead of NSE/Screener.
      { href: '/us-earnings-opportunities', label: 'US Earnings Opportunities', icon: <Globe className="w-4 h-4" /> },
      { href: '/us-conviction-beats',       label: 'US Conviction Beats',       icon: <Globe className="w-4 h-4" /> },
      // zzz713 — the gainers funnel. It sits in Earnings rather than Markets
      // because in Phase 1 every catalyst it shows IS a filed result; the day
      // it reads announcements without a filing behind them, it moves.
      { href: '/ai-gainers',                label: 'AI Daily Gainers',          icon: <Zap className="w-4 h-4" /> },
      // zzz843 — positive guidance raises in the last 7 days, verified and quantified.
      { href: '/guidance-upgrades',         label: 'Guidance Upgrades',         icon: <LineChart className="w-4 h-4" /> },
      // zzz846 — companies where management guides unusually high growth (30%+), verified.
      { href: '/growth-guidance',           label: 'Growth Guidance',           icon: <TrendingUp className="w-4 h-4" /> },
      // The interpretation layer that sits ON TOP of the graded engine: it
      // never screens, it only reads what the filings already qualified.
      { href: '/ai-desk',                   label: 'AI Research Desk',          icon: <Microscope className="w-4 h-4" /> },
      { href: '/earnings',               label: 'Earnings Scan',          icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/earnings-analysis',      label: 'Earnings Analysis (AI)', icon: <Microscope className="w-4 h-4" /> },
      { href: '/earnings-guidance',      label: 'Earnings Guidance',      icon: <LineChart className="w-4 h-4" /> },
      { href: '/pead-tracker',           label: 'PEAD Drift Tracker',     icon: <TrendingUp className="w-4 h-4" /> },
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
      // zzz721 — the radar is a destination in its own right, not a tab you
      // have to know is hiding behind Concall Intelligence.
      { href: '/concall-intel?tab=radar', label: 'Transformation Radar', icon: <Rocket className="w-4 h-4" /> },
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
      // zzz400 — Book Watch alert feed (holdings/bench radar).
      { href: '/book-watch', label: 'Book Watch', icon: <Compass className="w-4 h-4" /> },
      // zzz399 — TheWrap alternate-data trackers (Modules 3/4/5).
      { href: '/strategic-hires', label: 'Strategic Hires', icon: <Compass className="w-4 h-4" /> },
      { href: '/marquee-capital', label: 'Marquee Capital', icon: <Compass className="w-4 h-4" /> },
      { href: '/marketing-auth', label: 'Marketing Auth', icon: <Compass className="w-4 h-4" /> },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    icon: <Star className="w-5 h-5" />,
    items: [
      { href: '/multibagger',     label: 'Multibagger',           icon: <Star className="w-4 h-4" /> },
      // zzz403/zzz404 — scenario simulators + historical returns reference
      { href: '/smallcap-simulator', label: 'Smallcap Simulator', icon: <LineChart className="w-4 h-4" /> },
      { href: '/qqq-simulator', label: 'QQQ Simulator', icon: <LineChart className="w-4 h-4" /> },
      { href: '/historical-returns', label: 'Historical Returns', icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/buy-strategy', label: 'Buy Strategy', icon: <Rocket className="w-4 h-4" /> },
      { href: '/capex-tracker', label: 'Capex Tracker', icon: <Factory className="w-4 h-4" /> },
      { href: '/valuations',      label: 'Valuations',            icon: <Star className="w-4 h-4" /> },
      { href: '/valuation-calc',  label: 'Valuation Calculators', icon: <Star className="w-4 h-4" /> },
      { href: '/valuation-bands', label: 'Valuation Bands',        icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/portfolio-simulator', label: 'Portfolio Simulator', icon: <LineChart className="w-4 h-4" /> },
      { href: '/winning-playbook', label: 'Winning Playbook', icon: <Star className="w-4 h-4" /> },
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
      { href: '/portfolio',     label: 'Portfolio (India)', icon: <Briefcase className="w-4 h-4" /> },
      // zzz790 — the US book: its own KV document, cash per currency, bench.
      { href: '/us-portfolio-book', label: 'US Portfolio Book', icon: <Globe className="w-4 h-4" /> },
      // zzz708 — what CHANGED in the book, as opposed to what it is worth.
      { href: '/portfolio-catalysts', label: 'Portfolio Catalysts (India)', icon: <Zap className="w-4 h-4" /> },
      // zzz790 — the same thesis engine over SEC filings (10-Q / 10-K / 8-K).
      { href: '/us-portfolio-catalysts', label: 'US Portfolio Catalysts', icon: <Globe className="w-4 h-4" /> },
      // zzz715 — the exit side of the same engine: which theses deteriorated,
      // and on what evidence. No price reason is allowed on that screen.
      { href: '/exit-radar', label: 'Exit Radar', icon: <Shield className="w-4 h-4" /> },
      { href: '/risk',          label: 'Risk Desk',        icon: <Shield className="w-4 h-4" /> },
      { href: '/position-sizing', label: 'Position Sizing', icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/thesis',        label: 'Thesis Tracker',   icon: <BookMarked className="w-4 h-4" /> },
      { href: '/coffee-can',    label: 'Coffee Can',       icon: <Star className="w-4 h-4" /> },
      { href: '/tax-planner',   label: 'Tax Planner',      icon: <Filter className="w-4 h-4" /> },
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
      { href: '/journey', label: 'The Journey', icon: <Rocket className="w-4 h-4" /> }, // PATCH 1082
      { href: '/monte-carlo', label: 'Monte Carlo', icon: <LineChart className="w-4 h-4" /> },
      { href: '/market-cycles', label: 'Market Cycles', icon: <RefreshCw className="w-4 h-4" /> }, // PATCH 1089 — handbook
      { href: '/gautam-baid', label: 'Baid Playbook', icon: <BookMarked className="w-4 h-4" /> },
      { href: '/earnings-trigger', label: 'Earnings Trigger', icon: <TrendingUp className="w-4 h-4" /> },
      { href: '/earnings-trigger-masterclass', label: 'ET Masterclass', icon: <BookMarked className="w-4 h-4" /> },
      { href: '/critical-themes',  label: 'Critical Themes',  icon: <Star className="w-4 h-4" /> },
      { href: '/themes',           label: 'Themes',           icon: <BarChart3 className="w-4 h-4" /> },
      { href: '/news-alerts',  label: 'News Alerts',   icon: <Bell className="w-4 h-4" /> },
      { href: '/status',       label: 'System Status', icon: <Bell className="w-4 h-4" /> },
      // PATCH zzz67 — System Health checkup (workers + cron + freshness)
      { href: '/system-health', label: 'System Health', icon: <Shield className="w-4 h-4" /> },
      // zzz848 — regression table for the guidance universe (System & Tools only; not linked from Guidance Upgrades)
      { href: '/guidance-diagnostics', label: 'Guidance diagnostics', icon: <BarChart3 className="w-4 h-4" /> },
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
  { href: '/guidance-upgrades', label: 'Guidance Upgrades', icon: <LineChart className="w-5 h-5" /> },
  { href: '/growth-guidance', label: 'Growth Guidance', icon: <TrendingUp className="w-5 h-5" /> },
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
  // zzz707 — favourites, read once and kept in sync across tabs.
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setFavs(getFavourites());
    sync();
    return subscribeFavourites(sync);
  }, []);
  const favGroup = useMemo(() => {
    if (!favs.length) return null;
    const all = NAV_GROUPS.flatMap((g) => g.items);
    // Ordered by the rail's own order, not by when each was starred, so the
    // shortcut list reads the same way the sidebar below it does.
    const items = all.filter((i) => favs.includes(i.href));
    return items.length ? { items } : null;
  }, [favs]);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [drawerTicker, setDrawerTicker] = useState<{ symbol: string; exchange?: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // PATCH 0283 — Global Conviction Beats count chip. Reads bench size from
  // the existing lib + listens for cross-tab updates. Clicking jumps to
  // /earnings-opportunities where the bench lives.
  const [convictionCount, setConvictionCount] = useState<number>(0);
  // zzz813: the badge used to count only THIS BROWSER's copy of the bench
  // (localStorage, often a handful of names) while the Conviction Beats page
  // and Portfolio Catalysts read the SERVER list (~300). It now shows the
  // same merged count they use: server list + names only in this browser −
  // names removed here (mergeIndiaBench).
  const [convictionTitle, setConvictionTitle] = useState<string>('');
  // zzz833: one number, two markets, both named — the US bench comes from the same server list the US pages use
  const [usBenchCount, setUsBenchCount] = useState<number | null>(null);
  // zzz880: the Conviction Beats "bench starts on" date, shown in the chip so a small India count explains itself ("India 4 (from 10-01)")
  const [benchSinceHeader, setBenchSinceHeader] = useState<string | null>(null);
  // zzz855 — read after the page's own requests have started (idle), one shared request.
  useEffect(() => whenIdle(() => {
    shellFetchJson<any>('/api/v1/bench-us?view=tickers')
      .then((j) => { if (j && Array.isArray(j.entries)) setUsBenchCount(new Set(j.entries.map((e: any) => String(e?.ticker || '').toUpperCase()).filter(Boolean)).size); })
      .catch(() => { /* chip shows the India count and says the US list is not read */ });
  }), []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let server: Array<{ ticker: string; company: string | null; tier: string | null; filing_date: string | null }> | null = null;
    const recount = () => {
      try {
        // zzz880: same scope as the Conviction Beats tab — its "bench starts on" date, and a removal hides only the filing it removed
        const since = getBenchSince();
        setBenchSinceHeader(since);
        const okSince = (d: unknown) => !since || String(d || '').slice(0, 10) >= since;
        const local = (getConvictionList() as any[]).filter((e) => okSince(e?.filing_date)).map((e) => ({ ticker: String(e?.ticker || ''), company: e?.company || null }));
        const removed = (readConvictionBin() as any[]).map((e) => ({ ticker: String(e?.ticker || ''), filing_date: e?.filing_date || null })).filter((e) => !!e.ticker);
        if (!server) { setConvictionCount(getConvictionTickers().size); setConvictionTitle(`${getConvictionTickers().size} in this browser (server list not read yet)`); return; }
        const mg = mergeIndiaBench(server.filter((x) => okSince(x.filing_date)), local, removed);
        setConvictionCount(mg.names.length);
        setConvictionTitle(`${mg.names.length} names: ${mg.server} on the server list${mg.localOnly ? ` + ${mg.localOnly} only in this browser` : ''}${mg.removed ? ` − ${mg.removed} removed here` : ''}`);
      } catch { try { setConvictionCount(getConvictionTickers().size); } catch { setConvictionCount(0); } }
    };
    const refresh = () => recount();
    recount();
    // zzz855 — idle + shared request (the count from this browser shows meanwhile, title says so)
    let alive = true;
    // zzz880 — one failed read (e.g. during a redeploy) left the chip on "India 5" (this browser's own names) for the whole session.
    // The read now retries (5 s, 20 s, 60 s) and runs again when the tab comes back into view.
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    const readServer = (attempt: number) => {
      shellFetchJson<any>('/api/v1/bench?view=tickers')
        .then((j) => {
          if (!alive) return;
          if (j && Array.isArray(j.entries)) { server = j.entries; recount(); return; }
          const wait = [5_000, 20_000, 60_000][attempt];
          if (wait != null) retryTimers.push(setTimeout(() => readServer(attempt + 1), wait));
        })
        .catch(() => { /* badge keeps the browser count, title says so */ });
    };
    const cancelIdle = whenIdle(() => readServer(0));
    const onVisible = () => { if (document.visibilityState === 'visible') readServer(3); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      alive = false;
      cancelIdle();
      retryTimers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);

  // zzz397 — Book Watch sync. Keep the server-side "book" (holdings + bench +
  // watchlist + decision snapshots) current from anywhere in the dashboard so
  // the book-watch cron can alert on names you actually own even with no tab
  // open. Debounced, fire-and-forget. Fires on mount, on navigation, and on
  // every relevant cross-tab update event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    scheduleBookSync(1500);
    const onChange = () => scheduleBookSync();
    window.addEventListener('storage', onChange);
    window.addEventListener('conviction-beats:updated', onChange);
    window.addEventListener('mc:decisions:updated', onChange);
    window.addEventListener('mc:watchlist:updated', onChange);
    window.addEventListener('mc:book-flags:updated', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('conviction-beats:updated', onChange);
      window.removeEventListener('mc:decisions:updated', onChange);
      window.removeEventListener('mc:watchlist:updated', onChange);
      window.removeEventListener('mc:book-flags:updated', onChange);
    };
  }, [pathname]);

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

  // zzz855 — the live indices query that used to sit here fed the header ticker bar,
  // which was removed in zzz240. It still polled /market/indices every 3 minutes,
  // on every window focus and on every mount, and wrote localStorage, while
  // nothing rendered it. Removed; no visible change.

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--mc-bg-0)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid var(--mc-bg-4)', borderTopColor: 'var(--mc-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--mc-text-4)', fontSize: '13px' }}>Loading...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname?.startsWith(href + '/');

  // zzz796 — also clear the owner cookie (before, Sign Out left you logged in).
  async function handleSignOut() {
    try { localStorage.removeItem('token'); } catch { /* ignore */ }
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* offline: still leave */ }
    window.location.href = '/login';
  }

  const openSearch = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true } as any));

  return (
    <div className={pwa.shell}>

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
      <aside className={`desktop-sidebar ${pwa.sidebar}`} style={{
        width: '96px',
        flexShrink: 0,
        backgroundColor: 'var(--mc-bg-1)',
        borderRight: '1px solid var(--mc-bg-4)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 40,
      }}>
        {/* Logo */}
        <div style={{ padding: '16px 0', textAlign: 'center', borderBottom: '1px solid var(--mc-bg-4)' }}>
          <div style={{
            width: '36px',
            height: '36px',
            background: 'linear-gradient(135deg, var(--mc-accent), #06B6D4)',
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
          {favGroup && (
            <div key="favourites" style={{ marginBottom: 4 }}>
              <div style={{
                margin: '2px 12px 4px', fontSize: 8, color: '#FCD34D', fontWeight: 800,
                letterSpacing: '0.5px', textAlign: 'center', textTransform: 'uppercase',
              }}>★ Favourites</div>
              {favGroup.items.map((item, fi) => {
                const active = isActive(item.href);
                return (
                  <Link key={`fav-${item.href}`} href={item.href} prefetch={navPrefetch(item.href, fi)} title={`Favourite › ${item.label}`}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                      padding: '10px 4px', margin: '2px 6px', borderRadius: '10px',
                      textDecoration: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      backgroundColor: active ? 'rgba(15,122,191,0.18)' : 'transparent',
                      color: active ? 'var(--mc-accent)' : 'var(--mc-text-4)',
                      fontSize: '9px', fontWeight: active ? '600' : '400', letterSpacing: '0.3px',
                      borderLeft: active ? '2px solid var(--mc-accent)' : '2px solid #FCD34D55',
                      userSelect: 'none', WebkitUserSelect: 'none',
                    }}>
                    <div>{item.icon}</div>
                    <span style={{ textAlign: 'center', lineHeight: '1.2', width: '100%' }}>
                      {item.label.split(' ').map((w, i) => (
                        <span key={i} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w}</span>
                      ))}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.id} style={{ marginBottom: 4 }}>
              {/* Group divider — first group has no top border */}
              {gi > 0 && (
                <div style={{
                  borderTop: '1px solid var(--mc-bg-4)',
                  margin: '6px 12px 4px',
                  paddingTop: 6,
                  fontSize: 8,
                  color: 'var(--mc-text-4)',
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
                const starred = favs.includes(item.href);
                return (
                  <div key={item.href} style={{ position: 'relative' }}>
                  <button
                    onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setFavs(toggleFavourite(item.href)); }}
                    title={starred ? `Remove ${item.label} from favourites` : `Add ${item.label} to favourites`}
                    aria-pressed={starred}
                    style={{
                      position: 'absolute', top: 2, right: 6, zIndex: 2, lineHeight: 1,
                      background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                      fontSize: 10, color: starred ? '#FCD34D' : 'var(--mc-bg-4)',
                    }}>{starred ? '★' : '☆'}</button>
                  <Link href={item.href} prefetch={navPrefetch(item.href, null)}
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
                      color: active ? 'var(--mc-accent)' : 'var(--mc-text-4)',
                      fontSize: '9px',
                      fontWeight: active ? '600' : '400',
                      letterSpacing: '0.3px',
                      borderLeft: active ? '2px solid var(--mc-accent)' : '2px solid transparent',
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
                  </div>
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
        <header className={pwa.header} style={{ backgroundColor: 'var(--mc-bg-1)', borderBottom: '1px solid var(--mc-bg-4)', flexShrink: 0 }}>

          {/* zzz240 — Markets ticker bar (NIFTY 50 / BANK NIFTY / SENSEX /
              USD-INR) removed per user request. Full-width index widgets on
              Market Snapshot cover the same ground with more detail. */}

          {/* Header row — compact on mobile */}
          <div className={pwa.headerRow}>
            <div className={pwa.brand}>
              {/* zzz796 — on phones the long name collapses to the MC badge so the chips fit. */}
              <Link href="/" className={pwa.brandBadge} aria-label="Market Cockpit home">MC</Link>
              <span className={pwa.brandText} style={{ fontSize: '15px', fontWeight: '700', background: 'linear-gradient(90deg, var(--mc-accent), #06B6D4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                MARKET COCKPIT
              </span>
              <span className="desktop-header-subtitle" style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>Bloomberg-lite · India + US</span>
            </div>

            {/* Market hours + Theme + PDF + Search + User */}
            <div className={pwa.chips}>
              <div className="desktop-market-hours">
                <MarketHours />
              </div>
              {/* zzz524 — regime pills (🇮🇳/🇺🇸) beside market hours; every
                  tab inherits one shared read of the market state. */}
              <RegimeBanner />

              {/* PATCH 0283 — Global Conviction Beats count chip. Always
                  visible across every dashboard route so the bench size is
                  never more than one glance away. */}
              {convictionCount > 0 && (
                <Link
                  href="/earnings-opportunities"
                  prefetch={false}
                  title={`${benchSinceHeader ? `India counts only results filed from ${benchSinceHeader} (the start date set on Conviction Beats — press "Show all" there to see every name). ` : ''}CB ${convictionCount + (usBenchCount || 0)} = India ${convictionCount} + US ${usBenchCount ?? '…'}: names meeting your Conviction Beats criteria in each market, added together (the Portfolio Catalysts pages show the India split as held + bench). Conviction Beats bench — India ${convictionTitle || `${convictionCount} tickers`}${usBenchCount != null ? `; US ${usBenchCount} on the server list` : '; US list not read yet'}. Open Earnings Opportunities to view the India bench.`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', borderRadius: 8,
                    border: '1px solid rgba(245,158,11,0.4)',
                    backgroundColor: 'rgba(245,158,11,0.10)',
                    color: 'var(--mc-warn)', fontSize: 11, fontWeight: 800,
                    letterSpacing: '0.4px', textDecoration: 'none',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >🏆 CB {convictionCount + (usBenchCount || 0)}<span style={{ fontWeight: 600, opacity: 0.85 }}> · India {convictionCount}{benchSinceHeader ? ` (from ${benchSinceHeader.slice(5)})` : ''}{usBenchCount != null ? ` · US ${usBenchCount}` : ' · US …'}</span></Link>
              )}

              {/* PATCH 0074: theme cycler + PDF export — visible on every tab */}
              {/* ThemeSwitcher removed — light/pro themes were never wired to page styles */}
              {/* zzz825: ☀/🌙 — light (white, ink-friendly) screens via the --mc-* variable set */}
              <ScreenThemeToggle />
              <PdfExportButton />

              <button
                className={pwa.desktopOnly}
                onClick={openSearch}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'none',
                  border: '1px solid var(--mc-bg-4)',
                  borderRadius: '10px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  color: 'var(--mc-text-4)',
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
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: '1px solid var(--mc-bg-4)', borderRadius: '10px', padding: '6px 12px', cursor: 'pointer', color: 'var(--mc-text-2)' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--mc-accent), #06B6D4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: 'white' }}>
                    {(userProfile?.display_name || 'R').charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontSize: '13px' }}>{userProfile?.display_name || 'User'}</span>
                  <ChevronDown className="w-3 h-3" style={{ color: 'var(--mc-text-4)' }} />
                </button>

                {userMenu && (
                  <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: '180px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', zIndex: 100, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--mc-bg-4)' }}>
                      <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--mc-text-0)', margin: 0 }}>{userProfile?.display_name || 'User'}</p>
                      <p style={{ fontSize: '11px', color: 'var(--mc-text-4)', margin: 0 }}>Active Investor</p>
                    </div>
                    <div style={{ padding: '6px 0' }}>
                      <Link href="/settings" prefetch={false} style={{ display: 'block', padding: '8px 16px', fontSize: '13px', color: 'var(--mc-text-2)', textDecoration: 'none' }}>⚙️ Settings</Link>
                      <button onClick={handleSignOut} style={{ width: '100%', textAlign: 'left', padding: '8px 16px', fontSize: '13px', color: 'var(--mc-bearish)', background: 'none', border: 'none', cursor: 'pointer', borderTop: '1px solid var(--mc-bg-4)' }}>
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
        <main className={`mobile-main-content ${pwa.main}`} style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--mc-bg-0)' }}>
          {/* zzz796 — "Install app" help on Settings (kept here so the page itself is untouched). */}
          {pathname?.startsWith('/settings') && (
            <div id="install-app"><InstallAppCard /></div>
          )}
          {children}
        </main>
      </div>

      {/* ── Phone navigation (zzz796) ─────────────────────────────────
          Bottom tab bar (Home · Favourites · Search · Menu) at ≤768px. The
          old bar looped over all ~40 pages and could not fit a phone. */}
      <MobileNav
        groups={NAV_GROUPS}
        favs={favs}
        pathname={pathname}
        isActive={isActive}
        onToggleFav={(href) => setFavs(toggleFavourite(href))}
        onSearch={openSearch}
        onSignOut={handleSignOut}
      />
      <InstallBanner />

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

      {/* zzz524 — Stock Passport: everything every engine knows about one
          symbol, openable from anywhere via openPassport(sym). */}
      <StockPassport />
    </div>
  );
}
