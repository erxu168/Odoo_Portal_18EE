# What a Jerk — Sales Dashboard (design spec)

**Date:** 2026-07-14
**Repo:** `erxu168/Odoo_Portal_18EE` (Krawings Portal, Next.js 14 App Router)
**Branch:** `main` (single-branch rule)
**Status:** Approved design — ready for implementation plan

---

## 1. Goal (plain language)

A mobile-first dashboard in the staff Portal that shows, **for What a Jerk only**,
what is being sold and how much money is coming in — like a simple Power BI view.
Owner + managers only. Auto-refreshes every few minutes.

## 2. What it shows (the six things the user asked for)

A single page at `/waj/sales` with a **date-range control** (Today · This Week ·
This Month · Custom) and **tabs**:

1. **Overview** — big-number KPIs for the selected period: **Total sales**,
   **# orders**, **average spend/order**, each with an up/down delta vs the
   previous comparable period. Plus a **sales trend chart** (by day; by hour when
   the range is "Today").
2. **Best-sellers** — ranked products with **qty sold** and **revenue each**,
   plus a share bar. Sortable by quantity or revenue.
3. **Busy times** — **by hour of day** and **by day of week**, shown as bars /
   heat strip, using **averages** (revenue and order count per hour / per DOW)
   so a single big day does not distort the picture.
4. **Orders** — order count, average spend, **cash vs card**, and
   **dine-in vs take-away** split.
5. **Kitchen speed** — **average prep time** (order placed → marked *done* on the
   KDS), fastest/slowest, and prep-time by day of week. See §6 for the data caveat.

## 3. Non-goals (explicitly out of v1)

Profit & loss / margins, cross-restaurant comparison, cashier/staff performance,
fraud/Benford checks, CSV export. All can be added later (the half-built Report
Builder already contains most of this if we choose to finish it).

## 4. Where the data comes from

- **Sales, products, orders, busy-times, payments** → Odoo POS models via the
  existing server-side query layer (`src/lib/report-queries.ts`):
  `pos.order`, `pos.order.line`, `pos.payment`, filtered by `company_id`.
  This history is permanent in Odoo, so trends work from day one.
- **Kitchen prep time** → the custom KDS's own timestamps in the portal SQLite
  table `kds_completed_orders` (`ready_at`, `done_at`), keyed by `order_id`
  (= `pos.order` id). Prep time = `done_at` − order start time.

## 5. What a Jerk identity resolution (critical — verify first)

`company_id` for What a Jerk **differs by environment** (memory: staging co6,
production co5; the portal `CLAUDE.md` still says co5 from before the June
migration). Therefore **do not hardcode**. Resolve at runtime, mirroring
`scripts/odoo/setup_waj_company.py` and `prep-planner-engine.ts`:

- `res.company.search_read([['name','ilike','What a Jerk']], ['id','name'])`
  → cache the id (module-level, refreshed hourly).
- Derive the POS `config_id`(s) from `pos.config` where `company_id` = WAJ
  (needed only for sessions/tables, which v1 mostly avoids).

