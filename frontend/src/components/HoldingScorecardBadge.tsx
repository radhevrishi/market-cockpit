'use client';

// ════════════════════════════════════════════════════════════════════════════
// HoldingScorecardBadge.tsx
// Compact inline badge for a single ticker. Surfaces two discipline signals:
//   1. Thesis presence — from the thesis-store (`mc:thesis:v1`).
//   2. Latest earnings conviction tier/grade — from conviction-beats bench.
//
// Renders tiny chips e.g. "📓 thesis" / "no thesis" (muted) and
// "🟢 BLOCKBUSTER 84". If neither signal resolves it renders nothing extra
// (a bare, empty inline span). SSR-safe: everything resolves in an effect.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getThesisList } from '@/lib/thesis-store';
import { getConvictionList } from '@/lib/conviction-beats';

const C = {
  text3: 'var(--mc-text-3)',
  text4: 'var(--mc-text-4)',
  border1: 'var(--mc-border-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  green: 'var(--mc-bullish)',
  cyan: 'var(--mc-cyan)',
  amber: 'var(--mc-warn)',
};

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';

interface Resolved {
  hasThesis: boolean;
  thesisResolved: boolean; // false until the effect has run at least once
  tier: 'BLOCKBUSTER' | 'STRONG' | null;
  score: number | null;
}

function norm(s: string): string {
  return (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
}

export function HoldingScorecardBadge({ symbol }: { symbol: string }) {
  const [state, setState] = useState<Resolved>({
    hasThesis: false,
    thesisResolved: false,
    tier: null,
    score: null,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = norm(symbol);

    function resolve() {
      let hasThesis = false;
      let tier: 'BLOCKBUSTER' | 'STRONG' | null = null;
      let score: number | null = null;

      try {
        const theses = getThesisList();
        hasThesis = theses.some((t) => norm(t.ticker) === key);
      } catch {
        /* ignore */
      }

      try {
        // getConvictionList is sorted newest-first; first match is the latest grade.
        const bench = getConvictionList();
        const hit = bench.find((c) => norm(c.ticker) === key);
        if (hit) {
          tier = hit.tier;
          score = Number.isFinite(hit.composite_score) ? hit.composite_score : null;
        }
      } catch {
        /* ignore */
      }

      setState({ hasThesis, thesisResolved: true, tier, score });
    }

    resolve();

    // Live re-resolve when either store updates.
    const onThesis = () => resolve();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.includes('thesis') || e.key.includes('conviction')) resolve();
    };
    window.addEventListener('thesis:updated', onThesis as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('thesis:updated', onThesis as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [symbol]);

  // Nothing resolved yet, or neither signal present → render nothing extra.
  if (!state.thesisResolved) return <span aria-hidden style={{ display: 'none' }} />;
  if (!state.hasThesis && !state.tier) return <span aria-hidden style={{ display: 'none' }} />;

  const chip: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 9.5,
    fontWeight: 700,
    lineHeight: 1,
    padding: '2px 5px',
    borderRadius: 4,
    border: '1px solid ' + C.border1,
    whiteSpace: 'nowrap',
  };

  const tierColor = state.tier === 'BLOCKBUSTER' ? C.green : C.cyan;
  const tierGlyph = state.tier === 'BLOCKBUSTER' ? '🟢' : '🔵';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
      {state.hasThesis ? (
        <span style={{ ...chip, color: C.cyan, background: C.bg2 }} title="Investment thesis on file">
          📓 thesis
        </span>
      ) : (
        <span style={{ ...chip, color: C.text4, background: 'transparent' }} title="No thesis recorded">
          no thesis
        </span>
      )}

      {state.tier && (
        <span
          style={{ ...chip, color: tierColor, background: C.bg3 }}
          title={`Conviction bench: ${state.tier}${state.score !== null ? ' · composite ' + state.score : ''}`}
        >
          {tierGlyph} {state.tier}
          {state.score !== null && (
            <span style={{ color: C.text3, fontWeight: 800 }}> {Math.round(state.score)}</span>
          )}
        </span>
      )}
    </span>
  );
}

export default HoldingScorecardBadge;
