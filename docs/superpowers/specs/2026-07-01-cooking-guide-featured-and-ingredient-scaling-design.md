# Cooking Guide — Featured Dishes + Ingredient-Driven Scaling

**Date:** 2026-07-01
**Repo:** `erxu168/Odoo_Portal_18EE` (Krawings Portal, Next.js) — branch `main`
**Module:** Chef Guide (`src/components/recipes/`, `src/app/recipes/`)
**Status:** Approved design, ready for implementation plan

---

## Motivation (plain language)

Cooks currently have to press **"New dish"** on the Cooking Board and then hunt
through categories/search to start any dish. We want the common dishes to be
**tappable directly from the board**, and we want the "one kilo of rice drives
the whole recipe" scaling (already built in Manufacturing → Create MO) to be
available while cooking.

This is two independent, separately-shippable features that combine into a fast
flow: **tap a featured dish → set the amount (servings *or* by a driving
ingredient) → start cooking.**

---

## Part A — Featured dishes on the Cooking Board

### Behaviour
- A **manager/admin** opens any dish (Recipe Overview) and taps a **★ "Feature
  on board"** toggle. Regular staff never see this control.
- Featured dishes appear as **tappable tiles** on the Cooking Board
  (`ActiveSessions`), above the existing dashed **"New dish"** tile, which stays.
- Tapping a featured dish goes **straight to the "set amount" screen**
  (`BatchSize`) → then into cooking. It skips browse + overview.
- **Auto-fallback:** if no dishes are featured for the active restaurant, the row
  shows the **most-cooked** dishes instead, so it is never empty and needs no
  upkeep to be useful.

### Curation source & storage — decision
Store the featured list **inside the portal's own SQLite database**, scoped to the
**active company (restaurant)**. Rationale:
- It is a portal-only UX concern; the portal is the only consumer.
- **No Odoo module change required** (lower risk, easy revert).
- Follows the existing company-scoped convention (header company switcher).

New table in `src/lib/recipe-db.ts`:

```sql
CREATE TABLE IF NOT EXISTS recipe_featured (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  mode        TEXT    NOT NULL,      -- 'cooking' | 'production'
  recipe_id   INTEGER NOT NULL,      -- product_tmpl_id (cooking) or bom_id (production)
  recipe_name TEXT    NOT NULL,      -- denormalised for display without an Odoo round-trip
  sequence    INTEGER NOT NULL DEFAULT 0,
  featured_by INTEGER,               -- portal user id
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, mode, recipe_id)
);
```

Helper functions (mirroring existing `recipe-db.ts` style):
`listFeatured(companyId, mode?)`, `addFeatured({...})`, `removeFeatured(companyId, mode, recipeId)`, `isFeatured(companyId, mode, recipeId)`.

### Auto-fallback source
Most-cooked is computed server-side so it is shared across all cooks/devices
(the existing per-device `localStorage kw_recipe_freq` is not shared). On **Dish
Complete**, write one row to a lightweight cook-log, and expose a "top dishes"
query.

- Reuse/extend the existing `cook_sessions` table in `recipe-db.ts`
  (`startCookSession` / `completeCookSession` already exist but are not yet
  called by the portal cook flow). Add a minimal completion write in the
  `onComplete` handler in `recipes/page.tsx`, and a `getTopCookedRecipes(companyId, mode, limit)` helper.
- Fallback query returns up to N (default 4) most-completed dishes for the
  active company/mode that still exist and are published.

### API
New route `src/app/api/recipes/featured/route.ts`:
- `GET  ?mode=cooking` → `{ featured: [{recipe_id, recipe_name, mode, ...}], source: 'manual' | 'auto' }`
  - Returns the manual list; if empty, returns the auto-fallback list with `source: 'auto'`.
- `POST { mode, recipe_id, recipe_name }` → add (manager/admin only; role checked server-side).
- `DELETE { mode, recipe_id }` → remove (manager/admin only).

Company id comes from the same server-side session/company context other portal
API routes already use.

### UI changes
- **`src/components/recipes/ActiveSessions.tsx`** — add a "Featured" section of
  tappable tiles above the grid; new prop `featured: FeaturedTile[]` and
  `onSelectFeatured(tile)`. Empty state and the "New dish" tile are unchanged.
- **`src/components/recipes/RecipeOverview.tsx`** — add a ★ "Feature on board"
  toggle in the header/action area, visible only when `userRole` is
  `manager`/`admin`; calls POST/DELETE and reflects `isFeatured` state.
- **`src/app/recipes/page.tsx`** — fetch featured list for the active
  `browseMode` when entering the board; pass to `ActiveSessions`;
  `onSelectFeatured` sets `ctx` (mode, recipeId, recipeName), loads the recipe's
  steps, then navigates directly to `batch-size` (skipping browse + overview).
  Record a cook completion in `onComplete`.

### Files touched (Part A)
- `src/lib/recipe-db.ts` (new table + helpers)
- `src/app/api/recipes/featured/route.ts` (new)
- `src/components/recipes/ActiveSessions.tsx`
- `src/components/recipes/RecipeOverview.tsx`
- `src/app/recipes/page.tsx`

---

## Part B — "Set amount by ingredient" scaling in both guides

