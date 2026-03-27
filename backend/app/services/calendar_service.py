"""
Calendar service for earnings, economic indicators, ratings changes, and dividends.
"""

import logging
from datetime import datetime, timedelta, date
import yfinance as yf
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select, and_

from app.models.event import CalendarEvent

logger = logging.getLogger(__name__)


def next_business_day(dt: datetime) -> datetime:
    """Adjust date to next business day if it falls on weekend."""
    weekday = dt.weekday()  # 0=Monday, 6=Sunday
    if weekday == 5:  # Saturday
        return dt + timedelta(days=2)
    elif weekday == 6:  # Sunday
        return dt + timedelta(days=1)
    return dt

# ── India company universe ────────────────────────────────────────────────────
INDIA_COMPANIES = [
    {"ticker": "RELIANCE.NS", "display": "RELIANCE", "exchange": "NSE", "name": "Reliance Industries", "quarter": "Q4", "sector": "Energy"},
    {"ticker": "TCS.NS",      "display": "TCS",      "exchange": "NSE", "name": "Tata Consultancy Services", "quarter": "Q1", "sector": "IT"},
    {"ticker": "INFY.NS",     "display": "INFY",     "exchange": "NSE", "name": "Infosys", "quarter": "Q2", "sector": "IT"},
    {"ticker": "HDFCBANK.NS", "display": "HDFCBANK", "exchange": "NSE", "name": "HDFC Bank", "quarter": "Q1", "sector": "Banking"},
    {"ticker": "ICICIBANK.NS","display": "ICICIBANK","exchange": "NSE", "name": "ICICI Bank", "quarter": "Q3", "sector": "Banking"},
    {"ticker": "WIPRO.NS",    "display": "WIPRO",    "exchange": "NSE", "name": "Wipro", "quarter": "Q2", "sector": "IT"},
    {"ticker": "BAJFINANCE.NS","display": "BAJFINANCE","exchange": "NSE","name": "Bajaj Finance", "quarter": "Q1","sector": "NBFC"},
    {"ticker": "TATAMOTORS.NS","display": "TATAMOTORS","exchange": "NSE","name": "Tata Motors", "quarter": "Q4","sector": "Auto"},
    {"ticker": "SUNPHARMA.NS","display": "SUNPHARMA","exchange": "NSE","name": "Sun Pharma", "quarter": "Q3","sector": "Pharma"},
    {"ticker": "ADANIENT.NS", "display": "ADANIENT", "exchange": "NSE", "name": "Adani Enterprises", "quarter": "Q4","sector": "Infra"},
]

# ── US company universe ───────────────────────────────────────────────────────
US_COMPANIES = [
    {"ticker": "AAPL",      "display": "AAPL",      "exchange": "NASDAQ", "name": "Apple",              "quarter": "Q1", "days_offset": 12},
    {"ticker": "MSFT",      "display": "MSFT",      "exchange": "NASDAQ", "name": "Microsoft",          "quarter": "Q3", "days_offset": 18},
    {"ticker": "NVDA",      "display": "NVDA",      "exchange": "NASDAQ", "name": "NVIDIA",             "quarter": "Q4", "days_offset": 5},
    {"ticker": "GOOGL",     "display": "GOOGL",     "exchange": "NASDAQ", "name": "Alphabet",           "quarter": "Q4", "days_offset": 8},
    {"ticker": "AMZN",      "display": "AMZN",      "exchange": "NASDAQ", "name": "Amazon",             "quarter": "Q4", "days_offset": 11},
    {"ticker": "META",      "display": "META",      "exchange": "NASDAQ", "name": "Meta Platforms",     "quarter": "Q4", "days_offset": 14},
    {"ticker": "TSLA",      "display": "TSLA",      "exchange": "NASDAQ", "name": "Tesla",              "quarter": "Q4", "days_offset": 6},
    {"ticker": "JPM",       "display": "JPM",       "exchange": "NYSE",   "name": "JPMorgan Chase",     "quarter": "Q4", "days_offset": 3},
    {"ticker": "BAC",       "display": "BAC",       "exchange": "NYSE",   "name": "Bank of America",    "quarter": "Q4", "days_offset": 4},
    {"ticker": "JNJ",       "display": "JNJ",       "exchange": "NYSE",   "name": "Johnson & Johnson",  "quarter": "Q4", "days_offset": 21},
    {"ticker": "PG",        "display": "PG",        "exchange": "NYSE",   "name": "Procter & Gamble",   "quarter": "Q2", "days_offset": 15},
    {"ticker": "XOM",       "display": "XOM",       "exchange": "NYSE",   "name": "ExxonMobil",         "quarter": "Q4", "days_offset": 9},
    {"ticker": "CVX",       "display": "CVX",       "exchange": "NYSE",   "name": "Chevron",            "quarter": "Q4", "days_offset": 10},
    {"ticker": "MCD",       "display": "MCD",       "exchange": "NYSE",   "name": "McDonald's",         "quarter": "Q4", "days_offset": 19},
    {"ticker": "KO",        "display": "KO",        "exchange": "NYSE",   "name": "Coca-Cola",          "quarter": "Q4", "days_offset": 16},
    {"ticker": "ORCL",      "display": "ORCL",      "exchange": "NYSE",   "name": "Oracle",             "quarter": "Q3", "days_offset": 13},
    {"ticker": "AMD",       "display": "AMD",       "exchange": "NASDAQ", "name": "AMD",                "quarter": "Q4", "days_offset": 7},
    {"ticker": "INTC",      "display": "INTC",      "exchange": "NASDAQ", "name": "Intel",              "quarter": "Q4", "days_offset": 20},
    {"ticker": "NFLX",      "display": "NFLX",      "exchange": "NASDAQ", "name": "Netflix",            "quarter": "Q4", "days_offset": 17},
    {"ticker": "DIS",       "display": "DIS",       "exchange": "NYSE",   "name": "Disney",             "quarter": "Q1", "days_offset": 22},
]

