// BOM pricing audit — Odoo 18 staging
// Flags BOMs whose component cost looks abnormally high vs the product's sale price / cost.

const ODOO_URL = 'http://89.167.124.0:15069';
const ODOO_DB = 'krawings';
const ODOO_USER = 'biz@krawings.de';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

if (!ODOO_PASSWORD) {
  console.error('Set ODOO_PASSWORD');
  process.exit(1);
}

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
    const session = setCookie.split(',').map(c => c.trim()).find(c => c.startsWith('session_id='));
    if (session) sessionCookie = session.split(';')[0];
  }
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function auth() {
  return await rpc('/web/session/authenticate', {
    db: ODOO_DB,
    login: ODOO_USER,
    password: ODOO_PASSWORD,
  });
}

async function call(model, method, args = [], kwargs = {}) {
  return await rpc('/web/dataset/call_kw', {
    model,
    method,
    args,
    kwargs,
  });
}

function fmt(n) {
  return (n ?? 0).toFixed(2);
}

const session = await auth();
console.error(`Authenticated uid=${session.uid} db=${session.db}`);

// 1. Fetch all manufacturing BOMs
const boms = await call('mrp.bom', 'search_read', [
  [['type', '=', 'normal']],
  ['id', 'product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id', 'company_id', 'code'],
], { limit: 5000 });
console.error(`Fetched ${boms.length} BOMs`);

// 2. Fetch BOM lines
const bomIds = boms.map(b => b.id);
const lines = await call('mrp.bom.line', 'search_read', [
  [['bom_id', 'in', bomIds]],
  ['id', 'bom_id', 'product_id', 'product_qty', 'product_uom_id'],
], { limit: 50000 });
console.error(`Fetched ${lines.length} BOM lines`);

// 3. Collect unique component product ids and bom parent product template ids
const componentProductIds = [...new Set(lines.map(l => l.product_id[0]))];
const parentTmplIds = [...new Set(boms.map(b => b.product_tmpl_id[0]))];
const parentVariantIds = [...new Set(boms.filter(b => b.product_id).map(b => b.product_id[0]))];

// 4. Fetch component product costs
const compProducts = await call('product.product', 'read', [
  componentProductIds,
  ['id', 'display_name', 'standard_price', 'list_price', 'uom_id'],
]);
const compById = Object.fromEntries(compProducts.map(p => [p.id, p]));

// 5. Fetch parent product template (for list_price) and variants
const parentTmpls = await call('product.template', 'read', [
  parentTmplIds,
  ['id', 'name', 'list_price', 'standard_price', 'uom_id', 'categ_id'],
]);
const tmplById = Object.fromEntries(parentTmpls.map(p => [p.id, p]));

let parentVariants = [];
if (parentVariantIds.length) {
  parentVariants = await call('product.product', 'read', [
    parentVariantIds,
    ['id', 'display_name', 'list_price', 'standard_price'],
  ]);
}
const variantById = Object.fromEntries(parentVariants.map(p => [p.id, p]));

// 6. Compute BOM cost per bom
const linesByBom = {};
for (const l of lines) {
  (linesByBom[l.bom_id[0]] ||= []).push(l);
}

const rows = [];
for (const bom of boms) {
  const bomLines = linesByBom[bom.id] || [];
  let cost = 0;
  let missing = 0;
  for (const l of bomLines) {
    const cp = compById[l.product_id[0]];
    if (!cp) { missing++; continue; }
    cost += (cp.standard_price || 0) * (l.product_qty || 0);
  }
  // normalise to cost per 1 unit of parent
  const perUnit = bom.product_qty ? cost / bom.product_qty : cost;

  const tmpl = tmplById[bom.product_tmpl_id[0]];
  const variant = bom.product_id ? variantById[bom.product_id[0]] : null;
  const parentName = variant?.display_name || tmpl?.name || bom.product_tmpl_id[1];
  const listPrice = variant?.list_price ?? tmpl?.list_price ?? 0;
  const standardPrice = variant?.standard_price ?? tmpl?.standard_price ?? 0;

  rows.push({
    bomId: bom.id,
    code: bom.code || '',
    product: parentName,
    company: bom.company_id ? bom.company_id[1] : '—',
    lines: bomLines.length,
    missing,
    bomCostPerUnit: perUnit,
    salePrice: listPrice,
    currentStandardPrice: standardPrice,
    marginPct: listPrice > 0 ? ((listPrice - perUnit) / listPrice) * 100 : null,
    costVsStandardRatio: standardPrice > 0 ? perUnit / standardPrice : null,
  });
}

