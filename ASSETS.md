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
drag-and-drop** — those FOUR are Ethan's binding rule, and drag is *in addition
to*, never instead of. **Paste is a fifth, opt-in way**, for desktop-first
fields where one file at a time is the point (`FilePicker`'s `paste` prop,
`BatchPhotos`); it is not achievable on a kitchen tablet and is not required.

**The sources must be OFFERED EXPLICITLY.** A bare `<input accept="image/*">`
is NOT conformant — on the kitchen Android tablets the OS sheet shows the
gallery only, no camera (found live 2026-08-03, photo-required counts).

**There is a repo skill for this — invoke it for ANY photo-input work:**
`.claude/skills/photo-inputs`.

| Asset | Path | What | users |
|---|---|---|---|
| `DropZone` | `ui/DropZone.tsx` | Wraps any target to accept a dragged-in file (handles enter/leave counting so nested elements don't flicker) | 3 |
| `FilePicker` | `ui/FilePicker.tsx` | The general picker + **drag** + optional paste. **Photo-only `accept` (every token an image) auto-opens `PhotoSourceSheet`** — so a photo field gets Camera·Photos·Files with no call-site change; document/mixed fields keep the OS chooser. `facing` picks the lens; `cameraOnly` forces the camera where other sources have their own buttons | 8 |
| `PhotoSourceSheet` | `ui/PhotoSourceSheet.tsx` | **THE standard chooser**: Camera · Photos · Files in a bottom sheet. Use wherever a screen keeps its own trigger button. `facing` picks the lens | 4 |
| `PhotoSourceButtons` | `ui/PhotoSourceButtons.tsx` | The three source buttons + drag; `facing` picks front/rear. **"Files" is deliberately unfiltered** — with `accept="image/*"` it opened the same gallery-only sheet as Photos, so it was not a third way in; non-images are rejected with a message | 2 |
| `CameraCaptureModal` | `ui/CameraCaptureModal.tsx` | In-browser webcam capture for desktop | 1 |
| `DocumentUploadWidget` | `ui/DocumentUploadWidget.tsx` | Document card: preview, replace, drag **in both states** | 2 |
| `UploadWidget` | `ui/UploadWidget.tsx` | Simple file box, **+ drag** | 1 |
| `PdfDocumentCard` / `PdfViewer` / `DocumentViewer` | `ui/` | PDF card, in-app PDF render, image-or-PDF switch | 1 / 10 / 1 |
| `PinnableImage` | `ui/PinnableImage.tsx` | Image with tappable annotation pins, and (edit mode) the author's drawn marks. Tap-a-pin shows its note in a popover anchored AT the pin | 4 |
| `DrawingLayer` | `ui/DrawingLayer.tsx` | Vector overlay over any image: arrow / circle / box / freehand pen, 4 colours, **5 line weights**, select → move → stretch → erase. Coordinates are fractions 0..1 so a mark lands identically at any size; the photo bytes are never touched. Shapes + helpers live in `lib/guide-drawings.ts` (client-safe, no server imports) | 1 (via `PinnableImage`) |
| `fetchImageFromUrl` | `lib/fetch-image-url.ts` | SSRF-guarded fetch of a pasted image URL. **Use this, never a bare fetch** | 1 |
| `BatchPhotos` | `components/products/BatchPhotos.tsx` | The paste-and-advance grid: camera, file, drop, paste, or copied URL | 1 |

### Conformance — audited 2026-07-30, 24 photo fields, ALL PASS
**CORRECTION 2026-08-03:** that audit accepted bare `accept="image/*"` inputs
as conformant. On the kitchen Android tablets they open the GALLERY ONLY — the
camera never appears (staff hit this on photo-required counts).

**Portal-wide sweep, 2026-08-03.** Every photo-first field now presents its
sources explicitly:
- `FilePicker` opens `PhotoSourceSheet` automatically when `accept` is
  images-only — that standardised **7 call sites at once** (purchase receive
  check + issue, recipes ActiveRecording + EditStep, HR StepDocuments,
  LocationForm, DocumentCapture's image slots). Document fields (PDF) keep the
  plain OS chooser: a PDF has no camera.
- `PhotoCaptureStrip`'s [+] (counting, waste, quick count, handover, unknown
  barcode) opens the chooser.
- Converted from raw inputs: `GoodsReceived`, `ProductDetail` (both triggers),
  `FloorplanSpotSheet` (product photo AND spot photo), `AddMeterReading`.
- `BatchPhotos`: its "Choose a file" button reused the image-filtered input
  (same gallery-only sheet) — it now has a genuinely unfiltered Files input
  beside the camera one.
- Task PROOF photos (`tasks/staff`, `tasks/manager/dept/[id]`) went through a
  detached `accept="image/*"` input built in `photoUpload.ts` — the exact
  pattern this sweep exists to kill. Both pages now open `PhotoSourceSheet`
  and call the existing `uploadTaskPhotoFile`.
- `DocumentCapture`'s "Take Photo" opened the same generic chooser as the
  "Choose Files" button next to it; it now forces the camera (`cameraOnly`),
  which is legitimate precisely because the other sources have their own
  buttons.
- `GuidedTutorialEditor` (3 label-wrapped inputs: add, replace, replace-on-error)
  converted to the chooser too.
- Genuinely document-first and correctly left alone: `FloorplanManage` (PDF
  plan), `BomDetail` (PDF), `PdfDocumentCard`, `PaymentsDashboard` (XML/CSV),
  `KuendigungDocWidget`, and `DocumentCapture`'s mixed image+PDF slots (the
  "Add" tile and the per-document grid).
