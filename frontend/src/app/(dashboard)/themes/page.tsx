'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import api from '@/lib/api';
import TickerDrawer from '@/components/TickerDrawer';

// ── Static theme definitions ──────────────────────────────────────────────────

const THEMES = [
  {
    id: 'AI_INFRA',
    label: 'AI Infrastructure',
    emoji: '🤖',
    description: 'Data centers, GPU compute, networking, power for AI workloads',
    color: 'from-blue-600/20 to-cyan-600/20',
    border: 'border-blue-500/30',
    tickers: [
      { ticker: 'NVDA',  exchange: 'NASDAQ', name: 'NVIDIA' },
      { ticker: 'AMD',   exchange: 'NASDAQ', name: 'Advanced Micro Devices' },
      { ticker: 'SMCI',  exchange: 'NASDAQ', name: 'Super Micro Computer' },
      { ticker: 'DELL',  exchange: 'NYSE',   name: 'Dell Technologies' },
      { ticker: 'VRT',   exchange: 'NYSE',   name: 'Vertiv Holdings' },
      { ticker: 'ANET',  exchange: 'NYSE',   name: 'Arista Networks' },
    ],
    etfs: ['QQQ', 'SMH', 'BOTZ'],
  },
  {
    id: 'SEMICONDUCTORS',
    label: 'Semiconductors',
    emoji: '💾',
    description: 'Chip designers, fabs, EDA tools, materials and equipment',
    color: 'from-violet-600/20 to-purple-600/20',
    border: 'border-violet-500/30',
    tickers: [
      { ticker: 'TSM',  exchange: 'NYSE',   name: 'TSMC' },
      { ticker: 'ASML', exchange: 'NASDAQ', name: 'ASML Holding' },
      { ticker: 'AVGO', exchange: 'NASDAQ', name: 'Broadcom' },
      { ticker: 'MU',   exchange: 'NASDAQ', name: 'Micron Technology' },
      { ticker: 'LRCX', exchange: 'NASDAQ', name: 'Lam Research' },
    ],
    etfs: ['SMH', 'SOXX'],
  },
  {
    id: 'DEFENSE',
    label: 'Defense & Aerospace',
    emoji: '🛡️',
    description: 'Defense primes, drones, missile systems, India defense',
    color: 'from-green-700/20 to-emerald-600/20',
    border: 'border-green-500/30',
    tickers: [
      { ticker: 'LMT',  exchange: 'NYSE', name: 'Lockheed Martin' },
      { ticker: 'RTX',  exchange: 'NYSE', name: 'Raytheon Technologies' },
      { ticker: 'NOC',  exchange: 'NYSE', name: 'Northrop Grumman' },
      { ticker: 'HAL',  exchange: 'NSE',  name: 'Hindustan Aeronautics' },
      { ticker: 'BDL',  exchange: 'NSE',  name: 'Bharat Dynamics' },
      { ticker: 'MTAR', exchange: 'NSE',  name: 'MTAR Technologies' },
    ],
    etfs: ['ITA', 'XAR'],
  },
  {
    id: 'NUCLEAR',
    label: 'Nuclear Energy',
    emoji: '⚛️',
    description: 'Uranium miners, reactor builders, SMR developers',
    color: 'from-yellow-600/20 to-orange-600/20',
    border: 'border-yellow-500/30',
    tickers: [
      { ticker: 'CCJ', exchange: 'NYSE',   name: 'Cameco Corp' },
      { ticker: 'UEC', exchange: 'NYSE',   name: 'Uranium Energy Corp' },
      { ticker: 'NNE', exchange: 'NYSE',   name: 'Nano Nuclear Energy' },
      { ticker: 'SMR', exchange: 'NYSE',   name: 'NuScale Power' },
      { ticker: 'CEG', exchange: 'NASDAQ', name: 'Constellation Energy' },
    ],
    etfs: ['URA', 'URNM'],
  },
  {
    id: 'SPACE',
    label: 'Space Economy',
    emoji: '🚀',
    description: 'Launch providers, satellite operators, space tech',
    color: 'from-indigo-600/20 to-blue-800/20',
    border: 'border-indigo-500/30',
    tickers: [
      { ticker: 'RKLB', exchange: 'NASDAQ', name: 'Rocket Lab USA' },
      { ticker: 'ASTS', exchange: 'NASDAQ', name: 'AST SpaceMobile' },
      { ticker: 'PL',   exchange: 'NYSE',   name: 'Planet Labs' },
      { ticker: 'SPCE', exchange: 'NYSE',   name: 'Virgin Galactic' },
    ],
    etfs: ['UFO', 'ARKX'],
  },
  {
    id: 'GRID_TECH',
    label: 'Grid Technology',
    emoji: '⚡',
    description: 'Power grid modernization, energy storage, transformers',
    color: 'from-amber-600/20 to-yellow-600/20',
    border: 'border-amber-500/30',
    tickers: [
      { ticker: 'ETN',       exchange: 'NYSE',   name: 'Eaton Corporation' },
      { ticker: 'ABB',       exchange: 'NYSE',   name: 'ABB Ltd' },
      { ticker: 'FLNC',      exchange: 'NASDAQ', name: 'Fluence Energy' },
      { ticker: 'AMSC',      exchange: 'NASDAQ', name: 'American Superconductor' },
      { ticker: 'POWERGRID', exchange: 'NSE',    name: 'Power Grid Corp India' },
    ],
    etfs: ['GRID', 'ICLN'],
  },
];

