"""
News ingestor — fetches from RSS feeds, scores importance, tags tickers.
"""
import logging
import hashlib
import re
from datetime import datetime, timedelta
from typing import Optional
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc

from app.models.news import NewsArticle

logger = logging.getLogger(__name__)


def _is_non_english(text: str) -> bool:
    """Check if text contains non-ASCII characters suggesting non-English (Hindi, etc.)."""
    non_ascii = sum(1 for c in text if ord(c) > 127)
    return non_ascii > len(text) * 0.3  # >30% non-ASCII chars


async def _translate_text(text: str, client: "httpx.AsyncClient") -> str:
    """Translate non-English text to English. Tries MyMemory (free), then Anthropic, then Google."""
    if not text or not text.strip():
        return text

    # Method 1: MyMemory API (free, 5000 chars/day, reliable from server IPs)
    try:
        resp = await client.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text[:500], "langpair": "hi|en"},  # max 500 chars per request
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            translated = data.get("responseData", {}).get("translatedText", "").strip()
            if translated and not _is_non_english(translated) and translated.upper() != text.upper():
                logger.info(f"MyMemory translated: '{text[:40]}...' -> '{translated[:40]}...'")
                return translated
    except Exception as e:
        logger.warning(f"MyMemory translation failed: {e}")

    # Method 2: Anthropic API (if credits available)
    import os
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 300,
                    "messages": [{"role": "user", "content": f"Translate this Hindi text to English. Return ONLY the English translation, nothing else:\n\n{text}"}],
                },
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                translated = data.get("content", [{}])[0].get("text", "").strip()
                if translated and not _is_non_english(translated):
                    logger.info(f"Anthropic translated: '{text[:40]}...' -> '{translated[:40]}...'")
                    return translated
            else:
                logger.debug(f"Anthropic translation HTTP {resp.status_code}")
        except Exception as e:
            logger.debug(f"Anthropic translation failed: {e}")

    # Method 3: Google Translate free API (often blocked on server IPs)
    try:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {"client": "gtx", "sl": "auto", "tl": "en", "dt": "t", "q": text}
        resp = await client.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data and data[0]:
                translated = "".join(part[0] for part in data[0] if part[0])
                if translated.strip() and not _is_non_english(translated.strip()):
                    logger.info(f"Google translated: '{text[:40]}...' -> '{translated[:40]}...'")
                    return translated.strip()
    except Exception as e:
        logger.debug(f"Google Translate failed: {e}")

    logger.warning(f"All translation methods failed for: '{text[:60]}...'")
    return text  # Return original if all methods fail


# ── RSS sources ───────────────────────────────────────────────────────────────
RSS_SOURCES = [
    # ── Tier 1: India — Markets & Economy ──────────────────────────────────────
    {"url": "https://economictimes.indiatimes.com/markets/rss.cms",         "name": "ET Markets",    "region": "IN"},
    {"url": "https://www.moneycontrol.com/rss/marketsindia.xml",            "name": "MoneyControl",  "region": "IN"},
    {"url": "https://www.livemint.com/rss/markets",                         "name": "LiveMint",      "region": "IN"},
    {"url": "https://www.business-standard.com/rss/markets-106.rss",        "name": "Business Standard", "region": "IN"},
    {"url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^NSEI&region=IN&lang=en-IN", "name": "Yahoo Finance IN", "region": "IN"},
    {"url": "https://economictimes.indiatimes.com/news/economy/rss.cms",    "name": "ET Economy",    "region": "IN"},
    {"url": "https://www.moneycontrol.com/rss/economy.xml",                 "name": "MoneyControl Economy", "region": "IN"},
    # India — Industry & economy sources
    {"url": "https://economictimes.indiatimes.com/industry/rss.cms",        "name": "ET Industry",   "region": "IN"},
    {"url": "https://www.business-standard.com/rss/economy-policy-106.rss", "name": "BS Economy",    "region": "IN"},
    {"url": "https://www.livemint.com/rss/industry",                        "name": "LiveMint",      "region": "IN"},
    {"url": "https://www.moneycontrol.com/rss/business.xml",                "name": "MoneyControl",  "region": "IN"},
    # India — Policy & Semiconductor
    {"url": "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=2&Regid=3",      "name": "PIB India",     "region": "IN"},  # English only (Hindi feed removed — translation APIs unreliable from server IPs)
    {"url": "https://www.electronicsb2b.com/feed/",                         "name": "ElectronicsB2B", "region": "IN"},

    # ── Tier 1: US / Global — Macro ────────────────────────────────────────────
    {"url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,MSFT,NVDA,GOOGL,TSLA,AMZN,META&region=US&lang=en-US", "name": "Yahoo Finance US", "region": "US"},
    {"url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=JPM,BAC,JNJ,PG,XOM,AMD,INTC,NFLX,ORCL&region=US&lang=en-US", "name": "Yahoo Finance US2", "region": "US"},
    {"url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",        "name": "CNBC",          "region": "US"},
    {"url": "https://www.cnbc.com/id/20910258/device/rss/rss.html",         "name": "CNBC Economy",  "region": "US"},
    {"url": "https://feeds.marketwatch.com/marketwatch/topstories/",        "name": "MarketWatch",   "region": "US"},
    {"url": "https://feeds.marketwatch.com/marketwatch/marketpulse/",       "name": "MarketWatch Pulse", "region": "US"},
    {"url": "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best", "name": "Reuters Finance", "region": "GLOBAL"},
    {"url": "https://feeds.bloomberg.com/markets/news.rss",                 "name": "Bloomberg",     "region": "GLOBAL"},
    {"url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", "name": "CNBC World", "region": "GLOBAL"},

    # ── Tier 2: Industry Signal — Semiconductors & Supply Chain ────────────────
    {"url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,AMD,TSM,MU,AVGO,INTC,ASML,AMAT,LRCX&region=US&lang=en-US", "name": "Yahoo Tech Semis", "region": "US"},
    {"url": "https://www.cnbc.com/id/19854910/device/rss/rss.html",         "name": "CNBC Tech",     "region": "US"},
    {"url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=EQIX,DLR,VRT,ANET&region=US&lang=en-US", "name": "Yahoo Data Center", "region": "US"},
    # SemiAnalysis (Substack RSS)
    {"url": "https://semianalysis.com/feed",                                "name": "SemiAnalysis",  "region": "GLOBAL"},
    # DigiTimes — Asia supply chain (VERY important)
    {"url": "https://www.digitimes.com/rss/daily_news_20.xml",              "name": "DigiTimes",     "region": "GLOBAL"},
    # EE Times — supply chain + design shifts
    {"url": "https://www.eetimes.com/feed/",                                "name": "EE Times",      "region": "GLOBAL"},
    # Semiconductor Engineering — deep technical bottlenecks
    {"url": "https://semiengineering.com/feed/",                            "name": "Semiconductor Engineering", "region": "GLOBAL"},
    # IEEE Spectrum — future tech signals
    {"url": "https://spectrum.ieee.org/feeds/feed.rss",                     "name": "IEEE Spectrum",  "region": "GLOBAL"},
    # Evertiq — manufacturing + OEM signals
    {"url": "https://evertiq.com/news/rss",                                 "name": "Evertiq",       "region": "GLOBAL"},
    # SEMI — policy + fab investments
    {"url": "https://www.semi.org/en/rss-feeds",                            "name": "SEMI",          "region": "GLOBAL"},

    # ── Tier 3: Hyperscaler / AI infra tracking ──────────────────────────────
    {"url": "https://www.theregister.com/headlines.atom",                   "name": "The Register",  "region": "GLOBAL"},
    {"url": "https://www.servethehome.com/feed/",                           "name": "ServeTheHome",  "region": "GLOBAL"},
    {"url": "https://www.theinformation.com/feed",                          "name": "The Information", "region": "US"},

    # ── Tier 4: Policy — Geopolitics & Think Tanks ────────────────────────────
    {"url": "https://www.csis.org/analysis/feed",                           "name": "CSIS",          "region": "GLOBAL"},
    {"url": "https://www.brookings.edu/feed/",                              "name": "Brookings",     "region": "GLOBAL"},
]

