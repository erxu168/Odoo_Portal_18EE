# Krawings Portal — Full Codebase Audit Report

**Date:** 2026-04-05
**Repo:** `erxu168/Odoo_Portal_18EE` (main branch)
**Stack:** Next.js 14 + TypeScript + Tailwind + SQLite (better-sqlite3)
**Audited by:** Claude Code (6 parallel audit agents)

---

## Executive Summary

The portal has **significant security vulnerabilities** that must be fixed before production. **42% of API routes (35 of 84) have no authentication**, meaning anyone with network access can create manufacturing orders, terminate employees, modify BOMs, and write portal settings — all using the Odoo admin account (uid=2).

Beyond security, there are data integrity risks from partial Odoo writes without rollback, a DST timezone bug that will misattribute revenue every summer, and widespread UX issues from native `confirm()`/`alert()` usage.

| Severity | Count |
|----------|-------|
| CRITICAL | 20 |
| HIGH | 24 |
| MEDIUM | 27 |
| LOW | 22 |
| **Total** | **93** |

| Category | Count |
|----------|-------|
| Security (Auth/IDOR/Injection) | 32 |
| Data Integrity | 11 |
| Error Handling | 8 |
| API Route Quality | 7 |
| Frontend / UX | 15 |
| Code Quality & Architecture | 12 |
| Performance | 4 |
| Odoo Integration | 4 |

---

## CRITICAL Issues (fix before production)

### SEC-1. Entire `/api/termination/*` tree has NO authentication (13 routes)
- **Files:** All files under `src/app/api/termination/`
- **Category:** Security — Auth Bypass
- **Description:** None of the 13 termination API routes call `getCurrentUser()` or `requireAuth()`. The middleware only checks that a cookie EXISTS — it does not validate the session token against the database. Any request with any string in the `kw_session` cookie bypasses middleware. These routes can create, confirm, cancel, delete termination records, set employee departure dates, generate/download termination letters, send emails to accountants, and upload signed documents. This is an HR/legal catastrophe if exploited.
- **Affected routes:** `route.ts` (GET/POST), `[id]/route.ts` (GET/PATCH), `[id]/cancel/`, `[id]/confirm/`, `[id]/delete/`, `[id]/deliver/`, `[id]/pdf/` (GET/POST), `[id]/send-accountant/`, `[id]/upload-proof/` (GET/POST), `[id]/upload-signed/`, `employees/`, `preview/`
- **Fix:** Add `requireAuth()` + `hasRole(user, 'manager')` to every termination route handler.

### SEC-2. Entire `/api/hr/termination/*` tree has NO authentication (4 routes)
- **Files:** All files under `src/app/api/hr/termination/`
- **Category:** Security — Auth Bypass
- **Description:** Duplicate termination API set — same zero-auth issue as SEC-1. Allows listing, creating, patching termination records and sending to accountant without authentication.
- **Fix:** Same as SEC-1.

### SEC-3. All manufacturing-orders routes have NO authentication (6+ routes)
- **Files:** `src/app/api/manufacturing-orders/route.ts`, `[id]/route.ts`, `[id]/print/route.ts`, `[id]/work-orders/route.ts`, `[id]/work-orders/[woId]/route.ts`, `pick-list/route.ts`
- **Category:** Security — Auth Bypass
- **Description:** Anyone can create MOs in Odoo production (`POST /api/manufacturing-orders`), confirm/cancel/mark-done MOs (`PATCH [id]`), write arbitrary values to `stock.move` via work order PATCH, and read all MO data including pick lists. Only the `[id]/package/` and `[id]/labels/` routes have auth.
- **Fix:** Add `requireAuth()` to all routes. Write operations should require manager role.

### SEC-4. All BOM routes have NO authentication (3 route files)
- **Files:** `src/app/api/boms/route.ts`, `boms/[id]/route.ts`, `boms/operations/route.ts`
- **Category:** Security — Auth Bypass
- **Description:** Unauthenticated BOM creation including lines and routing operations. Worksheet PDF upload without auth. Full BOM data + stock levels readable without auth.
- **Fix:** Add `requireAuth()`. Write operations should require manager role.

### SEC-5. PATCH `/api/termination/[id]` accepts arbitrary fields — no write allowlist
- **File:** `src/app/api/termination/[id]/route.ts`, line 42
- **Category:** Security — Input Validation
- **Description:** The PATCH handler passes `body` directly to `odoo.write(MODEL, [Number(id)], body)` with NO field allowlist. An attacker could write ANY field on `kw.termination` records, including state transitions that bypass workflow. Compare: `/api/hr/termination/[id]/route.ts` (line 44) properly whitelists fields.
- **Fix:** Add a field allowlist matching the HR variant.

### SEC-6. `/api/termination/[id]/upload-signed` executes shell commands
- **File:** `src/app/api/termination/[id]/upload-signed/route.ts`, lines 82-83
- **Category:** Security — Command Execution
- **Description:** Uses `exec()` with `wkhtmltopdf` on user-uploaded content. While temp file names use `randomBytes`, the base64 image content is written to disk and rendered by wkhtmltopdf (known attack surface for SSRF and local file inclusion via HTML/CSS). Combined with NO authentication, this is severe.
- **Fix:** Add auth + role check. Sanitize HTML input before passing to wkhtmltopdf.

