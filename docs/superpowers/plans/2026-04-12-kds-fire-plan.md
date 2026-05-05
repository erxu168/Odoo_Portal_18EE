# KDS Fire Plan Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the cook presses Fire, the KDS produces an optimized cook plan: items grouped by prep priority (ondemand → batch → advance), batched by station, with identical items consolidated across orders.

**Architecture:** A new `buildFirePlan()` pure function in `priority.ts` takes fired orders + product config, returns station-grouped, priority-sorted task lanes. A new `FirePlanView` component replaces the existing task strip during an active round. Product config is served via a new API route and loaded into KDS state on mount.

**Tech Stack:** Next.js 14, React, TypeScript, SQLite (better-sqlite3), existing KDS component system

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/kds.ts` | Modify | Add `PrepType`, `ProductConfig`, `FireLane`, `FireTask` types |
| `src/lib/kds-db.ts` | Modify | Add `getProductConfig()` read function |
| `src/app/api/kds/product-config/route.ts` | Create | GET endpoint returning product config as JSON |
| `src/lib/kds/priority.ts` | Modify | Add `buildFirePlan()` function |
| `src/lib/kds/state.tsx` | Modify | Load product config on mount, expose via context |
| `src/components/kds/FirePlanView.tsx` | Create | Renders the fire plan lanes during active round |
| `src/app/kds/page.tsx` | Modify | Swap task strip for FirePlanView during active round |
| `src/app/kds/kds.css` | Modify | Add fire plan CSS |

---

### Task 1: Add types

**Files:**
- Modify: `src/types/kds.ts`

- [ ] **Step 1: Add fire plan types to kds.ts**

Add after the `TaskGroup` interface (around line 143):

```typescript
// -- Fire plan types --

export type PrepType = 'ondemand' | 'batch' | 'advance';

export interface ProductConfig {
  productName: string;
  sourceStation: SourceStation;
  prepType: PrepType;
}

export interface FireTask {
  name: string;
  totalQty: number;
  doneQty: number;
  tables: string[];
  entries: TaskEntry[];
  sourceStation: SourceStation;
  prepType: PrepType;
}

export interface FireLane {
  prepType: PrepType;
  label: string;
  emoji: string;
  tasks: FireTask[];
}

export const PREP_TYPE_ORDER: PrepType[] = ['ondemand', 'batch', 'advance'];

export const PREP_TYPE_META: Record<PrepType, { label: string; emoji: string; description: string }> = {
  ondemand: { label: 'START NOW', emoji: '\u{1F534}', description: 'Cook fresh — bottleneck' },
  batch:    { label: 'BATCH',     emoji: '\u{1F7E1}', description: 'Cook together in groups' },
  advance:  { label: 'PLATE',     emoji: '\u{1F7E2}', description: 'Already prepped — just plate' },
};
```

- [ ] **Step 2: Add productConfig to KdsState interface in state.tsx types**

In `src/lib/kds/state.tsx`, add to the `KdsState` interface:

```typescript
productConfig: ProductConfig[];
```

- [ ] **Step 3: Commit**

```bash
git add src/types/kds.ts src/lib/kds/state.tsx
git commit -m "[ADD] kds: fire plan types (PrepType, ProductConfig, FireTask, FireLane)"
```

---

### Task 2: Add product config read function and API route

**Files:**
- Modify: `src/lib/kds-db.ts`
- Create: `src/app/api/kds/product-config/route.ts`

- [ ] **Step 1: Add getProductConfig() to kds-db.ts**

Add after the `saveKdsSettings` function:

```typescript
// -- Product config read --

export interface ProductConfigRow {
  product_name: string;
  source_station: string;
  prep_type: string;
}

export function getProductConfig(locationId: number): ProductConfigRow[] {
  ensureTables();
  const db = getDb();
  return db.prepare(
    'SELECT product_name, source_station, prep_type FROM kds_product_config WHERE location_id = ?'
  ).all(locationId) as ProductConfigRow[];
}
```

- [ ] **Step 2: Create the API route**

Create `src/app/api/kds/product-config/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getProductConfig } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = getProductConfig(KDS_LOCATION_ID);
    const config = rows.map(r => ({
      productName: r.product_name,
      sourceStation: r.source_station,
      prepType: r.prep_type,
    }));
    return NextResponse.json({ config });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ config: [], error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/kds-db.ts src/app/api/kds/product-config/route.ts