# ── Ticker detection dictionary ───────────────────────────────────────────────
TICKER_MAP = {
    # India
    "RELIANCE": ["reliance industries", "reliance jio", "mukesh ambani", "ril"],
    "TCS": ["tata consultancy", "tcs"],
    "INFY": ["infosys", "infy"],
    "HDFCBANK": ["hdfc bank", "hdfc"],
    "ICICIBANK": ["icici bank", "icici"],
    "WIPRO": ["wipro"],
    "BAJFINANCE": ["bajaj finance", "bajaj fin"],
    "TATAMOTORS": ["tata motors", "jaguar land rover", "jlr"],
    "SUNPHARMA": ["sun pharma", "sun pharmaceutical"],
    "ADANIENT": ["adani enterprises", "adani group", "gautam adani"],
    "HCLTECH": ["hcl technologies", "hcl tech"],
    "LTIM": ["ltimindtree", "mindtree"],
    "AXISBANK": ["axis bank"],
    "KOTAKBANK": ["kotak mahindra", "kotak bank"],
    "SBIN": ["state bank of india", "sbi"],
    "MARUTI": ["maruti suzuki", "maruti"],
    "HAL": ["hindustan aeronautics", "hal"],
    "BEL": ["bharat electronics", "bel"],
    "ONGC": ["ongc", "oil and natural gas"],
    "NTPC": ["ntpc", "national thermal power"],
    # US
    "AAPL": ["apple inc", "apple iphone", "tim cook", "cupertino"],
    "MSFT": ["microsoft", "azure", "satya nadella"],
    "NVDA": ["nvidia", "jensen huang", "h100", "blackwell"],
    "GOOGL": ["alphabet", "google", "deepmind", "waymo"],
    "AMZN": ["amazon", "aws", "andy jassy"],
    "META": ["meta platforms", "facebook", "mark zuckerberg", "instagram", "whatsapp"],
    "TSLA": ["tesla", "elon musk", "cybertruck"],
    "AMD": ["advanced micro devices", "amd", "lisa su"],
    "INTC": ["intel", "pat gelsinger"],
    "NFLX": ["netflix", "reed hastings"],
    "JPM": ["jpmorgan", "jp morgan", "jamie dimon"],
    "BAC": ["bank of america", "bofa"],
    "ORCL": ["oracle", "larry ellison"],
    # Bottleneck-related tickers
    "TSM": ["tsmc", "taiwan semiconductor", "taiwan semi"],
    "MU": ["micron", "micron technology"],
    "AVGO": ["broadcom", "broadcom inc"],
    "MRVL": ["marvell", "marvell technology"],
    "COHR": ["coherent", "coherent corp", "ii-vi"],
    "LITE": ["lumentum"],
    "ANET": ["arista networks", "arista"],
    "ON": ["on semiconductor", "onsemi"],
    "LRCX": ["lam research"],
    "AMAT": ["applied materials"],
    "ASML": ["asml"],
    "KLAC": ["kla corp", "kla-tencor"],
    "WOLF": ["wolfspeed"],
    "MP": ["mp materials"],
    "LAC": ["lithium americas"],
    "ALB": ["albemarle"],
    "VRT": ["vertiv"],
    "EQIX": ["equinix"],
    "DLR": ["digital realty"],
}

