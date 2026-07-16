# Krawings Portal — STATUS

_Last updated: 2026-07-16_

## 2026-07-16 session — Full build audit + STATUS reconciliation (code reality vs docs)

Ran a 10-agent code-level audit of every module (surveys read the **actual code**, not this
file). Headline: **the code is well ahead of the docs.** STATUS.md and PORTAL.md had drifted
badly — several **shipped, live** modules were still recorded as unbuilt. The "Module status"
table below is rewritten to match reality.

**Also shipped 2026-07-16 (commits `0a28280`, `93c89c6`):** on the unified Staff screen
(`/admin/staff`), **resend/regenerate invite link** now shows a real **mail-server delivery
confirmation** (the SMTP `250` response via `sendStaffInviteEmail` → `email_server`), a red
error with the SMTP reason on failure, and a **Delete account** control (`deleteUser` +
`DELETE /api/admin/users/[id]`) that frees the UNIQUE email + employee for a fresh invite.
A portal-access panel + work-phone field were also added on the HR employee screen.

**Shipped-since items the docs were missing / mis-stating (now corrected in the table):**
- **Inventory** — was "⚠️ backend only, page.tsx NOT built"; it is **fully built and live**
  (7 screens, crate/pack counting, scan-to-create, photo proof, `stock.quant` writeback).
  Honest caveat: built but **not yet in active production use**.
- **Sales (WAJ dashboard)** — was **absent entirely**; `/sales` + `/api/sales` +
  `components/waj-sales` shipped (5 ranges, prev-period + YoY, 5 tabs, live POS + KDS timings).
- **Shifts / Planning** — was **absent** (PORTAL.md still called it "future/not built"); a
  ~19-screen / ~55-route module is **live** over `planning.slot`, incl. Gantt day-timeline +
  drag-to-create and MiLoG timesheet export.
- **Kiosk time-clock + Station shared-tablet acting token** — shipped; were undocumented.
- **Prep Planner frontend** — was "Phase 2 backend only"; the **full UI ships** (6 pages +
  8 components). Remaining work is algorithm refinement (weather/DOW multipliers hardcoded
  to 1.0; holidays treated as closed), not the frontend.
- **Purchase receive flow** — was "rebuild pending"; the **staff-submit → manager-approve +
  delivery-note-photo→PDF** path is shipped (OCR path removed).
- **HR onboarding** — was "⚠️ partial, pending validation/reset/profile"; onboarding,
  profile, documents, and password reset are all **shipped and validated on staging**.
  Open: consent acknowledgments persist only to localStorage; onboarding-complete status
  never set.
- **MO live ingredient edit + BOM versioning** and **Cooking-Guide featured dishes** — shipped.

**Real remaining work (prioritized) — the honest "to build" list:**
1. **Issues & Requests frontend (17 screens)** — complete backend (7-table SQLite, 11 REST
   routes, QR equipment registry) + Odoo addon `krawings_issues` are shipped and **completely
   invisible**. Highest leverage: pure UI unlocks a whole module.
2. **Reports UI consolidation** — 9 live APIs, but 5 tabs (Daily/Compare/Records/Menu/P&L)
   render "coming soon" while **finished standalone pages sit unlinked**; Menu Intelligence
   has no UI. Mostly wiring + one screen.
3. **Security: authenticate the 35+ open API routes** + make `requireAuth()` throw (the
   AUDIT_REPORT figure predates Sales/Shifts/Prep/Kiosk, so the real surface is larger).
4. **Tasks `/admin`** — the one non-functional mock in an otherwise complete module.
5. **Rentals tenant self-service + contract templates** — invite flow is broken end-to-end
   (links to a non-existent accept page; invites require a template nothing can create).
6. **Install/verify Odoo addons** — `krawings_issues`, `krawings_contract`,
   `krawings_document_layout` (per audit, uninstalled), `krawings_task_manager` (prod).
   Ensure only ONE of each duplicated pair is installed (`bom_auto_qty` **v4** not v3;
   `termination` **v2** not v1).
7. **DATEV export** — repeatedly promised (two disabled tiles + "wizard" framing); **zero
   implementation** exists anywhere.
