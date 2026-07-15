# Prep Planner — Hot-Hold Batch & Waste-Avoidance (design)

- **Date:** 2026-07-14
- **Status:** Draft for owner review (self-reviewed against code by a 3-lens adversarial pass — all load-bearing claims CONFIRMED)
- **Owner:** Ethan (non-coder — this doc leads with plain English; technical detail is in clearly marked sections)
- **Target restaurant:** What A Jerk (Jamaican fast food). Register = POS config 14. **Company id = unresolved — see §6.4 / §7 Stage 1 precondition.**
- **Repo:** `erxu168/Odoo_Portal_18EE`, branch `main`. **The KDS is not touched by this work.**

---

## 1. What we're building, in one paragraph

A kitchen tool that tells cooks **how much of each hot-held / ready-to-serve food to cook ahead**, and warns them when a batch is **about to pass its safe hold-time** — so there's enough food for the rush but as little as possible ends up in the bin. It learns how much to make from the till (per dish, by day and time), lets a cook log a batch with one tap (which starts an expiry countdown), nudges "cook another batch now" when stock is running low, and keeps a record of what was thrown away so waste can be watched and reduced.

## 2. Good news: half of it already exists

The portal already has a working **Prep Planner** (`/prep-planner`, manager-gated, its own screen — separate from the KDS). What already works and we **reuse**:

- **Learns from the till per dish, by weekday × hour.** In `src/lib/prep-planner-engine.ts`: `backfillDemandHistory()` pulls `pos.order.line` quantities joined to each order's timestamp, converts to Berlin time, and stores them in `prep_demand_history`; `computeForecasts()` runs a recent-weighted average (EWMA) per weekday+hour. The roll-up to cook-facing items, `computePrepItemForecasts()`, lives in `src/lib/prep-planner-mapping-db.ts` (imported and orchestrated by the engine).
- **Prep items** (`prep_items`) already carry the fields we need: `max_holding_min` (hold-time), `prep_type` (TEXT, free-form), `batch_size`, `unit`, `station`. Mapped to till products via `prep_pos_link` (`portions_per_sale`).
- A **start-of-shift plan** (`CookPlanModal` + `/api/prep-planner/cook-plan`) with Confirm / Adjust / Skip.
- A **forecast-accuracy** review screen (`PrepVariance`).

What is **missing** (the whole "stop the waste" half — see §5.3–§5.4): one-tap "made a batch" logging, live **on-hand tracking**, **expiry timers**, live **"cook another now"** nudges, **waste logging**, the **three-group behaviour**, and a gentle **"still learning"** state (today thin data is silently dropped, not shown).

## 3. Locked decisions (from brainstorm — do not re-litigate)

1. **When used:** BOTH a start-of-shift prep plan AND live during-service nudges.
2. **How much:** **learn from the till only** (per-dish sales by day + time). No manual day-part amounts. Cautious "still learning" output when data is thin.
3. **Batch tracking:** the **cook taps "made a batch"** (item + rough size) → starts an expiry timer and tells the tool how much is on hand.
4. **Placement:** its **own separate screen**. KDS untouched.
5. **Delivery:** **full tool, in safe stages** — owner may pause after any stage.

## 4. The items, their groups, and units

Exactly **one unit per item**, chosen at setup, from: **piece**, **weight (kg)**, **tray**, **portion**. (No dual/slashed units — the chosen unit is the one every number is shown in and the one the "per sale" factor converts into.)

| Item | Group | Hold-time | Unit |
|---|---|---|---|
| Jerk chicken | A — short hot-hold | 3 h | piece |
| Jerk wings | A — short hot-hold | 3 h | piece |
| Rice & peas | A — short hot-hold | 6 h | tray |
| Festival | A — short hot-hold | 2 h | piece |
| Patties | A — short hot-hold | 2 h | piece |
| French fries | B — cook-to-order (excluded) | ~10 min | weight |
| Cole slaw | C — cold multi-day | 2 days | weight (or portion) |
| Sliced tomato | C — cold multi-day | 1 day | weight (or piece) |
| Iceberg lettuce | C — cold multi-day | 1 day | weight (or piece) |
| Escovitch red onions | C — cold multi-day | 3 days | weight |

