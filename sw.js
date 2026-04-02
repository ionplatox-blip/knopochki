// ====================================================================
// Service Worker — Маленький Помощник PWA
// Стратегия: Cache First (всё статическое, нет бэкенда)
// ====================================================================

const CACHE_NAME = 'pomoshchnik-v1';
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

// Установка: кешируем все файлы
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // Активируем сразу
  );
});

// Активация: чистим старые кеши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // Берём контроль сразу
  );
});

// Fetch: Cache First — сначала кеш, потом сеть
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          // Кешируем новые запросы (шрифты Google Fonts и т.д.)
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => caches.match('/index.html')) // Фоллбек на главную
  );
});
