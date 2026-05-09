// Service Worker for 献立共有アプリ
const CACHE_NAME = 'kondate-v1';
const APP_SHELL = [
  '/',
  '/static/css/style.css',
  '/static/js/api.js',
  '/static/js/app.js',
  '/static/js/calendar.js',
  '/static/js/ingredients.js',
  '/static/js/push.js',
  '/manifest.json',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[SW] Failed to cache some app shell resources:', err);
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and API/WebSocket requests
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Serve from cache, update in background
        const fetchPromise = fetch(event.request)
          .then((networkResp) => {
            if (networkResp && networkResp.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResp.clone());
              });
            }
            return networkResp;
          })
          .catch(() => cached);
        return cached;
      }

      // Not in cache: fetch from network
      return fetch(event.request)
        .then((networkResp) => {
          if (networkResp && networkResp.status === 200 && event.request.method === 'GET') {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResp.clone());
            });
          }
          return networkResp;
        })
        .catch(() => {
          // Fallback to index.html for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

// ─── Push ─────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {
    title: '献立共有',
    body: '今夜の献立をチェック！',
    data: { url: '/' },
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
  };

  if (event.data) {
    try {
      const received = event.data.json();
      payload = {
        title: received.title || payload.title,
        body: received.body || payload.body,
        data: received.data || { url: '/' },
        icon: received.icon || payload.icon,
        badge: received.badge || payload.badge,
      };
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    data: payload.data,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open', title: '献立を見る' },
      { action: 'close', title: '閉じる' },
    ],
    requireInteraction: false,
    tag: 'kondate-evening',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ─── Notification Click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Open new window
      return clients.openWindow(targetUrl);
    })
  );
});

// ─── Background Sync (optional) ──────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-meal-plans') {
    event.waitUntil(
      // Sync any queued changes when back online
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'sync_ready' });
        });
      })
    );
  }
});
