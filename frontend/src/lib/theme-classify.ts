// ═══════════════════════════════════════════════════════════════════════════
// THEME CLASSIFIER (zzz485) — map ANY stock to its best-fit rotation theme from
// the SECTOR / INDUSTRY tag every Technicals & Multibagger row already carries.
// Keyword-based, so it keeps working for years and for stocks added in future —
// no per-ticker maintenance. Returns a theme id from theme-universe, or null when
// nothing fits (those land in an "Other" bucket the user can ask us to map).
// ═══════════════════════════════════════════════════════════════════════════
import { TICKER_OVERRIDE, type ThemeRegion } from './theme-universe';

type Rule = { re: RegExp; theme: string };

// Checked in order; first match wins. Industry (finer) is matched before sector.
// ═══════════════════════════════════════════════════════════════════════════
// THE US ENGINE'S OWN SECTOR WORDS  (zzz652)
//
// A third of the US bench — 31 of 93 names — matched no theme at all, and the
// reason was not that the classifier is bad at its job. The US rules below are
// written against LONG industry strings, the kind Yahoo returns: "Software—
// Infrastructure", "Semiconductors & Semiconductor Equipment". The US grader,
// however, reuses the Indian sector vocabulary and stamps every row with a
// SHORT label — "IT", "FMCG", "Consumer", "Electronics", "Capital Goods" —
// and `industry` is undefined on every single one of them. So ORCL, SNOW and
// GWRE arrived carrying the word "IT", which matches nothing in a list built
// around the word "software", and fell out of the confluence read entirely.
//
// These rules sit FIRST so an exact engine label is never reinterpreted by a
// looser rule further down, the same ordering the Indian NSE vocabulary already
// uses. They are anchored (^...$) because these are complete labels, not
// fragments of prose: matching "IT" loosely inside a sentence would classify
// half the field as software.
//
// The mapping is deliberately COARSE. "IT" does not tell you whether a company
// is cloud, cybersecurity or plain software, so it resolves to the broad
// software theme rather than guessing at a narrower one — a name in roughly the
// right neighbourhood is useful, and a name confidently in the wrong one is
// worse than no answer. Anything carrying a real industry string still matches
// the precise rules below, because `industry` is tried before `sector`.
const US_ENGINE_VOCAB: Rule[] = [
  { re: /^it$|^information technology$|^tech(nology)?$/i, theme: 'us-software' },
  { re: /^electronics?$|^hardware$|^electrical equipment$/i, theme: 'us-semis' },
  { re: /^fmcg$|^consumer staples?$|^food(\s*&?\s*beverages?)?$/i, theme: 'us-staples' },
  { re: /^consumer$|^consumer discretionary$|^retail(ing)?$/i, theme: 'us-condisc' },
  { re: /^capital goods$|^industrials?$|^manufacturing$|^machinery$/i, theme: 'us-industrials' },
  { re: /^healthcare$|^health care$|^pharma(ceuticals?)?$|^life sciences$/i, theme: 'us-healthcare' },
  // NOTE: no rule for a bare "Financials" / "BFSI". The only financial theme
  // on the board is Regional Banks, and routing an asset manager or an insurer
  // there would be confidently wrong — which is worse than leaving it
  // unmatched and saying so on the card.
  { re: /^energy$|^oil\s*&?\s*gas$/i, theme: 'us-energy' },
  { re: /^power$|^utilities$|^electric utilities$/i, theme: 'us-utilities' },
  { re: /^materials?$|^metals?(\s*&?\s*mining)?$|^chemicals?$|^commodities$/i, theme: 'us-materials' },
  { re: /^real estate$|^realty$/i, theme: 'us-reit' },
  { re: /^telecom(munications?)?$|^communication services?$|^media$/i, theme: 'us-comm' },
  { re: /^transport(ation)?$|^logistics$|^shipping$/i, theme: 'us-transport' },
];

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
  { re: /\boil\b|\bgas\b|petroleum|(?<!non-)energy minerals|refin|pipeline|drilling|oilfield/i, theme: 'us-energy' },
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
  // real estate BEFORE financials. NB: "investment trust" removed — it wrongly
  // caught unit-investment-trust ETFs (SPY/QQQ) and oil royalty trusts.
  { re: /real estate|\breit\b|real estate investment|property (?:trust|manage|developer)|reits?\b/i, theme: 'us-reit' },
  // broad consumer
  { re: /retail|apparel|footwear|luxury goods|department store|specialty (?:retail|store)|discount store|supermarket|grocery/i, theme: 'us-retail' },
  { re: /restaurant|\bhotel|leisure|casino|resort|cruise|\btravel|lodging|recreation|home improvement|consumer discretionary|consumer services|consumer durable|automotive (?:retail|dealer|part)/i, theme: 'us-condisc' },
  { re: /beverage|packaged food|\bfood\b|household (?:product|durable)|tobacco|consumer staple|personal (?:care|product)|consumer non-durable/i, theme: 'us-staples' },
  // financials
  { re: /\bbanks?\b|regional bank|savings|thrift/i, theme: 'us-regbanks' },
  { re: /finance|financial|insurance|reinsuranc|\binvest\b|asset manage|capital market|brokerage|mortgage|private equity/i, theme: 'us-fintech' },
  // utilities BEFORE water; then materials / comm / infra / industrials / health
  { re: /utilit|electric power|power generation|water utilit/i, theme: 'us-utilities' },
  { re: /\bwater\b/i, theme: 'us-water' },
  { re: /chemical|\bmaterials\b|\bpaper\b|packaging|forest product|coating|specialty material|metal fabric|process industr|\bsteel\b|\biron\b|alumin[iu]um|\bmining\b|non-energy mineral|industrial metal/i, theme: 'us-materials' },
  { re: /media|entertainment|broadcast|publishing|advertis|telecom|wireless|communication/i, theme: 'us-comm' },
  { re: /infrastructure|engineering (?:&|and) construction|electrical equip/i, theme: 'us-infra' },
  { re: /machinery|\bindustrial|manufactur|building material|conglomerat|commercial service|business service|distribution|producer manufacturing/i, theme: 'us-industrials' },
  { re: /health|medical|pharmac|\bdrug\b|hospital|life scien|diagnostic|therapeut|dental|managed care/i, theme: 'us-healthcare' },
  { re: /\bai\b|artificial intelligence|machine learning/i, theme: 'us-ai' },
  // Broad tech catch-alls LAST, and split correctly: "Electronic Technology" is
  // the semis/hardware sector; "Technology Services" is overwhelmingly SOFTWARE /
  // internet / IT — it must NOT dump into Semiconductors (that made 87 software
  // names show as chips). Anything still unmatched falls to the sector bucket.
  { re: /electronic technology|electronic (?:component|equipment)|computer (?:hardware|peripheral|storage)|networking equipment/i, theme: 'us-semis' },
  { re: /technology services|internet software|it (?:service|consulting)|packaged software|information technology|software|computer services/i, theme: 'us-software' },
];

