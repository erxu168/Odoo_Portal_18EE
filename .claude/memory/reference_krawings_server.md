---
name: Krawings Portal Staging Server
description: SSH access and deployment details for the Krawings Chef Guide portal (Odoo 18 EE)
type: reference
---

- **Staging server**: `89.167.124.0` (SSH as root, key-based auth works from this Mac)
- **Portal path**: `/opt/krawings-portal` (Next.js 14, React 18)
- **Service**: `systemctl restart krawings-portal`
- **GitHub repo**: `erxu168/Odoo_Portal_18EE`, branch `main`
- **Deploy**: `cd /opt/krawings-portal && git pull && npm install && npm run build && systemctl restart krawings-portal`
- **Odoo backend**: Odoo 18 EE with custom `krawings_recipe_config` module
- **Key Odoo models**: `product.template` (cooking guide), `mrp.bom` (production guide), `krawings.recipe.step`, `krawings.recipe.version`, `krawings.recipe.category`
