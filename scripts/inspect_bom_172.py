#!/usr/bin/env python3
"""
Read-only inspection of BOM 172 (WAJ Boston Bay Jerk Paste) and its output
product. Reports:
  - BOM header (uom, qty, lines)
  - Output product UoM, posted journal entry count (blocks direct flip)
  - Stock moves on this product (additional block)
  - BOMs where this product appears as an ingredient line
  - Sum of ingredient lines converted to kg (the target output qty)
"""

from __future__ import annotations
import xmlrpc.client
import sys

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

BOM_ID = 172


def main():
    common = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/common", allow_none=True
    )
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        sys.exit("auth failed")
    m = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/object", allow_none=True
    )

    def call(model, method, args, kwargs=None):
        return m.execute_kw(
            ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs or {}
        )

    bom = call("mrp.bom", "read", [[BOM_ID]], {"fields": [
        "id", "display_name", "code", "company_id", "type",
        "product_qty", "product_uom_id",
        "product_id", "product_tmpl_id",
        "bom_line_ids",
    ]})[0]
    print(f"=== BOM {BOM_ID}: {bom['display_name']}")
    print(f"  company:        {bom['company_id']}")
    print(f"  type:           {bom['type']}")
    print(f"  product_qty:    {bom['product_qty']}")
    print(f"  product_uom_id: {bom['product_uom_id']}")
    print(f"  product_tmpl:   {bom['product_tmpl_id']}")
    print(f"  product_id:     {bom['product_id']}")
    print(f"  line count:     {len(bom['bom_line_ids'])}")

    tmpl_id = bom["product_tmpl_id"][0]
    pid = bom["product_id"][0] if bom["product_id"] else None

    if pid is None:
        prod_ids = call("product.product", "search",
                        [[["product_tmpl_id", "=", tmpl_id]]])
        pid = prod_ids[0] if prod_ids else None

    print()
    if pid:
        prod = call("product.product", "read", [[pid]], {"fields": [
            "id", "display_name", "default_code", "uom_id", "uom_po_id",
            "product_tmpl_id", "active", "type", "tracking",
        ]})[0]
        print(f"=== output product.product {pid}")
        print(f"  display_name: {prod['display_name']}")
        print(f"  default_code: {prod['default_code']}")
        print(f"  uom_id:       {prod['uom_id']}")
        print(f"  uom_po_id:    {prod['uom_po_id']}")
        print(f"  active:       {prod['active']}")
        print(f"  type:         {prod['type']}")

    # Posted journal items mentioning this product
    aml_count = call("account.move.line", "search_count",
                     [[["product_id", "=", pid],
                       ["parent_state", "=", "posted"]]])
    print(f"  posted account.move.line count: {aml_count}")

    # Stock moves
    sm_count = call("stock.move", "search_count",
                    [[["product_id", "=", pid],
                      ["state", "=", "done"]]])
    print(f"  done stock.move count:          {sm_count}")

    # Manufacturing orders for this BOM
    mo_count = call("mrp.production", "search_count",
                    [[["bom_id", "=", BOM_ID]]])
    print(f"  mrp.production count for BOM:   {mo_count}")

    # BOMs where this product appears as an ingredient
    line_ids = call("mrp.bom.line", "search",
                    [[["product_id", "=", pid]]])
    print(f"\n  ingredient usage in other BOMs: {len(line_ids)}")
    if line_ids:
        lines = call("mrp.bom.line", "read", [line_ids], {"fields": [
            "id", "bom_id", "product_qty", "product_uom_id",
        ]})
        for ln in lines:
            print(
                f"    bom_line {ln['id']}  bom={ln['bom_id']}  "
                f"qty={ln['product_qty']}  uom={ln['product_uom_id']}"
            )

    # Compute kg sum of ingredient lines
    print(f"\n=== ingredients of BOM {BOM_ID}")
    blines = call("mrp.bom.line", "read", [bom["bom_line_ids"]],
                  {"fields": [
                      "id", "product_id", "product_qty", "product_uom_id",
                  ]})
    uom_ids = list({l["product_uom_id"][0] for l in blines
                    if l["product_uom_id"]})
    uoms = call("uom.uom", "read", [uom_ids], {"fields": [
        "id", "name", "category_id", "factor",
    ]})
    uom_by_id = {u["id"]: u for u in uoms}

    # Find kg uom in same category as the lines (assume Weight)
    weight_categ = None
    for u in uoms:
        if u["name"].lower() == "kg":
            weight_categ = u["category_id"]
            kg = u
            break
    print(f"  weight category: {weight_categ}")

    total_kg = 0.0
    for ln in blines:
        u = uom_by_id[ln["product_uom_id"][0]]
        if u["category_id"] == weight_categ:
            qty_kg = ln["product_qty"] * (u["factor"] / kg["factor"])
            total_kg += qty_kg
            print(
                f"    {ln['product_id'][1]}: "
                f"{ln['product_qty']} {u['name']}  -> {qty_kg:.4f} kg"
            )
        else:
            print(
                f"    [SKIP — non-weight] {ln['product_id'][1]}: "
                f"{ln['product_qty']} {u['name']}"
            )
    print(f"\n  total ingredient kg: {total_kg:.4f}")
    print(f"  current stored qty:  {bom['product_qty']} "
          f"{bom['product_uom_id'][1] if bom['product_uom_id'] else ''}")


if __name__ == "__main__":
    main()
