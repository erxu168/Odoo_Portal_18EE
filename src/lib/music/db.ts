/**
 * WAJ Radio — database layer. Feature-owned tables inside data/portal.db.
 *
 * Three kinds of truth live here, deliberately separated (spec §10):
 *  - music_manual_decisions — a manager's allow/deny. Permanent. Highest genre authority.
 *  - music_gate_cache       — the automatic verdict (topic/LLM). Permanent internal record,
 *                             never overwritten by manual decisions (provenance).
 *  - music_video_metadata   — what YouTube told us. Refreshable, expires after 30 days
 *                             (compliance posture, spec §1a) and availability changes anyway.
 *
 * Playback is a single versioned row: every advance/skip/error must present the
 * version it observed, so duplicate IFrame events and double taps are no-ops.
 */
import { getDb } from '@/lib/db';

export const QUEUE_CAP = 50;
export const METADATA_TTL_DAYS = 30;
export const REPEAT_WINDOW_PLAYS = 50;
export const REPEAT_WINDOW_HOURS = 12;
export const MAX_DURATION_SECONDS = 15 * 60;

export type MusicGenre = 'hip_hop_rap' | 'reggae_dancehall_dub' | 'afrobeats_afro' | 'rnb_soul_funk';
export const ALL_GENRES: MusicGenre[] = ['hip_hop_rap', 'reggae_dancehall_dub', 'afrobeats_afro', 'rnb_soul_funk'];
export const GENRE_LABELS: Record<MusicGenre, string> = {
  hip_hop_rap: 'Hip hop / Rap',
  reggae_dancehall_dub: 'Reggae / Dancehall',
  afrobeats_afro: 'Afrobeats / Afro',
  rnb_soul_funk: 'R&B / Soul / Funk',
};
export type GateDecision = 'allow' | 'deny' | 'unsure';

export interface ManualDecision {
  video_id: string; decision: 'allow' | 'deny'; genre: MusicGenre | null;
  reason: string | null; decided_by_user_id: number; decided_by_name: string;
  created_at: string; updated_at: string;
}
export interface GateCache {
  video_id: string; decision: GateDecision; genre: MusicGenre | null;
  decision_source: 'youtube_topic' | 'claude'; reason_code: string;
  classifier_model: string | null; prompt_version: number | null; evaluated_at: string;
}
export interface VideoMetadataInput {
  videoId: string; title: string; channelId: string; channelTitle: string;
  durationSeconds: number | null; embeddable: boolean; madeForKids: boolean;
  live: boolean; regionBlockedDe: boolean; topicCategories: string[];
}
export interface VideoMetadata extends VideoMetadataInput { fetchedAt: string; expiresAt: string }
export interface MusicRequest {
  id: number; video_id: string; title: string; channel: string;
  status: 'pending' | 'approved' | 'denied';
  first_requested_by: string; first_requested_at: string;
  last_requested_by: string; last_requested_at: string;
  request_count: number; resolved_by: string | null; resolved_at: string | null;
}
export interface QueueItem {
  id: number; video_id: string; title: string; channel: string; genre: MusicGenre;
  added_by_user_id: number; added_by_name: string;
  status: 'queued' | 'selected' | 'played' | 'skipped' | 'failed';
  added_at: string; failure_code: string | null;
}
export interface Playback {
  version: number; video_id: string | null; source: 'manual' | 'radio' | null;
  queue_id: number | null; genre: MusicGenre | null; title: string | null; channel: string | null;
  state: 'playing' | 'idle'; started_at: string | null; updated_at: string;
}
export interface Play { id: number; video_id: string; title: string; genre: string | null; source: string; outcome: string; played_at: string }
export interface RadioSource { id: number; genre: MusicGenre; source_type: 'playlist' | 'search'; browse_or_playlist_id: string; label: string; enabled: number }
export interface PoolVideo { videoId: string; title: string; channel: string }

function now(): string { return new Date().toISOString(); }

