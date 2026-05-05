// Check impact of changing Homemade Soy Sauce 15kg UoM from Units to kg

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

// Find product(s) named Homemade Soy Sauce 15kg
const prods = await call('product.product', 'search_read', [
  [['name', 'ilike', 'Homemade Soy Sauce']],
  ['id', 'display_name', 'name', 'uom_id', 'uom_po_id', 'standard_price', 'list_price', 'product_tmpl_id', 'qty_available', 'categ_id'],
]);
console.log('Matching products:');
for (const p of prods) {
  console.log(`  [${p.id}] ${p.display_name}  uom=${p.uom_id[1]}  cost=€${p.standard_price}  sale=€${p.list_price}  on_hand=${p.qty_available}  tmpl=${p.product_tmpl_id[0]}`);
}

if (!prods.length) { console.log('no match'); process.exit(0); }

const pid = prods[0].id;
const tmplId = prods[0].product_tmpl_id[0];

// Stock moves (history)
const moves = await call('stock.move', 'search_count', [
  [['product_id', '=', pid]],
]);
console.log(`\nstock.move rows referencing this product: ${moves}`);

// Stock quants (current)
const quants = await call('stock.quant', 'search_read', [
  [['product_id', '=', pid], ['location_id.usage', '=', 'internal']],
  ['location_id', 'quantity', 'reserved_quantity'],
]);
console.log(`stock.quant (internal locations):`);
for (const q of quants) console.log(`  ${q.location_id[1]}: qty=${q.quantity} reserved=${q.reserved_quantity}`);

// BOMs where this product is a COMPONENT
const lines = await call('mrp.bom.line', 'search_read', [
  [['product_id', '=', pid]],
  ['bom_id', 'product_qty', 'product_uom_id'],
]);
console.log(`\nAppears as a component in ${lines.length} BOM lines:`);
for (const l of lines) {
  const bom = (await call('mrp.bom', 'read', [[l.bom_id[0]], ['product_tmpl_id', 'company_id', 'product_qty']]))[0];
  console.log(`  BOM ${l.bom_id[0]}: ${bom.product_tmpl_id[1]}  — uses ${l.product_qty} ${l.product_uom_id[1]}  (${bom.company_id[1]})`);
}

// Is it itself the OUTPUT of a BOM?
const outBoms = await call('mrp.bom', 'search_read', [
  ['|', ['product_id', '=', pid], ['product_tmpl_id', '=', tmplId]],
  ['id', 'product_tmpl_id', 'product_qty', 'product_uom_id', 'company_id'],
]);
console.log(`\nIt is the OUTPUT of ${outBoms.length} BOM(s):`);
for (const b of outBoms) {
  console.log(`  BOM ${b.id}: makes ${b.product_qty} ${b.product_uom_id[1]}  (${b.company_id[1]})`);
}

// Purchase order lines
const polCount = await call('purchase.order.line', 'search_count', [
  [['product_id', '=', pid]],
]);
console.log(`\npurchase.order.line rows: ${polCount}`);

// UoM ids we need
const kgUom = await call('uom.uom', 'search_read', [[['name', '=', 'kg']], ['id', 'name']], { limit: 5 });
const unitsUom = await call('uom.uom', 'search_read', [[['name', '=', 'Units']], ['id', 'name']], { limit: 5 });
console.log('\nUoMs available:');
console.log('  kg:', kgUom);
console.log('  Units:', unitsUom);
