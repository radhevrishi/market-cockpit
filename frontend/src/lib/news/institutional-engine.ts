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

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0050 — INTELLIGENCE LAYER
//
// Adds the seven "PM-grade" upgrades the user requested:
//   1. Earnings inclusion gate (thesis-changing / structural / revisions only)
//   2. Institutional impact labels (replace generic "Structural supply-chain signal")
//   3. Anomaly explanation (what deviated, from what baseline, why)
//   4. Why-This-Matters PM summary line
//   5. Consensus vs Variant view block
//   6. Signal decay logic (half-life × age → effective importance)
//   7. Multi-hop causal chain mapping
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Earnings inclusion gate ─────────────────────────────────────────────

export function shouldKeepEarnings(args: {
  title: string;
  desc: string;
  specific_impact?: { magnitudePct?: number };
  tickers: string[];
  consequence_score: number;
}): boolean {
  const { title, desc, specific_impact, tickers, consequence_score } = args;
  const text = (title + ' ' + desc).toLowerCase();
  const titleU = title.toUpperCase();
  const hasMajorTicker = tickers.some(t => MAJOR_TICKERS.has(t.toUpperCase())) ||
    Array.from(MAJOR_TICKERS).some(t => titleU.includes(t));
  const hasMaterialSurprise = (specific_impact?.magnitudePct ?? 0) >= 5;
  // Estimate revision language
  const hasRevision = /\b(guidance (raise|raised|raises|lower|cut|reduced|withdrawn)|estimate (revis|raise|cut)|target (raise|cut|lift)|consensus revis|outlook (raise|cut|lower)|forecast (raise|cut))\b/i.test(text);
  // Thesis-changing AI / monetization / margin durability language
  const hasThesisShift = /\b(ai (acceleration|spending|capex|monetization|inflection)|enterprise ai|inference demand|software monetization|margin (durability|sustainability|expansion)|operating leverage|pricing power|cannibaliz|labor model disruption|workforce (reduc|cut|layoff).{0,20}ai|ai.{0,20}(layoff|cut|automat))\b/i.test(text);
  // Structural confirmation — earnings note matches active bottleneck theme
  const hasStructuralAnchor = /\b(hbm|cowos|advanced packaging|euv|wafer|fab|memory pricing|allocation|lead time|capacity (?:constraint|tight|sold out|hit zero)|backlog|order book|book.?to.?bill)\b/i.test(text);
  // Capex / capacity announcements
  const hasCapex = /\b(capex (raise|increase|step.up|guide|guidance)|capacity (expansion|addition)|new fab|fab construction|gigafactory|production ramp)\b/i.test(text);

  // Keep if at least one institutional anchor is present
  if (hasMaterialSurprise && hasMajorTicker) return true;
  if (hasRevision) return true;
  if (hasThesisShift) return true;
  if (hasStructuralAnchor) return true;
  if (hasCapex) return true;
  if (hasMajorTicker && consequence_score >= 50) return true;
  return false;
}

// ── 2. Institutional impact labels ─────────────────────────────────────────

