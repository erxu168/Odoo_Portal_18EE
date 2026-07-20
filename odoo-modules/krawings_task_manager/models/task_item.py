import re

from odoo import api, fields, models
from odoo.exceptions import UserError


def _normalize_name_key(name):
    """Trimmed, lower-cased, internal whitespace collapsed. Used as the
    uniqueness key. Computed server-side — do NOT rely on Char(trim=True),
    which only trims client-side and would let duplicates slip through RPC."""
    return re.sub(r'\s+', ' ', (name or '').strip()).lower()


def _display_name(name):
    """Collapse whitespace but keep the manager's casing for display."""
    return re.sub(r'\s+', ' ', (name or '').strip())


class KrawingsTaskItem(models.Model):
    """Reusable, per-department catalog of station-setup item labels. Pins on a
    setup-guide reference these so managers pick from a maintained list instead
    of retyping. Names are denormalised onto the pin subtasks for history."""
    _name = 'krawings.task.item'
    _description = 'Station Setup Item (per-department catalog)'
    _order = 'name'

    department_id = fields.Many2one(
        'hr.department', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    name_key = fields.Char(
        index=True, help='Normalised uniqueness key (trimmed, lower, collapsed whitespace).',
    )
    active = fields.Boolean(default=True)

    _sql_constraints = [
        ('uniq_dept_namekey', 'unique(department_id, name_key)',
         'This item already exists for this department.'),
    ]

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name'):
                vals['name'] = _display_name(vals['name'])
                vals['name_key'] = _normalize_name_key(vals['name'])
        return super().create(vals_list)

    def write(self, vals):
        if vals.get('name'):
            vals['name'] = _display_name(vals['name'])
            vals['name_key'] = _normalize_name_key(vals['name'])
        return super().write(vals)

    # ── Portal helpers (sudo'd by the portal RPC user) ───────────────────

    @api.model
    def list_for_department(self, department_id):
        """Active catalog items for a department, name-sorted."""
        if not department_id:
            return []
        recs = self.sudo().search(
            [('department_id', '=', int(department_id)), ('active', '=', True)],
            order='name',
        )
        return [{'id': r.id, 'name': r.name} for r in recs]

    @api.model
    def add_for_department(self, department_id, name):
        """Idempotent add. Returns {'id', 'name'}.
          - re-adding an existing ACTIVE name returns it unchanged;
          - re-adding an INACTIVE name reactivates it (never violates the
            (department, name_key) unique constraint).
        """
        department_id = int(department_id)
        key = _normalize_name_key(name)
        if not key:
            raise UserError('Item name cannot be empty.')
        # active_test=False so we also find archived rows occupying the unique slot.
        existing = self.sudo().with_context(active_test=False).search([
            ('department_id', '=', department_id),
            ('name_key', '=', key),
        ], limit=1)
        if existing:
            vals = {}
            if not existing.active:
                vals['active'] = True
            display = _display_name(name)
            if display and display != existing.name:
                vals['name'] = display
            if vals:
                existing.write(vals)
            return {'id': existing.id, 'name': existing.name}
        rec = self.sudo().create({'department_id': department_id, 'name': _display_name(name)})
        return {'id': rec.id, 'name': rec.name}

    def rename(self, new_name):
        """Rename this item and propagate the new label to linked TEMPLATE pins,
        so future spawns use it. Names on already-spawned daily subtasks are left
        as-is (immutable history)."""
        self.ensure_one()
        display = _display_name(new_name)
        if not display:
            raise UserError('Item name cannot be empty.')
        key = _normalize_name_key(display)
        clash = self.sudo().with_context(active_test=False).search([
            ('department_id', '=', self.department_id.id),
            ('name_key', '=', key),
            ('id', '!=', self.id),
        ], limit=1)
        if clash:
            raise UserError('Another item with this name already exists for this department.')
        self.write({'name': display})
        tpl_pins = self.env['krawings.task.template.subtask'].sudo().search(
            [('item_id', '=', self.id)],
        )
        if tpl_pins:
            tpl_pins.write({'name': display})
        return {'id': self.id, 'name': self.name}

    def deactivate(self):
        """Archive an item — pins keep their denormalised name; item_id is left
        to Odoo's ondelete='set null' only on hard delete. Hidden from pickers."""
        self.ensure_one()
        self.write({'active': False})
        return True
