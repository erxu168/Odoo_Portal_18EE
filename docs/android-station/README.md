# Kitchen Station — Android app

A Capacitor wrapper that turns the shared kitchen-tablet experience into an
installable Android app. It opens straight to `https://portal.krawings.de`, which
— on a tablet a manager has provisioned — shows the **name-then-PIN sign-in** and
then the Kitchen Station home.

This is the **open** variant: a normal app the staff can leave (Home button works).
It is NOT kiosk-locked. (The clock-in app in `docs/android-timeclock/` shows how to
add lock-task/kiosk mode if you ever want that here too.)

- **App name:** Kitchen Station
- **App id:** `de.krawings.station` (installs alongside the Portal + Time Clock apps)
- **Points at:** `https://portal.krawings.de` (STAGING today). To ship a production
  build, change `server.url` in `capacitor.config.json` to the production portal.

## Build it (no Mac / Android Studio needed)

The APK is cloud-built by GitHub Actions:
`.github/workflows/build-station.yml`.

- It runs automatically when you push a change under `docs/android-station/**`, or
- run it on demand: GitHub → **Actions** → **Build Kitchen Station APK** → *Run workflow*.

The finished `.apk` is published to the rolling **`station-latest`** GitHub release
and attached to the run as an artifact.

## Install on a tablet

1. On the tablet's browser, open the `station-latest` release and tap
   `krawings-station.apk`.
2. Allow "install from unknown sources" when prompted.
3. Open **Kitchen Station**. A manager sets the tablet up once (email + password →
   pick restaurant); after that staff just tap their name and enter their PIN.

## Icon

The first build reuses the existing app art as a placeholder. To brand it, drop a
`docs/android-station/assets/icon-only.png` (1024×1024) and point the workflow's icon
step at it.
