# krawings_pos_close_register

Lets **every POS user close the register — including when there is a cash
difference — without giving them POS Manager (admin) rights**.

## Why

In Odoo 18, a plain *Point of Sale / User* can open and operate the POS, but
when they try to close the register and the counted cash differs from the
expected amount, Odoo blocks them:

> The maximum difference allowed is X.
> Please contact your manager to accept the closing difference.

Only *Point of Sale / Manager* can confirm a close with a difference. We want
all shift staff to close their own register at end of shift without handing out
manager rights.

## How it works

- Adds a security group **"Close Register (cash difference allowed)"**
  (`group_pos_close_register`).
- Makes *Point of Sale / User* imply that group, so **every** staff member who
  can log into the POS gets it automatically — existing users included (Odoo
  propagates implied groups to current members when the link is written on
  install).
- Overrides `pos.session.get_closing_control_data` to return `is_manager=True`
  for members of the new group. In Odoo 18 the closing popup uses `is_manager`
  for exactly one thing — allowing a close with a cash difference
  (`closing_popup.js` → `hasUserAuthority`). Nothing else manager-only is
  exposed; no backend/admin access is granted.

## Deploy

The repo is pulled to `/opt/krawings-odoo-addons` on staging by cron (~60s).

> **First-time gotcha:** cron only runs `git pull` — it does **not** re-create
> symlinks. A brand-new addon folder therefore has no symlink in
> `/opt/odoo/18.0/custom-addons/` yet, so Odoo can't see it. Re-run the
> idempotent setup script once to create the symlink for this new module.

```
# On staging server 89.167.124.0 as root:

# 1. Make sure the latest main is on the server (or wait ~60s for cron):
cd /opt/krawings-odoo-addons && sudo -u odoo git fetch origin main -q \
    && sudo -u odoo git reset --hard origin/main -q

# 2. Symlink the NEW addon folder into custom-addons (idempotent, safe to re-run):
bash /opt/krawings-odoo-addons/scripts/setup_odoo_addons_git.sh
# (or manually:)
# ln -s /opt/krawings-odoo-addons/odoo-addons/krawings_pos_close_register \
#       /opt/odoo/18.0/custom-addons/krawings_pos_close_register
# chown -h odoo:odoo /opt/odoo/18.0/custom-addons/krawings_pos_close_register

# 3. Install the module (first install → -i):
systemctl stop odoo-18
sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
    /opt/odoo/18.0/odoo-18.0/odoo-bin \
    -c /opt/odoo/18.0/odoo-18.0/odoo.conf \
    -d krawings -i krawings_pos_close_register --stop-after-init --no-http
systemctl start odoo-18
```

For later code changes to this addon, use `-u krawings_pos_close_register`
(the symlink already exists after the first install, so step 2 is only needed
once).

## Verify after deploy

1. **Settings → Users & Companies → Groups**: the group *"Close Register (cash
   difference allowed)"* exists and lists all POS staff as members.
2. Log into the POS as a **staff** user (e.g. Hana Kim / Yuki Tanaka), open the
   register, then close it and enter a counted cash amount that differs from the
   expected total. The close should now go through (previously it was blocked
   with the "contact your manager" message).
3. Confirm the staff user still has **no** POS backend/manager access (they
   should not see POS configuration menus).

## Rollback

```
cd /opt/krawings-odoo-addons
# revert the addon code, then uninstall the module in Odoo:
# Apps → Krawings - POS Close Register Access → Uninstall
```

Uninstalling removes the group and the implied link (staff revert to needing a
manager to close with a difference). Uninstalling via the Apps UI is cleaner
than just deleting files, because it also removes the `res.groups` records.