const INSTITUTIONAL_IMPACT_LABELS: Record<string, Record<string, string>> = {
  COMPUTE_CONSTRAINT: {
    EMERGING:   'Compute capacity gap forming — early HBM / packaging tightness',
    PERSISTENT: 'GPU deployment bottleneck shifting upstream — packaging-bound',
    EASING:     'Compute capacity easing — wafer / packaging ramp catching up',
    RESOLVED:   'Compute supply normalising — pricing power fading',
    DEFAULT:    'AI infra capex acceleration — accelerator allocation tight',
  },
  POWER_CONSTRAINT: {
    EMERGING:   'Grid stress emerging — early signs of DC build queueing',
    PERSISTENT: 'Power availability constraining hyperscaler buildouts',
    EASING:     'Transformer / grid capacity ramping — DC backlog working through',
    RESOLVED:   'Power adequacy restored — DC build pace normalising',
    DEFAULT:    'Power / grid capacity inflection — utility & power-equipment beneficiary',
  },
  DEFENSE_SUPPLY: {
    EMERGING:   'Defence order book inflecting — early procurement cycle',
    PERSISTENT: 'Defence procurement cycle accelerating — order-book visibility extends',
    EASING:     'Defence delivery cadence improving — backlog conversion rising',
    RESOLVED:   'Defence cycle peak — book-to-bill normalising',
    DEFAULT:    'Defence capex cycle — HAL / BEL / BDL beneficiary',
  },
  MATERIAL_SCARCITY: {
    EMERGING:   'Critical mineral price floor lifting — early reshoring signal',
    PERSISTENT: 'Critical mineral concentration risk — strategic stockpile building',
    EASING:     'Material supply rebalancing — Western miner rerate underway',
    RESOLVED:   'Material adequacy restored — pricing pressure fading',
    DEFAULT:    'Material scarcity risk — vertical integration accelerating',
  },
  LOGISTICS_CONSTRAINT: {
    EMERGING:   'Logistics chokepoint forming — early freight rate signal',
    PERSISTENT: 'Logistics constraint binding — supply rerouting active',
    EASING:     'Logistics flow restoring — freight rate normalising',
    RESOLVED:   'Logistics normalisation — supply chain repriced',
    DEFAULT:    'Logistics chokepoint — freight & inventory cost up',
  },
  ENERGY_CONSTRAINT: {
    EMERGING:   'Energy supply tightening — early refining / pipeline stress',
    PERSISTENT: 'Energy supply binding — refining / pipeline throughput stretched',
    EASING:     'Energy supply rebalancing — capacity coming online',
    RESOLVED:   'Energy adequacy restored — pricing stabilising',
    DEFAULT:    'Energy supply dynamics shifting — refiner / OMC margin watch',
  },
  FINANCIAL_INFRA: {
    PERSISTENT: 'Financial infra event — RBI / SEBI policy transmission',
    DEFAULT:    'Financial infra signal — regulatory / liquidity transmission',
  },
};

const SUBTAG_INSTITUTIONAL_LABELS: Record<string, string> = {
  MEMORY_STORAGE:         'HBM pricing power strengthening — DRAM cycle extending',
  FABRICATION_PACKAGING:  'CoWoS / advanced packaging tight — GPU build packaging-bound',
  INTERCONNECT_PHOTONICS: 'Silicon photonics transition — electrical interconnect saturating',
  COMPUTE_SCALING:        'Enterprise AI inference demand accelerating',
  POWER_GRID:             'Power availability constraining hyperscaler buildouts',
  NUCLEAR_ENERGY:         'Nuclear renaissance — AI baseload demand rerating utility duration',
  THERMAL_COOLING:        'Liquid cooling adoption — DC rack power density rising',
  MATERIALS_SUPPLY:       'Critical mineral concentration risk — reshoring premium',
  QUANTUM_CRYOGENICS:     'Quantum infra emerging — pre-commercial signal',
};

export function generateInstitutionalImpactLabel(args: {
  bottleneck_sub_tag?: string | null;
  bottleneck_category?: string;
  bottleneck_resolution?: string | null;
  article_type: string;
}): string {
  const { bottleneck_sub_tag, bottleneck_category, bottleneck_resolution, article_type } = args;
  if (article_type !== 'BOTTLENECK') return '';
  // Prefer sub-tag specific label
  if (bottleneck_sub_tag && SUBTAG_INSTITUTIONAL_LABELS[bottleneck_sub_tag]) {
    return SUBTAG_INSTITUTIONAL_LABELS[bottleneck_sub_tag];
  }
  // Fall back to category × resolution-state matrix
  if (bottleneck_category && INSTITUTIONAL_IMPACT_LABELS[bottleneck_category]) {
    const map = INSTITUTIONAL_IMPACT_LABELS[bottleneck_category];
    const state = bottleneck_resolution || 'DEFAULT';
    return map[state] || map.DEFAULT || '';
  }
  return '';
}

// ── 4. Why-This-Matters PM summary line ────────────────────────────────────
// Generates a 1-line portfolio-manager summary explaining the investment
// implication. Keyed off sub-tag + half-life + resolution state.

const WHY_THIS_MATTERS_TEMPLATES: Record<string, string> = {
  MEMORY_STORAGE:         'AI training / inference demand is outpacing memory wafer supply; DRAM/HBM ASP power can extend the memory cycle through 2027 even if other semis cool.',
  FABRICATION_PACKAGING:  'GPU shipment growth may remain packaging-constrained through 2027 despite wafer expansion. Cloud capex timing risk shifts from chips to substrates.',
  INTERCONNECT_PHOTONICS: 'Electrical interconnect scaling limits are forcing optical migration in AI clusters. Optical-component TAM expansion is multi-year.',
  COMPUTE_SCALING:        'Accelerator allocation tightness signals enterprise AI inference demand is sticky, not speculative. Custom-silicon programs accelerate.',
  POWER_GRID:             'Grid lag means DC build pace shifts to power-rich regions; transformer / GE Vernova / BHEL beneficiary; hyperscaler capex re-shapes.',
  NUCLEAR_ENERGY:         'AI baseload demand is rerating nuclear order books and uranium price floors. Utility duration is shortening as new builds get committed.',
  THERMAL_COOLING:        'Rack power density past air-cooling envelope. Liquid-cooling / CDU adoption becomes mandatory; immersion TAM expands.',
  MATERIALS_SUPPLY:       'Critical-mineral concentration risk is forcing strategic stockpiles and reshoring. Western miner rerating underway; vertical-integration moves accelerate.',
  QUANTUM_CRYOGENICS:     'Pre-commercial signal — multi-year horizon. Watch milestone-driven inflection but no near-term P&L impact.',
};

