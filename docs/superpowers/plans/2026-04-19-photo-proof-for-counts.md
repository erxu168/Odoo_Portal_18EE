# Photo Proof for Counts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers mark products as "requires photo when counting." Staff counting a flagged product must attach 1–3 photos. Manager views thumbnails in review; tap for fullscreen.

**Architecture:** Two new SQLite tables (`product_flags`, `count_photos`). Per-product boolean flag gates photo requirement at submit time. Photos stored as base64 JPEG dataURLs, matching the existing `proof_photo` pattern. Polymorphic `count_photos.source_table` links to either `count_entries` or `quick_counts`.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3, Odoo 18 EE JSON-RPC. Camera via `<input type="file" accept="image/*" capture="environment">` + canvas resize → dataURL. No test runner — verification is `npm run build` + manual + commit.

---

## Spec reference

[docs/superpowers/specs/2026-04-19-photo-proof-for-counts-design.md](docs/superpowers/specs/2026-04-19-photo-proof-for-counts-design.md)

## File structure

**New:**
- `src/app/api/inventory/product-flags/route.ts` — GET list of flags
- `src/app/api/inventory/product-flags/[product_id]/route.ts` — PUT single flag
- `src/components/inventory/ProductSettings.tsx` — manager toggle screen
- `src/components/inventory/PhotoCaptureStrip.tsx` — reusable camera + thumbs
- `src/components/inventory/PhotoLightbox.tsx` — fullscreen viewer

**Modified:**
- `src/lib/inventory-db.ts` — schema + helpers
- `src/components/inventory/QuickCount.tsx` — per-entry photos state + submit gate
- `src/components/inventory/CountingSession.tsx` — photos via upsert + submit gate
- `src/components/inventory/ReviewSubmissions.tsx` — thumbnail strip + lightbox
- `src/components/inventory/InventoryDashboard.tsx` — add "Product settings" tile
- `src/app/inventory/page.tsx` — add route for `product-settings` screen
- `src/app/api/inventory/quick-count/route.ts` — accept photos + validate
- `src/app/api/inventory/counts/route.ts` — accept photos on upsert
- `src/app/api/inventory/sessions/route.ts` — validate photos at submit

**Unchanged:**
- Odoo side — no module changes

---

## Task 1: Schema + helpers for product_flags and count_photos

**Files:**
- Modify: `src/lib/inventory-db.ts`

- [ ] **Step 1: Add schema for the two new tables**

Edit `src/lib/inventory-db.ts`. Find the `db.exec(\`...\`)` block inside
`initInventoryTables()` (around line 20). Append the two new CREATE TABLE
statements to the template string, immediately before the closing
backtick + semicolon. The new tables go in the same `db.exec()` call:

```sql
    CREATE TABLE IF NOT EXISTS product_flags (
      odoo_product_id INTEGER PRIMARY KEY,
      requires_photo  INTEGER NOT NULL DEFAULT 0,
      updated_by      INTEGER,
      updated_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS count_photos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      photo        TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_count_photos_source ON count_photos(source_table, source_id);
```

- [ ] **Step 2: Add CRUD helpers for product_flags**

Append to the end of `src/lib/inventory-db.ts`:

```typescript
// ===
// PRODUCT FLAGS (per-product counting requirements)
// ===

export interface ProductFlag {
  odoo_product_id: number;
  requires_photo: boolean;
  updated_by: number | null;
  updated_at: string | null;
}

export function getProductFlags(ids?: number[]): ProductFlag[] {
  const db = getDb();
  let rows: any[];
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT * FROM product_flags WHERE odoo_product_id IN (${placeholders})`
    ).all(...ids);
  } else {
    rows = db.prepare('SELECT * FROM product_flags').all();
  }
  return rows.map(r => ({
    odoo_product_id: r.odoo_product_id,
    requires_photo: !!r.requires_photo,
    updated_by: r.updated_by,
    updated_at: r.updated_at,
  }));
}

export function setProductFlag(
  productId: number,
  requiresPhoto: boolean,
  userId: number,
) {
  const db = getDb();
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, requires_photo, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      requires_photo = excluded.requires_photo,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, requiresPhoto ? 1 : 0, userId, now());
}
```

- [ ] **Step 3: Add CRUD helpers for count_photos**

Append to the end of `src/lib/inventory-db.ts`:

```typescript
// ===
// COUNT PHOTOS (per-line photo proof)
// ===

export type PhotoSource = 'count_entries' | 'quick_counts';

/**
 * Replace the full set of photos for a given count line. Deletes any
 * existing photos then inserts the provided set. Pass an empty array
 * to clear photos for a line.
 */
export function setCountPhotos(source: PhotoSource, sourceId: number, photos: string[]) {
  const db = getDb();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM count_photos WHERE source_table = ? AND source_id = ?')
      .run(source, sourceId);
    const insert = db.prepare(
      'INSERT INTO count_photos (source_table, source_id, photo, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const p of photos) insert.run(source, sourceId, p, ts);
  });
  tx();
}

