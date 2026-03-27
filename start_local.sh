#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║   Market Cockpit — Local Dev Starter (no Docker required)   ║
# ╚══════════════════════════════════════════════════════════════╝
set -euo pipefail

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
PIDS_FILE="$SCRIPT_DIR/.local_pids"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   📈  Market Cockpit  Local Dev Mode     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping services...${NC}"
    if [ -f "$PIDS_FILE" ]; then
        while IFS= read -r pid; do
            kill "$pid" 2>/dev/null || true
        done < "$PIDS_FILE"
        rm -f "$PIDS_FILE"
    fi
    echo -e "${GREEN}Stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Prerequisites check ───────────────────────────────────────────────────────
echo -e "${YELLOW}[1/5]${NC} Checking prerequisites..."
for cmd in python3 node npm; do
    if ! command -v "$cmd" &>/dev/null; then
        echo -e "${RED}✗ $cmd is not installed. Please install it first.${NC}"; exit 1
    fi
done
PYTHON="$(command -v python3)"
PY_VERSION=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo -e "${GREEN}  ✓ Python $PY_VERSION, Node $(node --version)${NC}"

# ── .env setup ────────────────────────────────────────────────────────────────
echo -e "${YELLOW}[2/5]${NC} Checking configuration..."
cd "$SCRIPT_DIR"
if [ ! -f ".env" ]; then
    cat > .env << 'ENVEOF'
# Market Cockpit — Local Development Config
# Uses SQLite by default (no PostgreSQL required)
# Uses in-memory fallback if Redis is not running

DATABASE_URL=sqlite+aiosqlite:///./market_cockpit.db
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=local-dev-secret-key-change-in-production-32chars
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=43200
ANTHROPIC_API_KEY=
ALPHA_VANTAGE_KEY=
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ENVIRONMENT=development
ENVEOF
    echo -e "${GREEN}  ✓ Created .env with SQLite defaults${NC}"
    echo -e "${YELLOW}  ⚠  Optional: Add ANTHROPIC_API_KEY to .env for AI features${NC}"
else
    # Ensure SQLite default if no DATABASE_URL set
    if ! grep -q "^DATABASE_URL=" .env; then
        echo "DATABASE_URL=sqlite+aiosqlite:///./market_cockpit.db" >> .env
    fi
    echo -e "${GREEN}  ✓ Using existing .env${NC}"
fi

# Copy .env to backend dir so uvicorn can find it
cp .env "$BACKEND_DIR/.env" 2>/dev/null || true

# ── Backend dependencies ───────────────────────────────────────────────────────
echo -e "${YELLOW}[3/5]${NC} Installing backend dependencies..."
cd "$BACKEND_DIR"

# Remove old venv if Python version changed (avoids stale package issues)
if [ -d ".venv" ]; then
    VENV_PY=$(.venv/bin/python3 --version 2>/dev/null || echo "none")
    SYSTEM_PY=$("$PYTHON" --version 2>/dev/null || echo "other")
    if [ "$VENV_PY" != "$SYSTEM_PY" ]; then
        echo "  Python version changed ($VENV_PY → $SYSTEM_PY), recreating venv..."
        rm -rf .venv
    fi
fi
if [ ! -d ".venv" ]; then
    echo "  Creating virtual environment..."
    "$PYTHON" -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt 2>&1 | grep -v "already satisfied" | head -5
echo -e "${GREEN}  ✓ Backend dependencies ready${NC}"

# Remove old SQLite DB if it exists (fresh start — schema may have changed)
if [ -f "$BACKEND_DIR/market_cockpit.db" ]; then
    echo -e "${YELLOW}  ↻ Resetting database for fresh start...${NC}"
    rm -f "$BACKEND_DIR/market_cockpit.db" 2>/dev/null || true
fi

# ── Frontend dependencies ──────────────────────────────────────────────────────
echo -e "${YELLOW}[4/5]${NC} Installing frontend dependencies..."
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    npm install --legacy-peer-deps --silent
fi
# Ensure .env.local exists with correct API URL
if [ ! -f ".env.local" ]; then
    echo "NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1" > .env.local
fi
echo -e "${GREEN}  ✓ Frontend dependencies ready${NC}"

# ── Start services ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}[5/5]${NC} Starting services..."
> "$PIDS_FILE"

# Start backend
cd "$BACKEND_DIR"
source .venv/bin/activate
LOG_BACKEND="$SCRIPT_DIR/backend.log"
nohup uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload > "$LOG_BACKEND" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" >> "$PIDS_FILE"
echo -e "${GREEN}  ✓ Backend started (PID $BACKEND_PID) → logs: backend.log${NC}"

# Wait for backend
echo "  Waiting for backend..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

BACKEND_STATUS=$(curl -sf http://localhost:8000/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "timeout")
if [ "$BACKEND_STATUS" = "ok" ] || [ "$BACKEND_STATUS" = "degraded" ]; then
    echo -e "${GREEN}  ✓ Backend is ready (status: $BACKEND_STATUS)${NC}"
else
    echo -e "${RED}  ✗ Backend failed to start. Check backend.log for errors.${NC}"
    echo ""
    echo "  Last 20 lines of backend.log:"
    tail -20 "$LOG_BACKEND" 2>/dev/null || true
    echo ""
    echo -e "${YELLOW}  Note: AI features require ANTHROPIC_API_KEY in .env${NC}"
fi

# Start frontend
cd "$FRONTEND_DIR"
LOG_FRONTEND="$SCRIPT_DIR/frontend.log"
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 nohup npm run dev > "$LOG_FRONTEND" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PIDS_FILE"
echo -e "${GREEN}  ✓ Frontend started (PID $FRONTEND_PID) → logs: frontend.log${NC}"

# Wait for frontend
echo "  Waiting for frontend..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:3000 > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🚀  Market Cockpit is LIVE!            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  📊  Dashboard:    ${BLUE}http://localhost:3000${NC}"
echo -e "  📡  API docs:     ${BLUE}http://localhost:8000/docs${NC}"
echo -e "  🏥  Health:       ${BLUE}http://localhost:8000/health${NC}"
echo ""
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop all services"
echo ""

# Auto-open browser
if [[ "$OSTYPE" == "darwin"* ]]; then
    sleep 2 && open "http://localhost:3000" &
elif [[ "$OSTYPE" == "linux-gnu"* ]] && [ -n "${DISPLAY:-}" ]; then
    sleep 2 && xdg-open "http://localhost:3000" &
fi

# Keep script running (wait for Ctrl+C)
wait
