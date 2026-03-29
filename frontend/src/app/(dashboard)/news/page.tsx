'use client';

import { useState } from 'react';
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
  'Yahoo Finance IN', 'PIB India', 'ElectronicsB2B',
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
const IMPORTANCE_LABELS: Record<number, string> = { 1: 'All', 2: 'Low+', 3: 'Medium+', 4: 'High' };

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

function useNews(region: string, type: string, minImportance: number, search: string, sourceName: string) {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', region, type, minImportance, search, sourceName],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', importance_min: String(minImportance) });
      if (region !== 'ALL') params.set('region', region);
      if (type   !== 'ALL') params.set('article_type', type);
      if (sourceName !== 'ALL') params.set('source_name', sourceName);

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
  if (tier === 1) return { label: 'ACTIONABLE', bg: '#10B98115', color: '#10B981', border: '#10B98130' };
  if (tier === 2) return { label: 'DIGEST', bg: '#F59E0B10', color: '#F59E0B', border: '#F59E0B25' };
  return null;
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

  return (
    <div
      className="news-card"
      style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s', opacity: isStale ? 0.55 : 1 }}
      onClick={() => {
        // Open the original article URL directly in a new tab
        if (url && url !== '#') {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          onSelect(article);
        }
      }}
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
            {isStale && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: '#78350F20', color: '#F59E0B', border: '1px solid #F59E0B30',
                letterSpacing: '0.3px',
              }}>
                STALE
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
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 8px', lineHeight: '1.45' }}>{title}</p>
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
    </div>
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

function BottleneckDashboard({ dashboard, isLoading }: { dashboard?: BnDashboard; isLoading: boolean }) {
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());

  const toggleBucket = (id: string) => {
    setExpandedBuckets(prev => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary bar */}
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#EF4444', letterSpacing: '0.5px' }}>BOTTLENECK INTELLIGENCE</span>
        <span style={{ fontSize: '11px', color: '#4A5B6C' }}>
          {dashboard.buckets.length} categories · {dashboard.total_articles} evidence articles · last 90 days
        </span>
      </div>

      {/* Bucket cards */}
      {dashboard.buckets.map(bucket => {
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
                          <p
                            style={{ fontSize: '13px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.4', cursor: signal.articles?.[0]?.source_url ? 'pointer' : 'default' }}
                            onClick={(e) => {
                              if (signal.articles?.[0]?.source_url) {
                                e.stopPropagation();
                                window.open(signal.articles[0].source_url, '_blank', 'noopener,noreferrer');
                              }
                            }}
                          >
                            {decodeHtml(signal.headline)}
                            {signal.articles?.[0]?.source_url && <ExternalLink style={{ width: '10px', height: '10px', color: '#3A4B5C', marginLeft: '6px', display: 'inline' }} />}
                          </p>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewsFeedPage() {
  const [region,        setRegion]        = useState<'ALL' | 'IN' | 'US'>('ALL');
  const [articleType,   setArticleType]   = useState<string>('ALL');
  const [sourceName,    setSourceName]    = useState<string>('ALL');
  const [minImportance, setMinImportance] = useState(1);
  const [search,        setSearch]        = useState('');
  const [showFilters,   setShowFilters]   = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [isRefreshing, setIsRefreshing]   = useState(false);

  const { data: rawArticles, isLoading, error, refetch } = useNews(region, articleType, minImportance, search, sourceName);
  const { data: rawInPlay, isLoading: inPlayLoading, refetch: refetchInPlay } = useInPlay();

  // Filter out irrelevant articles (personal finance, political fluff, clickbait)
  // Also filter stale content (>48h) when high importance is selected
  const now = Date.now();
  const STALE_MS = 48 * 60 * 60 * 1000; // 48 hours
  const articles = (rawArticles || []).filter(a => {
    if (!isMarketRelevant(a)) return false;
    // When high importance (4) selected, exclude stale articles
    if (minImportance >= 4) {
      const pubTime = new Date(a.published_at || a.ingested_at || 0).getTime();
      if (now - pubTime > STALE_MS) return false;
    }
    return true;
  });
  const inPlay = (rawInPlay || []).filter(isMarketRelevant);
  const { data: bnDashboard, isLoading: bnLoading, refetch: refetchBn } = useBottleneckDashboard(articleType === 'BOTTLENECK', region);
  const showBottleneckDashboard = articleType === 'BOTTLENECK';

  // Trigger backend to fetch fresh articles from RSS feeds, then refresh UI
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Give backend up to 90s to fetch all RSS feeds (22+ sources)
      await api.post('/news/refresh', {}, { timeout: 90_000 });
    } catch (e) {
      // Even if refresh fails (e.g. no internet / timeout), still refetch cached data
      console.warn('News refresh failed:', e);
    }
    // Refetch all queries to show new data
    await Promise.all([refetch(), refetchInPlay(), ...(showBottleneckDashboard ? [refetchBn()] : [])]);
    setIsRefreshing(false);
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
                <span
                  key={art.id}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '12px', cursor: 'pointer', verticalAlign: 'middle', flexShrink: 0 }}
                  onClick={() => getUrl(art) !== '#' && window.open(getUrl(art), '_blank')}
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
                </span>
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
            onClick={() => setArticleType(articleType === 'BOTTLENECK' ? 'ALL' : 'BOTTLENECK')}
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
            {(region !== 'ALL' || articleType !== 'ALL' || minImportance > 1 || sourceName !== 'ALL' || search) && (
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
        <div style={{ backgroundColor: '#111B35', border: '1px solid #1E2D45', borderRadius: '14px', padding: '14px', marginBottom: '12px' }}>
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
              <p style={{ fontSize: '10px', fontWeight: '600', color: '#4A5B6C', margin: '0 0 8px', letterSpacing: '0.5px' }}>IMPORTANCE</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                {([1, 2, 3, 4] as const).map(n => (
                  <button key={n} onClick={() => setMinImportance(n)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${minImportance === n ? '#0F7ABF' : '#1E2D45'}`, backgroundColor: minImportance === n ? '#0F7ABF20' : 'transparent', color: minImportance === n ? '#0F7ABF' : '#8A95A3' }}>
                    {IMPORTANCE_LABELS[n]}
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
            onClick={() => { setRegion('ALL'); setArticleType('ALL'); setSourceName('ALL'); setMinImportance(1); setSearch(''); }}
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

      {/* ── Bottleneck Dashboard (shown above articles when BOTTLENECK is active) */}
      {showBottleneckDashboard && (
        <div style={{ marginBottom: '16px' }}>
          <BottleneckDashboard dashboard={bnDashboard} isLoading={bnLoading} />
        </div>
      )}

      {/* ── Articles list (always shown — filtered by type + region) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {showBottleneckDashboard && articles?.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#EF4444', letterSpacing: '0.5px' }}>BOTTLENECK ARTICLES</span>
            <span style={{ fontSize: '11px', color: '#4A5B6C' }}>{articles.length} articles{region !== 'ALL' ? ` · ${region === 'IN' ? '🇮🇳 India' : '🇺🇸 US'}` : ''}</span>
          </div>
        ) : null}
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
        ) : (
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
    </div>
  );
}
