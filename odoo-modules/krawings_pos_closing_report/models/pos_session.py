from odoo import models, fields, api

class PosSession(models.Model):
    _inherit = 'pos.session'

    shift_report_issues = fields.Text(string="Any issues during shift?")
    shift_report_cleaning_done = fields.Boolean(string="Cleaning completed?", default=False)
    shift_report_notes = fields.Text(string="Additional Notes")

    @api.model
    def save_shift_report(self, session_id, report_data):
        """Called via RPC from POS UI to save the shift report before closing."""
        session = self.browse(session_id)
        if session.exists() and session.state not in ['closed']:
            session.write({
                'shift_report_issues': report_data.get('issues', ''),
                'shift_report_cleaning_done': report_data.get('cleaning_done', False),
                'shift_report_notes': report_data.get('notes', ''),
            })
        return True