### SEC-7. `/api/settings` PUT — NO auth, arbitrary key/value writes
- **File:** `src/app/api/settings/route.ts`, lines 10, 27
- **Category:** Security — Auth Bypass
- **Description:** Neither GET nor PUT has any auth check. Anyone can read all portal settings and write arbitrary key-value pairs to the settings table.
- **Fix:** Add `requireAuth()`. PUT should require admin role.

### SEC-8. `/api/hr/employees` — NO auth, lists all employees with private data
- **File:** `src/app/api/hr/employees/route.ts`, line 7
- **Category:** Security — Auth Bypass
- **Description:** Returns employee names, departments, job titles, private addresses (street, city, zip), work emails, and phone numbers with zero auth check.
- **Fix:** Add `requireAuth()` and require manager role.

### SEC-9. Cron endpoint bypassed when CRON_SECRET is not set
- **File:** `src/app/api/cron/generate-sessions/route.ts`, lines 27-29
- **Category:** Security — Auth Bypass
- **Description:** `if (secret && token !== secret)` — if `CRON_SECRET` env var is undefined/empty, the check is skipped. Anyone can trigger inventory session generation. Middleware also exempts `/api/cron` paths.
- **Fix:** Change to `if (!secret || token !== secret)`.

### SEC-10. `/api/products/[id]/expiry-debug` — NO auth, explicitly temporary
- **File:** `src/app/api/products/[id]/expiry-debug/route.ts`, lines 6-7
- **Category:** Security — Auth Bypass
- **Description:** Comment says "NO AUTH required (temporary)". Fetches product details from Odoo and leaks stack traces in error responses (line 93). Middleware exempts `/api/products/` path.
- **Fix:** Remove or gate behind admin role.

### SEC-11. `/api/bom-tolerance` — NO auth on GET or PUT
- **File:** `src/app/api/bom-tolerance/route.ts`, lines 16, 57
- **Category:** Security — Auth Bypass
- **Fix:** Add `requireAuth()`. PUT should require manager role.

### SEC-12. SQL column name interpolation in `updatePrinter`
- **File:** `src/lib/labeling-db.ts`, lines 180-186
- **Category:** Security — SQL Injection
- **Description:** `updatePrinter` iterates over `Object.entries(fields)` and interpolates key names directly into SQL: `sets.push(\`${k} = ?\`)`. Values are bound but keys are not. If attacker-controlled keys reach this function via the PUT endpoint, they could inject SQL through crafted key names.
- **Fix:** Add an allowlist of permitted field names.

### DATA-1. Inventory approval: partial Odoo write without rollback
- **File:** `src/app/api/inventory/approve/route.ts`, lines 52-86
- **Category:** Data Integrity — Odoo Write Safety
- **Description:** Writes `inventory_quantity` to Odoo for each count entry one at a time (loop at lines 55-71), then calls `action_apply_inventory` on all quants at line 81. If the loop fails partway, some quants get updated and some don't. The SQLite session is already marked "approved" (line 45) and cannot be re-submitted. No way to know which items synced and which didn't.
- **Fix:** Batch all quant writes into a single Odoo RPC call, or track per-entry sync status in SQLite. Provide a "retry sync" action for failed entries.

### DATA-2. Purchase receipt: stock updated but failure silently swallowed
- **File:** `src/app/api/purchase/receive/route.ts`, lines 122-232
- **Category:** Data Integrity — Odoo Write Safety
- **Description:** Receipt confirmation writes to `stock.quant` for each line in a loop. If the loop fails after updating some quants, the receipt is still marked confirmed in SQLite (line 117) and response says "Receipt confirmed and stock updated" (line 235). Each line does `write` then `action_apply_inventory` independently — if `action_apply_inventory` fails but `write` succeeded, Odoo is in a dirty state. Outer catch (line 230) swallows entire error.
- **Fix:** Collect all quant IDs, call `action_apply_inventory` once at the end. Track which lines synced. Return a warning if Odoo sync failed.

### DATA-3. `berlinToUtc()` hardcodes `+01:00` — breaks during Daylight Saving Time
- **File:** `src/lib/report-queries.ts`, line 37
- **Category:** Data Integrity — Timezone
- **Description:** `berlinToUtc()` appends `+01:00` (CET/winter) to every date. Berlin is UTC+2 during summer (CEST, late March–October). All POS report queries during summer are shifted by 1 hour. Orders at 23:30 Berlin time in summer would be attributed to the wrong day. Material revenue misattribution for daily reports.
- **Fix:** Use `Intl.DateTimeFormat` with `timeZone: 'Europe/Berlin'` to compute the offset dynamically.

