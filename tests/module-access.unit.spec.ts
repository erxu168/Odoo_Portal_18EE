import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import {
  PORTAL_MODULES, GOVERNED_MODULE_IDS, canUseModule, moduleIdsForUser, defaultModuleIds,
  rolesForModule,
} from '../src/lib/modules';

const ROOT = path.join(__dirname, '..');

/**
 * Module VISIBILITY is now enforced, not just drawn (audit 2026-08-04).
 * These tests protect the two ways it could silently regress: the rule itself
 * going wrong, and a module folder shipping without its gate.
 */

// ── the rule ────────────────────────────────────────────────────────────────

test('staff do NOT get Manufacturing', () => {
  expect(defaultModuleIds('staff')).not.toContain('production');
  expect(canUseModule('staff', null, false, 'production')).toBe(false);
  expect(canUseModule('manager', null, false, 'production')).toBe(true);
  expect(canUseModule('admin', null, false, 'production')).toBe(true);
});

test('an explicit grant still beats the role default', () => {
  // How an admin gives one staff member Manufacturing back, via Manage Staff.
  expect(canUseModule('staff', JSON.stringify(['production']), false, 'production')).toBe(true);
  // ...and an explicit list is an allowlist: everything else is denied.
  expect(canUseModule('staff', JSON.stringify(['production']), false, 'inventory')).toBe(false);
});

test('unknown module ids fail CLOSED', () => {
  // A typo in a guard must deny, never allow.
  expect(canUseModule('admin', null, false, 'manufacturing')).toBe(false); // real id is 'production'
  expect(canUseModule('admin', null, false, 'nope')).toBe(false);
});

test('a candidate only ever gets HR', () => {
  expect(moduleIdsForUser('staff', null, true)).toEqual(['hr']);
  expect(canUseModule('staff', null, true, 'inventory')).toBe(false);
  // Even an explicit grant does not let an applicant into the rest of the portal.
  expect(canUseModule('staff', JSON.stringify(['inventory']), true, 'inventory')).toBe(false);
});

test('a manager sees every staff module plus their own', () => {
  const staff = defaultModuleIds('staff');
  const manager = defaultModuleIds('manager');
  for (const id of staff) expect(manager).toContain(id);
});

// ── the role grid on /admin/permissions ─────────────────────────────────────

test('an empty grid is EXACTLY today’s behaviour', () => {
  // The safety property of the whole feature: no rows saved = nothing changes.
  for (const m of PORTAL_MODULES) {
    expect(rolesForModule(m.id, {})).toEqual(rolesForModule(m.id));
  }
  expect(defaultModuleIds('staff', {})).toEqual(defaultModuleIds('staff'));
  expect(defaultModuleIds('manager', {})).toEqual(defaultModuleIds('manager'));
});

test('unticking a role in the grid takes the module away', () => {
  const grid = { waste: ['manager'] };            // Staff unticked for Waste Tracker
  expect(canUseModule('staff', null, false, 'waste', grid)).toBe(false);
  expect(canUseModule('manager', null, false, 'waste', grid)).toBe(true);
  expect(defaultModuleIds('staff', grid)).not.toContain('waste');
  // ...and leaves every other module alone.
  expect(canUseModule('staff', null, false, 'inventory', grid)).toBe(true);
});

test('ticking a role ON gives a module the registry would have withheld', () => {
  // Prep Planner is manager+ in the registry; the grid can hand it to staff.
  expect(canUseModule('staff', null, false, 'prep-planner')).toBe(false);
  expect(canUseModule('staff', null, false, 'prep-planner', { 'prep-planner': ['staff'] })).toBe(true);
});

test('ADMIN can never be switched off — the anti-lockout rule', () => {
  // Even a grid row that names nobody, or only staff, keeps admin.
  expect(rolesForModule('rentals', { rentals: [] })).toContain('admin');
  expect(rolesForModule('rentals', { rentals: ['staff'] })).toContain('admin');
  expect(canUseModule('admin', null, false, 'rentals', { rentals: [] })).toBe(true);
});

test('a junk grid row cannot grant anything', () => {
  // Roles that are not roles are dropped; admin still survives.
  expect(rolesForModule('waste', { waste: ['owner', 'chef'] })).toEqual(['admin']);
  expect(canUseModule('staff', null, false, 'waste', { waste: ['owner'] })).toBe(false);
  // A grid row for a module that does not exist grants nothing.
  expect(rolesForModule('nope', { nope: ['staff'] })).toEqual([]);
});

test('the three layers stack in the right order', () => {
  const grid = { waste: ['manager'] };            // role rule: staff do NOT get Waste
  // 1. a person's own list BEATS the grid, both ways round
  expect(canUseModule('staff', JSON.stringify(['waste']), false, 'waste', grid)).toBe(true);
  expect(canUseModule('manager', JSON.stringify(['inventory']), false, 'waste', grid)).toBe(false);
  // 2. no personal list -> the grid decides
  expect(canUseModule('staff', null, false, 'waste', grid)).toBe(false);
  // 3. no grid row -> the registry decides
  expect(canUseModule('staff', null, false, 'waste', {})).toBe(true);
  // ...and a candidate is still HR-only regardless of any of it.
  expect(moduleIdsForUser('staff', JSON.stringify(['waste']), true, grid)).toEqual(['hr']);
});

