# Market Cockpit - Deployment & Operations Guide

## Quick Start

### Local Development

```bash
# 1. Setup Python environment
python -m venv venv
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with actual values

# 4. Start PostgreSQL and Redis
# Using Docker:
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15
docker run -d -p 6379:6379 redis:7

# 5. Initialize database
# The app creates tables on first startup via init_db()

# 6. Start FastAPI server (Terminal 1)
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 7. Start Celery worker (Terminal 2)
celery -A app.workers.celery_app worker --loglevel=info

# 8. Start Celery Beat (Terminal 3)
celery -A app.workers.celery_app beat --loglevel=info

# 9. Access API
# FastAPI Docs: http://localhost:8000/docs
# ReDoc: http://localhost:8000/redoc
```

## Database Setup

### PostgreSQL

```bash
# Create database
createdb market_cockpit

# Alternative with Docker
docker run -d \
  --name market-cockpit-db \
  -e POSTGRES_DB=market_cockpit \
  -e POSTGRES_PASSWORD=secure_password \
  -p 5432:5432 \
  postgres:15-alpine
```

### Alembic Migrations

```bash
# Auto-generate migration (after model changes)
alembic revision --autogenerate -m "Descriptive message"

# Apply migrations
alembic upgrade head

# Check migration status
alembic current
alembic history

# Rollback
alembic downgrade -1
```

## Docker Compose Setup

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: market_cockpit
      POSTGRES_PASSWORD: secure_password
      POSTGRES_USER: market_user
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U market_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: .
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql+asyncpg://market_user:secure_password@postgres:5432/market_cockpit
      REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  celery_worker:
    build: .
    command: celery -A app.workers.celery_app worker --loglevel=info
    environment:
      DATABASE_URL: postgresql+asyncpg://market_user:secure_password@postgres:5432/market_cockpit
      REDIS_URL: redis://redis:6379/0
    depends_on:
      - postgres
      - redis

  celery_beat:
    build: .
    command: celery -A app.workers.celery_app beat --loglevel=info
    environment:
      DATABASE_URL: postgresql+asyncpg://market_user:secure_password@postgres:5432/market_cockpit
      REDIS_URL: redis://redis:6379/0
    depends_on:
      - postgres
      - redis

volumes:
  postgres_data:
```

Start with:
```bash
docker-compose up -d
```

## Production Deployment

### Environment Configuration

Create `.env.production`:

```bash
# Database (use managed service)
DATABASE_URL=postgresql+asyncpg://market_user:STRONG_PASSWORD@market-cockpit.c4rjdjxxx.us-east-1.rds.amazonaws.com:5432/market_cockpit

# Redis (use managed service)
REDIS_URL=redis://market-cockpit-prod.abcdef.ng.0001.use1.cache.amazonaws.com:6379/0

# Security
SECRET_KEY=<generate-32-char-random-key>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=43200

# API Keys
ANTHROPIC_API_KEY=sk-ant-xxxxx
ALPHA_VANTAGE_KEY=xxxx

# CORS
CORS_ORIGINS=["https://app.marketcockpit.com"]

# Polling
NEWS_POLL_INTERVAL_SECONDS=180
ALERT_CHECK_INTERVAL_SECONDS=60

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
ENVIRONMENT=production
```

### Application Server (Gunicorn)

```bash
# Install
pip install gunicorn

# Run with 4 workers
gunicorn app.main:app -w 4 -b 0.0.0.0:8000 --access-logfile - --error-logfile -

# Or with more workers for high traffic
gunicorn app.main:app -w 8 -b 0.0.0.0:8000 --worker-class uvicorn.workers.UvicornWorker
```

### Nginx Reverse Proxy

```nginx
upstream fastapi {
    server localhost:8000;
}

