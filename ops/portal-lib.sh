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
: "${BUILD_DIR:=/opt/portal-build}"   # isolated build workspace (git worktree of the source)

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

# ensure_build_dir — create the isolated build worktree once + (re)point its shared symlinks.
ensure_build_dir() {
  if [ ! -e "$BUILD_DIR/.git" ]; then
    git -C "$PORTAL_DIR" worktree add --detach "$BUILD_DIR" "$(git -C "$PORTAL_DIR" rev-parse HEAD)" >/dev/null 2>&1 || return 1
  fi
  # build reads env + (occasionally) the DB; point them at the live shared copies (same as in-place build did)
  [ -L "$BUILD_DIR/.env.local" ] || { rm -rf "$BUILD_DIR/.env.local"; ln -s "$PORTAL_DIR/.env.local" "$BUILD_DIR/.env.local"; }
  [ -L "$BUILD_DIR/data" ]       || { rm -rf "$BUILD_DIR/data";       ln -s "$PORTAL_DIR/data"       "$BUILD_DIR/data"; }
  # the workspace needs node_modules to build; seed from live once (deploys refresh it when deps change)
  [ -d "$BUILD_DIR/node_modules" ] || cp -a "$PORTAL_DIR/node_modules" "$BUILD_DIR/node_modules" || return 1
  return 0
}

# _swap_rollback <oldsha> <ts> <deps_changed 0|1> <reason> — INSTANT rollback: swap the
# previous build artifacts back (NO rebuild — so this can never fail the way a rebuild can).
_swap_rollback() {
  local old=$1 ts=$2 deps=$3 reason=$4
  log "SWAP-ROLLBACK to ${old:0:7} ($reason)"
  systemctl stop "$PORTAL_SERVICE"
  git -C "$PORTAL_DIR" reset --hard "$old" >/dev/null 2>&1
  if [ -d "$PORTAL_DIR/.next.prev" ]; then
    rm -rf "$PORTAL_DIR/.next.bad"; mv "$PORTAL_DIR/.next" "$PORTAL_DIR/.next.bad" 2>/dev/null
    mv "$PORTAL_DIR/.next.prev" "$PORTAL_DIR/.next"
  fi
  if [ "$deps" = 1 ] && [ -d "$PORTAL_DIR/node_modules.prev" ]; then
    rm -rf "$PORTAL_DIR/node_modules.bad"; mv "$PORTAL_DIR/node_modules" "$PORTAL_DIR/node_modules.bad" 2>/dev/null
    mv "$PORTAL_DIR/node_modules.prev" "$PORTAL_DIR/node_modules"
  fi
  systemctl start "$PORTAL_SERVICE"; sleep 3
  if health_ok; then
    palert "⚠️ **$PORTAL_ENV** deploy FAILED ($reason) — instantly swapped back to \`${old:0:7}\`, healthy (no rebuild). Logs: $LOG_DIR/*-$ts.log"
  else
    palert "🆘 **$PORTAL_ENV** deploy FAILED ($reason) AND swap-back is UNHEALTHY — MANUAL FIX NEEDED. Logs: $LOG_DIR/*-$ts.log"
  fi
}