# ── Broker ratings data (representative — refreshed periodically) ─────────────
RATINGS_DATA = [
    {"ticker": "NVDA",     "exchange": "NASDAQ", "company": "NVIDIA",         "analyst": "Goldman Sachs",  "prev": "Buy",     "new": "Buy",         "price_target": 950.0,  "currency": "USD", "days_offset": 0},
    {"ticker": "AAPL",     "exchange": "NASDAQ", "company": "Apple",           "analyst": "Morgan Stanley", "prev": "Hold",    "new": "Overweight",  "price_target": 220.0,  "currency": "USD", "days_offset": 1},
    {"ticker": "TCS",      "exchange": "NSE",    "company": "TCS",             "analyst": "Kotak Securities","prev": "Buy",    "new": "Add",         "price_target": 4200.0, "currency": "INR", "days_offset": 0},
    {"ticker": "RELIANCE", "exchange": "NSE",    "company": "Reliance",        "analyst": "ICICI Securities","prev": "Buy",   "new": "Buy",         "price_target": 3100.0, "currency": "INR", "days_offset": 2},
    {"ticker": "INFY",     "exchange": "NSE",    "company": "Infosys",         "analyst": "HDFC Securities","prev": "Hold",   "new": "Buy",         "price_target": 1900.0, "currency": "INR", "days_offset": 1},
    {"ticker": "MSFT",     "exchange": "NASDAQ", "company": "Microsoft",       "analyst": "JP Morgan",      "prev": "Overweight","new": "Overweight","price_target": 450.0, "currency": "USD", "days_offset": 3},
    {"ticker": "TSLA",     "exchange": "NASDAQ", "company": "Tesla",           "analyst": "Wedbush",        "prev": "Neutral", "new": "Outperform",  "price_target": 300.0,  "currency": "USD", "days_offset": 2},
    {"ticker": "HDFCBANK", "exchange": "NSE",    "company": "HDFC Bank",       "analyst": "Motilal Oswal",  "prev": "Buy",     "new": "Buy",         "price_target": 1900.0, "currency": "INR", "days_offset": 4},
    {"ticker": "ICICIBANK","exchange": "NSE",    "company": "ICICI Bank",      "analyst": "Emkay Global",   "prev": "Buy",     "new": "Buy",         "price_target": 1300.0, "currency": "INR", "days_offset": 0},
    {"ticker": "AMD",      "exchange": "NASDAQ", "company": "AMD",             "analyst": "UBS",            "prev": "Neutral", "new": "Buy",         "price_target": 180.0,  "currency": "USD", "days_offset": 5},
    {"ticker": "META",     "exchange": "NASDAQ", "company": "Meta Platforms",  "analyst": "Bernstein",      "prev": "Buy",     "new": "Buy",         "price_target": 620.0,  "currency": "USD", "days_offset": 3},
    {"ticker": "BAJFINANCE","exchange":"NSE",    "company": "Bajaj Finance",   "analyst": "Axis Capital",   "prev": "Buy",     "new": "Buy",         "price_target": 8500.0, "currency": "INR", "days_offset": 6},
    {"ticker": "SUNPHARMA","exchange": "NSE",    "company": "Sun Pharma",      "analyst": "Sharekhan",      "prev": "Hold",    "new": "Buy",         "price_target": 1800.0, "currency": "INR", "days_offset": 7},
    {"ticker": "ORCL",     "exchange": "NYSE",   "company": "Oracle",          "analyst": "Citi",           "prev": "Neutral", "new": "Buy",         "price_target": 160.0,  "currency": "USD", "days_offset": 4},
    {"ticker": "GOOGL",    "exchange": "NASDAQ", "company": "Alphabet",        "analyst": "Barclays",       "prev": "Overweight","new": "Overweight","price_target": 200.0, "currency": "USD", "days_offset": 1},
]