let ready = false;
export function initMusicTables(): void {
  if (ready) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_manual_decisions (
      video_id TEXT PRIMARY KEY,
      decision TEXT NOT NULL CHECK (decision IN ('allow','deny')),
      genre TEXT,
      reason TEXT,
      decided_by_user_id INTEGER NOT NULL,
      decided_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS music_gate_cache (
      video_id TEXT PRIMARY KEY,
      decision TEXT NOT NULL CHECK (decision IN ('allow','deny','unsure')),
      genre TEXT,
      decision_source TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      classifier_model TEXT,
      prompt_version INTEGER,
      evaluated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS music_video_metadata (
      video_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_title TEXT NOT NULL,
      duration_seconds INTEGER,
      embeddable INTEGER NOT NULL,
      made_for_kids INTEGER NOT NULL,
      live INTEGER NOT NULL,
      region_blocked_de INTEGER NOT NULL,
      topic_categories_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS music_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
      first_requested_by TEXT NOT NULL,
      first_requested_at TEXT NOT NULL,
      last_requested_by TEXT NOT NULL,
      last_requested_at TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      resolved_by TEXT,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS music_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      channel TEXT NOT NULL,
      genre TEXT NOT NULL,
      added_by_user_id INTEGER NOT NULL,
      added_by_name TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','selected','played','skipped','failed')),
      added_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      failure_code TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_music_queue_status ON music_queue(status);
    CREATE TABLE IF NOT EXISTS music_playback (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version INTEGER NOT NULL,
      video_id TEXT,
      source TEXT,
      queue_id INTEGER,
      genre TEXT,
      title TEXT,
      channel TEXT,
      state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('playing','idle')),
      started_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS music_play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      genre TEXT,
      source TEXT NOT NULL,
      outcome TEXT NOT NULL,
      error_code TEXT,
      played_by TEXT,
      played_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_music_history_at ON music_play_history(played_at);
    CREATE TABLE IF NOT EXISTS music_radio_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      genre TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('playlist','search')),
      browse_or_playlist_id TEXT NOT NULL,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS music_radio_pool (
      source_id INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      genre TEXT NOT NULL,
      title TEXT NOT NULL,
      channel TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (source_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_music_pool_genre ON music_radio_pool(genre);
    CREATE TABLE IF NOT EXISTS music_settings (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      player_device_id INTEGER,
      updated_by TEXT,
      updated_at TEXT
    );
  `);
  ready = true;
}

// ── Manual decisions (the permanent authority) ──

export function getManualDecision(videoId: string): ManualDecision | null {
  initMusicTables();
  return (getDb().prepare('SELECT * FROM music_manual_decisions WHERE video_id = ?').get(videoId) as ManualDecision | undefined) ?? null;
}

export function setManualDecision(d: { videoId: string; decision: 'allow' | 'deny'; genre: MusicGenre | null; reason: string | null; byUserId: number; byName: string }): void {
  initMusicTables();
  if (d.decision === 'allow' && !d.genre) throw new Error('An approval needs a genre.');
  const ts = now();
  getDb().prepare(`
    INSERT INTO music_manual_decisions (video_id, decision, genre, reason, decided_by_user_id, decided_by_name, created_at, updated_at)
    VALUES (@videoId, @decision, @genre, @reason, @byUserId, @byName, @ts, @ts)
    ON CONFLICT(video_id) DO UPDATE SET
      decision = @decision, genre = @genre, reason = @reason,
      decided_by_user_id = @byUserId, decided_by_name = @byName, updated_at = @ts
  `).run({ ...d, ts });
}

// ── Automatic gate cache (permanent internal record) ──

export function getGateCache(videoId: string): GateCache | null {
  initMusicTables();
  return (getDb().prepare('SELECT * FROM music_gate_cache WHERE video_id = ?').get(videoId) as GateCache | undefined) ?? null;
}

export function setGateCache(c: { videoId: string; decision: GateDecision; genre: MusicGenre | null; source: 'youtube_topic' | 'claude'; reasonCode: string; model: string | null; promptVersion: number | null }): void {
  initMusicTables();
  getDb().prepare(`
    INSERT INTO music_gate_cache (video_id, decision, genre, decision_source, reason_code, classifier_model, prompt_version, evaluated_at)
    VALUES (@videoId, @decision, @genre, @source, @reasonCode, @model, @promptVersion, @ts)
    ON CONFLICT(video_id) DO UPDATE SET
      decision = @decision, genre = @genre, decision_source = @source,
      reason_code = @reasonCode, classifier_model = @model, prompt_version = @promptVersion, evaluated_at = @ts
  `).run({ ...c, ts: now() });
}

// ── Refreshable YouTube metadata (30-day TTL) ──

export function getMetadata(videoId: string): VideoMetadata | null {
  initMusicTables();
  const r = getDb().prepare(`SELECT * FROM music_video_metadata WHERE video_id = ? AND expires_at > datetime('now')`).get(videoId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    videoId: r.video_id as string, title: r.title as string,
    channelId: r.channel_id as string, channelTitle: r.channel_title as string,
    durationSeconds: (r.duration_seconds as number | null),
    embeddable: !!r.embeddable, madeForKids: !!r.made_for_kids, live: !!r.live,
    regionBlockedDe: !!r.region_blocked_de,
    topicCategories: JSON.parse(r.topic_categories_json as string) as string[],
    fetchedAt: r.fetched_at as string, expiresAt: r.expires_at as string,
  };
}

export function setMetadata(m: VideoMetadataInput): void {
  initMusicTables();
  getDb().prepare(`
    INSERT INTO music_video_metadata (video_id, title, channel_id, channel_title, duration_seconds, embeddable, made_for_kids, live, region_blocked_de, topic_categories_json, fetched_at, expires_at)
    VALUES (@videoId, @title, @channelId, @channelTitle, @durationSeconds, @embeddable, @madeForKids, @live, @regionBlockedDe, @topics, datetime('now'), datetime('now', '+${METADATA_TTL_DAYS} days'))
    ON CONFLICT(video_id) DO UPDATE SET
      title = @title, channel_id = @channelId, channel_title = @channelTitle,
      duration_seconds = @durationSeconds, embeddable = @embeddable, made_for_kids = @madeForKids,
      live = @live, region_blocked_de = @regionBlockedDe, topic_categories_json = @topics,
      fetched_at = datetime('now'), expires_at = datetime('now', '+${METADATA_TTL_DAYS} days')
  `).run({
    ...m,
    embeddable: m.embeddable ? 1 : 0, madeForKids: m.madeForKids ? 1 : 0,
    live: m.live ? 1 : 0, regionBlockedDe: m.regionBlockedDe ? 1 : 0,
    topics: JSON.stringify(m.topicCategories),
  });
}

// ── Manager requests (workflow history — NOT the allow-list) ──

export function upsertRequest(r: { videoId: string; title: string; channel: string; byName: string }): void {
  initMusicTables();
  const ts = now();
  getDb().prepare(`
    INSERT INTO music_requests (video_id, title, channel, status, first_requested_by, first_requested_at, last_requested_by, last_requested_at, request_count)
    VALUES (@videoId, @title, @channel, 'pending', @byName, @ts, @byName, @ts, 1)
    ON CONFLICT(video_id) DO UPDATE SET
      status = 'pending', title = @title, channel = @channel,
      last_requested_by = @byName, last_requested_at = @ts,
      request_count = request_count + 1,
      resolved_by = NULL, resolved_at = NULL
  `).run({ ...r, ts });
}

export function listRequests(kind: 'pending' | 'decided'): MusicRequest[] {
  initMusicTables();
  const where = kind === 'pending' ? `status = 'pending'` : `status != 'pending'`;
  const order = kind === 'pending' ? 'last_requested_at DESC' : 'resolved_at DESC';
  return getDb().prepare(`SELECT * FROM music_requests WHERE ${where} ORDER BY ${order} LIMIT 200`).all() as MusicRequest[];
}

export function resolveRequest(videoId: string, status: 'approved' | 'denied', byName: string): void {
  initMusicTables();
  getDb().prepare(`UPDATE music_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE video_id = ?`)
    .run(status, byName, now(), videoId);
}

// ── Queue (FIFO by id, no reordering) ──

export function listQueue(): QueueItem[] {
  initMusicTables();
  return getDb().prepare(`SELECT * FROM music_queue WHERE status = 'queued' ORDER BY id`).all() as QueueItem[];
}

export function enqueue(q: { videoId: string; title: string; channel: string; genre: MusicGenre; byUserId: number; byName: string; idempotencyKey: string }):
  { ok: true; position: number } | { ok: false; reason: 'duplicate' | 'already_queued' | 'queue_full' } {
  initMusicTables();
  const db = getDb();
  const tx = db.transaction(() => {
    const dup = db.prepare('SELECT id FROM music_queue WHERE idempotency_key = ?').get(q.idempotencyKey);
    if (dup) return { ok: false as const, reason: 'duplicate' as const };
    const active = db.prepare(`SELECT id FROM music_queue WHERE video_id = ? AND status IN ('queued','selected')`).get(q.videoId);
    const playingNow = db.prepare(`SELECT 1 AS x FROM music_playback WHERE state = 'playing' AND video_id = ?`).get(q.videoId);
    if (active || playingNow) return { ok: false as const, reason: 'already_queued' as const };
    const depth = (db.prepare(`SELECT COUNT(*) AS c FROM music_queue WHERE status = 'queued'`).get() as { c: number }).c;
    if (depth >= QUEUE_CAP) return { ok: false as const, reason: 'queue_full' as const };
    db.prepare(`
      INSERT INTO music_queue (video_id, title, channel, genre, added_by_user_id, added_by_name, idempotency_key, status, added_at)
      VALUES (@videoId, @title, @channel, @genre, @byUserId, @byName, @idempotencyKey, 'queued', @ts)
    `).run({ ...q, ts: now() });
    return { ok: true as const, position: depth + 1 };
  });
  return tx();
}

// ── Playback (single versioned row) ──

export function getPlayback(): Playback | null {
  initMusicTables();
  return (getDb().prepare('SELECT * FROM music_playback WHERE singleton = 1').get() as Playback | undefined) ?? null;
}

export function startPlayback(pick: { videoId: string; source: 'manual' | 'radio'; queueId: number | null; genre: MusicGenre; title: string; channel: string }): Playback {
  initMusicTables();
  const db = getDb();
  const tx = db.transaction(() => {
    const cur = db.prepare('SELECT version FROM music_playback WHERE singleton = 1').get() as { version: number } | undefined;
    const version = (cur?.version ?? 0) + 1;
    const ts = now();
    db.prepare(`
      INSERT INTO music_playback (singleton, version, video_id, source, queue_id, genre, title, channel, state, started_at, updated_at)
      VALUES (1, @version, @videoId, @source, @queueId, @genre, @title, @channel, 'playing', @ts, @ts)
      ON CONFLICT(singleton) DO UPDATE SET
        version = @version, video_id = @videoId, source = @source, queue_id = @queueId,
        genre = @genre, title = @title, channel = @channel, state = 'playing', started_at = @ts, updated_at = @ts
    `).run({ ...pick, version, ts });
    if (pick.queueId != null) {
      db.prepare(`UPDATE music_queue SET status = 'selected', started_at = ? WHERE id = ?`).run(ts, pick.queueId);
    }
    return getPlayback() as Playback;
  });
  return tx();
}

/**
 * Finalize the current track (history + queue bookkeeping) and atomically move
 * to the next queued song. Returns the new playback when a queued song started,
 * `next: null` when the queue is drained (caller falls back to radio), and
 * `stale` when the observed version doesn't match (duplicate/racing event).
 */
export function advancePlayback(observedVersion: number, event: 'ended' | 'skip' | 'error', errorCode?: string, by?: string):
  { ok: true; next: Playback | null } | { ok: false; reason: 'stale' } {
  initMusicTables();
  const db = getDb();
  const tx = db.transaction(() => {
    const cur = db.prepare('SELECT * FROM music_playback WHERE singleton = 1').get() as Playback | undefined;
    if (!cur || cur.version !== observedVersion || cur.state !== 'playing') {
      return { ok: false as const, reason: 'stale' as const };
    }
    const ts = now();
    const outcome = event === 'ended' ? 'played' : event === 'skip' ? 'skipped' : 'failed';
    if (cur.video_id) {
      db.prepare(`
        INSERT INTO music_play_history (video_id, title, genre, source, outcome, error_code, played_by, played_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cur.video_id, cur.title ?? '', cur.genre, cur.source ?? 'radio', outcome, errorCode ?? null, by ?? null, ts);
    }
    if (cur.queue_id != null) {
      db.prepare(`UPDATE music_queue SET status = ?, finished_at = ?, failure_code = ? WHERE id = ?`)
        .run(outcome, ts, errorCode ?? null, cur.queue_id);
    }
    const nextQ = db.prepare(`SELECT * FROM music_queue WHERE status = 'queued' ORDER BY id LIMIT 1`).get() as QueueItem | undefined;
    const version = cur.version + 1;
    if (nextQ) {
      db.prepare(`
        UPDATE music_playback SET version = ?, video_id = ?, source = 'manual', queue_id = ?, genre = ?, title = ?, channel = ?, state = 'playing', started_at = ?, updated_at = ?
        WHERE singleton = 1
      `).run(version, nextQ.video_id, nextQ.id, nextQ.genre, nextQ.title, nextQ.channel, ts, ts);
      db.prepare(`UPDATE music_queue SET status = 'selected', started_at = ? WHERE id = ?`).run(ts, nextQ.id);
      return { ok: true as const, next: getPlayback() };
    }
    db.prepare(`
      UPDATE music_playback SET version = ?, video_id = NULL, source = NULL, queue_id = NULL, genre = NULL, title = NULL, channel = NULL, state = 'idle', started_at = NULL, updated_at = ?
      WHERE singleton = 1
    `).run(version, ts);
    return { ok: true as const, next: null };
  });
  return tx();
}

export function recentPlays(limit: number): Play[] {
  initMusicTables();
  return getDb().prepare('SELECT * FROM music_play_history ORDER BY id DESC LIMIT ?').all(limit) as Play[];
}

// ── Radio sources + pool ──

const DEFAULT_SOURCES: Array<{ genre: MusicGenre; q: string; label: string }> = [
  { genre: 'hip_hop_rap', q: 'hip hop hits', label: 'Hip hop hits' },
  { genre: 'hip_hop_rap', q: 'rap classics', label: 'Rap classics' },
  { genre: 'reggae_dancehall_dub', q: 'dancehall hits', label: 'Dancehall hits' },
  { genre: 'reggae_dancehall_dub', q: 'roots reggae classics', label: 'Roots reggae classics' },
  { genre: 'afrobeats_afro', q: 'afrobeats hits', label: 'Afrobeats hits' },
  { genre: 'afrobeats_afro', q: 'amapiano hits', label: 'Amapiano hits' },
  { genre: 'rnb_soul_funk', q: 'rnb hits', label: 'R&B hits' },
  { genre: 'rnb_soul_funk', q: 'classic soul funk', label: 'Classic soul & funk' },
];

export function seedDefaultRadioSources(): void {
  initMusicTables();
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM music_radio_sources').get() as { c: number }).c;
  if (count > 0) return;
  const ins = db.prepare(`INSERT INTO music_radio_sources (genre, source_type, browse_or_playlist_id, label, enabled) VALUES (?, 'search', ?, ?, 1)`);
  const tx = db.transaction(() => { for (const s of DEFAULT_SOURCES) ins.run(s.genre, s.q, s.label); });
  tx();
}

export function listRadioSources(): RadioSource[] {
  initMusicTables();
  return getDb().prepare('SELECT * FROM music_radio_sources WHERE enabled = 1 ORDER BY id').all() as RadioSource[];
}

/** Transactional replace of one source's pool. Refuses empty input — the caller's plausibility check should have kept last-known-good instead. */
export function replaceRadioPool(sourceId: number, videos: PoolVideo[]): void {
  initMusicTables();
  if (videos.length === 0) throw new Error('Refusing to replace a radio pool with nothing — keep the last good one.');
  const db = getDb();
  const src = db.prepare('SELECT genre FROM music_radio_sources WHERE id = ?').get(sourceId) as { genre: MusicGenre } | undefined;
  if (!src) throw new Error(`Unknown radio source ${sourceId}.`);
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM music_radio_pool WHERE source_id = ?').run(sourceId);
    const ins = db.prepare(`
      INSERT INTO music_radio_pool (source_id, video_id, genre, title, channel, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, video_id) DO UPDATE SET title = excluded.title, channel = excluded.channel, last_seen_at = excluded.last_seen_at
    `);
    for (const v of videos) ins.run(sourceId, v.videoId, src.genre, v.title, v.channel, ts, ts);
  });
  tx();
}

