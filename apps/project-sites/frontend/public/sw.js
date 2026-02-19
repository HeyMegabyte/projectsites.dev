var CACHE_NAME = 'project-sites-v2';
var ASSETS_TO_CACHE = [
  '/',
  '/logo-header.png',
  '/logo-icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/site.webmanifest'
];

// Install: pre-cache essential assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: stale-while-revalidate for HTML, cache-first for assets
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip API and webhook requests
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/')) return;

  // For navigation requests (HTML), use stale-while-revalidate
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match('/').then(function(cached) {
          // Always revalidate from '/' (SPA entry point) regardless of the navigation URL
          var fetchPromise = fetch('/').then(function(response) {
            if (response.ok) {
              cache.put('/', response.clone());
            }
            return response;
          }).catch(function() {
            return cached;
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // For static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response.ok && event.request.method === 'GET') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
