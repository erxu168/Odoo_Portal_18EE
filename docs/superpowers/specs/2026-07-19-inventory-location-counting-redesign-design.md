# 2026-07-19 — Inventory: location-based counting & practical-unit redesign

## Problem

The inventory counting flow has three related pain points, surfaced while testing on staging:

1. **UoM headache.** Ingredients are tracked in a base unit — mostly **kg** for fresh produce/meat — but staff count physical things: bunches, crates, trays, heads. The current count screen (`CrateCountSheet`) makes the converted **kg** the visual hero and needs a per-product "unit + average" configured. Two concrete pains: **many items have no natural count** (beef, oils, half-used bags), and the **per-product setup is a slog**.
2. **Location is disconnected from list setup.** The guided-inventory feature (storage locations + a location-by-location walk: `count_locations`, `product_locations`, `session_location_status`, `guided-route.ts`) exists, but assigning products to locations lives on a **separate** screen from creating a list. So building a list (products only) doesn't set up the walk — "shouldn't location be part of the setup when I create a list?"
3. **Confusing product picker + company leak.** Adding products is a long all-checkbox list where you can't see what's already selected; and the Department picker showed **every company's** departments regardless of the blue-ribbon company selector.

## What counts are actually for (decided)

Counts are for **reordering, spotting waste, and routine discipline** — **not** keeping Odoo's kg precise. **"Portal is enough":** the count lives in the portal; the Odoo stock write is secondary/optional. This is the key unlock — it lets staff count in whatever is practical, with the kg conversion demoted to a faint reference.

## Decisions (locked in brainstorming)

- **Count in the item's own practical unit** (bunch, crate, tray, bag, head, piece, bottle) — a plain word per product, smart-defaulted from name/category. No forced kg entry.
- **≈ kg kept only as a faint footnote**, computed from an **optional** per-product average; when no average is set, show only the count (no kg). The average being optional is the big setup-burden reduction.
- **The list is organised BY LOCATION.** Setting up a list = defining/reusing storage "spots" (Walk-in fridge, Dry shelf, Freezer, Bar…) and dropping the items counted at each into that spot. This unifies list-setup with the guided walk — no separate placement step.
- **An item can appear in multiple locations** (e.g. onions in the walk-in *and* dry store).
- **A "No specific spot" catch-all** so nothing must be filed to a shelf.
- **Adding items uses the "chosen-pinned" picker** (approved layout B): browse/search, chosen items pinned in view, a clear `+ Add` / `✓ Added` per row — replacing the confusing all-checkbox list. Category filter pills stay (Odoo categories) for browsing.
- **Count screen hierarchy flipped** (approved): product name large, the **count (in its unit) is the hero**, ≈ kg is a small grey footnote; a location breadcrumb (`Walk-in fridge · 1 of 3`) anchors the walk.
- **Company selector = source of truth** for every company-scoped picker/list (already fixed for `/api/inventory/departments` on 2026-07-19; general rule — see `feedback_company_scoped_pickers`).
- **Products show the internal name; search matches three fields.** *Verified against real staging data 2026-07-19 — the earlier "Internal Reference = staff name" assumption was wrong.* A product carries three distinct things:
  - **Internal name** = Odoo **Product Name** (`name`), e.g. `Salz Eimer 10Kg` — the name staff know. **This is displayed everywhere staff/list see a product.** It is always populated, so no fallback is needed.
  - **Supplier ordering name** = the **Vendor Product Name** (`product.supplierinfo.product_name`), e.g. `Salz fein 10kg Eimer o. Jod Saldoro` — a text name the supplier uses. Populated on only a minority of products today.
  - **Order code** = the field Odoo labels **"Internal Reference"** (`default_code`), e.g. `0710`, plus the **Vendor Product Code** (`product.supplierinfo.product_code`, e.g. `124500016`). Despite the label, in this data `default_code` holds the **supplier's order/article number** (codes cluster by vendor — MK City Frucht, Panasia, Getränke Preuss, … — and match the vendor code where both exist). Present on 218 of 897 products.
  - **Rule:** **display is always the internal name**; the add-item **search matches internal name OR supplier name OR order code** (any of the three the manager happens to know). Supplier name / order code are search keys and confirmation subtitles only — never the displayed name.
