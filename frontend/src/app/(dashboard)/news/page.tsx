'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Filter, X, ExternalLink, AlertCircle, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NewsArticle {
  id: string;
  headline: string;
  title: string;
  source_name: string;
  source: string;
  source_url: string;
  url: string;
  published_at: string;
  ingested_at?: string;
  importance_score: number;
  tickers: Array<{ ticker: string; exchange: string; confidence?: number } | string>;
  ticker_symbols: string[];
  region: string;
  article_type: string;
  summary?: string;
  sentiment?: string;
  themes?: string[];
  investment_tier?: number;
  relevance_tags?: string[];
  impact_statement?: string;
  bottleneck_sub_tag?: string;
  bottleneck_level?: string;
  is_synthetic?: boolean;
  structural_status?: string;
  feed_layer?: string;
}

// Bottleneck dashboard types
interface BnSignalArticle {
  id: string;
  headline: string;
  source_name: string;
  source_url: string;
  published_at: string;
  importance_score: number;
  sentiment: string;
}

interface BnSignal {
  headline: string;
  summary: string;
  evidence_count: number;
  sources: string[];
  latest_at: string;
  tickers: string[];
  articles: BnSignalArticle[];
}

interface BnBucket {
  bucket_id: string;
  label: string;
  description: string;
  severity: number;
  severity_label: string;
  severity_color: string;
  severity_icon: string;
  signal_count: number;
  article_count: number;
  key_tickers: string[];
  signals: BnSignal[];
}

interface BnDashboard {
  success: boolean;
  total_articles: number;
  buckets: BnBucket[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIONS = ['ALL', 'IN', 'US'] as const;
const TYPES   = ['ALL', 'BOTTLENECK', 'EARNINGS', 'RATING_CHANGE', 'MACRO', 'GEOPOLITICAL', 'TARIFF', 'CORPORATE', 'GENERAL'] as const;
const SOURCES = [
  'ALL',
  // India
  'ET Markets', 'ET Industry', 'ET Economy', 'MoneyControl', 'LiveMint', 'Business Standard', 'BS Economy',
  'Yahoo Finance IN', 'PIB India', 'ElectronicsB2B', 'IBEF',
  // US / Global Macro
  'Yahoo Finance US', 'Yahoo Finance US Financials', 'CNBC', 'CNBC Tech', 'MarketWatch', 'Bloomberg', 'Reuters Finance',
  // Semiconductor & Supply Chain
  'SemiAnalysis', 'DigiTimes', 'EE Times', 'Semiconductor Engineering', 'IEEE Spectrum', 'Evertiq', 'SEMI',
  'Yahoo Tech Semis', 'Yahoo Data Center',
  // Hyperscaler / AI Infra
  'The Register', 'ServeTheHome', 'The Information', 'Techmeme',
  // Policy & Geopolitics
  'CSIS', 'Brookings',
] as const;
// Signal filter: maps to investment_tier (1=HIGH, 2=MEDIUM, 3=NOISE)
const SIGNAL_FILTERS = [
  { value: 'ALL', label: 'All Signals', icon: '' },
  { value: 'HIGH', label: '🔴 High', icon: '🔴' },
  { value: 'MEDIUM', label: '🟡 Medium', icon: '🟡' },
] as const;

// Layer classification for institutional hierarchy
type FeedLayer = 'MACRO_REGIME' | 'STRUCTURAL' | 'COMPANY_ALPHA' | 'GENERAL';
const LAYER_CONFIG: Record<FeedLayer, { label: string; color: string; description: string }> = {
  MACRO_REGIME: { label: 'MACRO REGIME', color: '#DC2626', description: 'Liquidity, rates, commodities, geopolitical' },
  STRUCTURAL: { label: 'STRUCTURAL THEMES', color: '#8B5CF6', description: 'AI infrastructure, defense, energy, semiconductors' },
  COMPANY_ALPHA: { label: 'COMPANY ALPHA', color: '#0F7ABF', description: 'Earnings, contracts, guidance, M&A' },
  GENERAL: { label: 'MARKET INTEL', color: '#4A5B6C', description: 'Industry news & analysis' },
};

function getArticleLayer(article: NewsArticle): FeedLayer {
  const type = article.article_type;
  if (type === 'MACRO' || type === 'GEOPOLITICAL' || type === 'TARIFF') return 'MACRO_REGIME';
  if (type === 'BOTTLENECK') return 'STRUCTURAL';
  if (type === 'EARNINGS' || type === 'RATING_CHANGE' || type === 'CORPORATE') return 'COMPANY_ALPHA';
  // For GENERAL articles, check if they have structural theme indicators
  const text = (article.title || article.headline || '').toLowerCase();
  if (/\b(semiconductor|chip|gpu|hbm|data center|ai infrastructure|defense|energy transition)\b/.test(text)) return 'STRUCTURAL';
  if (/\b(earnings|revenue|profit|guidance|quarterly|q[1-4])\b/.test(text)) return 'COMPANY_ALPHA';
  if (/\b(oil|crude|fed|rbi|inflation|gdp|rate cut|rate hike|tariff|sanction|war|iran)\b/.test(text)) return 'MACRO_REGIME';
  return 'GENERAL';
}

// Ticker alias map for search expansion (ticker → company name keywords)
const TICKER_ALIASES: Record<string, string[]> = {
  'NVDA': ['nvidia', 'jensen huang', 'blackwell', 'h100'],
  'AAPL': ['apple'],
  'MSFT': ['microsoft', 'azure', 'satya nadella'],
  'GOOGL': ['alphabet', 'google', 'deepmind'],
  'AMZN': ['amazon', 'aws'],
  'META': ['meta platforms', 'facebook', 'zuckerberg'],
  'TSLA': ['tesla', 'elon musk'],
  'AMD': ['amd', 'lisa su'],
  'INTC': ['intel'],
  'TSM': ['tsmc', 'taiwan semiconductor'],
  'AVGO': ['broadcom'],
  'RELIANCE': ['reliance', 'mukesh ambani'],
  'TCS': ['tata consultancy', 'tcs'],
  'INFY': ['infosys'],
  'HDFCBANK': ['hdfc bank'],
  'WIPRO': ['wipro'],
  'TATAMOTORS': ['tata motors'],
  'ADANIENT': ['adani'],
  'HAL': ['hindustan aeronautics'],
  'BEL': ['bharat electronics'],
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

// Fetch ALL articles once — region, type, source, importance filtered CLIENT-SIDE for instant switching.
// Only search goes to server (requires ILIKE queries).
function useNews(search: string) {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', 'all', search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', importance_min: '1' });

      // Expand ticker search: if user types a ticker like "NVDA", also search for "nvidia"
      let expandedSearch = search;
      if (search) {
        const upperSearch = search.toUpperCase().trim();
        const aliases = TICKER_ALIASES[upperSearch];
        if (aliases) {
          expandedSearch = `${search}|${aliases.join('|')}`;
        }
      }

      if (expandedSearch) params.set('search', expandedSearch);
      const { data } = await api.get(`/news?${params}`);
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: 1,
  });
}

// Client-side filter for instant filter switching
function filterArticles(
  articles: NewsArticle[],
  region: string, type: string, signalFilter: string, sourceName: string,
): NewsArticle[] {
  return articles.filter(a => {
    if (region !== 'ALL' && a.region !== region && a.region !== 'GLOBAL') return false;
    if (type !== 'ALL' && a.article_type !== type) return false;
    // Signal filter: ALL = show HIGH+MEDIUM (hide noise), HIGH = only tier 1, MEDIUM = only tier 2
    if (signalFilter === 'HIGH' && (a.investment_tier || 0) !== 1) return false;
    if (signalFilter === 'MEDIUM' && (a.investment_tier || 0) !== 2) return false;
    if (signalFilter === 'ALL') {
      // Default: hide noise (tier 3) unless no tier assigned (legacy articles)
      if ((a.investment_tier || 0) === 3) return false;
    }
    if (sourceName !== 'ALL') {
      const src = a.source_name || a.source || '';
      if (src !== sourceName) return false;
    }
    return true;
  });
}

function useInPlay() {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', 'in-play'],
    queryFn: async () => {
      const { data } = await api.get('/news/in-play');
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
    retry: 1,
  });
}

