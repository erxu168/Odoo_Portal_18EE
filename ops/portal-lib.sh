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
: "${DEVICE_RESTART_TOKEN:=}"                        # set in /etc/portal-sync.conf to enable the post-deploy remote-restart hook (must match the portal's .env.local DEVICE_RESTART_TOKEN)
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

# ensure_build_dir — create the isolated build worktree once + force its shared symlinks to
# point exactly where we want (build reads env + occasionally the DB). node_modules is NOT
# seeded — guarded_deploy always runs `npm ci` so the workspace deps always match the target.
_relink() {  # <link> <target> — make $link a symlink to exactly $target
  [ "$(readlink "$1" 2>/dev/null)" = "$2" ] && return 0
  rm -rf "$1"; ln -s "$2" "$1"
}
ensure_build_dir() {
  if [ ! -e "$BUILD_DIR/.git" ]; then
    git -C "$PORTAL_DIR" worktree add --detach "$BUILD_DIR" "$(git -C "$PORTAL_DIR" rev-parse HEAD)" >/dev/null 2>&1 || return 1
  fi
  _relink "$BUILD_DIR/.env.local" "$PORTAL_DIR/.env.local" || return 1
  _relink "$BUILD_DIR/data"       "$PORTAL_DIR/data"       || return 1
  return 0
}

# _swap_rollback <oldsha> <ts> <deps_changed 0|1> <reason> — INSTANT rollback: swap the
# previous build artifacts back (NO rebuild — so this can never fail the way a rebuild can).
_swap_rollback() {
  local old=$1 ts=$2 deps=$3 reason=$4 fail=0
  log "SWAP-ROLLBACK to ${old:0:7} ($reason)"
  systemctl stop "$PORTAL_SERVICE" || fail=1
  git -C "$PORTAL_DIR" reset --hard "$old" >/dev/null 2>&1 || fail=1
  if [ -d "$PORTAL_DIR/.next.prev" ]; then
    rm -rf "$PORTAL_DIR/.next.bad"; mv "$PORTAL_DIR/.next" "$PORTAL_DIR/.next.bad" 2>/dev/null
    mv "$PORTAL_DIR/.next.prev" "$PORTAL_DIR/.next" || fail=1
  else
    fail=1; log "swap-rollback: no .next.prev to restore!"
  fi
  if [ "$deps" = 1 ]; then
    if [ -d "$PORTAL_DIR/node_modules.prev" ]; then
      rm -rf "$PORTAL_DIR/node_modules.bad"; mv "$PORTAL_DIR/node_modules" "$PORTAL_DIR/node_modules.bad" 2>/dev/null
      mv "$PORTAL_DIR/node_modules.prev" "$PORTAL_DIR/node_modules" || fail=1
    else
      fail=1; log "swap-rollback: deps changed but no node_modules.prev!"
    fi
  fi
  systemctl start "$PORTAL_SERVICE" || fail=1
  sleep 3
  if [ "$fail" = 0 ] && health_ok; then
    palert "⚠️ **$PORTAL_ENV** deploy FAILED ($reason) — instantly swapped back to \`${old:0:7}\`, healthy (no rebuild). Logs: $LOG_DIR/*-$ts.log"
  else
    palert "🆘 **$PORTAL_ENV** deploy FAILED ($reason) AND swap-back INCOMPLETE/UNHEALTHY — MANUAL FIX NEEDED. Logs: $LOG_DIR/*-$ts.log"
  fi
}

