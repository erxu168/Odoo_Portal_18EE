/**
 * Remote restart — device registry + restart command queue (Phase 1: web reload).
 *
 * Running app instances (KDS boards, kiosk tablets, portal phones, the Capacitor
 * shells) each register a stable client id here via a heartbeat (POST /api/device/ping)
 * and report their current on-screen "surface" (kds / kiosk / portal). A manager (or
 * the auto-deploy hook) issues a restart *command* targeting one device, an app
 * surface, or the auto-restart fleet; the command materialises a row per recipient so
 * a device registered later never executes an older broadcast. The device polls, sees
 * the pending command, and restarts once (native relaunch in Phase 2; a cache-busting
 * reload today), then reports it confirmed.
 *
 * Follows the feature-scoped `*-db.ts` pattern (lazy ensureTables + getDb), like
 * kds-db.ts. Everything is company-scoped for managers; admins see all incl. unbound
 * public KDS/browser clients.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from './db';

function nowISO(): string {
  return new Date().toISOString();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Deterministic per-device fraction in [0,1) from the client id — used to spread
 *  a group restart over a window so every KDS tablet doesn't reconnect at once. */
function seededFraction(clientId: string): number {
  let h = 2166136261;
  for (let i = 0; i < clientId.length; i++) {
    h ^= clientId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Surfaces/shells that are unattended displays → default eligible for auto restart
 *  on deploy. Interactive shells (station/portal) default OFF (may hold unsaved work). */
function defaultAutoRestart(shell: string | null, surface: string | null): number {
  const s = (surface || '').toLowerCase();
  const sh = (shell || '').toLowerCase();
  if (s === 'kds' || s === 'kiosk') return 1;
  if (sh === 'timeclock' || sh === 'kiosk') return 1;
  return 0;
}

let _initialized = false;
function ensureTables(): void {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    -- A running app instance (a browser tab / Capacitor WebView). The client id is a
    -- UUID the client generates and keeps in localStorage; the secret (hash stored
    -- here, raw issued once on first contact) stops another client hijacking that id.
    CREATE TABLE IF NOT EXISTS device_clients (
      client_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      label TEXT,
      shell TEXT,                                 -- native platform/shell: web | android | ...
      surface TEXT,                               -- current route surface: kds | kiosk | portal
      native_relaunch INTEGER NOT NULL DEFAULT 0, -- device has the native relaunch plugin (Phase 2)
      app_version TEXT,
      company_id INTEGER,                         -- trusted company from the session, else NULL (unbound)
      station_device_id INTEGER,                  -- link to station_devices.id when this is a provisioned tablet
      auto_restart INTEGER NOT NULL DEFAULT 0,    -- eligible for auto-on-deploy restart (manager override wins)
      auto_restart_explicit INTEGER NOT NULL DEFAULT 0, -- a manager set auto_restart by hand → stop auto-deriving it
      user_id INTEGER,                            -- last known signed-in user (display only)
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      last_confirmed_command_id INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_device_clients_last_seen ON device_clients(last_seen);
    CREATE INDEX IF NOT EXISTS idx_device_clients_company ON device_clients(company_id);

    -- One issued restart instruction. Recipients are materialised in
    -- device_restart_targets at creation time (snapshot of who matched).
    CREATE TABLE IF NOT EXISTS device_restart_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,                        -- manager | admin | deploy
      reason TEXT,
      deploy_sha TEXT,
      idempotency_key TEXT UNIQUE,                 -- deploy: sha-derived (dedupes retries); NULL for manual
      spread_ms INTEGER NOT NULL DEFAULT 0,        -- 0 = restart now; >0 = stagger recipients across this window
      created_by TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_restart_targets (
      command_id INTEGER NOT NULL REFERENCES device_restart_commands(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES device_clients(client_id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending',       -- pending -> delivered -> confirmed
      delivered_at TEXT,
      confirmed_at TEXT,
      PRIMARY KEY (command_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS idx_restart_targets_client ON device_restart_targets(client_id, state);
  `);
  // Migration: add auto_restart_explicit to a device_clients table created before it
  // existed (tolerate a concurrent add; surface any other failure).
  const cols = db.prepare('PRAGMA table_info(device_clients)').all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === 'auto_restart_explicit')) {
    try {
      db.exec('ALTER TABLE device_clients ADD COLUMN auto_restart_explicit INTEGER NOT NULL DEFAULT 0');
    } catch (e) {
      if (!String((e as Error)?.message).includes('duplicate column')) throw e;
    }
  }
  _initialized = true;
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

export interface HeartbeatInput {
  clientId: string;
  secret?: string;
  shell?: string | null;
  surface?: string | null;
  nativeRelaunch?: boolean;
  appVersion?: string | null;
  lastExecutedCommandId?: number;
  /** Trusted, server-derived (never from the client body). */
  sessionCompanyId?: number | null;
  sessionUserId?: number | null;
  stationDeviceId?: number | null;
}

export interface HeartbeatResult {
  ok: boolean;
  error?: string;
  /** Raw client secret — returned exactly once, on first registration. */
  issuedSecret?: string;
  restart: { commandId: number; delayMs: number } | null;
}

// Keep the online window comfortably ABOVE the last_seen write throttle (+ a poll
// cycle) — otherwise a live device that is merely throttling its writes flickers
// "offline" between beats and disables the group-restart buttons.
const LAST_SEEN_THROTTLE_MS = 20_000;
const ONLINE_WINDOW_MS = 45_000;

interface ClientRecord {
  client_id: string;
  secret_hash: string;
  surface: string | null;
  shell: string | null;
  company_id: number | null;
  last_seen: string;
  last_confirmed_command_id: number;
}

function clamp(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = String(s).slice(0, max);
  return t.length ? t : null;
}

export function heartbeat(input: HeartbeatInput): HeartbeatResult {
  ensureTables();
  const db = getDb();
  const now = nowISO();
  const clientId = input.clientId;
  if (!clientId || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
    return { ok: false, error: 'bad_client_id', restart: null };
  }

  const shell = clamp(input.shell, 32);
  const surface = clamp(input.surface, 32);
  const appVersion = clamp(input.appVersion, 32);
  const native = input.nativeRelaunch ? 1 : 0;
  const lastExec = Number.isFinite(input.lastExecutedCommandId) ? Number(input.lastExecutedCommandId) : 0;

  const existing = db
    .prepare(
      'SELECT client_id, secret_hash, surface, shell, company_id, last_seen, last_confirmed_command_id FROM device_clients WHERE client_id = ?',
    )
    .get(clientId) as ClientRecord | undefined;

  let issuedSecret: string | undefined;

  if (!existing) {
    const secret = randomBytes(24).toString('hex');
    issuedSecret = secret;
    db.prepare(
      `INSERT INTO device_clients
        (client_id, secret_hash, label, shell, surface, native_relaunch, app_version,
         company_id, station_device_id, auto_restart, user_id, first_seen, last_seen, last_confirmed_command_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      clientId,
      sha256(secret),
      shell,
      surface,
      native,
      appVersion,
      input.sessionCompanyId ?? null,
      input.stationDeviceId ?? null,
      defaultAutoRestart(shell, surface),
      input.sessionUserId ?? null,
      now,
      now,
      lastExec,
    );
  } else {
    // Verify the client owns this id. A registered client MUST present its secret.
    if (!input.secret || existing.secret_hash !== sha256(input.secret)) {
      return { ok: false, error: 'bad_credential', restart: null };
    }
    const seenMs = Date.parse(existing.last_seen);
    const changed = existing.surface !== surface || existing.shell !== shell;
    const throttled = Number.isFinite(seenMs) && Date.now() - seenMs < LAST_SEEN_THROTTLE_MS && !changed;
    if (!throttled) {
      // Re-derive auto_restart as devices move onto unattended surfaces (a KDS tablet
      // often first registers on /login), UNLESS a manager set it by hand. It's sticky:
      // once seen on kds/kiosk it stays eligible (a KDS screen briefly showing a menu is
      // still a KDS screen). bitwise OR keeps a previously-derived 1.
      const autoBump = defaultAutoRestart(shell, surface);
      db.prepare(
        `UPDATE device_clients SET
           last_seen = ?, surface = ?, shell = ?, native_relaunch = ?, app_version = ?,
           company_id = COALESCE(?, company_id),
           station_device_id = COALESCE(?, station_device_id),
           user_id = COALESCE(?, user_id),
           auto_restart = CASE WHEN auto_restart_explicit = 1 THEN auto_restart ELSE (auto_restart | ?) END
         WHERE client_id = ?`,
      ).run(
        now,
        surface,
        shell,
        native,
        appVersion,
        input.sessionCompanyId ?? null,
        input.stationDeviceId ?? null,
        input.sessionUserId ?? null,
        autoBump,
        clientId,
      );
    }
  }

  // The client tells us the highest command id it has actually executed — mark those
  // targets confirmed and advance the cursor so we never re-instruct an executed one.
  if (lastExec > 0) {
    db.prepare(
      "UPDATE device_restart_targets SET state = 'confirmed', confirmed_at = ? WHERE client_id = ? AND command_id <= ? AND state != 'confirmed'",
    ).run(now, clientId, lastExec);
    db.prepare(
      'UPDATE device_clients SET last_confirmed_command_id = ? WHERE client_id = ? AND last_confirmed_command_id < ?',
    ).run(lastExec, clientId, lastExec);
  }

  const cursor = Math.max(existing?.last_confirmed_command_id ?? 0, lastExec);
  const cmd = db
    .prepare(
      `SELECT c.id AS id, c.spread_ms AS spread_ms
         FROM device_restart_targets t
         JOIN device_restart_commands c ON c.id = t.command_id
        WHERE t.client_id = ? AND t.state != 'confirmed' AND c.expires_at > ? AND c.id > ?
        ORDER BY c.id ASC LIMIT 1`,
    )
    .get(clientId, now, cursor) as { id: number; spread_ms: number } | undefined;

  let restart: HeartbeatResult['restart'] = null;
  if (cmd) {
    db.prepare(
      "UPDATE device_restart_targets SET state = 'delivered', delivered_at = COALESCE(delivered_at, ?) WHERE command_id = ? AND client_id = ? AND state = 'pending'",
    ).run(now, cmd.id, clientId);
    const spread = cmd.spread_ms > 0 ? cmd.spread_ms : 0;
    const delayMs = spread > 0 ? Math.floor(seededFraction(clientId) * spread) : 300;
    restart = { commandId: cmd.id, delayMs };
  }

  return { ok: true, issuedSecret, restart };
}

// ── Admin: list / target / issue ─────────────────────────────────────────────

export interface DeviceClientRow {
  client_id: string;
  label: string | null;
  shell: string | null;
  surface: string | null;
  native_relaunch: boolean;
  app_version: string | null;
  company_id: number | null;
  station_device_id: number | null;
  auto_restart: boolean;
  first_seen: string;
  last_seen: string;
  online: boolean;
  pending: boolean;
}

interface RawClientRow {
  client_id: string;
  label: string | null;
  shell: string | null;
  surface: string | null;
  native_relaunch: number;
  app_version: string | null;
  company_id: number | null;
  station_device_id: number | null;
  auto_restart: number;
  first_seen: string;
  last_seen: string;
  pending: number;
}

/** Clients a manager may see. companyIds=null → admin (all, incl. unbound company_id NULL). */
export function listDeviceClients(companyIds: number[] | null): DeviceClientRow[] {
  ensureTables();
  const db = getDb();
  const nowMs = Date.now();
  const rows = db
    .prepare(
      `SELECT dc.*,
              (SELECT COUNT(*) FROM device_restart_targets t
                 JOIN device_restart_commands c ON c.id = t.command_id
                WHERE t.client_id = dc.client_id AND t.state != 'confirmed' AND c.expires_at > ?) AS pending
         FROM device_clients dc
        ORDER BY dc.last_seen DESC`,
    )
    .all(nowISO()) as RawClientRow[];
  const scoped = companyIds === null ? rows : rows.filter((r) => r.company_id != null && companyIds.includes(r.company_id));
  return scoped.map((r) => ({
    client_id: r.client_id,
    label: r.label,
    shell: r.shell,
    surface: r.surface,
    native_relaunch: !!r.native_relaunch,
    app_version: r.app_version,
    company_id: r.company_id,
    station_device_id: r.station_device_id,
    auto_restart: !!r.auto_restart,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    online: nowMs - Date.parse(r.last_seen) < ONLINE_WINDOW_MS,
    pending: r.pending > 0,
  }));
}

/** A client's trusted company (for authorising a manager action), or null if unbound/unknown. */
export function getDeviceClientCompany(clientId: string): number | null | undefined {
  ensureTables();
  const row = getDb().prepare('SELECT company_id FROM device_clients WHERE client_id = ?').get(clientId) as
    | { company_id: number | null }
    | undefined;
  if (!row) return undefined; // not found
  return row.company_id; // may be null (unbound → admin-only)
}

export type RestartScope =
  | { type: 'client'; clientId: string }
  | { type: 'surface'; surface: string }
  | { type: 'auto' } // auto-restart fleet (deploy hook)
  | { type: 'all' };

const RECENT_TARGET_WINDOW_MS = 15 * 60_000;

/** Resolve a scope to concrete client ids, respecting company scope for managers.
 *  companyIds=null → no company restriction (admin, or the system deploy actor). */
function resolveTargetClientIds(scope: RestartScope, companyIds: number[] | null): string[] {
  const db = getDb();
  const recentCutoff = new Date(Date.now() - RECENT_TARGET_WINDOW_MS).toISOString();
  let rows: { client_id: string; company_id: number | null }[];
  if (scope.type === 'client') {
    rows = db.prepare('SELECT client_id, company_id FROM device_clients WHERE client_id = ?').all(scope.clientId) as typeof rows;
  } else if (scope.type === 'surface') {
    rows = db
      .prepare('SELECT client_id, company_id FROM device_clients WHERE surface = ? AND last_seen > ?')
      .all(scope.surface, recentCutoff) as typeof rows;
  } else if (scope.type === 'auto') {
    rows = db
      .prepare('SELECT client_id, company_id FROM device_clients WHERE auto_restart = 1 AND last_seen > ?')
      .all(recentCutoff) as typeof rows;
  } else {
    rows = db.prepare('SELECT client_id, company_id FROM device_clients WHERE last_seen > ?').all(recentCutoff) as typeof rows;
  }
  const scoped = companyIds === null ? rows : rows.filter((r) => r.company_id != null && companyIds.includes(r.company_id));
  return scoped.map((r) => r.client_id);
}

export interface IssueRestartOpts {
  scope: RestartScope;
  source: 'manager' | 'admin' | 'deploy';
  createdBy: string;
  reason?: string | null;
  deploySha?: string | null;
  idempotencyKey?: string | null;
  spreadMs?: number;
  ttlSec?: number;
  /** Manager/admin company scope; null = unrestricted (admin or deploy). */
  companyIds: number[] | null;
}

export interface IssueRestartResult {
  commandId: number;
  recipients: number;
  deduped: boolean;
}

/** Create a restart command and materialise its recipient rows. Idempotent when an
 *  idempotencyKey is given (a deploy retry for the same SHA returns the same command). */
export function issueRestartCommand(opts: IssueRestartOpts): IssueRestartResult {
  ensureTables();
  const db = getDb();
  const now = nowISO();

  if (opts.idempotencyKey) {
    const dup = db
      .prepare('SELECT id FROM device_restart_commands WHERE idempotency_key = ?')
      .get(opts.idempotencyKey) as { id: number } | undefined;
    if (dup) {
      const n = db
        .prepare('SELECT COUNT(*) AS c FROM device_restart_targets WHERE command_id = ?')
        .get(dup.id) as { c: number };
      return { commandId: dup.id, recipients: n.c, deduped: true };
    }
  }

  const ttlSec = opts.ttlSec ?? 15 * 60;
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const spreadMs = Math.max(0, opts.spreadMs ?? 0);

  const targets = resolveTargetClientIds(opts.scope, opts.companyIds);

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO device_restart_commands (source, reason, deploy_sha, idempotency_key, spread_ms, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.source,
        opts.reason ?? null,
        opts.deploySha ?? null,
        opts.idempotencyKey ?? null,
        spreadMs,
        opts.createdBy,
        now,
        expiresAt,
      );
    const commandId = Number(info.lastInsertRowid);
    const insTarget = db.prepare(
      "INSERT OR IGNORE INTO device_restart_targets (command_id, client_id, state) VALUES (?, ?, 'pending')",
    );
    for (const cid of targets) insTarget.run(commandId, cid);
    return commandId;
  });
  const commandId = tx();
  return { commandId, recipients: targets.length, deduped: false };
}

/** Toggle a client's auto-restart eligibility (company-scoped). Returns false if not allowed/found. */
export function setDeviceAutoRestart(clientId: string, on: boolean, companyIds: number[] | null): boolean {
  ensureTables();
  const company = getDeviceClientCompany(clientId);
  if (company === undefined) return false;
  if (companyIds !== null && (company == null || !companyIds.includes(company))) return false;
  // A manual toggle is authoritative — stop auto-deriving auto_restart for this device.
  getDb()
    .prepare('UPDATE device_clients SET auto_restart = ?, auto_restart_explicit = 1 WHERE client_id = ?')
    .run(on ? 1 : 0, clientId);
  return true;
}

/** Rename a client (company-scoped). Returns false if not allowed/found. */
export function renameDeviceClient(clientId: string, label: string | null, companyIds: number[] | null): boolean {
  ensureTables();
  const company = getDeviceClientCompany(clientId);
  if (company === undefined) return false;
  if (companyIds !== null && (company == null || !companyIds.includes(company))) return false;
  getDb().prepare('UPDATE device_clients SET label = ? WHERE client_id = ?').run(clamp(label, 60), clientId);
  return true;
}

/** Drop clients not seen for `days` — keeps the registry from growing unbounded. */
export function pruneStaleDeviceClients(days = 30): number {
  ensureTables();
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const info = getDb().prepare('DELETE FROM device_clients WHERE last_seen < ?').run(cutoff);
  return info.changes;
}
