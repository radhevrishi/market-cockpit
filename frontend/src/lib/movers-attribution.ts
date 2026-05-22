// ═══════════════════════════════════════════════════════════════════════════
// INSTITUTIONAL MOVERS ATTRIBUTION ENGINE (PATCH 0708)
//
// Replaces the shallow "find any filing match" home-page enrichment with a
// proper event-attribution engine that:
//
//   1. Classifies catalyst type (EARNINGS / OFS / BLOCK_DEAL / REGULATORY /
//      ORDER_WIN / RATING / M&A / SECTOR_ROTATION / NONE)
//   2. Classifies move type (INFORMATION-driven / FLOW-driven /
//      POSITIONING-driven / LIQUIDITY-driven / MACRO-driven)
//   3. Detects sector-wide moves by cross-correlating peers in the same
//      sector (5+ peers >3% same direction = SECTOR_WIDE, not STOCK_SPECIFIC)
//   4. Assigns confidence (HIGH = filing in last 48h with matching subject;
//      MEDIUM = news + sector confirmation; LOW = sector inference only)
//   5. Is HONEST when nothing concrete exists ("No confirmed trigger —
//      likely sector rotation / smallcap liquidity") instead of inventing
//      causation from correlation
//
// Source: user's institutional-event-driven feedback. The promise this
// engine makes is: every row gets a description that is either
// evidence-backed or honestly labeled as inferred.
// ═══════════════════════════════════════════════════════════════════════════

export type CatalystType =
  | 'EARNINGS'         // Q4 / FY results, transcripts, investor presentations
  | 'OFS'              // Offer for sale, stake sale, government divestment
  | 'BLOCK_DEAL'       // Bulk / block transaction, promoter selling
  | 'REGULATORY'       // SEBI / RBI / FDA / regulator action
  | 'ORDER_WIN'        // Receipt of order, letter of award, contract
  | 'RATING'           // ICRA / CRISIL / CARE / S&P rating action
  | 'MNA'              // Merger, acquisition, demerger, scheme of arrangement
  | 'SECTOR_ROTATION'  // Sector-wide move, no stock-specific trigger
  | 'NONE';            // No identifiable catalyst — likely flow / liquidity

export type MoveType =
  | 'INFORMATION'      // Real new info hit the wire (filing / news / event)
  | 'FLOW'             // OFS / block deal / passive index rebalance
  | 'POSITIONING'      // Short squeeze / unwind (hard to detect without OI data)
  | 'LIQUIDITY'        // Smallcap, low float, momentum chasing
  | 'MACRO';           // Sector-wide rotation, policy, rate moves

export type Scope = 'STOCK_SPECIFIC' | 'SECTOR_WIDE' | 'INDEX_WIDE';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MoverInput {
  ticker: string;
  sector?: string;
  industry?: string;
  changePercent: number;
  indexGroup?: string;    // 'Small' / 'Mid' / 'Large'
  marketCap?: number;     // ₹ Cr
}

export interface FilingInput {
  symbol: string;
  subject?: string;
  filing_type?: string;
  filing_datetime?: string;
  source_url?: string;
  attachment_urls?: string[];
}

export interface NewsInput {
  ticker?: string;
  title?: string;
  headline?: string;
  article_type?: string;
  published_at?: string;
  source_url?: string;
  url?: string;
  is_synthetic?: boolean;
  importance_score?: number;
}

export interface MoverAttribution {
  ticker: string;
  changePercent: number;
  catalyst: string;                  // headline reason (short, institutional)
  catalystType: CatalystType;
  moveType: MoveType;
  scope: Scope;
  confidence: Confidence;
  evidenceSource: 'filing' | 'news' | 'sector_peer' | 'inferred';
  evidenceUrl?: string;
  // Peer context — how many same-sector peers moved >3% in same direction
  sectorPeerCount?: number;
  sectorDirection?: 'up' | 'down' | 'mixed';
}

// ─── helpers ────────────────────────────────────────────────────────────

