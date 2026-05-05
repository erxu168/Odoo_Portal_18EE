// 1. Count journal entries blocking Homemade Soy Sauce
// 2. Find all BOM-produced products whose UoM is not kg

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

// 1. Journal entries referencing product 743
const amlCount = await call('account.move.line', 'search_count', [[['product_id', '=', 743]]]);
console.log(`Journal entry lines for product 743 (Homemade Soy Sauce): ${amlCount}`);
if (amlCount > 0) {
  const sample = await call('account.move.line', 'search_read', [
    [['product_id', '=', 743]],
    ['move_id', 'date', 'parent_state', 'company_id'],
  ], { limit: 10 });
  for (const l of sample) {
    console.log(`  move=${l.move_id[1]} date=${l.date} state=${l.parent_state} company=${l.company_id[1]}`);
  }
}

// 2. All BOM-produced products and their UoM
const boms = await call('mrp.bom', 'search_read', [
  [['type', '=', 'normal']],
  ['product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id'],
], { limit: 5000 });

const tmplIds = [...new Set(boms.map(b => b.product_tmpl_id[0]))];
const tmpls = await call('product.template', 'read', [tmplIds, ['name', 'uom_id']]);
const tmplById = Object.fromEntries(tmpls.map(t => [t.id, t]));

// Count by UoM
const byUom = {};
for (const t of tmpls) {
  const u = t.uom_id[1];
  (byUom[u] ||= []).push(t);
}
console.log(`\nBOM-produced products grouped by UoM:`);
for (const [uom, list] of Object.entries(byUom)) {
  console.log(`  ${uom}: ${list.length}`);
}

console.log(`\nBOM-produced products whose UoM is NOT kg:`);
const nonKg = tmpls.filter(t => t.uom_id[1] !== 'kg');
for (const t of nonKg) {
  console.log(`  [tmpl ${t.id}] ${t.name}  uom=${t.uom_id[1]}`);
}
console.log(`\nTotal non-kg BOM-produced products: ${nonKg.length} / ${tmpls.length}`);
