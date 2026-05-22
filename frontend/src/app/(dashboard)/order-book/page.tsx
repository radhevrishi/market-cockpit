'use client';

// ═══════════════════════════════════════════════════════════════════════════
// ORDER BOOK INTELLIGENCE — PATCH 0609 (TheWrap Module 1)
//
// Dedicated page for "Receipt of Order / Letter of Award" filings.
// Promoted from the news-card chip (Patch 0579) to its own surface per
// user request — institutional users want to scan order announcements
// daily as a primary alpha source.
//
// Dual-source ingestion:
//   1. /api/v1/news?search=...  — news stream with order-keyword tokens
//   2. /api/v1/concall-intel/live-feed  — NSE/BSE corporate filings
//      (where Reg-30 receipt-of-order intimations actually live)
//
// Each row carries the existing detectOrderBook() output: Tier-1 PSU
// customer match, contract value extraction (₹ Cr or $M), age, source
// tier classification. Sortable by: value, customer tier, age.
// Filterable by customer-tier / value-bracket / region.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { detectOrderBook, type DetectorSignal } from '@/lib/thewrap-detectors';
import { classifyCredibility, CREDIBILITY_TIER_META } from '@/lib/bottleneck-intel';
import PanelFreshness from '@/components/PanelFreshness';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

interface NewsArticleLite {
  id?: string; title?: string; headline?: string; summary?: string;
  source?: string; source_name?: string;
  url?: string; source_url?: string;
  published_at?: string; region?: string;
  ticker_symbols?: Array<string | { ticker: string }>;
}

interface FetchTrace {
  newsFetched: number; newsError?: string;
  filingsFetched: number; filingsError?: string;
}

interface FetchedPayload {
  articles: NewsArticleLite[];
  trace: FetchTrace;
}

const ORDER_SEARCH_TOKENS = [
  'receipt of order', 'received order', 'received an order',
  'letter of award', 'LOA', 'work order', 'purchase order',
  'contract award', 'bagged order', 'wins order', 'secured order',
  'order intake', 'order book',
].join('|');

