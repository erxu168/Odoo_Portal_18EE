---
name: Krawings Portal Project Context
description: Architecture and conventions for the Krawings Chef Guide portal — screen routing, UI patterns, role system
type: project
---

The portal uses a single-page state machine in `src/app/recipes/page.tsx` with `Screen` union type and if-else chain. Context objects (`RecipeCtx`, `RecordCtx`, `ApprovalCtx`, `EditCtx`) hold flow state.

**Why:** Mobile-first restaurant staff app — all UI is touch-friendly, card-based, dark header pattern (`bg-[#1A1F2E]`).

**How to apply:**
- Mode-based theming: green for cooking guide, purple for production guide
- Never use native `confirm()` or `alert()` — use `ConfirmDialog` and `Toast` components
- Role hierarchy: staff < manager < admin. Auth via `requireAuth()` + `hasRole()` from `src/lib/auth.ts`
- Steps are versioned via `krawings.recipe.version` in Odoo — every save creates a new version
- Staff edits create `review` versions; admin/manager edits auto-publish
- Odoo RPC client at `src/lib/odoo.ts` with methods: searchRead, read, create, write, unlink
