# KDS Phase 2 — POS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace KDS mock data with live Odoo POS orders — poll every 5s, map to existing UI, write back "done" when cook marks READY.

**Architecture:** Portal API routes call Odoo JSON-RPC (`OdooClient.searchRead`) to fetch paid orders, and `OdooClient.write` to mark orders done. KDS frontend polls the portal API instead of using mock data. Item checkoff and recall stay client-side.

**Tech Stack:** Next.js 14, OdooClient (JSON-RPC), better-sqlite3, React Context

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/types/kds.ts` | Modify | Add `posConfigId` to KdsSettings |
| `src/lib/kds-db.ts` | Modify | Add `pos_config_id` column + migration |
| `src/app/api/kds/orders/route.ts` | Create | GET — fetch paid orders from Odoo |
| `src/app/api/kds/orders/done/route.ts` | Create | POST — mark order done in Odoo |
| `src/lib/kds/state.tsx` | Modify | Replace mock data with polling, wire markReady to API |
| `src/components/kds/SettingsPanel.tsx` | Modify | Add POS Config ID field |

---

### Task 1: Add posConfigId to Types and Database

**Files:**
- Modify: `src/types/kds.ts`
- Modify: `src/lib/kds-db.ts`

- [ ] **Step 1: Add posConfigId to KdsSettings interface**

In `src/types/kds.ts`, add to the `KdsSettings` interface after `autoScrollSec`:

```typescript
  autoScrollSec: number;
  posConfigId: number; // Odoo pos.config ID (0 = use mock data)
```

And in `DEFAULT_SETTINGS`:

```typescript
  autoScrollSec: 10,
  posConfigId: 0,
```

- [ ] **Step 2: Add pos_config_id column to database**

In `src/lib/kds-db.ts`, add to the `CREATE TABLE kds_settings` statement after `auto_scroll_sec`:

```sql
      auto_scroll_sec INTEGER DEFAULT 10,
      pos_config_id INTEGER DEFAULT 0,
```

Add migration after the existing `auto_scroll_sec` migration:

```typescript
  if (!cols.some(c => c.name === 'pos_config_id')) {
    db.exec('ALTER TABLE kds_settings ADD COLUMN pos_config_id INTEGER DEFAULT 0');
  }
```

In `getKdsSettings`, add to the return object:

```typescript
    autoScrollSec: (row.auto_scroll_sec as number) ?? 10,
    posConfigId: (row.pos_config_id as number) ?? 0,
```

In `saveKdsSettings`, update the INSERT/UPDATE to include `pos_config_id`:

Change the column list:
```
...auto_scroll_sec, pos_config_id, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Add to ON CONFLICT SET:
```
auto_scroll_sec=excluded.auto_scroll_sec, pos_config_id=excluded.pos_config_id, updated_at=excluded.updated_at
```

Add to `.run()` params:
```
    s.autoScrollSec, s.posConfigId, nowISO()
```

- [ ] **Step 3: Commit**

```bash
git add src/types/kds.ts src/lib/kds-db.ts
git commit -m "[ADD] kds: posConfigId setting for Odoo POS integration"
```

---

### Task 2: API Route — Fetch Orders from Odoo

**Files:**
- Create: `src/app/api/kds/orders/route.ts`

- [ ] **Step 1: Create the orders API route**

