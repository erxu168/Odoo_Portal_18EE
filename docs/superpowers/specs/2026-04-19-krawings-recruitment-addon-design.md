# krawings_recruitment Odoo Addon — Design Spec

> Add a "Grant Portal Access" button to the `hr.applicant` form/kanban in Odoo 18 EE so a manager can create a portal account for a candidate without leaving Odoo. Unblocks the onboarding pipeline described in PORTAL.md / [project_recruitment_pipeline.md](../../../.claude/projects/-Users-ethan-Odoo-Portal-18EE/memory/project_recruitment_pipeline.md).

**Status:** design only. Lives in the Odoo addons repo at `/opt/odoo/18.0/custom-addons/krawings_recruitment/`, not in this portal repo. Do NOT implement from this workspace.

---

## Problem

The Krawings Portal already has:

- `portal_users.applicant_id` column linking a portal account to an `hr.applicant`
- `POST /api/hr/recruitment/create-access` — accepts `{ applicant_id }`, creates a portal user, generates a temp password, sends the welcome email, and audit-logs the action
- `GET /api/hr/applicant/status` — the candidate-facing pipeline + onboarding gate
- `CandidateStatus` component + onboarding wizard

What's missing is the **manager-facing trigger**. The `create-access` endpoint has no UI that a manager can reach — they'd have to curl it. The natural place is the recruitment Kanban in Odoo, where they already move candidates through stages.

## Goals

1. One-click "Grant Portal Access" on the `hr.applicant` form view.
2. Visible state on the applicant record: was access granted, when, by whom.
3. Idempotent — pressing the button twice surfaces "already granted" without creating a duplicate.
4. Fail-safe — if the portal is unreachable or returns an error, the manager sees a clear Odoo notification. No Odoo data mutation happens if the portal call fails.

## Non-goals (Phase 1)

- Auto-trigger on Kanban stage change. (Covered in "Phase 2" below.)
- Revoking access from Odoo. (Portal admin screen handles this.)
- Syncing candidate data (name/email) after access is granted. (Portal reads Odoo on demand.)
- Contract signing integration with Odoo Sign. (Separate design.)

---

## Architecture

```
┌─────────────────┐    HTTPS POST + Bearer    ┌──────────────────────────┐
│  Odoo 18 EE     │  ───────────────────────> │  Krawings Portal         │
│  hr.applicant   │                           │  /api/internal/hr/       │
│  form button    │  <─────────────────────── │    recruitment/          │
│                 │     JSON response         │    create-access         │
└─────────────────┘                           └──────────────────────────┘
       │                                               │
       │ write portal_access_granted=True              │ createUser(),
       │        portal_access_granted_at=now           │ sendWelcomeEmail(),
       │        portal_access_granted_by=uid           │ logAudit()
       ▼                                               ▼
   hr.applicant record                          portal_users (SQLite)
```

The Odoo addon calls the portal. Portal remains the authoritative store of portal users; Odoo only caches the "was access granted" bit so the button state can be rendered without polling.

---

## Part 1: Odoo custom module

### Module metadata

- **Name:** `krawings_recruitment`
- **Path:** `/opt/odoo/18.0/custom-addons/krawings_recruitment/`
- **Depends:** `hr_recruitment`, `mail`
- **Category:** Human Resources/Recruitment

### Model extension: `hr.applicant`

Add these fields (all stored, `tracking=True` for mail chatter):

| Field                           | Type                       | Description                                              |
|---------------------------------|----------------------------|----------------------------------------------------------|
| `portal_access_granted`         | Boolean                    | True once the portal returned success (default False).   |
| `portal_access_granted_at`      | Datetime                   | When the portal accepted the call.                       |
| `portal_access_granted_by_id`   | Many2one → `res.users`     | Odoo user who clicked the button.                        |
| `portal_user_id_external`       | Integer                    | Portal's `portal_users.id` (for cross-reference only).   |
| `portal_access_email_sent`      | Boolean                    | Mirrors the portal's `email_sent` response field.        |

