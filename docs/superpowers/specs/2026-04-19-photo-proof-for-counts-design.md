# Photo Proof for Counts

**Date:** 2026-04-19
**Module:** Inventory (portal)
**Status:** Approved design

## Problem

Some products need visual verification during counting — partial-volume
bottles (whisky, wine), items where quantity is ambiguous without seeing
the state, or anything the manager wants to spot-check remotely. Staff
can already enter a qty, but there's no way to attach photographic proof
to a specific count line. The existing session-level `proof_photo` is one
photo per entire session, not per product.

## Goals

- Manager can flag specific products as "requires photo when counting"
- Staff counting a flagged product must attach 1–3 photos before submit
- Manager sees thumbnails inline during review; tap for fullscreen
- Works in both Quick Count and scheduled counting sessions
- No Odoo changes — flag lives in portal SQLite

## Non-goals (v1)

- AI volume/quantity estimation (deferred, separate feature)
- Photo requirement by category or template — only per-product flag
- Photo requirement on approval workflow itself (manager doesn't need
  to attach photos when approving)
- Photo editing (crop, annotate) — take it, keep it, or retake it
- Offline capture — same deferral as the main counting flow

## User flows

### Manager configures

1. Open **Inventory → Product settings** (new screen, manager+ only)
2. Search/filter non-POS products
3. Tap a product row → toggle "Requires photo" on/off
4. Setting is saved immediately (optimistic UI + server write)

### Staff counts a flagged product

1. Open Quick Count (or an assigned counting session)
2. On a flagged product row, a camera icon + "Photo required" label is
   visible next to the qty stepper
3. Enter qty (as usual)
4. Tap the camera icon → device camera opens → capture photo
5. Thumbnail appears on the row with a × delete button and a "+" add
   button (disabled after 3 photos attached)
6. Repeat for additional photos (up to 3)
7. Submit is blocked while any flagged line has `qty > 0` and zero
   photos. Attempted submit shows: *"3 items still need a photo."*

### Manager reviews

1. Open ReviewSubmissions → tap a submitted session / quick count
2. On count rows that had photos, a small thumbnail strip appears next
   to the qty (up to 3 images, ~32px tall)
3. Tap any thumbnail → fullscreen viewer with swipe between photos +
   pinch-to-zoom + close button
4. Rest of review flow unchanged (approve / reject / resolve drafts)

## Architecture

### Data model (SQLite)

New table `product_flags`:

```sql
CREATE TABLE product_flags (
  odoo_product_id INTEGER PRIMARY KEY,
  requires_photo  INTEGER NOT NULL DEFAULT 0,
  updated_by      INTEGER,
  updated_at      TEXT
);
```

One row per flagged product. Absent row = no flags set (all false). Keeps
the table small (only products that ever had a flag touched).

New table `count_photos`:

```sql
CREATE TABLE count_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_table TEXT NOT NULL,      -- 'count_entries' or 'quick_counts'
  source_id    INTEGER NOT NULL,   -- the row id in that table
  photo        TEXT NOT NULL,      -- base64 dataURL, JPEG 0.7 quality
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_count_photos_source ON count_photos(source_table, source_id);
```

Polymorphic link — a single table serves both submission types. Lookup
by `(source_table, source_id)` returns all photos for a line.

Cleanup: when a draft product is rejected (existing
`deleteCountsForProduct`), also delete its `count_photos` rows.
Same for count line deletes.

### API

**New routes:**
- `GET /api/inventory/product-flags`
  - Returns `{ flags: [{ odoo_product_id, requires_photo, updated_at }] }`
  - Also accepts `?ids=1,2,3` to fetch a subset
  - Auth: all users (staff needs to know what flags exist so the UI
    can show the camera icon while counting)

- `PUT /api/inventory/product-flags/[product_id]`
  - Body: `{ requires_photo: boolean }`
  - Upserts the row with the caller's user id
  - Auth: manager+

**Changed routes:**
- `POST /api/inventory/quick-count`
  - Body entries now accept optional `photos: string[]` (dataURLs)
  - Server persists to `count_photos` with `source_table='quick_counts'`
    after inserting each quick_counts row
  - Validates: if the product is flagged and `counted_qty > 0`, at least
    1 photo must be present; otherwise 400

- `POST /api/inventory/counts` (the endpoint that saves count_entries)
  - Same shape: entries accept optional `photos: string[]`
  - Same validation rule
  - Writes to `count_photos` with `source_table='count_entries'`

- `GET /api/inventory/counts?session_id=` (used by ReviewSubmissions)
  - Each returned entry now includes a `photos` array of dataURLs

