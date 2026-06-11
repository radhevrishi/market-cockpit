// concallKeywords.ts — comprehensive concall vocabulary bank.
// 2000+ terms organized by category/sector/tone for scalable extraction.
// Each category supports keyword matching + value extraction.

export type KwBank = Record<string, string[]>;

/* ─── DOMAIN CATEGORIES ─── */
export const CAPACITY: string[] = [
  'capacity utilization','utilization rate','capacity utilisation','operating rate','running rate','asset sweat','capacity ramp',
  'effective utilization','utilization level','utilization run rate','load factor','capacity load','plant utilization','run rate',
  'capacity in place','installed capacity','installed base','rated capacity','nameplate capacity','operational capacity',
  'effective capacity','design capacity','available capacity','peak capacity','sustained capacity','steady-state capacity',
  'total capacity','aggregate capacity','combined capacity','gross capacity','net capacity','manufacturing capacity',
  'production capacity','plant capacity','line capacity','plant 1','plant 2','plant 3','plant 4','plant 5',
  'unit 1','unit 2','unit 3','unit 4','phase 1','phase 2','phase 3','phase i','phase ii','phase iii',
  'capacity expansion','capacity addition','capacity ramp-up','rampup','ramp-up','ramp up','ramped up','ramping',
  'capacity increase','capacity build-out','capacity buildup','capacity build out','capacity buildout','capacity-led growth',
  'modular capacity','marginal capacity','bottleneck removal','debottleneck','debottlenecking','de-bottleneck',
  'capacity creep','brownfield expansion','brownfield capacity','brownfield project','brownfield investment',
  'greenfield','greenfield expansion','greenfield project','greenfield investment','greenfield capex',
  'new plant','new facility','new unit','new line','new factory','new shop floor','new shop',
  'sister plant','captive plant','satellite plant','annex','annexe','extension wing','contiguous expansion',
  'MW','GW','MWp','MWh','GWh','KW','kVA','MVA','HP','horsepower','tonnes','tons','metric tons','tonnage','MTPA','TPA','MT',
  'kgs','kilograms','litres','liters','barrels','cubic metres','cubic meters','sqft','sqm','square feet','square meters',
  'lakh','lakhs','crore','crores','million','billion','units','pieces','SKUs',
  'commissioning','commissioned','commission','commissioning timeline','operational by','came online','went live',
  'go live','gone live','came on stream','came onstream','start of production','SOP','first production','commercial production',
  'COD','commercial operation date','CoD','beneficial occupancy','ready for use','ready for commissioning',
  'mechanical completion','mechanical readiness','MC','provisional acceptance','final acceptance','final completion',
];

export const CAPEX: string[] = [
  'capex','capital expenditure','capital outlay','capital spend','capital allocation','capital deployment','capital plan',
  'capex plan','capex outlay','capex programme','capex program','capex spend','capex guidance','capex commitment','capex pipeline',
  'capex intensity','capex/sales','capex to sales','growth capex','maintenance capex','strategic capex','digital capex',
  'IT capex','automation capex','sustaining capex','expansion capex','growth investment','capex cycle','capex burn',
  'planned capex','announced capex','approved capex','board approved capex','board-approved','sanctioned capex',
  'capitalised','capitalized','capitalisation','capitalization','depreciation step-up','depreciation hit',
  'cwip','capital work in progress','capital work-in-progress','work in progress','asset under construction','AUC',
  'pre-operative','pre-operative expense','pre-operative expenses','pre-commencement','pre-production',
  'capacity capex','de-bottleneck capex','debottleneck capex','expansion capex','greenfield capex','brownfield capex',
  'land acquisition','land purchase','land cost','site acquisition','plot acquisition','plot purchase',
  'machinery procurement','plant and machinery','P&M','equipment cost','equipment procurement','equipment purchase',
  'civil works','civil construction','foundation work','structural work','MEP','mechanical electrical plumbing',
  'erection','installation','commissioning cost','startup cost','pre-operating cost',
  'CSR capex','ESG capex','green capex','renewable capex','clean tech capex','digital transformation capex',
  'phase 1 capex','phase 2 capex','phase 3 capex','tranche 1','tranche 2','tranche 3','first tranche','second tranche',
  'INR crores','INR cr','Rs cr','Rs crores','₹ cr','₹ crores','USD million','USD mn','million dollars','crore rupees',
];

