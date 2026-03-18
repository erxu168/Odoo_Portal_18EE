# PORTAL.md — Krawings Portal Master Reference
# Last updated: 18 March 2026
# READ THIS FILE IN FULL at the start of every portal session.
# This file + src/lib/ux-rules.ts + src/lib/design-system.ts are the three
# files to read before touching any code.

---

## 1. What This Project Is

**Krawings Staff Portal** — a Next.js 14 PWA for Krawings SSAM Korean Barbeque, Berlin.
- Repo: `erxu168/Odoo_Portal_18EE` (GitHub, public)
- Running at: `http://89.167.124.0:3000` (dev/production for now)
- Production domain: `my.krawings.de` (DNS A record not yet added)
- Odoo 18 EE backend: `test18ee.krawings.de`, db=`krawings`, internal port 15069
- Server: Hetzner, IP `89.167.124.0`

**Core principle:** Odoo owns all data and business logic. The portal is a mobile
frontend only. Never calculate in the portal what Odoo already knows. Never call
Odoo from the browser — only from Next.js API routes.

---

## 2. Who Uses This App — CRITICAL CONTEXT

Krawings has four staff groups, all using the same app on their phones:

| Role | Where they work | Key needs |
|---|---|---|
| `kitchen_staff` | Production kitchen (batch cooking, prep) | Work orders, ingredients, quantities, timer |
| `kitchen_staff` | Restaurant kitchen (BBQ stations, stove) | Same as above — hands wet, gloved, loud |
| `floor_staff` | Restaurant floor (servers, hosts) | Shift info, task checklists, leave requests |
| `fast_food_staff` | Counter cashier + small kitchen | Quick task switching, shift visibility |
| `manager` | Shift/floor manager | Urgency overview, approvals, team view |
| `admin` | Operations / owner | KPIs, cost, full view |

**Most staff are NOT experienced industry professionals.**
Many are students, first-job workers, non-native German/English speakers.
The app must work on day one without training. No ERP jargon anywhere.

**Physical constraints for kitchen staff:**
- Wet or greasy hands, possibly wearing gloves
- Bright hot kitchen environment
- In a hurry, brief phone interactions
- Unreliable WiFi (steam, thick walls)

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS |
| Auth | Odoo session cookie — HttpOnly, server-side only |
| Backend API | Next.js API routes → Odoo 18 EE JSON-RPC |
| Styling | Tailwind CSS + `src/lib/design-system.ts` |
| UX rules | `src/lib/ux-rules.ts` — read before every new screen |
| Odoo client | `src/lib/odoo.ts` — `OdooClient` class + `getOdoo()` singleton |
| Deployment | PM2 on Hetzner, port 3000 |
| Font | DM Sans (body) + DM Mono (timers, numbers) |

---

## 4. File Structure

```
Odoo_Portal_18EE/
├── PORTAL.md                          ← READ FIRST every session
├── tailwind.config.ts                 ← krawings colour scale registered
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                   ← root redirect → /manufacturing
│   │   ├── globals.css
│   │   ├── manufacturing/
│   │   │   └── page.tsx              ← full SPA (all tabs)
│   │   └── api/
│   │       ├── manufacturing-orders/
│   │       │   ├── route.ts          ← GET list
│   │       │   └── [id]/route.ts     ← GET detail
│   │       └── boms/
│   │           └── route.ts          ← GET list
│   ├── components/
│   │   └── manufacturing/
│   │       ├── Dashboard.tsx         ← Home tab
│   │       ├── MoList.tsx            ← MO list + filter tabs
│   │       ├── MoDetail.tsx          ← MO detail (components + WO)
│   │       ├── WorkOrderList.tsx     ← WO list inside MO detail
│   │       ├── WoDetail.tsx          ← WO detail with timer
│   │       ├── ActiveWorkOrder.tsx   ← Active WO hero card
│   │       ├── BomList.tsx           ← Recipes tab
│   │       ├── BomDetail.tsx         ← BOM detail
│   │       ├── CreateMo.tsx          ← Create MO form
│   │       └── ui.tsx               ← Shared primitives (Badge, BackHeader etc.)
│   └── lib/
│       ├── odoo.ts                   ← OdooClient — all Odoo calls go here
│       ├── design-system.ts          ← ALL design tokens, component classes
│       └── ux-rules.ts              ← UX rules, plain language, confirmations
```

