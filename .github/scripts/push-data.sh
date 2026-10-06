#!/usr/bin/env bash
# zzz908 — commit + push a job's GENERATED data folder(s) without ever getting stuck in a rebase.
#
# Usage: .github/scripts/push-data.sh "<commit message>" <path> [<path> ...]
#
# Why: screener-sync failed on 28 Sep 2026 with "push failed after 5 attempts". Another commit touched the
# same generated file (frontend/public/data/screener/manifest.json) first; `git pull --rebase` stopped on a
# content conflict and every later attempt failed with "You are not currently on a branch".
#
# How: the folders passed here are written ONLY by this job, so this run's snapshot is the truth. On a
# rejected push we abort any rebase, reset to the latest origin/main, put this run's version of exactly
# these folders back on top, and commit again. Nothing outside the given paths is touched. If main
# already holds identical data, there is nothing to push and the step succeeds.
set -uo pipefail

MSG="${1:?commit message required}"; shift
[ "$#" -gt 0 ] || { echo "::error::push-data.sh: no paths given"; exit 2; }
PATHS=("$@")

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add -A -- "${PATHS[@]}"
if git diff --staged --quiet; then echo "No changes."; exit 0; fi
git commit -q -m "$MSG"
OURS=$(git rev-parse HEAD)

for i in 1 2 3 4 5 6; do
  if git push -q origin HEAD:main; then echo "push succeeded on attempt $i"; exit 0; fi
  echo "push attempt $i rejected — re-applying this run's files on top of the latest main"
  sleep $(( i * 3 + RANDOM % 4 ))
  git rebase --abort >/dev/null 2>&1 || true
  git merge --abort >/dev/null 2>&1 || true
  if ! git fetch -q origin main; then echo "fetch failed (attempt $i)"; continue; fi
  git reset -q --hard FETCH_HEAD
  for p in "${PATHS[@]}"; do
    rm -rf -- "$p"
    # restore this run's version; a path this run removed stays removed
    git checkout "$OURS" -- "$p" 2>/dev/null || true
  done
  git add -A -- "${PATHS[@]}"
  if git diff --staged --quiet; then echo "main already has this data — nothing to push"; exit 0; fi
  git commit -q -m "$MSG"
done
echo "::error title=Push failed::could not push after 6 attempts (GitHub unavailable or branch protected)"
exit 1
