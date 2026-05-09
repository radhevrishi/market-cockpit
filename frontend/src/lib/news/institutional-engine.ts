// ═══════════════════════════════════════════════════════════════════════════
// INSTITUTIONAL ENGINE — patch 0049
//
// Adds the seven analytical layers requested by the user:
//   1. Signal Importance Rank   (TIER_1_ALPHA → TIER_4_NOISE)
//   2. Signal Taxonomy          (Momentum / Crowded / Structural / Cyclical
//                                / Reflexive / Consensus / Contrarian /
//                                Capacity-constrained)
//   3. Structural Confidence    (confidence %, 6M / 2Y impact, evidence)
//   4. Transmission Chain       (beneficiaries → losers → second-order)
//   5. Expectation State        (priced-in score, surprise direction,
//                                sentiment saturation)
//   6. Signal Half-Life         (TRANSIENT / CYCLICAL / STRUCTURAL / SECULAR)
//   7. Macro Regime             (liquidity / growth / inflation / credit /
//                                earnings revision)
//
// Each layer is a pure function operating on (title, desc, articleType,
// subTag, sentiment) — no global state, no DB calls. The composite output
// is attached to every article so the frontend can render the richer
// institutional surface and downstream filters can suppress noise.
// ═══════════════════════════════════════════════════════════════════════════

export type SignalImportanceRank =
  | 'TIER_1_ALPHA'      // structural alert + transmission chain → trade now
  | 'TIER_2_RELEVANT'   // confirmed signal w/ 1+ exposure
  | 'TIER_3_CONTEXT'    // background, macro, ordinary corp
  | 'TIER_4_NOISE';     // suppress from main feed

export type SignalHalfLife =
  | 'TRANSIENT'         // 1 day — price action, single-day macro
  | 'CYCLICAL'          // 1 quarter — commodity prices, demand cycles
  | 'STRUCTURAL'        // multi-year — physical bottleneck
  | 'SECULAR';          // decade+ — power grid, AI compute scaling

export type SignalTaxonomyTag =
  | 'MOMENTUM'              // price action / record high / weekly gain
  | 'CROWDED'               // consensus long, short interest, FOMO
  | 'STRUCTURAL'            // physical / capacity constraint, secular trend
  | 'CYCLICAL'              // oil / commodity / demand fluctuation
  | 'REFLEXIVE'             // squeeze / narrative-driven / feedback loop
  | 'CONSENSUS'             // in-line / no surprise
  | 'CONTRARIAN'            // opposite of street
  | 'CAPACITY_CONSTRAINED'; // explicit capacity-constraint language

export type RegimeState = 'EXPANDING' | 'NEUTRAL' | 'CONTRACTING';

export interface MacroRegime {
  liquidity: RegimeState;
  growth: RegimeState;
  inflation: RegimeState;
  credit: RegimeState;
  earnings_revision: RegimeState;
}

export interface TransmissionChain {
  beneficiaries: string[];   // direct upside tickers
  losers: string[];          // direct downside tickers
  second_order: string[];    // downstream pricing power, margin, capex timing
  causal_path: string;       // human-readable: "CoWoS shortage → packaging → GPU OEMs"
}

export interface ExpectationState {
  priced_in_score: number;          // 0-100, 0 = total surprise, 100 = fully priced
  surprise_direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  sentiment_saturation: number;     // 0-100, how much narrative crowding
}

export interface StructuralConfidence {
  confidence_pct: number;                                    // 0-100
  horizon_6m_impact: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  horizon_2y_impact: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  evidence_strength: 'WEAK' | 'MODERATE' | 'STRONG';
  commercialization_stage: 'RESEARCH' | 'PILOT' | 'EARLY_DEPLOY' | 'SCALED' | 'MATURE';
}

export interface InstitutionalEnvelope {
  importance_rank: SignalImportanceRank;
  half_life: SignalHalfLife;
  taxonomy: SignalTaxonomyTag[];
  transmission: TransmissionChain;
  expectation: ExpectationState;
  structural_confidence?: StructuralConfidence;   // BOTTLENECK only
  macro_regime?: MacroRegime;                     // MACRO only
}