8. **KDS production go-live** — config-only env flip + prod POS config id (awaiting Ethan).
9. **Smart-Shift recommendations layer** — the missing half of the shift value prop; the
   prep-forecast plumbing to feed it already exists.

Still just mocks/specs (unchanged): Invoice Scanner (8-screen mock), Music/Krawings Auto
(9-screen mock), Letter Writing (needs `krawings_document_layout`), Prep hot-hold/waste
(draft spec), Staffing Optimization (ML — largely superseded by the Smart-Shift heuristic).

**⚠️ Note:** this table now reflects a code-level audit, but the exact **staging/prod install
state of the custom Odoo addons is inferred from notes, not verified live** — verify against
the server before relying on it.

## 2026-07-11 session — Staff invite email: name the location + tell the manager when it was not sent (commit `5655422`)

End-to-end validated the onboarding flow on staging (`portal.krawings.de`): admin/manager
invite → `/invite/[token]` set-password → auto-login → staff sees Planning (time &
attendance), HR → My Documents, HR → My Profile (Odoo `hr.employee`). Auth is portal-local
(bcrypt in `data/portal.db`), linked to Odoo only by `employee_id`. Current account status:
**4 active · ~4 invited · ~34 not set up** of 42 employees — plumbing works, rollout hasn't
happened. Staging SMTP is live (Strato `no-reply@krawings.de`, company 0 default inherited
by all companies).

Two fixes shipped this session:

- **Invite email names the location.** `sendStaffInviteEmail` now leads with the employee's
  restaurant (`res.company` name) in the sender name, subject, body and footer, instead of a
  generic "Krawings Staff Portal" that reads as spam. `invite_all` now threads `company_id`
  through to the background sender (it was dropped, so bulk invites had no location).
- **Manager is told when the email was not sent.** `storeInviteForEmployee`/`createStaffInvite`
  return an explicit `email_status` (`sent | no_address | failed | skipped`); a send failure is
  no longer indistinguishable from "no address on file". Shared `inviteEmailNotice()` message
  used by both routes. Admin Staff Access shows green only when actually emailed, else a
  persistent amber warning + copy-link fallback. Add-staff form: fixed a `data.emailSent` vs
  `email_sent` camelCase bug that always said "No email on file". `invite_all` reports the
  no-email count.

Files: `src/lib/email.ts`, `src/lib/hr/invites.ts`, `src/app/api/admin/staff-access/route.ts`,
`src/app/api/hr/staff-invite/route.ts`, `src/app/admin/staff-access/page.tsx`,
`src/components/hr/EmployeeForm.tsx`. Build green; deployed to staging (service active, HTTP 200).
Verified live: inviting a no-email employee shows the amber warning and sends nothing.
Not yet verified: a real delivered email with the location (needs a live send to a controlled
address). Test residue on staging: `staff250.onboarding-test@krawings.de` (portal user linked to
"Ethan-Ruo Xu TEST ACCT" emp 250) + a pending invite on "DEMO Max Mustermann".

## 2026-07-08 session — Kiosk: manager-gated on-tablet settings (commit `64904c7`)

The Time Clock kiosk (`/kiosk`) previously only knew its restaurant from the URL
(`/kiosk?company=6`); a fresh tablet showed a dead-end "not set up" screen. Added a
**⚙ gear → settings screen** so a manager configures the tablet on-device.

- **Unlock = full portal login** (email + password), verified **server-side** with
  role ≥ manager. Staff/admin-less accounts get "Only managers can change settings".
  New route `POST /api/kiosk/admin-login` — returns the user's allowed companies
  (admins = all) and **sets NO session cookie** (a shared tablet must never stay
  logged in); auto-relocks on close or 60s idle (pointer + keyboard).
- **Settings** (localStorage, per device): restaurant (required) + tablet name,
  full-screen lock, idle-reset seconds, punch sound, and the "working now" footer.
  The `?company=` URL still works as a first-time fallback. Staff punch flow unchanged.
