'use client';
// zzz1296 — 🧮 Valuation workspace: valuation-calc, auto-valuation, valuations, valuation-bands as tabs of one page (components/Workspace).
// The old addresses forward here (lib/page-merges). Each tab is the unchanged page module.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Workspace, { TabLoading, type WorkspaceTab } from '@/components/Workspace';

const T0 = dynamic(() => import('../valuation-calc/page'), { ssr: false, loading: () => <TabLoading label="Calculators" /> });
const T1 = dynamic(() => import('../auto-valuation/page'), { ssr: false, loading: () => <TabLoading label="From documents" /> });
const T2 = dynamic(() => import('../valuations/page'), { ssr: false, loading: () => <TabLoading label="All my stocks" /> });
const T3 = dynamic(() => import('../valuation-bands/page'), { ssr: false, loading: () => <TabLoading label="Price bands" /> });

const TABS: WorkspaceTab[] = [
  { id: 'calc', label: 'Calculators', hint: 'P/E, P/S, EV/EBITDA, reverse DCF and more by hand; saved valuations and the Learn tab.', C: T0, keep: true },
  { id: 'auto', label: 'From documents', hint: 'Upload the Excel and concall / deck PDFs — guidance is read and every method runs on its own.', C: T1, keep: true },
  { id: 'table', label: 'All my stocks', hint: 'Fair value, margin of safety and the 10-model bull / base / bear matrix for every uploaded stock.', C: T2, keep: true },
  { id: 'bands', label: 'Price bands', hint: "Bull / base / bear price bands from the historical multiple band, against today's price.", C: T3, keep: true },
];

export default function Page() {
  return (
    <Suspense fallback={<TabLoading label="page" />}>
      <Workspace title={'🧮 Valuation'} blurb={'Work out what a company is worth — by hand, from its documents, across all your stocks, or as price bands.'} tabs={TABS} />
    </Suspense>
  );
}