- `capture` now appears in exactly three sanctioned places, each ONE OF several
  explicit buttons: `PhotoSourceButtons`' camera, `BatchPhotos`' camera, and
  `FilePicker`'s `cameraOnly` (used only by DocumentCapture's "Take Photo").
  `UploadWidget` also carries `capture` and is imported by `hr/RoteKarteInfo`
  only — review it when that screen is next touched.

Every photo field in the portal offers camera + gallery + file upload + drag.
Two were worse than missing drag and are the reason to re-audit rather than trust
a rule:

- **Task proof photo** (`app/tasks/_components/photoUpload.ts`) forced
  `capture = 'environment'` — camera ONLY. Staff who had already photographed the
  finished job could not attach it, and no desktop user could either. This is the
  exact defect the rule was first stated about, still live in another module.
- **`purchase/page.tsx.bak`** also forced capture. Dead file, never compiled —
  deleted.

(Superseded by the 2026-08-03 sweep below: `capture` now appears in three
sanctioned places, each ONE OF several explicit buttons.)

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

## On-screen keyboards  ← binding on every input

Android covers the bottom of the screen with its keyboard, including the field
being typed into. Two standing rules:

1. **A number-only field never raises the OS keypad.** Use `ui/NumberField`, or
   `ui/useNumpadField` when the number is not an input element. Exempt, and
   deliberately so: phone numbers and OTP (need `+` and SMS autofill), date/time
   (OS pickers), and the masked sign-in PIN pads (they mask and auto-submit —
   the shared pad shows the value and waits for Confirm).
2. **A text field stays visible above the keyboard.** `ui/KeyboardViewportManager`
   handles this portal-wide with no per-screen work — EXCEPT that it works by
   scrolling, and **a `position: fixed` overlay with no scroll container cannot
   be scrolled at all**. Such an overlay must consume `--keyboard-inset-bottom`
   itself, or wrap its content in `overflow-y-auto`. Opt a control out with
   `data-keyboard-scroll="off"`.

| Asset | Path | What | users |
|---|---|---|---|
| `KeyboardViewportManager` | `ui/KeyboardViewportManager.tsx` | Mounted once in the root layout. Detects the keyboard by GEOMETRY plus a focused text control (focus alone misfires on split-screen and Capacitor `adjustResize`; geometry alone mistakes pinch-zoom for a keyboard). Publishes `--keyboard-inset-bottom`, `--visual-viewport-height`, `html[data-keyboard-open]` | 1 |
| `scrollNeededFor` | `lib/keyboard-visibility.ts` | The geometry: how far to scroll a focused control into the space it ACTUALLY has. **"Visible" is not "above the keyboard"** — a sheet's action button sits in a footer below its scrolling body, so a field can clear the keyboard and still hide behind "Post to the log". The region is the viewport INTERSECTED with the scroll container's box. Found on a real device, not in review | 1 |

**There is now exactly ONE keypad.** Five had grown independently and each had
drifted: `ui/Numpad` (Purchase, WoDetail), `inventory/NumpadModal` (counting +
waste, 8 consumers), hand-rolled grids inside `recipes/RecipeDetail` and
`recipes/BatchSize`, and the dead `ui/PurchaseNumpad`. All now route through
`NumpadCore`; `Numpad.tsx` and `PurchaseNumpad.tsx` are deleted.

⚠️ **A grep for `type="number"` or `inputMode` will NOT find a hand-rolled pad** —
that is how the two recipe keypads stayed invisible through an earlier audit.
Look for a digit array being `.map`ped into buttons.

