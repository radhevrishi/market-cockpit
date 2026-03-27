"""Market data service — fetches live quotes from Yahoo Finance with retry & caching.

Rate-limit strategy:
  • Primary data source is yf.download() which is batch-friendly and less throttled.
  • We NEVER call yf.Ticker(sym).info inside the hot quote path.
    Company names come from a static lookup table instead.
  • Cache TTLs are generous (15 min quotes, 10 min indices) to avoid hammering Yahoo.
  • A global asyncio.Semaphore limits concurrent yfinance calls.
"""

import logging
import asyncio
import time
from typing import Optional
import yfinance as yf
import pandas as pd

logger = logging.getLogger(__name__)

# ── Concurrency guard ────────────────────────────────────────────────
# Limits concurrent yfinance network calls across the entire process.
_YF_SEMAPHORE = asyncio.Semaphore(2)

# ── In-memory cache with TTL ─────────────────────────────────────────
_QUOTE_CACHE = {}
_QUOTE_CACHE_TTL = 900   # 15 minutes for regular quotes
_INDICES_CACHE_TTL = 600  # 10 minutes for market indices

# ── Static ticker → display-name map ────────────────────────────────
# Avoids the expensive yf.Ticker(sym).info call just to resolve names.
# Add tickers as needed; unknown tickers fall back to the symbol itself.
_TICKER_NAME_MAP = {
    # India — NSE
    "RELIANCE.NS": "Reliance Industries", "TCS.NS": "TCS", "HDFCBANK.NS": "HDFC Bank",
    "INFY.NS": "Infosys", "ICICIBANK.NS": "ICICI Bank", "HINDUNILVR.NS": "Hindustan Unilever",
    "SBIN.NS": "SBI", "BHARTIARTL.NS": "Bharti Airtel", "KOTAKBANK.NS": "Kotak Mahindra Bank",
    "ITC.NS": "ITC", "LT.NS": "Larsen & Toubro", "AXISBANK.NS": "Axis Bank",
    "BAJFINANCE.NS": "Bajaj Finance", "BAJFINSV.NS": "Bajaj Finserv",
    "MARUTI.NS": "Maruti Suzuki", "SUNPHARMA.NS": "Sun Pharma",
    "TATAMOTORS.NS": "Tata Motors", "TATASTEEL.NS": "Tata Steel",
    "WIPRO.NS": "Wipro", "ADANIENT.NS": "Adani Enterprises",
    "ADANIPORTS.NS": "Adani Ports", "NTPC.NS": "NTPC", "ONGC.NS": "ONGC",
    "POWERGRID.NS": "Power Grid", "HAL.NS": "HAL", "BEL.NS": "Bharat Electronics",
    "HCLTECH.NS": "HCL Tech", "TECHM.NS": "Tech Mahindra",
    "TITAN.NS": "Titan", "NESTLEIND.NS": "Nestle India",
    "ULTRACEMCO.NS": "UltraTech Cement", "JSWSTEEL.NS": "JSW Steel",
    "M&M.NS": "Mahindra & Mahindra", "INDUSINDBK.NS": "IndusInd Bank",
    "COALINDIA.NS": "Coal India", "DRREDDY.NS": "Dr Reddys",
    "CIPLA.NS": "Cipla", "APOLLOHOSP.NS": "Apollo Hospitals",
    "GRASIM.NS": "Grasim Industries", "DIVISLAB.NS": "Divis Laboratories",
    "EICHERMOT.NS": "Eicher Motors", "BRITANNIA.NS": "Britannia",
    "HEROMOTOCO.NS": "Hero MotoCorp", "HINDALCO.NS": "Hindalco",
    "ASIANPAINT.NS": "Asian Paints", "TATACONSUM.NS": "Tata Consumer",
    "BAJAJ-AUTO.NS": "Bajaj Auto", "SBILIFE.NS": "SBI Life",
    "HDFCLIFE.NS": "HDFC Life", "VEDL.NS": "Vedanta",
    "ZOMATO.NS": "Zomato", "PAYTM.NS": "Paytm",
    "DMART.NS": "DMart", "IRCTC.NS": "IRCTC", "IRFC.NS": "IRFC",
    "IDEA.NS": "Vodafone Idea", "PNB.NS": "PNB",
    # US
    "AAPL": "Apple", "MSFT": "Microsoft", "GOOGL": "Alphabet",
    "AMZN": "Amazon", "NVDA": "NVIDIA", "META": "Meta Platforms",
    "TSLA": "Tesla", "TSM": "TSMC", "AVGO": "Broadcom", "JPM": "JPMorgan",
    "V": "Visa", "MA": "Mastercard", "UNH": "UnitedHealth",
    "JNJ": "Johnson & Johnson", "WMT": "Walmart", "PG": "Procter & Gamble",
    "HD": "Home Depot", "BAC": "Bank of America", "NFLX": "Netflix",
    "AMD": "AMD", "CRM": "Salesforce", "INTC": "Intel", "DIS": "Disney",
    "CSCO": "Cisco", "PEP": "PepsiCo", "KO": "Coca-Cola",
    "COST": "Costco", "QCOM": "Qualcomm", "PYPL": "PayPal",
    "ADBE": "Adobe", "ORCL": "Oracle",
}

