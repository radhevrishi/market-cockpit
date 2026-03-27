// User & Auth
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  preferences: UserPreferences;
  createdAt: Date;
}

export interface UserPreferences {
  theme: 'dark' | 'light';
  currency: 'INR' | 'USD';
  defaultPortfolioId: string;
  notifications: NotificationPreferences;
}

export interface NotificationPreferences {
  emailAlerts: boolean;
  pushAlerts: boolean;
  priceAlerts: boolean;
  newsAlerts: boolean;
  earningsAlerts: boolean;
}

// Portfolio & Positions
export interface Portfolio {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  currency: 'INR' | 'USD';
  created_at: string | Date;
  updated_at?: string | Date;
  // Computed fields
  total_value?: number;
  day_pnl?: number;
  day_pnl_pct?: number;
  total_pnl?: number;
  total_pnl_pct?: number;
}

export interface Position {
  id: string;
  portfolio_id: string;
  ticker: string;
  exchange: 'NSE' | 'BSE' | 'NASDAQ' | 'NYSE' | 'AMEX';
  company_name: string;
  quantity: number;
  avg_cost: number;
  currency: string;
  notes?: string;
  created_at: string | Date;
  updated_at: string | Date;
  // Enriched from live data
  cmp?: number;
  current_price?: number;
  pnl?: number;
  pnl_pct?: number;
  weight?: number;
  day_change_pct?: number;
  day_change_percent?: number; // alias for day_change_pct (used by PositionRow)
  next_earnings_date?: string;
}

export interface Watchlist {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  created_at: string | Date;
  item_count?: number;
  items?: WatchlistItem[];
}

export interface WatchlistItem {
  id: string;
  watchlist_id: string;
  ticker: string;
  exchange: 'NSE' | 'BSE' | 'NASDAQ' | 'NYSE' | 'AMEX';
  company_name: string;
  added_at: string | Date;
  notes?: string;
  // Enriched from live data
  price?: number | null;
  change_pct?: number | null;
  currency?: string;
}

// News & Articles
export interface NewsArticle {
  id: string;
  external_id: string;
  // Primary fields from DB
  headline: string;
  source_name: string;
  source_url: string;
  summary?: string;
  region: string;
  sectors?: string[];
  themes?: string[];
  tickers: any[];  // list[str] or list[dict with {ticker, exchange, confidence}]
  importance_score: number;
  sentiment: string;
  article_type: string;
  published_at: string;
  ingested_at?: string;
  is_duplicate?: boolean;
  duplicate_of?: string;
  // Frontend-friendly aliases (populated by backend model_validator)
  title?: string;       // alias for headline
  source?: string;      // alias for source_name
  url?: string;         // alias for source_url
  ticker_symbols?: string[];  // flat list extracted from tickers
}

export interface NewsTickerTag {
  ticker: string;
  exchange: 'NSE' | 'BSE' | 'NASDAQ' | 'NYSE' | 'AMEX';
  companyName: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
}

export interface NewsFilter {
  markets: ('india' | 'us' | 'global')[];
  sectors: string[];
  themes: string[];
  importanceLevel: ('critical' | 'high' | 'medium' | 'low')[];
  timeRange: 'last-hour' | 'last-day' | 'last-week' | 'last-month';
  search?: string;
}

// Calendar Events
export interface CalendarEvent {
  id: string;
  eventType: 'EARNINGS' | 'ECONOMIC' | 'RATING_CHANGE' | 'DIVIDEND' | 'SPLIT' | 'IPO';
  date: Date;
  time?: string;
  ticker?: string;
  companyName?: string;
  exchange?: 'NSE' | 'BSE' | 'NASDAQ' | 'NYSE' | 'AMEX';
  description: string;
  impact?: 'HIGH' | 'MEDIUM' | 'LOW';

  // For earnings
  epsEstimate?: number;
  epsActual?: number;
  revenueEstimate?: number;
  revenueActual?: number;
  beatMiss?: 'beat' | 'miss' | 'in-line' | null;

  // For economic events
  countryCode?: string;
  indicator?: string;
  forecast?: number;
  previous?: number;
  actual?: number;

  // For rating changes
  oldRating?: string;
  newRating?: string;
  targetPrice?: number;
  analyst?: string;
  brokerName?: string;

  // For dividends
  dividendPerShare?: number;
  exDate?: Date;
  paymentDate?: Date;

  source: string;
  sourceUrl?: string;

  // Phase 2 fields
  event_date?: string;
  event_time?: string;
  title?: string;
  status?: string;
  company_name?: string;
  country?: string;
  impact_level?: string;
  analyst_firm?: string;
  rating_prev?: string;
  rating_new?: string;
  price_target?: number;
  change_type?: string;
  dividend_amount?: number;
  dividend_currency?: string;
  record_date?: string;
  pay_date?: string;
  dividend_yield?: number;
}

// Alerts
export interface AlertRule {
  id: string;
  userId: string;
  ticker: string;
  ruleType: 'price-cross' | 'percent-change' | 'volume-spike' | 'news';
  condition: AlertCondition;
  isActive: boolean;
  frequency: 'realtime' | 'hourly' | 'daily';
  createdAt: Date;
}

export interface AlertCondition {
  field: string;
  operator: '>' | '<' | '=' | '!=' | '>=' | '<=';
  value: number | string;
}

export interface AlertInstance {
  id: string;
  ruleId: string;
  ticker: string;
  message: string;
  triggeredAt: Date;
  read: boolean;
  actionUrl?: string;
}

// Quote & OHLCV
export interface Quote {
  ticker: string;
  exchange: 'NSE' | 'BSE' | 'NASDAQ' | 'NYSE' | 'AMEX';
  name: string;
  currentPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  dayChange: number;
  dayChangePercent: number;
  volume: number;
  avgVolume: number;
  marketCap?: number;
  pe?: number;
  eps?: number;
  dividend?: number;
  lastUpdated: Date;
}

export interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Market Index
export interface MarketIndex {
  symbol: string;
  name: string;
  country: 'IN' | 'US';
  price: number;
  change: number;
  changePercent: number;
  lastUpdated: Date;
  currencyCode: string;
}

// AI Brief
export interface AIBrief {
  id: string;
  userId: string;
  briefType: 'morning' | 'evening' | 'custom';
  generatedAt: Date;
  portfolioAnalysis: {
    totalValue: number;
    dayChange: number;
    dayChangePercent: number;
    topGainers: Position[];
    topLosers: Position[];
  };
  keyMovers: {
    title: string;
    description: string;
  }[];
  upcomingEvents: CalendarEvent[];
  riskAlerts: {
    severity: 'critical' | 'high' | 'medium';
    title: string;
    description: string;
  }[];
  recommendations?: string[];
  summary: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  context?: {
    ticker?: string;
    portfolioId?: string;
  };
}

export interface SavedBrief {
  id: string;
  userId: string;
  title: string;
  brief: AIBrief;
  savedAt: Date;
}

// Global Markets
export interface GlobalMarketsState {
  indices: MarketIndex[];
  currencies: { pair: string; rate: number; change: number }[];
  commodities: { symbol: string; name: string; price: number; change: number }[];
  lastUpdated: Date;
}

// API Response Wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
