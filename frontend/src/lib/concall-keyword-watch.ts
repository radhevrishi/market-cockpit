// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0394 — Keyword Watch — third intelligence lane.
//
// User-defined keyword/phrase watchlist. Scans all PDF-extracted filings
// for matches and returns the actual sentence containing each hit.
// Goes beyond the bullish scoring engine: instead of scoring a filing as
// a whole, it just surfaces every filing that mentions any selected
// keyword, with the supporting quote.
//
// Use cases per user spec:
//   - "Find every filing mentioning margin pressure / guidance cut / capex
//     delay / pricing pressure / inventory correction / demand slowdown"
//   - "Find every filing mentioning China / AI / PLI / USFDA / export
//     recovery / order book"
// ═══════════════════════════════════════════════════════════════════════════

export type KeywordGroup = 'RISK' | 'THEME' | 'REGULATORY' | 'OPPORTUNITY' | 'SECTOR';

export interface KeywordSpec {
  id: string;                  // stable id
  display: string;             // user-facing label
  re: RegExp;                  // case-insensitive regex
  group: KeywordGroup;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

// ─── Curated keyword catalog ───────────────────────────────────────────────

export const KEYWORD_CATALOG: KeywordSpec[] = [
  // RISK signals — bearish phrases user wants to monitor
  { id: 'margin-pressure',     display: 'Margin pressure',      re: /\bmargin\s+(?:pressure|compression|contraction|squeeze|erosion)\b/i,                            group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'guidance-cut',        display: 'Guidance cut',         re: /\bguidance\s+(?:cut|lowered|reduced|withdrawn|missed?)\b|reduce[d]?\s+(?:our\s+)?guidance/i,    group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'capex-delay',         display: 'Capex delay',          re: /capex\s+(?:delay|deferral|deferred|slipp)|capital\s+expenditure\s+(?:delay|deferred|deferral)/i, group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'pricing-pressure',    display: 'Pricing pressure',     re: /pricing\s+(?:pressure|decline)|price\s+erosion|deflationary\s+pricing/i,                       group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'inventory-correction',display: 'Inventory correction', re: /inventory\s+(?:correction|overhang|destock)|destocking/i,                                       group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'demand-slowdown',     display: 'Demand slowdown',      re: /demand\s+(?:slowdown|softness|weakness|moderation|deceleration)|softer\s+demand|weak\s+demand/i, group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'working-capital',     display: 'Working capital stretch', re: /working\s+capital\s+(?:stretch|expansion|increase)|receivable\s+(?:stress|aging)/i,           group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'cautious-outlook',    display: 'Cautious outlook',     re: /cautious\s+(?:outlook|near[-\s]?term)|near[-\s]?term\s+(?:headwind|challenge)/i,               group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'oneoff',              display: 'One-off / exceptional',re: /one[-\s]?off|exceptional\s+(?:gain|item|charge)|extraordinary\s+(?:item|gain)/i,                group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'covenant-breach',     display: 'Covenant breach',      re: /covenant\s+(?:breach|waiver)|debt\s+default|going\s+concern/i,                                  group: 'RISK',        sentiment: 'NEGATIVE' },
  { id: 'auditor-issue',       display: 'Auditor issue',        re: /auditor\s+(?:resign|change|withdraw)|qualified\s+(?:audit|opinion)/i,                           group: 'RISK',        sentiment: 'NEGATIVE' },

  // OPPORTUNITY signals
  { id: 'order-book',          display: 'Order book',           re: /\border\s+(?:book|inflow|pipeline|backlog)\b/i,                                                 group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'export-recovery',     display: 'Export recovery',      re: /export\s+(?:recovery|growth|momentum|traction|inroad)/i,                                        group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'capacity-expansion',  display: 'Capacity expansion',   re: /capacity\s+(?:expansion|addition|ramp|commission|enhancement)/i,                                group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'margin-expansion',    display: 'Margin expansion',     re: /margin\s+(?:expansion|improvement|recovery)|operating\s+leverage/i,                             group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'guidance-raise',      display: 'Guidance raise',       re: /guidance\s+(?:raise|upgraded?|increased|reiterat)|raising\s+guidance|upgrade[d]?\s+guidance/i, group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'new-customer',        display: 'New customer / order', re: /(?:new|major)\s+customer|repeat\s+order|customer\s+(?:wins?|acquisition)|tier[-\s]?1\s+customer/i, group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'market-share-gain',   display: 'Market share gain',    re: /market\s+share\s+(?:gain|expansion|increase)|gain(?:ed|ing)?\s+share/i,                          group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'premium-mix',         display: 'Premiumization',       re: /premium(?:isation|ization|ize|ise)|better\s+(?:product\s+)?mix|value[-\s]?added/i,             group: 'OPPORTUNITY', sentiment: 'POSITIVE' },
  { id: 'deleveraging',        display: 'Deleveraging',         re: /deleverag(?:e|ing)|debt\s+(?:reduction|repayment)|net[-\s]?cash|net\s+debt[-\s]?free/i,        group: 'OPPORTUNITY', sentiment: 'POSITIVE' },

  // THEME — secular / macro / popular keywords
  { id: 'china',               display: 'China',                re: /\bChina\b/i,                                                                                    group: 'THEME',       sentiment: 'NEUTRAL' },
  { id: 'china-plus-one',      display: 'China+1',              re: /China\s*[+]\s*1|China\s+plus\s+one|de[-\s]?risk(?:ing)?\s+(?:from\s+)?China/i,                  group: 'THEME',       sentiment: 'POSITIVE' },
  { id: 'ai',                  display: 'AI',                   re: /\b(?:artificial\s+intelligence|AI|generative\s+AI|GenAI|machine\s+learning|ML)\b/i,             group: 'THEME',       sentiment: 'NEUTRAL' },
  { id: 'data-center',         display: 'Data center / AI compute', re: /\bdata\s+center|hyperscaler|AI\s+(?:compute|infra(?:structure)?)/i,                          group: 'THEME',       sentiment: 'POSITIVE' },
  { id: 'ev',                  display: 'EV / Electric Vehicle',re: /\b(?:electric\s+vehicle|EVs?|e[-\s]?mobility|EV\s+ecosystem)\b/i,                              group: 'THEME',       sentiment: 'NEUTRAL' },
  { id: 'semiconductor',       display: 'Semiconductor',        re: /\b(?:semiconductor|fab(?:rication)?|wafer|chip\s+making|OSAT|ATMP|fabless)\b/i,                 group: 'THEME',       sentiment: 'NEUTRAL' },
  { id: 'defence',             display: 'Defence',              re: /\b(?:defence|defense)\s+(?:order|contract|capex|indigeniz|exports?)|Atmanirbhar/i,              group: 'THEME',       sentiment: 'POSITIVE' },
  { id: 'renewable',           display: 'Renewable / Solar',    re: /\b(?:renewable\s+energy|solar|wind\s+energy|BESS|battery\s+storage|green\s+hydrogen)\b/i,        group: 'THEME',       sentiment: 'POSITIVE' },
  { id: 'real-estate',         display: 'Real estate / RERA',   re: /\b(?:RERA|land\s+bank|residential\s+launch|commercial\s+real\s+estate)\b/i,                     group: 'THEME',       sentiment: 'NEUTRAL' },
  { id: 'hospitality',         display: 'Hospitality / RevPAR', re: /\b(?:RevPAR|occupancy|ARR\s+(?:growth|rate)|hospitality\s+demand)\b/i,                          group: 'THEME',       sentiment: 'NEUTRAL' },

  // REGULATORY signals
  { id: 'pli',                 display: 'PLI',                  re: /\bPLI\s+(?:scheme|incentive|benefit|approval)|production[-\s]?linked\s+incentive/i,             group: 'REGULATORY',  sentiment: 'POSITIVE' },
  { id: 'usfda',               display: 'USFDA',                re: /\bUSFDA\b|\bUS\s+FDA\b|FDA\s+(?:approval|inspection|warning\s+letter|EIR|483)/i,                 group: 'REGULATORY',  sentiment: 'NEUTRAL' },
  { id: 'anda',                display: 'ANDA / DMF',           re: /\bANDA\b|drug\s+master\s+file|DMF\b/i,                                                          group: 'REGULATORY',  sentiment: 'POSITIVE' },
  { id: 'sebi',                display: 'SEBI action',          re: /\bSEBI\s+(?:investigation|order|enforcement|action|notice|circular)/i,                          group: 'REGULATORY',  sentiment: 'NEUTRAL' },
  { id: 'rbi-action',          display: 'RBI action',           re: /\bRBI\s+(?:circular|guideline|approval|inspection|action)/i,                                    group: 'REGULATORY',  sentiment: 'NEUTRAL' },
  { id: 'tariff',              display: 'Tariff / Duty',        re: /\b(?:tariff|customs?\s+duty|anti[-\s]?dumping|countervailing)\b/i,                              group: 'REGULATORY',  sentiment: 'NEUTRAL' },
  { id: 'gst',                 display: 'GST',                  re: /\b(?:GST\s+(?:rate|cut|hike|change|refund|notice)|input\s+tax\s+credit)/i,                       group: 'REGULATORY',  sentiment: 'NEUTRAL' },

  // SECTOR-specific watchwords
  { id: 'nim',                 display: 'NIM (banks)',          re: /\bNIM\b|net\s+interest\s+margin|spread\s+(?:expansion|compression)/i,                            group: 'SECTOR',      sentiment: 'NEUTRAL' },
  { id: 'gnpa',                display: 'GNPA / slippage',      re: /\b(?:GNPA|NNPA|slippage|gross\s+NPA|credit\s+cost)\b/i,                                         group: 'SECTOR',      sentiment: 'NEGATIVE' },
  { id: 'deal-wins',           display: 'Deal wins (IT)',       re: /(?:deal\s+wins?|TCV|large\s+deal|mega\s+deal|TCS\s+TCV|deal\s+pipeline)/i,                       group: 'SECTOR',      sentiment: 'POSITIVE' },
  { id: 'utilization',         display: 'Utilization (IT/Mfg)', re: /\butilization|utilisation|capacity\s+utilization/i,                                              group: 'SECTOR',      sentiment: 'NEUTRAL' },
  { id: 'attrition',           display: 'Attrition (IT)',       re: /\battrition|employee\s+turnover|involuntary\s+attrition/i,                                       group: 'SECTOR',      sentiment: 'NEUTRAL' },
  { id: 'discretionary',       display: 'Discretionary spend',  re: /discretionary\s+(?:spend|spending|IT\s+spend)/i,                                                group: 'SECTOR',      sentiment: 'NEUTRAL' },
  { id: 'asp',                 display: 'ASP / Pricing',        re: /\bASP\b|average\s+selling\s+price|realization\s+(?:per\s+unit|growth)/i,                        group: 'SECTOR',      sentiment: 'NEUTRAL' },
];

// ─── Hit detector ──────────────────────────────────────────────────────────

export interface KeywordHit {
  keyword_id: string;
  display: string;
  group: KeywordGroup;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  sentence: string;     // the matched sentence (truncated)
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

const EVIDENCE_JUNK_RE = /\b\w+\.com\b|^[\d\s]{0,5}where\s+platform/i;

export function findKeywordHits(text: string, selectedIds: Set<string> | null = null): KeywordHit[] {
  if (!text || text.length < 30) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 20 && s.length <= 800 && !EVIDENCE_JUNK_RE.test(s));

