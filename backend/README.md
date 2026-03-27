# Market Cockpit Backend

A comprehensive FastAPI backend for financial intelligence, serving India + US equity investors with real-time market data, news, earnings calendar, price alerts, and AI-powered insights.

## Features

- **Portfolio Management**: Track positions with real-time P&L and performance metrics
- **Watchlists**: Monitor stocks with custom alerts and notifications
- **News Aggregation**: Automatic RSS feed ingestion from 8+ financial news sources with smart ticker extraction
- **Financial Calendar**: Earnings dates, economic indicators, rating changes, and dividends
- **Price Alerts**: PRICE_LEVEL, PRICE_PCT, EARNINGS_NEAR, NEWS_TRIGGER, VOLUME_SPIKE rules
- **AI Insights**: Morning/evening briefs, trade explanations, earnings memos via Claude API
- **Market Data**: Live quotes, OHLCV data, fundamentals from yfinance
- **User Management**: JWT auth, profiles with preferences and notification channels
- **Async/Real-time**: WebSocket for live alerts via Redis pub/sub
- **Scheduled Tasks**: Celery Beat for periodic ingestion, alert evaluation, and brief generation

## Tech Stack

- **FastAPI**: Modern async web framework
- **SQLAlchemy 2.0**: Async ORM with PostgreSQL
- **Redis**: Caching and pub/sub for real-time features
- **Celery**: Distributed task queue for background jobs
- **yfinance**: Market data (quotes, OHLCV, fundamentals)
- **Claude API**: AI-powered summaries and analysis
- **Pydantic v2**: Data validation and serialization
- **PostgreSQL**: Primary database

## Project Structure

```
backend/
├── app/
│   ├── core/
│   │   ├── config.py       # Environment configuration
│   │   ├── database.py     # SQLAlchemy async setup
│   │   └── security.py     # JWT and password utilities
│   ├── models/
│   │   ├── user.py         # User and UserProfile
│   │   ├── portfolio.py    # Portfolio, Position, Watchlist
│   │   ├── news.py         # NewsArticle with dedup
│   │   ├── event.py        # CalendarEvent (earnings, macro)
│   │   └── alert.py        # AlertRule and AlertInstance
│   ├── schemas/
│   │   ├── portfolio.py    # Pydantic request/response models
│   │   ├── news.py
│   │   ├── event.py
│   │   └── alert.py
│   ├── services/
│   │   ├── market_data.py      # Quotes, OHLCV, fundamentals
│   │   ├── news_ingestor.py    # RSS parsing, ticker extraction
│   │   ├── calendar_service.py # Earnings, economic calendars
│   │   ├── alert_engine.py     # Price/news alert evaluation
│   │   └── ai_summarizer.py    # Claude-powered briefs and analysis
│   ├── api/v1/
│   │   ├── auth.py        # Register, login, profile
│   │   ├── portfolio.py   # CRUD for portfolios, positions, watchlists
│   │   ├── news.py        # News feed with filters
│   │   ├── calendar.py    # Earnings, economic calendars
│   │   ├── alerts.py      # Alert rules and WebSocket
│   │   ├── ai.py          # Briefs, explanations, chat
│   │   └── market.py      # Quotes, OHLCV, indices, search
│   ├── workers/
│   │   ├── celery_app.py        # Celery setup with beat schedule
│   │   └── ingestion_tasks.py   # News ingest, calendar sync, alerts
│   ├── alembic/
│   │   ├── env.py         # Migration environment
│   │   └── versions/      # Migration files
│   └── main.py            # FastAPI app entry point
├── requirements.txt       # Python dependencies
├── .env.example          # Environment template
├── alembic.ini          # Migration config
└── README.md            # This file
```

## Installation

### Prerequisites
- Python 3.10+
- PostgreSQL 13+
- Redis 6+

### Setup

1. **Clone and setup venv**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

4. **Initialize database**:
   ```bash
   # With alembic
   alembic upgrade head
   
   # Or just run the app (auto-creates tables)
   python -m uvicorn app.main:app --reload
   ```

5. **Start Redis** (if not already running):
   ```bash
   redis-server
   ```

6. **Start Celery worker** (separate terminal):
   ```bash
   celery -A app.workers.celery_app worker --loglevel=info
   ```

