"""
Institutional-Grade Signal Scoring Engine
──────────────────────────────────────────
Classifies every news article into signal tiers:

  HIGH   (Tier 1): Market-moving, tradeable — affects earnings, multiples, or flows
  MEDIUM (Tier 2): Watchlist — structural/incremental, not immediately tradeable
  NOISE  (Tier 3): No alpha — opinion, speculation, filler, clickbait

Four signal filters (article must pass at least ONE for HIGH):
  1. Hard data       — earnings results, macro releases, flow data with numbers
  2. Capital events  — M&A, large capex, buybacks, guidance changes with $ values
  3. Regime shifts   — sanctions imposed, policy enacted, supply constraints confirmed
  4. Price shocks    — oil/FX/commodity moves with specific % or $ magnitude

Everything else is MEDIUM (if has ticker/sector relevance) or NOISE.
"""

import re
import logging

logger = logging.getLogger(__name__)

# ── HIGH signal keywords: hard data / earnings ────────────────────────────────
HARD_DATA_KEYWORDS = [
    # Actual earnings (not previews/estimates)
    "quarterly result", "quarterly earnings", "q1 result", "q2 result", "q3 result", "q4 result",
    "annual result", "annual earnings", "eps beat", "eps miss", "revenue beat", "revenue miss",
    "profit growth", "profit decline", "revenue growth", "revenue decline",
    "margin expansion", "margin compression", "margin contraction",
    "guidance raised", "guidance lowered", "guidance cut", "guidance above", "guidance below",
    "raises guidance", "lowers guidance", "cuts guidance", "raises forecast", "lowers forecast",
    "profit warning", "profit alert", "earnings surprise",
    "above consensus", "below consensus", "beat estimate", "miss estimate",
    # Hard macro data releases
    "gdp growth", "gdp data", "gdp number", "gdp print", "gdp came in",
    "cpi data", "cpi print", "cpi came", "inflation data", "inflation rate",
    "pmi data", "pmi came", "pmi print", "pmi reading",
    "jobs report", "jobs data", "unemployment rate", "nonfarm payroll", "non-farm payroll",
    "retail sales data", "consumer confidence data", "pce data", "pce print",
    # Rate decisions (actual, not speculation)
    "rate cut", "rate hike", "rate hold", "rate decision", "rate unchanged",
    "basis points", "bps cut", "bps hike",
    "fomc decision", "fomc statement", "rbi policy", "rbi decision", "ecb decision",
    # FII/DII flows with data
    "fii outflow", "fii inflow", "fii selling", "fii buying", "fii sold", "fii bought",
    "dii buying", "dii selling", "dii bought", "dii sold",
    "foreign investor", "institutional flow",
]

# ── HIGH signal keywords: capital events ──────────────────────────────────────
CAPITAL_EVENT_KEYWORDS = [
    # M&A (actual deals, not rumors)
    "acquires", "acquired", "acquisition complete", "merger complete", "merger approved",
    "takeover bid", "takeover offer", "buyout", "buyout deal",
    # Large capex
    "billion investment", "billion expansion", "billion capex",
    "crore investment", "crore expansion", "crore capex",
    "factory build", "fab expansion", "plant expansion", "new plant",
    "data center investment", "data center build",
    # Shareholder returns
    "buyback", "share repurchase", "special dividend", "dividend hike", "dividend increase",
    "stock split",
    # IPO / listing
    "ipo launch", "ipo open", "ipo price",
]

# ── HIGH signal keywords: regime shifts ───────────────────────────────────────
REGIME_SHIFT_KEYWORDS = [
    # Sanctions/policy ENACTED (not proposed)
    "sanctions imposed", "sanctions enacted", "new sanctions",
    "tariff imposed", "tariff enacted", "new tariff", "tariff increase",
    "export ban", "import ban", "chip ban", "chip curb enacted",
    "trade restriction", "entity list",
    # Military/geopolitical escalation
    "airstrikes", "military strike", "troops deployed", "invasion",
    "blockade", "strait of hormuz", "naval deployment",
    "carrier strike group", "ceasefire",
    # Regulatory action
    "antitrust ruling", "court ruling", "regulatory action",
    "fda approved", "fda rejected", "sebi order", "sebi action",
    # Supply constraints CONFIRMED
    "shortage confirmed", "supply disruption", "production halt",
    "plant shutdown", "refinery shutdown",
]

