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
mkdir -p /var/lib/portal-sync

if [ ! -f /etc/portal-sync.conf ]; then
  cat > /etc/portal-sync.conf <<EOF
PORTAL_ENV=$ENV
PORTAL_DIR=/opt/krawings-portal
PORTAL_PORT=3000
PORTAL_SERVICE=krawings-portal
HEALTH_PATH=/kiosk
VAULT_DIR=/opt/obsidian-vault
BACKUP_KEEP=10
MIN_FREE_MB=800
EOF
  echo "wrote /etc/portal-sync.conf (ENV=$ENV)"
else
  sed -i "s/^PORTAL_ENV=.*/PORTAL_ENV=$ENV/" /etc/portal-sync.conf
  echo "set PORTAL_ENV=$ENV in existing /etc/portal-sync.conf"
fi

# crons — idempotent: strip our lines then re-add
tmp=$(mktemp)
{ crontab -l 2>/dev/null || true; } | grep -v 'portal-autodeploy\|portal-drift-check' > "$tmp" || true
[ "$ENV" = staging ] && echo '*/2 * * * * /usr/local/bin/portal-autodeploy.sh >> /var/log/portal-autodeploy.log 2>&1' >> "$tmp"
echo '17 * * * * /usr/local/bin/portal-drift-check.sh >> /var/log/portal-drift.log 2>&1' >> "$tmp"
crontab "$tmp"; rm -f "$tmp"

echo "installed for ENV=$ENV. Active portal crons:"
crontab -l | grep -E 'portal-(autodeploy|drift)' || echo "  (none)"