server {
    listen 443 ssl http2;
    server_name api.marketcockpit.com;

    ssl_certificate /etc/letsencrypt/live/marketcockpit.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/marketcockpit.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
    limit_req zone=api_limit burst=200 nodelay;

    location / {
        proxy_pass http://fastapi;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }

    # WebSocket support
    location /api/v1/alerts/ws/ {
        proxy_pass http://fastapi;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.marketcockpit.com;
    return 301 https://$server_name$request_uri;
}
```

### Systemd Service Files

`/etc/systemd/system/market-cockpit-api.service`:

```ini
[Unit]
Description=Market Cockpit API
After=network.target

[Service]
Type=notify
User=www-data
WorkingDirectory=/opt/market-cockpit
Environment="PATH=/opt/market-cockpit/venv/bin"
EnvironmentFile=/opt/market-cockpit/.env.production
ExecStart=/opt/market-cockpit/venv/bin/gunicorn app.main:app -w 4 --bind 127.0.0.1:8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/market-cockpit-celery.service`:

```ini
[Unit]
Description=Market Cockpit Celery Worker
After=network.target

[Service]
Type=forking
User=www-data
WorkingDirectory=/opt/market-cockpit
Environment="PATH=/opt/market-cockpit/venv/bin"
EnvironmentFile=/opt/market-cockpit/.env.production
ExecStart=/opt/market-cockpit/venv/bin/celery -A app.workers.celery_app worker --loglevel=info --logfile=/var/log/market-cockpit/celery.log
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable market-cockpit-api market-cockpit-celery
sudo systemctl start market-cockpit-api market-cockpit-celery
sudo systemctl status market-cockpit-api market-cockpit-celery
```

## Monitoring & Logging

### Sentry Integration

Already configured in `app/main.py`:

```python
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        integrations=[FastApiIntegration()],
        environment=settings.environment,
        traces_sample_rate=0.1,
    )
```

Set `SENTRY_DSN` in production `.env` to enable.

### Application Logs

```bash
# View logs
tail -f /var/log/market-cockpit/app.log

# With systemd
sudo journalctl -u market-cockpit-api -f
sudo journalctl -u market-cockpit-celery -f

# Docker logs
docker logs -f market-cockpit-api
```

### Health Checks

Kubernetes or load balancer health check:

```
GET /health
Expected: 200 OK
{
  "status": "healthy",
  "version": "1.0.0",
  "environment": "production"
}
```

### Metrics (Prometheus)

Endpoint already instrumented with:
```python
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)
```

Available at: `GET /metrics`

## Database Backup

### PostgreSQL Backup

```bash
# Full backup
pg_dump -h localhost -U market_user -d market_cockpit > backup_$(date +%Y%m%d).sql

# With compression
pg_dump -h localhost -U market_user -d market_cockpit | gzip > backup_$(date +%Y%m%d).sql.gz

# Automated daily backup (cron)
0 2 * * * pg_dump -h localhost -U market_user -d market_cockpit | gzip > /backups/market_cockpit_$(date +\%Y\%m\%d).sql.gz
```

### Restore

```bash
# From SQL file
psql -h localhost -U market_user -d market_cockpit < backup.sql

# From compressed backup
gunzip < backup.sql.gz | psql -h localhost -U market_user -d market_cockpit
```

## Scaling

### Horizontal Scaling

1. **API Servers**: Run multiple Gunicorn instances behind load balancer
2. **Celery Workers**: Scale workers independently for CPU-bound tasks
3. **Database**: Use read replicas; application uses primary for writes
4. **Redis**: Use Redis Cluster for resilience

### Performance Tuning

```python
# app/core/database.py - Connection pool settings
create_async_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=40,
    pool_recycle=3600,  # Recycle connections hourly
)
```

## Troubleshooting

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -h localhost -U market_user -d market_cockpit

# Check connection string format
# postgresql+asyncpg://user:password@host:5432/dbname
```

### Redis Connection Issues

```bash
# Test Redis connection
redis-cli -h localhost ping
# Should return: PONG
```

### Celery Tasks Not Running

```bash
# Check Celery Beat schedule
celery -A app.workers.celery_app inspect scheduled

# Check active tasks
celery -A app.workers.celery_app inspect active

# View task history
celery -A app.workers.celery_app events
```

### High Memory Usage

```bash
# Check Celery task queue size
redis-cli LLEN celery

# View Celery worker memory
celery -A app.workers.celery_app inspect stats | grep memory
```

## Maintenance

### Database Maintenance

```bash
# Analyze query planner
ANALYZE;

# Vacuum (remove dead rows)
VACUUM ANALYZE;

# Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Cleanup Old Data

```sql
-- Remove news articles older than 90 days
DELETE FROM news_articles WHERE published_at < NOW() - INTERVAL '90 days';

-- Remove alert instances older than 30 days
DELETE FROM alert_instances WHERE triggered_at < NOW() - INTERVAL '30 days';
```

## Security Checklist

- [ ] All passwords use strong, random values
- [ ] HTTPS enabled with valid SSL certificate
- [ ] CORS configured to specific origins
- [ ] JWT tokens have short expiration or rotation
- [ ] Rate limiting enabled on API endpoints
- [ ] Database backups encrypted and stored off-site
- [ ] API keys never committed to git (use .env only)
- [ ] Sentry monitoring enabled for error tracking
- [ ] Database firewall restricts to app servers only
- [ ] Redis firewall restricts to app servers only
- [ ] Regular security updates for dependencies

---

Last Updated: 2026-03-01
