'use client';
// zzz983 — Pine Screener: every company whose chart shows a chart pattern (bullish / bearish, by sub-pattern, stage and
// likelihood). Loaded in the browser only: saved Pine screens live in browser storage (synced by the vault).
import dynamic from 'next/dynamic';

const PineScreener = dynamic(() => import('@/components/pine-screener/PineScreener'), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: 'var(--mc-text-3)' }}>Loading Pine Screener…</div>,
});

export default function PineScreenerPage() {
  return <PineScreener />;
}
