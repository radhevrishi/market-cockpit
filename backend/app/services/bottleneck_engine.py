"""
Bottleneck Intelligence Engine
─────────────────────────────
Transforms raw bottleneck-tagged articles into a structured dashboard of
clustered, hierarchized, deduplicated signals.

Pipeline:
  1. Fetch all BOTTLENECK articles from last 90 days
  2. Cluster articles into SIGNAL GROUPS (same event = one signal)
  3. Merge related categories (e.g. Power + Data Center → "AI Infrastructure")
  4. Score each signal by severity / actionability
  5. Return a ranked list of bottleneck signals with evidence articles
"""

import logging
import re
from datetime import datetime, timedelta
from collections import defaultdict

logger = logging.getLogger(__name__)

# ── Category hierarchy ─────────────────────────────────────────────────────────
# Raw theme tags → merged "macro buckets" with severity weights.
# Higher weight = more structurally important bottleneck.

MACRO_BUCKETS = {
    "AI_INFRASTRUCTURE": {
        "label": "AI Infrastructure (Power + Data Centers)",
        "themes": ["POWER_GRID", "DATA_CENTER_CAPACITY", "DATA_CENTER_COOLING"],
        "base_severity": 5,   # Structural — direct limiter of AI scaling
        "description": "Power grid constraints and data center capacity directly limit AI compute expansion",
    },
    "MEMORY_SUPPLY": {
        "label": "HBM / Memory Supply",
        "themes": ["HBM_MEMORY"],
        "base_severity": 4,   # Active constraint with evolving dynamics
        "description": "High-bandwidth memory supply-demand imbalance affecting AI chip production",
    },
    "CHIP_PACKAGING": {
        "label": "Advanced Chip Packaging",
        "themes": ["COWOS_PACKAGING"],
        "base_severity": 4,
        "description": "CoWoS and advanced packaging capacity constraining chip output",
    },
    "GPU_COMPUTE": {
        "label": "GPU / AI Chip Access",
        "themes": ["GPU_SHORTAGE"],
        "base_severity": 3,   # Easing but still relevant
        "description": "GPU allocation and AI chip supply constraints",
    },
    "SUPPLY_CHAIN_RISK": {
        "label": "Supply Chain & Materials",
        "themes": ["RARE_EARTH", "SUPPLY_CHAIN", "PHOTONICS"],
        "base_severity": 2,   # Monitoring — tail risk
        "description": "Critical materials, supply chain disruptions, and optical component constraints",
    },
    "SEMICONDUCTOR_OPS": {
        "label": "Semiconductor Operations",
        "themes": ["WATER_SCARCITY_FABS", "SEMICONDUCTOR_LABOR"],
        "base_severity": 2,
        "description": "Fab water supply, workforce, and operational constraints",
    },
    "INDIA_INFRA": {
        "label": "India Infrastructure",
        "themes": [
            "INDIA_SEMICONDUCTOR_FAB", "INDIA_POWER_GRID", "INDIA_PORT_LOGISTICS",
            "INDIA_TELECOM_FIBER", "INDIA_UPI_PAYMENTS", "INDIA_EV_CHARGING",
            "INDIA_DATA_CENTER", "INDIA_WATER_INFRA", "INDIA_HOUSING_INFRA",
        ],
        "base_severity": 3,
        "description": "India-specific infrastructure bottlenecks across sectors",
    },
}

# Reverse mapping: theme → macro bucket
_THEME_TO_BUCKET: dict[str, str] = {}
for bucket_id, info in MACRO_BUCKETS.items():
    for theme in info["themes"]:
        _THEME_TO_BUCKET[theme] = bucket_id

# Severity labels
SEVERITY_LABELS = {
    5: {"label": "CRITICAL", "color": "#EF4444", "icon": "🔴"},
    4: {"label": "HIGH", "color": "#F59E0B", "icon": "🟠"},
    3: {"label": "MODERATE", "color": "#3B82F6", "icon": "🔵"},
    2: {"label": "MONITORING", "color": "#6B7280", "icon": "🟡"},
    1: {"label": "LOW", "color": "#9CA3AF", "icon": "⚪"},
}


# ── Signal clustering ──────────────────────────────────────────────────────────

