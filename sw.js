// ===== Service Worker for PWA (Offline Cache) =====
const CACHE_NAME = 'cnvn-dict-v12';
const APP_ASSETS = [
    './',
    './index.html',
    './reader.html',
    './utils.js',
    './app.js',
    './dict-engine.js',
    './dict-default.json',
    './reader-lib.js',
    './reader-app.js',
    './backup.js',
    './sync-common.js',
    './cloud-sync.js',
    './github-sync.js'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(APP_ASSETS);
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (name) { return name !== CACHE_NAME; })
                    .map(function (name) { return caches.delete(name); })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

// Cache-first, network fallback
self.addEventListener('fetch', function (event) {
    var request = event.request;

    // Only handle GET requests
    if (request.method !== 'GET') return;

    // Skip cross-origin requests (CDN fonts, external APIs, etc.)
    if (!request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then(function (cached) {
            if (cached) return cached;
            return fetch(request).then(function (response) {
                // Only cache successful responses
                if (response.ok) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, clone);
                    });
                }
                return response;
            });
        }).catch(function () {
            // Offline fallback: return cached index.html for navigation
            if (request.mode === 'navigate') {
                return caches.match('./index.html');
            }
            // For other requests, return empty response to avoid ERR_FAILED
            return new Response('', { status: 503, statusText: 'Offline' });
        })
    );
});
