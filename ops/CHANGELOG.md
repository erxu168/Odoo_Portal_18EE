# Portal auto-sync — changelog

## 2026-07-16 — v2: build-aside deploys
- Deploys now **build in an isolated workspace** (`/opt/portal-build`); the live site is never
  touched by a build. A failed build leaves the running site fully intact (no rollback needed) —
  fixes the 2026-07-15 incident where an in-place build failure + a failed rollback-rebuild caused
  a ~5 min outage.
- Only a **successful** build is swapped in (same-filesystem renames during a brief restart).
- **Rollback is now an instant artifact swap-back** (`.next.prev`) with **no rebuild**, so it can't
  fail the way last night's rebuild-on-rollback did.
- Startup DB migrations are additive (`ADD COLUMN … DEFAULT`), so a code swap-back is DB-safe.

## 2026-07-15 — v1 (staging live)
- Initial system: staging auto-deploy (cron */2), production `golive` (manual),
  hourly drift watchdog, Obsidian deploy log + alerts.
- Guarded deploy: WAL-safe SQLite backup → fast-forward-only to a pinned SHA →
  `npm ci` only on lockfile change → build → **DB-backed health check**
  (`/api/kiosk/staff?company_id=…`, body contains `"staff"`) → auto-rollback +
  failed-SHA quarantine.
- Hardened per two Codex reviews: subshell-safe state classification, pinned-SHA
  go-live (lock before confirm), scoped + `timeout`-bounded vault sync (never
  `git add -A`), sleep-free watchdog, root-only logs/locks (`/var/log/portal-sync`,
  `/run/portal-sync`), durable fetch-failure alerting.
- Proven hands-free on staging: pushes auto-deploy within ~2 min and log to the
  Obsidian vault (which syncs to GitHub → phone).
