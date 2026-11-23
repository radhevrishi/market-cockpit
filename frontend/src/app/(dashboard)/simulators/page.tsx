'use client';
// zzz1296 — 🎲 Simulators workspace: smallcap-simulator, qqq-simulator, historical-returns, portfolio-simulator, monte-carlo, return-simulator, buy-strategy as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../smallcap-simulator/page'), { ssr: false, loading: () => <TabLoading label="India smallcap" /> });
const T1 = dynamic(() => import('../qqq-simulator/page'), { ssr: false, loading: () => <TabLoading label="Nasdaq-100" /> });
const T2 = dynamic(() => import('../historical-returns/page'), { ssr: false, loading: () => <TabLoading label="Year by year" /> });
const T3 = dynamic(() => import('../portfolio-simulator/page'), { ssr: false, loading: () => <TabLoading label="My hit rate" /> });
const T4 = dynamic(() => import('../monte-carlo/page'), { ssr: false, loading: () => <TabLoading label="Wealth path" /> });
const T5 = dynamic(() => import('../return-simulator/page'), { ssr: false, loading: () => <TabLoading label="Return maths" /> });
const T6 = dynamic(() => import('../buy-strategy/page'), { ssr: false, loading: () => <TabLoading label="Buy plan" /> });

const TABS: WorkspaceTab[] = [
  { id: 'smallcap', label: 'India smallcap', hint: 'Nifty Smallcap 100: set the odds of a crash / bad / flat / good / boom year and see the return range.', C: T0, keep: true },
  { id: 'nasdaq', label: 'Nasdaq-100', hint: 'The same simulator for the Nasdaq-100, calibrated on 1986–2025.', C: T1, keep: true },
  { id: 'history', label: 'Year by year', hint: 'The actual yearly returns both simulators are built on.', C: T2, keep: true },
  { id: 'portfolio', label: 'My hit rate', hint: 'Monte Carlo from your win rate, average winner / loser, positions and holding period.', C: T3, keep: true },
  { id: 'journey', label: 'Wealth path', hint: 'Thousands of possible paths of your wealth journey with the P10–P90 range.', C: T4, keep: true },
  { id: 'returns', label: 'Return maths', hint: 'EPS growth × P/E change, growth needed for 5x, fair P/E, dilution.', C: T5, keep: true },
  { id: 'buy', label: 'Buy plan', hint: 'Plan how to stage your buys.', C: T6, keep: true },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'🎲 Simulators'} blurb={'What could returns look like: index scenarios, your own hit rate, your wealth path, and the return maths.'} tabs={TABS} />
    </Suspense>
  );
}
