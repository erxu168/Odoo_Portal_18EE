# Kiosk Settings — Design Spec

**Date:** 2026-07-08
**Repo:** `erxu168/Odoo_Portal_18EE` (branch `main` only)
**Target:** Krawings Portal — Time Clock kiosk (`/kiosk`), staging first
**Status:** Approved by Ethan (design), pending implementation

---

## Problem

The Time Clock kiosk (`src/app/kiosk/page.tsx`) only learns which restaurant it
serves from a URL query param (`/kiosk?company=6`). With no param it shows a
dead-end "This tablet is not set up yet" screen. There is no on-device way for a
manager to configure the tablet, so setup requires hand-editing the address bar.

## Goal

A PIN/credential-protected **settings screen on the kiosk itself**, accessible
only to **managers and admins**, that lets them set the restaurant (company) and
a handful of device options — persisted on the tablet so the address-bar trick is
no longer needed.

## Decisions (locked with Ethan)

- **Unlock method:** full portal login (email + password). Server verifies the
  credentials AND that the user's role is `manager` or `admin`. Staff are refused.
- **No lingering session:** the kiosk admin-login endpoint does **NOT** create a
  portal session or set the `kw_session` cookie. It only returns a one-shot "ok +
  your companies" payload. Settings stay unlocked in React state for the current
  visit and auto-relock on close or after 60s idle. A staff member cannot grab the
  tablet afterwards and browse the portal as the manager.
- **Settings included:** restaurant (required), tablet name, auto full-screen lock,
  idle reset seconds, sound on punch, show/hide "working now" footer.
- **Storage:** device-local via `localStorage` (survives reload/restart). The URL
  `?company=` param still works as a first-time / override path.

## Non-goals (YAGNI)

- No central/remote tablet management from the portal (device-local only for now).
- No new per-tablet DB table. No wiring "tablet name" into the punch audit trail
  yet (stored + displayed only; audit wiring is a later, separate task).
- Desktop layout untouched (kiosk is its own full-screen route).

---

## Architecture

### New files

- `src/lib/kiosk-settings.ts` — client-side typed read/write of the tablet's
  settings in `localStorage`, with defaults + validation + a URL-param fallback
  for `company`. Single source of truth for the shape of settings.
  - `interface KioskSettings { companyId: number | null; companyName: string;
    tabletName: string; fullscreenLock: boolean; idleSeconds: number;
    sound: boolean; showWorkingNow: boolean; }`
  - `loadKioskSettings(): KioskSettings` — merges stored JSON over defaults;
    if no stored `companyId`, falls back to `?company=` from the URL.
  - `saveKioskSettings(patch: Partial<KioskSettings>): KioskSettings`
  - `DEFAULTS` — `{ companyId:null, companyName:'', tabletName:'',
    fullscreenLock:true, idleSeconds:5, sound:false, showWorkingNow:true }`
  - `idleSeconds` clamped to [3, 30].
  - Storage key: `kw_kiosk_settings` (JSON). Guard all access in try/catch —
    localStorage can throw (private mode / disabled).

- `src/components/kiosk/KioskSettings.tsx` — orchestrator. Renders as a full-screen
  overlay. Internal state machine: `login` → `panel`. Handles the 60s idle
  auto-relock and the "close" (× / done) that relocks. Props:
  `{ settings, onSave(next), onClose() }`.