---

## 5. What Is Built and Live (March 2026)

### Manufacturing module — `/manufacturing`
Single-page app with bottom nav (5 tabs).

| Screen | Component | Status |
|---|---|---|
| Dashboard / Home | `Dashboard.tsx` | ✅ Live — stats, recent MOs, module tiles |
| MO List (Production tab) | `MoList.tsx` | ✅ Live — filter tabs, MO cards |
| MO Detail | `MoDetail.tsx` | ✅ Live — Work Orders + Components tabs |
| Work Order Detail | `WoDetail.tsx` | ✅ Live — timer, state |
| Active WO card | `ActiveWorkOrder.tsx` | ✅ Live |
| BOM List (Recipes tab) | `BomList.tsx` | ✅ Live — 42 BOMs |
| BOM Detail | `BomDetail.tsx` | ✅ Live |
| Create MO | `CreateMo.tsx` | ✅ Live |
| My Tasks tab | — | 🚧 "Coming soon" placeholder |
| Inventory tab | — | 🚧 "Coming soon" placeholder |
| Settings tab | — | 🚧 "Coming soon" placeholder |

### Live API routes
| Route | Method | Returns |
|---|---|---|
| `/api/manufacturing-orders` | GET | `{orders:[...]}` — mrp.production list |
| `/api/manufacturing-orders/:id` | GET | `{order:{...}, components:[...], workOrders:[...]}` |
| `/api/boms` | GET | `{boms:[...]}` — all BOMs |

No other API routes exist yet. All others return 404.

### What is NOT built yet (in priority order)
1. Action buttons on MO/WO (confirm, start, finish, set qty, scrap, cancel)
2. Numpad for component quantities
3. Offline queue (IndexedDB + service worker sync)
4. Shifts module (`/shifts` → `planning.slot`)
5. Leave requests (`hr.leave`)
6. Inventory count (`/inventory` → `stock.quant`)
7. Purchase (`/purchase`)
8. Task manager (`/tasks`)
9. Staff profile / HR (`/profile`)
10. App launcher / home screen (routes staff to the right module by role)

---

## 6. Design System — Summary

**Files: `src/lib/design-system.ts` + `tailwind.config.ts`**

### Brand
- Primary orange: `#F5800A`
- Dark: `#E86000` / Darker: `#C05200` / Light: `#FFF4E6`
- Tailwind scale: `krawings-50` through `krawings-900`
- Use `bg-krawings-500`, `text-krawings-600`, `border-krawings-200` in Tailwind

### Touch targets (larger than standard — wet hands / gloves)
- Primary action buttons: `h-14` (56px)
- Secondary buttons: `h-12` (48px)
- List rows: `min-h-[56px]`
- Bottom nav tabs: `h-14` (56px)
- Numpad keys: `h-16` (64px) ← extra large for gloves
- Info (ⓘ) button: `w-9 h-9` (36px)

### Font
- `DM Sans` for all UI text (registered in tailwind.config.ts)
- `DM Mono` for timers, quantities, reference numbers

### Key component classes (from `ds` object in design-system.ts)
- Cards: `ds.card`, `ds.cardHover`
- Buttons: `ds.btnPrimary`, `ds.btnSecondary`, `ds.btnDanger`, `ds.btnBack`
- Numpad: `ds.numpadDrawer`, `ds.numpadKey`, `ds.numpadConfirm`
- Info sheet: `ds.infoSheet`, `ds.infoSheetTitle`, `ds.infoSheetBody`
- Confirm sheet: `ds.confirmSheet`, `ds.confirmSheetTitle`
- Offline banner: `ds.offlineBanner`
- Urgency tiles: `ds.urgencyTileCritical`, `ds.urgencyTileAction`
- Hero card (active WO): `ds.heroCard`, `ds.heroTimer`
- Status badges: `getBadgeClass(state)` + `getBadgeLabel(state)` + `getBadgeIcon(state)`

### Status badge icons (every status shows icon + colour + text — never colour alone)
- `draft` → ⏸️ Not started
- `confirmed` → ✅ Ready to make
- `progress` → 🔄 In progress
- `to_close` → 🏁 Almost done
- `done` → ✅ Finished
- `cancel` → ❌ Cancelled
- `pending` → ⏳ Waiting for step
- `waiting` → ⚠️ Missing ingredients
- `ready` → ✅ Ready to start

