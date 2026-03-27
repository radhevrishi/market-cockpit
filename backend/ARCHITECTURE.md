# Market Cockpit Backend Architecture

## Overview

Market Cockpit is a production-grade FastAPI backend designed for financial intelligence, serving India + US equity investors with real-time market data, news aggregation, earnings calendars, price alerts, and AI-powered insights.

## Core Components

### 1. Authentication & Security (app/core/security.py)

**JWT Token Management**:
- `create_access_token()`: Generate JWT tokens with configurable expiration (default 30 days)
- `verify_token()`: Decode and validate JWT tokens
- `get_current_user()`: FastAPI dependency for protected endpoints

**Password Management**:
- `get_password_hash()`: Bcrypt password hashing
- `verify_password()`: Constant-time password verification

**Bearer Token Extraction**:
- Uses HTTPBearer scheme for automatic Authorization header parsing
- Raises 401 Unauthorized on invalid/missing credentials

### 2. Database Layer (app/core/database.py)

**SQLAlchemy 2.0 Async Setup**:
- `AsyncEngine` with NullPool for serverless-friendly connection management
- `AsyncSession` factory for all database operations
- Declarative Base for ORM models

**Key Functions**:
- `init_db()`: Creates all tables on startup
- `get_db()`: FastAPI dependency providing session per request
- `get_engine()` / `get_session_maker()`: Access to engine/factory

**Database Models** (5 aggregate roots):
- **User**: email, hashed_password, is_active, created_at
- **Portfolio**: user-owned portfolios with positions
- **News**: Articles with deduplication and ticker tags
- **Calendar**: Earnings, economic indicators, corporate actions
- **Alert**: User-defined price/news trigger rules

### 3. Market Data Service (app/services/market_data.py)

**Quote Fetching**:
```python
get_quote(ticker, exchange) → {price, change, change_pct, volume, 52w_high/low}
get_quotes_batch([(ticker, exchange), ...]) → {key: quote_dict}
```

**Historical Data**:
```python
get_ohlcv(ticker, exchange, period="1mo", interval="1d") → [{date, open, high, low, close, volume}]
```

**Fundamentals**:
```python
get_fundamentals(ticker, exchange) → {pe_ratio, market_cap, revenue, eps, debt_to_equity, ...}
```

**Data Sources**:
- yfinance for all markets (US: NASDAQ/NYSE, India: NSE/BSE)
- Automatic suffix mapping (e.g., TCS → TCS.NS for NSE)
- Redis caching (60-second TTL)
- Error handling with graceful degradation

### 4. News Ingestion Service (app/services/news_ingestor.py)

**RSS Feed Processing**:
- 8 configured sources: ET Markets, Moneycontrol, CNBC, Reuters, MarketWatch, FT, Bloomberg, NDTV
- Async HTTP fetch with timeout handling
- Feedparser for RSS parsing

**Intelligent Ticker Extraction**:
- 60+ ticker map (30 India NSE, 30 US stocks)
- Regex pattern matching with word boundaries
- Confidence scoring based on mention frequency
- Deduplication support

**Importance Scoring** (0-100):
- Source trust weighting (Reuters 95, ET Markets 85, etc.)
- Keyword detection (EARNINGS, ACQUISITION, IPO boost score by 10)
- Automatic sentiment classification (BULLISH/BEARISH/NEUTRAL)

**Deduplication**:
- SHA256 hash of URL as external_id
- Prevents duplicate ingestion
- Tracks duplicate_of relationship (self-referential FK)

### 5. Calendar Service (app/services/calendar_service.py)

**Earnings Calendar**:
- US: yfinance integration for popular stocks (AAPL, MSFT, NVDA, etc.)
- India: Mock data with realistic schedule for 5 major companies
- Fields: EPS estimate/actual, revenue, surprise %, fiscal quarter/year

**Economic Calendar**:
- Mock implementation with NFP, GDP, FOMC events
- Impact levels: HIGH/MEDIUM/LOW
- Configurable forecast/actual/prior values

