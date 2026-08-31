'use client';

// ─────────────────────────────────────────────────────────────────────────────
// OwnBadge — a shared "you own this / it's on your bench" chip.
// Injected into any list (Earnings Ops, Cockpit, Movers…) so relevance to the
// user's own book surfaces without hunting. Reads the two existing stores:
//   • holdings  → localStorage 'mc_portfolio_holdings'  (via isInPortfolio)
//   • bench     → localStorage 'mc:conviction-beats:v1'  (via isConviction)
// SSR-safe: resolves membership inside an effect, renders nothing until mounted
// so it never causes a hydration mismatch.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { isInPortfolio } from '@/lib/portfolio-overlay';
import { isConviction } from '@/lib/conviction-beats';

type Kind = 'held' | 'bench' | null;

function resolve(symbol: string): Kind {
  if (typeof window === 'undefined' || !symbol) return null;
  const s = symbol.toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
  try {
    if (isInPortfolio(s)) return 'held';
  } catch { /* store unavailable */ }
  try {
    if (isConviction(s)) return 'bench';
  } catch { /* store unavailable */ }
  return null;
}

export default function OwnBadge({ symbol, style }: { symbol: string; style?: React.CSSProperties }) {
  const [kind, setKind] = useState<Kind>(null);

  useEffect(() => {
    setKind(resolve(symbol));
    const onChange = () => setKind(resolve(symbol));
    window.addEventListener('storage', onChange);
    window.addEventListener('conviction-beats:updated', onChange);
    window.addEventListener('mc:portfolio:updated', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('conviction-beats:updated', onChange);
      window.removeEventListener('mc:portfolio:updated', onChange);
    };
  }, [symbol]);

  if (!kind) return null;

  const held = kind === 'held';
  const color = held ? 'var(--mc-bullish)' : 'var(--mc-cyan)';
  const label = held ? 'HELD' : 'BENCH';
  const title = held ? 'In your portfolio (My Book)' : 'On your Conviction Beats bench';

  return (
    <span
      title={title}
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '0.06em',
        padding: '1px 6px',
        borderRadius: 4,
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {held ? '◆ ' : '○ '}{label}
    </span>
  );
}
