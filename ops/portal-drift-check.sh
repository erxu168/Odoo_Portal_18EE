#!/usr/bin/env bash
# portal-drift-check.sh — watchdog. Cron: 17 * * * *  (both servers)
# Alerts to Obsidian ONLY when the drift state changes (no hourly spam).
. /usr/local/bin/portal-lib.sh || exit 1
cd "$PORTAL_DIR" || exit 1

# Skip while a deploy is running (avoids a false 'behind')
exec 9>"$DEPLOY_LOCK"
flock -n 9 || { log "deploy in progress; skipping drift check"; exit 0; }

git fetch origin -q 2>/dev/null || { log "fetch failed"; exit 0; }
state=$(classify_state)

problem=""
case "$state" in
  uptodate) ;;
  behind)
    if [ "$PORTAL_ENV" = "staging" ]; then
      cand=$(git rev-parse origin/main)
      if [ "$cand" = "$(cat "$FAILED_SHA_FILE" 2>/dev/null)" ]; then
        problem="behind on a QUARANTINED bad commit ${cand:0:7} — auto-deploy paused; fix or revert the commit"
      else
        sleep 30; git fetch origin -q 2>/dev/null
        [ "$(classify_state)" = "behind" ] && problem="behind origin/main for >30s — staging auto-deploy appears stuck"
      fi
    fi   # production 'behind' is expected (manual go-live) — not a problem
    ;;
  wrongbranch) problem="on the wrong branch — $STATE_DETAIL" ;;
  dirty)       problem="uncommitted changes on the server — $STATE_DETAIL" ;;
  diverged)    problem="has local commits NOT on GitHub (diverged) — $STATE_DETAIL" ;;
esac

marker="$STATE_DIR/drift-state"
prev=$(cat "$marker" 2>/dev/null || echo "")
if [ -n "$problem" ]; then
  if [ "$prev" != "bad:$state" ]; then
    palert "🚨 **$PORTAL_ENV** drift — $problem"
    echo "bad:$state" > "$marker"
  fi
else
  if [ -n "$prev" ] && [ "$prev" != "ok" ]; then
    pnote drift-alerts "✅ **$PORTAL_ENV** drift cleared — back in sync with GitHub"
  fi
  echo "ok" > "$marker"
fi
