# KDS Phase 2 — POS Integration Design

## Goal

Connect the KDS to Odoo 18 EE POS so paid orders from What a Jerk's counter appear on the kitchen display in real time, and marking an order "Ready" on the KDS updates Odoo.

## Context

- What a Jerk is a counter-service restaurant (no table assignments)
- Staff enters orders on Odoo POS tablet at the counter
- Customer pays first, then waits for food
- KDS Phase 1 (mock data UI) is deployed at `portal.krawings.de/kds`
- Odoo 18 EE staging at `89.167.124.0:15069`, DB `krawings`, company_id 5
- Portal already uses JSON-RPC via `src/lib/odoo.ts` for all Odoo calls

## Architecture

### Data Flow

```
Odoo POS (counter staff taps Pay)
  -> pos.order.state = 'paid'
    -> Portal polls GET /api/kds/orders every 5s
      -> JSON-RPC searchRead('pos.order', [state=paid, config_id=X])
        -> Maps to KdsOrder[] and returns to frontend
          -> KDS renders orders in prep tab
            -> Cook checks items, taps READY
              -> POST /api/kds/orders/done { orderId }
                -> JSON-RPC writes pos.order.state = 'done'
                  -> Counter staff sees order ready in POS
```

### Integration Method

**JSON-RPC polling, no bus/WebSocket.**

Reasons:
- Same pattern used by manufacturing, purchase, inventory modules — proven stable
- No new infrastructure (bus subscriptions, WebSocket connections)
- Failure mode is obvious (connection error shown, retries automatically)
- 5-second poll interval is acceptable for kitchen display latency

## Odoo POS Setup (prerequisite)

Before the integration works, What a Jerk needs a POS configuration in Odoo:

1. **POS Config** — Create `pos.config` for What a Jerk, linked to company_id 5
2. **Products** — Create POS products for menu items (Jerk Chicken, Curry Goat, etc.)
3. **Product Categories** — Optional, for filtering (Grill, Pot, Fryer, Cold)
4. **No floor plan or tables** — Counter service, orders use tracking_number only
5. **Payment methods** — At least cash and card

This setup is done in Odoo admin, not in code. The KDS integration reads whatever products/orders exist.

## API Routes

### GET `/api/kds/orders`

Fetches paid orders from Odoo for the KDS.

**Query parameters:**
- `configId` (optional) — POS config ID to filter. Falls back to settings.

**Odoo call:**
```
searchRead('pos.order', [
  ['state', '=', 'paid'],
  ['config_id', '=', configId]
], [
  'id', 'name', 'tracking_number', 'date_order',
  'takeaway', 'amount_total', 'general_note'
])
```

Then for each order, fetch lines:
```
searchRead('pos.order.line', [
  ['order_id', 'in', orderIds]
], [
  'id', 'order_id', 'full_product_name', 'qty', 'note',
  'product_id', 'customer_note'
])
```

**Response shape:**
```typescript
{
  orders: {
    id: number;           // Odoo pos.order ID
    name: string;         // e.g. "#38" (tracking_number)
    type: 'Dine-in' | 'Takeaway';
    waitMin: number;      // minutes since date_order
    note: string | null;  // general_note
    items: {
      id: string;         // Odoo line ID as string
      name: string;       // full_product_name
      qty: number;
      note: string | null; // line note or customer_note
    }[];
  }[]
}
```

### POST `/api/kds/orders/done`

Marks an order as done in Odoo when cook taps READY.

**Request body:**
```json
{ "orderId": 12345 }
```

**Odoo call:**
```
call('pos.order', 'action_pos_order_paid', [[orderId]])
```
Or direct write:
```
write('pos.order', [orderId], { 'state': 'done' })
```

(Need to verify which method Odoo allows for state transition — `action_pos_order_paid` might not go to `done`. May need to call a specific action method or just write the state directly.)

**Response:**
```json
{ "ok": true }
```

## Frontend Changes

### State Context (`src/lib/kds/state.tsx`)

Replace mock data initialization with Odoo polling:

- Remove `createSeedOrders()` from initial state — start with empty array
- Remove simulated order generator (25s interval)
- Remove wait time incrementer (30s interval)
- Add polling effect: `GET /api/kds/orders` every 5 seconds
- Compute `waitMin` client-side from `date_order` timestamp
- Keep existing actions (toggleItem, markReady, etc.) working with Odoo IDs
- `markReady` action calls `POST /api/kds/orders/done` then removes order from prep

### KdsOrder Mapping

```
Odoo pos.order           -> KdsOrder
─────────────────────────────────────
id                       -> id
tracking_number          -> table (display as "#38")
takeaway (boolean)       -> type ('Takeaway' | 'Dine-in')
date_order               -> waitMin (computed: now - date_order in minutes)
general_note             -> (not mapped to item level)
state='paid'             -> status='prep'
```

```
Odoo pos.order.line      -> KdsItem
─────────────────────────────────────
id (as string)           -> id
full_product_name        -> name
qty                      -> qty
note || customer_note    -> note
```

### Item Checkoff (local only)

Item-level done state stays client-side (in React state). Odoo has no per-line "prepared" field on `pos.order.line`. The cook checks items off locally; when all are done, READY sends the whole order to `done` in Odoo.

### Settings Addition

Add `posConfigId` to `KdsSettings` — the POS config ID to poll. Set during initial setup, persisted in SQLite.

## What Changes, What Stays

| Component | Change |
|-----------|--------|
| `src/types/kds.ts` | Add `posConfigId` to settings |
| `src/lib/kds-db.ts` | Add `pos_config_id` column |
| `src/lib/kds/state.tsx` | Replace mock data with polling, wire markReady to Odoo |
| `src/lib/kds/mockData.ts` | Keep for development fallback (when no Odoo) |
| `src/app/api/kds/orders/route.ts` | New — GET orders from Odoo |
| `src/app/api/kds/orders/done/route.ts` | New — POST mark done in Odoo |
| `src/components/kds/SettingsPanel.tsx` | Add POS config ID field |
| All other KDS components | No changes — they consume KdsOrder[] from context |

## Recall Behavior

Recall stays KDS-local. Tapping Recall on Done tab moves the order back to prep in React state but does NOT revert `pos.order.state` in Odoo. This avoids fighting Odoo's state machine.

## Error Handling

- Poll failure: show connection error toast, retry next interval
- Mark-done failure: show error toast, keep order in prep tab, retry on next tap
- No POS config set: show setup prompt in KDS with link to settings
- Empty response (no paid orders): show "No orders" empty state (existing)

## Out of Scope

- Odoo bus/WebSocket integration
- Customer self-service kiosk
- Table management / floor plans
- Per-line preparation status in Odoo
- Product category filtering (all items show on one KDS)
- Multiple KDS displays for different stations
