const CACHE = 'd-shift-v6';
const ASSETS = ['./', './index.html', './styles.css?v=6', './app.js?v=6', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
self.addEventListener('push', event => {
  let data = { title: 'D-Shift Workouts', body: 'Time to check in.' };
  try { data = event.data.json(); } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: './icon.svg',
    badge: './icon.svg',
    vibrate: [100, 50, 100],
    tag: data.tag || 'd-shift'
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow('./');
  }));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'notify') {
    event.waitUntil(self.registration.showNotification(event.data.title, {
      body: event.data.body, icon: './icon.svg', badge: './icon.svg', tag: event.data.tag || 'd-shift'
    }));
  }
});