- Files: `src/lib/kiosk-settings.ts` (new), `src/app/api/kiosk/admin-login/route.ts`
  (new), `src/components/kiosk/{KioskSettings,KioskLoginGate,KioskSettingsForm}.tsx`
  (new), `src/app/kiosk/page.tsx` (gear + settings applied; overlay is a stable
  top-level sibling so setting the company doesn't remount it). e2e:
  `tests/kiosk-settings.e2e.spec.ts`. Spec: `docs/superpowers/specs/2026-07-08-kiosk-settings-design.md`.
- **Security review** (adversarial multi-lens) caught + fixed: rate-limit was
  IP-only and `X-Forwarded-For`-spoofable → added a **per-email** bucket; the 60s
  idle-relock never fired (parent re-renders re-armed it) → ref-based stable timer.
- **Verified on staging** (`portal.krawings.de`): build green; 3/3 Playwright e2e
  pass (fresh-setup path, staff refused, manager sets restaurant + persists); curl
  checks confirm 200 + no cookie for a manager, 401 wrong-pw, 403 staff, and 429 by
  the 6th spoofed-IP guess (per-email cap holds). WAJ = company **6**.
- **PROD pending** Ethan's go.

## 2026-07-03 session — Inventory: count drinks in crates + loose bottles (multi-UoM) (commit `8a4be4b`)

Added crate + loose-unit counting to the existing Inventory module (staging, `main`). This is Phase B "count in packs" — but implemented **portal-side**, not via Odoo `product.packaging` (staging has **zero** packaging records across all 1,151 products, and counting never needs them).

- **Crate size** lives in `product_flags.units_per_crate`. Managers/admins set it per product in **Product Settings** (opt-in). A "Suggest: N (from name)" chip parses the crate size out of the product name (e.g. `Coca-Cola Mw 24x0,33` → 24). No Odoo write.
- **Count entry**: a product with a crate size opens `CrateCountSheet` — two steppers (full crates + loose units) with a live base-unit total `(crates × size) + loose`. Products without a crate size keep today's single stepper/numpad, unchanged.
- **Storage**: `count_entries` + `quick_counts` gained nullable `crate_qty`, `loose_qty`, `units_per_crate` (additive migration in `migrateInventorySchema`). `counted_qty` stays the **base total**; approve still writes `stock.quant.inventory_quantity` in base units only — crates never reach Odoo.
- **Review** (manager + staff) gets a crates ⇄ units display toggle; the QC detail card shows the split. Base total drives the Odoo write regardless of display mode.
- Shared math in `src/lib/crate-units.ts` (unit-verified). Offline crate counting works (crate size cached per session; `updateCachedEntry` carries the split; a photo-only re-save preserves the split).
- Files: `crate-units.ts` (new), `CrateCountSheet.tsx` (new), `inventory-db.ts`, `inventory-offline.ts`, `types/inventory.ts`, `counts` + `product-flags/[product_id]` + `quick-count` routes, `ProductSettings`/`CountingSession`/`QuickCount`/`ReviewSubmissions`.
- **Verified on staging**: build green; migration applied to the live DB; manager crate-size set → read (24) → clear (null) round-trip all 200.
- Approved mock: https://claude.ai/code/artifact/76548528-f836-4265-b143-189b71e652eb

**Follow-up same day (commit `03b276e`) — generalized crate → labeled "pack".** Products can now be counted in any per-product unit (crate / bunch / piece / head / tray…) that converts to the base unit by an **average**. Managers pick the count-by word + size in Product Settings. Two shapes, chosen by base UoM: **weight/volume base (kg, L)** → a single "count pieces → = X kg (avg)" stepper (no loose field — staff have no scale on the floor); **countable base** (bottles) → keeps crates + loose. Covers herbs-in-bunches and loose produce (tomato/potato/scallion/cucumber counted by piece → kg). Added `product_flags.pack_label`; `crate-units` gained `pluralizePack` + `baseIsMeasure` + label-aware `formatSplit`. Odoo write still base-unit only. Verified on staging (1 piece = 0.12 kg → read back → clear, all 200).

## 2026-06-10 session — KDS: production-safe Odoo POS integration (commit `6e3f153`)

The KDS (built since the last STATUS update: `/kds` page, 14 components, state/priority/sound libs, kds-db.ts, 5 API route groups) was audited and hardened for live POS use on staging AND a config-only move to production.

**Critical fix — KDS is now strictly READ-ONLY towards Odoo:**
- Removed the `pos.order` write in `/api/kds/orders/done` (it forced `state='done'`, which bypasses the POS workflow and would corrupt session closing/accounting — same failure family as the account 1410 incident).
- Ready/Done stages now persist in a new `kds_completed_orders` SQLite table (pruned after 3 days). Pass state survives tablet reboots. The endpoint now accepts `{orderId, stage: 'ready'|'done'|'clear'}`.

**Order feed rewrite (`/api/kds/orders`):**
- Hybrid fire trigger: `paid` orders appear immediately (counter flow); `draft` orders appear once the waiter taps the Order button (detected via non-empty `last_order_preparation_change.lines`). Half-entered drafts never show.
- Service-day floor at 05:00 Europe/Berlin (orders after midnight belong to the previous service day until 05:00).
- Refund lines (`qty <= 0`) excluded; refund-only/empty orders dropped.
- Dine-in tickets show the real table name (`table_id`) when present, else `#tracking_number`.
- Completed-stage overlay merged server-side so all tabs (Prep/Ready/Done) rebuild correctly after reboot.

**state.tsx:** server stage is authoritative with optimistic local overlay; 15s recall protection prevents snap-back flicker; `pickup`/`recall` now persist stages.

**Verified live on staging via JSON-RPC introspection (2026-06-10):**
- WAJ POS = `pos.config` id **14**, company **6** (What a Jerk Kottbusser Damm 96), restaurant mode ON, session open.
- POS orders sync to the server immediately (drafts visible pre-payment) — polling confirmed viable, no webhooks/custom addons needed.
- EE Preparation Display models exist but hold no WAJ data — KDS stays independent of Odoo stages as designed.

**Staging → production switch is config-only:** flip `ODOO_URL` in `.env.local` to `http://128.140.12.188:15069`, restart service, set POS Config ID in KDS settings to the production config id (differs from staging — look up before go-live). Zero Odoo writes, zero custom addons.

**KDS test procedure (staging):** deploy portal → open `/kds` → Settings → POS Config ID = 14 → Save → "Sync products from POS" → ring a test order in WAJ POS. Paid orders appear within 5s; table-service orders appear after the Order button.

**Open KDS threads:** poll interval 5s (design said 2s), course separation, waiter notifications, order modification mid-round, multi-screen assignment, `kds_product_config` → `prep_items` migration.

## 2026-04-26 session — WAJ Boston Bay Jerk BOMs deployed

Deployed traditional Boston Bay-style jerk paste recipe to Odoo 18 EE staging (company id=5, What a Jerk). Two-level BOM structure for higher productivity:

- **Dry mix sub-assembly** (BOM id 166, code `WAJ-BB-DRY-MIX-v2.0`): 10 kg yield, 4 components (toasted/ground pimento + black peppercorns, brown sugar, salt at 57%), 4 work order operations with HTML notes. Yields ~7-8 wet paste batches; 8-week shelf life chiller.
- **Wet paste finished product** (BOM id 167, code `WAJ-BB-JERK-PASTE-v2.0`): 10.69 kg yield, 10 components including dry mix sub-assembly, 4 operations. Scallion-dominant, vinegar-based, no soy/cloves/nutmeg/browning/lager/OJ. 6.9% salt = 15.2g salt/kg chicken at 220g paste/kg application.

Recipe sources: Chris Aguilar (Jamaica-No-Problem) Maroon-lineage tradition, Stush Kitchen authentic Jamaican-born recipe.

Deploy script and README at `scripts/deploy_waj_boston_bay_boms.py` and `scripts/README.md`. Credentials read from `.env.local` (gitignored), never committed.

**Coexists with v1.0 commercial-style BOMs** (different product names with cloves/nutmeg/soy/browning/lager/OJ) for side-by-side production testing. Whichever style wins on customer taste tests becomes the locked production recipe; the loser gets archived in Odoo UI.

Bug fix discovered during deploy: in Odoo 18 EE multi-company setups, `mrp.workcenter.create` without `resource_calendar_id` defaults to a calendar from a different company, raising "Incompatible companies on records". Fixed in script by looking up WAJ-specific calendar (id=8 on staging) before creating work centre.

New raw material products created on staging: 1567 (Pimento berries, whole), 1568 (Black peppercorns, whole), 1569 (Brown sugar), 1570 (Water). All in RAW MATERIALS category, kg UoM, WAJ company. Need supplier prices set before BOM cost rollup is meaningful.

## Current focus
Active: HR onboarding / staff-invite rollout (resend + mail-server delivery confirmation +
delete-account shipped 2026-07-16; **~34/42 employees still not set up** — bulk invite not run),
Shifts refinements, the Sales dashboard, and permission-system rollout. Next highest-leverage
builds: **Issues UI**, **Reports UI consolidation**, and **security hardening** (see the
2026-07-16 audit entry above for the full prioritized list).

## Module status

_Rewritten 2026-07-16 from a code-level audit. Legend: ✅ shipped · ⚠️ partial · 🟡 backend only · 📋 designed/mock · ❌ not built._

| Module | Status | Notes |
|---|---|---|
| Auth / Login | ✅ shipped | cookie `kw_session`, bcrypt + server sessions; self-registration + admin approval; password reset/change; per-company SMTP |
| Admin / Staff hub | ✅ shipped | unified `/admin/staff` (People + Access): invite/resend + **mail-server delivery confirmation** + **delete account**, role×action permission matrix, per-user module/company scoping, SMTP + reminder settings, supplier-credential vault. Legacy `/admin/users` + `/admin/staff-access` still ship |
| Dashboard | ✅ shipped | 2×2 tile grid, module-access filtered |
| Manufacturing | ✅ shipped | MO/WO lifecycle over `mrp.*`, BOM CRUD + **versioning**, pick list, label subsystem. Outstanding: emerald→orange design migration |
| Recipes / Chef Guide / Production Guide | ✅ shipped | Kitchen board, concurrent cook sessions, timers, record/approve/publish, featured dishes + ingredient scaling |
| Purchase | ✅ shipped | ~16 screens: order guides, cart, PO create + auto-confirm, email/WhatsApp, manager approval, **receive flow (delivery-note photo→PDF)** |
| Inventory | ✅ shipped | 7 screens: counting sessions, quick-count, crate/pack counting, scan-to-create, photo proof, `stock.quant` writeback. **Not yet in active production use** |
| HR / Onboarding | ✅ shipped | 8-step DATEV wizard, profile, documents, contract status, invite/accept. Open: consent persistence (localStorage only), onboarding-complete status never set |
| Termination v2 | ✅ shipped | 4-step wizard, §622 BGB, DIN 5008 PDF + Sign, send-to-accountant. Odoo `krawings_termination_v2` = data layer |
| Shifts / Planning | ✅ shipped | ~19 screens / ~55 routes over `planning.slot`: claim, hours, covers, Gantt day-timeline + drag-create, patterns/publish, unconfirmed board, MiLoG export. **Smart-Shift recommendations layer not built** |
| Kiosk time-clock | ✅ shipped | no-login PIN punch → `hr.attendance`; on-tablet manager settings |
| Station (shared tablets) | ✅ shipped | PIN-gated, server-minted acting token for write attribution |
| Sales (WAJ) | ✅ shipped | 5 ranges, prev-period + YoY, 5 tabs; live POS + KDS timings (WAJ-only by design) |
| Contract scanner | ✅ shipped | Claude Vision API |
| KDS | 🟢 live-POS ready (staging) | read-only POS feed, prep/ready/done, batching, timers. **Production go-live = config-only, pending Ethan** |
| Prep Planner | ⚠️ frontend shipped, algo partial | full UI (6 pages) + EWMA nightly cron. weather/DOW multipliers hardcoded 1.0; holidays treated as closed; Ssam seed + prune cron pending |
| Reports | ⚠️ partial | 9 live read-only APIs; some tabs live, 5 render "coming soon" over **unlinked finished pages**; Menu Intelligence has no UI |
| Tasks | ⚠️ partial | staff/manager/templates/recurrence shipped; `/tasks/admin` is a non-functional mock |
| Rentals | ⚠️ partial | 16 pages, SEPA, rent-increase, inspections, meters, AES vault shipped; **tenant self-service invite broken**; contract templates missing; no route auth; standalone SQLite (no Odoo) |
| Issues & Requests | 🟡 backend only | 7-table SQLite + 11 REST routes + QR equipment registry + `krawings_issues` addon; **zero frontend** (17 screens not started) |
| Letter Writing | 📋 designed | DIN 5008 Form B; needs `krawings_document_layout` install |
| Invoice scanner | 📋 mock | 8-screen mock; Vision + Graph + WhatsApp + SEPA + DATEV — not built |
| Music (Krawings Auto) | 📋 mock | 9-screen mock; locked-down kiosk PWA + YouTube IFrame |
| Staffing optimization | 📋 designed | Prophet+XGBoost→OR-Tools; largely superseded by the Smart-Shift heuristic |
| DATEV export | ❌ not built | promised (2 disabled tiles + "wizard" framing); no export exists anywhere |
| WAJ Jerk BOMs | 🟢 deployed (staging) | Boston Bay v2.0 (id 166, 167) + commercial v1.0 coexist; side-by-side prod test pending |

## Prep Planner — detail

### Phase 1 shipped (2026-04-19, commit `96c34ef`)

**Backend pipeline**:

| File | Purpose |
|---|---|
| `src/lib/weather.ts` | Open-Meteo client (archive + forecast), Berlin 52.52°N/13.405°E, weather buckets (nice/heat/rain/cold/snow/normal) |
| `src/lib/prep-planner-db.ts` | 4 tables: `prep_demand_history`, `prep_weather_daily`, `prep_forecasts`, `prep_forecast_runs` + full CRUD |
| `src/lib/prep-planner-engine.ts` | `backfillDemandHistory`, `backfillWeather`, `backfillForecastWeather`, `computeForecasts`, `runForecastJob` |
| `src/app/api/cron/prep-forecast/route.ts` | Token-protected GET, defaults to company_id=3 (Ssam Kottbusser) |
| `src/app/api/prep-planner/forecasts/route.ts` | Read endpoint for future UI (no writes) |

### Phase 2 shipped (2026-04-19, commit `7115d67`)

**Problem**: cooks don't think in POS SKUs — they think in prep items ("make N portions of Rice"). One prep item often aggregates demand from multiple POS products (Extra Rice + rice that ships inside set menus) with different portions-per-sale multipliers.

**New files**:

| File | Purpose |
|---|---|
| `src/lib/prep-planner-mapping-db.ts` | 3 tables: `prep_items`, `prep_pos_link`, `prep_item_forecasts` + CRUD + projection |
| `src/lib/prep-planner-engine.ts` | **Patched**: `runForecastJob` now calls `computePrepItemForecasts` as step 3b |
| `src/app/api/prep-planner/items/route.ts` | GET list / POST create (with `UNIQUE(company_id, name)` → 409 Conflict) |
| `src/app/api/prep-planner/items/[id]/route.ts` | GET detail+links / PATCH update / DELETE (cascade) |
| `src/app/api/prep-planner/links/route.ts` | GET list / POST upsert / DELETE (with `portions_per_sale > 0` guard) |
| `src/app/api/prep-planner/forecasts-by-item/route.ts` | Read latest item-level forecasts joined with `prep_items` metadata |

**Key design choices**:
- `prep_items` is conceptually a superset of `kds_product_config` — when KDS is next touched, it can migrate to read from `prep_items`. This commit does NOT modify KDS.
- `computePrepItemForecasts` reads `prep_forecasts` (Phase 1 output) and projects via `prep_pos_link`. **Silent no-op for companies with no configured prep items**, so Ssam's existing cron keeps working unchanged.
- `forecast_run_id` is the shared linkage between POS-level and item-level forecasts.
- `source_products_json` stores the breakdown of which POS products contributed how many portions — debuggable in the UI later.

**Validation**: 21/21 runtime smoke tests pass (in-memory SQLite, real `better-sqlite3`): CRUD, UNIQUE constraints, upsert semantics, projection math (10 × 1.2 + 3 × 4 = 24), source attribution preservation, idempotent reruns via `ON CONFLICT DO UPDATE`, cascade deletes.

### Algorithm (per algorithm design doc, Sections 4.1–4.4)

- **Baseline** = EWMA α=0.85 over last 12 weeks of same-DOW-hour samples (heavy on recent)
- **Seasonal multiplier** = recent 4 weeks avg / same 4 weeks last year (capped 0.3–3.0)
- **Holiday multiplier** = 0 on Berlin public holidays, else 1
- **Weather multiplier** = 1.0 (Phase 1 stores the tag but doesn't apply; Phase 3 will compute per-bucket ratios)
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
# { "runId": 1, "status": "success", "demandRowsPulled": ~3400,
#   "weatherRowsPulled": ~91, "forecastRowsWritten": ~1400,
#   "prepItemRowsWritten": 0, "durationMs": N }
# prepItemRowsWritten stays 0 until you create prep_items + prep_pos_link rows
```

### Using the Phase 2 admin API

```bash
# Create a prep item
curl -X POST http://localhost:3000/api/prep-planner/items \
  -H "Content-Type: application/json" \
  -d '{"company_id": 3, "name": "Rice", "station": "pot", "prep_type": "batch",
       "prep_time_min": 40, "max_holding_min": 60, "batch_size": 20, "unit": "portion"}'
# → { "id": 1 }

# Link POS products to it (portions_per_sale tunes the multiplier)
curl -X POST http://localhost:3000/api/prep-planner/links \
  -H "Content-Type: application/json" \
  -d '{"prep_item_id": 1, "pos_product_id": 400, "pos_product_name": "[400] Extra Rice",
       "portions_per_sale": 1}'