### UX-1. `useEffect` without dependency array — potential infinite re-render
- **File:** `src/app/recipes/page.tsx`, lines 131-138
- **Category:** Frontend — Performance/Memory
- **Description:** The "reset to dashboard" useEffect has NO dependency array. Runs on EVERY render, reading/writing sessionStorage and calling `setScreen()`. Can create infinite render loops.
- **Fix:** Add `[]` as the dependency array.

### ODOO-1. `krawings_contract` module is uninstalled on staging
- **Category:** Odoo Integration
- **Description:** Module exists in DB but state is `uninstalled`. Portal code referencing `krawings.contract` model will fail. Contract scanner features won't work.
- **Fix:** Install the module on staging, or add graceful fallback in portal code.

### ODOO-2. `krawings_document_layout` module is uninstalled on staging
- **Category:** Odoo Integration
- **Description:** Module exists but state is `uninstalled`. DIN 5008 letterhead generation for termination letters will fail.
- **Fix:** Install the module on staging.

### ODOO-3. Custom models not found by expected names
- **Category:** Odoo Integration
- **Description:** `krawings.recipe.config` and `krawings.termination` models are NOT accessible on staging despite their parent modules (`krawings_recipe_config` v18.0.2.0.0 and `krawings_termination_v2` v18.0.2.0.0) showing as installed. The actual model names may differ from what the portal code expects (e.g., `kw.termination` vs `krawings.termination`). All recipe and termination API calls using the wrong model name will fail.
- **Fix:** Verify actual model `_name` in the Odoo module source and update portal code to match.

---

## HIGH Issues (fix soon)

### SEC-13. Hardcoded admin password in source
- **File:** `src/lib/db.ts`, line 138
- **Category:** Security — Credentials
- **Description:** `bcrypt.hashSync('krawings2026', 10)` — plaintext password visible in repo. If deployed without changing, this is a known credential.
- **Fix:** Generate random password at seed time or require first-run setup.

### SEC-14. Odoo credentials in fallback defaults
- **File:** `src/lib/odoo.ts`, lines 14-15
- **Category:** Security — Credentials
- **Description:** `ODOO_USER` defaults to `'biz@krawings.de'` if env var missing. Username also appears in `hr/termination/[id]/pdf/route.ts` line 37 and `auth/register/route.ts` line 265.
- **Fix:** Remove fallback defaults. Require env vars and fail fast at startup.

### SEC-15. Error responses leak Odoo internal details (~25 routes)
- **Category:** Security — Information Leakage
- **Description:** Many routes return `error.message` directly to the client. Odoo RPC errors contain model names, field names, access rule violations, Python tracebacks, and database structure. The expiry-debug endpoint explicitly returns `stack: error.stack?.split('\n').slice(0, 5)`.
- **Fix:** Return generic error messages to clients. Log detailed errors server-side.

### SEC-16. Session cookie missing `secure` flag
- **File:** `src/app/api/auth/login/route.ts`, lines 103-107
- **Category:** Security — Session Management
- **Description:** Cookie is `httpOnly: true, sameSite: 'lax'` but NOT `secure: true`. Token sent in cleartext over HTTP.
- **Fix:** Add `secure: process.env.NODE_ENV === 'production'`.

### SEC-17. Task seed endpoint lets any user set their employee_id
- **File:** `src/app/api/tasks/seed/route.ts`, lines 18-19
- **Category:** Security — IDOR/Role
- **Description:** Any authenticated user can POST to set `employee_id = 45` on their portal_users record, bypassing admin-controlled employee linking.
- **Fix:** Remove or restrict to admin role.

### SEC-18. 30-day session without rotation
- **File:** `src/lib/db.ts`, lines 250-252
- **Category:** Security — Session Management
- **Description:** Sessions last 30 days with no rotation. If token is stolen, it remains valid for the entire duration. No mechanism to invalidate all sessions on password change.
- **Fix:** Rotate tokens periodically. Invalidate all sessions on password change.

### DATA-4. Purchase order GET by ID has no company/location authorization
- **File:** `src/app/api/purchase/orders/route.ts`, lines 22-27
- **Category:** Data Integrity — Company Isolation
- **Description:** Fetching a single order by `?id=X` returns it directly with no check that the order belongs to the user's allowed company or location.
- **Fix:** Verify `order.location_id` matches user's authorized locations.

### DATA-5. Purchase order creation: cart cleared even if Odoo PO creation fails
- **File:** `src/app/api/purchase/orders/route.ts`, lines 80-95
- **Category:** Data Integrity — Odoo Write Safety
- **Description:** If auto-approved order fails to create in Odoo (catch line 90), the cart is still cleared (line 95). Operator sees "Order sent" but no PO exists in Odoo. No retry mechanism.
- **Fix:** Keep the cart on Odoo failure. Add a "sync failed" status visible in UI.

### DATA-6. Hardcoded location mapping — only 2 of 5 companies
- **File:** `src/app/api/purchase/orders/route.ts`, line 107; `approve/route.ts`, line 42
- **Category:** Data Integrity — Company Isolation
- **Description:** `location_id === 32 ? 'SSAM' : 'GBM38'` — any location not 32 defaults to company 2's picking type. The 5-company setup is not reflected.
- **Fix:** Build a proper location-to-company mapping covering all 5 companies.