# ── HIGH signal keywords: price shocks ────────────────────────────────────────
PRICE_SHOCK_KEYWORDS = [
    "oil shock", "oil surge", "oil spike", "oil crash", "oil plunge",
    "crude oil", "brent crude", "wti crude",
    "dollar surge", "dollar crash", "rupee fall", "rupee crash", "rupee depreciation",
    "gold surge", "gold crash", "commodity shock",
    "yield spike", "yield surge", "bond sell-off", "bond selloff",
    "flash crash", "circuit breaker", "trading halt",
    "market crash", "market correction",
]

# ── MEDIUM signal keywords ────────────────────────────────────────────────────
WATCHLIST_KEYWORDS = [
    # Analyst actions
    "upgrade", "downgrade", "price target", "target price",
    "initiates coverage", "reiterate", "maintains",
    "overweight", "underweight", "outperform", "underperform",
    # Structural themes (monitoring)
    "ai infrastructure", "ai capex", "ai spending", "ai investment",
    "data center", "cloud spending", "cloud capex",
    "defense spending", "defense budget", "defense contract",
    "energy transition", "renewable energy", "ev adoption",
    "semiconductor", "chip manufacturing", "fab capacity",
    # Industry data
    "industry report", "sector report", "market share",
    "market size", "growth forecast", "outlook",
    # Policy development (pre-enactment)
    "proposed tariff", "tariff proposal", "trade talks", "trade negotiation",
    "monetary policy", "fiscal policy", "government spending",
    "regulation proposed", "regulatory framework",
    # Corporate strategy
    "restructuring", "layoffs", "hiring freeze", "cost cutting",
    "merger talks", "acquisition talks", "deal talks",
    "capex", "capital expenditure", "investment plan",
]

# ── NOISE patterns: opinion / speculation / clickbait ─────────────────────────
NOISE_HEADLINE_PATTERNS = [
    # Opinion questions
    r"^(is|are|was|will|can|could|should|does|did|has)\s+.+\?$",
    r"\bshould (you|i|we|investors?) (buy|sell|hold|invest)\b",
    r"\bis\s+\w+\s+(a buy|a sell|overvalued|undervalued|worth)\b",
    r"\bdid\s+\w+\s+make a\s+.*(mistake|error|blunder)\b",
    # Speculation without data
    r"\b(could|might|may)\s+(benefit|gain|lose|surge|crash|soar|plunge)\b",
    r"\b(could|might|may)\s+be\s+(the next|a good|worth|ready)\b",
    r"\bno matter what\b",
    r"\bregardless of\s+(what happens|the outcome)\b",
    # Stock picking / promotion
    r"\b\d+\s+(stock|stocks|share|shares)\s+(to|you should|that could|that will)\b",
    r"\b(best|top|favorite)\s+(stock|stocks|pick|picks)\s+(for|to buy|right now)\b",
    r"\bgot \$[\d,]+\?",
    r"\bif (you|i) had (bought|invested)\b",
    r"\bwould have (made|turned|been worth)\b",
    r"\bone stock\b.*\b(to buy|you need|buffett)\b",
    r"\bwall street is sleeping on\b",
    r"\bbuy it now\b",
    # Vague / recycled
    r"\bhere'?s (why|what|how)\b.*\b(you should|matters|to know)\b",
    r"\beverything you need to know\b",
    r"\bwhat (it|this) means for (you|your|investors)\b",
    # Listicles
    r"\b\d+\s+(things|ways|tips|reasons|secrets|mistakes)\s+(you|to|that|about)\b",
    r"\b\d+\s+big things we'?re watching\b",
    # Personal finance
    r"\b(my|your)\s+(retirement|portfolio|nest egg|savings)\b",
    r"\bpassive income\b",
    r"\bfinancial (adviser|advisor|planner)\b",
    r"\b(social security|medicare)\b",
    r"\bcredit (card|score)\b",
]

# Compiled regex patterns for performance
_NOISE_PATTERNS_COMPILED = [re.compile(p, re.IGNORECASE) for p in NOISE_HEADLINE_PATTERNS]

