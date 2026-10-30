// 고정 윈도우 카운터 (Redis INCR + EXPIRE).
//
// 인메모리 제한은 쓰지 않는다. Vercel 서버리스는 인스턴스마다 메모리가 따로이고
// 콜드 스타트 때 초기화되므로, 프로세스 안 카운터로는 Anthropic 호출량을 막지 못한다.
// 이미 붙어 있는 Upstash Redis를 써서 인스턴스와 무관하게 집계한다.

export function createFixedWindowLimiter(redis) {
  return async function hit({ key, max, windowSec }) {
    const count = Number(await redis.incr(key));
    let ttl = Number(await redis.ttl(key));
    // 첫 요청이거나, INCR과 EXPIRE 사이에 프로세스가 죽어서 TTL이 없으면 창을 건다.
    // 이후 요청에서 EXPIRE를 다시 호출하면 TTL이 연장되어 창이 끝나지 않는다.
    if (!Number.isFinite(ttl) || ttl < 0) {
      await redis.expire(key, windowSec);
      ttl = windowSec;
    }
    return {
      allowed: count <= max,
      count,
      limit: max,
      retryAfterSec: ttl > 0 ? ttl : windowSec,
    };
  };
}

// Vercel이 넣는 플랫폼 헤더를 우선한다. 클라이언트가 임의로 붙인
// x-forwarded-for 보다 x-real-ip 가 실제 연결 IP에 가깝다.
export function clientIp(req) {
  const headers = req?.headers || {};
  const raw =
    headerValue(headers, "x-real-ip") ||
    headerValue(headers, "x-vercel-forwarded-for") ||
    headerValue(headers, "x-forwarded-for");
  const ip = String(raw || "").split(",")[0].trim();
  // IPv4 / IPv6만 받는다. 그 외 값은 한 버킷으로 모아 위조 헤더로 키를 쪼개지 못하게 한다.
  if (/^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 64) return ip;
  return "unknown";
}

function headerValue(headers, name) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return value == null ? "" : String(value);
}
