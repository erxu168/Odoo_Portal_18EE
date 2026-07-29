# Inventory Floorplan — Design Spec

**Date:** 2026-07-29 · **Owner sign-offs:** design (chat), clickable mock v5 (artifact, "lets go")
**Mock:** https://claude.ai/code/artifact/34e100a2-bb36-4b2c-a4b9-d92643110766
**Codex cross-check:** planning verdict incorporated (see §11).

## 1. Summary

A new **Floorplan** area inside the Inventory module. The owner uploads his Adobe Illustrator
floor-plan PDFs exactly as exported (labels drawn in: `SLF 1`, `FLS 2`, `REF 1`, `CAB 1`,
`FRZ 2`, room names). The app rasterizes the PDF for display **and auto-detects the text
labels with coordinates** (validated on the real SSK96 v1.3 PDF: 38 storage labels + rooms +
utility points extracted via the PDF text layer). Staff open a pinch-zoomable map on their
phones, search **any product (full Odoo catalog, with category) or any place** (spot, room,
utility point), and the map flies to it. Managers review detected labels into real inventory
spots, edit the map with an icon tray, print QR stickers, and upload new plan versions
without losing placements.

**The floor plan is a spatial view of existing inventory records, not a second hierarchy.**
Pins/anchors reference `count_locations` rows; products come from `product_locations` +
Odoo. The canonical record page for a spot remains `/inventory/location/[id]`.

## 2. Locked owner decisions

1. Custom build inside the portal (no off-the-shelf tool).
2. Lives **inside Inventory** — "Floorplan" entry on the Inventory dashboard; staff use it
   while checking inventory.
3. Map items ARE inventory spots (`count_locations`); no duplicate list.
4. Edit rights: admin + manager. Staff view/search only. Per-person adjustable via the
   existing permission system.
5. Multi-company, multi-floor from day 1; content starts with Ssam SSK96 −1F.
6. Upload the PDF **as-is** — no clean re-export. The drawn labels stay the visuals; the
   app adds an interactive overlay (tap → sheet, search → fly + highlight, filter chips dim).
7. Auto-detection from the PDF text layer proposes spots/rooms; owner reviews, assigns
   rooms (numbering restarts per room), skips legend/title text, then publishes. Owner
   creates the spots via this review — "provide the means".
8. Location types = **editable, pre-filled list** with icon + color (seeded from the
   built-ins; owner adds e.g. Cabinet, Floor Space, Utility, First Aid).
9. Search covers **products (entire Odoo catalog, showing category) + spots + rooms +
   utility points**. Empty search field shows a browsable **places directory**.
10. Per-product **photo capture** from the spot sheet (camera + photo roll + file — never
    capture-forced), stored as the product's existing single primary image.
11. V1 extras: "Floorplan" button inside counting sessions (opens as overlay, counts
    preserved), QR stickers per spot (deep link), printable plan view, plan versioning
    with placement carry-over.
12. App-added spots (nothing drawn underneath) render as **visible white icon pins**
    (constant screen size); detected drawn labels get invisible tap overlays that only
    show when selected/filtered.

## 3. User flows

### 3.1 Staff — find something (primary flow)
Inventory dashboard → **Floorplan** card → map of the active company's floor (floor
switcher bottom-right if >1 floor; remembers last floor per device).
- **Search field** (top): tapping it empty opens the **places directory** (rooms 🚪 +
  utility points 🔧 of this floor, tap → fly). Typing ≥2 chars searches products
  (name, with category shown) and places; tapping a result flies + highlights + opens
  the bottom sheet. A result on another floor switches floor first.
- **Filter chips** (All default · one per location type, colored dot = legend): matching
  anchors get colored outline rings.
- **Tap an anchor** → bottom sheet: spot name/code + type chip + full path (floor · room),
  spot photo, products stored here (thumbnail, name, category, 📷 capture/replace button
  per row), actions: **Spot details** (RecordLink to `/inventory/location/[id]`),
  **QR sticker**.
- Pan/pinch/double-tap zoom; zoom-aware: overlays keep ≥44px touch targets.

### 3.2 Manager — first upload & review
Floorplan screen → **Manage** (manager+) → floors list per company → **Upload PDF** on a
floor slot → client-side processing (§5.1) → **Review screen**:
- Stepper: Upload ✓ → Review → Publish. Candidates listed grouped by proposed room;
  mini-map shows dashed candidate boxes; tapping a row highlights its box.
