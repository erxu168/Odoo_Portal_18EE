# Shared assets — READ THIS BEFORE BUILDING ANYTHING

Ethan, 2026-07-30: *"always remember to save assets we create such as the photo
upload feature in a common place so that we can always draw on it instead of
recreating it or that i have to remind you about it."*

**The rule:** check this file before writing a component or helper. If you create
something a second screen would want, put it in `src/components/ui/` (UI) or
`src/lib/` (logic) and **add it here in the same commit**. Not later.

The `users` column is how many files import it. A low number next to a general
purpose is a smell — it usually means other screens hand-rolled the same thing.

---

## Files / photos / camera  ← the binding rules live here

Every photo or file input must accept **camera + camera roll + file picker +
drag-and-drop + paste**. Drag is *in addition to*, never instead of.

| Asset | Path | What | users |
|---|---|---|---|
| `DropZone` | `ui/DropZone.tsx` | Wraps any target to accept a dragged-in file (handles enter/leave counting so nested elements don't flicker) | 3 |
| `FilePicker` | `ui/FilePicker.tsx` | Camera + gallery + file input + **drag-and-drop** (built in, all 3 variants) + optional paste (`paste` prop) | 7 |
| `PhotoSourceButtons` | `ui/PhotoSourceButtons.tsx` | Take photo / library / file, mobile UA detection, **+ drag** | 1 |
| `CameraCaptureModal` | `ui/CameraCaptureModal.tsx` | In-browser webcam capture for desktop | 1 |
| `DocumentUploadWidget` | `ui/DocumentUploadWidget.tsx` | Document card: preview, replace, drag **in both states** | 2 |
| `UploadWidget` | `ui/UploadWidget.tsx` | Simple file box, **+ drag** | 1 |
| `PdfDocumentCard` / `PdfViewer` / `DocumentViewer` | `ui/` | PDF card, in-app PDF render, image-or-PDF switch | 1 / 10 / 1 |
| `PinnableImage` | `ui/PinnableImage.tsx` | Image with tappable annotation pins | 4 |
| `fetchImageFromUrl` | `lib/fetch-image-url.ts` | SSRF-guarded fetch of a pasted image URL. **Use this, never a bare fetch** | 1 |
| `BatchPhotos` | `components/products/BatchPhotos.tsx` | The paste-and-advance grid: camera, file, drop, paste, or copied URL | 1 |

### Conformance — audited 2026-07-30, 24 photo fields, ALL PASS

Every photo field in the portal offers camera + gallery + file upload + drag.
Two were worse than missing drag and are the reason to re-audit rather than trust
a rule:

- **Task proof photo** (`app/tasks/_components/photoUpload.ts`) forced
  `capture = 'environment'` — camera ONLY. Staff who had already photographed the
  finished job could not attach it, and no desktop user could either. This is the
  exact defect the rule was first stated about, still live in another module.
- **`purchase/page.tsx.bak`** also forced capture. Dead file, never compiled —
  deleted.

`capture` now appears in exactly one place: `PhotoSourceButtons`' "Take photo"
button, which is correct — it is one of three explicit buttons, so the other two
still give gallery and files.

Fixed to reach conformance: `FilePicker` (7 screens at once, via `DropZone`),
`PhotoSourceButtons`, `UploadWidget`, `DocumentUploadWidget` (its replace state
returned early and skipped the DropZone entirely), `GoodsReceived`,
`AddMeterReading`, `FloorplanSpotSheet`, `GuidedTutorialEditor`,
`tasks/manager/templates/[id]`.

**Note:** `app/tasks/_components/SetupGuideEditor.tsx` is DEAD — referenced only
in a comment, rendered nowhere. Left alone rather than fixed or deleted.

`BatchPhotos` additionally accepts a copied image URL via `fetchImageFromUrl`; if
a second screen wants that, lift it out.

---

## Feedback after a change  ← the other binding rule

A delete/archive/add/edit must change the screen **immediately**. If it needs a
refresh, it is not finished.

| Asset | Path | What | users |
|---|---|---|---|
| `Toast` | `ui/Toast.tsx` | Auto-dismiss success/error banner | 10 |
| `ConfirmDialog` | `ui/ConfirmDialog.tsx` | Bottom-slide confirm before anything irreversible | 32 |
| `SwipeToDelete` | `ui/SwipeToDelete.tsx` | iOS-style swipe-to-reveal delete | 1 |
| `ManagedListSheet` | `ui/ManagedListSheet.tsx` | Add/edit/delete/reorder CRUD sheet for lookup lists | 2 |

| `announceChange` / `onRecordChange` | `lib/record-events.ts` | **"This record changed."** A detail screen announces a delete/update; every mounted list hears it and patches in place. Module-level so it crosses Next's router cache | 2 |
| `useRecordList` / `useRecordChanges` | `lib/useRecordChanges.ts` | Keep a list in step with changes made elsewhere, without re-fetching (a re-fetch re-mounts and loses the scroll) | 1 |

**Use `announceChange` after EVERY mutation**, right after the server confirms.
Pass `alsoAffected` for a cascade — deleting a room removes its shelves, and a
list told only about the room keeps rendering orphans.

**KNOWN GAP:** most modules print inline error text instead of using `Toast`.

---

## Layout & navigation

| Asset | Path | What | users |
|---|---|---|---|
| `AppHeader` | `ui/AppHeader.tsx` | The page header. Every screen uses it | 150 |
| `ActionCard` / `ActionGrid` | `ui/ActionCard.tsx` | Module launcher tile + grid | 14 |
| `RecordLink` | `ui/RecordLink.tsx` | Universal record drill-down | 13 |
| `recordHref` / `RECORD_EDIT_CAP` | `lib/record-links.ts` | Canonical URL + edit capability per record type | — |
| `BottomSheet` | `ui/BottomSheet.tsx` | Modal sheet: backdrop, title, scroll body, footer, Escape stack | 4 |
| `AppTabBar` / `AppTopBar` / `AppDrawer` / `MainWrapper` / `appChrome` | `ui/` | Global chrome | 1 each |
| `TopBarContext` | `ui/TopBarContext.tsx` | Hide the global top bar for one screen | 10 |
| `SortableTileGrid` | `ui/SortableTileGrid.tsx` | Drag-reorderable tiles, order persisted | 1 |
| `DragRow` | `ui/DragRow.tsx` | dnd-kit sortable row with a drag handle | 2 |

**KNOWN GAP:** **39 files hand-roll a `rounded-t` overlay** instead of using
`BottomSheet`, and `shifts/ui.tsx` has a rival `Sheet`.

---

## Form controls

| Asset | Path | What | users |
|---|---|---|---|
| `PrimaryButton` | `ui/PrimaryButton.tsx` | The one green button per screen; busy + disabled | 2 |
| `Select` | `ui/Select.tsx` | Touch-sized select with chevron + placeholder | 1 |
| `Field` | `ui/Field.tsx` | Label + control + hint/error row | 1 |
| `OptionGrid` | `ui/OptionGrid.tsx` | Big-target replacement for radios — glove-friendly | 2 |
| `Numpad` | `ui/Numpad.tsx` | Large touch numeric keypad | 2 |
| `PhoneInput` | `ui/PhoneInput.tsx` | Country code + validation | 1 |
| `RichTextEditor` | `ui/RichTextEditor.tsx` | Formatted-note editor | 2 |
| `Chip` | `ui/Chip.tsx` | Status badge — colour AND icon carry meaning | 1 |
| `KpiChip` / `KpiRow` | `ui/KpiChip.tsx` | Stat chip; red only for real problems | 11 |

**KNOWN GAPS:** **176 files hand-roll `bg-green-600` buttons** instead of
`PrimaryButton`. **58 hand-roll a raw `<select>`.** There are **four rival status
badges** (`Chip`, `shifts/ui` Badge, `inventory/ui` StatusBadge, `manufacturing/ui`
Badge, `reports/shared` StatusPill) and **two rival date filters**
(`DateFilter`, `StandardFilter`) — pick one of each and delete the rest.
`PurchaseNumpad.tsx` is a dead fork of `Numpad`. `LocationDropdown.tsx` has zero
importers.

---

## Pickers & scanning

| Asset | Path | What | users |
|---|---|---|---|
| `LocationPickerSheet` | `ui/LocationPickerSheet.tsx` | Tree-aware location chooser | 4 |
| `CategoryPicker` | `components/inventory/CategoryPicker.tsx` | Category path button + picker + inline create | — |
| `CreateProductSheet` | `components/products/CreateProductSheet.tsx` | The ONE product quick-create sheet (`purchase` / `inventory` / `catalog`) | 3 |
| `useAddProduct` | `components/products/useAddProduct.ts` | Add-a-product state + save + navigate | 2 |
| `BarcodeScanner` | `ui/BarcodeScanner.tsx` | Camera scan + hardware scanner fallback | 2 |
| `SignInSheet` / `StationGate` | `ui/` | PIN sign-in, shared-tablet gate | 1 each |
| `CompanyPill` / `CompanySelector` | `ui/` | `CompanySelector` (top bar) = the ONE visible switcher; `CompanyPill` = invisible per-screen change subscriber (`onSwitched` → reload) | 4 / 1 |

---

## Logic (`src/lib/`)

| Asset | Path | What |
|---|---|---|
| `odoo.ts` | `lib/odoo.ts` | The ONLY Odoo client. Never call Odoo from the browser |
| `product-create.ts` | `lib/product-create.ts` | The one shape for creating a product (sets `is_storable`, keeps cost ≠ selling price) |
| `product-tax.ts` | `lib/product-tax.ts` | Per-restaurant tax on a shared product. Unlink/link, never a full SET |
| `product-scope.ts` | `lib/product-scope.ts` | What "the catalog" means; shared field lists |
| `purchase-price.ts` | `lib/purchase-price.ts` | What a product costs to BUY (supplier → cost → none) |
| `relevance-cache.ts` | `lib/relevance-cache.ts` | The catalog's per-company relevance cache + invalidation |
| `inventory-access.ts` | `lib/inventory-access.ts` | `isUnrestrictedAdmin`, `canAccessCompany`, `companyScope` — company scoping, fail-closed |
| `permissions.ts` | `lib/permissions.ts` | Capability registry + `roleCan` |
| `auth.ts` | `lib/auth.ts` | `requireAuth`, `hasRole` |
| `company-context.tsx` | `lib/company-context.tsx` | `useCompany()` — the active restaurant |
| `odoo-html.ts` | `lib/odoo-html.ts` | `plainFromOdooHtml` — Odoo notes are HTML |
| `location-tree.ts` | `lib/location-tree.ts` | `locationPathLabel` and tree walking |
| `crate-units.ts` | `lib/crate-units.ts` | Pack/loose wording — "1 crate = 24 bottles" |
| `zpl.ts` / `zpl-net.ts` | `lib/` | Zebra label ZPL; network send is server-only |
| `design-system.ts` / `ux-rules.ts` | `lib/` | Tokens; plain-language mappings |

---

## Waste Tracker — COMPLETE 2026-07-31, live on staging

The third term of the consumption equation. `waste_events` in `lib/inventory-db.ts`,
shaped deliberately like `stock_receipts` (same columns, same units, same photo)
because it is the same kind of event pointing the other way.

| Helper | What |
|---|---|
| `recordWaste` | one entry; refuses zero/negative |
| `voidWaste` | Undo — SOFT delete, so a correction leaves a trail |
| `sumWasteByProduct` | the term the report subtracts. Same signature and same period boundaries as `sumReceiptsByProduct` |
| `recentlyWastedProducts` | the "recently binned here" grid — what makes it one tap |
| `listWaste` | recent entries, for the day list and Undo |

**RAW STOCK ONLY.** Not binned cooked food — that stock left when it was cooked,
and recording both subtracts it twice. Separate feature.

**BUILT 2026-07-31** (mock signed off same day):

| Piece | Where |
|---|---|
| API | `GET/POST/PATCH/DELETE /api/inventory/waste` — record at the numpad, annotate (reason/photo) AFTER, undo = soft delete. Idempotent on a client key so a wifi retry can't bin twice. Attribution via `shift-attribution`; department via the actor's HR record |
| Photo rule | `GET/PUT /api/inventory/waste/settings` + `WasteSettingsSheet` — per-department "photo required", OFF by default, enforced server-side at POST (fail-open when the department is unknown — the entry outranks the rule) |
| Screen | `/waste` (`components/inventory/WasteTracker.tsx`) — recently-binned grid, search, the SAME `NumpadModal`/`CrateCountSheet` counting uses (new `saveLabel` prop says "Bin it"), `OptionGrid` reasons, `PhotoCaptureStrip`, "Binned today" list with Undo |
| Tile | `StationHome` — "Something binned" 🗑️ on the shared department tablet |
| Report | `/api/inventory/usage` + `ConsumptionReport`: used = start + received **− binned** − end, same window as the purchases term |

Permissions: `inventory.waste.record` (all roles), `inventory.waste.settings` (managers).

## Planned — decided, not yet built

### Collapsible trees — SHIPPED 2026-07-30

| Asset | Path | What | users |
|---|---|---|---|
| `CollapsibleNode` | `ui/CollapsibleNode.tsx` | One collapsible branch: chevron, "N inside" summary, open/closed, force-open. The CALLER renders its own row | 1 |
| `tree-expansion` | `lib/tree-expansion.ts` | The open/closed store: module-level Map, per scope, subscribable. Session-only by design | 2 |

**The split is deliberate.** `CollapsibleNode` owns the MECHANICS; the caller owns
the ROW, because the rows are genuinely different work — the Locations manager row
carries a drag handle and an edit pencil, the "Where does it live?" row is a tick
box. What was being duplicated was the mechanics, not the markup.

`LocationManager` shares the STORE and its subscription but renders its own
chevron, because its row puts the chevron after the photo while `CollapsibleNode`
puts it before the row. A layout difference, not a second implementation —
"Expand all" and the session-only reset behave identically in both.

**"Where does it live?"** additionally force-opens any branch containing a TICKED
spot. A chosen shelf hidden inside a collapsed room is a place staff will be sent
to count that the manager cannot see.

**The category picker does NOT need this** — checked 2026-07-30. It delegates to
`ui/TreePickerSheet`, which is a DRILL-DOWN: it shows only the children of the
current level, with a breadcrumb back up. That solves the same problem a different
way, and converting it to an expandable tree would be a regression, not a fix.
`LocationPickerSheet` shares that component and is likewise fine.

So the collapsing work is complete: the two screens that rendered a whole tree at
once (`LocationManager`, `SpotSheet`) now collapse; the two that drill already
did not have the problem.

### The spec — signed off 2026-07-30
The location tree renders every level at once, so a deep map (room → cabinet →
shelf) buries the rooms. Same problem in the category picker
(`All / RAW MATERIALS / Spices`), so this is ONE shared asset used by the
Locations manager, the "Where does it live?" sheet, and the category picker.

Ethan's decisions:
- **Collapsed to the top level by default.** Rooms visible, contents closed.
- **"Expand all" — yes**, as a small text action. Building the map wants
  everything open; using it wants everything closed.
- **Expansion is remembered for the CURRENT MOMENT ONLY.** Navigating away and
  back keeps it; a browser reload starts collapsed again.
  → **Implementation: a module-level in-memory `Map`, NOT localStorage and NOT
  sessionStorage.** sessionStorage survives a reload, which is explicitly not
  wanted. A plain JS store outside React survives client-side navigation (so it
  satisfies [[feedback_no_scroll_jump]]) and dies with the page, which is exactly
  the ask. Keyed per screen — how you leave the manager is not how a picker
  sheet should open.
- A collapsed row still **summarises** what it hides ("Fridge Room · 4 inside").
- **Search auto-expands to its matches**, or a collapsed tree looks like a broken
  search.
- A branch containing the **current selection** opens on load, so a chosen shelf
  is never hidden behind a closed room.
- Whole row is the tap target, 44px, chevron rotates.

## Patterns that are not files, but are still rules

- **Newest-request token.** Any effect that loads per-company or per-record data
  keeps `const token = ++ref.current` and drops stale responses. Copied in
  `PackagingLevels`, `ProductSettings`, `ProductDetail`, `ProductsDashboard`, and
  `app/kiosk/page.tsx` (`sessionRef`).
  **Should be a `useLatestRequest` hook — it is hand-rolled five times.**
  The kiosk copy is the one to read first: there the token is not just a
  staleness fix but a *privacy* one — it is bumped by `clearPerson()` so a reply
  that lands after the previous staff member walked away cannot paint their name,
  rules gate or confirmation in front of the next person. Guards belong on the
  `catch` arm and the `finally` arm too, not only on success.
- **`onChanged(patch)` back to the parent.** A detail overlay tells its list what
  changed. The patch must carry every field the list displays.
- **Unknown means "don't".** A guard that cannot check something must block, never
  assume nothing was found.

## Brand assets

| Asset | Path | What | users |
|---|---|---|---|
| What a Jerk mark | `public/waj-logo.svg` | The wordmark in brand yellow on a transparent ground, viewBox trimmed to the artwork. **Served without login** via an exact-path carve-out in `src/middleware.ts` — everything else in `public/` gets redirected to `/login`, which is why a new public-screen asset appears to 404. | 1 |
| — its master | `docs/brand/waj-logo-master.svg` | Untouched Illustrator export, red `#BE1E2D` background square included. Derive from this, never retype it. | — |

**Brand colours:** red `#BE1E2D`, yellow `#EFA949`. Exported as `WAJ_RED` / `WAJ_YELLOW`
from `components/kiosk/KioskWelcome.tsx`.

⚠️ **The mark's letter interiors are transparent** — the counters are cut out and show
whatever is behind. It is drawn to sit on the brand red. On white or a photo it will read
wrong; put a red field behind it.

⚠️ **Never rebuild this file by hand from a paste.** It is one `<path>` whose
reverse-wound sub-shapes cut the letter counters; splitting it into separate `<path>`
elements fills every counter solid and the wordmark turns to blobs. That shipped to a
screenshot once. Copy the file, don't transcribe it.
