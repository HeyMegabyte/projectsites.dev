var CACHE_NAME = 'project-sites-v3';
var API_CACHE_NAME = 'project-sites-api-v1';
var ASSETS_TO_CACHE = [
  '/',
  '/logo-header.png',
  '/logo-icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/site.webmanifest'
];

// Max age for cached API responses (5 minutes)
var API_CACHE_MAX_AGE = 5 * 60 * 1000;

// Install: pre-cache essential assets + skip waiting
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
  var keepCaches = [CACHE_NAME, API_CACHE_NAME];
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return keepCaches.indexOf(key) === -1; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: strategy depends on request type
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip webhook requests entirely
  if (url.pathname.startsWith('/webhooks/')) return;

  // Runtime caching for GET API responses (stale-while-revalidate)
  if (url.pathname.startsWith('/api/') && event.request.method === 'GET') {
    event.respondWith(
      caches.open(API_CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          var fetchPromise = fetch(event.request).then(function(response) {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(function() {
            return cached || new Response(
              JSON.stringify({ error: { code: 'OFFLINE', message: 'You are offline' } }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // Skip non-GET API requests (POST, PUT, DELETE)
  if (url.pathname.startsWith('/api/')) return;

  // For navigation requests (HTML), serve cached index.html with revalidation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match('/').then(function(cached) {
          var fetchPromise = fetch('/').then(function(response) {
            if (response.ok) {
              cache.put('/', response.clone());
            }
            return response;
          }).catch(function() {
            // Offline fallback: serve cached index.html
            return cached || new Response(
              '<!DOCTYPE html><html><head><meta charset="utf-8"><title>ProjectSites - Offline</title>' +
              '<style>body{font-family:Inter,system-ui,sans-serif;background:#060610;color:#e0e0e0;' +
              'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}' +
              'h1{font-size:1.5rem;margin-bottom:1rem}p{color:#888;margin-bottom:2rem}' +
              'button{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:1rem}' +
              '</style></head><body><div><h1>You are offline</h1>' +
              '<p>Check your connection and try again.</p>' +
              '<button onclick="location.reload()">Retry</button></div></body></html>',
              { status: 200, headers: { 'Content-Type': 'text/html' } }
            );
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
