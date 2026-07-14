# Smart Shift Planning — Design Spec

**Date:** 2026-07-08
**Module:** Portal `erxu168/Odoo_Portal_18EE` → `src/components/shifts`, `src/app/api/shifts`, `src/lib/shifts-*`
**Backend:** Odoo 18 EE via JSON-RPC (`planning.slot`) — **no Odoo model changes required**
**For:** What a Jerk (company id 6). Staging first, Playwright-tested, then prod.

> **How to read this doc:** **Part A** is the plain-English plan — that's the part to review. **Parts B–F** are the developer detail (me); you can skim or skip them.

---

## Decisions locked (from the owner, 2026-07-08)

| Choice | Decision |
|---|---|
| What to build | **Everything together** (scheduling engine + demand forecast), delivered in a safe order |
| Weekend fairness | **Equal share for everyone** (full-timers and part-timers each owe the same small number) |
| Over weekly hours | **Warn but allow** (clear message + flag the manager; never block) |
| The sales forecast | **Suggestions only** — shows a recommended number next to each shift; the manager always sets the final count |

---

# PART A — The plan in plain English

## A1. What a normal week looks like once this is built

1. **Build the week once.** The manager builds a reusable **pattern** — "Normal Week" — that remembers each shift's time, role, station, and how many people it needs. No more retyping the roster every week.
2. **Publish it with a deadline.** One tap turns the pattern into next week's real, empty shifts and sets a **"choose by" deadline** (e.g. Thursday 8pm). Until published, staff see nothing. After, the shifts appear on everyone's phone with a countdown.
3. **Weekend comes first.** Before a staff member can grab an easy weekday shift, they must claim their **fair share of Fri/Sat/Sun shifts**. The app works out that share automatically — total weekend shifts split evenly across the people who can actually work them — and shows a plain banner: *"Claim 2 more weekend shifts to unlock weekday shifts."* Do your share, and the whole week opens up.
4. **Free pick, with an honest nudge on hours.** Once the weekend duty is met, staff pick the rest. If a shift would push someone past their weekly hours, they see a friendly amber note — *"This puts you at 22.5 of 20 hours this week"* — and the manager is flagged. It never blocks them.
5. **After the deadline, the manager fills the gaps.** Selection locks itself at the deadline (no button to remember). The manager sees exactly what's uncovered and assigns those by hand, as today. The deadline can be extended or reopened without wiping anyone's picks.

## A2. The "smart" layer — staffing from sales

On top of the loop above, the app reads your till history and, for each shift, shows a **recommended number of people** — more for the Friday dinner rush, fewer for the dead mid-afternoon. This is how the schedule drives down labour cost: you stop paying for bodies you don't need at 3pm and make sure you're covered at 8pm. The manager always sets the final number; the forecast only advises.

It reuses the **forecasting engine you already have** (the 4am "prep planner" that predicts dish quantities from sales) — so it's reading data the system already collects, not new plumbing.

## A3. The honest caveat — the forecast starts modest

A forecast is only as good as the history behind it. Restaurants need **8–12 weeks of steady trade** before staffing predictions are trustworthy; a full year to be confident. So the forecast ships in a clearly-labelled **"still learning"** mode:

- **Not enough history for a shift** → it shows a safe **minimum staffing floor** you set once, labelled "minimum," not a confident number.
- **Some history** → it shows a number marked **"advisory."**
- **Enough history** → the number is marked **"confident."**

Each day of the week graduates on its own (busy Fridays get smart before quiet Sundays). This is deliberate: an honest "we're still learning your Tuesdays" beats a confident-looking wrong number.

**Your weekend-fairness rule does not depend on the forecast** — it splits whatever weekend shifts you actually create — so that part works fully from day one, regardless of sales data.

## A4. What you'll get, in what order

Even though we're building it all, it lands in safe, testable pieces (each usable on its own):

1. **Patterns + publish-with-deadline + auto-lock + gap-fill** — and this recreates your lost daily-opening shift.
2. **Fair-weekend engine** (equal share) + **hour warnings** (warn only).
3. **Manager overviews** — "hours this week vs contract" strip; weekend-fairness scorecard.
4. **Demand forecast as suggestions** — a "when we're busy" picture, then recommended headcounts per shift, with a labour-cost-% sanity check.

