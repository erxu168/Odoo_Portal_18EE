// Drill into Bulgogi Sauce 15kg BOM (id 118, 147) to find which component is blowing up cost

const ODOO_URL = 'http://89.167.124.0:15069';
const ODOO_DB = 'krawings';
const ODOO_USER = 'biz@krawings.de';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

let sessionCookie = '';
async function rpc(endpoint, params) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionCookie) headers['Cookie'] = sessionCookie;
  const r = await fetch(`${ODOO_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params }),
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) {
    const s = setCookie.split(',').map(c => c.trim()).find(c => c.startsWith('session_id='));
    if (s) sessionCookie = s.split(';')[0];
  }
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
const call = (m, meth, args = [], kw = {}) => rpc('/web/dataset/call_kw', { model: m, method: meth, args, kwargs: kw });

await rpc('/web/session/authenticate', { db: ODOO_DB, login: ODOO_USER, password: ODOO_PASSWORD });

for (const bomId of [118, 147]) {
  const bom = (await call('mrp.bom', 'read', [[bomId], ['product_tmpl_id', 'product_qty', 'product_uom_id', 'company_id']]))[0];
  const lines = await call('mrp.bom.line', 'search_read', [
    [['bom_id', '=', bomId]],
    ['product_id', 'product_qty', 'product_uom_id'],
  ]);
  const pids = lines.map(l => l.product_id[0]);
  const prods = await call('product.product', 'read', [pids, ['display_name', 'standard_price', 'uom_id']]);
  const by = Object.fromEntries(prods.map(p => [p.id, p]));

  console.log(`\n=== BOM ${bomId}: ${bom.product_tmpl_id[1]} (makes ${bom.product_qty} ${bom.product_uom_id[1]}) — ${bom.company_id[1]} ===`);
  console.log('component | qty | uom | unit_cost | line_cost');
  let total = 0;
  for (const l of lines) {
    const p = by[l.product_id[0]];
    const lineCost = (p.standard_price || 0) * l.product_qty;
    total += lineCost;
    console.log(`  ${p.display_name} | ${l.product_qty} ${l.product_uom_id[1]} | stored €${(p.standard_price||0).toFixed(2)}/${p.uom_id[1]} | €${lineCost.toFixed(2)}`);
  }
  console.log(`  TOTAL: €${total.toFixed(2)} for ${bom.product_qty} units → €${(total/bom.product_qty).toFixed(2)}/unit`);
}
