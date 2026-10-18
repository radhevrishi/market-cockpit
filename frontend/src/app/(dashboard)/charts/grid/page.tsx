'use client';
// zzz1088 — /charts/grid: 1, 2 or 4 charts side by side, with intraday timeframes and session VWAP. Browser only (chart engine).
import dynamic from 'next/dynamic';

const MultiChart = dynamic(() => import('@/components/charts/MultiChart'), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: 'var(--mc-text-3)' }}>Loading charts…</div>,
});

export default function MultiChartPage() {
  return <MultiChart />;
}
