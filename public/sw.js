/* Krawings Portal — push notification service worker.
   Handles only push delivery + click routing. Does NOT cache the app shell. */

self.addEventListener('push', event => {
  let payload = { title: 'Krawings Portal', body: '', url: '/' };
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; }
    catch { payload.body = event.data.text(); }
  }
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
    // Vibrate the phone briefly to surface the alert in a noisy kitchen.
    vibrate: [80, 30, 80],
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus an existing tab if one is open at the target URL or anywhere on the portal.
    for (const c of allClients) {
      if (c.url.includes(target) && 'focus' in c) return c.focus();
    }
    for (const c of allClients) {
      if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
