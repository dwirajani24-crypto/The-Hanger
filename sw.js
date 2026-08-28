/* =========================================================================
   THE HANGER — sw.js (service worker)
   -------------------------------------------------------------------------
   This file lets the app keep working when there is no internet
   connection, once it has been opened at least once. It does this by
   caching the app's own files (the "app shell") plus anything else the
   app fetches, and serving those cached copies when offline.

   IMPORTANT: your wardrobe DATA (clothing photos, outfits, week plan)
   is NOT stored here — that lives in IndexedDB (see app.js). This file
   only caches the *code* of the app itself (HTML/CSS/JS/icons) so the
   app can still load with no signal.

   Bump CACHE_NAME whenever you change index.html/styles.css/app.js and
   re-upload, so returning visitors get the new version instead of a
   stale cached one.
   ========================================================================= */

const CACHE_NAME = 'the-hanger-shell-v1';

const APP_SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// On install, download and cache every app-shell file up front.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL_FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// On activate, remove any caches left over from an older version of the app.
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

// Fetch strategy:
//  - For files that belong to this app (same origin): try the cache
//    first for speed and offline support, and refresh the cache quietly
//    in the background whenever the network is available.
//  - For everything else (e.g. the Google Fonts / Tailwind CDN files):
//    try the network first, but fall back to a cached copy if there's
//    no connection.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        const networkFetch = fetch(event.request).then(function (response) {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
          }
          return response;
        }).catch(function () { return cached; });
        return cached || networkFetch;
      })
    );
  } else {
    event.respondWith(
      fetch(event.request).then(function (response) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
        return response;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
  }
});
