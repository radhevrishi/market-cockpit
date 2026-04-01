'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown, RefreshCw, Download, ArrowUpDown, Edit3, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import TickerSearch, { type TickerSuggestion } from '@/components/TickerSearch';
import { normalizeTicker } from '@/lib/tickers';

/* ── Types ──────────────────────────────────────────────────────────── */

interface StockQuote {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
}

interface PortfolioHolding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  addedAt: string;
  notes?: string;
}

interface Signal {
  symbol: string;
  weightedScore: number;
  action: string; // BUY | ADD | HOLD | TRIM | EXIT | AVOID
  sectorTrend: string; // Bullish | Neutral | Bearish
}

interface PortfolioRow {
  symbol: string;
  company: string;
  sector: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  cmp: number;
  change: number;
  changePercent: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  dayPnl: number;
  notes?: string;
  score?: number;
  sectorTrend?: string;
  decision?: string;
}

type SortField = 'symbol' | 'company' | 'sector' | 'entryPrice' | 'quantity' | 'cmp' | 'changePercent' | 'pnlPercent' | 'weight' | 'investedValue' | 'currentValue' | 'score' | 'decision';
type SortOrder = 'asc' | 'desc';

/* ── Constants ─────────────────────────────────────────────────────── */

const CHAT_ID = '5057319640';
const SECRET = 'mc-bot-2026';
const STORAGE_KEY = 'mc_portfolio_holdings';

/* ── Helpers ───────────────────────────────────────────────────────── */

const getStoredHoldings = (): PortfolioHolding[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
};

const setStoredHoldings = (h: PortfolioHolding[]) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); } catch {}
};

const fetchStockQuotes = async (): Promise<StockQuote[]> => {
  try {
    const res = await fetch('/api/market/quotes?market=india');
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    return (data.stocks || []).map((s: any) => ({
      ticker: s.ticker, company: s.company || s.ticker, sector: s.sector || '—',
      industry: s.industry || '—', price: s.price || 0, change: s.change || 0,
      changePercent: s.changePercent || 0, dayHigh: s.dayHigh || s.price || 0,
      dayLow: s.dayLow || s.price || 0,
    }));
  } catch { return []; }
};

const fetchIndividualQuotes = async (symbols: string[]): Promise<StockQuote[]> => {
  if (symbols.length === 0) return [];
  try {
    const results: StockQuote[] = [];
    for (let i = 0; i < symbols.length; i += 20) {
      const batch = symbols.slice(i, i + 20);
      // Normalize tickers and URL-encode them to handle special chars like &
      const normalizedBatch = batch.map(s => encodeURIComponent(normalizeTicker(s)));
      const res = await fetch(`/api/market/quote?symbols=${normalizedBatch.join(',')}`);
      if (!res.ok) continue;
      const data = await res.json();
      results.push(...(data.stocks || []).map((s: any) => ({
        ticker: s.ticker, company: s.company || s.ticker, sector: s.sector || '—',
        industry: s.industry || '—', price: s.price || 0, change: s.change || 0,
        changePercent: s.changePercent || 0, dayHigh: s.dayHigh || s.price || 0,
        dayLow: s.dayLow || s.price || 0,
      })));
    }
    return results;
  } catch { return []; }
};

const fmt = (n: number) => n >= 10000000 ? `${(n / 10000000).toFixed(2)} Cr` : n >= 100000 ? `${(n / 100000).toFixed(2)} L` : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/* ── Summary Cards ─────────────────────────────────────────────────── */