export function poolCandidates(genre: MusicGenre): PoolVideo[] {
  initMusicTables();
  const rows = getDb().prepare(`SELECT DISTINCT video_id, title, channel FROM music_radio_pool WHERE genre = ?`).all(genre) as Array<{ video_id: string; title: string; channel: string }>;
  return rows.map((r) => ({ videoId: r.video_id, title: r.title, channel: r.channel }));
}

// ── Radio selection helpers ──

export interface RadioPick { videoId: string; genre: MusicGenre; title: string; channel: string }

/** Last time each genre produced sound — for least-recently-played rotation. */
export function lastPlayedByGenre(): Partial<Record<MusicGenre, string>> {
  initMusicTables();
  const rows = getDb().prepare(`SELECT genre, MAX(played_at) AS at FROM music_play_history WHERE genre IS NOT NULL GROUP BY genre`).all() as Array<{ genre: string; at: string }>;
  const out: Partial<Record<MusicGenre, string>> = {};
  for (const r of rows) if ((ALL_GENRES as string[]).includes(r.genre)) out[r.genre as MusicGenre] = r.at;
  return out;
}

/** Videos the radio must not repeat: last 50 plays OR anything within 12 h. */
export function recentNoRepeatIds(): Set<string> {
  initMusicTables();
  const db = getDb();
  const recent = db.prepare(`SELECT video_id FROM music_play_history ORDER BY id DESC LIMIT ?`).all(REPEAT_WINDOW_PLAYS) as Array<{ video_id: string }>;
  const windowed = db.prepare(`SELECT video_id FROM music_play_history WHERE played_at > datetime('now', '-${REPEAT_WINDOW_HOURS} hours')`).all() as Array<{ video_id: string }>;
  return new Set([...recent, ...windowed].map((r) => r.video_id));
}