// zzz631 — NSE'S OWN MACRO-INDUSTRY VOCABULARY, FIRST.
//
// India rows carry no sector of their own, so the industry now comes from the
// nse-ticker-universe blob — which uses NSE's fixed macro-industry names. Two
// of them fell through every rule below and left the biggest groups on the
// bench unclassified:
//
//   "Healthcare"                 — matched neither the pharma rule (which wants
//                                  the word "pharma") nor the hospitals rule
//                                  (which wants "healthcare services").
//   "Fast Moving Consumer Goods" — does not contain the string "fmcg", so it
//                                  fell past the FMCG rule into the generic
//                                  consumer catch-all.
//
// These are checked first because they are EXACT source vocabulary rather than
// keyword guesses. Healthcare resolves to pharma as the majority case for this
// universe; a hospital chain is corrected by TICKER_OVERRIDE, which is what
// that map is for.
const IN_NSE_VOCAB: Rule[] = [
  // "Automobile and Auto Components" was landing in EMS, because the EMS rule
  // matches the word "component" and is tried first. Every auto ancillary in
  // the book was being called an electronics manufacturer.
  { re: /^automobile and auto components?$/i, theme: 'in-auto' },
  // "Construction Materials" is cement and its neighbours; it was falling past
  // the cement rule (which wants "building material") into capital goods.
  { re: /^construction materials?$/i, theme: 'in-cement' },
  { re: /^fast moving consumer goods$/i, theme: 'in-fmcg' },
  { re: /^healthcare$/i, theme: 'in-pharma' },
  { re: /^consumer services$/i, theme: 'in-consumption' },
  { re: /^oil gas .*fuels?$/i, theme: 'in-energy' },
  { re: /^forest materials$/i, theme: 'in-commodities' },
  { re: /^media entertainment/i, theme: 'in-media' },
];

