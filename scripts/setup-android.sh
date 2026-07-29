#!/bin/bash
# Krawings Portal Android app — local build helper.
#
# The native project is COMMITTED at apps/portal/android (it holds custom native code:
# the Zebra Bluetooth print plugin + barcode scanner bridge), so there is NO `cap add` —
# that would wipe the custom Java. Just install root deps, sync, and build.
#
# Run this from the repo root. CI does the same thing in .github/workflows/android-apk.yml
# and publishes the .apk to the 'portal-latest' GitHub release.
set -e

echo "=== Krawings Portal (apps/portal): local Android build ==="
echo ""

# 1. Install JS deps once at the repo root. Capacitor's CLI + the @capacitor-mlkit/barcode
#    plugin resolve from the repo-root node_modules (apps/portal has its own package.json
#    so the CLI has a manifest in its CWD, but no separate install is needed).
echo "📦 npm ci (repo root)..."
npm ci

# 2. Sync Capacitor into the committed native project. This regenerates
#    apps/portal/android/capacitor.settings.gradle with node_modules paths relative to
#    apps/portal — required before a local ./gradlew or Android Studio build will resolve.
echo "🔄 cap sync (from apps/portal)..."
( cd apps/portal && npx cap sync android )

echo ""
echo "=== Ready ==="
echo "Build the debug APK:  ( cd 'apps/portal/android' && ./gradlew assembleDebug )"
echo "Open in Studio:       ( cd apps/portal && npx cap open android )"
echo "The app loads portal.krawings.de with native BT/Zebra printing + barcode scanning."
