# PORTAL.md — Krawings Portal Master Reference
# Last updated: March 2026
# READ THIS FILE IN FULL at the start of every portal session.

---

## 1. What This Project Is

**Krawings Staff Portal** — a Next.js 14 PWA for Krawings SSAM Korean Barbeque, Berlin.
- Repo: `erxu168/Odoo_Portal_18EE` (GitHub)
- Running at: `http://89.167.124.0:3000` (dev) → `my.krawings.de` (production, DNS pending)
- Odoo backend: `test18ee.krawings.de` — Odoo 18.0+e-20250922, db=`krawings`, port 15069
- Server: Hetzner, IP `89.167.124.0`, same box as Odoo 18 EE

**Core principle:** The portal is display-only. Odoo owns all data and business logic.
The portal reads from Odoo via JSON-RPC and writes back only what staff need on mobile.
Never calculate anything in the portal that Odoo already knows.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS |
| Auth | Odoo session cookie (HttpOnly), stored server-side |
| Backend API | Next.js API routes → Odoo 18 EE JSON-RPC |
| Styling | Tailwind CSS + `src/lib/design-system.ts` tokens |
| Odoo client | `src/lib/odoo.ts` — `OdooClient` class, `getOdoo()` singleton |
| Deployment | PM2 on Hetzner, port 3000 |

---

## 3. File Structure

```
Odoo_Portal_18EE/
├── PORTAL.md                              ← READ THIS FIRST every session
├── tailwind.config.ts                     ← brand colour registered here
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                       ← root redirect → /manufacturing
│   │   ├── globals.css
│   │   ├── manufacturing/
│   │   │   └── page.tsx                  ← SPA shell, loads tab components
│   │   └── api/
│   │       ├── manufacturing-orders/
│   │       │   ├── route.ts              ← GET list
│   │       │   └── [id]/route.ts         ← GET detail
│   │       └── boms/
│   │           └── route.ts              ← GET BOM list
│   ├── components/
│   │   └── manufacturing/
│   │       ├── Dashboard.tsx             ← Home tab
│   │       ├── MoList.tsx                ← Production tab (MO list + filter)
│   │       ├── MoDetail.tsx              ← MO detail (components + WO tabs)
│   │       ├── WorkOrderList.tsx         ← WO list in MO detail
│   │       ├── WoDetail.tsx              ← WO detail with timer
│   │       ├── ActiveWorkOrder.tsx       ← Active WO timer card
│   │       ├── BomList.tsx               ← Recipes tab
│   │       ├── BomDetail.tsx             ← BOM detail with ingredients
│   │       ├── CreateMo.tsx              ← Create MO form
│   │       └── ui.tsx                   ← Shared UI primitives (Badge, BackHeader etc.)
│   ├── lib/
│   │   ├── odoo.ts                       ← OdooClient class + getOdoo() singleton
│   │   └── design-system.ts             ← ALL design tokens — import from here
│   └── types/
```

---

## 4. What's Built — Manufacturing Module

### Screens (all in `/manufacturing` SPA)

| Screen | Component | Status |
|---|---|---|
| Dashboard (Home tab) | `Dashboard.tsx` | ✅ Live |
| MO List (Production tab) | `MoList.tsx` | ✅ Live |
| MO Detail | `MoDetail.tsx` | ✅ Live |
| Work Order Detail | `WoDetail.tsx` | ✅ Live |
| Active WO timer card | `ActiveWorkOrder.tsx` | ✅ Live |
| BOM List (Recipes tab) | `BomList.tsx` | ✅ Live |
| BOM Detail | `BomDetail.tsx` | ✅ Live |
| Create MO | `CreateMo.tsx` | ✅ Live |
| My Tasks tab | — | 🚧 Placeholder |
| Inventory tab | — | 🚧 Placeholder |
| Settings tab | — | 🚧 Placeholder |

### Live API routes

| Route | Returns |
|---|---|
| `GET /api/manufacturing-orders?limit=N` | `{orders: [...]}` — mrp.production list |
| `GET /api/manufacturing-orders/:id` | `{order: {...}, components: [...], workOrders: [...]}` |
| `GET /api/boms` | `{boms: [...]}` — all BOMs |

---

## 5. Odoo 18 EE — Installed Modules (March 2026)

`account`, `accountant`, `contacts`, `documents`, `hr`, `hr_attendance`,
`hr_contract`, `hr_payroll`, `mail`, `mrp`, `planning`, `point_of_sale`,
`pos_display_weekday`, `pos_restaurant`, `project`, `project_todo`,
`purchase`, `sale_management`, `sign`, `stock`, `survey`, `web_studio`,
`website`, `website_sale`

---

## 6. Odoo 18 EE — Critical Field Names

### mrp.production
- States: `draft → confirmed → progress → to_close → done → cancel`
- Key fields: `name`, `state`, `product_id`, `product_qty`, `qty_producing`,
  `product_uom_id`, `bom_id`, `date_start`, `date_finished`, `date_deadline`,
  `user_id`, `workorder_ids`, `move_raw_ids`, `lot_producing_id`, `is_locked`
- Actions: `action_confirm`, `action_cancel`, `button_mark_done`, `action_split_production`

