#!/bin/bash
# Krawings Portal — Android Capacitor Setup
# Run this from the project root: /Users/ethan/Odoo_Portal_18EE
set -e

echo "=== Krawings Portal: Android Setup ==="
echo ""

# 1. Install Capacitor core + CLI + Android
echo "📦 Installing Capacitor..."
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android

# 2. Install Bluetooth Serial plugin for BT Classic SPP
echo "📦 Installing Bluetooth Serial plugin..."
npm install capacitor-bluetooth-serial

# 3. Add Android platform
echo "🤖 Adding Android platform..."
npx cap add android

# 4. Sync (copies web assets + plugin configs to native project)
echo "🔄 Syncing..."
npx cap sync android

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Open in Android Studio:  npx cap open android"
echo "  2. Connect your Android tablet via USB"
echo "  3. Click Run (green play button) in Android Studio"
echo "  4. The app will load portal.krawings.de with native BT printing"
echo ""
echo "To rebuild after plugin changes:"
echo "  npx cap sync android"
echo "  Then rebuild in Android Studio"
