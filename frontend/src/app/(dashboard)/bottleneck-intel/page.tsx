'use client';

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw, ExternalLink, ChevronDown, ChevronRight,
  Zap, AlertCircle, Activity, TrendingUp, Flag, Trophy,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface NewsArticle {
  id: string;
  headline: string;
  title: string;
  source_name: string;
  source: string;
  source_url: string;
  url: string;
  published_at: string;
  tickers: Array<{ ticker: string; exchange: string; confidence?: number } | string>;
  ticker_symbols: string[];
  region: string;
  article_type: string;
  importance_score: number;
  bottleneck_sub_tag?: string;
  bottleneck_level?: string;
  sentiment?: string;
}

// Shape returned by /api/market/quotes?market=us
interface QuoteStock {
  ticker: string;
  company: string;
  price: number;
  changePercent: number;
  marketCap: number;
  sector?: string;
}

// ── Sub-tab config ─────────────────────────────────────────────────────────────

const TABS = ['Rotation', 'Scanner'] as const;
type Tab = typeof TABS[number];

const TAB_CONFIG: Record<Tab, { label: string; icon: ReactNode; description: string }> = {
  Rotation: {
    label: 'Rotation Tracker',
    icon: <Activity className="w-4 h-4" />,
    description: 'Which supply chain layer is the active bottleneck right now — Model 04',
  },
  Scanner: {
    label: 'Stock Scanner',
    icon: <TrendingUp className="w-4 h-4" />,
    description: 'Bottleneck companies ranked by Serenity Score — evidence strength, severity, size asymmetry',
  },
};

// ── Severity styling ──────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; border: string; badge: string; badgeBg: string; glow: string }> = {
  CRITICAL: { bg: '#EF444408', border: '#EF444430', badge: '#EF4444', badgeBg: '#EF444418', glow: '0 0 20px #EF444415' },
  HIGH:     { bg: '#F59E0B06', border: '#F59E0B28', badge: '#F59E0B', badgeBg: '#F59E0B14', glow: '0 0 20px #F59E0B10' },
  ELEVATED: { bg: '#8B5CF606', border: '#8B5CF628', badge: '#8B5CF6', badgeBg: '#8B5CF614', glow: '0 0 20px #8B5CF610' },
  WATCH:    { bg: '#0F7ABF06', border: '#0F7ABF28', badge: '#0F7ABF', badgeBg: '#0F7ABF14', glow: 'none' },
  DEFAULT:  { bg: 'transparent', border: '#1A2840', badge: '#4A5B6C', badgeBg: '#4A5B6C14', glow: 'none' },
};

function getSeverityStyle(label: string) {
  for (const key of Object.keys(SEVERITY_STYLES)) {
    if (label?.toUpperCase().includes(key)) return SEVERITY_STYLES[key];
  }
  return SEVERITY_STYLES.DEFAULT;
}

// ── Bottleneck level styles ───────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  CRITICAL:   { color: '#EF4444', bg: '#EF444418', border: '#EF444440' },
  BOTTLENECK: { color: '#F59E0B', bg: '#F59E0B14', border: '#F59E0B30' },
  WATCH:      { color: '#0F7ABF', bg: '#0F7ABF14', border: '#0F7ABF30' },
  RESOLVED:   { color: '#10B981', bg: '#10B98114', border: '#10B98130' },
};

function getLevelStyle(level?: string) {
  return level ? (LEVEL_STYLES[level.toUpperCase()] ?? null) : null;
}

// ── Supply chain tier mapping (Serenity Model 01) ─────────────────────────────

const SUB_TAG_TIER: Record<string, { tier: number; label: string; color: string }> = {
  MATERIALS_SUPPLY:          { tier: 1, label: 'Tier 1 · Raw Materials', color: '#8B5CF6' },
  QUANTUM_CRYOGENICS:        { tier: 2, label: 'Tier 2 · Substrates', color: '#8B5CF6' },
  FABRICATION_PACKAGING:     { tier: 3, label: 'Tier 3 · Foundry', color: '#0F7ABF' },
  INTERCONNECT_PHOTONICS:    { tier: 4, label: 'Tier 4 · Photonics', color: '#06B6D4' },
  MEMORY_STORAGE:            { tier: 4, label: 'Tier 4 · Memory', color: '#06B6D4' },
  COMPUTE_SCALING:           { tier: 5, label: 'Tier 5 · Compute', color: '#10B981' },
  THERMAL_COOLING:           { tier: 5, label: 'Tier 5 · Thermal', color: '#10B981' },
  POWER_GRID:                { tier: 6, label: 'Tier 6 · Power', color: '#F59E0B' },
  NUCLEAR_ENERGY:            { tier: 6, label: 'Tier 6 · Nuclear', color: '#F59E0B' },
};