/**
 * Get all photos for a single count line.
 */
export function getCountPhotos(source: PhotoSource, sourceId: number): string[] {
  const db = getDb();
  return (db.prepare(
    'SELECT photo FROM count_photos WHERE source_table = ? AND source_id = ? ORDER BY id'
  ).all(source, sourceId) as { photo: string }[]).map(r => r.photo);
}

/**
 * Bulk fetch: returns { sourceId → string[] } for the given line IDs.
 * Used by review endpoints to hydrate photos onto all entries in one query.
 */
export function getCountPhotosMap(source: PhotoSource, sourceIds: number[]): Record<number, string[]> {
  if (sourceIds.length === 0) return {};
  const db = getDb();
  const placeholders = sourceIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT source_id, photo FROM count_photos WHERE source_table = ? AND source_id IN (${placeholders}) ORDER BY id`
  ).all(source, ...sourceIds) as { source_id: number; photo: string }[];
  const map: Record<number, string[]> = {};
  for (const r of rows) {
    if (!map[r.source_id]) map[r.source_id] = [];
    map[r.source_id].push(r.photo);
  }
  return map;
}

export function deleteCountPhotos(source: PhotoSource, sourceId: number) {
  const db = getDb();
  db.prepare('DELETE FROM count_photos WHERE source_table = ? AND source_id = ?')
    .run(source, sourceId);
}
```

- [ ] **Step 4: Cascade photo deletion when a count line is deleted or a draft product is rejected**

Find the existing `deleteCountEntry` function in `src/lib/inventory-db.ts`
(around line 417). Replace it with:

```typescript
export function deleteCountEntry(session_id: number, product_id: number) {
  const db = getDb();
  // Find the entry ids first so we can delete their photos
  const rows = db.prepare(
    'SELECT id FROM count_entries WHERE session_id = ? AND product_id = ?'
  ).all(session_id, product_id) as { id: number }[];
  for (const r of rows) deleteCountPhotos('count_entries', r.id);
  db.prepare('DELETE FROM count_entries WHERE session_id = ? AND product_id = ?')
    .run(session_id, product_id);
}
```

Find the existing `deleteCountsForProduct` function. Replace it with:

```typescript
export function deleteCountsForProduct(productId: number): number {
  const db = getDb();

  // Delete photos for each quick_count row first
  const quickRows = db.prepare(
    'SELECT id FROM quick_counts WHERE product_id = ?'
  ).all(productId) as { id: number }[];
  for (const r of quickRows) deleteCountPhotos('quick_counts', r.id);

  // Delete photos for each count_entry row first
  const entryRows = db.prepare(
    'SELECT id FROM count_entries WHERE product_id = ?'
  ).all(productId) as { id: number }[];
  for (const r of entryRows) deleteCountPhotos('count_entries', r.id);

  let deleted = 0;
  deleted += db.prepare('DELETE FROM quick_counts WHERE product_id = ?').run(productId).changes;
  deleted += db.prepare('DELETE FROM count_entries WHERE product_id = ?').run(productId).changes;
  return deleted;
}
```

- [ ] **Step 5: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -8
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

Expected: OK with a BUILD_ID.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inventory-db.ts
git commit -m "[ADD] inventory: schema + helpers for product_flags and count_photos"
```

---

## Task 2: Product flags API routes

**Files:**
- Create: `src/app/api/inventory/product-flags/route.ts`
- Create: `src/app/api/inventory/product-flags/[product_id]/route.ts`

- [ ] **Step 1: GET /api/inventory/product-flags**

Create `src/app/api/inventory/product-flags/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/product-flags
 *
 * Returns the set of product flags used by the inventory counting flow
 * (currently just requires_photo). All authenticated users can read —
 * staff needs to know which products require a photo when counting.
 *
 * Query: ?ids=1,2,3 to fetch a subset (otherwise returns all).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, getProductFlags } from '@/lib/inventory-db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get('ids');
  let ids: number[] | undefined;
  if (idsParam) {
    ids = idsParam.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
  }

  const flags = getProductFlags(ids);
  return NextResponse.json({ flags });
}
```

- [ ] **Step 2: PUT /api/inventory/product-flags/[product_id]**

Create `src/app/api/inventory/product-flags/[product_id]/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
/**
 * PUT /api/inventory/product-flags/[product_id]
 *
 * Upserts a product flag. Manager+ only.
 * Body: { requires_photo: boolean }
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, setProductFlag } from '@/lib/inventory-db';

export async function PUT(
  request: Request,
  { params }: { params: { product_id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.product_id, 10);
  if (isNaN(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    initInventoryTables();
    const body = await request.json();
    const requiresPhoto = !!body.requires_photo;
    setProductFlag(productId, requiresPhoto, user.id);
    return NextResponse.json({ success: true, requires_photo: requiresPhoto });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[product-flags PUT]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -8
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/inventory/product-flags/"
git commit -m "[ADD] inventory: product-flags API (GET list, PUT per-product)"
```

---

## Task 3: Product Settings screen (manager only)

**Files:**
- Create: `src/components/inventory/ProductSettings.tsx`
- Modify: `src/components/inventory/InventoryDashboard.tsx`
- Modify: `src/app/inventory/page.tsx`

- [ ] **Step 1: Create ProductSettings.tsx**

Create `src/components/inventory/ProductSettings.tsx`:

```tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';

interface ProductSettingsProps {
  onBack: () => void;
}

export default function ProductSettings({ onBack }: ProductSettingsProps) {
  const [products, setProducts] = useState<any[]>([]);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [prodRes, flagRes] = await Promise.all([
          fetch('/api/inventory/products?limit=500').then(r => r.json()),
          fetch('/api/inventory/product-flags').then(r => r.json()),
        ]);
        const prods = (prodRes.products || []).filter((p: any) => p.active !== false);
        setProducts(prods);
        const map: Record<number, boolean> = {};
        (flagRes.flags || []).forEach((f: any) => { map[f.odoo_product_id] = !!f.requires_photo; });
        setFlags(map);
      } catch (err) {
        console.error('Failed to load product settings:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  async function toggle(productId: number) {
    const next = !flags[productId];
    setFlags(prev => ({ ...prev, [productId]: next }));
    setSaving(productId);
    try {
      const res = await fetch(`/api/inventory/product-flags/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_photo: next }),
      });
      if (!res.ok) {
        // Revert on failure
        setFlags(prev => ({ ...prev, [productId]: !next }));
      }
    } catch {
      setFlags(prev => ({ ...prev, [productId]: !next }));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Product settings</h1>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState title="No products" body="Try a different search" />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p: any) => {
              const on = !!flags[p.id];
              const busy = saving === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => !busy && toggle(p.id)}
                  disabled={busy}
                  className="flex items-center justify-between gap-3 py-3.5 border-b border-gray-100 text-left active:bg-gray-50 disabled:opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
                      {p.categ_id?.[1] || ''} {on && <span className="text-[#F5800A] font-semibold ml-1">· Photo required</span>}
                    </div>
                  </div>
                  <div className={`relative w-11 h-[26px] rounded-full transition-colors ${on ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
                    <div className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add tile in InventoryDashboard**

Read `src/components/inventory/InventoryDashboard.tsx` to find the
`tiles` array (around line 84 after the previous refactor). Find the
tile list where manager-only items appear. Add one more tile object to
the array — place it near the other manager-only tiles (anywhere
`canManage` gates the inclusion):

```typescript
{
  id: 'product-settings',
  label: 'Product settings',
  sublabel: 'Photo rules, per product',
  icon: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  iconBg: 'bg-blue-50',
  iconColor: 'text-blue-600',
  color: 'bg-white border-gray-200',
  badge: 0,
  managerOnly: true,
},
```

Wrap its inclusion in `canManage` just like other manager-only tiles
already are. The existing tile filter logic handles this.

- [ ] **Step 3: Wire product-settings screen into the inventory router**

Edit `src/app/inventory/page.tsx`. Find the `type Screen = ...` union
definition at the top and add `'product-settings'`:

```typescript
type Screen =
  | { type: 'dashboard' }
  | { type: 'my-lists' }
  | { type: 'quick-count' }
  | { type: 'manage' }
  | { type: 'review' }
  | { type: 'mo-ingredients' }
  | { type: 'product-settings' }
  | { type: 'session'; sessionId: number };
```

Import the new component at the top:

```typescript
import ProductSettings from '@/components/inventory/ProductSettings';
```

Add a render branch for the new screen. Find the existing screen
render blocks (e.g., `if (screen.type === 'dashboard')`). Add one more:

```typescript
  if (screen.type === 'product-settings') {
    return <ProductSettings onBack={goDashboard} />;
  }
```

- [ ] **Step 4: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -8
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/ProductSettings.tsx \
        src/components/inventory/InventoryDashboard.tsx \
        src/app/inventory/page.tsx
git commit -m "[ADD] inventory: product settings screen for photo-required flag"
```

---

## Task 4: Reusable PhotoCaptureStrip component

Used by QuickCount and CountingSession. Owns its own photos state; emits
changes via onChange.

**Files:**
- Create: `src/components/inventory/PhotoCaptureStrip.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/inventory/PhotoCaptureStrip.tsx`:

```tsx
'use client';

import React, { useRef, useState } from 'react';

const MAX_PHOTOS = 3;
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.7;

interface PhotoCaptureStripProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled?: boolean;
}

/**
 * Capture up to 3 photos inline. Stores each photo as a JPEG base64
 * dataURL, compressed to max 1280px on the long edge at 0.7 quality.
 * Caller owns the photos state; this component just renders + emits.
 */