- **Hard-to-count items use photo + rough count.** Items a manager marks "needs photo" (sliced cheese, deli meats, opened/partial blocks, loose trays) require staff to attach a photo and give only a **rough** number; the **manager reads the exact quantity from the photo at review**. Reuses the existing `product_flags.requires_photo` flag + photo capture (`PhotoCaptureStrip` / `count_photos`); the one new build is **manager adjust-on-approve** (review is approve/reject only today). Detailed in section F.

## Design

### A. List builder — location-organised (manager)

Replaces the flat product picker in `src/components/inventory/TemplateForm.tsx`. The list becomes a set of **spots**, each holding items:

- Builder shows the list grouped by **location card**: header = **location photo thumbnail** + name + `📷 Set/Change photo` (section G) + item count; then item rows (name + category + remove ✕) → `+ Add item to Walk-in fridge`.
- `+ Add a location` reuses the existing count-locations feature (create inline **or** pick an existing spot) and lets the manager attach a **photo** for staff guidance. A default **"No specific spot"** group always exists.
- Tapping `+ Add item…` opens the **chosen-pinned picker**: search + category pills; chosen items pinned as chips; each row `+ Add` / `✓ Added`. Adding places the product into *that* spot.
  - Each row's **primary label is the internal name** (Product Name). Search matches internal name OR supplier name OR order code; when the row matched on the supplier name or the order code, a faint subtitle shows what matched (e.g. `Salz Eimer 10Kg · supplier: Salz fein 10kg Eimer o. Jod Saldoro` or `· order code: 0710`) so the manager is sure it's the right item. Search box hint: "search by name or order code."
- The **same product may be added to multiple spots**.
- Saving writes BOTH the template's `product_ids` (the union of all placed items) AND the `product_locations` placements (product → count_location). This is the unification — one save sets up *what* + *where*.
- Company scope: locations, products, and the list all belong to the **active company** (blue-ribbon), bounded by permissions.

### B. Count screen — per-spot list, practical units (staff, guided by location)

Redesign of `src/components/inventory/CountingSession.tsx` / `CrateCountSheet.tsx` (and the count entry path). **Staff count from a list, not one item at a time** (chosen over paged single-item screens on 2026-07-19 — a scannable checklist is faster).

- The **spots list** (walk home) shows each spot with its **location photo** thumbnail (see section G) and a live status line — `2 counted · 1 out · 1 left`. Tapping a spot opens a **single scrollable list of that spot's items** — no per-item paging. Each row:
  - **internal name** (Product Name) prominent on top; small category beneath.
  - a **stacked stepper cell on the right: the LOUD unit label sits ABOVE the `− value +`** (`BUNCHES`, `CRATES`) so staff see what to count right where they act. (Refined 2026-07-19 from a side label.)
  - **tapping the number opens the numpad** (reuse the existing `NumpadModal`) for fast large entry; `−`/`+` handle small nudges.
  - the value shows **`—` until touched** (see section H) — never a default `0`. **≈ kg** (when an average exists and the item is counted) sits as a tiny grey line, de-emphasised.
  - **Pack + loose items (see C)** show **two compact stepper cells side-by-side** — `CRATES` (`24× bottles`) and `BOTTLES` (loose/opened crate) — with a running `= N bottles total`. The compact two-cell layout keeps a two-unit item to roughly one item's height.
  - an **`Out of stock`** control per row (see section H).
