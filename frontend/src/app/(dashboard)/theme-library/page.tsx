'use client';
// zzz1296 — 🧭 Themes workspace: critical-themes, themes as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../critical-themes/page'), { ssr: false, loading: () => <TabLoading label="Structural themes" /> });
const T1 = dynamic(() => import('../themes/page'), { ssr: false, loading: () => <TabLoading label="Live baskets" /> });

const TABS: WorkspaceTab[] = [
  { id: 'structural', label: 'Structural themes', hint: '10-year themes for India and USA, re-ranked by news heat, leader momentum and bottlenecks; add your own.', C: T0 },
  { id: 'baskets', label: 'Live baskets', hint: 'Price view of the main theme baskets (AI infra, semis, defence, nuclear, space, grid).', C: T1 },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'🧭 Themes'} blurb={'Long-term structural themes, ranked live, and quick live baskets of their leaders.'} tabs={TABS} />
    </Suspense>
  );
}
