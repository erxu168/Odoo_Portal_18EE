#!/usr/bin/env python3
"""Install German fiscal localization (chart of accounts + taxes) for the
What a Jerk company on production. Uses the same chart template as the
existing companies (Krawings / SSAM).

Read-only by default. Set RUN=1 to apply.
Usage:
  ODOO_PW='...' python3 setup_waj_company.py          # inspect only
  RUN=1 ODOO_PW='...' python3 setup_waj_company.py    # install CoA
"""
import json, os, sys, urllib.request

URL = os.environ.get("ODOO_URL", "http://127.0.0.1:15069").rstrip("/") + "/jsonrpc"
DB  = os.environ.get("ODOO_DB", "krawings")
UID = int(os.environ.get("ODOO_UID", "2"))
PW  = os.environ.get("ODOO_PW") or sys.exit("ODOO_PW env var required")
RUN = os.environ.get("RUN") == "1"

def rpc(model, method, *args, **kw):
    payload = {"jsonrpc":"2.0","method":"call","params":{
        "service":"object","method":"execute_kw",
        "args":[DB,UID,PW,model,method,list(args),kw]},"id":1}
    req = urllib.request.Request(URL, json.dumps(payload).encode(),
        {"Content-Type":"application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=120).read())
    if "error" in r: raise SystemExit(json.dumps(r["error"], indent=2)[:2000])
    return r["result"]

cos = rpc("res.company","search_read",[],fields=["id","name","chart_template"])
waj = None
template = None
for c in cos:
    print(f'company {c["id"]}: {c["name"]} | chart_template={c.get("chart_template")}')
    if "What a Jerk" in c["name"]: waj = c
    elif c.get("chart_template") and not template: template = c["chart_template"]
if not waj: sys.exit("WAJ company not found")

# any existing POS sales on the tax-less company? (compliance check)
n_orders = rpc("pos.order","search_count",[["company_id","=",waj["id"]]])
print(f'WAJ pos.order count: {n_orders}' + ("  <- WARNING: orders booked without VAT, tell the Steuerberater" if n_orders else "  (clean, no sales yet)"))

if waj.get("chart_template"):
    print(f'WAJ already has chart_template={waj["chart_template"]} - nothing to install.')
    sys.exit(0)
if not template:
    sys.exit("No reference chart template found on other companies")

print(f'plan: install chart template "{template}" for company {waj["id"]} ({waj["name"]})')
if not RUN:
    print("inspect-only mode. Rerun with RUN=1 to apply.")
    sys.exit(0)

rpc("account.chart.template","try_loading",[template, waj["id"]],)
print("chart template installed. verifying taxes...")
taxes = rpc("account.tax","search_read",
    [["type_tax_use","=","sale"],["amount","in",[7.0,19.0]],["company_id","=",waj["id"]]],
    fields=["id","name","amount","price_include"])
for t in taxes:
    print(f'  tax {t["id"]}: {t["name"]} | {t["amount"]}% | incl={t["price_include"]}')
print("done. now run waj_beverage_golive.py (DRY=1 first).")