async function fetchOrderPayload(): Promise<FetchedPayload> {
  const trace: FetchTrace = { newsFetched: 0, filingsFetched: 0 };
  const safe = async <T,>(url: string, label: 'news' | 'filings'): Promise<T | null> => {
    try {
      const ctl = new AbortController();
      // PATCH 0695 — was 25s; bumped to 50s so cold-start fetches
      // (live-feed has 60s maxDuration) actually complete.
      const t = setTimeout(() => ctl.abort(), 50_000);
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

  // PATCH 0704 — cacheOnly=1 so cold-start never blocks the user.
  // If cache is warming we render news-only and surface that explicitly.
  // PATCH 0695 — was days=14; 3d window matches eo-blockbuster-alert's
  // cache so we hit warm KV reliably.
  const [newsJson, filingsJson] = await Promise.all([
    safe<any>(`/api/v1/news?limit=500&search=${encodeURIComponent(ORDER_SEARCH_TOKENS)}`, 'news'),
    safe<any>(`/api/v1/concall-intel/live-feed?days=3&bullishOnly=false&cacheOnly=1`, 'filings'),
  ]);

  const articles: NewsArticleLite[] = [];
  const newsArr: any[] = Array.isArray(newsJson) ? newsJson : (newsJson?.articles || newsJson?.data || []);
  trace.newsFetched = newsArr.length;
  for (const a of newsArr) {
    articles.push({
      id: a.id, title: a.title || a.headline, headline: a.headline, summary: a.summary,
      source: a.source, source_name: a.source_name,
      url: a.url || a.source_url, published_at: a.published_at, region: a.region,
      ticker_symbols: a.ticker_symbols,
    });
  }
  const filingsArr: any[] = filingsJson?.filings || [];
  trace.filingsFetched = filingsArr.length;
  for (const f of filingsArr) {
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
  const seen = new Set<string>();
  const deduped = articles.filter(a => {
    const k = a.url || a.id || '';
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { articles: deduped, trace };
}

type CustomerTierFilter = 'ALL' | 'TIER1' | 'OTHER';
type ValueBracket = 'ALL' | 'BIG' | 'MID' | 'SMALL' | 'UNKNOWN';
type SortKey = 'date' | 'value' | 'tier';

interface OrderRow {
  signal: DetectorSignal;
  article: NewsArticleLite;
  valueRaw: string;
  valueRupeesCr: number | null;  // parsed numeric value in ₹ Cr (normalised)
  customerTier1: string;  // Tier-1 customer name if matched, else ''
  credibilityGlyph: string;
  credibilityColor: string;
}

function parseValueToCr(valueText: string | undefined): number | null {
  if (!valueText) return null;
  const m = valueText.match(/([\d,]+(?:\.\d+)?)\s*(crore|cr|crores?|lakh|lacs?|million|mn|billion|bn)/i);
  if (m) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(num)) return null;
    const unit = m[2].toLowerCase();
    if (/crore|cr/.test(unit)) return num;
    if (/lakh|lac/.test(unit)) return num / 100;
    if (/billion|bn/.test(unit)) return num * 100; // ₹1 bn = ₹100 Cr
    if (/million|mn/.test(unit)) return num * 0.1; // ₹1 mn = ₹0.1 Cr
    return null;
  }
  const md = valueText.match(/(?:USD|\$)\s*([\d,]+(?:\.\d+)?)\s*(million|mn|billion|bn)/i);
  if (md) {
    const num = parseFloat(md[1].replace(/,/g, ''));
    if (!Number.isFinite(num)) return null;
    const unit = md[2].toLowerCase();
    // Rough INR conversion at 85
    if (/billion|bn/.test(unit)) return num * 1000 * 0.85; // $1B ≈ ₹8500 Cr
    if (/million|mn/.test(unit)) return num * 0.85;
    return null;
  }
  return null;
}

export default function OrderBookPage() {
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<FetchedPayload>({
    queryKey: ['order-book-dual-source'],
    queryFn: fetchOrderPayload,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const [tierFilter, setTierFilter] = useState<CustomerTierFilter>('ALL');
  const [valueBracket, setValueBracket] = useState<ValueBracket>('ALL');
  const [region, setRegion] = useState<'ALL' | 'IN' | 'US'>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [search, setSearch] = useState('');

  // ── Run detector on every article + enrich ───────────────────────────
  const allRows = useMemo<OrderRow[]>(() => {
    const out: OrderRow[] = [];
    for (const a of data?.articles || []) {
      const blob = `${a.title || ''} ${a.headline || ''} ${a.summary || ''}`;
      const sig = detectOrderBook(blob);
      if (!sig) continue;
      const tier1Name = String(sig.meta?.tier1Customer || '');
      const valueRaw = String(sig.meta?.value || '');
      const valueRupeesCr = parseValueToCr(valueRaw);
      const cred = classifyCredibility(a.source_name || a.source, a.url);
      const credMeta = CREDIBILITY_TIER_META[cred];
      out.push({
        signal: sig,
        article: a,
        valueRaw,
        valueRupeesCr,
        customerTier1: tier1Name,
        credibilityGlyph: credMeta.glyph,
        credibilityColor: credMeta.color,
      });
    }
    return out;
  }, [data]);

  // ── Counts for filter chips ──────────────────────────────────────────
  const counts = useMemo(() => {
    const c = {
      ALL: allRows.length,
      TIER1: allRows.filter(r => !!r.customerTier1).length,
      OTHER: allRows.filter(r => !r.customerTier1).length,
      IN: allRows.filter(r => r.article.region === 'IN').length,
      US: allRows.filter(r => r.article.region === 'US').length,
      BIG: allRows.filter(r => (r.valueRupeesCr || 0) >= 500).length,
      MID: allRows.filter(r => (r.valueRupeesCr || 0) >= 100 && (r.valueRupeesCr || 0) < 500).length,
      SMALL: allRows.filter(r => (r.valueRupeesCr || 0) > 0 && (r.valueRupeesCr || 0) < 100).length,
      UNKNOWN: allRows.filter(r => r.valueRupeesCr == null).length,
    };
    return c;
  }, [allRows]);

  // ── Apply filters + sort ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = allRows.filter(r => {
      if (tierFilter === 'TIER1' && !r.customerTier1) return false;
      if (tierFilter === 'OTHER' && r.customerTier1) return false;
      if (region !== 'ALL' && r.article.region !== region) return false;
      const v = r.valueRupeesCr || 0;
      if (valueBracket === 'BIG' && v < 500) return false;
      if (valueBracket === 'MID' && (v < 100 || v >= 500)) return false;
      if (valueBracket === 'SMALL' && (v <= 0 || v >= 100)) return false;
      if (valueBracket === 'UNKNOWN' && r.valueRupeesCr != null) return false;
      if (q) {
        const blob = `${r.article.title || ''} ${r.article.summary || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    if (sortBy === 'date') {
      f.sort((a, b) => (b.article.published_at || '').localeCompare(a.article.published_at || ''));
    } else if (sortBy === 'value') {
      f.sort((a, b) => (b.valueRupeesCr || 0) - (a.valueRupeesCr || 0));
    } else if (sortBy === 'tier') {
      f.sort((a, b) => {
        if (!!a.customerTier1 !== !!b.customerTier1) return a.customerTier1 ? -1 : 1;
        return (b.valueRupeesCr || 0) - (a.valueRupeesCr || 0);
      });
    }
    return f;
  }, [allRows, tierFilter, valueBracket, region, sortBy, search]);

  // Tier-1 customer leaderboard (count by customer)
  const tier1Leaderboard = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) {
      if (r.customerTier1) m.set(r.customerTier1, (m.get(r.customerTier1) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [allRows]);

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>📋 Order Book Intelligence</h1>
          <span style={{ fontSize: 12, color: DIM }}>
            Receipt-of-Order / Letter-of-Award filings · TheWrap Module 1
          </span>
          <PanelFreshness dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} staleAfterMs={15 * 60_000} />
          <button onClick={() => refetch()} disabled={isFetching} style={{
            marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 4,
            border: '1px solid #22D3EE', background: '#22D3EE15', color: '#22D3EE', cursor: isFetching ? 'wait' : 'pointer',
          }}>↻ Refresh</button>
        </div>

        <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5, marginBottom: 12, maxWidth: 900 }}>
          Detects Reg-30 &ldquo;Receipt of Order / LoA / Work Order&rdquo; intimations from <strong style={{ color: TEXT }}>news + NSE/BSE
          filings</strong>. Tier-1 PSU customers (HAL · BHEL · NTPC · PGCIL · BEL · DRDO · ISRO · RBI · NABARD · LIC · ONGC · IOCL ·
          GAIL · NHAI · MoD · Indian Railways) are auto-flagged. Contract values extracted from text where present;
          unknown-value rows still surface for manual review.
        </div>

        {/* Diagnostic strip */}
        {data && (
          <div style={{
            background: '#0A1422', border: `1px solid ${BORDER}`,
            borderRadius: 6, padding: '8px 12px', marginBottom: 10,
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
            fontSize: 11, color: DIM,
          }}>
            <span style={{ color: '#8BA3C1', fontWeight: 700 }}>FETCH:</span>
            <span>📰 news: <strong style={{ color: data.trace.newsFetched > 0 ? '#10B981' : '#EF4444' }}>{data.trace.newsFetched}</strong>{data.trace.newsError && <span style={{ color: '#EF4444', marginLeft: 4 }}>({data.trace.newsError})</span>}</span>
            <span>📑 filings: <strong style={{ color: data.trace.filingsFetched > 0 ? '#10B981' : '#EF4444' }}>{data.trace.filingsFetched}</strong>{data.trace.filingsError && <span style={{ color: '#EF4444', marginLeft: 4 }}>({data.trace.filingsError})</span>}</span>
            <span style={{ color: '#1A2540' }}>·</span>
            <span style={{ color: '#8BA3C1', fontWeight: 700 }}>DETECT:</span>
            <span>🎯 orders: <strong style={{ color: counts.ALL > 0 ? '#10B981' : '#F59E0B' }}>{counts.ALL}</strong></span>
            <span>◆ Tier-1 PSU: <strong style={{ color: '#10B981' }}>{counts.TIER1}</strong></span>
            <span>· non-PSU: {counts.OTHER}</span>
          </div>
        )}

        {/* Tier-1 customer leaderboard */}
        {tier1Leaderboard.length > 0 && (
          <div style={{
            background: CARD, border: `1px solid ${BORDER}`,
            borderRadius: 6, padding: '10px 14px', marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981', letterSpacing: '0.4px', marginBottom: 6 }}>
              ◆ TIER-1 PSU CUSTOMER LEADERBOARD (last 14d)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tier1Leaderboard.map(([name, n]) => (
                <span key={name} style={{
                  fontSize: 10, fontWeight: 700, color: '#10B981',
                  padding: '3px 8px', borderRadius: 4,
                  background: '#10B98115', border: '1px solid #10B98140',
                }}>
                  {name} · {n}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Filter chips: customer tier + region + value bracket */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: 4 }}>CUSTOMER:</span>
          {(['ALL', 'TIER1', 'OTHER'] as CustomerTierFilter[]).map(t => {
            const isActive = tierFilter === t;
            const n = t === 'ALL' ? counts.ALL : t === 'TIER1' ? counts.TIER1 : counts.OTHER;
            const label = t === 'ALL' ? '🎯 ALL' : t === 'TIER1' ? '◆ Tier-1 PSU' : '◯ Other';
            const color = t === 'TIER1' ? '#10B981' : '#94A3B8';
            return (
              <button key={t} onClick={() => setTierFilter(t)} style={chipStyle(isActive, color)}>
                {label} · {n}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: 4 }}>VALUE:</span>
          {(['ALL', 'BIG', 'MID', 'SMALL', 'UNKNOWN'] as ValueBracket[]).map(v => {
            const isActive = valueBracket === v;
            const n = v === 'ALL' ? counts.ALL : v === 'BIG' ? counts.BIG : v === 'MID' ? counts.MID : v === 'SMALL' ? counts.SMALL : counts.UNKNOWN;
            const label = v === 'ALL' ? 'ALL' : v === 'BIG' ? '≥₹500 Cr' : v === 'MID' ? '₹100-500 Cr' : v === 'SMALL' ? '<₹100 Cr' : 'UNKNOWN';
            return (
              <button key={v} onClick={() => setValueBracket(v)} style={chipStyle(isActive, '#22D3EE')}>
                {label} · {n}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: 4 }}>REGION:</span>
          {(['ALL', 'IN', 'US'] as const).map(r => (
            <button key={r} onClick={() => setRegion(r)} style={chipStyle(region === r, '#A78BFA')}>
              {r === 'IN' ? '🇮🇳 INDIA' : r === 'US' ? '🇺🇸 USA' : '🌐 ALL'} · {r === 'ALL' ? counts.ALL : r === 'IN' ? counts.IN : counts.US}
            </button>
          ))}
          <span style={{ width: 1, background: BORDER, margin: '0 4px', alignSelf: 'stretch' }} />
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px' }}>SORT:</span>
          {(['date', 'value', 'tier'] as SortKey[]).map(s => (
            <button key={s} onClick={() => setSortBy(s)} style={chipStyle(sortBy === s, '#F59E0B')}>
              {s === 'date' ? '🕒 Recent' : s === 'value' ? '₹ Value' : '◆ Tier-1 first'}
            </button>
          ))}
        </div>

        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search company / customer / contract type…"
          style={{
            width: '100%', maxWidth: 480, padding: '7px 12px', borderRadius: 5,
            border: `1px solid ${BORDER}`, background: CARD, color: TEXT,
            fontSize: 12, outline: 'none', marginBottom: 14,
          }}
        />

        {/* Table */}
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: DIM, fontSize: 12 }}>Scanning news + NSE/BSE filings for order announcements…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: DIM, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
            <p style={{ margin: 0, fontWeight: 700, color: TEXT }}>
              {counts.ALL === 0 ? 'No order announcements detected.' : 'No order announcements match these filters.'}
            </p>
            {counts.ALL === 0 ? (
              <div style={{ margin: '8px 0 0', fontSize: 12, color: DIM, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.65 }}>
                Fetched <strong>{(data?.trace.newsFetched || 0) + (data?.trace.filingsFetched || 0)} rows</strong>,
                none matched the Reg-30 order-announcement pattern.
                {' '}
                <span style={{ color: '#F59E0B' }}>
                  Note: upstream NSE feed currently surfaces investor-meet / transcript filings only.
                  Reg-30 "Receipt of Order / Letter of Award" filings live on a different NSE
                  corp-announcements category.
                </span>
                <div style={{ marginTop: 10 }}>
                  <a href="https://www.nseindia.com/companies-listing/corporate-filings-announcements"
                     target="_blank" rel="noreferrer"
                     style={{ color: '#22D3EE', textDecoration: 'none', borderBottom: '1px dotted #22D3EE' }}>
                    Open NSE Corp Announcements (Reg 30 → Receipt of Order) →
                  </a>
                </div>
              </div>
            ) : (
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>Clear filters to see all {counts.ALL} detected orders.</p>
            )}
          </div>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#0A1422', borderBottom: `1px solid ${BORDER}` }}>
                  <th style={th}>CUSTOMER</th>
                  <th style={{ ...th, textAlign: 'right' }}>VALUE</th>
                  <th style={th}>TICKER</th>
                  <th style={th}>HEADLINE</th>
                  <th style={th}>SOURCE</th>
                  <th style={th}>DATE</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const tickers = (row.article.ticker_symbols || []).map(t => typeof t === 'string' ? t : t.ticker).filter(Boolean);
                  const customerLabel = row.customerTier1 || '—';
                  const customerColor = row.customerTier1 ? '#10B981' : DIM;
                  return (
                    <tr key={(row.article.id || '') + i} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                      <td style={td}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 4,
                          background: row.customerTier1 ? `${customerColor}20` : 'transparent',
                          color: customerColor,
                          border: row.customerTier1 ? `1px solid ${customerColor}40` : '1px solid transparent',
                          fontSize: 10, fontWeight: 800,
                        }}>
                          {row.customerTier1 ? `◆ ${customerLabel}` : 'private/unknown'}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                        {row.valueRupeesCr != null ? (
                          <span style={{ color: row.valueRupeesCr >= 500 ? '#10B981' : row.valueRupeesCr >= 100 ? '#22D3EE' : TEXT, fontWeight: 700 }}>
                            ₹{row.valueRupeesCr.toFixed(0)} Cr
                          </span>
                        ) : row.valueRaw ? (
                          <span style={{ color: DIM, fontSize: 10 }}>{row.valueRaw}</span>
                        ) : (
                          <span style={{ color: DIM }}>—</span>
                        )}
                      </td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#22D3EE', fontSize: 11 }}>
                        {tickers.length > 0 ? tickers.slice(0, 2).join(' · ') : '—'}
                      </td>
                      <td style={{ ...td, color: TEXT, maxWidth: 480 }}>
                        <a href={row.article.url || '#'} target="_blank" rel="noopener noreferrer" style={{ color: TEXT, textDecoration: 'none' }}>
                          {row.article.title || row.article.headline}
                        </a>
                      </td>
                      <td style={{ ...td, color: DIM, fontSize: 11, whiteSpace: 'nowrap' }}>
                        <span title="Source credibility tier" style={{ color: row.credibilityColor, fontWeight: 700, marginRight: 4 }}>{row.credibilityGlyph}</span>
                        {row.article.source_name || row.article.source || '—'}
                      </td>
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
          Detection is heuristic regex over headline + summary. Tier-1 customer match is exact-substring;
          value extraction follows ₹ / Rs / INR / $ patterns. Verify each row&apos;s source filing before
          ascribing fundamental impact — large orders (≥₹500 Cr) on small-cap balance sheets are the typical
          institutional-alpha pattern. Order-book / TTM-revenue rolling ratio is the next module
          (needs revenue snapshot — coming with Auth + Postgres).
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

function chipStyle(active: boolean, color: string): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 700,
    color: active ? color : DIM,
    background: active ? `${color}20` : 'transparent',
    border: `1px solid ${active ? color : BORDER}`,
    borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
    letterSpacing: '0.3px',
  };
}
