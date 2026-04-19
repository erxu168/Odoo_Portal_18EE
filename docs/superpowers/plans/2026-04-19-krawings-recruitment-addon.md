# Build Plan — `krawings_recruitment` Odoo addon

> Step-by-step plan for building the Odoo side of the onboarding bridge. The **portal side** (internal endpoints + rate limiting) is already implemented in the portal repo; this plan is for the Odoo addon workspace at `/opt/odoo/18.0/custom-addons/krawings_recruitment/`.
>
> Spec: [2026-04-19-krawings-recruitment-addon-design.md](../specs/2026-04-19-krawings-recruitment-addon-design.md)

## Prerequisites

- Portal deployed with commits from branch `feat/onboarding-odoo-bridge`:
  - `src/lib/rate-limit.ts`
  - `src/lib/hr/recruitment.ts`
  - `src/app/api/internal/hr/recruitment/create-access/route.ts`
  - `src/app/api/internal/hr/recruitment/promote-to-employee/route.ts`
- `KRAWINGS_INTERNAL_API_TOKEN` set in `/opt/krawings-portal/.env.local` (32-byte hex). Generate with `openssl rand -hex 32`.
- Portal service restarted.

## Phase 1 — Scaffold addon

Create folder `/opt/odoo/18.0/custom-addons/krawings_recruitment/` with:

```
krawings_recruitment/
├── __init__.py
├── __manifest__.py
├── models/
│   ├── __init__.py
│   └── hr_applicant.py
├── views/
│   ├── hr_applicant_views.xml
│   └── hr_applicant_kanban.xml
├── security/
│   └── ir.model.access.csv
├── data/
│   └── ir_config_parameter_template.xml
└── README.md
```

## Phase 2 — Files

### `__manifest__.py`

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

### `__init__.py`

```python
from . import models
```

### `models/__init__.py`

```python
from . import hr_applicant
```

### `models/hr_applicant.py`