// ── Signal Importance Rank ─────────────────────────────────────────────────
//
// TIER_1_ALPHA — actionable now. Pre-conditions:
//   • article is BOTTLENECK with sub_tag AND named transmission chain
//   • OR EARNINGS with surprise > 5% AND major ticker
//   • OR RATING_CHANGE on major ticker
//   • OR MACRO with regime shift signal
//   • OR synthetic structural alert with CRITICAL status
//
// TIER_2_RELEVANT — confirmed background signal, watch.
// TIER_3_CONTEXT  — generic earnings, ordinary corporate, low surprise.
// TIER_4_NOISE    — suppress from main feed.

const MAJOR_TICKERS = new Set([
  // US AI / semis
  'NVDA','AAPL','GOOGL','GOOG','MSFT','AMZN','META','TSLA','TSM','ASML','AVGO','AMD','MU','INTC',
  // US energy / power
  'XOM','CVX','GEV','VST','CEG','NEE',
  // India structural
  'HAL','BEL','BDL','BHEL','NTPC','POWERGRID','COALINDIA','RELIANCE','LT','TATAMOTORS','TATASTEEL','JSWSTEEL','MARUTI','MAZAGON','BEML','GRSE',
  // India banking
  'SBIN','HDFCBANK','ICICIBANK','AXISBANK','KOTAKBANK','BAJFINANCE','BAJAJFINSV','BANKBARODA','PNB',
  // India IT / consumer
  'TCS','INFY','WIPRO','HCLTECH','ITC','HINDUNILVR','ASIANPAINT','TITAN','BHARTIARTL','ULTRACEMCO',
  // India structural EMS
  'KAYNES','SYRMA','DIXON','POLYMATECH',
]);

export function computeSignalImportance(args: {
  article_type: string;
  bottleneck_sub_tag?: string | null;
  bottleneck_level?: string | null;
  consequence_score: number;
  is_synthetic?: boolean;
  structural_status?: string;
  specific_impact?: { magnitudePct?: number; label?: string };
  exposure_beneficiaries: string[];
  exposure_at_risk: string[];
  tickers: string[];
  source_tier: string;
  feed_name: string;
  title: string;
}): SignalImportanceRank {
  const { article_type, bottleneck_sub_tag, bottleneck_level, consequence_score,
          is_synthetic, structural_status, specific_impact, exposure_beneficiaries,
          exposure_at_risk, tickers, source_tier, title } = args;
  const titleU = (title || '').toUpperCase();
  const hasMajorTicker = tickers.some(t => MAJOR_TICKERS.has(t.toUpperCase())) ||
    Array.from(MAJOR_TICKERS).some(t => titleU.includes(t));
  const hasTransmission = (exposure_beneficiaries.length + exposure_at_risk.length) > 0;
  const hasSurprise = specific_impact?.magnitudePct !== undefined && specific_impact.magnitudePct >= 5;

  // TIER_1_ALPHA
  if (is_synthetic && (structural_status === 'CRITICAL' || structural_status === 'ELEVATED')) return 'TIER_1_ALPHA';
  if (article_type === 'BOTTLENECK' && bottleneck_level === 'CRITICAL_BOTTLENECK' && hasTransmission) return 'TIER_1_ALPHA';
  if (article_type === 'BOTTLENECK' && bottleneck_sub_tag && hasTransmission && consequence_score >= 60) return 'TIER_1_ALPHA';
  if (article_type === 'EARNINGS' && hasSurprise && hasMajorTicker && consequence_score >= 50) return 'TIER_1_ALPHA';
  if (article_type === 'RATING_CHANGE' && hasMajorTicker && consequence_score >= 40) return 'TIER_1_ALPHA';

  // TIER_2_RELEVANT
  if (article_type === 'BOTTLENECK' && bottleneck_sub_tag) return 'TIER_2_RELEVANT';
  if (article_type === 'EARNINGS' && hasSurprise) return 'TIER_2_RELEVANT';
  if (article_type === 'EARNINGS' && hasMajorTicker) return 'TIER_2_RELEVANT';
  if (article_type === 'TARIFF') return 'TIER_2_RELEVANT';
  if (article_type === 'GEOPOLITICAL' && consequence_score >= 50) return 'TIER_2_RELEVANT';
  if (article_type === 'MACRO' && consequence_score >= 50) return 'TIER_2_RELEVANT';
  if (article_type === 'RATING_CHANGE') return 'TIER_2_RELEVANT';

  // TIER_4_NOISE — repetitive quarterly delta on small caps with no surprise
  const isGenericEarnings = article_type === 'EARNINGS' && !hasSurprise && !hasMajorTicker && consequence_score < 35;
  const isGenericQuarterlyDelta = /\bnet profit (rises|falls|jumps|declines)\b.{0,30}\b\d+\.\d+%\b/i.test(title) && !hasMajorTicker;
  const isWeekendVideoOrLifestyle = /\b(this weekend|costume|cruise|hantavirus|marathon|premiere|movie review|box office)\b/i.test(title);
  const isStorageProductBlurb = /\b(storage news ticker|storage being used|backup|saas)\b/i.test(title) && source_tier !== 'primary';
  if (isGenericEarnings || isGenericQuarterlyDelta || isWeekendVideoOrLifestyle || isStorageProductBlurb) return 'TIER_4_NOISE';

  // Default: TIER_3_CONTEXT
  return 'TIER_3_CONTEXT';
}

