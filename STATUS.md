# Krawings Portal — STATUS

_Last updated: 2026-04-19_

## Current focus
Rentals module (Properties & Tenancies) — frontend v1 shipped. 11 pages with real data from seeded SQLite.

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
| Prep Planner | 🟡 **Phase 1 backend shipped** | EWMA engine, Open-Meteo weather, cron job. Forecasts writing to prep_forecasts for company_id=3 (Ssam). WAJ waits on POS data on staging. Frontend + portion mapping = Phase 2. |
| Music (Krawings Auto) | 📋 mock done | Locked-down kiosk PWA, YouTube IFrame Player API. 9-screen mock. |
| Staffing optimization | 📋 designed | Prophet+XGBoost → rules engine → OR-Tools constraint scheduling. 10–14 week build. |
| **Issues & Requests** | 🟢 **backend shipped** | See below. Frontend not started. |
| **Rentals** | 🟢 **frontend v2 shipped** | See below. 16 pages, 16 components, 25 API routes, seeded SQLite. |

## Prep Planner — detail

### Phase 1 shipped (2026-04-19)

**Backend pipeline** — commit `96c34ef` on main:

| File | Purpose |
|---|---|
| `src/lib/weather.ts` | Open-Meteo client (archive + forecast), Berlin 52.52°N/13.405°E, weather buckets (nice/heat/rain/cold/snow/normal) |
| `src/lib/prep-planner-db.ts` | 4 tables: `prep_demand_history`, `prep_weather_daily`, `prep_forecasts`, `prep_forecast_runs` + full CRUD |
| `src/lib/prep-planner-engine.ts` | `backfillDemandHistory`, `backfillWeather`, `backfillForecastWeather`, `computeForecasts`, `runForecastJob` |
| `src/app/api/cron/prep-forecast/route.ts` | Token-protected GET, defaults to company_id=3 (Ssam Kottbusser) |
| `src/app/api/prep-planner/forecasts/route.ts` | Read endpoint for future UI (no writes) |

### Algorithm (per algorithm design doc, Sections 4.1–4.4)

