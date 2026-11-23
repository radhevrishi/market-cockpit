// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION HUBS (zzz1294). Pure.
//
// The portal had ~57 favourite chips and ~100 sidebar links in 12 groups. Every page stays where it is (no URL moves, so
// no link or bookmark can break), and the pages are now grouped into SEVEN main hubs. A hub has a home page and
// sub-tabs; India / USA twins are ONE sub-tab with an IN / US switch; saved screens and page sections (Pine presets,
// Theme Rotation, Technicals, Stress) are sub-tabs of their parent instead of separate favourites.
//
//   🛩️ Today · 📅 Earnings · 💼 My Book · 🔍 Discover · 📈 Charts · 🌐 Markets & News · 🧮 Tools & Learn
//
// System pages (status, health, AI runs, settings, diagnostics) are not a hub: they sit in a small System group.
// A test (zzz1294-nav-hubs) checks that every page of the old sidebar and every old favourite is in a hub.
// ═══════════════════════════════════════════════════════════════════════════

export interface HubTab {
  /** the sub-tab's own link; for an India / USA pair this is the India one */
  href: string;
  label: string;
  /** the USA twin of the same tool */
  us?: string;
  /** further pages / presets that belong to this sub-tab (matched for highlighting, listed as small links) */
  more?: Array<{ href: string; label: string }>;
  ext?: boolean;
}
export interface Hub { id: string; label: string; icon: string; home: string; blurb: string; tabs: HubTab[] }

