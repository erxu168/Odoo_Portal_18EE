#!/usr/bin/env python3
"""
BOM Migration: Odoo 19 CE -> Odoo 18 EE
Safe to run multiple times. Matches by name to avoid duplicates.

Usage:
  python3 scripts/migrate_boms.py --dry-run
  python3 scripts/migrate_boms.py
"""

import requests
import sys
import os

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
            raise Exception(f"Auth failed on {self.label}: no UID")
        print(f"  [{self.label}] UID {self.uid}")

    def search_read(self, model, domain=None, fields=None, limit=0, order='id asc'):
        r = self.session.post(f'{self.url}/web/dataset/call_kw', json={
            'jsonrpc': '2.0', 'id': 2, 'method': 'call',
            'params': {
                'model': model, 'method': 'search_read',
                'args': [domain or []],
                'kwargs': {'fields': fields or [], 'limit': limit, 'order': order,
                           'context': {'active_test': False, 'lang': 'en_US'}}
            }
        })
        result = r.json()
        if result.get('error'):
            raise Exception(f"search_read {model}: {result['error']['data']['message']}")
        return result.get('result', [])

    def create(self, model, vals):
        r = self.session.post(f'{self.url}/web/dataset/call_kw', json={
            'jsonrpc': '2.0', 'id': 3, 'method': 'call',
            'params': {'model': model, 'method': 'create', 'args': [vals],
                       'kwargs': {'context': {'lang': 'en_US'}}}
        })
        result = r.json()
        if result.get('error'):
            raise Exception(f"create {model}: {result['error']['data']['message']}")
        return result.get('result')


def find_or_create(target, model, name_field, name_value, create_vals):
    existing = target.search_read(model, [[name_field, '=', name_value]], ['id'], limit=1)
    if existing:
        return existing[0]['id']
    if DRY_RUN:
        print(f"    [DRY] Would create {model}: {name_value}")
        return -1
    new_id = target.create(model, create_vals)
    print(f"    + {model}: {name_value} (ID {new_id})")
    return new_id


