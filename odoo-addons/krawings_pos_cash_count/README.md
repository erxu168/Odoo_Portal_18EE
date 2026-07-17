# krawings_pos_cash_count

Makes the **cash-counting step of POS register closing** faster on the tablet
tills, in two ways.

## What it does

**1. Coins by value _or_ quantity**

Each denomination has a new **"Is a coin"** flag (POS > Configuration >
Coins/Bills). At closing, in the *Coins/Notes* count popup:

- **Coins** show a **Qty / Value** toggle. In **Value** mode staff type the
  total money for that coin — e.g. `4.50` of 5-cent coins — instead of counting
  90 coins. In **Qty** mode they enter a count. Coins default to **Value**.
- **Notes / bills** stay **quantity-only** (no toggle), exactly as before.

The running total and the closing note both reflect this: a value-entered coin
prints as `€4.50 in €0.05 coins` instead of `90 x €0.05`.

**2. No Android keyboard popup — on-screen numpad instead**

The numeric fields are `readonly` + `inputmode="none"`, so tapping them never
raises the tablet's soft keyboard (which used to occlude the popup). Entry is
via:

- the on-screen **numpad** embedded in the popup (tap a field to select it,
  then type), and
- the existing **+ / −** buttons (one coin/note per tap).

> **Scope (Phase 1):** this is limited to the closing cash-count popup
> (`MoneyDetailsPopup`). Extending the no-keyboard + numpad behaviour to the
> rest of the POS (payments, quantities, discounts) is Phase 2 — same
> mechanism, wider reach.

## Install defaults

On install, every existing denomination with value **< 5** is pre-flagged as a
coin (so you don't tick all eight EUR coins by hand). Adjust freely afterwards
in POS > Configuration > Coins/Bills.

## Deploy

Repo is pulled to `/opt/krawings-odoo-addons` on staging by cron (~60s).

> **First-time gotcha:** cron only runs `git pull` — it does **not** create the
> symlink for a brand-new addon folder, so Odoo can't see it yet. Re-run the
> idempotent setup script once.

```bash
# On staging server 89.167.124.0 as root:

# 1. Ensure latest main is on the server (or wait ~60s for cron):
cd /opt/krawings-odoo-addons && sudo -u odoo git fetch origin main -q \
    && sudo -u odoo git reset --hard origin/main -q

# 2. Symlink the NEW addon into custom-addons (idempotent):
bash /opt/krawings-odoo-addons/scripts/setup_odoo_addons_git.sh

# 3. Install the module (first install -> -i), then restart:
systemctl stop odoo-18
sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
    /opt/odoo/18.0/odoo-18.0/odoo-bin \
    -c /opt/odoo/18.0/odoo-18.0/odoo.conf \
    -d <DB> -i krawings_pos_cash_count --stop-after-init
systemctl start odoo-18
```

Then hard-refresh the POS (it recompiles JS/SCSS assets) and open a session's
**Close Register** to test.