```typescript
// src/app/api/kds/orders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { OdooClient } from '@/lib/odoo';
import { getKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    const configId = Number(req.nextUrl.searchParams.get('configId')) || settings.posConfigId;

    if (!configId) {
      return NextResponse.json({ orders: [], error: 'No POS config ID set' });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    // Fetch paid orders for this POS config
    const rawOrders = await odoo.searchRead(
      'pos.order',
      [
        ['state', '=', 'paid'],
        ['config_id', '=', configId],
      ],
      ['id', 'name', 'tracking_number', 'date_order', 'takeaway', 'amount_total', 'general_note'],
      { order: 'date_order ASC', limit: 50 }
    );

    if (rawOrders.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    const orderIds = rawOrders.map((o: any) => o.id);

    // Fetch all lines for these orders in one call
    const rawLines = await odoo.searchRead(
      'pos.order.line',
      [['order_id', 'in', orderIds]],
      ['id', 'order_id', 'full_product_name', 'qty', 'note', 'customer_note'],
      { limit: 500 }
    );

    // Group lines by order_id
    const linesByOrder: Record<number, any[]> = {};
    for (const line of rawLines) {
      const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      if (!linesByOrder[oid]) linesByOrder[oid] = [];
      linesByOrder[oid].push(line);
    }

    // Map to KdsOrder shape
    const now = Date.now();
    const orders = rawOrders.map((o: any) => {
      const orderDate = new Date(o.date_order.replace(' ', 'T') + 'Z');
      const waitMin = Math.max(0, Math.floor((now - orderDate.getTime()) / 60000));
      const lines = linesByOrder[o.id] || [];
      const trackingNum = o.tracking_number
        ? String(o.tracking_number)
        : o.name?.split('/').pop() || String(o.id);

      return {
        id: o.id,
        table: `#${trackingNum}`,
        type: o.takeaway ? 'Takeaway' : 'Dine-in',
        waitMin,
        status: 'prep',
        readyAt: null,
        doneAt: null,
        items: lines.map((l: any) => ({
          id: String(l.id),
          name: l.full_product_name || 'Unknown',
          qty: l.qty || 1,
          note: l.note || l.customer_note || undefined,
          done: false,
        })),
      };
    });

    return NextResponse.json({ orders });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] orders fetch error:', msg);
    return NextResponse.json({ orders: [], error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/kds/orders/route.ts
git commit -m "[ADD] kds: API route to fetch paid POS orders from Odoo"
```

---

### Task 3: API Route — Mark Order Done in Odoo

**Files:**
- Create: `src/app/api/kds/orders/done/route.ts`

- [ ] **Step 1: Create the done API route**

```typescript
// src/app/api/kds/orders/done/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { OdooClient } from '@/lib/odoo';

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json() as { orderId: number };

    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    // Write state directly — pos.order allows paid -> done
    await odoo.write('pos.order', [orderId], { state: 'done' });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] mark done error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/kds/orders/done/route.ts
git commit -m "[ADD] kds: API route to mark POS order done in Odoo"
```

---

### Task 4: Replace Mock Data with Odoo Polling in State Context

**Files:**
- Modify: `src/lib/kds/state.tsx`

- [ ] **Step 1: Replace mock initialization and add polling**

Replace the state context to:
- Start with empty orders when `posConfigId > 0`
- Poll `/api/kds/orders` every 5 seconds when connected to Odoo
- Fall back to mock data when `posConfigId === 0` (development)
- Merge polled orders with local state (preserve item checkoff)
- Call `/api/kds/orders/done` when marking ready

The key changes in `KdsProvider`:

```typescript
'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { KdsOrder, KdsTab, RoundState, KdsSettings, KdsMode } from '@/types/kds';
import { DEFAULT_SETTINGS } from '@/types/kds';
import { createSeedOrders, generateRandomOrder } from './mockData';

// ... interfaces stay the same ...

export function KdsProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [roundState, setRoundState] = useState<RoundState>('idle');
  const [firedOrderIds, setFiredOrderIds] = useState<number[]>([]);
  const [currentTab, setCurrentTab] = useState<KdsTab>('prep');
  const [mode, setModeState] = useState<KdsMode>('smart');
  const [settings, setSettings] = useState<KdsSettings>(DEFAULT_SETTINGS);
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const nextIdRef = useRef(8);
  const checkedItemsRef = useRef<Set<string>>(new Set());

  // Load settings from API on mount
  useEffect(() => {
    fetch('/api/kds/settings')
      .then(r => r.json())
      .then(data => {
        if (data.locationId) setSettings(data);
        // If no POS config, load mock data
        if (!data.posConfigId) setOrders(createSeedOrders());
      })
      .catch(() => { setOrders(createSeedOrders()); });
  }, []);

  // Poll Odoo for orders when posConfigId is set
  useEffect(() => {
    if (!settings.posConfigId) return;

    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/kds/orders?configId=${settings.posConfigId}`);
        const data = await res.json();
        if (!active || !data.orders) return;

        const odooOrders: KdsOrder[] = data.orders.map((o: KdsOrder) => ({
          ...o,
          items: o.items.map(item => ({
            ...item,
            done: checkedItemsRef.current.has(`${o.id}:${item.id}`),
          })),
        }));

        setOrders(prev => {
          // Keep locally ready/done orders that Odoo no longer returns as 'paid'
          const odooIds = new Set(odooOrders.map(o => o.id));
          const localOnly = prev.filter(o => o.status !== 'prep' && !odooIds.has(o.id));
          // Keep orders that were moved to ready/done locally
          const localReadyDone = prev.filter(o => (o.status === 'ready' || o.status === 'done') && odooIds.has(o.id));
          const localReadyDoneIds = new Set(localReadyDone.map(o => o.id));
          // Odoo orders that haven't been locally moved to ready/done
          const newPrep = odooOrders.filter(o => !localReadyDoneIds.has(o.id));
          return [...newPrep, ...localReadyDone, ...localOnly];
        });
      } catch (err) {
        console.error('[KDS] poll error:', err);
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [settings.posConfigId]);

  // Mock: simulate new orders in dev when no POS config
  useEffect(() => {
    if (settings.posConfigId) return;
    if (process.env.NODE_ENV !== 'development') return;
    const interval = setInterval(() => {
      const newOrder = generateRandomOrder(nextIdRef.current++);
      setOrders(prev => [...prev, newOrder]);
    }, 25000);
    return () => clearInterval(interval);
  }, [settings.posConfigId]);

  // Mock: increment wait times when using mock data
  useEffect(() => {
    if (settings.posConfigId) return;
    const interval = setInterval(() => {
      setOrders(prev => prev.map(o => ({ ...o, waitMin: o.waitMin + 1 })));
    }, 30000);
    return () => clearInterval(interval);
  }, [settings.posConfigId]);

  // ... fireRound, nextRound stay the same ...

  const toggleItem = useCallback((itemId: string, ticketId: number) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== ticketId) return o;
      return { ...o, items: o.items.map(i => {
        if (i.id !== itemId) return i;
        const newDone = !i.done;
        const key = `${ticketId}:${itemId}`;
        if (newDone) checkedItemsRef.current.add(key);
        else checkedItemsRef.current.delete(key);
        return { ...i, done: newDone };
      })};
    }));
  }, []);

  const markReady = useCallback((ticketId: number) => {
    setOrders(prev => prev.map(o =>
      o.id === ticketId ? { ...o, status: 'ready' as const, readyAt: Date.now() } : o
    ));
    setFiredOrderIds(prev => prev.filter(id => id !== ticketId));
    // Clear checked items for this order
    checkedItemsRef.current.forEach(key => {
      if (key.startsWith(`${ticketId}:`)) checkedItemsRef.current.delete(key);
    });
    // Notify Odoo (fire and forget)
    if (settings.posConfigId) {
      fetch('/api/kds/orders/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ticketId }),
      }).catch(err => console.error('[KDS] mark done error:', err));
    }
  }, [settings.posConfigId]);

  // ... pickup, recall, setTab, toggleMute, etc. stay the same ...
  // recall should also clear checkedItemsRef for the order:

  const recall = useCallback((ticketId: number) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== ticketId) return o;
      return {
        ...o,
        status: 'prep' as const,
        readyAt: null,
        doneAt: null,
        items: o.items.map(i => ({ ...i, done: false })),
      };
    }));
    checkedItemsRef.current.forEach(key => {
      if (key.startsWith(`${ticketId}:`)) checkedItemsRef.current.delete(key);
    });
    setCurrentTab('prep');
  }, []);

  // ... rest of provider stays the same ...
}
```

**Key behavioral changes:**
- `posConfigId === 0`: mock data mode (same as Phase 1)
- `posConfigId > 0`: polls Odoo every 5 seconds
- `checkedItemsRef`: tracks which items the cook checked off locally, preserved across polls
- `markReady`: calls `/api/kds/orders/done` to write `state='done'` to Odoo
- Orders that Odoo returns as `paid` but were locally marked `ready`/`done` are kept in their local state
- When Odoo stops returning an order (because it became `done` in Odoo), it's removed from prep but kept if locally in ready/done

- [ ] **Step 2: Commit**

```bash
git add src/lib/kds/state.tsx
git commit -m "[IMP] kds: replace mock data with Odoo POS polling when posConfigId is set"
```

---

### Task 5: Add POS Config ID to Settings Panel

**Files:**
- Modify: `src/components/kds/SettingsPanel.tsx`

- [ ] **Step 1: Add POS Config ID field**

Add a new section at the top of the settings panel, before Timer Thresholds:

```typescript
        <div className="kds-settings-section">
          <div className="kds-settings-section-title">Odoo POS Connection</div>
          <NumRow label="POS Config ID" value={draft.posConfigId} onChange={v => setField('posConfigId', v)} />
          <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 0 4px' }}>
            Set to the Odoo POS config ID for What a Jerk. Set to 0 for mock data.
          </div>
        </div>
```

Insert this block right after `<div className="kds-settings-title">KDS Settings</div>` and before the Timer Thresholds section.

- [ ] **Step 2: Commit**

```bash
git add src/components/kds/SettingsPanel.tsx
git commit -m "[ADD] kds: POS Config ID setting in settings panel"
```

---

### Task 6: Build, Test, Deploy

- [ ] **Step 1: Run build**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

Fix any TypeScript errors.

- [ ] **Step 2: Commit fixes if any**

```bash
git add -A
git commit -m "[FIX] kds: resolve Phase 2 build errors"
```

- [ ] **Step 3: Push and deploy**

```bash
git push
ssh root@89.167.124.0 "cd /opt/krawings-portal && git pull origin feature/kds-phase-1 && npm run build && systemctl restart krawings-portal"
```

- [ ] **Step 4: Verify mock data mode still works**

Open `portal.krawings.de/kds` — with `posConfigId = 0` (default), mock data should still load and work exactly as before.

- [ ] **Step 5: Test Odoo connection (when POS is set up)**

Once a POS config exists for What a Jerk:
1. Open KDS settings
2. Enter the POS config ID
3. Save
4. KDS should start showing paid orders from Odoo
5. Check items off, tap READY
6. Verify order state changes to `done` in Odoo

---

## Definition of Done

- [ ] `posConfigId = 0` loads mock data (Phase 1 behavior preserved)
- [ ] `posConfigId > 0` polls Odoo every 5 seconds for paid orders
- [ ] Orders appear on KDS within 5 seconds of payment in POS
- [ ] Item checkoff persists across poll cycles
- [ ] READY writes `state = 'done'` to Odoo
- [ ] Recall stays local (does not revert Odoo state)
- [ ] Poll errors show in console, KDS keeps last good data
- [ ] Settings panel has POS Config ID field
- [ ] `npm run build` passes
- [ ] Deployed to staging
