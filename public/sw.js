// 서비스워커 — 정적 자산은 캐시(오프라인/설치 가능), HTML/매니페스트는 항상 최신, API는 네트워크.
// 캐시 이름을 올리면(activate 시) 이전 캐시를 통째로 비워 옛 버전이 남지 않는다.
const CACHE = "scanner-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST(/api/*) 등은 캐시하지 않음
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 외부 요청은 건드리지 않음
  if (url.pathname.startsWith("/api/")) return; // API는 항상 네트워크

  // HTML(내비게이션)·매니페스트는 네트워크 우선 → 새 배포가 즉시 반영되고
  // 항상 최신 자산 해시(index-XXXX.js)를 불러온다. 오프라인일 때만 캐시 사용.
  const isShell =
    req.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".webmanifest");
  if (isShell) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 해시가 박힌 정적 자산(JS/CSS/아이콘)은 불변이므로 캐시 우선 + 백그라운드 갱신.
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