export default function PhotoCaptureStrip({ photos, onChange, disabled }: PhotoCaptureStripProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      if (dataUrl) onChange([...photos, dataUrl]);
    } finally {
      setBusy(false);
    }
  }

  function remove(idx: number) {
    const next = [...photos];
    next.splice(idx, 1);
    onChange(next);
  }

  const atMax = photos.length >= MAX_PHOTOS;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {photos.map((p, i) => (
        <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
          <img src={p} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center active:bg-black disabled:opacity-50"
            aria-label="Remove photo"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      ))}
      {!atMax && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFile}
            disabled={disabled || busy}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            className="w-14 h-14 rounded-lg border-2 border-dashed border-[#F5800A] text-[#F5800A] flex items-center justify-center active:bg-[#FFF4E6] disabled:opacity-50"
            aria-label={photos.length === 0 ? 'Add photo' : 'Add another photo'}
          >
            {busy ? (
              <div className="w-4 h-4 border-2 border-[#F5800A]/30 border-t-[#F5800A] rounded-full animate-spin" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        </>
      )}
    </div>
  );
}

async function fileToResizedDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const { width: w, height: h } = fitWithin(img.width, img.height, MAX_DIMENSION);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w / h;
  if (w >= h) return { width: max, height: Math.round(max / ratio) };
  return { width: Math.round(max * ratio), height: max };
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -8
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/inventory/PhotoCaptureStrip.tsx
git commit -m "[ADD] inventory: PhotoCaptureStrip reusable camera component"
```

---

## Task 5: PhotoLightbox fullscreen viewer

**Files:**
- Create: `src/components/inventory/PhotoLightbox.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/inventory/PhotoLightbox.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';

