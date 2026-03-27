"""
Investment-Grade News Relevance Filter
───────────────────────────────────────
Classifies every news article into investment tiers:

  TIER 1 (Track Daily):   Moves earnings, multiples, or structural positioning
  TIER 2 (Weekly Digest): Incremental / confirmatory, not thesis-changing
  TIER 3 (Discard):       Noise — no earnings, structural, or capital impact

Four core filters (article must pass at least ONE to be Tier 1):
  1. Earnings trajectory      — forward revisions, guidance, results
  2. Capital allocation        — capex cycle, M&A, buybacks, dividends
  3. Structural industry shift — supply chain, regulation, market structure
  4. Liquidity / macro flows   — rates, FX, oil, FII/DII, central bank

Everything else is noise unless it involves a high-importance ticker.
"""

import re
import logging

logger = logging.getLogger(__name__)

# ── Tier 1 keywords: earnings trajectory ───────────────────────────────────────
EARNINGS_KEYWORDS = [
    # Forward revisions
    "earnings revision", "earnings estimate", "earnings forecast", "earnings outlook",
    "revenue guidance", "revenue forecast", "profit warning", "profit forecast",
    "guidance raised", "guidance lowered", "guidance cut", "guidance above",
    "guidance below", "forward guidance", "beat estimate", "miss estimate",
    "above consensus", "below consensus", "upward revision", "downward revision",
    # Actual results
    "quarterly result", "quarterly earnings", "q1 result", "q2 result", "q3 result", "q4 result",
    "annual result", "profit growth", "revenue growth", "margin expansion", "margin compression",
    "eps beat", "eps miss", "revenue beat", "revenue miss",
    # Analyst revisions
    "price target raised", "price target cut", "upgrade", "downgrade",
    "overweight", "underweight", "outperform", "underperform",
]

# ── Tier 1 keywords: capital allocation / capex ────────────────────────────────
CAPEX_KEYWORDS = [
    # Capital spending
    "capex", "capital expenditure", "capital spending", "spending plan",
    "investment plan", "billion investment", "billion expansion",
    "factory build", "fab expansion", "plant expansion",
    "data center investment", "data center expansion", "data center build",
    "ai infrastructure spend", "ai capex",
    # M&A
    "acquisition", "merger", "takeover", "buyout", "acquires", "acquire",
    "merger talks", "merger deal",
    # Shareholder returns
    "buyback", "share repurchase", "dividend hike", "dividend increase",
    "special dividend", "stock split",
]

# ── Tier 1 keywords: structural industry shift ────────────────────────────────
STRUCTURAL_KEYWORDS = [
    # Regulatory / policy
    "antitrust", "regulation", "regulatory", "ban", "sanction", "tariff",
    "export control", "chip ban", "chip curb", "trade restriction",
    "court ruling", "lawsuit", "legal ruling", "patent",
    # Market structure
    "market share shift", "disrupt", "disruption", "paradigm",
    "breakthrough", "new technology", "supply chain shift",
    "monopoly", "oligopoly", "market dominance",
    # Sector rotation
    "sector rotation", "structural shift", "secular trend",
    "ai monetization", "cloud monetization",
]

# ── Tier 1 keywords: macro / liquidity flows ──────────────────────────────────
MACRO_KEYWORDS = [
    # Central banks
    "rate cut", "rate hike", "rate decision", "rate hold",
    "fed", "fomc", "rbi", "ecb", "boj",
    "monetary policy", "quantitative easing", "quantitative tightening",
    # Macro data
    "gdp", "inflation", "cpi", "ppi", "pce", "jobs report", "unemployment",
    "pmi", "consumer confidence", "retail sales",
    # Flows
    "fii outflow", "fii inflow", "fii selling", "fii buying",
    "dii buying", "dii selling", "fund flow", "capital flow",
    "foreign investment", "institutional flow",
    # Commodity / FX
    "oil price", "crude oil", "brent", "wti", "oil shock", "oil surge",
    "dollar strength", "dollar weakness", "rupee", "yen",
    "gold price", "commodity shock", "supply disruption",
    # Geopolitical with market impact
    "war impact", "sanctions impact", "trade war", "geopolitical risk",
    "windfall tax", "fiscal deficit", "government spending",
]

# ── Tier 3 keywords: definite noise ───────────────────────────────────────────
NOISE_KEYWORDS = [
    # Personal / celebrity
    "celebrity", "wedding", "divorce", "mansion", "luxury home",
    "personal life", "dating", "affair",
    # Entertainment / sports
    "movie", "film", "music", "concert", "cricket", "ipl",
    "football", "tennis", "boxing", "wrestling",
    # Clickbait / filler
    "horoscope", "astrology", "zodiac", "lottery",
    "recipe", "home remedy", "beauty tip", "health tip",
    "weather forecast",
    # Low-value market chatter
    "could set you up for life", "if i had", "should you buy",
    "motley fool", "one stock to buy", "millionaire maker",
    "get rich", "passive income from",
    # Meme / sentiment noise
    "tunnel", "sentiment poll", "twitter poll", "reddit",
    "meme stock", "wallstreetbets",
    # One-off / non-market
    "coffee export", "tea export", "spice export",
    "real estate tip", "home loan tip",
    "fraud arrest", "scam bust", "ponzi",
]