- Per candidate: confirm/change type (auto from prefix: SLF→Shelf, FLS→Floor space,
  CAB→Cabinet, REF→Fridge, FRZ→Freezer; rooms/utility from text match), assign room
  parent (existing or staged new room), link to an existing spot OR create new, drag the
  box if it sits off, or ignore (legend/title auto-proposed as ignored, bulk-ignore
  available).
- Same-room duplicate codes block publish (rename/ignore/secondary-anchor to resolve).
- **Publish** = one server transaction (§5.4). Success → map is live for staff.

### 3.3 Manager — ongoing editing (icon tray)
Manage → **Edit map** → edit mode: anchors visible (dashed), drag to move; bottom **ADD
tray** with the type list (icon + label, custom types included): arm a type → tap the plan
→ pin placed with auto-suggested code (next free number of that type in the tapped room),
small form to adjust code/room; tap-empty-unarmed opens the same form with type choice.
Done → changes saved, staff see updates. Deleting an anchor never deletes the spot
(archival rules, §5.4).

### 3.4 Counting integration
In a counting session, the current spot row shows **🗺 Floorplan** → opens the map as a
**full-screen overlay** (counting state stays mounted, offline queue untouched) focused on
that spot; ✕ returns.

### 3.5 QR + print
- Spot sheet / Manage → QR sticker: printed text stays the human code; QR payload is
  `<configured prod base URL>/inventory/floorplan?spot=<id>`. Integrates with the existing
  ZPL location-label pipeline (`zpl.ts`, `LocationLabels.tsx`) via a new `qrData` argument
  + dynamic QR module sizing. Batch print per room.
- Deep link: server resolves spot → company/floor/revision/anchor (never trusts
  company/floor from the URL). No published anchor → "Not placed on a floor plan" +
  link to the canonical spot page.
- Print view: current floor raster + company/floor heading + revision/date; original PDF
  stays downloadable.

### 3.6 New plan version
Upload v1.4 on an existing floor → new revision (old one kept for rollback). Re-detection
suggests matches to existing anchors by normalized label + room path — **never
auto-publishes**; owner confirms in review. Publishing supersedes the previous revision.

## 4. Data model (new file `src/lib/inventory-floorplan/db.ts`; do NOT grow inventory-db.ts)

Per Codex verdict, five tables (all `company_id`-scoped, audit fields throughout):
- **`inventory_floor_documents`** — original uploaded PDFs: filename, relpath (under
  `data/uploads/floorplans/`), sha256, byte_size, page_count, uploaded_by/at.
- **`inventory_floors`** — stable floor identity: name, code (e.g. `-1F`), sort_order,
  active, `current_revision_id`; unique (company, lower(name)).
- **`inventory_floor_revisions`** — immutable per upload/page: floor_id, document_id,
  revision_no, source_page_number, page w/h/rotation, raster path + mime + pixel w/h,
  status `draft|published|superseded|failed`, optimistic version.
- **`inventory_floor_candidates`** — extraction evidence per revision: raw/normalized
  text, normalized 4-point polygon JSON, rotation, proposed kind `spot|room|other`,
  disposition `pending|linked|create|ignored` (+ reason, linked location).
- **`inventory_floor_anchors`** — what staff see: revision_id, `count_location_id`
  (restrictive FK — location delete becomes subtree archive `active=0`), source candidate,
  normalized polygon + centroid, label snapshot, `display` (`overlay` for detected drawn
  labels | `pin` for app-added), `is_primary` (one primary per location per revision;
  extra polygons stay tappable).

Coordinates are fractions of the page (0–1), resolution-independent. No product data is
duplicated into these tables.

**Types:** revive `location_kinds` (exists, dormant) as the custom-type store; add `color`
via guarded ALTER. Effective type registry = built-in `LOCATION_TYPES` (location-types.ts,
each gains a color in the floorplan palette) + company rows from `location_kinds`.
`count_locations.kind` keeps storing the key. Custom kinds are cosmetic (icon/color/label)
— no behavior coupling.

## 5. Architecture