**Phase 0 introspection (must run before coding the frontend, per CLAUDE.md #10):**
1. Confirm WAJ `company_id` on the Odoo instance the portal talks to.
2. Confirm the **dine-in vs take-away** field on `pos.order`. The WAJ take-away
   feature (module `krawings_pos_customization`) added a DINE IN / TAKE AWAY
   switch — introspect `pos.order` fields for the flag name (candidate:
   `takeaway` boolean, or a custom field). If no reliable field exists, mark
   the dine-in/take-away split as "not available" rather than guessing.
3. Confirm `kds_completed_orders.order_id` equals the `pos.order` id used by the
   sales queries (so prep time can be joined).

## 6. Prep-time history caveat + fix

`kds-db.ts` prunes `kds_completed_orders` older than **3 days**. So on launch,
"Kitchen speed" only has a few days of history.

**Fix (recommended, approved):** add a **permanent archive** that accumulates
going forward. Add a new SQLite table, e.g.:

```
CREATE TABLE IF NOT EXISTS kds_prep_history (
  order_id   INTEGER PRIMARY KEY,
  company_id INTEGER,
  started_at INTEGER,   -- order placed (from pos.order, ms epoch)
  ready_at   INTEGER,
  done_at    INTEGER,
  prep_ms    INTEGER,   -- done_at - started_at
  day        TEXT       -- Berlin YYYY-MM-DD for fast day-of-week grouping
);
```

Write a row into `kds_prep_history` **when an order is marked done** (extend the
existing `setOrderStage(orderId,'done')` path in `kds-db.ts`), and **never prune
it**. The dashboard reads prep-time trends from this archive; the live 3-day
table is untouched. Sales/best-sellers/busy-times are unaffected (Odoo keeps
everything). Day-of-week prep-time trends become meaningful after ~1–2 weeks of
accumulation.

## 7. Access & privacy

Every API route calls `requireRole('manager')` (same pattern as the existing
`/api/reports/*` routes). The home-screen tile uses `minRole: 'manager'` so
regular staff never see it. No revenue is exposed to staff.

## 8. Refresh & caching

- Client: load on open, a manual **Refresh** button, and a **~3-minute**
  `setInterval` re-fetch while the page is visible (pause when tab hidden).
- Server: reuse `report-cache.ts` (in-memory TTL). Today-range TTL ~2–5 min so
  the auto-refresh actually shows movement; week/month TTL longer (~15 min).

## 9. Charts

No charting dependency is installed and none will be added. Use small,
self-contained **inline SVG / CSS bar** components (trend line/bars, hourly
strip, DOW bars, share bars), consistent with the existing report screens and
`DESIGN_GUIDE.md` (typography via `var(--fs-*)`, brand orange `#F5800A`, not
blue). Reuse existing report sub-components in `src/components/reports/` where
they fit.

## 10. File plan (focused module, reuses the data layer)

**New:**
- `src/app/waj/sales/page.tsx` — thin page → renders the app component.
- `src/components/waj-sales/SalesApp.tsx` — tabbed container + date control +
  auto-refresh.
- `src/components/waj-sales/*` — tab views (Overview, BestSellers, BusyTimes,
  Orders, KitchenSpeed) + small SVG chart components.
- `src/app/api/waj-sales/summary/route.ts` — Overview KPIs + trend.
- `src/app/api/waj-sales/products/route.ts` — best-sellers.
- `src/app/api/waj-sales/busy/route.ts` — hourly + DOW.
- `src/app/api/waj-sales/orders/route.ts` — payment + dine-in/takeaway split.
- `src/app/api/waj-sales/kitchen/route.ts` — prep-time from `kds_prep_history`.
- `src/lib/waj-sales.ts` — WAJ company resolver + range→date helpers +
  compute functions (reusing `report-queries.ts` fetchers; DOW/hour grouping
  adapted from `report-compute.ts`).

**Modified:**
- `src/lib/kds-db.ts` — add `kds_prep_history` table + write-on-done + a read
  query; do NOT prune it.
- `src/components/dashboard/DashboardHome.tsx` — add a `Sales` tile
  (`minRole: 'manager'`, `href: '/waj/sales'`).

**Reused as-is:** `report-queries.ts` (fetchers, date/timezone helpers),
`report-cache.ts`, `auth.ts` (`requireRole`), `odoo.ts` (`getOdoo`).

## 11. Risks / edge cases

- **Wrong company id** → empty dashboard. Mitigated by runtime name resolution +
  Phase 0 verification + a visible "No data / check company" empty state.
- **Dine-in/take-away field unknown** → show the split only if a reliable field
  exists; otherwise hide that card (don't fabricate).
- **Timezone**: Odoo stores UTC; Berlin is +1/+2. Reuse the existing
  `berlinToUtc` / `utcToBerlin*` helpers — do not roll new date math.
- **Prep-time join gaps**: orders with no KDS `done` event are excluded from
  prep-time averages (and counted as "not recorded"), so the average isn't
  skewed by unfinished/void orders.
- **Refunds / negative orders**: exclude from best-sellers and averages
  (existing queries filter `state in paid/done/invoiced`).
- **Auto-refresh cost**: only refresh the visible tab's data; cache absorbs
  repeat calls.

## 12. Verification (before "done")

- `npm run build` clean (TS strict; watch the build pitfalls in `CLAUDE.md`).
- **Playwright against staging** (portal.krawings.de) with a **manager** test
  user (Marco Bauer) — confirm each tab renders WAJ numbers; confirm a **staff**
  user cannot see the tile or hit the API (403). This is mandatory per project
  rules before calling it done.
- Spot-check one day's total against Odoo POS reporting for the same day/company.

## 13. Rollout

Staging first (this checkout deploys to staging on `main`). Production held
until the user explicitly approves (consistent with current "stay in staging"
posture). Commit + push after the staging deploy.
