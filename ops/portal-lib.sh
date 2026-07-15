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
: "${HEALTH_PATH:=/api/kiosk/staff?company_id=6}"   # DB-backed route (queries SQLite)
: "${HEALTH_EXPECT:=\"staff\"}"                      # body must contain this (proves DB read)
: "${VAULT_DIR:=/opt/obsidian-vault}"
: "${BACKUP_KEEP:=10}"
: "${MIN_FREE_MB:=800}"

LOG_DIR=/var/log/portal-sync          # root-only (0700): predictable names can't be hijacked
LOCK_DIR=/run/portal-sync             # root-only (0700): lock files can't be symlink-attacked
STATE_DIR=/var/lib/portal-sync
DEPLOY_LOCK="$LOCK_DIR/deploy.lock"    # shared by autodeploy + golive
VAULT_LOCK="$LOCK_DIR/vault.lock"
FAILED_SHA_FILE="$STATE_DIR/failed-sha"
for d in "$LOG_DIR" "$LOCK_DIR" "$STATE_DIR"; do [ -d "$d" ] || { mkdir -p "$d" 2>/dev/null && chmod 700 "$d" 2>/dev/null; }; done

log() { local m="$(date '+%F %T') [$PORTAL_ENV] $*"; echo "$m"; command -v logger >/dev/null && logger -t portal-sync -- "$*"; }