git commit -m "[ADD] kds: product config API route and db read function"
```

---

### Task 3: Load product config into KDS state

**Files:**
- Modify: `src/lib/kds/state.tsx`

- [ ] **Step 1: Import ProductConfig type**

Add to imports at top of state.tsx:

```typescript
import type { KdsOrder, KdsTab, RoundState, KdsSettings, KdsMode, ProductConfig } from '@/types/kds';
```

- [ ] **Step 2: Add productConfig state and load on mount**

Inside `KdsProvider`, after the `checkedItemsRef` line (~line 57), add:

```typescript
const [productConfig, setProductConfig] = useState<ProductConfig[]>([]);
```

In the existing settings load `useEffect` (the one that calls `/api/kds/settings`), add a parallel fetch for product config. Replace the entire useEffect (~lines 60-69) with:

```typescript
  // Load settings and product config from API on mount
  useEffect(() => {
    fetch('/api/kds/settings')
      .then(r => r.json())
      .then(data => {
        if (data.locationId) setSettings(data);
        if (!data.posConfigId) setOrders(createSeedOrders());
      })
      .catch(() => { setOrders(createSeedOrders()); });

    fetch('/api/kds/product-config')
      .then(r => r.json())
      .then(data => {
        if (data.config) setProductConfig(data.config);
      })
      .catch(() => {});
  }, []);
```

- [ ] **Step 3: Expose productConfig in context value**

In the `value` object (~line 230), add `productConfig`:

```typescript
  const value: KdsContextType = {
    orders, roundState, firedOrderIds, currentTab, mode, settings, muted, settingsOpen,
    nextId: nextIdRef.current, productConfig,
    fireRound, nextRound, toggleItem, markReady, pickup, recall,
    setTab, toggleMute, openSettings, closeSettings, updateSettings, addOrder, setMode,
  };
```

Also add `productConfig: ProductConfig[]` to the `KdsState` interface at the top of the file.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kds/state.tsx
git commit -m "[ADD] kds: load product config into state on mount"
```

---

### Task 4: Build the fire plan algorithm

**Files:**
- Modify: `src/lib/kds/priority.ts`

- [ ] **Step 1: Add imports**

Add to the import line at top of priority.ts:

```typescript
import type { KdsOrder, KdsSettings, TimerTier, TaskGroup, OrderType, ProductConfig, FireLane, FireTask, PrepType, SourceStation } from '@/types/kds';
import { SOURCES, PREP_TYPE_ORDER, PREP_TYPE_META } from '@/types/kds';
```

- [ ] **Step 2: Add buildFirePlan function**

Add at the end of `priority.ts`:

