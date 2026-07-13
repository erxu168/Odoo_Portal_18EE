{
    "name": "Krawings - POS Close Register Access",
    "version": "18.0.1.0.0",
    "summary": "Let every POS user close the register (incl. cash difference) without POS Manager rights",
    "description": "Grants all Point of Sale users the right to close the register / POS session even when the counted cash differs from the expected amount, without making them POS Managers (no backend or admin access). Adds a dedicated security group, Close Register (cash difference allowed), implied by Point of Sale / User so every POS-login staff member gets it (existing users included, applied on install). Overrides pos.session.get_closing_control_data to report is_manager=True for that group; in Odoo 18 is_manager gates only the close-with-cash-difference action (closing_popup.js hasUserAuthority), so no other manager-only capability is exposed. See the README for details.",
    "author": "Krawings",
    "license": "LGPL-3",
    "category": "Point of Sale",
    "depends": ["point_of_sale"],
    "data": [
        "security/pos_close_register_groups.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
