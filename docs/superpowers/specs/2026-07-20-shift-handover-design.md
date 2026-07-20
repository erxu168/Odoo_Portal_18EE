# Shift Handover — Design Spec

**Date:** 2026-07-20
**Module:** `shift-handover` (portal-only; surfaced under "Inventory > Shift Handover")
**Repo:** `erxu168/Odoo_Portal_18EE` (Next.js 14 App Router, better-sqlite3, TypeScript, Tailwind)
**Branch:** `main` (portal single-branch rule)

---

## 1. Goal & hard constraints

Give the **incoming kitchen shift** a reliable operational picture of produced food, tracked per **physical container**. This is operational communication, **not** stock valuation.

Hard constraints (from the brief):
- **Portal-only.** All handover data lives in the portal SQLite DB (`data/portal.db`). No new Odoo module.
- **No Odoo stock/MO/quant/lot/transfer/adjustment dependency.** The module must remain fully usable with no scale and with Odoo offline.
- Track **each container separately** — one production batch can have containers in different locations and states.
- **Preparation state** and **availability state** are separate axes with cross-field validation.
- **Photos are central**: camera capture, preview, remove/re-add, multiple, captions; configurable optional/recommended/mandatory per product/event; never silently delete historical photos.
- **Submitted handovers are immutable** (locked snapshot); corrections only via an auditable supersession/reconciliation flow.
- **Full audit trail.** Role permissions: admin / manager / staff.

## 2. Reuse decisions (from codebase audit)

| Concern | Decision | Source |
|---|---|---|
| DB access | Reuse `getDb()` (`src/lib/db.ts`), WAL, `better-sqlite3` transactions. New `src/lib/shift-handover/*`. | audit |
| Table init/migrations | Copy inventory pattern: exported `initHandoverTables()` called at top of each route; try/catch `CREATE ... IF NOT EXISTS` + guarded `PRAGMA table_info` ALTERs. | inventory-db.ts |
| Timestamps / dates | `nowISO()` = `new Date().toISOString()`; operational date via `berlinToday()` (`src/lib/berlin-date.ts`). Store UTC instants + a Berlin operational_date. | audit |
| Photos | base64 data-URLs, `handover_photos` side table modeled on `count_photos`; downscale like `PhotoCaptureStrip`. | audit |
| Portal activity feed | Reuse global `logAudit({module:'shift-handover'})` as a **secondary** feed; the **canonical** trail is our own append-only `handover_events`. | audit + Codex |
| Auth / user | `requireAuth()` / `getCurrentUser()` → `PortalUser {id,name,role,employee_id,allowed_company_ids}`. | auth.ts |
| Permissions | Add `handover.*` rows to `PERMISSION_ACTIONS` (`src/lib/permissions.ts`); check `roleCan(role, key, getPermissionOverrides())`, fail-closed. | permissions.ts |
| Company scoping | `parseCompanyIds`, `canAccessCompany`, `companyScope`, `isUnrestrictedAdmin` (`src/lib/inventory-access.ts`); active company from `kw_company_id` cookie. WAJ = co5 (co6 staging). | inventory-access.ts |
| Shared-tablet identity | `resolveAttribution(user)` (`src/lib/shift-attribution.ts`); **require a resolved human actor for every mutation.** | Codex |
| Storage locations | **Reuse** `count_locations` + `location-tree.ts` (nested `parent_id`, company-scoped, kinds). Seed WAJ locations + a `hot_holding` kind. **Not** `/api/inventory/locations` (Odoo). | audit + Codex |
| Shift boundary | **Build thin concept**: handover keyed by `company_id + operational_date + shift label` (Opening/Mid/Closing). Populate people via `getTodayRoster`/`fetchOpenAttendance`; no Odoo shift entity to FK. | audit |
| Products | **Build portal-local `handover_products`** (seeded with the 4 MVP items incl. component products), optional `odoo_product_id` link. Keeps module Odoo-independent + supports component products as separate records. | brief + audit |
| Container types | **Build** `handover_container_types` (GN 1/1, GN 1/2, tubs, …). No catalog exists today. | audit |
| UI shell / design | Reuse `AppHeader`, `SortableTileGrid`, `ConfirmDialog`, inventory `ui.tsx` (`FilterBar`/`FilterPill`/`SearchBar`/`StatusBadge`/`EmptyState`/`ProductThumb`), `PhotoCaptureStrip`, `NumpadModal`, `Toast`. **Green `#16A34A`** primary, blue `#2563EB` AppHeader, `var(--fs-*)` typography (NOT the orange system in the Odoo-19 CLAUDE.md). | audit |

## 3. Module layout