  const hits: KeywordHit[] = [];
  const seenPairs = new Set<string>();   // dedupe (keyword + sentence)

  for (const sent of sentences) {
    for (const kw of KEYWORD_CATALOG) {
      if (selectedIds && !selectedIds.has(kw.id)) continue;
      if (kw.re.test(sent)) {
        const pairKey = `${kw.id}|${sent.slice(0, 80)}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        hits.push({
          keyword_id: kw.id,
          display: kw.display,
          group: kw.group,
          sentiment: kw.sentiment,
          sentence: truncate(sent, 280),
        });
      }
    }
  }
  return hits;
}

// Aggregate stats per group for header
export interface KeywordStats {
  total_hits: number;
  by_group: Record<KeywordGroup, number>;
  by_sentiment: Record<'POSITIVE' | 'NEGATIVE' | 'NEUTRAL', number>;
}

export function summarizeHits(hits: KeywordHit[]): KeywordStats {
  const stats: KeywordStats = {
    total_hits: hits.length,
    by_group: { RISK: 0, THEME: 0, REGULATORY: 0, OPPORTUNITY: 0, SECTOR: 0 },
    by_sentiment: { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 },
  };
  for (const h of hits) {
    stats.by_group[h.group]++;
    stats.by_sentiment[h.sentiment]++;
  }
  return stats;
}