# ── Importance signals ────────────────────────────────────────────────────────
HIGH_IMPORTANCE = [
    "earnings", "quarterly results", "q1", "q2", "q3", "q4", "profit", "revenue",
    "beat", "miss", "guidance", "merger", "acquisition", "buyout", "ceo", "resign",
    "fda", "sebi", "rbi", "fed", "rate cut", "rate hike", "interest rate",
    "bankruptcy", "fraud", "investigation", "lawsuit", "contract win", "order win",
    "record high", "record low", "all-time", "billion", "crore", "trillion",
    "fii", "foreign investor", "dii", "institutional", "block deal",
    "gdp", "inflation", "cpi", "pmi", "unemployment",
    "tariff", "sanction", "trade war", "geopolitical",
]
MEDIUM_IMPORTANCE = [
    "upgrade", "downgrade", "target price", "buy", "sell", "hold", "overweight",
    "dividend", "bonus", "rights issue", "buyback", "split", "ipo",
    "nifty", "sensex", "nasdaq", "s&p", "market", "rally", "crash",
    "outlook", "forecast", "estimate", "consensus", "analyst",
    "sector rotation", "momentum", "breakout", "support", "resistance",
]
# ── Bottleneck detection keywords ─────────────────────────────────────────────
# Each key is a bottleneck sub-category; values are keyword phrases to detect.
# When ANY phrase matches in the headline+description, the article is tagged BOTTLENECK.
BOTTLENECK_KEYWORDS = {
    # ── GLOBAL / US BOTTLENECKS ──
    # NOTE: Only use phrases that indicate ACTUAL supply constraints, shortages,
    # capacity limits, or infrastructure buildout — NOT general stock analysis.
    "GPU_SHORTAGE": [
        "gpu shortage", "gpu bottleneck", "gpu supply", "gpu scarcity", "gpu allocation",
        "gpu constraint", "ai chip shortage", "ai chip supply", "ai chip bottleneck",
        "h100 shortage", "h100 supply", "h200 shortage", "b100 shortage", "b200 shortage",
        "blackwell shortage", "blackwell supply", "blackwell bottleneck", "blackwell delay",
        "hopper shortage", "hopper supply", "gpu crunch", "accelerator shortage",
        "ai accelerator supply", "compute shortage", "compute bottleneck",
        "chip shortage", "semiconductor shortage", "chip export restrict",
        "restricted ai chip", "chip ban", "chip curb",
    ],
    "HBM_MEMORY": [
        "hbm shortage", "hbm supply", "hbm bottleneck", "hbm capacity", "hbm constraint",
        "hbm3", "hbm3e", "hbm4", "high bandwidth memory", "memory bottleneck",
        "dram shortage", "dram supply constraint", "dram bottleneck", "memory supply crunch",
        "memory capacity constraint", "ai memory demand",
        "memory supply shortage", "memory production capacity",
    ],
    "PHOTONICS": [
        "photonics bottleneck", "photonics supply", "optical interconnect",
        "silicon photonics", "optical transceiver shortage", "optical transceiver supply",
        "co-packaged optics", "cpo bottleneck", "photonic chip", "optical networking constraint",
        "800g transceiver", "1.6t transceiver", "optical module shortage",
        "fiber optic bottleneck", "coherent optics supply",
    ],
    "COWOS_PACKAGING": [
        "cowos", "cowos shortage", "cowos bottleneck", "cowos capacity", "cowos supply",
        "advanced packaging shortage", "advanced packaging bottleneck",
        "chip packaging constraint",
        "2.5d packaging", "3d packaging shortage", "tsmc packaging", "interposer shortage",
        "soic packaging", "chiplet packaging bottleneck",
    ],
    "POWER_GRID": [
        "power bottleneck", "power grid constraint", "power grid bottleneck",
        "data center power contract", "data center power shortage",
        "power shortage data center", "power shortage",
        "electricity shortage", "grid capacity constraint", "power transformer shortage",
        "transformer bottleneck", "transformer supply chain", "power infrastructure bottleneck",
        "energy bottleneck", "nuclear data center", "power capacity constraint",
        "utility bottleneck", "grid interconnection delay", "grid congestion",
        "power demand data center", "energy constraint", "power limits",
    ],
    "DATA_CENTER_CAPACITY": [
        "cooling bottleneck", "data center cooling", "liquid cooling shortage",
        "cooling capacity constraint", "immersion cooling", "cooling infrastructure",
        "thermal management bottleneck", "heat dissipation constraint",
        "data center capacity shortage", "data center capacity constraint",
        "ai factory campus", "data center buildout",
    ],
    "RARE_EARTH": [
        "rare earth shortage", "rare earth supply", "rare earth bottleneck",
        "rare earth constraint", "rare mineral supply", "critical mineral shortage",
        "lithium shortage", "lithium supply constraint", "cobalt shortage", "cobalt supply",
        "gallium shortage", "germanium shortage", "neon supply", "neon shortage",
        "palladium supply", "platinum supply constraint", "mineral bottleneck",
        "helium shortage", "helium supply",
    ],
    "WATER_SCARCITY_FABS": [
        "water scarcity fab", "water shortage semiconductor", "water constraint chip",
        "fab water supply", "semiconductor water usage", "tsmc water",
        "water bottleneck manufacturing",
    ],
    "SEMICONDUCTOR_LABOR": [
        "semiconductor labor shortage", "chip engineer shortage", "fab worker shortage",
        "semiconductor talent", "chip industry workforce", "semiconductor workforce",
        "fab technician shortage", "semiconductor hiring",
    ],
    "SUPPLY_CHAIN": [
        "supply chain constraint", "supply chain bottleneck", "supply chain disruption",
        "chip supply chain", "semiconductor supply chain",
    ],
    # ── INDIA-SPECIFIC BOTTLENECKS ──
    # NOTE: Indian news sources (ET, MoneyControl, LiveMint, BS) rarely use "india" in
    # headlines — they assume an Indian context. Keywords must work WITHOUT "india" prefix.
    "INDIA_SEMICONDUCTOR_FAB": [
        # With "india" prefix (for global sources mentioning India)
        "india semiconductor fab", "india chip manufacturing", "india fab capacity",
        "india semiconductor bottleneck", "india chip production constraint",
        "semiconductor mission india", "india semiconductor supply",
        # Without "india" prefix (for Indian news sources)
        "tata semiconductor", "vedanta foxconn fab", "dholera fab",
        "tata electronics fab", "semiconductor fab", "chip fab",
        "semiconductor manufacturing plant", "fab construction delay",
        "pli semiconductor", "pli for semiconductors", "semicon india",
        "chip manufacturing facility", "assembly testing marking packaging",
        "atmp facility", "osat facility", "ismc fab",
        "semiconductor ecosystem", "fab investment", "chip fabrication",
    ],
    "INDIA_POWER_GRID": [
        # With "india" prefix
        "india power shortage", "india power grid bottleneck", "india grid constraint",
        "india electricity shortage", "india power transmission bottleneck",
        "india power infrastructure", "india transmission capacity",
        "india coal shortage power", "india renewable grid integration",
        "india power deficit",
        # Without "india" prefix (common in Indian financial press)
        "discom bottleneck", "discom losses", "discom debt", "discom crisis",
        "power deficit", "power shortage", "electricity shortage",
        "coal shortage", "coal supply crisis", "coal stock crisis",
        "thermal plant shutdown", "power grid failure", "grid failure",
        "transmission bottleneck", "transmission capacity constraint",
        "power tariff hike", "discoms", "power distribution losses",
        "renewable integration challenge", "solar curtailment",
        "wind curtailment", "green energy corridor", "power evacuation",
        "electricity demand surge", "peak power demand", "power crisis",
        "load shedding", "power cut", "blackout",
    ],
    "INDIA_PORT_LOGISTICS": [
        # With "india" prefix
        "india port bottleneck", "india port congestion", "india logistics bottleneck",
        "india container shortage", "india freight bottleneck", "india supply chain constraint",
        "india shipping bottleneck",
        # Without "india" prefix
        "sagarmala bottleneck", "sagarmala delay",
        "port congestion", "container shortage", "freight bottleneck",
        "logistics bottleneck", "cold chain shortage", "cold chain gap",
        "warehouse shortage", "warehousing shortage", "warehousing capacity",
        "port capacity constraint", "shipping delay", "nhais port",
        "jnpt congestion", "mundra port", "adani port capacity",
        "coastal shipping constraint", "freight corridor delay",
        "dedicated freight corridor", "gati shakti bottleneck",
        "multimodal logistics", "logistics cost",
    ],
    "INDIA_TELECOM_FIBER": [
        # With "india" prefix
        "india telecom bottleneck", "india fiber bottleneck", "india 5g rollout delay",
        "india broadband bottleneck", "india telecom infrastructure",
        "india fiber optic deployment", "india spectrum constraint",
        # Without "india" prefix
        "bharatnet bottleneck", "bharatnet delay", "bharatnet slow",
        "5g rollout delay", "5g spectrum", "5g tower shortage",
        "fiber rollout", "fiber deployment delay", "fiberisation",
        "telecom tower shortage", "tower infrastructure gap",
        "broadband penetration", "digital divide", "last mile connectivity",
        "spectrum auction", "spectrum shortage", "right of way delay",
        "row challenge telecom", "backhaul capacity",
    ],
    "INDIA_UPI_PAYMENTS": [
        "upi bottleneck", "upi scalability", "upi capacity constraint",
        "upi infrastructure", "upi transaction failure",
        "payment bottleneck india", "digital payment infrastructure india",
        # Broader — these don't need "india" prefix
        "upi outage", "upi downtime", "upi server", "upi decline rate",
        "npci capacity", "npci infrastructure", "payment system outage",
        "digital payment failure", "upi transaction limit",
        "rupay infrastructure", "payment gateway bottleneck",
    ],
    "INDIA_EV_CHARGING": [
        # With "india" prefix
        "india ev charging bottleneck", "india ev infrastructure",
        "india charging station shortage", "india ev charging constraint",
        "india ev supply chain", "india battery bottleneck", "india ev ecosystem gap",
        # Without "india" prefix
        "ev charging shortage", "ev charging infrastructure gap",
        "charging station shortage", "ev infrastructure gap",
        "battery manufacturing bottleneck", "battery cell shortage",
        "lithium ion battery supply", "ev battery supply",
        "fame subsidy", "fame scheme", "pli battery",
        "ev adoption bottleneck", "charging network gap",
    ],
    "INDIA_DATA_CENTER": [
        # With "india" prefix
        "india data center bottleneck", "india data center capacity",
        "india cloud infrastructure constraint", "india data center shortage",
        "india hyperscale bottleneck",
        # Without "india" prefix
        "data center capacity crunch", "hyperscale capacity",
        "cloud infrastructure shortage", "data center land shortage",
        "data center power constraint", "data center water usage",
        "data center cooling constraint", "edge data center gap",
        "data localisation infrastructure", "data sovereignty infrastructure",
    ],
    "INDIA_WATER_INFRA": [
        "water crisis", "water shortage", "water scarcity",
        "groundwater depletion", "water supply crisis", "water stress",
        "jal jeevan mission delay", "drinking water shortage",
        "water infrastructure gap", "water treatment bottleneck",
        "dam water level low", "reservoir shortage",
    ],
    "INDIA_HOUSING_INFRA": [
        "housing shortage", "affordable housing gap", "housing bottleneck",
        "cement shortage", "steel shortage construction",
        "construction labour shortage", "real estate supply constraint",
        "pmay delay", "housing supply deficit", "construction bottleneck",
        "sand shortage", "sand mining ban",
    ],
}