**Calendar Synchronization**:
- Clears and repopulates on each sync (avoid duplicates)
- Returns summary: {us_earnings, india_earnings, economic} counts
- Runs every 60 minutes via Celery Beat

### 6. Alert Engine (app/services/alert_engine.py)

**Rule Types**:

1. **PRICE_LEVEL**: `{price: 100, direction: "above"|"below"}`
   - Alert when price crosses threshold
   
2. **PRICE_PCT**: `{pct_change: 5, direction: "down"|"up"}`
   - Alert on percentage change from baseline
   
3. **EARNINGS_NEAR**: `{days_before: 3}`
   - Alert 3 days before earnings
   
4. **NEWS_TRIGGER**: `{keywords: [...], sentiment: "BULLISH"}`
   - Alert on specific keywords/sentiment
   
5. **VOLUME_SPIKE**: `{multiplier: 2.0}`
   - Alert on 2x average volume

**Evaluation Flow**:
1. Fetch all active rules with cooldown check
2. Get current quote via MarketDataService
3. Check conditions against current market state
4. Create AlertInstance if triggered (respecting cooldown)
5. Send notifications via email/Telegram/WebSocket

**Real-time Delivery**:
- Redis pub/sub channel per user: `alerts:{user_id}`
- WebSocket endpoint for browser notifications
- Message format: `{alert_id, rule_name, trigger_value, timestamp}`

### 7. AI Summarizer Service (app/services/ai_summarizer.py)

**Claude API Integration**:
- Model: claude-opus-4-6 (frontier model)
- Max tokens: 500-800 depending on request type

**Features**:

1. **Morning Brief** (generated at 8:30 AM IST):
   - User portfolio context (positions, holdings)
   - Recent market headlines (top 5)
   - 2-3 paragraph narrative with key themes, portfolio impact, watch list

2. **Evening Brief** (generated at 5:30 PM EST):
   - Market recap, key movers, opportunities/risks

3. **Trade Explanation** (on-demand):
   - Why ticker moved today
   - Recent news trigger analysis
   - Sector/market implications

4. **Earnings Memo** (on-demand):
   - 3-quarter trend analysis
   - Key drivers (margin, revenue)
   - Forward guidance and consensus

5. **Portfolio Chat** (streaming):
   - Free-form questions about positions
   - Context-aware answers using portfolio data
   - Actionable investment insights

**Caching**:
- Redis TTL: 1800 seconds (30 minutes)
- Key format: `morning_brief:{user_id}:{date}`
- Prevents redundant API calls

## API Endpoints

### Auth (`/api/v1/auth`)
- `POST /register`: Create account + default portfolio
- `POST /login`: Generate JWT token
- `GET /me`: Current user profile
- `PATCH /me`: Update profile (display_name, timezone, preferences)
- `POST /logout`: Token invalidation

### Portfolio (`/api/v1/portfolios`)
- `GET /`: List user portfolios
- `POST /`: Create portfolio
- `GET /{id}`: Get portfolio
- `DELETE /{id}`: Delete portfolio
- `GET /{id}/positions`: List positions
- `POST /{id}/positions`: Add position
- `PATCH /{id}/positions/{pos_id}`: Update position
- `DELETE /{id}/positions/{pos_id}`: Delete position
- `GET /{id}/summary`: Portfolio P&L with live quotes
- `GET /watchlists`: List watchlists
- `POST /watchlists`: Create watchlist
- `POST /watchlists/{id}/items`: Add watchlist item
- `DELETE /watchlists/{id}/items/{item_id}`: Remove item

### News (`/api/v1/news`)
- `GET /`: Paginated feed with filters (region, sector, theme, importance_min, article_type, ticker, search, dates)
- `GET /{id}`: Single article
- `GET /in-play/top-tickers`: Top 10 tickers by mention count
- `GET /ticker/{ticker}`: News for specific ticker (last N days)

### Calendar (`/api/v1/calendar`)
- `GET /earnings`: Filtered earnings calendar
- `GET /economic`: Economic calendar
- `GET /today`: Events today for user's universe
- `GET /upcoming`: Next N days for user's portfolio + watchlists

