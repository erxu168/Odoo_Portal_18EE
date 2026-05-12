/**
 * Web Push helper. Server-only — depends on the `web-push` Node package.
 * Subscriptions live in the portal SQLite next to portal_users; each row is one
 * browser/device the user has opted in from. When a subscription returns 404/410
 * we delete it (the browser revoked it).
 *
 * Required env vars (set in /opt/krawings-portal/.env.local on staging):
 *   VAPID_PUBLIC_KEY  — base64url
 *   VAPID_PRIVATE_KEY — base64url
 *   VAPID_SUBJECT     — mailto: URL or origin (e.g. mailto:biz@krawings.de)
 */
import 'server-only';
import webpush from 'web-push';
import { getDb } from './db';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:biz@krawings.de';

let _configured = false;
function ensureConfigured() {
  if (_configured) return;
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('VAPID keys are missing — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env.local');
  }
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  _configured = true;
}

export function getVapidPublicKey(): string {
  return PUBLIC_KEY;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;        // Where to open when the user taps the notification.
  tag?: string;        // Collapse key — newer pushes with the same tag replace older ones.
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function saveSubscription(userId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null = null): void {
  const db = getDb();
  const now = new Date().toISOString();
  // UPSERT by endpoint: if the same device re-subscribes, re-attach to this user.
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      last_used_at = excluded.last_used_at
  `).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent, now, now);
}

export function deleteSubscriptionByEndpoint(endpoint: string): void {
  getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export async function sendPushToUser(userId: number, payload: PushPayload): Promise<{ delivered: number; pruned: number }> {
  ensureConfigured();
  const subs = getDb()
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as SubRow[];

  let delivered = 0;
  let pruned = 0;
  await Promise.all(subs.map(async row => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
      );
      delivered++;
      getDb().prepare('UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), row.id);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        // Endpoint dead — clean it up.
        deleteSubscriptionByEndpoint(row.endpoint);
        pruned++;
      } else {
        console.error('[push] send failed', status, err);
      }
    }
  }));
  return { delivered, pruned };
}

export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<{ delivered: number; pruned: number }> {
  const results = await Promise.all(userIds.map(id => sendPushToUser(id, payload).catch(() => ({ delivered: 0, pruned: 0 }))));
  return results.reduce((acc, r) => ({ delivered: acc.delivered + r.delivered, pruned: acc.pruned + r.pruned }), { delivered: 0, pruned: 0 });
}
