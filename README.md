# Market Cockpit

> **zzz883 (Oct 2026):** the app is ONE Next.js service (`frontend/`) deployed on Railway from `frontend/Dockerfile`.
> The old FastAPI `backend/`, `worker/`, `valuation-engine/`, Docker Compose and launcher scripts were never deployed and have been
> removed (they stay in git history). Local run: `cd frontend && npm ci --legacy-peer-deps && npm run dev`.
> Checks before a change ships: `node scripts/run-tests.mjs`, `node scripts/tsc-gate.mjs`, `npx next build` (CI runs all three).

# 📈 Market Cockpit

> Bloomberg-lite financial dashboard for India + US equity investors — built with FastAPI, Next.js 14, and SQLite.

---

## Quick Start

### Option A — Local Dev (no Docker required) ✅ Recommended

```bash
# 1. Unzip / clone the project
cd market-cockpit

# 2. Run the one-click starter
chmod +x start_local.sh
./start_local.sh
```

**What it does automatically:**
- Creates `.env` with SQLite defaults (no PostgreSQL needed)
- Creates a Python virtual environment in `backend/.venv`
- Installs all Python + Node dependencies
- Starts the FastAPI backend on `http://localhost:8000`
- Starts the Next.js frontend on `http://localhost:3000`
- Opens your browser automatically

**To stop:** Press `Ctrl+C` or run `./stop_local.sh`

---

### Option B — Docker Compose

```bash
# Requires Docker Desktop to be running
chmod +x start.sh
./start.sh
```

---

## Prerequisites

### For Local Dev (Option A)
| Tool | Version | Check |
|------|---------|-------|
| Python | 3.10+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 8+ | `npm --version` |

**Optional (for full features):**
- Redis — if not running, app uses an in-memory fallback (alerts/pub-sub degraded)
- PostgreSQL — SQLite is used by default; set `DATABASE_URL` in `.env` for PostgreSQL

### For Docker (Option B)
- Docker Desktop 4.0+ running

---

## Configuration

On first run, `start_local.sh` creates a `.env` file automatically. Edit it to add API keys:

```env
# Database (SQLite by default — no setup needed)
DATABASE_URL=sqlite+aiosqlite:///./market_cockpit.db

# Redis (optional — app runs without it)
REDIS_URL=redis://localhost:6379/0

# AI Features (required for Morning/Evening Briefs and AI Chat)
# Get yours free at: https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# Security (change this in production)
SECRET_KEY=your-secret-key-here-min-32-chars
```

---

## Features

| Feature | Status | Notes |
|---------|--------|-------|
| Mission Control Dashboard | ✅ | P&L cards, heatmap, top movers, must-know news |
| Portfolio Tracking | ✅ | Holdings, real-time P&L via yfinance, CSV import |
| Watchlists | ✅ | Multi-watchlist, live prices, CSV export |
| News Feed | ✅ | RSS-powered, sentiment badges, importance scoring |
| Earnings Calendar | ✅ | NSE + US earnings with date range filter |
| Economic Calendar | ✅ | RBI/Fed events, India/US macro data |
| Analyst Ratings | ✅ | Upgrades/downgrades/maintains |
| Dividends Calendar | ✅ | Ex-dates, pay dates, yields |
| Smart Alerts | ✅ | Price level, % change, earnings-near, volume spike |
| AI Morning Brief | ⚙️ | Requires `ANTHROPIC_API_KEY` in `.env` |
| AI Evening Brief | ⚙️ | Requires `ANTHROPIC_API_KEY` in `.env` |
| AI Chat | ⚙️ | Requires `ANTHROPIC_API_KEY` in `.env` |
| Global Search | ✅ | Press `⌘K` / `Ctrl+K` to search any ticker |
| Market Hours | ✅ | Live NSE/NYSE open/closed indicator in top bar |
| Dark/Light Mode | ✅ | Toggle in Settings → Display Preferences |
| Price Refresh Interval | ✅ | 15s / 30s / 1min / 5min — in Settings |
| Themes / Baskets | ✅ | Pre-built theme baskets (AI, EV, Defence, etc.) |

---

## Verifying the Backend is Running

```bash
curl http://localhost:8000/health
```

Expected response when fully operational:
```json
{
  "status": "ok",
  "services": {
    "database": "ok",
    "redis": "ok",
    "ai": "configured"
  }
}
```

- `status: "degraded"` means Redis or AI is unavailable — the core app still works fine
- `status: "ok"` — everything is running

---

## Troubleshooting

### Backend won't start

**Check the log:**
```bash
tail -50 backend.log      # if using start_local.sh
docker compose logs backend  # if using Docker
```

**Common issues:**

| Error | Fix |
|-------|-----|
| `ModuleNotFoundError: No module named 'aiosqlite'` | `cd backend && pip install -r requirements.txt` |
| `Address already in use` (port 8000) | Run `./stop_local.sh` then `./start_local.sh` |
| `No module named 'app'` | Run uvicorn from inside `backend/` directory |
| AI features show "API key not configured" | Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env`, restart |

### Prices all show `—`

Yahoo Finance (yfinance) may be rate-limited. Wait 30–60 seconds and refresh. On first load, prices fetch in the background.

### "Backend offline" on all pages

Verify: `curl http://localhost:8000/health` — if this times out, the backend didn't start. Check `backend.log`.

---

## CSV Import Format (Portfolios)

```csv
Ticker,Exchange,Quantity,AvgCost,Currency
RELIANCE,NSE,10,2500.00,INR
TCS,NSE,5,3800.00,INR
AAPL,NASDAQ,3,175.50,USD
MSFT,NASDAQ,2,380.00,USD
```

Click **Import CSV** inside any portfolio to upload. Shows a preview before importing.

---

## Project Structure

```
market-cockpit/
├── start_local.sh      ← One-click local startup (no Docker)
├── start.sh            ← Docker Compose startup
├── stop_local.sh       ← Stop local services
├── .env                ← Your config (auto-created on first run)
├── backend/
│   ├── app/
│   │   ├── api/v1/     ← FastAPI routers
│   │   ├── core/       ← DB, Redis, config, security, db_types
│   │   ├── models/     ← SQLAlchemy ORM models (SQLite + PG compatible)
│   │   ├── schemas/    ← Pydantic v2 schemas
│   │   └── services/   ← Market data, news ingestion, AI summarizer
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/        ← Next.js 14 App Router pages
        ├── components/ ← UI components (GlobalSearch, MarketHours, etc.)
        └── lib/        ← Axios API client, utilities
```

---

## API Documentation

With the backend running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **Health check**: http://localhost:8000/health

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| State management | TanStack Query v5 |
| Backend | FastAPI, Python 3.10+ |
| Database | SQLite (dev) / PostgreSQL (prod) |
| ORM | SQLAlchemy 2.0 async |
| Market data | yfinance |
| AI | Anthropic Claude |
| Cache/PubSub | Redis (optional) |
| Auth | JWT (python-jose + bcrypt) |

