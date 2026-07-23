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

## Deploy Process — STAGING AUTODEPLOYS. Just push to `main`.

**To deploy: push to `main` and wait ≤2 minutes. Do nothing else.**

Staging runs a cron autodeploy every 2 minutes
(`*/2 * * * * /usr/local/bin/portal-autodeploy.sh`, source: `ops/portal-autodeploy.sh`
+ `ops/portal-lib.sh`). When it sees `origin/main` is ahead it does a **safe,
atomic** deploy: builds in an isolated git worktree at `/opt/portal-build`
(live site untouched), then swaps the finished `.next` into `/opt/krawings-portal`
and restarts. It keeps `.next.prev` for an **instant rollback** and quarantines a
SHA that fails to build. It self-serializes on `$LOCK_DIR/deploy.lock`.

**⛔ NEVER build in the live directory.** Do NOT run
`cd /opt/krawings-portal && npm run build` / `rm -rf .next` / `systemctl restart`
by hand, and do NOT use any `flock /tmp/kw-deploy.lock` command. That builds in
place with a *different* lock than the cron autodeploy, so the two collide
mid-cutover and leave a mismatched React client manifest → the whole site 500s
(`Could not find the module ".../app-router.js#" in the React Client Manifest`;
this exact incident happened 2026-07-21 and self-healed only when the running
autodeploy finished its swap). The old `flock /tmp/kw-deploy.lock … rm -rf .next`
instructions were wrong — that is what caused the outage.

**Need it out faster than the 2-min poll?** Trigger the *real* script (it takes
its own lock and does the same safe worktree build + atomic swap):
```
ssh root@89.167.124.0 /usr/local/bin/portal-autodeploy.sh
```

**Verify a deploy:** `curl -sS -o /dev/null -w '%{http_code}\n' https://portal.krawings.de/login`
should be `200`; `ssh root@89.167.124.0 'cd /opt/krawings-portal && git rev-parse --short HEAD'`
should match `origin/main`. Autodeploy logs: `/var/log/portal-sync/autodeploy.log`
and `/var/log/portal-sync/*-<ts>.log`.

Build errors are a `main` problem, not a deploy problem: a build that fails in the
worktree never reaches the live site (rollback + SHA quarantine). Fix the code on
`main` and push again. Local pre-push sanity check: `npx tsc --noEmit`
(the tree needs `NODE_OPTIONS=--max-old-space-size=4096` for a full `next build`,
else the worker OOMs into phantom `.next` ENOENT errors).

## Concurrent Claude Sessions (binding — collisions happened 2026-07-21)

Two Claude sessions working in THIS checkout at the same time caused real
incidents: a `git stash` in one session swept the other's uncommitted work
(recovered only via `git fsck`), two dev servers corrupted the shared `.next`,
and simultaneous staging builds broke each other. Rules:

1. **One checkout per session.** If another session may be active here, work in
   your own clone (e.g. `git clone /Users/ethan/Odoo_Portal_18EE ~/portal-<name>`
   — symlink `node_modules`, copy `.env.local` + `data/portal.db`) and sync
   through GitHub `main`. The clone is disposable; GitHub is the meeting point.
2. **Never `git stash`, `git reset`, `git checkout -- .`, or any
   whole-tree git operation in a checkout you might share.** Pathspec-limited
   commands only (`git commit -- <your files>`).
3. **Commit + push after every completed phase** — never hold hours of
   uncommitted work in a shared tree.
4. **One dev server per checkout.** Before `npm run dev`, check
   `ps aux | grep next` — if a server is already running here, use your own clone.
5. **Deploys always via the flock command above.**

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

## Canonical Record Page Rule (binding — all portal modules)

Every important business object (employee, product, inventory item, supplier, PO, shift handover,
production batch, attendance, recipe, equipment, customer, incident, task, …) has ONE **canonical
record page** — the authoritative page for a single record. Full spec: vault
`claude-memory/feedback_canonical_record_page.md`.

- **Anywhere a record appears** (list, dashboard, table, card, search result, notification, report,
  calendar, Kanban, activity feed, related-record section), clicking its name / primary identifier
  opens that record's canonical page.
- **Stable, shareable, record-based URL** — e.g. `/products/456`, `/staff/123`. Never a route that
  depends on where it was opened from; never a duplicate detail view isolated inside one module.
