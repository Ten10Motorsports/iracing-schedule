/* ------------------------------------------------------------------
   sw.js — service worker

   Two strategies, deliberately different:

   - The app shell (HTML, CSS, JS, icons) is cache-first. It changes
     only when you deploy, so serving it from cache makes the app open
     instantly and work with no signal.

   - data/schedule.json is network-first with a cache fallback. The
     schedule changes often and a stale calendar is worse than a slow
     one, so we always try the network and only fall back to the last
     copy we saw when offline.

   Bump CACHE when you change any shell file, otherwise browsers will
   keep serving the old one.
------------------------------------------------------------------- */

const CACHE = "race-schedule-v1";

const SHELL = [
  "./",
  "./index.html",
  "./assets/app.css",
  "./assets/util.js",
  "./assets/content.js",
  "./assets/store.js",
  "./assets/views.js",
  "./assets/admin.js",
  "./assets/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* never touch GitHub's API or anything cross-origin we did not cache */
  if (url.origin !== self.location.origin) return;

  /* the schedule itself: network first */
  if (url.pathname.endsWith("schedule.json")) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("./data/schedule.json")))
    );
    return;
  }

  /* shell: cache first, refresh in the background */
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
