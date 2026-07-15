#!/usr/bin/env bash
# portal-lib.sh — shared helpers for the portal auto-sync system.
# Sourced by portal-autodeploy.sh, portal-golive.sh, portal-drift-check.sh.
# Config: /etc/portal-sync.conf. GitHub `main` is the single source of truth.

CONF=/etc/portal-sync.conf
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

: "${PORTAL_DIR:=/opt/krawings-portal}"
: "${PORTAL_ENV:=unknown}"
: "${PORTAL_PORT:=3000}"
: "${PORTAL_SERVICE:=krawings-portal}"
: "${HEALTH_PATH:=/kiosk}"
: "${VAULT_DIR:=/opt/obsidian-vault}"
: "${BACKUP_KEEP:=10}"
: "${MIN_FREE_MB:=800}"

STATE_DIR=/var/lib/portal-sync
DEPLOY_LOCK=/var/lock/portal-deploy.lock   # shared by autodeploy + golive
FAILED_SHA_FILE="$STATE_DIR/failed-sha"     # quarantined candidate
mkdir -p "$STATE_DIR" 2>/dev/null || true

# --- logging: local-first (journald) so an outage can never hide an event ---
log() { local m="$(date '+%F %T') [$PORTAL_ENV] $*"; echo "$m"; command -v logger >/dev/null && logger -t portal-sync -- "$*"; }

# --- Obsidian note (git-backed vault); per-env file; non-fatal, never blocks a deploy ---
pnote() {
  local file="$1-$PORTAL_ENV" line=$2 dir stamp
  [ -n "$VAULT_DIR" ] && [ -d "$VAULT_DIR/.git" ] || { log "pnote: no vault at $VAULT_DIR (kept in journald): $line"; return 0; }
  dir="$VAULT_DIR/Claude/deploys"
  stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
  ( flock -w 30 200 || exit 0
    mkdir -p "$dir"
    [ -f "$dir/${file}.md" ] || printf '# Portal %s\n\n' "$file" > "$dir/${file}.md"
    printf -- '- %s — %s\n' "$stamp" "$line" >> "$dir/${file}.md"
    cd "$VAULT_DIR" || exit 0
    git add -A
    git diff --cached --quiet || git commit -q -m "portal $file: $stamp"
    git pull --rebase -q origin main && git push -q origin main
  ) 200>"/var/lock/portal-vault.lock" >/dev/null 2>&1 || log "pnote: vault sync failed (note kept locally)"
}
# alert = always journald + Obsidian drift-alerts note
palert() { log "ALERT: $*"; pnote drift-alerts "$*"; }

check_disk() {
  local avail; avail=$(df -Pk "$PORTAL_DIR" 2>/dev/null | awk 'NR==2{print int($4/1024)}')
  [ -n "$avail" ] && [ "$avail" -lt "$MIN_FREE_MB" ] && { palert "❌ **$PORTAL_ENV** low disk: ${avail}MB free (<${MIN_FREE_MB}MB) — deploy ABORTED"; return 1; }
  return 0
}

