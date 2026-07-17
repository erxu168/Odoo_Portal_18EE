# Guided Inventory — Phase 1: Location Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager model their restaurant as a set of count locations (areas → shelves/spots), each with a photo, description and walking order, and assign products to spots in shelf order — the data foundation the guided counting experience will stand on.

**Architecture:** Add a portal-side location hierarchy in SQLite (`count_locations`, `product_locations`) that Odoo never sees; each spot optionally references a real Odoo `stock.location` for a future write. Expose it through two REST routes guarded by a new `inventory.location.manage` capability, and a manager-only setup screen. No staff-facing behaviour changes in this phase — existing counting is untouched.

**Tech Stack:** Next.js 14 (app-router), better-sqlite3, React/OWL-free client components, Odoo 18 EE via `src/lib/odoo.ts` (server-only), Playwright (`unit` + `modules` projects).

## Global Constraints

- **Single branch:** all work on `main`. `git checkout main && git pull --ff-only` before starting; confirm `git branch --show-current` is `main`.
- **Never edit source on the server** — all changes via GitHub; deploy is `git pull && npm run build && systemctl restart krawings-portal` on staging (`89.167.124.0`, `/opt/krawings-portal`).
- **`npm run build` must pass before every commit** — it typechecks. Never pipe it (masks exit code).
- **All Odoo calls server-side only**, through `src/lib/odoo.ts`; the browser never talks to Odoo.
- **Additive & migration-safe:** new tables use `CREATE TABLE IF NOT EXISTS` inside `initInventoryTables()`; never alter existing inventory tables in this phase.
- **Permission pattern:** every write route calls `requireAuth()` then `roleCan(user.role, '<key>', getPermissionOverrides())`; unknown keys fail closed to admin-only.
- **Company scoping:** locations belong to one company; scope every read/write by `company_id` (mirror `src/app/api/inventory/locations/route.ts` + `parseCompanyIds(user.allowed_company_ids)`).
- **Copy rules:** plain language, no ERP jargon (see `src/lib/ux-rules.ts`); status shown as icon + colour + text, never colour alone; one primary action per screen.
- **TypeScript pitfalls:** `err: unknown` + `instanceof` in catch; JSX apostrophes as `’`; `Array.from()` not `[...set]`; fix `prefer-const`.
- **Testing rule (non-negotiable):** a changed portal module is not "done" until it has been real-browser Playwright-tested on **staging**. Pure helpers get `*.unit.spec.ts` (`npm run test:unit`); screens get `*.e2e.spec.ts` (`npm run test:inventory`).

---

## Where this sits — the whole build, decomposed

This plan is **Phase 1 of 5**. Each phase produces working, testable software on its own and can ship to staging independently.

| Phase | Delivers | Depends on | Rough size |
|---|---|---|---|
| **0 · Go Live** *(non-code, parallel)* | Existing inventory app in real staff use: prod deploy window, staff PINs, lists assigned to real people | — | days |
| **1 · Location layer** *(this plan)* | Manager builds the restaurant map: areas → shelves, photo + description + walking order, products assigned to spots | — | ~1–2 wks |
| **2 · Guided route + missed-location gate** | Staff counting becomes location-by-location in shelf order; can't finish until every spot is counted or skipped-with-reason; aggregate-by-Odoo-location at approval | Phase 1 | ~1–2 wks |
| **3 · Notes, staff-added items & manager instructions** | Staff report / add off-list items; manager posts instructions (one-off or repeating) that appear in the app | Phase 2 | ~1 wk |
| **4 · Conversion+ & analytics** | Manager-assisted weight helper, effective-dated factors, count-history variance & auditable quality measures | Phase 2 | ~1 wk |
| **5 · Hardening & future-ready** | Photos to file storage, exact-quant apply + sync retries, QR labels; later NFC/scales/AI only if ROI proven | Phase 2 | ongoing |

Everything in Phases 2–3 was validated in the interactive mockup. This plan builds only Phase 1.

---

## File structure (Phase 1)

- **Create** `src/lib/location-tree.ts` — pure helpers: build the area→shelf tree, compute sort order, reorder. No I/O, unit-tested.
- **Modify** `src/lib/inventory-db.ts` — add `count_locations` + `product_locations` tables to `initInventoryTables()`, plus CRUD functions.
- **Modify** `src/types/inventory.ts` — `CountLocation`, `ProductPlacement`, `LocationNode` types.
- **Modify** `src/lib/permissions.ts` — register `inventory.location.manage`.
- **Create** `src/app/api/inventory/count-locations/route.ts` — GET / POST / PUT / DELETE for the hierarchy.
- **Create** `src/app/api/inventory/product-locations/route.ts` — GET / PUT for product-to-spot placements.
- **Create** `src/components/inventory/LocationManager.tsx` — manager setup screen (list, add/edit, photo, reorder, assign products).
- **Modify** `src/components/inventory/InventoryDashboard.tsx` — add a "Locations" tile gated on `inventory.location.manage`.
- **Modify** `src/app/inventory/page.tsx` — route the `locations` screen to `LocationManager`.
- **Create** `tests/location-tree.unit.spec.ts` — unit tests for the pure helper.
- **Create** `tests/inventory-locations.e2e.spec.ts` — staging e2e: manager creates an area + shelf + assigns a product, reload persists.