```python
import logging
import requests
from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class HrApplicant(models.Model):
    _inherit = 'hr.applicant'

    portal_access_granted = fields.Boolean(
        string='Portal Access Granted',
        tracking=True,
        copy=False,
        help='True once the Krawings Portal confirmed the account was created.',
    )
    portal_access_granted_at = fields.Datetime(
        string='Access Granted At',
        readonly=True,
        copy=False,
    )
    portal_access_granted_by_id = fields.Many2one(
        'res.users',
        string='Access Granted By',
        readonly=True,
        copy=False,
    )
    portal_user_id_external = fields.Integer(
        string='Portal User ID',
        readonly=True,
        copy=False,
        help='Cache of portal_users.id for cross-reference.',
    )
    portal_access_email_sent = fields.Boolean(
        string='Welcome Email Sent',
        readonly=True,
        copy=False,
    )
    portal_employee_linked = fields.Boolean(
        string='Portal Linked to Employee',
        readonly=True,
        copy=False,
        help='True once the portal stamped employee_id onto the candidate\'s portal user.',
    )
    portal_employee_linked_at = fields.Datetime(
        string='Portal Linked At',
        readonly=True,
        copy=False,
    )

    # ── Config ────────────────────────────────────────────

    def _get_portal_config(self):
        ICP = self.env['ir.config_parameter'].sudo()
        url = ICP.get_param('krawings_recruitment.portal_url', '').rstrip('/')
        token = ICP.get_param('krawings_recruitment.portal_api_token', '')
        if not url or not token:
            raise UserError(_(
                'Portal URL and API token must be configured in '
                'Settings → Technical → System Parameters '
                '(keys: krawings_recruitment.portal_url, krawings_recruitment.portal_api_token).'
            ))
        return url, token

    def _portal_headers(self):
        _url, token = self._get_portal_config()
        return {
            'Authorization': f'Bearer {token}',
            'X-Odoo-User-Id': str(self.env.user.id),
            'Content-Type': 'application/json',
        }

    def _notify(self, message, level='success'):
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Portal'),
                'message': message,
                'type': level,
                'sticky': level in ('warning', 'danger'),
            },
        }

    # ── Action: Grant portal access ───────────────────────

    def action_grant_portal_access(self):
        self.ensure_one()
        if not self.email_from:
            raise UserError(_('Applicant has no email — cannot grant portal access.'))

        url, _token = self._get_portal_config()
        endpoint = f'{url}/api/internal/hr/recruitment/create-access'

        try:
            resp = requests.post(
                endpoint,
                json={'applicant_id': self.id},
                headers=self._portal_headers(),
                timeout=10,
            )
        except requests.exceptions.RequestException as e:
            _logger.warning('Portal create-access call failed for applicant %s: %s', self.id, e)
            raise UserError(_('Portal is unreachable: %s') % str(e)[:200])

        if resp.status_code == 409:
            data = resp.json() if resp.content else {}
            self.write({
                'portal_access_granted': True,
                'portal_access_granted_at': fields.Datetime.now(),
                'portal_access_granted_by_id': self.env.user.id,
                'portal_user_id_external': data.get('portal_user_id') or 0,
            })
            return self._notify(
                _('Portal account already existed — cache updated.'),
                level='warning',
            )

        if resp.status_code != 200:
            error = (resp.json().get('error') if resp.content else None) or resp.text[:200]
            raise UserError(_('Portal rejected the request: %s') % error)

        data = resp.json()
        self.write({
            'portal_access_granted': True,
            'portal_access_granted_at': fields.Datetime.now(),
            'portal_access_granted_by_id': self.env.user.id,
            'portal_user_id_external': data.get('portal_user_id') or 0,
            'portal_access_email_sent': bool(data.get('email_sent')),
        })

        if data.get('email_sent'):
            msg = _('Portal access granted. Welcome email sent to %s.') % self.email_from
            level = 'success'
        else:
            msg = _('Portal account created but welcome email failed — check the portal audit log for the temp password.')
            level = 'warning'
        return self._notify(msg, level=level)

    # ── Action: Link portal to hr.employee (manual retry) ─

    def action_link_portal_employee(self):
        self.ensure_one()
        if not self.employee_id:
            raise UserError(_('No employee record yet — hire the candidate first.'))
        self._call_promote_to_employee()
        return self._notify(_('Portal user linked to employee %s.') % self.employee_id.name)

    def _call_promote_to_employee(self):
        self.ensure_one()
        url, _token = self._get_portal_config()
        endpoint = f'{url}/api/internal/hr/recruitment/promote-to-employee'
        try:
            resp = requests.post(
                endpoint,
                json={'applicant_id': self.id, 'employee_id': self.employee_id.id},
                headers=self._portal_headers(),
                timeout=10,
            )
        except requests.exceptions.RequestException as e:
            _logger.warning('Portal promote call failed for applicant %s: %s', self.id, e)
            raise UserError(_('Portal is unreachable: %s') % str(e)[:200])

        if resp.status_code == 404:
            raise UserError(_(
                'Portal has no user linked to this applicant. '
                'Grant portal access first, then retry.'
            ))
        if resp.status_code != 200:
            error = (resp.json().get('error') if resp.content else None) or resp.text[:200]
            raise UserError(_('Portal rejected the request: %s') % error)

        self.write({
            'portal_employee_linked': True,
            'portal_employee_linked_at': fields.Datetime.now(),
        })

    # ── Auto-hook: promote on contract_signed ─────────────

    def write(self, vals):
        result = super().write(vals)
        if 'stage_id' in vals or 'employee_id' in vals:
            for rec in self:
                rec._maybe_auto_promote()
        return result

    def _maybe_auto_promote(self):
        if self.portal_employee_linked:
            return
        if not self.employee_id:
            return
        if not self.stage_id:
            return
        stage_key = (self.stage_id.name or '').lower().strip().replace(' ', '_')
        if stage_key != 'contract_signed':
            return
        # Best-effort — if the portal is down, log to the mail thread
        # and let the manager retry via the manual button.
        try:
            self._call_promote_to_employee()
            self.message_post(body=_('Portal user linked to employee (auto on Contract Signed).'))
        except UserError as e:
            self.message_post(body=_('Could not link portal user automatically: %s') % e.args[0])
            _logger.warning('Auto-promote failed for applicant %s: %s', self.id, e)
```

