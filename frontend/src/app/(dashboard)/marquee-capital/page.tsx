'use client';

// ═══════════════════════════════════════════════════════════════════════════
// MARQUEE CAPITAL ENTRY TRACKER (TheWrap Module 4)
//
// Surfaces SAST / preferential-allotment / open-offer / QIP entries where a
// marquee PE or strategic acquirer (KKR/Blackstone/Carlyle/Tata Capital/
// ChrysCapital/Temasek/GIC/…) is the counterparty. Runs detectMarqueeCapital()
// over the dual-source news + NSE/BSE filings feed (lib/thewrap-feed.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { detectMarqueeCapital } from '@/lib/thewrap-detectors';
import {
  fetchWrapFeed,
  runDetector,
  relativeTime,
  type WrapMatch,
} from '@/lib/thewrap-feed';
import PanelFreshness from '@/components/PanelFreshness';

const PAGE_TITLE = 'Marquee Capital';
const PAGE_EMOJI = '💼';
const PAGE_DESC =
  'SAST / preferential-allotment / open-offer entries where a marquee PE or strategic acquirer (KKR, Blackstone, Tata Capital, ChrysCapital, Temasek…) is the counterparty — a governance + capital-validation signal.';
const FACET_KEY = 'acquirer';
const FACET_LABEL = 'Acquirer';
const EMPTY_THING = 'marquee capital entries';
const ACCENT = '#F59E0B';

