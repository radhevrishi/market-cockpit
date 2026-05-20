# Market Cockpit — Cloudflare Worker Proxy

Bypasses Screener.in / NSE Cloudflare blocks on Vercel egress IPs by
proxying through a Cloudflare Worker (which Screener trusts because
it runs on the same network).

## One-time setup (5 min)

```bash
# 1. Install wrangler (Cloudflare's CLI)
npm install -g wrangler

# 2. Log into your Cloudflare account (opens browser)
wrangler login

# 3. Deploy the worker from this directory
cd cloudflare-worker
wrangler deploy

# Output will look like:
#   Published mc-proxy
#   https://mc-proxy.YOUR-SUBDOMAIN.workers.dev

# 4. Pick a random 32-char secret and set it
#    (use https://generate-secret.now.sh/32 or `openssl rand -hex 32`)
wrangler secret put PROXY_SECRET
# Paste your secret when prompted, press Enter

# 5. Verify it works (replace YOUR-WORKER-URL and YOUR-SECRET)
curl "https://YOUR-WORKER-URL.workers.dev/proxy?url=https://www.screener.in/company/RELIANCE/consolidated/&secret=YOUR-SECRET" \
  | head -c 200
# Should return Screener HTML, not 403/blocked
```

## Vercel env vars to set

Once you have the Worker URL, set these in your Vercel project settings
(Settings → Environment Variables):

| Key | Value |
|---|---|
| `PROXY_URL` | `https://mc-proxy.YOUR-SUBDOMAIN.workers.dev` |
| `PROXY_SECRET` | (the secret you set via `wrangler secret put`) |

Redeploy the Vercel project (env changes need a rebuild).

## Whitelisted hosts

The worker only proxies these hosts (prevents abuse as open proxy):

- `screener.in` / `www.screener.in` — Indian fundamentals
- `nseindia.com` / `www.nseindia.com` — NSE filings
- `bseindia.com` / `www.bseindia.com` / `api.bseindia.com` — BSE filings
- `trendlyne.com` — future-proofing
- `query1.finance.yahoo.com` / `query2.finance.yahoo.com` — Yahoo

Edit `proxy.js` ALLOWED_HOSTS array to add more.

## Cost

Free plan: 100k requests/day, 10ms CPU per request. Way more than we
need (typical EO refresh = ~60 enrich requests).

## Security

- Shared secret check on every request
- Whitelisted hosts only
- No KV storage of payloads
- CORS headers set defensively
