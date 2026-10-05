#!/usr/bin/env bash
# Market Cockpit — one-command deploy of the newest update zip (Desktop or Downloads).
# Usage:  bash ~/market-cockpit/.github/scripts/mc-deploy.sh "short message"
# Safe by design: refuses to run if the repo has unrelated uncommitted work, scans the update for secrets, never force-pushes.
set -euo pipefail
REPO="${MC_REPO:-$HOME/market-cockpit}"
MSG="${1:-update from Claude}"
cd "$REPO"
Z=$(ls -t ~/Downloads/market-cockpit-update*.zip ~/Desktop/market-cockpit-update*.zip 2>/dev/null | head -1 || true)
[ -n "$Z" ] || { echo "No market-cockpit-update*.zip found on Desktop or Downloads."; exit 1; }
echo "using $Z"
git diff --quiet && git diff --cached --quiet || { echo "Your repo has uncommitted changes. Commit or stash them first."; exit 1; }
git checkout main >/dev/null 2>&1 || true
git pull --rebase origin main
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
unzip -q "$Z" -d "$T"
SRC="$T/market-cockpit-update"
[ -d "$SRC/frontend" ] || { echo "The zip has no frontend folder; stopping."; exit 1; }
# secret scan on the incoming files (patterns only; nothing is printed except the file name)
if grep -rIlE "sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}" "$SRC" >/tmp/mc-secret-hits 2>/dev/null && [ -s /tmp/mc-secret-hits ]; then
  echo "STOP: possible secret found in:"; cat /tmp/mc-secret-hits; exit 1
fi
cp -R "$SRC/frontend" .
[ -d "$SRC/.github" ] && cp -R "$SRC/.github" .
git add -A
if git diff --cached --quiet; then echo "Nothing new in this zip (already deployed)."; exit 0; fi
git commit -m "$MSG"
git pull --rebase origin main
git push origin main
echo "Pushed. Railway builds from main automatically (about 3-5 minutes). Then hard-refresh the site."
