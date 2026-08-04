# WAJ Radio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Genre-locked YouTube jukebox for What A Jerk per `docs/superpowers/specs/2026-08-03-waj-radio-genre-locked-jukebox-design.md` (spec is authoritative; this plan is the build order).

**Architecture:** Feature-owned tables in `data/portal.db` (via `getDb()`), pure gate pipeline with injected adapters, isolated youtubei.js adapter, versioned server-side playback state, thin API routes guarded by a module `access.ts`, player kiosk page + three manager pages. Ships to `main` (staging autodeploys); app form = PWA in Chrome with Ethan's Premium (spec §2a).

**Tech Stack:** Next.js 14, better-sqlite3, youtubei.js (pinned), YouTube Data API v3 (`videos.list` only), `@anthropic-ai/sdk` + `claude-haiku-4-5-20251001`, Playwright (`--project=unit` + e2e).

## Global Constraints

- Single branch `main`; commit+push per task (pathspec-limited); staging autodeploys (~2 min). NEVER build in `/opt/krawings-portal`.
- Design standard: blue `#2563EB` AppHeader, green `#16A34A` actions, white cards; player page is the dark kiosk exception; plain language (no jargon); every status = icon+colour+text.
- All YouTube/Claude keys server-only (`YOUTUBE_API_KEY`, `ANTHROPIC_API_KEY` in `.env.local` on staging — Ethan provides; absent keys → gate returns OUTAGE, never crashes).
- Gate fails CLOSED; outages never create manager requests (spec §6). Electronic topic beats allowed topics. Manual decisions outrank automatic, but never override playability.
- YouTube-sourced metadata expires after 30 days (spec §1a); internal decisions permanent.
- Lint gate: `npx tsc --noEmit` AND `npx next lint --file <changed>` before every push.
- Operational values (spec §14): max 15 min, no live/upcoming, no made-for-kids, queue cap 50, radio no-repeat = last 50 plays or 12 h, reversal manager+.

---

### Task 1: Capabilities, module registry, DB schema + `music-db`

**Files:**
- Modify: `src/lib/permissions.ts` (PERMISSION_ACTIONS — 3 rows)
- Modify: `src/lib/modules.ts` (PORTAL_MODULES — 1 row)
- Create: `src/lib/music/db.ts`
- Test: `tests/music-db.unit.spec.ts`

**Interfaces (produced):**
```ts
// permissions.ts additions (module: 'music')
{ key: 'music.play',   module: 'music', label: 'Run the player (queue, skip)',        defaultRoles: ['staff','manager','admin'] }
{ key: 'music.queue',  module: 'music', label: 'Pick songs on the player',            defaultRoles: ['staff','manager','admin'] }
{ key: 'music.manage', module: 'music', label: 'Approve songs & change settings',     defaultRoles: ['manager','admin'] }
// modules.ts addition
{ id: 'music', label: 'Music', minRole: 'manager', href: '/music', emoji: '🎵', subtitle: 'WAJ Radio jukebox' }
```
```ts
// src/lib/music/db.ts — all take/return plain objects; initMusicTables() idempotent, called by routes.
export type MusicGenre = 'hip_hop_rap'|'reggae_dancehall_dub'|'afrobeats_afro'|'rnb_soul_funk';
export type GateDecision = 'allow'|'deny'|'unsure';
export function initMusicTables(): void;
export function getManualDecision(videoId: string): ManualDecision | null;
export function setManualDecision(d: { videoId: string; decision: 'allow'|'deny'; genre: MusicGenre|null; reason: string|null; byUserId: number; byName: string }): void;
export function getGateCache(videoId: string): GateCache | null;
export function setGateCache(c: { videoId: string; decision: GateDecision; genre: MusicGenre|null; source: 'youtube_topic'|'claude'; reasonCode: string; model: string|null; promptVersion: number|null }): void;
export function getMetadata(videoId: string): VideoMetadata | null;           // null when missing OR expired
export function setMetadata(m: VideoMetadata): void;                          // sets fetched_at now, expires_at +30d
export function upsertRequest(r: { videoId: string; title: string; channel: string; byName: string }): void;  // one row per video, count++
export function listRequests(status: 'pending'|'decided'): MusicRequest[];
export function resolveRequest(videoId: string, status: 'approved'|'denied', byName: string): void;
export function enqueue(q: { videoId: string; title: string; channel: string; genre: MusicGenre; byUserId: number; byName: string; idempotencyKey: string }): { ok: true; position: number } | { ok: false; reason: 'duplicate'|'already_queued'|'queue_full' };
export function listQueue(): QueueItem[];                                     // status='queued', FIFO by id
export function getPlayback(): Playback | null;                               // singleton row
export function advancePlayback(observedVersion: number, event: 'ended'|'skip'|'error', errorCode?: string):
  { ok: true; next: Playback | null } | { ok: false; reason: 'stale' };       // atomic, one transaction
export function startPlayback(pick: { videoId: string; source: 'manual'|'radio'; queueId: number|null; genre: MusicGenre; title: string; channel: string }): Playback;
export function recentPlays(limit: number): Play[];
export function listRadioSources(): RadioSource[]; export function seedDefaultRadioSources(): void;
export function replaceRadioPool(sourceId: number, videos: PoolVideo[]): void; // transactional; caller pre-validated non-empty
export function poolCandidates(genre: MusicGenre): PoolVideo[];
export function getMusicSettings(): { playerDeviceId: number|null };
export function setPlayerDevice(deviceId: number|null, byName: string): void;
```

