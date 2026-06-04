const CACHE_NAME = "ai-shield-app-20260528-v10-ai-assistant-clean-ui";
const STATIC_ASSETS = [
  "./",
  "./ai_shield_app_official.html",
  "./ai_shield_app_official.js",
  "./html5-qrcode.min.js",
  "./manifest.json",
  "./warning-new.png",
  "./mascot-boy-new.png",
  "./mascot-girl-new.png",
  "./ai_shield_bilingual_warning.mp3"
];

async function cacheStaticAssets() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(
    STATIC_ASSETS.map(async (asset) => {
      try {
        await cache.add(asset);
      } catch (error) {
        console.warn("AI Shield cache asset skipped:", asset, error);
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheStaticAssets()
      .then(() => self.skipWaiting())
      .catch((error) => console.warn("AI Shield cache install skipped:", error))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.pathname.includes("/api/") || url.hostname.includes("ai-anti-scam")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./ai_shield_app_official.html", copy));
          return response;
        })
        .catch(() => caches.match("./ai_shield_app_official.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
