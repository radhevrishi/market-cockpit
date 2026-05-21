'use client';

// ═══════════════════════════════════════════════════════════════════════════
// RATING ACTIONS — §17.4(B) module 2.
//
// Tarffi Hussain (TheWrap) framework: rating-agency upgrades/downgrades are
// a high-signal, low-noise re-rating catalyst. This page scans the existing
// news stream for ICRA/CRISIL/CARE/India-Ratings actions and surfaces them
// as a sortable table.
//
// Pure client-side detection (lib/rating-agency-detector.ts) over the same
// /api/v1/news endpoint other pages use — no new backend.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { detectRatingAction, ACTION_META, type RatingAction, type RatingActionKind } from '@/lib/rating-agency-detector';
import PanelFreshness from '@/components/PanelFreshness';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

interface NewsArticleLite {
  id?: string;
  title?: string;
  headline?: string;
  summary?: string;
  source?: string;
  source_name?: string;
  url?: string;
  published_at?: string;
  region?: string;
  ticker_symbols?: Array<string | { ticker: string }>;
}

function fetchNews(): Promise<NewsArticleLite[]> {
  return fetch('/api/v1/news?limit=500&search=ICRA+CRISIL+CARE+rating', {
    cache: 'no-store',
  })
    .then(r => r.json())
    .then(j => Array.isArray(j) ? j : (j?.articles || j?.data || []))
    .catch(() => []);
}

type AgencyFilter = 'ALL' | 'ICRA' | 'CRISIL' | 'CARE' | 'India Ratings' | 'Fitch' | 'Moody\'s' | 'S&P';
type KindFilter   = 'ALL' | RatingActionKind;

