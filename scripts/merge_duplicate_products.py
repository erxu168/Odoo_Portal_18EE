#!/usr/bin/env python3
"""
Merge approved duplicate product.product records on staging.

For each (loser_id, winner_id) pair:
  - Rewrite mrp.bom.line.product_id loser -> winner
  - Archive loser product.product and its product.template

Usage:
    python3 merge_duplicate_products.py            # dry-run
    python3 merge_duplicate_products.py --execute  # apply
"""

import argparse
import sys
import xmlrpc.client

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

# (loser_id, winner_id, label)
MERGES = [
    (1569, 885, "Brown sugar -> Sugar, brown"),
    (1568, 888, "Black peppercorns, whole -> Black peppercorn, whole"),
    (1579, 944, "Onions, red, fresh -> Onion, red, fresh"),
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
    print(f"=== {mode} — merge approved duplicate products ===\n")

    all_ids = sorted({pid for pair in MERGES for pid in (pair[0], pair[1])})
    products = call(models, uid, "product.product", "read",
                    [all_ids],
                    {"fields": ["id", "name", "active", "product_tmpl_id"],
                     "context": {"active_test": False}})
    by_id = {p["id"]: p for p in products}

    for loser_id, winner_id, label in MERGES:
        print(f"--- {label} ---")
        loser = by_id.get(loser_id)
        winner = by_id.get(winner_id)
        if not loser or not winner:
            print(f"  ERROR: missing product (loser={loser_id} winner={winner_id})")
            continue
        print(f"  loser  id={loser_id}  active={loser['active']}  name={loser['name']!r}")
        print(f"  winner id={winner_id}  active={winner['active']}  name={winner['name']!r}")

        if not winner["active"]:
            print(f"  ERROR: winner {winner_id} is archived — aborting this pair")
            continue

        lines = call(models, uid, "mrp.bom.line", "search_read",
                     [[["product_id", "=", loser_id]]],
                     {"fields": ["id", "product_qty", "product_uom_id", "bom_id"]})
        print(f"  BOM line refs on loser: {len(lines)}")
        for l in lines:
            uom = l["product_uom_id"][1] if l["product_uom_id"] else "?"
            print(f"    line={l['id']}  qty={l['product_qty']} {uom}  bom={l['bom_id']}")

        if lines:
            line_ids = [l["id"] for l in lines]
            if args.execute:
                call(models, uid, "mrp.bom.line", "write",
                     [line_ids, {"product_id": winner_id}])
                print(f"  -> rewrote {len(line_ids)} line(s) to product_id={winner_id}")
            else:
                print(f"  -> would rewrite {len(line_ids)} line(s) to product_id={winner_id}")

        if loser["active"]:
            tmpl_id = loser["product_tmpl_id"][0]
            if args.execute:
                call(models, uid, "product.product", "write",
                     [[loser_id], {"active": False}])
                call(models, uid, "product.template", "write",
                     [[tmpl_id], {"active": False}])
                print(f"  -> archived product.product {loser_id} and template {tmpl_id}")
            else:
                print(f"  -> would archive product.product {loser_id} and template {tmpl_id}")
        else:
            print("  (loser already archived)")
        print()

    if not args.execute:
        print("DRY-RUN complete. Re-run with --execute to apply.")


if __name__ == "__main__":
    main()