export const HUBS: Hub[] = [
  {
    id: 'today', label: 'Today', icon: '🛩️', home: '/cockpit', blurb: 'What needs doing now: actions, alerts, the weekly review.',
    tabs: [
      { href: '/cockpit', label: 'Action Cockpit' },
      { href: '/', label: 'Home Dashboard' },
      { href: '/orders', label: 'Signals', more: [{ href: '/signals', label: 'Signals board' }] },
      { href: '/alerts', label: 'Alerts', more: [{ href: '/news-alerts', label: 'News alerts' }, { href: '/eo-alerts', label: 'Earnings alerts' }] },
      { href: '/weekly-review', label: 'Weekly Review' },
      { href: '/calendars', label: 'Calendar' },
    ],
  },
  {
    id: 'earnings', label: 'Earnings', icon: '📅', home: '/earnings-opportunities', blurb: 'Results, guidance and the gainers they cause — India and USA.',
    tabs: [
      { href: '/earnings-opportunities', label: 'Earnings Ops', us: '/us-earnings-opportunities' },
      { href: '/watchlists?tab=conviction', label: 'Conviction Beats', us: '/us-conviction-beats' },
      { href: '/guidance-upgrades', label: 'Guidance Upgrades' },
      { href: '/growth-guidance', label: 'Growth Guidance' },
      { href: '/ai-gainers', label: 'AI Daily Gainers' },
      { href: '/transformational-gainers', label: 'Transformational Gainers' },
      { href: '/concall-intel?tab=radar', label: 'Transformation Radar' },
      { href: '/concall-intel', label: 'Concall Intelligence', more: [{ href: '/guidance-extractor', label: 'Guidance Extractor' }, { href: '/company-intel', label: 'Company Intelligence' }] },
      { href: '/search-docs', label: 'Document Search' },
      { href: '/ai-desk', label: 'AI Research Desk' },
      { href: '/earnings-hub', label: 'Earnings Hub', more: [{ href: '/earnings', label: 'Earnings Scan' }, { href: '/earnings-analysis', label: 'Earnings Analysis (AI)' }, { href: '/earnings-guidance', label: 'Earnings Guidance' }, { href: '/pead-tracker', label: 'PEAD Drift Tracker' }, { href: '/earnings-scan', label: 'Earnings Scan (new)' }] },
    ],
  },
  {
    id: 'book', label: 'My Book', icon: '💼', home: '/portfolio', blurb: 'What you own, why, and what changed.',
    tabs: [
      { href: '/portfolio', label: 'Portfolio Book', us: '/us-portfolio-book' },
      { href: '/portfolio?tab=tradebook', label: 'Tradebook' },
      { href: '/portfolio-catalysts', label: 'Portfolio Catalysts', us: '/us-portfolio-catalysts' },
      { href: '/exit-radar', label: 'Exit Radar' },
      { href: '/fundamentals?scope=portfolio', label: 'Portfolio Fundamentals', more: [{ href: '/fundamentals', label: 'Fundamentals' }, { href: '/fundamentals?scope=watchlist', label: 'Watchlist fundamentals' }] },
      { href: '/watchlists', label: 'Watchlist' },
      { href: '/price-alerts', label: 'Price Alerts' },
      { href: '/decisions', label: 'Decision Logbook', more: [{ href: '/activity-log', label: 'Activity Log' }, { href: '/thesis', label: 'Thesis Tracker' }] },
      { href: '/risk', label: 'Risk Desk', more: [{ href: '/position-sizing', label: 'Position Sizing' }, { href: '/coffee-can', label: 'Coffee Can' }, { href: '/tax-planner', label: 'Tax Planner' }, { href: '/book-watch', label: 'Book Watch' }] },
    ],
  },
  {
    id: 'discover', label: 'Discover', icon: '🔍', home: '/stock-screener', blurb: 'Find new names: screens, the lab, radars, multibaggers.',
    tabs: [
      { href: '/stock-screener', label: 'Stock Screener', more: [{ href: '/screener-screens', label: 'Screener.in Screens' }, { href: '/screener', label: 'Screener (old)' }] },
      { href: '/pine-screener', label: 'Pine Screener', more: [{ href: '/pine-screener?screen=mtf-aligned', label: 'Weekly + Monthly aligned' }, { href: '/pine-screener?screen=mtf-eo-strong', label: 'W+M + Strong result' }] },
      { href: '/company-lab', label: 'Company Lab', more: [{ href: '/stock-sheet', label: 'Stock Sheet' }] },
      { href: '/multibagger', label: 'Multibagger', more: [{ href: '/multibagger/screens', label: 'Auto Screens' }, { href: '/rerating', label: 'Re-rating' }, { href: '/capex-tracker', label: 'Capex Tracker' }] },
      { href: '/hundred-baggers', label: 'Future 100-baggers' },
      { href: '/inflection-radar', label: 'Inflection Radar' },
      { href: '/news?choke=1', label: 'Choke-Point Themes' },
      { href: '/special-situations', label: 'Special Situations', more: [{ href: '/strategic-hires', label: 'Strategic Hires' }, { href: '/marquee-capital', label: 'Marquee Capital' }, { href: '/marketing-auth', label: 'Marketing Auth' }] },
    ],
  },
  {
    id: 'charts', label: 'Charts', icon: '📈', home: '/charts', blurb: 'Price action: charts, technicals, movers, entries.',
    tabs: [
      { href: '/charts', label: 'Charts + Watchlist', more: [{ href: '/charts/grid', label: 'Multi-chart · Intraday' }] },
      { href: '/multibagger?tab=technicals-ind', label: 'Technicals', us: '/multibagger?tab=technicals-usa' },
      { href: '/movers', label: 'Movers', more: [{ href: '/in-play', label: 'Live In Play' }, { href: '/heatmap', label: 'Heatmap' }] },
      { href: '/cheat-entry', label: 'Cheat Entry' },
      { href: '/bounce-desk', label: 'Bounce Desk' },
      { href: '/volume-rules', label: 'Volume Rules' },
    ],
  },
  {
    id: 'markets', label: 'Markets & News', icon: '🌐', home: '/market-leadership', blurb: 'The market regime, money flows, themes and the news.',
    tabs: [
      { href: '/market-leadership', label: 'Market Leadership & Risk' },
      { href: '/multibagger?tab=theme-rotation', label: 'Theme Rotation', more: [{ href: '/themes', label: 'Themes' }, { href: '/critical-themes', label: 'Critical Themes' }] },
      { href: '/market-cycles', label: 'Market Cycles' },
      { href: '/fii-dii', label: 'FII / DII Flows', more: [{ href: '/smart-money', label: 'Smart Money' }, { href: '/ipos', label: 'IPOs' }] },
      { href: '/market-snapshot', label: 'Market Snapshot', more: [{ href: '/breadth', label: 'Breadth' }, { href: '/rrg', label: 'RRG' }] },
      { href: '/news', label: 'News Feed', more: [{ href: '/news-triage', label: 'News Triage' }] },
      { href: '/bottleneck-intel', label: 'Bottleneck Intel', more: [{ href: '/bottleneck-workbench', label: 'Bottleneck Workbench' }, { href: '/transmission', label: 'Transmission' }, { href: '/strategic-visibility', label: 'Strategic Visibility' }] },
      { href: '/budget-intel', label: 'Budget Intel' },
      { href: 'https://www.ibef.org/news/past-news', label: 'IBEF', ext: true },
    ],
  },
  {
    id: 'tools', label: 'Tools & Learn', icon: '🧮', home: '/valuation-calc', blurb: 'Valuation, simulators and the playbooks.',
    tabs: [
      { href: '/valuation-calc', label: 'Valuation Calc', more: [{ href: '/auto-valuation', label: 'Auto-Valuation' }, { href: '/valuations', label: 'Valuations' }, { href: '/valuation-bands', label: 'Valuation Bands' }] },
      { href: '/return-simulator', label: 'Return Simulator' },
      { href: '/smallcap-simulator', label: 'Simulators', us: '/qqq-simulator', more: [{ href: '/historical-returns', label: 'Historical Returns' }, { href: '/portfolio-simulator', label: 'Portfolio Simulator' }, { href: '/monte-carlo', label: 'Monte Carlo' }, { href: '/buy-strategy', label: 'Buy Strategy' }] },
      { href: '/playbook', label: 'Playbook', more: [{ href: '/playbook#stress', label: 'Stress' }, { href: '/winning-playbook', label: 'Winning Playbook' }, { href: '/gautam-baid', label: 'Baid Playbook' }] },
      { href: '/investing-os', label: 'Investing OS', more: [{ href: '/journey', label: 'The Journey' }] },
      { href: '/learn', label: 'Learn', more: [{ href: '/earnings-trigger', label: 'Earnings Trigger' }, { href: '/earnings-trigger-masterclass', label: 'ET Masterclass' }, { href: '/earnings-mastery', label: 'Earnings Mastery' }, { href: '/bottom-picking', label: 'Bottom Picking' }, { href: '/double-bottom', label: 'Double Bottom' }, { href: '/fan-principle', label: 'Fan Principle' }] },
    ],
  },
];

