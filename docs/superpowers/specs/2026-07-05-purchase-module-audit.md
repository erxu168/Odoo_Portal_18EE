---
date: 2026-07-05
topic: Purchase module — ergonomics audit + Choco alignment
status: audit / recommendations (awaiting Ethan's prioritization)
repo: erxu168/Odoo_Portal_18EE
---

# Purchase module audit — ergonomics, best practices, Choco alignment

Verified against the code (file:line cited). Choco findings are web-sourced (links at bottom).

## The headline: "ordering templates" = order guides, and they're hidden

- In this module, the reusable per-supplier product list **is** the "order guide."
- **Today it's reachable only by a manager**, via the ⚙ "Manage" gear on the dashboard
  (`page.tsx:784` — `rightElement={isManager ? manageIconBtn : undefined}`), which opens a
  screen titled **"Manage Purchases"** (ERP jargon), then tap a supplier → edit guide.
  Staff can never create/edit a guide; new staff must ask a manager. That's why "it's not
  clear where to create ordering templates."
- **Choco does the opposite:** the Order Guide / "Favourites List" is the default ordering
  surface. You build it by tapping a **⭐ star** on any catalog item (no wizard), organize
  items into **categories**, and **drag-to-sort** them to match your walk-in. Then ordering
  is "adjust quantities → send" ("three taps to order").

**Fix direction:** make order guides a first-class, discoverable thing (a dashboard tile +
plain-language name like "Order Templates"), let staff *view/add* to them (managers still
configure delivery settings/deletes), and add Choco-style "⭐ star to add" from the catalog.

---

## TIER 1 — Quick wins (low effort, high clarity)

1. **Rename "Manage Purchases" → "Order Templates" (or "Order Lists")** and surface it.
   Jargon at `ManagePurchasesScreen.tsx:19-30`. Plain language per design guide.
2. **Add an "Order Templates" tile to the Purchase dashboard** so it's not hidden under the
   gear. `OrdersDashboard.tsx` tile grid.
3. **Fix status colors** — `StatusBadge.tsx:11-12` maps BOTH "Sent" and "Approved" to the
   same blue. Blue isn't the brand color and the two look identical. Use amber for "Sent"
   (awaiting delivery), gray for "Approved", keep green "Delivered", red "Cancelled".
4. **Remove banned purple + blue primaries** — `ManagePurchasesScreen.tsx:80-93` uses purple
   (design-guide-banned); `ManagePurchasesScreen.tsx:58` and `AddSupplierScreen.tsx:59,65,121,172`
   use blue `#2563EB` for primary actions. Recolor to brand orange `#F5800A`.
5. **Fix tap targets** — quantity steppers are 44px in the Order Guide (`OrderGuideScreen.tsx:112-114`)
   but only **32px** in the Cart (`CartViewScreen.tsx:164,179`). Standardize to 44px (matches
   the receive screen, already fixed).
6. **Add a search bar to the Receive list** (`ReceiveListScreen.tsx` has none) — a busy
   restaurant with many suppliers needs to find a delivery fast. Pattern exists in `SupplierListScreen`.
7. **Home affordance on the Purchase dashboard** — the landing screen header has no back/home
   (`page.tsx:784`); there's a global ☰ menu, but a home button in-module is cleaner.

## TIER 2 — Choco-inspired ergonomics (medium effort)

8. **"⭐ Star to add" list-building** — let staff build a guide by starring items from the
   catalog/guide (Choco's core pattern), instead of the separate manager "manage" flow.
9. **Let staff view + add to guides; managers configure** — rebalance the role gate so the
   core daily workflow isn't manager-only (`page.tsx:784`).
10. **Drag-to-sort + categories in the guide** — arrange items to match the physical walk-in
    order so counting and ordering share one sequence (Choco). Guide items already have categories.
11. **Delivery-check parity in receiving** — align issue categories to Choco's
    **Missing / Wrong quantity / Defective / Other**, and after a check let the user request a
    **Credit note / Replacement** and choose **Save for team** vs **Send to supplier**.
    (We already have per-line issue reporting + photo — this extends it.) `ReceiveIssueScreen.tsx`.
12. **Clarify "shared cart" + reduce redundant warnings** — the guide and cart are the same
    cart but that's not signalled; min-order warning shows in both cart and review
    (`CartViewScreen.tsx:132`, `ReviewOrderScreen.tsx:73`).
13. **Receive state banner** — when a delivery is submitted, show a clear "Awaiting approval"
    banner and lock the steppers in manager review mode (`ReceiveCheckScreen.tsx`).

## TIER 3 — Bigger bets (later)

14. **Invoice-photo / Excel import to build a guide** — Choco lets you upload a past invoice
    photo (parsed) or an Excel template to populate the list fast. (We have the PDF/OCR
    plumbing shelved from the delivery-note work — could be repurposed.)
15. **Scheduled spend reports** — Choco's Reports: Orders / Products / Deliveries per
    supplier+location, exportable, emailed on a schedule. We have `InsightsScreen` as a start.
16. **Order cutoffs / deadlines** — surface supplier cutoff times + delivery days at order
    time (we have `order_days`/`delivery_days` + `PurchaseAlerts` — extend to hard/soft cutoffs).

---

## Other verified polish items
- `OrdersDashboard` tiles use non-semantic blue for Place Order & History — align to brand/gray.
- `InsightsScreen.tsx:99` spend bars use blue `#2563EB` — use brand orange.
- `OrderHistoryScreen.tsx:42` active filter pill is green (reserve green for "done") — use orange.
- Approval banner (just shipped) is tappable for staff too; consider manager-only action + a
  muted info version for staff.
- `ManageGuideScreen.tsx:126` "Order days (when staff must place orders)" — plainer:
  "When to order" / "When they deliver".

## Choco sources
help.choco.com Order Guide / Favourites List collection; "how to place or replace an order";
"how to do a delivery check"; "access purchasing reports"; "manage your order preferences";
choco.com/us/restaurants. (Full URLs in the research transcript.)

## Caveats from Choco research
- Choco's guides are **per-supplier**; no confirmed single cross-supplier master list.
- Reorder-from-past-order is **web-only** in Choco; favourites ordering works in-app.
- Choco is retiring its Inventory tool (Apr 2026) — don't model par-level auto-reorder on it.
- Known Choco weak spot: out-of-stock exceptions still push users to phone/email.
