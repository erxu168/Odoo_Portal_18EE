"""Unit tests for the Mise en place "Station Setup Guide" feature.

Covers (spec docs/superpowers/specs/2026-07-18-mise-en-place-setup-guide-design.md §10):
  - spawn copies the guide flag, a per-day photo snapshot, and pin coordinates;
  - toggling pins via portal_toggle_subtask auto-completes with attribution,
    unchecking reopens, and the toggle validates line/company/past-date;
  - manual mark_done is rejected while pins remain;
  - the setup photo (res_field-backed) never counts as a proof photo nor
    appears in the generic attachment list;
  - photo_required guides complete only once a proof photo lands (resync);
  - catalog normalisation / idempotent add / reactivation / rename propagation.

Run (fresh scratch DB, never the live one):
  odoo-bin -d <scratch> -i krawings_task_manager --test-enable \
           --test-tags /krawings_task_manager --stop-after-init
"""
import base64

from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase

# Smallest valid JPEG (SOI + headers + EOI) — enough for a Binary field.
TINY_JPEG = base64.b64encode(bytes.fromhex(
    'ffd8ffe000104a46494600010100000100010000ffdb004300ffffffffffffffffffff'
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    'ffffffffffffffffffffffffffc00011080001000103012200021101031101ffc4001f'
    '0000010501010101010100000000000000000102030405060708090a0bffda000c0301'
    '0002110311003f00bf8001ffd9'
)).decode('ascii')