export const DEMAND: string[] = [
  'order book','orderbook','order intake','order inflow','order win','order received','order booked','orders worth',
  'orders received','orders placed','orders confirmed','orders secured','orders in hand','firm orders','open orders',
  'backlog','book-to-bill','book to bill','book/bill','b2b','book-bill','order pipeline','pipeline','order pipeline robust',
  'enquiries','enquiry','inquiries','inquiry','RFQ','RFP','tender','tendering','tenders','bid','bidding','letter of intent','LOI',
  'letter of award','LOA','letter of commitment','term sheet','MOU','memorandum of understanding','definitive agreement',
  'frame agreement','framework agreement','master agreement','master supply agreement','MSA','long-term agreement','LTA',
  'long-term contract','LTC','multi-year contract','5-year contract','3-year contract','7-year contract','10-year contract',
  'preferred supplier','approved vendor','vendor approved','vendor approval','customer approval','PPAP','part approval',
  'design win','design wins','design awarded','model win','program win','program award','program ramp','model ramp',
  'demand environment','demand outlook','demand visibility','demand pipeline','demand scenario','demand seems','demand looks',
  'demand remains','demand continues','demand has been','demand is','demand will','demand stays','demand will be','demand will remain',
  'demand picking up','demand softening','demand weakening','demand strengthening','demand recovering','demand resilient',
  'higher demand','strong demand','robust demand','weak demand','soft demand','tight demand','sluggish demand','healthy demand','steady demand',
  'volume guidance','volume growth','volume ramp','volume traction','tonnage growth','tonnage ramp','unit growth',
  'channel demand','channel pull','channel inventory','channel destocking','channel restocking','dealer offtake','dealer push',
  'export demand','domestic demand','overseas demand','international demand','global demand','western demand','asian demand',
  'OEM demand','aftermarket demand','industrial demand','consumer demand','government demand','infra demand',
  'project pipeline','order pipeline of','RFP win','RFP pipeline','indicative orders','POs received','PO inflow',
  'L1 order','L1 status','L1 walk-away','L2 status','technical evaluation','financial evaluation',
];

export const MARGINS: string[] = [
  'EBITDA margin','ebitda margin','EBITDA','operating margin','operating margins','EBIT margin','ebit margin',
  'gross margin','gross margins','PAT margin','pat margin','net margin','net profit margin','contribution margin',
  'segment margin','segment margins','blended margin','steady-state margin','steady state margin','full-cycle margin',
  'margin expansion','margin contraction','margin compression','margin trajectory','margin profile','margin walk',
  'margin guidance','margin outlook','margin target','margin band','margin range','margin floor','margin ceiling',
  'pricing','pricing power','pricing discipline','pricing environment','pricing pressure','pricing tailwind','pricing headwind',
  'pass through','pass-through','price pass-through','cost pass-through','tariff','tariff revision','price hike','price increase',
  'price cut','price reduction','price erosion','price stability','realization','realisation','net realization','blended realisation',
  'ASP','average selling price','unit realisation','per-unit realisation','per unit realization',
  'mix','product mix','customer mix','geography mix','channel mix','export mix','premium mix','premium-mix',
  'value added','high-margin','low-margin','rich mix','poor mix','margin accretive','margin dilutive','margin neutral',
  'raw material','raw materials','RM cost','rm cost','RM price','rm price','input cost','input cost inflation','input cost deflation',
  'commodity','commodity price','commodity tailwind','commodity headwind','crude','copper','aluminium','aluminum','zinc','nickel',
  'iron ore','coking coal','thermal coal','natural gas','HRC','CRC','steel price','cement price','poly silicon','polysilicon',
  'feed cost','feedstock','API cost','intermediate cost','solvent cost','catalyst cost','additive cost',
  'operating leverage','financial leverage','cost leverage','fixed cost leverage','variable cost','fixed cost','overhead',
  'employee cost','wage','wages','salary','wage inflation','manpower cost','headcount','headcount addition','attrition',
  'other expenses','other operating expenses','OPEX','opex','S&M cost','selling expense','marketing spend','A&P spend',
  'depreciation','amortisation','amortization','impairment','goodwill impairment','intangible amortisation',
];

