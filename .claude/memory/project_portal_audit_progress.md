---
name: Portal Audit Progress (2026-03-27)
description: Full portal audit session — what was fixed, what's deployed, what's still pending
type: project
---

## Completed & Deployed (2026-03-27)

### Navigation Fixes
- **AppDrawer**: Added Chef Guide + HR links to hamburger menu
- **Dashboard**: Added HR tile (rose-colored, links to /hr)
- **TopBar/TabBar hiding**: `/hr` added to static HIDDEN_ROUTES; `/recipes` uses dynamic TopBarContext (`setHidden`) — NOT in static HIDDEN_ROUTES
- **MainWrapper**: `/recipes` and `/hr` in FULL_SCREEN_ROUTES (no padding)
- **Recipe page reset bug**: Next.js App Router caches page state during soft navigation, so navigating away from /recipes and back preserved the old screen. Fixed with `sessionStorage` flag (`kw_recipes_reset`): dashboard tile + AppDrawer set the flag before `router.push('/recipes')`, recipes page checks for it on render and resets to dashboard.

### Design System Harmonization (all deployed)
- **Main Dashboard**: Rewritten — colored semantic tiles (2-col grid), blue header (`bg-[#2563EB]`), `bg-gray-50` page bg. Removed old uniform blue icon pattern.
- **Manufacturing Dashboard (MfgDashboard)**: orange/green/amber/blue/green colored tiles replacing old white+blue
- **Purchase Dashboard (OrdersDashboard)**: blue/green/amber/purple colored tiles, left-aligned layout replacing old centered white+blue
- **HR Dashboard (HrDashboard)**: green/amber/blue/purple colored tiles with disabled pattern for Help/DATEV Export. Updated DashTile component to support `bg`, `border`, `iconBg`, `iconColor`, `disabled` props.
- **Inventory Dashboard**: Already correct, no changes needed
- **AppDrawer header**: `bg-[#1A1F2E]` → `bg-[#2563EB]` (blue)
- **HR components**: `bg-[#f8faf9]` → `bg-gray-50` across 8 files (OnboardingWizard, CandidateStatus, EmployeeOverview, EmployeeDetail, HrDashboard, DocumentCapture, MyProfile, MyDocuments)
- **Coming soon tiles**: Dashboard placeholder tiles (Shift Schedule, My Tasks, Leave, Payroll) now `opacity-50` with "Coming soon" subtitle instead of bounce toast
- **"See all" link**: Grayed out (tasks module not built)

### Key Finding: Server vs Local Codebase
- Local copy (`~/Downloads/krawings-update.tar_1`) is way behind the server (`/opt/krawings-portal` on 89.167.124.0)
- Server has full HR module: OnboardingWizard (8 steps), MyProfile, MyDocuments, DocumentCapture, EmployeeOverview, EmployeeDetail, CandidateStatus, plus HR API routes
- All edits during this session were done directly on the server via SCP + SSH

## Still Pending

### From Audit
- Inventory dashboard icon colors missing `iconColor` class (icons render in default color, not the semantic color) — minor
- HR Help tile and DATEV Export tile are disabled/coming soon — need actual implementation eventually

### From Previous Session (2026-03-26)
- **SMTP configuration** — add env vars to .env.local for candidate welcome emails
- **Odoo custom module** (`krawings_recruitment`) — "Grant Portal Access" wizard on hr.applicant form view
- **Frequency tracking** for quick picks in CookingGuideBrowse
- **Local codebase sync** — pull full server state to local copy

**Why:** Building a consistent, fully navigable portal across all modules.

**How to apply:** All changes are on the server. Local copy needs syncing. Design system is now consistent — any new modules should follow the canonical colored tile pattern (see feedback_design_system.md).
