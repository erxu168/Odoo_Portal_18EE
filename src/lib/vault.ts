// src/lib/vault.ts
// Credentials vault — AES-256-GCM encryption + audit logging
// Krawings Portal · krawings_rentals v1.1.0
//
// Requires env var: KRAWINGS_VAULT_KEY (64 hex chars = 32 bytes)
// Generate one with: openssl rand -hex 32
//
// Storage strategy:
//  - One unique 12-byte IV per encrypted column SET (per row),
//    serialized as base64. Concatenate plaintexts with a separator
//    that cannot appear in any field (we use \x1f = unit separator).
//  - One AES-GCM auth_tag covering the whole row, base64.
//  - Decryption rejects on tag mismatch (tamper detection).

import crypto from 'crypto';
import {
  CredentialEntry,
  CredentialEntryDecrypted,
  CredentialAuditLog,
  AuditAction,
  CredentialCategory,
} from '@/types/rentals';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const FIELD_SEP = '\x1f'; // ASCII unit separator — never appears in passwords

function getKey(): Buffer {
  const hex = process.env.KRAWINGS_VAULT_KEY;
  if (!hex) {
    throw new Error(
      'KRAWINGS_VAULT_KEY env var is not set. Generate with: openssl rand -hex 32'
    );
  }
  if (hex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `KRAWINGS_VAULT_KEY must be ${KEY_LENGTH * 2} hex chars (got ${hex.length})`
    );
  }
  return Buffer.from(hex, 'hex');
}

// ============================================================================
// Encrypt / decrypt primitives
// ============================================================================

interface EncryptedBundle {
  username_enc: string;
  password_enc: string;
  notes_enc: string | null;
  iv: string;
  auth_tag: string;
}

