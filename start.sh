#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║          Market Cockpit — One-Click Launcher             ║
# ║          Mac / Linux                                     ║
# ╚══════════════════════════════════════════════════════════╝

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     📈  Market Cockpit  Starting…        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Check Docker ──────────────────────────────────────────────────────
echo -e "${YELLOW}[1/5]${NC} Checking Docker…"
if ! command -v docker &> /dev/null; then
    echo ""
    echo -e "${RED}✗ Docker is not installed.${NC}"
    echo ""
    echo "  Please install Docker Desktop first:"
    echo "  👉  https://www.docker.com/products/docker-desktop/"
    echo ""
    echo "  After installing, restart your computer and run this script again."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo ""
    echo -e "${RED}✗ Docker is installed but not running.${NC}"
    echo ""
    echo "  Please open Docker Desktop and wait for it to start (whale icon in menu bar),"
    echo "  then run this script again."
    echo ""
    # Try to auto-open Docker Desktop on Mac
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  Trying to open Docker Desktop for you…"
        open -a Docker 2>/dev/null || true
    fi
    exit 1
fi

echo -e "${GREEN}  ✓ Docker is running${NC}"

# ── Step 2: Check env file ────────────────────────────────────────────────────
echo -e "${YELLOW}[2/5]${NC} Checking configuration…"
cd "$SCRIPT_DIR"

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}  ✓ Created .env from template${NC}"
    else
        # Create a minimal .env
        cat > .env << 'ENVEOF'
# Market Cockpit Environment
POSTGRES_DB=marketcockpit
POSTGRES_USER=mcuser
POSTGRES_PASSWORD=mcpassword123
DATABASE_URL=postgresql+asyncpg://mcuser:mcpassword123@postgres:5432/marketcockpit
REDIS_URL=redis://redis:6379/0
SECRET_KEY=change-me-in-production-use-openssl-rand-hex-32
ANTHROPIC_API_KEY=your-anthropic-api-key-here
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ENVEOF
        echo -e "${GREEN}  ✓ Created default .env configuration${NC}"
        echo ""
        echo -e "${YELLOW}  ⚠  Optional: Add your Anthropic API key to .env for AI features${NC}"
        echo "     Open .env in any text editor and set ANTHROPIC_API_KEY"
        echo ""
        sleep 2
    fi
else
    echo -e "${GREEN}  ✓ Configuration found${NC}"
fi

# ── Step 3: Pull / build images ───────────────────────────────────────────────
echo -e "${YELLOW}[3/5]${NC} Building Market Cockpit (first run takes ~3-5 minutes)…"
docker compose pull --quiet 2>/dev/null || true
docker compose build --quiet

echo -e "${GREEN}  ✓ Build complete${NC}"

# ── Step 4: Start services ────────────────────────────────────────────────────
echo -e "${YELLOW}[4/5]${NC} Starting all services…"
docker compose up -d --remove-orphans

echo -e "${GREEN}  ✓ Services started${NC}"

# ── Step 5: Wait for backend health ──────────────────────────────────────────
echo -e "${YELLOW}[5/5]${NC} Waiting for Market Cockpit to be ready…"
MAX_WAIT=90
WAIT=0
printf "  Waiting"
while [ $WAIT -lt $MAX_WAIT ]; do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        break
    fi
    printf "."
    sleep 3
    WAIT=$((WAIT + 3))
done
echo ""

if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Backend is ready${NC}"
else
    echo -e "${YELLOW}  ⚠ Backend is still starting (this is normal on first run)${NC}"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🚀  Market Cockpit is LIVE!            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  📊  Open your browser:  ${BLUE}http://localhost:3000${NC}"
echo ""
echo -e "  To stop:  ${YELLOW}./stop.sh${NC}"
echo -e "  Logs:     ${YELLOW}docker compose logs -f${NC}"
echo ""

# Auto-open browser on Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
    sleep 2
    open "http://localhost:3000" 2>/dev/null || true
fi

# Auto-open browser on Linux (if DISPLAY available)
if [[ "$OSTYPE" == "linux-gnu"* ]] && [ -n "${DISPLAY:-}" ]; then
    sleep 2
    xdg-open "http://localhost:3000" 2>/dev/null || true
fi