# ── Dividends/corporate actions data ─────────────────────────────────────────
DIVIDENDS_DATA = [
    {"ticker": "TCS",       "exchange": "NSE",    "company": "TCS",            "dividend": 28.0,  "currency": "INR", "ex_date_offset": 5,  "record_date_offset": 6,  "pay_date_offset": 20, "yield_pct": 1.2},
    {"ticker": "INFY",      "exchange": "NSE",    "company": "Infosys",        "dividend": 20.0,  "currency": "INR", "ex_date_offset": 12, "record_date_offset": 13, "pay_date_offset": 25, "yield_pct": 1.5},
    {"ticker": "HDFCBANK",  "exchange": "NSE",    "company": "HDFC Bank",      "dividend": 15.0,  "currency": "INR", "ex_date_offset": 8,  "record_date_offset": 9,  "pay_date_offset": 22, "yield_pct": 0.9},
    {"ticker": "RELIANCE",  "exchange": "NSE",    "company": "Reliance Inds",  "dividend": 9.0,   "currency": "INR", "ex_date_offset": 15, "record_date_offset": 16, "pay_date_offset": 30, "yield_pct": 0.4},
    {"ticker": "WIPRO",     "exchange": "NSE",    "company": "Wipro",          "dividend": 5.0,   "currency": "INR", "ex_date_offset": 20, "record_date_offset": 21, "pay_date_offset": 35, "yield_pct": 0.6},
    {"ticker": "AAPL",      "exchange": "NASDAQ", "company": "Apple",          "dividend": 0.25,  "currency": "USD", "ex_date_offset": 7,  "record_date_offset": 8,  "pay_date_offset": 21, "yield_pct": 0.5},
    {"ticker": "MSFT",      "exchange": "NASDAQ", "company": "Microsoft",      "dividend": 0.75,  "currency": "USD", "ex_date_offset": 14, "record_date_offset": 15, "pay_date_offset": 28, "yield_pct": 0.7},
    {"ticker": "JNJ",       "exchange": "NYSE",   "company": "Johnson & Johnson","dividend": 1.19,"currency": "USD", "ex_date_offset": 3,  "record_date_offset": 4,  "pay_date_offset": 18, "yield_pct": 3.0},
    {"ticker": "KO",        "exchange": "NYSE",   "company": "Coca-Cola",      "dividend": 0.485, "currency": "USD", "ex_date_offset": 10, "record_date_offset": 11, "pay_date_offset": 24, "yield_pct": 3.1},
    {"ticker": "JPM",       "exchange": "NYSE",   "company": "JPMorgan Chase", "dividend": 1.25,  "currency": "USD", "ex_date_offset": 6,  "record_date_offset": 7,  "pay_date_offset": 20, "yield_pct": 2.4},
    {"ticker": "XOM",       "exchange": "NYSE",   "company": "ExxonMobil",     "dividend": 0.95,  "currency": "USD", "ex_date_offset": 18, "record_date_offset": 19, "pay_date_offset": 32, "yield_pct": 3.4},
    {"ticker": "SUNPHARMA", "exchange": "NSE",    "company": "Sun Pharma",     "dividend": 3.0,   "currency": "INR", "ex_date_offset": 25, "record_date_offset": 26, "pay_date_offset": 40, "yield_pct": 0.3},
]


