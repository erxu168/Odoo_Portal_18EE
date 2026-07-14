#!/usr/bin/env python3
"""Read-only diagnostic: list companies and their sale taxes.
Usage: ODOO_PW='...' python3 diag_companies_taxes.py
"""
import json, os, sys, urllib.request

URL = os.environ.get("ODOO_URL", "http://127.0.0.1:15069").rstrip("/") + "/jsonrpc"
DB  = os.environ.get("ODOO_DB", "krawings")
UID = int(os.environ.get("ODOO_UID", "2"))
PW  = os.environ.get("ODOO_PW") or sys.exit("ODOO_PW env var required")

def rpc(model, method, *args, **kw):
    payload = {"jsonrpc":"2.0","method":"call","params":{
        "service":"object","method":"execute_kw",
        "args":[DB,UID,PW,model,method,list(args),kw]},"id":1}
    req = urllib.request.Request(URL, json.dumps(payload).encode(),
        {"Content-Type":"application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=60).read())
    if "error" in r: raise SystemExit(json.dumps(r["error"], indent=2)[:1500])
    return r["result"]

cos = rpc("res.company","search_read",[],fields=["id","name"])
for c in cos:
    print(f'COMPANY {c["id"]}: {c["name"]}')
    taxes = rpc("account.tax","search_read",
        [["type_tax_use","=","sale"],["company_id","=",c["id"]]],
        fields=["id","name","amount","price_include","active"])
    if not taxes:
        print("   (no sale taxes)")
    for t in taxes:
        print(f'   tax {t["id"]}: {t["name"]} | {t["amount"]}% | incl={t["price_include"]}')
print("--- POS configs ---")
for p in rpc("pos.config","search_read",[],fields=["id","name","company_id"]):
    print(p)
