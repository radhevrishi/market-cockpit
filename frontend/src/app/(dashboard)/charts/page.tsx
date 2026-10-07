'use client';
// zzz937 — /charts?t=QQQ&m=US&tf=W : candle charts with moving averages, volume, saved drawings and a measure tool.
// The chart engine touches `window`, so the workspace is loaded in the browser only.
import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const ChartWorkspace = dynamic(() => import('@/components/charts/ChartWorkspace'), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: 'var(--mc-text-3)' }}>Loading chart…</div>,
});

export default function ChartsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--mc-text-3)' }}>Loading chart…</div>}>
      <ChartWorkspace />
    </Suspense>
  );
}
