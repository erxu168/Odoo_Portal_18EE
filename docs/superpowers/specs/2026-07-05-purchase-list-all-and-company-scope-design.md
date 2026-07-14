---
date: 2026-07-05
topic: Purchase — auto-import company scope + list-all in supplier & product pickers
status: approved (Ethan) — implementing on main, staging first
repo: erxu168/Odoo_Portal_18EE
---

# Design: company-scoped auto-import + "show the full list" pickers

Three independent changes, each its own commit on `main` (single-branch rule), each
deployed to staging and click-tested in a real browser before the next.

## ① Auto-import: scope to the active company (BUG)

**Root cause.** `runAutoImport()` (`src/app/purchase/page.tsx`) POSTs an empty body to
`POST /api/purchase/auto-discover`. The route falls back to a hardcoded
`DEFAULT_COMPANIES = [3, 5]` (Ssam + WAJ) and loops over both — ignoring the header
company switcher. So with WAJ selected it still pulls Ssam.

**Fix.** In `auto-discover/route.ts`, when the body has no explicit `companies`, default to
the active company from the `kw_company_id` cookie, validated against
`parseCompanyIds(user.allowed_company_ids)` — the same pattern as
`src/app/api/tasks/departments/route.ts`. Explicit `body.companies` still overrides.
Fallback order: active cookie → allowed companies → `DEFAULT_COMPANIES`.

- Files: `src/app/api/purchase/auto-discover/route.ts` (only). No frontend change (cookie
  rides along automatically).
- Risk: low. No visible UI change; result now lists one company instead of two.

## ② Add supplier: full list by default

Today the "Pick from Odoo" tab shows nothing until 2+ chars typed. Show all active
suppliers on open; search narrows; already-added ones stay greyed ("Already added").

- ~149 active suppliers → load all in one request (no paging needed).
- API `src/app/api/purchase/suppliers/search/route.ts`: allow empty `q` (return all active,
  `name asc`), raise `limit` (e.g. 200). `already_added` enrichment unchanged.
- Frontend `AddSupplierScreen.tsx` + `purchase/page.tsx`: fetch on tab open; render the list;
  filter live as the user types (client-side is fine at this size).
- Risk: low.

## ③ Product pickers: full list by default + load-more (all pickers)

Scope (per Ethan): ALL product pickers, not just the order guide.
- Purchase **Edit order guide** — `ManageGuideScreen` / `/api/purchase/products`
- Manufacturing **Add ingredient** — `AddIngredientSheet` / `/api/products/search`
- Manufacturing **Build BOM** — `CreateBom` (ingredient picker; main-product picker) / `/api/products/search`
- Inventory **count template** — `TemplateForm` already loads all products; leave as-is.

~862 active products → cannot dump all on a phone. Behaviour (per Ethan): **load a first
batch, load more on scroll**, search + category filters on top.

**Reusable piece.** Four screens need identical "list from Odoo + load-more + filter"
behaviour → build ONE shared component/hook in `src/components/ui/` (check existing shared
UI first) and use it in each picker. Avoids copy-paste; consistent UX. Keep each screen's
own de-dup (guide items / BOM lines already picked) and its own "on select" action.

**APIs.** Add paging (offset/cursor) to `/api/purchase/products` and `/api/products/search`
(both already return all products for empty `q`; they just need offset + a stable order).
Preserve any company scoping already present.

- Risk: medium (touches several screens) → test each picker in a browser.

## Test plan (staging, real browser — Marco Bauer manager / test1234, company WAJ=5)
- ①: select WAJ → Auto-import → result names only WAJ (no Ssam line). Switch to Ssam → only Ssam.
- ②: Add supplier → Pick from Odoo → full alphabetical list shows immediately; typing filters;
  already-added greyed.
- ③: each picker opens showing products immediately; scrolling loads more; search + category
  filter work; picking still adds correctly and de-dup still hides already-picked.

## Notes
- Single-branch: commit to `main`, no side branches. Deploy = git pull + npm run build +
  systemctl restart krawings-portal on staging (89.167.124.0). Production held until Ethan says.
- Brand orange `#F5800A`, `--fs-*` type, shared `SearchInput`/`SearchBar` per DESIGN_GUIDE.
