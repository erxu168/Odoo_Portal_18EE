# HANDOFF: WAJ Beverage Go-Live on Production Odoo (Claude Code)

## Mission
Finish putting the What a Jerk (WAJ) beverage range into **production Odoo 18 EE**
with correct prices and 19% VAT, then verify the POS can sell them.
Staging (test18ee.krawings.de) already has the complete target state — use it as reference.

## Environment (you are on the production server)
- Server: 128.140.12.188 (ubuntu-2gb-nbg1-1), Odoo 18 EE on localhost only
- RPC: `http://127.0.0.1:15069/jsonrpc`, db `krawings`, uid `2`, login `biz@krawings.de`
- Password: ask Ethan or take from the command history of this job (env var `ODOO_PW`)
- Odoo paths: odoo-bin `/opt/odoo/18.0/odoo-18.0/odoo-bin`, conf `/opt/odoo/18.0/odoo-18.0/odoo.conf`,
  venv `/opt/odoo/18.0/odoo-18.0/venv/bin/python3`, service `odoo-18`
- Repo: `/opt/Odoo_Portal_18EE` (erxu168/Odoo_Portal_18EE, branch main). `git pull` before anything.
- Shell-script pattern: `cat scripts/odoo/<file>.py | sudo -u odoo <venv-python> <odoo-bin> shell -c <conf> -d krawings --no-http`

## Current state (2026-06-12)
1. Production company 5 "What a Jerk" had NO chart of accounts / taxes.
2. `phonenumbers` pip package was installed into the Odoo venv (was blocking account_peppol).
3. `scripts/odoo/install_waj_coa_shell.py` was run: l10n modules installed, country set,
   `chart_template` flag probably set on company 5 — BUT the tax/account creation was
   swallowed by the mid-install registry reset. Tax list printed EMPTY afterwards.
4. `scripts/odoo/repair_waj_coa_shell.py` is committed and NOT yet run. It verifies state
   and re-runs `try_loading('de_skr03', waj)` which reloads the template and creates the taxes.
5. `scripts/odoo/waj_beverage_golive.py` is the main payload (idempotent, has DRY=1 mode).
   It self-heals a missing 19% price-included tax by duplicating a price-excluded 19% one.

## Steps
1. `cd /opt/Odoo_Portal_18EE && git pull`
2. Run `repair_waj_coa_shell.py` via the shell pattern above. Expect a list of 7%/19%
   sale taxes for company 5 ending in `SHELL SCRIPT DONE`.
   - If taxes still come back empty: investigate `account.chart.template._load` behavior in
     `/opt/odoo/18.0/odoo-18.0/odoo/addons/account/models/chart_template.py`; consider
     clearing `chart_template` on company 5 first and re-running try_loading fresh.
3. `DRY=1 ODOO_PW='<pw>' python3 scripts/odoo/waj_beverage_golive.py`
   - Review: tax self-heal should pick/duplicate a 19% incl tax for company 5;
     Caribbean items (Ting/Old Jamaica/Coconut/Hyper Malt/Guinness) should mostly resolve
     to `updated` (they pre-exist); GFGH items mostly `created`.
   - CRITICAL: it must NOT touch any product whose name contains `Mw` (crate purchasing
     products like "Pepsi Cola Mw 24x0,33"). The script filters these; verify in DRY output.
4. Run without DRY. Verify with a quick RPC read that all 18 products have correct
   list_price, standard_price, taxes, available_in_pos=True.
5. Post-checks:
   - WAJ pos.config (id 14): close/reopen session to load products.
   - `l10n_de_pos_cert` is installed — check whether WAJ POS has TSE (fiskaly) configured;
     if not, flag to Ethan BEFORE any real sale (KassenSichV requirement).
   - pos.order count for company 5 must still be the same as before go-live (no test sales).

## Target price list (gross, 19% incl; Pfand 0,25 baked into cans/PET)
2,90: Pepsi, Pepsi Zero, Schwip Schwap Orange, 7UP (0,33L)
2,95: Ting Grapefruit, Ting Tropical, Old Jamaica, Hyper Malt (330ml cans)
3,50: Selters Naturell 0,5L, Selters Medium 0,5L, Clausthaler Classic 0,33L
3,75: Bamboo Tree Coconut Water 330ml
3,90: Club Mate 0,5L
4,50: Augustiner Hell 0,5L, Bueble Bayrisch Hell 0,5L, Schoefferhofer Weizen 0,5L
5,75: Guinness FES 325ml
5,90: BraufactuM The Brale 0,355L

## Hard rules
- All artifacts via GitHub, never edit files directly on the server.
- Do not modify crate (`Mw`) purchasing products, SSAM/Gogi products, or any pricelist.
- Plain ASCII in terminal commands.
- Production writes only for this authorized job; anything beyond scope -> ask Ethan.
- Update this file + STATUS.md at session end with what was done.

## Open items after go-live (separate tasks, do not start unprompted)
- Barcodes: all beverages lack EANs; Ethan will scan cans and provide the list.
- GFGH invoice: Selters/Braufactum/Schwip Schwap/Clausthaler costs are estimates; true up when invoice arrives.
- Sell-through items (Sagiko, Busta, Maaza, extra Ting flavors) exist on staging only; production does not need them unless Unidex stock is booked there.
- MagicINFO menu screens must show prices as "X,XX + 0,25 Pfand" for cans (PAngV) — sync with POS go-live.
