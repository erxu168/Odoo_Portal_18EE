# Termination Document UX Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Unify three inconsistent PDF upload widgets into one container, fix pinch-to-zoom in PdfViewer, add PLZ click-to-copy, and delete unsigned PDF when signed version is uploaded.

**Architecture:** Four independent changes: (1) fix PdfViewer touch handling, (2) update upload-signed API to clean up old attachment, (3) create KuendigungDocWidget that shows one card evolving from unsigned to signed, (4) wire it all together in TermDetail with PLZ copy.

**Tech Stack:** Next.js 14, React, TypeScript, PDF.js, Odoo 18 JSON-RPC

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| src/components/ui/PdfViewer.tsx | Modify | Fix pinch-to-zoom gesture handling |
| src/app/api/termination/[id]/upload-signed/route.ts | Modify | Delete old unsigned attachment on upload |
| src/components/termination/KuendigungDocWidget.tsx | Create | Single two-state document card |
| src/components/termination/TermDetail.tsx | Modify | Replace 2 PDF sections + add PLZ copy |

---

### Task 1: Fix PdfViewer pinch-to-zoom

**Files:**
- Modify: src/components/ui/PdfViewer.tsx

**Root cause:** The canvas has touch-action: pan-x pan-y but the scroll container (where gesture/touch listeners are attached) has no touch-action set, defaulting to auto. With auto, the browser handles ALL gestures natively (including pinch-zoom), so JavaScript never gets to process two-finger gestures. Additionally, the useEffect depends on [zoom], causing event listeners to be removed and re-added on every zoom change during a pinch.

- [ ] **Step 1: Fix touch-action placement and add zoom refs**

In src/components/ui/PdfViewer.tsx, make these changes:

a) Add a zoom ref after the existing useState for zoom:

```typescript
const [zoom, setZoom] = useState(1.0);
const [rendering, setRendering] = useState(false);

// ADD: ref to avoid stale closure in touch handlers
const zoomRef = useRef(1.0);
function updateZoom(newZoom: number) {
  const clamped = Math.max(0.5, Math.min(5.0, newZoom));
  zoomRef.current = clamped;
  setZoom(clamped);
}
```

b) Replace the entire pinch/gesture useEffect (the one with [zoom] dependency that starts with comment "Pinch-to-zoom via native gesturechange") with:

```typescript
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;

  function onGestureStart(e: any) {
    e.preventDefault();
    pinchRef.current = { active: true, initialDist: 0, initialZoom: zoomRef.current };
  }
  function onGestureChange(e: any) {
    e.preventDefault();
    updateZoom(pinchRef.current.initialZoom * e.scale);
  }
  function onGestureEnd(e: any) {
    e.preventDefault();
    pinchRef.current.active = false;
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { active: true, initialDist: Math.hypot(dx, dy), initialZoom: zoomRef.current };
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (pinchRef.current.active && e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchRef.current.initialDist;
      updateZoom(pinchRef.current.initialZoom * scale);
    }
  }
  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinchRef.current.active = false;
  }

  el.addEventListener('gesturestart', onGestureStart, { passive: false });
  el.addEventListener('gesturechange', onGestureChange, { passive: false });
  el.addEventListener('gestureend', onGestureEnd, { passive: false });
  el.addEventListener('touchstart', onTouchStart, { passive: false });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd);

  return () => {
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', onGestureEnd);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
  };
}, []); // NO zoom dependency
```

c) On the scroll container div, add touch-action to block browser pinch-zoom:

Change:
```tsx
style={{ WebkitOverflowScrolling: 'touch' }}
```
To:
```tsx
style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
```

d) Remove touch-action from the canvas:

Change:
```tsx
style={{ touchAction: 'pan-x pan-y' }}
```
To: remove the style prop entirely from canvas.

e) Add zoom +/- buttons in the top bar, between page nav and filename:

```tsx
<div className="flex items-center gap-1">
  <button onClick={() => updateZoom(zoom - 0.25)} disabled={zoom <= 0.5}
    className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 disabled:opacity-30 text-[16px] font-bold">-</button>
  <span className="text-white/60 text-[11px] font-mono min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
  <button onClick={() => updateZoom(zoom + 0.25)} disabled={zoom >= 5.0}
    className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 disabled:opacity-30 text-[16px] font-bold">+</button>
</div>
```

Also remove the existing "zoom indicator / tap to reset" block since we now have permanent zoom controls.

- [ ] **Step 2: Verify pinch-to-zoom on device**