Spec: `docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md`

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
| `ChromeIcons` | `ui/ChromeIcons.tsx` | THE thin-line icon set for interface machinery — Home, Back, Close, ChevronDown/Right, Check, **Crosshair** ("show me exactly where this is"). Emoji carry meaning on action cards; chrome uses these. Never a second icon style | 12 |

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
| `NumberField` | `ui/NumberField.tsx` | **The number input to use everywhere.** On a touch device it suppresses Android's keypad (`inputMode="none"`) and opens the shared in-app pad; on desktop it is an ordinary typed input. Pad edits stay in the pad's buffer — the parent hears them once, via `onCommit` | 0 |
| `useNumpadField` | `ui/useNumpadField.ts` | Same pad for screens whose number is NOT an input — a tappable quantity on a counting row, a price in a card. Returns `triggerProps` to spread | 0 |
| `NumpadProvider` / `useNumpad` | `ui/NumpadProvider.tsx` | The ONE pad host, mounted in the root layout. Owns Android Back (history entry, so Back closes the pad instead of leaving the screen), hardware-key capture (a Bluetooth Enter must not submit the form behind it), barcode-scanner burst rejection, async commit (spinner, stays open on failure), focus restore, portal to `<body>` at z-[130] so it never paints behind the sheet that opened it | 1 |
| `NumpadCore` | `ui/NumpadCore.tsx` | The keypad body — no sheet, no backdrop, controlled buffer. What the shells share. `layout` keeps counting's grid and Purchase's grid both available; the KEYS behave identically either way | 1 |
| `ContainerLevelPicker` / `ContainerLevelGlyph` | `ui/ContainerLevelPicker.tsx` | Mark the open container's level by eye — drawings of the REAL containers (white 10 L bucket, 20 L tub, blue 30 L drum, bottle), quarter steps, 44px zones; glyph = tiny read-only variant for review lines. Feeds the existing loose quantity via `looseFromFraction`/`quarterFromLoose` in `crate-units` | 2 |
| `PhoneInput` | `ui/PhoneInput.tsx` | Country code + validation | 1 |
| `RichTextEditor` | `ui/RichTextEditor.tsx` | Formatted-note editor | 2 |
| `Chip` | `ui/Chip.tsx` | Status badge — colour AND icon carry meaning | 1 |
| `KpiChip` / `KpiRow` | `ui/KpiChip.tsx` | Stat chip; red only for real problems. Give it `onClick` and it becomes a real button — a stat you can see should be a stat you can act on | 11 |

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
| `odoo.ts` | `lib/odoo.ts` | The ONLY Odoo client. Never call Odoo from the browser. **TRAP: `searchRead({limit: 0})` silently means 200** — for "every matching row" use `searchReadAll` (id-cursor pagination, throws rather than truncates; starved the prep forecast for months and under-counted the Reports module until 2026-08-01). Zero `limit: 0` callsites remain — keep it that way |
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
| `product-code.ts` | `lib/product-code.ts` | `houseCode(id)` = `KRW-<odoo id>` — the code a product carries when it has no supplier barcode (824 of WAJ's had none). Unique by construction, stable across renames, scanner-typeable. **NEVER overwrite an existing barcode** — a supplier EAN is the real one. Pairs with `location-code.ts`: a shelf label prints BOTH, so `parseHouseCode` and `parseLocationCode` must never accept each other's codes (pinned by a test) |
| `usage-totals.ts` | `lib/usage-totals.ts` | `sessionTotals(sessionId)` — what ONE count says a product's quantity was, and when it says NOTHING. The core of the usage report. **THE RULE: a partial sum is a lie, not a number.** A product is dropped from `qty` (and reported as a stated gap) when it was answered "couldn't find it" ANYWHERE, or when a spot it lives at was SKIPPED — a skip is "I didn't look here", and summing only the shelves that were counted used to make usage read HIGH by whatever sat on the skipped one. Out-of-stock is deliberately NOT a gap: "I looked, there is none" is a real zero. Skips are read from the count's FROZEN lines, never live placements. Use this, never a copy — the mirrored version in the route was already drifting |
| `zpl.ts` / `zpl-net.ts` | `lib/` | Zebra label ZPL; network send is server-only. `generateProductStorageZPL` is the 90×60 SHELF label (name huge and full-width, product barcode, location path, shelf QR) — its two size floors are a real trade, pinned by tests: push the name higher and the barcode silently disappears |
| `ZebraPrinterBar` | `ui/ZebraPrinterBar.tsx` | **THE printer bar** — status, Connect/Change, paired-device picker, and the one-tap `device.languages "zpl"` fix for a factory-fresh printer that prints ZPL as text. That fix used to exist in LabelPrint ONLY, so LocationLabels and PackageLabel stranded anyone who hit it. Takes the hook's return value, so the screen keeps ONE connection and prints from it |
| `numeric-input.ts` | `lib/numeric-input.ts` | **What typing a number MEANS** — one buffer truth table for every pad. Modes `integer`/`decimal`/`digit-string`. **THE RULE: empty is not zero.** Blank means "nobody counted this"; a typed `0` means "there is none here, set stock to zero" — they go to different places in Odoo. `ui/Numpad` used to collapse them with `parseFloat(v) \|\| 0`. Also: German decimal comma in, dot stored; `digit-string` keeps leading zeros (postcode `01067`, barcode) and is never parsed; range rules apply at zero too (the old tolerance check's `>0` escape let `0` past a `min: 1` field) |
| `modal-stack.ts` | `lib/modal-stack.ts` | `useEscapeStack` — who owns Escape. Only the TOP-most overlay reacts, so the numpad opened from inside a sheet can't close the sheet and discard its edits. Shared by `BottomSheet` and `NumpadProvider` |
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