// ── Signal Half-Life ───────────────────────────────────────────────────────

export function computeSignalHalfLife(args: {
  article_type: string;
  bottleneck_sub_tag?: string | null;
  title: string;
  desc: string;
}): SignalHalfLife {
  const { article_type, bottleneck_sub_tag, title, desc } = args;
  const text = (title + ' ' + desc).toLowerCase();

  // SECULAR — multi-decade structural shifts
  if (/(power grid|electricity grid|grid (capacity|infrastructure)|ai compute scaling|data center buildout|secular|generational|decade.long|multi.?decade)/i.test(text)) {
    return 'SECULAR';
  }
  if (bottleneck_sub_tag === 'POWER_GRID' || bottleneck_sub_tag === 'NUCLEAR_ENERGY') return 'SECULAR';

  // STRUCTURAL — multi-year physical bottlenecks
  if (article_type === 'BOTTLENECK') return 'STRUCTURAL';
  if (/(structural|multi.?year|long.?cycle|long.?term|capacity constraint|capacity (?:expansion|addition).{0,15}years|fab construction)/i.test(text)) {
    return 'STRUCTURAL';
  }

  // CYCLICAL — quarterly / annual rhythm
  if (/(crude oil|brent|wti|opec|commodity|copper|aluminum|steel|cement|monsoon|inventory|cycle|seasonal|q[1-4]\b)/i.test(text)) {
    return 'CYCLICAL';
  }
  if (article_type === 'TARIFF' || article_type === 'MACRO') return 'CYCLICAL';

  // TRANSIENT default — single-day price action, intraday moves
  return 'TRANSIENT';
}

// ── Signal Taxonomy ────────────────────────────────────────────────────────

