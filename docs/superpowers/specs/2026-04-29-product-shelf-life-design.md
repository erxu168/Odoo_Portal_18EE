# Product Shelf Life — Chilled & Frozen Expiration Dates on Labels

**Date:** 2026-04-29
**Module:** Manufacturing (BOM detail + Package/Label flow)
**Status:** Approved by user, ready for implementation plan

---

## Summary

Today the portal calculates the expiration date on a printed label by reading
a single `expiration_time` (days) from `product.template` in Odoo. The kitchen
needs **two** shelf-life values per product — one for chilled storage, one for
frozen — and the operator must pick which one applies at print time. The
selected storage mode and the resulting expiry date both appear on the label.

This spec describes the end-to-end change: a new Odoo addon for the two fields,
portal API endpoints to read and write them, an editor on the BOM detail
screen, a storage-mode toggle on the package/label flow, and the label
rendering update.

---

## Goals

- Each product carries two independent shelf-life values: chilled days and
  frozen days.
- Managers and admins can edit both values on the BOM detail screen in the
  portal. Back-office staff can also edit them in Odoo's product form.
- At label-print time the operator picks Chilled or Frozen with one tap. The
  expiry date on the label reflects the chosen mode.
- The printed label shows the storage mode (e.g. `STORE: CHILLED`) so anyone
  reading the label knows which shelf-life basis was used.
- If the selected mode has no value set on the product, the operator can still
  print the label; the expiry date is left blank on screen and on the label.

## Non-goals

- No automatic migration or backfill from the existing `expiration_time` field.
  Managers must enter the new chilled/frozen values manually on each BOM. (Q5).
- No per-container override of the storage mode. The whole batch is either
  chilled or frozen. (Q3.)
- No "BOMs missing shelf life" report or filter on the BOM list screen. May be
  added later if it becomes a pain.
- No change to Odoo's native `expiration_time` field — it is left untouched on
  every product so any other Odoo logic that reads it (stock removal-date
  logic, etc.) keeps working.

---

## Architecture overview

```
Odoo (master data)
  product.template
    + x_shelf_life_chilled_days  (Integer, default 0)
    + x_shelf_life_frozen_days   (Integer, default 0)

       ▲                                  ▲
       │ read+write via JSON-RPC          │
       │                                  │
Portal API                                │
  GET   /api/manufacturing-orders/[id]    │ (extended)
  GET   /api/products/[id]/shelf-life     │ (new)
  PATCH /api/products/[id]/shelf-life     │ (new)

       ▲                                  ▲
       │                                  │
Portal UI                                 │
  BomDetail.tsx — Shelf Life card         │
    (Manager+ edit, Staff read-only)      │
                                          │
  PackageLabel.tsx — Storage toggle       │
    + LabelPreview.tsx renders STORE line │
    + ZPL output renders STORE line       │
                                          │
  SQLite container_split table            │
    + storage_mode TEXT ('chilled'|'frozen')
```

---

## Component 1 — Odoo addon `krawings_shelf_life`

A new addon at `/opt/odoo/18.0/custom-addons/krawings_shelf_life/` (separate
workspace; the portal repo does not contain Odoo code).

### Fields

Both fields are added to `product.template`:

| Field | Type | Default | Label |
| --- | --- | --- | --- |
| `x_shelf_life_chilled_days` | Integer | `0` | Shelf Life — Chilled (days) |
| `x_shelf_life_frozen_days` | Integer | `0` | Shelf Life — Frozen (days) |

`0` means "not set." No validation beyond Odoo's default integer behavior.
Editing is allowed for any user with write access to `product.template` (no new
Odoo group is introduced).

### Form view

A new "Shelf Life" group is added to the existing product form, on the
Inventory tab, containing the two fields side by side.

### Why no migration of existing `expiration_time`

Per Q5: the team explicitly chose a clean break. Old `expiration_time` values
stay in place and are no longer read by the portal label flow. Managers
backfill chilled and frozen days manually from the BOM detail screen during
the rollout window (see "Rollout" below).

---

## Component 2 — Portal API

### Read on the manufacturing order

Extend `GET /api/manufacturing-orders/[id]` (in
[`src/app/api/manufacturing-orders/[id]/route.ts`](../../src/app/api/manufacturing-orders/[id]/route.ts))
to fetch the two new fields from `product.template` alongside the existing
product info.

The response payload gains:

```json
{
  "shelf_life_chilled_days": 5,
  "shelf_life_frozen_days":  90
}
```