---

## Hardening refinements from the architecture cross-check (apply within the relevant task)

An independent architecture review (Codex, `gpt-5.6-sol`) validated this plan and flagged these concrete improvements — fold each into the task noted:

1. **Company-scope every write (Tasks 3 & 4).** Change `updateCountLocation(id, data)` → `updateCountLocation(id, companyId, data)` and `deleteCountLocation(id)` → `deleteCountLocation(id, companyId)`, adding `AND company_id = ?` to their WHERE clauses (and to the descendant collection inside delete). The route resolves the company via `resolveCompany(user, …)` and passes it — so a manager can **never** edit or delete another company's location by guessing an id. For `product-locations` PUT, verify the target `count_location_id` belongs to the caller's company before writing.
2. **Active-company source (Task 6).** The portal exposes a `useCompany()` hook — use it in `LocationManager` to get the active company and pass `?company_id=` on the GETs. Grep first: `grep -rn "useCompany" src/ | head`.
3. **Reorder in one transaction (Task 6).** Prefer a dedicated `PUT /api/inventory/count-locations/reorder` taking `{ items: [{ id, sort_order }] }` written in a single `db.transaction`, instead of N parallel PUTs (avoids partial-failure). Optional for small sibling counts, recommended otherwise.
4. **Deletion & history (Task 3).** Phase 1 hard-deletes (no history yet). The moment Phase 2's session tables reference locations, switch to **soft-delete** (`active = 0`, already filtered by `listCountLocations`) or block with `409` when referenced — never orphan a historical count. Add a code comment marking this at `deleteCountLocation`.
5. **Odoo location belongs to same company (Task 4).** If `odoo_location_id` is set, validate via the Odoo client that it belongs to the caller's company before saving.
6. **Do not make `odoo_location_id` unique** — several shelves may map to one Odoo location on purpose; the aggregate-at-approval step in Phase 2 depends on it.

---

### Task 1: Pure location-tree helper

**Files:**
- Create: `src/lib/location-tree.ts`
- Test: `tests/location-tree.unit.spec.ts`

