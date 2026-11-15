// Service Worker for Push Notifications — Sitaram Medical Store
const CACHE_NAME = 'sitaram-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Handle push events (sent from server via web-push)
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  const title = data.title || 'Sitaram Medical Store';
  const options = {
    body: data.body || 'Your order has been updated.',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'order-update',
    data: { url: data.url || '/track.html' },
    actions: data.actions || [
      { action: 'track', title: '📦 Track Order' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/track.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
