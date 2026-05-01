# Krawings Product Labels

Design and print product shelf labels to networked Zebra thermal printers.

## Status

**v0.1 — scaffold + Zebra Printer registry.**

This commit ships the foundations only: the module installs cleanly, you can
register Zebra printers (IP + port + company), and you can verify each one
with **Test Connection** / **Test Print**. Templates, fonts, the live
preview, and the **Print Labels** wizard land in follow-up commits.

## Roadmap (planned milestones)

| # | Deliverable | Status |
|---|---|---|
| 1 | Module scaffold | ✅ this commit |
| 2 | Zebra Printer model + test connection/print | ✅ this commit |
| 3 | Label Font model + upload-to-printer | pending |
| 4 | Label Template + Element models + form view | pending |
| 5 | ZPL builder utility (text, barcode, QR, logo) | pending |
| 6 | Live preview via labelary.com | pending |
| 7 | Print Labels wizard + product list action + PDF fallback | pending |
| 8 | Demo data, tests, role-based access polish | pending |

## Install

```
Apps → Update Apps List → search "Krawings Product Labels" → Install
```

Then go to **Inventory → Configuration → Zebra Printers** to add your
first printer.

## Requirements

- Odoo 18 EE
- A Zebra thermal printer reachable over TCP from the Odoo server (port 9100)
- (Future milestones) outbound HTTPS to labelary.com for the live preview