function useBottleneckDashboard(enabled: boolean, region: string) {
  return useQuery<BnDashboard>({
    queryKey: ['news', 'bottleneck-dashboard', region],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (region !== 'ALL') params.set('region', region);
      const { data } = await api.get(`/news/bottleneck-dashboard?${params}`);
      return data;
    },
    enabled,
    refetchInterval: 180_000,
    staleTime: 120_000,
    retry: 1,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Decode HTML entities like &amp; → & , &lt; → <, etc.
const decodeHtml = (html: string): string => {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.documentElement.textContent || html;
};

// Tickers that are almost always false positives from NLP extraction
const JUNK_TICKERS = new Set(['ON', 'A', 'IT', 'ALL', 'AN', 'IS', 'ARE', 'OR', 'SO', 'GO', 'DO', 'HE', 'WE', 'AI']);

// Works whether the schema sent ticker_symbols (preferred) or raw tickers dicts
function getTickerSymbols(article: NewsArticle): string[] {
  const raw = article.ticker_symbols?.length
    ? article.ticker_symbols
    : (article.tickers ?? []).map(t =>
        typeof t === 'string' ? t : (t as { ticker: string }).ticker ?? ''
      ).filter(Boolean);
  // Strip known false-positive tickers
  return raw.filter(t => !JUNK_TICKERS.has(t.toUpperCase()));
}

// Prefer the alias `title`, fall back to `headline` — also decode HTML entities
const getTitle = (a: NewsArticle) => decodeHtml(a.title || a.headline || '(no title)');
const getSource = (a: NewsArticle) => a.source || a.source_name || '';
const getUrl = (a: NewsArticle) => cleanUrl(a.url || a.source_url || '#');

// Clean URL: strip CDATA wrappers, ensure absolute, prevent double-domain
const cleanUrl = (raw: string): string => {
  if (!raw || raw === '#') return '#';
  let u = raw.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
  // If URL starts with http inside another domain (double-domain bug), extract the real URL
  const httpIdx = u.indexOf('http', 1);
  if (httpIdx > 0 && u.startsWith('http')) u = u.slice(httpIdx);
  return u;
};

const importanceDot = (s: number) =>
  s >= 5 ? '#EF4444' : s >= 4 ? '#F59E0B' : s >= 3 ? '#0F7ABF' : '#4A5B6C';
const tierBadge = (tier?: number) => {
  if (tier === 1) return { label: '🔴 HIGH', bg: '#EF444418', color: '#EF4444', border: '#EF444440' };
  if (tier === 2) return { label: '🟡 MEDIUM', bg: '#F59E0B12', color: '#F59E0B', border: '#F59E0B30' };
  return null; // Tier 3 = NOISE, no badge shown
};
const typeColor = (t: string) =>
  ({ BOTTLENECK: '#EF4444', EARNINGS: '#10B981', RATING_CHANGE: '#F59E0B', MACRO: '#8B5CF6', GEOPOLITICAL: '#DC2626', TARIFF: '#EA580C', CORPORATE: '#06B6D4', GENERAL: '#4A5B6C' })[t] ?? '#4A5B6C';
const regionFlag = (r: string) => r === 'IN' ? '🇮🇳' : r === 'US' ? '🇺🇸' : '🌐';
const sentimentBadge = (sentiment?: string) => {
  if (!sentiment) return null;
  const upper = sentiment.toUpperCase();
  if (upper === 'BULLISH') {
    return { icon: '↑', label: 'Bullish', bg: '#10B98120', color: '#10B981', border: '#10B98140' };
  } else if (upper === 'BEARISH') {
    return { icon: '↓', label: 'Bearish', bg: '#EF444420', color: '#EF4444', border: '#EF444440' };
  } else if (upper === 'NEUTRAL') {
    return { icon: '●', label: 'Neutral', bg: '#4A5B6C20', color: '#4A5B6C', border: '#4A5B6C40' };
  }
  return null;
};
const timeAgo = (iso: string) => {
  try {
    const d = new Date(iso);
    const now = new Date();
    // If date is in the future, just show the absolute time
    if (d > now) {
      const absolute = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
      const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `${day}, ${absolute}`;
    }
    const relative = formatDistanceToNow(d, { addSuffix: true });
    // Show absolute time like "10:23 AM" alongside relative
    const absolute = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
    const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return isToday ? `${absolute} · ${relative}` : `${day}, ${absolute} · ${relative}`;
  } catch { return ''; }
};

// ── Junk Filter ─────────────────────────────────────────────────────────────
// Filter out personal finance advice, political fluff, lifestyle, and clickbait
// that adds no value to an institutional-grade market dashboard.

const JUNK_HEADLINE_PATTERNS = [
  // Personal finance / advice columns / family money
  /\bmy (friend|wife|husband|partner|adviser|advisor|dad|mom|brother|sister|boss|relative|daughter|son|parent)\b/i,
  /\b(should i buy|can i trust|is it worth|how much should|how to save|retirement plan|nest egg)\b/i,
  /\b(feels slimy|i'm worried|dear moneyist|ask an expert|money etiquette|who'?s right)\b/i,
  /\b(personal finance|side hustle|budgeting tip|credit score|credit card reward|savings account)\b/i,
  /\b(financial adviser|financial advisor|financial planner)\b/i,
  /\b(social security|medicare|medicaid)\s+(benefit|check|payment|tip|stolen)/i,
  /\bhas congress.*(stolen|raided).*social security/i,
  /\b(best (credit card|savings|cd rate|mortgage|insurance))\b/i,
  /\b(an? older relative|give my (daughter|son)|said no\. who)/i,

  // Stock-picking clickbait / promotion
  /\b(top .* analysts? like these dividend)\b/i,
  /\b(like these dividend stocks|solid returns)\b/i,
  /\bgot \$[\d,]+\?.*stocks?\b/i,                          // "Got $5,000? 2 Stocks..."
  /\bwall street is sleeping on\b/i,                        // "Wall Street Is Sleeping on This $13 Stock"
  /\bthe only stock .* (buying|selling)\b/i,                // "The Only Stock Buffett Is Buying"
  /\bcould handily outperform\b/i,
  /\bbuy it now\.?\s*$/i,                                   // headlines ending with "Buy It Now."
  /\b(is|are) built to profit\b/i,                          // "These 3 Energy Stocks Are Built to Profit"
  /\band that'?s your opportunity\b/i,                      // "and That's Your Opportunity"
  /\b(actually worth holding|worth holding\??)\b/i,         // "Is Vanguard's VOT Actually Worth Holding?"
  /\b(it'?s not too late to buy)\b/i,

  // ETF / fund promotion
  /\bthis .* etf is up \d+%/i,                             // "This Vanguard ETF Is up 33% YTD"
  /\b(massive upside|still has massive|has massive upside)\b/i,
  /\b\$[\d.]+ billion in assets and a [\d.]+% fee\b/i,     // "$31.7 Billion in Assets and a 0.05% Fee"
  /\bvanguard'?s (vo[a-z]|vt[a-z]|vf[a-z]|vs[a-z])\b/i,  // Vanguard ETF tickers like VOT, VTI etc.

  // Political fluff not market-related
  /\b(state rep|congressman|senator|governor|mayor)\s+(talk|speak|say|slam|push|defend)/i,
  /\bstaying disciplined on the issues\b/i,
  /\b(campaign trail|election rally|political rally|town hall meeting)\b/i,
  /\b(democrat|republican|gop|liberal|conservative)\s+(slam|attack|defend|push)/i,

  // Non-market news — science, NASA, lifestyle, sports
  /\bnasa\s+(prepares?|launches?|announces?|plans?)\b/i,
  /\b(celebrity|kardashian|oscars|grammy|super bowl|nfl draft|bachelor|bachelorette)\b/i,
  /\b(recipe|cooking tip|travel destination|vacation spot|weight loss|diet plan)\b/i,
  /\b(vibe coding|coding bootcamp|learn to code)\b/i,

  // Clickbait / hindsight / hypothetical returns
  /\b(you won't believe|shocking truth|one weird trick|doctors hate|this changes everything)\b/i,
  /\b(\d+ (things|ways|tips|reasons|secrets|mistakes))\s+(you|to|that|about)/i,
  /\b(ridiculously easy|simple trick|beat the .* experts?)\b/i,
  /\b(if you('d| had| would have)? (bought|invested))\b/i,
  /\b(would have made|could have made|you'd have made|you'd have today)\b/i,
  /\b(return you would|gains you missed|wish you had bought)\b/i,
  /\b(it might make you cry|spoiler:)\b/i,
  /\bhere'?s how much you'?d have\b/i,

  // Parenting / lifestyle / self-help disguised as news
  /\b(i've studied over \d+ kids|skill parents|parenting tip|teach kids)\b/i,
  /\b(no\.?\s*1 skill|number one skill|top skill)\s*(parents|kids|children)/i,
  /\b(can't look away|the case against social media)\b/i,
  /\b(work-life balance|quiet quitting|hustle culture|morning routine)\b/i,

  // Generic "3 big things" / roundups
  /\b\d+ big things we'?re watching\b/i,

  // "Investment opportunities in X" — generic filler
  /\binvestment opportunities in\b/i,
  // Restoration/trust in Congress — political
  /\brestore trust.*congress\b/i,
  /\bdecision making here in congress\b/i,
  // Visa vs Mastercard type comparison articles
  /\bvisa vs\.?\s*mastercard\b/i,
  /\b(which one to own|here'?s which one)\b/i,
  // "Thinking Small" motivational / Jeff Bezos quotes
  /\b(self-fulfilling prophecy|overestimate risk|underestimate opportunity)\b/i,
  // Generic Warren Buffett clickbait
  /\bwarren buffett\b.*\b(buying|selling|loaded up|dumped|poured)\b/i,

  // Retail tips / penny stock noise (India-specific)
  /\b(under ₹|under rs\.?\s*)\d+/i,
  /\bpenny stock/i,
  /\bstocks? to (buy|sell|watch) (on|this) (monday|tuesday|wednesday|thursday|friday)/i,
  /\bjewellery stock to watch/i,
  /\brecommends? (three|two|five|3|2|5) stocks?\b/i,
  /\b(buy or sell):?\s/i,

  // Listicle investing clickbait with specific % claims
  /\b(soars?|surge|jump)\s+\d{2,}%/i,
  /\b\d+ (supercharged|unstoppable|incredible|explosive) .* stock/i,
  /\bultra-high-yielding dividend/i,
  /\bload up on these \d/i,
  /\bbetter (space|tech|ai) stock:/i,

  // Bank holidays / calendar filler
  /\bbank holiday/i,

  // Lifestyle / trivia
  /\b(pokémon|pokemon|logan paul)\b/i,
  /\bviral food trend/i,
];

const JUNK_SOURCE_PATTERNS = [
  /moneyist/i,
  /yahoo finance us financials/i,
  /yahoo tech semis/i,           // often clickbait disguised as tech/semi news
];

function isMarketRelevant(article: NewsArticle): boolean {
  const title = (article.title || article.headline || '');
  const source = (article.source_name || article.source || '');

  // Junk patterns apply to ALL articles — NO bypasses whatsoever
  // Check headline against junk patterns
  for (const pattern of JUNK_HEADLINE_PATTERNS) {
    if (pattern.test(title)) return false;
  }
  // Check source against junk source patterns
  for (const pattern of JUNK_SOURCE_PATTERNS) {
    if (pattern.test(source)) return false;
  }

  return true;
}

// ── Components ────────────────────────────────────────────────────────────────

function NewsCard({ article, onSelect }: { article: NewsArticle; onSelect: (a: NewsArticle) => void }) {
  const symbols = getTickerSymbols(article);
  const title = getTitle(article);
  const source = getSource(article);
  const url = getUrl(article);
  const sentiment = sentimentBadge(article.sentiment);
  const tier = tierBadge(article.investment_tier);

  const isStale = (() => {
    try {
      const d = new Date(article.published_at);
      const daysSince = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince > 7;
    } catch { return false; }
  })();

  const isPersistent = isPersistentSignal(article);
  const isStructural = !!article.is_synthetic
    || article.feed_layer === 'STRUCTURAL_ALPHA'
    || article.structural_status === 'CRITICAL'
    || article.structural_status === 'ELEVATED';

  const handleCardClick = (e: React.MouseEvent) => {
    // If clicking inner buttons, don't navigate
    if ((e.target as HTMLElement).closest('button')) return;
    if (url && url !== '#') {
      // Use <a> navigation below, don't handle here
      return;
    }
    onSelect(article);
  };

  const CardWrapper = url && url !== '#' ? 'a' : 'div';
  const cardProps = url && url !== '#'
    ? { href: url, target: '_blank' as const, rel: 'noopener noreferrer' }
    : {};

  return (
    <CardWrapper
      {...cardProps}
      className="news-card"
      style={{ display: 'block', backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s', opacity: (isStale && !isPersistent && !isStructural) ? 0.55 : 1, textDecoration: 'none', color: 'inherit' }}
      onClick={handleCardClick}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: importanceDot(article.importance_score), flexShrink: 0, marginTop: '7px' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: '#4A5B6C' }}>{regionFlag(article.region)}</span>
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
              backgroundColor: typeColor(article.article_type) + '22',
              color: typeColor(article.article_type),
              border: `1px solid ${typeColor(article.article_type)}40`,
            }}>
              {article.article_type?.replace(/_/g, ' ')}
            </span>
            {isStale && !isPersistent && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: '#78350F20', color: '#F59E0B', border: '1px solid #F59E0B30',
                letterSpacing: '0.3px',
              }}>
                STALE
              </span>
            )}
            {isPersistent && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: '#8B5CF615', color: '#A78BFA', border: '1px solid #8B5CF640',
                letterSpacing: '0.3px',
              }}>
                PERSISTENT
              </span>
            )}
            {isStructural && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: '#6366F115', color: '#818CF8', border: '1px solid #6366F140',
                letterSpacing: '0.3px',
              }}>
                STRUCTURAL
              </span>
            )}
            {tier && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: tier.bg, color: tier.color,
                border: `1px solid ${tier.border}`, letterSpacing: '0.3px',
              }}>
                {tier.label}
              </span>
            )}
            {sentiment && (
              <span style={{
                fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: sentiment.bg,
                color: sentiment.color,
                border: `1px solid ${sentiment.border}`,
              }}>
                {sentiment.icon} {sentiment.label}
              </span>
            )}
            {symbols.slice(0, 3).map(t => (
              <span key={t} style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px', backgroundColor: '#0F7ABF18', color: '#0F7ABF', border: '1px solid #0F7ABF30' }}>
                {t}
              </span>
            ))}
            {article.themes?.slice(0, 2).map(th => (
              <span key={th} style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: '#EF444415', color: '#F87171', border: '1px solid #EF444430', letterSpacing: '0.3px' }}>
                {th.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.45' }}>{title}</p>
          {article.impact_statement && (
            <p style={{ fontSize: '11px', color: '#F59E0B', margin: '0 0 6px', lineHeight: '1.4', fontWeight: '500', fontStyle: 'italic' }}>
              Impact: {article.impact_statement}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#6A7B8C', fontWeight: '500' }}>{source}</span>
            <span style={{ fontSize: '12px', color: '#2A3B4C' }}>·</span>
            <span style={{ fontSize: '12px', color: '#4A5B6C' }}>{timeAgo(article.published_at)}</span>
            {url && url !== '#' && (
              <ExternalLink style={{ width: '11px', height: '11px', color: '#3A4B5C' }} />
            )}
          </div>
        </div>
        {/* Info button to open detail overlay */}
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(article); }}
          style={{ background: 'none', border: '1px solid #1E2D45', borderRadius: '10px', color: '#4A5B6C', cursor: 'pointer', padding: '10px', flexShrink: 0, display: 'flex', alignItems: 'center', minWidth: '40px', minHeight: '40px', justifyContent: 'center' }}
          title="View details"
        >
          <ChevronRight style={{ width: '14px', height: '14px' }} />
        </button>
      </div>
    </CardWrapper>
  );
}

