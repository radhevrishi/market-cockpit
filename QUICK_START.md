# 📈 Market Cockpit — Quick Start Guide

> Your personal Bloomberg-lite for India + US equity investing.
> No coding required. Everything runs with one click.

---

## What You'll Need

| Requirement | Why | Download |
|---|---|---|
| **Docker Desktop** | Runs everything automatically | [docker.com](https://www.docker.com/products/docker-desktop/) |
| **Anthropic API Key** | Powers the AI briefs & chat (optional) | [console.anthropic.com](https://console.anthropic.com/) |

---

## Step 1 — Install Docker Desktop

1. Go to **https://www.docker.com/products/docker-desktop/**
2. Click **Download for Mac / Windows**
3. Install it like any other app
4. Open **Docker Desktop** — wait until you see **"Docker Desktop is running"** (the whale icon)

> ⚠️ Docker must be open in the background every time you use Market Cockpit.

---

## Step 2 — Set Up Market Cockpit (First Time Only)

### On Mac:

1. Open the **market-cockpit** folder
2. Right-click on **`start.sh`** → Open With → **Terminal**
3. If asked "This is an app downloaded from the internet", click **Open**

### On Windows:

1. Open the **market-cockpit** folder
2. Double-click **`start.bat`**
3. If Windows shows a security warning, click **"More info"** → **"Run anyway"**

**First run takes 3–5 minutes** as it downloads and builds everything.
You'll see progress messages — just wait until your browser opens automatically.

---

## Step 3 — Open Market Cockpit

Your browser will open automatically at:

```
http://localhost:3000
```

**Create your account** on the login page — this is stored locally on your computer.

---

## Step 4 — Add Your API Key (For AI Features)

If you want to use the **AI Desk** (morning briefs, stock analysis, AI chat):

1. Go to **https://console.anthropic.com/** and get your API key
2. Open the file **`.env`** in the market-cockpit folder (use Notepad or TextEdit)
3. Find the line: `ANTHROPIC_API_KEY=your-anthropic-api-key-here`
4. Replace `your-anthropic-api-key-here` with your actual key
5. **Restart** Market Cockpit (run `stop.sh` then `start.sh`)

---

## Daily Use

### Starting Market Cockpit

| Mac | Windows |
|---|---|
| Double-click `start.sh` | Double-click `start.bat` |

Your browser opens automatically at **http://localhost:3000**

### Stopping Market Cockpit

| Mac | Windows |
|---|---|
| Double-click `stop.sh` | Double-click `stop.bat` |

> Your portfolios, watchlists, and alerts are always saved between sessions.

---

## What's Inside

### 🏠 Mission Control (Home)
Your daily command center — portfolio P&L at a glance, must-read headlines, today's events, top movers.

### 📰 News Feed
Live headlines from ET Markets, CNBC, Reuters, MarketWatch. Filter by India/US, importance level, article type. In-Play ticker strip shows who's moving.

### 📅 Calendars
**4 fully live tabs:**
- **Earnings** — Upcoming results grouped by date with EPS estimates
- **Economic** — RBI, Fed, NFP, CPI and more — filterable by India/US
- **Ratings** — Analyst upgrades/downgrades from Goldman, Kotak, Morgan Stanley etc.
- **Dividends** — Ex-date, record date, pay date, yield % for all your holdings

### 💼 Portfolios
Add your NSE/BSE and US positions. Live CMP and P&L update every 60 seconds. Day P&L, total return, and position-level details.

### 🔔 Alerts
Set price move alerts (e.g. "RELIANCE up 5%") and news importance alerts. Get notified in the app the moment they trigger.

### 🤖 AI Desk
- **Morning Brief** — Generated every day at 7:30 AM with key things to watch
- **Evening Brief** — End-of-day summary every day at 5:30 PM
- **AI Chat** — Ask anything: "Why did NVDA drop today?", "Summarise TCS Q1 results"

### 🎯 Themes
Track thematic baskets: AI Infrastructure, Semiconductors, Defense, Nuclear Energy, Space, Grid Tech.

---

## Troubleshooting

### "Docker is not running"
Open Docker Desktop from your Applications / Start Menu and wait for the whale icon to appear, then try again.

### "Port already in use"
Something else is using port 3000 or 8000. Run `stop.sh` first, then start again.

### App won't load / spinning forever
1. Run `stop.sh`
2. Run `start.sh` again
3. Wait the full 3–5 minutes on first run

### AI features not working
Make sure your Anthropic API key is set in the `.env` file (see Step 4 above).

### Check what's happening (advanced)
Open Terminal / Command Prompt in the market-cockpit folder and type:
```
docker compose logs -f
```
This shows live logs. Press Ctrl+C to exit.

---

## Updating Market Cockpit

When a new version is available:
1. Replace the market-cockpit folder with the new version
2. Run `start.sh` — it rebuilds automatically

---

## Privacy & Data

- **Everything runs on your own computer** — no data is sent anywhere except:
  - yfinance (Yahoo Finance) for stock prices — anonymous
  - Anthropic API for AI features — only when you use AI Desk
- Your portfolio data never leaves your machine
- No subscription, no cloud account required

---

*Built with FastAPI · Next.js · PostgreSQL · Redis · Claude AI*
