'use client';

import { useEffect, useState, useMemo } from 'react';
import { FileText, Filter, RefreshCw, ChevronDown, ChevronRight, Calendar, Star, TrendingUp, TrendingDown, Minus, AlertCircle, Zap, Eye, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

interface CompanyNews {
  id: string;
  company: string;
  ticker: string;
  date: string;
  headline: string;
  category: string;
  importance: 'high' | 'medium' | 'low';
  materialityScore?: number;
  description?: string;
  eventSummary?: string;
  sentiment?: 'Positive' | 'Neutral' | 'Negative';
  actionability?: 'Actionable' | 'Track' | 'Noise';
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

const T = {
  bg: '#0B1426',
  card: '#111D2E',
  cardHover: '#182A3E',
  cardHighlight: '#0F2030',
  border: '#1E3044',
  borderAccent: '#1A3A5C',
  text: '#E8EDF4',
  textMuted: '#7A95B4',
  textDim: '#4D6A8A',
  accent: '#2196F3',
  gold: '#FFB300',
  goldDim: '#8B6914',
  green: '#00C853',
  greenDim: '#0A3D1F',
  red: '#FF5252',
  redDim: '#3D1515',
  purple: '#9C6ADE',
  cyan: '#00BCD4',
  orange: '#FF9100',
  blue: '#448AFF',
  white: '#FFFFFF',
};

const CATEGORY_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  'Financial Results': { color: T.blue, label: 'RESULTS', icon: 'chart' },
  'Orders & Contracts': { color: T.green, label: 'ORDERS', icon: 'deal' },
  'M&A': { color: T.purple, label: 'M&A', icon: 'merge' },
  'Dividend': { color: T.gold, label: 'DIVIDEND', icon: 'cash' },
  'Fund Raising': { color: T.cyan, label: 'FUND RAISE', icon: 'fund' },
  'Management Change': { color: T.orange, label: 'MGMT', icon: 'people' },
  'Capex/Expansion': { color: T.green, label: 'CAPEX', icon: 'build' },
  'Block Deal': { color: T.purple, label: 'BLOCK DEAL', icon: 'deal' },
  'Bulk Deal': { color: T.purple, label: 'BULK DEAL', icon: 'deal' },
  'Stake Sale': { color: T.orange, label: 'STAKE', icon: 'deal' },
};

const DEFAULT_TICKERS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BAJFINANCE', 'TATAMOTORS'];
const CATEGORIES = ['All', 'Financial Results', 'Orders & Contracts', 'M&A', 'Dividend', 'Fund Raising', 'Management Change', 'Others'];
const IMPORTANCE_LEVELS = ['All', 'High', 'Medium', 'Low'];
const DAYS_OPTIONS = [7, 14, 30, 45, 90];

// ── Priority score: determines sort order within each date group ──────────────
function computePriority(item: CompanyNews): number {
  let score = 0;
  // Importance weight (primary)
  if (item.importance === 'high') score += 1000;
  else if (item.importance === 'medium') score += 500;
  // Materiality weight
  score += (item.materialityScore || 0) * 5;
  // Actionability weight
  if (item.actionability === 'Actionable') score += 300;
  else if (item.actionability === 'Track') score += 100;
  // Category weight — financial events > governance
  const catWeights: Record<string, number> = {
    'Financial Results': 200, 'Orders & Contracts': 180, 'M&A': 170,
    'Fund Raising': 150, 'Capex/Expansion': 140, 'Dividend': 100,
    'Block Deal': 90, 'Bulk Deal': 85, 'Stake Sale': 80,
    'Management Change': 60,
  };
  score += catWeights[item.category] || 30;
  // Sentiment boost
  if (item.sentiment === 'Positive') score += 50;
  else if (item.sentiment === 'Negative') score += 80; // negative = more important to surface
  return score;
}

// ── Star rating from priority ─────────────────────────────────────────────────
function getStarRating(item: CompanyNews): number {
  if (item.importance === 'high' && item.actionability === 'Actionable') return 3;
  if (item.importance === 'high') return 2;
  if (item.importance === 'medium' && (item.materialityScore || 0) >= 50) return 2;
  if (item.importance === 'medium') return 1;
  return 0;
}

function StarRating({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: '1px', marginRight: '6px', verticalAlign: 'middle' }}>
      {Array.from({ length: count }, (_, i) => (
        <Star key={i} size={12} fill={T.gold} color={T.gold} />
      ))}
    </span>
  );
}