/** Full-screen article detail overlay — shows when user clicks a news card. */
function ArticleDetail({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  const symbols = getTickerSymbols(article);
  const title = getTitle(article);
  const source = getSource(article);
  const url = getUrl(article);
  const sentiment = sentimentBadge(article.sentiment);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '0px', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '0px', width: '100%', maxWidth: '700px', height: '100vh', maxHeight: '100vh', overflowY: 'auto', padding: '20px 16px' }}
        className="article-detail-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', fontSize: '18px', padding: '4px 8px' }}>
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Tags row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{regionFlag(article.region)}</span>
          <span style={{
            fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
            backgroundColor: typeColor(article.article_type) + '22',
            color: typeColor(article.article_type),
            border: `1px solid ${typeColor(article.article_type)}40`,
          }}>
            {article.article_type?.replace(/_/g, ' ')}
          </span>
          {sentiment && (
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
              backgroundColor: sentiment.bg, color: sentiment.color, border: `1px solid ${sentiment.border}`,
            }}>
              {sentiment.icon} {sentiment.label}
            </span>
          )}
          <span style={{
            fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
            backgroundColor: importanceDot(article.importance_score) + '22',
            color: importanceDot(article.importance_score),
            border: `1px solid ${importanceDot(article.importance_score)}40`,
          }}>
            Importance: {article.importance_score}/5
          </span>
        </div>

        {/* Headline */}
        <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#F5F7FA', margin: '0 0 12px', lineHeight: '1.4' }}>
          {title}
        </h2>

        {/* Source & time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#0F7ABF' }}>{source}</span>
          <span style={{ fontSize: '12px', color: '#2A3B4C' }}>·</span>
          <span style={{ fontSize: '12px', color: '#4A5B6C' }}>{timeAgo(article.published_at)}</span>
        </div>

        {/* Bottleneck themes */}
        {article.themes && article.themes.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 8px', letterSpacing: '0.5px' }}>BOTTLENECK CATEGORIES</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {article.themes.map(th => (
                <span key={th} style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '6px', backgroundColor: '#EF444418', color: '#F87171', border: '1px solid #EF444430' }}>
                  {th.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tickers */}
        {symbols.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 8px', letterSpacing: '0.5px' }}>RELATED TICKERS</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {symbols.map(t => (
                <span key={t} style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '6px', backgroundColor: '#0F7ABF18', color: '#0F7ABF', border: '1px solid #0F7ABF30' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {article.summary ? (
          <div style={{ borderTop: '1px solid #1E2D45', paddingTop: '20px', marginBottom: '20px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 10px', letterSpacing: '0.5px' }}>SUMMARY</p>
            <p style={{ fontSize: '14px', color: '#C9D4E0', margin: 0, lineHeight: '1.7' }}>
              {article.summary}
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid #1E2D45', paddingTop: '20px', marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: '#4A5B6C', fontStyle: 'italic', margin: 0 }}>
              No summary available for this article.
            </p>
          </div>
        )}

        {/* External link */}
        {url && url !== '#' && (
          <a
            href={url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', fontWeight: '600', color: '#0F7ABF', textDecoration: 'none',
              padding: '8px 16px', borderRadius: '8px', border: '1px solid #0F7ABF40',
              backgroundColor: '#0F7ABF10',
            }}
          >
            Open original article <ExternalLink style={{ width: '12px', height: '12px' }} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Bottleneck Dashboard ──────────────────────────────────────────────────────

function BottleneckDashboard({
  dashboard,
  isLoading,
  onOpenDrilldown,
  bottleneckLevel = 'ALL',
  bottleneckCategory = 'ALL',
}: {
  dashboard?: BnDashboard;
  isLoading: boolean;
  onOpenDrilldown?: (subTag: string) => void;
  bottleneckLevel?: string;
  bottleneckCategory?: string;
}) {
  // All buckets expanded by default
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());

  // Filter buckets by the active level/category sub-filters so the dashboard
  // stays consistent with the top article list.
  const filteredBuckets = useMemo(() => {
    if (!dashboard?.buckets) return [];
    const levelToSeverity: Record<string, (sev: number) => boolean> = {
      CRITICAL_BOTTLENECK: sev => sev >= 5,
      BOTTLENECK: sev => sev === 4,
      WATCH: sev => sev <= 3 && sev >= 2,
      RESOLVED_EASING: sev => sev <= 1,
    };
    return dashboard.buckets.filter(b => {
      if (bottleneckLevel !== 'ALL') {
        const pred = levelToSeverity[bottleneckLevel];
        if (pred && !pred(b.severity)) return false;
      }
      if (bottleneckCategory !== 'ALL' && b.bucket_id !== bottleneckCategory) return false;
      return true;
    });
  }, [dashboard, bottleneckLevel, bottleneckCategory]);

  // Compat: expandedBuckets derived from collapsedBuckets (inverted logic)
  const expandedBuckets = useMemo(() => {
    if (!filteredBuckets.length) return new Set<string>();
    const all = new Set(filteredBuckets.map(b => b.bucket_id));
    for (const id of collapsedBuckets) all.delete(id);
    return all;
  }, [filteredBuckets, collapsedBuckets]);

  const toggleBucket = (id: string) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSignal = (id: string) => {
    setExpandedSignals(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: '100px', backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px' }} className="animate-shimmer" />
        ))}
      </div>
    );
  }

  if (!dashboard?.buckets?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</p>
        <p style={{ fontSize: '15px', fontWeight: '600', color: '#F5F7FA', margin: '0 0 8px' }}>No active bottleneck signals</p>
        <p style={{ fontSize: '13px', color: '#4A5B6C', margin: 0 }}>Bottleneck signals will appear when supply-chain constraint articles are detected</p>
      </div>
    );
  }

  if (!filteredBuckets.length) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '12px' }}>
        <p style={{ fontSize: '28px', marginBottom: '10px' }}>🔎</p>
        <p style={{ fontSize: '14px', fontWeight: '600', color: '#F5F7FA', margin: '0 0 6px' }}>No dashboard buckets match current filters</p>
        <p style={{ fontSize: '12px', color: '#4A5B6C', margin: 0 }}>Try clearing the level or category filter to see the full intelligence grid.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary bar */}
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#EF4444', letterSpacing: '0.5px' }}>BOTTLENECK INTELLIGENCE</span>
        <span style={{ fontSize: '11px', color: '#4A5B6C' }}>
          {filteredBuckets.length} categories · {filteredBuckets.reduce((s, b) => s + b.signal_count, 0)} signals · {filteredBuckets.reduce((s, b) => s + b.article_count, 0)} evidence articles
        </span>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
          {[
            { label: 'CRITICAL', count: filteredBuckets.filter(b => b.severity >= 5).length, color: '#EF4444' },
            { label: 'HIGH', count: filteredBuckets.filter(b => b.severity === 4).length, color: '#F59E0B' },
            { label: 'ELEVATED', count: filteredBuckets.filter(b => b.severity === 3).length, color: '#3B82F6' },
            { label: 'WATCH', count: filteredBuckets.filter(b => b.severity <= 2).length, color: '#6B7280' },
          ].filter(s => s.count > 0).map(s => (
            <span key={s.label} style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', backgroundColor: s.color + '15', color: s.color, border: `1px solid ${s.color}30` }}>
              {s.count} {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Bucket cards */}
      {filteredBuckets.map(bucket => {
        const isExpanded = expandedBuckets.has(bucket.bucket_id);
        return (
          <div key={bucket.bucket_id} style={{ backgroundColor: '#111B35', border: `1px solid ${bucket.severity >= 4 ? bucket.severity_color + '40' : '#1E2D45'}`, borderRadius: '14px', overflow: 'hidden' }}>
            {/* Bucket header */}
            <div
              onClick={() => toggleBucket(bucket.bucket_id)}
              style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              {/* Severity indicator */}
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: bucket.severity_color + '18', border: `1px solid ${bucket.severity_color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                {bucket.severity_icon}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#F5F7FA' }}>{bucket.label}</span>
                  <span style={{
                    fontSize: '9px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px',
                    backgroundColor: bucket.severity_color + '20', color: bucket.severity_color,
                    border: `1px solid ${bucket.severity_color}40`, letterSpacing: '0.5px',
                  }}>
                    {bucket.severity_label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: '#4A5B6C' }}>
                    {bucket.signal_count} signal{bucket.signal_count !== 1 ? 's' : ''} · {bucket.article_count} article{bucket.article_count !== 1 ? 's' : ''}
                  </span>
                  {bucket.key_tickers.slice(0, 4).map(t => (
                    <span key={t} style={{ fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#0F7ABF15', color: '#0F7ABF', border: '1px solid #0F7ABF25' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {onOpenDrilldown && BOTTLENECK_DRILLDOWN[bucket.bucket_id] && (
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenDrilldown(bucket.bucket_id); }}
                  style={{
                    fontSize: '10px', fontWeight: '700', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer',
                    border: '1px solid #8B5CF640', backgroundColor: '#8B5CF615', color: '#A78BFA',
                    flexShrink: 0, letterSpacing: '0.3px',
                  }}
                  title="Open supply/demand drilldown"
                >
                  DEEP DIVE
                </button>
              )}
              {isExpanded
                ? <ChevronDown style={{ width: '16px', height: '16px', color: '#4A5B6C', flexShrink: 0 }} />
                : <ChevronRight style={{ width: '16px', height: '16px', color: '#4A5B6C', flexShrink: 0 }} />
              }
            </div>

            {/* Expanded: show signals */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid #1E2D45', padding: '4px 0' }}>
                {/* Description */}
                <p style={{ fontSize: '12px', color: '#6B7280', margin: '10px 18px 12px', lineHeight: '1.5' }}>
                  {bucket.description}
                </p>

                {bucket.signals.map((signal, idx) => {
                  const signalKey = `${bucket.bucket_id}-${idx}`;
                  const signalExpanded = expandedSignals.has(signalKey);
                  return (
                    <div key={signalKey} style={{ margin: '0 12px 8px', backgroundColor: '#0D1B2E', borderRadius: '10px', border: '1px solid #1a2840' }}>
                      {/* Signal header */}
                      <div
                        onClick={() => toggleSignal(signalKey)}
                        style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '10px' }}
                      >
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: bucket.severity_color, flexShrink: 0, marginTop: '6px' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {signal.articles?.[0]?.source_url ? (
                            <a
                              href={signal.articles[0].source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontSize: '13px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.4', display: 'block', textDecoration: 'none' }}
                            >
                              {decodeHtml(signal.headline)}
                              <ExternalLink style={{ width: '10px', height: '10px', color: '#3A4B5C', marginLeft: '6px', display: 'inline' }} />
                            </a>
                          ) : (
                            <p style={{ fontSize: '13px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.4' }}>
                              {decodeHtml(signal.headline)}
                            </p>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '10px', color: '#4A5B6C' }}>
                              {signal.sources.join(', ')}
                            </span>
                            {signal.evidence_count > 1 && (
                              <span style={{ fontSize: '10px', fontWeight: '600', color: '#F59E0B', backgroundColor: '#F59E0B15', padding: '1px 6px', borderRadius: '3px' }}>
                                +{signal.evidence_count - 1} related
                              </span>
                            )}
                            {signal.tickers.slice(0, 3).map(t => (
                              <span key={t} style={{ fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#0F7ABF12', color: '#0F7ABF', border: '1px solid #0F7ABF20' }}>
                                {t}
                              </span>
                            ))}
                            <span style={{ fontSize: '10px', color: '#3A4B5C' }}>
                              {timeAgo(signal.latest_at)}
                            </span>
                          </div>
                        </div>
                        {signal.evidence_count > 1 && (
                          signalExpanded
                            ? <ChevronDown style={{ width: '14px', height: '14px', color: '#4A5B6C', flexShrink: 0, marginTop: '2px' }} />
                            : <ChevronRight style={{ width: '14px', height: '14px', color: '#4A5B6C', flexShrink: 0, marginTop: '2px' }} />
                        )}
                      </div>

                      {/* Expanded: evidence articles */}
                      {signalExpanded && signal.evidence_count > 1 && (
                        <div style={{ borderTop: '1px solid #1a2840', padding: '8px 14px 10px', paddingLeft: '30px' }}>
                          <p style={{ fontSize: '9px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 6px', letterSpacing: '0.5px' }}>EVIDENCE ARTICLES</p>
                          {signal.articles.map((art, aidx) => (
                            <a
                              key={aidx}
                              href={art.source_url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', textDecoration: 'none', borderBottom: aidx < signal.articles.length - 1 ? '1px solid #15213a' : 'none' }}
                            >
                              <span style={{ fontSize: '11px', color: '#C9D4E0', flex: 1 }}>
                                {decodeHtml(art.headline).slice(0, 90)}{art.headline.length > 90 ? '…' : ''}
                              </span>
                              <span style={{ fontSize: '10px', color: '#4A5B6C', flexShrink: 0 }}>{art.source_name}</span>
                              <ExternalLink style={{ width: '10px', height: '10px', color: '#3A4B5C', flexShrink: 0 }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Drilldown knowledge base ─────────────────────────────────────────────────
// Maps bottleneck sub-tags to institutional narrative: why it's a bottleneck,
// supply vs demand dynamics, and listed company winners/losers.

type DrilldownEntry = {
  label: string;
  icon: string;
  why: string;
  supply: string;
  demand: string;
  winners: Array<{ ticker: string; thesis: string }>;
  losers: Array<{ ticker: string; thesis: string }>;
};

const BOTTLENECK_DRILLDOWN: Record<string, DrilldownEntry> = {
  MEMORY_STORAGE: {
    label: 'Memory & Storage',
    icon: '🧠',
    why: 'HBM and enterprise DRAM/NAND capacity is sold out through 2026. Every hyperscaler GPU needs 6-8 stacks of HBM3E; capacity additions lag GPU demand by 18-24 months.',
    supply: 'Only 3 HBM producers (SK Hynix, Samsung, Micron). Capex cycles are 2-3 years. Yield on HBM3E is structurally below DDR5.',
    demand: 'Every Blackwell GPU consumes 8× HBM3E stacks. Inference clusters need 3-5× the memory footprint of training. Demand growing ~60% YoY.',
    winners: [
      { ticker: '000660.KS', thesis: 'SK Hynix: HBM share leader, 50%+ of supply' },
      { ticker: 'MU', thesis: 'Micron: HBM3E ramp, capex leverage' },
      { ticker: '005930.KS', thesis: 'Samsung: HBM3E qualification gating catch-up' },
    ],
    losers: [
      { ticker: 'NVDA', thesis: 'Margin pressure as HBM costs stay elevated' },
      { ticker: 'META', thesis: 'Capex inflation on memory-heavy training clusters' },
    ],
  },
  INTERCONNECT_PHOTONICS: {
    label: 'Interconnect & Photonics',
    icon: '💡',
    why: 'Copper interconnects hit bandwidth walls at 224 Gbps SerDes. Co-packaged optics and silicon photonics are the only path to 1.6T/3.2T fabrics for future AI factories.',
    supply: 'CPO supply chain immature: lasers, modulators, couplers bottlenecked at a handful of vendors. TSMC/Intel photonics integration still ramping.',
    demand: 'Every rack-scale AI system (NVL72, Trainium3) needs 10-100× more optical transceivers than prior generations. Hyperscaler buys locked through 2027.',
    winners: [
      { ticker: 'COHR', thesis: 'Coherent: datacenter transceivers, VCSEL supply' },
      { ticker: 'LITE', thesis: 'Lumentum: indium phosphide lasers for CPO' },
      { ticker: 'AVGO', thesis: 'Broadcom: Tomahawk 5 switches + CPO reference design' },
      { ticker: 'MRVL', thesis: 'Marvell: 800G/1.6T DSPs, custom silicon' },
    ],
    losers: [],
  },
  FABRICATION_PACKAGING: {
    label: 'Advanced Fabrication & Packaging',
    icon: '🏭',
    why: 'CoWoS advanced packaging at TSMC is the single-point bottleneck for every leading-edge AI accelerator. Capacity doubles every 18 months but demand outpaces it.',
    supply: 'TSMC CoWoS-L/S capacity: ~35K wpm in 2024, ~70K wpm targeted 2026. Intel Foveros and Samsung I-Cube still sub-scale. ASML High-NA EUV gating N2/A16 ramp.',
    demand: 'Nvidia alone consumes 60%+ of CoWoS. AMD MI300/MI350, AWS Trainium, Google TPU all share remaining supply. Demand growing 80%+ YoY.',
    winners: [
      { ticker: 'TSM', thesis: 'TSMC: monopoly on advanced packaging, CoWoS pricing power' },
      { ticker: 'ASML', thesis: 'ASML: sole EUV/High-NA supplier, 2-year backlog' },
      { ticker: 'AMAT', thesis: 'Applied Materials: advanced packaging tools' },
      { ticker: 'LRCX', thesis: 'Lam Research: etch and deposition for N2/A16' },
    ],
    losers: [
      { ticker: 'INTC', thesis: 'Intel Foundry behind on advanced packaging ramp' },
    ],
  },
  COMPUTE_SCALING: {
    label: 'Compute & GPU Allocation',
    icon: '⚡',
    why: 'GPU supply remains rationed by Nvidia. H100/H200 allocation is relationship-driven, Blackwell ramp gated by CoWoS. Tier-2 clouds and enterprises wait 6-12 months.',
    supply: 'Nvidia ships what TSMC packages. MI300X/MI325X are the only meaningful alternative; TPU/Trainium captive to respective hyperscalers.',
    demand: 'Hyperscaler AI capex ~$300B/yr, projected $450B+ in 2026. Sovereign AI funds, neoclouds, enterprise inference all competing for allocation.',
    winners: [
      { ticker: 'NVDA', thesis: 'Nvidia: allocation monopoly, 75%+ gross margin' },
      { ticker: 'AMD', thesis: 'AMD: MI series captures tier-2 demand' },
      { ticker: 'AVGO', thesis: 'Broadcom: custom ASIC (Google TPU, Meta MTIA)' },
    ],
    losers: [
      { ticker: 'CRWV', thesis: 'Neoclouds dependent on NVDA allocation' },
    ],
  },
  POWER_GRID: {
    label: 'Power & Grid Constraints',
    icon: '🔌',
    why: 'Data center power demand outpaces grid interconnect timelines by 3-7 years. Transformer, switchgear, and HV cable lead times are 80-130 weeks.',
    supply: 'Only 3 major transformer OEMs globally. Grain-oriented electrical steel (GOES) constrained. Utility interconnect queues span 5-10 years in PJM/ERCOT.',
    demand: 'AI data center nameplate demand: 50 GW US by 2030 (Goldman, EPRI). Hyperscaler site selection now power-first, real-estate second.',
    winners: [
      { ticker: 'GEV', thesis: 'GE Vernova: grid equipment, transformers' },
      { ticker: 'ETN', thesis: 'Eaton: switchgear, UPS, electrical backbone' },
      { ticker: 'VRT', thesis: 'Vertiv: power/cooling for data centers' },
      { ticker: 'ABB.SW', thesis: 'ABB: transformers, HV switchgear' },
      { ticker: 'SU.PA', thesis: 'Schneider Electric: grid + DC power distribution' },
    ],
    losers: [],
  },
  NUCLEAR_ENERGY: {
    label: 'Nuclear Energy',
    icon: '☢️',
    why: 'Hyperscalers pivoting to nuclear PPAs for 24/7 carbon-free baseload. SMRs and restart of retired plants are the only gigawatt-scale path this decade.',
    supply: 'Enriched uranium supply constrained post-Russia sanctions. Centrus and Urenco ramping HALEU slowly. SMR deployments 2028-2032.',
    demand: 'MSFT/Three Mile Island, AMZN/Talen, GOOG/Kairos, META/SMR RFP — every hyperscaler has inked nuclear deals. India targeting 100 GW by 2047.',
    winners: [
      { ticker: 'CCJ', thesis: 'Cameco: uranium mining leader' },
      { ticker: 'LEU', thesis: 'Centrus: HALEU enrichment monopoly' },
      { ticker: 'VST', thesis: 'Vistra: nuclear fleet + AI hyperscaler PPAs' },
      { ticker: 'CEG', thesis: 'Constellation: Three Mile Island restart, MSFT PPA' },
      { ticker: 'TLN', thesis: 'Talen: Susquehanna nuclear + AWS deal' },
      { ticker: 'NPCIL', thesis: 'NPCIL (India): 100 GW target by 2047' },
    ],
    losers: [],
  },
  THERMAL_COOLING: {
    label: 'Thermal & Cooling',
    icon: '❄️',
    why: 'Blackwell and beyond require direct-to-chip liquid cooling. Retrofit is impractical; new builds are 100% liquid-cooled. CDU and cold-plate supply sold out.',
    supply: 'CoolIT, Motivair, Boyd, Asetek are the main CDU vendors. Cold plate supply concentrated in Taiwan.',
    demand: 'NVL72 racks = 120+ kW/rack. Every new AI data center must deploy liquid cooling. Retrofit-ability is becoming CIO top-3 concern.',
    winners: [
      { ticker: 'VRT', thesis: 'Vertiv: liquid cooling + power thermal management' },
      { ticker: 'SMCI', thesis: 'Supermicro: liquid-cooled rack integration' },
      { ticker: 'ETN', thesis: 'Eaton: thermal electrical infrastructure' },
    ],
    losers: [],
  },
  MATERIALS_SUPPLY: {
    label: 'Critical Materials',
    icon: '⛏️',
    why: 'Gallium, germanium, neon, rare earths, and high-purity quartz gating semi and defense supply chains. China export controls accelerating bifurcation.',
    supply: 'China controls 80%+ of gallium/germanium processing, 90%+ of rare earth refining. Alternative supply 3-7 years out.',
    demand: 'AI, defense, EV, and renewable electrification all drawing from same materials stack. Demand growing 2-3× by 2030.',
    winners: [
      { ticker: 'MP', thesis: 'MP Materials: US rare earth independence' },
      { ticker: 'LYC.AX', thesis: 'Lynas: ex-China rare earth processing' },
    ],
    losers: [],
  },
  QUANTUM_CRYOGENICS: {
    label: 'Quantum & Cryogenics',
    icon: '🧊',
    why: 'Quantum hardware gated by dilution refrigerators, helium-3, and cryo electronics. Scale-up of logical qubits is the decade-long bottleneck.',
    supply: 'Bluefors, Oxford Instruments dominate dilution fridges. Helium-3 supply constrained by tritium decay chain.',
    demand: 'Sovereign quantum programs (US DOE, EU, China, India) + hyperscaler R&D (IBM, Google, MSFT, AMZN). Demand inelastic in near term.',
    winners: [
      { ticker: 'IBM', thesis: 'IBM: largest gate-based quantum fleet' },
      { ticker: 'RGTI', thesis: 'Rigetti: superconducting qubit IP' },
      { ticker: 'IONQ', thesis: 'IonQ: trapped-ion roadmap' },
    ],
    losers: [],
  },
};

// Persistent signal threshold: articles older than this but still ranked
// represent structural (non-news) constraints that won't resolve quickly.
const PERSISTENT_DAYS = 30;
const PERSISTENT_MS = PERSISTENT_DAYS * 24 * 60 * 60 * 1000;

function isPersistentSignal(article: NewsArticle): boolean {
  try {
    const pubTime = new Date(article.published_at).getTime();
    if (!Number.isFinite(pubTime)) return false;
    return Date.now() - pubTime > PERSISTENT_MS;
  } catch { return false; }
}

// ── Drilldown Panel ──────────────────────────────────────────────────────────

function BottleneckDrilldown({
  subTag,
  articles,
  onClose,
  onSelectArticle,
}: {
  subTag: string;
  articles: NewsArticle[];
  onClose: () => void;
  onSelectArticle: (a: NewsArticle) => void;
}) {
  const entry = BOTTLENECK_DRILLDOWN[subTag];
  const relatedArticles = useMemo(
    () => articles.filter(a => a.bottleneck_sub_tag === subTag).slice(0, 15),
    [articles, subTag],
  );

  if (!entry) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.65)' }}
        onClick={onClose}
      >
        <div
          style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', width: '100%', maxWidth: '700px', height: '100vh', overflowY: 'auto', padding: '20px 16px' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', color: '#F5F7FA', margin: 0 }}>{subTag.replace(/_/g, ' ')}</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer' }}>
              <X style={{ width: '18px', height: '18px' }} />
            </button>
          </div>
          <p style={{ fontSize: '13px', color: '#8A95A3' }}>No drilldown available for this category yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', width: '100%', maxWidth: '720px', height: '100vh', overflowY: 'auto', padding: '20px 16px' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer' }}>
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '32px' }}>{entry.icon}</div>
          <div>
            <div style={{ fontSize: '10px', fontWeight: '700', color: '#EF4444', letterSpacing: '0.8px', marginBottom: '2px' }}>STRUCTURAL BOTTLENECK</div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#F5F7FA', margin: 0 }}>{entry.label}</h2>
          </div>
        </div>

        {/* Why it's a bottleneck */}
        <section style={{ marginBottom: '18px' }}>
          <p style={{ fontSize: '10px', fontWeight: '700', color: '#EF4444', margin: '0 0 8px', letterSpacing: '0.5px' }}>WHY IT'S A BOTTLENECK</p>
          <p style={{ fontSize: '13px', color: '#C9D4E0', lineHeight: '1.6', margin: 0 }}>{entry.why}</p>
        </section>

        {/* Supply vs Demand */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
          <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: '#F59E0B', margin: '0 0 6px', letterSpacing: '0.5px' }}>SUPPLY</p>
            <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.55', margin: 0 }}>{entry.supply}</p>
          </div>
          <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: '#10B981', margin: '0 0 6px', letterSpacing: '0.5px' }}>DEMAND</p>
            <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.55', margin: 0 }}>{entry.demand}</p>
          </div>
        </div>

        {/* Winners */}
        {entry.winners.length > 0 && (
          <section style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: '#10B981', margin: '0 0 8px', letterSpacing: '0.5px' }}>▲ LISTED COMPANIES — WINNERS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entry.winners.map(w => (
                <div key={w.ticker} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', backgroundColor: '#10B98108', border: '1px solid #10B98130', borderRadius: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#10B981', backgroundColor: '#10B98120', padding: '2px 7px', borderRadius: '4px', flexShrink: 0, minWidth: '70px', textAlign: 'center' }}>
                    {w.ticker}
                  </span>
                  <span style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.45' }}>{w.thesis}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Losers */}
        {entry.losers.length > 0 && (
          <section style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: '#EF4444', margin: '0 0 8px', letterSpacing: '0.5px' }}>▼ LISTED COMPANIES — UNDER PRESSURE</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entry.losers.map(l => (
                <div key={l.ticker} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', backgroundColor: '#EF444408', border: '1px solid #EF444430', borderRadius: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#EF4444', backgroundColor: '#EF444420', padding: '2px 7px', borderRadius: '4px', flexShrink: 0, minWidth: '70px', textAlign: 'center' }}>
                    {l.ticker}
                  </span>
                  <span style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.45' }}>{l.thesis}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Related articles */}
        {relatedArticles.length > 0 && (
          <section style={{ borderTop: '1px solid #1E2D45', paddingTop: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: '#4A5B6C', margin: '0 0 10px', letterSpacing: '0.5px' }}>RECENT EVIDENCE ({relatedArticles.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {relatedArticles.map(a => (
                <button
                  key={a.id}
                  onClick={() => onSelectArticle(a)}
                  style={{ textAlign: 'left', background: '#111B35', border: '1px solid #1E2D45', borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', color: '#C9D4E0', fontSize: '12px', lineHeight: '1.45' }}
                >
                  <div style={{ fontWeight: '600', color: '#E8EDF2', marginBottom: '3px' }}>{getTitle(a)}</div>
                  <div style={{ fontSize: '10px', color: '#4A5B6C' }}>{getSource(a)} · {timeAgo(a.published_at)}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewsFeedPage() {
  const [region,        setRegion]        = useState<'ALL' | 'IN' | 'US'>('ALL');
  const [articleType,   setArticleType]   = useState<string>('ALL');
  const [sourceName,    setSourceName]    = useState<string>('ALL');
  const [signalFilter,  setSignalFilter]  = useState<string>('ALL'); // 'ALL' = HIGH+MEDIUM (hides noise), 'HIGH' = only high, 'MEDIUM' = only medium
  const [bottleneckLevel, setBottleneckLevel] = useState<string>('ALL'); // Bottleneck sub-filter: ALL, CRITICAL_BOTTLENECK, BOTTLENECK, WATCH, RESOLVED_EASING
  const [bottleneckCategory, setBottleneckCategory] = useState<string>('ALL'); // Sub-tag: MEMORY_STORAGE, INTERCONNECT_PHOTONICS, etc.
  const [structuralOnly, setStructuralOnly] = useState<boolean>(false); // Show only synthetic/structural signals
  const [sortBy,        setSortBy]        = useState<'impact' | 'time'>('impact'); // Default: impact-based sort
  const [search,        setSearch]        = useState('');
  const [showFilters,   setShowFilters]   = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [drilldownSubTag, setDrilldownSubTag] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [groupByLayer,  setGroupByLayer]  = useState(true); // Group articles by layer
  const filterPanelRef = useRef<HTMLDivElement>(null);

  // ESC key closes filter panel
  useEffect(() => {
    if (!showFilters) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFilters(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showFilters]);

  // Outside click closes filter panel
  useEffect(() => {
    if (!showFilters) return;
    const handler = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    // Delay to avoid the click that opened the panel from immediately closing it
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [showFilters]);

  // Fetch ALL articles once — filters applied client-side for instant switching
  const { data: allArticles, isLoading, error, refetch } = useNews(search);
  const { data: rawInPlay, isLoading: inPlayLoading, refetch: refetchInPlay } = useInPlay();

  // ── Filtering engine: memoized multi-dimensional filter + sort ──────────────
  // Combines: region × article_type × signal × source × bottleneck_level ×
  //           bottleneck_category × structural_only × search-stale filter.
  // Sort: 'impact' (importance_score + structural boost) or 'time' (published_at desc).
  const STALE_MS = 48 * 60 * 60 * 1000; // 48 hours

  const articles = useMemo(() => {
    const now = Date.now();
    const base = filterArticles(allArticles || [], region, articleType, signalFilter, sourceName);

    const filtered = base.filter(a => {
      if (!isMarketRelevant(a)) return false;
      // Bottleneck level sub-filter (only active when viewing BOTTLENECK)
      if (bottleneckLevel !== 'ALL' && articleType === 'BOTTLENECK') {
        if (a.bottleneck_level !== bottleneckLevel) return false;
      }
      // Bottleneck category sub-filter (sub-tag: MEMORY_STORAGE etc.)
      if (bottleneckCategory !== 'ALL' && articleType === 'BOTTLENECK') {
        if (a.bottleneck_sub_tag !== bottleneckCategory) return false;
      }
      // Structural-only toggle: keep only synthetic/structural-pinned signals
      if (structuralOnly) {
        const isStructural = !!a.is_synthetic
          || a.feed_layer === 'STRUCTURAL_ALPHA'
          || a.structural_status === 'CRITICAL'
          || a.structural_status === 'ELEVATED';
        if (!isStructural) return false;
      }
      // When HIGH signal selected, exclude stale articles
      if (signalFilter === 'HIGH') {
        const pubTime = new Date(a.published_at || a.ingested_at || 0).getTime();
        if (now - pubTime > STALE_MS) return false;
      }
      return true;
    });

    // Sort: impact uses importance_score with structural + severity boost;
    // time uses published_at desc.
    const SEVERITY_BOOST: Record<string, number> = {
      CRITICAL_BOTTLENECK: 3,
      BOTTLENECK: 2,
      WATCH: 1,
      RESOLVED_EASING: 0,
    };

    const scoreOf = (a: NewsArticle): number => {
      const imp = a.importance_score || 0;
      const sev = SEVERITY_BOOST[a.bottleneck_level || ''] || 0;
      const structural = (a.is_synthetic || a.feed_layer === 'STRUCTURAL_ALPHA') ? 2 : 0;
      const recency = (() => {
        try {
          const age = (Date.now() - new Date(a.published_at).getTime()) / (1000 * 60 * 60);
          return Math.max(0, 3 - age / 24); // 3 points today, 0 after ~3 days
        } catch { return 0; }
      })();
      return imp * 2 + sev * 1.5 + structural + recency;
    };

    if (sortBy === 'impact') {
      filtered.sort((a, b) => scoreOf(b) - scoreOf(a));
    } else {
      filtered.sort((a, b) => {
        try {
          return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
        } catch { return 0; }
      });
    }

    // Deduplicate by id (and by headline+source as fallback) — backend may
    // return the same article from multiple caches (persistent + live merge)
    // which was causing duplicate rows in the bottleneck view.
    const seen = new Set<string>();
    const deduped: NewsArticle[] = [];
    for (const a of filtered) {
      const key = a.id
        || `${(a.title || a.headline || '').toLowerCase().trim()}|${(a.source || a.source_name || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(a);
    }

    return deduped;
  }, [
    allArticles,
    region,
    articleType,
    signalFilter,
    sourceName,
    bottleneckLevel,
    bottleneckCategory,
    structuralOnly,
    sortBy,
  ]);
  const inPlay = (rawInPlay || []).filter(isMarketRelevant);
  const { data: bnDashboard, isLoading: bnLoading, refetch: refetchBn } = useBottleneckDashboard(articleType === 'BOTTLENECK', region);
  const showBottleneckDashboard = articleType === 'BOTTLENECK';

  // Trigger backend to fetch fresh articles from RSS feeds, then refresh UI
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Backend kicks off ingestion in background and returns immediately
      await api.post('/news/refresh', {}, { timeout: 15_000 });
    } catch (e) {
      console.warn('News refresh trigger failed:', e);
    }
    // Poll for new data: immediate refetch + delayed refetch after ingestion completes
    await Promise.all([refetch(), refetchInPlay(), ...(showBottleneckDashboard ? [refetchBn()] : [])]);
    // Second refetch after 8s to catch articles ingested in the background
    setTimeout(async () => {
      await Promise.all([refetch(), refetchInPlay(), ...(showBottleneckDashboard ? [refetchBn()] : [])]);
    }, 8_000);
    // Third refetch after 20s for slower RSS sources
    setTimeout(async () => {
      await Promise.all([refetch(), refetchInPlay(), ...(showBottleneckDashboard ? [refetchBn()] : [])]);
      setIsRefreshing(false);
    }, 20_000);
  };

  return (
    <div style={{ padding: '12px 10px', maxWidth: '1000px', margin: '0 auto' }}>

      {/* ── IN PLAY TODAY bar ─────────────────────────────────────────── */}
      {!inPlayLoading && (
        <div
          style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '12px', padding: '10px 12px', marginBottom: '12px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '10px' }}
          className="scrollbar-hide mobile-scroll"
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: '700', color: '#F59E0B', flexShrink: 0 }}>
            <Zap style={{ width: '10px', height: '10px' }} /> IN PLAY TODAY
          </span>

          {(inPlay?.length ?? 0) > 0 ? (
            inPlay!.map(art => {
              const syms = getTickerSymbols(art);
              return (
                <a
                  key={art.id}
                  href={getUrl(art) !== '#' ? getUrl(art) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '12px', cursor: 'pointer', verticalAlign: 'middle', flexShrink: 0, textDecoration: 'none', color: 'inherit' }}
                >
                  {syms[0] && (
                    <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: '#EF444420', color: '#EF4444', padding: '1px 5px', borderRadius: '4px', border: '1px solid #EF444440' }}>
                      {syms[0]}
                    </span>
                  )}
                  <span style={{ fontSize: '11px', color: '#C9D4E0' }}>
                    {getTitle(art).slice(0, 70)}{getTitle(art).length > 70 ? '…' : ''}
                  </span>
                  <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{getSource(art)}</span>
                </a>
              );
            })
          ) : (
            <span style={{ fontSize: '11px', color: '#4A5B6C', fontStyle: 'italic' }}>
              No high-importance stories in the last 12 hours
            </span>
          )}
        </div>
      )}

      {/* Loading shimmer for IN PLAY bar */}
      {inPlayLoading && (
        <div style={{ height: '36px', backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '12px', marginBottom: '16px' }} className="animate-shimmer" />
      )}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '15px', fontWeight: '700', color: '#F5F7FA', margin: 0 }}>News Feed</h1>
        </div>
        {/* Controls row — horizontally scrollable on mobile */}
        <div className="scrollbar-hide mobile-scroll" style={{ display: 'flex', gap: '8px', alignItems: 'center', overflowX: 'auto', paddingBottom: '4px' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search news…"
            style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '8px', padding: '7px 12px', color: '#F5F7FA', fontSize: '14px', minWidth: '160px', width: '200px', outline: 'none', flexShrink: 0 }}
          />
          <button
            onClick={() => { setArticleType(articleType === 'BOTTLENECK' ? 'ALL' : 'BOTTLENECK'); setBottleneckLevel('ALL'); setBottleneckCategory('ALL'); setStructuralOnly(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: articleType === 'BOTTLENECK' ? '#EF444420' : '#111B35', border: `1px solid ${articleType === 'BOTTLENECK' ? '#EF4444' : '#1E2D45'}`, borderRadius: '8px', padding: '7px 12px', color: articleType === 'BOTTLENECK' ? '#EF4444' : '#8A95A3', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show critical bottleneck news (GPU, Memory, Photonics, Power, etc.)"
          >
            BOTTLENECKS
          </button>
          <button
            onClick={() => setRegion(region === 'IN' ? 'ALL' : 'IN')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: region === 'IN' ? '#0F7ABF20' : '#111B35', border: `1px solid ${region === 'IN' ? '#0F7ABF' : '#1E2D45'}`, borderRadius: '8px', padding: '7px 12px', color: region === 'IN' ? '#0F7ABF' : '#8A95A3', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show only India news"
          >
            🇮🇳 India
          </button>
          <button
            onClick={() => setRegion(region === 'US' ? 'ALL' : 'US')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: region === 'US' ? '#0F7ABF20' : '#111B35', border: `1px solid ${region === 'US' ? '#0F7ABF' : '#1E2D45'}`, borderRadius: '8px', padding: '7px 12px', color: region === 'US' ? '#0F7ABF' : '#8A95A3', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show only US news"
          >
            🇺🇸 US
          </button>
          <button
            onClick={() => setShowFilters(f => !f)}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: showFilters ? '#0F7ABF' : '#111B35', border: `1px solid ${showFilters ? '#0F7ABF' : '#1E2D45'}`, borderRadius: '8px', padding: '7px 12px', color: '#F5F7FA', fontSize: '12px', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
          >
            <Filter style={{ width: '12px', height: '12px' }} /> Filters
            {(region !== 'ALL' || articleType !== 'ALL' || signalFilter !== 'ALL' || sourceName !== 'ALL' || search) && (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#F59E0B', display: 'inline-block', marginLeft: '2px' }} />
            )}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '8px', padding: '7px 10px', color: isRefreshing ? '#0F7ABF' : '#4A5B6C', cursor: isRefreshing ? 'wait' : 'pointer', opacity: isRefreshing ? 0.7 : 1, flexShrink: 0, minHeight: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={isRefreshing ? 'Fetching latest news from sources…' : 'Refresh news from RSS feeds'}
          >
            <RefreshCw style={{ width: '12px', height: '12px', animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────── */}
      {showFilters && (
        <div ref={filterPanelRef} style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', padding: '14px', marginBottom: '12px', position: 'relative' }}>
          {/* Close button */}
          <button
            onClick={() => setShowFilters(false)}
            style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: '#4A5B6C', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Close filters (Esc)"
          >
            <X style={{ width: '14px', height: '14px' }} />
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 8px', letterSpacing: '0.5px' }}>REGION</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                {REGIONS.map(r => (
                  <button key={r} onClick={() => setRegion(r)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${region === r ? '#0F7ABF' : '#1E2D45'}`, backgroundColor: region === r ? '#0F7ABF20' : 'transparent', color: region === r ? '#0F7ABF' : '#8A95A3' }}>
                    {r === 'IN' ? '🇮🇳 India' : r === 'US' ? '🇺🇸 US' : 'All'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 8px', letterSpacing: '0.5px' }}>CATEGORY</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {TYPES.map(t => (
                  <button key={t} onClick={() => setArticleType(t)}
                    style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${articleType === t ? '#0F7ABF' : '#1E2D45'}`, backgroundColor: articleType === t ? '#0F7ABF20' : 'transparent', color: articleType === t ? '#0F7ABF' : '#8A95A3' }}>
                    {t === 'ALL' ? 'All' : t.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 8px', letterSpacing: '0.5px' }}>SIGNAL STRENGTH</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                {SIGNAL_FILTERS.map(s => (
                  <button key={s.value} onClick={() => setSignalFilter(s.value)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${signalFilter === s.value ? '#0F7ABF' : '#1E2D45'}`, backgroundColor: signalFilter === s.value ? '#0F7ABF20' : 'transparent', color: signalFilter === s.value ? '#0F7ABF' : '#8A95A3' }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 8px', letterSpacing: '0.5px' }}>SOURCE</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {SOURCES.map(s => (
                  <button key={s} onClick={() => setSourceName(s)}
                    style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${sourceName === s ? '#0F7ABF' : '#1E2D45'}`, backgroundColor: sourceName === s ? '#0F7ABF20' : 'transparent', color: sourceName === s ? '#0F7ABF' : '#8A95A3' }}>
                    {s === 'ALL' ? 'All' : s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={() => { setRegion('ALL'); setArticleType('ALL'); setSourceName('ALL'); setSignalFilter('ALL'); setBottleneckLevel('ALL'); setBottleneckCategory('ALL'); setStructuralOnly(false); setSearch(''); }}
            style={{ marginTop: '12px', fontSize: '11px', color: '#4A5B6C', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <X style={{ width: '10px', height: '10px' }} /> Clear filters
          </button>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────── */}
      {error && !isLoading && (
        <div style={{ backgroundColor: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircle style={{ width: '16px', height: '16px', color: '#EF4444' }} />
          <span style={{ fontSize: '13px', color: '#fca5a5' }}>Could not load news — check that the backend is running</span>
          <button onClick={handleRefresh} disabled={isRefreshing} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#EF4444', cursor: isRefreshing ? 'wait' : 'pointer', fontSize: '12px' }}>{isRefreshing ? 'Refreshing…' : 'Retry'}</button>
        </div>
      )}

      {/* ── BOTTLENECK ARTICLES (shown at TOP when BOTTLENECK mode is active) ── */}
      {showBottleneckDashboard && !isLoading && (
        <div style={{ marginBottom: '16px' }}>
          {/* Sticky header+filter bar */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            backgroundColor: '#0D1B2E', border: '1px solid #EF444440', borderRadius: '12px',
            padding: '12px 16px', marginBottom: '10px',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#EF4444', letterSpacing: '0.5px' }}>BOTTLENECK ARTICLES</span>
              <span style={{ fontSize: '11px', color: '#4A5B6C' }}>
                {articles.length} articles{region !== 'ALL' ? ` · ${region === 'IN' ? '🇮🇳 India' : '🇺🇸 US'}` : ''}
              </span>
              <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center' }}>
                {/* Sort toggle */}
                <button
                  onClick={() => setSortBy(sortBy === 'impact' ? 'time' : 'impact')}
                  style={{
                    fontSize: '10px', fontWeight: '600', padding: '4px 9px', borderRadius: '6px', cursor: 'pointer',
                    border: `1px solid ${sortBy === 'impact' ? '#F59E0B60' : '#1E2D45'}`,
                    backgroundColor: sortBy === 'impact' ? '#F59E0B15' : 'transparent',
                    color: sortBy === 'impact' ? '#F59E0B' : '#8A95A3',
                  }}
                  title="Toggle sort order"
                >
                  {sortBy === 'impact' ? '▲ By Impact' : '🕒 By Time'}
                </button>
                {/* Structural-only toggle */}
                <button
                  onClick={() => setStructuralOnly(v => !v)}
                  style={{
                    fontSize: '10px', fontWeight: '600', padding: '4px 9px', borderRadius: '6px', cursor: 'pointer',
                    border: `1px solid ${structuralOnly ? '#8B5CF660' : '#1E2D45'}`,
                    backgroundColor: structuralOnly ? '#8B5CF615' : 'transparent',
                    color: structuralOnly ? '#8B5CF6' : '#8A95A3',
                  }}
                  title="Show only structural (non-news) signals"
                >
                  {structuralOnly ? '● Structural Only' : '○ Structural Only'}
                </button>
              </div>
            </div>
            {/* ── Bottleneck Level Sub-Filters ── */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {([
                { value: 'ALL', label: 'All', color: '#8A95A3', bg: '#111B35', border: '#1E2D45', icon: '' },
                { value: 'CRITICAL_BOTTLENECK', label: 'Critical', color: '#EF4444', bg: '#EF444418', border: '#EF444440', icon: '🔴' },
                { value: 'BOTTLENECK', label: 'Bottleneck', color: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B30', icon: '🟠' },
                { value: 'WATCH', label: 'Watch', color: '#3B82F6', bg: '#3B82F615', border: '#3B82F630', icon: '🔵' },
                { value: 'RESOLVED_EASING', label: 'Resolved / Easing', color: '#10B981', bg: '#10B98115', border: '#10B98130', icon: '🟢' },
              ] as const).map(lvl => {
                const isActive = bottleneckLevel === lvl.value;
                // Count respects region + category + structural toggles for a meaningful live count
                const count = lvl.value === 'ALL'
                  ? articles.length
                  : (allArticles || []).filter(a => {
                      if (a.article_type !== 'BOTTLENECK') return false;
                      if (a.bottleneck_level !== lvl.value) return false;
                      if (region !== 'ALL' && a.region !== region && a.region !== 'GLOBAL') return false;
                      if (bottleneckCategory !== 'ALL' && a.bottleneck_sub_tag !== bottleneckCategory) return false;
                      return true;
                    }).length;
                return (
                  <button
                    key={lvl.value}
                    onClick={() => setBottleneckLevel(lvl.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600',
                      cursor: 'pointer',
                      border: `1px solid ${isActive ? lvl.color : '#1E2D45'}`,
                      backgroundColor: isActive ? lvl.bg : 'transparent',
                      color: isActive ? lvl.color : '#8A95A3',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {lvl.icon && <span style={{ fontSize: '8px' }}>{lvl.icon}</span>}
                    {lvl.label}
                    <span style={{
                      fontSize: '9px', fontWeight: '700',
                      padding: '1px 5px', borderRadius: '4px',
                      backgroundColor: isActive ? `${lvl.color}20` : '#1E2D4580',
                      color: isActive ? lvl.color : '#4A5B6C',
                      marginLeft: '2px',
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* ── Bottleneck Category (sub-tag) Filters ── */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {([
                { value: 'ALL', label: 'All Categories', icon: '' },
                { value: 'MEMORY_STORAGE', label: 'Memory', icon: '🧠' },
                { value: 'INTERCONNECT_PHOTONICS', label: 'Photonics', icon: '💡' },
                { value: 'FABRICATION_PACKAGING', label: 'Packaging', icon: '🏭' },
                { value: 'COMPUTE_SCALING', label: 'Compute', icon: '⚡' },
                { value: 'POWER_GRID', label: 'Power', icon: '🔌' },
                { value: 'NUCLEAR_ENERGY', label: 'Nuclear', icon: '☢️' },
                { value: 'THERMAL_COOLING', label: 'Cooling', icon: '❄️' },
                { value: 'MATERIALS_SUPPLY', label: 'Materials', icon: '⛏️' },
                { value: 'QUANTUM_CRYOGENICS', label: 'Quantum', icon: '🧊' },
              ] as const).map(cat => {
                const isActive = bottleneckCategory === cat.value;
                const canDrill = cat.value !== 'ALL' && BOTTLENECK_DRILLDOWN[cat.value];
                const count = cat.value === 'ALL'
                  ? articles.length
                  : (allArticles || []).filter(a => {
                      if (a.article_type !== 'BOTTLENECK') return false;
                      if (a.bottleneck_sub_tag !== cat.value) return false;
                      if (region !== 'ALL' && a.region !== region && a.region !== 'GLOBAL') return false;
                      if (bottleneckLevel !== 'ALL' && a.bottleneck_level !== bottleneckLevel) return false;
                      return true;
                    }).length;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setBottleneckCategory(cat.value)}
                    onDoubleClick={() => { if (canDrill) setDrilldownSubTag(cat.value); }}
                    title={canDrill ? 'Click to filter · Double-click to open drilldown' : ''}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '4px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600',
                      cursor: 'pointer',
                      border: `1px solid ${isActive ? '#8B5CF6' : '#1E2D45'}`,
                      backgroundColor: isActive ? '#8B5CF615' : 'transparent',
                      color: isActive ? '#8B5CF6' : '#8A95A3',
                    }}
                  >
                    {cat.icon && <span style={{ fontSize: '9px' }}>{cat.icon}</span>}
                    {cat.label}
                    <span style={{
                      fontSize: '9px', fontWeight: '700',
                      padding: '1px 4px', borderRadius: '3px',
                      backgroundColor: isActive ? '#8B5CF620' : '#1E2D4580',
                      color: isActive ? '#8B5CF6' : '#4A5B6C',
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Drilldown launch bar when category is selected */}
          {bottleneckCategory !== 'ALL' && BOTTLENECK_DRILLDOWN[bottleneckCategory] && (
            <button
              onClick={() => setDrilldownSubTag(bottleneckCategory)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                backgroundColor: '#8B5CF610', border: '1px solid #8B5CF640',
                borderRadius: '10px', padding: '10px 14px', marginBottom: '10px',
                cursor: 'pointer', textAlign: 'left', color: '#C9D4E0',
              }}
            >
              <span style={{ fontSize: '20px' }}>{BOTTLENECK_DRILLDOWN[bottleneckCategory].icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#8B5CF6' }}>
                  {BOTTLENECK_DRILLDOWN[bottleneckCategory].label} · Analysis
                </div>
                <div style={{ fontSize: '10px', color: '#8A95A3' }}>
                  Click for supply/demand breakdown and listed companies impacted
                </div>
              </div>
              <ChevronRight style={{ width: '14px', height: '14px', color: '#8B5CF6' }} />
            </button>
          )}

          {/* Articles list OR empty state */}
          {articles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '12px' }}>
              <p style={{ fontSize: '28px', marginBottom: '10px' }}>🔎</p>
              <p style={{ fontSize: '14px', fontWeight: '600', color: '#F5F7FA', margin: '0 0 6px' }}>
                No bottleneck articles match your filters
              </p>
              <p style={{ fontSize: '12px', color: '#4A5B6C', margin: '0 0 14px', lineHeight: '1.5' }}>
                Try clearing the level, category, or structural-only filters.
              </p>
              <button
                onClick={() => { setBottleneckLevel('ALL'); setBottleneckCategory('ALL'); setStructuralOnly(false); }}
                style={{ backgroundColor: '#0F7ABF', color: 'white', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
              >
                Reset Bottleneck Filters
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {articles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
            </div>
          )}

          {articles.length > 0 && (
            <div style={{ textAlign: 'center', padding: '12px 0 4px', fontSize: '11px', color: '#4A5B6C' }}>
              Showing {articles.length} bottleneck articles
              {bottleneckLevel !== 'ALL' ? ` · Level: ${bottleneckLevel.replace(/_/g, ' ')}` : ''}
              {bottleneckCategory !== 'ALL' ? ` · Category: ${bottleneckCategory.replace(/_/g, ' ')}` : ''}
              {structuralOnly ? ' · Structural Only' : ''}
              {' · Sort: '}{sortBy === 'impact' ? 'Impact' : 'Time'}
              {' · Includes persistent signals up to 90 days'}
            </div>
          )}
        </div>
      )}

      {/* ── Bottleneck Dashboard (category intelligence below articles) */}
      {showBottleneckDashboard && (
        <div style={{ marginBottom: '16px' }}>
          <BottleneckDashboard
            dashboard={bnDashboard}
            isLoading={bnLoading}
            onOpenDrilldown={setDrilldownSubTag}
            bottleneckLevel={bottleneckLevel}
            bottleneckCategory={bottleneckCategory}
          />
        </div>
      )}

      {/* ── Signal summary bar ─────────────────────────────────────── */}
      {!isLoading && articles?.length > 0 && !showBottleneckDashboard && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', padding: '8px 12px', backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', fontWeight: '700', color: '#6A7B8C', letterSpacing: '0.5px' }}>SIGNALS</span>
          <span style={{ fontSize: '11px', color: '#EF4444', fontWeight: '600' }}>
            🔴 {articles.filter(a => (a.investment_tier || 0) === 1).length} High
          </span>
          <span style={{ fontSize: '11px', color: '#F59E0B', fontWeight: '600' }}>
            🟡 {articles.filter(a => (a.investment_tier || 0) === 2).length} Medium
          </span>
          <span style={{ fontSize: '11px', color: '#4A5B6C' }}>
            {articles.length} total
          </span>
          {/* Layer grouping toggle */}
          <button
            onClick={() => setGroupByLayer(g => !g)}
            style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: '600', color: groupByLayer ? '#0F7ABF' : '#4A5B6C', background: 'none', border: `1px solid ${groupByLayer ? '#0F7ABF40' : '#1E2D45'}`, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}
          >
            {groupByLayer ? 'Grouped' : 'Timeline'}
          </button>
        </div>
      )}

      {/* ── Articles list (non-bottleneck modes, or loading state) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: '80px', backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px' }} className="animate-shimmer" />
          ))
        ) : !articles?.length ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontSize: '32px', marginBottom: '12px' }}>📰</p>
            <p style={{ fontSize: '15px', fontWeight: '600', color: '#F5F7FA', margin: '0 0 8px' }}>No articles found</p>
            <p style={{ fontSize: '13px', color: '#4A5B6C', margin: '0 0 16px' }}>
              {search || region !== 'ALL' || articleType !== 'ALL' || sourceName !== 'ALL'
                ? 'Try adjusting your filters'
                : 'Articles load automatically every 90 seconds'}
            </p>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              style={{ backgroundColor: '#0F7ABF', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', cursor: isRefreshing ? 'wait' : 'pointer', opacity: isRefreshing ? 0.7 : 1 }}
            >
              {isRefreshing ? 'Fetching news…' : 'Refresh Now'}
            </button>
          </div>
        ) : showBottleneckDashboard && articles?.length > 0 ? (
          // Bottleneck articles already shown at top — don't duplicate
          null
        ) : groupByLayer && !showBottleneckDashboard && articleType === 'ALL' ? (
          // ── Layered view: group articles by institutional hierarchy ──
          <>
            {(['MACRO_REGIME', 'STRUCTURAL', 'COMPANY_ALPHA', 'GENERAL'] as FeedLayer[]).map(layer => {
              const layerArticles = articles.filter(a => getArticleLayer(a) === layer);
              if (layerArticles.length === 0) return null;
              const config = LAYER_CONFIG[layer];
              return (
                <div key={layer}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', marginTop: '12px', paddingBottom: '6px', borderBottom: `1px solid ${config.color}30` }}>
                    <div style={{ width: '3px', height: '16px', borderRadius: '2px', backgroundColor: config.color }} />
                    <span style={{ fontSize: '11px', fontWeight: '700', color: config.color, letterSpacing: '0.8px' }}>{config.label}</span>
                    <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{config.description}</span>
                    <span style={{ fontSize: '10px', color: '#4A5B6C', marginLeft: 'auto' }}>{layerArticles.length}</span>
                  </div>
                  {layerArticles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
                </div>
              );
            })}
            <div style={{ textAlign: 'center', padding: '16px 0 8px', fontSize: '12px', color: '#4A5B6C' }}>
              Showing {articles.length} articles across {(['MACRO_REGIME', 'STRUCTURAL', 'COMPANY_ALPHA', 'GENERAL'] as FeedLayer[]).filter(l => articles.some(a => getArticleLayer(a) === l)).length} layers
            </div>
          </>
        ) : (
          // ── Timeline view: chronological ──
          <>
            {articles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
            <div style={{ textAlign: 'center', padding: '16px 0 8px', fontSize: '12px', color: '#4A5B6C' }}>
              Showing {articles.length} articles
            </div>
          </>
        )}
      </div>

      {/* ── Article detail overlay ─────────────────────────────────── */}
      {selectedArticle && (
        <ArticleDetail article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}

      {/* ── Bottleneck drilldown overlay ───────────────────────────── */}
      {drilldownSubTag && (
        <BottleneckDrilldown
          subTag={drilldownSubTag}
          articles={allArticles || []}
          onClose={() => setDrilldownSubTag(null)}
          onSelectArticle={a => { setDrilldownSubTag(null); setSelectedArticle(a); }}
        />
      )}
    </div>
  );
}
