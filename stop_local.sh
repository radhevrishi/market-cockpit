#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_FILE="$SCRIPT_DIR/.local_pids"
if [ -f "$PIDS_FILE" ]; then
    while IFS= read -r pid; do
        kill "$pid" 2>/dev/null && echo "Stopped PID $pid" || true
    done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
    echo "All services stopped."
else
    # Kill by port as fallback
    for port in 3000 8000; do
        pid=$(lsof -ti:$port 2>/dev/null) && kill $pid 2>/dev/null && echo "Killed process on port $port" || true
    done
fi
