# Termination Document UX Consolidation

**Date:** 2026-04-01
**Module:** Termination (Krawings Portal — Odoo 18 EE)
**Status:** Approved

---

## Problem

The termination detail page (`TermDetail.tsx`) displays three document upload sections using three different widget patterns:

1. **Courier confirmation** — uses `DocumentUploadWidget` (shared component with View/Replace/Delete)
2. **Generated Kündigung PDF** — custom inline "View PDF" / "Print" buttons (no shared widget)
3. **Signed document** — uses `FilePicker` (a third pattern with just Replace, different layout)

Additional issues:
- `PdfViewer` has pinch-to-zoom code that doesn't work in practice (blocked by CSS `touch-action`)
- Employee PLZ is stored on the record but not displayed — user needs it to look up delivery confirmation on Deutsche Post website

## Solution

### 1. Unified Kündigung Document Container (`KuendigungDocWidget`)

A new termination-specific component that merges the "View PDF / Print" section and the "Signed document" section into a single evolving container.

**Two states:**

#### State A — Unsigned (PDF generated, not yet signed)

Visually: a card showing the generated Kündigung with three actions.

```
┌─────────────────────────────────────────────┐
│  📄  Kündigung                               │
│  Generated — not yet signed                  │
│                                              │
│  [ View ]  [ Print ]  [ Upload Signed ↑ ]   │
└─────────────────────────────────────────────┘
```

- **View** — opens PdfViewer with the unsigned PDF (fetches from `/api/termination/[id]/pdf`)
- **Print** — opens PDF in new window and triggers print dialog
- **Upload Signed** — triggers file picker (`accept="image/*,.pdf"`). On upload, calls `/api/termination/[id]/upload-signed` which:
  1. Creates `ir.attachment` for the signed file
  2. Writes `signed_pdf_attachment_id` on the record
  3. Deletes the unsigned `pdf_attachment_id` attachment
  4. Sets `pdf_attachment_id = False` on the record
  5. Returns the updated record

This transitions the widget to State B.

#### State B — Signed (signed version uploaded)

Visually: matches DocumentUploadWidget "uploaded" state — green card with View/Replace.

```
┌─────────────────────────────────────────────┐
│  ✅  Kündigung (signed)                      │
│  Kuendigung_unterschrieben_NAME.pdf          │
│                                              │
│           [ View ]  [ Replace ]              │
└─────────────────────────────────────────────┘
```

- **View** — opens PdfViewer with the signed PDF (fetches signed attachment data from `/api/termination/[id]/upload-signed` GET endpoint)
- **Replace** — triggers file picker, uploads new signed file (replaces the previous signed attachment)
- No delete — the Kündigung document must always exist once generated

**Conditions:**
- Widget only renders when `rec.pdf_attachment_id || rec.signed_pdf_attachment_id` is truthy (i.e., at least one PDF exists)
- Widget does NOT render in `draft` or `cancelled` states

**Props:**

```typescript
interface KuendigungDocWidgetProps {
  terminationId: number;
  employeeName: string;
  hasPdf: boolean;            // !!rec.pdf_attachment_id
  hasSignedPdf: boolean;      // !!rec.signed_pdf_attachment_id
  signedPdfName?: string;     // rec.signed_pdf_attachment_id?.[1]
  onRecordUpdate: (rec: TerminationRecord) => void;  // callback to update parent state
}
```

### 2. Fix PdfViewer Pinch-to-Zoom

**Root cause:** The canvas element has `style={{ touchAction: 'pan-x pan-y' }}` which tells the browser to handle panning natively and suppresses multi-touch gesture events. This prevents the JavaScript pinch handlers from receiving two-finger touch events.

**Fix:**
- Change canvas `touchAction` to `'none'` so all touch events are handled by JavaScript
- Implement manual single-finger panning (since the browser no longer handles it)
- Keep the existing pinch-to-zoom logic (gesturechange for Safari, touchstart/touchmove for Android)
- Add momentum/inertia scrolling for smooth single-finger pan
- Alternative simpler approach: use `touch-action: manipulation` and handle zoom via gesture events only, letting the browser handle single-finger scroll. Test on iOS Safari and Android Chrome to find working combination.