- `src/components/kiosk/KioskLoginGate.tsx` — email + password form. Posts to
  `/api/kiosk/admin-login`. On success calls `onUnlock(companies, managerName)`.
  Shows plain-language errors ("Only managers can change settings", "Wrong email
  or password", "Too many tries — wait a moment"). Never stores the password.

- `src/components/kiosk/KioskSettingsForm.tsx` — the options UI once unlocked:
  restaurant picker (from the companies returned by the login), tablet name input,
  three toggles (fullscreen lock, sound, working-now footer), and an idle-seconds
  slider (3–30). Uses `ConfirmDialog` before saving a **restaurant change**
  (switching which company the tablet clocks for is significant). Other option
  changes save without a prompt.

- `src/app/api/kiosk/admin-login/route.ts` — `POST { email, password }`.
  1. Rate-limit by IP: `checkRateLimit('kiosk-admin-login:' + ip, 5, 60_000)`.
  2. `getUserByEmail(email.toLowerCase().trim())`; `bcrypt.compareSync(password, hash)`.
  3. Reject if not found / bad password → 401 generic "Invalid email or password."
  4. Reject if `user.status !== 'active'` → 403.
  5. Reject if `!hasRole(user, 'manager')` → 403 "Only managers can change settings."
  6. Fetch companies from Odoo `res.company` (`id, name, sequence`), filter by
     `parseCompanyIds(user.allowed_company_ids)` unless `role === 'admin'` (admin
     sees all). Return `{ ok:true, name:user.name, role:user.role, companies:[...] }`.
  7. `logAudit({ user_id, user_name, action:'kiosk_settings_unlock', module:'kiosk' })`.
  8. **Does NOT** call `createSession` or set any cookie.

### Changed files

- `src/app/kiosk/page.tsx`:
  - Load settings via `loadKioskSettings()` instead of reading only `?company=`.
    `companyId`/display name now come from settings (URL param still honored as a
    fallback inside `loadKioskSettings`).
  - Add a small **⚙ gear** button in the header (top-right), visible on every
    screen including the "not set up" screen. Opens `<KioskSettings>`.
  - Header shows the tablet name when set (e.g. "🕒 Time Clock · WAJ Kitchen Tablet").
  - The done-screen auto-return timeout uses `settings.idleSeconds` (was hard 5s).
  - Fullscreen/back-trap behavior gated on `settings.fullscreenLock`.
  - On punch success, play a short beep when `settings.sound` is on (Web Audio;
    created on the user-gesture punch, no external asset).
  - The footer "● N working now" is shown only when `settings.showWorkingNow`.
  - When settings are saved, re-read them and re-render (no page reload needed).

### Reused

- `getUserByEmail`, `parseCompanyIds`, `logAudit`, `hasRole`, `getOdoo`,
  `checkRateLimit`, `clientIpFromHeaders`, `ConfirmDialog`.

---

## Security notes

- Manager/admin gate enforced **server-side** in the API route, not just hidden in
  the UI. Staff PIN / staff account cannot pass.
- Brute-force: 5 attempts / minute / IP on `admin-login`, mirroring the punch route.
- No credentials or session persisted on the device. Settings unlock lives only in
  memory for the current visit.
- Company list is only returned **after** successful manager/admin auth (no public
  company-name leak), and is scoped to the user's allowed companies.

## Data flow

1. Manager taps ⚙ → `KioskLoginGate` → `POST /api/kiosk/admin-login`.
2. Server verifies creds + role, returns allowed companies.
3. `KioskSettingsForm` shows options; manager edits, confirms a restaurant change.
4. `saveKioskSettings(patch)` writes `localStorage`; kiosk page re-reads and applies.
5. Close/idle → relock. No cookie, no session.

## Error handling

- `admin-login`: 400 (missing fields), 401 (bad creds), 403 (inactive / not
  manager), 429 (rate limited), 500 (server). UI maps each to plain language.
- `localStorage` unavailable → fall back to in-memory defaults + URL param; the
  kiosk still works, settings just won't persist (surface a subtle note).
- Odoo `res.company` fetch failure → 500 with "Couldn't load your restaurants —
  try again"; login stays on the gate.

## Testing / verification

- `npm run build` clean (watch the CLAUDE.md TS pitfalls: `err: unknown`,
  no set-spread, `_`-prefix unused, `’` for apostrophes, `prefer-const`).
- Playwright on staging (`portal.krawings.de/kiosk`):
  1. Fresh kiosk (no `?company`) → gear → login as **staff** → refused.
  2. Login as **manager** → pick What a Jerk → confirm → grid loads that company's staff.
  3. Reload → still What a Jerk (persisted), no address-bar trick.
  4. Toggle sound / footer / fullscreen / idle → observe effect.
  5. Wrong password ×6 → rate-limit message.
  6. Confirm no `kw_session` cookie is set by the kiosk login.

## Rollback

Single feature, additive. Revert the one commit:
`git revert <hash> && git push`, then redeploy. `localStorage` key is harmless if
left behind (ignored once code is gone).

## Regression checklist

- [ ] Existing `?company=6` URL path still works.
- [ ] Staff punch flow (tap name → PIN → in/out) unchanged.
- [ ] Desktop / other portal pages untouched.
- [ ] No portal session created by the kiosk.
- [ ] Build passes; deployed to staging; Playwright steps above pass.
