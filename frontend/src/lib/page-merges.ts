// ═══════════════════════════════════════════════════════════════════════════
// PAGE MERGES (zzz1296). Pure.
//
// Pages that did the same job now live as tabs of one workspace page (components/Workspace). Their old addresses
// forward to the workspace tab, KEEPING every address value (?ticker=, ?theme=, ?p= …), so bookmarks, alert links and
// links inside other pages keep working. The page files stay — the workspaces load them as tabs.
//
//   🔔 /alerts-center   price-alerts · news-alerts · eo-alerts · alerts
//   🧮 /valuation       valuation-calc · auto-valuation · valuations · valuation-bands
//   🔎 /screeners       stock-screener · pine-screener · screener-screens · screener
//   📒 /journal         decisions · thesis · activity-log
//   📈 /guidance        guidance-upgrades · growth-guidance · earnings-guidance · guidance-extractor
//   🧱 /bottlenecks     bottleneck-intel · bottleneck-workbench · transmission · strategic-visibility
//   🧭 /theme-library   critical-themes · themes
//   🎲 /simulators      smallcap / qqq simulators · historical-returns · portfolio-simulator · monte-carlo · return-simulator · buy-strategy
//   📊 /market-snapshot movers · heatmap · in-play · breadth · rrg            (?tab=)
//   📅 /earnings-hub    earnings (scan) · earnings-analysis · pead-tracker   (?tab=)
//   🎙️ /concall-intel   company-intel                                         (?tab=library)
// ═══════════════════════════════════════════════════════════════════════════

export const PAGE_MERGES: Record<string, string> = {
  '/price-alerts': '/alerts-center?view=price',
  '/news-alerts': '/alerts-center?view=news',
  '/eo-alerts': '/alerts-center?view=earnings',
  '/alerts': '/alerts-center?view=rules',
  '/valuation-calc': '/valuation?view=calc',
  '/auto-valuation': '/valuation?view=auto',
  '/valuations': '/valuation?view=table',
  '/valuation-bands': '/valuation?view=bands',
  '/stock-screener': '/screeners?view=fundamentals',
  '/pine-screener': '/screeners?view=patterns',
  '/screener-screens': '/screeners?view=screenerin',
  '/screener': '/screeners?view=results',
  '/decisions': '/journal?view=decisions',
  '/thesis': '/journal?view=thesis',
  '/activity-log': '/journal?view=timeline',
  '/guidance-upgrades': '/guidance?view=upgrades',
  '/growth-guidance': '/guidance?view=growth',
  '/earnings-guidance': '/guidance?view=signals',
  '/guidance-extractor': '/guidance?view=extract',
  '/bottleneck-intel': '/bottlenecks?view=intel',
  '/bottleneck-workbench': '/bottlenecks?view=deepdive',
  '/transmission': '/bottlenecks?view=costs',
  '/strategic-visibility': '/bottlenecks?view=contracts',
  '/critical-themes': '/theme-library?view=structural',
  '/themes': '/theme-library?view=baskets',
  '/smallcap-simulator': '/simulators?view=smallcap',
  '/qqq-simulator': '/simulators?view=nasdaq',
  '/historical-returns': '/simulators?view=history',
  '/portfolio-simulator': '/simulators?view=portfolio',
  '/monte-carlo': '/simulators?view=journey',
  '/return-simulator': '/simulators?view=returns',
  '/buy-strategy': '/simulators?view=buy',
  '/movers': '/market-snapshot?tab=movers',
  '/heatmap': '/market-snapshot?tab=heatmap',
  '/in-play': '/market-snapshot?tab=inplay',
  '/breadth': '/market-snapshot?tab=breadth',
  '/rrg': '/market-snapshot?tab=rrg',
  '/earnings': '/earnings-hub?tab=scan',
  '/earnings-analysis': '/earnings-hub?tab=concall',
  '/pead-tracker': '/earnings-hub?tab=pead',
  '/company-intel': '/concall-intel?tab=library',
};

/** Where an old address goes now (its own address values kept; the target's tab wins), or null. */
export function mergedTarget(path: string, search = ''): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const to = PAGE_MERGES[p];
  if (!to) return null;
  const [tp, tq = ''] = to.split('?');
  const q = new URLSearchParams(tq);
  const keep = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  // an old ?tab= of the member page itself (e.g. /valuation-calc?tab=learn) stays its own value; the workspace's own
  // key is set by the target and never overwritten
  for (const [k, v] of keep) if (!q.has(k)) q.append(k, v);
  const s = q.toString();
  return s ? `${tp}?${s}` : tp;
}

/** The address a page is shown at now (old address → workspace tab); unchanged when not merged. */
export function currentAddress(href: string): string {
  if (/^https?:/.test(href)) return href;
  const [pq, hash] = href.split('#');
  const [p, q = ''] = pq.split('?');
  const t = mergedTarget(p, q);
  return t ? `${t}${hash ? `#${hash}` : ''}` : href;
}
