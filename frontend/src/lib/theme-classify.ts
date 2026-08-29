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
  { re: /\bmemory\b|dram|nand|flash memory/i, theme: 'us-memory' },
  { re: /photonic|optical network|fiber optic|\blaser/i, theme: 'us-photonics' },
  { re: /cyber|security software/i, theme: 'us-cyber' },
  { re: /\bcloud\b|saas|software as a service/i, theme: 'us-cloud' },
  { re: /\binternet\b|e-?commerce|online (?:retail|media)/i, theme: 'us-internet' },
  { re: /fintech|payment|card (?:network|processing)|data processing|transaction process|remittance|money transfer/i, theme: 'us-fintech' },
  { re: /software|application software|prepackaged|packaged software|it services|information technology services/i, theme: 'us-software' },
  { re: /aerospace|defen[cs]e|military|weapon|armament/i, theme: 'us-defense' },
  { re: /\bspace\b|satellite|launch vehicle/i, theme: 'us-space' },
  { re: /\bdrone|unmanned aerial/i, theme: 'us-drones' },
  { re: /biotech|genom|gene (?:therapy|editing)/i, theme: 'us-biotech' },
  { re: /obesity|glp-?1|weight loss/i, theme: 'us-obesity' },
  { re: /uranium|nuclear/i, theme: 'us-nuclear' },
  { re: /\bsolar\b|photovolta/i, theme: 'us-solar' },
  { re: /hydrogen|fuel cell/i, theme: 'us-hydrogen' },
  { re: /clean energy|renewable energy|wind power/i, theme: 'us-cleanenergy' },
  { re: /lithium|\bbattery\b/i, theme: 'us-battery' },
  { re: /electric vehicle|\bev\b|automobile manufactur|auto manufactur|vehicle manufactur/i, theme: 'us-ev' },
  { re: /\boil\b|\bgas\b|petroleum|energy minerals|refin|pipeline|drilling|oilfield/i, theme: 'us-energy' },
  { re: /\bcopper\b|base metal/i, theme: 'us-copper' },
  { re: /\bgold\b|precious metal|silver mining/i, theme: 'us-gold' },
  { re: /rare earth|critical mineral|strategic metal/i, theme: 'us-critminerals' },
  { re: /crypto|blockchain|bitcoin|digital asset/i, theme: 'us-crypto' },
  { re: /quantum comput/i, theme: 'us-quantum' },
  { re: /video game|gaming|esport/i, theme: 'us-gaming' },
  { re: /metaverse|augmented reality|virtual reality/i, theme: 'us-metaverse' },
  { re: /\bagri|\bfarm|fertiliz|\bcrop|\bseed\b/i, theme: 'us-agtech' },
  { re: /homebuild|home construction|residential construction|building product/i, theme: 'us-homebuild' },
  { re: /\brobot|factory automation/i, theme: 'us-robotics' },
  // transport & shipping
  { re: /marine|tanker|shipping|freight|airline|air freight|trucking|railroad|\brail\b|logistics|transportation|courier|package delivery|dry bulk/i, theme: 'us-transport' },
  // real estate BEFORE financials so "investment trust" -> REIT, not finance
  { re: /real estate|\breit\b|investment trust|property (?:trust|manage)/i, theme: 'us-reit' },
  // broad consumer
  { re: /retail|apparel|footwear|luxury goods|department store|specialty (?:retail|store)|discount store|supermarket|grocery/i, theme: 'us-retail' },
  { re: /restaurant|\bhotel|leisure|casino|resort|cruise|\btravel|lodging|recreation|home improvement|consumer discretionary|automotive (?:retail|dealer|part)/i, theme: 'us-condisc' },
  { re: /beverage|packaged food|\bfood\b|household (?:product|durable)|tobacco|consumer staple|personal (?:care|product)|consumer non-durable/i, theme: 'us-staples' },
  // financials
  { re: /\bbank\b|regional bank|savings|thrift/i, theme: 'us-regbanks' },
  { re: /finance|financial|insurance|reinsuranc|\binvest\b|asset manage|capital market|brokerage|mortgage|private equity/i, theme: 'us-fintech' },
  // utilities BEFORE water; then materials / comm / infra / industrials / health
  { re: /utilit|electric power|power generation|water utilit/i, theme: 'us-utilities' },
  { re: /\bwater\b/i, theme: 'us-water' },
  { re: /chemical|\bmaterials\b|\bpaper\b|packaging|forest product|coating|specialty material|metal fabric|process industr/i, theme: 'us-materials' },
  { re: /media|entertainment|broadcast|publishing|advertis|telecom|wireless|communication/i, theme: 'us-comm' },
  { re: /infrastructure|engineering (?:&|and) construction|electrical equip/i, theme: 'us-infra' },
  { re: /machinery|\bindustrial|manufactur|building material|conglomerat|commercial service|business service|distribution|producer manufacturing/i, theme: 'us-industrials' },
  { re: /health|medical|pharmac|\bdrug\b|hospital|life scien|diagnostic|therapeut|dental|managed care/i, theme: 'us-healthcare' },
  { re: /\bai\b|artificial intelligence|machine learning/i, theme: 'us-ai' },
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
  { re: /financ|nbfc|insurance|invest|capital market|housing finance|broking|amc|asset manage/i, theme: 'in-finserv' },
  { re: /data cent/i, theme: 'in-datacenter' },
  { re: /media|entertainment|broadcast|film|print|publishing|advertis/i, theme: 'in-media' },
  { re: /telecom|communication|wireless/i, theme: 'in-datacenter' },
  { re: /textile|garment|paper|packaging|plastic|rubber|glass|wood/i, theme: 'in-commodities' },
  { re: /consumer|durables|leisure|hotel|travel|airline|aviation|logistics/i, theme: 'in-consumption' },
  { re: /trading|diversified|holding|conglomerat|misc|services/i, theme: 'in-consumption' },
  { re: /pse|public sector|psu/i, theme: 'in-pse' },
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