export function encryptCredentials(
  username: string,
  password: string,
  notes: string | null
): EncryptedBundle {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt each field independently but bind them with the same IV+tag.
  // We do this by encrypting one combined plaintext, then splitting on
  // FIELD_SEP after decryption. This guarantees all three fields share
  // the same auth_tag and cannot be swapped between rows.
  const combined = [username, password, notes ?? ''].join(FIELD_SEP);
  const enc = Buffer.concat([cipher.update(combined, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    username_enc: enc.toString('base64'),
    password_enc: '', // unused — combined into username_enc
    notes_enc: notes !== null ? '1' : null, // sentinel: was notes provided
    iv: iv.toString('base64'),
    auth_tag: tag.toString('base64'),
  };
}

export function decryptCredentials(row: CredentialEntry): {
  username: string;
  password: string;
  notes: string | null;
} {
  const key = getKey();
  const iv = Buffer.from(row.iv, 'base64');
  const tag = Buffer.from(row.auth_tag, 'base64');
  const enc = Buffer.from(row.username_enc, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  const parts = dec.split(FIELD_SEP);
  if (parts.length !== 3) {
    throw new Error('Vault decrypt: malformed plaintext');
  }
  const [username, password, notesRaw] = parts;
  return {
    username,
    password,
    notes: row.notes_enc !== null ? notesRaw : null,
  };
}

// ============================================================================
// CRUD operations (with audit logging)
// ============================================================================

export interface CreateCredentialInput {
  property_id: number;
  label: string;
  category: CredentialCategory;
  url: string | null;
  username: string;
  password: string;
  notes: string | null;
}

export function createCredential(
  input: CreateCredentialInput,
  user_id: number,
  ip: string | null,
  user_agent: string | null
): number {
  const db = getRentalsDb();
  const bundle = encryptCredentials(input.username, input.password, input.notes);
  const now = berlinNow();

  const result = db
    .prepare(
      `INSERT INTO credentials_vault
       (property_id, label, category, url, username_enc, password_enc, notes_enc,
        iv, auth_tag, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.property_id,
      input.label,
      input.category,
      input.url,
      bundle.username_enc,
      bundle.password_enc,
      bundle.notes_enc,
      bundle.iv,
      bundle.auth_tag,
      user_id,
      now,
      now
    );

  const id = Number(result.lastInsertRowid);
  logAudit(id, user_id, 'create', ip, user_agent);
  return id;
}

export function listCredentialsForProperty(
  property_id: number,
  user_id: number,
  ip: string | null,
  user_agent: string | null
): Omit<CredentialEntryDecrypted, 'username' | 'password' | 'notes'>[] {
  const db = getRentalsDb();
  const rows = db
    .prepare(
      `SELECT id, property_id, label, category, url, created_at, updated_at
       FROM credentials_vault
       WHERE property_id = ?
       ORDER BY label COLLATE NOCASE`
    )
    .all(property_id) as Omit<
    CredentialEntryDecrypted,
    'username' | 'password' | 'notes'
  >[];

  logAudit(null, user_id, 'view', ip, user_agent);
  return rows;
}

export function revealCredential(
  id: number,
  user_id: number,
  ip: string | null,
  user_agent: string | null
): CredentialEntryDecrypted | null {
  const db = getRentalsDb();
  const row = db
    .prepare(`SELECT * FROM credentials_vault WHERE id = ?`)
    .get(id) as CredentialEntry | undefined;

  if (!row) return null;

  const decrypted = decryptCredentials(row);
  logAudit(id, user_id, 'reveal', ip, user_agent);

  return {
    id: row.id,
    property_id: row.property_id,
    label: row.label,
    category: row.category,
    url: row.url,
    username: decrypted.username,
    password: decrypted.password,
    notes: decrypted.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function updateCredential(
  id: number,
  input: Partial<CreateCredentialInput>,
  user_id: number,
  ip: string | null,
  user_agent: string | null
): boolean {
  const db = getRentalsDb();
  const existing = db
    .prepare(`SELECT * FROM credentials_vault WHERE id = ?`)
    .get(id) as CredentialEntry | undefined;
  if (!existing) return false;

  const current = decryptCredentials(existing);
  const newUsername = input.username ?? current.username;
  const newPassword = input.password ?? current.password;
  const newNotes = input.notes !== undefined ? input.notes : current.notes;

  const bundle = encryptCredentials(newUsername, newPassword, newNotes);
  const now = berlinNow();

  db.prepare(
    `UPDATE credentials_vault
     SET label = COALESCE(?, label),
         category = COALESCE(?, category),
         url = COALESCE(?, url),
         username_enc = ?,
         password_enc = ?,
         notes_enc = ?,
         iv = ?,
         auth_tag = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    input.label ?? null,
    input.category ?? null,
    input.url ?? null,
    bundle.username_enc,
    bundle.password_enc,
    bundle.notes_enc,
    bundle.iv,
    bundle.auth_tag,
    now,
    id
  );

  logAudit(id, user_id, 'update', ip, user_agent);
  return true;
}

export function deleteCredential(
  id: number,
  user_id: number,
  ip: string | null,
  user_agent: string | null
): boolean {
  const db = getRentalsDb();
  // Log BEFORE delete so vault_id FK can resolve
  logAudit(id, user_id, 'delete', ip, user_agent);
  const result = db.prepare(`DELETE FROM credentials_vault WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ============================================================================
// Audit log
// ============================================================================

export function logAudit(
  vault_id: number | null,
  user_id: number,
  action: AuditAction,
  ip: string | null,
  user_agent: string | null
): void {
  const db = getRentalsDb();
  db.prepare(
    `INSERT INTO credentials_audit (vault_id, user_id, action, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(vault_id, user_id, action, ip, user_agent, berlinNow());
}

export function getAuditLogForVault(vault_id: number, limit = 100): CredentialAuditLog[] {
  const db = getRentalsDb();
  return db
    .prepare(
      `SELECT * FROM credentials_audit
       WHERE vault_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(vault_id, limit) as CredentialAuditLog[];
}

export function getRecentAuditLog(limit = 100): CredentialAuditLog[] {
  const db = getRentalsDb();
  return db
    .prepare(
      `SELECT * FROM credentials_audit
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as CredentialAuditLog[];
}