export const GUIDANCE: string[] = [
  'guidance','guidance for','guided','we expect','we expect to','we are confident','we are targeting','we target','we aim',
  'targets','target','outlook','forward guidance','medium-term guidance','near-term guidance','full-year guidance',
  'maintain guidance','reiterate','reaffirm','revise upward','revise downward','upgrade guidance','downgrade guidance',
  'beat guidance','below guidance','in line with guidance','exceed guidance','ahead of guidance','better than guidance',
  'FY26','FY27','FY28','FY29','FY30','H1','H2','Q1','Q2','Q3','Q4','Q1FY','Q2FY','Q3FY','Q4FY','first half','second half',
  'fiscal','full year','FY24','FY25','last year','last quarter','previous quarter','same quarter last year','YoY','QoQ',
  'sequential','sequential growth','sequential decline','annualised','annualized','run rate','annual run rate','ARR',
  'medium-term','medium term','long-term','long term','near-term','near term','short-term','short term','this year','next year',
  'over the next 2 years','over the next 3 years','by FY27','by FY28','by FY29','by FY30','by year end','exit FY',
  'visibility','high visibility','strong visibility','multi-year visibility','medium-term visibility','revenue visibility',
  'volume visibility','order visibility','project visibility','demand visibility',
  'steady state','steady-state','run-rate','steady-state run rate','steady state margin','steady state ROCE',
  'structural','structurally higher','structural shift','structural change','transformational','strategic shift',
  'inflection','inflection point','inflexion','inflexion point','take off','takeoff','S-curve','J-curve','hockey stick',
  'plateau','consolidation','consolidating','asymptote','asymptotic',
];

export const RISK_FLAGS: string[] = [
  'one-off','one off','one-time','one time','exceptional','exceptional item','non-recurring','exceptional cost','exceptional gain',
  'lumpy','choppy','volatile','volatility','soft patch','softness','soft start','slow start','sluggish start',
  'deferred','deferment','deferral','delayed','delay','slipped','slippage','pushed out','push-out','pushed back','rescheduled',
  'shifted','rephased','rephasing','slipped quarter','slipped to next year',
  'headwind','headwinds','challenging','challenging quarter','challenging year','difficult quarter','tough quarter',
  'weaker than expected','below expectations','below internal target','missed','miss','disappointed','disappointing',
  'pressure','pressured','pressurised','pressurized','margin pressure','demand pressure','volume pressure',
  'provision','provisioning','provision for','additional provision','impairment','impaired','goodwill write-off',
  'write-off','writeoff','write off','write-down','writedown','write down','de-recognition','derecognition',
  'related party','RPT','intercompany','interco','subsidiary transaction','associate transaction','RPT growth',
  'auditor','auditor change','CFO change','CEO change','CXO change','management churn','management change',
  'caveat','qualified opinion','EOM','emphasis of matter','adverse opinion','disclaimer of opinion',
  'investigation','SEBI investigation','SEBI order','regulatory action','regulatory inquiry','SEC investigation',
  'enquiry','litigation','litigation update','tax demand','tax notice','GST notice','income tax order',
  'show cause','show-cause notice','show cause notice','SCN','penalty','fine','adverse order',
  'contingent liability','contingent assets','off balance sheet','off-balance-sheet','OBS exposure','guarantees given',
  'receivable days','DSO','days sales outstanding','receivable stretch','receivable build','receivable bloat',
  'inventory days','DIO','days inventory outstanding','inventory build','inventory build-up','inventory overhang','stock pile',
  'working capital','working capital stretch','working capital intensity','WC cycle','negative WC','positive WC','WC release',
];