### DATA-7. `getOrCreateCart` — read-then-write without transaction (race condition)
- **File:** `src/lib/purchase-db.ts`, lines 259-270
- **Category:** Data Integrity — Race Conditions
- **Description:** Two concurrent requests with same `(locationId, supplierId)` can both see no existing cart and create duplicates.
- **Fix:** Add UNIQUE constraint on `(location_id, supplier_id, status)` where status='draft', use `INSERT ... ON CONFLICT`.

### DATA-8. `upsertCountEntry` — read-then-write without transaction (race condition)
- **File:** `src/lib/inventory-db.ts`, lines 328-355
- **Category:** Data Integrity — Race Conditions
- **Description:** Two concurrent saves for same product in same session could create duplicate entries.
- **Fix:** Add UNIQUE constraint on `(session_id, product_id)`, use `INSERT ... ON CONFLICT DO UPDATE`.

### DATA-9. Inventory tables never auto-initialized
- **File:** `src/lib/inventory-db.ts` (all inventory API routes import but never call `initInventoryTables`)
- **Category:** Data Integrity — Schema
- **Description:** If cron hasn't run yet (fresh deployment), any inventory API call crashes with "no such table". Unlike `purchase-db.ts` which auto-initializes on import.
- **Fix:** Add `try { initInventoryTables(); } catch (_e) {}` at module scope.

### DATA-10. No rollback on multi-step BOM creation
- **File:** `src/app/api/boms/route.ts`, lines 193-218
- **Category:** Data Integrity — Odoo Write Safety
- **Description:** If BOM creation succeeds but line or operation creation fails partway, orphan BOM records remain in Odoo.
- **Fix:** Add cleanup logic on failure (delete the orphan BOM).

### DATA-11. No rollback on purchase order approval
- **File:** `src/app/api/purchase/orders/approve/route.ts`, lines 53-68
- **Category:** Data Integrity — Odoo Write Safety
- **Description:** If Odoo PO creation succeeds but `button_confirm` fails, PO exists unconfirmed while portal order is marked "approved".
- **Fix:** Add error handling to detect and surface this inconsistency.

### ARCH-1. Duplicate termination API — two parallel implementations
- **Files:** `src/app/api/termination/` (12 files) vs `src/app/api/hr/termination/` (4 files)
- **Category:** Architecture — Duplication
- **Description:** Two complete termination API trees serving the same Odoo model with different response shapes (`{ ok, data }` vs `{ records }`). Both are live simultaneously.
- **Fix:** Consolidate into one API tree, deprecate the other.

### ARCH-2. Duplicate German holiday calculators
- **Files:** `src/lib/german-holidays.ts` (108 lines) vs `src/lib/purchase-holidays.ts` (218 lines)
- **Category:** Architecture — Duplication
- **Description:** Both contain identical Easter computation. `purchase-holidays.ts` includes Reformationstag (Oct 31) which `german-holidays.ts` misses — that's a bug (Berlin holiday since 2019).
- **Fix:** Consolidate into one module. Add Reformationstag to the canonical version.

### ARCH-3. `new OdooClient()` creates redundant auth sessions (8 files)
- **Files:** `src/app/api/hr/employee/route.ts`, `hr/employee/photo/route.ts`, `hr/documents/route.ts`, `hr/documents/[id]/route.ts`, `hr/contract-status/route.ts`, `hr/applicant/status/route.ts`, `hr/recruitment/create-access/route.ts`, `purchase/suppliers/search/route.ts`
- **Category:** Performance / Architecture
- **Description:** These files instantiate `new OdooClient()` and manually `authenticate()` on every request instead of using the `getOdoo()` singleton. Creates an extra HTTP round-trip to Odoo per request.
- **Fix:** Replace all with `getOdoo()`.

### UX-2. Native `confirm()` used for 6 destructive actions in TermDetail
- **File:** `src/components/termination/TermDetail.tsx`, lines 162, 176, 219, 230-231, 242
- **Category:** Frontend — UX
- **Description:** Uses native `confirm()` for stage change, confirm termination, send to accountant, cancel (double confirm), and delete. Non-themeable, blocks JS thread, ugly on mobile PWA.
- **Fix:** Replace with existing `ConfirmDialog` component.

### UX-3. Native `alert()` used for error display (18+ occurrences)
- **Files:** `TermDetail.tsx` (7), `PdfDocumentCard.tsx` (3), `tasks/staff/page.tsx` (1), `admin/users/page.tsx` (1), `DeliveryForm.tsx` (3)
- **Category:** Frontend — UX
- **Description:** On iOS PWA, `alert()` can cause layout issues and is not accessible.
- **Fix:** Use inline error banners or the existing `Toast` component.

### UX-4. Native `prompt()` used for password reset
- **File:** `src/app/admin/users/page.tsx`, line 200
- **Category:** Frontend — UX/Security
- **Description:** Shows password in plaintext in a browser popup. Jarring on mobile PWA.
- **Fix:** Replace with a modal/bottom sheet with proper password input.