# ── NOISE keywords: definite noise content ────────────────────────────────────
NOISE_KEYWORDS = [
    # Celebrity / lifestyle
    "celebrity", "wedding", "divorce", "mansion", "luxury home",
    "personal life", "dating", "affair",
    # Entertainment / sports
    "movie", "film", "music", "concert", "cricket", "ipl",
    "football", "tennis", "boxing", "wrestling",
    # Clickbait
    "horoscope", "astrology", "zodiac", "lottery",
    "recipe", "home remedy", "beauty tip", "health tip",
    "weather forecast",
    # Low-value chatter
    "motley fool", "one stock to buy", "millionaire maker",
    "get rich", "passive income from",
    "meme stock", "wallstreetbets", "reddit",
    # Filler
    "coffee export", "tea export", "spice export",
    "real estate tip", "home loan tip",
    "fraud arrest", "scam bust", "ponzi",
    "bank holiday",
]

# ── PIB India noise: generic govt announcements with no market impact ─────────
PIB_NOISE_PATTERNS = [
    r"\b(awards?|honour|honor|felicitat|inaugurates?|celebrates?|commemorat)\b",
    r"\b(visit|tour|addresses?|delivers?\s+keynote|speech|greets?)\b",
    r"\bnominations?\s+for\s+(national|awards?)\b",
    r"\b(yoga|cultural|festival|art|heritage|museum)\b",
    r"\b(76 stations|academic schedule|offline mode|railway station)\b",
    r"\b(signed a memorandum|mou signed|mou with)\b",
    r"\b(skill development|training programme|workshop)\b",
]
_PIB_NOISE_COMPILED = [re.compile(p, re.IGNORECASE) for p in PIB_NOISE_PATTERNS]

# ── High-importance tickers (tier boost) ──────────────────────────────────────
TIER1_TICKERS = {
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA",
    "TSM", "AVGO", "AMD", "INTC", "MU", "NFLX", "ORCL", "CRM",
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN",
    "BHARTIARTL", "ITC", "HINDUNILVR", "KOTAKBANK", "LT", "WIPRO",
    "HCLTECH", "BAJFINANCE", "MARUTI", "TATAMOTORS", "TATASTEEL",
    "ADANIENT", "ADANIPORTS", "JSWSTEEL", "COALINDIA",
}


def _has_hard_numbers(text: str) -> bool:
    """Check if text contains specific quantitative data (not just mentions of words).

    Institutional requirement: HIGH signals need hard data, not just keywords.
    """
    # Percentage moves
    if re.search(r'\d+(\.\d+)?[\s]*(%|percent|basis point|bps)', text):
        return True
    # Dollar/rupee amounts with magnitude
    if re.search(r'(\$|₹|rs\.?)\s*[\d,.]+\s*(billion|million|crore|lakh|trillion)', text):
        return True
    # Specific numbers in context (e.g., "GDP at 6.1%", "CPI 4.2%")
    if re.search(r'(gdp|cpi|pmi|inflation|unemployment|yield|rate)\s*(at|of|to|rose to|fell to|hit)\s*\d', text):
        return True
    return False