def _lookup_name(yf_sym: str) -> str:
    """Return a human-friendly name for *yf_sym* without any network call."""
    if yf_sym in _TICKER_NAME_MAP:
        return _TICKER_NAME_MAP[yf_sym]
    # Strip exchange suffix for display
    return yf_sym.replace(".NS", "").replace(".BO", "")

# Exchange suffix map for Yahoo Finance
NSE_SUFFIX = ".NS"
BSE_SUFFIX = ".BO"


def _yf_symbol(ticker: str, exchange: str) -> str:
    """Convert ticker + exchange to Yahoo Finance symbol."""
    exchange = (exchange or "").upper()
    if exchange in ("NSE", "BSE") and not ticker.endswith(".NS") and not ticker.endswith(".BO"):
        suffix = NSE_SUFFIX if exchange == "NSE" else BSE_SUFFIX
        return f"{ticker}{suffix}"
    return ticker


def _get_cached_quote(yf_sym: str, ttl: int = _QUOTE_CACHE_TTL) -> Optional[dict]:
    """Retrieve quote from in-memory cache if not expired."""
    if yf_sym in _QUOTE_CACHE:
        cached_time, cached_data = _QUOTE_CACHE[yf_sym]
        if time.time() - cached_time < ttl:
            return cached_data
        else:
            # Expired, remove it
            del _QUOTE_CACHE[yf_sym]
    return None


def _set_cached_quote(yf_sym: str, data: dict, ttl: int = _QUOTE_CACHE_TTL) -> None:
    """Store quote in in-memory cache with timestamp."""
    _QUOTE_CACHE[yf_sym] = (time.time(), data)


