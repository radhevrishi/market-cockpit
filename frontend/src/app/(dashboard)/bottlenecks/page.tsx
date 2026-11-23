'use client';
// zzz1296 — 🧱 Bottlenecks workspace: bottleneck-intel, bottleneck-workbench, transmission, strategic-visibility as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../bottleneck-intel/page'), { ssr: false, loading: () => <TabLoading label="Bottleneck map" /> });
const T1 = dynamic(() => import('../bottleneck-workbench/page'), { ssr: false, loading: () => <TabLoading label="Theme deep-dive" /> });
const T2 = dynamic(() => import('../transmission/page'), { ssr: false, loading: () => <TabLoading label="Input costs" /> });
const T3 = dynamic(() => import('../strategic-visibility/page'), { ssr: false, loading: () => <TabLoading label="Contract wins" /> });

const TABS: WorkspaceTab[] = [
  { id: 'intel', label: 'Bottleneck map', hint: 'Bottleneck themes by severity: rotation, scanner, knowledge base, geography, calendar, map, checklist.', C: T0 },
  { id: 'deepdive', label: 'Theme deep-dive', hint: 'One bottleneck theme: signals, its articles over time and the companies in it.', C: T1, when: ['theme'] },
  { id: 'costs', label: 'Input costs', hint: 'Commodity and currency moves and which sectors gain or lose margin from them; scenario lab.', C: T2, when: ['cat', 'sens', 'h'] },
  { id: 'contracts', label: 'Contract wins', hint: 'Companies whose revenue base was changed by mega contracts, leases, defence or sovereign programmes.', C: T3 },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'🧱 Bottlenecks'} blurb={"Supply bottlenecks, the input costs behind them, and the contracts that change a company's revenue base."} tabs={TABS} />
    </Suspense>
  );
}