interface PhotoLightboxProps {
  open: boolean;
  photos: string[];
  initialIndex?: number;
  onClose: () => void;
}

/**
 * Fullscreen viewer for a list of photos. Swipe left/right to navigate,
 * native pinch-to-zoom via touch-action pinch-zoom on the image,
 * X button to close.
 */
export default function PhotoLightbox({ open, photos, initialIndex = 0, onClose }: PhotoLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => { if (open) setIndex(initialIndex); }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex(i => Math.min(photos.length - 1, i + 1));
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, photos.length, onClose]);

  if (!open || photos.length === 0) return null;

  function onTouchStart(e: React.TouchEvent) {
    setTouchStartX(e.touches[0].clientX);
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 60) {
      if (dx < 0) setIndex(i => Math.min(photos.length - 1, i + 1));
      else setIndex(i => Math.max(0, i - 1));
    }
    setTouchStartX(null);
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center justify-between px-4 pt-12 pb-3 text-white">
        <span className="text-[14px] font-semibold">{index + 1} / {photos.length}</span>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <img
          src={photos[index]}
          alt={`Photo ${index + 1}`}
          className="max-w-full max-h-full object-contain"
          style={{ touchAction: 'pinch-zoom' }}
        />
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-2 py-4">
          {photos.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`w-2 h-2 rounded-full transition-colors ${i === index ? 'bg-white' : 'bg-white/30'}`}
              aria-label={`Photo ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -8
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/inventory/PhotoLightbox.tsx
git commit -m "[ADD] inventory: PhotoLightbox fullscreen viewer with swipe + dots"
```

---

## Task 6: Quick Count — photos per entry + submit gate

**Files:**
- Modify: `src/components/inventory/QuickCount.tsx`
- Modify: `src/app/api/inventory/quick-count/route.ts`

- [ ] **Step 1: Add product-flag fetch and per-product photos state to QuickCount**

Edit `src/components/inventory/QuickCount.tsx`. Just after the existing
state declarations (after `const [counts, setCounts] = ...`), add:

```typescript
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  // Photos keyed by product id, each up to 3 base64 dataURLs
  const [photos, setPhotos] = useState<Record<number, string[]>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
```

In the existing `fetchData` useCallback, add a third fetch for flags
and populate state. Find the existing `Promise.all([...])` call in
`fetchData` and change it to:

```typescript
      const [prodRes, locRes, flagRes] = await Promise.all([
        fetch('/api/inventory/products').then((r) => r.json()),
        fetch(`/api/inventory/locations?company_id=${companyId}`).then((r) => r.json()),
        fetch('/api/inventory/product-flags').then((r) => r.json()),
      ]);
```

Then after `setLocations(locs)` add:

```typescript
      const flagMap: Record<number, boolean> = {};
      (flagRes.flags || []).forEach((f: any) => { flagMap[f.odoo_product_id] = !!f.requires_photo; });
      setFlags(flagMap);
```

- [ ] **Step 2: Render PhotoCaptureStrip inside flagged rows**

At the top of the file, add the import:

```typescript
import PhotoCaptureStrip from './PhotoCaptureStrip';
```

Find the product row rendering inside the filtered.map block (look for
`filtered.map((p) => {`). The current row JSX is a flex row with name
on the left, Stepper on the right. Replace the inner row content so the
row wraps a photo strip below when the product is flagged:

Current shape:

```tsx
return (
  <div key={p.id} className="flex items-center gap-3 py-3 border-b border-gray-100">
    {/* ... name + stepper ... */}
  </div>
);
```

Replace with:

```tsx
const flagged = !!flags[p.id];
const prodPhotos = photos[p.id] || [];
return (
  <div key={p.id} className="py-3 border-b border-gray-100">
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
          {flagged && (
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
              Photo required
            </span>
          )}
        </div>
        <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{catName}</div>
      </div>
      <Stepper value={val} uom={uom}
        onMinus={() => stepQty(p.id, -1)}
        onPlus={() => stepQty(p.id, 1)}
        onTap={() => openNumpad(p)} />
    </div>
    {flagged && (val ?? 0) > 0 && (
      <div className="mt-2">
        <PhotoCaptureStrip
          photos={prodPhotos}
          onChange={(next) => setPhotos(prev => ({ ...prev, [p.id]: next }))}
        />
      </div>
    )}
  </div>
);
```

(Keep the existing `val`, `uom`, `catName` calculations above the
return — they stay as they were.)

- [ ] **Step 3: Gate submit on missing photos**

Find the `handleSubmit` function. Before the try/setSubmitting, insert:

```typescript
    // Check for flagged products without photos
    const missingPhotos = Object.entries(counts).filter(([pid, qty]) => {
      const productId = Number(pid);
      return flags[productId] && qty > 0 && (photos[productId]?.length || 0) === 0;
    });
    if (missingPhotos.length > 0) {
      setSubmitError(`${missingPhotos.length} item${missingPhotos.length !== 1 ? 's' : ''} still need a photo.`);
      return;
    }
    setSubmitError(null);
```

Also, in the submit body, include photos on each entry. Change the
`entries` creation block from:

```typescript
const entries = Object.entries(counts).map(([pid, qty]) => {
  const p = products.find((pr) => pr.id === Number(pid));
  return { product_id: Number(pid), counted_qty: qty, uom: p?.uom_id?.[1] || 'Units' };
});
```

to:

```typescript
const entries = Object.entries(counts).map(([pid, qty]) => {
  const productId = Number(pid);
  const p = products.find((pr) => pr.id === productId);
  return {
    product_id: productId,
    counted_qty: qty,
    uom: p?.uom_id?.[1] || 'Units',
    photos: photos[productId] || [],
  };
});
```

After successful submit, also clear the photos state. In the success
branch (around `setCounts({})`), add:

```typescript
      setPhotos({});
```

- [ ] **Step 4: Surface submitError to the user**

Find the submit bar rendering (the bottom "Submit" button block). Right
above the button, add error display:

```tsx
      {submitError && (
        <div className="px-4 pb-2">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
            <span className="text-[var(--fs-sm)] font-semibold text-red-700">{submitError}</span>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Extend quick-count API to accept + validate photos**

Edit `src/app/api/inventory/quick-count/route.ts`. Replace the POST
handler entirely:

```typescript
export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { entries, location_id } = body;

  if (!entries || !Array.isArray(entries) || !location_id) {
    return NextResponse.json({ error: 'entries array and location_id required' }, { status: 400 });
  }

  // Load flags for the set of products in this submission
  const productIds: number[] = entries.map((e: any) => Number(e.product_id)).filter(Boolean);
  const flagRows = getProductFlags(productIds);
  const flagMap: Record<number, boolean> = {};
  flagRows.forEach(f => { flagMap[f.odoo_product_id] = !!f.requires_photo; });

  // Server-side validation: flagged + qty>0 must have at least one photo
  for (const entry of entries) {
    const pid = Number(entry.product_id);
    const qty = Number(entry.counted_qty);
    const photos: string[] = Array.isArray(entry.photos) ? entry.photos : [];
    if (flagMap[pid] && qty > 0 && photos.length === 0) {
      return NextResponse.json({
        error: `Product ${pid} requires a photo when counting`,
      }, { status: 400 });
    }
  }

  const ids: number[] = [];
  for (const entry of entries) {
    const id = createQuickCount({
      product_id: Number(entry.product_id),
      location_id,
      counted_qty: Number(entry.counted_qty),
      uom: entry.uom || 'Units',
      counted_by: user.id,
    });
    const photos: string[] = Array.isArray(entry.photos) ? entry.photos : [];
    if (photos.length > 0) {
      setCountPhotos('quick_counts', id, photos);
    }
    ids.push(id);
  }

  return NextResponse.json({ ids, message: `${ids.length} quick counts submitted` }, { status: 201 });
}
```

Also update the imports at the top:

```typescript
import { initInventoryTables, createQuickCount, listQuickCounts, approveQuickCount, getProductFlags, setCountPhotos, getCountPhotosMap } from '@/lib/inventory-db';
```

- [ ] **Step 6: Extend quick-count GET to include photos**

In the same `src/app/api/inventory/quick-count/route.ts`, replace the
GET handler so each returned count row includes its photos:

```typescript
export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  let status = searchParams.get('status') || undefined;

  // Map 'submitted' to 'pending' for quick counts
  if (status === 'submitted') status = 'pending';

  const filters: any = { status };
  if (!hasRole(user, 'manager')) {
    filters.counted_by = user.id;
  }

  const counts = listQuickCounts(filters);
  const photoMap = getCountPhotosMap('quick_counts', counts.map((c: any) => c.id));
  const hydrated = counts.map((c: any) => ({ ...c, photos: photoMap[c.id] || [] }));
  return NextResponse.json({ counts: hydrated });
}
```

- [ ] **Step 7: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -10
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

- [ ] **Step 8: Commit**

```bash
git add src/components/inventory/QuickCount.tsx \
        src/app/api/inventory/quick-count/route.ts
