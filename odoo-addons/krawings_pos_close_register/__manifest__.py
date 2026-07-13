{
    "name": "Krawings - POS Close Register Access",
    "version": "18.0.1.0.0",
    "summary": "Let every POS user close the register (incl. cash difference) without POS Manager rights",
    "description": """
Grants all Point of Sale users the right to close the register / POS session
even when the counted cash differs from the expected amount — WITHOUT making
them POS Managers (no backend / admin access).

How it works:
- Adds a dedicated security group "Close Register (cash difference allowed)".
- That group is implied by "Point of Sale / User", so every staff member who
  can log into the POS automatically gets it. Odoo propagates implied groups to
  existing Point of Sale / User members when the link is written, so current
  staff are covered on install — not just users created afterwards.
- Overrides pos.session.get_closing_control_data to report is_manager=True for
  members of the new group. In Odoo 18 the closing popup uses is_manager for
  exactly one thing — allowing a close when there is a cash difference
  (closing_popup.js -> hasUserAuthority) — so no other manager-only capability
  is exposed.
""",
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