// Split tickers by market to avoid backend confusion between US and India quotes
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const US_TICKERS = THEMES.flatMap(t =>
  t.tickers.filter(tk => US_EXCHANGES.has(tk.exchange)).map(tk => ({ ticker: tk.ticker, exchange: tk.exchange }))
);
const IN_TICKERS = THEMES.flatMap(t =>
  t.tickers.filter(tk => !US_EXCHANGES.has(tk.exchange)).map(tk => ({ ticker: tk.ticker, exchange: tk.exchange }))
);

// ── Types ──────────────────────────────────────────────────────────────────────

interface QuoteEntry { price?: number; change_pct?: number; currency?: string }
type QuoteMap = Record<string, QuoteEntry>;

// Helper: normalize API response to QuoteMap
function normalizeQuoteResponse(data: unknown): QuoteMap {
  if (!data) return {};
  if (Array.isArray(data)) {
    const map: QuoteMap = {};
    (data as Array<{ ticker?: string; price?: number; change_pct?: number; currency?: string }>).forEach(quote => {
      if (quote?.ticker) map[quote.ticker] = quote;
    });
    return map;
  }
  return (typeof data === 'object') ? data as QuoteMap : {};
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useThemeQuotes() {
  return useQuery<QuoteMap>({
    queryKey: ['themes', 'quotes'],
    queryFn: async () => {
      // Run US and India quote fetches in parallel (different market endpoints)
      const results = await Promise.allSettled([
        US_TICKERS.length > 0 ? api.post('/market/quotes', US_TICKERS) : Promise.resolve({ data: {} }),
        IN_TICKERS.length > 0 ? api.post('/market/quotes', IN_TICKERS) : Promise.resolve({ data: {} }),
      ]);

      const merged: QuoteMap = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const part = normalizeQuoteResponse(r.value.data);
          Object.assign(merged, part);
        }
      }
      return merged;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
}

// ── Components ────────────────────────────────────────────────────────────────

function TickerCard({
  ticker, exchange, name, quote, loading, onClick,
}: {
  ticker: string; exchange: string; name: string;
  quote?: QuoteEntry; loading: boolean; onClick: () => void;
}) {
  const hasRealData = (quote?.price ?? 0) > 0;
  const pct = hasRealData ? (quote?.change_pct ?? null) : null;
  const up  = (pct ?? 0) >= 0;
  return (
    <button
      onClick={onClick}
      className="bg-[#0D1B2E]/60 rounded-lg p-3 border border-white/10 hover:border-[#0F7ABF]/50 transition-colors cursor-pointer text-left w-full"
    >
      <div className="font-bold text-white text-sm">{ticker}</div>
      <div className="text-[#8899AA] text-[10px] truncate">{name}</div>
      {loading ? (
        <div className="mt-1 h-4 rounded bg-white/10 animate-pulse" />
      ) : pct != null ? (
        <div className={`text-sm font-semibold mt-1 flex items-center gap-0.5 ${up ? 'text-green-400' : 'text-red-400'}`}>
          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {up ? '+' : ''}{pct.toFixed(2)}%
        </div>
      ) : (
        <div className="text-[#4A5B6C] text-xs mt-1" title="Live price unavailable">—</div>
      )}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ThemesPage() {
  const searchParams = useSearchParams();
  const [active, setActive] = useState<string | null>(null);
  const [drawerTicker, setDrawerTicker] = useState<{ symbol: string; exchange: string } | null>(null);
  const { data: quotes, isLoading: quotesLoading, isError: quotesError } = useThemeQuotes();

  // Auto-select theme and open drawer if ticker parameter is present
  useEffect(() => {
    const tickerParam = searchParams?.get('ticker');
    if (tickerParam) {
      // Find the theme that contains this ticker
      const themeWithTicker = THEMES.find(theme =>
        theme.tickers.some(t => t.ticker === tickerParam.toUpperCase())
      );
      if (themeWithTicker) {
        setActive(themeWithTicker.id);
        // Find the ticker details
        const tickerInfo = themeWithTicker.tickers.find(t => t.ticker === tickerParam.toUpperCase());
        if (tickerInfo) {
          setDrawerTicker({ symbol: tickerInfo.ticker, exchange: tickerInfo.exchange });
        }
      }
    }
  }, [searchParams]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Thematic Dashboards</h1>
        <p className="text-[#8899AA] text-sm mt-1">
          Pre-built baskets for your focus themes. Click a theme to expand; click any ticker for details.
          {quotesLoading && <span className="ml-2 text-[#4A5B6C] text-xs animate-pulse">Loading live prices…</span>}
          {quotesError && <span className="ml-2 text-amber-500/80 text-xs">⚠ Live prices unavailable — showing tickers only</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {THEMES.map(theme => {
          const isActive = active === theme.id;
          const colSpanClass = isActive ? 'md:col-span-2 xl:col-span-3' : '';

          // Only count tickers that have real price data (price > 0)
          const liveQuotes = theme.tickers
            .map(t => quotes?.[t.ticker])
            .filter((q): q is QuoteEntry => q != null && (q.price ?? 0) > 0);
          const livePcts = liveQuotes
            .map(q => q.change_pct)
            .filter((p): p is number => p != null);
          const avgChange = livePcts.length > 0
            ? livePcts.reduce((s, p) => s + p, 0) / livePcts.length
            : null;
          const themeUp = livePcts.filter(p => p >= 0).length;

          return (
            <div
              key={theme.id}
              className={`bg-gradient-to-br ${theme.color} border ${theme.border} rounded-xl transition-all duration-200 ${colSpanClass}`}
            >
              <button
                className="w-full p-5 text-left"
                onClick={() => setActive(isActive ? null : theme.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{theme.emoji}</span>
                    <div>
                      <h2 className="text-white font-semibold">{theme.label}</h2>
                      <p className="text-[#8899AA] text-xs mt-0.5">{theme.description}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    {quotesLoading ? (
                      <>
                        <div className="h-5 w-16 rounded bg-white/10 animate-pulse mb-1" />
                        <div className="h-3 w-12 rounded bg-white/5 animate-pulse" />
                      </>
                    ) : avgChange != null ? (
                      <>
                        <div className={`text-sm font-bold ${avgChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}% avg
                        </div>
                        <div className="text-[#4A5B6C] text-xs">
                          {livePcts.length > 0
                            ? `${themeUp}/${theme.tickers.length} up`
                            : `${theme.tickers.length} tickers`}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[#4A5B6C] text-sm">— avg</div>
                        <div className="text-[#4A5B6C] text-xs">
                          {theme.tickers.length} tickers
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </button>

              {isActive && (
                <div className="px-5 pb-5 border-t border-white/10">
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
                    {theme.tickers.map(t => (
                      <TickerCard
                        key={t.ticker}
                        ticker={t.ticker}
                        exchange={t.exchange}
                        name={t.name}
                        quote={quotes?.[t.ticker]}
                        loading={quotesLoading}
                        onClick={() => setDrawerTicker({ symbol: t.ticker, exchange: t.exchange })}
                      />
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-[#4A5B6C] text-xs">Related ETFs:</span>
                    {theme.etfs.map(etf => (
                      <a
                        key={etf}
                        href={`https://finance.yahoo.com/quote/${etf}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[#0F7ABF] hover:text-[#38A9E8] transition-colors"
                      >
                        {etf} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Ticker drilldown drawer */}
      {drawerTicker && (
        <TickerDrawer
          symbol={drawerTicker.symbol}
          exchange={drawerTicker.exchange}
          onClose={() => setDrawerTicker(null)}
        />
      )}
    </div>
  );
}
