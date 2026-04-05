// ====================================================================
// Service Worker — Маленький Помощник PWA
// Стратегия: Network First (обновления приходят сразу, оффлайн из кеша)
// ====================================================================

const CACHE_NAME = 'pomoshchnik-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/audio.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Установка: кешируем все файлы, активируемся СРАЗУ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Активация: удаляем ВСЕ старые кеши, берём контроль сразу
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network First — сначала сеть, при ошибке кеш (оффлайн)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Обновляем кеш свежей версией
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Оффлайн — отдаём из кеша
        return caches.match(event.request)
          .then(cached => cached || caches.match('/index.html'));
      })
  );
});
