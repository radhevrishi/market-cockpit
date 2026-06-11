// concallHandbook.ts — Indian Concall Handbook integrated vocabulary
// Source: "The Definitive Handbook for Reading and Analysing Indian Earnings Conference Calls"
// (FY26 Edition). 19 sector decks + bullish/bearish/fraud dictionaries + 100-point scorecard.

export type SectorDeck = {
  tailwinds: string[];
  headwinds: string[];
  technical: string[];
};

// ─── CHAPTER 12: 19 SECTOR VOCABULARIES ─────────────────────────────
export const HANDBOOK_SECTORS: Record<string, SectorDeck> = {
  solar: {
    tailwinds: ['vertically integrated','TopCon premium','HJT roadmap','ITC tariff tailwind','AD/CVD favourable','ALMM moat','DCR pricing umbrella','PLI Tranche-II','captive wafer','captive ingot','low BOM cost','fixed-price silicon','bifacial gain','energy storage attached','long-tenor PPA','rooftop scaling','C&I momentum','green hydrogen pull','sold-out FY27','IPP attach rate','TopCon mix shift'],
    headwinds: ['ASP under pressure','China dump','polysilicon overhang','inventory write-down','DCR carve-out narrowed','ALMM delisting','PLI clawback','AD/CVD adverse','IPP receivable','discom haircut','line idle','yield ramp issue','module class-II downgraded','customer cancellation'],
    technical: ['ALMM','DCR','PLI','SECI','NTPC','BCD','UFLPA','AD/CVD','ISTS','PPA','EPC','IPP','GW','EBITDA per watt','cell-to-module ratio','TopCon','HJT','bifacial','polysilicon','ingot','wafer','BOM','Waaree','Premier Energies','Borosil','KPI Green'],
  },
  cdmo: {
    tailwinds: ['GLP-1 supply','oligonucleotide','peptide block','HPAPI','ADC','bioconjugate','biocatalysis','continuous-flow','microfluidics','multipurpose plant','tech transfer at scale','commercial validation','top-20 innovator','BIOSECURE pipeline','dedicated block','annuity revenue','MSA renewal','take-or-pay','KSM backward integration','asset turn ramp','EIR received','late-stage funnel','5-year contract','Phase-III commercial'],
    headwinds: ['483 observation','warning letter','import alert','OAI status','pipeline cancellation','customer destocking','pricing erosion','generic spillover','validation slip','batch failure','yield miss','qualification rejected','milestone delayed','capex idle','segment merged'],
    technical: ['CDMO','CRAMS','FDA','EMA','ANVISA','PMDA','BIOSECURE','KSM','MSA','MPP','EIR','ADC','HPAPI','GLP-1','Divis','Syngene','Piramal Pharma','Suven','Laurus','Aarti Pharmalabs','Anthem Biosciences','Sai Life','Neuland','Cohance','Jubilant Pharmova'],
  },
  railways: {
    tailwinds: ['order accretion','win ratio','executable orderbook','premium tender','indigenisation roadmap','RDSO approved','lifecycle maintenance','anchor order','capacity ramp','throughput improvement','cycle time reduction','supply chain de-risked','mix improvement','value-engineered','Vande Bharat','Kavach','Amrit Bharat'],
    headwinds: ['slippage','deferral','choke point','retention drag','variation pending','re-tender','scope creep','idle capacity','fixed-cost absorption','qualification delay','advance recall','blacklist risk','wheelset bottleneck','forging bottleneck'],
    technical: ['MoR','RDSO','CRIS','RITES','ICF','RCF','BHEL JV','Titagarh','Jupiter Wagons','Texmaco','BEML','RVNL','IRCON','KEC','RailTel','HBL','IRCTC','L1 status','LoA','EMU','wheelset','rolling stock'],
  },
  defense: {
    tailwinds: ['IDDM','captive design','lifetime support','repeat order','exclusivity clause','AON-to-contract velocity','indigenisation roadmap','offset pipeline','single-source','qualification complete','range certification','type certification','DGQA approved','export-ready','ToT operationalised','sub-system mastery','platform extensibility','Positive Indigenisation List'],
    headwinds: ['re-tender','multi-vendor split','cost-plus pressure','retention drag','qualification gap','performance shortfall','test failure','foreign content dependency','single-customer concentration','MoD receivable'],
    technical: ['AON','DAC','RFP','PIL','IDDM','DGQA','DRDO','ToT','MoD','BEL','HAL','Mazagon Dock','GRSE','Cochin Shipyard','BDL','Data Patterns','Astra Microwave','Paras Defence','MTAR','QRSAM','MRSAM','BrahMos','Akash','Pinaka','LCA Tejas','AMCA','GE F404','GE F414'],
  },
  capgoods: {
    tailwinds: ['pipeline accretion','inquiry funnel','conversion velocity','mix uplift','premium order','aftermarket pull','installed base monetisation','operating leverage','cost pass-through','value engineering','modular product','configurator-driven','capacity de-bottlenecked','capital-light expansion','indigenisation lever','energy transition exposure','CPCB IV+ pre-buy','hyperscaler orders'],
    headwinds: ['hesitation','decision delay','scope creep','fixed-price exposure','commodity squeeze','idle capacity','dumping','import pressure','variation drag','retention build'],
    technical: ['IIP capital goods','CPCB IV+','L&T','Thermax','Triveni Turbine','Cummins India','Grindwell Norton','Timken','SKF','Siemens','ABB','KSB','Praj','Ceres electrolyser','AMC','book-to-bill'],
  },
  ems: {
    tailwinds: ['design-led','build-to-spec','full-turnkey','box-build','backward integrated','component vertical','anchor customer','multi-product engagement','NPI velocity','configurator','customer-funded mould','vertically integrated PCB','surface mount line','advanced packaging','OSAT entry','ODM mix'],
    headwinds: ['build-to-print','free-issue','pass-through commodity','single-customer dependency','BOM-led growth','ramp-down','end-of-life','obsolescence','capacity overhang','low-mix-high-volume','PLI miss','clawback'],
    technical: ['ODM','EMS','NPI','PCB','BOM','OSAT','Sanand','PLI 2.0','Dixon','Kaynes','Syrma SGS','Cyient DLM','Avalon','Amber','Epack','Tata Electronics','BMS','motor controller','Kavach electronics'],
  },
  auto_ancillary: {
    tailwinds: ['CPV expansion','kit value','lifetime value','wallet share','programme win','ICE+EV agnostic','EV content','motor magnetics','casting indigenisation','BMS exposure','aftermarket pull','replacement cycle','OEM stickiness','export ramp','China+1','design-in','sole-supplier','BSG','differential gears'],
    headwinds: ['ICE-only','stranded','sunset platform','programme loss','share loss','push-out','ramp delay','RM lag','mark-down','warranty drag','recall','single-OEM dependency'],
    technical: ['CPV','LTV','BSG','BMS','Bosch','UNO Minda','Sona BLW','Motherson','Endurance','Bharat Forge','Sundram Fasteners','Suprajit','Lumax','Pricol','Stellantis','Toyoda Gosei','Tachi-S','CDP','BF Aluminiumtechnik'],
  },
  chemicals_broad: {
    tailwinds: ['anchor customer','long-term contract','z-block','MPP flexibility','feedstock security','validation complete','REACH compliant','captive feedstock','indigenised intermediate','premium block','specialty share','asset turn uplift','energy efficiency','cost moat'],
    headwinds: ['realisation pressure','destocking','capacity overhang','anti-dumping reversal','China surge','ramp delay','idle block','forex hit','anchor renegotiation','customer churn','regulatory action'],
    technical: ['MPP','REACH','z-block','SRF','Deepak Nitrite','Tata Chemicals','Gujarat Fluoro','GHCL','Dahej','BOPP','BOPET','soda ash','chlor-alkali','fluoropolymer','PTFE','DASDA','OBA','phenol','acetone','LiFePO4'],
  },
  specialty_chemicals: {
    tailwinds: ['anchor RFQ','validation batch','take-or-pay','FDF pipeline','phenolics platform','dedicated block','z-block','IP moat','switching cost','customer stickiness','premium chemistry','niche monomer','oleochemistry','single-source qualified','ANDA reference','captive intermediate','fluorination expertise','destocking abating'],
    headwinds: ['destocking','RFQ deferral','validation slip','anchor renegotiation','pricing concession','idle dedicated block','lost qualification','ANDA delay','ramp gap','capex over-run','plant disruption'],
    technical: ['RFQ','FDF','ANDA','cGMP4','HPP','PI Industries','Anupam Rasayan','Navin Fluorine','Vinati Organics','Fine Organics','Clean Science','Galaxy Surfactants','ATBS','IBB','MEHQ','anisole','Honeywell HFO','Therachem','Solis','Lote'],
  },
  textiles: {
    tailwinds: ['vertical integration','captive yarn','RMG expansion','Bangladesh shift','cotton spread normalisation','premium mix','FOB uplift','RoDTEP optimisation','technical textiles','geotextile','aquaculture nets','FTA access','sustainable cotton','organic certification','PLI MMF'],
    headwinds: ['cotton volatility','spread compression','destocking','downgrading','commodity yarn','Bangladesh return','FTA reversal','RoDTEP cut','primary-secondary mismatch'],
    technical: ['RoDTEP','RoSCTL','PLI MMF','FOB','Vardhman','Trident','Nahar','KPR Mill','Welspun Living','SP Apparels','Gokaldas Exports','Garware Technical Fibres','H&M','Walmart','Decathlon','Marks & Spencer','Target','JC Penney','Faso','Spaces'],
  },
  it_services: {
    tailwinds: ['net-new deal wins','AI-led transformation','cloud-native modernisation','vendor consolidation','broad-based growth','pyramid rebuild','fresher onboarding','pricing realisation improved','utilisation ex-trainees expanding','BFSI discretionary returning','ER&D outperforming','top-client mining','large-deal velocity','deal cycle compression','FCF conversion above 100%','hi-tech bottoming'],
    headwinds: ['ramp-downs','furloughs','mega-deal lumpiness','productivity pass-through','cost-takeout deals','discretionary deferrals','vendor rationalisation','pricing concessions','subcon spike','attrition elevated','BFSI cautious','GenAI cannibalisation','lower offshore effort','onsite cost inflation','wage hike pull-forward'],
    technical: ['CC','TCV','BFSI','Hi-tech','ADM','IO','ER&D','BPM','NPS','CSAT','Gartner MQ','Infosys','TCS','Persistent Systems','GenAI','pyramid','utilisation ex-trainees','book-to-bill'],
  },
  banks: {
    tailwinds: ['NIM expansion','granular deposits','CASA accretion','PCR build','slippage moderation','recoveries elevated','contained credit cost','retail liability traction','fee income broad-based','operating leverage','RoA expansion','tier-1 comfortable','healthy LCR','calibrated unsecured growth','secured retail outperforming','corporate book vintage strong'],
    headwinds: ['slippage spike','SMA build-up','PCR drop','NIM compression','deposit pressure','CD ratio stretched','MFI stress','unsecured stress','restructured book stress','management overlay','lumpy corporate','agri stress','credit cost guide-up','recovery shortfall','RoA pressure'],
    technical: ['NII','NIM','CASA','CD ratio','SMA-1','SMA-2','PCR','LCR','RoA','MFI','PSL','NPA','TPA','HDFC Bank','IndusInd','Kotak Mahindra','cost-to-income','slippage ratio'],
  },
  nbfc: {
    tailwinds: ['AUM compounding','granular book','vintage performance strong','Stage-3 contained','credit cost in band','NIM defended','securitisation at tight spreads','branch productivity','cross-sell ratio expanding','collection efficiency','ECL buffer build','ALM comfortable','co-lending scaling','distribution moat'],
    headwinds: ['AUM growth deceleration','Stage-3 spike','Stage-2 build-up','ECL overlay required','collection efficiency drop','borrowing cost spike','ALM mismatch','refinancing risk','bureau stress','vintage underperforming','write-off acceleration','risk weight increase'],
    technical: ['AUM','Stage-3','Stage-2','NIM','ECL','ALM','NCD','ECB','P2P','RBI','co-lending','Bajaj Finance','Shriram Finance','Five Star Business Finance','LTV','securitisation','scale-based regulation'],
  },
  consumer: {
    tailwinds: ['UVG acceleration','broad-based volume','premium-led','rural revival','MT double-digit','QC scaling','innovation contribution','direct reach expansion','mix-led GM expansion','pricing power intact','A&P investment confidence','category leadership','white space monetisation','super-premium traction'],
    headwinds: ['demand muted','rural lag','down-trading','channel inventory','promotional intensity','mass under pressure','commodity headwind','GM compression','MT moderation','QC pricing war','share loss in core','distributor reset','mix adverse','primary-secondary mismatch'],
    technical: ['UVG','A&P','GT','MT','QC','D2C','SKU','Blinkit','Zepto','Instamart','HUL','Nestle','Dabur','Marico','Colgate','Britannia','Tata Consumer','Varun Beverages','Bikaji','Honasa','Mamaearth','palm oil','copra','MAGGI','KitKat'],
  },
  hospitals: {
    tailwinds: ['occupancy ramp','ARPOB on case-mix','international patient acceleration','new unit break-even','brownfield expansion','cluster densification','premium services','cash payor mix up','doctor productivity','clinical outcomes leadership','mature unit EBITDA','cardiac and oncology mix','OPD-to-IP conversion','insurance empanelment'],
    headwinds: ['occupancy soft','ARPOB flat','ALOS up','doctor cost rising','new unit ramp delayed','scheme rate cuts','international patient muted','capex slippage','cluster losses','pharmacy margin hit','TPA stress','attrition in specialties'],
    technical: ['ARPOB','ALOS','OPD','IP','TPA','CGHS','ECHS','NABH','JCI','Apollo Hospitals','Max Healthcare','Global Health','Medanta','Manipal','Narayana','Apollo HealthCo','AHLL','BLK','EBITDA per bed'],
  },
  hotels: {
    tailwinds: ['RevPAR-ARR-led','MICE strong','wedding season buoyant','signed pipeline expansion','management contract velocity','F&B normalisation','international inbound','loyalty mix growing','direct booking share up','banquet revenue strong','same-store RevPAR double-digit','asset-light pipeline'],
    headwinds: ['ARR pressure','supply additions','occupancy normalisation','demand moderation','international muted','renovation drag','management contracts deferred','group business soft','OTA commission rising','manpower cost up','forward booking flat'],
    technical: ['ARR','RevPAR','EBITDAR','F&B','MICE','OTA','Indian Hotels','IHCL','Taj','Vivanta','SeleQtions','Ginger','qmin','ama','EIH','Oberoi','Chalet Hotels','Lemon Tree'],
  },
  infrastructure: {
    tailwinds: ['order book all-time high','robust inflows','execution acceleration','PSU payment improvement','claim recovery','net debt reduction','mobilisation advance','diversified mix','L1 position strong','bid selectivity','international order book','equipment capex enabling growth'],
    headwinds: ['working capital stretched','receivables delayed','cost overrun','legacy provisions','RoW delays','lumpy inflows','sub-contractor delay','claim disputes','mobilisation slower','forex hedge loss','international project provisioning','project hold'],
    technical: ['NHAI','PGCIL','Jal Jeevan','RoW','LOA','L1','KEC International','Kalpataru Projects','NCC','HG Infra','PNC','KNR','Ahluwalia','Va Tech Wabag','Ashoka Buildcon','SAE Towers','unbilled revenue','mobilisation advance'],
  },
  power: {
    tailwinds: ['PLF strong','merchant tariff peak','PPA signings','capacity on schedule','DISCOM receivables reducing','coal availability comfort','fuel pass-through working','hybrid projects','battery storage cost down','open access C&I','transmission commissioning','regulated capex pipeline','hydro above design energy','REC monetisation'],
    headwinds: ['DISCOM payment delay','coal constraints','imported coal blending','merchant tariff moderation','capacity slippage','hydrology adverse','wind PLF disappointment','plant outage','tariff revision pending','LPS accumulation','RDSS awaited','PPA termination'],
    technical: ['PLF','PPA','IEX','DISCOM','LPS','RDSS','REC','UMPP','Section 11','NTPC','NTPC Green','Power Grid','Tata Power','JSW Energy','Adani Power','Adani Green','NHPC','SJVN','Torrent Power','CESC','Mundra UMPP','Mytrah'],
  },
  cement: {
    tailwinds: ['EBITDA per tonne expansion','trade mix premium','NSR up','pet coke deflation','fuel cost per tonne down','rail mix up','lead distance reduced','brownfield commissioning','premium brand mix','WHRS share','green energy share','supply discipline','lead market premium','freight optimisation'],
    headwinds: ['NSR down','pricing pressure','pet coke up','freight up','monsoon impact','lead distance up','trade mix down','discounts to push volume','EBITDA per tonne compression','dealer destocking','capacity addition concentrated'],
    technical: ['NSR','EBITDA per tonne','WHRS','clinker utilisation','pet coke','UltraTech','Ambuja','ACC','Dalmia','Shree Cement','JK Cement','Birla Corp','Ramco','Heidelberg','Star Cement','Kesoram','India Cements','Sanghi','Penna','trade mix','non-trade'],
  },
};