# guarded_deploy [target_sha] — BUILD-ASIDE deploy: build the new version in an isolated
# workspace (live site untouched); only a SUCCESSFUL build is swapped in; rollback is an
# instant artifact swap-back with no rebuild. Preconditions (caller ensures): branch main,
# tracked tree clean, sha is a descendant of HEAD.
guarded_deploy() {
  local target=$1 ts oldsha newsha subject deps_changed=0
  ts=$(date +%Y%m%d-%H%M%S)
  oldsha=$(git -C "$PORTAL_DIR" rev-parse HEAD)
  newsha=${target:-$(git -C "$PORTAL_DIR" rev-parse origin/main)}
  [ "$oldsha" = "$newsha" ] && { log "already up to date"; return 0; }
  [ -w "$STATE_DIR" ] || { palert "❌ **$PORTAL_ENV** state dir not writable — refusing (quarantine would fail-open)"; return 1; }
  log "deploying ${oldsha:0:7} -> ${newsha:0:7} (build-aside)"
  check_disk || return 1
  ensure_build_dir || { palert "❌ **$PORTAL_ENV** build workspace setup failed — deploy ABORTED (live untouched)"; return 1; }

  # 1. point the build workspace at the pinned sha (live site still serving oldsha, untouched)
  if ! git -C "$BUILD_DIR" checkout --detach "$newsha" -f >"$LOG_DIR/co-$ts.log" 2>&1; then
    echo "$newsha" > "$FAILED_SHA_FILE"
    palert "❌ **$PORTAL_ENV** build-workspace checkout to \`${newsha:0:7}\` failed — deploy ABORTED (live untouched)"; return 1
  fi
  # 2. deps in the build workspace only, if the lockfile changed
  if ! git -C "$PORTAL_DIR" diff --quiet "$oldsha" "$newsha" -- package-lock.json package.json; then
    deps_changed=1; log "deps changed -> npm ci (build workspace)"
    if ! ( cd "$BUILD_DIR" && npm ci ) >"$LOG_DIR/npmci-$ts.log" 2>&1; then
      echo "$newsha" > "$FAILED_SHA_FILE"
      palert "❌ **$PORTAL_ENV** npm ci failed in build workspace — deploy ABORTED (LIVE UNTOUCHED, still \`${oldsha:0:7}\`). Log: $LOG_DIR/npmci-$ts.log"; return 1
    fi
  fi
  # 3. BUILD ASIDE — the failure-prone step, fully isolated from the live site
  if ! ( cd "$BUILD_DIR" && npm run build ) >"$LOG_DIR/build-$ts.log" 2>&1; then
    echo "$newsha" > "$FAILED_SHA_FILE"
    palert "❌ **$PORTAL_ENV** build FAILED for \`${newsha:0:7}\` — LIVE SITE UNTOUCHED (still serving \`${oldsha:0:7}\`). Log: $LOG_DIR/build-$ts.log"; return 1
  fi
  log "build OK (aside) — staging artifacts"
  # 4. DB backup before we touch the live site
  db_backup "$ts" || { palert "❌ **$PORTAL_ENV** DB backup failed — deploy ABORTED (live untouched)"; return 1; }
  # 5. stage built artifacts next to live (same filesystem → the swap itself is instant)
  rm -rf "$PORTAL_DIR/.next.incoming"
  cp -a "$BUILD_DIR/.next" "$PORTAL_DIR/.next.incoming" || { palert "❌ **$PORTAL_ENV** staging .next failed — deploy ABORTED (live untouched)"; rm -rf "$PORTAL_DIR/.next.incoming"; return 1; }
  if [ "$deps_changed" = 1 ]; then
    rm -rf "$PORTAL_DIR/node_modules.incoming"
    cp -a "$BUILD_DIR/node_modules" "$PORTAL_DIR/node_modules.incoming" || { palert "❌ **$PORTAL_ENV** staging node_modules failed — ABORTED (live untouched)"; rm -rf "$PORTAL_DIR/.next.incoming" "$PORTAL_DIR/node_modules.incoming"; return 1; }
  fi
  # 6. swap during a brief stop (no in-flight readers) — all same-fs renames, instant
  systemctl stop "$PORTAL_SERVICE"
  git -C "$PORTAL_DIR" merge --ff-only "$newsha" >"$LOG_DIR/ffwd-$ts.log" 2>&1
  rm -rf "$PORTAL_DIR/.next.prev"; mv "$PORTAL_DIR/.next" "$PORTAL_DIR/.next.prev"; mv "$PORTAL_DIR/.next.incoming" "$PORTAL_DIR/.next"
  if [ "$deps_changed" = 1 ]; then
    rm -rf "$PORTAL_DIR/node_modules.prev"; mv "$PORTAL_DIR/node_modules" "$PORTAL_DIR/node_modules.prev"; mv "$PORTAL_DIR/node_modules.incoming" "$PORTAL_DIR/node_modules"
  fi
  systemctl start "$PORTAL_SERVICE"; sleep 4
  # 7. health-gate; on failure, INSTANT swap-back (no rebuild)
  if ! health_ok; then
    echo "$newsha" > "$FAILED_SHA_FILE"
    _swap_rollback "$oldsha" "$ts" "$deps_changed" "health check failed"; return 1
  fi
  rm -f "$FAILED_SHA_FILE"
  subject=$(git -C "$PORTAL_DIR" log -1 --pretty=%s)
  pnote deploy-log "✅ **$PORTAL_ENV** \`${oldsha:0:7}\` → \`${newsha:0:7}\` — ${subject}"
  log "DEPLOY OK -> ${newsha:0:7}"
  return 0
}
