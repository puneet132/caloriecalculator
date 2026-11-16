// Fourteen service worker.
//
// The page itself is fetched network-first, so a new deploy shows up on the next
// open without anyone having to bump a version number. If the network is down or
// slow, the last good copy is served from cache. Icons, fonts and the manifest are
// served from cache and refreshed in the background. API calls are never cached.
const SHELL = "fourteen-shell-v7";
const RUNTIME = "fourteen-runtime-v7";
const ASSETS = ["./", "./manifest.json", "./icons/logo.svg", "./icons/icon-192.png", "./icons/icon-512.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function pageFirstFromNetwork(request) {
  const cached = () => caches.match("./", { ignoreSearch: true });
  const fresh = fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put("./", copy));
    }
    return res;
  });
  // Don't leave someone staring at a blank screen on a bad connection.
  const timeout = new Promise((resolve) => setTimeout(resolve, 3500)).then(cached);
  return Promise.race([fresh.catch(() => undefined), timeout])
    .then((res) => res || cached())
    .then((res) => res || fresh);
}

function staleWhileRevalidate(request) {
  return caches.open(RUNTIME).then((cache) =>
    caches.match(request).then((hit) => {
      const refresh = fetch(request)
        .then((res) => {
          if (res.ok || res.type === "opaque") cache.put(request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") return e.respondWith(pageFirstFromNetwork(req));
  if (sameOrigin || FONT_HOSTS.includes(url.hostname)) e.respondWith(staleWhileRevalidate(req));
});