No SQL constraints — this is a cache, not a source of truth. The portal is free to delete portal users without notifying Odoo; the button will just surface the right error on next click.

### Server action / method

```python
def action_grant_portal_access(self):
    self.ensure_one()
    # 1. Preconditions
    if not self.email_from:
        raise UserError(_("Applicant has no email — cannot grant portal access."))
    if self.portal_access_granted:
        raise UserError(_("Portal access was already granted on %s.") % self.portal_access_granted_at)

    # 2. POST to portal API
    url, token = self._get_portal_config()
    payload = {"applicant_id": self.id}
    resp = requests.post(
        f"{url}/api/internal/hr/recruitment/create-access",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )

    # 3. Handle response — never mutate Odoo on failure
    if resp.status_code == 409:
        # Portal already has this applicant or email. Reconcile the cache flag.
        data = resp.json()
        self.write({
            'portal_access_granted': True,
            'portal_access_granted_at': fields.Datetime.now(),
            'portal_access_granted_by_id': self.env.user.id,
            'portal_user_id_external': data.get('portal_user_id'),
        })
        return self._notify(_("Portal account already existed — cache updated."), "warning")

    if resp.status_code != 200:
        error = self._extract_error(resp)
        raise UserError(_("Portal rejected the request: %s") % error)

    data = resp.json()
    self.write({
        'portal_access_granted': True,
        'portal_access_granted_at': fields.Datetime.now(),
        'portal_access_granted_by_id': self.env.user.id,
        'portal_user_id_external': data.get('portal_user_id'),
        'portal_access_email_sent': bool(data.get('email_sent')),
    })

    msg = _("Portal access granted. Welcome email sent to %s.") % self.email_from \
          if data.get('email_sent') \
          else _("Portal account created but welcome email failed. Temp password in portal audit log.")
    return self._notify(msg, "success")
```

Helper methods:

- `_get_portal_config()` — reads `ir.config_parameter`:
  - `krawings_recruitment.portal_url` — e.g. `http://89.167.124.0:3000`
  - `krawings_recruitment.portal_api_token` — shared secret matching the portal's env var
  - Raises `UserError` if either is missing.
- `_extract_error(resp)` — pulls `resp.json().get('error')` with a fallback to `resp.text[:200]`.
- `_notify(message, type_)` — returns a standard client notification action dict.

### View: form button

In `views/hr_applicant_views.xml`, inherit `hr_recruitment.crm_case_form_view_job`:

```xml
<record id="hr_applicant_form_portal_access" model="ir.ui.view">
    <field name="name">hr.applicant.form.portal-access</field>
    <field name="model">hr.applicant</field>
    <field name="inherit_id" ref="hr_recruitment.crm_case_form_view_job"/>
    <field name="arch" type="xml">
        <xpath expr="//header" position="inside">
            <button name="action_grant_portal_access"
                    string="Grant Portal Access"
                    type="object"
                    class="btn-primary"
                    invisible="portal_access_granted or not email_from"
                    groups="hr_recruitment.group_hr_recruitment_user"/>
            <button name="action_grant_portal_access"
                    string="Resend Welcome Email"
                    type="object"
                    invisible="not portal_access_granted"
                    groups="hr_recruitment.group_hr_recruitment_manager"/>
        </xpath>

        <xpath expr="//sheet/group" position="after">
            <group string="Portal Access" invisible="not portal_access_granted">
                <field name="portal_access_granted"/>
                <field name="portal_access_granted_at"/>
                <field name="portal_access_granted_by_id"/>
                <field name="portal_access_email_sent"/>
                <field name="portal_user_id_external" string="Portal user ID"/>
            </group>
        </xpath>
    </field>
</record>
```

Visibility rules:

- **"Grant Portal Access"** button — visible when `portal_access_granted=False` AND `email_from` is set, for recruiters + managers.
- **"Resend Welcome Email"** button — visible when `portal_access_granted=True`, for managers only. (Phase 1 stub — Phase 2 will actually wire the resend endpoint.)
- **Portal Access group** — a read-only status block on the applicant sheet, only visible once access was granted.

### Kanban badge