/** Not a hub — reachable from the sidebar's System group only. */
export const SYSTEM_PAGES: Array<{ href: string; label: string }> = [
  { href: '/status', label: 'System Status' }, { href: '/system-status', label: 'Pipeline status' }, { href: '/screener-sync', label: 'Screener sync' }, { href: '/system-health', label: 'System Health' }, { href: '/ai-runs', label: 'AI runs' },
  { href: '/guidance-diagnostics', label: 'Guidance diagnostics' }, { href: '/settings', label: 'Settings' },
];

/** Every link a hub tab stands for (India, USA, its extra pages). */
export function tabLinks(t: HubTab): string[] { return [t.href, ...(t.us ? [t.us] : []), ...(t.more || []).map((m) => m.href)]; }
export function allHubLinks(): string[] { return HUBS.flatMap((h) => h.tabs.flatMap(tabLinks)); }

/** How well a link matches the current address: -1 = no match; higher = more specific (path + every query key + hash). */
export function linkMatch(link: string, path: string, search: string, hash = ''): number {
  if (/^https?:/.test(link)) return -1;
  const [lp0, lh = ''] = link.split('#');
  const [lp, lq = ''] = lp0.split('?');
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  if (norm(lp) !== norm(path)) return -1;
  const cur = new URLSearchParams(search);
  const want = new URLSearchParams(lq);
  let n = 1;
  for (const [k, v] of want) { if (cur.get(k) !== v) return -1; n += 2; }
  if (lh) { if (hash.replace(/^#/, '') !== lh) return -1; n += 2; }
  // a link without a query loses to the same page opened on one of its own tabs (?tab=… / ?screen=… / ?scope=…)
  if (!lq) for (const k of ['tab', 'screen', 'scope', 'choke']) if (cur.has(k)) n -= 1;
  return n;
}

/** The hub and sub-tab of the current address (most specific match), or null. */
export function hubFor(path: string, search = '', hash = ''): { hub: Hub; tab: HubTab; link: string; market: 'IN' | 'US' | null } | null {
  let best: { hub: Hub; tab: HubTab; link: string; market: 'IN' | 'US' | null; s: number } | null = null;
  for (const hub of HUBS) for (const tab of hub.tabs) for (const link of tabLinks(tab)) {
    const s = linkMatch(link, path, search, hash);
    if (s >= 0 && (!best || s > best.s)) best = { hub, tab, link, market: tab.us ? (link === tab.us ? 'US' : link === tab.href ? 'IN' : null) : null, s };
  }
  return best ? { hub: best.hub, tab: best.tab, link: best.link, market: best.market } : null;
}