```typescript
/**
 * Build a fire plan: items grouped by prep priority, batched by station,
 * identical items consolidated across orders.
 *
 * Priority order: ondemand (bottleneck, start first) → batch → advance (just plate)
 * Within each lane: sorted by urgency (longest wait first)
 * Identical items across orders consolidated into one task
 */
export function buildFirePlan(
  orders: KdsOrder[],
  boost: number,
  productConfig: ProductConfig[],
): FireLane[] {
  // Build a lookup: product name → { sourceStation, prepType }
  const configMap = new Map<string, { sourceStation: SourceStation; prepType: PrepType }>();
  for (const pc of productConfig) {
    configMap.set(pc.productName, {
      sourceStation: pc.sourceStation as SourceStation,
      prepType: pc.prepType as PrepType,
    });
  }

  // Fallback: use SOURCES map for station, default to 'ondemand' for prep type
  function getConfig(itemName: string): { sourceStation: SourceStation; prepType: PrepType } {
    const fromDb = configMap.get(itemName);
    if (fromDb) return fromDb;
    const fromSources = SOURCES[itemName];
    return {
      sourceStation: fromSources?.source || 'cold',
      prepType: 'ondemand',
    };
  }

  // Group items by name (consolidate identical items across orders)
  const taskMap: Record<string, FireTask> = {};

  for (const order of orders) {
    for (const item of order.items) {
      const cfg = getConfig(item.name);
      if (!taskMap[item.name]) {
        taskMap[item.name] = {
          name: item.name,
          totalQty: 0,
          doneQty: 0,
          tables: [],
          entries: [],
          sourceStation: cfg.sourceStation,
          prepType: cfg.prepType,
        };
      }
      const task = taskMap[item.name];
      task.totalQty += item.qty;
      if (item.done) task.doneQty += item.qty;
      if (!task.tables.includes(order.table)) task.tables.push(order.table);
      task.entries.push({
        ticketId: order.id,
        itemId: item.id,
        qty: item.qty,
        table: order.table,
        type: order.type,
        note: item.note || null,
        done: item.done,
        waitMin: order.waitMin,
        effectiveWait: effectiveWait(order, boost),
      });
    }
  }

  // Sort entries within each task by urgency (most urgent first, done last)
  const tasks = Object.values(taskMap);
  for (const task of tasks) {
    task.entries.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return b.effectiveWait - a.effectiveWait;
    });
  }

  // Group tasks into lanes by prep type
  const lanes: FireLane[] = [];
  for (const prepType of PREP_TYPE_ORDER) {
    const meta = PREP_TYPE_META[prepType];
    const laneTasks = tasks
      .filter(t => t.prepType === prepType && t.totalQty > t.doneQty)
      .sort((a, b) => {
        // Sort by max urgency of undone entries
        const aMax = Math.max(...a.entries.filter(e => !e.done).map(e => e.effectiveWait), 0);
        const bMax = Math.max(...b.entries.filter(e => !e.done).map(e => e.effectiveWait), 0);
        return bMax - aMax;
      });

    if (laneTasks.length > 0) {
      lanes.push({
        prepType,
        label: meta.label,
        emoji: meta.emoji,
        tasks: laneTasks,
      });
    }
  }

  return lanes;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/kds/priority.ts
git commit -m "[ADD] kds: buildFirePlan algorithm — prep-type lanes with batched tasks"
```

---

### Task 5: Build the FirePlanView component

**Files:**
- Create: `src/components/kds/FirePlanView.tsx`

- [ ] **Step 1: Create FirePlanView.tsx**

