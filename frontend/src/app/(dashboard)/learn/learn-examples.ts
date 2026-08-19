// zzz407 — Learn tab worked examples (additive; book-data.ts untouched).
// One or more real-world teaching examples per section, keyed by section index.
// Generated with a multi-agent pass + hand-authored advanced sections.
// Numbers are illustrative teaching figures, not precise reported financials.

export interface LearnExampleNumber { label: string; value: string }
export interface LearnExample {
  tag: 'worked' | 'scenario' | 'pitfall';
  title: string;
  company?: string;
  body: string[];
  numbers?: LearnExampleNumber[];
}

export const LEARN_EXAMPLES: Record<number, LearnExample[]> = {
"0": [
{
"tag": "scenario",
"title": "Titan: read the business model before the numbers",
"body": [
"Start by asking what Titan actually sells and who pays. It sells jewellery (Tanishq), watches and eyewear, but roughly 80%+ of revenue and the bulk of profit come from jewellery, where the customer is an Indian household buying for a wedding or a festival. Why do they buy Titan over the neighbourhood jeweller? Trust on purity and hallmarking, exchange transparency and design — that trust is the moat.",
"Now map the value-chain and cost drivers. Gold is a pass-through raw material, so a big chunk of 'revenue' is just the gold price flowing through; the real economics sit in the making charges and studded (diamond) mix, which carry far higher margin than plain gold. That single insight tells you to watch studded share, not headline sales.",
"Finally judge capital and working-capital intensity. Jewellery is inventory-heavy — you must stock gold to sell gold — so working capital is large and gold-price risk is hedged. The business is largely one-time purchase (not subscription), but weddings and festivals make it repeatable and seasonal.",
"Lesson: before touching a single ratio, know what is sold, who pays, why they pay, and where in the value chain the profit actually pools — for Titan the profit is in making charges and studded mix, not the gold."
],
"numbers": [
{
"label": "Jewellery share of revenue",
"value": "~80%+"
},
{
"label": "Gold in COGS",
"value": "pass-through"
},
{
"label": "Key margin lever",
"value": "studded mix"
}
]
},
{
"tag": "scenario",
"title": "APL Apollo: industry structure decides who wins",
"body": [
"Structural steel tubes look like a boring commodity, so start with industry analysis. The TAM is large and growing as construction shifts from heavy hot-rolled sections to lighter structural tubes, and the industry was historically fragmented across small regional players — that fragmentation is the opportunity.",
"Ask about entry barriers and pricing power. In a fragmented commodity, no single small player has pricing power; the winner is whoever builds scale, a nationwide distribution web and low-cost conversion. APL Apollo used size and a hub-and-spoke model to convert faster and cheaper, steadily taking share from the unorganised segment.",
"Watch supply-demand and capacity. Because conversion spreads are thin, the analyst's job is to track capacity additions and utilisation across the industry, and whether APL Apollo's value-added mix (larger sections, coated products) is rising faster than plain tubes.",
"Lesson: in a fragmented commodity industry, the durable edge is scale plus distribution that lets the leader consolidate a splintered market — read the industry structure first, then find the consolidator."
],
"numbers": [
{
"label": "Industry structure",
"value": "fragmented, consolidating"
},
{
"label": "Edge",
"value": "scale + distribution"
},
{
"label": "Watch",
"value": "value-added mix"
}
]
}
],
"1": [
{
"tag": "worked",
"title": "Operating leverage in an income statement: illustrative Astral",
"body": [
"Take a maker of pipes and adhesives and decompose the income statement over one year. Say revenue rises from ~1,000 to ~1,200 (up 20%). Split that into volume and price: suppose volume is up ~15% and realisation/price-mix up ~5% — already you learn the growth is mostly real volume, which is higher quality than pure price.",
"Now walk down the margins. If gross margin holds at ~40% but fixed overheads (staff, plant, ad spend) grow only ~8% while revenue grows 20%, EBITDA margin expands, say from ~16% to ~18%. So EBITDA rises from ~160 to ~216 — up ~35%, much faster than the 20% sales growth.",
"That gap between 20% revenue growth and 35% EBITDA growth is operating leverage: fixed costs spread over more units. Below EBITDA, if interest and depreciation are roughly flat, PAT grows even faster than EBITDA.",
"Lesson: never read revenue growth alone — decompose it into volume vs price, then watch whether EBITDA grows faster than sales; that spread is operating leverage and it is where the real earnings surprise lives."
],
"numbers": [
{
"label": "Revenue growth",
"value": "+20%"
},
{
"label": "Volume / price",
"value": "+15% / +5%"
},
{
"label": "EBITDA margin",
"value": "16% → 18%"
},
{
"label": "EBITDA growth",
"value": "~+35%"
}
]
},
{
"tag": "pitfall",
"title": "Balance sheet trap: profit up, cash trapped in working capital",
"body": [
"A common mistake is to celebrate rising PAT without opening the balance sheet. Imagine an infra or capital-goods style company reporting profit up 25%, but receivables jumping from ~90 days to ~150 days and inventory swelling as it books orders it hasn't collected on.",
"Compute the working-capital drag. If revenue is ~1,000 and receivables go from 90 to 150 days of sales, roughly 165 of extra cash (about 60 days x ~2.7/day) gets locked into the balance sheet — money the P&L calls profit but the bank account never sees.",
"Cross-check with net debt: if that gap is being funded by rising borrowings, 'growth' is quietly being financed by the lender, not by customers. Also scan contingent liabilities and goodwill/intangibles for hidden risk.",
"Lesson: a healthy income statement can sit on a sick balance sheet — always tie profit back to receivables, inventory, payables and net debt before you trust the earnings."
],
"numbers": [
{
"label": "PAT growth",
"value": "+25%"
},
{
"label": "Receivable days",
"value": "90 → 150"
},
{
"label": "Cash locked",
"value": "~165"
}
]
}
],
"2": [
{
"tag": "pitfall",
"title": "Earnings quality: strip out other income and one-offs",
"body": [
"Suppose a company reports PAT up sharply and the headline looks great. Before believing it, split reported profit into operating profit and everything else. Say EBIT from the core business is roughly flat, but 'other income' (treasury gains on a big cash pile, a one-time land sale, an insurance claim, an FX gain) contributed a large slice of the jump.",
"Quantify it. If pre-tax profit is ~200 and ~60 of that is a non-recurring land sale plus treasury income, then nearly a third of the 'profit' will not repeat next year. Also check the tax line — a one-off tax reversal or an unusually low tax rate can flatter PAT even when the business is unchanged.",
"Then sanity-check revenue quality: is the sales growth backed by cash collection, or is it sitting in receivables? Poor cash conversion alongside surging profit is a red flag for aggressive revenue recognition.",
"Lesson: reported earnings and business earnings are not the same number — subtract other income, one-offs and tax quirks to find the profit that will actually recur."
],
"numbers": [
{
"label": "Reported PBT",
"value": "~200"
},
{
"label": "Non-recurring slice",
"value": "~60 (~30%)"
},
{
"label": "Recurring EBIT",
"value": "roughly flat"
}
]
},
{
"tag": "worked",
"title": "Decomposing revenue growth: volume + price + mix",
"body": [
"Take a cement maker like an UltraTech-style business reporting quarterly revenue up ~14%. The undisciplined analyst stops there; the good one decomposes it. Break sales growth into volume, realisation (price) and mix.",
"Say volumes grew ~8% (real demand), average realisation rose ~4% (price hikes sticking), and premium/blended-cement mix added another ~2%. That adds to ~14%, but the story underneath matters: volume-led growth in a cyclical is far more durable than price-led growth, which can reverse the moment the cycle turns.",
"Now push the same discipline to EBITDA. If EBITDA/tonne rose because realisation outran cost inflation and utilisation improved, the margin gain is structural; if it only rose because fuel/pet-coke prices fell, it is a cost tailwind that can reverse. Separate the volume, realisation, gross-margin and operating-leverage pieces.",
"Lesson: 'revenue up 14%' is a headline, not an insight — always break growth into volume + price + mix (and EBITDA into realisation + cost + leverage) so you know which parts are durable."
],
"numbers": [
{
"label": "Revenue growth",
"value": "~14%"
},
{
"label": "Volume",
"value": "~8%"
},
{
"label": "Realisation",
"value": "~4%"
},
{
"label": "Mix",
"value": "~2%"
}
]
}
],
"3": [
{
"tag": "scenario",
"title": "Growth inflection: reading Dixon's order and capacity ramp",
"body": [
"A growth inflection shows up in leading operational signals before it shows up in glossy full-year numbers. With an EMS/contract-manufacturer like Dixon, the tells are order wins, new customer additions and new lines being commissioned — not last year's revenue.",
"Trace the chain. A PLI-driven mobile assembly contract is announced, then a new plant is built, then the line is qualified by the brand customer, then volumes ramp quarter by quarter. Revenue that was, say, growing in the teens can inflect to compounding much faster as several lines ramp together and utilisation climbs.",
"The analyst's job is to catch the inflection between 'capacity commissioned' and 'revenue booked', because the market often prices the old growth rate while orders already point to a step-change. Watch order book, customer count and utilisation as the early indicators.",
"Lesson: growth inflections are visible first in orders, new customers and capacity ramp — track those leading signals to see the acceleration before the reported revenue confirms it."
],
"numbers": [
{
"label": "Signal 1",
"value": "order wins"
},
{
"label": "Signal 2",
"value": "new customers"
},
{
"label": "Signal 3",
"value": "line utilisation"
}
]
},
{
"tag": "worked",
"title": "Product-mix inflection: the EBITDA/tonne story (Ratnamani-style)",
"body": [
"This is the highest-leverage inflection, so make it concrete with a specialty pipe/tube maker moving from commodity products to high-value ones (stainless and specialty grades for oil and gas). The core question: is the revenue mix shifting from low-value to high-value output?",
"Work the per-tonne economics. Suppose commodity pipe earns ~15,000 EBITDA/tonne and specialty grades earn ~60,000/tonne. If the specialty share of volume rises from ~20% to ~40% while total tonnage is flat, blended EBITDA/tonne jumps from ~24,000 to ~33,000 — a ~35%+ profit rise with zero volume growth.",
"Now follow the cascade the section describes: richer mix lifts EBITDA/tonne, which lifts margin, which lifts ROCE (same assets, more profit), which frees more FCF, which — because the earnings are now higher-quality and more durable — earns a higher valuation multiple. That multiple re-rating on top of the earnings rise is why mix inflection is a double engine.",
"Lesson: a shift toward higher-value products can grow profit and ROCE with no extra volume, and the re-rating of the multiple compounds the gain — always track mix and EBITDA/tonne, not just tonnes sold."
],
"numbers": [
{
"label": "Commodity EBITDA/t",
"value": "~15,000"
},
{
"label": "Specialty EBITDA/t",
"value": "~60,000"
},
{
"label": "Specialty mix",
"value": "20% → 40%"
},
{
"label": "Blended EBITDA/t",
"value": "~24k → ~33k"
},
{
"label": "Profit uplift",
"value": "~+35%"
}
]
}
],
"4": [
{
"tag": "worked",
"title": "Operating leverage in unit economics: CDSL-style fixed-cost business",
"body": [
"Some businesses are almost pure operating leverage because their costs barely move with volume. A depository like CDSL earns fees per demat account and per transaction, but the core platform, compliance and staff costs are largely fixed — every incremental account is almost pure profit.",
"Put rough numbers on it. Say fixed costs are ~200 and each active account contributes ~40 of revenue at ~90% incremental margin. Go from 5 to 8 units of accounts: revenue rises from ~200 to ~320 (+60%), but costs rise only slightly, so EBITDA can jump from, say, ~60 to ~150 — up ~150%, dwarfing the revenue growth.",
"The mechanism is exactly the section's formula: revenue up, utilisation up, fixed cost per unit down, margin up, EBITDA grows far faster than revenue. The same dynamic drives exchanges (IEX, BSE) and asset-light platforms during a bull market — and, crucially, works in reverse when volumes fall.",
"Lesson: when fixed costs dominate, profits are a geared bet on volume — small revenue moves produce large EBITDA moves, up and down, so size the operating leverage before you extrapolate a good quarter."
],
"numbers": [
{
"label": "Incremental margin",
"value": "~90%"
},
{
"label": "Revenue growth",
"value": "+60%"
},
{
"label": "EBITDA growth",
"value": "~+150%"
},
{
"label": "Fixed cost",
"value": "~flat"
}
]
},
{
"tag": "worked",
"title": "Incremental ROCE: is new growth actually creating value?",
"body": [
"Existing ROCE tells you about yesterday's capital; incremental ROCE tells you whether tomorrow's growth is worth funding. Take a consumer compounder like Pidilite or Asian Paints and separate the two.",
"Do the math. Suppose the company already earns ~25% ROCE on its existing ~1,000 of capital employed (so ~250 of EBIT). Now it invests ~200 of fresh capex and, a couple of years later, that new capital generates ~60 of incremental EBIT. Incremental ROCE = 60 / 200 = ~30% — higher than the existing 25%, so the growth is value-accretive and blended ROCE rises.",
"Contrast the danger case: if a company reports a fat 25% headline ROCE but its last three years of heavy capex earn only ~8% incrementally, the average is being flattered by old assets while new money is destroying value. The reported ROCE looks fine even as the marginal investment turns poor.",
"Lesson: always split existing from incremental ROCE — the blended number can hide a business quietly reinvesting at low returns; the incremental figure is what tells you if growth is creating or burning value."
],
"numbers": [
{
"label": "Existing ROCE",
"value": "~25%"
},
{
"label": "New capex",
"value": "~200"
},
{
"label": "Incremental EBIT",
"value": "~60"
},
{
"label": "Incremental ROCE",
"value": "~30%"
}
]
}
],
"5": [
{
"tag": "scenario",
"title": "Capital cycle in commodities: the steel / metals loop",
"body": [
"The capital cycle explains why commodity profits are self-defeating, and steel (Tata Steel, JSW Steel) is the classic textbook. When global steel spreads are fat, every producer earns high returns, so everyone announces expansions and new capacity; the capex is committed at the top precisely because times are good.",
"Two to three years later all that capacity commissions at once, supply floods the market, spreads collapse and returns crater — often just as the new plants start depreciating. Burned by losses, the industry stops investing, capex dries up, no new capacity comes, and eventually demand catches up to the frozen supply. Shortage returns, prices spike, margins recover — and the cycle rearms.",
"The contrarian insight: the best time to buy cyclicals is usually when capex across the industry has collapsed and everyone is pessimistic (sowing the next shortage), and the worst time is when expansion announcements are everywhere.",
"Lesson: in commodities, high returns attract the supply that destroys them — watch industry-wide capex, not just the company's own; falling capex is the seed of the next up-cycle."
],
"numbers": [
{
"label": "Trigger",
"value": "high spreads → capex boom"
},
{
"label": "Lag",
"value": "~2-3 yrs to commission"
},
{
"label": "Buy signal",
"value": "industry capex collapses"
}
]
},
{
"tag": "pitfall",
"title": "The low-P/E cyclical trap: peak earnings look cheap",
"body": [
"The deadliest mistake in cyclical investing is buying at the peak because the P/E looks low. Consider a cyclical — say a metals or a commodity chemical name like a Vedanta or a Deepak Nitrite in a boom — at the top of its cycle.",
"Watch the illusion. At the peak, EPS is abnormally high (say ~100) because margins are stretched, so at a price of ~800 the stock trades at just ~8x — looks like a bargain. But margins are unsustainable; as the cycle turns, EPS collapses to, say, ~30. Even if the price holds, the P/E balloons to ~27x, and the price usually falls too.",
"The section's insight is exactly this inversion: at the trough, earnings are weak and P/E looks high (often the best time to buy); at the peak, earnings are strong and P/E looks low (often the worst time). Judge cyclicals on normalized / mid-cycle earnings, not the current print.",
"Lesson: a low P/E on a cyclical at peak margins is a warning, not a bargain — value cyclicals on mid-cycle normalized EPS, and treat a high trough P/E as the opportunity."
],
"numbers": [
{
"label": "Peak EPS",
"value": "~100"
},
{
"label": "P/E at peak",
"value": "~8x (trap)"
},
{
"label": "Trough EPS",
"value": "~30"
},
{
"label": "P/E at trough",
"value": "~27x"
}
]
}
],
"6": [
{
"tag": "scenario",
"title": "Triangulation: proving a capex up-cycle without trusting management",
"body": [
"Management always sounds optimistic, so a strong thesis needs external evidence pointing the same way. Suppose you are testing whether India's power-transmission and industrial capex cycle is genuinely turning, using names like Siemens, ABB, Cummins or L&T.",
"Gather independent data points. Check tender activity and government T&D ordering (leading), scan the order-book commentary of multiple equipment makers (do they all report the same acceleration?), look at import/export and customer-capex announcements, and even watch hiring — a surge in factory and engineer job postings signals expected volume. If customers (utilities, data centres, factories) are all announcing capex, the demand is real.",
"Now triangulate: management says demand is strong, customers are announcing capex, competitors report the same rising order books, suppliers report longer lead times, and external tender data confirms it. When all five arrows point the same way, conviction is high; when only management is bullish, stay skeptical.",
"Lesson: one bullish source is an opinion; management + customers + competitors + suppliers + hard external data all agreeing is a thesis — always corroborate the story outside the company's own filings."
],
"numbers": [
{
"label": "Sources aligned",
"value": "5 (mgmt+cust+comp+supp+data)"
},
{
"label": "Leading tell",
"value": "tenders, hiring"
},
{
"label": "Supplier tell",
"value": "longer lead times"
}
]
}
],
"7": [
{
"tag": "scenario",
"title": "Bottleneck investing: the transformer and grid-gear squeeze",
"body": [
"Find the single component without which the whole industry cannot grow. In the global electrification and data-centre build-out, one recurring constraint is high-voltage transformers and grid equipment — you can order solar panels and turbines quickly, but you cannot energise anything without a transformer, and those have exploded in lead time.",
"Trace the economics the section describes. Scarce transformer capacity means order books stretch out for years, makers gain pricing power, existing plants run flat-out at high utilisation, and margins expand — all before anyone adds new capacity. Indian names exposed to this (transformers, cables like Polycab/KEI, grid gear from Siemens/ABB) ride the same scarcity.",
"Then judge duration, which is the whole game. Building a new specialised transformer plant with skilled labour and long-lead materials can take years, so the shortage — and the pricing power — can persist far longer than in a commodity where supply responds in months. Long duration equals a stronger, more durable profit pool.",
"Lesson: locate the true bottleneck in a growth story, then estimate how long competitors need to relieve it — the longer the supply response, the longer scarcity funds pricing power and margins."
],
"numbers": [
{
"label": "Constraint",
"value": "HV transformers / grid gear"
},
{
"label": "Effect",
"value": "scarcity → pricing power"
},
{
"label": "Supply-response time",
"value": "years (long = strong)"
}
]
},
{
"tag": "pitfall",
"title": "Short-duration bottleneck: the spike that doesn't last",
"body": [
"Not every shortage is a moat — the mistake is treating a temporary bottleneck like a durable one. Recall commodity-chemical and API episodes (agrochemical intermediates, certain bulk drugs) where Chinese supply disruption suddenly made an Indian producer's product scarce and margins spiked.",
"Run the duration test. If the product can be made in a fairly standard plant that competitors (and the disrupted supplier) can restart or expand in, say, 12-18 months, then the scarcity is short-lived. Prices and EBITDA/tonne surge for a few quarters, the market extrapolates the windfall into the multiple, and then new supply floods in and margins normalise or crash.",
"Contrast this with a genuine multi-year bottleneck (specialised fluorination capacity, long-cycle grid gear): same starting symptom, completely different half-life. The analyst's error is paying a high multiple on peak windfall earnings from a short-duration squeeze.",
"Lesson: a shortage only creates lasting economics if supply is slow to respond — a bottleneck competitors can relieve in a year or two is a temporary windfall, so never capitalise it as if it were permanent."
],
"numbers": [
{
"label": "Supply response",
"value": "~12-18 months"
},
{
"label": "Margin",
"value": "spikes then normalises"
},
{
"label": "Mistake",
"value": "high multiple on windfall EPS"
}
]
}
],
"8": [
{
"tag": "worked",
"title": "Reverse valuation: what must Nykaa's price already assume?",
"body": [
"Instead of asking 'what is it worth', ask what today's price is already baking in — that reframes a scary multiple into a testable claim. Take a high-growth, low-current-profit consumer-internet name like Nykaa priced at a rich EV/Sales.",
"Work backwards. Suppose the market cap implies you are paying, illustratively, ~8x sales on ~5,000 of revenue. For that to make sense at, say, a future ~25x P/E, the company might need to reach ~1,600 of net profit. If a mature, achievable net margin is ~8%, that requires ~20,000 of revenue — i.e. revenue must roughly quadruple. Ask: over how many years, and is 4x growth realistic given TAM and competition?",
"Now you have a falsifiable test. If quadrupling revenue in five to six years while hitting an 8% margin looks plausible given the market and execution, the price is defensible; if it needs revenue to 8x with margins no one in the category earns, the price is pricing in a fantasy.",
"Lesson: reverse the DCF — derive the growth and margin the current price implies, then judge whether that scenario is achievable; it turns 'expensive vs cheap' into a concrete, checkable claim."
],
"numbers": [
{
"label": "Implied EV/Sales",
"value": "~8x"
},
{
"label": "Required future PAT",
"value": "~1,600"
},
{
"label": "Mature margin",
"value": "~8%"
},
{
"label": "Implied revenue",
"value": "~20,000 (~4x)"
}
]
},
{
"tag": "scenario",
"title": "Choosing the right metric: matching method to business type",
"body": [
"The valuation decision tree is really about picking the metric that captures where value comes from — using one method everywhere is the beginner's error. Walk three companies through the tree.",
"For a mature, cash-generative FMCG like Nestle India: it is profitable with strong FCF and low cyclicality, so EV/EBITDA, P/FCF and FCF yield are the honest lenses. For a bank like HDFC Bank, EV/EBITDA is meaningless (interest is the business); you value it on P/B against ROE and on P/E. For a deep cyclical like Tata Steel, current EPS is misleading, so you use normalized/mid-cycle earnings, mid-cycle EBITDA and replacement value — not the peak print.",
"For a high-growth, not-yet-profitable platform, EV/Sales with a path-to-margin (as in the reverse-valuation example) is the tool. The point of the tree is to ask first: is it profitable, is FCF meaningful, is it cyclical, and where does value actually come from — then pick the metric that fits.",
"Lesson: there is no universal multiple — match the method to the business (EV/EBITDA and FCF for mature, P/B for banks, normalized earnings for cyclicals, EV/Sales for early-stage), or the number will lie to you."
],
"numbers": [
{
"label": "Mature FMCG",
"value": "EV/EBITDA, P/FCF"
},
{
"label": "Bank",
"value": "P/B vs ROE"
},
{
"label": "Cyclical",
"value": "normalized earnings"
},
{
"label": "Early-stage",
"value": "EV/Sales"
}
]
}
],
"9": [
{
"tag": "worked",
"title": "SOTP: unlocking the hidden value in a conglomerate",
"body": [
"Sum-of-the-parts matters when a single blended multiple hides a jewel inside a mixed group. Take a conglomerate-style structure like Bajaj Finserv, which houses a fast-growing lender (Bajaj Finance stake), a life-insurance business and a general-insurance business — each with different growth, margins and appropriate multiples.",
"Value each piece on its own terms, then add. Illustratively: value the lending stake at its own market value, the general-insurance arm on a P/E that reflects its high ROE, and the life-insurance arm on embedded value. Add the parts, add other investments and surplus assets, subtract net debt and a corporate/holding-company adjustment, and divide by shares to get an SOTP per share.",
"The insight is that a crude group-level P/E would apply one mediocre multiple to everything, undervaluing the high-quality insurance and lending arms. SOTP surfaces that gap — and it becomes especially powerful when a holding-company discount exists or a demerger/listing is coming, because the parts can re-rate toward their standalone worth.",
"Lesson: when a company holds businesses with different growth, margins and deserved multiples, value each separately and net off debt and a holdco discount — SOTP reveals value a single blended multiple buries, and demergers are the catalyst that releases it."
],
"numbers": [
{
"label": "Segments",
"value": "valued separately"
},
{
"label": "Add",
"value": "investments + surplus assets"
},
{
"label": "Subtract",
"value": "net debt + holdco discount"
},
{
"label": "Catalyst",
"value": "demerger / listing"
}
]
}
],
"10": [
{
"tag": "worked",
"title": "Reverse-engineering what DMart's price already assumes",
"body": [
"Don't ask 'is DMart a great business?' — it obviously is. Ask 'what growth is the price forcing me to believe?' Suppose DMart trades at a ~90x P/E while a boring FMCG distributor trades at ~30x. The 3x premium is not free — it is an IOU the company must repay with growth.",
"Work it backwards. If earnings must roughly triple just for the P/E to fall from 90x to a still-rich 30x without the stock moving, then at ~20% EPS CAGR that takes about 6 years, and at ~25% about 5 years. So the price is quietly assuming five-plus years of mid-20s compounding AND that the multiple stays premium the whole time.",
"Now flip to reality: is 25% EPS growth achievable when new stores cannibalise old ones and online grocery is scaling? Maybe, maybe not — but at least you now know the bar. You are no longer buying 'a good company', you are betting against a specific, high hurdle.",
"Takeaway: price is a compressed forecast. Decode the implied growth first, THEN judge whether the business can clear it — a wonderful company at an impossible expectation is still a bad trade."
],
"company": "Avenue Supermarts (DMart)",
"numbers": [
{
"label": "Illustrative P/E",
"value": "~90x"
},
{
"label": "Peer P/E",
"value": "~30x"
},
{
"label": "EPS growth priced",
"value": "~25% for 5yr"
},
{
"label": "Premium to unwind",
"value": "3x"
}
]
},
{
"tag": "scenario",
"title": "The double engine: why APL Apollo was a multibagger twice over",
"body": [
"The best multibaggers pay you twice — once through rising earnings (EPS expansion) and again through a rising multiple (P/E expansion). APL Apollo is a clean teaching case of the full rerating chain.",
"Step one, operational improvement: it shifted from being seen as a commodity steel-tube maker toward value-added structural tubes (Tricoat, heavier sections) with better realisations and a wider distribution moat. Step two, earnings revisions: as volumes compounded and mix improved, analysts kept raising forward EPS instead of cutting it.",
"Step three, multiple expansion: the market stopped valuing it like a steel converter (say ~8-10x) and started valuing it like a branded building-material franchise (say ~30x+). Step four, price: if EPS roughly quadruples over some years AND the P/E triples, the stock does not go up 4x — it goes up ~12x, because the two engines multiply.",
"Takeaway: EPS growth × P/E rerating is a product, not a sum. Hunt for situations where a business is being re-perceived from 'commodity' to 'franchise' — that is where both engines fire together."
],
"company": "APL Apollo Tubes",
"numbers": [
{
"label": "Old lens",
"value": "steel converter ~9x"
},
{
"label": "New lens",
"value": "building brand ~30x"
},
{
"label": "EPS engine",
"value": "~4x"
},
{
"label": "P/E engine",
"value": "~3x"
},
{
"label": "Combined",
"value": "~12x"
}
]
}
],
"11": [
{
"tag": "scenario",
"title": "Climbing the catalyst ladder in a CDMO order win",
"body": [
"Not all 'good news' is equal. Rank catalysts by how binding they are. Take a specialty-fluorine/CDMO player like Navin Fluorine chasing a large multi-year molecule contract.",
"Weakest signal: management says on the call 'the CDMO pipeline is very strong' — words, no cash. Better: it commissions a new dedicated plant — capacity exists but may sit idle. Strong: a global innovator qualifies Navin's site and molecule after audits — real, but still no revenue. Stronger: that customer places a commercial purchase order — money is now committed. Very strong: the customer places repeat orders — proof the product works and demand is sticky.",
"Exceptional: the next results show the new capacity utilised, revenue stepping up, guidance raised, AND margins expanding all at once — the whole thesis printing on one page. A patient analyst waits to add size as the catalyst climbs this ladder, rather than paying full price on the first press release.",
"Takeaway: buy conviction as evidence hardens. Commentary is a hint; a repeat commercial order is a fact — size your bet to where you are on the ladder."
],
"company": "Navin Fluorine",
"numbers": [
{
"label": "Commentary",
"value": "weak"
},
{
"label": "Qualification",
"value": "strong"
},
{
"label": "Commercial PO",
"value": "stronger"
},
{
"label": "Repeat orders",
"value": "very strong"
}
]
},
{
"tag": "worked",
"title": "Pricing a catalyst before it happens: capacity commissioning",
"body": [
"A catalyst you cannot date, size, and probability-weight is just a hope. Build the little table. Say Deepak Nitrite is set to commission a big new downstream project (illustratively) that could add roughly Rs 400 cr of incremental EBITDA at full utilisation.",
"Fill the columns. Catalyst: plant commissioning. Date: say H2 next FY. Probability of on-time start: ~70% (chemical projects slip). Expected financial impact: not the full Rs 400 cr on day one — ramp-ups run ~30% utilisation in year one, so ~Rs 120 cr initially. Expected market reaction: the stock usually moves on the commissioning announcement and first full quarter of contribution, not on the ribbon-cutting alone.",
"Now the expected value: ~Rs 120 cr year-one impact × 70% probability ≈ Rs 85 cr risk-adjusted EBITDA to underwrite today. If the price is already discounting the full Rs 400 cr as though utilisation were instant and certain, the catalyst is spent — you are late.",
"Takeaway: every catalyst gets four numbers — date, probability, rupee impact, and reaction. Multiply impact by probability and compare to what the price already assumes."
],
"company": "Deepak Nitrite",
"numbers": [
{
"label": "Full EBITDA (illustrative)",
"value": "~Rs 400 cr"
},
{
"label": "Yr-1 at ~30% util",
"value": "~Rs 120 cr"
},
{
"label": "On-time probability",
"value": "~70%"
},
{
"label": "Risk-adj impact",
"value": "~Rs 85 cr"
}
]
}
],
"12": [
{
"tag": "scenario",
"title": "Forced selling in a spin-off: the Jio Financial index drop",
"body": [
"When Reliance spun off Jio Financial Services, the shares were handed to every existing Reliance holder. That instantly created a large, indifferent, brand-new investor base — index funds and mandated holders who never chose to own a financial-services stock.",
"Passive funds tracking the Nifty could not hold JFS long-term the way they held Reliance, so there was mechanical, price-insensitive selling into a stock with thin initial liquidity. This forced-selling dynamic is the recurring gift in spin-offs: the seller is selling for structural reasons, not because the business is bad.",
"The analyst's job is to ignore the noise of the drop and value the standalone economics — what capital, book, and lending opportunity does JFS actually have on its own two feet, stripped of the parent's halo and overhead. The temporary supply-demand imbalance can hand you a franchise below its standalone worth.",
"Takeaway: in spin-offs, distinguish forced sellers from informed sellers. Mechanical index-driven selling into a new, illiquid line item is opportunity — value the child on its own standalone economics."
],
"company": "Jio Financial Services",
"numbers": [
{
"label": "New holder base",
"value": "all RIL shareholders"
},
{
"label": "Seller type",
"value": "index / forced"
},
{
"label": "Early liquidity",
"value": "thin"
},
{
"label": "What to value",
"value": "standalone book"
}
]
},
{
"tag": "pitfall",
"title": "Asset value is not realizable value: the land-bank trap",
"body": [
"Every few years someone 'discovers' that an old textile or manufacturing company sits on prime Mumbai land supposedly worth many times its market cap — the classic asset-unlock story around names like Bombay Dyeing. The mistake is treating the headline land value as cash in the bank.",
"Walk the haircuts. Say the land is quoted at Rs 5,000 cr of 'value'. Development permissions, litigation, and tenancy issues can freeze it for years. Selling or monetising triggers capital-gains tax. Any group debt sits ahead of shareholders. And a promoter with no intent to unlock can sit on it for a decade while the operating business bleeds.",
"By the time you subtract legal overhang, taxes, debt allocation, corporate overhead, and a discount for time and promoter inertia, that Rs 5,000 cr 'unlock' might be worth Rs 1,500 cr to a minority holder — and only if it ever happens. Realizable value, discounted to today, is what counts.",
"Takeaway: asset value ≠ realizable value. Haircut for tax, debt, legal overhang, time, and — most of all — whether the promoter actually intends to sell."
],
"company": "Bombay Dyeing",
"numbers": [
{
"label": "Headline land value",
"value": "~Rs 5,000 cr"
},
{
"label": "After haircuts",
"value": "~Rs 1,500 cr"
},
{
"label": "Deductions",
"value": "tax, debt, legal, time"
},
{
"label": "Key variable",
"value": "promoter intent"
}
]
}
],
"13": [
{
"tag": "pitfall",
"title": "When CFO refuses to follow PAT: the working-capital tell",
"body": [
"The single most powerful forensic check is free: compare cumulative operating cash flow (CFO) to cumulative reported profit (PAT) over several years. Real profit eventually turns into cash. If PAT keeps rising but CFO does not, the 'profit' may be living on paper.",
"The Manpasand Beverages saga is the textbook Indian warning. Reported revenue and profit grew rapidly, yet the cash never showed up in proportion, receivables and capex kept ballooning, and eventually the auditor abruptly resigned before results — the market later concluded much of the reported business was hollow.",
"The mechanical screen: if revenue grows ~30% but receivables grow ~60%, the company may be 'selling' by extending credit to shaky distributors or booking sales that will not collect. If inventory grows far faster than revenue, demand may be weaker than claimed. Over 3-5 years, CFO should track PAT reasonably; a persistent gap is a red flag, not a rounding error.",
"Takeaway: profit is opinion, cash is fact. When receivables and inventory outrun revenue and CFO lags PAT year after year, assume the earnings are suspect until proven otherwise."
],
"company": "Manpasand Beverages",
"numbers": [
{
"label": "Revenue growth",
"value": "~30%"
},
{
"label": "Receivables growth",
"value": "~60%"
},
{
"label": "CFO vs PAT",
"value": "persistent gap"
},
{
"label": "Auditor signal",
"value": "sudden resignation"
}
]
},
{
"tag": "pitfall",
"title": "Promoter pledging: the governance domino at Zee/Essel",
"body": [
"Promoter share pledging looks harmless in good times and turns lethal in bad ones. When promoters borrow against their own shares, a falling price forces lenders to sell the collateral — which pushes the price down further, triggering more forced sales. It is a reflexive trap.",
"The Essel Group / Zee episode showed the full cascade: heavy promoter pledging met a market shock, lenders threatened to dump pledged shares, and the stock collapsed sharply in a single stretch as the forced-selling spiral fed on itself. Minority holders who ignored the pledge line in the shareholding disclosure got hit by a risk that was fully visible in advance.",
"Pledging rarely travels alone. Pair it on the governance checklist with the other tells — promoter stake dilution, auditor changes, qualified audit opinions, unusual inter-company guarantees, serial acquisitions, and repeated fundraising. Two or three together should raise the discount rate you apply to the whole story.",
"Takeaway: high promoter pledging is leverage on leverage. Read the pledge percentage every quarter — it converts an ordinary correction into a forced-selling avalanche."
],
"company": "Zee Entertainment (Essel Group)",
"numbers": [
{
"label": "Risk",
"value": "forced lender selling"
},
{
"label": "Mechanism",
"value": "price fall → margin call"
},
{
"label": "Companion flags",
"value": "auditor exit, dilution"
},
{
"label": "Where to check",
"value": "quarterly pledge %"
}
]
}
],
"14": [
{
"tag": "scenario",
"title": "Writing the bear case three ways before you buy",
"body": [
"For every buy, force yourself to write the bear thesis in all three flavours — because they invalidate at different points. Take a richly valued consumer-internet name like Nykaa post-listing.",
"Type 1, earnings overstated: are the reported profits flattered by aggressive treatment — capitalised customer-acquisition or marketing spend, generous revenue recognition on marketplace vs inventory sales? If so, the 'profit' is softer than it looks. Type 2, earnings unsustainable: even if today's numbers are clean, is the current take-rate and growth a function of low competition that Reliance, Tata, and Amazon will compete away? Sustainable is different from real.",
"Type 3, valuation excessive: suppose earnings are both real and sustainable — is a ~1000x P/E still pricing a decade of flawless 30%+ growth with no slip? Even a great business can be a bad stock here. Crucially, define the invalidation for each: shrinking GMV growth, falling gross margin, or a de-rating below some multiple.",
"Takeaway: 'earnings overstated', 'earnings unsustainable', and 'valuation excessive' are three separate bear cases — a stock can be a sell on any one of them. Attach a concrete invalidation trigger to each."
],
"company": "Nykaa (FSN E-Commerce)",
"numbers": [
{
"label": "Type 1",
"value": "overstated"
},
{
"label": "Type 2",
"value": "unsustainable"
},
{
"label": "Type 3",
"value": "overvalued"
},
{
"label": "Each needs",
"value": "an invalidation trigger"
}
]
}
],
"15": [
{
"tag": "worked",
"title": "Sizing a position by expected value, not affection",
"body": [
"'I like Bajaj Finance' is not a position size. Size must reflect conviction, upside, downside, and probability together. Do the crude expected-value math before choosing the weight.",
"Say you judge a ~60% probability the bull case plays out with the stock up ~50%, and a ~40% probability it disappoints with a ~25% drawdown. Expected return = (0.60 × +50%) + (0.40 × −25%) = 30% − 10% = +20%. Positive and asymmetric — worth a real weight. Now compare a lottery idea: ~30% chance of +100%, ~70% chance of −40% gives (0.30 × 100) − (0.70 × 40) = 30 − 28 = +2% — barely positive and far riskier, so it earns a small weight at most.",
"Then adjust for correlation: if you already own HDFC Bank, Chola, and SBI, another lender does not diversify you — it concentrates a single macro bet on Indian credit and rates, so trim the Bajaj Finance weight for overlap.",
"Takeaway: position size = conviction × upside × downside × probability × correlation, not enthusiasm. Bigger edge and better asymmetry earn more capital; hidden correlation with what you already own shrinks it."
],
"company": "Bajaj Finance",
"numbers": [
{
"label": "Up case",
"value": "+50% @ 60%"
},
{
"label": "Down case",
"value": "-25% @ 40%"
},
{
"label": "Expected return",
"value": "+20%"
},
{
"label": "Correlation",
"value": "trim for lender overlap"
}
]
},
{
"tag": "scenario",
"title": "Four buckets: architecting a real Indian portfolio",
"body": [
"A portfolio is not a list — it is a structure with jobs assigned to buckets. Sort holdings by role, not by how much you like them, so you know why each rupee is there.",
"Core compounders (largest, steadiest weight): predictable franchises like Titan, Asian Paints, or Pidilite — you hold through cycles for durable ~15-18% compounding. Emerging multibaggers (medium weight, higher variance): earlier-stage stories like Kaynes or Amber where the thesis is playing out but not yet proven. High-risk acceleration (small weight): binary bets on a PLI ramp or a new molecule where you can afford to be wrong.",
"Special situations (opportunistic): a demerger or spin-off like an ITC hotels unlock, held for a specific event, not forever. And the watchlist: great businesses you would own at the right price, sized at zero until valuation cooperates. Each bucket has a different holding period and a different exit rule.",
"Takeaway: separate core compounders, emerging multibaggers, high-risk bets, and special situations into distinct buckets — mixing their weights and holding rules is how portfolios drift into accidental risk."
],
"company": "Titan / Kaynes / Amber / ITC",
"numbers": [
{
"label": "Core",
"value": "Titan, Pidilite"
},
{
"label": "Emerging",
"value": "Kaynes, Amber"
},
{
"label": "High-risk",
"value": "PLI / new-molecule bets"
},
{
"label": "Special sit.",
"value": "demergers / unlocks"
}
]
}
],
"16": [
{
"tag": "scenario",
"title": "Three reasons to sell a stock you still admire: Page Industries",
"body": [
"Selling is not one decision — it is three separate tests. Page Industries (Jockey) is a good lens because for years it was a flawless ~30%+ compounder, then matured.",
"Fundamental sell: has the thesis broken? If volume growth structurally slows from the mid-20s toward high single digits as the category saturates and competition (like new innerwear brands) bites, the growth engine that justified the premium has changed — that is a fundamental reason to reduce, not a temporary blip. Valuation sell: separate from fundamentals, if the stock still trades at ~70x while growth has halved, expected return versus risk has turned unattractive — and note the discipline, you don't sell merely because 'P/E is high', you sell because the return no longer compensates the risk.",
"Opportunity-cost sell: even if Page stays a fine business at a fair price, if you can redeploy that capital into a Kaynes or Amber with a clearly better risk-adjusted return, the good stock loses to the better one. Same money, higher expected compounding.",
"Takeaway: sell on a broken thesis, on unattractive risk-adjusted return, or on a materially better use of capital — three distinct triggers, none of which is the lazy 'the P/E looks high'."
],
"company": "Page Industries",
"numbers": [
{
"label": "Old growth",
"value": "~30%"
},
{
"label": "Matured growth",
"value": "~high single digit"
},
{
"label": "Illustrative P/E",
"value": "~70x"
},
{
"label": "Sell tests",
"value": "thesis / valuation / opp-cost"
}
]
}
],
"17": [
{
"tag": "scenario",
"title": "Running the 10 questions on the Dixon PLI story",
"body": [
"The checklist is only useful when you actually answer all ten out loud. Apply it to Dixon during the mobile-manufacturing PLI wave. 1) What changed: India's PLI scheme made local electronics assembly economically viable at scale. 2) Why: government incentives plus a China+1 shift by global brands. 3) Structural or cyclical: structural — a multi-year policy and supply-chain relocation, not a one-year order spike.",
"4) Evidence: signed contracts with global brands, new plants, rising disclosed volumes. 5) Revenue effect: revenue can multiply as new customers and categories ramp. 6) Margins/ROCE/FCF: here is the catch — EMS assembly is thin-margin (low-single-digit EBITDA), so revenue explodes but margins stay slim and working capital is heavy; ROCE depends on asset turns, not fat margins. 7) Competitors: Foxconn, Tata, and others are entering hard, so the moat is execution and scale, not exclusivity.",
"8) What the market prices: at a very high P/E, the price already assumes years of flawless scaling. 9) Catalyst: new PLI approvals, customer additions, backward integration into components. 10) What proves me wrong: PLI benefits fading, a key customer leaving, or margins staying stuck while the stock needs margin expansion.",
"Takeaway: the ten questions turn a hot narrative into a scorecard — Dixon can be a real structural story AND fully priced with thin margins at the same time, and only the checklist surfaces both truths."
],
"company": "Dixon Technologies",
"numbers": [
{
"label": "Driver",
"value": "PLI + China+1"
},
{
"label": "Nature",
"value": "structural"
},
{
"label": "EBITDA margin",
"value": "low single digit"
},
{
"label": "Moat",
"value": "scale / execution"
},
{
"label": "Disproof",
"value": "customer loss / PLI end"
}
]
},
{
"tag": "pitfall",
"title": "Question 3 saved you: mistaking a chemical upcycle for growth",
"body": [
"The most expensive checklist failure is skipping question 3 — structural or cyclical? During the 2021-22 chemical boom, names like Deepak Nitrite and Balaji Amines printed record profits as product spreads spiked on global shortages, and many investors extrapolated peak earnings forever.",
"Run the questions honestly. 1) What changed: profits and margins jumped. 2) Why: pandemic-driven supply disruption and a China shutdown widened spreads on products like acetonitrile and phenol. 4) Evidence: the margin spike showed up in realisations, not in volume or structural cost advantage. That is the fingerprint of a cyclical, not a structural, move.",
"So on question 8, if the stock is priced off peak EPS at a normal multiple, you are paying a peak multiple on peak earnings — a double trap. When spreads normalised, EPS fell and the multiple compressed together, and the stocks de-rated hard. Question 10's disproof — 'spreads mean-revert' — was the whole risk.",
"Takeaway: a margin spike driven by prices, not volumes or structural cost edge, is cyclical. Normalise the earnings before you value it, or you will capitalise a peak that is about to fade."
],
"company": "Deepak Nitrite / Balaji Amines",
"numbers": [
{
"label": "Profit driver",
"value": "spread spike"
},
{
"label": "Volume growth",
"value": "modest"
},
{
"label": "Signal",
"value": "cyclical, not structural"
},
{
"label": "Trap",
"value": "peak EPS × peak P/E"
}
]
}
],
"18": [
{
"tag": "scenario",
"title": "One name through the full pipeline: Polycab end to end",
"body": [
"The pipeline is a conveyor belt — a thesis should survive every station or get rejected. Run Polycab through it. Market & screening: large, growing wires-and-cables plus a fast-growing FMEG arm; screen catches rising ROCE and market-share gains. Business model & industry: it makes wires (steady, branded, distribution-led) and is building fans/switches/lighting (FMEG). Competitive position: #1 organised cables player gaining share from the unorganised sector — a real, widening moat via brand and dealer reach.",
"Capital cycle & inflection: capacity added ahead of a construction and electrification upcycle; the inflection is FMEG scaling and margin mix improving. Earnings decomposition & unit economics: cables carry decent margins with heavy copper working capital; FMEG is the future margin lever. External evidence: dealer channel checks, copper prices, real-estate and housing data triangulate the demand.",
"Normalized earnings & valuation: strip out any copper-price windfall to get clean earnings, then value; SOTP can value cables and FMEG separately. Market expectations, catalyst, bull/bear, invalidation: is the growth already priced? Catalyst is FMEG margin turning positive; the bear case is copper volatility and FMEG cash burn. Finally position size, portfolio fit, and monitoring the share-gain and FMEG margin every quarter.",
"Takeaway: a durable idea passes every station — market, model, moat, capital cycle, inflection, earnings quality, valuation, expectations, catalyst, bear case, sizing, and monitoring. If it fails one station, stop there rather than falling in love."
],
"company": "Polycab India",
"numbers": [
{
"label": "Core",
"value": "wires & cables #1"
},
{
"label": "Optionality",
"value": "FMEG scaling"
},
{
"label": "Key input",
"value": "copper WC"
},
{
"label": "Monitor",
"value": "share + FMEG margin"
}
]
}
],
"19": [
{
"tag": "scenario",
"title": "The one skill that pays most: spotting the mix-led inflection at Titan",
"body": [
"If you master only the top skill — detecting earnings inflection — pair it with reading product mix, and Titan is the masterclass. The lazy analyst stops at 'jewellery results were good'. The first-principle analyst asks WHY, because revenue growth ≠ business improvement.",
"Decompose it into unit economics. Titan's jewellery growth was not just more grammes sold; it was mix — a rising share of studded (diamond) jewellery and wedding sets that carry richer margins than plain gold, plus market-share capture from unorganised jewellers under the trust of the Tanishq brand. That is a structural mix shift, not a temporary festive pop.",
"This is exactly why mix is one of the strongest rerating mechanisms and why it feeds SOTP — the market began valuing Titan's jewellery franchise like a premium consumer brand, not a gold retailer, so the multiple expanded even as EPS compounded (jewellery revenue roughly compounded in the high teens to ~20% for years). Reading management language on 'studded ratio' and 'wedding share' each quarter was the tell before the numbers confirmed it.",
"Takeaway: the highest-value move is catching a structural, mix-driven inflection early — separate volume from mix, confirm it is structural not cyclical, and you capture both the EPS and the re-rating before the crowd."
],
"company": "Titan",
"numbers": [
{
"label": "Real growth",
"value": "mix + share, not just volume"
},
{
"label": "Margin lever",
"value": "studded ratio up"
},
{
"label": "Jewellery CAGR (illustr.)",
"value": "~20%"
},
{
"label": "Re-rating",
"value": "gold retailer → brand"
}
]
}
],
"20": [
{
"tag": "scenario",
"title": "Maruti's Q1: same volume, better profit — where did it come from?",
"body": [
"Suppose Maruti reports Q1 PAT up sharply and you stop there, concluding 'car demand is booming.' Bad habit. Instead decompose. Start with Revenue = Volume x Price x Mix. If units sold were roughly flat YoY but revenue still grew, say, 12%, then the growth did NOT come from volume — it came from price and mix.",
"Now ask which one. Maruti has been selling a richer mix of UVs and higher trims (Brezza, Grand Vitara) versus small hatchbacks. That is a mix effect: same number of cars, higher average selling price per car. Then move to EBIT = Revenue x EBIT margin, and ask why margin moved — softer commodity (steel) costs and operating leverage on a fixed cost base, not a one-off.",
"Only after you have attributed each rupee — volume flat, price up, mix richer, margin helped by raw material and leverage — do you glance at PAT to confirm the arithmetic ties out.",
"Takeaway: PAT is the last line you look at, not the first. Walk Volume to Price to Mix to Margin, and name the driver behind each move before you form a view."
],
"numbers": [
{
"label": "Volume YoY",
"value": "~flat"
},
{
"label": "Revenue YoY",
"value": "~+12%"
},
{
"label": "Driver",
"value": "Price + Mix"
},
{
"label": "Margin help",
"value": "Steel + leverage"
}
]
},
{
"tag": "worked",
"title": "APL Apollo: splitting a 20% revenue jump into its parts",
"body": [
"Say APL Apollo grows revenue from ₹1,000 cr to ₹1,200 cr in a quarter, +20%. Do not write '+20%, strong quarter' and move on. Decompose Volume x Price x Mix. Tonnage sold rose from, illustratively, 5.0 lakh tons to 5.75 lakh tons — that is +15% volume. The remaining ~5% came from higher realization per ton and a richer share of value-added products (heavy structural tubes, coated) versus plain black pipe.",
"Now the margin line. EBITDA per ton is the honest metric here. If EBITDA/ton moved from ~₹4,000 to ~₹4,600, that ~15% jump is being driven by the value-added mix and operating leverage — not by steel prices, which for a converter are largely a pass-through.",
"So the true one-liner is not 'revenue +20%.' It is 'volume +15%, realization/mix +5%, and EBITDA/ton +15% on value-added share.' That sentence tells you the growth is structural (more tons of better product), not a steel-price illusion.",
"Takeaway: turn one headline percentage into three — volume, price, mix — and separately explain the margin. If you can't attribute the move, you don't yet understand the result."
],
"numbers": [
{
"label": "Revenue",
"value": "₹1,000→1,200cr"
},
{
"label": "Volume",
"value": "+15%"
},
{
"label": "Price+Mix",
"value": "+5%"
},
{
"label": "EBITDA/ton",
"value": "₹4,000→4,600"
}
]
}
],
"21": [
{
"tag": "worked",
"title": "KEI/Polycab logic: shifting from wires to EPC & B2C changes the whole margin",
"body": [
"Take a cables company with two buckets. Old bucket — commodity house wires — earns say ₹10 EBITDA on ₹100 of sales (10%). New bucket — EHV cables, exports, retail-branded FMEG — earns ₹20 on ₹100 (20%). At a 90/10 old-to-new mix, blended EBITDA is (0.9x10)+(0.1x20) = ₹11, i.e. 11%.",
"Now shift the mix to 60/40 without any change in the underlying product margins: (0.6x10)+(0.4x20) = ₹14, i.e. 14%. Margin expanded ~300 bps purely from mix — even if total revenue barely grew. This is exactly the KEI/Polycab story as institutional cables and branded retail crowd out plain wire.",
"The teaching point is what you record. Don't just write 'EBITDA margin 14%.' Write 'value-added share rose 10% to 40%, and that alone lifts blend by ~300 bps.' That decomposition tells you the margin is structural and can keep climbing as the mix keeps shifting.",
"Takeaway: a company can re-rate its margins with almost no revenue growth simply by selling a richer mix. Always separate 'margin from mix' from 'margin from growth.'"
],
"numbers": [
{
"label": "Old product OPM",
"value": "10%"
},
{
"label": "New product OPM",
"value": "20%"
},
{
"label": "Mix 90/10 blend",
"value": "11%"
},
{
"label": "Mix 60/40 blend",
"value": "14%"
},
{
"label": "Margin gain",
"value": "~+300 bps"
}
]
},
{
"tag": "pitfall",
"title": "Navin Fluorine: don't extrapolate a bumper EBITDA/kg that management warned is temporary",
"body": [
"A specialty-chemicals firm like Navin Fluorine reports a quarter where a high-value CDMO molecule or a rich specialty batch spikes realization. Suppose blended EBITDA/kg jumps to a headline ~₹900 versus ~₹600 a year ago, and revenue in that segment is +100%+. The lazy read: 'new run-rate is ₹900, model it forever.'",
"But dig in. The +100% was driven by specialized, high-margin volumes shipped this quarter (mix), plus perhaps some spot pricing. Management then explicitly cautions that this EBITDA/kg will normalize as the mix rebalances and spot pricing fades. That warning is a gift — it stops you extrapolating a peak.",
"So carry two numbers side by side: the headline ~₹900/kg, and the underlying structural number, perhaps ~₹700–750/kg, that the business can sustain once the mix normalizes. Model the structural one; treat the gap as a one-off you do not annualize.",
"Takeaway: when a mix or pricing spike inflates a per-unit metric AND management flags normalization, separate the headline peak from the durable base — and build your forecast on the base."
],
"numbers": [
{
"label": "EBITDA/kg headline",
"value": "~₹900"
},
{
"label": "Prior year",
"value": "~₹600"
},
{
"label": "Structural est.",
"value": "~₹700–750"
},
{
"label": "Segment rev",
"value": "+100%+"
}
]
}
],
"22": [
{
"tag": "scenario",
"title": "Vedanta vs Divi's: telling a commodity spike from a capacity step-change",
"body": [
"Picture two companies both printing an EBIT margin of 30% in one quarter after running near 8–10% before. Same headline, opposite meaning. For a zinc/aluminium producer like Vedanta, that 30% is almost certainly an LME price spike. The path forward is likely 8 → 10 → 30 → 12: the metal price mean-reverts and margin collapses back. That is a spike — cyclical, not to be modelled.",
"For a company like Divi's, when a peak margin comes from a new high-value API line ramping and structurally shifting the mix, the path can instead be 8 → 10 → 30 → 22 → 24 → 26: it settles well above the old base as utilization and mix hold. That is a step-change — transformational.",
"The discipline is to never model the peak quarter as the new normal until you've answered 'why.' Ask what drove the 30%: an external price you don't control (spike) or an internal, repeatable capability like new capacity, new product, structurally lower cost (step-change).",
"Takeaway: a margin jump is only investable if the level after the jump stays elevated. Distinguish 8-10-30-12 (spike) from 8-10-30-22-24-26 (step-change) before you touch your model."
],
"numbers": [
{
"label": "Spike path",
"value": "8→10→30→12"
},
{
"label": "Step path",
"value": "8→10→30→22→24→26"
},
{
"label": "Model the peak?",
"value": "No"
}
]
}
],
"23": [
{
"tag": "scenario",
"title": "Astral at a margin premium to peers — earned or borrowed?",
"body": [
"Suppose Astral shows ~18% EBITDA margin in pipes while peers like Supreme, Prince and Finolex sit at ~13–15%. A 300–500 bps gap. The tempting conclusion — 'Astral is simply a superior business' — might be right, but you must first rule out the boring explanations.",
"Run the checklist. Is it product mix (Astral's higher-margin adhesives and a premium CPVC brand)? Genuine brand pricing power and distribution? Those justify a structural premium. Or is it a temporary lead-tin-crude PVC resin gain, an inventory gain in a rising-price quarter, or peers running at low utilization? Those are transient and will close.",
"In Astral's case a good chunk is defensible — brand, CPVC leadership, adhesives mix — but a slice in any given quarter can be inventory-driven. Peer comparison forces you to size the durable premium versus the borrowed one, so you don't capitalize a temporary gap into your terminal margin.",
"Takeaway: when a company beats peers by 300–1,000 bps, assume it's temporary until you can name the specific structural reason. Peers are a truth-serum for your margin assumption, not just a valuation tool."
],
"numbers": [
{
"label": "Astral OPM",
"value": "~18%"
},
{
"label": "Peer OPM",
"value": "~13–15%"
},
{
"label": "Gap",
"value": "300–500 bps"
},
{
"label": "Durable?",
"value": "Only if mix/brand"
}
]
}
],
"24": [
{
"tag": "worked",
"title": "Two steel-tube makers, same EBITDA — per-ton math reveals the real winner",
"body": [
"Company A and Company B both do ₹1,000 cr revenue. A earns ₹100 cr EBITDA (10%), B earns ₹150 cr (15%). B looks better. But margins alone hide the physics. Suppose A ships 10 lakh tons and B ships 5 lakh tons.",
"Compute per ton. A: revenue/ton = ₹10,000cr-value... in per-ton terms ₹1,000cr / 10 lakh tons = ₹10,000 revenue/ton and ₹100cr / 10 lakh = ₹1,000 EBITDA/ton. B: ₹1,000cr / 5 lakh = ₹20,000 revenue/ton and ₹150cr / 5 lakh = ₹3,000 EBITDA/ton. B makes three times the profit on every ton it ships.",
"This is why APL Apollo (a high-volume, thin per-ton converter) and a niche precision-tube maker like Ratnamani (low-volume, fat per-ton) can post similar-looking margins yet be completely different economic animals. EBITDA/ton exposes which one truly monetizes each unit of physical product.",
"Takeaway: for any manufacturer, convert the P&L to per-unit — EBITDA/ton, EBIT/unit, revenue/customer. Margin percentages compare businesses; per-unit metrics reveal them."
],
"numbers": [
{
"label": "A EBITDA/ton",
"value": "₹1,000"
},
{
"label": "B EBITDA/ton",
"value": "₹3,000"
},
{
"label": "A tons",
"value": "10 lakh"
},
{
"label": "B tons",
"value": "5 lakh"
},
{
"label": "Same EBITDA%?",
"value": "No — 10 vs 15"
}
]
},
{
"tag": "scenario",
"title": "Bajaj Finance: read the customer, not just the revenue",
"body": [
"For a lender or platform, revenue/customer and its cost twin tell the story a total-revenue line hides. Take Bajaj Finance. Instead of 'AUM grew 25%,' ask what each customer is worth: revenue per customer, cross-sell products per customer, and cost-to-acquire.",
"Illustratively, if the franchise grows to ~8–9 cr customers and each is being sold more products (loans, insurance, EMI card, deposits) over time, revenue/customer rises even without adding new customers as fast. That is operating leverage on an acquired base — the expensive part (acquisition) is already paid for, so incremental revenue per customer drops richly to the bottom line.",
"The warning flag is the mirror image: if customer count is racing ahead but revenue/customer is falling, growth is being bought, not compounded. Per-customer economics catch that before the consolidated P&L does.",
"Takeaway: in customer businesses, track revenue/customer and gross profit/customer over time. Rising per-customer value on a stable base is the highest-quality growth there is."
],
"numbers": [
{
"label": "Customers",
"value": "~8–9 cr"
},
{
"label": "Watch",
"value": "Rev/customer trend"
},
{
"label": "Good sign",
"value": "Cross-sell up"
},
{
"label": "Bad sign",
"value": "Count up, rev/cust down"
}
]
}
],
"25": [
{
"tag": "pitfall",
"title": "The ₹500 cr capex tweet: why 'huge growth coming' is the wrong reflex",
"body": [
"A mid-cap announces ₹500 cr capex and the timeline lights up: 'multibagger, huge growth incoming.' This is the single most common beginner error. Capex only buys the right to compete; it is potential capacity, nothing more. Revenue sits at the far end of a long chain.",
"Walk the chain honestly: Capex → Capacity built → Customer qualification (months, sometimes years for auto/pharma/grid customers) → Orders → Utilization ramp → Revenue → Operating leverage → EBITDA. Every arrow can stall. A plant can be commissioned and sit at 20% utilization for two years waiting for OEM approvals.",
"Contrast the empty version 'Company X built a factory' with the real thesis: 'X added capacity aimed at higher-value products, and independently, demand in that end-market is expanding, so the new capacity has a credible path to fill.' Only the second sentence is investable — it connects the capex to qualification, orders and demand.",
"Takeaway: capex is an input, not an outcome. Don't pay for the announcement; wait until the chain — qualification, orders, utilization — actually starts turning."
],
"numbers": [
{
"label": "Announced capex",
"value": "₹500 cr"
},
{
"label": "Capex =",
"value": "Potential only"
},
{
"label": "Missing links",
"value": "Qual→Orders→Util"
}
]
}
],
"26": [
{
"tag": "worked",
"title": "Ratnamani-style ramp: how new capacity can double revenue without more capex",
"body": [
"Start with existing capacity of 100,000 tons running at 80% utilization — so current production is 80,000 tons. The company commissions an equal-sized line, taking total capacity to 200,000 tons. Right after commissioning, utilization optically drops because the denominator doubled while volumes haven't caught up.",
"Now run the ramp. If utilization eventually climbs back to 80% on the enlarged base, production = 80% x 200,000 = 160,000 tons. That is a jump from 80,000 to 160,000 tons — production doubles, and if realizations hold, revenue roughly doubles too, all from filling capacity that is already built and paid for.",
"That is why a freshly commissioned plant can seed a multi-year earnings cycle: the growth doesn't need fresh capex, just utilization. But the ramp is conditional — you must check customer demand, qualification timelines, working capital to fund the extra inventory/receivables, product mix, and whether realizations hold as volumes rise.",
"Takeaway: post-expansion, the earnings driver is the utilization ramp, not new capex. Model the path from low utilization to steady-state, and pressure-test every assumption that lets the plant fill."
],
"numbers": [
{
"label": "Old capacity",
"value": "100,000 t"
},
{
"label": "New capacity",
"value": "200,000 t"
},
{
"label": "At 80% util",
"value": "160,000 t"
},
{
"label": "Production",
"value": "~2x"
},
{
"label": "Extra capex needed",
"value": "None"
}
]
}
],
"27": [
{
"tag": "worked",
"title": "Grading capex by its EBITDA return: bad, good, exceptional",
"body": [
"Not every ₹500 cr is created equal — judge it by the EBITDA it eventually throws off. Bad capex: ₹500 cr that yields ~₹40 cr EBITDA, an ~8% pre-tax asset return, below the cost of capital — value destructive. Good capex: the same ₹500 cr yielding ~₹125 cr, an ~25% gross return — attractive. Exceptional: ₹150 cr+ EBITDA on ₹500 cr, a 30%+ return that funds years of compounding.",
"Sharpen it to incremental ROCE. If ₹300 cr of capex eventually produces ₹75 cr of incremental EBIT, that's a 25% incremental pre-tax return — the kind of number that makes a Polycab or JK Cement expansion worth owning. But that headline can be too flattering.",
"Don't stop at the plant cost. The true incremental capital employed usually also includes additional working capital (inventory + receivables to support higher sales), ongoing maintenance capex, customer-acquisition spend, and any debt raised. Add those and the ₹300 cr denominator might really be ₹380–420 cr, pulling the honest incremental ROCE down.",
"Takeaway: capex quality = incremental EBIT / TRUE incremental capital employed. Always gross up the denominator for working capital and maintenance before you celebrate the return."
],
"numbers": [
{
"label": "Bad capex EBITDA",
"value": "₹40 cr / ₹500 cr"
},
{
"label": "Good capex EBITDA",
"value": "₹125 cr / ₹500 cr"
},
{
"label": "Exceptional",
"value": "₹150 cr+"
},
{
"label": "Incremental EBIT",
"value": "₹75 cr / ₹300 cr"
},
{
"label": "Incremental ROCE",
"value": "~25% (before WC)"
}
]
}
],
"28": [
{
"tag": "worked",
"title": "Dixon-style operating leverage: incremental margin far above the reported margin",
"body": [
"Reported margin tells you where a business has been; incremental margin tells you where it's going. Formula: incremental margin = change in EBIT / change in revenue. Take a scaling manufacturer. Revenue goes ₹1,000 → ₹1,300 cr (+₹300) and EBIT goes ₹100 → ₹160 cr (+₹60). Incremental margin = 60/300 = 20%, versus a reported margin that only moved from 10% to 12.3%.",
"Push to the next year. Revenue ₹1,300 → ₹1,600 cr (+₹300), EBIT ₹160 → ₹240 cr (+₹80). Incremental margin = 80/300 = 27%, while reported margin rises to 15%. The reported line drifts up slowly, but the incremental line — the margin on each new rupee of sales — is 20%, then 27%, and climbing.",
"That is the signature of operating leverage in an asset-light assembler like Dixon: fixed costs are absorbed, so every extra rupee of revenue converts at a much higher rate than the average. The reported margin lags reality because it blends old low-margin revenue with new high-conversion revenue.",
"Takeaway: watch incremental margin, not just reported margin. When each new rupee earns more than the last, the reported margin will keep grinding higher for years — that's the interesting story."
],
"numbers": [
{
"label": "Yr1 incremental",
"value": "60/300 = 20%"
},
{
"label": "Yr2 incremental",
"value": "80/300 = 27%"
},
{
"label": "Reported margin",
"value": "10%→12.3%→15%"
},
{
"label": "Signal",
"value": "Incrementals rising"
}
]
}
],
"29": [
{
"tag": "scenario",
"title": "The inflection ladder: watching a recycled-polyester bet climb rung by rung",
"body": [
"New businesses re-rate in stages, and your job is to know which rung is real. Stage 1 is Narrative — 'we are entering recycled polyester.' Interesting, unproven, and the market shouldn't pay much. Stage 2 Capex — ₹300 cr actually committed. Stage 3 Capacity — say 26,750 TPA built. Stage 4 Customer validation — trials with anchor buyers like Decathlon or A&E. Stage 5 Commercial commissioning — the plant genuinely starts producing.",
"The rungs that matter most for earnings come next. Stage 6 Utilization — 20% → 40% → 60% → 80%, where revenue finally becomes visible. Stage 7 Margin proof — actual EBITDA/ton, letting the market validate the economics rather than the story. Stage 8 Repeat customers, Stage 9 Additional customers and products — evidence of a real, widening business model.",
"Only at Stage 10 — with utilization, margins and repeat demand all proven — should you expect the market to assign a substantially higher multiple. The classic mistake is paying a Stage-10 multiple for a Stage-1 narrative; the classic edge is buying around Stage 5–6 when commissioning and the first utilization tick de-risk the story but the re-rating hasn't happened yet.",
"Takeaway: map every new-business thesis onto the ladder — Narrative, Capex, Capacity, Validation, Commissioning, Utilization, Margin proof, Repeat, Expansion, Re-rating — and pay a price appropriate to the rung actually reached, not the one being promised."
],
"numbers": [
{
"label": "Capex",
"value": "₹300 cr"
},
{
"label": "Capacity",
"value": "26,750 TPA"
},
{
"label": "Util ladder",
"value": "20→40→60→80%"
},
{
"label": "Re-rating rung",
"value": "Stage 10"
},
{
"label": "Best entry",
"value": "~Stage 5–6"
}
]
}
],
"30": [
{
"tag": "scenario",
"title": "Turning \"Ecosis is exciting\" into a six-question chain",
"body": [
"A beginner reads that Filatex is building Ecosis, a textile-to-textile recycling plant, and writes \"circular economy, huge, exciting.\" That is a feeling, not an analysis. Build the chain instead. The legacy business is polyester filament yarn (PFY) — a commodity where spreads move with crude and China, and where the existing earnings base is large but low-multiple. The transformation is a 26,750 TPA recycling facility that could sell higher-value recycled polyester at a different margin profile, still at the trial/MoU stage.",
"Now attack it with the six questions using round teaching numbers. Q1 Steady-state revenue: if 26,750 tons sell at say ~₹1.2 lakh/ton, that is roughly ₹320 crore of revenue. Q2 Steady-state EBITDA: at an assumed ~25% margin (better than commodity PFY), about ₹80 crore. Q3 EBITDA/ton: ₹80 crore / 26,750 tons is roughly ₹30,000 per ton — worth comparing against legacy PFY EBITDA/ton to see if the 'value-added' claim is real.",
"Q4 Capital required: suppose the plant costs ~₹400 crore. Q5 Incremental ROCE: ₹80 crore EBITDA on ₹400 crore capital is a ~20% pre-tax return — decent, not spectacular, and only if the ₹80 crore is real and not a launch-year sugar high. Q6 Share of total EBITDA: if Filatex's whole company does ~₹500 crore EBITDA, then ₹80 crore from Ecosis is roughly 15% — material but not the whole story.",
"The lesson: every optimistic word now has a number behind it, and each number is something you can go verify from the concall or annual report."
],
"numbers": [
{
"label": "Planned capacity",
"value": "26,750 TPA"
},
{
"label": "Steady-state revenue",
"value": "~₹320 Cr"
},
{
"label": "Steady-state EBITDA",
"value": "~₹80 Cr"
},
{
"label": "EBITDA/ton",
"value": "~₹30k"
},
{
"label": "Capital",
"value": "~₹400 Cr"
},
{
"label": "Share of total EBITDA",
"value": "~15%"
}
]
},
{
"tag": "pitfall",
"title": "The launch-year EBITDA/ton trap",
"body": [
"A common mistake in analyzing a new value-added line like Ecosis is to take the first good quarter's EBITDA/ton and multiply it by full capacity. Say early trial batches of recycled polyester fetch a premium and print ~₹40,000/ton of EBITDA on tiny volumes. Multiply that by 26,750 tons and you 'discover' ₹107 crore of EBITDA — and the stock looks like it has hidden gold.",
"The problem is that scarce, spec-approved trial material earns premiums that fade once the plant runs at scale and competitors add capacity. Deepak Nitrite's phenol and Navin Fluorine's specialty spikes both taught the same lesson: early, tight-supply economics normalize. A disciplined analyst normalizes EBITDA/ton to a defendable steady state — here ~₹30,000 — before answering the six questions.",
"Takeaway: for a new plant, ask 'what is the ton-economics after normalization and competition?', never 'what did the best trial quarter print?'"
],
"numbers": [
{
"label": "Trial EBITDA/ton",
"value": "~₹40k"
},
{
"label": "Normalized EBITDA/ton",
"value": "~₹30k"
},
{
"label": "EBITDA gap",
"value": "~₹27 Cr"
}
]
}
],
"31": [
{
"tag": "worked",
"title": "Building Filatex's SOTP from economics, not from a multiple",
"body": [
"Never start with \"Ecosis deserves 20×.\" Start with the two businesses' economics. Legacy PFY: normalized EBITDA ~₹300 crore, and because it is a commodity you attach a modest ~8× — that is EV of ₹2,400 crore. Ecosis: steady-state EBITDA ~₹80 crore, and because it is a differentiated circular-materials business you attach ~15× — EV of ₹1,200 crore.",
"Add the two EVs: ₹2,400 + ₹1,200 = ₹3,600 crore enterprise value. Now subtract net debt — say ₹600 crore — to get equity value of ₹3,000 crore. Divide by shares outstanding (illustratively ~44 crore shares) and you get roughly ₹680 per share of intrinsic value. Notice how the answer was built bottom-up, one business at a time.",
"Now stress it with scenarios on Ecosis alone. Bear: ₹50 crore EBITDA × 10× = ₹500 crore. Base: ₹75 crore × 15× = ₹1,125 crore. Bull: ₹100 crore × 20× = ₹2,000 crore. The Ecosis piece alone swings from ₹500 crore to ₹2,000 crore of EV — a four-fold range.",
"You do not need one exact number. You compare the market's current price to these three and ask: which case is today's price discounting? If it already reflects the bull EV, the exciting story is a bad entry."
],
"numbers": [
{
"label": "Legacy EV",
"value": "₹2,400 Cr"
},
{
"label": "Ecosis EV (base)",
"value": "₹1,200 Cr"
},
{
"label": "Net debt",
"value": "₹600 Cr"
},
{
"label": "Equity value",
"value": "₹3,000 Cr"
},
{
"label": "Ecosis bear→bull EV",
"value": "₹500→2,000 Cr"
}
]
}
],
"32": [
{
"tag": "worked",
"title": "Return = Earnings Surprise + Multiple Change, priced through the expectation gap",
"body": [
"The most important level is not 'is it a good company' but 'what is the market already pricing?' Suppose your model says Dixon does FY28 EPS of ₹200. Work out what the market implies: if the stock trades at ₹6,000 and the market is applying a ~40× exit multiple, it is effectively pricing FY28 EPS of ₹150 (6,000 ÷ 40). Your ₹200 versus the implied ₹150 is a positive expectation gap — upside even though the stock never looked 'cheap' on today's earnings.",
"Flip it. Suppose the same ₹6,000 price with a 40× multiple actually implies FY28 EPS of ₹250, and your honest estimate is only ₹200. Now you are below what is priced. Dixon can grow beautifully, execute well, and still lose you money, because the price already banked more than the company will deliver.",
"Put it in the core equation: Investment Return ≈ Earnings Surprise + Multiple Change. In case one you get a positive earnings surprise versus the implied bar; in case two you get a negative surprise and likely multiple compression as the market resets.",
"Takeaway: 'good company = good investment' is the amateur's equation. The professional's equation measures your estimate against the estimate embedded in the price."
],
"numbers": [
{
"label": "Your FY28 EPS",
"value": "₹200"
},
{
"label": "Implied (bull case)",
"value": "₹250"
},
{
"label": "Implied (upside case)",
"value": "₹150"
},
{
"label": "Exit multiple",
"value": "~40x"
}
]
}
],
"33": [
{
"tag": "scenario",
"title": "The hidden question: what does the market currently misunderstand?",
"body": [
"Every good earnings post is secretly asking one thing: 'what does the market misunderstand here?' Run the 12-line discipline on a few real archetypes before reading anyone else's view. Filatex: the market prices it as a PFY commodity manufacturer; the possible misunderstanding is that Ecosis quietly turns part of it into a higher-value circular-materials business the market isn't valuing yet.",
"Finolex Cables / optical fiber names: the market extrapolates a recent margin spike as permanent; the reality may be that part of the spike is cyclical tightness that mean-reverts. Morepen: a ₹825 crore CDMO order is being treated as permanent, recurring business — but you need evidence of repeat customers and multiple products before you capitalize it as steady-state.",
"Vidya Wires: a beginner sees margin compression and calls it a bad result, not realizing that copper is a pass-through — falling copper optically shrinks percentage margins while EBITDA/ton and new capacity, the metrics that actually matter, are fine or improving. TD Power Systems: raised guidance plus a growing order book plus proven execution means the market's earnings estimates simply have to move up — the misunderstanding is that consensus hasn't caught up yet.",
"The skill in all five cases is identical: state the market's current belief in one line, then state the specific reason it might be wrong, with the evidence you'd need to confirm it. Do this before you read a single external opinion."
],
"numbers": [
{
"label": "Morepen order",
"value": "₹825 Cr"
},
{
"label": "Lines before reading views",
"value": "12"
}
]
}
],
"34": [
{
"tag": "worked",
"title": "Why did EBITDA grow 68% when revenue grew only 40%?",
"body": [
"Take the hypothetical: revenue ₹500 Cr → ₹700 Cr (+40%), EBITDA ₹50 Cr → ₹84 Cr (+68%). The beginner cheers 'revenue +40%, EBITDA +68%, excellent.' The analyst asks a sharper question: why did EBITDA outgrow revenue? Compute incremental margin. Revenue rose by ₹200 crore; EBITDA rose by ₹34 crore. ₹34 / ₹200 = 17%.",
"So every incremental ₹100 of revenue dropped ₹17 of incremental EBITDA — well above the base 10% margin — which mechanically pulls the overall margin from 10% up to 12%. That gap between incremental margin (17%) and starting margin (10%) is the fingerprint of operating leverage or a richer product mix.",
"Now decompose the revenue growth: split it into volume, price and mix. The critical distinction is price versus mix — a steel-like price rise inflates both revenue and costs and rarely lifts margin, whereas selling more of a premium product (mix) lifts margin without needing higher prices. This is exactly how you'd read an Astral or a Polycab result: is the growth cables-tonnage, or is it a shift into higher-value products?",
"Takeaway: incremental margin, not headline growth, tells you whether a beat is real operating leverage — and the four types of margin expansion (volume leverage, mix, price, cost) each deserve a different multiple."
],
"numbers": [
{
"label": "Revenue growth",
"value": "+40%"
},
{
"label": "EBITDA growth",
"value": "+68%"
},
{
"label": "Incremental margin",
"value": "17%"
},
{
"label": "Base margin",
"value": "10%"
},
{
"label": "New margin",
"value": "12%"
}
]
}
],
"35": [
{
"tag": "scenario",
"title": "Reading a concall as 'which model variable just changed'",
"body": [
"Most people listen to a concall to answer 'is management bullish?' Wrong question. Listen to answer 'what variable in my earnings model just changed?' Take a Kaynes or Dixon concall. Management says three things: 'demand environment is robust' (Bucket: vague sentiment — worth zero to your model), 'we have commissioned the new OSAT/Sanand line' (Bucket: capacity clock — raises FY-forward volume capacity), and 'order book is now ~₹6,000 crore versus ₹4,000 crore' (Bucket: revenue visibility — directly feeds your revenue line).",
"Translate each into the model. 'Robust demand' changes nothing until it shows in orders. The commissioned line moves your capacity clock — you can now model higher peak revenue in 4-6 quarters. The order book jump of ~50% is the number management volunteered, and it is the one you build on. Notice you ignored the adjective and captured the number.",
"Then apply the contradiction technique: if management says 'margins will expand' but also 'we're entering lower-margin mass-market products,' those two statements fight — flag it and ask which wins. And apply the three clocks: capacity is being added now, customers qualify over 2-3 quarters, revenue shows up a few quarters after that. The clocks tell you WHEN the order book becomes EPS.",
"Takeaway: a concall is not a mood ring; it is a stream of updates to specific model variables, and your job is to catch the numbers management volunteers and file each statement in the right bucket."
],
"numbers": [
{
"label": "Order book (new)",
"value": "~₹6,000 Cr"
},
{
"label": "Order book (old)",
"value": "~₹4,000 Cr"
},
{
"label": "Order book jump",
"value": "~+50%"
},
{
"label": "Qualification lag",
"value": "2-3 qtrs"
}
]
}
],
"36": [
{
"tag": "worked",
"title": "The second derivative: acceleration, not just growth",
"body": [
"Most investors check if EPS is growing. Better ones check how fast. The strongest ones check whether the rate of growth is itself accelerating — the second derivative. Compare two companies. Company A grows EPS 20% → 25% → 20%: healthy but steady, decelerating at the end. Company B grows 10% → 20% → 35% → 50%: the growth rate is climbing every year. Company B is where an earnings inflection is forming.",
"Put rupees on it. Company B's EPS runs ₹10 → ₹11 → ₹13.2 → ₹17.8 → ₹26.7 as those accelerating rates compound. The market usually values on trailing growth, so it anchors to the early 10-20% and under-prices what the acceleration is about to do — that anchoring gap is the opportunity. This is how names like Kaynes or Dixon re-rated: growth wasn't just high, it was speeding up as new capacity and customers stacked.",
"But layer in duration and ROIIC before you get excited. Acceleration funded by capex only creates value if the return on incremental invested capital is high — a company that doubles capacity at 25% ROIIC is compounding value, one doing it at 8% is destroying it even while EPS accelerates. And ask how long the runway is: a two-year sprint into a saturated market is a very different asset from a decade-long structural driver.",
"Takeaway: hunt for accelerating growth rates, but only pay up when high ROIIC and long duration say the acceleration can actually persist."
],
"numbers": [
{
"label": "Company A rates",
"value": "20→25→20%"
},
{
"label": "Company B rates",
"value": "10→20→35→50%"
},
{
"label": "Company B EPS",
"value": "₹10→₹27"
},
{
"label": "Value-creating ROIIC",
"value": ">20%"
}
]
}
],
"37": [
{
"tag": "worked",
"title": "The 3x test: which engine — earnings or multiple — does the work",
"body": [
"A stock does not triple because someone says 'great company, huge opportunity.' It triples because earnings power and/or the multiple change enough to justify 3× the price. The equation: Return = (Earnings growth) × (Multiple change). So a 3× can come from earnings tripling at a flat multiple, or earnings roughly doubling (~1.7×) while the multiple expands ~1.8×, or any product that multiplies to 3.",
"Work a concrete case. Suppose a stock trades at ₹100 on ₹5 EPS — a 20× multiple. Path A (all earnings): EPS goes ₹5 → ₹15 over five years and the multiple stays 20× → price ₹300, a clean 3×. Path B (blended): EPS goes ₹5 → ₹9 (1.8×) and the multiple re-rates 20× → 33× (1.65×) because growth durability is now visible → 1.8 × 1.65 ≈ 3× → price ~₹300. Same 3×, very different risk.",
"Path A is safer because it leans on delivered earnings; Path B leans partly on the market's willingness to pay more, which you should never assume. Your job is to identify which engine drives the return and how much you are trusting multiple expansion. Then apply materiality: for Filatex, Ecosis only helps the 3× case if it is a meaningful share of total EBITDA — a 15% contributor can lift the blended growth rate, a 3% contributor cannot move a 3× outcome no matter how exciting.",
"Takeaway: decompose every target price into earnings-growth × multiple-change, prefer returns carried by earnings, and never let an exciting-but-immaterial segment carry a multibagger thesis."
],
"numbers": [
{
"label": "Start price",
"value": "₹100"
},
{
"label": "Start EPS / P/E",
"value": "₹5 / 20x"
},
{
"label": "Path A EPS",
"value": "₹15"
},
{
"label": "Path B EPS × re-rate",
"value": "₹9 × 33x"
},
{
"label": "Target",
"value": "~₹300 (3x)"
}
]
},
{
"tag": "pitfall",
"title": "The materiality ladder: exciting but too small to matter",
"body": [
"A frequent multibagger mistake is buying a large company for a small exciting segment. Imagine an UltraTech-sized cement major announces a green-hydrogen or waste-heat venture that could add ~₹100 crore of EBITDA. Investors get thrilled. But if the company already earns ~₹15,000 crore of EBITDA, the new venture is under 1% — it cannot move the stock even if it triples.",
"Climb the materiality ladder instead: for a segment to drive a 2× it usually needs to become a double-digit share of total EBITDA within your horizon, and it must be EBITDA mix that shifts, not just revenue. A low-margin ₹1,000 crore of new revenue that drops ₹50 crore of EBITDA changes the profit picture far less than the revenue headline suggests.",
"Contrast with a true needle-mover: for a mid-cap like Filatex, Ecosis at ~₹80 crore against ~₹500 crore total EBITDA is ~15% — high enough on the ladder to matter to the thesis and to justify studying it hard.",
"Takeaway: before you build a thesis on a new segment, compute its share of total EBITDA at steady state — excitement without materiality never becomes a multibagger."
],
"numbers": [
{
"label": "New venture EBITDA",
"value": "~₹100 Cr"
},
{
"label": "Large-co total EBITDA",
"value": "~₹15,000 Cr"
},
{
"label": "Share",
"value": "<1%"
},
{
"label": "Ecosis share (mid-cap)",
"value": "~15%"
}
]
}
],
"38": [
{
"tag": "scenario",
"title": "Building the KSH thesis: business, demand chain, bottleneck",
"body": [
"Step 1, understand the business. KSH makes Continuously Transposed Conductors (CTC), enamelled rectangular and round magnet wires, wrapped rectangular wires and specialty products, used in power transformers and electric machines. The instant recognition: this is NOT 'a copper company.' Copper is a pass-through input; the economics come from manufacturing skill, product specification, customer qualification, value-added mix and volume. That distinction decides whether you value it as a commodity or as a specialized component maker.",
"Step 2, find the structural demand driver. Don't say 'the power sector is bullish.' Build the chain: rising power demand → grid investment → transformer investment → transformer manufacturing → winding wires and CTC. KSH sits at the last, specific link. Now the macro theme (India's grid and transformer capex cycle, the same wave lifting names like Ratnamani or TD Power) is tied to a precise component KSH actually sells.",
"Step 3, find the bottleneck. CTC for large power transformers is a qualified, spec-heavy product with limited domestic suppliers — so if transformer demand is surging while qualified CTC capacity is scarce, KSH's value-added EBITDA/ton can hold or rise even as copper prices swing. That bottleneck is the profit lever; verify it with capacity utilization and the value-added share of volume, not with the copper price.",
"Takeaway: separate the pass-through input from the value-added economics, connect the macro to the exact component, then locate the bottleneck that lets that component earn abnormal margins."
],
"numbers": [
{
"label": "Key value-added product",
"value": "CTC"
},
{
"label": "End use",
"value": "Transformers"
},
{
"label": "Right margin metric",
"value": "EBITDA/ton"
}
]
}
],
"39": [
{
"tag": "worked",
"title": "The earnings gap: your estimate vs the estimate in the price",
"body": [
"The course's key transition: stop asking only 'what could this company earn?' and start asking 'what does the market already believe it will earn?' The return lives in the difference. Take a concrete example on a name like Persistent Systems. Your model, from order book and hiring, says FY27 EPS of ₹300. You then find consensus (broker estimates, and what the current multiple implies) sitting at ₹260.",
"Quantify the disagreement — always. Your ₹300 versus consensus ₹260 is a ~15% positive gap. Build the expectations bridge: what has to be true for the extra ₹40 of EPS? Say it needs ~2 points more margin and one large deal ramping on schedule. Each bridge item is now a falsifiable checkpoint you track quarter by quarter.",
"But an expected value isn't enough — model the surprise and its quality. A beat driven by durable revenue and margin (a 'high-quality beat') deserves upward estimate revisions and tends to produce post-earnings-announcement drift; a beat from a one-off tax credit or a forex gain (low quality) should be ignored. This is your PEAD filter: high-quality beat plus a raised order book plus a two-speed segment accelerating is the strongest signal; a low-quality beat on a decelerating base is a fade.",
"Takeaway: an investment edge is the measured gap between your estimate and the estimate embedded in the price, defended by a bridge of falsifiable items and filtered by the quality of the beat — not by whether the company is admired."
],
"numbers": [
{
"label": "Your FY27 EPS",
"value": "₹300"
},
{
"label": "Consensus EPS",
"value": "₹260"
},
{
"label": "Earnings gap",
"value": "~15%"
},
{
"label": "Bridge: margin delta",
"value": "~+2 pts"
}
]
}
],
"40": [
{
"tag": "worked",
"title": "First 5 minutes: turn a 300-page report into a two-variable equation",
"body": [
"In the first five minutes you flip past the glossy pages to the segment and product notes and see APL Apollo makes structural steel tubes — that answers 'what is this business.' Then you hunt for the economic engine: it does not really sell steel in rupees, it sells tonnes, so the unit-economics equation is EBITDA = volume (tons) x EBITDA/ton.",
"Illustratively, if it ships roughly 2.5 million tons at about Rs 4,500 EBITDA/ton, EBITDA is around Rs 1,100 cr. The entire 300-page report now collapses to two levers: can tons grow, and can EBITDA/ton rise as value-added products (large-diameter and coated tubes) mix up?",
"EBITDA/ton is powerful precisely because it strips out steel-price noise — a jump in revenue from costlier steel is meaningless, but a rising EBITDA/ton is a real signal of pricing power and mix."
],
"company": "APL Apollo Tubes",
"numbers": [
{
"label": "Volume (illus.)",
"value": "~2.5m tons"
},
{
"label": "EBITDA/ton",
"value": "~Rs 4,500"
},
{
"label": "EBITDA",
"value": "~Rs 1,100 cr"
},
{
"label": "VAP mix goal",
"value": "~65%"
}
]
},
{
"tag": "pitfall",
"title": "Reading the P&L and stopping there",
"body": [
"A junior analyst reads the first 40 marketing-heavy pages, sees revenue +25% and PAT +40%, and closes the file — that is the mistake. Two companies can print identical P&Ls; the notes tell you which one is real.",
"The professional jumps to the cash-flow statement (did CFO actually follow PAT, or is profit stuck in receivables?), the contingent-liabilities note (a Rs 500 cr disputed tax demand on a company earning Rs 300 cr PAT is material), related-party transactions (is 20% of 'sales' routed to a promoter entity?), and the auditor's report (any qualification or emphasis of matter?).",
"None of these live in the P&L, which is exactly why weak companies hope you never turn the page."
],
"numbers": [
{
"label": "Reported PAT",
"value": "+40%"
},
{
"label": "Contingent liab.",
"value": "Rs 500 cr"
},
{
"label": "PAT",
"value": "Rs 300 cr"
}
]
}
],
"41": [
{
"tag": "scenario",
"title": "The 10-minute quarterly triage that stops you chasing noise",
"body": [
"Polycab's quarterly result drops. You do not read the 30-page PDF — in ten minutes you extract ten numbers: revenue growth (say +20% YoY), volume vs price/mix, EBITDA growth, EBITDA margin (say ~13%), PAT, CFO, the order/EPC-exports book, and capacity utilization.",
"Then only five questions: what improved (margin), why (copper stabilised plus operating leverage), is it sustainable (yes if volume-led, no if just copper pass-through), did management change guidance, and did my FY27 model move?",
"Here is the discipline: if margin popped only because copper moved and guidance was unchanged, your FY27 EPS is the same — so do not chase the stock up 8% on results day. If instead the wires-and-cables volume run-rate structurally stepped up and B2C mix improved, then the model genuinely changes and the reaction is justified."
],
"company": "Polycab India",
"numbers": [
{
"label": "Revenue growth",
"value": "+20% YoY"
},
{
"label": "EBITDA margin",
"value": "~13%"
},
{
"label": "KPIs extracted",
"value": "10"
},
{
"label": "Questions asked",
"value": "5"
}
]
}
],
"42": [
{
"tag": "scenario",
"title": "Customer qualification: the domino that falls 18 months before revenue",
"body": [
"Financial statements are lagging indicators; qualification is a leading one. Picture an electronics or components maker that spends 12-18 months getting approved as a vendor for a global auto or transformer OEM. On the day approval is announced, revenue is still near zero and the P&L shows nothing.",
"But the inflection chain has already started: qualification leads to trial orders, then ramp, then revenue, then EBITDA, then EPS — typically four to eight quarters later. The analyst who reads the concall line 'we received approval from a marquee EU customer' and maps it into FY27 revenue is a year and a half ahead of the analyst waiting for the number to appear in the accounts.",
"That lead time between the signal and the earnings is the entire edge."
],
"numbers": [
{
"label": "Qualification lead",
"value": "12-18 months"
},
{
"label": "Signal to revenue",
"value": "4-8 quarters"
}
]
},
{
"tag": "worked",
"title": "Putting a capacity announcement on a clock and ramping utilization",
"body": [
"Suppose a plant does ~Rs 1,000 cr revenue at 90% utilization and management announces a new line doubling capacity, commissioning in ~18 months. The capacity clock starts today, but revenue only inflects when the new line fills, so you model the ramp: Year 1 post-commissioning ~40% utilization on the new line, Year 2 ~70%, Year 3 ~90%.",
"Because a chunk of cost (depreciation, fixed overhead, core staff) is fixed, incremental volume drops through at higher margin — say EBITDA margin rises from 18% toward 22% as utilization climbs. That is operating leverage.",
"But do not blindly extrapolate to 100%: a new plant also carries fresh depreciation and interest, and greenfield ramps slip. Model 70%, not full — the discipline of ramping utilization gradually is what separates a realistic model from a hopeful one."
],
"numbers": [
{
"label": "Base revenue",
"value": "~Rs 1,000 cr"
},
{
"label": "New line yr1",
"value": "~40% util"
},
{
"label": "New line yr3",
"value": "~90% util"
},
{
"label": "EBITDA margin",
"value": "18% -> 22%"
}
]
}
],
"43": [
{
"tag": "worked",
"title": "Reverse DCF: read the growth the market has already priced in",
"body": [
"The 'market is wrong' thesis needs a disagreement variable, and reverse DCF finds it. Take a stock at ~70x earnings. Instead of asking 'is 70x expensive,' ask what growth is baked in: at 70x, the market is roughly pricing something like 25% earnings CAGR for a decade before fading.",
"Now your job shrinks to one question — can it grow faster or slower than that implied ~25%? If your bottom-up build (capacity, utilization, mix, runway) says 30-35% is achievable for five-plus years, there is an expectation gap in your favour. If your honest build says 18%, the stock is priced for perfection and you pass, even though it is a wonderful company.",
"You never bet on quality alone; you bet on the gap between your independent estimate and the market's implied number."
],
"numbers": [
{
"label": "P/E",
"value": "~70x"
},
{
"label": "Implied CAGR",
"value": "~25%"
},
{
"label": "Your estimate",
"value": "~32%"
},
{
"label": "Expectation gap",
"value": "+7 pts"
}
]
},
{
"tag": "pitfall",
"title": "The cyclical trap: a low P/E on peak earnings is a sell signal",
"body": [
"A metals or steel producer trades at 5x earnings at the top of the cycle and looks 'cheap.' This is the wrong-normalization trap. At the peak, EBITDA/ton is abnormally high because spreads are stretched, so earnings are peak and the P/E is artificially low.",
"Apply the peak-vs-structural test: normalize to mid-cycle EBITDA/ton and the P/E on normalized earnings might be 15-18x — not cheap at all. The mirror image is just as important: the same stock at 25x on trough (near-zero) earnings can be the actual buy, because a low price is sitting on collapsed earnings about to recover.",
"Cyclicals look cheapest exactly when they are most dangerous."
],
"numbers": [
{
"label": "Peak P/E",
"value": "~5x"
},
{
"label": "Normalized P/E",
"value": "~16x"
},
{
"label": "Cycle position",
"value": "peak"
}
]
}
],
"44": [
{
"tag": "worked",
"title": "The receivables test: when +60% PAT is not +60% cash",
"body": [
"A company reports revenue +30%, EBITDA +40%, PAT +60% — beautiful headline. Now run the first forensic test on a multi-year view. Revenue grew 30% but receivables grew 60% and inventory grew 50%: sales are outpacing collection, so working capital is ballooning. Check the cash-flow statement — PAT is Rs 300 cr but CFO is only Rs 120 cr.",
"Three explanations for the receivables jump: genuine growth with a temporary lag, channel stuffing or aggressive revenue recognition, or weakening customers who cannot pay. Layer 1 (reported) says +60% PAT; layer 3 (cash) says the business generated far less.",
"If CFO keeps trailing PAT for two or three years, the earnings are low-quality no matter how good the headline looks."
],
"numbers": [
{
"label": "Revenue",
"value": "+30%"
},
{
"label": "Receivables",
"value": "+60%"
},
{
"label": "PAT",
"value": "Rs 300 cr"
},
{
"label": "CFO",
"value": "Rs 120 cr"
}
]
},
{
"tag": "scenario",
"title": "The clean version: CFO consistently above PAT",
"body": [
"Contrast that with a well-run asset-light or consumer business — think a depository-type model like CDSL or an FMCG like Nestle India. Here PAT is, say, Rs 200 cr and CFO is Rs 230 cr: cash conversion above 100% because the business collects upfront and runs on negative working capital.",
"There are no serial 'exceptional items,' depreciation roughly matches maintenance capex, and receivables grow slower than sales. This is the growth-quality equation in action — growth that throws off more cash than it reports is self-funding, needs no dilution, and compounds on its own.",
"That profile is what you want to confirm before you even open the valuation debate."
],
"numbers": [
{
"label": "PAT",
"value": "~Rs 200 cr"
},
{
"label": "CFO",
"value": "~Rs 230 cr"
},
{
"label": "Cash conversion",
"value": "~115%"
},
{
"label": "Working capital",
"value": "negative"
}
]
}
],
"45": [
{
"tag": "worked",
"title": "Incremental ROIC: the return on the next rupee, not the average one",
"body": [
"Historical ROCE describes the past; incremental ROIC describes the next rupee. Suppose a company deploys ~Rs 500 cr of fresh capital (capex plus working capital) over two years, and once ramped that investment adds ~Rs 150 cr of incremental EBIT. Incremental ROIC is roughly 150/500 = 30%.",
"Now the insight: a company can show a mediocre 14% historical ROCE, dragged down by old low-return assets, while its new capital earns 30% — the incremental number is the leading indicator that ROCE is about to rise. The reverse is the warning: a flattering high historical ROCE while new projects earn only 10% means value is being destroyed at the margin even as the headline dazzles.",
"Judge capital allocation by the newest investments, because that is where the future is decided."
],
"numbers": [
{
"label": "New capital",
"value": "~Rs 500 cr"
},
{
"label": "Incremental EBIT",
"value": "~Rs 150 cr"
},
{
"label": "Incremental ROIC",
"value": "~30%"
},
{
"label": "Historical ROCE",
"value": "~14%"
}
]
},
{
"tag": "scenario",
"title": "High ROIC plus a long runway is what makes a multibagger",
"body": [
"The compounding equation is roughly value creation = ROIC x reinvestment rate, so you need both a high return and a long runway to reinvest at that return. Titan illustrates it: high ROCE in jewellery plus a runway of decades, because organized players held only a small share of a huge, largely unorganized jewellery market — so it could plough profits back at high returns year after year and compound.",
"Now the trap: a company can earn 40% ROIC in a small, saturated niche with nowhere to reinvest. It becomes a cash cow paying dividends, not a multibagger, because the high return has no runway to work on.",
"High ROIC without runway compounds slowly; moderate-to-high ROIC with a long reinvestment runway is what turns small caps into multibaggers."
],
"company": "Titan",
"numbers": [
{
"label": "Titan jewellery ROCE",
"value": "high-20s %"
},
{
"label": "Runway",
"value": "decades"
},
{
"label": "Niche example ROIC",
"value": "40%"
},
{
"label": "Niche runway",
"value": "short"
}
]
}
],
"46": [
{
"tag": "scenario",
"title": "Qualification and switching cost: a moat you can time in years",
"body": [
"In pharma and specialty-fluorine chemistry, the moat is customer qualification plus switching cost. When an innovator qualifies a supplier like Divi's or Navin Fluorine for an API or key intermediate, that supplier gets written into the regulatory filing (the DMF). Re-qualifying an alternate vendor can take two to three years of audits, stability data and paperwork.",
"So even if a cheaper vendor appears, the customer stays sticky — switching risks disrupting a validated, regulator-approved supply chain for a small saving. The moat test is never 'good brand,' it is 'what stops competition from destroying these economics,' and here the answer is concrete: the time and cost of re-qualification.",
"That barrier protects both volume and margin for years, which is exactly what a moat is supposed to do."
],
"company": "Divi's Laboratories",
"numbers": [
{
"label": "Re-qualification time",
"value": "~2-3 yrs"
},
{
"label": "Moat type",
"value": "switching cost"
}
]
},
{
"tag": "pitfall",
"title": "A brand is a moat only if it produces durable pricing power",
"body": [
"'Strong brand' gets thrown around as a moat, but a brand only counts if it lets the company charge more, or sell more at equal cost, durably. Pidilite's Fevicol is a genuine brand moat: it is the default word for adhesive, distribution reaches millions of carpenters, and at a low ticket size no one bargains — so it commands real pricing power.",
"The pitfall: plenty of well-known brands earn poor returns because customers switch on price the instant a rival discounts — think commoditized apparel or generic electronics. Recognition without pricing power is not a moat.",
"Always convert 'brand' into a number: does it show up as durable, superior gross margin and low customer churn? If margins are stable and high across cycles, the brand is real; if they wobble with every competitor's promotion, the 'brand' is just a logo."
],
"company": "Pidilite Industries",
"numbers": [
{
"label": "Real test",
"value": "pricing power?"
},
{
"label": "Fevicol margins",
"value": "high & stable"
},
{
"label": "Verdict",
"value": "brand + distribution"
}
]
}
],
"47": [
{
"tag": "scenario",
"title": "Build a guidance ledger and check the walk, not the talk",
"body": [
"Ignore what management says at first; instead build a guidance ledger. Go back three to four years of concalls and write down what they promised versus what they delivered: 'guided 20% growth, did 22%; guided 15% margin, did 15.5%.' A pattern of under-promise and over-deliver builds credibility; a pattern of 'next year will be better' that never arrives is a red flag no matter how articulate the CEO.",
"Then run the walk-vs-talk checks management cannot spin: did the announced capex actually get commissioned on time and on budget, did they dilute equity via warrants or preferential allotments to promoters at a discount, and did promoters pledge or sell shares? A company that 'grew' EPS by issuing endless new shares grew nothing per share.",
"Specificity is another tell — precise capacity, timelines and named customers beat vague 'huge opportunity' talk every time."
],
"numbers": [
{
"label": "Concall history",
"value": "3-4 yrs"
},
{
"label": "Guided vs actual",
"value": "20% -> 22%"
},
{
"label": "Dilution check",
"value": "warrants/pref"
},
{
"label": "Promoter pledge",
"value": "target 0%"
}
]
}
],
"48": [
{
"tag": "scenario",
"title": "Structural inflection vs cyclical recovery in a PVC pipes maker",
"body": [
"The single distinction this lesson builds toward: is the company benefiting from a temporary industry cycle, or gaining structurally stronger economics? Take a PVC pipes player. If earnings jumped because PVC resin prices spiked and the whole industry's margins rose together, that is cyclical — it reverses when resin normalizes, and every competitor enjoyed the same tailwind.",
"The structural version looks different: the same company took market share from unorganized players (aided by GST and branding), added capacity ahead of demand, and shifted mix toward higher-value CPVC — so its volume and per-unit economics stepped up permanently, independent of the resin cycle.",
"Run the progress tracker — business model, industry demand, unit economics, volume/price/mix, capacity/utilization, earnings quality, leading indicators. Structural stories tick the volume-and-mix boxes; cyclical ones only tick price."
],
"numbers": [
{
"label": "Cyclical driver",
"value": "resin price"
},
{
"label": "Structural driver",
"value": "share + mix"
},
{
"label": "Mix shift",
"value": "-> CPVC"
}
]
}
],
"49": [
{
"tag": "worked",
"title": "The capacity cycle: fat margins seed the oversupply that kills them",
"body": [
"Industry economics come from the supply-demand balance, and capacity additions are the leading indicator. Say an industry runs at ~90% utilization — tight, so producers have pricing power and margins are fat. That very fatness invites everyone to announce expansions.",
"If industry capacity grows ~30% over two years while demand grows only ~15%, utilization falls toward ~78%, and the marginal producer starts cutting price to fill plants — margins compress industry-wide even though demand is still growing. This is the commodity-cycle trap: peak margins occur at peak utilization, exactly when the capacity that will destroy those margins is being built.",
"The opposite is the powerful setup — when no one has added capacity for years, demand catches up, utilization tightens, and pricing and EBITDA per unit explode off a low base. So track announced industry-wide capex, not just your company's, to see the swing coming."
],
"numbers": [
{
"label": "Start utilization",
"value": "~90%"
},
{
"label": "Capacity vs demand",
"value": "+30% / +15%"
},
{
"label": "End utilization",
"value": "~78%"
},
{
"label": "Margin",
"value": "compresses"
}
]
}
],
"50": [
{
"tag": "worked",
"title": "A great company at the wrong price: Asian Paints teaches 'return, not quality'",
"body": [
"Assume Asian Paints earns say Rs 40 EPS and the market pays 70x, so the stock is Rs 2,800. It is a wonderful business: high ROIC, brand moat, distribution depth. But ask the real question - at this price, what return do I earn? If EPS compounds at ~15% for 5 years, EPS reaches roughly Rs 80. If by then the market only pays a 'still-good-but-normal' 40x, the price is ~Rs 3,200.",
"That is barely +14% total over five years, under 3% a year, despite the business doing everything right. The company grew earnings ~2x, but you made almost nothing because the multiple compressed from 70x to 40x. The earnings engine ran forward while the valuation engine ran backward and cancelled it.",
"Now flip it: buy the same Rs 80 future EPS at an entry multiple of 45x instead of 70x. Same business, same growth, but your outcome swings from flat to a healthy double. Nothing about the company changed - only the price you paid.",
"Lesson: 'Is this a good company?' and 'At this price, what return will I earn?' are different questions. You can be completely right about the business and still lose, because de-rating silently eats compounding."
],
"numbers": [
{
"label": "Entry P/E",
"value": "70x"
},
{
"label": "Exit P/E (assumed)",
"value": "40x"
},
{
"label": "EPS CAGR",
"value": "~15%"
},
{
"label": "5Y total return",
"value": "~14%"
}
]
},
{
"tag": "worked",
"title": "EV/EBITDA vs P/E on a leveraged name: valuing the whole business",
"body": [
"Take a capital-heavy story like APL Apollo or a pipes/infra name carrying real debt. P/E looks at equity earnings only and ignores the balance sheet, so two companies with identical operations but different debt look 'differently priced' on P/E even though the underlying business is the same. EV/EBITDA fixes this by valuing the entire enterprise: EV = market cap + net debt.",
"Illustratively, say a company has market cap Rs 10,000 cr and net debt Rs 2,000 cr, so EV is Rs 12,000 cr. If EBITDA is Rs 1,500 cr, EV/EBITDA is 8x. A debt-free peer with the same Rs 1,500 cr EBITDA and Rs 12,000 cr market cap also trades at 8x EV - correctly showing the businesses are valued the same, even though the levered one shows a lower, flattering P/E.",
"Use P/E for stable, comparable-capital-structure businesses (Nestle, HDFC Bank-type). Use EV/EBITDA when debt differs or capex is heavy (metals, cement, infra). Use P/FCF when reported profit and real cash diverge, and EV/Sales only when margins are temporarily depressed or pre-profit.",
"Lesson: match the yardstick to the balance sheet. P/E can make a debt-laden company look cheap; EV/EBITDA asks the honest question - what am I paying for the whole business, debt included?"
],
"numbers": [
{
"label": "Market cap",
"value": "Rs 10,000 cr"
},
{
"label": "Net debt",
"value": "Rs 2,000 cr"
},
{
"label": "EV",
"value": "Rs 12,000 cr"
},
{
"label": "EBITDA",
"value": "Rs 1,500 cr"
},
{
"label": "EV/EBITDA",
"value": "8x"
}
]
}
],
"51": [
{
"tag": "scenario",
"title": "Tata Steel (cyclical) vs Astral (structural): same 100% profit jump, opposite meaning",
"body": [
"In an up-cycle a steel maker like Tata Steel or JSW can post 50% revenue growth and 100%+ profit growth as global steel prices spike. It looks like a rocket. But decompose it: volumes barely moved, realisation per tonne jumped because of the commodity price, and EBITDA/tonne ballooned. When the cycle turns, prices fall, and the same earnings collapse just as fast. This is Type C, a commodity spike riding on price, not durable.",
"Now take Astral over its pipes-plus-adhesives journey. Growth came from volume (new plants, deeper distribution) and from mix (moving toward higher-value products), while the category itself was shifting from unorganised to branded. The profit growth was slower to look dramatic but it stuck, quarter after quarter, because the drivers were structural, not a price blip.",
"The key test: ask 'what is driving the earnings - price or volume, cycle or share gain?' Price-driven, cycle-driven acceleration mean-reverts. Volume-plus-mix acceleration in a growing category compounds. A 100% EPS jump tells you nothing until you know which engine produced it.",
"Lesson: earnings acceleration is not one thing. Structural inflection deserves a high multiple and patience; a commodity spike deserves a low multiple and an exit plan. Decompose price vs volume before you pay up."
],
"numbers": [
{
"label": "Cyclical rev growth",
"value": "~50%"
},
{
"label": "Cyclical PAT growth",
"value": "~100%"
},
{
"label": "Cyclical driver",
"value": "Price/tonne"
},
{
"label": "Structural driver",
"value": "Volume + mix"
}
]
},
{
"tag": "worked",
"title": "The new-capacity trap: why a plant that doubles capacity can crush margins first",
"body": [
"Suppose a chemicals name like a mid-cap Deepak Nitrite-style player commissions a new plant that doubles capacity from 100 to 200 units. Management guides to big future revenue. But new capacity does not fill instantly. In year one, utilisation might be only ~40%, so you are running a bigger, more expensive asset base at low output.",
"Do the margin math illustratively: depreciation and interest on the new plant hit the P&L immediately (say fixed costs rise from Rs 30 to Rs 55), while revenue only inches up because volume is still ramping. So EBITDA margin actually dips in year one even though the 'story' is expansion. The stock can fall on this even though the thesis is intact.",
"The pay-off comes in years two and three as utilisation climbs toward 70-80%, fixed costs get spread over far more units, and operating leverage kicks in - now incremental volume drops almost straight to profit. Stabilisation of the plant (yields, quality approvals) matters as much as the capex itself.",
"Lesson: new capacity is a J-curve. Margins get worse before they get better. Judge the story by the utilisation curve and stabilisation timeline, not by the day-one press release."
],
"numbers": [
{
"label": "Capacity",
"value": "100 to 200"
},
{
"label": "Yr-1 utilisation",
"value": "~40%"
},
{
"label": "Mature utilisation",
"value": "~75-80%"
},
{
"label": "Yr-1 margin",
"value": "Dips first"
}
]
}
],
"52": [
{
"tag": "scenario",
"title": "Relative strength and PEAD: how Dixon's price front-ran the earnings",
"body": [
"Fundamentals told you the electronics-manufacturing (EMS) story - PLI scheme, brands outsourcing to Dixon, order wins. But the timing question is: when is the market starting to recognise it? Price and volume answer that. In a phase where the broader market was flat, an EMS leader like Dixon showing rising relative strength - outperforming the index week after week on expanding volume - is the market voting before the numbers fully print.",
"Why can price lead earnings? Because informed buyers accumulate ahead of the reported inflection; a stock making new highs while the index chops is a divergence worth respecting. But price leading fundamentals is not automatically bullish - it can also be hype with no earnings to follow, so you still need the fundamental change to be real.",
"PEAD - post-earnings announcement drift - is the follow-through: after a genuinely strong, above-expectation result, the stock often keeps drifting up for weeks because analysts are slow to revise. The highest-quality PEAD setup is a big beat plus upward earnings revisions plus price already showing relative strength. That is the three-layer model lining up: business, earnings, and price all pointing the same way.",
"Lesson: don't use charts to replace analysis - use them to time recognition. When strong fundamentals, an earnings beat, and rising relative strength coincide, the market is confirming your thesis, not contradicting it."
],
"numbers": [
{
"label": "Layers aligned",
"value": "3 of 3"
},
{
"label": "Setup",
"value": "Beat + revision + RS"
},
{
"label": "Drift window",
"value": "Weeks post-result"
}
]
}
],
"53": [
{
"tag": "worked",
"title": "The 1% winner vs the 20% loser: why sizing beats stock-picking",
"body": [
"You find a genuine 5-bagger. If it is 1% of your portfolio, a 5x means it goes from 1% to 5%, adding roughly +4 percentage points to your total return over the whole holding period. All that research, and it barely moves the needle because you sized it like an afterthought.",
"Now a position you were casual about, sized at 20%, falls 60%. That single loss is 20% x (-60%) = -12 percentage points off your portfolio. One oversized mistake just erased the gains from three separate 5-baggers held at 1% each. This is the asymmetry the lesson hammers: bad sizing lets one loser overwhelm several winners.",
"The fix is to size by conviction and by downside, not by excitement. Start near equal weight, then move up the conviction ladder only as evidence accumulates; keep an 'uncertainty budget' so unproven ideas stay small. Think in expected value: probability x payoff, with an eye on how bad the downside is if you are wrong.",
"Lesson: returns are made by how much you own of what works, not just by being right. A great idea sized at 1% is a hobby; a weak idea sized at 20% is a portfolio risk."
],
"numbers": [
{
"label": "5x at 1% weight",
"value": "~+4 pts"
},
{
"label": "-60% at 20% weight",
"value": "-12 pts"
},
{
"label": "Winners cancelled",
"value": "~3"
},
{
"label": "Start weight",
"value": "Equal-ish"
}
]
}
],
"54": [
{
"tag": "scenario",
"title": "The barbell portfolio: pairing HDFC Bank with a Kaynes-type emerging bet",
"body": [
"A portfolio is not your 20 best ideas dumped together - it is a system. A useful architecture is three buckets: core compounders (say HDFC Bank, Titan, Pidilite) that are stable and liquid; emerging inflections (a Kaynes or Amber-type name where the earnings change is still being recognised); and a smaller tactical/cyclical sleeve. The emerging bucket is critical because that is where re-rating and outsized returns are born - but each position there must be small because the failure rate is higher.",
"This is the barbell: heavy weight in a few high-conviction, high-quality compounders on one end, and a spread of smaller, higher-variance emerging bets on the other, with little in the mushy middle. Position size follows evidence and conviction, not market cap - do not let a stock's largeness masquerade as your conviction.",
"Watch the hidden risk: liquidity. A rule of thumb is that you should be able to exit within a few days without moving the price - the 20% liquidity idea - so a tiny illiquid name simply cannot be a large position no matter how good the thesis. Also build an exposure map: if your 'best ideas' are five capex/EMS plays, that is one bet on one theme, and correlation will punish you together.",
"Lesson: construct, don't collect. Balance stability and inflection, size by conviction and liquidity, and check that your positions are not secretly the same bet."
],
"numbers": [
{
"label": "Buckets",
"value": "3"
},
{
"label": "Core weight",
"value": "Largest"
},
{
"label": "Emerging position",
"value": "Small each"
},
{
"label": "Liquidity check",
"value": "Exit in days"
}
]
}
],
"55": [
{
"tag": "pitfall",
"title": "One bad quarter vs a broken thesis: the two-quarter rule on a retailer",
"body": [
"The classic mistake is selling because the stock moved, not because the business changed. Say you own a retailer like Avenue Supermarts (DMart) and one quarter margins dip on a competitive push or a cost blip. Panic-selling on a single soft print is reacting to price and noise. The two-quarter rule says: distinguish a genuine deterioration from ordinary quarterly variance before you act.",
"The right frame is the five reasons to sell: (1) thesis broken - the core reason you bought is factually invalidated; (2) sustained earnings deterioration - and revenue is usually your earliest warning, before margins and ROIC; (3) valuation genuinely excessive on a forward-return basis; (4) governance or capital-allocation red flags - a dilutive raise, a related-party deal, per-share economics quietly worsening; (5) a clearly better opportunity for the capital.",
"So when the retailer wobbles, ask: is same-store-sales growth structurally rolling over (thesis risk), or is this one noisy quarter? If revenue growth and store economics are intact, the dip is variance - you may even add. If footfall, SSSG and ROIC deteriorate across two quarters, the thesis is cracking and you sell regardless of price.",
"Lesson: sell because expected future return or the thesis has deteriorated, not because the ticker fell. And when you do sell, run the 'what would I buy today?' test - if you would not buy it now, why are you still holding?"
],
"numbers": [
{
"label": "Reasons to sell",
"value": "5"
},
{
"label": "Confirm window",
"value": "2 quarters"
},
{
"label": "Earliest warning",
"value": "Revenue"
},
{
"label": "Wrong trigger",
"value": "Price alone"
}
]
}
],
"56": [
{
"tag": "scenario",
"title": "A 60-minute teardown of a Polycab-type wires-and-cables story",
"body": [
"Don't research chronologically from 'company founded in...'. Compress. Minutes 0-5, find the economic driver and build a driver tree: for a cables leader like Polycab, revenue is roughly volume (tonnes/km of cable) x realisation (copper-linked price) x mix (commodity cable vs higher-margin branded/FMEG products), plus an emerging B2C leg. That tree tells you which lever actually moves earnings.",
"Minutes 5-15, hunt the growth engine - and prize acceleration over mere growth. Is revenue growth speeding up, and is it organic (share gains, distribution) or inorganic? Separate the copper-price tailwind (a pass-through, low quality) from real volume and mix improvement (high quality). A shift toward FMEG and exports is a mix story worth more than a copper blip.",
"Minutes 15-25, check cash and capital efficiency: is working capital ballooning as it grows (channel financing, inventory), because growth that consumes cash is fragile? Look at ROIC and especially incremental ROIC - the return on the new capital being deployed - which is where a capex story earns or destroys value. Minutes 25-35, find the catalyst and rank it: a signed order or a commissioned plant beats a vague 'management is optimistic'.",
"Lesson: the goal isn't to know everything in 60 minutes - it's to answer five questions (what's changing, how much can earnings move, why might the market be wrong, what breaks the thesis, is the risk/reward worth deeper work). Information compression is the professional skill."
],
"numbers": [
{
"label": "Minute 0-5",
"value": "Driver tree"
},
{
"label": "Minute 5-15",
"value": "Growth engine"
},
{
"label": "Minute 15-25",
"value": "Cash + ROIC"
},
{
"label": "Minute 25-35",
"value": "Catalyst"
},
{
"label": "Questions to answer",
"value": "5"
}
]
}
],
"57": [
{
"tag": "scenario",
"title": "Reading the inflection: Kaynes and the EMS revenue-plus-margin double engine",
"body": [
"A good company is not automatically a multibagger. The re-rating fuel is an inflection: the company's future economics changing faster than the market expects. Take an EMS/electronics story like Kaynes. Inflection #1, revenue acceleration - growth stepping up from moderate to very high as PLI, import substitution and new customer wins land. That alone is worth stars, but ask what causes it: new customers (Inflection #6) and order-book acceleration (Inflection #7).",
"Layer on Inflection #7 carefully - a booming order book is powerful but can mislead if orders are low-margin, slow to execute, or cancellable, so quality of the book matters, not just size. Then the multiplier: Inflection #3, product mix - moving from low-margin box-assembly toward higher-value, semiconductor/OSAT and complex products lifts margins structurally (Inflection #2, margin expansion).",
"The most powerful combination is when several inflections fire together: revenue accelerating and margins expanding and mix improving and new capacity (Inflection #4) filling as utilisation rises (Inflection #5). That is multiplicative - revenue up 40% with margins expanding can send profit up far more, and the market re-rates the multiple on top. That double-compounding is where large re-ratings come from.",
"Lesson: don't just ask 'is it a good business?' Ask 'what is inflecting, and are several inflections stacking?' One inflection is a trade; three or four compounding together is a multibagger setup."
],
"numbers": [
{
"label": "Inflections stacking",
"value": "3-4"
},
{
"label": "Rev acceleration",
"value": "Step-up"
},
{
"label": "Mix shift",
"value": "Higher value"
},
{
"label": "Margin",
"value": "Expanding"
}
]
},
{
"tag": "worked",
"title": "Operating leverage inflection: how utilisation turns 30% revenue growth into 60% profit growth",
"body": [
"Inflections #4 and #5 - capacity and utilisation - are where earnings quietly explode. Take any fixed-cost-heavy manufacturer, say a Ratnamani or an APL Apollo-type plant. Illustratively: revenue Rs 1,000, variable costs Rs 600, fixed costs Rs 300, so EBITDA is Rs 100, a 10% margin. Now the same plant fills up and revenue rises 30% to Rs 1,300 with utilisation climbing.",
"Variable costs scale with volume to ~Rs 780, but fixed costs stay near Rs 300 because the asset is already built. New EBITDA is 1,300 - 780 - 300 = Rs 220. Margin jumped from 10% to ~17%, and EBITDA more than doubled on just 30% more revenue. That is operating leverage from rising utilisation - the incremental volume dropped mostly to profit.",
"This is why the capacity ladder and utilisation curve are five-star inflections: the market often models revenue growth linearly and underestimates the margin expansion that comes free once fixed costs are absorbed. The same math is why incremental ROIC on an already-built plant can be spectacular.",
"Lesson: in fixed-cost businesses, watch utilisation, not just revenue. When a plant crosses from under-utilised to full, profit growth runs far ahead of revenue growth - and that gap is where the market gets surprised."
],
"numbers": [
{
"label": "Revenue growth",
"value": "+30%"
},
{
"label": "EBITDA before",
"value": "Rs 100"
},
{
"label": "EBITDA after",
"value": "Rs 220"
},
{
"label": "Margin before",
"value": "10%"
},
{
"label": "Margin after",
"value": "~17%"
}
]
}
],
"58": [
{
"tag": "worked",
"title": "Reverse-engineering the multiple: what 60x is already telling you about Titan",
"body": [
"Move from company analysis to stock analysis: a wonderful, accelerating business can still be a poor stock if the good news is already priced in. Your edge is variant perception - where your view of future economics differs materially from the market's. First separate four numbers: current fundamentals, management's guidance, consensus estimates, and your own estimate.",
"Now reverse the valuation. Suppose a jeweller like Titan trades at ~60x earnings. Instead of asking 'is 60x too high?', ask 'what growth must the company deliver to justify 60x?' Illustratively, a 60x multiple typically implies the market is baking in something like ~20%+ earnings growth sustained for many years. That is the market's embedded expectation, reverse-engineered from price.",
"Now there are only three possible conclusions: your estimate is above what's priced in (you have positive variant perception - potential buy), roughly equal (no edge - the stock is efficient), or below (negative variant - avoid, even if the company is great). If you think Titan grows ~15% but the price demands ~22%, you have no edge here no matter how much you admire the brand.",
"Lesson: growth isn't enough - you must beat what's already embedded in the multiple. Reverse-engineer the market's expectation first, then bet only when your honest estimate is genuinely different, and you can say why."
],
"numbers": [
{
"label": "Multiple",
"value": "~60x"
},
{
"label": "Implied growth",
"value": "~20%+"
},
{
"label": "Your estimate",
"value": "~15%"
},
{
"label": "Variant",
"value": "Negative"
},
{
"label": "Numbers to separate",
"value": "4"
}
]
}
],
"59": [
{
"tag": "worked",
"title": "Ranking 20 good companies: why a lower-P/E name can rank below a higher-P/E one",
"body": [
"With Rs 10 lakh and 20 attractive companies, one dimension will mislead you. Never rank on P/E alone. Compare across the ten dimensions - earnings inflection, revenue quality, margin quality, ROIC and incremental ROIC, structural runway, catalyst strength and timing, variant perception, valuation and balance sheet - with earnings inflection weighted most heavily.",
"Illustratively, put two names side by side. Company A: 40x P/E, but earnings accelerating from 15% to 30%, high incremental ROIC, long runway, a clear near-term catalyst, and genuine variant perception. Company B: 18x P/E, but growth flat at ~12%, mediocre incremental ROIC and no catalyst. On a 100-point model, A can outscore B even though B is 'cheaper' - because A's PEG is actually lower and its compounding is real.",
"Use PEG carefully: 40x on 30% growth (PEG ~1.3) can be far better value than 18x on 12% growth (PEG ~1.5), and a low P/E on a no-growth business is a value trap, not a bargain. Let technical confirmation act as a tiebreaker among the top few - but never let a chart override the fundamental ranking.",
"Lesson: cheapness is a single dimension; capital allocation is multi-dimensional. Rank on inflection, quality of growth, runway and variant perception - a higher-P/E compounder often beats a lower-P/E stagnator."
],
"numbers": [
{
"label": "Dimensions",
"value": "10"
},
{
"label": "A: P/E / growth",
"value": "40x / 30%"
},
{
"label": "B: P/E / growth",
"value": "18x / 12%"
},
{
"label": "A PEG",
"value": "~1.3"
},
{
"label": "B PEG",
"value": "~1.5"
},
{
"label": "Top weight",
"value": "Inflection"
}
]
}
],
"60": [
{
"tag": "worked",
"title": "Two companies, both PAT +80% — only one is a real inflection",
"body": [
"Imagine two pipe/plastics companies both report PAT up 80% in the same quarter. Company A: revenue up ~25% (mostly volume), gross margin up 300 bps because raw-material PVC softened and stayed soft, EBITDA up ~40%, and CFO grew in line with profit. Company B: revenue flat, but it booked a fat inventory gain because PVC prices spiked, plus a chunk of other income from treasury, plus a one-off lower tax rate — all sitting on a weak base quarter last year.",
"Walk the numbers down the P&L, not up. For A, the +80% traces to operating lines you can repeat: more units sold, structurally better mix, cash actually arriving. For B, strip out the inventory gain, normalize other income and tax, and the operating PAT is barely up — the 80% evaporates.",
"The tell is the CFO/PAT ratio and the source of margin. A converts profit to cash (CFO/PAT near 1); B's cash lags badly because the 'profit' was a paper revaluation of inventory that reverses the moment PVC mean-reverts.",
"Lesson: a headline PAT number is an output, not a thesis — decompose it into revenue (volume vs price), margin bridge, and cash conversion before you believe an 'inflection.'"
],
"numbers": [
{
"label": "A revenue growth",
"value": "~25% (volume-led)"
},
{
"label": "A CFO/PAT",
"value": "~1.0"
},
{
"label": "B revenue growth",
"value": "~0%"
},
{
"label": "B PAT ex one-offs",
"value": "~flat"
},
{
"label": "Both headline PAT",
"value": "+80%"
}
]
},
{
"tag": "pitfall",
"title": "The commodity margin illusion at Tata Steel / Vedanta-type names",
"body": [
"A classic trap: a metals or commodity chemical company prints record EBITDA and PAT, the stock looks 'cheap' at 4x earnings, and a new investor extrapolates it. But in commodities the margin is spread, not skill — realization minus input cost — and both legs are set by global cycles, not the company.",
"Illustratively, if steel realization is ~₹65,000/ton against a ~₹45,000/ton cost, the ₹20,000 spread can be double the mid-cycle ~₹10,000. Multiply peak spread by peak volume and you get peak EBITDA that a low P/E dresses up as value. When the spread normalizes, EBITDA can halve with zero change in tonnage.",
"The right move is to use physical volume (tons) and per-ton spread, then normalize the spread to a mid-cycle band before valuing. A cyclical at trough P/E on peak earnings is usually expensive, not cheap.",
"Lesson: for commodity businesses, low P/E on peak-spread earnings is a warning label, not a bargain — always normalize the spread."
],
"numbers": [
{
"label": "Peak spread",
"value": "~₹20,000/ton"
},
{
"label": "Mid-cycle spread",
"value": "~₹10,000/ton"
},
{
"label": "Peak P/E look",
"value": "~4x"
},
{
"label": "EBITDA at normal spread",
"value": "~half"
}
]
}
],
"61": [
{
"tag": "scenario",
"title": "Dixon says 'we've been qualified by a large global brand' — run the evidence ladder",
"body": [
"On a concall, Dixon-type management says: 'We have been qualified by a marquee global customer and expect meaningful ramp next year.' That is a claim, not a fact. Your job is to convert it into something testable and then wait for the business to prove it.",
"Climb the Concall Evidence Ladder. Rung 1: the verbal claim (weakest). Rung 2: named customer or signed contract. Rung 3: capex committed for that line. Rung 4: capacity commissioned. Rung 5: revenue actually showing in the segment. Rung 6: margins on that revenue holding. Each quarter, mark where the claim currently sits.",
"Build a tiny tracker: date, claim, expected timeline, and 'proof so far.' If two quarters later the customer is still 'in advanced discussions' and no capex line item appears, the claim is drifting — that timeline drift is itself the signal.",
"Lesson: treat every forward statement as a hypothesis and record the date and expected timeline, so a claim that keeps slipping outs itself even when the tone stays confident."
],
"numbers": [
{
"label": "Ladder rungs",
"value": "6"
},
{
"label": "Believe from rung",
"value": "≥4 (capacity)"
},
{
"label": "Drift alarm",
"value": "2 quarters, no proof"
}
]
},
{
"tag": "pitfall",
"title": "Guidance upgrade vs a big absolute number — and creeping hedge-words",
"body": [
"New analysts anchor on the absolute guidance ('20% growth guided!'). But the information is in the change. A company that quietly raises FY guidance from ~15% to ~20% mid-year is telling you the internal order book improved — that upgrade is worth more than a peer that guided 20% at the start and is now hedging.",
"Equally important is language degradation. Compare quarter-on-quarter: 'we will commission by Q2' becomes 'we expect to commission by H2' becomes 'commissioning is largely on track.' The certainty is falling even though the sentence still sounds positive. That is decreasing certainty plus timeline drift stacked together.",
"Contrast an APL Apollo or Polycab-type name that keeps upgrading and hits its dates against one whose targets stay flat but whose adjectives get softer each call. The transcripts, read side by side, tell you who is compounding confidence and who is managing a shortfall.",
"Lesson: track the delta in guidance and the delta in language across calls — upgrades and firmer wording are bullish data; softening hedge-words are a downgrade management hasn't formally admitted yet."
],
"numbers": [
{
"label": "Guidance before",
"value": "~15%"
},
{
"label": "Guidance after",
"value": "~20%"
},
{
"label": "What matters",
"value": "the +5pp change"
}
]
}
],
"62": [
{
"tag": "worked",
"title": "A boring company with a hidden fast segment — the multiple migration",
"body": [
"Take an illustrative firm valued as one boring commodity business. Segment A (commodity) does ~₹800 cr EBITDA and deserves ~6x. Segment B, a fast-growing specialty/branded arm, does ~₹200 cr EBITDA today but is growing 30%+ and deserves ~20x. The market, looking only at the blended low multiple, values the whole at ~6x × ₹1,000 cr = ~₹6,000 cr.",
"SOTP: A = 6 × 800 = ₹4,800 cr; B = 20 × 200 = ₹4,000 cr; total ~₹8,800 cr — versus the ₹6,000 cr the market pays. The gap exists because B is only 20% of EBITDA and is drowned in the consolidated optics.",
"Now add time. As B compounds, EBITDA mix shifts — say B goes from 20% to 40% of EBITDA in three years. The blended multiple mechanically drifts up toward B's, so you get earnings growth AND multiple re-rating together. That combination is the most powerful re-rating engine in equities.",
"Lesson: when a small high-quality segment is buried inside a cheap parent, watch the EBITDA mix — the re-rating leads the reported numbers as the good segment's weight crosses into visibility."
],
"numbers": [
{
"label": "Segment A",
"value": "6x × ₹800cr = ₹4,800cr"
},
{
"label": "Segment B",
"value": "20x × ₹200cr = ₹4,000cr"
},
{
"label": "SOTP value",
"value": "~₹8,800cr"
},
{
"label": "Market value",
"value": "~₹6,000cr"
},
{
"label": "B EBITDA mix",
"value": "20% → 40%"
}
]
},
{
"tag": "pitfall",
"title": "Three ways SOTP lies to you — double count, debt, and peak earnings",
"body": [
"SOTP is easy to abuse. Mistake 1 — double counting: you value a listed subsidiary at full market cap AND count its profits again inside the parent's consolidated EBITDA. Pick one; a holdco like Bajaj Holdings should be valued on its stakes, then a holdco discount applied.",
"Mistake 2 — ignoring net debt: you sum segment enterprise values into a glossy ₹10,000 cr and forget the ₹3,000 cr of consolidated debt. Equity value is EV minus net debt; skip it and you overstate the stock by exactly the leverage.",
"Mistake 3 — peak earnings: you slap a high specialty multiple on a segment's cyclically inflated EBITDA. If that ₹200 cr is really ₹120 cr mid-cycle, your 20x is being applied to a peak that will normalize — a double error of high multiple on high base.",
"Lesson: after building the parts, always net out debt once, count each rupee of profit once, and multiply the multiple by normalized (not peak) segment earnings."
],
"numbers": [
{
"label": "Sum of parts EV",
"value": "~₹10,000cr"
},
{
"label": "Less net debt",
"value": "~₹3,000cr"
},
{
"label": "Equity value",
"value": "~₹7,000cr"
},
{
"label": "Holdco discount",
"value": "typical 20-50%"
}
]
}
],
"63": [
{
"tag": "scenario",
"title": "APL Apollo — why the profit pool, not the market size, is the moat",
"body": [
"Structural steel tubes looked like a commodity nobody could win. The question isn't 'is the market big and growing?' — it is 'who captures the profit pool and why can't rivals take the economics away?' APL Apollo answered it with scale + distribution + a wide SKU range that small fabricators and regional players simply cannot match on cost or availability.",
"Do the share-gain math. If the tubes market grows ~10% but the leader takes share from ~30% toward ~50% while adding value-added products at better margins, its own volume can grow well above market and its per-ton profit rises at the same time — growth plus mix, both flowing to one player.",
"The barrier is that a new entrant faces a cost curve it can't climb quickly: it needs plants near demand, a dealer network, and enough volume to price competitively — a chicken-and-egg problem that protects the incumbent's ROIC even in a 'commodity.'",
"Lesson: industry growth is shared by everyone; durable returns come from who owns the profit pool and what stops the next entrant from replicating the cost and distribution position."
],
"numbers": [
{
"label": "Market growth",
"value": "~10%"
},
{
"label": "Leader share",
"value": "~30% → ~50%"
},
{
"label": "Company volume growth",
"value": ">market"
},
{
"label": "Per-ton profit",
"value": "rising with mix"
}
]
},
{
"tag": "scenario",
"title": "Fevicol and CDSL — switching costs and customer qualification as moats",
"body": [
"Two very different businesses, one lesson. Pidilite's Fevicol owns the carpenter's habit: the contractor specifies it, the end-customer never sees the tube, and switching to a ₹5-cheaper glue risks a bond failure the carpenter is blamed for. The switching cost is behavioral and reputational, so Pidilite keeps pricing power that a low-cost rival cannot dislodge with price alone.",
"CDSL's moat is structural and regulatory: it is one of two depositories, revenue rises with the number of demat accounts and market activity, and no customer 'shops' for a depository. New entry is effectively closed by regulation and the network of connected DPs.",
"In both, ask the moat questions: what determines customer choice (habit / mandated infrastructure), and what prevents new entrants (brand + distribution for Fevicol, regulation + network for CDSL). High ROIC persists because the answer to 'who can take the economics away?' is 'almost nobody, quickly.'",
"Lesson: the strongest moats aren't the biggest markets — they are switching costs (Fevicol) and qualification/regulatory barriers (CDSL) that let a company keep growing profitably while rivals stay locked out."
],
"numbers": [
{
"label": "Depositories in India",
"value": "2"
},
{
"label": "Fevicol pricing power",
"value": "premium held for years"
},
{
"label": "Choice driver",
"value": "habit / mandated infra"
}
]
}
],
"64": [
{
"tag": "worked",
"title": "Model a cement/chemical plant from capacity up, never from EPS down",
"body": [
"Take a JK Cement-type unit. Never start at EPS. Start at the physical driver: installed capacity ~10 mtpa. Utilization this year ~75%, so volume ≈ 7.5 mt. Realization ≈ ₹5,000/ton, so revenue ≈ 7.5 mt × ₹5,000 = ₹37,500 cr-equivalent (illustrative units). EBITDA/ton ≈ ₹1,000, so EBITDA ≈ ₹750 cr-equivalent.",
"Now add a driver change, not an EPS guess. A new ~2 mtpa line commissions, but don't assume 100% — ramp it to ~60% in year one, adding ~1.2 mt of volume. Hold realization flat and per-ton EBITDA roughly steady, and the incremental EBITDA falls straight out of volume × spread.",
"Then flow the tail: add D&A from the new plant, add interest on the debt that funded it, apply the tax rate, divide by share count. If the capex was funded by an equity raise, the higher share count can offset the earnings — which is exactly the KRN-type capital-allocation trap where growth doesn't reach per-share earnings.",
"Lesson: build earnings bottom-up from capacity × utilization × realization × per-unit margin, ramp new capacity realistically, and always finish through interest, tax and share count — because that is where growth either reaches the shareholder or leaks away."
],
"numbers": [
{
"label": "Capacity",
"value": "~10 mtpa"
},
{
"label": "Utilization",
"value": "~75%"
},
{
"label": "Realization",
"value": "~₹5,000/ton"
},
{
"label": "EBITDA/ton",
"value": "~₹1,000"
},
{
"label": "New line ramp Yr1",
"value": "~60%"
}
]
}
],
"65": [
{
"tag": "scenario",
"title": "Trent — good stock because the market underestimated duration",
"body": [
"The central equation of expectations investing: you make money not from a good business, but from a business that is better than what the price already assumes. Trent (Westside/Zudio) is a case where the variant perception was duration, not a single quarter.",
"For years consensus modeled fast growth 'for a while' and then a fade to mid-teens as the base got large. The variant view was that the store-addition runway and same-store economics could sustain high growth far longer than assumed — i.e., the market underestimated the duration of the growth, not its magnitude this year.",
"That matters because valuation compounds duration. If the market prices ~4 years of 20% growth and the business actually delivers ~8 years, the stock re-rates as each year proves the runway is longer — even if any single quarter is only 'in line.' Your edge was a different terminal assumption, sourced from industry structure (retail penetration, format economics), not from a data leak.",
"Lesson: the most durable variant perceptions are usually about how long growth lasts, not how big next quarter is — and duration edges come from understanding the industry, not from forecasting one print."
],
"numbers": [
{
"label": "Consensus duration",
"value": "~4 yrs high growth"
},
{
"label": "Variant duration",
"value": "~8 yrs"
},
{
"label": "Edge type",
"value": "duration, not magnitude"
}
]
},
{
"tag": "pitfall",
"title": "Nestlé India is a great company — and that alone won't make you money",
"body": [
"Good company ≠ good stock. Nestlé India is a wonderful franchise, but at times it has traded at ~70-80x earnings, a price that already bakes in years of double-digit growth and margin stability. Buying it there, you are not betting it's a good business — everyone knows that — you are betting it will beat an already-lofty bar.",
"Run the two separate questions. Question one: is the business improving? Often yes. Question two: what does the price already expect? If the multiple embeds ~15% growth for a decade and the company delivers a perfectly respectable ~10%, the stock can stagnate for years while earnings grow — a de-rating quietly eats your return.",
"The mirror image is a merely-okay business priced for disaster: modest good news beats a grim bar and the stock jumps. The money is in the gap between delivery and expectation, in either direction.",
"Lesson: always ask 'what is already in the price?' — a great company at a price that expects greatness offers no edge; your return comes only from the delta between reality and consensus."
],
"numbers": [
{
"label": "Rich multiple",
"value": "~70-80x"
},
{
"label": "Expected in price",
"value": "~15% for years"
},
{
"label": "Actual delivered",
"value": "~10% (still good)"
},
{
"label": "Result",
"value": "flat stock, de-rating"
}
]
}
],
"66": [
{
"tag": "worked",
"title": "Conviction tiers plus evidence — sizing from 2% to 8%",
"body": [
"The objective isn't maximum upside; it's maximum long-run compounding while capping the odds of permanent loss. So size by conviction AND by where the thesis sits on the evidence hierarchy. Illustrative tiers: high conviction ~8%, medium ~4%, starter/optionality ~2%.",
"But conviction alone is dangerous — a confident story with no proof is just a feeling. Anchor size to evidence. A new-capacity thesis where capex is only announced starts small (~2%). Once the plant is commissioned and utilization is climbing, uncertainty falls and you step the position up toward ~4-6%. Once revenue and margins from it actually show, you can take it to full weight.",
"This is the staircase: position size increases as uncertainty falls, not as the price rises. If the stock has already tripled but nothing was proven, you don't chase; if the proof arrived and the valuation is still sane, you add.",
"Lesson: let position size be a function of evidence, not excitement — start small on unproven theses and climb the staircase as each proof point removes risk."
],
"numbers": [
{
"label": "High conviction",
"value": "~8%"
},
{
"label": "Medium",
"value": "~4%"
},
{
"label": "Starter",
"value": "~2%"
},
{
"label": "Size driver",
"value": "falling uncertainty"
}
]
},
{
"tag": "scenario",
"title": "The asymmetry test and the thesis-break line — don't sell on price alone",
"body": [
"Before sizing, run the asymmetry test: estimate downside if you're wrong versus upside if you're right. A name with ~20% downside to a hard valuation floor and ~100% upside if the thesis plays out is a 5:1 payoff and earns a bigger weight than a symmetric bet, even at equal conviction. The point is controlling permanent loss, not volatility.",
"Separate the two. Volatility is a Bajaj Finance-type quality name falling 30% in a market swoon with the business intact — that is noise, and mechanically selling into it converts temporary drawdown into permanent loss. Thesis break is different: NIM structurally compressing, asset quality deteriorating, growth stalling — the reasons you owned it are gone.",
"So pre-commit a thesis-break framework in writing: the 2-3 conditions that would prove you wrong. Then use the price-action-vs-thesis matrix — price down but thesis intact = add or hold; price down and thesis broken = sell; price up and thesis intact = let it run. Averaging down is only allowed when the thesis is verifiably intact, never mechanically.",
"Lesson: size by asymmetry and never confuse a lower price with a broken thesis — write down what would make you wrong in advance, and let that, not the quote, drive adds and exits."
],
"numbers": [
{
"label": "Downside",
"value": "~20%"
},
{
"label": "Upside",
"value": "~100%"
},
{
"label": "Payoff",
"value": "~5:1"
},
{
"label": "Sell trigger",
"value": "thesis break, not price"
}
]
}
],
"67": [
{
"tag": "pitfall",
"title": "Fifty stocks, one bet — the factor-concentration trap",
"body": [
"The seductive error: 'I own 50 companies, so I'm diversified.' Not if they all rise and fall for the same reason. Suppose your 50 names are heavy on NBFCs, real-estate ancillaries, and consumer discretionary — every one of them is really a bet on falling interest rates and a strong credit cycle. That is one macro position wearing 50 costumes.",
"The fix is to map by bucket and by factor, not by ticker. Sort holdings into buckets — core compounders, earnings accelerators, inflections, special situations, optionality — and then build a factor map: rate-sensitivity, commodity input, export/FX, capex-cycle, monsoon/rural. If ~70% of the book lights up under 'rate-sensitive,' company count is an illusion of safety.",
"Correlation matters more than count. Ten genuinely uncorrelated theses — a CDSL (market activity), a Divi's (global pharma capex), an APL Apollo (construction), a Varun Beverages (consumption) — diversify far better than 40 flavors of the same credit-cycle trade. Build a theme heatmap and cap any single theme's weight.",
"Lesson: diversification is measured in independent drivers, not number of stocks — map your factor exposures, because 50 correlated names is still a single bet."
],
"numbers": [
{
"label": "Nominal holdings",
"value": "50"
},
{
"label": "Real bets",
"value": "maybe 1-2 factors"
},
{
"label": "Danger sign",
"value": "one factor >~40% of book"
}
]
}
],
"68": [
{
"tag": "scenario",
"title": "Five different reasons to sell — and why 'the price fell' isn't one",
"body": [
"A stock you own drops 25%. Before acting, identify which of five sell reasons, if any, actually applies — because they demand opposite actions. (1) Thesis failure: the business stopped doing what you expected — e.g. a Dixon-type name loses a key customer program; that's a real sell. (2) Valuation failure: a quality compounder ran to a price where future returns are poor even if it executes. (3) Expectation failure: the market now expects more than the business can deliver, so even good results disappoint.",
"(4) Opportunity-cost failure: nothing is wrong, but another idea now offers materially higher expected return, so you rotate capital to the better payoff. (5) Portfolio-risk failure: the winner has grown to ~15% of the book or become highly correlated with three other holdings, and prudence caps it.",
"Notice that a falling price is on none of these lists by itself. If HDFC Bank or Bajaj Finance drops with the market but the deposit franchise, growth and asset quality are intact, that is volatility, not a sell signal — reacting to the quote converts a paper wobble into a realized loss.",
"Lesson: name the specific failure — thesis, valuation, expectations, opportunity-cost, or portfolio-risk — before you sell; if none applies and only the price moved, you have no reason to act."
],
"numbers": [
{
"label": "Valid sell reasons",
"value": "5"
},
{
"label": "'Price fell' as a reason",
"value": "0"
},
{
"label": "Trim trigger",
"value": "position ~>15% / correlated"
}
]
}
],
"69": [
{
"tag": "worked",
"title": "The CFO/PAT test and the Two-Quarter Rule in action",
"body": [
"Selling on evidence, not emotion, needs mechanical tripwires. The CFO/PAT test: over a full year, operating cash flow should broadly track reported profit. If a company reports steady PAT but CFO/PAT slides from ~1.0 toward ~0.4 while receivables and inventory balloon, the 'earnings' are turning into paper — a cash-flow failure that often precedes a nasty print.",
"Pair it with the Two-Quarter Rule: don't sell on one weak quarter (noise happens), but if a core thesis pillar — say incremental margins, or guidance, or cash conversion — deteriorates for two consecutive quarters, treat it as a trend, not a blip, and act. One miss is data; two aligned misses is a pattern.",
"Illustratively: Q1 CFO/PAT dips to 0.6 and management blames a one-off; you note it. Q2 it's 0.5, receivable days jump again, and guidance is quietly softened. Two quarters, three pillars weakening together — the thesis is breaking on operations, and you exit before the market fully reprices it.",
"Lesson: pre-set objective triggers like CFO/PAT and the Two-Quarter Rule so an operating deterioration forces a decision — you sell on the second confirmed crack, not on the first scary headline or the price."
],
"numbers": [
{
"label": "Healthy CFO/PAT",
"value": "~1.0"
},
{
"label": "Warning CFO/PAT",
"value": "~0.4-0.5"
},
{
"label": "Confirm trend",
"value": "2 consecutive quarters"
}
]
},
{
"tag": "pitfall",
"title": "Selling a great compounder — valuation and expectations, not anchoring",
"body": [
"The hardest sell is a wonderful business that simply got too expensive. Use the expected-return test, not your purchase price. If a Titan or Asian Paints-type compounder can grow earnings ~15% a year but trades at a multiple so stretched that the multiple must de-rate, your forward expected return might be ~5% even as the company thrives — the classic 'too good to hold at this price' problem.",
"Distinguish valuation sell from expectations failure. Valuation sell: the price bakes in a return you can no longer earn. Expectations reset: the market's implied growth (say ~20% for a decade) exceeds what the business can plausibly deliver (~13%), so future results, however good, will disappoint against the embedded bar.",
"The pitfall to avoid is anchoring: 'I'll sell when it gets back to my cost' or 'I can't sell, it's a great company.' Neither your entry price nor the company's quality is a valuation. And beware the opposite error too — excessive switching, churning out of compounders on every 10% wobble, which racks up taxes and forfeits the compounding you bought them for.",
"Lesson: judge the sell on forward expected return and the expectations already priced in — a superb business can still be a sell at the wrong price, but don't confuse that with restless over-trading."
],
"numbers": [
{
"label": "Earnings growth",
"value": "~15%"
},
{
"label": "Implied by price",
"value": "~20% for years"
},
{
"label": "Forward expected return",
"value": "~5%"
},
{
"label": "Anchor to avoid",
"value": "your cost price"
}
]
}
],
"70": [
{
"tag": "scenario",
"title": "You are handed KEI Industries and 45 minutes — what actually happens",
"body": [
"Imagine a PM drops the latest KEI quarter on your desk and says, 'Tell me if this is interesting.' You do NOT open the P/E first. In the first 5 minutes you answer: what does KEI sell? Roughly, it sells house wires (retail, high margin), cables (institutional), and EPC projects (lumpy, low margin). Earnings are really driven by the mix shift toward retail wires plus capacity utilisation.",
"In the next 10 minutes you decompose the quarter: was revenue up because volumes grew, or because copper prices rose and pushed realisations up? You separate the two. Then you check earnings quality: did PAT grow because of operations, or because of a one-off, lower tax, or an inventory gain on copper.",
"By minute 45 you should be able to say one sentence: 'KEI's growth is real, volume-led, and mix is improving toward retail wires — this is repeatable,' OR 'this quarter was flattered by copper and a low base — not repeatable.' That single verdict is the entire job.",
"The lesson: the 45-minute process exists to convert an unfamiliar company into one repeatable sentence about whether the earnings will recur."
],
"company": "KEI Industries",
"numbers": [
{
"label": "Minute 0-5",
"value": "Business"
},
{
"label": "Minute 5-10",
"value": "Decompose Q"
},
{
"label": "Minute 10-15",
"value": "Earnings quality"
},
{
"label": "Output",
"value": "1 verdict"
}
]
}
],
"71": [
{
"tag": "worked",
"title": "Build the business equation: APL Apollo is a spread business, not a steel business",
"body": [
"Beginners model APL Apollo as 'revenue up when steel prices rise.' Wrong equation. Write it properly: Revenue = Volume (tonnes) × Realisation per tonne. But PROFIT = Volume × Spread per tonne (the conversion margin APL earns for turning flat steel into structural tubes), which is largely independent of the absolute steel price.",
"Illustratively, say APL sells ~2.8 million tonnes at an EBITDA spread of roughly Rs 5,000 per tonne. That gives EBITDA of about 2.8m × 5,000 = Rs 1,400 crore. Now notice: if steel prices fall 10% but volumes and spread hold, revenue drops but EBITDA barely moves. If instead volume grows 15% and spread expands to Rs 5,500 on richer product mix, EBITDA jumps even in a falling-steel-price world.",
"So the two things you actually track are tonnage growth and spread per tonne — not the headline topline, which is just steel price noise passing through.",
"The lesson: find the company's true earnings driver and model THAT unit economics; for a converter, model the spread per tonne, not the revenue."
],
"company": "APL Apollo Tubes",
"numbers": [
{
"label": "Volume",
"value": "~2.8m tonnes"
},
{
"label": "Spread/tonne",
"value": "~Rs 5,000"
},
{
"label": "Implied EBITDA",
"value": "~Rs 1,400 cr"
},
{
"label": "Track",
"value": "Tonnes + spread"
}
]
},
{
"tag": "worked",
"title": "The four engines of growth: why Titan's mix matters more than its volume",
"body": [
"Earnings can grow from four engines: volume, price, product mix, and operating leverage. Titan's jewellery arm shows why mix is the most powerful. Plain gold jewellery earns a thin margin; studded (diamond) jewellery earns a much richer margin. So the studded ratio is a margin lever that hides inside a flat-looking topline.",
"Illustratively, say jewellery revenue is Rs 100 with plain at ~8% EBIT and studded at ~20% EBIT. If the studded share moves from 25% to 35% of sales, blended margin rises even if total gold tonnage did not grow at all. Blended EBIT goes from roughly (0.75×8 + 0.25×20) = 11% to (0.65×8 + 0.35×20) = 12.2% — a jump from mix alone.",
"Add operating leverage: Titan's fixed store and brand costs are spread over higher revenue, so incremental sales drop through at a higher margin. Two engines (mix + leverage) compound on top of simple volume.",
"The lesson: decompose growth into its four engines; product mix and operating leverage are where durable margin expansion usually hides."
],
"company": "Titan",
"numbers": [
{
"label": "Studded EBIT",
"value": "~20%"
},
{
"label": "Plain EBIT",
"value": "~8%"
},
{
"label": "Mix 25%→35%",
"value": "Blended +1.2pp"
},
{
"label": "Engines",
"value": "Vol/Price/Mix/Leverage"
}
]
}
],
"72": [
{
"tag": "worked",
"title": "Finolex Cables: strip the copper before you believe the inflection",
"body": [
"Suppose Finolex reports revenue up 25% year-on-year and the market cheers an 'earnings inflection.' First question: is this volume or price? Copper is roughly 60-70% of a cable's cost, and copper prices swing. If copper rose ~20%, most of that 25% revenue jump is just a higher price passing through, not more cables sold.",
"Now the margin bridge, which matters more. When copper prices rise, companies book an inventory gain — cheap copper bought earlier is sold into higher prices — and gross margin looks inflated for a quarter or two. Illustratively, if 'normalised' EBITDA margin is ~11% but a copper-inventory tailwind pushed reported margin to ~14%, then roughly 3 points of that margin is a commodity gift, not operating skill.",
"So the correct model separates: (a) real volume growth in wires/cables, (b) price/pass-through, and (c) transient inventory gains. Annualising a copper-inflated quarter is how analysts overpay.",
"The lesson: reported earnings acceleration in a commodity-input business must be split into volume, pass-through, and inventory gain before you call it sustainable earnings power."
],
"company": "Finolex Cables",
"numbers": [
{
"label": "Reported rev",
"value": "+25% YoY"
},
{
"label": "Copper in cost",
"value": "~60-70%"
},
{
"label": "Normalised OPM",
"value": "~11%"
},
{
"label": "Reported OPM",
"value": "~14%"
}
]
},
{
"tag": "pitfall",
"title": "The dangerous benchmarking mistake: Finolex optical fibre is not Polycab wires",
"body": [
"A very common error: an analyst sees Finolex's optical-fibre segment margins spike and benchmarks them against a structural grower like Polycab's wires, concluding 'Finolex deserves the same re-rating.' This confuses a commodity cycle with a durable franchise.",
"Optical fibre pricing is cyclical — when global telecom capex booms and fibre is short, prices and margins balloon; when capacity floods in, they collapse. So a great fibre quarter can be pure cycle. Polycab-style electrical wire economics, by contrast, are driven by brand, distribution reach, and steady real-estate/electrification demand — a slower but far more repeatable engine.",
"Benchmarking a peak-cycle commodity margin against a structural franchise multiple gives you a valuation that evaporates the moment the cycle turns. The two segments deserve different multiples entirely.",
"The lesson: never benchmark a cyclical-commodity segment's peak margin against a structural franchise's multiple — matching the wrong comparable is how you get trapped at the top of a cycle."
],
"company": "Finolex Cables",
"numbers": [
{
"label": "Fibre margin",
"value": "Cyclical"
},
{
"label": "Wire margin",
"value": "Structural"
},
{
"label": "Wrong move",
"value": "Same multiple"
},
{
"label": "Right move",
"value": "Segment-specific"
}
]
}
],
"73": [
{
"tag": "scenario",
"title": "Concall intelligence: mining a KEI capacity comment for a model-changing delta",
"body": [
"A weak analyst hears management say 'we are confident about demand' and writes it down. A strong analyst is running an interrogation, waiting for one thing: information that changes the earnings model. Suppose on the KEI concall management says the new greenfield cable plant will commission 'by the second half of next year' and will roughly double a bottlenecked capacity.",
"That is a concrete delta. You now ask the questions behind the question: what utilisation last quarter (were they actually capacity-constrained, i.e. is this new capacity filling real unmet demand)? What is the revenue potential of the plant at full utilisation, and the ramp curve? Is the demand already contracted or hopeful?",
"Then you compare to last quarter's transcript. If three quarters ago management said the plant was 'under evaluation,' one quarter ago 'land acquired,' and now 'commissioning H2' — that is an evidence ladder climbing, each rung raising confidence. Vague-to-specific over time is a bullish signal; specific-to-vague is a warning.",
"The lesson: treat a concall as an interrogation — extract only the new facts that move your model, and track how management's language firms up or softens quarter over quarter."
],
"company": "KEI Industries",
"numbers": [
{
"label": "Signal",
"value": "Vague→specific"
},
{
"label": "Key ask",
"value": "Utilisation now?"
},
{
"label": "Then",
"value": "Ramp + contracted?"
},
{
"label": "Compare",
"value": "QoQ transcript"
}
]
}
],
"74": [
{
"tag": "worked",
"title": "PEAD: why a big EPS beat can be a trap unless revenue anchors it",
"body": [
"PEAD (post-earnings announcement drift) is the tendency of stocks to keep drifting in the direction of a genuine earnings surprise for weeks after results. But the goal is not the highest EPS growth — it is the highest QUALITY surprise. Two IT companies both beat EPS by 15%. Company A beat because revenue grew 4% above expectations and margins held. Company B beat because of a lower tax rate and higher other income, while revenue was in line.",
"Build the bridge. Company A's beat is revenue-anchored and operational — it is repeatable and estimates for next year will get revised UP, which is the real fuel of drift. Company B's beat is below the operating line — non-repeatable — and once analysts see through it, estimates do not move.",
"Illustratively: A's beat = revenue surprise +4% flowing to +15% PAT with stable margin; B's beat = revenue +0%, tax rate 25%→18% doing the work. Same headline, opposite quality.",
"The lesson: PEAD rewards revenue-anchored, operational surprises that trigger upward estimate revisions — a beat built on tax or other income drifts nowhere."
],
"company": "Persistent Systems",
"numbers": [
{
"label": "EPS beat (both)",
"value": "+15%"
},
{
"label": "A rev surprise",
"value": "+4%"
},
{
"label": "B rev surprise",
"value": "~0%"
},
{
"label": "Drift fuel",
"value": "Estimate revisions"
}
]
},
{
"tag": "scenario",
"title": "The estimate-revision ladder: how repeated Trent beats produced sustained drift",
"body": [
"The hidden engine of PEAD is not one surprise — it is a chain of them that forces analysts to keep raising forecasts. Consider a retailer like Trent through its Zudio expansion phase. Quarter after quarter, same-store growth and store additions came in ahead of conservative street numbers.",
"Watch the ladder: Quarter 1, actual beats estimate, so the stock pops and analysts nudge next year's number up ~10%. Quarter 2, it beats the raised bar AGAIN — now analysts realise they were structurally too low and revise the multi-year growth assumption, not just one quarter. Each revision re-rates the stock, and the drift persists because expectations chased reality with a lag.",
"The sweet spot is exactly this: revenue accelerating (second derivative positive) while consensus is still catching up. The dangerous setup is the mirror image — a company beats once, but growth is decelerating and estimates are already sky-high; that beat fades fast.",
"The lesson: sustained drift comes from a ladder of beats that forces successive upward estimate revisions — look for accelerating revenue against lagging consensus, not a single lucky quarter."
],
"company": "Trent",
"numbers": [
{
"label": "Q1 revision",
"value": "+~10%"
},
{
"label": "Q2",
"value": "Beat raised bar"
},
{
"label": "Sweet spot",
"value": "Accel + lagging consensus"
},
{
"label": "Trap",
"value": "Beat + decel"
}
]
}
],
"75": [
{
"tag": "scenario",
"title": "Industry mapping: walking the AI-power chain to find the choke point",
"body": [
"Start with the value chain, not the exciting headline. AI data centres need enormous power, so the chain runs: AI compute → electricity → grid and substations → transformers → cables and conductors → cooling → the data centre itself. The question is not 'which link is glamorous' but 'which link is supply-constrained so pricing power and ROCE can rise.'",
"Walk it. Compute (chips) grabs headlines but is not where an Indian investor easily plays. Move down: high-voltage transformers and grid equipment have multi-year order backlogs and long capacity-addition lead times — a genuine bottleneck. Power cables and conductors (Polycab, KEI, and conductor makers) tighten as grid capex surges. Cooling and specialised components are smaller pools.",
"The choke point is wherever demand is racing ahead but new supply takes years to build — for grid gear, adding a transformer plant and qualifying it takes far longer than demand takes to appear. That mismatch is where economic profit pools.",
"The lesson: map the whole value chain and hunt for the link where supply cannot respond quickly to demand — that scarcity, not the sexiest industry, is where pricing power and returns concentrate."
],
"company": "Value chain (transformers/cables)",
"numbers": [
{
"label": "Chain",
"value": "Compute→power→gear"
},
{
"label": "Choke point",
"value": "Supply-constrained link"
},
{
"label": "Signal",
"value": "Long lead times"
},
{
"label": "Not",
"value": "Most exciting link"
}
]
}
],
"76": [
{
"tag": "worked",
"title": "Score the bottleneck: six factors turn a hunch into a rating",
"body": [
"A bottleneck is not the same as an exciting industry. Score it on six factors, each say 1 to 5: (1) demand growth, (2) supply shortage, (3) lead time to customer, (4) time to add new capacity, (5) customer switching difficulty, (6) competitor entry barriers. High scores across all six mean scarcity that lasts.",
"Take high-voltage transformers in a grid-capex boom, illustratively: demand growth 5, supply shortage 5, lead time 5 (buyers wait quarters), capacity-addition time 4 (new plants and qualification take years), switching difficulty 4 (qualified vendors are sticky), entry barriers 4 (technology plus approvals). Total ~27 out of 30 — a durable bottleneck.",
"Now compare a generic commodity like standard steel rebar: demand 3, but supply shortage 1, lead time 1, capacity-addition time 1 (anyone can add a mill fast), switching difficulty 1, barriers 1 — total ~8. Same 'demand' story, completely different economics, because supply responds instantly.",
"The lesson: rate a bottleneck on all six factors — the durability of the scarcity, especially how long new capacity takes to arrive, decides whether pricing power is real or fleeting."
],
"company": "HV transformers (illustrative)",
"numbers": [
{
"label": "Transformer score",
"value": "~27/30"
},
{
"label": "Rebar score",
"value": "~8/30"
},
{
"label": "Key factor",
"value": "Capacity-add time"
},
{
"label": "Verdict",
"value": "Scarcity duration"
}
]
},
{
"tag": "scenario",
"title": "Qualification can beat technology: why Ratnamani-type moats are hard to copy",
"body": [
"Sometimes the bottleneck is not clever technology — it is qualification. Ratnamani makes specialised stainless and carbon-steel pipes for oil, gas, and process industries. A new entrant can, in principle, buy similar machines. What they cannot buy overnight is being an approved vendor.",
"Critical-application pipes must pass long customer and third-party qualification: material tests, plant audits, and a track record on prior orders. That approval can take years, and buyers are reluctant to switch a proven vendor when a pipe failure could shut a refinery. So the choke point is the approved-vendor list, not the metallurgy alone.",
"This is the same dynamic behind precision defence and aerospace component makers (the MTAR / Azad / Paras type) — the barrier is being qualified into a programme, which is slow, sticky, and hard for competitors to replicate even with capital. Revenue pool and profit pool separate here: many can make the part, few are qualified to sell it.",
"The lesson: when qualification and approval are the gate, the bottleneck lives in the vendor list — that regulatory-and-trust moat can be more durable than any technology edge."
],
"company": "Ratnamani Metals & Tubes",
"numbers": [
{
"label": "Barrier",
"value": "Vendor approval"
},
{
"label": "Time to qualify",
"value": "Years"
},
{
"label": "Switching",
"value": "Very sticky"
},
{
"label": "Moat type",
"value": "Qualification"
}
]
}
],
"77": [
{
"tag": "worked",
"title": "Market-implied earnings: what growth is baked into DMart's price?",
"body": [
"The most important valuation skill is reversing the price: at today's multiple, what earnings must the company deliver just to justify the current stock? DMart is the classic case — a wonderful retailer that often trades at a very high P/E, say illustratively ~80x earnings.",
"Reverse-engineer it. A ~80x P/E on a business is only rational if earnings compound very fast for a long time. As a rough test, to grow into a sane exit multiple of, say, ~35x in five years while the stock still delivers a decent return, earnings roughly need to compound in the ~25-30% range annually for years — with almost no stumble. That is the bar the price has ALREADY set.",
"Now compare that implied bar to what DMart can realistically deliver given store-addition pace, dense-cluster expansion, and margin. If reality is 'excellent but ~20% growth,' the company is superb yet the stock can still disappoint, because the price demanded ~27%.",
"The lesson: a high multiple is a promise the market has already made on the company's behalf — always compute the implied growth and ask whether reality can clear that bar, not just whether the company is good."
],
"company": "Avenue Supermarts (DMart)",
"numbers": [
{
"label": "P/E",
"value": "~80x"
},
{
"label": "Implied CAGR",
"value": "~25-30%"
},
{
"label": "Realistic",
"value": "~20%?"
},
{
"label": "Gap",
"value": "Price > reality"
}
]
},
{
"tag": "worked",
"title": "Good company vs good investment: the Trent implied-growth check",
"body": [
"Great investment = fundamentals materially better than what is already embedded in the price. To test that, you must first read what is embedded. Suppose Trent trades at a rich multiple, illustratively ~100x earnings, after a spectacular run.",
"Solve backwards. At ~100x, for the stock to compound even ~12-15% while the multiple normalises toward, say, ~40x over the next five to six years, earnings must roughly grow in the ~30%+ range sustained — the price is implying near-flawless Zudio rollout, high same-store growth, and stable margins simultaneously.",
"Your edge only exists if you can argue reality will beat that implied ~30%+, or if you conclude reality falls short and you avoid the trap. If your honest forecast is 'exceptional company, ~22% earnings growth,' then the company is a winner but the stock, at that price, is priced beyond it — good company, poor entry.",
"The lesson: separate 'is this a good company?' from 'is the good news already in the price?' — the investment is only attractive when your fundamental case exceeds the market-implied bar."
],
"company": "Trent",
"numbers": [
{
"label": "P/E",
"value": "~100x"
},
{
"label": "Implied CAGR",
"value": "~30%+"
},
{
"label": "Your forecast",
"value": "~22%"
},
{
"label": "Conclusion",
"value": "Good co, poor entry"
}
]
}
],
"78": [
{
"tag": "scenario",
"title": "Grow 30% and fall 30%: when expectations were set at 40%",
"body": [
"A company can post genuinely strong results and still crash, because the stock trades on the GAP between reality and expectations. Picture a high-quality NBFC like Bajaj Finance that the street has always paid a premium for, expecting, say, ~30%+ AUM and profit growth to continue.",
"Now suppose a quarter comes in with AUM up a strong ~25% but management guides that growth is moderating and credit costs are ticking up. On paper, ~25% is excellent. But if the price embedded ~30%+ forever, the stock can de-rate sharply — the multiple compresses because the market must lower its baked-in growth. Strong reality, disappointed expectation, falling stock.",
"This is the expectation triangle: price reflects (1) growth rate, (2) duration of that growth, and (3) confidence in it. This quarter dented duration and confidence even though the current growth was high. That is enough to re-rate a richly-valued name down.",
"The lesson: your job is to forecast the gap between reality and expectations, not the company in isolation — a great result below an even greater expectation still loses money."
],
"company": "Bajaj Finance",
"numbers": [
{
"label": "Expected",
"value": "~30%+"
},
{
"label": "Delivered",
"value": "~25%"
},
{
"label": "Hit",
"value": "Duration + confidence"
},
{
"label": "Result",
"value": "De-rating"
}
]
},
{
"tag": "worked",
"title": "Multiple migration: how a mix shift re-rated Deepak Nitrite",
"body": [
"Multiple migration is when the market re-rates a stock to a higher P/E because the business itself has structurally changed — often via product mix. Deepak Nitrite is a clean illustration: it evolved from a largely commodity-chemicals maker toward higher-value phenol/acetone and specialty intermediates.",
"Think in a mix-adjusted multiple. Illustratively, commodity chemical earnings might deserve ~12x (cyclical, low moat), while specialty/derivative earnings might deserve ~25x (stickier, higher ROCE). If the profit mix moves from mostly commodity to a meaningful specialty share, the BLENDED fair multiple drifts up even before earnings grow — say from ~14x toward ~20x purely on mix.",
"So the stock can re-rate for two stacked reasons: earnings rise AND the multiple applied to those earnings rises. That double-engine is exactly the multibagger mechanism. This is why you track EBITDA mix, not just revenue — the profit pool is what the market capitalises.",
"The lesson: a durable shift toward higher-quality product mix can lift the deserved multiple itself — track the EBITDA mix, because re-rating plus earnings growth is what compounds violently."
],
"company": "Deepak Nitrite",
"numbers": [
{
"label": "Commodity multiple",
"value": "~12x"
},
{
"label": "Specialty multiple",
"value": "~25x"
},
{
"label": "Blended drift",
"value": "~14x→20x"
},
{
"label": "Track",
"value": "EBITDA mix"
}
]
}
],
"79": [
{
"tag": "scenario",
"title": "Capital cycle: telling Tata Steel's cyclical margin from Astral's structural one",
"body": [
"The core skill is separating structural margin expansion from a temporary commodity-cycle high — and the capital cycle is the tool. When steel prices and spreads are rich, everyone earns fat margins, so everyone announces new capacity. That flood of capacity, arriving years later, crushes the very margins that invited it. High profits sow the seeds of low profits.",
"So when Tata Steel prints a peak-margin quarter, the right question is not 'how great' but 'where are we in the capital cycle?' If the industry is racing to add supply, today's margin is a cyclical top to be normalised DOWN in your model, not annualised. Illustratively, a spread that gives ~25% EBITDA margin at the peak may normalise toward ~15% mid-cycle.",
"Contrast a structural compounder like Astral (pipes/adhesives): its margin expansion comes from brand, distribution, premiumisation, and operating leverage — not a commodity spread that competitors can flood. That margin is more repeatable, so it deserves a steadier, higher multiple.",
"The lesson: in cyclicals, use the capital cycle — heavy capacity addition at peak margins signals mean-reversion ahead, so normalise the earnings rather than extrapolate the best quarter."
],
"company": "Tata Steel",
"numbers": [
{
"label": "Peak OPM",
"value": "~25%"
},
{
"label": "Mid-cycle OPM",
"value": "~15%"
},
{
"label": "Signal",
"value": "Capacity flooding in"
},
{
"label": "Action",
"value": "Normalise, don't annualise"
}
]
}
],
"80": [
{
"tag": "worked",
"title": "Sizing by conviction AND by what's priced in, not just by how much you like it",
"body": [
"Say you have three names you like. Titan is a high-quality compounder trading at a full valuation, so a lot of good news is already priced in; a small underfollowed pipe or chemical name has 25% earnings growth that the Street hasn't caught up to; and a cyclical is cheap but its margins are near a peak. Liking all three equally is not the same as sizing them equally.",
"A simple framework: size = quality x edge x margin-of-safety. Titan scores high on quality but low on 'edge' (everyone knows the story) and low on margin of safety, so it earns a 3% core holding. The underfollowed grower scores high on edge and reasonable safety, so it earns 4-5% despite being 'riskier' as a business. The cyclical scores low on safety because peak margins can normalise, so it is capped at 1-2%.",
"Notice the reversal a beginner would get wrong: the most familiar, highest-quality name is NOT automatically the biggest position. Position size rewards mispricing (edge + safety), not just business admiration.",
"Takeaway: you get paid for the gap between reality and expectations, so size the expectation gap, not your affection for the company."
],
"company": "Titan / Astral / a cyclical",
"numbers": [
{
"label": "Titan (quality, low edge)",
"value": "3%"
},
{
"label": "Underfollowed grower",
"value": "5%"
},
{
"label": "Peak-margin cyclical",
"value": "1-2%"
},
{
"label": "Portfolio names",
"value": "30-50"
}
]
},
{
"tag": "pitfall",
"title": "Letting the winner that already ran become an accidental 20% bet",
"body": [
"Imagine you bought Titan at a 2% weight and over a few years it 5x'd while your other names went sideways. Mechanically, Titan is now roughly 20% of your portfolio without you ever deciding 'I want a 20% bet here.' Many investors call this 'letting winners run' and feel proud of it.",
"The discipline question is not 'has it worked?' but 'if I had cash today, would I put 20% into Titan at this price and this expectation level?' If the answer is a clear no because the easy money is made and expectations are now high, then the 20% weight is a decision you never actually made.",
"The fix is not to sell it all. It is to trim back toward a size that matches today's forward risk/reward, say from 20% to 8-10%, and redeploy into names with a wider expectation gap.",
"Takeaway: position size must be re-justified at today's price and today's expectations, otherwise your best past idea silently becomes your biggest present risk."
],
"company": "Titan (illustrative holder)",
"numbers": [
{
"label": "Entry weight",
"value": "2%"
},
{
"label": "Weight after 5x",
"value": "~20%"
},
{
"label": "Trimmed target",
"value": "8-10%"
}
]
}
],
"81": [
{
"tag": "pitfall",
"title": "Fast revenue growth funded by constant dilution can mean flat wealth per share",
"body": [
"Take a company that grows revenue 25% a year but keeps issuing fresh equity to fund it, expanding its share count by roughly 15% a year. Profit may look like it is compounding fast in the headline, but the number that owns your wealth is per-share value. If shares grow 15% while profit grows 20%, your EPS grows only about 4-5%.",
"Contrast this with a disciplined financier like Bajaj Finance. It has raised capital many times too, but it raised at high valuations and, crucially, it redeployed that capital at strong returns on equity, so book value per share and EPS compounded rather than getting diluted away. Raising capital is not the sin; raising it and earning a poor incremental return on it is.",
"So the forensic step is: always pull up the DILUTED share count history alongside the profit history. A profit chart going up-and-to-the-right while shares also go up-and-to-the-right is a warning, not a celebration.",
"Takeaway: growth funded by dilution only creates wealth if the new capital earns more than it cost; otherwise you own a smaller slice of a bigger pie."
],
"company": "Serial-diluter vs Bajaj Finance",
"numbers": [
{
"label": "Revenue growth",
"value": "~25%"
},
{
"label": "Share count growth",
"value": "~15%"
},
{
"label": "Resulting EPS growth",
"value": "~4-5%"
}
]
},
{
"tag": "scenario",
"title": "The reinvestment test: where does the cash go, and at what return?",
"body": [
"Management quality is really a question of what they do with a rupee of profit. Titan, illustratively, could reinvest into more jewellery stores and inventory at high incremental returns on capital because the core business earns well and the runway is long. Every retained rupee came back as more high-return jewellery revenue, so retaining earnings created shareholder value.",
"Now picture the opposite: a company throwing off cash in a good core business that suddenly announces it is entering an unrelated area like real estate, an airline, or a vanity acquisition. That is 'diworsification' - deploying shareholder cash into a business that earns far below the core's return on capital. The concall may sound visionary; the capital allocation is value-destructive.",
"The single most important capital-allocation question is therefore: 'Can this company reinvest retained earnings at a high return, and is it actually doing so?' If yes, it should retain and compound; if no, it should pay dividends or buy back, not chase empire-building.",
"Takeaway: judge management by the return on the rupees they keep, not by how confident they sound about keeping them."
],
"company": "Titan vs a diversifying company",
"numbers": [
{
"label": "Core ROCE",
"value": "high"
},
{
"label": "New-venture ROCE",
"value": "low"
},
{
"label": "Right test",
"value": "incremental ROCE"
}
]
}
],
"82": [
{
"tag": "scenario",
"title": "When high margins are a reason to SELL, not buy",
"body": [
"A beginner sees a company suddenly posting record margins and thinks 'great business, buy it.' A cycle-aware investor asks WHY the margins jumped. Take an optical-fibre or cable situation: a temporary global supply shortage sends product prices up sharply, and margins balloon even though the company did nothing new operationally.",
"The danger is that the market capitalises these peak margins as if they are permanent. If normal margins are, say, 15% and a shortage pushes them to 30%, a stock priced on 30% margins is priced for a world that competitors are racing to end. Every player, seeing fat margins, announces capacity expansion. Two years later the new supply floods in, prices fall, and margins normalise back toward 15%.",
"So the very thing that looks bullish - record margins - is often the peak-cycle signal to reduce, because the high margin is simultaneously (a) unsustainable and (b) an incentive for competitors to add supply that will crush it.",
"Takeaway: in a commodity or shortage-driven business, peak margins are a sell signal in disguise, because high margins summon the supply that ends them."
],
"company": "Finolex / optical fibre supercycle",
"numbers": [
{
"label": "Normal margin",
"value": "~15%"
},
{
"label": "Shortage-peak margin",
"value": "~30%"
},
{
"label": "Post-supply margin",
"value": "~15%"
}
]
}
],
"83": [
{
"tag": "worked",
"title": "The margin bridge: split a jump into price, volume, mix and leverage",
"body": [
"Suppose a chemical company's operating margin jumps from 15% to 25% in a year. Before valuing it, break the +10 points into its sources with the five questions: price, volume, mix, utilisation, supply. Illustratively, +6 points came from a spike in product PRICE due to a global shortage, +2 from better MIX as a higher-value speciality product grew, and +2 from OPERATING LEVERAGE as fixed costs spread over higher volumes.",
"Now judge each piece by durability. The +6 from price is fragile - it reverses when supply returns. The +2 from mix is sticky if the speciality product keeps growing. The +2 from leverage is sticky as long as volumes hold. So of the +10, maybe only +4 is structural and +6 is cyclical froth.",
"That means 'normalised' margin is closer to 19% (15% + 4) than the reported 25%. If you value the company on 25% margins you are paying for froth; on 19% you are paying for the real improvement. This one bridge changes the entire valuation.",
"Takeaway: never value a margin jump as one number - decompose it, keep the structural points, and normalise away the cyclical ones."
],
"company": "Deepak Nitrite (illustrative)",
"numbers": [
{
"label": "Reported margin",
"value": "25%"
},
{
"label": "From price (cyclical)",
"value": "+6 pts"
},
{
"label": "From mix (structural)",
"value": "+2 pts"
},
{
"label": "From leverage (structural)",
"value": "+2 pts"
},
{
"label": "Normalised margin",
"value": "~19%"
}
]
},
{
"tag": "scenario",
"title": "The 'everyone is expanding' warning and the capacity-gap model",
"body": [
"The heart of the capital cycle is comparing industry CAPACITY growth against DEMAND growth. Say demand for a commodity is growing 6% a year, which is healthy. But during a period of fat margins, every major producer announces expansions, and combined capacity is set to grow 12% a year. That gap - supply growing twice as fast as demand - is the seed of the next down-cycle.",
"For a while it looks fine because the new plants take two to three years to commission. Margins stay high, the stock keeps rising, brokers extrapolate. Then the capacity lands, utilisation falls from, say, 90% to 70%, producers cut prices to fill plants, and margins collapse - right when the industry looked most exciting.",
"The inverse is the buy signal: a beaten-down industry where nobody is expanding, capacity growth is near zero, and demand quietly keeps growing. Utilisation creeps up, and eventually pricing power returns. Low margins after years of no capex are often the real reason to buy.",
"Takeaway: watch capacity growth versus demand growth - when everyone is expanding, sell the optimism; when nobody is expanding, buy the neglect."
],
"company": "Steel / commodity producers",
"numbers": [
{
"label": "Demand growth",
"value": "~6%"
},
{
"label": "Capacity growth",
"value": "~12%"
},
{
"label": "Utilisation peak",
"value": "~90%"
},
{
"label": "Utilisation trough",
"value": "~70%"
}
]
}
],
"84": [
{
"tag": "scenario",
"title": "A good thesis with no catalyst can sit dead for years",
"body": [
"Catalyst engineering separates 'a good business' from 'a good trade right now.' You can be completely right that a company is cheap and growing, yet the stock does nothing for two years because nothing forces the market to look. The growth driver is WHY the business does well; the catalyst is WHAT makes the market suddenly notice.",
"Concretely, a mid-cap IT or manufacturing name might have a steady growth driver - a structural order pipeline - but the catalyst is a discrete, dateable event: a large deal win announced, a big client ramp starting, a margin-guidance upgrade on a concall, or index inclusion. The growth driver was always there; the catalyst is what puts it on screens and into estimates.",
"So when you build a thesis, explicitly write the catalyst and roughly when it should become visible. A catalyst must move one of five things: revenue, margin, growth rate, the multiple the market pays, or perceived risk. If you can't name which, you have a nice business but not yet a trade.",
"Takeaway: a growth driver tells you the stock deserves to go up; a catalyst tells you when the market will make it go up."
],
"company": "Coforge / an underfollowed grower",
"numbers": [
{
"label": "Growth driver",
"value": "ongoing"
},
{
"label": "Catalyst",
"value": "dateable event"
},
{
"label": "Must move",
"value": "1 of 5 levers"
}
]
},
{
"tag": "scenario",
"title": "Catalyst density and stacking: why some setups reprice fast",
"body": [
"Not all catalysts are equal - what matters is catalyst DENSITY, how many repricing events are clustered in the near term. Take an electronics manufacturer riding the import-substitution theme. In a single 12-month window it can have several stacked catalysts: a new government incentive scheme approval, a big new customer/brand added, a new plant commissioning, and a fresh product line (say a move from TVs into mobiles or laptops).",
"Each of those alone might rerate the stock a little. Stacked together, they compound: the customer win validates the plant, the plant enables the incentive, the incentive lifts margins, and each concall delivers a fresh proof point. The market gets a steady drumbeat of evidence, so the thesis is discovered quickly rather than over years.",
"Contrast a company with one vague far-off catalyst and long gaps of silence - even if cheap, it can languish. Prefer setups where the calendar is full of near-term, high-impact, dateable events.",
"Takeaway: rank ideas by catalyst density - a stock with several near-term stacked catalysts reprices far faster than one with a single distant hope."
],
"company": "Dixon Technologies",
"numbers": [
{
"label": "Catalyst window",
"value": "~12 months"
},
{
"label": "Stacked catalysts",
"value": "3-4"
},
{
"label": "Best kind",
"value": "near-term, dateable"
}
]
}
],
"85": [
{
"tag": "scenario",
"title": "The five phases of an inflection and where the money is made",
"body": [
"Inflection detection is about timing the WINDOW when a thesis becomes visible, moving through five phases. Phase 1 Narrative: 'India electronics manufacturing will boom' - just a story, no numbers. Phase 2 Evidence: order wins and MoUs appear. Phase 3 Operational validation: plants commissioned, capacity live. Phase 4 Financial visibility: revenue and margins actually show up in quarterly results. Phase 5 Consensus recognition: brokers publish, the stock is a crowd favourite and fully priced.",
"The sweet spot is buying between Phase 2 and Phase 3 - when hard evidence (order book, capex, new customers) is arriving but it has NOT yet fully hit the reported P&L, so consensus estimates are still too low. By Phase 5, the inflection is common knowledge and the easy money is gone.",
"The key distinction: a narrative (Phase 1) is not an inflection - it is a hope. An inflection needs leading indicators turning: order book, capacity utilisation, hiring, capex. Track those, because they lead the earnings that lead the consensus.",
"Takeaway: buy where evidence is accelerating but earnings haven't caught up (Phase 2-3); by the time estimates are raised for everyone (Phase 5), you're the exit liquidity."
],
"company": "Kaynes / Amber (EMS)",
"numbers": [
{
"label": "Buy window",
"value": "Phase 2-3"
},
{
"label": "Crowded/late",
"value": "Phase 5"
},
{
"label": "Leading signals",
"value": "orders, capex, utilisation"
}
]
}
],
"86": [
{
"tag": "scenario",
"title": "Four states of fundamentals vs price - and the best one to buy",
"body": [
"Integrating fundamentals with technicals gives four states. State 1 Fundamentals up + Price down: potential mispricing, but be careful - price sometimes leads earnings and may be warning you. State 2 Fundamentals up + Price up: the healthiest state, the market is confirming your thesis. State 3 Fundamentals down + Price up: dangerous, the crowd is chasing a fading story. State 4 Fundamentals down + Price down: value trap or falling knife.",
"The most powerful buy is State 2 arriving after a long base: earnings are inflecting AND the stock shows relative strength, outperforming the index and building a tight base before breaking out on volume. Relative strength matters for a fundamental investor because institutions accumulate ahead of visible earnings, and their buying shows up as the stock refusing to fall when the market does.",
"When your fundamental inflection lines up with a technical base and RS leadership, you have both the 'why' and the 'when.' A great thesis with terrible relative strength often means the market knows something you don't yet.",
"Takeaway: the ideal setup is a fundamental inflection confirmed by price - improving earnings plus relative strength breaking out of a base - not fundamentals fighting the tape."
],
"company": "APL Apollo / a relative-strength leader",
"numbers": [
{
"label": "Best state",
"value": "Fund up + Price up"
},
{
"label": "Most dangerous",
"value": "Fund down + Price up"
},
{
"label": "Confirmation",
"value": "RS + volume breakout"
}
]
}
],
"87": [
{
"tag": "scenario",
"title": "The discovery lifecycle: from obscure micro-cap to institutional darling",
"body": [
"A stock's returns come from two engines: earnings growth AND the market discovering it (multiple expansion). Consider an obscure small-cap with genuine growth but tiny liquidity and no analyst coverage. Institutions literally cannot buy it meaningfully - if a fund tries to take a 2% position, it would move the price 20%, so it stays away despite liking the business.",
"As the company grows, free float and daily liquidity rise, market cap crosses thresholds, and the stock climbs the 'market-cap ladder.' Now a small fund can build a position, then a mid-cap fund, then index inclusion forces passive buying. Each new class of buyer is a fresh source of demand - the institutional feedback loop - and analyst coverage begins, which brings still more buyers. This is a 'double engine': earnings compound while the multiple expands as perception improves.",
"But two cautions. First, don't confuse market-cap expansion with value creation - a stock can get big purely by dilution or hype. Second, heavy analyst coverage and everyone owning it is often a LATE-stage signal; the real edge is buying while still underfollowed - though remember underfollowed is not the same as undervalued.",
"Takeaway: the biggest re-ratings come when a real business climbs the liquidity and coverage ladder into institutional reach - your edge is being early on that ladder, not late."
],
"company": "CDSL / a small-cap that got discovered",
"numbers": [
{
"label": "Return engines",
"value": "earnings x re-rating"
},
{
"label": "Early stage",
"value": "no coverage, low float"
},
{
"label": "Late signal",
"value": "heavy coverage, index inclusion"
}
]
}
],
"88": [
{
"tag": "worked",
"title": "The 500-to-5 funnel: spend research time where it changes decisions",
"body": [
"Your edge is partly decision speed. If you spend 4 hours per stock, a 500-name universe is impossible, so you build a funnel. Stage 1 Machine filter: quantitative screens (growth, ROCE, debt, momentum) cut 500 down to maybe 50. Stage 2 5-minute triage: for each survivor answer five questions - what does the company do, why is earnings growth happening, is growth accelerating, what's the catalyst, and what's the obvious risk. If you can't answer in five minutes, move on; that cuts 50 to maybe 15.",
"Stage 3 15-minute investigation and Stage 4 30-minute deep dive go progressively deeper on the survivors, and only the final handful earn a full investment memo. The point is that you spend expensive, deep research time only on names that have already earned it, not on all 500.",
"The discipline layer is the source ladder and evidence tagging: separate FACTS (order book, capex, filings) from INTERPRETATION (management spin, broker opinion), and rank sources by reliability. Crucially, research should ATTACK the thesis - write a 'kill question' whose answer would prove you wrong, and go find that answer first.",
"Takeaway: don't research more, research in stages - a funnel plus a kill-question lets you reject fast and go deep only where a decision actually hangs in the balance."
],
"company": "Screening workflow (illustrative)",
"numbers": [
{
"label": "Universe",
"value": "~500"
},
{
"label": "After machine filter",
"value": "~50"
},
{
"label": "After 5-min triage",
"value": "~15"
},
{
"label": "Final memos",
"value": "~5"
}
]
}
],
"89": [
{
"tag": "worked",
"title": "CFO/PAT: is the profit turning into cash, or just accounting?",
"body": [
"The first forensic question is whether reported profit is backed by cash. Compare cumulative cash flow from operations (CFO) to cumulative net profit (PAT) over, say, five years. For a healthy business, CFO should be roughly equal to or greater than PAT - profits are converting into real cash. If a company reports strong PAT but CFO is consistently far below it, the 'profit' is sitting in receivables and inventory, not the bank.",
"Say PAT over five years totals 500 crore but CFO is only 200 crore. That 300 crore gap has to live somewhere on the balance sheet - usually swelling receivables (has it really collected the sales?) and inventory (is it stuffing the channel?). Watch the receivable and inventory days: if sales grow 20% but receivables grow 40%, the company is 'buying' growth by selling on ever-looser credit.",
"This directly channels the commodity trap and the volume-vs-price lesson: revenue can rise on price alone with no real volume, and profit can rise with no real cash. CFO/PAT is the single fastest lie-detector.",
"Takeaway: a company that reports big profits but doesn't generate matching operating cash over several years is often converting shareholders' money into receivables and inventory, not wealth - check CFO/PAT before you trust any earnings chart."
],
"company": "Working-capital forensic (illustrative)",
"numbers": [
{
"label": "Healthy CFO/PAT",
"value": "~1.0 or higher"
},
{
"label": "PAT 5-yr",
"value": "~500 cr"
},
{
"label": "CFO 5-yr",
"value": "~200 cr"
},
{
"label": "Unexplained gap",
"value": "~300 cr"
}
]
},
{
"tag": "pitfall",
"title": "EBITDA is not cash: the capex and CWIP trap",
"body": [
"A common mistake is treating EBITDA as if it were spendable cash. EBITDA deliberately ADDS BACK depreciation, but for a capital-intensive business depreciation is a real economic cost - the machines wear out and must be replaced. A company can show rising EBITDA while free cash flow is negative every single year because it keeps pouring money into new plants.",
"Watch two forensic spots. First, CWIP (capital work in progress): if huge sums sit in CWIP year after year without ever converting into productive assets and revenue, capital may be stuck or the project may be troubled. Second, capitalised expenses: costs that should hit the P&L (like some interest or R&D) get parked on the balance sheet instead, flattering current profit and understating true expense - and a suspiciously low depreciation charge relative to the asset base is a red flag for this.",
"Also strip out other income, one-off investment gains, and 'exceptional' items, and sanity-check the tax rate - a company perpetually paying far below the statutory rate deserves a question. These add-backs and adjustments are where reported profit and real earning power quietly diverge.",
"Takeaway: EBITDA ignores the cost of staying in business - always check capex, CWIP and depreciation, because a business that must constantly reinvest just to stand still is not as profitable as its EBITDA pretends."
],
"company": "Capital-intensive expander (illustrative)",
"numbers": [
{
"label": "EBITDA ignores",
"value": "depreciation + capex"
},
{
"label": "Red flag",
"value": "low depreciation vs assets"
},
{
"label": "Watch",
"value": "stuck CWIP"
},
{
"label": "Check",
"value": "effective tax rate"
}
]
}
],
"90": [
{
"tag": "scenario",
"title": "Indian aviation vs CDSL: same country, opposite economics",
"body": [
"Indian domestic air travel has grown for two decades, yet most airlines have destroyed capital. Ask the five-forces question: fuel suppliers (oil companies) have pricing power, aircraft lessors have power, customers compare fares to the last rupee on a booking app, rivalry is brutal because a seat unsold today is gone forever, and switching cost for a flyer is zero. Demand grew, but suppliers and customers captured the economics — the airline was left with the scraps.",
"Now take CDSL. Every demat account in India must sit at a depository, there are effectively only two, pricing is regulated but volume-linked, and no new entrant can simply appear. Rivalry is muted, customers (brokers) cannot bypass it, and incremental accounts flow through at very high margin. Illustratively CDSL can run ~55-60% operating margins while a fast-growing airline scrapes single digits.",
"The lesson: 'is demand growing?' is the wrong first question. The right one is 'who is structurally positioned to keep the money once the demand shows up?'"
],
"numbers": [
{
"label": "Airline OPM (typical)",
"value": "~5-8%"
},
{
"label": "CDSL OPM (illustrative)",
"value": "~55%"
},
{
"label": "Depositories in India",
"value": "2"
},
{
"label": "Flyer switching cost",
"value": "~0"
}
]
},
{
"tag": "scenario",
"title": "Capacity as a weapon: APL Apollo and the entry-barrier test",
"body": [
"In structural steel tubes, the raw material (HR coil) is a commodity that everyone buys at roughly the same price. A naive investor concludes 'no moat, it's just a converter.' But APL Apollo built capacity far ahead of demand across many plants and a wide product range, so it can serve a distributor next-day, in any size, at scale a small fabricator cannot match.",
"That scale becomes a strategic weapon. When APL Apollo keeps adding capacity and pushes value-added products (large-diameter and coated tubes), a would-be entrant must ask: can I match a multi-million-tonne, pan-India network and still make money? Usually no. The entry-barrier test is not 'is the product special' but 'can a rational competitor replicate this and earn a decent return?'",
"The differentiation here is not the molecule; it is availability, distribution density and product mix. That is why a 'commodity converter' can quietly earn a better and more durable ROCE than its inputs would suggest."
],
"numbers": [
{
"label": "Raw material",
"value": "Commodity HR coil"
},
{
"label": "Real moat",
"value": "Scale + distribution"
},
{
"label": "Product mix",
"value": "Basic → value-added"
},
{
"label": "Entry test",
"value": "Can rival earn ROCE?"
}
]
}
],
"91": [
{
"tag": "scenario",
"title": "Buy the cyclical when P/E looks HIGH, not low",
"company": "Tata Steel (illustrative)",
"body": [
"The classic cyclical trap is buying at a low P/E. In a deep cyclical like steel or graphite electrodes, earnings are highest at the top of the cycle — so the P/E is LOWEST exactly when the stock is most dangerous, and HIGHEST at the trough when earnings are near zero and the next up-cycle is being born.",
"Illustratively: at the peak a steel maker earns ₹200/share and trades at 6x (₹1,200) — looks cheap. At the trough it earns ₹20/share and trades at 30x (₹600) — looks expensive. The trough buyer at 30x doubles their money as normalised earnings return; the peak buyer at 6x gets halved.",
"The tool is normalised (mid-cycle) earnings and the capital cycle: buy when capex has stopped, inventories are lean, and utilisation is about to tighten; sell when everyone is expanding capacity at peak margins.",
"Lesson: for deep cyclicals, invert the P/E signal — high trough P/E on depressed earnings is the buy; low peak P/E on record earnings is the sell."
],
"numbers": [
{
"label": "Trough P/E",
"value": "~30x (buy)"
},
{
"label": "Peak P/E",
"value": "~6x (sell)"
},
{
"label": "Anchor on",
"value": "normalised EPS"
}
]
}
],
"92": [
{
"tag": "scenario",
"title": "Forced selling in a demerger creates the edge",
"body": [
"Special situations pay you for structural mispricing, not for being smart about the business. A common one: a company demerges a division; the newly listed entity is not yet in any index and many funds are mandated to hold only index names — so they dump it on day one regardless of value.",
"That forced, price-insensitive selling can push the spun-off business well below fair value for a few weeks. If your sum-of-the-parts work says the demerged piece is worth more than where indiscriminate selling has left it, the gap is your return — and it closes as the selling exhausts and coverage begins.",
"Other variants: open-offer arbitrage (buy below the offer price for a defined spread), buybacks (tender acceptance math), and holdco discounts. Each is a rules-based edge with a catalyst and a timeline.",
"Lesson: in special situations the alpha comes from someone being forced to transact — find the forced seller (or buyer), do the SOTP or spread math, and collect the gap."
],
"numbers": [
{
"label": "Edge source",
"value": "forced index selling"
},
{
"label": "Tool",
"value": "SOTP / spread math"
},
{
"label": "Has",
"value": "catalyst + timeline"
}
]
}
],
"93": [
{
"tag": "scenario",
"title": "Channel checks see the share shift before the numbers do",
"company": "Asian Paints vs Birla Opus (illustrative)",
"body": [
"Advanced competitive intelligence means gathering evidence outside the financials. When a well-funded entrant attacks an incumbent's market, the P&L shows the damage a year late — but distributors, dealers and ex-employees know within a quarter.",
"Illustratively, when a large new player enters paints with aggressive dealer incentives and credit, channel checks (talking to paint dealers) reveal shelf space and discounting pressure long before the incumbent's margin actually dips. That lead time is the edge — you can trim the incumbent or wait for confirmation before buying the entrant.",
"The toolkit: dealer/distributor conversations, hiring trends (LinkedIn), input-supplier commentary, GST/e-way trends, app downloads, and pricing scraped from the field. Triangulate several weak signals into one strong read.",
"Lesson: financials are lagging indicators of competition; primary channel work is a leading one — build a repeatable check-list of field signals for the businesses you own."
],
"numbers": [
{
"label": "Signal lead time",
"value": "~1-3 quarters"
},
{
"label": "Sources",
"value": "dealers, hiring, pricing"
},
{
"label": "Method",
"value": "triangulate weak signals"
}
]
}
],
"94": [
{
"tag": "pitfall",
"title": "The forensic checklist that flags a fraud early",
"body": [
"Advanced short/fraud work is pattern recognition on the quality of earnings. The single most powerful flag is a persistent gap between reported profit and cash: if PAT keeps rising but CFO/PAT stays below ~0.7 for years, the 'profit' is on paper, sitting in receivables and inventory that never convert.",
"Stack the flags. Auditor resignation or a mid-year change, frequent CFO/promoter share pledging, large related-party transactions (>5% of revenue), 'other income' propping up PBT, cash on the balance sheet that earns suspiciously little interest, and rapid subsidiary proliferation on a microcap — any one is noise, three together is a thesis.",
"Illustratively: sales compounding at 40% while CFO/PAT is 0.4, ten new subsidiaries in two years, and a promoter pledging shares — that is the classic operator-pump fingerprint. Value doesn't matter; you are shorting the accounting.",
"Lesson: don't argue about the multiple on a suspected fraud — follow the cash. Sustained CFO/PAT below 0.7 plus governance flags is the tell."
],
"numbers": [
{
"label": "Key ratio",
"value": "CFO/PAT < 0.7"
},
{
"label": "Governance flags",
"value": "auditor exit, pledge, RPT"
},
{
"label": "Rule",
"value": "3 flags = thesis"
}
]
}
],
"95": [
{
"tag": "scenario",
"title": "Spot the inflection in the quarter it turns",
"company": "A capex-heavy manufacturer (illustrative)",
"body": [
"An inflection is the quarter the second derivative turns — where a business goes from getting worse to getting better (or slow to fast). The whole game is seeing it one or two quarters before the market re-rates the stock.",
"The fingerprint: utilisation crossing a threshold (say 60% → 75%) as a new plant ramps, gross margin ticking up after several flat quarters, and management commentary shifting from 'challenging' to 'we are seeing traction'. Any one is weak; all three in the same quarter is an inflection.",
"Illustratively, a company that spent two years on a large capex with depressed margins suddenly reports utilisation jumping and incremental EBITDA margins far above the historical average — that is operating leverage kicking in, and it usually compounds for several quarters.",
"Lesson: to identify the inflection, watch utilisation, incremental margin and the tone of the concall together — the turn shows up there before it shows up in the share price."
],
"numbers": [
{
"label": "Utilisation turn",
"value": "~60% → 75%"
},
{
"label": "Watch",
"value": "incremental EBITDA margin"
},
{
"label": "Confirm",
"value": "concall tone shift"
}
]
}
],
"96": [
{
"tag": "pitfall",
"title": "Separate reported FACT from management ASSUMPTION",
"body": [
"A disciplined analyst colour-codes every input as fact or assumption. Reported revenue, margins and cash flows are facts. 'We will double revenue in three years', 'margins will expand 300 bps', 'the new plant will run at 85%' — these are assumptions, however confident the tone.",
"The mistake is modelling guidance as if it were fact. Build the base case on what has actually been delivered, then treat guidance as an upside scenario with a probability, and ask what evidence would convert the assumption into a fact (an order book, a signed contract, utilisation already rising).",
"Illustratively, if management guides to 25% growth but the trailing three years delivered 12%, your base case is closer to 12–15% with 25% as a tagged bull case — not the anchor. Many blow-ups come from paying today for a growth rate that only ever existed in a slide.",
"Lesson: write next to every number whether it is fact or assumption; anchor valuation on facts, and demand evidence before promoting an assumption."
],
"numbers": [
{
"label": "Base case on",
"value": "delivered results"
},
{
"label": "Guidance =",
"value": "tagged upside"
},
{
"label": "Convert when",
"value": "evidence appears"
}
]
}
],
"97": [
{
"tag": "worked",
"title": "Back out the number management didn’t disclose",
"company": "A two-segment company (illustrative)",
"body": [
"Often the number you need isn't reported — you reconstruct it. Say a company has two segments and discloses total revenue ₹1,000 and total EBIT ₹150, plus Segment A revenue ₹700 at a 10% margin (EBIT ₹70). The market assumes the whole company is mediocre.",
"Do the subtraction: Segment B revenue = 1,000 − 700 = ₹300; Segment B EBIT = 150 − 70 = ₹80; so Segment B margin = 80 / 300 ≈ 27%. The 'boring' company is hiding a high-margin business inside it — a classic setup for a sum-of-the-parts re-rating.",
"The same trick finds volume when only value is given (value ÷ realisation), or realisation when only value and volume are given. Cross-check against capacity and peers so your derived number is sane.",
"Lesson: missing numbers are usually derivable from the ones that are disclosed — subtract, divide and cross-check to reveal what the headline hides."
],
"numbers": [
{
"label": "Segment B revenue",
"value": "₹300 (backed out)"
},
{
"label": "Segment B EBIT",
"value": "₹80"
},
{
"label": "Hidden margin",
"value": "~27%"
}
]
}
],
"98": [
{
"tag": "worked",
"title": "Product-mix shift moves the blended margin",
"company": "Titan / a jeweller (illustrative)",
"body": [
"Mix analysis explains margin changes that volume and price alone can't. Take a jeweller selling plain gold at ~8% margin and studded (diamond) jewellery at ~25% margin. If studded rises from 25% to 35% of sales, the blended margin moves even with zero change in either product's own margin.",
"Work it: old blend = 0.75×8% + 0.25×25% = 12.3%; new blend = 0.65×8% + 0.35×25% = 13.95% — a ~165 bps lift purely from mix. On large revenue that is a big profit swing, and it is higher quality than a one-off price hike because premiumisation tends to persist.",
"Push the same maths to any value-added mix: coated vs plain tubes, premium vs economy cement, specialty vs commodity chemicals. Track the mix line in every concall; it is where durable margin expansion hides.",
"Lesson: decompose margin into own-product margins vs mix — a rising share of the high-margin product lifts the blend and is usually a structural, repeatable gain."
],
"numbers": [
{
"label": "Studded mix",
"value": "25% → 35%"
},
{
"label": "Blended margin",
"value": "12.3% → 14.0%"
},
{
"label": "Mix lift",
"value": "~165 bps"
}
]
}
],
"99": [
{
"tag": "scenario",
"title": "The one question: what has to go right, and is it priced?",
"body": [
"Every thesis reduces to one question: what must be true for this to work, and does today's price already assume it? If you can't answer that in a sentence, you don't understand the investment well enough to size it.",
"Illustratively, for a richly-valued compounder the question might be 'the market assumes 25% growth for five years — do I have a reason to believe it beats that?' For a cyclical it's 'the price assumes trough conditions forever — will the cycle turn?' For a turnaround, 'does the balance sheet survive long enough for the fix to land?'",
"Answering it forces you to state the key variable, the expectation embedded in the price, and your variant view. Everything else — the model, the ratios — is supporting evidence for that single call.",
"Lesson: before you buy, write the one thing that must go right and check whether the price already pays for it; edge only exists where reality can beat the embedded expectation."
],
"numbers": [
{
"label": "Ask",
"value": "what must be true?"
},
{
"label": "Then",
"value": "is it priced in?"
},
{
"label": "Edge =",
"value": "reality > expectation"
}
]
}
],
"100": [
{
"tag": "worked",
"title": "Deepak Nitrite: valuing the old engine and the new project separately",
"body": [
"Suppose Deepak Nitrite has two very different pieces: (1) the existing, cash-generating base chemicals + Deepak Phenolics business (call it the PFY, the 'proven' business), and (2) 'Ecosis' — a big new capex project (say a fluorination / polycarbonate downstream complex) that is not yet earning. Valuing the whole thing on one blended P/E is lazy, because the market pays a different multiple for proven cash flows than for an unproven project. SOTP forces you to price each leg on its own merit.",
"Build the architecture illustratively. Existing PFY: say it earns ~Rs 1,000 cr PAT and deserves ~25x = Rs 25,000 cr. Ecosis: not yet profitable, so you value it on invested capital or a risk-weighted future EBITDA — say Rs 5,000 cr of value today. Add the two: Rs 30,000 cr enterprise-ish value. Then subtract net debt (say Rs 2,000 cr) to get equity value = Rs 28,000 cr. Divide by shares outstanding (say ~13.6 cr shares) to get an SOTP value/share.",
"The point of the exercise is NOT the exact figure — it is the structure: Value(PFY) + Value(Ecosis) + other assets − net debt = equity value, then ÷ shares = value/share. Once the skeleton is right, you can stress-test each block independently: what if the market pays 20x not 25x for the base? What if Ecosis is worth zero because it slips two years?",
"Takeaway: SOTP is architecture first, numbers second — get the boxes and the plus/minus signs right (add businesses, subtract net debt, divide by shares), and you can plug better estimates in later without rebuilding the model."
],
"numbers": [
{
"label": "PFY value",
"value": "~Rs 25,000 cr"
},
{
"label": "Ecosis value",
"value": "~Rs 5,000 cr"
},
{
"label": "Less: net debt",
"value": "~Rs 2,000 cr"
},
{
"label": "Equity value",
"value": "~Rs 28,000 cr"
},
{
"label": "Shares o/s",
"value": "~13.6 cr"
},
{
"label": "SOTP/share",
"value": "~Rs 2,060"
}
]
},
{
"tag": "scenario",
"title": "Reliance: why one P/E can never value a conglomerate",
"body": [
"Reliance Industries is the textbook SOTP because the market genuinely values its legs differently. O2C (refining + petrochemicals) is a cyclical, capital-heavy cash cow that the market pays maybe 7-8x EV/EBITDA for. Jio is a subscriber-growth telecom/digital story the market pays a much richer EV/EBITDA for. Retail is a high-growth consumer format that trades closer to a Trent/DMart-style multiple. Slapping one blended P/E on the consolidated entity would either overvalue the boring O2C or undervalue the fast-growing Jio and Retail.",
"So the analyst builds the same skeleton: value O2C on its multiple, value Jio on its multiple, value Retail on its multiple, add new-energy optionality (an 'Ecosis'-style bet not yet earning), sum them, subtract consolidated net debt, then divide by shares outstanding to get value/share.",
"The magic of doing it this way is that it exposes where the value and the risk actually sit. If most of your SOTP value is coming from Jio and Retail, then O2C margins swinging with the refining cycle matter less to your thesis than subscriber ARPU and retail store additions.",
"Takeaway: whenever a company is really several businesses stuck together, SOTP is not optional — it is the only honest way to see which leg you are actually buying."
],
"numbers": [
{
"label": "O2C multiple",
"value": "~7-8x EBITDA"
},
{
"label": "Jio multiple",
"value": "premium telecom"
},
{
"label": "Retail multiple",
"value": "consumer-grade"
},
{
"label": "New energy",
"value": "optionality"
}
]
}
],
"101": [
{
"tag": "scenario",
"title": "The catalyst ladder for a new chemical plant: talk is cheap, margins are gospel",
"body": [
"Imagine Navin Fluorine or Deepak Nitrite announces a new fluorination block. Retail investors get excited at the first press release; a disciplined analyst instead ranks each milestone by how much it actually de-risks the project. Rank the eight events weakest to strongest and you get: A (management says demand is strong) → B (plant commissioned) → C (trial production successful) → D (customer qualification) → E (first commercial shipment) → F (repeat commercial orders) → G (70-80% utilization) → H (demonstrated superior margins).",
"Why this order? 'Management says demand is strong' (A) is pure talk — zero rupees have moved. Commissioning the plant (B) only proves capex was spent, not that it works. Trial production (C) proves you can make the molecule; customer qualification (D) proves someone reputable will accept it. First shipment (E) is your first real invoice, repeat orders (F) prove the demand was real and sticky, and high utilization (G) proves you can scale it.",
"The very top of the ladder is H — demonstrated superior margins — because that is the only milestone that proves the project actually creates value, not just revenue. Plenty of chemical plants run at 80% utilization and still earn mediocre spreads.",
"Takeaway: pay for facts near the top of the ladder (repeat orders, utilization, margins) and stay skeptical of noise near the bottom (a management quote about 'strong demand') — the market re-rates the stock as each rung is climbed."
],
"numbers": [
{
"label": "Weakest rung",
"value": "A: 'demand strong'"
},
{
"label": "Mid rung",
"value": "E: first shipment"
},
{
"label": "Strongest rung",
"value": "H: superior margins"
},
{
"label": "Utilization proof",
"value": "G: 70-80%"
}
]
}
],
"102": [
{
"tag": "worked",
"title": "Dixon: reverse-engineering what the price already assumes",
"body": [
"The Druckenmiller/Lynch question is never 'is this a good company' — it is 'what is the price already assuming?' Take Dixon Technologies trading at a rich multiple, say a market cap of ~Rs 60,000 cr on ~Rs 800 cr of current PAT — that is roughly 75x trailing earnings. To justify that, the market cannot be paying for today's profit; it must be pricing years of explosive growth (mobiles, EMS, the new component/display 'Ecosis' bets) as if they are already delivered.",
"Do the split. If a mature EMS business at a sane ~30x is worth ~Rs 24,000 cr on today's earnings, then the remaining ~Rs 36,000 cr of market cap is the implied value the market has already assigned to Ecosis — the not-yet-earning new verticals. That is the number you must interrogate: it means the market is essentially pricing FY28 success today.",
"Now flip it into a hurdle. For that implied Rs 36,000 cr to be justified, Ecosis probably has to reach, say, Rs 1,200 cr of PAT by FY28 at a 30x multiple. Ask coldly: is that a base case or a best case? If it is the best case and it is already in the price, your asymmetry is gone — you win a little if everything goes right and lose a lot if it slips.",
"Takeaway: before buying a hot compounder, back out the implied value of the future business from the current market cap; if the price already assumes FY28 goes perfectly, the easy money has already been made."
],
"numbers": [
{
"label": "Market cap",
"value": "~Rs 60,000 cr"
},
{
"label": "Current PAT",
"value": "~Rs 800 cr"
},
{
"label": "Implied P/E",
"value": "~75x"
},
{
"label": "Core biz value",
"value": "~Rs 24,000 cr"
},
{
"label": "Implied Ecosis",
"value": "~Rs 36,000 cr"
},
{
"label": "FY28 PAT needed",
"value": "~Rs 1,200 cr"
}
]
}
],
"103": [
{
"tag": "scenario",
"title": "Writing the one-page verdict: WATCH on a new-project story",
"body": [
"The final decision must be a single call plus exactly three reasons — discipline forces you to say what actually drives the thesis. Take an illustrative specialty-chemical name mid-way through commissioning its Ecosis project, trading at a full multiple. Verdict: 🟡 WATCH.",
"Reason 1 — INFLECTION is real but unproven: the plant is commissioned and trial production is done (rungs B-C of the catalyst ladder), but there are no repeat commercial orders and no demonstrated margins yet, so the earnings inflection is a promise, not a fact. Reason 2 — FACT VS ASSUMPTION: the SOTP shows the existing PFY worth, say, ~Rs 25,000 cr, yet the stock's ~Rs 32,000 cr market cap implies ~Rs 7,000 cr is already assigned to Ecosis — the market is pricing customer qualification and superior margins that have not happened. Reason 3 — the asymmetry is thin: if the project delivers you make maybe 30%, but if it slips a year you lose 30-40% as the premium unwinds.",
"That is why the answer is WATCH, not BUY: the right trigger to upgrade is a fact high on the catalyst ladder — repeat orders (F), 70-80% utilization (G), or a print of superior margins (H). Downgrade to AVOID if working capital balloons or the customer qualification stalls.",
"Takeaway: a good final call is one colour and three sharp reasons tied to the framework — inflection quality, fact-vs-assumption on the SOTP, and the asymmetry — not a paragraph of hedging."
],
"numbers": [
{
"label": "Verdict",
"value": "WATCH"
},
{
"label": "PFY value",
"value": "~Rs 25,000 cr"
},
{
"label": "Market cap",
"value": "~Rs 32,000 cr"
},
{
"label": "Implied Ecosis",
"value": "~Rs 7,000 cr"
},
{
"label": "Upgrade trigger",
"value": "rungs F-G-H"
},
{
"label": "Downside if slips",
"value": "~30-40%"
}
]
}
]
};