/* ─── SECTOR DECKS ─── */
export const SECTOR_PHARMA: string[] = [
  'FDA','USFDA','EU GMP','EUGMP','WHO GMP','WHO-GMP','PIC/S','ANVISA','TGA','MHRA','PMDA','health canada','korean MFDS',
  'ANDA','ANDA filing','ANDA approval','ANDA pending','para IV','para 4','first to file','FTF','first-to-file',
  'DMF','drug master file','CMC','common master file','CEP','certificate of suitability','VMF','validation master file',
  'NCE','new chemical entity','NDA','new drug application','NDA filing','510k','510(k)','PMA','pre-market approval',
  'BLA','biologics license application','biosimilar','biosimilar filing','biosimilar approval',
  'cGMP','GMP','cGMP compliance','GMP non-compliance','GMP audit','GMP inspection','pre-approval inspection','PAI',
  '483','form 483','FDA 483','warning letter','WL','warning letters','import alert','OAI','official action indicated',
  'VAI','voluntary action indicated','NAI','no action indicated','EIR','establishment inspection report',
  'recall','class I recall','class II recall','class III recall','consent decree','consent decree of permanent injunction',
  'patent cliff','patent expiry','patent expiration','LOE','loss of exclusivity','genericization','generic erosion',
  'authorized generic','AG','para iv','litigation','patent litigation','patent infringement','patent invalidity','patent challenge',
  'china+1','china plus one','PLI for pharma','PLI scheme','PLI approval','API PLI','formulation PLI',
  'API','active pharmaceutical ingredient','intermediate','KSM','key starting material','drug substance','DS','DP','drug product',
  'CDMO','CMO','contract manufacturing','CRO','clinical research organisation','clinical trial','phase 1','phase 2','phase 3',
  'sterile','injectable','parenteral','vial','pre-filled syringe','PFS','oral solid','oral solid dosage','OSD','OTC','RX','ethical',
  'opthalmic','ophthalmic','derma','dermatology','onco','oncology','CNS','CVS','diabetic','cardiac','respiratory','GI',
  'API export','formulation export','export market','regulated market','semi-regulated','rest of world','RoW',
];

export const SECTOR_SOLAR: string[] = [
  'PLI','PLI for solar','ALMM','approved list of models and manufacturers','approved list of models','RPO','renewable purchase obligation',
  'safeguard duty','BCD','basic customs duty','anti-dumping','antidumping duty','ADD','anti-dumping duty','protective duty',
  'CBIC','DGTR','module','polysilicon','poly-silicon','wafer','ingot','cell','solar cell','PV cell','PV module','solar module',
  'mono PERC','TOPCon','HJT','tandem','bifacial','monofacial','heterojunction','passivated emitter rear contact','passivated emitter','solar grade',
  'GW','MW','MWp','kW','GWh','MWh','PPA','power purchase agreement','tariff','levelized tariff','LCOE','levelised cost of energy',
  'open access','captive','captive solar','rooftop','utility scale','C&I','commercial industrial','residential','EPC','BOS','balance of system',
  'tracker','single-axis','dual-axis','fixed tilt','inverter','string inverter','central inverter','battery storage','BESS','battery energy storage',
  'IBR','inter-state transmission','intra-state transmission','RE-ISTS','ISTS','PGCIL','transmission charges','wheeling charges',
  'CFA','central financial assistance','MNRE','ministry of new and renewable energy','SECI','solar energy corporation','NTPC',
  'GUVNL','GEDA','MEDA','NREDCAP','wind-solar hybrid','round-the-clock','RTC','firm and dispatchable','FDRE','RE+storage',
  'PM-KUSUM','KUSUM','rooftop solar','grid-connected','off-grid','solar pump','agri-solar','agrivoltaics',
  'china dumping','china dumping module','china dumping cell','china exports','china capacity','china discipline','china+1','china plus one',
  'CSAJP','CSAJP duty','customs duty','GST refund','export benefit','duty drawback','MEIS','RoSCTL','RoDTEP',
];

