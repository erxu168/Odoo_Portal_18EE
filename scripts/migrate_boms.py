#!/usr/bin/env python3
"""
BOM Migration: Odoo 19 CE -> Odoo 18 EE
========================================
Migrates BOMs and all dependent records:
  - Product categories
  - Units of measure (UoM categories + UoMs)
  - Products (product.template + product.product)
  - Work centers
  - Taxes
  - BOMs (mrp.bom)
  - BOM lines (mrp.bom.line)
  - Operations (mrp.routing.workcenter)

Matches by name to avoid duplicates.
Safe to run multiple times.

Usage:
  python3 scripts/migrate_boms.py --dry-run   # preview only
  python3 scripts/migrate_boms.py             # run for real
"""

import requests
import json
import sys
import os

# Load from .env.local if present
def load_env():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    os.environ.setdefault(key.strip(), val.strip())

load_env()

# CONFIG
SOURCE = {
    'url': os.environ.get('SOURCE_ODOO_URL', 'http://65.109.6.237:7071'),
    'db': os.environ.get('SOURCE_ODOO_DB', 'odoo19'),
    'login': os.environ.get('SOURCE_ODOO_USER', 'biz@krawings.de'),
    'password': os.environ.get('SOURCE_ODOO_PASSWORD', ''),
}

TARGET = {
    'url': os.environ.get('ODOO_URL', 'http://localhost:15069'),
    'db': os.environ.get('ODOO_DB', 'krawings'),
    'login': os.environ.get('ODOO_USER', 'biz@krawings.de'),
    'password': os.environ.get('ODOO_PASSWORD', ''),
}

DRY_RUN = '--dry-run' in sys.argv


class OdooRPC:
    def __init__(self, config, label):
        self.url = config['url']
        self.db = config['db']
        self.login = config['login']
        self.password = config['password']
        self.label = label
        self.session = requests.Session()
        self.uid = None

    def authenticate(self):
        r = self.session.post(f'{self.url}/web/session/authenticate', json={
            'jsonrpc': '2.0', 'id': 1, 'method': 'call',
            'params': {'db': self.db, 'login': self.login, 'password': self.password}
        })
        data = r.json()
        if data.get('error'):
            raise Exception(f"Auth failed on {self.label}: {data['error']['data']['message']}")
        self.uid = data['result'].get('uid')
        if not self.uid:
            raise Exception(f"Auth failed on {self.label}: no UID returned")
        print(f"  [{self.label}] Authenticated as UID {self.uid}")

    def search_read(self, model, domain=None, fields=None, limit=0, order='id asc'):
        r = self.session.post(f'{self.url}/web/dataset/call_kw', json={
            'jsonrpc': '2.0', 'id': 2, 'method': 'call',
            'params': {
                'model': model, 'method': 'search_read',
                'args': [domain or []],
                'kwargs': {
                    'fields': fields or [],
                    'limit': limit,
                    'order': order,
                    'context': {'active_test': False, 'lang': 'en_US'},
                }
            }
        })
        result = r.json()
        if result.get('error'):
            raise Exception(f"search_read {model} on {self.label}: {result['error']['data']['message']}")
        return result.get('result', [])

    def create(self, model, vals):
        r = self.session.post(f'{self.url}/web/dataset/call_kw', json={
            'jsonrpc': '2.0', 'id': 3, 'method': 'call',
            'params': {
                'model': model, 'method': 'create',
                'args': [vals],
                'kwargs': {'context': {'lang': 'en_US'}}
            }
        })
        result = r.json()
        if result.get('error'):
            raise Exception(f"create {model} on {self.label}: {result['error']['data']['message']}")
        return result.get('result')


def find_or_create(target, model, name_field, name_value, create_vals):
    existing = target.search_read(model, [[name_field, '=', name_value]], ['id'], limit=1)
    if existing:
        return existing[0]['id']
    if DRY_RUN:
        print(f"    [DRY RUN] Would create {model}: {name_value}")
        return -1
    new_id = target.create(model, create_vals)
    print(f"    Created {model}: {name_value} (ID {new_id})")
    return new_id


