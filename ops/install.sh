#!/usr/bin/env bash
# install.sh — install/refresh the portal auto-sync system on THIS server.
# Usage: sudo bash ops/install.sh <staging|production>
set -eu
ENV="${1:-}"; case "$ENV" in staging|production) ;; *) echo "usage: install.sh <staging|production>"; exit 1;; esac
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)

install -m 0755 "$REPO_DIR/ops/portal-lib.sh"         /usr/local/bin/portal-lib.sh
install -m 0755 "$REPO_DIR/ops/portal-autodeploy.sh"  /usr/local/bin/portal-autodeploy.sh
install -m 0755 "$REPO_DIR/ops/portal-drift-check.sh" /usr/local/bin/portal-drift-check.sh
install -m 0755 "$REPO_DIR/ops/portal-golive.sh"      /usr/local/bin/portal-golive

# root-only dirs for logs, locks, state (0700 so predictable paths can't be hijacked)
install -d -m 0700 /var/log/portal-sync /var/lib/portal-sync /run/portal-sync
# keep /run/portal-sync across reboots (it's tmpfs)
echo 'd /run/portal-sync 0700 root root -' > /etc/tmpfiles.d/portal-sync.conf
systemd-tmpfiles --create /etc/tmpfiles.d/portal-sync.conf 2>/dev/null || true
# pre-create lock files root-owned 0600
for L in deploy.lock vault.lock; do : > "/run/portal-sync/$L"; chmod 0600 "/run/portal-sync/$L"; done

# per-env DB-backed health route (which company exists differs staging vs prod)
if [ "$ENV" = staging ]; then HP='/api/kiosk/staff?company_id=6'; else HP='/api/kiosk/staff?company_id=5'; fi

# always write a fresh, correct config (values are all derived — no manual edits expected)
cat > /etc/portal-sync.conf <<EOF
PORTAL_ENV=$ENV
PORTAL_DIR=/opt/krawings-portal
PORTAL_PORT=3000
PORTAL_SERVICE=krawings-portal
HEALTH_PATH=$HP
HEALTH_EXPECT="staff"
VAULT_DIR=/opt/obsidian-vault
BACKUP_KEEP=10
MIN_FREE_MB=800
EOF
grep -q "^PORTAL_ENV=$ENV$" /etc/portal-sync.conf || { echo "ERROR: could not set PORTAL_ENV in config"; exit 1; }
echo "wrote /etc/portal-sync.conf (ENV=$ENV, HEALTH_PATH=$HP)"

# crons — idempotent: strip our lines then re-add
tmp=$(mktemp)
{ crontab -l 2>/dev/null || true; } | grep -v 'portal-autodeploy\|portal-drift-check' > "$tmp" || true
[ "$ENV" = staging ] && echo '*/2 * * * * /usr/local/bin/portal-autodeploy.sh >> /var/log/portal-sync/autodeploy.log 2>&1' >> "$tmp"
echo '17 * * * * /usr/local/bin/portal-drift-check.sh >> /var/log/portal-sync/drift.log 2>&1' >> "$tmp"
crontab "$tmp"; rm -f "$tmp"

# create the isolated build workspace (idempotent; a git worktree of the source repo)
# shellcheck disable=SC1091
. /usr/local/bin/portal-lib.sh
if ensure_build_dir; then echo "build workspace ready: $BUILD_DIR"; else echo "WARN: build workspace not created yet (will be created on first deploy)"; fi

echo "installed for ENV=$ENV. Active portal crons:"
crontab -l | grep -E 'portal-(autodeploy|drift)' || echo "  (none)"
