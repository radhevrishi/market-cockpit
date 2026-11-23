'use client';
// ═══════════════════════════════════════════════════════════════════════════
// MARKET SNAPSHOT — patch 0090, widened in zzz1296
//
// Heatmap + Movers (patch 0090) plus Live In Play, Breadth and RRG: every "how is the market moving today" view in one
// page (components/Workspace). The tab stays in ?tab= (old links /market-snapshot?tab=movers keep working); the old
// addresses /heatmap, /movers, /in-play, /breadth, /rrg forward here (lib/page-merges). Each tab is the unchanged page
// module; only the open tab is mounted, so hidden tabs do not poll.
// ═══════════════════════════════════════════════════════════════════════════
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const HeatmapPage = dynamic(() => import('../heatmap/page'), { ssr: false, loading: () => <TabLoading label="Heatmap" /> });
const MoversPage = dynamic(() => import('../movers/page'), { ssr: false, loading: () => <TabLoading label="Movers" /> });
const InPlayPage = dynamic(() => import('../in-play/page'), { ssr: false, loading: () => <TabLoading label="In Play" /> });
const BreadthPage = dynamic(() => import('../breadth/page'), { ssr: false, loading: () => <TabLoading label="Breadth" /> });
const RrgPage = dynamic(() => import('../rrg/page'), { ssr: false, loading: () => <TabLoading label="RRG" /> });

const TABS: WorkspaceTab[] = [
  { id: 'movers', label: 'Movers', hint: 'Top gainers and losers with the reason for each move, circuit limits and your book marked.', C: MoversPage },
  { id: 'heatmap', label: 'Heatmap', hint: 'Nifty 50 / Midcap 150 / Smallcap 150 as a treemap by % change; post-results colouring.', C: HeatmapPage },
  { id: 'inplay', label: 'In play', hint: 'News, results and price movers together as one live feed — India, USA and global.', C: InPlayPage },
  { id: 'breadth', label: 'Breadth', hint: 'How many stocks are taking part: one market-health score with its parts and history.', C: BreadthPage },
  { id: 'rrg', label: 'Sector rotation (RRG)', hint: 'Which sectors are leading, weakening, lagging or improving against the index.', C: RrgPage },
];

export default function MarketSnapshotPage() {
  return (
    <Suspense fallback={<TabLoading label="Market Snapshot" />}>
      <Workspace title="📊 Market Snapshot" blurb="How the market is moving today — movers, heatmap, live news, breadth and sector rotation." tabs={TABS} param="tab" />
    </Suspense>
  );
}
