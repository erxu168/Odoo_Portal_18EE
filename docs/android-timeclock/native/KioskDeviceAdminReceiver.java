package de.krawings.timeclock;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/**
 * Device-admin receiver used to provision this app as the tablet's DEVICE OWNER
 * (see README step 6). Once it is device owner, we allowlist our own package for
 * lock task so MainActivity.startLockTask() becomes a fully enforced kiosk with no
 * exit gesture. If you never make the app device owner, this receiver is harmless.
 */
public class KioskDeviceAdminReceiver extends DeviceAdminReceiver {

  @Override
  public void onEnabled(Context context, Intent intent) {
    super.onEnabled(context, intent);
    DevicePolicyManager dpm =
        (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
    ComponentName admin = new ComponentName(context, KioskDeviceAdminReceiver.class);
    if (dpm != null && dpm.isDeviceOwnerApp(context.getPackageName())) {
      // Allowlist ourselves so lock task cannot be exited.
      dpm.setLockTaskPackages(admin, new String[] { context.getPackageName() });
    }
  }
}