// ─── CHAPTER 13: BULLISH KEYWORD DICTIONARY ─────────────────────────
export const HANDBOOK_BULLISH: Record<string, string[]> = {
  demand_strength: ['order book at all-time high','visibility for next 2 years','visibility for the next 4-6 quarters','demand environment remains robust','broad-based demand','demand pull from the channel','strong traction across segments','volume growth ahead of industry','secondary sales accelerating','pre-bid activity high','inquiry pipeline at all-time high','RFQ count has doubled','order book to revenue ratio at 2.5x','book-to-bill above 1.5x','fully booked through current fiscal','order book at 9-12 months of revenue','demand is structural not cyclical','multi-year demand visibility','rural demand recovery','urban demand resilient','replacement cycle has begun','penetration is still under 15 percent','demand-driven capex','customer commitments in place','pre-commissioning order book in place'],
  pricing_power: ['we have taken a price increase','price hike passed through','pricing-led recovery','asymmetric pass-through','cost-down benefit retained','we will not chase share at the cost of margin','we will defend margin','pricing discipline intact','premium pricing power','mix-led margin','premiumisation contribution','refusing orders below target margin','brand pull at the dealer level','category leadership','pricing power despite RM volatility','gross margin holding through cycle','price increase fully absorbed','dealer accepted the price hike','no resistance to price hike'],
  operating_leverage: ['operating leverage kicking in','incremental margin guidance','fixed cost absorption improving','EBITDA per tonne expanding','EBITDA per bed expanding','unit economics improving','margin to expand by 100-150 bps','cost-to-income falling','scale benefits coming through','leverage on existing assets','incremental EBITDA margin of 30%+','asset turns improving'],
  capex_capacity: ['commissioning ahead of schedule','ramp-up faster than expected','plant commissioned on time','capacity utilisation crossing 95 percent','utilisation at 90 percent','design utilisation by year 2','capacity doubling without dilution','phase 2 to follow phase 1 hitting 80% utilisation','brownfield expansion underway','debottlenecking complete','capex within budget','capex announced after customer commitments','pre-tax ROCE of 25%+ at design','payback period 3-4 years','phased capex tied to milestones','IRR of 22-25% pre-tax'],
  margin_expansion: ['EBITDA margin expansion','gross margin expanded','PAT margin at all-time high','margin in the 18-19% range','margin guidance maintained','margin improvement structural','mix shift accretive','premium SKU launches driving margin','A&P investment yielding margin','TiO2 tailwinds','RM tailwinds','cost-down flowing to margin','margin held in band'],
  working_capital: ['working capital days improving','receivable days compressed','inventory days down','cash conversion improving','OCF to EBITDA above 90%','working capital cycle compressed','WC tight at 70 days','channel inventory lean','cash collection ahead of plan','payable days extended','cash flow positive even in growth year'],
  capital_allocation: ['we walked away from valuation','EV/EBITDA paid below our hurdle','phased capex','payout ratio of X percent','buyback at intrinsic value','special dividend','we will not raise equity below cost of capital','M&A used to fill capability gap','goodwill impairment policy disclosed','incremental ROIC of 22%+','capex IRR tracked','walked away from three other targets','earn-out structure','synergy math disclosed'],
  management_quality: ['we will take full responsibility','we got this wrong','in hindsight we should have','we are recalibrating','I owe shareholders an explanation','our assumption was too aggressive','lookback accountability','last quarter we guided X we delivered Y','guidance hit within band','unchanged medium-term guidance','we under-promise and over-deliver','we will not chase growth'],
  sector_tailwinds: ['PLI is transformational','IRA tax credit math','China-plus-one tailwind','import substitution math','CPCB IV transition driving replacement','GST formalisation','RERA-led formalisation','structural multi-decade demand','regulatory tailwind','policy support','scheme disbursement accelerating','capex tailwind from government'],
  new_business: ['TCV of $1 billion plus','large deal wins','multi-year contract win','won a contract with the top 3 global','qualification cycle complete','first orders received','new molecule launched','order book under exclusive multi-year contracts','wallet share gain at top customer','new geography opened','export anchor established','anchor customer signed'],
  free_cash_flow: ['free cash flow positive','FCF generation accelerating','cumulative FCF exceeds reported PAT','cash conversion above 80%','self-funding capex','no incremental debt for capex','FCF deployed in capex','debt-free balance sheet','net cash position'],
  customer: ['top 5 customers contributed X percent','top 10 declining from Y to X','customer concentration declining','wallet share with top customer rising','multi-year customer relationships','top 20 global pharma are our customers','qualification takes 2-3 years','sticky customer base','cross-sell ratio at 4x','lifetime value per customer rising'],
  export_momentum: ['export share crossing 60 percent','US order book at $3 billion','export-led order book','global share of 30 percent','global No. 2 in salmon nets','global monopoly with 60% share','we have 60 percent global share','export ramp into the US','parent sourcing share rising'],
  cost_discipline: ['cost-down quantified','cost-to-income falling 100-200 bps','lowest-cost producer','cost leadership across cycles','fixed cost optimisation','we are the lowest cost in the industry','cost per ton lower than peers','overhead leverage','manufacturing efficiency improving'],
  order_book: ['order book composition disclosed','defence vs export vs civil break-up','book-to-bill above 1.3x','order inflows robust','order intake at all-time high','L1 position strong','mobilisation advance received','order book at 18-24 months visibility','fully booked through FY27','order book tenor of 5+ years','pre-bid pipeline strong'],
};