class CalendarService:
    """Service for managing all financial calendars."""

    async def _event_exists(
        self,
        db: AsyncSession,
        event_type: str,
        ticker: str | None,
        event_date: datetime,
        extra_filter: dict | None = None
    ) -> bool:
        """Check if a similar event already exists (deduplication key)."""
        conditions = [
            CalendarEvent.event_type == event_type,
            CalendarEvent.event_date == event_date,
        ]
        if ticker:
            conditions.append(CalendarEvent.ticker == ticker)

        if extra_filter:
            for key, value in extra_filter.items():
                if hasattr(CalendarEvent, key):
                    conditions.append(getattr(CalendarEvent, key) == value)

        result = await db.execute(select(CalendarEvent).where(and_(*conditions)))
        return result.scalars().first() is not None

    # ── Earnings ──────────────────────────────────────────────────────────────

    async def fetch_us_earnings_calendar(self, db: AsyncSession, from_date: datetime, to_date: datetime) -> int:
        events_created = 0
        try:
            for company in US_COMPANIES:
                event_date = datetime.utcnow() + timedelta(days=company["days_offset"])
                event_date = next_business_day(event_date)
                if event_date < from_date or event_date > to_date:
                    continue

                # Check if event already exists (deduplication)
                if await self._event_exists(
                    db,
                    event_type="EARNINGS",
                    ticker=company["ticker"],
                    event_date=event_date,
                    extra_filter={"fiscal_quarter": company["quarter"]}
                ):
                    logger.debug(f"Skipping duplicate earnings event for {company['ticker']} on {event_date}")
                    continue

                event = CalendarEvent(
                    event_type="EARNINGS",
                    ticker=company["ticker"],
                    exchange=company["exchange"],
                    company_name=company["name"],
                    event_date=event_date,
                    timezone="US/Eastern",
                    title=f"{company['ticker']} {company['quarter']} Earnings",
                    description="Quarterly earnings release",
                    impact_level="HIGH",
                    status="SCHEDULED",
                    fiscal_quarter=company["quarter"],
                )
                db.add(event)
                events_created += 1
            await db.commit()
        except Exception as e:
            logger.error(f"Error in fetch_us_earnings_calendar: {e}")
        return events_created

    async def fetch_india_earnings_calendar(self, db: AsyncSession, from_date: datetime, to_date: datetime) -> int:
        events_created = 0
        try:
            for i, company in enumerate(INDIA_COMPANIES):
                event_date = from_date + timedelta(days=5 + i * 3)
                event_date = next_business_day(event_date)
                if event_date > to_date:
                    break

                # Check if event already exists (deduplication)
                if await self._event_exists(
                    db,
                    event_type="EARNINGS",
                    ticker=company["display"],
                    event_date=event_date,
                    extra_filter={"fiscal_quarter": company["quarter"]}
                ):
                    logger.debug(f"Skipping duplicate earnings event for {company['display']} on {event_date}")
                    continue

                event = CalendarEvent(
                    event_type="EARNINGS",
                    ticker=company["display"],
                    exchange=company["exchange"],
                    company_name=company["name"],
                    event_date=event_date,
                    timezone="Asia/Kolkata",
                    title=f"{company['display']} {company['quarter']} Results",
                    description=f"Quarterly results – {company['sector']} sector",
                    impact_level="HIGH",
                    status="SCHEDULED",
                    fiscal_quarter=company["quarter"],
                )
                db.add(event)
                events_created += 1
            await db.commit()
        except Exception as e:
            logger.error(f"Error in fetch_india_earnings_calendar: {e}")
        return events_created

    # ── Economic ──────────────────────────────────────────────────────────────

    async def fetch_economic_calendar(self, db: AsyncSession) -> int:
        events_created = 0
        now = datetime.utcnow()
        economic_events = [
            {"title": "US Non-Farm Payrolls", "indicator": "NFP", "offset": 3, "tz": "US/Eastern", "impact": "HIGH", "forecast": "185K", "country": "US", "time": "08:30"},
            {"title": "US CPI (YoY)", "indicator": "CPI", "offset": 10, "tz": "US/Eastern", "impact": "HIGH", "forecast": "3.1%", "country": "US", "time": "08:30"},
            {"title": "US Federal Reserve Rate Decision", "indicator": "FOMC", "offset": 21, "tz": "US/Eastern", "impact": "CRITICAL", "forecast": "5.25-5.50%", "country": "US", "time": "14:00"},
            {"title": "India GDP Growth Rate (Q4)", "indicator": "GDP-IN", "offset": 7, "tz": "Asia/Kolkata", "impact": "HIGH", "forecast": "6.8%", "country": "IN", "time": "17:30"},
            {"title": "RBI Monetary Policy Decision", "indicator": "RBI-MPC", "offset": 14, "tz": "Asia/Kolkata", "impact": "CRITICAL", "forecast": "6.50%", "country": "IN", "time": "10:00"},
            {"title": "India IIP (Industrial Output)", "indicator": "IIP", "offset": 12, "tz": "Asia/Kolkata", "impact": "MEDIUM", "forecast": "4.2%", "country": "IN", "time": "17:00"},
            {"title": "US ISM Manufacturing PMI", "indicator": "ISM-MFG", "offset": 5, "tz": "US/Eastern", "impact": "MEDIUM", "forecast": "50.3", "country": "US", "time": "10:00"},
            {"title": "US Retail Sales (MoM)", "indicator": "RETAIL-SALES", "offset": 16, "tz": "US/Eastern", "impact": "MEDIUM", "forecast": "0.3%", "country": "US", "time": "08:30"},
            {"title": "India WPI Inflation", "indicator": "WPI", "offset": 8, "tz": "Asia/Kolkata", "impact": "MEDIUM", "forecast": "1.8%", "country": "IN", "time": "12:00"},
            {"title": "US Initial Jobless Claims", "indicator": "JOBLESS", "offset": 2, "tz": "US/Eastern", "impact": "MEDIUM", "forecast": "215K", "country": "US", "time": "08:30"},
            {"title": "India CPI Inflation (YoY)", "indicator": "CPI-IN", "offset": 11, "tz": "Asia/Kolkata", "impact": "HIGH", "forecast": "4.8%", "country": "IN", "time": "17:30"},
            {"title": "US PCE Price Index", "indicator": "PCE", "offset": 25, "tz": "US/Eastern", "impact": "HIGH", "forecast": "2.6%", "country": "US", "time": "08:30"},
        ]
        try:
            for ev in economic_events:
                event_date = now + timedelta(days=ev["offset"])
                event_date = next_business_day(event_date)

                # Check if event already exists (deduplication by indicator + date)
                if await self._event_exists(
                    db,
                    event_type="ECONOMIC",
                    ticker=None,
                    event_date=event_date,
                    extra_filter={"indicator_name": ev["indicator"]}
                ):
                    logger.debug(f"Skipping duplicate economic event {ev['indicator']} on {event_date}")
                    continue

                event = CalendarEvent(
                    event_type="ECONOMIC",
                    exchange="GLOBAL",
                    company_name="Economic Indicator",
                    event_date=event_date,
                    event_time=ev["time"],
                    timezone=ev["tz"],
                    title=ev["title"],
                    indicator_name=ev["indicator"],
                    forecast=ev["forecast"],
                    impact_level=ev["impact"],
                    status="SCHEDULED",
                    country=ev["country"],
                )
                db.add(event)
                events_created += 1
            await db.commit()
        except Exception as e:
            logger.error(f"Error in fetch_economic_calendar: {e}")
        return events_created

    # ── Ratings Changes ───────────────────────────────────────────────────────

    async def fetch_ratings_calendar(self, db: AsyncSession, from_date: datetime, to_date: datetime) -> int:
        events_created = 0
        try:
            for rd in RATINGS_DATA:
                event_date = datetime.utcnow() + timedelta(days=rd["days_offset"])
                event_date = next_business_day(event_date)
                if event_date < from_date or event_date > to_date:
                    continue

                # Determine if upgrade/downgrade/initiation
                rating_map = {"Buy": 3, "Overweight": 3, "Outperform": 3, "Add": 3,
                              "Hold": 2, "Neutral": 2, "Underweight": 1, "Sell": 1, "Underperform": 1}
                prev_score = rating_map.get(rd["prev"], 2)
                new_score  = rating_map.get(rd["new"],  2)
                if prev_score < new_score:
                    change_type = "UPGRADE"
                elif prev_score > new_score:
                    change_type = "DOWNGRADE"
                else:
                    change_type = "MAINTAIN"

                # Check if event already exists (deduplication by ticker + analyst + date)
                if await self._event_exists(
                    db,
                    event_type="RATING_CHANGE",
                    ticker=rd["ticker"],
                    event_date=event_date,
                    extra_filter={"analyst_firm": rd["analyst"]}
                ):
                    logger.debug(f"Skipping duplicate ratings event for {rd['ticker']} by {rd['analyst']} on {event_date}")
                    continue

                event = CalendarEvent(
                    event_type="RATING_CHANGE",
                    ticker=rd["ticker"],
                    exchange=rd["exchange"],
                    company_name=rd["company"],
                    event_date=event_date,
                    timezone="UTC",
                    title=f"{rd['analyst']} {change_type.title()}s {rd['ticker']} to {rd['new']}",
                    description=f"Rating change from {rd['prev']} → {rd['new']}. PT: {rd['currency']} {rd['price_target']:,.0f}",
                    impact_level="MEDIUM",
                    status="COMPLETED",
                    analyst_firm=rd["analyst"],
                    rating_prev=rd["prev"],
                    rating_new=rd["new"],
                    price_target=rd["price_target"],
                    change_type=change_type,
                )
                db.add(event)
                events_created += 1
            await db.commit()
        except Exception as e:
            logger.error(f"Error in fetch_ratings_calendar: {e}")
        return events_created

    # ── Dividends ─────────────────────────────────────────────────────────────

    async def fetch_dividends_calendar(self, db: AsyncSession, from_date: datetime, to_date: datetime) -> int:
        events_created = 0
        try:
            for dv in DIVIDENDS_DATA:
                ex_date     = datetime.utcnow() + timedelta(days=dv["ex_date_offset"])
                ex_date     = next_business_day(ex_date)
                record_date = next_business_day(datetime.utcnow() + timedelta(days=dv["record_date_offset"]))
                pay_date    = next_business_day(datetime.utcnow() + timedelta(days=dv["pay_date_offset"]))
                if ex_date < from_date or ex_date > to_date:
                    continue

                # Check if event already exists (deduplication by ticker + ex_date)
                if await self._event_exists(
                    db,
                    event_type="DIVIDEND",
                    ticker=dv["ticker"],
                    event_date=ex_date
                ):
                    logger.debug(f"Skipping duplicate dividend event for {dv['ticker']} on {ex_date}")
                    continue

                event = CalendarEvent(
                    event_type="DIVIDEND",
                    ticker=dv["ticker"],
                    exchange=dv["exchange"],
                    company_name=dv["company"],
                    event_date=ex_date,
                    timezone="UTC",
                    title=f"{dv['ticker']} Ex-Dividend Date",
                    description=f"Dividend of {dv['currency']} {dv['dividend']} per share. Yield: {dv['yield_pct']}%",
                    impact_level="LOW",
                    status="SCHEDULED",
                    dividend_amount=dv["dividend"],
                    dividend_currency=dv["currency"],
                    ex_date=ex_date,
                    record_date=record_date,
                    pay_date=pay_date,
                    dividend_yield=dv["yield_pct"],
                )
                db.add(event)
                events_created += 1
            await db.commit()
        except Exception as e:
            logger.error(f"Error in fetch_dividends_calendar: {e}")
        return events_created

    # ── Sync all ──────────────────────────────────────────────────────────────

    async def sync_all_calendars(self, db: AsyncSession) -> dict:
        summary = {}
        from_date = datetime.utcnow()
        to_date   = from_date + timedelta(days=90)

        logger.info("Starting calendar sync - using upsert strategy (not delete-all)")

        summary["us_earnings"]    = await self.fetch_us_earnings_calendar(db, from_date, to_date)
        summary["india_earnings"] = await self.fetch_india_earnings_calendar(db, from_date, to_date)
        summary["economic"]       = await self.fetch_economic_calendar(db)
        summary["ratings"]        = await self.fetch_ratings_calendar(db, from_date, to_date)
        summary["dividends"]      = await self.fetch_dividends_calendar(db, from_date, to_date)

        logger.info(f"Calendar sync complete: {summary}")
        return summary
