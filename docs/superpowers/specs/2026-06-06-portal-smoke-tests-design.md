# Portal Smoke Tests — Design

**Date:** 2026-06-06
**Project:** Krawings Portal (`erxu168/Odoo_Portal_18EE`, Next.js)
**Author:** Ethan + Claude (brainstorming session)

---

## In plain English

A robot that logs into the portal and visits every main page, run automatically
on GitHub every time you push a change. It gives you a green ✅ or red ❌ so you
know fast whether a change broke a page. It only *looks* at pages — it never
clicks Save, Delete, or Submit — so it is safe to point at the live site too.

This is a **smoke test**: broad and shallow. It catches "the whole page is
broken / blank / erroring," not subtle logic bugs. We can grow it later.

---

## Goal

Catch deploy-breaking regressions in the portal early, with near-zero effort to
run, by automatically verifying that every main page still loads and renders
without error.

## Success criteria

- One command runs the full check locally (`npm run smoke:staging` /
  `npm run smoke:live`).
- A GitHub Action runs the check automatically on every push to `main`, and can
  also be run on demand from a button (choosing staging or live).
- When a page fails, a screenshot + trace is saved so the cause is visible.
- Running against **live never creates, edits, or deletes any data**.

---

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What kind of test? | **Smoke test** after deploys |
| Which environment? | **Both staging and live**, switchable |
| Login? | **Dedicated robot account** (one test user, both environments) |
| Coverage (first version)? | **Portal only: log in + every main page loads** |
| How to run? | **Automatically on every push** (+ manual run button) |
| Branch? | Commit **straight onto `main`** (portal's normal workflow) |

Explicitly **out of scope for v1** (candidates for later): Odoo smoke tests,
deep checks of reports/dashboards, mobile-viewport checks, and building a fresh
copy of the app inside CI to test un-deployed code.

---

## Scope

### In scope
- Log in once with the robot account, reuse that session for all page checks.
- Visit each top-level portal page and assert it loaded cleanly.
- Switch target between **staging** (`portal.krawings.de`) and **live**
  (`staff.krawings.de`).
- GitHub Actions: run on push to `main` + manual `workflow_dispatch`.
- Save screenshots/traces on failure.

### Out of scope (v1)
- Odoo screens, reports deep-dives, mobile viewport, CI-built app, write actions.

---

## Pages checked (the smoke route list)

These are the top-level pages that require login (kept in one editable list so
adding/removing a page is a one-line change):

```
/            (home / dashboard)
/hr
/tasks
/manufacturing
/recipes
/inventory
/purchase
/reports
/rentals
/prep-planner
/kds
/admin
/termination
```

Plus a no-login sanity check that `/login` itself renders.

> Note: deeper sub-pages (e.g. `/reports/pnl`, `/rentals/properties`) are
> intentionally left out of v1 to keep the test fast and stable. Easy to add to
> the list later.

---

## How "page loaded cleanly" is judged

For each page, after navigation the test asserts **all** of:

1. The HTTP response was OK (status < 400) — not a server error.
2. We did **not** get bounced back to `/login` (proves the session works).
3. The page shows real content (visible text in the body, not a blank screen).
4. No app crash overlay (Next.js error overlay) and no uncaught page errors.

If any fail, Playwright captures a screenshot + trace for that page.

---

## How login works (grounding)

- Login page: `/login` — an **email** field and a **password** field, then a
  submit button. It POSTs to `/api/auth/login` and, on success, sets a session
  cookie and redirects (default `/hr`).
- The portal authenticates the robot user against Odoo, so the robot account
  must be a valid Odoo user that is allowed into the portal.
- Playwright logs in **once** in a setup step, saves the session cookie to a
  local file (`.auth/portal.json`), and every page check reuses it. This is
  faster and more stable than logging in on every page.

---

## Environment switching

A single environment variable selects the target:

| `SMOKE_ENV` | Base URL |
|---|---|
| `staging` (default) | `https://portal.krawings.de` |
| `live` | `https://staff.krawings.de` |

Robot credentials come from environment variables (`SMOKE_EMAIL`,
`SMOKE_PASSWORD`) — never hard-coded. Locally they live in `.env*.local`
(already git-ignored). In GitHub they live as **repository secrets**.

---

## Running it automatically (GitHub Actions)

A workflow `.github/workflows/portal-smoke.yml`:

- **Trigger 1 — on push to `main`:** runs the smoke test against **staging**.
- **Trigger 2 — manual button (`workflow_dispatch`):** lets you pick `staging`
  or `live` and run on demand (use this right after a live deploy).
- Steps: checkout → install deps → install Playwright browser → run smoke test →
  upload screenshots/traces as an artifact if it failed.
- Secrets used: `SMOKE_EMAIL`, `SMOKE_PASSWORD`.

### The honest catch (documented, accepted)

The portal does **not** auto-deploy. You push to GitHub, then manually pull +
build + restart on the server. So the on-push run tests *the currently deployed
site*, not the brand-new code you just pushed. That is still a useful health
check, but the **most valuable moment to run it is right after you deploy** —
which is what the manual run button is for. Building a fresh copy inside CI to
test un-deployed code is possible but more fragile to maintain; deferred.

---

## Read-only safety (live)

Every check only navigates and reads. The tests never interact with Save,
Delete, Submit, or any mutating control. This keeps live runs safe. (If we later
add flow tests that change data, those will be staging-only.)

---

## Files to be created/changed

- `playwright.config.ts` — config: base URL from `SMOKE_ENV`, retries, reporter,
  screenshot + trace on failure, the login-setup dependency.
- `tests/auth.setup.ts` — logs in once, saves `.auth/portal.json`.
- `tests/routes.ts` — the editable list of pages to check.
- `tests/smoke.spec.ts` — visits each route, runs the four assertions.
- `.github/workflows/portal-smoke.yml` — the GitHub Action.
- `package.json` — add `@playwright/test` (dev) + scripts: `smoke`,
  `smoke:staging`, `smoke:live`.
- `.gitignore` — add `/test-results/`, `/playwright-report/`, `/.auth/`.

No existing app code is modified — this is purely additive.

---

## What you (Ethan) need to provide — one-time

1. A **robot login** (email + password) that can log into the portal on both
   staging and live (i.e. a dedicated Odoo user permitted into the portal).
2. Add that email + password to the repo as GitHub secrets `SMOKE_EMAIL` and
   `SMOKE_PASSWORD` (I'll give exact click-by-click steps).

---

## Future / not now

- Add Odoo login + key-screen smoke checks.
- Deeper report/dashboard checks.
- Mobile-viewport re-run of the page checks (matches mobile-first design rules).
- Optional: build the app inside CI to test un-deployed code before deploy.
- Optional: scheduled run as an uptime monitor.
