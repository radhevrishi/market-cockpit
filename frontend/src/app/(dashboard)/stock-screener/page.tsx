'use client';
// zzz938 — our own stock screener (replaces the TradingView screener). Loaded in the browser only: the saved screens live in browser
// storage (synced to the owner's database by the vault), so there is nothing to render on the server.
import dynamic from 'next/dynamic';

const StockScreener = dynamic(() => import('@/components/stock-screener/StockScreener'), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: 'var(--mc-text-3)' }}>Loading screener…</div>,
});

export default function StockScreenerPage() {
  return <StockScreener />;
}