export default function MarqueeCapitalPage() {
  const [matches, setMatches] = useState<WrapMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [warming, setWarming] = useState(false);

  const [search, setSearch] = useState('');
  const [facet, setFacet] = useState<string>('ALL');
  const [sortDesc, setSortDesc] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Marquee capital also pulls the special-situations pipeline (SAST /
      // open-offer / acquisition events with acquirer info) so marquee-PE
      // entries surface even when news + filings miss them.
      const res = await fetchWrapFeed({ timeoutMs: 12_000, includeSpecialSit: true });
      const found = runDetector(res.items, detectMarqueeCapital);
      setMatches(found);
      setFetchedAt(res.fetchedAt);
      setWarming(!res.filingsOk && !res.newsOk);
      if (!res.newsOk && !res.filingsOk) {
        setError('Both upstream feeds are unavailable right now.');
      }
    } catch (e: any) {
      setError(e?.name === 'AbortError' ? 'Timed out — the feed is slow. Retry.' : (e?.message || 'Failed to load the feed.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const facetValues = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      const v = m.signal.meta?.[FACET_KEY];
      if (v != null && v !== '') set.add(String(v));
    }
    return Array.from(set).sort();
  }, [matches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = matches.filter((m) => {
      if (facet !== 'ALL') {
        const v = m.signal.meta?.[FACET_KEY];
        if (String(v ?? '') !== facet) return false;
      }
      if (q) {
        const hay = `${m.ticker} ${m.company} ${m.title} ${m.signal.evidence} ${m.signal.label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) =>
      sortDesc ? b.publishedAt - a.publishedAt : a.publishedAt - b.publishedAt,
    );
    return rows;
  }, [matches, search, facet, sortDesc]);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1180, margin: '0 auto', color: '#E2E8F0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 760 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{PAGE_EMOJI}</span> {PAGE_TITLE}
          </h1>
          <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 6, lineHeight: 1.5 }}>{PAGE_DESC}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {fetchedAt > 0 && (
            <PanelFreshness dataUpdatedAt={fetchedAt} isFetching={loading} staleAfterMs={10 * 60_000} />
          )}
          <button onClick={load} disabled={loading} style={btnStyle}>
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker, company, acquirer…"
          style={inputStyle}
        />
        {facetValues.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>{FACET_LABEL}:</span>
            <FacetChip label="All" active={facet === 'ALL'} onClick={() => setFacet('ALL')} />
            {facetValues.map((v) => (
              <FacetChip key={v} label={v} active={facet === v} onClick={() => setFacet(v)} />
            ))}
          </div>
        )}
        <button onClick={() => setSortDesc((s) => !s)} style={{ ...chipBase, marginLeft: 'auto' }}>
          Date {sortDesc ? '↓ newest' : '↑ oldest'}
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <SkeletonList />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            thing={EMPTY_THING}
            warming={warming}
            filtered={matches.length > 0}
            onClear={() => { setSearch(''); setFacet('ALL'); }}
          />
        ) : (
          <MatchTable rows={filtered} facetKey={FACET_KEY} />
        )}
      </div>

      {!loading && !error && matches.length > 0 && (
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 12 }}>
          Showing {filtered.length} of {matches.length} detected · coverage depends on the live news + filings window.
        </div>
      )}
    </div>
  );
}

function MatchTable({ rows, facetKey }: { rows: WrapMatch[]; facetKey: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((m, i) => (
        <div key={`${m.ticker}-${i}`} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: '#F1F5F9', fontVariantNumeric: 'tabular-nums' }}>
              {m.ticker || '—'}
            </span>
            {m.company && <span style={{ fontSize: 12, color: '#94A3B8' }}>{m.company}</span>}
            <span
              style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                color: m.signal.color, border: `1px solid ${m.signal.color}55`,
                backgroundColor: `${m.signal.color}14`,
              }}
            >
              {m.signal.emoji} {m.signal.label}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
              {relativeTime(m.publishedAt)}
            </span>
          </div>

          <div style={{ fontSize: 13, color: '#CBD5E1', marginTop: 6, lineHeight: 1.4 }}>
            {m.url ? (
              <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ color: '#CBD5E1', textDecoration: 'none' }}>
                {m.title} ↗
              </a>
            ) : (
              m.title
            )}
          </div>

          <div style={{ fontSize: 11, color: '#8B9DB0', marginTop: 6 }}>{m.signal.evidence}</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {m.signal.meta &&
              Object.entries(m.signal.meta)
                .filter(([, v]) => v != null && v !== '')
                .map(([k, v]) => (
                  <span
                    key={k}
                    style={{
                      fontSize: 10, color: k === facetKey ? ACCENT : '#94A3B8',
                      backgroundColor: '#0F1A2E', border: '1px solid #1E2D45',
                      padding: '2px 6px', borderRadius: 4, fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {k}: {String(v)}
                  </span>
                ))}
            <span style={{ fontSize: 10, color: '#64748B', marginLeft: 'auto' }}>
              {m.origin === 'filing' ? '◆ ' : '· '}{m.source}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FacetChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...chipBase,
        color: active ? '#0B1120' : '#94A3B8',
        backgroundColor: active ? ACCENT : 'transparent',
        borderColor: active ? ACCENT : '#1E2D45',
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ ...cardStyle, opacity: 0.5 }}>
          <div style={{ height: 12, width: '30%', background: '#1E2D45', borderRadius: 4 }} />
          <div style={{ height: 12, width: '70%', background: '#16233A', borderRadius: 4, marginTop: 10 }} />
          <div style={{ height: 10, width: '45%', background: '#16233A', borderRadius: 4, marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  thing, warming, filtered, onClear,
}: { thing: string; warming: boolean; filtered: boolean; onClear: () => void }) {
  return (
    <div style={emptyStyle}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
      {filtered ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#CBD5E1' }}>No matches for the current filters</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
            Try clearing the search / facet to see everything detected.
          </div>
          <button onClick={onClear} style={{ ...btnStyle, marginTop: 12 }}>Clear filters</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#CBD5E1' }}>
            No {thing} detected in the current news + filings window
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, maxWidth: 460, lineHeight: 1.5 }}>
            {warming
              ? 'The upstream live-feed is still warming its cache. Give it a moment and hit Refresh — the detector only sees what the live feed has indexed.'
              : 'Coverage depends entirely on the live news + NSE/BSE filings feed. Nothing matched the detector in the current window; this is honest emptiness, not an error.'}
          </div>
        </>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ ...emptyStyle, borderColor: 'rgba(239,68,68,0.3)' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#FCA5A5' }}>Couldn’t load the feed</div>
      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>{message}</div>
      <button onClick={onRetry} style={{ ...btnStyle, marginTop: 12 }}>↻ Retry</button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#94A3B8', background: '#0F1A2E',
  border: '1px solid #1E2D45', borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  fontSize: 12, color: '#E2E8F0', background: '#0F1A2E', border: '1px solid #1E2D45',
  borderRadius: 6, padding: '7px 10px', minWidth: 240, outline: 'none',
};

const chipBase: React.CSSProperties = {
  fontSize: 11, fontWeight: 500, color: '#94A3B8', background: 'transparent',
  border: '1px solid #1E2D45', borderRadius: 999, padding: '4px 10px', cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  background: '#0B1526', border: '1px solid #16233A', borderRadius: 8, padding: '12px 14px',
};

const emptyStyle: React.CSSProperties = {
  border: '1px dashed #1E2D45', borderRadius: 10, padding: '40px 20px', textAlign: 'center',
  background: '#0B1526',
};
