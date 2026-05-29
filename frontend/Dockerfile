# Production Dockerfile for Next.js 14 frontend
# Replaces dev-mode Dockerfile. Uses npm install (no lockfile required).
FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --no-audit --no-fund --legacy-peer-deps

# Copy source
COPY . .

# Build Next.js for production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
CMD ["npm", "run", "start"]
