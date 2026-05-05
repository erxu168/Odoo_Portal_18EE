// Fix Homemade Soy Sauce 15kg UoM: Units -> kg, cost -> €7.10/kg
// Cascade: update output BOMs 115 & 144 from "5 Units" to "75 kg"

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

const KG = 12;
const UNITS = 1;
const PRODUCT_ID = 743;
const OUTPUT_BOMS = [115, 144];
const NEW_COST = 7.10;
const NEW_SALE = 7.10;

// BEFORE snapshot
console.log('=== BEFORE ===');
const tmplBefore = (await call('product.template', 'read', [[PRODUCT_ID], ['name', 'uom_id', 'uom_po_id', 'standard_price', 'list_price']]))[0];
console.log('product.template', tmplBefore);
for (const bid of OUTPUT_BOMS) {
  const b = (await call('mrp.bom', 'read', [[bid], ['product_qty', 'product_uom_id', 'company_id']]))[0];
  console.log(`BOM ${bid}:`, b);
}

// 1. Update product template UoM + prices
console.log('\n=== APPLYING ===');
const w1 = await call('product.template', 'write', [[PRODUCT_ID], {
  uom_id: KG,
  uom_po_id: KG,
  standard_price: NEW_COST,
  list_price: NEW_SALE,
}]);
console.log(`product.template write: ${w1}`);

// 2. Update output BOMs — UoM to kg, qty to 75
for (const bid of OUTPUT_BOMS) {
  const w = await call('mrp.bom', 'write', [[bid], {
    product_uom_id: KG,
    product_qty: 75,
  }]);
  console.log(`mrp.bom ${bid} write: ${w}`);
}

// AFTER snapshot
console.log('\n=== AFTER ===');
const tmplAfter = (await call('product.template', 'read', [[PRODUCT_ID], ['name', 'uom_id', 'uom_po_id', 'standard_price', 'list_price']]))[0];
console.log('product.template', tmplAfter);
for (const bid of OUTPUT_BOMS) {
  const b = (await call('mrp.bom', 'read', [[bid], ['product_qty', 'product_uom_id']]))[0];
  console.log(`BOM ${bid}:`, b);
}

// Re-compute the 6 dependent BOMs to confirm the Bulgogi blow-up is gone
console.log('\n=== DEPENDENT BOM RECOMPUTE ===');
const dependentBoms = [95, 107, 118, 124, 136, 147];
for (const bid of dependentBoms) {
  const bom = (await call('mrp.bom', 'read', [[bid], ['product_tmpl_id', 'product_qty', 'company_id']]))[0];
  const lines = await call('mrp.bom.line', 'search_read', [
    [['bom_id', '=', bid]],
    ['product_id', 'product_qty'],
  ]);
  const pids = lines.map(l => l.product_id[0]);
  const prods = await call('product.product', 'read', [pids, ['standard_price']]);
  const by = Object.fromEntries(prods.map(p => [p.id, p]));
  let cost = 0;
  for (const l of lines) cost += (by[l.product_id[0]].standard_price || 0) * l.product_qty;
  const perUnit = cost / bom.product_qty;
  console.log(`  BOM ${bid} (${bom.product_tmpl_id[1]}, ${bom.company_id[1]}): €${perUnit.toFixed(2)}/unit`);
}
