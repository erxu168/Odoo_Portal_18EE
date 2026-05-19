'use client';

import { useEffect, useState } from 'react';

/**
 * Track browser online/offline state.
 *
 * `navigator.onLine` is the source of truth — it flips on the actual
 * radio/wifi state changes via the `online` / `offline` window events.
 * It does NOT detect captive portals or app-server-only outages — for
 * those, useSyncQueue's request failures are the real signal.
 *
 * Returns true on the server (during SSR) so first paint isn't an
 * offline banner that flashes off a tick later.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });

  useEffect(() => {
    function up() { setOnline(true); }
    function down() { setOnline(false); }
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
