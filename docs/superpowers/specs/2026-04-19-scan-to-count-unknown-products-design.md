# Scan-to-Count: Create Draft Products from Unknown Barcodes

**Date:** 2026-04-19
**Module:** Inventory (portal)
**Status:** Approved design

## Problem

Staff walking around storage with a Bluetooth barcode scanner hit unknown
barcodes frequently — items that exist physically but aren't yet in Odoo, or
exist in Odoo without a barcode assigned. Today the "unknown barcode" state is
a dead end: staff sees a red message and can't capture the count. Either they
skip the item, or they stop walking and go find a manager.

We want staff to be able to record a count for *any* item they scan, with a
minimal on-the-fly product creation step, while keeping a manager-reviewed
quality gate before the product becomes real in Odoo.

## Goals

- Staff can scan any barcode — known or unknown — and record a qty
- Unknown barcode → one text field ("What is this?") + qty → continues the walk
- Managers approve or correct everything in one review queue (existing
  ReviewSubmissions screen)
- No pollution of the live Odoo product catalog before manager approval
- No new Odoo module required — uses standard `active` field

## Non-goals (v1)

- Photo capture of scanned items
- Offline scan queuing (walk-in freezer / bad signal)
- Auto-printing a Zebra label when a new product is approved
- Push/email notification to manager when a submission arrives
- Automatic cleanup of never-reviewed draft products (nightly cron)

These are deferred; the core loop ships first.

## User Flows

### Staff walk-around

1. Open Quick Count → pick location (existing behavior)
2. BT scanner paired in HID mode → scans fire `useHardwareScanner`
3. **Known barcode** → existing flow: qty prompt → confirm → next scan
4. **Unknown barcode** → new bottom sheet:
   - Barcode (read-only display)
   - Name (text, autofocus, min 2 chars)
   - Qty (stepper, default 1)
   - "Create and count" → creates draft product → records count → sheet
     closes → scanner ready for next scan
5. Submit batch at end → goes to manager review queue

### Manager review

1. Open ReviewSubmissions (existing screen)
2. Count lines backed by a draft product show an amber "Pending product" pill
3. Tap a pending row → inline panel with three actions:
   - **Confirm as new** — edit name, pick category, pick UOM, approve →
     product goes `active=True` in Odoo
   - **Link to existing** — searchable picker → pick existing Odoo product →
     barcode gets attached to that product → count line reassigned
   - **Reject** — drops the count line, draft stays archived
4. Bottom "Approve submission" button is disabled until all pending-product
   rows are resolved (confirmed / linked / rejected)

### Dedupe during a walk-around

- Staff A scans unknown barcode → creates draft product 1234 (`active=False`)
- Staff B scans same barcode minutes later → `barcode-lookup` finds 1234
  with `is_draft: true` → scanner shows the "found" card (name + qty
  stepper + Confirm) with a small amber "Pending review" badge → staff B
  adds to the count of the same draft product
- Manager sees one pending row, not two

## Architecture

### New API routes

- `POST /api/inventory/products`
  - Body: `{ barcode, name, qty, session_id? }`
  - Creates `product.product` in Odoo with `active=False`, default `categ_id`
    and `uom_id` resolved at runtime (see below), `type='consu'`, `barcode`,
    `name`
  - Returns the created product for immediate `onCount` use
  - Auth: staff+

- `POST /api/inventory/products/[id]/approve`
  - Body: `{ name, categ_id, uom_id }`
  - Validates ids exist in Odoo
  - Writes the three fields and sets `active=True`
  - Auth: manager+

- `POST /api/inventory/products/[id]/link`
  - Body: `{ target_product_id }`
  - Reassigns the barcode from the draft to the target product (after
    checking the target has no conflicting barcode — reuse existing 409
    logic from `barcode-lookup`)
  - Reassigns any pending count lines (SQLite) pointing to the draft → point
    to target
  - Draft stays `active=False` (effectively dead)
  - Auth: manager+

- `POST /api/inventory/products/[id]/reject`
  - Drops count lines referencing the draft (SQLite)
  - Draft stays `active=False`
  - Auth: manager+

### Changed API routes

