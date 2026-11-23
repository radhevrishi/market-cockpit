'use client';
// zzz1296 — 📒 Journal workspace: decisions, thesis, activity-log as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../decisions/page'), { ssr: false, loading: () => <TabLoading label="Decisions" /> });
const T1 = dynamic(() => import('../thesis/page'), { ssr: false, loading: () => <TabLoading label="Thesis & sell triggers" /> });
const T2 = dynamic(() => import('../activity-log/page'), { ssr: false, loading: () => <TabLoading label="Timeline" /> });

const TABS: WorkspaceTab[] = [
  { id: 'decisions', label: 'Decisions', hint: 'BUY / WATCH / NEUTRAL / REJECTED with reasons, score then vs now, news since the decision.', C: T0, keep: true },
  { id: 'thesis', label: 'Thesis & sell triggers', hint: 'Why you own each holding and the triggers that would end the thesis — flagged when breached.', C: T1, keep: true },
  { id: 'timeline', label: 'Timeline', hint: 'Every decision, valuation, alert, note and upload in one dated list.', C: T2, keep: true },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'📒 Journal'} blurb={'Your record: what you decided and why, what would make you sell, and everything you did, by date.'} tabs={TABS} />
    </Suspense>
  );
}
