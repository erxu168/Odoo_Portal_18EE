# WAJ Radio — Genre-Locked Music Jukebox — Design Spec

**Date:** 2026-08-03 · **Status:** awaiting Ethan's sign-off · **Module:** `music` (new)
**Supersedes:** the April 2026 music-scheduler plan (`~/docs/superpowers/plans/2026-04-01-music-scheduler.md`, never built — schedule-based; this replaces it with a genre-locked jukebox).
**Cross-check:** Codex (gpt-5.6-sol, high) planning review reconciled — see §16.

---

## 1. Feature summary

One Android tablet sits at the speakers at What A Jerk and runs a fullscreen player page. Staff search the YouTube Music catalog **on that tablet**, tap a song, and it queues — but only if it passes the **genre gate** (allow-list: hip hop/rap, reggae/dancehall/dub, Afrobeats/Afro, R&B/soul/funk). Blocked or unclassifiable songs are refused with a friendly message; unclassifiable ones land on a **request list** managers can approve from their phone, and approvals are remembered forever. When the queue is empty, an **auto-radio** shuffles all four allowed genres endlessly. Explicit lyrics are acceptable (decided).

### Decisions locked in interview (2026-08-03) — do not re-ask
1. Staff pick freely; genres locked by the system.
2. Idle → auto-radio of allowed music (no schedule).
3. Build custom (Ethan explicitly accepted the YouTube-terms risk — see §1a; GEMA registration is a separate, unavoidable step he handles).
4. Allow-list model (not block-list).
5. Allowed genres: hip hop/rap · reggae/dancehall/dub · Afrobeats/Afro (amapiano in, electronic Afro-house out) · R&B/soul/funk.
6. Refused-unsure songs → request list, approvals permanent.
7. All interaction on the player tablet itself (no phone remote in v1).
8. Explicit lyrics: don't care.
9. Auto-radio: one shuffled mix of all 4 genres (no vibe switch, no schedule).
10. *(added 2026-08-03, after mock)* The player ships as an **Android kiosk app** on a **dedicated Sunmi T2s** unit — separate from the live POS register (Ethan considered same-device background play; chose the dedicated device). The app is a thin wrapper around `/music/player`; managers keep using the portal on their phones. YouTube Music app installation is NOT required — the app is self-contained.

### 1a. Compliance position — eyes open (updated after Codex review)

Ethan accepted on 2026-08-03 that venue background playback breaches YouTube's **consumer terms** (personal, non-commercial use only). The Codex review adds that YouTube's **API developer policies** also conflict with parts of this design: clients must not infer a video's content category from API data (our genre classifier does), must not retain API metadata beyond 30 days without refresh (our cache), and must not scrape (youtubei.js). Realistic worst case at one-restaurant scale: Google revokes the API key or blocks access — an availability risk, not a legal-damages one; GEMA (which Ethan handles regardless) is the only party with real enforcement here.

Mitigations built into this design: YouTube-sourced **metadata expires after 30 days** and is refreshed/deleted (only *our own* allow/deny decisions are permanent — those are internal business records, not YouTube data); volumes are tiny; the InnerTube adapter is isolated and replaceable. **This paragraph is part of what Ethan signs off.** If the risk tolerance changes later, the fallback is Soundtrack Your Brand (~€50/mo) or Soundsuit (€29/mo).

