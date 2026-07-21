"""Move legacy single setup photos (Binary on the line) into the new
krawings.task.setup.photo rows (sequence 0). Pins default pin_photo_seq=0,
so they stay attached to the migrated photo. The legacy Binary is cleared
afterwards so the bytes aren't stored twice."""
from odoo import api, SUPERUSER_ID


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    Photo = env['krawings.task.setup.photo']
    for model, parent_field in (
        ('krawings.task.template.line', 'template_line_id'),
        ('krawings.task.list.line', 'list_line_id'),
    ):
        lines = env[model].with_context(active_test=False).search([
            ('setup_photo', '!=', False),
        ])
        for line in lines:
            if not Photo.search_count([(parent_field, '=', line.id)]):
                Photo.create({
                    parent_field: line.id,
                    'sequence': 0,
                    'image': line.setup_photo,
                    'filename': line.setup_photo_filename or False,
                })
            line.write({'setup_photo': False, 'setup_photo_filename': False})
