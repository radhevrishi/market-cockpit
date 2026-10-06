'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import type { FeedStatusLite } from './types';

export function FeedStatusNote({ status, compact = false }: { status: FeedStatusLite | null | undefined; compact?: boolean }) {
  if (!status) return null;
  const color = status.state === 'FAILED' ? 'var(--mc-bearish)' : status.state === 'PARTIAL' ? 'var(--mc-warn)' : 'var(--mc-text-3)';
  const icon = status.state === 'FAILED' ? '⚠' : status.state === 'PARTIAL' ? '◐' : status.state === 'EMPTY' ? '○' : '●';
  return (
    <div style={{
      fontSize: compact ? 10.5 : 11.5, color, lineHeight: 1.5,
      ...(compact ? {} : { padding: '8px 12px', borderRadius: 8, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 7%, transparent)` }),
    }}>
      {icon} {status.message}
    </div>
  );
}
