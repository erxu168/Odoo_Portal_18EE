#!/usr/bin/env python3
"""Inspect the 1 MO for BOM 172 + check if any other place blocks UoM flip."""
import xmlrpc.client
import sys

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

BOM_ID = 172
PROD_ID = 1581
TMPL_ID = 1581


def main():
    common = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/common", allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    m = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/object", allow_none=True)

    def call(model, method, args, kwargs=None):
        return m.execute_kw(
            ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs or {})

    print("=== MOs for BOM 172")
    mos = call("mrp.production", "search_read",
               [[["bom_id", "=", BOM_ID]]],
               {"fields": ["id", "name", "state", "product_qty",
                           "product_uom_id", "date_start"]})
    for mo in mos:
        print(f"  {mo}")

    print("\n=== sale.order.line for product 1581")
    sol_count = call("sale.order.line", "search_count",
                     [[["product_id", "=", PROD_ID]]])
    print(f"  count: {sol_count}")

    print("\n=== purchase.order.line for product 1581")
    pol_count = call("purchase.order.line", "search_count",
                     [[["product_id", "=", PROD_ID]]])
    print(f"  count: {pol_count}")

    print("\n=== quants for product 1581")
    quant_count = call("stock.quant", "search_count",
                       [[["product_id", "=", PROD_ID]]])
    print(f"  count: {quant_count}")

    print("\n=== open stock.move (any state) for product 1581")
    sm = call("stock.move", "search_read",
              [[["product_id", "=", PROD_ID]]],
              {"fields": ["id", "state", "product_qty", "product_uom"]})
    print(f"  count: {len(sm)}")
    for s in sm[:10]:
        print(f"    {s}")

    print("\n=== UoM ids")
    uoms = call("uom.uom", "search_read",
                [[["name", "in", ["kg", "Units", "Unit(s)"]]]],
                {"fields": ["id", "name", "category_id", "factor"]})
    for u in uoms:
        print(f"  {u}")


if __name__ == "__main__":
    main()