def classify_investment_relevance(
    headline: str,
    summary: str,
    tickers: list[str],
    importance_score: int,
    article_type: str,
) -> dict:
    """Classify a news article's investment signal strength.

    Returns:
        {
            "tier": 1 | 2 | 3,
            "tier_label": "HIGH" | "MEDIUM" | "NOISE",
            "relevance_tags": [...],
            "reason": "brief explanation",
        }
    """
    text = (headline + " " + (summary or "")).lower()
    title_lower = headline.lower()

    # ── Step 0: Instant noise rejection ────────────────────────────────────

    # Noise keyword check
    for noise in NOISE_KEYWORDS:
        if noise in title_lower:
            return {
                "tier": 3,
                "tier_label": "NOISE",
                "relevance_tags": [],
                "reason": f"Noise keyword: '{noise}'",
            }

    # Noise headline pattern check
    for pattern in _NOISE_PATTERNS_COMPILED:
        if pattern.search(title_lower):
            return {
                "tier": 3,
                "tier_label": "NOISE",
                "relevance_tags": [],
                "reason": "Noise pattern match",
            }

    # PIB India generic announcements
    source_hint = ""  # We don't have source here, but PIB articles tend to have specific patterns
    for pattern in _PIB_NOISE_COMPILED:
        if pattern.search(title_lower):
            # Only demote if no financial keywords present
            has_financial = any(kw in text for kw in [
                "crore", "billion", "investment", "budget", "deficit", "gdp",
                "inflation", "rate", "tax", "subsidy", "fdi", "fii",
                "stock", "market", "nifty", "sensex", "rbi", "sebi",
            ])
            if not has_financial:
                return {
                    "tier": 3,
                    "tier_label": "NOISE",
                    "relevance_tags": [],
                    "reason": "Non-market government announcement",
                }

    # ── Step 1: Check HIGH signal filters ─────────────────────────────────
    relevance_tags = []

    # Hard data / earnings
    for kw in HARD_DATA_KEYWORDS:
        if kw in text:
            relevance_tags.append("HARD_DATA")
            break

    # Capital events
    for kw in CAPITAL_EVENT_KEYWORDS:
        if kw in text:
            relevance_tags.append("CAPITAL_EVENT")
            break

    # Regime shifts
    for kw in REGIME_SHIFT_KEYWORDS:
        if kw in text:
            relevance_tags.append("REGIME_SHIFT")
            break

    # Price shocks
    for kw in PRICE_SHOCK_KEYWORDS:
        if kw in text:
            relevance_tags.append("PRICE_SHOCK")
            break

    # ── Step 2: Check MEDIUM signal filters ───────────────────────────────
    has_watchlist = False
    for kw in WATCHLIST_KEYWORDS:
        if kw in text:
            has_watchlist = True
            relevance_tags.append("WATCHLIST")
            break

    # ── Step 3: Tier assignment ───────────────────────────────────────────

    has_tier1_ticker = bool(set(tickers) & TIER1_TICKERS)
    has_numbers = _has_hard_numbers(text)

    # Bottleneck articles: HIGH if confirmed constraint, MEDIUM otherwise
    if article_type == "BOTTLENECK":
        if relevance_tags or has_numbers:
            return {
                "tier": 1,
                "tier_label": "HIGH",
                "relevance_tags": relevance_tags + ["BOTTLENECK"],
                "reason": "Confirmed supply constraint with data",
            }
        return {
            "tier": 2,
            "tier_label": "MEDIUM",
            "relevance_tags": ["BOTTLENECK"],
            "reason": "Supply chain monitoring signal",
        }

    # HIGH: has signal filter match + (hard numbers OR high importance OR major ticker)
    high_signal_tags = [t for t in relevance_tags if t != "WATCHLIST"]
    if high_signal_tags:
        if has_numbers or importance_score >= 4 or has_tier1_ticker or len(high_signal_tags) >= 2:
            return {
                "tier": 1,
                "tier_label": "HIGH",
                "relevance_tags": high_signal_tags,
                "reason": f"Signal: {', '.join(high_signal_tags)}",
            }
        # Has signal keyword but no confirming data = MEDIUM
        return {
            "tier": 2,
            "tier_label": "MEDIUM",
            "relevance_tags": high_signal_tags,
            "reason": f"Signal without confirming data: {', '.join(high_signal_tags)}",
        }

    # MEDIUM: watchlist match, or major ticker with decent importance
    if has_watchlist:
        return {
            "tier": 2,
            "tier_label": "MEDIUM",
            "relevance_tags": ["WATCHLIST"],
            "reason": "Watchlist-level signal",
        }

    if has_tier1_ticker and importance_score >= 3:
        return {
            "tier": 2,
            "tier_label": "MEDIUM",
            "relevance_tags": ["TICKER_RELEVANCE"],
            "reason": "Major ticker news",
        }

    # Geopolitical/Macro article types get MEDIUM minimum
    if article_type in ("GEOPOLITICAL", "MACRO", "TARIFF", "EARNINGS", "RATING_CHANGE"):
        return {
            "tier": 2,
            "tier_label": "MEDIUM",
            "relevance_tags": ["TYPE_RELEVANCE"],
            "reason": f"{article_type} type article",
        }

    # High importance from scoring engine
    if importance_score >= 4:
        return {
            "tier": 2,
            "tier_label": "MEDIUM",
            "relevance_tags": ["HIGH_IMPORTANCE"],
            "reason": "High importance score",
        }

    # Everything else = NOISE
    return {
        "tier": 3,
        "tier_label": "NOISE",
        "relevance_tags": [],
        "reason": "No investment signal detected",
    }