# Headlines containing these phrases are likely stock analysis / investment advice,
# NOT real supply-chain bottleneck stories.  Used to reject false-positive matches.
BOTTLENECK_REJECT_PHRASES = [
    "if i had", "should you buy", "time to buy", "best stock", "top stock",
    "better buy", "buy or sell", "investment ideas", "zacks", "motley fool",
    "is down %", "stock falls", "stock drops", "stock is getting crushed",
    "did the .* leader just peak", "stock still", "wall street sees",
    "valuation after", "can it drive growth", "winning the .* race",
    "quietly winning", "split it between", "$10,000 to invest",
    "assess valuation", "reassess risk",
    "ps5 price", "playstation", "xbox", "console price",
]

# Flatten for quick lookup
_ALL_BOTTLENECK_PHRASES: list[str] = []
for _phrases in BOTTLENECK_KEYWORDS.values():
    _ALL_BOTTLENECK_PHRASES.extend(_phrases)

# Low-quality / irrelevant keywords that reduce score
LOW_QUALITY_KEYWORDS = [
    "celebrity", "real estate", "mansion", "wedding", "divorce",
    "entertainment", "movie", "music", "sports", "cricket",
    "horoscope", "astrology", "clickbait", "prediction",
    "gold price", "silver price", "weather", "astrology", "zodiac",
    "horoscope", "lottery", "game", "gaming", "fashion",
    "beauty", "health tips", "home remedies", "recipe",
]


_HEADLINE_STOP_WORDS = {
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
    'its', 'it', 'this', 'that', 'these', 'those', 'my', 'your', 'his',
    'her', 'our', 'their', 'what', 'which', 'who', 'whom', 'how', 'why',
    'when', 'where', 'here', 'there', 'just', 'also', 'very', 'more',
    'most', 'than', 'about', 'up', 'out', 'new', 'says', 'said',
    'heres', 'still', 'why',
}

# Common template words that appear in many headlines — these should NOT
# drive similarity on their own (e.g. "Why X Popped Today" vs "Why Y Popped Today")
_TEMPLATE_WORDS = {
    'stock', 'stocks', 'shares', 'today', 'popped', 'rises', 'falls',
    'drops', 'gains', 'slips', 'surges', 'tumbles', 'jumps', 'soars',
    'rally', 'dips', 'set', 'buying', 'life', 'update', 'sector',
    'leads', 'losers', 'gainers', 'group', 'session', 'straight',
    'third', 'second', 'first', 'market', 'ltd', 'inc', 'corp',
    'prices', 'rose', 'price', 'friday', 'monday', 'tuesday',
    'wednesday', 'thursday', 'saturday', 'sunday',
}


def _normalize_headline(headline: str) -> tuple[set[str], set[str]]:
    """Normalize a headline into (entity_words, content_words).

    entity_words: Proper nouns / company names / unique identifiers
    content_words: The rest of meaningful words

    Both sets exclude stop words.
    """
    text = re.sub(r'[^a-z0-9\s]', '', headline.lower())
    all_words = {w for w in text.split() if w and len(w) > 1
                 and w not in _HEADLINE_STOP_WORDS}
    entity_words = all_words - _TEMPLATE_WORDS
    return entity_words, all_words


def _headlines_similar(h1: str, h2: str) -> bool:
    """Check if two headlines are about the same story.

    Two-layer approach to avoid false positives:
    1. High overall Jaccard (>= 0.55) catches exact/near-exact rewrites
    2. Entity-word overlap check ensures the articles are about the SAME
       companies/topics, not just using the same headline template
    """
    ent1, all1 = _normalize_headline(h1)
    ent2, all2 = _normalize_headline(h2)

    if not all1 or not all2:
        return False

    # Overall word similarity
    all_inter = all1 & all2
    all_union = all1 | all2
    overall_sim = len(all_inter) / len(all_union)

    # High similarity — likely the same article syndicated
    if overall_sim >= 0.70:
        return True

    # Medium similarity — only match if entity words (non-template) overlap well
    if overall_sim >= 0.40 and ent1 and ent2:
        ent_inter = ent1 & ent2
        ent_union = ent1 | ent2
        ent_sim = len(ent_inter) / len(ent_union) if ent_union else 0
        # Require at least 50% entity overlap AND at least 2 shared entity words
        if ent_sim >= 0.50 and len(ent_inter) >= 2:
            return True

    return False


def _detect_bottleneck(title: str, description: str) -> list[str]:
    """Detect bottleneck sub-categories from article text.

    Returns a list of bottleneck theme tags (e.g. ['GPU_SHORTAGE', 'COWOS_PACKAGING']).
    Empty list means no bottleneck detected.

    Uses BOTTLENECK_REJECT_PHRASES to filter out stock-analysis / investment-advice
    articles that happen to mention infrastructure keywords but aren't about actual
    supply constraints.
    """
    text = (title + " " + (description or "")).lower()
    title_lower = title.lower()

    # Reject stock-analysis / investment-advice articles
    for reject_phrase in BOTTLENECK_REJECT_PHRASES:
        if re.search(reject_phrase, title_lower):
            return []

    matched_themes: list[str] = []
    for category, phrases in BOTTLENECK_KEYWORDS.items():
        for phrase in phrases:
            if phrase in text:
                matched_themes.append(category)
                break  # one match per category is enough

    # Regex-based secondary detection for patterns that need context
    _REGEX_PATTERNS = [
        (r'data center.*\$\d+.*billion', "DATA_CENTER_CAPACITY"),
        (r'\$\d+.*billion.*data center', "DATA_CENTER_CAPACITY"),
        (r'data center.*power contract', "POWER_GRID"),
        (r'pressuring memory chip', "HBM_MEMORY"),
        (r'divide in memory chip', "HBM_MEMORY"),
        # India infra patterns (don't require "india" in text)
        (r'(discom|distribution company).*loss', "INDIA_POWER_GRID"),
        (r'coal.*stock.*critical', "INDIA_POWER_GRID"),
        (r'power.*plant.*shut', "INDIA_POWER_GRID"),
        (r'(nhai|highway).*delay', "INDIA_PORT_LOGISTICS"),
        (r'(port|terminal).*capacity.*constraint', "INDIA_PORT_LOGISTICS"),
        (r'pli.*scheme.*(semiconductor|battery|solar)', "INDIA_SEMICONDUCTOR_FAB"),
        (r'(₹|rs\.?)\s*\d+.*crore.*(fab|semiconductor|chip)', "INDIA_SEMICONDUCTOR_FAB"),
        (r'(dam|reservoir).*level.*(low|critical|drop)', "INDIA_WATER_INFRA"),
        (r'(cement|steel|sand).*shortage', "INDIA_HOUSING_INFRA"),
        (r'construction.*labour.*shortage', "INDIA_HOUSING_INFRA"),
    ]
    for pattern, category in _REGEX_PATTERNS:
        if category not in matched_themes and re.search(pattern, text):
            matched_themes.append(category)

    return matched_themes


