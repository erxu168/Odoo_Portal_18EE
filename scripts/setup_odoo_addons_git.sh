#!/usr/bin/env bash
# ==============================================================================
# setup_odoo_addons_git.sh
#
# RUN ONCE on staging server 89.167.124.0 as root.
# Sets up the Option B git-based deploy workflow for Krawings Odoo addons.
#
# After this runs, every push to erxu168/Odoo_Portal_18EE main is pulled
# to staging within 60 seconds. Module upgrades (`-u <module>`) still run
# manually per addon README.
#
# What this does:
#   1. Clones erxu168/Odoo_Portal_18EE to /opt/krawings-odoo-addons (separate
#      working tree from the portal at /opt/krawings-portal, on purpose).
#   2. For each subfolder under odoo-addons/ in the repo, replaces the
#      directory at /opt/odoo/18.0/custom-addons/<name> with a symlink to
#      the working tree. Existing dirs are backed up to _backups/.
#   3. Installs an every-minute cron job that does `git pull` on the
#      addons working tree.
#   4. Logs to /var/log/krawings-addons-pull.log
#
# Safe to re-run. Idempotent.
# ==============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: this script must run as root."
    exit 1
fi

REPO_URL="https://github.com/erxu168/Odoo_Portal_18EE.git"
ADDONS_TREE=/opt/krawings-odoo-addons
ODOO_ADDONS_DIR=/opt/odoo/18.0/custom-addons
BACKUP_DIR=/opt/odoo/18.0/custom-addons/_backups
PULL_LOG=/var/log/krawings-addons-pull.log
TS=$(date +%Y%m%d_%H%M%S)

echo "============================================================"
echo "Krawings Odoo addons git deploy setup"
echo "Server: $(hostname)  Time: $(date -Iseconds)"
echo "============================================================"

# ----- 1. Clone or pull the repo -----
mkdir -p "$BACKUP_DIR"
chown odoo:odoo "$BACKUP_DIR"

if [ ! -d "$ADDONS_TREE/.git" ]; then
    echo
    echo "[1/4] Cloning $REPO_URL to $ADDONS_TREE ..."
    # /opt is owned by root. Create the dir as root first, hand it to odoo,
    # then have odoo do the clone (so the working tree files land with the
    # right ownership for the cron-pull step below).
    install -d -o odoo -g odoo -m 0755 "$ADDONS_TREE"
    sudo -u odoo git clone "$REPO_URL" "$ADDONS_TREE"
else
    echo
    echo "[1/4] Working tree exists. Pulling latest ..."
    cd "$ADDONS_TREE"
    sudo -u odoo git fetch origin main
    sudo -u odoo git reset --hard origin/main
fi

cd "$ADDONS_TREE"
echo "Current commit: $(sudo -u odoo git rev-parse --short HEAD) - $(sudo -u odoo git log -1 --format=%s)"

# ----- 2. Symlink each addon folder -----
echo
echo "[2/4] Symlinking addons from $ADDONS_TREE/odoo-addons/ ..."
if [ ! -d "$ADDONS_TREE/odoo-addons" ]; then
    echo "ERROR: $ADDONS_TREE/odoo-addons does not exist in repo. Aborting."
    exit 1
fi

for src in "$ADDONS_TREE/odoo-addons"/*/; do
    name=$(basename "$src")
    target="$ODOO_ADDONS_DIR/$name"
    src_clean=${src%/}

    if [ -L "$target" ]; then
        # Already a symlink. Check it points to the right place.
        current=$(readlink "$target")
        if [ "$current" = "$src_clean" ]; then
            echo "  OK    $name (symlink already correct)"
            continue
        else
            echo "  FIX   $name (symlink points elsewhere: $current)"
            rm "$target"
        fi
    elif [ -d "$target" ]; then
        # Real directory. Back it up before replacing.
        backup="$BACKUP_DIR/${name}.predeploy.${TS}"
        echo "  BACK  $name -> $backup"
        mv "$target" "$backup"
    fi

    ln -s "$src_clean" "$target"
    chown -h odoo:odoo "$target"
    echo "  LINK  $target -> $src_clean"
done

# ----- 3. Install cron job -----
echo
echo "[3/4] Installing cron job for addons working tree pull ..."
CRON_FILE=/etc/cron.d/krawings-odoo-addons-pull
cat > "$CRON_FILE" << CRON
# Krawings Odoo addons git auto-pull (Option B deploy workflow)
# Pulls erxu168/Odoo_Portal_18EE main into $ADDONS_TREE every minute.
# Module upgrades (-u <module>) still run manually per addon README.
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

* * * * * odoo cd $ADDONS_TREE && git fetch origin main -q && git reset --hard origin/main -q >> $PULL_LOG 2>&1
CRON
chmod 644 "$CRON_FILE"
touch "$PULL_LOG"
chown odoo:odoo "$PULL_LOG"
systemctl reload cron 2>/dev/null || service cron reload 2>/dev/null || true
echo "Installed: $CRON_FILE"
echo "Log:       $PULL_LOG"

# ----- 4. Show final state -----
echo
echo "[4/4] Final state of $ODOO_ADDONS_DIR"
ls -la "$ODOO_ADDONS_DIR" | grep -E '^l' || echo "(no symlinks yet)"

echo
echo "============================================================"
echo "Setup complete."
echo "============================================================"
echo
echo "NEXT STEPS for deploying krawings_bom_auto_qty 18.0.4.0.0:"
echo
echo "  systemctl stop odoo-18"
echo "  sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \\"
echo "      /opt/odoo/18.0/odoo-18.0/odoo-bin \\"
echo "      -c /opt/odoo/18.0/odoo-18.0/odoo.conf \\"
echo "      -d krawings -u krawings_bom_auto_qty --stop-after-init --no-http"
echo "  systemctl start odoo-18"
echo
echo "Future addon updates: just push to GitHub. Cron picks it up within 60s."
echo "Then run -u <module> on staging to apply the upgrade."