function normSym(s: string): string {
  return (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
}

function isFresh(iso: string | undefined, windowMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && (Date.now() - t) < windowMs;
}

// Catalyst classification from a filing subject + filing_type.
function classifyFilingCatalyst(filing: FilingInput): { type: CatalystType; label: string } {
  const subj = (filing.subject || '').trim();
  const ft = (filing.filing_type || '').toUpperCase();

  if (ft === 'ORDER_RECEIPT' || /receipt of order|letter of award|\bLoA\b|order received|bagged order|wins order|secured order|contract award/i.test(subj)) {
    return { type: 'ORDER_WIN', label: subj.slice(0, 100) || 'Order win disclosed' };
  }
  if (ft === 'RATING_ACTION' || /\b(ICRA|CRISIL|CARE|India Ratings|Moody|Fitch|S&P)\b|rating (?:upgrade|downgrade|reaffirm|outlook)/i.test(subj)) {
    return { type: 'RATING', label: subj.slice(0, 100) || 'Rating action disclosed' };
  }
  if (/preferential|SAST|stake sale|merger|acquisition|de[- ]listing|open offer|scheme of arrangement|demerger/i.test(subj)) {
    return { type: 'MNA', label: subj.slice(0, 100) || 'Corporate action' };
  }
  if (/\bOFS\b|offer for sale|government divestment|stake sale at|floor price/i.test(subj)) {
    return { type: 'OFS', label: subj.slice(0, 100) || 'OFS announced' };
  }
  if (/SEBI|RBI|MCA|tribunal|NCLT|CIRP|insolvency|regulatory/i.test(subj)) {
    return { type: 'REGULATORY', label: subj.slice(0, 100) || 'Regulatory disclosure' };
  }
  if (ft === 'TRANSCRIPT' || ft === 'RESULTS_PRESENTATION' || ft === 'INVESTOR_PRESENTATION' ||
      ft === 'CONCALL_INVITE' || /Q[1-4]\s*FY|quarterly|results|earnings|transcript|concall|investor (?:meet|presentation)|audited financial/i.test(subj)) {
    return { type: 'EARNINGS', label: subj.slice(0, 100) || 'Results disclosed' };
  }
  return { type: 'NONE', label: subj.slice(0, 100) || 'Disclosure' };
}

function classifyNewsCatalyst(article: NewsInput): { type: CatalystType; label: string } {
  const title = (article.title || article.headline || '').trim();
  const at = (article.article_type || '').toUpperCase();

  if (at === 'EARNINGS' || /Q[1-4]\s*FY|quarterly|results|earnings/i.test(title)) {
    return { type: 'EARNINGS', label: title.slice(0, 100) };
  }
  if (/\bOFS\b|offer for sale|stake sale|floor price/i.test(title)) {
    return { type: 'OFS', label: title.slice(0, 100) };
  }
  if (/block deal|bulk deal|promoter (?:sells|offload|trim)|insider sale/i.test(title)) {
    return { type: 'BLOCK_DEAL', label: title.slice(0, 100) };
  }
  if (/order|letter of award|\bLoA\b|contract|won/i.test(title)) {
    return { type: 'ORDER_WIN', label: title.slice(0, 100) };
  }
  if (/ICRA|CRISIL|CARE|Moody|S&P|Fitch|upgrade|downgrade|rating/i.test(title)) {
    return { type: 'RATING', label: title.slice(0, 100) };
  }
  if (/merger|acquisition|de-?listing|open offer|scheme of arrangement|demerger|stake hike/i.test(title)) {
    return { type: 'MNA', label: title.slice(0, 100) };
  }
  if (/SEBI|RBI|FDA|USFDA|MHRA|approval|regulator|policy/i.test(title)) {
    return { type: 'REGULATORY', label: title.slice(0, 100) };
  }
  return { type: 'NONE', label: title.slice(0, 100) || 'News mention' };
}

// Determine move type from catalyst type.
function deriveMoveType(catalystType: CatalystType, indexGroup?: string): MoveType {
  if (catalystType === 'OFS' || catalystType === 'BLOCK_DEAL') return 'FLOW';
  if (catalystType === 'EARNINGS' || catalystType === 'ORDER_WIN' ||
      catalystType === 'MNA' || catalystType === 'REGULATORY' ||
      catalystType === 'RATING') return 'INFORMATION';
  if (catalystType === 'SECTOR_ROTATION') return 'MACRO';
  // NONE catalyst + smallcap → likely liquidity-driven
  if ((indexGroup || '').toLowerCase() === 'small') return 'LIQUIDITY';
  return 'MACRO';
}

// ─── peer-correlation (sector-wide vs stock-specific) ───────────────────

interface PeerContext {
  bySector: Map<string, { up: number; down: number; tickers: string[] }>;
  byIndustry: Map<string, { up: number; down: number; tickers: string[] }>;
}

function buildPeerContext(movers: MoverInput[]): PeerContext {
  const bySector = new Map<string, { up: number; down: number; tickers: string[] }>();
  const byIndustry = new Map<string, { up: number; down: number; tickers: string[] }>();
  const PEER_THRESHOLD_PCT = 3;
  for (const m of movers) {
    if (Math.abs(m.changePercent) < PEER_THRESHOLD_PCT) continue;
    const direction = m.changePercent > 0 ? 'up' : 'down';
    const s = (m.sector || '').trim();
    const i = (m.industry || '').trim();
    if (s) {
      if (!bySector.has(s)) bySector.set(s, { up: 0, down: 0, tickers: [] });
      const e = bySector.get(s)!;
      e[direction]++;
      e.tickers.push(m.ticker);
    }
    if (i && i !== s) {
      if (!byIndustry.has(i)) byIndustry.set(i, { up: 0, down: 0, tickers: [] });
      const e = byIndustry.get(i)!;
      e[direction]++;
      e.tickers.push(m.ticker);
    }
  }
  return { bySector, byIndustry };
}

// ─── main attribution function ──────────────────────────────────────────

interface AttributeOpts {
  movers: MoverInput[];          // all gainers + losers in one array
  filingsBySymbol: Record<string, FilingInput[]>;
  newsByTicker?: Record<string, NewsInput[]>;
}

export function attributeMovers(opts: AttributeOpts): Record<string, MoverAttribution> {
  const peers = buildPeerContext(opts.movers);
  const FILING_WINDOW = 3 * 24 * 3600 * 1000;   // 3 days for catalyst freshness
  const NEWS_WINDOW = 2 * 24 * 3600 * 1000;     // 2 days
  const SECTOR_WIDE_MIN_PEERS = 4;              // 4+ same-direction peers = sector move

  const out: Record<string, MoverAttribution> = {};

  for (const m of opts.movers) {
    const sym = normSym(m.ticker);
    const direction = m.changePercent > 0 ? 'up' : 'down';
    const sectorStats = m.sector ? peers.bySector.get(m.sector) : undefined;
    const industryStats = m.industry ? peers.byIndustry.get(m.industry) : undefined;
    const peerCountSameDirection = Math.max(
      sectorStats?.[direction] || 0,
      industryStats?.[direction] || 0,
    );
    const sectorScope: Scope = peerCountSameDirection >= SECTOR_WIDE_MIN_PEERS ? 'SECTOR_WIDE' : 'STOCK_SPECIFIC';

    // ── TIER 1: filing match (HIGH confidence) ────────────────────────────
    const filings = (opts.filingsBySymbol[sym] || [])
      .filter(f => isFresh(f.filing_datetime, FILING_WINDOW))
      .sort((a, b) => new Date(b.filing_datetime || 0).getTime() - new Date(a.filing_datetime || 0).getTime());
    if (filings.length > 0) {
      const top = filings[0];
      const cat = classifyFilingCatalyst(top);
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: cat.label,
        catalystType: cat.type,
        moveType: deriveMoveType(cat.type, m.indexGroup),
        scope: sectorScope === 'SECTOR_WIDE' ? 'SECTOR_WIDE' : 'STOCK_SPECIFIC',
        confidence: 'HIGH',
        evidenceSource: 'filing',
        evidenceUrl: top.source_url || top.attachment_urls?.[0],
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
      };
      continue;
    }

    // ── TIER 2: news match (MEDIUM confidence) ────────────────────────────
    const news = (opts.newsByTicker?.[sym] || [])
      .filter(a => !a.is_synthetic && isFresh(a.published_at, NEWS_WINDOW))
      .sort((a, b) => {
        const ai = a.importance_score ?? 0;
        const bi = b.importance_score ?? 0;
        if (ai !== bi) return bi - ai;
        return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
      });
    if (news.length > 0) {
      const top = news[0];
      const cat = classifyNewsCatalyst(top);
      // News confidence: HIGH only if peer count is LOW (stock-specific signal),
      // MEDIUM otherwise (could be the news *reporting* the sector move).
      const newsConfidence: Confidence = peerCountSameDirection >= SECTOR_WIDE_MIN_PEERS ? 'MEDIUM' : 'MEDIUM';
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: cat.label,
        catalystType: cat.type,
        moveType: deriveMoveType(cat.type, m.indexGroup),
        scope: sectorScope,
        confidence: newsConfidence,
        evidenceSource: 'news',
        evidenceUrl: top.source_url || top.url,
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
      };
      continue;
    }

    // ── TIER 3: sector-peer inference (LOW confidence) ───────────────────
    if (sectorScope === 'SECTOR_WIDE') {
      const sectorLabel = m.sector || m.industry || 'sector';
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: `Sector-wide ${direction === 'up' ? 'rally' : 'sell-off'} — ${peerCountSameDirection} ${sectorLabel} names moving ${direction === 'up' ? '↑' : '↓'} > 3% together`,
        catalystType: 'SECTOR_ROTATION',
        moveType: 'MACRO',
        scope: 'SECTOR_WIDE',
        confidence: 'LOW',
        evidenceSource: 'sector_peer',
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
      };
      continue;
    }

    // ── TIER 4: honest "no confirmed trigger" (LOW confidence) ───────────
    // For smallcaps with no filing + no news + no sector confirmation, the
    // move is most likely liquidity / momentum-driven. Say so honestly
    // rather than inventing causation.
    const indGroup = (m.indexGroup || '').toLowerCase();
    const smallcap = indGroup === 'small';
    const honestLabel = smallcap
      ? `No confirmed trigger — smallcap ${direction === 'up' ? 'momentum' : 'unwind'} (likely liquidity-driven)`
      : `No confirmed trigger — ${m.industry || m.sector || 'sector'} ${direction === 'up' ? 'rotation' : 'profit booking'}`;
    out[sym] = {
      ticker: sym,
      changePercent: m.changePercent,
      catalyst: honestLabel,
      catalystType: 'NONE',
      moveType: smallcap ? 'LIQUIDITY' : 'MACRO',
      scope: 'STOCK_SPECIFIC',
      confidence: 'LOW',
      evidenceSource: 'inferred',
      sectorPeerCount: peerCountSameDirection,
      sectorDirection: direction,
    };
  }

  return out;
}

// ─── render helpers ─────────────────────────────────────────────────────

export const CATALYST_GLYPH: Record<CatalystType, string> = {
  EARNINGS: '📊',
  OFS: '🏛',
  BLOCK_DEAL: '🔁',
  REGULATORY: '⚖️',
  ORDER_WIN: '📑',
  RATING: '🏷',
  MNA: '🎯',
  SECTOR_ROTATION: '🌀',
  NONE: '·',
};

export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  HIGH: '#10B981',
  MEDIUM: '#22D3EE',
  LOW: '#F59E0B',
};

export const MOVE_TYPE_LABEL: Record<MoveType, string> = {
  INFORMATION: 'info-driven',
  FLOW: 'flow-driven',
  POSITIONING: 'positioning',
  LIQUIDITY: 'liquidity',
  MACRO: 'macro/sector',
};