def _score_importance(title: str, description: str, is_bottleneck: bool = False) -> int:
    """Score article importance 1-5.

    Bottleneck articles are auto-boosted to at least 4.
    """
    text = (title + " " + (description or "")).lower()
    score = 1

    # Check for low-quality content first (but bottlenecks override this)
    if not is_bottleneck:
        for kw in LOW_QUALITY_KEYWORDS:
            if kw in text:
                return 1  # Never boost low-quality articles

    for kw in HIGH_IMPORTANCE:
        if kw in text:
            score = max(score, 4)
    for kw in MEDIUM_IMPORTANCE:
        if kw in text:
            score = max(score, 3)

    # Bonus for numbers that signal market-moving content
    import re
    if re.search(r'\d+[\s]*(%|percent|basis point|bps)', text):
        score = max(score, 3)
    if re.search(r'(\$|₹|rs\.?)\s*\d+.*?(billion|crore|trillion|lakh)', text):
        score = max(score, 4)

    # Bonus: contains a known ticker (check more carefully)
    for ticker, aliases in TICKER_MAP.items():
        # Use word boundaries for ticker symbol
        if re.search(r'\b' + re.escape(ticker.lower()) + r'\b', text):
            score = min(score + 1, 5)
            break
        # Check aliases
        for alias in aliases:
            if ' ' in alias:
                if alias in text:
                    score = min(score + 1, 5)
                    break
            else:
                if re.search(r'\b' + re.escape(alias.lower()) + r'\b', text):
                    score = min(score + 1, 5)
                    break
        if score > 2:
            break

    # Bottleneck articles always get high importance (at least 4)
    if is_bottleneck:
        score = max(score, 4)
        # If headline explicitly contains "bottleneck" or "shortage", bump to 5
        title_lower = title.lower()
        if any(w in title_lower for w in ["bottleneck", "shortage", "constraint", "scarcity", "crunch"]):
            score = 5

    # Minimum importance threshold: if no financial keywords found, rate as 1
    has_financial_keyword = any(
        kw in text for kw in
        HIGH_IMPORTANCE + MEDIUM_IMPORTANCE +
        ["market", "stock", "price", "share", "equity", "index", "nasdaq", "nifty", "sensex"]
        + ["bottleneck", "shortage", "constraint", "supply chain"]
    )
    if not has_financial_keyword and score == 1:
        return 1

    return score


def _extract_tickers(title: str, description: str) -> list[str]:
    """Extract ticker mentions from article text with word boundary matching.

    Ambiguous tickers (BAC, META, V, MA, IT, HAL, BEL, CAT, ALL, ON, A) need stricter matching:
    - Must appear as a standalone word (surrounded by spaces/punctuation)
    - Must appear in the headline (not just description)
    """
    title_lower = title.lower()
    full_text = (title + " " + (description or "")).lower()
    found = []

    # Tickers that match common English words and need stricter matching
    ambiguous_tickers = {"BAC", "META", "V", "MA", "IT", "HAL", "BEL", "CAT", "ALL", "ON", "A"}

    for ticker, aliases in TICKER_MAP.items():
        matched = False

        # Check ticker symbol itself with word boundaries
        if re.search(r'\b' + re.escape(ticker.lower()) + r'\b', full_text):
            # For ambiguous tickers, only match if in headline
            if ticker in ambiguous_tickers:
                if re.search(r'\b' + re.escape(ticker.lower()) + r'\b', title_lower):
                    matched = True
            else:
                matched = True

        # Check aliases more carefully
        if not matched:
            for alias in aliases:
                # Skip single-char aliases that cause false positives
                if len(alias) <= 2:
                    continue

                # Use word boundaries for multi-word aliases
                if ' ' in alias:
                    # Multi-word aliases: check as substring in full text
                    if alias.lower() in full_text:
                        # For ambiguous tickers, also check if in headline
                        if ticker in ambiguous_tickers:
                            if alias.lower() in title_lower:
                                matched = True
                                break
                        else:
                            matched = True
                            break
                else:
                    # Single-word aliases: use word boundaries to avoid partial matches
                    if re.search(r'\b' + re.escape(alias.lower()) + r'\b', full_text):
                        # For ambiguous tickers, also check if in headline
                        if ticker in ambiguous_tickers:
                            if re.search(r'\b' + re.escape(alias.lower()) + r'\b', title_lower):
                                matched = True
                                break
                        else:
                            matched = True
                            break

        if matched:
            found.append(ticker)

    return found[:5]  # max 5 tickers per article


def _is_rating_change(title_lower: str) -> bool:
    """Detect if a headline is about an analyst rating change / broker recommendation.

    Covers Indian brokers (Kotak, CLSA, Morgan Stanley, Goldman Sachs, etc.)
    and US brokers (upgrades, downgrades, price targets, initiations).
    """
    # Exclude generic buy/sell recommendation editorials FIRST (before broker matching)
    editorial_phrases = ["stocks to buy", "shares to buy", "buy or sell", "stocks to sell",
                        "should you buy", "top picks for", "best stocks", "recommends three shares",
                        "recommends two shares", "recommends five shares", "shares to buy or sell",
                        "stocks under", "under ₹", "under rs"]
    if any(ep in title_lower for ep in editorial_phrases):
        return False

    # Direct rating action words
    rating_keywords = [
        "upgrade", "downgrade", "rating", "target price", "price target",
        "initiates coverage", "initiates", "initiate", "reiterate",
        "maintains buy", "maintains sell", "maintains hold", "maintains add",
        "maintains reduce", "maintains overweight", "maintains underweight",
        "maintains outperform", "maintains neutral", "maintains equal-weight",
        "neutral to buy", "buy to neutral",
        "overweight to neutral", "neutral to overweight",
        "underweight to neutral", "equal-weight",
        "market perform",
        "sector perform", "sector outperform",
        "top pick", "conviction buy", "conviction list",
    ]
    if any(kw in title_lower for kw in rating_keywords):
        return True

    # Broker name + action pattern (e.g. "Goldman Sachs Maintains NVDA to Buy")
    brokers = [
        "goldman sachs", "morgan stanley", "jp morgan", "jpmorgan",
        "citigroup", "citi", "barclays", "ubs", "credit suisse",
        "deutsche bank", "bank of america", "bofa", "wells fargo",
        "raymond james", "jefferies", "piper sandler", "bernstein",
        "kotak", "clsa", "nomura", "macquarie", "hsbc",
        "motilal oswal", "iifl", "icici securities", "axis securities",
        "hdfc securities", "emkay", "nuvama", "elara", "prabhudas",
        "anand rathi", "jm financial", "ambit", "edelweiss",
        "bernstein", "canaccord", "oppenheimer", "needham",
        "wedbush", "rosenblatt", "loop capital", "truist",
        "keybanc", "stifel", "baird", "btig", "cowen",
    ]
    actions = ["buy", "sell", "hold", "add", "reduce", "accumulate",
               "overweight", "underweight", "neutral", "outperform",
               "equal-weight", "maintains", "upgrades", "downgrades",
               "raises", "lowers", "cuts", "pt ₹", "pt $", "tp ₹", "tp $"]
    for broker in brokers:
        if broker in title_lower:
            if any(act in title_lower for act in actions):
                return True

    # Pattern: "X Maintains/Upgrades Y to Buy/Sell" etc.
    if re.search(r'(maintains|upgrades?|downgrades?|raises?|lowers?|cuts?|initiates?)\s+\w+\s+to\s+(buy|sell|hold|add|reduce|neutral|overweight|underweight|outperform)', title_lower):
        return True

    return False