- [ ] **Step 1:** Write `tests/music-db.unit.spec.ts` (uses `PORTAL_DB_PATH` throwaway-file pattern like `tests/combined-walk.unit.spec.ts` neighbors): request upsert increments count and stays one row; enqueue dedupes on idempotency key AND on already-queued video; queue cap 50 → `queue_full`; `advancePlayback` with stale version → `{ok:false,'stale'}`; metadata older than 30 days → `getMetadata` null; manual decision precedence is caller-side (no test here).
- [ ] **Step 2:** Run → fails (module missing).
- [ ] **Step 3:** Implement schema exactly per spec §10 (tables `music_manual_decisions`, `music_gate_cache`, `music_video_metadata`, `music_requests`, `music_queue`, `music_playback`, `music_play_history`, `music_radio_sources`, `music_radio_pool`, `music_settings`) + functions above. `advancePlayback`: single transaction — `UPDATE music_playback SET ... WHERE version = ?` guard; on 0 rows → stale; on success append `music_play_history`, mark queue row played/skipped/failed, select next (oldest queued) or return null (caller then asks radio).
- [ ] **Step 4:** Add permissions + modules rows. Run unit spec + `npx tsc --noEmit` + lint → green.
- [ ] **Step 5:** Commit `[ADD] music: schema, db layer, capabilities, module registration` + push.

### Task 2: Pure gate pipeline

**Files:**
- Create: `src/lib/music/gate.ts`
- Test: `tests/music-gate.unit.spec.ts`

**Interfaces:**
```ts
export interface GateAdapters {
  fetchVideoData(ids: string[]): Promise<Map<string, RawVideoData>|'outage'>;   // Task 3 youtube-data
  classify(input: { videoId: string; title: string; channel: string }): Promise<ClassifierResult|'outage'>; // Task 3 classifier
}
export type GateResult =
  | { verdict: 'allow'; genre: MusicGenre; source: string }
  | { verdict: 'deny'; reasonCode: string }                    // vibe message
  | { verdict: 'unsure'; reasonCode: string }                  // vibe message + request
  | { verdict: 'unplayable'; reasonCode: string }              // skipped/refused regardless of genre
  | { verdict: 'outage' };                                     // "try again" — no cache, no request
export async function gateVideo(videoId: string, a: GateAdapters): Promise<GateResult>;
export const TOPIC_MAP: Record<string, 'block'|MusicGenre|'hint_rnb'>;         // wikipedia URL suffix → action
```

- [ ] **Step 1:** Failing tests — full matrix: manual deny/allow; cached verdict reuse (no adapter calls — assert via spy counters); playability refusals (unembeddable, live, >900 s, made-for-kids, DE region-blocked, missing video); Electronic topic beats Hip hop topic; Hip hop / Reggae topic terminal allow; R&B/Soul topic → still calls classifier; no topics → classifier; classifier each label → allow/deny/unsure; `fetchVideoData` outage → classifier still tried with search-result title; classifier outage → `{verdict:'outage'}` and NOTHING cached; unsure cached as unsure (second call = cache, no adapter call).
- [ ] **Step 2:** Run → fail. **Step 3:** Implement (order per spec §6; caches via Task 1 db functions; playability from metadata; store metadata on fetch). **Step 4:** Green + tsc + lint. **Step 5:** Commit `[ADD] music: genre gate pipeline` + push.

### Task 3: Adapters (YouTube Data, youtubei.js catalog, Claude classifier)

