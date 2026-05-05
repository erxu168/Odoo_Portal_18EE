#!/usr/bin/env python3
"""Read full metadata of product.template 1581 + product.product 1581
so we can copy it faithfully to a new kg product."""
import xmlrpc.client
import json

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

common = xmlrpc.client.ServerProxy(
    f"{ODOO_URL}/xmlrpc/2/common", allow_none=True)
uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
m = xmlrpc.client.ServerProxy(
    f"{ODOO_URL}/xmlrpc/2/object", allow_none=True)


def call(model, method, args, kwargs=None):
    return m.execute_kw(
        ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs or {})


fields_tmpl = [
    "name", "default_code", "type", "categ_id", "company_id",
    "uom_id", "uom_po_id", "active", "list_price", "standard_price",
    "purchase_ok", "sale_ok", "tracking", "description",
    "description_purchase", "description_sale",
    "barcode", "weight", "volume", "responsible_id",
    "route_ids", "taxes_id", "supplier_taxes_id",
]
tmpl = call("product.template", "read", [[1581]],
            {"fields": fields_tmpl})[0]
print("=== product.template 1581")
print(json.dumps(tmpl, indent=2, default=str))

prod = call("product.product", "search_read",
            [[["product_tmpl_id", "=", 1581]]],
            {"fields": ["id", "default_code", "barcode", "active"]})
print("\n=== product.product variants")
print(json.dumps(prod, indent=2, default=str))