curl -X POST http://localhost:3000/api/prep-planner/links \
  -H "Content-Type: application/json" \
  -d '{"prep_item_id": 1, "pos_product_id": 300, "pos_product_name": "[300] All About Beef",
       "portions_per_sale": 4, "notes": "set menu for 4 people"}'

# Re-run the cron (it will recompute item-level forecasts)
curl "http://localhost:3000/api/cron/prep-forecast?token=$CRON_SECRET" | jq

# Read item-level forecasts for tomorrow
curl "http://localhost:3000/api/prep-planner/forecasts-by-item?companyId=3&date=$(date -d tomorrow +%F)" | jq
```

### Still to build (Phase 3+)

- [ ] **Seed script for Ssam** — pre-create prep items (Rice, Kimchi, Bulgogi Marinade, etc.) and link to top-N POS products. Optional but removes friction for first-run validation.
- [ ] **Weather multiplier computation**: per-bucket ratio from tagged history (needs ~90 days of tagged data)
- [ ] **DOW multiplier computation** as explicit ratio (for reporting, not forecast math)
- [ ] **Intra-day dynamic adjustment**: compare morning actual vs forecast, scale remaining windows
- [ ] **Frontend pages** — `/prep-planner` route: 2×2 dashboard, prep items admin (list/edit), link management, forecast view
- [ ] **Cook-facing view**: start-of-shift overlay ("make N portions of X by T") with confirm/adjust/reject
- [ ] **Manager/admin dashboard**: forecast vs actual variance, accuracy metrics per prep item
- [ ] **Migrate `kds_product_config` → `prep_items`**: unify the two tables next time KDS is touched
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

### WAJ Boston Bay Jerk BOMs (one-off, already deployed 2026-04-26)
```bash
# Run from anywhere with HTTPS access to test18ee.krawings.de
cd scripts/
echo "ODOO_PASSWORD=your-password" > .env.local
python3 deploy_waj_boston_bay_boms.py             # dry-run
python3 deploy_waj_boston_bay_boms.py --execute   # deploy
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
