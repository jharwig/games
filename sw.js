/* Service worker: makes the site available offline. */
/* BUILD is stamped by the deploy workflow so each deploy gets a fresh cache. */
var BUILD = "";
var CACHE = "games-v4" + (BUILD ? "-" + BUILD : "");

/* Filled in by the deploy workflow with each built game's dist files
   (their filenames are content-hashed, so they can't be listed here). */
var BUILT_PRECACHE = [];

var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
].concat(BUILT_PRECACHE);

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== CACHE;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Network first for pages, so updates arrive when online.
  // Cache fallback keeps the site available offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(request, copy);
        });
        return response;
      }).catch(function () {
        return caches.match(request, { ignoreSearch: true });
      })
    );
    return;
  }

  // Cache first for all other assets.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      });
    })
  );
});