### 5.1 PDF pipeline — client-side at upload (no server binaries)
Browser (manager's device, typically desktop/tablet) with the already-pinned
`pdfjs-dist@4.8.69`:
1. Load PDF ArrayBuffer; render page → canvas capped at **4096px long edge / ~12MP**
   (auto step-down on allocation/`toBlob` failure) → lossless WebP (PNG fallback).
2. `getTextContent()` → per-item transform/width/height → normalized 4-point polygons;
   token grouping by baseline + angle + font height + gap (NOT array adjacency — pdfjs
   splits differ from pdftotext); propose candidates (storage prefixes, room names,
   everything else → `other`/ignored).
3. Multipart upload: original PDF + raster + candidates JSON. Server validates magic
   bytes, sizes, coordinate ranges, company, permission → stores draft revision.
**Self-host `pdf.worker.min.mjs`** under `public/vendor/pdfjs/` (also migrate
`PdfViewer.tsx` off its CDN worker URL).
Multi-page PDFs: page picker at upload; each selected page → one floor revision.
Duplicate upload (same sha256): warn, allow deliberate new revision. Raster-legibility
warning in review if label text is unreadable at typical phone zoom.

### 5.2 Map viewer — plain Leaflet 1.9.4 (BSD), client-only component
`L.CRS.Simple` + `L.imageOverlay` (the standard "image as map" mode). No react-leaflet
(v5 needs React 19; portal is React 18). `next/dynamic` ssr:false; init/destroy in one
effect. `zoomSnap:0`; `touch-action:none` on the map surface only (page viewport has
`userScalable:false`, so the map owns its gestures). One helper converts normalized
[x,y] ↔ Leaflet [y,x]. Anchors: invisible `L.polygon` hit areas (following label rotation)
+ a visible highlight polygon for selection/search; app-added `pin` anchors render as
divIcon badges (icon + code, constant screen size). `flyToBounds` for search/deep links.
Dependency adds: `leaflet@1.9.4`, `@types/leaflet` — nothing else.

### 5.3 APIs (under `/api/inventory/...`, all through the access helper)
- `floorplan` (viewer manifest: floors, current revision, anchors, search index),
  `floorplan/spots/[locationId]` (sheet payload + deep-link resolution)
- `floorplans` CRUD, `floorplans/[id]/revisions` (upload), 
  `floorplan-revisions/[id]/review` (candidate dispositions, draft-only),
  `floorplan-revisions/[id]/publish`, `floorplans/assets/[revisionId]/[kind]`
  (authenticated raster/PDF serving — no public paths)
Search index ships with the manifest (spot names, full ancestor paths, product
placements with product name + category from Odoo) and is searched client-side. Odoo
down → spot search still works from SQLite; product search uses the last cached index;
sheet distinguishes "products unavailable" from "none stored here".

### 5.4 Publish transaction (server, single transaction)
Recheck draft + optimistic version (concurrent publisher → 409) → validate coordinates
finite ∈ [0,1] → validate linked locations' company → create staged rooms → create staged
spots under their rooms → create anchors → reject same-room duplicate normalized codes →
mark published, supersede previous → audit log entry.

### 5.5 Permissions & scoping
New action: **`inventory.floorplan.view`** (staff+). Manage/upload/review/publish/edit/QR
reuse **`inventory.location.manage`** (manager+). Access helper modeled on
`shift-handover/access.ts`: effective module access (`modules.ts` — unchanged, Floorplan is
inside `inventory`), permission overrides, `companyScope`/`canAccessCompany`, shared-tablet
actor attribution. Company checked on both floor and linked location.

### 5.6 Product photos & categories
Sheet product rows: thumbnail from `product_images` (existing), category from Odoo
`categ_id` (cached in the search index), 📷 button → existing capture components
(`PhotoSourceButtons`/`CameraCaptureModal` pattern: camera + roll + file) → existing
`product-images/[product_id]` PUT (unchanged limits; SVG rejected). Gate the write with
the same permission that screen already uses; read requires only floorplan view.

### 5.7 Offline (PWA)
After a floor is opened online, cache manifest + search index + raster Blob in IndexedDB
(keyed user/company/floor/revision; cleared on logout/access loss; replaced only after a
complete new manifest+image arrive). Reopening/switching to cached floors works during
connection loss; upload/review/publish/edit are online-only; show cached-revision age
banner. Do NOT make `public/sw.js` cache-first (shared-tablet data-leak risk). Cold
launch from QR while fully offline: out of scope, accepted.

## 6. UI screens (design-guide compliant: AppHeader blue, CompanyPill, bg-gray-50, flat cards, `--fs-*` type, 44px targets, green = action)

1. **Map** (staff): AppHeader("Inventory / Floorplan") + search + directory + chips +
   Leaflet viewport + floor switcher + bottom sheet (standard `BottomSheet`). Empty states:
   no plan for company ("ask a manager to upload"), plan exists but unpublished, unmapped
   QR spot, products unavailable.
2. **Manage** (manager+): floors per company (LIVE badge, revision, spot count; Upload
   slot per floor; reorder), location-type list (icon + color + count, add/edit custom),
   who-can-do-what note.
3. **Upload & Review** (manager+): stepper, file card, mini-map with candidate boxes,
   grouped candidate list (type/room/link/ignore controls, drag-to-adjust, bulk ignore,
   duplicate-code conflict rows), publish CTA + success state.
4. **Edit mode** (manager+, over the map): banner + Done, dashed anchors, drag to move,
   ADD tray (type chips incl. custom), add form, delete-anchor (spot stays).
5. **Counting overlay**: dark banner + focused map, ✕ back, count state preserved.
6. **QR & print**: spot/room picker, sticker preview, batch print (ZPL + browser
   fallback), print view page, plan versions list (current/rollback).

Component/lib layout mirrors shift-handover: `src/app/inventory/floorplan/page.tsx`,
`src/components/inventory/floorplan/*` (FloorplanApp/Map/Search/SpotSheet/UploadReview/
ManageFloors/EditTray/PrintView), `src/lib/inventory-floorplan/{db,access,geometry,
pdf-client,offline}.ts`. Reuse `AppHeader`, `BottomSheet`, `Chip`, `ConfirmDialog`,
`Toast`, `RecordLink`, `PrimaryButton`, capture components — no hand-rolled primitives.

## 7. Edge cases (from Codex verdict + extraction spike)

Rotated labels (4-point polygons, never axis-aligned boxes) · token grouping variance ·
legend/title exclusion is a persisted review decision, never auto-create all text ·
per-room duplicate codes (cross-room OK — identity is the location id; UI always shows
full path) · room labels with arrows sit away from the room (drag in review) · huge pages
(step-down rendering) · multi-page PDFs · re-upload matching suggestions only ·
archived spots keep historical anchors, hidden from search, review warns · concurrent
publish 409 · asset security (magic bytes, size/pixel caps, server-generated paths,
authenticated serving) · Odoo unavailable fallbacks · iOS Safari canvas limits
(pre-iOS-18 4096px cap is the binding constraint for upload devices).

## 8. Non-goals (v1)

No live "you are here"/positioning, no routing/AR/3D, no wall-perfect room outlines
(highlight = drawn label geometry), no Illustrator SVG pipeline, no DZI tiling (upgrade
path documented if plans exceed ~40MP), no portal-side renaming of drawn plan text
(plan text changes happen in Illustrator + re-upload), no offline cold-start from QR,
no sw.js changes.

## 9. Verification

- **Unit:** geometry (polygon/centroid/rotation, coord conversions), token grouping
  against a fixture built from the real SSK96 v1.3 PDF (spike found 44 storage tokens,
  5 of them legend; the exact expected count is pinned when the fixture is built),
  db publish transaction (dup codes, staged rooms, 409), ZPL QR sizing.
- **E2E (Playwright):** permissions matrix (staff vs manager vs no-module), upload→
  review→publish→map happy path, deep link resolution, counting overlay preserves state.
- **Manual staging (before "done", per house rule):** real browser phone-viewport pass —
  upload the real v1.3 PDF, review, publish, search Paprika + a room + a utility point,
  counting button, QR deep link, print view; verify desktop unaffected and Inventory
  regression (locations screen, counting, labels print).
- Codex post-build review of the full diff (house rule) before staging deploy.

## 10. Rollout

Phase order (small commits, pathspec-only, push per phase — shared-tree rules):
1. Schema + access + permission + tests. 2. PDF client pipeline + geometry (+ fixture
tests). 3. Upload/review/publish APIs + screens. 4. Leaflet viewer + search/directory +
sheet (+ photos/categories). 5. Counting overlay + cross-links (location page "Show on
map"). 6. QR/ZPL + deep links. 7. Print view. 8. Offline cache. 9. Staging deploy +
manual pass + Codex review.
Data: owner uploads SSK96 −1F and creates spots via review (owner task, with support).

## 11. Codex cross-check record

Planning call (gpt-5.6-sol, high): confirmed architecture; contributed revision/versioning
model, 4-point polygons, self-hosted pdf worker, ZPL QR integration detail, counting
overlay (not navigation), IndexedDB-not-sw offline stance, archive-not-delete, same-room
duplicate blocking, candidate/anchor separation. Post-build review still required.