// zzz632 — YAHOO'S VOCABULARY, which is what now carries the long tail.
//
// The industries for micro-caps come from Yahoo, whose taxonomy is finer than
// NSE's and phrased differently — "Confectioners", "Tools & Accessories",
// "Utilities—Regulated Electric", "Packaged Foods", "Building Products &
// Equipment". Testing those against the keyword rules below showed a string of
// them matching NOTHING, which would have put the very names this work exists
// to rescue straight back into "Unclassified". These are explicit because they
// are exact source vocabulary, not guesses, and they run before the keyword
// rules so a fine label is never swallowed by a coarse one.
const IN_YAHOO_VOCAB: Rule[] = [
  { re: /confectioner|packaged food|food distribution|farm product|beverages|household & personal|tobacco|agricultural input/i, theme: 'in-fmcg' },
  { re: /utilities/i, theme: 'in-power' },
  { re: /luxury good|apparel (?:manufacturing|retail)|footwear|specialty retail|department store|internet retail|home improvement retail|auto & truck dealership/i, theme: 'in-retail' },
  { re: /tools & accessories|metal fabrication|industrial distribution|building products|electrical equipment|specialty industrial machinery|engineering & construction|conglomerates|business equipment|security & protection/i, theme: 'in-capgoods' },
  { re: /auto parts|auto manufacturers|recreational vehicles|tires/i, theme: 'in-auto' },
  { re: /drug manufacturers|biotechnology|pharmaceutical/i, theme: 'in-pharma' },
  { re: /medical (?:care facilities|devices|instruments|distribution)|diagnostics & research|health information/i, theme: 'in-hospitals' },
  { re: /^banks|banks[—-]/i, theme: 'in-bank' },
  { re: /capital markets|asset management|insurance|credit services|financial data|mortgage finance|financial conglomerates/i, theme: 'in-finserv' },
  { re: /information technology services|software[—-]|computer hardware|consumer electronics/i, theme: 'in-it' },
  { re: /electronic component|semiconductor|electronics & computer distribution|scientific & technical instrument/i, theme: 'in-ems' },
  { re: /oil & gas|coking coal|thermal coal|uranium/i, theme: 'in-energy' },
  { re: /real estate|^reit/i, theme: 'in-realty' },
  { re: /building materials|cement/i, theme: 'in-cement' },
  { re: /marine shipping|integrated freight|railroads|airports & air services|trucking|airlines/i, theme: 'in-ports' },
  { re: /telecom services|communication equipment/i, theme: 'in-datacenter' },
  { re: /entertainment|broadcasting|advertising agencies|publishing|electronic gaming/i, theme: 'in-media' },
  { re: /textile manufacturing|paper & paper products|packaging & containers|rubber|lumber & wood/i, theme: 'in-commodities' },
  { re: /specialty chemicals|^chemicals$/i, theme: 'in-chemicals' },
  { re: /aerospace & defense/i, theme: 'in-defence' },
  { re: /solar|renewable/i, theme: 'in-renewables' },
  { re: /restaurants|lodging|resorts & casinos|travel services|leisure|education & training|personal services|staffing & employment|specialty business services|consulting services|waste management|furnishings, fixtures|home & personal products/i, theme: 'in-consumption' },
  { re: /steel|aluminum|copper|gold|other industrial metals|coking/i, theme: 'in-metal' },
];