function PortfolioSummary({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) return null;

  const totalInvested = rows.reduce((s, r) => s + r.investedValue, 0);
  const totalCurrent = rows.reduce((s, r) => s + r.currentValue, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);
  const gainers = rows.filter(r => r.cmp > 0 && r.pnl > 0).length;
  const losers = rows.filter(r => r.cmp > 0 && r.pnl < 0).length;
  const noData = rows.filter(r => r.cmp === 0).length;

  const best = rows.length > 0 ? rows.reduce((a, b) => a.pnlPercent > b.pnlPercent ? a : b) : null;
  const worst = rows.length > 0 ? rows.reduce((a, b) => a.pnlPercent < b.pnlPercent ? a : b) : null;

  const cards = [
    { label: 'INVESTED VALUE', value: fmt(totalInvested), color: '#F5F7FA' },
    { label: 'CURRENT VALUE', value: fmt(totalCurrent), color: '#F5F7FA' },
    { label: 'TOTAL P&L', value: `${fmt(Math.abs(totalPnl))} (${fmtPct(totalPnlPct)})`, color: totalPnl >= 0 ? '#10B981' : '#EF4444' },
    { label: 'DAY P&L', value: fmt(Math.abs(dayPnl)), color: dayPnl >= 0 ? '#10B981' : '#EF4444' },
    { label: 'HOLDINGS', value: `${rows.length}`, sub: `${gainers} ↑  ${losers} ↓${noData > 0 ? `  ${noData} N/A` : ''}`, color: '#F5F7FA' },
    ...(best ? [{ label: 'BEST PERFORMER', value: best.symbol, sub: fmtPct(best.pnlPercent), color: '#10B981' }] : []),
    ...(worst ? [{ label: 'WORST PERFORMER', value: worst.symbol, sub: fmtPct(worst.pnlPercent), color: '#EF4444' }] : []),
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
      {cards.map(c => (
        <div key={c.label} style={{ backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '12px', padding: '16px' }}>
          <div style={{ fontSize: '10px', color: '#8BA3C1', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>{c.label}</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: c.color }}>{c.value}</div>
          {c.sub && <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── Add Holding Modal ─────────────────────────────────────────────── */

function AddHoldingForm({ onAdd, onCancel, quotes }: { onAdd: (h: PortfolioHolding) => void; onCancel: () => void; quotes: StockQuote[] }) {
  const [symbol, setSymbol] = useState('');
  const [company, setCompany] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    const sym = symbol.trim().toUpperCase().replace(/^(NSE|BSE|BOM|MCX):/, '');
    if (!sym || !/^[A-Z0-9&-]+$/.test(sym)) { toast.error('Invalid symbol'); return; }
    if (!entryPrice || Number(entryPrice) <= 0) { toast.error('Enter valid entry price'); return; }
    if (!quantity || Number(quantity) <= 0) { toast.error('Enter valid quantity'); return; }

    onAdd({
      symbol: sym,
      entryPrice: Number(entryPrice),
      quantity: Number(quantity),
      weight: 0,
      addedAt: new Date().toISOString(),
      notes: notes.trim() || undefined,
    });
  };

  const searchSuggestions = useMemo((): TickerSuggestion[] =>
    quotes.map(q => ({ ticker: q.ticker, company: q.company || q.ticker, sector: q.sector || '—', price: q.price || 0, changePercent: q.changePercent || 0 })),
    [quotes]
  );

  const inputStyle = {
    backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '8px',
    padding: '10px 14px', color: '#F5F7FA', fontSize: '14px', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #2A3B4C', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
      <div style={{ fontSize: '14px', fontWeight: '700', color: '#F5F7FA', marginBottom: '16px' }}>Add Holding</div>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '11px', color: '#8BA3C1', fontWeight: '600', display: 'block', marginBottom: '4px' }}>SEARCH STOCK</label>
        <TickerSearch
          onSelect={(ticker, sug) => {
            setSymbol(ticker);
            if (sug) {
              setCompany(sug.company);
              if (sug.price > 0 && !entryPrice) setEntryPrice(sug.price.toFixed(2));
            }
          }}
          quotes={searchSuggestions}
          placeholder="Search by company name or ticker..."
          clearOnSelect={false}
        />
        {symbol && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#10B981', fontWeight: 600 }}>
            Selected: {symbol} {company && company !== symbol ? `— ${company}` : ''}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={{ fontSize: '11px', color: '#8BA3C1', fontWeight: '600', display: 'block', marginBottom: '4px' }}>ENTRY PRICE (₹)</label>
          <input type="number" value={entryPrice} onChange={e => setEntryPrice(e.target.value)} placeholder="1250.00" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: '#8BA3C1', fontWeight: '600', display: 'block', marginBottom: '4px' }}>QUANTITY</label>
          <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="100" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: '#8BA3C1', fontWeight: '600', display: 'block', marginBottom: '4px' }}>NOTES (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Long-term hold" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #2A3B4C', backgroundColor: 'transparent', color: '#8BA3C1', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Cancel</button>
        <button onClick={handleSubmit} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#10B981', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Add to Portfolio</button>
      </div>
    </div>
  );
}

/* ── Inline Edit Cell ──────────────────────────────────────────────── */

function EditableCell({ value, onSave, type = 'price' }: { value: number; onSave: (v: number) => void; type?: 'price' | 'qty' }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));

  if (!editing) {
    return (
      <span style={{ cursor: 'pointer', borderBottom: '1px dashed #4A5B6C' }} onClick={() => { setVal(String(value)); setEditing(true); }}>
        {type === 'price' ? `₹${value.toFixed(2)}` : String(Math.round(value))}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
      <input type="number" value={val} onChange={e => setVal(e.target.value)}
        style={{ width: '80px', padding: '2px 6px', backgroundColor: '#1A2B3C', border: '1px solid #3B82F6', borderRadius: '4px', color: '#F5F7FA', fontSize: '12px', outline: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter') { onSave(Number(val)); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
      <button onClick={() => { onSave(Number(val)); setEditing(false); }} style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', padding: '2px' }}>
        <Check style={{ width: '12px', height: '12px' }} />
      </button>
      <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '2px' }}>
        <X style={{ width: '12px', height: '12px' }} />
      </button>
    </span>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────── */

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [intelligence, setIntelligence] = useState<Map<string, Signal>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [sortField, setSortField] = useState<SortField>('weight');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Init: load from API, fallback to localStorage
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch(`/api/portfolio?chatId=${CHAT_ID}`);
        if (res.ok) {
          const data = await res.json();
          if (data.holdings && data.holdings.length > 0) {
            setHoldings(data.holdings);
            setStoredHoldings(data.holdings);
            return;
          }
        }
      } catch (e) { console.error('Portfolio API fetch failed:', e); }
      setHoldings(getStoredHoldings());
    };
    init();
  }, []);

  // Fetch live quotes — bulk first, then individual for missing
  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const bulkQuotes = await fetchStockQuotes();
      const bulkTickers = new Set(bulkQuotes.map(q => q.ticker));
      const holdingSymbols = holdings.map(h => h.symbol);
      const missing = holdingSymbols.filter(s => !bulkTickers.has(s));

      let allQuotes = bulkQuotes;
      if (missing.length > 0) {
        const individual = await fetchIndividualQuotes(missing);
        allQuotes = [...bulkQuotes, ...individual];
      }

      setQuotes(allQuotes);

      // Fetch intelligence signals
      try {
        const intelRes = await fetch('/api/market/intelligence?days=90');
        if (intelRes.ok) {
          const intelData = await intelRes.json();
          const signalMap = new Map<string, Signal>();
          if (intelData.signals && Array.isArray(intelData.signals)) {
            // Build map from first/highest-scored signal per symbol
            for (const signal of intelData.signals) {
              if (!signalMap.has(signal.symbol)) {
                signalMap.set(signal.symbol, signal);
              }
            }
          }
          setIntelligence(signalMap);
        }
      } catch (e) { console.error('Intelligence fetch failed:', e); }

      setLastRefresh(new Date());
      setLoading(false);
    } catch { setLoading(false); }
    finally { setIsRefreshing(false); }
  }, [holdings]);

  useEffect(() => { if (holdings.length > 0) fetchData(); else setLoading(false); }, [holdings, fetchData]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (holdings.length === 0) return;
    const i = setInterval(fetchData, 60000);
    return () => clearInterval(i);
  }, [holdings.length, fetchData]);

  // Sync holdings to API
  const syncToAPI = useCallback((h: PortfolioHolding[]) => {
    setStoredHoldings(h);
    fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, secret: SECRET, action: 'set', holdings: h }),
    }).then(r => { if (!r.ok) console.error('Portfolio sync failed'); }).catch(console.error);
  }, []);

  // Build portfolio rows with P&L and intelligence
  const rows = useMemo((): PortfolioRow[] => {
    // First pass: compute currentValue for each holding
    const rawRows = holdings.map(h => {
      const quote = quotes.find(q => q.ticker === h.symbol);
      const cmp = quote?.price || 0;
      const change = quote?.change || 0;
      const changePercent = quote?.changePercent || 0;
      const investedValue = h.entryPrice * h.quantity;
      const currentValue = cmp > 0 ? cmp * h.quantity : investedValue; // fallback to invested if no live price
      const pnl = currentValue - investedValue;
      const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
      const dayPnl = change * h.quantity;
      const signal = intelligence.get(h.symbol);
      return { symbol: h.symbol, company: quote?.company || h.symbol, sector: quote?.sector || '—',
        entryPrice: h.entryPrice, quantity: h.quantity, cmp, change, changePercent,
        investedValue, currentValue, pnl, pnlPercent, dayPnl, notes: h.notes, weight: 0,
        score: signal?.weightedScore, sectorTrend: signal?.sectorTrend, decision: signal?.action };
    });
    // Second pass: weight by current value (proper risk weighting)
    const totalCurrent = rawRows.reduce((s, r) => s + r.currentValue, 0);
    return rawRows.map(r => ({ ...r, weight: totalCurrent > 0 ? (r.currentValue / totalCurrent) * 100 : 0 }));
  }, [holdings, quotes, intelligence]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [rows, sortField, sortOrder]);

  // Handlers
  const handleAdd = (h: PortfolioHolding) => {
    const exists = holdings.find(x => x.symbol === h.symbol);
    if (exists) {
      // Average in
      const totalQty = exists.quantity + h.quantity;
      const avgPrice = ((exists.entryPrice * exists.quantity) + (h.entryPrice * h.quantity)) / totalQty;
      const updated = holdings.map(x => x.symbol === h.symbol ? { ...x, entryPrice: avgPrice, quantity: totalQty } : x);
      setHoldings(updated);
      syncToAPI(updated);
      toast.success(`${h.symbol} averaged in — ${totalQty} shares @ ₹${avgPrice.toFixed(2)}`);
    } else {
      const updated = [...holdings, h];
      setHoldings(updated);
      syncToAPI(updated);
      toast.success(`${h.symbol} added to portfolio`);
    }
    setShowAdd(false);
    setTimeout(fetchData, 500);
  };

  const handleRemove = (symbol: string) => {
    if (!confirm(`Remove ${symbol} from portfolio? This cannot be undone.`)) return;
    const updated = holdings.filter(h => h.symbol !== symbol);
    setHoldings(updated);
    syncToAPI(updated);
    toast.success(`${symbol} removed from portfolio`);
  };

  const handleUpdateField = (symbol: string, field: 'entryPrice' | 'quantity', value: number) => {
    if (value <= 0) return;
    const updated = holdings.map(h => h.symbol === symbol ? { ...h, [field]: value } : h);
    setHoldings(updated);
    syncToAPI(updated);
    toast.success(`${symbol} ${field === 'entryPrice' ? 'entry price' : 'quantity'} updated`);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('desc'); }
  };

  const handleExportXLSX = async () => {
    if (sortedRows.length === 0) return;
    const XLSX = await import('xlsx');

    const data = sortedRows.map((r, i) => ({
      '#': i + 1,
      'Symbol': r.symbol,
      'Company': r.company,
      'Sector': r.sector,
      'Entry Price': r.entryPrice,
      'Qty': r.quantity,
      'Weight %': parseFloat(r.weight.toFixed(1)),
      'CMP': r.cmp,
      'Day Change %': parseFloat(r.changePercent.toFixed(2)),
      'Invested': Math.round(r.investedValue),
      'Current Value': Math.round(r.currentValue),
      'P&L': Math.round(r.pnl),
      'P&L %': parseFloat(r.pnlPercent.toFixed(2)),
      'Score': r.score !== undefined ? parseFloat(r.score.toFixed(0)) : '',
      'Trend': r.sectorTrend || '',
      'Decision': r.decision || '',
    }));

    // Add summary row
    const totalInvested = sortedRows.reduce((s, r) => s + r.investedValue, 0);
    const totalCurrent = sortedRows.reduce((s, r) => s + r.currentValue, 0);
    const totalPnl = totalCurrent - totalInvested;
    data.push({
      '#': 0, 'Symbol': '', 'Company': 'TOTAL', 'Sector': '',
      'Entry Price': 0, 'Qty': 0, 'Weight %': 100,
      'CMP': 0, 'Day Change %': 0,
      'Invested': Math.round(totalInvested),
      'Current Value': Math.round(totalCurrent),
      'P&L': Math.round(totalPnl),
      'P&L %': totalInvested > 0 ? parseFloat(((totalPnl / totalInvested) * 100).toFixed(2)) : 0,
      'Score': '', 'Trend': '', 'Decision': '',
    });

    const ws = XLSX.utils.json_to_sheet(data);
    // Column widths
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 16 },
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 12 },
      { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
      { wch: 8 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Portfolio');
    XLSX.writeFile(wb, `portfolio_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Exported portfolio to XLSX');
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown style={{ width: '10px', height: '10px', opacity: 0.4 }} />;
    return sortOrder === 'asc' ? <TrendingUp style={{ width: '10px', height: '10px' }} /> : <TrendingDown style={{ width: '10px', height: '10px' }} />;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 4px' }}>Portfolio</h1>
          <p style={{ fontSize: '12px', color: '#8BA3C1', margin: 0 }}>Active holdings · Capital deployed · P&L tracking</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => setShowAdd(!showAdd)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: '#10B981', border: 'none', borderRadius: '10px',
            padding: '10px 16px', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
          }}>
            <Plus style={{ width: '14px', height: '14px' }} /> Add Holding
          </button>
          <button onClick={fetchData} disabled={isRefreshing} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '10px',
            padding: '10px 14px', color: '#8BA3C1', cursor: isRefreshing ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: '600', opacity: isRefreshing ? 0.6 : 1,
          }}>
            <RefreshCw style={{ width: '14px', height: '14px' }} /> Refresh
          </button>
          <button onClick={handleExportXLSX} disabled={sortedRows.length === 0} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '10px',
            padding: '10px 14px', color: '#8BA3C1', cursor: sortedRows.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: '600', opacity: sortedRows.length === 0 ? 0.4 : 1,
          }}>
            <Download style={{ width: '14px', height: '14px' }} /> Export
          </button>
        </div>
      </div>

      {/* ── Add Form ────────────────────────────────────────────────── */}
      {showAdd && <AddHoldingForm onAdd={handleAdd} onCancel={() => setShowAdd(false)} quotes={quotes} />}

      {/* ── Summary ─────────────────────────────────────────────────── */}
      <PortfolioSummary rows={sortedRows} />

      {/* ── Loading ─────────────────────────────────────────────────── */}
      {loading && holdings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ height: '48px', backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '10px', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
          ))}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────── */}
      {!loading && holdings.length > 0 && (
        <>
          <div style={{ marginBottom: '12px' }}>
            <p style={{ fontSize: '12px', color: '#8BA3C1', margin: 0 }}>
              {sortedRows.length} holdings · Last refreshed: {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
            </p>
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #2A3B4C', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A3B4C', backgroundColor: '#0D1B2E' }}>
                  {[
                    { key: 'symbol' as SortField, label: 'SYMBOL', align: 'left' },
                    { key: 'company' as SortField, label: 'COMPANY', align: 'left' },
                    { key: 'sector' as SortField, label: 'SECTOR', align: 'left' },
                    { key: 'cmp' as SortField, label: 'CMP (₹)', align: 'right' },
                    { key: 'entryPrice' as SortField, label: 'ENTRY (₹)', align: 'right' },
                    { key: 'quantity' as SortField, label: 'QTY', align: 'right' },
                    { key: 'weight' as SortField, label: 'WEIGHT%', align: 'right' },
                    { key: 'investedValue' as SortField, label: 'INVESTED', align: 'right' },
                    { key: 'currentValue' as SortField, label: 'CURRENT', align: 'right' },
                    { key: 'pnlPercent' as SortField, label: 'P&L', align: 'right' },
                    { key: 'score' as SortField, label: 'SCORE', align: 'right' },
                    { key: 'symbol' as SortField, label: 'TREND', align: 'right', noSort: true },
                    { key: 'decision' as SortField, label: 'DECISION', align: 'right' },
                    { key: 'changePercent' as SortField, label: 'DAY%', align: 'right' },
                    { key: 'symbol' as SortField, label: '', align: 'right', noSort: true },
                  ].map((col, i) => (
                    <th key={i} onClick={() => !col.noSort && handleSort(col.key)} style={{
                      padding: '10px 12px', textAlign: col.align as any, fontSize: '10px', fontWeight: '700',
                      color: '#8BA3C1', letterSpacing: '0.5px', cursor: col.noSort ? 'default' : 'pointer', whiteSpace: 'nowrap',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start', gap: '4px' }}>
                        {col.label} {!col.noSort && <SortIcon field={col.key} />}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, idx) => {
                  const pnlColor = r.pnl >= 0 ? '#10B981' : '#EF4444';
                  // BUG-03 fix: null/undefined changePercent should be neutral grey, not green/red
                  const hasQuote = r.cmp > 0 && r.changePercent != null;
                  const dayColor = hasQuote ? (r.changePercent >= 0 ? '#10B981' : '#EF4444') : '#64748B';
                  return (
                    <tr key={r.symbol} style={{ borderBottom: idx < sortedRows.length - 1 ? '1px solid #1A2B3C' : 'none', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '10px 12px', color: '#3B82F6', fontWeight: '700' }}>{r.symbol}</td>
                      <td style={{ padding: '10px 12px', color: '#F5F7FA', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                      <td style={{ padding: '10px 12px', color: '#8BA3C1', fontSize: '11px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#F5F7FA', fontVariantNumeric: 'tabular-nums' }}>
                        {r.cmp > 0 ? `₹${r.cmp.toFixed(2)}` : (
                          <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', backgroundColor: 'rgba(251,191,36,0.1)', color: '#FBBF24' }}>
                            N/A
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                        <EditableCell value={r.entryPrice} onSave={v => handleUpdateField(r.symbol, 'entryPrice', v)} />
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                        <EditableCell value={r.quantity} onSave={v => handleUpdateField(r.symbol, 'quantity', v)} type="qty" />
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#8BA3C1', fontVariantNumeric: 'tabular-nums' }}>
                        {r.weight.toFixed(1)}%
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(r.investedValue)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#F5F7FA', fontVariantNumeric: 'tabular-nums' }}>
                        {r.cmp > 0 ? fmt(r.currentValue) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.cmp > 0 ? (
                          <div>
                            <span style={{ color: pnlColor, fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>
                              {r.pnl >= 0 ? '+' : ''}{fmt(Math.abs(r.pnl))}
                            </span>
                            <div style={{ fontSize: '10px', color: pnlColor, fontVariantNumeric: 'tabular-nums' }}>
                              {fmtPct(r.pnlPercent)}
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      {/* Score */}
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.score !== undefined ? (
                          <span style={{
                            display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            backgroundColor: r.score >= 70 ? 'rgba(16,185,129,0.1)' : r.score >= 40 ? 'rgba(251,191,36,0.1)' : 'rgba(100,116,139,0.1)',
                            color: r.score >= 70 ? '#10B981' : r.score >= 40 ? '#FBBF24' : '#64748B',
                            fontVariantNumeric: 'tabular-nums',
                          }}>
                            {r.score.toFixed(0)}
                          </span>
                        ) : '—'}
                      </td>
                      {/* Trend */}
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.sectorTrend ? (
                          <span style={{
                            display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            backgroundColor: r.sectorTrend === 'Bullish' ? 'rgba(16,185,129,0.1)' : r.sectorTrend === 'Bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(251,191,36,0.1)',
                            color: r.sectorTrend === 'Bullish' ? '#10B981' : r.sectorTrend === 'Bearish' ? '#EF4444' : '#FBBF24',
                          }}>
                            {r.sectorTrend}
                          </span>
                        ) : '—'}
                      </td>
                      {/* Decision */}
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.decision ? (
                          <span style={{
                            display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            backgroundColor: r.decision === 'BUY' ? 'rgba(16,185,129,0.15)' : r.decision === 'ADD' ? 'rgba(5,150,105,0.15)' : r.decision === 'HOLD' ? 'rgba(251,191,36,0.15)' : r.decision === 'TRIM' ? 'rgba(249,115,22,0.15)' : r.decision === 'EXIT' ? 'rgba(239,68,68,0.15)' : 'rgba(100,116,139,0.15)',
                            color: r.decision === 'BUY' ? '#10B981' : r.decision === 'ADD' ? '#059669' : r.decision === 'HOLD' ? '#FBBF24' : r.decision === 'TRIM' ? '#F97316' : r.decision === 'EXIT' ? '#EF4444' : '#64748B',
                          }}>
                            {r.decision}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{
                          display: 'inline-block', padding: '3px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                          backgroundColor: hasQuote
                            ? (r.changePercent >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)')
                            : 'rgba(100,116,139,0.1)',
                          color: dayColor, fontVariantNumeric: 'tabular-nums',
                        }}
                        title={!hasQuote ? 'Quote unavailable' : undefined}>
                          {hasQuote ? fmtPct(r.changePercent) : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <button onClick={() => handleRemove(r.symbol)} title="Remove from portfolio"
                          style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#EF4444'; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#4A5B6C'; }}>
                          <Trash2 style={{ width: '14px', height: '14px' }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Empty State ─────────────────────────────────────────────── */}
      {!loading && holdings.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>💼</div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 8px' }}>Your portfolio is empty</h2>
          <p style={{ fontSize: '14px', color: '#8BA3C1', margin: '0 0 24px' }}>Add your holdings with entry price and quantity to track P&L in real-time.</p>
          <button onClick={() => setShowAdd(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: '#10B981', border: 'none', borderRadius: '10px',
            padding: '12px 24px', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '600',
          }}>
            <Plus style={{ width: '16px', height: '16px' }} /> Add Your First Holding
          </button>
        </div>
      )}

      {/* ── Sync Info ───────────────────────────────────────────────── */}
      {holdings.length > 0 && (
        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '10px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#8BA3C1', margin: 0 }}>
            💼 Portfolio syncs via Redis · Entry price & quantity are editable inline (click to edit)
          </p>
        </div>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}
