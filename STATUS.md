# Krawings Portal — STATUS

_Last updated: 2026-04-11_

## Current focus
Issues & Requests module — universal staff reporting hub (repairs, purchase requests, injuries, security, food safety, hazards, suggestions).

## Module status

| Module | Status | Notes |
|---|---|---|
| Auth / Login | ✅ shipped | cookie `kw_session`, hasRole() hierarchy staff/manager/admin |
| Admin | ✅ shipped | user management, role editing |
| Dashboard | ✅ shipped | 2×2 tile grid entry pattern |
| Manufacturing | ⚠️ regression | "Produce" button on sub-assembly component rows is non-functional — no network call, no state change. Under investigation by Claude Code on staging. |
| Purchase | ✅ shipped | 5 tabs, 11 screens; Choco replacement. Receive flow rebuild pending (stock.picking validation + backorder wizard). |
| Inventory | ⚠️ backend only | 4 tables, 7 API routes, Odoo stock.quant write via action_apply_inventory. Frontend page.tsx NOT built. |
| Recipes | ✅ shipped | Concurrent cook sessions, absolute timestamps, Kitchen Board dashboard, global timer banner. 22-issue audit done. |
| HR / Onboarding | ⚠️ partial | 7-step DATEV wizard, DocumentCapture, self-registration. Pending: end-to-end staging validation, email notifications, password reset, profile page. |
| Termination v2 | ✅ shipped | Portal UI + PDF (wkhtmltopdf DIN 5008 Form B) + Sign. Odoo krawings_termination_v2 = data layer only. |
| Letter Writing | 📋 designed | DIN 5008 Form B spec, Puppeteer PDF. Not built. |
| Contract scanner | ✅ shipped | Claude Vision API. ANTHROPIC_API_KEY in .env.local. |
| Invoice scanner | 📋 scoped | 8-screen mock. Vision + Graph API + WhatsApp + SEPA XML + DATEV. Not built. |
| KDS | 📋 v8 designed | What a Jerk task-first auto-batch. Not built. |
| Prep Planner | 📋 algo designed | EWMA + weather + holidays + DOW. 3 mockups built. Two-tablet setup. Waiting on POS portion decomposition answers. |
| Music (Krawings Auto) | 📋 mock done | Locked-down kiosk PWA, YouTube IFrame Player API. 9-screen mock. |
| Staffing optimization | 📋 designed | Prophet+XGBoost → rules engine → OR-Tools constraint scheduling. 10–14 week build. |
| **Issues & Requests** | 🟢 **backend shipped** | See below. Frontend not started. |

## Issues & Requests — detail

### Shipped this session (2026-04-11)

**Portal backend** — erxu168/Odoo_Portal_18EE main:
- `src/types/issues.ts` — types, BGN checklist, type-specific data
- `src/lib/issues-db.ts` — 7-table SQLite schema + CRUD, Berlin time via `toLocaleString('sv-SE', {timeZone: 'Europe/Berlin'})`, lazy `ensureTables()` init matching kds-db.ts
- `src/lib/issues-odoo-sync.ts` — failure-tolerant upsert helper for mirroring equipment to Odoo
- 11 API routes under `src/app/api/issues/`:
  - `reports` (list/create) + `reports/[id]` (detail/update with repair cost rollup)
  - `media` (base64 photo/video upload to `data/issues-media`)
  - `comments` (add, with restricted visibility check)
  - `feed` (location feed, role-aware restricted filtering)
  - `dashboard` (badge counts for module tile)
  - `equipment` (list grouped by location / create, manager-only, **fires Odoo sync**)
  - `equipment/[id]` (detail with docs/photos/repair history / update, **fires Odoo sync**)
  - `equipment/qr/[code]` (QR sticker scan lookup)
  - `purchase-approve` / `purchase-reject` (manager workflow for purchase_request issues)

