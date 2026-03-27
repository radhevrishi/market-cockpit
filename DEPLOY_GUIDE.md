# Market Cockpit — Free Deployment Guide

## Architecture

```
User → Vercel (frontend) → Render (backend API) → Neon (PostgreSQL)
```

| Component | Platform | Plan | URL Pattern |
|-----------|----------|------|-------------|
| Frontend (Next.js) | Vercel | Free | market-cockpit.vercel.app |
| Backend (FastAPI) | Render | Free | market-cockpit-api.onrender.com |
| Database (PostgreSQL) | Neon | Free | ep-xxx.us-east-2.aws.neon.tech |

---

## STEP 1: Create Neon PostgreSQL Database (2 min)

1. Go to **https://neon.tech** → Click **Sign Up** → Sign in with GitHub
2. Click **Create Project**
   - Project name: `market-cockpit`
   - Region: `US East (Ohio)` (closest to Render Oregon)
   - Click **Create Project**
3. On the dashboard, you'll see a **Connection string**. Copy it. It looks like:
   ```
   postgresql://neondb_owner:AbCdEf123@ep-cool-name-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. **Convert it for async Python** — change `postgresql://` to `postgresql+asyncpg://`:
   ```
   postgresql+asyncpg://neondb_owner:AbCdEf123@ep-cool-name-12345.us-east-2.aws.neon.tech/neondb?ssl=require
   ```
   ⚠️ Also change `sslmode=require` to `ssl=require` (asyncpg uses different param name)

Save this — you'll need it in Step 3.

---

## STEP 2: Push Code to GitHub (3 min)

Open Terminal in the `market-cockpit` folder and run:

```bash
cd market-cockpit

git init
git add .
git commit -m "Initial commit — Market Cockpit v1.0"

# Create repo on GitHub (pick ONE method):

# Method A: Using GitHub CLI (if installed)
gh repo create market-cockpit --public --source=. --push

# Method B: Manual
# 1. Go to github.com → New Repository → name: market-cockpit → Create
# 2. Then run:
git remote add origin https://github.com/YOUR_USERNAME/market-cockpit.git
git branch -M main
git push -u origin main
```

---

## STEP 3: Deploy Backend on Render (5 min)

1. Go to **https://render.com** → Sign in with GitHub
2. Click **New** → **Web Service**
3. Connect your **market-cockpit** GitHub repo
4. Configure:
   - **Name**: `market-cockpit-api`
   - **Region**: Oregon (US West)
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: **Free**

5. Click **Environment** → Add these variables:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | `postgresql+asyncpg://neondb_owner:YOUR_PASSWORD@ep-xxx.us-east-2.aws.neon.tech/neondb?ssl=require` |
   | `SECRET_KEY` | (click Generate — Render makes a random one) |
   | `ENVIRONMENT` | `production` |
   | `ANTHROPIC_API_KEY` | `sk-ant-api03-...` (your key from .env) |
   | `ALPHA_VANTAGE_KEY` | `62EKUKC2M5WSZB9Z` |
   | `CORS_ORIGINS` | `["https://market-cockpit.vercel.app"]` |

6. Click **Create Web Service**
7. Wait for build (~3-5 min). Once deployed, test: `https://market-cockpit-api.onrender.com/health`

⚠️ **Note**: Render free tier sleeps after 15 min of inactivity. First request after sleep takes ~30s to wake up. This is normal.

---

## STEP 4: Update vercel.json with Render URL (1 min)

After Render deploys, your backend URL will be something like:
`https://market-cockpit-api.onrender.com`

Open `frontend/vercel.json` and make sure the destination URL matches your actual Render URL:

```json
{
  "rewrites": [
    {
      "source": "/api/v1/:path*",
      "destination": "https://market-cockpit-api.onrender.com/api/v1/:path*"
    }
  ]
}
```

Commit and push:
```bash
git add frontend/vercel.json
git commit -m "Update vercel.json with production backend URL"
git push
```

---

## STEP 5: Deploy Frontend on Vercel (3 min)

1. Go to **https://vercel.com** → Sign in with GitHub
2. Click **Add New** → **Project**
3. Import your **market-cockpit** repo
4. Configure:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: Click **Edit** → type `frontend` → click **Continue**
   - **Build Command**: (leave default: `next build`)
   - **Output Directory**: (leave default)

5. Click **Environment Variables** → Add:

   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_API_URL` | `/api/v1` |

6. Click **Deploy**
7. Wait ~2 min. Your site is live at: `https://market-cockpit.vercel.app`

---

## STEP 6: Update CORS with Final Vercel URL (1 min)

If Vercel gave you a different URL (e.g., `market-cockpit-xyz.vercel.app`):

1. Go to **Render Dashboard** → Your service → **Environment**
2. Update `CORS_ORIGINS` to: `["https://YOUR-ACTUAL-VERCEL-URL.vercel.app"]`
3. Click **Save Changes** (Render auto-redeploys)

---

## STEP 7: Test Everything

1. Open your Vercel URL in browser
2. Register a new account
3. Check the News tab — should load articles after ~30s (backend wakes up + ingests)
4. Check Health: `https://market-cockpit-api.onrender.com/health`

---

## Troubleshooting

### "Loading..." forever on first visit
Render free tier was asleep. Wait 30 seconds and refresh. The backend is booting up.

### CORS errors in browser console
Update `CORS_ORIGINS` on Render to match your exact Vercel URL (with https://).

### Database errors
Check your `DATABASE_URL` on Render — make sure it starts with `postgresql+asyncpg://` and ends with `?ssl=require` (not `sslmode=require`).

### Build fails on Render
Check the build logs. Most common issue: missing dependency. The `requirements.txt` already includes `asyncpg` for PostgreSQL.

### Build fails on Vercel
Make sure **Root Directory** is set to `frontend`. Check that `package.json` exists in that folder.

---

## Free Tier Limits

| Platform | Limit | Impact |
|----------|-------|--------|
| Vercel | 100 GB bandwidth/month | More than enough for personal use |
| Render | Sleeps after 15 min idle | ~30s cold start on first request |
| Neon | 0.5 GB storage, 190 compute hours/month | Plenty for news articles + user data |

---

## Custom Domain (Optional)

### Vercel:
Settings → Domains → Add your domain → Update DNS

### Render:
Settings → Custom Domains → Add domain → Update DNS

If you add a custom domain, update `CORS_ORIGINS` on Render to include it.