export const SECTOR_TND: string[] = [
  'transmission','transmission line','TL','transmission corridor','transmission tower','tower','GIS','gas-insulated switchgear',
  'substation','sub-station','HVDC','HVAC','transformer','distribution transformer','power transformer','furnace transformer',
  'auto transformer','isolating transformer','tractor transformer','traction transformer','rectifier transformer',
  'EHV','HV','MV','LV','11 kV','33 kV','66 kV','132 kV','220 kV','400 kV','765 kV','HVDC 800 kV','UHVDC',
  'smart meter','smart metering','RDSS','RAS','SAS','SCADA','distribution automation','feeder automation',
  'discom','distribution company','RDSS scheme','revamped distribution sector scheme','UDAY','UDAY plus','UJWAL',
  'tariff order','MERC','APERC','RERC','GERC','UERC','DERC','MSEB','TANGEDCO','BSES','TPL','APDCL','BESCOM','PESCOM',
  'data center','data centre','DC capacity','hyperscaler','colocation','co-location','cloud capex','AI capex','GPU capex',
  'transmission line wins','transmission line awards','TS award','TBCB','tariff-based competitive bidding','POWERGRID order',
  'PGCIL order','PGCIL award','green corridor','green energy corridor','RE evacuation','renewable evacuation',
  'PSP','pumped storage','pumped storage project','battery storage','BESS','battery energy storage system','energy storage',
];

export const SECTOR_CAPGOODS: string[] = [
  'capital goods','heavy engineering','heavy equipment','industrial equipment','industrial machinery','machining',
  'forging','casting','foundry','heat treatment','quality control','quality assurance','QC','QA','dimensional accuracy',
  'precision engineering','tight tolerance','tight tolerances','aerospace grade','automotive grade','semi-finished',
  'finished goods','sub-assembly','assembly','test and trial','test and validation','validation','qualification',
  'order book','book to bill','book-to-bill','book/bill','indigenization','indigenisation','localization','localisation',
  'Make in India','MII','Atmanirbhar','self-reliance','PLI','sectoral PLI','make in india order','government order',
  'iDEX','innovations for defence excellence','defence offset','offset','offset policy','offset clause','offset partnership',
  'kavach','vande bharat','metro','metro project','metro award','railway project','railway order','railway capex',
  'L1','lowest bidder','L1 status','L1 conversion','L1 to order','tender win','tender loss','tender deferral','tender delay',
  'EPC','EPC contract','EPC project','EPC margin','LSTK','lumpsum turnkey','lump sum turnkey','design build','DB',
  'execution','execution slippage','execution risk','execution timeline','execution discipline','project execution',
  'CWIP','project pipeline','project win','project loss','project deferral','project rephrase','project rephasing',
  'cost over-run','cost overrun','cost overruns','schedule overrun','time overrun','delay','delays','liquidated damages','LD',
];

