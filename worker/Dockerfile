# syntax=docker/dockerfile:1.7
# Market Cockpit earnings worker — Playwright + persistent cookie jar
# Deploy to: Hetzner / Railway / Render / fly.io
# DO NOT deploy to Vercel — this needs a long-lived process.

FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS base
WORKDIR /app

# Cache deps separately
COPY package.json tsconfig.json ./
RUN npm install --omit=dev --no-fund --no-audit \
 && npm install --no-save tsx typescript

COPY src ./src

# Persistent state directory for cookie jar across container restarts.
# Mount /var/lib/mc-worker as a volume in production:
#   docker run -v mc-worker-data:/var/lib/mc-worker ...
RUN mkdir -p /var/lib/mc-worker
ENV STATE_DIR=/var/lib/mc-worker

ENV NODE_ENV=production
ENV TZ=Asia/Kolkata

# Healthcheck endpoint — bash-readable file the orchestrator can curl/cat
HEALTHCHECK --interval=5m --timeout=10s --start-period=2m --retries=3 \
  CMD test -f /var/lib/mc-worker/last_ok && \
      [ $(($(date +%s) - $(stat -c %Y /var/lib/mc-worker/last_ok))) -lt 7200 ] || exit 1

# Default: continuous loop (30-min cadence configurable via SCRAPE_INTERVAL_MIN env)
CMD ["npx", "tsx", "src/scrape-runner.ts", "--mode", "loop"]
