---
description: Deploy the portal to STAGING — local build gate, commit, push to GitHub, then pull+build+restart on staging, then smoke-test.
argument-hint: "[optional note for the commit message]"
---

# /ship — Deploy to staging (safe, gated)

Deploy the Krawings Portal to **STAGING ONLY** (`89.167.124.0`). **Never production.**
Optional argument `$ARGUMENTS` is a hint for the commit message.

Follow these steps **in order**. If any step fails, **STOP**, show the user the
error in plain language, and wait — do not continue with a broken deploy.

## 1. Pre-flight
- `git branch --show-current` must be `main`. If not, STOP and tell the user
  (single-branch rule — everything ships from `main`).
- `git status` + `git diff --stat`. Summarise for the user in plain language
  what changed. If there is nothing to deploy, say so and stop.

## 2. Local build gate (catch breakers before they ship)
- Run `npm run build`. Do **not** pipe it (piping masks the exit code).
- If the build fails, STOP, show the error, fix it, and rebuild. Never push
  code that fails `next build` — that is exactly what breaks the server deploy.

## 3. Commit + push  ⚠️ confirmation required
- Propose a commit message in the repo's style:
  `[FIX|ADD|IMP|REF] <area>: <short description>`
  (area = feature, e.g. `inventory`, `shifts`, `purchase`). Fold in `$ARGUMENTS`
  if given. One concern per commit — do not bundle unrelated changes.
- **Show the message to the user and ask them to confirm before committing.**
  This is the irreversible-action gate — no skipping it.
- On confirmation: `git add -A && git commit -m "<message>" && git push origin main`.

## 4. Deploy on staging
- `ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only && npm run build && systemctl restart krawings-portal'`
- Confirm it came back up:
  `ssh root@89.167.124.0 'systemctl is-active krawings-portal'` → expect `active`.
  If the server build fails, STOP and report it (the site is still on the old
  build; do not leave it half-deployed silently).

## 5. Verify (real browser)
- Run `npm run smoke:staging` and report pass/fail.
- If the Playwright MCP browser tools are available **and** the change is
  UI-facing: open the affected screen on `http://89.167.124.0:3000`, log in with
  a staging test account (Hana=staff, Marco=manager, biz@krawings.de=admin;
  password `test1234` for the test users), click through the changed flow, and
  report what you actually see — with a screenshot.

## 6. Report
Plain-language summary: what shipped, local build ✓/✗, service status, smoke
result. Remind the user this is **STAGING** — production is a separate,
deliberate step that only happens when they explicitly ask.