**Odoo addon** — `odoo-addons/krawings_issues/` in the portal repo:
- Extends `maintenance.equipment` with 4 fields: `x_portal_id` (indexed, UNIQUE), `x_qr_code` (indexed), `x_portal_repair_count`, `x_portal_total_cost`
- Controllers: POST `/krawings/issues/sync_equipment` (upsert), POST `/krawings/issues/ping` (health check)
- NOT YET INSTALLED on staging — needs copy to `/opt/odoo/18.0/custom-addons/` + install command
- Portal sync (`issues-odoo-sync.ts`) uses **standard JSON-RPC** to write `maintenance.equipment` directly, so the custom controller is nice-to-have but not required for the sync path. The addon is required for the schema extension.

### Design decisions

- **8 report types**: repair, purchase_request, injury, security, food_safety, hazard, suggestion, other
- **Restricted visibility** (reporter + manager/admin only): injury, security, food_safety
- **Auto-urgent**: injury, security
- **BGN compliance**: injury flag triggers a 6-item checklist (severity assessed, scene documented, witness statements, Unfallanzeige filed, Durchgangsarzt referred, Verbandbuch updated)
- **German fields**: Aktenzeichen, Strafanzeige on security reports
- **Equipment registry**: SQLite primary, Odoo is read-write mirror. QR code stickers on all major equipment. Repair cost rollup: when a repair issue is resolved with a cost, the linked equipment's `total_repair_cost` and `repair_count` auto-increment.
- **Notifications**: configurable per urgency. Normal = badge only. Urgent = badge+push+email. Injury/security = badge+push+email+WhatsApp. (Dispatcher not built yet.)
- **Photo storage**: server disk at `/data/issues-media`, not base64 in SQLite

### Still to build

- [ ] Frontend components for all 17 screens (match `krawings_issues_requests_v1.0.0.html` mock)
- [ ] Purchase module PO creation wiring in `purchase-approve/route.ts` (currently `TODO` comment)
- [ ] Notification dispatcher (urgency → badge/push/email/WhatsApp channels)
- [ ] Field worker handoff: verify `krawings_issues` addon install on staging, verify `warranty_date` vs `warranty_expiration_date` field name

## Deploy commands

### Portal (after every push)
```bash
# On staging server 89.167.124.0 (SSH)
cd /opt/krawings-portal
git pull
npm run build
sudo systemctl restart krawings-portal
```

### Odoo krawings_issues addon (one-time install)
```bash
# On staging server 89.167.124.0 (SSH)
sudo cp -r /opt/krawings-portal/odoo-addons/krawings_issues /opt/odoo/18.0/custom-addons/
sudo chown -R odoo:odoo /opt/odoo/18.0/custom-addons/krawings_issues

sudo -u odoo /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
  /opt/odoo/18.0/odoo-18.0/odoo-bin \
  -c /opt/odoo/18.0/odoo-18.0/odoo.conf \
  -d krawings -i krawings_issues --stop-after-init

sudo systemctl restart odoo-18
```

## Environments

| Env | URL | IP | DB | Port |
|---|---|---|---|---|
| Staging Odoo 18 EE | test18ee.krawings.de | 89.167.124.0 | krawings | 15069 |
| Production Odoo 18 EE | pos.krawings.de | 128.140.12.188 | krawings | 15069 |
| Dev Odoo 19 CE | test19.krawings.de | — | odoo19 | 8072 |

Default target: **staging**. Only touch production when Ethan says so explicitly.

## Dev rules (short list)

1. Never edit source files on the server — all changes via GitHub.
2. Split pages into separate component files per screen; no monoliths; PascalCase filenames.
3. Push only complete buildable code; the GitHub Action runs a build check on every push.
4. Before writing new code: inspect existing `src/lib/` and `src/types/` for exact exports; introspect Odoo staging via JSON-RPC.
5. Berlin time everywhere: `new Date().toLocaleString('sv-SE', {timeZone: 'Europe/Berlin'}).replace(' ', 'T')`. Never `toISOString()` — that's UTC.
6. Every module MUST have a dashboard landing screen (2×2 tile grid). Every list view MUST have a search bar. Every module MUST have a home button. Every irreversible action MUST confirm.
7. Role hierarchy Staff < Manager < Admin enforced in UI AND API.
8. All UI primitives as shared components in `src/components/ui/`.
9. Update this STATUS.md at session end.