def migrate():
    print('=' * 60)
    print('BOM Migration: Odoo 19 CE -> Odoo 18 EE')
    print('=' * 60)
    if DRY_RUN:
        print('*** DRY RUN ***\n')

    if not SOURCE['password'] or not TARGET['password']:
        print('ERROR: Set SOURCE_ODOO_PASSWORD and ODOO_PASSWORD in .env.local')
        sys.exit(1)

    print('\n1. Connecting...')
    source = OdooRPC(SOURCE, 'SOURCE')
    target = OdooRPC(TARGET, 'TARGET')
    source.authenticate()
    target.authenticate()

    # --- Read source data ---
    print('\n2. Reading BOMs...')
    src_boms = source.search_read('mrp.bom', [['active', '=', True]], [
        'product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id',
        'code', 'type', 'bom_line_ids', 'operation_ids', 'active',
    ])
    print(f'   {len(src_boms)} BOMs')
    if not src_boms:
        print('   Nothing to migrate.')
        return

    print('\n3. Collecting dependencies...')

    # BOM lines
    all_line_ids = []
    for b in src_boms:
        all_line_ids.extend(b.get('bom_line_ids', []))
    src_lines = source.search_read('mrp.bom.line', [['id', 'in', all_line_ids]], [
        'product_id', 'product_qty', 'product_uom_id', 'bom_id', 'operation_id',
    ]) if all_line_ids else []
    print(f'   {len(src_lines)} BOM lines')

    # Operations
    all_op_ids = []
    for b in src_boms:
        all_op_ids.extend(b.get('operation_ids', []))
    src_ops = source.search_read('mrp.routing.workcenter', [['id', 'in', all_op_ids]], [
        'name', 'workcenter_id', 'sequence', 'time_cycle_manual', 'bom_id',
    ]) if all_op_ids else []
    print(f'   {len(src_ops)} operations')

    # Product templates (BOM products)
    tmpl_ids = set()
    for b in src_boms:
        if b.get('product_tmpl_id'): tmpl_ids.add(b['product_tmpl_id'][0])

    # Products (components)
    prod_ids = set()
    for l in src_lines:
        if l.get('product_id'): prod_ids.add(l['product_id'][0])

    # Use only fields that exist in both Odoo 19 CE and 18 EE
    TMPL_FIELDS = ['name', 'default_code', 'categ_id', 'uom_id',
                   'type', 'list_price', 'standard_price', 'active',
                   'taxes_id', 'supplier_taxes_id']
    PROD_FIELDS = ['name', 'default_code', 'product_tmpl_id', 'categ_id', 'uom_id',
                   'type', 'list_price', 'standard_price', 'active',
                   'taxes_id', 'supplier_taxes_id']

    src_tmpls = source.search_read('product.template', [['id', 'in', list(tmpl_ids)]], TMPL_FIELDS) if tmpl_ids else []
    print(f'   {len(src_tmpls)} BOM product templates')

    src_prods = source.search_read('product.product', [['id', 'in', list(prod_ids)]], PROD_FIELDS) if prod_ids else []
    print(f'   {len(src_prods)} component products')

    # Component templates not yet fetched
    comp_tmpl_ids = set()
    for p in src_prods:
        if p.get('product_tmpl_id'): comp_tmpl_ids.add(p['product_tmpl_id'][0])
    comp_tmpl_ids -= tmpl_ids
    src_comp_tmpls = source.search_read('product.template', [['id', 'in', list(comp_tmpl_ids)]], TMPL_FIELDS) if comp_tmpl_ids else []
    print(f'   {len(src_comp_tmpls)} component templates')

    all_tmpls = src_tmpls + src_comp_tmpls

    # Categories
    cat_ids = set(t['categ_id'][0] for t in all_tmpls if t.get('categ_id'))
    src_cats = source.search_read('product.category', [['id', 'in', list(cat_ids)]], ['name']) if cat_ids else []
    print(f'   {len(src_cats)} categories')

    # UoMs
    uom_ids = set()
    for t in all_tmpls:
        if t.get('uom_id'): uom_ids.add(t['uom_id'][0])
    for b in src_boms:
        if b.get('product_uom_id'): uom_ids.add(b['product_uom_id'][0])
    for l in src_lines:
        if l.get('product_uom_id'): uom_ids.add(l['product_uom_id'][0])
    src_uoms = source.search_read('uom.uom', [['id', 'in', list(uom_ids)]], [
        'name', 'category_id', 'factor', 'factor_inv', 'uom_type', 'rounding',
    ]) if uom_ids else []
    print(f'   {len(src_uoms)} UoMs')

    uom_cat_ids = set(u['category_id'][0] for u in src_uoms if u.get('category_id'))
    src_uom_cats = source.search_read('uom.category', [['id', 'in', list(uom_cat_ids)]], ['name']) if uom_cat_ids else []
    print(f'   {len(src_uom_cats)} UoM categories')

    # Work centers
    wc_ids = set(op['workcenter_id'][0] for op in src_ops if op.get('workcenter_id'))
    src_wcs = source.search_read('mrp.workcenter', [['id', 'in', list(wc_ids)]], [
        'name', 'code', 'active', 'time_start', 'time_stop', 'time_efficiency', 'capacity',
    ]) if wc_ids else []
    print(f'   {len(src_wcs)} work centers')

    # Taxes
    tax_ids = set()
    for t in all_tmpls:
        tax_ids.update(t.get('taxes_id', []))
        tax_ids.update(t.get('supplier_taxes_id', []))
    src_taxes = source.search_read('account.tax', [['id', 'in', list(tax_ids)]], [
        'name', 'type_tax_use', 'amount_type', 'amount',
    ]) if tax_ids else []
    print(f'   {len(src_taxes)} taxes')

    # --- Create in target ---
    print('\n4. Migrating...')
    uom_cat_map, uom_map, cat_map, tax_map = {}, {}, {}, {}
    tmpl_map, prod_map, wc_map, bom_map, op_map = {}, {}, {}, {}, {}

    print('\n   UoM categories...')
    for uc in src_uom_cats:
        uom_cat_map[uc['id']] = find_or_create(target, 'uom.category', 'name', uc['name'], {'name': uc['name']})

    print('\n   UoMs...')
    for u in src_uoms:
        tc = uom_cat_map.get(u['category_id'][0]) if u.get('category_id') else False
        uom_map[u['id']] = find_or_create(target, 'uom.uom', 'name', u['name'], {
            'name': u['name'], 'category_id': tc,
            'factor': u.get('factor', 1.0), 'factor_inv': u.get('factor_inv', 1.0),
            'uom_type': u.get('uom_type', 'bigger'), 'rounding': u.get('rounding', 0.01),
        })

    print('\n   Categories...')
    for c in src_cats:
        cat_map[c['id']] = find_or_create(target, 'product.category', 'name', c['name'], {'name': c['name']})

    print('\n   Taxes...')
    for tx in src_taxes:
        tax_map[tx['id']] = find_or_create(target, 'account.tax', 'name', tx['name'], {
            'name': tx['name'], 'type_tax_use': tx.get('type_tax_use', 'sale'),
            'amount_type': tx.get('amount_type', 'percent'), 'amount': tx.get('amount', 0),
        })

    print('\n   Product templates...')
    for t in all_tmpls:
        tu = uom_map.get(t['uom_id'][0]) if t.get('uom_id') else False
        tc = cat_map.get(t['categ_id'][0]) if t.get('categ_id') else False
        tt = [tax_map[x] for x in t.get('taxes_id', []) if x in tax_map]
        st = [tax_map[x] for x in t.get('supplier_taxes_id', []) if x in tax_map]
        vals = {'name': t['name'], 'type': t.get('type', 'consu'),
                'list_price': t.get('list_price', 0), 'standard_price': t.get('standard_price', 0), 'active': True}
        if t.get('default_code'): vals['default_code'] = t['default_code']
        if tu: vals['uom_id'] = tu
        if tc: vals['categ_id'] = tc
        if tt: vals['taxes_id'] = [(6, 0, tt)]
        if st: vals['supplier_taxes_id'] = [(6, 0, st)]
        mf = 'default_code' if t.get('default_code') else 'name'
        mv = t.get('default_code') or t['name']
        tmpl_map[t['id']] = find_or_create(target, 'product.template', mf, mv, vals)

    print('\n   Product variants...')
    for p in src_prods:
        stid = p['product_tmpl_id'][0] if p.get('product_tmpl_id') else None
        if stid and stid in tmpl_map:
            ttid = tmpl_map[stid]
            if ttid and ttid > 0:
                tp = target.search_read('product.product', [['product_tmpl_id', '=', ttid]], ['id'], limit=1)
                if tp:
                    prod_map[p['id']] = tp[0]['id']
                    continue
        tp = target.search_read('product.product', [['name', '=', p['name']]], ['id'], limit=1)
        if tp:
            prod_map[p['id']] = tp[0]['id']
        elif not DRY_RUN:
            tu = uom_map.get(p['uom_id'][0]) if p.get('uom_id') else False
            tc = cat_map.get(p['categ_id'][0]) if p.get('categ_id') else False
            v = {'name': p['name'], 'type': p.get('type', 'consu'), 'active': True}
            if p.get('default_code'): v['default_code'] = p['default_code']
            if tu: v['uom_id'] = tu
            if tc: v['categ_id'] = tc
            tid = target.create('product.template', v)
            print(f"    + template: {p['name']} (ID {tid})")
            tp = target.search_read('product.product', [['product_tmpl_id', '=', tid]], ['id'], limit=1)
            if tp: prod_map[p['id']] = tp[0]['id']
        else:
            print(f"    [DRY] Would create: {p['name']}")
            prod_map[p['id']] = -1
    print(f'   {len(prod_map)} variants mapped')

    print('\n   Work centers...')
    for wc in src_wcs:
        wc_map[wc['id']] = find_or_create(target, 'mrp.workcenter', 'name', wc['name'], {
            'name': wc['name'], 'code': wc.get('code', ''), 'active': True,
            'time_start': wc.get('time_start', 0), 'time_stop': wc.get('time_stop', 0),
            'time_efficiency': wc.get('time_efficiency', 100), 'capacity': wc.get('capacity', 1),
        })

    print('\n   BOMs...')
    for b in src_boms:
        stid = b['product_tmpl_id'][0] if b.get('product_tmpl_id') else None
        tt = tmpl_map.get(stid) if stid else False
        tu = uom_map.get(b['product_uom_id'][0]) if b.get('product_uom_id') else False
        if not tt or tt < 1:
            print(f"    SKIP: {b['product_tmpl_id'][1]} (no template)")
            continue
        ex = target.search_read('mrp.bom', [['product_tmpl_id', '=', tt]], ['id'], limit=1)
        if ex:
            bom_map[b['id']] = ex[0]['id']
            print(f"    EXISTS: {b['product_tmpl_id'][1]} (ID {ex[0]['id']})")
            continue
        if DRY_RUN:
            print(f"    [DRY] BOM: {b['product_tmpl_id'][1]}")
            bom_map[b['id']] = -1
            continue
        v = {'product_tmpl_id': tt, 'product_qty': b.get('product_qty', 1.0),
             'type': b.get('type', 'normal'), 'active': True}
        if b.get('code'): v['code'] = b['code']
        if tu: v['product_uom_id'] = tu
        nid = target.create('mrp.bom', v)
        bom_map[b['id']] = nid
        print(f"    + BOM: {b['product_tmpl_id'][1]} (ID {nid})")

    print('\n   Operations...')
    for op in src_ops:
        sb = op['bom_id'][0] if op.get('bom_id') else None
        tb = bom_map.get(sb) if sb else False
        tw = wc_map.get(op['workcenter_id'][0]) if op.get('workcenter_id') else False
        if not tb or tb < 1 or not tw or tw < 1: continue
        ex = target.search_read('mrp.routing.workcenter', [['bom_id', '=', tb], ['name', '=', op['name']]], ['id'], limit=1)
        if ex:
            op_map[op['id']] = ex[0]['id']
            continue
        if DRY_RUN:
            print(f"    [DRY] Op: {op['name']}")
            op_map[op['id']] = -1
            continue
        nid = target.create('mrp.routing.workcenter', {
            'name': op['name'], 'bom_id': tb, 'workcenter_id': tw,
            'sequence': op.get('sequence', 10), 'time_cycle_manual': op.get('time_cycle_manual', 0),
        })
        op_map[op['id']] = nid
        print(f"    + Op: {op['name']} (ID {nid})")

    print('\n   BOM lines...')
    created, skipped = 0, 0
    for l in src_lines:
        sb = l['bom_id'][0] if l.get('bom_id') else None
        tb = bom_map.get(sb) if sb else False
        sp = l['product_id'][0] if l.get('product_id') else None
        tp = prod_map.get(sp) if sp else False
        tu = uom_map.get(l['product_uom_id'][0]) if l.get('product_uom_id') else False
        if not tb or tb < 1 or not tp or tp < 1:
            skipped += 1
            continue
        ex = target.search_read('mrp.bom.line', [['bom_id', '=', tb], ['product_id', '=', tp]], ['id'], limit=1)
        if ex:
            skipped += 1
            continue
        if DRY_RUN:
            created += 1
            continue
        v = {'bom_id': tb, 'product_id': tp, 'product_qty': l.get('product_qty', 1.0)}
        if tu: v['product_uom_id'] = tu
        if l.get('operation_id'):
            to = op_map.get(l['operation_id'][0])
            if to and to > 0: v['operation_id'] = to
        target.create('mrp.bom.line', v)
        created += 1
    print(f'   {created} created, {skipped} skipped')

    print('\n' + '=' * 60)
    print('SUMMARY')
    print('=' * 60)
    for label, m in [('UoM categories', uom_cat_map), ('UoMs', uom_map), ('Categories', cat_map),
                     ('Taxes', tax_map), ('Templates', tmpl_map), ('Variants', prod_map),
                     ('Work centers', wc_map), ('BOMs', bom_map), ('Operations', op_map)]:
        print(f'  {label}: {len(m)}')
    print(f'  BOM lines: {created} new, {skipped} skipped')
    if DRY_RUN: print('\n*** DRY RUN ***')
    print('=' * 60)


if __name__ == '__main__':
    try:
        migrate()
    except Exception as e:
        print(f'\n!!! ERROR: {e}')
        sys.exit(1)
