# Portal auto-sync system — design

**Date:** 2026-07-15
**Goal:** Keep GitHub, the staging server, production, and Obsidian always in sync, so
nothing is ever "deployed but not on GitHub." GitHub `main` is the single source of
truth; servers only pull.

## Invariant
Every server's deployed code equals `origin/main` (or is *behind* it, never ahead or
edited). "Behind" is fine (not deployed yet). "Ahead / dirty / wrong branch" is the bug
we detect and alert on.

## Components

### 1. Staging auto-deploy (`portal-autodeploy.sh`, cron every 2 min)
- `flock` so runs never overlap (a build outlasts the 2-min tick).
- `git fetch`. If `HEAD == origin/main` → nothing to do.
- **Refuse to deploy** (write drift alert, exit) if the tracked tree is dirty, the branch
  isn't `main`, or HEAD has commits not on `origin/main`. Never `reset` over local work.
- Else (clean, on `main`, behind) → **guarded deploy** (below).

### 2. Guarded deploy (shared by auto-deploy and golive)
1. WAL-safe `sqlite3 .backup` of every `data/*.db` / `data/*.sqlite` → `*.autobak-<ts>`
   (keep last 10). Abort if the backup fails.
2. `git merge --ff-only origin/main` (fast-forward only; can't rewrite history).
3. `npm ci` **only if** `package-lock.json`/`package.json` changed.
4. `npm run build`.
5. `systemctl restart <service>`.
6. Health check: `GET /kiosk` == 200 (DB-backed route), retries.
7. On any failure at 3–6 → `git reset --hard <oldsha>` + rebuild + restart (**rollback**),
   then alert. DB backup is preserved for manual restore if a startup migration ran.
8. On success → append a line to the Obsidian deploy log.

### 3. Production go-live (`portal-golive.sh`, manual only)
- Shows `git log <HEAD>..origin/main` (what will change), requires typed `yes`.
- Then the same guarded deploy. **Prod is 321 commits behind and stays parked** until
  this is run deliberately.

### 4. Drift watchdog (`portal-drift-check.sh`, cron hourly on both servers)
- Alert to Obsidian if: tracked tree dirty, branch ≠ `main`, or HEAD has local-only
  commits. On staging, also alert if it's been *behind* for >15 min (auto-deploy stuck).
- `behind` alone is OK on prod (manual deploys).

### 5. Obsidian logging
- Deploy log → `Claude/deploys/deploy-log.md`; alerts → `Claude/deploys/drift-alerts.md`,
  in the git-backed vault (`/opt/obsidian-vault` → `erxu168/obsidian-vault`). Each write
  commits + pushes immediately so it reaches the phone in seconds (vault-push failures are
  non-fatal — never block a deploy).

## Layout
- Canonical scripts in repo `ops/`; installed to `/usr/local/bin/` by `ops/install.sh`.
- Per-server config `/etc/portal-sync.conf` (`PORTAL_ENV`, dir, port, service, health path,
  vault dir).
- Crons: staging = autodeploy (*/2) + drift (hourly); prod = drift (hourly) only.

## Safety properties
- Never force-push; only `--ff-only`.
- Never `reset --hard` over a dirty/ahead tree — alert instead.
- DB backed up before every restart; rollback on failed build/health.
- `flock` prevents overlapping deploys.
- Production is never auto-anything.