def _is_geopolitical(title_lower: str) -> bool:
    """Detect geopolitical/defense articles."""
    keywords = [
        "war", "iran", "china", "taiwan", "sanctions", "embargo", "military",
        "defense", "defence", "geopolitical", "geopolitics", "strait of hormuz",
        "houthi", "missile", "nato", "pentagon", "troops", "conflict",
        "airstrikes", "ceasefire", "nuclear", "invasion", "occupation",
        "south china sea", "us-china", "us-iran", "tariff war",
        "rare earth", "export ban", "import ban", "chip ban", "chips act",
        "entity list", "security threat", "national security",
    ]
    return any(kw in title_lower for kw in keywords)


def _is_tariff(title_lower: str) -> bool:
    """Detect tariff/trade war articles."""
    keywords = [
        "tariff", "trade war", "trade deal", "import duty", "export duty",
        "customs duty", "anti-dumping", "countervailing", "trade deficit",
        "trade surplus", "wto", "free trade", "trade agreement",
        "supply chain disruption", "reshoring", "nearshoring", "onshoring",
        "decoupling", "de-risking", "friend-shoring",
    ]
    return any(kw in title_lower for kw in keywords)


def _infer_sentiment(title: str) -> str:
    """Infer simple sentiment from headline using word boundary matching."""
    text = title.lower()

    bullish_words = [
        "surge", "surges", "rally", "rallies", "jump", "jumps", "beats", "beat",
        "record high", "wins", "win", "rise", "rises", "rising", "rose",
        "profit up", "growth", "buy", "upgrade", "upgraded", "outperform", "overweight",
        "rebounds", "rebound", "gains", "gain", "soars", "soar", "higher", "strong", "robust",
        "expansion", "optimism", "positive", "bullish", "breakout", "breaks out",
    ]
    bearish_words = [
        "fall", "falls", "falling", "fell", "crash", "crashes", "miss", "misses",
        "loss", "losses", "down", "decline", "declines", "declined", "declining",
        "sell", "downgrade", "downgraded", "cut", "cuts", "cutting", "plunge", "plunges",
        "fraud", "underperform", "underweight", "slump", "slumps", "drop", "drops",
        "lower", "weak", "contraction", "pessimism", "negative", "bearish", "pullback",
        "record low", "bankruptcy", "pull out", "withdraw", "exit", "dump",
        "sink", "sinks", "slide", "slides", "plummets", "plummet", "loses", "lose",
    ]

    # Count matches with word boundaries where appropriate
    bull = sum(1 for w in bullish_words if re.search(r'\b' + re.escape(w) + r'\b', text))
    bear = sum(1 for w in bearish_words if re.search(r'\b' + re.escape(w) + r'\b', text))

    if bull > bear:
        return "BULLISH"
    if bear > bull:
        return "BEARISH"
    return "NEUTRAL"


def _parse_rss_xml(xml_text: str, source_name: str, region: str, source_url: str = "") -> list[dict]:
    """Simple RSS XML parser (no external deps).

    Also refines region detection:
    - Indian sources (ET Markets, MoneyControl, LiveMint, Business Standard, IBEF) -> IN
    - US sources (CNBC, MarketWatch, Bloomberg, Reuters) -> If mentions India specifically -> IN, else US
    """
    articles = []

    # Extract items using regex (handles RSS 2.0 and Atom feeds)
    items = re.findall(r'<item>(.*?)</item>', xml_text, re.DOTALL)
    # Also handle Atom feeds (e.g. The Register)
    if not items:
        items = re.findall(r'<entry>(.*?)</entry>', xml_text, re.DOTALL)

    # Determine region more intelligently based on source
    indian_sources = {"ET Markets", "ET Economy", "MoneyControl", "MoneyControl Economy", "LiveMint", "Business Standard", "IBEF", "Yahoo Finance IN", "PIB India", "ElectronicsB2B"}
    us_sources = {"CNBC", "CNBC Economy", "CNBC World", "MarketWatch", "MarketWatch Pulse", "Bloomberg", "Reuters Finance", "Yahoo Finance US", "Yahoo Finance US2", "The Information"}
    # Global sources: auto-detect region from content
    global_sources = {"SemiAnalysis", "DigiTimes", "EE Times", "Semiconductor Engineering", "IEEE Spectrum", "Evertiq", "SEMI", "The Register", "ServeTheHome", "CSIS", "Brookings"}

    for item in items[:30]:  # max 30 per source
        try:
            title_m = re.search(r'<title[^>]*><!\[CDATA\[(.*?)\]\]></title>|<title[^>]*>(.*?)</title>', item, re.DOTALL)
            # Handle both RSS <link>text</link> (with optional CDATA) and Atom <link href="..."/>
            link_m  = re.search(r'<link[^>]*><!\[CDATA\[(.*?)\]\]></link>|<link[^>]*>(.*?)</link>', item, re.DOTALL)
            link_href_m = re.search(r'<link[^>]*href=["\']([^"\']+)["\']', item)
            desc_m  = re.search(r'<description[^>]*><!\[CDATA\[(.*?)\]\]></description>|<description[^>]*>(.*?)</description>', item, re.DOTALL)
            # Also handle Atom <summary> and <content>
            if not desc_m:
                desc_m = re.search(r'<summary[^>]*><!\[CDATA\[(.*?)\]\]></summary>|<summary[^>]*>(.*?)</summary>', item, re.DOTALL)
            if not desc_m:
                desc_m = re.search(r'<content[^>]*><!\[CDATA\[(.*?)\]\]></content>|<content[^>]*>(.*?)</content>', item, re.DOTALL)
            date_m  = re.search(r'<pubDate[^>]*>(.*?)</pubDate>', item, re.DOTALL)
            # Also handle Atom <published> and <updated>
            if not date_m:
                date_m = re.search(r'<published[^>]*>(.*?)</published>|<updated[^>]*>(.*?)</updated>', item, re.DOTALL)

            title = (title_m.group(1) or title_m.group(2) or "").strip() if title_m else ""
            link  = ""
            if link_m:
                link = (link_m.group(1) or link_m.group(2) or "").strip()
            if not link and link_href_m:
                link = link_href_m.group(1).strip()
            # Strip any remaining CDATA wrappers from link
            link = re.sub(r'<!\[CDATA\[|\]\]>', '', link).strip()
            # Fix double-domain URLs (e.g., "livemint.com/https://www.livemint.com/...")
            http_match = re.search(r'https?://', link)
            if http_match and http_match.start() > 0:
                # There's content before the http:// — extract the real URL
                second_http = link.find('http', http_match.start() + 1)
                if second_http > 0:
                    link = link[second_http:]
            desc  = (desc_m.group(1) or desc_m.group(2) or "").strip() if desc_m else ""

            # Clean HTML tags from desc
            desc = re.sub(r'<[^>]+>', '', desc).strip()[:500]

            # Ensure source URL is absolute (fix 404 on relative URLs)
            if link and not link.startswith(("http://", "https://")):
                from urllib.parse import urlparse
                parsed_source = urlparse(source_url)
                base_url = f"{parsed_source.scheme}://{parsed_source.netloc}" if parsed_source.netloc else ""
                if base_url:
                    link = base_url + ("/" if not link.startswith("/") else "") + link

            if not title or len(title) < 20:
                continue

            # Skip articles with low-quality keywords
            title_lower = title.lower()
            if any(kw in title_lower for kw in LOW_QUALITY_KEYWORDS):
                continue

            # Parse date (RFC 2822 for RSS, ISO 8601 for Atom)
            published_at = datetime.utcnow()
            if date_m:
                date_str = (date_m.group(1) or (date_m.group(2) if date_m.lastindex and date_m.lastindex >= 2 else None) or "").strip()
                if date_str:
                    try:
                        from email.utils import parsedate_to_datetime
                        published_at = parsedate_to_datetime(date_str).replace(tzinfo=None)
                    except Exception:
                        try:
                            # Try ISO 8601 (Atom feeds)
                            published_at = datetime.fromisoformat(date_str.replace("Z", "+00:00")).replace(tzinfo=None)
                        except Exception:
                            pass

            # Refine region detection
            final_region = region
            combined_text = (title + " " + desc).lower()
            india_keywords = ["india", "indian", "nse", "bse", "sensex", "nifty", "rupee", "rbi",
                            "modi", "sebi", "adani", "reliance", "tata", "infosys", "wipro"]
            if source_name in indian_sources:
                final_region = "IN"
            elif source_name in us_sources:
                if any(keyword in combined_text for keyword in india_keywords):
                    final_region = "IN"
                else:
                    final_region = "US"
            elif source_name in global_sources:
                # Global/tech sources: check for India or US signals
                if any(keyword in combined_text for keyword in india_keywords):
                    final_region = "IN"
                elif any(keyword in combined_text for keyword in ["us ", "america", "washington", "silicon valley", "wall street"]):
                    final_region = "US"
                else:
                    final_region = "GLOBAL"

            articles.append({
                "headline": title,
                "source_url": link,
                "source_name": source_name,
                "region": final_region,
                "description": desc,
                "published_at": published_at,
            })
        except Exception as e:
            logger.debug(f"Failed to parse RSS item: {e}")
            continue

    return articles