export function classifySignalTaxonomy(args: {
  article_type: string;
  bottleneck_level?: string | null;
  title: string;
  desc: string;
  specific_impact?: { magnitudePct?: number };
}): SignalTaxonomyTag[] {
  const { article_type, bottleneck_level, title, desc, specific_impact } = args;
  const text = (title + ' ' + desc).toLowerCase();
  const tags: SignalTaxonomyTag[] = [];

  // CAPACITY_CONSTRAINED — explicit capacity / supply tight
  if (/(capacity (constraint|tight|hit zero|sold out|allocation)|supply (constraint|crunch|squeeze|gap)|sold out|fully allocated|lead time \d+|shortage|undersupply)/i.test(text)) {
    tags.push('CAPACITY_CONSTRAINED');
  }

  // STRUCTURAL — physical bottleneck or secular trend
  if (article_type === 'BOTTLENECK' || /(structural|secular|multi.?year|long.?cycle|generational)/i.test(text)) {
    tags.push('STRUCTURAL');
  }

  // CYCLICAL — commodity / demand cycle / quarterly rhythm
  if (/(commodity|cycle|seasonal|monsoon|crude|opec|inventory|demand cycle|order cycle)/i.test(text)) {
    tags.push('CYCLICAL');
  }

  // MOMENTUM — price action, record high, weekly gain
  if (/(record (high|low|gain)|hits (?:fresh )?(?:record|all.?time)|weekly gain|surge|rally|jump|soar|skyrocket|tank|plunge|crash|drop \d+%|rises \d+%|falls \d+%|gain \d+%|loses \d+%|stock (rises|falls|jumps|drops|surges|gains|loses|tanks|plunges))/i.test(text)) {
    tags.push('MOMENTUM');
  }

  // CROWDED — short interest, consensus long, FOMO
  if (/(crowded|consensus long|long-only|short interest|short squeeze|fomo|everyone owns|most owned|herding|positioning)/i.test(text)) {
    tags.push('CROWDED');
  }

  // REFLEXIVE — narrative-driven feedback loop
  if (/(narrative|squeeze|short squeeze|gamma squeeze|meme|reddit|wallstreetbets|reflexiv|self.?fulfill|momentum chasing|buy the dip|fomo)/i.test(text)) {
    tags.push('REFLEXIVE');
  }

  // CONSENSUS — in-line, no surprise
  if (/(in.?line|as expected|no surprise|matched (?:expectations?|consensus)|expected|priced.in)/i.test(text)) {
    tags.push('CONSENSUS');
  }

  // CONTRARIAN — opposite of street
  if (/(contrarian|against consensus|opposite of street|out of consensus|untouched by analysts|unloved|under.?owned|forgotten|bombed.out|left for dead)/i.test(text)) {
    tags.push('CONTRARIAN');
  }

  // For BOTTLENECK without explicit constraint language, still tag STRUCTURAL
  if (article_type === 'BOTTLENECK' && !tags.includes('STRUCTURAL')) {
    tags.push('STRUCTURAL');
  }
  if (bottleneck_level === 'CRITICAL_BOTTLENECK' && !tags.includes('CAPACITY_CONSTRAINED')) {
    tags.push('CAPACITY_CONSTRAINED');
  }

  return Array.from(new Set(tags));
}

// ── Structural Confidence ──────────────────────────────────────────────────

export function computeStructuralConfidence(args: {
  bottleneck_sub_tag?: string | null;
  title: string;
  desc: string;
  consequence_score: number;
  source_tier: string;
}): StructuralConfidence {
  const { bottleneck_sub_tag, title, desc, source_tier } = args;
  const text = (title + ' ' + desc).toLowerCase();

  // Established bottlenecks with strong evidence
  const isEstablished = /(hbm|cowos|advanced packaging|euv|wafer fab capacity|power grid|nuclear|fast breeder|rare earth)/i.test(text);
  // Emerging signals with traction
  const isEmerging = /(silicon photonics|co.?packaged optics|solid state battery|green hydrogen|small modular reactor|smr|3d dram|chiplet)/i.test(text);
  // Early / pilot stage
  const isPilot = /(prototype|pilot|proof of concept|poc|pre.?commercial|research|laboratory|demo)/i.test(text);
  // Mature commercial
  const isMature = /(mature|commodity|standard|widely deployed|incumbent|legacy)/i.test(text);

  let confidence = 50;
  let stage: StructuralConfidence['commercialization_stage'] = 'EARLY_DEPLOY';
  let evidence: StructuralConfidence['evidence_strength'] = 'MODERATE';
  let h6: StructuralConfidence['horizon_6m_impact'] = 'MEDIUM';
  let h2: StructuralConfidence['horizon_2y_impact'] = 'MEDIUM';

  if (isEstablished) {
    confidence = 80;
    stage = 'SCALED';
    evidence = 'STRONG';
    h6 = 'HIGH';
    h2 = 'HIGH';
  } else if (isEmerging) {
    confidence = 60;
    stage = 'EARLY_DEPLOY';
    evidence = 'MODERATE';
    h6 = 'LOW';
    h2 = 'HIGH';
  } else if (isPilot) {
    confidence = 35;
    stage = 'PILOT';
    evidence = 'WEAK';
    h6 = 'NONE';
    h2 = 'MEDIUM';
  } else if (isMature) {
    confidence = 70;
    stage = 'MATURE';
    evidence = 'STRONG';
    h6 = 'MEDIUM';
    h2 = 'LOW';   // mature = limited upside
  }

  // Sub-tag adjustments
  if (bottleneck_sub_tag === 'MEMORY_STORAGE' || bottleneck_sub_tag === 'FABRICATION_PACKAGING') {
    confidence = Math.max(confidence, 75);
    h6 = 'HIGH'; h2 = 'HIGH';
  }
  if (bottleneck_sub_tag === 'POWER_GRID' || bottleneck_sub_tag === 'NUCLEAR_ENERGY') {
    confidence = Math.max(confidence, 70);
    h6 = 'MEDIUM'; h2 = 'HIGH';
  }
  if (bottleneck_sub_tag === 'INTERCONNECT_PHOTONICS') {
    confidence = Math.min(confidence, 65);   // still emerging
    h6 = 'LOW'; h2 = 'HIGH';
  }
  if (bottleneck_sub_tag === 'QUANTUM_CRYOGENICS') {
    confidence = Math.min(confidence, 35);
    stage = 'PILOT';
    h6 = 'NONE'; h2 = 'MEDIUM';
  }

  // Tier adjustment — primary sources upgrade evidence
  if (source_tier === 'primary') confidence = Math.min(95, confidence + 5);
  if (source_tier === 'retail') confidence = Math.max(20, confidence - 10);

  return {
    confidence_pct: Math.round(confidence),
    horizon_6m_impact: h6,
    horizon_2y_impact: h2,
    evidence_strength: evidence,
    commercialization_stage: stage,
  };
}

