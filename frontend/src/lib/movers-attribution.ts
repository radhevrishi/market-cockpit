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

// PATCH 0711 — Earnings + special-situations as first-class catalysts.
// /api/v1/earnings/graded returns by_tier[BLOCKBUSTER|STRONG|MODERATE|...]
// Each item has {ticker, company, sector, filing_date, quarter,
// sales_yoy_pct, net_profit_yoy_pct, eps_yoy_pct, ...}.
export interface EarningsHit {
  ticker: string;
  tier: 'BLOCKBUSTER' | 'STRONG' | 'MODERATE' | 'WEAK' | 'POOR' | string;
  quarter?: string;
  filing_date?: string;
  sales_yoy_pct?: number;
  net_profit_yoy_pct?: number;
  eps_yoy_pct?: number;
}
// /api/v1/special-situations returns events with {target, event_type, ...}
export interface SpecialSituationHit {
  ticker: string;
  event_type: string;        // 'OPEN_OFFER' | 'OFS' | 'PREFERENTIAL' | 'MERGER' | 'DEMERGER' | 'BUYBACK' | etc
  sub_category?: string;
  announced_at?: string;
  headline?: string;
  source_url?: string;
}

export interface MoverAttribution {
  ticker: string;
  changePercent: number;
  catalyst: string;                  // SHORT label (1 line, the chip)
  detail?: string;                   // PATCH 0794 — 1-2 line analyst note
  catalystType: CatalystType;
  moveType: MoveType;
  scope: Scope;
  confidence: Confidence;
  evidenceSource: 'filing' | 'news' | 'sector_peer' | 'inferred';
  evidenceUrl?: string;
  // Peer context — how many same-sector peers moved >3% in same direction
  sectorPeerCount?: number;
  sectorDirection?: 'up' | 'down' | 'mixed';
  // PATCH 0794 — structured evidence for explainability
  evidence?: {
    sectorMovePct?: number;       // current sector aggregate move %
    indexMovePct?: number;        // index aggregate (avg of all stocks)
    peerCountUp?: number;
    peerCountDown?: number;
    peerCountTotal?: number;
    filingChecked: boolean;       // did we look at filings?
    newsChecked: boolean;
    feedGap?: boolean;            // true = feeds failed (so 'no trigger' isn't trustworthy)
    volumeNote?: string;          // e.g. "vol 4.2× peer median"
  };
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
  // PATCH 0711 — new HIGH-confidence sources
  earningsByTicker?: Record<string, EarningsHit>;
  specialByTicker?: Record<string, SpecialSituationHit>;
  // PATCH 0794 — sector aggregates for analyst-grade context
  sectorAggregates?: Record<string, { avgChangePct: number; stockCount: number }>;
  indexAvgChangePct?: number;     // broad market avg from same response
  // PATCH 0794 — feed-gap signal so "no trigger" isn't conflated with "feeds failed"
  filingsFeedHealthy?: boolean;   // true = concall-intel feed returned successfully
  newsFeedHealthy?: boolean;
  earningsFeedHealthy?: boolean;
}

// PATCH 0794 — formatting helpers for analyst-grade detail strings.
function fmtPct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '?';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// Build "Auto sector +1.8% vs index -0.3%; 7 of 12 peers moving up >3%"
function buildSectorContext(
  sectorName: string | undefined,
  sectorAgg: { avgChangePct: number; stockCount: number } | undefined,
  indexAvg: number | undefined,
  peerStats: { up: number; down: number; tickers: string[] } | undefined,
  direction: 'up' | 'down',
): string {
  if (!sectorName) return '';
  const parts: string[] = [];
  if (sectorAgg) {
    if (typeof indexAvg === 'number') {
      parts.push(`${sectorName} ${fmtPct(sectorAgg.avgChangePct)} vs index ${fmtPct(indexAvg)}`);
    } else {
      parts.push(`${sectorName} sector ${fmtPct(sectorAgg.avgChangePct)}`);
    }
  }
  if (peerStats) {
    const total = peerStats.up + peerStats.down;
    const sameDir = direction === 'up' ? peerStats.up : peerStats.down;
    if (total >= 3) {
      parts.push(`${sameDir} of ${total} peers ${direction === 'up' ? '↑' : '↓'} >3%`);
    }
  }
  return parts.join('; ');
}