git commit -m "[ADD] inventory: Quick Count photo capture + submit gate"
```

---

## Task 7: Counting Session — photos per entry + submit gate

**Files:**
- Modify: `src/components/inventory/CountingSession.tsx`
- Modify: `src/app/api/inventory/counts/route.ts`
- Modify: `src/app/api/inventory/sessions/route.ts`

- [ ] **Step 1: Fetch flags in CountingSession**

Open `src/components/inventory/CountingSession.tsx`. There are already
state hooks near the top (line ~22: `const [entries, setEntries] =
useState<Record<number, number>>({});`). Alongside the existing state
(above or below the `entries` hook), add:

```typescript
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [rowPhotos, setRowPhotos] = useState<Record<number, string[]>>({});
```

(`submitError` already exists — don't add a duplicate.)

Fetch flags in a separate `useEffect` anywhere in the hooks block:

```typescript
  useEffect(() => {
    fetch('/api/inventory/product-flags').then(r => r.json()).then(d => {
      const map: Record<number, boolean> = {};
      (d.flags || []).forEach((f: any) => { map[f.odoo_product_id] = !!f.requires_photo; });
      setFlags(map);
    }).catch(() => {});
  }, []);
```

Hydrate `rowPhotos` inside the existing data-load. Find the block
(around line 65-69):

```typescript
      const entryMap: Record<number, number> = {};
      for (const e of (countRes.entries || [])) {
        entryMap[e.product_id] = e.counted_qty;
      }
      setEntries(entryMap);
