/* E&C Dispatch – notification helper.
   This service worker only shows and handles alert notifications.
   It has no fetch handler, so it never caches or changes how pages load. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); return; }
    }
    await self.clients.openWindow('./');
  })());
});