---

# PART B — The four pillars in detail

## B1. Shift patterns + publish + selection deadline

**Idea:** a reusable weekly stencil the manager publishes into real shifts with a staff-selection deadline that locks itself.

- **Data (portal SQLite, no Odoo changes):**
  - `shift_pattern` (id, company_id, name, active) + `shift_pattern_line` (pattern_id, weekday 1–7, start_hhmm, end_hhmm, role_id, department_id, headcount, min_skill).
  - `shift_publish_run` (id, company_id, pattern_id, target_week, select_deadline, state, created_at).
  - `shift_publish_slot` (run_id, slot_id) — maps generated `planning.slot` ids to the run, for lock/cleanup (more reliable than the wall-clock matching `delete-series` uses).
- **State machine:** `draft template → open-for-selection → locked → finalized`. **Lock is lazy** — the first read past `select_deadline` flips it, reusing the existing `lazyExpireIfDue` pattern (no cron).
- **Generation:** publish calls the **same `createSlot` helper** as the manual "New shift" form, so over-cap recompute, department + min-skill overrides all behave identically. Each shift is a plain `planning.slot` (`state='published'`, `resource_id=false`).
- **Endpoints (new):** `POST /api/shifts/patterns`, `POST /api/shifts/patterns/[id]/publish`, `GET /api/shifts/runs`, `GET /api/shifts/runs/[id]/gaps`, `POST /api/shifts/runs/[id]/transition` (extend deadline / reopen / finalize).
- **Reversibility:** editing a pattern only affects the *next* publish. Deadline can be extended; a locked run can be reopened — existing picks are kept. Transitions only open/close/re-time selection; they never delete shifts or picks.
- **Recurring "daily opening shift":** a one-line-per-day pattern republished weekly (one tap), with an optional tiny weekly auto-publish job later.

## B2. Fair-weekend engine (equal share)

**Weekend = Fri + Sat + Sun**, decided by the shift's **start time in Berlin local time**. Counts **shifts (slots), not hours**.