// ─── CHAPTER 14: BEARISH KEYWORD DICTIONARY ─────────────────────────
export const HANDBOOK_BEARISH: Record<string, string[]> = {
  demand_weakness: ['demand environment has softened','we are seeing some softness','demand has been subdued','demand has moderated','demand deferred','orders deferred','customer offtake slower','channel destocking','volumes have slipped','rural demand muted','urban demand patchy','discretionary spending soft','we are recalibrating our growth assumption','broad-based slowdown','demand pull weaker than expected','inquiry pipeline thinner','secondary sales lagging','primary sales ahead of secondary','industry-wide slowdown','macro headwinds persist','wait-and-watch mode at customers','order placement delayed'],
  pricing_pressure: ['pricing pressure in the channel','price erosion','unable to take price','price cuts to defend share','discounting in the market','aggressive pricing by competition','realization down YoY','ASP declining','competitive intensity high','pricing discipline broken','channel discounts rising','pricing actions being calibrated','dealer incentives elevated'],
  margin_compression: ['gross margin compressed','EBITDA margin under pressure','margin guidance withdrawn','cost pass-through with a lag','one-time impact on margin','mix shift to economy hurting margin','margin to recover next quarter','margin in the lower end of band','RM headwinds persisting','logistics cost up','manpower cost up','A&P investment behind launches dragging margin','operating leverage stalling'],
  working_capital: ['receivable days expanded','inventory days have risen','working capital stretched','WC cycle elongated','cash conversion has weakened','OCF to EBITDA dropped','channel inventory built up','channel financing changes','unbilled revenue growth','PSU receivables delayed','payment cycle elongated','collections lagging','receivable days expanded from 62 to 71'],
  capex_delays: ['commissioning deferred','capex slipped to next quarter','project hold','mobilisation slower','RoW delays','cost overrun','force majeure invoked','project pushed out by 1-2 quarters','utilization gradually improving','steady-state pushed out','capex elevated','industry-wide commissioning issues'],
  debt: ['debt has risen','net debt up YoY','leverage elevated','refinancing under discussion','short-term debt funding long-term assets','debt maturity bunched','covenants under review','interest cost up','rating watch negative','promoter pledging rising','working capital lines fully drawn','CP rollover under pressure'],
  management_vagueness: ['we will see how the year evolves','we remain confident','broad-based outlook positive','fundamentals remain strong','we are confident of strong second half','industry-wide phenomenon','macro headwinds','external factors','we always said there would be volatility','we will get back to you offline','directionally positive','cautiously optimistic','various cost optimization measures','pricing actions as appropriate','we are taking necessary actions','we will share more in due course','too early to comment','cannot comment at this stage','matter is sub judice','we are evaluating','work in progress','on track broadly','satisfactory progress'],
  order_book_softness: ['order intake muted','lumpy inflows','L1 wins fewer','book-to-bill below 1','bid selectivity tightened','order inflow normalising','inflows back-ended','order book flat YoY','cancellation in order book','we are being selective on bids'],
  customer_risk: ['top customer growing slower','customer concentration rising','one large customer paused','top customer destocked','customer-specific issue','churn at large customer','qualification delayed at anchor customer','wallet share with top customer down','customer financial stress'],
  inventory: ['inventory build-up','channel inventory elevated','finished goods inventory up','destocking in the channel','inventory correction underway','primary lower than secondary','inventory days rising','aging inventory'],
  forex: ['forex loss this quarter','hedge loss','unhedged exposure','INR volatility hurt margins','translation loss','forex mark-to-market hit'],
  regulatory: ['regulatory uncertainty','pending approval','awaiting clarification','USFDA observations','form 483 received','CGST notice received','state government payment delays','regulatory pricing intervention','tariff revision pending','policy delay'],
  auditor_governance: ['auditor change this year','auditor qualification','modified audit opinion','EOM in audit report','CFO has resigned','CFO transition','independent director resigned','audit committee review','governance review underway'],
  guidance_cuts: ['we are calibrating guidance','guidance revised downward','margin guidance trimmed','revenue growth to be at lower end','we are taking a more cautious view','FY guidance withdrawn','we are re-evaluating','we are recalibrating','soft H1, strong H2'],
  capacity_underutilisation: ['utilisation at 55%','sub-optimal utilisation','plant idle time','capacity ramp slower than guided','design utilisation pushed out','margin dilution from new capacity','overhead absorption weak'],
};

