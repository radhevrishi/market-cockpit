'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Loader } from 'lucide-react';

interface Quote {
  ticker: string;
  company: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

// ── Earnings Insight types (lightweight — from earnings-scan API) ──
interface EarningsInsight {
  symbol: string;
  revenueYoY: number | null;
  patYoY: number | null;
  epsYoY: number | null;
  opmNow: number;
  opmPrev: number;
  period: string;
  grade: string;
  guidance: string | null;
  keyPhrasesPositive: string[];
  keyPhrasesNegative: string[];
  capexSignal: string;
  demandSignal: string;
  marginOutlook: string;
  revenueOutlook: string;
  patQtr: number; // latest quarter PAT
}

// ── Earnings verdict engine (same logic as earnings page) ──
function generateVerdict(e: EarningsInsight): { label: string; driver: string; forward: string; signal: 'green' | 'yellow' | 'red' } {
  const rev = e.revenueYoY, pat = e.patYoY;
  const opmDelta = e.opmNow - e.opmPrev;
  const hasRev = rev !== null, hasPat = pat !== null;
  const profitConversion = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;

  const posKeys = e.keyPhrasesPositive.map(k => k.toLowerCase());
  const negKeys = e.keyPhrasesNegative.map(k => k.toLowerCase());
  const isDebtFree = posKeys.some(k => k.includes('debt free') || k.includes('zero debt'));
  const hasOrderBook = posKeys.some(k => k.includes('order'));
  const hasHighDebt = negKeys.some(k => k.includes('debt') || k.includes('borrowing'));
  const hasWCStress = negKeys.some(k => k.includes('working capital') || k.includes('receivable'));

  // ── CLASSIFY ──
  let label: string;
  if (e.patQtr < 0) label = 'Miss';
  else if (!hasRev || !hasPat) label = 'Mixed';
  else if (rev! <= -5 && pat! <= -10) label = 'Miss';
  else if (rev! <= 0 && pat! <= 0) label = 'Miss';
  else if (rev! > 5 && pat! <= 0) label = 'Mixed';
  else if (rev! > 15 && profitConversion < 0.25 && opmDelta < -3) label = 'Mixed';
  else if (rev! > 10 && profitConversion < 0.3 && opmDelta < -2) label = 'Mixed';
  else if (hasWCStress && opmDelta < -3) label = 'Mixed';
  else if (rev! > 12 && pat! > 18 && opmDelta >= -1) label = 'Beat';
  else if (rev! > 8 && pat! > 10) label = pat! > rev! ? 'Beat' : 'Strong';
  else if (rev! > 0 && pat! > 0) label = 'Strong';
  else label = 'Mixed';

  // ── LINE 1: DRIVER ──
  let driver: string;
  if (label === 'Miss') {
    if (e.patQtr < 0 && hasHighDebt) driver = 'Interest burden pushed earnings into loss';
    else if (e.patQtr < 0) driver = 'Operating losses; cost base exceeds revenue';
    else if (hasRev && rev! > 5 && hasPat && pat! < -10) { driver = hasHighDebt ? 'Finance costs eroded operating gains' : opmDelta < -4 ? 'Scaling costs squeezed margins despite growth' : 'Rising costs absorbed revenue growth'; }
    else if (hasRev && rev! < -5 && hasHighDebt) driver = 'Demand weakness compounded by debt burden';
    else if (hasRev && rev! < -5) driver = 'Revenue decline and weaker demand dragged profits';
    else driver = 'Revenue and profit both declined';
  } else if (label === 'Mixed') {
    if (hasRev && rev! > 30 && opmDelta < -4) driver = hasOrderBook ? 'Capacity ramp-up costs absorbed the revenue surge' : 'Scaling costs absorbed most of the revenue surge';
    else if (hasRev && rev! > 10 && opmDelta < -3) driver = 'Employee and project costs squeezed margins';
    else if (hasRev && rev! > 5 && hasPat && pat! <= 0) driver = hasHighDebt ? 'Finance costs capped profit despite revenue growth' : 'Rising costs offset revenue growth entirely';
    else if (hasWCStress && hasRev && rev! > 0) driver = 'Growth stretched working capital and weakened cash quality';
    else if (profitConversion < 0.3 && hasRev && rev! > 10 && opmDelta < -2) driver = 'Input cost inflation squeezed operating margins';
    else driver = 'No clear earnings inflection this quarter';
  } else if (label === 'Beat') {
    if (opmDelta > 3 && isDebtFree) driver = 'Operating leverage and clean balance sheet lifted profits';
    else if (opmDelta > 3) driver = 'Margin expansion and operating leverage drove the beat';
    else if (hasPat && pat! > rev! * 1.5 && opmDelta > 0) driver = 'Higher margins and operating leverage lifted profits';
    else if (isDebtFree && opmDelta >= 0) driver = 'Volume growth on a debt-free base drove earnings';
    else if (hasOrderBook) driver = 'Order execution and mix improvement drove the beat';
    else if (hasWCStress) driver = 'Profits strong but receivables weakened cash quality';
    else if (opmDelta >= 0) driver = 'Broad-based growth with margins holding';
    else driver = 'Volume growth drove profits despite softer margins';
  } else {
    if (opmDelta > 2 && isDebtFree) driver = 'Margins expanded on a clean balance sheet';
    else if (opmDelta > 2) driver = 'Cost discipline drove margin expansion';
    else if (isDebtFree && hasPat && pat! > 15) driver = 'Volume growth on a debt-free base lifted earnings';
    else if (opmDelta < -3 && e.guidance === 'Positive') driver = 'Volume growth drove profits despite softer margins';
    else if (opmDelta < -3) driver = 'Revenue growth partly offset by margin dilution';
    else if (hasOrderBook) driver = 'Order book execution supported earnings growth';
    else if (hasWCStress) driver = 'Earnings grew but working capital needs rose';
    else if (opmDelta >= 0) driver = 'Broad-based growth with margins holding';
    else driver = 'Revenue growth supported earnings this quarter';
  }

  // ── LINE 2: FORWARD OUTLOOK ──
  let forward: string;
  const g = e.guidance;
  const cap = e.capexSignal;
  const dem = e.demandSignal;
  const mar = e.marginOutlook;
  const revOl = e.revenueOutlook;

  if (label === 'Miss') {
    if (g === 'Positive') forward = 'Management guides recovery; watch for execution';
    else if (hasHighDebt) forward = 'Debt overhang limits recovery optionality';
    else forward = 'No visible catalyst for near-term recovery';
  } else if (label === 'Mixed') {
    if (cap === 'Expanding' && (g === 'Positive' || mar === 'Expanding')) forward = 'Capex expanding; margins should recover as projects mature';
    else if (mar === 'Expanding' || g === 'Positive') forward = 'Margin recovery guided; operating leverage should improve';
    else if (hasOrderBook) forward = 'Order pipeline intact; execution key to margin inflection';
    else if (opmDelta < -5 && hasRev && rev! > 30) forward = 'Hyper-growth phase; margins should stabilize with scale';
    else forward = 'Forward visibility limited; monitor next quarter for direction';
  } else if (label === 'Beat') {
    if (cap === 'Expanding' && isDebtFree) forward = 'Expanding capacity debt-free; runway for sustained compounding';
    else if (mar === 'Expanding' && dem === 'Strong') forward = 'Demand strong and margins expanding; positive operating leverage';
    else if (g === 'Positive' && hasOrderBook) forward = 'Positive guidance backed by order visibility';
    else if (isDebtFree) forward = 'Clean balance sheet supports sustained earnings growth';
    else if (hasWCStress) forward = 'Watch working capital; cash conversion must improve';
    else if (g === 'Positive') forward = 'Forward guidance constructive';
    else forward = 'Execution was strong; sustain trajectory to confirm';
  } else {
    if (mar === 'Expanding' && isDebtFree) forward = 'Margins expanding on clean balance sheet; compounding visible';
    else if (g === 'Positive' && cap === 'Expanding') forward = 'Capacity addition underway; growth runway ahead';
    else if (isDebtFree && hasOrderBook) forward = 'Debt-free with order visibility; structural tailwind';
    else if (g === 'Positive') forward = 'Forward guidance constructive';
    else if (opmDelta < -2) forward = 'Monitor if margin pressure is cyclical or structural';
    else forward = 'Steady trajectory; watch for margin or growth inflection';
  }

  const signal: 'green' | 'yellow' | 'red' = (label === 'Beat' || label === 'Strong') ? 'green' : label === 'Miss' ? 'red' : 'yellow';
  return { label, driver, forward, signal };
}

interface Earning {
  symbol: string;
  company: string;
  quality: string;
  quarter: string;
  sector: string;
  marketCap: string;
  edp: number | null;
  timing: string;
  price: number;
  movePercent: number;
}

interface QuotesData {
  stocks: Quote[];
  source: string;
  updatedAt: string;
}

interface EarningsData {
  earnings: Earning[];
  source: string;
  updatedAt: string;
}

const THEME = {
  background: '#0A0E1A',
  card: '#111B35',
  cardHover: '#162040',
  border: '#1A2840',
  textPrimary: '#F5F7FA',
  textSecondary: '#8A95A3',
  accent: '#0F7ABF',
  green: '#10B981',
  red: '#EF4444',
};

const SORT_OPTIONS = ['Name', 'Change%', 'Price', 'Volume'];

export default function ScreenerPage() {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [screenerMode, setScreenerMode] = useState<'stocks' | 'earnings'>('stocks');
  const [data, setData] = useState<QuotesData | null>(null);
  const [earningsData, setEarningsData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('All');
  const [sortBy, setSortBy] = useState('Name');
  const [sortAscending, setSortAscending] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [sectors, setSectors] = useState<string[]>(['All']);
  // Earnings Insight: opt-in checkbox — only fetches when ticked
  const [showEarnings, setShowEarnings] = useState(false);
  const [earningsInsights, setEarningsInsights] = useState<Map<string, EarningsInsight>>(new Map());
  const [earningsLoading, setEarningsLoading] = useState(false);
  const earningsFetchedRef = useRef<Set<string>>(new Set());

  const itemsPerPage = 20;

  const fetchQuotesData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const marketParam = market === 'us' ? 'us' : 'india';
      const response = await fetch(`/api/market/quotes?market=${marketParam}`);
      if (!response.ok) throw new Error('Failed to fetch quotes');
      const result: QuotesData = await response.json();
      setData(result);

      // Derive sectors from the stocks data
      const uniqueSectors = new Set(result.stocks.map(stock => stock.sector));
      const sortedSectors = ['All', ...Array.from(uniqueSectors).sort()];
      setSectors(sortedSectors);

      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [market]);

  const fetchEarningsData = useCallback(async () => {
    setLoading(true);
    setError(null);

    // AbortController replaces Promise.race + dangling setTimeout.
    // When the timeout fires, the in-flight fetch is actually cancelled (no orphaned request).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      // Fetch current month first — only use previous month as fallback if no results
      const now = new Date();
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Inner IIFE so abort signal propagates to both fetch calls
      const runFetch = async () => {
        const currentRes = await fetch(`/api/market/earnings?month=${monthStr}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : null).catch(() => null);

        let allResults: any[] = [];
        const seen = new Set<string>();

        // Add current month results
        if (currentRes) {
          const items = currentRes.results || currentRes.earnings || [];
          for (const r of items) {
            const sym = r.ticker || r.symbol || '';
            if (sym && !seen.has(sym)) {
              seen.add(sym);
              allResults.push(r);
            }
          }
        }

        // Only fetch previous month if current month has very few results
        if (allResults.length < 5) {
          const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
          const prevRes = await fetch(`/api/market/earnings?month=${prevMonthStr}`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).catch(() => null);
          if (prevRes) {
            const items = prevRes.results || prevRes.earnings || [];
            for (const r of items) {
              const sym = r.ticker || r.symbol || '';
              if (sym && !seen.has(sym)) {
                seen.add(sym);
                allResults.push(r);
              }
            }
          }
        }

        // Sort by filing date descending (most recent first)
        allResults.sort((a, b) => {
          const dateA = a.resultDate || a.filingDate || a.timing || '';
          const dateB = b.resultDate || b.filingDate || b.timing || '';
          return dateB.localeCompare(dateA);
        });

        const mapped: EarningsData = {
          earnings: allResults.map((r: any) => ({
            symbol: r.ticker || r.symbol || '',
            company: r.company || r.companyName || r.symbol || '',
            quality: r.quality || r.rating || '-',
            quarter: r.quarter || r.period || '-',
            sector: r.sector || 'Other',
            marketCap: r.marketCap || r.cap || '-',
            edp: r.edp || r.eps || null,
            timing: r.timing || r.resultDate || '-',
            price: r.cmp || r.currentPrice || r.price || 0,
            movePercent: r.priceMove || r.movePercent || r.priceChange || 0,
          })),
          source: currentRes?.source || 'NSE',
          updatedAt: currentRes?.updatedAt || new Date().toISOString(),
        };
        setEarningsData(mapped);
        setCurrentPage(1);
      };

      await runFetch();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setError('Earnings data timed out (15 s) — try refreshing');
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screenerMode === 'stocks') {
      fetchQuotesData();
      const interval = setInterval(fetchQuotesData, 60000);
      return () => clearInterval(interval);
    } else {
      fetchEarningsData();
      const interval = setInterval(fetchEarningsData, 300000);
      return () => clearInterval(interval);
    }
  }, [screenerMode, fetchQuotesData, fetchEarningsData]);

  // ── Earnings Insight: lazy-fetch for visible page only when checkbox ticked ──
  const fetchEarningsForPage = useCallback(async (symbols: string[]) => {
    // Skip already-fetched symbols
    const toFetch = symbols.filter(s => !earningsFetchedRef.current.has(s));
    if (toFetch.length === 0) return;

    setEarningsLoading(true);
    const controller = new AbortController();
    try {
      const BATCH = 20;
      for (let i = 0; i < toFetch.length; i += BATCH) {
        const batch = toFetch.slice(i, i + BATCH);
        const encoded = batch.map(s => encodeURIComponent(s)).join(',');
        let res: Response;
        try {
          res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: controller.signal });
        } catch {
          // Network error for this batch — don't mark as fetched so it can be retried
          continue;
        }
        if (!res.ok) continue;
        const data = await res.json();
        const cards = data.cards || [];

        // Mark all batch symbols as fetched BEFORE state update (avoid side-effects inside setState)
        for (const s of batch) earningsFetchedRef.current.add(s);

        const newInsights: Array<[string, EarningsInsight]> = [];
        for (const c of cards) {
          // Find YoY quarter for OPM comparison
          const q0 = c.quarters?.[0];
          const latestMonth = q0?.period?.split(' ')?.[0];
          const latestYear = parseInt(q0?.period?.split(' ')?.[1] || '0');
          const yoyQ = (c.quarters || []).find((q: any) => {
            const m = q.period.split(' ')[0];
            const y = parseInt(q.period.split(' ')[1]);
            return m === latestMonth && y === latestYear - 1;
          });
          newInsights.push([c.symbol, {
            symbol: c.symbol,
            revenueYoY: c.revenueYoY ?? null,
            patYoY: c.patYoY ?? null,
            epsYoY: c.epsYoY ?? null,
            opmNow: q0?.opm ?? 0,
            opmPrev: yoyQ?.opm ?? q0?.opm ?? 0,
            period: c.period || '',
            grade: c.grade || '',
            guidance: c.guidance || null,
            keyPhrasesPositive: c.keyPhrasesPositive || [],
            keyPhrasesNegative: c.keyPhrasesNegative || [],
            capexSignal: c.capexSignal || 'Unknown',
            demandSignal: c.demandSignal || 'Unknown',
            marginOutlook: c.marginOutlook || 'Unknown',
            revenueOutlook: c.revenueOutlook || 'Unknown',
            patQtr: q0?.pat ?? 0,
          }]);
        }
        if (newInsights.length > 0) {
          setEarningsInsights(prev => {
            const next = new Map(prev);
            for (const [sym, insight] of newInsights) next.set(sym, insight);
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        console.error('[Screener] Earnings fetch failed:', e);
      }
    } finally {
      setEarningsLoading(false);
    }
  }, []);

  const filteredQuotes = React.useMemo(() => {
    if (!data) return [];

    let filtered = (data.stocks || []).filter((quote) => {
      const matchesSearch = quote.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.company.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSector = selectedSector === 'All' || quote.sector === selectedSector;
      return matchesSearch && matchesSector;
    });

    filtered.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      switch (sortBy) {
        case 'Price':
          aVal = a.price;
          bVal = b.price;
          break;
        case 'Change%':
          aVal = a.changePercent;
          bVal = b.changePercent;
          break;
        case 'Volume':
          aVal = a.volume;
          bVal = b.volume;
          break;
        default:
          aVal = a.company;
          bVal = b.company;
      }

      if (typeof aVal === 'string') {
        return sortAscending ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      }
      return sortAscending ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return filtered;
  }, [data, searchTerm, selectedSector, sortBy, sortAscending]);

  const filteredEarnings = React.useMemo(() => {
    if (!earningsData) return [];

    let filtered = (earningsData.earnings || []).filter((earning) => {
      const matchesSearch = earning.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        earning.company.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });

    // Basic sort by company name or symbol
    if (sortBy === 'Name') {
      filtered.sort((a, b) => sortAscending ? a.company.localeCompare(b.company) : b.company.localeCompare(a.company));
    } else if (sortBy === 'Change%') {
      filtered.sort((a, b) => sortAscending ? a.movePercent - b.movePercent : b.movePercent - a.movePercent);
    } else if (sortBy === 'Price') {
      filtered.sort((a, b) => sortAscending ? a.price - b.price : b.price - a.price);
    }

    return filtered;
  }, [earningsData, searchTerm, sortBy, sortAscending]);

  const totalPages = Math.ceil((screenerMode === 'stocks' ? filteredQuotes : filteredEarnings).length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const displayedQuotes = filteredQuotes.slice(startIndex, startIndex + itemsPerPage);
  const displayedEarnings = filteredEarnings.slice(startIndex, startIndex + itemsPerPage);

  // Trigger earnings fetch when checkbox is on and page changes
  useEffect(() => {
    if (!showEarnings || screenerMode !== 'stocks') return;
    const pageSymbols = displayedQuotes.map(q => q.ticker);
    if (pageSymbols.length > 0) fetchEarningsForPage(pageSymbols);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEarnings, screenerMode, currentPage, fetchEarningsForPage, displayedQuotes.length]);

  const handleSortClick = (column: string) => {
    if (sortBy === column) {
      setSortAscending(!sortAscending);
    } else {
      setSortBy(column);
      setSortAscending(true);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1e7) return (num / 1e7).toFixed(2) + 'Cr';
    if (num >= 1e5) return (num / 1e5).toFixed(2) + 'L';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  };

  return (
    <div style={{ background: THEME.background, minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ color: THEME.textPrimary, fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0' }}>
            Market Screener
          </h1>
          <p style={{ color: THEME.textSecondary, fontSize: '14px', margin: 0 }}>
            Real-time stock data powered by NSE India
          </p>
        </div>

        {error && (
          <div style={{ padding: '16px', background: `${THEME.red}22`, border: `1px solid ${THEME.red}`, borderRadius: '8px', color: THEME.red, marginBottom: '24px' }}>
            Error: {error}
          </div>
        )}

        {/* Controls Section */}
        <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
          {/* Screener Mode Toggle */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
              Mode
            </label>
            <div style={{ display: 'flex', gap: '8px', background: THEME.background, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}`, width: 'fit-content' }}>
              {(['stocks', 'earnings'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setScreenerMode(mode);
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: screenerMode === mode ? THEME.accent : 'transparent',
                    color: screenerMode === mode ? THEME.background : THEME.textSecondary,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                  }}
                >
                  {mode === 'stocks' ? 'Stock Screener' : 'Earnings Screener'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {/* Market Toggle - Only for Stock Screener */}
            {screenerMode === 'stocks' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                  Market
                </label>
                <div style={{ display: 'flex', gap: '8px', background: THEME.background, padding: '6px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
                  {(['india', 'us'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMarket(m)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: market === m ? THEME.accent : 'transparent',
                        color: market === m ? THEME.background : THEME.textSecondary,
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                        transition: 'all 0.2s',
                      }}
                    >
                      {m === 'us' ? 'US' : 'India'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sector Filter - Only for Stock Screener */}
            {screenerMode === 'stocks' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                  Sector
                </label>
                <select
                  value={selectedSector}
                  onChange={(e) => {
                    setSelectedSector(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: THEME.background,
                    color: THEME.textPrimary,
                    border: `1px solid ${THEME.border}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  {sectors.map((sector) => (
                    <option key={sector} value={sector}>
                      {sector}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort By */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: THEME.background,
                  color: THEME.textPrimary,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary, marginBottom: '8px', textTransform: 'uppercase' }}>
                Search
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: THEME.background, border: `1px solid ${THEME.border}`, borderRadius: '6px', padding: '8px 12px' }}>
                <Search size={16} color={THEME.textSecondary} />
                <input
                  type="text"
                  placeholder={screenerMode === 'stocks' ? 'Ticker or company name' : 'Symbol or company'}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    color: THEME.textPrimary,
                    fontSize: '12px',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Earnings Insight Checkbox — Stock Screener only */}
          {screenerMode === 'stocks' && (
            <div style={{ marginTop: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: showEarnings ? THEME.accent : THEME.textSecondary, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={showEarnings}
                  onChange={e => setShowEarnings(e.target.checked)}
                  style={{ accentColor: THEME.accent, width: '16px', height: '16px', cursor: 'pointer' }}
                />
                Earnings Intelligence
                {earningsLoading && <Loader size={14} color={THEME.accent} style={{ animation: 'spin 1s linear infinite' }} />}
                {showEarnings && !earningsLoading && earningsInsights.size > 0 && (
                  <span style={{ fontSize: '10px', color: THEME.textSecondary, fontWeight: 400 }}>
                    ({earningsInsights.size} loaded — fetches per page)
                  </span>
                )}
              </label>
            </div>
          )}

          {/* Results Count */}
          {!loading && (
            <div style={{ marginTop: '16px', fontSize: '12px', color: THEME.textSecondary }}>
              Showing {screenerMode === 'stocks' ? (displayedQuotes.length > 0 ? startIndex + 1 : 0) : (displayedEarnings.length > 0 ? startIndex + 1 : 0)} - {Math.min(startIndex + itemsPerPage, screenerMode === 'stocks' ? filteredQuotes.length : filteredEarnings.length)} of {screenerMode === 'stocks' ? filteredQuotes.length : filteredEarnings.length} results
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
            <Loader size={40} color={THEME.accent} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : !loading && screenerMode === 'stocks' && !data ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '400px', gap: '8px' }}>
            {error
              ? <>
                  <span style={{ fontSize: '28px' }}>⚠️</span>
                  <span style={{ color: THEME.red, fontWeight: 600 }}>API error — could not load stock data</span>
                  <span style={{ color: THEME.textSecondary, fontSize: '13px' }}>{error}</span>
                  <button onClick={fetchQuotesData} style={{ marginTop: '8px', padding: '8px 18px', borderRadius: '7px', border: `1px solid ${THEME.accent}`, background: 'transparent', color: THEME.accent, cursor: 'pointer', fontSize: '13px' }}>Retry</button>
                </>
              : <>
                  <span style={{ fontSize: '28px' }}>📊</span>
                  <span style={{ color: THEME.textSecondary }}>Loading stock data…</span>
                </>
            }
          </div>
        ) : !loading && screenerMode === 'earnings' && !earningsData ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '400px', gap: '8px' }}>
            {error
              ? <>
                  <span style={{ fontSize: '28px' }}>⚠️</span>
                  <span style={{ color: THEME.red, fontWeight: 600 }}>Failed to load earnings data</span>
                  <span style={{ color: THEME.textSecondary, fontSize: '13px' }}>{error}</span>
                  <button onClick={fetchEarningsData} style={{ marginTop: '8px', padding: '8px 18px', borderRadius: '7px', border: `1px solid ${THEME.accent}`, background: 'transparent', color: THEME.accent, cursor: 'pointer', fontSize: '13px' }}>Retry</button>
                </>
              : <>
                  <span style={{ fontSize: '28px' }}>📅</span>
                  <span style={{ color: THEME.textSecondary }}>Loading earnings data…</span>
                </>
            }
          </div>
        ) : screenerMode === 'stocks' && data ? (
          <>
            {/* Stock Screener Table */}
            <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: THEME.background, borderBottom: `1px solid ${THEME.border}` }}>
                      <th
                        onClick={() => handleSortClick('Name')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Name' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Company {sortBy === 'Name' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: THEME.textSecondary,
                        }}
                      >
                        Ticker
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: THEME.textSecondary,
                        }}
                      >
                        Sector
                      </th>
                      <th
                        onClick={() => handleSortClick('Price')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Price' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Price {sortBy === 'Price' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: THEME.textSecondary,
                        }}
                      >
                        Change
                      </th>
                      <th
                        onClick={() => handleSortClick('Change%')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Change%' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Change% {sortBy === 'Change%' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSortClick('Volume')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Volume' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Volume {sortBy === 'Volume' && (sortAscending ? '↑' : '↓')}
                      </th>
                      {showEarnings && (
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.accent, minWidth: '320px' }}>
                          Earnings Verdict
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedQuotes.length === 0 ? (
                      <tr>
                        <td colSpan={showEarnings ? 8 : 7} style={{ padding: '32px 16px', textAlign: 'center', color: THEME.textSecondary }}>
                          No results match your filters — try a different search or sector
                        </td>
                      </tr>
                    ) : (
                      displayedQuotes.map((quote) => (
                        <tr
                          key={quote.ticker}
                          style={{
                            borderBottom: `1px solid ${THEME.border}`,
                            transition: 'background 0.2s',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = THEME.cardHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                          }}
                        >
                          <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '600', color: THEME.textPrimary }}>
                            {quote.company}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.accent, fontWeight: '600' }}>
                            {quote.ticker}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.textSecondary }}>
                            {quote.sector}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textPrimary, fontWeight: '500' }}>
                            {quote.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td
                            style={{
                              padding: '12px 16px',
                              fontSize: '12px',
                              textAlign: 'right',
                              color: quote.change >= 0 ? THEME.green : THEME.red,
                              fontWeight: '500',
                            }}
                          >
                            {quote.change > 0 ? '+' : ''}
                            {quote.change.toFixed(2)}
                          </td>
                          <td
                            style={{
                              padding: '12px 16px',
                              fontSize: '12px',
                              textAlign: 'right',
                              color: quote.changePercent >= 0 ? THEME.green : THEME.red,
                              fontWeight: '600',
                            }}
                          >
                            {quote.changePercent > 0 ? '+' : ''}
                            {quote.changePercent.toFixed(2)}%
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textSecondary }}>
                            {(quote.volume / 1000000).toFixed(1)}M
                          </td>
                          {showEarnings && (() => {
                            const insight = earningsInsights.get(quote.ticker);
                            if (!insight) {
                              return (
                                <td style={{ padding: '12px 16px', fontSize: '11px', color: THEME.textSecondary, fontStyle: 'italic' }}>
                                  {earningsLoading ? '...' : '—'}
                                </td>
                              );
                            }
                            const v = generateVerdict(insight);
                            const clr = v.signal === 'green' ? THEME.green : v.signal === 'red' ? THEME.red : '#F59E0B';
                            return (
                              <td style={{ padding: '8px 16px', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                  <span style={{
                                    fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
                                    color: clr, padding: '1px 6px', borderRadius: '3px',
                                    backgroundColor: `${clr}18`, border: `1px solid ${clr}30`,
                                  }}>{v.label}</span>
                                  <span style={{ fontSize: '10px', color: '#C0CCD8', fontWeight: 500, lineHeight: '1.3' }}>{v.driver}</span>
                                </div>
                                <div style={{ fontSize: '9px', color: THEME.textSecondary, lineHeight: '1.3', fontStyle: 'italic' }}>
                                  {v.forward}
                                </div>
                              </td>
                            );
                          })()}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : screenerMode === 'earnings' && earningsData ? (
          <>
            {/* Earnings Screener Table */}
            <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: THEME.background, borderBottom: `1px solid ${THEME.border}` }}>
                      <th
                        onClick={() => handleSortClick('Name')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Name' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Company {sortBy === 'Name' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Symbol
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Quality
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Quarter
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Sector
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        Cap
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: THEME.textSecondary }}>
                        EDP
                      </th>
                      <th
                        onClick={() => handleSortClick('Price')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Price' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Price {sortBy === 'Price' && (sortAscending ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSortClick('Change%')}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: sortBy === 'Change%' ? THEME.accent : THEME.textSecondary,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'color 0.2s',
                        }}
                      >
                        Move% {sortBy === 'Change%' && (sortAscending ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedEarnings.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: '32px 16px', textAlign: 'center', color: THEME.textSecondary }}>
                          No earnings data found
                        </td>
                      </tr>
                    ) : (
                      displayedEarnings.map((earning) => (
                        <tr
                          key={earning.symbol}
                          style={{
                            borderBottom: `1px solid ${THEME.border}`,
                            transition: 'background 0.2s',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = THEME.cardHover;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                          }}
                        >
                          <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '600', color: THEME.textPrimary }}>
                            {earning.company}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.accent, fontWeight: '600' }}>
                            {earning.symbol}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                              backgroundColor: earning.quality === 'Excellent' ? 'rgba(16,185,129,0.3)' : earning.quality === 'Great' ? 'rgba(16,185,129,0.2)' : earning.quality === 'Good' ? 'rgba(59,130,246,0.2)' : earning.quality === 'OK' ? 'rgba(251,191,36,0.2)' : 'rgba(239,68,68,0.2)',
                              color: earning.quality === 'Excellent' ? '#34d399' : earning.quality === 'Great' ? '#6ee7b7' : earning.quality === 'Good' ? '#93c5fd' : earning.quality === 'OK' ? '#fbbf24' : '#fca5a5',
                            }}>
                              {earning.quality}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: THEME.textSecondary }}>
                            {earning.quarter}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'left', color: THEME.textSecondary }}>
                            {earning.sector}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'center', color: THEME.textSecondary }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                              backgroundColor: earning.marketCap === 'Large' ? 'rgba(15,122,191,0.2)' : earning.marketCap === 'Mid' ? 'rgba(16,185,129,0.2)' : earning.marketCap === 'Small' ? 'rgba(251,191,36,0.2)' : 'rgba(139,92,246,0.2)',
                              color: earning.marketCap === 'Large' ? '#60a5fa' : earning.marketCap === 'Mid' ? '#6ee7b7' : earning.marketCap === 'Small' ? '#fbbf24' : '#c4b5fd',
                            }}>
                              {earning.marketCap}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textSecondary }}>
                            {earning.edp ? `₹${earning.edp.toFixed(2)}` : '-'}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: THEME.textPrimary, fontWeight: '500' }}>
                            {earning.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td
                            style={{
                              padding: '12px 16px',
                              fontSize: '12px',
                              textAlign: 'right',
                              color: earning.movePercent >= 0 ? THEME.green : THEME.red,
                              fontWeight: '600',
                            }}
                          >
                            {earning.movePercent > 0 ? '+' : ''}
                            {earning.movePercent.toFixed(2)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              style={{
                padding: '8px 12px',
                background: currentPage === 1 ? THEME.border : THEME.accent,
                color: THEME.background,
                border: 'none',
                borderRadius: '6px',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                opacity: currentPage === 1 ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
            >
              Previous
            </button>

            {(() => {
              // Build page button list: first, ...ellipsis, sliding window of 3, ...ellipsis, last
              const pages: (number | '...')[] = [];
              if (totalPages <= 7) {
                for (let p = 1; p <= totalPages; p++) pages.push(p);
              } else {
                pages.push(1);
                const start = Math.max(2, currentPage - 1);
                const end   = Math.min(totalPages - 1, currentPage + 1);
                if (start > 2) pages.push('...');
                for (let p = start; p <= end; p++) pages.push(p);
                if (end < totalPages - 1) pages.push('...');
                pages.push(totalPages);
              }
              return pages.map((p, i) => p === '...'
                ? <span key={`ellipsis-${i}`} style={{ padding: '8px 4px', color: THEME.textSecondary, fontSize: '12px' }}>…</span>
                : <button key={p} onClick={() => setCurrentPage(p as number)} style={{
                    padding: '8px 12px', background: currentPage === p ? THEME.accent : THEME.card,
                    color: currentPage === p ? THEME.background : THEME.textSecondary,
                    border: `1px solid ${THEME.border}`, borderRadius: '6px', cursor: 'pointer',
                    fontSize: '12px', fontWeight: currentPage === p ? '600' : '400', transition: 'all 0.2s',
                  }}>{p}</button>
              );
            })()}

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              style={{
                padding: '8px 12px',
                background: currentPage === totalPages ? THEME.border : THEME.accent,
                color: THEME.background,
                border: 'none',
                borderRadius: '6px',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                opacity: currentPage === totalPages ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
            >
              Next
            </button>
          </div>
        )}

        {/* Last Updated */}
        {(data || earningsData) && (
          <div style={{ textAlign: 'center', fontSize: '11px', color: THEME.textSecondary }}>
            Last updated: {new Date(screenerMode === 'stocks' ? (data?.updatedAt || '') : (earningsData?.updatedAt || '')).toLocaleTimeString()}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