7. **Start Celery Beat** (separate terminal for scheduled tasks):
   ```bash
   celery -A app.workers.celery_app beat --loglevel=info
   ```

## API Usage

### Authentication
```bash
# Register
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure_password",
    "display_name": "John Doe"
  }'

# Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure_password"
  }'
```

### Portfolio Operations
```bash
# Create portfolio
curl -X POST http://localhost:8000/api/v1/portfolios \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Tech Portfolio", "currency": "USD", "is_primary": true}'

# Get portfolio summary with P&L
curl -X GET http://localhost:8000/api/v1/portfolios/{portfolio_id}/summary \
  -H "Authorization: Bearer {token}"
```

### News Feed
```bash
# Get filtered news
curl -X GET 'http://localhost:8000/api/v1/news?region=IN&importance_min=70&limit=20' \
  -H "Authorization: Bearer {token}"

# Get in-play tickers
curl -X GET 'http://localhost:8000/api/v1/news/in-play/top-tickers?days=1' \
  -H "Authorization: Bearer {token}"
```

### AI Briefs
```bash
# Get morning brief
curl -X GET http://localhost:8000/api/v1/ai/brief/morning \
  -H "Authorization: Bearer {token}"

# Chat with AI
curl -X POST http://localhost:8000/api/v1/ai/chat \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"message": "What should I do with my NVDA position?"}'
```

### Alerts
```bash
# Create price alert
curl -X POST http://localhost:8000/api/v1/alerts/rules \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "NVDA Above 900",
    "rule_type": "PRICE_LEVEL",
    "ticker": "NVDA",
    "exchange": "NASDAQ",
    "conditions": {"price": 900, "direction": "above"},
    "notification_channels": {"email": true, "telegram": false}
  }'

# WebSocket for real-time alerts
# Connect to: ws://localhost:8000/api/v1/alerts/ws/alerts?token={token}
```

## Environment Variables

Key environment variables (see `.env.example` for full list):

- `DATABASE_URL`: PostgreSQL async connection string
- `REDIS_URL`: Redis connection URL
- `SECRET_KEY`: JWT signing key (32+ chars)
- `ANTHROPIC_API_KEY`: Claude API key
- `CORS_ORIGINS`: Comma-separated allowed origins
- `NEWS_POLL_INTERVAL_SECONDS`: News refresh interval (default 180)
- `ALERT_CHECK_INTERVAL_SECONDS`: Alert eval interval (default 60)
- `SENTRY_DSN`: Sentry monitoring (optional)
- `ENVIRONMENT`: "development" or "production"

## Development

### Running Tests
```bash
pytest tests/ -v
```

### Migrations
```bash
# Create migration
alembic revision --autogenerate -m "Add new column"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

### Code Quality
```bash
# Format
black app/

# Lint
flake8 app/

# Type check
mypy app/
```

## Production Deployment

1. **Use environment-specific .env** (`.env.production`)
2. **Run with Gunicorn**:
   ```bash
   gunicorn app.main:app -w 4 -b 0.0.0.0:8000
   ```
3. **Enable Sentry** for error tracking
4. **Configure PostgreSQL** with proper indexes and backups
5. **Redis Cluster** for high availability
6. **Celery with multiple workers** for task processing
7. **HTTPS only** with proper SSL/TLS
8. **Rate limiting** (uncomment in main.py)
9. **Database pooling** and connection management
10. **Health checks** and monitoring dashboards

## Ticker Data

The system supports 60+ major stocks across India and US:

**India (NSE/BSE)**: RELIANCE, TCS, INFY, WIPRO, HDFC, ICICIBANK, HDFCBANK, AXISBANK, KOTAKBANK, TATAMOTORS, MARUTI, SUNPHARMA, ASIANPAINT, BHARTIARTL, and more

**USA (NYSE/NASDAQ)**: NVDA, TSLA, AAPL, MSFT, GOOGL, AMZN, META, NFLX, AMD, INTC, JPM, BAC, IBM, and more

See `app/services/news_ingestor.py` for complete TICKER_MAP.

## API Documentation

Full interactive documentation available at:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI Schema**: http://localhost:8000/openapi.json

## License

Proprietary - Market Cockpit Platform

## Support

For issues, feature requests, or questions, please contact the development team.