// ── the gates ───────────────────────────────────────────────────────────────

/**
 * Every module that has a page must have a layout.tsx wrapping it in
 * <ModuleGate>. This is what stops a new module shipping with tiles hidden but
 * the URL wide open — the exact hole this whole change closes.
 */
test('every module with pages is gated by a ModuleGate layout', () => {
  // module id -> the app folder that serves it (only ids with their own folder)
  const FOLDERS: Record<string, string> = {
    'shift-handover': 'shift-handover',
    production: 'manufacturing',
    recipes: 'recipes',
    'production-guide': 'recipes',
    inventory: 'inventory',
    labels: 'labels',
    waste: 'waste',
    products: 'products',
    purchase: 'purchase',
    shifts: 'shifts',
    tasks: 'tasks',
    'prep-planner': 'prep-planner',
    cooktimer: 'cooktimer-setup',
    sales: 'sales',
    hr: 'hr',
    rentals: 'rentals',
    music: 'music',
    credentials: 'admin/credentials',
    tablets: 'admin/tablets',
    // The registry's href is /hr/termination, but that page only redirects here —
    // this is where the real screens (and therefore the gate) live.
    termination: 'termination',
  };

  // Every governed module must appear above — a new module forces a decision here.
  for (const id of GOVERNED_MODULE_IDS) {
    expect(FOLDERS, `module '${id}' has no folder mapping in this test`).toHaveProperty(id);
  }

  for (const [id, folder] of Object.entries(FOLDERS)) {
    const layout = path.join(ROOT, 'src/app', folder, 'layout.tsx');
    expect(existsSync(layout), `${folder} has no layout.tsx to gate module '${id}'`).toBe(true);
    const src = readFileSync(layout, 'utf8');
    expect(src, `${folder}/layout.tsx does not use ModuleGate`).toContain('ModuleGate');
    // Either JSX quote style: moduleId="tasks" or moduleId={'tasks'}.
    const gatesOnId = src.includes(`'${id}'`) || src.includes(`"${id}"`);
    expect(gatesOnId, `${folder}/layout.tsx does not gate on module '${id}'`).toBe(true);
  }
});

/**
 * Routes that must stay reachable WITHOUT their module. Each is a real flow that
 * breaks silently if someone "tidies up" by adding the guard everywhere.
 */
test('the deliberately-open routes stay open', () => {
  const MUST_NOT_BE_GATED: Array<[string, string]> = [
    ['src/app/api/shifts/confirm/email/route.ts',
     'the shift-confirm EMAIL LINK — followed with no session at all (it is a public path in middleware)'],
    ['src/app/api/prep-planner/cook-plan/route.ts',
     'the cook plan pops up on EVERY user’s home screen; Prep Planner itself stays manager-only'],
    ['src/app/api/prep-planner/cook-plan/ack/route.ts',
     'how a cook acknowledges that plan — staff self-service'],
  ];
  for (const [file, why] of MUST_NOT_BE_GATED) {
    const full = path.join(ROOT, file);
    expect(existsSync(full), `${file} is missing`).toBe(true);
    expect(readFileSync(full, 'utf8'), `${file} must NOT be module-gated: ${why}`)
      .not.toContain('moduleForbidden');
  }
});

/**
 * Endpoints one module owns but another legitimately reads. Gating them to the
 * owner alone silently breaks the other module's screen — that is exactly how
 * the staff Label Printer nearly shipped broken.
 */
test('shared endpoints still admit the modules that read them', () => {
  const SHARED: Array<[string, string[]]> = [
    ['src/app/api/boms/route.ts',                            ['recipes', 'labels']],
    ['src/app/api/boms/[id]/route.ts',                       ['recipes', 'labels']],
    ['src/app/api/manufacturing-orders/pick-list/route.ts',  ['inventory']],
    ['src/app/api/purchase/suppliers/route.ts',              ['credentials']],
    ['src/app/api/shifts/templates/route.ts',                ['inventory']],
    ['src/app/api/inventory/products/route.ts',              ['products']],
    ['src/app/api/inventory/categories/route.ts',            ['products']],
    ['src/app/api/inventory/count-locations/route.ts',       ['shift-handover']],
  ];
  for (const [file, mustAllow] of SHARED) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    for (const id of mustAllow) {
      expect(src, `${file} must still allow '${id}' — a screen in that module reads it`)
        .toContain(`'${id}'`);
    }
  }
});

test('every module id used in a page gate is a real module', () => {
  // Guards against a typo'd id, which fails closed and would lock everyone out.
  for (const m of PORTAL_MODULES) expect(GOVERNED_MODULE_IDS.has(m.id)).toBe(true);
});
