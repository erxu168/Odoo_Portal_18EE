#!/usr/bin/env python3
"""
Consolidate duplicate allspice/pimento products on staging.

Verified state on 2026-04-27:
  886  "All spice (Pimento), whole"        active   <-- canonical
  1567 "Pimento berries (allspice), whole" active   <-- duplicate, used by 2 BOMs
  1012 "Allspice (Pimento), ground"        archived <-- duplicate, 0 BOM refs

Actions:
  - Rewrite mrp.bom.line.product_id 1567 -> 886
  - Archive product 1567 (active=False) and its product.template
  - Product 1012 already archived; no action needed beyond reporting

Usage:
    python3 replace_pimento_duplicate.py            # dry-run
    python3 replace_pimento_duplicate.py --execute  # apply
"""

import argparse
import sys
import xmlrpc.client

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

# (duplicate product.product id, canonical product.product id or None)
REPLACEMENTS = [
    (1567, 886),   # whole: replace duplicate with canonical
    (1012, None),  # ground: no canonical, expect zero references, just archive
]


def connect():
    common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        sys.exit("ERROR: authentication failed")
    return uid, xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")


def call(models, uid, model, method, args, kwargs=None):
    return models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs or {})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true",
                    help="Apply changes (default is dry-run)")
    args = ap.parse_args()

    uid, models = connect()
    mode = "EXECUTE" if args.execute else "DRY-RUN"
    print(f"=== {mode} — consolidate pimento/allspice duplicates ===\n")

    dup_ids = [d for d, _ in REPLACEMENTS]
    products = call(models, uid, "product.product", "read",
                    [dup_ids],
                    {"fields": ["id", "name", "active", "product_tmpl_id"],
                     "context": {"active_test": False}})
    by_id = {p["id"]: p for p in products}

    for dup_id, canon_id in REPLACEMENTS:
        dup = by_id.get(dup_id)
        if not dup:
            print(f"[{dup_id}] product not found — skipping")
            continue
        print(f"[{dup_id}] {dup['name']!r}  active={dup['active']}")

        lines = call(models, uid, "mrp.bom.line", "search_read",
                     [[["product_id", "=", dup_id]]],
                     {"fields": ["id", "product_qty", "product_uom_id", "bom_id"]})
        print(f"  BOM line refs: {len(lines)}")
        for l in lines:
            uom = l["product_uom_id"][1] if l["product_uom_id"] else "?"
            print(f"    line={l['id']}  qty={l['product_qty']} {uom}  bom={l['bom_id']}")

        if lines:
            if canon_id is None:
                sys.exit(f"ERROR: {dup_id} has BOM refs but no canonical mapping")
            line_ids = [l["id"] for l in lines]
            if args.execute:
                call(models, uid, "mrp.bom.line", "write",
                     [line_ids, {"product_id": canon_id}])
                print(f"  -> rewrote {len(line_ids)} line(s) to product_id={canon_id}")
            else:
                print(f"  -> would rewrite {len(line_ids)} line(s) to product_id={canon_id}")

        if dup["active"]:
            tmpl_id = dup["product_tmpl_id"][0]
            if args.execute:
                call(models, uid, "product.product", "write",
                     [[dup_id], {"active": False}])
                call(models, uid, "product.template", "write",
                     [[tmpl_id], {"active": False}])
                print(f"  -> archived product.product {dup_id} and template {tmpl_id}")
            else:
                print(f"  -> would archive product.product {dup_id} and template {tmpl_id}")
        else:
            print("  (already archived)")
        print()

    if not args.execute:
        print("DRY-RUN complete. Re-run with --execute to apply.")


if __name__ == "__main__":
    main()