const IN_RULES: Rule[] = [
  { re: /software|it services|information technology|\bit - software\b|saas/i, theme: 'in-it' },
  { re: /electronic|\bems\b|contract manufactur|\bcomponent|it - hardware|computer hardware|\bhardware\b|semiconduct/i, theme: 'in-ems' },
  { re: /defen[cs]e|aerospace|shipbuild|explosive/i, theme: 'in-defence' },
  { re: /rail|wagon|locomotive/i, theme: 'in-railways' },
  { re: /power|electric util|transmission|transformer|energy - power|electrical equip|switchgear|\bcables?\b|\bwires?\b|electric equipment/i, theme: 'in-power' },
  { re: /renewable|solar|wind (?:energy|power)|green (?:energy|hydrogen)/i, theme: 'in-renewables' },
  { re: /capital good|engineering|machinery|industrial|infrastructure develop|construction - civil|producer manufacturing|fastener|bearing|abrasive|industrial product|\bepc\b|construction & engineering/i, theme: 'in-capgoods' },
  { re: /oil|gas|petroleum|refin|energy|coal/i, theme: 'in-energy' },
  { re: /steel|metal|aluminium|mining|\biron\b|zinc|\bcopper/i, theme: 'in-metal' },
  { re: /chemical|fertiliz|specialty chem|agrochem|process industr/i, theme: 'in-chemicals' },
  { re: /pharma|\bdrug\b|healthcare - (?:pharma|drug)|life scien/i, theme: 'in-pharma' },
  { re: /hospital|healthcare (?:services|facilit)|diagnostic|\bmedical\b/i, theme: 'in-hospitals' },
  { re: /fmcg|consumer staple|\bfood\b|beverage|personal (?:care|product)|household|tobacco|cigarette|\bsugar\b|\bagro\b|edible oil|dairy/i, theme: 'in-fmcg' },
  { re: /auto|vehicle|automobile|tyre|auto (?:anc|part)/i, theme: 'in-auto' },
  { re: /realty|real estate|property|housing develop/i, theme: 'in-realty' },
  { re: /cement|building material|other construction material/i, theme: 'in-cement' },
  { re: /retail|apparel|footwear|jewel|gems|diamond|bullion|restaurant|qsr|discretionary/i, theme: 'in-retail' },
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
  // Low-priority fallback: bare "Construction" / "Infrastructure" / "Civil" that
  // no finer rule caught (cement & construction-material already matched above).
  { re: /\bconstruction\b|infrastructure|\bcivil\b|\bbuilder/i, theme: 'in-capgoods' },
];

// Classify a stock into a theme id. A curated TICKER_OVERRIDE wins first (fixes the
// famous names the coarse sector tag mislabels), then the sector/industry keyword
// rules (industry is the finer tell, tried before the broader sector).
export function classifyTheme(sector: string | undefined | null, industry: string | undefined | null, region: ThemeRegion, ticker?: string | null): string | null {
  if (ticker) { const ov = TICKER_OVERRIDE[ticker.toUpperCase().replace(/\.(NS|BO)$/, '').trim()]; if (ov) return ov; }
  const rules = region === 'us' ? [...US_ENGINE_VOCAB, ...US_RULES] : [...IN_NSE_VOCAB, ...IN_YAHOO_VOCAB, ...IN_RULES];
  const ind = (industry || '').toString();
  const sec = (sector || '').toString();
  for (const text of [ind, sec]) {
    if (!text.trim()) continue;
    for (const r of rules) if (r.re.test(text)) return r.theme;
  }
  return null;
}