# --- WAL-safe SQLite backup of every data/*.db and data/*.sqlite ---
db_backup() {
  local ts=$1 f
  shopt -s nullglob
  for f in "$PORTAL_DIR"/data/*.db "$PORTAL_DIR"/data/*.sqlite; do
    sqlite3 "$f" ".backup '${f}.autobak-${ts}'" || { shopt -u nullglob; return 1; }
    [ -s "${f}.autobak-${ts}" ] || { shopt -u nullglob; return 1; }   # verify non-empty
  done
  for f in "$PORTAL_DIR"/data/*.db "$PORTAL_DIR"/data/*.sqlite; do
    ls -1t "${f}.autobak-"* 2>/dev/null | tail -n +$((BACKUP_KEEP+1)) | xargs -r rm -f
  done
  shopt -u nullglob
  return 0
}

# --- health: DB-backed route must return 200, bounded timeouts, retries ---
health_ok() {
  local i code
  for i in $(seq 1 10); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 20 \
             "http://127.0.0.1:${PORTAL_PORT}${HEALTH_PATH}" 2>/dev/null)
    [ "$code" = "200" ] && return 0
    sleep 3
  done
  log "health check failed on ${HEALTH_PATH} (last=${code:-none})"
  return 1
}

# _rollback <oldsha> <ts> <reason> <deps_changed 0|1>
_rollback() {
  local old=$1 ts=$2 reason=$3 deps=$4
  log "ROLLBACK to ${old:0:7} ($reason)"
  git -C "$PORTAL_DIR" reset --hard "$old" >/dev/null 2>&1
  [ "$deps" = "1" ] && ( cd "$PORTAL_DIR" && npm ci ) >"/tmp/portal-rb-npmci-$ts.log" 2>&1
  ( cd "$PORTAL_DIR" && npm run build ) >"/tmp/portal-rollback-$ts.log" 2>&1
  systemctl restart "$PORTAL_SERVICE"; sleep 3
  if health_ok; then
    palert "⚠️ **$PORTAL_ENV** deploy FAILED ($reason) — rolled back to \`${old:0:7}\`, healthy. DB backup + logs kept (/tmp/portal-*-$ts.log)"
  else
    palert "🆘 **$PORTAL_ENV** deploy FAILED ($reason) AND rollback is UNHEALTHY — MANUAL FIX NEEDED. DB backup + logs at /tmp/portal-*-$ts.log"
  fi
}

# guarded_deploy — fast-forward to a PINNED origin/main sha and restart safely.
# Preconditions (caller ensures): branch main, tracked tree clean, HEAD ancestor of origin/main.
# Quarantines a candidate that fails so the poller can't loop on it.
guarded_deploy() {
  local ts oldsha newsha subject deps_changed=0
  ts=$(date +%Y%m%d-%H%M%S)
  oldsha=$(git -C "$PORTAL_DIR" rev-parse HEAD)
  newsha=$(git -C "$PORTAL_DIR" rev-parse origin/main)   # PIN the candidate
  [ "$oldsha" = "$newsha" ] && { log "already up to date"; return 0; }
  log "deploying ${oldsha:0:7} -> ${newsha:0:7}"

  check_disk || return 1
  db_backup "$ts" || { palert "❌ **$PORTAL_ENV** DB backup failed — deploy ABORTED (nothing changed)"; return 1; }

  if ! git -C "$PORTAL_DIR" merge --ff-only "$newsha" >"/tmp/portal-ffwd-$ts.log" 2>&1; then
    palert "❌ **$PORTAL_ENV** fast-forward to \`${newsha:0:7}\` failed — deploy ABORTED. See /tmp/portal-ffwd-$ts.log"
    return 1
  fi

  if ! git -C "$PORTAL_DIR" diff --quiet "$oldsha" "$newsha" -- package-lock.json package.json; then
    deps_changed=1; log "deps changed -> npm ci"
    ( cd "$PORTAL_DIR" && npm ci ) >"/tmp/portal-npmci-$ts.log" 2>&1 \
      || { echo "$newsha" > "$FAILED_SHA_FILE"; _rollback "$oldsha" "$ts" "npm ci failed" "$deps_changed"; return 1; }
  fi

  if ! ( cd "$PORTAL_DIR" && npm run build ) >"/tmp/portal-build-$ts.log" 2>&1; then
    echo "$newsha" > "$FAILED_SHA_FILE"; _rollback "$oldsha" "$ts" "build failed" "$deps_changed"; return 1
  fi

  systemctl restart "$PORTAL_SERVICE"; sleep 4
  if ! health_ok; then
    echo "$newsha" > "$FAILED_SHA_FILE"; _rollback "$oldsha" "$ts" "health check failed" "$deps_changed"; return 1
  fi

  rm -f "$FAILED_SHA_FILE"          # candidate is good; clear any quarantine
  subject=$(git -C "$PORTAL_DIR" log -1 --pretty=%s)
  pnote deploy-log "✅ **$PORTAL_ENV** \`${oldsha:0:7}\` → \`${newsha:0:7}\` — ${subject}"
  log "DEPLOY OK -> ${newsha:0:7}"
  return 0
}

# classify_state -> echoes one of: uptodate | behind | diverged | dirty | wrongbranch ; sets $STATE_DETAIL
classify_state() {
  local branch dirty head remote
  branch=$(git -C "$PORTAL_DIR" rev-parse --abbrev-ref HEAD)
  dirty=$(git -C "$PORTAL_DIR" status --porcelain --untracked-files=no | wc -l | tr -d ' ')
  head=$(git -C "$PORTAL_DIR" rev-parse HEAD)
  remote=$(git -C "$PORTAL_DIR" rev-parse origin/main)
  STATE_DETAIL="branch=$branch dirty=$dirty head=${head:0:7} origin/main=${remote:0:7}"
  [ "$branch" != "main" ] && { echo wrongbranch; return; }
  [ "$dirty" != "0" ]     && { echo dirty; return; }
  [ "$head" = "$remote" ] && { echo uptodate; return; }
  if git -C "$PORTAL_DIR" merge-base --is-ancestor "$head" "$remote"; then echo behind; else echo diverged; fi
}