### Alerts (`/api/v1/alerts`)
- `GET /rules`: List user's alert rules
- `POST /rules`: Create rule
- `PATCH /rules/{id}`: Update/toggle rule
- `DELETE /rules/{id}`: Delete rule
- `GET /instances`: Recent alert history (30 days)
- `WS /ws/alerts`: WebSocket for real-time alerts (Redis pub/sub)

### AI (`/api/v1/ai`)
- `GET /brief/morning`: Generate/retrieve morning brief
- `GET /brief/evening`: Generate/retrieve evening brief
- `POST /explain/{ticker}`: Explain ticker move
- `POST /memo/{ticker}`: 3-quarter earnings memo
- `POST /chat`: Free-form chat with portfolio context
- `GET /briefs`: List saved briefs (stub)

### Market (`/api/v1/market`)
- `GET /quote/{ticker}`: Single quote
- `POST /quotes`: Batch quotes
- `GET /ohlcv/{ticker}`: OHLCV data (period, interval params)
- `GET /indices`: Global indices (Nifty50, Sensex, S&P500, NASDAQ, Dow)
- `GET /search`: Ticker search by symbol/name

### System
- `GET /health`: Health check (DB + Redis)
- `GET /`: API info

## Background Jobs (Celery)

### Tasks (app/workers/ingestion_tasks.py)

1. **ingest_news_sources()**: Every 3 minutes
   - Fetch 8 RSS feeds
   - Parse entries, extract tickers
   - Score importance, deduplicate
   - Save to DB

2. **sync_calendars_task()**: Every 60 minutes
   - Fetch US earnings (yfinance)
   - Fetch India earnings (mock schedule)
   - Fetch economic calendar
   - Update CalendarEvent table

3. **evaluate_alerts_task()**: Every 60 seconds
   - Fetch active price/volume rules
   - Get current quotes
   - Check conditions, create instances
   - Send notifications

4. **generate_morning_briefs_task()**: Daily at 8:30 AM IST
   - Iterate all active users
   - Call ai_summarizer.generate_morning_brief()
   - Cache results in Redis

5. **generate_evening_briefs_task()**: Daily at 5:30 PM EST
   - Same flow as morning briefs

6. **backfill_ticker_context()**: On-demand
   - Called when user adds ticker to watchlist
   - Fetch quote, fundamentals, OHLCV
   - Warm cache for subsequent requests

## Data Models

### User Aggregate
```
User (id, email, hashed_password, is_active, created_at)
└── UserProfile (id, user_id, display_name, timezone, preferred_markets, notification_channels, created_at, updated_at)
```

### Portfolio Aggregate
```
Portfolio (id, user_id, name, currency, is_primary, created_at)
├── Position (id, portfolio_id, ticker, exchange, company_name, quantity, avg_cost, currency, notes, tags, created_at, updated_at)
└── (relates to live quotes for P&L calculation)

Watchlist (id, user_id, name, description, tags, created_at)
└── WatchlistItem (id, watchlist_id, ticker, exchange, company_name, added_at, notes)
```

### Content Aggregates
```
NewsArticle (id, external_id, source_name, source_url, headline, summary, region, sectors, themes, tickers, importance_score, sentiment, article_type, published_at, ingested_at, is_duplicate, duplicate_of)

CalendarEvent (id, event_type, ticker, exchange, company_name, event_date, event_time, timezone, title, description, impact_level, status, eps_estimate, eps_actual, revenue_estimate, revenue_actual, surprise_pct, fiscal_quarter, fiscal_year, indicator_name, forecast, actual, prior, analyst_firm, from_rating, to_rating, from_target, to_target, dividend_amount, ex_date, record_date, source_url, created_at, updated_at)
```

### Alert Aggregate
```
AlertRule (id, user_id, name, is_active, rule_type, ticker, exchange, conditions, news_conditions, notification_channels, cooldown_minutes, created_at, last_triggered_at)
└── AlertInstance (id, rule_id, triggered_at, trigger_value, status, notification_payload)
```

## Configuration

### Environment Variables (see .env.example)

**Database**:
- `DATABASE_URL`: Async PostgreSQL connection string
- Format: `postgresql+asyncpg://user:pass@host:5432/dbname`

