#!/usr/bin/env node
/**
 * Auto-assign mrp.bom.line.operation_id by matching component product names
 * against the HTML note of each operation on the BOM.
 *
 * Also optionally back-fills stock.move.operation_id on existing confirmed MOs,
 * so the portal's per-step ingredient grouping works for orders already created.
 *
 * Run:
 *   ODOO_PASSWORD=... node scripts/assign-bom-operation-ids.mjs [--dry-run]
 *                                                                [--company=5]
 *                                                                [--bom=<id>]
 *                                                                [--patch-moves]
 *
 * --dry-run      print what would change, do not write
 * --company=N    only BOMs for company N (default: all)
 * --bom=N        only this BOM id
 * --patch-moves  also update stock.move.operation_id on existing MOs in state
 *                ('confirmed','progress','to_close') where the move has a
 *                bom_line_id that we just assigned
 */

const ODOO_URL = process.env.ODOO_URL || 'http://89.167.124.0:15069';
const ODOO_DB = process.env.ODOO_DB || 'krawings';
const ODOO_USER = process.env.ODOO_USER || 'biz@krawings.de';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

if (!ODOO_PASSWORD) {
  console.error('ERROR: Set ODOO_PASSWORD environment variable');
  process.exit(1);
}

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const PATCH_MOVES = argv.includes('--patch-moves');
const COMPANY_ID = (() => {
  const a = argv.find((x) => x.startsWith('--company='));
  return a ? parseInt(a.split('=')[1], 10) : null;
})();
const ONLY_BOM = (() => {
  const a = argv.find((x) => x.startsWith('--bom='));
  return a ? parseInt(a.split('=')[1], 10) : null;
})();

// -- Odoo JSON-RPC ----------------------------------------------------------

let sessionId = null;
let uid = null;
let allowedCompanyIds = [];

