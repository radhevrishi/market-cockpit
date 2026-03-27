'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'

interface SearchResult {
  ticker: string
  name: string
  price: number
  change_pct: number
  exchange: string
}

// Extensive ticker index for instant search (no API call needed)
const TICKER_INDEX = [
  // India - Large Cap
  { ticker: 'RELIANCE', exchange: 'NSE', name: 'Reliance Industries' },
  { ticker: 'TCS', exchange: 'NSE', name: 'Tata Consultancy Services' },
  { ticker: 'HDFCBANK', exchange: 'NSE', name: 'HDFC Bank' },
  { ticker: 'INFY', exchange: 'NSE', name: 'Infosys' },
  { ticker: 'ICICIBANK', exchange: 'NSE', name: 'ICICI Bank' },
  { ticker: 'WIPRO', exchange: 'NSE', name: 'Wipro' },
  { ticker: 'BAJFINANCE', exchange: 'NSE', name: 'Bajaj Finance' },
  { ticker: 'TATAMOTORS', exchange: 'NSE', name: 'Tata Motors' },
  { ticker: 'SUNPHARMA', exchange: 'NSE', name: 'Sun Pharmaceutical' },
  { ticker: 'ADANIENT', exchange: 'NSE', name: 'Adani Enterprises' },
  { ticker: 'SBIN', exchange: 'NSE', name: 'State Bank of India' },
  { ticker: 'AXISBANK', exchange: 'NSE', name: 'Axis Bank' },
  { ticker: 'KOTAKBANK', exchange: 'NSE', name: 'Kotak Mahindra Bank' },
  { ticker: 'HAL', exchange: 'NSE', name: 'Hindustan Aeronautics' },
  { ticker: 'BEL', exchange: 'NSE', name: 'Bharat Electronics' },
  { ticker: 'NTPC', exchange: 'NSE', name: 'NTPC' },
  { ticker: 'ONGC', exchange: 'NSE', name: 'Oil & Natural Gas Corp' },
  { ticker: 'MARUTI', exchange: 'NSE', name: 'Maruti Suzuki' },
  { ticker: 'HCLTECH', exchange: 'NSE', name: 'HCL Technologies' },
  { ticker: 'ITC', exchange: 'NSE', name: 'ITC Ltd' },
  { ticker: 'LT', exchange: 'NSE', name: 'Larsen & Toubro' },
  { ticker: 'POWERGRID', exchange: 'NSE', name: 'Power Grid Corp' },
  // US - Mega Cap
  { ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple Inc.' },
  { ticker: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft' },
  { ticker: 'GOOGL', exchange: 'NASDAQ', name: 'Alphabet (Google)' },
  { ticker: 'AMZN', exchange: 'NASDAQ', name: 'Amazon' },
  { ticker: 'NVDA', exchange: 'NASDAQ', name: 'NVIDIA' },
  { ticker: 'META', exchange: 'NASDAQ', name: 'Meta Platforms' },
  { ticker: 'TSLA', exchange: 'NASDAQ', name: 'Tesla' },
  { ticker: 'AMD', exchange: 'NASDAQ', name: 'Advanced Micro Devices' },
  { ticker: 'NFLX', exchange: 'NASDAQ', name: 'Netflix' },
  { ticker: 'INTC', exchange: 'NASDAQ', name: 'Intel' },
  { ticker: 'JPM', exchange: 'NYSE', name: 'JPMorgan Chase' },
  { ticker: 'BAC', exchange: 'NYSE', name: 'Bank of America' },
  { ticker: 'V', exchange: 'NYSE', name: 'Visa Inc.' },
  { ticker: 'WMT', exchange: 'NYSE', name: 'Walmart' },
  { ticker: 'DIS', exchange: 'NYSE', name: 'Walt Disney' },
  { ticker: 'CRM', exchange: 'NYSE', name: 'Salesforce' },
  { ticker: 'ORCL', exchange: 'NYSE', name: 'Oracle' },
  { ticker: 'AVGO', exchange: 'NASDAQ', name: 'Broadcom' },
  { ticker: 'ASML', exchange: 'NASDAQ', name: 'ASML Holding' },
  { ticker: 'TSM', exchange: 'NYSE', name: 'TSMC' },
]
const POPULAR_TICKERS = TICKER_INDEX.slice(0, 8)

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // const router = useRouter()  // Replaced with custom events
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setResults([])
      setSelected(0)
    }
  }, [open])

  // Search with debounce - first check local index, then try API
  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    const ticker = q.trim().toUpperCase()
    
    // Instant local search first
    const localMatches = TICKER_INDEX.filter(t => 
      t.ticker.includes(ticker) || t.name.toUpperCase().includes(ticker)
    ).slice(0, 5).map(t => ({
      ticker: t.ticker,
      name: t.name,
      price: 0,
      change_pct: 0,
      exchange: t.exchange,
    }))
    
    // Show local matches immediately (no loading spinner)
    if (localMatches.length > 0) {
      setResults(localMatches)
    }
    
    // Then try API to get live prices (in background)
    setLoading(true)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)
      const exchanges = ['NASDAQ', 'NYSE', 'NSE', 'BSE']
      for (const exchange of exchanges) {
        try {
          const { data } = await api.get(`/market/quote/${ticker}?exchange=${exchange}`, { signal: controller.signal })
          // Only accept result if we have real price data (price > 0)
          if (data && data.price > 0) {
            clearTimeout(timeout)
            setResults([{
              ticker: data.ticker || ticker,
              name: data.name || ticker,
              price: data.price || 0,
              change_pct: data.change_pct || 0,
              exchange: data.exchange || exchange,
            }])
            setLoading(false)
            return
          }
        } catch {
          continue
        }
      }
      clearTimeout(timeout)
    } catch {
      // API failed - local results are already showing
    }
    // If no API results, ensure we have at least the local or manual result
    // Use local index lookup for exchange, or default to NASDAQ for unknown US tickers
    if (localMatches.length === 0) {
      const localMatch = TICKER_INDEX.find(t => t.ticker === ticker)
      const defaultExchange = localMatch ? localMatch.exchange : 'NASDAQ'
      setResults([{ ticker, name: ticker, price: 0, change_pct: 0, exchange: defaultExchange }])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query) {
      debounceRef.current = setTimeout(() => search(query), 300)
    } else {
      setResults([])
    }
    return () => clearTimeout(debounceRef.current)
  }, [query, search])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = results.length ? results : []
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && items[selected]) {
      window.dispatchEvent(new CustomEvent('openTicker', { detail: { symbol: items[selected].ticker, exchange: items[selected].exchange } }));
      setOpen(false)
    }
  }

  if (!open) return null

  const displayItems = query ? results : POPULAR_TICKERS.map(p => ({ ...p, price: 0, change_pct: 0 }))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <svg className="w-5 h-5 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search ticker symbol (e.g. RELIANCE, AAPL, TCS)…"
            className="flex-1 bg-transparent text-white placeholder-white/30 outline-none text-sm"
          />
          {loading && <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />}
          <kbd className="text-xs text-white/30 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {displayItems.length === 0 && query && !loading && (
            <div className="px-4 py-6 text-center text-white/30 text-sm">No results for "{query}"</div>
          )}
          {!query && (
            <div className="px-4 pt-3 pb-1 text-xs text-white/30 uppercase tracking-widest">Popular</div>
          )}
          {displayItems.map((item, i) => (
            <div
              key={item.ticker}
              className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                i === selected ? 'bg-blue-500/20' : 'hover:bg-white/5'
              }`}
              onClick={() => { window.dispatchEvent(new CustomEvent('openTicker', { detail: { symbol: item.ticker, exchange: item.exchange } })); setOpen(false) }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold text-white">
                  {item.ticker.slice(0, 2)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{item.ticker}</div>
                  <div className="text-xs text-white/40">{item.name} · {item.exchange}</div>
                </div>
              </div>
              {(item as SearchResult).price > 0 && (
                <div className="text-right">
                  <div className="text-sm font-medium text-white">
                    {(item as SearchResult).price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </div>
                  <div className={`text-xs ${(item as SearchResult).change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(item as SearchResult).change_pct >= 0 ? '+' : ''}{(item as SearchResult).change_pct?.toFixed(2)}%
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-white/5 flex gap-3 text-xs text-white/25">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  )
}