The existing `expiration_time_days` field is **removed** from the response
payload — the label flow no longer uses it. (See "Migration of existing
callers" below.)

### Read for the BOM detail screen

A new endpoint:

```
GET /api/products/[id]/shelf-life
→ 200 { chilled_days: number, frozen_days: number }
```

Returns the two values for the given product template id. Used by the BOM
detail screen so it does not have to fetch the whole product object.

### Write from the portal

A new endpoint:

```
PATCH /api/products/[id]/shelf-life
body: { chilled_days?: number, frozen_days?: number }
→ 200 { chilled_days: number, frozen_days: number }
→ 403 if caller is not Manager or Admin
→ 400 if either value is < 0 or > 999 or not an integer
```

Writes via Odoo `product.template.write()`. Role enforcement uses the same
session/role helpers the rest of the portal API uses.

---

## Component 3 — BOM detail UI

A new "Shelf Life" card is added to
[`src/components/manufacturing/BomDetail.tsx`](../../src/components/manufacturing/BomDetail.tsx),
positioned between the recipe section and the instructions section.

### Layout

Two number inputs side by side on tablet/desktop, stacked on smartphone.

```
┌─ Shelf Life ───────────────────────────────┐
│                                             │
│  CHILLED          FROZEN                    │
│  ┌──────┐         ┌──────┐                  │
│  │  5   │ days    │  90  │ days             │
│  └──────┘         └──────┘                  │
│                                             │
│  Used to calculate the expiry date when     │
│  printing labels.                           │
│                                             │
│  [ Save shelf life ]                        │
└─────────────────────────────────────────────┘
```

### Behavior

- Initial values come from `GET /api/products/[id]/shelf-life`. While loading,
  the card shows a skeleton.
- A blank input is treated as `0` on save (i.e. "not set").
- The Save button is **disabled** for Staff role; Staff sees the values as
  read-only text. Manager+ sees the inputs as editable.
- Inline validation: integers from `0` to `999`. Negative numbers and decimals
  are rejected client-side; the API rejects them as well.
- After a successful save, a success toast is shown:
  *"Shelf life updated. New labels will use these values."*
- If either value is `0` after save, a small grey hint is shown under that
  field: *"Not set — labels will print with no expiry date."*

### Out of scope

- No history/audit log of who changed shelf life. (BOM history covers this if
  the team needs it later.)
- No copy-from-other-product shortcut.

---

## Component 4 — Package / Label flow

Changes to [`src/components/manufacturing/PackageLabel.tsx`](../../src/components/manufacturing/PackageLabel.tsx)
and [`src/components/manufacturing/LabelPreview.tsx`](../../src/components/manufacturing/LabelPreview.tsx),
plus the ZPL renderer.

### Storage mode toggle

Added to the top of the Package screen, above the container split rows.
Segmented control with two pills, full width on smartphone.

```
┌─ Storage ──────────────────────────────────┐
│                                             │
│  ┌─────────────┐  ┌─────────────┐          │
│  │ ❄  CHILLED  │  │ ❄❄ FROZEN   │          │
│  │   5 days    │  │   90 days   │          │
│  └─────────────┘  └─────────────┘          │
│   ▲ selected                                │
│                                             │
│  Expiry: Mon 4 May 2026                     │
└─────────────────────────────────────────────┘
```

- Default selection on first load: **Chilled**.
- The `5 days` / `90 days` text under each pill comes from the product's two
  fields. If a value is `0`, the pill shows `— days` (em-dash) and is still
  tappable.
- The "Expiry: …" line below the toggle is computed live from
  `today + selected_days`. If `selected_days` is `0`, the line reads:
  *"Expiry: not set — label will print without an expiry date."*

### Effect on container rows

Switching the toggle updates **every** container row's expiry date (the rows
remain editable individually after that — operator can still manually adjust
one container if needed). Per Q3, the toggle is a batch-level choice.

### Persistence

A new column is added to the SQLite `container_split` table:

```sql
ALTER TABLE container_split ADD COLUMN storage_mode TEXT;
-- values: 'chilled' | 'frozen'
```

The selected mode is saved alongside the split when the operator confirms.
Reprints read the stored mode so the printed label stays consistent.

The migration runs in the existing portal SQLite migration runner. Existing
splits get `NULL`, which the read path treats as `'chilled'` for backwards
compatibility on label preview only.

### Behavior when shelf life is missing

Per the user's revised rule (after Q5): printing is **never blocked**.

- Both pills are always tappable, even when the underlying value is `0`.
- If the selected mode's value is `0`, the expiry date field on every container
  row is left blank by default. The operator can still type one in manually if
  they want to.
- The label renders with the `EXP:` field empty (see "Label rendering" below).

### Label rendering

Both the on-screen preview ([`LabelPreview.tsx`](../../src/components/manufacturing/LabelPreview.tsx))
and the ZPL output gain a new line below the existing expiry line:

