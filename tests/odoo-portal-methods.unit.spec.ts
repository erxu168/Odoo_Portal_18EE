import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Every Odoo method the portal calls must be decorated `@api.model`.
 *
 * This exists because the same bug shipped TWICE in one day, hours apart:
 *
 *   e6dded4  a helper inserted above get_attachment_data took its @api.model.
 *            Every task attachment 500'd for two hours.
 *   484071f5 a helper inserted above portal_save_guide took its @api.model.
 *            Saving a generated guide failed with "Guide not found".
 *
 * Both times the cause was the same edit shape — inserting a method directly
 * above an existing one silently transfers the decorator sitting above it —
 * and both times the symptom was obscure, because Odoo's call_kw reads the
 * FIRST argument as a list of record ids when a method is not @api.model. The
 * method then receives the second argument where it expected the first, and
 * fails somewhere far from the cause.
 *
 * A habit would not have caught it; I had just written the commit message
 * explaining the first one when I made the second. A check does.
 */
const ADDON = join(process.cwd(), 'odoo-modules/krawings_task_manager/models');
const PORTAL_LIB = join(process.cwd(), 'src/lib');

/**
 * `getOdoo().call('model.name', 'method_name', [ ... ])` anywhere in src/lib.
 * Group 3 captures whether the FIRST element of the argument list is itself an
 * array — that is the difference that matters.
 *
 * Odoo's call_kw has two conventions:
 *   instance method:  call(model, 'mark_done', [[lineId], employeeId])
 *                     args[0] is a list of ids, and becomes `self`. Correct
 *                     without @api.model.
 *   model method:     call(model, 'portal_read_guide', [guideId])
 *                     args[0] is a plain value the method expects as its first
 *                     parameter — which ONLY works with @api.model, or call_kw
 *                     swallows it as ids.
 */
const CALL_RE = /call\(\s*'([a-z0-9_.]+)'\s*,\s*'([a-z0-9_]+)'\s*,\s*\[\s*(\[?)/g;

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

test('every Odoo method the portal calls is @api.model', () => {
  // What the portal calls.
  const wanted = new Set<string>();
  for (const f of walk(PORTAL_LIB, '.ts')) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(CALL_RE)) {
      // Only the model-method convention needs @api.model. A call passing ids
      // first is the ordinary instance-method form and is correct as it is.
      const idsFirst = m[3] === '[';
      if (m[1].startsWith('krawings.') && !idsFirst) wanted.add(`${m[1]}::${m[2]}`);
    }
  }
  expect(wanted.size, 'found portal→Odoo calls to check').toBeGreaterThan(5);

  // What the addon defines, and whether it is decorated. A method is decorated
  // when @api.model appears in the contiguous decorator block directly above
  // its `def` line — which is exactly the block a careless insert steals.
  const decorated = new Map<string, boolean>();
  for (const f of walk(ADDON, '.py')) {
    const lines = readFileSync(f, 'utf8').split('\n');
    let model: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const nameMatch = lines[i].match(/^\s*_name\s*=\s*'([a-z0-9_.]+)'/);
      if (nameMatch) model = nameMatch[1];
      const defMatch = lines[i].match(/^\s{4}def\s+([a-z0-9_]+)\s*\(/);
      if (!defMatch || !model) continue;
      let isModel = false;
      for (let j = i - 1; j >= 0; j--) {
        const t = lines[j].trim();
        if (!t.startsWith('@')) break;          // end of the decorator block
        if (t.startsWith('@api.model')) { isModel = true; break; }
      }
      decorated.set(`${model}::${defMatch[1]}`, isModel);
    }
  }

  const undecorated: string[] = [];
  const missing: string[] = [];
  for (const key of wanted) {
    if (!decorated.has(key)) { missing.push(key); continue; }
    if (!decorated.get(key)) undecorated.push(key);
  }

  // A call naming a method that does not exist is its own bug — a typo or a
  // rename that left the portal behind.
  expect(missing, 'portal calls a method the addon does not define').toEqual([]);
  expect(
    undecorated,
    'these are called from the portal but lack @api.model, so call_kw will read '
    + 'the first argument as record ids and the method will receive the wrong values',
  ).toEqual([]);
});