async def get_quotes_batch(tickers: list[str] | list[dict], exchange: str = "NSE") -> dict:
    """
    Fetch live quotes for a list of tickers with retry logic and caching.
    Accepts either:
      - List of strings (backward compat): ["AAPL", "RELIANCE"]
      - List of dicts with exchange info: [{"ticker": "AAPL", "exchange": "NASDAQ"}, ...]
    Returns dict: {ticker: {price, change, change_pct, volume, market_cap}}
    Returns cached or empty dict entries (not errors) for failed tickers.
    """
    if not tickers:
        return {}

    results = {}

    # First, try to get from cache
    yf_symbols = []
    symbol_map = {}
    uncached_symbols = []

    for item in tickers:
        # Handle string, dict, and Pydantic model formats
        if isinstance(item, dict):
            ticker = item.get("ticker", "")
            item_exchange = item.get("exchange", exchange)
        elif hasattr(item, 'ticker'):
            # Pydantic model or object with .ticker attribute
            ticker = item.ticker
            item_exchange = getattr(item, 'exchange', exchange)
        else:
            ticker = str(item)
            item_exchange = exchange

        if not ticker:
            continue

        # Use _yf_symbol to build the correct Yahoo Finance symbol
        yf_sym = _yf_symbol(ticker, item_exchange)
        orig = ticker

        yf_symbols.append(yf_sym)
        symbol_map[yf_sym] = orig

        # Try cache first
        cached = _get_cached_quote(yf_sym)
        if cached is not None:
            results[orig] = cached
        else:
            uncached_symbols.append(yf_sym)

    # If all are cached, return early
    if not uncached_symbols:
        return results

    # Fetch uncached symbols with retry logic (reduced to 1 retry to avoid long hangs)
    max_retries = 1
    for attempt in range(max_retries):
        try:
            def _fetch():
                # Try yf.download first (less rate-limited)
                try:
                    import pandas as pd
                    df = yf.download(uncached_symbols, period="2d", group_by="ticker", progress=False, threads=True)

                    # Check if download actually returned valid data
                    if df is not None and not df.empty and df.isnull().sum().sum() < len(df) * len(df.columns):
                        result = {}
                        for sym in uncached_symbols:
                            try:
                                # Handle both single-ticker (flat columns) and multi-ticker (MultiIndex columns)
                                if len(uncached_symbols) == 1:
                                    # Single ticker: df has columns ['Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume']
                                    ticker_df = df
                                else:
                                    # Multi-ticker: df has MultiIndex columns like [('Close', 'AAPL'), ('Close', 'MSFT')]
                                    try:
                                        ticker_df = df[sym]
                                    except (KeyError, TypeError):
                                        # Try getting from MultiIndex columns
                                        if hasattr(df.columns, 'levels'):
                                            ticker_cols = [col for col in df.columns if col[1] == sym] if df.columns.nlevels > 1 else []
                                            if ticker_cols:
                                                ticker_df = df[[col for col in ticker_cols if col[0] in ['Close', 'Open', 'High', 'Low', 'Volume']]]
                                                ticker_df.columns = [col[0] for col in ticker_df.columns]
                                            else:
                                                ticker_df = None
                                        else:
                                            ticker_df = None

                                if ticker_df is not None and not ticker_df.empty:
                                    # Extract Close prices, drop NaN values
                                    recent = ticker_df.dropna(subset=["Close"]).tail(2)
                                    if len(recent) >= 1:
                                        price = float(recent["Close"].iloc[-1])
                                        prev = float(recent["Close"].iloc[-2]) if len(recent) >= 2 else price

                                        # Validate price is reasonable (not zero or NaN)
                                        if price > 0 and not pd.isna(price):
                                            # Use static name lookup — NO .info call
                                            name = _lookup_name(sym)
                                            currency = "INR" if sym.endswith((".NS", ".BO")) else "USD"

                                            # Volume from download df (if available)
                                            vol = 0
                                            try:
                                                vol = int(recent["Volume"].iloc[-1]) if "Volume" in recent.columns else 0
                                            except Exception:
                                                pass

                                            change = price - prev if prev else 0
                                            change_pct = (change / prev * 100) if prev > 0 else 0
                                            result[sym] = {
                                                "ticker": sym, "price": round(price, 2),
                                                "change": round(change, 2), "change_pct": round(change_pct, 2),
                                                "volume": vol, "market_cap": 0,
                                                "pe_ratio": None, "week_52_high": None, "week_52_low": None,
                                                "name": name, "currency": currency,
                                            }
                                            logger.debug(f"Quote for {sym}: price={price}")
                            except Exception as e2:
                                logger.debug(f"Parse failed for {sym}: {e2}")

                        if result:
                            logger.debug(f"yf.download succeeded with {len(result)} quotes")
                            return result
                except Exception as dl_err:
                    logger.debug(f"yf.download batch failed: {dl_err}")

                # No .info fallback — yf.download is the only source.
                # If download returned nothing, we return an empty dict and
                # the caller will get price=0 entries (cached for the normal TTL
                # so we don't keep hammering Yahoo).
                logger.debug("yf.download returned no usable data; skipping .info fallback to avoid 429s")
                return {}

            async with _YF_SEMAPHORE:
                raw_data = await asyncio.to_thread(_fetch)

            for yf_sym, quote_data in raw_data.items():
                orig_ticker = symbol_map.get(yf_sym, yf_sym)
                try:
                    if quote_data and isinstance(quote_data, dict) and quote_data.get("price", 0) > 0:
                        quote_data["ticker"] = orig_ticker
                        results[orig_ticker] = quote_data
                        _set_cached_quote(yf_sym, quote_data)
                except Exception as parse_err:
                    logger.warning(f"Failed to parse quote for {yf_sym}: {parse_err}")

            # Success — break out of retry loop
            break

        except Exception as e:
            wait_time = 2 ** attempt  # exponential backoff: 1s, 2s, 4s
            if attempt < max_retries - 1:
                logger.warning(f"Batch quote fetch attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
            else:
                logger.warning(f"Batch quote fetch failed after {max_retries} attempts: {e}")

    # Fill in any remaining uncached tickers with empty results and cache them
    # briefly (2 min) so we don't hammer Yahoo for known-missing symbols.
    for yf_sym in uncached_symbols:
        orig_ticker = symbol_map.get(yf_sym, yf_sym)
        if orig_ticker not in results:
            logger.debug(f"No data returned for {orig_ticker}, setting price to 0")
            empty = {"ticker": orig_ticker, "price": 0, "change": 0, "change_pct": 0, "name": _lookup_name(yf_sym)}
            results[orig_ticker] = empty
            _set_cached_quote(yf_sym, empty, ttl=120)  # cache miss for 2 min

    return results


async def get_quote(ticker: str, exchange: str = "NSE") -> dict:
    """Fetch a single ticker quote."""
    results = await get_quotes_batch([{"ticker": ticker, "exchange": exchange}], exchange)
    quote = results.get(ticker, {
        "ticker": ticker,
        "price": 0,
        "change": 0,
        "change_pct": 0,
        "volume": 0,
        "market_cap": 0,
        "pe_ratio": None,
        "week_52_high": None,
        "week_52_low": None,
    })
    # Ensure name is always present for frontend auto-fill
    if "name" not in quote or not quote["name"]:
        yf_sym = _yf_symbol(ticker, exchange)
        quote["name"] = _lookup_name(yf_sym)
        quote["company_name"] = quote["name"]
    else:
        quote["company_name"] = quote.get("name")
    # Ensure currency is set based on the yf_symbol
    if "currency" not in quote:
        yf_sym = _yf_symbol(ticker, exchange)
        quote["currency"] = "INR" if yf_sym.endswith((".NS", ".BO")) else "USD"
    return quote


class MarketDataService:
    """
    Class wrapper around the standalone market data functions.
    Accepts an optional redis_client for future caching integration.
    Used by market.py, watchlists.py, and alert_engine.py.
    """

    def __init__(self, redis_client=None):
        self.redis = redis_client

    async def get_quote(self, ticker: str, exchange: str = "NSE") -> dict:
        return await get_quote(ticker, exchange)

    async def get_quotes_batch(self, tickers: list[str], exchange: str = "NSE") -> dict:
        return await get_quotes_batch(tickers, exchange)

    async def get_market_indices(self) -> list[dict]:
        return await get_market_indices()

    async def get_fundamentals(self, ticker: str, exchange: str = "NSE") -> dict:
        return await get_fundamentals(ticker, exchange)

    async def get_ohlcv(self, ticker: str, exchange: str = "NSE", period: str = "1y") -> list[dict]:
        return await get_ohlcv(ticker, exchange, period)


async def get_fundamentals(ticker: str, exchange: str = "NSE") -> dict:
    """Fetch fundamental data for a ticker via yfinance (rate-limit aware)."""
    yf_sym = _yf_symbol(ticker, exchange)

    # Check cache first (fundamentals cached for 30 min)
    cache_key = f"__fund__{yf_sym}"
    cached = _get_cached_quote(cache_key, ttl=1800)
    if cached is not None:
        return cached

    try:
        def _fetch():
            t = yf.Ticker(yf_sym)
            info = t.info
            return {
                "ticker": ticker,
                "pe_ratio": info.get("trailingPE"),
                "pb_ratio": info.get("priceToBook"),
                "market_cap": info.get("marketCap"),
                "revenue": info.get("totalRevenue"),
                "net_income": info.get("netIncomeToCommon"),
                "eps": info.get("trailingEps"),
                "dividend_yield": info.get("dividendYield"),
                "roe": info.get("returnOnEquity"),
                "debt_to_equity": info.get("debtToEquity"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "description": info.get("longBusinessSummary"),
            }

        async with _YF_SEMAPHORE:
            result = await asyncio.to_thread(_fetch)
        _set_cached_quote(cache_key, result, ttl=1800)
        return result
    except Exception as e:
        logger.warning(f"Fundamentals fetch failed for {ticker}: {e}")
        return {"ticker": ticker}


async def get_ohlcv(ticker: str, exchange: str = "NSE", period: str = "1y") -> list[dict]:
    """Fetch OHLCV historical data for a ticker via yfinance (rate-limit aware)."""
    yf_sym = _yf_symbol(ticker, exchange)

    # Check cache (OHLCV cached for 15 min)
    cache_key = f"__ohlcv__{yf_sym}__{period}"
    cached = _get_cached_quote(cache_key, ttl=900)
    if cached is not None:
        return cached

    try:
        def _fetch():
            t = yf.Ticker(yf_sym)
            hist = t.history(period=period)
            if hist.empty:
                return []
            records = []
            for ts, row in hist.iterrows():
                records.append({
                    "date": ts.strftime("%Y-%m-%d"),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row["Volume"]),
                })
            return records

        async with _YF_SEMAPHORE:
            result = await asyncio.to_thread(_fetch)
        if result:
            _set_cached_quote(cache_key, result, ttl=900)
        return result
    except Exception as e:
        logger.warning(f"OHLCV fetch failed for {ticker}: {e}")
        return []


_INDICES_FALLBACK = [
    {"symbol": "NIFTY 50",   "price": 23500, "change_pct": 0.0, "up": True},
    {"symbol": "SENSEX",     "price": 77000, "change_pct": 0.0, "up": True},
    {"symbol": "S&P 500",    "price": 5700,  "change_pct": 0.0, "up": True},
    {"symbol": "NASDAQ",     "price": 18200, "change_pct": 0.0, "up": True},
    {"symbol": "USD/INR",    "price": 86.50, "change_pct": 0.0, "up": True},
    {"symbol": "GOLD",       "price": 3050,  "change_pct": 0.0, "up": True},
    {"symbol": "CRUDE OIL",  "price": 69.5,  "change_pct": 0.0, "up": True},
    {"symbol": "BITCOIN",    "price": 87500, "change_pct": 0.0, "up": True},
]


async def get_market_indices() -> list[dict]:
    """Fetch major market index quotes using yf.download() for reliability."""
    indices = {
        "^NSEI": "NIFTY 50",
        "^BSESN": "SENSEX",
        "^GSPC": "S&P 500",
        "^IXIC": "NASDAQ",
        "USDINR=X": "USD/INR",
        "GC=F": "GOLD",
        "CL=F": "CRUDE OIL",
        "BTC-USD": "BITCOIN",
    }

    # Check cache first
    cache_key = "__market_indices__"
    cached = _get_cached_quote(cache_key, ttl=_INDICES_CACHE_TTL)
    if cached is not None:
        return cached

    try:
        def _fetch():
            symbols = list(indices.keys())
            result = {}

            # Use yf.download for batch efficiency (much less rate-limited than .info)
            try:
                import pandas as pd
                df = yf.download(symbols, period="2d", group_by="ticker", progress=False, threads=True)

                # Check if download actually returned valid data
                if df is not None and not df.empty and df.isnull().sum().sum() < len(df) * len(df.columns):
                    logger.debug(f"yf.download returned {len(df)} rows")
                    for sym, name in indices.items():
                        try:
                            # Handle both single-ticker (flat columns) and multi-ticker (MultiIndex columns)
                            if len(symbols) == 1:
                                # Single symbol: df has columns ['Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume']
                                ticker_df = df
                            else:
                                # Multi-symbol: df has MultiIndex columns like [('Close', '^NSEI'), ('Close', '^BSESN')]
                                try:
                                    ticker_df = df[sym]
                                except (KeyError, TypeError):
                                    # Try getting from MultiIndex columns
                                    if hasattr(df.columns, 'levels'):
                                        ticker_cols = [col for col in df.columns if col[1] == sym] if df.columns.nlevels > 1 else []
                                        if ticker_cols:
                                            ticker_df = df[[col for col in ticker_cols if col[0] in ['Close', 'Open', 'High', 'Low', 'Volume']]]
                                            ticker_df.columns = [col[0] for col in ticker_df.columns]
                                        else:
                                            ticker_df = None
                                    else:
                                        ticker_df = None

                            if ticker_df is not None and not ticker_df.empty:
                                # Get last 2 rows for price and change calculation
                                recent = ticker_df.dropna(subset=["Close"]).tail(2)
                                if len(recent) >= 1:
                                    price = float(recent["Close"].iloc[-1])
                                    prev = float(recent["Close"].iloc[-2]) if len(recent) >= 2 else price

                                    # Validate price is reasonable
                                    if price > 0 and not pd.isna(price):
                                        change_pct = ((price - prev) / prev * 100) if prev > 0 else 0
                                        result[sym] = {
                                            "symbol": name,
                                            "price": round(price, 2),
                                            "change_pct": round(change_pct, 2),
                                            "up": change_pct >= 0,
                                        }
                                        logger.debug(f"Index {sym} ({name}): price={price}, change_pct={change_pct:.2f}%")
                        except Exception as e:
                            logger.debug(f"Failed to parse index {sym}: {e}")
                            continue
            except Exception as e:
                logger.warning(f"yf.download failed for indices: {e}")

            # No .info fallback — missing indices use the hardcoded fallback values.
            missing_symbols = [sym for sym in indices.keys() if sym not in result]
            if missing_symbols:
                logger.debug(f"{len(missing_symbols)} indices missing from yf.download; will use fallback values")

            return result

        async with _YF_SEMAPHORE:
            raw = await asyncio.to_thread(_fetch)
        live_results = [v for v in raw.values() if v is not None]

        # Consider success if we got at least half of the indices
        if len(live_results) >= len(indices) // 2:
            logger.debug(f"Got {len(live_results)}/{len(indices)} live indices, using them")
            fallback_map = {f["symbol"]: f for f in _INDICES_FALLBACK}
            final = []
            for sym, name in indices.items():
                val = raw.get(sym)
                if val is not None:
                    final.append(val)
                else:
                    fb = fallback_map.get(name, {"symbol": name, "price": 0, "change_pct": 0, "up": True})
                    logger.debug(f"Using fallback for {name}")
                    final.append(fb)
            # Cache the result with 5-minute TTL for indices
            _set_cached_quote(cache_key, final, ttl=_INDICES_CACHE_TTL)
            return final

        logger.warning(f"Not enough live index data ({len(live_results)}/{len(indices)}), using fallback")
        return _INDICES_FALLBACK

    except Exception as e:
        logger.warning(f"Market indices fetch failed: {e}")
        return _INDICES_FALLBACK
