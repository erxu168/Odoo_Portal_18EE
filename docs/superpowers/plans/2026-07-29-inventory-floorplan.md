# Inventory Floorplan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive floor-plan module inside Inventory: PDF upload with automatic label detection → review/publish into `count_locations` spots → staff pan/zoom map with product/place search, counting overlay, QR deep links, print view.

**Architecture:** Client-side pdfjs pipeline (raster + text extraction) feeding a draft→review→publish revision model in SQLite; plain Leaflet 1.9.4 (`CRS.Simple` + `ImageOverlay`) viewer rendering invisible polygon overlays on drawn labels and visible divIcon pins for app-added spots. Spec: `docs/superpowers/specs/2026-07-29-inventory-floorplan-design.md`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, better-sqlite3, pdfjs-dist@4.8.69 (already pinned), leaflet@1.9.4 (new), Playwright test runner.

## Global Constraints

- Single branch `main`; **pathspec-only** commits (`git add -- <files>`, `git commit -- <files>`); push after every task group (shared working tree with concurrent sessions).
- Commit format: `[ADD]|[FIX]|[IMP] inventory: <desc>`.
- Never modify `public/sw.js`, `src/lib/modules.ts`, or desktop-affecting global CSS.
- New schema lives in `src/lib/inventory-floorplan/db.ts` — do NOT grow `inventory-db.ts` (exception: none).
- Reuse shared UI primitives (`AppHeader`, `BottomSheet`, `Chip`, `ConfirmDialog`, `Toast`, `RecordLink`, `PrimaryButton`); design guide `DESIGN_GUIDE.md` (blue header `#2563EB`, green action `#16A34A`, `bg-gray-50`, `--fs-*` type, 44px touch targets).
- All coordinates stored as fractions of the PDF page (0–1), y down (top = 0).
- `npx tsc --noEmit` filtered to touched files must be clean before each commit (`npm run build` may fail from other sessions' WIP — check whose errors they are).
- Unit tests run under the Playwright runner like `tests/location-zpl.unit.spec.ts` does: `npx playwright test tests/<file> --reporter=line`.

---

### Task 1: Schema + migrations (`inventory-floorplan/db.ts`)

**Files:**
- Create: `src/lib/inventory-floorplan/db.ts`
- Test: `tests/floorplan-db.unit.spec.ts`

**Interfaces:**
- Produces: `initFloorplanTables(db: Database): void` (idempotent), `FLOORPLAN_UPLOAD_DIR` (from `process.env.PORTAL_UPLOAD_DIR || path.join(process.cwd(),'data','uploads')`, subdir `floorplans`), row types `FloorRow`, `RevisionRow`, `CandidateRow`, `AnchorRow`.
- Consumes: `getDb()` from `src/lib/db.ts` (read it first; match how `src/lib/shift-handover/db.ts` self-initializes).

- [ ] **Step 1: Failing test** — `tests/floorplan-db.unit.spec.ts`: open an in-memory better-sqlite3 DB, call `initFloorplanTables(db)` twice (idempotency), assert `sqlite_master` contains the 5 tables, insert a floor + draft revision + candidate + anchor round-trip, assert FK-style constraint: anchor insert with unknown `revision_id` throws (use `PRAGMA foreign_keys=ON` only if the repo does; if the repo runs without FK enforcement — check `src/lib/db.ts` — enforce in code instead and assert the code guard).
- [ ] **Step 2: Run** `npx playwright test tests/floorplan-db.unit.spec.ts --reporter=line` → FAIL (module not found).
- [ ] **Step 3: Implement** DDL exactly:

```sql
CREATE TABLE IF NOT EXISTS inventory_floor_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
  original_filename TEXT NOT NULL, pdf_relpath TEXT NOT NULL, sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL, page_count INTEGER NOT NULL,
  uploaded_by INTEGER, uploaded_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS inventory_floors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
  name TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, current_revision_id INTEGER,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_floors_company_name
  ON inventory_floors(company_id, lower(name));
CREATE TABLE IF NOT EXISTS inventory_floor_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL, revision_no INTEGER NOT NULL,
  source_page_number INTEGER NOT NULL DEFAULT 1,
  page_width REAL NOT NULL, page_height REAL NOT NULL, page_rotation INTEGER NOT NULL DEFAULT 0,
  raster_relpath TEXT NOT NULL, raster_mime TEXT NOT NULL,
  raster_width INTEGER NOT NULL, raster_height INTEGER NOT NULL, raster_bytes INTEGER NOT NULL,
  coord_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
  uploaded_by INTEGER, uploaded_at TEXT DEFAULT (datetime('now')),
  published_by INTEGER, published_at TEXT);
CREATE INDEX IF NOT EXISTS idx_floor_revisions_floor ON inventory_floor_revisions(floor_id);
CREATE TABLE IF NOT EXISTS inventory_floor_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, revision_id INTEGER NOT NULL,
  item_index INTEGER NOT NULL, raw_text TEXT NOT NULL, normalized_text TEXT NOT NULL,
  polygon TEXT NOT NULL, rotation_degrees REAL NOT NULL DEFAULT 0,
  proposed_kind TEXT NOT NULL DEFAULT 'other',
  disposition TEXT NOT NULL DEFAULT 'pending', ignored_reason TEXT,
  linked_location_id INTEGER, proposed_type TEXT, proposed_room TEXT);
CREATE INDEX IF NOT EXISTS idx_floor_candidates_rev ON inventory_floor_candidates(revision_id);
CREATE TABLE IF NOT EXISTS inventory_floor_anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, revision_id INTEGER NOT NULL,
  count_location_id INTEGER NOT NULL, source_candidate_id INTEGER,
  polygon TEXT NOT NULL, cx REAL NOT NULL, cy REAL NOT NULL,
  label TEXT NOT NULL, display TEXT NOT NULL DEFAULT 'overlay',
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_floor_anchors_rev ON inventory_floor_anchors(revision_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_floor_anchors_primary
  ON inventory_floor_anchors(revision_id, count_location_id) WHERE is_primary = 1;
```

Also in `initFloorplanTables`: guarded `ALTER TABLE location_kinds ADD COLUMN color TEXT` (check `PRAGMA table_info(location_kinds)` first; table itself is created by `inventory-db.ts` — call its init or guard existence). Code guards (not FK pragma) for revision/anchor integrity if repo runs FKs off.
- [ ] **Step 4: Run test** → PASS.
- [ ] **Step 5: Commit** `[ADD] inventory: floorplan schema + migrations` (pathspec: the two files). Push.

### Task 2: Geometry + token grouping (`geometry.ts`) with real-PDF fixture

**Files:**
- Create: `src/lib/inventory-floorplan/geometry.ts`
- Create: `tests/fixtures/floorplan-ssk96-v13.pdf` (copy of the owner's real v1.3 plan; private repo, owner's own file)
- Test: `tests/floorplan-geometry.unit.spec.ts`

**Interfaces:**
- Produces:
  - `type Pt = { x: number; y: number }` (page fractions, y down)
  - `textItemPolygon(item: {transform:number[];width:number;height:number}, pageW:number, pageH:number): Pt[]` — 4 corners
  - `polygonCentroid(poly: Pt[]): Pt`
  - `rotationDegrees(transform:number[]): number`
  - `groupTokens(items: TextToken[]): TokenGroup[]` where `TextToken = {str:string; poly:Pt[]; angle:number; fontH:number}` and `TokenGroup = {text:string; poly:Pt[]; angle:number}`
  - `classify(text: string): {kind:'spot'|'room'|'other'; type?: string}` — `spot` for `/^(SLF|FLS|CAB|REF|FRZ)\s?\d*$/i` with type map SLF→shelf, FLS→floorspace, CAB→cabinet, REF→fridge, FRZ→freezer; `room` for `/\b(room|area|wash|dispatch|office|treppenhaus)\b/i` or `/^entry\/?\s*exit/i`, len<40; else `other`
  - `normalizeCode(s:string): string` (trim, collapse whitespace, uppercase)

- [ ] **Step 1: Failing test.** Two parts. (a) Pure math: transform `[1,0,0,1,100,700]`, w=40, h=10 on an 800×600 page → corners `(100/800, 1-700/600→clamped…)` — use a 1000×1000 page for round numbers: expect `[{x:.1,y:.3},{x:.14,y:.3},{x:.14,y:.29},{x:.1,y:.29}]` for transform `[1,0,0,1,100,690]`, w=40,h=10 (PDF y-up: y_top = 690+10=700 → yn=1−700/1000=0.30). Rotated case: transform `[0,1,-1,0,500,500]` → 90°. (b) Fixture: load `tests/fixtures/floorplan-ssk96-v13.pdf` via `pdfjs-dist/legacy/build/pdf.mjs` (Node, no worker: `disableWorker`/`useWorkerFetch:false` — check pdfjs 4.x legacy Node usage), page 1 `getTextContent()`, map items → tokens, `groupTokens`, filter `classify(...).kind==='spot'` → assert count is **exactly the pinned number** (run once, print, pin; spike says ~44 incl. 5 legend tokens) and includes codes `FRZ 2`, `REF 1`, `CAB 1`, and a group whose normalized text is `SLF 1`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Core transform math:

```ts
export function textItemPolygon(item:{transform:number[];width:number;height:number}, pageW:number, pageH:number): Pt[] {
  const [a,b,c,d,e,f] = item.transform;
  const corners = [[0,0],[item.width,0],[item.width,item.height],[0,item.height]];
  return corners.map(([x,y]) => ({ x:(a*x+c*y+e)/pageW, y:1-((b*x+d*y+f)/pageH) }));
}
export function rotationDegrees(t:number[]): number {
  return Math.round(Math.atan2(t[1], t[0]) * 180/Math.PI);
}
```

`groupTokens`: sort by angle bucket; two tokens join when same angle (±3°), baseline distance < 0.35×fontH, and gap along the text direction < 0.8×fontH. Union polygons by min/max in the rotated frame (keep 4-point convex hull of the two polys via min/max along direction+normal axes). Fixture count printed then pinned in the test.
- [ ] **Step 4: Run** → PASS (pin the exact fixture count now).
- [ ] **Step 5: Commit** `[ADD] inventory: floorplan geometry + label grouping (real-PDF fixture)`. Push.

### Task 3: Access helper + permission row

**Files:**
- Create: `src/lib/inventory-floorplan/access.ts`
- Modify: `src/lib/permissions.ts` (PERMISSION_ACTIONS array — replicate the exact row shape used by neighboring `inventory.*` rows)
- Test: `tests/floorplan-permissions.unit.spec.ts`

**Interfaces:**
- Produces: `authorizeFloorplan(req, cap: 'view'|'manage', opts?: {companyId?: number}) → Promise<{ok:true; actor; companyIds:number[]} | {ok:false; status:number; error:string}>`.
- Consumes: `src/lib/shift-handover/access.ts` as the pattern (read it first); `roleCan`/`getPermissionOverrides` from `permissions.ts`; `companyScope`, `canAccessCompany`, `resolveScopedCompany` from `src/lib/inventory-access.ts`; `effectiveModuleIds` from `src/lib/modules.ts` (module id `inventory` — file itself unchanged).
- `view` → key `inventory.floorplan.view` (defaultRoles staff+manager+admin); `manage` → existing `inventory.location.manage`.

- [ ] **Step 1: Failing test:** `roleCan('staff','inventory.floorplan.view',{})===true`, `roleCan('staff','inventory.location.manage',{})===false`, and unknown key fails closed.
- [ ] **Step 2: Run** → FAIL (key missing).
- [ ] **Step 3: Implement** permission row + access helper (thin: resolve session/actor exactly like shift-handover's `currentActor`, then module check, then `roleCan`, then company scope).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[ADD] inventory: floorplan permissions + access helper`. Push.

### Task 4: Floors/revisions/review/publish APIs + asset serving

**Files:**
- Create: `src/app/api/inventory/floorplans/route.ts` (GET list per company scope, POST create floor)
- Create: `src/app/api/inventory/floorplans/[id]/route.ts` (PATCH name/code/sort/active, DELETE = archive `active=0`)
- Create: `src/app/api/inventory/floorplans/[id]/revisions/route.ts` (POST multipart: `pdf`, `raster`, `meta` JSON `{pageNumber,pageWidth,pageHeight,rotation,rasterWidth,rasterHeight,mime}`, `candidates` JSON array)
- Create: `src/app/api/inventory/floorplan-revisions/[id]/review/route.ts` (GET candidates, PUT dispositions `[{id, disposition, proposed_type?, proposed_room?, linked_location_id?, polygon?}]` — draft-only)
- Create: `src/app/api/inventory/floorplan-revisions/[id]/publish/route.ts` (POST)
- Create: `src/app/api/inventory/floorplans/assets/[revisionId]/[kind]/route.ts` (GET raster|pdf, authenticated + company-checked, `Content-Type` whitelist `image/webp|image/png|application/pdf`, `X-Content-Type-Options: nosniff`)
- Create: `src/lib/inventory-floorplan/publish.ts`
- Test: `tests/floorplan-publish.unit.spec.ts`

**Interfaces:**
- Produces: `publishRevision(db, revisionId, actorId): {ok:true; created:number; linked:number} | {ok:false; code:'not_draft'|'conflict'|'bad_coords'|'company_mismatch'|'duplicate_codes'; detail?}` in ONE `db.transaction()`:
  1. revision status must be `draft` and `version` must match caller's optimistic version (else `conflict`).
  2. every candidate polygon: 4 finite points in [0,1] (else `bad_coords`).
  3. `linked_location_id` rows must belong to the floor's company (else `company_mismatch`).
  4. `disposition='create'` + `proposed_kind='room'` → insert `count_locations` (parent = company root/NULL matching existing tree conventions — inspect `LocationForm`/`count_locations` usage first, `kind='room'`).
  5. `disposition='create'` + kind spot → insert under its resolved room parent, `kind=proposed_type`.
  6. insert anchors (`display='overlay'`, polygon from candidate, centroid via `polygonCentroid`, label = normalized text).
  7. duplicate `normalizeCode` within the same room among created/linked spots → `duplicate_codes` listing offenders.
  8. set revision `published` (+`published_by/at`), previous published revision of the floor → `superseded`, floor `current_revision_id` updated.
- Upload validation: PDF magic `%PDF-`, raster magic (RIFF/WEBP or PNG), byte caps (PDF ≤ 20MB, raster ≤ 15MB), pixel cap 12MP, sha256 stored; files under `FLOORPLAN_UPLOAD_DIR` with server-generated names `doc_<id>.pdf` / `rev_<id>.webp`.

- [ ] **Step 1: Failing test** for `publishRevision` covering: happy path (2 rooms + 3 spots + anchors, counts returned), not-draft, version conflict, out-of-range polygon, same-room duplicate `SLF 1` blocked, cross-room duplicate allowed.
- [ ] **Step 2: Run** → FAIL. 
- [ ] **Step 3: Implement** `publish.ts` then the routes (each: `authorizeFloorplan` first; JSON errors `{error}` with 4xx like existing inventory routes — mirror `count-locations/route.ts` style).
- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` clean for new files.
- [ ] **Step 5: Commit** `[ADD] inventory: floorplan floors/revisions/review/publish APIs`. Push.

### Task 5: Client PDF pipeline (`pdf-client.ts`) + self-hosted worker

**Files:**
- Create: `src/lib/inventory-floorplan/pdf-client.ts` (browser-only; `'use client'` consumers)
- Create: `public/vendor/pdfjs/pdf.worker.min.mjs` (copied from `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` — commit the file)
- Modify: `src/components/ui/PdfViewer.tsx` (workerSrc: cdnjs URL → `/vendor/pdfjs/pdf.worker.min.mjs`; nothing else)

**Interfaces:**
- Produces:
  - `processPdf(file: File, pageNumber=1): Promise<{raster: Blob; meta: {pageNumber,pageWidth,pageHeight,rotation,rasterWidth,rasterHeight,mime:string}; candidates: CandidateDraft[]; pageCount: number}>`
  - `CandidateDraft = {itemIndex:number; rawText:string; normalizedText:string; polygon:Pt[]; rotationDegrees:number; proposedKind:'spot'|'room'|'other'; proposedType?:string}`
  - Rendering: target long edge 4096px & ≤12MP; on canvas/`toBlob` failure retry at 3072 then 2048; `image/webp` lossless (`canvas.toBlob(cb,'image/webp',1)`), PNG fallback when webp unsupported.
- Consumes: `textItemPolygon`, `groupTokens`, `classify`, `rotationDegrees`, `polygonCentroid` from `geometry.ts` (shared client/server — keep geometry dependency-free).

- [ ] **Step 1:** Implement (no unit test — browser-only; covered by Task 2 fixture for extraction math and by the e2e in Task 10). Dynamic `import('pdfjs-dist')` with `GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs'`.
- [ ] **Step 2:** `npx tsc --noEmit` clean; verify worker file byte-identical to node_modules copy.
- [ ] **Step 3: Commit** `[ADD] inventory: client PDF pipeline + self-hosted pdfjs worker`. Push.

### Task 6: Manifest + spot-sheet APIs (viewer data)

**Files:**
- Create: `src/app/api/inventory/floorplan/route.ts` (GET manifest; `?spot=<locationId>` adds `focus`)
- Create: `src/app/api/inventory/floorplan/spots/[locationId]/route.ts` (GET sheet payload)
- Test: `tests/floorplan-manifest.unit.spec.ts` (extract pure builders into `src/lib/inventory-floorplan/manifest.ts` and test those)

**Interfaces:**
- Produces `manifest.ts`: `buildManifest(db, companyId): {floors:[{id,name,code,sortOrder,revision:{id,rasterUrl:'/api/inventory/floorplans/assets/<revId>/raster',width,height}|null}], anchors: Record<floorId, Anchor[]>, index: {places:[{locationId,label,typeKey,room,floorId,kind:'spot'|'room'|'utility'}], products:[{productId,name,category,locationIds:number[]}]}}`
  - `Anchor = {id, locationId, polygon:Pt[], cx, cy, display:'overlay'|'pin', label, typeKey, room, path}` — path = ancestor names joined ` · ` via `src/lib/location-tree.ts` helpers (read it; reuse, don't re-derive).
  - Product names/categories from Odoo (`src/lib/odoo.ts`) with graceful failure → `products: []` + `productsUnavailable: true`.
- Sheet payload: `{location:{id,name,kind,photo}, path, floorId|null, anchor:{cx,cy}|null, products:[{id,name,category,hasImage}] , productsUnavailable?:true}`.
- Deep link rule: spot lookup resolves company from the location row and re-checks actor access — never trusts query params for company/floor.

- [ ] **Step 1: Failing test** for `buildManifest` on an in-memory DB (floors + anchors + product_locations rows; Odoo client injected as a stub param).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `[ADD] inventory: floorplan manifest + spot APIs`. Push.

### Task 7: Leaflet viewer + search/directory + bottom sheet (staff screen)

**Files:**
- Create: `src/app/inventory/floorplan/page.tsx` (7-line server shell like `shift-handover/page.tsx`: metadata `Floorplan`, `dynamic='force-dynamic'`, renders `<FloorplanApp/>`)
- Create: `src/components/inventory/floorplan/FloorplanApp.tsx` (client root: loads manifest, screen state, floor switcher, edit-mode flag)
- Create: `src/components/inventory/floorplan/FloorplanMap.tsx`
- Create: `src/components/inventory/floorplan/FloorplanSearch.tsx`
- Create: `src/components/inventory/floorplan/FloorplanSpotSheet.tsx`
- Create: `src/components/inventory/floorplan/floorplan.css` (Leaflet CSS import + overrides; imported only by FloorplanMap)
- Modify: `package.json` (+`leaflet@1.9.4`, dev `@types/leaflet`) — `npm install` then commit lockfile too
- Modify: `src/components/inventory/InventoryDashboard.tsx` (add Floorplan card, gated by `inventory.floorplan.view` capability — mirror how existing cards gate)
- Modify: `src/app/inventory/location/[id]/page.tsx` (add "Show on map" `RecordLink`-style button when the spot has a published anchor)

**Interfaces:**
- `FloorplanMap` props: `{revision:{rasterUrl,width,height}, anchors:Anchor[], selectedId:number|null, filterType:string|null, editable:boolean, onTapAnchor(id:number), onTapEmpty(pt:Pt), onMoveAnchor(id:number, pt:Pt), flyTo?: {cx,cy,token:number}}`.
- Leaflet setup (client-only, `next/dynamic` ssr:false at the App level): `L.map(el,{crs:L.CRS.Simple, zoomSnap:0, attributionControl:false, zoomControl:false})`; bounds `[[0,W],[H? …]]` — use pixel bounds `[[0,0],[rasterHeight,rasterWidth]]`, helper `toLatLng(p:Pt)=>[p.y*rasterHeight? INVERTED…]` — define ONE pair `fracToLatLng/latLngToFrac` in FloorplanMap and use it everywhere (Leaflet is [y,x]; y grows down in CRS.Simple with imageOverlay bounds as above — verify with a corner marker during development).
- Anchors: `display==='overlay'` → transparent `L.polygon` (fillOpacity 0, opacity 0) + selected/filtered styles (type color, weight 3, fillOpacity .15); `display==='pin'` → `L.marker` with `L.divIcon` (white pill, icon + code, Tailwind classes in `floorplan.css`).
- Search behavior (from mock v5): empty+focused → places directory (rooms then utility, this floor first); ≥2 chars → products (name match, category shown) + places; result tap → floor switch if needed → `flyToBounds` → select → open sheet.
- Sheet (standard `BottomSheet`): photo, type chip, path, product rows (thumbnail from `/api/inventory/product-images/[id]` when `hasImage`, category caption, 📷 button → existing capture components → PUT product-images — same permission gate as `ProductDetail` uses), actions Spot details (`RecordLink` to `/inventory/location/[id]`) + QR sticker.
- Type registry util `src/lib/inventory-floorplan/types-registry.ts`: built-ins from `location-types.ts` + color map + `location_kinds` rows (icon/color/label) → `{key,label,icon,color}[]` (Produces: `getTypeRegistry(db, companyId)`, client receives it in the manifest — add `types` to manifest in this task).

- [ ] **Step 1:** `npm install leaflet@1.9.4 && npm install -D @types/leaflet`.
- [ ] **Step 2:** Implement map + app + search + sheet against the manifest API. Empty states per spec §6.1.
- [ ] **Step 3:** Manual dev check (`npm run dev` on a free port; if the shared tree's dev server is unusable, use the `krawings-inv` clone rule from memory — but code stays in this tree): map renders demo floor, tap/fly/sheet work in phone viewport.
- [ ] **Step 4:** `npx tsc --noEmit` clean → **Commit** `[ADD] inventory: floorplan staff viewer (Leaflet, search, places, sheet)`. Push.

### Task 8: Manage + Upload/Review/Publish screens + edit mode

**Files:**
- Create: `src/components/inventory/floorplan/FloorplanManage.tsx` (floors list, LIVE badge, upload slot per floor, type list editor writing `location_kinds` via existing `/api/inventory/location-kinds` route — extend that route only if color field missing)
- Create: `src/components/inventory/floorplan/FloorplanUploadReview.tsx` (stepper; runs `processPdf`, POSTs revision, then review UI: mini-map with candidate boxes, grouped list, type/room/link/ignore controls, drag-to-adjust wired to `onMoveAnchor`-style callback that PUTs review dispositions, bulk-ignore, duplicate-conflict rows, publish CTA + success)
- Create: `src/components/inventory/floorplan/FloorplanEditTray.tsx` (icon tray; armed type → tap map → POST anchor+spot create; drag → PUT anchor position; delete anchor → ConfirmDialog, spot survives)
- Create: `src/app/api/inventory/floorplan-anchors/[id]/route.ts` (PUT position/label, DELETE anchor — manage cap; published-revision edits allowed, audit fields)
- Create: `src/app/api/inventory/floorplan-anchors/route.ts` (POST create app-pin anchor + optional new spot: `{floorId, pt, typeKey, code, roomLocationId|null}` → creates `count_locations` row via the same insert path `LocationForm` uses (inspect `count-locations` POST route; call its logic or route), anchor `display='pin'`)
- Modify: `src/app/api/inventory/location-kinds/route.ts` (accept optional `color` — guarded, backward compatible)

- [ ] **Step 1:** Implement Manage + type editor. **Step 2:** Implement UploadReview end-to-end against Task 4 APIs. **Step 3:** Edit mode (tray, drag, add form, delete). Auto-code suggestion: next free number for `PREFIX[type]` within the target room (query existing codes, client-side).
- [ ] **Step 4:** Manual dev pass with the real v1.3 PDF: upload → review shows the pinned fixture count of spot candidates + rooms, legend lands in ignored, publish succeeds, map live.
- [ ] **Step 5:** `npx tsc --noEmit` clean → **Commit** `[ADD] inventory: floorplan manage/review/publish + edit mode`. Push.

### Task 9: Counting overlay + QR/ZPL + print view

**Files:**
- Create: `src/components/inventory/floorplan/FloorplanOverlay.tsx` (full-screen overlay `z-[100]+`, dark banner "Counting <spot> — your count is safe", ✕ close; renders FloorplanApp in read-only focused mode via props `{focusLocationId, onClose}`)
- Modify: `src/components/inventory/CountingSession.tsx` + `src/components/inventory/GuidedCountingFlow.tsx` (one "🗺 Floorplan" button each at the current-spot header — overlay mount, NO navigation; smallest possible diff, read both files first)
- Create: `src/components/inventory/floorplan/FloorplanPrintView.tsx` + route `src/app/inventory/floorplan/print/page.tsx` (`?floor=<id>`; raster + heading company · floor · revision · date; `@media print` CSS; "Download original PDF" link to assets route)
- Modify: `src/lib/zpl.ts` (`generateLocationZPL` gains optional `qrData?: string` — when present use it as QR payload with dynamic module sizing by payload length; printed text unchanged; default behavior byte-identical when omitted)
- Modify: `src/components/inventory/LocationLabels.tsx` (pass `qrData` = `${FLOORPLAN_BASE_URL}/inventory/floorplan?spot=${id}`; base URL from `process.env.NEXT_PUBLIC_PORTAL_BASE_URL` fallback `https://staff.krawings.de` — add to `.env.example` if present)
- Modify: `tests/location-zpl.unit.spec.ts` (add cases: default unchanged; qrData variant sizes modules down for long URLs)
- Deep-link handling in `FloorplanApp`: on mount read `?spot=`, fetch sheet API, focus or show "Not placed on a floor plan" empty state with canonical-page link.

- [ ] **Step 1:** ZPL failing test first (default byte-identical + qrData case) → implement → PASS.
- [ ] **Step 2:** Overlay + counting buttons; manual check: enter counts, open overlay, close, counts intact (state stays mounted).
- [ ] **Step 3:** Print view + deep link.
- [ ] **Step 4:** `npx tsc --noEmit` clean → **Commit** `[ADD] inventory: counting overlay, QR deep links, print view`. Push.

### Task 10: Offline cache + Playwright e2e + staging

**Files:**
- Create: `src/lib/inventory-floorplan/offline.ts` (IndexedDB `kw-floorplan`: keys `${userId}:${companyId}:${floorId}:${revisionId}` → {manifestSlice, rasterBlob, cachedAt}; API: `cacheFloor`, `getCachedFloor`, `clearUserCache(userId)`; replace-only-when-complete; hook `clearUserCache` into the existing logout path — find it, smallest diff)
- Modify: `FloorplanApp.tsx` (offline banner with cached-revision age; load-from-cache on fetch failure)
- Create: `tests/floorplan.e2e.spec.ts` (staff happy path vs seeded DB: dashboard card visible per role, map loads, search flies, sheet opens, deep link resolves, manager-only Manage hidden for staff)
- Test: run the full new-test set + `tests/inventory-locations.e2e.spec.ts` + `tests/inventory-permissions.e2e.spec.ts` for regression.

- [ ] **Step 1:** offline.ts + banner. **Step 2:** e2e spec written + green locally. **Step 3:** regression suites green (skip other sessions' unrelated failures — note them).
- [ ] **Step 4: Commit** `[ADD] inventory: floorplan offline cache + e2e`. Push.
- [ ] **Step 5: Staging pass (house rules):** push auto-deploys (~2 min); then real-browser phone-viewport pass per spec §9: upload real v1.3 PDF → review → publish → search Paprika/room/utility → counting button → QR deep link → print view → desktop unaffected. Screenshot evidence. **Codex post-build review** of the full diff (`codex review` per CLAUDE.md) — fix real findings, re-verify, report.

## Self-review (done at write time)

- Spec coverage: §3 flows → Tasks 7–9; §4 → Task 1; §5.1 → Tasks 2+5; §5.3 → Tasks 4+6; §5.4 → Task 4; §5.5 → Task 3; §5.6 → Task 7; §5.7 → Task 10; §9 → Tasks 2,4,6,9,10. QR base-URL config named; sw.js untouched.
- Type consistency: `Pt`, `Anchor`, `CandidateDraft`, `publishRevision` result codes, `fracToLatLng` naming pinned above; implementers must use these exact names.
- Known deliberate deviations from bite-size dogma: UI tasks (7,8) carry manual dev checks instead of unit tests — behavior contract is the signed-off mock v5; e2e covers them in Task 10.