async function rpc(endpoint, params) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Cookie'] = `session_id=${sessionId}`;
  const res = await fetch(`${ODOO_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'call', params }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = setCookie.match(/session_id=([^;]+)/);
    if (m) sessionId = m[1];
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`${data.error.message} - ${data.error.data?.message || ''}`);
  }
  return data.result;
}

async function authenticate() {
  const result = await rpc('/web/session/authenticate', {
    db: ODOO_DB, login: ODOO_USER, password: ODOO_PASSWORD,
  });
  uid = result.uid;
  if (!uid) throw new Error('Authentication failed');
  const uc = result.user_companies;
  if (uc?.allowed_companies) {
    allowedCompanyIds = Object.keys(uc.allowed_companies).map(Number);
  }
  console.log(`Authenticated uid=${uid} companies=${allowedCompanyIds}`);
}

function ctx(extra = {}) {
  return { lang: 'en_US', tz: 'Europe/Berlin', allowed_company_ids: allowedCompanyIds, ...extra };
}

async function call(model, method, args = [], kwargs = {}) {
  return rpc('/web/dataset/call_kw', {
    model, method, args,
    kwargs: {
      context: ctx(kwargs.context || {}),
      ...Object.fromEntries(Object.entries(kwargs).filter(([k]) => k !== 'context')),
    },
  });
}

const searchRead = (m, d, f, o = {}) =>
  call(m, 'search_read', [d], { fields: f, limit: o.limit || 0, offset: o.offset || 0, order: o.order || '' });
const read = (m, ids, f) => call(m, 'read', [ids, f]);
const write = (m, ids, vals) => call(m, 'write', [ids, vals]);

// -- Matching ---------------------------------------------------------------

function stripHtml(s) {
  if (!s) return '';
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Tokens from a product name that are meaningful (>= 4 chars, skip stopwords)
const STOP = new Set(['with', 'from', 'the', 'and', 'for', 'raw', 'fresh', 'dried', 'ground', 'whole']);
function tokens(name) {
  return normalize(name).split(' ').filter((t) => t.length >= 4 && !STOP.has(t));
}

function scoreMatch(productName, opText) {
  const toks = tokens(productName);
  if (toks.length === 0) return 0;
  const hay = ' ' + normalize(opText) + ' ';
  let hits = 0;
  for (const t of toks) {
    // match whole word or with trailing 's' (simple plural)
    if (hay.includes(` ${t} `) || hay.includes(` ${t}s `) || hay.includes(` ${t}es `)) hits++;
  }
  return hits / toks.length;
}

function bestOperation(productName, operations) {
  let best = null;
  let bestScore = 0;
  for (const op of operations) {
    const text = `${op.name || ''} ${stripHtml(op.note)}`;
    const s = scoreMatch(productName, text);
    if (s > bestScore) { bestScore = s; best = op; }
  }
  // require at least one token match
  return bestScore > 0 ? { op: best, score: bestScore } : null;
}

// -- Main -------------------------------------------------------------------

async function main() {
  await authenticate();

  const bomDomain = [];
  if (ONLY_BOM) bomDomain.push(['id', '=', ONLY_BOM]);
  if (COMPANY_ID) bomDomain.push(['company_id', '=', COMPANY_ID]);

  const boms = await searchRead('mrp.bom', bomDomain, ['id', 'code', 'product_tmpl_id', 'operation_ids', 'bom_line_ids', 'company_id']);
  console.log(`\nFound ${boms.length} BOM(s)\n`);

  const lineAssignments = []; // {lineId, opId, productName, opName}

  for (const bom of boms) {
    const label = `BOM #${bom.id} — ${bom.product_tmpl_id?.[1] || bom.code || '?'}`;
    if (!bom.operation_ids?.length) {
      console.log(`${label}: no operations, skipped`);
      continue;
    }
    if (!bom.bom_line_ids?.length) {
      console.log(`${label}: no bom lines, skipped`);
      continue;
    }
    const operations = await read('mrp.routing.workcenter', bom.operation_ids, ['id', 'name', 'note']);
    const lines = await read('mrp.bom.line', bom.bom_line_ids, ['id', 'product_id', 'operation_id']);

    console.log(`${label}: ${lines.length} lines, ${operations.length} ops`);
    for (const line of lines) {
      const pname = line.product_id?.[1] || '';
      if (Array.isArray(line.operation_id) && line.operation_id[0]) {
        console.log(`  • ${pname} — already → ${line.operation_id[1]}`);
        continue;
      }
      const m = bestOperation(pname, operations);
      if (!m) {
        console.log(`  • ${pname} — no match, left unassigned`);
        continue;
      }
      console.log(`  • ${pname} → ${m.op.name} (score ${(m.score * 100).toFixed(0)}%)`);
      lineAssignments.push({ lineId: line.id, opId: m.op.id, productName: pname, opName: m.op.name });
    }
  }

  if (lineAssignments.length === 0) {
    console.log('\nNothing to assign.');
    return;
  }

  console.log(`\n${DRY_RUN ? '[dry-run] would update' : 'Updating'} ${lineAssignments.length} bom line(s)...`);
  if (!DRY_RUN) {
    // Group by opId for fewer round-trips
    const byOp = new Map();
    for (const a of lineAssignments) {
      if (!byOp.has(a.opId)) byOp.set(a.opId, []);
      byOp.get(a.opId).push(a.lineId);
    }
    for (const [opId, ids] of byOp) {
      await write('mrp.bom.line', ids, { operation_id: opId });
    }
    console.log('BOM lines updated.');
  }

  if (PATCH_MOVES) {
    console.log(`\n${DRY_RUN ? '[dry-run] would patch' : 'Patching'} stock.move on existing MOs...`);
    // Find moves whose bom_line_id is one we updated, and that belong to an active MO
    const lineIds = lineAssignments.map((a) => a.lineId);
    const moves = await searchRead(
      'stock.move',
      [['bom_line_id', 'in', lineIds], ['raw_material_production_id', '!=', false], ['state', 'in', ['draft', 'waiting', 'confirmed', 'partially_available', 'assigned']]],
      ['id', 'bom_line_id', 'raw_material_production_id', 'operation_id']
    );
    console.log(`  ${moves.length} candidate move(s)`);
    const lineToOp = new Map(lineAssignments.map((a) => [a.lineId, a.opId]));
    const byOp2 = new Map();
    for (const mv of moves) {
      const lineId = Array.isArray(mv.bom_line_id) ? mv.bom_line_id[0] : mv.bom_line_id;
      const opId = lineToOp.get(lineId);
      if (!opId) continue;
      if (Array.isArray(mv.operation_id) && mv.operation_id[0] === opId) continue;
      if (!byOp2.has(opId)) byOp2.set(opId, []);
      byOp2.get(opId).push(mv.id);
    }
    let patched = 0;
    for (const [opId, ids] of byOp2) {
      patched += ids.length;
      if (!DRY_RUN) await write('stock.move', ids, { operation_id: opId });
    }
    console.log(`  ${patched} move(s) ${DRY_RUN ? 'would be' : ''} updated.`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
