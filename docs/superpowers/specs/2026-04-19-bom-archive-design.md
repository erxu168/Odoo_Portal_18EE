# BOM (Recipe) Archive — Design

**Date:** 2026-04-19
**Module:** Manufacturing (Krawings Portal)
**Scope:** Let managers and admins archive and unarchive BOMs ("recipes") directly from the portal. Archived BOMs are hidden from the list by default but can be revealed via a "Show archived" toggle.

---

## Problem

Today, BOMs can only be archived in Odoo. Managers want to clean up the recipe list from the portal without opening the ERP. Archived recipes should stay recoverable (Odoo's `active=False` is reversible) but out of the way.

`GET /api/boms` already filters `active = true` (see `src/app/api/boms/route.ts:14`), so archived BOMs are already invisible to the portal — there's just no way to create or reverse that state from here.

## Goal

- Manager or admin can archive a BOM from its detail page.
- Manager or admin can view a list of archived BOMs and unarchive any of them.
- Staff never see these controls.
- Existing Manufacturing Orders and Work Orders that reference an archived BOM continue to work (Odoo preserves the reference regardless of `active`).

## Non-goals

- No cascading archive of child BOMs or product variants.
- No "trash" step or auto-delete — archive is a toggle only.
- No bulk archive (one BOM at a time).
- No archive on the list screen (swipe-to-delete) in v1 — single entry point from detail keeps the flow deliberate.

---

## Architecture

### API

**New:** `PATCH /api/boms/[id]/archive`

- Body: `{ active: boolean }`
- Auth: requires logged-in user via `getCurrentUser()`; rejects unless `hasRole(user, 'manager')`.
- Calls `odoo.write('mrp.bom', [id], { active: body.active })`.
- Returns `{ ok: true, id, active }`.
- Errors: `401` (not authenticated), `403` (staff), `400` (missing/invalid `active`), `500` (Odoo failure).

**Modified:** `GET /api/boms`

- New query param: `include_archived=1`
- When set AND the caller is manager+: domain becomes `[]` (no `active` filter). Each returned BOM now includes its `active` field so the UI can tag archived rows.
- When not set (default): unchanged — only active BOMs returned, matching today's behaviour.
- Staff passing `include_archived=1` is ignored silently (still filter to active only). No 403, just behaves as if the param wasn't there.

No other API changes.

### Role helper

`src/lib/auth.ts` already has `hasRole(user, 'manager' | 'admin' | 'staff')`. Reuse it on both server and (via a tiny client-side hook) client. The portal already has a client `useAuth` / `useUser` hook — confirm in implementation and reuse; otherwise add a minimal `useRole()` based on the existing session context.

### UI — BOM Detail

Add a small "Actions" area at the bottom of the page (below existing content), manager-only:

- **If BOM is active:** ghost button **"Archive recipe"** — 44 px, red text `#EF4444`, outlined in `#E8E8E8`. Tap → confirmation modal.
- **If BOM is archived:** ghost button **"Unarchive recipe"** — same shape, orange text `#F5800A`. Tap → fires PATCH immediately (no confirmation — unarchive is non-destructive).

**Confirmation modal** (only on archive):

- Title: "Archive this recipe?"
- Body: "**{Product name}** will be hidden from the list. You can restore it later via Show archived."
- Buttons: **Cancel** (ghost) / **Archive** (filled, red).

On success:

- Show toast "Recipe archived" or "Recipe restored".
- Navigate back to the BOM list (`onBack()`). The list re-fetches on mount.

On failure: show toast with the error message; stay on the detail page.

### UI — BOM List

- **"Show archived" pill** at the top right of the list header — only rendered for manager+. Off by default.
- When toggled on, list fetches `?include_archived=1` and renders archived BOMs with:
  - 60 % opacity on the row
  - An **"Archived"** badge (pill, border `#9CA3AF`, text `#6B7280`, background `#F5F6F8`) to the right of the product name.
- Tapping an archived row opens its detail (same flow, Unarchive button shown).
- The toggle state is local component state; no persistence to localStorage (simpler, and "Show archived" is rarely a long-lived mode).

### Data flow

1. Manager opens BOM detail → client sees `user.role !== 'staff'` → shows Archive button.
2. Tap → modal → tap Archive → `fetch('/api/boms/123/archive', { method: 'PATCH', body: { active: false } })`.
3. API authorises via `hasRole(user, 'manager')`, writes `mrp.bom.active = false` through Odoo RPC, returns `{ ok: true }`.
4. Client shows toast, calls `onBack()`, list re-fetches without the archived BOM.
5. Manager flips "Show archived" on → `GET /api/boms?company_id=...&include_archived=1` returns both active and archived; archived rows are dimmed with an Archived badge.
6. Manager opens an archived BOM → detail shows Unarchive button → tap → PATCH `{active: true}` → toast + navigate back.

### Error handling

- 401 from API → toast "Please sign in again" and leave the button disabled.
- 403 from API → toast "Only managers can archive recipes" (shouldn't happen if UI is gated; belt-and-braces).
- Network failure → toast "Could not reach server. Try again."
- Odoo RPC error → toast with `error.message` from the response.

### Security

- Server-side `hasRole` check is the authoritative gate. Hiding the button in the UI is a usability nicety only.
- No risk of deleting data — Odoo's archive flag is reversible.
- No cascade to other records — by design.

---

## Risk

**Low.** Additive API, additive UI, reversible data change. Rollback: `git revert` the commits; anything previously archived stays archived until manually unarchived, which is fine.

---

## Reusability

The Archive/Unarchive button + confirmation modal pattern is a candidate for later reuse (future: archive products, workcenters, routes). For v1, we keep it inline in `BomDetail.tsx`. If we add a second caller, we promote it to `src/components/ui/`. YAGNI now.

---

## Files to change

| File | Change |
|---|---|
| `src/app/api/boms/route.ts` | Add `include_archived` query param + role check; return `active` field |
| `src/app/api/boms/[id]/archive/route.ts` | New — PATCH endpoint |
| `src/components/manufacturing/BomList.tsx` | "Show archived" toggle (manager-only), archived row styling + badge |
| `src/components/manufacturing/BomDetail.tsx` | Archive/Unarchive button + confirmation modal (manager-only) |
| `src/types/manufacturing.ts` | Add `active?: boolean` to the `Bom` interface |

Four files touched. No schema changes.

---

## Testing checklist

Manual verification on staging:

1. **Staff user** opens any BOM detail → no Archive button. Opens BOM list → no Show archived toggle.
2. **Manager user** opens an active BOM → sees "Archive recipe" button. Tap → modal appears. Tap Cancel → nothing happens. Tap Archive → toast "Recipe archived", list now missing that BOM.
3. Manager flips "Show archived" on → BOM list now shows the archived BOM with badge + dimmed row.
4. Manager opens archived BOM → button now says "Unarchive recipe". Tap → toast "Recipe restored" → list refetches, BOM back in normal view.
5. Direct API probe as staff user (dev console): `fetch('/api/boms/1/archive', { method: 'PATCH', body: JSON.stringify({ active: false }) })` → 403.
6. Create an MO referencing a BOM → archive the BOM → MO still opens, still shows its components.
7. Staff user passes `?include_archived=1` in URL manually → API ignores it, returns only active BOMs.
8. Archive one, archive another → list refetch works repeatedly (no stale state).
9. Archive → back → toggle Show archived → see it → unarchive → back → it's in the normal list again.
10. Mobile (iPhone preset): Archive button is at least 44 px; modal is full-width on small screens, centered on tablet; toast positions above bottom nav.

**Build gate:**

- `npm run build` passes on every commit.
- `.next/BUILD_ID` present before staging restart.

---

## Branch & commits

- **Branch:** `feat/bom-archive` (or continue on `feat/inventory-photo-proof` if pragmatic, same as the rich text work)
- **Commits (in order):**
  1. `[IMP] boms API: return active field + include_archived query param`
  2. `[ADD] boms API: PATCH /api/boms/:id/archive endpoint`
  3. `[IMP] manufacturing: Archive/Unarchive button on BOM detail (manager-only)`
  4. `[IMP] manufacturing: Show archived toggle on BOM list (manager-only)`

Each commit is a working state; any one can be reverted independently.

---

## Rollback

```bash
git revert <sha-4> <sha-3> <sha-2> <sha-1>
git push
```

Archived BOMs remain archived on Odoo; managers can unarchive in Odoo directly if needed.
