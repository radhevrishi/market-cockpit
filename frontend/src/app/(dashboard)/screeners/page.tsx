'use client';
// zzz1296 — 🔎 Screeners workspace: stock-screener, pine-screener, screener-screens, screener as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../stock-screener/page'), { ssr: false, loading: () => <TabLoading label="Fundamentals" /> });
const T1 = dynamic(() => import('../pine-screener/page'), { ssr: false, loading: () => <TabLoading label="Chart patterns" /> });
const T2 = dynamic(() => import('../screener-screens/page'), { ssr: false, loading: () => <TabLoading label="Screener.in screens" /> });
const T3 = dynamic(() => import('../screener/page'), { ssr: false, loading: () => <TabLoading label="Results screener" /> });

const TABS: WorkspaceTab[] = [
  { id: 'fundamentals', label: 'Fundamentals', hint: 'Our own screener (India + USA): your saved screens, filters, compare two screens, shortlists.', C: T0, keep: true },
  { id: 'patterns', label: 'Chart patterns', hint: 'Pine pattern screens — stages, setups, weekly + monthly alignment.', C: T1, keep: true },
  { id: 'screenerin', label: 'Screener.in screens', hint: "Your 31 screener.in screens run on our data, with screener.in's own count beside ours.", C: T2, keep: true },
  { id: 'results', label: 'Results screener', hint: 'Latest results with a verdict per company and the Conviction Beats overlay.', C: T3, keep: true },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'🔎 Screeners'} blurb={'Find companies: by fundamentals, by chart pattern, with your screener.in screens, or by latest results.'} tabs={TABS} />
    </Suspense>
  );
}
