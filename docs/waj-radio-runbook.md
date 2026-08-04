# WAJ Radio — Sunmi T2s Setup Runbook (one page)

The jukebox = the portal page `/music/player`, run in **Firefox** (Ethan's
choice — Chrome misbehaves on this Sunmi). Firefox is signed into Ethan's
**YouTube Premium** account once → **no ads**. (Chrome up to v138 also works on
Android 9 if ever needed — same steps, autoplay granted by installing as app.)

## One-time setup (≈30 min, needs: the dedicated T2s, speaker cable, Ethan's Google login)

1. **Firefox:** install/update Firefox on the T2s (Sunmi app store or sideload
   the APK). Don't use Sunmi's stock browser — too old.
2. **Premium sign-in:** in Firefox, open youtube.com → sign in with Ethan's
   account → play any video → confirm **no ad** and the account avatar shows.
3. **Allow autoplay (kills the daily start-tap):** Firefox menu ⋮ → Settings →
   Site permissions → Autoplay → **Allow audio and video** (or per-site for
   portal.krawings.de once it's open).
4. **Portal login:** open `https://portal.krawings.de/music/player` → log in with
   the WAJ shared-tablet account (Shared Tablets flow).
5. **Pin the device:** on a manager phone → Music → Settings → pick this tablet
   under "Which tablet plays the music?" → it shows **▶ THE PLAYER**.
6. **Warm the radio:** Music → Settings → **Warm up the radio** → every shelf
   shows songs (> 0).
7. **Home-screen icon:** Firefox menu ⋮ on the player page → **Add to Home
   screen** → an icon named **WAJ Radio** appears; it opens straight into the
   player (a slim Firefox bar may stay visible — cosmetic only).
8. **Audio:** 3.5 mm jack (or Bluetooth) to the amp/speakers. The built-in
   speaker is far too weak. Set Android media volume to ~80%, trim on the amp.
9. **Keep-awake:** the page holds a wake lock where Firefox supports it; ALSO
   set Android Display → Sleep → Never so the screen definitely stays on.

## Phase-0 verification checklist (tick ALL before calling it done)

- [ ] A song plays **without any ad** (Premium session active in this Firefox).
- [ ] Reopening the player starts music **without a tap** (autoplay allowed).
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

- **Ads appear** → Firefox lost the YouTube sign-in. Open youtube.com in the
  same Firefox → sign in again.
- **"This tablet is not the WAJ Radio player"** → Music → Settings on a manager
  phone → pin this device.
- **"Radio needs a first warm-up"** → Music → Settings → Warm up the radio.
- **Search says it's taking a break** → YouTube changed something internal; the
  radio keeps playing from its shelves. Tell Claude — it's a small library bump
  (`youtubei.js` in the portal), usually fixed upstream within days.
- **A tap is needed after all** → Firefox autoplay permission got reset; redo
  step 3. (The player also shows its own big Start button as a fallback.)
- **Silence after a reboot** → open the WAJ Radio icon once (apps can't
  self-start after boot in v1).
