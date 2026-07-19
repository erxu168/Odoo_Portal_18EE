# 2026-07-19 — Portal-native inventory (decoupled from Odoo stock)

## Problem / goal

The restaurant needs to **track stock ASAP** with a simple mental model — not Odoo's perpetual stock-moves. Concretely:

- Know **how much was purchased that went into stock** (goods received).
- Know **how much was consumed** over a period, from **opening + received − closing** counts.
- **Product pictures** (camera capture or file upload) so staff recognise items.
- **Barcode scanning** (already in the module; stays).
- No complicated stock moves, valuation, or reservations.

## Decision: decouple from Odoo stock (keep Odoo as read-only product source)

*Grounded in the real code + setup (verified 2026-07-19):*

- **Counts already live entirely in the portal** — 14 SQLite tables. Odoo does not store the counts.
- The module's **only Odoo stock write** is `approve` → `stock.quant` (`inventory_quantity` + `action_apply_inventory`) in `approve/route.ts` and `quick-count/approve/route.ts`. It is the most failure-prone code (quant races, "several stock records", non-storable products).
- **Odoo stock is not even set up** on this deployment (project note `inventory_not_set_up`: "inventory NOT set up; MO flows work regardless of stock"). So the write pushes counts into a system nobody uses — pure coupling cost, zero benefit.
- Odoo also provides: the **product catalog** (`product.product` — names, barcodes, categories, UoM, supplierinfo) and a **variance number** (`stock.quant` read). The catalog is genuinely useful; the variance is not (it reflects an unconfigured system).

**Therefore:**

- **Turn OFF the Odoo stock write** on approve/quick-count-approve — gate it behind a setting (`INVENTORY_ODOO_SYNC`, default off). Keep the code for a future optional sync. Approval then just records the count in the portal.
- **Drop the `stock.quant` variance read** from the count screen (no comparison to an unconfigured number). Keep the count as the source of truth.
- **Keep reading Odoo's product catalog read-only** (names, barcodes, categories) — no rebuild, immediate. Odoo stays the product master; only its *stock* is dropped. (A fully portal-owned product list is a **later** option — see Product source.)

This also **de-risks the two unfinished screens**: the count + review screens were risky *because* of offline-sync-plus-Odoo-write. With no Odoo write, approval is trivial (record it), and those screens become simpler and safe to verify.

## The consumption model (portal-native)

Per product, over a period bounded by two counts of the same list/location:

```
consumption = opening_total + received_total − closing_total
```

- **opening_total / closing_total** = a product's counted base-unit total in the opening / closing count session (summed across spots; out-of-stock = 0).
- **received_total** = sum of goods-received base-unit quantities logged **between** the two counts' dates.
- Everything is in the product's **base unit** (the count already computes a base total via pack×size + loose).
- A **Usage report** picks an **opening count** and a **closing count** (two sessions) and shows, per product: opening, received, closing, consumption — plus a low-stock hint (closing near/at zero).

Edge cases:
- A product present in only one of the two counts, or **not counted** in one, can't be computed — the report **flags it** ("count both endpoints to see usage") rather than guessing.
- Receipts with no matching product on either count are listed separately ("received but not on this list").

## What is reused (already built — 11 commits)

- The **counts** (`counting_templates` / `counting_sessions` / `count_entries` / `quick_counts`) — used as opening/closing snapshots.
- The **redesign backend**: multi-spot counting, out-of-stock vs not-counted, pack/loose (`count_mode`/`loose_label`), per-session snapshots, per-list placements, name/order-code/supplier search, company scoping.
- **Product settings** (unit mode + photo toggle), the **builder** (places items at spots).
- **Photo/upload infra**: `PhotoCaptureStrip` (camera), the shared document/file upload widget, `PhotoLightbox`, `count_photos`, `count_locations.photo` — the pattern for on-device capture + portal storage.
- **Barcode scanning + scan-to-create draft products** (exists).

## What is new / changed

### A. Odoo sync switch
- New setting `INVENTORY_ODOO_SYNC` (default **off**). When off, `approve` / `quick-count/approve` skip all `stock.quant` calls and just mark approved + record. When on (future), the existing aggregated write runs. Count screen stops fetching `stock.quant` variance (or shows it only when sync is on).