**`group` drives all behaviour** (it is the sole switch; the existing `prep_type` field is left untouched and is not relied on):
- **A (hot_hold):** full treatment — start-of-shift target + live batch button + expiry countdowns + "cook another now" nudges.
- **B (cook_to_order):** **excluded** from targets and nudges; no timers. Shown on the plan only as a greyed *"made to order — no prep target"* info line so the cook sees it's intentionally left alone. (Fries.)
- **C (cold_prep):** a daily *"prep this much, use by [date]"* list. Same batch mechanism as A but with a **days-scale** expiry rendered as a **date** (not a minute countdown) and **no mid-service nudges**. Waste is still captured via the end-of-life "binned" tap so cold items appear in the waste report.

**Units & the till.** Because the till can't weigh, **weight items use a "units per sale" factor** in the item's own unit (e.g. one fries portion sold ≈ 0.15 kg; one combo sold ≈ 2 chicken pieces). This is the existing `prep_pos_link.portions_per_sale` field, reinterpreted as "units-of-this-item consumed per till sale". Logging a made batch of a weight item is a rough estimate (e.g. one pan ≈ 2 kg), consistent with the existing inventory count-by-pack behaviour (no floor scale).

---

## 5. Design — the experience, walked through a kitchen day

### 5.1 Part 1 — Setup (once, by a manager)

Per item, the manager sets: **group** (A/B/C), **hold-time**, **unit**, **standard batch size**, and **which till products it maps to** (with the per-sale factor). Most fields exist on `prep_items`; additions are the explicit **`group`** field and a **days-scale** hold-time for group C (§6.2). We also **aim the tool at What A Jerk** (resolve the company id first — §6.4). WAJ items and their `prep_pos_link` mappings don't exist yet and must be created.

### 5.2 Part 2 — Start-of-shift plan

On the Prep screen: *"Today looks [busier/quieter] than usual — aim to have roughly this much ready,"* per item, spread across the day. Cook can **Confirm / Adjust / Skip** (reuse the existing cook-plan + acks). This plan **moves onto the `/prep-planner` screen** (today the interactive modal lives on the home dashboard and points at Ssam).