@tagged('post_install', '-at_install')
class TestSetupGuide(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env['res.company'].create({'name': 'SG Test Co'})
        cls.other_company = cls.env['res.company'].create({'name': 'SG Other Co'})
        cls.dept = cls.env['hr.department'].create({
            'name': 'SG Kitchen', 'company_id': cls.company.id,
        })
        cls.employee = cls.env['hr.employee'].create({
            'name': 'SG Hana', 'department_id': cls.dept.id, 'company_id': cls.company.id,
        })
        cls.Item = cls.env['krawings.task.item']
        cls.Template = cls.env['krawings.task.template']
        cls.ListLine = cls.env['krawings.task.list.line']

        cls.tpl = cls.Template.create({'name': 'SG Template', 'department_id': cls.dept.id})
        cls.tline = cls.env['krawings.task.template.line'].create({
            'template_id': cls.tpl.id,
            'name': 'Set up sauce station',
            'day_part': 'opening',
            'is_setup_guide': True,
            'setup_photo': TINY_JPEG,
            'setup_photo_filename': 'station.jpg',
        })
        cls.item_board = cls.Item.add_for_department(cls.dept.id, 'Cutting board')
        cls.env['krawings.task.template.subtask'].create([
            {'line_id': cls.tline.id, 'name': 'Cutting board', 'sequence': 10,
             'pin_x': 0.25, 'pin_y': 0.4, 'item_id': cls.item_board['id']},
            {'line_id': cls.tline.id, 'name': 'Sauce bottles', 'sequence': 20,
             'pin_x': 0.75, 'pin_y': 0.55},
        ])

    def _spawn_today(self):
        from odoo import fields as f
        task_list = self.Template._build_list_for_dept_date(self.dept, f.Date.context_today(self.Template))
        self.assertTrue(task_list, 'spawn must create a list')
        return task_list

    def _guide_line(self, task_list):
        line = task_list.line_ids.filtered(lambda l: l.source_template_line_id == self.tline)
        self.assertEqual(len(line), 1)
        return line

    # ── Spawn snapshot ───────────────────────────────────────────────────

    def test_spawn_copies_flag_photo_and_pins(self):
        line = self._guide_line(self._spawn_today())
        self.assertTrue(line.is_setup_guide)
        self.assertEqual(line.setup_photo_filename, 'station.jpg')
        self.assertEqual(line.setup_photo, self.tline.setup_photo,
                         'daily line must carry its own snapshot of the photo')
        pins = line.subtask_ids.sorted('sequence')
        self.assertEqual(len(pins), 2)
        self.assertAlmostEqual(pins[0].pin_x, 0.25)
        self.assertAlmostEqual(pins[1].pin_y, 0.55)
        # Editing the template photo later must NOT touch the spawned snapshot.
        self.tline.set_setup_photo(TINY_JPEG, 'new.jpg', clear_pins=False)
        self.assertEqual(line.setup_photo_filename, 'station.jpg')

    def test_pin_bounds_validated(self):
        with self.assertRaises(ValidationError):
            self.env['krawings.task.template.subtask'].create({
                'line_id': self.tline.id, 'name': 'Bad pin', 'pin_x': 1.2, 'pin_y': 0.5,
            })

    # ── Pin-driven completion ────────────────────────────────────────────

    def test_toggle_all_pins_autocompletes_and_uncheck_reopens(self):
        line = self._guide_line(self._spawn_today())
        pins = line.subtask_ids.sorted('sequence')
        r1 = self.ListLine.portal_toggle_subtask(line.id, pins[0].id, True, self.employee.id)
        self.assertTrue(r1['is_setup_guide'])
        self.assertFalse(r1['line_completed'], 'one unchecked pin must keep it pending')
        r2 = self.ListLine.portal_toggle_subtask(line.id, pins[1].id, True, self.employee.id)
        self.assertTrue(r2['line_completed'])
        self.assertTrue(line.completed_at)
        self.assertEqual(line.completed_by_id, self.employee,
                         'auto-complete must attribute the toggling employee')
        self.assertEqual(pins[0].toggled_by_id, self.employee)
        # Unchecking reopens (and clears completion attribution).
        r3 = self.ListLine.portal_toggle_subtask(line.id, pins[0].id, False, self.employee.id)
        self.assertFalse(r3['line_completed'])
        self.assertFalse(line.completed_at)
        self.assertFalse(line.completed_by_id)

    def test_manual_mark_done_rejected_while_pins_open(self):
        line = self._guide_line(self._spawn_today())
        with self.assertRaises(UserError):
            line.mark_done(self.employee.id)
        # After all pins, manual mark_done is a no-op-success (already completed).
        for pin in line.subtask_ids:
            self.ListLine.portal_toggle_subtask(line.id, pin.id, True, self.employee.id)
        self.assertTrue(line.mark_done(self.employee.id))

    def test_toggle_validates_line_company_and_past_date(self):
        task_list = self._spawn_today()
        line = self._guide_line(task_list)
        pin = line.subtask_ids[0]
        # Subtask must belong to the given line.
        other_line = self.env['krawings.task.list.line'].create({
            'list_id': task_list.id, 'name': 'Other task', 'day_part': 'opening',
        })
        with self.assertRaises(UserError):
            self.ListLine.portal_toggle_subtask(other_line.id, pin.id, True, self.employee.id)
        # Company scoping: an allowed-set excluding the line's company is refused.
        with self.assertRaises(UserError):
            self.ListLine.portal_toggle_subtask(
                line.id, pin.id, True, self.employee.id,
                allowed_company_ids=[self.other_company.id],
            )
        # Past lists are read-only.
        from odoo import fields as f
        task_list.write({'date': f.Date.subtract(f.Date.context_today(self.Template), days=1)})
        with self.assertRaises(UserError):
            self.ListLine.portal_toggle_subtask(line.id, pin.id, True, self.employee.id)

    def test_non_guide_subtasks_never_report_completion(self):
        task_list = self._spawn_today()
        plain = self.env['krawings.task.list.line'].create({
            'list_id': task_list.id, 'name': 'Plain task', 'day_part': 'opening',
        })
        sub = self.env['krawings.task.list.subtask'].create({
            'line_id': plain.id, 'name': 'only step',
        })
        res = self.ListLine.portal_toggle_subtask(plain.id, sub.id, True, self.employee.id)
        self.assertFalse(res['is_setup_guide'])
        self.assertFalse(res['line_completed'])
        self.assertFalse(plain.completed_at, 'plain subtasks must not auto-complete')

    # ── Photo gate + res_field separation ────────────────────────────────

    def test_setup_photo_is_not_a_proof_photo(self):
        line = self._guide_line(self._spawn_today())
        self.assertFalse(line.photo_uploaded,
                         'the field-backed setup photo must not satisfy photo_required')
        atts = self.ListLine.list_attachments([line.id])
        self.assertFalse(atts, 'setup photo must not appear in the generic attachment list')

    def test_photo_required_guide_completes_on_proof_via_resync(self):
        line = self._guide_line(self._spawn_today())
        line.write({'photo_required': True})
        for pin in line.subtask_ids:
            self.ListLine.portal_toggle_subtask(line.id, pin.id, True, self.employee.id)
        self.assertFalse(line.completed_at, 'photo gate must hold completion')
        line.add_attachment('proof.jpg', TINY_JPEG, 'image/jpeg')
        line.resync_setup_guide(self.employee.id)
        self.assertTrue(line.completed_at, 'proof photo + resync must complete the guide')

    def test_setup_photo_not_served_via_generic_attachment_fetch(self):
        line = self._guide_line(self._spawn_today())
        att = self.env['ir.attachment'].sudo().search([
            ('res_model', '=', 'krawings.task.list.line'),
            ('res_id', '=', line.id),
            ('res_field', '=', 'setup_photo'),
        ], limit=1)
        self.assertTrue(att, 'binary attachment=True must store an ir.attachment')
        self.assertFalse(self.ListLine.get_attachment_data(att.id))

    def test_get_setup_photo_company_scoped(self):
        line = self._guide_line(self._spawn_today())
        ok = self.ListLine.get_setup_photo(line.id, [self.company.id])
        self.assertTrue(ok and ok['filename'] == 'station.jpg')
        denied = self.ListLine.get_setup_photo(line.id, [self.other_company.id])
        self.assertFalse(denied)

    # ── Catalog ──────────────────────────────────────────────────────────

    def test_catalog_normalise_idempotent_reactivate(self):
        a = self.Item.add_for_department(self.dept.id, '  Sauce   Bottles ')
        self.assertEqual(a['name'], 'Sauce Bottles')
        again = self.Item.add_for_department(self.dept.id, 'sauce bottles')
        self.assertEqual(again['id'], a['id'], 're-adding the same normalised name must be idempotent')
        rec = self.Item.browse(a['id'])
        rec.deactivate()
        self.assertNotIn(a['id'], [i['id'] for i in self.Item.list_for_department(self.dept.id)])
        revived = self.Item.add_for_department(self.dept.id, 'SAUCE BOTTLES')
        self.assertEqual(revived['id'], a['id'], 're-adding an archived name must reactivate it')
        self.assertTrue(rec.active)
        with self.assertRaises(UserError):
            self.Item.add_for_department(self.dept.id, '   ')

    def test_catalog_rename_propagates_to_template_pins_only(self):
        daily = self._guide_line(self._spawn_today())
        item = self.Item.browse(self.item_board['id'])
        item.rename('Chopping board')
        tpl_pin = self.tline.subtask_ids.filtered(lambda s: s.item_id == item)
        self.assertEqual(tpl_pin.name, 'Chopping board', 'template pins follow the rename')
        self.assertIn('Cutting board', daily.subtask_ids.mapped('name'),
                      'already-spawned daily subtasks keep their historical label')
        # Rename clash with another active item is refused.
        self.Item.add_for_department(self.dept.id, 'Tongs')
        with self.assertRaises(UserError):
            item.rename('tongs')
