'use client';

// ════════════════════════════════════════════════════════════════════════════
// NextBestActions — Home-page card ranking the top 3 things to do right now,
// synthesized across every engine: decaying holdings in the book, names
// sitting at MA support, cross-engine conflicts, and regime-level directives
// (BEAR closes the bounce lane; RECOVERY opens the aggressive window).
// Logs its own picks to the signal log so the scoreboard can grade it.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getEngineViews, openPassport } from '@/lib/engines';
import { computeVerdict } from '@/lib/verdict';
import { logSignals } from '@/lib/signal-log';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

interface Action {
  pri: number;
  icon: string;
  text: string;
  href: string;
  ticker?: string;
}

async function fetchRegime(): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch('/api/market/regime', { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildActions(regime: any | null): Action[] {
  const actions: Action[] = [];
  const views = getEngineViews();

  for (const v of views.values()) {
    // 1 · Decaying names in the book — highest urgency
    if (v.decay && v.holding) {
      const sev = v.decay.severity;
      actions.push({
        pri: 90 + (sev === 'high' ? 8 : sev === 'med' ? 4 : 0),
        icon: '⚠️',
        text: `${v.symbol} in your book is decaying — ${v.decay.reasons[0] || 'quality rolling over'}`,
        href: '/watchlists?tab=conviction',
        ticker: v.symbol,
      });
    }

    // 2 · At-support setups (near 50DMA / 200DMA, above the 200)
    const t = v.tech;
    if (t && t.price != null && t.price > 0 && t.sma50 != null && t.sma50 > 0 && t.sma200 != null && t.sma200 > 0) {
      const d50 = (t.price / t.sma50 - 1) * 100;
      const d200 = (t.price / t.sma200 - 1) * 100;
      if (t.price > t.sma200 && (Math.abs(d50) <= 2 || Math.abs(d200) <= 2.5)) {
        const fs = v.fundo?.score ?? null;
        const at200 = Math.abs(d200) <= 2.5;
        actions.push({
          pri: 80 + (fs != null && fs >= 70 ? 8 : 0) + (v.bench ? 6 : 0) - Math.min(6, Math.abs(d50)),
          icon: '🎯',
          text: `${v.symbol} at ${at200 ? '200DMA' : '50DMA'} support (${d50.toFixed(1)}%)` + (fs ? ` · Fundo ${Math.round(fs)}` : ''),
          href: '/cheat-entry',
          ticker: v.symbol,
        });
      }
    }

    // 3 · Cross-engine conflicts on names that matter (owned or benched)
    if (v.holding || v.bench) {
      const verdict = computeVerdict(v);
      if (verdict.conflicts.length > 0) {
        actions.push({
          pri: 75,
          icon: '⚔️',
          text: `${v.symbol}: ${verdict.conflicts[0]}`,
          href: '/cockpit',
          ticker: v.symbol,
        });
      }
    }
  }

  // 4/5 · Regime-level directives
  for (const [key, label] of [['india', 'India'], ['usa', 'USA']] as const) {
    const kind = regime?.[key]?.kind;
    if (kind === 'BEAR') {
      actions.push({
        pri: 95,
        icon: '🛑',
        text: `${label} regime is BEAR — single-name bounce lane closed; review open risk`,
        href: '/risk',
      });
    } else if (kind === 'RECOVERY') {
      actions.push({
        pri: 92,
        icon: '🌊',
        text: `${label} in post-capitulation RECOVERY window — the aggressive regime; see Bounce Desk`,
        href: '/bounce-desk',
      });
    }
  }

  // Sort by priority, dedupe per ticker keeping the highest-priority action
  actions.sort((a, b) => b.pri - a.pri);
  const seen = new Set<string>();
  const deduped: Action[] = [];
  for (const a of actions) {
    if (a.ticker) {
      if (seen.has(a.ticker)) continue;
      seen.add(a.ticker);
    }
    deduped.push(a);
  }
  return deduped.slice(0, 3);
}

export default function NextBestActions() {
  const [top, setTop] = useState<Action[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const regime = await fetchRegime();
      const top3 = buildActions(regime);
      // Let the scoreboard learn whether the action list itself is any good.
      try {
        logSignals('actions', top3.filter((a) => a.ticker).map((a) => ({ ticker: a.ticker!, note: a.text.slice(0, 60) })));
      } catch { /* silent */ }
      if (alive) setTop(top3);
    })();
    return () => { alive = false; };
  }, []);

  const card: React.CSSProperties = {
    background: 'var(--mc-bg-1)',
    border: '1px solid var(--mc-border-1)',
    borderRadius: 8,
    padding: '10px 12px',
    fontFamily: MONO,
  };

  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--mc-text-1)', letterSpacing: 0.4, marginBottom: 8 }}>
        🎯 NEXT BEST ACTIONS
      </div>

      {top === null ? (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>Reading the engines…</div>
      ) : top.length === 0 ? (
        <div style={{ fontSize: 10.5, color: 'var(--mc-text-3)', lineHeight: 1.5 }}>
          Nothing urgent — engines see no decaying holdings, no at-support setups, no conflicts. Enjoy the calm.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {top.map((a, i) => {
            const t = a.ticker;
            const startsWithTicker = t && a.text.startsWith(t);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 10.5, color: 'var(--mc-text-2)', borderTop: i > 0 ? '1px solid var(--mc-border-1)' : undefined, paddingTop: i > 0 ? 6 : 0 }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--mc-text-4)', minWidth: 12 }}>{i + 1}</span>
                <span style={{ fontSize: 12 }}>{a.icon}</span>
                <span style={{ flex: 1, lineHeight: 1.45 }}>
                  {startsWithTicker ? (
                    <>
                      <span
                        onClick={() => openPassport(t!)}
                        style={{ color: 'var(--mc-cyan)', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--mc-border-2)', textUnderlineOffset: 2 }}
                      >
                        {t}
                      </span>
                      {a.text.slice(t!.length)}
                    </>
                  ) : t ? (
                    <span onClick={() => openPassport(t)} style={{ cursor: 'pointer' }}>{a.text}</span>
                  ) : (
                    a.text
                  )}
                </span>
                <a
                  href={a.href}
                  style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: 'var(--mc-accent)', textDecoration: 'none', border: '1px solid var(--mc-border-2)', borderRadius: 6, padding: '2px 7px', background: 'var(--mc-bg-2)' }}
                >
                  →
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