- **Still-learning (locked #2):** the plan starts from the set of **active group-A/C items that have a till mapping**, not just items that happen to have a forecast. Any item with **no forecast rows** or an aggregated **sample size below the engine's `minRows` threshold** (§6.3) is shown as *"still learning — use your judgement"* instead of a number. (This replaces today's behaviour, where a thin item produces zero forecast rows and simply disappears.)
- **Group B** items appear as info-only (no target). **Group C** items appear as a *"prep this much, use by [date]"* checklist (quantity rule in §6.3).

### 5.3 Part 3 — During service (the live heart) — NEW (group A)

**(a) "I made a batch" — one tap.** Cook taps the item; size pre-fills one standard batch (adjustable). This **starts a countdown** to the item's hold-time and **adds the amount to "ready now."** Logged under whoever is signed in via the existing shared-tablet "working as" PIN (attribution is nice-to-have, not a blocker; falls back to the tablet account).

**(b) Expiry countdowns.** Each live batch shows time left (*"Jerk chicken — 1:50 left"*). Amber in the final window (default last 25 min: "use or bin soon"), red at zero ("bin this"). Cook taps **"binned"** (records the leftover as waste) or **"all sold"** (closes it with no waste).

**(c) "Cook another batch now" nudge.** The tool keeps a running **"ready now"** per item (exact math in §6.3) and compares it against **expected demand for the next 60 minutes** (from the forecast). If ready-now falls short, it nudges *"Cook another batch of X (~n units) to cover the next hour."* Well-stocked → stays quiet. Still-learning → *"keep an eye on X"* (no number). The nudge is a **suggestion, never a block**.

**Honest limits (shown in help):**
- The tool knows what **sold**, not what was dropped/comped — "ready now" is a good estimate the cook corrects with "all sold"/"binned".
- **Till timing:** the live figure assumes the till reports a sale to the backend within a minute or so *while the session is open*. If WAJ's POS only syncs at session close (verified in Stage 1 — §7), on-hand won't drop live; in that case the cook's taps become the primary signal and the nudge leans on the forecast + elapsed time rather than live sales.

### 5.4 Part 4 — Looking back + who/where — NEW

- **Waste log & payoff:** every binned/expired batch (group A **and** C) is recorded, and — via the waste tracker in §5.5 — so is **raw-ingredient** waste. One weekly view shows *"made X, sold Y, binned Z"* per dish **and** ingredients thrown away by reason, with a **€ total** where costs are known, to watch waste drop and tune hold-times/batch sizes. (Distinct from the existing forecast-accuracy screen, which compares forecast vs sales.)
- **Cold multi-day list:** group-C items as a daily prep checklist with use-by dates; today's target nets out any still-valid carryover from prior days (§6.3).
- **Who & where:** managers set up items (existing `prep-planner.*` permissions); cooks use it on the kitchen tablet via the existing **"WAJ Kitchen Tablet"** shared account + "working as" PIN. Own screen; **KDS untouched.**

### 5.5 Waste & spoilage tracker (ingredients + dishes) — NEW

Two kinds of waste, one report:
- **Dish waste** is already captured by the batch flow (§5.3b): a batch tapped **"binned"** or left past its hold-time records its leftover as waste — no extra work for the cook.
- **Ingredient waste** is captured by a **"Log waste"** quick-flow that reuses the Inventory count screens: the cook searches or **scans** the ingredient, enters the amount in the unit they already count in (2 kg tomatoes, 3 crates, 1 bunch — via the existing `CrateCountSheet`), taps a **reason**, and optionally photographs the bin. Credited to whoever is signed in (shared-tablet "working as" PIN via `resolveAttribution`).
- **Reasons (fixed list of 5):** Spoiled · Expired · Prep trim · Over-prepped · Dropped.
- **Placement:** one shared **Waste** screen, reachable as a tile from **both** Inventory and Prep Planner. Dishes feed it automatically; ingredients via the quick-log.
- **The report:** dishes as *made / sold / binned*; ingredients as *thrown away by reason*, each valued at **qty × ingredient cost** for a weekly **€ total**. Where an ingredient has no cost entered, show the quantity and **"cost not set"** rather than a false €0.
- **Honest limits:** ingredient waste depends on staff logging it (the automatic "derive it from stock counts" method is too noisy without guaranteed daily open/close counts — see §11). € accuracy depends on ingredient costs being maintained in the system.

---

## 6. How it works under the hood (for the implementation plan)

### 6.1 Reused as-is
- Engine: `backfillDemandHistory`, `computeForecasts` (`src/lib/prep-planner-engine.ts`); `computePrepItemForecasts` (`src/lib/prep-planner-mapping-db.ts`, called by the engine).
- Tables: `prep_demand_history`, `prep_forecasts`, `prep_items`, `prep_pos_link`, `prep_item_forecasts`, `prep_plan_acks`.
- Start-of-shift: `/api/prep-planner/cook-plan` (+ `/ack`), `CookPlanModal`.
- Screen shell: `src/app/prep-planner/*`, `src/components/prep-planner/*`. Attribution: existing `resolveAttribution` (shared-device "working as").

### 6.2 New / changed data
- **`prep_batches`** (the keystone) — one row per cooked/prepped batch: `id`, `company_id`, `prep_item_id`, `made_at`, `made_by`, `size` (REAL, item's unit), `unit`, `expires_at` (= `made_at` + hold-time), `status` (`active` | `sold_out` | `discarded` | `expired`), `discarded_qty` (REAL, nullable — the leftover binned at close), `closed_at`. Index `(company_id, prep_item_id, status)`. Used by **both** group A (minute expiry) and group C (day expiry).
- **`group`** on `prep_items` — `hot_hold` | `cook_to_order` | `cold_prep`, **NOT NULL, default `hot_hold`**. Existing Ssam rows migrate to `hot_hold`; setup must set the right value. Batch/nudge logic fires **only** for `group='hot_hold'`.
- **`batch_size` → REAL.** Today `prep_items.batch_size` is INTEGER, which truncates weight standard batches (e.g. 1.5 kg pan). Widen to REAL (SQLite table rebuild) or add a REAL `standard_batch_size`. `prep_batches.size` is already REAL.
- **`sample_size` on `prep_item_forecasts`.** Today this column exists only on the POS-product-level `prep_forecasts`; the cook-facing views read `prep_item_forecasts`, which has none. Add an aggregated `sample_size` (sum/min of contributing products' sample sizes) populated in `computePrepItemForecasts`, so "still learning" is computable at item level.
- **`waste_events`** (ingredient waste; lives with the Inventory module) — one row per logged ingredient waste: `id`, `product_id` (Odoo `product.product`), `qty` (base unit via `crate-units`), `uom`, `reason` (`spoiled` | `expired` | `trim` | `over_prep` | `dropped`), `location_id` (→ company scope, matching Inventory's pattern), `logged_by`, `logged_at`, `note`, `unit_cost` (snapshot of `standard_price` at log time), optional photo via the existing polymorphic `count_photos`. **Not** a reason column on counts (counts are absolute snapshots; waste is a delta that also happens outside count sessions). Dish waste stays on `prep_batches.discarded_qty`; the report **unions** the two.

### 6.3 New logic / endpoints (Stage-3 math pinned)
- **Log/close batch:** `POST /api/prep-planner/batches` (item, size) → writes `prep_batches`, computes `expires_at`. `PATCH …/batches/[id]` → `sold_out` (no waste) | `discarded` (+`discarded_qty`); a batch past `expires_at` still `active` is treated as `expired` and its unsold remainder counts as waste.
- **Live state:** `GET /api/prep-planner/live?companyId` → per group-A item: open batches + countdowns, **on-hand**, **expected demand next 60 min**, and a **nudge verdict** (`cook_now` + suggested qty | `ok` | `still_learning`). Polled ~every 30–60 s.
- **On-hand (single pinned algorithm — FIFO):**
  1. Reference point = the **oldest still-active batch's `made_at`** for that item.
  2. `soldSince` = mapped till sales for that item since the reference point (Σ over mapped products of `qty × portions_per_sale`).
  3. Consume `soldSince` from active batches **oldest-first**; each batch's remaining = `size − consumed`, floored at 0.
  4. **on-hand** = Σ remaining across active batches. Sales attributed to already-closed batches are **excluded** (they happened before the reference point).
  - *Worked example:* 10:00 Batch A=20 → on-hand 20. 10:40 Batch B=20; sales since 10:00 = 9 → A: 20−9=11, B: 20 → on-hand 31. At A's expiry with 3 unsold → 3 recorded as waste, A closed; reference point moves to B's `made_at`.
- **Nudge:** window = **next 60 minutes** of forecast (sum `prep_item_forecasts.forecast_portions` for the coming 60 min; configurable per group later). If `on_hand < expected_next_60` and the item is **not** still-learning → `cook_now`, suggested qty = round up `(expected_next_60 − on_hand)` to the nearest standard batch.
- **Still-learning threshold (one rule, used by plan AND live):** an item is "still learning" if it has **no forecast rows** OR its aggregated `sample_size < minRows` (reuse the engine's existing `minRows`, 20 prod / ~5 staging). Views enumerate active mapped items via LEFT JOIN to forecasts so thin items are listed (not dropped) and flagged.
- **Group-C quantity:** target = forecast summed over the item's **shelf-life window** (1–3 days) **minus still-valid carryover** (on-hand from prior days' active group-C batches).
- **Unified waste report:** a report endpoint that **unions** dish waste (`prep_batches.discarded_qty`, groups A & C) with ingredient waste (`waste_events`) over a date range, valued via cost (`standard_price` / dish cost) → weekly *made vs sold vs binned* per dish + *thrown away by reason* per ingredient + a **€ total** (`"cost not set"` where cost is missing). Company scope derived via `location_id`→`stock.location.company_id` (Inventory stores no `company_id` on rows). A sibling of the existing Inventory Consumption report, not an extension of it.

### 6.4 Fixes discovered during mapping (each mapped to a stage)
- **Company id — hard Stage-1 precondition (not a build-time guess).** `companies.ts` hardcodes WAJ = 5 / default = Ssam 3, and the portal `CLAUDE.md` also says Company 5 = What A Jerk (staging); a separate project note suggested a co5→co6 merge. **This contradiction must be resolved by introspecting the live Odoo before any wiring**, the verified id recorded, and `companies.ts` made **environment-aware** (staging vs prod backends differ) rather than hardcoded. *(Stage 1)*
- **Cron not scheduled + defaults to Ssam.** `/api/cron/prep-forecast` exists but nothing in-repo triggers it. Wire a real nightly trigger and include WAJ. *(Stage 1)*
- **Holiday bug.** `holidayMult` forces the forecast to 0 on public holidays (treats holiday = closed) — wrong for a shop open on holidays. Fix for WAJ. This is the **only** genuine "till-purity" fix needed: the seasonal multiplier already returns 1 when there's no last-year data (WAJ is new) and weather is already inert, so **no seasonal neutralisation is required** for this delivery. *(Stage 1)*
- **Auth tightening.** `cook-plan` / `ack` are login-only and trust the client `companyId` (no membership check). Tighten **before** the new batch/waste writes. *(Stage 2)*

## 7. The five delivery stages (each independently shippable + verified on staging)

1. **Aim it at What A Jerk + plan.** *Preconditions:* resolve & verify the WAJ company id against live Odoo (make `companies.ts` env-aware); **verify POS→backend sync latency on an OPEN session** (does a sale appear in `pos.order.line` within the poll interval, or only at session close?). *Then:* schedule the cron incl. WAJ; fix the holiday bug; add the `group` field (+ default) and `sample_size` on `prep_item_forecasts` and widen `batch_size` to REAL; set up WAJ items (groups, hold-times, units, batch sizes) + mappings; move the start-of-shift plan onto the Prep screen with the "still learning" state; group-C checklist skeleton.
2. **Batch button + expiry timers.** Tighten cook-plan/ack auth; `prep_batches` + log/close endpoints; live batch list with countdowns (amber/red); "binned"/"all sold". Immediate waste reduction even before nudges.
3. **Live "cook another now" nudges.** `/live` endpoint with the pinned on-hand FIFO math, 60-min demand window, nudge verdict, polling UI, and the still-learning fallback (or forecast-based fallback if the till doesn't sync live).
4. **Dish waste log + cold multi-day list.** Dish waste capture + weekly report (groups A & C); group-C carryover-netting + use-by list finished.
5. **Ingredient waste tracker + unified report.** New `waste_events` + a "Log waste" screen cloned from Inventory's `QuickCount` (product search/scan, `CrateCountSheet` weight/pack qty, the 5 reason chips, photo, offline queue, shared-tablet attribution); a shared **Waste** tile from Inventory + Prep Planner; the unified €-valued report (dishes + ingredients). Optional best-effort Odoo write-off (gated on `is_storable`) can follow behind a flag.

## 8. Edge cases & error handling
- **Thin/no data:** show "still learning", never a confident wrong number or a crash.
- **Till sync latency:** if sales only appear at session close, the live nudge falls back to forecast + elapsed time and relies on cook taps; documented, not silent.
- **Shared tablet / offline:** batch logging tolerates flaky networks (queue + retry, per existing inventory offline behaviour); attribution falls back to the tablet account with no PIN.
- **Batch spans day boundary / close:** expiry is absolute time, independent of "shift date"; live view shows all still-active batches.
- **Negative on-hand:** clamp at 0, prompt "looks sold out — log a batch?".
- **Item with no till mapping:** can still be batch-logged (timers work) but has no forecast/nudge; flagged in setup and shown as still-learning.
- **Null/legacy `group`:** defaults to `hot_hold`; batch/nudge logic guards on `group='hot_hold'` explicitly so a mis-set item can't silently misbehave for cook-to-order.
- **Register scoping:** engine scopes by `company_id`, not `pos.config` — if WAJ's company also holds other registers, sales could be over-counted; verify WAJ company isolation (or add a config-level filter).

## 9. Testing / verification
- **Real-browser Playwright on staging** for each stage before "done" (project rule), using the shared WAJ Kitchen Tablet account: log a batch → countdown starts; **sell on the till against an OPEN session → on-hand drops** (this is also the sync-latency check); force low stock → nudge appears; let a batch expire → red + waste record; thin item → "still learning".
- Unit-test the pure bits: on-hand FIFO math (incl. the 2-batch worked example), expiry computation, nudge verdict, still-learning threshold, days-vs-minutes rendering, group-C carryover netting.
- Production held until owner signs off on staging.

## 10. Open questions (confirm during build; none block writing the plan)
- **WAJ company id** — resolved as a Stage-1 precondition (§6.4), noted here for visibility.
- **Standard batch sizes** per item (one tray of rice = ? portions; one batch of wings = ? pieces).
- **Per-sale factors:** grams-per-sale for weight items; pieces-per-sale for combos including chicken/rice.
- **Amber threshold** (minutes before expiry to warn) — default 25 min, per item.
- **Exact till-product → item mappings** for WAJ (needs the WAJ menu).

## 11. Non-goals (YAGNI)
- No changes to the KDS.
- No weather-driven forecasting (kept inert); no seasonal-multiplier work (already neutral for WAJ).
- No automatic recipe/BOM-derived mapping (mappings are hand-set for WAJ; revisit only if needed).
- No rollout beyond What A Jerk in this work (design stays company-scoped so Ssam etc. can follow later).
- No perfect stock accuracy — "ready now" is a till-based estimate the cook can correct.
- No automatic/derived waste estimation (opening + deliveries − closing − sales) — too noisy without enforced daily counts; ingredient waste is logged, not inferred. (Possible manager-only cross-check later, never the capture method.)
- No mandatory Odoo scrap posting — the portal is the record of truth for waste; any Odoo write-off is optional, best-effort, and gated on `is_storable`.
