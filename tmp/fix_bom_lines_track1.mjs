// Track 1: Fix 6 BOM lines that consume Homemade Soy Sauce 15kg in kg instead of Units.
// Converts qty: kg -> Units at ratio 1 Unit = 15 kg.

const ODOO_URL = 'http://89.167.124.0:15069';
const ODOO_DB = 'krawings';
const ODOO_USER = 'biz@krawings.de';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

let sessionCookie = '';
async function rpc(endpoint, params) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionCookie) headers['Cookie'] = sessionCookie;
  const r = await fetch(`${ODOO_URL}${endpoint}`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params }),
  });
  const sc = r.headers.get('set-cookie');
  if (sc) {
    const s = sc.split(',').map(c => c.trim()).find(c => c.startsWith('session_id='));
    if (s) sessionCookie = s.split(';')[0];
  }
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
const call = (m, meth, a = [], k = {}) => rpc('/web/dataset/call_kw', { model: m, method: meth, args: a, kwargs: k });

await rpc('/web/session/authenticate', { db: ODOO_DB, login: ODOO_USER, password: ODOO_PASSWORD });

const UNITS = 1;
const SOY_PRODUCT = 743;
const BOMS = [95, 107, 118, 124, 136, 147];

// Locate the 6 lines
const lines = await call('mrp.bom.line', 'search_read', [
  [['bom_id', 'in', BOMS], ['product_id', '=', SOY_PRODUCT]],
  ['id', 'bom_id', 'product_qty', 'product_uom_id'],
]);
console.log(`Found ${lines.length} BOM lines to fix:`);
for (const l of lines) console.log(`  line ${l.id} bom=${l.bom_id[0]} qty=${l.product_qty} ${l.product_uom_id[1]}`);

// Save rollback snapshot
import { writeFileSync } from 'node:fs';
writeFileSync('/Users/ethan/Odoo_Portal_18EE/tmp/bom_lines_track1_before.json',
  JSON.stringify(lines, null, 2));
console.log('\nRollback snapshot: tmp/bom_lines_track1_before.json');

// Apply: qty (kg) / 15 -> Units
console.log('\n=== APPLYING ===');
for (const l of lines) {
  const newQty = l.product_qty / 15;
  const ok = await call('mrp.bom.line', 'write', [[l.id], {
    product_uom_id: UNITS,
    product_qty: newQty,
  }]);
  console.log(`  line ${l.id}: ${l.product_qty} kg -> ${newQty.toFixed(4)} Units  (write=${ok})`);
}

// Recompute affected BOM costs
console.log('\n=== RECOMPUTED COSTS ===');
for (const bid of BOMS) {
  const bom = (await call('mrp.bom', 'read', [[bid], ['product_tmpl_id', 'product_qty', 'company_id']]))[0];
  const bomLines = await call('mrp.bom.line', 'search_read', [
    [['bom_id', '=', bid]],
    ['product_id', 'product_qty'],
  ]);
  const pids = bomLines.map(l => l.product_id[0]);
  const prods = await call('product.product', 'read', [pids, ['standard_price']]);
  const by = Object.fromEntries(prods.map(p => [p.id, p]));
  let cost = 0;
  for (const l of bomLines) cost += (by[l.product_id[0]].standard_price || 0) * l.product_qty;
  console.log(`  BOM ${bid} (${bom.product_tmpl_id[1]}, ${bom.company_id[1]}): €${(cost / bom.product_qty).toFixed(2)}/unit`);
}