```

Replace with:

```typescript
      const entryMap: Record<number, number> = {};
      const photoMap: Record<number, string[]> = {};
      for (const e of (countRes.entries || [])) {
        entryMap[e.product_id] = e.counted_qty;
        if (Array.isArray(e.photos) && e.photos.length > 0) {
          photoMap[e.product_id] = e.photos;
        }
      }
      setEntries(entryMap);
      setRowPhotos(photoMap);
```

- [ ] **Step 2: Render PhotoCaptureStrip on flagged product rows**

Add the import at the top of `CountingSession.tsx`:

```typescript
import PhotoCaptureStrip from './PhotoCaptureStrip';
```

In the product-list render, each row currently shows product name +
stepper/numpad UI. The current counted qty for a product is read via
`entries[p.id]` (the Record from state). Find the row JSX in the
products map (search for `products.map` in the file). After the
existing row's closing element, append a conditional photo strip:

```tsx
{flags[p.id] && (entries[p.id] ?? 0) > 0 && (
  <div className="mt-2">
    <PhotoCaptureStrip
      photos={rowPhotos[p.id] || []}
      onChange={(next) => {
        setRowPhotos(prev => ({ ...prev, [p.id]: next }));
        // Persist immediately via upsert with photos
        fetch('/api/inventory/counts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            product_id: p.id,
            counted_qty: entries[p.id],
            uom: p.uom_id?.[1] || 'Units',
            photos: next,
          }),
        });
      }}
    />
  </div>
)}
```

If the existing product row is wrapped in a single `<div>` that renders
name + stepper inline, wrap that whole `<div>` and the new photo block
in a shared parent `<div key={p.id}>` so the strip sits below. Pattern:

```tsx
<div key={p.id}>
  {/* existing row content */}
  {flags[p.id] && (entries[p.id] ?? 0) > 0 && (
    <div className="mt-2">...photo strip as above...</div>
  )}
</div>
```

Also add a "Photo required" amber pill next to the product name. Find
the existing product-name rendering inside the row and wrap it in a
small flex row so the pill can sit inline:

```tsx
<div className="flex items-center gap-2">
  <span className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</span>
  {flags[p.id] && (
    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
      Photo required
    </span>
  )}
