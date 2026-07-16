# Portal auto-sync system (`ops/`)

Keeps **GitHub `main` = the single source of truth**. Servers only ever pull; nothing is
ever "deployed but not on GitHub." Full design: `docs/superpowers/specs/2026-07-15-portal-auto-sync-system-design.md`.

## Pieces
| Script | Where | When | Does |
|---|---|---|---|
| `portal-autodeploy.sh` | staging | cron `*/2 * * * *` | if `origin/main` moved and the server is clean-on-main-behind → guarded deploy |
| `portal-golive` | production | manual | shows the diff, requires typed `deploy <sha>`, then guarded deploy |
| `portal-drift-check.sh` | both | cron `17 * * * *` | alerts Obsidian (deduped) if the server ever drifts from `origin/main` |
| `portal-lib.sh` | both | (sourced) | guarded-deploy engine: DB backup → ff-only → build → restart → health → rollback |

## Guarded deploy — build-aside (safety rails)
The failure-prone step (build) runs in an **isolated workspace** (`/opt/portal-build`, a git
worktree), so **the live site is never touched by a build**:
1. Point the build workspace at the pinned SHA; `npm ci` there only if the lockfile changed.
2. **`npm run build` in the workspace** — if it fails, the **live site is untouched** (still serving
   the old version); the SHA is quarantined and an alert fires. No rollback needed.
3. WAL-safe SQLite backup (verified non-empty; keeps last `BACKUP_KEEP`).
4. Stage the built `.next` (+ `node_modules` if deps changed) next to live (same filesystem).
5. **Swap during a brief stop** — fast-forward the source to the pinned SHA and rename the new
   artifacts in (instant, same-fs renames), then restart.
6. **Health check** on a **DB-backed** route (`/api/kiosk/staff?company_id=…`, body must contain
   `"staff"`). On failure → **instant swap-back** of the previous artifacts (**no rebuild**, so the
   rollback can't fail the way a rebuild can), with a **CRITICAL** alert only if the swap-back is
   itself unhealthy. The previous build is retained as `.next.prev` for exactly this.
- **Failed-SHA quarantine** (`/var/lib/portal-sync/failed-sha`): a bad commit is deployed once, then skipped until a *new* commit or manual clear — no 2-minute failure loop.
- **Shared deploy lock** (`/run/portal-sync/deploy.lock`, root-only 0700 dir) across autodeploy + golive; the watchdog reads state under the lock then releases it (never sleeps holding it).
- **Alerts hit journald first** (`logger -t portal-sync`), then Obsidian — an outage can't hide an alert. The vault write stages **only its own note** (never `git add -A`), is `timeout`-bounded, and aborts a failed rebase. Per-env note files avoid two servers racing on one file.
- **Logs + locks live in root-only dirs** (`/var/log/portal-sync`, `/run/portal-sync`, both 0700) so predictable paths can't be symlink-hijacked.

## Install
```bash
# on each server, from the repo checkout:
sudo bash ops/install.sh staging       # staging  (autodeploy + drift crons)
sudo bash ops/install.sh production     # prod     (drift cron only; deploy is manual)
```
Config: `/etc/portal-sync.conf`. Logs: `/var/log/portal-autodeploy.log`, `/var/log/portal-drift.log`, `journalctl -t portal-sync`. Obsidian: `Claude/deploys/deploy-log-<env>.md` and `drift-alerts-<env>.md`.

## Go live on production
```bash
ssh root@<prod>; portal-golive        # interactive; prod stays parked until you run this
```

## Known limitations & recommended upgrades (from the Codex review)
These are accepted trade-offs for an **in-place** deploy on the current setup, matching how
the server already works. Worth doing later, in rough priority:
1. **Immutable releases + `current` symlink**: build each release in its own dir and switch
   atomically, so a failing `npm ci`/`next build` can't disturb the running site, and rollback
   is an instant symlink flip to the last known-good artifact.
2. **Move runtime state fully outside the checkout** (`data/`, uploads) — already effectively
   true (`data/` is gitignored); formalise it so no deploy can ever touch it.
3. **Run the app + deploy as an unprivileged user** with a narrow sudo rule for the one
   `systemctl restart`, instead of root (limits blast radius of any npm lifecycle script on `main`).
4. **Protect `main`** (review + a CI build check) since staging auto-deploys it.
5. **Versioned, backward-compatible DB migrations** so a rollback after a schema change is safe
   (today: the pre-deploy DB backup is the recovery path — restore it manually if a bad deploy
   migrated the DB).
