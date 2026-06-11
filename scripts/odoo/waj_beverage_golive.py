#!/usr/bin/env python3
"""WAJ beverage go-live for Odoo 18 EE production.
- Creates/updates per-unit POS beverage products for What a Jerk
- Leaves crate-unit GFGH purchasing products untouched
- Assigns 19% price-included sale tax (drinks are 19% USt, not 7%)
- Pfand: ensures DPG Pfand product is NOT in POS (price is baked in),
  creates Pfand Rueckgabe -0,25 for can returns
Idempotent. DRY=1 env var prints actions without writing.
Usage:
  DRY=1 ODOO_PW='...' python3 waj_beverage_golive.py   # preview
  ODOO_PW='...' python3 waj_beverage_golive.py          # apply
"""
import json, os, sys, urllib.request

URL = os.environ.get("ODOO_URL", "http://127.0.0.1:15069").rstrip("/") + "/jsonrpc"
DB  = os.environ.get("ODOO_DB", "krawings")
UID = int(os.environ.get("ODOO_UID", "2"))
PW  = os.environ.get("ODOO_PW") or sys.exit("ODOO_PW env var required")
DRY = os.environ.get("DRY") == "1"

def rpc(model, method, *args, **kw):
    payload = {"jsonrpc":"2.0","method":"call","params":{
        "service":"object","method":"execute_kw",
        "args":[DB,UID,PW,model,method,list(args),kw]},"id":1}
    req = urllib.request.Request(URL, json.dumps(payload).encode(),
        {"Content-Type":"application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=60).read())
    if "error" in r: raise SystemExit(json.dumps(r["error"], indent=2)[:1500])
    return r["result"]

def write(model, ids, vals):
    if DRY: print(f"  DRY write {model} {ids}: {vals}"); return
    rpc(model, "write", ids, vals)

def create(model, vals):
    if DRY: print(f"  DRY create {model}: {vals.get('name')}"); return -1
    return rpc(model, "create", vals)

# ---- introspect ----
WAJ = rpc("res.company","search",[["name","ilike","What a Jerk"]])[0]
companies = rpc("res.company","search",[])
tax_by_co = {}
for co in companies:
    t = rpc("account.tax","search",[["type_tax_use","=","sale"],
        ["amount","=",19.0],["price_include","=",True],["company_id","=",co]])
    if t: tax_by_co[co] = t[0]
TAX_WAJ = [(6,0,[tax_by_co[WAJ]])]
TAX_ALL = [(6,0,list(tax_by_co.values()))]
cat = rpc("product.category","search",[["name","=","Soft Drinks"]])
CAT = cat[0] if cat else rpc("product.category","search",[["name","=","All"]])[0]
print(f"env: WAJ={WAJ}, taxes 19% incl={tax_by_co}, categ={CAT}, DRY={DRY}")

def upsert(name, cost, price, taxes, company, match=None):
    """match: optional ilike pattern to find pre-existing record under another name"""
    ids = rpc("product.template","search",[["name","=ilike",name]])
    if not ids and match:
        ids = rpc("product.template","search",
            [["name","ilike",match],["list_price","!=",1.0]]) or \
              rpc("product.template","search",[["name","ilike",match]])
        ids = [i for i in ids if "Mw" not in rpc("product.template","read",[i],fields=["name"])[0]["name"]]
    vals = {"standard_price":cost,"list_price":price,"sale_ok":True,
            "available_in_pos":True,"taxes_id":taxes}
    if ids:
        write("product.template", ids[:1], vals)
        print(f"updated {ids[0]}: {name}  cost {cost}  price {price}")
    else:
        vals.update({"name":name,"type":"consu","categ_id":CAT,"uom_id":1,
                     "uom_po_id":1,"purchase_ok":False,"company_id":company})
        pid = create("product.template", vals)
        print(f"created {pid}: {name}  cost {cost}  price {price}")

# ---- WAJ unit beverage range (final) ----
# (name, cost, gross_price, taxes, company, match_pattern)
RANGE = [
    # Caribbean (landed costs from Unidex/AEF invoices)
    ("Ting Grapefruit Soda 330ml",   0.54, 2.95, TAX_ALL, False, "Ting%Grapefruit"),
    ("Ting Tropical Soda 330ml",     0.54, 2.95, TAX_WAJ, WAJ,   None),
    ("Old Jamaica Ginger Beer 330ml",0.58, 2.95, TAX_ALL, False, "Old Jamaica Ginger"),
    ("Bamboo Tree Coconut Water 330ml",0.85,3.75,TAX_ALL, False, "Coconut Water 330"),
    ("Hyper Malt Malt Drink 330ml",  0.48, 2.95, TAX_ALL, False, "Hyper Malt"),
    ("Guinness Beer 7.5% 325ml",     1.35, 5.75, TAX_ALL, False, "Guinness%325"),
    # GFGH supplier range (unit costs from crate prices)
    ("Selters Naturell 0,5L",        0.65, 3.50, TAX_WAJ, WAJ, None),
    ("Selters Medium 0,5L",          0.65, 3.50, TAX_WAJ, WAJ, None),
    ("Pepsi 0,33L",                  0.70, 2.90, TAX_WAJ, WAJ, None),
    ("Pepsi Zero 0,33L",             0.70, 2.90, TAX_WAJ, WAJ, None),
    ("Schwip Schwap Orange 0,33L",   0.70, 2.90, TAX_WAJ, WAJ, None),
    ("7UP 0,33L",                    0.68, 2.90, TAX_WAJ, WAJ, None),
    ("Clausthaler Classic 0,33L",    0.61, 3.50, TAX_WAJ, WAJ, None),
    ("Club Mate 0,5L",               0.72, 3.90, TAX_WAJ, WAJ, None),
    ("Augustiner Lagerbier Hell 0,5L",0.95,4.50, TAX_WAJ, WAJ, None),
    ("Büble Bayrisch Hell 0,5L",     0.87, 4.50, TAX_WAJ, WAJ, None),
    ("BraufactuM The Brale 0,355L",  1.90, 5.90, TAX_WAJ, WAJ, None),
    ("Schöfferhofer Weizen 0,5L",    0.95, 4.50, TAX_WAJ, WAJ, None),
]
for name,cost,price,taxes,co,match in RANGE:
    upsert(name,cost,price,taxes,co,match)

# ---- Pfand ----
pf = rpc("product.template","search",[["name","ilike","DPG Pfand Dose"]])
if pf:
    write("product.template",pf,{"available_in_pos":False})
    print(f"Pfand {pf}: removed from POS (deposit baked into can prices)")
rg = rpc("product.template","search",[["name","ilike","Pfand R"]])
if not rg:
    pid = create("product.template",{"name":"DPG Pfand Rückgabe -0,25 €",
        "type":"service","list_price":-0.25,"standard_price":0.0,
        "sale_ok":True,"purchase_ok":False,"available_in_pos":True,
        "taxes_id":TAX_ALL,"company_id":False})
    print(f"created {pid}: Pfand Rückgabe -0,25")
else:
    print(f"Pfand Rückgabe exists: {rg}")
print("done.")