### UX-5. Silent error swallowing across purchase module
- **File:** `src/app/purchase/page.tsx`, lines 91-94, 110, 139, 149, 171, 185-186, 192, 197, 202, 221
- **Category:** Frontend — Error Handling
- **Description:** Nearly every fetch catches errors with `void e;` and shows nothing to the user. If network fails while creating an order, user thinks it succeeded. Data-loss risk.
- **Fix:** Add error states and inline error banners for critical write operations.

### UX-6. Password validation inconsistency
- **Files:** `src/app/register/page.tsx` (8+ chars + number) vs `src/app/reset-password/page.tsx` (6 chars, no number)
- **Category:** Frontend — UX
- **Description:** User can reset password to something weaker than registration allows.
- **Fix:** Unify to 8+ chars with number requirement.

### UX-7. Auth forms don't support Enter key submission
- **Files:** `login/page.tsx`, `register/page.tsx`, `forgot-password/page.tsx`, `change-password/page.tsx`
- **Category:** Frontend — Accessibility
- **Description:** None use `<form onSubmit>`. Pressing Enter does nothing. Basic accessibility failure.
- **Fix:** Wrap in `<form onSubmit={handleSubmit}>` with `e.preventDefault()`.

### ODOO-4. Portal doesn't handle `to_close` (MO) and `to approve` (PO) states
- **Category:** Odoo Integration — State Mismatch
- **Description:** Odoo 18 has `to_close` state on `mrp.production` and `to approve` state on `purchase.order`. Portal doesn't render or filter these. MOs/POs in these states may be invisible or miscategorized.
- **Fix:** Add handling for these states in the portal UI.

---

## MEDIUM Issues (technical debt)

### SEC-19. IDOR — Purchase routes don't scope by user/company
- **Files:** `src/app/api/purchase/orders/route.ts`, `cart/route.ts`, `orders/cancel/route.ts`
- **Category:** Security — IDOR
- **Description:** Cart/order operations accept IDs from request without verifying the user is authorized for that location/company.
- **Fix:** Verify requested location is in user's `allowed_company_ids`.

### SEC-20. IDOR — Inventory session ownership not verified
- **File:** `src/app/api/inventory/counts/route.ts`, lines 50-68
- **Category:** Security — IDOR
- **Description:** Any authenticated user can add/modify counts on any session by providing `session_id`.
- **Fix:** Verify session is assigned to current user or user is a manager.

### SEC-21. Middleware path matching too permissive
- **File:** `src/middleware.ts`, line 8
- **Category:** Security — Auth Bypass
- **Description:** `PUBLIC_PATHS` includes `/api/products/` which exempts ALL product sub-routes including the debug endpoint.
- **Fix:** Use exact path matches. Remove `/api/products/` exemption.

### SEC-22. Admin role enum not validated on PATCH
- **File:** `src/app/api/admin/users/[id]/route.ts`, line 35
- **Category:** Security — Input Validation
- **Description:** `body.role` accepted without checking it matches `staff|manager|admin`.
- **Fix:** Validate against allowed role values.

### SEC-23. Admin password reset has no complexity check
- **File:** `src/app/api/admin/users/[id]/route.ts`, lines 28-29
- **Category:** Security — Input Validation
- **Fix:** Apply same password policy as registration.

### DATA-12. `nowISO()` returns UTC — session dates for Berlin users are off
- **Files:** `src/lib/db.ts` line 18, `inventory-db.ts` line 85, `purchase-db.ts` line 10
- **Category:** Data Integrity — Timezone
- **Description:** All `nowISO()` functions use `new Date().toISOString()` (UTC). At 11pm Berlin (= next-day UTC in summer), duplicate order detection uses the wrong calendar day.
- **Fix:** Use Berlin-local dates for date-boundary logic.

### DATA-13. `generateTodaySessions` uses server local date, not Berlin
- **File:** `src/lib/inventory-db.ts`, lines 257-291
- **Category:** Data Integrity — Timezone
- **Fix:** Construct Berlin date explicitly using `Intl.DateTimeFormat`.

### DATA-14. No UNIQUE constraint on `(cart_id, product_id)` in purchase cart items
- **File:** `src/lib/purchase-db.ts`, lines 60-80
- **Category:** Data Integrity — Race Conditions
- **Fix:** Add `UNIQUE(cart_id, product_id)` and use `INSERT ... ON CONFLICT`.

### DATA-15. Odoo queries don't filter by company in most purchase routes
- **Files:** All routes in `src/app/api/purchase/`
- **Category:** Data Integrity — Company Isolation
- **Description:** Purchase module relies on hardcoded `LOCATIONS` map for company_id (only 2 of 5 companies). Odoo's record rules via `allowed_company_ids` depend on the admin user having restricted access — which it doesn't.
- **Fix:** Explicitly pass `company_id` from user context in all Odoo write operations.

### DATA-16. `pdfjs-dist` uses `^4.8.69` instead of pinned `4.8.69`
- **File:** `package.json`
- **Category:** Data Integrity — Dependencies
- **Fix:** Remove caret for a true pin.