// ── Transmission Chain ─────────────────────────────────────────────────────
// Extends the existing EXPOSURE_MAP with second-order effects + causal path.

const SECOND_ORDER_MAP: Record<string, { second_order: string[]; causal_path: string }> = {
  FABRICATION_PACKAGING: {
    second_order: ['Pricing power up for TSMC', 'AVGO/NVDA margin pressure', 'Cloud capex timing risk'],
    causal_path: 'CoWoS / advanced packaging tight → AI accelerator supply constrained → Cloud build delayed',
  },
  MEMORY_STORAGE: {
    second_order: ['HBM ASP rising', 'Server BOM cost up', 'AI margin compression at hyperscalers'],
    causal_path: 'HBM supply tight → memory ASP rising → hyperscaler AI margin compression',
  },
  INTERCONNECT_PHOTONICS: {
    second_order: ['CPO transition accelerating', 'Copper interconnect saturating', 'Optical I/O TAM expanding'],
    causal_path: 'Bandwidth wall → silicon photonics adoption → optical-component TAM expansion',
  },
  POWER_GRID: {
    second_order: ['Data center build delays', 'Hyperscaler capex shifts to power-rich regions', 'Transformer ASP up'],
    causal_path: 'Grid capacity lag → DC build pause → transformer / GE Vernova / BHEL beneficiary',
  },
  NUCLEAR_ENERGY: {
    second_order: ['SMR / nuclear renaissance valuation rerate', 'Uranium price floor rising', 'Utility duration short'],
    causal_path: 'AI baseload demand → SMR + nuclear order book builds → uranium / Cameco / BHEL',
  },
  COMPUTE_SCALING: {
    second_order: ['GPU/accelerator margin firms', 'Custom-silicon program launches', 'Cloud capex ramp'],
    causal_path: 'AI training demand → accelerator allocation tight → custom silicon programs accelerate',
  },
  THERMAL_COOLING: {
    second_order: ['Liquid cooling ASP up', 'Direct-to-chip CDU TAM', 'Free-cooling DC retrofit'],
    causal_path: 'AI rack power density rising → liquid cooling mandatory → CDU / immersion adoption',
  },
  MATERIALS_SUPPLY: {
    second_order: ['Vertical integration moves', 'Strategic stockpile builds', 'Western miner rerate'],
    causal_path: 'Critical mineral concentration risk → reshoring / strategic reserves / mine rerate',
  },
};

