#!/usr/bin/env python3
"""Check current state after partial archive-recreate failure."""
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


# old template
old = call("product.template", "read", [[1581]],
           {"fields": ["id", "name", "active", "uom_id"]})[0]
print("old template 1581:", old)

new_tmpls = call("product.template", "search_read",
                 [[["id", "=", 1589]]],
                 {"fields": ["id", "name", "active", "uom_id"]})
print("new template 1589:", new_tmpls)

new_prods = call("product.product", "search_read",
                 [[["product_tmpl_id", "=", 1589]]],
                 {"fields": ["id", "name", "default_code", "uom_id"]})
print("new product variants of 1589:", new_prods)

bom = call("mrp.bom", "read", [[172]],
           {"fields": ["id", "product_tmpl_id", "product_id",
                       "product_qty", "product_uom_id"]})[0]
print("bom 172:", bom)