def _normalize_for_cluster(headline: str) -> set[str]:
    """Extract meaningful words for clustering comparison."""
    text = re.sub(r'[^a-z0-9\s]', '', headline.lower())
    stop = {
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to',
        'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'and',
        'but', 'or', 'not', 'its', 'it', 'this', 'that', 'have', 'has',
        'had', 'will', 'would', 'could', 'should', 'may', 'can', 'do',
        'does', 'did', 'just', 'also', 'very', 'more', 'most', 'than',
        'about', 'up', 'out', 'new', 'says', 'said', 'after', 'before',
        'stock', 'stocks', 'shares',
    }
    return {w for w in text.split() if w and len(w) > 2 and w not in stop}


def _articles_same_event(a: dict, b: dict) -> bool:
    """Check if two articles cover the same underlying event/signal.

    Uses a combination of:
    1. Headline word overlap (Jaccard >= 0.35)
    2. Shared tickers or company names
    3. Same macro bucket
    """
    w1 = _normalize_for_cluster(a["headline"])
    w2 = _normalize_for_cluster(b["headline"])
    if not w1 or not w2:
        return False

    jaccard = len(w1 & w2) / len(w1 | w2)

    # Same macro bucket gives a boost — related topics cluster more easily
    bucket_a = a.get("_bucket")
    bucket_b = b.get("_bucket")
    same_bucket = bucket_a and bucket_b and bucket_a == bucket_b

    # Shared tickers boost (company overlap)
    tickers_a = set(a.get("ticker_symbols", []))
    tickers_b = set(b.get("ticker_symbols", []))
    shared_tickers = bool(tickers_a & tickers_b) if tickers_a and tickers_b else False

    # Exact same event: high headline overlap
    if jaccard >= 0.40:
        return True

    # Same topic + shared companies: moderate overlap is enough
    if same_bucket and shared_tickers and jaccard >= 0.20:
        return True

    # Same bucket with decent overlap
    if same_bucket and jaccard >= 0.30:
        return True

    return False


def _compute_signal_severity(bucket_id: str, articles: list[dict]) -> int:
    """Compute dynamic severity for a signal based on bucket + evidence strength.

    Factors:
    - Base severity from the bucket category
    - Number of distinct sources covering it (more sources = more important)
    - Recency (articles in last 24h boost severity)
    - Importance scores of underlying articles
    """
    base = MACRO_BUCKETS[bucket_id]["base_severity"]

    # Source diversity: multiple sources covering same bottleneck = stronger signal
    sources = {a["source_name"] for a in articles}
    source_bonus = min(len(sources) - 1, 2) * 0.3  # +0.3 per extra source, max +0.6

    # Recency: articles in last 24h
    now = datetime.utcnow()
    recent_count = sum(
        1 for a in articles
        if (now - a["published_at"]).total_seconds() < 86400
    )
    recency_bonus = 0.5 if recent_count >= 2 else (0.2 if recent_count >= 1 else 0)

    # Article quality: average importance
    avg_importance = sum(a["importance_score"] for a in articles) / len(articles)
    quality_bonus = 0.3 if avg_importance >= 4 else 0

    raw_score = base + source_bonus + recency_bonus + quality_bonus
    return max(1, min(5, round(raw_score)))


def _extract_key_tickers(articles: list[dict]) -> list[str]:
    """Extract the most mentioned tickers across clustered articles."""
    ticker_counts: dict[str, int] = defaultdict(int)
    for a in articles:
        for t in a.get("ticker_symbols", []):
            ticker_counts[t] += 1
    # Sort by count descending, return top 5
    return [t for t, _ in sorted(ticker_counts.items(), key=lambda x: -x[1])][:5]


# ── Main engine ────────────────────────────────────────────────────────────────

