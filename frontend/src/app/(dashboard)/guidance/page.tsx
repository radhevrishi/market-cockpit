'use client';
// zzz1296 — 📈 Guidance workspace: guidance-upgrades, growth-guidance, earnings-guidance, guidance-extractor as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../guidance-upgrades/page'), { ssr: false, loading: () => <TabLoading label="Guidance raises" /> });
const T1 = dynamic(() => import('../growth-guidance/page'), { ssr: false, loading: () => <TabLoading label="High growth guided" /> });
const T2 = dynamic(() => import('../earnings-guidance/page'), { ssr: false, loading: () => <TabLoading label="Result signals" /> });
const T3 = dynamic(() => import('../guidance-extractor/page'), { ssr: false, loading: () => <TabLoading label="Paste & read" /> });

const TABS: WorkspaceTab[] = [
  { id: 'upgrades', label: 'Guidance raises', hint: 'Companies that raised guidance, checked against the filing, with one decision per name.', C: T0, keep: true },
  { id: 'growth', label: 'High growth guided', hint: 'Companies whose management guides unusually high growth, checked against a source.', C: T1, keep: true },
  { id: 'signals', label: 'Result signals', hint: 'Last 45 days of results for your book + watchlist: revenue, margin, capex, operating leverage signals.', C: T2, keep: true },
  { id: 'extract', label: 'Paste & read', hint: 'Paste a concall transcript; the forward guidance is pulled out into a table.', C: T3, keep: true },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'📈 Guidance'} blurb={'What managements say about the future: raises, unusually high growth, result signals, and a paste-in reader.'} tabs={TABS} />
    </Suspense>
  );
}