// ─── CHAPTER 15: FRAUD / WEAK GOVERNANCE DICTIONARY ─────────────────
export const HANDBOOK_FRAUD: Record<string, string[]> = {
  related_party: ['interco transactions','subsidiary transaction','related party in the ordinary course','arms length basis','transactions with promoter group','loans to related parties','guarantees to related parties','royalty to promoter entity','brand fee to promoter','rental from promoter family trust','group company transactions','inter-corporate deposits','ICD to group entity','advances to subsidiaries','necessary disclosures in annual report','audit committee reviews all such transactions'],
  cash_bank: ['cash balances with multiple banks','fixed deposits with overseas branches','restricted cash','lien-marked deposits','cash held as margin money','unencumbered cash','cash with foreign subsidiaries','cash repatriation pending','cash and bank reconciliation under review','inter-bank transfers in transit'],
  revenue_recognition: ['Q4 revenue spike','year-end revenue push','bill-and-hold arrangement','percentage of completion','unbilled revenue rising','channel sales at year-end','other operating income rising','extended credit to distributors','POC accounting on long projects','revenue from one-time licensing','principal vs agent classification changed','revenue from related party'],
  receivable_red_flag: ['receivable days expanded materially','debtors over 180 days rising','receivables from one customer dominant','provisioning for receivables one-time','unbilled revenue growth outpacing revenue','PSU receivable ageing extended','collections expected next quarter','receivables securitised','receivables sold to factoring partner','debtor days at 180+'],
  auditor_governance_red_flag: ['auditor resigned citing lack of information','auditor change mid-year','qualified audit opinion','emphasis of matter','auditor rotation','big-4 to non-big-4 transition','CFO resignation','multiple CFO changes','company secretary resigned','independent director resigned citing differences','whistleblower complaint disclosed','forensic audit ordered','SEBI inquiry','income tax search','ED notice'],
  promoter_stress: ['promoter pledging increased','pledge as percent of holding rising','promoter sold stake','preferential issue to promoter','promoter took personal loan','promoter LRS funds invested back','promoter family trust transactions','promoter pledge release pending','inter-se promoter transfers','promoter dividend taken in advance'],
  subsidiary_offshore: ['subsidiary in tax haven','Mauritius subsidiary','Singapore SPV','step-down subsidiary','consolidation perimeter changed','subsidiary deconsolidated','JV partner unnamed','offshore SPV for IP','offshore structure for tax efficiency','subsidiary financials not separately disclosed','goodwill on subsidiary acquisition rising'],
  inventory_asset: ['inventory days rising disproportionately','inventory write-off one-time','inventory revaluation','work-in-progress aging','capital work-in-progress aging','intangible assets capitalised','R&D capitalised aggressively','goodwill not impaired despite underperformance','asset impairment one-time','fixed asset additions without commensurate capex disclosure'],
  disclosure_avoidance: ['we will get back to you offline','matter is sub judice','cannot disclose at this stage','commercially sensitive information','we do not disclose customer names','segment disclosure not required','others segment exceeding 15%','we are evaluating disclosure','no comments at this stage','wait for the annual report','figures are subject to audit','we will clarify in due course','adjusted EBITDA with multiple add-backs','one-time items recurring every quarter'],
  accounting_policy: ['change in accounting policy','change in depreciation method','useful life of assets revised','change in revenue recognition policy','change in inventory valuation','restated prior period figures','reclassification of expenses','capitalisation policy revised','lease accounting one-off','Ind-AS transition adjustment','exceptional items frequent','forex losses always exceptional but never gains'],
  capex_opacity: ['capex announced before customer in place','future-ready capacity','strategic capex','capex for opportunities','capex split across subsidiaries','CWIP at year-end disproportionately high','capex cost per unit at top of industry','repeated cost overruns','IRR on full utilisation only','capex shifted to strategic from demand-driven','unallocated capex','EPC awarded to related party'],
  channel_sales_red_flag: ['primary sales ahead of secondary','channel stuffing concern','distributor credit extended at year-end','one-time scheme to distributors','discounts increased at quarter-end','rebates to clear inventory','inventory pushed to depots','sell-in vs sell-out gap widening','secondary not matching primary','channel financing scheme'],
  bfsi_provisioning: ['one-time provision every quarter','kitchen sinking','coverage ratio falling while GNPA rising','restructured book rising','SMA-1 and SMA-2 disclosure withdrawn','auditor-forced provisions','standard asset provision reduced','classification change from NPA to standard','restructured into standard','one-time settlement booked as recovery','security receipts replacing NPA','ARC sale at inflated valuation','inter-bank participation certificate misuse'],
};

