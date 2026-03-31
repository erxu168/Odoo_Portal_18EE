---
name: Recruitment Pipeline Build Progress
description: Current state of the recruitment pipeline feature — what's done, what's pending, and next steps
type: project
---

## Completed (2026-03-26)

### Phase 1: Odoo Pipeline Configuration
- **Stages renamed**: New → Screening → Trial Shift → Hireable → Contract Proposal → Contract Signed (folded)
- **Jobs cleaned**: 28 → 18 (deleted 10 duplicates, renamed "Kitchen Staffs" → "Kitchen Staff")
- **Departments restructured** into company hierarchy:
  ```
  Krawings (id=16)
    ├─ Administration (id=1) → General Manager
    ├─ Building Maintenance (id=13) → Janitor
    ├─ Central Kitchen (id=5)
    │   ├─ Kitchen (id=19) → CK Cook, Kitchen Helper, Kitchen Manager, Kitchen Porter, Kitchen Staff, Line Cook
    │   └─ Office (id=20) → Bookkeeper, HR Assistant
    └─ GBM38 (id=17)
        ├─ Kitchen (id=7)
        ├─ Service (id=21) → Service Staff, Bartender, Runner, Bar/Shift Supervisor, Asst/FOH Manager
        └─ Cleaning (id=22) → Cleaner FOH
  SSam Korean BBQ, Inh. Ruo Xu (id=14)
    ├─ Kitchen (id=9)
    ├─ Service (id=11)
    └─ Cleaning (id=15)
  SSam Warschauer Strasse GmbH (id=18)
    └─ Kitchen (id=12)
  ```
- Odoo instance is at `http://127.0.0.1:15069` on the portal server (89.167.124.0), db=krawings, Odoo 18 (NOT 15)
- `hr.applicant` requires `candidate_id` (hr.candidate model) — must create hr.candidate + res.partner first

### Phase 2: Portal Candidate Infrastructure (deployed)
- **DB migration**: Added `applicant_id` and `must_change_password` columns to `portal_users`
- **API: POST /api/hr/recruitment/create-access** — manager creates portal account for applicant, generates temp password, sends welcome email
- **API: GET /api/hr/applicant/status** — returns candidate's pipeline stage + gate permissions
- **Login flow**: returns `must_change_password` + `is_candidate` flags; forced password change redirects to `/change-password?forced=1`; candidates redirect to `/hr`
- **Change password page**: forced mode with banner, clears `must_change_password` flag on success, redirects to `/hr`
- **CandidateStatus component** (`/src/components/hr/CandidateStatus.tsx`): pipeline progress visualization with stage dots, gate logic (onboarding unlocks at Contract Proposal stage)
- **HR page gate logic**: candidates (applicant_id, no employee_id) see CandidateStatus; employees see normal dashboard
- **Email**: `sendCandidateWelcomeEmail` in `/src/lib/email.ts` — SMTP not yet configured in .env.local (needs SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, PORTAL_URL)
- **Auth updates**: `/api/auth/me` returns `applicant_id`, `must_change_password`, `is_candidate`

### Phase 3: UI Fixes (deployed)
- **Hamburger top bar**: Hidden in immersive recipe screens via TopBarContext (`/src/components/ui/TopBarContext.tsx`). Provider wraps app in layout.tsx.
- **Bottom nav bar (AppTabBar)**: Also uses TopBarContext — visible everywhere except immersive recipe views
- **Immersive screens** (top bar + tab bar hidden): cooking board, cook mode, overview, batch-size, ingredient-check, active-recording, recording-summary, edit-step, edit-step-detail, cooking-guide browse, production-guide browse, record, create-dish, edit-browse, edit-overview, edit-metadata, edit-steps, approval-review
- **Non-immersive** (top bar + tab bar visible): dashboard, settings, stats, approvals
- **Home button**: removed from all immersive screens; restored on dashboard, cooking guide browse, production guide browse
- **Renamed**: "Kitchen Board" → "Cooking Board" (in ActiveSessions.tsx + debug map)
- **CookingGuideBrowse redesigned**: POS-style category tiles (3-col grid, colored, emoji icons) on top + quick picks speed buttons below. Search in dark header. Category drill-in view.

## Pending / Next Steps

### Immediate: Full Portal Audit (was about to start)
- Audit all modules for broken links, missing dependencies, illogical workflows
- **Hamburger menu (AppDrawer)** is missing some modules — needs to list ALL portal modules
- Check all navigation paths work end-to-end

### Still TODO for Recruitment
- **SMTP configuration** — add env vars to .env.local for email sending
- **Odoo custom module** (`krawings_recruitment`) — "Grant Portal Access" wizard on hr.applicant form view. When stage changes (drag in Kanban), prompt "Create portal access for [name]?"
- **Frequency tracking** for quick picks in CookingGuideBrowse (currently shows first 10 alphabetically)

**Why:** Building a complete hiring pipeline from application through onboarding, all managed through the portal.

**How to apply:** The recruitment pipeline connects Odoo's hr.applicant stages to portal access. Candidates get accounts via the create-access API, see their status via CandidateStatus, and unlock onboarding at Contract Proposal stage.
