const CACHE_NAME = 'song-db-cache-v2';
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/shige-image.jpg',
    '/shige192.png',
    '/shige512.png'
];

async function cacheBuiltAssets(cache) {
    const response = await fetch('/index.html', { cache: 'reload' });
    const html = await response.clone().text();
    await cache.put('/index.html', response);

    const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map(match => match[1])
        .filter(url => url.startsWith('/assets/'));

    await Promise.all(assetUrls.map(url => cache.add(url).catch(() => null)));
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async cache => {
                await Promise.all(CORE_ASSETS.map(url => cache.add(url).catch(() => null)));
                await cacheBuiltAssets(cache).catch(() => null);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Don't cache API calls or external URLs
    if (event.request.url.includes('/api/') ||
        event.request.url.includes('cloudfunctions.net') ||
        event.request.url.includes('hymnal.net')) {
        return event.respondWith(fetch(event.request));
    }

    if (event.request.mode === 'navigate') {
        return event.respondWith(
            fetch(event.request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                    return response;
                })
                .catch(() => caches.match(event.request).then(response => response || caches.match('/index.html')))
        );
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }

                return fetch(event.request).then(networkResponse => {
                    if (
                        event.request.method === 'GET' &&
                        new URL(event.request.url).origin === self.location.origin
                    ) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                    }

                    return networkResponse;
                });
            })
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
