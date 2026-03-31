---
name: Odoo Server References
description: SSH access and connection details for both Odoo instances (legacy v15 and production v18)
type: reference
---

### Odoo 18 (Production — on portal server)
- **Server**: `89.167.124.0` (same as Krawings portal)
- **Port**: `15069` (localhost only)
- **DB**: `krawings`
- **Auth**: `biz@krawings.de` / `exEV3M<v3.`
- **RPC URL**: `http://127.0.0.1:15069`
- **Note**: hr.applicant requires hr.candidate record (candidate_id FK). Create hr.candidate first, then hr.applicant.

### Odoo 15 Community (Legacy)
- **Server IP**: `78.47.5.176`
- **SSH user**: `root` (key-based auth)
- **Hostname**: `ubuntu-2gb-nbg1-2-Odoo15`
- **Databases**: `krawings15_live`, `krawings15_test`
- **Running service**: `odoo-15.service` on port 8069
- **Config**: `/opt/odoo15/15.0/conf/odoo.conf`
