#!/usr/bin/env bash
# Deploys the checked-out commit on the server, given the previously deployed
# commit and the new one; only the parts that changed are redeployed, backend
# first (the frontend build prerenders from the API). Usage, from the repo root:
#
#   old=$(git rev-parse HEAD) && git fetch origin main && git reset --hard origin/main \
#     && bash scripts/deploy/deploy.sh "$old" "$(git rev-parse HEAD)"
#
#   backend changed  → database backup, npm ci if deps changed, restart Strapi,
#                      wait until the map API answers again (~2 min: map views rebuild)
#   frontend changed → build into the inactive of .next-a/.next-b while the site
#                      keeps serving the current build, switch, health check,
#                      switch back if the new build doesn't answer
#
# Never touches data: SQL migrations and ETL scripts stay manual.
set -euo pipefail

OLD="$1"
NEW="$2"
cd "$(dirname "$0")/../.."

BACKUP_DIR=/var/backups/exsitu
KEEP_BACKUPS=7
SITE=http://127.0.0.1:3000
API=http://127.0.0.1:1337

log() { echo "[$(date -u +%FT%TZ)] $*"; }

wait_for() { # url seconds
  local i code
  for ((i = 0; i < $2; i += 5)); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || true)
    [[ $code == 200 ]] && return 0
    sleep 5
  done
  return 1
}

if git cat-file -e "$OLD^{commit}" 2>/dev/null; then
  changed=$(git diff --name-only "$OLD" "$NEW")
else
  changed=$(git ls-files) # unknown previous state: deploy everything
fi
has() { grep -qE "$1" <<<"$changed"; }

backend=false
frontend=false
has '^backend/' && backend=true
has '^frontend/' && frontend=true
log "deploy ${OLD:0:7} → ${NEW:0:7} (backend: $backend, frontend: $frontend)"

if $backend; then
  mkdir -p -m 700 "$BACKUP_DIR"
  db=$(grep -E '^DATABASE_NAME=' backend/.env | cut -d= -f2-)
  backup="$BACKUP_DIR/exsitu-$(date -u +%Y%m%d-%H%M%S)-${NEW:0:7}.dump"
  log "database backup → $backup"
  sudo -u postgres pg_dump -Fc "$db" >"$backup"
  ls -1t "$BACKUP_DIR"/exsitu-*.dump | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

  if has '^backend/package(-lock)?\.json$'; then
    log "backend dependencies changed → npm ci"
    (cd backend && npm ci)
  fi
  if has '^backend/src/admin/'; then
    # strapi start serves the prebuilt admin panel (backend/build); rebuild it so
    # admin pages (Geo Correction, Review) match the code. The site keeps running.
    log "admin panel changed → strapi build"
    (cd backend && npm run build >/dev/null)
  fi
  log "restarting backend (map API is unavailable while the map views rebuild)"
  pm2 restart exsitu-backend >/dev/null
  if ! wait_for "$API/api/museum-objects/geospatial?zoom=2" 600; then
    log "ERROR: backend did not answer within 10 minutes — check: pm2 logs exsitu-backend"
    exit 1
  fi
  log "backend is up"
fi

if $frontend; then
  cd frontend
  current=$(pm2 jlist | python3 -c '
import json, sys
p = [x for x in json.load(sys.stdin) if x["name"] == "exsitu-frontend"][0]
print(p["pm2_env"].get("NEXT_DIST_DIR") or ".next")')
  next=.next-a
  [[ $current == .next-a ]] && next=.next-b

  if has '^frontend/(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$'; then
    log "frontend dependencies changed → pnpm install"
    pnpm install --frozen-lockfile
  fi
  log "building frontend into $next (site keeps serving $current)"
  rm -rf "$next"
  NEXT_DIST_DIR=$next pnpm build

  NEXT_DIST_DIR=$next pm2 restart exsitu-frontend --update-env >/dev/null
  if ! wait_for "$SITE/map" 120; then
    log "ERROR: new frontend build does not answer — switching back to $current"
    NEXT_DIST_DIR=$current pm2 restart exsitu-frontend --update-env >/dev/null
    exit 1
  fi
  pm2 save >/dev/null
  log "frontend is up on $next"
  cd ..
fi

log "deploy finished"