class NewsIngestor:
    """Fetches news from RSS feeds and stores in DB."""

    async def ingest_all_sources(self, db: AsyncSession) -> int:
        """Fetch all sources and store articles. Returns count of new articles."""
        total = 0

        # Re-classify existing articles for bottlenecks (catches articles ingested before this feature)
        try:
            await self._reclassify_bottlenecks(db)
            await db.commit()
        except Exception as e:
            logger.warning(f"Bottleneck reclassification failed: {e}")
            try:
                await db.rollback()
            except Exception:
                pass

        # Then try live RSS feeds (may fail if no internet)
        try:
            import os as _os
            # Temporarily clear proxy env vars so httpx doesn't pick them up
            _saved_proxies = {}
            for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
                if _k in _os.environ:
                    _saved_proxies[_k] = _os.environ.pop(_k)
            try:
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                    for source in RSS_SOURCES:
                        try:
                            count = await self._ingest_source(client, db, source)
                            total += count
                            if count > 0:
                                await db.commit()
                            logger.info(f"Ingested {count} articles from {source['name']}")
                        except Exception as e:
                            logger.warning(f"Failed to ingest {source['name']}: {e}")
                            try:
                                await db.rollback()
                            except Exception:
                                pass
                    # IBEF web scraping disabled — it produced articles with broken URLs
                    # and incorrect timestamps.  Indian industry news is now covered by
                    # ET Industry, BS Economy, LiveMint, and MoneyControl RSS feeds.
            finally:
                # Restore proxy env vars
                _os.environ.update(_saved_proxies)
        except Exception as e:
            logger.warning(f"RSS ingestion failed (non-fatal): {e}")

        try:
            await db.commit()
            logger.info(f"News ingestion committed successfully. Total new articles: {total}")
        except Exception as e:
            logger.warning(f"Final news commit failed, rolling back: {e}")
            try:
                await db.rollback()
            except Exception:
                pass

        # ── Cross-source deduplication ──────────────────────────────────────
        # After ingestion, scan recent articles for same-story duplicates
        # across different sources.  Keep the article with the highest
        # importance score; mark the rest as is_duplicate=True.
        try:
            await self._deduplicate_articles(db)
            await db.commit()
        except Exception as e:
            logger.warning(f"Deduplication pass failed: {e}")
            try:
                await db.rollback()
            except Exception:
                pass

        return total

    async def _deduplicate_articles(self, db: AsyncSession) -> int:
        """Cross-source deduplication: find articles about the same story from
        different sources and mark lower-quality ones as is_duplicate=True.

        Only checks articles from the last 3 days (recent window).
        Uses headline word-overlap (Jaccard similarity) to detect same-story pairs.
        Keeps the article with the highest importance_score as the canonical one.
        """
        cutoff = datetime.utcnow() - timedelta(days=3)
        result = await db.execute(
            select(NewsArticle)
            .where(
                and_(
                    NewsArticle.published_at >= cutoff,
                    NewsArticle.is_duplicate == False,  # noqa: E712
                )
            )
            .order_by(desc(NewsArticle.importance_score), desc(NewsArticle.published_at))
        )
        articles = result.scalars().all()

        if len(articles) < 2:
            return 0

        # Group articles into clusters of same-story duplicates
        # Keep a set of IDs already marked as duplicate to avoid re-checking
        marked_count = 0
        seen_ids: set = set()

        for i, art_a in enumerate(articles):
            if art_a.id in seen_ids:
                continue
            for j in range(i + 1, len(articles)):
                art_b = articles[j]
                if art_b.id in seen_ids:
                    continue
                # Only compare articles within 48h of each other
                time_diff = abs((art_a.published_at - art_b.published_at).total_seconds())
                if time_diff > 48 * 3600:
                    continue

                if _headlines_similar(art_a.headline, art_b.headline):
                    # Mark the lower-scored one as duplicate
                    # (articles are sorted by importance DESC, so art_b is <= art_a)
                    art_b.is_duplicate = True
                    art_b.duplicate_of = art_a.id
                    seen_ids.add(art_b.id)
                    marked_count += 1

        if marked_count:
            logger.info(f"Dedup: marked {marked_count} articles as duplicates")
        return marked_count

    async def _reclassify_bottlenecks(self, db: AsyncSession) -> int:
        """Re-scan existing articles and tag any that match bottleneck keywords.

        Only updates articles that are NOT already tagged as BOTTLENECK.
        Returns count of newly reclassified articles.
        """
        result = await db.execute(
            select(NewsArticle).where(NewsArticle.article_type != "BOTTLENECK")
        )
        articles = result.scalars().all()
        updated = 0

        for art in articles:
            themes = _detect_bottleneck(art.headline, art.summary or "")
            if themes:
                art.article_type = "BOTTLENECK"
                art.themes = themes
                new_score = _score_importance(art.headline, art.summary or "", is_bottleneck=True)
                art.importance_score = max(art.importance_score, new_score)
                updated += 1

        if updated:
            logger.info(f"Reclassified {updated} existing articles as BOTTLENECK")
        return updated

    async def _scrape_ibef_news(self, client: httpx.AsyncClient, db: AsyncSession) -> int:
        """Scrape IBEF news page directly as fallback when RSS feed fails.

        Fetches https://www.ibef.org/news and extracts article links & titles.
        """
        count = 0
        try:
            resp = await client.get(
                "https://www.ibef.org/news",
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            )
            if resp.status_code != 200:
                logger.debug(f"IBEF scrape returned status {resp.status_code}")
                return 0

            html = resp.text
            # Extract article links — IBEF uses patterns like /news/article-slug
            # Look for <a href="/news/..." title="..."> patterns
            articles = re.findall(
                r'<a[^>]+href=["\'](/news/[a-z0-9\-]+)["\'][^>]*>([^<]{20,})</a>',
                html, re.IGNORECASE
            )
            # Also try <h3> or <h4> tag patterns common in news listings
            articles += re.findall(
                r'href=["\'](?:https?://www\.ibef\.org)?(/news/[a-z0-9\-]+)["\'][^>]*>\s*(?:<[^>]+>)*\s*([^<]{20,})',
                html, re.IGNORECASE
            )

            seen_slugs = set()
            for slug, title in articles:
                slug = slug.strip()
                title = re.sub(r'<[^>]+>', '', title).strip()
                if slug in seen_slugs or len(title) < 20:
                    continue
                seen_slugs.add(slug)

                url = f"https://www.ibef.org{slug}"
                external_id = hashlib.md5(url.encode()).hexdigest()

                existing = await db.execute(
                    select(NewsArticle).where(NewsArticle.external_id == external_id)
                )
                if existing.scalar_one_or_none():
                    continue

                tickers = _extract_tickers(title, "")
                sentiment = _infer_sentiment(title)
                bottleneck_themes = _detect_bottleneck(title, "")
                is_bottleneck = len(bottleneck_themes) > 0
                importance = _score_importance(title, "", is_bottleneck=is_bottleneck)

                article_type = "GENERAL"
                title_lower = title.lower()
                if is_bottleneck:
                    article_type = "BOTTLENECK"
                elif any(w in title_lower for w in ["earnings", "results", "profit", "revenue"]):
                    article_type = "EARNINGS"
                elif any(w in title_lower for w in ["gdp", "inflation", "rbi", "policy"]):
                    article_type = "MACRO"

                article = NewsArticle(
                    external_id=external_id,
                    headline=title,
                    source_url=url,
                    source_name="IBEF",
                    region="IN",
                    article_type=article_type,
                    summary="",
                    tickers=tickers,
                    themes=bottleneck_themes if bottleneck_themes else [],
                    importance_score=importance,
                    sentiment=sentiment,
                    published_at=datetime.utcnow(),
                )
                db.add(article)
                count += 1

            if count > 0:
                await db.commit()
                logger.info(f"Scraped {count} IBEF articles from web page")
        except Exception as e:
            logger.warning(f"IBEF web scrape failed: {e}")
            try:
                await db.rollback()
            except Exception:
                pass
        return count

    async def _ingest_source(self, client: httpx.AsyncClient, db: AsyncSession, source: dict) -> int:
        """Fetch one RSS source."""
        try:
            response = await client.get(source["url"], headers={"User-Agent": "MarketCockpit/1.0"})
            if response.status_code != 200:
                return 0
            xml_text = response.text
        except Exception as e:
            logger.warning(f"HTTP fetch failed for {source['url']}: {e}")
            return 0

        articles = _parse_rss_xml(xml_text, source["name"], source["region"], source_url=source["url"])
        count = 0

        for art in articles:
            # Use URL hash as external_id for deduplication
            url = art["source_url"] or f"https://example.com/{hashlib.md5(art['headline'].encode()).hexdigest()}"
            external_id = hashlib.md5(url.encode()).hexdigest()

            # Skip duplicates by external_id
            existing = await db.execute(
                select(NewsArticle).where(NewsArticle.external_id == external_id)
            )
            if existing.scalar_one_or_none():
                continue

            # Translate non-English (Hindi) articles to English
            if _is_non_english(art["headline"]):
                art["headline"] = await _translate_text(art["headline"], client)
            if art["description"] and _is_non_english(art["description"]):
                art["description"] = await _translate_text(art["description"], client)

            # Skip articles that are STILL in Hindi after translation attempt
            if _is_non_english(art["headline"]):
                logger.warning(f"Skipping untranslated article: '{art['headline'][:60]}...'")
                continue

            tickers = _extract_tickers(art["headline"], art["description"])
            sentiment = _infer_sentiment(art["headline"])

            # Detect bottleneck themes FIRST (affects type & importance)
            bottleneck_themes = _detect_bottleneck(art["headline"], art["description"])
            is_bottleneck = len(bottleneck_themes) > 0

            importance = _score_importance(art["headline"], art["description"], is_bottleneck=is_bottleneck)

            # Determine article type — bottleneck takes priority
            title_lower = art["headline"].lower()
            if is_bottleneck:
                article_type = "BOTTLENECK"
            elif any(w in title_lower for w in ["earnings", "results", "profit", "revenue", "q1", "q2", "q3", "q4",
                                                  "quarterly", "annual result", "net income"]):
                article_type = "EARNINGS"
            elif _is_rating_change(title_lower):
                article_type = "RATING_CHANGE"
            elif any(w in title_lower for w in ["rbi", "fed", "rate cut", "rate hike", "gdp", "inflation", "cpi",
                                                  "monetary policy", "fiscal deficit", "current account"]):
                article_type = "MACRO"
            elif _is_geopolitical(title_lower):
                article_type = "GEOPOLITICAL"
            elif _is_tariff(title_lower):
                article_type = "TARIFF"
            elif any(w in title_lower for w in ["merger", "acquisition", "deal", "buyout", "takeover", "stake"]):
                article_type = "CORPORATE"
            else:
                article_type = "GENERAL"

            # Investment relevance classification
            from app.services.news_relevance import classify_investment_relevance
            ticker_symbols = []
            for t in tickers:
                if isinstance(t, str):
                    ticker_symbols.append(t)
                elif isinstance(t, dict) and t.get("ticker"):
                    ticker_symbols.append(t["ticker"])

            relevance = classify_investment_relevance(
                headline=art["headline"],
                summary=art["description"],
                tickers=ticker_symbols,
                importance_score=importance,
                article_type=article_type,
            )

            article = NewsArticle(
                external_id=external_id,
                headline=art["headline"],
                source_url=url,
                source_name=art["source_name"],
                region=art["region"],
                article_type=article_type,
                summary=art["description"],
                tickers=tickers,
                themes=bottleneck_themes if bottleneck_themes else [],
                importance_score=importance,
                sentiment=sentiment,
                published_at=art["published_at"],
                investment_tier=relevance["tier"],
                relevance_tags=relevance["relevance_tags"],
            )
            db.add(article)
            count += 1

        return count

