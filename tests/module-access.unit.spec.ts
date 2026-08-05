import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import {
  PORTAL_MODULES, GOVERNED_MODULE_IDS, canUseModule, moduleIdsForUser, defaultModuleIds,
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
    termination: 'hr/termination',
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

test('every module id used in a page gate is a real module', () => {
  // Guards against a typo'd id, which fails closed and would lock everyone out.
  for (const m of PORTAL_MODULES) expect(GOVERNED_MODULE_IDS.has(m.id)).toBe(true);
});
