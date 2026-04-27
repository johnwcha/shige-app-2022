const CACHE_NAME = 'song-db-cache-v1';
const urlsToCache = [
    '/',
    '/style.css',
    '/index.html',
    '/songDB.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    // Don't cache API calls or external URLs
    if (event.request.url.includes('/api/') ||
        event.request.url.includes('cloudfunctions.net') ||
        event.request.url.includes('hymnal.net')) {
        return event.respondWith(fetch(event.request));
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});