export function queuedVideoIds(): Set<string> {
  initMusicTables();
  const rows = getDb().prepare(`SELECT video_id FROM music_queue WHERE status IN ('queued','selected')`).all() as Array<{ video_id: string }>;
  return new Set(rows.map((r) => r.video_id));
}

/** Manually approved songs as a last-resort radio pool (titles best-effort from requests/metadata). */
export function listManualAllowFallback(): RadioPick[] {
  initMusicTables();
  const rows = getDb().prepare(`
    SELECT md.video_id, md.genre,
           COALESCE(r.title, m.title, 'Approved song') AS title,
           COALESCE(r.channel, m.channel_title, '') AS channel
    FROM music_manual_decisions md
    LEFT JOIN music_requests r ON r.video_id = md.video_id
    LEFT JOIN music_video_metadata m ON m.video_id = md.video_id
    WHERE md.decision = 'allow' AND md.genre IS NOT NULL
  `).all() as Array<{ video_id: string; genre: MusicGenre; title: string; channel: string }>;
  return rows.map((r) => ({ videoId: r.video_id, genre: r.genre, title: r.title, channel: r.channel }));
}

/** Player hit an embed error — remember the video is unplayable so it never comes back. */
export function markUnplayable(videoId: string): void {
  initMusicTables();
  getDb().prepare(`UPDATE music_video_metadata SET embeddable = 0 WHERE video_id = ?`).run(videoId);
}

