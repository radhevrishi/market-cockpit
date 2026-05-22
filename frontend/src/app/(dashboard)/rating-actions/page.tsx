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

// PATCH 0599 — Dual-source ingestion. The /api/v1/news cache is dominated by
// US tech / global headlines; India rating-agency news (ICRA / CRISIL / CARE
// / India Ratings / Acuité) appears more reliably in:
//   (a) news feed, but only when we ask for it with proper OR-tokenized
//       search (the /api/v1/news endpoint splits search on `|` per its
//       implementation), AND
//   (b) /api/v1/concall-intel/live-feed which surfaces NSE/BSE corporate
//       filings — many of which include rating-agency intimation filings.
//
// We fetch BOTH in parallel, classify everything, dedupe by URL/id.
const RATING_SEARCH_TOKENS = [
  'ICRA', 'CRISIL', 'CARE Ratings', 'India Ratings', 'Ind-Ra',
  'Fitch', 'Moody', 'S&P', 'Brickwork', 'Acuit',
  'credit rating', 'rating upgrade', 'rating downgrade',
  'rating revised', 'rating reaffirmed', 'rating affirmed',
  'rating assigned', 'rating withdrawn', 'outlook revised',
  'placed on watch',
].join('|');

interface FetchTrace {
  newsFetched: number;
  newsError?: string;
  filingsFetched: number;
  filingsError?: string;
  totalSources: number;
}

interface FetchedPayload {
  articles: NewsArticleLite[];
  trace: FetchTrace;
}

