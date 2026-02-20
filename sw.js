// ===== Service Worker for PWA (Offline Cache) =====
const CACHE_NAME = 'cnvn-dict-v6';
const APP_ASSETS = [
    './',
    'index.html',
    'app.js',
    'dict-engine.js'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            // Core app shell — must succeed
            return cache.addAll(APP_ASSETS).then(function () {
                // Dictionary — best effort, don't block install
                return fetch('../dict-default.json')
                    .then(function (r) { if (r.ok) cache.put('../dict-default.json', r); })
                    .catch(function () {});
            });
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

// Offline-first: cache → network fallback
self.addEventListener('fetch', function (event) {
    event.respondWith(
        caches.match(event.request).then(function (cached) {
            if (cached) return cached;
            return fetch(event.request).then(function (response) {
                if (response.ok && event.request.method === 'GET') {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            });
        }).catch(function () {
            if (event.request.mode === 'navigate') {
                return caches.match('index.html');
            }
        })
    );
});