export interface ManualDecisionRow extends ManualDecision { title: string; channel: string }

/** Manual decisions with best-effort titles for the manager's history screen. */
export function listManualDecisions(): ManualDecisionRow[] {
  initMusicTables();
  return getDb().prepare(`
    SELECT md.*, COALESCE(r.title, m.title, md.video_id) AS title,
           COALESCE(r.channel, m.channel_title, '') AS channel
    FROM music_manual_decisions md
    LEFT JOIN music_requests r ON r.video_id = md.video_id
    LEFT JOIN music_video_metadata m ON m.video_id = md.video_id
    ORDER BY md.updated_at DESC LIMIT 300
  `).all() as ManualDecisionRow[];
}

export interface StationDeviceOption { id: number; name: string | null; label: string | null; company_id: number }

/** Active shared-tablet devices a manager can pin as THE player. */
export function stationDeviceOptions(): StationDeviceOption[] {
  initMusicTables();
  return getDb().prepare(`SELECT id, name, label, company_id FROM station_devices WHERE revoked = 0 AND disabled = 0 ORDER BY company_id, id`).all() as StationDeviceOption[];
}

export function stationDeviceExists(id: number): boolean {
  initMusicTables();
  return !!getDb().prepare(`SELECT 1 AS x FROM station_devices WHERE id = ? AND revoked = 0 AND disabled = 0`).get(id);
}