### DATA-17. Stale purchase drafts in SQLite — no TTL or refresh
- **File:** `src/lib/purchase-db.ts`
- **Category:** Data Integrity — Stale Data
- **Description:** Cart items reference prices from Odoo at add-time. No refresh mechanism. Old drafts persist indefinitely.
- **Fix:** Warn users if cart items are older than 24-48h. Optionally refresh prices.

### DATA-18. `createSplit` in labeling not wrapped in transaction
- **File:** `src/lib/labeling-db.ts`, lines 217-239
- **Category:** Data Integrity — Race Conditions
- **Fix:** Wrap in `db.transaction()`.

### ERR-1. `catch (e: any)` used instead of `catch (e: unknown)` (~20 routes)
- **Files:** `purchase/orders/approve/route.ts`, `purchase/page.tsx`, `purchase/suppliers/search/route.ts`, `purchase/products/route.ts`, `purchase/seed/route.ts`, `companies/route.ts`, `admin/users/page.tsx`, and more
- **Category:** Error Handling — Known Pitfall
- **Fix:** Change to `catch (e: unknown)` with `instanceof Error` checks.

### ERR-2. Inconsistent response shapes across API
- **Category:** API Quality
- **Description:** At least 4 different shapes: `{ ok, data }`, `{ records, total }`, `{ error }`, `{ success }`.
- **Fix:** Standardize on one shape.

### ERR-3. Error message leakage in ~25 routes
- **Category:** Error Handling — Information Leakage
- **Description:** Routes return `error.message` directly. The manufacturing-orders print route returns error in plaintext HTML. Purchase guides DELETE returns debug info.
- **Fix:** Return generic messages; log details server-side.

### ARCH-4. Dead code — Reports module (~700 lines, zero consumers)
- **Files:** `src/lib/report-cache.ts`, `src/lib/report-queries.ts`, `src/types/reports.ts`
- **Category:** Code Quality — Dead Code
- **Fix:** Delete or move to `_planned/` directory.

### ARCH-5. Dead code — `design-system.ts` (~250 lines, zero imports)
- **File:** `src/lib/design-system.ts`
- **Category:** Code Quality — Dead Code
- **Fix:** Delete or actually adopt its tokens.

### ARCH-6. `any` types in OdooClient — all return types are `any`
- **File:** `src/lib/odoo.ts`
- **Category:** Code Quality — TypeScript
- **Description:** Every method returns `Promise<any>`. Root cause of cascading `any` across codebase.
- **Fix:** Add generics: `searchRead<T>(...)`: `Promise<T[]>`.

### ARCH-7. 90+ `as any` casts across codebase
- **Files:** `MyProfile.tsx` (25+), `StepDocuments.tsx`, `StepInsurance.tsx`, `StepTax.tsx`, `BarcodeScanner.tsx`, `purchase-db.ts` (15+), `db.ts`
- **Category:** Code Quality — TypeScript
- **Fix:** Extend interfaces with missing fields; create typed SQLite query wrapper.

### ARCH-8. Odoo date strings parsed without `.replace(' ', 'T')` fix
- **Files:** `MoList.tsx` lines 46/169/205, `CandidateStatus.tsx` line 112, `manufacturing-orders/[id]/labels/route.ts` line 30, `manufacturing-orders/[id]/print/route.ts` line 61
- **Category:** Code Quality — Date Handling
- **Description:** Odoo uses space separator (`"2026-03-27 14:00:00"`). `new Date()` with this format returns `Invalid Date` on Safari/iOS. Only `odoo-tasks.ts` correctly uses `.replace(' ', 'T')`.
- **Fix:** Create shared `parseOdooDate()` helper and use everywhere.

### UX-8. `themeColor` is blue `#2563EB` in layout.tsx
- **File:** `src/app/layout.tsx`, line 20
- **Category:** Frontend — UX Consistency
- **Fix:** Verify intended theme color.

### UX-9. Metadata description still says "SSAM Korean BBQ"
- **File:** `src/app/layout.tsx`, line 12
- **Category:** Frontend — Content
- **Fix:** Change to "Krawings - Staff Portal".

### UX-10. Only 4 of 106 components use `aria-label`
- **Category:** Frontend — Accessibility
- **Description:** Most icon-only buttons (back, home, close, delete throughout every module) have zero accessible names.
- **Fix:** Add `aria-label` to all icon-only buttons.

---

## LOW Issues (nice to have)

### SEC-24. No brute force protection on login
- **File:** `src/app/api/auth/login/route.ts`
- **Category:** Security
- **Fix:** Add rate limiting by IP or email.

### SEC-25. Password policy is weak (8 chars + 1 digit only)
- **File:** `src/app/api/auth/register/route.ts`, lines 29-31
- **Fix:** Require uppercase + special character, or use entropy checking.

### SEC-26. `generateTempPassword` uses `Math.random()`
- **File:** `src/app/api/hr/recruitment/create-access/route.ts`, lines 7-13
- **Fix:** Use `crypto.getRandomValues()`.

