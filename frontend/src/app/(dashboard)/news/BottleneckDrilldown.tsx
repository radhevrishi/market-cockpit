'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useMemo } from 'react';
import { X } from 'lucide-react';
import { BOTTLENECK_DRILLDOWN } from './constants';
import { getTitle, getSource, timeAgo } from './helpers';
import { type NewsArticle } from './types';

// ── Drilldown Panel ──────────────────────────────────────────────────────────

export function BottleneckDrilldown({
  subTag,
  articles,
  onClose,
  onSelectArticle,
}: {
  subTag: string;
  articles: NewsArticle[];
  onClose: () => void;
  onSelectArticle: (a: NewsArticle) => void;
}) {
  const entry = BOTTLENECK_DRILLDOWN[subTag];
  const relatedArticles = useMemo(
    () => articles.filter(a => a.bottleneck_sub_tag === subTag).slice(0, 15),
    [articles, subTag],
  );

  if (!entry) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.65)' }}
        onClick={onClose}
      >
        <div
          style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', width: '100%', maxWidth: '700px', height: '100vh', overflowY: 'auto', padding: '20px 16px' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', color: 'var(--mc-text-0)', margin: 0 }}>{subTag.replace(/_/g, ' ')}</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer' }}>
              <X style={{ width: '18px', height: '18px' }} />
            </button>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--mc-text-3)' }}>No drilldown available for this category yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', width: '100%', maxWidth: '720px', height: '100vh', overflowY: 'auto', padding: '20px 16px' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer' }}>
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '32px' }}>{entry.icon}</div>
          <div>
            <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bearish)', letterSpacing: '0.8px', marginBottom: '2px' }}>STRUCTURAL BOTTLENECK</div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--mc-text-0)', margin: 0 }}>{entry.label}</h2>
          </div>
        </div>

        {/* Why it's a bottleneck */}
        <section style={{ marginBottom: '18px' }}>
          <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bearish)', margin: '0 0 8px', letterSpacing: '0.5px' }}>WHY IT'S A BOTTLENECK</p>
          <p style={{ fontSize: '13px', color: 'var(--mc-text-2)', lineHeight: '1.6', margin: 0 }}>{entry.why}</p>
        </section>

        {/* Supply vs Demand */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
          <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-warn)', margin: '0 0 6px', letterSpacing: '0.5px' }}>SUPPLY</p>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.55', margin: 0 }}>{entry.supply}</p>
          </div>
          <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bullish)', margin: '0 0 6px', letterSpacing: '0.5px' }}>DEMAND</p>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.55', margin: 0 }}>{entry.demand}</p>
          </div>
        </div>

        {/* Winners */}
        {entry.winners.length > 0 && (
          <section style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bullish)', margin: '0 0 8px', letterSpacing: '0.5px' }}>▲ LISTED COMPANIES — WINNERS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entry.winners.map(w => (
                <div key={w.ticker} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)', borderRadius: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--mc-bullish)', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)', padding: '2px 7px', borderRadius: '4px', flexShrink: 0, minWidth: '70px', textAlign: 'center' }}>
                    {w.ticker}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.45' }}>{w.thesis}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Losers */}
        {entry.losers.length > 0 && (
          <section style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bearish)', margin: '0 0 8px', letterSpacing: '0.5px' }}>▼ LISTED COMPANIES — UNDER PRESSURE</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entry.losers.map(l => (
                <div key={l.ticker} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 19%, transparent)', borderRadius: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--mc-bearish)', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', padding: '2px 7px', borderRadius: '4px', flexShrink: 0, minWidth: '70px', textAlign: 'center' }}>
                    {l.ticker}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.45' }}>{l.thesis}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Related articles */}
        {relatedArticles.length > 0 && (
          <section style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-4)', margin: '0 0 10px', letterSpacing: '0.5px' }}>RECENT EVIDENCE ({relatedArticles.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {relatedArticles.map(a => (
                <button
                  key={a.id}
                  onClick={() => onSelectArticle(a)}
                  style={{ textAlign: 'left', background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', color: 'var(--mc-text-2)', fontSize: '12px', lineHeight: '1.45' }}
                >
                  <div style={{ fontWeight: '600', color: '#E8EDF2', marginBottom: '3px' }}>{getTitle(a)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{getSource(a)} · {timeAgo(a.published_at)}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
