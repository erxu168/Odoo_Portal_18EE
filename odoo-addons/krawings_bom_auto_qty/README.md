# krawings_bom_auto_qty

Forces `mrp.bom.product_qty` = `SUM(bom_line_ids.product_qty)` across all
three companies (Krawings, Ssam KBQ, What a Jerk). Locks the field readonly
in the form view and rejects any manual write that disagrees with the sum.

## Versions

- `18.0.3.0.0` — WAJ only (company_id=5).
- `18.0.4.0.0` — All three companies. Adds post-migration that realigns every
  existing BOM where qty != sum (one-shot at upgrade).

## Deploy

This addon is pulled to staging by the cron-based git workflow. After the cron
picks up changes from `main`:

```
# On staging server 89.167.124.0 as root:
systemctl stop odoo-18
sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
    /opt/odoo/18.0/odoo-18.0/odoo-bin \
    -c /opt/odoo/18.0/odoo-18.0/odoo.conf \
    -d krawings -u krawings_bom_auto_qty --stop-after-init --no-http
systemctl start odoo-18
```

For v18.0.4.0.0 specifically: the post-migrate runs during `-u`, realigning
~10 BOMs whose qty currently differs from their line sum.

## Verify after deploy

1. Open any Krawings or Ssam KBQ BOM in the Manufacturing app — Quantity field
   should be greyed out.
2. Edit a line's qty by 1 unit — the BOM total auto-updates on save.
3. KFC Soy Sauce (BOM 122, Krawings) should now read ~122.2 kg, not 15.0.

## Rollback

```
cd /opt/krawings-odoo-addons
git checkout <previous-sha> -- odoo-addons/krawings_bom_auto_qty
systemctl stop odoo-18
sudo -u odoo .../odoo-bin -c .../odoo.conf -d krawings \
    -u krawings_bom_auto_qty --stop-after-init
systemctl start odoo-18
```

Note: rollback restores the addon code, but the post-migrate's qty changes are
not reverted. Take a Postgres snapshot before upgrading if you need a rollback
plan that covers data.
