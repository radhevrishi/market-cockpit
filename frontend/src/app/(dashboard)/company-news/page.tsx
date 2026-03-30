'use client';

import { useEffect, useState } from 'react';
import { FileText, Filter, RefreshCw, ChevronDown, ChevronRight, Calendar, Building2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface CompanyNews {
  id: string;
  company: string;
  ticker: string;
  date: string;
  headline: string;
  category: string;
  importance: 'high' | 'medium' | 'low';
  description?: string;
}

interface NewsResponse {
  news: CompanyNews[];
  summary?: {
    totalItems: number;
    companiesCovered: number;
    topCategories: string[];
  };
  updatedAt: string;
}

const THEME = {
  background: '#0B1426',
  card: '#1A2B3C',
  cardHover: '#243445',
  border: '#2A3B4C',
  textPrimary: '#F5F7FA',
  textSecondary: '#8BA3C1',
  accent: '#0F7ABF',
  green: '#10B981',
  red: '#EF4444',
  yellow: '#FBBF24',
  purple: '#8B5CF6',
  cyan: '#06B6D4',
  orange: '#F97316',
  blue: '#3B82F6',
  gray: '#6B7280',
};

const CATEGORY_COLORS: Record<string, string> = {
  'Financial Results': THEME.blue,
  'Orders & Contracts': THEME.green,
  'M&A': THEME.purple,
  'Dividend': THEME.yellow,
  'Fund Raising': THEME.cyan,
  'Management Change': THEME.orange,
};

const DEFAULT_TICKERS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BAJFINANCE', 'TATAMOTORS'];

const CATEGORIES = [
  'All',
  'Financial Results',
  'Orders & Contracts',
  'M&A',
  'Dividend',
  'Fund Raising',
  'Management Change',
  'Others',
];

const IMPORTANCE_LEVELS = ['All', 'High', 'Medium', 'Low'];
const DAYS_OPTIONS = [7, 14, 30, 45, 90];

export default function CompanyNewsPage() {
  const [news, setNews] = useState<CompanyNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Filters
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedImportance, setSelectedImportance] = useState('All');
  const [selectedDays, setSelectedDays] = useState(30);
  const [searchCompany, setSearchCompany] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Summary data
  const [summary, setSummary] = useState({
    totalItems: 0,
    companiesCovered: 0,
    topCategories: [] as string[],
  });

  const fetchNews = async (tickers?: string[]) => {
    try {
      setLoading(true);
      let tickersToFetch = tickers;

      if (!tickersToFetch) {
        const stored = localStorage.getItem('mc_watchlist_tickers');
        tickersToFetch = stored ? JSON.parse(stored) : DEFAULT_TICKERS;
      }

      const symbolsParam = tickersToFetch.join(',');
      const response = await fetch(
        `/api/market/company-news?symbols=${symbolsParam}&days=${selectedDays}&limit=10`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch company news');
      }

      const data: NewsResponse = await response.json();
      setNews(data.news || []);
      setSummary(data.summary || {
        totalItems: data.news?.length || 0,
        companiesCovered: new Set(data.news?.map(n => n.ticker)).size || 0,
        topCategories: [],
      });
      setLastUpdated(data.updatedAt);
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      toast.error(message);
      console.error('Error fetching company news:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(() => fetchNews(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchNews();
  }, [selectedDays]);

  const handleRefresh = () => {
    fetchNews();
    toast.success('News refreshed');
  };

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Apply filters
  const filteredNews = news.filter(item => {
    const categoryMatch = selectedCategory === 'All' || item.category === selectedCategory;
    const importanceMatch = selectedImportance === 'All' || item.importance === selectedImportance.toLowerCase();
    const companyMatch = searchCompany === '' || item.ticker.toLowerCase().includes(searchCompany.toLowerCase()) || item.company.toLowerCase().includes(searchCompany.toLowerCase());
    return categoryMatch && importanceMatch && companyMatch;
  });

  // Group by date
  const groupedByDate = filteredNews.reduce((acc, item) => {
    const date = new Date(item.date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(item);
    return acc;
  }, {} as Record<string, CompanyNews[]>);

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  const getCategoryColor = (category: string) => {
    return CATEGORY_COLORS[category] || THEME.gray;
  };

  const getImportanceColor = (importance: string) => {
    switch (importance) {
      case 'high':
        return THEME.red;
      case 'medium':
        return THEME.yellow;
      case 'low':
        return THEME.gray;
      default:
        return THEME.gray;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{
      backgroundColor: THEME.background,
      minHeight: '100vh',
      padding: '24px',
      color: THEME.textPrimary,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            <FileText size={32} />
            Company News
          </h1>
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: THEME.card,
              border: `1px solid ${THEME.border}`,
              color: THEME.textPrimary,
              padding: '8px 12px',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              opacity: loading ? 0.5 : 1,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = THEME.cardHover)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = THEME.card)}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
        <p style={{
          color: THEME.textSecondary,
          margin: 0,
          fontSize: '14px',
        }}>
          Track corporate announcements and news from your watchlist companies
        </p>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Summary Cards */}
      {!loading && !error && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}>
          {/* Total News */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '8px',
            padding: '16px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = THEME.cardHover;
            e.currentTarget.style.borderColor = THEME.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = THEME.card;
            e.currentTarget.style.borderColor = THEME.border;
          }}>
            <div style={{
              fontSize: '11px',
              color: THEME.textSecondary,
              textTransform: 'uppercase',
              marginBottom: '8px',
              letterSpacing: '0.5px',
            }}>
              Total News Items
            </div>
            <div style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: THEME.accent,
            }}>
              {summary.totalItems}
            </div>
          </div>

          {/* Companies Covered */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '8px',
            padding: '16px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = THEME.cardHover;
            e.currentTarget.style.borderColor = THEME.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = THEME.card;
            e.currentTarget.style.borderColor = THEME.border;
          }}>
            <div style={{
              fontSize: '11px',
              color: THEME.textSecondary,
              textTransform: 'uppercase',
              marginBottom: '8px',
              letterSpacing: '0.5px',
            }}>
              Companies Covered
            </div>
            <div style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: THEME.green,
            }}>
              {summary.companiesCovered}
            </div>
          </div>

          {/* Top Categories */}
          <div style={{
            backgroundColor: THEME.card,
            border: `1px solid ${THEME.border}`,
            borderRadius: '8px',
            padding: '16px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = THEME.cardHover;
            e.currentTarget.style.borderColor = THEME.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = THEME.card;
            e.currentTarget.style.borderColor = THEME.border;
          }}>
            <div style={{
              fontSize: '11px',
              color: THEME.textSecondary,
              textTransform: 'uppercase',
              marginBottom: '8px',
              letterSpacing: '0.5px',
            }}>
              Top Categories
            </div>
            <div style={{
              fontSize: '13px',
              color: THEME.textPrimary,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
            }}>
              {summary.topCategories.slice(0, 2).map(cat => (
                <span key={cat} style={{
                  backgroundColor: THEME.border,
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '11px',
                }}>
                  {cat}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{
        backgroundColor: THEME.card,
        border: `1px solid ${THEME.border}`,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '32px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
          color: THEME.textSecondary,
          fontSize: '12px',
          fontWeight: '500',
        }}>
          <Filter size={16} />
          Filters
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}>
          {/* Category Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '11px',
              color: THEME.textSecondary,
              textTransform: 'uppercase',
              marginBottom: '6px',
              letterSpacing: '0.5px',
            }}>
              Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: THEME.background,
                border: `1px solid ${THEME.border}`,
                color: THEME.textPrimary,
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Importance Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '11px',
              color: THEME.textSecondary,
              textTransform: 'uppercase',
              marginBottom: '6px',
              letterSpacing: '0.5px',
            }}>
              Importance
            </label>
            <select
              value={selectedImportance}
              onChange={(e) => setSelectedImportance(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: THEME.background,
                border: `1px solid ${THEME.border}`,
                color: THEME.textPrimary,
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {IMPORTANCE_LEVELS.map(imp => (
                <option key={imp} value={imp}>{imp}</option>
              ))}
            </select>
          </div>

          {/* Days Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '11px',
              color: THEME.textSecondary,
              textTransform: 'uppercase',
              marginBottom: '6px',
              letterSpacing: '0.5px',
            }}>
              Time Period
            </label>
            <select
              value={selectedDays}
              onChange={(e) => setSelectedDays(parseInt(e.target.value))}
              style={{
                width: '100%',
                backgroundColor: THEME.background,
                border: `1px solid ${THEME.border}`,
                color: THEME.textPrimary,
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {DAYS_OPTIONS.map(days => (
                <option key={days} value={days}>Last {days} days</option>
              ))}
            </select>
          </div>

          {/* Company Search */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '11px',
              color: THEME.textSecondary,
              textTransform: 'uppercase',
              marginBottom: '6px',
              letterSpacing: '0.5px',
            }}>
              Company
            </label>
            <input
              type="text"
              placeholder="Search company or ticker..."
              value={searchCompany}
              onChange={(e) => setSearchCompany(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: THEME.background,
                border: `1px solid ${THEME.border}`,
                color: THEME.textPrimary,
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '13px',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '400px',
        }}>
          <div style={{
            display: 'inline-block',
            width: '40px',
            height: '40px',
            border: `3px solid ${THEME.border}`,
            borderTop: `3px solid ${THEME.accent}`,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div style={{
          backgroundColor: THEME.card,
          border: `1px solid ${THEME.red}`,
          borderRadius: '8px',
          padding: '16px',
          color: THEME.red,
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <AlertCircle size={20} />
          <div>
            <strong>Error loading news:</strong> {error}
          </div>
        </div>
      )}

      {/* News by Date */}
      {!loading && !error && sortedDates.length > 0 && (
        <div>
          {sortedDates.map(date => (
            <div key={date} style={{ marginBottom: '32px' }}>
              {/* Date Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: `1px solid ${THEME.border}`,
              }}>
                <Calendar size={18} style={{ color: THEME.accent }} />
                <h2 style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  margin: 0,
                  color: THEME.textPrimary,
                }}>
                  {date}
                </h2>
                <span style={{
                  backgroundColor: THEME.border,
                  color: THEME.textSecondary,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}>
                  {groupedByDate[date].length} item{groupedByDate[date].length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* News Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {groupedByDate[date].map(item => (
                  <div
                    key={item.id}
                    style={{
                      backgroundColor: THEME.card,
                      border: `1px solid ${THEME.border}`,
                      borderRadius: '8px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onClick={() => toggleExpand(item.id)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = THEME.cardHover;
                      e.currentTarget.style.borderColor = THEME.accent;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = THEME.card;
                      e.currentTarget.style.borderColor = THEME.border;
                    }}
                  >
                    {/* Main Row */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                    }}>
                      {/* Importance Indicator */}
                      <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: getImportanceColor(item.importance),
                        marginTop: '8px',
                        flexShrink: 0,
                      }} />

                      {/* Content */}
                      <div style={{ flex: 1 }}>
                        {/* Header with Company Badge and Time */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          marginBottom: '8px',
                          flexWrap: 'wrap',
                        }}>
                          <span style={{
                            backgroundColor: THEME.border,
                            color: THEME.textPrimary,
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}>
                            <Building2 size={12} />
                            {item.ticker}
                          </span>
                          <span style={{
                            backgroundColor: getCategoryColor(item.category),
                            color: THEME.background,
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 'bold',
                          }}>
                            {item.category}
                          </span>
                          <span style={{
                            color: THEME.textSecondary,
                            fontSize: '11px',
                            marginLeft: 'auto',
                          }}>
                            {formatTime(item.date)}
                          </span>
                        </div>

                        {/* Headline */}
                        <h3 style={{
                          margin: '0 0 12px 0',
                          fontSize: '14px',
                          fontWeight: '600',
                          color: THEME.textPrimary,
                          lineHeight: '1.5',
                        }}>
                          {item.headline}
                        </h3>

                        {/* Expanded Content */}
                        {expandedItems.has(item.id) && item.description && (
                          <div style={{
                            backgroundColor: THEME.background,
                            padding: '12px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            color: THEME.textSecondary,
                            lineHeight: '1.6',
                            marginTop: '12px',
                          }}>
                            {item.description}
                          </div>
                        )}

                        {/* Footer */}
                        {item.description && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginTop: '8px',
                            color: THEME.textSecondary,
                            fontSize: '12px',
                          }}>
                            {expandedItems.has(item.id) ? (
                              <>
                                <ChevronDown size={14} />
                                Hide details
                              </>
                            ) : (
                              <>
                                <ChevronRight size={14} />
                                View details
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && sortedDates.length === 0 && (
        <div style={{
          backgroundColor: THEME.card,
          border: `1px solid ${THEME.border}`,
          borderRadius: '8px',
          padding: '60px 20px',
          textAlign: 'center',
          color: THEME.textSecondary,
        }}>
          <FileText size={48} style={{
            color: THEME.border,
            marginBottom: '16px',
          }} />
          <p style={{
            margin: 0,
            marginBottom: '8px',
            fontSize: '16px',
            fontWeight: '500',
          }}>
            No company news found
          </p>
          <p style={{
            margin: 0,
            fontSize: '13px',
          }}>
            Add stocks to your watchlist to see their corporate announcements.
          </p>
        </div>
      )}

      {/* Last Updated */}
      {lastUpdated && !loading && (
        <div style={{
          marginTop: '32px',
          paddingTop: '16px',
          borderTop: `1px solid ${THEME.border}`,
          fontSize: '12px',
          color: THEME.textSecondary,
          textAlign: 'center',
        }}>
          Last updated: {new Date(lastUpdated).toLocaleString('en-IN')}
        </div>
      )}
    </div>
  );
}
