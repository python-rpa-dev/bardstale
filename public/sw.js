// Hollow Vale offline shell. Hashed build assets are immutable (cache-first);
// the app shell itself is network-first so a deploy is live on next load, and
// only falls back to cache when truly offline. Same-origin GETs only.
const CACHE = "hv-shell-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(["./", "./manifest.webmanifest", "./icon.svg"]);
    // The entry HTML names the hashed JS/CSS — precache those too so a first-ever visit
    // can boot offline, not just show an empty shell.
    const html = await (await fetch("./")).text();
    const assets = [...html.matchAll(/(?:href|src)="\.\/(assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.location.href).href);
    if (assets.length) await c.addAll(assets);
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./", copy));
          return res;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
