# KDS — hide self-service categories (drinks) from the kitchen

Date: 2026-08-07
Status: approved by Ethan, ready to implement
Scope: Krawings Portal (`erxu168/Odoo_Portal_18EE`), custom KDS at `/kds`

## Problem

Drinks at What a Jerk are self-service — the guest takes a bottle from the fridge.
The kitchen has no job to do with them, yet all 27 products in the **WAJ Drinks**
POS category still appear as items on the kitchen cards. Cooks tick off lines that
were never theirs, and the "x/y items ready" progress is inflated by drinks.

## Decision

Hide by **POS category**, manager-controlled, from KDS Settings.

Rejected alternatives:

- *Hard-wire "skip category 195"* — needs a code change for every future drinks
  category or any other self-service group.
- *Per-product toggle* — 27 switches to flip today, and one more for every new
  drink added in Odoo. Too easy to forget.

## Behaviour

- KDS Settings gains a **Show in kitchen** section: one tick per POS category
  available on the connected register. Unticked = hidden from the kitchen screen.
- Ships with **WAJ Drinks** unticked on the live install (location 99).
- An order whose lines are *all* hidden does not appear on the KDS at all — the
  same rule the feed already applies to tip-only orders
  (`src/app/api/kds/orders/route.ts`, `if (lines.length === 0) return null`).
- Hidden lines are excluded from the quantity-based progress counts, so
  "0/1 items ready" reflects food only.
- Categories are matched **live against Odoo**, not against the saved
  `kds_product_config` snapshot. A drink added in Odoo next month is hidden
  automatically with no manual "Sync products".

### Fail-safe rules (both directions default to *show*)

1. If Odoo cannot be reached while resolving hidden products, **show everything**.
   A network blip must never make food invisible to the kitchen.
2. An empty hidden list means **show everything**. There is no way to blank the
   kitchen screen by unticking every category.

## Non-goals

- The Cooking Timer (`/cooktimer`) is unchanged. It shares the Odoo poller
  (`src/lib/kds-order-feed.ts`), so the filter is applied in the KDS route only.
  The timer queue already restricts itself to products with a cook profile, and
  drinks have none.
- No new permission. `/kds` is a no-login kitchen-tablet route; this setting sits
  behind the same gear icon as the register picker and the timer thresholds.
- One KDS install (location 99) → one hidden-category list. Not per-register.
- Sauces, Sides and the rest stay visible.

## Data model

One new column on the existing portal SQLite table `kds_settings`:

```
hidden_pos_categ_ids TEXT DEFAULT ''   -- CSV of pos.category ids, e.g. "195"
```

Added with the established guarded-migration pattern in `src/lib/kds-db.ts`
(`PRAGMA table_info` check, then `ALTER TABLE`), because the table is created with
`CREATE TABLE IF NOT EXISTS` and so an amended `CREATE` never reaches an existing
database.

Surfaced on `KdsSettings` as `hiddenPosCategIds: number[]`, default `[]`.

**Odoo is never written to.** The KDS stays strictly read-only against Odoo.

## Components

| File | Change |
|---|---|
| `src/types/kds.ts` | `hiddenPosCategIds: number[]` on `KdsSettings` + `DEFAULT_SETTINGS` |
| `src/lib/kds-db.ts` | new column, guarded migration, read in `getKdsSettings`, write in `saveKdsSettings` |
| `src/lib/kds-hidden-products.ts` *(new)* | resolve hidden category ids → `Set<odoo product id>`, cached ~60 s, single-flight, fail-safe to empty set |
| `src/app/api/kds/orders/route.ts` | drop hidden lines before mapping to items |
| `src/app/api/kds/pos-categories/route.ts` *(new)* | GET the categories available on the connected register |
| `src/components/kds/SettingsPanel.tsx` | the **Show in kitchen** tick list |

`src/lib/kds/state.tsx` needs no change — settings already flow through it, and the
new field rides along on the existing `KdsSettings` object.

Nothing indexes order items by position: `ClassicView`, `Pipeline`, `DoneGrid` and
the per-line check state all key off line id and recompute totals from whatever
items they are given. Removing lines is therefore safe for every KDS surface.

Stale rows left behind (a `kds_order_checks` row for a now-hidden drink line, a
`kds_completed_orders` stage for an order that has become invisible) are inert and
already pruned on their own schedule.

## Acceptance criteria

- **Given** WAJ Drinks is unticked, **when** an order with 1 burger + 2 beers is
  paid, **then** the kitchen card shows only the burger and reads "0/1 items ready".
- **Given** WAJ Drinks is unticked, **when** an order of only drinks is paid,
  **then** no card appears on the KDS.
- **Given** WAJ Drinks is ticked again, **when** the tablet refreshes, **then**
  drinks are back on the cards.
- **Given** Odoo is unreachable while resolving the hidden set, **then** the
  kitchen still sees all food lines.
- **Given** no category is unticked, **then** the KDS behaves exactly as it does
  today.

## Verification

Read-only against staging — no orders are created, edited or deleted
(binding rule: verification never mutates real records).

1. `npx tsc --noEmit` and `npx next lint --file <changed files>`.
2. Push to `main`; staging autodeploys within ~2 minutes.
3. Open `/kds` → gear → untick **WAJ Drinks** → Save.
4. `GET /api/kds/orders` and confirm no line belongs to a WAJ Drinks product.
5. Re-tick and confirm drinks return.

## Risk

Low. No Odoo writes, no money, no stock counts. Revertible with a single
`git revert`. The worst realistic failure is the inverse of the bug — drinks
reappear on the kitchen screen.

## Cross-check

The mandatory Codex cross-check could not run: the OpenAI quota was exhausted
("You've hit your usage limit … try again at Aug 8th, 2026 11:16 AM") for both the
planning and the post-implementation review call. The edge-case pass above was
done unassisted. Re-run
`codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" --sandbox read-only`
against the diff once quota returns.
