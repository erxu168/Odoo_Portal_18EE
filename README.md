# Krawings Portal — Manufacturing Module

Mobile-first manufacturing portal for SSAM Korean BBQ. Connects to Odoo 18 EE via JSON-RPC — zero custom modules on production.

## Setup

```bash
npm install
cp .env.local.example .env.local  # Edit with your Odoo credentials
npm run dev                        # http://localhost:3000/manufacturing
```

## Servers

| Server | IP | Role |
|--------|-----|------|
| Production | 128.140.12.188 | Odoo 18 EE (DO NOT MODIFY) |
| Staging | 89.167.124.0 | Staging clone (nightly refresh) |
