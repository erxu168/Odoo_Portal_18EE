/**
 * Seed the two throwaway accounts that tests/module-access.e2e.spec.ts drives.
 *
 * The browser suite in this repo used to auto-skip whenever SMOKE_EMAIL /
 * SMOKE_PASSWORD were absent — which was always, so CI reported a green
 * "Portal Smoke Test" that ran no browser at all. This script removes the
 * shared-secret dependency: the module-access suite makes its own users.
 *
 * SAFETY: point PORTAL_DB_PATH at a THROWAWAY database (a clone's
 * data/portal.db, or a temp file). It writes users; never run it against
 * production, and never against a database holding real people you care about.
 * Every account it makes is prefixed zz-e2e-mod- and it deletes that prefix
 * before re-creating, so it is idempotent and self-contained.
 *
 *   PORTAL_DB_PATH=./data/portal.db node scripts/seed-e2e-module-users.mjs
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const dbPath = process.env.PORTAL_DB_PATH;
if (!dbPath) {
  console.error('Refusing to run: set PORTAL_DB_PATH to a throwaway database first.');
  process.exit(1);
}

const PASSWORD = process.env.E2E_PASSWORD || 'e2e-test-1234';
const db = new Database(dbPath);

// The app OWNS the schema (src/lib/db.ts initTables/migrateSchema). This script
// deliberately does not re-create it — a second copy of the schema would drift.
// So the server has to have opened this database at least once first.
const hasSchema = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='portal_users'")
  .get();
if (!hasSchema) {
  console.error(
    `No schema in ${dbPath}.\n` +
    'Start the app against this database once so it can create the tables, then re-run:\n' +
    '  PORTAL_DB_PATH=<db> npx next dev -p 3100 &   # then curl http://localhost:3100/login',
  );
  process.exit(1);
}

const hash = bcrypt.hashSync(PASSWORD, 10);
const now = new Date().toISOString();

db.prepare('DELETE FROM portal_users WHERE email LIKE ?').run('zz-e2e-mod-%');
const insert = db.prepare(
  "INSERT INTO portal_users (name, email, password_hash, role, status, active, must_change_password, allowed_company_ids, created_at) " +
  "VALUES (?, ?, ?, ?, 'active', 1, 0, '[]', ?)",
);
// module_access stays NULL on both: the point is to exercise the ROLE default,
// which is what the grid on /admin/permissions edits.
insert.run('ZZ E2E Module Staff', 'zz-e2e-mod-staff@test.krawings.de', hash, 'staff', now);
insert.run('ZZ E2E Module Admin', 'zz-e2e-mod-admin@test.krawings.de', hash, 'admin', now);

// Start from the built-in defaults so a leftover row can't skew a run.
db.prepare('DELETE FROM role_module_access').run();

console.log(
  db.prepare("SELECT id, name, role, module_access FROM portal_users WHERE email LIKE 'zz-e2e-mod-%'").all(),
);