export function computeTransmissionChain(args: {
  bottleneck_sub_tag?: string | null;
  exposure_beneficiaries: string[];
  exposure_at_risk: string[];
  title: string;
  desc: string;
}): TransmissionChain {
  const { bottleneck_sub_tag, exposure_beneficiaries, exposure_at_risk, title, desc } = args;
  const subTag = bottleneck_sub_tag || '';
  const second = SECOND_ORDER_MAP[subTag];
  const text = (title + ' ' + desc).toLowerCase();

  let second_order: string[] = second?.second_order ?? [];
  let causal_path: string = second?.causal_path ?? '';

  // Inferred second-order effects when no sub-tag mapping fits
  if (!second_order.length) {
    if (/tariff|trade war|export ban/.test(text)) {
      second_order = ['Currency volatility', 'Inventory front-loading', 'Local content rule pressure'];
      causal_path = 'Tariff/export ban → supply rerouting → local content premium';
    } else if (/oil|crude|brent|opec/.test(text)) {
      second_order = ['Refining margin shift', 'Aviation / petchem cost up', 'Currency pressure for importers'];
      causal_path = 'Crude price → refining / petchem cost → margin pass-through risk';
    } else if (/rate cut|rate hike|fed|rbi.*policy/.test(text)) {
      second_order = ['Duration trade rerates', 'Bank NIM compression / expansion', 'Rate-sensitive sector rotation'];
      causal_path = 'Rate decision → curve repricing → sector rotation';
    }
  }

  return {
    beneficiaries: exposure_beneficiaries,
    losers: exposure_at_risk,
    second_order,
    causal_path,
  };
}

// ── Expectation State ──────────────────────────────────────────────────────

export function assessExpectationState(args: {
  title: string;
  desc: string;
  specific_impact?: { magnitudePct?: number; direction?: string };
  consequence_score: number;
}): ExpectationState {
  const { title, desc, specific_impact, consequence_score } = args;
  const text = (title + ' ' + desc).toLowerCase();

  // Priced-in detection
  let priced_in = 50;
  if (/(in.?line|as expected|no surprise|matched (?:consensus|expectations?)|expected|priced.in|widely anticipated|already discounted)/i.test(text)) {
    priced_in = 85;
  }
  if (/(unprecedented|never before|first.?time|exceeds expectations significantly|wide margin|caught off guard|surprise (?:beat|miss))/i.test(text)) {
    priced_in = 15;
  }
  if (specific_impact?.magnitudePct !== undefined) {
    // Big surprise = low priced-in
    if (specific_impact.magnitudePct >= 20) priced_in = Math.min(priced_in, 20);
    else if (specific_impact.magnitudePct >= 10) priced_in = Math.min(priced_in, 35);
    else if (specific_impact.magnitudePct >= 5) priced_in = Math.min(priced_in, 50);
  }

  // Surprise direction
  let direction: ExpectationState['surprise_direction'] = 'NEUTRAL';
  if (specific_impact?.direction === 'beat' || specific_impact?.direction === 'rise') direction = 'POSITIVE';
  if (specific_impact?.direction === 'miss' || specific_impact?.direction === 'fall') direction = 'NEGATIVE';
  if (direction === 'NEUTRAL' && /(beat|exceed|outperform|surprise.*higher|surge|jump)/i.test(text)) direction = 'POSITIVE';
  if (direction === 'NEUTRAL' && /(miss|fall short|underperform|disappoint|tank|plunge|crash)/i.test(text)) direction = 'NEGATIVE';

  // Sentiment saturation — high if many narrative words clustered
  const narrativeWords = (text.match(/\b(boom|frenzy|mania|surge|rally|crash|panic|euphoria|fomo|rotation|melt.?up|melt.?down|bubble)\b/gi) || []).length;
  const saturation = Math.min(100, narrativeWords * 25 + (consequence_score >= 60 ? 20 : 0));

  return {
    priced_in_score: Math.round(priced_in),
    surprise_direction: direction,
    sentiment_saturation: Math.round(saturation),
  };
}

// ── Macro Regime Decomposition ─────────────────────────────────────────────