In `views/hr_applicant_kanban.xml`, inherit the recruitment kanban:

```xml
<xpath expr="//div[contains(@class,'o_kanban_record_bottom')]" position="inside">
    <div t-if="record.portal_access_granted.raw_value"
         class="badge text-bg-success" title="Portal access granted">
        <i class="fa fa-check"/> Portal
    </div>
</xpath>
```

One glance per card: does this candidate already have portal access.

### Security

- `ir.model.access.csv` — grant read/write on the new fields to `hr_recruitment.group_hr_recruitment_user` + `hr_recruitment.group_hr_recruitment_manager`.
- Config parameter keys are stored in `ir.config_parameter` which is already admin-gated.
- API token is never logged. `_get_portal_config` must not appear in `_logger.info` calls.

### Manifest

```python
{
    'name': 'Krawings Recruitment',
    'version': '18.0.1.0.0',
    'category': 'Human Resources/Recruitment',
    'summary': 'Grant portal access to hr.applicant candidates',
    'depends': ['hr_recruitment', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'data/ir_config_parameter_template.xml',
        'views/hr_applicant_views.xml',
        'views/hr_applicant_kanban.xml',
    ],
    'license': 'LGPL-3',
    'installable': True,
    'application': False,
}
```

`data/ir_config_parameter_template.xml` seeds **empty** keys so an admin sees them in Settings → Technical → System Parameters and knows to fill them. The install must not ship a real token.

---

## Part 2: Portal changes (this repo)

### New endpoint: `POST /api/internal/hr/recruitment/create-access`

- Mirrors the logic of the existing `POST /api/hr/recruitment/create-access`, but **authenticates via a Bearer token header** instead of the session cookie.
- Path lives under `/api/internal/…` to make it obvious it's not user-facing and to give the middleware a clear prefix to route differently (no CORS, no browser session).
- Token is read from `process.env.KRAWINGS_INTERNAL_API_TOKEN` and compared with `crypto.timingSafeEqual`.
- Request body + response body identical to the existing endpoint — so the shared helper is hoisted into `src/lib/hr/recruitment.ts` and called from both routes.
- Audit log entry attributes the action to a synthetic user `{ id: 0, name: "odoo:<uid>" }` where `<uid>` comes from an optional `X-Odoo-User-Id` header the addon sends, so managers can still see who triggered it.

### New env var

In `/opt/krawings-portal/.env.local`:

```
KRAWINGS_INTERNAL_API_TOKEN=<32-byte random hex>
```

Same value goes into Odoo `ir.config_parameter` `krawings_recruitment.portal_api_token`. Rotation procedure: update both in the same maintenance window.

### Rate limiting

Both internal endpoints (`create-access` and the new `promote-to-employee` below) are rate-limited to **20 requests / minute / IP**, enforced in the Next.js route handler via an in-memory sliding-window counter keyed by `request.headers.get('x-forwarded-for')`. On breach: return `429 Too Many Requests` and log a warning including the token prefix (first 6 chars only). No persistent store — restart resets the window, which is fine for a leak-defense safety net.

### New endpoint: `POST /api/internal/hr/recruitment/promote-to-employee`

Called by Odoo when a candidate has their contract signed and is promoted to `hr.employee`. Tells the portal: "this applicant is now a real employee, here's their employee id".

Request body:
```json
{ "applicant_id": 123, "employee_id": 456 }
```

Behavior:

- Look up `portal_users` by `applicant_id`. If none, return `404`.
- Set `portal_users.employee_id = <employee_id>`, keep `applicant_id` (so we retain the audit trail of which application they came from).
- Audit log the promotion with the Odoo user id from `X-Odoo-User-Id` header.
- Response: `{ success: true, portal_user_id: <id> }`.

The existing portal HR page gate (`/src/app/hr/page.tsx`) already branches on `applicant_id` vs `employee_id` — once `employee_id` is set, the candidate stops seeing `CandidateStatus` and starts seeing the full employee dashboard. No frontend change needed.

### No frontend change

Managers still use Odoo for these actions. No portal UI is added for Phase 1.

