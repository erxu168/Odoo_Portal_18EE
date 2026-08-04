# WAJ Radio — Sunmi T2s Setup Runbook (one page)

The jukebox = the portal page `/music/player`, installed as an app from Chrome.
Chrome is signed into Ethan's **YouTube Premium** account once → **no ads**.

## One-time setup (≈30 min, needs: the dedicated T2s, speaker cable, Ethan's Google login)

1. **Chrome:** install a CURRENT Chrome on the T2s (Play Store if present, else
   sideload the APK). Sunmi's stock browser/WebView is too old — don't use it.
2. **Premium sign-in:** in Chrome, open youtube.com → sign in with Ethan's
   account → play any video → confirm **no ad** and the account avatar shows.
3. **Portal login:** open `https://portal.krawings.de/music/player` → log in with
   the WAJ shared-tablet account (Shared Tablets flow).
4. **Pin the device:** on a manager phone → Music → Settings → pick this tablet
   under "Which tablet plays the music?" → it shows **▶ THE PLAYER**.
5. **Warm the radio:** Music → Settings → **Warm up the radio** → every shelf
   shows songs (> 0).
6. **Install the app:** in Chrome on the player page → menu ⋮ → **Install app**
   (or "Add to Home screen") → an icon named **WAJ Radio** appears. Open it —
   fullscreen, landscape, no browser bars.
7. **Audio:** 3.5 mm jack (or Bluetooth) to the amp/speakers. The built-in
   speaker is far too weak. Set Android media volume to ~80%, trim on the amp.
8. **Keep-awake:** the page holds a wake lock; additionally set Display → Sleep
   → Never (or use the kiosk settings) so the screen never turns off.

## Phase-0 verification checklist (tick ALL before calling it done)

- [ ] A song plays **without any ad** (Premium session active in the app).
- [ ] Reopening the app starts music **without a tap** (autoplay exemption).
- [ ] Screen stays on for 15+ min while playing.
- [ ] Searching with the Android keyboard open leaves the video **fully visible**.
- [ ] A blocked genre (search "techno mix") shows *Not the What A Jerk vibe 🌴*.
- [ ] An unknown song lands in Music → Song Requests on a manager phone;
      approving it (pick a shelf) lets it play on the next tap.
- [ ] Skip works and shows in Music → Play History with the staff name.
- [ ] Pull the network for 30 s — the current song keeps playing; the player
      reconnects afterwards.
- [ ] If a video shows "Playback error" the player skips it by itself within ~2 s.

## Troubleshooting

- **Ads appear** → Chrome lost the sign-in. Open Chrome → youtube.com → sign in
  again. (The app inherits Chrome's session.)
- **"This tablet is not the WAJ Radio player"** → Music → Settings on a manager
  phone → pin this device.
- **"Radio needs a first warm-up"** → Music → Settings → Warm up the radio.
- **Search says it's taking a break** → YouTube changed something internal; the
  radio keeps playing from its shelves. Tell Claude — it's a small library bump
  (`youtubei.js` in the portal), usually fixed upstream within days.
- **Silence after a reboot** → open the WAJ Radio icon once (apps can't
  self-start after boot in v1).