export const SECTOR_AUTO: string[] = [
  'OEM','tier-1','tier 1','tier-2','tier 2','tier-3','tier 3','original equipment manufacturer','automotive OEM',
  'PV','passenger vehicle','CV','commercial vehicle','2W','two wheeler','two-wheeler','3W','three wheeler','tractor',
  'EV','electric vehicle','xEV','BEV','battery electric vehicle','HEV','hybrid electric vehicle','PHEV','plug-in hybrid',
  'ICE','internal combustion engine','BS6','BS VI','BS-VI','BS7','BS VII','BS-VII','emission norm','emission standard',
  'fuel efficiency','CAFE','corporate average fuel economy','CO2 target','co2 reduction','euro 6','euro VI','tier IV',
  'EV penetration','EV adoption','EV ramp','EV transition','EV mandate','EV tax break','EV subsidy','FAME','FAME-II','FAME II',
  'content per vehicle','CPV','content/vehicle','content per car','dollar content','BOM enrichment','BOM cost','BOM',
  'PPAP','part approval','part qualification','design win','model award','platform win','model platform','vehicle platform',
  'top customer','customer concentration','dependence on customer','one customer','single customer','multi-customer',
  'OEM destocking','OEM restocking','channel destocking','dealer destocking','inventory at OEM','inventory at dealer',
  'model phase-out','model end-of-life','EOL','sunset model','platform end','model run-out','model transition',
  'aftermarket','spare parts','accessories','consumables','recurring revenue','annuity','annuity revenue','annuity stream',
  'production schedule','OEM production schedule','OEM volume','OEM build plan','OEM build forecast','schedule cut',
];

export const SECTOR_EMS: string[] = [
  'EMS','electronics manufacturing services','contract manufacturing','OEM partnership','design+build','design build',
  'design win','design wins','program ramp','program ramp-up','program ramp up','program ramp-up','program win',
  'top customer','customer concentration','top 5 customers','top 10 customers','customer mix','marquee customers',
  'design-led','design-driven','design partnership','co-development','co-creation','collaborative design',
  'BOM','bill of materials','BOM cost','BOM dollar','PCB','PCBA','SMT','surface mount technology','through-hole',
  'box build','box-build','sub-assembly','final assembly','functional testing','flying probe','ICT','in-circuit test',
  'FY27 visibility','FY28 visibility','medium-term visibility','design pipeline','program pipeline','design book',
  'customer onboarding','customer ramp','customer ramp-up','wallet share','share of wallet','vendor consolidation',
  'NPI','new product introduction','new program ramp','new design','product life cycle','product roadmap','SKU rationalisation',
  'silicon','semiconductor','chip shortage','chip allocation','allocation','component availability','supply allocation',
  'value engineering','VE','cost down','cost-down','cost reduction','cost-out','cost-take-out','cost takeout',
];

export const SECTOR_SPCHEM: string[] = [
  'specialty chemicals','specialty chemical','specialty molecules','speciality molecule','specialty molecule',
  'agrochemicals','agrochem','crop protection','active ingredient','AI','herbicide','insecticide','fungicide','plant growth',
  'flavour','fragrance','flavor and fragrance','F&F','aroma chemicals','vitamins','feed grade','pharma grade',
  'CRAMS','custom synthesis','custom manufacturing','contract research','process chemistry','process development',
  'multi-purpose plant','MPP','multi product plant','MPP plant','multi-product plant','multi-purpose facility',
  'innovator','innovator partnership','innovator customer','innovator order','innovator pipeline',
  'multi-year contract','LTC','long-term contract','long-term agreement','take or pay','take-or-pay','TOP','firm offtake',
  'china+1','china plus one','china discipline','china destocking','china stocking','china restart','china capacity',
  'inventory destocking','destocking','restocking','channel correction','inventory normalisation','inventory normalization',
  'EHS','environment health and safety','environmental clearance','EC','consent to operate','CTO','consent to establish','CTE',
  'pollution control','effluent','ZLD','zero liquid discharge','solid waste','hazardous waste','co-product','byproduct',
  'CAS','CAS number','intermediates','molecule pipeline','molecule introduction','phase-1','phase-2','phase-3','phase 1','phase 2','phase 3',
];

