package de.krawings.portal;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;

/**
 * JavaScript bridge for native barcode scanning via Google ML Kit.
 * Exposed as window.KrawingsScanner in the WebView.
 *
 * Usage from JS:
 *   window.KrawingsScanner.scan();  // opens native scanner
 *   window.addEventListener('nativeBarcodeScan', (e) => {
 *     e.detail.barcode   — scanned value (string)
 *     e.detail.cancelled — user pressed back (boolean)
 *     e.detail.error     — error message (string)
 *   });
 */
public class BarcodeScannerBridge {
    private final Activity activity;
    private final WebView webView;

    public BarcodeScannerBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    @JavascriptInterface
    public void scan() {
        activity.runOnUiThread(() -> {
            GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                    Barcode.FORMAT_EAN_13,
                    Barcode.FORMAT_EAN_8,
                    Barcode.FORMAT_CODE_128,
                    Barcode.FORMAT_UPC_A)
                .build();

            GmsBarcodeScanning.getClient(activity, options)
                .startScan()
                .addOnSuccessListener(barcode -> {
                    String raw = barcode.getRawValue();
                    if (raw != null) {
                        String escaped = raw.replace("\\", "\\\\").replace("'", "\\'");
                        dispatchEvent("{ barcode: '" + escaped + "' }");
                    } else {
                        dispatchEvent("{ cancelled: true }");
                    }
                })
                .addOnCanceledListener(() -> dispatchEvent("{ cancelled: true }"))
                .addOnFailureListener(e -> {
                    String msg = e.getMessage() != null
                        ? e.getMessage().replace("\\", "\\\\").replace("'", "\\'")
                        : "Scanner error";
                    dispatchEvent("{ error: '" + msg + "' }");
                });
        });
    }

    private void dispatchEvent(String detail) {
        String js = "window.dispatchEvent(new CustomEvent('nativeBarcodeScan', { detail: " + detail + " }));";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
