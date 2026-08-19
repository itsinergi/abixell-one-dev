/*
 * Checkpoint 1C.7 — minimal, safe PWA service worker.
 *
 * Scope is DELIBERATELY narrow (Founder guard 16/17): it caches only the
 * static application shell/assets so the app can boot offline. It NEVER
 * caches authenticated business data:
 *   - any request to /api/* is passed straight to the network (never cached),
 *   - only same-origin GET requests for static assets are cached,
 *   - non-GET requests are never touched.
 * There is no offline mutation queue and no background sync (guard 18).
 *
 * Cache is versioned (CACHE_VERSION) so a new deploy activates a fresh cache
 * and old ones are deleted — no permanently-stale shell (guard 21).
 */
const CACHE_VERSION = "abixell-shell-v1";

self.addEventListener("install", () => {
  // Take over as soon as installed; the new build's hashed assets will be
  // fetched and cached on demand by the fetch handler below.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache mutations

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass
  if (url.pathname.startsWith("/api/")) return; // NEVER cache authenticated API/business data

  // Stale-while-revalidate for the static shell + assets: serve cache fast,
  // refresh in the background. SPA navigations fall back to the cached shell
  // when offline.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        network; // fire-and-forget refresh
        return cached;
      }
      const res = await network;
      if (res) return res;
      // Offline with nothing cached: for a navigation, fall back to the shell.
      if (req.mode === "navigate") {
        const shell = (await cache.match("/index.html")) || (await cache.match("/"));
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    })(),
  );
});
