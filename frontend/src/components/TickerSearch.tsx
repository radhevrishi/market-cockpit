'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

export interface TickerSuggestion {
  ticker: string;
  company: string;
  sector: string;
  price: number;
  changePercent: number;
}

interface TickerSearchProps {
  /** Called when user selects a ticker or presses Enter */
  onSelect: (ticker: string, suggestion?: TickerSuggestion) => void;
  /** Existing quotes loaded on the page (used for instant search) */
  quotes?: TickerSuggestion[];
  /** Tickers already in the list (shown as "already added") */
  existingTickers?: string[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether bulk paste mode is also supported */
  allowBulk?: boolean;
  /** Auto-clear on select */
  clearOnSelect?: boolean;
}

/* ── Component ─────────────────────────────────────────── */

export default function TickerSearch({
  onSelect,
  quotes = [],
  existingTickers = [],
  placeholder = 'Search by company name or ticker...',
  allowBulk = false,
  clearOnSelect = true,
}: TickerSearchProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [apiResults, setApiResults] = useState<TickerSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const existingSet = useMemo(() => new Set(existingTickers), [existingTickers]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Search through loaded quotes + API fallback
  const handleSearch = useCallback((q: string) => {
    const term = q.trim().toUpperCase();
    if (term.length < 1) { setSuggestions([]); setShowDropdown(false); return; }

    // If it looks like bulk paste (has commas/newlines), don't show autocomplete
    if (allowBulk && (term.includes(',') || term.includes('\n'))) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    // Step 1: Filter from existing quotes (instant)
    const localMatches = quotes.filter(q =>
      q.ticker.toUpperCase().includes(term) ||
      q.company.toUpperCase().includes(term)
    )
      .sort((a, b) => {
        // Exact ticker match first
        if (a.ticker.toUpperCase() === term) return -1;
        if (b.ticker.toUpperCase() === term) return 1;
        // Starts-with ticker second
        if (a.ticker.toUpperCase().startsWith(term) && !b.ticker.toUpperCase().startsWith(term)) return -1;
        if (b.ticker.toUpperCase().startsWith(term) && !a.ticker.toUpperCase().startsWith(term)) return 1;
        // Then by company name match
        return a.ticker.localeCompare(b.ticker);
      })
      .slice(0, 8);

    // Merge local + any previous API results
    const merged = [...localMatches];
    for (const r of apiResults) {
      if (!merged.find(m => m.ticker === r.ticker)) merged.push(r);
    }

    setSuggestions(merged.slice(0, 10));
    setShowDropdown(merged.length > 0 || term.length >= 2);
    setSelectedIdx(-1);

    // Step 2: If fewer than 3 local matches and term >= 2 chars, query API
    if (localMatches.length < 3 && term.length >= 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        // Abort any in-flight request to prevent stale results overwriting fresh ones
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setSearching(true);
        try {
          const res = await fetch(`/api/market/quote?symbols=${encodeURIComponent(term)}`, { signal: controller.signal });
          if (res.ok) {
            const data = await res.json();
            const apiSugs: TickerSuggestion[] = (data.stocks || []).map((s: any) => ({
              ticker: s.ticker,
              company: s.company || s.ticker,
              sector: s.sector || '—',
              price: s.price || 0,
              changePercent: s.changePercent || 0,
            }));
            setApiResults(apiSugs);
            // Merge with local
            const newMerged = [...localMatches];
            for (const r of apiSugs) {
              if (!newMerged.find(m => m.ticker === r.ticker)) newMerged.push(r);
            }
            setSuggestions(newMerged.slice(0, 10));
            if (newMerged.length > 0) setShowDropdown(true);
          }
        } catch (e: any) {
          if (e?.name !== 'AbortError') console.error('Search API error:', e);
        } finally { setSearching(false); }
      }, 400);
    }
  }, [quotes, apiResults, allowBulk]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    handleSearch(val);
  };

