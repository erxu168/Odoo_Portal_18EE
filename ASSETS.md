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
| `PhotoSourceButtons` | `ui/PhotoSourceButtons.tsx` | Take photo / library / file, with mobile UA detection | 1 |
| `CameraCaptureModal` | `ui/CameraCaptureModal.tsx` | In-browser webcam capture for desktop | 1 |
| `DocumentUploadWidget` | `ui/DocumentUploadWidget.tsx` | Document card: preview, replace, drag | 2 |
| `UploadWidget` | `ui/UploadWidget.tsx` | Simple single-file box | 1 |
| `PdfDocumentCard` / `PdfViewer` / `DocumentViewer` | `ui/` | PDF card, in-app PDF render, image-or-PDF switch | 1 / 10 / 1 |
| `PinnableImage` | `ui/PinnableImage.tsx` | Image with tappable annotation pins | 4 |
| `fetchImageFromUrl` | `lib/fetch-image-url.ts` | SSRF-guarded fetch of a pasted image URL. **Use this, never a bare fetch** | 1 |
| `BatchPhotos` | `components/products/BatchPhotos.tsx` | The paste-and-advance grid: camera, file, drop, paste, or copied URL | 1 |

**FIXED 2026-07-30:** `FilePicker` now wraps `DropZone` itself, so all seven
screens using it accept a dragged-in file with no change at their call site —
recipes (2), locations, HR documents (2), purchase receiving (2).

**REMAINING GAP:** `PhotoSourceButtons` (1 user) and `UploadWidget` (1 user) still
have no drag, and both overlap `FilePicker` — they should be retired into it
rather than fixed separately. `BatchPhotos` additionally accepts a copied image
URL via `fetchImageFromUrl`; if a second screen ever wants that, lift it out.

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
| `CompanyPill` / `CompanySelector` | `ui/` | Restaurant indicator / switcher | 4 / 1 |

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

## Planned — decided, not yet built

### `CollapsibleTree` — BUILT for locations 2026-07-30, not yet extracted
`lib/tree-expansion.ts` holds the state (module-level Map, per-scope) and
`LocationManager` has the chevron / count / expand-all. **Still to do: lift the
node UI into `ui/CollapsibleTree` and use it for the category picker and the
"Where does it live?" sheet**, which have the same nesting problem.

### Original spec — signed off 2026-07-30
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
  `PackagingLevels`, `ProductSettings`, `ProductDetail`, `ProductsDashboard`.
  **Should be a `useLatestRequest` hook — it is hand-rolled four times.**
- **`onChanged(patch)` back to the parent.** A detail overlay tells its list what
  changed. The patch must carry every field the list displays.
- **Unknown means "don't".** A guard that cannot check something must block, never
  assume nothing was found.