def migrate():
    print('=' * 60)
    print('BOM Migration: Odoo 19 CE -> Odoo 18 EE')
    print('=' * 60)
    if DRY_RUN:
        print('*** DRY RUN MODE ***\n')

    if not SOURCE['password']:
        print('ERROR: Set SOURCE_ODOO_PASSWORD in .env.local or environment')
        sys.exit(1)
    if not TARGET['password']:
        print('ERROR: Set ODOO_PASSWORD in .env.local or environment')
        sys.exit(1)

    print('\n1. Connecting...')
    source = OdooRPC(SOURCE, 'SOURCE (Odoo 19)')
    target = OdooRPC(TARGET, 'TARGET (Odoo 18)')
    source.authenticate()
    target.authenticate()

    # Read BOMs
    print('\n2. Reading BOMs from Odoo 19 CE...')
    src_boms = source.search_read('mrp.bom', [['active', '=', True]], [
        'product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id',
        'code', 'type', 'bom_line_ids', 'operation_ids', 'active',
    ])
    print(f'   Found {len(src_boms)} active BOMs')
    if not src_boms:
        print('   No BOMs to migrate. Done.')
        return

    # Collect all dependent IDs
    print('\n3. Collecting dependent data...')

    all_line_ids = []
    for bom in src_boms:
        all_line_ids.extend(bom.get('bom_line_ids', []))
    src_lines = source.search_read('mrp.bom.line', [['id', 'in', all_line_ids]], [
        'product_id', 'product_qty', 'product_uom_id', 'bom_id', 'operation_id',
    ]) if all_line_ids else []
    print(f'   BOM lines: {len(src_lines)}')

    all_op_ids = []
    for bom in src_boms:
        all_op_ids.extend(bom.get('operation_ids', []))
    src_operations = source.search_read('mrp.routing.workcenter', [['id', 'in', all_op_ids]], [
        'name', 'workcenter_id', 'sequence', 'time_cycle_manual', 'bom_id', 'note',
    ]) if all_op_ids else []
    print(f'   Operations: {len(src_operations)}')

    # Product templates from BOMs
    tmpl_ids = set()
    for bom in src_boms:
        if bom.get('product_tmpl_id'):
            tmpl_ids.add(bom['product_tmpl_id'][0])

    # Products from BOM lines
    product_ids = set()
    for line in src_lines:
        if line.get('product_id'):
            product_ids.add(line['product_id'][0])

    src_templates = source.search_read('product.template', [['id', 'in', list(tmpl_ids)]], [
        'name', 'default_code', 'categ_id', 'uom_id', 'uom_po_id',
        'type', 'list_price', 'standard_price', 'active',
        'taxes_id', 'supplier_taxes_id',
    ]) if tmpl_ids else []
    print(f'   Product templates (BOM products): {len(src_templates)}')

    src_products = source.search_read('product.product', [['id', 'in', list(product_ids)]], [
        'name', 'default_code', 'product_tmpl_id', 'categ_id', 'uom_id', 'uom_po_id',
        'type', 'list_price', 'standard_price', 'active',
        'taxes_id', 'supplier_taxes_id',
    ]) if product_ids else []
    print(f'   Products (components): {len(src_products)}')

    # Component templates not already in BOM templates
    comp_tmpl_ids = set()
    for p in src_products:
        if p.get('product_tmpl_id'):
            comp_tmpl_ids.add(p['product_tmpl_id'][0])
    comp_tmpl_ids -= tmpl_ids

    src_comp_templates = source.search_read('product.template', [['id', 'in', list(comp_tmpl_ids)]], [
        'name', 'default_code', 'categ_id', 'uom_id', 'uom_po_id',
        'type', 'list_price', 'standard_price', 'active',
        'taxes_id', 'supplier_taxes_id',
    ]) if comp_tmpl_ids else []
    print(f'   Product templates (components): {len(src_comp_templates)}')

    all_templates = src_templates + src_comp_templates

    # Categories
    categ_ids = set()
    for t in all_templates:
        if t.get('categ_id'):
            categ_ids.add(t['categ_id'][0])
    src_categories = source.search_read('product.category', [['id', 'in', list(categ_ids)]], [
        'name', 'parent_id', 'complete_name',
    ]) if categ_ids else []
    print(f'   Categories: {len(src_categories)}')

    # UoMs
    uom_ids = set()
    for t in all_templates:
        if t.get('uom_id'): uom_ids.add(t['uom_id'][0])
        if t.get('uom_po_id'): uom_ids.add(t['uom_po_id'][0])
    for bom in src_boms:
        if bom.get('product_uom_id'): uom_ids.add(bom['product_uom_id'][0])
    for line in src_lines:
        if line.get('product_uom_id'): uom_ids.add(line['product_uom_id'][0])
    src_uoms = source.search_read('uom.uom', [['id', 'in', list(uom_ids)]], [
        'name', 'category_id', 'factor', 'factor_inv', 'uom_type', 'rounding', 'active',
    ]) if uom_ids else []
    print(f'   UoMs: {len(src_uoms)}')

    uom_categ_ids = set()
    for u in src_uoms:
        if u.get('category_id'):
            uom_categ_ids.add(u['category_id'][0])
    src_uom_categs = source.search_read('uom.category', [['id', 'in', list(uom_categ_ids)]], [
        'name',
    ]) if uom_categ_ids else []
    print(f'   UoM categories: {len(src_uom_categs)}')

    # Work centers
    wc_ids = set()
    for op in src_operations:
        if op.get('workcenter_id'):
            wc_ids.add(op['workcenter_id'][0])
    src_workcenters = source.search_read('mrp.workcenter', [['id', 'in', list(wc_ids)]], [
        'name', 'code', 'active', 'time_start', 'time_stop', 'time_efficiency',
        'capacity', 'oee_target',
    ]) if wc_ids else []
    print(f'   Work centers: {len(src_workcenters)}')

    # Taxes
    tax_ids = set()
    for t in all_templates:
        tax_ids.update(t.get('taxes_id', []))
        tax_ids.update(t.get('supplier_taxes_id', []))
    src_taxes = source.search_read('account.tax', [['id', 'in', list(tax_ids)]], [
        'name', 'type_tax_use', 'amount_type', 'amount', 'active',
    ]) if tax_ids else []
    print(f'   Taxes: {len(src_taxes)}')

    # ============================================================
    # Step 4: Create in target
    # ============================================================
    print('\n4. Migrating to Odoo 18 EE...')

    uom_categ_map = {}
    uom_map = {}
    categ_map = {}
    tax_map = {}
    tmpl_map = {}
    product_map = {}
    wc_map = {}
    bom_map = {}
    op_map = {}

    # 4a: UoM categories
    print('\n   4a. UoM categories...')
    for uc in src_uom_categs:
        uom_categ_map[uc['id']] = find_or_create(target, 'uom.category', 'name', uc['name'], {
            'name': uc['name'],
        })

    # 4b: UoMs
    print('\n   4b. Units of measure...')
    for u in src_uoms:
        target_categ = uom_categ_map.get(u['category_id'][0]) if u.get('category_id') else False
        uom_map[u['id']] = find_or_create(target, 'uom.uom', 'name', u['name'], {
            'name': u['name'],
            'category_id': target_categ,
            'factor': u.get('factor', 1.0),
            'factor_inv': u.get('factor_inv', 1.0),
            'uom_type': u.get('uom_type', 'bigger'),
            'rounding': u.get('rounding', 0.01),
            'active': True,
        })

    # 4c: Product categories
    print('\n   4c. Product categories...')
    for cat in src_categories:
        categ_map[cat['id']] = find_or_create(target, 'product.category', 'name', cat['name'], {
            'name': cat['name'],
        })

    # 4d: Taxes
    print('\n   4d. Taxes...')
    for tax in src_taxes:
        tax_map[tax['id']] = find_or_create(target, 'account.tax', 'name', tax['name'], {
            'name': tax['name'],
            'type_tax_use': tax.get('type_tax_use', 'sale'),
            'amount_type': tax.get('amount_type', 'percent'),
            'amount': tax.get('amount', 0),
            'active': True,
        })

    # 4e: Product templates
    print('\n   4e. Product templates...')
    for t in all_templates:
        target_uom = uom_map.get(t['uom_id'][0]) if t.get('uom_id') else False
        target_po_uom = uom_map.get(t['uom_po_id'][0]) if t.get('uom_po_id') else False
        target_categ = categ_map.get(t['categ_id'][0]) if t.get('categ_id') else False
        target_taxes = [tax_map[tid] for tid in t.get('taxes_id', []) if tid in tax_map]
        target_supplier_taxes = [tax_map[tid] for tid in t.get('supplier_taxes_id', []) if tid in tax_map]

        vals = {
            'name': t['name'],
            'type': t.get('type', 'consu'),
            'list_price': t.get('list_price', 0),
            'standard_price': t.get('standard_price', 0),
            'active': True,
        }
        if t.get('default_code'): vals['default_code'] = t['default_code']
        if target_uom: vals['uom_id'] = target_uom
        if target_po_uom: vals['uom_po_id'] = target_po_uom
        if target_categ: vals['categ_id'] = target_categ
        if target_taxes: vals['taxes_id'] = [(6, 0, target_taxes)]
        if target_supplier_taxes: vals['supplier_taxes_id'] = [(6, 0, target_supplier_taxes)]

        match_field = 'default_code' if t.get('default_code') else 'name'
        match_value = t.get('default_code') or t['name']

        tmpl_map[t['id']] = find_or_create(target, 'product.template', match_field, match_value, vals)

    # 4f: Product variants
    print('\n   4f. Mapping product variants...')
    for p in src_products:
        src_tmpl_id = p['product_tmpl_id'][0] if p.get('product_tmpl_id') else None
        if src_tmpl_id and src_tmpl_id in tmpl_map:
            target_tmpl_id = tmpl_map[src_tmpl_id]
            if target_tmpl_id and target_tmpl_id > 0:
                target_prods = target.search_read('product.product',
                    [['product_tmpl_id', '=', target_tmpl_id]], ['id'], limit=1)
                if target_prods:
                    product_map[p['id']] = target_prods[0]['id']
                    continue

        target_prods = target.search_read('product.product',
            [['name', '=', p['name']]], ['id'], limit=1)
        if target_prods:
            product_map[p['id']] = target_prods[0]['id']
        elif not DRY_RUN:
            target_uom = uom_map.get(p['uom_id'][0]) if p.get('uom_id') else False
            target_categ = categ_map.get(p['categ_id'][0]) if p.get('categ_id') else False
            vals = {'name': p['name'], 'type': p.get('type', 'consu'), 'active': True}
            if p.get('default_code'): vals['default_code'] = p['default_code']
            if target_uom: vals['uom_id'] = target_uom
            if target_categ: vals['categ_id'] = target_categ
            tmpl_id = target.create('product.template', vals)
            print(f"    Created product.template: {p['name']} (ID {tmpl_id})")
            target_prods = target.search_read('product.product',
                [['product_tmpl_id', '=', tmpl_id]], ['id'], limit=1)
            if target_prods:
                product_map[p['id']] = target_prods[0]['id']
        else:
            print(f"    [DRY RUN] Would create product: {p['name']}")
            product_map[p['id']] = -1
    print(f'   Mapped {len(product_map)} product variants')

    # 4g: Work centers
    print('\n   4g. Work centers...')
    for wc in src_workcenters:
        wc_map[wc['id']] = find_or_create(target, 'mrp.workcenter', 'name', wc['name'], {
            'name': wc['name'],
            'code': wc.get('code', ''),
            'active': True,
            'time_start': wc.get('time_start', 0),
            'time_stop': wc.get('time_stop', 0),
            'time_efficiency': wc.get('time_efficiency', 100),
            'capacity': wc.get('capacity', 1),
            'oee_target': wc.get('oee_target', 90),
        })

    # 4h: BOMs
    print('\n   4h. Bills of Materials...')
    for bom in src_boms:
        src_tmpl_id = bom['product_tmpl_id'][0] if bom.get('product_tmpl_id') else None
        target_tmpl = tmpl_map.get(src_tmpl_id) if src_tmpl_id else False
        target_uom = uom_map.get(bom['product_uom_id'][0]) if bom.get('product_uom_id') else False

        if not target_tmpl or target_tmpl < 1:
            print(f"    SKIP BOM {bom.get('code', '')} - product not in target")
            continue

        existing = target.search_read('mrp.bom',
            [['product_tmpl_id', '=', target_tmpl]], ['id'], limit=1)
        if existing:
            bom_map[bom['id']] = existing[0]['id']
            print(f"    BOM exists: {bom['product_tmpl_id'][1]} (ID {existing[0]['id']})")
            continue

        if DRY_RUN:
            print(f"    [DRY RUN] Would create BOM: {bom['product_tmpl_id'][1]}")
            bom_map[bom['id']] = -1
            continue

        vals = {
            'product_tmpl_id': target_tmpl,
            'product_qty': bom.get('product_qty', 1.0),
            'type': bom.get('type', 'normal'),
            'active': True,
        }
        if bom.get('code'): vals['code'] = bom['code']
        if target_uom: vals['product_uom_id'] = target_uom

        new_id = target.create('mrp.bom', vals)
        bom_map[bom['id']] = new_id
        print(f"    Created BOM: {bom['product_tmpl_id'][1]} (ID {new_id})")

    # 4i: Operations
    print('\n   4i. Operations...')
    for op in src_operations:
        src_bom_id = op['bom_id'][0] if op.get('bom_id') else None
        target_bom = bom_map.get(src_bom_id) if src_bom_id else False
        target_wc = wc_map.get(op['workcenter_id'][0]) if op.get('workcenter_id') else False
        if not target_bom or target_bom < 1 or not target_wc or target_wc < 1:
            continue

        existing = target.search_read('mrp.routing.workcenter',
            [['bom_id', '=', target_bom], ['name', '=', op['name']]], ['id'], limit=1)
        if existing:
            op_map[op['id']] = existing[0]['id']
            continue

        if DRY_RUN:
            print(f"    [DRY RUN] Would create operation: {op['name']}")
            op_map[op['id']] = -1
            continue

        new_id = target.create('mrp.routing.workcenter', {
            'name': op['name'],
            'bom_id': target_bom,
            'workcenter_id': target_wc,
            'sequence': op.get('sequence', 10),
            'time_cycle_manual': op.get('time_cycle_manual', 0),
        })
        op_map[op['id']] = new_id
        print(f"    Created operation: {op['name']} (ID {new_id})")

    # 4j: BOM lines
    print('\n   4j. BOM lines (components)...')
    created_lines = 0
    skipped_lines = 0
    for line in src_lines:
        src_bom_id = line['bom_id'][0] if line.get('bom_id') else None
        target_bom = bom_map.get(src_bom_id) if src_bom_id else False
        src_product_id = line['product_id'][0] if line.get('product_id') else None
        target_product = product_map.get(src_product_id) if src_product_id else False
        target_uom = uom_map.get(line['product_uom_id'][0]) if line.get('product_uom_id') else False

        if not target_bom or target_bom < 1 or not target_product or target_product < 1:
            skipped_lines += 1
            continue

        existing = target.search_read('mrp.bom.line',
            [['bom_id', '=', target_bom], ['product_id', '=', target_product]], ['id'], limit=1)
        if existing:
            skipped_lines += 1
            continue

        if DRY_RUN:
            created_lines += 1
            continue

        vals = {
            'bom_id': target_bom,
            'product_id': target_product,
            'product_qty': line.get('product_qty', 1.0),
        }
        if target_uom: vals['product_uom_id'] = target_uom
        if line.get('operation_id'):
            target_op = op_map.get(line['operation_id'][0])
            if target_op and target_op > 0:
                vals['operation_id'] = target_op

        target.create('mrp.bom.line', vals)
        created_lines += 1

    print(f'   Created {created_lines} lines, skipped {skipped_lines}')

    # Summary
    print('\n' + '=' * 60)
    print('MIGRATION SUMMARY')
    print('=' * 60)
    print(f'  UoM categories:     {len(uom_categ_map)}')
    print(f'  Units of measure:   {len(uom_map)}')
    print(f'  Product categories: {len(categ_map)}')
    print(f'  Taxes:              {len(tax_map)}')
    print(f'  Product templates:  {len(tmpl_map)}')
    print(f'  Product variants:   {len(product_map)}')
    print(f'  Work centers:       {len(wc_map)}')
    print(f'  BOMs:               {len(bom_map)}')
    print(f'  Operations:         {len(op_map)}')
    print(f'  BOM lines:          {created_lines} created, {skipped_lines} skipped')
    if DRY_RUN:
        print('\n*** DRY RUN - nothing was created ***')
    print('=' * 60)


if __name__ == '__main__':
    try:
        migrate()
    except Exception as e:
        print(f'\n!!! ERROR: {e}')
        sys.exit(1)