def build_bottleneck_dashboard(articles: list[dict]) -> list[dict]:
    """Transform raw bottleneck articles into a clustered, hierarchized dashboard.

    Input: list of article dicts with keys:
        id, headline, summary, source_name, published_at, importance_score,
        themes, tickers/ticker_symbols, source_url, sentiment

    Output: list of signal dicts, sorted by severity descending:
        {
            "bucket_id": "AI_INFRASTRUCTURE",
            "label": "AI Infrastructure (Power + Data Centers)",
            "description": "...",
            "severity": 5,
            "severity_label": "CRITICAL",
            "severity_color": "#EF4444",
            "severity_icon": "🔴",
            "signal_count": 2,        # distinct event clusters
            "article_count": 5,       # total evidence articles
            "key_tickers": ["META", "MSFT"],
            "signals": [
                {
                    "headline": "Entergy–Meta power expansion...",
                    "evidence_count": 3,
                    "sources": ["Yahoo Finance US", "CNBC"],
                    "latest_at": "2026-03-27T14:26:13",
                    "tickers": ["META"],
                    "articles": [...]   # individual articles
                },
                ...
            ]
        }
    """
    if not articles:
        return []

    # Step 1: Assign each article to a macro bucket
    for art in articles:
        themes = art.get("themes", [])
        if isinstance(themes, str):
            try:
                import json
                themes = json.loads(themes)
            except Exception:
                themes = []
        bucket = None
        for theme in themes:
            if theme in _THEME_TO_BUCKET:
                bucket = _THEME_TO_BUCKET[theme]
                break
        art["_bucket"] = bucket

    # Step 2: Group articles by macro bucket
    bucket_articles: dict[str, list[dict]] = defaultdict(list)
    for art in articles:
        bucket = art.get("_bucket")
        if bucket:
            bucket_articles[bucket].append(art)

    # Step 3: Within each bucket, cluster articles into distinct signals
    dashboard: list[dict] = []

    for bucket_id, arts in bucket_articles.items():
        if bucket_id not in MACRO_BUCKETS:
            continue

        bucket_info = MACRO_BUCKETS[bucket_id]

        # Cluster articles into signals (same event = one signal)
        signals: list[list[dict]] = []
        assigned = set()

        # Sort by importance descending so best article leads each cluster
        sorted_arts = sorted(arts, key=lambda a: (-a["importance_score"], a["headline"]))

        for i, art_a in enumerate(sorted_arts):
            if id(art_a) in assigned:
                continue
            cluster = [art_a]
            assigned.add(id(art_a))

            for j in range(i + 1, len(sorted_arts)):
                art_b = sorted_arts[j]
                if id(art_b) in assigned:
                    continue
                # Check if art_b clusters with any article already in this cluster
                if any(_articles_same_event(art_b, c) for c in cluster):
                    cluster.append(art_b)
                    assigned.add(id(art_b))

            signals.append(cluster)

        # Step 4: Build signal objects
        signal_objects = []
        for cluster in signals:
            lead = cluster[0]  # highest importance article
            sources = list({a["source_name"] for a in cluster})
            tickers = _extract_key_tickers(cluster)
            latest = max(a["published_at"] for a in cluster)

            signal_objects.append({
                "headline": lead["headline"],
                "summary": lead.get("summary", ""),
                "evidence_count": len(cluster),
                "sources": sources,
                "latest_at": latest.isoformat() if isinstance(latest, datetime) else str(latest),
                "tickers": tickers,
                "articles": [
                    {
                        "id": str(a.get("id", "")),
                        "headline": a["headline"],
                        "source_name": a["source_name"],
                        "source_url": a.get("source_url", a.get("url", "")),
                        "published_at": a["published_at"].isoformat() if isinstance(a["published_at"], datetime) else str(a["published_at"]),
                        "importance_score": a["importance_score"],
                        "sentiment": a.get("sentiment", "NEUTRAL"),
                    }
                    for a in sorted(cluster, key=lambda x: x.get("importance_score", 0), reverse=True)
                ],
            })

        # Step 5: Compute dynamic severity
        severity = _compute_signal_severity(bucket_id, arts)
        sev_info = SEVERITY_LABELS.get(severity, SEVERITY_LABELS[1])

        dashboard.append({
            "bucket_id": bucket_id,
            "label": bucket_info["label"],
            "description": bucket_info["description"],
            "severity": severity,
            "severity_label": sev_info["label"],
            "severity_color": sev_info["color"],
            "severity_icon": sev_info["icon"],
            "signal_count": len(signal_objects),
            "article_count": len(arts),
            "key_tickers": _extract_key_tickers(arts),
            "signals": sorted(signal_objects, key=lambda s: s["latest_at"], reverse=True),
        })

    # Sort dashboard by severity descending, then by article count
    dashboard.sort(key=lambda d: (-d["severity"], -d["article_count"]))

    return dashboard