- **Baseline** = EWMA α=0.85 over last 12 weeks of same-DOW-hour samples (heavy on recent)
- **Seasonal multiplier** = recent 4 weeks avg / same 4 weeks last year (capped 0.3–3.0)
- **Holiday multiplier** = 0 on Berlin public holidays, else 1
- **Weather multiplier** = 1.0 (Phase 1 stores the tag but doesn't apply; Phase 2 will compute per-bucket ratios)
- **DOW multiplier** = 1.0 (already baked into per-DOW-hour baseline)
- **Safety buffer** stored at 15% but NOT applied to `forecast_qty` — the UI decides whether to add it

### Deploy

```bash
# On staging server 89.167.124.0 (SSH)
cd /opt/krawings-portal
git pull
npm run build
sudo systemctl restart krawings-portal

# Set CRON_SECRET in .env.local if not already set
echo "CRON_SECRET=$(openssl rand -hex 24)" >> /opt/krawings-portal/.env.local
sudo systemctl restart krawings-portal

# Add crontab entry for the odoo/krawings user
crontab -e
# 0 4 * * * curl -s "http://localhost:3000/api/cron/prep-forecast?token=YOUR_CRON_SECRET" > /var/log/prep-forecast.log 2>&1
```

### First manual run (validation)

```bash
# Default: company_id=3 (Ssam), 84d lookback, 7d horizon
curl "http://localhost:3000/api/cron/prep-forecast?token=$CRON_SECRET" | jq

# Expected shape:
# { "runId": 1, "status": "success", "demandRowsPulled": ~50000,
#   "weatherRowsPulled": ~91, "forecastRowsWritten": ~X, "durationMs": N }
```

### Still to build (Phase 2+)

- [ ] Portion mapping layer: Odoo BOM introspection for combo → prep item portions
- [ ] Weather multiplier computation: per-bucket ratio from tagged history (needs ~90 days of tagged data)
- [ ] DOW multiplier computation as explicit ratio (for reporting, not forecast math)
- [ ] Intra-day dynamic adjustment: compare morning actual vs forecast, scale remaining windows
- [ ] Staff confirmation UI: start-of-shift overlay on KDS
- [ ] Manager/admin dashboard: forecast vs actual variance, accuracy metrics
- [ ] Add What a Jerk (company_id=5) to `DEFAULT_COMPANY_IDS` once POS lives on staging
- [ ] `prune_old_forecasts` cron companion (call `pruneOldForecasts(30)` weekly)

## Rentals (Properties & Tenancies) — detail

### Shipped (2026-04-12)

**Frontend pages** — 16 route pages under `src/app/rentals/`, 16 components under `src/components/rentals/`:

| Screen | Route | Component | Status |
|---|---|---|---|
| Module dashboard | `/rentals` | `RentalsDashboard.tsx` | ✅ Real data (properties, tenancies, alerts stats) |
| Properties list | `/rentals/properties` | `PropertiesList.tsx` | ✅ Search, type badges, stats per card |
| Property detail (4 tabs) | `/rentals/properties/[id]` | `PropertyDetail.tsx` | ✅ Overview, Rooms, Utilities, Meters tabs |
| Add property form | `/rentals/properties/new` | `AddProperty.tsx` | ✅ Validation, confirm-on-discard |
| Room detail | `/rentals/rooms/[id]` | `RoomDetail.tsx` | ✅ Tenant, payments, next rent step |
| Add room form | `/rentals/rooms/new` | `AddRoom.tsx` | ✅ Property select, pre-fill from query param |
| Tenancies list | `/rentals/tenancies` | `TenanciesList.tsx` | ✅ Search, filter pills (All/Active/Ending/Past) |
| Tenancy detail (3 tabs) | `/rentals/tenancies/[id]` | `TenancyDetail.tsx` | ✅ Contract, Payments, Rent Steps tabs, Kaution bar, rent increase action |
| Create tenancy wizard | `/rentals/tenancies/new` | `CreateTenancy.tsx` | ✅ 3-step (Tenant → Terms → Review), Staffelmiete steps, confirm |
| Alerts | `/rentals/alerts` | `AlertsList.tsx` | ✅ Filter by status, dismiss, refresh engine |
| Payments & SEPA | `/rentals/payments` | `PaymentsDashboard.tsx` | ✅ Summary grid, SEPA upload, auto-reconciliation |
| SEPA reconciliation | `/rentals/sepa` | `SepaReconciliation.tsx` | ✅ Month nav, payment list, unmatched tx, manual matching |
| Rent increase wizard | `/rentals/rent-increase` | `RentIncreaseWizard.tsx` | ✅ Legal analysis, Kappungsgrenze/Mietpreisbremse, propose + confirm |
| Credential vault | `/rentals/vault` | `VaultList.tsx` | ✅ Reveal/hide credentials, audit logging |
| Inspections list | `/rentals/inspections` | `InspectionsList.tsx` | ✅ List with status badges |
| Inspection detail | `/rentals/inspections/[id]` | `InspectionDetail.tsx` | ✅ Category accordion, item-by-item condition, progress bar, sign & finalize |

**Dashboard tile** added to main portal home grid (`DashboardHome.tsx`), admin-only.

### Backend (already shipped — previous session)

- 25 API routes under `src/app/api/rentals/`
- Types in `src/types/rentals.ts`
- DB lib in `src/lib/rentals-db.ts` (19-table schema)
- Seed script `scripts/seed-rentals.ts` (3 properties, 11 rooms, 5 tenancies, 9 alerts)
- Supporting libs: `alerts-engine.ts`, `contract-templates.ts`, `inspection-pdf.ts`, `mieterhoehung.ts`, `pdf-generator.ts`, `sepa-matcher.ts`, `sepa-parsers.ts`, `vault.ts`

### Still to build

- [ ] Inspection creation wizard (select tenancy → type → date)
- [ ] Photo capture in inspection items
- [ ] Tenant self-service invitation flow (public link → form → signature)
- [ ] Utility cost detail / editing forms
- [ ] Meter reading manual entry form
- [ ] Room edit form
- [ ] Role-based visibility enforcement (vault = admin only)
- [ ] Rent increase: send to tenant, track response

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

### Prep Planner cron (one-time setup)
```bash
# On staging server 89.167.124.0 (SSH)
# 1. Set CRON_SECRET if not already set
grep -q '^CRON_SECRET=' /opt/krawings-portal/.env.local || \
  echo "CRON_SECRET=$(openssl rand -hex 24)" >> /opt/krawings-portal/.env.local
sudo systemctl restart krawings-portal

# 2. Add crontab entry
crontab -e
# Add this line:
# 0 4 * * * curl -s "http://localhost:3000/api/cron/prep-forecast?token=YOUR_CRON_SECRET" > /var/log/prep-forecast.log 2>&1

# 3. First manual run (validates against Ssam Kottbusser POS history)
curl "http://localhost:3000/api/cron/prep-forecast?token=$CRON_SECRET" | jq
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
