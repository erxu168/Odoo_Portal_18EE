package de.krawings.portal;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebView;
import android.view.Gravity;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import de.krawings.portal.plugins.ZebraPrintPlugin;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    // Buffer for Bluetooth/USB HID scanner keystrokes. Physical keyboard
    // events are intercepted at Activity level before the WebView can
    // swallow them, buffered, and dispatched to JS as a `nativeHidScan`
    // CustomEvent on Enter. See src/hooks/useHardwareScanner.ts for the
    // matching JS listener.
    private final StringBuilder scannerBuffer = new StringBuilder();
    private long lastScannerKeyTime = 0;
    private WebView portalWebView = null;
    private final Handler scannerFlushHandler = new Handler(Looper.getMainLooper());
    private final Runnable scannerFlushRunnable = new Runnable() {
        @Override
        public void run() {
            flushScannerBuffer();
        }
    };

    private void flushScannerBuffer() {
        final String barcode = scannerBuffer.toString();
        scannerBuffer.setLength(0);
        if (barcode.length() >= 4 && portalWebView != null) {
            final String js = "window.dispatchEvent(new CustomEvent('nativeHidScan', { detail: { barcode: "
                + JSONObject.quote(barcode) + " } }))";
            portalWebView.evaluateJavascript(js, null);
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZebraPrintPlugin.class);
        super.onCreate(savedInstanceState);

        // Register native barcode scanner bridge (window.KrawingsScanner)
        portalWebView = getBridge().getWebView();
        portalWebView.addJavascriptInterface(
            new BarcodeScannerBridge(this, portalWebView),
            "KrawingsScanner"
        );

        // Clear the WebView's HTTP cache on every cold start. The portal sends
        // Cache-Control: no-store on authenticated HTML, but Android WebView
        // sometimes caches old responses across deploys regardless. Wiping
        // here costs one re-fetch per app launch (~30 KB of hashed JS chunks
        // re-download once and then live forever) but guarantees that staff
        // never run on stale code after we ship a fix.
        portalWebView.clearCache(true);

        enableImmersiveMode();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Per-key debug toasts removed — they queued up and hid the
        // "Scan fired" confirmation. Keep only the final scan toast.

        // Capture Bluetooth/USB HID scanner input before the WebView.
        // Strategy: any physical (non-virtual) keyboard input is treated
        // as scanner output. Buffer keys, fire JS event on Enter. Always
        // consume physical key events so they never reach the WebView.
        if (event.getDevice() == null || event.getDevice().isVirtual()) {
            return super.dispatchKeyEvent(event);
        }
        if ((event.getSource() & InputDevice.SOURCE_KEYBOARD) == 0) {
            return super.dispatchKeyEvent(event);
        }

        // Ignore key-up — we act on key-down to avoid double-processing
        if (event.getAction() != KeyEvent.ACTION_DOWN) {
            return true;
        }

        long now = System.currentTimeMillis();
        long gap = now - lastScannerKeyTime;
        lastScannerKeyTime = now;

        if (gap > 500 && scannerBuffer.length() > 0) {
            scannerBuffer.setLength(0);
        }

        int code = event.getKeyCode();

        // Enter → flush immediately
        if (code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            scannerFlushHandler.removeCallbacks(scannerFlushRunnable);
            flushScannerBuffer();
            return true;
        }

        // Try multiple ways to get the character, since getUnicodeChar()
        // returns 0 on some scanner models or when meta keys are set.
        char c = (char) event.getUnicodeChar();
        if (c == 0) {
            c = (char) event.getUnicodeChar(0); // ignore meta state
        }
        if (c == 0) {
            // Fall back to key-code→character for digits and letters
            if (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9) {
                c = (char) ('0' + (code - KeyEvent.KEYCODE_0));
            } else if (code >= KeyEvent.KEYCODE_A && code <= KeyEvent.KEYCODE_Z) {
                c = (char) ('a' + (code - KeyEvent.KEYCODE_A));
            }
        }
        if (c != 0 && c >= ' ' && c < 127) {
            scannerBuffer.append(c);
            // Schedule a timeout flush: if no new key arrives within 300ms,
            // assume the scanner finished and fire the event. This makes
            // us resilient to scanners that don't send an Enter suffix.
            scannerFlushHandler.removeCallbacks(scannerFlushRunnable);
            scannerFlushHandler.postDelayed(scannerFlushRunnable, 300);
        }

        return true; // Consume — no typing into inputs, no button nav
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveMode();
        }
    }

    private void enableImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+ (Android 11+)
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            // API 24-29
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }
}
