# KDS Cooking Timer — Build Handoff

_Written 2026-07-19. Design validated with Ethan via interactive mock over 6 iterations._
_Validated mock (source of truth for UX): `mocks/kds-cooking-timer/kds-cooking-timer-v1.html` (v1.6). Open it in a browser; the demo runs every step at 3 seconds._

## What this is

A station-based cooking timer for What a Jerk, running as a new portal screen on kitchen tablets, fed by the same POS order stream as the existing KDS. When a POS order arrives, order lines whose product has a **cook profile** appear in a TO COOK queue on the tablet(s) covering that profile's **station**. Staff tap to start; the timer walks them through the product's step chain (e.g. Fries: 1st Fry → Rest → 2nd Fry; Jerk Chicken: Smoke → Spray beer → Smoke) with loud audio + full-card visual alarms. On completion, the covered order lines are marked **ready** and the main KDS shows that per line.

Competitor patterns this borrows from: Kitchen Brains QPM/TT-700 (product-button multi-stage timers with per-stage action alarms, green/yellow/red), QSR Automations ConnectSmart (per-item cook times, station routing).

## Validated UX decisions (LOCKED — do not re-litigate without Ethan)

1. **Tablet setup is mixed**: each tablet multi-selects which stations it shows in its Settings screen (like the KDS POS-config picker). A dedicated Grill tablet enables only Grill; a shared tablet enables all. Stations: Grill, Deep Fry & Smoker, Oven — Manager can add more.
2. **Trigger: per POS order line only.** No manual/batch start grid in v1.
3. **Queue groups identical products** (same cook profile) into one card: "Fries ×3" listing covered order numbers, age = oldest order's wait. Two buttons on grouped cards: **COOK 1** (oldest only) and **COOK ALL ×N** (one batch timer covering all lines). Single items: whole card = tap to start.
4. **Batching combines only orders waiting now.** A line arriving mid-cook never joins a running batch — it waits and forms the next one.
5. **No auto-advance, ever.** Every step end → alarm state; the next step starts only on a confirming tap ("START: 2ND FRY"). Rationale: the timer can't drop the basket; a human does. The `rest` step type exists for labeling only — no special behavior.
6. **Alarm behavior**: repeating sound every ~1.6s until acknowledged + full-card red flash. Distinct tones: stage/action alarm vs a more insistent final DONE alarm. In alarm/done state the **whole card is the tap target**, not just the button.
7. **Two-tap confirms** for destructive actions: SKIP STEP → "TAP AGAIN TO SKIP" (3.5s window, auto-resets); ✕ CANCEL (visible red-outline pill in card header) → "SURE?". Never use `window.confirm` — blocked in WebViews/sandboxes and bad kitchen UX.
8. **Per-item mute**: 🔊 button next to CANCEL silences that timer's audio only; visual flash continues; amber 🔇 state. Global sound toggle in Settings kills everything. **Mute RESETS on each step advance** (decided by Ethan 2026-07-19): muting an alarm acknowledges that step only, so a silenced "Spray beer" must never carry through and swallow the eventual DONE alarm. Note the v1.6 mock predates this decision and keeps mute for the timer's life — the spec wins.
9. **KDS handoff**: on finish, all covered order lines are marked ready at LINE level; the main KDS order card shows a ✓ per timed line. (Current KDS tracks order-level state in `kds_completed_orders`; this adds line-level.)
10. **Colors** (match KDS urgency language): running green, final 15% of a step amber ("warnzone"), alarm/done red flashing. Queue cards age: >60s amber left border, >120s red pulsing.
11. **Immersive view**: no nav chrome (no hamburger/tab bar/home button), same rule as recipe screens and the KDS. Settings behind the corner gear.
12. **Audio is fire-and-forget and NEVER in the critical path of a state transition.** Set state and mark re-render BEFORE any sound call; wrap all Web Audio in try/catch. (A sandbox AudioContext throw froze the state machine in mock v1.0 — this is a hard rule.)

## Cook times — not final

Real per-step durations are still being measured on the floor by Ethan. **Seed placeholder profiles** so the module is testable end to end; durations get entered later via the Profiles screen (or a seed script). Nothing in the build depends on the real numbers.

When the real times arrive, remember WAJ items are location **reheat finishes** (central kitchen → chill → vacuum pack → location reheat), so these are finish times, not raw cook times.

## Data model (SQLite, `data/portal.db`, follow `kds-db.ts` lazy `ensureTables()` pattern)