const CATEGORY_WHY_TEMPLATES: Record<string, string> = {
  COMPUTE_CONSTRAINT:   'Constraint sits in the AI capex transmission chain — pricing power, lead times, and accelerator allocation drive 2026-27 earnings dispersion.',
  POWER_CONSTRAINT:     'Power adequacy is the binding constraint after compute. DC build pace, utility capex, and grid-equipment ASP all rerate.',
  DEFENSE_SUPPLY:       'Defence capex cycle visibility is multi-year — order book conversion + export wins drive earnings durability for HAL/BEL/BDL.',
  MATERIAL_SCARCITY:    'Concentration risk forces strategic supply moves — pricing power for upstream miners / processors, cost pressure downstream.',
  LOGISTICS_CONSTRAINT: 'Freight chokepoint feeds into inventory, working capital, and pricing pass-through across consumer / industrial supply chains.',
  ENERGY_CONSTRAINT:    'Energy supply tightness flows to refining / OMC margin, fiscal subsidy bill, and rate-sensitive sector rotation.',
  FINANCIAL_INFRA:      'Regulatory / liquidity transmission — RBI / SEBI policy moves repricing curve, NIM, and credit cycle.',
};

export function generateWhyThisMatters(args: {
  article_type: string;
  bottleneck_sub_tag?: string | null;
  bottleneck_category?: string;
  bottleneck_resolution?: string | null;
  half_life: SignalHalfLife;
  importance_rank: SignalImportanceRank;
  expectation: ExpectationState;
}): string | null {
  const { article_type, bottleneck_sub_tag, bottleneck_category, half_life,
          importance_rank, expectation } = args;
  // Only emit for HIGH-signal articles
  if (importance_rank !== 'TIER_1_ALPHA' && importance_rank !== 'TIER_2_RELEVANT') return null;

  let base: string | null = null;
  if (article_type === 'BOTTLENECK') {
    base = (bottleneck_sub_tag && WHY_THIS_MATTERS_TEMPLATES[bottleneck_sub_tag]) ||
           (bottleneck_category && CATEGORY_WHY_TEMPLATES[bottleneck_category]) ||
           null;
  }
  if (article_type === 'EARNINGS') {
    base = 'Earnings event with material thesis content — track guidance trajectory, mix, and whether it confirms the active structural narrative.';
  }
  if (article_type === 'TARIFF') {
    base = 'Trade-policy move alters supply-chain cost & local content economics — currency, margin, and rerouting follow within quarters.';
  }
  if (article_type === 'GEOPOLITICAL') {
    base = 'Geopolitical event with supply-chain transmission risk — energy / shipping / strategic-mineral channels are the primary read.';
  }
  if (article_type === 'MACRO') {
    base = 'Macro regime signal — liquidity / growth / inflation transmission to sector rotation and duration trade.';
  }
  if (!base) return null;

  // Append decay flavor
  const decayQualifier = half_life === 'SECULAR' ? ' Multi-year theme.'
    : half_life === 'STRUCTURAL' ? ' Multi-quarter theme.'
    : half_life === 'CYCLICAL' ? ' Watch through this cycle.'
    : '';
  // Append expectation flavor
  const expQualifier = expectation.priced_in_score >= 70 ? ' (largely priced in — variant requires divergence)' :
    expectation.priced_in_score <= 30 ? ' (under-recognised — surprise potential)' : '';
  return base + decayQualifier + expQualifier;
}

// ── 5. Consensus vs Variant view block ─────────────────────────────────────

export interface ConsensusVariant {
  consensus: string;
  variant: string;
  market_pricing: string;
  risk: string;
}