export const SECTOR_FOOD: string[] = [
  'feed cost','feed cost spike','feed cost down','soy meal','corn','maize','wheat price','barley','sorghum','pulses','grain',
  'milk price','milk procurement','milk procurement price','SNF','solids not fat','butter fat','butter','ghee','cheese',
  'channel distribution','distribution expansion','distribution reach','rural distribution','urban distribution','metro distribution',
  'premiumization','premiumisation','value added','value-added','high-margin product','premium SKU','premium product',
  'A&P','advertising and promotion','A&P spend','A&P intensity','marketing spend','brand spend','direct marketing','digital marketing',
  'EU import','EU import demand','export to EU','export demand','export realisation','export realization','export market',
  'FX','forex','currency','rupee depreciation','rupee appreciation','USD/INR','EUR/INR','GBP/INR','FX impact','currency impact',
  'channel destocking','dealer destocking','distributor destocking','channel inventory','dealer inventory','distributor inventory',
  'ASP','average selling price','ASP cut','price cut','price hike','price increase','price reduction','MRP increase',
  'rural recovery','rural demand','urban demand','metro demand','tier-1 demand','tier-2 demand','tier-3 demand','tier 1','tier 2','tier 3',
  'GST','GST input credit','GST refund','GST rate','GST notification','GST council',
  'launch','new launch','SKU launch','variant launch','range expansion','category expansion','geography expansion','geo expansion',
];

export const SECTOR_STEEL_BULK: string[] = [
  'utilization above 85%','utilization above 80%','high utilization','full utilization','peak utilization','sold out','demand pull',
  'price hike','price increase','price increase sustained','price cut','price cut sustained','spread','spread expansion','spread compression',
  'EBITDA per tonne','EBITDA/tonne','EBITDA per ton','EBITDA/ton','realisation per tonne','realization per tonne','blended realisation',
  'HRC','hot rolled coil','CRC','cold rolled coil','wire rod','rebar','TMT','iron ore','coking coal','thermal coal','coke','pellet',
  'lump iron','iron ore fines','sponge iron','DRI','direct reduced iron','blast furnace','BF','BOF','basic oxygen furnace','EAF','electric arc furnace',
  'sinter','sintering','cinder','slag','steel scrap','scrap','pig iron','ingot','billet','bloom','slab','HR coil','CR coil',
  'cement','clinker','OPC','PPC','PSC','grey cement','white cement','RMC','ready mix concrete','aggregate','sand','limestone',
  'kiln','rotary kiln','vertical roller mill','VRM','ball mill','cement plant','grinding unit','split grinding',
  'china utilization','china discipline','china capacity restart','china export','china discipline','china slowdown','china slack',
  'iron-ore down','iron-ore up','coking coal up','coking coal down','price collapse','price floor','price ceiling','price band',
  'debt funded expansion','debt funded capex','debt fundedgrowth','net debt','net debt/EBITDA','leverage','deleveraging','de-leveraging',
];

/* ─── TONE LEXICONS ─── */
export const TONE_POSITIVE: string[] = [
  'in line with our plan','ahead of our plan','ahead of plan','ahead of guidance','exceeded our internal target',
  'exceeded our target','exceeded our expectation','exceeded our internal expectation','exceeded internal expectation',
  'strong pricing held','strong pricing power','strong realisation','strong realization','strong demand','strong demand environment',
  'robust demand','robust demand environment','robust order intake','robust order book','robust pipeline',
  'fully booked','sold out','sold-out','fully utilised','fully utilized','full capacity','peak capacity',
  'we are confident','we are highly confident','we are very confident','we are extremely confident','we have very high confidence',
  'structural shift','structural growth','structural tailwind','structural change','structural trend',
  'multi-year visibility','multi-year tailwind','multi-year growth','strong multi-year visibility','three-year visibility','5-year visibility',
  'best ever','best-ever','highest ever','highest-ever','record','record high','record demand','record order book','record order intake',
  'organic growth','volume-led growth','volume-driven','volume growth','volume traction','traction','strong traction',
  'all-time high','all time high','ATH','best in class','best-in-class','class leading','class-leading','differentiated','differentiation',
  'on track','on schedule','on plan','as planned','as guided','as committed','on time','within timeline',
  'positive demand','positive momentum','positive outlook','positive trajectory','positive trend','positive surprise',
  'continue to gain','gaining share','gaining market share','gaining ground','outperforming','outperformance',
  'rerating','re-rating','re rating','PE rerating','multiple expansion','valuation upside','wealth creation','compounding',
];