### Current migration status
Manufacturing module uses **emerald green** accent (legacy).
All new modules use Krawings orange from the start.
Manufacturing will be migrated to orange in a dedicated session.

---

## 7. UX Rules — Summary

**File: `src/lib/ux-rules.ts`** — read before building any screen.

### Plain language rules
Never show ERP terms. Always use plain replacements:
- "Manufacturing Order" → "Production order"
- "Work Order" → "Cooking step"
- "Bill of Materials" → "Recipe"
- "BOM" → "Recipe"
- "Component" → "Ingredient"
- "Scrap" → "Waste / spoilage"
- "Confirm" → "Start this order"
- "Work Center" → "Station"

### The ⓘ system (info on everything)
**Every field label, button, badge, and status must have a ⓘ info behaviour.**
- Field labels: ⓘ icon → tap → bottom dark sheet (8s auto-dismiss)
- Action buttons: long-press (500ms) → action info sheet
- Info sheet explains: what it is, why it exists, what happens, whether undoable
- Use `<InfoButton>` component (to be built in `src/components/ui/InfoButton.tsx`)

### Confirmation dialogs
Every write action needs a confirmation bottom sheet BEFORE calling Odoo.
Sheet must use the actual product name and quantity — never generic text.
- Wrong: "Confirm action?" [OK] [Cancel]
- Right: "You finished making 5 litres of Bulgogi Marinade. Is that correct?"
Use `buildConfirmationText(action, productName, qty, uom)` from `ux-rules.ts`.
Destructive actions (scrap, cancel): red confirm button.

### Error messages
All errors must say what to DO next, not just what went wrong.
Use `errorMessages` map from `ux-rules.ts`. Never show raw server errors.

### Role-adaptive home screens
- `kitchen_staff`: Active WO hero card FIRST (fullscreen if WO in progress), then next WO
- `floor_staff`: My shift card first, then today's task checklist
- `fast_food_staff`: Shift time + station + current task
- `manager`: Urgency tiles (blocked, action needed), then stats, then team
- `admin`: KPIs, full view

### One primary action per screen
One big orange button at the bottom. All other actions are ghost/outline.
Never two equally-prominent buttons.

### Offline-first
Kitchen WiFi unreliable. Never block staff due to network.
Show yellow offline banner, queue writes in IndexedDB, sync when reconnected.
Use `offlineMessages` from `ux-rules.ts` for all offline text.

---

## 8. Screen Designs (March 2026)

Mock screens were built and approved showing all the above principles in context.
File: `krawings-screens.html` (available in session outputs, not committed to repo).

Screens designed:
1. Kitchen staff home — active WO hero card with timer
2. Work order detail — ingredient pick list + numpad open (64px keys)
3. Confirmation bottom sheet — "Are you done? You made 3.5L of Bulgogi Marinade"
4. Floor staff home — shift card + task checklist with photo-required badges
5. Leave request form — balance strip + simple fields each with ⓘ
6. ⓘ Info sheet open — dark bottom sheet explaining "Type of leave" in plain language
7. Manager home — red/amber urgency tiles with inline action buttons
8. Production order list — filter pills, progress bars, state badges with icons
9. Offline state — yellow banner, queued items shown, staff can still work

---

## 9. Odoo 18 EE — Installed Modules

`account`, `accountant`, `contacts`, `documents`, `hr`, `hr_attendance`,
`hr_contract`, `hr_payroll`, `mail`, `mrp`, `planning`, `point_of_sale`,
`pos_display_weekday`, `pos_restaurant`, `project`, `project_todo`,
`purchase`, `sale_management`, `sign`, `stock`, `survey`, `web_studio`,
`website`, `website_sale`

---

## 10. Odoo 18 EE — Critical Field Names

### mrp.production
- States: `draft → confirmed → progress → to_close → done → cancel`
- Actions: `action_confirm`, `action_cancel`, `button_mark_done`, `action_split_production`
- Key fields: `name`, `state`, `product_id`, `product_qty`, `qty_producing`,
  `product_uom_id`, `bom_id`, `date_start`, `date_finished`, `date_deadline`,
  `user_id`, `workorder_ids`, `move_raw_ids`, `lot_producing_id`, `is_locked`

