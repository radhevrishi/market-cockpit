'use client';

// ════════════════════════════════════════════════════════════════════════════
// SignalScoreboard — Home-page card answering the only question that matters:
// does the portal make money? Reads the signal log's per-surface hit rates
// (1w / 1m), after opportunistically scoring pending signals against live
// quotes. Recent signals are collapsed by default; tickers open the Passport.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { openPassport } from '@/lib/engines';
import { getScoreboard, getRecentSignals, scoreSignals } from '@/lib/signal-log';
import type { SurfaceStats, SignalRecord } from '@/lib/signal-log';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

const SURFACE_LABELS: Record<string, string> = {
  'cockpit': '🛩️ Cockpit',
  'pullback': '💎 Quality Pullback',
  'cheat-entry': '🥷 Cheat Entry',
  'conviction': '🏆 Conviction',
  'bounce': '🌊 Bounce Desk',
  'actions': '🎯 Next Best Actions',
};

function surfaceLabel(id: string): string {
  return SURFACE_LABELS[id] || id;
}

async function fetchQuotes(market: 'india' | 'us'): Promise<Array<{ ticker: string; price: number }>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`/api/market/quotes?market=${market}&fields=ticker,price,changePercent`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j?.stocks) ? j.stocks : [];
  } catch {
    return []; // silent — quotes are best-effort; scoreboard renders regardless
  } finally {
    clearTimeout(timer);
  }
}

function WindowCell({ scored, hit, avg }: { scored: number; hit: number; avg: number | null }) {
  if (!scored || avg == null) {
    return (
      <span style={{ color: 'var(--mc-text-4)' }}>
        — <span style={{ fontSize: 9, fontWeight: 700 }}>maturing</span>
      </span>
    );
  }
  const color = avg > 0 ? 'var(--mc-bullish)' : avg < 0 ? 'var(--mc-bearish)' : 'var(--mc-text-3)';
  return (
    <span style={{ color, fontWeight: 800 }}>
      {hit.toFixed(0)}% hit · avg {avg >= 0 ? '+' : ''}{avg.toFixed(1)}%
    </span>
  );
}

export default function SignalScoreboard() {
  const [stats, setStats] = useState<SurfaceStats[]>([]);
  const [recent, setRecent] = useState<SignalRecord[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ind, usa] = await Promise.all([fetchQuotes('india'), fetchQuotes('us')]);
        const live = new Map<string, number>();
        for (const s of [...ind, ...usa]) {
          const t = String(s?.ticker || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
          const p = typeof s?.price === 'number' ? s.price : parseFloat(String(s?.price));
          if (t && Number.isFinite(p) && p > 0) live.set(t, p);
        }
        if (live.size) scoreSignals(live);
      } catch { /* silent */ }
      if (!alive) return;
      setStats(getScoreboard());
      setRecent(getRecentSignals(12));
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
        📊 SIGNAL SCOREBOARD — does the portal make money?
      </div>

      {stats.length === 0 ? (
        <div style={{ fontSize: 10.5, color: 'var(--mc-text-3)', lineHeight: 1.5 }}>
          No signals logged yet — the engines start logging automatically as you use the portal.
          Hit rates appear after signals mature (1 week+).
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.4fr) 44px 1fr 1fr', gap: 8, fontSize: 9, fontWeight: 700, color: 'var(--mc-text-4)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 0' }}>
            <span>Surface</span><span style={{ textAlign: 'right' }}>Sig</span><span>1 week</span><span>1 month</span>
          </div>
          {stats.map((s) => (
            <div
              key={s.surface}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.4fr) 44px 1fr 1fr', gap: 8, fontSize: 10.5, alignItems: 'baseline', padding: '3px 0', borderTop: '1px solid var(--mc-border-1)' }}
            >
              <span style={{ color: 'var(--mc-text-2)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{surfaceLabel(s.surface)}</span>
              <span style={{ color: 'var(--mc-text-3)', textAlign: 'right' }}>{s.total}</span>
              <WindowCell scored={s.scored1w} hit={s.hit1w} avg={s.avg1w} />
              <WindowCell scored={s.scored1m} hit={s.hit1m} avg={s.avg1m} />
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowRecent((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: MONO, fontSize: 9.5, fontWeight: 800, color: 'var(--mc-cyan)' }}
          >
            {showRecent ? '▾' : '▸'} recent signals ({recent.length})
          </button>
          {showRecent && (
            <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {recent.map((r) => (
                <div key={r.id} style={{ fontSize: 9.5, color: 'var(--mc-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span
                    onClick={() => openPassport(r.ticker)}
                    style={{ color: 'var(--mc-cyan)', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--mc-border-2)', textUnderlineOffset: 2 }}
                  >
                    {r.ticker}
                  </span>
                  {' · '}{surfaceLabel(r.surface)}{' · '}{r.note}{' · '}
                  {r.r1w != null ? (
                    <span style={{ color: r.r1w >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>
                      {(r.r1w >= 0 ? '+' : '') + r.r1w.toFixed(1)}% 1w
                    </span>
                  ) : (
                    <span style={{ color: 'var(--mc-text-4)' }}>pending</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