```
src/lib/shift-handover/
  types.ts          # shared TS types + enums (single source of truth)
  states.ts         # pure state-machine: allowed states, cross-field validation
  db.ts             # schema, migrations, triggers, seed, low-level queries
  queries.ts        # read models (current production, storage overview, handover preview, history)
  commands.ts       # transactional mutations (create batch, add containers, transitions, submit, ack…)
  snapshot.ts       # build + hash the immutable handover snapshot
  access.ts         # capability + company + actor guards for this module
  seed.ts           # default products, container types, locations, shift labels
src/app/shift-handover/          # route + screens (single-page Screen-union router like inventory)
src/app/api/shift-handover/...   # named command endpoints
src/components/shift-handover/   # screen components
src/types/shift-handover.ts      # re-export of lib/types for client
```

Navigation: top-level route `/shift-handover`, registered in `modules.ts` (`{id:'shift-handover', minRole:'staff'}`), surfaced as a tile on the **Inventory dashboard** (and main dashboard) so it reads as "Inventory > Shift Handover".

## 4. Data model (tables, all `handover_`-prefixed, all `company_id`-scoped)

- **handover_products** — `id, company_id, name, kind('finished'|'component'|'other'), unit, odoo_product_id?, photo_policy('optional'|'recommended'|'mandatory'), active, sort_order, created_at`.
- **handover_container_types** — `id, company_id, name, category, capacity_label?, reference_photo?, internal_code?, active, sort_order`.
- **handover_batches** — `id, company_id, operational_date, product_id→handover_products, product_name (snapshot), shift_label, produced_by_user_id, produced_by_name, produced_at, note, status('open'|'closed'), version, created_at, updated_at`.
- **handover_containers** — `id, company_id, batch_id→handover_batches, product_id, container_code (A/B/C…), container_type_id→handover_container_types, fill_level INT CHECK in (0,25,50,75,100), quantity_method, exact_quantity?, unit?, preparation_state, availability_state, storage_location_id→count_locations, use_first INT, next_action?, note?, status('active'|'depleted'|'discarded'), version, created_by_user_id, created_by_name, created_at, updated_at`.
- **handover_photos** — `id, company_id, entity_type('container'|'batch'|'action'|'discrepancy'|'acknowledgement'), entity_id, event('production'|'discrepancy'|'waste'|'hold'|'completion'|'general'), photo (dataURL), caption?, uploaded_by_user_id, uploaded_by_name, uploaded_at, active, replaced_photo_id?`. (Never hard-delete: set `active=0`, keep `replaced_photo_id`.)
- **handover_actions** — `id, company_id, batch_id?, container_id?, handover_id?, instruction, priority('normal'|'important'|'urgent'|'food_safety_critical'), assigned_role?, due_at?, status('open'|'in_progress'|'done'|'cancelled'), completed_by_user_id?, completed_by_name?, completed_at?, completion_note?, completion_photo_id?, version, created_by_user_id, created_at, updated_at`.
- **handover_handovers** — `id, company_id, operational_date, outgoing_shift_label, incoming_shift_label, status('draft'|'submitted'|'acknowledged'|'acknowledged_with_discrepancies'|'superseded'), submitted_by_user_id?, submitted_by_name?, submitted_at?, snapshot_hash?, acknowledged_by_user_id?, acknowledged_by_name?, acknowledged_at?, ack_outcome?, summary_note?, superseded_by_id?, version, created_at, updated_at`.
- **handover_snapshot_containers** — immutable copy of each included container + product/location/type labels at submit. `handover_id, ...frozen fields..., photos_json`. **UPDATE/DELETE blocked by trigger.**
- **handover_snapshot_actions** — immutable copy of open/in-progress actions at submit. **UPDATE/DELETE blocked by trigger.**
- **handover_discrepancies** — `id, company_id, handover_id, snapshot_container_id?, discrepancy_type('confirmed'|'quantity_differs'|'product_not_found'|'wrong_location'|'wrong_state'|'quality_issue'|'temperature_issue'|'other'), expected_value?, reported_value?, note?, photo_id?, reported_by_user_id, reported_at, resolved_by_user_id?, resolved_at?, resolution_note?, status('open'|'resolved')`.
- **handover_events** — canonical append-only audit: `id, company_id, actor_user_id, actor_name, entity_type, entity_id, action, before_json?, after_json?, reason?, operational_date, created_at`. **UPDATE/DELETE blocked by trigger.**
- **handover_idempotency** — `key PRIMARY KEY, company_id, result_id, created_at` for submit/ack retry-safety.

Indexes: batches by `(company_id, operational_date)`; containers by `(company_id, status)`, `(storage_location_id)`, `(batch_id)`; partial unique on active handover per `(company_id, operational_date, outgoing_shift_label)` where status in draft/submitted.

## 5. State machine (pure, `states.ts`)