</div>
```

- [ ] **Step 3: Extend counts API to accept photos on upsert + return them on GET**

Edit `src/app/api/inventory/counts/route.ts`. Update the imports:

```typescript
import { initInventoryTables, upsertCountEntry, deleteCountEntry, getSessionEntries, getSession, setCountPhotos, getCountPhotosMap } from '@/lib/inventory-db';
```

Replace the GET handler so entries include photos:

```typescript
export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const entries = getSessionEntries(parseInt(sessionId));
  const photoMap = getCountPhotosMap('count_entries', entries.map((e: any) => e.id));
  const hydrated = entries.map((e: any) => ({ ...e, photos: photoMap[e.id] || [] }));

  // Fetch system quantities from Odoo stock.quant
  const systemQtys: Record<number, number> = {};
  try {
    const session = getSession(parseInt(sessionId));
    if (session) {
      const odoo = getOdoo();
      const quants = await odoo.searchRead('stock.quant',
        [['location_id', '=', session.location_id], ['quantity', '>', 0]],
        ['product_id', 'quantity'],
        { limit: 1000 },
      );
      for (const q of quants) {
        if (q.product_id) {
          const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
          systemQtys[pid] = (systemQtys[pid] || 0) + q.quantity;
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch system quantities from Odoo:', e);
  }

  return NextResponse.json({ entries: hydrated, system_qtys: systemQtys });
}
```

Replace the POST handler so photos are persisted on upsert:

```typescript
export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { session_id, product_id, counted_qty, system_qty, uom, notes, photos } = body;

  if (!session_id || !product_id || counted_qty === undefined) {
    return NextResponse.json({ error: 'session_id, product_id, counted_qty required' }, { status: 400 });
  }

  upsertCountEntry({
    session_id, product_id, counted_qty,
    system_qty: system_qty ?? null,
    uom: uom || 'Units',
    notes,
    counted_by: user.id,
  });

  // If photos are included in the body, replace the photo set for this line.
  if (Array.isArray(photos)) {
    // Need the entry id — look it up by session + product
    const entries = getSessionEntries(session_id);
    const entry = entries.find((e: any) => e.product_id === product_id);
    if (entry) setCountPhotos('count_entries', entry.id, photos);
  }

  return NextResponse.json({ message: 'Count saved' });
}
```

- [ ] **Step 4: Validate photos at session submit**

Edit `src/app/api/inventory/sessions/route.ts`. Find the PUT handler
(where `status === 'submitted'` is handled). Before the actual status
update, add validation:

```typescript
    if (status === 'submitted') {
      // Enforce photo requirement: for any flagged product with qty > 0,
      // there must be at least one photo attached.
      const entries = getSessionEntries(id);
      const productIds = entries.map((e: any) => e.product_id);
      const flags = getProductFlags(productIds);
      const flagMap: Record<number, boolean> = {};
      flags.forEach((f: any) => { flagMap[f.odoo_product_id] = !!f.requires_photo; });
      const photoMap = getCountPhotosMap('count_entries', entries.map((e: any) => e.id));

      const missing = entries.filter((e: any) =>
        flagMap[e.product_id] && e.counted_qty > 0 && (photoMap[e.id]?.length || 0) === 0
      );
      if (missing.length > 0) {
        return NextResponse.json({
          error: `${missing.length} item${missing.length !== 1 ? 's' : ''} still need a photo`,
        }, { status: 400 });
      }
    }
```

Update imports at the top of `sessions/route.ts`:

```typescript
import { initInventoryTables, /* ... existing ... */ getSessionEntries, getProductFlags, getCountPhotosMap } from '@/lib/inventory-db';
```

(Keep the existing imports — just add the three new names alongside
them.)

- [ ] **Step 5: Confirm submit error handling already covers 400 responses**

CountingSession's existing `handleSubmit` already captures `!res.ok`
into `setSubmitError(data.error || ...)` (around line 228-231 in the
current file). The server-side validation added in Step 4 will return
a 400 with `{ error: "N items still need a photo" }`, which the
existing error-display UI will render without changes. Just verify
by reading the existing handleSubmit:

```bash
grep -n "setSubmitError\|!res.ok" src/components/inventory/CountingSession.tsx | head -5
```

Expected: at least one `setSubmitError(data.error || ...)` line. No
code change needed in this step.

- [ ] **Step 6: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -10
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory/CountingSession.tsx \
        src/app/api/inventory/counts/route.ts \
        src/app/api/inventory/sessions/route.ts
git commit -m "[ADD] inventory: Counting Session photo capture + server submit gate"
```

---

## Task 8: ReviewSubmissions — thumbnail strip + lightbox

**Files:**
- Modify: `src/components/inventory/ReviewSubmissions.tsx`

- [ ] **Step 1: Import PhotoLightbox and add state**

Add at the top of `ReviewSubmissions.tsx`:

```typescript
import PhotoLightbox from './PhotoLightbox';
```

Near the other state (e.g. after `draftDecisions`), add:

```typescript
  const [lightbox, setLightbox] = useState<{ open: boolean; photos: string[]; index: number }>({ open: false, photos: [], index: 0 });
```

- [ ] **Step 2: Render thumbnail strip on count rows that have photos**

Inside the existing `countedProducts.map((p: any) => { ... })` block,
in the JSX where the row currently renders name, variance, and qty,
find the `<div className="flex items-center gap-2 flex-wrap">` that
holds the name and pending pills. Below that flex block, within the
`<div className="min-w-0">`, add a thumbnail strip row:

```tsx
{(() => {
  const entry = reviewEntries.find((e: any) => e.product_id === p.id);
  const entryPhotos: string[] = (entry?.photos || []) as string[];
  if (entryPhotos.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      {entryPhotos.map((src: string, i: number) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); setLightbox({ open: true, photos: entryPhotos, index: i }); }}
          className="w-8 h-8 rounded-md overflow-hidden border border-gray-200 bg-gray-100 active:opacity-70"
          aria-label={`View photo ${i + 1}`}
        >
          <img src={src} alt="" className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );
})()}
```

- [ ] **Step 3: Mount the lightbox at the end of the component**

Find the closing `</div>` of the main component return. Immediately
before it, add:

```tsx
<PhotoLightbox
  open={lightbox.open}
  photos={lightbox.photos}
  initialIndex={lightbox.index}
  onClose={() => setLightbox({ open: false, photos: [], index: 0 })}
/>
```

- [ ] **Step 4: Quick-count review — add photos on the detail view**

Find the quick-count detail view (it's the block that renders when
`reviewQC` is set, around line 181 in the original file). Below the
product info, add the photo strip if any. Inside that detail view, add:

```tsx
{Array.isArray(reviewQC?.photos) && reviewQC.photos.length > 0 && (
  <div className="px-4 pt-3">
    <div className="flex items-center gap-2">
      {reviewQC.photos.map((src: string, i: number) => (
        <button
          key={i}
          onClick={() => setLightbox({ open: true, photos: reviewQC.photos, index: i })}
          className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 active:opacity-70"
        >
          <img src={src} alt="" className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 5: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build 2>&1 | tail -10
test -f .next/BUILD_ID && echo "OK: $(cat .next/BUILD_ID)" || echo "FAILED"
```

- [ ] **Step 6: Commit**

```bash
git add src/components/inventory/ReviewSubmissions.tsx
git commit -m "[ADD] inventory: review thumbnails + fullscreen photo viewer"
```

---

## Task 9: Manual verification + deploy

- [ ] **Step 1: Local verify**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run dev
```

Open http://localhost:3000. Log in as Marco Bauer (manager).

- Navigate to Inventory → Product settings → toggle "Requires photo"
  on some product (e.g. "Test Pork Belly" or any existing product).
- Log out, log in as Hana Kim (staff).
- Inventory → Quick Count → pick a location → find the flagged
  product → enter qty → confirm the amber "Photo required" pill appears
  and the camera button is visible below the row.
- Tap submit WITHOUT a photo → expect red error "1 item still needs a
  photo."
- Tap camera → take a photo → thumbnail appears → submit → success.
- Log in as Marco → Inventory → Review submissions → find the quick
  count → confirm thumbnail is visible → tap → lightbox opens
  fullscreen → swipe/dots work → close.

- [ ] **Step 2: Verify scheduled session path**

- As Marco, ensure a counting template exists that covers the flagged
  product (use Manage templates if needed).
- As Hana, open My Lists → open today's session → count the flagged
  product → attempt submit without photo → expect error → add photo →
  submit.
- As Marco, review the submission → thumbnail visible → tap → lightbox.

- [ ] **Step 3: Verify unflagged products still work**

- Pick a non-flagged product, count it, submit — should not require a
  photo, should not show a camera button.

- [ ] **Step 4: Push + deploy**

```bash
git push -u origin feat/inventory-photo-proof
ssh root@89.167.124.0 "cd /opt/krawings-portal && git fetch && \
  git checkout feat/inventory-photo-proof && git pull && \
  npm run build 2>&1 | tail -6 && test -f .next/BUILD_ID && \
  echo DEPLOY_OK: \$(cat .next/BUILD_ID) && \
  systemctl restart krawings-portal && echo RESTART_OK"
```

Expected: DEPLOY_OK with a BUILD_ID, then RESTART_OK.

- [ ] **Step 5: Browser smoke check on staging**

Open http://89.167.124.0:3000. Log in as Marco, run through Step 1
again on staging to verify the deploy.

---

## Rollback

Each task commits independently. Rollback one commit at a time:

```bash
git revert <commit_hash>
git push
```

To roll back the deployed version:

```bash
ssh root@89.167.124.0 "cd /opt/krawings-portal && git checkout main && \
  git pull && npm run build && systemctl restart krawings-portal"
```

## Regression checklist

- [ ] Unflagged products can be counted and submitted with no photo
- [ ] Existing session-level `proof_photo` capture still works (unchanged)
- [ ] Quick Count submit with no flagged products still works
- [ ] Draft product rejection also removes photos (tested via reject
  flow from scan-to-count feature)
- [ ] Desktop view untouched (all changes wrapped in mobile-first
  components using existing responsive classes)
