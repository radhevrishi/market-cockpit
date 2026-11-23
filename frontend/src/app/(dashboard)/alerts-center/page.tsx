'use client';
// zzz1296 — 🔔 Alerts workspace: price-alerts, news-alerts, eo-alerts, alerts as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../price-alerts/page'), { ssr: false, loading: () => <TabLoading label="Price alerts" /> });
const T1 = dynamic(() => import('../news-alerts/page'), { ssr: false, loading: () => <TabLoading label="News alerts" /> });
const T2 = dynamic(() => import('../eo-alerts/page'), { ssr: false, loading: () => <TabLoading label="Earnings push" /> });
const T3 = dynamic(() => import('../alerts/page'), { ssr: false, loading: () => <TabLoading label="Move & news rules" /> });

const TABS: WorkspaceTab[] = [
  { id: 'price', label: 'Price alerts', hint: 'Price levels for India and USA, sent to your phone, e-mail or Telegram, with a delivery log.', C: T0 },
  { id: 'news', label: 'News alerts', hint: 'Keyword and importance rules on the live news stream; test a rule on the last 100 articles.', C: T1 },
  { id: 'earnings', label: 'Earnings push', hint: 'A browser push when a new BLOCKBUSTER or STRONG result lands.', C: T2 },
  { id: 'rules', label: 'Move & news rules', hint: 'The older server rules (% moves, high-importance news) and their trigger history.', C: T3 },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'🔔 Alerts'} blurb={'Every way to get told when something happens — price levels, news, earnings — in one place.'} tabs={TABS} />
    </Suspense>
  );
}