export function attributeMovers(opts: AttributeOpts): Record<string, MoverAttribution> {
  const peers = buildPeerContext(opts.movers);
  const FILING_WINDOW = 3 * 24 * 3600 * 1000;   // 3 days for catalyst freshness
  const NEWS_WINDOW = 2 * 24 * 3600 * 1000;     // 2 days
  const EARNINGS_WINDOW = 7 * 24 * 3600 * 1000; // 7 days — earnings reaction often lasts a week
  const SECTOR_WIDE_MIN_PEERS = 4;              // 4+ same-direction peers = sector move
  // PATCH 0794 — track feed-gap so 'no trigger' rows are honest about it
  const filingChecked = opts.filingsFeedHealthy !== false;
  const newsChecked = opts.newsFeedHealthy !== false;
  const feedGap = (opts.filingsFeedHealthy === false) || (opts.newsFeedHealthy === false);

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

    // PATCH 0794 — sector aggregate from opts (if passed); peerStats for detail
    const sectorAgg = m.sector ? opts.sectorAggregates?.[m.sector] : undefined;
    const peerStats = sectorStats || industryStats;
    const sectorContext = buildSectorContext(m.sector, sectorAgg, opts.indexAvgChangePct, peerStats, direction);
    // PATCH 0795 — never show 'Other' / 'Unknown' / 'NA' in user-facing text.
    // Map to readable fallback so labels feel curated, not broken.
    const friendlySector = (() => {
      const s = (m.sector || '').trim();
      if (!s || /^(other|unknown|na|n\/a|misc)$/i.test(s)) {
        const ig = (m.indexGroup || '').toLowerCase();
        return ig === 'small' ? 'smallcap basket' : ig === 'micro' ? 'microcap basket' : 'unclassified basket';
      }
      return s;
    })();
    const sharedEvidence = {
      sectorMovePct: sectorAgg?.avgChangePct,
      indexMovePct: opts.indexAvgChangePct,
      peerCountUp: peerStats?.up,
      peerCountDown: peerStats?.down,
      peerCountTotal: (peerStats?.up || 0) + (peerStats?.down || 0),
      filingChecked,
      newsChecked,
      feedGap,
    };

    // ── TIER 1a: EARNINGS HIT (HIGH confidence) ───────────────────────────
    // Most common reason for a sharp move. If this ticker reported in the
    // last 7 days, the move IS the earnings reaction — surface the tier
    // and growth profile.
    //
    // PATCH 0747 — When EARNINGS hit AND the move direction is OPPOSITE the
    // tier sentiment, this is post-results profit-taking (GPIL pattern:
    // STRONG Q4 results, then -2.5% next day on profit-booking). Phrase it
    // explicitly so the user doesn't think the engine is contradicting itself.
    //
    // PATCH 0747 — Also merge in any same-ticker special-situation event
    // (IRB pattern: Q4 PAT +38% AND 4th interim dividend declared on same
    // day). Both belong on the same row.
    const earnings = opts.earningsByTicker?.[sym];
    if (earnings && isFresh(earnings.filing_date, EARNINGS_WINDOW)) {
      const tier = earnings.tier || 'reported';
      const period = earnings.quarter || 'recent';
      const sales = earnings.sales_yoy_pct;
      const pat = earnings.net_profit_yoy_pct;
      const growthBlurb = (typeof sales === 'number' || typeof pat === 'number')
        ? ` · ${typeof sales === 'number' ? `Sales ${sales >= 0 ? '+' : ''}${sales.toFixed(0)}%` : ''}${typeof pat === 'number' ? ` · PAT ${pat >= 0 ? '+' : ''}${pat.toFixed(0)}%` : ''}`
        : '';
      // Post-results profit-taking detection: STRONG/BLOCKBUSTER + price down,
      // or AVOID/POOR + price up (relief rally). Either way the move is the
      // earnings reaction, but the framing changes.
      const tierUpper = (tier || '').toUpperCase();
      const isStrongTier = /^(BLOCKBUSTER|STRONG|MIXED)$/i.test(tierUpper);
      const isWeakTier = /^(AVOID|POOR|WEAK)$/i.test(tierUpper);
      const movingDown = m.changePercent < 0;
      const movingUp = m.changePercent > 0;
      const profitTaking = isStrongTier && movingDown;
      const reliefRally = isWeakTier && movingUp;
      // Same-day special-situation: dividend / buyback / investor meet attached
      const earningsSpecial = opts.specialByTicker?.[sym];
      let extraTag = '';
      if (earningsSpecial) {
        const evt = (earningsSpecial.event_type || '').toUpperCase();
        if (/DIVIDEND/.test(evt)) extraTag = ' + dividend';
        else if (/BUYBACK/.test(evt)) extraTag = ' + buyback';
        else if (/INVESTOR_MEET|CONFERENCE/.test(evt)) extraTag = ' + investor meet';
        else if (/OFS|STAKE_SALE/.test(evt)) extraTag = ' + OFS';
        else if (/PREFERENTIAL|QIP|RIGHTS|SAST/.test(evt)) extraTag = ' + capital action';
      }
      const framing = profitTaking
        ? `post-results profit-taking (${tier} ${period})`
        : reliefRally
        ? `relief rally (${tier} ${period} — reaction inverted)`
        : `${tier} earnings (${period})`;
      // PATCH 0795 — terse 1-line earnings detail
      const earningsDetail = (() => {
        const growthBits = [
          typeof sales === 'number' ? `Sales ${sales >= 0 ? '+' : ''}${sales.toFixed(0)}%` : null,
          typeof pat === 'number' ? `PAT ${pat >= 0 ? '+' : ''}${pat.toFixed(0)}%` : null,
        ].filter(Boolean).join(', ');
        const framing = profitTaking ? 'profit-taking after strong tier'
                      : reliefRally ? 'relief rally despite weak tier'
                      : 'earnings reaction';
        const head = growthBits ? `${growthBits}; ${framing}` : framing;
        return extraTag ? `${head}${extraTag}.` : `${head}.`;
      })();
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: `${framing}${growthBlurb}${extraTag}`,
        detail: earningsDetail,
        catalystType: 'EARNINGS',
        moveType: 'INFORMATION',
        scope: sectorScope === 'SECTOR_WIDE' ? 'SECTOR_WIDE' : 'STOCK_SPECIFIC',
        confidence: 'HIGH',
        evidenceSource: 'filing',
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 1b: SPECIAL SITUATION (HIGH confidence) ─────────────────────
    // OFS, preferential allotment, SAST stake, M&A, buyback, demerger —
    // these ARE the trigger. CENTRALBK -8% with an OFS event qualifies here.
    const ss = opts.specialByTicker?.[sym];
    if (ss) {
      const evtMap: Record<string, CatalystType> = {
        OFS: 'OFS', OPEN_OFFER: 'MNA', MERGER: 'MNA', DEMERGER: 'MNA',
        ACQUISITION: 'MNA', BUYBACK: 'BLOCK_DEAL', PREFERENTIAL: 'BLOCK_DEAL',
        SAST: 'BLOCK_DEAL', RIGHTS: 'BLOCK_DEAL', QIP: 'BLOCK_DEAL',
        STAKE_SALE: 'BLOCK_DEAL',
      };
      const evtType = (ss.event_type || '').toUpperCase();
      const cat: CatalystType = evtMap[evtType] || 'MNA';
      const ssDetail = (() => {
        const parts: string[] = [];
        if (ss.headline) parts.push(ss.headline.slice(0, 140) + '.');
        const evt = (ss.event_type || '').replace(/_/g, ' ').toLowerCase();
        if (cat === 'OFS') parts.push(`OFS supply pressure typical for D-day; absorb-vs-overhang depends on float impact.`);
        else if (cat === 'MNA') parts.push(`Corporate-action announcement — move reflects arb spread / re-rating.`);
        else if (cat === 'BLOCK_DEAL') parts.push(`Capital event (${evt}) — flow-driven, not earnings.`);
        if (sectorContext) parts.push(sectorContext + '.');
        return parts.join(' ');
      })();
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: ss.headline || `${ss.event_type.replace(/_/g, ' ')}${ss.sub_category ? ' · ' + ss.sub_category : ''}`,
        detail: ssDetail,
        catalystType: cat,
        moveType: cat === 'OFS' || cat === 'BLOCK_DEAL' ? 'FLOW' : 'INFORMATION',
        scope: 'STOCK_SPECIFIC',
        confidence: 'HIGH',
        evidenceSource: 'filing',
        evidenceUrl: ss.source_url,
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 1c: filing match from concall-intel (HIGH confidence) ────────
    const filings = (opts.filingsBySymbol[sym] || [])
      .filter(f => isFresh(f.filing_datetime, FILING_WINDOW))
      .sort((a, b) => new Date(b.filing_datetime || 0).getTime() - new Date(a.filing_datetime || 0).getTime());
    if (filings.length > 0) {
      const top = filings[0];
      const cat = classifyFilingCatalyst(top);
      const filingAgeH = top.filing_datetime
        ? Math.round((Date.now() - new Date(top.filing_datetime).getTime()) / 3600_000)
        : null;
      // PATCH 0795 — terse 1-line filing detail
      const filingDetail = (() => {
        const tag = cat.type === 'ORDER_WIN' ? 'Reg-30 order/contract'
                  : cat.type === 'RATING'    ? 'credit rating action'
                  : cat.type === 'MNA'       ? 'corporate-action filing'
                  : cat.type === 'REGULATORY'? 'regulatory disclosure'
                  : cat.type === 'OFS'       ? 'OFS supply announcement'
                  : cat.type === 'EARNINGS'  ? 'results/transcript filed'
                  : 'material exchange disclosure';
        return filingAgeH !== null ? `${tag}; filed ~${filingAgeH}h ago.` : `${tag}.`;
      })();
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: cat.label,
        detail: filingDetail,
        catalystType: cat.type,
        moveType: deriveMoveType(cat.type, m.indexGroup),
        scope: sectorScope === 'SECTOR_WIDE' ? 'SECTOR_WIDE' : 'STOCK_SPECIFIC',
        confidence: 'HIGH',
        evidenceSource: 'filing',
        evidenceUrl: top.source_url || top.attachment_urls?.[0],
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
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
      const newsConfidence: Confidence = peerCountSameDirection >= SECTOR_WIDE_MIN_PEERS ? 'MEDIUM' : 'MEDIUM';
      // PATCH 0795 — terse 1-line news detail
      const newsDetail = (() => {
        const src = (top as any).source_name || 'News';
        const typeTag = cat.type !== 'NONE' ? cat.type.replace(/_/g, ' ').toLowerCase() : 'news mention';
        const peerNote = peerCountSameDirection >= SECTOR_WIDE_MIN_PEERS
          ? ' — but peers moving same direction, may be reporting not driving'
          : '';
        return `${src} headline (${typeTag})${peerNote}.`;
      })();
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: cat.label,
        detail: newsDetail,
        catalystType: cat.type,
        moveType: deriveMoveType(cat.type, m.indexGroup),
        scope: sectorScope,
        confidence: newsConfidence,
        evidenceSource: 'news',
        evidenceUrl: top.source_url || top.url,
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 3: sector / breadth inference ────────────────────────────
    // PATCH 0795 — new taxonomy:
    //   sector_led:           sector clearly outperforms index (|delta| >= 1.5%)
    //   broad_participation:  breadth strong but sector return ~ index
    //   sector_wide_derisking: down direction with sector wide spread
    // 1-line subtitle, max ~22 words. No filler.
    if (sectorScope === 'SECTOR_WIDE') {
      const total = (peerStats?.up || 0) + (peerStats?.down || 0);
      const sectorPct = sectorAgg?.avgChangePct;
      const indexPct = opts.indexAvgChangePct;
      const delta = (sectorPct !== undefined && indexPct !== undefined) ? sectorPct - indexPct : undefined;
      const SECTOR_LED_THRESHOLD = 1.5;  // % delta vs index to qualify as 'sector-led'
      const isSectorLed = typeof delta === 'number' && Math.abs(delta) >= SECTOR_LED_THRESHOLD;
      const isUp = direction === 'up';
      let label = '';
      let subtitle = '';
      let tier3Conf: Confidence = 'LOW';
      if (isSectorLed) {
        label = `Sector-led ${isUp ? 'rally' : 'sell-off'} (${friendlySector})`;
        subtitle = `${friendlySector} ${fmtPct(sectorPct)} vs index ${fmtPct(indexPct)}; ${peerCountSameDirection}/${total} peers ${isUp ? '↑' : '↓'} >3%.`;
        tier3Conf = (filingChecked && newsChecked) ? 'MEDIUM' : 'LOW';
      } else {
        label = `Broad participation (${friendlySector})`;
        subtitle = `${peerCountSameDirection}/${total} peers ${isUp ? '↑' : '↓'} >3%; sector roughly in line with index${typeof sectorPct === 'number' ? ` (${fmtPct(sectorPct)})` : ''}.`;
        tier3Conf = (filingChecked && newsChecked && peerCountSameDirection >= 6) ? 'MEDIUM' : 'LOW';
      }
      out[sym] = {
        ticker: sym,
        changePercent: m.changePercent,
        catalyst: label,
        detail: subtitle,
        catalystType: 'SECTOR_ROTATION',
        moveType: 'MACRO',
        scope: 'SECTOR_WIDE',
        confidence: tier3Conf,
        evidenceSource: 'sector_peer',
        sectorPeerCount: peerCountSameDirection,
        sectorDirection: direction,
        evidence: sharedEvidence,
      };
      continue;
    }

    // ── TIER 4: honest "no confirmed trigger" (LOW confidence) ───────────
    // PATCH 0747 — Tighter, user-spec language. The original wording was
    // both verbose and accidentally judgmental ("likely liquidity-driven"
    // sounded pejorative when often it's just an unenriched smallcap with
    // ordinary intraday flow). User feedback:
    //   • Use explicit categories: "momentum only" vs "no confirmed trigger"
    //   • Don't duplicate industry text — home page renders the industry chip
    //     separately, so the catalyst label should focus on cause, not topic
    //   • Be honest about confidence WITHOUT inventing a story
    //
    // Industry chip on the home page already shows "Civil Construction" /
    // "Housing Finance Company" / etc, so we DON'T repeat it here.
    // ── TIER 4: no confirmed trigger ──────────────────────────────────
    // PATCH 0795 — terse 1-line subtitle. No multi-paragraph essays. No
    // 'operator-driven flow' hallucination. Module-level feed-gap banner
    // handles the disclaimer once; per-row just says 'no confirmed trigger
    // in available scans'.
    const indGroup = (m.indexGroup || '').toLowerCase();
    const smallcap = indGroup === 'small' || indGroup === 'micro';
    const isUp = direction === 'up';
    const moveLabel = isUp ? 'Momentum burst' : 'Position unwind';
    // Subtitle is ONE clean sentence with the available facts.
    const subtitleParts: string[] = [];
    if (sectorAgg && typeof opts.indexAvgChangePct === 'number') {
      const sectorPct = sectorAgg.avgChangePct;
      const idxPct = opts.indexAvgChangePct;
      // Only mention sector if it's not perfectly flat
      if (Math.abs(sectorPct) >= 0.3 || Math.abs(sectorPct - idxPct) >= 0.5) {
        subtitleParts.push(`${friendlySector} ${fmtPct(sectorPct)} vs index ${fmtPct(idxPct)}`);
      } else {
        subtitleParts.push(`${friendlySector} flat`);
      }
    }
    subtitleParts.push(feedGap
      ? `no confirmed trigger in available scans`
      : `no confirmed filing/news trigger`);
    if (smallcap) {
      subtitleParts.push(`stock-specific ${isUp ? 'momentum' : 'unwind'}`);
    }
    out[sym] = {
      ticker: sym,
      changePercent: m.changePercent,
      catalyst: moveLabel,
      detail: subtitleParts.join('; ') + '.',
      catalystType: 'NONE',
      moveType: smallcap ? 'LIQUIDITY' : 'MACRO',
      scope: 'STOCK_SPECIFIC',
      confidence: 'LOW',
      evidenceSource: 'inferred',
      sectorPeerCount: peerCountSameDirection,
      sectorDirection: direction,
      evidence: sharedEvidence,
    };
  }

  return out;
}

// PATCH 0795 — module-level feed-gap detection helper. Home page renders
// a single top-of-card banner instead of repeating the warning in every row.
export function detectFeedGap(attrib: Record<string, MoverAttribution>): { feedGap: boolean; whichFeed?: string } {
  for (const a of Object.values(attrib)) {
    if (a.evidence?.feedGap) {
      const missing: string[] = [];
      if (a.evidence.filingChecked === false) missing.push('filings');
      if (a.evidence.newsChecked === false) missing.push('news');
      return { feedGap: true, whichFeed: missing.join(' + ') || 'some' };
    }
  }
  return { feedGap: false };
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