export function decomposeMacroRegime(args: { title: string; desc: string }): MacroRegime {
  const { title, desc } = args;
  const text = (title + ' ' + desc).toLowerCase();

  const liq = /(rate cut|qe|liquidity injection|repo cut|easing|dovish|balance sheet expand)/i.test(text)
    ? 'EXPANDING'
    : /(rate hike|qt|liquidity drain|repo hike|tightening|hawkish|balance sheet shrink)/i.test(text)
      ? 'CONTRACTING'
      : 'NEUTRAL';

  const growth = /(gdp.{0,10}beat|strong growth|expansion|robust demand|capex up|jobs added|employment up|payroll growth)/i.test(text)
    ? 'EXPANDING'
    : /(recession|contraction|slowdown|growth scare|jobs lost|payroll decline|gdp.{0,10}miss)/i.test(text)
      ? 'CONTRACTING'
      : 'NEUTRAL';

  const inflation = /(inflation.{0,10}(rising|hot|sticky|persistent|spike)|cpi.{0,10}(beat|hot|surge)|wage spiral|price pressure)/i.test(text)
    ? 'EXPANDING'
    : /(inflation.{0,10}(easing|cool|moderate|fall)|cpi.{0,10}(cool|miss|moderate)|disinflation|deflation)/i.test(text)
      ? 'CONTRACTING'
      : 'NEUTRAL';

  const credit = /(credit (?:expansion|growth|loosening)|spread tighten|loan demand up|underwriting expand)/i.test(text)
    ? 'EXPANDING'
    : /(credit (?:crunch|squeeze|tighten|stress)|spread widen|default rate up|npa rising|gnpa up|delinquency)/i.test(text)
      ? 'CONTRACTING'
      : 'NEUTRAL';

  const earningsRev = /(earnings (?:beat|raise|upgrade)|guidance raised|estimate revision up|positive revision|target raised)/i.test(text)
    ? 'EXPANDING'
    : /(earnings (?:miss|cut|downgrade)|guidance (?:cut|lowered)|estimate revision down|negative revision|target cut)/i.test(text)
      ? 'CONTRACTING'
      : 'NEUTRAL';

  return {
    liquidity: liq as RegimeState,
    growth: growth as RegimeState,
    inflation: inflation as RegimeState,
    credit: credit as RegimeState,
    earnings_revision: earningsRev as RegimeState,
  };
}

// ── Composite envelope builder ─────────────────────────────────────────────

export function buildInstitutionalEnvelope(article: {
  article_type: string;
  bottleneck_sub_tag?: string | null;
  bottleneck_level?: string | null;
  consequence_score: number;
  is_synthetic?: boolean;
  structural_status?: string;
  specific_impact?: { magnitudePct?: number; direction?: string; label?: string };
  exposure_beneficiaries: string[];
  exposure_at_risk: string[];
  tickers: string[];
  source_tier: string;
  feed_name: string;
  title: string;
  desc: string;
}): InstitutionalEnvelope {
  const importance_rank = computeSignalImportance(article);
  const half_life = computeSignalHalfLife({
    article_type: article.article_type,
    bottleneck_sub_tag: article.bottleneck_sub_tag,
    title: article.title,
    desc: article.desc,
  });
  const taxonomy = classifySignalTaxonomy({
    article_type: article.article_type,
    bottleneck_level: article.bottleneck_level,
    title: article.title,
    desc: article.desc,
    specific_impact: article.specific_impact,
  });
  const transmission = computeTransmissionChain({
    bottleneck_sub_tag: article.bottleneck_sub_tag,
    exposure_beneficiaries: article.exposure_beneficiaries,
    exposure_at_risk: article.exposure_at_risk,
    title: article.title,
    desc: article.desc,
  });
  const expectation = assessExpectationState({
    title: article.title,
    desc: article.desc,
    specific_impact: article.specific_impact,
    consequence_score: article.consequence_score,
  });

  const envelope: InstitutionalEnvelope = {
    importance_rank,
    half_life,
    taxonomy,
    transmission,
    expectation,
  };

  if (article.article_type === 'BOTTLENECK') {
    envelope.structural_confidence = computeStructuralConfidence({
      bottleneck_sub_tag: article.bottleneck_sub_tag,
      title: article.title,
      desc: article.desc,
      consequence_score: article.consequence_score,
      source_tier: article.source_tier,
    });
  }
  if (article.article_type === 'MACRO') {
    envelope.macro_regime = decomposeMacroRegime({
      title: article.title,
      desc: article.desc,
    });
  }

  return envelope;
}