**Interfaces:**
- Produces: `buildLocationTree(rows: CountLocation[]): LocationNode[]`, `nextSortOrder(siblings: { sort_order: number }[]): number`, `reorder(ordered: number[], id: number, dir: -1 | 1): number[]`
- Consumes: `CountLocation`, `LocationNode` (defined in Task 3's type file; for this task they are structurally `{ id:number; parent_id:number|null; sort_order:number; ... }`). To keep Task 1 self-contained, define the minimal shapes inline here and re-export the richer types in Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// tests/location-tree.unit.spec.ts
import { test, expect } from '@playwright/test';
import { buildLocationTree, nextSortOrder, reorder } from '../src/lib/location-tree';

const rows = [
  { id: 1, parent_id: null, name: 'Kitchen', sort_order: 10 },
  { id: 2, parent_id: 1, name: 'Dry shelf', sort_order: 10 },
  { id: 3, parent_id: 1, name: 'Fridge', sort_order: 20 },
  { id: 4, parent_id: null, name: 'Bar', sort_order: 20 },
] as any;

test('buildLocationTree nests children under parents, sorted by sort_order', () => {
  const tree = buildLocationTree(rows);
  expect(tree.map(n => n.name)).toEqual(['Kitchen', 'Bar']);
  expect(tree[0].children.map(c => c.name)).toEqual(['Dry shelf', 'Fridge']);
  expect(tree[1].children).toEqual([]);
});

test('nextSortOrder returns max + 10 (10 when empty)', () => {
  expect(nextSortOrder([])).toBe(10);
  expect(nextSortOrder([{ sort_order: 10 }, { sort_order: 30 }])).toBe(40);
});

test('reorder swaps an id with its neighbour in the given direction', () => {
  expect(reorder([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
  expect(reorder([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  expect(reorder([1, 2, 3], 1, -1)).toEqual([1, 2, 3]); // no-op at edge
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- location-tree`
Expected: FAIL — `Cannot find module '../src/lib/location-tree'`.

- [ ] **Step 3: Write the helper**

```ts
// src/lib/location-tree.ts
/** Pure helpers for the count-location hierarchy. No I/O — safe to unit test. */

export interface TreeRow {
  id: number;
  parent_id: number | null;
  sort_order: number;
  [k: string]: unknown;
}

export type LocationNode<T extends TreeRow = TreeRow> = T & { children: LocationNode<T>[] };

/** Nest children under parents (2 levels in practice, but works to any depth), each level sorted by sort_order then id. */
export function buildLocationTree<T extends TreeRow>(rows: T[]): LocationNode<T>[] {
  const byId = new Map<number, LocationNode<T>>();
  rows.forEach(r => byId.set(r.id, { ...(r as T), children: [] }));
  const roots: LocationNode<T>[] = [];
  byId.forEach(node => {
    const pid = node.parent_id;
    if (pid != null && byId.has(pid)) byId.get(pid)!.children.push(node);
    else roots.push(node);
  });
  const sort = (a: LocationNode<T>, b: LocationNode<T>) => a.sort_order - b.sort_order || a.id - b.id;
  const walk = (list: LocationNode<T>[]) => { list.sort(sort); list.forEach(n => walk(n.children)); };
  walk(roots);
  return roots;
}

/** Next walking-order value for a sibling set: max + 10, or 10 when empty. Gaps of 10 leave room to insert. */
export function nextSortOrder(siblings: { sort_order: number }[]): number {
  if (siblings.length === 0) return 10;
  return Math.max(...siblings.map(s => s.sort_order)) + 10;
}

/** Move an id one slot in the given direction within an ordered id list. Edge moves are a no-op. */
export function reorder(ordered: number[], id: number, dir: -1 | 1): number[] {
  const i = ordered.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return ordered.slice();
  const next = ordered.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- location-tree`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/location-tree.ts tests/location-tree.unit.spec.ts
git commit -m "[ADD] inventory: pure location-tree helper (build/reorder) + unit tests"
```

---

### Task 2: Register the `inventory.location.manage` permission

**Files:**
- Modify: `src/lib/permissions.ts` (the `PERMISSION_ACTIONS` array, inventory block ~line 82–87)
- Test: `tests/permissions.unit.spec.ts` (existing — add one assertion)

**Interfaces:**
- Produces: capability key string `'inventory.location.manage'`, default roles `['manager','admin']`.

- [ ] **Step 1: Add the assertion to the existing permissions unit test**

```ts
// tests/permissions.unit.spec.ts — add inside the existing describe/suite
import { roleCan } from '../src/lib/permissions';

test('inventory.location.manage is manager+admin only', () => {
  expect(roleCan('manager', 'inventory.location.manage', {})).toBe(true);
  expect(roleCan('admin',   'inventory.location.manage', {})).toBe(true);
  expect(roleCan('staff',   'inventory.location.manage', {})).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- permissions`
Expected: FAIL — staff currently resolves unknown key to admin-only, so `roleCan('manager', …)` returns `false`.

- [ ] **Step 3: Register the key**

In `src/lib/permissions.ts`, add to the inventory block of `PERMISSION_ACTIONS` (after `inventory.productsettings.manage`):

```ts
  { key: 'inventory.location.manage',       module: 'inventory', label: 'Set up count locations (map, shelves, photos)',   defaultRoles: ['manager', 'admin'] },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- permissions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts tests/permissions.unit.spec.ts
git commit -m "[ADD] inventory: inventory.location.manage capability"
```

---

### Task 3: Database schema, types & CRUD

**Files:**
- Modify: `src/types/inventory.ts`
- Modify: `src/lib/inventory-db.ts` (add tables to `initInventoryTables()`; add CRUD section)

**Interfaces:**
- Produces:
  - Types `CountLocation`, `ProductPlacement`, `LocationNode`.
  - `createCountLocation(data): number`, `updateCountLocation(id, data): void`, `deleteCountLocation(id): void`, `listCountLocations(companyId): CountLocation[]`, `setProductPlacements(countLocationId, items): void`, `getPlacements(countLocationId): ProductPlacement[]`, `getLocationsForProduct(productId): number[]`.

- [ ] **Step 1: Add types**

Append to `src/types/inventory.ts`:

```ts
// ── Location layer (portal SQLite) ──
export type LocationKind = 'area' | 'fridge' | 'freezer' | 'dry' | 'zone' | 'bar';

export interface CountLocation {
  id: number;
  parent_id: number | null;
  company_id: number;
  name: string;
  kind: LocationKind;
  description: string | null;
  photo: string | null;            // base64 data URL (Phase 1; object storage in Phase 5)
  sort_order: number;              // walking-route order among siblings
  odoo_location_id: number | null; // optional real stock.location for a future write
  active: boolean;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface ProductPlacement {
  odoo_product_id: number;
  count_location_id: number;
  shelf_sort: number;              // order on the shelf
}
```

- [ ] **Step 2: Add tables to `initInventoryTables()`**

In `src/lib/inventory-db.ts`, inside the `db.exec(\`…\`)` template in `initInventoryTables()`, append before the closing backtick:

```sql
    CREATE TABLE IF NOT EXISTS count_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'area',
      description TEXT,
      photo TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      odoo_location_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_locations (
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      shelf_sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (odoo_product_id, count_location_id)
    );

    CREATE INDEX IF NOT EXISTS idx_count_locations_company ON count_locations(company_id);
    CREATE INDEX IF NOT EXISTS idx_count_locations_parent ON count_locations(parent_id);
    CREATE INDEX IF NOT EXISTS idx_product_locations_loc ON product_locations(count_location_id);
```

Add the type import at the top of `inventory-db.ts` (extend the existing `import type { … } from '@/types/inventory'`): add `CountLocation, ProductPlacement`.

- [ ] **Step 3: Add the CRUD functions**

Append to `src/lib/inventory-db.ts`:

```ts
// ===
// COUNT LOCATIONS (the digital twin — portal-owned)
// ===

export function createCountLocation(data: {
  parent_id?: number | null;
  company_id: number;
  name: string;
  kind?: string;
  description?: string | null;
  photo?: string | null;
  odoo_location_id?: number | null;
  created_by: number;
}): number {
  const db = getDb();
  const ts = now();
  // Default sort_order = max sibling + 10 within the same company + parent.
  const sib = db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM count_locations
     WHERE company_id = ? AND ${data.parent_id != null ? 'parent_id = ?' : 'parent_id IS NULL'}`
  ).get(...(data.parent_id != null ? [data.company_id, data.parent_id] : [data.company_id])) as { m: number };
  const r = db.prepare(`
    INSERT INTO count_locations (parent_id, company_id, name, kind, description, photo, sort_order, odoo_location_id, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    data.parent_id ?? null, data.company_id, data.name, data.kind || 'area',
    data.description ?? null, data.photo ?? null, sib.m + 10,
    data.odoo_location_id ?? null, data.created_by, ts, ts
  );
  return r.lastInsertRowid as number;
}

export function updateCountLocation(id: number, data: Partial<{
  name: string; kind: string; description: string | null; photo: string | null;
  sort_order: number; odoo_location_id: number | null; parent_id: number | null; active: boolean;
}>): void {
  const db = getDb();
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if (data.name !== undefined) put('name', data.name);
  if (data.kind !== undefined) put('kind', data.kind);
  if (data.description !== undefined) put('description', data.description);
  if (data.photo !== undefined) put('photo', data.photo);
  if (data.sort_order !== undefined) put('sort_order', data.sort_order);
  if (data.odoo_location_id !== undefined) put('odoo_location_id', data.odoo_location_id);
  if (data.parent_id !== undefined) put('parent_id', data.parent_id);
  if (data.active !== undefined) put('active', data.active ? 1 : 0);
  if (sets.length === 0) return;
  put('updated_at', now()); vals.push(id);
  db.prepare(`UPDATE count_locations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/** Delete a location and everything under it (children + all placements). No FK reliance. */
export function deleteCountLocation(id: number): void {
  const db = getDb();
  const ids: number[] = [];
  const collect = (parent: number) => {
    ids.push(parent);
    const kids = db.prepare('SELECT id FROM count_locations WHERE parent_id = ?').all(parent) as { id: number }[];
    kids.forEach(k => collect(k.id));
  };
  collect(id);
  const tx = db.transaction(() => {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM product_locations WHERE count_location_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM count_locations WHERE id IN (${ph})`).run(...ids);
  });
  tx();
}

export function listCountLocations(companyId: number): CountLocation[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM count_locations WHERE company_id = ? AND active = 1 ORDER BY sort_order, id'
  ).all(companyId) as Record<string, unknown>[];
  return rows.map(r => ({ ...(r as unknown as CountLocation), active: !!r.active }));
}

/** Replace the full placement set for a location (products + their shelf order). */
export function setProductPlacements(countLocationId: number, items: { odoo_product_id: number; shelf_sort: number }[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM product_locations WHERE count_location_id = ?').run(countLocationId);
    const ins = db.prepare('INSERT INTO product_locations (odoo_product_id, count_location_id, shelf_sort) VALUES (?, ?, ?)');
    items.forEach(it => ins.run(it.odoo_product_id, countLocationId, it.shelf_sort));
  });
  tx();
}

export function getPlacements(countLocationId: number): ProductPlacement[] {
  const db = getDb();
  return db.prepare(
    'SELECT odoo_product_id, count_location_id, shelf_sort FROM product_locations WHERE count_location_id = ? ORDER BY shelf_sort, odoo_product_id'
  ).all(countLocationId) as ProductPlacement[];
}

export function getLocationsForProduct(productId: number): number[] {
  const db = getDb();
  return (db.prepare('SELECT count_location_id FROM product_locations WHERE odoo_product_id = ?').all(productId) as { count_location_id: number }[])
    .map(r => r.count_location_id);
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no type errors). New tables are created lazily on next DB access via `initInventoryTables()`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory-db.ts src/types/inventory.ts
git commit -m "[ADD] inventory: count_locations + product_locations schema & CRUD"
```

---

### Task 4: `count-locations` API route

**Files:**
- Create: `src/app/api/inventory/count-locations/route.ts`

**Interfaces:**
- Consumes: `createCountLocation`, `updateCountLocation`, `deleteCountLocation`, `listCountLocations` (Task 3); `requireAuth` (`@/lib/auth`); `roleCan` + `getPermissionOverrides`; `parseCompanyIds` (`@/lib/db`).
- Produces: `GET /api/inventory/count-locations?company_id=` → `{ locations: CountLocation[] }`; `POST` → `{ id }`; `PUT` → `{ message }`; `DELETE?id=` → `{ message }`.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/inventory/count-locations/route.ts
export const dynamic = 'force-dynamic';
/**
 * /api/inventory/count-locations
 * GET    — list a company's count locations (flat; client builds the tree)
 * POST   — create a location (manager/admin)
 * PUT    — update a location incl. reorder (manager/admin)
 * DELETE — remove a location + its children & placements (manager/admin)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import {
  createCountLocation, updateCountLocation, deleteCountLocation, listCountLocations,
} from '@/lib/inventory-db';

const KEY = 'inventory.location.manage';

function resolveCompany(user: { allowed_company_ids: string }, requested: number | null): number | null {
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (requested && allowed.includes(requested)) return requested;
  return allowed.length > 0 ? allowed[0] : null;
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const companyId = resolveCompany(user, parseInt(searchParams.get('company_id') || '0', 10) || null);
  if (!companyId) return NextResponse.json({ locations: [] });
  return NextResponse.json({ locations: listCountLocations(companyId) });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden — manager role required' }, { status: 403 });

  const body = await request.json();
  const companyId = resolveCompany(user, body.company_id ?? null);
  if (!companyId) return NextResponse.json({ error: 'No company available' }, { status: 400 });
  if (!body.name || !String(body.name).trim())
    return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const id = createCountLocation({
    parent_id: body.parent_id ?? null,
    company_id: companyId,
    name: String(body.name).trim(),
    kind: body.kind || 'area',
    description: body.description ?? null,
    photo: body.photo ?? null,
    odoo_location_id: body.odoo_location_id ?? null,
    created_by: user.id,
  });
  return NextResponse.json({ id }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  updateCountLocation(id, updates);
  return NextResponse.json({ message: 'Location updated' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') || '0', 10);
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  deleteCountLocation(id);
  return NextResponse.json({ message: 'Location removed' });
}
```

- [ ] **Step 2: Confirm `parseCompanyIds` is exported from `@/lib/db`**

Run: `grep -n "export function parseCompanyIds" src/lib/db.ts`
Expected: one match. (Used already by `locations/route.ts`.) If it lives elsewhere, import from there.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/inventory/count-locations/route.ts
git commit -m "[ADD] inventory: count-locations API (CRUD, company-scoped)"
```

---

### Task 5: `product-locations` API route

**Files:**
- Create: `src/app/api/inventory/product-locations/route.ts`

**Interfaces:**
- Consumes: `setProductPlacements`, `getPlacements`, `getLocationsForProduct` (Task 3).
- Produces: `GET ?count_location_id=` → `{ placements }`; `GET ?product_id=` → `{ location_ids }`; `PUT` body `{ count_location_id, items:[{odoo_product_id, shelf_sort}] }` → `{ message }`.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/inventory/product-locations/route.ts
export const dynamic = 'force-dynamic';
/**
 * /api/inventory/product-locations
 * GET ?count_location_id= — products placed at a spot (with shelf order)
 * GET ?product_id=        — which spots a product lives in
 * PUT                     — replace a spot's full placement set (manager/admin)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { setProductPlacements, getPlacements, getLocationsForProduct } from '@/lib/inventory-db';

const KEY = 'inventory.location.manage';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const locId = parseInt(searchParams.get('count_location_id') || '0', 10);
  const prodId = parseInt(searchParams.get('product_id') || '0', 10);
  if (locId) return NextResponse.json({ placements: getPlacements(locId) });
  if (prodId) return NextResponse.json({ location_ids: getLocationsForProduct(prodId) });
  return NextResponse.json({ error: 'count_location_id or product_id required' }, { status: 400 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { count_location_id, items } = body;
  if (!count_location_id || !Array.isArray(items))
    return NextResponse.json({ error: 'count_location_id and items[] are required' }, { status: 400 });

  setProductPlacements(count_location_id, items.map((it: { odoo_product_id: number; shelf_sort?: number }, i: number) => ({
    odoo_product_id: it.odoo_product_id,
    shelf_sort: it.shelf_sort ?? (i + 1) * 10,
  })));
  return NextResponse.json({ message: 'Placements saved' });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/product-locations/route.ts
git commit -m "[ADD] inventory: product-locations API (assign products to spots)"
```

---

### Task 6: Manager setup screen + dashboard tile + routing

**Files:**
- Create: `src/components/inventory/LocationManager.tsx`
- Modify: `src/components/inventory/InventoryDashboard.tsx` (add tile)
- Modify: `src/app/inventory/page.tsx` (route `'locations'` → `LocationManager`)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/inventory/count-locations`, `GET/PUT /api/inventory/product-locations`, `GET /api/inventory/products?include_pos=1`, `buildLocationTree`/`reorder` (Task 1).
- Produces: React component `LocationManager({ onHome }: { onHome: () => void })`.

- [ ] **Step 1: Confirm how sibling screens get the active company + how the dashboard passes props**

Run: `grep -n "onNavigate\|activeCompany\|company_id\|/api/auth/me\|screen ===" src/app/inventory/page.tsx | head -30`
Expected: shows the `screen` switch and how `InventoryDashboard` / other screens are mounted and how the active company reaches them. Mirror that exact mechanism below (the code assumes the company is resolved server-side from `allowed_company_ids`; if `page.tsx` threads an `activeCompany`, pass it as `?company_id=`).

- [ ] **Step 2: Write `LocationManager.tsx`**

```tsx
// src/components/inventory/LocationManager.tsx
'use client';
import React, { useEffect, useState, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import FilePicker from '@/components/ui/FilePicker';
import { buildLocationTree, reorder } from '@/lib/location-tree';
import type { CountLocation } from '@/types/inventory';

const KINDS = [
  { v: 'area', l: 'Area' }, { v: 'fridge', l: 'Fridge' }, { v: 'freezer', l: 'Freezer' },
  { v: 'dry', l: 'Dry store' }, { v: 'zone', l: 'Zone' }, { v: 'bar', l: 'Bar' },
];

function downscale(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900; let w = img.width, h = img.height;
        if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function LocationManager({ onHome }: { onHome: () => void }) {
  const [locations, setLocations] = useState<CountLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CountLocation> | null>(null); // null = closed
  const [assignFor, setAssignFor] = useState<CountLocation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/inventory/count-locations').then(r => r.json());
      setLocations(d.locations || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const tree = buildLocationTree(locations as any);

  async function save(loc: Partial<CountLocation>) {
    const method = loc.id ? 'PUT' : 'POST';
    await fetch('/api/inventory/count-locations', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loc),
    });
    setEditing(null); await load();
  }
  async function remove(id: number) {
    if (!confirm('Remove this location and everything under it?')) return;
    await fetch(`/api/inventory/count-locations?id=${id}`, { method: 'DELETE' });
    await load();
  }
  async function move(node: CountLocation, dir: -1 | 1) {
    const siblings = locations.filter(l => l.parent_id === node.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const orderedIds = reorder(siblings.map(s => s.id), node.id, dir);
    await Promise.all(orderedIds.map((id, i) =>
      fetch('/api/inventory/count-locations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, sort_order: (i + 1) * 10 }) })
    ));
    await load();
  }

  if (loading) return <div className="min-h-screen bg-gray-50"><AppHeader title="Locations" /><div className="p-8 text-center text-gray-400">Loading…</div></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Locations" subtitle="Set up where staff count" />
      <div className="px-4 py-4 space-y-3">
        {tree.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-gray-500">
            No locations yet. Add your first area (e.g. “Walk-in Fridge”).
          </div>
        )}
        {tree.map((area: any) => (
          <div key={area.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <div className="w-11 h-11 rounded-xl bg-cover bg-center bg-gray-100 flex-shrink-0"
                   style={area.photo ? { backgroundImage: `url(${area.photo})` } : {}} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-900 truncate">{area.name}</div>
                <div className="text-xs text-gray-500">{KINDS.find(k => k.v === area.kind)?.l || area.kind}</div>
              </div>
              <button onClick={() => move(area, -1)} className="w-8 h-8 rounded-lg bg-gray-100 active:bg-gray-200">↑</button>
              <button onClick={() => move(area, 1)} className="w-8 h-8 rounded-lg bg-gray-100 active:bg-gray-200">↓</button>
              <button onClick={() => setEditing(area)} className="text-sm font-semibold text-blue-600 px-2">Edit</button>
            </div>
            <div className="border-t border-gray-100 divide-y divide-gray-100">
              {area.children.map((shelf: any) => (
                <div key={shelf.id} className="flex items-center gap-3 px-3 py-2.5 pl-6">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 text-sm truncate">{shelf.name}</div>
                    <div className="text-[11px] text-gray-400">{KINDS.find(k => k.v === shelf.kind)?.l || shelf.kind}</div>
                  </div>
                  <button onClick={() => move(shelf, -1)} className="w-7 h-7 rounded-lg bg-gray-100 text-sm">↑</button>
                  <button onClick={() => move(shelf, 1)} className="w-7 h-7 rounded-lg bg-gray-100 text-sm">↓</button>
                  <button onClick={() => setAssignFor(shelf)} className="text-xs font-semibold text-green-700 px-1">Products</button>
                  <button onClick={() => setEditing(shelf)} className="text-xs font-semibold text-blue-600 px-1">Edit</button>
                </div>
              ))}
              <button onClick={() => setEditing({ parent_id: area.id, kind: 'zone' })}
                      className="w-full text-left px-6 py-2.5 text-sm font-semibold text-green-700 active:bg-gray-50">
                + Add a shelf / spot
              </button>
            </div>
          </div>
        ))}
        <button onClick={() => setEditing({ parent_id: null, kind: 'area' })}
                className="w-full py-4 rounded-2xl bg-green-600 text-white font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
          + Add an area
        </button>
      </div>

      {editing && (
        <LocationForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
          onDelete={editing.id ? () => remove(editing.id!) : undefined}
          downscale={downscale}
          FilePicker={FilePicker}
        />
      )}
      {assignFor && (
        <AssignProducts location={assignFor} onClose={() => setAssignFor(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the `LocationForm` + `AssignProducts` sub-components (same file, below the default export)**

```tsx
function LocationForm({ initial, onCancel, onSave, onDelete, downscale, FilePicker }: any) {
  const [name, setName] = useState(initial.name || '');
  const [kind, setKind] = useState(initial.kind || 'area');
  const [description, setDescription] = useState(initial.description || '');
  const [photo, setPhoto] = useState<string | null>(initial.photo || null);
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-3">{initial.id ? 'Edit location' : 'New location'}</h3>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Walk-in Fridge"
               className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50" />
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Type</label>
        <select value={kind} onChange={e => setKind(e.target.value)} className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50">
          {KINDS.map(k => <option key={k.v} value={k.v}>{k.l}</option>)}
        </select>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Where to stand (optional)</label>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Back-left wall, top two shelves"
               className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50" />
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Photo (optional)</label>
        {photo ? (
          <div className="relative mb-3">
            <img src={photo} alt="" className="w-full rounded-xl border border-gray-200" />
            <button onClick={() => setPhoto(null)} className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8">×</button>
          </div>
        ) : (
          <FilePicker accept="image/*" onFile={async (f: File) => setPhoto(await downscale(f))}
                      label="Add a photo" className="w-full py-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-semibold mb-3" />
        )}
        <div className="flex gap-3 mt-2">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold">Cancel</button>
          <button onClick={() => name.trim() && onSave({ ...initial, name: name.trim(), kind, description, photo })}
                  className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50" disabled={!name.trim()}>Save</button>
        </div>
        {onDelete && <button onClick={onDelete} className="w-full mt-3 py-2.5 text-red-600 font-semibold text-sm">Remove this location</button>}
      </div>
    </div>
  );
}

function AssignProducts({ location, onClose }: { location: any; onClose: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [chosen, setChosen] = useState<number[]>([]); // ordered
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const [prodRes, placeRes] = await Promise.all([
        fetch('/api/inventory/products?include_pos=1').then(r => r.json()),
        fetch(`/api/inventory/product-locations?count_location_id=${location.id}`).then(r => r.json()),
      ]);
      setProducts(prodRes.products || []);
      setChosen((placeRes.placements || []).sort((a: any, b: any) => a.shelf_sort - b.shelf_sort).map((p: any) => p.odoo_product_id));
      setLoading(false);
    })();
  }, [location.id]);
  function toggle(id: number) { setChosen(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]); }
  async function save() {
    await fetch('/api/inventory/product-locations', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count_location_id: location.id, items: chosen.map((id, i) => ({ odoo_product_id: id, shelf_sort: (i + 1) * 10 })) }),
    });
    onClose();
  }
  const list = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col">
      <AppHeader title={location.name} subtitle="Pick products, in shelf order" />
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
             className="mx-4 my-3 border-2 border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50" />
      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {loading ? <div className="text-center text-gray-400 py-8">Loading…</div> : list.map(p => {
          const idx = chosen.indexOf(p.id);
          return (
            <button key={p.id} onClick={() => toggle(p.id)}
                    className={`w-full flex items-center gap-3 py-3 border-b border-gray-100 text-left ${idx > -1 ? 'opacity-100' : 'opacity-70'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${idx > -1 ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {idx > -1 ? idx + 1 : '+'}
              </div>
              <span className="flex-1 truncate">{p.name}</span>
            </button>
          );
        })}
      </div>
      <div className="p-4 border-t border-gray-100">
        <button onClick={save} className="w-full py-4 rounded-xl bg-green-600 text-white font-bold">Save {chosen.length} product{chosen.length !== 1 ? 's' : ''}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the dashboard tile** in `src/components/inventory/InventoryDashboard.tsx`, alongside the other `can(...)`-gated tiles:

```tsx
    ...(can('inventory.location.manage') ? [{
      id: 'locations',
      label: 'Locations',
      color: 'bg-indigo-50 border-indigo-200', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600',
      sublabel: 'Map, shelves, photos',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
      ),
    }] : []),
```

- [ ] **Step 5: Route the screen** in `src/app/inventory/page.tsx`: import `LocationManager` and add a branch to the screen switch (mirror how `product-settings` / `manage` are mounted):

```tsx
import LocationManager from '@/components/inventory/LocationManager';
// …in the screen switch:
if (screen === 'locations') return <LocationManager onHome={() => setScreen('dashboard')} />;
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: success. Fix any type errors surfaced by the exact prop names in `page.tsx`/`InventoryDashboard.tsx` (they may use `onNavigate`/`onHome` differently — match the sibling screens).

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory/LocationManager.tsx src/components/inventory/InventoryDashboard.tsx src/app/inventory/page.tsx
git commit -m "[ADD] inventory: manager location-setup screen + Locations tile"
```

---

### Task 7: Deploy to staging, e2e test, manual verification

**Files:**
- Create: `tests/inventory-locations.e2e.spec.ts`

**Interfaces:**
- Consumes: the live staging deploy of Tasks 1–6.

- [ ] **Step 1: Deploy the branch to staging**

```bash
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull && npm run build && systemctl restart krawings-portal'
```
Expected: build succeeds, service restarts. (Confirm staging is on `main` first.)

- [ ] **Step 2: Write the e2e test** (mirror the login + flow style of `tests/inventory.e2e.spec.ts`)

```ts
// tests/inventory-locations.e2e.spec.ts
import { test, expect } from '@playwright/test';

const BASE = process.env.SMOKE_ENV === 'live' ? 'https://staff.krawings.de' : 'https://portal.krawings.de';

// Manager creds — reuse the same source as tests/inventory.e2e.spec.ts.
async function loginManager(page: any) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"], input[name="email"]', process.env.MGR_EMAIL || 'biz@krawings.de');
  await page.fill('input[type="password"], input[name="password"]', process.env.MGR_PASSWORD || '');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

test('manager can create an area, a shelf, and assign a product; it persists', async ({ page }) => {
  await loginManager(page);
  await page.goto(`${BASE}/inventory`);
  await page.getByText('Locations', { exact: false }).first().click();

  // Add an area
  await page.getByText('Add an area').click();
  await page.fill('input[placeholder*="Walk-in"]', 'E2E Test Area');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('E2E Test Area')).toBeVisible();

  // Reload — it persisted
  await page.reload();
  await expect(page.getByText('E2E Test Area')).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e test against staging**

Run: `SMOKE_ENV=staging npx playwright test --project=modules inventory-locations`
Expected: PASS. (Set `MGR_EMAIL`/`MGR_PASSWORD` env or wire creds the same way `inventory.e2e.spec.ts` does.)

- [ ] **Step 4: Manual browser verification on staging (required)**

Open `https://portal.krawings.de/inventory` as manager and confirm end-to-end:
- Locations tile appears (manager) and is **absent for staff** (log in as a staff test user).
- Create area "Walk-in Fridge", add a photo, add shelf "Top shelf", reorder with ↑/↓.
- Open "Products" on a shelf, pick 3 products in order, save, reopen — order preserved.
- Delete a shelf and an area — children and placements disappear; other companies' locations are untouched (check with a second company if available).

- [ ] **Step 5: Commit**

```bash
git add tests/inventory-locations.e2e.spec.ts
git commit -m "[ADD] inventory: e2e for location manager (create/persist)"
```

- [ ] **Step 6: Codex verification pass (portal rule)**

Run from the repo root:
```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" --sandbox read-only -o /tmp/codex-verdict-phase1.md "Review the uncommitted/committed Phase 1 location-layer changes. Priority: bugs, company-scope leaks, SQL injection, referential integrity on delete, permission gaps by file:line with severity. Confirm requirements: company-scoped CRUD, manager-only writes, cascade delete of children+placements, tree persists." </dev/null
```
Read `/tmp/codex-verdict-phase1.md`, fix real issues, re-run if substantive.

---

## Self-Review

**1. Spec coverage (Phase 1 scope):**
- Location hierarchy (areas→shelves) → Tasks 1, 3, 4, 6 ✅
- Per-location photo + description + walking order → Tasks 3, 6 ✅
- Products assigned to spots in shelf order (+ multiple spots per product) → Tasks 3, 5, 6 ✅
- Optional Odoo `stock.location` mapping field → Task 3 (`odoo_location_id`) ✅
- Manager-only, company-scoped, hidden from staff → Tasks 2, 4, 5, 6, 7 ✅
- *Deferred to later phases (correctly out of scope):* guided staff counting, missed-location gate, aggregate-at-approval, notes, instructions, conversion+.

**2. Placeholder scan:** No "TBD"/"handle edge cases" — every code step is complete. Two spots require the executor to *confirm an existing pattern* before writing (Task 6 Step 1: how `page.tsx` threads the active company / screen props; Task 4 Step 2: `parseCompanyIds` export location). These are verification steps with exact `grep` commands, not placeholders.

**3. Type consistency:** `CountLocation`/`ProductPlacement` defined in Task 3 are used consistently in Tasks 4–6. Function names match across tasks: `createCountLocation`, `updateCountLocation`, `deleteCountLocation`, `listCountLocations`, `setProductPlacements`, `getPlacements`, `getLocationsForProduct`. Helper names `buildLocationTree`/`reorder`/`nextSortOrder` match Task 1 ↔ Task 6.

**Known reconciliation points at execution time (flagged, not placeholders):**
- Exact prop contract of inventory screens in `page.tsx` (`onNavigate` vs `onHome`) — Task 6 Step 1 grep resolves it.
- Active-company source — route defaults to first `allowed_company_ids`; if the app has a company selector, thread `?company_id=` (Task 6 Step 1).
- Manager e2e credentials — reuse `tests/inventory.e2e.spec.ts`'s mechanism (Task 7 Step 2).
