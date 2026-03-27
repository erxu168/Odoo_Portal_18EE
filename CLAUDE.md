# Krawings Portal — Claude Code Instructions
# Last updated: 27 March 2026
# Claude Code: READ THIS FILE + PORTAL.md + DESIGN_GUIDE.md at the start of every session.

---

## Read These Files First (every session)

1. **PORTAL.md** — master reference: tech stack, file structure, what's built, UX rules, Odoo field names, build priority
2. **DESIGN_GUIDE.md** — all visual decisions: color system, badges, cards, typography, navigation rules
3. **src/lib/ux-rules.ts** — plain language mappings, confirmation dialogs, error messages
4. **src/lib/design-system.ts** — design tokens, component classes, touch targets

---

## Environment

- **This is STAGING** — never modify production (128.140.12.188)
- Server: Hetzner, IP 89.167.124.0
- Portal: http://89.167.124.0:3000 (Next.js 14, port 3000)
- Odoo 18 EE: http://89.167.124.0:15069 (internal, server-side only)
- Database: `krawings`, login: biz@krawings.de, uid=2
- Portal service: `systemctl restart krawings-portal`
- Odoo service: `systemctl restart odoo-18`
- Portal path: `/opt/krawings-portal`
- Repo: `erxu168/Odoo_Portal_18EE` (main branch)

## Deploy Process

```
cd /opt/krawings-portal
git pull
npm run build
systemctl restart krawings-portal
```

Always `npm run build` before restart — catches TypeScript errors.

## Critical Dev Rules

1. **Never edit source files directly on the server** — all changes via GitHub
2. Split pages into separate component files — no monoliths
3. PascalCase filenames for components
4. Credentials in `.env.local` only
5. Push only complete, buildable code (GitHub Action runs build check)
6. Red banner when connected to production Odoo
7. All Odoo calls through `src/lib/odoo.ts` — NEVER from the browser
8. New module = new folder in `src/components/[module]/`
9. Shared UI = `src/components/ui/` — always check existing before building new
10. Always introspect Odoo 18 EE staging via JSON-RPC before writing frontend

## TypeScript / Build Pitfalls

1. Odoo dates use space separator not `T` (e.g. "2026-03-27 14:00:00")
2. `toISOString()` returns UTC, not Berlin time
3. `pdfjs-dist` pinned to 4.8.69
4. iOS: `touch-action: 'none'` kills scroll — avoid it
5. Use `better-sqlite3` not `sqlite3`
6. Set spread `[...mySet]` fails in some contexts — use `Array.from()`
7. `prefer-const` blocks build — fix or disable per-line
8. Catch blocks: `err: unknown` + `instanceof`, not `err: any`
9. Unused params: remove or prefix with `_`
10. JSX apostrophes block build — use `\u2019` (right single quote)
11. Don't pipe `npm run build` — it masks the exit code

## Role Hierarchy (enforced in UI and API)

Staff < Manager < Admin
- Features invisible to a role must be completely hidden (not just disabled)
- Confirmation prompt before any irreversible action
- Process is ENFORCED — no shortcuts, no skip buttons

## UX Rules (summary — full version in PORTAL.md section 7)

- Every module MUST have a dashboard landing screen (2x2 tile grid)
- Every list view MUST have a search bar
- Every page MUST have a home button
- One primary action per screen (big orange button at bottom)
- Never show ERP jargon — use plain language from ux-rules.ts
- Never show colour-only status — always icon + colour + text

## Test Users

| Name | Role | employee_id | Password |
|------|------|-------------|----------|
| Hana Kim | staff | 1 | test1234 |
| Marco Bauer | manager | 2 | test1234 |
| Yuki Tanaka | staff | 3 | test1234 |

Company: 5 / What a Jerk

## Companies

| ID | Name |
|----|------|
| 1 | Ssam Warschauerstrasse |
| 2 | Krawings GmbH |
| 3 | Ssam Korean BBQ |
| 4 | Test |
| 5 | What a Jerk |

## Active Modules / Features

- **Manufacturing**: Live (MO list, MO detail, WO detail, BOM list, BOM detail, Create MO)
- **Purchase**: 5 tabs, 11 screens, order guides, Odoo PO creation (receive flow pending rebuild)
- **Inventory**: Backend done (SQLite + 7 API routes), frontend page.tsx not built yet
- **HR/Onboarding**: 7-step DATEV wizard, DocumentCapture, FilePicker, profile photos
- **Chef Guide**: Concurrent cook sessions, Kitchen Board, global timer alerts
- **Issues & Requests**: Mock complete (17 screens), not yet coded

## Related: Odoo Custom Modules

Odoo custom addons at `/opt/odoo/18.0/custom-addons/` — separate workspace.
The `krawings_recipe_config` module provides recipe data to this portal.
Do NOT modify Odoo modules from this workspace.