**Test matrix:**
- iOS Safari: gesturestart/gesturechange/gestureend events
- Android Chrome: two-finger touchstart/touchmove with distance calculation
- Desktop: mouse wheel zoom (optional, not required)

### 3. Postal Code (PLZ) with Click-to-Copy

Display `employee_zip` inside the Delivery card, positioned next to the courier confirmation `DocumentUploadWidget`.

**Layout:**

```
┌─ Delivery ──────────────────────────────────┐
│  Method         Einwurf-Einschreiben        │
│  Date           30.03.2026                  │
│  Tracking #     A0 05DD ... 0170 🔗 ✏️      │
│  Confirmed      Pending                     │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  📄 Courier confirmation   [View][…] │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  PLZ: 10115  📋                              │
│  ↑ tap to copy                              │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Display: `PLZ: {employee_zip}` with a clipboard icon
- Tap: copies `employee_zip` to clipboard via `navigator.clipboard.writeText()`
- Feedback: briefly show "Copied!" text (1.5s) replacing the clipboard icon, then revert
- Styling: small caption text (`text-[12px]`), gray, with the PLZ value in semibold

**Why next to courier confirmation:** The user needs the PLZ to look up the delivery confirmation letter on Deutsche Post's website. Having it right there avoids navigating away to find the address.

### 4. Backend API Change — Upload Signed Deletes Unsigned

**File:** `app/api/termination/[id]/upload-signed/route.ts`

**Current behavior:** POST creates signed attachment and sets `signed_pdf_attachment_id`. Does NOT touch `pdf_attachment_id`.

**New behavior:** POST does the above AND:
1. Reads current `pdf_attachment_id` from the record
2. If it exists, deletes that `ir.attachment` via Odoo RPC (`unlink`)
3. Sets `pdf_attachment_id = False` on the record
4. Returns the updated record with `pdf_attachment_id: false` and `signed_pdf_attachment_id: [id, name]`

This ensures only one version of the Kündigung exists at a time.

### 5. Courier Confirmation — No Changes

Already uses `DocumentUploadWidget` correctly. No modifications needed.

---

## Files to Change

| File | Action | Description |
|------|--------|-------------|
| `src/components/termination/KuendigungDocWidget.tsx` | **Create** | Two-state document widget (unsigned → signed) |
| `src/components/termination/TermDetail.tsx` | **Modify** | Replace "View PDF/Print" + "Signed document" sections with KuendigungDocWidget. Add PLZ display with copy-to-clipboard in Delivery card. Remove FilePicker import. |
| `src/components/ui/PdfViewer.tsx` | **Modify** | Fix pinch-to-zoom by changing touch-action CSS and verifying gesture handlers work on real devices |
| `src/app/api/termination/[id]/upload-signed/route.ts` | **Modify** | Delete unsigned PDF attachment when signed version is uploaded |

## Files NOT Changed

- `DocumentUploadWidget.tsx` — no changes needed
- `FilePicker.tsx` — no changes (will no longer be imported by TermDetail)
- Backend Odoo model (`kw_termination.py`) — no field changes needed
- Types (`types/termination.ts`) — no changes needed (`employee_zip` already defined)

## Risk Level

**Low**
- UI-only changes in the portal frontend
- One backend API tweak (upload-signed route)
- All changes scoped to termination module
- Easy to revert (single git revert)

## Reusability Decision

- `KuendigungDocWidget` — **termination-specific**, stays in `components/termination/`
- `PdfViewer` fix — **shared benefit**, all modules using PdfViewer get working zoom
- PLZ copy pattern — inline in TermDetail for now; extract to shared component only if needed elsewhere

## Testing

1. Generate a Kündigung PDF → verify View and Print work in the unified widget
2. Upload signed PDF → verify unsigned is deleted, widget transitions to signed state
3. View signed PDF → verify PdfViewer opens with pinch-to-zoom working
4. Replace signed PDF → verify old signed attachment is replaced
5. Tap PLZ → verify clipboard contains the postal code, "Copied!" feedback appears
6. Test PdfViewer zoom on iOS Safari and Android Chrome
7. Verify courier confirmation DocumentUploadWidget still works unchanged

## Rollback

```bash
git revert <commit_hash>
# Redeploy
```
