package de.krawings.portal.plugins;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "ZebraPrint",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        ),
        @Permission(
            alias = "bluetoothConnect",
            strings = { "android.permission.BLUETOOTH_CONNECT" }
        ),
        @Permission(
            alias = "bluetoothScan",
            strings = { "android.permission.BLUETOOTH_SCAN" }
        )
    }
)
public class ZebraPrintPlugin extends Plugin {

    private static final String TAG = "ZebraPrint";
    private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothSocket socket;
    private OutputStream outputStream;
    private String connectedAddress;

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // BOTH: CONNECT to open the socket, SCAN because cancelDiscovery()
            // requires it. Checking only CONNECT let us past this gate and then
            // cancelDiscovery threw SecurityException, which was discarded — so
            // discovery kept running and defeated the connection.
            return getPermissionState("bluetoothConnect") == PermissionState.GRANTED
                && getPermissionState("bluetoothScan") == PermissionState.GRANTED;
        }
        return getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    private void ensurePermissions(PluginCall call, String callbackName) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetoothConnect") != PermissionState.GRANTED ||
                getPermissionState("bluetoothScan") != PermissionState.GRANTED) {
                requestAllPermissions(call, callbackName);
                return;
            }
        } else {
            if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
                requestAllPermissions(call, callbackName);
                return;
            }
        }
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        if (hasBluetoothPermissions()) {
            String method = call.getMethodName();
            if ("list".equals(method)) { list(call); }
            // A permission result is delivered on the MAIN thread. connect()
            // blocks for up to ~12 seconds per attempt, so calling it straight
            // from here freezes the app and can trip an ANR. Ordinary plugin
            // calls already arrive on Capacitor's worker thread; only this path
            // needs moving off the UI.
            else if ("connect".equals(method)) {
                new Thread(new Runnable() {
                    @Override public void run() { connect(call); }
                }, "ZebraPrint-connect").start();
            }
            else if ("isEnabled".equals(method)) { isEnabled(call); }
        } else {
            call.reject("Bluetooth permission denied. Enable in Settings.");
        }
    }

    @PluginMethod()
    public void isEnabled(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            ensurePermissions(call, "bluetoothPermissionCallback");
            return;
        }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        JSObject ret = new JSObject();
        ret.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod()
    public void list(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            ensurePermissions(call, "bluetoothPermissionCallback");
            return;
        }
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) { call.reject("Bluetooth not available"); return; }
            if (!adapter.isEnabled()) { call.reject("Bluetooth is disabled"); return; }
            Set<BluetoothDevice> paired = adapter.getBondedDevices();
            JSArray devices = new JSArray();
            for (BluetoothDevice d : paired) {
                JSObject dev = new JSObject();
                dev.put("name", d.getName());
                dev.put("address", d.getAddress());
                devices.put(dev);
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission denied: " + e.getMessage());
        } catch (Exception e) {
            call.reject("List failed: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void connect(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            ensurePermissions(call, "bluetoothPermissionCallback");
            return;
        }
        String address = call.getString("address");
        if (address == null) { call.reject("address required"); return; }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) { call.reject("This device has no Bluetooth."); return; }
        if (!adapter.isEnabled()) { call.reject("Bluetooth is turned off. Switch it on and try again."); return; }

        try {
            closeSocket();

            // Android requires discovery to be cancelled before opening a
            // connection: a scan is heavyweight and makes connect() fail. The
            // Bluetooth settings screen scans continuously while it is open,
            // which is the common real-world cause. NOT swallowed any more — a
            // SecurityException here means the SCAN permission is missing and
            // the caller needs to know rather than wonder.
            String discoveryNote = "";
            try {
                adapter.cancelDiscovery();
            } catch (SecurityException e) {
                discoveryNote = " Android would not let the app stop the Bluetooth scan (missing permission), which can block the connection.";
                Log.w(TAG, "cancelDiscovery denied", e);
            }

            BluetoothDevice device = adapter.getRemoteDevice(address);

            // What KIND of device is this? A ZD420's Bluetooth Classic radio was
            // a factory option — BLE is the standard fitment — and a BLE-only
            // printer can be paired yet never accept this kind of connection.
            // Reported in the failure message so "it does not work" becomes
            // "this printer has no Classic radio".
            String kind = "unknown";
            try {
                int t = device.getType();
                kind = (t == BluetoothDevice.DEVICE_TYPE_CLASSIC) ? "Classic"
                     : (t == BluetoothDevice.DEVICE_TYPE_LE) ? "Bluetooth LE only"
                     : (t == BluetoothDevice.DEVICE_TYPE_DUAL) ? "Classic + LE" : "unknown";
            } catch (Exception ignored) { }

            // Does the printer actually offer the serial-port service? If this
            // says no, retrying is pointless and the printer needs its settings
            // or firmware changed. If it says yes, the capability is there and
            // the problem is the link — which is what the insecure attempt is for.
            String spp = "unknown";
            try {
                android.os.ParcelUuid[] uuids = device.getUuids();
                if (uuids == null) {
                    spp = "not cached (try re-pairing)";
                } else {
                    spp = "no";
                    for (android.os.ParcelUuid u : uuids) {
                        if (SPP_UUID.equals(u.getUuid())) { spp = "yes"; break; }
                    }
                }
            } catch (Exception ignored) { }
            Log.i(TAG, "Connecting to " + address + " (radio: " + kind + ", serial-port service: " + spp + ")");

            Exception last = null;
            // Secure first (correct for most printers), then INSECURE — public
            // API, and what Zebra's own SDK tries when the printer's security
            // mode will not do an authenticated link. Direct channel 1 is a
            // last resort only: it skips the service lookup and assumes a
            // channel number, so it is a diagnostic, not a real answer.
            for (int attempt = 0; attempt < 3 && socket == null; attempt++) {
                if (attempt > 0) {
                    try { Thread.sleep(400); }
                    catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                    try { adapter.cancelDiscovery(); } catch (Exception ignored) { }
                }
                BluetoothSocket candidate = null;
                try {
                    if (attempt == 0) {
                        candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    } else if (attempt == 1) {
                        candidate = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    } else {
                        candidate = (BluetoothSocket) device.getClass()
                            .getMethod("createRfcommSocket", new Class[] { int.class })
                            .invoke(device, Integer.valueOf(1));
                    }
                    candidate.connect();
                    socket = candidate;
                    candidate = null;          // ownership handed over
                } catch (Exception e) {
                    Throwable cause = (e.getCause() != null) ? e.getCause() : e;
                    last = (cause instanceof Exception) ? (Exception) cause : e;
                    Log.w(TAG, "Attempt " + (attempt + 1) + " failed: " + last);
                } finally {
                    // Every failed attempt owns a real native socket. Leaving it
                    // open leaks a file descriptor and can make the next attempt
                    // worse.
                    if (candidate != null) {
                        try { candidate.close(); }
                        catch (Exception ce) { Log.w(TAG, "Could not close a failed socket", ce); }
                    }
                }
            }

            if (socket == null) {
                throw new Exception((last != null ? last.getMessage() : "no connection")
                    + " [radio: " + kind + ", serial-port service: " + spp + "]" + discoveryNote);
            }

            try {
                outputStream = socket.getOutputStream();
            } catch (Exception e) {
                closeSocket();                  // do not keep a socket we cannot write to
                throw e;
            }
            connectedAddress = address;
            Log.i(TAG, "Connected to " + device.getName() + " (" + kind + ")");
            JSObject ret = new JSObject();
            ret.put("connected", true);
            ret.put("radio", kind);
            ret.put("spp", spp);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission denied: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Connect failed", e);
            call.reject(
                "Could not open a connection to the printer. Worth checking: "
                + "the printer is on and awake; "
                + "the Android Bluetooth settings screen is closed (it keeps scanning, which can block a connection); "
                + "no other phone or tablet is connected to it. "
                + "If the radio below says Bluetooth LE only, this printer has no Classic radio and cannot print this way. "
                + "(" + e.getMessage() + ")");
        }
    }

    @PluginMethod()
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("data required"); return; }
        if (outputStream == null) { call.reject("Not connected"); return; }
        try {
            outputStream.write(data.getBytes("UTF-8"));
            outputStream.flush();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Write failed", e);
            call.reject("Write failed: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void disconnect(PluginCall call) {
        closeSocket();
        if (call != null) {
            JSObject ret = new JSObject();
            ret.put("disconnected", true);
            call.resolve(ret);
        }
    }

    @PluginMethod()
    public void isConnected(PluginCall call) {
        boolean connected = socket != null && socket.isConnected() && outputStream != null;
        JSObject ret = new JSObject();
        ret.put("connected", connected);
        ret.put("address", connectedAddress);
        if (connected && connectedAddress != null) {
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                BluetoothDevice device = adapter.getRemoteDevice(connectedAddress);
                ret.put("name", device.getName());
            } catch (Exception e) {
                ret.put("name", "Zebra Printer");
            }
        }
        call.resolve(ret);
    }

    private void closeSocket() {
        // Separate try blocks on purpose: if closing the stream throws, the
        // SOCKET must still be closed. Sharing one block skipped it and leaked
        // the native connection, which then blocks the next connect.
        try { if (outputStream != null) outputStream.close(); }
        catch (Exception e) { Log.w(TAG, "Stream close error", e); }
        try { if (socket != null) socket.close(); }
        catch (Exception e) { Log.w(TAG, "Socket close error", e); }
        outputStream = null;
        socket = null;
        connectedAddress = null;
    }
}
