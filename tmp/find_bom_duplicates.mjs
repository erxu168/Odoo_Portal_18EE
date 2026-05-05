// Find 1:1 duplicate BOMs: same product template, same lines (component + qty + uom), across different companies.
// Also check whether each duplicate has Manufacturing Orders attached (safe-to-delete signal).

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

const boms = await call('mrp.bom', 'search_read', [
  [['type', '=', 'normal']],
  ['id', 'product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id', 'company_id', 'code'],
], { limit: 5000 });

const lines = await call('mrp.bom.line', 'search_read', [
  [['bom_id', 'in', boms.map(b => b.id)]],
  ['bom_id', 'product_id', 'product_qty', 'product_uom_id'],
], { limit: 50000 });

// Check MO counts per BOM
const mos = await call('mrp.production', 'read_group', [
  [['bom_id', 'in', boms.map(b => b.id)]],
  ['bom_id'],
  ['bom_id'],
], {});
const moCount = Object.fromEntries(mos.map(g => [g.bom_id[0], g.bom_id_count]));

// Build line signature per bom
const linesByBom = {};
for (const l of lines) {
  (linesByBom[l.bom_id[0]] ||= []).push(l);
}

function sig(bom) {
  const ls = (linesByBom[bom.id] || [])
    .map(l => `${l.product_id[0]}:${l.product_qty}:${l.product_uom_id[0]}`)
    .sort()
    .join('|');
  return `tmpl=${bom.product_tmpl_id[0]}|out_qty=${bom.product_qty}|out_uom=${bom.product_uom_id[0]}|${ls}`;
}

const groups = {};
for (const b of boms) {
  const s = sig(b);
  (groups[s] ||= []).push(b);
}

const dupeGroups = Object.values(groups).filter(g => g.length > 1);
console.log(`Found ${dupeGroups.length} duplicate groups covering ${dupeGroups.reduce((a,g) => a + g.length, 0)} BOMs\n`);

const deletions = [];
const conflicts = [];

for (const group of dupeGroups) {
  console.log(`--- ${group[0].product_tmpl_id[1]} (tmpl ${group[0].product_tmpl_id[0]}) ---`);
  for (const b of group) {
    console.log(`  BOM ${b.id}  company=${b.company_id ? b.company_id[1] : 'all'}  MOs=${moCount[b.id] || 0}  code=${b.code || ''}`);
  }
  // Decide: keep the one with most MOs; tiebreak: oldest (lowest id)
  const sorted = [...group].sort((a, b) => {
    const ma = moCount[a.id] || 0, mb = moCount[b.id] || 0;
    if (mb !== ma) return mb - ma;
    return a.id - b.id;
  });
  const keep = sorted[0];
  const drop = sorted.slice(1);
  const anyDropHasMOs = drop.some(b => (moCount[b.id] || 0) > 0);
  if (anyDropHasMOs) {
    conflicts.push({ group, keep, drop });
    console.log(`  !! cannot auto-delete — a duplicate has MOs attached`);
  } else {
    deletions.push({ keep, drop });
    console.log(`  → keep BOM ${keep.id}, delete: ${drop.map(b => b.id).join(', ')}`);
  }
  console.log('');
}

console.log(`\nSUMMARY`);
console.log(`  safe to delete: ${deletions.reduce((a, d) => a + d.drop.length, 0)} BOMs across ${deletions.length} groups`);
console.log(`  needs manual review: ${conflicts.length} groups`);

// Write a deletion manifest
import { writeFileSync } from 'node:fs';
const manifest = {
  generated_at: new Date().toISOString(),
  safe_to_delete: deletions.map(({ keep, drop }) => ({
    product: keep.product_tmpl_id[1],
    keep_bom_id: keep.id,
    keep_company: keep.company_id ? keep.company_id[1] : null,
    delete_bom_ids: drop.map(b => b.id),
  })),
  conflicts: conflicts.map(({ keep, drop }) => ({
    product: keep.product_tmpl_id[1],
    would_keep: keep.id,
    would_delete_but_have_mos: drop.map(b => ({ id: b.id, mo_count: moCount[b.id] || 0 })),
  })),
};
writeFileSync('/Users/ethan/Odoo_Portal_18EE/tmp/bom_dupe_deletion_plan.json', JSON.stringify(manifest, null, 2));
console.log(`\nPlan: tmp/bom_dupe_deletion_plan.json`);