// ── Comprehensive junk ticker filter ─────────────────────────────────────────
// Anything that looks like a ticker but is actually an acronym, abbreviation,
// currency, index, financial metric, tech term, or common word.

const JUNK_TICKERS = new Set([
  // Single / two letters that are common words
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  'AI','AN','AS','AT','BE','BY','DO','GO','HE','IF','IN','IS','IT','ME','MY','NO','OF','ON','OR','SO','TO','UP','WE',
  'UK','US','EU','UN',
  // Financial metrics & accounting
  'EPS','PE','PB','ROE','ROA','FCF','EBITDA','EBIT','CAGR','YOY','QOQ','MOM','AUM','NAV','NPV','IRR',
  'GAAP','IFRS','OPEX','CAPEX','WACC','DCF','IPO','AUM','ETF','ETH','BTC','DMA','ATH',
  'NII','NIM','CASA','GNPA','NNPA','LTV','EMI','SIP','PPF','KYC','AML',
  // Central banks & regulators
  'FED','RBI','ECB','BOE','BOJ','PBC','FOMC','SEC','SEBI','IRDAI','TRAI','CBI','CCI','NCLT',
  // Currencies & indices
  'USD','EUR','GBP','INR','JPY','CNY','CNH','AUD','CAD','CHF','SGD','HKD','SEK','NOK','DKK',
  'NIFTY','SENSEX','SPX','NDX','DJI','VIX','TRY','ZAR','BRL','MXN','IDR','KRW','TWD','THB','PHP','VND',
  // Tech abbreviations
  'API','CPU','GPU','HBM','HBM4','DRAM','SRAM','NAND','NOR','RAM','ROM','SSD','HDD','NVMe','PCIe',
  'AI','ML','DL','LLM','NLP','CV','IOT','AR','VR','XR','VPN','CDN','DNS','TCP','UDP','HTTP','HTTPS','SDK','IDE','CLI',
  'EDA','CAD','CAM','ERP','CRM','SaaS','PaaS','IaaS','RTOS','FPGA','ASIC','IP','ISP',
  // Industry jargon
  'CEO','CFO','CTO','COO','CMO','CHRO','MD','SVP','EVP','VP','GM','PM','HR','PR','IR','ESG',
  'M&A','LBO','IPO','SPO','FPO','QIP','FCCB','OFS','DRHP','SEBI',
  'GDP','CPI','WPI','PMI','PPI','IIP','MSCI','FTSE','EM','DM','FDI','FII','FPI',
  // Geography / regions
  'UAE','GCC','MENA','APAC','EMEA','ASEAN','BRICS','G7','G20','NATO','OPEC','WTO','IMF','WB',
  // Sports / entertainment (NLP false positives from Indian news)
  'IPL','BPL','ISL','PKL','IST','IND','AUS','ENG','PAK','SL','WI','NZ','SA','AFG','IRE',
  'GT','MI','CSK','KKR','RCB','SRH','DC','LSG','PBKS','RR','BCCI',
  // Common company roles / terms that get tagged
  'LTD','PVT','INC','LLC','CORP','PLC','AG','NV','SA','SPA','AB','AS','OY','GMBH',
  // Other false positives seen in the scanner
  'RBI','FDA','DOE','DOD','DOJ','CFPB','IRS','CFTC','FINRA','FTC',
  'BOE','NMI','FFO','LIV','PGA','RBI','BOI','SBI','PNB','IOB','BOB','UCO',
  'ACC','DM','EUR','FY','TETRA','RTX','SM','EV','BI','TSMC','NET','AES',
  'JSW','GCC','EVM','TMC','EC','ASP','MCX','FTA','ST','II','KR','UP',
  'EMYN','HUL','GLP','YD','ESAF','LIV','JBS','ATF','SSD','RPG',
  'RBI','RBI','NPP','NPU','WAVE','SIEGY','FDA','GEV',
  // Finance terms
  'ALL','ARE','HAL','BEL','CAN','HAS','HAD','WAS','GET','GOT','SET','PUT','BID','ASK',
]);

// Must be 2–6 letters, all caps, no digits-only, not a known junk word
function isLikelyTicker(t: string): boolean {
  if (!t) return false;
  const upper = t.toUpperCase();
  if (JUNK_TICKERS.has(upper)) return false;
  // Must be 2–6 uppercase alpha characters (no digits-only, no symbols except maybe one digit suffix)
  if (!/^[A-Z]{2,6}(\.[A-Z]{1,2})?$/.test(upper) && !/^[A-Z]{2,5}[0-9]$/.test(upper)) return false;
  // Skip all-consonant 3-letter "words" that look like abbreviations (heuristic)
  // e.g. FDA, CEO, GDP — but keep real tickers like NVDA, AMD, TSM
  const vowels = upper.replace(/[^AEIOU]/g, '').length;
  if (upper.length === 3 && vowels === 0) return false;
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const timeAgo = (iso: string) => {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return iso; }
};