### B. Product pictures (portal-owned)
- **One primary picture per product**, set via **📷 camera** (`PhotoCaptureStrip`) or **⬆️ upload** an image file (shared upload widget). Optional **additional file attachments** per product (e.g. a supplier spec sheet / PDF) via the same widget — low cost, off the same table.
- **Storage:** new table `product_images` (`odoo_product_id`, `image`, `mime`, `is_primary`, `created_by`, `created_at`). Images are **downscaled client-side on capture** (max ~1024px, JPEG ~0.7) to keep size sane. Store as base64 to match existing photo infra **for now**; documented option to move to on-disk/object storage if the DB grows (product images are more numerous/larger than location photos — Codex's base64-growth caveat applies).
- **Shown everywhere a product appears:** builder picker, **staff count screen** (thumbnail beside the name — same recognition value as location photos), Product Settings, review. Falls back to a neutral placeholder when unset.
- **Set from:** Product Settings (primary place) + inline in the builder.
- New API: `GET/POST/DELETE /api/inventory/product-images/[product_id]` (manager+; company-guarded to the product's visibility).

### C. Goods-received log ("purchased-in")
- New table `stock_receipts` (`id`, `company_id`, `odoo_product_id`, `count_location_id`, `qty_base`, `crate_qty`/`loose_qty`/`units_per_crate` (audit), `note`, `photo` (optional delivery photo), `received_by`, `received_at`). Company-scoped.
- **Entry screen:** pick/scan a product (barcode-friendly, reuses scanning), enter quantity (same pack/loose stepper + numpad as counting), optional note/photo, save. A running list of today's/period's receipts.
- Base-unit `qty_base` computed server-side (like counts) so the consumption math is exact.
- API: `GET/POST/DELETE /api/inventory/receipts` (company-scoped; validated like counts).

### D. Usage / consumption report
- **Report screen:** pick opening count + closing count (same list/location) → table of opening / received / closing / consumption per product, with the flags above. Export/summary later.
- API: `GET /api/inventory/usage?opening_session=…&closing_session=…` — server computes per-product consumption from `count_entries` (both sessions) + `stock_receipts` between their dates. Company-guarded via session access.

### E. Finish the count + review screens (now simple)
- **Count screen** (`CountingSession` / guided flow): per-spot list, unit-on-top stepper, tap-to-numpad, compact pack/loose, **out-of-stock control**, product **thumbnail** + location **ⓘ** info. Offline queue re-keyed by `(session, spot, product)`. No Odoo write path to worry about.
- **Review screen** (`ReviewSubmissions`): approve/reject **+ manager adjust-from-photo** for photo items, and a **counted / out-of-stock / not-counted** summary. Approval records in the portal (no Odoo stock write while sync is off).

## Data model — portal SQLite (existing + new)

| Concept | Table | New? |
|---|---|---|
| Counts (opening/closing) | `count_entries` / `quick_counts` (spot, out_of_stock, base total, odoo_qty) | reuse (already extended) |
| Lists + placements + snapshots | `counting_templates` / `template_product_locations` / `session_count_items` | reuse |
| Spots + location photo/info | `count_locations` (photo, description) | reuse |
| Unit model | `product_flags` (count_mode, loose_label, units_per_crate, pack_label, requires_photo) | reuse |
| **Product pictures** | **`product_images`** (odoo_product_id, image, mime, is_primary, …) | **new** |
| **Goods received** | **`stock_receipts`** (company, product, spot, qty_base, split, note, photo, …) | **new** |
| Odoo stock write | (none while sync off) | gated off |

## Company scoping (source of truth)
Every new endpoint (product-images, receipts, usage) reads the active company from `?company_id` / `kw_company_id` cookie, bounded by `canAccessCompany`, consistent with the rest of the module (`feedback_company_scoped_pickers`).

## Product source (the one real fork)
- **Now (recommended, fastest):** keep reading Odoo's product catalog read-only (≈900 products, with barcodes). Odoo stays the product master; only its stock is dropped.
- **Later (optional):** portal-owned product list (import + manage barcodes) for full independence. Deferred.

## Non-goals (this spec)
- Perpetual stock moves, reservations, valuation/costing, negative-stock enforcement.
- Live Odoo stock sync (kept behind a flag for a future opt-in).
- Purchase-order integration (receipts are a simple portal log, not POs).
- Portal-owned product catalog (deferred; Odoo read-only for now).

## Build order
1. **Odoo sync switch** — gate the stock write off; drop the variance read. (Small; de-risks everything.)
2. **Finish count + review screens** — now simple (no Odoo write). Ship the staff counting flow.
3. **Product pictures** — table + capture/upload in Product Settings + display everywhere.
4. **Goods-received log** — table + entry/scan screen.
5. **Usage report** — compute + screen.

Each phase is independently testable and shippable; #1–2 give a working portal-native counting flow, #3–5 add pictures, receipts, and the consumption number.

## Open questions
- Product pictures: **image-only** vs **image + attached files** (PDF spec sheets)? Spec supports both; default is a primary image with optional file attachments.
- Receipts: manual entry + barcode now; a CSV/delivery-note import later?
- Usage report period: two chosen counts (this spec) vs a rolling date range with nearest counts (later)?