### SEC-27. Temp password returned in API response on email failure
- **File:** `src/app/api/hr/recruitment/create-access/route.ts`, line 102
- **Fix:** Never return passwords in API responses.

### SEC-28. `requireAuth()` returns null instead of throwing — misleading name
- **File:** `src/lib/auth.ts`, line 27
- **Category:** Code Quality
- **Description:** Design invites auth bypass bugs where developers forget the null check. This is the **systemic root cause** of most CRITICAL auth issues.
- **Fix:** Rename to `getUser()` or make it throw/return a 401 response.

### DATA-19. OdooClient singleton has no session expiry handling
- **File:** `src/lib/odoo.ts`, lines 252-258
- **Category:** Data Integrity
- **Description:** `ensureAuth()` only checks `if (!this.uid)`. Never re-authenticates after session timeout.
- **Fix:** Add retry logic: on session error, clear uid and retry via `ensureAuth()`.

### DATA-20. `createOrder` and `createReceipt` not wrapped in transactions
- **File:** `src/lib/purchase-db.ts`, lines 334-359, 417-434
- **Fix:** Wrap in `db().transaction()`.

### DATA-21. Missing indexes on frequently filtered columns
- **File:** `src/lib/purchase-db.ts`
- **Fix:** Add `CREATE INDEX idx_orders_supplier ON purchase_orders(supplier_id, location_id, status)`.

### DATA-22. No cleanup of old counting sessions or quick counts
- **File:** `src/lib/inventory-db.ts`
- **Fix:** Add periodic cleanup job.

### DATA-23. `recipe-db.ts` does not auto-initialize tables
- **File:** `src/lib/recipe-db.ts`
- **Fix:** Add auto-init on import, matching purchase-db pattern.

### ARCH-9. `getAuditLog` returns `any[]`
- **File:** `src/lib/db.ts`, line 364
- **Fix:** Define `AuditLogEntry` interface.

### ARCH-10. Duplicate `DateFilter` and `StandardFilter` components
- **Files:** `src/components/ui/DateFilter.tsx` vs `StandardFilter.tsx`
- **Fix:** Consolidate into one component.

### ARCH-11. Inconsistent auth import patterns
- **Category:** Code Quality
- **Description:** Some routes use `getCurrentUser`, others `requireAuth`, others manual `cookies()` + `getSessionUser()`.
- **Fix:** Standardize on one pattern.

### ARCH-12. Purchase page is 530-line monolith with 50+ state variables
- **File:** `src/app/purchase/page.tsx`
- **Fix:** Extract each screen into separate component files.

### UX-11. `BomDetail.tsx` is 814 lines — needs splitting
- **File:** `src/components/manufacturing/BomDetail.tsx`
- **Fix:** Extract EditMode, ViewMode, IngredientList, OperationList.

### UX-12. `DocumentCapture.tsx` is 670 lines
- **File:** `src/components/hr/DocumentCapture.tsx`
- **Fix:** Extract camera/capture logic into reusable hook.

### UX-13. No loading state for `/api/auth/me` calls
- **Files:** `inventory/page.tsx`, `recipes/page.tsx`, `purchase/page.tsx`
- **Description:** Manager could briefly see staff-only view before role resolves.
- **Fix:** Show spinner until auth check completes.

### UX-14. Tasks admin page has non-functional toggles and "Save Settings" button
- **File:** `src/app/tasks/admin/page.tsx`, lines 32-55
- **Fix:** Wire up save logic or mark as "Coming soon".

### UX-15. Tasks staff page has non-functional photo upload
- **File:** `src/app/tasks/staff/page.tsx`, lines 97-99
- **Fix:** Implement or hide the button.

### UX-16. `userScalable: false` prevents pinch-to-zoom (WCAG failure)
- **File:** `src/app/layout.tsx`, line 19
- **Fix:** Remove or use `touch-action: manipulation` instead.

### UX-17. `toLocaleDateString` without `timeZone: 'Europe/Berlin'` (~10 occurrences)
- **Files:** `MoList.tsx`, `ReviewSubmissions.tsx`, `ChecklistCard.tsx`, `ShiftPill.tsx`, `TaskRow.tsx`, `admin/users/page.tsx`
- **Fix:** Add `timeZone: 'Europe/Berlin'` to all `toLocaleString` options.

### UX-18. `en-DE` is not a valid locale
- **File:** `src/components/manufacturing/Dashboard.tsx`, line 75
- **Fix:** Use `en-GB` or `de-DE`.

### PERF-1. `limit: 5000` fetches entire employee table for department filter
- **File:** `src/app/api/hr/filters/route.ts`, line 22
- **Fix:** Use `read_group` for server-side counting.

### PERF-2. WebBLE `gattserverdisconnected` listener never removed
- **File:** `src/hooks/useZebraBluetooth.ts`, line 213
- **Fix:** Call `removeEventListener` in `disconnectBle()`.

### PERF-3. Inline icon component definitions cause unnecessary re-renders
- **Files:** `manufacturing/page.tsx`, `termination/page.tsx`, `purchase/page.tsx`
- **Fix:** Move icon definitions outside components or to shared `icons.tsx`.

