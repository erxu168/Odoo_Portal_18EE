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
            return getPermissionState("bluetoothConnect") == PermissionState.GRANTED;
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
            else if ("connect".equals(method)) { connect(call); }
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
        try {
            closeSocket();
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            BluetoothDevice device = adapter.getRemoteDevice(address);
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
            outputStream = socket.getOutputStream();
            connectedAddress = address;
            Log.i(TAG, "Connected to " + device.getName());
            JSObject ret = new JSObject();
            ret.put("connected", true);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission denied: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Connect failed", e);
            call.reject("Connection failed: " + e.getMessage());
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
        try {
            if (outputStream != null) outputStream.close();
            if (socket != null) socket.close();
        } catch (Exception e) {
            Log.w(TAG, "Close error", e);
        }
        outputStream = null;
        socket = null;
        connectedAddress = null;
    }
}