- `GET /api/inventory/barcode-lookup`
  - Today filters `active=True` implicitly via Odoo's default. Remove that
    filter so inactive drafts are findable → enables the dedupe flow.
  - Response: add `is_draft: boolean` so UI can show "Pending" state.

- `POST /api/inventory/quick-count`
  - No change. Draft products have real Odoo IDs, so count lines reference
    them like any other product.

### SQLite schema

Add a column to the existing counts staging table
(see `src/lib/inventory-db.ts`):

```
is_draft_product INTEGER NOT NULL DEFAULT 0
```

Set to 1 when a count line references a draft product. Review UI uses this to
flag rows. Cleared when the product is approved or linked.

No separate `pending_products` table — Odoo is source of truth for the product
itself. SQLite just tracks "this count line is waiting on product resolution".

### Odoo defaults

When creating a draft product we need valid `categ_id` and `uom_id`. Resolved
at runtime:

- Category: `product.category` with `name='All'` (always present in Odoo)
- UOM: `uom.uom` with `name='Units'` (always present in Odoo)

Results cached for the process lifetime. If either is missing, API returns 500
with message `"Default category/UOM not found — configure in Odoo"`. Fail-fast.

### Role enforcement

- All Odoo RPC goes through the admin service account (uid=2) — no Odoo ACL
  changes needed
- Role checks happen in the API route handlers, reading the session via
  `requireAuth()` + `user.role`

## UI components

### New

- `UnknownBarcodeSheet` — bottom sheet inside the existing `BarcodeScanner`
  overlay. Replaces the current dead-end unknown-barcode panel for staff.
  Fields: barcode (readonly), name (text), qty (stepper). Primary action
  "Create and count". If the component stays small (<120 lines), keep it
  inline in `BarcodeScanner.tsx`. Otherwise split.

### Modified

- `BarcodeScanner.tsx` — render `UnknownBarcodeSheet` on
  `scanResult.kind === 'unknown'`. Update local `productsRef` after creation
  so immediate rescans match.
- `ReviewSubmissions.tsx` — amber "Pending product" pill; inline three-button
  action panel (confirm-as-new / link-to-existing / reject); disable submit
  until all pending rows resolved.
- `inventory-db.ts` — new column + migration + read/write helpers.
- `barcode-lookup/route.ts` — include inactive products, return `is_draft`.

### Unchanged

- `useHardwareScanner.ts` — already handles BT HID scanners correctly.
- `QuickCount.tsx` — no direct changes; it already routes unknown scans into
  the BarcodeScanner overlay.

## Edge cases

- **Manager approves but chosen `categ_id` / `uom_id` no longer exists** —
  server validates, returns 400. Dropdowns prevent in practice.
- **Link target already has a different barcode** — reject with 409; manager
  picks a different option.
- **Draft product never reviewed** — stays `active=False` forever. Harmless
  clutter. Cron cleanup deferred.
- **Odoo 18 product.product vs product.template `active`** — test during
  implementation. If write on `product.product.active` doesn't propagate to
  template, set both.
- **Same-barcode rescan during a walk** — covered by `barcode-lookup`
  including inactive products.

## Testing

- Manual happy path: staff scans unknown → creates → submits → manager
  approves → product live in Odoo
- Manual link: manager sees pending → links to existing → barcode attached →
  count applies to target
- Manual reject: manager rejects → draft stays inactive → count line dropped
- Manual dedupe: two staff scan same unknown barcode in sequence → second
  sees pending state → both counts roll up to the same draft
- Light API tests (one per route): auth rejected, happy path works

## Files touched

Modified:
- `src/components/ui/BarcodeScanner.tsx`
- `src/components/inventory/ReviewSubmissions.tsx`
- `src/lib/inventory-db.ts`
- `src/app/api/inventory/barcode-lookup/route.ts`

New:
- `src/app/api/inventory/products/route.ts`
- `src/app/api/inventory/products/[id]/approve/route.ts`
- `src/app/api/inventory/products/[id]/link/route.ts`
- `src/app/api/inventory/products/[id]/reject/route.ts`
- (Optional) `src/components/ui/UnknownBarcodeSheet.tsx` if it grows past
  ~120 lines

Unchanged:
- `src/hooks/useHardwareScanner.ts`
- `src/components/inventory/QuickCount.tsx`
- `src/app/api/inventory/quick-count/route.ts`
