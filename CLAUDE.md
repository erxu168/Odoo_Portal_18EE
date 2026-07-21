# Krawings Portal — Claude Code Instructions
# Last updated: 2 May 2026
# Claude Code: READ THIS FILE + PORTAL.md + DESIGN_GUIDE.md at the start of every session.

---

## Single-Branch Rule (non-negotiable)

**`main` is the only branch.** Always edit, commit, push, and deploy from `main`.

- Staging tracks `main`. Period.
- Do NOT create `feat/*`, `fix/*`, or any other side branch unless the user explicitly asks for one. Even then, merge it back to `main` and delete it the same session.
- Before starting work: `git checkout main && git pull --ff-only`. Confirm `git branch --show-current` says `main`.
- Before deploying: confirm staging is on `main` (`ssh root@89.167.124.0 'cd /opt/krawings-portal && git branch --show-current'`).
- If you see a branch named `feat/*` or `fix/*` still around, that's tech debt — flag it to the user, don't silently work on it.

This rule exists because past branch fragmentation caused fixes to land on the wrong branch and never reach staging.

---

## Codex cross-check (binding)

For **complex tasks**, get a second opinion from the **OpenAI Codex CLI** (`codex`) — a
second reasoning model (OpenAI) that reviews your plan and your diff. This is for the
primary agent (**Claude Code**). **When Codex itself is the running agent, ignore this
section — it must not invoke itself** (no recursion).

- **Complex task =** a new feature/module, an architecture or design-system decision, a
  multi-file change, or a non-trivial bug fix. **Skip Codex** for trivial work: typos,
  one-liners, a single copy/token tweak.
- **Model & effort (always):** `gpt-5.6-sol` at reasoning effort `high` — pass both
  explicitly on every call (defaults live in `~/.codex/config.toml`, but keep the rule
  self-contained). Model ids age — revisit periodically.
- **Read-only always:** pass **`--sandbox read-only`** so Codex can't touch the repo.
  **Codex advises; Claude makes every edit.**
- **`</dev/null` is mandatory:** end every `codex exec` with **`</dev/null`** — Codex drains
  stdin even though the prompt is an argument, so without an EOF a backgrounded call can
  block waiting on stdin. Prefer running Codex in the background and waiting for it to exit.
- **Run from the repo root** — no `-C <path>` is hardcoded, so these commands stay correct
  on every checkout of this repo (Mac dev checkout, staging `/opt/krawings-portal`, …).
  This repo is a git repo, so Codex reviews your `git diff` directly.
- **Run Codex in parallel, never as a serial blocker:** launch the planning call first —
  after the session-start reads and `git checkout main && git pull`, but before your own
  deep task-specific reads; launch the verification call the moment the last edit is saved,
  alongside your local `npm run build` / lint. Only the **commit** waits on Codex's verdict.
- **Rate Codex 1–10** for usefulness in the closing report (honest cost/benefit signal).
- **Cost:** Codex calls use your OpenAI/ChatGPT quota, billed separately from Anthropic.

**1) Plan a complex task (Codex advises, does NOT implement):**
   `codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" --sandbox read-only "Plan this task, do NOT implement: <goal + constraints>. Give approach, risks, edge cases, files to touch." </dev/null`
Then reconcile your plan with Codex's and note where it shaped the result.

**2) Verify a finished complex task (mandatory) — code review of the diff:**
   `codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" --sandbox read-only -o /tmp/codex-verdict.md "Review the current uncommitted changes for task '<name>'. Priority: code review — bugs, correctness, security, regressions by file:line with severity. Then confirm requirements are met: <requirements>." </dev/null`
   (Running parallel tasks? Give `-o` a unique path so verdicts don't collide.)
Read the verdict, fix real issues, **re-run the review after any substantive fix**, and summarize in the closing report what you accepted/rejected.
Pure code diff? Use the purpose-built reviewer — the **top-level** `codex review` sets the model via `-c model=` and takes **no** `-m`:
   `codex review --uncommitted -c model="gpt-5.6-sol" -c model_reasoning_effort="high" </dev/null`

**3) Stuck (any task):** hand Codex the problem + what you already tried:
   `codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" --sandbox read-only "I'm stuck on: <problem>. Tried: <attempts>. Relevant files: <paths>. Propose a concrete fix/approach." </dev/null`

**4) Codex unavailable?** If a call fails (quota, rate limit, auth) **say so in the closing
report** — which step was skipped and why. Never let the missing cross-check be silent.

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
- Repo: `erxu168/Odoo_Portal_18EE` — single branch: `main`

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
- One primary action per screen (big green button at bottom — `ui/PrimaryButton`)
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
- **Inventory**: Live — 7 screens (dashboard, my-lists, quick-count, mo-ingredients, manage, review, product-settings), 13 API routes, SQLite for templates/sessions/counts/photos/drafts/flags, approve writes back to Odoo `stock.quant.inventory_quantity` + `action_apply_inventory`. Includes barcode scanning, scan-to-create draft products, per-line photo proof. Module exists end-to-end but is NOT yet in active production use (see feedback: manufacturing must not gate on stock).
- **HR/Onboarding**: 7-step DATEV wizard, DocumentCapture, FilePicker, profile photos
- **Chef Guide**: Concurrent cook sessions, Kitchen Board, global timer alerts
- **Issues & Requests**: Mock complete (17 screens), not yet coded

## Related: Odoo Custom Modules

Odoo custom addons at `/opt/odoo/18.0/custom-addons/` — separate workspace.
The `krawings_recipe_config` module provides recipe data to this portal.
Do NOT modify Odoo modules from this workspace.
