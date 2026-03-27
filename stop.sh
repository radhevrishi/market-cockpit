#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║          Market Cockpit — Stop                           ║
# ╚══════════════════════════════════════════════════════════╝

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${BLUE}Stopping Market Cockpit…${NC}"
echo ""

if ! command -v docker &> /dev/null || ! docker info &> /dev/null; then
    echo -e "${YELLOW}Docker is not running — nothing to stop.${NC}"
    exit 0
fi

docker compose down --remove-orphans

echo ""
echo -e "${GREEN}✓ Market Cockpit stopped.${NC}"
echo ""
echo "  Your data is saved. Run ${YELLOW}./start.sh${NC} to start again."
echo ""