### mrp.workorder
- States: `pending → waiting → ready → progress → done → cancel`
- Key fields: `name`, `state`, `production_id`, `workcenter_id`, `qty_production`,
  `qty_producing`, `qty_remaining`, `duration`, `duration_expected`,
  `date_start`, `date_finished`, `move_raw_ids`, `check_ids`
- Actions: `button_start`, `button_pending`, `button_finish`

### stock.move.line — CRITICAL
- `quantity` is the done/counted field (NOT `qty_done` — that was Odoo 16)
- Other fields: `product_id`, `lot_id`, `location_id`, `move_id`, `state`, `picking_id`

### planning.slot (shifts)
- Key fields: `employee_id`, `start_datetime`, `end_datetime`, `role_id`, `state`,
  `department_id`, `allocated_hours`, `is_assigned_to_me`, `work_location_id`

### hr.leave (vacation/leave)
- Key fields: `employee_id`, `holiday_status_id`, `state`, `date_from`, `date_to`,
  `number_of_days`, `duration_display`, `name`

### stock.quant (inventory)
- Key fields: `product_id`, `location_id`, `quantity`, `reserved_quantity`,
  `inventory_quantity`, `lot_id`
- NOTE: use `inventory_quantity` not `inventory_quantity_count`

### Odoo JSON-RPC endpoints
```
POST /web/session/authenticate     — login
POST /web/dataset/call_kw          — all model reads/writes
POST /web/dataset/call_button      — workflow actions
POST /web/binary/upload_attachment — file uploads
GET  /web/content/<id>             — file downloads
```

---

## 7. Design System

**Single source of truth: `src/lib/design-system.ts`**
Import tokens from there. Never hardcode colours or sizes in components.

### Brand
- Primary: `#F5800A` (Krawings orange) — registered as `krawings` in tailwind.config.ts
- Use `text-krawings-600`, `bg-krawings-50`, `border-krawings-200` etc. in Tailwind
- Use `ds.colors.brand` for inline styles

### Current state (March 2026)
The manufacturing module uses **emerald green** as its accent (buttons, back links, badges).
This will be migrated to Krawings orange as we build new modules.
New modules should use `#F5800A` / `krawings` from the start.
Do not mix — pick one system per module until migration is complete.

### UI primitives (src/components/manufacturing/ui.tsx)
Already built: `StatusDot`, `PickCircle`, `ProgressBar`, `Badge`, `TimerDisplay`,
`TimerChip`, `BackHeader`, `SectionTitle`, `ActionButton`

---

## 8. Modules To Build (Priority Order)

### Complete Manufacturing module
| Feature | API route needed | Odoo call |
|---|---|---|
| Confirm MO | `POST /api/manufacturing-orders/:id/confirm` | `action_confirm` |
| Set component qty (numpad) | `POST /api/manufacturing-orders/:id/components` | write `quantity` on `stock.move.line` |
| Mark WO done | `POST /api/work-orders/:id/finish` | `button_finish` |
| Scrap | `POST /api/manufacturing-orders/:id/scrap` | create `mrp.scrap` |
| Cancel MO | `POST /api/manufacturing-orders/:id/cancel` | `action_cancel` |

### New modules
| Module | Route | Key Odoo models |
|---|---|---|
| Shifts | `/shifts` | `planning.slot` |
| Leave requests | `/shifts` (tab) | `hr.leave`, `hr.leave.type` |
| Staff availability | `/availability` | custom `krawings.staff.availability` |
| Inventory count | `/inventory` | `stock.quant`, `stock.location` |
| Purchase | `/purchase` | `purchase.order`, `purchase.order.line` |
| Task manager | `/tasks` | `project.task` |
| Staff profile / HR | `/profile` | `hr.employee`, `res.users` |

---

## 9. Rules

### Development process (every session)
1. Read PORTAL.md first
2. Check what's already built before adding anything new
3. Build API route first → then React component → test against live Odoo 18 EE
4. Use design system tokens — never hardcode colours or spacing
5. All Odoo calls go through `src/lib/odoo.ts` — never call Odoo from the browser
6. Every new module gets its own folder in `src/components/[module]/`
7. Shared UI primitives go in `src/components/ui/` (not inside a module folder)

### Critical — never do this
- Never use `qty_done` — Odoo 18 uses `quantity` on `stock.move.line`
- Never call Odoo directly from browser — only from Next.js API routes
- Never store session tokens in localStorage or sessionStorage
- Never hardcode colours in components — use design system
- Never add business logic to the portal — Odoo owns it
- Never duplicate API route logic — centralise in `odoo.ts`

### Git
- Branch: `main`
- Commit format: `[ADD|FIX|IMP|REF] scope: description`
- Always push after completing a feature

---

## 10. Server & Deploy

```bash
# Restart portal after code changes
pm2 restart krawings-portal  # or: pm2 restart all

# After pulling new code
npm run build && pm2 restart krawings-portal

# View logs
pm2 logs krawings-portal
```

Odoo 18 EE internal URL (server-side only): `http://89.167.124.0:15069`

---

## 11. Environment Variables (.env.local)

```
ODOO_URL=http://89.167.124.0:15069
ODOO_DB=krawings
ODOO_USER=biz@krawings.de
ODOO_PASSWORD=<see Ethan>
NEXT_PUBLIC_APP_URL=http://89.167.124.0:3000
```
