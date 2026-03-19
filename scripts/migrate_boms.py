#!/usr/bin/env python3
"""
BOM Migration: Odoo 19 CE -> Odoo 18 EE
Uses ONLY fields verified to exist in both instances.
Safe to run multiple times — matches by name, skips existing.

Usage:
  python3 scripts/migrate_boms.py --dry-run
  python3 scripts/migrate_boms.py
"""
import requests, sys, os

def load_env():
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
    if os.path.exists(p):
        with open(p, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip())
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
DRY = '--dry-run' in sys.argv

# ═══════════════════════════════════════════════════════════
# VERIFIED SAFE FIELDS (exist in BOTH Odoo 19 CE and 18 EE)
# from check_fields.py output 2026-03-19
# ═══════════════════════════════════════════════════════════
F_TMPL = ['name', 'default_code', 'categ_id', 'uom_id', 'type',
          'list_price', 'standard_price', 'active', 'taxes_id',
          'supplier_taxes_id', 'sale_ok', 'purchase_ok']
F_PROD = ['name', 'default_code', 'product_tmpl_id', 'categ_id', 'uom_id',
          'type', 'list_price', 'standard_price', 'active',
          'taxes_id', 'supplier_taxes_id']
F_CAT  = ['name', 'parent_id', 'complete_name']
F_BOM  = ['product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id',
          'code', 'type', 'bom_line_ids', 'operation_ids', 'active',
          'ready_to_produce', 'consumption']
F_LINE = ['product_id', 'product_qty', 'product_uom_id', 'bom_id',
          'operation_id', 'sequence']
F_OP   = ['name', 'workcenter_id', 'sequence', 'time_cycle_manual',
          'bom_id', 'time_mode', 'time_mode_batch']
F_WC   = ['name', 'code', 'active', 'time_start', 'time_stop',
          'time_efficiency', 'oee_target']
F_UOM  = ['name', 'factor', 'rounding', 'active']
# uom.category has NO shared fields — skip reading from source
F_TAX  = ['name', 'type_tax_use', 'amount_type', 'amount', 'active']


class Odoo:
    def __init__(self, cfg, label):
        self.url, self.db = cfg['url'], cfg['db']
        self.login, self.pw = cfg['login'], cfg['password']
        self.label, self.s = label, requests.Session()

    def auth(self):
        r = self.s.post(f'{self.url}/web/session/authenticate', json={
            'jsonrpc':'2.0','id':1,'method':'call',
            'params':{'db':self.db,'login':self.login,'password':self.pw}
        }, timeout=15)
        uid = r.json().get('result',{}).get('uid')
        if not uid: raise Exception(f'Auth failed: {self.label}')
        print(f'  [{self.label}] UID {uid}')

    def sr(self, model, domain=None, fields=None, limit=0):
        r = self.s.post(f'{self.url}/web/dataset/call_kw', json={
            'jsonrpc':'2.0','id':2,'method':'call',
            'params':{'model':model,'method':'search_read','args':[domain or []],
                      'kwargs':{'fields':fields or[],'limit':limit,'order':'id asc',
                                'context':{'active_test':False,'lang':'en_US'}}}
        }, timeout=30)
        res = r.json()
        if res.get('error'): raise Exception(f"sr {model}: {res['error']['data']['message']}")
        return res.get('result',[])

    def cr(self, model, vals):
        r = self.s.post(f'{self.url}/web/dataset/call_kw', json={
            'jsonrpc':'2.0','id':3,'method':'call',
            'params':{'model':model,'method':'create','args':[vals],
                      'kwargs':{'context':{'lang':'en_US'}}}
        }, timeout=15)
        res = r.json()
        if res.get('error'): raise Exception(f"cr {model}: {res['error']['data']['message']}")
        return res.get('result')


