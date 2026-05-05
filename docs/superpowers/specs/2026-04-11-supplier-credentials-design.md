# Supplier Credentials Management

> Store and manage supplier portal login credentials per company, with Odoo as source of truth and a portal UI for viewing.

## Problem

Multiple companies (Ssam, Krawings GmbH, etc.) order from online suppliers (Metro, Transgourmet, etc.). Each company has its own login credentials for each supplier platform. Currently there is no centralized way to store and retrieve these credentials.

## Solution Overview

Two-part implementation:

1. **Odoo custom module** (`krawings_supplier_credentials`) — new child model on `res.partner` storing per-company login credentials
2. **Portal page** (`/admin/credentials`) — read-only view for managers, full CRUD for admins

---

## Part 1: Odoo Custom Module

### Module

- **Name:** `krawings_supplier_credentials`
- **Path:** `/opt/odoo/18.0/custom-addons/krawings_supplier_credentials/`
- **Depends:** `base`, `purchase`

### Model: `krawings.supplier.login`

| Field         | Type                        | Description                                      |
|---------------|-----------------------------|--------------------------------------------------|
| `partner_id`  | Many2one -> `res.partner`   | The supplier (required)                          |
| `company_id`  | Many2one -> `res.company`   | Which company this login is for (required)       |
| `username`    | Char                        | Login username/email (required)                  |
| `password`    | Char                        | Login password (stored with Odoo field encryption)|
| `website_url` | Char                        | Direct login URL (optional)                      |
| `notes`       | Text                        | Optional notes (min order, account number, etc.) |

### Constraints

- SQL unique constraint on `(partner_id, company_id)` — one login per supplier per company

### Odoo UI

- New **"Portal Logins"** tab on the supplier partner form (`res.partner` form view)
- Inherited via XML — only visible when `supplier_rank > 0`
- One2many inline tree: Company / Username / Password / URL / Notes
- Password field uses `password="True"` widget (masked in form)

### Access Control

- **Read/Write:** `purchase.group_purchase_manager` and `base.group_system`
- **No access** for regular users/employees
- Record rules: users only see logins for companies in their `company_ids`

---

## Part 2: Portal Frontend

### API Routes

#### `GET /api/admin/credentials`

- **Auth:** Manager or Admin role required
- **Behavior:** Calls Odoo `search_read` on `krawings.supplier.login` with related partner fields
- **Filtering:** Results filtered by user's `allowed_company_ids` (managers see their companies, admins see all)
- **Response shape:**
  ```json
  {
    "suppliers": [
      {
        "id": 42,
        "name": "Metro",
        "website": "https://metro.de",
        "logins": [
          {
            "id": 1,
            "company_id": 3,
            "company_name": "Ssam Korean BBQ",
            "username": "ssam@metro.de",
            "password": "secretpass",
            "website_url": "https://shop.metro.de/login",
            "notes": "Use for weekly orders"
          }
        ]
      }
    ]
  }
  ```

#### `POST /api/admin/credentials`

- **Auth:** Admin only
- **Body:** `{ partner_id, company_id, username, password, website_url?, notes? }`
- **Behavior:** Creates record in Odoo via `create` RPC

#### `PUT /api/admin/credentials/[id]`

- **Auth:** Admin only
- **Body:** Partial update fields
- **Behavior:** Updates record in Odoo via `write` RPC

#### `DELETE /api/admin/credentials/[id]`

- **Auth:** Admin only
- **Behavior:** Deletes record in Odoo via `unlink` RPC

### Page: `/admin/credentials`

- **Access:** Admin and Manager roles only (staff cannot access)
- **Navigation:** Tile on admin dashboard

#### Layout

- **Search bar** at top — filters suppliers by name
- **Supplier cards** — each card shows supplier name + website link
- **Expandable** — tap a supplier card to reveal per-company login rows
- **Each login row:**
  - Company name
  - Username (visible)
  - Password (masked `••••••••` by default)
  - Eye icon toggle — reveals password, auto-hides after 5 seconds
  - Copy button — copies password to clipboard
  - Notes (if any, shown as small gray text)
- **Admin-only controls:**
  - "Add Credential" button (opens modal)
  - Edit icon per row (opens modal pre-filled)
  - Delete icon per row (confirmation dialog first)
- **Managers:** View-only, no add/edit/delete buttons shown

#### Add/Edit Modal

- **Fields:**
  - Supplier: searchable dropdown (from Odoo `res.partner` where `supplier_rank > 0`)
  - Company: dropdown (from user's allowed companies)
  - Username: text input
  - Password: text input with eye toggle
  - Login URL: text input (optional)
  - Notes: textarea (optional)
- **Validation:** Supplier + Company + Username + Password required
- **Duplicate check:** If a login already exists for that supplier+company, show error

#### Delete Confirmation

- Standard confirmation dialog: "Remove login for [Company] at [Supplier]?"

### Styling

- Follows existing portal design system (Krawings UX Standard)
- Brand orange `#F5800A` for primary actions
- Cards with `16px` border-radius, `1px solid #E8E8E8` border
- Mobile-first, responsive (smartphone / tablet breakpoints)
- Desktop untouched

---

## Security Considerations

- Passwords stored in Odoo with field encryption (not plain text)
- Portal API never exposes credentials to unauthorized roles
- Password auto-hides after 5 seconds of reveal
- All credential operations logged to portal `audit_log`
- Odoo record rules enforce company-level access

## Data Example

| Supplier       | Company          | Username         | Password | Notes              |
|----------------|------------------|------------------|----------|--------------------|
| Metro          | Ssam Korean BBQ  | ssam@metro.de    | ******** | Weekly orders      |
| Metro          | Krawings GmbH    | krawings@metro.de| ******** |                    |
| Transgourmet   | Ssam Korean BBQ  | user123          | ******** | Min order EUR 200  |
| CHEFS CULINAR  | What a Jerk      | waj_chefs        | ******** |                    |

## Out of Scope

- Password generation / strength validation
- Two-factor auth storage
- Automated login to supplier platforms
- Syncing credentials back from portal to Odoo (Odoo is single source of truth)