// 7. Flag anomalies
const flags = [];
for (const r of rows) {
  const reasons = [];
  if (r.bomCostPerUnit > 0 && r.salePrice > 0 && r.bomCostPerUnit >= r.salePrice) {
    reasons.push(`cost (€${fmt(r.bomCostPerUnit)}) >= sale price (€${fmt(r.salePrice)})`);
  } else if (r.marginPct !== null && r.marginPct < 20 && r.salePrice > 0) {
    reasons.push(`margin ${fmt(r.marginPct)}% under 20%`);
  }
  if (r.costVsStandardRatio !== null && r.costVsStandardRatio > 2 && r.bomCostPerUnit > 5) {
    reasons.push(`BOM cost €${fmt(r.bomCostPerUnit)} is ${r.costVsStandardRatio.toFixed(1)}x the product's stored cost €${fmt(r.currentStandardPrice)}`);
  }
  if (r.bomCostPerUnit > 500) {
    reasons.push(`absolute cost >€500 per unit`);
  }
  if (r.missing > 0) {
    reasons.push(`${r.missing} component(s) missing cost data`);
  }
  if (reasons.length) flags.push({ ...r, reasons });
}

// 8. Emit reports
const byCost = [...rows].sort((a, b) => b.bomCostPerUnit - a.bomCostPerUnit).slice(0, 25);

console.log('\n=== TOP 25 BOMs BY COST PER UNIT ===');
console.log('bomId\tcompany\tproduct\tcost/unit\tsale\tmargin%');
for (const r of byCost) {
  console.log([
    r.bomId,
    r.company,
    r.product,
    fmt(r.bomCostPerUnit),
    fmt(r.salePrice),
    r.marginPct === null ? '—' : fmt(r.marginPct),
  ].join('\t'));
}

console.log(`\n=== FLAGGED BOMs (${flags.length} of ${rows.length}) ===`);
// order by severity: loss-makers first, then low margin, then large divergence
const severity = r => {
  if (r.reasons.some(x => x.startsWith('cost') && x.includes('>='))) return 0;
  if (r.reasons.some(x => x.includes('margin'))) return 1;
  if (r.reasons.some(x => x.includes('x the product'))) return 2;
  if (r.reasons.some(x => x.includes('>€500'))) return 3;
  return 4;
};
flags.sort((a, b) => severity(a) - severity(b) || b.bomCostPerUnit - a.bomCostPerUnit);

for (const r of flags) {
  console.log(`\n[BOM ${r.bomId}] ${r.product}  (${r.company})`);
  console.log(`  cost/unit: €${fmt(r.bomCostPerUnit)}  sale: €${fmt(r.salePrice)}  stored cost: €${fmt(r.currentStandardPrice)}  lines: ${r.lines}`);
  for (const why of r.reasons) console.log(`  ! ${why}`);
}

// CSV for offline review
import { writeFileSync } from 'node:fs';
const csv = [
  'bom_id,code,product,company,lines,missing,cost_per_unit,sale_price,stored_cost,margin_pct,flags',
  ...rows.map(r => [
    r.bomId,
    JSON.stringify(r.code || ''),
    JSON.stringify(r.product),
    JSON.stringify(r.company),
    r.lines,
    r.missing,
    fmt(r.bomCostPerUnit),
    fmt(r.salePrice),
    fmt(r.currentStandardPrice),
    r.marginPct === null ? '' : fmt(r.marginPct),
    JSON.stringify((flags.find(f => f.bomId === r.bomId)?.reasons || []).join(' | ')),
  ].join(',')),
].join('\n');
writeFileSync('/Users/ethan/Odoo_Portal_18EE/tmp/bom_audit_2026-04-19.csv', csv);
console.log('\nCSV: tmp/bom_audit_2026-04-19.csv');
