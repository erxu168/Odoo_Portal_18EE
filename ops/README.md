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

## Guarded deploy — safety rails
- **WAL-safe SQLite backup** of `data/*.db` before anything (verified non-empty; keeps last `BACKUP_KEEP`).
- **Fast-forward only** to a **pinned** `origin/main` SHA — never a force update, never over a dirty/diverged tree.
- `npm ci` only when the lockfile changed; **rollback re-installs the old lockfile's deps**.
- **Health check** on a **DB-backed** route (`/api/kiosk/staff?company_id=…`, body must contain `"staff"` — proves SQLite reads), then **auto-rollback** on any build/health failure (rollback captures every step), and a **CRITICAL** alert if the rollback itself is unhealthy.
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
