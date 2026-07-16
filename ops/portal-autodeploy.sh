#!/usr/bin/env bash
# portal-autodeploy.sh — staging auto-deploy poller. Cron: */2 * * * *  (STAGING ONLY)
. /usr/local/bin/portal-lib.sh || exit 1
[ "$PORTAL_ENV" = "staging" ] || { echo "autodeploy runs on staging only (env=$PORTAL_ENV)"; exit 1; }

exec 9>"$DEPLOY_LOCK"
flock -n 9 || exit 0        # a deploy/golive is already running

cd "$PORTAL_DIR" || exit 1

# recover a service left stopped by an interrupted cutover (we hold the deploy lock here,
# so this only fires when no deploy is actually running)
if ! systemctl is-active --quiet "$PORTAL_SERVICE"; then
  log "service not active — starting it"
  systemctl start "$PORTAL_SERVICE"; sleep 3
  if health_ok; then palert "⚠️ **$PORTAL_ENV** service was stopped — restarted, healthy"; else palert "🆘 **$PORTAL_ENV** service was stopped and won't come healthy — MANUAL FIX"; fi
fi

do_fetch || exit 0          # fetch failure is tracked + alerted by do_fetch

classify_state
case "$STATE" in
  uptodate) exit 0 ;;
  behind)
    cand=$(git rev-parse origin/main)
    if [ "$cand" = "$(cat "$FAILED_SHA_FILE" 2>/dev/null)" ]; then
      log "candidate ${cand:0:7} is quarantined (previously failed); waiting for a new commit or manual clear ($FAILED_SHA_FILE)"
      exit 0
    fi
    guarded_deploy ;;
  wrongbranch|dirty|diverged)
    # journald only — the hourly watchdog raises the (deduped) Obsidian alert, so this can't spam every 2 min
    log "refusing to auto-deploy: server drifted ($STATE) — $STATE_DETAIL"
    exit 1 ;;
esac