**Files:**
- Modify: `package.json` (+ `youtubei.js` pinned exact, `@anthropic-ai/sdk`; lockfile via `npm install --package-lock-only`)
- Create: `src/lib/music/youtube-data.ts`, `src/lib/music/catalog.ts`, `src/lib/music/classifier.ts`
- Test: `tests/music-adapters.unit.spec.ts` (parsing/mapping only — network stubbed)

**Interfaces:**
```ts
// youtube-data.ts — batches ≤50 ids, key from process.env.YOUTUBE_API_KEY; no key or HTTP error → 'outage'.
export async function fetchVideoData(ids: string[]): Promise<Map<string, RawVideoData>|'outage'>;
// exponential backoff (2 tries), module-level circuit breaker (open 60 s after 2 consecutive failures).
// catalog.ts — ONLY file importing youtubei.js; lazy singleton Innertube instance.
export async function searchSongs(q: string): Promise<CatalogSong[]|'outage'>;         // ≤12 results, videoId/title/artist/duration/thumb
export async function fetchPlaylistVideos(playlistId: string): Promise<CatalogSong[]|'outage'>;
// classifier.ts — Anthropic SDK, model 'claude-haiku-4-5-20251001', strict JSON schema output
// {genre: 'hip_hop_rap'|'reggae_dancehall_dub'|'afrobeats_afro'|'rnb_soul_funk'|'electronic'|'other'|'unsure'},
// 8 s timeout, PROMPT_VERSION const = 1; no key/timeout/parse-fail → 'outage'.
export async function classify(i: { videoId: string; title: string; channel: string }): Promise<ClassifierResult|'outage'>;
```

- [ ] **Step 1:** Failing tests for pure parts: ISO8601 duration parse (`PT3M47S`→227, malformed→null), topicCategories→TOPIC_MAP mapping, region-block check (`blocked` contains DE / `allowed` excludes DE), classifier JSON validation (unknown label → 'outage' path), breaker opens/closes. Network calls stubbed via injected `fetchImpl` params.
- [ ] **Step 2-4:** Implement; green; tsc needs local type stubs ONLY if the shared node_modules lacks the packages — if so add `src/types/vendor-music.d.ts` with minimal typed surface (documented; staging installs real packages).
- [ ] **Step 5:** Commit `[ADD] music: youtube + claude adapters` + push. **Watch the staging autodeploy log note in Task 10 — this push adds npm deps.**

### Task 4: Access guards + radio selection

