#!/usr/bin/env bash
# portal-drift-check.sh — watchdog. Cron: 17 * * * *  (both servers)
# Alerts Obsidian only when the drift STATE changes (no hourly spam). Never blocks a deploy.
. /usr/local/bin/portal-lib.sh || exit 1
cd "$PORTAL_DIR" || exit 1

# Take the deploy lock only long enough to read a consistent state, then RELEASE it
# (so we never sleep/alert while holding it and stalling autodeploy).
exec 9>"$DEPLOY_LOCK"
flock -n 9 || { log "deploy in progress; skipping drift check"; exit 0; }
do_fetch || { flock -u 9; exit 0; }
classify_state
flock -u 9

problem=""
behind_since="$STATE_DIR/behind-since"
case "$STATE" in
  uptodate) rm -f "$behind_since" ;;
  behind)
    if [ "$PORTAL_ENV" = "staging" ]; then
      cand=$(git rev-parse origin/main)
      if [ "$cand" = "$(cat "$FAILED_SHA_FILE" 2>/dev/null)" ]; then
        problem="behind on a QUARANTINED bad commit ${cand:0:7} — auto-deploy paused; fix or revert the commit"
      else
        now=$(date +%s)
        [ -f "$behind_since" ] || echo "$now" > "$behind_since"
        first=$(cat "$behind_since" 2>/dev/null || echo "$now")
        [ $(( now - first )) -ge 900 ] && problem="behind origin/main for >15min — staging auto-deploy appears stuck"
      fi
    else rm -f "$behind_since"; fi   # production 'behind' is expected (manual go-live)
    ;;
  wrongbranch) problem="on the wrong branch — $STATE_DETAIL"; rm -f "$behind_since" ;;
  dirty)       problem="uncommitted changes on the server — $STATE_DETAIL"; rm -f "$behind_since" ;;
  diverged)    problem="has local commits NOT on GitHub (diverged) — $STATE_DETAIL"; rm -f "$behind_since" ;;
esac

marker="$STATE_DIR/drift-state"
prev=$(cat "$marker" 2>/dev/null || echo "")
if [ -n "$problem" ]; then
  [ "$prev" != "bad:$STATE" ] && { palert "🚨 **$PORTAL_ENV** drift — $problem"; echo "bad:$STATE" > "$marker"; }
else
  { [ -n "$prev" ] && [ "$prev" != "ok" ]; } && pnote drift-alerts "✅ **$PORTAL_ENV** drift cleared — back in sync with GitHub"
  echo "ok" > "$marker"
fi
