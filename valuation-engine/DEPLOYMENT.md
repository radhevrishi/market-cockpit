# Deployment Guide

## Local

```bash
cd valuation-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Open `http://localhost:8501` in your browser.

## Streamlit Community Cloud (Free)

1. Push this `valuation-engine/` folder to a GitHub repo (or commit it as a sub-folder of your existing repo).
2. Visit https://share.streamlit.io
3. Click **New app** → select your repo, branch, and `valuation-engine/app.py` as the main file.
4. Streamlit Cloud auto-installs from `requirements.txt`.
5. Click **Deploy**. App is live at `https://<your-app>.streamlit.app` in ~2 min.

### Streamlit secrets (optional)

If you later add API integrations (FMP, Yahoo, etc.), add keys via the Streamlit Cloud dashboard:
**App settings → Secrets** → paste TOML:

```toml
FMP_API_KEY = "your-fmp-key"
ALPHAVANTAGE_API_KEY = "your-av-key"
```

Access in code via `st.secrets['FMP_API_KEY']`.

## Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8501
HEALTHCHECK CMD curl --fail http://localhost:8501/_stcore/health
CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]
```

Build and run:

```bash
docker build -t valuation-engine .
docker run -p 8501:8501 valuation-engine
```

## Render / Railway / Fly.io

Any platform that supports Python + ports works. Set start command:

```
streamlit run app.py --server.port=$PORT --server.address=0.0.0.0
```

## Performance notes

- Monte Carlo runs **2000 trials** by default. With a fast CPU, ~150ms per stock.
- For batch valuation of 100+ stocks, use the CSV upload mode in the Inputs tab.
- All computation is in-memory, no external API calls — fully offline-capable.

## Embedding in Market Cockpit (Next.js)

The Streamlit app can be embedded in the existing Next.js app via iframe:

```tsx
<iframe
  src="https://your-valuation-engine.streamlit.app/?embed=true"
  width="100%"
  height="900"
  style={{ border: 'none' }}
/>
```

Or run the Streamlit app locally and reverse-proxy it via your Next.js routes.