STATE=""; STATE_DETAIL=""
# classify_state — sets globals $STATE (uptodate|behind|diverged|dirty|wrongbranch) and $STATE_DETAIL.
# Called directly (NOT in $(...)) so the globals survive.
classify_state() {
  local branch dirty head remote
  branch=$(git -C "$PORTAL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
  dirty=$(git -C "$PORTAL_DIR" status --porcelain --untracked-files=no | wc -l | tr -d ' ')
  head=$(git -C "$PORTAL_DIR" rev-parse HEAD 2>/dev/null)
  remote=$(git -C "$PORTAL_DIR" rev-parse origin/main 2>/dev/null)
  STATE_DETAIL="branch=$branch dirty=$dirty head=${head:0:7} origin/main=${remote:0:7}"
  if   [ "$branch" != main ];  then STATE=wrongbranch
  elif [ "$dirty"  != 0 ];     then STATE=dirty
  elif [ "$head" = "$remote" ]; then STATE=uptodate
  elif git -C "$PORTAL_DIR" merge-base --is-ancestor "$head" "$remote"; then STATE=behind
  else STATE=diverged; fi
}

# do_fetch — fetch origin; track consecutive failures; raise ONE durable alert after 3.
do_fetch() {
  local cf="$STATE_DIR/fetch-fails" n
  if git -C "$PORTAL_DIR" fetch origin -q 2>/dev/null; then rm -f "$cf" 2>/dev/null; return 0; fi
  n=$(( $(cat "$cf" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$cf" 2>/dev/null
  log "git fetch failed (consecutive=$n)"
  [ "$n" = 3 ] && palert "🚨 **$PORTAL_ENV** git fetch failed $n times in a row — sync may be stalled (network/credentials?)"
  return 1
}

# --- Obsidian note (git-backed vault): stage ONLY our note, time-bounded, rebase-safe, per-env file ---
pnote() {
  local file="$1-$PORTAL_ENV" line=$2 rel stamp
  [ -n "$VAULT_DIR" ] && [ -d "$VAULT_DIR/.git" ] || { log "pnote: no vault (journald only): $line"; return 0; }
  rel="Claude/deploys/${file}.md"; stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
  ( flock -w 20 200 || exit 0
    mkdir -p "$VAULT_DIR/Claude/deploys"
    [ -f "$VAULT_DIR/$rel" ] || printf '# Portal %s\n\n' "$file" > "$VAULT_DIR/$rel"
    printf -- '- %s — %s\n' "$stamp" "$line" >> "$VAULT_DIR/$rel"
    cd "$VAULT_DIR" || exit 0
    git add -- "$rel" || exit 0                      # ONLY our note — never `git add -A`
    git diff --cached --quiet && exit 0
    timeout 30 git commit -q -m "portal $file: $stamp" || exit 0
    timeout 45 git pull --rebase -q origin main || { git rebase --abort 2>/dev/null; exit 0; }
    timeout 45 git push -q origin main || exit 0
  ) 200>"$VAULT_LOCK" >/dev/null 2>&1 || log "pnote: vault sync failed/timed out (note kept locally)"
}
palert() { log "ALERT: $*"; pnote drift-alerts "$*"; }

check_disk() {
  local avail; avail=$(df -Pk "$PORTAL_DIR" 2>/dev/null | awk 'NR==2{print int($4/1024)}')
  [ -n "$avail" ] && [ "$avail" -lt "$MIN_FREE_MB" ] && { palert "❌ **$PORTAL_ENV** low disk: ${avail}MB free (<${MIN_FREE_MB}MB) — deploy ABORTED"; return 1; }
  return 0
}

# WAL-safe SQLite backup of every data/*.db|*.sqlite; fails if a DB exists but can't be backed up.
db_backup() {
  local ts=$1 f found=0
  shopt -s nullglob
  for f in "$PORTAL_DIR"/data/*.db "$PORTAL_DIR"/data/*.sqlite; do
    found=1
    sqlite3 "$f" ".backup '${f}.autobak-${ts}'" || { shopt -u nullglob; return 1; }
    [ -s "${f}.autobak-${ts}" ] || { shopt -u nullglob; return 1; }
  done
  for f in "$PORTAL_DIR"/data/*.db "$PORTAL_DIR"/data/*.sqlite; do
    ls -1t "${f}.autobak-"* 2>/dev/null | tail -n +$((BACKUP_KEEP+1)) | xargs -r rm -f
  done
  shopt -u nullglob
  [ "$found" = 0 ] && log "db_backup: no data/*.db found (proceeding — fresh install?)"
  return 0
}

# health: DB-backed route must return 200 AND contain HEALTH_EXPECT; bounded timeouts + retries.
health_ok() {
  local i code body; body=$(mktemp "$LOG_DIR/health.XXXXXX" 2>/dev/null || echo /tmp/portal-health.$$)
  for i in $(seq 1 10); do
    code=$(curl -s -o "$body" -w '%{http_code}' --connect-timeout 5 --max-time 20 \
             "http://127.0.0.1:${PORTAL_PORT}${HEALTH_PATH}" 2>/dev/null)
    if [ "$code" = "200" ] && { [ -z "$HEALTH_EXPECT" ] || grep -q -- "$HEALTH_EXPECT" "$body" 2>/dev/null; }; then
      rm -f "$body"; return 0
    fi
    sleep 3
  done
  log "health check failed on ${HEALTH_PATH} (last=${code:-none})"; rm -f "$body"; return 1
}

# _rollback <oldsha> <ts> <reason> <deps_changed 0|1> — captures every step; never claims false health.
_rollback() {
  local old=$1 ts=$2 reason=$3 deps=$4 fail=0
  log "ROLLBACK to ${old:0:7} ($reason)"
  git -C "$PORTAL_DIR" reset --hard "$old" >/dev/null 2>&1 || fail=1
  [ "$deps" = 1 ] && { ( cd "$PORTAL_DIR" && npm ci ) >"$LOG_DIR/rb-npmci-$ts.log" 2>&1 || fail=1; }
  ( cd "$PORTAL_DIR" && npm run build ) >"$LOG_DIR/rollback-$ts.log" 2>&1 || fail=1
  systemctl restart "$PORTAL_SERVICE" || fail=1
  sleep 3
  if [ "$fail" = 0 ] && health_ok; then
    palert "⚠️ **$PORTAL_ENV** deploy FAILED ($reason) — rolled back to \`${old:0:7}\`, healthy. Logs: $LOG_DIR/*-$ts.log"
  else
    palert "🆘 **$PORTAL_ENV** deploy FAILED ($reason) AND rollback is UNHEALTHY — MANUAL FIX NEEDED. Logs: $LOG_DIR/*-$ts.log"
  fi
}

# guarded_deploy [target_sha] — fast-forward to a PINNED sha and restart safely.
# Preconditions (caller ensures): branch main, tracked tree clean, sha is a descendant of HEAD.
guarded_deploy() {
  local target=$1 ts oldsha newsha subject deps_changed=0
  ts=$(date +%Y%m%d-%H%M%S)
  oldsha=$(git -C "$PORTAL_DIR" rev-parse HEAD)
  newsha=${target:-$(git -C "$PORTAL_DIR" rev-parse origin/main)}
  [ "$oldsha" = "$newsha" ] && { log "already up to date"; return 0; }
  [ -w "$STATE_DIR" ] || { palert "❌ **$PORTAL_ENV** state dir not writable — refusing (quarantine would fail-open)"; return 1; }
  log "deploying ${oldsha:0:7} -> ${newsha:0:7}"

  check_disk || return 1
  db_backup "$ts" || { palert "❌ **$PORTAL_ENV** DB backup failed — deploy ABORTED (nothing changed)"; return 1; }

  if ! git -C "$PORTAL_DIR" merge --ff-only "$newsha" >"$LOG_DIR/ffwd-$ts.log" 2>&1; then
    palert "❌ **$PORTAL_ENV** fast-forward to \`${newsha:0:7}\` failed — deploy ABORTED. See $LOG_DIR/ffwd-$ts.log"
    return 1
  fi
  if ! git -C "$PORTAL_DIR" diff --quiet "$oldsha" "$newsha" -- package-lock.json package.json; then
    deps_changed=1; log "deps changed -> npm ci"
    ( cd "$PORTAL_DIR" && npm ci ) >"$LOG_DIR/npmci-$ts.log" 2>&1 \
      || { echo "$newsha" > "$FAILED_SHA_FILE"; _rollback "$oldsha" "$ts" "npm ci failed" "$deps_changed"; return 1; }
  fi
  if ! ( cd "$PORTAL_DIR" && npm run build ) >"$LOG_DIR/build-$ts.log" 2>&1; then
    echo "$newsha" > "$FAILED_SHA_FILE"; _rollback "$oldsha" "$ts" "build failed" "$deps_changed"; return 1
  fi
  systemctl restart "$PORTAL_SERVICE"; sleep 4
  if ! health_ok; then
    echo "$newsha" > "$FAILED_SHA_FILE"; _rollback "$oldsha" "$ts" "health check failed" "$deps_changed"; return 1
  fi
  rm -f "$FAILED_SHA_FILE"
  subject=$(git -C "$PORTAL_DIR" log -1 --pretty=%s)
  pnote deploy-log "✅ **$PORTAL_ENV** \`${oldsha:0:7}\` → \`${newsha:0:7}\` — ${subject}"
  log "DEPLOY OK -> ${newsha:0:7}"
  return 0
}