// ─── CHAPTER 19: 100-POINT SCORECARD ─────────────────────────────────
export type ScorecardItem = {
  id: string;
  category: string;
  question: string;
  weight: number;
  positiveSignals: string[];
  negativeSignals: string[];
};

export const HANDBOOK_SCORECARD: ScorecardItem[] = [
  { id: 'management', category: 'management', question: 'Coherence, transparency, intellectual honesty; ability to discuss bad news without spin.', weight: 10, positiveSignals: ['acknowledges miss','specific numbers','consistent voice across CEO/CFO/IR','owns mistakes'], negativeSignals: ['spin','blame externalities','evasive','contradicts prior quarter'] },
  { id: 'demand', category: 'demand', question: 'Strength, breadth, and pipeline visibility of end-market demand.', weight: 10, positiveSignals: ['broad-based growth','order pipeline up','new customer wins','volume-led'], negativeSignals: ['demand muted','destocking','price-led only','deferrals'] },
  { id: 'margins', category: 'margins', question: 'Margin trajectory and credibility of mix/pricing narrative.', weight: 8, positiveSignals: ['mix improvement','operating leverage','RM tailwind passed through'], negativeSignals: ['one-time gains','margin guidance cut','competitive discounting'] },
  { id: 'capacity', category: 'capacity', question: 'Current utilisation, headroom, and expansion credibility.', weight: 6, positiveSignals: ['>85% utilisation with capex lined up','debottlenecking','phased ramp'], negativeSignals: ['<60% utilisation','idle plants','no clear ramp path'] },
  { id: 'capex', category: 'capex', question: 'Capex discipline — ROIC-positive, well-paced, not empire-building.', weight: 6, positiveSignals: ['stated asset turn','commissioning on schedule','phased outlay'], negativeSignals: ['slippage >6 months','no revenue expectation stated','diversification capex'] },
  { id: 'order_book', category: 'order_book', question: 'Order book / forward pipeline visibility and quality.', weight: 6, positiveSignals: ['book-to-bill >1','executable within 12-18m','margin-accretive wins'], negativeSignals: ['L1 stuck','cancellations','stale book'] },
  { id: 'governance', category: 'governance', question: 'Structural protections around minority shareholders. Hard cap: <4/8 caps total at 60.', weight: 8, positiveSignals: ['clean RPTs','no auditor change','no pledge','transparent subsidiary disclosure'], negativeSignals: ['auditor change','RPT escalation','promoter pledge up','SEBI/RBI query'] },
  { id: 'pricing_power', category: 'pricing_power', question: 'Ability to take price without losing volume — structural moat indicator.', weight: 6, positiveSignals: ['price hike absorbed','volume held','premiumisation'], negativeSignals: ['rollback','volume loss on hike','discounting to defend share'] },
  { id: 'cash_flow', category: 'cash_flow', question: 'Conversion of stated profits to cash — the P&L reality check.', weight: 8, positiveSignals: ['OCF/EBITDA >70%','FCF positive','net debt down'], negativeSignals: ['OCF/EBITDA <50%','receivables ballooning','factoring reliance'] },
  { id: 'working_capital', category: 'working_capital', question: 'Cash conversion cycle trend and management awareness.', weight: 6, positiveSignals: ['CCC days down','specific debtor/inventory/payable numbers','explained seasonality'], negativeSignals: ['strategic stocking','extended customer terms','deflected questions'] },
  { id: 'capital_allocation', category: 'capital_allocation', question: 'Track record and stance on deploying surplus cash — dividend, buyback, M&A, capex, debt.', weight: 8, positiveSignals: ['clear ROIC hurdle','buyback at fair value','debt paydown'], negativeSignals: ['unrelated diversification','M&A at peak multiples','cash idling'] },
  { id: 'guidance_credibility', category: 'guidance_credibility', question: 'Reliability of forward statements; hit rate on prior guidance.', weight: 6, positiveSignals: ['under-promise/over-deliver','high hit rate','quantitative ranges'], negativeSignals: ['mid-year withdrawal','repeated misses','qualitative only'] },
  { id: 'execution', category: 'execution', question: 'Delivery against stated multi-quarter plans — commissioning, launches, cost programs.', weight: 6, positiveSignals: ['plant commissioned on date','launch hit revenue mark','cost program delivered'], negativeSignals: ['serial slippage','launch deferrals','cost savings unquantified'] },
  { id: 'analyst_qa', category: 'analyst_qa', question: 'Quality of answers under unscripted pressure.', weight: 3, positiveSignals: ['specific numbers in Q&A','engages tough questions','consistent with prepared remarks'], negativeSignals: ['take offline','deflection','irritation at analysts'] },
  { id: 'risk', category: 'risk', question: 'Articulation of concentration, leverage, regulatory risk.', weight: 3, positiveSignals: ['customer concentration disclosed','covenant headroom stated','regulatory watch named'], negativeSignals: ['silent on risks','dismissive','no scenario thinking'] },
];