function SentimentIcon({ sentiment }: { sentiment?: string }) {
  if (sentiment === 'Positive') return <TrendingUp size={13} color={T.green} />;
  if (sentiment === 'Negative') return <TrendingDown size={13} color={T.red} />;
  return <Minus size={13} color={T.textDim} />;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const d = new Date(dateStr).getTime();
  const diff = now - d;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'Just now';
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function CompanyNewsPage() {
  const [news, setNews] = useState<CompanyNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedImportance, setSelectedImportance] = useState('All');
  const [selectedDays, setSelectedDays] = useState(30);
  const [searchCompany, setSearchCompany] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState({ totalItems: 0, companiesCovered: 0, topCategories: [] as string[] });

  const fetchNews = async (tickers?: string[]) => {
    try {
      setLoading(true);
      let tickersToFetch = tickers;
      if (!tickersToFetch || tickersToFetch.length === 0) {
        const stored = localStorage.getItem('mc_watchlist_tickers');
        tickersToFetch = stored ? JSON.parse(stored) : DEFAULT_TICKERS;
      }
      const symbolsParam = (tickersToFetch || DEFAULT_TICKERS).join(',');
      const response = await fetch(`/api/market/company-news?symbols=${symbolsParam}&days=${selectedDays}&limit=10`);
      if (!response.ok) throw new Error('Failed to fetch company news');
      const data: NewsResponse = await response.json();
      setNews(data.news || []);
      setSummary(data.summary || { totalItems: data.news?.length || 0, companiesCovered: new Set(data.news?.map(n => n.ticker)).size || 0, topCategories: [] });
      setLastUpdated(data.updatedAt);
      setError('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchNews(); const iv = setInterval(() => fetchNews(), 5 * 60 * 1000); return () => clearInterval(iv); }, []);
  useEffect(() => { fetchNews(); }, [selectedDays]);

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  // ── Derived data ────────────────────────────────────────────────────────────
  const filteredNews = useMemo(() => {
    return news.filter(item => {
      const catOk = selectedCategory === 'All' || item.category === selectedCategory;
      const impOk = selectedImportance === 'All' || item.importance === selectedImportance.toLowerCase();
      const compOk = !searchCompany || item.ticker.toLowerCase().includes(searchCompany.toLowerCase()) || item.company.toLowerCase().includes(searchCompany.toLowerCase());
      return catOk && impOk && compOk;
    });
  }, [news, selectedCategory, selectedImportance, searchCompany]);

  // Top Stories: high importance + actionable, sorted by priority
  const topStories = useMemo(() => {
    return filteredNews
      .filter(n => n.importance === 'high' || (n.actionability === 'Actionable') || (n.materialityScore && n.materialityScore >= 60))
      .sort((a, b) => computePriority(b) - computePriority(a))
      .slice(0, 5);
  }, [filteredNews]);

  const topStoryIds = useMemo(() => new Set(topStories.map(s => s.id)), [topStories]);

  // Group remaining by date, sorted by priority within each date
  const groupedByDate = useMemo(() => {
    const remaining = filteredNews.filter(n => !topStoryIds.has(n.id));
    const groups: Record<string, CompanyNews[]> = {};
    for (const item of remaining) {
      const d = new Date(item.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
      (groups[d] = groups[d] || []).push(item);
    }
    // Sort within each date group by priority
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => computePriority(b) - computePriority(a));
    }
    return groups;
  }, [filteredNews, topStoryIds]);

  const sortedDates = useMemo(() => Object.keys(groupedByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), [groupedByDate]);

  // Stats
  const highCount = filteredNews.filter(n => n.importance === 'high').length;
  const actionableCount = filteredNews.filter(n => n.actionability === 'Actionable').length;
  const positiveCount = filteredNews.filter(n => n.sentiment === 'Positive').length;
  const negativeCount = filteredNews.filter(n => n.sentiment === 'Negative').length;

  const getCatConfig = (cat: string) => CATEGORY_CONFIG[cat] || { color: T.textDim, label: cat.toUpperCase().slice(0, 8), icon: 'other' };

  // ── Shared styles ───────────────────────────────────────────────────────────
  const selectStyle: React.CSSProperties = {
    width: '100%', backgroundColor: T.bg, border: `1px solid ${T.border}`, color: T.text,
    padding: '7px 10px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '10px', color: T.textDim, textTransform: 'uppercase',
    marginBottom: '4px', letterSpacing: '0.8px', fontWeight: 600,
  };

  // ── NEWS CARD COMPONENT ─────────────────────────────────────────────────────
  const NewsCard = ({ item, featured = false }: { item: CompanyNews; featured?: boolean }) => {
    const stars = getStarRating(item);
    const cat = getCatConfig(item.category);
    const expanded = expandedItems.has(item.id);
    const borderColor = item.importance === 'high' ? T.gold : item.importance === 'medium' ? T.accent : T.border;
    const bgColor = featured ? T.cardHighlight : T.card;

    return (
      <div
        onClick={() => toggleExpand(item.id)}
        style={{
          backgroundColor: bgColor,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: '6px',
          padding: featured ? '16px 16px 12px' : '12px 14px 10px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          position: 'relative',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = T.cardHover; e.currentTarget.style.borderColor = T.borderAccent; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = bgColor; e.currentTarget.style.borderColor = T.border; }}
      >
        {/* Row 1: Headline */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: featured ? '14px' : '13px', fontWeight: 600, color: T.text, lineHeight: 1.45,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
            }}>
              <StarRating count={stars} />
              {item.eventSummary || item.headline}
            </div>
          </div>
          {/* Sentiment indicator */}
          <div style={{ flexShrink: 0, paddingTop: '2px' }}>
            <SentimentIcon sentiment={item.sentiment} />
          </div>
        </div>

        {/* Row 2: Metadata strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {/* Ticker */}
          <span style={{
            backgroundColor: T.bg, color: T.accent, padding: '2px 6px', borderRadius: '3px',
            fontSize: '10px', fontWeight: 700, fontFamily: "'SF Mono', 'Fira Code', monospace", letterSpacing: '0.3px',
          }}>
            {item.ticker}
          </span>
          {/* Category pill */}
          <span style={{
            backgroundColor: `${cat.color}18`, color: cat.color, border: `1px solid ${cat.color}30`,
            padding: '1px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
          }}>
            {cat.label}
          </span>
          {/* Sentiment text */}
          {item.sentiment && item.sentiment !== 'Neutral' && (
            <span style={{
              color: item.sentiment === 'Positive' ? T.green : T.red,
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.3px',
            }}>
              {item.sentiment === 'Positive' ? 'BULLISH' : 'BEARISH'}
            </span>
          )}
          {/* Actionability */}
          {item.actionability === 'Actionable' && (
            <span style={{
              backgroundColor: `${T.red}15`, color: T.red, border: `1px solid ${T.red}30`,
              padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 800, letterSpacing: '0.5px',
              display: 'inline-flex', alignItems: 'center', gap: '3px',
            }}>
              <Zap size={8} /> ACTION
            </span>
          )}
          {item.actionability === 'Track' && (
            <span style={{
              backgroundColor: `${T.gold}12`, color: T.gold,
              padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 700, letterSpacing: '0.3px',
              display: 'inline-flex', alignItems: 'center', gap: '3px',
            }}>
              <Eye size={8} /> TRACK
            </span>
          )}
          {/* Materiality bar */}
          {item.materialityScore !== undefined && item.materialityScore > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '2px',
            }}>
              <span style={{
                width: '32px', height: '4px', backgroundColor: T.bg, borderRadius: '2px', overflow: 'hidden',
                display: 'inline-block', position: 'relative',
              }}>
                <span style={{
                  position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: '2px',
                  width: `${Math.min(100, item.materialityScore)}%`,
                  backgroundColor: item.materialityScore >= 70 ? T.green : item.materialityScore >= 40 ? T.gold : T.textDim,
                }} />
              </span>
              <span style={{ fontSize: '9px', color: T.textDim, fontFamily: 'monospace' }}>{item.materialityScore}</span>
            </span>
          )}
          {/* Time - pushed right */}
          <span style={{
            marginLeft: 'auto', fontSize: '10px', color: T.textDim,
            display: 'inline-flex', alignItems: 'center', gap: '3px',
          }}>
            <Clock size={9} />
            {relativeTime(item.date)}
          </span>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div style={{
            marginTop: '10px', padding: '10px 12px', backgroundColor: T.bg, borderRadius: '4px',
            border: `1px solid ${T.border}`, fontSize: '12px', color: T.textMuted, lineHeight: 1.7,
          }}>
            {item.headline !== item.eventSummary && item.eventSummary && (
              <div style={{ marginBottom: '6px', fontWeight: 600, color: T.text, fontSize: '12px' }}>
                {item.headline}
              </div>
            )}
            {item.description && <div>{item.description}</div>}
            {!item.description && !item.headline && <div style={{ color: T.textDim }}>No additional details available</div>}
          </div>
        )}

        {/* Expand indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '3px', marginTop: '6px',
          color: T.textDim, fontSize: '10px',
        }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? 'Collapse' : 'Details'}
        </div>
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: T.bg, minHeight: '100vh', padding: '20px 24px', color: T.text, fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', letterSpacing: '-0.3px' }}>
            <FileText size={22} color={T.accent} />
            Company News
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: T.textDim }}>
            Corporate announcements ranked by materiality
          </p>
        </div>
        <button
          onClick={() => { fetchNews(); toast.success('Refreshing...'); }}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: T.card,
            border: `1px solid ${T.border}`, color: T.textMuted, padding: '6px 12px',
            borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '11px',
            fontWeight: 600, opacity: loading ? 0.5 : 1, transition: 'all 0.15s ease',
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* ── STATS BAR ──────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div style={{
          display: 'flex', gap: '1px', marginBottom: '20px', backgroundColor: T.border, borderRadius: '6px', overflow: 'hidden',
        }}>
          {[
            { label: 'Total', value: filteredNews.length, color: T.accent },
            { label: 'High Priority', value: highCount, color: T.gold },
            { label: 'Actionable', value: actionableCount, color: T.red },
            { label: 'Bullish', value: positiveCount, color: T.green },
            { label: 'Bearish', value: negativeCount, color: T.red },
            { label: 'Companies', value: summary.companiesCovered, color: T.cyan },
          ].map(stat => (
            <div key={stat.label} style={{ flex: 1, backgroundColor: T.card, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: stat.color, fontFamily: "'SF Mono', monospace" }}>{stat.value}</div>
              <div style={{ fontSize: '9px', color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: '2px', fontWeight: 600 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── FILTERS ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px',
        backgroundColor: T.card, border: `1px solid ${T.border}`, borderRadius: '6px', padding: '12px 14px',
      }}>
        <div>
          <label style={labelStyle}>Category</label>
          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={selectStyle}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Importance</label>
          <select value={selectedImportance} onChange={(e) => setSelectedImportance(e.target.value)} style={selectStyle}>
            {IMPORTANCE_LEVELS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Period</label>
          <select value={selectedDays} onChange={(e) => setSelectedDays(parseInt(e.target.value))} style={selectStyle}>
            {DAYS_OPTIONS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Search</label>
          <input type="text" placeholder="Ticker or company..." value={searchCompany}
            onChange={(e) => setSearchCompany(e.target.value)}
            style={{ ...selectStyle, fontFamily: 'inherit' }} />
        </div>
      </div>

      {/* ── LOADING ────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <div style={{ width: '32px', height: '32px', border: `2px solid ${T.border}`, borderTop: `2px solid ${T.accent}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* ── ERROR ──────────────────────────────────────────────────────────── */}
      {error && !loading && (
        <div style={{ backgroundColor: T.card, border: `1px solid ${T.red}40`, borderRadius: '6px', padding: '14px', color: T.red, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* ── TOP STORIES ────────────────────────────────────────────────────── */}
      {!loading && !error && topStories.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              backgroundColor: `${T.gold}12`, border: `1px solid ${T.gold}25`,
              padding: '4px 10px', borderRadius: '4px',
            }}>
              <Star size={13} fill={T.gold} color={T.gold} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: T.gold, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                Top Stories
              </span>
            </div>
            <span style={{ fontSize: '10px', color: T.textDim }}>
              Ranked by materiality and market impact
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topStories.map((item, idx) => (
              <div key={item.id} style={{ animation: `fadeIn 0.3s ease ${idx * 0.05}s both` }}>
                <NewsCard item={item} featured />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ALL NEWS BY DATE ───────────────────────────────────────────────── */}
      {!loading && !error && sortedDates.length > 0 && (
        <div>
          {sortedDates.map(date => (
            <div key={date} style={{ marginBottom: '24px' }}>
              {/* Date divider */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
                paddingBottom: '8px', borderBottom: `1px solid ${T.border}`,
              }}>
                <Calendar size={14} color={T.textDim} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: T.textMuted }}>{date}</span>
                <span style={{
                  backgroundColor: T.bg, color: T.textDim, padding: '1px 6px',
                  borderRadius: '3px', fontSize: '10px', fontWeight: 600,
                }}>
                  {groupedByDate[date].length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {groupedByDate[date].map(item => (
                  <NewsCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── EMPTY ──────────────────────────────────────────────────────────── */}
      {!loading && !error && filteredNews.length === 0 && (
        <div style={{
          backgroundColor: T.card, border: `1px solid ${T.border}`, borderRadius: '6px',
          padding: '48px 20px', textAlign: 'center', color: T.textDim,
        }}>
          <FileText size={36} color={T.border} style={{ marginBottom: '12px' }} />
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: T.textMuted }}>No news found</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Add stocks to your watchlist to see corporate announcements</p>
        </div>
      )}

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      {lastUpdated && !loading && (
        <div style={{ marginTop: '24px', paddingTop: '12px', borderTop: `1px solid ${T.border}`, fontSize: '10px', color: T.textDim, textAlign: 'center' }}>
          Updated {new Date(lastUpdated).toLocaleString('en-IN')}
        </div>
      )}
    </div>
  );
}