# ── High-importance tickers (always Tier 1 or 2) ──────────────────────────────
TIER1_TICKERS = {
    # US mega-caps
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA",
    "TSM", "AVGO", "AMD", "INTC", "MU", "NFLX", "ORCL", "CRM",
    # India large-caps
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN",
    "BHARTIARTL", "ITC", "HINDUNILVR", "KOTAKBANK", "LT", "WIPRO",
    "HCLTECH", "BAJFINANCE", "MARUTI", "TATAMOTORS", "TATASTEEL",
    "ADANIENT", "ADANIPORTS", "JSWSTEEL", "COALINDIA",
}


def classify_investment_relevance(
    headline: str,
    summary: str,
    tickers: list[str],
    importance_score: int,
    article_type: str,
) -> dict:
    """Classify a news article's investment relevance.

    Returns:
        {
            "tier": 1 | 2 | 3,
            "tier_label": "TRACK_DAILY" | "WEEKLY_DIGEST" | "NOISE",
            "relevance_tags": ["EARNINGS", "CAPEX", ...],
            "reason": "brief explanation",
        }
    """
    text = (headline + " " + (summary or "")).lower()
    title_lower = headline.lower()

    # ── Step 0: Instant noise rejection ────────────────────────────────────
    for noise in NOISE_KEYWORDS:
        if noise in title_lower:
            return {
                "tier": 3,
                "tier_label": "NOISE",
                "relevance_tags": [],
                "reason": f"Matched noise filter: '{noise}'",
            }

    # ── Step 1: Check all four Tier 1 filters ─────────────────────────────
    relevance_tags = []

    # Earnings trajectory
    for kw in EARNINGS_KEYWORDS:
        if kw in text:
            relevance_tags.append("EARNINGS")
            break

    # Capital allocation / capex
    for kw in CAPEX_KEYWORDS:
        if kw in text:
            relevance_tags.append("CAPEX")
            break

    # Structural shift
    for kw in STRUCTURAL_KEYWORDS:
        if kw in text:
            relevance_tags.append("STRUCTURAL")
            break

    # Macro / liquidity
    for kw in MACRO_KEYWORDS:
        if kw in text:
            relevance_tags.append("MACRO")
            break

    # ── Step 2: Tier assignment ────────────────────────────────────────────

    has_tier1_ticker = bool(set(tickers) & TIER1_TICKERS)

    # Bottleneck articles are always at least Tier 2
    if article_type == "BOTTLENECK":
        if relevance_tags:
            return {
                "tier": 1,
                "tier_label": "TRACK_DAILY",
                "relevance_tags": relevance_tags + ["BOTTLENECK"],
                "reason": "Bottleneck + investment filter match",
            }
        return {
            "tier": 2,
            "tier_label": "WEEKLY_DIGEST",
            "relevance_tags": ["BOTTLENECK"],
            "reason": "Bottleneck signal (structural monitoring)",
        }

    # Tier 1: passes at least one investment filter
    if relevance_tags:
        # Multiple filters or high-importance ticker = definitely Tier 1
        if len(relevance_tags) >= 2 or has_tier1_ticker or importance_score >= 4:
            return {
                "tier": 1,
                "tier_label": "TRACK_DAILY",
                "relevance_tags": relevance_tags,
                "reason": f"Investment filter: {', '.join(relevance_tags)}",
            }
        # Single filter match with low importance = Tier 2
        return {
            "tier": 2,
            "tier_label": "WEEKLY_DIGEST",
            "relevance_tags": relevance_tags,
            "reason": f"Incremental: {', '.join(relevance_tags)}",
        }

    # No filter match but involves a Tier 1 ticker = Tier 2
    if has_tier1_ticker and importance_score >= 3:
        return {
            "tier": 2,
            "tier_label": "WEEKLY_DIGEST",
            "relevance_tags": ["TICKER_RELEVANCE"],
            "reason": "Major ticker news (no specific investment signal)",
        }

    # High importance from the scoring engine = at least Tier 2
    if importance_score >= 4:
        return {
            "tier": 2,
            "tier_label": "WEEKLY_DIGEST",
            "relevance_tags": ["HIGH_IMPORTANCE"],
            "reason": "High importance score but no specific investment signal",
        }

    # Everything else = noise
    return {
        "tier": 3,
        "tier_label": "NOISE",
        "relevance_tags": [],
        "reason": "No investment relevance detected",
    }