const CV_TEMPLATES: Record<string, ConsensusVariant> = {
  MEMORY_STORAGE: {
    consensus:      'Memory cycle peaks in 2026; pricing power normalises into 2027.',
    variant:        'HBM allocation + DRAM tightness + AI demand extend cycle into 2028.',
    market_pricing: 'Memory equities priced for cyclical normalisation; ~12-15x trough EPS.',
    risk:           'New-fab supply ramps faster than expected; HBM capacity catches up.',
  },
  FABRICATION_PACKAGING: {
    consensus:      'AI infra demand peaks 2026; packaging eases.',
    variant:        'CoWoS / advanced packaging remains binding through 2027 despite expansion.',
    market_pricing: 'TSMC / packagers priced for soft cyclical landing.',
    risk:           'AMKR / ASE capex catches up; substrate yield improves.',
  },
  INTERCONNECT_PHOTONICS: {
    consensus:      'Optical I/O is a 2027+ story; copper has runway.',
    variant:        'Bandwidth wall in 2026 forces CPO adoption ahead of consensus timeline.',
    market_pricing: 'Photonics names priced as speculative thematic; not yet in earnings.',
    risk:           'Hyperscaler conservatism delays CPO ramp; copper-DAC TCO advantage holds.',
  },
  COMPUTE_SCALING: {
    consensus:      'Inference market commoditises; accelerator margins compress.',
    variant:        'Inference demand is sticky and accelerator allocation stays tight; custom-silicon is additive.',
    market_pricing: 'NVDA priced at peak-margin multiple; AMD priced as #2 share gainer.',
    risk:           'Open-source models compress inference unit economics; Hyperscalers pivot to ASIC.',
  },
  POWER_GRID: {
    consensus:      'Grid catches up by 2027; DC builds proceed on schedule.',
    variant:        'Grid lag persists; DC pace shifts to power-rich geographies; transformer ASP up multi-year.',
    market_pricing: 'GEV / ETN priced for cyclical, not secular, demand.',
    risk:           'Grid-modernisation capex executes; demand-response and behind-the-meter solutions scale.',
  },
  NUCLEAR_ENERGY: {
    consensus:      'Nuclear revival is slow; project execution risk dominates.',
    variant:        'AI baseload demand re-rates SMR + uranium curve; utility duration shortens.',
    market_pricing: 'Cameco priced for cyclical uranium; SMR names speculative.',
    risk:           'SMR cost overruns; existing nuclear sufficient for AI demand.',
  },
  THERMAL_COOLING: {
    consensus:      'Liquid cooling is a niche; air still works.',
    variant:        'Rack power density past air envelope; liquid is mandatory by 2026.',
    market_pricing: 'Cooling specialists priced as thematic, not embedded.',
    risk:           'AI training compute densifies more slowly; air solutions extend.',
  },
  MATERIALS_SUPPLY: {
    consensus:      'Material supply self-corrects within a cycle.',
    variant:        'Concentration risk drives multi-year reshoring premium for Western processors.',
    market_pricing: 'Western miners discounted vs Chinese peers.',
    risk:           'Substitution / recycling reduces demand; Chinese supply stable.',
  },
};

export function buildConsensusVariant(args: {
  bottleneck_sub_tag?: string | null;
  bottleneck_category?: string;
  importance_rank: SignalImportanceRank;
  article_type: string;
}): ConsensusVariant | null {
  const { bottleneck_sub_tag, importance_rank, article_type } = args;
  if (importance_rank !== 'TIER_1_ALPHA' && importance_rank !== 'TIER_2_RELEVANT') return null;
  if (article_type !== 'BOTTLENECK') return null;
  return (bottleneck_sub_tag && CV_TEMPLATES[bottleneck_sub_tag]) || null;
}

// ── 6. Signal decay logic ──────────────────────────────────────────────────
// Half-life × age determines effective importance. After ~3x half-life, the
// signal is dead.

const HALF_LIFE_DAYS: Record<SignalHalfLife, number> = {
  TRANSIENT:  4,    // 3-5 days
  CYCLICAL:   30,   // ~1 month
  STRUCTURAL: 180,  // ~6 months
  SECULAR:    540,  // ~18 months
};

export function applySignalDecay(args: {
  half_life: SignalHalfLife;
  age_days: number;
  base_importance: number;  // 0-1
}): number {
  const { half_life, age_days, base_importance } = args;
  const halfLife = HALF_LIFE_DAYS[half_life];
  // Exponential half-life decay
  const decay = Math.pow(0.5, age_days / halfLife);
  return Math.max(0.05, Math.round(base_importance * decay * 100) / 100);
}