export const TONE_CAUTIOUS: string[] = [
  'we will see','we will see how it plays','we shall see','remains to be seen','time will tell','too early to say',
  'watching closely','monitoring','monitoring the situation','keeping an eye','staying cautious','near-term cautious',
  'near term cautious','cautiously optimistic','cautious','cautious outlook','cautious view','cautious approach',
  'lumpy','lumpy quarter','lumpy growth','choppy','choppy quarter','volatile','volatile environment','soft patch','soft start',
  'back-ended','back ended','back-ended quarter','back-ended year','back-ended growth','second-half loaded','H2 loaded',
  'Q1 was a wash','Q1 wash','Q1 weak','weak start','slow start','sluggish start','weak Q1','soft Q1',
  'transient','transitory','temporary','short-lived','short lived','one-quarter','one quarter','transient impact','one quarter impact',
  'guarded','guarded outlook','guarded view','reserved','reserved outlook','reserved view','measured','measured outlook',
  'we are watching','keeping a close eye','close watch','close monitoring','keeping under observation',
  'cyclical','cyclical headwind','cyclical recovery','cyclical pressure','cyclicality','cycle dependent',
  'subject to','dependent on','contingent on','conditional','tentative','tentative outlook','provisional','indicative',
];

export const TONE_RED_FLAG: string[] = [
  'challenging quarter','challenging year','challenging environment','difficult quarter','difficult year','tough quarter',
  'weaker than expected','below expectations','below our expectations','missed expectations','missed guidance','disappointed',
  'disappointing','disappointing quarter','underperformance','underperformed','underperforming','below internal',
  'one-time','one time','one-off','one off','exceptional item','exceptional cost','exceptional gain','non-recurring',
  'transition phase','transitional','transitional phase','transitional year','in transition','transitional period',
  'investing for future','investing for growth','investing for the future','investment phase','investment cycle','build-out',
  'structural rationalisation','structural rationalization','rationalising','rationalizing','restructuring','reorganising','reorganizing',
  'course correction','strategic reset','strategic shift','strategic pivot','re-strategising','re-strategizing','strategic review',
  'tactical pricing','tactical price','tactical price cut','tactical discount','aggressive discount','aggressive pricing',
  'overhang','demand overhang','inventory overhang','supply overhang','price overhang','channel overhang',
  'delayed','delays','delay','slipped','slippage','pushed out','push-out','pushed back','rescheduled','rephased',
  'absorbed','impact absorbed','impact taken','margin hit','margin compression','margin contraction','margin erosion',
  'losses','net loss','operating loss','EBITDA loss','EBIT loss','margin compression','PAT decline','PAT drop','revenue decline',
];

/* ─── EXPORT BIG BANK ─── */
export const BANK: KwBank = {
  capacity: CAPACITY,
  capex: CAPEX,
  demand: DEMAND,
  margins: MARGINS,
  guidance: GUIDANCE,
  risk: RISK_FLAGS,
  pharma: SECTOR_PHARMA,
  solar: SECTOR_SOLAR,
  tnd: SECTOR_TND,
  capgoods: SECTOR_CAPGOODS,
  auto: SECTOR_AUTO,
  ems: SECTOR_EMS,
  spchem: SECTOR_SPCHEM,
  food: SECTOR_FOOD,
  steel_bulk: SECTOR_STEEL_BULK,
  tone_positive: TONE_POSITIVE,
  tone_cautious: TONE_CAUTIOUS,
  tone_red_flag: TONE_RED_FLAG,
};

// Quick counts for monitoring
export const BANK_STATS = Object.entries(BANK).map(([k, v]) => ({ category: k, count: v.length }));
