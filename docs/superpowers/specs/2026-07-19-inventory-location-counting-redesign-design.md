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

## Design

### A. List builder — location-organised (manager)

Replaces the flat product picker in `src/components/inventory/TemplateForm.tsx`. The list becomes a set of **spots**, each holding items:

- Builder shows the list grouped by **location card**: `🧊 Walk-in fridge (3 items)` → item rows (name + category + remove ✕) → `+ Add item to Walk-in fridge`.
- `+ Add a location` reuses the existing count-locations feature (create inline **or** pick an existing spot). A default **"No specific spot"** group always exists.
- Tapping `+ Add item…` opens the **chosen-pinned picker**: search + category pills; chosen items pinned as chips; each row `+ Add` / `✓ Added`. Adding places the product into *that* spot.
- The **same product may be added to multiple spots**.
- Saving writes BOTH the template's `product_ids` (the union of all placed items) AND the `product_locations` placements (product → count_location). This is the unification — one save sets up *what* + *where*.
- Company scope: locations, products, and the list all belong to the **active company** (blue-ribbon), bounded by permissions.

### B. Count screen — practical unit, flipped emphasis (staff, guided by location)

Redesign of `src/components/inventory/CrateCountSheet.tsx` (and the count entry path):

- Top: `‹ Back` + location breadcrumb `🧊 Walk-in fridge · 1 of 3`.
- **Product name large** (e.g. "Cilantro, fresh"); small category above it.
- **The count is the hero:** a large `− / +` stepper with a big number and the unit word ("bunches"); tapping the number opens a numpad for large counts.
- **≈ kg footnote:** small grey `≈ 0.15 kg` **only when an average exists**; omitted otherwise. Never the focus.
- Save count.
- The guided walk (existing `guided-route.ts` + `session_location_status`) drives the location order; the "count / skip a spot" completion gates stay.

### C. Unit model

Per product, stored in `product_flags` (extending today's `pack_label` + `units_per_crate`):

- `pack_label` = the **count unit word** (bunch/crate/tray/…), required-ish with a **smart default** guessed from name/category (herbs→bunch, sacks→bag, meat→tray or kg, drinks→crate).
- `units_per_crate` = **optional** average base-units per unit, powering the faint ≈ kg footnote only. No average → no footnote; counting still works.
- Amorphous items (beef, oil, half-bags): use a container unit ("tray", "jug", "bag") — whole-container counting; the average is skipped.
- Set/edited in Product Settings; the smart default means most products need no manual touch.

### D. Company-selector source of truth

Every company-scoped endpoint reads the active company from `?company_id=` or the `kw_company_id` cookie, filters to it (bounded by `canAccessCompany`), and falls back to the full allowed scope only when nothing is selected. Applied to departments already; the builder's location/product fetches follow the same rule.

## Data model — reuses existing infra (no rebuild)

| Concept | Existing table / field | Change |
|---|---|---|
| Storage spot | `count_locations` (per company) | none; add inline-create in the builder |
| Item → spot | `product_locations` (product ↔ count_location) | now written **by the builder** (was a separate screen); already supports multi-location |
| Guided walk state | `session_location_status` | none |
| The list | `counting_templates.product_ids` | written as the union of placed items |
| Count unit + avg | `product_flags.pack_label` / `units_per_crate` | pack_label smart-defaulted; units_per_crate optional |
| Catch-all | (virtual) | items in the list not placed in any spot render under "No specific spot" |
| Odoo kg write | approve → `stock.quant` | demoted to best-effort/optional (already best-effort today) |

## Non-goals (this spec)

- Precise Odoo stock valuation / recipe-cost accuracy from counts (portal is enough).
- Weighing / scale integration.
- Par-level auto-reorder / supplier ordering (future; the count feeds it later).
- Reworking the Odoo write-back beyond keeping it best-effort.

## Open questions

- Seed a default set of location "spots" per restaurant, or start empty + add inline?
- Hide the "No specific spot" catch-all when it's empty?
- The reorder view (which items are low, from the counts) — separate follow-up spec.