// ── 7. Multi-hop causal chain mapping ──────────────────────────────────────
// Each link: { from, to, mechanism }.
// Chains are read top-down so the first link is closest to the news event.

export interface CausalLink {
  from: string;
  to: string;
  mechanism: string;
}

const CAUSAL_CHAINS: Record<string, CausalLink[]> = {
  MEMORY_STORAGE: [
    { from: 'HBM shortage',         to: 'GPU shipment delays',           mechanism: 'memory-bound build' },
    { from: 'GPU shipment delays',  to: 'Cloud deployment slowdown',     mechanism: 'capacity gap' },
    { from: 'Cloud deployment',     to: 'Enterprise AI rollout delays',  mechanism: 'inference availability' },
    { from: 'Enterprise AI delays', to: 'Software monetisation lag',     mechanism: 'AI-feature ARPU push back' },
  ],
  FABRICATION_PACKAGING: [
    { from: 'CoWoS / packaging tight', to: 'GPU shipment cap',         mechanism: 'substrate yield' },
    { from: 'GPU cap',                 to: 'Cloud capex re-timing',    mechanism: 'capacity sequencing' },
    { from: 'Cloud capex re-timing',   to: 'Hyperscaler capex shift',  mechanism: 'reallocation to power-rich regions' },
    { from: 'Hyperscaler shift',       to: 'GE Vernova / BHEL upside', mechanism: 'transformer / grid order' },
  ],
  POWER_GRID: [
    { from: 'Grid capacity lag',     to: 'DC build delay',                   mechanism: 'utility connection queue' },
    { from: 'DC build delay',        to: 'Hyperscaler capex re-routes',      mechanism: 'load-shifting to power-rich regions' },
    { from: 'Capex re-route',        to: 'Power-equipment ASP up',           mechanism: 'transformer / substation order' },
    { from: 'Power-equipment ASP',   to: 'GEV / BHEL / Eaton margin lift',   mechanism: 'pricing power' },
  ],
  NUCLEAR_ENERGY: [
    { from: 'AI baseload demand',    to: 'Nuclear order book',                mechanism: 'utility decarbon mandate' },
    { from: 'Nuclear orders',        to: 'Uranium price floor up',            mechanism: 'fuel demand schedule' },
    { from: 'Uranium price up',      to: 'Cameco / KAP rerate',               mechanism: 'spot-price upgrade' },
    { from: 'Reactor commissioning', to: 'BHEL / NPCIL execution visibility', mechanism: 'EPC backlog' },
  ],
  ENERGY_CONSTRAINT: [
    { from: 'Iran conflict',         to: 'Oil volatility',         mechanism: 'Hormuz transit risk' },
    { from: 'Oil volatility',        to: 'Diesel subsidy pressure', mechanism: 'India under-recovery' },
    { from: 'Diesel subsidy',        to: 'India fiscal burden',     mechanism: 'subsidy bill expansion' },
    { from: 'Fiscal burden',         to: 'OMC margin stress',       mechanism: 'price pass-through lag' },
    { from: 'OMC margin',            to: 'Bank liquidity / NIM',    mechanism: 'OMC borrowing → bank balance sheet' },
    { from: 'Bank liquidity',        to: 'Rate path expectation',   mechanism: 'monetary stance recalibration' },
  ],
  LOGISTICS_CONSTRAINT: [
    { from: 'Freight chokepoint',    to: 'Inventory build cost',    mechanism: 'longer in-transit / dwell' },
    { from: 'Inventory cost',        to: 'Working capital pressure', mechanism: 'NWC tied up' },
    { from: 'Working capital',       to: 'Pricing pass-through',    mechanism: 'cost recovery' },
  ],
  MATERIAL_SCARCITY: [
    { from: 'Critical mineral risk', to: 'Strategic stockpile',     mechanism: 'sovereign reserve build' },
    { from: 'Stockpile',             to: 'Western miner rerate',    mechanism: 'multi-year price floor' },
    { from: 'Miner rerate',          to: 'Vertical integration',    mechanism: 'OEM upstream M&A' },
  ],
};