**Cache & Queue**:
- `REDIS_URL`: Redis connection for cache, pub/sub, Celery broker
- Format: `redis://host:6379/0`

**Security**:
- `SECRET_KEY`: JWT signing key (32+ characters recommended)
- `ALGORITHM`: JWT algorithm (default HS256)
- `ACCESS_TOKEN_EXPIRE_MINUTES`: Token TTL (default 43200 = 30 days)

**API Keys**:
- `ANTHROPIC_API_KEY`: Claude API key for AI features
- `ALPHA_VANTAGE_KEY`: Alternative market data source (fallback)

**CORS**:
- `CORS_ORIGINS`: JSON list of allowed origins
- Example: `["http://localhost:3000"]`

**Polling**:
- `NEWS_POLL_INTERVAL_SECONDS`: News ingestion interval (default 180)
- `ALERT_CHECK_INTERVAL_SECONDS`: Alert evaluation interval (default 60)

**Briefs**:
- `AI_BRIEF_MORNING_IST`: Morning brief time in IST (default 08:30)
- `AI_BRIEF_CLOSE_EST`: Evening brief time in EST (default 17:30)

**Monitoring**:
- `SENTRY_DSN`: Sentry monitoring DSN (optional)
- `ENVIRONMENT`: "development" or "production"

## Error Handling

**HTTP Status Codes**:
- 200: Success
- 201: Created
- 204: No Content
- 400: Bad Request (invalid input)
- 401: Unauthorized (missing/invalid token)
- 403: Forbidden (inactive user)
- 404: Not Found (resource doesn't exist)
- 500: Internal Server Error

**Exception Handling**:
- Database errors caught and logged
- Third-party API failures logged with fallback
- Sentry integration for production monitoring
- Structured logging with timestamp, module, level

## Performance Optimizations

1. **Async Throughout**: FastAPI + SQLAlchemy async ORM
2. **Connection Pooling**: NullPool for serverless, standard pool for server
3. **Redis Caching**: 60-second TTL for quotes, 1800s for briefs
4. **Batch Operations**: `get_quotes_batch()` for multiple tickers
5. **Deduplication**: NewsArticle external_id unique constraint
6. **Indexes**:
   - `(user_id)` on portfolios, watchlists, alert_rules
   - `(ticker, exchange)` on positions, watchlist_items
   - `(external_id)` on news_articles (unique)
   - `(published_at)` on news_articles
   - `(event_date)` on calendar_events

## Security Features

1. **JWT Tokens**: Bearer token in Authorization header
2. **Password Hashing**: Bcrypt with salt
3. **SQL Injection Prevention**: SQLAlchemy ORM parameterization
4. **CORS**: Configurable allowed origins
5. **Rate Limiting**: TODO (commented in main.py)
6. **HTTPS**: Required in production
7. **Token Expiration**: Configurable, default 30 days
8. **User Isolation**: All queries filtered by user_id

## Testing Checklist

- [ ] User registration and JWT flow
- [ ] Portfolio CRUD operations
- [ ] Position P&L calculations with live quotes
- [ ] News ingestion from all sources
- [ ] Ticker extraction accuracy
- [ ] Alert rule evaluation (all 5 types)
- [ ] WebSocket real-time alerts
- [ ] AI brief generation
- [ ] Calendar sync from yfinance
- [ ] Celery task scheduling
- [ ] Redis pub/sub integration
- [ ] Database transaction rollback
- [ ] Error responses and logging

## Deployment Notes

1. **PostgreSQL**: Use managed service (AWS RDS, Azure Database) in production
2. **Redis**: Use managed service (AWS ElastiCache, Azure Cache) for resilience
3. **Application Server**: Gunicorn with 4-8 workers
4. **Load Balancer**: Nginx or AWS ALB for SSL termination
5. **Monitoring**: Sentry + CloudWatch/Datadog
6. **Backup**: Daily DB backups, test restore regularly
7. **Scaling**: Horizontal scaling with load balancer; Celery workers scale independently

---

Last Updated: 2026-03-01
Version: 1.0.0