### `views/hr_applicant_views.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
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
                <button name="action_link_portal_employee"
                        string="Link Portal to Employee"
                        type="object"
                        invisible="portal_employee_linked or not employee_id or not portal_access_granted"
                        groups="hr_recruitment.group_hr_recruitment_user"/>
            </xpath>

            <xpath expr="//sheet/group" position="after">
                <group string="Portal Access" invisible="not portal_access_granted">
                    <field name="portal_access_granted"/>
                    <field name="portal_access_granted_at"/>
                    <field name="portal_access_granted_by_id"/>
                    <field name="portal_access_email_sent"/>
                    <field name="portal_user_id_external" string="Portal user ID"/>
                    <field name="portal_employee_linked"/>
                    <field name="portal_employee_linked_at"/>
                </group>
            </xpath>

        </field>
    </record>
</odoo>
```

### `views/hr_applicant_kanban.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="hr_applicant_kanban_portal_badge" model="ir.ui.view">
        <field name="name">hr.applicant.kanban.portal-badge</field>
        <field name="model">hr.applicant</field>
        <field name="inherit_id" ref="hr_recruitment.crm_case_kanban_view_job"/>
        <field name="arch" type="xml">
            <xpath expr="//div[hasclass('o_kanban_record_bottom')]" position="inside">
                <div t-if="record.portal_access_granted.raw_value"
                     class="badge text-bg-success ms-1"
                     title="Portal access granted">
                    <i class="fa fa-check"/> Portal
                </div>
            </xpath>
            <field name="portal_access_granted" invisible="1"/>
        </field>
    </record>
</odoo>
```

### `security/ir.model.access.csv`

```csv
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_hr_applicant_portal_recruiter,hr.applicant.portal.recruiter,hr_recruitment.model_hr_applicant,hr_recruitment.group_hr_recruitment_user,1,1,0,0
access_hr_applicant_portal_manager,hr.applicant.portal.manager,hr_recruitment.model_hr_applicant,hr_recruitment.group_hr_recruitment_manager,1,1,1,1
```

### `data/ir_config_parameter_template.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo noupdate="1">
    <record id="portal_url_param" model="ir.config_parameter">
        <field name="key">krawings_recruitment.portal_url</field>
        <field name="value"></field>
    </record>
    <record id="portal_api_token_param" model="ir.config_parameter">
        <field name="key">krawings_recruitment.portal_api_token</field>
        <field name="value"></field>
    </record>
</odoo>
```

### `README.md`

```markdown
# krawings_recruitment

Adds a "Grant Portal Access" button on hr.applicant that creates a portal
account for the candidate via the Krawings Portal internal API.

## Config

Settings → Technical → System Parameters:

- `krawings_recruitment.portal_url` — e.g. `http://89.167.124.0:3000`
- `krawings_recruitment.portal_api_token` — must match the portal's
  `KRAWINGS_INTERNAL_API_TOKEN` env var

## Install

1. Drop the folder into `/opt/odoo/18.0/custom-addons/`
2. Update app list, search "Krawings Recruitment", install
3. Fill the two config parameters above
4. Open any hr.applicant — button appears in the header
```

## Phase 3 — Install + smoke test

1. `ssh root@89.167.124.0 'systemctl restart odoo-18'`
2. Odoo → Apps → Update Apps List → search "Krawings Recruitment" → Install
3. Settings → Technical → System Parameters, fill:
   - `krawings_recruitment.portal_url` = `http://89.167.124.0:3000`
   - `krawings_recruitment.portal_api_token` = (matches portal `.env.local`)
4. Open any test hr.applicant with an email address — "Grant Portal Access" button should appear.
5. Click it. Expected:
   - Green notification "Portal access granted. Welcome email sent to …"
   - "Portal Access" group appears on the form with timestamps
   - Green "Portal" badge on the kanban card
   - Portal login with temp password works, forces password change
6. Click it again (or open another applicant with the same email): yellow notification "Portal account already existed — cache updated."
7. Move the applicant to "Contract Signed" after creating an employee record: message appears in the mail thread: "Portal user linked to employee (auto on Contract Signed)."

## Phase 4 — Rollback

If anything misbehaves:

1. Odoo → Apps → Krawings Recruitment → Uninstall (removes the five cache fields; portal state is untouched)
2. Portal: leave the internal routes in place — they're harmless without Odoo calling them

## Out of scope for this plan

- Auto-trigger wizard on Contract Proposal (Phase 2 in spec)
- Resend welcome email endpoint (Phase 2)
- Revoke access button (Phase 2)
- Contract sign URL feedback (Phase 2)