- `GET /api/inventory/quick-count?status=` (for review of quick counts)
  - Each returned quick-count row includes a `photos` array

### UI components

**New:**
- `src/app/inventory/product-settings/page.tsx` — manager screen, list
  of products with toggle for `requires_photo`. Uses existing products
  GET + new product-flags GET, PUT on toggle.
- `src/components/inventory/PhotoCaptureStrip.tsx` — reusable row
  component: shows current thumbnails (up to 3) + camera button + "+"
  to add. Owns the `photos: string[]` state, emits onChange.
- `src/components/inventory/PhotoLightbox.tsx` — fullscreen viewer with
  swipe between photos, pinch-to-zoom, close button. Opens from a
  thumbnail tap in ReviewSubmissions.

**Modified:**
- `src/components/inventory/QuickCount.tsx` — for flagged products,
  render `PhotoCaptureStrip`. Block submit if any flagged line with
  `qty > 0` has zero photos. Pass photos array in the submit body.
- `src/components/inventory/CountingSession.tsx` — same changes.
- `src/components/inventory/ReviewSubmissions.tsx` — render thumbnail
  strip on count rows that have photos; tap → open `PhotoLightbox`.
- `src/components/inventory/InventoryDashboard.tsx` — add a "Product
  settings" tile, manager+ only.
- `src/lib/inventory-db.ts` — add schema + CRUD helpers:
  - `getProductFlags(ids?: number[])`
  - `setProductFlag(productId, requiresPhoto, userId)`
  - `addCountPhotos(sourceTable, sourceId, photos[])`
  - `getPhotosForSource(sourceTable, sourceId[])`
  - Extend `deleteCountsForProduct` to also delete linked photos

### Image capture mechanics

Reuse the existing camera pattern from `CountingSession.tsx`:
- `<input type="file" accept="image/*" capture="environment">`
- On change → draw to canvas → `canvas.toDataURL('image/jpeg', 0.7)`
- Target: ≤100 KB per photo after compression (720p or similar)

Not reusing `html5-qrcode` — that's for barcode video stream, not
still capture.

### Permissions / role model

- **Staff**: sees the camera UI on flagged products; can attach/retake
  photos on their own counts; cannot toggle flags
- **Manager+**: everything staff can do + toggle flags + view photos
  during review

Enforced at API level in the PUT endpoint and on the Product settings
page render guard.

## Edge cases

- **Flagged product counted with qty = 0** — no photo required. Rationale:
  "I checked and there's none" doesn't need a photo.
- **Staff attaches photo to non-flagged product** — allowed. Stored the
  same way, manager sees the thumbnails during review. Bonus proof.
- **Submit with qty > 0 and zero photos on flagged line** — 400 from
  server with clear error. Client side should already have blocked but
  server is the enforcement point.
- **Draft product + photo** — draft products can also be flagged after
  creation. Photos stay attached through link/approve/reject. Reject
  deletes the photo along with the count line.
- **Photo storage bloat** — 3 photos × 100 KB × 50 count lines = 15 MB
  per big submission. Acceptable. If it becomes a problem, migrate to
  disk files with a background compress later.
- **Retake after submission** — not supported in v1. Once submitted,
  photos are read-only. Staff would need a recount.

## Testing

- Manual: manager flags a product → staff counts it → can't submit
  without photo → adds photo → submits → manager sees thumbnail →
  taps → fullscreen works
- Manual: non-flagged product count still submits with no photo
- Manual: staff deletes and retakes photo before submit
- Manual: unflag a product → staff can submit without photo
- Manual: reject a draft product with photos → photos removed from DB

## Files touched

**New:**
- `src/app/api/inventory/product-flags/route.ts`
- `src/app/api/inventory/product-flags/[product_id]/route.ts`
- `src/app/inventory/product-settings/page.tsx` (or a screen in the
  existing inventory page.tsx router)
- `src/components/inventory/ProductSettings.tsx`
- `src/components/inventory/PhotoCaptureStrip.tsx`
- `src/components/inventory/PhotoLightbox.tsx`

**Modified:**
- `src/lib/inventory-db.ts` — schema + helpers
- `src/components/inventory/QuickCount.tsx`
- `src/components/inventory/CountingSession.tsx`
- `src/components/inventory/ReviewSubmissions.tsx`
- `src/components/inventory/InventoryDashboard.tsx`
- `src/app/inventory/page.tsx` — new screen route
- `src/app/api/inventory/quick-count/route.ts`
- `src/app/api/inventory/counts/route.ts` (and its corresponding
  endpoint for fetching entries)