# _portal_build_needed <oldsha> <newsha> — return 0 (yes, build) if the diff touches
# anything the portal build or runtime depends on; return 1 (no) only when EVERY changed
# path is docs/ops/CI/addons. Fail-safe: an empty diff, a git error, or any unrecognized
# path forces a build, so skipping a rebuild can never leave stale code live.
_portal_build_needed() {
  local old=$1 new=$2 f changed
  # --no-renames: a rename is reported as delete(old)+add(new), so a source file renamed
  # INTO an allowlisted dir still surfaces its source-side path and forces a build (never
  # leaves stale .next serving code that moved/was removed).
  changed=$(git -C "$PORTAL_DIR" diff --name-only --no-renames "$old" "$new" 2>/dev/null) || return 0
  [ -z "$changed" ] && return 0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      docs/*|ops/*|.github/*|scripts/*|mocks/*|sql/*|odoo-addons/*|odoo-modules/*|*.md) ;;
      *) return 0 ;;   # something outside the doc/ops allowlist → rebuild
    esac
  done <<< "$changed"
  return 1             # every changed path was docs/ops/CI → safe to skip the rebuild
}

# guarded_deploy [target_sha] — BUILD-ASIDE deploy: build the new version in an isolated
# workspace (live site untouched); only a SUCCESSFUL build is swapped in; rollback is an
# instant artifact swap-back with no rebuild. Preconditions (caller ensures): branch main,
# tracked tree clean, sha is a descendant of HEAD.
# _notify_device_restart <sha> — after a HEALTHY deploy, ask the portal to restart the
# opted-in unattended-display fleet (KDS/kiosk) so they load the new build. Best-effort:
# idempotent on the sha (a retry re-issues nothing), and a failure is logged/alerted but
# NEVER rolls back an otherwise-healthy deploy. No-op unless DEVICE_RESTART_TOKEN is set.
_notify_device_restart() {
  local sha=$1 code
  [ -n "$DEVICE_RESTART_TOKEN" ] || return 0
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 \
           -X POST "http://127.0.0.1:${PORTAL_PORT}/api/internal/device-restart" \
           -H "Authorization: Bearer ${DEVICE_RESTART_TOKEN}" \
           -H 'Content-Type: application/json' \
           -d "{\"deploySha\":\"${sha}\",\"env\":\"${PORTAL_ENV}\"}" 2>/dev/null)
  if [ "$code" = "200" ]; then
    log "device-restart broadcast sent for ${sha:0:7}"
  else
    palert "⚠️ **$PORTAL_ENV** device-restart hook failed (HTTP ${code:-none}) for \`${sha:0:7}\` — deploy is healthy; screens may need a manual reload"
  fi
}

guarded_deploy() {
  local target=$1 ts oldsha newsha subject deps_changed=0
  ts=$(date +%Y%m%d-%H%M%S)
  oldsha=$(git -C "$PORTAL_DIR" rev-parse HEAD)
  newsha=${target:-$(git -C "$PORTAL_DIR" rev-parse origin/main)}
  [ "$oldsha" = "$newsha" ] && { log "already up to date"; return 0; }
  [ -w "$STATE_DIR" ] || { palert "❌ **$PORTAL_ENV** state dir not writable — refusing (quarantine would fail-open)"; return 1; }

  # Fast path: when the diff is ONLY docs/ops/CI (nothing the portal build or runtime uses),
  # skip the expensive rebuild+restart — just fast-forward the checkout. Avoids needless CPU
  # load on the shared box (Odoo runs here too) and an unnecessary service restart.
  # Fail-safe: any non-doc path, or a failed ff-advance, falls through to a full build-aside.
  if ! _portal_build_needed "$oldsha" "$newsha"; then
    if git -C "$PORTAL_DIR" merge --ff-only "$newsha" >"$LOG_DIR/ffwd-$ts.log" 2>&1; then
      rm -f "$FAILED_SHA_FILE"
      pnote deploy-log "⏭️ **$PORTAL_ENV** \`${oldsha:0:7}\` → \`${newsha:0:7}\` — docs/ops only, no portal rebuild"
      log "SKIP rebuild (docs/ops only) -> ${newsha:0:7}"
      return 0
    fi
    log "docs-only ff-advance failed — falling back to full build-aside deploy"
  fi

  log "deploying ${oldsha:0:7} -> ${newsha:0:7} (build-aside)"
  local live_lock target_lock
  check_disk || return 1
  # DB backup BEFORE the new code can run (the build touches the shared DB via symlink)
  db_backup "$ts" || { palert "❌ **$PORTAL_ENV** DB backup failed — deploy ABORTED (live untouched)"; return 1; }
  ensure_build_dir || { palert "❌ **$PORTAL_ENV** build workspace setup failed — deploy ABORTED (live untouched)"; return 1; }

  # 1. point the build workspace at the pinned sha (live site still serving oldsha, untouched)
  if ! git -C "$BUILD_DIR" checkout --detach "$newsha" -f >"$LOG_DIR/co-$ts.log" 2>&1; then
    echo "$newsha" > "$FAILED_SHA_FILE"
    palert "❌ **$PORTAL_ENV** build-workspace checkout to \`${newsha:0:7}\` failed — deploy ABORTED (live untouched)"; return 1
  fi
  # 2. ALWAYS npm ci in the workspace so its deps match the target lockfile (never reuse stale deps)
  if ! ( cd "$BUILD_DIR" && npm ci ) >"$LOG_DIR/npmci-$ts.log" 2>&1; then
    echo "$newsha" > "$FAILED_SHA_FILE"
    palert "❌ **$PORTAL_ENV** npm ci failed in build workspace — deploy ABORTED (LIVE UNTOUCHED, still \`${oldsha:0:7}\`). Log: $LOG_DIR/npmci-$ts.log"; return 1
  fi
  # LIVE needs the new node_modules only if the lockfile actually differs from what's live now
  live_lock=$(sha1sum "$PORTAL_DIR/package-lock.json" 2>/dev/null | cut -d' ' -f1)
  target_lock=$(sha1sum "$BUILD_DIR/package-lock.json" 2>/dev/null | cut -d' ' -f1)
  [ -n "$target_lock" ] && [ "$live_lock" != "$target_lock" ] && deps_changed=1
  # 3. BUILD ASIDE — the failure-prone step, fully isolated from the live site
  if ! ( cd "$BUILD_DIR" && npm run build ) >"$LOG_DIR/build-$ts.log" 2>&1; then
    echo "$newsha" > "$FAILED_SHA_FILE"
    palert "❌ **$PORTAL_ENV** build FAILED for \`${newsha:0:7}\` — LIVE SITE UNTOUCHED (still serving \`${oldsha:0:7}\`). Log: $LOG_DIR/build-$ts.log"; return 1
  fi
  log "build OK (aside) — staging artifacts (deps_changed=$deps_changed)"
  # 4. stage built artifacts next to live (same filesystem → the swap is instant)
  rm -rf "$PORTAL_DIR/.next.incoming"
  cp -a "$BUILD_DIR/.next" "$PORTAL_DIR/.next.incoming" || { palert "❌ **$PORTAL_ENV** staging .next failed — deploy ABORTED (live untouched)"; rm -rf "$PORTAL_DIR/.next.incoming"; return 1; }
  if [ "$deps_changed" = 1 ]; then
    rm -rf "$PORTAL_DIR/node_modules.incoming"
    cp -a "$BUILD_DIR/node_modules" "$PORTAL_DIR/node_modules.incoming" || { palert "❌ **$PORTAL_ENV** staging node_modules failed — ABORTED (live untouched)"; rm -rf "$PORTAL_DIR/.next.incoming" "$PORTAL_DIR/node_modules.incoming"; return 1; }
  fi
  # 5. CUTOVER during a brief stop — every step checked; on failure restore & keep oldsha up
  systemctl stop "$PORTAL_SERVICE"
  if ! git -C "$PORTAL_DIR" merge --ff-only "$newsha" >"$LOG_DIR/ffwd-$ts.log" 2>&1; then
    systemctl start "$PORTAL_SERVICE"; sleep 3
    echo "$newsha" > "$FAILED_SHA_FILE"
    palert "❌ **$PORTAL_ENV** cutover ff-merge to \`${newsha:0:7}\` failed — kept \`${oldsha:0:7}\` (restarted). See $LOG_DIR/ffwd-$ts.log"; return 1
  fi
  rm -rf "$PORTAL_DIR/.next.prev"
  if ! mv "$PORTAL_DIR/.next" "$PORTAL_DIR/.next.prev"; then
    git -C "$PORTAL_DIR" reset --hard "$oldsha" >/dev/null 2>&1; systemctl start "$PORTAL_SERVICE"; sleep 3
    palert "🆘 **$PORTAL_ENV** cutover: could not move old .next — restarted old, MANUAL CHECK. $LOG_DIR/*-$ts.log"; return 1
  fi
  if ! mv "$PORTAL_DIR/.next.incoming" "$PORTAL_DIR/.next"; then
    mv "$PORTAL_DIR/.next.prev" "$PORTAL_DIR/.next"
    git -C "$PORTAL_DIR" reset --hard "$oldsha" >/dev/null 2>&1; systemctl start "$PORTAL_SERVICE"; sleep 3
    echo "$newsha" > "$FAILED_SHA_FILE"
    palert "⚠️ **$PORTAL_ENV** cutover: new .next move failed — restored \`${oldsha:0:7}\` (restarted). $LOG_DIR/*-$ts.log"; return 1
  fi
  if [ "$deps_changed" = 1 ]; then
    rm -rf "$PORTAL_DIR/node_modules.prev"
    if ! { mv "$PORTAL_DIR/node_modules" "$PORTAL_DIR/node_modules.prev" && mv "$PORTAL_DIR/node_modules.incoming" "$PORTAL_DIR/node_modules"; }; then
      echo "$newsha" > "$FAILED_SHA_FILE"; _swap_rollback "$oldsha" "$ts" 1 "node_modules cutover failed"; return 1
    fi
  fi
  if ! systemctl start "$PORTAL_SERVICE"; then
    echo "$newsha" > "$FAILED_SHA_FILE"; _swap_rollback "$oldsha" "$ts" "$deps_changed" "service failed to start"; return 1
  fi
  sleep 4
  # 6. health-gate; on failure, INSTANT swap-back (no rebuild)
  if ! health_ok; then
    echo "$newsha" > "$FAILED_SHA_FILE"
    _swap_rollback "$oldsha" "$ts" "$deps_changed" "health check failed"; return 1
  fi
  rm -f "$FAILED_SHA_FILE"
  subject=$(git -C "$PORTAL_DIR" log -1 --pretty=%s)
  pnote deploy-log "✅ **$PORTAL_ENV** \`${oldsha:0:7}\` → \`${newsha:0:7}\` — ${subject}"
  log "DEPLOY OK -> ${newsha:0:7}"
  _notify_device_restart "$newsha"   # best-effort; never fails the deploy
  return 0
}
