# Secure your existing indiaearninghub Worker

Add a 6-line token check WITHOUT breaking any existing endpoints
(`/stock`, `/batch`, `/debug`, `/health`).

## Step 1 — Pick a random token

In your terminal:
```bash
openssl rand -hex 32
```
This prints a 64-char hex string. Copy it. Example:
`8f3a2c1b4d5e6f7890abcdef1234567890fedcba9876543210abcdef12345678`

## Step 2 — Add the token as a Worker secret

In the Cloudflare dashboard:

1. Go to **Workers & Pages → indiaearninghub → Settings → Variables**
2. Click **+ Add** under "Encrypted variables (secrets)"
3. Name: `SHARED_TOKEN`
4. Value: paste your token from Step 1
5. Click **Save**

## Step 3 — Add the auth gate to your Worker code

In the Cloudflare dashboard:

1. Go to **Workers & Pages → indiaearninghub → Edit code** (the </> icon)
2. Find your existing `export default { async fetch(request, env) { ... } }` block
3. At the VERY TOP of the fetch handler — before any other code — paste:

```javascript
    // ─── PATCH 0520: Token check (skip /health for monitoring) ───
    const url = new URL(request.url);
    if (env.SHARED_TOKEN && url.pathname !== '/health' && url.pathname !== '/') {
      const provided =
        request.headers.get('X-MC-Token') ||
        url.searchParams.get('token') ||
        '';
      if (provided !== env.SHARED_TOKEN) {
        return new Response(
          JSON.stringify({ error: 'unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
```

So the final structure should look like:

```javascript
export default {
  async fetch(request, env, ctx) {
    // ─── Token check ───
    const url = new URL(request.url);
    if (env.SHARED_TOKEN && url.pathname !== '/health' && url.pathname !== '/') {
      const provided =
        request.headers.get('X-MC-Token') ||
        url.searchParams.get('token') ||
        '';
      if (provided !== env.SHARED_TOKEN) {
        return new Response(
          JSON.stringify({ error: 'unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── ALL YOUR EXISTING CODE STAYS BELOW THIS LINE ───
    // (the existing /stock, /batch, /debug, /health handlers)
    ...
  }
}
```

4. Click **Save and Deploy**

## Step 4 — Add the token to Vercel

1. Go to your Vercel project → **Settings → Environment Variables**
2. Add a new variable:
   - Key: `WORKER_TOKEN`
   - Value: same token from Step 1
   - Scope: Production, Preview, Development
3. Click **Save**
4. Click **Deployments → latest → Redeploy** (env changes need rebuild)

## Step 5 — Verify

```bash
# Should still work (Vercel calls with token via header) ✓
# /health stays open as monitoring endpoint:
curl https://indiaearninghub.radhev-232.workers.dev/health

# Without token — should now 401 ✓
curl "https://indiaearninghub.radhev-232.workers.dev/stock?symbol=RELIANCE"
# → {"error":"unauthorized"}

# With token via query param — should work ✓
curl "https://indiaearninghub.radhev-232.workers.dev/stock?symbol=RELIANCE&token=YOUR-TOKEN"

# With token via header — should work ✓
curl -H "X-MC-Token: YOUR-TOKEN" \
  "https://indiaearninghub.radhev-232.workers.dev/stock?symbol=RELIANCE"
```

## Safe-by-default fallback

If you forget to add `SHARED_TOKEN` env on the Worker side, the check is
skipped (`env.SHARED_TOKEN` is undefined, falsy → branch never enters).
So you can:

- Roll out client-side first (Patch 0520 already shipped) → token sent
  but Worker doesn't check → everything still works
- Roll out Worker secret + code change second → Worker now enforces

No flag day, no downtime.

## Reverting

If anything breaks: just delete the `SHARED_TOKEN` env var on the Worker
side. Without that env, the gate is bypassed and old behavior resumes.
