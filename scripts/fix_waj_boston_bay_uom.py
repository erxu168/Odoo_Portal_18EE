#!/usr/bin/env python3
"""
Flip product 1581 (WAJ - Boston Bay Jerk Paste with WAJ Jerk Mix) and
BOM 172 from UoM Units (1) to kg (12).

Direct UoM flip is blocked by Odoo's stock-move check (existing done MO
from 2026-04-27 has a stock.move in Units). Path used:
  archive-and-recreate
    1. duplicate product.template 1581 to a new template with uom=kg
    2. find the new product.product variant of that template
    3. repoint BOM 172 to the new template + product, set BOM uom=kg
    4. archive old product 1581

Read-only by default. Pass --execute to write.
"""
from __future__ import annotations
import argparse
import sys
import xmlrpc.client

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

BOM_ID = 172
PROD_ID = 1581
TMPL_ID = 1581
UOM_UNITS = 1
UOM_KG = 12


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true",
                    help="actually write to staging (default = dry-run)")
    args = ap.parse_args()

    common = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/common", allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        sys.exit("auth failed")
    m = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/object", allow_none=True)

    def call(model, method, mids_or_domain, kwargs=None):
        return m.execute_kw(
            ODOO_DB, uid, ODOO_PASSWORD, model, method,
            mids_or_domain, kwargs or {})

    # --- snapshot
    print("=== before ===")
    prod = call("product.product", "read", [[PROD_ID]],
                {"fields": ["id", "display_name", "uom_id", "uom_po_id",
                            "active"]})[0]
    bom = call("mrp.bom", "read", [[BOM_ID]],
               {"fields": ["id", "display_name", "product_qty",
                           "product_uom_id", "product_tmpl_id",
                           "product_id"]})[0]
    print(f"  product 1581: uom={prod['uom_id']} uom_po={prod['uom_po_id']}")
    print(f"  bom 172:      product_qty={bom['product_qty']} "
          f"uom={bom['product_uom_id']}")

    if not args.execute:
        print("\n(dry-run) would archive-and-recreate:")
        print(f"  1. copy product.template[{TMPL_ID}] -> new template "
              f"with uom_id={UOM_KG}, uom_po_id={UOM_KG}, "
              f"name='{prod['display_name']}' (no (copy) suffix)")
        print(f"  2. find the product.product variant of the new template")
        print(f"  3. mrp.bom[{BOM_ID}].write: product_tmpl_id=NEW_TMPL, "
              f"product_id=NEW_PROD, product_uom_id={UOM_KG}")
        print(f"  4. product.template[{TMPL_ID}].write: active=False")
        print("  pass --execute to write")
        return

    print("\n=== archive-and-recreate ===")
    new_tmpl_id = call("product.template", "copy",
                       [[TMPL_ID]], {"default": {
                           "uom_id": UOM_KG,
                           "uom_po_id": UOM_KG,
                           "name": prod["display_name"],
                       }})
    print(f"  copied product.template -> new id {new_tmpl_id}")

    new_prods = call("product.product", "search_read",
                     [[["product_tmpl_id", "=", new_tmpl_id]]],
                     {"fields": ["id", "display_name", "uom_id"]})
    if not new_prods:
        sys.exit(f"new template {new_tmpl_id} has no product variant")
    new_prod_id = new_prods[0]["id"]
    print(f"  new product.product id = {new_prod_id} "
          f"({new_prods[0]['uom_id']})")

    call("mrp.bom", "write", [[BOM_ID], {
        "product_tmpl_id": new_tmpl_id,
        "product_id": new_prod_id,
        "product_uom_id": UOM_KG,
    }])
    print(f"  bom {BOM_ID} repointed to new template + uom=kg")

    call("product.template", "write", [[TMPL_ID], {"active": False}])
    print(f"  product.template {TMPL_ID} archived")

    # --- verify
    print("\n=== after ===")
    bom_after = call("mrp.bom", "read", [[BOM_ID]],
                     {"fields": ["id", "product_qty", "product_uom_id",
                                 "product_tmpl_id", "product_id"]})[0]
    print(f"  bom 172: tmpl={bom_after['product_tmpl_id']}  "
          f"prod={bom_after['product_id']}  "
          f"qty={bom_after['product_qty']}  "
          f"uom={bom_after['product_uom_id']}")
    old_after = call("product.template", "read", [[TMPL_ID]],
                     {"fields": ["id", "active", "name"]})[0]
    print(f"  old template {TMPL_ID}: active={old_after['active']}")


if __name__ == "__main__":
    main()