### mrp.workorder
- States: `pending → waiting → ready → progress → done → cancel`
- Actions: `button_start`, `button_pending`, `button_finish`
- Key fields: `name`, `state`, `production_id`, `workcenter_id`,
  `qty_production`, `qty_producing`, `qty_remaining`,
  `duration`, `duration_expected`, `date_start`, `date_finished`

### stock.move.line — CRITICAL
- `quantity` = the done/counted qty (NOT `qty_done` — that was Odoo 16, does not exist in 18)

### planning.slot (shifts — confirmed installed)
- `employee_id`, `start_datetime`, `end_datetime`, `role_id`, `state`
- `department_id`, `allocated_hours`, `is_assigned_to_me`, `work_location_id`

### hr.leave (leave requests)
- `employee_id`, `holiday_status_id`, `state`, `date_from`, `date_to`
- `number_of_days`, `duration_display`, `name`
- States: `draft → validate1 → validate → refuse`

### stock.quant (inventory)
- `product_id`, `location_id`, `quantity`, `reserved_quantity`, `inventory_quantity`
- Use `inventory_quantity` (not `inventory_quantity_count`)

---

## 11. Build Priority — Next Sessions

### Priority 1: Complete Manufacturing
Add the missing action API routes + wired buttons:
| Feature | API route | Odoo call |
|---|---|---|
| Confirm MO | `POST /api/manufacturing-orders/:id/confirm` | `action_confirm` |
| Set component qty | `POST /api/manufacturing-orders/:id/components` | write `quantity` on `stock.move.line` |
| WO start/pause/done | `POST /api/work-orders/:id/:action` | `button_start`, `button_pending`, `button_finish` |
| Scrap | `POST /api/manufacturing-orders/:id/scrap` | create `mrp.scrap` |
| Cancel MO | `POST /api/manufacturing-orders/:id/cancel` | `action_cancel` |

Also: migrate existing components from emerald green to Krawings orange.

### Priority 2: Shared UI components
Build `src/components/ui/` with:
- `InfoButton.tsx` — ⓘ trigger + bottom sheet
- `ConfirmSheet.tsx` — confirmation bottom sheet
- `NumPad.tsx` — 64px keys, unit hint, match button
- `StatStrip.tsx` — stat numbers row
- `UrgencyTile.tsx` — red/amber action cards
- `OfflineBanner.tsx` — yellow offline status bar
- `StatusBadge.tsx` — icon + colour + text from design-system

### Priority 3: Shifts module (`/shifts`)
- `planning.slot` → staff see their own shifts
- `hr.leave` → leave request form + balance display

### Priority 4: Role-based routing
- Detect role from Odoo session / hr.employee
- Show correct home screen per role (kitchen vs floor vs manager)

---

## 12. Development Rules (Every Session)

1. Read PORTAL.md first (this file)
2. Read `src/lib/ux-rules.ts` before designing any new screen
3. Read `src/lib/design-system.ts` before writing any component styles
4. Check what's already built before adding anything
5. Build API route first → React component → test against live Odoo 18 EE
6. Use design system tokens only — never hardcode colours or sizes
7. All Odoo calls through `src/lib/odoo.ts` — never from the browser
8. New module → new folder in `src/components/[module]/`
9. Shared UI primitives → `src/components/ui/` only
10. Push to GitHub after every completed feature

### Never do this
- Never use `qty_done` — Odoo 18 uses `quantity` on `stock.move.line`
- Never call Odoo directly from the browser
- Never store session tokens in localStorage/sessionStorage
- Never hardcode colours — use design system
- Never add business logic to the portal — Odoo owns it
- Never show ERP jargon — use plain language from `ux-rules.ts`
- Never show colour-only status — always icon + colour + text
- Never block staff with a full-screen error — degrade gracefully

---

## 13. Server & Deploy

```bash
pm2 restart krawings-portal          # restart after code change
npm run build && pm2 restart krawings-portal  # after pulling new code
pm2 logs krawings-portal             # view logs
```

Odoo 18 EE internal (server-side API routes only): `http://89.167.124.0:15069`

---

## 14. Environment Variables (.env.local)

```
ODOO_URL=http://89.167.124.0:15069
ODOO_DB=krawings
ODOO_USER=biz@krawings.de
ODOO_PASSWORD=<ask Ethan>
NEXT_PUBLIC_APP_URL=http://89.167.124.0:3000
```