- **Formula (equal model):**
  - `W_total` = weekend slots this period that at least one active staff member is role+skill eligible for.
  - `N` = eligible **and available** (not on full-period approved leave) active staff (`E(s) ≠ ∅`).
  - `quota(s) = min( ceil(W_total / |N|), |E(s)| )`.
  - `remaining(s) = max(0, quota(s) − alreadyClaimedWeekend(s))`.
  - **Gate opens** for `s` when `remaining(s) == 0` **or** all weekend slots are taken (`W_unassigned == 0`) **or** `s` isn't in `N`.
  - Worked example: 10 weekend slots ÷ 5 eligible servers = **2 each** (matches the owner's example).
- **Enforcement (server-side, authoritative):**
  - `GET /api/shifts/open` adds `weekendGate {required, done, remaining, isWeekendSlot, weekendSlotsAvailable}`; weekday slots get `eligible=false, reason='weekend_first'` while `remaining>0` (reuses the existing grey-out path).
  - `POST /api/shifts/claim` returns **409 `weekend_first`** on a weekday claim while `remaining>0` — **not** staff-overridable (unlike over-cap). Manager "assign a person" is exempt.
- **UX (reuses existing patterns):** red banner + progress pill ("Weekend: 1/2"), weekday cards disabled with a "Weekend first" badge, weekend cards highlighted and sorted to top; banner turns green the moment the quota is met.
- **Key invariants (no rug-pull):** target uses **fixed total demand** so it doesn't drift during the claim rush; a **grandfather flag** (`gate_unlocked_at`) means meeting the bar once can never be undone by someone else's action; only dropping your *own* weekend shift re-closes your gate; already-claimed weekday shifts are **never auto-removed**.
- **Config (extend `shift_settings`):** `weekend_quota_enabled` (default on), `quota_mode='equal'`, `period_weeks=1`, `weekend_days='FRI,SAT,SUN'`. (`quota_mode='proportional'` + `fulltime_hours` exist as a future flag but are **not** the default.)
- **History (fairness):** `shift_weekend_history` (company_id, employee_id, period_key, quota_required, weekend_worked, gate_unlocked_at, in_cohort) — drives audit, the rolling 8-week "who's carried the weekends" scorecard, and the grandfather guard.

## B3. Hour-limit warnings (warn, never block)

- **The limit for each person:** `cap` (manager-set `x_max_weekly_hours`) if present, else contracted weekly hours (`hr.contract.kw_agreed_weekly_hours`, already fetched into `ShiftEmployee.weeklyTarget`), else none. Same precedence already used in `me/route.ts`.
- **The math (already exists):** `projected = employeeWeekHours(empId, weekKey) + shift.hours`; `overage = projected − limit`. Week boundary via `berlinISOWeekKey()`; hours are always `end − start` (never `allocated_hours`). Only change: add the `?? weeklyTarget` fallback to the existing claim projection.
- **Warn UX:** reuse the existing amber `WarnBox` in the claim sheet — *"This puts you at 22.5 of 20 hours this week — 2.5h over. Your manager will see it."* The green "Take this shift" becomes amber "Take it anyway" (existing `needsConfirm`/`confirm=true` flow). A quieter grey info line ("2h left") shows only when there are **no** warnings.
- **Minijob (secondary):** if `x_employment_type=='minijob'`, project month earnings (`monthHours × hourly_wage`) vs €603 and, if over, append a one-line heads-up inside the same box (never its own box).
- **Manager visibility:** `GET /api/shifts/manage` already returns per-week hours; add `weeklyTarget` to `employees[]` and render an "Hours this week vs contract" strip (over = amber, under = grey, on-target = green) plus a richer pre-publish line ("Over their hours: Marco +2.5h. You can still publish.").
- **No nagging:** priority order **ArbZG legal (10h/day, 11h rest) → weekend gate (a pre-step dialog, before the sheet) → weekly hours → minijob sub-line**. Each concern shown once; worst case in the sheet is two boxes.

## B4. Demand forecast (suggestions only) — reusing the prep planner

**Reuse, don't rebuild.** The portal already runs a nightly forecast:

- `prep_demand_history` (company, product, sale_date, sale_hour, qty, **order_count**, **dow**) — backfilled from `pos.order`/`pos.order.line` at 04:00 Berlin by `GET /api/cron/prep-forecast`.
- `prep_forecasts`, `prep_forecast_runs` — per-run output + audit.

The staffing forecast adds a **step 4** to that same cron and one derived table:

- **Method (honest & simple):** aggregate `prep_demand_history.order_count` into **weekday × 2-hour buckets** (2h separates the ~11–14 lunch hump from the ~22–00 dinner hump seen in the data while keeping enough orders per bucket). **Trimmed mean** (drop one high/low once ≥5 samples) kills the one-viral-Friday problem. **No ML** — with ~8–12 samples per weekday it would overfit. A `method` field carries a graduation path (`manual_floor → weekday_avg → weekday_avg_trimmed → rolling_2wk_dow`) so schema/endpoints don't change as history matures.
- **Sales → staff:** `staff = max( ceil(orders × mix / orders_per_staff_hour[role]), floor[role] )`. Two roles: **FRONT** (default ~12 orders/hr) and **KITCHEN** (default ~9). Manager tunes two dials per role (throughput + minimum floor) on a settings screen — never edits a formula. Product mix nudges KITCHEN only (prep-heavy items ↑) via a clamped weight, reusing the prep planner's per-product demand.
- **Confidence tiers:** `none` (<4 samples → shows the floor, labelled "minimum"), `low` ("advisory"), `good` (8+ → "confident"), plus a `stale` flag if the cron hasn't run in >36h. Today the venue is `low`, so screens lead with a "still learning your patterns" banner.
- **Labour-cost guardrail (Fork E → soft):** show SPLH / labour-cost-% next to a suggestion as a **non-blocking** note if a shift's recommendation would blow a target the manager sets (e.g. keep labour under ~30%).
- **Suggestions-only bridge:** new table `shift_recommendations` (company_id, weekday, bucket, role, recommended_n, confidence, forecast_run_id). The template/manage editor shows a **"Rec. N"** badge + a **Gap** indicator next to each slot's count. **No auto-fill / no apply endpoint** — the manager always sets the count. Read via `GET /api/shifts/recommendations`.
- **Timezone:** UTC `date_order` → Berlin via `Intl` (DST-correct); `bucket = floor(localHour/2)`; 05:00 service-day cutoff (same as KDS) so a 22:00→02:00 rush stays one night.

---

# PART C — Delivery order (safe, testable increments)

1. **Patterns + publish + deadline + auto-lock + gap-fill** (subsumes rebuilding the daily-opening shift). Ship + Playwright-verify.
2. **Fair-weekend engine (equal)** + **hour warnings (warn)**. Ship + verify.
3. **Manager overviews:** hours-vs-contract strip, pre-publish review, weekend fairness scorecard. Ship + verify.
4. **Demand forecast (suggestions):** cron step 4 + `shift_recommendations` + "Rec. N/Gap" badges + confidence labels + busy-ness view + labour-% note. Ship + verify.

Each step is a small commit on `main` (portal single-branch rule), Playwright-tested on staging before prod.

---

# PART D — Technical appendix (reuse map & scope)

- **Odoo:** no model/field changes. Shifts stay `planning.slot`; `department_id` + min-skill remain portal-side (`shift_slot_department`, `shift_slot_min_skill`).
- **New SQLite tables:** `shift_pattern`, `shift_pattern_line`, `shift_publish_run`, `shift_publish_slot`, `shift_weekend_history`, `shift_recommendations`; plus new columns on `shift_settings` (weekend config, `staff_forecast` dials/floors).
- **New endpoints:** patterns (3), runs (3), `GET /api/shifts/recommendations`; **modified:** `open`, `claim`, `manage`, cron `prep-forecast` (+step 4).
- **Reused unchanged:** `WarnBox`, `berlinISOWeekKey()`, `createSlot`, over-cap notify, `confirm=true` resubmit, `arbzgConflicts()`, `lazyExpireIfDue`, prep-planner demand backfill + cron + audit-run pattern, report-cache TTL pattern.
- **Files (portal `src/`):** `lib/shifts-db.ts` (migrations), `lib/shifts-odoo.ts`, `app/api/shifts/{open,claim,manage}/route.ts`, new `app/api/shifts/{patterns,runs,recommendations}/**`, `app/api/cron/prep-forecast/route.ts` (+staffing step), `components/shifts/{OpenShiftsList,ManageShifts,RequestsInbox,ShiftSettings}.tsx` + new pattern/publish + forecast UI.
- **Testing:** Playwright on staging (`portal.krawings.de`, test users Marco=manager, Hana/Yuki=staff, company 6) before each prod push. **Snapshot real `planning.slot` rows before any test-data cleanup** (lesson from the 2026-07-08 data loss).

---

# PART E — Risks & edge cases (decide up front)

1. **Fewer weekend slots than the group owes** → once every weekend slot is taken, the gate opens for all; nobody is trapped.
2. **Quota rises mid-period** (someone leaves/goes on leave) → grandfather rule: anyone already unlocked stays unlocked; only encouraged (not forced) to pick up slack.
3. **Never yank the rug** → recompute only blocks *new* weekday picks, never removes existing ones.
4. **Time-off vs deadline** → leave approved after publish doesn't retroactively erase a met quota; it just drops the person from future recomputes.
5. **Deadline is soft** → extend / reopen without destroying picks.
6. **Forecast false-certainty** (thin data) → confidence tiers + floors + "still learning" banner; suggestions-only means a wrong number can't auto-schedule anyone.
7. **Viral-Friday / menu-change drift** → trimmed mean + a manager "fresh start" date that caps look-back.
8. **Stale forecast** → `stale` flag when cron hasn't run in >36h.

---

# PART F — Out of scope (deliberately)

Competitive seniority bidding; algorithmic auto-assignment of gaps; auto-publishing the forecast into a live schedule; proportional weekend shares (kept as a future flag); multi-week averaged quota (future flag); premium/incentive pay for hard-to-fill weekend shifts (touches payroll). Manual gap-fill + the fairness scorecard cover the same ground for a single restaurant.
