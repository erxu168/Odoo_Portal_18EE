# Delivery-Note Photo → PDF Receiving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a delivery arrives, staff enter received quantities per line, photograph the paper delivery note (1+ pages) which the app saves as a single PDF on the order, and submit for a manager to approve — approval is when Odoo stock updates and the order closes. No OCR, no Azure.

**Architecture:** Reuse the existing purchase receive flow (`ReceiveCheckScreen`, `purchase_receipts` SQLite table, receive API route). Add a pure image→PDF helper on top of the existing `htmlToPdf()` (Puppeteer/wkhtmltopdf). Introduce a middle receipt status `submitted` between `pending` and `confirmed`, a staff-allowed `submit` API action that builds+stores+attaches the PDF, and manager-only approval that reuses today's confirm/stock-sync. Remove the OCR scan button, `ocr.ts`, and the scan route.

**Tech Stack:** Next.js 14 (App Router), TypeScript, better-sqlite3, Puppeteer (installed), pdfjs-dist (installed), Playwright (`@playwright/test`) for e2e. Odoo 18 EE via `src/lib/odoo.ts`.

## Global Constraints

- **Branch:** `main` only. `git checkout main && git pull --ff-only` before starting; confirm `git branch --show-current` == `main`. No side branches unless the user asks.
- **Staging only.** Never touch production (`staff.krawings.de` / `128.140.12.188`). Deploy target is staging `89.167.124.0` / `portal.krawings.de`.
- **Never edit source on the server.** All code via GitHub; server pulls.
- **Build is the gate.** Run `npm run build` (do NOT pipe it — masks exit code, CLAUDE.md pitfall #11). It must exit 0 before commit.
- **Roles enforced in UI *and* API.** Staff < Manager < Admin. Manager-invisible actions fully hidden. `confirm` stays manager-only (`hasRole(user,'manager')` → 403).
- **Odoo write path stays base UoM.** Stock writes only on manager approval; unchanged from today.
- **TS/build pitfalls:** Odoo dates use a space not `T`; `toISOString()` is UTC (fine for filenames, not for display); `better-sqlite3` not `sqlite3`; no set spread `[...s]` → `Array.from()`; `prefer-const` + unused params block build (`_prefix` or remove); JSX apostrophes → `’`; catch `err: unknown` + `instanceof`, never `any`.
- **Confirmation prompt before any irreversible action** (submit for approval; approve). Reuse the existing `ConfirmDialog`.
- **PascalCase component filenames; shared UI in `src/components/ui/` — reuse before building new.**

---

### Task 1: Image → PDF helper (pure builder + PDF generator), unit-tested

**Files:**
- Create: `src/lib/purchase-note-pdf.ts`
- Modify: `playwright.config.ts` (add a `unit` project so pure-function tests can run)
- Test: `tests/purchase-note-pdf.unit.spec.ts`

**Interfaces:**
- Consumes: `htmlToPdf(html: string, outPath: string): Promise<void>` from `src/lib/pdf-generator.ts` (existing).
- Produces:
  - `buildImagesHtml(dataUrls: string[]): string` — pure, no I/O.
  - `imagesToPdf(dataUrls: string[]): Promise<Buffer>` — combined multi-page PDF.

- [ ] **Step 1: Add a `unit` project to Playwright config**

Modify `playwright.config.ts` — add this object to the `projects` array (after the existing `modules` project):

```ts
    {
      // Pure-function unit tests (no browser, no baseURL). Run: npm run test:unit
      name: 'unit',
      testMatch: /\.unit\.spec\.ts/,
    },
```

Add a script to `package.json` `scripts`:

```json
    "test:unit": "playwright test --project=unit",
```

- [ ] **Step 2: Write the failing unit test**

Create `tests/purchase-note-pdf.unit.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { buildImagesHtml } from '../src/lib/purchase-note-pdf';

test('buildImagesHtml renders one page per image, in order', () => {
  const html = buildImagesHtml([
    'data:image/png;base64,AAA',
    'data:image/jpeg;base64,BBB',
  ]);
  expect((html.match(/<img /g) || []).length).toBe(2);
  expect(html.indexOf('AAA')).toBeLessThan(html.indexOf('BBB'));
  expect(html).toContain('page-break-after');
});

test('buildImagesHtml handles a single image', () => {
  const html = buildImagesHtml(['data:image/jpeg;base64,ZZZ']);
  expect((html.match(/<img /g) || []).length).toBe(1);
  expect(html).toContain('ZZZ');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx playwright test --project=unit tests/purchase-note-pdf.unit.spec.ts`
Expected: FAIL — cannot resolve `../src/lib/purchase-note-pdf` (module does not exist yet).

- [ ] **Step 4: Implement the helper**

Create `src/lib/purchase-note-pdf.ts`:

```ts
/**
 * Delivery-note PDF helper.
 * Combines 1+ delivery-note photos into a single multi-page PDF for the
 * purchase receive flow. No OCR — the note is stored as a document.
 *
 * buildImagesHtml is pure (unit-testable); imagesToPdf drives the shared
 * htmlToPdf() (Puppeteer, wkhtmltopdf fallback) used elsewhere in the portal.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
// Relative (sibling) import on purpose: keeps the pure buildImagesHtml import
// chain free of the '@/' alias so the unit test resolves without tsconfig paths.
import { htmlToPdf } from './pdf-generator';

/** One full-page image per delivery-note photo. Pure — no I/O. */
export function buildImagesHtml(dataUrls: string[]): string {
  const pages = dataUrls
    .map((src) => `<div class="page"><img src="${src}" /></div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .page { width: 100%; height: 100vh; display: flex; align-items: center;
            justify-content: center; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style></head><body>${pages}</body></html>`;
}

/** Combine image data URLs into a single PDF buffer. */
export async function imagesToPdf(dataUrls: string[]): Promise<Buffer> {
  if (!dataUrls.length) throw new Error('imagesToPdf: no images provided');
  const html = buildImagesHtml(dataUrls);
  const outPath = path.join(
    os.tmpdir(),
    `dnote_${process.pid}_${Date.now()}.pdf`,
  );
  try {
    await htmlToPdf(html, outPath);
    return fs.readFileSync(outPath);
  } finally {
    try { fs.unlinkSync(outPath); } catch { /* best-effort cleanup */ }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test --project=unit tests/purchase-note-pdf.unit.spec.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Build gate**

Run: `npm run build`
Expected: exit 0, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/purchase-note-pdf.ts tests/purchase-note-pdf.unit.spec.ts playwright.config.ts package.json
git commit -m "feat(purchase): add delivery-note image→PDF helper + unit test"
```

---

### Task 2: DB — `submitted` receipt status, PDF/submitter columns, submit + query helpers

**Files:**
- Modify: `src/lib/purchase-db.ts` (idempotent ALTERs near the existing migration block ~line 170; new functions near `confirmReceipt` ~line 591)

**Interfaces:**
- Consumes: existing `db()`, `nowISO()`, `getReceipt(id)`, `getReceiptByOrder(orderId)`.
- Produces:
  - `submitReceipt(receiptId: number, submittedBy: number, pdfDataUrl: string): void` — sets status `submitted`, stamps `submitted_by`/`submitted_at`, stores `delivery_note_pdf`.
  - `getLatestReceiptStatus(orderId: number): string | null`
  - `getReceiptPdf(receiptId: number): string | null`

- [ ] **Step 1: Add idempotent column migrations**

In `src/lib/purchase-db.ts`, next to the existing `ALTER TABLE purchase_receipts ADD COLUMN location_id ...` try/catch block (~line 170), add:

```ts
  try { db().exec('ALTER TABLE purchase_receipts ADD COLUMN delivery_note_pdf TEXT'); } catch (_e) { /* already exists */ }
  try { db().exec('ALTER TABLE purchase_receipts ADD COLUMN submitted_by INTEGER'); } catch (_e) { /* already exists */ }
  try { db().exec('ALTER TABLE purchase_receipts ADD COLUMN submitted_at TEXT'); } catch (_e) { /* already exists */ }
```

- [ ] **Step 2: Add the three functions**

After `confirmReceipt` (~line 596), add:

```ts
/**
 * Staff submits a filled receipt with the delivery-note PDF for manager
 * approval. Moves status pending -> submitted. Does NOT touch stock.
 */
export function submitReceipt(receiptId: number, submittedBy: number, pdfDataUrl: string) {
  const now = nowISO();
  db().prepare(
    "UPDATE purchase_receipts SET status = 'submitted', submitted_by = ?, submitted_at = ?, delivery_note_pdf = ? WHERE id = ?"
  ).run(submittedBy, now, pdfDataUrl, receiptId);
}

/** Latest receipt status for an order, or null if none. Used to bucket the receive list. */
export function getLatestReceiptStatus(orderId: number): string | null {
  const r = db().prepare(
    'SELECT status FROM purchase_receipts WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(orderId) as { status?: string } | undefined;
  return r?.status ?? null;
}

/** The stored delivery-note PDF (data URL) for a receipt, or null. */
export function getReceiptPdf(receiptId: number): string | null {
  const r = db().prepare(
    'SELECT delivery_note_pdf FROM purchase_receipts WHERE id = ?'
  ).get(receiptId) as { delivery_note_pdf?: string } | undefined;
  return r?.delivery_note_pdf ?? null;
}
```

> Note: `nowISO()` already exists in this file (used by `createReceipt`/`insertSupplier`). If the local name differs, match the existing timestamp helper used by `createReceipt`.

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: exit 0. (This also confirms the new functions type-check and the `'submitted'` status string compiles.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/purchase-db.ts
git commit -m "feat(purchase): receipt 'submitted' status + PDF/submitter columns + helpers"
```

---

### Task 3: API — staff `submit` action, PDF fetch, receive-list bucketing

**Files:**
- Modify: `src/app/api/purchase/receive/route.ts`

**Interfaces:**
- Consumes: Task 1 `imagesToPdf`; Task 2 `submitReceipt`, `getLatestReceiptStatus`, `getReceiptPdf`; existing `getReceipt`, `getOrder`, `getOdoo`, `esc`, `MAX_IMAGE_DATA_URL_BYTES`, `requireAuth`.
- Produces (HTTP contract the frontend relies on):
  - `POST { action:'submit', receipt_id:number, photos:string[] }` → `{ message:'Submitted for approval' }` (staff-allowed). 400/404/409/413 on bad input.
  - `GET ?note_pdf=<receiptId>` → `{ pdf: string }` (data URL) or 404.
  - `GET ?location_id=<id>` → `{ pending: Array<order & { receipt_status: string | null }> }`.

- [ ] **Step 1: Add imports**

At the top of `src/app/api/purchase/receive/route.ts`, extend the existing imports:

```ts
import { listOrders, createReceipt, getReceipt, getReceiptByOrder, updateReceiptLine, confirmReceipt, updateReceiptNote, getOrder, submitReceipt, getLatestReceiptStatus, getReceiptPdf } from '@/lib/purchase-db';
import { imagesToPdf } from '@/lib/purchase-note-pdf';
```

(Keep the existing `getUserById`, `getOdoo`, `requireAuth`, `hasRole` imports.)

- [ ] **Step 2: GET — serve the delivery-note PDF**

In `GET`, immediately after the auth check and `const { searchParams } = new URL(request.url);`, add:

```ts
  const notePdfId = searchParams.get('note_pdf');
  if (notePdfId) {
    const pdf = getReceiptPdf(parseInt(notePdfId));
    if (!pdf) return NextResponse.json({ error: 'No delivery note on file' }, { status: 404 });
    return NextResponse.json({ pdf });
  }
```

- [ ] **Step 3: GET — attach `receipt_status` to each pending order**

Replace the pending-list return (currently):

```ts
  const sentOrders = listOrders(locationId, { status: 'sent' });
  const partialOrders = listOrders(locationId, { status: 'partial' });

  return NextResponse.json({ pending: [...sentOrders, ...partialOrders] });
```

with:

```ts
  const sentOrders = listOrders(locationId, { status: 'sent' });
  const partialOrders = listOrders(locationId, { status: 'partial' });
  const pending = [...sentOrders, ...partialOrders].map((o: { id: number } & Record<string, unknown>) => ({
    ...o,
    receipt_status: getLatestReceiptStatus(o.id),
  }));

  return NextResponse.json({ pending });
```

- [ ] **Step 4: POST — add the staff `submit` action**

In `POST`, add this branch BEFORE the `if (action === 'confirm')` block (so staff can hit it without the manager gate):

```ts
  if (action === 'submit') {
    const receiptId = parseInt(body.receipt_id || '0');
    const photos: unknown = body.photos;
    if (!receiptId) return NextResponse.json({ error: 'receipt_id required' }, { status: 400 });
    if (!Array.isArray(photos) || photos.length === 0) {
      return NextResponse.json({ error: 'At least one delivery-note photo is required' }, { status: 400 });
    }
    for (const p of photos) {
      if (typeof p !== 'string' || !p.startsWith('data:image/')) {
        return NextResponse.json({ error: 'Each photo must be an image' }, { status: 400 });
      }
    }
    const totalBytes = (photos as string[]).reduce((s, p) => s + p.length, 0);
    if (totalBytes > MAX_IMAGE_DATA_URL_BYTES * 2) {
      return NextResponse.json({ error: 'Delivery-note photos too large. Use fewer or smaller photos.' }, { status: 413 });
    }

    const existing = getReceipt(receiptId);
    if (!existing) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    if (existing.status === 'confirmed') {
      return NextResponse.json({ error: 'This delivery was already approved' }, { status: 409 });
    }

    // Build the PDF. Never block receiving on PDF generation — fall back to the first photo.
    let pdfDataUrl: string;
    try {
      const pdf = await imagesToPdf(photos as string[]);
      pdfDataUrl = `data:application/pdf;base64,${pdf.toString('base64')}`;
    } catch (e: unknown) {
      console.error('[receive/submit] PDF build failed, keeping first photo as fallback', e);
      pdfDataUrl = (photos as string[])[0];
    }

    submitReceipt(receiptId, user.id, pdfDataUrl);

    // Attach to the Odoo purchase.order (non-fatal).
    const order = getOrder(existing.order_id);
    if (order?.odoo_po_id) {
      try {
        const odoo = getOdoo();
        const isPdf = pdfDataUrl.startsWith('data:application/pdf');
        const base64Data = pdfDataUrl.replace(/^data:[^;]+;base64,/, '');
        const attachmentId = await odoo.create('ir.attachment', {
          name: `Delivery_Note_${order.odoo_po_name || order.id}_${new Date().toISOString().split('T')[0]}.${isPdf ? 'pdf' : 'jpg'}`,
          type: 'binary',
          datas: base64Data,
          res_model: 'purchase.order',
          res_id: order.odoo_po_id,
          mimetype: isPdf ? 'application/pdf' : 'image/jpeg',
        });
        await odoo.call('purchase.order', 'message_post', [[order.odoo_po_id]], {
          body: `<p><strong>Delivery recorded by ${esc(user.name)}</strong> — awaiting manager approval. Delivery note attached.</p>`,
          message_type: 'comment',
          subtype_xmlid: 'mail.mt_note',
          attachment_ids: [attachmentId],
        });
      } catch (e) {
        console.error('[receive/submit] Odoo attach failed', e);
      }
    }

    return NextResponse.json({ message: 'Submitted for approval' });
  }
```

> `confirm` stays exactly as-is (manager-only, stock sync, close). It will now transition an already-`submitted` receipt; its `delivery_note_photo` branch simply won't run because the frontend no longer sends one.

- [ ] **Step 5: Build gate**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/purchase/receive/route.ts
git commit -m "feat(purchase): staff submit action (build+attach delivery-note PDF) + receive-list bucketing"
```

---

### Task 4: Frontend — remove OCR, add staff capture+submit, manager view-PDF + bucketed list

**Files:**
- Delete: `src/lib/ocr.ts`, `src/app/api/purchase/receive/scan/route.ts`
- Modify: `src/components/purchase/ReceiveCheckScreen.tsx`
- Modify: `src/app/purchase/page.tsx`
- Modify: `src/components/purchase/ReceiveListScreen.tsx` (bucket to-receive vs awaiting-approval)

**Read first (zero-context):** `src/app/purchase/page.tsx` lines ~236-264 (receive handlers), ~416-475 (scan state/handler), ~742-758 (ReceiveCheckScreen usage), ~786-789 (receive-list render); `src/components/purchase/ReceiveListScreen.tsx` (whole file — it renders `pendingDeliveries`); `src/components/ui/FilePicker.tsx` (props: `onFile`, `accept`, `variant`, `icon`, `label`, `className`); `src/components/ui/PdfViewer.tsx` (props: `fileData`, `fileName`, `onClose`).

**Interfaces:**
- Consumes: Task 3 HTTP contract (`action:'submit'`, `?note_pdf=`, `receipt_status` on pending).
- Produces: no code interface — this is the UI layer.

- [ ] **Step 1: Delete the OCR files**

```bash
git rm src/lib/ocr.ts src/app/api/purchase/receive/scan/route.ts
```

- [ ] **Step 2: Strip OCR from `ReceiveCheckScreen.tsx`, add capture/submit/approve props**

In `src/components/purchase/ReceiveCheckScreen.tsx`:

1. Delete the `ScanMatched` and `ScanResult` interfaces (lines ~39-53).
2. In `ReceiveCheckScreenProps`, delete the `// OCR scan state` block (`scanning`, `scanResult`, `scanErr`, `onScanFile`, `onDismissScan`) and add:

```ts
  // Delivery note (staff capture) + submit
  isSubmitted: boolean;            // receipt already submitted -> manager approval mode
  deliveryPhotos: string[];        // captured photos (data URLs), capture mode only
  submitting: boolean;
  onAddPhoto: (file: File) => void;
  onRemovePhoto: (index: number) => void;
  onSubmit: () => void;            // staff: submit for approval
  onViewNote: () => void;          // manager: view the delivery-note PDF
```

3. Update the destructured params and remove the manager-only OCR `<FilePicker ... Scan delivery note>` block (lines ~133-197).
4. Replace the bottom action bar (lines ~254-266) with mode-aware controls:

```tsx
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        {isSubmitted ? (
          // ---- Manager approval mode ----
          isManager ? (
            <>
              <button onClick={onViewNote} className="w-full mb-2 py-2.5 rounded-xl bg-[#FFF4E6] border border-[#F5800A] text-[#F5800A] text-[13px] font-bold active:bg-[#ffe9cc]">View delivery note</button>
              <div className="flex gap-2">
                <button onClick={onConfirmClose} className="flex-1 py-3 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700">Approve &amp; close</button>
                <button onClick={onKeepBackorder} className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Keep backorder</button>
              </div>
              <p className="text-[11px] text-gray-400 text-center mt-1">Approving updates stock in Odoo.</p>
            </>
          ) : (
            <>
              <button onClick={onViewNote} className="w-full mb-2 py-2.5 rounded-xl bg-[#FFF4E6] border border-[#F5800A] text-[#F5800A] text-[13px] font-bold active:bg-[#ffe9cc]">View delivery note</button>
              <p className="text-[12px] text-gray-500 text-center py-1">Submitted — waiting for a manager to approve.</p>
            </>
          )
        ) : (
          // ---- Staff capture mode ----
          <>
            <div className="mb-2">
              <FilePicker
                onFile={onAddPhoto}
                accept="image/*"
                variant="button"
                icon={'\u{1F4F7}'}
                label="Add delivery note photo"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold bg-[#F5800A] text-white active:bg-[#E86000]"
              />
              {deliveryPhotos.length > 0 && (
                <div className="flex gap-2 mt-2 overflow-x-auto">
                  {deliveryPhotos.map((src, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img src={src} alt={`note ${i + 1}`} className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                      <button onClick={() => onRemovePhoto(i)} aria-label="Remove" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[11px] leading-none">&times;</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onSubmit}
              disabled={deliveryPhotos.length === 0 || submitting}
              className={`w-full py-3 rounded-xl text-[14px] font-bold ${deliveryPhotos.length === 0 || submitting ? 'bg-gray-200 text-gray-400' : 'bg-green-600 text-white active:bg-green-700'}`}
            >
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-1">A manager approves before stock updates.</p>
          </>
        )}
      </div>
```

- [ ] **Step 3: Rewire `page.tsx` — remove scan, add capture/submit/view handlers**

In `src/app/purchase/page.tsx`:

1. Remove scan state (`scanning`, `scanResult`, `scanErr` ~lines 416-418) and the `scanDeliveryNote` handler (~lines 450-475). Remove the `ScanMatched`/`ScanResult` interfaces (~line 44). Remove the `import ... scan` if any.
2. Add state near the other receive state:

```ts
  const [deliveryPhotos, setDeliveryPhotos] = useState<string[]>([]);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [notePdf, setNotePdf] = useState<string | null>(null);
```

3. Clear photos when opening a receipt: in `openReceiveCheck` (~line 236), after `setScreen('receive-check');`, add `setDeliveryPhotos([]);`.

4. Add handlers (near `confirmReceiptAction` ~line 261):

```ts
  function addDeliveryPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (url.startsWith('data:image/')) setDeliveryPhotos(prev => [...prev, url]);
    };
    reader.readAsDataURL(file);
  }

  function removeDeliveryPhoto(index: number) {
    setDeliveryPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function submitReceiptForApproval() {
    if (!receipt || deliveryPhotos.length === 0) return;
    setSubmittingReceipt(true);
    try {
      const r = await fetch('/api/purchase/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', receipt_id: receipt.id, photos: deliveryPhotos }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setConfirmDialog({ title: 'Could not submit', message: d.error || 'Please try again.', confirmLabel: 'OK', variant: 'primary', onConfirm: () => setConfirmDialog(null) });
        return;
      }
      setDeliveryPhotos([]);
      fetchPending();
      setScreen('receive-list');
    } catch (e) {
      void e;
    } finally {
      setSubmittingReceipt(false);
    }
  }

  async function viewDeliveryNote() {
    if (!receipt) return;
    try {
      const r = await fetch(`/api/purchase/receive?note_pdf=${receipt.id}`);
      const d = await r.json();
      if (d.pdf) setNotePdf(d.pdf);
    } catch (e) {
      void e;
    }
  }
```

5. Update the `<ReceiveCheckScreen ... />` usage (~lines 743-757): remove the five scan props (`scanning`, `scanResult`, `scanErr`, `onScanFile`, `onDismissScan`) and add:

```tsx
          isSubmitted={receipt?.status === 'submitted'}
          deliveryPhotos={deliveryPhotos}
          submitting={submittingReceipt}
          onAddPhoto={addDeliveryPhoto}
          onRemovePhoto={removeDeliveryPhoto}
          onSubmit={() => setConfirmDialog({ title: 'Submit for approval?', message: 'This sends the delivery to a manager to approve. You cannot edit it after submitting.', confirmLabel: 'Yes, submit', variant: 'primary', onConfirm: () => { setConfirmDialog(null); submitReceiptForApproval(); } })}
          onViewNote={viewDeliveryNote}
```

The manager `onConfirmClose`/`onKeepBackorder` props (which call `confirmReceiptAction`) stay — they are the Approve buttons in submitted mode. Update the confirm-dialog copy on `onConfirmClose` to say "Approve" instead of "Confirm" for clarity.

6. Render the PDF viewer near the `confirmDialog` render (~line 794):

```tsx
      {notePdf && <PdfViewer fileData={notePdf} fileName="delivery-note.pdf" onClose={() => setNotePdf(null)} />}
```

Ensure `PdfViewer` is imported at the top (add only if not already present): `import PdfViewer from '@/components/ui/PdfViewer';`

- [ ] **Step 4: Bucket the receive list into "To receive" and "Awaiting approval"**

In `src/components/purchase/ReceiveListScreen.tsx`, split the incoming `pendingDeliveries` by `receipt_status`:
- **To receive** = items where `receipt_status !== 'submitted'` (tappable by anyone → opens capture mode).
- **Awaiting approval** = items where `receipt_status === 'submitted'` (render an "Awaiting approval" section; tappable only when `isManager`, otherwise show a muted "waiting for manager" chip).

Add a section header before each group. Reuse the existing row markup, and add `data-testid="delivery-row"` to each row element (Task 5's e2e selector depends on it). If the component doesn't currently receive `isManager`, thread it through from `page.tsx` (it already has `isManager` at line 604). Keep both groups using the same `onOpen(order)` handler that routes to `openReceiveCheck`.

Acceptance for this step: a submitted order appears only under "Awaiting approval"; a not-yet-submitted sent/partial order appears only under "To receive"; staff tapping an "Awaiting approval" row does not open approval controls.

- [ ] **Step 5: Build gate (this is the big one — catches all the TS pitfalls)**

Run: `npm run build`
Expected: exit 0. Common failures to fix: leftover references to removed scan state/props; unused imports (remove); `prefer-const`; JSX apostrophes (`’`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(purchase): staff photograph delivery note→PDF + submit; manager approve; remove OCR"
```

---

### Task 5: End-to-end acceptance test + deploy + verify on staging

**Files:**
- Create: `tests/purchase-receive.e2e.spec.ts`

**Interfaces:**
- Consumes: the deployed staging build of Tasks 1-4.
- Produces: a repeatable staging smoke of the new receive UI.

- [ ] **Step 1: Write the e2e spec (targeted, resilient to empty queues)**

Create `tests/purchase-receive.e2e.spec.ts`. It logs in itself (mobile viewport, `modules` project pattern), verifies the OCR button is gone and the new controls exist, and drives a pending delivery through submit if one exists:

```ts
import { test, expect } from '@playwright/test';

// Staff credentials come from env (same convention as auth.setup.ts / inventory.e2e).
const STAFF_EMAIL = process.env.SMOKE_STAFF_EMAIL || process.env.SMOKE_EMAIL || '';
const STAFF_PASSWORD = process.env.SMOKE_STAFF_PASSWORD || process.env.SMOKE_PASSWORD || '';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

test('receive screen shows capture+submit (no OCR scan button)', async ({ page }) => {
  test.skip(!STAFF_EMAIL, 'SMOKE_STAFF_EMAIL/PASSWORD not set');
  page.on('dialog', (d) => d.accept());
  await login(page, STAFF_EMAIL, STAFF_PASSWORD);

  await page.goto('/purchase');
  // Go to the Receive tab.
  await page.getByRole('button', { name: /receive/i }).first().click();

  // OCR scan button must be gone everywhere.
  await expect(page.getByRole('button', { name: /scan delivery note/i })).toHaveCount(0);

  // If there is a pending delivery, open it and assert the new controls.
  const firstDelivery = page.locator('[data-testid="delivery-row"], .delivery-row').first();
  if (await firstDelivery.count()) {
    await firstDelivery.click();
    await expect(page.getByText(/add delivery note photo/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /submit for approval/i })).toBeVisible();
  }
});
```

> If `ReceiveListScreen` rows have no stable selector, add `data-testid="delivery-row"` to the row element in Task 4 Step 4 (cheap, and makes this test deterministic).

- [ ] **Step 2: Push the branch and let the GitHub Action build-check pass**

```bash
git push origin main
```
Expected: GitHub Action build check green.

- [ ] **Step 3: Deploy to staging**

```bash
ssh root@89.167.124.0 'cd /opt/krawings-portal && git branch --show-current'   # must print: main
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull && npm run build && systemctl restart krawings-portal'
```
Expected: build exit 0, service restarts. Smoke: `curl -sSI https://portal.krawings.de/login | head -1` → `HTTP/... 200`.

- [ ] **Step 4: Run the e2e against staging**

```bash
SMOKE_ENV=staging SMOKE_STAFF_EMAIL=... SMOKE_STAFF_PASSWORD=... npx playwright test --project=modules tests/purchase-receive.e2e.spec.ts
```
Expected: PASS (or skipped cleanly if no pending delivery / no creds).

- [ ] **Step 5: Manual happy-path verification on staging (required — per project rule)**

Real browser on `portal.krawings.de`:
1. **Hana Kim (staff)**: Purchase → Receive → open a sent order → enter quantities (make one line short) → flag one issue → **Add delivery note photo** twice (2 pages) → thumbnails show, remove/re-add works → **Submit for approval** → confirm prompt → lands back on Receive; order now under **Awaiting approval**.
2. **Marco Bauer (manager)**: Purchase → Receive → **Awaiting approval** → open → **View delivery note** shows a **multi-page PDF** → **Approve & close**.
3. **Odoo** (`89.167.124.0:15069`, PO for that order): a **PDF** (not JPG) is attached + a log note; received stock moved for the entered lines.
4. Negative: as staff, the submitted order is not tappable to approve; oversized photo rejected cleanly.

- [ ] **Step 6: Commit the test**

```bash
git add tests/purchase-receive.e2e.spec.ts
git commit -m "test(purchase): e2e for delivery-note capture/submit receive flow"
git push origin main
```

---

## Rollback

Every task is a small commit on `main`. To undo the whole feature: `git revert` the Task 1-5 commits (or revert the range) and redeploy. The added `submitted` status and columns are additive and harmless if the code is reverted. No production touched.

## Post-implementation

- Update `STATUS.md` and this repo's `MEMORY.md` pointer if a new rule emerged.
- Update the Obsidian session note `2026-07-04-delivery-note-pdf-design.md` → mark shipped-to-staging with the commit hashes.
- Do NOT deploy to production until Ethan explicitly approves.