  const handleSelectSuggestion = (sug: TickerSuggestion) => {
    onSelect(sug.ticker, sug);
    if (clearOnSelect) setQuery('');
    setShowDropdown(false);
    setSelectedIdx(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
        handleSelectSuggestion(suggestions[selectedIdx]);
      } else if (query.trim()) {
        // Submit raw input (for bulk paste or direct ticker entry)
        onSelect(query.trim().toUpperCase());
        if (clearOnSelect) setQuery('');
        setShowDropdown(false);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSelectedIdx(-1);
    }
  };

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <div style={{ position: 'relative' }}>
        <Search style={{
          position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
          width: '16px', height: '16px', color: '#4A5B6C', pointerEvents: 'none',
        }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim().length >= 1 && suggestions.length > 0) setShowDropdown(true); }}
          placeholder={placeholder}
          style={{
            width: '100%',
            backgroundColor: '#1A2B3C',
            border: '1px solid #2A3B4C',
            borderRadius: '10px',
            padding: '12px 16px 12px 38px',
            color: '#F5F7FA',
            fontSize: '14px',
            outline: 'none',
            transition: 'all 0.2s',
            boxSizing: 'border-box',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#3B82F6'}
          onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = '#2A3B4C'; }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setSuggestions([]); setShowDropdown(false); inputRef.current?.focus(); }}
            style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', padding: '4px' }}>
            <X style={{ width: '14px', height: '14px' }} />
          </button>
        )}
      </div>

      {/* ── Dropdown ─────────────────────────────────── */}
      {showDropdown && (
        <div ref={dropdownRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          backgroundColor: '#0D1B2E', border: '1px solid #2A3B4C', borderRadius: '10px',
          marginTop: '4px', maxHeight: '320px', overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {suggestions.length > 0 ? suggestions.map((sug, idx) => {
            const isExisting = existingSet.has(sug.ticker);
            const isSelected = idx === selectedIdx;
            return (
              <div
                key={sug.ticker}
                onClick={() => !isExisting && handleSelectSuggestion(sug)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', cursor: isExisting ? 'default' : 'pointer',
                  backgroundColor: isSelected ? '#1A2B3C' : 'transparent',
                  borderBottom: idx < suggestions.length - 1 ? '1px solid #1A2540' : 'none',
                  transition: 'background-color 0.15s',
                  opacity: isExisting ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (!isExisting) { e.currentTarget.style.backgroundColor = '#1A2B3C'; setSelectedIdx(idx); } }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#3B82F6' }}>{sug.ticker}</span>
                    {isExisting && (
                      <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '3px', backgroundColor: '#4A5B6C20', color: '#4A5B6C', fontWeight: 600 }}>ADDED</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#8BA3C1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sug.company}
                    {sug.sector !== '—' && <span style={{ color: '#4A5B6C' }}> · {sug.sector}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', marginLeft: '12px', flexShrink: 0 }}>
                  {sug.price > 0 ? (
                    <>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#F5F7FA', fontVariantNumeric: 'tabular-nums' }}>
                        ₹{sug.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </div>
                      <div style={{
                        fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                        color: sug.changePercent >= 0 ? '#10B981' : '#EF4444',
                      }}>
                        {sug.changePercent >= 0 ? '+' : ''}{sug.changePercent.toFixed(2)}%
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#4A5B6C' }}>—</div>
                  )}
                </div>
              </div>
            );
          }) : (
            <div style={{ padding: '16px', textAlign: 'center', color: '#4A5B6C', fontSize: '13px' }}>
              {searching ? 'Searching...' : query.trim().length >= 2 ? 'No matches found. Press Enter to add manually.' : 'Type at least 2 characters...'}
            </div>
          )}
          {allowBulk && suggestions.length > 0 && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid #1A2540', fontSize: '11px', color: '#4A5B6C', textAlign: 'center' }}>
              Tip: Paste comma-separated tickers for bulk add
            </div>
          )}
        </div>
      )}
    </div>
  );
}