export default function RatingActionsPage() {
  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery<NewsArticleLite[]>({
    queryKey: ['rating-actions-news'],
    queryFn: fetchNews,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const [agencyFilter, setAgencyFilter] = useState<AgencyFilter>('ALL');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [search, setSearch] = useState('');

  // Detect rating actions across the news payload. Each article that
  // matches a rating pattern becomes one row; articles with no match are
  // skipped silently.
  const actions = useMemo(() => {
    const out: Array<RatingAction & { article: NewsArticleLite }> = [];
    for (const a of data || []) {
      const blob = `${a.title || ''} ${a.headline || ''} ${a.summary || ''}`;
      const det = detectRatingAction(blob);
      if (det) out.push({ ...det, article: a });
    }
    // Sort by published_at desc by default
    out.sort((x, y) => (y.article.published_at || '').localeCompare(x.article.published_at || ''));
    return out;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return actions.filter(a => {
      if (agencyFilter !== 'ALL' && a.agency !== agencyFilter) return false;
      if (kindFilter !== 'ALL' && a.kind !== kindFilter) return false;
      if (q) {
        const blob = `${a.article.title || ''} ${a.article.headline || ''} ${a.article.summary || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [actions, agencyFilter, kindFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: actions.length };
    for (const a of actions) {
      c[a.kind] = (c[a.kind] || 0) + 1;
      c[a.agency] = (c[a.agency] || 0) + 1;
    }
    return c;
  }, [actions]);

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>🏛 Rating Actions</h1>
          <span style={{ fontSize: 12, color: DIM }}>
            ICRA / CRISIL / CARE / India-Ratings upgrades, downgrades, outlook changes.
          </span>
          <PanelFreshness dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} staleAfterMs={15 * 60_000} />
        </div>

        <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5, marginBottom: 14, maxWidth: 880 }}>
          Re-rating events are high-signal, low-noise catalysts — an upgrade often presages a fundamental
          improvement the market hasn't fully absorbed. Scanned heuristically from the news stream; verify
          each row by opening the source article before acting.
        </div>

        {/* Filter chips: kind */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: 4 }}>ACTION:</span>
          {(['ALL', 'UPGRADE', 'OUTLOOK_UP', 'DOWNGRADE', 'OUTLOOK_DOWN', 'WITHDRAWN', 'ASSIGNED', 'AFFIRMED'] as KindFilter[]).map(k => {
            const isActive = kindFilter === k;
            const meta = k === 'ALL' ? { color: '#22D3EE', emoji: '🎯', label: 'ALL' } : ACTION_META[k];
            const n = k === 'ALL' ? counts.ALL : (counts[k] || 0);
            if (k !== 'ALL' && n === 0) return null;
            return (
              <button key={k} onClick={() => setKindFilter(k)} style={{
                fontSize: 10, fontWeight: 700, color: isActive ? meta.color : DIM,
                background: isActive ? `${meta.color}20` : 'transparent',
                border: `1px solid ${isActive ? meta.color : BORDER}`,
                borderRadius: 4, padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.3px',
              }}>{meta.emoji} {meta.label} · {n}</button>
            );
          })}
        </div>

        {/* Filter chips: agency */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: 4 }}>AGENCY:</span>
          {(['ALL', 'ICRA', 'CRISIL', 'CARE', 'India Ratings', 'Fitch', 'Moody\'s', 'S&P'] as AgencyFilter[]).map(a => {
            const isActive = agencyFilter === a;
            const n = a === 'ALL' ? counts.ALL : (counts[a] || 0);
            if (a !== 'ALL' && n === 0) return null;
            return (
              <button key={a} onClick={() => setAgencyFilter(a)} style={{
                fontSize: 10, fontWeight: 700, color: isActive ? '#8B5CF6' : DIM,
                background: isActive ? '#8B5CF620' : 'transparent',
                border: `1px solid ${isActive ? '#8B5CF6' : BORDER}`,
                borderRadius: 4, padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.3px',
              }}>{a} · {n}</button>
            );
          })}
        </div>

        {/* Search box */}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search headline / company / agency…"
          style={{
            width: '100%', maxWidth: 480, padding: '7px 12px', borderRadius: 5,
            border: `1px solid ${BORDER}`, background: CARD, color: TEXT,
            fontSize: 12, outline: 'none', marginBottom: 14,
          }}
        />

        {/* Table */}
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: DIM, fontSize: 12 }}>Scanning news for rating actions…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: DIM, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🏛</div>
            <p style={{ margin: 0, fontWeight: 700, color: TEXT }}>No rating actions match these filters.</p>
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>
              {actions.length === 0 ? 'No agency mentions found in the current news window.' : 'Clear filters to see all detected actions.'}
            </p>
          </div>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#0A1422', borderBottom: `1px solid ${BORDER}` }}>
                  <th style={th}>ACTION</th>
                  <th style={th}>AGENCY</th>
                  <th style={th}>OLD → NEW</th>
                  <th style={th}>OUTLOOK</th>
                  <th style={th}>HEADLINE</th>
                  <th style={th}>SOURCE</th>
                  <th style={th}>DATE</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const meta = ACTION_META[row.kind];
                  return (
                    <tr key={(row.article.id || '') + i} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                      <td style={td}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 4,
                          background: `${meta.color}20`, color: meta.color,
                          border: `1px solid ${meta.color}40`,
                          fontSize: 10, fontWeight: 800,
                        }}>{meta.emoji} {meta.label}</span>
                      </td>
                      <td style={{ ...td, color: '#A78BFA', fontWeight: 700 }}>{row.agency}</td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: TEXT, whiteSpace: 'nowrap' }}>
                        {row.oldRating || row.newRating
                          ? `${row.oldRating || '—'} → ${row.newRating || '—'}`
                          : <span style={{ color: DIM }}>—</span>}
                      </td>
                      <td style={{ ...td, color: TEXT, fontSize: 11, whiteSpace: 'nowrap' }}>
                        {row.oldOutlook || row.newOutlook
                          ? `${row.oldOutlook || '—'} → ${row.newOutlook || '—'}`
                          : <span style={{ color: DIM }}>—</span>}
                      </td>
                      <td style={{ ...td, color: TEXT, maxWidth: 480 }}>
                        <a href={row.article.url || '#'} target="_blank" rel="noopener noreferrer" style={{ color: TEXT, textDecoration: 'none' }}>
                          {row.article.title || row.article.headline || row.headline}
                        </a>
                      </td>
                      <td style={{ ...td, color: DIM, fontSize: 11, whiteSpace: 'nowrap' }}>{row.article.source_name || row.article.source || '—'}</td>
                      <td style={{ ...td, color: DIM, fontSize: 11, whiteSpace: 'nowrap' }}>
                        {row.article.published_at ? new Date(row.article.published_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 11, color: DIM, lineHeight: 1.5 }}>
          Detection is heuristic — verify each row's source article before acting.
          Server-side curation with structured rating-history (old/new + effective date) is planned but
          blocked on the source-tier KV table refactor.
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
  color: '#8BA3C1', letterSpacing: '0.5px',
};
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
