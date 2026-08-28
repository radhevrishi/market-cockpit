// ═══════════════════════════════════════════════════════════════════════════
// THEME CLASSIFIER (zzz485) — map ANY stock to its best-fit rotation theme from
// the SECTOR / INDUSTRY tag every Technicals & Multibagger row already carries.
// Keyword-based, so it keeps working for years and for stocks added in future —
// no per-ticker maintenance. Returns a theme id from theme-universe, or null when
// nothing fits (those land in an "Other" bucket the user can ask us to map).
// ═══════════════════════════════════════════════════════════════════════════
import type { ThemeRegion } from './theme-universe';

type Rule = { re: RegExp; theme: string };

// Checked in order; first match wins. Industry (finer) is matched before sector.
const US_RULES: Rule[] = [
  { re: /semiconduct|chip|foundry|wafer|fabless/i, theme: 'us-semis' },
  { re: /memory|dram|nand|storage/i, theme: 'us-memory' },
  { re: /photonic|optical|fiber optic|laser/i, theme: 'us-photonics' },
  { re: /cyber|security software/i, theme: 'us-cyber' },
  { re: /cloud|saas|software as a service/i, theme: 'us-cloud' },
  { re: /internet|e-?commerce|online (?:retail|media)|web/i, theme: 'us-internet' },
  { re: /fintech|payment|card (?:network|processing)/i, theme: 'us-fintech' },
  { re: /software|application|prepackaged|information technology services|it services|packaged software/i, theme: 'us-software' },
  { re: /aerospace|defen[cs]e|military|weapon/i, theme: 'us-defense' },
  { re: /space|satellite|launch/i, theme: 'us-space' },
  { re: /drone|unmanned|autonom/i, theme: 'us-drones' },
  { re: /biotech|genom|gene (?:therapy|editing)|life scien/i, theme: 'us-biotech' },
  { re: /pharmac|drug|medicin|therapeut|obesity|glp/i, theme: 'us-obesity' },
  { re: /health (?:tech|care|services)|medical|hospital|diagnostic/i, theme: 'us-biotech' },
  { re: /uranium|nuclear/i, theme: 'us-nuclear' },
  { re: /solar|photovolta/i, theme: 'us-solar' },
  { re: /hydrogen|fuel cell/i, theme: 'us-hydrogen' },
  { re: /clean energy|renewable|wind power/i, theme: 'us-cleanenergy' },
  { re: /lithium|battery/i, theme: 'us-battery' },
  { re: /electric vehicle|\bev\b|automotive|auto (?:manufact|part)|vehicle/i, theme: 'us-ev' },
  { re: /oil|gas|petroleum|energy minerals|refin|pipeline|drilling/i, theme: 'us-energy' },
  { re: /copper|base metal/i, theme: 'us-copper' },
  { re: /gold|precious metal|silver/i, theme: 'us-gold' },
  { re: /rare earth|critical mineral|lithium mining|strategic metal/i, theme: 'us-critminerals' },
  { re: /water|utilit/i, theme: 'us-water' },
  { re: /robot|automation|industrial machinery/i, theme: 'us-robotics' },
  { re: /crypto|blockchain|bitcoin|digital asset/i, theme: 'us-crypto' },
  { re: /quantum/i, theme: 'us-quantum' },
  { re: /game|gaming|esport|entertainment software/i, theme: 'us-gaming' },
  { re: /metaverse|augmented|virtual reality/i, theme: 'us-metaverse' },
  { re: /agri|farm|food (?:tech|product)|fertiliz/i, theme: 'us-agtech' },
  { re: /homebuild|home construction|residential construction|building product/i, theme: 'us-homebuild' },
  { re: /bank|regional bank|savings/i, theme: 'us-regbanks' },
  { re: /finance|financial|insurance|invest|asset manage|capital market/i, theme: 'us-fintech' },
  { re: /infrastructure|engineering|construction|machinery|electrical equip/i, theme: 'us-infra' },
  { re: /communication|telecom|5g|wireless|networking/i, theme: 'us-5g' },
  { re: /\bai\b|artificial intelligence|machine learning|data/i, theme: 'us-ai' },
  { re: /technology services|electronic technology|computer|hardware/i, theme: 'us-semis' },
];

const IN_RULES: Rule[] = [
  { re: /software|it services|information technology|computer|saas/i, theme: 'in-it' },
  { re: /electronic|ems|contract manufactur|component/i, theme: 'in-ems' },
  { re: /defen[cs]e|aerospace|shipbuild|explosive/i, theme: 'in-defence' },
  { re: /rail|wagon|locomotive/i, theme: 'in-railways' },
  { re: /power|electric util|transmission|transformer|energy - power/i, theme: 'in-power' },
  { re: /renewable|solar|wind|green (?:energy|hydrogen)/i, theme: 'in-renewables' },
  { re: /capital good|engineering|machinery|industrial|infrastructure develop|construction - civil/i, theme: 'in-capgoods' },
  { re: /oil|gas|petroleum|refin|energy|coal/i, theme: 'in-energy' },
  { re: /steel|metal|aluminium|mining|iron/i, theme: 'in-metal' },
  { re: /chemical|fertiliz|specialty chem|agrochem/i, theme: 'in-chemicals' },
  { re: /pharma|drug|healthcare - (?:pharma|drug)|life scien/i, theme: 'in-pharma' },
  { re: /hospital|healthcare (?:services|facilit)|diagnostic|medical/i, theme: 'in-hospitals' },
  { re: /fmcg|consumer staple|food|beverage|personal (?:care|product)|household/i, theme: 'in-fmcg' },
  { re: /auto|vehicle|automobile|tyre|auto (?:anc|part)/i, theme: 'in-auto' },
  { re: /realty|real estate|property|housing develop/i, theme: 'in-realty' },
  { re: /cement|building material/i, theme: 'in-cement' },
  { re: /retail|apparel|footwear|jewel|restaurant|qsr|discretionary/i, theme: 'in-retail' },
  { re: /internet|e-?commerce|fintech|online|new age|platform/i, theme: 'in-newage' },
  { re: /port|shipping|logistic|marine/i, theme: 'in-ports' },
  { re: /psu bank|public sector bank/i, theme: 'in-psubank' },
  { re: /bank/i, theme: 'in-bank' },
  { re: /financ|nbfc|insurance|invest|capital market|housing finance/i, theme: 'in-finserv' },
  { re: /data cent|telecom|communication/i, theme: 'in-datacenter' },
  { re: /pse|public sector/i, theme: 'in-pse' },
];

// Classify a stock into a theme id from its sector + industry text. Industry is
// the finer tell, so it's tried first, then the broader sector.
export function classifyTheme(sector: string | undefined | null, industry: string | undefined | null, region: ThemeRegion): string | null {
  const rules = region === 'us' ? US_RULES : IN_RULES;
  const ind = (industry || '').toString();
  const sec = (sector || '').toString();
  for (const text of [ind, sec]) {
    if (!text.trim()) continue;
    for (const r of rules) if (r.re.test(text)) return r.theme;
  }
  return null;
}
