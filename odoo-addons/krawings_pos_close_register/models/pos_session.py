from odoo import models


class PosSession(models.Model):
    _inherit = "pos.session"

    def get_closing_control_data(self):
        """Allow non-manager POS users to close a session that has a cash difference.

        In Odoo 18 the closing popup gates *only* the "close with a cash
        difference" action on the ``is_manager`` flag returned here
        (see point_of_sale/static/src/app/navbar/closing_popup/closing_popup.js
        -> ``hasUserAuthority``). Members of ``group_pos_close_register`` get
        that same authority without being granted POS Manager: no backend/admin
        rights and no other manager-only UI, because ``is_manager`` is not used
        for anything else in the close flow.
        """
        data = super().get_closing_control_data()
        if self.env.user.has_group(
            "krawings_pos_close_register.group_pos_close_register"
        ):
            data["is_manager"] = True
        return data
