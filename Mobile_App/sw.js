/* 小守護防詐系統 Service Worker：離線優先、API 不快取、離線頁備援 */
const SW_VERSION = "ai-shield-v2026-06-13-002";
const CORE_CACHE = `${SW_VERSION}-core`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./offline.html",
  "./style.css",
  "./manifest.webmanifest",
  "./app.js",
  "./appEvidenceSync.js",
  "./appRiskEngine.js",
  "./blocked.html",
  "./blocked.js",
  "./config.js",
  "./chart.js",
  "./socket.io.min.js",


  "./assets/audio/ai_shield_bilingual_warning.wav",

  "./ai-shield-logo.png",
  "./xiaoshouhu-male-hero.png",
  "./mascot-girl-new.png",

  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/images/warning-new.png",
  "./assets/images/mascot-boy-new.png",
  "./assets/images/ling.png",
  "./assets/images/home-bg-1.png",
  "./assets/images/home-bg-2.png",
  "./xiaoxin.png"
];

const CORE_ASSET_PATHS = CORE_ASSETS.map(asset => {
  try {
    return new URL(asset, self.location.href).pathname;
  } catch (e) {
    return "";
  }
}).filter(Boolean);

function isCoreAssetUrl(url) {
  try {
    return CORE_ASSET_PATHS.includes(url.pathname);
  } catch (e) {
    return false;
  }
}

function isApiRequest(request) {
  try {
    const url = new URL(request.url);
    return url.pathname.startsWith("/api/") || url.pathname.includes("/api/");
  } catch (e) {
    return false;
  }
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

async function cacheCoreAssets() {
  const cache = await caches.open(CORE_CACHE);
  const requests = CORE_ASSETS.map(path => new Request(path, { cache: "reload" }));
  await Promise.allSettled(requests.map(request => cache.add(request)));
}

self.addEventListener("install", event => {
  event.waitUntil(cacheCoreAssets().then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => ![CORE_CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkOnly(request) {
  return fetch(request, { cache: "no-store" });
}

async function navigationNetworkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (e) {
    const cachedPage = await caches.match(request);
    return cachedPage || await caches.match("./index.html") || offlineFallback();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  });

  return cached || networkPromise;
}

async function offlineFallback() {
  const cached = await caches.match("./offline.html") || await caches.match("/offline.html");
  return cached || new Response("目前沒有網路，小守護基本防護仍在運作。", {
    status: 200,
    headers: { "Content-Type": "text/plain;charset=utf-8" }
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (isApiRequest(request)) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  try {
    const url = new URL(request.url);
    const isSameOrigin = url.origin === self.location.origin;
    if (!isSameOrigin) return;

    const isCore = isCoreAssetUrl(url);
    event.respondWith((isCore ? cacheFirst(request) : staleWhileRevalidate(request)).catch(async () => {
      const cached = await caches.match(request);
      return cached || offlineFallback();
    }));
  } catch (e) {}
});


self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