- A **`Done — <spot>`** button commits the spot and returns to the walk. It does **not** silently zero untouched rows; if any remain **not counted**, the button says so (`Done — 2 still not counted`) so the gap is explicit, not hidden.
- **Photo rows (hard-to-count):** a `requires_photo` item sits in the same list with a **📷 Add photo (required)** chip and its stepper labelled **"rough count"**; **`Done` is blocked until every photo row is either photographed or marked out of stock** — see section F.
- Location order + the spot-level completion gates come from the existing `guided-route.ts` + `session_location_status`.

### C. Unit model — how staff count each item

Stored in `product_flags` (extending today's `pack_label` + `units_per_crate`). Two modes:

- **Simple (one unit).** `pack_label` = the **count unit word**, shown **big** so staff know what to count (bunches, trays, heads, sacks…). Smart-defaulted from name/category. `units_per_crate` here is an **optional average** (base units / kg) that powers only the faint ≈ kg suffix — no average → no suffix, counting still works. One stepper.
- **Pack + loose (packaged, breakable).** For items that arrive in a pack you can break open — a **beer crate 24×0.33 L**, an egg tray of 30, a case of cans. Staff count **full packs *and* loose singles**. This **reuses the crate/loose model already in the schema** (`count_entries` / `quick_counts` carry `crate_qty`, `loose_qty`, `units_per_crate`; `CrateCountSheet` shipped it 2026-07-03) — now surfaced as **two steppers on the list row**. Fields: `pack_label` = pack word (crate), `units_per_crate` = **pack size** (24), single-unit word from the Odoo base UoM or a small `loose_label` (smart-defaulted, e.g. "bottles"). Recorded total = `packs × size + loose`.
- A per-product **"also count loose singles"** toggle selects pack+loose; smart-defaulted on for drinks / case categories. Set/edited in Product Settings; smart defaults mean most products need no manual touch.
- Amorphous items (beef, oil, half-bags): simple mode with a container word ("tray", "jug", "bag"); no average.

### D. Company-selector source of truth

Every company-scoped endpoint reads the active company from `?company_id=` or the `kw_company_id` cookie, filters to it (bounded by `canAccessCompany`), and falls back to the full allowed scope only when nothing is selected. Applied to departments already; the builder's location/product fetches follow the same rule.

### E. Product naming — three fields, verified against real data (decided)

A product carries three distinct things; this feature uses each deliberately. *This maps to a live inspection of the `krawings` staging DB on 2026-07-19, not to Odoo's field labels (the "Internal Reference" label is misleading — see below).*

- **Display everywhere staff/list see a product = the internal name = Odoo Product Name (`name`)** — the name staff know (e.g. `Salz Eimer 10Kg`). It is always populated, so **no fallback is required**. One helper (`displayName(product)`) returns `name` and is reused by the builder, picker rows, chips, guided walk, and count screen — so the rule lives in exactly one place (and can be adjusted centrally if ever needed).
- **Supplier name & order code are search keys, never display values.** The add-item picker's search domain matches, OR'd together:
  - `name` — internal name;
  - `default_code` — the **order code** (Odoo labels this "Internal Reference", but the data shows it holds the supplier's article/order number, e.g. `0710`);
  - `seller_ids.product_name` — the **supplier ordering name** (e.g. `Salz fein 10kg Eimer o. Jod Saldoro`);
  - `seller_ids.product_code` — the **vendor product code** (e.g. `124500016`).
  A product found by supplier name or order code still displays under its internal name, with a faint subtitle showing what matched (`· supplier: …` or `· order code: …`) for confirmation.
- **API impact (small):** `GET /api/inventory/products` currently reads only `name` and searches only `['name','ilike',q]` ([products/route.ts](src/app/api/inventory/products/route.ts) lines ~205, ~267). Change: keep `name` as the display value; add `default_code` and the seller name/code to the read fields (for the subtitle); broaden the search domain to the four-way OR across `name` / `default_code` / `seller_ids.product_name` / `seller_ids.product_code`. Stored data is unaffected — templates/counts key on **product id**, so only what we *search and render as a subtitle* changes; the displayed name is `name`, exactly as today.
- **Data completeness (accepted, not blocking):** order code is set on 218 of 897 products; supplier name on fewer still. Search-by-name always works; search-by-code / by-supplier-name works only where those are filled. This is a bonus lookup path, not a requirement — nothing breaks when they're blank. A later data-cleanup pass to populate them is out of scope here.

### F. Hard-to-count items — photo + rough count (staff), manager confirms (decided)

Some items can't be cleanly counted — sliced cheese, deli meats, opened/partial blocks, loose trays. For these, the **photo carries the truth** and staff give only a rough number; the **manager reads the exact quantity from the photo**. This reuses infrastructure that already exists (`product_flags.requires_photo`, `PhotoCaptureStrip`, `count_photos`, `PhotoLightbox`); only the manager-side adjust is new.

- **Flag (already built):** `product_flags.requires_photo` — a manager marks a product "needs photo," per-product. Already toggleable in `ProductSettings.tsx` and read by the count screens (`QuickCount`, `CountingSession`, sessions API). **Delta:** also expose it inline in the list builder as a small 📷 toggle per item, so it can be set in context while building. A smart hint may suggest it for deli/cheese categories, but the manager always has the final say.
- **In-list photo row (delta to section B):** a `requires_photo` item appears as a row in the spot list with a required **📷 Add photo** chip (reuses `PhotoCaptureStrip` → `count_photos`) and its stepper labelled **"rough count"**; the spot's **`Done`** stays blocked until each photo row has a photo. No ≈ kg on these rows. Hint copy: *"Manager confirms the exact number from your photo."*
- **Manager review (the one genuinely new build):** `ReviewSubmissions.tsx` is **approve/reject only** today — it writes the staff number as-is. For photo entries, add: the photo shown **large** (tap to zoom via existing `PhotoLightbox`) next to an **editable quantity**; the manager's confirmed number becomes the recorded/written-back value (approve-with-adjust). Staff's rough number is the pre-filled starting value.
- **Data:** no schema change — `requires_photo` + `count_photos` already exist; the count entry already stores the number. The only new server surface is letting the `approve` path accept a manager-adjusted quantity for a photo entry.

### G. Location photo + info (ⓘ) — visual guidance per spot (decided)

Staff should recognise a spot by sight and know exactly where it is. Each location carries a **manager-set photo and a short description** ("where it is / notes"), surfaced to staff via an **ⓘ info button**.

- **Both fields already exist — zero schema change:** `count_locations.photo` (TEXT) **and** `count_locations.description` (TEXT) are already in the schema; `LocationManager.tsx` already manages locations. **Delta:** let the manager set/replace the **photo + description** — inline from the **list builder's location header** ("ⓘ Photo & info") and in `LocationManager`. Reuse the existing photo-capture path (`PhotoCaptureStrip`).
- **Staff side — thumbnail + ⓘ:** the **spots list** shows each location as a card with its **photo thumbnail** (falls back to the location icon when no photo is set). An **ⓘ button** on each spot card — and in the spot's header while counting — opens a **modal showing the photo large + the description** so staff can confirm the shelf/fridge and any notes (e.g. "top 3 shelves only"). Tapping ⓘ does not start the count.
- No schema change; company-scoped like locations already are.

### H. Out of stock vs not counted — remove the ambiguous "0" (decided)

A blank `0` can't mean both "counted none" and "nobody counted it." So an item ends a count in one of **three explicit states**, and the manager sees which:

- **Counted** — a number staff entered (`− / +` or numpad). The value is shown; `—` (not `0`) is the untouched placeholder so an uncounted row is visibly empty.
- **Out of stock** — staff tapped **`Out of stock`** on the row: a deliberate "none here." Recorded distinctly from a counted `0`.
- **Not counted** — never touched. **`Done` no longer silently records these as 0;** the walk-home spot line and the manager's review show them as `⚠ not counted`, so a gap reads as a gap.
- **Data (small addition):** count entries need to carry this state. Add an **`out_of_stock` flag (or a 3-value `status`: counted | out | —)** to `count_entries` / `quick_counts`; **absence of an entry = not counted** (no row is written for untouched items). Review (`ReviewSubmissions`) renders the three states; approve treats `out` as 0-with-intent when/if it writes back to Odoo. Everything else (per-location walk, photo rows) composes with this unchanged.
- **Manager view:** a session summary can surface `X counted · Y out of stock · Z not counted` per spot and overall — turning "why is this 0?" into an answered question.

## Data model — reuses existing infra (no rebuild)

| Concept | Existing table / field | Change |
|---|---|---|
| Storage spot | `count_locations` (per company) | none; add inline-create in the builder |
| Location photo + info | `count_locations.photo` / `description` (both TEXT) | **both already exist**; manager sets photo + "where it is" note; staff see thumbnail + an ⓘ modal (section G) |
| Item → spot | `product_locations` (product ↔ count_location) | now written **by the builder** (was a separate screen); already supports multi-location |
| Guided walk state | `session_location_status` | none |
| The list | `counting_templates.product_ids` | written as the union of placed items |
| Count unit / pack size | `product_flags.pack_label` / `units_per_crate` (+ small new `loose_label`) | pack_label smart-defaulted (shown LOUD); units_per_crate = avg (simple) **or** pack size (pack+loose); loose_label = single-unit word |
| Pack + loose count | `count_entries` / `quick_counts` `crate_qty` / `loose_qty` / `units_per_crate` | **already built** (`CrateCountSheet`, 2026-07-03); surfaced as two steppers on the list row |
| Display name (internal) | `product.name` | the display name everywhere staff/list see a product; always present, no fallback |
| Order code (search key) | `product.default_code` ("Internal Reference" label = supplier order/article number in this data) | added to the picker search domain + confirmation subtitle; never displayed as the item's name |
| Supplier name / vendor code (search keys) | `product.supplierinfo.product_name` / `product_code` via `seller_ids` | added to the picker search domain + confirmation subtitle; never displayed as the item's name |
| Hard-to-count flag | `product_flags.requires_photo` | already built + toggleable; add inline builder toggle + count-screen photo variant |
| Photo evidence | `count_photos` (source_table, source_id, photo) | already built; required for `requires_photo` items; shown large in review |
| Manager adjust | count entry `counted_qty` via `approve` path | **new:** approve accepts a manager-confirmed number for a photo entry |
| Count state | `count_entries` / `quick_counts` — new `out_of_stock` flag (or `status`) | **new (small):** distinguishes counted vs out-of-stock vs not-counted (no entry); section H |
| Catch-all | (virtual) | items in the list not placed in any spot render under "No specific spot" |
| Odoo kg write | approve → `stock.quant` | demoted to best-effort/optional (already best-effort today) |

## Data model — corrections from verification (2026-07-19, Codex cross-check)

The Anthropic multi-agent verification could not run (session usage limit); the OpenAI **Codex** cross-check did, and reading the real code corrected several "reuses existing infra / no rebuild" claims above. The redesign is feasible but needs **real data-model work**, not just surfacing:

**Claims corrected**
- **Multi-location counting is NOT wired end-to-end.** `product_locations` allows multiple rows, but `guided-route.ts` deliberately selects ONE primary location, and `count_entries` is keyed by `(session, product)` — so the same product cannot currently be counted at two spots. Core to the redesign; needs new structure.
- **`product_locations` is global (no `template_id`).** Using it as the builder's placement store would let editing one list's spots affect other lists. Needs a template-scoped placement table.
- **Open sessions would drift** if a template/placement is edited mid-count. Needs a per-session snapshot of its items.
- **Supplier search can't be a dotted `product.product` domain.** Vendor name/code live on `product.supplierinfo`; hydrate with a separate query and scope sellers to the active/shared company.
- **Photo delta is bigger than "manager adjust only."** Today the photo UI appears only after a positive count and submit requires a photo only when qty>0; the photo-first + out-of-stock-bypass gating on the count screen is new work.
- **Location photo/description editing already exists** in `LocationManager` (both fields) — only builder integration + the staff ⓘ modal are new (G is smaller than stated).
- **`loose_label` alone is insufficient** — persist an explicit `count_mode` (`simple | pack_loose`) because `units_per_crate` can't reveal average-vs-pack-size.
- **Odoo write is best-effort but not optional** — templates require an Odoo `location_id` and approve auto-writes; multiple spot rows for one product must be **summed** before writing `stock.quant` (current code would race several writes).
- **Company scoping is broader than departments** — templates list ignores active company, `ManageTemplates` sends none, `/api/inventory/locations` lacks the cookie fallback, the person picker uses the admin-wide users endpoint; `product_flags` are global by product id (a shared product's settings leak across companies).

**New/changed schema (all via the idempotent `migrateInventorySchema()` ALTER pattern)**
- `product_flags`: `+ count_mode TEXT NULL` (simple|pack_loose), `+ loose_label TEXT NULL`.
- **New `template_product_locations`** (`template_id, odoo_product_id, count_location_id, shelf_sort`; PK on the 3 ids) — per-list placements (replaces global `product_locations` for the builder).
- **New `session_count_items`** — snapshot `(session_id, product_id, count_location_id, shelf_sort)` + `requires_photo, count_mode, labels, pack size/avg`; legacy sessions fall back to live resolution.
- `count_entries`: `+ count_location_id INTEGER NOT NULL DEFAULT 0`, `+ out_of_stock INTEGER NOT NULL DEFAULT 0`, `+ count_mode/pack_label/loose_label` snapshots, `+ odoo_qty REAL NULL`; unique index `(session_id, count_location_id, product_id)` after de-duping legacy rows.
- `quick_counts`: `+ out_of_stock INTEGER NOT NULL DEFAULT 0` + matching snapshots + `odoo_qty`.
- No migration: `count_locations.photo/description`, `count_photos`, `session_location_status`.

**Other risks to honor:** location delete → soft-delete (`active`); `count_photos` needs an entry id, so photo-before-count uses composite offline state; offline dedup keys must include spot id; simple counts with no average stay portal-only (never write "3 trays" as "3 kg"); quick-counts have no predefined list so "not counted" doesn't apply there; simple counts may be decimal but packs/loose/pack-size are non-negative integers.

**Build order (each phase independently testable — its own plan):**
1. **Data foundation** — migrations + db CRUD/types + unit tests (no UI).
2. **Server semantics** — template placements save, session snapshot, counts route (location + state), approve aggregation + adjust.
3. **Product naming search (E)** — products route + supplierinfo hydration + `displayName`.
4. **Builder (A)** — location-organized editor + chosen-pinned picker + company scope.
5. **Count UI (B)** — per-spot list, numpad, stacked/compact cells, out-of-stock, photo rows, location ⓘ.
6. **Review (F, H)** — manager adjust + 3-state summaries.
7. **Unit settings (C)** — ProductSettings count_mode/labels.

## Non-goals (this spec)

- Precise Odoo stock valuation / recipe-cost accuracy from counts (portal is enough).
- Weighing / scale integration.
- Par-level auto-reorder / supplier ordering (future; the count feeds it later).
- Reworking the Odoo write-back beyond keeping it best-effort.
- Automatic counting from the photo (AI/vision). The manager reads the photo by eye; the photo is evidence, not an auto-counter.

## Open questions

- Seed a default set of location "spots" per restaurant, or start empty + add inline?
- Hide the "No specific spot" catch-all when it's empty?
- The reorder view (which items are low, from the counts) — separate follow-up spec.