**Files:**
- Create: `src/lib/music/access.ts` (copy the `shift-handover/access.ts` shape: `CAP = {play:'music.play', queue:'music.queue', manage:'music.manage'}`, `MODULE_ID='music'`, `authorize(capability, opts)`; plus `authorizePlayerDevice()` = authorize(CAP.play) AND `user.is_shared_device` AND session's station device id === `music_settings.player_device_id` — read the device id the same way the shared-tablet session resolves it in `src/lib/db.ts`/`shift-attribution.ts`; managers do NOT pass this guard)
- Create: `src/lib/music/radio.ts`
- Test: `tests/music-radio.unit.spec.ts`

**Interfaces:**
```ts
// radio.ts
export async function nextRadioTrack(a: GateAdapters): Promise<RadioPick|null>;
// least-recently-played genre first → shuffle within pool → exclude queue/now-playing/last-50-or-12h
// → gateVideo() each candidate until one allows (cap 15 attempts/call) → fallback ladder:
// pool → stale pool → manual allows → recent history; null only when truly empty (cold start).
export async function refreshRadioPools(a: GateAdapters): Promise<{ refreshed: number; kept: number }>;
// per source: fetchPlaylistVideos → PLAUSIBILITY (≥5 items) else keep last-known-good; transactional replace.
```

- [ ] **Steps:** failing tests (genre rotation, no-repeat window, plausibility keeps old pool, cold-start null, fallback to manual allows) → implement → green → commit `[ADD] music: radio selection + access guards` + push.

### Task 5: API routes

**Files:** Create under `src/app/api/music/`: `search/route.ts`, `queue/route.ts`, `player/state/route.ts`, `player/advance/route.ts`, `player/skip/route.ts`, `requests/route.ts`, `requests/[videoId]/route.ts`, `decisions/route.ts`, `decisions/[videoId]/route.ts`, `radio/refresh/route.ts`, `settings/player-device/route.ts`, plus `src/lib/music/route-helpers.ts` (jsonError, adapters wiring, initMusicTables call).

Route contract table = spec §11. Every route: `export const dynamic='force-dynamic'`; player routes use `authorizePlayerDevice()`; manager routes `authorize(CAP.manage)`; mutations check `isSameOrigin(request)`; queue POST requires `{videoId, idempotencyKey}` and re-resolves title/channel server-side (never trust client); gate outcome → HTTP: allow=200 `{queued:true,position}`, deny/unsure=403 `{refused:true, message, requested:boolean}`, unplayable=403, outage=503 `{message:"Couldn't check this song — try again in a minute."}`. `player/advance` body `{version, event:'ended'|'error', errorCode?}`; skip separate. `requests/[videoId]` PATCH `{action:'approve', genre}` requires valid genre; `{action:'deny'}`. All decisions/reversals + device assignment + skips → `audit` pattern used elsewhere in repo if a helper exists, else `music_play_history`/decision rows carry actor names (already in schema).

- [ ] **Steps:** implement all routes (thin — logic lives in libs) → tsc + lint → commit `[ADD] music: API routes` + push.

### Task 6: Player page + components

**Files:** Create `src/app/music/player/page.tsx`, `src/components/music/MusicPlayerApp.tsx`, `YouTubeIFramePlayer.tsx`, `MusicSearch.tsx`, `MusicQueue.tsx`; modify chrome exclusions so `/music/player` is fullscreen (find `HIDDEN_ROUTES`/equivalent in `AppTopBar`/`appChrome`).

Behavior (mock = visual truth, spec §5/§7): dark kiosk split (video pane ≥480×270 fixed; right panel scrolls internally so the keyboard never covers the player); IFrame API loaded once (`https://www.youtube.com/iframe_api`), `enablejsapi`, `origin`, `allow="autoplay; encrypted-media"`; `onStateChange ENDED` → POST advance with observed version → play returned next (or radio); errors 5/100/101/150/153 → POST advance `{event:'error',errorCode}` → auto-next; `onAutoplayBlocked`/failed unmuted start → splash overlay (web fallback; PWA won't need it); Screen Wake Lock (`navigator.wakeLock?.request('screen')`, re-acquire on visibilitychange); poll `player/state` every 15 s for queue changes; search debounced 400 ms ≥2 chars; refusal toasts exactly per mock copy ("Not the What A Jerk vibe 🌴" / "+ Sent to the manager to review" / outage copy); skip button POSTs skip. PWA: add `/music/player` friendly name+icon to the existing manifest setup if per-route manifest is feasible, else document the standard manifest covers it.

- [ ] **Steps:** build → manual dev-server check (desktop Chrome) → tsc + lint → commit `[ADD] music: player kiosk page` + push.

### Task 7: Manager pages + nav

**Files:** Create `src/app/music/page.tsx` (+`src/components/music/MusicHome.tsx`), `src/app/music/requests/page.tsx` (+`MusicRequests.tsx` with genre-bucket approve sheet per mock), `src/app/music/history/page.tsx`, settings section in home (device picker listing `station_devices`, radio refresh button + per-genre pool depth); reuse `AppHeader`, `KpiChip`/`KpiRow`, `ActionCard`/`ActionGrid`, `ConfirmDialog`, `BottomSheet`.

- [ ] **Steps:** build per mock + design standard → tsc + lint → commit `[ADD] music: home, requests, history, settings` + push.

### Task 8: E2E + docs + verify

**Files:** Create `tests/music-api.e2e.spec.ts` (auth as manager fixture; requests approve→manual decision→queue allowed path with classifier absent — uses manual-decision pre-seed so no external keys needed; role/device 403s), `tests/music-requests.e2e.spec.ts` (phone viewport UI); modify `PORTAL.md` (§5 module list), `ASSETS.md` only if something reusable was added, seed `music_radio_sources` defaults; write `docs/waj-radio-runbook.md` (T2s: sideload Chrome → Premium sign-in → PWA install → speaker jack → Phase-0 checklist).

- [ ] **Steps:** run unit+e2e suites → push → verify staging: HTTP 200 on `/music`, HEAD==origin/main, autodeploy log clean (deps installed) → Playwright against staging for the e2e specs → Codex `codex review --uncommitted`… (already-pushed: use `codex exec` review of the full diff `git diff <base>..HEAD`) → fix findings → final report.

## Self-review
Spec coverage: §2 roles→T1/T4; §4-5 flows→T5-7; §6 gate→T2; §7 playback→T1/T6; §8 radio→T4; §9 screens→T6-7; §10 schema→T1; §11 routes→T5; §14 values→constants in T1/T2/T4; §17 tests→T1-4,8; §2a PWA→T6+runbook. Phase 0 (T2s spike) + Phase 7 (device install) need Ethan's hardware — runbook covers them; everything else buildable now. Types checked consistent (GateResult/MusicGenre/adapters shared via `src/lib/music/types.ts` if circularity appears).