/** Radio pool depth per genre — the settings screen's health view. */
export function poolDepths(): Record<MusicGenre, number> {
  initMusicTables();
  const rows = getDb().prepare(`SELECT genre, COUNT(DISTINCT video_id) AS c FROM music_radio_pool GROUP BY genre`).all() as Array<{ genre: string; c: number }>;
  const out = { hip_hop_rap: 0, reggae_dancehall_dub: 0, afrobeats_afro: 0, rnb_soul_funk: 0 } as Record<MusicGenre, number>;
  for (const r of rows) if (r.genre in out) out[r.genre as MusicGenre] = r.c;
  return out;
}

/** Songs played today (Berlin-agnostic 24h window is fine for a KPI chip). */
export function playsToday(): number {
  initMusicTables();
  const r = getDb().prepare(`SELECT COUNT(*) AS c FROM music_play_history WHERE played_at > datetime('now', '-24 hours') AND outcome = 'played'`).get() as { c: number };
  return r.c;
}

// ── Settings ──

export function getMusicSettings(): { playerDeviceId: number | null } {
  initMusicTables();
  const r = getDb().prepare('SELECT player_device_id FROM music_settings WHERE singleton = 1').get() as { player_device_id: number | null } | undefined;
  return { playerDeviceId: r?.player_device_id ?? null };
}

export function setPlayerDevice(deviceId: number | null, byName: string): void {
  initMusicTables();
  getDb().prepare(`
    INSERT INTO music_settings (singleton, player_device_id, updated_by, updated_at)
    VALUES (1, @deviceId, @byName, @ts)
    ON CONFLICT(singleton) DO UPDATE SET player_device_id = @deviceId, updated_by = @byName, updated_at = @ts
  `).run({ deviceId, byName, ts: now() });
}
