# Krawings Time Clock — Android kiosk app (Capacitor)

A dedicated Android app that **is** the Time Clock kiosk. It's a thin
[Capacitor](https://capacitorjs.com/) wrapper around the existing web page
`https://portal.krawings.de/kiosk` — the same recipe as your `android/` (Portal)
and `android-kds/` (KDS) apps. No screens are rebuilt: the app just loads the kiosk
you already have, full-screen, and (optionally) pins the tablet to it.

- **App id:** `de.krawings.timeclock`
- **App name:** Krawings Time Clock
- **Loads:** `https://portal.krawings.de/kiosk` (staging — see step 7 to switch to prod)
- **Kiosk lock:** Android *lock task / screen pinning* (see step 6)

> **Why this is a "setup kit" and not a prebuilt APK:** building/signing an Android
> app needs a JDK + the Android SDK, which the assistant's environment doesn't have.
> Every step below runs on **your Mac** in Android Studio (Panda) — the same tools
> you already used for the other two apps. All the custom parts (config + the
> lock-task native code) are in this folder, ready to paste.

---

## 0. Prerequisites (you already have these from the other apps)

- Node + this repo checked out, `npm install` done.
- **Android Studio (Panda)** + a JDK 17 + Android SDK.
- A test tablet with **USB debugging** on, or an emulator.

## 1. Add the Capacitor config for the Time Clock app

Capacitor uses one config per app. The repo's root `capacitor.config.ts` currently
points at the **Portal** app. For a separate Time Clock build, the simplest, least
error-prone approach is a **separate working copy / branch** where the root config is
this app's config, exactly like you did for KDS. Copy this folder's config over the
root one before generating the native project:

```bash
cp docs/android-timeclock/capacitor.config.json ./capacitor.config.json
# (temporarily replaces capacitor.config.ts's values for this build only —
#  Capacitor reads .json if present. Revert/remove it when you go back to Portal.)
```

`capacitor.config.json` (also in this folder):

```json
{
  "appId": "de.krawings.timeclock",
  "appName": "Krawings Time Clock",
  "webDir": "www",
  "server": { "url": "https://portal.krawings.de/kiosk", "cleartext": true, "androidScheme": "https" },
  "android": { "allowMixedContent": true }
}
```

> `webDir: "www"` just needs to exist. Because we use `server.url`, the app loads the
> live site, not bundled files. If `www/` is missing: `mkdir -p www && echo "" > www/index.html`.

## 2. Generate the native Android project

```bash
npx cap add android      # creates ./android from the config above
npx cap sync android     # copies config + plugins into the native project
```

This produces `android/app/src/main/java/de/krawings/timeclock/MainActivity.java`
and `android/app/src/main/AndroidManifest.xml`.

## 3. Drop in the kiosk (lock-task) native code

From this folder (`docs/android-timeclock/native/`):

1. Replace the generated **MainActivity.java** with `native/MainActivity.java`
   (path: `android/app/src/main/java/de/krawings/timeclock/MainActivity.java`).
2. Copy `native/KioskDeviceAdminReceiver.java` next to it (same `de.krawings.timeclock` folder).
3. Copy `native/device_admin.xml` to `android/app/src/main/res/xml/device_admin.xml`.
4. Paste the `<receiver>` block from `native/AndroidManifest.additions.xml` **inside**
   the `<application>` element of `android/app/src/main/AndroidManifest.xml`
   (next to the MainActivity `<activity>` — don't replace the whole manifest).

## 4. Icon + name (optional but nice)

- Name shows from the config ("Krawings Time Clock").
- Icons: Android Studio → right-click `app` → **New → Image Asset** → set a Time
  Clock icon (reuse the 🕒 brand). Or drop `mipmap-*` PNGs as usual.

## 5. Build, install, run

```bash
npx cap open android     # opens the project in Android Studio
```

In Android Studio: pick the tablet/emulator → **Run**. The app launches and loads
the kiosk. For a shareable build: **Build → Generate Signed Bundle / APK** (create or
reuse a keystore; keep it safe — you need the same key for updates).

At this point (no device-owner yet) the app works and, on resume, requests **screen
pinning**. Android may show a one-time "pin this app?" prompt — accept it. A user can
still leave by holding Back+Overview. For a **locked, non-exitable** kiosk, do step 6.

## 6. Full kiosk lock-down (device owner) — recommended for real tablets

Screen pinning alone is exitable. To truly lock the tablet to the Time Clock, make
the app the tablet's **device owner**. This must be done on a **freshly factory-reset
tablet with no Google account added yet**:

```bash
# 1) Install the app (from Android Studio Run, or:)
adb install app-release.apk

# 2) Make it device owner (no accounts may exist on the device, or this fails)
adb shell dpm set-device-owner de.krawings.timeclock/.KioskDeviceAdminReceiver
```

Once it's device owner, `KioskDeviceAdminReceiver.onEnabled()` allowlists the app for
lock task, so `startLockTask()` becomes a **fully enforced kiosk** — Home, Back,
Recents and the status bar can't leave the app. To undo for maintenance:

```bash
adb shell dpm remove-active-admin de.krawings.timeclock/.KioskDeviceAdminReceiver
```

> For a fleet of tablets, an MDM/EMM (e.g. Android Enterprise, Scalefusion, TinyMDM)
> can push this app and enforce kiosk mode centrally instead of per-device ADB.

## 7. Point it at production later

The kiosk currently lives on **staging**. When the kiosk settings ship to prod
(`staff.krawings.de/kiosk`), switch the app over:

```bash
# edit capacitor.config.json -> "url": "https://staff.krawings.de/kiosk"
npx cap sync android
# rebuild + reinstall
```

No code change — just the URL. (The kiosk page shows a red banner when it's talking
to production Odoo, so you can always tell which environment a tablet is on.)

## 8. First-run on the tablet

1. Launch **Krawings Time Clock**.
2. Tap the ⚙ gear → sign in as a **manager/admin** → pick **What a Jerk** → confirm.
3. The clock now shows that restaurant's staff. Turn on the options you want
   (full-screen lock, sound, etc.). Settings persist on the device.
4. If you did step 6, the tablet is now locked to the clock.

---

## Troubleshooting

- **`dpm set-device-owner` fails ("not allowed ... accounts on the device")** — the
  tablet must be factory-reset with **no** Google/other accounts added. Reset, skip
  account setup, then run it.
- **App shows a blank/❌ page** — the tablet has no internet, or a firewall blocks
  `portal.krawings.de`. Open that URL in the tablet's browser to confirm.
- **"pin this app" keeps prompting** — that's screen pinning without device owner
  (step 5). Do step 6 for a silent, enforced lock.
- **Camera/scanner** — not needed for the clock; the kiosk uses no camera.

## Files in this kit

| File | Goes to |
|------|---------|
| `capacitor.config.json` | repo root (for this build) |
| `native/MainActivity.java` | `android/app/src/main/java/de/krawings/timeclock/` |
| `native/KioskDeviceAdminReceiver.java` | `android/app/src/main/java/de/krawings/timeclock/` |
| `native/device_admin.xml` | `android/app/src/main/res/xml/` |
| `native/AndroidManifest.additions.xml` | paste into `android/app/src/main/AndroidManifest.xml` |

> **Note:** like the existing `android/` and `android-kds/` projects, the generated
> `android/` folder for this app is large and currently kept **out of git** on this
> repo. This kit (config + native snippets + guide) is what's version-controlled, so
> the app is reproducible from a clean checkout.
