'use client';

// ════════════════════════════════════════════════════════════════════════════
// DecayWatch.tsx — Conviction Beats "decay watch" panel
// ────────────────────────────────────────────────────────────────────────────
// Reads the Conviction bench, runs assessDecay() on every name, and surfaces
// the ones whose quality is rolling over — sorted most-severe first — plus a
// separate "stale" list of aging names that never converted to a buy.
//
// SSR-safe: bench is read inside an effect; subscribes to the bench's own
// 'conviction-beats:updated' event and cross-tab 'storage' so the panel
// refreshes whenever the underlying list changes.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getConvictionList } from '@/lib/conviction-beats';
import type { ConvictionEntry } from '@/lib/conviction-beats';
import { assessDecay, isStale, benchAge } from '@/lib/cb-decay';
import { openPassport } from '@/lib/engines'; // zzz524 — ticker click → Stock Passport
import type { DecayAssessment, DecaySeverity } from '@/lib/cb-decay';

const C = {
  bg: 'var(--mc-bg-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  border: 'var(--mc-border-1)',
  border2: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)',
  text2: 'var(--mc-text-2)',
  muted: 'var(--mc-text-3)',
  dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)',
  red: 'var(--mc-bearish)',
  amber: 'var(--mc-warn)',
  cyan: 'var(--mc-cyan)',
  accent: 'var(--mc-accent)',
  persistent: 'var(--mc-state-persistent)',
};

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

const SEV_RANK: Record<DecaySeverity, number> = { high: 0, med: 1, low: 2 };
const SEV_COLOR: Record<DecaySeverity, string> = {
  high: C.red,
  med: C.amber,
  low: C.muted,
};

interface DecayRow extends DecayAssessment {
  tier: ConvictionEntry['tier'];
  age: number;
}

interface StaleRow {
  ticker: string;
  company: string;
  tier: ConvictionEntry['tier'];
  age: number;
}

function compute(): { decaying: DecayRow[]; stale: StaleRow[] } {
  const list = getConvictionList();
  const decaying: DecayRow[] = [];
  const stale: StaleRow[] = [];
  for (const e of list) {
    const a = assessDecay(e);
    if (a) decaying.push({ ...a, tier: e.tier, age: benchAge(e) });
    if (isStale(e)) stale.push({ ticker: e.ticker, company: e.company, tier: e.tier, age: benchAge(e) });
  }
  decaying.sort((x, y) => {
    const r = SEV_RANK[x.severity] - SEV_RANK[y.severity];
    if (r !== 0) return r;
    return y.score - x.score;
  });
  stale.sort((x, y) => y.age - x.age);
  return { decaying, stale };
}

export function DecayWatch() {
  const [state, setState] = useState<{ decaying: DecayRow[]; stale: StaleRow[] } | null>(null);

  useEffect(() => {
    const refresh = () => setState(compute());
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener('conviction-beats:updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('conviction-beats:updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const card: React.CSSProperties = {
    background: C.bg,
    border: '1px solid ' + C.border,
    borderRadius: 8,
    padding: '10px 12px',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
  };

  if (!state) {
    return (
      <div style={card}>
        <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>Loading decay watch…</div>
      </div>
    );
  }

  const { decaying, stale } = state;

  return (
    <div style={card}>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.3, color: decaying.length ? C.amber : C.cyan, textTransform: 'uppercase' }}>
          {decaying.length ? `⚠ Decay watch · ${decaying.length} name${decaying.length === 1 ? '' : 's'} weakening` : '⚠ Decay watch'}
        </div>
        <div style={{ fontSize: 9, color: C.dim }}>quality rolling over</div>
      </div>

      {/* ── decaying rows / empty state ────────────────────────────────────── */}
      {decaying.length === 0 ? (
        <div style={{ fontSize: 11, color: C.green, fontStyle: 'italic', padding: '4px 0' }}>
          ✓ Bench is healthy — nothing decaying
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {decaying.map((r) => {
            const sev = SEV_COLOR[r.severity];
            return (
              <div
                key={r.ticker + r.company}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  paddingBottom: 6,
                  borderBottom: '1px dashed ' + C.border,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sev, flex: '0 0 auto', alignSelf: 'center' }} />
                  <span style={{ color: C.text, fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.company}
                  </span>
                  <span onClick={() => openPassport(r.ticker)} title="Open Stock Passport" style={{ color: C.muted, fontSize: 10, cursor: 'pointer' }}>{r.ticker}</span>
                  <span style={{ flex: 1 }} />
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 800,
                      letterSpacing: 0.4,
                      color: r.tier === 'BLOCKBUSTER' ? C.accent : C.text2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {r.tier}
                  </span>
                  <span style={{ fontSize: 9, color: C.dim }}>{r.age}d</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 12 }}>
                  {r.reasons.map((reason, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: sev,
                        background: C.bg2,
                        border: '1px solid ' + C.border2,
                        borderRadius: 4,
                        padding: '1px 5px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── stale list ─────────────────────────────────────────────────────── */}
      {stale.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid ' + C.border }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, color: C.persistent, textTransform: 'uppercase', marginBottom: 5 }}>
            🕰 Stale — {stale.length} name{stale.length === 1 ? '' : 's'} on the bench &gt;120d, never bought
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {stale.map((s) => (
              <span
                key={s.ticker + s.company}
                title={`${s.company} · ${s.tier} · ${s.age}d on bench`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 4,
                  fontSize: 10,
                  color: C.text2,
                  background: C.bg3,
                  border: '1px solid ' + C.border,
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              >
                <span style={{ fontWeight: 700, color: C.text }}>{s.ticker}</span>
                <span style={{ fontSize: 9, color: C.dim }}>{s.age}d</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default DecayWatch;
