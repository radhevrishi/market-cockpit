"""
FastAPI router for market data operations.
"""

from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel

from app.services.market_data import MarketDataService

router = APIRouter(prefix="/market", tags=["market"])

market_data_service = MarketDataService()


class QuoteRequest(BaseModel):
    """Request model for batch quotes."""
    ticker: str
    exchange: str


@router.get("/quote/{ticker}")
async def get_quote(
    ticker: str,
    exchange: str = Query("NASDAQ"),
):
    """Get current price quote for a ticker."""
    try:
        quote = await market_data_service.get_quote(ticker, exchange)
        if "error" in quote:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=quote["error"])
        return quote
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/quotes")
async def get_quotes_batch(
    tickers: list[QuoteRequest],
):
    """Get quotes for multiple tickers in batch."""
    try:
        # Pass both ticker and exchange info through to get_quotes_batch
        quotes = await market_data_service.get_quotes_batch(tickers)
        return quotes
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/indices")
async def get_indices():
    """Get live prices for major market indices."""
    try:
        from app.services.market_data import get_market_indices
        return await get_market_indices()
    except Exception:
        # Return mock data if fetch fails
        return [
            {"symbol": "NIFTY 50",   "price": 23500, "change_pct": 0.0, "up": True},
            {"symbol": "SENSEX",     "price": 77000, "change_pct": 0.0, "up": True},
            {"symbol": "S&P 500",    "price": 5700,  "change_pct": 0.0, "up": True},
            {"symbol": "NASDAQ",     "price": 18200, "change_pct": 0.0, "up": True},
            {"symbol": "USD/INR",    "price": 86.50, "change_pct": 0.0, "up": True},
            {"symbol": "GOLD",       "price": 3050,  "change_pct": 0.0, "up": True},
            {"symbol": "CRUDE OIL",  "price": 69.5,  "change_pct": 0.0, "up": True},
            {"symbol": "BITCOIN",    "price": 87500, "change_pct": 0.0, "up": True},
        ]
