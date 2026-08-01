# Cooking Timer — Android app

A Capacitor wrapper that turns the **KDS Cooking Timer** station screen into an
installable Android tablet app. It opens straight to
`https://portal.krawings.de/cooktimer` — on first launch a tablet signs in
(name-then-PIN, or manager email/password), then lands directly on the **TO COOK**
timer board. Same idea as the Krawings Department Device app, but pointed at the
cooking timer instead of the portal home.

This is the **open** variant: a normal app staff can leave (Home button works).
It is NOT kiosk-locked. (The clock-in app in `docs/android-timeclock/` shows how to
add lock-task/kiosk mode if you ever want that here too.)

- **App name:** Cooking Timer
- **App id:** `de.krawings.cooktimer` (installs alongside the Portal, Department
  Device, and Time Clock apps)
- **Points at:** `https://portal.krawings.de/cooktimer` (STAGING today). To ship a
  production build, change `server.url` in `capacitor.config.json` to the production
  portal.

## Build it (no Mac / Android Studio needed)

The APK is cloud-built by GitHub Actions: `.github/workflows/build-cooktimer.yml`.

- It runs automatically when you push a change under `docs/android-cooktimer/**`, or
- run it on demand: GitHub → **Actions** → **Build Cooking Timer APK** → *Run workflow*.

The finished `.apk` is published to the rolling **`cooktimer-latest`** GitHub release
and attached to the run as an artifact.

## Install on a tablet

1. On the tablet's browser, open the `cooktimer-latest` release and tap
   `krawings-cooktimer.apk`.
2. Allow "install from unknown sources" when prompted.
3. Open **Cooking Timer**. Sign in once; after that it opens straight to the timer
   board for the stations that tablet has enabled (⚙ in the app).

## Icon

`docs/android-cooktimer/assets/icon-only.png` (1024×1024) is the Cooking Timer app
icon — the red stopwatch with orange wings. To change it, replace that file (square,
≥1024×1024) and push; the workflow regenerates every Android density from it.