- **preparation_state**: `raw, prepared, cut, mixed, smoking, cooking, cooling, chilled, ready, partially_used` (+ product-specific ordering config later).
- **availability_state**: `not_ready, ready_for_service, backup_stock, reserved, on_hold, expired, discarded, depleted`.
- **quantity_method**: `counted, measured, container_estimate, visual, unknown`.
- **Cross-field rules (validation, not just per-field):**
  - `preparation_state ∈ {raw, smoking, cooking, cooling}` ⇒ availability may **not** be `ready_for_service` (the "cooling can't be ready" rule).
  - `availability = depleted` ⇒ container `status='depleted'` (and vice-versa); `discarded` likewise.
  - active container **must** have a `storage_location_id` and a `preparation_state`.
  - `fill_level` must be one of the 5 allowed values.
  - product `photo_policy='mandatory'` ⇒ container cannot be saved without ≥1 active photo (also enforced for events: waste, hold, discrepancy, unknown quantity).
- Manager override path records the bypassed rule + a mandatory reason (post-MVP for state overrides; MVP enforces hard).

## 6. Handover lifecycle

1. **Preview (draft)** — generated live from current containers + open/critical actions grouped into: Ready for Service · Backup Stock · In Production/Cooling · Components Prepared Separately · Actions Required · Use First · On Hold/Discrepancies · No Production Recorded. Not authoritative.
2. **Submit** — one IMMEDIATE transaction: verify actor+company+version → re-read live containers/actions → validate → insert normalized immutable snapshot rows + media manifest → set `submitted_by/at`, snapshot SHA-256 hash → append `handover_events` row → commit. Idempotency-keyed. Submitted = read-only (triggers enforce).
3. **Acknowledge** — incoming leader; CAS `submitted → acknowledged | acknowledged_with_discrepancies`. Records who/when/outcome. Discrepancies are observations against the snapshot; they do **not** mutate it or live containers.
4. **Reconcile/supersede** — corrections create follow-up actions or a superseding handover; the original snapshot is never altered.

## 7. Permissions (`handover.*` capabilities)

| Capability | Default roles |
|---|---|
| `handover.view` | staff, manager, admin |
| `handover.production.record` | staff, manager, admin |
| `handover.action.create` | staff, manager, admin |
| `handover.action.manage_critical` | manager, admin |
| `handover.submit` | manager, admin (+ designated leader) |
| `handover.acknowledge` | manager, admin (+ designated leader) |
| `handover.discrepancy.resolve` | manager, admin |
| `handover.configure` | admin |
| `handover.history.view` | staff, manager, admin |

Every route: `requireAuth()` → `roleCan(...)` → company scope → **resolved actor** (shared-tablet) → command. Server-side module-access guard added (not UI-only).

## 8. Screens (mobile-first, reuse map)

| Screen | Reuse |
|---|---|
| Dashboard (tile grid) | `SortableTileGrid` + live badge counts |
| Current Production | card list (mirror `MoIngredients`), batch cards → container list, add-container |
| Storage Overview | location-grouped list (mirror `GoodsReceived` rows-in-card + `count_locations` tree), filters (product/location/state/use-first/shift) |
| Record Production (wizard) | product picker → prep state → add containers (fast-entry: create N identical) → photo (`PhotoCaptureStrip`) → save |
| Shift Handover | auto-generated sectioned preview → `ConfirmDialog` submit; Acknowledge sheet with discrepancy types |
| Tasks | action list (dot+pill+priority), complete with optional photo |
| History | read-only handover + event list, `DateFilter`, photo lightbox |
| Configuration | products (photo policy), container types, locations, shift labels — `ProductSettings`/`ManageTemplates` patterns; admin-gated |

## 9. MVP scope vs deferred

**In (satisfies acceptance criteria):** schema+migrations+seed (4 products, container types, WAJ locations, shift labels); record production w/ N containers, fill levels, locations, states, use-first, next-action, photos; live storage overview; auto-generated handover; submit (immutable snapshot); acknowledge; discrepancy reporting; tasks; audit history; role permissions; mobile UI; fast-entry create-N-containers.

**Deferred (documented):** per-product configurable workflow ordering UI; manager state-override flow; notifications engine (alerts listed as future); container reference-image upload; kg conversion table; hash-chain sealing, magic-byte sniffing, media GC; offline queue reuse.

## 10. Top risks & mitigations

- **Contradictory states** → single pure `validateContainer()` used by every command + DB CHECKs.
- **Silent handover edits** → normalized snapshot + triggers rejecting UPDATE/DELETE + SHA-256 hash.
- **Concurrent submit / double-tap** → `busy_timeout`, IMMEDIATE tx, `version` CAS, idempotency key, partial unique index.
- **Cross-company ID injection** → every referenced id (product/location/container/batch/action) re-checked against the actor's company.
- **Shared tablet mis-attribution** → mutations require a resolved human actor.
- **History showing wrong photos** → snapshot copies photo references; live photos are never hard-deleted (soft `active=0`).

## 11. Verification

- Unit tests: `states.ts` validation matrix, snapshot builder + hash stability, idempotency.
- `npm run build` (TS gate).
- Codex diff review.
- **Playwright real-browser test on staging** (required per user rule) walking the full acceptance-criteria flow with the 4 MVP products, incl. one batch → 3 containers in 3 locations, submit, acknowledge, discrepancy, history.