### Research constraints this design encodes (2026-08-03 workflow + Codex)
- **No official YouTube Music API.** Catalog search + genre stations via the unofficial InnerTube client **`youtubei.js`** (npm, pinned version, single adapter file, fixture-tested upgrades). Playback via the **official YouTube IFrame Player** — same video IDs.
- **IFrame rules:** player visible ≥200×200 (target ≥480×270), >50% on screen at all times (incl. with Android keyboard open — must test), no overlays, no audio-only mode, native controls/branding preserved, `enablejsapi=1` + correct `origin` + `allow="autoplay; encrypted-media"`, one user tap to start per session, handle errors 5/100/101/150/**153** (153 = missing referer — verify headers/CSP on the real device).
- **Genre signal:** Data API v3 `videos.list` `topicDetails.topicCategories` (1 unit per 50 videos, 10k/day) — *Electronic music* topic exists (covers techno/house/EDM), *Hip hop music* and *Reggae* exist; no Afrobeats/Dancehall topics → LLM fallback. **Never `search.list`** (own ~100 calls/day bucket) — staff search goes through youtubei.js.
- **Breakage is expected** (unofficial API breaks a few times/year): radio must survive on cached pools + approved songs; nothing at track-transition time may depend on a live InnerTube call.

---

## 2. User roles & access

| Role | Can do |
|---|---|
| **The assigned player tablet** (one physical device, pinned in settings) | Run the player: search, queue, skip, report playback events. A staff member must be PIN-signed-in on the shared tablet so actions are attributable. |
| Manager / Admin (WAJ) | `/music` home, `/music/requests` (approve/deny + history + undo), play history, assign which tablet is the player. |
| Other staff / other devices | No access — player-mutation APIs verify the request comes from the assigned device's session, not just any staff login. |

Module registered `minRole: 'manager'`; the radio tablet's account gets an explicit `music` module grant at rollout (customized per-user allow-lists don't inherit new modules automatically). WAJ is hard-pinned to its company — no company switcher on any music screen. All mutations follow the repo's CSRF/same-origin pattern and the shared `authorize(capability)` helper (effective actor on shared tablets, per-user module access enforced server-side).

## 2a. Device & Android app packaging (added after mock review)

- **Hardware:** one dedicated **Sunmi T2s** (Sunmi OS / Android 9, 4GB RAM, octa-core — ample for video). Audio to the restaurant speakers via its **3.5mm jack** (or Bluetooth); the built-in 1.2W speaker is not sufficient for the room. This unit is NOT the live POS register.
- **App:** Capacitor Android kiosk app in its **own folder** with its own config + GitHub Actions APK workflow (binding one-folder-per-app rule; never a shared repo-root `android/`). The WebView loads the **remote** `https://portal.krawings.de/music/player` — so every portal deploy updates the jukebox with no APK rebuild. App provides: fullscreen/immersive, keep-screen-on, launch-on-boot, `mediaPlaybackRequiresUserGesture=false` (**no daily start-tap in the app** — the browser splash remains only as a web fallback), pinned to the player page.
- **Install:** sideloaded APK (no Play Store/GMS dependency). Runbook covers install + WebView-version check.
- **Phase-0 spike (mandatory before full build):** a bare APK that plays one YouTube embed on the actual T2s — validates Sunmi's WebView version, embed referer behavior (error 153), audio-jack output, and autoplay flag. If the stock WebView is too old, sideload an updated Android System WebView (documented in runbook).
- **Ads caveat:** signing a Google/Premium account into an app WebView is unreliable (Google blocks OAuth in embedded WebViews), so v1 in the app accepts occasional ads between songs. If ads become annoying: revisit (TWA/Chrome-based wrapper with a Premium profile, or accept).

## 3. Entry points

- Dashboard tile + drawer (one registry: `PORTAL_MODULES`): **Music** 🎵 → `/music`.
- `/music` home (standard blue-header design): tiles for **Player** (→ `/music/player`), **Song Requests** (pending-count badge), **Decisions & History**, **Settings** (assign player tablet).
- `/music/player` — kiosk page on the speakers tablet, added to the full-screen chrome exclusions. Direct URL works (canonical-page rule).

## 4. Main flow (staff queues a song)

1. Tablet shows player: video left (~60%), right panel = debounced search (min 2 chars), Up Next, Skip, now-playing.
2. `GET /api/music/search?q=` → youtubei.js song search → results (video ID, title, artist/channel, duration, thumbnail) + cached verdict badge where known.
3. Tap a result → `POST /api/music/queue` with **video ID + idempotency key only** (server never trusts client titles/genres) → **gate** (§6) runs server-side.
4. `allow` → append to FIFO queue (ordered by insert id, no reordering), toast "Added to queue", queue updates instantly (no refresh — binding). Duplicate of queued/now-playing → friendly "already coming up"; allowed again after it finishes.
5. `deny` → toast "Not the What A Jerk vibe 🌴". `unsure` → same toast + "Sent to the manager to review" (request upserted, attempt count incremented — never duplicated).
6. Track ends → player posts `advance` with the playback version it observed (§7) → server atomically selects next: oldest queue entry, else radio pick. A staff pick arriving mid-radio-song plays **next**, never interrupts.

## 5. Alternative flows

- **Auto-radio (§8):** per-genre pools from multiple configured YouTube Music playlists/stations, refreshed ≤1×/24h, transactionally replaced only on plausible non-empty results. Selection: least-recently-played genre → shuffle within genre → exclude now-playing, queue, and recent history (last 50 plays / 12h, relaxing if exhausted). Every candidate passes the same gate (pre-gated in batches, 50 IDs per `videos.list` unit).
- **Manager approves a request:** `/music/requests` on a phone. Pending list: title, artist, attempt count, last requested, preview link. **Approve requires picking one of the 4 genre buckets** (so the song participates correctly in radio balance); Deny needs none. Decision + request resolve in one transaction; audit-logged. "Decided" section allows reversal (confirmation + audit). Approval never queues or plays anything — this page is not a remote.
- **Skip:** button on the tablet; audited via the PIN-signed-in actor; no PIN prompt beyond that.
- **Daily start:** reload/boot → "▶ Start WAJ Radio" splash (satisfies the autoplay gesture rule); afterwards fully automatic. Reload restarts the current song from the beginning (v1 — no resume).

## 6. The genre gate (fail-closed; genre and playability are separate concerns)

```
manual deny                                  → refuse
manual allow                                 → allow (manual genre)
cached automatic verdict                     → reuse
otherwise videos.list (snippet,topicDetails,contentDetails,status):
  playability: missing/private/unembeddable/region-blocked(DE)/
               age-restricted/live/upcoming/made-for-kids/>15min  → refuse (playability, cacheable but refreshable)
  Electronic topic present (wins over all)   → deny
  Hip hop OR Reggae topic                    → allow (terminal)
  R&B/Soul topic                             → strong hint, continue to LLM
  otherwise                                  → LLM
LLM = Claude Haiku (pinned claude-haiku-4-5-20251001, strict JSON schema,
      short timeout, prompt_version stored):
  labels: hip_hop_rap | reggae_dancehall_dub | afrobeats_afro |
          rnb_soul_funk | electronic | other | unsure
  allowed label → allow · electronic/other → deny · unsure → refuse + manager request
Provider outage (Data API quota with no LLM path, or Anthropic down/timeout):
  → refuse with "Couldn't check this song — try again in a minute."
    NO manager request (outages must not flood the inbox), nothing cached.
```

Manual decisions are the highest genre authority but never override *playability* (a manually-approved video that later becomes unembeddable still gets skipped and flagged). Cost: ~€0.001/classified song, once per video ever.

## 7. Player state machine (server owns state; browser owns the IFrame)

- One `music_playback` row (per company) with a **monotonically increasing version**. Every `advance`/`skip`/`error` request carries the version it observed; stale/duplicate events (double `ENDED`, retries, double-taps, skip racing natural end) are no-ops.
- Queue→playing transitions are atomic single-transaction updates. Never hold a SQLite transaction across a network call (claim with a short lease → network → finalize).
- IFrame errors 5/100/101/150/153 → report with code → mark metadata unplayable → auto-advance.
- Single-server architecture (matches the portal); documented as such.

## 8. Auto-radio pipeline

1. `music_radio_sources`: several playlists/stations **per genre** (one deleted playlist must not empty a bucket); editable seed list shipped with sensible defaults.
2. Refresh job (manager-triggerable + on-access-stale, rate-limited): fetch via the youtubei.js adapter → plausibility check (non-empty parse; implausible empties = failure, keep last-known-good) → transactional replace per source.
3. New IDs batch-gated (`videos.list` 50/unit; LLM individually, results cached one-per-video).
4. Ready pool = gate-allowed ∩ playable. Cold start: if pools were never warmed, the player says so plainly ("Radio needs a first warm-up — open Settings") instead of silence with no explanation (actionable-block rule).
5. Breakage ladder: fresh pool → stale pool → manually-approved songs → play history.

## 9. Screens & components

- **`/music`** — standard recipe: `ui/AppHeader` (blue), KPI chips (Pending requests, Songs today, Radio pool health), white `ActionGrid` cards, plain language.
- **`/music/player`** — kiosk exception (like KDS): dark, landscape split; IFrame ≥480×270, unobscured, >50% visible **including when the Android keyboard is open** (search panel scrolls internally; player pane fixed). Big touch targets (h-14).
- **`/music/requests`** — standard design, phone-friendly; Pending + Decided (undo w/ confirmation).
- **`/music/history`** — plays list w/ source (pick/radio) + actor.
- **Settings** (in `/music`, admin/manager): assign the player device (integrates with the existing Shared Tablets admin), trigger radio refresh, view pool depth per genre.
- Components in `src/components/music/` (`MusicPlayerApp`, `YouTubeIFramePlayer`, `MusicSearch`, `MusicQueue`, `MusicRequests`, `MusicDecisionHistory`). Reuse `AppHeader`, `ConfirmDialog`, `PrimaryButton`, existing polling patterns. Anything new-reusable → `ui/` + ASSETS.md same commit.

## 10. Data model (feature-owned tables in `data/portal.db` via the existing `getDb()` singleton — repo convention; `src/lib/music-db.ts`)

Provenance is preserved by **separating manual authority, automatic verdicts, and refreshable metadata**:

- `music_manual_decisions(video_id PK, decision allow|deny, genre NULL for deny, reason, decided_by_user_id, decided_by_name, created_at, updated_at)` — the permanent authority; an allow always carries one of the 4 genres.
- `music_gate_cache(video_id PK, decision allow|deny|unsure, genre, decision_source youtube_topic|claude, reason_code, classifier_model, prompt_version, evaluated_at)` — permanent internal record; never overwritten by manual decisions (both kept).
- `music_video_metadata(video_id PK, title, channel_id, channel_title, duration_seconds, embeddable, made_for_kids, region_restrictions_json, topic_categories_json, fetched_at, expires_at)` — **refreshable, 30-day TTL** (compliance §1a); deletable without losing decisions.
- `music_requests(id PK, video_id UNIQUE, status pending|approved|denied, first/last_requested_by+at, request_count, reason_code, resolved_by, resolved_at)` — workflow history, **not** the allow-list.
- `music_queue(id PK AUTOINCREMENT — FIFO by id, video_id, added_by_user_id, added_by_name, idempotency_key UNIQUE, status queued|selected|played|skipped|failed, added_at, started_at, finished_at, failure_code)`
- `music_playback(company_id PK, version, video_id, source manual|radio, queue_id, genre, state, started_at, updated_at)`
- `music_play_history(...)` — repeat-avoidance + diagnostics.
- `music_radio_sources(id, genre, source_type, browse_or_playlist_id, label, enabled)`
- `music_radio_pool(source_id, video_id PK pair, genre, snapshot fields, first/last_seen_at)` — gate status via join, no duplicated truth.
- `music_settings(company_id PK, player_device_id UNIQUE, radio cursor state, updated_by, updated_at)`
- Decision changes, device assignment, skips, reversals → existing `audit_log`.

## 11. API surface (`src/app/api/music/…`, keys server-only; Google key restricted to Data API v3 + server egress IP)

| Route | Method | Who | Purpose |
|---|---|---|---|
| `search` | GET | player device | youtubei.js search (debounced, min-length, result cap, per-device throttle) |
| `queue` | POST | player device | idempotent gate+enqueue |
| `player/state` | GET | player device | queue + now-playing + version |
| `player/advance` | POST | player device | ended / known IFrame error, versioned |
| `player/skip` | POST | player device | audited skip, versioned |
| `requests` / `requests/[videoId]` | GET / PATCH | manager | list / approve(genre)+deny |
| `decisions` / `decisions/[videoId]` | GET / PATCH | manager | history / reverse (confirm + audit) |
| `radio/refresh` | POST | manager (rate-limited) | pool maintenance |
| `settings/player-device` | PUT | manager | pin the physical tablet |

Libs: `music-db.ts`, `music-access.ts` (authorize + device pin), `music-gate.ts`, `music-radio.ts`, `youtube-data.ts` (Data API, backoff + circuit breaker), `youtube-music.ts` (the only youtubei.js import), `types/music.ts`. `next.config.mjs`: youtubei.js as server external; verify frame policy for the embed host.

## 12. Non-goals (v1)

No phone/remote control · no schedule or vibe switch · no clean-lyrics filter · no volume UI · no multi-venue · no Odoo integration · no genre-list editing UI · no playback-position resume across reloads.

## 13. Acceptance criteria

- **Given** a hip-hop/reggae track with a YouTube genre topic, **when** tapped, **then** it queues with no LLM call.
- **Given** a techno track (Electronic topic), **when** tapped, **then** refused with the vibe message and **no** manager request; a track with Electronic **and** Hip hop topics is also refused.
- **Given** an untagged Afrobeats song, **when** the LLM says `afrobeats_afro`, **then** it queues; second attempt hits the cache (no LLM).
- **Given** an `unsure` song, **when** tapped twice by two staff, **then** exactly one request exists with `request_count=2`; **when** a manager approves it as `reggae_dancehall_dub`, **then** it plays on next attempt forever and joins that genre's radio balance.
- **Given** Anthropic or the Data API is down, **when** staff tap an unknown song, **then** they see "Couldn't check this song — try again in a minute", nothing is cached, and **no** request is created.
- **Given** an empty queue, **when** a song ends, **then** radio plays a gated track from the least-recently-played genre, not repeated within the last 50 plays/12h.
- **Given** a double `ENDED` event or skip racing a natural end, **when** both reach the server, **then** exactly one advance happens (version check).
- **Given** an embed-blocked/deleted/live/>15min video, **when** it is tapped or surfaces in radio, **then** it is refused/skipped for playability regardless of genre or manual approval.
- **Given** youtubei.js breaks upstream, **when** staff search, **then** they see the outage message and radio continues from cached pools/approved songs.
- **Given** a manager phone, **when** opening `/music/requests`, **then** it works; **given** an unassigned tablet or plain staff login, **when** calling player APIs directly, **then** 403.

## 14. Operational values (defaults chosen — veto at review)

Max song length **15 min**; live/upcoming streams refused; made-for-kids refused; queue cap **50**; radio repeat window **last 50 plays or 12h**; reload **restarts** current song; decision reversal: **manager+**; request inbox: one row per video, upsert+count.

## 15. Open assumptions & Ethan's prerequisites

1. Player device = a dedicated **Sunmi T2s** running our kiosk app (§2a), portal shared-tablet login, audio to speakers via 3.5mm jack or Bluetooth. Ethan provides the T2s unit + speaker connection.
2. **New env vars on staging:** `YOUTUBE_API_KEY` (free Google Cloud key, restricted), `ANTHROPIC_API_KEY` (portal's first LLM usage).
3. Classifier = Haiku 4.5 by explicit cost choice ("small AI" approved 2026-08-03); one-line swap if accuracy disappoints.
4. Ads may play between songs — accepted v1 (Premium sign-in inside an app WebView is unreliable; see §2a ads caveat).
5. GEMA registration — Ethan, independent of this build.
6. §1a compliance position — Ethan signs off with the spec.

## 16. Codex cross-check reconciliation (planning stage)

Codex (gpt-5.6-sol, high) reviewed the plan against the repo. **Accepted:** developer-policy compliance risk surfaced (→ §1a, 30-day metadata TTL); manual/automatic/metadata table separation; outages must not create requests; Electronic-over-allowed topic precedence; approve-with-genre-bucket; playback versioning + idempotency keys; playability separated from genre; physical-device pinning via Shared Tablets; transactional pool refresh + plausibility checks; multiple sources per genre; `minRole: 'manager'` + explicit tablet grant; feature tables in `portal.db` (repo convention, not a second file); R&B/Soul topics as hint-not-terminal; operational defaults (§14); error 153/keyboard-resize test items. **Rejected:** halting for a formal YouTube compliance audit (disproportionate at one-tablet scale — replaced by §1a eyes-open sign-off + mitigations); playback-position resume (v1 restarts). Full verdict archived in the session log.

## 17. Testing & verification

- **Unit** (`tests/music-*.unit.spec.ts`, Playwright `--project=unit`): gate matrix (topic allow/deny/mixed, LLM fallback, outage→no-request, manual precedence, playability refusals, cache short-circuit), queue idempotency, version no-ops, pool-refresh plausibility.
- **E2E on staging (binding):** queue-allowed / refuse-blocked / unsure→request→approve→replay; radio on empty queue; role + device gating; requests page on phone viewport. IFrame stubbed where headless can't autoplay.
- **Real-device pass (binding):** actual tablet + speakers — autoplay unlock, error 153/referer, keyboard resize keeping player >50% visible, ads behavior, multi-hour soak.

## 18. Implementation plan (each phase ends: build+lint clean, commit, push to `main`, Codex diff review)

0. **T2s spike:** bare Android APK playing one YouTube embed on the actual Sunmi T2s (WebView version, error 153, audio jack, autoplay flag). Go/no-go gate for the app packaging approach.
1. Schema + `music-db.ts` + pure `music-gate.ts` with mocked adapters + adversarial unit tests.
2. Adapters: `youtube-data.ts` (batching, backoff, breaker), `youtube-music.ts` (pinned, fixture-tested), Claude classifier.
3. Transactional queue/playback/radio selection + device pinning + API routes.
4. `/music/player` (IFrame, search, queue UI, splash [web fallback], error-skip).
5. `/music` home, requests, decisions/history, settings, `PORTAL_MODULES` + grants.
6. Pool pre-warm + inspect, Playwright suite, staging verify.
7. **Android kiosk app:** Capacitor project in its own folder + GitHub Actions APK build, install on the T2s, multi-hour soak on real speakers, one-page runbook.
