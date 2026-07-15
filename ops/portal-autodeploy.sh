#!/usr/bin/env bash
# portal-autodeploy.sh — staging auto-deploy poller. Cron: */2 * * * *  (STAGING ONLY)
# Pulls origin/main and deploys when it moves. Never touches a drifted server.
. /usr/local/bin/portal-lib.sh || exit 1
[ "$PORTAL_ENV" = "staging" ] || { echo "autodeploy runs on staging only (env=$PORTAL_ENV)"; exit 1; }

exec 9>"$DEPLOY_LOCK"
flock -n 9 || exit 0        # a deploy/golive is already running

cd "$PORTAL_DIR" || exit 1
git fetch origin -q 2>/dev/null || { log "git fetch failed"; exit 0; }

state=$(classify_state)
case "$state" in
  uptodate)
    exit 0 ;;
  behind)
    cand=$(git rev-parse origin/main)
    if [ "$cand" = "$(cat "$FAILED_SHA_FILE" 2>/dev/null)" ]; then
      log "candidate ${cand:0:7} is quarantined (previously failed); waiting for a new commit or manual clear ($FAILED_SHA_FILE)"
      exit 0
    fi
    guarded_deploy ;;
  wrongbranch|dirty|diverged)
    # journald only — the hourly watchdog raises the (deduped) Obsidian alert, so this can't spam every 2 min
    log "refusing to auto-deploy: server drifted ($state) — $STATE_DETAIL"
    exit 1 ;;
esac
