package de.krawings.station;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import de.krawings.station.plugins.ZebraPrintPlugin;

/**
 * Krawings Department Device — the shared kitchen tablet app.
 *
 * Capacitor generates this class, so this file REPLACES the generated one at
 * build time (see .github/workflows/build-station.yml). It exists for exactly
 * one reason: to register the native Bluetooth printer plugin.
 *
 * Why native at all: a label printer speaks classic Bluetooth (serial port
 * profile). An Android WebView has no Web Bluetooth API at all, so without
 * this the Label Print screen can never connect — its Connect button is simply
 * disabled. The plugin's Java is NOT copied here; the build takes the Portal
 * app's file and rewrites its package, so there is one implementation of
 * printing, not two that drift.
 *
 * Deliberately minimal — this is the OPEN variant of the tablet app. No kiosk
 * lock-task, no immersive mode, no HID scanner bridge; the Portal app keeps
 * those.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must precede super.onCreate: the bridge reads the registry there.
        registerPlugin(ZebraPrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