export const HANDBOOK_GRADING_RULES = {
  hardRules: [
    'No category may score zero in two consecutive quarters in a held position — reduce regardless of total.',
    'Governance below 4/8 caps total score at 60 (IC override required).',
    '10-point swing in one quarter must be discussed with PM.',
  ],
  bands: [
    { grade: 'A+', label: 'ANCHOR BUY', minScore: 85 },
    { grade: 'A', label: 'CORE BUY', minScore: 70 },
    { grade: 'B', label: 'SATELLITE', minScore: 55 },
    { grade: 'C', label: 'WATCHLIST', minScore: 40 },
    { grade: 'D', label: 'AVOID', minScore: 25 },
    { grade: 'F', label: 'REJECT', minScore: 0 },
  ],
};

// ─── CHAPTER 20: AI WORKFLOW RULES ─────────────────────────────────
export const HANDBOOK_AI_RULES = {
  whatAIDoesWell: [
    'Compress 100-page transcripts into structured one-page briefs',
    'Detect language drift across many quarters (softened/hardened phrases)',
    'Build capex and utilisation trackers from multiple transcripts',
    'Draft scorecard fills with cited quotes',
    'Compare tone across distant quarters (Q1FY24 vs Q1FY26)',
    'Extract and tabulate guidance statements with hit/miss tagging',
  ],
  whatAIDoesPoorly: [
    'Fabricates numbers not in the transcript',
    'Confuses standalone vs consolidated vs subsidiary figures',
    'Misses Indian fiscal-year conventions without prompting',
    'Cannot reliably reconcile transcript claims to results PDF without help',
    'False sense of completeness — erodes analyst skill if unverified',
    'Weak on inferring causes (RBI action, exec exit) unless directly evidenced',
  ],
  promptPatterns: [
    'Always require verbatim quote + paragraph/page citation per claim',
    'Mandate [not disclosed] / [ND] / SILENT for missing data — no invention',
    'Force Indian FY conventions (Q1 = Apr-Jun)',
    'Distinguish CEO / CFO / IR voice',
    'Demand confidence ratings (HIGH/MEDIUM/LOW) per item',
    'Output as markdown tables for tracker prompts',
    'Treat AI scorecard fills as drafts requiring human override',
  ],
  verificationSteps: [
    '1. HUMAN TRIAGE (10 min): skim, tag NEW/EXISTING/WATCHLIST/IGNORE',
    '2. AI SUMMARISATION (5 min): one-page brief',
    '3. HUMAN VERIFICATION (15 min): cross-check every number vs PDF',
    '4. AI SCORING (5 min): scorecard auto-fill',
    '5. HUMAN OVERRIDE (15 min): adjust any category >2 pts, document rationale',
    '6. PORTFOLIO ACTION: PM call',
  ],
};