- [ ] **Step 3: Commit**

```bash
cd /opt/krawings-portal
git add src/components/ui/PdfViewer.tsx
git commit -m "[FIX] PdfViewer: fix pinch-to-zoom and add zoom buttons"
```

---

### Task 2: Update upload-signed API to delete old unsigned PDF

**Files:**
- Modify: src/app/api/termination/[id]/upload-signed/route.ts

- [ ] **Step 1: Add deletion of old attachment and return full record**

Before the "Create ir.attachment" section, read the old pdf_attachment_id. After writing the new one, delete the old attachment. Change the response to return the full updated record.

Add import at top:
```typescript
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';
```

Before "Create ir.attachment", add:
```typescript
const odoo = getOdoo();
let oldPdfAttachId: number | null = null;
try {
  const current = await odoo.read('kw.termination', [termId], ['pdf_attachment_id']);
  if (current?.[0]?.pdf_attachment_id) {
    oldPdfAttachId = Array.isArray(current[0].pdf_attachment_id)
      ? current[0].pdf_attachment_id[0]
      : current[0].pdf_attachment_id;
  }
} catch (_e) {}
```

Remove the existing "const odoo = getOdoo();" line that comes after.

After the odoo.write call, add:
```typescript
if (oldPdfAttachId && oldPdfAttachId !== attachId) {
  try { await odoo.call('ir.attachment', 'unlink', [[oldPdfAttachId]]); } catch (_e) {}
}
```

Replace the final return with:
```typescript
const updatedRecords = await odoo.read('kw.termination', [termId], TERMINATION_DETAIL_FIELDS);
return NextResponse.json({ ok: true, data: updatedRecords[0] });
```

- [ ] **Step 2: Commit**

```bash
cd /opt/krawings-portal
git add src/app/api/termination/[id]/upload-signed/route.ts
git commit -m "[IMP] termination/upload-signed: delete old unsigned PDF on signed upload"
```

---

### Task 3: Create KuendigungDocWidget

**Files:**
- Create: src/components/termination/KuendigungDocWidget.tsx

- [ ] **Step 1: Create the component**

See spec for full component code. Two-state card: unsigned (View/Print/Upload signed) and signed (View/Print/Replace). Uses PdfViewer for viewing, direct fetch for printing, file input for uploading.

Props: terminationId, employeeName, hasPdf, hasSignedPdf, signedPdfName, onRecordUpdate.

- [ ] **Step 2: Commit**

```bash
cd /opt/krawings-portal
git add src/components/termination/KuendigungDocWidget.tsx
git commit -m "[ADD] termination: KuendigungDocWidget single two-state document card"
```

---

### Task 4: Update TermDetail — wire KuendigungDocWidget + PLZ copy

**Files:**
- Modify: src/components/termination/TermDetail.tsx

- [ ] **Step 1: Update imports**

Replace PdfViewer and FilePicker imports with KuendigungDocWidget import.

- [ ] **Step 2: Remove unused state and handlers**

Remove: showPdf, pdfBase64, uploadLoading state vars.
Remove: handleUploadSigned, handleViewPdf, handlePrintPdf functions.
Update handleGeneratePdf to just call fetchRecord() on success (no PDF preview).
Add: plzCopied state and handleCopyPlz function.

- [ ] **Step 3: Replace two PDF sections with single KuendigungDocWidget**

Delete "View + Print PDF row" section and "Signed document upload" section.
Replace with single KuendigungDocWidget block.

- [ ] **Step 4: Add PLZ copy in Delivery card**

After the DocumentUploadWidget for courier confirmation, add PLZ display with tap-to-copy and "Copied!" feedback.

- [ ] **Step 5: Remove PdfViewer modal at bottom**

Delete the showPdf && pdfBase64 PdfViewer block at end of JSX.

- [ ] **Step 6: Verify and commit**

```bash
cd /opt/krawings-portal
git add src/components/termination/TermDetail.tsx
git commit -m "[IMP] termination: unify PDF sections into single widget + add PLZ copy"
```

---

## Verification Checklist

- [ ] Only ONE document card for Kuendigung (not two)
- [ ] Print button preserved
- [ ] Pinch-to-zoom works on iOS and Android
- [ ] Zoom +/- buttons work as fallback
- [ ] PLZ displayed with tap-to-copy
- [ ] Uploading signed PDF replaces unsigned
- [ ] Courier confirmation DocumentUploadWidget unchanged
- [ ] Desktop view unaffected
