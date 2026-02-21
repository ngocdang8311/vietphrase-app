// ===== Service Worker for PWA (Offline Cache) =====
const CACHE_NAME = 'cnvn-dict-v25';
const APP_ASSETS = [
    '/',
    '/index.html',
    '/reader.html',
    '/privacy.html',
    '/manifest.json',
    '/utils.js',
    '/app.js',
    '/dict-engine.js',
    '/dict-default.json',
    '/reader-lib.js',
    '/reader-app.js',
    '/backup.js',
    '/sync-common.js',
    '/cloud-sync.js',
    '/github-sync.js',
    '/epub-bridge.js',
    '/foliate-js/view.js',
    '/foliate-js/paginator.js',
    '/foliate-js/epub.js',
    '/foliate-js/epubcfi.js',
    '/foliate-js/progress.js',
    '/foliate-js/overlayer.js',
    '/foliate-js/text-walker.js',
    '/foliate-js/fixed-layout.js',
    '/foliate-js/vendor/zip.js',
    '/foliate-js/vendor/fflate.js',
    '/foliate-js/mobi.js',
    '/foliate-js/fb2.js',
    '/foliate-js/comic-book.js'
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

// Navigation: network-first.
// Static assets: cache-first.
self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;

    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Never intercept/cache API proxy requests.
    if (url.pathname.indexOf('/api/') === 0) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).then(function (response) {
                if (response && response.ok) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, clone);
                    });
                }
                return response;
            }).catch(function () {
                return caches.match(url.pathname).then(function (cachedByPath) {
                    if (cachedByPath) return cachedByPath;
                    return caches.match('/index.html').then(function (cachedIndex) {
                        return cachedIndex || new Response('Offline', { status: 503, statusText: 'Offline' });
                    });
                });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(function (cached) {
            if (cached) return cached;
            return fetch(request).then(function (response) {
                if (response && response.ok) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, clone);
                    });
                }
                return response;
            });
        }).catch(function () {
            return new Response('', { status: 503, statusText: 'Offline' });
        })
    );
});
