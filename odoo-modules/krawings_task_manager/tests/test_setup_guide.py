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
import importlib.util
import os

from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase


def _load_migration_6000():
    """Import the 18.0.6.0.0 post-migration module by path (migration dirs are
    not importable packages)."""
    path = os.path.join(
        os.path.dirname(__file__), '..', 'migrations', '18.0.6.0.0', 'post-migration.py')
    spec = importlib.util.spec_from_file_location('kw_tm_mig_6000', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

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
        })
        cls.tline.add_setup_photo(TINY_JPEG, 'station.jpg')       # → seq 0
        cls.item_board = cls.Item.add_for_department(cls.dept.id, 'Cutting board')
        cls.env['krawings.task.template.subtask'].create([
            {'line_id': cls.tline.id, 'name': 'Cutting board', 'sequence': 10,
             'pin_x': 0.25, 'pin_y': 0.4, 'pin_photo_seq': 0, 'item_id': cls.item_board['id']},
            {'line_id': cls.tline.id, 'name': 'Sauce bottles', 'sequence': 20,
             'pin_x': 0.75, 'pin_y': 0.55, 'pin_photo_seq': 0},
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
        photos = line.setup_photo_ids
        self.assertEqual(len(photos), 1)
        self.assertEqual(photos.sequence, 0)
        self.assertEqual(photos.filename, 'station.jpg')
        self.assertEqual(photos.image, self.tline.setup_photo_ids.image,
                         'daily line must carry its own snapshot of the photo')
        pins = line.subtask_ids.sorted('sequence')
        self.assertEqual(len(pins), 2)
        self.assertAlmostEqual(pins[0].pin_x, 0.25)
        self.assertAlmostEqual(pins[1].pin_y, 0.55)
        self.assertEqual(set(pins.mapped('pin_photo_seq')), {0})
        # Replacing the template photo later must NOT touch the spawned snapshot.
        self.tline.add_setup_photo(TINY_JPEG, 'new.jpg', seq=0)
        self.assertEqual(line.setup_photo_ids.filename, 'station.jpg')

    def test_multi_photo_spawn_and_removal(self):
        # Second photo + a pin on it.
        seq = self.tline.add_setup_photo(TINY_JPEG, 'shelf.jpg')
        self.assertEqual(seq, 1)
        self.env['krawings.task.template.subtask'].create({
            'line_id': self.tline.id, 'name': 'Labels', 'sequence': 30,
            'pin_x': 0.5, 'pin_y': 0.5, 'pin_photo_seq': 1,
        })
        line = self._guide_line(self._spawn_today())
        self.assertEqual(line.setup_photo_ids.mapped('sequence'), [0, 1],
                         'spawn must copy every photo with its sequence')
        self.assertEqual(
            line.subtask_ids.filtered(lambda s: s.pin_photo_seq == 1).mapped('name'),
            ['Labels'])
        # Per-seq portal read works on the daily copy.
        served = self.env['krawings.task.setup.photo'].get_photo(
            'list', line.id, 1, [self.company.id])
        self.assertEqual(served['filename'], 'shelf.jpg')
        # Removing template photo 1 drops it and ONLY its pin.
        self.tline.remove_setup_photo(1)
        self.assertEqual(self.tline.setup_photo_ids.mapped('sequence'), [0])
        self.assertEqual(len(self.tline.subtask_ids), 2)
        self.assertFalse(self.tline.subtask_ids.filtered(lambda s: s.pin_photo_seq == 1))

    def test_legacy_set_setup_photo_writes_photo_row(self):
        tline2 = self.env['krawings.task.template.line'].create({
            'template_id': self.tpl.id, 'name': 'Legacy guide',
            'day_part': 'opening', 'is_setup_guide': True,
        })
        tline2.set_setup_photo(TINY_JPEG, 'legacy.jpg')
        self.assertEqual(tline2.setup_photo_ids.mapped('sequence'), [0])
        served = self.env['krawings.task.template.line'].get_setup_photo(
            tline2.id, [self.company.id])
        self.assertEqual(served['filename'], 'legacy.jpg')

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
        self.assertTrue(line.setup_photo_ids, 'guide line must carry its snapshot photos')
        self.assertFalse(line.photo_uploaded,
                         'setup photos must not satisfy photo_required')
        atts = self.ListLine.list_attachments([line.id])
        self.assertFalse(atts, 'setup photos must not appear in the generic attachment list')

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
        # The photo binary lives on krawings.task.setup.photo (attachment=True).
        # NB: ir.attachment search silently excludes field-backed rows unless
        # res_field is referenced in the domain.
        att = self.env['ir.attachment'].sudo().search([
            ('res_model', '=', 'krawings.task.setup.photo'),
            ('res_id', 'in', line.setup_photo_ids.ids),
            ('res_field', '=', 'image'),
        ], limit=1)
        self.assertTrue(att, 'binary attachment=True must store an ir.attachment')
        self.assertFalse(self.ListLine.get_attachment_data(att.id),
                         'generic fetch must reject setup-photo attachments (foreign res_model)')

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

    # ── Fast-follow (audit) coverage ─────────────────────────────────────

    def test_migration_6000_moves_legacy_photo_and_is_idempotent(self):
        """18.0.6.0.0 moves the legacy setup_photo Binary into a seq-0 photo row,
        clears the legacy field, keeps seq-0 pins attached, and is safe to re-run."""
        legacy = self.env['krawings.task.template.line'].create({
            'template_id': self.tpl.id, 'name': 'Legacy line', 'day_part': 'opening',
            'is_setup_guide': True, 'setup_photo': TINY_JPEG, 'setup_photo_filename': 'old.jpg',
        })
        self.env['krawings.task.template.subtask'].create({
            'line_id': legacy.id, 'name': 'legacy pin', 'pin_photo_seq': 0, 'pin_x': 0.5, 'pin_y': 0.5,
        })
        self.assertFalse(legacy.setup_photo_ids)
        mig = _load_migration_6000()
        mig.migrate(self.env.cr, '18.0.6.0.0')
        legacy.invalidate_recordset()
        self.assertEqual(legacy.setup_photo_ids.mapped('sequence'), [0])
        self.assertEqual(legacy.setup_photo_ids.filename, 'old.jpg')
        self.assertFalse(legacy.setup_photo, 'legacy binary must be cleared after migration')
        self.assertEqual(legacy.subtask_ids.pin_photo_seq, 0, 'seq-0 pin stays attached')
        # Idempotent: a second run must not add a duplicate seq-0 row.
        mig.migrate(self.env.cr, '18.0.6.0.0')
        legacy.invalidate_recordset()
        self.assertEqual(len(legacy.setup_photo_ids), 1)

    def test_add_setup_photo_append_allocates_above_current_max(self):
        """Append (no seq) reads the CURRENT max sequence and allocates above it,
        so a photo another editor already committed is seen and never overwritten.
        (True lock contention needs concurrent transactions — integration-only;
        here we assert the allocation contract the FOR UPDATE + MAX path enforces.)"""
        s0 = self.tline.add_setup_photo(TINY_JPEG, 'a.jpg')          # existing station.jpg at 0 → 1
        s1 = self.tline.add_setup_photo(TINY_JPEG, 'b.jpg')
        self.assertEqual([s0, s1], [1, 2])
        # Simulate a concurrent editor having committed a photo at a higher seq.
        self.env['krawings.task.setup.photo'].sudo().create({
            'template_line_id': self.tline.id, 'sequence': 9, 'image': TINY_JPEG, 'filename': 'other.jpg'})
        before = len(self.tline.setup_photo_ids)
        s2 = self.tline.add_setup_photo(TINY_JPEG, 'mine.jpg')
        self.assertEqual(s2, 10, 'append must allocate ABOVE the highest existing seq')
        self.assertEqual(len(self.tline.setup_photo_ids), before + 1, 'nothing overwritten')
        self.assertEqual(
            self.tline.setup_photo_ids.filtered(lambda p: p.sequence == 9).filename, 'other.jpg',
            'the concurrently-added photo is untouched')

    def test_remove_non_last_photo_keeps_other_photos_and_pins(self):
        """Removing a NON-last photo drops only its pins; other photos + pins stay."""
        self.tline.add_setup_photo(TINY_JPEG, 'second.jpg')          # seq 1
        self.env['krawings.task.template.subtask'].create({
            'line_id': self.tline.id, 'name': 'On photo 1', 'pin_photo_seq': 1, 'pin_x': 0.4, 'pin_y': 0.4,
        })
        self.tline.remove_setup_photo(0)                             # remove the FIRST photo
        self.assertEqual(self.tline.setup_photo_ids.mapped('sequence'), [1])
        names = self.tline.subtask_ids.mapped('name')
        self.assertIn('On photo 1', names, 'pins on the surviving photo stay')
        self.assertNotIn('Cutting board', names, 'the removed photo’s pins are dropped')

    def test_photo_required_guide_reopens_when_proof_removed(self):
        """A completed photo_required guide reopens when its proof photo is deleted."""
        line = self._guide_line(self._spawn_today())
        line.write({'photo_required': True})
        for pin in line.subtask_ids:
            self.ListLine.portal_toggle_subtask(line.id, pin.id, True, self.employee.id)
        att = line.add_attachment('proof.jpg', TINY_JPEG, 'image/jpeg')
        line.resync_setup_guide(self.employee.id)
        self.assertTrue(line.completed_at)
        # Delete the proof, resync → the photo gate fails and the guide reopens.
        self.env['ir.attachment'].sudo().browse(att).unlink()
        line.resync_setup_guide(self.employee.id)
        self.assertFalse(line.completed_at, 'removing the only proof photo must reopen the guide')

    def test_setup_photo_record_rule_isolates_companies(self):
        """The setup.photo multi-company ir.rule hides another company's photo rows
        from a non-sudo user (record rules DON'T propagate through the M2O)."""
        # A guide photo owned by other_company.
        other_dept = self.env['hr.department'].create({
            'name': 'Other Kitchen', 'company_id': self.other_company.id})
        other_tpl = self.Template.create({'name': 'Other tpl', 'department_id': other_dept.id})
        other_line = self.env['krawings.task.template.line'].create({
            'template_id': other_tpl.id, 'name': 'Other guide', 'day_part': 'opening',
            'is_setup_guide': True})
        other_line.add_setup_photo(TINY_JPEG, 'other.jpg')
        photo = other_line.setup_photo_ids
        self.assertTrue(photo)
        # A plain user scoped to self.company must not see other_company's photo.
        user = self.env['res.users'].create({
            'name': 'SG Scoped', 'login': 'sg_scoped_user',
            'company_id': self.company.id, 'company_ids': [(6, 0, [self.company.id])],
            'groups_id': [(6, 0, [self.env.ref('base.group_user').id])],
        })
        visible = self.env['krawings.task.setup.photo'].with_user(user).search(
            [('id', '=', photo.id)])
        self.assertFalse(visible, 'record rule must hide another company’s setup photo')
