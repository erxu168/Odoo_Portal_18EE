# krawings_pos_login_person_first

Makes the POS cashier login **person-first**: pick the person, *then* the PIN.

## Why

With employee login (`pos_hr`) enabled, the default unlock screen shows a **PIN
text field _and_ a separate "pick a cashier" button** at the same time. Two
entry modes on one screen is confusing.

## What it does

Tapping **Open / Unlock Register** now goes straight to:

1. the **cashier list** (choose the person), then
2. if that person has a **PIN**, it is requested on the **POS numpad** (no
   Android/OS keyboard),
3. staff **without a PIN** are logged in on selection (unchanged from today),
4. **Cancel** returns to the Open/Unlock Register button.

Badge/barcode cashier login is unaffected. The old PIN-first box is simply never
shown.

## How

A ~10-line patch of the core `LoginScreen` that routes Open/Unlock Register
through the existing, tested `selectCashier(false, true, true)` (list) path
instead of setting `pos.login = true`. **No new PIN-validation logic** — it
reuses `pos_hr`'s `useCashierSelector` mixin, so PIN hashing/checking is
untouched.

- Scoped to configs with `module_pos_hr` enabled; other configs are untouched
  (`super` fallthrough).
- Lives in this GitHub repo (not the server-only `krawings_pos_customization`);
  loads after `pos_hr`, coexists with that addon's login-input tweak.

## Deploy

New addon folder → after `git pull` on staging, re-run the symlink script once,
then install:

```bash
cd /opt/krawings-odoo-addons && sudo -u odoo git fetch origin main -q \
    && sudo -u odoo git reset --hard origin/main -q
bash /opt/krawings-odoo-addons/scripts/setup_odoo_addons_git.sh
systemctl stop odoo-18
cd /tmp && sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
    /opt/odoo/18.0/odoo-18.0/odoo-bin -c /opt/odoo/18.0/odoo-18.0/odoo.conf \
    -d krawings -i krawings_pos_login_person_first --stop-after-init --no-http
systemctl start odoo-18
```

Then force-refresh the POS device (Force stop the app → Clear **cache** →
reopen) so it picks up the new bundle.
