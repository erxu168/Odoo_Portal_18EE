#!/usr/bin/env python3
"""Check which fields exist on each model in both Odoo instances."""
import requests
import os
import sys

def load_env():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
    if os.path.exists(env_path):
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    os.environ.setdefault(key.strip(), val.strip())

load_env()

def get_fields(url, db, login, password, label):
    s = requests.Session()
    r = s.post(f'{url}/web/session/authenticate', json={
        'jsonrpc': '2.0', 'id': 1, 'method': 'call',
        'params': {'db': db, 'login': login, 'password': password}
    }, timeout=15)
    uid = r.json().get('result', {}).get('uid')
    if not uid:
        print(f'  AUTH FAILED on {label}')
        return {}
    print(f'  [{label}] UID {uid}')

    models = [
        'product.template', 'product.product', 'product.category',
        'mrp.bom', 'mrp.bom.line', 'mrp.routing.workcenter',
        'mrp.workcenter', 'uom.uom', 'uom.category', 'account.tax'
    ]
    result = {}
    for model in models:
        try:
            r = s.post(f'{url}/web/dataset/call_kw', json={
                'jsonrpc': '2.0', 'id': 2, 'method': 'call',
                'params': {
                    'model': model, 'method': 'fields_get',
                    'args': [],
                    'kwargs': {'attributes': ['string', 'type', 'relation']}
                }
            }, timeout=15)
            data = r.json()
            if data.get('error'):
                print(f'  {model}: ERROR')
                result[model] = {}
            else:
                fields = data.get('result', {})
                result[model] = fields
                print(f'  {model}: {len(fields)} fields')
        except Exception as e:
            print(f'  {model}: {e}')
            result[model] = {}
    return result

print('=' * 60)
print('ODOO 19 CE (Source)')
print('=' * 60)
src = get_fields(
    os.environ.get('SOURCE_ODOO_URL', 'http://65.109.6.237:7071'),
    os.environ.get('SOURCE_ODOO_DB', 'odoo19'),
    os.environ.get('SOURCE_ODOO_USER', 'biz@krawings.de'),
    os.environ.get('SOURCE_ODOO_PASSWORD', ''),
    'Odoo 19'
)

print()
print('=' * 60)
print('ODOO 18 EE (Target)')
print('=' * 60)
tgt = get_fields(
    os.environ.get('ODOO_URL', 'http://localhost:15069'),
    os.environ.get('ODOO_DB', 'krawings'),
    os.environ.get('ODOO_USER', 'biz@krawings.de'),
    os.environ.get('ODOO_PASSWORD', ''),
    'Odoo 18'
)

needed = {
    'product.template': ['name', 'default_code', 'categ_id', 'uom_id', 'uom_po_id',
                         'type', 'list_price', 'standard_price', 'active',
                         'taxes_id', 'supplier_taxes_id', 'sale_ok', 'purchase_ok',
                         'detailed_type', 'product_type'],
    'product.product': ['name', 'default_code', 'product_tmpl_id', 'categ_id', 'uom_id',
                        'uom_po_id', 'type', 'list_price', 'standard_price', 'active',
                        'taxes_id', 'supplier_taxes_id'],
    'product.category': ['name', 'parent_id', 'complete_name'],
    'mrp.bom': ['product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id',
                'code', 'type', 'bom_line_ids', 'operation_ids', 'active',
                'ready_to_produce', 'consumption'],
    'mrp.bom.line': ['product_id', 'product_qty', 'product_uom_id', 'bom_id',
                     'operation_id', 'sequence'],
    'mrp.routing.workcenter': ['name', 'workcenter_id', 'sequence', 'time_cycle_manual',
                                'bom_id', 'note', 'time_mode', 'time_mode_batch',
                                'description'],
    'mrp.workcenter': ['name', 'code', 'active', 'time_start', 'time_stop',
                       'time_efficiency', 'capacity', 'oee_target'],
    'uom.uom': ['name', 'category_id', 'factor', 'factor_inv', 'uom_type', 'rounding', 'active'],
    'uom.category': ['name'],
    'account.tax': ['name', 'type_tax_use', 'amount_type', 'amount', 'active'],
}

print()
print('=' * 60)
print('FIELD COMPARISON')
print('=' * 60)
for model, fields in needed.items():
    print(f'\n--- {model} ---')
    sf = src.get(model, {})
    tf = tgt.get(model, {})
    for f in fields:
        in_s = f in sf
        in_t = f in tf
        if in_s and in_t:
            st = 'BOTH'
        elif in_s:
            st = 'SRC ONLY'
        elif in_t:
            st = 'TGT ONLY'
        else:
            st = 'NEITHER'
        print(f'  {f:30s} {sf.get(f,{}).get("type","-"):12s} {tf.get(f,{}).get("type","-"):12s} {st}')

print()
print('=' * 60)
print('SAFE FIELDS (exist in BOTH Odoo 19 CE and 18 EE)')
print('=' * 60)
for model, fields in needed.items():
    sf = src.get(model, {})
    tf = tgt.get(model, {})
    safe = [f for f in fields if f in sf and f in tf]
    print(f'{model}: {safe}')
