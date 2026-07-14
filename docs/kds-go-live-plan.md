# KDS Go-Live Plan — What a Jerk

_Written 2026-07-01. Goal: run the custom Kitchen Display System (KDS) for real
service at What a Jerk, on the production portal (`staff.krawings.de`)._

The KDS itself is finished and polished on **staging** (`portal.krawings.de/kds`).
This plan covers what it takes to make it real.

---

## 0. The core decision (release strategy)

The production portal is **~3 weeks / 49 commits behind** `main`, and the portal
deploys **all-or-nothing** (one deploy ships the whole branch). Of those 49
commits, **27 are the KDS** and **~22 are other, partly-unfinished features**.

**Two ways to release:**

| | **A — Isolated KDS release (recommended)** | **B — Full release** |
|---|---|---|
| What goes live | Only the KDS code | Everything on `main` (KDS + the other 22) |
| Risk | Low — the risky/unfinished features stay off prod | Higher — see risk list below |
| Trade-off | Prod temporarily differs from `main` until a later full release catches up (bends the single-branch rule) | Standard single-branch deploy, but needs all 22 validated first |

### The other 22 changes (what a **full** release would also push live)
Several **change existing behaviour** or have **outward-facing side effects** —
validate each with its owner before a full release:
- **Staff portal invites / staff-access** — includes **auto-invite on hire**, which can automatically message new employees. (Outward-facing.)
- **Recruitment bridge** — needs a shared token configured; otherwise broken.
- **POS drinks** — moves the Drinks Scanner into Inventory; changes POS category behaviour.
- **Cash-closing redesign** — changes the daily cash-close flow (operationally + fiscally sensitive).
- **Shift self-service**, WAJ tweaks, labels, docs — lower risk but unvalidated on prod.

---

## 1. ⚠️ Verify the KDS will actually see the tills' orders (do this FIRST)

The production portal reads Odoo at `http://127.0.0.1:15069` (db `krawings`) on
the portal server (`178.104.176.20`). **The KDS only works if the What a Jerk
tills write their orders to that same Odoo.** There is also a separate POS
production server (`128.140.12.188`).

- **Confirm:** do the live What a Jerk POS registers post orders to the Odoo the
  portal talks to (`178.104.176.20:15069`), or to `128.140.12.188`?
- If they're different databases, the KDS would show **nothing** until we point
  the portal at the Odoo the tills actually use. **This is the #1 thing to
  settle before anything else.**

---

## 2. Go-live checklist

### Step 1 — Get the KDS code onto production
- **Strategy A:** copy only `src/app/kds`, `src/components/kds`, `src/lib/kds`, `src/app/api/kds` from `main` onto prod, `npm ci && npm run build`, restart `krawings-portal`. (No new npm dependencies were added by the KDS, so this is clean.)
- **Strategy B:** `git pull` to `main`, `npm ci && npm run build`, restart.
- **Verify:** `https://staff.krawings.de/kds` loads (HTTP 200).

### Step 2 — Task-reminder module on the live Odoo
- The reminders read the `krawings_task_manager` module. Confirm it is
  **installed on the production Odoo**; if not, install it (`-u krawings_task_manager`).

### Step 3 — Point the KDS at the LIVE What a Jerk register
- On the production Odoo, find the What a Jerk `pos.config` (What a Jerk is
  **company 5** on production — a different ID than staging's 14).
- Set the KDS's **POS Config ID** to that register (via the in-screen Settings,
  now a dropdown, or the portal's `data/portal.db`).
- **Verify:** ring up a real What a Jerk order → it appears on the KDS.

### Step 4 — Point the tablet app at the live address
- The Android app (`de.krawings.kds`) currently loads `portal.krawings.de/kds`
  (**staging**). To go live: change its server URL to
  `https://staff.krawings.de/kds`, **rebuild the APK**, reinstall on the kitchen tablet.
- **Interim option:** just open `staff.krawings.de/kds` in the tablet browser
  (add to home screen) until the new APK is built.

### Step 5 — Set up your real daily tasks
- In the task manager (manager view), create the recurring daily tasks for What
  a Jerk and set a **due time** on the ones the kitchen screen should remind
  about (bins, restroom checks, temp checks, etc.).
- Remove the two test tasks ("garbage bins", "napkin dispensers").

### Step 6 — Clean up test data
- Clear the staging demo orders (#711–716) and test tasks. Ensure no test data
  exists on production. (Note: 4 old staging orders #701–704 can't be deleted —
  they have linked survey responses — but they're harmless.)

### Step 7 — End-to-end check on production
- Real order rung up → shows on the KDS within ~5s.
- A due task → reminder pops with sound; Snooze works.
- Timers, batch flow (START COOKING → COOKING NOW), ready/done, offline banner all work.

---

## 3. Rollback
The KDS is a self-contained page. If anything is wrong, revert the prod portal
to its previous commit and rebuild. **Strategy A** keeps the rest of production
untouched, so rollback is clean and contained.

---

## 4. What I need from you
1. **Release strategy:** A (isolated KDS, recommended) or B (full release).
2. **The #1 verification (Section 1):** which Odoo the What a Jerk tills use.
3. **OK to install** the task module on the production Odoo (if not already).
4. For Strategy B: the owners of the other 22 features, to validate them first.
5. Your **real daily task list** (with due times) for What a Jerk.
