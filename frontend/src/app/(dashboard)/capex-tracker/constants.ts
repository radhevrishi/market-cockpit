// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// ── theme (cockpit dark palette) ────────────────────────────────────────────
export const C = {
  bg: '#0B1220', panel: '#101A2C', panel2: '#0D1623', line: '#1A2540',
  txt: '#E6EDF7', body: '#AEBBD0', dim: '#8B98AC', muted: '#5B6A82',
  green: '#00E68A', red: '#FF4D6A', amber: '#FFB347', blue: '#4DA6FF',
  cyan: '#22D3EE', violet: '#A78BFA', gold: '#FFD700', teal: '#2DD4BF', orange: '#F0883E',
};
// contrast contract: C.txt = data/values · C.body = any full sentence or explanation
// (readable on the dark bg) · C.dim = SHORT labels only · C.muted = true de-emphasis
// (placeholders, separators, captions) — never sentences, never below 11px for words.
export const F = { xs: 11, sm: 12.5, md: 14, lg: 17, xl: 24 };
// ── flexible header resolution (Appendix B names + common variants) ─────────
export const HEADERS: [string, RegExp][] = [
  ['name', /^(company ?name|company|name|stock)$/i],
  ['sector', /^sector$/i],
  ['industry', /^industry$/i],
  ['country', /country|region|market|geo/i],
  ['roce', /roce/i],
  ['roic', /roic/i],
  ['util', /utili[sz]ation/i],
  ['de', /^d\/?e( ratio)?$|debt.?to.?equity/i],
  // exact-shape only: must NOT match telemetry like 'OCF/Capex 3y %'
  ['ocf', /^ocf ?(positive)? ?(years|status|yrs|3-? ?yr)?$/i],
  ['fcf', /fcf/i],
  ['internalPct', /internal/i],
  ['debtPct', /debt ?%|% ?debt|debt.?fund/i],
  ['capex', /^capex( size)?( rs)?( cr)?$|capex.?size|capex.?amount/i],
  ['grossBlock', /gross.?block/i],
  ['revenue', /^(annual ?revenue|revenue|sales)$/i],
  ['anchor', /anchor/i],
  ['promoter', /promoter.?hold/i],
  ['pledge', /pledge/i],
  ['tenure', /tenure|founder.?ceo/i],
  ['ebitda', /ebitda ?margin|^ebitda ?%?$/i],
  ['revCagr', /cagr/i],
  ['brownfield', /brownfield|green.?field/i],
  ['cycle', /^cycle|cycle.?position/i],
  ['overrun', /overrun/i],
  ['wc', /working.?capital|^wc/i],
  ['policy', /policy/i],
  ['peVsMean', /pe.?vs|pe.?rel|valuation|5.?yr.?mean/i],
  ['importSub', /import/i],
  ['exportOpp', /export/i],
  ['moat', /moat|competitive/i],
  ['mgmtHistory', /track.?record|execution.?history|prior.?capex/i],
  ['industryGrowth', /industry.?growth/i],
  ['ndTrend', /nd\/?ebitda trend|^trend nd/i],
  ['wealthDestroying', /^wealth destroying$/i],
];
// Parser TELEMETRY columns are read by exact name in scoreRow and must NEVER
// enter the header race — a loose factor regex matching one of these silently
// corrupts scores (e.g. /ocf/ once read 'OCF/Capex 3y %' as the OCF streak).
export const TELEMETRY_COLS = new Set([
  'Capex Phase', 'Capex/Sales %', 'CWIP/NetBlock %', 'Capex Accel x',
  'D/E change 2y', 'OCF/Capex 3y %', 'Net Debt/EBITDA', 'Capex/PreRev %',
  'Util Effective % (est)', 'NB Growth %', 'Rev YoY %', 'Capex Series', 'NB Series', 'CWIP Series', 'Prior Cycle Note', 'ND/EBITDA Trend', 'Wealth Destroying',
  // v5 intelligence columns — JSON blobs, must never win a factor header race
  'Fin Series', 'Fraud Tab', 'Moat Tab',
]);
// ── industry multiplier (Masterclass Ch.12.2) ───────────────────────────────
export const IND_MULT: [RegExp, number, string][] = [
  [/defen[cs]e|aerospace/i, 1.10, 'Defence/Aerospace'],
  [/special(i?ty)? ?chem/i, 1.08, 'Specialty Chemicals'],
  [/cdmo|cro\b|pharma|biolog/i, 1.06, 'Pharma/CDMO'],
  [/consumer|brand|fmcg|jewell?er|retail premium/i, 1.05, 'Consumer Premium'],
  [/cement|mining|peb|pre.?engineered|structural steel|building products/i, 1.03, 'Cement/MiningTech/PEB'],
  [/renewab|solar|wind|green energy/i, 1.02, 'Renewables'],
  [/semi ?conductor|chip|ai |cloud|data ?cent/i, 1.00, 'Semis/AI/Cloud'],
  [/\bems\b|electronics manufacturing/i, 1.00, 'EMS'],
  [/bank|nbfc|finance|financial/i, 0.95, 'Banks/NBFC'],
  [/real ?estate|residential|commercial project/i, 0.85, 'Real Estate'],
  [/telecom/i, 0.75, 'Telecom'],
  [/airline|aviation/i, 0.70, 'Airlines'],
  [/merchant power/i, 0.65, 'Merchant Power'],
  [/\bsteel\b|metal/i, 0.65, 'Steel/Metals'],
];
// ── 2026-2030 theme tagger (Masterclass Ch.11 Tier-1) ───────────────────────
export const THEMES: [RegExp, string][] = [
  [/defen[cs]e|aerospace|missile|forging/i, '🛡 Defence Indigenization'],
  [/peb|pre.?engineered|warehous|structural|building products/i, '🏗 PEB/Warehousing'],
  [/hydrogen|cryogenic|cylinder|critical mineral|lithium|graphite|recycl/i, '⚡ Hydrogen/Critical Minerals'],
  [/mining|beneficiation|mill liner|crane/i, '⛏ Mining Tech'],
  [/special(i?ty)? ?chem|fluoro|agrochem/i, '🧪 SpecChem China+1 W2'],
  [/jewell?er|mangalsutra|gold/i, '💍 Wedding Jewellery'],
  [/\bems\b|electronics/i, '📟 EMS PLI Wave (glut risk)'],
  [/cdmo|biolog|pharma/i, '💊 Pharma CDMO'],
];
// ── Stage A-F meta (Framework Phase 5 + 7) ──────────────────────────────────
export const STAGE_META: Record<string, { color: string; label: string; size: string; note: string; pos: number }> = {
  A: { color: '#A78BFA', label: 'ANNOUNCED / BUILDING', size: '0.5-1%', pos: 0.5,
    note: 'Highest return when it works, worst hit rate. Only for proven executors with net-cash sheets (HEICO, Mazagon, Jubilant archetype).' },
  B: { color: '#00E68A', label: 'JUST COMMISSIONED', size: '1.5-2.5%', pos: 1.5,
    note: 'Strongest hit-rate × multiple combo (~20% of optimal entries). Plant live, consensus has not modeled the ramp (Astral ’13, Deepak ’18, Symphony ’11).' },
  C: { color: '#FFD700', label: '~40% UTILIZATION (est) — MODAL ENTRY IF QUALITY HOLDS', size: '2-3.5%', pos: 2.2,
    note: 'THE modal optimal entry — ~55% of winners. Depreciation visible, GAAP not yet inflected, consensus extrapolates the depressed margin. Potential alpha window — but only if utilization ramps successfully AND leverage normalizes.' },
  D: { color: '#22D3EE', label: '~60% UTIL (est) — SECOND CHANCE', size: '1.5-2.5%', pos: 2.8,
    note: 'Second-chance entry (~20% of optimal). Typically 5-10x but the multiple has expanded — pair with a temporary sector overhang.' },
  E: { color: '#FFB347', label: '70-90% UTIL (est) — LATE', size: '0.5-1%', pos: 3.6,
    note: 'Operating leverage mostly exhausted. Enter only with a 30%+ valuation cushion to the prior cycle peak.' },
  F: { color: '#FF4D6A', label: '>90% UTIL (est) / INFLECTION PRINTED', size: '0%', pos: 4.6,
    note: 'The documented ANTI-PATTERN. Stage F entries are net NEGATIVE in the 250-case data (Tatva, Anupam, Wolfspeed post-print). Do not chase.' },
  '—': { color: '#8B98AC', label: 'NO MAJOR CYCLE', size: '—', pos: 0,
    note: 'Cycle capex below 25% of pre-capex revenue with no spend acceleration — serial-brownfield steady compounder. The Stage A-F multibagger arc does not apply; judge on quality and wait for a real cycle.' },
};
export const MB_GRADE_COLOR: Record<string, string> = {
  'A+': '#10b981', A: '#34d399', 'B+': '#f59e0b', B: '#f97316', C: '#fb923c', D: '#ef4444', NR: '#5B6A82',
};
export const FX_GRADE_COLOR: Record<string, string> = { CLEAN: C.green, WATCH: C.amber, FLAGS: C.orange, AVOID: C.red, NR: C.muted };
export const MB_GRADE_ORDER = ['A+', 'A', 'B+', 'B', 'C', 'D'];
// "Rs. 312 crores", "Mr. Sharma", initials etc. must not split a sentence
export const ABBR_END = /(?:\b(?:rs|mr|mrs|ms|dr|no|nos|vs|st|jr|sr|inc|ltd|pvt|approx)\.|\b[A-Za-z]\.)$/i;
// ── 🧭 VERDICT — the 11-rule fused call ─────────────────────────────────────
export const VERDICT_COLOR: Record<string, string> = {
  '☠ DO NOT TOUCH': C.red, '🧩 NEEDS DATA': C.violet, '🔍 FORENSIC REVIEW FIRST': C.orange,
  '🎯 PRIME': C.gold, '⏳ PRIME SETUP': C.teal, '🌱 COMPOUNDER': C.green, '🏗 CAPEX PLAY': C.cyan,
  '⚙ CYCLE ONLY': C.blue, '💎 QUALITY HOLD': C.violet, '🗑 DROP': C.dim, '👀 MONITOR': C.amber,
};
export const TRANSCRIPT_CAP = 300000;
// auto-attach: match stored company names token-wise against filename + transcript head
export const CO_STOP = new Set(['ltd', 'limited', 'india', 'indian', 'industries', 'industry', 'technologies', 'technology', 'tech', 'company', 'corporation', 'corp', 'private', 'pvt', 'the', 'and', 'group', 'enterprises', 'international', 'solutions', 'systems', 'products', 'services', 'inc', 'plc']);
export const TEMPLATE_HEADERS = 'Company Name,Sector,Industry,Country,ROCE 3-yr avg,Capacity Utilization %,D/E ratio,OCF positive years,FCF 3-yr,Internal funding %,Debt funding %,CAPEX size Cr,Gross Block,Annual Revenue,Anchor Demand %,Promoter Holding %,Promoter Pledge %,Founder-CEO Tenure,EBITDA Margin %,Revenue CAGR 3-yr %,Brownfield,Cycle Position,Cost Overrun History,Working Capital Trend,Policy Support,PE vs 5-yr Mean,Import Substitution,Export Opportunity,Competitive Moat,Prior Capex Success';
export const TEMPLATE_SAMPLE = 'Interarch Building,Industrials,PEB / Building Products,IN,28,88,0.04,5,120,90,10,400,650,1300,65,60,0,,14,22,Brownfield,Mid,No,Stable,Indirect,0.9,N,Y,Y,Y';
export const KD = 'mc:capex-tracker:data:v1';
 export const KN = 'mc:capex-tracker:files:v1';
export const KC = 'mc:capex-tracker:concalls:v1';
 // transcripts — survive 'Clear all'
export const KU = '__unassigned__';