function cleanUrl(raw: string): string {
  if (!raw || raw === '#') return '#';
  let u = raw.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
  const httpIdx = u.indexOf('http', 1);
  if (httpIdx > 0 && u.startsWith('http')) u = u.slice(httpIdx);
  return u;
}

function getTickerSymbols(article: NewsArticle): string[] {
  const raw = article.ticker_symbols?.length
    ? article.ticker_symbols
    : (article.tickers ?? []).map(t =>
        typeof t === 'string' ? t : (t as { ticker: string }).ticker ?? ''
      ).filter(Boolean);
  return raw.filter(t => isLikelyTicker(t));
}

function formatMarketCap(mc?: number): string {
  if (!mc || mc <= 0) return '—';
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9)  return `$${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6)  return `$${(mc / 1e6).toFixed(0)}M`;
  return `$${mc.toFixed(0)}`;
}

// ── Serenity Score (0–100) ────────────────────────────────────────────────────
// Composite metric combining: level severity, evidence strength,
// supply chain tier depth (deeper = rarer), and size asymmetry bonus.

function calcSerenityScore(row: {
  level?: string;
  evidence_count: number;
  sub_tag?: string;
  is_small_cap: boolean;
}): number {
  const levelWeight: Record<string, number> = { CRITICAL: 40, BOTTLENECK: 25, WATCH: 12, RESOLVED: 2 };
  const lv = levelWeight[(row.level ?? '').toUpperCase()] ?? 5;

  // Evidence score: logarithmic, max ~30
  const ev = Math.min(30, Math.round(Math.log2(row.evidence_count + 1) * 10));

  // Tier bonus: tier 1–3 (upstream) = more asymmetric, rarer
  const tierInfo = row.sub_tag ? SUB_TAG_TIER[row.sub_tag] : undefined;
  const tierBonus = tierInfo ? Math.max(0, (7 - tierInfo.tier) * 3) : 0;

  // Size asymmetry bonus
  const sizeBonus = row.is_small_cap ? 12 : 0;

  return Math.min(100, lv + ev + tierBonus + sizeBonus);
}

function scoreColor(score: number): string {
  if (score >= 80) return '#EF4444';
  if (score >= 60) return '#F59E0B';
  if (score >= 40) return '#0F7ABF';
  return '#4A5B6C';
}

// ── Exchange flag helper ──────────────────────────────────────────────────────

function exchangeFlag(exchange?: string): { flag: string; label: string } | null {
  if (!exchange) return null;
  const e = exchange.toUpperCase();
  if (e.includes('NSE') || e.includes('BSE'))       return { flag: '🇮🇳', label: 'India' };
  if (e.includes('STO') || e.includes('OMX'))        return { flag: '🇸🇪', label: 'Sweden' };
  if (e.includes('TSE') || e.includes('JPX') || e.includes('TYO')) return { flag: '🇯🇵', label: 'Japan' };
  if (e.includes('KRX') || e.includes('KOS'))        return { flag: '🇰🇷', label: 'Korea' };
  if (e.includes('FRA') || e.includes('XETRA'))      return { flag: '🇩🇪', label: 'Germany' };
  if (e.includes('TWO') || e.includes('TWSE'))       return { flag: '🇹🇼', label: 'Taiwan' };
  return null;
}

// ── API hooks ─────────────────────────────────────────────────────────────────

function useBottleneckDashboard() {
  return useQuery<BnDashboard>({
    queryKey: ['bn', 'dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/v1/news/bottleneck-dashboard');
      if (!res.ok) throw new Error('dashboard fetch failed');
      return res.json();
    },
    refetchInterval: 180_000,
    staleTime: 120_000,
    retry: 1,
  });
}

function useBottleneckNews() {
  return useQuery<NewsArticle[]>({
    queryKey: ['bn', 'news'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '400', importance_min: '2', article_type: 'BOTTLENECK' });
      const res = await fetch(`/api/v1/news?${params}`);
      if (!res.ok) throw new Error('news fetch failed');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: 1,
  });
}

// Fetch the US bulk quotes (real endpoint returning { stocks: [...] })
function useUSQuotes() {
  return useQuery<QuoteStock[]>({
    queryKey: ['bn', 'us-quotes'],
    queryFn: async () => {
      const res = await fetch('/api/market/quotes?market=us');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.stocks) ? data.stocks : [];
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1,
  });
}

// ── Scanner data builder ──────────────────────────────────────────────────────

interface ScannerRow {
  symbol: string;
  sub_tag?: string;
  level?: string;
  evidence_count: number;
  latest_at?: string;
  headlines: string[];
  exchange?: string;
  price?: number;
  market_cap?: number;
  change_pct?: number;
  company_name?: string;
  is_small_cap: boolean;
  is_non_us: boolean;
  serenity_score: number;
  tier?: { tier: number; label: string; color: string };
}

function buildScannerRows(articles: NewsArticle[], quotes: QuoteStock[]): ScannerRow[] {
  const map = new Map<string, Omit<ScannerRow, 'serenity_score' | 'tier' | 'is_small_cap' | 'is_non_us'>>();

  for (const a of articles) {
    const tickers = getTickerSymbols(a);
    for (const sym of tickers) {
      if (!map.has(sym)) {
        map.set(sym, {
          symbol: sym,
          sub_tag: a.bottleneck_sub_tag,
          level: a.bottleneck_level,
          evidence_count: 0,
          latest_at: a.published_at,
          headlines: [],
          exchange: undefined,
          price: undefined,
          market_cap: undefined,
          change_pct: undefined,
          company_name: undefined,
        });
      }
      const row = map.get(sym)!;
      row.evidence_count++;

      // Escalate severity: keep worst level
      const levels = ['CRITICAL', 'BOTTLENECK', 'WATCH', 'RESOLVED'];
      if (a.bottleneck_level) {
        const newIdx = levels.indexOf(a.bottleneck_level.toUpperCase());
        const curIdx = levels.indexOf((row.level ?? '').toUpperCase());
        if (newIdx !== -1 && (curIdx === -1 || newIdx < curIdx)) row.level = a.bottleneck_level;
      }
      if (!row.sub_tag && a.bottleneck_sub_tag) row.sub_tag = a.bottleneck_sub_tag;
      const headline = a.title || a.headline || '';
      if (headline && row.headlines.length < 4 && !row.headlines.includes(headline))
        row.headlines.push(headline);
      if (a.published_at && (!row.latest_at || a.published_at > row.latest_at))
        row.latest_at = a.published_at;
    }
  }

  // Build quote lookup map (case-insensitive)
  const quoteMap = new Map(quotes.map(q => [q.ticker.toUpperCase(), q]));

  const rows: ScannerRow[] = [];
  for (const [sym, base] of map) {
    const q = quoteMap.get(sym.toUpperCase());
    const market_cap = q?.marketCap;
    const is_small_cap = !!(market_cap && market_cap > 0 && market_cap < 2_000_000_000);
    const ef = exchangeFlag(q?.sector); // sector field may carry exchange info in some responses
    const is_non_us = !!ef;
    const tierInfo = base.sub_tag ? SUB_TAG_TIER[base.sub_tag] : undefined;

    const row: ScannerRow = {
      ...base,
      price: q?.price,
      market_cap,
      change_pct: q?.changePercent,
      company_name: q?.company,
      is_small_cap,
      is_non_us,
      tier: tierInfo,
      serenity_score: calcSerenityScore({
        level: base.level,
        evidence_count: base.evidence_count,
        sub_tag: base.sub_tag,
        is_small_cap,
      }),
    };
    rows.push(row);
  }

  // Only include rows with either: a sub_tag + ≥1 evidence, OR ≥2 evidence without sub_tag
  const filtered = rows.filter(r =>
    (r.sub_tag && r.evidence_count >= 1) || r.evidence_count >= 2
  );

  // Sort by Serenity Score descending
  return filtered.sort((a, b) => b.serenity_score - a.serenity_score);
}

// ── Section 1: Rotation Tracker ───────────────────────────────────────────────

function RotationTracker({ dashboard, isLoading }: {
  dashboard?: BnDashboard;
  isLoading: boolean;
}) {
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px', padding: '20px' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ height: '150px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '12px', opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  if (!dashboard?.buckets?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4A5B6C' }}>
        <AlertCircle className="w-10 h-10" style={{ margin: '0 auto 12px', color: '#1A2840' }} />
        <p style={{ fontSize: '13px' }}>No bottleneck dashboard data. Check backend is running.</p>
      </div>
    );
  }

  const sorted = [...dashboard.buckets].sort((a, b) => b.severity - a.severity);
  const topBucket = sorted[0];

  return (
    <div style={{ padding: '20px' }}>

      {/* Active Bottleneck Banner */}
      {topBucket && (
        <div style={{
          marginBottom: '20px', padding: '16px 20px',
          backgroundColor: '#060E1A',
          border: `1px solid ${getSeverityStyle(topBucket.severity_label).border}`,
          borderRadius: '12px',
          display: 'flex', alignItems: 'center', gap: '14px',
          boxShadow: getSeverityStyle(topBucket.severity_label).glow,
        }}>
          <span style={{ fontSize: '26px' }}>{topBucket.severity_icon || '⚡'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', color: '#4A5B6C' }}>ACTIVE BOTTLENECK</span>
              <span style={{
                fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px',
                color: getSeverityStyle(topBucket.severity_label).badge,
                backgroundColor: getSeverityStyle(topBucket.severity_label).badgeBg,
                padding: '2px 8px', borderRadius: '4px',
              }}>{topBucket.severity_label}</span>
            </div>
            <p style={{ fontSize: '16px', fontWeight: '800', color: '#F5F7FA', margin: '0 0 2px', letterSpacing: '-0.3px' }}>
              {topBucket.label}
            </p>
            <p style={{ fontSize: '12px', color: '#6B7A8D', margin: 0 }}>{topBucket.description}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: '28px', fontWeight: '800', color: getSeverityStyle(topBucket.severity_label).badge, margin: 0, lineHeight: 1 }}>
              {topBucket.signal_count}
            </p>
            <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '2px 0 0', letterSpacing: '0.5px' }}>SIGNALS</p>
          </div>
        </div>
      )}

      {/* Rotation sequence strip */}
      <div style={{
        marginBottom: '20px', padding: '10px 16px',
        backgroundColor: '#060E1A', borderRadius: '8px', border: '1px solid #1A2840',
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '1px', marginRight: '4px' }}>ROTATION:</span>
        {sorted.map((b, i) => (
          <span key={b.bucket_id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {i > 0 && <span style={{ color: '#1A2840' }}>›</span>}
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px',
              color: getSeverityStyle(b.severity_label).badge,
              backgroundColor: getSeverityStyle(b.severity_label).badgeBg,
              border: `1px solid ${getSeverityStyle(b.severity_label).border}`,
              opacity: i === 0 ? 1 : 0.7 - i * 0.05,
            }}>{b.label}</span>
          </span>
        ))}
      </div>

      {/* Bucket grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {sorted.map((bucket) => {
          const sty = getSeverityStyle(bucket.severity_label);
          const isExp = expandedBucket === bucket.bucket_id;

          return (
            <div key={bucket.bucket_id} style={{
              backgroundColor: sty.bg || '#0D1623',
              border: `1px solid ${sty.border}`,
              borderRadius: '12px', overflow: 'hidden',
              boxShadow: isExp ? sty.glow : 'none',
              transition: 'box-shadow 0.2s',
            }}>
              <button
                onClick={() => setExpandedBucket(isExp ? null : bucket.bucket_id)}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{bucket.severity_icon || '🔹'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{bucket.label}</span>
                      <span style={{
                        fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px',
                        color: sty.badge, backgroundColor: sty.badgeBg,
                        padding: '2px 6px', borderRadius: '3px',
                      }}>{bucket.severity_label}</span>
                    </div>
                    <p style={{ fontSize: '11px', color: '#6B7A8D', margin: '0 0 8px', lineHeight: '1.4' }}>{bucket.description}</p>
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}>
                        <span style={{ color: sty.badge, fontWeight: '700', fontSize: '14px' }}>{bucket.signal_count}</span> signals
                      </span>
                      <span style={{ fontSize: '11px', color: '#8A95A3' }}>
                        <span style={{ fontWeight: '600', color: '#C9D4E0' }}>{bucket.article_count}</span> articles
                      </span>
                    </div>
                    {bucket.key_tickers?.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {bucket.key_tickers.slice(0, 8).map(t => (
                          <span key={t} style={{
                            fontSize: '10px', fontWeight: '600', color: '#0F7ABF',
                            backgroundColor: '#0F7ABF14', border: '1px solid #0F7ABF30',
                            padding: '1px 6px', borderRadius: '4px',
                          }}>${t}</span>
                        ))}
                        {bucket.key_tickers.length > 8 && <span style={{ fontSize: '10px', color: '#4A5B6C' }}>+{bucket.key_tickers.length - 8}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ color: '#4A5B6C', flexShrink: 0 }}>
                    {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </div>
              </button>

              {isExp && bucket.signals?.length > 0 && (
                <div style={{ borderTop: `1px solid ${sty.border}` }}>
                  {bucket.signals.slice(0, 5).map((signal, si) => {
                    const sigKey = `${bucket.bucket_id}-${si}`;
                    const sigExp = expandedSignal === sigKey;
                    return (
                      <div key={si} style={{ borderBottom: si < Math.min(bucket.signals.length, 5) - 1 ? '1px solid #1A284030' : 'none' }}>
                        <button
                          onClick={() => setExpandedSignal(sigExp ? null : sigKey)}
                          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}
                        >
                          <Zap className="w-3 h-3" style={{ color: sty.badge, flexShrink: 0, marginTop: '2px' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '12px', color: '#C9D4E0', margin: 0, lineHeight: '1.4', textAlign: 'left' }}>{signal.headline}</p>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{signal.evidence_count} evidence</span>
                              {signal.latest_at && <span style={{ fontSize: '10px', color: '#4A5B6C' }}>{timeAgo(signal.latest_at)}</span>}
                              {signal.tickers?.slice(0, 3).map(t => (
                                <span key={t} style={{ fontSize: '10px', color: '#0F7ABF', fontWeight: '600' }}>${t}</span>
                              ))}
                            </div>
                          </div>
                          <div style={{ color: '#4A5B6C', flexShrink: 0 }}>
                            {sigExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </div>
                        </button>
                        {sigExp && (
                          <div style={{ padding: '0 16px 12px 36px' }}>
                            {signal.summary && <p style={{ fontSize: '11px', color: '#8A95A3', lineHeight: '1.5', margin: '0 0 8px' }}>{signal.summary}</p>}
                            {signal.articles?.slice(0, 3).map((art, ai) => (
                              <a key={ai} href={cleanUrl(art.source_url)} target="_blank" rel="noopener noreferrer"
                                style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 8px', marginBottom: '4px', backgroundColor: '#060E1A', borderRadius: '6px', textDecoration: 'none', border: '1px solid #1A2840' }}>
                                <ExternalLink className="w-3 h-3" style={{ color: '#4A5B6C', flexShrink: 0, marginTop: '2px' }} />
                                <div>
                                  <p style={{ fontSize: '11px', color: '#C9D4E0', margin: 0, lineHeight: '1.3' }}>{art.headline}</p>
                                  <p style={{ fontSize: '10px', color: '#4A5B6C', margin: '2px 0 0' }}>{art.source_name} · {timeAgo(art.published_at)}</p>
                                </div>
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

      {dashboard && (
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px', color: '#4A5B6C' }}>
          {dashboard.total_articles} articles analyzed · auto-refreshes every 3 min
        </p>
      )}
    </div>
  );
}

// ── Score Gauge ───────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score);
  const pct = score; // 0–100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ width: '36px', height: '36px', position: 'relative', flexShrink: 0 }}>
        <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
          <circle cx="18" cy="18" r="14" fill="none" stroke="#1A2840" strokeWidth="3" />
          <circle cx="18" cy="18" r="14" fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${(pct / 100) * 88} 88`} strokeLinecap="round" />
        </svg>
        <span style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', fontWeight: '800', color,
        }}>{score}</span>
      </div>
    </div>
  );
}

