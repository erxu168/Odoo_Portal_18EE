# Cook-Facing Prep Plan Overlay — Design

_2026-04-22_

## Goal

Show each cook, at shift start, what prep work the forecast calls for today. Let them confirm, adjust, or skip each item. Capture their plan so the variance dashboard can later compare forecast → cook's plan → actual sales.

## User flow

1. Cook (staff) opens the portal home on their phone.
2. If their shift is active **and** they have not yet acknowledged today's plan, a full-screen modal slides up: _"Today's prep plan — N items"_.
3. Each item renders as a card: name, station, forecast qty, peak hour.
4. Per-card actions:
   - **Confirm** (default, green primary) — accept the forecast qty as-is.
   - **Adjust** — tap the qty to edit, then Confirm with the new qty.
   - **Skip** — small gray, means "not making this today".
5. Progress bar at top: "3 of 8 done".
6. Bottom button is **Skip rest** until all items are handled, then **Start shift**.
7. Modal is dismissable via X. A home tile _"Today's prep (N pending)"_ re-opens it any time.

## Data model

One new table:

```sql
CREATE TABLE prep_plan_acks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  shift_date TEXT NOT NULL,           -- YYYY-MM-DD Berlin
  prep_item_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('confirm','adjust','skip')),
  planned_qty REAL,                   -- null for skip
  forecast_qty REAL NOT NULL,         -- frozen at ack time so variance can show drift
  created_at TEXT NOT NULL,
  UNIQUE(user_id, shift_date, prep_item_id)
);
```

Upsert on conflict — a cook can change their mind during the day.

## API

**GET `/api/prep-planner/cook-plan?companyId=X&date=YYYY-MM-DD`** (auth: staff+)
Returns:
```json
{
  "date": "2026-04-22",
  "items": [
    {
      "prep_item_id": 1,
      "name": "Rice",
      "station": "pot",
      "unit": "portion",
      "batch_size": 20,
      "forecast_qty": 24,
      "peak_hour": 19,
      "my_ack": { "action": "confirm", "planned_qty": 24 } | null
    }
  ],
  "pendingCount": 5,
  "totalCount": 8
}
```

**POST `/api/prep-planner/cook-plan/ack`**
Body: `{ prep_item_id, action, planned_qty?, forecast_qty }`
Upserts one row; returns `{ ok: true, ack: { ... } }`.

## Components

| File | Responsibility |
|------|----------------|
| `src/lib/prep-plan-acks-db.ts` | Table init + `upsertAck` + `listAcksForUser(userId, date)` |
| `src/app/api/prep-planner/cook-plan/route.ts` | GET endpoint (aggregates per-item forecast + current ack) |
| `src/app/api/prep-planner/cook-plan/ack/route.ts` | POST endpoint (upsert) |
| `src/components/prep-planner/CookPlanModal.tsx` | Full-screen modal with per-item cards |
| `src/components/dashboard/DashboardHome.tsx` | Add trigger: check if cook on shift, fetch cook-plan, show modal if pending. Add "Today's prep" tile. |

## Trigger logic (home)

On home mount, after `/api/auth/me` + `/api/dashboard` resolve:
- If `user.role === 'staff'` **and** `shift.onShift === true` **and** the tenant has prep_items — fetch `/api/prep-planner/cook-plan`.
- If `pendingCount > 0` and `sessionStorage.getItem('cook_plan_seen_<date>')` is null → auto-open modal.
- When modal closes (X or Start shift), set the sessionStorage key so it doesn't reopen same session.
- Tile appears whenever `totalCount > 0` for today.

Default company for staff: their home company via existing session. Fallback to DEFAULT_COMPANY_ID (3, Ssam).

## Edge cases

- **No forecast data today** → no tile, no modal. Silent.
- **No prep items configured** → no tile, no modal. Silent.
- **Cook ack'd all items earlier** → tile shows "All set ✓", tap re-opens for tweaks.
- **Cook loses network mid-ack** → acks queued client-side, retry on next network (Phase 2 — initial version posts immediately and shows error toast on failure).
- **Manager role** → manager can see the tile but modal autostart is cook-only. Managers open it manually.

## Variance integration (not this session)

`prep_plan_acks` becomes a new input column for the variance dashboard: forecast → planned → actual. Three bars instead of two. Out of scope here — just make the table shape compatible.

## Non-goals

- Mobile push notifications at shift start
- Acknowledging the plan on someone else's behalf
- Team views ("what did everyone plan")
- Versioning of acks (upsert is sufficient)
