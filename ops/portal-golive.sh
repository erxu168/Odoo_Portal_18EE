#!/usr/bin/env bash
# portal-golive — MANUAL production deploy. Brings this server up to current origin/main
# after an explicit typed confirmation. Installed as /usr/local/bin/portal-golive.
. /usr/local/bin/portal-lib.sh || exit 1
[ -t 0 ] || { echo "golive must be run interactively (a TTY is required)."; exit 1; }

cd "$PORTAL_DIR" || exit 1
echo "Fetching latest from GitHub..."; git fetch origin -q || { echo "fetch failed"; exit 1; }

state=$(classify_state)
case "$state" in
  uptodate) echo "$PORTAL_ENV is already up to date with origin/main ($STATE_DETAIL)."; exit 0 ;;
  behind)   : ;;   # good — proceed
  *) echo "REFUSING: server state is '$state' ($STATE_DETAIL)."; echo "It must be clean on 'main' and simply behind. Investigate before deploying."; exit 1 ;;
esac

old=$(git rev-parse --short HEAD)
new=$(git rev-parse origin/main)
n=$(git rev-list --count HEAD..origin/main)
echo ""
echo "=== $PORTAL_ENV go-live:  $old  ->  ${new:0:7}   ($n new commit(s)) ==="
git log --oneline "HEAD..$new" | head -40
[ "$n" -gt 40 ] && echo "... and $((n-40)) more"
echo ""
[ "$n" -ge 50 ] && echo "⚠️  LARGE JUMP ($n commits): rehearse against a production-data copy and review migrations / env / runtime BEFORE proceeding."
[ "$new" = "$(cat "$FAILED_SHA_FILE" 2>/dev/null)" ] && echo "⚠️  This exact commit previously FAILED a deploy here (quarantined)."
echo ""
printf "Type exactly  'deploy %s'  to proceed: " "${new:0:7}"
read -r ans
[ "$ans" = "deploy ${new:0:7}" ] || { echo "aborted."; exit 0; }

exec 9>"$DEPLOY_LOCK"
flock -n 9 || { echo "another deploy is running; try again shortly."; exit 1; }
guarded_deploy && echo "go-live complete." || { echo "go-live FAILED — see the alert / logs."; exit 1; }