// ── Section 2: Stock Scanner ──────────────────────────────────────────────────

function StockScanner({ articles, isLoading, quotes, quotesLoading }: {
  articles: NewsArticle[];
  isLoading: boolean;
  quotes: QuoteStock[];
  quotesLoading: boolean;
}) {
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const allRows = useMemo(() => buildScannerRows(articles, quotes), [articles, quotes]);

  const rows = useMemo(() => {
    if (filterLevel === 'ALL') return allRows;
    return allRows.filter(r => r.level?.toUpperCase() === filterLevel);
  }, [allRows, filterLevel]);

  const LEVELS = ['ALL', 'CRITICAL', 'BOTTLENECK', 'WATCH'];

  const criticalSmallCaps = allRows.filter(r => r.is_small_cap && (r.level === 'CRITICAL' || r.level === 'BOTTLENECK'));

  if (isLoading) {
    return (
      <div style={{ padding: '20px' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ height: '56px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: '8px', marginBottom: '6px', opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {(['ALL', 'CRITICAL', 'BOTTLENECK', 'WATCH'] as const).map(lv => {
            const count = lv === 'ALL' ? allRows.length : allRows.filter(r => r.level?.toUpperCase() === lv).length;
            const lvSty = lv !== 'ALL' ? getLevelStyle(lv) : null;
            return (
              <button key={lv} onClick={() => setFilterLevel(lv)} style={{
                padding: '6px 14px', borderRadius: '8px', border: `1px solid ${filterLevel === lv ? (lvSty?.border ?? '#0F7ABF40') : '#1A2840'}`,
                cursor: 'pointer', backgroundColor: filterLevel === lv ? (lvSty?.bg ?? '#0F7ABF14') : 'transparent',
                color: filterLevel === lv ? (lvSty?.color ?? '#0F7ABF') : '#6B7A8D', fontSize: '11px', fontWeight: '600',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}>
                <span>{lv}</span>
                <span style={{ fontSize: '10px', opacity: 0.8 }}>({count})</span>
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: '11px', color: '#4A5B6C', marginLeft: 'auto' }}>
          {rows.length} companies · {quotesLoading ? 'loading prices…' : `${quotes.length} quotes loaded`}
        </span>
      </div>

      {/* Size asymmetry alert */}
      {criticalSmallCaps.length > 0 && (
        <div style={{
          marginBottom: '14px', padding: '10px 14px',
          backgroundColor: '#F59E0B08', border: '1px solid #F59E0B28', borderRadius: '8px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <Flag className="w-4 h-4" style={{ color: '#F59E0B', flexShrink: 0 }} />
          <div>
            <span style={{ fontSize: '12px', color: '#F59E0B', fontWeight: '700' }}>
              {criticalSmallCaps.length} size asymmetry plays detected
            </span>
            <span style={{ fontSize: '11px', color: '#8A95A3', marginLeft: '8px' }}>
              Small-cap (&lt;$2B) with CRITICAL/BOTTLENECK signal — Serenity Model 06
            </span>
          </div>
        </div>
      )}

      {/* Column header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '48px 90px 1fr 110px 110px 70px 80px',
        gap: '8px', padding: '6px 12px',
        fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: '#4A5B6C',
        borderBottom: '1px solid #1A2840',
      }}>
        <span>SCORE</span>
        <span>TICKER</span>
        <span>LAYER</span>
        <span>LEVEL</span>
        <span>MARKET CAP</span>
        <span>SIGNALS</span>
        <span>PRICE</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#4A5B6C', fontSize: '13px' }}>
          No results for this filter.
        </div>
      ) : (
        rows.map((row, idx) => {
          const lvSty = getLevelStyle(row.level);
          const ef = row.is_non_us ? exchangeFlag(row.exchange) : null;
          const isExp = expandedRow === row.symbol;
          const changePct = row.change_pct ?? 0;
          const tierInfo = row.tier;

          return (
            <div key={row.symbol} style={{ borderBottom: '1px solid #1A284020' }}>
              <button
                onClick={() => setExpandedRow(isExp ? null : row.symbol)}
                style={{
                  width: '100%', background: isExp ? '#0D162350' : (idx % 2 === 0 ? 'transparent' : '#060E1A20'),
                  border: 'none', cursor: 'pointer', textAlign: 'left', padding: '10px 12px',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '48px 90px 1fr 110px 110px 70px 80px',
                  gap: '8px', alignItems: 'center',
                }}>
                  {/* Score */}
                  <ScoreGauge score={row.serenity_score} />

                  {/* Ticker */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#F5F7FA' }}>{row.symbol}</span>
                    {ef && <span title={`${ef.label} listed`} style={{ fontSize: '13px' }}>{ef.flag}</span>}
                    {row.is_small_cap && (
                      <span title="Small-cap <$2B — size asymmetry (Model 06)" style={{
                        fontSize: '8px', color: '#F59E0B', border: '1px solid #F59E0B40',
                        padding: '0 3px', borderRadius: '3px', fontWeight: '700', letterSpacing: '0.5px',
                      }}>SC</span>
                    )}
                    {idx < 3 && <Trophy className="w-3 h-3" style={{ color: scoreColor(row.serenity_score) }} />}
                  </div>

                  {/* Layer */}
                  <div style={{ minWidth: 0 }}>
                    {tierInfo ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{
                          fontSize: '9px', fontWeight: '700',
                          color: tierInfo.color, border: `1px solid ${tierInfo.color}40`,
                          padding: '1px 4px', borderRadius: '3px', flexShrink: 0,
                        }}>T{tierInfo.tier}</span>
                        <span style={{ fontSize: '11px', color: '#8A95A3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.sub_tag!.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>
                    )}
                  </div>

                  {/* Level */}
                  {lvSty ? (
                    <span style={{
                      fontSize: '10px', fontWeight: '700',
                      color: lvSty.color, backgroundColor: lvSty.bg,
                      border: `1px solid ${lvSty.border}`,
                      padding: '3px 8px', borderRadius: '4px', textAlign: 'center', display: 'inline-block',
                    }}>{row.level}</span>
                  ) : <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>}

                  {/* Market cap */}
                  <span style={{ fontSize: '12px', color: row.is_small_cap ? '#F59E0B' : '#C9D4E0', fontWeight: row.is_small_cap ? '700' : '400' }}>
                    {formatMarketCap(row.market_cap)}
                  </span>

                  {/* Evidence */}
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#C9D4E0' }}>{row.evidence_count}</span>

                  {/* Price */}
                  <div>
                    {row.price ? (
                      <div>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: '#F5F7FA' }}>${row.price.toFixed(2)}</span>
                        {changePct !== 0 && (
                          <div style={{ fontSize: '10px', color: changePct >= 0 ? '#10B981' : '#EF4444' }}>
                            {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                          </div>
                        )}
                      </div>
                    ) : <span style={{ fontSize: '11px', color: '#4A5B6C' }}>—</span>}
                  </div>
                </div>
              </button>

              {/* Expanded row */}
              {isExp && (
                <div style={{ padding: '10px 12px 14px 60px', backgroundColor: '#060E1A30', borderTop: '1px solid #1A2840' }}>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {row.company_name && (
                      <span style={{ fontSize: '12px', color: '#8A95A3', fontWeight: '500' }}>{row.company_name}</span>
                    )}
                    {tierInfo && (
                      <span style={{ fontSize: '11px', color: tierInfo.color }}>{tierInfo.label}</span>
                    )}
                    {row.latest_at && (
                      <span style={{ fontSize: '10px', color: '#4A5B6C' }}>Last signal {timeAgo(row.latest_at)}</span>
                    )}
                  </div>
                  <p style={{ fontSize: '10px', color: '#4A5B6C', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '6px' }}>
                    EVIDENCE ({row.evidence_count} articles)
                  </p>
                  {row.headlines.map((h, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '6px', alignItems: 'flex-start',
                      padding: '7px 10px', marginBottom: '4px',
                      backgroundColor: '#060E1A', borderRadius: '6px', border: '1px solid #1A2840',
                    }}>
                      <Zap className="w-3 h-3" style={{ color: '#0F7ABF', flexShrink: 0, marginTop: '2px' }} />
                      <span style={{ fontSize: '11px', color: '#C9D4E0', lineHeight: '1.45' }}>{h}</span>
                    </div>
                  ))}
                  {/* Serenity model tags */}
                  <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {row.sub_tag && <span style={{ fontSize: '9px', color: '#4A5B6C', border: '1px solid #1A2840', padding: '2px 6px', borderRadius: '4px' }}>Model 01 · Supply Chain Map</span>}
                    {row.is_small_cap && <span style={{ fontSize: '9px', color: '#F59E0B', border: '1px solid #F59E0B30', padding: '2px 6px', borderRadius: '4px' }}>Model 06 · Size Asymmetry</span>}
                    {row.evidence_count >= 3 && <span style={{ fontSize: '9px', color: '#0F7ABF', border: '1px solid #0F7ABF30', padding: '2px 6px', borderRadius: '4px' }}>Model 02 · Monopoly Signal</span>}
                    {row.is_non_us && <span style={{ fontSize: '9px', color: '#8B5CF6', border: '1px solid #8B5CF630', padding: '2px 6px', borderRadius: '4px' }}>Model 10 · Cross-Border Arb</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BottleneckIntelPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Rotation');

  const { data: dashboard, isLoading: dashLoading, refetch: refetchDash, dataUpdatedAt: dashTs } = useBottleneckDashboard();
  const { data: articles = [], isLoading: articlesLoading, refetch: refetchArticles, dataUpdatedAt: articleTs } = useBottleneckNews();
  const { data: usQuotes = [], isLoading: quotesLoading } = useUSQuotes();

  const lastRefreshed = useMemo(() => {
    const ts = activeTab === 'Rotation' ? dashTs : articleTs;
    if (!ts) return null;
    try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); } catch { return null; }
  }, [activeTab, dashTs, articleTs]);

  const handleRefresh = useCallback(() => {
    refetchDash(); refetchArticles();
  }, [refetchDash, refetchArticles]);

  const isLoading = activeTab === 'Rotation' ? dashLoading : articlesLoading;

  return (
    <div style={{ minHeight: '100%', backgroundColor: '#0A0E1A' }}>

      {/* Header */}
      <div style={{ padding: '20px 20px 0', borderBottom: '1px solid #1A2840', backgroundColor: '#0D1623' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
              <span style={{ fontSize: '20px' }}>🔬</span>
              <h1 style={{
                fontSize: '19px', fontWeight: '800', margin: 0, letterSpacing: '-0.5px',
                background: 'linear-gradient(90deg, #F5F7FA 60%, #6B7A8D)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>BOTTLENECK INTELLIGENCE</h1>
            </div>
            <p style={{ fontSize: '11px', color: '#4A5B6C', margin: 0 }}>
              Serenity 37-Model Framework · Live Supply Chain Analysis
              {lastRefreshed && <span> · Updated {lastRefreshed}</span>}
            </p>
          </div>
          <button
            onClick={handleRefresh} disabled={isLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px',
              borderRadius: '8px', cursor: isLoading ? 'default' : 'pointer',
              backgroundColor: 'transparent', border: '1px solid #1A2840',
              color: isLoading ? '#4A5B6C' : '#6B7A8D', fontSize: '12px', flexShrink: 0,
            }}
          >
            <RefreshCw className="w-3 h-3" style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            {isLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex' }}>
          {TABS.map(tab => {
            const cfg = TAB_CONFIG[tab];
            const active = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 20px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent',
                color: active ? '#0F7ABF' : '#6B7A8D', fontSize: '13px', fontWeight: active ? '700' : '400',
                borderBottom: active ? '2px solid #0F7ABF' : '2px solid transparent',
                marginBottom: '-1px', transition: 'all 0.15s',
              }}>
                {cfg.icon}<span>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Description strip */}
      <div style={{ padding: '8px 20px', backgroundColor: '#060E1A', borderBottom: '1px solid #1A2840' }}>
        <p style={{ fontSize: '11px', color: '#4A5B6C', margin: 0 }}>{TAB_CONFIG[activeTab].description}</p>
      </div>

      {activeTab === 'Rotation' && <RotationTracker dashboard={dashboard} isLoading={dashLoading} />}
      {activeTab === 'Scanner' && (
        <StockScanner
          articles={articles}
          isLoading={articlesLoading}
          quotes={usQuotes}
          quotesLoading={quotesLoading}
        />
      )}
    </div>
  );
}
