// 최소 서비스워커 — 앱 셸 캐시(오프라인/설치 가능), API는 항상 네트워크
const CACHE = "scanner-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST(/api/*) 등은 캐시하지 않음
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 외부 요청은 건드리지 않음
  if (url.pathname.startsWith("/api/")) return; // API는 항상 네트워크

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