```tsx
'use client';

import { useKds } from '@/lib/kds/state';
import { buildFirePlan, effectiveWait, timerTier } from '@/lib/kds/priority';
import { SOURCES } from '@/types/kds';
import type { FireLane, FireTask } from '@/types/kds';
import Timer from './Timer';
import SourceBadge from './SourceBadge';
import TakeawayBag from './TakeawayBag';

export default function FirePlanView() {
  const { orders, firedOrderIds, settings, productConfig, toggleItem } = useKds();
  const boost = settings.takeawayBoost;

  const firedOrders = orders
    .filter(o => firedOrderIds.includes(o.id) && o.status === 'prep')
    .sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));

  const lanes = buildFirePlan(firedOrders, boost, productConfig);

  if (lanes.length === 0) {
    return (
      <div className="kds-fire-plan">
        <div className="kds-empty">
          <div className="kds-empty-icon">{'\u2705'}</div>
          <div>All items served — mark tables Ready</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kds-fire-plan">
      {lanes.map(lane => (
        <LaneSection key={lane.prepType} lane={lane} />
      ))}

      <PassReadiness orders={firedOrders} />
    </div>
  );
}

function LaneSection({ lane }: { lane: FireLane }) {
  const { toggleItem, settings } = useKds();

  return (
    <div className={`kds-fp-lane kds-fp-lane--${lane.prepType}`}>
      <div className="kds-fp-lane-header">
        <span className="kds-fp-lane-emoji">{lane.emoji}</span>
        <span className="kds-fp-lane-label">{lane.label}</span>
      </div>
      <div className="kds-fp-tasks">
        {lane.tasks.map(task => (
          <TaskRow key={task.name} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: FireTask }) {
  const { toggleItem, settings } = useKds();
  const src = SOURCES[task.name];
  const remaining = task.totalQty - task.doneQty;
  const allDone = remaining === 0;

  return (
    <div className={`kds-fp-task ${allDone ? 'all-done' : ''}`}>
      <div className="kds-fp-task-head">
        <span className="kds-fp-task-qty">{remaining > 0 ? `${remaining}x` : '\u2713'}</span>
        <span className="kds-fp-task-name">{task.name}</span>
        {src && (
          <span className="kds-s-source" style={{ background: src.bg, color: src.color, fontSize: '9px' }}>
            {src.label}
          </span>
        )}
      </div>
      <div className="kds-fp-task-tables">
        {task.entries.map(entry => {
          const tier = timerTier(entry.waitMin, entry.type, settings);
          return (
            <div
              key={entry.itemId}
              className={`kds-fp-entry ${entry.done ? 'done' : ''}`}
              onClick={() => toggleItem(entry.itemId, entry.ticketId)}
            >
              <div className={`kds-fp-check ${entry.done ? 'checked' : ''}`}>
                {entry.done && (
                  <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" width="10" height="10">
                    <path d="M3 8.5l3.5 3.5 6.5-7" />
                  </svg>
                )}
              </div>
              <span className="kds-fp-entry-qty">{entry.qty}x</span>
              <span className="kds-fp-entry-table">{entry.table}</span>
              {entry.type === 'Takeaway' && <TakeawayBag />}
              <Timer minutes={entry.waitMin} tier={tier} size="sm" />
              {entry.note && <span className="kds-s-note">{entry.note}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PassReadiness({ orders }: { orders: typeof import('@/types/kds').KdsOrder[] }) {
  if (orders.length === 0) return null;

  return (
    <div className="kds-fp-pass">
      <div className="kds-fp-pass-header">PASS READINESS</div>
      {orders.map(o => {
        const done = o.items.filter(i => i.done).length;
        const total = o.items.length;
        const allDone = done === total;
        const waiting = o.items.filter(i => !i.done).map(i => i.name);

        return (
          <div key={o.id} className={`kds-fp-pass-row ${allDone ? 'ready' : ''}`}>
            <span className="kds-fp-pass-table">{o.table}</span>
            <span className="kds-fp-pass-status">
              {allDone ? '\u2705 READY' : `${done}/${total} — waiting: ${waiting.join(', ')}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/kds/FirePlanView.tsx
git commit -m "[ADD] kds: FirePlanView component — lane-based fire plan UI"
```

---

### Task 6: Add fire plan CSS

**Files:**
- Modify: `src/app/kds/kds.css`

- [ ] **Step 1: Add fire plan styles**

Add at the end of `kds.css`:

```css
/* ── Fire Plan ── */
.kds-fire-plan { display: flex; flex-direction: column; gap: 12px; padding: 8px; overflow-y: auto; height: 100%; }

