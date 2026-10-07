# Production Dockerfile for the current Next.js frontend.
# zzz882: Node 20 reached end of life on 30 Apr 2026 (no security fixes); package.json engines already says 22.x
FROM node:22-alpine
WORKDIR /app/frontend

# Install dependencies
# zzz882: the lockfile is copied too, so every build installs the same tested versions
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# Copy source
COPY frontend/ ./
COPY .github/ /app/.github/
COPY workers/ /app/workers/

# zzz955 — Railway passes its build variables to a declared ARG: keep the git commit so the running app can say which
# commit it is (shown by /api/v1/system-status → build). Empty when built elsewhere.
ARG RAILWAY_GIT_COMMIT_SHA=""
ENV MC_BUILD_COMMIT=$RAILWAY_GIT_COMMIT_SHA

# Build Next.js for production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run verify

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
# zzz855 — run the custom server (server.js: Next + br/gzip compression)
# directly as PID 1 so Railway's SIGTERM reaches it and in-flight requests
# finish. Same thing `npm run start` runs; npm -> sh -> node does not pass
# SIGTERM on to node.
CMD ["node", "server.js"]
