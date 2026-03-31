'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  PackageCheck,
  RefreshCw,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Star,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  Briefcase,
} from 'lucide-react';

// Theme constants
const BG = '#0A0E1A';
const CARD = '#0D1623';
const CARD_HOVER = '#111B35';
const BORDER = '#1A2840';
const ACCENT = '#0F7ABF';
const GREEN = '#10B981';
const RED = '#EF4444';
const YELLOW = '#FBBF24';
const PURPLE = '#8B5CF6';
const CYAN = '#06B6D4';
const ORANGE = '#F97316';
const TEXT1 = '#F5F7FA';
const TEXT2 = '#8A95A3';
const TEXT3 = '#4A5B6C';

// Helper: robust date parser for NSE dates (DD-Mon-YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.)
const parseNSEDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  // Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  // DD-Mon-YYYY or DD-Mon-YYYY HH:mm (e.g. "31-Mar-2026 09:15")
  const monMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (monMatch) {
    const d = new Date(`${monMatch[2]} ${monMatch[1]}, ${monMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  // DD-MM-YYYY
  const ddmmyyyy = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (ddmmyyyy) {
    const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
    if (!isNaN(d.getTime())) return d;
  }
  // Last resort
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

const formatOrderDate = (dateStr: string): string => {
  const d = parseNSEDate(dateStr);
  if (!d) return dateStr || '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Helper functions
const formatNumber = (num: number): string => {
  if (num >= 10000000) {
    return (num / 10000000).toFixed(2) + 'Cr';
  }
  if (num >= 100000) {
    return (num / 100000).toFixed(2) + 'L';
  }
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const formatVolume = (num: number): string => {
  if (num >= 10000000) {
    return (num / 10000000).toFixed(1) + 'Cr';
  }
  if (num >= 100000) {
    return (num / 100000).toFixed(1) + 'L';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

// Types
interface Order {
  ticker: string;
  companyName: string;
  ltp: number;
  changePercent: number;
  volume: number;
  ordersCount: number;
  hasHighSignal: boolean;
  group: 'watchlist' | 'nifty50' | 'niftymidcap150' | 'niftysmallcap250';
}

interface DetailData {
  ticker: string;
  companyName: string;
  ltp: number;
  changePercent: number;
  timeline: Array<{
    id: string;
    date: string;
    description: string;
    quantity: number;
    price: number;
  }>;
  news: Array<{
    id: string;
    title: string;
    date: string;
    source: string;
  }>;
}

interface CorporateOrder {
  symbol: string;
  company: string;
  subject: string;
  description: string;
  date: string;
  orderType: string;
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
  importanceScore: number;
  orderValue: number | null;
  isWatchlist: boolean;
  nseUrl: string;
  analysis: {
    eventSummary: string;
    client: string | null;
    segment: string | null;
    timeline: string | null;
    revenueImpact: string | null;
    marginImpact: string | null;
    strategicNote: string | null;
    sentiment: 'Positive' | 'Neutral' | 'Negative';
    confidence: 'High' | 'Medium' | 'Low';
  };
}

interface CorporateOrdersSummary {
  total: number;
  high: number;
  medium: number;
  orderWins: number;
  contracts: number;
  partnerships: number;
  watchlistHits: number;
  totalOrderValue: number;
}

export default function OrdersPage() {
  const [tab, setTab] = useState<'deals' | 'corporate'>('deals');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [daysFilter, setDaysFilter] = useState(7);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({
    watchlist: true,
    nifty50: true,
    niftymidcap150: true,
    niftysmallcap250: true,
  });
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Corporate Orders state
  const [corporateOrders, setCorporateOrders] = useState<CorporateOrder[]>([]);
  const [corporateSummary, setCorporateSummary] = useState<CorporateOrdersSummary>({
    total: 0,
    high: 0,
    medium: 0,
    orderWins: 0,
    contracts: 0,
    partnerships: 0,
    watchlistHits: 0,
    totalOrderValue: 0,
  });
  const [corporateLoading, setCorporateLoading] = useState(false);

  // Fetch Block/Bulk deals
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const watchlistStr = localStorage.getItem('mc_watchlist_tickers') || '[]';
      const watchlist: string[] = JSON.parse(watchlistStr);
      const watchlistParam = watchlist.length > 0 ? `&watchlist=${watchlist.join(',')}` : '';

      const response = await fetch(`/api/orders?days=${daysFilter}${watchlistParam}`);
      const data = await response.json();

      // API returns { groups: [{ name, label, tickers: [...] }], deals: {...}, summary: {...} }
      const allOrders: Order[] = [];
      const groupNameMap: Record<string, Order['group']> = {
        watchlist: 'watchlist',
        nifty50: 'nifty50',
        midcap150: 'niftymidcap150',
        smallcap250: 'niftysmallcap250',
      };

      if (data.groups && Array.isArray(data.groups)) {
        for (const group of data.groups) {
          const groupKey = groupNameMap[group.name] || 'nifty50';
          for (const ticker of (group.tickers || [])) {
            allOrders.push({
              ticker: ticker.symbol || '',
              companyName: ticker.company || ticker.symbol || '',
              ltp: ticker.price || 0,
              changePercent: ticker.changePct || 0,
              volume: ticker.volume || 0,
              ordersCount: ticker.ordersCount || 0,
              hasHighSignal: ticker.hasHighSignal || false,
              group: groupKey,
            });
          }
        }
      }

      setOrders(allOrders);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Error fetching orders:', error);
      setOrders([]);
      setLastUpdated(new Date().toLocaleTimeString());
    }
    setLoading(false);
  }, [daysFilter]);

  // Fetch corporate orders
  const fetchCorporateOrders = useCallback(async () => {
    setCorporateLoading(true);
    try {
      const watchlistStr = localStorage.getItem('mc_watchlist_tickers') || '[]';
      const watchlist: string[] = JSON.parse(watchlistStr);
      const watchlistParam = watchlist.length > 0 ? `?watchlist=${watchlist.join(',')}` : '';

      const sep = watchlistParam ? '&' : '?';
      const response = await fetch(`/api/market/corporate-orders${watchlistParam}${sep}days=${daysFilter}`);
      const data = await response.json();

      setCorporateOrders(data.orders || []);
      setCorporateSummary(data.summary || {
        total: 0,
        high: 0,
        medium: 0,
        orderWins: 0,
        contracts: 0,
        partnerships: 0,
        watchlistHits: 0,
        totalOrderValue: 0,
      });
    } catch (error) {
      console.error('Error fetching corporate orders:', error);
      setCorporateOrders([]);
      setCorporateSummary({
        total: 0,
        high: 0,
        medium: 0,
        orderWins: 0,
        contracts: 0,
        partnerships: 0,
        watchlistHits: 0,
        totalOrderValue: 0,
      });
    }
    setCorporateLoading(false);
  }, [daysFilter]);

  // Fetch detail data
  const fetchDetailData = useCallback(async (ticker: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/orders/${ticker}`);
      const data = await response.json();
      // API returns { symbol, orders: [...], news: [...] }
      const order = orders.find(o => o.ticker === ticker);
      setDetailData({
        ticker: data.symbol || ticker,
        companyName: order?.companyName || ticker,
        ltp: order?.ltp || 0,
        changePercent: order?.changePercent || 0,
        timeline: (data.orders || []).map((d: any, i: number) => ({
          id: `deal-${i}`,
          date: d.dealDate || '',
          description: `${d.type || 'Deal'}: ${d.clientName || 'Unknown'} — ${d.buyOrSell || ''}`,
          quantity: d.quantity || 0,
          price: d.tradePrice || 0,
        })),
        news: (data.news || []).map((n: any, i: number) => ({
          id: `news-${i}`,
          title: n.headline || '',
          date: n.date || '',
          source: n.category || 'NSE',
        })),
      });
    } catch (error) {
      console.error('Error fetching detail:', error);
      setDetailData(null);
    }
    setDetailLoading(false);
  }, [orders]);

  // Initial load
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Fetch corporate orders when tab is corporate
  useEffect(() => {
    if (tab === 'corporate') {
      fetchCorporateOrders();
    }
  }, [tab, fetchCorporateOrders]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (tab === 'deals') {
        fetchOrders();
      } else {
        fetchCorporateOrders();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [tab, fetchOrders, fetchCorporateOrders]);

  // Handle detail drawer
  useEffect(() => {
    if (selectedOrder) {
      fetchDetailData(selectedOrder);
    }
  }, [selectedOrder, fetchDetailData]);

  // Group and filter orders — only show stocks with actual block/bulk deals
  const groupedOrders = useMemo(() => {
    const filtered = orders.filter(
      order =>
        order.ordersCount > 0 &&
        (order.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.companyName.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return {
      watchlist: filtered.filter(o => o.group === 'watchlist'),
      nifty50: filtered.filter(o => o.group === 'nifty50'),
      niftymidcap150: filtered.filter(o => o.group === 'niftymidcap150'),
      niftysmallcap250: filtered.filter(o => o.group === 'niftysmallcap250'),
    };
  }, [orders, searchQuery]);

  // Calculate summary stats
  const stats = useMemo(
    () => ({
      totalStocks: orders.length,
      blockBulkDeals: orders.reduce((sum, o) => sum + o.ordersCount, 0),
      highSignal: orders.filter(o => o.hasHighSignal).length,
      watchlistActive: groupedOrders.watchlist.length,
    }),
    [orders, groupedOrders]
  );

  const toggleGroup = (group: keyof typeof expandedGroups) => {
    setExpandedGroups(prev => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  const getOrderTypeColor = (type: string): string => {
    switch (type) {
      case 'Order Win':
        return GREEN;
      case 'Contract':
        return ACCENT;
      case 'Partnership/JV':
        return PURPLE;
      case 'Capex':
        return YELLOW;
      case 'LOI':
        return ORANGE;
      default:
        return TEXT2;
    }
  };

  const getImportanceColor = (importance: string): string => {
    switch (importance) {
      case 'HIGH':
        return RED;
      case 'MEDIUM':
        return YELLOW;
      case 'LOW':
        return TEXT3;
      default:
        return TEXT2;
    }
  };

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: '24px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {tab === 'deals' ? (
            <PackageCheck size={28} color={ACCENT} />
          ) : (
            <Briefcase size={28} color={ACCENT} />
          )}
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0 }}>
            {tab === 'deals' ? 'Orders & Deals' : 'Corporate Orders'}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => {
              if (tab === 'deals') {
                fetchOrders();
              } else {
                fetchCorporateOrders();
              }
            }}
            style={{
              backgroundColor: CARD,
              border: `1px solid ${BORDER}`,
              color: TEXT1,
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = CARD_HOVER;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = CARD;
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          <span style={{ fontSize: '12px', color: TEXT3 }}>Last updated: {lastUpdated}</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '24px',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <button
          onClick={() => setTab('deals')}
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: tab === 'deals' ? ACCENT : TEXT2,
            padding: '12px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            borderBottom: tab === 'deals' ? `2px solid ${ACCENT}` : 'none',
            marginBottom: '-1px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            if (tab !== 'deals') {
              (e.currentTarget as HTMLButtonElement).style.color = TEXT1;
            }
          }}
          onMouseLeave={e => {
            if (tab !== 'deals') {
              (e.currentTarget as HTMLButtonElement).style.color = TEXT2;
            }
          }}
        >
          Block & Bulk Deals
        </button>
        <button
          onClick={() => setTab('corporate')}
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: tab === 'corporate' ? ACCENT : TEXT2,
            padding: '12px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            borderBottom: tab === 'corporate' ? `2px solid ${ACCENT}` : 'none',
            marginBottom: '-1px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            if (tab !== 'corporate') {
              (e.currentTarget as HTMLButtonElement).style.color = TEXT1;
            }
          }}
          onMouseLeave={e => {
            if (tab !== 'corporate') {
              (e.currentTarget as HTMLButtonElement).style.color = TEXT2;
            }
          }}
        >
          Corporate Orders
        </button>
      </div>

      {/* Summary Cards */}
      {tab === 'deals' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '32px',
          }}
        >
          {[
            { label: 'Total Stocks', value: stats.totalStocks, color: ACCENT },
            { label: 'Block/Bulk Deals', value: stats.blockBulkDeals, color: GREEN },
            { label: 'High Signal', value: stats.highSignal, color: YELLOW },
            { label: 'Watchlist Active', value: stats.watchlistActive, color: CYAN },
          ].map(card => (
            <div
              key={card.label}
              style={{
                backgroundColor: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: '8px',
                padding: '20px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = CARD_HOVER;
                (e.currentTarget as HTMLDivElement).style.borderColor = card.color;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = CARD;
                (e.currentTarget as HTMLDivElement).style.borderColor = BORDER;
              }}
            >
              <div style={{ fontSize: '12px', color: TEXT3, marginBottom: '8px', textTransform: 'uppercase' }}>
                {card.label}
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: card.color }}>
                {card.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '32px',
          }}
        >
          {[
            { label: 'Material Events', value: corporateSummary.total, color: ACCENT },
            { label: 'HIGH Signal', value: corporateSummary.high, color: RED },
            { label: 'MEDIUM Signal', value: corporateSummary.medium, color: YELLOW },
            { label: 'Total Value', value: corporateSummary.totalOrderValue > 0 ? `₹${(corporateSummary.totalOrderValue / 1000).toFixed(0)}K Cr` : '—', color: GREEN, isString: true },
            { label: 'Watchlist Hits', value: corporateSummary.watchlistHits, color: CYAN },
          ].map(card => (
            <div
              key={card.label}
              style={{
                backgroundColor: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: '8px',
                padding: '20px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = CARD_HOVER;
                (e.currentTarget as HTMLDivElement).style.borderColor = card.color;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = CARD;
                (e.currentTarget as HTMLDivElement).style.borderColor = BORDER;
              }}
            >
              <div style={{ fontSize: '12px', color: TEXT3, marginBottom: '8px', textTransform: 'uppercase' }}>
                {card.label}
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: card.color }}>
                {typeof card.value === 'string' ? card.value : card.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters - Show only for deals tab */}
      {tab === 'deals' && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '24px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              position: 'relative',
              flex: 1,
              minWidth: '200px',
            }}
          >
            <Search
              size={16}
              color={TEXT3}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Search ticker or company..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                backgroundColor: CARD,
                border: `1px solid ${BORDER}`,
                color: TEXT1,
                padding: '10px 12px 10px 40px',
                borderRadius: '6px',
                fontSize: '14px',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {[7, 14, 30].map(days => (
            <button
              key={days}
              onClick={() => setDaysFilter(days)}
              style={{
                backgroundColor: daysFilter === days ? ACCENT : CARD,
                border: `1px solid ${daysFilter === days ? ACCENT : BORDER}`,
                color: daysFilter === days ? '#000' : TEXT1,
                padding: '10px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 600,
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                if (daysFilter !== days) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = CARD_HOVER;
                }
              }}
              onMouseLeave={e => {
                if (daysFilter !== days) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = CARD;
                }
              }}
            >
              {days}d
            </button>
          ))}
        </div>
      )}

      {/* Tab Content */}
      {tab === 'deals' ? (
        // DEALS TAB CONTENT
        <>
          {/* Loading State */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  border: `3px solid ${BORDER}`,
                  borderTop: `3px solid ${ACCENT}`,
                  borderRadius: '50%',
                  margin: '0 auto',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <p style={{ marginTop: '16px', color: TEXT2 }}>Loading orders...</p>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : (
            <>
              {/* Grouped Tables */}
              {[
                { key: 'watchlist', label: 'My Watchlist', color: ACCENT },
                { key: 'nifty50', label: 'Nifty 50', color: GREEN },
                { key: 'niftymidcap150', label: 'Nifty Midcap 150', color: CYAN },
                { key: 'niftysmallcap250', label: 'Nifty Smallcap 250', color: PURPLE },
              ].map(group => {
                const groupKey = group.key as keyof typeof groupedOrders;
                const groupData = groupedOrders[groupKey];
                const isExpanded = expandedGroups[groupKey];

                return (
                  <div
                    key={group.key}
                    style={{
                      marginBottom: '24px',
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      borderRadius: '8px',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Group Header */}
                    <button
                      onClick={() => toggleGroup(groupKey)}
                      style={{
                        width: '100%',
                        padding: '16px',
                        backgroundColor: CARD,
                        border: 'none',
                        color: TEXT1,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'all 0.2s',
                        borderBottom: isExpanded ? `1px solid ${BORDER}` : 'none',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor = CARD_HOVER;
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor = CARD;
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                        <span style={{ fontSize: '16px', fontWeight: 600 }}>{group.label}</span>
                        <div
                          style={{
                            backgroundColor: group.color,
                            color: '#000',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          {groupData.length}
                        </div>
                      </div>
                    </button>

                    {/* Group Content */}
                    {isExpanded && groupData.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: `1px solid ${BORDER}`,
                                backgroundColor: CARD_HOVER,
                              }}
                            >
                              {[
                                { key: 'ticker', label: 'Ticker', width: '80px' },
                                { key: 'company', label: 'Company', width: '200px' },
                                { key: 'ltp', label: 'LTP', width: '100px' },
                                { key: 'change', label: '% Chg', width: '80px' },
                                { key: 'volume', label: 'Volume', width: '100px' },
                                { key: 'orders', label: 'Orders', width: '80px' },
                                { key: 'signal', label: 'Signal', width: '60px' },
                              ].map(col => (
                                <th
                                  key={col.key}
                                  style={{
                                    padding: '12px 16px',
                                    textAlign: 'left',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: TEXT2,
                                    textTransform: 'uppercase',
                                    width: col.width,
                                  }}
                                >
                                  {col.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {groupData.map((order, idx) => (
                              <tr
                                key={`${order.ticker}-${idx}`}
                                onClick={() => setSelectedOrder(order.ticker)}
                                style={{
                                  borderBottom: `1px solid ${BORDER}`,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s',
                                  backgroundColor: selectedOrder === order.ticker ? CARD_HOVER : CARD,
                                }}
                                onMouseEnter={e => {
                                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                                    CARD_HOVER;
                                }}
                                onMouseLeave={e => {
                                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                                    selectedOrder === order.ticker ? CARD_HOVER : CARD;
                                }}
                              >
                                <td
                                  style={{
                                    padding: '12px 16px',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    fontFamily: 'monospace',
                                    color: ACCENT,
                                  }}
                                >
                                  {order.ticker}
                                </td>
                                <td
                                  style={{
                                    padding: '12px 16px',
                                    fontSize: '14px',
                                    color: TEXT1,
                                    maxWidth: '200px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {order.companyName}
                                </td>
                                <td
                                  style={{
                                    padding: '12px 16px',
                                    fontSize: '14px',
                                    color: TEXT1,
                                    fontWeight: 500,
                                  }}
                                >
                                  {formatNumber(order.ltp)}
                                </td>
                                <td
                                  style={{
                                    padding: '12px 16px',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: order.changePercent >= 0 ? GREEN : RED,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  {order.changePercent >= 0 ? (
                                    <TrendingUp size={14} />
                                  ) : (
                                    <TrendingDown size={14} />
                                  )}
                                  {Math.abs(order.changePercent).toFixed(2)}%
                                </td>
                                <td
                                  style={{
                                    padding: '12px 16px',
                                    fontSize: '14px',
                                    color: TEXT2,
                                  }}
                                >
                                  {formatVolume(order.volume)}
                                </td>
                                <td
                                  style={{
                                    padding: '12px 16px',
                                    fontSize: '14px',
                                    color: TEXT1,
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {order.ordersCount > 0 && (
                                      <div
                                        style={{
                                          width: '8px',
                                          height: '8px',
                                          backgroundColor: ORANGE,
                                          borderRadius: '50%',
                                        }}
                                      />
                                    )}
                                    {order.ordersCount}
                                  </div>
                                </td>
                                <td
                                  style={{
                                    padding: '12px 16px',
                                    fontSize: '14px',
                                    color: order.hasHighSignal ? YELLOW : TEXT3,
                                  }}
                                >
                                  {order.hasHighSignal && <Star size={14} fill={YELLOW} />}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Empty State */}
                    {isExpanded && groupData.length === 0 && (
                      <div
                        style={{
                          padding: '32px 16px',
                          textAlign: 'center',
                          color: TEXT3,
                        }}
                      >
                        No orders in this category
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      ) : (
        // CORPORATE ORDERS TAB CONTENT
        <>
          {corporateLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  border: `3px solid ${BORDER}`,
                  borderTop: `3px solid ${ACCENT}`,
                  borderRadius: '50%',
                  margin: '0 auto',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <p style={{ marginTop: '16px', color: TEXT2 }}>Loading corporate orders...</p>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : corporateOrders.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {corporateOrders.map((order, idx) => {
                const sentimentColor = order.analysis?.sentiment === 'Positive' ? GREEN : order.analysis?.sentiment === 'Negative' ? RED : TEXT2;
                const borderColor = order.importance === 'HIGH' ? GREEN : order.importance === 'MEDIUM' ? YELLOW : BORDER;

                return (
                  <div
                    key={`${order.symbol}-${order.date}-${idx}`}
                    style={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      borderLeft: `4px solid ${borderColor}`,
                      borderRadius: '8px',
                      padding: '16px',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = CARD_HOVER;
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = CARD;
                    }}
                  >
                    {/* Row 1: Event Summary (the readable 1-liner) */}
                    <div style={{
                      fontSize: '15px',
                      fontWeight: 700,
                      color: TEXT1,
                      marginBottom: '10px',
                      lineHeight: '1.4',
                    }}>
                      {order.analysis?.eventSummary || order.subject || 'Corporate Announcement'}
                    </div>

                    {/* Row 2: Badges — Symbol, Type, Importance, Value, Date */}
                    <div style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginBottom: '12px',
                    }}>
                      {order.isWatchlist && (
                        <Star size={14} fill={YELLOW} color={YELLOW} />
                      )}
                      <span style={{
                        fontSize: '12px', fontWeight: 700, color: ACCENT, fontFamily: 'monospace',
                      }}>{order.symbol}</span>
                      <span style={{
                        backgroundColor: getOrderTypeColor(order.orderType),
                        color: ['Order Win', 'Capex'].includes(order.orderType) ? '#000' : TEXT1,
                        padding: '2px 8px', borderRadius: '3px', fontSize: '10px', fontWeight: 600,
                      }}>{order.orderType}</span>
                      <span style={{
                        backgroundColor: `${getImportanceColor(order.importance)}20`,
                        border: `1px solid ${getImportanceColor(order.importance)}50`,
                        color: getImportanceColor(order.importance),
                        padding: '2px 8px', borderRadius: '3px', fontSize: '10px', fontWeight: 700,
                      }}>{order.importance}</span>
                      {order.orderValue && order.orderValue > 0 && (
                        <span style={{
                          backgroundColor: `${GREEN}15`,
                          border: `1px solid ${GREEN}40`,
                          color: GREEN,
                          padding: '2px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: 700,
                        }}>
                          ₹{order.orderValue >= 1000 ? `${(order.orderValue / 1000).toFixed(1)}K` : order.orderValue.toFixed(0)} Cr
                        </span>
                      )}
                      <span style={{ fontSize: '11px', color: TEXT3, marginLeft: 'auto' }}>
                        {formatOrderDate(order.date)}
                      </span>
                    </div>

                    {/* Row 3: Analysis Details Grid */}
                    {order.analysis && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '8px',
                        padding: '10px 12px',
                        backgroundColor: `${BG}80`,
                        borderRadius: '6px',
                        fontSize: '11px',
                      }}>
                        {order.analysis.client && (
                          <div>
                            <span style={{ color: TEXT3, display: 'block' }}>Client</span>
                            <span style={{ color: TEXT1, fontWeight: 600 }}>{order.analysis.client}</span>
                          </div>
                        )}
                        {order.analysis.segment && (
                          <div>
                            <span style={{ color: TEXT3, display: 'block' }}>Segment</span>
                            <span style={{ color: TEXT1, fontWeight: 600 }}>{order.analysis.segment}</span>
                          </div>
                        )}
                        {order.analysis.timeline && (
                          <div>
                            <span style={{ color: TEXT3, display: 'block' }}>Timeline</span>
                            <span style={{ color: TEXT1, fontWeight: 600 }}>{order.analysis.timeline}</span>
                          </div>
                        )}
                        {order.analysis.revenueImpact && (
                          <div>
                            <span style={{ color: TEXT3, display: 'block' }}>Revenue Impact</span>
                            <span style={{
                              color: order.analysis.revenueImpact === 'High' ? GREEN : order.analysis.revenueImpact === 'Medium' ? YELLOW : TEXT2,
                              fontWeight: 600,
                            }}>{order.analysis.revenueImpact}</span>
                          </div>
                        )}
                        {order.analysis.marginImpact && (
                          <div>
                            <span style={{ color: TEXT3, display: 'block' }}>Margin Impact</span>
                            <span style={{
                              color: order.analysis.marginImpact === 'Accretive' ? GREEN : order.analysis.marginImpact === 'Dilutive' ? RED : TEXT2,
                              fontWeight: 600,
                            }}>{order.analysis.marginImpact}</span>
                          </div>
                        )}
                        <div>
                          <span style={{ color: TEXT3, display: 'block' }}>Sentiment</span>
                          <span style={{ color: sentimentColor, fontWeight: 600 }}>{order.analysis.sentiment}</span>
                        </div>
                        <div>
                          <span style={{ color: TEXT3, display: 'block' }}>Confidence</span>
                          <span style={{ color: TEXT1, fontWeight: 600 }}>{order.analysis.confidence}</span>
                        </div>
                      </div>
                    )}

                    {/* Row 4: Strategic Note (if available) */}
                    {order.analysis?.strategicNote && (
                      <div style={{
                        marginTop: '8px',
                        fontSize: '12px',
                        color: ACCENT,
                        fontStyle: 'italic',
                        paddingLeft: '8px',
                        borderLeft: `2px solid ${ACCENT}40`,
                      }}>
                        {order.analysis.strategicNote}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                backgroundColor: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: '8px',
                padding: '60px 20px',
                textAlign: 'center',
                color: TEXT3,
              }}
            >
              <Briefcase size={40} style={{ opacity: 0.5, margin: '0 auto 16px' }} />
              <p>No corporate orders found for the selected period.</p>
            </div>
          )}
        </>
      )}

      {/* Detail Drawer */}
      {selectedOrder && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 40,
            animation: 'fadeIn 0.2s ease-out',
          }}
          onClick={() => {
            setSelectedOrder(null);
            setDetailData(null);
          }}
        >
          <style>{`
            @keyframes fadeIn {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            @keyframes slideIn {
              from {
                transform: translateX(400px);
              }
              to {
                transform: translateX(0);
              }
            }
          `}</style>
          <div
            style={{
              position: 'fixed',
              right: 0,
              top: 0,
              bottom: 0,
              width: '400px',
              backgroundColor: CARD,
              borderLeft: `1px solid ${BORDER}`,
              overflowY: 'auto',
              animation: 'slideIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              zIndex: 41,
            }}
            onClick={e => e.stopPropagation()}
          >
            {detailLoading ? (
              <div style={{ padding: '32px', textAlign: 'center' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    border: `3px solid ${BORDER}`,
                    borderTop: `3px solid ${ACCENT}`,
                    borderRadius: '50%',
                    margin: '0 auto',
                    animation: 'spin 1s linear infinite',
                  }}
                />
              </div>
            ) : detailData ? (
              <>
                {/* Header */}
                <div
                  style={{
                    padding: '20px',
                    borderBottom: `1px solid ${BORDER}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: TEXT3,
                        textTransform: 'uppercase',
                        marginBottom: '4px',
                      }}
                    >
                      {detailData.ticker}
                    </div>
                    <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0' }}>
                      {detailData.companyName}
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '18px', fontWeight: 600, color: TEXT1 }}>
                        {formatNumber(detailData.ltp)}
                      </span>
                      <span
                        style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: detailData.changePercent >= 0 ? GREEN : RED,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {detailData.changePercent >= 0 ? (
                          <ArrowUpRight size={14} />
                        ) : (
                          <TrendingDown size={14} />
                        )}
                        {Math.abs(detailData.changePercent).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedOrder(null);
                      setDetailData(null);
                    }}
                    style={{
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: TEXT2,
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Orders Timeline */}
                <div style={{ padding: '20px', borderBottom: `1px solid ${BORDER}` }}>
                  <h3
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: TEXT2,
                      marginBottom: '16px',
                    }}
                  >
                    Orders Timeline
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {detailData.timeline.length > 0 ? (
                      detailData.timeline.map(item => (
                        <div
                          key={item.id}
                          style={{
                            backgroundColor: CARD_HOVER,
                            padding: '12px',
                            borderRadius: '6px',
                            borderLeft: `3px solid ${ACCENT}`,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'start',
                              marginBottom: '4px',
                            }}
                          >
                            <div style={{ fontSize: '13px', fontWeight: 600, color: TEXT1 }}>
                              {item.description}
                            </div>
                            <div style={{ fontSize: '12px', color: TEXT3 }}>{item.date}</div>
                          </div>
                          <div style={{ fontSize: '12px', color: TEXT2 }}>
                            {formatNumber(item.quantity)} units @ {formatNumber(item.price)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: '13px', color: TEXT3, textAlign: 'center', padding: '16px' }}>
                        No orders in timeline
                      </div>
                    )}
                  </div>
                </div>

                {/* Company News */}
                <div style={{ padding: '20px' }}>
                  <h3
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: TEXT2,
                      marginBottom: '16px',
                    }}
                  >
                    Company News
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {detailData.news.length > 0 ? (
                      detailData.news.map(item => (
                        <div
                          key={item.id}
                          style={{
                            backgroundColor: CARD_HOVER,
                            padding: '12px',
                            borderRadius: '6px',
                          }}
                        >
                          <div style={{ fontSize: '13px', fontWeight: 600, color: TEXT1, marginBottom: '4px' }}>
                            {item.title}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '11px',
                              color: TEXT3,
                            }}
                          >
                            <span>{item.source}</span>
                            <span>{item.date}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: '13px', color: TEXT3, textAlign: 'center', padding: '16px' }}>
                        No recent news
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// Mock data generators
function generateMockOrders(): Order[] {
  const tickers = [
    'RELIANCE',
    'TCS',
    'INFOSYS',
    'HINDUNILVR',
    'ICICIBANK',
    'SBIN',
    'BAJAJFINSV',
    'MARUTI',
    'AXISBANK',
    'LT',
  ];
  const companies = [
    'Reliance Industries',
    'Tata Consultancy Services',
    'Infosys Limited',
    'Hindustan Unilever',
    'ICICI Bank',
    'State Bank of India',
    'Bajaj Finserv',
    'Maruti Suzuki India',
    'Axis Bank',
    'Larsen & Toubro',
  ];
  const groups: Order['group'][] = ['nifty50', 'niftymidcap150', 'niftysmallcap250'];

  return tickers.map((ticker, idx) => ({
    ticker,
    companyName: companies[idx],
    ltp: Math.random() * 2000 + 500,
    changePercent: (Math.random() - 0.5) * 10,
    volume: Math.random() * 1000000,
    ordersCount: Math.floor(Math.random() * 5),
    hasHighSignal: Math.random() > 0.6,
    group: groups[Math.floor(Math.random() * groups.length)],
  }));
}

function generateMockDetail(order: Order): DetailData {
  return {
    ticker: order.ticker,
    companyName: order.companyName,
    ltp: order.ltp,
    changePercent: order.changePercent,
    timeline: [
      {
        id: '1',
        date: '2026-03-30',
        description: 'Block Deal',
        quantity: 50000,
        price: order.ltp,
      },
      {
        id: '2',
        date: '2026-03-29',
        description: 'Bulk Deal',
        quantity: 100000,
        price: order.ltp - 50,
      },
    ],
    news: [
      {
        id: '1',
        title: 'Q4 Results Announcement',
        date: '2026-03-28',
        source: 'BSE',
      },
      {
        id: '2',
        title: 'Board Meeting - Dividend Discussion',
        date: '2026-03-25',
        source: 'NSE',
      },
    ],
  };
}