.kds-fp-lane { background: var(--surface); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
.kds-fp-lane--ondemand { border-left: 4px solid #ef4444; }
.kds-fp-lane--batch    { border-left: 4px solid #eab308; }
.kds-fp-lane--advance  { border-left: 4px solid #22c55e; }

.kds-fp-lane-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.kds-fp-lane-emoji { font-size: 16px; }
.kds-fp-lane-label { font-size: 13px; font-weight: 800; letter-spacing: 0.08em; color: var(--text); }

.kds-fp-tasks { display: flex; flex-direction: column; }

.kds-fp-task { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.kds-fp-task.all-done { opacity: 0.4; }
.kds-fp-task-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.kds-fp-task-qty { font-size: 16px; font-weight: 800; color: var(--text); min-width: 30px; }
.kds-fp-task-name { font-size: 14px; font-weight: 700; color: var(--text); }

.kds-fp-task-tables { display: flex; flex-wrap: wrap; gap: 4px; margin-left: 30px; }

.kds-fp-entry { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 8px; background: rgba(255,255,255,0.04); cursor: pointer; transition: background 0.15s; }
.kds-fp-entry:active { background: rgba(255,255,255,0.08); transform: scale(0.97); }
.kds-fp-entry.done { opacity: 0.4; }

.kds-fp-check { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--muted); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.kds-fp-check.checked { background: var(--ready); border-color: var(--ready); }

.kds-fp-entry-qty { font-size: 12px; font-weight: 700; color: var(--muted); }
.kds-fp-entry-table { font-size: 13px; font-weight: 700; color: var(--text); }

/* Pass readiness */
.kds-fp-pass { background: var(--surface); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
.kds-fp-pass-header { padding: 8px 12px; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; color: var(--muted); border-bottom: 1px solid var(--border); }
.kds-fp-pass-row { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.kds-fp-pass-row.ready { background: rgba(34,197,94,0.08); }
.kds-fp-pass-table { font-size: 14px; font-weight: 800; color: var(--text); min-width: 50px; }
.kds-fp-pass-status { font-size: 12px; font-weight: 600; color: var(--muted); }
.kds-fp-pass-row.ready .kds-fp-pass-status { color: var(--green); }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/kds/kds.css
git commit -m "[ADD] kds: fire plan CSS — lane headers, task rows, pass readiness"
```

---

### Task 7: Integrate FirePlanView into page.tsx

**Files:**
- Modify: `src/app/kds/page.tsx`

- [ ] **Step 1: Import FirePlanView**

Add to imports:

```typescript
import FirePlanView from '@/components/kds/FirePlanView';
```

- [ ] **Step 2: Swap task strip for FirePlanView during active round**

In the prep tab render section (~lines 130-157), replace the task strip logic. The key change: when `roundState === 'active'` in smart mode, show `FirePlanView` instead of the `TaskCard` strip.

Replace the block inside `{currentTab === 'prep' && ( ... )}` with:

```tsx
      {currentTab === 'prep' && (
        <>
          <div className="kds-main">
            {mode === 'classic' ? (
              <ClassicView />
            ) : roundState === 'active' ? (
              <FirePlanView />
            ) : tasks.length === 0 ? (
              <div className="kds-task-strip">
                <div className="kds-empty">
                  <div className="kds-empty-icon">{'\u{1F389}'}</div>
                  <div>All orders served!</div>
                </div>
              </div>
            ) : (
              <div className="kds-task-strip" ref={taskStripRef}>
                {tasks.map((task, idx) => (
                  <TaskCard
                    key={task.name}
                    task={task}
                    isPriority={idx === 0 && !task.allDone}
                    mostUrgentId={mui}
                  />
                ))}
              </div>
            )}
            {mode === 'smart' && roundState !== 'active' && <TableStrip ref={tableStripRef} />}
          </div>
        </>
      )}
```

Note: `TableStrip` is hidden during active round because the fire plan already shows all the table info per task.

- [ ] **Step 3: Commit**

```bash
git add src/app/kds/page.tsx
git commit -m "[ADD] kds: integrate FirePlanView — replaces task strip during active round"
```

---

### Task 8: Build and verify

- [ ] **Step 1: Run the build**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Fix any type errors**

Common issues to watch for:
- `productConfig` not in `KdsState` interface or `KdsContextType`
- `ProductConfig` import missing somewhere
- `PassReadiness` prop type — use `KdsOrder[]` directly instead of `typeof` import

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "[FIX] kds: fix type errors in fire plan integration"
```

---

### Task 9: Final integration commit

- [ ] **Step 1: Verify the complete flow**

1. Open KDS at `/kds`
2. With mock data (posConfigId=0), orders should appear
3. Press FIRE ROUND — should see lane-based fire plan (ondemand → batch → advance)
4. Tap items to check them off
5. When all items for a table are done, pass readiness shows green
6. Press NEXT ROUND to return to normal view

- [ ] **Step 2: Create final commit**

```bash
git add -A
git commit -m "[ADD] kds: Fire Plan — optimized cook sequencing by prep type and station"
```