- **Before creating any detail page, check whether a canonical page already exists** — reuse / link /
  extend it; do NOT create a second competing page. If none exists, create it, give it the stable
  route, and point all lists/references at it.
- Canonical page = one record; clear identity + status; key info; links to RELATED records (each
  opening ITS OWN canonical page); permitted actions (edit/archive/approve/assign/print/export/delete)
  respecting permissions; clear back-to-parent nav; works on direct URL + refresh + desktop/mobile.
- Modals / drawers / quick-previews are fine for fast inspection but must include an "Open full
  record" action — they never REPLACE the canonical page.
- Editing happens on the canonical page or an edit form that returns to it; no duplicate edit forms
  for the same record (same model / validation / permissions / business logic).
- In-repo example: `/products/[id]` is the canonical product page; `/inventory/product/[id]` redirects to it.

## Design Principles (binding — learned the hard way)

These encode real bugs this codebase shipped or nearly shipped. They are cheap to
follow and expensive to relearn.

1. **ONE canonical editor per piece of data.** Before building a new screen/editor,
   check whether that data already has one — reuse or link to it. A second editor
   for the same record/sub-record is a bug, not a feature. (The home-spots saga:
   one record was editable from four screens → "which one is real?". This extends
   the Canonical Record Page Rule to sub-records like placements.)

2. **A preview/summary/derived view must REUSE the real logic, never re-implement
   it.** If the system computes something elsewhere (an order, a route, a total),
   call that same function. Parallel implementations drift silently. (A hand-rolled
   "By location" walk-order preview would have disagreed with the actual guided
   count; the fix was to reuse `buildGuidedRoute`.)

3. **Destructive ops on live business data (counts, money, Odoo writes) must be
   GUARDED, ATOMIC, and FAIL-CLOSED.** Never delete before you can recreate; wrap
   delete+recreate in one transaction; guards must protect work already started
   and default to "don't touch" when unsure. (`regenerateTodaySession` could delete
   a schedule-drifted count with no replacement, and `untouchedTodaySessionId`
   ignored status-only progress → wiped skip-reasons.)

4. **Async screens need a disciplined load lifecycle — don't hand-roll it per
   screen.** Loading/error state, a staleness/request token so only the latest
   response writes state, and loading for the RIGHT scope (not a global switcher).
   A preview presented as authoritative must not render from half-loaded/failed
   data. (Five stale/race/wrong-company preview bugs, all the same shape — a shared
   data-loading hook is the standing fix.)

5. **Anything touching counts, money, or Odoo writes gets an ADVERSARIAL review
   (Codex / a second reasoner told to attack it) before shipping — and ship in
   small, independently-deployable, reversible increments.** Type-checking and a
   green build pass on data-loss bugs; only an attacker's-eye review catches them.

6. **Show data's scope/provenance in the UI, and make every block ACTIONABLE**
   (explain *why* + the next step). (Global-vs-per-list home spots confused users
   until labelled; the correct "can't delete the *head* unit" guard read as a bug
   because it gave no reason or path forward.)

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
- **Inventory**: Live — screens (dashboard, my-lists, quick-count, mo-ingredients, manage, review, locations, goods-received, drinks), 13+ API routes, SQLite for templates/sessions/counts/photos/drafts/flags/placements, approve writes back to Odoo `stock.quant.inventory_quantity` + `action_apply_inventory`. Includes barcode scanning, scan-to-create draft products, per-line photo proof. Module exists end-to-end but is NOT yet in active production use (see feedback: manufacturing must not gate on stock).
- **Products**: Live — its OWN top-level module (`/products`, manager-gated), split out of Inventory 2026-07-22. Product catalog list + canonical product page `/products/[id]` (the Universal Record Drill-Down target for products). Edit still gated by `inventory.productsettings.manage` (module id `products`). Old `/inventory/product/[id]` server-redirects here.
- **HR/Onboarding**: 7-step DATEV wizard, DocumentCapture, FilePicker, profile photos
- **Chef Guide**: Concurrent cook sessions, Kitchen Board, global timer alerts
- **Issues & Requests**: Mock complete (17 screens), not yet coded

## Related: Odoo Custom Modules

Odoo custom addons at `/opt/odoo/18.0/custom-addons/` — separate workspace.
The `krawings_recipe_config` module provides recipe data to this portal.
Do NOT modify Odoo modules from this workspace.