def foc(tgt, model, field, val, vals):
    """Find or create."""
    ex = tgt.sr(model, [[field, '=', val]], ['id'], 1)
    if ex: return ex[0]['id']
    if DRY:
        print(f'    [DRY] {model}: {val}')
        return -1
    nid = tgt.cr(model, vals)
    print(f'    + {model}: {val} (ID {nid})')
    return nid


def run():
    print('=' * 60)
    print('BOM Migration: Odoo 19 CE -> Odoo 18 EE')
    print('=' * 60)
    if DRY: print('*** DRY RUN ***\n')
    if not SOURCE['password'] or not TARGET['password']:
        print('ERROR: Set SOURCE_ODOO_PASSWORD and ODOO_PASSWORD in .env.local')
        sys.exit(1)

    src, tgt = Odoo(SOURCE, 'SRC'), Odoo(TARGET, 'TGT')
    print('\n1. Connecting...')
    src.auth(); tgt.auth()

    # --- Read source ---
    print('\n2. Reading BOMs...')
    boms = src.sr('mrp.bom', [['active','=',True]], F_BOM)
    print(f'   {len(boms)} BOMs')
    if not boms: return

    print('\n3. Dependencies...')
    lid = [i for b in boms for i in b.get('bom_line_ids',[])]
    lines = src.sr('mrp.bom.line', [['id','in',lid]], F_LINE) if lid else []
    print(f'   {len(lines)} BOM lines')

    oid = [i for b in boms for i in b.get('operation_ids',[])]
    ops = src.sr('mrp.routing.workcenter', [['id','in',oid]], F_OP) if oid else []
    print(f'   {len(ops)} operations')

    tid = set(b['product_tmpl_id'][0] for b in boms if b.get('product_tmpl_id'))
    pid = set(l['product_id'][0] for l in lines if l.get('product_id'))

    tmpls = src.sr('product.template', [['id','in',list(tid)]], F_TMPL) if tid else []
    print(f'   {len(tmpls)} BOM templates')

    prods = src.sr('product.product', [['id','in',list(pid)]], F_PROD) if pid else []
    print(f'   {len(prods)} component products')

    ctid = set(p['product_tmpl_id'][0] for p in prods if p.get('product_tmpl_id')) - tid
    ctmpls = src.sr('product.template', [['id','in',list(ctid)]], F_TMPL) if ctid else []
    print(f'   {len(ctmpls)} component templates')
    at = tmpls + ctmpls

    cids = set(t['categ_id'][0] for t in at if t.get('categ_id'))
    cats = src.sr('product.category', [['id','in',list(cids)]], F_CAT) if cids else []
    print(f'   {len(cats)} categories')

    uids = set()
    for t in at:
        if t.get('uom_id'): uids.add(t['uom_id'][0])
    for b in boms:
        if b.get('product_uom_id'): uids.add(b['product_uom_id'][0])
    for l in lines:
        if l.get('product_uom_id'): uids.add(l['product_uom_id'][0])
    uoms = src.sr('uom.uom', [['id','in',list(uids)]], F_UOM) if uids else []
    print(f'   {len(uoms)} UoMs')

    wids = set(o['workcenter_id'][0] for o in ops if o.get('workcenter_id'))
    wcs = src.sr('mrp.workcenter', [['id','in',list(wids)]], F_WC) if wids else []
    print(f'   {len(wcs)} work centers')

    txids = set()
    for t in at:
        txids.update(t.get('taxes_id',[])); txids.update(t.get('supplier_taxes_id',[]))
    taxes = src.sr('account.tax', [['id','in',list(txids)]], F_TAX) if txids else []
    print(f'   {len(taxes)} taxes')

    # --- Create in target ---
    print('\n4. Migrating...')
    um, cm, tm, txm, tlm, pm, wm, bm, om = {},{},{},{},{},{},{},{},{}

    # UoMs — match by name only (category_id not available in Odoo 19)
    print('\n   UoMs...')
    for u in uoms:
        um[u['id']] = foc(tgt, 'uom.uom', 'name', u['name'], {
            'name': u['name'], 'factor': u.get('factor',1.0),
            'rounding': u.get('rounding',0.01), 'active': True,
        })

    print('\n   Categories...')
    for c in cats:
        cm[c['id']] = foc(tgt, 'product.category', 'name', c['name'], {'name': c['name']})

    print('\n   Taxes...')
    for tx in taxes:
        txm[tx['id']] = foc(tgt, 'account.tax', 'name', tx['name'], {
            'name': tx['name'], 'type_tax_use': tx.get('type_tax_use','sale'),
            'amount_type': tx.get('amount_type','percent'), 'amount': tx.get('amount',0),
        })

    print('\n   Product templates...')
    for t in at:
        tu = um.get(t['uom_id'][0]) if t.get('uom_id') else False
        tc = cm.get(t['categ_id'][0]) if t.get('categ_id') else False
        tt = [txm[x] for x in t.get('taxes_id',[]) if x in txm]
        st = [txm[x] for x in t.get('supplier_taxes_id',[]) if x in txm]
        v = {'name': t['name'], 'type': t.get('type','consu'),
             'list_price': t.get('list_price',0), 'standard_price': t.get('standard_price',0),
             'active': True, 'sale_ok': t.get('sale_ok',True), 'purchase_ok': t.get('purchase_ok',True)}
        if t.get('default_code'): v['default_code'] = t['default_code']
        if tu: v['uom_id'] = tu
        if tc: v['categ_id'] = tc
        if tt: v['taxes_id'] = [(6,0,tt)]
        if st: v['supplier_taxes_id'] = [(6,0,st)]
        mf = 'default_code' if t.get('default_code') else 'name'
        mv = t.get('default_code') or t['name']
        tlm[t['id']] = foc(tgt, 'product.template', mf, mv, v)

    print('\n   Product variants...')
    for p in prods:
        stid = p['product_tmpl_id'][0] if p.get('product_tmpl_id') else None
        if stid and stid in tlm:
            ttid = tlm[stid]
            if ttid and ttid > 0:
                tp = tgt.sr('product.product', [['product_tmpl_id','=',ttid]], ['id'], 1)
                if tp: pm[p['id']] = tp[0]['id']; continue
        tp = tgt.sr('product.product', [['name','=',p['name']]], ['id'], 1)
        if tp: pm[p['id']] = tp[0]['id']
        elif not DRY:
            tu = um.get(p['uom_id'][0]) if p.get('uom_id') else False
            tc = cm.get(p['categ_id'][0]) if p.get('categ_id') else False
            v = {'name': p['name'], 'type': p.get('type','consu'), 'active': True}
            if p.get('default_code'): v['default_code'] = p['default_code']
            if tu: v['uom_id'] = tu
            if tc: v['categ_id'] = tc
            tid2 = tgt.cr('product.template', v)
            print(f"    + tmpl: {p['name']} ({tid2})")
            tp = tgt.sr('product.product', [['product_tmpl_id','=',tid2]], ['id'], 1)
            if tp: pm[p['id']] = tp[0]['id']
        else:
            print(f"    [DRY] product: {p['name']}")
            pm[p['id']] = -1
    print(f'   {len(pm)} variants')

    print('\n   Work centers...')
    for w in wcs:
        wm[w['id']] = foc(tgt, 'mrp.workcenter', 'name', w['name'], {
            'name': w['name'], 'code': w.get('code',''), 'active': True,
            'time_start': w.get('time_start',0), 'time_stop': w.get('time_stop',0),
            'time_efficiency': w.get('time_efficiency',100), 'oee_target': w.get('oee_target',90),
        })

    print('\n   BOMs...')
    for b in boms:
        stid = b['product_tmpl_id'][0] if b.get('product_tmpl_id') else None
        tt = tlm.get(stid) if stid else False
        tu = um.get(b['product_uom_id'][0]) if b.get('product_uom_id') else False
        if not tt or tt < 1:
            print(f"    SKIP: {b['product_tmpl_id'][1]}"); continue
        ex = tgt.sr('mrp.bom', [['product_tmpl_id','=',tt]], ['id'], 1)
        if ex:
            bm[b['id']] = ex[0]['id']
            print(f"    EXISTS: {b['product_tmpl_id'][1]} ({ex[0]['id']})"); continue
        if DRY:
            print(f"    [DRY] BOM: {b['product_tmpl_id'][1]}"); bm[b['id']] = -1; continue
        v = {'product_tmpl_id': tt, 'product_qty': b.get('product_qty',1.0),
             'type': b.get('type','normal'), 'active': True}
        if b.get('code'): v['code'] = b['code']
        if tu: v['product_uom_id'] = tu
        if b.get('ready_to_produce'): v['ready_to_produce'] = b['ready_to_produce']
        if b.get('consumption'): v['consumption'] = b['consumption']
        nid = tgt.cr('mrp.bom', v)
        bm[b['id']] = nid
        print(f"    + BOM: {b['product_tmpl_id'][1]} ({nid})")

    print('\n   Operations...')
    for o in ops:
        sb = o['bom_id'][0] if o.get('bom_id') else None
        tb = bm.get(sb) if sb else False
        tw = wm.get(o['workcenter_id'][0]) if o.get('workcenter_id') else False
        if not tb or tb < 1 or not tw or tw < 1: continue
        ex = tgt.sr('mrp.routing.workcenter', [['bom_id','=',tb],['name','=',o['name']]], ['id'], 1)
        if ex: om[o['id']] = ex[0]['id']; continue
        if DRY:
            print(f"    [DRY] Op: {o['name']}"); om[o['id']] = -1; continue
        v = {'name': o['name'], 'bom_id': tb, 'workcenter_id': tw,
             'sequence': o.get('sequence',10), 'time_cycle_manual': o.get('time_cycle_manual',0)}
        if o.get('time_mode'): v['time_mode'] = o['time_mode']
        if o.get('time_mode_batch'): v['time_mode_batch'] = o['time_mode_batch']
        nid = tgt.cr('mrp.routing.workcenter', v)
        om[o['id']] = nid
        print(f"    + Op: {o['name']} ({nid})")

    print('\n   BOM lines...')
    cr, sk = 0, 0
    for l in lines:
        sb = l['bom_id'][0] if l.get('bom_id') else None
        tb = bm.get(sb) if sb else False
        sp = l['product_id'][0] if l.get('product_id') else None
        tp = pm.get(sp) if sp else False
        tu = um.get(l['product_uom_id'][0]) if l.get('product_uom_id') else False
        if not tb or tb < 1 or not tp or tp < 1: sk += 1; continue
        ex = tgt.sr('mrp.bom.line', [['bom_id','=',tb],['product_id','=',tp]], ['id'], 1)
        if ex: sk += 1; continue
        if DRY: cr += 1; continue
        v = {'bom_id': tb, 'product_id': tp, 'product_qty': l.get('product_qty',1.0)}
        if tu: v['product_uom_id'] = tu
        if l.get('sequence'): v['sequence'] = l['sequence']
        if l.get('operation_id'):
            to = om.get(l['operation_id'][0])
            if to and to > 0: v['operation_id'] = to
        tgt.cr('mrp.bom.line', v)
        cr += 1
    print(f'   {cr} created, {sk} skipped')

    print('\n' + '=' * 60)
    print('SUMMARY')
    print('=' * 60)
    for lbl, m in [('UoMs',um),('Categories',cm),('Taxes',txm),('Templates',tlm),
                   ('Variants',pm),('Work centers',wm),('BOMs',bm),('Operations',om)]:
        print(f'  {lbl}: {len(m)}')
    print(f'  BOM lines: {cr} new, {sk} skipped')
    if DRY: print('\n*** DRY RUN ***')
    print('=' * 60)

if __name__ == '__main__':
    try: run()
    except Exception as e: print(f'\n!!! ERROR: {e}'); sys.exit(1)