---

## Odoo Integration Audit Summary (Live Staging Validation)

### Modules
| Module | Status | Version |
|--------|--------|---------|
| mrp | INSTALLED | 18.0.2.0 |
| purchase | INSTALLED | 18.0.1.2 |
| stock | INSTALLED | 18.0.1.1 |
| hr | INSTALLED | 18.0.1.1 |
| planning | INSTALLED | 18.0.1.0 |
| product | INSTALLED | 18.0.1.2 |
| uom | INSTALLED | 18.0.1.0 |
| account | INSTALLED | 18.0.1.3 |
| krawings_recipe_config | INSTALLED | 18.0.2.0.0 |
| krawings_termination_v2 | INSTALLED | 18.0.2.0.0 |
| **krawings_contract** | **UNINSTALLED** | — |
| **krawings_document_layout** | **UNINSTALLED** | — |

### Models — All 20 Standard Models Verified
All expected fields present on: `mrp.production` (15), `mrp.workorder` (8), `mrp.bom` (9), `mrp.bom.line` (4), `mrp.routing.workcenter` (8), `mrp.workcenter` (2), `product.product` (6), `product.template` (3), `stock.quant` (5), `stock.picking` (5), `purchase.order` (7), `purchase.order.line` (5), `product.supplierinfo` (5), `hr.employee` (8), `hr.department` (2), `res.partner` (5), `res.company` (2), `uom.uom` (4), `planning.slot` (6), `account.tax` (3).

**Good news:** `mrp.routing.workcenter` `worksheet` and `worksheet_type` fields confirmed present. `planning.slot` accessible (planning module IS installed).

### Custom Models
| Model | Status |
|-------|--------|
| `krawings.recipe.config` | **NOT FOUND** (module installed but model inaccessible) |
| `krawings.recipe.step` | OK (19 fields) |
| `krawings.termination` | **NOT FOUND** (module installed but model inaccessible) |
| `krawings.contract` | NOT FOUND (module uninstalled) |

### State Value Alignment
| Model | Field | Portal Expects | Odoo Has Extra |
|-------|-------|----------------|----------------|
| `mrp.production` | `state` | draft, confirmed, progress, done, cancel | **`to_close`** |
| `mrp.workorder` | `state` | pending, waiting, ready, progress, done, cancel | — (all match) |
| `purchase.order` | `state` | draft, sent, purchase, done, cancel | **`to approve`** |

### Terminology Mismatches
| Concept | Portal Uses | Odoo Uses |
|---------|-------------|-----------|
| BOM in Chef Guide | "Recipe" | "Bill of Materials" |
| Staff/Employee | Mixed "Staff" and "Employee" | "Employee" |
| Planning module | "Tasks" / "Shifts" | "Planning" |
| Supplier | "Supplier" | "Vendor" (Odoo 18 Purchase) |
| Location | Restaurant location | `stock.location` (warehouse) — ambiguous |

---

## Priority Action Plan

### Immediate (today)
1. **Add auth + role checks to all 35 unprotected routes** — Start with termination (C1/C2) and manufacturing (C3) as these have the most damaging potential
2. **Fix `requireAuth()` to throw instead of returning null** (L-SEC-28) — this is the systemic root cause
3. **Add field allowlist to termination PATCH** (C5)
4. **Fix cron secret check** (C9) — one-line fix

### This week
5. Fix `berlinToUtc()` DST bug (C-DATA-3)
6. Add rollback/tracking to inventory approval + purchase receipt Odoo writes (C-DATA-1, C-DATA-2)
7. Replace all native `confirm()`/`alert()`/`prompt()` (H-UX-2/3/4)
8. Add company isolation checks to purchase routes (M-SEC-19, M-DATA-15)
9. Verify/fix custom model names (`krawings.recipe.config` → actual name, `krawings.termination` → actual name) (C-ODOO-3)

### This sprint
10. Consolidate duplicate termination APIs (H-ARCH-1)
11. Add error handling to purchase module UI (H-UX-5)
12. Fix Odoo date parsing on Safari/iOS (M-ARCH-8)
13. Replace `new OdooClient()` with `getOdoo()` in 8 files (H-ARCH-3)
14. Clean up dead code (~1000 lines) (M-ARCH-4, M-ARCH-5)
15. Add session cookie `secure` flag (H-SEC-16)
16. Add login rate limiting (L-SEC-24)
17. Handle `to_close` and `to approve` states in UI (H-ODOO-4)

---

## API Route Auth Status Matrix (all 84 routes)

| Auth Status | Count | % |
|-------------|-------|---|
| Authenticated + role check | 18 | 21% |
| Authenticated, no role check | 31 | 37% |
| **NO authentication** | **35** | **42%** |

**35 unprotected routes by module:**
- Termination: 13 routes
- HR Termination: 4 routes
- Manufacturing Orders: 6 routes
- BOMs: 3 routes
- Other (settings, bom-tolerance, products/search, workcenters, purchase/alerts, dashboard, companies, address-autocomplete, cron, expiry-debug): 9 routes