export function buildCausalChain(args: {
  bottleneck_sub_tag?: string | null;
  bottleneck_category?: string;
  article_type: string;
  importance_rank: SignalImportanceRank;
  title: string;
  desc: string;
}): CausalLink[] {
  const { bottleneck_sub_tag, bottleneck_category, article_type, importance_rank, title, desc } = args;
  if (importance_rank !== 'TIER_1_ALPHA' && importance_rank !== 'TIER_2_RELEVANT') return [];

  // Sub-tag chain takes priority
  if (bottleneck_sub_tag && CAUSAL_CHAINS[bottleneck_sub_tag]) return CAUSAL_CHAINS[bottleneck_sub_tag];

  // Category fallback
  if (bottleneck_category && CAUSAL_CHAINS[bottleneck_category]) return CAUSAL_CHAINS[bottleneck_category];

  // Special-case: oil / Iran chain triggers on geopolitical text even when not BOTTLENECK
  const text = (title + ' ' + desc).toLowerCase();
  if (article_type === 'GEOPOLITICAL' && /(iran|hormuz|red sea|opec|crude|brent|wti)/.test(text)) {
    return CAUSAL_CHAINS.ENERGY_CONSTRAINT;
  }
  return [];
}

// ── 3. Anomaly explanation builder ─────────────────────────────────────────
// Replaces the machine-y "GENERAL_CONSTRAINT ×3" with semantic phrasing.

export interface AnomalySignal {
  display_name: string;       // human-readable replacement for raw key
  count: number;
  baseline_count: number;     // typical 7-day rolling avg (estimated)
  deviation: 'EMERGING' | 'ESCALATING' | 'DOMINANT';
  why_it_matters: string;     // 1-line explanation
}

const THEME_DISPLAY: Record<string, string> = {
  MEMORY_STORAGE:         'HBM / DRAM stress',
  FABRICATION_PACKAGING:  'Packaging / wafer capacity',
  INTERCONNECT_PHOTONICS: 'Optical interconnect adoption',
  COMPUTE_SCALING:        'AI accelerator capacity',
  POWER_GRID:             'Power / grid capacity',
  NUCLEAR_ENERGY:         'Nuclear / reactor cycle',
  THERMAL_COOLING:        'Liquid cooling adoption',
  MATERIALS_SUPPLY:       'Critical mineral concentration',
  QUANTUM_CRYOGENICS:     'Quantum infra emergence',
  GENERAL_CONSTRAINT:     'Cross-category supply tightening',
};

const THEME_WHY: Record<string, string> = {
  MEMORY_STORAGE:         'Multi-source coverage of HBM / DRAM tightness signals AI memory cycle is accelerating, not normalising.',
  FABRICATION_PACKAGING:  'Cluster of packaging capacity articles indicates upstream constraint binding harder; GPU shipment risk extends.',
  INTERCONNECT_PHOTONICS: 'Optical / CPO coverage spike suggests bandwidth wall is moving forward in deployment timelines.',
  COMPUTE_SCALING:        'Accelerator-allocation chatter clustering — supports the "inference demand is sticky" thesis.',
  POWER_GRID:             'Grid / transformer headlines clustering — power is becoming the next binding constraint after compute.',
  NUCLEAR_ENERGY:         'Nuclear / SMR coverage cluster — AI baseload narrative gaining institutional traction.',
  THERMAL_COOLING:        'Liquid-cooling articles spiking — rack power density push past air envelope.',
  MATERIALS_SUPPLY:       'Critical-mineral coverage rising — strategic supply policy responses likely.',
  GENERAL_CONSTRAINT:     'Multi-category supply tightness — broad-based reshoring / inflation pressure read.',
};

export function classifyAnomaly(args: { theme: string; count: number }): AnomalySignal {
  const { theme, count } = args;
  // Baseline assumption: typical 7-day per-theme volume is 1-2 articles
  const baseline = 2;
  let deviation: AnomalySignal['deviation'] = 'EMERGING';
  if (count >= 8) deviation = 'DOMINANT';
  else if (count >= 5) deviation = 'ESCALATING';
  return {
    display_name: THEME_DISPLAY[theme] || theme.replace(/_/g, ' ').toLowerCase(),
    count,
    baseline_count: baseline,
    deviation,
    why_it_matters: THEME_WHY[theme] || 'Cluster activity above baseline — emerging narrative to track.',
  };
}

export function classifyTickerAnomaly(args: { ticker: string; count: number }): AnomalySignal {
  const { ticker, count } = args;
  let deviation: AnomalySignal['deviation'] = 'EMERGING';
  if (count >= 6) deviation = 'DOMINANT';
  else if (count >= 4) deviation = 'ESCALATING';
  return {
    display_name: ticker,
    count,
    baseline_count: 1,
    deviation,
    why_it_matters: `${count} articles in 24h on ${ticker} — flow / news event clustering. Watch for follow-on price action.`,
  };
}
