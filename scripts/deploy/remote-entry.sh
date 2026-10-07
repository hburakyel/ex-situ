#!/usr/bin/env bash
# Entry point for automated deploys (installed on the server as the forced
# command of the GitHub Actions deploy key — see docs/DEPLOY.md).
#
# The key can only run this script, and this script only accepts
# "deploy <40-char commit sha>" for a commit that is on origin/main.
set -euo pipefail

REPO_DIR="${EXSITU_REPO_DIR:-/var/www/ex-situ}"
STATE_DIR=/var/lib/exsitu-deploy
LOG_FILE=/var/log/exsitu-deploy.log

read -r cmd sha extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
if [[ "${cmd:-}" != deploy || ! "${sha:-}" =~ ^[0-9a-f]{40}$ || -n "${extra:-}" ]]; then
  echo "usage: deploy <commit sha>" >&2
  exit 2
fi

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -w 1800 9 || { echo "another deploy is still running" >&2; exit 1; }

cd "$REPO_DIR"
git fetch -q origin main
if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "$sha is not on origin/main — refusing to deploy" >&2
  exit 2
fi

# Last commit that deployed successfully (falls back to the checkout).
deployed=$(cat "$STATE_DIR/deployed-sha" 2>/dev/null || git rev-parse HEAD)

# Never move backwards: re-running an old workflow must not roll the site back.
if [[ "$deployed" != "$sha" ]] && git merge-base --is-ancestor "$sha" "$deployed" 2>/dev/null; then
  echo "already deployed a newer commit (${deployed:0:7}); nothing to do"
  exit 0
fi

git reset -q --hard "$sha"
set +e
bash scripts/deploy/deploy.sh "$deployed" "$sha" 2>&1 | tee -a "$LOG_FILE"
status=${PIPESTATUS[0]}
set -e
if [[ $status -eq 0 ]]; then
  echo "$sha" > "$STATE_DIR/deployed-sha"
fi
exit "$status"
