package de.krawings.timeclock;

import android.app.ActivityManager;
import android.content.Context;
import com.getcapacitor.BridgeActivity;

/**
 * Time Clock kiosk activity. On top of the vanilla Capacitor BridgeActivity it
 * enters Android "lock task" (kiosk) mode whenever it comes to the foreground, so
 * staff stay on the clock and can't wander to other apps or the browser.
 *
 * Enforcement level depends on how the tablet is provisioned (see README):
 *   - App is DEVICE OWNER  -> lock task is fully enforced, no exit gesture.
 *   - Not device owner     -> startLockTask() falls back to Android screen pinning
 *                             (a strong deterrent; exitable by holding Back+Overview).
 */
public class MainActivity extends BridgeActivity {

  @Override
  public void onResume() {
    super.onResume();
    ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
    if (am != null && am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) {
      try {
        startLockTask();
      } catch (Exception e) {
        // Lock task not permitted (not device owner / not allowlisted). The app
        // still runs normally; it just isn't pinned. Provision as device owner
        // (README step 6) to enforce it.
      }
    }
  }
}
