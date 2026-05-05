#!/usr/bin/env python3
"""
Finish the half-done archive-recreate for BOM 172.

State at start:
  - old template 1581: active, Units
  - new template 1589: active, kg (orphan — created last run)
  - bom 172: still pointing to old 1581 / Units

Steps:
  1. Write bom 172 product_tmpl_id = 1589 ONLY  (no product_id, no uom yet)
  2. Write bom 172 product_id = 1589 (new variant)
  3. Write bom 172 product_uom_id = 12 (kg)
  4. Archive old template 1581

Pass --execute to write.
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
OLD_TMPL_ID = 1581
NEW_TMPL_ID = 1589
NEW_PROD_ID = 1589
UOM_KG = 12


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args()

    common = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/common", allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    m = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/object", allow_none=True)

    def call(model, method, args_, kwargs=None):
        return m.execute_kw(
            ODOO_DB, uid, ODOO_PASSWORD, model, method, args_, kwargs or {})

    if not args.execute:
        print("dry-run — would do:")
        print(f"  1. mrp.bom[{BOM_ID}].write product_tmpl_id={NEW_TMPL_ID}")
        print(f"  2. mrp.bom[{BOM_ID}].write product_id={NEW_PROD_ID}")
        print(f"  3. mrp.bom[{BOM_ID}].write product_uom_id={UOM_KG}")
        print(f"  4. product.template[{OLD_TMPL_ID}].write active=False")
        return

    # Step 1
    print(f"step 1: write product_tmpl_id={NEW_TMPL_ID}")
    try:
        call("mrp.bom", "write",
             [[BOM_ID], {"product_tmpl_id": NEW_TMPL_ID}])
        print("  ok")
    except xmlrpc.client.Fault as exc:
        print(f"  failed: {exc.faultString[:500]}")
        sys.exit(1)

    # Step 2
    print(f"step 2: write product_id={NEW_PROD_ID}")
    try:
        call("mrp.bom", "write",
             [[BOM_ID], {"product_id": NEW_PROD_ID}])
        print("  ok")
    except xmlrpc.client.Fault as exc:
        print(f"  failed: {exc.faultString[:500]}")
        # not fatal — original BOM had product_id=False
        print("  continuing — leaving product_id=False is fine")

    # Step 3
    print(f"step 3: write product_uom_id={UOM_KG}")
    try:
        call("mrp.bom", "write",
             [[BOM_ID], {"product_uom_id": UOM_KG}])
        print("  ok")
    except xmlrpc.client.Fault as exc:
        print(f"  failed: {exc.faultString[:500]}")
        sys.exit(1)

    # Step 4
    print(f"step 4: archive old template {OLD_TMPL_ID}")
    try:
        call("product.template", "write", [[OLD_TMPL_ID], {"active": False}])
        print("  ok")
    except xmlrpc.client.Fault as exc:
        print(f"  failed: {exc.faultString[:500]}")
        sys.exit(1)

    print("\n=== final state ===")
    bom = call("mrp.bom", "read", [[BOM_ID]],
               {"fields": ["product_tmpl_id", "product_id", "product_qty",
                           "product_uom_id"]})[0]
    print(f"  bom {BOM_ID}: tmpl={bom['product_tmpl_id']}, "
          f"prod={bom['product_id']}, qty={bom['product_qty']}, "
          f"uom={bom['product_uom_id']}")
    old = call("product.template", "read", [[OLD_TMPL_ID]],
               {"fields": ["active"]})[0]
    print(f"  old template {OLD_TMPL_ID} active={old['active']}")


if __name__ == "__main__":
    main()
