// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type MetricBounds } from './types';

// ── Design tokens
export const BG      = '#0a0a0f';
export const CARD    = '#13131a';
export const CARD2   = '#191926';
export const BORDER  = 'rgba(255,255,255,0.08)';
export const TEXT    = '#e2e8f0';
export const MUTED   = '#64748b';
export const ACCENT  = '#38bdf8';
export const GREEN   = '#10b981';
export const RED     = '#ef4444';
export const ORANGE  = '#f97316';
export const YELLOW  = '#f59e0b';
export const PURPLE  = '#a78bfa';
export const F       = { xs:11, sm:13, md:15, lg:17, h2:20, h3:17 };
export const METRIC_BOUNDS: MetricBounds[] = [
  { name: 'grossMargin',   min: -50,   max: 100   },  // Gross margin physically can't exceed 100%
  { name: 'ebitdaMargin',  min: -500,  max: 100   },  // EBITDA can't exceed revenue
  { name: 'ebitMargin',    min: -500,  max: 100   },
  { name: 'patMargin',     min: -500,  max: 80    },  // PAT > 80% of revenue = almost impossible
  { name: 'roce',          min: -200,  max: 200   },
  { name: 'roe',           min: -500,  max: 300   },
  { name: 'roa',           min: -200,  max: 100   },
  { name: 'cfoPat',        min: -50,   max: 50    },  // CFO/PAT of 940x = parsing error
  { name: 'deRatio',       min: 0,     max: 100   },
];
// ── STEP 6: Extract management text intelligence ──────────────────────────────

export const NARRATIVE_THEMES: { tag: string; label: string; emoji: string; color: string; keywords: string[] }[] = [
  { tag: 'AI_INFRA',    label: 'AI Infrastructure',     emoji: '🤖', color: '#38bdf8', keywords: ['artificial intelligence','machine learning','ai/ml','generative ai','llm','foundation model','gpu','data center ai','ai training','ai inference','ai workload','ai chipset'] },
  { tag: 'EDGE_COMPUTE',label: 'Edge Compute',          emoji: '⚡', color: '#a78bfa', keywords: ['edge compute','edge ai','edge platform','rugged compute','rugged hpc','high performance compute','edge processing','hpc','sensor fusion','sensor processing'] },
  { tag: 'DEFENSE',     label: 'Defense / Military',    emoji: '🛡️', color: '#f97316', keywords: ['defense','defence','military','army','navy','air force','autonomous vehicle','uav','unmanned','naval','weapon system','classified','government contract','defense prime','drdo'] },
  { tag: 'AUTONOMY',    label: 'Autonomous Systems',    emoji: '🚗', color: '#10b981', keywords: ['autonomous','autonomy','self-driving','automated','self-guided','unmanned aerial','robotics','auto navigation'] },
  { tag: 'SEMI',        label: 'Semiconductor',         emoji: '💾', color: '#f59e0b', keywords: ['semiconductor','chip','gpu','cpu','asic','fpga','silicon','wafer','foundry','pcie','nvme','flash'] },
  { tag: 'DEFENSE_AI',  label: 'Defense AI',            emoji: '🎯', color: '#ef4444', keywords: ['defense ai','military ai','battlefield ai','weapon ai','tactical ai','ew system','electronic warfare','c2 system','command control'] },
  { tag: 'CLOUD_INFRA', label: 'Cloud / HPC',           emoji: '☁️', color: '#06b6d4', keywords: ['hyperscaler','cloud computing','hpc cluster','super computer','gpu cluster','distributed computing'] },
  { tag: 'CLEAN_ENERGY',label: 'Clean Energy',          emoji: '🌱', color: '#34d399', keywords: ['solar energy','wind energy','renewable energy','battery storage','ev charging','green energy','clean energy','climate tech'] },
  { tag: 'PHARMA_AI',   label: 'Pharma / Biotech',      emoji: '🧬', color: '#c084fc', keywords: ['drug discovery','clinical trial','biopharma','genomics','proteomics','ai drug','biomarker','precision medicine'] },
  { tag: 'CDN_EDGE',    label: 'CDN / Edge Cloud',      emoji: '🌐', color: '#2dd4bf', keywords: ['content delivery network','cdn','edge cloud','edge computing platform','web application firewall','waf','ddos protection','network security','next-gen waf','bot management','api security','zero trust'] },
  { tag: 'FINTECH',     label: 'Fintech / Payments',    emoji: '💳', color: '#f472b6', keywords: ['payment processing','digital payments','neobank','buy now pay later','bnpl','open banking','blockchain payment','crypto exchange','cbdc'] },
  { tag: 'INDIA_INFRA', label: 'India Infrastructure',  emoji: '🏗️', color: '#fb923c', keywords: ['pm gati shakti','national highway','smart city','metro rail','water supply','irrigation project','bharat','make in india','atmanirbhar','pli scheme'] },
  { tag: 'EV',          label: 'EV / Mobility',         emoji: '🔋', color: '#4ade80', keywords: ['electric vehicle','ev battery','ev charging infrastructure','battery electric','bev','plug-in hybrid','motor vehicle electri'] },
];
// Minimum keyword match count required for theme detection (prevents false positives)
export const THEME_MIN_MATCHES: Record<string, number> = {
  AI_INFRA: 2,      // needs 2 AI keywords to avoid "AI" mentioned in footnote
  SEMI: 2,          // "chip" in passing shouldn't trigger
  AUTONOMY: 2,      // "autonomous" in boilerplate shouldn't trigger
  DEFENSE: 2,       // needs 2 defense keywords
  CDN_EDGE: 1,      // highly specific terms
  INDIA_INFRA: 2,
};
export const HISTORY_KEY2 = 'ea_v3_history';