### Behaviour
On the amount screen (`BatchSize`), keep the normal servings/kg picker as the
default and add a **"Set by ingredient"** switch — the same interaction already
shipped in **Manufacturing → Create MO** (`CreateMo.tsx`):
1. Toggle on → pick a **driving ingredient** from the recipe's ingredient list.
2. Enter **how much you have** (e.g. `1` kg rice).
3. The multiplier becomes `entered ÷ base amount of that ingredient`; the servings/
   kg figure and every ingredient rescale. The driving ingredient shows the exact
   entered amount.

Cook Mode already multiplies each step ingredient by `session.multiplier`, so the
scaled amounts appear during cooking with **no change to `CookMode`**.

### Why this is mostly wiring
`BatchSize.tsx` already contains an early "Set by ingredient" (`sqc`) block, but:
- it is gated to `mode === 'production'`, and
- it is never given an ingredient list (`bomIngredients` is not passed by
  `recipes/page.tsx`), so cooks never see it.

The work is to **generalise it to both modes**, feed it an aggregated ingredient
list, and align its look with the nicer Manufacturing version.

### Ingredient list source (per mode)
A unified shape handed to `BatchSize`:
`{ id: number; name: string; baseQty: number; uom: string }[]`

- **Cooking:** aggregate the step ingredients returned by `/api/recipes/steps`
  (`step_ingredient` records already include `qty` + `uom`). Sum `qty` per
  `product_id` across steps so an ingredient used in multiple steps has one base
  total. Only ingredients with `baseQty > 0` are offered as driving options.
- **Production:** fetch `/api/boms/{bomId}` → `components` (`product_id`,
  `product_name`, `required_qty`, `uom`) — the exact source `CreateMo` uses.

### Scaling math (single source of truth)
```
multiplier = enteredQty / drivingIngredient.baseQty     // baseQty > 0 guaranteed
batch      = round(baseBatch * multiplier)              // for display only
```
`onConfirm(batch, multiplier)` is unchanged; the existing pipeline already carries
`multiplier` into the cook session.

### Edge cases
- Recipe has no ingredient with a recorded amount → hide the toggle, show only the
  servings/kg picker (current behaviour).
- Entered qty is empty/zero/non-numeric → no rescale; confirm button uses the
  plain batch value.
- Very large/small multipliers are allowed (kitchen reality); amounts are rounded
  for display only, never for the stored multiplier.

### Files touched (Part B)
- `src/components/recipes/BatchSize.tsx` (generalise toggle to both modes; take
  unified `ingredients` prop; polish to match Manufacturing)
- `src/app/recipes/page.tsx` (aggregate cooking step-ingredients / fetch BOM
  components and pass the unified list into `BatchSize`)

---

## Build order & git

Portal single-branch rule applies — work on `main`, two separate commits:

1. **Part B first** (smaller, low-risk, finishes existing code):
   `[IMP] recipes: set batch amount by driving ingredient (both guides)`
2. **Part A second**:
   `[ADD] recipes: featured dishes on the Cooking Board`

Each commit is self-contained and revertable with `git revert <hash>`.

---

## Risk

**Low–medium.**
- Additive UI + one new portal table + one new API route. No Odoo changes.
- Highest-touch file is `recipes/page.tsx` (orchestrator wiring) — changes are
  localised to the board-entry, batch-size, and complete handlers.
- Desktop and Odoo are untouched; all UI is mobile-first within the portal.

## Reusability note
The driving-ingredient math + control already exists twice (Manufacturing
`CreateMo`, and the dormant `BatchSize` block). This work **consolidates the
pattern** rather than adding a third copy. If a third consumer appears later, the
scaling helper + the toggle component are the candidates to extract into a shared
`src/components/ui/` primitive — out of scope now (YAGNI).

---

## Verification

**Part B (scaling):**
1. Open a cooking dish that has ingredient amounts → Start → Batch Size.
2. Toggle "Set by ingredient" → choose e.g. Rice → enter `1` kg.
3. Confirm servings + all ingredients rescale; driving ingredient reads exactly `1 kg`.
4. Start cooking → Cook Mode step amounts reflect the scaled quantities.
5. Repeat in the Production Guide with a BOM recipe.
6. Open a dish with **no** recorded amounts → toggle is hidden; plain picker works.

**Part A (featured):**
1. As **manager**, open a dish → tap ★ "Feature on board".
2. Go to Cooking Board → dish appears as a tappable tile; tapping it lands on Batch Size.
3. As **staff**, confirm the ★ control is not visible but featured tiles are.
4. Remove all featured dishes → board shows most-cooked fallback (after ≥1 completed cook).
5. Switch the header company → featured list changes per restaurant.

**Build:** `npm run build` must pass (TypeScript) before restart/deploy.

## Rollback
`git revert <commit_hash>` for either feature independently. The new
`recipe_featured` table is additive (untouched by revert; can be dropped
manually if desired).

## Regression checklist
- [ ] Existing "New dish" → browse → overview → cook flow still works unchanged.
- [ ] Servings/kg picker still works with the toggle **off** in both guides.
- [ ] Cook Mode scaled amounts unchanged for recipes started without the toggle.
- [ ] Manager-only ★ control hidden from staff (UI **and** server-side role check).
- [ ] Featured list is per-company; switching company updates it.
- [ ] `npm run build` passes; desktop/Odoo untouched.