async function fetchRatingPayload(): Promise<FetchedPayload> {
  const trace: FetchTrace = { newsFetched: 0, filingsFetched: 0, totalSources: 0 };
  const safe = async <T,>(url: string, label: 'news' | 'filings'): Promise<T | null> => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 25_000);
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) {
        if (label === 'news') trace.newsError = `HTTP ${r.status}`;
        else trace.filingsError = `HTTP ${r.status}`;
        return null;
      }
      return await r.json() as T;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch failed');
      if (label === 'news') trace.newsError = msg;
      else trace.filingsError = msg;
      return null;
    }
  };

  const [newsJson, filingsJson] = await Promise.all([
    safe<any>(`/api/v1/news?limit=500&search=${encodeURIComponent(RATING_SEARCH_TOKENS)}`, 'news'),
    safe<any>(`/api/v1/concall-intel/live-feed?days=14&bullishOnly=false`, 'filings'),
  ]);

  const articles: NewsArticleLite[] = [];

  // Pull news shape (variable: array OR {articles}/{data})
  const newsArr: any[] = Array.isArray(newsJson) ? newsJson
                        : (newsJson?.articles || newsJson?.data || []);
  trace.newsFetched = newsArr.length;
  for (const a of newsArr) {
    articles.push({
      id: a.id,
      title: a.title || a.headline,
      headline: a.headline,
      summary: a.summary,
      source: a.source,
      source_name: a.source_name,
      url: a.url || a.source_url,
      published_at: a.published_at,
      region: a.region,
      ticker_symbols: a.ticker_symbols,
    });
  }

  // Pull corporate filings shape: { filings: [{ symbol, subject, source_url,
  // filing_datetime, company_name, exchange }] }
  const filingsArr: any[] = filingsJson?.filings || [];
  trace.filingsFetched = filingsArr.length;
  for (const f of filingsArr) {
    // Reformat as NewsArticleLite so the same detector runs on it.
    articles.push({
      id: `filing-${f.symbol}-${f.filing_datetime}`,
      title: f.subject || '',
      headline: f.subject || '',
      summary: `${f.company_name || ''} ${f.exchange || ''}`,
      source: f.exchange === 'NSE' ? 'NSE Corporate Filing' : 'BSE Corporate Filing',
      source_name: f.exchange === 'NSE' ? 'NSE Corporate Filing' : 'BSE Corporate Filing',
      url: f.source_url || f.attachment_urls?.[0],
      published_at: f.filing_datetime,
      region: 'IN',
      ticker_symbols: f.symbol ? [f.symbol] : undefined,
    });
  }

  // Dedupe by URL
  const seen = new Set<string>();
  const deduped = articles.filter(a => {
    const k = a.url || a.id || '';
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  trace.totalSources = (newsArr.length > 0 ? 1 : 0) + (filingsArr.length > 0 ? 1 : 0);
  return { articles: deduped, trace };
}

type AgencyFilter = 'ALL' | 'ICRA' | 'CRISIL' | 'CARE' | 'India Ratings' | 'Fitch' | 'Moody\'s' | 'S&P';
type KindFilter   = 'ALL' | RatingActionKind;

export default function RatingActionsPage() {
  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery<FetchedPayload>({
    queryKey: ['rating-actions-dual-source-v2'],
    queryFn: fetchRatingPayload,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const [agencyFilter, setAgencyFilter] = useState<AgencyFilter>('ALL');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [search, setSearch] = useState('');

  // Detect rating actions across both news + filings. Each article that
  // matches a rating pattern becomes one row. Track agency-mention vs
  // action-match separately so the diagnostics strip can show the
  // attrition at each stage.
  const { actions, agencyOnlyCount } = useMemo(() => {
    const out: Array<RatingAction & { article: NewsArticleLite }> = [];
    let agencyOnly = 0;
    // Pattern-level agency hit (without requiring a rating action verb).
    // Use detector's regex source by running it again with action-less text
    // is messy; simpler: just count any blob containing one of the agency
    // names. Diagnostics-only — purely UI counter.
    const agencyRx = /(ICRA|CRISIL|CARE Ratings?|India Ratings?|Ind-?Ra|Fitch|Moody'?s|S&P|Brickwork|Acuit[eé])/i;
    for (const a of data?.articles || []) {
      const blob = `${a.title || ''} ${a.headline || ''} ${a.summary || ''}`;
      const det = detectRatingAction(blob);
      if (det) {
        out.push({ ...det, article: a });
      } else if (agencyRx.test(blob)) {
        agencyOnly++;
      }
    }
    out.sort((x, y) => (y.article.published_at || '').localeCompare(x.article.published_at || ''));
    return { actions: out, agencyOnlyCount: agencyOnly };
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
          improvement the market hasn't fully absorbed. Scanned heuristically from <strong style={{ color: TEXT }}>news + NSE/BSE corporate
          filings</strong>; verify each row by opening the source article before acting.
        </div>

        {/* PATCH 0599 — Dual-source diagnostic strip. Tells the analyst
            exactly what was fetched and where the attrition happened, so
            an empty page is debuggable rather than mysterious. */}
        {data && (
          <div style={{
            background: '#0A1422', border: `1px solid ${BORDER}`,
            borderRadius: 6, padding: '8px 12px', marginBottom: 14,
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
            fontSize: 11, color: DIM,
          }}>
            <span style={{ color: '#8BA3C1', fontWeight: 700 }}>FETCH:</span>
            <span title="Articles returned by /api/v1/news with the rating-search OR tokens">
              📰 news: <strong style={{ color: data.trace.newsFetched > 0 ? '#10B981' : '#EF4444' }}>{data.trace.newsFetched}</strong>
              {data.trace.newsError && <span style={{ color: '#EF4444', marginLeft: 4 }}>({data.trace.newsError})</span>}
            </span>
            <span title="NSE/BSE corporate filings from /api/v1/concall-intel/live-feed">
              📑 filings: <strong style={{ color: data.trace.filingsFetched > 0 ? '#10B981' : '#EF4444' }}>{data.trace.filingsFetched}</strong>
              {data.trace.filingsError && <span style={{ color: '#EF4444', marginLeft: 4 }}>({data.trace.filingsError})</span>}
            </span>
            <span style={{ color: '#1A2540' }}>·</span>
            <span style={{ color: '#8BA3C1', fontWeight: 700 }}>CLASSIFY:</span>
            <span title="Articles where the regex matched both an agency name AND a rating action verb">
              🎯 actions detected: <strong style={{ color: actions.length > 0 ? '#10B981' : '#F59E0B' }}>{actions.length}</strong>
            </span>
            <span title="Articles that mention an agency name but had no rating action verb matched (may be company news, not a rating event)">
              📌 agency-only mentions: {agencyOnlyCount}
            </span>
          </div>
        )}

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
          <div style={{ padding: 40, textAlign: 'center', color: DIM, fontSize: 12 }}>Scanning news + NSE/BSE filings for rating actions…</div>
        ) : filtered.length === 0 ? (
          /* PATCH 0599 — diagnostic empty-state. Explains exactly WHY
             the page is empty given the trace data. */
          <div style={{ padding: 40, textAlign: 'center', color: DIM, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🏛</div>
            <p style={{ margin: 0, fontWeight: 700, color: TEXT }}>
              {actions.length === 0 ? 'No rating actions detected.' : 'No rating actions match these filters.'}
            </p>
            {actions.length === 0 ? (
              <div style={{ margin: '8px 0 0', fontSize: 12, color: DIM, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                {data?.trace.newsFetched === 0 && data?.trace.filingsFetched === 0 ? (
                  <>
                    <strong style={{ color: '#EF4444' }}>Both sources returned 0 rows.</strong>
                    {data?.trace.newsError && <> News error: {data.trace.newsError}.</>}
                    {data?.trace.filingsError && <> Filings error: {data.trace.filingsError}.</>}
                    {' '}This is usually transient — try the ↻ Refresh button or wait 60s.
                  </>
                ) : agencyOnlyCount > 0 ? (
                  <>
                    Found <strong style={{ color: '#F59E0B' }}>{agencyOnlyCount} agency mentions</strong>{' '}
                    but none matched a rating <em>action</em> verb (upgrade / downgrade / outlook / affirmed / withdrawn).
                    The agencies were probably mentioned in general company news. Detection scope
                    is conservative by design — false positives on a rating tracker erode trust faster
                    than false negatives.
                  </>
                ) : (
                  <>
                    Fetched <strong>{(data?.trace.newsFetched || 0) + (data?.trace.filingsFetched || 0)} rows</strong>{' '}
                    ({data?.trace.newsFetched || 0} news + {data?.trace.filingsFetched || 0} filings), none with agency mentions.{' '}
                    <span style={{ color: '#F59E0B' }}>
                      Note: upstream NSE feed currently scrapes investor-meet / transcript filings only.
                      Reg-15 "Credit Rating Action" filings live on a different NSE corp-announcements category.
                    </span>
                    <div style={{ marginTop: 10 }}>
                      <a href="https://www.nseindia.com/companies-listing/corporate-filings-announcements"
                         target="_blank" rel="noreferrer"
                         style={{ color: '#22D3EE', textDecoration: 'none', borderBottom: '1px dotted #22D3EE' }}>
                        Open NSE Corp Announcements (Reg 15 → Credit Rating) →
                      </a>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>Clear filters to see all {actions.length} detected actions.</p>
            )}
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