// ─── AGGREGATE BANK FOR CLASSIFIER USE ───────────────────────────
// Flat keyword bank suitable for the classifier in concallClassifier.ts.
// Combines: sector tailwinds, sector headwinds, bullish phrases, bearish phrases, fraud phrases.
const flatSector = (key: 'tailwinds' | 'headwinds' | 'technical'): string[] => {
  const out: string[] = [];
  for (const s of Object.values(HANDBOOK_SECTORS)) out.push(...s[key]);
  return out;
};

export const HANDBOOK_BANK: Record<string, string[]> = {
  hb_sector_tailwinds: flatSector('tailwinds'),
  hb_sector_headwinds: flatSector('headwinds'),
  hb_sector_technical: flatSector('technical'),
  hb_bullish_demand: HANDBOOK_BULLISH.demand_strength,
  hb_bullish_pricing: HANDBOOK_BULLISH.pricing_power,
  hb_bullish_margin: HANDBOOK_BULLISH.margin_expansion,
  hb_bullish_capex: HANDBOOK_BULLISH.capex_capacity,
  hb_bullish_wc: HANDBOOK_BULLISH.working_capital,
  hb_bullish_capalloc: HANDBOOK_BULLISH.capital_allocation,
  hb_bullish_management: HANDBOOK_BULLISH.management_quality,
  hb_bullish_orderbook: HANDBOOK_BULLISH.order_book,
  hb_bearish_demand: HANDBOOK_BEARISH.demand_weakness,
  hb_bearish_pricing: HANDBOOK_BEARISH.pricing_pressure,
  hb_bearish_margin: HANDBOOK_BEARISH.margin_compression,
  hb_bearish_wc: HANDBOOK_BEARISH.working_capital,
  hb_bearish_capex: HANDBOOK_BEARISH.capex_delays,
  hb_bearish_management_vagueness: HANDBOOK_BEARISH.management_vagueness,
  hb_bearish_orderbook: HANDBOOK_BEARISH.order_book_softness,
  hb_bearish_guidance_cuts: HANDBOOK_BEARISH.guidance_cuts,
  hb_fraud_rpt: HANDBOOK_FRAUD.related_party,
  hb_fraud_receivable: HANDBOOK_FRAUD.receivable_red_flag,
  hb_fraud_auditor: HANDBOOK_FRAUD.auditor_governance_red_flag,
  hb_fraud_promoter_stress: HANDBOOK_FRAUD.promoter_stress,
  hb_fraud_disclosure: HANDBOOK_FRAUD.disclosure_avoidance,
  hb_fraud_capex_opacity: HANDBOOK_FRAUD.capex_opacity,
  hb_fraud_channel: HANDBOOK_FRAUD.channel_sales_red_flag,
};

export const HANDBOOK_STATS = {
  sectors: Object.keys(HANDBOOK_SECTORS).length,
  bullishCategories: Object.keys(HANDBOOK_BULLISH).length,
  bearishCategories: Object.keys(HANDBOOK_BEARISH).length,
  fraudCategories: Object.keys(HANDBOOK_FRAUD).length,
  scorecardItems: HANDBOOK_SCORECARD.length,
  totalScoreWeight: HANDBOOK_SCORECARD.reduce((s, i) => s + i.weight, 0),
};
