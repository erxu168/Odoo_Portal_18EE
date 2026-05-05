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
  if (sc) { const s = sc.split(',').map(c => c.trim()).find(c => c.startsWith('session_id=')); if (s) sessionCookie = s.split(';')[0]; }
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
const call = (m, meth, a = [], k = {}) => rpc('/web/dataset/call_kw', { model: m, method: meth, args: a, kwargs: k });
await rpc('/web/session/authenticate', { db: ODOO_DB, login: ODOO_USER, password: ODOO_PASSWORD });

const lines = await call('mrp.bom.line', 'search_read', [
  [['bom_id', '=', 107]],
  ['id', 'product_id', 'product_qty', 'product_uom_id'],
]);
const pids = lines.map(l => l.product_id[0]);
const prods = await call('product.product', 'read', [pids, ['display_name', 'standard_price', 'uom_id']]);
const by = Object.fromEntries(prods.map(p => [p.id, p]));

console.log('BOM 107 BBQ Curry Marinade 15kg lines:');
console.log('line_id | component | qty line_uom | product_uom | unit_cost | line_cost');
for (const l of lines) {
  const p = by[l.product_id[0]];
  const cost = (p.standard_price || 0) * l.product_qty;
  console.log(`  ${l.id} | ${p.display_name} | ${l.product_qty} ${l.product_uom_id[1]} | product_uom=${p.uom_id[1]} | €${p.standard_price} | €${cost.toFixed(2)}`);
}