```
STORE: CHILLED          (or STORE: FROZEN)
EXP:   04 May 2026      (or blank if no expiry)
```

The `STORE:` line is bold, same font size as `EXP:`. When the expiry is blank
the `EXP:` label is still printed with no value following it (so the operator
visually sees that there is no expiry on the label). The ZPL renderer must
handle the blank case without producing a malformed label.

---

## Migration of existing callers

The current package/label flow reads `expiration_time_days` off the MO payload
in [`PackageLabel.tsx:61`](../../src/components/manufacturing/PackageLabel.tsx#L61).
That code is replaced by the storage-mode toggle described above. Search for
any other callers of `expiration_time_days` in the portal and update or remove
them; based on the current grep there are no other consumers.

The diagnostic endpoint at
[`src/app/api/products/[id]/expiry-debug/route.ts`](../../src/app/api/products/[id]/expiry-debug/route.ts)
is left untouched — it inspects all expiry fields on the product and is useful
for diagnosing missing or mis-set values during the rollout.

---

## Rollout

The change ships in three stages to avoid a "Monday morning, nobody can print"
surprise:

1. **Odoo addon first.** Install `krawings_shelf_life` on staging. Both fields
   appear blank on every product. Nothing in the portal changes yet.
2. **Portal BOM editor next.** Ship Component 3 (BOM detail Shelf Life card)
   and Component 2's read+write endpoints. Managers can now go fill in chilled
   and frozen days on each BOM. The package/label flow is unchanged and still
   uses the existing `expiration_time` path.
3. **Portal label flow last.** Ship the rest of Component 2 (the read change
   on the MO endpoint, removing `expiration_time_days`) plus Component 4
   (toggle, label rendering, SQLite migration). At this point any BOM that
   has not been backfilled prints labels with a blank expiry date — printing
   is never blocked (per the revised Q4 rule), but the label looks visibly
   incomplete which is itself a forcing function for the team to fix it.

The team backfills BOMs between stages 2 and 3. The existing `expiration_time`
value on each product is a sane starting point for chilled days; managers
manually copy it across as part of the sweep.

---

## Test plan

### Backend (Odoo addon)

- Install the module on staging. Confirm both fields appear on the
  `product.template` form, in the Inventory tab, in a "Shelf Life" group.
- Set values via Odoo, read them via JSON-RPC, confirm round trip.
- Set values via JSON-RPC `write`, confirm Odoo form reflects the new values.
- Write `0` and confirm it stores as `0` (not `False` or `null`).

### Portal API

- `GET /api/manufacturing-orders/[id]` returns
  `shelf_life_chilled_days` and `shelf_life_frozen_days`, no
  `expiration_time_days`.
- `GET /api/products/[id]/shelf-life` returns the two values for a known
  product.
- `PATCH /api/products/[id]/shelf-life` as Manager → values updated in Odoo,
  response reflects new values.
- `PATCH` as Staff → 403, no Odoo write happens.
- `PATCH` with negative number, non-integer, or value > 999 → 400, no Odoo
  write happens.

### Portal BOM editor

- Card renders for a BOM with both values set; values shown.
- Card renders for a BOM with `0`/`0`; both inputs blank, hint visible under
  each.
- Manager edits one value, hits Save → toast appears, value persists across
  reload, Odoo product reflects the change.
- Staff sees read-only values; Save button is hidden or disabled.
- Smartphone layout: inputs stack vertically, no horizontal scroll.
- Tablet/desktop layout: inputs side by side.

### Portal package/label flow

- BOM with both values set: toggle defaults to Chilled, expiry = today + 5
  days, switching to Frozen recomputes to today + 90 days, switching back
  recomputes again.
- BOM with chilled=0, frozen=90: Chilled pill shows `— days`, selecting it
  leaves expiry rows blank; Frozen pill shows `90 days`, selecting it fills
  rows with today + 90.
- BOM with both = 0: both pills show `— days`, all expiry rows blank,
  operator can type expiry manually, label still prints (with blank `EXP:` if
  not typed).
- Confirming a split persists `storage_mode` in SQLite. Reload the screen
  → mode is restored, label preview matches.
- Reprint an existing split that was created before the migration (NULL
  storage_mode): label preview defaults to chilled framing, no crash.
- ZPL output: `STORE: CHILLED` and `EXP: 04 May 2026` lines render; blank
  expiry case produces a label with `EXP:` and no date, no malformed ZPL.
- Print a label end-to-end on a Zebra printer in the WAJ kitchen, verify the
  printed sticker shows the storage line and correct date.

---

## Open questions

None. All Q1-Q5 decisions captured above; the revised Q4 rule (no blocking)
is reflected in Component 4 and the rollout plan.