```
cook_stations        (id, name, sort, active)            -- seed: Grill, Deep Fry & Smoker, Oven
cook_profiles        (id, odoo_product_id, name, station_id, max_batch NULL, active)
cook_profile_steps   (id, profile_id, seq, label, duration_seconds, step_type 'cook'|'rest'|'action')
cook_timers          (id, profile_id, station_id, pos_line_ids_json, order_refs_json,
                      current_step, step_started_at, state 'running'|'alarm'|'done'|'finished'|'cancelled',
                      muted, started_by, created_at, finished_at)
kds_line_ready       (id, pos_order_id, pos_line_id, timer_id, ready_at)   -- read by main KDS
```

Notes:
- `action` steps have `duration_seconds = 0` (instant prompt, e.g. "Spray beer", "Flip").
- `cook_timers.muted` is cleared on every step advance (see decision 8).
- Timekeeping is server-side from `step_started_at` (Berlin time via the `sv-SE` locale pattern — NEVER `toISOString()`), so a tablet reload/reconnect recovers exact remaining time.
- Zero Odoo writes. Same read-only stance as the KDS (see 2026-06-10 STATUS entry for why).
- Long-term: `cook_profiles` is conceptually adjacent to `prep_items`/`kds_product_config` — do NOT merge now, but keep naming compatible for a future migration.

## API routes (`src/app/api/cooktimer/`)

- `GET  /queue?stations=1,2` — POS lines with an active profile for those stations, not yet started, grouped client-side
- `POST /start` — body `{ line_ids: [] }` (1..n of same profile) → creates one timer
- `POST /timers/[id]/advance` — confirm current alarm, start next step (or finish if last); clears `muted`
- `POST /timers/[id]/mute` — toggle
- `POST /timers/[id]/cancel`
- `POST /timers/[id]/finish` — writes `kds_line_ready` rows for all covered lines
- `GET/POST/PATCH /profiles`, `/stations` — Manager+ only (enforce role in API, not just UI)

Reuse the existing KDS ~5s `pos.order` polling infrastructure (`/api/kds/orders` feed logic: hybrid fire trigger, 05:00 Berlin service-day floor, refund-line exclusion) — filter its lines by products having an active cook profile. Do not build a second Odoo poller.

## Screens

1. **`/cooktimer`** (staff, immersive): TO COOK queue (left rail) + active timer board (grid). Timer card: name +×N, order refs, station badge, mute + cancel in header, step name, big tabular countdown, step rail (per-step progress segments), context button (SKIP / START: NEXT / action-ack / DONE → READY ON KDS). Done strip at bottom showing recent ready pills. Settings overlay: station multi-select, sound toggle.
2. **`/cooktimer/profiles`** (Manager+, normal chrome, needs its own mock pass with Ethan before building): product picker from Odoo (read-only JSON-RPC, WAJ company 6 staging), station assign, step editor (label, mm:ss, type), max batch size, active toggle. Follow the module rules: dashboard tile entry, search bar on the list, confirm on delete.
3. **Main KDS change**: order cards read `kds_line_ready` and render a ✓ on covered lines.

## Build order

0. Add a "Cooking Timer" row (📋 → in progress) to STATUS.md's module table as part of the first commit; update it at session end per repo rules.
1. Introspect Odoo staging first (hard rule): confirm WAJ POS config id 14 / company 6, pull real product list, verify line ids available in the existing KDS feed.
2. DB layer + API routes with the queue endpoint driven by the existing KDS feed.
3. Station screen, porting the mock's interaction model 1:1 (the mock IS the approved UX, except decision 8 where this spec overrides it).
4. KDS ✓-per-line integration.
5. **STOP HERE for the first build session.** Profiles manager screen — MOCK FIRST with Ethan, then build.
6. Seed real profiles with Ethan (fries, jerk chicken smoke/spray chain, festival, plantain, wings, mac) once measured times exist.

## Explicitly out of v1 (phase 2 backlog)

- Manual/batch start grid (Kitchen Brains product-button pattern)
- Max-batch enforcement UI (schema field exists)
- "waiting +0:45" overtime display on unacknowledged alarms (slack visibility for the smoker)
- Join-running-batch (rejected — partial cook risk)
- Hold timers after cook
- Per-profile batch-size time adjustment (does a 3-portion basket need longer than 1? TBD from floor measurement)

## Portal rules that bind this build (from repo docs — read PORTAL.md, DESIGN_GUIDE.md, ux-rules.ts, design-system.ts first)

Separate component files per screen, PascalCase, shared primitives only from `src/components/ui/`; complete buildable pushes only; staging target only (`portal.krawings.de`, server 89.167.124.0, `git pull && npm run build && systemctl restart krawings-portal`); Berlin timezone rules; role checks in UI AND API; plain ASCII in any terminal commands; never include `product_qty` in WAJ BOM writes (not relevant here, but the addon rule stands).
