# krawings_shelf_life — Odoo 18 addon

Adds two integer fields to `product.template`:
- `x_shelf_life_chilled_days`
- `x_shelf_life_frozen_days`

Both default to 0 (not set). The Krawings portal reads these and uses them to compute the expiry date on printed labels.

## Install

1. Copy this whole folder to the Odoo addons path on the staging Odoo 18 server:
   ```
   scp -r tmp/krawings_shelf_life/ <user>@<odoo-host>:/opt/odoo/18.0/custom-addons/
   ```
2. Restart Odoo:
   ```
   sudo systemctl restart odoo-18
   ```
3. In Odoo: Apps → Update Apps List → search "Krawings Shelf Life" → Install.
4. Verify: open any product → Inventory tab → confirm a "Shelf Life (Krawings)" group with the two integer fields.