---

## Acceptance criteria

1. Manager opens an `hr.applicant` record at Contract Proposal stage in Odoo. "Grant Portal Access" button is visible in the form header.
2. Manager clicks the button. Within ~2s, an Odoo success notification says "Portal access granted. Welcome email sent to <email>." and the form sheet shows the Portal Access group populated.
3. Candidate receives the welcome email, logs into the portal with the temp password, is forced to change password, and lands on `/hr` → CandidateStatus.
4. Manager clicks the button a second time (or opens another candidate with the same email): Odoo surfaces "Portal account already existed — cache updated." No duplicate portal user is created.
5. Portal API token in Odoo is wrong: Odoo surfaces "Portal rejected the request: Unauthorized" and makes no field changes on the applicant.
6. Portal is unreachable: Odoo surfaces "Portal rejected the request: Connection timeout" and makes no field changes.
7. Kanban card shows a green "Portal" badge for any candidate with `portal_access_granted=True`.

## Test plan

- **Unit (Odoo):** Mock `requests.post` to return 200 / 409 / 500 / timeout; assert field writes only on 200 and 409.
- **Unit (portal):** Test `/api/internal/hr/recruitment/create-access` with correct token, wrong token, missing token, replayed request.
- **Integration:** Install addon on staging, set token on both sides, run through Acceptance criteria 1–6.
- **Regression:** Existing `/api/hr/recruitment/create-access` (cookie-authed) still works for any future portal-side UI.

## Rollback

- Portal: remove `src/app/api/internal/hr/recruitment/create-access/route.ts` + unset the env var. Existing cookie-authed route is untouched, so onboarding still works if a manager calls it directly.
- Odoo: uninstall `krawings_recruitment`. The five fields on `hr.applicant` become orphaned (Odoo keeps them as inactive columns) but nothing else is affected.

---

## Hire-time Odoo hook (Phase 1, part of this spec)

When a candidate's stage moves to **Contract Signed** AND an `hr.employee` record has been created for them (standard Odoo recruitment flow does this via the "Create Employee" button), the addon must call `POST /api/internal/hr/recruitment/promote-to-employee` with `{ applicant_id, employee_id }`.

Hook location: override `hr.applicant.write` in the addon. When `stage_id` changes and the new stage's normalized name is `contract_signed`, and `self.employee_id` is truthy, make the call. Store the outcome on two new cache fields:

| Field                        | Type       | Description                                        |
|------------------------------|------------|----------------------------------------------------|
| `portal_employee_linked`     | Boolean    | True once portal confirmed the promotion.          |
| `portal_employee_linked_at`  | Datetime   | When portal accepted the call.                     |

If the call fails (portal down, 404 because no portal user exists, etc.), log a warning to the applicant's mail thread and leave the cache flags False. A manual "Link to portal employee" button on the applicant form lets a manager retry later. The button is only visible when `stage_id` normalizes to `contract_signed`, `employee_id` is set, and `portal_employee_linked=False`.

## Decisions locked (2026-04-19)

1. **Hire-time callback** — yes, Odoo tells the portal when a candidate is hired (see "Hire-time Odoo hook" above).
2. **Auth for internal endpoints** — shared bearer token only. No portal role mapping layered on top.
3. **Rate limit** — 20 requests / minute / IP on all `/api/internal/hr/recruitment/*` endpoints.

## Phase 2 (out of scope for this spec)

- **Auto-trigger on stage change:** override `hr.applicant.write` so that moving to Contract Proposal opens a confirmation wizard ("Create portal access for <name>?"). Keep the manual button as a fallback.
- **Resend welcome email:** portal endpoint `POST /api/internal/hr/recruitment/resend-welcome` that re-generates a temp password (sets `must_change_password=True`) and re-sends the email. Wire the existing Odoo button to it.
- **Revoke access:** button + portal endpoint that deactivates the portal user and clears `portal_access_granted`.
- **Contract sign URL feedback:** portal calls back into Odoo to attach the `sign.request` URL to `hr.applicant` so the candidate and the manager see the same link.
