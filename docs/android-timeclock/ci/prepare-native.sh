#!/usr/bin/env bash
# Wire the Time Clock kiosk lock-task native code into the Capacitor-generated
# android/ project. Run AFTER `npx cap add android`. Idempotent: safe to re-run.
#
# This is the CI-automated version of README steps 3 (drop in native code) and the
# manifest edit — so the app can be built in the cloud with no manual Android Studio
# work. See docs/android-timeclock/README.md for the human walkthrough.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # docs/android-timeclock
NATIVE="$HERE/native"
ROOT="$(cd "$HERE/../.." && pwd)"                          # repo root
PKG="$ROOT/android/app/src/main/java/de/krawings/timeclock"
RES_XML="$ROOT/android/app/src/main/res/xml"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"

mkdir -p "$PKG" "$RES_XML"
cp "$NATIVE/MainActivity.java"             "$PKG/MainActivity.java"
cp "$NATIVE/KioskDeviceAdminReceiver.java" "$PKG/KioskDeviceAdminReceiver.java"
cp "$NATIVE/device_admin.xml"              "$RES_XML/device_admin.xml"

# Inject the <receiver> block from AndroidManifest.additions.xml into the generated
# manifest, just before </application>. The additions file stays the source of truth.
python3 - "$NATIVE/AndroidManifest.additions.xml" "$MANIFEST" <<'PY'
import re, sys
additions, manifest = sys.argv[1], sys.argv[2]
block = re.search(r"<receiver[\s\S]*?</receiver>", open(additions).read()).group(0)
txt = open(manifest).read()
if "KioskDeviceAdminReceiver" in txt:
    print("Receiver already present; leaving manifest as-is.")
else:
    indented = "        " + block.replace("\n", "\n        ")
    txt = txt.replace("</application>", indented + "\n    </application>", 1)
    open(manifest, "w").write(txt)
    print("Injected KioskDeviceAdminReceiver into AndroidManifest.xml.")
PY

echo "Kiosk lock-task native code wired into android/."
