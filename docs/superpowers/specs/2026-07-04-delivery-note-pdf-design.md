---
date: 2026-07-04
topic: Purchase — delivery-note photo → PDF, staff-submit / manager-approve receiving
status: design (awaiting review)
repo: erxu168/Odoo_Portal_18EE
environment: staging only (89.167.124.0) until Ethan says prod
---

# Purchase receiving: photograph the delivery note → PDF, staff submits / manager approves

## Goal (plain English)

When a delivery arrives, staff record what came in, photograph the paper delivery
note, and the app saves that photo as a **PDF on the order**. A manager then reviews
and approves, which is when stock actually updates in Odoo and the order closes.

**No OCR, no Azure, no cost.** We are *not* reading the words off the note — we are
just keeping a copy of it as a record.

## Decisions locked (from brainstorming, 2026-07-04)

1. **No OCR / no Azure.** Delete the scan button and the OCR code. The delivery note
   is a stored document, not a data source.
2. **Keep the per-item check.** Staff still enter the received quantity for each line
   and can flag issues (short / damaged). This is the existing `ReceiveCheckScreen`
   behavior — kept, not removed.
3. **No "Received in full" one-tap shortcut.** Staff enter each line individually so a
   delivery cannot be rubber-stamped.
4. **Staff submit, manager approves.** Staff fill the check + attach the delivery-note
   PDF + tap "Submit for approval." A manager reviews (including viewing the PDF) and
   approves. Stock moves only on manager approval.
5. **Photo → PDF, multi-page.** Staff can take more than one photo (e.g. a 2-page note);
   the photos are combined into a single PDF.

## User flow

### Staff (delivery arrives)
1. Open the delivered order → **"Delivery arrived."**
2. Enter received quantity per line (existing steppers / numpad); flag any short or
   damaged line (existing issue reporting).
3. **"Add delivery note"** → camera → snap 1+ photos → thumbnails shown, can remove/retake.
4. **"Submit for approval."** Confirmation prompt (irreversible-action rule). Order now
   shows *"Received — waiting for manager."*

### Manager (later)
5. **"To approve"** list shows submitted receipts. Open one → see the quantities staff
   entered + any issues + a **View delivery note (PDF)** button.
6. **Approve** → keep existing **"Confirm & close"** vs **"Keep as backorder"** choice.
   This runs the current Odoo stock sync and closes the order.

## Architecture / what changes

Everything reuses parts already running in the portal. No new dependencies, no new
services.

### Remove (OCR)
- `src/lib/ocr.ts` — delete.
- `src/app/api/purchase/receive/scan/route.ts` — delete.
- `ReceiveCheckScreen.tsx` — remove the manager-only "Scan delivery note" button, the
  `scanResult` panel, and all OCR props (`scanning`, `scanResult`, `scanErr`,
  `onScanFile`, `onDismissScan`). Remove the matching state/handlers in `page.tsx`.
  *(All git-revertible; files stay in history.)*

### Add (photo → PDF)
- New helper `src/lib/purchase-note-pdf.ts` exporting
  `imagesToPdf(dataUrls: string[]): Promise<Buffer>` — builds a one-image-per-page A4
  HTML doc (`<img>` full-bleed, CSS `page-break-after`) and runs it through the
  **existing** `htmlToPdf()` in `src/lib/pdf-generator.ts` (Puppeteer, wkhtmltopdf
  fallback — already used by the termination flow).
- Staff-facing capture UI in `ReceiveCheckScreen.tsx` using existing
  `DocumentUploadWidget` / `FilePicker` (`accept="image/*"`, camera capture, multiple).
  Orange brand styling per DESIGN_GUIDE (the old scan button was off-brand blue).

### Add (staff-submit / manager-approve split)
- **Receipt status gains a middle state:** `pending` → **`submitted`** → `confirmed`.
  - `pending`: receipt created, staff filling it in (today's start state).
  - `submitted`: staff finished + attached the note PDF; awaiting manager. (NEW)
  - `confirmed`: manager approved; Odoo stock synced; order closed (today's end state).
- **New `action: 'submit'`** on `POST /api/purchase/receive` — **staff-allowed**.
  Body: filled lines + array of photo data URLs. Server: builds the PDF, stores it,
  attaches the PDF to the Odoo purchase.order as an `ir.attachment`
  (`mimetype: application/pdf`), sets receipt status `submitted`. Does **NOT** touch stock.
  **No new order-status value:** the "received / awaiting manager" state is derived from
  the latest receipt being `submitted` — `getOrder()` already surfaces `receipt_status`
  on the order, so the staff/manager UIs read that. The manager's "To approve" queue =
  orders whose latest receipt status is `submitted`.
- **`action: 'confirm'`** stays **manager-only** and keeps its current behavior (Odoo
  stock write via `stock.quant.inventory_quantity` + `action_apply_inventory`, log note,
  close/backorder). It just now transitions from `submitted` instead of `pending`.
- **Storage of the PDF:** add a new `purchase_receipts.delivery_note_pdf TEXT` column
  (leave the old `delivery_note_photo` column untouched/unused) and store the generated
  PDF there as a base64 data URL. The Odoo attachment is the durable copy; the stored
  base64 lets the manager's approval screen render it via the existing `PdfViewer`
  without a round-trip.

### Data model
- `purchase_receipts.status`: add `'submitted'` as a valid value (string column, no
  migration needed — additive).
- `purchase_receipts`: add `submitted_by INTEGER`, `submitted_at TEXT` (via the existing
  `ALTER TABLE ... try/catch` idempotent-migration pattern in `purchase-db.ts`).
- Column for the PDF as above.

## Roles (enforced in UI *and* API)
- Staff: create receipt, enter lines, flag issues, attach note, **submit**. Cannot confirm.
- Manager: everything staff can do, plus **approve/confirm** (stock + close). The
  `confirm` action keeps its `hasRole(user, 'manager')` 403 guard.

## Error handling
- **PDF build fails:** don't lose the submission or the photos. Fall back to attaching
  the raw images to Odoo, log the error, still mark `submitted`. Never block receiving on
  PDF generation.
- **Image too large:** existing ~11MB/photo cap stays; also cap total combined payload.
- **Odoo down at approval:** existing behavior kept — `confirm` refuses (502) and does
  not mark confirmed if stock writes fail. Unchanged.

## Testing (Playwright on staging — required before "done")
Real browser, staging portal, test accounts:
1. **Hana Kim (staff)** → open a sent order → enter quantities (leave one short) → flag one
   issue → attach a 2-page delivery note (two photos) → submit → confirmation prompt →
   order shows "waiting for manager."
2. Verify a single **multi-page PDF** was produced and is viewable.
3. **Marco Bauer (manager)** → "To approve" → open → view the PDF → see the short line +
   issue → Approve (Confirm & close).
4. Verify in Odoo: the **PDF** (not a JPG) is attached to the purchase.order and stock
   moved for the received lines.
5. Negative: staff cannot see/hit approve; oversized photo rejected cleanly.

## Rollback
Pure git revert. The new `'submitted'` status and added columns are additive and
harmless if the code is reverted. No production touched.

## Out of scope (explicitly)
- Reading/parsing the note contents (OCR) — removed on purpose.
- Any change to how orders are created/sent.
- Production deploy — staging only until Ethan approves.
